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

export type OpexScalingMode = 'revenue_proportional' | 'fixed_inflation';

export interface ForecastAssumptions {
  inflation_rate: number; // e.g., 0.025 (2.5%)
  ss_cola_rate: number; // e.g., 0.026 (2.6% historical average SS COLA, applied Current Year + 1)
  medicare_inflation_rate: number; // e.g., 0.055 (5.5% historical average Medicare inflation, applied Current Year + 1)
  irmaa_threshold_growth_rate?: number; // e.g., 0.03 (3.0%/yr applied to 2027+ from $218k 2026 MFJ baseline, rounded to $1,000)
  revenue_growth_rate: number; // e.g., 0.04 (4%)
  wage_growth_rate: number; // e.g., 0.03 (3%)
  investment_growth_rate: number; // e.g., 0.035 (3.5%)
  expense_ratio: number; // e.g., 0.164 of gross receipts (applied to unlocked future forecast years)
  opex_scaling_mode?: OpexScalingMode; // 'revenue_proportional' (default) or 'fixed_inflation'
}

export interface PersonMedicareConfig {
  enrolled: boolean;
  part_a_monthly: number | null;
  part_b_monthly: number | null;
  part_d_monthly: number | null;
  medigap_plan_g_monthly: number | null;
}

export interface PersonSocialSecurityConfig {
  receiving: boolean;
  monthly_benefit: number | null;
  suspend_fra_to_70: boolean;
  suspend_start_year: number | null;
  resume_age: number;
}

export interface PersonProfile {
  birth_date: string; // YYYY-MM-DD or '' when left blank
  /** Configurable birth month (1 = Jan .. 12 = Dec) used for SS FRA suspension & age-70 proration */
  birth_month?: number;
  social_security: PersonSocialSecurityConfig;
  medicare: PersonMedicareConfig;
}

export type SsYearMode = 'on' | 'suspended' | 'off';

export type WorkspaceProfileMode = 'my_profile' | 'test_persona' | 'blank_user';

/**
 * Per-state business revenue apportionment percentages (summing to 100) keyed by 2-letter state code.
 * Example: { CA: 37, AZ: 63 }
 */
export type StateApportionmentSplit = Record<string, number>;

export interface StateRevenueApportionmentConfig {
  /** Ordered list of selected US state codes tracked in Setup apportionment (supports 1..N states, including 0% states) */
  states?: string[];
  /** Default forecast split across selected apportionment states (sums to 100%) */
  default_split: StateApportionmentSplit;
  /** Optional per-year overrides keyed by tax year (each sums to 100%) */
  year_overrides?: Record<number, StateApportionmentSplit>;
}

export interface DbpActuarialConfig {
  /** Historical High-3 W-2 average from prior Schedule SB before the forecast window */
  historical_high_3_w2: number;
  /** Beginning-of-Year (BOY) DBP trust assets for the anchor year (first year in window) */
  boy_assets_anchor: number;
  /** Plan Year number (1..10+) for the anchor year (first year in window) */
  plan_year_anchor: number;
  /** Assumed annual DBP trust investment growth rate (decimal, e.g. 0, 0.05) */
  trust_growth_rate: number;
  /** IRC §417(e) / §415(b)(2)(E) lump-sum valuation interest rate (decimal, e.g. 0.0475, 0.05) */
  valuation_interest_rate: number;
}

