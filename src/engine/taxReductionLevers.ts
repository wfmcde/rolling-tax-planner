import type { ComputedTaxYear, SetupConfig, TaxYearRecord } from '../types/tax';
import { computeDbpActuarialWaterfall, type DbpActuarialYearRow } from './dbpActuarial';
import { calculateSixYearPlan } from './taxEngine';

const round0 = (n: number): number => Math.round(n);

export type TaxReductionTriggerKind =
  | 'irmaa_cliff'
  | 'senior_phaseout'
  | 'bracket_jump';

export interface TaxReductionTrigger {
  kind: TaxReductionTriggerKind;
  label: string;
  detail: string;
  severity: 'danger' | 'warning';
}

export interface Employee401kRoomSummary {
  enabled: boolean;
  statutoryCapTotal: number;
  wageCappedMaxTotal: number;
  currentUsedTotal: number;
  remainingAtCurrentW2: number;
  remainingStatutoryWithHigherW2: number;
}

export interface Employer401kRoomSummary {
  enabled: boolean;
  statutoryMaxRate: number; // 0.06 while DBP active; 0.25 once DBP terminated/inactive
  appliedRate: number;
  statutoryMaxDollars: number;
  currentUsedDollars: number;
  remainingRoomDollars: number;
  cappedByActiveDbp: boolean;
}

export interface DbpTopUpRoomSummary {
  /** True only when DBP is active or terminating in this year (auto-hidden when inactive, terminated, or frozen) */
  visible: boolean;
  dbpStatus: DbpActuarialYearRow['dbpStatus'];
  planYear: number;
  plannedDbp: number;
  dynamic404Max: number;
  remainingRoom: number;
  statutoryCeiling: number;
  headroomToCeiling: number;
}

export interface TaxReductionYearAnalysis {
  taxYear: number;
  yearIndex: number;
  triggers: TaxReductionTrigger[];
  currentAgi: number;
  currentMagi: number;
  irmaaFutureCoverageYear: number;
  irmaaFutureTier1Threshold: number;
  magiOverIrmaaCliff: number;
  seniorDeductionLost: number;
  seniorDeductionMax: number;
  marginalTaxRate: number;
  prevMarginalTaxRate: number | null;
  nextBracketHeadroom: number | null;
  nextBracketRate: number | null;
  currentEffectiveOpex: number;
  currentGrossRevenue: number;
  currentK1OrdinaryIncome: number;
  nextYearTaxYear: number | null;
  nextYearMagiHeadroomToCliff: number | null;
  employee401k: Employee401kRoomSummary;
  employer401k: Employer401kRoomSummary;
  dbpTopUp: DbpTopUpRoomSummary;
}

export interface TaxReductionScratchpadInput {
  prepaidOpex: number;
  equipment179: number;
  billingDeferral: number;
  extraDbp: number;
}

export interface TaxReductionScratchpadSimulation {
  totalReductionAttempted: number;
  baselineMagi: number;
  projectedMagi: number;
  magiDelta: number;
  baselineAgi: number;
  projectedAgi: number;
  irmaaCliffThreshold: number;
  irmaaCoverageYear: number;
  baselineOverCliff: number;
  projectedOverCliff: number;
  cliffCleared: boolean;
  baselineTotalTax: number;
  projectedTotalTax: number;
  estimatedTaxSavings: number;
  baselineFederalTax: number;
  projectedFederalTax: number;
  baselineStateTax: number;
  projectedStateTax: number;
  baselineSeniorAllowed: number;
  projectedSeniorAllowed: number;
  seniorDeductionRecovered: number;
  baselineMarginalRate: number;
  projectedMarginalRate: number;
  baselineK1: number;
  projectedK1: number;
  exceedsDbpRoom: boolean;
}

function inflationScale(taxYear: number, inflationRate: number): number {
  const delta = Math.max(0, taxYear - 2025);
  return Math.pow(1 + Math.max(0, inflationRate), delta);
}

function computePersonFicaTax(wages: number, ssWageBase: number): number {
  if (wages <= 0) return 0;
  return round0(Math.min(wages, ssWageBase) * 0.062 + wages * 0.0145);
}

