import * as XLSX from 'xlsx';
import type {
  BalanceSheetProjectionInputs,
  CadenceForecastMode,
  CadenceForecasterState,
  CadenceGroupingMode,
  CadenceTransactionRow,
  ComputedTaxYear,
  PayeeAliasRule,
  PnlBalanceSheetState,
  PnlLineAmounts,
  PnlLineId,
  SetupConfig,
} from '../types/tax';
import {
  PNL_LINE_ITEMS,
  calculatePnlBalanceSheet,
  computeRemainingRetirementFromHorizon,
  resolveHorizonRetirementTargets,
  type ComputedPnlBalanceSheet,
} from './pnlBalanceSheet';
import {
  buildTestPersonaCadence,
  createDefaultSeedCadenceTransactions,
  DEFAULT_PROFILE_SEED,
  isDefaultSeedSetup,
} from '../data/profiles';
import { getStateFullName } from '../utils/setupHelpers';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type BsAccountRole =
  | 'operating_cash'
  | 'cc_ap'
  | 'pension_payable'
  | 'member_draws'
  | 'capital_contributions'
  | 'opening_equity'
  | 'bs_other';

export type AccountRole =
  | { kind: 'pnl'; lineId: PnlLineId; note?: string }
  | { kind: 'bs'; bsRole: BsAccountRole; subAccount: string }
  | { kind: 'unmapped' };

export type AuditRowCategory =
  | 'transfer_cc_payment'
  | 'liability_payoff'
  | 'opening_balance'
  | 'duplicate'
  | 'unmapped'
  | 'non_target_year';

export interface CadenceAuditRow {
  id: string;
  date: string;
  transaction_type: string;
  vendor: string;
  account: string;
  split_account: string;
  amount: number;
  category: AuditRowCategory;
  reason: string;
}

export type DetectedCadenceType =
  | 'monthly'
  | 'biweekly'
  | 'semi_monthly'
  | 'quarterly'
  | 'variable_run_rate'
  | 'one_time';

export interface MonthlySeriesPoint {
  month: string; // YYYY-MM
  amount: number;
}

export interface CadenceStreamSummary {
  streamKey: string;
  vendor: string;
  targetLineId: PnlLineId;
  sourceAccounts: string[];
  transactionCount: number;
  dates: string[];
  ytdAmount: number;
  latestDate: string;
  latestAmount: number;
  detectedMode: Exclude<CadenceForecastMode, 'manual'>;
  detectedCadenceType: DetectedCadenceType;
  cadenceLabel: string;
  remainingDates: string[];
  remainingCount: number;
  cadenceRemainingAmount: number;
  runRateRemainingAmount: number;
  /** Calendar-month series from YYYY-01 through asOfDate's month (missing months filled as $0.00) */
  monthlySeries: MonthlySeriesPoint[];
  /** Number of calendar months with non-zero activity */
  activeMonthCount: number;
  /** Latest calendar month label (e.g. "2026-11") */
  latestMonthLabel: string;
  /** Actual sum in the latest calendar month */
  latestMonthActual: number;
  /** Final smoothed monthly level S_T from Simple Exponential Smoothing */
  expSmoothLevel: number;
  /** Remaining-year forecast under Exp. Smooth (S_T directly when <=45d remain, or scaled by remainingDays/30.4375) */
  expSmoothRemainingAmount: number;
  /** Scale note for Exp. Smooth (e.g. "1 mo (S_T)" or "40/30.44d (1.31x)") */
  expSmoothScaleNote: string;
  activeMode: CadenceForecastMode;
  effectiveRemainingAmount: number;
  isOverridden: boolean;
  /** True if one or more transactions in this P&L stream had "Transfer to " or "Credit Card Payment" in Description */
  hasTransferFlag: boolean;
  flaggedTransferCount: number;
  flaggedTransferNote?: string;
  /** Distinct original raw vendor/payee names grouped into this stream */
  mergedRawVendors: string[];
  /** Number of transactions in this stream rewritten by a Payee / Description Alias rule */
  appliedAliasCount: number;
  /** True when one or more alias rules contributed to this stream */
  isAliased: boolean;
  /** True when this row represents a rolled-up P&L Category instead of a single granular vendor stream */
  isCategoryRow?: boolean;
  /** Clean operational QBO P&L category name when in Category Rollup mode */
  categoryName?: string;
  /** Count of distinct payee/vendor sub-streams aggregated into this P&L category */
  subStreamCount?: number;
  /** True when a category has irregular/variable multi-tx activity (prime candidate for 1-click Exp. Smooth) */
  isVariableCategory?: boolean;
}

export interface QboReconciliationItem {
  id: string;
  label: string;
  computed: number;
  expected: number | null;
  variance: number | null;
  status: 'matched' | 'variance' | 'info';
}

export interface ComputedCadenceForecast {
  asOfDate: string;
  projectionYear: number;
  ledgerFormat: 'general_ledger' | 'transaction_list';
  groupingMode: CadenceGroupingMode;
  expSmoothAlpha: number;
  expSmoothDayFraction: boolean;
  elapsedDays: number;
  remainingDays: number;
  totalDaysInYear: number;
  /** Active forecast rows (categoryStreams in 'category' mode, granularStreams in 'stream' mode) */
  streams: CadenceStreamSummary[];
  /** Always-available P&L Category rolled-up rows */
  categoryStreams: CadenceStreamSummary[];
  /** Always-available granular vendor/payee stream rows */
  granularStreams: CadenceStreamSummary[];
  categoryCount: number;
  granularStreamCount: number;
  auditRows: CadenceAuditRow[];
  parsedTransactionCount: number;
  pnlTransactionCount: number;
  bsSectionEntryCount: number;
  transferExcludedCount: number;
  unmappedCount: number;
  flaggedTransferStreamCount: number;
  activeAliasCount: number;
  aliasedTransactionCount: number;
  aliasedStreamCount: number;
  aliasMatchCounts: Record<string, number>;
  /** Synthesized PnlBalanceSheetState ready for calculatePnlBalanceSheet, CSV, Print & Push */
  synthesizedPnlState: PnlBalanceSheetState;
  /** Full Form 1120-S, Schedule L, and Form 7203 computed projection */
  pnlComputed: ComputedPnlBalanceSheet;
  /** Auto-computed YTD & Remaining by P&L line before direct table overrides */
  autoPnlByLine: Record<PnlLineId, PnlLineAmounts>;
  /** Auto-computed Balance Sheet values rolled up from transactions */
  autoBsRollup: {
    operating_cash_beg: number;
    operating_cash_ytd: number;
    cc_ap_beg: number;
    cc_ap_ytd: number;
    pension_payable_beg: number;
    pension_payable_ytd: number;
    member_draws_ytd: number;
    capital_contributions_ytd: number;
  };
  /** QBO Reconciliation Check metrics */
  reconciliation: {
    ytdRevenue: number;
    ytdBookExpenses: number;
    ytdInterestIncome: number;
    ytdCash: number;
    ytdCreditCards: number;
    ytdMemberDraws: number;
    items: QboReconciliationItem[];
    allMatched: boolean;
  };
}

// ============================================================================
// UTC-Safe Date Utilities
// ============================================================================

const MS_PER_DAY = 86_400_000;

export function parseIsoDateToUtcMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

export function formatUtcMsToIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

