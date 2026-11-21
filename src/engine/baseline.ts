import sampleBaseline from '../../data/sample-baseline.json';
import type {
  DbpStatus,
  PlannerState,
  ResidencyStatus,
  SetupConfig,
  StateFilingInputs,
  TaxYearRecord,
} from '../types/tax';
import { createDefaultPersonProfile, parseBirthDate } from '../utils/personTax';
import {
  ALL_SCHEDULE_ITEM_IDS,
  sanitizeHiddenItemIds,
} from './scheduleCatalog';
import {
  createInitialPnlBalanceSheetState,
  normalizePnlBalanceSheetState,
} from './pnlBalanceSheet';

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
  const {
    revenue_growth_rate,
    wage_growth_rate,
    investment_growth_rate,
    inflation_rate,
    medicare_inflation_rate,
  } = setup.assumptions;
  const medRate = medicare_inflation_rate ?? 0.055;

  const nextCaRevenue = round0(prior.scorp_1120s.ca_revenue * (1 + revenue_growth_rate));
  const nextAzRevenue = round0(prior.scorp_1120s.az_revenue * (1 + revenue_growth_rate));
  const nextRevenue = nextCaRevenue + nextAzRevenue;
  const nextCaApp = nextRevenue > 0 ? nextCaRevenue / nextRevenue : 0;
  const nextAzApp = nextRevenue > 0 ? nextAzRevenue / nextRevenue : 0;
  const nextOpEx = round0(prior.scorp_1120s.operating_expenses * (1 + inflation_rate));
  const nextDebraW2 = round0(prior.scorp_1120s.debra_w2_wages * (1 + wage_growth_rate));
  const nextBillW2 = round0(prior.scorp_1120s.bill_w2_wages * (1 + wage_growth_rate));
  const nextOfficerW2 = nextDebraW2 + nextBillW2;

  // When transitioning from a locked actuals year with excess draws, reset forecast draws to ~85% of K-1 profit
  const baseDrawsForProjection =
    prior.is_locked_actuals &&
    prior.form_1040.schedule_k1_ordinary_income > 0 &&
    prior.scorp_1120s.scorp_distributions_total > prior.form_1040.schedule_k1_ordinary_income
      ? round0(Math.max(0, prior.form_1040.schedule_k1_ordinary_income) * 0.85)
      : prior.scorp_1120s.scorp_distributions_total;
  const nextDistributions = round0(baseDrawsForProjection * (1 + revenue_growth_rate * 0.8));

  // DBP lifecycle transition based on Setup dbp_planned_termination_year (null means "None")
  const targetTerm = setup.dbp_planned_termination_year;
  let nextDbpStatus: DbpStatus = prior.dbp_and_retirement.dbp_status;
  let nextDbpContrib = prior.dbp_and_retirement.dbp_actual_contribution;
  let nextRollover = 0;

  if (setup.has_dbp) {
    if (targetTerm === null || nextTaxYear < targetTerm) {
      nextDbpStatus = 'active';
      const baseContrib =
        prior.dbp_and_retirement.dbp_actual_contribution > 0
          ? prior.dbp_and_retirement.dbp_actual_contribution
          : 140000;
      const baseMax =
        prior.dbp_and_retirement.dbp_max_deductible_contribution > 0
          ? prior.dbp_and_retirement.dbp_max_deductible_contribution
          : 140000;
      nextDbpContrib = round0(
        Math.min(baseMax * (1 + inflation_rate), baseContrib * (1 + inflation_rate))
      );
    } else if (nextTaxYear === targetTerm) {
      nextDbpStatus = 'terminating';
      const baseContrib =
        prior.dbp_and_retirement.dbp_actual_contribution > 0
          ? prior.dbp_and_retirement.dbp_actual_contribution
          : 140000;
      nextDbpContrib = round0(baseContrib * 0.5);
      nextRollover = 480000;
    } else {
      nextDbpStatus = 'terminated';
      nextDbpContrib = 0;
      nextRollover = 0;
    }
  } else {
    nextDbpStatus = 'terminated';
    nextDbpContrib = 0;
  }

  // State filings & residency schedule:
  // - 2025: Full-year CA Resident (Form 540) + AZ Nonresident (Form 140NR w/ CA OSTC)
  // - 2026: Part-year CA Resident thru June 19 (170/365) + Part-year WA Resident starting June 20 (195/365, 0% tax) + AZ Nonresident
  // - 2027-2030+: Full-year WA Resident (0% tax) + CA Nonresident (540NR CA-sourced K-1 only) + AZ Nonresident (140NR 2.5% AZ-sourced K-1, no CA OSTC)
  const priorCa = prior.state_filings.find((s) => s.state_code === 'CA');
  const priorAz = prior.state_filings.find((s) => s.state_code === 'AZ');
  const nextStates: StateFilingInputs[] = [];

  if (setup.residency_change_active && nextTaxYear === 2026) {
    nextStates.push(
      {
        state_code: 'CA',
        residency_status: 'part_year_resident',
        residency_start_date: '2026-01-01',
        residency_end_date: '2026-06-19',
        residency_day_or_income_ratio: Number((170 / 365).toFixed(6)),
        state_return_type: 'CA Form 540NR (Part-Year thru Jun 19) + CA 100S',
        state_apportionment_factor: nextCaApp,
        state_pte_elected: setup.has_pte && Boolean(priorCa?.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: 'WA',
        residency_status: 'part_year_resident',
        residency_start_date: '2026-06-20',
        residency_end_date: '2026-12-31',
        residency_day_or_income_ratio: Number((195 / 365).toFixed(6)),
        state_return_type: 'WA Part-Year Resident (from Jun 20 · 0% Personal Tax)',
        state_apportionment_factor: 0,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: 'AZ',
        residency_status: 'non_resident',
        residency_start_date: '2026-01-01',
        residency_end_date: '2026-12-31',
        residency_day_or_income_ratio: 0,
        state_return_type: 'AZ Form 140NR (Non-Resident) + AZ 120S',
        state_apportionment_factor: nextAzApp,
        state_pte_elected: setup.has_pte && Boolean(priorAz?.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      }
    );
  } else if (setup.residency_change_active && nextTaxYear >= 2027) {
    nextStates.push(
      {
        state_code: 'WA',
        residency_status: 'resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 1.0,
        state_return_type: 'WA Full-Year Resident (0% Personal Income Tax)',
        state_apportionment_factor: 0,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: 'CA',
        residency_status: 'non_resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 0,
        state_return_type: 'CA Form 540NR (Non-Resident · CA-Sourced K-1) + CA 100S',
        state_apportionment_factor: nextCaApp,
        state_pte_elected: setup.has_pte && Boolean(priorCa?.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
      {
        state_code: 'AZ',
        residency_status: 'non_resident',
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        residency_day_or_income_ratio: 0,
        state_return_type: 'AZ Form 140NR (Non-Resident · 2.5% AZ-Sourced K-1) + AZ 120S',
        state_apportionment_factor: nextAzApp,
        state_pte_elected: setup.has_pte && Boolean(priorAz?.state_pte_elected),
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      }
    );
  } else {
    for (const sf of prior.state_filings) {
      const appFactor =
        sf.state_code === 'CA'
          ? nextCaApp
          : sf.state_code === 'AZ'
          ? nextAzApp
          : sf.state_apportionment_factor;
      nextStates.push({
        ...sf,
        residency_start_date: `${nextTaxYear}-01-01`,
        residency_end_date: `${nextTaxYear}-12-31`,
        state_apportionment_factor: appFactor,
        state_pte_elected: setup.has_pte && sf.state_pte_elected,
        state_tax_withholding_and_estimates: round0(
          sf.state_tax_withholding_and_estimates * (1 + revenue_growth_rate * 0.5)
        ),
      });
    }
  }

  return {
    tax_year: nextTaxYear,
    record_mode: 'forecast',
    is_locked_actuals: false,
    form_1040: {
      w2_wages_total: nextOfficerW2,
      use_explicit_w2_box1: false,
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
      // Do not carry forward 2025 one-time excess basis gain as recurring LTCG in forecast years
      long_term_capital_gain_loss: prior.is_locked_actuals
        ? 0
        : round0(prior.form_1040.long_term_capital_gain_loss * (1 + investment_growth_rate)),
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: prior.form_1040.schedule_1_other_income,
      schedule_1_adjustments_input: 0,
      schedule_k1_ordinary_income: prior.form_1040.schedule_k1_ordinary_income,
      schedule_k1_other_items: prior.form_1040.schedule_k1_other_items,
      ira_distributions_gross: prior.form_1040.ira_distributions_gross,
      ira_distributions_taxable: prior.form_1040.ira_distributions_taxable,
      pensions_and_annuities_gross: prior.form_1040.pensions_and_annuities_gross,
      pensions_and_annuities_taxable: prior.form_1040.pensions_and_annuities_taxable,
      social_security_gross: 0,
      health_insurance_premiums:
        nextTaxYear <= setup.current_tax_year
          ? prior.form_1040.health_insurance_premiums
          : round0(prior.form_1040.health_insurance_premiums * (1 + medRate)),
      itemized_deductions_input: round0(
        prior.form_1040.itemized_deductions_input * (1 + inflation_rate)
      ),
      deduction_method: setup.deduction_method,
    },
    scorp_1120s: {
      entity_id: prior.scorp_1120s.entity_id,
      entity_name: prior.scorp_1120s.entity_name,
      entity_ein: prior.scorp_1120s.entity_ein,
      bill_ownership_pct: prior.scorp_1120s.bill_ownership_pct,
      debra_ownership_pct: prior.scorp_1120s.debra_ownership_pct,
      ca_revenue: nextCaRevenue,
      az_revenue: nextAzRevenue,
      gross_receipts_revenue: nextRevenue,
      operating_expenses: nextOpEx,
      use_detailed_1120s_deductions: false,
      debra_w2_wages: nextDebraW2,
      bill_w2_wages: nextBillW2,
      officer_w2_wages: nextOfficerW2,
      scorp_distributions_total: nextDistributions,
      capital_contributions: 0,
      stock_basis_beginning: prior.scorp_1120s.stock_basis_beginning,
      aaa_balance_beginning: prior.scorp_1120s.aaa_balance_beginning,
      state_sourcing_breakdown: [
        { state_code: 'CA', apportionment_percent: Number((nextCaApp * 100).toFixed(2)) },
        { state_code: 'AZ', apportionment_percent: Number((nextAzApp * 100).toFixed(2)) },
      ],
      pte_election_active: setup.has_pte,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      ...prior.dbp_and_retirement,
      dbp_status: nextDbpStatus,
      dbp_target_termination_year: targetTerm ?? 2099,
      dbp_max_deductible_contribution:
        nextDbpStatus === 'terminated'
          ? 0
          : round0(
              Math.max(140000, prior.dbp_and_retirement.dbp_max_deductible_contribution) *
                (1 + inflation_rate)
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
 * Hydrates the full 6-year PlannerState from /data/sample-baseline.json using
 * strictly constant inputs for 2025 so the deterministic engine computes every
 * derived total, deduction, and tax liability without hardcoded output overrides.
 */
export function createInitialBaselineState(): PlannerState {
  const rawSetup = sampleBaseline.setup;
  const rawYear1 = sampleBaseline.years[0];

  const primaryProfile = createDefaultPersonProfile('1960-05-06');
  const spouseProfile = createDefaultPersonProfile('1960-08-10');

  const setup: SetupConfig = {
    filing_status: rawSetup.filing_status as SetupConfig['filing_status'],
    primary_name: 'Bill',
    spouse_name: 'Debra',
    primary_birth_year: 1960,
    spouse_birth_year: 1960,
    primary_profile: primaryProfile,
    spouse_profile: spouseProfile,
    deduction_method: (rawYear1.form_1040.deduction_method as 'standard' | 'itemized') || 'standard',
    custom_itemized_deduction: 34700,
    entity_type: rawSetup.has_scorp ? 'scorp_llc' : 'none',
    has_scorp: rawSetup.has_scorp,
    has_dbp: rawSetup.has_dbp,
    dbp_planned_termination_year:
      rawYear1.dbp_and_retirement.dbp_target_termination_year ?? 2027,
    post_dbp_profit_sharing_rate: 0.06,
    has_401k_or_ira: rawSetup.has_401k_or_ira,
    has_annuity: rawSetup.has_annuity,
    has_pte: rawSetup.has_pte,
    multi_state_active: rawSetup.multi_state_active,
    residency_change_active: rawSetup.residency_change_active,
    anchor_actuals_year: rawSetup.anchor_actuals_year,
    current_tax_year: rawSetup.forecast_years[1] ?? 2026,
    forecast_length: rawSetup.forecast_length,
    forecast_years: [...rawSetup.forecast_years],
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      revenue_growth_rate: 0.04,
      wage_growth_rate: 0.025,
      investment_growth_rate: 0.035,
      expense_ratio: 0.164,
    },
  };

  // 2025 S-Corp Payroll: Compensation of Officers $42,000 (Bill) + Salaries & Wages $33,550 (Debra) = $75,550
  const year1BillW2 = rawYear1.scorp_1120s.compensation_of_officers; // 42000
  const year1DebraW2 = rawYear1.scorp_1120s.salaries_and_wages; // 33550
  const year1TotalW2 = year1BillW2 + year1DebraW2; // 75550

  // Non-payroll, non-pension 1120-S expenses used as baseline for 2026-2030 forecast projection:
  // Rents (35447) + FTB tax (2891) + Advertising (167) + Other Deductions (23529) = 62034
  const year1OperatingExForForecast =
    rawYear1.scorp_1120s.rents +
    rawYear1.scorp_1120s.ftb_state_taxes_input +
    rawYear1.scorp_1120s.advertising +
    rawYear1.scorp_1120s.other_deductions;

  const year1BegBasis =
    rawYear1.scorp_1120s.bill_stock_basis_beginning +
    rawYear1.scorp_1120s.debra_stock_basis_beginning; // 5615 + 5401 = 11016

  // Populate Year 1 (2025) strictly with constant inputs (NO output overrides!)
  const year1: TaxYearRecord = {
    tax_year: rawYear1.tax_year,
    record_mode: 'actuals',
    is_locked_actuals: rawYear1.is_locked_actuals,
    form_1040: {
      w2_wages_total: rawYear1.form_1040.w2_wages_total, // 14050 (Bill 11000, Debra 3050)
      bill_w2_box1: rawYear1.form_1040.bill_w2_box1,
      debra_w2_box1: rawYear1.form_1040.debra_w2_box1,
      use_explicit_w2_box1: true,
      taxable_interest: rawYear1.form_1040.taxable_interest, // 782
      tax_exempt_interest: 0,
      ordinary_dividends: rawYear1.form_1040.ordinary_dividends, // 505
      qualified_dividends: rawYear1.form_1040.qualified_dividends, // 67
      short_term_capital_gain_loss: 0,
      // Raw non-S-Corp net capital gain/loss (-$60 = $25 cap gain dist - $83 Box D loss - $2 Box E loss);
      // engine dynamically adds Form 7203 excess distribution gain (+$32,182) -> $32,122 Schedule D net gain
      long_term_capital_gain_loss: rawYear1.form_1040.long_term_capital_gain_loss, // -60
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: 0,
      schedule_1_adjustments_input: rawYear1.form_1040.schedule_1_adjustments_input, // 1631
      // Derived dynamically by engine from Form 1120-S via auto_sync_k1: true
      schedule_k1_ordinary_income: 0,
      schedule_k1_other_items: 0,
      ira_distributions_gross: rawYear1.form_1040.ira_distributions_taxable, // 12935
      ira_distributions_taxable: rawYear1.form_1040.ira_distributions_taxable,
      pensions_and_annuities_gross: rawYear1.form_1040.pensions_and_annuities_taxable, // 250
      pensions_and_annuities_taxable: rawYear1.form_1040.pensions_and_annuities_taxable,
      social_security_gross: rawYear1.form_1040.social_security_gross, // 79000 (Bill 39500 + Debra 39500)
      ss_bill_mode: (rawYear1.form_1040.ss_bill_mode as 'on' | 'suspended' | 'off') ?? 'on',
      ss_bill_override: rawYear1.form_1040.ss_bill_override ?? 39500,
      ss_debra_mode: (rawYear1.form_1040.ss_debra_mode as 'on' | 'suspended' | 'off') ?? 'on',
      ss_debra_override: rawYear1.form_1040.ss_debra_override ?? 39500,
      health_insurance_premiums: 0,
      itemized_deductions_input: 34700,
      deduction_method: rawYear1.form_1040.deduction_method as 'standard' | 'itemized',
    },
    scorp_1120s: {
      entity_id: 'oss-llc-1120s',
      entity_name: rawYear1.scorp_1120s.entity_name,
      entity_ein: rawYear1.scorp_1120s.entity_ein,
      bill_ownership_pct: rawYear1.scorp_1120s.bill_ownership_pct,
      debra_ownership_pct: rawYear1.scorp_1120s.debra_ownership_pct,
      ca_revenue: rawYear1.scorp_1120s.ca_revenue, // 136770
      az_revenue: rawYear1.scorp_1120s.az_revenue, // 242815
      gross_receipts_revenue:
        rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue, // 379585
      operating_expenses: year1OperatingExForForecast,
      use_detailed_1120s_deductions: true,
      compensation_of_officers: rawYear1.scorp_1120s.compensation_of_officers, // 42000
      salaries_and_wages: rawYear1.scorp_1120s.salaries_and_wages, // 33550
      rents: rawYear1.scorp_1120s.rents, // 35447
      payroll_taxes_input: rawYear1.scorp_1120s.payroll_taxes_input, // 6130
      ftb_state_taxes_input: rawYear1.scorp_1120s.ftb_state_taxes_input, // 2891
      advertising: rawYear1.scorp_1120s.advertising, // 167
      pension_profit_sharing_input: rawYear1.scorp_1120s.pension_profit_sharing_input, // 144540
      other_deductions: rawYear1.scorp_1120s.other_deductions, // 23529
      schedule_k_interest_income: rawYear1.scorp_1120s.schedule_k_interest_income, // 619
      schedule_k_interest_bill: rawYear1.scorp_1120s.schedule_k_interest_bill, // 316
      schedule_k_interest_debra: rawYear1.scorp_1120s.schedule_k_interest_debra, // 303
      schedule_k_nondeductible_expenses: rawYear1.scorp_1120s.schedule_k_nondeductible_expenses, // 1910
      schedule_k_nondeductible_bill: rawYear1.scorp_1120s.schedule_k_nondeductible_bill, // 975
      schedule_k_nondeductible_debra: rawYear1.scorp_1120s.schedule_k_nondeductible_debra, // 935
      debra_w2_wages: year1DebraW2,
      bill_w2_wages: year1BillW2,
      officer_w2_wages: year1TotalW2,
      scorp_distributions_total: rawYear1.scorp_1120s.scorp_distributions_total, // 135315
      bill_distributions: rawYear1.scorp_1120s.bill_distributions, // 69011
      debra_distributions: rawYear1.scorp_1120s.debra_distributions, // 66304
      capital_contributions: rawYear1.scorp_1120s.capital_contributions, // 0
      stock_basis_beginning: year1BegBasis, // 11016
      bill_stock_basis_beginning: rawYear1.scorp_1120s.bill_stock_basis_beginning, // 5615
      debra_stock_basis_beginning: rawYear1.scorp_1120s.debra_stock_basis_beginning, // 5401
      shareholder_loans_beginning: 0,
      aaa_balance_beginning: year1BegBasis,
      ca_franchise_tax_input: rawYear1.scorp_1120s.ca_franchise_tax_input, // 800
      state_sourcing_breakdown: [
        {
          state_code: 'CA',
          apportionment_percent: Number(
            (
              (rawYear1.scorp_1120s.ca_revenue /
                (rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue)) *
              100
            ).toFixed(2)
          ),
        },
        {
          state_code: 'AZ',
          apportionment_percent: Number(
            (
              (rawYear1.scorp_1120s.az_revenue /
                (rawYear1.scorp_1120s.ca_revenue + rawYear1.scorp_1120s.az_revenue)) *
              100
            ).toFixed(2)
          ),
        },
      ],
      pte_election_active: rawSetup.has_pte,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      dbp_plan_id: 'dbp-oss-001',
      dbp_status: rawYear1.dbp_and_retirement.dbp_status as DbpStatus,
      dbp_max_deductible_contribution: 140000,
      dbp_actual_contribution: rawYear1.dbp_and_retirement.dbp_actual_contribution, // 140000
      dbp_target_termination_year: rawYear1.dbp_and_retirement.dbp_target_termination_year,
      dbp_rollover_target_account: 'Traditional IRA Rollover',
      dbp_loan_balance: 0,
      dbp_collateral_requirement: 0,
      qualified_plan_contribution: 66040,
      rollover_amount: 0,
      rollover_source_type: 'None',
      annuity_contract_value: 0,
      annuity_payout_amount: 0,
    },
    state_filings: rawYear1.state_filings.map((sf) => ({
      state_code: sf.state_code,
      residency_status: sf.residency_status as ResidencyStatus,
      residency_start_date: '2025-01-01',
      residency_end_date: '2025-12-31',
      residency_day_or_income_ratio: sf.residency_status === 'resident' ? 1.0 : 0,
      state_return_type:
        sf.state_code === 'CA'
          ? 'CA Form 540 (Full-Year Resident) + CA 100S (Sch R)'
          : 'AZ Form 140NR (Non-Resident) + AZ 120S (Sch A)',
      state_apportionment_factor: sf.state_apportionment_factor,
      state_conformity_adjustment:
        'state_conformity_adjustment' in sf && typeof sf.state_conformity_adjustment === 'number'
          ? sf.state_conformity_adjustment
          : 0,
      state_pte_elected: rawSetup.has_pte,
      other_state_credits_claimed: 0,
      state_tax_withholding_and_estimates: 0,
    })),
  };

  const FORECAST_2026_2030_INPUTS: Record<
    number,
    {
      ca_revenue: number;
      az_revenue: number;
      debra_w2: number;
      bill_w2: number;
      member_draws: number;
      capital_contributions: number;
      dbp_contribution: number;
      sehi_medicare_premiums: number;
    }
  > = {
    2026: {
      ca_revenue: 169500,
      az_revenue: 169500,
      debra_w2: 29759,
      bill_w2: 29758,
      member_draws: 120000,
      capital_contributions: 15000,
      dbp_contribution: 61000,
      sehi_medicare_premiums: 9916,
    },
    2027: {
      ca_revenue: 165000,
      az_revenue: 165000,
      debra_w2: 64500,
      bill_w2: 64500,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 44000,
      sehi_medicare_premiums: 9916,
    },
    2028: {
      ca_revenue: 104500,
      az_revenue: 104500,
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
    2029: {
      ca_revenue: 104500,
      az_revenue: 104500,
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
    2030: {
      ca_revenue: 55500,
      az_revenue: 55500,
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 0,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
  };

  const years: TaxYearRecord[] = [year1];
  for (let i = 1; i < setup.forecast_years.length; i++) {
    const nextYearNum = setup.forecast_years[i];
    const projected = projectNextYear(years[i - 1], nextYearNum, setup);
    const preset = FORECAST_2026_2030_INPUTS[nextYearNum];
    if (preset) {
      const totalRev = preset.ca_revenue + preset.az_revenue;
      const caApp = totalRev > 0 ? preset.ca_revenue / totalRev : 0;
      const azApp = totalRev > 0 ? preset.az_revenue / totalRev : 0;
      const totalW2 = preset.debra_w2 + preset.bill_w2;

      years.push({
        ...projected,
        form_1040: {
          ...projected.form_1040,
          w2_wages_total: totalW2,
          health_insurance_premiums: preset.sehi_medicare_premiums,
          sehi_medicare_override: null,
        },
        scorp_1120s: {
          ...projected.scorp_1120s,
          ca_revenue: preset.ca_revenue,
          az_revenue: preset.az_revenue,
          gross_receipts_revenue: totalRev,
          debra_w2_wages: preset.debra_w2,
          bill_w2_wages: preset.bill_w2,
          officer_w2_wages: totalW2,
          scorp_distributions_total: preset.member_draws,
          capital_contributions: preset.capital_contributions,
          state_sourcing_breakdown: [
            { state_code: 'CA', apportionment_percent: Number((caApp * 100).toFixed(2)) },
            { state_code: 'AZ', apportionment_percent: Number((azApp * 100).toFixed(2)) },
          ],
        },
        dbp_and_retirement: {
          ...projected.dbp_and_retirement,
          dbp_actual_contribution: preset.dbp_contribution,
          dbp_max_deductible_contribution:
            preset.dbp_contribution > 0
              ? Math.max(
                  projected.dbp_and_retirement.dbp_max_deductible_contribution,
                  preset.dbp_contribution
                )
              : 0,
        },
        state_filings: projected.state_filings.map((sf) =>
          sf.state_code === 'CA'
            ? { ...sf, state_apportionment_factor: caApp }
            : sf.state_code === 'AZ'
            ? { ...sf, state_apportionment_factor: azApp }
            : sf
        ),
      });
    } else {
      years.push(projected);
    }
  }

  const year2026 = years.find((y) => y.tax_year === 2026) ?? years[1];

  return {
    setup,
    years,
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: [],
    },
    pnl_balance_sheet: createInitialPnlBalanceSheetState(year2026, 0),
  };
}

/**
 * Annual Rolling Forward Workflow (Module 3 §4):
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

  const priorOfficer = promotingYear2.scorp_1120s.officer_w2_wages;
  const debraShare =
    priorOfficer > 0 ? promotingYear2.scorp_1120s.debra_w2_wages / priorOfficer : 0.44;
  const reconciledDebraW2 = round0(reconciledYear1Overrides.officer_w2_wages * debraShare);
  const reconciledBillW2 = Math.max(
    0,
    reconciledYear1Overrides.officer_w2_wages - reconciledDebraW2
  );

  const newYear1: TaxYearRecord = {
    ...promotingYear2,
    record_mode: 'actuals',
    is_locked_actuals: true,
    amended_unlock_reason: undefined,
    locked_actuals: undefined,
    form_1040: {
      ...promotingYear2.form_1040,
      w2_wages_total: reconciledYear1Overrides.w2_wages_total,
      schedule_k1_ordinary_income: reconciledYear1Overrides.schedule_k1_ordinary_income,
    },
    scorp_1120s: {
      ...promotingYear2.scorp_1120s,
      debra_w2_wages: reconciledDebraW2,
      bill_w2_wages: reconciledBillW2,
      officer_w2_wages: reconciledYear1Overrides.officer_w2_wages,
      scorp_distributions_total: reconciledYear1Overrides.scorp_distributions_total,
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
    current_tax_year: newYear1.tax_year + 1,
    forecast_years: nextYears.map((y) => y.tax_year),
  };

  return {
    setup: nextSetup,
    years: nextYears,
    archived_years: [archived, ...state.archived_years],
    schedule_view: state.schedule_view,
  };
}

/**
 * Ensures any saved localStorage or imported PlannerState safely includes all fields.
 */
export function normalizePlannerState(raw: PlannerState): PlannerState {
  const defaultPrimary = createDefaultPersonProfile('1960-05-06');
  const defaultSpouse = createDefaultPersonProfile('1960-08-10');

  const primaryProfile = raw.setup.primary_profile
    ? {
        birth_date: raw.setup.primary_profile.birth_date ?? '1960-05-06',
        social_security: {
          ...defaultPrimary.social_security,
          ...(raw.setup.primary_profile.social_security ?? {}),
        },
        medicare: {
          ...defaultPrimary.medicare,
          ...(raw.setup.primary_profile.medicare ?? {}),
        },
      }
    : defaultPrimary;

  const spouseProfile = raw.setup.spouse_profile
    ? {
        birth_date: raw.setup.spouse_profile.birth_date ?? '1960-08-10',
        social_security: {
          ...defaultSpouse.social_security,
          ...(raw.setup.spouse_profile.social_security ?? {}),
        },
        medicare: {
          ...defaultSpouse.medicare,
          ...(raw.setup.spouse_profile.medicare ?? {}),
        },
      }
    : defaultSpouse;

  const primaryName =
    typeof raw.setup.primary_name === 'string' ? raw.setup.primary_name : 'Bill';
  const spouseName =
    typeof raw.setup.spouse_name === 'string' ? raw.setup.spouse_name : 'Debra';

  const parsedPrimary = parseBirthDate(primaryProfile.birth_date);
  const parsedSpouse = parseBirthDate(spouseProfile.birth_date);

  const deductionMethod =
    raw.setup.deduction_method === 'itemized' ? 'itemized' : 'standard';
  const customItemized =
    typeof raw.setup.custom_itemized_deduction === 'number' &&
    Number.isFinite(raw.setup.custom_itemized_deduction)
      ? Math.max(0, raw.setup.custom_itemized_deduction)
      : 34700;

  const dbpTermYear =
    raw.setup.dbp_planned_termination_year === null
      ? null
      : typeof raw.setup.dbp_planned_termination_year === 'number' &&
        Number.isFinite(raw.setup.dbp_planned_termination_year)
      ? raw.setup.dbp_planned_termination_year
      : 2027;

  const postDbpRate =
    typeof raw.setup.post_dbp_profit_sharing_rate === 'number' &&
    Number.isFinite(raw.setup.post_dbp_profit_sharing_rate)
      ? Math.min(0.25, Math.max(0, raw.setup.post_dbp_profit_sharing_rate))
      : 0.06;

  const normalizedYears: TaxYearRecord[] = raw.years.map((yr) => {
    const hasDebra =
      typeof yr.scorp_1120s.debra_w2_wages === 'number' &&
      Number.isFinite(yr.scorp_1120s.debra_w2_wages);
    const hasBill =
      typeof yr.scorp_1120s.bill_w2_wages === 'number' &&
      Number.isFinite(yr.scorp_1120s.bill_w2_wages);

    let debraW2 = yr.scorp_1120s.debra_w2_wages;
    let billW2 = yr.scorp_1120s.bill_w2_wages;
    if (!hasDebra || !hasBill) {
      const total = yr.scorp_1120s.officer_w2_wages ?? 0;
      billW2 = round0(total * 0.556);
      debraW2 = Math.max(0, total - billW2);
    }

    const capContrib =
      typeof yr.scorp_1120s.capital_contributions === 'number' &&
      Number.isFinite(yr.scorp_1120s.capital_contributions)
        ? Math.max(0, yr.scorp_1120s.capital_contributions)
        : 0;

    const hasCaRev =
      typeof yr.scorp_1120s.ca_revenue === 'number' &&
      Number.isFinite(yr.scorp_1120s.ca_revenue);
    const hasAzRev =
      typeof yr.scorp_1120s.az_revenue === 'number' &&
      Number.isFinite(yr.scorp_1120s.az_revenue);
    let caRev = yr.scorp_1120s.ca_revenue;
    let azRev = yr.scorp_1120s.az_revenue;
    if (!hasCaRev || !hasAzRev) {
      const totalRev = yr.scorp_1120s.gross_receipts_revenue ?? 0;
      const caFactor =
        yr.state_filings.find((s) => s.state_code === 'CA')?.state_apportionment_factor ?? 0.360315;
      caRev = round0(totalRev * caFactor);
      azRev = Math.max(0, totalRev - caRev);
    }

    // Seamlessly migrate legacy saved 2025 records:
    // 1) Pre-baked excess gain (32122) -> raw non-S-Corp (-60)
    // 2) Legacy $0 SS baseline -> $39,500 Bill + $39,500 Debra ($79,000 combined, status 'on')
    let migratedForm1040 = yr.form_1040;
    if (
      yr.tax_year === 2025 &&
      yr.is_locked_actuals &&
      migratedForm1040.schedule_d_includes_excess_gain &&
      migratedForm1040.long_term_capital_gain_loss === 32122
    ) {
      migratedForm1040 = {
        ...migratedForm1040,
        long_term_capital_gain_loss: -60,
        schedule_d_includes_excess_gain: false,
      };
    }
    if (
      yr.tax_year === 2025 &&
      yr.is_locked_actuals &&
      migratedForm1040.social_security_gross === 0 &&
      (migratedForm1040.ss_bill_mode === 'off' || migratedForm1040.ss_bill_mode === undefined) &&
      (migratedForm1040.ss_debra_mode === 'off' || migratedForm1040.ss_debra_mode === undefined) &&
      migratedForm1040.ss_bill_override == null &&
      migratedForm1040.ss_debra_override == null
    ) {
      migratedForm1040 = {
        ...migratedForm1040,
        social_security_gross: 79000,
        ss_bill_mode: 'on',
        ss_bill_override: 39500,
        ss_debra_mode: 'on',
        ss_debra_override: 39500,
      };
    }

    return {
      ...yr,
      form_1040: migratedForm1040,
      scorp_1120s: {
        ...yr.scorp_1120s,
        ca_revenue: caRev,
        az_revenue: azRev,
        gross_receipts_revenue: caRev + azRev,
        debra_w2_wages: debraW2,
        bill_w2_wages: billW2,
        officer_w2_wages: debraW2 + billW2,
        capital_contributions: capContrib,
      },
    };
  });

  const currentTaxYear =
    typeof raw.setup.current_tax_year === 'number' &&
    Number.isFinite(raw.setup.current_tax_year)
      ? raw.setup.current_tax_year
      : raw.setup.forecast_years?.[1] ?? 2026;

  const ssColaRate =
    typeof raw.setup.assumptions?.ss_cola_rate === 'number' &&
    Number.isFinite(raw.setup.assumptions.ss_cola_rate)
      ? Math.max(0, raw.setup.assumptions.ss_cola_rate)
      : 0.026;

  const medicareInflationRate =
    typeof raw.setup.assumptions?.medicare_inflation_rate === 'number' &&
    Number.isFinite(raw.setup.assumptions.medicare_inflation_rate)
      ? Math.max(0, raw.setup.assumptions.medicare_inflation_rate)
      : 0.055;

  const hiddenIds = sanitizeHiddenItemIds(raw.schedule_view?.hidden_line_item_ids);
  const year2026 = normalizedYears.find((y) => y.tax_year === 2026) ?? normalizedYears[1];
  const pnlBalanceSheet = normalizePnlBalanceSheetState(raw.pnl_balance_sheet, year2026);

  return {
    ...raw,
    setup: {
      ...raw.setup,
      primary_name: primaryName,
      spouse_name: spouseName,
      primary_profile: primaryProfile,
      spouse_profile: spouseProfile,
      primary_birth_year: parsedPrimary ? parsedPrimary.year : raw.setup.primary_birth_year,
      spouse_birth_year: parsedSpouse ? parsedSpouse.year : raw.setup.spouse_birth_year,
      deduction_method: deductionMethod,
      custom_itemized_deduction: customItemized,
      dbp_planned_termination_year: dbpTermYear,
      post_dbp_profit_sharing_rate: postDbpRate,
      current_tax_year: currentTaxYear,
      assumptions: {
        ...raw.setup.assumptions,
        ss_cola_rate: ssColaRate,
        medicare_inflation_rate: medicareInflationRate,
      },
    },
    years: normalizedYears,
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: hiddenIds,
    },
    pnl_balance_sheet: pnlBalanceSheet,
  };
}
