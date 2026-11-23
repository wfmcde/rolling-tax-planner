import type {
  ComputedTaxYear,
  DbpActuarialConfig,
  DbpStatus,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { getAgeInTaxYear } from '../utils/personTax';

/**
 * Pure statutory IRC §415(b) / §417(e) / §404(o) Defined Benefit Plan
 * Actuarial Waterfall & Rolling High-3 Engine.
 *
 * ARCHITECTURE_RULES.md compliance:
 * - Zero hardcoded user names, birth dates, salaries, or Schedule SB dollar baselines.
 * - All Schedule SB inputs (historical High-3, anchor BOY assets, anchor plan year,
 *   trust growth rate, §417(e) valuation rate) are read dynamically from `setup.dbp_actuarial`.
 */

const round0 = (n: number): number => Math.round(n);

/** Statutory IRC §415(b)(1)(A) annual straight-life annuity dollar limits by tax year */
const STATUTORY_415B_DOLLAR_LIMITS: Record<number, number> = {
  2024: 275000,
  2025: 280000,
  2026: 285000,
  2027: 290000,
  2028: 295000,
  2029: 305000,
  2030: 310000,
};

export function getStatutory415bDollarLimit(taxYear: number, inflationRate = 0.025): number {
  if (STATUTORY_415B_DOLLAR_LIMITS[taxYear] !== undefined) {
    return STATUTORY_415B_DOLLAR_LIMITS[taxYear];
  }
  const baseYear = 2026;
  const baseLimit = STATUTORY_415B_DOLLAR_LIMITS[baseYear];
  const yearsDelta = taxYear - baseYear;
  const projected = baseLimit * Math.pow(1 + Math.max(0, inflationRate), yearsDelta);
  return Math.max(250000, Math.round(projected / 5000) * 5000);
}

/**
 * Statutory IRS Applicable Mortality Table approximation (unisex 50/50 mortality q_x
 * calibrated to IRS Notice 2024-76 / Pri-2012 MP-2021 unisex survival curve, ages 20–110).
 * Used exclusively to compute deterministic IRC §417(e) monthly life annuity-due factors.
 */
function getUnisexMortalityQx(age: number): number {
  if (age >= 110) return 1.0;
  if (age < 20) return 0.00035;
  // Smooth Gompertz-Makeham unisex mortality fit matching IRS unisex life expectancy
  // (~21.4 yrs remaining at age 65, ~17.5 yrs at 70, ~13.9 yrs at 75)
  const q = 0.00028 + 0.0000185 * Math.exp(0.0955 * age);
  return Math.min(1.0, Math.max(0.00025, q));
}

/**
 * Computes the IRC §417(e)(3) unisex monthly straight-life annuity-due lump-sum factor
 * (ä_x^(12)) at the participant's attained age and valuation interest rate.
 *
 * - For age >= 62 (Normal Retirement Age): immediate monthly life annuity factor ä_x^(12).
 * - For age < 62: deferred monthly life annuity commencing at NRA 62 discounted with
 *   mortality & interest back to current age (IRC §415(b)(2)(C) & §417(e)).
 */
export function compute417eUnisexFactor(
  age: number | null,
  valuationInterestRate = 0.05
): number {
  const effectiveAge =
    age !== null && Number.isFinite(age) ? Math.min(95, Math.max(25, Math.round(age))) : 62;
  const r = Math.min(0.12, Math.max(0.01, valuationInterestRate));
  const v = 1 / (1 + r);
  const nra = 62;
  const startAge = Math.max(effectiveAge, nra);

  // Immediate annual life annuity-due ä_{startAge} = sum_{k=0}^{110-startAge} v^k * k_p_{startAge}
  let survival = 1.0;
  let aDueAnnual = 0;
  for (let a = startAge; a <= 110; a++) {
    const k = a - startAge;
    aDueAnnual += Math.pow(v, k) * survival;
    const q = getUnisexMortalityQx(a);
    survival *= 1 - q;
    if (survival < 1e-8) break;
  }

  // Monthly payment adjustment (Woolhouse first-order): ä^(12) = ä - 11/24
  const immediateMonthly = Math.max(1.0, aDueAnnual - 11 / 24);

  if (effectiveAge >= nra) {
    return Number(immediateMonthly.toFixed(2));
  }

  // Defer from effectiveAge to NRA 62 with survival & discount
  let deferSurvival = 1.0;
  for (let a = effectiveAge; a < nra; a++) {
    deferSurvival *= 1 - getUnisexMortalityQx(a);
  }
  const deferYears = nra - effectiveAge;
  const deferredFactor = immediateMonthly * deferSurvival * Math.pow(v, deferYears);
  return Number(Math.max(1.0, deferredFactor).toFixed(2));
}

export const NEUTRAL_DBP_ACTUARIAL_CONFIG: DbpActuarialConfig = {
  historical_high_3_w2: 0,
  boy_assets_anchor: 0,
  plan_year_anchor: 1,
  trust_growth_rate: 0,
  valuation_interest_rate: 0.05,
};

export function resolveDbpActuarialConfig(setup: SetupConfig): DbpActuarialConfig {
  const raw = setup.dbp_actuarial;
  if (!raw) return { ...NEUTRAL_DBP_ACTUARIAL_CONFIG };
  return {
    historical_high_3_w2:
      typeof raw.historical_high_3_w2 === 'number' && Number.isFinite(raw.historical_high_3_w2)
        ? Math.max(0, round0(raw.historical_high_3_w2))
        : 0,
    boy_assets_anchor:
      typeof raw.boy_assets_anchor === 'number' && Number.isFinite(raw.boy_assets_anchor)
        ? Math.max(0, round0(raw.boy_assets_anchor))
        : 0,
    plan_year_anchor:
      typeof raw.plan_year_anchor === 'number' && Number.isFinite(raw.plan_year_anchor)
        ? Math.min(40, Math.max(1, round0(raw.plan_year_anchor)))
        : 1,
    trust_growth_rate:
      typeof raw.trust_growth_rate === 'number' && Number.isFinite(raw.trust_growth_rate)
        ? Math.min(0.25, Math.max(-0.2, raw.trust_growth_rate))
        : 0,
    valuation_interest_rate:
      typeof raw.valuation_interest_rate === 'number' && Number.isFinite(raw.valuation_interest_rate)
        ? Math.min(0.12, Math.max(0.01, raw.valuation_interest_rate))
        : 0.05,
  };
}

export function getSyncedYearW2Salary(setup: SetupConfig, yr: TaxYearRecord): number {
  if (setup.has_scorp) {
    return Math.max(0, round0((yr.scorp_1120s.bill_w2_wages ?? 0) + (yr.scorp_1120s.debra_w2_wages ?? 0)));
  }
  return Math.max(0, round0(yr.form_1040.w2_wages_total ?? 0));
}

export type ActuarialRowStatusCode =
  | 'inactive'
  | 'locked_actual'
  | 'terminated'
  | 'frozen'
  | 'over_ceiling'
  | 'over_404'
  | 'yr10_exit'
  | 'near_ceiling'
  | 'nominal';

export interface DbpActuarialYearRow {
  taxYear: number;
  planYear: number;
  isLockedActuals: boolean;
  dbpStatus: DbpStatus;
  participantAge: number | null;
  participantCount: number;
  w2Salary: number;
  trailing3Avg: number;
  rollingHigh3: number;
  high3Ratcheted: boolean;
  phaseInPct: number; // 0..1
  statutoryDollarCap: number;
  annuity415b: number;
  factor417e: number;
  statutoryCeiling: number;
  boyAssets: number;
  trustGrowthDollars: number;
  preContribAssets: number;
  dynamic404Max: number;
  plannedDbp: number;
  eoyAssets: number;
  rolloverOutAmount: number;
  headroomToCeiling: number;
  fundingRatioPct: number;
  statusCode: ActuarialRowStatusCode;
  statusLabel: string;
  statusNote: string;
}

export interface DbpActuarialWaterfallResult {
  config: DbpActuarialConfig;
  rows: DbpActuarialYearRow[];
  yr10TaxYear: number | null;
  totalSixYearPlannedDbp: number;
  totalSixYearDynamic404Room: number;
  peakEoyAssets: number;
  peakStatutoryCeiling: number;
  projectedExitRollover: number;
  overLimitYearCount: number;
  overCeilingYearCount: number;
}

export function computeDbpActuarialWaterfall(
  setup: SetupConfig,
  years: TaxYearRecord[],
  computed?: ComputedTaxYear[]
): DbpActuarialWaterfallResult {
  const config = resolveDbpActuarialConfig(setup);
  const isJoint = setup.filing_status === 'married_filing_jointly';
  const rows: DbpActuarialYearRow[] = [];

  const w2History: number[] = years.map((yr) => getSyncedYearW2Salary(setup, yr));
  let runningHigh3 = config.historical_high_3_w2;
  let runningAssets = setup.has_dbp || config.boy_assets_anchor > 0 ? config.boy_assets_anchor : 0;

  for (let idx = 0; idx < years.length; idx++) {
    const yr = years[idx];
    const comp = computed?.find((c) => c.tax_year === yr.tax_year);
    const planYear = config.plan_year_anchor + idx;
    const dbpIn = yr.dbp_and_retirement;
    const dbpStatus: DbpStatus = setup.has_dbp ? dbpIn.dbp_status : 'terminated';
    const isTerminated = !setup.has_dbp || dbpStatus === 'terminated';
    const isFrozen = setup.has_dbp && dbpStatus === 'frozen';

    // Determine primary participant age dynamically from Setup birth date/year
    const participantAge =
      comp?.primary_age ??
      getAgeInTaxYear(setup.primary_profile?.birth_date, yr.tax_year, setup.primary_birth_year);

    // Count active household participants for statutory §415(b)(1)(A) dollar cap
    const spouseActive =
      isJoint &&
      ((setup.has_scorp && (yr.scorp_1120s.debra_w2_wages ?? 0) > 0) ||
        Boolean(setup.spouse_name?.trim()));
    const participantCount = spouseActive ? 2 : 1;

    const w2Salary = w2History[idx];

    // Rolling 3-consecutive-year average compensation (IRC §415(b)(3))
    let trailing3Avg: number;
    if (config.historical_high_3_w2 > 0) {
      const wPrev1 = idx >= 1 ? w2History[idx - 1] : config.historical_high_3_w2;
      const wPrev2 = idx >= 2 ? w2History[idx - 2] : config.historical_high_3_w2;
      trailing3Avg = round0((wPrev2 + wPrev1 + w2Salary) / 3);
    } else {
      // Brand-new plan with $0 historical High-3: average active years observed so far (up to 3)
      const windowSlice = w2History.slice(Math.max(0, idx - 2), idx + 1);
      const nonEmptyCount = Math.min(3, Math.max(1, planYear, windowSlice.length));
      const sum = windowSlice.reduce((s, v) => s + v, 0);
      trailing3Avg = round0(sum / Math.min(windowSlice.length, nonEmptyCount));
    }

    const prevHigh3 = runningHigh3;
    const rollingHigh3 =
      isTerminated || isFrozen ? runningHigh3 : Math.max(runningHigh3, trailing3Avg);
    const high3Ratcheted = !isTerminated && !isFrozen && rollingHigh3 > prevHigh3 && prevHigh3 > 0;
    runningHigh3 = rollingHigh3;

    // 10-year §415(b)(5) phase-in (10% per year of participation, max 100%)
    const effectivePhaseInYears = Math.min(10, Math.max(0, planYear));
    const phaseInPct = effectivePhaseInYears / 10;

    // Statutory §415(b)(1)(A) dollar cap × participant count
    const perParticipantDollarCap = getStatutory415bDollarLimit(
      yr.tax_year,
      setup.assumptions?.inflation_rate ?? 0.025
    );
    const statutoryDollarCap = perParticipantDollarCap * participantCount;

    // IRC §415(b) Annual Annuity = min(Rolling High-3, Dollar Cap) × 10-yr phase-in %
    const annuity415b = setup.has_dbp
      ? round0(Math.min(rollingHigh3, statutoryDollarCap) * phaseInPct)
      : 0;

    // IRC §417(e) Unisex lump-sum factor at attained age & valuation interest rate
    const factor417e = compute417eUnisexFactor(participantAge, config.valuation_interest_rate);

    // Statutory Lump-Sum Ceiling = 415(b) Annuity × 417(e) Unisex Factor
    const statutoryCeiling = setup.has_dbp ? round0(annuity415b * factor417e) : 0;

    const boyAssets = isTerminated ? 0 : runningAssets;
    const trustGrowthDollars = isTerminated ? 0 : round0(boyAssets * config.trust_growth_rate);
    const preContribAssets = isTerminated ? 0 : Math.max(0, boyAssets + trustGrowthDollars);

    // Dynamic 404 Max Limit = remaining deductible room up to Statutory Ceiling
    const dynamic404Max =
      !setup.has_dbp || isTerminated || isFrozen
        ? 0
        : Math.max(0, statutoryCeiling - preContribAssets);

    const plannedDbp = setup.has_dbp ? Math.max(0, round0(dbpIn.dbp_actual_contribution)) : 0;

    const eoyAssets =
      !setup.has_dbp || isTerminated ? 0 : Math.max(0, preContribAssets + plannedDbp);

    const isExitYear =
      setup.has_dbp &&
      !isTerminated &&
      (dbpStatus === 'terminating' ||
        (setup.dbp_planned_termination_year !== null &&
          yr.tax_year === setup.dbp_planned_termination_year));

    const rolloverOutAmount = isExitYear ? eoyAssets : 0;
    const headroomToCeiling = isTerminated ? 0 : statutoryCeiling - eoyAssets;
    const fundingRatioPct =
      statutoryCeiling > 0 && !isTerminated
        ? Number(((eoyAssets / statutoryCeiling) * 100).toFixed(1))
        : 0;

    // Status classification (paired with explicit human-readable text label)
    let statusCode: ActuarialRowStatusCode = 'nominal';
    let statusLabel = 'Nominal';
    let statusNote = 'EOY assets within §415(b) ceiling';

    if (!setup.has_dbp) {
      statusCode = 'inactive';
      statusLabel = 'DBP Inactive';
      statusNote = 'Enable DBP to model actuarial funding';
    } else if (isTerminated) {
      statusCode = 'terminated';
      statusLabel = 'Terminated';
      statusNote = plannedDbp > 0 ? 'Warning: contribution scheduled after termination' : 'Rolled out to IRA';
    } else if (isFrozen) {
      if (statutoryCeiling > 0 && eoyAssets > statutoryCeiling) {
        statusCode = 'over_ceiling';
        statusLabel = 'Frozen · Over Ceiling';
        statusNote = 'Trust growth pushed frozen assets above §415(b) ceiling';
      } else {
        statusCode = 'frozen';
        statusLabel = 'Frozen';
        statusNote = 'Accruals frozen · $0 new contributions';
      }
    } else if (yr.is_locked_actuals) {
      statusCode = 'locked_actual';
      statusLabel = 'Locked Actual';
      statusNote = 'Filed prior-year actual contribution';
    } else if (statutoryCeiling > 0 && eoyAssets > statutoryCeiling + 1) {
      statusCode = 'over_ceiling';
      statusLabel = 'Over Ceiling';
      statusNote = `Exceeds §415(b) ceiling by $${(eoyAssets - statutoryCeiling).toLocaleString()} (reversion risk)`;
    } else if (plannedDbp > dynamic404Max + 1) {
      statusCode = 'over_404';
      statusLabel = 'Over 404 Max';
      statusNote = `Planned DBP exceeds Dynamic 404 limit by $${(plannedDbp - dynamic404Max).toLocaleString()}`;
    } else if (isExitYear) {
      statusCode = 'yr10_exit';
      statusLabel = planYear === 10 ? 'Yr 10 Exit' : 'Target Exit';
      statusNote = `100% vested exit · Est. rollover $${eoyAssets.toLocaleString()}`;
    } else if (fundingRatioPct >= 92) {
      statusCode = 'near_ceiling';
      statusLabel = 'Near Ceiling';
      statusNote = `${fundingRatioPct}% of §415(b) statutory ceiling`;
    } else {
      statusCode = 'nominal';
      statusLabel = 'Nominal';
      statusNote = `$${Math.max(0, headroomToCeiling).toLocaleString()} ceiling headroom`;
    }

    rows.push({
      taxYear: yr.tax_year,
      planYear,
      isLockedActuals: yr.is_locked_actuals,
      dbpStatus,
      participantAge,
      participantCount,
      w2Salary,
      trailing3Avg,
      rollingHigh3,
      high3Ratcheted,
      phaseInPct,
      statutoryDollarCap,
      annuity415b,
      factor417e,
      statutoryCeiling,
      boyAssets,
      trustGrowthDollars,
      preContribAssets,
      dynamic404Max,
      plannedDbp,
      eoyAssets,
      rolloverOutAmount,
      headroomToCeiling,
      fundingRatioPct,
      statusCode,
      statusLabel,
      statusNote,
    });

    if (isExitYear || isTerminated) {
      const nextYr = years[idx + 1];
      const nextIsTerminated = !nextYr || nextYr.dbp_and_retirement.dbp_status === 'terminated';
      runningAssets = isTerminated || nextIsTerminated ? 0 : eoyAssets;
    } else {
      runningAssets = eoyAssets;
    }
  }

  const yr10Row = rows.find((r) => r.planYear === 10) ?? null;
  const totalSixYearPlannedDbp = rows.reduce((s, r) => s + r.plannedDbp, 0);
  const totalSixYearDynamic404Room = rows.reduce((s, r) => s + r.dynamic404Max, 0);
  const peakEoyAssets = rows.reduce((m, r) => Math.max(m, r.eoyAssets), 0);
  const peakStatutoryCeiling = rows.reduce((m, r) => Math.max(m, r.statutoryCeiling), 0);
  const exitRow = rows.find((r) => r.rolloverOutAmount > 0);
  const projectedExitRollover = exitRow ? exitRow.rolloverOutAmount : peakEoyAssets;
  const overLimitYearCount = rows.filter((r) => r.statusCode === 'over_404').length;
  const overCeilingYearCount = rows.filter((r) => r.statusCode === 'over_ceiling').length;

  return {
    config,
    rows,
    yr10TaxYear: yr10Row ? yr10Row.taxYear : null,
    totalSixYearPlannedDbp,
    totalSixYearDynamic404Room,
    peakEoyAssets,
    peakStatutoryCeiling,
    projectedExitRollover,
    overLimitYearCount,
    overCeilingYearCount,
  };
}

export interface DbpPresetResult {
  nextSetup: SetupConfig;
  nextYears: TaxYearRecord[];
  summaryText: string;
}

/**
 * Preset 1: Target Yr 10 Exit
 * Paces unlocked DBP contributions evenly through Plan Year 10 (100% §415(b) phase-in)
 * without breaching any year's Dynamic 404 Max Limit, schedules rollover exit at Year 10,
 * and terminates the plan cleanly in Year 11+. Locked actuals are never modified.
 */
export function applyTargetYr10ExitPreset(
  setup: SetupConfig,
  years: TaxYearRecord[]
): DbpPresetResult {
  const config = resolveDbpActuarialConfig(setup);
  const anchorYear = years[0]?.tax_year ?? setup.anchor_actuals_year;
  const yr10TaxYear = anchorYear + (10 - config.plan_year_anchor);
  const effectiveTermYear = years.some((y) => y.tax_year === yr10TaxYear)
    ? yr10TaxYear
    : years[years.length - 1]?.tax_year ?? yr10TaxYear;

  const nextSetup: SetupConfig = {
    ...setup,
    has_dbp: true,
    dbp_planned_termination_year: effectiveTermYear,
  };

  // First compute waterfall with $0 on unlocked years <= termYear to measure exact headroom
  const zeroProbeYears = years.map((yr) => {
    if (yr.is_locked_actuals) return yr;
    if (yr.tax_year > effectiveTermYear) {
      return {
        ...yr,
        dbp_and_retirement: {
          ...yr.dbp_and_retirement,
          dbp_status: 'terminated' as DbpStatus,
          dbp_target_termination_year: effectiveTermYear,
          dbp_actual_contribution: 0,
          dbp_max_deductible_contribution: 0,
          rollover_amount: 0,
        },
      };
    }
    return {
      ...yr,
      dbp_and_retirement: {
        ...yr.dbp_and_retirement,
        dbp_status: (yr.tax_year === effectiveTermYear ? 'terminating' : 'active') as DbpStatus,
        dbp_target_termination_year: effectiveTermYear,
        dbp_actual_contribution: 0,
        rollover_amount: 0,
      },
    };
  });

  const probe = computeDbpActuarialWaterfall(nextSetup, zeroProbeYears);
  const unlockedActiveIndices = probe.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.isLockedActuals && r.taxYear <= effectiveTermYear);

  const termRow = probe.rows.find((r) => r.taxYear === effectiveTermYear);
  const targetRemainingGap = termRow ? Math.max(0, termRow.statutoryCeiling - termRow.preContribAssets) : 0;

  // Solve level annual contribution C so compounded sum equals ~98% of Yr 10 statutory ceiling
  // while respecting each year's Dynamic 404 Max Limit sequentially
  const nActive = unlockedActiveIndices.length;
  const g = config.trust_growth_rate;
  let compoundFactorSum = 0;
  for (let k = 0; k < nActive; k++) {
    compoundFactorSum += Math.pow(1 + g, nActive - 1 - k);
  }
  const targetLevelContrib =
    nActive > 0 && compoundFactorSum > 0
      ? Math.max(0, round0((targetRemainingGap * 0.98) / compoundFactorSum / 500) * 500)
      : 0;

  const workingYears = zeroProbeYears.map((yr) => ({
    ...yr,
    dbp_and_retirement: { ...yr.dbp_and_retirement },
  }));

  for (let idx = 0; idx < workingYears.length; idx++) {
    const yr = workingYears[idx];
    if (yr.is_locked_actuals) continue;
    if (yr.tax_year > effectiveTermYear) continue;

    const currentWaterfall = computeDbpActuarialWaterfall(nextSetup, workingYears);
    const row = currentWaterfall.rows[idx];
    const maxAllowed = row.dynamic404Max;
    const isFinalActive = yr.tax_year === effectiveTermYear;
    const planned = isFinalActive
      ? Math.min(maxAllowed, Math.max(0, round0(maxAllowed * 0.98 / 500) * 500))
      : Math.min(maxAllowed, targetLevelContrib);

    yr.dbp_and_retirement = {
      ...yr.dbp_and_retirement,
      dbp_status: isFinalActive ? 'terminating' : 'active',
      dbp_target_termination_year: effectiveTermYear,
      dbp_max_deductible_contribution: Math.max(maxAllowed, planned),
      dbp_actual_contribution: planned,
    };
  }

  // Final pass to stamp exact projected rollover amount in exit year
  const finalWf = computeDbpActuarialWaterfall(nextSetup, workingYears);
  const exitRow = finalWf.rows.find((r) => r.taxYear === effectiveTermYear);
  const nextYears = workingYears.map((yr) => {
    if (yr.is_locked_actuals) return yr;
    if (yr.tax_year === effectiveTermYear && exitRow) {
      return {
        ...yr,
        dbp_and_retirement: {
          ...yr.dbp_and_retirement,
          rollover_amount: exitRow.eoyAssets,
        },
      };
    }
    return yr;
  });

  return {
    nextSetup,
    nextYears,
    summaryText: `Applied Target Yr 10 Exit (${effectiveTermYear}): paced unlocked contributions under Dynamic 404 limits with estimated $${(
      exitRow?.eoyAssets ?? 0
    ).toLocaleString()} tax-free rollover at termination and $0 contributions post-${effectiveTermYear}.`,
  };
}