function computePersonStatutory401kRoom(
  wages: number,
  age: number | null,
  ssWageBase: number,
  scale: number,
  maxEmployerRate: number,
  enabled: boolean
): {
  statutoryEmployeeMax: number;
  wageCappedEmployeeMax: number;
  statutoryEmployerMax: number;
} {
  if (!enabled) {
    return {
      statutoryEmployeeMax: 0,
      wageCappedEmployeeMax: 0,
      statutoryEmployerMax: 0,
    };
  }
  const base402g = Math.round((23500 * scale) / 500) * 500;
  const catchUp =
    age !== null && age >= 60 && age <= 63
      ? Math.round((11250 * scale) / 250) * 250
      : age !== null && age >= 50
      ? Math.round((7500 * scale) / 500) * 500
      : 0;
  const statutoryEmployeeMax = base402g + catchUp;

  const safeWages = Math.max(0, wages);
  const empFica = computePersonFicaTax(safeWages, ssWageBase);
  const netW2Available = Math.max(0, safeWages - empFica);
  const wageCappedEmployeeMax = round0(Math.min(netW2Available, statutoryEmployeeMax));

  const limit415c = Math.round((70000 * scale) / 1000) * 1000;
  const baseDeferralUsed = Math.min(wageCappedEmployeeMax, base402g);
  const room415c = Math.max(0, Math.min(safeWages, limit415c) - baseDeferralUsed);
  const rawEmployerMax = round0(safeWages * Math.min(0.25, Math.max(0, maxEmployerRate)));
  const statutoryEmployerMax = round0(Math.min(rawEmployerMax, room415c));

  return {
    statutoryEmployeeMax,
    wageCappedEmployeeMax,
    statutoryEmployerMax,
  };
}

/**
 * Analyzes every unlocked tax year in the 6-year horizon for actionable tax-reduction
 * triggers (IRMAA Cliff, Senior Deduction phaseout, or federal bracket jump) and
 * computes live remaining statutory room by deadline (Before Dec 31 vs. Before Filing/Extension).
 */
