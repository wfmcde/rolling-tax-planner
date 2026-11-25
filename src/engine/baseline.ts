import sampleBaseline from '../../data/sample-baseline.json';
import type {
  DbpStatus,
  PlannerState,
  ResidencyStatus,
  SetupConfig,
  StateFilingInputs,
  TaxYearRecord,
} from '../types/tax';
import { createDefaultPersonProfile, parseBirthDate } from '../utils/personTax';
import {
  ALL_SCHEDULE_ITEM_IDS,
  sanitizeHiddenItemIds,
} from './scheduleCatalog';
import {
  createInitialPnlBalanceSheetState,
  normalizePnlBalanceSheetState,
} from './pnlBalanceSheet';
import { DEFAULT_IRMAA_GROWTH_RATE, sanitizeIrmaaThresholdOverrides } from './irmaa';
import { DEFAULT_PROFILE_SEED, isDefaultSeedSetup } from '../data/profiles';
import {
  applySetupApportionmentToYear,
  getActiveBusinessStates,
  normalizeStateApportionmentConfig,
  resolveStateApportionmentForYear,
} from '../utils/setupHelpers';

function round0(n: number): number {
  return Math.round(n);
}

/**
 * Generates a single forecast year derived from the prior year record
 * using Module 3 §2 projection rules (growth assumptions + scheduled DBP/residency events).
 */
