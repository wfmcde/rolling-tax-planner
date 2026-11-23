import type {
  SetupConfig,
  StateApportionmentSplit,
  StateRevenueApportionmentConfig,
  TaxYearRecord,
} from '../types/tax';

/**
 * General statutory US state names (Rule 4 — general reference data, never user-specific).
 */
export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export const NO_INCOME_TAX_STATE_CODES = new Set<string>([
  'AK',
  'FL',
  'NH',
  'NV',
  'SD',
  'TN',
  'TX',
  'WA',
  'WY',
]);

export const ALL_US_STATE_OPTIONS: { code: string; name: string }[] = Object.keys(US_STATE_NAMES)
  .sort()
  .map((code) => ({ code, name: US_STATE_NAMES[code] }));

export const SUPPORTED_STATE_OPTIONS: { code: string; name: string }[] = ALL_US_STATE_OPTIONS;

export function getStateFullName(code: string | undefined | null): string {
  const clean = (code ?? '').trim().toUpperCase();
  if (!clean) return 'Primary State';
  return US_STATE_NAMES[clean] ?? clean;
}

/**
 * Dynamic taxpayer display names pulled strictly from Setup (Rule 1 & Rule 2).
 */
export function getSetupPersonNames(setup?: SetupConfig | null): {
  primaryName: string;
  spouseName: string;
} {
  const primaryName = setup?.primary_name?.trim() || 'Primary';
  const spouseName = setup?.spouse_name?.trim() || 'Spouse';
  return { primaryName, spouseName };
}

/**
 * Dynamic business identity pulled strictly from Setup with optional entity record fallback (Rule 1 & Rule 2).
 */
export function getSetupBusinessIdentity(
  setup?: SetupConfig | null,
  fallbackEntityName?: string,
  fallbackEin?: string
): {
  businessName: string;
  businessWebsite: string;
  businessEin: string;
  preparedByLabel: string;
} {
  const businessName =
    setup?.business_name?.trim() ||
    fallbackEntityName?.trim() ||
    '';
  const businessWebsite = setup?.business_website?.trim() || '';
  const businessEin = setup?.business_ein?.trim() || fallbackEin?.trim() || '';
  const preparedByLabel = businessName
    ? `Prepared by ${businessName}`
    : 'Prepared via Rolling Tax Planner';

  return {
    businessName: businessName || 'Business Entity',
    businessWebsite,
    businessEin,
    preparedByLabel,
  };
}

/**
 * Dynamic primary & secondary state codes/names pulled strictly from Setup (Rule 1 & Rule 2).
 */
export function getSetupStates(
  setup?: SetupConfig | null,
  sampleYear?: Pick<TaxYearRecord, 'state_filings'> | null
): {
  primaryStateCode: string;
  primaryStateName: string;
  secondaryStateCode: string;
  secondaryStateName: string;
  hasPrimaryState: boolean;
  hasSecondaryState: boolean;
} {
  const filings = sampleYear?.state_filings ?? [];
  const inferredPrimary =
    filings.find((f) => f.residency_status === 'resident')?.state_code ??
    filings[0]?.state_code ??
    '';
  const inferredSecondary =
    filings.find((f) => f.state_code !== inferredPrimary)?.state_code ?? '';

  const primaryStateCode = (setup?.home_state ?? inferredPrimary).trim().toUpperCase();
  const secondaryStateCode = (
    setup?.secondary_state !== undefined ? setup.secondary_state : inferredSecondary
  )
    .trim()
    .toUpperCase();

  return {
    primaryStateCode,
    primaryStateName: primaryStateCode ? getStateFullName(primaryStateCode) : 'Primary State',
    secondaryStateCode,
    secondaryStateName: secondaryStateCode
      ? getStateFullName(secondaryStateCode)
      : 'Secondary State',
    hasPrimaryState: primaryStateCode.length > 0,
    hasSecondaryState: secondaryStateCode.length > 0,
  };
}

