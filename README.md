# Rolling Tax Planner

A modular, six-year rolling tax planning application built around a **1 actuals year (locked to filed returns) + 5 rolling projection years** architecture.

## Project Structure
- `docs/01-navigation-tree.md` — Module 1: Guided setup navigation, conditional branches, and IRS form routing.
- `docs/02-data-definitions.md` — Module 2: Configuration state, Form 1040 household records, entity/plan fields, and six-year time-series rules.
- `docs/03-workflows.md` — Module 3: Setup activation, six-year horizon rules, annual calculation sequence, and rolling forward workflow.

## Rolling Forecast Concept
1. **Year 1 (Actuals):** Mirrors the filed return line-for-line as the baseline anchor.
2. **Years 2–6 (Forecast):** Projects forward across five future years using configured assumptions, tax brackets, and plan milestones.
3. **Annual Roll:** Each year, the oldest actuals year retires, the prior Year 2 locks in as the new Year 1 actuals, and a new Year 6 projection slot opens at the end.