export function daysInMonthUtc(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function getYearDayProgress(asOfDate: string, year: number): {
  elapsedDays: number;
  remainingDays: number;
  totalDaysInYear: number;
} {
  const jan1 = Date.UTC(year, 0, 1);
  const dec31 = Date.UTC(year, 11, 31);
  const totalDaysInYear = Math.round((dec31 - jan1) / MS_PER_DAY) + 1;
  const parsed = parseIsoDateToUtcMs(asOfDate);
  const clamped =
    parsed === null ? Date.UTC(year, 10, 21) : Math.max(jan1, Math.min(dec31, parsed));
  const elapsedDays = Math.round((clamped - jan1) / MS_PER_DAY) + 1;
  const remainingDays = Math.max(0, totalDaysInYear - elapsedDays);
  return { elapsedDays, remainingDays, totalDaysInYear };
}

function normalizeDateString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    // Use UTC components to avoid local timezone drift on Excel dates
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    if (y >= 1990 && y <= 2100) return `${y}-${m}-${d}`;
    return null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 30000 && raw < 80000) {
    // Excel serial date (days since 1899-12-30)
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw) * MS_PER_DAY;
    return formatUtcMsToIso(ms);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // MM/DD/YYYY or M/D/YY
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(s);
  if (m) {
    const mo = Number(m[1]);
    const day = Number(m[2]);
    let yr = Number(m[3]);
    if (yr < 100) yr += yr >= 70 ? 1900 : 2000;
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseNumericToken(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? round2(raw) : null;
  }
  const s = String(raw ?? '').trim();
  if (!s || s === '-' || s === '—') return null;
  const isParenNeg = s.startsWith('(') && s.endsWith(')');
  const cleaned = s.replace(/[$,()\s]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return round2(isParenNeg ? -Math.abs(num) : num);
}

// ============================================================================
// Accounting / QBO Account Classifier (Dynamic per Active Household Setup)
// ============================================================================

function escapeRegexToken(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classifyTransactionAccount(
  rawAccount: string,
  setup?: SetupConfig | null
): AccountRole {
  const cleaned = rawAccount.trim();
  if (!cleaned || /^-split-$/i.test(cleaned)) return { kind: 'unmapped' };

  // Split hierarchical QBO path (e.g. "Salary : Primary", "Travel Expense:Business Meals (100%)")
  const segments = cleaned
    .split(/\s*(?::|->|→)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const leaf = segments[segments.length - 1] ?? cleaned;
  const leafLower = leaf.toLowerCase();
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
  const parentLower = parent.toLowerCase();
  const fullLower = cleaned.toLowerCase();

  const primaryFirst = (setup?.primary_name ?? '').trim().split(/\s+/)[0] ?? '';
  const spouseFirst = (setup?.spouse_name ?? '').trim().split(/\s+/)[0] ?? '';
  const primaryStateCode = (setup?.home_state ?? '').trim().toUpperCase();
  const primaryStateName = primaryStateCode ? getStateFullName(primaryStateCode) : '';
  const secondaryStateCode = (setup?.secondary_state ?? '').trim().toUpperCase();
  const secondaryStateName = secondaryStateCode ? getStateFullName(secondaryStateCode) : '';

  const matchesState = (text: string, code: string, name: string): boolean => {
    if (!code) return false;
    const parts = [escapeRegexToken(code)];
    if (name && name.toLowerCase() !== code.toLowerCase()) parts.push(escapeRegexToken(name));
    return new RegExp(`\\b(${parts.join('|')})\\b`, 'i').test(text);
  };

  // ---- 1. Balance Sheet Accounts (Explicitly mapped; NEVER treated as P&L) ----

  // Operating Cash: Checking / Savings / Operating Cash accounts
  if (
    /(checking|savings|operating\s*cash|business\s*bank|money\s*market)/i.test(leafLower) &&
    !/credit card|\bcc\b/i.test(leafLower)
  ) {
    return { kind: 'bs', bsRole: 'operating_cash', subAccount: leaf };
  }

  // Fraud & Other Balance Sheet Clearing / Asset / Liability Accounts (NOT cash, NOT P&L)
  if (
    /^fraud$/i.test(leafLower) ||
    /^(accounts receivable|a\/r|undeposited funds|uncategorized asset|prepaid expenses?|security deposit|fixed assets?|accumulated depreciation|payroll liabilities|sales tax payable|loan payable|shareholder loan|due to|due from|inventory)/i.test(
      leafLower
    )
  ) {
    return { kind: 'bs', bsRole: 'bs_other', subAccount: leaf };
  }

  // Credit Cards & Accounts Payable
  const extraCardNames = isDefaultSeedSetup(setup)
    ? DEFAULT_PROFILE_SEED.default_cadence_2026.extra_card_account_names
    : [];
  const matchesExtraCard = extraCardNames.some((token) => leafLower.includes(token));
  if (
    matchesExtraCard ||
    /(\bcc\b|credit card|accounts payable|\ba\/p\b|\bsavor\b|capital\s*one|amex|visa|mastercard|chase\s*ink)/i.test(
      leafLower
    )
  ) {
    return { kind: 'bs', bsRole: 'cc_ap', subAccount: leaf };
  }

  // Retirement / Pension Payables (Balance Sheet Liabilities)
  if (/(defined benefit.*payable|pension.*payable|dbp.*payable|401\(?k\)?.*payable)/i.test(leafLower)) {
    return { kind: 'bs', bsRole: 'pension_payable', subAccount: leaf };
  }

  // Member Draws (including any sub-account directly under Member Draws)
  if (
    /member\s*draws?|shareholder\s*dist|owner.*draw/i.test(leafLower) ||
    /member\s*draws?|shareholder\s*dist|owner.*draw/i.test(parentLower)
  ) {
    return { kind: 'bs', bsRole: 'member_draws', subAccount: leaf };
  }

  // Capital Contributions
  if (
    /capital\s*contrib|paid[- ]in\s*capital|member\s*contrib|owner.*contrib/i.test(leafLower) ||
    /capital\s*contrib|paid[- ]in\s*capital|member\s*contrib|owner.*contrib/i.test(parentLower)
  ) {
    return { kind: 'bs', bsRole: 'capital_contributions', subAccount: leaf };
  }

  // Equity Accounts (Member Equity, Opening Balance Equity, Retained Earnings)
  if (
    /member\s*equity|opening\s*balance\s*equity|retained\s*earnings|owner'?s?\s*equity|common\s*stock|additional\s*paid[- ]in/i.test(
      leafLower
    )
  ) {
    return { kind: 'bs', bsRole: 'opening_equity', subAccount: leaf };
  }

  // ---- 2. P&L Revenue Accounts (dynamically matched by active profile states) ----
  const isRevAccount =
    /(rev|sales|income|consult|services?|retainer|advisory|billing|fee)/i.test(fullLower) &&
    !/tax|expense|interest|payroll|bank|legal|professional/i.test(fullLower);

  if (isRevAccount && primaryStateCode && matchesState(fullLower, primaryStateCode, primaryStateName)) {
    return { kind: 'pnl', lineId: 'ca_revenue' };
  }
  if (
    (isRevAccount &&
      secondaryStateCode &&
      matchesState(fullLower, secondaryStateCode, secondaryStateName)) ||
    /^services\s*income$/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: secondaryStateCode ? 'az_revenue' : 'ca_revenue' };
  }

  // ---- 3. Schedule K Line 4 Interest Income (BEFORE generic income / interest expense) ----
  if (/^interest\s*income$/i.test(leafLower) || /interest earned|bank interest/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'schedule_k_interest' };
  }

  // ---- 4. SEHI Medicare Premiums (BEFORE Compensation so Shareholder Health never hits Salary) ----
  if (
    /shareholder\s*health/i.test(leafLower) ||
    /shareholder\s*health/i.test(parentLower) ||
    /\bsehi\b|medicare\s*prem/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'sehi_medicare' };
  }

  // ---- 5. Compensation (dynamically matched by active household names + generic officer/wages) ----
  const primaryRe = primaryFirst.length >= 2 ? new RegExp(`\\b${escapeRegexToken(primaryFirst)}\\b`, 'i') : null;
  const spouseRe = spouseFirst.length >= 2 ? new RegExp(`\\b${escapeRegexToken(spouseFirst)}\\b`, 'i') : null;
  const isPayrollPath = /(salary|wages|payroll|comp|officer)/i.test(fullLower);

  if (
    (primaryRe && (new RegExp(`^${escapeRegexToken(primaryFirst)}$`, 'i').test(leafLower) || (isPayrollPath && primaryRe.test(leafLower)))) ||
    /officer\s*(comp|w-?2)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'bill_officer_w2' };
  }

  if (
    (spouseRe && (new RegExp(`^${escapeRegexToken(spouseFirst)}$`, 'i').test(leafLower) || (isPayrollPath && spouseRe.test(leafLower)))) ||
    /salaries\s*(&|and)\s*wages/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'debra_salaries_wages' };
  }

  // ---- 6. Retirement ----
  if (/(defined benefit|\bdbp\b|cash balance|pension.*contrib)/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'dbp_contribution' };
  }
  if (/(401\(?k\)?|profit sharing|employer.*match|safe harbor)/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'employer_401k' };
  }

  // ---- 7. Meals (100% Gross — MUST run BEFORE Travel so Travel meal sub-accounts map to Meals!) ----
  if (
    /business meals at restaurant/i.test(leafLower) ||
    /meals at restaurant/i.test(leafLower) ||
    /business meals\s*\(?100%?\)?/i.test(leafLower) ||
    /^business meals$/i.test(leafLower) ||
    /solo meals/i.test(leafLower) ||
    /^individual meals$/i.test(leafLower) ||
    /\bmeals?\b/i.test(leafLower)
  ) {
    const fromTravel = /travel/i.test(parentLower) || /travel/i.test(fullLower);
    return {
      kind: 'pnl',
      lineId: 'meals_gross',
      note: fromTravel ? 'Moved from Travel to Meals (100% Gross)' : undefined,
    };
  }

  // ---- 8. Travel (Excl. Meals: Airfare, Ground Transportation, Lodging) ----
  if (
    /^airfare$/i.test(leafLower) ||
    /^ground transportation$/i.test(leafLower) ||
    /^lodging$/i.test(leafLower) ||
    /ground transportation|lodging|airfare|hotel|flight|mileage|parking|^travel(\s+expense)?$/i.test(
      leafLower
    )
  ) {
    return { kind: 'pnl', lineId: 'travel' };
  }

  // ---- 9. Taxes & Licenses: Payroll Taxes vs State Entity / Franchise Tax ----
  if (
    /^fed$/i.test(leafLower) ||
    /^medcare$/i.test(leafLower) ||
    /(payroll tax|fica|futa|suta|edd|\bsdi\b|sui-?er)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'payroll_taxes' };
  }

  if (
    /^state$/i.test(leafLower) ||
    /(\bftb\b|franchise tax|state\s*tax|100s)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'ca_ftb_tax' };
  }

  // ---- 10. Rents ----
  if (/^rent\s*expense$/i.test(leafLower) || /\brents?\b|\blease\b|office space/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'rents' };
  }

  // ---- 11. Professional Fees (+ legal fees) ----
  if (
    /^professional fees?$/i.test(leafLower) ||
    /^legal fees?$/i.test(leafLower) ||
    /professional fees?|legal fees?|accounting|\bcpa\b|attorney|actuar|bookkeep/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'professional_fees' };
  }

  // ---- 12. Subscriptions & Software ----
  if (
    /^subscriptions?$/i.test(leafLower) ||
    /subscription|software|saas|dues|membership|cloud|quickbooks/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'subscriptions_software' };
  }

  // ---- 13. Telephone & Internet ----
  if (
    /^telephone expense$/i.test(leafLower) ||
    /^internet$/i.test(leafLower) ||
    /^computer and internet expenses?$/i.test(leafLower) ||
    /telephone|phone|wireless|broadband|telecom|internet/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'telephone_internet' };
  }

  // ---- 14. Office Expense (Office Equipment + Office Supplies) ----
  if (
    /^office equipment$/i.test(leafLower) ||
    /^office supplies$/i.test(leafLower) ||
    /office equipment|office supplies|office exp|stationery|printing/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'office_expense' };
  }

  // ---- 15. Insurance (business insurance; Shareholder Health matched above) ----
  if (
    /^insurance expense$/i.test(leafLower) ||
    /insurance|liability|e&o|workers comp/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'insurance' };
  }

  // ---- 16. Utilities ----
  if (/^utilities$/i.test(leafLower) || /utilit|electric|water|gas|power|trash/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'utilities' };
  }

  // ---- 17. Bank & Payroll Processing Fees ----
  if (
    /^bank service charges?$/i.test(leafLower) ||
    /^payroll expenses?$/i.test(leafLower) ||
    /bank service charges?|payroll expenses?|bank.*fee|merchant|processing|gusto|adp/i.test(
      leafLower
    )
  ) {
    return { kind: 'pnl', lineId: 'bank_payroll_fees' };
  }

  // ---- 18. Other Deductions ----
  if (
    /^continuing education$/i.test(leafLower) ||
    /^interest expense$/i.test(leafLower) ||
    /^petty cash$/i.test(leafLower) ||
    /^shipping$/i.test(leafLower) ||
    /continuing education|interest expense|petty cash|shipping|postage|advertising|marketing|repair|maintenance|charit|donat|other|misc|uncategorized expense/i.test(
      leafLower
    )
  ) {
    return { kind: 'pnl', lineId: 'other_deductions' };
  }

  return { kind: 'unmapped' };
}

// ============================================================================
// CSV / TSV / XLSX General Ledger & Transaction List Ingestion
// ============================================================================

/**
 * Full RFC-4180 CSV parser preserving leading spaces inside cells (for QBO GL indentation)
 * and handling embedded newlines, escaped quotes (""), and quoted thousands separators.
 */
function parseCsvToMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseTsvToMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => line.split('\t').map((c) => c.replace(/^"|"$/g, '')));
}

interface ColumnMap {
  date: number;
  type: number;
  num: number;
  vendor: number;
  memo: number;
  account: number;
  split: number;
  amount: number;
  balance: number;
  debit: number;
  credit: number;
}

function detectColumnMap(headerRow: string[]): ColumnMap | null {
  const lower = headerRow.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const findCol = (patterns: RegExp[]) =>
    lower.findIndex((cell) => patterns.some((re) => re.test(cell)));

  const date = findCol([/^date$/, /^trans(?:action)?\s*date$/]);
  const amount = findCol([/^amount$/, /^net\s*amount$/, /^total$/]);
  const balance = findCol([/^balance$/, /^running\s*balance$/]);
  const debit = findCol([/^debit$/]);
  const credit = findCol([/^credit$/]);

  if (date === -1 || (amount === -1 && debit === -1 && credit === -1)) {
    return null;
  }

  return {
    date,
    type: findCol([/^transaction\s*type$/, /^trans\s*type$/, /^type$/]),
    num: findCol([/^num$/, /^no\.?$/, /^ref/, /^check\s*num/, /^doc\s*num/]),
    vendor: findCol([/^name\/vendor$/, /^vendor\/name$/, /^full\s*name$/, /^name$/, /^vendor$/, /^payee$/, /^customer$/]),
    memo: findCol([/^memo\/description$/, /^line\s*description$/, /^memo$/, /^description$/]),
    account: findCol([/^account$/, /^distribution\s*account$/, /^source\s*account$/]),
    split: findCol([/^split\s*account$/, /^split$/, /^split\/account$/, /^category$/]),
    amount,
    balance,
    debit,
    credit,
  };
}

const QBO_NON_ACCOUNT_BANNER_RE =
  /^(general ledger|transaction list|accrual basis|cash basis|all dates|monday,|tuesday,|wednesday,|thursday,|friday,|saturday,|sunday,|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d)|,\s*(llc|inc\.?|corp\.?|pllc|llp)\s*$/i;

const QBO_GENERIC_CONTAINER_RE =
  /^(assets?|bank accounts?|current assets?|other current assets?|fixed assets?|liabilities?|credit cards?|current liabilities?|other current liabilities?|long[- ]term liabilities?|equity|income|ordinary income|cost of goods sold|expenses?|other income|other expenses?)$/i;

export interface ParsedQboTransactionsResult {
  transactions: CadenceTransactionRow[];
  detectedAsOfDate: string | null;
  detectedYear: number | null;
  ledgerFormat: 'general_ledger' | 'transaction_list';
}

