# Module 2: Data Definitions

## 1. Setup & Module State
- **Profile & Toggles:** `filing_status`, `primary_birth_year`, `spouse_birth_year`, `has_scorp`, `has_dbp`, `has_401k_or_ira`, `has_annuity`, `has_pte`, `multi_state_active`, `residency_change_active`.
- **Rolling Window Metadata:** `anchor_actuals_year`, `forecast_length` (`6`), `forecast_years` (ordered six-year list).

## 2. Household & Individual Return (1040) Fields
- **Income Line Fields:**
  - `w2_wages_total` (combined or taxpayer/spouse W-2 wages)
  - `taxable_interest` and `tax_exempt_interest`
  - `ordinary_dividends` and `qualified_dividends`
  - `short_term_capital_gain_loss` and `long_term_capital_gain_loss`
  - `schedule_1_other_income` (business/Schedule C, additional income adjustments)
  - `schedule_k1_ordinary_income` and `schedule_k1_other_items`
  - `ira_distributions_gross` and `ira_distributions_taxable`
  - `pensions_and_annuities_gross` and `pensions_and_annuities_taxable`
  - `social_security_gross` and `social_security_taxable`
- **Deductions & Tax Output Fields:**
  - `total_income`
  - `adjustments_to_income`
  - `adjusted_gross_income` (AGI)
  - `deduction_method` (`standard` or `itemized`)
  - `deduction_amount`
  - `qualified_business_income_deduction` (QBI / Section 199A)
  - `taxable_income`
  - `federal_income_tax`
  - `marginal_tax_rate` and `effective_tax_rate`

## 3. S-Corporation (1120-S) & Distribution Fields
- **Entity & Apportionment Fields:**
  - `entity_id`, `entity_name`, `tax_year`
  - `gross_receipts_revenue`
  - `ordinary_business_income_1120s`
  - `state_sourcing_breakdown` (state-level revenue or apportionment percentages, such as AZ and CA)
  - `pte_election_active` and `pte_tax_paid_by_state`
- **Compensation & Distribution Fields:**
  - `officer_w2_wages` (taxpayer and spouse W-2 salaries)
  - `employer_payroll_taxes`
  - `scorp_distributions_total` (shareholder cash/property distributions)
  - `stock_basis_beginning`, `stock_basis_additions`, `stock_basis_reductions`, `stock_basis_ending`
  - `aaa_balance_ending` (Accumulated Adjustments Account)

## 4. Defined Benefit Plan (DBP) & Retirement Tracking Fields
- **DBP Plan & Funding Fields:**
  - `dbp_plan_id`, `dbp_status` (`active`, `frozen`, `terminating`, or `terminated`)
  - `dbp_max_deductible_contribution` and `dbp_actual_contribution`
  - `dbp_target_termination_year` and `dbp_rollover_target_account`
  - `dbp_loan_balance` and `dbp_collateral_requirement`
- **Qualified Plan & Annuity Fields:**
  - `qualified_plan_contribution` (401(k) / profit-sharing)
  - `rollover_amount` and `rollover_source_type`
  - `annuity_contract_value` and `annuity_payout_amount`

## 5. Six-Year Time-Series Record Rules
- **Horizon & Record Tag:** `tax_year`, `record_mode` (`actuals` for Year 1 locked to filed return; `forecast` for Years 2–6), and `is_locked_actuals` (`true` for Year 1, `false` for Years 2–6).
- **Annual Rollover Rule:** When advancing by one year, the oldest `actuals` year retires out of the six-year window, the prior Year 2 moves to Year 1 and reconciles to the filed return (`actuals`), Years 3–6 shift to Years 2–5, and a new Year 6 `forecast` slot opens at the end.