export function analyzeActionableTaxReductionYears(
  setup: SetupConfig,
  years: TaxYearRecord[],
  computed: ComputedTaxYear[]
): TaxReductionYearAnalysis[] {
  const waterfall = computeDbpActuarialWaterfall(setup, years, computed);
  const analyses: TaxReductionYearAnalysis[] = [];

  for (let i = 0; i < computed.length; i++) {
    const c = computed[i];
    if (c.is_locked_actuals) continue;

    const prev = i > 0 ? computed[i - 1] : null;
    const next = i + 1 < computed.length ? computed[i + 1] : null;
    const wfRow = waterfall.rows[i];
    const triggers: TaxReductionTrigger[] = [];

    const currentAgi = c.form_1040_out.adjusted_gross_income;
    const currentMagi = currentAgi + Math.max(0, c.form_1040_in.tax_exempt_interest || 0);
    const futureCliff = c.form_1040_out.irmaa_future_tier1_threshold;
    const futureCovYear = c.form_1040_out.irmaa_future_coverage_year;
    const magiOverIrmaaCliff = Math.max(0, currentMagi - futureCliff);

    // Trigger 1: IRMAA Cliff (current-year MAGI triggers +2yr coverage cliff, or active surcharge)
    if (setup.has_ss_medicare !== false) {
      if (c.form_1040_out.irmaa_current_magi_exceeds_cliff) {
        triggers.push({
          kind: 'irmaa_cliff',
          label: `${futureCovYear} IRMAA Cliff`,
          detail: `MAGI exceeds ${futureCovYear} Tier 1 threshold by $${magiOverIrmaaCliff.toLocaleString()}`,
          severity: 'danger',
        });
      } else if (c.form_1040_out.irmaa_annual_surcharge > 0) {
        triggers.push({
          kind: 'irmaa_cliff',
          label: `${c.tax_year} IRMAA Surcharge`,
          detail: `Active $${c.form_1040_out.irmaa_annual_surcharge.toLocaleString()}/yr surcharge from ${c.form_1040_out.irmaa_lookback_year} MAGI`,
          severity: 'danger',
        });
      }
    }

    // Trigger 2: Enhanced Senior Deduction phaseout
    const seniorLost = c.form_1040_out.enhanced_senior_deduction_lost;
    if (seniorLost > 0) {
      triggers.push({
        kind: 'senior_phaseout',
        label: 'Senior Deduction Phaseout',
        detail: `$${seniorLost.toLocaleString()} of $${c.form_1040_out.enhanced_senior_deduction_max.toLocaleString()} senior deduction lost to MAGI`,
        severity: 'warning',
      });
    }

    // Trigger 3: Federal Bracket Jump (rate stepped up vs. prior year, or <$15k headroom to next tier)
    const margRate = c.form_1040_out.marginal_tax_rate;
    const prevMargRate = prev ? prev.form_1040_out.marginal_tax_rate : null;
    const headroom = c.form_1040_out.next_bracket_headroom;
    const nextRate = c.form_1040_out.next_bracket_rate;

    if (prevMargRate !== null && margRate > prevMargRate && margRate >= 22) {
      triggers.push({
        kind: 'bracket_jump',
        label: `Bracket Jump (${prevMargRate}% → ${margRate}%)`,
        detail: `Marginal federal bracket steps up from ${prevMargRate}% in ${prev!.tax_year} to ${margRate}% in ${c.tax_year}`,
        severity: 'warning',
      });
    } else if (
      headroom !== null &&
      nextRate !== null &&
      headroom < 15000 &&
      c.form_1040_out.taxable_income > 0
    ) {
      triggers.push({
        kind: 'bracket_jump',
        label: `Near ${nextRate}% Bracket`,
        detail: `Only $${headroom.toLocaleString()} taxable income headroom before jumping to ${nextRate}%`,
        severity: 'warning',
      });
    }

    if (triggers.length === 0) continue;

    // Live statutory 401(k) remaining room (Employee & Employer)
    const scale = inflationScale(c.tax_year, setup.assumptions.inflation_rate);
    const ssWageBase = round0(176100 * scale);
    const isJoint = setup.filing_status === 'married_filing_jointly';
    const primaryW2 = setup.has_scorp ? c.scorp_in.bill_w2_wages : c.form_1040_in.w2_wages_total;
    const spouseW2 = setup.has_scorp && isJoint ? c.scorp_in.debra_w2_wages : 0;

    const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
    const isDbpTerminatedOrInactive =
      !setup.has_dbp ||
      c.dbp_in.dbp_status === 'terminated' ||
      (termYear !== null && c.tax_year > termYear && c.dbp_in.dbp_status !== 'active');
    const maxStatutoryEmployerRate = isDbpTerminatedOrInactive ? 0.25 : 0.06;

    const primary401k = computePersonStatutory401kRoom(
      primaryW2,
      c.primary_age,
      ssWageBase,
      scale,
      maxStatutoryEmployerRate,
      setup.has_401k_or_ira
    );
    const spouse401k = computePersonStatutory401kRoom(
      spouseW2,
      c.spouse_age,
      ssWageBase,
      scale,
      maxStatutoryEmployerRate,
      setup.has_401k_or_ira && isJoint
    );

    const statutoryEmpCap = primary401k.statutoryEmployeeMax + spouse401k.statutoryEmployeeMax;
    const wageCappedEmpMax = primary401k.wageCappedEmployeeMax + spouse401k.wageCappedEmployeeMax;
    const usedEmp401k = c.form_1040_out.employee_401k_total;

    const statutoryErMax = setup.has_scorp
      ? primary401k.statutoryEmployerMax + spouse401k.statutoryEmployerMax
      : 0;
    const usedEr401k = c.form_1040_out.employer_401k_total;

    // Live DBP Top-Up Room from DBP Actuarial Waterfall (auto-hidden when Terminated, Frozen, or DBP off)
    const dbpVisible = Boolean(
      setup.has_dbp &&
        wfRow &&
        wfRow.dbpStatus !== 'terminated' &&
        wfRow.dbpStatus !== 'frozen'
    );
    const dbpTopUp: DbpTopUpRoomSummary = {
      visible: dbpVisible,
      dbpStatus: wfRow?.dbpStatus ?? 'terminated',
      planYear: wfRow?.planYear ?? 1,
      plannedDbp: wfRow?.plannedDbp ?? 0,
      dynamic404Max: wfRow?.dynamic404Max ?? 0,
      remainingRoom: dbpVisible && wfRow ? Math.max(0, wfRow.dynamic404Max - wfRow.plannedDbp) : 0,
      statutoryCeiling: wfRow?.statutoryCeiling ?? 0,
      headroomToCeiling: wfRow?.headroomToCeiling ?? 0,
    };

    const nextYearMagiHeadroomToCliff = next
      ? next.form_1040_out.irmaa_future_tier1_threshold -
        (next.form_1040_out.adjusted_gross_income +
          Math.max(0, next.form_1040_in.tax_exempt_interest || 0))
      : null;

    analyses.push({
      taxYear: c.tax_year,
      yearIndex: i,
      triggers,
      currentAgi,
      currentMagi,
      irmaaFutureCoverageYear: futureCovYear,
      irmaaFutureTier1Threshold: futureCliff,
      magiOverIrmaaCliff,
      seniorDeductionLost: seniorLost,
      seniorDeductionMax: c.form_1040_out.enhanced_senior_deduction_max,
      marginalTaxRate: margRate,
      prevMarginalTaxRate: prevMargRate,
      nextBracketHeadroom: headroom,
      nextBracketRate: nextRate,
      currentEffectiveOpex: c.scorp_out.effective_operating_expenses,
      currentGrossRevenue: c.scorp_in.gross_receipts_revenue,
      currentK1OrdinaryIncome: c.scorp_out.ordinary_business_income_1120s,
      nextYearTaxYear: next?.tax_year ?? null,
      nextYearMagiHeadroomToCliff,
      employee401k: {
        enabled: setup.has_401k_or_ira,
        statutoryCapTotal: statutoryEmpCap,
        wageCappedMaxTotal: wageCappedEmpMax,
        currentUsedTotal: usedEmp401k,
        remainingAtCurrentW2: Math.max(0, wageCappedEmpMax - usedEmp401k),
        remainingStatutoryWithHigherW2: Math.max(0, statutoryEmpCap - usedEmp401k),
      },
      employer401k: {
        enabled: setup.has_scorp && setup.has_401k_or_ira,
        statutoryMaxRate: maxStatutoryEmployerRate,
        appliedRate: c.form_1040_out.employer_401k_rate_applied,
        statutoryMaxDollars: statutoryErMax,
        currentUsedDollars: usedEr401k,
        remainingRoomDollars: Math.max(0, statutoryErMax - usedEr401k),
        cappedByActiveDbp: !isDbpTerminatedOrInactive,
      },
      dbpTopUp,
    });
  }

  return analyses;
}

