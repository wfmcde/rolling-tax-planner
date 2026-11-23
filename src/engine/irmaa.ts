import type { FilingStatus, SetupConfig } from '../types/tax';

export interface IrmaaThresholdConfig {
  annualGrowthRate: number; // Default: 0.03 (3.0%)
  overrides: Record<number, number>; // Optional per-year override, e.g. { 2027: 224000 }
}

export const IRMAA_2025_HARDCODED = 212_000;
export const IRMAA_2026_BASELINE = 218_000;
export const IRMAA_MFJ_2025_THRESHOLD = IRMAA_2025_HARDCODED;
export const IRMAA_MFJ_2026_THRESHOLD = IRMAA_2026_BASELINE;
export const IRMAA_SINGLE_2025_THRESHOLD = 106_000;
export const IRMAA_SINGLE_2026_THRESHOLD = 109_000;
export const DEFAULT_IRMAA_GROWTH_RATE = 0.03;

export function getJointIrmaaThreshold(
  year: number,
  config: IrmaaThresholdConfig = { annualGrowthRate: 0.03, overrides: {} }
): number {
  if (typeof config.overrides[year] === 'number' && Number.isFinite(config.overrides[year])) {
    return config.overrides[year];
  }

  if (year <= 2025) {
    return IRMAA_2025_HARDCODED;
  }

  if (year === 2026) {
    return IRMAA_2026_BASELINE;
  }

  const yearsAfter2026 = year - 2026;
  const raw = IRMAA_2026_BASELINE * Math.pow(1 + config.annualGrowthRate, yearsAfter2026);
  return Math.round(raw / 1000) * 1000;
}

export interface ResolvedIrmaaThreshold {
  coverageYear: number;
  lookbackMagiYear: number;
  formulaThreshold: number;
  effectiveThreshold: number;
  isOverridden: boolean;
  growthRate: number;
  sourceLabel: string;
}

export function getIrmaaGrowthRate(setup?: SetupConfig): number {
  const raw = setup?.assumptions?.irmaa_threshold_growth_rate;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return DEFAULT_IRMAA_GROWTH_RATE;
}

export function getIrmaaThresholdConfig(setup?: SetupConfig): IrmaaThresholdConfig {
  return {
    annualGrowthRate: getIrmaaGrowthRate(setup),
    overrides: setup?.irmaa_threshold_overrides ?? {},
  };
}

/**
 * Computes the formula-driven IRMAA Tier 1 starting threshold for a given Medicare coverage year:
 * - <= 2025: hardcoded $212,000 (MFJ) / $106,000 (non-MFJ)
 * - 2026: $218,000 (MFJ) / $109,000 (non-MFJ)
 * - 2027+: compounded from the 2026 baseline at `growthRate` (default 3.0%/yr), rounded to nearest $1,000:
 *          Math.round((218000 * Math.pow(1 + growthRate, year - 2026)) / 1000) * 1000
 */
export function computeFormulaIrmaaStartingThreshold(
  coverageYear: number,
  filingStatus: FilingStatus = 'married_filing_jointly',
  growthRate: number = DEFAULT_IRMAA_GROWTH_RATE
): number {
  const safeRate =
    Number.isFinite(growthRate) && growthRate >= 0 ? growthRate : DEFAULT_IRMAA_GROWTH_RATE;
  const isMfj = filingStatus === 'married_filing_jointly';

  if (isMfj) {
    return getJointIrmaaThreshold(coverageYear, {
      annualGrowthRate: safeRate,
      overrides: {},
    });
  }

  if (coverageYear <= 2025) {
    return IRMAA_SINGLE_2025_THRESHOLD;
  }
  if (coverageYear === 2026) {
    return IRMAA_SINGLE_2026_THRESHOLD;
  }
  const yearsAfter2026 = coverageYear - 2026;
  const raw = IRMAA_SINGLE_2026_THRESHOLD * Math.pow(1 + safeRate, yearsAfter2026);
  return Math.round(raw / 1000) * 1000;
}

/**
 * Resolves the active IRMAA starting threshold for a Medicare coverage year,
 * honoring any per-year manual override on `setup.irmaa_threshold_overrides`
 * without altering the formula calculation on other years.
 */