/**
 * Preset 2: Max Out 404
 * Sequentially sets every unlocked active/terminating year to 100% of its live
 * Dynamic 404 Max Limit right up to the §415(b) Statutory Ceiling (never modifying locked actuals).
 */
export function applyMaxOut404Preset(
  setup: SetupConfig,
  years: TaxYearRecord[]
): DbpPresetResult {
  const termYear = setup.dbp_planned_termination_year;
  const nextSetup: SetupConfig = {
    ...setup,
    has_dbp: true,
  };

  const workingYears = years.map((yr) => {
    if (yr.is_locked_actuals) return yr;
    const isAfterTerm = termYear !== null && yr.tax_year > termYear;
    return {
      ...yr,
      dbp_and_retirement: {
        ...yr.dbp_and_retirement,
        dbp_status: isAfterTerm
          ? ('terminated' as DbpStatus)
          : termYear !== null && yr.tax_year === termYear
          ? ('terminating' as DbpStatus)
          : ('active' as DbpStatus),
        dbp_actual_contribution: 0,
        dbp_max_deductible_contribution: isAfterTerm ? 0 : yr.dbp_and_retirement.dbp_max_deductible_contribution,
        rollover_amount: 0,
      },
    };
  });

  let totalAdded = 0;
  for (let idx = 0; idx < workingYears.length; idx++) {
    const yr = workingYears[idx];
    if (yr.is_locked_actuals) continue;
    if (termYear !== null && yr.tax_year > termYear) continue;

    const wf = computeDbpActuarialWaterfall(nextSetup, workingYears);
    const row = wf.rows[idx];
    const maxLimit = row.dynamic404Max;
    totalAdded += maxLimit;
    yr.dbp_and_retirement = {
      ...yr.dbp_and_retirement,
      dbp_max_deductible_contribution: maxLimit,
      dbp_actual_contribution: maxLimit,
    };
  }

  const finalWf = computeDbpActuarialWaterfall(nextSetup, workingYears);
  const nextYears = workingYears.map((yr) => {
    if (yr.is_locked_actuals) return yr;
    if (termYear !== null && yr.tax_year === termYear) {
      const r = finalWf.rows.find((row) => row.taxYear === yr.tax_year);
      return {
        ...yr,
        dbp_and_retirement: {
          ...yr.dbp_and_retirement,
          rollover_amount: r?.eoyAssets ?? 0,
        },
      };
    }
    return yr;
  });

  return {
    nextSetup,
    nextYears,
    summaryText: `Applied Max Out 404: maximized unlocked active-year contributions to 100% of Dynamic 404 limits ($${totalAdded.toLocaleString()} total unlocked DBP funding${
      termYear !== null ? ` through ${termYear}` : ''
    }).`,
  };
}

