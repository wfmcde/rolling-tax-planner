export type FilingStatus =
  | 'married_filing_jointly'
  | 'single'
  | 'head_of_household'
  | 'married_filing_separately';

export type EntityType =
  | 'none'
  | 'sole_prop'
  | 'scorp_llc'
  | 'partnership'
  | 'ccorp';

export type DeductionMethod = 'standard' | 'itemized';
export type RecordMode = 'actuals' | 'forecast';
export type DbpStatus = 'active' | 'frozen' | 'terminating' | 'terminated';
export type ResidencyStatus = 'resident' | 'part_year_resident' | 'non_resident';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ForecastAssumptions {
  inflation_rate: number; // e.g., 0.025 (2.5%)
  revenue_growth_rate: number; // e.g., 0.04 (4%)
  wage_growth_rate: number; // e.g., 0.03 (3%)
  investment_growth_rate: number; // e.g., 0.035 (3.5%)
  expense_ratio: number; // e.g., 0.22 of gross receipts
}

export interface SetupConfig {
  filing_status: FilingStatus;
  primary_birth_year: number;
  spouse_birth_year: number | null;
  entity_type: EntityType;
  has_scorp: boolean;
  has_dbp: boolean;
  has_401k_or_ira: boolean;
  has_annuity: boolean;
  has_pte: boolean;
  multi_state_active: boolean;
  residency_change_active: boolean;
  anchor_actuals_year: number;
  forecast_length: number;
  forecast_years: number[];
  assumptions: ForecastAssumptions;
}

export interface Form1040Inputs {
  w2_wages_total: number;
  taxable_interest: number;
  tax_exempt_interest: number;
  ordinary_dividends: number;
  qualified_dividends: number;
  short_term_capital_gain_loss: number;
  long_term_capital_gain_loss: number;
  schedule_1_other_income: number;
  schedule_k1_ordinary_income: number;
  schedule_k1_other_items: number;
  ira_distributions_gross: number;
  ira_distributions_taxable: number;
  pensions_and_annuities_gross: number;
  pensions_and_annuities_taxable: number;
  social_security_gross: number;
  health_insurance_premiums: number;
  itemized_deductions_input: number;
  deduction_method: DeductionMethod;
  /** Optional filed-return override strictly for Year 1 locked actuals reconciliation */
  locked_taxable_income_override?: number;
  locked_federal_tax_override?: number;
}

export interface Form1040Outputs {
  social_security_taxable: number;
  total_income: number;
  adjustments_to_income: number;
  adjusted_gross_income: number;
  deduction_amount: number;
  qualified_business_income_deduction: number;
  taxable_income: number;
  ordinary_taxable_income: number;
  preferential_income: number;
  federal_income_tax: number;
  niit_tax: number;
  marginal_tax_rate: number;
  effective_tax_rate: number;
  irmaa_tier: string;
  irmaa_annual_surcharge: number;
}

export interface StateSourcingItem {
  state_code: string;
  apportionment_percent: number; // 0 to 100
}

export interface SCorp1120SInputs {
  entity_id: string;
  entity_name: string;
  gross_receipts_revenue: number;
  operating_expenses: number;
  officer_w2_wages: number;
  scorp_distributions_total: number;
  stock_basis_beginning: number;
  aaa_balance_beginning: number;
  state_sourcing_breakdown: StateSourcingItem[];
  pte_election_active: boolean;
  /** If true, S-Corp ordinary business income feeds 1040 Schedule K-1 automatically */
  auto_sync_k1: boolean;
  /** Optional filed override for Year 1 actuals */
  locked_ordinary_income_override?: number;
  locked_stock_basis_ending_override?: number;
}

export interface SCorp1120SOutputs {
  employer_payroll_taxes: number;
  pte_tax_paid_by_state: Record<string, number>;
  pte_tax_paid_total: number;
  ordinary_business_income_1120s: number;
  stock_basis_additions: number;
  stock_basis_reductions: number;
  stock_basis_ending: number;
  aaa_balance_ending: number;
  excess_distribution_capital_gain: number;
  reasonable_comp_ratio: number;
}