export function parseTransactionMatrix(matrix: unknown[][]): ParsedQboTransactionsResult {
  let headerIdx = -1;
  let colMap: ColumnMap | null = null;
  let titleMentionsGl = false;

  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const strRow = (matrix[i] ?? []).map((cell) => String(cell ?? '').trim());
    if (strRow.some((c) => /\bgeneral ledger\b/i.test(c))) {
      titleMentionsGl = true;
    }
    const candidate = detectColumnMap(strRow);
    if (candidate) {
      headerIdx = i;
      colMap = candidate;
      break;
    }
  }

  // Fallback positional order if user pasted headless rows: Date, Type, Num, Name, Memo, Account, Split, Amount
  if (!colMap) {
    colMap = {
      date: 0,
      type: 1,
      num: 2,
      vendor: 3,
      memo: 4,
      account: 5,
      split: 6,
      amount: 7,
      balance: -1,
      debit: -1,
      credit: -1,
    };
    headerIdx = -1;
  }

  const transactions: CadenceTransactionRow[] = [];
  const pendingBeginningBalances: CadenceTransactionRow[] = [];

  interface SectionFrame {
    name: string;
    indent: number;
    hadDirectRows: boolean;
  }
  const sectionStack: SectionFrame[] = [];
  let sawGlSectionHeaders = false;
  let sawBeginningBalanceRow = false;
  let sawTotalForRow = false;
  let maxDate: string | null = null;

  const getCurrentSectionPath = (): string => {
    const meaningful = sectionStack
      .map((f) => f.name)
      .filter((name) => !QBO_GENERIC_CONTAINER_RE.test(name));
    if (meaningful.length === 0) {
      return sectionStack[sectionStack.length - 1]?.name ?? '';
    }
    // Keep immediate parent + leaf (at most 2 levels) so distant unclosed banners never pollute classification
    if (meaningful.length >= 2) {
      return `${meaningful[meaningful.length - 2]} : ${meaningful[meaningful.length - 1]}`;
    }
    return meaningful[0];
  };

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    if (row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const rawFirstCell = String(row[0] ?? '');
    const firstCell = rawFirstCell.trim();
    const firstIndent = rawFirstCell.length - rawFirstCell.trimStart().length;

    const dateCellStr = String(row[colMap.date] ?? '').trim();
    const typeCellStr = colMap.type !== -1 ? String(row[colMap.type] ?? '').trim() : '';
    const memoCellStr = colMap.memo !== -1 ? String(row[colMap.memo] ?? '').trim() : '';

    // 1. Detect "Total for <Section>" / "TOTAL" / "Grand Total" rows and pop sectionStack cleanly
    if (
      /^total\b/i.test(firstCell) ||
      /^grand\s+total/i.test(firstCell) ||
      /^total\b/i.test(dateCellStr)
    ) {
      const totalMatch = /^total\s+(?:for\s+)?(.+?)(?:\s+with\s+sub-accounts)?$/i.exec(firstCell);
      if (totalMatch && totalMatch[1]) {
        sawTotalForRow = true;
        const targetName = totalMatch[1].trim().toLowerCase();
        let matchIdx = -1;
        for (let s = sectionStack.length - 1; s >= 0; s--) {
          if (sectionStack[s].name.toLowerCase() === targetName) {
            matchIdx = s;
            break;
          }
        }
        if (matchIdx !== -1) {
          sectionStack.length = matchIdx;
        } else if (sectionStack.length > 0) {
          sectionStack.pop();
        }
      } else {
        sectionStack.length = 0;
      }
      continue;
    }

    // 2. Skip QBO report footers ("Accrual Basis ...", "Cash Basis ...", report titles)
    if (QBO_NON_ACCOUNT_BANNER_RE.test(firstCell) && !normalizeDateString(row[colMap.date])) {
      continue;
    }

    // 3. Detect QBO General Ledger "Beginning Balance" rows (Date="Beginning Balance", Balance=51,551.38)
    const isBegBalRow =
      /^beginning\s+balance$/i.test(dateCellStr) ||
      /^beginning\s+balance$/i.test(firstCell) ||
      /^beginning\s+balance$/i.test(typeCellStr) ||
      /^beginning\s+balance$/i.test(memoCellStr);

    if (isBegBalRow) {
      sawBeginningBalanceRow = true;
      // Handle rare QBO layout where account name in Col A and "Beginning Balance" in Col B appear on the same row
      if (
        firstCell.length > 0 &&
        !/^beginning\s+balance$/i.test(firstCell) &&
        parseNumericToken(firstCell) === null
      ) {
        sectionStack.push({ name: firstCell, indent: firstIndent, hadDirectRows: false });
      }
      const begBal =
        (colMap.balance !== -1 ? parseNumericToken(row[colMap.balance]) : null) ??
        (colMap.amount !== -1 ? parseNumericToken(row[colMap.amount]) : null);
      const secPath = getCurrentSectionPath();
      if (begBal !== null && secPath) {
        if (sectionStack.length > 0) {
          sectionStack[sectionStack.length - 1].hadDirectRows = true;
        }
        pendingBeginningBalances.push({
          id: `beg-${r}-${pendingBeginningBalances.length}`,
          date: '', // backfilled with detectedYear-01-01 after scanning
          transaction_type: 'Beginning Balance',
          num: '',
          vendor: 'Beginning Balance',
          memo: `GL Beginning Balance (${secPath})`,
          account: secPath,
          split_account: 'Opening Balance Equity',
          amount: round2(begBal),
          running_balance: round2(begBal),
          is_beginning_balance: true,
          gl_section: secPath,
        });
      }
      continue;
    }

    // 4. Parse transaction date
    const parsedDate = normalizeDateString(row[colMap.date]);
    if (!parsedDate) {
      // In QBO General Ledger exports, a section / account header appears in Column A with no date
      const hasColAText = firstCell.length > 0 && parseNumericToken(firstCell) === null;
      const otherCellsNonEmpty = row
        .slice(1)
        .map((c) => String(c ?? '').trim())
        .filter((s) => s.length > 0);

      if (hasColAText && otherCellsNonEmpty.length === 0) {
        sawGlSectionHeaders = true;
        // If indentation is present and smaller/equal to top, unwind to matching parent depth
        while (
          sectionStack.length > 0 &&
          firstIndent > 0 &&
          sectionStack[sectionStack.length - 1].indent >= firstIndent
        ) {
          sectionStack.pop();
        }
        // If top of stack already had direct rows and new header is at same indent (flat export without Total row)
        if (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1].hadDirectRows &&
          firstIndent <= sectionStack[sectionStack.length - 1].indent
        ) {
          sectionStack.pop();
        }
        sectionStack.push({ name: firstCell, indent: firstIndent, hadDirectRows: false });
      }
      continue;
    }

    // 5. Parse Amount & optional running Balance
    let amount: number | null = null;
    if (colMap.amount !== -1) {
      amount = parseNumericToken(row[colMap.amount]);
    }
    if (amount === null && (colMap.debit !== -1 || colMap.credit !== -1)) {
      const deb = colMap.debit !== -1 ? parseNumericToken(row[colMap.debit]) ?? 0 : 0;
      const cred = colMap.credit !== -1 ? parseNumericToken(row[colMap.credit]) ?? 0 : 0;
      if (deb !== 0 || cred !== 0) {
        amount = round2(deb - cred);
      }
    }
    if (amount === null) continue;

    const runningBalance =
      colMap.balance !== -1 ? parseNumericToken(row[colMap.balance]) : null;

    const num = colMap.num !== -1 ? String(row[colMap.num] ?? '').trim() : '';
    const vendorRaw = colMap.vendor !== -1 ? String(row[colMap.vendor] ?? '').trim() : '';
    const accountRaw =
      colMap.account !== -1 && colMap.account !== 0
        ? String(row[colMap.account] ?? '').trim()
        : colMap.account === 0
        ? firstCell
        : '';
    const splitRaw = colMap.split !== -1 ? String(row[colMap.split] ?? '').trim() : '';

    const secPath = getCurrentSectionPath();
    if (sectionStack.length > 0) {
      sectionStack[sectionStack.length - 1].hadDirectRows = true;
    }

    // Column A section header ALWAYS defines the true account in a QBO General Ledger export
    const account = secPath || accountRaw;
    const split = splitRaw;
    const vendor = vendorRaw || memoCellStr || split || account || 'Unnamed Vendor';

    if (!maxDate || parsedDate > maxDate) {
      maxDate = parsedDate;
    }

    transactions.push({
      id: `tx-${r}-${parsedDate}-${transactions.length}`,
      date: parsedDate,
      transaction_type: typeCellStr || 'Transaction',
      num,
      vendor,
      memo: memoCellStr,
      account,
      split_account: split,
      amount: round2(amount),
      ...(runningBalance !== null ? { running_balance: runningBalance } : {}),
      ...(secPath ? { gl_section: secPath } : {}),
    });
  }

  const detectedYear = maxDate ? Number(maxDate.slice(0, 4)) : null;
  const begDate = `${detectedYear ?? 2026}-01-01`;

  // Prepend Beginning Balance rows with normalized Jan 1 date of detected year
  const allTransactions: CadenceTransactionRow[] = [
    ...pendingBeginningBalances.map((b) => ({ ...b, date: begDate })),
    ...transactions,
  ];

  const isGeneralLedger =
    titleMentionsGl ||
    sawGlSectionHeaders ||
    sawBeginningBalanceRow ||
    sawTotalForRow ||
    (colMap.date >= 1 && colMap.balance !== -1);

  return {
    transactions: allTransactions,
    detectedAsOfDate: maxDate,
    detectedYear,
    ledgerFormat: isGeneralLedger ? 'general_ledger' : 'transaction_list',
  };
}

export function parseQboTransactionText(rawText: string): ParsedQboTransactionsResult {
  const sampleLines = rawText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const tabLineCount = sampleLines.filter((l) => l.includes('\t')).length;
  const isTsv = tabLineCount >= Math.max(1, sampleLines.length * 0.4);
  const matrix = isTsv ? parseTsvToMatrix(rawText) : parseCsvToMatrix(rawText);
  return parseTransactionMatrix(matrix);
}

export function parseQboTransactionArrayBuffer(
  buffer: ArrayBuffer,
  fileName = 'upload.xlsx'
): ParsedQboTransactionsResult {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    const decoder = new TextDecoder('utf-8');
    return parseQboTransactionText(decoder.decode(buffer));
  }

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
    });
    const parsed = parseTransactionMatrix(matrix);
    if (parsed.transactions.length > 0) {
      return parsed;
    }
  }

  return {
    transactions: [],
    detectedAsOfDate: null,
    detectedYear: null,
    ledgerFormat: 'transaction_list',
  };
}

// ============================================================================
// Cadence Detection Engine (As-Of Date + 1 through 12/31)
// ============================================================================

const ONE_TIME_DEFAULT_LINES = new Set<PnlLineId>([
  'dbp_contribution',
  'employer_401k',
  'ca_ftb_tax',
]);

export const PAYEE_ALIASES_STORAGE_KEY = 'rolling-tax-planner-payee-aliases-v1';

export function loadSavedPayeeAliases(): PayeeAliasRule[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(PAYEE_ALIASES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PayeeAliasRule =>
          item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.pattern === 'string' &&
          typeof item.canonical_name === 'string' &&
          item.pattern.trim().length > 0 &&
          item.canonical_name.trim().length > 0
      )
      .map((item) => ({
        id: item.id,
        pattern: item.pattern.trim(),
        match_type: item.match_type === 'exact' ? 'exact' : 'contains',
        canonical_name: item.canonical_name.trim(),
      }));
  } catch {
    return [];
  }
}

export function savePayeeAliases(aliases: PayeeAliasRule[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PAYEE_ALIASES_STORAGE_KEY, JSON.stringify(aliases));
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}

export interface ResolvedPayeeResult {
  canonicalVendor: string;
  matchedRule: PayeeAliasRule | null;
  rawVendor: string;
}

/**
 * Resolves a transaction's raw payee/vendor and description/memo against user-defined
 * Payee / Description Alias rules BEFORE stream grouping, cadence, run-rate, or
 * exponential smoothing calculations run.
 * Exact matches are evaluated first, followed by case-insensitive substring ('contains') rules.
 */
export function resolveCanonicalPayee(
  rawVendor: string,
  rawMemo: string,
  aliases?: PayeeAliasRule[]
): ResolvedPayeeResult {
  const trimmedVendor = rawVendor.trim();
  const trimmedMemo = rawMemo.trim();
  if (!aliases || aliases.length === 0) {
    return { canonicalVendor: trimmedVendor, matchedRule: null, rawVendor: trimmedVendor };
  }

  const vendorLower = trimmedVendor.toLowerCase();
  const memoLower = trimmedMemo.toLowerCase();

  // Pass 1: Exact matches (case-insensitive)
  for (const rule of aliases) {
    if (rule.match_type !== 'exact') continue;
    const pattern = rule.pattern.trim().toLowerCase();
    const canonical = rule.canonical_name.trim();
    if (!pattern || !canonical) continue;
    if (vendorLower === pattern || (memoLower !== '' && memoLower === pattern)) {
      return { canonicalVendor: canonical, matchedRule: rule, rawVendor: trimmedVendor };
    }
  }

  // Pass 2: Substring / contains matches (case-insensitive)
  for (const rule of aliases) {
    if (rule.match_type === 'exact') continue;
    const pattern = rule.pattern.trim().toLowerCase();
    const canonical = rule.canonical_name.trim();
    if (!pattern || !canonical) continue;
    if (vendorLower.includes(pattern) || (memoLower !== '' && memoLower.includes(pattern))) {
      return { canonicalVendor: canonical, matchedRule: rule, rawVendor: trimmedVendor };
    }
  }

  return { canonicalVendor: trimmedVendor, matchedRule: null, rawVendor: trimmedVendor };
}

