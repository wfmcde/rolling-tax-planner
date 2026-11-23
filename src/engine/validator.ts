import type {
  ComputedTaxYear,
  GuardrailAckStatus,
  SetupConfig,
  TaxYearRecord,
  ValidationIssue,
} from '../types/tax';

export const GUARDRAIL_ACK_STATUS_OPTIONS: {
  value: GuardrailAckStatus;
  label: string;
}[] = [
  { value: 'prior_year_historical', label: 'Prior-Year / Historical' },
  { value: 'intentional_cpa_reviewed', label: 'Intentional / CPA Reviewed' },
  { value: 'mitigation_planned', label: 'Mitigation Planned' },
];

export function getGuardrailAckStatusLabel(status: GuardrailAckStatus): string {
  return (
    GUARDRAIL_ACK_STATUS_OPTIONS.find((opt) => opt.value === status)?.label ??
    'Intentional / CPA Reviewed'
  );
}

export function buildGuardrailAckKey(ruleId: string, taxYear: number | null): string {
  return `${ruleId}:${taxYear ?? 'global'}`;
}

/**
 * Canonical officer W-2 to (officer W-2 + Ordinary Business Income) ratio.
 * Stored to 4 decimal places (0.01 percentage points) so 1-decimal percentage
 * displays across the tax engine, guardrails, S-Corp schedule, and CPA Print
 * Package are always identical.
 */
export function computeReasonableCompRatio(
  officerW2: number,
  ordinaryBusinessIncome: number
): number {
  const safeW2 = Math.max(0, Number.isFinite(officerW2) ? officerW2 : 0);
  const safeObi = Math.max(0, Number.isFinite(ordinaryBusinessIncome) ? ordinaryBusinessIncome : 0);
  const denom = safeW2 + safeObi;
  if (denom <= 0) return 0;
  return Math.round((safeW2 / denom) * 10000) / 10000;
}