export interface DbpAndRetirementInputs {
  dbp_plan_id: string;
  dbp_status: DbpStatus;
  dbp_max_deductible_contribution: number;
  dbp_actual_contribution: number;
  dbp_target_termination_year: number;
  dbp_rollover_target_account: string;
  dbp_loan_balance: number;
  dbp_collateral_requirement: number;
  qualified_plan_contribution: number;
  rollover_amount: number;
  rollover_source_type: string;
  annuity_contract_value: number;
  annuity_payout_amount: number;
}

export interface StateFilingInputs {
  state_code: string;
  residency_status: ResidencyStatus;
  residency_start_date: string; // YYYY-MM-DD
  residency_end_date: string; // YYYY-MM-DD
  residency_day_or_income_ratio: number; // 0..1
  state_return_type: string;
  state_apportionment_factor: number; // 0..1
  state_pte_elected: boolean;
  other_state_credits_claimed: number;
  state_tax_withholding_and_estimates: number;
}

export interface StateFilingOutputs extends StateFilingInputs {
  state_apportioned_income: number;
  state_taxable_income: number;
  state_income_tax_liability: number;
  state_pte_payment_amount: number;
  state_pte_credit_or_exclusion_amount: number;
  credit_for_taxes_paid_to_other_states: number;
  other_state_tax_credit_limitation: number;
  state_net_tax_due_or_refund: number;
}

export interface TaxYearRecord {
  tax_year: number;
  record_mode: RecordMode;
  is_locked_actuals: boolean;
  amended_unlock_reason?: string;
  form_1040: Form1040Inputs;
  scorp_1120s: SCorp1120SInputs;
  dbp_and_retirement: DbpAndRetirementInputs;
  state_filings: StateFilingInputs[];
}

export interface ComputedTaxYear {
  tax_year: number;
  record_mode: RecordMode;
  is_locked_actuals: boolean;
  primary_age: number;
  spouse_age: number | null;
  form_1040_in: Form1040Inputs;
  form_1040_out: Form1040Outputs;
  scorp_in: SCorp1120SInputs;
  scorp_out: SCorp1120SOutputs;
  dbp_in: DbpAndRetirementInputs;
  state_filings_out: StateFilingOutputs[];
  total_state_tax: number;
  total_entity_and_payroll_tax: number;
  total_all_in_tax: number;
  all_in_effective_rate: number;
  estimated_net_cash_flow: number;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  tax_year: number | null;
  category:
    | 'lock_integrity'
    | 'scorp_comp'
    | 'dbp_retirement'
    | 'multi_state'
    | 'reconciliation';
  severity: ValidationSeverity;
  title: string;
  message: string;
  field_reference: string;
  target_tab: WorkspaceTab;
}

export interface ProvenanceField {
  field_path: string;
  label: string;
  source_document: string;
  extracted_value: string | number | boolean;
  confidence_level: ConfidenceLevel;
  notes?: string;
}

export interface ArchivedActualsRecord {
  tax_year: number;
  archived_at: string;
  record: TaxYearRecord;
  summary: {
    adjusted_gross_income: number;
    taxable_income: number;
    federal_income_tax: number;
    total_state_tax: number;
    effective_tax_rate: number;
  };
}

export interface PlannerState {
  setup: SetupConfig;
  years: TaxYearRecord[];
  archived_years: ArchivedActualsRecord[];
}

export type WorkspaceTab =
  | 'horizon'
  | 'setup'
  | 'form1040'
  | 'scorp'
  | 'dbp'
  | 'multistate'
  | 'forms'
  | 'scenarios';

export interface FilingFormRequirement {
  form_code: string;
  jurisdiction: 'Federal' | string;
  title: string;
  category: 'Individual' | 'Entity' | 'Retirement' | 'State & PTE';
  due_date: string;
  driven_by: string;
  active_years: number[];
  notes: string;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  setup: SetupConfig;
  years: TaxYearRecord[];
}
