# Module 2: Data Definitions

## 1. Setup & Module State
- **Profile & Toggles:** Filing status, ages/birth years, and boolean flags (`has_scorp`, `has_dbp`, `has_401k_or_ira`, `has_annuity`, `has_pte`, `multi_state_active`, `residency_change_active`).
- **Rolling Window Metadata:** `anchor_actuals_year`, `forecast_length` (`6`), and ordered six-year list.

## 2. Household & Individual Return (1040)
- **Income & Adjustments:** W-2 wages, interest, ordinary/qualified dividends, net capital gains/losses, Social Security, IRA/annuity distributions, Schedule K-1 net income, and adjustments/deductions.
- **Tax Outputs:** Adjusted Gross Income (AGI), taxable income, federal tax liability, and bracket indicators.

## 3. S-Corporation (1120-S) & Plan Records
- **Entity & Apportionment:** Entity ID, tax year, revenue, state apportionment/sourcing splits, and PTE election status/payments by state.
- **Payroll & Distributions:** Officer W-2 compensation, employer payroll taxes, and shareholder distributions.
- **DBP & Retirement Plans:** DBP funding/contribution targets, plan status (active vs. terminating), loan/collateral rules, and rollover/annuity balances or payouts.

## 4. Six-Year Time-Series Record Rules
- **Mode Tag:** Each year in the six-year horizon is marked `actuals` (Year 1, locked to filed return) or `forecast` (Years 2–6).
- **Annual Rollover Rule:** Advancing one year retires the oldest `actuals` year, promotes Year 2 to `actuals`, and appends a new Year 6 `forecast` record.