function roundPct1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sanitizeStateCode(code: string | undefined | null): string {
  const clean = (code ?? '').trim().toUpperCase();
  return clean.length === 2 && Boolean(US_STATE_NAMES[clean]) ? clean : clean.length === 2 ? clean : '';
}

function dedupeStateCodes(codes: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const clean = sanitizeStateCode(raw);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/**
 * Returns the ordered list of active business sourcing states configured in Setup
 * (supports 1..N US states, including 0% states such as WA alongside revenue-generating states).
 */
export function getActiveBusinessStates(setup?: SetupConfig | null): string[] {
  const explicitStates = dedupeStateCodes(setup?.state_revenue_apportionment?.states ?? []);
  if (explicitStates.length > 0) {
    return explicitStates;
  }

  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const seedCodes: string[] = [];
  if (primaryStateCode) seedCodes.push(primaryStateCode);
  if (
    setup?.multi_state_active &&
    secondaryStateCode &&
    secondaryStateCode !== primaryStateCode
  ) {
    seedCodes.push(secondaryStateCode);
  }

  // Also include any explicit keys present in default_split (e.g., 3rd/0% states)
  const splitKeys = Object.keys(setup?.state_revenue_apportionment?.default_split ?? {});
  for (const k of splitKeys) {
    const clean = sanitizeStateCode(k);
    if (clean && !seedCodes.includes(clean)) {
      seedCodes.push(clean);
    }
  }

  return dedupeStateCodes(seedCodes);
}

/**
 * Computes the rounded sum of percentages across the provided active states.
 */
export function sumStateSplit(
  split: StateApportionmentSplit | undefined | null,
  activeStates: string[]
): number {
  return roundPct1(
    activeStates.reduce((acc, code) => {
      const val = split?.[code];
      return acc + (typeof val === 'number' && Number.isFinite(val) ? val : 0);
    }, 0)
  );
}

/**
 * Normalizes a state percentage map for the given active states so percentages are clamped to [0, 100]
 * and ALWAYS sum to exactly 100% (or {} when no states are active), strictly preserving 0% states at 0%.
 */
export function normalizeStateSplit(
  rawSplit: StateApportionmentSplit | undefined | null,
  activeStates: string[],
  fallbackPrimaryPct = 50
): StateApportionmentSplit {
  if (activeStates.length === 0) return {};
  if (activeStates.length === 1) {
    return { [activeStates[0]]: 100 };
  }

  const clampedFallback = roundPct1(Math.min(100, Math.max(0, fallbackPrimaryPct)));
  const rawValues = activeStates.map((code) => {
    const val = rawSplit?.[code];
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
  });

  const hasAnyValid = rawValues.some((v) => v !== null);
  if (!hasAnyValid) {
    const [first, second, ...rest] = activeStates;
    const out: StateApportionmentSplit = {
      [first]: clampedFallback,
      [second]: roundPct1(100 - clampedFallback),
    };
    for (const code of rest) out[code] = 0;
    return out;
  }

  const filled = rawValues.map((v) => v ?? 0);
  const total = filled.reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    const [first, second, ...rest] = activeStates;
    const out: StateApportionmentSplit = {
      [first]: clampedFallback,
      [second]: roundPct1(100 - clampedFallback),
    };
    for (const code of rest) out[code] = 0;
    return out;
  }

  // Assign rounding residual to the last positive-weight state so explicit 0% states (e.g., WA) stay strictly 0%
  let lastPositiveIdx = -1;
  for (let i = activeStates.length - 1; i >= 0; i--) {
    if (filled[i] > 0) {
      lastPositiveIdx = i;
      break;
    }
  }
  if (lastPositiveIdx < 0) lastPositiveIdx = 0;

  const out: StateApportionmentSplit = {};
  let running = 0;
  for (let i = 0; i < activeStates.length; i++) {
    const code = activeStates[i];
    if (filled[i] <= 0) {
      out[code] = 0;
    } else if (i === lastPositiveIdx) {
      out[code] = roundPct1(Math.max(0, 100 - running));
    } else {
      const pct = roundPct1((filled[i] / total) * 100);
      out[code] = pct;
      running = roundPct1(running + pct);
    }
  }
  return out;
}