function normalizeVendorKey(vendor: string): string {
  return vendor
    .toLowerCase()
    .replace(/[#*]\d+/g, '')
    .replace(/\b(inc|llc|corp|co|ltd)\.?$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function projectRemainingMonthlyDates(
  anchorDay: number,
  asOfDate: string,
  year: number
): string[] {
  const asOfMs = parseIsoDateToUtcMs(asOfDate);
  if (asOfMs === null) return [];
  const asOfDt = new Date(asOfMs);
  const startMonth = asOfDt.getUTCFullYear() === year ? asOfDt.getUTCMonth() + 1 : 1;
  const dec31Ms = Date.UTC(year, 11, 31);
  const results: string[] = [];

  for (let month = startMonth; month <= 12; month++) {
    const clampedDay = Math.min(anchorDay, daysInMonthUtc(year, month));
    const candMs = Date.UTC(year, month - 1, clampedDay);
    if (candMs > asOfMs && candMs <= dec31Ms) {
      results.push(formatUtcMsToIso(candMs));
    }
  }
  return results;
}

function projectRemainingBiweeklyDates(
  lastDate: string,
  intervalDays: number,
  asOfDate: string,
  year: number
): string[] {
  const lastMs = parseIsoDateToUtcMs(lastDate);
  const asOfMs = parseIsoDateToUtcMs(asOfDate);
  if (lastMs === null || asOfMs === null) return [];
  const dec31Ms = Date.UTC(year, 11, 31);
  const stepMs = Math.round(intervalDays) * MS_PER_DAY;
  const results: string[] = [];

  let cursor = lastMs + stepMs;
  let guard = 0;
  while (cursor <= dec31Ms && guard < 40) {
    if (cursor > asOfMs) {
      results.push(formatUtcMsToIso(cursor));
    }
    cursor += stepMs;
    guard++;
  }
  return results;
}

function projectRemainingSemiMonthlyDates(
  dayA: number,
  dayB: number,
  asOfDate: string,
  year: number
): string[] {
  const asOfMs = parseIsoDateToUtcMs(asOfDate);
  if (asOfMs === null) return [];
  const asOfDt = new Date(asOfMs);
  const startMonth = asOfDt.getUTCFullYear() === year ? asOfDt.getUTCMonth() + 1 : 1;
  const dec31Ms = Date.UTC(year, 11, 31);
  const days = [Math.min(dayA, dayB), Math.max(dayA, dayB)];
  const results: string[] = [];

  for (let month = startMonth; month <= 12; month++) {
    const dim = daysInMonthUtc(year, month);
    for (const d of days) {
      const clamped = Math.min(d, dim);
      const candMs = Date.UTC(year, month - 1, clamped);
      if (candMs > asOfMs && candMs <= dec31Ms) {
        const iso = formatUtcMsToIso(candMs);
        if (!results.includes(iso)) results.push(iso);
      }
    }
  }
  return results.sort();
}

function projectRemainingQuarterlyDates(
  lastDate: string,
  asOfDate: string,
  year: number
): string[] {
  const lastMs = parseIsoDateToUtcMs(lastDate);
  const asOfMs = parseIsoDateToUtcMs(asOfDate);
  if (lastMs === null || asOfMs === null) return [];
  const dec31Ms = Date.UTC(year, 11, 31);
  const lastDt = new Date(lastMs);
  let y = lastDt.getUTCFullYear();
  let m = lastDt.getUTCMonth() + 1;
  const anchorDay = lastDt.getUTCDate();
  const results: string[] = [];

  for (let step = 0; step < 8; step++) {
    m += 3;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    const clampedDay = Math.min(anchorDay, daysInMonthUtc(y, m));
    const candMs = Date.UTC(y, m - 1, clampedDay);
    if (candMs > dec31Ms) break;
    if (candMs > asOfMs) {
      results.push(formatUtcMsToIso(candMs));
    }
  }
  return results;
}

interface CadenceDetectionResult {
  detectedMode: Exclude<CadenceForecastMode, 'manual'>;
  cadenceType: DetectedCadenceType;
  cadenceLabel: string;
  remainingDates: string[];
}

function detectStreamCadence(
  targetLineId: PnlLineId,
  uniqueSortedDates: string[],
  ytdAmount: number,
  asOfDate: string,
  year: number,
  elapsedDays: number,
  remainingDays: number
): CadenceDetectionResult {
  // Mode C — One-Time / Discretionary ($0 default)
  if (
    ONE_TIME_DEFAULT_LINES.has(targetLineId) ||
    ytdAmount <= 0 ||
    uniqueSortedDates.length <= 1
  ) {
    const reason =
      targetLineId === 'ca_ftb_tax' || ytdAmount < 0
        ? 'One-Time / Tax Credit ($0)'
        : targetLineId === 'dbp_contribution' || targetLineId === 'employer_401k'
        ? 'Discretionary Year-End ($0 default)'
        : 'One-Time ($0)';
    return {
      detectedMode: 'one_time',
      cadenceType: 'one_time',
      cadenceLabel: reason,
      remainingDates: [],
    };
  }

  const utcDates = uniqueSortedDates
    .map((d) => parseIsoDateToUtcMs(d))
    .filter((ms): ms is number => ms !== null);

  const gaps: number[] = [];
  for (let i = 1; i < utcDates.length; i++) {
    gaps.push(Math.round((utcDates[i] - utcDates[i - 1]) / MS_PER_DAY));
  }

  const daysOfMonth = utcDates.map((ms) => new Date(ms).getUTCDate());
  const distinctMonths = new Set(uniqueSortedDates.map((d) => d.slice(0, 7)));

  // 1. Monthly detection: 26–34 day intervals OR same day-of-month +/- 3 days across >=3 distinct months
  const monthlyGapMatches = gaps.filter((g) => g >= 26 && g <= 34).length;
  const medianDay = Math.round(median(daysOfMonth));
  const sameDomMatches = daysOfMonth.filter((d) => {
    const diff = Math.abs(d - medianDay);
    return diff <= 3 || Math.abs(diff - 30) <= 3;
  }).length;

  const isMonthly =
    (gaps.length >= 2 && monthlyGapMatches / gaps.length >= 0.7) ||
    (uniqueSortedDates.length >= 3 &&
      distinctMonths.size === uniqueSortedDates.length &&
      sameDomMatches / daysOfMonth.length >= 0.8 &&
      median(gaps) >= 26 &&
      median(gaps) <= 34);

  if (isMonthly) {
    const remDates = projectRemainingMonthlyDates(medianDay, asOfDate, year);
    const shortList = remDates.map(formatShortDate).join(', ');
    return {
      detectedMode: 'cadence',
      cadenceType: 'monthly',
      cadenceLabel:
        remDates.length > 0
          ? `Monthly · Day ${medianDay} · ${remDates.length} left: ${shortList}`
          : `Monthly · Day ${medianDay} · 0 left`,
      remainingDates: remDates,
    };
  }

  // 2. Semi-Monthly / Biweekly detection (12–17 day intervals)
  const biweeklyGapMatches = gaps.filter((g) => g >= 12 && g <= 17).length;
  if (gaps.length >= 2 && biweeklyGapMatches / gaps.length >= 0.75) {
    const medGap = median(gaps);
    // Check if semi-monthly (clustered around two fixed days of month, e.g. 1/15 or 15/30)
    const lowDays = daysOfMonth.filter((d) => d <= 16);
    const highDays = daysOfMonth.filter((d) => d > 16);
    const isSemiMonthly =
      lowDays.length >= 2 &&
      highDays.length >= 2 &&
      Math.max(...lowDays) - Math.min(...lowDays) <= 3 &&
      Math.max(...highDays) - Math.min(...highDays) <= 4 &&
      Math.abs(medGap - 14) > 0.35;

    if (isSemiMonthly) {
      const d1 = Math.round(median(lowDays));
      const d2 = Math.round(median(highDays));
      const remDates = projectRemainingSemiMonthlyDates(d1, d2, asOfDate, year);
      const shortList = remDates.map(formatShortDate).join(', ');
      return {
        detectedMode: 'cadence',
        cadenceType: 'semi_monthly',
        cadenceLabel:
          remDates.length > 0
            ? `Semi-Monthly · ${remDates.length} left: ${shortList}`
            : `Semi-Monthly · 0 left`,
        remainingDates: remDates,
      };
    }

    const lastDate = uniqueSortedDates[uniqueSortedDates.length - 1];
    const remDates = projectRemainingBiweeklyDates(lastDate, 14, asOfDate, year);
    const shortList = remDates.map(formatShortDate).join(', ');
    return {
      detectedMode: 'cadence',
      cadenceType: 'biweekly',
      cadenceLabel:
        remDates.length > 0
          ? `Biweekly · ${remDates.length} left: ${shortList}`
          : `Biweekly · 0 left`,
      remainingDates: remDates,
    };
  }

  // 3. Quarterly detection (85–95 day intervals)
  const quarterlyGapMatches = gaps.filter((g) => g >= 85 && g <= 95).length;
  if (gaps.length >= 1 && quarterlyGapMatches / gaps.length >= 0.75) {
    const lastDate = uniqueSortedDates[uniqueSortedDates.length - 1];
    const remDates = projectRemainingQuarterlyDates(lastDate, asOfDate, year);
    const shortList = remDates.map(formatShortDate).join(', ');
    return {
      detectedMode: 'cadence',
      cadenceType: 'quarterly',
      cadenceLabel:
        remDates.length > 0
          ? `Quarterly · ${remDates.length} left: ${shortList}`
          : `Quarterly · 0 left`,
      remainingDates: remDates,
    };
  }

  // 4. Mode B — Variable Run-Rate (Pace-Projected)
  return {
    detectedMode: 'run_rate',
    cadenceType: 'variable_run_rate',
    cadenceLabel: `Variable Run-Rate (${remainingDays}/${elapsedDays}d)`,
    remainingDates: [],
  };
}

// ============================================================================
// Core Ledger Processor & Forecaster
// ============================================================================

const REVENUE_LINES = new Set<PnlLineId>(['ca_revenue', 'az_revenue', 'schedule_k_interest']);

const PNL_TRANSFER_DESC_RE = /transfer\s+to\s+|credit\s+card\s+payment/i;

export const DEFAULT_EXP_SMOOTH_ALPHA = 0.5;
const AVG_DAYS_PER_MONTH = 30.4375;

const PNL_LINE_LABEL_BY_ID = new Map<PnlLineId, string>(
  PNL_LINE_ITEMS.map((item) => [item.id, item.label])
);

/**
 * Extracts a clean, human-readable operational QuickBooks P&L category name from a raw QBO account/section string.
 * Preserves authentic QBO category distinctions (e.g., "Consulting", "Rent Expense",
 * "Internet", "Subscriptions", "Office Supplies", "Insurance Expense", etc.)
 * while disambiguating terse leaf names like member first names, "Fed", or "State".
 */
export function extractPnlCategoryLabel(
  rawAccount: string,
  targetLineId: PnlLineId,
  setup?: SetupConfig | null
): string {
  const cleaned = (rawAccount || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return PNL_LINE_LABEL_BY_ID.get(targetLineId) ?? targetLineId;
  }

  // Split QBO hierarchical separators (":" or "->") to obtain parent & leaf account
  const segments = cleaned
    .split(/\s*(?::|->)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  let leaf = segments[segments.length - 1] ?? cleaned;
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';

  // Gently title-case all-lowercase leaves (e.g. "legal fees" -> "Legal Fees")
  if (leaf === leaf.toLowerCase() && /[a-z]/.test(leaf)) {
    leaf = leaf.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }

  const primaryFirst = (setup?.primary_name ?? '').trim().split(/\s+/)[0] ?? '';
  const spouseFirst = (setup?.spouse_name ?? '').trim().split(/\s+/)[0] ?? '';
  const primaryStateCode = (setup?.home_state ?? '').trim().toUpperCase();

  // Disambiguate terse leaf names so category rows read clearly at a glance
  if (
    targetLineId === 'bill_officer_w2' &&
    primaryFirst.length >= 2 &&
    new RegExp(`^${escapeRegexToken(primaryFirst)}$`, 'i').test(leaf)
  ) {
    return `Salary - ${primaryFirst}`;
  }
  if (
    targetLineId === 'debra_salaries_wages' &&
    spouseFirst.length >= 2 &&
    new RegExp(`^${escapeRegexToken(spouseFirst)}$`, 'i').test(leaf)
  ) {
    return `Salary - ${spouseFirst}`;
  }
  if (/^fed$/i.test(leaf) && targetLineId === 'payroll_taxes') {
    return 'Payroll Tax - Fed';
  }
  if (/^state$/i.test(leaf) && targetLineId === 'ca_ftb_tax') {
    return primaryStateCode ? `State Tax (${primaryStateCode})` : 'State Entity Tax';
  }
  if (/^(other|general|misc|miscellaneous)$/i.test(leaf) && parent) {
    return `${parent}: ${leaf}`;
  }

  return leaf;
}

function normalizeCategoryKey(categoryLabel: string): string {
  return categoryLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function clampExpSmoothAlpha(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_EXP_SMOOTH_ALPHA;
  return Math.round(Math.min(0.9, Math.max(0.1, raw)) * 100) / 100;
}

/**
 * Simple Exponential Smoothing (SES) over calendar months YYYY-01 .. asOfMonth:
 *   - Missing months filled as $0.00
 *   - S_0 = Y_0
 *   - S_t = alpha * Y_t + (1 - alpha) * S_{t-1}  for t = 1..T
 *   - Remaining projection:
 *       * remainingDays <= 0 -> $0.00
 *       * useDayFraction === true -> S_T * (remainingDays / 30.4375)
 *       * useDayFraction === false && remainingDays <= 45 -> S_T directly (1 next-period month)
 *       * useDayFraction === false && remainingDays > 45 -> S_T * (remainingDays / 30.4375)
 */
export function computeMonthlyExponentialSmoothing(
  txs: { date: string; amount: number }[],
  year: number,
  asOfDate: string,
  remainingDays: number,
  alpha: number,
  useDayFraction: boolean
): {
  monthlySeries: MonthlySeriesPoint[];
  activeMonthCount: number;
  latestMonthLabel: string;
  latestMonthActual: number;
  smoothedLevel: number;
  remainingProjection: number;
  scaleNote: string;
} {
  const parsedAsOf = parseIsoDateToUtcMs(asOfDate);
  const asOfMonth =
    parsedAsOf !== null
      ? new Date(parsedAsOf).getUTCFullYear() === year
        ? new Date(parsedAsOf).getUTCMonth() + 1
        : new Date(parsedAsOf).getUTCFullYear() > year
        ? 12
        : 1
      : 11;

  const monthTotals = new Map<string, number>();
  for (const t of txs) {
    const key = t.date.slice(0, 7);
    monthTotals.set(key, round2((monthTotals.get(key) ?? 0) + t.amount));
  }

  const monthlySeries: MonthlySeriesPoint[] = [];
  let activeMonthCount = 0;
  for (let m = 1; m <= asOfMonth; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const amt = round2(monthTotals.get(key) ?? 0);
    if (Math.abs(amt) >= 0.005) activeMonthCount++;
    monthlySeries.push({ month: key, amount: amt });
  }

  const latestPoint = monthlySeries[monthlySeries.length - 1] ?? {
    month: `${year}-${String(asOfMonth).padStart(2, '0')}`,
    amount: 0,
  };

  // Sequential SES with full floating-point precision until final rounding
  let s = monthlySeries.length > 0 ? monthlySeries[0].amount : 0;
  for (let i = 1; i < monthlySeries.length; i++) {
    s = alpha * monthlySeries[i].amount + (1 - alpha) * s;
  }

  const smoothedLevel = round2(Math.max(0, s));
  let remainingProjection = 0;
  let scaleNote = '0d left';

  if (remainingDays <= 0 || smoothedLevel <= 0) {
    remainingProjection = 0;
    scaleNote = remainingDays <= 0 ? '0d left' : 'S_T $0';
  } else if (useDayFraction || remainingDays > 45) {
    const mult = remainingDays / AVG_DAYS_PER_MONTH;
    remainingProjection = round2(Math.max(0, s * mult));
    scaleNote = `${remainingDays}/30.44d (${mult.toFixed(2)}×)`;
  } else {
    // <= 45 days remaining (e.g. 40–41 days from late Nov through Dec 31): use S_T directly
    remainingProjection = smoothedLevel;
    scaleNote = 'Next-period S_T (1×)';
  }

  return {
    monthlySeries,
    activeMonthCount,
    latestMonthLabel: latestPoint.month,
    latestMonthActual: latestPoint.amount,
    smoothedLevel,
    remainingProjection,
    scaleNote,
  };
}

function isFlaggedTransferDescription(tx: CadenceTransactionRow): boolean {
  return PNL_TRANSFER_DESC_RE.test(`${tx.memo} ${tx.vendor} ${tx.transaction_type}`);
}

export function computeCadenceForecast(
  state: CadenceForecasterState,
  year2025Computed?: ComputedTaxYear,
  yearProjectedComputed?: ComputedTaxYear,
  setup?: SetupConfig
): ComputedCadenceForecast {
  const year = state.projection_year || 2026;
  const asOfDate = state.as_of_date || `${year}-11-21`;
  const expSmoothAlpha = clampExpSmoothAlpha(state.exp_smooth_alpha);
  const expSmoothDayFraction = Boolean(state.exp_smooth_day_fraction);
  const { elapsedDays, remainingDays, totalDaysInYear } = getYearDayProgress(asOfDate, year);

  // Detect General Ledger mode either from explicit ledger_format or presence of GL metadata
  const ledgerFormat: 'general_ledger' | 'transaction_list' =
    state.ledger_format ??
    (state.transactions.some((t) => Boolean(t.gl_section) || Boolean(t.is_beginning_balance))
      ? 'general_ledger'
      : 'transaction_list');
  const isGlMode = ledgerFormat === 'general_ledger';

  const auditRows: CadenceAuditRow[] = [];
  const seenSignatures = new Set<string>();

  // Balance Sheet rollups
  // In General Ledger mode, each Balance Sheet section tracks its own exact Beginning + Activity = Ending balance.
  interface GlBsSectionStat {
    bsRole: BsAccountRole;
    subAccount: string;
    explicitBeg: number | null;
    firstTxInferredBeg: number | null;
    txSum: number;
    lastRunningBalance: number | null;
    expensePosCount: number;
    expenseNegCount: number;
  }
  const glBsSections = new Map<string, GlBsSectionStat>();

  const getOrCreateGlBsSection = (key: string, bsRole: BsAccountRole, subAccount: string) => {
    let stat = glBsSections.get(key);
    if (!stat) {
      stat = {
        bsRole,
        subAccount,
        explicitBeg: null,
        firstTxInferredBeg: null,
        txSum: 0,
        lastRunningBalance: null,
        expensePosCount: 0,
        expenseNegCount: 0,
      };
      glBsSections.set(key, stat);
    }
    return stat;
  };

  // Transaction List mode accumulators
  let cashBeg = 0;
  let cashDelta = 0;
  let ccBeg = 0;
  let ccDelta = 0;
  let pensionBeg = 0;
  let pensionDelta = 0;
  let memberDrawsYtd = 0;
  let capContribYtd = 0;

  interface GroupedTx {
    date: string;
    amount: number;
    sourceAccount: string;
    flaggedTransfer: boolean;
    memo: string;
  }
  interface StreamAccumulator {
    streamKey: string;
    vendor: string;
    targetLineId: PnlLineId;
    sourceAccounts: Set<string>;
    rawVendors: Set<string>;
    appliedAliasCount: number;
    txs: GroupedTx[];
  }

  const activeAliases = (state.payee_aliases ?? []).filter(
    (r) => r.pattern.trim().length > 0 && r.canonical_name.trim().length > 0
  );
  const aliasMatchCounts: Record<string, number> = {};
  for (const rule of activeAliases) {
    aliasMatchCounts[rule.id] = 0;
  }
  let aliasedTransactionCount = 0;

  const streamMap = new Map<string, StreamAccumulator>();
  let pnlTransactionCount = 0;
  let bsSectionEntryCount = 0;
  let transferExcludedCount = 0;
  let unmappedCount = 0;

  const isTransferType = (txType: string) =>
    /transfer|credit card payment|cc payment|bill pmt|payment/i.test(txType);

  const isOpeningType = (
    tx: CadenceTransactionRow,
    acctRole: AccountRole,
    splitRole: AccountRole
  ) =>
    Boolean(tx.is_beginning_balance) ||
    /opening balance|beginning balance/i.test(tx.transaction_type) ||
    /opening balance|beginning balance/i.test(tx.memo) ||
    (!isGlMode &&
      ((acctRole.kind === 'bs' && acctRole.bsRole === 'opening_equity') ||
        (splitRole.kind === 'bs' && splitRole.bsRole === 'opening_equity')));

  // Preserve original row order within the same date (important for GL running balance!)
  const sortedTxs = state.transactions
    .map((tx, idx) => ({ tx, idx }))
    .sort((a, b) => {
      const aBeg = a.tx.is_beginning_balance ? 0 : 1;
      const bBeg = b.tx.is_beginning_balance ? 0 : 1;
      if (aBeg !== bBeg) return aBeg - bBeg;
      const cmp = a.tx.date.localeCompare(b.tx.date);
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map((item) => item.tx);

  for (const tx of sortedTxs) {
    const txYear = Number(tx.date.slice(0, 4));
    if (!tx.is_beginning_balance && (txYear !== year || tx.date > asOfDate)) {
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: tx.account,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'non_target_year',
        reason:
          txYear !== year
            ? `Outside projection year ${year}`
            : `Dated after As-Of Date (${asOfDate})`,
      });
      continue;
    }

    // Deduplication check for true exact duplicate rows (includes memo & running_balance so
    // distinct same-day same-amount GL rows with advancing running balances are never dropped)
    const sig = [
      tx.is_beginning_balance ? 'BEG' : tx.date,
      tx.transaction_type.toLowerCase(),
      tx.num.toLowerCase(),
      tx.vendor.toLowerCase(),
      tx.memo.toLowerCase(),
      tx.account.toLowerCase(),
      tx.split_account.toLowerCase(),
      tx.amount.toFixed(2),
      tx.running_balance !== undefined ? tx.running_balance.toFixed(2) : '',
    ].join('|');
    if (seenSignatures.has(sig)) {
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: tx.account,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'duplicate',
        reason: 'Exact duplicate transaction row skipped to prevent double-counting',
      });
      continue;
    }
    seenSignatures.add(sig);

    const primaryAccount = isGlMode ? tx.gl_section || tx.account : tx.account;
    const acctRole = classifyTransactionAccount(primaryAccount, setup);
    const splitRole = classifyTransactionAccount(tx.split_account, setup);

    // =========================================================================
    // PATH A: QUICKBOOKS GENERAL LEDGER MODE (Double-Entry Section-Grouped)
    // =========================================================================
    if (isGlMode) {
      // A1. Balance Sheet / Cash / Credit Card / Liability / Draws / Equity Sections
      // NEVER routed to P&L! Each BS section rolls up strictly from its own Beginning Balance + Transactions.
      if (acctRole.kind === 'bs') {
        bsSectionEntryCount++;
        const secKey = `${acctRole.bsRole}::${acctRole.subAccount.toLowerCase()}`;
        const stat = getOrCreateGlBsSection(secKey, acctRole.bsRole, acctRole.subAccount);

        if (tx.is_beginning_balance || /beginning balance/i.test(tx.transaction_type)) {
          stat.explicitBeg = round2((stat.explicitBeg ?? 0) + tx.amount);
          auditRows.push({
            id: tx.id,
            date: tx.date,
            transaction_type: tx.transaction_type,
            vendor: tx.vendor,
            account: primaryAccount,
            split_account: tx.split_account,
            amount: tx.amount,
            category: 'opening_balance',
            reason: `GL Beginning Balance for ${acctRole.subAccount} (excluded from P&L)`,
          });
          continue;
        }

        // Track inferred beginning balance from first dated row's running balance if no Beginning Balance row existed
        if (stat.firstTxInferredBeg === null && tx.running_balance !== undefined) {
          stat.firstTxInferredBeg = round2(tx.running_balance - tx.amount);
        }
        stat.txSum = round2(stat.txSum + tx.amount);
        if (tx.running_balance !== undefined) {
          stat.lastRunningBalance = tx.running_balance;
        }
        if (acctRole.bsRole === 'cc_ap' && /expense|charge/i.test(tx.transaction_type) && !/credit|refund|payment/i.test(tx.transaction_type)) {
          if (tx.amount > 0) stat.expensePosCount++;
          else if (tx.amount < 0) stat.expenseNegCount++;
        }

        // Log BS<->BS transfers / CC payments / liability payoffs cleanly on the operating_cash or pension side
        if (acctRole.bsRole === 'operating_cash' && splitRole.kind === 'bs') {
          if (splitRole.bsRole === 'pension_payable') {
            transferExcludedCount++;
            auditRows.push({
              id: tx.id,
              date: tx.date,
              transaction_type: tx.transaction_type,
              vendor: tx.vendor,
              account: primaryAccount,
              split_account: tx.split_account,
              amount: tx.amount,
              category: 'liability_payoff',
              reason: 'GL Balance Sheet liability payoff (excluded from P&L)',
            });
          } else if (splitRole.bsRole === 'cc_ap' || splitRole.bsRole === 'operating_cash' || splitRole.bsRole === 'bs_other') {
            transferExcludedCount++;
            auditRows.push({
              id: tx.id,
              date: tx.date,
              transaction_type: tx.transaction_type,
              vendor: tx.vendor,
              account: primaryAccount,
              split_account: tx.split_account,
              amount: tx.amount,
              category: 'transfer_cc_payment',
              reason: 'GL Balance Sheet transfer / CC payment (excluded from P&L)',
            });
          }
        }
        continue;
      }

      // A2. P&L Sections (Summed ONCE strictly from their own Column A P&L section!)
      if (acctRole.kind === 'pnl') {
        if (tx.is_beginning_balance) continue;

        const pnlTarget = acctRole.lineId;
        const pnlSignedAmount = tx.amount;
        const flaggedTransfer = isFlaggedTransferDescription(tx);

        const resolved = resolveCanonicalPayee(tx.vendor, tx.memo, activeAliases);
        const effectiveVendor = resolved.canonicalVendor || tx.vendor.trim();
        const normVendor = normalizeVendorKey(effectiveVendor);
        const streamKey = `${normVendor}||${pnlTarget}`;
        let acc = streamMap.get(streamKey);
        if (!acc) {
          acc = {
            streamKey,
            vendor: effectiveVendor,
            targetLineId: pnlTarget,
            sourceAccounts: new Set<string>(),
            rawVendors: new Set<string>(),
            appliedAliasCount: 0,
            txs: [],
          };
          streamMap.set(streamKey, acc);
        }
        if (resolved.matchedRule) {
          acc.vendor = effectiveVendor;
          acc.appliedAliasCount++;
          aliasedTransactionCount++;
          aliasMatchCounts[resolved.matchedRule.id] =
            (aliasMatchCounts[resolved.matchedRule.id] ?? 0) + 1;
        }
        if (tx.vendor.trim()) acc.rawVendors.add(tx.vendor.trim());
        if (primaryAccount) acc.sourceAccounts.add(primaryAccount);
        acc.txs.push({
          date: tx.date,
          amount: round2(pnlSignedAmount),
          sourceAccount: primaryAccount,
          flaggedTransfer,
          memo: tx.memo,
        });
        pnlTransactionCount++;
        continue;
      }

      // A3. Unmapped GL section
      unmappedCount++;
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: primaryAccount,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'unmapped',
        reason: `Unmapped GL section "${primaryAccount}" — excluded from P&L until mapped`,
      });
      continue;
    }

    // =========================================================================
    // PATH B: TRANSACTION LIST BY DATE MODE (Single-Sided Transaction Export)
    // =========================================================================

    // 1. Opening Balance initialization rows
    if (isOpeningType(tx, acctRole, splitRole)) {
      if (acctRole.kind === 'bs' && acctRole.bsRole === 'operating_cash') {
        cashBeg = round2(cashBeg + tx.amount);
      } else if (acctRole.kind === 'bs' && acctRole.bsRole === 'cc_ap') {
        ccBeg = round2(ccBeg + Math.abs(tx.amount));
      } else if (acctRole.kind === 'bs' && acctRole.bsRole === 'pension_payable') {
        pensionBeg = round2(pensionBeg + Math.abs(tx.amount));
      }
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: tx.account,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'opening_balance',
        reason: 'Beginning Balance Sheet anchor (excluded from P&L)',
      });
      continue;
    }

    // 2. Balance Sheet <-> Balance Sheet transfers, CC payments, Pension Payoffs, Member Draws, Cap Contribs
    if (acctRole.kind === 'bs' && splitRole.kind === 'bs') {
      const pair = [acctRole.bsRole, splitRole.bsRole];

      if (pair.includes('member_draws')) {
        const drawAmt = Math.abs(tx.amount);
        const isReversal =
          /deposit|refund/i.test(tx.transaction_type) &&
          acctRole.bsRole === 'operating_cash' &&
          tx.amount > 0;
        const signedDraw = isReversal ? -drawAmt : drawAmt;
        memberDrawsYtd = round2(memberDrawsYtd + signedDraw);
        if (acctRole.bsRole === 'operating_cash') {
          cashDelta = round2(cashDelta + (isReversal ? drawAmt : -drawAmt));
        } else if (splitRole.bsRole === 'operating_cash') {
          cashDelta = round2(cashDelta - signedDraw);
        }
        continue;
      }

      if (pair.includes('capital_contributions')) {
        const contribAmt = Math.abs(tx.amount);
        capContribYtd = round2(capContribYtd + contribAmt);
        if (pair.includes('operating_cash')) {
          cashDelta = round2(cashDelta + contribAmt);
        }
        continue;
      }

      if (pair.includes('pension_payable')) {
        const payAmt = Math.abs(tx.amount);
        if (acctRole.bsRole === 'operating_cash') {
          cashDelta = round2(cashDelta + (tx.amount < 0 ? tx.amount : -payAmt));
          pensionDelta = round2(pensionDelta - payAmt);
        } else {
          pensionDelta = round2(pensionDelta - payAmt);
          if (splitRole.bsRole === 'operating_cash') {
            cashDelta = round2(cashDelta - payAmt);
          }
        }
        transferExcludedCount++;
        auditRows.push({
          id: tx.id,
          date: tx.date,
          transaction_type: tx.transaction_type,
          vendor: tx.vendor,
          account: tx.account,
          split_account: tx.split_account,
          amount: tx.amount,
          category: 'liability_payoff',
          reason: 'Prior-year Pension Payable settlement (excluded from 2026 P&L; updates Cash & Liability)',
        });
        continue;
      }

      if (
        (acctRole.bsRole === 'operating_cash' && splitRole.bsRole === 'cc_ap') ||
        (acctRole.bsRole === 'cc_ap' && splitRole.bsRole === 'operating_cash') ||
        (acctRole.bsRole === 'operating_cash' && splitRole.bsRole === 'operating_cash') ||
        pair.includes('bs_other') ||
        isTransferType(tx.transaction_type)
      ) {
        const payAmt = Math.abs(tx.amount);
        if (acctRole.bsRole === 'operating_cash' && splitRole.bsRole === 'cc_ap') {
          cashDelta = round2(cashDelta - payAmt);
          ccDelta = round2(ccDelta - payAmt);
        } else if (acctRole.bsRole === 'cc_ap' && splitRole.bsRole === 'operating_cash') {
          cashDelta = round2(cashDelta - payAmt);
          ccDelta = round2(ccDelta - payAmt);
        } else if (acctRole.bsRole === 'operating_cash') {
          cashDelta = round2(cashDelta + tx.amount);
        }
        transferExcludedCount++;
        auditRows.push({
          id: tx.id,
          date: tx.date,
          transaction_type: tx.transaction_type,
          vendor: tx.vendor,
          account: tx.account,
          split_account: tx.split_account,
          amount: tx.amount,
          category: 'transfer_cc_payment',
          reason: 'Internal transfer / CC payment excluded from P&L; updates Cash & Credit Card balances',
        });
        continue;
      }
    }

    // Catch standalone Transfer / Credit Card Payment even if split is blank
    if (isTransferType(tx.transaction_type) && acctRole.kind === 'bs' && splitRole.kind === 'unmapped') {
      if (acctRole.bsRole === 'operating_cash') {
        cashDelta = round2(cashDelta + tx.amount);
      } else if (acctRole.bsRole === 'cc_ap') {
        ccDelta = round2(ccDelta - Math.abs(tx.amount));
      }
      transferExcludedCount++;
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: tx.account,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'transfer_cc_payment',
        reason: 'Transfer / CC payment excluded from P&L',
      });
      continue;
    }

    // 3. Determine P&L Target & Balance Sheet Counterpart
    let pnlTarget: PnlLineId | null = null;
    let sourcePnlAccountName = '';
    let bsSide: BsAccountRole | null = null;
    let isBankPerspective = false;

    if (acctRole.kind === 'bs' && splitRole.kind === 'pnl') {
      pnlTarget = splitRole.lineId;
      sourcePnlAccountName = tx.split_account;
      bsSide = acctRole.bsRole;
      isBankPerspective = true;
    } else if (acctRole.kind === 'pnl') {
      pnlTarget = acctRole.lineId;
      sourcePnlAccountName = tx.account;
      bsSide = splitRole.kind === 'bs' ? splitRole.bsRole : null;
      isBankPerspective = false;
    } else if (acctRole.kind === 'bs' && acctRole.bsRole === 'member_draws') {
      memberDrawsYtd = round2(memberDrawsYtd + Math.abs(tx.amount));
      continue;
    } else if (acctRole.kind === 'bs' && acctRole.bsRole === 'capital_contributions') {
      capContribYtd = round2(capContribYtd + Math.abs(tx.amount));
      continue;
    } else if (acctRole.kind === 'bs') {
      // Other Balance Sheet account (e.g. Fraud, Equity) with no P&L split
      bsSectionEntryCount++;
      continue;
    } else {
      unmappedCount++;
      auditRows.push({
        id: tx.id,
        date: tx.date,
        transaction_type: tx.transaction_type,
        vendor: tx.vendor,
        account: tx.account,
        split_account: tx.split_account,
        amount: tx.amount,
        category: 'unmapped',
        reason: 'Unmapped account/split — excluded from P&L totals until mapped in QBO',
      });
      continue;
    }

    // 4. Normalize Signed P&L Amount & Update Balance Sheet Side
    const isRevenue = REVENUE_LINES.has(pnlTarget);
    let pnlSignedAmount = tx.amount;

    if (isBankPerspective) {
      if (isRevenue) {
        pnlSignedAmount = tx.amount;
        if (bsSide === 'operating_cash') {
          cashDelta = round2(cashDelta + tx.amount);
        }
      } else {
        const isCreditOrRefund =
          /credit|refund|deposit/i.test(tx.transaction_type) &&
          !/credit card expense/i.test(tx.transaction_type);

        if (bsSide === 'operating_cash') {
          pnlSignedAmount = round2(-tx.amount);
          cashDelta = round2(cashDelta + tx.amount);
        } else if (bsSide === 'cc_ap') {
          if (isCreditOrRefund) {
            pnlSignedAmount = round2(-Math.abs(tx.amount));
            ccDelta = round2(ccDelta - Math.abs(tx.amount));
          } else {
            pnlSignedAmount = round2(Math.abs(tx.amount));
            ccDelta = round2(ccDelta + Math.abs(tx.amount));
          }
        } else {
          pnlSignedAmount = round2(-tx.amount);
        }
      }
    } else {
      pnlSignedAmount = tx.amount;
      if (bsSide === 'operating_cash') {
        cashDelta = round2(cashDelta + (isRevenue ? tx.amount : -tx.amount));
      } else if (bsSide === 'cc_ap') {
        ccDelta = round2(ccDelta + (isRevenue ? -tx.amount : tx.amount));
      }
    }

    // 5. Group into Vendor + Target Account stream (applying Payee / Description Alias rules first)
    const flaggedTransfer = isFlaggedTransferDescription(tx);
    const resolved = resolveCanonicalPayee(tx.vendor, tx.memo, activeAliases);
    const effectiveVendor = resolved.canonicalVendor || tx.vendor.trim();
    const normVendor = normalizeVendorKey(effectiveVendor);
    const streamKey = `${normVendor}||${pnlTarget}`;
    let acc = streamMap.get(streamKey);
    if (!acc) {
      acc = {
        streamKey,
        vendor: effectiveVendor,
        targetLineId: pnlTarget,
        sourceAccounts: new Set<string>(),
        rawVendors: new Set<string>(),
        appliedAliasCount: 0,
        txs: [],
      };
      streamMap.set(streamKey, acc);
    }
    if (resolved.matchedRule) {
      acc.vendor = effectiveVendor;
      acc.appliedAliasCount++;
      aliasedTransactionCount++;
      aliasMatchCounts[resolved.matchedRule.id] =
        (aliasMatchCounts[resolved.matchedRule.id] ?? 0) + 1;
    }
    if (tx.vendor.trim()) acc.rawVendors.add(tx.vendor.trim());
    if (sourcePnlAccountName) acc.sourceAccounts.add(sourcePnlAccountName);
    acc.txs.push({
      date: tx.date,
      amount: round2(pnlSignedAmount),
      sourceAccount: sourcePnlAccountName,
      flaggedTransfer,
      memo: tx.memo,
    });
    pnlTransactionCount++;
  }

  // Finalize Balance Sheet Rollups for General Ledger Mode
  if (isGlMode) {
    cashBeg = 0;
    let cashEnd = 0;
    ccBeg = 0;
    let ccEnd = 0;
    pensionBeg = 0;
    let pensionEnd = 0;
    let drawsNet = 0;
    let contribNet = 0;

    for (const stat of glBsSections.values()) {
      const secBeg = stat.explicitBeg ?? stat.firstTxInferredBeg ?? 0;
      const secEnd =
        stat.explicitBeg !== null
          ? round2(stat.explicitBeg + stat.txSum)
          : stat.lastRunningBalance !== null
          ? stat.lastRunningBalance
          : round2(secBeg + stat.txSum);

      if (stat.bsRole === 'operating_cash') {
        cashBeg = round2(cashBeg + secBeg);
        cashEnd = round2(cashEnd + secEnd);
      } else if (stat.bsRole === 'cc_ap') {
        // Detect if a CC section used inverted signs (expenses negative, liability negative)
        const isInvertedSignCc =
          stat.expenseNegCount > stat.expensePosCount && secEnd < 0;
        const normalizedBeg = isInvertedSignCc ? round2(-secBeg) : secBeg;
        const normalizedEnd = isInvertedSignCc ? round2(-secEnd) : secEnd;
        ccBeg = round2(ccBeg + normalizedBeg);
        ccEnd = round2(ccEnd + normalizedEnd);
      } else if (stat.bsRole === 'pension_payable') {
        pensionBeg = round2(pensionBeg + Math.abs(secBeg));
        pensionEnd = round2(pensionEnd + secEnd);
      } else if (stat.bsRole === 'member_draws') {
        // Strictly current-year 2026 net activity in the Member Draws section (never doubled, excludes prior-year beg bal)
        drawsNet = round2(drawsNet + stat.txSum);
      } else if (stat.bsRole === 'capital_contributions') {
        contribNet = round2(contribNet + stat.txSum);
      }
    }

    cashDelta = round2(cashEnd - cashBeg);
    ccDelta = round2(ccEnd - ccBeg);
    pensionDelta = round2(pensionEnd - pensionBeg);
    memberDrawsYtd = round2(Math.abs(drawsNet));
    capContribYtd = round2(Math.abs(contribNet));
  }

  // 6. Run Cadence Detection on Every Granular Stream (guarding against "Transfer to " / "Credit Card Payment" inside P&L)
  const groupingMode: CadenceGroupingMode = state.grouping_mode ?? 'category';
  const granularStreams: CadenceStreamSummary[] = [];

  interface CategoryTxRecord {
    date: string;
    amount: number;
    sourceAccount: string;
    flaggedTransfer: boolean;
    memo: string;
    canonicalVendor: string;
    vendorKey: string;
    isAliased: boolean;
  }

  interface CategoryAcc {
    streamKey: string;
    categoryName: string;
    targetLineId: PnlLineId;
    sourceAccounts: Set<string>;
    rawVendors: Set<string>;
    appliedAliasCount: number;
    txs: CategoryTxRecord[];
  }

  const categoryMap = new Map<string, CategoryAcc>();
  let granularFlaggedStreamCount = 0;

  for (const acc of streamMap.values()) {
    const flaggedTxs = acc.txs.filter((t) => t.flaggedTransfer);
    const cleanTxs = acc.txs.filter((t) => !t.flaggedTransfer);
    const hasTransferFlag = flaggedTxs.length > 0;
    if (hasTransferFlag) granularFlaggedStreamCount++;

    // Populate category rollup buckets from every P&L transaction (pure BS accounts were already excluded above)
    const canonicalVendorKey = normalizeVendorKey(acc.vendor);
    for (const t of acc.txs) {
      const catLabel = extractPnlCategoryLabel(t.sourceAccount, acc.targetLineId, setup);
      const catKey = `cat::${normalizeCategoryKey(catLabel)}||${acc.targetLineId}`;
      let catAcc = categoryMap.get(catKey);
      if (!catAcc) {
        catAcc = {
          streamKey: catKey,
          categoryName: catLabel,
          targetLineId: acc.targetLineId,
          sourceAccounts: new Set<string>(),
          rawVendors: new Set<string>(),
          appliedAliasCount: 0,
          txs: [],
        };
        categoryMap.set(catKey, catAcc);
      }
      if (t.sourceAccount) catAcc.sourceAccounts.add(t.sourceAccount);
      if (acc.vendor) catAcc.rawVendors.add(acc.vendor);
      catAcc.txs.push({
        date: t.date,
        amount: t.amount,
        sourceAccount: t.sourceAccount,
        flaggedTransfer: t.flaggedTransfer,
        memo: t.memo,
        canonicalVendor: acc.vendor,
        vendorKey: canonicalVendorKey,
        isAliased: acc.appliedAliasCount > 0,
      });
    }
    if (acc.appliedAliasCount > 0) {
      // Attribute alias count cleanly to matching category buckets
      const touchedCatKeys = new Set<string>();
      for (const t of acc.txs) {
        const catLabel = extractPnlCategoryLabel(t.sourceAccount, acc.targetLineId, setup);
        touchedCatKeys.add(`cat::${normalizeCategoryKey(catLabel)}||${acc.targetLineId}`);
      }
      for (const ck of touchedCatKeys) {
        const c = categoryMap.get(ck);
        if (c) c.appliedAliasCount += acc.appliedAliasCount;
      }
    }

    // YTD always includes ALL rows in the P&L section so YTD reconciles $0.00 against QBO
    let ytdSum = 0;
    for (const t of acc.txs) {
      ytdSum = round2(ytdSum + t.amount);
    }

    // Cadence date/amount analysis uses ONLY non-flagged rows so a one-off transfer/CC payment
    // inside a P&L section never distorts recurring vendor cadence or latestAmount
    const cadenceSourceTxs = cleanTxs.length > 0 ? cleanTxs : acc.txs;
    const byDate = new Map<string, number>();
    let cleanYtdSum = 0;
    for (const t of cadenceSourceTxs) {
      byDate.set(t.date, round2((byDate.get(t.date) ?? 0) + t.amount));
      cleanYtdSum = round2(cleanYtdSum + t.amount);
    }
    const uniqueSortedDates = Array.from(byDate.keys()).sort();
    const latestDate = uniqueSortedDates[uniqueSortedDates.length - 1] ?? asOfDate;
    const latestAmount = byDate.get(latestDate) ?? 0;

    let detected: CadenceDetectionResult;
    if (cleanTxs.length === 0 && hasTransferFlag) {
      // Entire stream consists of "Transfer to " / "Credit Card Payment" description rows -> Exclude ($0) by default
      detected = {
        detectedMode: 'one_time',
        cadenceType: 'one_time',
        cadenceLabel: 'Flagged Transfer / CC Desc · Exclude ($0)',
        remainingDates: [],
      };
    } else {
      detected = detectStreamCadence(
        acc.targetLineId,
        uniqueSortedDates,
        cleanYtdSum,
        asOfDate,
        year,
        elapsedDays,
        remainingDays
      );
    }

    const cadenceRemainingAmount = round2(detected.remainingDates.length * latestAmount);
    const runRateBase = cleanTxs.length > 0 ? cleanYtdSum : ytdSum;
    const runRateRemainingAmount =
      elapsedDays > 0 && runRateBase > 0
        ? round2(runRateBase * (remainingDays / elapsedDays))
        : 0;

    // Monthly Simple Exponential Smoothing (SES) across YYYY-01..asOfMonth
    const ses = computeMonthlyExponentialSmoothing(
      cadenceSourceTxs,
      year,
      asOfDate,
      remainingDays,
      expSmoothAlpha,
      expSmoothDayFraction
    );
    const expSmoothRemainingAmount =
      cleanTxs.length === 0 && hasTransferFlag ? 0 : ses.remainingProjection;

    const override = state.stream_overrides[acc.streamKey];
    const activeMode: CadenceForecastMode = override?.mode ?? detected.detectedMode;
    let effectiveRemainingAmount = 0;

    if (activeMode === 'manual') {
      effectiveRemainingAmount = round2(override?.manual_remaining ?? 0);
    } else if (activeMode === 'exp_smooth') {
      effectiveRemainingAmount = expSmoothRemainingAmount;
    } else if (activeMode === 'cadence') {
      if (detected.remainingDates.length > 0) {
        effectiveRemainingAmount = cadenceRemainingAmount;
      } else if (detected.detectedMode === 'cadence') {
        effectiveRemainingAmount = 0;
      } else {
        const lastMs = parseIsoDateToUtcMs(latestDate);
        const day = lastMs ? new Date(lastMs).getUTCDate() : 15;
        const fallbackDates = projectRemainingMonthlyDates(day, asOfDate, year);
        effectiveRemainingAmount = round2(fallbackDates.length * latestAmount);
      }
    } else if (activeMode === 'run_rate') {
      effectiveRemainingAmount = runRateRemainingAmount;
    } else {
      effectiveRemainingAmount = 0;
    }

    const flaggedTransferNote = hasTransferFlag
      ? cleanTxs.length === 0
        ? `${flaggedTxs.length} row(s) matched "Transfer to " / "Credit Card Payment" — defaulted to Exclude ($0)`
        : `${flaggedTxs.length} transfer/CC description row(s) excluded from cadence math (kept in YTD)`
      : undefined;

    granularStreams.push({
      streamKey: acc.streamKey,
      vendor: acc.vendor,
      targetLineId: acc.targetLineId,
      sourceAccounts: Array.from(acc.sourceAccounts),
      transactionCount: acc.txs.length,
      dates: uniqueSortedDates,
      ytdAmount: ytdSum,
      latestDate,
      latestAmount,
      detectedMode: detected.detectedMode,
      detectedCadenceType: detected.cadenceType,
      cadenceLabel: detected.cadenceLabel,
      remainingDates: detected.remainingDates,
      remainingCount:
        activeMode === 'cadence'
          ? detected.remainingDates.length
          : activeMode === 'run_rate'
          ? remainingDays
          : activeMode === 'exp_smooth'
          ? ses.monthlySeries.length
          : 0,
      cadenceRemainingAmount,
      runRateRemainingAmount,
      monthlySeries: ses.monthlySeries,
      activeMonthCount: ses.activeMonthCount,
      latestMonthLabel: ses.latestMonthLabel,
      latestMonthActual: ses.latestMonthActual,
      expSmoothLevel: ses.smoothedLevel,
      expSmoothRemainingAmount,
      expSmoothScaleNote: ses.scaleNote,
      activeMode,
      effectiveRemainingAmount,
      isOverridden: Boolean(override),
      hasTransferFlag,
      flaggedTransferCount: flaggedTxs.length,
      flaggedTransferNote,
      mergedRawVendors: Array.from(acc.rawVendors),
      appliedAliasCount: acc.appliedAliasCount,
      isAliased: acc.appliedAliasCount > 0,
      isCategoryRow: false,
    });
  }

  // 6B. Build P&L Category Rollup Rows (~28 operational categories instead of 100+ granular lines)
  //     - Defaults active P&L categories to 'cadence' (using sub-stream calendar cadence + pace baseline)
  //     - Computes category-level Monthly SES (default alpha = 0.50) for 1-click Exp. Smooth toggling
  //     - Preserves exact state sourcing (CA vs AZ), 50/50 Meals, and Schedule K Interest targetLineId
  const categoryStreams: CadenceStreamSummary[] = [];
  let categoryFlaggedStreamCount = 0;

  for (const catAcc of categoryMap.values()) {
    const flaggedTxs = catAcc.txs.filter((t) => t.flaggedTransfer);
    const cleanTxs = catAcc.txs.filter((t) => !t.flaggedTransfer);
    const hasTransferFlag = flaggedTxs.length > 0;
    if (hasTransferFlag) categoryFlaggedStreamCount++;

    let ytdSum = 0;
    for (const t of catAcc.txs) {
      ytdSum = round2(ytdSum + t.amount);
    }

    const cadenceSourceTxs = cleanTxs.length > 0 ? cleanTxs : catAcc.txs;
    const byDate = new Map<string, number>();
    let cleanYtdSum = 0;
    for (const t of cadenceSourceTxs) {
      byDate.set(t.date, round2((byDate.get(t.date) ?? 0) + t.amount));
      cleanYtdSum = round2(cleanYtdSum + t.amount);
    }
    const uniqueSortedDates = Array.from(byDate.keys()).sort();
    const latestDate = uniqueSortedDates[uniqueSortedDates.length - 1] ?? asOfDate;
    const latestAmount = byDate.get(latestDate) ?? 0;

    // Group clean txs by canonical payee sub-stream inside this category for accurate calendar cadence rollup
    const subStreamGroups = new Map<string, CategoryTxRecord[]>();
    for (const t of cadenceSourceTxs) {
      const existing = subStreamGroups.get(t.vendorKey);
      if (existing) existing.push(t);
      else subStreamGroups.set(t.vendorKey, [t]);
    }
    const subStreamCount = subStreamGroups.size;

    let subCadenceCount = 0;
    let subRunRateCount = 0;
    let subCadenceRemaining = 0;
    let subRunRateRemaining = 0;
    let singleSubCadenceResult: CadenceDetectionResult | null = null;
    const allSubRemainingDates: string[] = [];

    for (const subTxs of subStreamGroups.values()) {
      const subByDate = new Map<string, number>();
      let subYtd = 0;
      for (const st of subTxs) {
        subByDate.set(st.date, round2((subByDate.get(st.date) ?? 0) + st.amount));
        subYtd = round2(subYtd + st.amount);
      }
      const subDates = Array.from(subByDate.keys()).sort();
      const subLatestDate = subDates[subDates.length - 1] ?? asOfDate;
      const subLatestAmt = subByDate.get(subLatestDate) ?? 0;

      const subDet = detectStreamCadence(
        catAcc.targetLineId,
        subDates,
        subYtd,
        asOfDate,
        year,
        elapsedDays,
        remainingDays
      );

      if (subDet.detectedMode === 'cadence') {
        subCadenceCount++;
        subCadenceRemaining = round2(
          subCadenceRemaining + round2(subDet.remainingDates.length * subLatestAmt)
        );
        for (const rd of subDet.remainingDates) {
          allSubRemainingDates.push(rd);
        }
        if (subStreamCount === 1) {
          singleSubCadenceResult = subDet;
        }
      } else if (subDet.detectedMode === 'run_rate') {
        subRunRateCount++;
        if (elapsedDays > 0 && subYtd > 0) {
          subRunRateRemaining = round2(
            subRunRateRemaining + round2(subYtd * (remainingDays / elapsedDays))
          );
        }
      }
    }

    const runRateBase = cleanTxs.length > 0 ? cleanYtdSum : ytdSum;
    const runRateRemainingAmount =
      elapsedDays > 0 && runRateBase > 0
        ? round2(runRateBase * (remainingDays / elapsedDays))
        : 0;

    // Also run cadence detection on the category's combined dates (catches recurring bills with varying vendor names)
    const catDetected = detectStreamCadence(
      catAcc.targetLineId,
      uniqueSortedDates,
      cleanYtdSum,
      asOfDate,
      year,
      elapsedDays,
      remainingDays
    );

    let detectedMode: Exclude<CadenceForecastMode, 'manual'> = 'cadence';
    let detectedCadenceType: DetectedCadenceType = 'variable_run_rate';
    let cadenceLabel = '';
    let remainingDates: string[] = [];
    let cadenceRemainingAmount = 0;
    let isVariableCategory = false;

    if (cleanTxs.length === 0 && hasTransferFlag) {
      detectedMode = 'one_time';
      detectedCadenceType = 'one_time';
      cadenceLabel = 'Flagged Transfer / CC Desc · Exclude ($0)';
      cadenceRemainingAmount = 0;
    } else if (
      ONE_TIME_DEFAULT_LINES.has(catAcc.targetLineId) ||
      cleanYtdSum <= 0 ||
      uniqueSortedDates.length <= 1
    ) {
      detectedMode = 'one_time';
      detectedCadenceType = 'one_time';
      cadenceLabel = catDetected.cadenceLabel;
      cadenceRemainingAmount = 0;
    } else if (subCadenceCount > 0) {
      detectedMode = 'cadence';
      cadenceRemainingAmount = round2(subCadenceRemaining + subRunRateRemaining);
      remainingDates = Array.from(new Set(allSubRemainingDates)).sort();
      if (subStreamCount === 1 && singleSubCadenceResult) {
        detectedCadenceType = singleSubCadenceResult.cadenceType;
        cadenceLabel = singleSubCadenceResult.cadenceLabel;
        remainingDates = singleSubCadenceResult.remainingDates;
        isVariableCategory = false;
      } else if (subRunRateCount === 0) {
        detectedCadenceType = 'monthly';
        cadenceLabel = `Calendar Cadence · ${subCadenceCount} recurring (${allSubRemainingDates.length} dates left)`;
        isVariableCategory = false;
      } else {
        detectedCadenceType = 'monthly';
        cadenceLabel = `Cadence Mix · ${subCadenceCount} recurring + ${subRunRateCount} variable`;
        isVariableCategory = true;
      }
    } else if (catDetected.detectedMode === 'cadence') {
      detectedMode = 'cadence';
      detectedCadenceType = catDetected.cadenceType;
      cadenceLabel = catDetected.cadenceLabel;
      remainingDates = catDetected.remainingDates;
      cadenceRemainingAmount = round2(catDetected.remainingDates.length * latestAmount);
      isVariableCategory = false;
    } else {
      // Active ongoing multi-transaction P&L category -> default to 'cadence' baseline (pace)
      // Marked as variable/lumpy so user can toggle 1-click Exp. Smooth (alpha = 0.50) anytime
      detectedMode = 'cadence';
      detectedCadenceType = 'variable_run_rate';
      cadenceRemainingAmount = runRateRemainingAmount;
      cadenceLabel = `Category Cadence · ${cleanTxs.length} txns (${remainingDays}/${elapsedDays}d pace)`;
      isVariableCategory = true;
    }

    // Monthly Simple Exponential Smoothing (SES) across category's aggregated monthly totals YYYY-01..asOfMonth
    const ses = computeMonthlyExponentialSmoothing(
      cadenceSourceTxs,
      year,
      asOfDate,
      remainingDays,
      expSmoothAlpha,
      expSmoothDayFraction
    );
    const expSmoothRemainingAmount =
      cleanTxs.length === 0 && hasTransferFlag ? 0 : ses.remainingProjection;

    const override = state.stream_overrides[catAcc.streamKey];
    const activeMode: CadenceForecastMode = override?.mode ?? detectedMode;
    let effectiveRemainingAmount = 0;

    if (activeMode === 'manual') {
      effectiveRemainingAmount = round2(override?.manual_remaining ?? 0);
    } else if (activeMode === 'exp_smooth') {
      effectiveRemainingAmount = expSmoothRemainingAmount;
    } else if (activeMode === 'cadence') {
      if (detectedMode === 'cadence') {
        effectiveRemainingAmount = cadenceRemainingAmount;
      } else {
        // User explicitly switched a one-time category onto Cadence
        effectiveRemainingAmount = runRateRemainingAmount;
      }
    } else if (activeMode === 'run_rate') {
      effectiveRemainingAmount = runRateRemainingAmount;
    } else {
      effectiveRemainingAmount = 0;
    }

    const flaggedTransferNote = hasTransferFlag
      ? cleanTxs.length === 0
        ? `${flaggedTxs.length} row(s) matched "Transfer to " / "Credit Card Payment" — defaulted to Exclude ($0)`
        : `${flaggedTxs.length} transfer/CC description row(s) excluded from cadence math (kept in YTD)`
      : undefined;

    categoryStreams.push({
      streamKey: catAcc.streamKey,
      vendor: catAcc.categoryName,
      categoryName: catAcc.categoryName,
      targetLineId: catAcc.targetLineId,
      sourceAccounts: Array.from(catAcc.sourceAccounts),
      transactionCount: catAcc.txs.length,
      dates: uniqueSortedDates,
      ytdAmount: ytdSum,
      latestDate,
      latestAmount,
      detectedMode,
      detectedCadenceType,
      cadenceLabel,
      remainingDates,
      remainingCount:
        activeMode === 'cadence'
          ? remainingDates.length || remainingDays
          : activeMode === 'run_rate'
          ? remainingDays
          : activeMode === 'exp_smooth'
          ? ses.monthlySeries.length
          : 0,
      cadenceRemainingAmount,
      runRateRemainingAmount,
      monthlySeries: ses.monthlySeries,
      activeMonthCount: ses.activeMonthCount,
      latestMonthLabel: ses.latestMonthLabel,
      latestMonthActual: ses.latestMonthActual,
      expSmoothLevel: ses.smoothedLevel,
      expSmoothRemainingAmount,
      expSmoothScaleNote: ses.scaleNote,
      activeMode,
      effectiveRemainingAmount,
      isOverridden: Boolean(override),
      hasTransferFlag,
      flaggedTransferCount: flaggedTxs.length,
      flaggedTransferNote,
      mergedRawVendors: Array.from(catAcc.rawVendors),
      appliedAliasCount: catAcc.appliedAliasCount,
      isAliased: catAcc.appliedAliasCount > 0,
      isCategoryRow: true,
      subStreamCount,
      isVariableCategory,
    });
  }

  // Sort both lists by Target Form 1120-S Line order, then largest YTD descending
  const lineOrder = new Map<PnlLineId, number>(PNL_LINE_ITEMS.map((m, idx) => [m.id, idx]));
  const sortByLineThenYtd = (a: CadenceStreamSummary, b: CadenceStreamSummary) => {
    const la = lineOrder.get(a.targetLineId) ?? 99;
    const lb = lineOrder.get(b.targetLineId) ?? 99;
    if (la !== lb) return la - lb;
    return Math.abs(b.ytdAmount) - Math.abs(a.ytdAmount);
  };
  granularStreams.sort(sortByLineThenYtd);
  categoryStreams.sort(sortByLineThenYtd);

  const streams = groupingMode === 'category' ? categoryStreams : granularStreams;
  const flaggedTransferStreamCount =
    groupingMode === 'category' ? categoryFlaggedStreamCount : granularFlaggedStreamCount;

  // Populate autoPnlByLine strictly from the active view mode so P&L, Schedule L, Form 7203,
  // CSV/Print exports, and Push to Six-Year Schedule always match the active table 100%.
  const autoPnlByLine = {} as Record<PnlLineId, PnlLineAmounts>;
  for (const meta of PNL_LINE_ITEMS) {
    autoPnlByLine[meta.id] = { ytd: 0, remaining: 0 };
  }
  for (const s of streams) {
    autoPnlByLine[s.targetLineId] = {
      ytd: round2(autoPnlByLine[s.targetLineId].ytd + s.ytdAmount),
      remaining: round2(autoPnlByLine[s.targetLineId].remaining + s.effectiveRemainingAmount),
    };
  }

  // 7. Merge Direct Two-Way P&L Table Overrides & Active Horizon/Setup Line 17 Retirement Targets
  // Decoupled from Schedule L 12/31 Pension Expense Payable: populate Remaining for Line 17 DBP &
  // Employer 401(k) directly from the active projected-year Horizon/Setup retirement figures
  // (minus any YTD actuals already posted in the ledger), unless the user explicitly overrode the row.
  const horizonRetirement = yearProjectedComputed
    ? resolveHorizonRetirementTargets(yearProjectedComputed, setup)
    : null;

  const finalPnl = {} as Record<PnlLineId, PnlLineAmounts>;
  for (const meta of PNL_LINE_ITEMS) {
    const auto = autoPnlByLine[meta.id];
    const ov = state.pnl_line_overrides[meta.id];
    const effectiveYtd = ov?.ytd !== undefined ? round2(ov.ytd) : auto.ytd;
    let defaultRemaining = auto.remaining;

    if (horizonRetirement) {
      if (meta.id === 'dbp_contribution') {
        defaultRemaining = computeRemainingRetirementFromHorizon(
          horizonRetirement.dbpAnnual,
          effectiveYtd
        );
      } else if (meta.id === 'employer_401k') {
        defaultRemaining = computeRemainingRetirementFromHorizon(
          horizonRetirement.employer401kAnnual,
          effectiveYtd
        );
      }
    }

    finalPnl[meta.id] = {
      ytd: effectiveYtd,
      remaining: ov?.remaining !== undefined ? round2(ov.remaining) : defaultRemaining,
    };
  }

  const autoBsRollup = {
    operating_cash_beg: round2(cashBeg),
    operating_cash_ytd: round2(cashBeg + cashDelta),
    cc_ap_beg: round2(ccBeg),
    cc_ap_ytd: round2(ccBeg + ccDelta),
    pension_payable_beg: round2(pensionBeg),
    pension_payable_ytd: round2(Math.max(0, pensionBeg + pensionDelta)),
    member_draws_ytd: round2(memberDrawsYtd),
    capital_contributions_ytd: round2(capContribYtd),
  };

  const mergedBs: BalanceSheetProjectionInputs = {
    ...state.balance_sheet,
    as_of_date: asOfDate,
  };

  const synthesizedPnlState: PnlBalanceSheetState = {
    projection_year: year,
    pnl: finalPnl,
    balance_sheet: mergedBs,
    last_pushed_at: state.last_pushed_at,
  };

  // Delegate Schedule L, Form 7203, and auto-projected 12/31 Operating Cash math
  // (which preserves YTD retirement outflows in operating_cash_ytd while excluding unpaid
  // subsequent-year IRC §404(a)(6) Line 17 retirement funding when pension_payable_ye === 0).
  const pnlComputed = calculatePnlBalanceSheet(
    synthesizedPnlState,
    year2025Computed,
    yearProjectedComputed,
    setup,
    { respectStateRetirementRemaining: true }
  );

  // 8. QBO Reconciliation Check
  const ytdRevenue = round2(autoPnlByLine.ca_revenue.ytd + autoPnlByLine.az_revenue.ytd);
  const ytdBookExpenses = round2(
    autoPnlByLine.bill_officer_w2.ytd +
      autoPnlByLine.debra_salaries_wages.ytd +
      autoPnlByLine.dbp_contribution.ytd +
      autoPnlByLine.employer_401k.ytd +
      autoPnlByLine.sehi_medicare.ytd +
      autoPnlByLine.rents.ytd +
      autoPnlByLine.payroll_taxes.ytd +
      autoPnlByLine.ca_ftb_tax.ytd +
      autoPnlByLine.professional_fees.ytd +
      autoPnlByLine.subscriptions_software.ytd +
      autoPnlByLine.telephone_internet.ytd +
      autoPnlByLine.travel.ytd +
      autoPnlByLine.meals_gross.ytd +
      autoPnlByLine.office_expense.ytd +
      autoPnlByLine.insurance.ytd +
      autoPnlByLine.utilities.ytd +
      autoPnlByLine.bank_payroll_fees.ytd +
      autoPnlByLine.other_deductions.ytd
  );
  const ytdInterestIncome = autoPnlByLine.schedule_k_interest.ytd;
  const ytdCash = autoBsRollup.operating_cash_ytd;
  const ytdCreditCards = autoBsRollup.cc_ap_ytd;
  const ytdMemberDraws = autoBsRollup.member_draws_ytd;

  const exp = state.qbo_expected;
  const makeRec = (id: string, label: string, computedVal: number, expectedVal?: number): QboReconciliationItem => {
    if (expectedVal === undefined) {
      return { id, label, computed: computedVal, expected: null, variance: null, status: 'info' };
    }
    const variance = round2(computedVal - expectedVal);
    return {
      id,
      label,
      computed: computedVal,
      expected: expectedVal,
      variance,
      status: Math.abs(variance) < 0.01 ? 'matched' : 'variance',
    };
  };

  const recItems: QboReconciliationItem[] = [
    makeRec('revenue', 'YTD Gross Revenue', ytdRevenue, exp?.revenue),
    makeRec('expenses', 'YTD Book Expenses', ytdBookExpenses, exp?.expenses),
    makeRec('interest', 'YTD Interest Income (Sch K)', ytdInterestIncome, exp?.interest_income),
    makeRec('cash', 'Operating Cash / Checking', ytdCash, exp?.cash),
    makeRec('cc', 'Credit Cards / AP', ytdCreditCards, exp?.credit_cards),
    makeRec('draws', 'YTD Member Draws', ytdMemberDraws, exp?.member_draws),
  ];

  const aliasedStreamCount = granularStreams.filter((s) => s.isAliased).length;

  return {
    asOfDate,
    projectionYear: year,
    ledgerFormat,
    groupingMode,
    expSmoothAlpha,
    expSmoothDayFraction,
    elapsedDays,
    remainingDays,
    totalDaysInYear,
    streams,
    categoryStreams,
    granularStreams,
    categoryCount: categoryStreams.length,
    granularStreamCount: granularStreams.length,
    auditRows,
    parsedTransactionCount: state.transactions.length,
    pnlTransactionCount,
    bsSectionEntryCount,
    transferExcludedCount,
    unmappedCount,
    flaggedTransferStreamCount,
    activeAliasCount: activeAliases.length,
    aliasedTransactionCount,
    aliasedStreamCount,
    aliasMatchCounts,
    synthesizedPnlState,
    pnlComputed,
    autoPnlByLine,
    autoBsRollup,
    reconciliation: {
      ytdRevenue,
      ytdBookExpenses,
      ytdInterestIncome,
      ytdCash,
      ytdCreditCards,
      ytdMemberDraws,
      items: recItems,
      allMatched: recItems.every((i) => i.status !== 'variance'),
    },
  };
}

