import type { ComputedTaxYear, PlannerState } from '../types/tax';
import { computeIrmaaBracketThresholds } from '../engine/irmaa';
import { calculateSixYearPlan, computeIrmaaPerEnrollee } from '../engine/taxEngine';
import { getAgeInTaxYear } from './personTax';

export interface IrmaaCliffBonusInfo {
  triggered: boolean;
  dollarValue: number;
  coverageYear: number;
  threshold: number;
  tierLabel: string;
}

export interface IrmaaProximityInfo {
  showNote: boolean;
  withinWindow: boolean;
  distanceDollars: number;
  isBelow: boolean;
  coverageYear: number;
  threshold: number;
  tierNumber: number;
  baselineMagi: number;
}

export interface MarginalTaxSavingsBreakdown {
  taxYear: number;
  perturbationAmount: number;
  /** Combined federal + state tax saved per $1 of additional deductible expense (e.g. 0.242 = 24.2¢). */
  totalSavedPerDollar: number;
  /** Net federal income tax saved per $1 (after QBI haircut and senior deduction phase-out recovery). */
  federalTaxSaved: number;
  /** Gross federal ordinary income tax saved per $1 prior to QBI haircut and senior recovery. */
  federalOrdinaryTaxSaved: number;
  /** Positive decimal offset per $1 attributable to the 20% QBI deduction haircut (displayed as -X.X¢). */
  qbiHaircutImpact: number;
  /** True when the deduction reduced a positive Sec. 199A QBI deduction. */
  qbiApplies: boolean;
  /** Positive decimal per $1 attributable to Enhanced Senior Deduction phase-out recovery. */
  seniorDeductionRecovery: number;
  /** Blended state tax reduction per $1 across active jurisdictions. */
  stateTaxSaved: number;
  /** Active state codes contributing to the blended state rate (e.g., ['CA', 'AZ']). */
  activeStateCodes: string[];
  /** Non-linear Medicare IRMAA cliff savings if the perturbation drops MAGI across an IRMAA threshold. */
  irmaaCliffBonus: IrmaaCliffBonusInfo;
  /** Proximity of current-year MAGI to the nearest 2-year-lookback IRMAA threshold. */
  irmaaProximity: IrmaaProximityInfo;
  /** Net after-tax cost per $1 of deductible expense (1 - totalSavedPerDollar). */
  netAfterTaxCost: number;
  /** Raw dollar deltas from the engine perturbation run for diagnostics/tooltips. */
  rawDollars: {
    federalNetSaved: number;
    stateSaved: number;
    qbiReduction: number;
    seniorDeductionRecovered: number;
    baselineMagi: number;
    perturbedMagi: number;
  };
}

const DEFAULT_PERTURBATION_DOLLARS = 1000;
const IRMAA_PROXIMITY_WINDOW_DOLLARS = 2500;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Formats a per-$1 decimal rate (e.g., 0.242) into cents per dollar (e.g., "24.2¢").
 */
export function formatCentsPerDollar(rate: number, decimals = 1): string {
  const cents = Math.max(0, rate * 100);
  return `${cents.toFixed(decimals)}¢`;
}

/**
 * Pure perturbation helper that runs the real tax engine twice for the selected projection year:
 *  1) Baseline run: current year inputs (or reuses precomputed baseline if supplied)
 *  2) Perturbed run: adds +$1,000 deductible S-Corp operating expense (OpEx) so all downstream
 *     federal, 20% QBI, Enhanced Senior Deduction phase-out, multi-state apportionment, and
 *     2-year-lookback Medicare IRMAA interactions flow directly through `calculateSixYearPlan`.
 */