/**
 * Auto-balances a state split to 100% when a single state's percentage is edited.
 * Preserves any 0% states (such as WA) untouched whenever other revenue-generating states exist.
 */
export function autoBalanceSplitOnEdit(
  currentSplit: StateApportionmentSplit,
  activeStates: string[],
  editedCode: string,
  nextValue: number
): StateApportionmentSplit {
  if (activeStates.length === 0) return {};
  if (activeStates.length === 1) return { [activeStates[0]]: 100 };

  const clamped = roundPct1(Math.min(100, Math.max(0, nextValue)));
  const remaining = roundPct1(Math.max(0, 100 - clamped));
  const others = activeStates.filter((c) => c !== editedCode);

  const out: StateApportionmentSplit = { [editedCode]: clamped };

  if (others.length === 1) {
    out[others[0]] = remaining;
    return out;
  }

  const positiveOthers = others.filter((c) => (currentSplit[c] ?? 0) > 0);
  if (positiveOthers.length === 0) {
    // All other states were 0% — assign remainder to the first other state
    out[others[0]] = remaining;
    for (let i = 1; i < others.length; i++) {
      out[others[i]] = 0;
    }
    return out;
  }

  const positiveSum = positiveOthers.reduce((acc, c) => acc + (currentSplit[c] ?? 0), 0);
  for (const c of others) {
    if (!positiveOthers.includes(c)) {
      out[c] = 0;
    }
  }

  let running = 0;
  for (let i = 0; i < positiveOthers.length; i++) {
    const c = positiveOthers[i];
    if (i === positiveOthers.length - 1) {
      out[c] = roundPct1(Math.max(0, remaining - running));
    } else {
      const share = roundPct1(((currentSplit[c] ?? 0) / positiveSum) * remaining);
      out[c] = share;
      running = roundPct1(running + share);
    }
  }
  return out;
}

function splitsMatch(
  a: StateApportionmentSplit,
  b: StateApportionmentSplit,
  activeStates: string[]
): boolean {
  return activeStates.every((code) => Math.abs((a[code] ?? 0) - (b[code] ?? 0)) <= 0.05);
}

/**
 * Normalizes Setup's state_revenue_apportionment config against active business states.
 */
export function normalizeStateApportionmentConfig(
  raw: StateRevenueApportionmentConfig | undefined | null,
  setup?: SetupConfig | null,
  fallbackPrimaryPct = 50
): StateRevenueApportionmentConfig {
  const effectiveSetup = raw
    ? ({
        ...(setup ?? ({} as SetupConfig)),
        state_revenue_apportionment: raw,
      } as SetupConfig)
    : setup;
  const activeStates = getActiveBusinessStates(effectiveSetup);
  const default_split = normalizeStateSplit(raw?.default_split, activeStates, fallbackPrimaryPct);
  const year_overrides: Record<number, StateApportionmentSplit> = {};

  if (raw?.year_overrides && activeStates.length >= 2) {
    for (const [yrKey, splitVal] of Object.entries(raw.year_overrides)) {
      const yrNum = Number(yrKey);
      if (!Number.isFinite(yrNum) || !splitVal) continue;
      const hasMatchingActiveKey = activeStates.some(
        (code) => typeof splitVal[code] === 'number' && Number.isFinite(splitVal[code])
      );
      if (!hasMatchingActiveKey) continue;
      const normalized = normalizeStateSplit(splitVal, activeStates, fallbackPrimaryPct);
      if (!splitsMatch(normalized, default_split, activeStates)) {
        year_overrides[yrNum] = normalized;
      }
    }
  }

  return {
    states: activeStates,
    default_split,
    year_overrides,
  };
}

