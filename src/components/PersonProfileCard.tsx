import React from 'react';
import type { PersonMedicareConfig, PersonProfile, PersonSocialSecurityConfig } from '../types/tax';
import {
  MONTH_LONG_NAMES,
  MONTH_SHORT_NAMES,
  calculateFraInfo,
  formatReadableDate,
  getAgeInTaxYear,
  getPersonBirthMonth,
  parseBirthDate,
  sumEnteredMedicareMonthly,
  updateProfileBirthMonth,
} from '../utils/personTax';
import { formatCurrency } from '../utils/format';

interface PersonProfileCardProps {
  roleLabel: 'Primary Taxpayer' | 'Spouse';
  name: string;
  profile: PersonProfile;
  forecastYears: number[];
  currentTaxYear: number;
  showSsMedicare?: boolean;
  onNameChange: (nextName: string) => void;
  onChange: (next: PersonProfile) => void;
}

interface OptionalDollarInputProps {
  label: string;
  value: number | null;
  placeholder?: string;
  onChange: (val: number | null) => void;
}

const OptionalDollarInput: React.FC<OptionalDollarInputProps> = ({
  label,
  value,
  placeholder = 'Blank if unknown',
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <div className="flex items-center border border-slate-300 rounded-md bg-white focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700/20">
        <span className="pl-2.5 pr-1 text-xs font-mono text-slate-400 select-none">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value === null ? '' : value}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            if (!Number.isNaN(parsed) && parsed >= 0) {
              onChange(parsed);
            }
          }}
          className="w-full py-1.5 pr-2.5 text-sm font-mono tabular-nums bg-transparent outline-none text-slate-900 placeholder:text-slate-400 placeholder:font-sans placeholder:text-xs"
        />
      </div>
    </div>
  );
};

