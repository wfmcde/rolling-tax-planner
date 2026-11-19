import sampleBaseline from '../../data/sample-baseline.json';
import type {
  DbpStatus,
  PlannerState,
  ResidencyStatus,
  SetupConfig,
  StateFilingInputs,
  TaxYearRecord,
} from '../types/tax';

function round0(n: number): number {
  return Math.round(n);
}

/**
 * Generates a single forecast year derived from the prior year record
 * using Module 3 §2 projection rules (growth assumptions + scheduled DBP/residency events).
 */
export function projectNextYear(
  prior: TaxYearRecord,
  nextTaxYear: number,
  setup: SetupConfig
): TaxYearRecord {
  const { revenue_growth_rate, wage_growth_rate, investment_growth_rate, inflation_rate } =
    setup.assumptions;

  const nextRevenue = round0(prior.scorp_1120s.gross_receipts_revenue * (1 + revenue_growth_rate));
  const nextOpEx = round0(prior.scorp_1120s.operating_expenses * (1 + inflation_rate));
  const nextOfficerW2 = round0(prior.scorp_1120s.officer_w2_wages * (1 + wage_growth_rate));
  const nextDistributions = round0(
    prior.scorp_1120s.scorp_distributions_total * (1 + revenue_growth_rate * 0.8)
  );

  // DBP lifecycle transition based on dbp_target_termination_year
  const targetTerm = prior.dbp_and_retirement.dbp_target_termination_year;
  let nextDbpStatus: DbpStatus = prior.dbp_and_retirement.dbp_status;
  let nextDbpContrib = prior.dbp_and_retirement.dbp_actual_contribution;
  let nextRollover = 0;

  if (setup.has_dbp) {
    if (nextTaxYear < targetTerm) {
      nextDbpStatus = 'active';
      nextDbpContrib = round0(
        Math.min(
          prior.dbp_and_retirement.dbp_max_deductible_contribution * (1 + inflation_rate),
          prior.dbp_and_retirement.dbp_actual_contribution * (1 + inflation_rate)
        )
      );
    } else if (nextTaxYear === targetTerm) {
      nextDbpStatus = 'terminating';
      nextDbpContrib = round0(prior.dbp_and_retirement.dbp_actual_contribution * 0.5);
      nextRollover = 480000;
    } else {
      nextDbpStatus = 'terminated';
      nextDbpContrib = 0;
      nextRollover = 0;
    }
  }

  // Social Security starts automatically at age 67 if not yet claiming
  const primaryAge = nextTaxYear - setup.primary_birth_year;
  const spouseAge = setup.spouse_birth_year ? nextTaxYear - setup.spouse_birth_year : null;
  const projectedSS =
    prior.form_1040.social_security_gross > 0
      ? round0(prior.form_1040.social_security_gross * (1 + inflation_rate))
      : (primaryAge >= 67 ? 38400 : 0) + (spouseAge !== null && spouseAge >= 67 ? 24600 : 0);

  // State filings rollforward: after a part-year move year (2025), Year 2+ stabilizes to full-year AZ resident + CA non-resident sourcing
  const nextStates: StateFilingInputs[] = prior.state_filings.map((sf) => {
    const isPriorMoveYear =
      setup.residency_change_active && sf.residency_status === 'part_year_resident';
    let nextStatus: ResidencyStatus = sf.residency_status;
    let startDate = `${nextTaxYear}-01-01`;
    let endDate = `${nextTaxYear}-12-31`;
    let dayRatio = sf.residency_day_or_income_ratio;
    let returnType = sf.state_return_type;

    if (isPriorMoveYear) {
      if (sf.state_code === 'AZ') {
        nextStatus = 'resident';
        dayRatio = 1.0;
        returnType = 'AZ Form 140 (Full-Year Resident) + AZ 120S';
      } else {
        nextStatus = 'non_resident';
        dayRatio = 0;
        returnType = `${sf.state_code} Non-Resident Personal + State S-Corp`;
      }
    }

    return {
      ...sf,
      residency_status: nextStatus,
      residency_start_date: startDate,
      residency_end_date: endDate,
      residency_day_or_income_ratio: dayRatio,
      state_return_type: returnType,
      state_pte_elected: setup.has_pte && sf.state_pte_elected,
      state_tax_withholding_and_estimates: round0(
        sf.state_tax_withholding_and_estimates * (1 + revenue_growth_rate * 0.5)
      ),
    };
  });

  return {
    tax_year: nextTaxYear,
    record_mode: 'forecast',
    is_locked_actuals: false,
    form_1040: {
      w2_wages_total: nextOfficerW2,
      taxable_interest: round0(prior.form_1040.taxable_interest * (1 + investment_growth_rate)),
      tax_exempt_interest: round0(
        prior.form_1040.tax_exempt_interest * (1 + investment_growth_rate)
      ),
      ordinary_dividends: round0(
        prior.form_1040.ordinary_dividends * (1 + investment_growth_rate)
      ),
      qualified_dividends: round0(
        prior.form_1040.qualified_dividends * (1 + investment_growth_rate)
      ),
      short_term_capital_gain_loss: prior.form_1040.short_term_capital_gain_loss,
      long_term_capital_gain_loss: round0(
        prior.form_1040.long_term_capital_gain_loss * (1 + investment_growth_rate)
      ),
      schedule_1_other_income: prior.form_1040.schedule_1_other_income,
      schedule_k1_ordinary_income: prior.form_1040.schedule_k1_ordinary_income,
      schedule_k1_other_items: prior.form_1040.schedule_k1_other_items,
      ira_distributions_gross: prior.form_1040.ira_distributions_gross,
      ira_distributions_taxable: prior.form_1040.ira_distributions_taxable,
      pensions_and_annuities_gross: prior.form_1040.pensions_and_annuities_gross,
      pensions_and_annuities_taxable: prior.form_1040.pensions_and_annuities_taxable,
      social_security_gross: projectedSS,
      health_insurance_premiums: round0(
        prior.form_1040.health_insurance_premiums * (1 + inflation_rate + 0.025)
      ),
      itemized_deductions_input: round0(
        prior.form_1040.itemized_deductions_input * (1 + inflation_rate)
      ),
      deduction_method: prior.form_1040.deduction_method,
    },
    scorp_1120s: {
      entity_id: prior.scorp_1120s.entity_id,
      entity_name: prior.scorp_1120s.entity_name,
      gross_receipts_revenue: nextRevenue,
      operating_expenses: nextOpEx,
      officer_w2_wages: nextOfficerW2,
      scorp_distributions_total: nextDistributions,
      stock_basis_beginning: prior.scorp_1120s.stock_basis_beginning,
      aaa_balance_beginning: prior.scorp_1120s.aaa_balance_beginning,
      state_sourcing_breakdown: prior.scorp_1120s.state_sourcing_breakdown.map((s) => ({
        ...s,
      })),
      pte_election_active: setup.has_pte,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      ...prior.dbp_and_retirement,
      dbp_status: nextDbpStatus,
      dbp_max_deductible_contribution:
        nextDbpStatus === 'terminated'
          ? 0
          : round0(
              prior.dbp_and_retirement.dbp_max_deductible_contribution * (1 + inflation_rate)
            ),
      dbp_actual_contribution: nextDbpContrib,
      dbp_loan_balance:
        nextDbpStatus === 'terminated'
          ? 0
          : Math.max(0, prior.dbp_and_retirement.dbp_loan_balance - 5000),
      qualified_plan_contribution: setup.has_401k_or_ira
        ? round0(prior.dbp_and_retirement.qualified_plan_contribution * (1 + inflation_rate))
        : 0,
      rollover_amount: nextRollover,
      rollover_source_type: nextRollover > 0 ? 'Defined Benefit Plan Termination' : 'None',
    },
    state_filings: nextStates,
  };
}