export interface ResolvedYearStateApportionment {
  activeStates: string[];
  primaryCode: string;
  secondaryCode: string;
  hasSecondary: boolean;
  split: StateApportionmentSplit;
  primaryPct: number;
  secondaryPct: number;
  primaryRatio: number;
  secondaryRatio: number;
  isYearOverride: boolean;
}

/**
 * Resolves the active state revenue apportionment split for a given tax year from Setup.
 */
export function resolveStateApportionmentForYear(
  setup: SetupConfig | undefined | null,
  taxYear: number
): ResolvedYearStateApportionment {
  const activeStates = getActiveBusinessStates(setup);
  const primaryCode = activeStates[0] ?? '';
  const secondaryCode = activeStates[1] ?? '';
  const hasSecondary = activeStates.length >= 2;

  if (activeStates.length === 0) {
    return {
      activeStates: [],
      primaryCode: '',
      secondaryCode: '',
      hasSecondary: false,
      split: {},
      primaryPct: 0,
      secondaryPct: 0,
      primaryRatio: 1,
      secondaryRatio: 0,
      isYearOverride: false,
    };
  }

  if (!hasSecondary) {
    return {
      activeStates,
      primaryCode,
      secondaryCode: '',
      hasSecondary: false,
      split: { [primaryCode]: 100 },
      primaryPct: 100,
      secondaryPct: 0,
      primaryRatio: 1,
      secondaryRatio: 0,
      isYearOverride: false,
    };
  }

  const config = setup?.state_revenue_apportionment;
  const defaultSplit = normalizeStateSplit(config?.default_split, activeStates, 50);
  const rawOverride = config?.year_overrides?.[taxYear];

  if (rawOverride) {
    const normalizedOverride = normalizeStateSplit(
      rawOverride,
      activeStates,
      defaultSplit[primaryCode] ?? 50
    );
    const isYearOverride = !splitsMatch(normalizedOverride, defaultSplit, activeStates);
    const primaryPct = normalizedOverride[primaryCode] ?? 0;
    const secondaryPct = normalizedOverride[secondaryCode] ?? 0;
    return {
      activeStates,
      primaryCode,
      secondaryCode,
      hasSecondary: true,
      split: normalizedOverride,
      primaryPct,
      secondaryPct,
      primaryRatio: primaryPct / 100,
      secondaryRatio: secondaryPct / 100,
      isYearOverride,
    };
  }

  const primaryPct = defaultSplit[primaryCode] ?? 50;
  const secondaryPct = defaultSplit[secondaryCode] ?? 0;
  return {
    activeStates,
    primaryCode,
    secondaryCode,
    hasSecondary: true,
    split: defaultSplit,
    primaryPct,
    secondaryPct,
    primaryRatio: primaryPct / 100,
    secondaryRatio: secondaryPct / 100,
    isYearOverride: false,
  };
}

/**
 * Adds a US state to Setup's dynamic State Revenue Apportionment panel.
 * New states start at 0% (or 100% if it is the very first state), preserving existing percentages at 100%.
 */
export function addApportionmentState(setup: SetupConfig, rawStateCode: string): SetupConfig {
  const code = sanitizeStateCode(rawStateCode);
  if (!code) return setup;

  const currentStates = getActiveBusinessStates(setup);
  if (currentStates.includes(code)) return setup;

  const currentConfig = normalizeStateApportionmentConfig(setup.state_revenue_apportionment, setup);
  const nextStates = [...currentStates, code];

  if (currentStates.length === 0) {
    return {
      ...setup,
      home_state: setup.home_state || code,
      state_revenue_apportionment: {
        states: [code],
        default_split: { [code]: 100 },
        year_overrides: {},
      },
    };
  }

  const nextDefault: StateApportionmentSplit = {
    ...currentConfig.default_split,
    [code]: 0,
  };
  const nextOverrides: Record<number, StateApportionmentSplit> = {};
  for (const [yrKey, splitVal] of Object.entries(currentConfig.year_overrides ?? {})) {
    const yrNum = Number(yrKey);
    if (!Number.isFinite(yrNum)) continue;
    nextOverrides[yrNum] = {
      ...splitVal,
      [code]: 0,
    };
  }

  return {
    ...setup,
    multi_state_active: nextStates.length >= 2 ? true : setup.multi_state_active,
    secondary_state:
      nextStates.length >= 2 && !(setup.secondary_state ?? '').trim()
        ? nextStates[1]
        : setup.secondary_state,
    state_revenue_apportionment: {
      states: nextStates,
      default_split: nextDefault,
      year_overrides: nextOverrides,
    },
  };
}