export function formatReasonableCompPercent(
  officerW2: number,
  ordinaryBusinessIncome: number
): string {
  const ratio = computeReasonableCompRatio(officerW2, ordinaryBusinessIncome);
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatReasonableCompFindingMessage(
  officerW2: number,
  ordinaryBusinessIncome: number
): string {
  const safeW2 = Math.max(0, Math.round(Number.isFinite(officerW2) ? officerW2 : 0));
  const safeObi = Math.max(
    0,
    Math.round(Number.isFinite(ordinaryBusinessIncome) ? ordinaryBusinessIncome : 0)
  );
  const combined = safeW2 + safeObi;
  const pct = formatReasonableCompPercent(safeW2, safeObi);
  return `Officer W-2 wages ($${safeW2.toLocaleString()}) represent ${pct} of combined officer compensation + ordinary business income ($${combined.toLocaleString()}). Review IRS S-Corp reasonable compensation benchmarks.`;
}

export function formatReasonableCompExplanationSummary(
  officerW2: number,
  ordinaryBusinessIncome: number,
  basisLabel?: string
): string {
  const safeW2 = Math.max(0, Math.round(Number.isFinite(officerW2) ? officerW2 : 0));
  const safeObi = Math.max(
    0,
    Math.round(Number.isFinite(ordinaryBusinessIncome) ? ordinaryBusinessIncome : 0)
  );
  const combined = safeW2 + safeObi;
  const pct = formatReasonableCompPercent(safeW2, safeObi);
  const prefix = basisLabel ? `Computed Ratio (${basisLabel})` : 'Computed Ratio';
  return `${prefix}: ${pct} ($${safeW2.toLocaleString()} officer W-2 ÷ $${combined.toLocaleString()} [W-2 + $${safeObi.toLocaleString()} OBI]).`;
}

/**
 * Keeps any saved user explanation note synchronized with the live officer W-2 / (W-2 + OBI)
 * ratio if the note explicitly referenced the prior snapshot's ratio percentage, while leaving
 * unrelated percentages (e.g., 30% IRS benchmark or ownership shares) untouched.
 */
export function syncReasonableCompNoteText(
  note: string,
  priorFindingMessage: string | undefined,
  officerW2: number,
  ordinaryBusinessIncome: number
): string {
  if (!note) return note;
  const livePct = formatReasonableCompPercent(officerW2, ordinaryBusinessIncome);
  let synced = note;

  // 1. If the stored snapshot finding message captured an older ratio (e.g., "represent 25.0%"),
  // update exact references to that stale ratio in the explanation note.
  const priorMatch = priorFindingMessage?.match(/represent\s+(\d+(?:\.\d+)?)%/i);
  if (priorMatch) {
    const staleNumStr = priorMatch[1];
    const staleNum = Number(staleNumStr);
    const stalePct = `${staleNumStr}%`;
    if (Number.isFinite(staleNum) && stalePct !== livePct && Math.abs(staleNum - 30) > 0.05) {
      const escapedExact = staleNumStr.replace('.', '\\.');
      synced = synced.replace(new RegExp(`(?<!\\d)${escapedExact}%`, 'g'), livePct);

      // If the prior snapshot was an integer-like percentage (e.g., "25.0%"), also update
      // integer mentions ("25%") ONLY when directly tied to ratio/comp/W-2 phrasing.
      if (/\.0$/.test(staleNumStr)) {
        const intPart = staleNumStr.replace(/\.0$/, '');
        synced = synced.replace(
          new RegExp(
            `(?<!\\d)${intPart}%(?=\\s*(?:ratio|comp|compensation|w-?2|of\\s+(?:combined|w-?2|total)))`,
            'gi'
          ),
          livePct
        );
        synced = synced.replace(
          new RegExp(
            `((?:ratio|comp(?:ensation)?|w-?2)\\s*(?:of|at|is|:|=)?\\s*)${intPart}%(?!\\s*(?:profit|401|match|benchmark|threshold))`,
            'gi'
          ),
          `$1${livePct}`
        );
      }
    }
  }

  // 2. Also update explicit ratio-context phrases like "ratio of 25.4%" or "25.4% of W-2 + OBI"
  // when they diverge from the live computed ratio (excluding explicit 30% benchmark mentions).
  synced = synced.replace(
    /(\b(?:reasonable\s+comp(?:ensation)?\s+ratio|comp(?:ensation)?\s+ratio|w-?2\s+ratio|officer\s+w-?2\s+ratio)\s*(?:of|at|is|:|=)\s*)(\d+(?:\.\d+)?)%/gi,
    (full, prefix: string, numStr: string) => {
      const val = Number(numStr);
      if (Math.abs(val - 30) <= 0.05) return full;
      return `${prefix}${livePct}`;
    }
  );
  synced = synced.replace(
    /(?<!\d)(\d+(?:\.\d+)?)%(\s+of\s+(?:combined\s+)?(?:officer\s+)?(?:w-?2|comp(?:ensation)?)\s*(?:\+|plus|and)\s*(?:obi|ordinary\s+business\s+income|k-?1))/gi,
    (full, numStr: string, suffix: string) => {
      const val = Number(numStr);
      if (Math.abs(val - 30) <= 0.05) return full;
      return `${livePct}${suffix}`;
    }
  );

  return synced;
}

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
 * Every finding receives a stable `rule_id` and per-year `ack_key` (`${rule_id}:${tax_year ?? 'global'}`).
 */
export function runGuardrailValidation(
  setup: SetupConfig,
  years: TaxYearRecord[],
  computed: ComputedTaxYear[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const pushIssue = (
    rule_id: string,
    tax_year: number | null,
    rest: Omit<ValidationIssue, 'id' | 'rule_id' | 'ack_key' | 'tax_year'>
  ) => {
    const ack_key = buildGuardrailAckKey(rule_id, tax_year);
    issues.push({
      id: ack_key,
      rule_id,
      ack_key,
      tax_year,
      ...rest,
    });
  };

  if (years.length !== 6) {
    pushIssue('horizon_length', null, {
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
    pushIssue('year1_lock_unlocked', year1.tax_year, {
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
      const officerW2 = comp.scorp_in.officer_w2_wages;
      const obi = comp.scorp_out.ordinary_business_income_1120s;
      const liveRatio = computeReasonableCompRatio(officerW2, obi);

      if (obi > 0 && officerW2 <= 0) {
        pushIssue('scorp_missing_officer_w2', yr.tax_year, {
          category: 'scorp_comp',
          severity: 'error',
          title: `Missing officer W-2 wages (${yr.tax_year})`,
          message: `Ordinary business income is $${obi.toLocaleString()} with $0 officer_w2_wages. IRS reasonable compensation rules require officer W-2 wages when taking S-Corp distributions.`,
          field_reference: 'scorp_1120s.officer_w2_wages',
          target_tab: 'scorp',
        });
      } else if (obi > 50000 && liveRatio < 0.3) {
        const ratioPercent = formatReasonableCompPercent(officerW2, obi);
        pushIssue('low_reasonable_comp', yr.tax_year, {
          category: 'scorp_comp',
          severity: 'warning',
          title: `Low reasonable compensation ratio (${yr.tax_year})`,
          message: formatReasonableCompFindingMessage(officerW2, obi),
          field_reference: 'scorp_1120s.officer_w2_wages',
          target_tab: 'scorp',
          reasonable_comp_meta: {
            officer_w2: Math.max(0, Math.round(officerW2)),
            ordinary_business_income: Math.max(0, Math.round(obi)),
            ratio: liveRatio,
            ratio_percent: ratioPercent,
          },
        });
      }

      if (comp.scorp_out.excess_distribution_capital_gain > 0) {
        pushIssue('scorp_basis_excess', yr.tax_year, {
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
        pushIssue('scorp_sourcing_sum', yr.tax_year, {
          category: 'scorp_comp',
          severity: 'warning',
          title: `Multi-state apportionment ratios sum to ${sourcingSum.toFixed(2)}% (${yr.tax_year})`,
          message: `state_sourcing_breakdown sums to ${sourcingSum.toFixed(2)}% across active states. This can occur when states apply different statutory apportionment formulas (e.g., single-sales-factor vs. three-factor schedules).`,
          field_reference: 'scorp_1120s.state_sourcing_breakdown',
          target_tab: 'scorp',
        });
      }
    }

    // DBP & Retirement Milestones
    if (setup.has_dbp) {
      const dbp = yr.dbp_and_retirement;
      if (dbp.dbp_actual_contribution > dbp.dbp_max_deductible_contribution) {
        pushIssue('dbp_over_max', yr.tax_year, {
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
        pushIssue('dbp_post_termination', yr.tax_year, {
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
        pushIssue('dbp_loan_winddown', yr.tax_year, {
          category: 'dbp_retirement',
          severity: 'warning',
          title: `Outstanding DBP participant loan during wind-down (${yr.tax_year})`,
          message: `dbp_loan_balance is $${dbp.dbp_loan_balance.toLocaleString()} while plan status is "${dbp.dbp_status}". Unrepaid loans upon termination are treated as taxable deemed distributions.`,
          field_reference: 'dbp_and_retirement.dbp_loan_balance',
          target_tab: 'dbp',
        });
      }

      if (dbp.dbp_loan_balance > 0 && dbp.dbp_collateral_requirement < dbp.dbp_loan_balance) {
        pushIssue('dbp_loan_collateral', yr.tax_year, {
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
          pushIssue('residency_ratio_sum', yr.tax_year, {
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
              pushIssue(`residency_date_mismatch_${sf.state_code}`, yr.tax_year, {
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
          pushIssue(`ostc_limit_${sf.state_code}`, yr.tax_year, {
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