// ============================================================================
// Initial Cadence State Builders (Isolated per Active Workspace Profile)
// ============================================================================

export function createInitialCadenceForecasterState(
  year2025EndingBasis = 0,
  initialAliases: PayeeAliasRule[] = [],
  setup?: SetupConfig | null
): CadenceForecasterState {
  const projectionYear = setup?.current_tax_year ?? 2026;

  if (setup?.workspace_profile_kind === 'test_persona') {
    const personaCadence = buildTestPersonaCadence(projectionYear);
    return {
      ...personaCadence,
      payee_aliases: initialAliases,
      balance_sheet: {
        ...personaCadence.balance_sheet,
        beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
      },
    };
  }

  if (isDefaultSeedSetup(setup)) {
    const seedCadence = DEFAULT_PROFILE_SEED.default_cadence_2026;
    const sampleTransactions = createDefaultSeedCadenceTransactions();
    return {
      projection_year: seedCadence.projection_year,
      source_label: seedCadence.source_label,
      ledger_format: 'transaction_list',
      as_of_date: seedCadence.as_of_date,
      grouping_mode: 'category',
      exp_smooth_alpha: DEFAULT_EXP_SMOOTH_ALPHA,
      exp_smooth_day_fraction: false,
      payee_aliases: initialAliases,
      transactions: sampleTransactions,
      stream_overrides: {},
      // Line 17 retirement Remaining auto-syncs from active Horizon/Setup plan figures minus YTD actuals
      pnl_line_overrides: {},
      balance_sheet: {
        ...seedCadence.balance_sheet,
        pension_payable_ye: DEFAULT_PROFILE_SEED.default_pension_payable_ye,
        beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
      },
      qbo_expected: { ...seedCadence.qbo_expected },
    };
  }

  // Blank User or Custom Household: clean neutral empty ledger with zero leakage
  return {
    projection_year: projectionYear,
    source_label: 'No transactions imported yet',
    ledger_format: 'transaction_list',
    as_of_date: `${projectionYear}-12-31`,
    grouping_mode: 'category',
    exp_smooth_alpha: DEFAULT_EXP_SMOOTH_ALPHA,
    exp_smooth_day_fraction: false,
    payee_aliases: initialAliases,
    transactions: [],
    stream_overrides: {},
    pnl_line_overrides: {},
    balance_sheet: {
      as_of_date: `${projectionYear}-12-31`,
      operating_cash_beg: 0,
      operating_cash_ytd: 0,
      operating_cash_ye_override: null,
      pension_payable_beg: 0,
      pension_payable_ytd: 0,
      pension_payable_ye: 0,
      cc_ap_beg: 0,
      cc_ap_ytd: 0,
      cc_ap_ye: 0,
      member_draws_ytd: 0,
      member_draws_remaining: 0,
      capital_contributions_ytd: 0,
      capital_contributions_remaining: 0,
      beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
    },
  };
}

