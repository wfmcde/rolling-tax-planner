import type { PlannerState, ScenarioDefinition, TaxYearRecord } from '../types/tax';
import { STATE_TAX_RULES } from './taxEngine';
import { getStateFullName } from '../utils/setupHelpers';

function cloneYears(years: TaxYearRecord[]): TaxYearRecord[] {
  return JSON.parse(JSON.stringify(years)) as TaxYearRecord[];
}

export interface ScenarioPresetMeta {
  id: string;
  name: string;
  description: string;
  build: (state: PlannerState) => ScenarioDefinition;
}

export const SCENARIO_PRESETS: ScenarioPresetMeta[] = [
  {
    id: 'elect-pte',
    name: 'Elect State PTE Tax (Years 2–6)',
    description:
      'Activates Pass-Through Entity (PTE) tax elections across eligible income-tax states in Years 2–6 so state taxes are deducted at the 1120-S entity level above the federal SALT cap.',
    build: (state) => {
      const setup = { ...state.setup, has_pte: true };
      const years = cloneYears(state.years).map((yr, idx) => {
        if (idx === 0) return yr;
        return {
          ...yr,
          scorp_1120s: {
            ...yr.scorp_1120s,
            pte_election_active: true,
          },
          state_filings: yr.state_filings.map((sf) => {
            const rule = STATE_TAX_RULES[sf.state_code];
            const pteEligible = Boolean(rule && rule.pteRate > 0);
            return {
              ...sf,
              state_pte_elected: pteEligible,
            };
          }),
        };
      });
      return {
        id: 'elect-pte',
        name: 'Elect State PTE Tax (Years 2–6)',
        description:
          'Activates state Pass-Through Entity (PTE) elections in Years 2–6 across all eligible active states for entity-level federal deductibility.',
        setup,
        years,
      };
    },
  },
  {
    id: 'optimize-w2-split',
    name: 'Optimize S-Corp W-2 vs. Distribution Split',
    description:
      'Reduces officer W-2 compensation by up to 20% (capped at $30,000) in Years 2–6 while shifting equivalent cash flow to shareholder distributions to expand Section 199A QBI deduction and lower employer payroll taxes.',
    build: (state) => {
      const setup = { ...state.setup };
      const years = cloneYears(state.years).map((yr, idx) => {
        if (idx === 0) return yr;
        const currentW2 = Math.max(0, yr.scorp_1120s.officer_w2_wages);
        if (currentW2 <= 0) return yr;
        const targetCut = Math.min(30000, Math.round(currentW2 * 0.2));
        const reducedW2 = Math.max(0, currentW2 - targetCut);
        const delta = currentW2 - reducedW2;
        const ratio = currentW2 > 0 ? reducedW2 / currentW2 : 1;
        const nextSpouseW2 = Math.round(yr.scorp_1120s.debra_w2_wages * ratio);
        const nextPrimaryW2 = Math.max(0, reducedW2 - nextSpouseW2);
        return {
          ...yr,
          form_1040: {
            ...yr.form_1040,
            w2_wages_total: reducedW2,
          },
          scorp_1120s: {
            ...yr.scorp_1120s,
            debra_w2_wages: nextSpouseW2,
            bill_w2_wages: nextPrimaryW2,
            officer_w2_wages: reducedW2,
            scorp_distributions_total: yr.scorp_1120s.scorp_distributions_total + delta,
          },
        };
      });
      return {
        id: 'optimize-w2-split',
        name: 'Optimize S-Corp W-2 vs. Distribution Split',
        description:
          'Shifts up to 20% (max $30k/yr) of officer W-2 salary into S-Corp distributions across Years 2–6 to expand QBI deduction and lower FICA payroll tax.',
        setup,
        years,
      };
    },
  },
  {
    id: 'extend-dbp-2029',
    name: 'Extend Defined Benefit Plan (+2 Years)',
    description:
      'Defers Defined Benefit Plan (DBP) termination by two additional years beyond the current target termination year, extending deductible actuarial contributions across peak income years.',
    build: (state) => {
      const forecastYears = state.years.map((y) => y.tax_year);
      const lastForecastYear = forecastYears[forecastYears.length - 1] ?? 2030;
      const baseTerm =
        state.setup.dbp_planned_termination_year ?? Math.max(forecastYears[1] ?? 2026, lastForecastYear - 3);
      const extendedTerm = Math.min(lastForecastYear, baseTerm + 2);
      const inflationRate = state.setup.assumptions?.inflation_rate ?? 0.025;

      // Derive baseline annual DBP funding dynamically from the active profile's latest funded year
      const latestActiveDbpYear = [...state.years]
        .reverse()
        .find((y) => y.dbp_and_retirement.dbp_actual_contribution > 0);
      const baseAnnualDbp = latestActiveDbpYear?.dbp_and_retirement.dbp_actual_contribution ?? 0;
      const baseMaxDbp = Math.max(
        baseAnnualDbp,
        latestActiveDbpYear?.dbp_and_retirement.dbp_max_deductible_contribution ?? 0
      );
      const existingRollover =
        state.years.find((y) => y.dbp_and_retirement.rollover_amount > 0)?.dbp_and_retirement
          .rollover_amount ?? 0;

      const setup = {
        ...state.setup,
        has_dbp: true,
        dbp_planned_termination_year: extendedTerm,
      };

      const years: TaxYearRecord[] = cloneYears(state.years).map((yr, idx): TaxYearRecord => {
        if (idx === 0) return yr;
        if (yr.tax_year < extendedTerm) {
          const activeContrib =
            yr.dbp_and_retirement.dbp_actual_contribution > 0
              ? yr.dbp_and_retirement.dbp_actual_contribution
              : baseAnnualDbp;
          const activeMax =
            yr.dbp_and_retirement.dbp_max_deductible_contribution > 0
              ? yr.dbp_and_retirement.dbp_max_deductible_contribution
              : Math.round(baseMaxDbp * (1 + inflationRate));
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'active',
              dbp_target_termination_year: extendedTerm,
              dbp_max_deductible_contribution: activeMax,
              dbp_actual_contribution: activeContrib,
              rollover_amount: 0,
            },
          };
        }
        if (yr.tax_year === extendedTerm) {
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'terminating',
              dbp_target_termination_year: extendedTerm,
              dbp_max_deductible_contribution: Math.round(baseMaxDbp * (1 + inflationRate)),
              dbp_actual_contribution: Math.round(baseAnnualDbp * 0.5),
              rollover_amount: existingRollover + Math.round(baseAnnualDbp * 2),
              rollover_source_type:
                existingRollover + baseAnnualDbp > 0 ? 'Defined Benefit Plan Termination' : 'None',
            },
          };
        }
        return {
          ...yr,
          dbp_and_retirement: {
            ...yr.dbp_and_retirement,
            dbp_status: 'terminated',
            dbp_target_termination_year: extendedTerm,
            dbp_max_deductible_contribution: 0,
            dbp_actual_contribution: 0,
            rollover_amount: 0,
          },
        };
      });
      return {
        id: 'extend-dbp-2029',
        name: `Extend DBP Funding Through ${extendedTerm}`,
        description: `Extends Defined Benefit Plan deductible funding by 2 additional years (termination moved to ${extendedTerm}).`,
        setup,
        years,
      };
    },
  },
  {
    id: 'wa-residency-shift',
    name: 'Relocate Residency to a 0% Income Tax State',
    description:
      'Models relocating full-year personal residency to a 0% personal income tax jurisdiction in Year 3+ while shifting 85% of S-Corp sourcing out of the prior home state.',
    build: (state) => {
      const priorHomeCode = (state.setup.home_state || '').trim().toUpperCase();
      const priorHomeRule = priorHomeCode ? STATE_TAX_RULES[priorHomeCode] : undefined;
      const alreadyZeroTax = !priorHomeCode || (priorHomeRule && priorHomeRule.mode === 'none');
      const targetZeroTaxCode = alreadyZeroTax ? priorHomeCode || 'TX' : 'WA';
      const targetZeroTaxName = getStateFullName(targetZeroTaxCode);
      const shiftStartYear = state.years[2]?.tax_year ?? (state.setup.current_tax_year + 1);

      const setup = {
        ...state.setup,
        multi_state_active: !alreadyZeroTax,
        residency_change_active: !alreadyZeroTax,
      };

      const years: TaxYearRecord[] = cloneYears(state.years).map((yr): TaxYearRecord => {
        if (yr.tax_year < shiftStartYear || alreadyZeroTax) return yr;
        const priorHomeName = getStateFullName(priorHomeCode);
        return {
          ...yr,
          scorp_1120s: {
            ...yr.scorp_1120s,
            state_sourcing_breakdown: [
              { state_code: targetZeroTaxCode, apportionment_percent: 85 },
              { state_code: priorHomeCode, apportionment_percent: 15 },
            ],
          },
          state_filings: [
            {
              state_code: targetZeroTaxCode,
              residency_status: 'resident',
              residency_start_date: `${yr.tax_year}-01-01`,
              residency_end_date: `${yr.tax_year}-12-31`,
              residency_day_or_income_ratio: 1,
              state_return_type: `${targetZeroTaxCode} Full-Year Resident (0% Personal Income Tax)`,
              state_apportionment_factor: 0.85,
              state_pte_elected: false,
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 0,
            },
            {
              state_code: priorHomeCode,
              residency_status: 'non_resident',
              residency_start_date: `${yr.tax_year}-01-01`,
              residency_end_date: `${yr.tax_year}-12-31`,
              residency_day_or_income_ratio: 0,
              state_return_type: `${priorHomeName} Non-Resident (15% Sourced K-1)`,
              state_apportionment_factor: 0.15,
              state_pte_elected: Boolean(setup.has_pte && priorHomeRule && priorHomeRule.pteRate > 0),
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 0,
            },
          ],
        };
      });

      return {
        id: 'wa-residency-shift',
        name: alreadyZeroTax
          ? `Retain 0% Tax Domicile (${targetZeroTaxCode})`
          : `Relocate Residency to ${targetZeroTaxName} (${targetZeroTaxCode}) in ${shiftStartYear}`,
        description: alreadyZeroTax
          ? `Active household is already domiciled in a 0% personal income tax state (${targetZeroTaxCode || 'Unconfigured'}).`
          : `Shifts primary domicile from ${priorHomeCode} to ${targetZeroTaxCode} (0% personal tax) starting in ${shiftStartYear} and lowers ${priorHomeCode} apportionment to 15%.`,
        setup,
        years,
      };
    },
  },
];