export const PersonProfileCard: React.FC<PersonProfileCardProps> = ({
  roleLabel,
  name,
  profile,
  forecastYears,
  currentTaxYear,
  showSsMedicare = true,
  onNameChange,
  onChange,
}) => {
  const trimmedName = name.trim();
  const isPrimary = roleLabel === 'Primary Taxpayer';
  const parsedDob = parseBirthDate(profile.birth_date);
  const fra = calculateFraInfo(profile.birth_date);
  const anchorYear = forecastYears[0] ?? 2025;
  const lastYear = forecastYears[forecastYears.length - 1] ?? anchorYear + 5;
  const ageAtAnchor = getAgeInTaxYear(profile.birth_date, anchorYear, null);
  const ageAtEnd = getAgeInTaxYear(profile.birth_date, lastYear, null);

  const updateSs = (patch: Partial<PersonSocialSecurityConfig>) => {
    onChange({
      ...profile,
      social_security: {
        ...profile.social_security,
        ...patch,
      },
    });
  };

  const updateMedicare = (patch: Partial<PersonMedicareConfig>) => {
    onChange({
      ...profile,
      medicare: {
        ...profile.medicare,
        ...patch,
      },
    });
  };

  const ss = profile.social_security;
  const med = profile.medicare;

  const annualizedSs =
    ss.monthly_benefit !== null && ss.monthly_benefit > 0 ? Math.round(ss.monthly_benefit * 12) : null;

  const birthMonth = getPersonBirthMonth(profile, 1);
  const birthMonthShort = MONTH_SHORT_NAMES[birthMonth - 1];
  const fraPreSuspMonths = birthMonth - 1;
  const age70ResumeMonths = 13 - birthMonth;
  const effectiveSuspendStart =
    ss.suspend_start_year ?? (fra ? fra.fraYear : anchorYear + 1);
  const effectiveResumeYear = parsedDob
    ? parsedDob.year + (ss.resume_age || 70)
    : effectiveSuspendStart + Math.max(1, (ss.resume_age || 70) - 67);
  const suspendedYears = Math.max(0, effectiveResumeYear - effectiveSuspendStart);
  const drcBoostPct = Math.round(Math.min(3, suspendedYears) * 8);

  const anyMedEntered =
    med.part_a_monthly !== null ||
    med.part_b_monthly !== null ||
    med.part_d_monthly !== null ||
    med.medigap_plan_g_monthly !== null;
  const individualMedMonthly = sumEnteredMedicareMonthly(med);

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50/40 p-4 space-y-4">
      {/* Person Header */}
      <div className="flex items-baseline justify-between gap-2 pb-2.5 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-900">
          {roleLabel}
          {trimmedName ? ` (${trimmedName})` : ''}
        </h3>
        <span className="text-xs font-mono tabular-nums text-slate-500">
          {ageAtAnchor !== null && ageAtEnd !== null
            ? `Age ${ageAtAnchor} (${anchorYear}) → ${ageAtEnd} (${lastYear})`
            : 'DOB not entered'}
        </span>
      </div>

      {/* Editable Name Input */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor={isPrimary ? 'primary_name_input' : 'spouse_name_input'}
            className="text-xs font-medium text-slate-700"
          >
            {isPrimary ? 'Primary Taxpayer Name' : 'Spouse Name'}
          </label>
          <span className="text-[11px] font-mono text-slate-400">
            {isPrimary ? 'primary_name' : 'spouse_name'}
          </span>
        </div>
        <input
          id={isPrimary ? 'primary_name_input' : 'spouse_name_input'}
          type="text"
          value={name}
          placeholder={isPrimary ? 'Primary' : 'Spouse'}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
        />
      </div>

      {/* Date of Birth, Birth Month & Calculated FRA */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-7 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-xs font-medium text-slate-700">
                {roleLabel === 'Primary Taxpayer' ? 'Primary Date of Birth' : 'Spouse Date of Birth'}
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {roleLabel === 'Primary Taxpayer' ? 'primary_birth_date' : 'spouse_birth_date'}
              </span>
            </div>
            <input
              type="date"
              value={profile.birth_date}
              onChange={(e) => {
                const nextDob = e.target.value;
                const nextParsed = parseBirthDate(nextDob);
                const nextFra = calculateFraInfo(nextDob);
                onChange({
                  ...profile,
                  birth_date: nextDob,
                  birth_month: nextParsed?.month ?? profile.birth_month,
                  social_security: {
                    ...profile.social_security,
                    suspend_start_year:
                      profile.social_security.suspend_start_year ?? (nextFra ? nextFra.fraYear : null),
                  },
                });
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
            />
          </div>
          <div className="sm:col-span-5 space-y-1">
            <label
              htmlFor={isPrimary ? 'primary_birth_month' : 'spouse_birth_month'}
              className="block text-xs font-medium text-slate-700"
            >
              Birth Month (SS Proration)
            </label>
            <select
              id={isPrimary ? 'primary_birth_month' : 'spouse_birth_month'}
              value={birthMonth}
              onChange={(e) => {
                const nextMonth = Number(e.target.value);
                const updated = updateProfileBirthMonth(
                  profile,
                  nextMonth,
                  parsedDob?.year ?? 1970
                );
                const nextFra = calculateFraInfo(updated.birth_date);
                onChange({
                  ...updated,
                  social_security: {
                    ...updated.social_security,
                    suspend_start_year:
                      updated.social_security.suspend_start_year ?? (nextFra ? nextFra.fraYear : null),
                  },
                });
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
            >
              {MONTH_LONG_NAMES.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {idx + 1} — {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {fra && parsedDob ? (
          <div className="space-y-1 pt-0.5 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                Full Retirement Age (FRA):{' '}
                <strong className="font-mono font-semibold text-slate-900">{fra.label}</strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-slate-800">{formatReadableDate(fra.fraDate)}</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500">
              {forecastYears
                .map((yr) => `${yr}: ${yr - parsedDob.year}`)
                .join(' · ')}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 leading-snug">
            Leave blank if unknown, or enter a date of birth to calculate exact forecast-year ages, age-65+ deduction eligibility, and Full Retirement Age (FRA).
          </p>
        )}
      </div>

      {/* Independent Social Security Controls */}
      {showSsMedicare && (
      <>
      <div className="pt-3 border-t border-slate-200 space-y-3">
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-xs font-semibold text-slate-900">Receiving Social Security</div>
            <div className="text-[11px] text-slate-500">
              Individual claiming &amp; optional FRA-to-70 voluntary suspension for {roleLabel.toLowerCase()}.
            </div>
          </div>
          <input
            type="checkbox"
            checked={ss.receiving}
            onChange={(e) => updateSs({ receiving: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
          />
        </label>

        {ss.receiving && (
          <div className="pt-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <OptionalDollarInput
                label={`Gross Monthly Benefit (${currentTaxYear})`}
                value={ss.monthly_benefit}
                placeholder="Enter monthly $"
                onChange={(val) => updateSs({ monthly_benefit: val })}
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">
                  Annualized ({currentTaxYear} Exact)
                </span>
                <div className="py-1.5 px-2.5 rounded-md bg-white border border-slate-200 text-sm font-mono tabular-nums text-slate-900">
                  {annualizedSs !== null ? `${formatCurrency(annualizedSs)} / yr` : '—'}
                </div>
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ss.suspend_fra_to_70}
                onChange={(e) =>
                  updateSs({
                    suspend_fra_to_70: e.target.checked,
                    suspend_start_year:
                      e.target.checked && ss.suspend_start_year === null && fra
                        ? fra.fraYear
                        : ss.suspend_start_year,
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
              />
              <div className="text-xs text-slate-700">
                <span className="font-medium text-slate-900">
                  Voluntarily suspend benefit (FRA to age 70)
                </span>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Suspends this person&apos;s benefit independently to earn +8%/year Delayed Retirement Credits.
                </div>
              </div>
            </label>

            {ss.suspend_fra_to_70 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-700">Suspend Start Year</label>
                  <input
                    type="number"
                    min={fra ? fra.fraYear : 2025}
                    max={2040}
                    step={1}
                    value={ss.suspend_start_year ?? (fra ? fra.fraYear : anchorYear + 1)}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateSs({ suspend_start_year: val === '' ? null : Number(val) });
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-700">Resume at Age</label>
                  <select
                    value={ss.resume_age}
                    onChange={(e) => updateSs({ resume_age: Number(e.target.value) })}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value={68}>Age 68</option>
                    <option value={69}>Age 69</option>
                    <option value={70}>Age 70 (Max DRC)</option>
                  </select>
                </div>
                <div className="col-span-2 text-[11px] font-mono text-teal-800">
                  {suspendedYears > 0
                    ? `FRA ${effectiveSuspendStart} (${birthMonthShort}): ${fraPreSuspMonths} mos pre-susp · Resumes ${effectiveResumeYear} (${birthMonthShort}) for ${age70ResumeMonths} mos at +${drcBoostPct}% DRC`
                    : 'Set Suspend Start Year before Resume Age to model Delayed Retirement Credits.'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Independent Medicare Controls */}
      <div className="pt-3 border-t border-slate-200 space-y-3">
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-xs font-semibold text-slate-900">Enrolled in Medicare</div>
            <div className="text-[11px] text-slate-500">
              Individual Part A, Part B, Part D, and Medigap premiums for {roleLabel.toLowerCase()}.
            </div>
          </div>
          <input
            type="checkbox"
            checked={med.enrolled}
            onChange={(e) => updateMedicare({ enrolled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
          />
        </label>

        {med.enrolled && (
          <div className="pt-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <OptionalDollarInput
                label="Part A (Monthly)"
                value={med.part_a_monthly}
                placeholder="Blank if $0 / N/A"
                onChange={(val) => updateMedicare({ part_a_monthly: val })}
              />
              <OptionalDollarInput
                label="Part B (Monthly)"
                value={med.part_b_monthly}
                placeholder="Enter monthly $"
                onChange={(val) => updateMedicare({ part_b_monthly: val })}
              />
              <OptionalDollarInput
                label="Part D (Monthly)"
                value={med.part_d_monthly}
                placeholder="Enter monthly $"
                onChange={(val) => updateMedicare({ part_d_monthly: val })}
              />
              <OptionalDollarInput
                label="Medigap / Supplement (Plan G)"
                value={med.medigap_plan_g_monthly}
                placeholder="Enter monthly $"
                onChange={(val) => updateMedicare({ medigap_plan_g_monthly: val })}
              />
            </div>

            <div className="text-[11px] font-mono tabular-nums text-slate-600">
              {anyMedEntered
                ? `${roleLabel} ${currentTaxYear} base premiums: ${formatCurrency(individualMedMonthly)}/mo · ${formatCurrency(Math.round(individualMedMonthly * 12))}/yr (exact in ${currentTaxYear})`
                : 'Leave unknown premium amounts blank until confirmed.'}
            </div>

            <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-md px-3 py-2 leading-relaxed">
              Income-based IRMAA (Income-Related Monthly Adjustment Amount) surcharges are computed automatically per enrolled person by the deterministic tax engine from two-year lookback MAGI.
            </p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
};