export interface SetupConfig {
  filing_status: FilingStatus;
  primary_name: string;
  spouse_name: string;
  primary_birth_year: number;
  spouse_birth_year: number | null;
  primary_profile: PersonProfile;
  spouse_profile: PersonProfile;
  /** Dynamic business / entity metadata used in UI headers and CPA report footers */
  business_name?: string;
  business_website?: string;
  business_ein?: string;
  /** Primary domicile / resident state 2-letter code (e.g., 'CA', 'TX', 'WA', or '' when unset) */
  home_state?: string;
  /** Optional secondary sourcing state 2-letter code when multi_state_active is enabled */
  secondary_state?: string;
  /** Dynamic Setup-driven state revenue apportionment splits for forecast years */
  state_revenue_apportionment?: StateRevenueApportionmentConfig;
  /** Internal profile archetype tag for isolated reference-only features */
  workspace_profile_kind?: 'default' | 'test_persona' | 'blank' | 'custom';
  deduction_method: DeductionMethod;
  custom_itemized_deduction: number;
  entity_type: EntityType;
  has_scorp: boolean;
  has_ss_medicare?: boolean;
  has_stock_basis?: boolean;
  has_dbp: boolean;
  dbp_planned_termination_year: number | null; // null means "None"
  post_dbp_profit_sharing_rate: number; // decimal e.g. 0.06 up to 0.25
  /** Editable Schedule SB / actuarial waterfall baselines for the DBP engine */
  dbp_actuarial?: DbpActuarialConfig;
  has_401k_or_ira: boolean;
  has_annuity: boolean;
  has_pte: boolean;
  multi_state_active: boolean;
  residency_change_active: boolean;
  anchor_actuals_year: number;
  current_tax_year: number; // Active Setup baseline year (default 2026)
  forecast_length: number;
  forecast_years: number[];
  assumptions: ForecastAssumptions;
  /** Optional per-coverage-year manual overrides for IRMAA Tier 1 starting threshold (e.g. { 2027: 224000 }) */
  irmaa_threshold_overrides?: Record<number, number>;
}

export interface Form1040Inputs {
  w2_wages_total: number;
  bill_w2_box1?: number;
  debra_w2_box1?: number;
  /** When true, Form 1040 Line 1a uses w2_wages_total directly (e.g. filed W-2 Box 1) instead of recomputing gross W-2 minus 401(k) */
  use_explicit_w2_box1?: boolean;
  taxable_interest: number;
  tax_exempt_interest: number;
  ordinary_dividends: number;
  qualified_dividends: number;
  short_term_capital_gain_loss: number;
  long_term_capital_gain_loss: number;
  /** When true, long_term_capital_gain_loss already reflects Schedule D net gain including any Form 8949 excess basis gain */
  schedule_d_includes_excess_gain?: boolean;
  schedule_1_other_income: number;
  schedule_1_adjustments_input?: number;
  schedule_k1_ordinary_income: number;
  schedule_k1_other_items: number;
  ira_distributions_gross: number;
  ira_distributions_taxable: number;
  pensions_and_annuities_gross: number;
  pensions_and_annuities_taxable: number;
  social_security_gross: number;
  ss_debra_mode?: SsYearMode;
  ss_debra_override?: number | null;
  ss_bill_mode?: SsYearMode;
  ss_bill_override?: number | null;
  health_insurance_premiums: number;
  sehi_medicare_override?: number | null;
  itemized_deductions_input: number;
  deduction_method: DeductionMethod;
  /** Optional filed-return override strictly for Year 1 locked actuals reconciliation */
  locked_taxable_income_override?: number;
  locked_federal_tax_override?: number;
}

