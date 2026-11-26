import type {
  ComputedTaxYear,
  EntityType,
  FilingStatus,
  PlannerState,
  ResidencyStatus,
  SetupConfig,
  StateFilingInputs,
  TaxYearRecord,
} from '../types/tax';
import { createInitialBaselineState, normalizePlannerState } from '../engine/baseline';
import { calculateSixYearPlan, STATE_TAX_RULES } from '../engine/taxEngine';
import { ALL_SCHEDULE_ITEM_IDS, MASTER_SCHEDULE_CATALOG } from '../engine/scheduleCatalog';
import {
  buildCpaHorizonSummary,
  computePnlVsHorizonReconciliation,
  reconcilePnlStateToHorizonRevenue,
} from '../engine/cpaHorizonSummary';
import {
  calculatePnlBalanceSheet,
  createInitialPnlBalanceSheetState,
} from '../engine/pnlBalanceSheet';
import { computeDbpActuarialWaterfall } from '../engine/dbpActuarial';
import { computeIrmaaBracketThresholds } from '../engine/irmaa';
import {
  aggregateCadenceStateRevenue,
  computeCadenceForecast,
} from '../engine/cadenceEngine';
import {
  setYearStateApportionmentOverride,
  updateYearStateApportionmentSplit,
} from '../utils/setupHelpers';
import { DEFAULT_PROFILE_SEED, isDefaultSeedSetup } from '../data/profiles';
import {
  PROFILE_SNAPSHOT_APP_ID,
  PROFILE_SNAPSHOT_SCHEMA_VERSION,
  applyImportedSnapshotToStore,
  buildFreshBlankUserRecord,
  buildFreshTestPersonaRecord,
  buildProfileSnapshotFilename,
  createProfileRecord,
  loadMultiProfileStore,
  parseAndValidateProfileSnapshot,
  serializeSingleProfileBackup,
} from '../engine/profileStore';
import { calculateMarginalTaxSavings } from '../utils/marginalSavings';
import { createDefaultPersonProfile } from '../utils/personTax';

// ============================================================================
// Types & Public Dev Verification Interface
// ============================================================================

export interface StressTestFailure {
  caseId: string;
  phase: 'Phase 1 (Boundary)' | 'Phase 2 (Fuzz)';
  label: string;
  invariant: string;
  year: number | 'ALL';
  detail: string;
  inputSummary: string;
}

export interface StressSuiteReport {
  seed: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  durationMs: number;
  failures: StressTestFailure[];
}

const FUZZ_SEED = 20261126;
const FUZZ_CASE_COUNT = 175;
const FORECAST_YEARS = [2025, 2026, 2027, 2028, 2029, 2030];

// ============================================================================
// Deterministic Seeded PRNG (Mulberry32)
// ============================================================================

function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// ============================================================================
// Deep Corrupt-Number Scanner (Invariant 1)
// ============================================================================