export function calculateMarginalTaxSavings(
  profileState: Pick<PlannerState, 'setup' | 'years'>,
  year: number,
  perturbationAmount: number = DEFAULT_PERTURBATION_DOLLARS,
  precomputedBaseline?: ComputedTaxYear[]
): MarginalTaxSavingsBreakdown | null {
  const { setup, years } = profileState;
  const targetIdx = years.findIndex((y) => y.tax_year === year);
  if (targetIdx === -1) return null;

  const targetRecord = years[targetIdx];
  const delta =
    Number.isFinite(perturbationAmount) && perturbationAmount > 0
      ? Math.round(perturbationAmount)
      : DEFAULT_PERTURBATION_DOLLARS;

  const baseComputed =
    precomputedBaseline && precomputedBaseline.length === years.length
      ? precomputedBaseline
      : calculateSixYearPlan(setup, years);

  const baseYr = baseComputed.find((c) => c.tax_year === year);
  if (!baseYr) return null;

  // Build perturbed year inputs:
  // - When S-Corp is active, inject +delta OpEx directly into effective operating expenses
  //   (setting operating_expenses_override as well so 2027-2030 revenue_proportional scaling
  //   does not overwrite the perturbation).
  // - When S-Corp is disabled (Form 1040 Core), inject +delta above-the-line adjustment.
  const perturbedYears = years.map((yr, idx) => {
    if (idx !== targetIdx) return yr;

    if (setup.has_scorp) {
      if (yr.scorp_1120s.use_detailed_1120s_deductions) {
        return {
          ...yr,
          scorp_1120s: {
            ...yr.scorp_1120s,
            other_deductions: (yr.scorp_1120s.other_deductions ?? 0) + delta,
          },
        };
      }
      const nextOpEx = baseYr.scorp_out.effective_operating_expenses + delta;
      return {
        ...yr,
        scorp_1120s: {
          ...yr.scorp_1120s,
          operating_expenses: nextOpEx,
          operating_expenses_override: nextOpEx,
        },
      };
    }

    return {
      ...yr,
      form_1040: {
        ...yr.form_1040,
        schedule_1_adjustments_input: (yr.form_1040.schedule_1_adjustments_input ?? 0) + delta,
      },
    };
  });

  const pertComputed = calculateSixYearPlan(setup, perturbedYears);
  const pertYr = pertComputed.find((c) => c.tax_year === year);
  if (!pertYr) return null;

  const fedNetDollars = Math.max(
    0,
    baseYr.form_1040_out.federal_income_tax - pertYr.form_1040_out.federal_income_tax
  );
  const stateDollars = Math.max(0, baseYr.total_state_tax - pertYr.total_state_tax);

  const qbiReduction = Math.max(
    0,
    baseYr.form_1040_out.qualified_business_income_deduction -
      pertYr.form_1040_out.qualified_business_income_deduction
  );
  const seniorDeductionRecovered = Math.max(
    0,
    pertYr.form_1040_out.enhanced_senior_deduction_allowed -
      baseYr.form_1040_out.enhanced_senior_deduction_allowed
  );
  const taxableIncomeDrop = Math.max(
    0,
    baseYr.form_1040_out.taxable_income - pertYr.form_1040_out.taxable_income
  );

  // Derive the effective federal ordinary rate across the perturbed slice so itemized
  // components tie out cleanly to the actual engine federal tax reduction without duplicating brackets.
  const statutoryMarginalRate = Math.max(0, baseYr.form_1040_out.marginal_tax_rate / 100);
  const effectiveFedSliceRate =
    fedNetDollars > 0
      ? taxableIncomeDrop > 0
        ? Math.min(0.45, fedNetDollars / taxableIncomeDrop)
        : statutoryMarginalRate
      : 0;

  const federalTaxSaved = round4(fedNetDollars / delta);
  const qbiHaircutImpact =
    fedNetDollars > 0 && qbiReduction > 0
      ? round4((qbiReduction * effectiveFedSliceRate) / delta)
      : 0;
  const seniorDeductionRecovery =
    fedNetDollars > 0 && seniorDeductionRecovered > 0
      ? round4((seniorDeductionRecovered * effectiveFedSliceRate) / delta)
      : 0;
  const federalOrdinaryTaxSaved =
    fedNetDollars > 0
      ? round4(Math.max(0, federalTaxSaved + qbiHaircutImpact - seniorDeductionRecovery))
      : 0;
  const stateTaxSaved = round4(stateDollars / delta);

  const totalSavedPerDollar = round4(Math.min(1, Math.max(0, federalTaxSaved + stateTaxSaved)));
  const netAfterTaxCost = round4(Math.max(0, 1 - totalSavedPerDollar));

  // Determine active states contributing to state tax reduction (or active filings if $0 state tax)
  const statesWithTaxDelta = baseYr.state_filings_out
    .filter((sf, idx) => {
      const pertSf = pertYr.state_filings_out[idx];
      const deltaState = pertSf
        ? sf.state_income_tax_liability - pertSf.state_income_tax_liability
        : 0;
      return deltaState > 0;
    })
    .map((sf) => sf.state_code)
    .filter(Boolean);

  const stateCodesFromFilings =
    statesWithTaxDelta.length > 0
      ? statesWithTaxDelta
      : baseYr.state_filings_out
          .filter(
            (sf) =>
              sf.state_income_tax_liability > 0 ||
              sf.state_apportionment_factor > 0 ||
              sf.residency_status === 'resident'
          )
          .map((sf) => sf.state_code)
          .filter(Boolean);

  const fallbackStateCodes = [setup.home_state, setup.secondary_state]
    .map((s) => (s ?? '').trim().toUpperCase())
    .filter(Boolean);

  const activeStateCodes = Array.from(
    new Set(stateCodesFromFilings.length > 0 ? stateCodesFromFilings : fallbackStateCodes)
  );

  // 2-year lookback Medicare IRMAA cliff & proximity evaluation
  const taxExemptInterest = targetRecord.form_1040.tax_exempt_interest ?? 0;
  const baselineMagi = baseYr.form_1040_out.adjusted_gross_income + taxExemptInterest;
  const perturbedMagi = pertYr.form_1040_out.adjusted_gross_income + taxExemptInterest;
  const futureCoverageYear = baseYr.form_1040_out.irmaa_future_coverage_year || year + 2;
  const { thresholds: futureThresholds } = computeIrmaaBracketThresholds(
    futureCoverageYear,
    setup
  );

  const primaryAgeFuture = getAgeInTaxYear(
    setup.primary_profile?.birth_date,
    futureCoverageYear,
    setup.primary_birth_year
  );
  const spouseAgeFuture =
    setup.filing_status === 'married_filing_jointly'
      ? getAgeInTaxYear(
          setup.spouse_profile?.birth_date,
          futureCoverageYear,
          setup.spouse_birth_year
        )
      : null;

  const primaryEnrolledFuture =
    Boolean(setup.primary_profile?.medicare.enrolled) ||
    (setup.has_ss_medicare && primaryAgeFuture !== null && primaryAgeFuture >= 65);
  const spouseEnrolledFuture =
    setup.filing_status === 'married_filing_jointly' &&
    (Boolean(setup.spouse_profile?.medicare.enrolled) ||
      (setup.has_ss_medicare && spouseAgeFuture !== null && spouseAgeFuture >= 65));
  const futureMedicareEnrollees =
    (primaryEnrolledFuture ? 1 : 0) + (spouseEnrolledFuture ? 1 : 0);
  const hasMedicareApplicable =
    setup.has_ss_medicare ||
    Boolean(setup.primary_profile?.medicare.enrolled) ||
    Boolean(setup.spouse_profile?.medicare.enrolled);

  // Check if the +$1,000 perturbation crosses any of the 5 IRMAA thresholds downward
  let crossedThreshold = futureThresholds[0];
  let crossedTierIndex = -1;
  for (let i = 0; i < futureThresholds.length; i++) {
    const t = futureThresholds[i];
    if (baselineMagi > t && perturbedMagi <= t) {
      crossedThreshold = t;
      crossedTierIndex = i;
      break;
    }
  }

  let irmaaCliffDollarValue = 0;
  let irmaaCliffTierLabel = '';
  if (crossedTierIndex >= 0 && hasMedicareApplicable) {
    const baseFutureYr = baseComputed.find((c) => c.tax_year === futureCoverageYear);
    const pertFutureYr = pertComputed.find((c) => c.tax_year === futureCoverageYear);
    const engineDelta =
      baseFutureYr && pertFutureYr
        ? Math.max(
            0,
            baseFutureYr.form_1040_out.irmaa_annual_surcharge -
              pertFutureYr.form_1040_out.irmaa_annual_surcharge
          )
        : 0;

    if (engineDelta > 0 && baseFutureYr) {
      irmaaCliffDollarValue = engineDelta;
      irmaaCliffTierLabel = baseFutureYr.form_1040_out.irmaa_tier;
    } else if (futureMedicareEnrollees > 0) {
      const inflationRate = setup.assumptions.inflation_rate ?? 0.025;
      const surchargeScale = Math.pow(1 + inflationRate, Math.max(0, futureCoverageYear - 2025));
      const baseEval = computeIrmaaPerEnrollee(
        baselineMagi,
        futureCoverageYear,
        setup,
        surchargeScale
      );
      const pertEval = computeIrmaaPerEnrollee(
        perturbedMagi,
        futureCoverageYear,
        setup,
        surchargeScale
      );
      irmaaCliffDollarValue = Math.max(
        0,
        (baseEval.perEnrolleeSurcharge - pertEval.perEnrolleeSurcharge) * futureMedicareEnrollees
      );
      irmaaCliffTierLabel = baseEval.tier;
    }
  }

  // Nearest IRMAA threshold proximity check (highlight when within $2,500)
  let nearestThreshold = futureThresholds[0];
  let nearestTierNumber = 1;
  let minAbsDist = Math.abs(futureThresholds[0] - baselineMagi);
  for (let i = 1; i < futureThresholds.length; i++) {
    const dist = Math.abs(futureThresholds[i] - baselineMagi);
    if (dist < minAbsDist) {
      minAbsDist = dist;
      nearestThreshold = futureThresholds[i];
      nearestTierNumber = i + 1;
    }
  }

  const distanceDollars = Math.round(minAbsDist);
  const isBelow = baselineMagi <= nearestThreshold;
  const withinWindow = hasMedicareApplicable && distanceDollars <= IRMAA_PROXIMITY_WINDOW_DOLLARS;
  const irmaaTriggered = crossedTierIndex >= 0 && irmaaCliffDollarValue > 0;

  return {
    taxYear: year,
    perturbationAmount: delta,
    totalSavedPerDollar,
    federalTaxSaved,
    federalOrdinaryTaxSaved,
    qbiHaircutImpact,
    qbiApplies: qbiReduction > 0,
    seniorDeductionRecovery,
    stateTaxSaved,
    activeStateCodes,
    irmaaCliffBonus: {
      triggered: irmaaTriggered,
      dollarValue: irmaaCliffDollarValue,
      coverageYear: futureCoverageYear,
      threshold: crossedThreshold,
      tierLabel: irmaaCliffTierLabel || `Tier ${Math.max(1, crossedTierIndex + 1)} IRMAA`,
    },
    irmaaProximity: {
      showNote: hasMedicareApplicable && (withinWindow || irmaaTriggered),
      withinWindow,
      distanceDollars,
      isBelow,
      coverageYear: futureCoverageYear,
      threshold: nearestThreshold,
      tierNumber: nearestTierNumber,
      baselineMagi,
    },
    netAfterTaxCost,
    rawDollars: {
      federalNetSaved: fedNetDollars,
      stateSaved: stateDollars,
      qbiReduction,
      seniorDeductionRecovered,
      baselineMagi,
      perturbedMagi,
    },
  };
}
