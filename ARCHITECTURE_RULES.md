# Multi-User Architecture Rules

This application is engineered as a **multi-household, multi-user tax planning platform** designed to work cleanly for **2,000+ independent households** across different birth dates, filing statuses, states, and business entities.

All future code changes, bug fixes, and features **MUST** comply with the five mandatory rules below.

---

## RULE 1 — Zero Hardcoded User Data
Never hardcode personal names, birth dates, birth months, salaries, Social Security benefit amounts, company/entity names, websites/domains, EINs, bank account names, or user-specific states inside calculation engines, schedulers, or UI components.

- **Required**: Read every user-specific value dynamically from the active `SetupConfig` (`setup`) or `TaxYearRecord` (`years`) state.
- **Forbidden**: Hardcoding literals such as `"Bill"`, `"Debra"`, `"1960-05-06"`, `39500`, `3291.67`, `"Operating Support Services, LLC"`, `"ossadvisorygroup.com"`, `"83-1706286"`, `"BlueVine"`, or assuming `"CA"` / `"AZ"` as every user's states inside `src/engine/*` or `src/components/*`.

---

## RULE 2 — Dynamic Labels & Footers
Every row label, section heading, card title, placeholder, status message, CSV header, and CPA report footer must pull dynamically from the active `SetupConfig`.

- **Examples**:
  - Taxpayer rows: `SS ${primaryName}`, `SS ${spouseName}`, `${primaryName} W-2 Compensation`, `${spouseName} Salaries & Wages`
  - State rows & badges: `${primaryStateName} S-Corp Revenue`, `${primaryStateCode} State Tax`, `${primaryStateCode} ${pct1}% / ${secondaryStateCode} ${pct2}%`
  - CPA report headers & footers: `Prepared by ${businessName}` (and `(${businessWebsite})` only when a website is configured in Setup; omit when blank).
- Use the shared helpers in `src/utils/setupHelpers.ts` (`getPersonNames`, `getBusinessIdentity`, `getStatePair`) rather than formatting fallback strings inline.

---

## RULE 3 — Isolated Default & Synthetic Profile Data
Any initial/default household seed, synthetic test persona, sample accounting dataset, or reference filed-return benchmark **MUST live exclusively in `src/data/profiles.ts`** (and `/data/sample-baseline.json` when loaded through it) — **and nowhere else in the codebase**.

- Engines (`src/engine/*`) and UI components (`src/components/*`) must never embed household defaults, sample client names, or personal dollar fallbacks.
- State normalizers (`normalizePlannerState`, `createBlankProfilePlannerState`, etc.) must use neutral, generic fallbacks (`"Primary"`, `"Spouse"`, `""` birth date, `""` business name/website, `$0` amounts) so arbitrary households are never polluted with another household's data.

---

## RULE 4 — Statutory Rules Only in Engines
Tax, Social Security (SSA), Medicare (CMS/IRMAA), retirement, and state engines (`src/engine/taxEngine.ts`, `src/engine/irmaa.ts`, `src/utils/personTax.ts`, etc.) may contain **only general statutory formulas and year-keyed regulatory tables**:

- Federal tax brackets, standard deductions, QDCG worksheets, NIIT, Additional Medicare Tax, QBI (§199A), Enhanced Senior Deduction (2025–2028 statutory sunset), SEHI Box 5 cap (Form 7206 / §162(l)(5)).
- SSA Full Retirement Age (FRA) by birth year, monthly Delayed Retirement Credits (+2/3% per suspended month between FRA and age 70), and annual COLA compounding.
- CMS Medicare IRMAA brackets by coverage year, filing status, and 2-year lookback MAGI.
- General US state tax rule tables (`STATE_TAX_RULES`) keyed by 2-letter state code.
- **Never** hardcode assumptions tied to one user's timeline (e.g., assuming FRA is always 2027, assuming birth month is May/August, or assuming a household lives in CA/AZ).

---

## RULE 5 — 2,000-User Litmus Test
Every new feature or bug fix must be tested against **all three workspace modes** in the Setup Profile Switcher (`My Profile | Test Persona | Blank User`) before merging:

1. **My Profile** — Real user data stored under its own isolated `localStorage` key, never overwritten by test modes.
2. **Test Persona** — A completely different synthetic household (different names, birth years/months, zero-income-tax state like TX, different entity name/website/EIN, different retirement & SS status).
3. **Blank User** — An empty household starting from scratch (blank names/dates/business/states, `$0` inputs) with zero NaN displays, zero broken labels, and zero leakage of another user's identity or numbers.

---

## Pre-Merge Audit Checklist
- [ ] Grep `src/engine` and `src/components` for personal names, birth dates, business names, domains, EINs, or personal dollar amounts — **0 hits** outside `src/data/profiles.ts`.
- [ ] Switch to **Test Persona** in Setup → confirm all Horizon labels, S-Corp/P&L labels, Planning Goals, and CPA Report headers/footers reflect the Test Persona's household, state, and business.
- [ ] Switch to **Blank User** in Setup → confirm clean generic labels, `$0` math, and zero errors.
- [ ] Switch back to **My Profile** → confirm all real user data is 100% intact.