/**
 * Removes a US state from Setup's dynamic State Revenue Apportionment panel and re-balances
 * remaining states proportionally to sum to 100% across both default and per-year overrides.
 */
export function removeApportionmentState(setup: SetupConfig, rawStateCode: string): SetupConfig {
  const code = sanitizeStateCode(rawStateCode);
  const currentStates = getActiveBusinessStates(setup);
  if (!code || !currentStates.includes(code) || currentStates.length <= 1) {
    return setup;
  }

  const currentConfig = normalizeStateApportionmentConfig(setup.state_revenue_apportionment, setup);
  const remainingStates = currentStates.filter((s) => s !== code);
  const nextDefault = normalizeStateSplit(currentConfig.default_split, remainingStates, 50);

  const nextOverrides: Record<number, StateApportionmentSplit> = {};
  if (remainingStates.length >= 2) {
    for (const [yrKey, splitVal] of Object.entries(currentConfig.year_overrides ?? {})) {
      const yrNum = Number(yrKey);
      if (!Number.isFinite(yrNum)) continue;
      const norm = normalizeStateSplit(splitVal, remainingStates, nextDefault[remainingStates[0]] ?? 50);
      if (!splitsMatch(norm, nextDefault, remainingStates)) {
        nextOverrides[yrNum] = norm;
      }
    }
  }

  const prevHome = sanitizeStateCode(setup.home_state);
  const prevSec = sanitizeStateCode(setup.secondary_state);
  let nextHome = prevHome;
  let nextSec = prevSec;

  if (prevHome === code) {
    nextHome = remainingStates[0] ?? '';
    nextSec = remainingStates.find((s) => s !== nextHome) ?? '';
  } else if (prevSec === code) {
    nextSec = remainingStates.find((s) => s !== nextHome) ?? '';
  }

  return {
    ...setup,
    home_state: nextHome,
    secondary_state: nextSec,
    state_revenue_apportionment: {
      states: remainingStates,
      default_split: nextDefault,
      year_overrides: nextOverrides,
    },
  };
}

/**
 * Replaces an existing state code in Setup's apportionment config (e.g. when user changes
 * Primary or Secondary State in Section 2) while preserving its percentage share and any extra states.
 */
export function replaceApportionmentStateCode(
  setup: SetupConfig,
  oldCodeRaw: string | undefined | null,
  newCodeRaw: string | undefined | null
): SetupConfig {
  const oldCode = sanitizeStateCode(oldCodeRaw);
  const newCode = sanitizeStateCode(newCodeRaw);
  const currentStates = getActiveBusinessStates(setup);
  const currentConfig = normalizeStateApportionmentConfig(setup.state_revenue_apportionment, setup);

  if (oldCode === newCode) return setup;

  const mapSplit = (split: StateApportionmentSplit, targetStates: string[]): StateApportionmentSplit => {
    const out: StateApportionmentSplit = {};
    for (const st of targetStates) {
      if (st === newCode && oldCode && split[oldCode] !== undefined && split[newCode] === undefined) {
        out[st] = split[oldCode];
      } else {
        out[st] = split[st] ?? 0;
      }
    }
    return normalizeStateSplit(out, targetStates, 50);
  };

  let nextStates: string[];
  if (oldCode && currentStates.includes(oldCode)) {
    nextStates = newCode
      ? dedupeStateCodes(currentStates.map((s) => (s === oldCode ? newCode : s)))
      : currentStates.filter((s) => s !== oldCode);
  } else if (newCode) {
    nextStates = dedupeStateCodes([...currentStates, newCode]);
  } else {
    nextStates = currentStates;
  }

  const nextDefault = mapSplit(currentConfig.default_split, nextStates);
  const nextOverrides: Record<number, StateApportionmentSplit> = {};
  if (nextStates.length >= 2) {
    for (const [yrKey, splitVal] of Object.entries(currentConfig.year_overrides ?? {})) {
      const yrNum = Number(yrKey);
      if (!Number.isFinite(yrNum)) continue;
      const mapped = mapSplit(splitVal, nextStates);
      if (!splitsMatch(mapped, nextDefault, nextStates)) {
        nextOverrides[yrNum] = mapped;
      }
    }
  }

  return {
    ...setup,
    state_revenue_apportionment: {
      states: nextStates,
      default_split: nextDefault,
      year_overrides: nextOverrides,
    },
  };
}