export interface Form1040Outputs {
  primary_ss_gross: number;
  spouse_ss_gross: number;
  primary_ss_mode: SsYearMode;
  spouse_ss_mode: SsYearMode;
  primary_ss_status: string;
  spouse_ss_status: string;
  social_security_gross_effective: number;
  social_security_taxable: number;
  sehi_medicare_premiums_effective: number;
  sehi_medicare_deduction: number;
  enhanced_senior_deduction_allowed: number;
  enhanced_senior_deduction_max: number;
  enhanced_senior_deduction_lost: number;
  employee_401k_debra: number;
  employee_401k_bill: number;
  employee_401k_total: number;
  employer_401k_debra: number;
  employer_401k_bill: number;
  employer_401k_total: number;
  employer_401k_rate_applied: number;
  dbp_and_ps_tax_reduction: number;
  personal_fica_tax: number;
  total_income: number;
  adjustments_to_income: number;
  adjusted_gross_income: number;
  deduction_amount: number;
  qualified_business_income_deduction: number;
  taxable_income: number;
  ordinary_taxable_income: number;
  preferential_income: number;
  next_bracket_headroom: number | null;
  next_bracket_rate: number | null;
  federal_income_tax: number;
  niit_tax: number;
  marginal_tax_rate: number;
  effective_tax_rate: number;
  irmaa_coverage_year: number;
  irmaa_lookback_year: number;
  irmaa_lookback_magi: number;
  irmaa_tier1_threshold: number;
  irmaa_formula_tier1_threshold: number;
  irmaa_is_overridden: boolean;
  irmaa_future_coverage_year: number;
  irmaa_future_tier1_threshold: number;
  irmaa_current_magi_exceeds_cliff: boolean;
  irmaa_tier: string;
  primary_irmaa_surcharge: number;
  spouse_irmaa_surcharge: number;
  irmaa_annual_surcharge: number;
  primary_medicare_base_annual: number;
  spouse_medicare_base_annual: number;
}

export interface StateSourcingItem {
  state_code: string;
  apportionment_percent: number; // 0 to 100
}

export interface SCorp1120SInputs {
  entity_id: string;
  entity_name: string;
  entity_ein?: string;
  bill_ownership_pct?: number;
  debra_ownership_pct?: number;
  ca_revenue: number;
  az_revenue: number;
  gross_receipts_revenue: number;
  operating_expenses: number;
  /** Optional per-year manual override for Operating Expenses in unlocked future forecast years (null = follow scaling formula) */
  operating_expenses_override?: number | null;
  /** Detailed Form 1120-S line-item deductions (when use_detailed_1120s_deductions is true) */
  use_detailed_1120s_deductions?: boolean;
  compensation_of_officers?: number;
  salaries_and_wages?: number;
  rents?: number;
  payroll_taxes_input?: number;
  ftb_state_taxes_input?: number;
  advertising?: number;
  pension_profit_sharing_input?: number;
  other_deductions?: number;
  schedule_k_interest_income?: number;
  schedule_k_interest_bill?: number;
  schedule_k_interest_debra?: number;
  schedule_k_nondeductible_expenses?: number;
  schedule_k_nondeductible_bill?: number;
  schedule_k_nondeductible_debra?: number;
  debra_w2_wages: number;
  bill_w2_wages: number;
  officer_w2_wages: number;
  scorp_distributions_total: number;
  bill_distributions?: number;
  debra_distributions?: number;
  capital_contributions: number;
  stock_basis_beginning: number;
  bill_stock_basis_beginning?: number;
  debra_stock_basis_beginning?: number;
  shareholder_loans_beginning?: number;
  aaa_balance_beginning: number;
  ca_franchise_tax_input?: number;
  state_sourcing_breakdown: StateSourcingItem[];
  pte_election_active: boolean;
  /** If true, S-Corp ordinary business income feeds 1040 Schedule K-1 automatically */
  auto_sync_k1: boolean;
  /** Optional filed override for Year 1 actuals */
  locked_ordinary_income_override?: number;
  locked_stock_basis_ending_override?: number;
}

export interface SCorp1120SOutputs {
  effective_operating_expenses: number;
  operating_expenses_is_scaled: boolean;
  operating_expenses_is_overridden: boolean;
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
  /** Optional state Schedule CA / conformity adjustment to federal AGI (e.g., 2025 CA +$969 net) */
  state_conformity_adjustment?: number;
  state_pte_elected: boolean;
  other_state_credits_claimed: number;
  state_tax_withholding_and_estimates: number;
}

