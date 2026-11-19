import type { PlannerState, ScenarioDefinition, TaxYearRecord } from '../types/tax';

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
      'Activates Pass-Through Entity (PTE) tax elections in AZ and CA across forecast years 2–6 so state taxes are deducted at the 1120-S entity level above the SALT cap.',
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
          state_filings: yr.state_filings.map((sf) => ({
            ...sf,
            state_pte_elected: sf.state_code === 'AZ' || sf.state_code === 'CA',
          })),
        };
      });
      return {
        id: 'elect-pte',
        name: 'Elect State PTE Tax (Years 2–6)',
        description:
          'Activates state Pass-Through Entity (PTE) elections in Years 2–6 for federal entity-level deductibility.',
        setup,
        years,
      };
    },
  },
  {
    id: 'optimize-w2-split',
    name: 'Optimize S-Corp W-2 vs. Distribution Split',
    description:
      'Adjusts officer W-2 compensation down by $30,000 in Years 2–6 (maintaining >40% reasonable comp) while shifting equivalent cash flow to shareholder distributions to expand Section 199A QBI deduction and reduce employer payroll taxes.',
    build: (state) => {
      const setup = { ...state.setup };
      const years = cloneYears(state.years).map((yr, idx) => {
        if (idx === 0) return yr;
        const reducedW2 = Math.max(120000, yr.scorp_1120s.officer_w2_wages - 30000);
        const delta = yr.scorp_1120s.officer_w2_wages - reducedW2;
        return {
          ...yr,
          form_1040: {
            ...yr.form_1040,
            w2_wages_total: reducedW2,
          },
          scorp_1120s: {
            ...yr.scorp_1120s,
            officer_w2_wages: reducedW2,
            scorp_distributions_total: yr.scorp_1120s.scorp_distributions_total + delta,
          },
        };
      });
      return {
        id: 'optimize-w2-split',
        name: 'Optimize S-Corp W-2 vs. Distribution Split',
        description:
          'Reduces officer W-2 salary by $30k in Years 2–6 with offsetting S-Corp distributions to expand QBI deduction and lower FICA payroll tax.',
        setup,
        years,
      };
    },
  },
  {
    id: 'extend-dbp-2029',
    name: 'Extend DBP Funding Through 2029',
    description:
      'Defers Defined Benefit Plan (DBP) termination from 2027 to 2029, capturing two additional years of maximum tax-deductible actuarial funding ($55k–$60k/yr) during peak pre-Social Security income years.',
    build: (state) => {
      const setup = { ...state.setup, has_dbp: true };
      const years: TaxYearRecord[] = cloneYears(state.years).map((yr, idx): TaxYearRecord => {
        if (idx === 0) return yr;
        const targetYear = 2029;
        if (yr.tax_year < targetYear) {
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'active',
              dbp_target_termination_year: targetYear,
              dbp_max_deductible_contribution: 66000,
              dbp_actual_contribution: 58000,
              rollover_amount: 0,
            },
          };
        }
        if (yr.tax_year === targetYear) {
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'terminating',
              dbp_target_termination_year: targetYear,
              dbp_max_deductible_contribution: 68000,
              dbp_actual_contribution: 32000,
              rollover_amount: 615000,
              rollover_source_type: 'Defined Benefit Plan Termination',
            },
          };
        }
        return {
          ...yr,
          dbp_and_retirement: {
            ...yr.dbp_and_retirement,
            dbp_status: 'terminated',
            dbp_target_termination_year: targetYear,
            dbp_max_deductible_contribution: 0,
            dbp_actual_contribution: 0,
            rollover_amount: 0,
          },
        };
      });
      return {
        id: 'extend-dbp-2029',
        name: 'Extend DBP Funding Through 2029',
        description:
          'Extends Defined Benefit Plan deductible funding by 2 additional years (termination moved to 2029).',
        setup,
        years,
      };
    },
  },
  {
    id: 'wa-residency-shift',
    name: 'Relocate Residency to Washington (0% Income Tax) in 2027',
    description:
      'Models relocating full-year personal residency to Washington in 2027 while reducing California revenue sourcing to 15%, eliminating Arizona personal income tax from 2027 onward.',
    build: (state) => {
      const setup = { ...state.setup, multi_state_active: true, residency_change_active: true };
      const years: TaxYearRecord[] = cloneYears(state.years).map((yr): TaxYearRecord => {
        if (yr.tax_year < 2027) return yr;
        return {
          ...yr,
          scorp_1120s: {
            ...yr.scorp_1120s,
            state_sourcing_breakdown: [
              { state_code: 'WA', apportionment_percent: 85 },
              { state_code: 'CA', apportionment_percent: 15 },
            ],
          },
          state_filings: [
            {
              state_code: 'WA',
              residency_status: 'resident',
              residency_start_date: `${yr.tax_year}-01-01`,
              residency_end_date: `${yr.tax_year}-12-31`,
              residency_day_or_income_ratio: 1,
              state_return_type: 'WA (No Personal Income Tax)',
              state_apportionment_factor: 0.85,
              state_pte_elected: false,
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 0,
            },
            {
              state_code: 'CA',
              residency_status: 'non_resident',
              residency_start_date: `${yr.tax_year}-01-01`,
              residency_end_date: `${yr.tax_year}-12-31`,
              residency_day_or_income_ratio: 0,
              state_return_type: 'CA Form 540NR (Non-Resident) + CA 100S',
              state_apportionment_factor: 0.15,
              state_pte_elected: setup.has_pte,
              other_state_credits_claimed: 0,
              state_tax_withholding_and_estimates: 2200,
            },
          ],
        };
      });
      return {
        id: 'wa-residency-shift',
        name: 'Relocate Residency to Washington (0% Income Tax) in 2027',
        description:
          'Shifts primary domicile to WA (0% personal tax) in 2027 and lowers CA apportionment to 15%.',
        setup,
        years,
      };
    },
  },
];