export function resolveIrmaaThresholdForYear(
  coverageYear: number,
  setup?: SetupConfig
): ResolvedIrmaaThreshold {
  const filingStatus: FilingStatus = setup?.filing_status ?? 'married_filing_jointly';
  const config = getIrmaaThresholdConfig(setup);
  const formulaThreshold = computeFormulaIrmaaStartingThreshold(
    coverageYear,
    filingStatus,
    config.annualGrowthRate
  );

  const rawOverride = config.overrides[coverageYear];
  const hasOverride =
    typeof rawOverride === 'number' && Number.isFinite(rawOverride) && rawOverride >= 0;
  const effectiveThreshold =
    filingStatus === 'married_filing_jointly'
      ? Math.round(
          getJointIrmaaThreshold(coverageYear, {
            annualGrowthRate: config.annualGrowthRate,
            overrides: hasOverride ? { [coverageYear]: Math.round(rawOverride) } : {},
          })
        )
      : hasOverride
      ? Math.round(rawOverride)
      : formulaThreshold;

  const pctLabel = Number((config.annualGrowthRate * 100).toFixed(1));
  const sourceLabel = hasOverride
    ? 'Manual Override'
    : coverageYear <= 2025
    ? '2025 Baseline'
    : coverageYear === 2026
    ? '2026 Baseline'
    : `+${pctLabel}%/yr Formula`;

  return {
    coverageYear,
    lookbackMagiYear: coverageYear - 2,
    formulaThreshold,
    effectiveThreshold,
    isOverridden: hasOverride,
    growthRate: config.annualGrowthRate,
    sourceLabel,
  };
}

/**
 * Builds all 5 IRMAA tier thresholds for a coverage year anchored on the resolved
 * Tier 1 starting threshold (including any per-year manual override).
 */
export function computeIrmaaBracketThresholds(
  coverageYear: number,
  setup?: SetupConfig
): {
  resolved: ResolvedIrmaaThreshold;
  thresholds: [number, number, number, number, number];
} {
  const resolved = resolveIrmaaThresholdForYear(coverageYear, setup);
  const isMfj = (setup?.filing_status ?? 'married_filing_jointly') === 'married_filing_jointly';

  const base2025: [number, number, number, number, number] = isMfj
    ? [212000, 266000, 334000, 400000, 750000]
    : [106000, 133000, 167000, 200000, 500000];

  if (coverageYear === 2025 && !resolved.isOverridden) {
    return { resolved, thresholds: base2025 };
  }

  const tier1 = resolved.effectiveThreshold;
  const ratio = base2025[0] > 0 ? tier1 / base2025[0] : 1;
  const roundTo1k = (n: number) => Math.round(n / 1000) * 1000;

  const tier2 = Math.max(tier1 + 1000, roundTo1k(base2025[1] * ratio));
  const tier3 = Math.max(tier2 + 1000, roundTo1k(base2025[2] * ratio));
  const tier4 = Math.max(tier3 + 1000, roundTo1k(base2025[3] * ratio));
  // Statutory Tier 5 cap ($750k MFJ / $500k Single) is not inflation-indexed,
  // but stays strictly above Tier 4 if a very large custom override is entered.
  const tier5 = Math.max(base2025[4], tier4 + 1000);

  return {
    resolved,
    thresholds: [tier1, tier2, tier3, tier4, tier5],
  };
}

/**
 * Immutably sets or clears (`amount === null`) a per-year IRMAA starting threshold override.
 */
export function setIrmaaThresholdOverride(
  setup: SetupConfig,
  coverageYear: number,
  amount: number | null
): SetupConfig {
  const nextOverrides: Record<number, number> = {
    ...(setup.irmaa_threshold_overrides ?? {}),
  };

  if (amount === null || !Number.isFinite(amount)) {
    delete nextOverrides[coverageYear];
  } else {
    nextOverrides[coverageYear] = Math.max(0, Math.round(amount));
  }

  return {
    ...setup,
    irmaa_threshold_overrides: nextOverrides,
  };
}

/**
 * Sanitizes persisted or imported `irmaa_threshold_overrides` maps.
 */
export function sanitizeIrmaaThresholdOverrides(
  raw: Record<number, number> | Record<string, unknown> | undefined
): Record<number, number> {
  const result: Record<number, number> = {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [key, val] of Object.entries(raw)) {
    const year = Number(key);
    const num = Number(val);
    if (Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isFinite(num) && num >= 0) {
      result[year] = Math.round(num);
    }
  }
  return result;
}
