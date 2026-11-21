import type { PersonMedicareConfig, PersonProfile, PersonSocialSecurityConfig } from '../types/tax';

export interface ParsedDob {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export interface FraInfo {
  years: number;
  months: number;
  fraDate: string; // YYYY-MM-DD
  fraYear: number;
  label: string; // e.g., "67 yrs" or "66 yrs 10 mos"
}

export function parseBirthDate(dob: string | null | undefined): ParsedDob | null {
  if (!dob || typeof dob !== 'string') return null;
  const trimmed = dob.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

/**
 * IRS tax-year age: age attained by December 31 of the tax year.
 */
export function getAgeInTaxYear(
  dob: string | null | undefined,
  taxYear: number,
  fallbackBirthYear?: number | null
): number | null {
  const parsed = parseBirthDate(dob);
  if (parsed) {
    return taxYear - parsed.year;
  }
  if (typeof fallbackBirthYear === 'number' && Number.isFinite(fallbackBirthYear)) {
    return taxYear - fallbackBirthYear;
  }
  return null;
}

/**
 * Official SSA Full Retirement Age (FRA) calculation from Date of Birth.
 */
export function calculateFraInfo(dob: string | null | undefined): FraInfo | null {
  const parsed = parseBirthDate(dob);
  if (!parsed) return null;

  let years = 67;
  let months = 0;

  if (parsed.year <= 1937) {
    years = 65;
    months = 0;
  } else if (parsed.year <= 1942) {
    years = 65;
    months = (parsed.year - 1937) * 2;
  } else if (parsed.year <= 1954) {
    years = 66;
    months = 0;
  } else if (parsed.year <= 1959) {
    years = 66;
    months = (parsed.year - 1954) * 2;
  } else {
    years = 67;
    months = 0;
  }

  const totalMonths = parsed.month - 1 + months;
  const fraYear = parsed.year + years + Math.floor(totalMonths / 12);
  const fraMonth = (totalMonths % 12) + 1;
  const maxDayInMonth = new Date(Date.UTC(fraYear, fraMonth, 0)).getUTCDate();
  const fraDay = Math.min(parsed.day, maxDayInMonth);

  const mm = String(fraMonth).padStart(2, '0');
  const dd = String(fraDay).padStart(2, '0');
  const fraDate = `${fraYear}-${mm}-${dd}`;
  const label = months > 0 ? `${years} yrs ${months} mos` : `${years} yrs`;

  return { years, months, fraDate, fraYear, label };
}

export function formatReadableDate(isoDate: string): string {
  const parsed = parseBirthDate(isoDate);
  if (!parsed) return isoDate;
  const dt = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface IndividualSocialSecurityYearResult {
  annualGross: number;
  status: string;
  drcMultiplier: number;
}

/**
 * Computes one individual's annual gross Social Security benefit for a given taxYear,
 * respecting independent claiming, voluntary suspension (FRA to age 70), and +8%/yr DRC credits.
 */
export function computeIndividualSocialSecurityForYear(
  profile: PersonProfile,
  taxYear: number,
  anchorYear: number,
  inflationRate: number
): IndividualSocialSecurityYearResult {
  const ss: PersonSocialSecurityConfig = profile.social_security;
  if (!ss.receiving) {
    return { annualGross: 0, status: 'Not receiving', drcMultiplier: 1 };
  }

  const monthly = ss.monthly_benefit;
  if (monthly === null || !Number.isFinite(monthly) || monthly <= 0) {
    return { annualGross: 0, status: 'Benefit amount pending', drcMultiplier: 1 };
  }

  const baseAnnual = monthly * 12;
  const yearsFromAnchor = Math.max(0, taxYear - anchorYear);
  const colaFactor = Math.pow(1 + inflationRate, yearsFromAnchor);

  if (!ss.suspend_fra_to_70) {
    return {
      annualGross: Math.round(baseAnnual * colaFactor),
      status: 'Active claiming',
      drcMultiplier: 1,
    };
  }

  const parsedDob = parseBirthDate(profile.birth_date);
  const fra = calculateFraInfo(profile.birth_date);
  const resumeAge = Math.min(70, Math.max(68, ss.resume_age || 70));

  const effectiveSuspendStart =
    ss.suspend_start_year ?? (fra ? fra.fraYear : anchorYear + 1);
  const effectiveResumeYear = parsedDob
    ? parsedDob.year + resumeAge
    : effectiveSuspendStart + Math.max(1, resumeAge - 67);

  if (taxYear < effectiveSuspendStart) {
    return {
      annualGross: Math.round(baseAnnual * colaFactor),
      status: 'Active (pre-suspension)',
      drcMultiplier: 1,
    };
  }

  if (taxYear < effectiveResumeYear) {
    return {
      annualGross: 0,
      status: `Suspended (accruing +8%/yr until ${effectiveResumeYear})`,
      drcMultiplier: 1,
    };
  }

  const suspendedYears = Math.max(0, effectiveResumeYear - effectiveSuspendStart);
  const drcMultiplier = 1 + suspendedYears * 0.08;
  return {
    annualGross: Math.round(baseAnnual * colaFactor * drcMultiplier),
    status: `Resumed (+${Math.round(suspendedYears * 8)}% DRC)`,
    drcMultiplier,
  };
}

export function sumEnteredMedicareMonthly(med: PersonMedicareConfig): number {
  if (!med.enrolled) return 0;
  return (
    (med.part_a_monthly ?? 0) +
    (med.part_b_monthly ?? 0) +
    (med.part_d_monthly ?? 0) +
    (med.medigap_plan_g_monthly ?? 0)
  );
}

export function createDefaultPersonProfile(birthDate: string): PersonProfile {
  return {
    birth_date: birthDate,
    social_security: {
      receiving: false,
      monthly_benefit: null,
      suspend_fra_to_70: false,
      suspend_start_year: null,
      resume_age: 70,
    },
    medicare: {
      enrolled: false,
      part_a_monthly: null,
      part_b_monthly: null,
      part_d_monthly: null,
      medigap_plan_g_monthly: null,
    },
  };
}