/**
 * Hydrates the full 6-year PlannerState directly from /data/sample-baseline.json.
 */
export function createInitialBaselineState(): PlannerState {
  const rawSetup = sampleBaseline.setup;
  const rawYear1 = sampleBaseline.years[0];

  const setup: SetupConfig = {
    filing_status: rawSetup.filing_status as SetupConfig['filing_status'],
    primary_birth_year: rawSetup.primary_birth_year,
    spouse_birth_year: rawSetup.spouse_birth_year,
    entity_type: rawSetup.has_scorp ? 'scorp_llc' : 'none',
    has_scorp: rawSetup.has_scorp,
    has_dbp: rawSetup.has_dbp,
    has_401k_or_ira: rawSetup.has_401k_or_ira,
    has_annuity: rawSetup.has_annuity,
    has_pte: rawSetup.has_pte,
    multi_state_active: rawSetup.multi_state_active,
    residency_change_active: rawSetup.residency_change_active,
    anchor_actuals_year: rawSetup.anchor_actuals_year,
    forecast_length: rawSetup.forecast_length,
    forecast_years: [...rawSetup.forecast_years],
    assumptions: {
      inflation_rate: 0.025,
      revenue_growth_rate: 0.04,
      wage_growth_rate: 0.025,
      investment_growth_rate: 0.035,
      expense_ratio: 0.22,
    },
  };

  // Populate Year 1 (2025) anchoring exactly to sample-baseline.json
  const year1: TaxYearRecord = {
    tax_year: rawYear1.tax_year,
    record_mode: 'actuals',
    is_locked_actuals: rawYear1.is_locked_actuals,
    form_1040: {
      w2_wages_total: rawYear1.form_1040.w2_wages_total,
      taxable_interest: 4200,
      tax_exempt_interest: 1800,
      ordinary_dividends: 8600,
      qualified_dividends: 6900,
      short_term_capital_gain_loss: 0,
      long_term_capital_gain_loss: 6400,
      schedule_1_other_income: 0,
      schedule_k1_ordinary_income: rawYear1.form_1040.schedule_k1_ordinary_income,
      schedule_k1_other_items: 0,
      ira_distributions_gross: 0,
      ira_distributions_taxable: 0,
      pensions_and_annuities_gross: 0,
      pensions_and_annuities_taxable: 0,
      social_security_gross: 0,
      health_insurance_premiums: 16400,
      itemized_deductions_input: 24200,
      deduction_method: rawYear1.form_1040.deduction_method as 'standard' | 'itemized',
      locked_taxable_income_override: rawYear1.form_1040.taxable_income,
    },
    scorp_1120s: {
      entity_id: 'oss-llc-1120s',
      entity_name: rawYear1.scorp_1120s.entity_name,
      gross_receipts_revenue: 428000,
      operating_expenses: 81000,
      officer_w2_wages: rawYear1.scorp_1120s.officer_w2_wages,
      scorp_distributions_total: rawYear1.scorp_1120s.scorp_distributions_total,
      stock_basis_beginning: 105000,
      aaa_balance_beginning: 92000,
      state_sourcing_breakdown: rawYear1.state_filings.map((sf) => ({
        state_code: sf.state_code,
        apportionment_percent: Math.round(sf.state_apportionment_factor * 100),
      })),
      pte_election_active: rawSetup.has_pte,
      auto_sync_k1: true,
      locked_ordinary_income_override: rawYear1.form_1040.schedule_k1_ordinary_income,
      locked_stock_basis_ending_override: rawYear1.scorp_1120s.stock_basis_ending,
    },
    dbp_and_retirement: {
      dbp_plan_id: 'dbp-oss-001',
      dbp_status: rawYear1.dbp_and_retirement.dbp_status as DbpStatus,
      dbp_max_deductible_contribution: 62000,
      dbp_actual_contribution: rawYear1.dbp_and_retirement.dbp_actual_contribution,
      dbp_target_termination_year: rawYear1.dbp_and_retirement.dbp_target_termination_year,
      dbp_rollover_target_account: 'Traditional IRA Rollover',
      dbp_loan_balance: 0,
      dbp_collateral_requirement: 0,
      qualified_plan_contribution: 23500,
      rollover_amount: 0,
      rollover_source_type: 'None',
      annuity_contract_value: 0,
      annuity_payout_amount: 0,
    },
    state_filings: rawYear1.state_filings.map((sf) => ({
      state_code: sf.state_code,
      residency_status: sf.residency_status as ResidencyStatus,
      residency_start_date: sf.state_code === 'CA' ? '2025-01-01' : '2025-05-09',
      residency_end_date: sf.state_code === 'CA' ? '2025-05-08' : '2025-12-31',
      residency_day_or_income_ratio: sf.state_apportionment_factor,
      state_return_type:
        sf.state_code === 'AZ'
          ? 'AZ Form 140PY (Part-Year) + AZ 120S'
          : 'CA Form 540NR (Part-Year) + CA 100S',
      state_apportionment_factor: sf.state_apportionment_factor,
      state_pte_elected: rawSetup.has_pte,
      other_state_credits_claimed: 0,
      state_tax_withholding_and_estimates: sf.state_code === 'AZ' ? 3600 : 4800,
    })),
  };

  const years: TaxYearRecord[] = [year1];
  for (let i = 1; i < setup.forecast_years.length; i++) {
    const nextYearNum = setup.forecast_years[i];
    years.push(projectNextYear(years[i - 1], nextYearNum, setup));
  }

  return {
    setup,
    years,
    archived_years: [],
  };
}

