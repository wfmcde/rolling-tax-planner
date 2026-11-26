import type {
  ComputedTaxYear,
  FilingStatus,
  Form1040Outputs,
  SCorp1120SOutputs,
  SetupConfig,
  SsYearMode,
  StateFilingOutputs,
  TaxYearRecord,
} from '../types/tax';
import {
  MONTH_SHORT_NAMES,
  calculateFraInfo,
  formatDrcPercent,
  getAgeInTaxYear,
  getPersonBirthMonth,
  parseBirthDate,
  sumEnteredMedicareMonthly,
} from '../utils/personTax';
import { computeIrmaaBracketThresholds, resolveIrmaaThresholdForYear } from './irmaa';
import { computeReasonableCompRatio } from './validator';
import {
  getSetupStates,
  getStateFullName,
  resolveStateApportionmentForYear,
} from '../utils/setupHelpers';

interface TaxBracket {
  upTo: number;
  rate: number;
}

// 2025 Federal Ordinary Income Tax Brackets (base year; indexed forward by inflation_rate)
const BASE_BRACKETS_2025: Record<FilingStatus, TaxBracket[]> = {
  married_filing_jointly: [
    { upTo: 23850, rate: 0.1 },
    { upTo: 96950, rate: 0.12 },
    { upTo: 206700, rate: 0.22 },
    { upTo: 394600, rate: 0.24 },
    { upTo: 501050, rate: 0.32 },
    { upTo: 751600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  single: [
    { upTo: 11925, rate: 0.1 },
    { upTo: 48475, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { upTo: 17000, rate: 0.1 },
    { upTo: 64850, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250500, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married_filing_separately: [
    { upTo: 11925, rate: 0.1 },
    { upTo: 48475, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 375800, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

// 2025 Standard Deductions (OBBBA statutory amounts: MFJ $31,500 + $1,600/senior = $34,700 for two age 65+)
const BASE_STD_DEDUCTION_2025: Record<FilingStatus, number> = {
  married_filing_jointly: 31500,
  single: 15750,
  head_of_household: 23625,
  married_filing_separately: 15750,
};

// 2025 LTCG / Qualified Dividend Thresholds
const BASE_LTCG_2025: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }> = {
  married_filing_jointly: { zeroUpTo: 96700, fifteenUpTo: 600050 },
  single: { zeroUpTo: 48350, fifteenUpTo: 533400 },
  head_of_household: { zeroUpTo: 64750, fifteenUpTo: 566700 },
  married_filing_separately: { zeroUpTo: 48350, fifteenUpTo: 300000 },
};

// 2025 QBI Section 199A Thresholds
const BASE_QBI_THRESHOLD_2025: Record<FilingStatus, { start: number; phaseoutRange: number }> = {
  married_filing_jointly: { start: 394600, phaseoutRange: 100000 },
  single: { start: 197300, phaseoutRange: 50000 },
  head_of_household: { start: 197300, phaseoutRange: 50000 },
  married_filing_separately: { start: 197300, phaseoutRange: 50000 },
};

// State Tax Configuration
export interface StateTaxRule {
  code: string;
  name: string;
  mode: 'none' | 'flat' | 'progressive';
  flatRate?: number;
  brackets?: TaxBracket[];
  stdDeduction: number;
  exemptsSocialSecurity?: boolean;
  personalExemptionCredit?: number;
  seniorExemptionCredit?: number;
  pteAvailable: boolean;
  pteRate: number;
  scorpMinTax: number;
  scorpEntityRate: number;
}

export const STATE_TAX_RULES: Record<string, StateTaxRule> = {
  AZ: {
    code: 'AZ',
    name: 'Arizona',
    mode: 'flat',
    flatRate: 0.025,
    stdDeduction: 31500,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0298,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  CA: {
    code: 'CA',
    name: 'California',
    mode: 'progressive',
    // 2025 FTB MFJ Tax Rate Schedule
    brackets: [
      { upTo: 22158, rate: 0.01 },
      { upTo: 52528, rate: 0.02 },
      { upTo: 82904, rate: 0.04 },
      { upTo: 115084, rate: 0.06 },
      { upTo: 145448, rate: 0.08 },
      { upTo: 742958, rate: 0.093 },
      { upTo: 891542, rate: 0.103 },
      { upTo: 1485906, rate: 0.113 },
      { upTo: Infinity, rate: 0.123 },
    ],
    stdDeduction: 11412,
    exemptsSocialSecurity: true,
    personalExemptionCredit: 153,
    seniorExemptionCredit: 153,
    pteAvailable: true,
    pteRate: 0.093,
    scorpMinTax: 800,
    scorpEntityRate: 0.015,
  },
  WA: {
    code: 'WA',
    name: 'Washington',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  TX: {
    code: 'TX',
    name: 'Texas',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  NV: {
    code: 'NV',
    name: 'Nevada',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  FL: {
    code: 'FL',
    name: 'Florida',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  CO: {
    code: 'CO',
    name: 'Colorado',
    mode: 'flat',
    flatRate: 0.044,
    stdDeduction: 31500,
    pteAvailable: true,
    pteRate: 0.044,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  NY: {
    code: 'NY',
    name: 'New York',
    mode: 'progressive',
    brackets: [
      { upTo: 17150, rate: 0.04 },
      { upTo: 23600, rate: 0.045 },
      { upTo: 27900, rate: 0.0525 },
      { upTo: 161550, rate: 0.055 },
      { upTo: 323200, rate: 0.06 },
      { upTo: 2155350, rate: 0.0685 },
      { upTo: Infinity, rate: 0.0965 },
    ],
    stdDeduction: 16050,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0685,
    scorpMinTax: 300,
    scorpEntityRate: 0,
  },
  OR: {
    code: 'OR',
    name: 'Oregon',
    mode: 'progressive',
    brackets: [
      { upTo: 8600, rate: 0.0475 },
      { upTo: 21500, rate: 0.0675 },
      { upTo: 250000, rate: 0.0875 },
      { upTo: Infinity, rate: 0.099 },
    ],
    stdDeduction: 5495,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.09,
    scorpMinTax: 150,
    scorpEntityRate: 0,
  },
  TN: {
    code: 'TN',
    name: 'Tennessee',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  IL: {
    code: 'IL',
    name: 'Illinois',
    mode: 'flat',
    flatRate: 0.0495,
    stdDeduction: 5550,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0495,
    scorpMinTax: 0,
    scorpEntityRate: 0.015,
  },
  NC: {
    code: 'NC',
    name: 'North Carolina',
    mode: 'flat',
    flatRate: 0.0425,
    stdDeduction: 25500,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0425,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  GA: {
    code: 'GA',
    name: 'Georgia',
    mode: 'flat',
    flatRate: 0.0539,
    stdDeduction: 24000,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0539,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  UT: {
    code: 'UT',
    name: 'Utah',
    mode: 'flat',
    flatRate: 0.0455,
    stdDeduction: 0,
    exemptsSocialSecurity: false,
    pteAvailable: true,
    pteRate: 0.0455,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  PA: {
    code: 'PA',
    name: 'Pennsylvania',
    mode: 'flat',
    flatRate: 0.0307,
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  MA: {
    code: 'MA',
    name: 'Massachusetts',
    mode: 'flat',
    flatRate: 0.05,
    stdDeduction: 8800,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.05,
    scorpMinTax: 456,
    scorpEntityRate: 0,
  },
  VA: {
    code: 'VA',
    name: 'Virginia',
    mode: 'flat',
    flatRate: 0.0575,
    stdDeduction: 17000,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.0575,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  OH: {
    code: 'OH',
    name: 'Ohio',
    mode: 'flat',
    flatRate: 0.035,
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: true,
    pteRate: 0.03,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  AK: {
    code: 'AK',
    name: 'Alaska',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  NH: {
    code: 'NH',
    name: 'New Hampshire',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  SD: {
    code: 'SD',
    name: 'South Dakota',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  WY: {
    code: 'WY',
    name: 'Wyoming',
    mode: 'none',
    stdDeduction: 0,
    exemptsSocialSecurity: true,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round0(n: number): number {
  return Math.round(n);
}

function inflationFactor(taxYear: number, rate: number): number {
  const delta = Math.max(0, taxYear - 2025);
  return Math.pow(1 + rate, delta);
}

function computeProgressiveTax(
  taxableIncome: number,
  brackets: TaxBracket[],
  scale = 1,
  useIrsTaxTableMidpoint = false
): {
  tax: number;
  marginalRate: number;
  nextBracketHeadroom: number | null;
  nextBracketRate: number | null;
} {
  if (taxableIncome <= 0) {
    const firstCap =
      brackets[0]?.upTo === Infinity ? null : round0((brackets[0]?.upTo ?? 0) * scale);
    return {
      tax: 0,
      marginalRate: brackets[0]?.rate ?? 0.1,
      nextBracketHeadroom: firstCap,
      nextBracketRate: brackets[1] ? round2(brackets[1].rate * 100) : null,
    };
  }

  // Per IRS Form 1040 instructions, ordinary taxable income under $100,000 (>= $3,000)
  // uses the IRS Tax Table $50 bracket midpoint.
  const effectiveIncomeForTax =
    useIrsTaxTableMidpoint && taxableIncome >= 3000 && taxableIncome < 100000
      ? Math.floor(taxableIncome / 50) * 50 + 25
      : taxableIncome;

  let remaining = effectiveIncomeForTax;
  let prevCap = 0;
  let tax = 0;
  let marginalRate = brackets[0].rate;
  let activeBracketIdx = 0;

  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    const cap = bracket.upTo === Infinity ? Infinity : round0(bracket.upTo * scale);
    const width = cap === Infinity ? remaining : Math.max(0, cap - prevCap);
    const slice = Math.min(remaining, width);
    if (slice > 0) {
      tax += slice * bracket.rate;
      marginalRate = bracket.rate;
      activeBracketIdx = i;
      remaining -= slice;
    }
    prevCap = cap;
    if (remaining <= 0) break;
  }

  const activeBracket = brackets[activeBracketIdx];
  const nextBracket = brackets[activeBracketIdx + 1];
  let nextBracketHeadroom: number | null = null;
  let nextBracketRate: number | null = null;

  if (activeBracket && activeBracket.upTo !== Infinity && nextBracket) {
    const activeCap = round0(activeBracket.upTo * scale);
    nextBracketHeadroom = Math.max(0, activeCap - taxableIncome);
    nextBracketRate = round2(nextBracket.rate * 100);
  }

  return { tax: round0(tax), marginalRate, nextBracketHeadroom, nextBracketRate };
}

function computeSocialSecurityTaxable(
  ssGross: number,
  nonSsAgiPlusTaxExempt: number,
  filingStatus: FilingStatus
): number {
  if (ssGross <= 0) return 0;
  // IRS Form 1040 Social Security Benefits Worksheet:
  // Provisional Income = Non-SS AGI + Tax-Exempt Interest + 50% of Gross Social Security
  const provisional = nonSsAgiPlusTaxExempt + 0.5 * ssGross;
  const base1 =
    filingStatus === 'married_filing_jointly'
      ? 32000
      : filingStatus === 'married_filing_separately'
      ? 0
      : 25000;
  const base2 =
    filingStatus === 'married_filing_jointly'
      ? 44000
      : filingStatus === 'married_filing_separately'
      ? 0
      : 34000;

  if (provisional <= base1) return 0;
  if (provisional <= base2) {
    return round0(Math.min(0.5 * ssGross, 0.5 * (provisional - base1)));
  }
  const tier1Max =
    filingStatus === 'married_filing_jointly'
      ? 6000
      : filingStatus === 'married_filing_separately'
      ? 0
      : 4500;
  const tier2 = 0.85 * (provisional - base2) + Math.min(tier1Max, 0.5 * ssGross);
  return round0(Math.min(0.85 * ssGross, tier2));
}

export function computeIrmaaPerEnrollee(
  lookbackMagi: number,
  coverageYear: number,
  setup: SetupConfig,
  surchargeScale: number
): {
  tier: string;
  perEnrolleeSurcharge: number;
  tier1Threshold: number;
  formulaTier1Threshold: number;
  isOverridden: boolean;
} {
  const { resolved, thresholds } = computeIrmaaBracketThresholds(coverageYear, setup);
  const perEnrolleeSurcharges = [0, 1052, 2642, 4232, 5822, 6352];
  const labels = [
    'Standard (No IRMAA)',
    'Tier 1 IRMAA',
    'Tier 2 IRMAA',
    'Tier 3 IRMAA',
    'Tier 4 IRMAA',
    'Tier 5 IRMAA',
  ];

  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (lookbackMagi > thresholds[i]) {
      idx = i + 1;
    }
  }

  return {
    tier: labels[idx],
    perEnrolleeSurcharge: round0(perEnrolleeSurcharges[idx] * surchargeScale),
    tier1Threshold: resolved.effectiveThreshold,
    formulaTier1Threshold: resolved.formulaThreshold,
    isOverridden: resolved.isOverridden,
  };
}

function computePersonFica(wages: number, ssWageBase: number): number {
  if (wages <= 0) return 0;
  const ss = Math.min(wages, ssWageBase) * 0.062;
  const med = wages * 0.0145;
  return round0(ss + med);
}

function computePerson401kLimits(
  wages: number,
  age: number | null,
  ssWageBase: number,
  scale: number,
  employerRate: number,
  enabled: boolean
): { employeeDeferral: number; employerProfitSharing: number } {
  if (!enabled || wages <= 0) {
    return { employeeDeferral: 0, employerProfitSharing: 0 };
  }

  // IRS 402(g) elective deferral limit ($23,500 base) + age 50+ ($7,500) / age 60-63 SECURE 2.0 ($11,250)
  const base402g = Math.round((23500 * scale) / 500) * 500;
  const catchUp =
    age !== null && age >= 60 && age <= 63
      ? Math.round((11250 * scale) / 250) * 250
      : age !== null && age >= 50
      ? Math.round((7500 * scale) / 500) * 500
      : 0;
  const empFica = computePersonFica(wages, ssWageBase);
  const netW2Available = Math.max(0, wages - empFica);
  const employeeDeferral = round0(Math.min(netW2Available, base402g + catchUp));

  // Employer profit sharing capped by employerRate (6% through DBP term year; Post-DBP rate up to 25% after)
  // and IRS §415(c) annual additions limit ($70,000 base; catch-up is outside §415(c) room)
  const limit415c = Math.round((70000 * scale) / 1000) * 1000;
  const baseDeferralUsed = Math.min(employeeDeferral, base402g);
  const room415c = Math.max(0, Math.min(wages, limit415c) - baseDeferralUsed);
  const rawEmployerShare = round0(wages * Math.min(0.25, Math.max(0, employerRate)));
  const employerProfitSharing = round0(Math.min(rawEmployerShare, room415c));

  return { employeeDeferral, employerProfitSharing };
}

function defaultSsModeForYear(
  profile: SetupConfig['primary_profile'] | undefined,
  fallbackBirthYear: number,
  taxYear: number,
  anchorYear: number,
  wasSuspendedPriorYear: boolean
): SsYearMode {
  if (!profile || !profile.social_security.receiving) return 'off';
  // Social Security projection starts in the active setup baseline year (never in prior baseline years)
  if (taxYear < anchorYear) return 'off';
  const parsedDob = parseBirthDate(profile.birth_date);
  const birthYear = parsedDob?.year ?? fallbackBirthYear;
  const age70Year = birthYear + 70;

  // Age-70 year defaults to 'suspended' (partial-year resume at birth month) ONLY when the
  // immediately preceding year (age70Year - 1) was suspended; otherwise defaults to 'on'.
  if (taxYear === age70Year) {
    return wasSuspendedPriorYear ? 'suspended' : 'on';
  }

  if (!profile.social_security.suspend_fra_to_70) return 'on';
  const fra = calculateFraInfo(profile.birth_date);
  const resumeAge = Math.min(70, Math.max(68, profile.social_security.resume_age || 70));
  const suspendStart =
    profile.social_security.suspend_start_year ?? (fra ? fra.fraYear : anchorYear + 1);
  const resumeYear = birthYear + resumeAge;
  if (taxYear >= suspendStart && taxYear < resumeYear) return 'suspended';
  return 'on';
}

interface SsTrackState {
  suspendedMonths: number;
  wasSuspendedPriorYear: boolean;
}

interface ComputePersonSsYearParams {
  profile: SetupConfig['primary_profile'] | undefined;
  fallbackBirthYear: number;
  fallbackBirthMonth: number;
  taxYear: number;
  setupBaseYear: number;
  yearsFromSetupBase: number;
  ssColaFactor: number;
  ssColaLabel: string;
  isLockedActuals: boolean;
  requestedMode: SsYearMode;
  overrideAmount: number | null | undefined;
  track: SsTrackState;
}

/**
 * Statutory Social Security voluntary suspension engine (birth-date driven for all households):
 * - FRA year set to "Susp": prorates months BEFORE birth month:
 *   fullYearCOLA * ((birthMonth - 1) / 12), accruing (13 - birthMonth) suspended DRC months.
 * - Full suspension years (FRA < year < age70Year): $0 benefit, accruing 12 suspended DRC months/yr.
 * - Age-70 year (year === age70Year):
 *   - "Susp": suspends months before birth month (adding birthMonth - 1 DRC months), automatically
 *     resumes in birth month at Age 70 with all accrued DRCs (+2/3% per month, capped at 36 mos / +24%),
 *     prorated for (13 - birthMonth) / 12 months.
 *   - "On": pays a full 12-month year (never prorated) applying only DRCs accrued through Dec of
 *     age70Year - 1 (or pure compounded COLA if no prior years were suspended).
 *   - "Off": true $0 override with no DRCs.
 */
function computePersonSsYear(params: ComputePersonSsYearParams): {
  gross: number;
  effectiveMode: SsYearMode;
  status: string;
} {
  const {
    profile,
    fallbackBirthYear,
    fallbackBirthMonth,
    taxYear,
    setupBaseYear,
    yearsFromSetupBase,
    ssColaFactor,
    ssColaLabel,
    isLockedActuals,
    requestedMode,
    overrideAmount,
    track,
  } = params;

  // Explicit "Off": true $0 override, accrues no DRCs
  if (requestedMode === 'off') {
    track.wasSuspendedPriorYear = false;
    return { gross: 0, effectiveMode: 'off', status: 'Off' };
  }

  const parsedDob = parseBirthDate(profile?.birth_date);
  const birthYear = parsedDob?.year ?? fallbackBirthYear;
  const birthMonth = getPersonBirthMonth(profile, fallbackBirthMonth);
  const birthMonthShort = MONTH_SHORT_NAMES[birthMonth - 1];
  const fra = calculateFraInfo(profile?.birth_date);
  const fraYear = fra?.fraYear ?? birthYear + 67;
  const age70Year = birthYear + 70;
  const monthly = profile?.social_security.monthly_benefit ?? 0;
  const fullYearCola = monthly > 0 ? monthly * 12 * ssColaFactor : 0;

  // Explicit dollar override on an "On" cell (or locked actuals test override)
  if (
    requestedMode === 'on' &&
    typeof overrideAmount === 'number' &&
    Number.isFinite(overrideAmount)
  ) {
    track.wasSuspendedPriorYear = false;
    const drcPct = formatDrcPercent(track.suspendedMonths);
    return {
      gross: round0(Math.max(0, overrideAmount)),
      effectiveMode: 'on',
      status: isLockedActuals
        ? 'On'
        : track.suspendedMonths > 0
        ? `Override (+${drcPct}% DRC)`
        : 'Override',
    };
  }

  if (isLockedActuals) {
    track.wasSuspendedPriorYear = false;
    return { gross: 0, effectiveMode: 'off', status: 'Off' };
  }

  // Voluntary suspension ("Susp")
  if (requestedMode === 'suspended') {
    if (taxYear === age70Year) {
      // Suspend months before birth month, then auto-resume in birth month at Age 70
      // with all accrued DRCs (including this partial Age-70 year's pre-birth months).
      const preBirthSuspMonths = birthMonth - 1;
      track.suspendedMonths = Math.min(36, track.suspendedMonths + preBirthSuspMonths);
      track.wasSuspendedPriorYear = false;
      const drcMult = 1 + track.suspendedMonths * (0.08 / 12);
      const drcPctStr = formatDrcPercent(track.suspendedMonths);
      const paidMonths = 13 - birthMonth;
      const annualizedWithDrc = fullYearCola * drcMult;
      const gross = monthly > 0 ? round0(annualizedWithDrc * (paidMonths / 12)) : 0;
      return {
        gross,
        effectiveMode: 'suspended',
        status:
          monthly <= 0
            ? 'Benefit pending'
            : `${paidMonths} mos (+${drcPctStr}% DRC · Age 70)`,
      };
    }

    if (taxYear === fraYear) {
      // Partial year of benefits for the months BEFORE the birth month
      const paidMonths = birthMonth - 1;
      const suspMonthsThisYear = 13 - birthMonth;
      track.suspendedMonths = Math.min(36, track.suspendedMonths + suspMonthsThisYear);
      track.wasSuspendedPriorYear = true;
      const gross =
        monthly > 0 && paidMonths > 0 ? round0(fullYearCola * (paidMonths / 12)) : 0;
      const status =
        paidMonths > 0
          ? `${paidMonths} mos (Susp ${birthMonthShort})`
          : `Suspended (Susp ${birthMonthShort} · +8%/yr)`;
      return { gross, effectiveMode: 'suspended', status };
    }

    if (taxYear > fraYear && taxYear < age70Year) {
      // Full suspension year (FRA < year < age 70)
      track.suspendedMonths = Math.min(36, track.suspendedMonths + 12);
      track.wasSuspendedPriorYear = true;
      return { gross: 0, effectiveMode: 'suspended', status: 'Suspended (+8%/yr DRC)' };
    }

    if (taxYear < fraYear) {
      // Pre-FRA cannot accrue voluntary suspension DRCs
      track.wasSuspendedPriorYear = false;
      return { gross: 0, effectiveMode: 'suspended', status: 'Pre-FRA (No DRC)' };
    }

    // Years strictly after age 70: SSA does not allow voluntary suspension past age 70
  }

  // Full 12-month COLA-adjusted "On" year (never prorated; applies only DRCs accrued through Dec of prior year)
  const justResumed = track.wasSuspendedPriorYear && track.suspendedMonths > 0;
  track.wasSuspendedPriorYear = false;
  const drcMult = 1 + track.suspendedMonths * (0.08 / 12);
  const drcPctStr = formatDrcPercent(track.suspendedMonths);
  const gross = monthly > 0 ? round0(fullYearCola * drcMult) : 0;
  const status =
    monthly <= 0
      ? 'Benefit pending'
      : taxYear === age70Year && track.suspendedMonths > 0
      ? `Full yr (+${drcPctStr}% DRC)`
      : justResumed
      ? `Resumed (+${drcPctStr}% DRC)`
      : track.suspendedMonths > 0
      ? `+${drcPctStr}% DRC · +${ssColaLabel} COLA`
      : yearsFromSetupBase > 0
      ? `+${ssColaLabel} COLA`
      : `${setupBaseYear} Exact`;

  return { gross, effectiveMode: 'on', status };
}

/**
 * Runs the 4-layer deterministic annual calculation sequence (Module 3 §3)
 * across the entire 6-year rolling horizon purely from constant inputs,
 * carrying forward stock basis, AAA, and SS DRC credits.
 */
export function calculateSixYearPlan(
  setup: SetupConfig,
  years: TaxYearRecord[]
): ComputedTaxYear[] {
  const results: ComputedTaxYear[] = [];
  let runningStockBasis: number | null = null;
  let runningStateStockBasis: number | null = null;
  let runningAaa: number | null = null;
  const billSsTrack: SsTrackState = { suspendedMonths: 0, wasSuspendedPriorYear: false };
  const debraSsTrack: SsTrackState = { suspendedMonths: 0, wasSuspendedPriorYear: false };

  for (let i = 0; i < years.length; i++) {
    const yr = years[i];
    const scale = inflationFactor(yr.tax_year, setup.assumptions.inflation_rate);
    const primaryAge = getAgeInTaxYear(
      setup.primary_profile?.birth_date,
      yr.tax_year,
      setup.primary_birth_year
    );
    const spouseAge =
      setup.filing_status === 'married_filing_jointly'
        ? getAgeInTaxYear(
            setup.spouse_profile?.birth_date,
            yr.tax_year,
            setup.spouse_birth_year
          )
        : null;

    // ------------------------------------------------------------------
    // Pre-Layer 1: Per-Person Medicare & S-Corp >2% SEHI Premiums
    // (Depends only on Setup Medicare premiums, inflation, & prior-year lookback MAGI)
    // ------------------------------------------------------------------
    const scorpIn = yr.scorp_1120s;
    const dbpIn = yr.dbp_and_retirement;
    const f1040In = yr.form_1040;

    const setupBaseYear =
      setup.current_tax_year ?? (setup.forecast_years[1] ?? setup.anchor_actuals_year + 1);
    const yearsFromSetupBase = Math.max(0, yr.tax_year - setupBaseYear);

    const medInflationRate = setup.assumptions.medicare_inflation_rate ?? 0.055;
    const medInflationFactor = Math.pow(1 + medInflationRate, yearsFromSetupBase);

    const primaryMedicareEnrolled =
      !yr.is_locked_actuals && Boolean(setup.primary_profile?.medicare.enrolled);
    const spouseMedicareEnrolled =
      !yr.is_locked_actuals &&
      setup.filing_status === 'married_filing_jointly' &&
      Boolean(setup.spouse_profile?.medicare.enrolled);

    const primaryMedicareBaseAnnual =
      primaryMedicareEnrolled && setup.primary_profile
        ? round0(
            sumEnteredMedicareMonthly(setup.primary_profile.medicare) * 12 * medInflationFactor
          )
        : 0;
    const spouseMedicareBaseAnnual =
      spouseMedicareEnrolled && setup.spouse_profile
        ? round0(
            sumEnteredMedicareMonthly(setup.spouse_profile.medicare) * 12 * medInflationFactor
          )
        : 0;

    // Two-year lookback MAGI for IRMAA evaluation (known before AGI for all years after Year 1)
    const priorLookbackMagi =
      i >= 2
        ? results[i - 2].form_1040_out.adjusted_gross_income +
          years[i - 2].form_1040.tax_exempt_interest
        : i === 1
        ? results[0].form_1040_out.adjusted_gross_income +
          years[0].form_1040.tax_exempt_interest
        : null;

    const earlyIrmaaEval =
      priorLookbackMagi !== null
        ? computeIrmaaPerEnrollee(priorLookbackMagi, yr.tax_year, setup, scale)
        : null;
    const earlyIrmaaTotal = earlyIrmaaEval
      ? (primaryMedicareEnrolled ? earlyIrmaaEval.perEnrolleeSurcharge : 0) +
        (spouseMedicareEnrolled ? earlyIrmaaEval.perEnrolleeSurcharge : 0)
      : 0;

    // SEHI Medicare Premiums:
    // - Locked actuals (e.g., filed prior year): uses filed health_insurance_premiums independent of current Setup.
    // - Forecast years: Setup Medicare base premiums * medicare_inflation_rate + any applicable IRMAA surcharge,
    //   falling back to plan health_insurance_premiums if no Setup monthly Medicare premiums are entered;
    //   inline schedule overrides take precedence.
    const setupMedicareCombined = primaryMedicareBaseAnnual + spouseMedicareBaseAnnual;
    const hasSehiOverride =
      !yr.is_locked_actuals &&
      typeof f1040In.sehi_medicare_override === 'number' &&
      Number.isFinite(f1040In.sehi_medicare_override);
    const defaultSehiPremiums = yr.is_locked_actuals
      ? f1040In.health_insurance_premiums
      : setupMedicareCombined > 0
      ? setupMedicareCombined + earlyIrmaaTotal
      : f1040In.health_insurance_premiums;
    const sehiMedicarePremiumsEffective = hasSehiOverride
      ? round0(Math.max(0, f1040In.sehi_medicare_override!))
      : defaultSehiPremiums;
    const irmaaIncludedInSehi =
      !yr.is_locked_actuals &&
      !hasSehiOverride &&
      setupMedicareCombined > 0 &&
      earlyIrmaaTotal > 0;

    // IRS Notice 2008-1: S-Corp >2% shareholder health insurance (SEHI) is deducted by the S-Corp
    // (reducing Form 1120-S ordinary income / K-1 Box 1 and therefore Form 8995 QBI),
    // added to W-2 Box 1 taxable wages, EXCLUDED from W-2 Box 3/5 FICA wages & 401(k) eligible wages,
    // and deducted back out on Form 1040 Schedule 1 Line 17 (capped by Box 5 Medicare wages per Form 7206 Line 11).
    // When use_detailed_1120s_deductions is true (locked filed return), SEHI is already reflected in explicit filed lines.
    const scorpSehiDeduction =
      setup.has_scorp && !scorpIn.use_detailed_1120s_deductions
        ? sehiMedicarePremiumsEffective
        : 0;

    // ------------------------------------------------------------------
    // LAYER 1: Entity, Per-Person Cash W-2, Payroll & 401(k)/DBP Layer (1120-S)
    // ------------------------------------------------------------------
    // Cash FICA W-2 wages (W-2 Box 3 & Box 5) — strictly EXCLUDING S-Corp >2% SEHI add-back
    const billW2 = setup.has_scorp ? scorpIn.bill_w2_wages : f1040In.w2_wages_total;
    const debraW2 =
      setup.has_scorp && setup.filing_status === 'married_filing_jointly'
        ? scorpIn.debra_w2_wages
        : 0;
    const combinedOfficerW2 = setup.has_scorp ? billW2 + debraW2 : scorpIn.officer_w2_wages;

    const ssWageBase = round0(176100 * scale);

    // Personal (employee) FICA per person + Additional Medicare Tax (0.9% over $250k MFJ / $200k Single)
    const empFicaPrimary = computePersonFica(billW2, ssWageBase);
    const empFicaSpouse = computePersonFica(debraW2, ssWageBase);
    const addlMedThreshold =
      setup.filing_status === 'married_filing_jointly'
        ? 250000
        : setup.filing_status === 'married_filing_separately'
        ? 125000
        : 200000;
    const combinedW2ForFica = billW2 + debraW2;
    const addlMedicareTax =
      combinedW2ForFica > addlMedThreshold
        ? round0((combinedW2ForFica - addlMedThreshold) * 0.009)
        : 0;
    const personalFicaTax = round0(empFicaPrimary + empFicaSpouse + addlMedicareTax);

    // DBP termination & Post-DBP Employer 401(k) Profit Sharing Rate rule (IRC §404(a)(7)):
    // 6% combined-plan cap applies ONLY while DBP is active; once DBP is terminated (or inactive),
    // the statutory cap rises to 25% of cash W-2 wages (subject to IRS §415(c) limits).
    const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
    const isDbpTerminatedOrInactive =
      !setup.has_dbp ||
      dbpIn.dbp_status === 'terminated' ||
      (termYear !== null && yr.tax_year > termYear && dbpIn.dbp_status !== 'active');
    const activeEmployerPsRate = isDbpTerminatedOrInactive
      ? Math.min(0.25, Math.max(0, setup.post_dbp_profit_sharing_rate))
      : 0.06;

    const bill401k = computePerson401kLimits(
      billW2,
      primaryAge,
      ssWageBase,
      scale,
      activeEmployerPsRate,
      setup.has_401k_or_ira
    );
    const debra401k = computePerson401kLimits(
      debraW2,
      spouseAge,
      ssWageBase,
      scale,
      activeEmployerPsRate,
      setup.has_401k_or_ira && setup.filing_status === 'married_filing_jointly'
    );
    const employee401kTotal = bill401k.employeeDeferral + debra401k.employeeDeferral;

    const effectiveDbpDeduction =
      setup.has_dbp && dbpIn.dbp_status !== 'terminated'
        ? dbpIn.dbp_actual_contribution
        : 0;

    // If detailed 1120-S Pension/Profit-Sharing input is supplied, derive Employer 401(k) PS cleanly as (total pension - DBP)
    const employer401kTotal =
      scorpIn.use_detailed_1120s_deductions &&
      scorpIn.pension_profit_sharing_input !== undefined
        ? Math.max(0, round0(scorpIn.pension_profit_sharing_input - effectiveDbpDeduction))
        : setup.has_scorp
        ? debra401k.employerProfitSharing + bill401k.employerProfitSharing
        : 0;

    let employerPayrollTaxes = 0;
    let ordinaryIncome1120s = 0;
    const pteTaxPaidByState: Record<string, number> = {};
    let pteTaxPaidTotal = 0;
    const stockBasisBeginning: number = !setup.has_scorp
      ? 0
      : i === 0 || runningStockBasis === null
      ? scorpIn.stock_basis_beginning
      : runningStockBasis;
    const stateStockBasisBeginning: number = !setup.has_scorp
      ? 0
      : i === 0 || runningStateStockBasis === null
      ? scorpIn.stock_basis_beginning
      : runningStateStockBasis;
    const aaaBeginning: number = !setup.has_scorp
      ? 0
      : i === 0 || runningAaa === null
      ? scorpIn.aaa_balance_beginning
      : runningAaa;
    let stockBasisAdditions = 0;
    let stockBasisReductions = 0;
    let stockBasisEnding: number = stockBasisBeginning;
    let aaaEnding: number = aaaBeginning;
    let excessDistributionCapGain = 0;
    let stateExcessDistributionCapGain = 0;
    let reasonableCompRatio = 0;

    const hasSplitRev =
      typeof scorpIn.ca_revenue === 'number' &&
      Number.isFinite(scorpIn.ca_revenue) &&
      typeof scorpIn.az_revenue === 'number' &&
      Number.isFinite(scorpIn.az_revenue);
    const rawPrimaryRevenue = hasSplitRev ? Math.max(0, round0(scorpIn.ca_revenue)) : 0;
    const rawSecondaryRevenue = hasSplitRev ? Math.max(0, round0(scorpIn.az_revenue)) : 0;
    const effectiveGrossRevenue = hasSplitRev
      ? rawPrimaryRevenue + rawSecondaryRevenue
      : Math.max(0, round0(scorpIn.gross_receipts_revenue));

    const setupStates = getSetupStates(setup, yr);
    const resolvedSetupSplit = resolveStateApportionmentForYear(setup, yr.tax_year);
    const activeSplitSet = new Set(resolvedSetupSplit.activeStates);
    const hasExternalScenarioStateApportionment = yr.state_filings.some(
      (sf) => !activeSplitSet.has(sf.state_code) && sf.state_apportionment_factor > 0
    );
    const useSetupApportionment =
      !yr.is_locked_actuals &&
      Boolean(setup.state_revenue_apportionment) &&
      resolvedSetupSplit.activeStates.length > 0 &&
      !hasExternalScenarioStateApportionment;

    const rawTotalRevenue = rawPrimaryRevenue + rawSecondaryRevenue;
    const rawMatchesSetupSplit =
      hasSplitRev &&
      resolvedSetupSplit.hasSecondary &&
      rawTotalRevenue > 0 &&
      resolvedSetupSplit.primaryPct + resolvedSetupSplit.secondaryPct >= 99.95 &&
      Math.abs(
        Math.round((rawPrimaryRevenue / rawTotalRevenue) * 1000) / 10 -
          resolvedSetupSplit.primaryPct
      ) <= 0.05;

    const caRevenue = useSetupApportionment
      ? resolvedSetupSplit.hasSecondary
        ? rawMatchesSetupSplit
          ? rawPrimaryRevenue
          : round0(effectiveGrossRevenue * resolvedSetupSplit.primaryRatio)
        : effectiveGrossRevenue
      : rawPrimaryRevenue;
    const azRevenue = useSetupApportionment
      ? resolvedSetupSplit.hasSecondary
        ? rawMatchesSetupSplit
          ? rawSecondaryRevenue
          : Math.max(0, effectiveGrossRevenue - caRevenue)
        : 0
      : rawSecondaryRevenue;

    const livePrimaryApportionment =
      hasSplitRev && effectiveGrossRevenue > 0 ? caRevenue / effectiveGrossRevenue : null;
    const liveSecondaryApportionment =
      hasSplitRev && effectiveGrossRevenue > 0 ? azRevenue / effectiveGrossRevenue : null;

    const getEffectiveApportionment = (stateCode: string, fallback: number): number => {
      if (hasExternalScenarioStateApportionment) return fallback;
      if (useSetupApportionment) {
        if (rawMatchesSetupSplit) {
          if (stateCode === resolvedSetupSplit.primaryCode && livePrimaryApportionment !== null) {
            return livePrimaryApportionment;
          }
          if (
            stateCode === resolvedSetupSplit.secondaryCode &&
            liveSecondaryApportionment !== null
          ) {
            return liveSecondaryApportionment;
          }
        }
        if (Object.prototype.hasOwnProperty.call(resolvedSetupSplit.split, stateCode)) {
          return (resolvedSetupSplit.split[stateCode] ?? 0) / 100;
        }
        return fallback;
      }
      if (
        setupStates.primaryStateCode &&
        stateCode === setupStates.primaryStateCode &&
        livePrimaryApportionment !== null
      ) {
        return livePrimaryApportionment;
      }
      if (
        setupStates.secondaryStateCode &&
        stateCode === setupStates.secondaryStateCode &&
        liveSecondaryApportionment !== null
      ) {
        return liveSecondaryApportionment;
      }
      return fallback;
    };

    let effectiveOperatingExpenses = 0;
    let operatingExpensesIsScaled = false;
    let operatingExpensesIsOverridden = false;

    if (setup.has_scorp) {
      // Employer FICA computed per person (each person has their own SS wage base) + FUTA,
      // or explicit Form 1120-S payroll tax line item when detailed 1120-S inputs are configured
      const erFicaSpouse = computePersonFica(debraW2, ssWageBase);
      const erFicaPrimary = computePersonFica(billW2, ssWageBase);
      const futaCount = (debraW2 > 0 ? 1 : 0) + (billW2 > 0 ? 1 : 0);
      employerPayrollTaxes =
        scorpIn.payroll_taxes_input !== undefined
          ? round0(Math.max(0, scorpIn.payroll_taxes_input))
          : round0(erFicaSpouse + erFicaPrimary + futaCount * 420);

      let prePteOrdinaryIncome: number;
      if (scorpIn.use_detailed_1120s_deductions) {
        const officerComp = scorpIn.compensation_of_officers ?? 0;
        const salaries = scorpIn.salaries_and_wages ?? 0;
        const rents = scorpIn.rents ?? 0;
        const taxesAndLicenses =
          (scorpIn.payroll_taxes_input ?? employerPayrollTaxes) +
          (scorpIn.ftb_state_taxes_input ?? 0);
        const advertising = scorpIn.advertising ?? 0;
        const pensionPlans =
          scorpIn.pension_profit_sharing_input ??
          effectiveDbpDeduction + employer401kTotal;
        const otherDed = scorpIn.other_deductions ?? 0;

        effectiveOperatingExpenses = round0(
          rents + (scorpIn.ftb_state_taxes_input ?? 0) + advertising + otherDed
        );

        prePteOrdinaryIncome = round0(
          effectiveGrossRevenue -
            officerComp -
            salaries -
            rents -
            taxesAndLicenses -
            advertising -
            pensionPlans -
            otherDed
        );
      } else {
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
        const isUnlockedFutureForecastYear =
          !yr.is_locked_actuals && yr.tax_year > setupBaseYear;
        const hasManualOpexOverride =
          isUnlockedFutureForecastYear &&
          typeof scorpIn.operating_expenses_override === 'number' &&
          Number.isFinite(scorpIn.operating_expenses_override);

        if (hasManualOpexOverride) {
          effectiveOperatingExpenses = round0(
            Math.max(0, scorpIn.operating_expenses_override as number)
          );
          operatingExpensesIsOverridden = true;
        } else if (
          isUnlockedFutureForecastYear &&
          opexScalingMode === 'revenue_proportional'
        ) {
          effectiveOperatingExpenses = round0(
            Math.max(0, effectiveGrossRevenue) * clampedExpenseRatio
          );
          operatingExpensesIsScaled = true;
        } else {
          effectiveOperatingExpenses = round0(Math.max(0, scorpIn.operating_expenses));
        }

        prePteOrdinaryIncome = round0(
          effectiveGrossRevenue -
            effectiveOperatingExpenses -
            combinedOfficerW2 -
            scorpSehiDeduction -
            employerPayrollTaxes -
            effectiveDbpDeduction -
            employer401kTotal
        );
      }

      // Active state filings evaluated consistently across Layer 1 (entity PTE) and Layer 4 (state tax/credits)
      const activeStateFilingsForPte =
        setup.multi_state_active || resolvedSetupSplit.activeStates.length > 1
          ? yr.state_filings
          : yr.state_filings.slice(0, 1);

      // State PTE entity-level taxes (deductible on federal Form 1120-S when elected):
      // - Locked actuals (e.g., 2025 filed return): strictly require setup.has_pte, pte_election_active, and state_pte_elected.
      // - Unlocked projection years (2026-2030): compute whenever a jurisdiction's PTE election checkbox is enabled.
      const allowYearPte = yr.is_locked_actuals
        ? Boolean(setup.has_pte && scorpIn.pte_election_active)
        : true;
      if (allowYearPte && prePteOrdinaryIncome > 0) {
        for (const sf of activeStateFilingsForPte) {
          const rule = STATE_TAX_RULES[sf.state_code];
          if (sf.state_pte_elected && rule?.pteAvailable) {
            const effApp = getEffectiveApportionment(
              sf.state_code,
              sf.state_apportionment_factor
            );
            const apportioned = prePteOrdinaryIncome * effApp;
            const pteAmt = round0(Math.max(0, apportioned * rule.pteRate));
            pteTaxPaidByState[sf.state_code] = pteAmt;
            pteTaxPaidTotal += pteAmt;
          }
        }
      }

      ordinaryIncome1120s = round0(prePteOrdinaryIncome - pteTaxPaidTotal);

      // IRC §1367(a) / Form 7203 Stock Basis ordering:
      // 1. Beginning Stock Basis + Income items (K-1 Ordinary Profit + Schedule K Interest) + Capital Contributions
      // 2. Minus Shareholder Distributions -> Excess over available basis is Form 8949 Capital Gain
      // 3. Minus Nondeductible Expenses & Ordinary Losses (reducing remaining basis, not below $0)
      const capContrib = Math.max(0, scorpIn.capital_contributions || 0);
      const schedKInterest = Math.max(0, scorpIn.schedule_k_interest_income || 0);
      const nondeductibleExp = Math.max(0, scorpIn.schedule_k_nondeductible_expenses || 0);
      stockBasisAdditions = Math.max(0, ordinaryIncome1120s) + schedKInterest + capContrib;

      const basisBeforeDist = stockBasisBeginning + stockBasisAdditions;
      if (scorpIn.scorp_distributions_total > Math.max(0, basisBeforeDist)) {
        excessDistributionCapGain = round0(
          scorpIn.scorp_distributions_total - Math.max(0, basisBeforeDist)
        );
      }
      const basisAfterDist = Math.max(0, basisBeforeDist - scorpIn.scorp_distributions_total);
      const lossReduction = ordinaryIncome1120s < 0 ? Math.abs(ordinaryIncome1120s) : 0;
      stockBasisReductions =
        scorpIn.scorp_distributions_total + nondeductibleExp + lossReduction;
      stockBasisEnding = round0(
        Math.max(0, basisAfterDist - nondeductibleExp - lossReduction)
      );

      // State-conformity Form 7203 basis ordering (Treas. Reg. §1.1367-1(f)):
      // Because state entity PTE tax is nondeductible for state income tax purposes, state K-1 income
      // adds back PTE in Step 1 (before distributions in Step 2), while the nondeductible PTE expense
      // reduces basis in Step 3 (after distributions, floored at $0). This prevents double-counting
      // PTE in both excess distribution capital gain and the state AGI PTE add-back.
      const stateBasisAdditions = Math.max(0, prePteOrdinaryIncome) + schedKInterest + capContrib;
      const stateBasisBeforeDist = stateStockBasisBeginning + stateBasisAdditions;
      if (scorpIn.scorp_distributions_total > Math.max(0, stateBasisBeforeDist)) {
        stateExcessDistributionCapGain = round0(
          scorpIn.scorp_distributions_total - Math.max(0, stateBasisBeforeDist)
        );
      }
      const stateBasisAfterDist = Math.max(
        0,
        stateBasisBeforeDist - scorpIn.scorp_distributions_total
      );
      const stateLossReduction = prePteOrdinaryIncome < 0 ? Math.abs(prePteOrdinaryIncome) : 0;
      const stateStockBasisEnding = round0(
        Math.max(0, stateBasisAfterDist - nondeductibleExp - pteTaxPaidTotal - stateLossReduction)
      );

      // IRS Form 1120-S Schedule M-2 (Accumulated Adjustments Account):
      // Ending AAA = Beginning AAA + Ordinary Business Income (Line 22)
      //   + Schedule K Interest Income (Box 4) - 50% Nondeductible Meals (Sch M-1 / Box 16c)
      //   - Distributions (Box 16d)
      aaaEnding = round0(
        aaaBeginning +
          ordinaryIncome1120s +
          schedKInterest -
          nondeductibleExp -
          scorpIn.scorp_distributions_total
      );

      reasonableCompRatio = computeReasonableCompRatio(combinedOfficerW2, ordinaryIncome1120s);

      runningStockBasis = stockBasisEnding;
      runningStateStockBasis = stateStockBasisEnding;
      runningAaa = aaaEnding;
    }

    const scorpOut: SCorp1120SOutputs = {
      effective_operating_expenses: effectiveOperatingExpenses,
      operating_expenses_is_scaled: operatingExpensesIsScaled,
      operating_expenses_is_overridden: operatingExpensesIsOverridden,
      employer_payroll_taxes: employerPayrollTaxes,
      pte_tax_paid_by_state: pteTaxPaidByState,
      pte_tax_paid_total: pteTaxPaidTotal,
      ordinary_business_income_1120s: ordinaryIncome1120s,
      stock_basis_additions: stockBasisAdditions,
      stock_basis_reductions: stockBasisReductions,
      stock_basis_ending: stockBasisEnding,
      aaa_balance_ending: aaaEnding,
      excess_distribution_capital_gain: excessDistributionCapGain,
      reasonable_comp_ratio: reasonableCompRatio,
    };

    // ------------------------------------------------------------------
    // LAYER 2 & 3: Per-Person SS, SEHI Medicare, Retirement & Form 1040
    // ------------------------------------------------------------------
    const effectiveK1Ordinary =
      setup.has_scorp && scorpIn.auto_sync_k1
        ? ordinaryIncome1120s
        : f1040In.schedule_k1_ordinary_income;

    const effectiveGrossW2 =
      setup.has_scorp ? combinedOfficerW2 : f1040In.w2_wages_total;

    // Form 1040 Line 1a Taxable W-2 (Box 1):
    // Use explicit filed Box 1 W-2 if configured (e.g., locked prior-year filed return),
    // otherwise Cash W-2 minus pre-tax Employee 401(k) deferrals PLUS S-Corp >2% SEHI add-back
    // per IRS Notice 2008-1 (SEHI is deducted back out on Schedule 1 Line 17 so it nets to $0 on AGI).
    const taxableW2Box1 = f1040In.use_explicit_w2_box1
      ? f1040In.w2_wages_total
      : Math.max(0, effectiveGrossW2 - employee401kTotal + scorpSehiDeduction);

    const effectiveLtcg = f1040In.schedule_d_includes_excess_gain
      ? f1040In.long_term_capital_gain_loss
      : f1040In.long_term_capital_gain_loss + excessDistributionCapGain;
    const netCapitalGainLoss = Math.max(
      -3000,
      f1040In.short_term_capital_gain_loss + effectiveLtcg
    );

    const annuityTaxable = setup.has_annuity
      ? Math.max(f1040In.pensions_and_annuities_taxable, round0(dbpIn.annuity_payout_amount * 0.75))
      : f1040In.pensions_and_annuities_taxable;

    // Independent per-person Social Security schedules:
    // - Locked actuals year stays completely independent of current Setup changes (except explicit per-year test overrides).
    // - Current / Setup Tax Year applies exact Setup monthly inputs * 12 (0% COLA markup).
    // - Forecast years >= Current Tax Year + 1 compound by ss_cola_rate (default 2.6%).
    const ssColaRate = setup.assumptions.ss_cola_rate ?? 0.026;
    const ssColaFactor = Math.pow(1 + ssColaRate, yearsFromSetupBase);
    const ssColaLabel = `${Number((ssColaRate * 100).toFixed(1))}%`;

    // Primary Taxpayer Social Security schedule
    const billRequestedMode: SsYearMode = yr.is_locked_actuals
      ? f1040In.ss_bill_mode ?? 'off'
      : f1040In.ss_bill_mode ??
        defaultSsModeForYear(
          setup.primary_profile,
          setup.primary_birth_year,
          yr.tax_year,
          setupBaseYear,
          billSsTrack.wasSuspendedPriorYear
        );

    const billSsResult = computePersonSsYear({
      profile: setup.primary_profile,
      fallbackBirthYear: setup.primary_birth_year,
      fallbackBirthMonth: 1,
      taxYear: yr.tax_year,
      setupBaseYear,
      yearsFromSetupBase,
      ssColaFactor,
      ssColaLabel,
      isLockedActuals: yr.is_locked_actuals,
      requestedMode: billRequestedMode,
      overrideAmount: f1040In.ss_bill_override,
      track: billSsTrack,
    });
    const billSsMode = billSsResult.effectiveMode;
    const primarySsGross = billSsResult.gross;
    const primarySsStatus = billSsResult.status;

    // Spouse Social Security schedule (active when Married Filing Jointly)
    let debraSsMode: SsYearMode = 'off';
    let spouseSsGross = 0;
    let spouseSsStatus = setup.filing_status === 'married_filing_jointly' ? 'Off' : 'N/A';

    if (setup.filing_status === 'married_filing_jointly') {
      const spouseFallbackBirthYear = setup.spouse_birth_year ?? setup.primary_birth_year;
      const debraRequestedMode: SsYearMode = yr.is_locked_actuals
        ? f1040In.ss_debra_mode ?? 'off'
        : f1040In.ss_debra_mode ??
          defaultSsModeForYear(
            setup.spouse_profile,
            spouseFallbackBirthYear,
            yr.tax_year,
            setupBaseYear,
            debraSsTrack.wasSuspendedPriorYear
          );

      const debraSsResult = computePersonSsYear({
        profile: setup.spouse_profile,
        fallbackBirthYear: spouseFallbackBirthYear,
        fallbackBirthMonth: 1,
        taxYear: yr.tax_year,
        setupBaseYear,
        yearsFromSetupBase,
        ssColaFactor,
        ssColaLabel,
        isLockedActuals: yr.is_locked_actuals,
        requestedMode: debraRequestedMode,
        overrideAmount: f1040In.ss_debra_override,
        track: debraSsTrack,
      });
      debraSsMode = debraSsResult.effectiveMode;
      spouseSsGross = debraSsResult.gross;
      spouseSsStatus = debraSsResult.status;
    }

    const combinedIndividualSs = primarySsGross + spouseSsGross;
    const effectiveSsGross = combinedIndividualSs;

    const incomeBeforeSS =
      taxableW2Box1 +
      f1040In.taxable_interest +
      f1040In.ordinary_dividends +
      netCapitalGainLoss +
      f1040In.schedule_1_other_income +
      effectiveK1Ordinary +
      f1040In.schedule_k1_other_items +
      f1040In.ira_distributions_taxable +
      annuityTaxable;

    // Schedule 1 Line 17 SEHI Deduction (IRS Form 7206 Line 11 & IRC § 162(l)(5)):
    // Capped at combined W-2 Box 5 Medicare wages (cash W-2 wages before 401(k) elective deferrals,
    // strictly excluding the S-Corp >2% shareholder health insurance add-back).
    const billBox5MedicareWages = Math.max(0, billW2);
    const debraBox5MedicareWages =
      setup.filing_status === 'married_filing_jointly' ? Math.max(0, debraW2) : 0;
    const combinedBox5MedicareWages = round0(billBox5MedicareWages + debraBox5MedicareWages);

    let sehiMedicareDeduction = 0;
    if (setup.has_scorp && sehiMedicarePremiumsEffective > 0) {
      sehiMedicareDeduction = round0(
        Math.min(sehiMedicarePremiumsEffective, combinedBox5MedicareWages)
      );
    }

    // Schedule SE Self-Employment Tax & 1/2 SE Tax Deduction (Sole Prop / Single-Member LLC only):
    // Applies statutory 92.35% net earnings factor, 12.4% Social Security up to remaining wage base,
    // 2.9% Medicare, and 0.9% Additional Medicare above threshold, with 50% of base SE tax deductible on Sch 1.
    const solePropNetProfit =
      setup.entity_type === 'sole_prop' && !setup.has_scorp
        ? Math.max(0, f1040In.schedule_1_other_income)
        : 0;
    const seEarnings = round0(solePropNetProfit * 0.9235);
    const remSsBaseForSe = Math.max(0, ssWageBase - billW2);
    const seTaxBase =
      seEarnings >= 400
        ? round0(Math.min(seEarnings, remSsBaseForSe) * 0.124 + seEarnings * 0.029)
        : 0;
    const seAddlMedicare =
      seEarnings >= 400 && combinedW2ForFica + seEarnings > addlMedThreshold
        ? round0(
            (Math.max(0, combinedW2ForFica + seEarnings - addlMedThreshold) -
              Math.max(0, combinedW2ForFica - addlMedThreshold)) *
              0.009
          )
        : 0;
    const selfEmploymentTax = round0(seTaxBase + seAddlMedicare);
    const halfSeTaxDeduction = round0(seTaxBase * 0.5);

    const adjustmentsToIncome = round0(
      sehiMedicareDeduction + halfSeTaxDeduction + (f1040In.schedule_1_adjustments_input ?? 0)
    );

    // IRS Social Security Benefits Worksheet:
    // Provisional Income = Non-SS AGI + Tax-Exempt Interest + 50% of Gross Social Security
    const nonSsAgi = incomeBeforeSS - adjustmentsToIncome;
    const ssTaxable = computeSocialSecurityTaxable(
      effectiveSsGross,
      nonSsAgi + f1040In.tax_exempt_interest,
      setup.filing_status
    );

    const totalIncome = round0(incomeBeforeSS + ssTaxable);
    const agi = round0(Math.max(0, totalIncome - adjustmentsToIncome));
    const currentYearMagi = agi + f1040In.tax_exempt_interest;

    // Standard vs Custom Itemized Deduction
    const activeDedMethod = yr.is_locked_actuals
      ? f1040In.deduction_method
      : setup.deduction_method ?? f1040In.deduction_method;

    const baseStd = round0(BASE_STD_DEDUCTION_2025[setup.filing_status] * scale);
    const perSeniorAdd =
      setup.filing_status === 'married_filing_jointly'
        ? round0(1600 * scale)
        : round0(2000 * scale);
    const seniorCount =
      (primaryAge !== null && primaryAge >= 65 ? 1 : 0) +
      (spouseAge !== null && spouseAge >= 65 ? 1 : 0);
    const standardDeduction = baseStd + seniorCount * perSeniorAdd;

    const customItemized = yr.is_locked_actuals
      ? f1040In.itemized_deductions_input
      : Math.max(0, setup.custom_itemized_deduction ?? f1040In.itemized_deductions_input);

    const deductionAmount =
      activeDedMethod === 'itemized' ? customItemized : standardDeduction;

    // Schedule 1-A Enhanced Senior Deduction (statutory window: tax years 2025–2028; sunsets after 2028):
    // $6,000 per age-65+ spouse ($12,000 MFJ max), phasing out at 6% per spouse (12% combined MFJ)
    // between $150,000 and $250,000 MAGI ($75,000–$175,000 non-MFJ).
    const enhancedSeniorInEffect = yr.tax_year >= 2025 && yr.tax_year <= 2028;
    const enhancedSeniorMax = enhancedSeniorInEffect ? seniorCount * 6000 : 0;
    const seniorPhaseoutStart =
      setup.filing_status === 'married_filing_jointly' ? 150000 : 75000;
    const seniorMagiExcess = Math.max(0, currentYearMagi - seniorPhaseoutStart);
    const lostPerSenior =
      enhancedSeniorInEffect && seniorCount > 0
        ? Math.min(6000, round0(seniorMagiExcess * 0.06))
        : 0;
    const enhancedSeniorLost = lostPerSenior * seniorCount;
    const enhancedSeniorAllowed = enhancedSeniorInEffect
      ? Math.max(0, enhancedSeniorMax - enhancedSeniorLost)
      : 0;

    // Form 8995 QBI (Section 199A) Deduction (including net capital gain & qualified dividend reduction).
    // Note: effectiveK1Ordinary already deducts S-Corp >2% SEHI on Form 1120-S, so QBI excludes SEHI automatically.
    // Section 199A W-2 wage limit uses W-2 Box 1 + elective deferrals (Cash W-2 + SEHI add-back per Rev. Proc. 2019-11).
    const taxableBeforeQbi = Math.max(0, agi - deductionAmount - enhancedSeniorAllowed);
    let qbiDeduction = 0;
    const qualifiedBusinessProfit = setup.has_scorp
      ? effectiveK1Ordinary
      : setup.entity_type === 'sole_prop'
      ? Math.max(0, solePropNetProfit - halfSeTaxDeduction)
      : 0;
    if (qualifiedBusinessProfit > 0) {
      const qbiBase = round0(qualifiedBusinessProfit * 0.2);
      const netCapGainForQbi = Math.max(0, netCapitalGainLoss);
      const qbiCapTaxable = round0(
        Math.max(0, taxableBeforeQbi - netCapGainForQbi - f1040In.qualified_dividends) * 0.2
      );
      const qbiThreshold = BASE_QBI_THRESHOLD_2025[setup.filing_status];
      const scaledStart = qbiThreshold.start * scale;
      const w2Limit = setup.has_scorp
        ? round0((combinedOfficerW2 + scorpSehiDeduction) * 0.5)
        : 0;

      if (taxableBeforeQbi <= scaledStart) {
        qbiDeduction = Math.min(qbiBase, qbiCapTaxable);
      } else {
        const phaseFraction = Math.min(
          1,
          (taxableBeforeQbi - scaledStart) / (qbiThreshold.phaseoutRange * scale)
        );
        const limitedQbi = qbiBase - phaseFraction * Math.max(0, qbiBase - w2Limit);
        qbiDeduction = round0(Math.min(Math.max(0, limitedQbi), qbiCapTaxable));
      }
    }

    const taxableIncome = round0(Math.max(0, taxableBeforeQbi - qbiDeduction));

    // Split Ordinary vs Preferential (Qualified Dividends + Net Capital Gain)
    const preferentialIncome = Math.min(
      taxableIncome,
      Math.max(0, f1040In.qualified_dividends + Math.max(0, netCapitalGainLoss))
    );
    const ordinaryTaxableIncome = Math.max(0, taxableIncome - preferentialIncome);

    const ordinaryResult = computeProgressiveTax(
      ordinaryTaxableIncome,
      BASE_BRACKETS_2025[setup.filing_status],
      scale,
      true
    );

    // Preferential Capital Gains Tax stacked on top of ordinary taxable income
    const ltcgLimits = BASE_LTCG_2025[setup.filing_status];
    const zeroCap = round0(ltcgLimits.zeroUpTo * scale);
    const fifteenCap = round0(ltcgLimits.fifteenUpTo * scale);
    let prefTax = 0;
    if (preferentialIncome > 0) {
      const zeroRoom = Math.max(0, zeroCap - ordinaryTaxableIncome);
      const inZero = Math.min(preferentialIncome, zeroRoom);
      const afterZero = preferentialIncome - inZero;
      const fifteenRoom = Math.max(
        0,
        fifteenCap - Math.max(ordinaryTaxableIncome, zeroCap)
      );
      const inFifteen = Math.min(afterZero, fifteenRoom);
      const inTwenty = Math.max(0, afterZero - inFifteen);
      prefTax = round0(inFifteen * 0.15 + inTwenty * 0.2);
    }

    // Net Investment Income Tax (3.8% NIIT)
    const niitThreshold =
      setup.filing_status === 'married_filing_jointly'
        ? 250000
        : setup.filing_status === 'married_filing_separately'
        ? 125000
        : 200000;
    const netInvIncome = Math.max(
      0,
      f1040In.taxable_interest +
        f1040In.ordinary_dividends +
        Math.max(0, netCapitalGainLoss)
    );
    const niitTax =
      agi > niitThreshold
        ? round0(Math.min(netInvIncome, agi - niitThreshold) * 0.038)
        : 0;

    const federalIncomeTax = round0(ordinaryResult.tax + prefTax + niitTax + selfEmploymentTax);

    const isZeroFederalTax = taxableIncome <= 0 && federalIncomeTax <= 0;
    const effectiveTaxRate = agi > 0 ? round2((federalIncomeTax / agi) * 100) : 0;
    const marginalTaxRate = isZeroFederalTax ? 0 : round2(ordinaryResult.marginalRate * 100);

    // DBP Contribution + Profit Share Tax Reduction (estimated federal tax shield at marginal rate;
    // returns $0 whenever Taxable Income (Line 15) and Federal Tax are $0)
    const dbpAndPsTaxReduction = isZeroFederalTax
      ? 0
      : round0((effectiveDbpDeduction + employer401kTotal) * ordinaryResult.marginalRate);

    // Per-person Medicare & two-year lookback MAGI IRMAA evaluation
    const lookbackMagi = priorLookbackMagi ?? currentYearMagi;
    const irmaaEval = computeIrmaaPerEnrollee(lookbackMagi, yr.tax_year, setup, scale);
    const futureCoverageYear = yr.tax_year + 2;
    const futureThresholdResolved = resolveIrmaaThresholdForYear(futureCoverageYear, setup);
    const currentMagiExceedsCliff = currentYearMagi > futureThresholdResolved.effectiveThreshold;
    const primaryIrmaaSurcharge = primaryMedicareEnrolled ? irmaaEval.perEnrolleeSurcharge : 0;
    const spouseIrmaaSurcharge = spouseMedicareEnrolled ? irmaaEval.perEnrolleeSurcharge : 0;
    const totalIrmaaSurcharge = primaryIrmaaSurcharge + spouseIrmaaSurcharge;
    const irmaaTierLabel =
      !primaryMedicareEnrolled && !spouseMedicareEnrolled
        ? 'No Medicare enrollment selected'
        : irmaaEval.tier;

    const form1040Out: Form1040Outputs = {
      primary_ss_gross: primarySsGross,
      spouse_ss_gross: spouseSsGross,
      primary_ss_mode: billSsMode,
      spouse_ss_mode: debraSsMode,
      primary_ss_status: primarySsStatus,
      spouse_ss_status: spouseSsStatus,
      social_security_gross_effective: effectiveSsGross,
      social_security_taxable: ssTaxable,
      sehi_medicare_premiums_effective: sehiMedicarePremiumsEffective,
      sehi_medicare_deduction: sehiMedicareDeduction,
      enhanced_senior_deduction_allowed: enhancedSeniorAllowed,
      enhanced_senior_deduction_max: enhancedSeniorMax,
      enhanced_senior_deduction_lost: enhancedSeniorLost,
      employee_401k_debra: debra401k.employeeDeferral,
      employee_401k_bill: bill401k.employeeDeferral,
      employee_401k_total: employee401kTotal,
      employer_401k_debra: debra401k.employerProfitSharing,
      employer_401k_bill: bill401k.employerProfitSharing,
      employer_401k_total: employer401kTotal,
      employer_401k_rate_applied: activeEmployerPsRate,
      dbp_and_ps_tax_reduction: dbpAndPsTaxReduction,
      personal_fica_tax: personalFicaTax,
      total_income: totalIncome,
      adjustments_to_income: adjustmentsToIncome,
      adjusted_gross_income: agi,
      deduction_amount: deductionAmount,
      qualified_business_income_deduction: qbiDeduction,
      taxable_income: taxableIncome,
      ordinary_taxable_income: ordinaryTaxableIncome,
      preferential_income: preferentialIncome,
      next_bracket_headroom: ordinaryResult.nextBracketHeadroom,
      next_bracket_rate: ordinaryResult.nextBracketRate,
      federal_income_tax: federalIncomeTax,
      niit_tax: niitTax,
      marginal_tax_rate: marginalTaxRate,
      effective_tax_rate: effectiveTaxRate,
      irmaa_coverage_year: yr.tax_year,
      irmaa_lookback_year: yr.tax_year - 2,
      irmaa_lookback_magi: lookbackMagi,
      irmaa_tier1_threshold: irmaaEval.tier1Threshold,
      irmaa_formula_tier1_threshold: irmaaEval.formulaTier1Threshold,
      irmaa_is_overridden: irmaaEval.isOverridden,
      irmaa_future_coverage_year: futureCoverageYear,
      irmaa_future_tier1_threshold: futureThresholdResolved.effectiveThreshold,
      irmaa_current_magi_exceeds_cliff: currentMagiExceedsCliff,
      irmaa_tier: irmaaTierLabel,
      primary_irmaa_surcharge: primaryIrmaaSurcharge,
      spouse_irmaa_surcharge: spouseIrmaaSurcharge,
      irmaa_annual_surcharge: totalIrmaaSurcharge,
      primary_medicare_base_annual: primaryMedicareBaseAnnual,
      spouse_medicare_base_annual: spouseMedicareBaseAnnual,
    };

    // ------------------------------------------------------------------
    // LAYER 4: Multi-State & Residency Layer
    // ------------------------------------------------------------------
    const stateOutputs: StateFilingOutputs[] = [];
    const activeStateFilings =
      setup.multi_state_active || resolvedSetupSplit.activeStates.length > 1
        ? yr.state_filings
        : yr.state_filings.slice(0, 1);

    const filerCount = setup.filing_status === 'married_filing_jointly' ? 2 : 1;

    const preliminary = activeStateFilings.map((sf) => {
      const rule = STATE_TAX_RULES[sf.state_code] ?? {
        code: sf.state_code,
        name: getStateFullName(sf.state_code),
        mode: 'flat' as const,
        flatRate: 0.045,
        stdDeduction: 15000,
        pteAvailable: false,
        pteRate: 0,
        scorpMinTax: 0,
        scorpEntityRate: 0,
      };

      const effApportionment = getEffectiveApportionment(
        sf.state_code,
        sf.state_apportionment_factor
      );
      const syncedSf = {
        ...sf,
        state_apportionment_factor: effApportionment,
      };

      const conformityAdj = sf.state_conformity_adjustment ?? 0;
      // Add back entity-level state PTE taxes deducted on federal Form 1120-S when computing
      // state taxable income (state income taxes are not deductible against state tax),
      // adjusted for any Treas. Reg. §1.1367-1(f) difference between federal and state excess
      // distribution capital gain so PTE is never double-counted when stock basis is exhausted.
      const stateEffectiveLtcg = f1040In.schedule_d_includes_excess_gain
        ? f1040In.long_term_capital_gain_loss
        : f1040In.long_term_capital_gain_loss + stateExcessDistributionCapGain;
      const stateNetCapitalGainLoss = Math.max(
        -3000,
        f1040In.short_term_capital_gain_loss + stateEffectiveLtcg
      );
      const pteStateAgiAddBack =
        pteTaxPaidTotal > 0
          ? Math.max(0, pteTaxPaidTotal + (stateNetCapitalGainLoss - netCapitalGainLoss))
          : 0;
      const stateAgiBaseForTax = agi + pteStateAgiAddBack;
      const stateK1ForTax = effectiveK1Ordinary + pteTaxPaidTotal;
      const stateBaseAgi = Math.max(
        0,
        (rule.exemptsSocialSecurity
          ? Math.max(0, stateAgiBaseForTax - ssTaxable)
          : stateAgiBaseForTax) + conformityAdj
      );

      let stateAllocatedIncome = 0;
      if (rule.mode === 'none') {
        stateAllocatedIncome = 0;
      } else if (sf.residency_status === 'resident') {
        // Full-year resident: taxed on worldwide non-SS income
        stateAllocatedIncome = stateBaseAgi;
      } else if (sf.residency_status === 'part_year_resident') {
        // Part-year resident: taxed on worldwide non-SS income earned during resident days
        // PLUS state-sourced S-Corp K-1 income during nonresident days
        const dayRatio =
          sf.residency_day_or_income_ratio > 0
            ? Math.min(1, sf.residency_day_or_income_ratio)
            : 0.5;
        const residentPeriodIncome = stateBaseAgi * dayRatio;
        const nonresidentPeriodSourcedK1 =
          setup.has_scorp && stateK1ForTax > 0
            ? stateK1ForTax * (1 - dayRatio) * effApportionment
            : 0;
        stateAllocatedIncome = round0(
          Math.min(stateBaseAgi, residentPeriodIncome + nonresidentPeriodSourcedK1)
        );
      } else {
        // Non-resident: applies ONLY to state-sourced S-Corp K-1 income (apportioned by state revenue %),
        // NOT worldwide income or W-2 wages earned while living in another state.
        stateAllocatedIncome = setup.has_scorp
          ? round0(Math.max(0, stateK1ForTax) * effApportionment)
          : 0;
      }

      const allocRatio =
        stateBaseAgi > 0 ? Math.min(1, stateAllocatedIncome / stateBaseAgi) : 0;

      const proratedStd =
        rule.mode === 'none'
          ? 0
          : sf.residency_status === 'resident'
          ? round0(rule.stdDeduction * scale)
          : round0(rule.stdDeduction * scale * allocRatio);
      const stateTaxable = round0(Math.max(0, stateAllocatedIncome - proratedStd));

      let rawPersonalTax = 0;
      if (rule.mode === 'flat' && rule.flatRate) {
        rawPersonalTax = round0(stateTaxable * rule.flatRate);
      } else if (rule.mode === 'progressive' && rule.brackets) {
        rawPersonalTax = computeProgressiveTax(stateTaxable, rule.brackets, scale).tax;
      }

      // Apply state personal & senior exemption credits (full for resident; prorated for part-year/non-resident)
      const fullExemptionCredits = round0(
        ((rule.personalExemptionCredit ?? 0) * filerCount +
          (rule.seniorExemptionCredit ?? 0) * seniorCount) *
          scale
      );
      const exemptionCredits =
        rule.mode === 'none'
          ? 0
          : sf.residency_status === 'resident'
          ? fullExemptionCredits
          : round0(fullExemptionCredits * allocRatio);
      const personalTaxAfterExemption = Math.max(0, rawPersonalTax - exemptionCredits);

      const ptePaid = pteTaxPaidByState[sf.state_code] ?? 0;

      // S-Corp Entity Business Tax:
      // CA Form 100S = max($800, 1.5% * CA-apportioned S-Corp net income)
      // AZ Form 120S = $0 unless PTE elected (PTE tracked separately in state_pte_payment_amount)
      const entityStateTax = setup.has_scorp
        ? rule.scorpMinTax > 0 || rule.scorpEntityRate > 0
          ? Math.max(
              rule.scorpMinTax,
              round0(
                Math.max(0, ordinaryIncome1120s) *
                  effApportionment *
                  rule.scorpEntityRate
              )
            )
          : 0
        : 0;

      return {
        sf: syncedSf,
        rule,
        stateBaseAgi,
        stateAllocatedIncome,
        stateTaxable,
        rawPersonalTax: personalTaxAfterExemption,
        ptePaid,
        entityStateTax,
      };
    });

    // Statutory Reverse-Credit Pair check (CA + AZ statutory rule):
    // - Full-Year CA Resident + AZ Non-Resident: AZ Form 309 grants credit on AZ 140NR for 100% of AZ-sourced income double-taxed by CA
    // - Part-Year CA Resident + AZ Non-Resident: AZ Form 309 credit applies ONLY to the CA-resident period fraction (residency_day_or_income_ratio)
    // - Non-CA Resident + AZ Non-Resident: no CA resident credit; AZ 140NR tax applies in full
    const caResident = preliminary.find(
      (p) => p.sf.state_code === 'CA' && p.sf.residency_status === 'resident'
    );
    const caPartYear = preliminary.find(
      (p) => p.sf.state_code === 'CA' && p.sf.residency_status === 'part_year_resident'
    );
    const caOverlapForAz = caResident ?? caPartYear;

    const standardNonResidentTaxTotal = preliminary
      .filter((p) => {
        if (p.sf.residency_status !== 'non_resident') return false;
        // Reverse-credit AZ non-resident takes credit on AZ return, not CA return
        if (p.sf.state_code === 'AZ' && caOverlapForAz) return false;
        return true;
      })
      .reduce((acc, p) => acc + p.rawPersonalTax, 0);

    for (const item of preliminary) {
      let ostcLimitation = 0;
      let ostcClaimed = 0;

      if (
        item.sf.state_code === 'AZ' &&
        item.sf.residency_status === 'non_resident' &&
        caOverlapForAz
      ) {
        // AZ Form 309 Reverse Credit for CA residents (full year in 2025; part-year CA-resident fraction only in 2026):
        const overlapFraction =
          caOverlapForAz.sf.residency_status === 'resident'
            ? 1.0
            : Math.min(1, Math.max(0, caOverlapForAz.sf.residency_day_or_income_ratio));
        const doubleTaxedAzIncome = round0(item.stateAllocatedIncome * overlapFraction);
        const azTaxOnDoubleTaxed = round0(item.rawPersonalTax * overlapFraction);
        const caShareForAz =
          caOverlapForAz.stateAllocatedIncome > 0
            ? round0(
                caOverlapForAz.rawPersonalTax *
                  Math.min(1, doubleTaxedAzIncome / caOverlapForAz.stateAllocatedIncome)
              )
            : 0;
        ostcLimitation = Math.min(azTaxOnDoubleTaxed, caShareForAz);
        ostcClaimed = ostcLimitation;
      } else if (item.sf.residency_status === 'resident' && standardNonResidentTaxTotal > 0) {
        const nonResRatio = preliminary
          .filter(
            (p) =>
              p.sf.residency_status === 'non_resident' &&
              !(p.sf.state_code === 'AZ' && caOverlapForAz)
          )
          .reduce((acc, p) => acc + p.sf.state_apportionment_factor, 0);
        ostcLimitation = round0(item.rawPersonalTax * Math.min(1, nonResRatio));
        ostcClaimed = Math.min(standardNonResidentTaxTotal, ostcLimitation);
      }

      // Statutory credit ordering (prevents OSTC + PTE credit double-counting):
      // 1) Apply Other-State Tax Credit (OSTC) and other state credits against pre-credit personal tax
      // 2) Apply full entity PTE tax credit against personal state tax — allowing Net Personal State Tax
      //    to go negative (refundable excess credit for AZ / tracked carryforward credit for CA) so
      //    Total State Tax (Net Personal + Entity PTE Paid + Non-PTE Entity Tax) remains state-tax neutral
      //    while capturing the federal Form 1120-S SALT-cap workaround savings.
      const taxAfterOstc = Math.max(
        0,
        item.rawPersonalTax - ostcClaimed - item.sf.other_state_credits_claimed
      );
      const effectivePteCredit = item.ptePaid;
      const finalPersonalStateTax = round0(taxAfterOstc - effectivePteCredit);

      // Total jurisdiction state tax = Net Personal State Tax (after OSTC & full PTE credit)
      //   + Non-PTE Business Entity Tax (e.g., CA Form 100S) + Entity PTE Paid
      const totalStateLiability = round0(
        finalPersonalStateTax + item.entityStateTax + item.ptePaid
      );
      const netDueOrRefund = round0(
        totalStateLiability - item.sf.state_tax_withholding_and_estimates
      );

      stateOutputs.push({
        ...item.sf,
        state_apportioned_income: item.stateAllocatedIncome,
        state_taxable_income: item.stateTaxable,
        state_personal_tax_liability: finalPersonalStateTax,
        state_entity_tax_liability: item.entityStateTax,
        state_income_tax_liability: totalStateLiability,
        state_pte_payment_amount: item.ptePaid,
        state_pte_credit_or_exclusion_amount: effectivePteCredit,
        credit_for_taxes_paid_to_other_states: ostcClaimed,
        other_state_tax_credit_limitation: ostcLimitation,
        state_net_tax_due_or_refund: netDueOrRefund,
      });
    }

    const totalPersonalStateTax = stateOutputs.reduce(
      (sum, s) => sum + s.state_personal_tax_liability,
      0
    );
    // Total state tax combines personal + entity business/PTE taxes per state (matching Group 5 CA & AZ State Tax rows)
    const totalStateTax = stateOutputs.reduce(
      (sum, s) => sum + s.state_income_tax_liability,
      0
    );
    // Employer payroll taxes tracked separately to avoid double-counting entity state / PTE taxes already inside totalStateTax
    const totalEntityAndPayrollTax = round0(employerPayrollTaxes);
    const totalAllInTax = round0(
      federalIncomeTax + totalStateTax + totalEntityAndPayrollTax
    );
    // All-In Effective Rate denominator uses Total Gross Cash Income
    // (Gross W-2 + Gross Social Security + max(0, S-Corp K-1 Profit) + Interest/Dividends)
    const totalGrossCashIncome = round0(
      effectiveGrossW2 +
        effectiveSsGross +
        Math.max(0, effectiveK1Ordinary) +
        f1040In.taxable_interest +
        f1040In.tax_exempt_interest +
        f1040In.ordinary_dividends
    );
    const allInEffectiveRate =
      totalGrossCashIncome > 0
        ? round2((totalAllInTax / totalGrossCashIncome) * 100)
        : 0;

    // Net household cash flow (personal taxes paid by household; entity 100S / PTE paid by S-Corp)
    const cashInflows =
      effectiveGrossW2 +
      (setup.has_scorp ? scorpIn.scorp_distributions_total : 0) +
      f1040In.taxable_interest +
      f1040In.tax_exempt_interest +
      f1040In.ordinary_dividends +
      f1040In.ira_distributions_gross +
      f1040In.pensions_and_annuities_gross +
      effectiveSsGross;

    const estimatedNetCashFlow = round0(
      cashInflows -
        (setup.has_scorp ? Math.max(0, scorpIn.capital_contributions || 0) : 0) -
        federalIncomeTax -
        totalPersonalStateTax -
        personalFicaTax -
        sehiMedicarePremiumsEffective -
        (irmaaIncludedInSehi ? 0 : totalIrmaaSurcharge) -
        employee401kTotal
    );

    const syncedBreakdown = useSetupApportionment
      ? resolvedSetupSplit.activeStates.map((code) => ({
          state_code: code,
          apportionment_percent: rawMatchesSetupSplit
            ? Number((getEffectiveApportionment(code, 0) * 100).toFixed(2))
            : resolvedSetupSplit.split[code] ?? 0,
        }))
      : scorpIn.state_sourcing_breakdown.map((b) => {
          const eff = getEffectiveApportionment(b.state_code, b.apportionment_percent / 100);
          return {
            ...b,
            apportionment_percent: Number((eff * 100).toFixed(2)),
          };
        });

    results.push({
      tax_year: yr.tax_year,
      record_mode: yr.record_mode,
      is_locked_actuals: yr.is_locked_actuals,
      primary_age: primaryAge,
      spouse_age: spouseAge,
      form_1040_in: {
        ...f1040In,
        w2_wages_total: taxableW2Box1,
        schedule_k1_ordinary_income: effectiveK1Ordinary,
        social_security_gross: effectiveSsGross,
        deduction_method: activeDedMethod,
      },
      form_1040_out: form1040Out,
      scorp_in: {
        ...scorpIn,
        ca_revenue: caRevenue,
        az_revenue: azRevenue,
        gross_receipts_revenue: effectiveGrossRevenue,
        state_sourcing_breakdown: syncedBreakdown,
        debra_w2_wages: debraW2,
        bill_w2_wages: billW2,
        officer_w2_wages: combinedOfficerW2,
        stock_basis_beginning: stockBasisBeginning,
        aaa_balance_beginning: aaaBeginning,
      },
      scorp_out: scorpOut,
      dbp_in: dbpIn,
      state_filings_out: stateOutputs,
      total_state_tax: totalStateTax,
      total_entity_and_payroll_tax: totalEntityAndPayrollTax,
      total_all_in_tax: totalAllInTax,
      total_gross_cash_income: totalGrossCashIncome,
      all_in_effective_rate: allInEffectiveRate,
      estimated_net_cash_flow: estimatedNetCashFlow,
    });
  }

  return results;
}
