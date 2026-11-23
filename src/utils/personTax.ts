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

export const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const MONTH_LONG_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function getPersonBirthMonth(
  profile: PersonProfile | undefined,
  fallbackMonth = 1
): number {
  if (
    typeof profile?.birth_month === 'number' &&
    Number.isFinite(profile.birth_month) &&
    profile.birth_month >= 1 &&
    profile.birth_month <= 12
  ) {
    return Math.round(profile.birth_month);
  }
  const parsed = parseBirthDate(profile?.birth_date);
  if (parsed) {
    return parsed.month;
  }
  return Math.min(12, Math.max(1, Math.round(fallbackMonth)));
}

export function updateProfileBirthMonth(
  profile: PersonProfile,
  birthMonth: number,
  fallbackYear = 1970
): PersonProfile {
  const safeMonth = Math.min(12, Math.max(1, Math.round(birthMonth)));
  const parsed = parseBirthDate(profile.birth_date);
  const year = parsed?.year ?? fallbackYear;
  const maxDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const day = Math.min(parsed?.day ?? 1, maxDay);
  const nextBirthDate = `${year}-${String(safeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    ...profile,
    birth_date: nextBirthDate,
    birth_month: safeMonth,
  };
}

export function formatDrcPercent(suspendedMonths: number): string {
  const pct = (Math.max(0, suspendedMonths) * 2) / 3;
  if (Math.abs(pct - Math.round(pct)) < 0.05) {
    return String(Math.round(pct));
  }
  return pct.toFixed(1);
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
  const birthMonth = getPersonBirthMonth(profile, 5);
  const birthMonthShort = MONTH_SHORT_NAMES[birthMonth - 1];
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

  if (taxYear === effectiveSuspendStart && fra && taxYear === fra.fraYear) {
    const paidMonths = birthMonth - 1;
    return {
      annualGross: paidMonths > 0 ? Math.round(baseAnnual * colaFactor * (paidMonths / 12)) : 0,
      status:
        paidMonths > 0
          ? `${paidMonths} mos (Susp ${birthMonthShort})`
          : `Suspended (Susp ${birthMonthShort} · +8%/yr)`,
      drcMultiplier: 1,
    };
  }

  if (taxYear < effectiveResumeYear) {
    return {
      annualGross: 0,
      status: 'Suspended (+8%/yr DRC)',
      drcMultiplier: 1,
    };
  }

  const fullYearsBetween = Math.max(0, effectiveResumeYear - effectiveSuspendStart);
  const suspendedMonths = Math.min(36, fullYearsBetween * 12);
  const drcMultiplier = 1 + suspendedMonths * (0.08 / 12);
  const drcPctStr = formatDrcPercent(suspendedMonths);

  if (taxYear === effectiveResumeYear && resumeAge === 70) {
    const paidMonths = 13 - birthMonth;
    return {
      annualGross: Math.round(baseAnnual * colaFactor * drcMultiplier * (paidMonths / 12)),
      status: `${paidMonths} mos (+${drcPctStr}% DRC · Age 70)`,
      drcMultiplier,
    };
  }

  return {
    annualGross: Math.round(baseAnnual * colaFactor * drcMultiplier),
    status: `Resumed (+${drcPctStr}% DRC)`,
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
  const parsed = parseBirthDate(birthDate);
  return {
    birth_date: birthDate,
    birth_month: parsed?.month,
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
