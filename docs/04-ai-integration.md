# Module 4: AI-Assisted Intake, Validation & Explanation Rules

## 1. Role Boundaries: Deterministic Engine vs. AI Layer
- **Deterministic Calculation Engine (Source of Truth):** All federal/state tax brackets, standard/itemized deductions, Social Security taxability, QBI (Section 199A) limits, S-Corp basis/AAA tracking, PTE elections, and six-year rolling arithmetic execute exclusively in deterministic code. The AI layer never computes or overrides tax numbers freehand.
- **AI Collaboration Layer:** Assists with structured intake extraction, input completeness checks, anomaly/guardrail warnings, scenario setup, and plain-English explanations anchored strictly to engine outputs.

## 2. AI-Assisted Intake & Document Parsing
- **Guided Natural-Language Setup:** Translates plain-English user descriptions (such as entity structure, planned retirement glide path, or interstate moves) into structured Module 1 setup flags (`has_scorp`, `has_dbp`, `multi_state_active`, `residency_change_active`).
- **Year 1 Actuals Extraction:** Parses uploaded or pasted Form 1040, Form 1120-S, Schedule K-1, and state return summaries into Module 2 schema fields.
- **Provenance & Confidence Tagging:** Every AI-extracted field is tagged with `source_document`, `extracted_value`, and `confidence_level` (`high`, `medium`, `low`), requiring explicit user confirmation before locking Year 1 (`is_locked_actuals = true`).

## 3. Automated Validation & Guardrail Rules
Before passing data into the six-year calculation sequence (Module 3), the AI and schema validator enforce the following checks:
- **Year 1 Lock Integrity:** Blocks edits to locked Year 1 actuals unless the user explicitly triggers an amended-return unlock workflow.
- **S-Corp & Compensation Guardrails:** Flags missing `officer_w2_wages` when `ordinary_business_income_1120s > 0`, warns if `scorp_distributions_total` exceeds `stock_basis_ending`, and verifies `state_sourcing_breakdown` percentages sum to `100%`.
- **DBP & Retirement Milestones:** Checks that `dbp_actual_contribution <= dbp_max_deductible_contribution`, flags active contributions after `dbp_target_termination_year`, and verifies loan/collateral rules during plan wind-down.
- **Multi-State & Residency Consistency:** Validates that `residency_start_date` and `residency_end_date` align with `residency_day_or_income_ratio` when `residency_change_active = true`, and checks that other-state tax credits do not exceed statutory limitations.
- **Human-in-the-Loop Escalation:** Pauses calculation and prompts the user whenever required fields are missing or cross-form totals fail reconciliation.

## 4. Plain-English Explanation & Scenario Narrative Rules
- **Grounded Attribution:** Every dollar figure, marginal/effective rate, or year-over-year variance cited in an AI explanation must map directly to a named field in the deterministic output object.
- **Acronym & Rule Clarity:** Spells out specialized tax and plan acronyms on first use (such as Defined Benefit Plan [DBP], Pass-Through Entity [PTE], Qualified Business Income [QBI], and Accumulated Adjustments Account [AAA]) and explains multi-year drivers clearly.
- **Scenario Comparison Summaries:** Contrasts baseline vs. alternative forecasts (such as W-2 vs. distribution adjustments, DBP termination timing, or residency changes) across the full six-year window rather than single-year snapshots.
- **Scope & Disclaimer Guardrail:** Presents projections as educational planning models and flags complex edge cases (such as actuarial DBP funding limits or multi-state nexus rules) for CPA/actuary review.