function scanForCorruptNumbers(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      out.push(`${path}=${String(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForCorruptNumbers(value[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      scanForCorruptNumbers(v, `${path}.${k}`, out);
    }
  }
}

// ============================================================================
// Profile Builder Helpers
// ============================================================================

interface CustomProfileSpec {
  filingStatus: FilingStatus;
  primaryBirthYear: number;
  spouseBirthYear: number | null;
  entityType: EntityType;
  hasScorp: boolean;
  hasDbp: boolean;
  has401k: boolean;
  hasSsMedicare: boolean;
  medicareEnrolled: boolean;
  hasPte: boolean;
  homeState: string;
  secondaryState: string;
  multiState: boolean;
  primarySplitPct: number;
  primaryResidency: ResidencyStatus;
  primaryResidencyRatio: number;
  secondaryResidency: ResidencyStatus;
  primaryPteElected: boolean;
  secondaryPteElected: boolean;
  grossRevenue: number;
  opEx: number;
  billW2: number;
  debraW2: number;
  nonScorpW2: number;
  sched1OtherIncome?: number;
  taxableInterest?: number;
  ordinaryDividends?: number;
  qualifiedDividends?: number;
  ltcg?: number;
  sehiPremiums?: number;
  dbpContribution?: number;
  dbpTerminationYear?: number | null;
  stockBasisBeg?: number;
  draws?: number;
  capitalContributions?: number;
  nondeductibleExpenses?: number;
  schedKInterest?: number;
  deductionMethod?: 'standard' | 'itemized';
  customItemized?: number;
}

function buildSyntheticState(spec: CustomProfileSpec): PlannerState {
  const isMfj = spec.filingStatus === 'married_filing_jointly';
  const primaryProfile = createDefaultPersonProfile(`${spec.primaryBirthYear}-05-15`);
  const spouseProfile = createDefaultPersonProfile(
    `${spec.spouseBirthYear ?? spec.primaryBirthYear}-08-20`
  );
  primaryProfile.medicare.enrolled = spec.medicareEnrolled && 2026 - spec.primaryBirthYear >= 65;
  spouseProfile.medicare.enrolled =
    isMfj && spec.medicareEnrolled && 2026 - (spec.spouseBirthYear ?? spec.primaryBirthYear) >= 65;
  if (primaryProfile.medicare.enrolled) {
    primaryProfile.medicare.part_b_monthly = 185;
    primaryProfile.medicare.part_d_monthly = 45;
  }
  if (spouseProfile.medicare.enrolled) {
    spouseProfile.medicare.part_b_monthly = 185;
    spouseProfile.medicare.part_d_monthly = 45;
  }

  const splitPrimary = spec.multiState && spec.secondaryState ? spec.primarySplitPct : 100;
  const splitSecondary = spec.multiState && spec.secondaryState ? 100 - splitPrimary : 0;

  const setup: SetupConfig = {
    filing_status: spec.filingStatus,
    primary_name: 'Primary',
    spouse_name: isMfj ? 'Spouse' : '',
    primary_birth_year: spec.primaryBirthYear,
    spouse_birth_year: isMfj ? spec.spouseBirthYear ?? spec.primaryBirthYear : null,
    primary_profile: primaryProfile,
    spouse_profile: spouseProfile,
    business_name: spec.hasScorp ? 'QA Test Entity LLC' : '',
    business_website: '',
    business_ein: '',
    home_state: spec.homeState,
    secondary_state: spec.multiState ? spec.secondaryState : '',
    state_revenue_apportionment:
      spec.multiState && spec.secondaryState
        ? {
            states: [spec.homeState, spec.secondaryState],
            default_split: {
              [spec.homeState]: splitPrimary,
              [spec.secondaryState]: splitSecondary,
            },
            year_overrides: {},
          }
        : {
            states: [spec.homeState],
            default_split: { [spec.homeState]: 100 },
            year_overrides: {},
          },
    workspace_profile_kind: 'custom',
    deduction_method: spec.deductionMethod ?? 'standard',
    custom_itemized_deduction: spec.customItemized ?? 30000,
    entity_type: spec.entityType,
    has_scorp: spec.hasScorp,
    has_ss_medicare: spec.hasSsMedicare,
    has_stock_basis: spec.hasScorp,
    has_dbp: spec.hasDbp,
    dbp_planned_termination_year: spec.dbpTerminationYear ?? null,
    post_dbp_profit_sharing_rate: 0.06,
    dbp_actuarial: {
      historical_high_3_w2: Math.max(spec.billW2, spec.debraW2, 60000),
      boy_assets_anchor: spec.hasDbp ? 250000 : 0,
      plan_year_anchor: 5,
      trust_growth_rate: 0.04,
      valuation_interest_rate: 0.05,
    },
    has_401k_or_ira: spec.has401k,
    has_annuity: false,
    has_pte: spec.hasPte,
    multi_state_active: spec.multiState,
    residency_change_active: spec.primaryResidency === 'part_year_resident',
    anchor_actuals_year: 2025,
    current_tax_year: 2026,
    forecast_length: 6,
    forecast_years: [...FORECAST_YEARS],
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      irmaa_threshold_growth_rate: 0.03,
      revenue_growth_rate: 0.02,
      wage_growth_rate: 0.02,
      investment_growth_rate: 0.03,
      expense_ratio: spec.grossRevenue > 0 ? Math.min(1, spec.opEx / spec.grossRevenue) : 0.2,
      opex_scaling_mode: 'fixed_inflation',
    },
    irmaa_threshold_overrides: {},
  };

  const caRev = Math.round((spec.grossRevenue * splitPrimary) / 100);
  const azRev = Math.max(0, spec.grossRevenue - caRev);

  const years: TaxYearRecord[] = FORECAST_YEARS.map((taxYear, idx) => {
    const dbpTerminated =
      !spec.hasDbp ||
      (spec.dbpTerminationYear !== null &&
        spec.dbpTerminationYear !== undefined &&
        taxYear > spec.dbpTerminationYear);

    const stateFilings: StateFilingInputs[] = [
      {
        state_code: spec.homeState,
        residency_status: spec.primaryResidency,
        residency_start_date: `${taxYear}-01-01`,
        residency_end_date: `${taxYear}-12-31`,
        residency_day_or_income_ratio: spec.primaryResidencyRatio,
        state_return_type: `${spec.homeState} Return`,
        state_apportionment_factor: splitPrimary / 100,
        state_pte_elected: spec.primaryPteElected,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
    ];
    if (spec.multiState && spec.secondaryState && spec.secondaryState !== spec.homeState) {
      stateFilings.push({
        state_code: spec.secondaryState,
        residency_status: spec.secondaryResidency,
        residency_start_date: `${taxYear}-01-01`,
        residency_end_date: `${taxYear}-12-31`,
        residency_day_or_income_ratio: spec.secondaryResidency === 'resident' ? 1 : 0,
        state_return_type: `${spec.secondaryState} Return`,
        state_apportionment_factor: splitSecondary / 100,
        state_pte_elected: spec.secondaryPteElected,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      });
    }

    const anyPteElected = stateFilings.some(
      (sf) => sf.state_pte_elected && Boolean(STATE_TAX_RULES[sf.state_code]?.pteAvailable)
    );

    return {
      tax_year: taxYear,
      record_mode: idx === 0 ? 'actuals' : 'forecast',
      is_locked_actuals: false,
      form_1040: {
        w2_wages_total: spec.hasScorp ? 0 : spec.nonScorpW2,
        use_explicit_w2_box1: false,
        taxable_interest: spec.taxableInterest ?? 0,
        tax_exempt_interest: 0,
        ordinary_dividends: spec.ordinaryDividends ?? 0,
        qualified_dividends: spec.qualifiedDividends ?? 0,
        short_term_capital_gain_loss: 0,
        long_term_capital_gain_loss: spec.ltcg ?? 0,
        schedule_d_includes_excess_gain: false,
        schedule_1_other_income: spec.sched1OtherIncome ?? 0,
        schedule_1_adjustments_input: 0,
        schedule_k1_ordinary_income: 0,
        schedule_k1_other_items: 0,
        ira_distributions_gross: 0,
        ira_distributions_taxable: 0,
        pensions_and_annuities_gross: 0,
        pensions_and_annuities_taxable: 0,
        social_security_gross: 0,
        ss_bill_mode: 'off',
        ss_debra_mode: 'off',
        health_insurance_premiums: spec.sehiPremiums ?? 0,
        itemized_deductions_input: spec.customItemized ?? 30000,
        deduction_method: spec.deductionMethod ?? 'standard',
      },
      scorp_1120s: {
        entity_id: 'qa-entity',
        entity_name: spec.hasScorp ? 'QA Test Entity LLC' : '',
        entity_ein: '',
        bill_ownership_pct: isMfj ? 50 : 100,
        debra_ownership_pct: isMfj ? 50 : 0,
        ca_revenue: caRev,
        az_revenue: azRev,
        gross_receipts_revenue: spec.grossRevenue,
        operating_expenses: spec.opEx,
        operating_expenses_override: null,
        use_detailed_1120s_deductions: false,
        debra_w2_wages: isMfj ? spec.debraW2 : 0,
        bill_w2_wages: spec.billW2,
        officer_w2_wages: spec.billW2 + (isMfj ? spec.debraW2 : 0),
        scorp_distributions_total: spec.draws ?? 0,
        capital_contributions: spec.capitalContributions ?? 0,
        schedule_k_interest_income: spec.schedKInterest ?? 0,
        schedule_k_nondeductible_expenses: spec.nondeductibleExpenses ?? 0,
        stock_basis_beginning: idx === 0 ? spec.stockBasisBeg ?? 25000 : 0,
        aaa_balance_beginning: idx === 0 ? 10000 : 0,
        state_sourcing_breakdown: stateFilings.map((sf) => ({
          state_code: sf.state_code,
          apportionment_percent: Math.round(sf.state_apportionment_factor * 100),
        })),
        pte_election_active: anyPteElected,
        auto_sync_k1: true,
      },
      dbp_and_retirement: {
        dbp_plan_id: 'qa-dbp',
        dbp_status: dbpTerminated ? 'terminated' : 'active',
        dbp_max_deductible_contribution: dbpTerminated ? 0 : spec.dbpContribution ?? 0,
        dbp_actual_contribution: dbpTerminated ? 0 : spec.dbpContribution ?? 0,
        dbp_target_termination_year: spec.dbpTerminationYear ?? 2099,
        dbp_rollover_target_account: 'Traditional IRA Rollover',
        dbp_loan_balance: 0,
        dbp_collateral_requirement: 0,
        qualified_plan_contribution: 0,
        rollover_amount: 0,
        rollover_source_type: 'None',
        annuity_contract_value: 0,
        annuity_payout_amount: 0,
      },
      state_filings: stateFilings,
    };
  });

  return {
    setup,
    years,
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: [],
    },
  };
}

function summarizeState(state: PlannerState): string {
  const s = state.setup;
  const y = state.years[1] ?? state.years[0];
  const st = y.state_filings
    .map((f) => `${f.state_code}:${f.residency_status[0].toUpperCase()}${f.state_pte_elected ? '+PTE' : ''}`)
    .join('/');
  return `${s.filing_status} ${s.entity_type} hasScorp=${s.has_scorp} rev=${y.scorp_1120s.gross_receipts_revenue} opEx=${y.scorp_1120s.operating_expenses} w2=${y.scorp_1120s.bill_w2_wages}/${y.scorp_1120s.debra_w2_wages}/${y.form_1040.w2_wages_total} states=[${st}]`;
}

// ============================================================================
// Universal 5-Invariant Validator (Applied to ALL 195 Cases)
// ============================================================================

function checkUniversalInvariants(
  caseId: string,
  phase: StressTestFailure['phase'],
  label: string,
  state: PlannerState,
  computed: ComputedTaxYear[],
  failures: StressTestFailure[]
): void {
  const inputSummary = summarizeState(state);
  const pushFail = (invariant: string, year: number | 'ALL', detail: string) => {
    failures.push({ caseId, phase, label, invariant, year, detail, inputSummary });
  };

  // --- INVARIANT 1: No Corrupt Values (NaN, Infinity, -Infinity, undefined numeric) ---
  const corruptPaths: string[] = [];
  scanForCorruptNumbers(computed, 'computed', corruptPaths);

  const horizonRowsComputed = MASTER_SCHEDULE_CATALOG.map((row) => ({
    row,
    cells: computed.map((c, idx) => row.computeCell(c, idx, computed, state.setup)),
  }));
  for (const { row, cells } of horizonRowsComputed) {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.numericValue !== undefined && !Number.isFinite(cell.numericValue)) {
        corruptPaths.push(`horizon.${row.id}[${computed[i].tax_year}].numericValue=${cell.numericValue}`);
      }
      if (cell.display.includes('NaN') || cell.display.includes('Infinity')) {
        corruptPaths.push(`horizon.${row.id}[${computed[i].tax_year}].display=${cell.display}`);
      }
    }
  }

  const cpaSummary = buildCpaHorizonSummary(state.setup, computed);
  scanForCorruptNumbers(cpaSummary, 'cpaSummary', corruptPaths);

  // Check calculateMarginalTaxSavings on unlocked forecast years (2026-2030)
  for (const c of computed) {
    if (c.is_locked_actuals || c.tax_year <= state.setup.anchor_actuals_year) continue;
    const ms = calculateMarginalTaxSavings(state, c.tax_year, 1000, computed);
    if (!ms) {
      corruptPaths.push(`marginalSavings[${c.tax_year}]=null`);
    } else {
      scanForCorruptNumbers(ms, `marginalSavings[${c.tax_year}]`, corruptPaths);
    }
  }

  if (corruptPaths.length > 0) {
    pushFail('Invariant 1 (No Corrupt Values)', 'ALL', corruptPaths.slice(0, 4).join('; '));
  }

  // --- INVARIANT 2: 1120-S Footing ---
  if (state.setup.has_scorp) {
    for (let idx = 0; idx < computed.length; idx++) {
      const c = computed[idx];
      const scIn = c.scorp_in;
      const scOut = c.scorp_out;
      const dbpDed =
        state.setup.has_dbp && c.dbp_in.dbp_status !== 'terminated'
          ? c.dbp_in.dbp_actual_contribution
          : 0;
      const er401k = c.form_1040_out.employer_401k_total;

      let expectedK1: number;
      if (scIn.use_detailed_1120s_deductions) {
        const officerComp = scIn.compensation_of_officers ?? 0;
        const salaries = scIn.salaries_and_wages ?? 0;
        const rents = scIn.rents ?? 0;
        const taxesAndLicenses =
          (scIn.payroll_taxes_input ?? scOut.employer_payroll_taxes) +
          (scIn.ftb_state_taxes_input ?? 0);
        const advertising = scIn.advertising ?? 0;
        const pensionPlans = scIn.pension_profit_sharing_input ?? dbpDed + er401k;
        const otherDed = scIn.other_deductions ?? 0;
        expectedK1 = Math.round(
          scIn.gross_receipts_revenue -
            officerComp -
            salaries -
            rents -
            taxesAndLicenses -
            advertising -
            pensionPlans -
            otherDed -
            scOut.pte_tax_paid_total
        );
      } else {
        const sehiDed = c.form_1040_out.sehi_medicare_premiums_effective;
        expectedK1 = Math.round(
          scIn.gross_receipts_revenue -
            scOut.effective_operating_expenses -
            scIn.officer_w2_wages -
            sehiDed -
            scOut.employer_payroll_taxes -
            dbpDed -
            er401k -
            scOut.pte_tax_paid_total
        );
      }

      if (Math.abs(expectedK1 - scOut.ordinary_business_income_1120s) > 1) {
        pushFail(
          'Invariant 2 (1120-S Footing)',
          c.tax_year,
          `Expected K-1 ${expectedK1} vs actual ${scOut.ordinary_business_income_1120s}`
        );
      }
    }
  }

  // --- INVARIANT 3: Stock Basis Conservation ---
  if (state.setup.has_scorp) {
    for (const c of computed) {
      const beg = c.scorp_in.stock_basis_beginning;
      const end = c.scorp_out.stock_basis_ending;
      const k1 = c.scorp_out.ordinary_business_income_1120s;
      const capContrib = Math.max(0, c.scorp_in.capital_contributions || 0);
      const schedKInt = Math.max(0, c.scorp_in.schedule_k_interest_income || 0);
      const nonded = Math.max(0, c.scorp_in.schedule_k_nondeductible_expenses || 0);
      const draws = c.scorp_in.scorp_distributions_total;
      const excessCapGain = c.scorp_out.excess_distribution_capital_gain;

      if (end < 0) {
        pushFail('Invariant 3 (Stock Basis Conservation)', c.tax_year, `Ending Stock Basis < 0 (${end})`);
      }

      const basisBeforeDist = beg + Math.max(0, k1) + schedKInt + capContrib;
      const expectedExcess = Math.max(0, draws - Math.max(0, basisBeforeDist));
      if (Math.abs(excessCapGain - expectedExcess) > 1) {
        pushFail(
          'Invariant 3 (Stock Basis Conservation)',
          c.tax_year,
          `Excess Cap Gain ${excessCapGain} !== expected ${expectedExcess}`
        );
      }
      const basisAfterDist = Math.max(0, basisBeforeDist - draws);
      const lossAndNonded = Math.max(0, -k1) + nonded;
      const appliedLossAndNonded = Math.min(basisAfterDist, lossAndNonded);
      const conservedEnd = Math.round(
        beg + Math.max(0, k1) + schedKInt + capContrib - (draws - excessCapGain) - appliedLossAndNonded
      );
      if (Math.abs(conservedEnd - end) > 1) {
        pushFail(
          'Invariant 3 (Stock Basis Conservation)',
          c.tax_year,
          `Basis conservation mismatch: expected ${conservedEnd} vs actual ${end}`
        );
      }
    }
  }

  // --- INVARIANT 4: PTE & State Neutrality ---
  const hasAnyPteElected = state.years.some(
    (y) => !y.is_locked_actuals && y.state_filings.some((sf) => sf.state_pte_elected)
  );
  for (const c of computed) {
    for (const sf of c.state_filings_out) {
      const rule = STATE_TAX_RULES[sf.state_code];
      if (rule?.mode === 'none') {
        if (sf.state_pte_payment_amount !== 0 || sf.state_income_tax_liability !== 0) {
          pushFail(
            'Invariant 4 (PTE & State Neutrality)',
            c.tax_year,
            `0%-tax state ${sf.state_code} has non-zero PTE (${sf.state_pte_payment_amount}) or tax (${sf.state_income_tax_liability})`
          );
        }
      }
      const recomposed = Math.round(
        sf.state_personal_tax_liability + sf.state_entity_tax_liability + sf.state_pte_payment_amount
      );
      if (Math.abs(recomposed - sf.state_income_tax_liability) > 1) {
        pushFail(
          'Invariant 4 (PTE & State Neutrality)',
          c.tax_year,
          `${sf.state_code} state_income_tax_liability (${sf.state_income_tax_liability}) !== pers(${sf.state_personal_tax_liability})+ent(${sf.state_entity_tax_liability})+pte(${sf.state_pte_payment_amount})`
        );
      }
      if (sf.state_pte_payment_amount > 0 && sf.state_pte_credit_or_exclusion_amount !== sf.state_pte_payment_amount) {
        pushFail(
          'Invariant 4 (PTE & State Neutrality)',
          c.tax_year,
          `${sf.state_code} PTE credit (${sf.state_pte_credit_or_exclusion_amount}) !== PTE paid (${sf.state_pte_payment_amount})`
        );
      }
    }
  }

  // Compare PTE-enabled profiles against PTE-disabled twin to confirm no state tax double-counting
  if (hasAnyPteElected) {
    const pteOffYears = state.years.map((y) =>
      y.is_locked_actuals
        ? y
        : {
            ...y,
            scorp_1120s: { ...y.scorp_1120s, pte_election_active: false },
            state_filings: y.state_filings.map((sf) => ({ ...sf, state_pte_elected: false })),
          }
    );
    const offComputed = calculateSixYearPlan(state.setup, pteOffYears);
    for (let i = 0; i < computed.length; i++) {
      if (computed[i].is_locked_actuals) continue;
      const onC = computed[i];
      const offC = offComputed[i];
      // If prior-year PTE dropped MAGI below an IRMAA cliff, current-year deductible Medicare SEHI
      // decreases, legitimately raising current-year S-Corp net profit by the IRMAA savings.
      const irmaaSehiSavings = Math.max(
        0,
        offC.form_1040_out.sehi_medicare_premiums_effective -
          onC.form_1040_out.sehi_medicare_premiums_effective
      );
      const allowedStateDelta = 2 + Math.ceil(irmaaSehiSavings * 0.14);
      if (onC.total_state_tax > offC.total_state_tax + allowedStateDelta) {
        const onSfSummary = onC.state_filings_out
          .map((s) => `${s.state_code}(app=${s.state_apportioned_income},pers=${s.state_personal_tax_liability},pte=${s.state_pte_payment_amount},ostc=${s.credit_for_taxes_paid_to_other_states},ent=${s.state_entity_tax_liability})`)
          .join(';');
        const offSfSummary = offC.state_filings_out
          .map((s) => `${s.state_code}(app=${s.state_apportioned_income},pers=${s.state_personal_tax_liability},ostc=${s.credit_for_taxes_paid_to_other_states},ent=${s.state_entity_tax_liability})`)
          .join(';');
        pushFail(
          'Invariant 4 (PTE & State Neutrality)',
          onC.tax_year,
          `PTE ON state tax (${onC.total_state_tax}) > OFF (${offC.total_state_tax}) | agi:${onC.form_1040_out.adjusted_gross_income}/${offC.form_1040_out.adjusted_gross_income} pte:${onC.scorp_out.pte_tax_paid_total} exGain:${onC.scorp_out.excess_distribution_capital_gain}/${offC.scorp_out.excess_distribution_capital_gain} ON=[${onSfSummary}] OFF=[${offSfSummary}]`
        );
      }
    }
  }

  // --- INVARIANT 5: Cross-View Parity ($0 variance across Horizon, Multi-State, Form 1040, CPA Export) ---
  const findHorizonSum = (rowId: string): number => {
    const entry = horizonRowsComputed.find((x) => x.row.id === rowId);
    if (!entry) return 0;
    return entry.cells.reduce((acc, cell) => acc + (cell.numericValue ?? 0), 0);
  };
  const findCpaRow = (rowId: string) => cpaSummary.rows.find((r) => r.id === rowId);

  const engineFedSum = computed.reduce((s, c) => s + c.form_1040_out.federal_income_tax, 0);
  const engineStateSum = computed.reduce((s, c) => s + c.total_state_tax, 0);
  const multiStateMatrixSum = computed.reduce(
    (s, c) => s + c.state_filings_out.reduce((a, sf) => a + sf.state_income_tax_liability, 0),
    0
  );
  const engineAllInSum = computed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const engineAgiSum = computed.reduce((s, c) => s + c.form_1040_out.adjusted_gross_income, 0);
  const engineQbiSum = computed.reduce(
    (s, c) => s + c.form_1040_out.qualified_business_income_deduction,
    0
  );

  const parityPairs: [string, number, number][] = [
    ['Horizon vs Form 1040 Federal Tax', findHorizonSum('federal_income_tax'), engineFedSum],
    ['Horizon vs Multi-State Total State Tax', findHorizonSum('total_state_taxes'), multiStateMatrixSum],
    ['Engine vs Multi-State Total State Tax', engineStateSum, multiStateMatrixSum],
    [
      'Horizon vs Engine Total All-In Tax',
      findHorizonSum('total_fed_state_tax') + findHorizonSum('business_fica_tax'),
      engineAllInSum,
    ],
    ['Horizon vs Form 1040 AGI', findHorizonSum('total_joint_agi'), engineAgiSum],
    ['Horizon vs Form 1040 QBI', -findHorizonSum('qbi_deduction'), engineQbiSum],
    ['CPA Export vs Engine 6-Yr All-In Tax', cpaSummary.sixYearAllInTax, engineAllInSum],
    ['CPA Export vs Engine Federal Tax', findCpaRow('federal_income_tax')?.totalNumeric ?? 0, engineFedSum],
    ['CPA Export vs Engine Total State Tax', findCpaRow('total_state_tax')?.totalNumeric ?? 0, engineStateSum],
    ['CPA Export vs Engine AGI', findCpaRow('agi_magi')?.totalNumeric ?? 0, engineAgiSum],
  ];

  for (const [desc, a, b] of parityPairs) {
    if (a !== b) {
      pushFail('Invariant 5 (Cross-View Parity)', 'ALL', `${desc}: ${a} !== ${b} (diff ${a - b})`);
    }
  }
  for (const c of computed) {
    const recomposedAllIn = Math.round(
      c.form_1040_out.federal_income_tax + c.total_state_tax + c.total_entity_and_payroll_tax
    );
    if (recomposedAllIn !== c.total_all_in_tax) {
      pushFail(
        'Invariant 5 (Cross-View Parity)',
        c.tax_year,
        `total_all_in_tax (${c.total_all_in_tax}) !== Fed+State+ERPayroll (${recomposedAllIn})`
      );
    }
  }

  // --- INVARIANT 6: Cross-View & Snapshot Parity + v3.0 JSON Round-Trip ($0 variance) ---
  const dbpHorizonEntry = horizonRowsComputed.find((x) => x.row.id === 'dbp_contribution');
  for (let i = 0; i < state.years.length; i++) {
    const yr = state.years[i];
    const c = computed[i];
    if (!c) continue;

    // 6.1 Total S-Corp gross receipts (ca_revenue + az_revenue) equals gross_receipts_revenue within $1
    if (state.setup.has_scorp) {
      const rawSplitSum = yr.scorp_1120s.ca_revenue + yr.scorp_1120s.az_revenue;
      if (Math.abs(rawSplitSum - yr.scorp_1120s.gross_receipts_revenue) > 1) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          yr.tax_year,
          `Input S-Corp ca+az (${rawSplitSum}) !== gross_receipts_revenue (${yr.scorp_1120s.gross_receipts_revenue})`
        );
      }
      const compSplitSum = c.scorp_in.ca_revenue + c.scorp_in.az_revenue;
      if (Math.abs(compSplitSum - c.scorp_in.gross_receipts_revenue) > 1) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          yr.tax_year,
          `Computed S-Corp ca+az (${compSplitSum}) !== gross_receipts_revenue (${c.scorp_in.gross_receipts_revenue})`
        );
      }
    }

    // 6.2 scorp_1120s.pte_election_active strictly matches whether any state_filing has state_pte_elected === true
    const anyStatePteElected = yr.state_filings.some((sf) => Boolean(sf.state_pte_elected));
    if (yr.scorp_1120s.pte_election_active !== anyStatePteElected) {
      pushFail(
        'Invariant 6 (Snapshot Parity)',
        yr.tax_year,
        `pte_election_active (${yr.scorp_1120s.pte_election_active}) !== state_filings.some(state_pte_elected) (${anyStatePteElected})`
      );
    }

    // 6.3 dbp_actual_contribution matches Horizon Group 3 DBP row and P&L DBP total within $1
    const horizonDbpVal = dbpHorizonEntry?.cells[i]?.numericValue ?? 0;
    const expectedDbp =
      state.setup.has_dbp && yr.dbp_and_retirement.dbp_status !== 'terminated'
        ? yr.dbp_and_retirement.dbp_actual_contribution
        : 0;
    if (Math.abs(expectedDbp - horizonDbpVal) > 1) {
      pushFail(
        'Invariant 6 (Snapshot Parity)',
        yr.tax_year,
        `DBP contribution (${expectedDbp}) !== Horizon Group 3 row (${horizonDbpVal})`
      );
    }
    if (
      !yr.is_locked_actuals &&
      Math.abs(yr.dbp_and_retirement.dbp_actual_contribution - horizonDbpVal) > 1
    ) {
      pushFail(
        'Invariant 6 (Snapshot Parity)',
        yr.tax_year,
        `Raw forecast dbp_actual_contribution (${yr.dbp_and_retirement.dbp_actual_contribution}) !== Horizon Group 3 row (${horizonDbpVal})`
      );
    }
    if (
      state.pnl_balance_sheet &&
      state.pnl_balance_sheet.projection_year === yr.tax_year &&
      !yr.is_locked_actuals &&
      !state.pnl_balance_sheet.retirement_line17_manual_overrides?.dbp_contribution
    ) {
      const pnlDbpLine = state.pnl_balance_sheet.pnl.dbp_contribution ?? { ytd: 0, remaining: 0 };
      const pnlDbpTotal = pnlDbpLine.ytd + pnlDbpLine.remaining;
      if (Math.abs(pnlDbpTotal - horizonDbpVal) > 1) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          yr.tax_year,
          `P&L dbp_contribution (${pnlDbpTotal}) !== Horizon Group 3 DBP (${horizonDbpVal})`
        );
      }
    }

    // 6.4 Forecast beginning stock basis matches prior-year ending stock basis & auto-synced K-1 matches computed OBI
    if (i >= 1 && !yr.is_locked_actuals) {
      const priorEndBasis = computed[i - 1].scorp_out.stock_basis_ending;
      if (Math.abs(yr.scorp_1120s.stock_basis_beginning - priorEndBasis) > 1) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          yr.tax_year,
          `stock_basis_beginning (${yr.scorp_1120s.stock_basis_beginning}) !== prior-year ending basis (${priorEndBasis})`
        );
      }
      if (state.setup.has_scorp && yr.scorp_1120s.auto_sync_k1) {
        if (
          Math.abs(
            yr.form_1040.schedule_k1_ordinary_income - c.scorp_out.ordinary_business_income_1120s
          ) > 1
        ) {
          pushFail(
            'Invariant 6 (Snapshot Parity)',
            yr.tax_year,
            `schedule_k1_ordinary_income (${yr.form_1040.schedule_k1_ordinary_income}) !== computed K-1 OBI (${c.scorp_out.ordinary_business_income_1120s})`
          );
        }
      }
    }
  }

  // 6.5 Exported v3.0 JSON round-trip re-import preserves all reconciled fields with $0 variance
  const snapshotProfile = {
    id: `stress-${caseId.toLowerCase()}`,
    name: state.setup.business_name || `Stress ${caseId}`,
    entity_name: state.setup.business_name || `Stress ${caseId}`,
    entity_ein: state.setup.business_ein || '',
    notes: 'Stress Snapshot Verification',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    state,
  };
  const exportedJson = serializeSingleProfileBackup(snapshotProfile);
  let rtState: PlannerState | null = null;
  try {
    const parsedSnapshot = parseAndValidateProfileSnapshot(exportedJson);
    rtState = parsedSnapshot.profiles[0]?.state ?? null;
    if (!rtState) {
      pushFail('Invariant 6 (Snapshot Parity)', 'ALL', 'v3.0 JSON snapshot round-trip returned empty profiles[]');
    }
  } catch (err) {
    pushFail(
      'Invariant 6 (Snapshot Parity)',
      'ALL',
      `v3.0 JSON snapshot round-trip parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (rtState) {
    const rtComputed = calculateSixYearPlan(rtState.setup, rtState.years);
    for (let i = 0; i < state.years.length; i++) {
      const origYr = state.years[i];
      const rtYr = rtState.years[i];
      const origC = computed[i];
      const rtC = rtComputed[i];
      if (!rtYr || !rtC) {
        pushFail('Invariant 6 (Snapshot Parity)', origYr.tax_year, 'Round-trip missing tax year');
        continue;
      }
      const rtChecks: [string, number | boolean, number | boolean][] = [
        ['gross_receipts_revenue', rtYr.scorp_1120s.gross_receipts_revenue, origYr.scorp_1120s.gross_receipts_revenue],
        ['ca_revenue', rtYr.scorp_1120s.ca_revenue, origYr.scorp_1120s.ca_revenue],
        ['az_revenue', rtYr.scorp_1120s.az_revenue, origYr.scorp_1120s.az_revenue],
        ['pte_election_active', rtYr.scorp_1120s.pte_election_active, origYr.scorp_1120s.pte_election_active],
        ['dbp_actual_contribution', rtYr.dbp_and_retirement.dbp_actual_contribution, origYr.dbp_and_retirement.dbp_actual_contribution],
        ['stock_basis_beginning', rtYr.scorp_1120s.stock_basis_beginning, origYr.scorp_1120s.stock_basis_beginning],
        ['schedule_k1_ordinary_income', rtYr.form_1040.schedule_k1_ordinary_income, origYr.form_1040.schedule_k1_ordinary_income],
        ['computed_k1_obi', rtC.scorp_out.ordinary_business_income_1120s, origC.scorp_out.ordinary_business_income_1120s],
        ['computed_ending_basis', rtC.scorp_out.stock_basis_ending, origC.scorp_out.stock_basis_ending],
        ['computed_all_in_tax', rtC.total_all_in_tax, origC.total_all_in_tax],
      ];
      for (const [field, got, expected] of rtChecks) {
        if (got !== expected) {
          pushFail(
            'Invariant 6 (Snapshot Parity)',
            origYr.tax_year,
            `v3.0 JSON round-trip drift on ${field}: got=${String(got)} expected=${String(expected)}`
          );
        }
      }
      if (origYr.state_filings.length !== rtYr.state_filings.length) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          origYr.tax_year,
          `v3.0 JSON round-trip state_filings count drift: ${rtYr.state_filings.length} !== ${origYr.state_filings.length}`
        );
      } else {
        for (let sIdx = 0; sIdx < origYr.state_filings.length; sIdx++) {
          if (
            Boolean(rtYr.state_filings[sIdx].state_pte_elected) !==
            Boolean(origYr.state_filings[sIdx].state_pte_elected)
          ) {
            pushFail(
              'Invariant 6 (Snapshot Parity)',
              origYr.tax_year,
              `v3.0 JSON round-trip state_pte_elected drift on ${origYr.state_filings[sIdx].state_code}`
            );
          }
        }
      }
    }
    if (state.pnl_balance_sheet && rtState.pnl_balance_sheet) {
      const origDbp = state.pnl_balance_sheet.pnl.dbp_contribution;
      const rtDbp = rtState.pnl_balance_sheet.pnl.dbp_contribution;
      if (origDbp.ytd !== rtDbp.ytd || origDbp.remaining !== rtDbp.remaining) {
        pushFail(
          'Invariant 6 (Snapshot Parity)',
          state.pnl_balance_sheet.projection_year,
          `v3.0 JSON round-trip P&L dbp_contribution drift: (${rtDbp.ytd},${rtDbp.remaining}) !== (${origDbp.ytd},${origDbp.remaining})`
        );
      }
    }
  }
}