/**
 * Preset 3: Freeze Post-Yr 10
 * Keeps years through Plan Year 10 active (clamped within Dynamic 404 Max), then freezes
 * accruals in Plan Year 11+ ($0 contributions, plan remains open with assets compounding in trust).
 */
export function applyFreezePostYr10Preset(
  setup: SetupConfig,
  years: TaxYearRecord[]
): DbpPresetResult {
  const config = resolveDbpActuarialConfig(setup);
  const anchorYear = years[0]?.tax_year ?? setup.anchor_actuals_year;
  const yr10TaxYear = anchorYear + (10 - config.plan_year_anchor);

  const nextSetup: SetupConfig = {
    ...setup,
    has_dbp: true,
    dbp_planned_termination_year: null,
  };

  const workingYears = years.map((yr) => {
    if (yr.is_locked_actuals) return yr;
    if (yr.tax_year > yr10TaxYear) {
      return {
        ...yr,
        dbp_and_retirement: {
          ...yr.dbp_and_retirement,
          dbp_status: 'frozen' as DbpStatus,
          dbp_target_termination_year: Math.max(2035, yr10TaxYear + 5),
          dbp_actual_contribution: 0,
          dbp_max_deductible_contribution: 0,
          rollover_amount: 0,
        },
      };
    }
    return {
      ...yr,
      dbp_and_retirement: {
        ...yr.dbp_and_retirement,
        dbp_status: 'active' as DbpStatus,
        dbp_target_termination_year: Math.max(2035, yr10TaxYear + 5),
        rollover_amount: 0,
      },
    };
  });

  // Ensure active years <= Yr 10 stay within Dynamic 404 Max
  for (let idx = 0; idx < workingYears.length; idx++) {
    const yr = workingYears[idx];
    if (yr.is_locked_actuals || yr.tax_year > yr10TaxYear) continue;
    const wf = computeDbpActuarialWaterfall(nextSetup, workingYears);
    const row = wf.rows[idx];
    const capped = Math.min(yr.dbp_and_retirement.dbp_actual_contribution, row.dynamic404Max);
    yr.dbp_and_retirement = {
      ...yr.dbp_and_retirement,
      dbp_max_deductible_contribution: Math.max(row.dynamic404Max, capped),
      dbp_actual_contribution: capped,
    };
  }

  return {
    nextSetup,
    nextYears: workingYears,
    summaryText: `Applied Freeze Post-Yr 10: kept years through ${yr10TaxYear} active and froze accruals ($0 contributions, trust open) for ${
      yr10TaxYear + 1
    }+.`,
  };
}