/**
 * Updates Setup's default forecast split with a full N-state percentage map (normalized to 100%).
 */
export function updateDefaultStateApportionmentSplit(
  setup: SetupConfig,
  rawSplit: StateApportionmentSplit
): SetupConfig {
  const activeStates = getActiveBusinessStates(setup);
  if (activeStates.length === 0) return setup;
  if (activeStates.length === 1) {
    return {
      ...setup,
      state_revenue_apportionment: {
        states: activeStates,
        default_split: { [activeStates[0]]: 100 },
        year_overrides: {},
      },
    };
  }

  const nextDefault = normalizeStateSplit(rawSplit, activeStates, 50);
  const nextOverrides: Record<number, StateApportionmentSplit> = {};
  const existingOverrides = setup.state_revenue_apportionment?.year_overrides ?? {};
  for (const [yrKey, splitVal] of Object.entries(existingOverrides)) {
    const yrNum = Number(yrKey);
    if (!Number.isFinite(yrNum)) continue;
    const norm = normalizeStateSplit(splitVal, activeStates, nextDefault[activeStates[0]] ?? 50);
    if (!splitsMatch(norm, nextDefault, activeStates)) {
      nextOverrides[yrNum] = norm;
    }
  }

  return {
    ...setup,
    state_revenue_apportionment: {
      states: activeStates,
      default_split: nextDefault,
      year_overrides: nextOverrides,
    },
  };
}

/**
 * Updates (or clears with null) a specific tax year's N-state revenue split override.
 */
export function updateYearStateApportionmentSplit(
  setup: SetupConfig,
  taxYear: number,
  rawSplit: StateApportionmentSplit | null
): SetupConfig {
  const activeStates = getActiveBusinessStates(setup);
  const currentConfig = normalizeStateApportionmentConfig(setup.state_revenue_apportionment, setup);
  const nextOverrides: Record<number, StateApportionmentSplit> = {
    ...(currentConfig.year_overrides ?? {}),
  };

  if (rawSplit === null || activeStates.length < 2) {
    delete nextOverrides[taxYear];
  } else {
    const normalized = normalizeStateSplit(
      rawSplit,
      activeStates,
      currentConfig.default_split[activeStates[0]] ?? 50
    );
    if (splitsMatch(normalized, currentConfig.default_split, activeStates)) {
      delete nextOverrides[taxYear];
    } else {
      nextOverrides[taxYear] = normalized;
    }
  }

  return {
    ...setup,
    state_revenue_apportionment: {
      states: activeStates,
      default_split: currentConfig.default_split,
      year_overrides: nextOverrides,
    },
  };
}

/**
 * Returns a new SetupConfig with the default forecast state split updated for primary state
 * (auto-balancing remaining revenue-generating states to 100% while preserving 0% states).
 */