// ============================================================================
// Phase 1 — 20-Case Deterministic Boundary Matrix
// ============================================================================

function runPhase1BoundaryMatrix(failures: StressTestFailure[]): number {
  const phase: StressTestFailure['phase'] = 'Phase 1 (Boundary)';
  let count = 0;

  const runCase = (
    caseId: string,
    label: string,
    state: PlannerState,
    extraAssert?: (computed: ComputedTaxYear[], push: (inv: string, yr: number | 'ALL', detail: string) => void) => void
  ) => {
    count++;
    const normalized = normalizePlannerState(state);
    const computed = calculateSixYearPlan(normalized.setup, normalized.years);
    const inputSummary = summarizeState(normalized);
    const push = (invariant: string, year: number | 'ALL', detail: string) => {
      failures.push({ caseId, phase, label, invariant, year, detail, inputSummary });
    };
    checkUniversalInvariants(caseId, phase, label, normalized, computed, failures);
    if (extraAssert) {
      extraAssert(computed, push);
    }
  };

  // B01: 2025 Golden Benchmark Parity (all 7/7 exact $0 variance)
  const baseline = createInitialBaselineState();
  runCase('B01', '2025 Golden Benchmark Parity (7/7 $0 variance)', baseline, (comp, push) => {
    const y25 = comp[0];
    const b = DEFAULT_PROFILE_SEED.verification_benchmarks_2025;
    const ca25 = y25.state_filings_out.find((s) => s.state_code === 'CA')?.state_personal_tax_liability ?? 0;
    const az25 = y25.state_filings_out.find((s) => s.state_code === 'AZ')?.state_personal_tax_liability ?? 0;
    const checks: [string, number, number][] = [
      ['K-1 Ordinary Income', y25.scorp_out.ordinary_business_income_1120s, b.k1_ordinary_income],
      ['QBI Deduction', y25.form_1040_out.qualified_business_income_deduction, b.qbi_deduction],
      ['AGI', y25.form_1040_out.adjusted_gross_income, b.agi],
      ['Taxable Income', y25.form_1040_out.taxable_income, b.taxable_income],
      ['Federal Tax', y25.form_1040_out.federal_income_tax, b.federal_tax],
      ['CA 540 Personal Tax', ca25, b.primary_state_personal_tax],
      ['AZ 140NR Personal Tax', az25, b.secondary_state_personal_tax],
    ];
    for (const [name, actual, expected] of checks) {
      if (actual !== expected) {
        push('Boundary B01 (Golden Benchmark)', 2025, `${name}: actual=${actual} !== expected=${expected}`);
      }
    }
  });

  // B02: Part-year residency move (CA -> WA mid-year) 37% CA / 63% AZ, PTE OFF
  const partYearOff = createInitialBaselineState();
  let b02Comp26: ComputedTaxYear | null = null;
  runCase('B02', 'Part-Year CA->WA Move (37% CA / 63% AZ) PTE OFF', partYearOff, (comp, push) => {
    b02Comp26 = comp[1];
    if (comp[1].scorp_out.pte_tax_paid_total !== 0) {
      push('Boundary B02', 2026, `Expected $0 PTE when PTE OFF, got ${comp[1].scorp_out.pte_tax_paid_total}`);
    }
  });

  // B03: Part-year residency move (CA -> WA mid-year) 37% CA / 63% AZ, CA + AZ PTE ON
  const partYearOnBase = createInitialBaselineState();
  const partYearOn: PlannerState = {
    ...partYearOnBase,
    setup: { ...partYearOnBase.setup, has_pte: true },
    years: partYearOnBase.years.map((yr) =>
      yr.is_locked_actuals
        ? yr
        : {
            ...yr,
            scorp_1120s: { ...yr.scorp_1120s, pte_election_active: true },
            state_filings: yr.state_filings.map((sf) => ({
              ...sf,
              state_pte_elected: sf.state_code === 'CA' || sf.state_code === 'AZ',
            })),
          }
    ),
  };
  runCase('B03', 'Part-Year CA->WA Move (37% CA / 63% AZ) CA+AZ PTE ON', partYearOn, (comp, push) => {
    if (comp[0].scorp_out.pte_tax_paid_total !== 0) {
      push('Boundary B03', 2025, 'Locked 2025 actuals must keep PTE Paid at $0');
    }
    if (comp[1].scorp_out.pte_tax_paid_total <= 0) {
      push('Boundary B03', 2026, 'Expected 2026 CA+AZ PTE Paid > $0');
    }
    if (b02Comp26) {
      if (comp[1].form_1040_out.federal_income_tax >= b02Comp26.form_1040_out.federal_income_tax) {
        push('Boundary B03', 2026, 'Expected PTE election to reduce 2026 Federal Income Tax');
      }
      if (comp[1].total_all_in_tax >= b02Comp26.total_all_in_tax) {
        push('Boundary B03', 2026, 'Expected PTE election to reduce 2026 Total All-In Tax');
      }
    }
  });

  // B04: California PTET credit exceeding personal CA tax
  const caExcessPte = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1960,
    spouseBirthYear: 1960,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: true,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: true,
    homeState: 'CA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: true,
    secondaryPteElected: false,
    grossRevenue: 240000,
    opEx: 30000,
    billW2: 40000,
    debraW2: 40000,
    nonScorpW2: 0,
  });
  runCase('B04', 'CA PTET Credit Exceeding Personal CA Tax', caExcessPte, (comp, push) => {
    const ca26 = comp[1].state_filings_out.find((s) => s.state_code === 'CA');
    if (!ca26 || ca26.state_pte_payment_amount <= 0) {
      push('Boundary B04', 2026, 'CA PTE payment must be > $0');
    } else if (ca26.state_personal_tax_liability >= 0) {
      push(
        'Boundary B04',
        2026,
        `Expected negative CA Net Personal State Tax (excess PTE credit), got ${ca26.state_personal_tax_liability}`
      );
    }
  });

  // B05: Arizona PTE credit exceeding personal AZ tax alongside OSTC interaction
  const azOstcPte = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1960,
    spouseBirthYear: 1960,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: true,
    homeState: 'CA',
    secondaryState: 'AZ',
    multiState: true,
    primarySplitPct: 35,
    primaryResidency: 'part_year_resident',
    primaryResidencyRatio: 0.5,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: true,
    grossRevenue: 300000,
    opEx: 40000,
    billW2: 35000,
    debraW2: 35000,
    nonScorpW2: 0,
  });
  runCase('B05', 'AZ PTE Credit Exceeding Personal AZ Tax + Form 309 OSTC', azOstcPte, (comp, push) => {
    const az26 = comp[1].state_filings_out.find((s) => s.state_code === 'AZ');
    if (!az26 || az26.state_pte_payment_amount <= 0 || az26.credit_for_taxes_paid_to_other_states <= 0) {
      push('Boundary B05', 2026, 'Expected both AZ PTE payment > 0 and AZ Form 309 OSTC > 0');
    } else if (az26.state_personal_tax_liability >= 0) {
      push(
        'Boundary B05',
        2026,
        `Expected negative AZ Net Personal State Tax (refundable excess PTE credit), got ${az26.state_personal_tax_liability}`
      );
    }
  });

  // B06: 100% Washington (0% state income tax) resident with PTE toggled ON
  const waPte = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1962,
    spouseBirthYear: 1963,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: true,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: true,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: true,
    secondaryPteElected: false,
    grossRevenue: 350000,
    opEx: 50000,
    billW2: 60000,
    debraW2: 60000,
    nonScorpW2: 0,
  });
  runCase('B06', '100% WA Resident (0% State Tax) with PTE Toggled ON', waPte, (comp, push) => {
    for (const c of comp) {
      if (c.scorp_out.pte_tax_paid_total !== 0 || c.total_state_tax !== 0) {
        push('Boundary B06', c.tax_year, `Expected $0 PTE and $0 state tax for WA, got PTE=${c.scorp_out.pte_tax_paid_total} State=${c.total_state_tax}`);
      }
    }
  });

  // B07: Stock basis exhaustion (Beg=$5,000, K-1=$20,000, Draws=$45,000 -> End=$0, Excess Cap Gain=$20,000)
  // Craft revenue & OpEx with $0 W-2/SEHI/payroll so K-1 === $20,000 exactly in 2025
  const basisExhaust = buildSyntheticState({
    filingStatus: 'single',
    primaryBirthYear: 1970,
    spouseBirthYear: null,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 50000,
    opEx: 30000,
    billW2: 0,
    debraW2: 0,
    nonScorpW2: 0,
    stockBasisBeg: 5000,
    draws: 45000,
  });
  runCase('B07', 'Stock Basis Exhaustion ($5k Beg + $20k K-1 - $45k Draws -> $20k Excess Cap Gain)', basisExhaust, (comp, push) => {
    const y0 = comp[0];
    if (
      y0.scorp_out.ordinary_business_income_1120s !== 20000 ||
      y0.scorp_out.stock_basis_ending !== 0 ||
      y0.scorp_out.excess_distribution_capital_gain !== 20000
    ) {
      push(
        'Boundary B07',
        y0.tax_year,
        `Expected K1=20000 EndBasis=0 ExcessCapGain=20000; got K1=${y0.scorp_out.ordinary_business_income_1120s} EndBasis=${y0.scorp_out.stock_basis_ending} ExcessCapGain=${y0.scorp_out.excess_distribution_capital_gain}`
      );
    }
  });

  // B08: S-Corp Operating Loss Year (Gross Revenue=$40,000, OpEx=$75,000)
  const scorpLoss = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1968,
    spouseBirthYear: 1970,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'CA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 40000,
    opEx: 75000,
    billW2: 0,
    debraW2: 0,
    nonScorpW2: 0,
    stockBasisBeg: 15000,
    draws: 0,
  });
  runCase('B08', 'S-Corp Operating Loss Year ($40k Rev, $75k OpEx)', scorpLoss, (comp, push) => {
    const y0 = comp[0];
    if (y0.scorp_out.ordinary_business_income_1120s !== -35000) {
      push('Boundary B08', y0.tax_year, `Expected K-1 loss -35000, got ${y0.scorp_out.ordinary_business_income_1120s}`);
    }
    if (y0.scorp_out.stock_basis_ending !== 0) {
      push('Boundary B08', y0.tax_year, `Expected basis floored at 0 on $35k loss vs $15k basis, got ${y0.scorp_out.stock_basis_ending}`);
    }
  });

  // B09: DBP Year-10 Termination Transition ($140k -> $73k -> $0) + IRC §415(b) High-3 check
  const dbpState = createInitialBaselineState();
  dbpState.setup.dbp_planned_termination_year = 2027;
  dbpState.years = dbpState.years.map((yr) => {
    if (yr.tax_year === 2025) return yr;
    if (yr.tax_year === 2026) {
      return {
        ...yr,
        dbp_and_retirement: { ...yr.dbp_and_retirement, dbp_status: 'active', dbp_actual_contribution: 73000 },
      };
    }
    if (yr.tax_year === 2027) {
      return {
        ...yr,
        dbp_and_retirement: { ...yr.dbp_and_retirement, dbp_status: 'terminating', dbp_actual_contribution: 0 },
      };
    }
    return {
      ...yr,
      dbp_and_retirement: { ...yr.dbp_and_retirement, dbp_status: 'terminated', dbp_actual_contribution: 0 },
    };
  });
  runCase('B09', 'DBP Year-10 Termination ($140k -> $73k -> $0) & §415(b) Actuarial Check', dbpState, (comp, push) => {
    const waterfall = computeDbpActuarialWaterfall(dbpState.setup, dbpState.years, comp);
    const badRow = waterfall.rows.find(
      (r) => !Number.isFinite(r.rollingHigh3) || r.rollingHigh3 <= 0 || !Number.isFinite(r.statutoryCeiling)
    );
    if (badRow) {
      push('Boundary B09', badRow.taxYear, `Invalid §415(b) actuarial row: rollingHigh3=${badRow.rollingHigh3} ceiling=${badRow.statutoryCeiling}`);
    }
    const y25 = comp.find((c) => c.tax_year === 2025)!;
    const y26 = comp.find((c) => c.tax_year === 2026)!;
    const y28 = comp.find((c) => c.tax_year === 2028)!;
    if (y25.dbp_in.dbp_actual_contribution !== 140000 || y26.dbp_in.dbp_actual_contribution !== 73000) {
      push('Boundary B09', 2026, `Expected DBP transition 140k -> 73k, got ${y25.dbp_in.dbp_actual_contribution} -> ${y26.dbp_in.dbp_actual_contribution}`);
    }
    if (y28.dbp_in.dbp_actual_contribution !== 0) {
      push('Boundary B09', 2028, `Terminated DBP year 2028 must have $0 contribution, got ${y28.dbp_in.dbp_actual_contribution}`);
    }
  });

  // B10 & B11: IRMAA Cliff Boundary ($1 below vs $1 above MFJ 2028 threshold $231,000 in 2026)
  const { thresholds: t2028 } = computeIrmaaBracketThresholds(2028, baseline.setup);
  const cliff2028 = t2028[0]; // $231,000
  const base26Magi = calculateSixYearPlan(baseline.setup, baseline.years)[1].form_1040_out.adjusted_gross_income;

  const makeIrmaaState = (target2026Magi: number): PlannerState => {
    const st = createInitialBaselineState();
    st.setup.primary_profile!.medicare.enrolled = true;
    st.setup.spouse_profile!.medicare.enrolled = true;
    st.setup.primary_profile!.medicare.part_b_monthly = 185;
    st.setup.spouse_profile!.medicare.part_b_monthly = 185;
    const baseRun = calculateSixYearPlan(st.setup, st.years);
    const diff = baseRun[1].form_1040_out.adjusted_gross_income - target2026Magi;
    st.years = st.years.map((y) =>
      y.tax_year === 2026
        ? { ...y, scorp_1120s: { ...y.scorp_1120s, operating_expenses: Math.max(0, y.scorp_1120s.operating_expenses + diff) } }
        : y
    );
    return st;
  };
  void base26Magi;

  const irmaaBelow = makeIrmaaState(cliff2028 - 1);
  runCase('B10', `IRMAA Cliff Boundary ($1 Below $${cliff2028} in 2026)`, irmaaBelow, (comp, push) => {
    const y28 = comp.find((c) => c.tax_year === 2028)!;
    if (y28.form_1040_out.irmaa_annual_surcharge !== 0) {
      push('Boundary B10', 2028, `Expected $0 IRMAA at $1 below threshold, got ${y28.form_1040_out.irmaa_annual_surcharge}`);
    }
    const ms = calculateMarginalTaxSavings(irmaaBelow, 2026, 1000, comp)!;
    if (!ms.irmaaProximity.withinWindow || !ms.irmaaProximity.isBelow) {
      push('Boundary B10', 2026, 'Expected IRMAA proximity warning (below threshold) within $2,500');
    }
  });

  const irmaaAbove = makeIrmaaState(cliff2028 + 1);
  runCase('B11', `IRMAA Cliff Boundary ($1 Above $${cliff2028} in 2026) + Marginal Cliff Detection`, irmaaAbove, (comp, push) => {
    const y28 = comp.find((c) => c.tax_year === 2028)!;
    if (y28.form_1040_out.irmaa_annual_surcharge <= 0) {
      push('Boundary B11', 2028, `Expected > $0 IRMAA at $1 above threshold, got ${y28.form_1040_out.irmaa_annual_surcharge}`);
    }
    const ms = calculateMarginalTaxSavings(irmaaAbove, 2026, 1000, comp)!;
    if (!ms.irmaaCliffBonus.triggered || ms.irmaaCliffBonus.dollarValue <= 0) {
      push('Boundary B11', 2026, `Expected calculateMarginalTaxSavings to detect IRMAA cliff bonus, got ${JSON.stringify(ms.irmaaCliffBonus)}`);
    }
  });

  // B12: Age 64 -> 65 transition (born 1962) & 2028 -> 2029 Enhanced Senior Deduction sunset cliff
  const age64to65 = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1962, // Age 64 in 2026, 65 in 2027, 66 in 2028, 67 in 2029
    spouseBirthYear: 1962,
    entityType: 'none',
    hasScorp: false,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 0,
    opEx: 0,
    billW2: 0,
    debraW2: 0,
    nonScorpW2: 120000,
  });
  runCase('B12', 'Age 64->65 Transition & 2028->2029 Enhanced Senior Deduction Sunset', age64to65, (comp, push) => {
    const y26 = comp.find((c) => c.tax_year === 2026)!;
    const y27 = comp.find((c) => c.tax_year === 2027)!;
    const y28 = comp.find((c) => c.tax_year === 2028)!;
    const y29 = comp.find((c) => c.tax_year === 2029)!;
    if (y26.form_1040_out.enhanced_senior_deduction_allowed !== 0) {
      push('Boundary B12', 2026, `Age 64 must have $0 Enhanced Senior Deduction, got ${y26.form_1040_out.enhanced_senior_deduction_allowed}`);
    }
    if (y27.form_1040_out.enhanced_senior_deduction_allowed !== 12000) {
      push('Boundary B12', 2027, `Age 65 MFJ below $150k must unlock $12,000 Enhanced Senior Deduction, got ${y27.form_1040_out.enhanced_senior_deduction_allowed}`);
    }
    if (y28.form_1040_out.enhanced_senior_deduction_allowed !== 12000) {
      push('Boundary B12', 2028, `Expected $12,000 Enhanced Senior Deduction in 2028, got ${y28.form_1040_out.enhanced_senior_deduction_allowed}`);
    }
    if (y29.form_1040_out.enhanced_senior_deduction_allowed !== 0) {
      push('Boundary B12', 2029, `Enhanced Senior Deduction must sunset to $0 in 2029, got ${y29.form_1040_out.enhanced_senior_deduction_allowed}`);
    }
  });

  // B13: QBI Phase-Out Threshold Boundary — Non-SSTB above MFJ threshold (W-2 50% wage limit)
  const qbiNonSstb = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1972,
    spouseBirthYear: 1973,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 700000,
    opEx: 50000,
    billW2: 120000,
    debraW2: 80000,
    nonScorpW2: 0,
  });
  runCase('B13', 'QBI Phase-Out Boundary (High-Income Non-SSTB W-2 50% Limit)', qbiNonSstb, (comp, push) => {
    const y26 = comp[1];
    const uncappedQbi = Math.round(y26.scorp_out.ordinary_business_income_1120s * 0.2);
    if (y26.form_1040_out.qualified_business_income_deduction <= 0 || y26.form_1040_out.qualified_business_income_deduction > uncappedQbi) {
      push('Boundary B13', 2026, `Unexpected QBI=${y26.form_1040_out.qualified_business_income_deduction} vs uncapped=${uncappedQbi}`);
    }
  });

  // B14: QBI Phase-Out Threshold Boundary — Low-W2 High-Income (W-2 cap binds cleanly)
  const qbiLowW2 = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1972,
    spouseBirthYear: 1973,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 650000,
    opEx: 50000,
    billW2: 20000,
    debraW2: 0,
    nonScorpW2: 0,
  });
  runCase('B14', 'QBI Phase-Out Boundary (High-Income Low-W2 Cap Binding)', qbiLowW2, (comp, push) => {
    const y26 = comp[1];
    const w2Cap = Math.round(y26.scorp_in.officer_w2_wages * 0.5);
    if (y26.form_1040_out.qualified_business_income_deduction > w2Cap) {
      push(
        'Boundary B14',
        2026,
        `Above QBI phase-out ceiling, QBI (${y26.form_1040_out.qualified_business_income_deduction}) exceeded 50% W-2 cap (${w2Cap})`
      );
    }
  });

  // B15: Sole Prop / Single-Member LLC vs S-Corp Entity Mode Switch
  const soleProp = buildSyntheticState({
    filingStatus: 'single',
    primaryBirthYear: 1975,
    spouseBirthYear: null,
    entityType: 'sole_prop',
    hasScorp: false,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: true, // Intentionally left true to verify zero S-Corp PTE/basis leakage in Sole Prop mode
    homeState: 'CA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: true,
    secondaryPteElected: false,
    grossRevenue: 180000,
    opEx: 30000,
    billW2: 0,
    debraW2: 0,
    nonScorpW2: 0,
    sched1OtherIncome: 150000,
    stockBasisBeg: 25000,
    draws: 50000,
  });
  const scorpTwin = buildSyntheticState({
    filingStatus: 'single',
    primaryBirthYear: 1975,
    spouseBirthYear: null,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'CA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 180000,
    opEx: 30000,
    billW2: 60000,
    debraW2: 0,
    nonScorpW2: 0,
    stockBasisBeg: 25000,
    draws: 50000,
  });
  runCase('B15', 'Sole Prop / Single-Member LLC vs S-Corp Mode (SE Tax vs FICA & Zero Leakage)', soleProp, (comp, push) => {
    const y26 = comp[1];
    const scorpComp = calculateSixYearPlan(scorpTwin.setup, scorpTwin.years)[1];
    if (y26.scorp_out.pte_tax_paid_total !== 0) {
      push('Boundary B15', 2026, `Sole Prop leaked S-Corp PTE: ${y26.scorp_out.pte_tax_paid_total}`);
    }
    if (y26.scorp_out.excess_distribution_capital_gain !== 0 || y26.scorp_out.ordinary_business_income_1120s !== 0) {
      push('Boundary B15', 2026, 'Sole Prop leaked S-Corp K-1 or excess distribution cap gain');
    }
    if (y26.state_filings_out[0].state_entity_tax_liability !== 0) {
      push('Boundary B15', 2026, `Sole Prop leaked CA Form 100S entity tax: ${y26.state_filings_out[0].state_entity_tax_liability}`);
    }
    if (y26.scorp_out.employer_payroll_taxes !== 0 || y26.form_1040_out.personal_fica_tax !== 0) {
      push('Boundary B15', 2026, 'Sole Prop with $0 W-2 should have $0 employer/personal W-2 FICA');
    }
    if (y26.form_1040_out.adjustments_to_income <= 0) {
      push('Boundary B15', 2026, 'Sole Prop with $150k profit should claim 1/2 SE tax above-the-line deduction');
    }
    const solePropFedPlusFica = y26.form_1040_out.federal_income_tax;
    const scorpFedPlusFica =
      scorpComp.form_1040_out.federal_income_tax +
      scorpComp.form_1040_out.personal_fica_tax +
      scorpComp.scorp_out.employer_payroll_taxes;
    if (solePropFedPlusFica <= scorpFedPlusFica) {
      push(
        'Boundary B15',
        2026,
        `Expected Sole Prop SE tax (${solePropFedPlusFica}) to exceed S-Corp Fed+FICA (${scorpFedPlusFica}) on $150k profit`
      );
    }
  });

  // B16: Single vs MFJ Filing Status Switch
  const mfjSwitch = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1972,
    spouseBirthYear: 1972,
    entityType: 'none',
    hasScorp: false,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'CA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 0,
    opEx: 0,
    billW2: 0,
    debraW2: 0,
    nonScorpW2: 180000,
  });
  const singleSwitch = buildSyntheticState({
    ...{
      filingStatus: 'single',
      primaryBirthYear: 1972,
      spouseBirthYear: null,
      entityType: 'none',
      hasScorp: false,
      hasDbp: false,
      has401k: false,
      hasSsMedicare: false,
      medicareEnrolled: false,
      hasPte: false,
      homeState: 'CA',
      secondaryState: '',
      multiState: false,
      primarySplitPct: 100,
      primaryResidency: 'resident',
      primaryResidencyRatio: 1,
      secondaryResidency: 'non_resident',
      primaryPteElected: false,
      secondaryPteElected: false,
      grossRevenue: 0,
      opEx: 0,
      billW2: 0,
      debraW2: 0,
      nonScorpW2: 180000,
    },
  });
  const mfjComp = calculateSixYearPlan(mfjSwitch.setup, mfjSwitch.years);
  runCase('B16', 'Single vs MFJ Filing Status Switch', singleSwitch, (comp, push) => {
    if (comp[1].form_1040_out.federal_income_tax <= mfjComp[1].form_1040_out.federal_income_tax) {
      push('Boundary B16', 2026, 'Expected Single filer to owe higher federal tax than MFJ on identical $180k wages');
    }
    if (comp[1].form_1040_out.deduction_amount >= mfjComp[1].form_1040_out.deduction_amount) {
      push('Boundary B16', 2026, 'Expected Single standard deduction < MFJ standard deduction');
    }
  });

  // B17: Zero-Income / Blank User Profile
  const blankRecord = buildFreshBlankUserRecord();
  runCase('B17', 'Zero-Income / Blank User Profile ($0 All Inputs)', blankRecord.state, (comp, push) => {
    for (const c of comp) {
      if (
        c.form_1040_out.federal_income_tax !== 0 ||
        c.total_state_tax !== 0 ||
        c.total_all_in_tax !== 0 ||
        c.all_in_effective_rate !== 0
      ) {
        push('Boundary B17', c.tax_year, `Expected $0 taxes on Blank User, got allIn=${c.total_all_in_tax}`);
      }
    }
  });

  // B18 & B19: High-W2 Social Security Wage Base Cap ($260k Single Spouse vs Split $130k/$130k MFJ)
  const highW2OneSpouse = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1974,
    spouseBirthYear: 1974,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 400000,
    opEx: 40000,
    billW2: 260000,
    debraW2: 0,
    nonScorpW2: 0,
  });
  let oneSpouseFica26 = 0;
  runCase('B18', 'High-W2 SS Wage Base Cap ($260k One Spouse)', highW2OneSpouse, (comp, push) => {
    oneSpouseFica26 = comp[1].form_1040_out.personal_fica_tax;
    if (oneSpouseFica26 <= 0) {
      push('Boundary B18', 2026, 'Expected positive FICA on $260k W-2');
    }
  });

  const highW2TwoSpouses = buildSyntheticState({
    filingStatus: 'married_filing_jointly',
    primaryBirthYear: 1974,
    spouseBirthYear: 1974,
    entityType: 'scorp_llc',
    hasScorp: true,
    hasDbp: false,
    has401k: false,
    hasSsMedicare: false,
    medicareEnrolled: false,
    hasPte: false,
    homeState: 'WA',
    secondaryState: '',
    multiState: false,
    primarySplitPct: 100,
    primaryResidency: 'resident',
    primaryResidencyRatio: 1,
    secondaryResidency: 'non_resident',
    primaryPteElected: false,
    secondaryPteElected: false,
    grossRevenue: 400000,
    opEx: 40000,
    billW2: 130000,
    debraW2: 130000,
    nonScorpW2: 0,
  });
  runCase('B19', 'High-W2 SS Wage Base Cap ($130k/$130k Two Spouses MFJ)', highW2TwoSpouses, (comp, push) => {
    const twoSpouseFica26 = comp[1].form_1040_out.personal_fica_tax;
    if (twoSpouseFica26 <= oneSpouseFica26) {
      push(
        'Boundary B19',
        2026,
        `Expected split $130k/$130k FICA (${twoSpouseFica26}) > single-earner $260k FICA (${oneSpouseFica26}) due to per-person SS wage base cap`
      );
    }
  });

  // B20: Workspace & New-Profile Seed Isolation (My Profile, Test Persona, Blank User, Modal New Profiles)
  const testPersona = buildFreshTestPersonaRecord();
  runCase('B20', 'Workspace & New-Profile Seed Isolation (Test Persona + Modal Profiles)', testPersona.state, (_comp, push) => {
    if (!isDefaultSeedSetup(baseline.setup)) {
      push('Boundary B20', 'ALL', 'My Profile must be recognized as default seed');
    }
    if (isDefaultSeedSetup(testPersona.state.setup) || isDefaultSeedSetup(blankRecord.state.setup)) {
      push('Boundary B20', 'ALL', 'Test Persona / Blank User must NOT be recognized as default seed');
    }
    const created = createProfileRecord({
      name: 'Stress QA Client',
      filing_status: 'married_filing_jointly',
      primary_name: 'Morgan',
      spouse_name: 'Riley',
      tax_year: 2026,
      entity_type: 'scorp_llc',
      entity_name: '',
      entity_ein: '',
      entity_website: '',
      template: 'sample_oss',
      modules: {
        has_scorp: true,
        has_ss_medicare: true,
        has_dbp: false,
        multi_state_active: false,
        has_stock_basis: true,
      },
    });
    const serialized = JSON.stringify(created).toLowerCase();
    for (const forbidden of ['operating support services', 'ossadvisorygroup.com', '83-1706286', '00-0000000']) {
      if (serialized.includes(forbidden)) {
        push('Boundary B20', 'ALL', `Seed leakage detected in new profile: "${forbidden}"`);
      }
    }
    if (
      created.state.setup.business_name !== '' ||
      created.state.setup.business_website !== '' ||
      created.state.setup.business_ein !== ''
    ) {
      push('Boundary B20', 'ALL', 'Omitted modal business fields must stay empty');
    }

    // V3 #4 Snapshot Export -> Mutate -> Re-Import Round-Trip Parity & Validation
    const store0 = loadMultiProfileStore();
    const myProfile = store0.profiles[0];
    const origComputed = calculateSixYearPlan(myProfile.state.setup, myProfile.state.years);
    const origCpa = buildCpaHorizonSummary(myProfile.state.setup, origComputed);

    // 1. Export V3 JSON envelope & check filename formatting (zero hardcoded fallbacks)
    const snapshotJson = serializeSingleProfileBackup(myProfile, '2026-11-26T08:30:00.000Z');
    const envelope = JSON.parse(snapshotJson) as Record<string, unknown>;
    if (
      envelope.schemaVersion !== PROFILE_SNAPSHOT_SCHEMA_VERSION ||
      envelope.app !== PROFILE_SNAPSHOT_APP_ID ||
      envelope.exportedAt !== '2026-11-26T08:30:00.000Z' ||
      !envelope.profile
    ) {
      push('Boundary B20', 'ALL', 'V3 snapshot envelope missing required schemaVersion/app/exportedAt/profile fields');
    }
    const neutralFile = buildProfileSnapshotFilename({ name: '', entity_name: '' }, new Date(2026, 10, 26));
    if (neutralFile !== 'tax-profile-snapshot-2026-11-26.json') {
      push('Boundary B20', 'ALL', `Unexpected neutral snapshot filename: ${neutralFile}`);
    }
    const namedFile = buildProfileSnapshotFilename(
      { name: 'Operating Support Services, LLC', entity_name: '' },
      new Date(2026, 10, 26)
    );
    if (namedFile !== 'operating-support-services-llc-snapshot-2026-11-26.json') {
      push('Boundary B20', 'ALL', `Unexpected named snapshot filename: ${namedFile}`);
    }

    // 2. Mutate My Profile on the Six-Year Horizon (2026 OpEx + PTE + Group 6 payment) and verify numbers change
    const mutatedStore = {
      ...store0,
      profiles: store0.profiles.map((p, idx) =>
        idx !== 0
          ? p
          : {
              ...p,
              state: {
                ...p.state,
                years: p.state.years.map((y) =>
                  y.tax_year !== 2026
                    ? y
                    : {
                        ...y,
                        scorp_1120s: {
                          ...y.scorp_1120s,
                          operating_expenses: y.scorp_1120s.operating_expenses + 25000,
                          operating_expenses_override: y.scorp_1120s.operating_expenses + 25000,
                          pte_election_active: true,
                        },
                        form_1040: {
                          ...y.form_1040,
                          federal_estimated_tax_payments:
                            (y.form_1040.federal_estimated_tax_payments ?? 0) + 12345,
                        },
                        state_filings: y.state_filings.map((sf) => ({
                          ...sf,
                          state_pte_elected: true,
                        })),
                      }
                ),
              },
            }
      ),
    };
    const mutatedComputed = calculateSixYearPlan(
      mutatedStore.profiles[0].state.setup,
      mutatedStore.profiles[0].state.years
    );
    if (mutatedComputed[1].total_all_in_tax === origComputed[1].total_all_in_tax) {
      push('Boundary B20', 2026, 'Expected mutated 2026 horizon to diverge from original snapshot');
    }

    // 3. Re-import as New Profile (must mint unique ID, leave mutated original untouched, and restore $0 variance)
    const parsedSnap = parseAndValidateProfileSnapshot(snapshotJson);
    const asNew = applyImportedSnapshotToStore(parsedSnap, mutatedStore, 'new_profile');
    if (asNew.nextStore.profiles.length !== mutatedStore.profiles.length + 1) {
      push('Boundary B20', 'ALL', 'Import as New Profile did not append a new profile cleanly');
    }
    const newImported = asNew.nextStore.profiles.find((p) => p.id === asNew.nextStore.active_profile_id)!;
    if (newImported.id === myProfile.id) {
      push('Boundary B20', 'ALL', 'Import as New Profile reused existing profile ID instead of minting unique ID');
    }

    // 4. Re-import via Overwrite Active Profile and assert exact $0 variance across all 6 years & CPA export
    const asOverwrite = applyImportedSnapshotToStore(
      parsedSnap,
      mutatedStore,
      'overwrite_active',
      mutatedStore.profiles[0].id
    );
    const restored = asOverwrite.nextStore.profiles[0];
    if (restored.id !== myProfile.id) {
      push('Boundary B20', 'ALL', 'Overwrite Active Profile did not preserve target profile ID');
    }
    const restoredComputed = calculateSixYearPlan(restored.state.setup, restored.state.years);
    const restoredCpa = buildCpaHorizonSummary(restored.state.setup, restoredComputed);
    for (let i = 0; i < origComputed.length; i++) {
      if (
        restoredComputed[i].form_1040_out.adjusted_gross_income !==
          origComputed[i].form_1040_out.adjusted_gross_income ||
        restoredComputed[i].form_1040_out.federal_income_tax !==
          origComputed[i].form_1040_out.federal_income_tax ||
        restoredComputed[i].total_state_tax !== origComputed[i].total_state_tax ||
        restoredComputed[i].total_all_in_tax !== origComputed[i].total_all_in_tax ||
        restoredComputed[i].scorp_out.ordinary_business_income_1120s !==
          origComputed[i].scorp_out.ordinary_business_income_1120s
      ) {
        push(
          'Boundary B20',
          origComputed[i].tax_year,
          `Snapshot round-trip variance detected: restored allIn=${restoredComputed[i].total_all_in_tax} vs orig=${origComputed[i].total_all_in_tax}`
        );
      }
    }
    if (restoredCpa.sixYearAllInTax !== origCpa.sixYearAllInTax) {
      push('Boundary B20', 'ALL', 'Snapshot round-trip CPA summary 6-yr tax mismatch');
    }

    // 5. Validation checks (malformed JSON, incompatible app, partial V3 keys migration with zero NaNs)
    let threwMalformed = false;
    try {
      parseAndValidateProfileSnapshot('{bad json');
    } catch {
      threwMalformed = true;
    }
    if (!threwMalformed) {
      push('Boundary B20', 'ALL', 'Malformed JSON snapshot failed to throw validation error');
    }

    let threwWrongApp = false;
    try {
      parseAndValidateProfileSnapshot(
        JSON.stringify({ schemaVersion: '3.0', app: 'other-app', profile: myProfile })
      );
    } catch {
      threwWrongApp = true;
    }
    if (!threwWrongApp) {
      push('Boundary B20', 'ALL', 'Wrong app ID snapshot failed to throw validation error');
    }

    // Partial legacy snapshot missing optional V3 keys (PTE flags, Group 6 split fields, cadence_forecaster)
    const partialProfile = JSON.parse(JSON.stringify(created)) as Record<string, unknown>;
    const partialState = partialProfile.state as Record<string, unknown>;
    delete partialState.cadence_forecaster;
    delete partialState.guardrail_acknowledgments;
    const partialYears = partialState.years as Array<Record<string, Record<string, unknown>>>;
    for (const y of partialYears) {
      delete y.scorp_1120s.pte_election_active;
      delete y.form_1040.federal_estimated_tax_payments;
      const sfs = y.state_filings as unknown as Array<Record<string, unknown>>;
      for (const sf of sfs) {
        delete sf.state_pte_elected;
        sf.other_state_credits_claimed = null;
      }
    }
    const migratedParsed = parseAndValidateProfileSnapshot(
      JSON.stringify({
        schemaVersion: '2.0',
        app: 'rolling-tax-planner',
        profile: partialProfile,
      })
    );
    const migratedComp = calculateSixYearPlan(
      migratedParsed.profiles[0].state.setup,
      migratedParsed.profiles[0].state.years
    );
    const corruptPartial: string[] = [];
    scanForCorruptNumbers(migratedComp, 'migratedPartial', corruptPartial);
    if (corruptPartial.length > 0) {
      push('Boundary B20', 'ALL', `Partial V3 migration produced corrupt numbers: ${corruptPartial[0]}`);
    }

    // 6. End-to-End 2026 S-Corp Revenue & CA/AZ Split Reconciliation (Cadence Push -> Horizon Group 1 -> CPA Sec 1 & Sec 4)
    const revScenarios = [
      { label: '344k-exact', caYtd: 100000.0, caRem: 26922.85, azYtd: 170000.0, azRem: 47484.83, centCarry: false }, // $126,922.85 CA + $217,484.83 AZ = $344,407.68
      { label: '346k-exact', caYtd: 101000.0, caRem: 26521.2, azYtd: 171000.0, azRem: 47506.51, centCarry: false }, // $127,521.20 CA + $218,506.51 AZ = $346,027.71
      { label: '346k-carry', caYtd: 101000.0, caRem: 26521.4, azYtd: 171000.0, azRem: 47506.31, centCarry: true }, // $127,521.40 CA + $218,506.31 AZ = $346,027.71 (.40+.31=.71 cent carry)
    ];
    const rowTotalRev = MASTER_SCHEDULE_CATALOG.find((r) => r.id === 'scorp_gross_revenue')!;
    const rowCaRev = MASTER_SCHEDULE_CATALOG.find((r) => r.id === 'ca_scorp_revenue')!;
    const rowAzRev = MASTER_SCHEDULE_CATALOG.find((r) => r.id === 'az_scorp_revenue')!;

    for (const sc of revScenarios) {
      const basePushState = createInitialBaselineState();
      const baseComp = calculateSixYearPlan(basePushState.setup, basePushState.years);
      const y25Base = baseComp[0];
      const y26Base = baseComp[1];
      const seedPnl = createInitialPnlBalanceSheetState(
        basePushState.years[1],
        y25Base.scorp_out.stock_basis_ending,
        basePushState.setup
      );
      const cadencePnlState = {
        ...seedPnl,
        last_pushed_at: '2026-11-26T09:00:00.000Z',
        pnl: {
          ...seedPnl.pnl,
          ca_revenue: { ytd: sc.caYtd, remaining: sc.caRem },
          az_revenue: { ytd: sc.azYtd, remaining: sc.azRem },
        },
      };
      const cadencePnlComp = calculatePnlBalanceSheet(
        cadencePnlState,
        y25Base,
        y26Base,
        basePushState.setup,
        { respectStateRetirementRemaining: true }
      );
      const targetTotal = Math.round(cadencePnlComp.totalRevenue.projected);
      const targetCa = Math.min(targetTotal, Math.round(cadencePnlComp.lines.ca_revenue.projected));
      const targetAz = Math.max(0, targetTotal - targetCa);
      const pushedPct = Math.round((targetCa / targetTotal) * 1000) / 10;
      const pushedSetup = setYearStateApportionmentOverride(basePushState.setup, 2026, pushedPct);
      const pushedYears = basePushState.years.map((yr) =>
        yr.tax_year !== 2026
          ? yr
          : {
              ...yr,
              scorp_1120s: {
                ...yr.scorp_1120s,
                ca_revenue: targetCa,
                az_revenue: targetAz,
                gross_receipts_revenue: targetTotal,
              },
              state_filings: yr.state_filings.map((sf) =>
                sf.state_code === 'CA'
                  ? { ...sf, state_apportionment_factor: targetCa / targetTotal }
                  : sf.state_code === 'AZ'
                  ? { ...sf, state_apportionment_factor: targetAz / targetTotal }
                  : sf
              ),
            }
      );
      const pushedComp = calculateSixYearPlan(pushedSetup, pushedYears);
      const y26Pushed = pushedComp.find((c) => c.tax_year === 2026)!;
      const hTotal = rowTotalRev.computeCell(y26Pushed, 1, pushedComp, pushedSetup).numericValue;
      const hCa = rowCaRev.computeCell(y26Pushed, 1, pushedComp, pushedSetup).numericValue;
      const hAz = rowAzRev.computeCell(y26Pushed, 1, pushedComp, pushedSetup).numericValue;

      const syncedHorizonPnl = reconcilePnlStateToHorizonRevenue(cadencePnlState, y26Pushed);
      const cpaSec1 = calculatePnlBalanceSheet(
        syncedHorizonPnl,
        pushedComp[0],
        y26Pushed,
        pushedSetup,
        { respectStateRetirementRemaining: true }
      );
      const cpaSec4 = buildCpaHorizonSummary(pushedSetup, pushedComp);
      const sec4Rev26 = cpaSec4.rows
        .find((r) => r.id === 'gross_receipts')!
        .cells.find((c) => c.taxYear === 2026)!.numericValue;
      const recon = computePnlVsHorizonReconciliation(
        syncedHorizonPnl,
        cpaSec1,
        pushedComp,
        pushedSetup
      )!;
      const grossMismatch = recon.mismatchedLines.find((m) => m.label === 'Gross Receipts');
      const subLineTol = sc.centCarry ? 1 : 0;

      if (
        hTotal !== targetTotal ||
        hCa !== targetCa ||
        hAz !== targetAz ||
        hCa + hAz !== hTotal ||
        Math.round(cpaSec1.totalRevenue.projected) !== targetTotal ||
        Math.abs(Math.round(cpaSec1.lines.ca_revenue.projected) - targetCa) > subLineTol ||
        Math.abs(Math.round(cpaSec1.lines.az_revenue.projected) - targetAz) > subLineTol ||
        sec4Rev26 !== targetTotal ||
        grossMismatch
      ) {
        push(
          'Boundary B20',
          2026,
          `2026 revenue reconciliation drift (${sc.label}): target=${targetCa}+${targetAz}=${targetTotal}, horizon=${hCa}+${hAz}=${hTotal}, sec1=${cpaSec1.lines.ca_revenue.projected}+${cpaSec1.lines.az_revenue.projected}=${cpaSec1.totalRevenue.projected}, sec4=${sec4Rev26}`
        );
      }

      // Stale pnl_balance_sheet ($344,407.68) opened from Horizon ($346,028) must auto-sync to $0 variance
      const stalePnl = {
        ...cadencePnlState,
        pnl: {
          ...cadencePnlState.pnl,
          ca_revenue: { ytd: 100000, remaining: 26922.85 },
          az_revenue: { ytd: 170000, remaining: 47484.83 },
        },
      };
      const autoSynced = reconcilePnlStateToHorizonRevenue(stalePnl, y26Pushed);
      const autoSec1 = calculatePnlBalanceSheet(autoSynced, pushedComp[0], y26Pushed, pushedSetup, {
        respectStateRetirementRemaining: true,
      });
      if (
        Math.round(autoSec1.totalRevenue.projected) !== hTotal ||
        Math.round(autoSec1.lines.ca_revenue.projected) !== hCa ||
        Math.round(autoSec1.lines.az_revenue.projected) !== hAz
      ) {
        push(
          'Boundary B20',
          2026,
          `Stale Horizon CPA P&L failed to reconcile (${sc.label}): sec1=${autoSec1.lines.ca_revenue.projected}+${autoSec1.lines.az_revenue.projected} vs horizon=${hCa}+${hAz}`
        );
      }
    }

    // 2026 Snapshot / Horizon / CPA Reconciliation Check (DBP $61k -> $73k, PTE ON, K-1 OBI, Stock Basis = $0)
    const dirty2026State = createInitialBaselineState();
    const polluted2026: PlannerState = {
      ...dirty2026State,
      years: dirty2026State.years.map((yr) =>
        yr.tax_year !== 2026
          ? yr
          : {
              ...yr,
              form_1040: {
                ...yr.form_1040,
                schedule_k1_ordinary_income: 91498, // intentionally stale 2025 figure
              },
              scorp_1120s: {
                ...yr.scorp_1120s,
                pte_election_active: false, // intentionally mismatched with state_pte_elected: true
                stock_basis_beginning: 11016, // intentionally stale 2025 beginning basis
              },
              dbp_and_retirement: {
                ...yr.dbp_and_retirement,
                dbp_actual_contribution: 73000,
              },
              state_filings: yr.state_filings.map((sf) => ({
                ...sf,
                state_pte_elected: sf.state_code === 'CA' || sf.state_code === 'AZ',
              })),
            }
      ),
      pnl_balance_sheet: dirty2026State.pnl_balance_sheet
        ? {
            ...dirty2026State.pnl_balance_sheet,
            pnl: {
              ...dirty2026State.pnl_balance_sheet.pnl,
              dbp_contribution: { ytd: 0, remaining: 61000 }, // intentionally stale $61k
            },
            balance_sheet: {
              ...dirty2026State.pnl_balance_sheet.balance_sheet,
              beginning_stock_basis_override: 11016, // intentionally stale 2025 beginning basis
            },
          }
        : undefined,
    };

    const reconciled2026 = normalizePlannerState(polluted2026);
    const reconciledComp = calculateSixYearPlan(reconciled2026.setup, reconciled2026.years);
    const recY25 = reconciledComp[0];
    const recY26 = reconciledComp[1];
    const rawY26 = reconciled2026.years[1];

    if (
      rawY26.form_1040.schedule_k1_ordinary_income !== recY26.scorp_out.ordinary_business_income_1120s ||
      rawY26.form_1040.schedule_k1_ordinary_income === 91498
    ) {
      push(
        'Boundary B20',
        2026,
        `2026 schedule_k1_ordinary_income stale or mismatched: raw=${rawY26.form_1040.schedule_k1_ordinary_income}, computed=${recY26.scorp_out.ordinary_business_income_1120s}`
      );
    }
    if (rawY26.scorp_1120s.pte_election_active !== true) {
      push(
        'Boundary B20',
        2026,
        `2026 pte_election_active must sync to true when CA/AZ state_pte_elected is true`
      );
    }
    const pnlDbp26 = reconciled2026.pnl_balance_sheet!.pnl.dbp_contribution;
    if (Math.round(pnlDbp26.ytd + pnlDbp26.remaining) !== 73000) {
      push(
        'Boundary B20',
        2026,
        `2026 P&L dbp_contribution must reconcile to $73,000, got ${pnlDbp26.ytd + pnlDbp26.remaining}`
      );
    }
    if (rawY26.scorp_1120s.stock_basis_beginning !== recY25.scorp_out.stock_basis_ending || recY25.scorp_out.stock_basis_ending !== 0) {
      push(
        'Boundary B20',
        2026,
        `2026 stock_basis_beginning must equal 2025 ending basis ($0), got raw=${rawY26.scorp_1120s.stock_basis_beginning}, y25End=${recY25.scorp_out.stock_basis_ending}`
      );
    }
    if (reconciled2026.pnl_balance_sheet!.balance_sheet.beginning_stock_basis_override !== 0) {
      push(
        'Boundary B20',
        2026,
        `2026 P&L Balance Sheet beginning_stock_basis_override must reconcile to $0, got ${reconciled2026.pnl_balance_sheet!.balance_sheet.beginning_stock_basis_override}`
      );
    }
    // Verify Working P&L pre-PTE OBI - Entity PTE Tax Deduction = Horizon K-1 OBI bridge
    // Align P&L SEHI & Payroll Taxes to Horizon (matching a pushed Cadence/P&L -> Horizon state)
    const cpaPnlBase26 = reconcilePnlStateToHorizonRevenue(
      reconciled2026.pnl_balance_sheet!,
      recY26,
      reconciled2026.setup
    );
    const cpaPnl26 = {
      ...cpaPnlBase26,
      pnl: {
        ...cpaPnlBase26.pnl,
        sehi_medicare: {
          ytd: cpaPnlBase26.pnl.sehi_medicare.ytd,
          remaining: Math.round((recY26.form_1040_out.sehi_medicare_premiums_effective - cpaPnlBase26.pnl.sehi_medicare.ytd) * 100) / 100,
        },
        payroll_taxes: {
          ytd: cpaPnlBase26.pnl.payroll_taxes.ytd,
          remaining: Math.round((recY26.scorp_out.employer_payroll_taxes - cpaPnlBase26.pnl.payroll_taxes.ytd) * 100) / 100,
        },
      },
    };
    const cpaPnlComp26 = calculatePnlBalanceSheet(
      cpaPnl26,
      recY25,
      recY26,
      reconciled2026.setup,
      { respectStateRetirementRemaining: true }
    );
    const cpaRecon26 = computePnlVsHorizonReconciliation(
      cpaPnl26,
      cpaPnlComp26,
      reconciledComp,
      reconciled2026.setup
    )!;
    if (
      cpaRecon26.pteEntityTaxDeduction <= 0 ||
      Math.abs((cpaRecon26.pnlObi - cpaRecon26.pteEntityTaxDeduction) - cpaRecon26.horizonObi) > 1
    ) {
      push(
        'Boundary B20',
        2026,
        `Working P&L vs Horizon K-1 OBI PTE bridge mismatch: pnlObi=${cpaRecon26.pnlObi}, pte=${cpaRecon26.pteEntityTaxDeduction}, horizonObi=${cpaRecon26.horizonObi}, var=${cpaRecon26.obiAfterPteVariance}`
      );
    }
    // Verify v3.0 JSON snapshot export & re-import preserves all reconciled 2026 fields with $0 variance
    const exported26 = serializeSingleProfileBackup({
      id: 'b20-recon-2026',
      name: '2026 Reconciled Snapshot',
      entity_name: polluted2026.setup.business_name || '',
      entity_ein: polluted2026.setup.business_ein || '',
      notes: 'B20 Verification',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      state: polluted2026, // even passing un-reconciled state to export must auto-reconcile before serialization!
    });
    try {
      const parsed26 = parseAndValidateProfileSnapshot(exported26);
      const imp26State = parsed26.profiles[0].state;
      const impY26 = imp26State.years[1];
      const impDbp = imp26State.pnl_balance_sheet!.pnl.dbp_contribution;
      if (
        impY26.form_1040.schedule_k1_ordinary_income !== recY26.scorp_out.ordinary_business_income_1120s ||
        impY26.scorp_1120s.pte_election_active !== true ||
        impY26.scorp_1120s.stock_basis_beginning !== 0 ||
        Math.round(impDbp.ytd + impDbp.remaining) !== 73000
      ) {
        push(
          'Boundary B20',
          2026,
          `v3.0 JSON export/import failed to preserve reconciled 2026 fields: k1=${impY26.form_1040.schedule_k1_ordinary_income}, pte=${impY26.scorp_1120s.pte_election_active}, basis=${impY26.scorp_1120s.stock_basis_beginning}, pnlDbp=${impDbp.ytd + impDbp.remaining}`
        );
      }
    } catch (err) {
      push(
        'Boundary B20',
        2026,
        `2026 snapshot export/import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 2026 Category/State Revenue Aggregation Parity:
    // Consulting - Debra (CA) $130,320.00 + Consulting - Bill (AZ) $213,902.50 + Services - Bill (AZ) $1,805.21 = $346,027.71
    // Starting from stale Horizon ($126,923 CA / $217,485 AZ = $344,408) + 3-state CA/AZ/WA setup
    const revBase = createInitialBaselineState();
    const staleHorizonSetup: SetupConfig = {
      ...revBase.setup,
      state_revenue_apportionment: {
        states: ['CA', 'AZ', 'WA'],
        default_split: { CA: 37, AZ: 60, WA: 3 },
        year_overrides: { 2026: { CA: 36.9, AZ: 63.1, WA: 0 } },
      },
    };
    const staleHorizonYears = revBase.years.map((yr) =>
      yr.tax_year !== 2026
        ? yr
        : {
            ...yr,
            scorp_1120s: {
              ...yr.scorp_1120s,
              ca_revenue: 126923,
              az_revenue: 217485,
              gross_receipts_revenue: 344408,
            },
          }
    );
    const staleComp = calculateSixYearPlan(staleHorizonSetup, staleHorizonYears);
    const exactCadence = {
      projection_year: 2026,
      source_label: '2026 QBO General Ledger',
      ledger_format: 'general_ledger' as const,
      as_of_date: '2026-11-26',
      grouping_mode: 'category' as const,
      exp_smooth_alpha: 0.5,
      exp_smooth_day_fraction: false,
      payee_aliases: [],
      transactions: [
        {
          id: 'rev-ca-1',
          date: '2026-06-15',
          transaction_type: 'Deposit',
          num: '',
          vendor: 'CA Client',
          memo: '',
          account: 'Consulting - Debra (CA)',
          split_account: 'Checking',
          amount: 130320.0,
        },
        {
          id: 'rev-az-1',
          date: '2026-06-15',
          transaction_type: 'Deposit',
          num: '',
          vendor: 'AZ Client',
          memo: '',
          account: 'Consulting - Bill (AZ)',
          split_account: 'Checking',
          amount: 213902.5,
        },
        {
          id: 'rev-az-2',
          date: '2026-06-15',
          transaction_type: 'Deposit',
          num: '',
          vendor: 'AZ Services Client',
          memo: '',
          account: 'Services - Bill (AZ)',
          split_account: 'Checking',
          amount: 1805.21,
        },
      ],
      stream_overrides: {},
      pnl_line_overrides: {},
      balance_sheet: revBase.pnl_balance_sheet!.balance_sheet,
    };
    const exactFc = computeCadenceForecast(exactCadence, staleComp[0], staleComp[1], staleHorizonSetup);
    const revAgg = aggregateCadenceStateRevenue(exactFc, true);
    if (
      revAgg.caProjected !== 130320 ||
      revAgg.azProjected !== 215707.71 ||
      revAgg.totalProjected !== 346027.71 ||
      revAgg.horizonCa !== 130320 ||
      revAgg.horizonAz !== 215708 ||
      revAgg.horizonTotal !== 346028
    ) {
      push(
        'Boundary B20',
        2026,
        `Cadence category/state revenue aggregation drift: ca=${revAgg.caProjected}, az=${revAgg.azProjected}, total=${revAgg.totalProjected}, horizon=${revAgg.horizonCa}+${revAgg.horizonAz}=${revAgg.horizonTotal}`
      );
    }

    // Push into 3-state setup & reload via normalizePlannerState (zero drift allowed!)
    const primaryPctPush = Math.round((revAgg.horizonCa / revAgg.horizonTotal) * 1000) / 10;
    const secondaryPctPush = Math.round((100 - primaryPctPush) * 10) / 10;
    const pushed3StateSetup = updateYearStateApportionmentSplit(staleHorizonSetup, 2026, {
      CA: primaryPctPush,
      AZ: secondaryPctPush,
      WA: 0,
    });
    const pushed3StateYears = staleHorizonYears.map((yr) =>
      yr.tax_year !== 2026
        ? yr
        : {
            ...yr,
            scorp_1120s: {
              ...yr.scorp_1120s,
              ca_revenue: revAgg.horizonCa,
              az_revenue: revAgg.horizonAz,
              gross_receipts_revenue: revAgg.horizonTotal,
            },
            state_filings: yr.state_filings.map((sf) =>
              sf.state_code === 'CA'
                ? { ...sf, state_apportionment_factor: revAgg.horizonCa / revAgg.horizonTotal }
                : sf.state_code === 'AZ'
                ? { ...sf, state_apportionment_factor: revAgg.horizonAz / revAgg.horizonTotal }
                : sf
            ),
          }
    );
    const pushed3StateNorm = normalizePlannerState({
      ...revBase,
      setup: pushed3StateSetup,
      years: pushed3StateYears,
      pnl_balance_sheet: exactFc.synthesizedPnlState,
      cadence_forecaster: exactCadence,
    });
    const pushed3Comp = calculateSixYearPlan(pushed3StateNorm.setup, pushed3StateNorm.years);
    const p3Y26 = pushed3Comp[1];
    const p3SyncedPnl = reconcilePnlStateToHorizonRevenue(
      pushed3StateNorm.pnl_balance_sheet!,
      p3Y26,
      pushed3StateNorm.setup
    );
    const p3CpaSec1 = calculatePnlBalanceSheet(
      p3SyncedPnl,
      pushed3Comp[0],
      p3Y26,
      pushed3StateNorm.setup,
      { respectStateRetirementRemaining: true }
    );
    const p3CpaSec4 = buildCpaHorizonSummary(pushed3StateNorm.setup, pushed3Comp);
    const p3Sec4Gross = p3CpaSec4.rows
      .find((r) => r.id === 'gross_receipts')!
      .cells.find((c) => c.taxYear === 2026)!.numericValue;
    const p3Recon = computePnlVsHorizonReconciliation(
      p3SyncedPnl,
      p3CpaSec1,
      pushed3Comp,
      pushed3StateNorm.setup
    )!;
    const p3RevMismatches = p3Recon.mismatchedLines.filter(
      (m) => m.label === 'Gross Receipts' || m.label.includes('S-Corp Revenue')
    );

    if (
      p3Y26.scorp_in.gross_receipts_revenue !== 346028 ||
      p3Y26.scorp_in.ca_revenue !== 130320 ||
      p3Y26.scorp_in.az_revenue !== 215708 ||
      p3CpaSec1.lines.ca_revenue.projected !== 130320 ||
      p3CpaSec1.lines.az_revenue.projected !== 215707.71 ||
      p3CpaSec1.totalRevenue.projected !== 346027.71 ||
      p3Sec4Gross !== 346028 ||
      p3RevMismatches.length > 0
    ) {
      push(
        'Boundary B20',
        2026,
        `3-view $346,027.71 push mismatch: horizon=${p3Y26.scorp_in.ca_revenue}+${p3Y26.scorp_in.az_revenue}=${p3Y26.scorp_in.gross_receipts_revenue}, sec1=${p3CpaSec1.lines.ca_revenue.projected}+${p3CpaSec1.lines.az_revenue.projected}=${p3CpaSec1.totalRevenue.projected}, sec4=${p3Sec4Gross}, mismatches=${p3RevMismatches.map((m) => m.label).join(',')}`
      );
    }

    // Verify 0.4% split drift (37.4% vs 37.0% default) is preserved by normalizePlannerState without re-splitting
    const legacyNoSplitState: PlannerState = {
      ...revBase,
      setup: { ...revBase.setup, state_revenue_apportionment: undefined },
      years: revBase.years.map((yr) =>
        yr.tax_year !== 2026
          ? yr
          : {
              ...yr,
              scorp_1120s: {
                ...yr.scorp_1120s,
                ca_revenue: 129414, // 37.4% of $346,028
                az_revenue: 216614,
                gross_receipts_revenue: 346028,
              },
            }
      ),
    };
    const norm04 = normalizePlannerState(legacyNoSplitState);
    const comp04 = calculateSixYearPlan(norm04.setup, norm04.years);
    if (comp04[1].scorp_in.ca_revenue !== 129414 || comp04[1].scorp_in.az_revenue !== 216614) {
      push(
        'Boundary B20',
        2026,
        `normalizePlannerState silently re-split 37.4% CA/AZ revenue: got ${comp04[1].scorp_in.ca_revenue}/${comp04[1].scorp_in.az_revenue} expected 129414/216614`
      );
    }
  });

  return count;
}

// ============================================================================
// Phase 2 — 175-Case Seeded Combinatorial Fuzz Suite
// ============================================================================

function runPhase2FuzzSuite(failures: StressTestFailure[]): number {
  const rng = createRng(FUZZ_SEED);
  const phase: StressTestFailure['phase'] = 'Phase 2 (Fuzz)';
  const filingStatuses: readonly FilingStatus[] = [
    'married_filing_jointly',
    'single',
    'head_of_household',
    'married_filing_separately',
  ];
  const entityModes: readonly { entityType: EntityType; hasScorp: boolean }[] = [
    { entityType: 'scorp_llc', hasScorp: true },
    { entityType: 'scorp_llc', hasScorp: true },
    { entityType: 'sole_prop', hasScorp: false },
    { entityType: 'none', hasScorp: false },
  ];
  const statePool = ['CA', 'AZ', 'WA', 'NY', 'TX'] as const;

  for (let i = 1; i <= FUZZ_CASE_COUNT; i++) {
    const caseId = `F${String(i).padStart(3, '0')}`;
    const filingStatus = pick(rng, filingStatuses);
    const isMfj = filingStatus === 'married_filing_jointly';
    const primaryAge2026 = randInt(rng, 50, 78);
    const spouseAge2026 = randInt(rng, 50, 78);
    const primaryBirthYear = 2026 - primaryAge2026;
    const spouseBirthYear = isMfj ? 2026 - spouseAge2026 : null;
    const { entityType, hasScorp } = pick(rng, entityModes);

    const grossRevenue = hasScorp ? randInt(rng, 0, 950) * 1000 : 0;
    const opEx = hasScorp ? randInt(rng, 0, 200) * 1000 : 0;
    const billW2 = hasScorp ? randInt(rng, 0, 220) * 1000 : 0;
    const debraW2 = hasScorp && isMfj ? randInt(rng, 0, 150) * 1000 : 0;
    const nonScorpW2 = !hasScorp ? randInt(rng, 0, 300) * 1000 : 0;
    const sched1OtherIncome = entityType === 'sole_prop' ? randInt(rng, 0, 350) * 1000 : 0;

    const hasDbp = hasScorp && rng() < 0.35;
    const dbpContribution = hasDbp ? randInt(rng, 0, 140) * 1000 : 0;
    const dbpTerminationYear = hasDbp && rng() < 0.5 ? randInt(rng, 2026, 2029) : null;
    const has401k = rng() < 0.6;
    const hasSsMedicare = primaryAge2026 >= 62 || (isMfj && spouseAge2026 >= 62);
    const medicareEnrolled = hasSsMedicare && rng() < 0.7;

    const homeState = pick(rng, statePool);
    const multiState = rng() < 0.55;
    const secondaryCandidates = statePool.filter((s) => s !== homeState);
    const secondaryState = multiState ? pick(rng, secondaryCandidates) : '';
    const primarySplitPct = multiState ? randInt(rng, 10, 90) : 100;
    const primaryResidency: ResidencyStatus =
      multiState && rng() < 0.35 ? 'part_year_resident' : 'resident';
    const primaryResidencyRatio =
      primaryResidency === 'part_year_resident' ? randInt(rng, 2, 8) / 10 : 1;
    const secondaryResidency: ResidencyStatus = 'non_resident';

    const primaryPteElected = hasScorp && rng() < 0.45;
    const secondaryPteElected = hasScorp && multiState && rng() < 0.45;
    const hasPte = primaryPteElected || secondaryPteElected;

    const state = buildSyntheticState({
      filingStatus,
      primaryBirthYear,
      spouseBirthYear,
      entityType,
      hasScorp,
      hasDbp,
      has401k,
      hasSsMedicare,
      medicareEnrolled,
      hasPte,
      homeState,
      secondaryState,
      multiState,
      primarySplitPct,
      primaryResidency,
      primaryResidencyRatio,
      secondaryResidency,
      primaryPteElected,
      secondaryPteElected,
      grossRevenue,
      opEx,
      billW2,
      debraW2,
      nonScorpW2,
      sched1OtherIncome,
      taxableInterest: randInt(rng, 0, 25) * 1000,
      ...(() => {
        const ordinaryDividends = randInt(rng, 0, 30) * 1000;
        const qualifiedDividends = Math.min(ordinaryDividends, randInt(rng, 0, 15) * 1000);
        return { ordinaryDividends, qualifiedDividends };
      })(),
      ltcg: randInt(rng, -5, 60) * 1000,
      sehiPremiums: hasScorp && rng() < 0.5 ? randInt(rng, 4, 24) * 1000 : 0,
      dbpContribution,
      dbpTerminationYear,
      stockBasisBeg: hasScorp ? randInt(rng, 0, 120) * 1000 : 0,
      draws: hasScorp ? randInt(rng, 0, 250) * 1000 : 0,
      capitalContributions: hasScorp && rng() < 0.25 ? randInt(rng, 0, 40) * 1000 : 0,
      nondeductibleExpenses: hasScorp && rng() < 0.3 ? randInt(rng, 0, 5) * 1000 : 0,
      schedKInterest: hasScorp && rng() < 0.3 ? randInt(rng, 0, 4) * 1000 : 0,
      deductionMethod: rng() < 0.2 ? 'itemized' : 'standard',
      customItemized: randInt(rng, 18, 55) * 1000,
    });

    const normalized = normalizePlannerState(state);
    const computed = calculateSixYearPlan(normalized.setup, normalized.years);
    const label = `Fuzz ${caseId} (${filingStatus}, ${entityType}, ${homeState}${secondaryState ? '/' + secondaryState : ''})`;
    checkUniversalInvariants(caseId, phase, label, normalized, computed, failures);
  }

  return FUZZ_CASE_COUNT;
}

// ============================================================================
// Suite Entry Point (Programmatic + CLI)
// ============================================================================

export function runTaxEngineStressSuite(): StressSuiteReport {
  const start = Date.now();
  const failures: StressTestFailure[] = [];

  const phase1Count = runPhase1BoundaryMatrix(failures);
  const phase2Count = runPhase2FuzzSuite(failures);
  const totalCases = phase1Count + phase2Count;
  const failedCaseIds = new Set(failures.map((f) => f.caseId));
  const failedCases = failedCaseIds.size;

  return {
    seed: FUZZ_SEED,
    totalCases,
    passedCases: totalCases - failedCases,
    failedCases,
    durationMs: Date.now() - start,
    failures,
  };
}

// Auto-execute when run directly via `npx tsx src/tests/taxEngineStressSuite.ts` or `npm test`
const isDirectCliRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv.some((arg) => arg.includes('taxEngineStressSuite'));

if (isDirectCliRun) {
  const report = runTaxEngineStressSuite();
  console.log('========================================================================');
  console.log(`TAX ENGINE QA & STRESS-TEST SUITE (Seed=${report.seed})`);
  console.log(
    `Result: ${report.passedCases}/${report.totalCases} PASSED | ${report.failedCases} FAILED | ${report.durationMs}ms`
  );
  console.log('========================================================================');

  if (report.failures.length > 0) {
    console.log('\nFAILED CASES SUMMARY TABLE:');
    console.table(
      report.failures.map((f) => ({
        Case: f.caseId,
        Phase: f.phase,
        Year: f.year,
        Invariant: f.invariant,
        Detail: f.detail,
        Inputs: f.inputSummary,
      }))
    );
    process.exit(1);
  } else {
    console.log('ALL 195/195 CASES PASSED ALL 6 UNIVERSAL INVARIANTS WITH ZERO FAILURES.');
    process.exit(0);
  }
}
