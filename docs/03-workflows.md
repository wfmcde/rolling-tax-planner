# Module 3: Workflows, Calculation Flow & Six-Year Rolling Logic

## 1. Setup & Module Activation Workflow
1. **Collect Household Baseline:** Capture filing status (such as Married Filing Jointly), taxpayer/spouse ages, and core Form 1040 income and deduction inputs.
2. **Evaluate Entity Branch:** Determine whether the user has an entity or pass-through structure, such as an LLC taxed as an S-Corporation (Form 1120-S / Schedule K-1).
3. **Activate Conditional Sub-Modules:** Enable only the branches selected during setup—such as S-Corp W-2 vs. distribution splits, Defined Benefit Plan (DBP) funding and wind-down rules, qualified plans/annuities, medical premiums, Pass-Through Entity (PTE) tax elections, multi-state apportionment, or residency changes.
4. **Build Filing & Planning Map:** Generate the list of applicable federal forms, state filings/elections, and retirement plan checkpoints driven by the active toggles.

## 2. Six-Year Horizon Initialization
- **Window Composition:** Establish a continuous six-year window consisting of **Year 1 (Actuals)** followed by **Years 2–6 (Forecast)**.
- **Year 1 Lock Rule:** Populate Year 1 directly from the filed tax return so baseline figures and calculated outputs match the filed return.
- **Years 2–6 Projection Rule:** Generate five forward years using prior-year baselines, configured growth/inflation assumptions, tax bracket schedules, and scheduled plan events.

## 3. Annual Calculation Sequence (Per Forecast Year)
For each year in the horizon:
1. **Entity & Compensation Layer:** Calculate S-Corp revenue, state sourcing/apportionment splits, officer W-2 compensation, payroll taxes, shareholder distributions, and state PTE elections/payments when enabled.
2. **Retirement & Benefit Layer:** Apply Defined Benefit Plan (DBP) contributions, plan status/wind-down milestones, loan/collateral rules, and qualified plan/annuity inflows or distributions when enabled.
3. **Household Return Layer (Form 1040):** Aggregate W-2 wages, interest, dividends, capital gains/losses, Social Security, retirement/annuity amounts, and Schedule K-1 net pass-through figures to compute Adjusted Gross Income (AGI), deductions, taxable income, and federal tax liability.
4. **State & Residency Layer:** Evaluate state-level income/entity tax obligations, part-year residency splits, and non-resident filings across active states.

## 4. Annual Rolling Forward Workflow
When a new tax year is filed and added as actuals:
1. **Archive Oldest Actuals:** Retire the prior Year 1 record out of the active six-year window.
2. **Promote & Reconcile New Year 1:** Move the prior Year 2 forecast record into the Year 1 slot and reconcile its figures to match the newly filed return.
3. **Shift & Append Horizon:** Shift Years 3–6 into Years 2–5, and append a new Year 6 forecast slot at the end so the window always stays six years wide.