/**
 * Annual Rolling Forward Workflow (Module 3 §4):
 * 1. Archive oldest actuals (Year 1)
 * 2. Promote prior Year 2 to Year 1 actuals (reconciled & locked)
 * 3. Shift Years 3–6 to Years 2–5 and append a new Year 6 forecast slot
 */
export function rollWindowForward(
  state: PlannerState,
  reconciledYear1Overrides: {
    w2_wages_total: number;
    schedule_k1_ordinary_income: number;
    taxable_income: number;
    officer_w2_wages: number;
    scorp_distributions_total: number;
    dbp_actual_contribution: number;
  },
  priorYear1Summary: {
    adjusted_gross_income: number;
    taxable_income: number;
    federal_income_tax: number;
    total_state_tax: number;
    effective_tax_rate: number;
  }
): PlannerState {
  const [retiringYear1, promotingYear2, ...remainingForecast] = state.years;

  const archived = {
    tax_year: retiringYear1.tax_year,
    archived_at: new Date().toISOString().slice(0, 10),
    record: retiringYear1,
    summary: priorYear1Summary,
  };

  const newYear1: TaxYearRecord = {
    ...promotingYear2,
    record_mode: 'actuals',
    is_locked_actuals: true,
    amended_unlock_reason: undefined,
    form_1040: {
      ...promotingYear2.form_1040,
      w2_wages_total: reconciledYear1Overrides.w2_wages_total,
      schedule_k1_ordinary_income: reconciledYear1Overrides.schedule_k1_ordinary_income,
      locked_taxable_income_override: reconciledYear1Overrides.taxable_income,
    },
    scorp_1120s: {
      ...promotingYear2.scorp_1120s,
      officer_w2_wages: reconciledYear1Overrides.officer_w2_wages,
      scorp_distributions_total: reconciledYear1Overrides.scorp_distributions_total,
      locked_ordinary_income_override: reconciledYear1Overrides.schedule_k1_ordinary_income,
    },
    dbp_and_retirement: {
      ...promotingYear2.dbp_and_retirement,
      dbp_actual_contribution: reconciledYear1Overrides.dbp_actual_contribution,
    },
  };

  const lastExisting = remainingForecast[remainingForecast.length - 1];
  const newYear6Num = lastExisting.tax_year + 1;
  const newYear6 = projectNextYear(lastExisting, newYear6Num, state.setup);

  const nextYears = [newYear1, ...remainingForecast, newYear6];
  const nextSetup: SetupConfig = {
    ...state.setup,
    anchor_actuals_year: newYear1.tax_year,
    forecast_years: nextYears.map((y) => y.tax_year),
  };

  return {
    setup: nextSetup,
    years: nextYears,
    archived_years: [archived, ...state.archived_years],
  };
}
