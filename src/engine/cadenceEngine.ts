import * as XLSX from 'xlsx';
import type {
  BalanceSheetProjectionInputs,
  CadenceForecastMode,
  CadenceForecasterState,
  CadenceTransactionRow,
  ComputedTaxYear,
  PnlBalanceSheetState,
  PnlLineAmounts,
  PnlLineId,
} from '../types/tax';
import {
  PNL_LINE_ITEMS,
  calculatePnlBalanceSheet,
  type ComputedPnlBalanceSheet,
} from './pnlBalanceSheet';

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
  expSmoothAlpha: number;
  expSmoothDayFraction: boolean;
  elapsedDays: number;
  remainingDays: number;
  totalDaysInYear: number;
  streams: CadenceStreamSummary[];
  auditRows: CadenceAuditRow[];
  parsedTransactionCount: number;
  pnlTransactionCount: number;
  bsSectionEntryCount: number;
  transferExcludedCount: number;
  unmappedCount: number;
  flaggedTransferStreamCount: number;
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
// Operating Support Services, LLC Exact QBO Account Classifier (All 50+ Headers)
// ============================================================================

export function classifyTransactionAccount(rawAccount: string): AccountRole {
  const cleaned = rawAccount.trim();
  if (!cleaned || /^-split-$/i.test(cleaned)) return { kind: 'unmapped' };

  // Split hierarchical QBO path (e.g. "Salary : Bill", "Travel Expense:Business Meals (100%)")
  const segments = cleaned
    .split(/\s*(?::|->|→)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const leaf = segments[segments.length - 1] ?? cleaned;
  const leafLower = leaf.toLowerCase();
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
  const parentLower = parent.toLowerCase();
  const fullLower = cleaned.toLowerCase();

  // ---- 1. Balance Sheet Accounts (Explicitly mapped; NEVER treated as P&L) ----

  // Operating Cash: BlueVine Checking
  if (
    /^bluevine\s*checking$/i.test(leafLower) ||
    /bluevine\s*checking/i.test(leafLower) ||
    (/(checking|savings|operating\s*cash|business\s*bank)/i.test(leafLower) &&
      !/credit card|\bcc\b/i.test(leafLower))
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

  // Credit Cards & Accounts Payable (including deleted cards in OSS General Ledger)
  if (
    /amazon\s*cc|cap\s*one\s*cc|capital\s*one|amx\s*cc|amex|amtrak|onekey/i.test(leafLower) ||
    /(credit card|accounts payable|\ba\/p\b|\bsavor\b)/i.test(leafLower)
  ) {
    return { kind: 'bs', bsRole: 'cc_ap', subAccount: leaf };
  }

  // Retirement / Pension Payables (Balance Sheet Liabilities)
  if (
    /defined benefit plan payable|oss 401k plan payable/i.test(leafLower) ||
    /(pension.*payable|dbp.*payable|401\(?k\)?.*payable)/i.test(leafLower)
  ) {
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

  // ---- 2. P&L Revenue Accounts ----
  if (
    /consulting\s*[-–—:]?\s*debra\s*\(?ca\)?/i.test(leafLower) ||
    /consulting\s*[-–—:]?\s*debra\s*\(?ca\)?/i.test(fullLower) ||
    /(california|\bca\b).*(rev|sales|income|consult)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'ca_revenue' };
  }

  if (
    /consulting\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(leafLower) ||
    /services\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(leafLower) ||
    /^services\s*income$/i.test(leafLower) ||
    /consulting\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(fullLower) ||
    /services\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(fullLower) ||
    /(arizona|\baz\b).*(rev|sales|income|consult)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'az_revenue' };
  }

  // ---- 3. Schedule K Line 4 Interest Income (BEFORE generic income / interest expense) ----
  if (/^interest\s*income$/i.test(leafLower) || /interest earned|bank interest/i.test(leafLower)) {
    return { kind: 'pnl', lineId: 'schedule_k_interest' };
  }

  // ---- 4. SEHI Medicare Premiums (BEFORE Compensation so "Shareholder Health - Bill/Debra" never hits Salary) ----
  if (
    /shareholder\s*health/i.test(leafLower) ||
    /shareholder\s*health/i.test(parentLower) ||
    /\bsehi\b|medicare\s*prem/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'sehi_medicare' };
  }

  // ---- 5. Compensation: "Bill" / "Debra" under Salary (or "Salary -> Bill", "Salary:Bill", bare "Bill"/"Debra") ----
  if (
    /^bill$/i.test(leafLower) ||
    /salary\s*(?:->|→|:|-|\/)\s*bill/i.test(fullLower) ||
    (/(salary|wages|payroll)/i.test(fullLower) && /\bbill\b/i.test(leafLower)) ||
    /officer\s*(comp|w-?2)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'bill_officer_w2' };
  }

  if (
    /^debra$/i.test(leafLower) ||
    /salary\s*(?:->|→|:|-|\/)\s*debra/i.test(fullLower) ||
    (/(salary|wages|payroll)/i.test(fullLower) && /\bdebra\b/i.test(leafLower)) ||
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

  // ---- 9. Taxes & Licenses: Payroll Taxes vs CA FTB / State Tax ----
  if (
    /^ca sdi$/i.test(leafLower) ||
    /^ca sui[- ]?er$/i.test(leafLower) ||
    /^az sui[- ]?er$/i.test(leafLower) ||
    /^fed$/i.test(leafLower) ||
    /^medcare$/i.test(leafLower) ||
    /(payroll tax|fica|futa|suta|edd|\bsdi\b|sui-?er)/i.test(leafLower)
  ) {
    return { kind: 'pnl', lineId: 'payroll_taxes' };
  }

  if (
    /^state$/i.test(leafLower) ||
    /(\bftb\b|franchise tax|ca\s*ftb|state\s*tax|100s)/i.test(leafLower)
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
  /^(operating support|general ledger|transaction list|accrual basis|cash basis|all dates|monday,|tuesday,|wednesday,|thursday,|friday,|saturday,|sunday,|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d)/i;

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
  year2025Computed?: ComputedTaxYear
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
    txs: GroupedTx[];
  }

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
    const acctRole = classifyTransactionAccount(primaryAccount);
    const splitRole = classifyTransactionAccount(tx.split_account);

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

        const normVendor = normalizeVendorKey(tx.vendor);
        const streamKey = `${normVendor}||${pnlTarget}`;
        let acc = streamMap.get(streamKey);
        if (!acc) {
          acc = {
            streamKey,
            vendor: tx.vendor.trim(),
            targetLineId: pnlTarget,
            sourceAccounts: new Set<string>(),
            txs: [],
          };
          streamMap.set(streamKey, acc);
        }
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
          reason: 'Internal transfer / CC payment excluded from P&L; updates BlueVine Cash & Card balances',
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

    // 5. Group into Vendor + Target Account stream
    const flaggedTransfer = isFlaggedTransferDescription(tx);
    const normVendor = normalizeVendorKey(tx.vendor);
    const streamKey = `${normVendor}||${pnlTarget}`;
    let acc = streamMap.get(streamKey);
    if (!acc) {
      acc = {
        streamKey,
        vendor: tx.vendor.trim(),
        targetLineId: pnlTarget,
        sourceAccounts: new Set<string>(),
        txs: [],
      };
      streamMap.set(streamKey, acc);
    }
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

  // 6. Run Cadence Detection on Every Stream (guarding against "Transfer to " / "Credit Card Payment" inside P&L)
  const streams: CadenceStreamSummary[] = [];
  const autoPnlByLine = {} as Record<PnlLineId, PnlLineAmounts>;
  for (const meta of PNL_LINE_ITEMS) {
    autoPnlByLine[meta.id] = { ytd: 0, remaining: 0 };
  }

  let flaggedTransferStreamCount = 0;

  for (const acc of streamMap.values()) {
    const flaggedTxs = acc.txs.filter((t) => t.flaggedTransfer);
    const cleanTxs = acc.txs.filter((t) => !t.flaggedTransfer);
    const hasTransferFlag = flaggedTxs.length > 0;
    if (hasTransferFlag) flaggedTransferStreamCount++;

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

    streams.push({
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
    });

    autoPnlByLine[acc.targetLineId] = {
      ytd: round2(autoPnlByLine[acc.targetLineId].ytd + ytdSum),
      remaining: round2(autoPnlByLine[acc.targetLineId].remaining + effectiveRemainingAmount),
    };
  }

  // Sort streams by Target Line order, then largest YTD descending
  const lineOrder = new Map<PnlLineId, number>(PNL_LINE_ITEMS.map((m, idx) => [m.id, idx]));
  streams.sort((a, b) => {
    const la = lineOrder.get(a.targetLineId) ?? 99;
    const lb = lineOrder.get(b.targetLineId) ?? 99;
    if (la !== lb) return la - lb;
    return Math.abs(b.ytdAmount) - Math.abs(a.ytdAmount);
  });

  // 7. Merge Direct Two-Way P&L Table Overrides
  const finalPnl = {} as Record<PnlLineId, PnlLineAmounts>;
  for (const meta of PNL_LINE_ITEMS) {
    const auto = autoPnlByLine[meta.id];
    const ov = state.pnl_line_overrides[meta.id];
    finalPnl[meta.id] = {
      ytd: ov?.ytd !== undefined ? round2(ov.ytd) : auto.ytd,
      remaining: ov?.remaining !== undefined ? round2(ov.remaining) : auto.remaining,
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

  const pnlComputed = calculatePnlBalanceSheet(synthesizedPnlState, year2025Computed);

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
    makeRec('cash', 'BlueVine Checking', ytdCash, exp?.cash),
    makeRec('cc', 'Credit Cards / AP', ytdCreditCards, exp?.credit_cards),
    makeRec('draws', 'YTD Member Draws', ytdMemberDraws, exp?.member_draws),
  ];

  return {
    asOfDate,
    projectionYear: year,
    ledgerFormat,
    expSmoothAlpha,
    expSmoothDayFraction,
    elapsedDays,
    remainingDays,
    totalDaysInYear,
    streams,
    auditRows,
    parsedTransactionCount: state.transactions.length,
    pnlTransactionCount,
    bsSectionEntryCount,
    transferExcludedCount,
    unmappedCount,
    flaggedTransferStreamCount,
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
// Built-In Sample OSS QBO Transaction Ledger (1/1/2026 – 11/21/2026)
// Reconciles to the exact penny:
//   Revenue:           $319,283.71 (CA $127,340.00 + AZ $191,943.71)
//   Book Expenses:      $88,300.27
//   Interest Income:       $609.18 (Monthly Day 22 -> 2 left: 11/22, 12/22)
//   BlueVine Checking:  $42,580.89
//   Credit Cards / AP:   $2,963.77 (Amazon CC + Cap One CC + AMX CC + Amtrak)
//   Member Draws:      $121,939.75
// ============================================================================

function splitIntoInstallments(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100;
  const arr = Array.from({ length: count }, () => base);
  const diff = round2(total - round2(base * count));
  arr[0] = round2(arr[0] + diff);
  return arr;
}

export function createSampleOssTransactions(): CadenceTransactionRow[] {
  const rows: CadenceTransactionRow[] = [];
  let seq = 1;
  const push = (
    date: string,
    transaction_type: string,
    vendor: string,
    account: string,
    split_account: string,
    amount: number,
    memo = '',
    num = ''
  ) => {
    rows.push({
      id: `oss-${seq++}`,
      date,
      transaction_type,
      num,
      vendor,
      memo,
      account,
      split_account,
      amount: round2(amount),
    });
  };

  // --- Opening Balances (1/1/2026) ---
  // Reconciles BlueVine Checking to $42,580.89, Credit Cards to $2,963.77, Pension Payable to $0.00
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'BlueVine Checking', 'Opening Balance Equity', 76904.25, '2026 Beginning Cash');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Amazon CC', 'Opening Balance Equity', 950.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Cap One CC', 'Opening Balance Equity', 850.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'AMX CC', 'Opening Balance Equity', 600.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Defined Benefit Plan Payable', 'Opening Balance Equity', 140000.00, '2025 Accrued DBP Liability');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'OSS 401K Plan Payable', 'Opening Balance Equity', 4540.00, '2025 Accrued 401(k) Profit Sharing');

  // --- Prior-Year Pension Payable Settlements (Excluded from 2026 P&L; updates Cash & Liability to $0) ---
  push('2026-03-10', 'Check', 'Schwab Defined Benefit Trust', 'BlueVine Checking', 'Defined Benefit Plan Payable', -140000.00, '2025 DBP Plan Funding', '1042');
  push('2026-03-10', 'Check', 'OSS 401(k) Trust', 'BlueVine Checking', 'OSS 401K Plan Payable', -4540.00, '2025 401(k) Profit Sharing Funding', '1043');

  // --- 1. Revenue ($319,283.71 exact: CA $127,340.00 + AZ $191,943.71) ---
  const caInvoices: [string, string, number][] = [
    ['2026-01-14', 'Pacific Coast Systems (CA)', 11250.00],
    ['2026-02-09', 'Pacific Coast Systems (CA)', 12400.00],
    ['2026-03-19', 'Bay Area Logistics Group', 9850.00],
    ['2026-04-06', 'Pacific Coast Systems (CA)', 14200.00],
    ['2026-05-11', 'Bay Area Logistics Group', 10750.00],
    ['2026-06-22', 'Pacific Coast Systems (CA)', 11900.00],
    ['2026-07-08', 'Bay Area Logistics Group', 10540.00],
    ['2026-08-17', 'Pacific Coast Systems (CA)', 13150.00],
    ['2026-09-25', 'Bay Area Logistics Group', 11400.00],
    ['2026-10-13', 'Pacific Coast Systems (CA)', 12200.00],
    ['2026-11-16', 'Bay Area Logistics Group', 9700.00],
  ]; // sum = 127,340.00
  for (const [d, v, amt] of caInvoices) {
    push(d, 'Deposit', v, 'BlueVine Checking', 'Consulting - Debra (CA)', amt, 'Client consulting invoice');
  }

  const azConsulting: [string, string, number][] = [
    ['2026-01-20', 'Sonoran Industrial Partners', 16420.00],
    ['2026-02-18', 'Desert Grid Operations', 14850.50],
    ['2026-03-04', 'Sonoran Industrial Partners', 17325.00],
    ['2026-04-21', 'Desert Grid Operations', 15110.21],
    ['2026-05-28', 'Sonoran Industrial Partners', 18440.00],
    ['2026-06-11', 'Desert Grid Operations', 14920.00],
    ['2026-07-23', 'Sonoran Industrial Partners', 16780.00],
    ['2026-08-06', 'Desert Grid Operations', 15340.00],
    ['2026-09-14', 'Sonoran Industrial Partners', 17910.00],
    ['2026-10-27', 'Desert Grid Operations', 18348.00],
  ]; // sum = 165,443.71
  for (const [d, v, amt] of azConsulting) {
    push(d, 'Deposit', v, 'BlueVine Checking', 'Consulting - Bill (AZ)', amt, 'AZ consulting engagement');
  }

  const azServicesBill: [string, string, number][] = [
    ['2026-02-26', 'Mesa Field Services', 5250.00],
    ['2026-05-15', 'Mesa Field Services', 5750.00],
    ['2026-08-24', 'Mesa Field Services', 5100.00],
    ['2026-11-12', 'Mesa Field Services', 5400.00],
  ]; // sum = 21,500.00
  for (const [d, v, amt] of azServicesBill) {
    push(d, 'Deposit', v, 'BlueVine Checking', 'Services - Bill (AZ)', amt, 'Field advisory services');
  }

  push('2026-04-10', 'Deposit', 'Phoenix Municipal Advisory', 'BlueVine Checking', 'Services Income', 2500.00, 'Advisory milestone');
  push('2026-10-05', 'Deposit', 'Phoenix Municipal Advisory', 'BlueVine Checking', 'Services Income', 2500.00, 'Advisory milestone');

  // --- 2. Schedule K Interest Income ($609.18 exact — Monthly Day 22 -> 2 left: 11/22, 12/22) ---
  const interestInstallments = splitIntoInstallments(609.18, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-22`;
    push(dt, 'Deposit', 'BlueVine Bank Interest', 'BlueVine Checking', 'Interest Income', interestInstallments[m - 1], 'Monthly checking APY interest');
  }

  // --- 3. Biweekly Payroll & Payroll Taxes (23 runs Jan 9 -> Nov 13 -> 3 left: 11/27, 12/11, 12/25) ---
  const biweeklyDates: string[] = [];
  let bwMs = Date.UTC(2026, 0, 9);
  for (let i = 0; i < 23; i++) {
    biweeklyDates.push(formatUtcMsToIso(bwMs));
    bwMs += 14 * MS_PER_DAY;
  }

  const billWages = splitIntoInstallments(20534.52, 23);
  const debraWages = splitIntoInstallments(20257.99, 23);
  const fedTaxes = splitIntoInstallments(2531.68, 23);
  const medCareTaxes = splitIntoInstallments(591.50, 23);
  const caSdiTaxes = splitIntoInstallments(498.12, 23);
  const caSuiTaxes = splitIntoInstallments(340.00, 10); // Q1–Q2 wage base cap hit
  const azSuiTaxes = splitIntoInstallments(201.56, 8);

  biweeklyDates.forEach((dt, i) => {
    push(dt, 'Payroll Check', 'OSS Payroll — Bill', 'BlueVine Checking', 'Salary -> Bill', -billWages[i], 'Biweekly officer salary');
    push(dt, 'Payroll Check', 'OSS Payroll — Debra', 'BlueVine Checking', 'Salary -> Debra', -debraWages[i], 'Biweekly W-2 salary');
    push(dt, 'Expense', 'EFTPS Federal Payroll', 'BlueVine Checking', 'Taxes & Licenses:Fed', -fedTaxes[i], 'Employer SS/FUTA');
    push(dt, 'Expense', 'EFTPS Medicare Tax', 'BlueVine Checking', 'Taxes & Licenses:MedCare', -medCareTaxes[i], 'Employer Medicare');
    push(dt, 'Expense', 'CA EDD Payroll Tax', 'BlueVine Checking', 'Taxes & Licenses:CA SDI', -caSdiTaxes[i], 'CA payroll tax');
    if (i < caSuiTaxes.length) {
      push(dt, 'Expense', 'CA EDD SUI-ER', 'BlueVine Checking', 'Taxes & Licenses:CA SUI-ER', -caSuiTaxes[i], 'CA SUI employer');
    }
    if (i < azSuiTaxes.length) {
      push(dt, 'Expense', 'AZ DES SUI-ER', 'BlueVine Checking', 'Taxes & Licenses:AZ SUI-ER', -azSuiTaxes[i], 'AZ SUI employer');
    }
  });

  // --- 4. SEHI Medicare Premiums ($6,167.85 exact — Monthly Day 5 -> 1 left: 12/05) ---
  const sehiBill = splitIntoInstallments(3083.93, 11);
  const sehiDebra = splitIntoInstallments(3083.92, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-05`;
    push(dt, 'Expense', 'CMS Medicare & Medigap — Bill', 'BlueVine Checking', 'Shareholder Health - Bill', -sehiBill[m - 1], 'Monthly Medicare Part B/D/G');
    push(dt, 'Expense', 'CMS Medicare & Medigap — Debra', 'BlueVine Checking', 'Shareholder Health - Debra', -sehiDebra[m - 1], 'Monthly Medicare Part B/D/G');
  }

  // --- 5. Rents ($10,487.00 exact — Monthly Day 1 -> 1 left: 12/01) ---
  const rentAmts = splitIntoInstallments(10487.00, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-01`;
    push(dt, 'Check', 'Executive Suites Property Mgmt', 'BlueVine Checking', 'Rents', -rentAmts[m - 1], 'Monthly office suite rent');
  }

  // --- 6. CA FTB State Tax Refund (-$466.84 — One-Time $0 remaining) ---
  push('2026-04-28', 'Deposit', 'CA Franchise Tax Board', 'BlueVine Checking', 'Taxes & Licenses:State', 466.84, 'Prior-year CA 100S overpayment refund');

  // --- 7. Professional Fees ($6,556.00 — Variable Run-Rate) ---
  push('2026-02-19', 'Expense', 'Vanguard CPA Advisory', 'BlueVine Checking', 'Professional Fees', -2450.00, '1120-S & K-1 preparation');
  push('2026-06-08', 'Expense', 'Actuarial Pension Consultants', 'BlueVine Checking', 'Professional Fees', -1550.00, 'Mid-year DBP actuarial valuation');
  push('2026-09-21', 'Expense', 'Vanguard CPA Advisory', 'BlueVine Checking', 'Professional Fees', -856.00, 'Q3 multi-state nexus review');
  push('2026-04-14', 'Expense', 'Sterling Business Law LLP', 'BlueVine Checking', 'legal fees', -950.00, 'Annual LLC minutes & compliance');
  push('2026-10-16', 'Expense', 'Sterling Business Law LLP', 'BlueVine Checking', 'legal fees', -750.00, 'Client MSA review');

  // --- 8. Subscriptions & Software ($3,797.30 — Monthly Day 12 -> 1 left: 12/12) ---
  const subsAmts = splitIntoInstallments(3797.30, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-12`;
    push(dt, 'Credit Card Expense', 'Intuit QBO & Cloud SaaS', 'Cap One CC', 'Subscriptions & Software', subsAmts[m - 1], 'Monthly SaaS stack');
  }

  // --- 9. Telephone & Internet ($2,382.57 exact) ---
  // AT&T Wireless: Monthly Day 22 (Jan-Oct = 10 drafts -> 2 left: 11/22, 12/22)
  const attAmts = splitIntoInstallments(1450.00, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-22`;
    push(dt, 'Credit Card Expense', 'AT&T Business Wireless', 'AMX CC', 'Telephone Expense', attAmts[m - 1], 'Monthly business mobile lines');
  }
  // Cox Business Internet: Monthly Day 18 (Jan-Nov = 11 drafts -> 1 left: 12/18)
  const coxAmts = splitIntoInstallments(770.00, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-18`;
    push(dt, 'Credit Card Expense', 'Cox Business Fiber', 'Cap One CC', 'Internet', coxAmts[m - 1], 'Office fiber internet');
  }
  // Computer and Internet Expenses (variable on Amazon CC)
  push('2026-03-11', 'Credit Card Expense', 'Cloudflare & Domain Registrar', 'Amazon CC', 'Computer and Internet Expenses', 84.57, 'Domain & DNS renewal');
  push('2026-08-29', 'Credit Card Expense', 'Cloudflare & Domain Registrar', 'Amazon CC', 'Computer and Internet Expenses', 78.00, 'SSL & backup storage');

  // --- 10. Travel Excl. Meals ($405.34 exact) ---
  push('2026-03-24', 'Credit Card Expense', 'Amtrak & Uber Business', 'Amtrak', 'Travel Expense:Ground Transportation', 82.40, 'Client site transit');
  push('2026-07-14', 'Credit Card Expense', 'Amtrak & Uber Business', 'Amtrak', 'Travel Expense:Ground Transportation', 60.44, 'Airport ground transfer');
  push('2026-05-07', 'Credit Card Expense', 'Marriott Courtyard', 'AMX CC', 'Travel Expense:Lodging', 142.50, 'Client site overnight');
  push('2026-09-18', 'Credit Card Expense', 'Southwest Airlines', 'AMX CC', 'Travel Expense:Airfare', 120.00, 'Regional client flight');

  // --- 11. Meals 100% Gross ($1,806.58 exact — including nested Travel meal lines moved out of Travel) ---
  push('2026-02-11', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Business Meals at Restaurant (50%)', 248.90, 'Client lunch meeting');
  push('2026-06-19', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Business Meals at Restaurant (50%)', 216.50, 'Quarterly review dinner');
  push('2026-10-08', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Meals at Restaurant', 220.00, 'Client strategy lunch');
  push('2026-03-25', 'Credit Card Expense', 'Client Travel Dining', 'AMX CC', 'Travel Expense:Business Meals', 284.18, 'On-site client working dinner');
  push('2026-09-19', 'Credit Card Expense', 'Client Travel Dining', 'AMX CC', 'Travel Expense:Business Meals', 258.00, 'Travel business meal');
  push('2026-05-08', 'Credit Card Expense', 'Travel Solo Meals', 'Cap One CC', 'Solo Meals (50%)', 164.50, 'Travel per-diem meals');
  push('2026-08-12', 'Credit Card Expense', 'Travel Solo Meals', 'Cap One CC', 'Solo Meals (50%)', 148.00, 'Travel solo dinner');
  push('2026-07-15', 'Credit Card Expense', 'Travel Individual Meals', 'Cap One CC', 'Travel Expense:Individual Meals', 138.25, 'Out-of-town individual meals');
  push('2026-11-04', 'Credit Card Expense', 'Travel Individual Meals', 'Cap One CC', 'Travel Expense:Individual Meals', 128.25, 'Out-of-town individual meals');

  // --- 12. Office Expense ($7,862.31 exact) ---
  push('2026-01-29', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 892.40, 'Office consumables & toner');
  push('2026-04-03', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1124.91, 'Filing & desk supplies');
  push('2026-07-21', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1285.00, 'Printing & shipping supplies');
  push('2026-10-29', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1085.00, 'Q4 office supplies');
  push('2026-06-04', 'Credit Card Expense', 'Apple Business Store', 'AMX CC', 'Office Equipment', 3475.00, 'Workstation laptop & 4K display (One-Time)');

  // --- 13. Insurance ($1,190.92 exact — Quarterly: 3/15, 6/15, 9/15 -> 1 left: 12/15) ---
  const insAmts = splitIntoInstallments(1190.92, 3);
  push('2026-03-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[0], 'Q1 E&O & General Liability');
  push('2026-06-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[1], 'Q2 E&O & General Liability');
  push('2026-09-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[2], 'Q3 E&O & General Liability');

  // --- 14. Utilities ($149.45 exact — Monthly Day 25, Jan-Oct -> 2 left: 11/25, 12/25) ---
  const utilAmts = splitIntoInstallments(149.45, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-25`;
    push(dt, 'Expense', 'Southwest Office Utilities', 'BlueVine Checking', 'Utilities', -utilAmts[m - 1], 'Monthly office utility share');
  }

  // --- 15. Bank & Payroll Processing Fees ($1,032.99 exact) ---
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-15`;
    push(dt, 'Expense', 'Gusto Payroll Processing', 'BlueVine Checking', 'Payroll Expenses', -80.00, 'Monthly payroll platform fee');
  } // 880.00
  push('2026-03-31', 'Expense', 'BlueVine Wire & Service Fees', 'BlueVine Checking', 'Bank Service Charges', -75.00, 'Domestic wire fees');
  push('2026-09-30', 'Expense', 'BlueVine Wire & Service Fees', 'BlueVine Checking', 'Bank Service Charges', -77.99, 'Bank service charges');

  // --- 16. Other Deductions ($1,973.43 exact so total Book Expenses = $88,300.27 exact!) ---
  push('2026-05-20', 'Credit Card Expense', 'AICPA & CPE Annual Summit', 'Cap One CC', 'Continuing Education', 650.00, 'Annual continuing education (One-Time)');
  push('2026-04-30', 'Expense', 'Commercial Line Interest', 'BlueVine Checking', 'Interest Expense', -92.10, 'Short-term interest');
  push('2026-10-31', 'Expense', 'Commercial Line Interest', 'BlueVine Checking', 'Interest Expense', -92.10, 'Short-term interest');
  push('2026-03-06', 'Expense', 'Office Petty Cash', 'BlueVine Checking', 'Petty Cash', -145.00, 'Postage & office petty cash');
  push('2026-08-19', 'Expense', 'Office Petty Cash', 'BlueVine Checking', 'Petty Cash', -150.00, 'Local courier & petty cash');
  push('2026-02-04', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 281.41, 'Client document shipping');
  push('2026-06-26', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 298.60, 'Equipment return & shipping');
  push('2026-11-09', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 264.22, 'Client binder courier');

  // --- 17. Credit Card Payments from BlueVine Checking (Excluded from P&L; reconciles CC balance to $2,963.77 exact!) ---
  // Calculate exact CC charges by card from rows above so ending CC balance = $2,963.77 exact:
  // Amazon CC: Beg 950 + (84.57+78+892.40+1124.91+1285+1085+281.41+298.60+264.22 = 5394.11) = 6344.11 -> Pay 5400.00 => End 944.11
  // Cap One CC: Beg 850 + (3797.30+770+164.50+148+138.25+128.25+650 = 5796.30) = 6646.30 -> Pay 5700.00 => End 946.30
  // AMX CC: Beg 600 + (1450+142.50+120+248.90+216.50+220+284.18+258+3475 = 6415.08) = 7015.08 -> Pay 6000.00 => End 1015.08
  // Amtrak: Beg 0 + (82.40+60.44 = 142.84) -> Pay 84.56 => End 58.28
  // Total Ending CC = 944.11 + 946.30 + 1015.08 + 58.28 = $2,963.77 EXACT!
  push('2026-03-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');
  push('2026-07-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');
  push('2026-10-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');

  push('2026-04-18', 'Credit Card Payment', 'Cap One CC Payment', 'BlueVine Checking', 'Cap One CC', -2850.00, 'Card statement payoff');
  push('2026-09-18', 'Credit Card Payment', 'Cap One CC Payment', 'BlueVine Checking', 'Cap One CC', -2850.00, 'Card statement payoff');

  push('2026-06-24', 'Credit Card Payment', 'AMX CC Payment', 'BlueVine Checking', 'AMX CC', -4000.00, 'AMEX statement payment');
  push('2026-10-24', 'Credit Card Payment', 'AMX CC Payment', 'BlueVine Checking', 'AMX CC', -2000.00, 'AMEX statement payment');

  push('2026-08-05', 'Credit Card Payment', 'Amtrak Card Payment', 'BlueVine Checking', 'Amtrak', -84.56, 'Amtrak statement payment');

  // --- 18. Member Draws ($121,939.75 exact — excluded from P&L, tracked in Form 7203) ---
  const drawInstallments = splitIntoInstallments(121939.75, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-15`;
    push(dt, 'Check', 'Shareholder Distribution (Bill & Debra)', 'BlueVine Checking', 'Member Draws', -drawInstallments[m - 1], 'Monthly S-Corp member draw');
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export const OSS_NOV21_2026_QBO_BENCHMARKS: NonNullable<CadenceForecasterState['qbo_expected']> = {
  revenue: 319283.71,
  expenses: 88300.27,
  interest_income: 609.18,
  cash: 42580.89,
  credit_cards: 2963.77,
  member_draws: 121939.75,
};

export function createInitialCadenceForecasterState(
  year2025EndingBasis = 0
): CadenceForecasterState {
  const sampleTransactions = createSampleOssTransactions();
  return {
    projection_year: 2026,
    source_label: 'Sample OSS QBO Transaction Ledger (1/1/2026–11/21/2026)',
    ledger_format: 'transaction_list',
    as_of_date: '2026-11-21',
    exp_smooth_alpha: DEFAULT_EXP_SMOOTH_ALPHA,
    exp_smooth_day_fraction: false,
    transactions: sampleTransactions,
    stream_overrides: {},
    pnl_line_overrides: {
      // Planned year-end retirement accruals (discretionary Mode C defaults to $0 unless entered)
      dbp_contribution: { remaining: 61000.0 },
      employer_401k: { remaining: 3571.0 },
    },
    balance_sheet: {
      as_of_date: '2026-11-21',
      operating_cash_beg: 76904.25,
      operating_cash_ytd: 42580.89,
      operating_cash_ye_override: null,
      pension_payable_beg: 144540.0,
      pension_payable_ytd: 0.0,
      pension_payable_ye: 64571.0,
      cc_ap_beg: 2400.0,
      cc_ap_ytd: 2963.77,
      cc_ap_ye: 2963.77,
      member_draws_ytd: 121939.75,
      member_draws_remaining: 0.0,
      capital_contributions_ytd: 0.0,
      capital_contributions_remaining: 0.0,
      beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
    },
    qbo_expected: { ...OSS_NOV21_2026_QBO_BENCHMARKS },
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
  prevExpSmooth?: { alpha?: number; dayFraction?: boolean }
): CadenceForecasterState {
  const year = detectedYear && detectedYear >= 2020 && detectedYear <= 2040 ? detectedYear : 2026;
  const asOfDate = detectedAsOfDate || `${year}-11-21`;

  // Preserve 11/21/2026 OSS reconciliation benchmarks when importing a 2026 ledger dated 11/21/2026
  // (or an Operating Support Services 2026 export) so the user gets immediate $0.00 diff confirmation
  const shouldApplyOssBenchmarks =
    year === 2026 &&
    (asOfDate === '2026-11-21' || /operating support services/i.test(sourceLabel));

  const draft: CadenceForecasterState = {
    projection_year: year,
    source_label: sourceLabel,
    ledger_format: ledgerFormat,
    as_of_date: asOfDate,
    exp_smooth_alpha: clampExpSmoothAlpha(prevExpSmooth?.alpha),
    exp_smooth_day_fraction: Boolean(prevExpSmooth?.dayFraction),
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
    ...(shouldApplyOssBenchmarks
      ? { qbo_expected: prevQboExpected ?? { ...OSS_NOV21_2026_QBO_BENCHMARKS } }
      : {}),
  };

  // Run one pass to auto-populate Balance Sheet YTD & Beginning balances from the ledger
  const probe = computeCadenceForecast(draft);
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