export interface StateFilingOutputs extends StateFilingInputs {
  state_apportioned_income: number;
  state_taxable_income: number;
  state_personal_tax_liability: number;
  state_entity_tax_liability: number;
  state_income_tax_liability: number;
  state_pte_payment_amount: number;
  state_pte_credit_or_exclusion_amount: number;
  credit_for_taxes_paid_to_other_states: number;
  other_state_tax_credit_limitation: number;
  state_net_tax_due_or_refund: number;
}

export interface LockedActualsSnapshot {
  taxable_w2_note?: string;
  employer_401k_total?: number;
  employee_401k_total?: number;
  employee_401k_note?: string;
  dbp_and_ps_tax_reduction?: number;
  enhanced_senior_deduction_allowed?: number;
  enhanced_senior_deduction_lost?: number;
  qbi_deduction?: number;
  qbi_note?: string;
  taxable_social_security?: number;
  taxable_ss_note?: string;
  sehi_medicare_premiums?: number;
  sehi_medicare_deduction?: number;
  sehi_note?: string;
  adjusted_gross_income?: number;
  taxable_income?: number;
  federal_income_tax?: number;
  effective_tax_rate?: number;
  marginal_tax_rate?: number;
  fica_total_tax?: number;
  statutory_min_quarterly?: number;
  statutory_min_note?: string;
  suggested_1040es_quarterly?: number;
  ca_state_tax?: number;
  ca_state_badge?: string;
  az_state_tax?: number;
  irmaa_badge?: string;
  form_8949_excess_gain?: number;
  form_8949_note?: string;
}

export interface TaxYearRecord {
  tax_year: number;
  record_mode: RecordMode;
  is_locked_actuals: boolean;
  amended_unlock_reason?: string;
  locked_actuals?: LockedActualsSnapshot;
  form_1040: Form1040Inputs;
  scorp_1120s: SCorp1120SInputs;
  dbp_and_retirement: DbpAndRetirementInputs;
  state_filings: StateFilingInputs[];
}