export function setDefaultStateApportionmentSplit(
  setup: SetupConfig,
  primaryPctInput: number
): SetupConfig {
  const activeStates = getActiveBusinessStates(setup);
  if (activeStates.length < 2) {
    return {
      ...setup,
      state_revenue_apportionment: {
        states: activeStates,
        default_split: activeStates.length === 1 ? { [activeStates[0]]: 100 } : {},
        year_overrides: {},
      },
    };
  }

  const currentConfig = normalizeStateApportionmentConfig(setup.state_revenue_apportionment, setup);
  const nextDefault = autoBalanceSplitOnEdit(
    currentConfig.default_split,
    activeStates,
    activeStates[0],
    primaryPctInput
  );
  return updateDefaultStateApportionmentSplit(setup, nextDefault);
}

/**
 * Returns a new SetupConfig with a specific tax year's state revenue split overridden or reset to default.
 */
export function setYearStateApportionmentOverride(
  setup: SetupConfig,
  taxYear: number,
  primaryPctInput: number | null
): SetupConfig {
  const activeStates = getActiveBusinessStates(setup);
  if (primaryPctInput === null || activeStates.length < 2) {
    return updateYearStateApportionmentSplit(setup, taxYear, null);
  }
  const resolved = resolveStateApportionmentForYear(setup, taxYear);
  const nextSplit = autoBalanceSplitOnEdit(
    resolved.split,
    activeStates,
    activeStates[0],
    primaryPctInput
  );
  return updateYearStateApportionmentSplit(setup, taxYear, nextSplit);
}

/**
 * Applies Setup's resolved state revenue apportionment split to a single non-locked forecast TaxYearRecord,
 * preserving total gross revenue while updating primary/secondary revenues, N-state state_sourcing_breakdown,
 * and N-state state_filings (preserving existing residency statuses and adding any newly selected states).
 */
export function applySetupApportionmentToYear(
  yr: TaxYearRecord,
  setup: SetupConfig
): TaxYearRecord {
  if (yr.is_locked_actuals) return yr;
  const resolved = resolveStateApportionmentForYear(setup, yr.tax_year);
  if (resolved.activeStates.length === 0) return yr;

  const totalRev = Math.max(
    0,
    Math.round(
      Number.isFinite(yr.scorp_1120s.ca_revenue) && Number.isFinite(yr.scorp_1120s.az_revenue)
        ? yr.scorp_1120s.ca_revenue + yr.scorp_1120s.az_revenue
        : yr.scorp_1120s.gross_receipts_revenue
    )
  );
  const primaryRev = resolved.hasSecondary
    ? Math.round(totalRev * resolved.primaryRatio)
    : totalRev;
  const secondaryRev = resolved.hasSecondary ? Math.max(0, totalRev - primaryRev) : 0;

  const nextBreakdown = resolved.activeStates.map((code) => ({
    state_code: code,
    apportionment_percent: resolved.split[code] ?? 0,
  }));

  const existingByCode = new Map(yr.state_filings.map((sf) => [sf.state_code, sf]));
  const nextFilings = yr.state_filings.map((sf) =>
    Object.prototype.hasOwnProperty.call(resolved.split, sf.state_code)
      ? { ...sf, state_apportionment_factor: (resolved.split[sf.state_code] ?? 0) / 100 }
      : sf
  );

  for (const code of resolved.activeStates) {
    if (!existingByCode.has(code)) {
      const isPrimary = code === resolved.primaryCode && nextFilings.length === 0;
      nextFilings.push({
        state_code: code,
        residency_status: isPrimary ? 'resident' : 'non_resident',
        residency_start_date: `${yr.tax_year}-01-01`,
        residency_end_date: `${yr.tax_year}-12-31`,
        residency_day_or_income_ratio: isPrimary ? 1 : 0,
        state_return_type: isPrimary
          ? `${code} Resident Return`
          : `${code} Non-Resident Return`,
        state_apportionment_factor: (resolved.split[code] ?? 0) / 100,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      });
    }
  }

  return {
    ...yr,
    scorp_1120s: {
      ...yr.scorp_1120s,
      ca_revenue: primaryRev,
      az_revenue: secondaryRev,
      gross_receipts_revenue: totalRev,
      state_sourcing_breakdown: nextBreakdown,
    },
    state_filings: nextFilings,
  };
}