export function buildStateFromImportedTransactions(
  transactions: CadenceTransactionRow[],
  sourceLabel: string,
  detectedAsOfDate: string | null,
  detectedYear: number | null,
  prevBalanceSheet?: BalanceSheetProjectionInputs,
  ledgerFormat: 'general_ledger' | 'transaction_list' = 'transaction_list',
  prevQboExpected?: CadenceForecasterState['qbo_expected'],
  prevExpSmooth?: { alpha?: number; dayFraction?: boolean },
  prevAliases?: PayeeAliasRule[],
  prevGroupingMode?: CadenceGroupingMode,
  setup?: SetupConfig | null
): CadenceForecasterState {
  const year = detectedYear && detectedYear >= 2020 && detectedYear <= 2040 ? detectedYear : 2026;
  const asOfDate = detectedAsOfDate || `${year}-12-31`;

  // Apply default seed reconciliation benchmarks strictly when importing a matching default-profile ledger
  const seedCadence = DEFAULT_PROFILE_SEED.default_cadence_2026;
  const shouldApplySeedBenchmarks =
    isDefaultSeedSetup(setup) &&
    year === seedCadence.projection_year &&
    (asOfDate === seedCadence.as_of_date ||
      sourceLabel.toLowerCase().includes(DEFAULT_PROFILE_SEED.business_name.toLowerCase()));

  const preservedAliases = Array.isArray(prevAliases) ? prevAliases : [];

  const draft: CadenceForecasterState = {
    projection_year: year,
    source_label: sourceLabel,
    ledger_format: ledgerFormat,
    as_of_date: asOfDate,
    grouping_mode: prevGroupingMode ?? 'category',
    exp_smooth_alpha: clampExpSmoothAlpha(prevExpSmooth?.alpha),
    exp_smooth_day_fraction: Boolean(prevExpSmooth?.dayFraction),
    payee_aliases: preservedAliases,
    transactions,
    stream_overrides: {},
    pnl_line_overrides: {},
    balance_sheet: prevBalanceSheet
      ? {
          ...prevBalanceSheet,
          as_of_date: asOfDate,
          operating_cash_ye_override: null,
        }
      : {
          as_of_date: asOfDate,
          operating_cash_beg: 0,
          operating_cash_ytd: 0,
          operating_cash_ye_override: null,
          pension_payable_beg: 0,
          pension_payable_ytd: 0,
          pension_payable_ye: 0,
          cc_ap_beg: 0,
          cc_ap_ytd: 0,
          cc_ap_ye: 0,
          member_draws_ytd: 0,
          member_draws_remaining: 0,
          capital_contributions_ytd: 0,
          capital_contributions_remaining: 0,
          beginning_stock_basis_override: null,
        },
    ...(shouldApplySeedBenchmarks
      ? { qbo_expected: prevQboExpected ?? { ...seedCadence.qbo_expected } }
      : {}),
  };

  // Run one pass to auto-populate Balance Sheet YTD & Beginning balances from the ledger
  const probe = computeCadenceForecast(draft, undefined, undefined, setup ?? undefined);
  const r = probe.autoBsRollup;
  draft.balance_sheet = {
    ...draft.balance_sheet,
    as_of_date: asOfDate,
    operating_cash_beg: r.operating_cash_beg,
    operating_cash_ytd: r.operating_cash_ytd,
    operating_cash_ye_override: null,
    cc_ap_beg: r.cc_ap_beg,
    cc_ap_ytd: r.cc_ap_ytd,
    cc_ap_ye: r.cc_ap_ytd,
    pension_payable_beg: r.pension_payable_beg,
    pension_payable_ytd: r.pension_payable_ytd,
    member_draws_ytd: r.member_draws_ytd,
    capital_contributions_ytd: r.capital_contributions_ytd,
  };

  return draft;
}