export interface ComputedTaxYear {
  tax_year: number;
  record_mode: RecordMode;
  is_locked_actuals: boolean;
  locked_actuals?: LockedActualsSnapshot;
  primary_age: number | null;
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
  total_gross_cash_income: number;
  all_in_effective_rate: number;
  estimated_net_cash_flow: number;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type GuardrailAckStatus =
  | 'prior_year_historical'
  | 'intentional_cpa_reviewed'
  | 'mitigation_planned';

export interface GuardrailAcknowledgment {
  /** Stable per-rule, per-year key (e.g., "scorp_basis_excess:2025", "low_reasonable_comp:2026") */
  key: string;
  rule_id: string;
  tax_year: number | null;
  status: GuardrailAckStatus;
  note: string;
  /** ISO date string (YYYY-MM-DD) when first acknowledged */
  acknowledged_at: string;
  /** Optional ISO date string (YYYY-MM-DD) when note/status was last updated */
  updated_at?: string;
  /** Snapshot of the finding text when acknowledged (for CPA review & audit log) */
  finding_title: string;
  finding_message: string;
  finding_severity: ValidationSeverity;
}

export interface ValidationIssue {
  id: string;
  /** Stable deterministic rule identifier (e.g., "scorp_basis_excess", "low_reasonable_comp") */
  rule_id: string;
  /** Stable per-rule, per-year acknowledgment key: `${rule_id}:${tax_year ?? 'global'}` */
  ack_key: string;
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
  /** Live numeric breakdown attached to low_reasonable_comp findings so UI & CPA print views stay 100% synced */
  reasonable_comp_meta?: {
    officer_w2: number;
    ordinary_business_income: number;
    ratio: number;
    ratio_percent: string;
  };
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

export type ScheduleViewPreset = 'executive' | 'full' | 'custom';

export interface ScheduleViewConfig {
  preset: ScheduleViewPreset;
  custom_line_item_ids: string[];
  hidden_line_item_ids: string[];
}

export type PnlLineId =
  | 'ca_revenue'
  | 'az_revenue'
  | 'bill_officer_w2'
  | 'debra_salaries_wages'
  | 'dbp_contribution'
  | 'employer_401k'
  | 'sehi_medicare'
  | 'rents'
  | 'payroll_taxes'
  | 'ca_ftb_tax'
  | 'professional_fees'
  | 'subscriptions_software'
  | 'telephone_internet'
  | 'travel'
  | 'meals_gross'
  | 'office_expense'
  | 'insurance'
  | 'utilities'
  | 'bank_payroll_fees'
  | 'other_deductions'
  | 'schedule_k_interest';

export interface PnlLineAmounts {
  ytd: number;
  remaining: number;
}

export interface BalanceSheetProjectionInputs {
  as_of_date: string; // e.g., '2026-09-30'
  operating_cash_beg: number;
  operating_cash_ytd: number;
  operating_cash_ye_override: number | null;
  pension_payable_beg: number;
  pension_payable_ytd: number;
  pension_payable_ye: number;
  cc_ap_beg: number;
  cc_ap_ytd: number;
  cc_ap_ye: number;
  member_draws_ytd: number;
  member_draws_remaining: number;
  capital_contributions_ytd: number;
  capital_contributions_remaining: number;
  beginning_stock_basis_override: number | null;
}

export interface PnlBalanceSheetState {
  projection_year: number;
  pnl: Record<PnlLineId, PnlLineAmounts>;
  balance_sheet: BalanceSheetProjectionInputs;
  /** Tracks whether the user explicitly overrode Line 17 Remaining/Projected in the P&L table */
  retirement_line17_manual_overrides?: {
    dbp_contribution?: boolean;
    employer_401k?: boolean;
  };
  last_pushed_at?: string;
}

export interface PushToHorizonImpact {
  taxYear: number;
  prevK1: number;
  newK1: number;
  k1Delta: number;
  prevAllInTax: number;
  newAllInTax: number;
  taxDelta: number;
}

export type CadenceForecastMode = 'cadence' | 'exp_smooth' | 'run_rate' | 'one_time' | 'manual';

export type CadenceGroupingMode = 'category' | 'stream';

export type PayeeAliasMatchType = 'contains' | 'exact';

export interface PayeeAliasRule {
  id: string;
  /** Raw import text/pattern to match (case-insensitive) against vendor/payee or memo/description */
  pattern: string;
  /** Match mode: case-insensitive substring ('contains') or exact match ('exact') */
  match_type: PayeeAliasMatchType;
  /** Canonical payee / stream display name to merge matched transactions into */
  canonical_name: string;
}

export interface CadenceTransactionRow {
  id: string;
  date: string; // YYYY-MM-DD
  transaction_type: string;
  num: string;
  vendor: string;
  memo: string;
  account: string;
  split_account: string;
  amount: number;
  running_balance?: number;
  is_beginning_balance?: boolean;
  gl_section?: string;
}

export interface CadenceStreamOverride {
  mode: CadenceForecastMode;
  manual_remaining?: number;
}

export interface CadenceForecasterState {
  projection_year: number;
  source_label: string;
  ledger_format?: 'general_ledger' | 'transaction_list';
  as_of_date: string; // YYYY-MM-DD
  /** Grouping mode for the forecast table: rolled up by P&L Category (~28 rows) or granular vendor streams */
  grouping_mode?: CadenceGroupingMode;
  /** Simple Exponential Smoothing factor alpha (0.10 to 0.90, default 0.50) */
  exp_smooth_alpha?: number;
  /** When true, scale S_T by remainingDays / 30.4375; default false uses S_T directly when <= 45d remain */
  exp_smooth_day_fraction?: boolean;
  /** User-defined payee/description alias rules applied before stream grouping & forecasting */
  payee_aliases?: PayeeAliasRule[];
  transactions: CadenceTransactionRow[];
  stream_overrides: Record<string, CadenceStreamOverride>;
  /** Direct two-way inline overrides on aggregated P&L table lines */
  pnl_line_overrides: Partial<Record<PnlLineId, Partial<PnlLineAmounts>>>;
  /** Balance Sheet inputs (YTD auto-populated from transactions unless edited inline) */
  balance_sheet: BalanceSheetProjectionInputs;
  /** Optional expected QBO reconciliation benchmarks */
  qbo_expected?: {
    revenue: number;
    expenses: number;
    interest_income: number;
    cash: number;
    credit_cards: number;
    member_draws: number;
  };
  last_pushed_at?: string;
}

export type PlanningGuardrailKind =
  | 'income_ceiling'
  | 'stock_basis_floor'
  | 'member_draw_cushion'
  | 'retirement_cap'
  | 'multistate_apportionment'
  | 'custom';

export type PlanningGuardrailComparator = 'max' | 'min' | 'info';

export type PlanningGuardrailUnit = 'currency' | 'percent' | 'text';

export type PlanningGuardrailStatus = 'within' | 'watch' | 'over';

export type CustomGoalMetricKey =
  | 'manual'
  | 'ordinary_business_income'
  | 'gross_receipts'
  | 'member_draws'
  | 'ending_stock_basis'
  | 'operating_cash_ye'
  | 'net_cash_ye'
  | 'total_retirement'
  | 'ca_revenue_pct';

export interface PlanningGoalGuardrail {
  id: string;
  kind: PlanningGuardrailKind;
  title: string;
  enabled: boolean;
  /** Numeric threshold (dollars for currency, % for percent) or null for qualitative targets */
  target_value: number | null;
  /** True when user explicitly overrides a formula-linked default target (e.g., 2-yr lookback IRMAA ceiling) */
  target_overridden?: boolean;
  /** Optional text target when unit === 'text' */
  target_label?: string;
  unit: PlanningGuardrailUnit;
  comparator: PlanningGuardrailComparator;
  /** Optional live projection metric binding for custom goals */
  metric_binding?: CustomGoalMetricKey;
  /** Optional manual projected value when metric_binding === 'manual' */
  custom_current_value?: number | null;
  /** Optional manual projected text label when unit === 'text' */
  custom_current_label?: string;
  /** Plain-English "Why this matters" explanation shown in UI and CPA report/CSV */
  why_it_matters: string;
  /** True when user manually edited why_it_matters so dynamic lookback updates do not overwrite it */
  why_it_matters_custom?: boolean;
  is_custom?: boolean;
}

export interface PlannerState {
  setup: SetupConfig;
  years: TaxYearRecord[];
  archived_years: ArchivedActualsRecord[];
  schedule_view: ScheduleViewConfig;
  pnl_balance_sheet?: PnlBalanceSheetState;
  cadence_forecaster?: CadenceForecasterState;
  planning_goals?: PlanningGoalGuardrail[];
  /** Profile-isolated map of acknowledged guardrail findings keyed by `${rule_id}:${tax_year ?? 'global'}` */
  guardrail_acknowledgments?: Record<string, GuardrailAcknowledgment>;
}

export type WorkspaceTab =
  | 'horizon'
  | 'setup'
  | 'pnl_bs'
  | 'cadence_forecaster'
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

export interface ProfileModuleFlags {
  has_scorp: boolean;
  has_ss_medicare: boolean;
  has_dbp: boolean;
  multi_state_active: boolean;
  has_stock_basis: boolean;
}

export interface NewProfileOptions {
  name: string;
  filing_status: FilingStatus;
  primary_name: string;
  spouse_name: string;
  tax_year: number;
  entity_type: EntityType;
  entity_name: string;
  entity_ein: string;
  notes?: string;
  template: 'blank' | 'sample_oss';
  modules: ProfileModuleFlags;
}

export interface TaxProfileRecord {
  id: string;
  name: string;
  entity_name: string;
  entity_ein: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  state: PlannerState;
}

export interface MultiProfileStore {
  version: 1;
  active_profile_id: string;
  profiles: TaxProfileRecord[];
}

