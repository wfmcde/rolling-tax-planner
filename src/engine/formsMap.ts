import type { ComputedTaxYear, FilingFormRequirement, SetupConfig } from '../types/tax';
import { STATE_TAX_RULES } from './taxEngine';

/**
 * Generates the Module 1 §4 / Module 3 §1.4 Filing & Planning Map
 * driven strictly by active setup toggles and six-year computed outputs.
 */
export function buildFilingFormsMap(
  setup: SetupConfig,
  computed: ComputedTaxYear[]
): FilingFormRequirement[] {
  const allYears = computed.map((c) => c.tax_year);
  const forms: FilingFormRequirement[] = [];

  // Core Form 1040
  forms.push({
    form_code: 'Form 1040',
    jurisdiction: 'Federal',
    title: 'U.S. Individual Income Tax Return',
    category: 'Individual',
    due_date: 'April 15 (Oct 15 w/ Form 4868)',
    driven_by: `Filing Status: ${setup.filing_status.replace(/_/g, ' ')}`,
    active_years: allYears,
    notes: 'Core household return aggregating W-2 wages, investment income, Social Security, retirement distributions, and K-1 pass-through items.',
  });

  // Schedule 1 / Schedule B / Schedule D
  const hasInv = computed.some(
    (c) =>
      c.form_1040_in.taxable_interest > 1500 ||
      c.form_1040_in.ordinary_dividends > 1500
  );
  if (hasInv) {
    forms.push({
      form_code: 'Schedule B',
      jurisdiction: 'Federal',
      title: 'Interest and Ordinary Dividends',
      category: 'Individual',
      due_date: 'Filed with Form 1040',
      driven_by: 'Interest / Dividends > $1,500',
      active_years: allYears,
      notes: 'Required when taxable interest or ordinary dividends exceed $1,500.',
    });
  }

  const hasCapGains = computed.some(
    (c) =>
      c.form_1040_in.long_term_capital_gain_loss !== 0 ||
      c.form_1040_in.short_term_capital_gain_loss !== 0 ||
      c.scorp_out.excess_distribution_capital_gain > 0
  );
  if (hasCapGains) {
    forms.push({
      form_code: 'Schedule D / Form 8949',
      jurisdiction: 'Federal',
      title: 'Capital Gains and Losses',
      category: 'Individual',
      due_date: 'Filed with Form 1040',
      driven_by: 'Capital gain/loss or excess S-Corp distribution',
      active_years: allYears,
      notes: 'Tracks short-term and long-term capital gains and preferential 0%/15%/20% rate stacks.',
    });
  }

  const hasSchedule1 = computed.some(
    (c) =>
      c.form_1040_out.adjustments_to_income > 0 ||
      c.form_1040_in.schedule_1_other_income !== 0
  );
  if (hasSchedule1) {
    forms.push({
      form_code: 'Schedule 1',
      jurisdiction: 'Federal',
      title: 'Additional Income and Adjustments to Income',
      category: 'Individual',
      due_date: 'Filed with Form 1040',
      driven_by: 'Self-employed / >2% S-Corp health insurance or Schedule 1 adjustments',
      active_years: allYears,
      notes: 'Reports above-the-line adjustments to compute Adjusted Gross Income (AGI).',
    });
  }

  // S-Corporation Branch
  if (setup.has_scorp) {
    forms.push(
      {
        form_code: 'Form 1120-S',
        jurisdiction: 'Federal',
        title: 'U.S. Income Tax Return for an S Corporation',
        category: 'Entity',
        due_date: 'March 15 (Sept 15 w/ Form 7004)',
        driven_by: 'Entity Type: LLC with S-Corp Designation',
        active_years: allYears,
        notes: 'Reports entity revenue, officer W-2 compensation, payroll taxes, DBP/retirement deductions, PTE tax deductions, and AAA balance.',
      },
      {
        form_code: 'Schedule K-1 (1120-S) & Schedule E',
        jurisdiction: 'Federal',
        title: "Shareholder's Share of Income, Deductions & Credits",
        category: 'Entity',
        due_date: 'March 15 (K-1) / April 15 (Sch E)',
        driven_by: 'S-Corporation pass-through income',
        active_years: allYears,
        notes: 'Passes ordinary business income and QBI information through to Form 1040 Schedule E.',
      },
      {
        form_code: 'Form 7203',
        jurisdiction: 'Federal',
        title: 'S Corporation Shareholder Stock and Debt Basis Limitations',
        category: 'Entity',
        due_date: 'Filed with Form 1040',
        driven_by: 'Shareholder distributions / basis tracking',
        active_years: allYears,
        notes: 'Mandatory basis rollforward verifying distributions do not exceed stock_basis_ending.',
      },
      {
        form_code: 'Form 8995 / 8995-A',
        jurisdiction: 'Federal',
        title: 'Qualified Business Income (Section 199A) Deduction',
        category: 'Entity',
        due_date: 'Filed with Form 1040',
        driven_by: 'S-Corp K-1 Qualified Business Income',
        active_years: allYears,
        notes: 'Calculates 20% QBI deduction subject to taxable income and W-2 wage limitations.',
      }
    );
  }

  // Defined Benefit Plan Branch
  if (setup.has_dbp) {
    const dbpActiveYears = computed
      .filter((c) => c.dbp_in.dbp_status !== 'terminated')
      .map((c) => c.tax_year);
    const termYears = computed
      .filter((c) => c.dbp_in.dbp_status === 'terminating')
      .map((c) => c.tax_year);

    forms.push({
      form_code: 'Form 5500-EZ / Schedule SB',
      jurisdiction: 'Federal',
      title: 'Annual Return of One-Participant Retirement Plan + Actuarial Certification',
      category: 'Retirement',
      due_date: 'July 31 (Oct 15 w/ Form 5558)',
      driven_by: 'Active Defined Benefit Plan (DBP)',
      active_years: dbpActiveYears.length > 0 ? dbpActiveYears : allYears.slice(0, 1),
      notes: 'Required annually when plan assets exceed $250,000 and in the final termination year regardless of balance. Requires enrolled actuary signature on Schedule SB.',
    });

    if (termYears.length > 0) {
      forms.push({
        form_code: 'Form 1099-R (Direct Rollover)',
        jurisdiction: 'Federal',
        title: 'DBP Plan Termination & Direct IRA Rollover Reporting',
        category: 'Retirement',
        due_date: 'January 31 following termination year',
        driven_by: `DBP Target Termination Year (${termYears.join(', ')})`,
        active_years: termYears,
        notes: 'Documents non-taxable direct rollover (Distribution Code G) from terminated DBP into Traditional IRA; requires zero unpaid loan balance.',
      });
    }
  }

  // Qualified Plans / Annuities
  if (setup.has_401k_or_ira || setup.has_annuity) {
    forms.push({
      form_code: 'Form 5498 / Form 1099-R',
      jurisdiction: 'Federal',
      title: 'IRA / Qualified Plan Contributions & Distributions',
      category: 'Retirement',
      due_date: 'May 31 (5498) / Jan 31 (1099-R)',
      driven_by: [
        setup.has_401k_or_ira ? '401(k) / IRA active' : '',
        setup.has_annuity ? 'Annuity contract active' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      active_years: allYears,
      notes: 'Tracks qualified deferrals, IRA rollover receipts, and taxable pension/annuity distributions.',
    });
  }

  // Multi-State & PTE Filings
  const uniqueStates = new Map<string, { years: number[]; pteYears: number[]; statuses: Set<string> }>();
  for (const c of computed) {
    for (const sf of c.state_filings_out) {
      const existing = uniqueStates.get(sf.state_code) ?? {
        years: [],
        pteYears: [],
        statuses: new Set<string>(),
      };
      existing.years.push(c.tax_year);
      existing.statuses.add(sf.residency_status.replace(/_/g, ' '));
      if (setup.has_pte && sf.state_pte_elected && sf.state_pte_payment_amount > 0) {
        existing.pteYears.push(c.tax_year);
      }
      uniqueStates.set(sf.state_code, existing);
    }
  }

  for (const [code, info] of uniqueStates.entries()) {
    const rule = STATE_TAX_RULES[code];
    const stateName = rule?.name ?? code;
    if (rule?.mode !== 'none') {
      forms.push({
        form_code: `${code} Personal & ${setup.has_scorp ? 'S-Corp Return' : 'Income Return'}`,
        jurisdiction: stateName,
        title: `${stateName} State Individual (${Array.from(info.statuses).join(' / ')})${
          setup.has_scorp ? ' & S-Corp Return' : ''
        }`,
        category: 'State & PTE',
        due_date: setup.has_scorp ? 'March 15 (Entity) / April 15 (Personal)' : 'April 15',
        driven_by: `State Footprint: ${code}`,
        active_years: info.years,
        notes:
          code === 'CA'
            ? 'Includes California 1.5% S-Corp franchise tax ($800 minimum) and Form 540NR part-year/non-resident sourcing.'
            : code === 'AZ'
            ? 'Includes Arizona 2.5% flat personal income tax and AZ Form 120S entity apportionment.'
            : `State income tax return and multi-state apportionment for ${stateName}.`,
      });
    }

    if (info.pteYears.length > 0 && rule?.pteAvailable) {
      forms.push({
        form_code: `${code} PTE Election`,
        jurisdiction: stateName,
        title: `${stateName} Pass-Through Entity Elective Tax`,
        category: 'State & PTE',
        due_date: code === 'CA' ? 'June 15 (Prepayment) / March 15' : 'March 15',
        driven_by: `State PTE Election active (${code})`,
        active_years: info.pteYears,
        notes: `Entity-level tax payment at ${(rule.pteRate * 100).toFixed(2)}% deductible on federal Form 1120-S with corresponding state personal tax credit.`,
      });
    }
  }

  return forms;
}