/**
 * Produces a patched TaxYearRecord applying tested scratchpad amounts (prepaid OpEx,
 * equipment/Sec 179, billing deferral, and extra DBP top-up). Locked actuals are never mutated.
 */
export function applyTaxReductionScratchpadToYear(
  yr: TaxYearRecord,
  setup: SetupConfig,
  currentEffectiveOpex: number,
  scratch: TaxReductionScratchpadInput
): TaxYearRecord {
  if (yr.is_locked_actuals) return yr;

  const prepaid = Math.max(0, round0(Number.isFinite(scratch.prepaidOpex) ? scratch.prepaidOpex : 0));
  const equip = Math.max(0, round0(Number.isFinite(scratch.equipment179) ? scratch.equipment179 : 0));
  const defer = Math.max(0, round0(Number.isFinite(scratch.billingDeferral) ? scratch.billingDeferral : 0));
  const extraDbp = Math.max(0, round0(Number.isFinite(scratch.extraDbp) ? scratch.extraDbp : 0));

  const addedOpex = prepaid + equip;
  const nextOpex = Math.max(0, round0(currentEffectiveOpex + addedOpex));
  const isFutureForecastYear = yr.tax_year > setup.current_tax_year;
  const isProportionalMode =
    (setup.assumptions.opex_scaling_mode ?? 'revenue_proportional') === 'revenue_proportional';

  // Proportionally reduce gross receipts if billing deferral is tested
  const currCa = Math.max(0, yr.scorp_1120s.ca_revenue);
  const currAz = Math.max(0, yr.scorp_1120s.az_revenue);
  const currTotalRev = currCa + currAz;
  const effectiveDefer = Math.min(currTotalRev, defer);
  const nextTotalRev = Math.max(0, currTotalRev - effectiveDefer);
  const caShare = currTotalRev > 0 ? currCa / currTotalRev : 1;
  const nextCaRev = round0(nextTotalRev * caShare);
  const nextAzRev = Math.max(0, nextTotalRev - nextCaRev);

  const canAddDbp =
    setup.has_dbp &&
    yr.dbp_and_retirement.dbp_status !== 'terminated' &&
    yr.dbp_and_retirement.dbp_status !== 'frozen';
  const nextDbpContrib = canAddDbp
    ? yr.dbp_and_retirement.dbp_actual_contribution + extraDbp
    : yr.dbp_and_retirement.dbp_actual_contribution;

  return {
    ...yr,
    scorp_1120s: {
      ...yr.scorp_1120s,
      ca_revenue: effectiveDefer > 0 ? nextCaRev : yr.scorp_1120s.ca_revenue,
      az_revenue: effectiveDefer > 0 ? nextAzRev : yr.scorp_1120s.az_revenue,
      gross_receipts_revenue: effectiveDefer > 0 ? nextTotalRev : yr.scorp_1120s.gross_receipts_revenue,
      operating_expenses:
        addedOpex > 0 && !(isFutureForecastYear && isProportionalMode)
          ? nextOpex
          : yr.scorp_1120s.operating_expenses,
      operating_expenses_override:
        addedOpex > 0 && isFutureForecastYear && isProportionalMode
          ? nextOpex
          : yr.scorp_1120s.operating_expenses_override,
    },
    dbp_and_retirement: {
      ...yr.dbp_and_retirement,
      dbp_actual_contribution: nextDbpContrib,
      dbp_max_deductible_contribution: Math.max(
        yr.dbp_and_retirement.dbp_max_deductible_contribution,
        nextDbpContrib
      ),
    },
  };
}

