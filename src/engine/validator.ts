import type {
  ComputedTaxYear,
  SetupConfig,
  TaxYearRecord,
  ValidationIssue,
} from '../types/tax';

function daysBetweenInclusive(startStr: string, endStr: string): number | null {
  if (!startStr || !endStr) return null;
  const s = new Date(`${startStr}T00:00:00Z`);
  const e = new Date(`${endStr}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null;
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Automated Validation & Guardrail Rules (Module 4 §3).
 * Executes deterministically against raw records and computed outputs.
 */
export function runGuardrailValidation(
  setup: SetupConfig,
  years: TaxYearRecord[],
  computed: ComputedTaxYear[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (years.length !== 6) {
    issues.push({
      id: 'horizon-length',
      tax_year: null,
      category: 'reconciliation',
      severity: 'error',
      title: 'Six-year rolling window incomplete',
      message: `Expected 6 continuous tax years (1 actuals + 5 forecast), found ${years.length}.`,
      field_reference: 'setup.forecast_length',
      target_tab: 'horizon',
    });
  }

  // Year 1 Lock Integrity
  const year1 = years[0];
  if (year1 && !year1.is_locked_actuals) {
    issues.push({
      id: `lock-unlocked-${year1.tax_year}`,
      tax_year: year1.tax_year,
      category: 'lock_integrity',
      severity: 'warning',
      title: `Year 1 (${year1.tax_year}) unlocked for amended-return edits`,
      message:
        'Year 1 actuals are currently unlocked. Re-lock Year 1 once reconciled to the filed or amended return to preserve baseline anchor integrity.',
      field_reference: 'years[0].is_locked_actuals',
      target_tab: 'form1040',
    });
  }

  for (let i = 0; i < years.length; i++) {
    const yr = years[i];
    const comp = computed[i];
    if (!comp) continue;

    // S-Corp & Compensation Guardrails
    if (setup.has_scorp) {
      if (
        comp.scorp_out.ordinary_business_income_1120s > 0 &&
        yr.scorp_1120s.officer_w2_wages <= 0
      ) {
        issues.push({
          id: `scorp-missing-w2-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'scorp_comp',
          severity: 'error',
          title: `Missing officer W-2 wages (${yr.tax_year})`,
          message: `Ordinary business income is $${comp.scorp_out.ordinary_business_income_1120s.toLocaleString()} with $0 officer_w2_wages. IRS reasonable compensation rules require officer W-2 wages when taking S-Corp distributions.`,
          field_reference: 'scorp_1120s.officer_w2_wages',
          target_tab: 'scorp',
        });
      } else if (
        comp.scorp_out.ordinary_business_income_1120s > 50000 &&
        comp.scorp_out.reasonable_comp_ratio < 0.3
      ) {
        issues.push({
          id: `scorp-low-w2-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'scorp_comp',
          severity: 'warning',
          title: `Low reasonable compensation ratio (${yr.tax_year})`,
          message: `Officer W-2 wages represent ${(comp.scorp_out.reasonable_comp_ratio * 100).toFixed(1)}% of combined officer compensation + ordinary business income. Review IRS S-Corp reasonable compensation benchmarks.`,
          field_reference: 'scorp_1120s.officer_w2_wages',
          target_tab: 'scorp',
        });
      }

      if (comp.scorp_out.excess_distribution_capital_gain > 0) {
        issues.push({
          id: `scorp-basis-exceeded-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'scorp_comp',
          severity: 'warning',
          title: `Distributions exceed S-Corp stock basis (${yr.tax_year})`,
          message: `scorp_distributions_total ($${yr.scorp_1120s.scorp_distributions_total.toLocaleString()}) exceeds available stock basis by $${comp.scorp_out.excess_distribution_capital_gain.toLocaleString()}, triggering taxable capital gain.`,
          field_reference: 'scorp_1120s.stock_basis_ending',
          target_tab: 'scorp',
        });
      }

      const sourcingSum = yr.scorp_1120s.state_sourcing_breakdown.reduce(
        (acc, s) => acc + s.apportionment_percent,
        0
      );
      if (
        yr.scorp_1120s.state_sourcing_breakdown.length > 0 &&
        Math.abs(sourcingSum - 100) > 0.5
      ) {
        issues.push({
          id: `scorp-sourcing-sum-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'scorp_comp',
          severity: 'error',
          title: `State sourcing breakdown does not total 100% (${yr.tax_year})`,
          message: `state_sourcing_breakdown sums to ${sourcingSum.toFixed(1)}%. Adjust state percentages to total exactly 100%.`,
          field_reference: 'scorp_1120s.state_sourcing_breakdown',
          target_tab: 'scorp',
        });
      }
    }

    // DBP & Retirement Milestones
    if (setup.has_dbp) {
      const dbp = yr.dbp_and_retirement;
      if (dbp.dbp_actual_contribution > dbp.dbp_max_deductible_contribution) {
        issues.push({
          id: `dbp-over-max-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'dbp_retirement',
          severity: 'error',
          title: `DBP contribution exceeds actuarial maximum (${yr.tax_year})`,
          message: `dbp_actual_contribution ($${dbp.dbp_actual_contribution.toLocaleString()}) exceeds dbp_max_deductible_contribution ($${dbp.dbp_max_deductible_contribution.toLocaleString()}). Excess contributions risk a 10% IRS excise tax.`,
          field_reference: 'dbp_and_retirement.dbp_actual_contribution',
          target_tab: 'dbp',
        });
      }

      if (
        yr.tax_year > dbp.dbp_target_termination_year &&
        dbp.dbp_actual_contribution > 0
      ) {
        issues.push({
          id: `dbp-post-term-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'dbp_retirement',
          severity: 'error',
          title: `Active DBP contribution after termination year (${yr.tax_year})`,
          message: `Target termination year is ${dbp.dbp_target_termination_year}, but $${dbp.dbp_actual_contribution.toLocaleString()} is still scheduled in ${yr.tax_year}.`,
          field_reference: 'dbp_and_retirement.dbp_target_termination_year',
          target_tab: 'dbp',
        });
      }

      if (
        (dbp.dbp_status === 'terminating' || dbp.dbp_status === 'terminated') &&
        dbp.dbp_loan_balance > 0
      ) {
        issues.push({
          id: `dbp-loan-winddown-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'dbp_retirement',
          severity: 'warning',
          title: `Outstanding DBP participant loan during wind-down (${yr.tax_year})`,
          message: `dbp_loan_balance is $${dbp.dbp_loan_balance.toLocaleString()} while plan status is "${dbp.dbp_status}". Unrepaid loans upon termination are treated as taxable deemed distributions.`,
          field_reference: 'dbp_and_retirement.dbp_loan_balance',
          target_tab: 'dbp',
        });
      }

      if (dbp.dbp_loan_balance > 0 && dbp.dbp_collateral_requirement < dbp.dbp_loan_balance) {
        issues.push({
          id: `dbp-collateral-${yr.tax_year}`,
          tax_year: yr.tax_year,
          category: 'dbp_retirement',
          severity: 'warning',
          title: `DBP loan collateral below loan balance (${yr.tax_year})`,
          message: `dbp_collateral_requirement ($${dbp.dbp_collateral_requirement.toLocaleString()}) is below dbp_loan_balance ($${dbp.dbp_loan_balance.toLocaleString()}). Verify IRC §72(p) collateral compliance.`,
          field_reference: 'dbp_and_retirement.dbp_collateral_requirement',
          target_tab: 'dbp',
        });
      }
    }

    // Multi-State & Residency Consistency
    if (setup.multi_state_active) {
      const partYearStates = comp.state_filings_out.filter(
        (s) => s.residency_status === 'part_year_resident'
      );

      if (setup.residency_change_active && partYearStates.length > 0) {
        const ratioSum = partYearStates.reduce(
          (acc, s) => acc + s.residency_day_or_income_ratio,
          0
        );
        if (Math.abs(ratioSum - 1) > 0.03) {
          issues.push({
            id: `residency-ratio-sum-${yr.tax_year}`,
            tax_year: yr.tax_year,
            category: 'multi_state',
            severity: 'warning',
            title: `Part-year residency allocation does not equal 100% (${yr.tax_year})`,
            message: `Part-year residency ratios sum to ${(ratioSum * 100).toFixed(1)}% across ${partYearStates.map((s) => s.state_code).join(', ')}. Verify residency dates and allocation ratios.`,
            field_reference: 'state_filings.residency_day_or_income_ratio',
            target_tab: 'multistate',
          });
        }

        for (const sf of partYearStates) {
          const days = daysBetweenInclusive(sf.residency_start_date, sf.residency_end_date);
          if (days !== null) {
            const expectedRatio = days / 365;
            if (Math.abs(expectedRatio - sf.residency_day_or_income_ratio) > 0.12) {
              issues.push({
                id: `residency-date-mismatch-${yr.tax_year}-${sf.state_code}`,
                tax_year: yr.tax_year,
                category: 'multi_state',
                severity: 'warning',
                title: `${sf.state_code} residency dates vs. ratio mismatch (${yr.tax_year})`,
                message: `Dates (${sf.residency_start_date} to ${sf.residency_end_date}, ${days} days ≈ ${(expectedRatio * 100).toFixed(0)}%) diverge from residency_day_or_income_ratio (${(sf.residency_day_or_income_ratio * 100).toFixed(0)}%). Confirm income-based allocation if intentional.`,
                field_reference: `state_filings[${sf.state_code}].residency_start_date`,
                target_tab: 'multistate',
              });
            }
          }
        }
      }

      for (const sf of comp.state_filings_out) {
        if (
          sf.credit_for_taxes_paid_to_other_states > sf.other_state_tax_credit_limitation &&
          sf.other_state_tax_credit_limitation > 0
        ) {
          issues.push({
            id: `ostc-limit-${yr.tax_year}-${sf.state_code}`,
            tax_year: yr.tax_year,
            category: 'multi_state',
            severity: 'error',
            title: `${sf.state_code} other-state tax credit exceeds limitation (${yr.tax_year})`,
            message: `Claimed credit ($${sf.credit_for_taxes_paid_to_other_states.toLocaleString()}) exceeds statutory limitation ($${sf.other_state_tax_credit_limitation.toLocaleString()}).`,
            field_reference: `state_filings[${sf.state_code}].credit_for_taxes_paid_to_other_states`,
            target_tab: 'multistate',
          });
        }
      }
    }
  }

  return issues;
}