export function projectNextYear(
  prior: TaxYearRecord,
  nextTaxYear: number,
  setup: SetupConfig
): TaxYearRecord {
  const {
    revenue_growth_rate,
    wage_growth_rate,
    investment_growth_rate,
    inflation_rate,
    medicare_inflation_rate,
  } = setup.assumptions;
  const medRate = medicare_inflation_rate ?? 0.055;

  const priorTotalRevenue = Math.max(
    0,
    prior.scorp_1120s.ca_revenue + prior.scorp_1120s.az_revenue
  );
  const nextRevenue = round0(priorTotalRevenue * (1 + revenue_growth_rate));
  const resolvedSplit = resolveStateApportionmentForYear(setup, nextTaxYear);
  const hasDynamicSplit = resolvedSplit.activeStates.length > 0;
  const nextCaRevenue = hasDynamicSplit
    ? resolvedSplit.hasSecondary
      ? round0(nextRevenue * resolvedSplit.primaryRatio)
      : nextRevenue
    : round0(prior.scorp_1120s.ca_revenue * (1 + revenue_growth_rate));
  const nextAzRevenue = hasDynamicSplit
    ? resolvedSplit.hasSecondary
      ? Math.max(0, nextRevenue - nextCaRevenue)
      : 0
    : round0(prior.scorp_1120s.az_revenue * (1 + revenue_growth_rate));
  const nextCaApp = hasDynamicSplit
    ? resolvedSplit.primaryRatio
    : nextRevenue > 0
    ? nextCaRevenue / nextRevenue
    : 0;
  const nextAzApp = hasDynamicSplit
    ? resolvedSplit.secondaryRatio
    : nextRevenue > 0
    ? nextAzRevenue / nextRevenue
    : 0;
  const opexScalingMode = setup.assumptions.opex_scaling_mode ?? 'revenue_proportional';
  const clampedExpenseRatio = Math.min(
    1,
    Math.max(
      0,
      typeof setup.assumptions.expense_ratio === 'number' &&
        Number.isFinite(setup.assumptions.expense_ratio)
        ? setup.assumptions.expense_ratio
        : 0.2
    )
  );
  const nextOpEx =
    nextTaxYear > setup.current_tax_year && opexScalingMode === 'revenue_proportional'
      ? round0(nextRevenue * clampedExpenseRatio)
      : round0(prior.scorp_1120s.operating_expenses * (1 + inflation_rate));
  const nextDebraW2 = round0(prior.scorp_1120s.debra_w2_wages * (1 + wage_growth_rate));
  const nextBillW2 = round0(prior.scorp_1120s.bill_w2_wages * (1 + wage_growth_rate));
  const nextOfficerW2 = nextDebraW2 + nextBillW2;

  // When transitioning from a locked actuals year with excess draws, reset forecast draws to ~85% of K-1 profit
  const baseDrawsForProjection =
    prior.is_locked_actuals &&
    prior.form_1040.schedule_k1_ordinary_income > 0 &&
    prior.scorp_1120s.scorp_distributions_total > prior.form_1040.schedule_k1_ordinary_income
      ? round0(Math.max(0, prior.form_1040.schedule_k1_ordinary_income) * 0.85)
      : prior.scorp_1120s.scorp_distributions_total;
  const nextDistributions = round0(baseDrawsForProjection * (1 + revenue_growth_rate * 0.8));

  // DBP lifecycle transition based on Setup dbp_planned_termination_year (null means "None")
  const targetTerm = setup.dbp_planned_termination_year;
  const isDefaultSeed = isDefaultSeedSetup(setup);
  let nextDbpStatus: DbpStatus = prior.dbp_and_retirement.dbp_status;
  let nextDbpContrib = prior.dbp_and_retirement.dbp_actual_contribution;
  let nextRollover = 0;

  if (setup.has_dbp) {
    if (targetTerm === null || nextTaxYear < targetTerm) {
      nextDbpStatus = 'active';
      const baseContrib = Math.max(0, prior.dbp_and_retirement.dbp_actual_contribution);
      const baseMax = Math.max(
        baseContrib,
        prior.dbp_and_retirement.dbp_max_deductible_contribution
      );
      nextDbpContrib =
        baseContrib > 0
          ? round0(Math.min(baseMax * (1 + inflation_rate), baseContrib * (1 + inflation_rate)))
          : 0;
    } else if (nextTaxYear === targetTerm) {
      nextDbpStatus = 'terminating';
      const baseContrib = Math.max(0, prior.dbp_and_retirement.dbp_actual_contribution);
      nextDbpContrib = round0(baseContrib * 0.5);
      nextRollover =
        prior.dbp_and_retirement.rollover_amount > 0
          ? prior.dbp_and_retirement.rollover_amount
          : isDefaultSeed
          ? DEFAULT_PROFILE_SEED.default_dbp_rollover_estimate
          : 0;
    } else {
      nextDbpStatus = 'terminated';
      nextDbpContrib = 0;
      nextRollover = 0;
    }
  } else {
    nextDbpStatus = 'terminated';
    nextDbpContrib = 0;
  }

  // State filings & residency schedule:
  const primaryStateCode = (setup.home_state || '').trim().toUpperCase();
  const secondaryStateCode = (setup.secondary_state || '').trim().toUpperCase();
  const nextStates: StateFilingInputs[] = [];
  const seedMove = DEFAULT_PROFILE_SEED.default_residency_transition;
  const priorFromSeed = isDefaultSeed
    ? prior.state_filings.find((s) => s.state_code === seedMove.from_state)
    : undefined;
  const priorSecondarySeed = isDefaultSeed
    ? prior.state_filings.find((s) => s.state_code === seedMove.secondary_state)
    : undefined;

  if (
    isDefaultSeed &&
    setup.residency_change_active &&
    priorFromSeed &&
    nextTaxYear === seedMove.move_year
  ) {
    nextStates.push(
      {
        state_code: seedMove.from_state,
        residency_status: 'part_year_resident',
        residency_start_date: `${seedMove.move_year}-01-01`,
        residency_end_date: seedMove.depart_date,
        residency_day_or_income_ratio: Number(seedMove.from_day_ratio.toFixed(6)),
        state_return_type: seedMove.part_year_from_label,
        state_apportionment_factor: nextCaApp,
        state_pte_elected: setup.has_pte && Boolean(priorFromSeed.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: seedMove.to_state,
        residency_status: 'part_year_resident',
        residency_start_date: seedMove.arrive_date,
        residency_end_date: `${seedMove.move_year}-12-31`,
        residency_day_or_income_ratio: Number(seedMove.to_day_ratio.toFixed(6)),
        state_return_type: seedMove.part_year_to_label,
        state_apportionment_factor: 0,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      ...(priorSecondarySeed
        ? [
            {
              state_code: seedMove.secondary_state,
              residency_status: 'non_resident' as const,
              residency_start_date: `${seedMove.move_year}-01-01`,
              residency_end_date: `${seedMove.move_year}-12-31`,
              residency_day_or_income_ratio: 0,
              state_return_type: seedMove.secondary_non_resident_label,
              state_apportionment_factor: nextAzApp,
              state_pte_elected: setup.has_pte && Boolean(priorSecondarySeed.state_pte_elected),
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 0,
            },
          ]
        : [])
    );
  } else if (
    isDefaultSeed &&
    setup.residency_change_active &&
    priorFromSeed &&
    nextTaxYear > seedMove.move_year
  ) {
    nextStates.push(
      {
        state_code: seedMove.to_state,
        residency_status: 'resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 1.0,
        state_return_type: seedMove.post_move_to_label,
        state_apportionment_factor: 0,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: seedMove.from_state,
        residency_status: 'non_resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 0,
        state_return_type: seedMove.post_move_from_label,
        state_apportionment_factor: nextCaApp,
        state_pte_elected: setup.has_pte && Boolean(priorFromSeed.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      ...(priorSecondarySeed
        ? [
            {
              state_code: seedMove.secondary_state,
              residency_status: 'non_resident' as const,
              residency_start_date: `${nextTaxYear}-01-01`,
              residency_end_date: `${nextTaxYear}-12-31`,
              residency_day_or_income_ratio: 0,
              state_return_type: seedMove.secondary_non_resident_label,
              state_apportionment_factor: nextAzApp,
              state_pte_elected: setup.has_pte && Boolean(priorSecondarySeed.state_pte_elected),
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 0,
            },
          ]
        : [])
    );
  } else {
    for (const sf of prior.state_filings) {
      const appFactor = Object.prototype.hasOwnProperty.call(resolvedSplit.split, sf.state_code)
        ? (resolvedSplit.split[sf.state_code] ?? 0) / 100
        : primaryStateCode && sf.state_code === primaryStateCode
        ? nextCaApp
        : secondaryStateCode && sf.state_code === secondaryStateCode
        ? nextAzApp
        : sf.state_apportionment_factor;
      nextStates.push({
        ...sf,
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        state_apportionment_factor: appFactor,
        state_pte_elected: setup.has_pte && sf.state_pte_elected,
        state_tax_withholding_and_estimates: round0(
          sf.state_tax_withholding_and_estimates * (1 + revenue_growth_rate * 0.5)
        ),
      });
    }
  }

  // Ensure any additional selected apportionment states exist in nextStates
  for (const code of resolvedSplit.activeStates) {
    if (!nextStates.some((sf) => sf.state_code === code)) {
      nextStates.push({
        state_code: code,
        residency_status: 'non_resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 0,
        state_return_type: `${code} Non-Resident Return`,
        state_apportionment_factor: (resolvedSplit.split[code] ?? 0) / 100,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      });
    }
  }

  return {
    tax_year: nextTaxYear,
    record_mode: 'forecast',
    is_locked_actuals: false,
    form_1040: {
      w2_wages_total: nextOfficerW2,
      use_explicit_w2_box1: false,
      taxable_interest: round0(prior.form_1040.taxable_interest * (1 + investment_growth_rate)),
      tax_exempt_interest: round0(
        prior.form_1040.tax_exempt_interest * (1 + investment_growth_rate)
      ),
      ordinary_dividends: round0(
        prior.form_1040.ordinary_dividends * (1 + investment_growth_rate)
      ),
      qualified_dividends: round0(
        prior.form_1040.qualified_dividends * (1 + investment_growth_rate)
      ),
      short_term_capital_gain_loss: prior.form_1040.short_term_capital_gain_loss,
      // Do not carry forward 2025 one-time excess basis gain as recurring LTCG in forecast years
      long_term_capital_gain_loss: prior.is_locked_actuals
        ? 0
        : round0(prior.form_1040.long_term_capital_gain_loss * (1 + investment_growth_rate)),
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: prior.form_1040.schedule_1_other_income,
      schedule_1_adjustments_input: 0,
      schedule_k1_ordinary_income: prior.form_1040.schedule_k1_ordinary_income,
      schedule_k1_other_items: prior.form_1040.schedule_k1_other_items,
      // Do not carry forward locked actuals one-time 1099-R IRA/pension distributions into future forecast years
      ira_distributions_gross: prior.is_locked_actuals
        ? 0
        : prior.form_1040.ira_distributions_gross,
      ira_distributions_taxable: prior.is_locked_actuals
        ? 0
        : prior.form_1040.ira_distributions_taxable,
      pensions_and_annuities_gross: prior.is_locked_actuals
        ? 0
        : prior.form_1040.pensions_and_annuities_gross,
      pensions_and_annuities_taxable: prior.is_locked_actuals
        ? 0
        : prior.form_1040.pensions_and_annuities_taxable,
      social_security_gross: 0,
      health_insurance_premiums:
        nextTaxYear <= setup.current_tax_year
          ? prior.form_1040.health_insurance_premiums
          : round0(prior.form_1040.health_insurance_premiums * (1 + medRate)),
      itemized_deductions_input: round0(
        prior.form_1040.itemized_deductions_input * (1 + inflation_rate)
      ),
      deduction_method: setup.deduction_method,
      federal_tax_withholding: 0,
      federal_estimated_tax_payments: 0,
    },
    scorp_1120s: {
      entity_id: prior.scorp_1120s.entity_id,
      entity_name: prior.scorp_1120s.entity_name,
      entity_ein: prior.scorp_1120s.entity_ein,
      bill_ownership_pct: prior.scorp_1120s.bill_ownership_pct,
      debra_ownership_pct: prior.scorp_1120s.debra_ownership_pct,
      ca_revenue: nextCaRevenue,
      az_revenue: nextAzRevenue,
      gross_receipts_revenue: nextRevenue,
      operating_expenses: nextOpEx,
      operating_expenses_override: null,
      use_detailed_1120s_deductions: false,
      debra_w2_wages: nextDebraW2,
      bill_w2_wages: nextBillW2,
      officer_w2_wages: nextOfficerW2,
      scorp_distributions_total: nextDistributions,
      capital_contributions: 0,
      stock_basis_beginning: prior.scorp_1120s.stock_basis_beginning,
      aaa_balance_beginning: prior.scorp_1120s.aaa_balance_beginning,
      state_sourcing_breakdown:
        resolvedSplit.activeStates.length > 0
          ? resolvedSplit.activeStates.map((code) => ({
              state_code: code,
              apportionment_percent: resolvedSplit.split[code] ?? 0,
            }))
          : prior.scorp_1120s.state_sourcing_breakdown,
      pte_election_active: setup.has_pte,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      ...prior.dbp_and_retirement,
      dbp_status: nextDbpStatus,
      dbp_target_termination_year: targetTerm ?? 2099,
      dbp_max_deductible_contribution:
        nextDbpStatus === 'terminated'
          ? 0
          : round0(
              Math.max(nextDbpContrib, prior.dbp_and_retirement.dbp_max_deductible_contribution) *
                (1 + inflation_rate)
            ),
      dbp_actual_contribution: nextDbpContrib,
      dbp_loan_balance:
        nextDbpStatus === 'terminated'
          ? 0
          : Math.max(0, prior.dbp_and_retirement.dbp_loan_balance - 5000),
      qualified_plan_contribution: setup.has_401k_or_ira
        ? round0(prior.dbp_and_retirement.qualified_plan_contribution * (1 + inflation_rate))
        : 0,
      rollover_amount: nextRollover,
      rollover_source_type: nextRollover > 0 ? 'Defined Benefit Plan Termination' : 'None',
    },
    state_filings: nextStates,
  };
}

/**
 * Hydrates the full 6-year PlannerState from /data/sample-baseline.json using
 * strictly constant inputs for 2025 so the deterministic engine computes every
 * derived total, deduction, and tax liability without hardcoded output overrides.
 */
export function createInitialBaselineState(): PlannerState {
  const rawSetup = sampleBaseline.setup;
  const rawYear1 = sampleBaseline.years[0];

  const primaryProfile = createDefaultPersonProfile(DEFAULT_PROFILE_SEED.primary_birth_date);
  const spouseProfile = createDefaultPersonProfile(DEFAULT_PROFILE_SEED.spouse_birth_date);

  // Social Security benefits start in 2026 and carry forward with COLA
  primaryProfile.social_security = {
    ...primaryProfile.social_security,
    receiving: true,
    monthly_benefit: DEFAULT_PROFILE_SEED.primary_ss_monthly,
  };
  spouseProfile.social_security = {
    ...spouseProfile.social_security,
    receiving: true,
    monthly_benefit: DEFAULT_PROFILE_SEED.spouse_ss_monthly,
  };

  const setup: SetupConfig = {
    filing_status: rawSetup.filing_status as SetupConfig['filing_status'],
    primary_name: DEFAULT_PROFILE_SEED.primary_name,
    spouse_name: DEFAULT_PROFILE_SEED.spouse_name,
    primary_birth_year: DEFAULT_PROFILE_SEED.primary_birth_year,
    spouse_birth_year: DEFAULT_PROFILE_SEED.spouse_birth_year,
    primary_profile: primaryProfile,
    spouse_profile: spouseProfile,
    business_name: DEFAULT_PROFILE_SEED.business_name,
    business_website: DEFAULT_PROFILE_SEED.business_website,
    business_ein: DEFAULT_PROFILE_SEED.business_ein,
    home_state: DEFAULT_PROFILE_SEED.home_state,
    secondary_state: DEFAULT_PROFILE_SEED.secondary_state,
    state_revenue_apportionment: {
      default_split: { ...DEFAULT_PROFILE_SEED.default_state_revenue_split },
      year_overrides: {},
    },
    workspace_profile_kind: 'default',
    deduction_method: (rawYear1.form_1040.deduction_method as 'standard' | 'itemized') || 'standard',
    custom_itemized_deduction: 34700,
    entity_type: rawSetup.has_scorp ? 'scorp_llc' : 'none',
    has_scorp: rawSetup.has_scorp,
    has_ss_medicare: true,
    has_stock_basis: rawSetup.has_scorp,
    has_dbp: rawSetup.has_dbp,
    dbp_planned_termination_year:
      rawYear1.dbp_and_retirement.dbp_target_termination_year ?? 2027,
    post_dbp_profit_sharing_rate: 0.06,
    dbp_actuarial: { ...DEFAULT_PROFILE_SEED.dbp_actuarial_baseline },
    has_401k_or_ira: rawSetup.has_401k_or_ira,
    has_annuity: rawSetup.has_annuity,
    has_pte: rawSetup.has_pte,
    multi_state_active: rawSetup.multi_state_active,
    residency_change_active: rawSetup.residency_change_active,
    anchor_actuals_year: rawSetup.anchor_actuals_year,
    current_tax_year: rawSetup.forecast_years[1] ?? 2026,
    forecast_length: rawSetup.forecast_length,
    forecast_years: [...rawSetup.forecast_years],
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      irmaa_threshold_growth_rate: DEFAULT_IRMAA_GROWTH_RATE,
      revenue_growth_rate: 0.04,
      wage_growth_rate: 0.025,
      investment_growth_rate: 0.035,
      expense_ratio: DEFAULT_PROFILE_SEED.default_expense_ratio,
      opex_scaling_mode: 'revenue_proportional',
    },
    irmaa_threshold_overrides: {},
  };

  // Anchor Year 1 S-Corp Payroll from baseline JSON seed
  const year1PrimaryW2 = rawYear1.scorp_1120s.compensation_of_officers;
  const year1SpouseW2 = rawYear1.scorp_1120s.salaries_and_wages;
  const year1TotalW2 = year1PrimaryW2 + year1SpouseW2;

  // Non-payroll, non-pension 1120-S expenses used as Year 1 baseline
  const year1OperatingExForForecast =
    rawYear1.scorp_1120s.rents +
    rawYear1.scorp_1120s.ftb_state_taxes_input +
    rawYear1.scorp_1120s.advertising +
    rawYear1.scorp_1120s.other_deductions;

  const year1BegBasis =
    rawYear1.scorp_1120s.bill_stock_basis_beginning +
    rawYear1.scorp_1120s.debra_stock_basis_beginning;

  // Populate Year 1 strictly with constant inputs from seed JSON (NO output overrides)
  const year1: TaxYearRecord = {
    tax_year: rawYear1.tax_year,
    record_mode: 'actuals',
    is_locked_actuals: rawYear1.is_locked_actuals,
    form_1040: {
      w2_wages_total: rawYear1.form_1040.w2_wages_total,
      bill_w2_box1: rawYear1.form_1040.bill_w2_box1,
      debra_w2_box1: rawYear1.form_1040.debra_w2_box1,
      use_explicit_w2_box1: true,
      taxable_interest: rawYear1.form_1040.taxable_interest,
      tax_exempt_interest: 0,
      ordinary_dividends: rawYear1.form_1040.ordinary_dividends,
      qualified_dividends: rawYear1.form_1040.qualified_dividends,
      short_term_capital_gain_loss: 0,
      long_term_capital_gain_loss: rawYear1.form_1040.long_term_capital_gain_loss,
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: 0,
      schedule_1_adjustments_input: rawYear1.form_1040.schedule_1_adjustments_input,
      // Derived dynamically by engine from Form 1120-S via auto_sync_k1: true
      schedule_k1_ordinary_income: 0,
      schedule_k1_other_items: 0,
      ira_distributions_gross: rawYear1.form_1040.ira_distributions_taxable,
      ira_distributions_taxable: rawYear1.form_1040.ira_distributions_taxable,
      pensions_and_annuities_gross: rawYear1.form_1040.pensions_and_annuities_taxable,
      pensions_and_annuities_taxable: rawYear1.form_1040.pensions_and_annuities_taxable,
      social_security_gross: rawYear1.form_1040.social_security_gross ?? 0,
      ss_bill_mode: (rawYear1.form_1040.ss_bill_mode as 'on' | 'suspended' | 'off') ?? 'off',
      ss_bill_override: rawYear1.form_1040.ss_bill_override ?? null,
      ss_debra_mode: (rawYear1.form_1040.ss_debra_mode as 'on' | 'suspended' | 'off') ?? 'off',
      ss_debra_override: rawYear1.form_1040.ss_debra_override ?? null,
      health_insurance_premiums: 0,
      itemized_deductions_input: 34700,
      deduction_method: rawYear1.form_1040.deduction_method as 'standard' | 'itemized',
    },
    scorp_1120s: {
      entity_id: 'entity-default-1120s',
      entity_name: rawYear1.scorp_1120s.entity_name,
      entity_ein: rawYear1.scorp_1120s.entity_ein,
      bill_ownership_pct: rawYear1.scorp_1120s.bill_ownership_pct,
      debra_ownership_pct: rawYear1.scorp_1120s.debra_ownership_pct,
      ca_revenue: rawYear1.scorp_1120s.ca_revenue,
      az_revenue: rawYear1.scorp_1120s.az_revenue,
      gross_receipts_revenue:
        rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue,
      operating_expenses: year1OperatingExForForecast,
      use_detailed_1120s_deductions: true,
      compensation_of_officers: rawYear1.scorp_1120s.compensation_of_officers,
      salaries_and_wages: rawYear1.scorp_1120s.salaries_and_wages,
      rents: rawYear1.scorp_1120s.rents,
      payroll_taxes_input: rawYear1.scorp_1120s.payroll_taxes_input,
      ftb_state_taxes_input: rawYear1.scorp_1120s.ftb_state_taxes_input,
      advertising: rawYear1.scorp_1120s.advertising,
      pension_profit_sharing_input: rawYear1.scorp_1120s.pension_profit_sharing_input,
      other_deductions: rawYear1.scorp_1120s.other_deductions,
      schedule_k_interest_income: rawYear1.scorp_1120s.schedule_k_interest_income,
      schedule_k_interest_bill: rawYear1.scorp_1120s.schedule_k_interest_bill,
      schedule_k_interest_debra: rawYear1.scorp_1120s.schedule_k_interest_debra,
      schedule_k_nondeductible_expenses: rawYear1.scorp_1120s.schedule_k_nondeductible_expenses,
      schedule_k_nondeductible_bill: rawYear1.scorp_1120s.schedule_k_nondeductible_bill,
      schedule_k_nondeductible_debra: rawYear1.scorp_1120s.schedule_k_nondeductible_debra,
      debra_w2_wages: year1SpouseW2,
      bill_w2_wages: year1PrimaryW2,
      officer_w2_wages: year1TotalW2,
      scorp_distributions_total: rawYear1.scorp_1120s.scorp_distributions_total,
      bill_distributions: rawYear1.scorp_1120s.bill_distributions,
      debra_distributions: rawYear1.scorp_1120s.debra_distributions,
      capital_contributions: rawYear1.scorp_1120s.capital_contributions,
      stock_basis_beginning: year1BegBasis,
      bill_stock_basis_beginning: rawYear1.scorp_1120s.bill_stock_basis_beginning,
      debra_stock_basis_beginning: rawYear1.scorp_1120s.debra_stock_basis_beginning,
      shareholder_loans_beginning: 0,
      aaa_balance_beginning: year1BegBasis,
      ca_franchise_tax_input: rawYear1.scorp_1120s.ca_franchise_tax_input,
      state_sourcing_breakdown: [
        {
          state_code: DEFAULT_PROFILE_SEED.home_state,
          apportionment_percent: Number(
            (
              (rawYear1.scorp_1120s.ca_revenue /
                (rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue)) *
              100
            ).toFixed(2)
          ),
        },
        {
          state_code: DEFAULT_PROFILE_SEED.secondary_state,
          apportionment_percent: Number(
            (
              (rawYear1.scorp_1120s.az_revenue /
                (rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue)) *
              100
            ).toFixed(2)
          ),
        },
      ],
      pte_election_active: rawSetup.has_pte,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      dbp_plan_id: 'dbp-default-001',
      dbp_status: rawYear1.dbp_and_retirement.dbp_status as DbpStatus,
      dbp_max_deductible_contribution: DEFAULT_PROFILE_SEED.default_dbp_max_2025,
      dbp_actual_contribution: rawYear1.dbp_and_retirement.dbp_actual_contribution,
      dbp_target_termination_year: rawYear1.dbp_and_retirement.dbp_target_termination_year,
      dbp_rollover_target_account: 'Traditional IRA Rollover',
      dbp_loan_balance: 0,
      dbp_collateral_requirement: 0,
      qualified_plan_contribution: 66040,
      rollover_amount: 0,
      rollover_source_type: 'None',
      annuity_contract_value: 0,
      annuity_payout_amount: 0,
    },
    state_filings: rawYear1.state_filings.map((sf) => ({
      state_code: sf.state_code,
      residency_status: sf.residency_status as ResidencyStatus,
      residency_start_date: `${rawYear1.tax_year}-01-01`,
      residency_end_date: `${rawYear1.tax_year}-12-31`,
      residency_day_or_income_ratio: sf.residency_status === 'resident' ? 1.0 : 0,
      state_return_type:
        sf.state_code === DEFAULT_PROFILE_SEED.home_state
          ? DEFAULT_PROFILE_SEED.default_2025_return_types.primary
          : DEFAULT_PROFILE_SEED.default_2025_return_types.secondary,
      state_apportionment_factor: sf.state_apportionment_factor,
      state_conformity_adjustment:
        'state_conformity_adjustment' in sf && typeof sf.state_conformity_adjustment === 'number'
          ? sf.state_conformity_adjustment
          : 0,
      state_pte_elected: rawSetup.has_pte,
      other_state_credits_claimed: 0,
      state_tax_withholding_and_estimates: 0,
    })),
  };

  const years: TaxYearRecord[] = [year1];
  for (let i = 1; i < setup.forecast_years.length; i++) {
    const nextYearNum = setup.forecast_years[i];
    const projected = projectNextYear(years[i - 1], nextYearNum, setup);
    const preset = DEFAULT_PROFILE_SEED.forecast_2026_2030_inputs[nextYearNum];
    if (preset) {
      const totalRev = preset.ca_revenue + preset.az_revenue;
      const presetSplit = resolveStateApportionmentForYear(setup, nextYearNum);
      const caRev = presetSplit.hasSecondary
        ? round0(totalRev * presetSplit.primaryRatio)
        : totalRev;
      const azRev = presetSplit.hasSecondary ? Math.max(0, totalRev - caRev) : 0;
      const caApp = presetSplit.primaryRatio;
      const azApp = presetSplit.secondaryRatio;
      const totalW2 = preset.debra_w2 + preset.bill_w2;

      years.push({
        ...projected,
        form_1040: {
          ...projected.form_1040,
          w2_wages_total: totalW2,
          health_insurance_premiums: preset.sehi_medicare_premiums,
          sehi_medicare_override: null,
        },
        scorp_1120s: {
          ...projected.scorp_1120s,
          ca_revenue: caRev,
          az_revenue: azRev,
          gross_receipts_revenue: totalRev,
          operating_expenses:
            typeof preset.operating_expenses === 'number'
              ? preset.operating_expenses
              : nextYearNum > setup.current_tax_year
              ? round0(totalRev * setup.assumptions.expense_ratio)
              : projected.scorp_1120s.operating_expenses,
          operating_expenses_override: null,
          debra_w2_wages: preset.debra_w2,
          bill_w2_wages: preset.bill_w2,
          officer_w2_wages: totalW2,
          scorp_distributions_total: preset.member_draws,
          capital_contributions: preset.capital_contributions,
          state_sourcing_breakdown: presetSplit.activeStates.map((code) => ({
            state_code: code,
            apportionment_percent: presetSplit.split[code] ?? 0,
          })),
        },
        dbp_and_retirement: {
          ...projected.dbp_and_retirement,
          dbp_actual_contribution: preset.dbp_contribution,
          dbp_max_deductible_contribution:
            preset.dbp_contribution > 0
              ? Math.max(
                  projected.dbp_and_retirement.dbp_max_deductible_contribution,
                  preset.dbp_contribution
                )
              : 0,
        },
        state_filings: projected.state_filings.map((sf) =>
          Object.prototype.hasOwnProperty.call(presetSplit.split, sf.state_code)
            ? { ...sf, state_apportionment_factor: (presetSplit.split[sf.state_code] ?? 0) / 100 }
            : sf
        ),
      });
    } else {
      years.push(projected);
    }
  }

  const year2026 = years.find((y) => y.tax_year === 2026) ?? years[1];

  return {
    setup,
    years,
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: [],
    },
    pnl_balance_sheet: createInitialPnlBalanceSheetState(year2026, 0, setup),
  };
}

/**
 * Annual Rolling Forward Workflow (Module 3 §4):
 */
export function rollWindowForward(
  state: PlannerState,
  reconciledYear1Overrides: {
    w2_wages_total: number;
    schedule_k1_ordinary_income: number;
    taxable_income: number;
    officer_w2_wages: number;
    scorp_distributions_total: number;
    dbp_actual_contribution: number;
  },
  priorYear1Summary: {
    adjusted_gross_income: number;
    taxable_income: number;
    federal_income_tax: number;
    total_state_tax: number;
    effective_tax_rate: number;
  }
): PlannerState {
  const [retiringYear1, promotingYear2, ...remainingForecast] = state.years;

  const archived = {
    tax_year: retiringYear1.tax_year,
    archived_at: new Date().toISOString().slice(0, 10),
    record: retiringYear1,
    summary: priorYear1Summary,
  };

  const priorOfficer = promotingYear2.scorp_1120s.officer_w2_wages;
  const debraShare =
    priorOfficer > 0 ? promotingYear2.scorp_1120s.debra_w2_wages / priorOfficer : 0.44;
  const reconciledDebraW2 = round0(reconciledYear1Overrides.officer_w2_wages * debraShare);
  const reconciledBillW2 = Math.max(
    0,
    reconciledYear1Overrides.officer_w2_wages - reconciledDebraW2
  );

  const newYear1: TaxYearRecord = {
    ...promotingYear2,
    record_mode: 'actuals',
    is_locked_actuals: true,
    amended_unlock_reason: undefined,
    locked_actuals: undefined,
    form_1040: {
      ...promotingYear2.form_1040,
      w2_wages_total: reconciledYear1Overrides.w2_wages_total,
      schedule_k1_ordinary_income: reconciledYear1Overrides.schedule_k1_ordinary_income,
    },
    scorp_1120s: {
      ...promotingYear2.scorp_1120s,
      debra_w2_wages: reconciledDebraW2,
      bill_w2_wages: reconciledBillW2,
      officer_w2_wages: reconciledYear1Overrides.officer_w2_wages,
      scorp_distributions_total: reconciledYear1Overrides.scorp_distributions_total,
    },
    dbp_and_retirement: {
      ...promotingYear2.dbp_and_retirement,
      dbp_actual_contribution: reconciledYear1Overrides.dbp_actual_contribution,
    },
  };

  const lastExisting = remainingForecast[remainingForecast.length - 1];
  const newYear6Num = lastExisting.tax_year + 1;
  const newYear6 = projectNextYear(lastExisting, newYear6Num, state.setup);

  const nextYears = [newYear1, ...remainingForecast, newYear6];
  const nextSetup: SetupConfig = {
    ...state.setup,
    anchor_actuals_year: newYear1.tax_year,
    current_tax_year: newYear1.tax_year + 1,
    forecast_years: nextYears.map((y) => y.tax_year),
  };

  return {
    setup: nextSetup,
    years: nextYears,
    archived_years: [archived, ...state.archived_years],
    schedule_view: state.schedule_view,
    planning_goals: state.planning_goals,
    guardrail_acknowledgments: state.guardrail_acknowledgments,
  };
}

/**
 * Ensures any saved localStorage or imported PlannerState safely includes all fields.
 */
export function normalizePlannerState(raw: PlannerState): PlannerState {
  const defaultPrimary = createDefaultPersonProfile('');
  const defaultSpouse = createDefaultPersonProfile('');

  const primaryProfile = raw.setup.primary_profile
    ? {
        birth_date: raw.setup.primary_profile.birth_date ?? '',
        birth_month: raw.setup.primary_profile.birth_month,
        social_security: {
          ...defaultPrimary.social_security,
          ...(raw.setup.primary_profile.social_security ?? {}),
        },
        medicare: {
          ...defaultPrimary.medicare,
          ...(raw.setup.primary_profile.medicare ?? {}),
        },
      }
    : defaultPrimary;

  const spouseProfile = raw.setup.spouse_profile
    ? {
        birth_date: raw.setup.spouse_profile.birth_date ?? '',
        birth_month: raw.setup.spouse_profile.birth_month,
        social_security: {
          ...defaultSpouse.social_security,
          ...(raw.setup.spouse_profile.social_security ?? {}),
        },
        medicare: {
          ...defaultSpouse.medicare,
          ...(raw.setup.spouse_profile.medicare ?? {}),
        },
      }
    : defaultSpouse;

  const primaryName =
    typeof raw.setup.primary_name === 'string' ? raw.setup.primary_name : '';
  const spouseName =
    typeof raw.setup.spouse_name === 'string' ? raw.setup.spouse_name : '';

  const parsedPrimary = parseBirthDate(primaryProfile.birth_date);
  const parsedSpouse = parseBirthDate(spouseProfile.birth_date);

  const deductionMethod =
    raw.setup.deduction_method === 'itemized' ? 'itemized' : 'standard';
  const customItemized =
    typeof raw.setup.custom_itemized_deduction === 'number' &&
    Number.isFinite(raw.setup.custom_itemized_deduction)
      ? Math.max(0, raw.setup.custom_itemized_deduction)
      : 30000;

  const dbpTermYear =
    raw.setup.dbp_planned_termination_year === null
      ? null
      : typeof raw.setup.dbp_planned_termination_year === 'number' &&
        Number.isFinite(raw.setup.dbp_planned_termination_year)
      ? raw.setup.dbp_planned_termination_year
      : null;

  const postDbpRate =
    typeof raw.setup.post_dbp_profit_sharing_rate === 'number' &&
    Number.isFinite(raw.setup.post_dbp_profit_sharing_rate)
      ? Math.min(0.25, Math.max(0, raw.setup.post_dbp_profit_sharing_rate))
      : 0.06;

  const rawFirstYear = raw.years[0];
  const rawEntityName = rawFirstYear?.scorp_1120s.entity_name?.trim() || '';
  const rawEntityEin = rawFirstYear?.scorp_1120s.entity_ein?.trim() || '';
  const isExplicitNonDefaultKind =
    raw.setup.workspace_profile_kind === 'custom' ||
    raw.setup.workspace_profile_kind === 'test_persona' ||
    raw.setup.workspace_profile_kind === 'blank';
  const isDefaultSeedEntityEarly =
    !isExplicitNonDefaultKind &&
    (rawEntityEin === DEFAULT_PROFILE_SEED.business_ein ||
      rawEntityName.toLowerCase() === DEFAULT_PROFILE_SEED.business_name.toLowerCase());

  // Detect legacy saved profiles where 2025 one-time 1099-R IRA/pension values were carried verbatim into every unlocked forecast year
  const filed2025Seed = DEFAULT_PROFILE_SEED.shadow_return_seed.filed_2025;
  const unlockedForecastYears = raw.years.filter((y) => !y.is_locked_actuals && y.tax_year >= 2026);
  const hasStaleCarried1099R =
    unlockedForecastYears.length > 0 &&
    rawFirstYear?.is_locked_actuals &&
    rawFirstYear.tax_year === 2025 &&
    Math.round(rawFirstYear.form_1040.ira_distributions_taxable) === filed2025Seed.ira_taxable &&
    Math.round(rawFirstYear.form_1040.pensions_and_annuities_taxable) ===
      filed2025Seed.pensions_taxable &&
    unlockedForecastYears.every(
      (y) =>
        Math.round(y.form_1040.ira_distributions_taxable) === filed2025Seed.ira_taxable &&
        Math.round(y.form_1040.pensions_and_annuities_taxable) === filed2025Seed.pensions_taxable
    );

  let migratedLegacy2025Ss = false;
  let migratedLegacy2026OpEx = false;
  const normalizedYears: TaxYearRecord[] = raw.years.map((yr) => {
    const hasSpouseW2 =
      typeof yr.scorp_1120s.debra_w2_wages === 'number' &&
      Number.isFinite(yr.scorp_1120s.debra_w2_wages);
    const hasPrimaryW2 =
      typeof yr.scorp_1120s.bill_w2_wages === 'number' &&
      Number.isFinite(yr.scorp_1120s.bill_w2_wages);

    let debraW2 = yr.scorp_1120s.debra_w2_wages;
    let billW2 = yr.scorp_1120s.bill_w2_wages;
    if (!hasSpouseW2 || !hasPrimaryW2) {
      const total = yr.scorp_1120s.officer_w2_wages ?? 0;
      billW2 = round0(total * 0.5);
      debraW2 = Math.max(0, total - billW2);
    }

    // One-time migrations scoped strictly to saved default-profile 2026 records
    const legacy2026W2 = DEFAULT_PROFILE_SEED.legacy_2026_w2_with_sehi;
    const seed2026 = DEFAULT_PROFILE_SEED.forecast_2026_2030_inputs[2026];
    if (
      isDefaultSeedEntityEarly &&
      yr.tax_year === 2026 &&
      !yr.is_locked_actuals &&
      seed2026 &&
      billW2 === legacy2026W2.bill_w2 &&
      debraW2 === legacy2026W2.debra_w2
    ) {
      billW2 = seed2026.bill_w2;
      debraW2 = seed2026.debra_w2;
    }

    let opEx =
      typeof yr.scorp_1120s.operating_expenses === 'number' &&
      Number.isFinite(yr.scorp_1120s.operating_expenses)
        ? Math.max(0, yr.scorp_1120s.operating_expenses)
        : 0;
    if (
      isDefaultSeedEntityEarly &&
      yr.tax_year === 2026 &&
      !yr.is_locked_actuals &&
      seed2026 &&
      typeof seed2026.operating_expenses === 'number' &&
      opEx === DEFAULT_PROFILE_SEED.legacy_2026_operating_expenses &&
      yr.scorp_1120s.operating_expenses_override == null
    ) {
      opEx = seed2026.operating_expenses;
      migratedLegacy2026OpEx = true;
    }

    let capContrib =
      typeof yr.scorp_1120s.capital_contributions === 'number' &&
      Number.isFinite(yr.scorp_1120s.capital_contributions)
        ? Math.max(0, yr.scorp_1120s.capital_contributions)
        : 0;
    if (
      isDefaultSeedEntityEarly &&
      yr.tax_year === 2026 &&
      !yr.is_locked_actuals &&
      seed2026 &&
      capContrib === DEFAULT_PROFILE_SEED.legacy_2026_capital_contributions
    ) {
      capContrib = seed2026.capital_contributions;
    }

    const hasCaRev =
      typeof yr.scorp_1120s.ca_revenue === 'number' &&
      Number.isFinite(yr.scorp_1120s.ca_revenue);
    const hasAzRev =
      typeof yr.scorp_1120s.az_revenue === 'number' &&
      Number.isFinite(yr.scorp_1120s.az_revenue);
    let caRev = yr.scorp_1120s.ca_revenue;
    let azRev = yr.scorp_1120s.az_revenue;
    if (!hasCaRev || !hasAzRev) {
      const totalRev = yr.scorp_1120s.gross_receipts_revenue ?? 0;
      const primaryFactor =
        yr.state_filings[0]?.state_apportionment_factor ?? 1;
      caRev = round0(totalRev * primaryFactor);
      azRev = Math.max(0, totalRev - caRev);
    }

    // Seamlessly migrate legacy saved default-profile 2025 records without affecting other households
    const legacyBench = DEFAULT_PROFILE_SEED.verification_benchmarks_2025;
    let migratedForm1040 = yr.form_1040;
    if (
      yr.tax_year === 2025 &&
      yr.is_locked_actuals &&
      migratedForm1040.schedule_d_includes_excess_gain &&
      migratedForm1040.long_term_capital_gain_loss === legacyBench.schedule_d_net_filed
    ) {
      migratedForm1040 = {
        ...migratedForm1040,
        long_term_capital_gain_loss: -60,
        schedule_d_includes_excess_gain: false,
      };
    }
    if (
      yr.tax_year === 2025 &&
      yr.is_locked_actuals &&
      migratedForm1040.social_security_gross === legacyBench.ss_annual_test_amount * 2 &&
      migratedForm1040.ss_bill_override === legacyBench.ss_annual_test_amount &&
      migratedForm1040.ss_debra_override === legacyBench.ss_annual_test_amount
    ) {
      migratedLegacy2025Ss = true;
      migratedForm1040 = {
        ...migratedForm1040,
        social_security_gross: 0,
        ss_bill_mode: 'off',
        ss_bill_override: null,
        ss_debra_mode: 'off',
        ss_debra_override: null,
      };
    }

    if (hasStaleCarried1099R && !yr.is_locked_actuals && yr.tax_year >= 2026) {
      migratedForm1040 = {
        ...migratedForm1040,
        ira_distributions_gross: 0,
        ira_distributions_taxable: 0,
        pensions_and_annuities_gross: 0,
        pensions_and_annuities_taxable: 0,
      };
    }

    return {
      ...yr,
      form_1040: migratedForm1040,
      scorp_1120s: {
        ...yr.scorp_1120s,
        ca_revenue: caRev,
        az_revenue: azRev,
        gross_receipts_revenue: caRev + azRev,
        operating_expenses: opEx,
        operating_expenses_override:
          typeof yr.scorp_1120s.operating_expenses_override === 'number' &&
          Number.isFinite(yr.scorp_1120s.operating_expenses_override)
            ? Math.max(0, round0(yr.scorp_1120s.operating_expenses_override))
            : null,
        debra_w2_wages: debraW2,
        bill_w2_wages: billW2,
        officer_w2_wages: debraW2 + billW2,
        capital_contributions: capContrib,
      },
    };
  });

  if (migratedLegacy2025Ss) {
    if (!primaryProfile.social_security.receiving && primaryProfile.social_security.monthly_benefit === null) {
      primaryProfile.social_security = {
        ...primaryProfile.social_security,
        receiving: true,
        monthly_benefit: DEFAULT_PROFILE_SEED.primary_ss_monthly,
      };
    }
    if (!spouseProfile.social_security.receiving && spouseProfile.social_security.monthly_benefit === null) {
      spouseProfile.social_security = {
        ...spouseProfile.social_security,
        receiving: true,
        monthly_benefit: DEFAULT_PROFILE_SEED.spouse_ss_monthly,
      };
    }
  }

  const firstYear = normalizedYears[0];
  const inferredEntityName = firstYear?.scorp_1120s.entity_name?.trim() || '';
  const inferredEntityEin = firstYear?.scorp_1120s.entity_ein?.trim() || '';
  const isDefaultSeedEntity =
    !isExplicitNonDefaultKind &&
    (inferredEntityEin === DEFAULT_PROFILE_SEED.business_ein ||
      inferredEntityName.toLowerCase() === DEFAULT_PROFILE_SEED.business_name.toLowerCase());

  const businessName =
    typeof raw.setup.business_name === 'string'
      ? raw.setup.business_name
      : inferredEntityName;
  const businessWebsite =
    typeof raw.setup.business_website === 'string'
      ? raw.setup.business_website
      : isDefaultSeedEntity
      ? DEFAULT_PROFILE_SEED.business_website
      : '';
  const businessEin =
    typeof raw.setup.business_ein === 'string'
      ? raw.setup.business_ein
      : inferredEntityEin;

  const firstResidentState =
    firstYear?.state_filings.find((sf) => sf.residency_status === 'resident')?.state_code ??
    firstYear?.state_filings[0]?.state_code ??
    '';
  const secondState =
    firstYear?.state_filings.find((sf) => sf.state_code !== firstResidentState)?.state_code ?? '';

  const homeState =
    typeof raw.setup.home_state === 'string' ? raw.setup.home_state : firstResidentState;
  const secondaryState =
    typeof raw.setup.secondary_state === 'string' ? raw.setup.secondary_state : secondState;

  const workspaceProfileKind =
    raw.setup.workspace_profile_kind ??
    (isDefaultSeedEntity ? 'default' : 'custom');

  const currentTaxYear =
    typeof raw.setup.current_tax_year === 'number' &&
    Number.isFinite(raw.setup.current_tax_year)
      ? raw.setup.current_tax_year
      : raw.setup.forecast_years?.[1] ?? 2026;

  const ssColaRate =
    typeof raw.setup.assumptions?.ss_cola_rate === 'number' &&
    Number.isFinite(raw.setup.assumptions.ss_cola_rate)
      ? Math.max(0, raw.setup.assumptions.ss_cola_rate)
      : 0.026;

  const medicareInflationRate =
    typeof raw.setup.assumptions?.medicare_inflation_rate === 'number' &&
    Number.isFinite(raw.setup.assumptions.medicare_inflation_rate)
      ? Math.max(0, raw.setup.assumptions.medicare_inflation_rate)
      : 0.055;

  const irmaaThresholdGrowthRate =
    typeof raw.setup.assumptions?.irmaa_threshold_growth_rate === 'number' &&
    Number.isFinite(raw.setup.assumptions.irmaa_threshold_growth_rate)
      ? Math.max(0, raw.setup.assumptions.irmaa_threshold_growth_rate)
      : DEFAULT_IRMAA_GROWTH_RATE;

  const irmaaThresholdOverrides = sanitizeIrmaaThresholdOverrides(
    raw.setup.irmaa_threshold_overrides
  );

  const rawActuarial = raw.setup.dbp_actuarial;
  const fallbackActuarial = isDefaultSeedEntity
    ? DEFAULT_PROFILE_SEED.dbp_actuarial_baseline
    : {
        historical_high_3_w2: 0,
        boy_assets_anchor: 0,
        plan_year_anchor: 1,
        trust_growth_rate: 0,
        valuation_interest_rate: 0.05,
      };
  const normalizedDbpActuarial = {
    historical_high_3_w2:
      typeof rawActuarial?.historical_high_3_w2 === 'number' &&
      Number.isFinite(rawActuarial.historical_high_3_w2)
        ? Math.max(0, Math.round(rawActuarial.historical_high_3_w2))
        : fallbackActuarial.historical_high_3_w2,
    boy_assets_anchor:
      typeof rawActuarial?.boy_assets_anchor === 'number' &&
      Number.isFinite(rawActuarial.boy_assets_anchor)
        ? Math.max(0, Math.round(rawActuarial.boy_assets_anchor))
        : fallbackActuarial.boy_assets_anchor,
    plan_year_anchor:
      typeof rawActuarial?.plan_year_anchor === 'number' &&
      Number.isFinite(rawActuarial.plan_year_anchor)
        ? Math.min(40, Math.max(1, Math.round(rawActuarial.plan_year_anchor)))
        : fallbackActuarial.plan_year_anchor,
    trust_growth_rate:
      typeof rawActuarial?.trust_growth_rate === 'number' &&
      Number.isFinite(rawActuarial.trust_growth_rate)
        ? Math.min(0.25, Math.max(-0.2, rawActuarial.trust_growth_rate))
        : fallbackActuarial.trust_growth_rate,
    valuation_interest_rate:
      typeof rawActuarial?.valuation_interest_rate === 'number' &&
      Number.isFinite(rawActuarial.valuation_interest_rate)
        ? Math.min(0.12, Math.max(0.01, rawActuarial.valuation_interest_rate))
        : fallbackActuarial.valuation_interest_rate,
  };

  const normalizedSetupBase: SetupConfig = {
    ...raw.setup,
    primary_name: primaryName,
    spouse_name: spouseName,
    primary_profile: primaryProfile,
    spouse_profile: spouseProfile,
    primary_birth_year: parsedPrimary ? parsedPrimary.year : raw.setup.primary_birth_year,
    spouse_birth_year: parsedSpouse ? parsedSpouse.year : raw.setup.spouse_birth_year,
    business_name: businessName,
    business_website: businessWebsite,
    business_ein: businessEin,
    home_state: homeState,
    secondary_state: secondaryState,
    workspace_profile_kind: workspaceProfileKind,
    deduction_method: deductionMethod,
    custom_itemized_deduction: customItemized,
    has_ss_medicare:
      typeof raw.setup.has_ss_medicare === 'boolean' ? raw.setup.has_ss_medicare : true,
    has_stock_basis:
      typeof raw.setup.has_stock_basis === 'boolean'
        ? raw.setup.has_stock_basis
        : Boolean(raw.setup.has_scorp),
    dbp_planned_termination_year: dbpTermYear,
    post_dbp_profit_sharing_rate: postDbpRate,
    dbp_actuarial: normalizedDbpActuarial,
    current_tax_year: currentTaxYear,
    assumptions: {
      ...raw.setup.assumptions,
      ss_cola_rate: ssColaRate,
      medicare_inflation_rate: medicareInflationRate,
      irmaa_threshold_growth_rate: irmaaThresholdGrowthRate,
      expense_ratio:
        isDefaultSeedEntity &&
        migratedLegacy2026OpEx &&
        raw.setup.assumptions?.expense_ratio === DEFAULT_PROFILE_SEED.legacy_expense_ratio
          ? DEFAULT_PROFILE_SEED.default_expense_ratio
          : typeof raw.setup.assumptions?.expense_ratio === 'number' &&
            Number.isFinite(raw.setup.assumptions.expense_ratio)
          ? Math.min(1, Math.max(0, raw.setup.assumptions.expense_ratio))
          : 0.2,
      opex_scaling_mode:
        raw.setup.assumptions?.opex_scaling_mode === 'fixed_inflation'
          ? 'fixed_inflation'
          : 'revenue_proportional',
    },
    irmaa_threshold_overrides: irmaaThresholdOverrides,
  };

  // Normalize Setup state_revenue_apportionment & migrate legacy 50/50 default-profile forecast years
  // to the 37% CA / 63% AZ default split while preserving any custom user edits.
  const activeBusinessStates = getActiveBusinessStates(normalizedSetupBase);
  let stateApportionmentConfig = normalizeStateApportionmentConfig(
    raw.setup.state_revenue_apportionment,
    normalizedSetupBase
  );
  let finalYears = normalizedYears;

  if (!raw.setup.state_revenue_apportionment && activeBusinessStates.length >= 2) {
    const [pCode, sCode] = activeBusinessStates;
    const forecastNonLocked = normalizedYears.filter(
      (yr) => !yr.is_locked_actuals && yr.tax_year !== raw.setup.anchor_actuals_year
    );

    const isLegacy5050Year = (yr: TaxYearRecord): boolean => {
      const caRev = yr.scorp_1120s.ca_revenue;
      const azRev = yr.scorp_1120s.az_revenue;
      const leg = DEFAULT_PROFILE_SEED.legacy_5050_forecast_revenues[yr.tax_year];
      if (leg && caRev === leg.ca_revenue && azRev === leg.az_revenue) return true;
      return isDefaultSeedEntity && caRev > 0 && Math.abs(caRev - azRev) <= 1;
    };

    const legacy5050Years = isDefaultSeedEntity
      ? forecastNonLocked.filter(isLegacy5050Year)
      : [];

    if (isDefaultSeedEntity && legacy5050Years.length > 0) {
      const seedDefault = { ...DEFAULT_PROFILE_SEED.default_state_revenue_split };
      const yearOverrides: Record<number, Record<string, number>> = {};
      const legacyYearSet = new Set(legacy5050Years.map((y) => y.tax_year));

      // Preserve any custom user-edited non-50/50 forecast years as explicit year overrides
      for (const yr of forecastNonLocked) {
        if (legacyYearSet.has(yr.tax_year)) continue;
        const tot = yr.scorp_1120s.ca_revenue + yr.scorp_1120s.az_revenue;
        if (tot <= 0) continue;
        const pPct = Math.round((yr.scorp_1120s.ca_revenue / tot) * 1000) / 10;
        const sPct = Math.round((100 - pPct) * 10) / 10;
        const defaultPrimary = seedDefault[pCode] ?? 50;
        if (Math.abs(pPct - defaultPrimary) > 0.5) {
          yearOverrides[yr.tax_year] = { [pCode]: pPct, [sCode]: sPct };
        }
      }

      stateApportionmentConfig = normalizeStateApportionmentConfig(
        { default_split: seedDefault, year_overrides: yearOverrides },
        normalizedSetupBase
      );

      const setupWithSplit: SetupConfig = {
        ...normalizedSetupBase,
        state_revenue_apportionment: stateApportionmentConfig,
      };
      finalYears = normalizedYears.map((yr) =>
        legacyYearSet.has(yr.tax_year) ? applySetupApportionmentToYear(yr, setupWithSplit) : yr
      );
    } else {
      // Non-default household or default household where user customized all years away from 50/50:
      // infer default split from first positive forecast year and preserve per-year differences.
      const firstPos = forecastNonLocked.find(
        (yr) => yr.scorp_1120s.ca_revenue + yr.scorp_1120s.az_revenue > 0
      );
      const inferredPrimaryPct = firstPos
        ? Math.round(
            (firstPos.scorp_1120s.ca_revenue /
              (firstPos.scorp_1120s.ca_revenue + firstPos.scorp_1120s.az_revenue)) *
              1000
          ) / 10
        : 50;
      const inferredDefault = {
        [pCode]: inferredPrimaryPct,
        [sCode]: Math.round((100 - inferredPrimaryPct) * 10) / 10,
      };
      const yearOverrides: Record<number, Record<string, number>> = {};
      for (const yr of forecastNonLocked) {
        const tot = yr.scorp_1120s.ca_revenue + yr.scorp_1120s.az_revenue;
        if (tot <= 0) continue;
        const pPct = Math.round((yr.scorp_1120s.ca_revenue / tot) * 1000) / 10;
        if (Math.abs(pPct - inferredPrimaryPct) > 0.5) {
          yearOverrides[yr.tax_year] = {
            [pCode]: pPct,
            [sCode]: Math.round((100 - pPct) * 10) / 10,
          };
        }
      }
      stateApportionmentConfig = normalizeStateApportionmentConfig(
        { default_split: inferredDefault, year_overrides: yearOverrides },
        normalizedSetupBase,
        inferredPrimaryPct
      );
    }
  }

  const finalSetup: SetupConfig = {
    ...normalizedSetupBase,
    state_revenue_apportionment: stateApportionmentConfig,
  };

  const hiddenIds = sanitizeHiddenItemIds(raw.schedule_view?.hidden_line_item_ids);
  const year2026 = finalYears.find((y) => y.tax_year === 2026) ?? finalYears[1];
  const pnlBalanceSheet = normalizePnlBalanceSheetState(
    raw.pnl_balance_sheet,
    year2026,
    finalSetup
  );
  let normalizedCadence = raw.cadence_forecaster;
  if (normalizedCadence) {
    const needsPensionYeMigration =
      normalizedCadence.balance_sheet?.pension_payable_ye ===
      DEFAULT_PROFILE_SEED.legacy_2026_pension_payable_ye;
    const rawLineOv = normalizedCadence.pnl_line_overrides ?? {};
    const legacySeedOv = DEFAULT_PROFILE_SEED.legacy_2026_cadence_retirement_overrides;
    const hasLegacyRetSeedOv =
      rawLineOv.dbp_contribution?.ytd === undefined &&
      rawLineOv.employer_401k?.ytd === undefined &&
      rawLineOv.dbp_contribution?.remaining === legacySeedOv.dbp_contribution &&
      rawLineOv.employer_401k?.remaining === legacySeedOv.employer_401k;

    if (needsPensionYeMigration || hasLegacyRetSeedOv) {
      const nextOverrides = { ...rawLineOv };
      if (hasLegacyRetSeedOv) {
        delete nextOverrides.dbp_contribution;
        delete nextOverrides.employer_401k;
      }
      normalizedCadence = {
        ...normalizedCadence,
        pnl_line_overrides: nextOverrides,
        balance_sheet: needsPensionYeMigration
          ? {
              ...normalizedCadence.balance_sheet,
              pension_payable_ye: DEFAULT_PROFILE_SEED.default_pension_payable_ye,
            }
          : normalizedCadence.balance_sheet,
      };
    }
  }

  return {
    ...raw,
    setup: finalSetup,
    years: finalYears,
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: hiddenIds,
    },
    pnl_balance_sheet: pnlBalanceSheet,
    ...(normalizedCadence ? { cadence_forecaster: normalizedCadence } : {}),
  };
}