/**
 * Deterministically evaluates a user's Quick-Test Scratchpad levers against the full
 * 6-year tax engine without mutating saved state.
 */
export function simulateTaxReductionScratchpad(
  setup: SetupConfig,
  years: TaxYearRecord[],
  baselineComputed: ComputedTaxYear[],
  analysis: TaxReductionYearAnalysis,
  scratch: TaxReductionScratchpadInput
): TaxReductionScratchpadSimulation {
  const baseComp = baselineComputed[analysis.yearIndex];
  const prepaid = Math.max(0, round0(Number.isFinite(scratch.prepaidOpex) ? scratch.prepaidOpex : 0));
  const equip = Math.max(0, round0(Number.isFinite(scratch.equipment179) ? scratch.equipment179 : 0));
  const defer = Math.max(0, round0(Number.isFinite(scratch.billingDeferral) ? scratch.billingDeferral : 0));
  const extraDbp = analysis.dbpTopUp.visible
    ? Math.max(0, round0(Number.isFinite(scratch.extraDbp) ? scratch.extraDbp : 0))
    : 0;

  const totalReductionAttempted = prepaid + equip + defer + extraDbp;

  const simulatedYears =
    totalReductionAttempted > 0
      ? years.map((yr) =>
          yr.tax_year === analysis.taxYear
            ? applyTaxReductionScratchpadToYear(yr, setup, analysis.currentEffectiveOpex, {
                prepaidOpex: prepaid,
                equipment179: equip,
                billingDeferral: defer,
                extraDbp,
              })
            : yr
        )
      : years;

  const simComputed =
    totalReductionAttempted > 0
      ? calculateSixYearPlan(setup, simulatedYears)
      : baselineComputed;
  const simComp = simComputed[analysis.yearIndex] ?? baseComp;

  const baselineAgi = baseComp.form_1040_out.adjusted_gross_income;
  const projectedAgi = simComp.form_1040_out.adjusted_gross_income;
  const taxExempt = Math.max(0, baseComp.form_1040_in.tax_exempt_interest || 0);
  const baselineMagi = baselineAgi + taxExempt;
  const projectedMagi = projectedAgi + taxExempt;

  const irmaaCliffThreshold = baseComp.form_1040_out.irmaa_future_tier1_threshold;
  const irmaaCoverageYear = baseComp.form_1040_out.irmaa_future_coverage_year;
  const baselineOverCliff = Math.max(0, baselineMagi - irmaaCliffThreshold);
  const projectedOverCliff = Math.max(0, projectedMagi - irmaaCliffThreshold);

  const baselineTotalTax = baseComp.total_all_in_tax;
  const projectedTotalTax = simComp.total_all_in_tax;

  return {
    totalReductionAttempted,
    baselineMagi,
    projectedMagi,
    magiDelta: projectedMagi - baselineMagi,
    baselineAgi,
    projectedAgi,
    irmaaCliffThreshold,
    irmaaCoverageYear,
    baselineOverCliff,
    projectedOverCliff,
    cliffCleared: projectedMagi <= irmaaCliffThreshold,
    baselineTotalTax,
    projectedTotalTax,
    estimatedTaxSavings: Math.max(0, baselineTotalTax - projectedTotalTax),
    baselineFederalTax: baseComp.form_1040_out.federal_income_tax,
    projectedFederalTax: simComp.form_1040_out.federal_income_tax,
    baselineStateTax: baseComp.total_state_tax,
    projectedStateTax: simComp.total_state_tax,
    baselineSeniorAllowed: baseComp.form_1040_out.enhanced_senior_deduction_allowed,
    projectedSeniorAllowed: simComp.form_1040_out.enhanced_senior_deduction_allowed,
    seniorDeductionRecovered: Math.max(
      0,
      simComp.form_1040_out.enhanced_senior_deduction_allowed -
        baseComp.form_1040_out.enhanced_senior_deduction_allowed
    ),
    baselineMarginalRate: baseComp.form_1040_out.marginal_tax_rate,
    projectedMarginalRate: simComp.form_1040_out.marginal_tax_rate,
    baselineK1: baseComp.scorp_out.ordinary_business_income_1120s,
    projectedK1: simComp.scorp_out.ordinary_business_income_1120s,
    exceedsDbpRoom:
      analysis.dbpTopUp.visible && extraDbp > analysis.dbpTopUp.remainingRoom,
  };
}
