import type {
  BalanceSheetProjectionInputs,
  ComputedTaxYear,
  PnlBalanceSheetState,
  PnlLineAmounts,
  PnlLineId,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { getPersonNames } from './scheduleCatalog';

export type PnlSectionId =
  | 'revenue'
  | 'compensation'
  | 'retirement'
  | 'operating_expenses'
  | 'schedule_k';

export interface PnlLineMeta {
  id: PnlLineId;
  section: PnlSectionId;
  label: string;
  getLabel?: (setup: SetupConfig) => string;
  form1120sRef: string;
  filed2025: number;
  note?: string;
}

export const PNL_SECTIONS: { id: PnlSectionId; title: string; subtitle: string }[] = [
  {
    id: 'revenue',
    title: 'Revenue',
    subtitle: 'Form 1120-S Line 1a · State-sourced gross receipts & apportionment',
  },
  {
    id: 'compensation',
    title: 'Compensation',
    subtitle: 'Form 1120-S Lines 7 & 8 · Shareholder W-2 payroll',
  },
  {
    id: 'retirement',
    title: 'Retirement & Benefits',
    subtitle: 'Form 1120-S Line 17 & >2% Shareholder Health (SEHI)',
  },
  {
    id: 'operating_expenses',
    title: 'Operating Expenses',
    subtitle: 'Form 1120-S Lines 11, 12 & 19 · Excluding W-2 & Retirement',
  },
];

export const SCHEDULE_K_LINE_META: PnlLineMeta = {
  id: 'schedule_k_interest',
  section: 'schedule_k',
  label: 'Schedule K Interest Income (Portfolio)',
  form1120sRef: 'Sch K Line 4',
  filed2025: 619,
  note: 'Excluded from Line 22 Ordinary Income · Included in Form 7203 stock basis',
};

/**
 * Canonical Form 1120-S P&L catalog with exact 2025 Filed Actuals reference figures:
 * Revenue: $136,770 CA + $242,815 AZ = $379,585
 * Compensation: $42,000 Bill + $33,550 Debra = $75,550
 * Retirement & Benefits: $140,000 DBP + $4,540 401(k) + $0 SEHI = $144,540
 * Operating Expenses: Rents $35,447 + Payroll Taxes $6,130 + CA FTB $2,891
 *   + Meals 50% Deductible $1,910 (from $3,820 Gross; $1,910 Sch M-1 Nondeductible)
 *   + Other Deductions $21,619 = $67,997
 * 2025 Filed Ordinary Business Income (Line 22): $379,585 - $75,550 - $144,540 - $67,997 = $91,498
 * 2025 Filed Schedule K Line 4 Interest Income: $619 (Bill $316 / Debra $303)
 */
export const PNL_LINE_ITEMS: PnlLineMeta[] = [
  {
    id: 'ca_revenue',
    section: 'revenue',
    label: 'California S-Corp Revenue',
    form1120sRef: 'Line 1a · CA Sch R',
    filed2025: 136770,
    note: 'QBO: Consulting - Debra (CA)',
  },
  {
    id: 'az_revenue',
    section: 'revenue',
    label: 'Arizona S-Corp Revenue',
    form1120sRef: 'Line 1a · AZ Sch A',
    filed2025: 242815,
    note: 'QBO: Consulting - Bill (AZ) + Services - Bill (AZ) + Services Income',
  },
  {
    id: 'bill_officer_w2',
    section: 'compensation',
    label: 'Bill Officer W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).primaryName} Officer W-2 Compensation`,
    form1120sRef: 'Line 7',
    filed2025: 42000,
    note: 'QBO: Salary → Bill',
  },
  {
    id: 'debra_salaries_wages',
    section: 'compensation',
    label: 'Debra Salaries & Wages',
    getLabel: (s) => `${getPersonNames(s).spouseName} Salaries & Wages`,
    form1120sRef: 'Line 8',
    filed2025: 33550,
    note: 'QBO: Salary → Debra',
  },
  {
    id: 'dbp_contribution',
    section: 'retirement',
    label: 'Defined Benefit Plan (DBP) Contribution',
    form1120sRef: 'Line 17',
    filed2025: 140000,
  },
  {
    id: 'employer_401k',
    section: 'retirement',
    label: 'Employer 401(k) Profit Sharing / Match',
    form1120sRef: 'Line 17',
    filed2025: 4540,
  },
  {
    id: 'sehi_medicare',
    section: 'retirement',
    label: 'SEHI Medicare Premiums',
    form1120sRef: 'Line 18 / Sch 1 Ln 17',
    filed2025: 0,
    note: 'QBO: Shareholder Health Insurance (Bill + Debra)',
  },
  {
    id: 'rents',
    section: 'operating_expenses',
    label: 'Rents',
    form1120sRef: 'Line 11',
    filed2025: 35447,
  },
  {
    id: 'payroll_taxes',
    section: 'operating_expenses',
    label: 'Taxes & Licenses — Payroll Taxes',
    form1120sRef: 'Line 12',
    filed2025: 6130,
    note: 'QBO: CA SDI, CA SUI-ER, Fed, MedCare, AZ SUI-ER',
  },
  {
    id: 'ca_ftb_tax',
    section: 'operating_expenses',
    label: 'Taxes & Licenses — CA FTB / State Tax',
    form1120sRef: 'Line 12',
    filed2025: 2891,
    note: 'QBO: State (allows refunds/credits e.g. -$466.84)',
  },
  {
    id: 'professional_fees',
    section: 'operating_expenses',
    label: 'Professional Fees',
    form1120sRef: 'Line 19',
    filed2025: 0,
    note: 'QBO: Professional Fees + legal fees',
  },
  {
    id: 'subscriptions_software',
    section: 'operating_expenses',
    label: 'Subscriptions & Software',
    form1120sRef: 'Line 19',
    filed2025: 0,
  },
  {
    id: 'telephone_internet',
    section: 'operating_expenses',
    label: 'Telephone & Internet',
    form1120sRef: 'Line 19',
    filed2025: 0,
    note: 'QBO: Telephone Expense + Internet + Computer and Internet Expenses',
  },
  {
    id: 'travel',
    section: 'operating_expenses',
    label: 'Travel (Excl. Meals)',
    form1120sRef: 'Line 19',
    filed2025: 0,
    note: 'QBO: Ground Transportation + Lodging (nested meals moved to Meals)',
  },
  {
    id: 'meals_gross',
    section: 'operating_expenses',
    label: 'Meals (100% Gross)',
    form1120sRef: 'Line 19 / Sch M-1',
    filed2025: 3820,
    note: 'QBO: Meals at Restaurant + Travel Business/Individual Meals (50/50 split)',
  },
  {
    id: 'office_expense',
    section: 'operating_expenses',
    label: 'Office Expense',
    form1120sRef: 'Line 19',
    filed2025: 0,
    note: 'QBO: Office Equipment + Office Supplies',
  },
  {
    id: 'insurance',
    section: 'operating_expenses',
    label: 'Insurance',
    form1120sRef: 'Line 19',
    filed2025: 0,
  },
  {
    id: 'utilities',
    section: 'operating_expenses',
    label: 'Utilities',
    form1120sRef: 'Line 19',
    filed2025: 0,
  },
  {
    id: 'bank_payroll_fees',
    section: 'operating_expenses',
    label: 'Bank & Payroll Processing Fees',
    form1120sRef: 'Line 19',
    filed2025: 0,
    note: 'QBO: Bank Service Charges + Payroll Expenses',
  },
  {
    id: 'other_deductions',
    section: 'operating_expenses',
    label: 'Other Deductions',
    form1120sRef: 'Line 19',
    filed2025: 21619,
    note: 'QBO: Continuing Education + Interest Expense + Petty Cash + Shipping',
  },
  SCHEDULE_K_LINE_META,
];

export const PNL_OPERATING_ITEMS: PnlLineMeta[] = PNL_LINE_ITEMS.filter(
  (i) => i.section !== 'schedule_k'
);

export function getPnlLineLabel(meta: PnlLineMeta, setup: SetupConfig): string {
  return meta.getLabel ? meta.getLabel(setup) : meta.label;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Creates the preloaded 2026 P&L & Balance Sheet projection using Operating Support
 * Services, LLC's actual 11/21/2026 YTD figures and 40-day remaining forecast.
 */
export function createInitialPnlBalanceSheetState(
  _year2026?: TaxYearRecord,
  year2025EndingBasis = 0
): PnlBalanceSheetState {
  const pnl: Record<PnlLineId, PnlLineAmounts> = {
    ca_revenue: { ytd: 127340.0, remaining: 15672.62 },
    az_revenue: { ytd: 191943.71, remaining: 23623.84 },
    bill_officer_w2: { ytd: 20534.52, remaining: 9223.48 },
    debra_salaries_wages: { ytd: 20257.99, remaining: 9501.01 },
    dbp_contribution: { ytd: 0, remaining: 61000.0 },
    employer_401k: { ytd: 0, remaining: 3571.0 },
    sehi_medicare: { ytd: 6167.85, remaining: 835.25 },
    rents: { ytd: 10487.0, remaining: 1290.71 },
    payroll_taxes: { ytd: 4162.86, remaining: 512.35 },
    ca_ftb_tax: { ytd: -466.84, remaining: 0 },
    professional_fees: { ytd: 6556.0, remaining: 806.89 },
    subscriptions_software: { ytd: 3797.3, remaining: 467.36 },
    telephone_internet: { ytd: 2382.57, remaining: 293.24 },
    travel: { ytd: 405.34, remaining: 49.89 },
    meals_gross: { ytd: 1806.58, remaining: 222.35 },
    office_expense: { ytd: 7862.31, remaining: 967.67 },
    insurance: { ytd: 1190.92, remaining: 146.57 },
    utilities: { ytd: 149.45, remaining: 18.39 },
    bank_payroll_fees: { ytd: 1032.99, remaining: 127.14 },
    other_deductions: { ytd: 1470.07, remaining: 180.93 },
    schedule_k_interest: { ytd: 609.18, remaining: 75.0 },
  };

  const balance_sheet: BalanceSheetProjectionInputs = {
    as_of_date: '2026-11-21',
    operating_cash_beg: 48500.0,
    operating_cash_ytd: 42580.89,
    operating_cash_ye_override: null,
    pension_payable_beg: 144540.0,
    pension_payable_ytd: 0,
    pension_payable_ye: 64571.0, // Accrued 2026 DBP ($61,000) + Employer 401(k) ($3,571)
    cc_ap_beg: 4200.0,
    cc_ap_ytd: 2963.77,
    cc_ap_ye: 2963.77,
    member_draws_ytd: 121939.75,
    member_draws_remaining: 0,
    capital_contributions_ytd: 0,
    capital_contributions_remaining: 0,
    beginning_stock_basis_override: year2025EndingBasis,
  };

  return {
    projection_year: 2026,
    pnl,
    balance_sheet,
  };
}

export function normalizePnlBalanceSheetState(
  raw: PnlBalanceSheetState | undefined,
  year2026?: TaxYearRecord
): PnlBalanceSheetState {
  const defaults = createInitialPnlBalanceSheetState(year2026, 0);
  if (!raw || !raw.pnl || !raw.balance_sheet) return defaults;

  // Seamlessly upgrade the earlier generic 2026-09-30 placeholder seed to the actual 2026-11-21 QBO preload
  const isLegacyPlaceholderSeed =
    raw.balance_sheet.as_of_date === '2026-09-30' &&
    raw.balance_sheet.operating_cash_ytd === 72400 &&
    raw.balance_sheet.member_draws_ytd === 90000 &&
    raw.pnl.ca_revenue?.ytd === 127125;
  if (isLegacyPlaceholderSeed) {
    return defaults;
  }

  const pnl = { ...defaults.pnl };
  for (const item of PNL_LINE_ITEMS) {
    const entry = raw.pnl[item.id];
    if (entry && typeof entry.ytd === 'number' && typeof entry.remaining === 'number') {
      pnl[item.id] = {
        ytd: Number.isFinite(entry.ytd) ? round2(entry.ytd) : defaults.pnl[item.id].ytd,
        remaining: Number.isFinite(entry.remaining)
          ? round2(entry.remaining)
          : defaults.pnl[item.id].remaining,
      };
    }
  }

  const bsRaw = raw.balance_sheet;
  const numOr = (val: unknown, fallback: number): number =>
    typeof val === 'number' && Number.isFinite(val) ? round2(val) : fallback;

  const balance_sheet: BalanceSheetProjectionInputs = {
    as_of_date:
      typeof bsRaw.as_of_date === 'string' && bsRaw.as_of_date
        ? bsRaw.as_of_date
        : defaults.balance_sheet.as_of_date,
    operating_cash_beg: numOr(bsRaw.operating_cash_beg, defaults.balance_sheet.operating_cash_beg),
    operating_cash_ytd: numOr(bsRaw.operating_cash_ytd, defaults.balance_sheet.operating_cash_ytd),
    operating_cash_ye_override:
      typeof bsRaw.operating_cash_ye_override === 'number' &&
      Number.isFinite(bsRaw.operating_cash_ye_override)
        ? round2(bsRaw.operating_cash_ye_override)
        : null,
    pension_payable_beg: numOr(
      bsRaw.pension_payable_beg,
      defaults.balance_sheet.pension_payable_beg
    ),
    pension_payable_ytd: numOr(
      bsRaw.pension_payable_ytd,
      defaults.balance_sheet.pension_payable_ytd
    ),
    pension_payable_ye: numOr(bsRaw.pension_payable_ye, defaults.balance_sheet.pension_payable_ye),
    cc_ap_beg: numOr(bsRaw.cc_ap_beg, defaults.balance_sheet.cc_ap_beg),
    cc_ap_ytd: numOr(bsRaw.cc_ap_ytd, defaults.balance_sheet.cc_ap_ytd),
    cc_ap_ye: numOr(bsRaw.cc_ap_ye, defaults.balance_sheet.cc_ap_ye),
    member_draws_ytd: numOr(bsRaw.member_draws_ytd, defaults.balance_sheet.member_draws_ytd),
    member_draws_remaining: numOr(
      bsRaw.member_draws_remaining,
      defaults.balance_sheet.member_draws_remaining
    ),
    capital_contributions_ytd: numOr(
      bsRaw.capital_contributions_ytd,
      defaults.balance_sheet.capital_contributions_ytd
    ),
    capital_contributions_remaining: numOr(
      bsRaw.capital_contributions_remaining,
      defaults.balance_sheet.capital_contributions_remaining
    ),
    beginning_stock_basis_override:
      typeof bsRaw.beginning_stock_basis_override === 'number' &&
      Number.isFinite(bsRaw.beginning_stock_basis_override)
        ? round2(bsRaw.beginning_stock_basis_override)
        : null,
  };

  return {
    projection_year:
      typeof raw.projection_year === 'number' && Number.isFinite(raw.projection_year)
        ? raw.projection_year
        : 2026,
    pnl,
    balance_sheet,
    last_pushed_at: raw.last_pushed_at,
  };
}

export interface ComputedColumnTriple {
  ytd: number;
  remaining: number;
  projected: number;
  filed2025: number;
}

export interface ComputedPnlBalanceSheet {
  lines: Record<PnlLineId, ComputedColumnTriple>;
  totalRevenue: ComputedColumnTriple;
  caPct: { ytd: number; remaining: number; projected: number; filed2025: number };
  azPct: { ytd: number; remaining: number; projected: number; filed2025: number };
  totalCompensation: ComputedColumnTriple;
  totalRetirementBenefits: ComputedColumnTriple;
  taxesAndLicensesTotal: ComputedColumnTriple;
  mealsDeductible50: ComputedColumnTriple;
  mealsNondeductible50: ComputedColumnTriple;
  totalOperatingExpensesDeductible: ComputedColumnTriple; // Excl. W-2 & Retirement, includes 50% deductible meals
  totalOperatingExpensesBook: ComputedColumnTriple; // Excl. W-2 & Retirement, 100% gross meals
  ordinaryBusinessIncome: ComputedColumnTriple; // Form 1120-S Line 22 (Excl. Sch K Interest)
  scheduleKInterest: ComputedColumnTriple; // Form 1120-S Sch K Line 4
  bookNetIncome: ComputedColumnTriple; // Ordinary Business Income + Sch K Interest - 50% Nondeductible Meals
  // Balance Sheet & Form 7203
  beginningStockBasis: number;
  projectedDrawsTotal: number;
  projectedCapitalContributionsTotal: number;
  basisAvailableBeforeDraws: number;
  projectedEndingStockBasis: number;
  projectedExcessDistributionGain: number;
  drawsExceedBasis: boolean;
  basisShortfall: number;
  // Shareholder 51/49 split
  billSharePct: number;
  debraSharePct: number;
  billProjectedBasisEnding: number;
  debraProjectedBasisEnding: number;
  billExcessGain: number;
  debraExcessGain: number;
  // Balance Sheet Schedule L computed year-end cash & net working capital
  autoProjectedCashYe: number;
  projectedCashYe: number;
  netCashPositionBeg: number;
  netCashPositionYtd: number;
  netCashPositionYe: number;
}

export function calculatePnlBalanceSheet(
  state: PnlBalanceSheetState,
  year2025Computed?: ComputedTaxYear
): ComputedPnlBalanceSheet {
  const lines = {} as Record<PnlLineId, ComputedColumnTriple>;
  for (const meta of PNL_LINE_ITEMS) {
    const raw = state.pnl[meta.id] ?? { ytd: 0, remaining: 0 };
    lines[meta.id] = {
      ytd: round2(raw.ytd),
      remaining: round2(raw.remaining),
      projected: round2(raw.ytd + raw.remaining),
      filed2025: meta.filed2025,
    };
  }

  const sumTriples = (ids: PnlLineId[]): ComputedColumnTriple =>
    ids.reduce(
      (acc, id) => ({
        ytd: round2(acc.ytd + lines[id].ytd),
        remaining: round2(acc.remaining + lines[id].remaining),
        projected: round2(acc.projected + lines[id].projected),
        filed2025: round2(acc.filed2025 + lines[id].filed2025),
      }),
      { ytd: 0, remaining: 0, projected: 0, filed2025: 0 }
    );

  const totalRevenue = sumTriples(['ca_revenue', 'az_revenue']);
  const pct = (part: number, whole: number) =>
    whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;

  const caPct = {
    ytd: pct(lines.ca_revenue.ytd, totalRevenue.ytd),
    remaining: pct(lines.ca_revenue.remaining, totalRevenue.remaining),
    projected: pct(lines.ca_revenue.projected, totalRevenue.projected),
    filed2025: pct(lines.ca_revenue.filed2025, totalRevenue.filed2025),
  };
  const azPct = {
    ytd: totalRevenue.ytd > 0 ? Number((100 - caPct.ytd).toFixed(1)) : 0,
    remaining: totalRevenue.remaining > 0 ? Number((100 - caPct.remaining).toFixed(1)) : 0,
    projected: totalRevenue.projected > 0 ? Number((100 - caPct.projected).toFixed(1)) : 0,
    filed2025: totalRevenue.filed2025 > 0 ? Number((100 - caPct.filed2025).toFixed(1)) : 0,
  };

  const totalCompensation = sumTriples(['bill_officer_w2', 'debra_salaries_wages']);
  const totalRetirementBenefits = sumTriples([
    'dbp_contribution',
    'employer_401k',
    'sehi_medicare',
  ]);
  const taxesAndLicensesTotal = sumTriples(['payroll_taxes', 'ca_ftb_tax']);

  // Meals 50/50 split (Schedule M-1)
  const mealsDeductible50: ComputedColumnTriple = {
    ytd: round2(lines.meals_gross.ytd * 0.5),
    remaining: round2(lines.meals_gross.remaining * 0.5),
    projected: round2(lines.meals_gross.projected * 0.5),
    filed2025: round2(lines.meals_gross.filed2025 * 0.5),
  };
  const mealsNondeductible50: ComputedColumnTriple = {
    ytd: round2(lines.meals_gross.ytd - mealsDeductible50.ytd),
    remaining: round2(lines.meals_gross.remaining - mealsDeductible50.remaining),
    projected: round2(lines.meals_gross.projected - mealsDeductible50.projected),
    filed2025: round2(lines.meals_gross.filed2025 - mealsDeductible50.filed2025),
  };

  const nonMealOpExIds: PnlLineId[] = [
    'rents',
    'payroll_taxes',
    'ca_ftb_tax',
    'professional_fees',
    'subscriptions_software',
    'telephone_internet',
    'travel',
    'office_expense',
    'insurance',
    'utilities',
    'bank_payroll_fees',
    'other_deductions',
  ];
  const nonMealOpEx = sumTriples(nonMealOpExIds);

  const totalOperatingExpensesDeductible: ComputedColumnTriple = {
    ytd: round2(nonMealOpEx.ytd + mealsDeductible50.ytd),
    remaining: round2(nonMealOpEx.remaining + mealsDeductible50.remaining),
    projected: round2(nonMealOpEx.projected + mealsDeductible50.projected),
    filed2025: round2(nonMealOpEx.filed2025 + mealsDeductible50.filed2025),
  };

  const totalOperatingExpensesBook: ComputedColumnTriple = {
    ytd: round2(nonMealOpEx.ytd + lines.meals_gross.ytd),
    remaining: round2(nonMealOpEx.remaining + lines.meals_gross.remaining),
    projected: round2(nonMealOpEx.projected + lines.meals_gross.projected),
    filed2025: round2(nonMealOpEx.filed2025 + lines.meals_gross.filed2025),
  };

  // Form 1120-S Line 22 excludes Schedule K Line 4 portfolio Interest Income
  const ordinaryBusinessIncome: ComputedColumnTriple = {
    ytd: round2(
      totalRevenue.ytd -
        totalCompensation.ytd -
        totalRetirementBenefits.ytd -
        totalOperatingExpensesDeductible.ytd
    ),
    remaining: round2(
      totalRevenue.remaining -
        totalCompensation.remaining -
        totalRetirementBenefits.remaining -
        totalOperatingExpensesDeductible.remaining
    ),
    projected: round2(
      totalRevenue.projected -
        totalCompensation.projected -
        totalRetirementBenefits.projected -
        totalOperatingExpensesDeductible.projected
    ),
    filed2025: round2(
      totalRevenue.filed2025 -
        totalCompensation.filed2025 -
        totalRetirementBenefits.filed2025 -
        totalOperatingExpensesDeductible.filed2025
    ),
  };

  const scheduleKInterest = lines.schedule_k_interest;

  const bookNetIncome: ComputedColumnTriple = {
    ytd: round2(ordinaryBusinessIncome.ytd + scheduleKInterest.ytd - mealsNondeductible50.ytd),
    remaining: round2(
      ordinaryBusinessIncome.remaining +
        scheduleKInterest.remaining -
        mealsNondeductible50.remaining
    ),
    projected: round2(
      ordinaryBusinessIncome.projected +
        scheduleKInterest.projected -
        mealsNondeductible50.projected
    ),
    filed2025: round2(
      ordinaryBusinessIncome.filed2025 +
        scheduleKInterest.filed2025 -
        mealsNondeductible50.filed2025
    ),
  };

  // Balance Sheet & Form 7203 Stock Basis Projection
  const bs = state.balance_sheet;
  const beginningStockBasis =
    bs.beginning_stock_basis_override !== null
      ? round2(bs.beginning_stock_basis_override)
      : round2(year2025Computed?.scorp_out.stock_basis_ending ?? 0);

  const projectedDrawsTotal = round2(bs.member_draws_ytd + bs.member_draws_remaining);
  const projectedCapitalContributionsTotal = round2(
    bs.capital_contributions_ytd + bs.capital_contributions_remaining
  );

  // IRC §1367(a) ordering:
  // 1. Beginning Basis + Positive K-1 Ordinary Income + Schedule K Interest Income + Capital Contributions
  // 2. Minus Distributions (excess = Form 8949 Long-Term Capital Gain)
  // 3. Minus Nondeductible Expenses (50% Meals Sch M-1) & Ordinary Loss (not below $0)
  const positiveIncome = Math.max(0, ordinaryBusinessIncome.projected);
  const positiveSchKInterest = Math.max(0, scheduleKInterest.projected);
  const ordinaryLoss =
    ordinaryBusinessIncome.projected < 0 ? Math.abs(ordinaryBusinessIncome.projected) : 0;
  const basisAvailableBeforeDraws = round2(
    beginningStockBasis +
      positiveIncome +
      positiveSchKInterest +
      projectedCapitalContributionsTotal
  );
  const projectedExcessDistributionGain = round2(
    Math.max(0, projectedDrawsTotal - Math.max(0, basisAvailableBeforeDraws))
  );
  const basisAfterDraws = round2(Math.max(0, basisAvailableBeforeDraws - projectedDrawsTotal));
  const projectedEndingStockBasis = round2(
    Math.max(0, basisAfterDraws - mealsNondeductible50.projected - ordinaryLoss)
  );
  const drawsExceedBasis = projectedExcessDistributionGain > 0;
  const basisShortfall = projectedExcessDistributionGain;

  const billSharePct = (year2025Computed?.scorp_in.bill_ownership_pct ?? 51) / 100;
  const debraSharePct = (year2025Computed?.scorp_in.debra_ownership_pct ?? 49) / 100;

  const billBeg = round2(beginningStockBasis * billSharePct);
  const debraBeg = round2(beginningStockBasis - billBeg);
  const billBeforeDraws = round2(
    billBeg +
      round2(positiveIncome * billSharePct) +
      round2(positiveSchKInterest * billSharePct) +
      round2(projectedCapitalContributionsTotal * billSharePct)
  );
  const debraBeforeDraws = round2(basisAvailableBeforeDraws - billBeforeDraws);
  const billDraws = round2(projectedDrawsTotal * billSharePct);
  const debraDraws = round2(projectedDrawsTotal - billDraws);
  const billExcessGain = round2(Math.max(0, billDraws - billBeforeDraws));
  const debraExcessGain = round2(Math.max(0, debraDraws - debraBeforeDraws));
  const billNonded = round2(mealsNondeductible50.projected * billSharePct);
  const debraNonded = round2(mealsNondeductible50.projected - billNonded);
  const billLoss = round2(ordinaryLoss * billSharePct);
  const debraLoss = round2(ordinaryLoss - billLoss);
  const billProjectedBasisEnding = round2(
    Math.max(0, Math.max(0, billBeforeDraws - billDraws) - billNonded - billLoss)
  );
  const debraProjectedBasisEnding = round2(
    Math.max(0, Math.max(0, debraBeforeDraws - debraDraws) - debraNonded - debraLoss)
  );

  // Projected Year-End Cash estimate:
  // Current YTD Cash + Remaining Book Net Income (includes Remaining Sch K Interest & 100% Meals)
  // + Change in Pension Payable (YE - YTD) + Change in CC/AP (YE - YTD)
  // + Remaining Capital Contributions - Remaining Member Draws
  const pensionAccrualDelta = round2(bs.pension_payable_ye - bs.pension_payable_ytd);
  const ccApDelta = round2(bs.cc_ap_ye - bs.cc_ap_ytd);
  const autoProjectedCashYe = round2(
    bs.operating_cash_ytd +
      bookNetIncome.remaining +
      pensionAccrualDelta +
      ccApDelta +
      bs.capital_contributions_remaining -
      bs.member_draws_remaining
  );
  const projectedCashYe =
    bs.operating_cash_ye_override !== null
      ? round2(bs.operating_cash_ye_override)
      : autoProjectedCashYe;

  const netCashPositionBeg = round2(
    bs.operating_cash_beg - bs.pension_payable_beg - bs.cc_ap_beg
  );
  const netCashPositionYtd = round2(
    bs.operating_cash_ytd - bs.pension_payable_ytd - bs.cc_ap_ytd
  );
  const netCashPositionYe = round2(projectedCashYe - bs.pension_payable_ye - bs.cc_ap_ye);

  return {
    lines,
    totalRevenue,
    caPct,
    azPct,
    totalCompensation,
    totalRetirementBenefits,
    taxesAndLicensesTotal,
    mealsDeductible50,
    mealsNondeductible50,
    totalOperatingExpensesDeductible,
    totalOperatingExpensesBook,
    ordinaryBusinessIncome,
    scheduleKInterest,
    bookNetIncome,
    beginningStockBasis,
    projectedDrawsTotal,
    projectedCapitalContributionsTotal,
    basisAvailableBeforeDraws,
    projectedEndingStockBasis,
    projectedExcessDistributionGain,
    drawsExceedBasis,
    basisShortfall,
    billSharePct: Math.round(billSharePct * 100),
    debraSharePct: Math.round(debraSharePct * 100),
    billProjectedBasisEnding,
    debraProjectedBasisEnding,
    billExcessGain,
    debraExcessGain,
    autoProjectedCashYe,
    projectedCashYe,
    netCashPositionBeg,
    netCashPositionYtd,
    netCashPositionYe,
  };
}

// ============================================================================
// QuickBooks Online (QBO) Paste & CSV Parser — Operating Support Services, LLC
// ============================================================================

export type QboTargetField =
  | PnlLineId
  | 'split_revenue_ca_az'
  | 'operating_cash_ytd'
  | 'pension_payable_ytd'
  | 'cc_ap_ytd'
  | 'member_draws_ytd'
  | 'capital_contributions_ytd'
  | 'ignore';

export interface ParsedQboRow {
  id: string;
  rawLabel: string;
  amount: number;
  suggestedTarget: QboTargetField;
  confidence: 'high' | 'medium' | 'unmatched';
  note?: string;
}

const SKIP_METADATA_PATTERNS: RegExp[] = [
  /^gross profit\b/i,
  /^net income\b/i,
  /^net operating income\b/i,
  /^net other income\b/i,
  /^net ordinary income\b/i,
  /^ordinary income\/expense/i,
  /^operating support services/i,
  /^profit and loss/i,
  /^balance sheet/i,
  /^as of\b/i,
  /^accrual basis/i,
  /^cash basis/i,
  /^january\b.*\d{4}/i,
];

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseQboCurrencyToken(token: string): number | null {
  const cleaned = token.trim();
  if (!cleaned || cleaned.includes('%')) return null;
  if (
    !/^\(?[-+]?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$|^\(?[-+]?\$?\s*\d+(?:\.\d+)?\)?$/.test(
      cleaned
    )
  ) {
    return null;
  }
  const isParenNeg = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numericStr = cleaned.replace(/[$,()\s]/g, '');
  const val = Number(numericStr);
  if (!Number.isFinite(val)) return null;
  return isParenNeg ? -Math.abs(val) : val;
}

function extractLabelAndAmount(line: string): { label: string; amount: number | null } {
  const trimmed = line.trim();
  if (!trimmed) return { label: '', amount: null };

  if (trimmed.includes('\t')) {
    const cols = trimmed.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 2) {
      for (let c = cols.length - 1; c >= 1; c--) {
        const parsed = parseQboCurrencyToken(cols[c]);
        if (parsed !== null) {
          return { label: cols[0].replace(/^["']|["']$/g, '').trim(), amount: parsed };
        }
      }
    }
    return { label: cols[0]?.replace(/^["']|["']$/g, '').trim() ?? '', amount: null };
  }

  if (trimmed.includes(',')) {
    const cols = splitCsvLine(trimmed);
    const firstText = (cols.find((c) => c && parseQboCurrencyToken(c) === null) ?? '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (cols.length >= 2) {
      for (let c = cols.length - 1; c >= 0; c--) {
        const parsed = parseQboCurrencyToken(cols[c]);
        if (parsed !== null) {
          return { label: firstText, amount: parsed };
        }
      }
    }
    return { label: firstText, amount: null };
  }

  const m = trimmed.match(
    /^(.+?)\s+(\(?[-+]?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?|\(?[-+]?\$?\s*\d+(?:\.\d+)?\)?)$/
  );
  if (m) {
    const parsed = parseQboCurrencyToken(m[2]);
    if (parsed !== null) {
      return { label: m[1].replace(/^["']|["']$/g, '').trim(), amount: parsed };
    }
  }

  return { label: trimmed.replace(/^["']|["']$/g, '').trim(), amount: null };
}

function classifyPnlLabel(
  label: string,
  parentSection: string
): { target: QboTargetField; confidence: ParsedQboRow['confidence']; isTravelMealChild?: boolean } {
  const l = label.toLowerCase().trim();
  const p = parentSection.toLowerCase().trim();

  // 1. Exact Operating Support Services, LLC Revenue accounts
  if (/consulting\s*[-–—:]?\s*debra\s*\(?ca\)?/i.test(l) || /(california|\bca\b).*(rev|sales|income|consult|fee)/i.test(l)) {
    return { target: 'ca_revenue', confidence: 'high' };
  }
  if (
    /consulting\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(l) ||
    /services\s*[-–—:]?\s*bill\s*\(?az\)?/i.test(l) ||
    /^services income$/i.test(l) ||
    /(arizona|\baz\b).*(rev|sales|income|consult|fee)/i.test(l)
  ) {
    return { target: 'az_revenue', confidence: 'high' };
  }

  // 2. Schedule K Line 4 Interest Income (must be checked BEFORE generic income or interest expense)
  if (/^interest income$/i.test(l) || /interest earned|bank interest/i.test(l)) {
    return { target: 'schedule_k_interest', confidence: 'high' };
  }

  // 3. Compensation: Salary -> Bill / Salary -> Debra (supports nested or inline arrow/colon)
  if (
    /salary\s*(?:->|→|:|-|\/)\s*bill/i.test(l) ||
    (/^bill$/i.test(l) && /salary|payroll|wage|comp/i.test(p)) ||
    /(officer.*comp|bill.*(w2|w-2|wage|sal|comp))/i.test(l)
  ) {
    return { target: 'bill_officer_w2', confidence: 'high' };
  }
  if (
    /salary\s*(?:->|→|:|-|\/)\s*debra/i.test(l) ||
    (/^debra$/i.test(l) && /salary|payroll|wage|comp/i.test(p)) ||
    /(debra.*(w2|w-2|wage|sal|comp)|salaries.*wages)/i.test(l)
  ) {
    return { target: 'debra_salaries_wages', confidence: 'high' };
  }

  // 4. SEHI Medicare Premiums: Shareholder Health Insurance
  if (
    /shareholder health/i.test(l) ||
    /(medicare|\bsehi\b|health.*ins|medical.*ins)/i.test(l)
  ) {
    return { target: 'sehi_medicare', confidence: 'high' };
  }

  // 5. Retirement: DBP & Employer 401(k)
  if (/(defined benefit|\bdbp\b|cash balance|pension.*contrib|pension.*plan)/i.test(l)) {
    return { target: 'dbp_contribution', confidence: 'high' };
  }
  if (/(401\(?k\)?|profit sharing|employer.*match|safe harbor)/i.test(l)) {
    return { target: 'employer_401k', confidence: 'high' };
  }

  // 6. Meals (100% Gross): Top-level "Meals at Restaurant" + nested "Business Meals" & "Individual Meals"
  if (/^business meals$/i.test(l) || /^individual meals$/i.test(l)) {
    return { target: 'meals_gross', confidence: 'high', isTravelMealChild: true };
  }
  if (/meals at restaurant|meal|dining|restaurant/i.test(l)) {
    return { target: 'meals_gross', confidence: 'high' };
  }

  // 7. Travel (Excl. Meals): Ground Transportation + Lodging + Travel Expense
  if (/ground transportation|lodging|airfare|hotel|flight|mileage|parking|^travel(\s+expense)?$/i.test(l)) {
    return { target: 'travel', confidence: 'high' };
  }

  // 8. Taxes & Licenses: Payroll Taxes vs State / CA FTB
  if (
    /^ca sdi$/i.test(l) ||
    /^ca sui[- ]?er$/i.test(l) ||
    /^az sui[- ]?er$/i.test(l) ||
    /^fed$/i.test(l) ||
    /^medcare$/i.test(l) ||
    /(payroll tax|fica|futa|suta|edd|sdi|sui-er)/i.test(l)
  ) {
    return { target: 'payroll_taxes', confidence: 'high' };
  }
  if (
    /^state$/i.test(l) ||
    /(\bftb\b|franchise tax|california.*tax|ca.*tax|state.*tax|100s)/i.test(l)
  ) {
    return { target: 'ca_ftb_tax', confidence: 'high' };
  }

  // 9. Rents
  if (/\brent\b|\brents\b|\blease\b|office space/i.test(l)) {
    return { target: 'rents', confidence: 'high' };
  }

  // 10. Professional Fees (+ legal fees)
  if (/professional fees?|legal fees?|accounting|\bcpa\b|attorney|actuar|bookkeep/i.test(l)) {
    return { target: 'professional_fees', confidence: 'high' };
  }

  // 11. Subscriptions & Software
  if (/subscription|software|saas|dues|membership|cloud|quickbooks/i.test(l)) {
    return { target: 'subscriptions_software', confidence: 'high' };
  }

  // 12. Telephone & Internet (+ Computer and Internet Expenses)
  if (
    /telephone expense|computer and internet expenses?|^internet$|telephone|phone|telecom|mobile|cell|wireless|broadband/i.test(
      l
    )
  ) {
    return { target: 'telephone_internet', confidence: 'high' };
  }

  // 13. Office Expense (Office Equipment + Office Supplies)
  if (/office equipment|office supplies|office exp|stationery|printing/i.test(l)) {
    return { target: 'office_expense', confidence: 'high' };
  }

  // 14. Insurance (business insurance; Shareholder Health already matched above)
  if (/insurance|liability|e&o|workers comp/i.test(l)) {
    return { target: 'insurance', confidence: 'high' };
  }

  // 15. Utilities
  if (/utilit|electric|water|gas|power|trash/i.test(l)) {
    return { target: 'utilities', confidence: 'high' };
  }

  // 16. Bank & Payroll Processing Fees (Bank Service Charges + Payroll Expenses)
  if (
    /bank service charges?|payroll expenses?|bank.*fee|merchant|processing|gusto|adp/i.test(l)
  ) {
    return { target: 'bank_payroll_fees', confidence: 'high' };
  }

  // 17. Other Deductions (Continuing Education + Interest Expense + Petty Cash + Shipping)
  if (
    /continuing education|interest expense|petty cash|shipping|postage|other|misc|advertising|marketing|repair|maintenance/i.test(
      l
    )
  ) {
    return { target: 'other_deductions', confidence: 'high' };
  }

  // Fallback generic revenue
  if (/(gross receipt|sales|revenue|income|billings)/i.test(l) && !/tax|expense|fee/i.test(l)) {
    return { target: 'split_revenue_ca_az', confidence: 'medium' };
  }

  return { target: 'other_deductions', confidence: 'unmatched' };
}

function classifyBalanceSheetLabel(
  label: string
): { target: QboTargetField; confidence: ParsedQboRow['confidence'] } {
  const l = label.toLowerCase().trim();

  // Operating Cash: BlueVine Checking (or generic checking/savings)
  if (
    /bluevine checking/i.test(l) ||
    (/(checking|savings|operating.*cash|cash.*bank|bank|money market)/i.test(l) &&
      !/credit card|\bcc\b/i.test(l))
  ) {
    return { target: 'operating_cash_ytd', confidence: 'high' };
  }

  // Pension Expense Payable: Defined Benefit Plan Payable + OSS 401K Plan Payable
  if (
    /defined benefit plan payable|oss 401k plan payable/i.test(l) ||
    /(pension.*pay|dbp.*pay|401\(?k\)?.*pay|retirement.*pay|accrued.*pension)/i.test(l)
  ) {
    return { target: 'pension_payable_ytd', confidence: 'high' };
  }

  // Credit Card / Accounts Payable: Amazon CC + Amtrak + AMX CC + Cap One CC
  if (
    /amazon\s*cc|amtrak|amx\s*cc|amex|cap\s*one\s*cc|capital\s*one/i.test(l) ||
    /(credit card|accounts payable|\ba\/p\b|visa|mastercard|chase ink|payable)/i.test(l)
  ) {
    return { target: 'cc_ap_ytd', confidence: 'high' };
  }

  // Member Draws (absolute value applied when importing)
  if (/member draws?|shareholder dist|owner.*draw|distribution/i.test(l)) {
    return { target: 'member_draws_ytd', confidence: 'high' };
  }

  // Capital Contributions
  if (/(capital contrib|paid[- ]in|owner.*contrib|member.*contrib|shareholder.*contrib)/i.test(l)) {
    return { target: 'capital_contributions_ytd', confidence: 'high' };
  }

  return { target: 'ignore', confidence: 'unmatched' };
}

export function parseQboReportText(
  rawText: string,
  reportType: 'pnl' | 'balance_sheet'
): ParsedQboRow[] {
  const rawLines = rawText.split(/\r?\n/);

  interface RawEntry {
    idx: number;
    label: string;
    amount: number;
    parent: string;
    isTotal: boolean;
  }

  const entries: RawEntry[] = [];
  let currentParent = '';

  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx];
    if (!rawLine.trim()) continue;

    const { label, amount } = extractLabelAndAmount(rawLine);
    if (!label) continue;
    if (SKIP_METADATA_PATTERNS.some((re) => re.test(label))) continue;

    const isTotal = /^total\b/i.test(label);

    // Header row with no numeric amount establishes parent section context (e.g., "Salary", "Travel Expense")
    if (amount === null) {
      if (!isTotal) {
        currentParent = label;
      }
      continue;
    }

    entries.push({
      idx,
      label,
      amount: round2(amount),
      parent: isTotal ? '' : currentParent,
      isTotal,
    });

    if (isTotal) {
      currentParent = '';
    }
  }

  if (reportType === 'balance_sheet') {
    const rows: ParsedQboRow[] = [];
    for (const e of entries) {
      if (e.isTotal) continue;
      const cls = classifyBalanceSheetLabel(e.label);
      const isDraws = cls.target === 'member_draws_ytd';
      rows.push({
        id: `qbo-${e.idx}-${e.label.slice(0, 16)}`,
        rawLabel: e.label,
        amount: isDraws ? Math.abs(e.amount) : e.amount,
        suggestedTarget: cls.target,
        confidence: cls.confidence,
        note: isDraws && e.amount < 0 ? 'Converted to positive YTD draw' : undefined,
      });
    }
    return rows;
  }

  // P&L pass: detect whether Shareholder Health children or non-meal Travel children exist
  const hasShareholderHealthChildren = entries.some(
    (e) => !e.isTotal && /shareholder health\s*[-–—:]\s*(bill|debra)/i.test(e.label)
  );
  const hasNonMealTravelChildren = entries.some(
    (e) => !e.isTotal && /ground transportation|lodging|airfare|hotel|flight/i.test(e.label)
  );

  // Sum nested Travel meals ("Business Meals" + "Individual Meals") in case Travel Expense is given as a parent/total figure
  let nestedTravelMealsTotal = 0;
  for (const e of entries) {
    if (!e.isTotal && (/^business meals$/i.test(e.label) || /^individual meals$/i.test(e.label))) {
      nestedTravelMealsTotal = round2(nestedTravelMealsTotal + e.amount);
    }
  }

  const rows: ParsedQboRow[] = [];

  for (const e of entries) {
    // Handle QBO subtotal rows carefully to prevent double-counting while honoring explicit Total rules
    if (e.isTotal) {
      if (/^total\s+(?:for\s+)?shareholder health insurance$/i.test(e.label)) {
        if (!hasShareholderHealthChildren) {
          rows.push({
            id: `qbo-${e.idx}-${e.label.slice(0, 16)}`,
            rawLabel: e.label,
            amount: e.amount,
            suggestedTarget: 'sehi_medicare',
            confidence: 'high',
          });
        }
        continue;
      }

      if (/^total\s+(?:for\s+)?travel expense$/i.test(e.label)) {
        if (!hasNonMealTravelChildren) {
          const adjustedTravel = round2(e.amount - nestedTravelMealsTotal);
          rows.push({
            id: `qbo-${e.idx}-${e.label.slice(0, 16)}`,
            rawLabel:
              nestedTravelMealsTotal > 0
                ? `${e.label} (net of $${nestedTravelMealsTotal.toFixed(2)} meals)`
                : e.label,
            amount: adjustedTravel,
            suggestedTarget: 'travel',
            confidence: 'high',
            note:
              nestedTravelMealsTotal > 0
                ? 'Subtracted Business & Individual Meals'
                : undefined,
          });
        }
        continue;
      }

      // Skip all other Total / Subtotal rows
      continue;
    }

    // If a standalone "Travel Expense" row has a gross total and no non-meal children exist, subtract nested meal lines
    if (/^travel expense$/i.test(e.label) && !hasNonMealTravelChildren && nestedTravelMealsTotal > 0) {
      const adjustedTravel = round2(e.amount - nestedTravelMealsTotal);
      rows.push({
        id: `qbo-${e.idx}-${e.label.slice(0, 16)}`,
        rawLabel: `${e.label} (net of $${nestedTravelMealsTotal.toFixed(2)} meals)`,
        amount: adjustedTravel,
        suggestedTarget: 'travel',
        confidence: 'high',
        note: 'Subtracted Business & Individual Meals',
      });
      continue;
    }

    const cls = classifyPnlLabel(e.label, e.parent);
    const displayLabel =
      e.parent && (/^bill$/i.test(e.label) || /^debra$/i.test(e.label))
        ? `${e.parent} → ${e.label}`
        : e.label;

    rows.push({
      id: `qbo-${e.idx}-${e.label.slice(0, 16)}`,
      rawLabel: displayLabel,
      amount: e.amount,
      suggestedTarget: cls.target,
      confidence: cls.confidence,
      note: cls.isTravelMealChild ? 'Moved from Travel to Meals (100% Gross)' : undefined,
    });
  }

  return rows;
}

export const SAMPLE_QBO_PNL_TEXT = `Consulting - Debra (CA)\t127,340.00
Consulting - Bill (AZ)\t165,443.71
Services - Bill (AZ)\t21,500.00
Services Income\t5,000.00
Salary
Bill\t20,534.52
Debra\t20,257.99
Total for Salary\t40,792.51
Shareholder Health Insurance
Shareholder Health - Bill\t3,083.93
Shareholder Health - Debra\t3,083.92
Total for Shareholder Health Insurance\t6,167.85
Rents\t10,487.00
Payroll Taxes
CA SDI\t498.12
CA SUI-ER\t340.00
Fed\t2,540.22
MedCare\t591.52
AZ SUI-ER\t193.00
Total for Payroll Taxes\t4,162.86
State\t-466.84
Professional Fees\t5,806.00
legal fees\t750.00
Subscriptions & Software\t3,797.30
Telephone Expense\t940.00
Internet\t842.57
Computer and Internet Expenses\t600.00
Travel Expense
Ground Transportation\t145.34
Lodging\t260.00
Business Meals\t890.00
Individual Meals\t216.58
Total for Travel Expense\t1,511.92
Meals at Restaurant\t700.00
Office Equipment\t4,912.31
Office Supplies\t2,950.00
Insurance\t1,190.92
Utilities\t149.45
Bank Service Charges\t182.99
Payroll Expenses\t850.00
Continuing Education\t620.00
Interest Expense\t185.07
Petty Cash\t340.00
Shipping\t325.00
Interest Income\t609.18`;

export const SAMPLE_QBO_BS_TEXT = `BlueVine Checking\t42,580.89
Amazon CC\t842.15
Amtrak\t310.00
AMX CC\t1,125.40
Cap One CC\t686.22
Defined Benefit Plan Payable\t0.00
OSS 401K Plan Payable\t0.00
Member Draws\t(121,939.75)`;

// ============================================================================
// CPA Projection Package CSV Builder
// ============================================================================

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const CPA_DISCLOSURE_METADATA = {
  preparedBy:
    'Prepared by Operating Support Services, LLC (ossadvisorygroup.com) - Rolling Tax Planner / Transaction Cadence Forecaster',
  purpose:
    'Preliminary tax-planning projection for review with your CPA (does not replace professional CPA, tax, legal, or accounting advice)',
  disclaimer:
    'This report is a preliminary tax-planning projection for review with your CPA and does not replace professional CPA, tax, legal, or accounting advice. Year-to-date figures reflect imported accounting or bookkeeping records as of the report cutoff date, while remaining-year projections use automated cadence or smoothing rules and user assumptions that require CPA review before tax return preparation or filing. Generated by the Operating Support Services, LLC application (ossadvisorygroup.com).',
  csvHeaderLines: [
    '# Prepared by Operating Support Services, LLC (ossadvisorygroup.com) - Rolling Tax Planner / Transaction Cadence Forecaster',
    '# Purpose: Preliminary tax-planning projection for review with your CPA (does not replace professional CPA, tax, legal, or accounting advice).',
    '# Disclaimer: This report is a preliminary tax-planning projection for review with your CPA and does not replace professional CPA, tax, legal, or accounting advice. Year-to-date figures reflect imported accounting or bookkeeping records as of the report cutoff date, while remaining-year projections use automated cadence or smoothing rules and user assumptions that require CPA review before tax return preparation or filing. Generated by the Operating Support Services, LLC application (ossadvisorygroup.com).',
  ] as const,
};

export interface CpaReportMetadata {
  moduleName?: string;
  sourceMode?: string;
  forecastMethodSummary?: string;
  forecastAssumptions?: string;
  elapsedDays?: number;
  remainingDays?: number;
}

export type CpaPackageMetaOptions = CpaReportMetadata;

export interface CpaPackageAssumptionItem {
  label: string;
  value: string;
}

export interface CpaPackageMetadata {
  preparedBy: string;
  website: string;
  moduleName: string;
  sourceMode: string;
  forecastMethodSummary: string;
  asOfDate: string;
  asOfDateDisplay: string;
  projectionYear: number;
  yearEndDisplay: string;
  elapsedDays: number;
  remainingDays: number;
  totalYearDays: number;
  activeAssumptions: CpaPackageAssumptionItem[];
  activeAssumptionsSummary: string;
  disclaimerHeadline: string;
  disclaimerBody: string;
  csvCommentLines: string[];
}

function fmtUsdExact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function genericizeAccountingLabel(raw?: string): string {
  if (!raw?.trim()) return '';
  return raw
    .replace(/\bQuickBooks\s+Online\b/gi, 'Accounting')
    .replace(/\bQuickBooks\b/gi, 'Accounting')
    .replace(/\bQBO\b/gi, 'Accounting')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function computeCalendarWindow(
  asOfDateRaw: string,
  projectionYear: number
): {
  asOfDateDisplay: string;
  elapsedDays: number;
  remainingDays: number;
  totalYearDays: number;
} {
  const yearStartUtc = Date.UTC(projectionYear, 0, 1);
  const yearEndUtc = Date.UTC(projectionYear, 11, 31);
  const totalYearDays = Math.round((yearEndUtc - yearStartUtc) / 86_400_000) + 1;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOfDateRaw.trim());
  let asOfUtc: number | null = null;
  let asOfDateDisplay = asOfDateRaw;

  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    asOfUtc = Date.UTC(y, m - 1, d);
    asOfDateDisplay = `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  } else {
    const parsed = new Date(asOfDateRaw);
    if (!Number.isNaN(parsed.getTime())) {
      asOfUtc = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
      asOfDateDisplay = `${String(parsed.getUTCMonth() + 1).padStart(2, '0')}/${String(
        parsed.getUTCDate()
      ).padStart(2, '0')}/${parsed.getUTCFullYear()}`;
    }
  }

  if (asOfUtc === null) {
    return {
      asOfDateDisplay,
      elapsedDays: 0,
      remainingDays: 0,
      totalYearDays,
    };
  }

  const remainingDays = Math.max(0, Math.round((yearEndUtc - asOfUtc) / 86_400_000));
  const elapsedDays = Math.max(0, Math.min(totalYearDays, totalYearDays - remainingDays));
  return {
    asOfDateDisplay,
    elapsedDays,
    remainingDays,
    totalYearDays,
  };
}

export function buildCpaPackageMetadata(
  setup: SetupConfig,
  pnlState: PnlBalanceSheetState,
  comp: ComputedPnlBalanceSheet,
  entityName: string,
  entityEin: string,
  options?: CpaReportMetadata
): CpaPackageMetadata {
  const { primaryName, spouseName } = getPersonNames(setup);
  const bs = pnlState.balance_sheet;
  const year = pnlState.projection_year;
  const calendar = computeCalendarWindow(bs.as_of_date, year);
  const asOfDateDisplay = calendar.asOfDateDisplay;
  const totalYearDays = calendar.totalYearDays;
  const remainingDays =
    typeof options?.remainingDays === 'number' && Number.isFinite(options.remainingDays)
      ? Math.max(0, Math.round(options.remainingDays))
      : calendar.remainingDays;
  const elapsedDays =
    typeof options?.elapsedDays === 'number' && Number.isFinite(options.elapsedDays)
      ? Math.max(0, Math.round(options.elapsedDays))
      : calendar.elapsedDays;

  const preparedBy = 'Prepared by Operating Support Services, LLC';
  const website = 'ossadvisorygroup.com';
  const moduleName =
    genericizeAccountingLabel(options?.moduleName) ||
    'Rolling Tax Planner / Transaction Cadence Forecaster';
  const sourceMode =
    genericizeAccountingLabel(options?.sourceMode) ||
    'Imported Accounting or Bookkeeping Records';
  const forecastMethodSummary =
    genericizeAccountingLabel(options?.forecastMethodSummary) ||
    genericizeAccountingLabel(options?.forecastAssumptions) ||
    `Automated cadence or smoothing rules & user assumptions (${remainingDays} remaining days)`;
  const yearEndDisplay = `12/31/${year}`;

  const activeAssumptions: CpaPackageAssumptionItem[] = [
    {
      label: 'Forecast Window',
      value: `${remainingDays} remaining days through ${yearEndDisplay} (${elapsedDays} of ${totalYearDays} YTD days elapsed as of ${asOfDateDisplay})`,
    },
    {
      label: 'Accounting Records',
      value: `${sourceMode} (cutoff ${asOfDateDisplay})`,
    },
    {
      label: 'Projection Methods',
      value: forecastMethodSummary,
    },
    {
      label: 'Retirement & Accruals',
      value: `DBP ${fmtUsdExact(comp.lines.dbp_contribution.projected)} · 401(k) ${fmtUsdExact(
        comp.lines.employer_401k.projected
      )} · SEHI ${fmtUsdExact(comp.lines.sehi_medicare.projected)} · YE Retirement Payable ${fmtUsdExact(
        bs.pension_payable_ye
      )}`,
    },
    {
      label: 'Tax & Basis Rules',
      value: `50/50 Sch M-1 meals split · Sch K Interest excl. from Ln 22 · Beg. Basis ${fmtUsdExact(
        comp.beginningStockBasis
      )} (${bs.beginning_stock_basis_override !== null ? 'Custom Override' : 'Prior-Year Rollover'}) · Remaining Draws ${fmtUsdExact(
        bs.member_draws_remaining
      )}`,
    },
    {
      label: 'Apportionment & Cash',
      value: `CA ${comp.caPct.projected}% / AZ ${comp.azPct.projected}% · Ownership ${primaryName} ${comp.billSharePct}% / ${spouseName} ${comp.debraSharePct}% · YE Cash ${
        bs.operating_cash_ye_override !== null ? 'Manual Override' : 'Auto-Projected'
      } (${fmtUsdExact(comp.projectedCashYe)})`,
    },
  ];

  const activeAssumptionsSummary = activeAssumptions
    .map((item) => `${item.label}: ${item.value}`)
    .join(' | ');

  const disclaimerHeadline = 'PRELIMINARY TAX-PLANNING PROJECTION — FOR REVIEW WITH YOUR CPA';
  const disclaimerBody =
    'This report is a preliminary tax-planning projection for review with your CPA and does not replace professional CPA, tax, legal, or accounting advice. Year-to-date figures reflect imported accounting or bookkeeping records as of the report cutoff date, while remaining-year projections use automated cadence or smoothing rules and user assumptions that require CPA review before tax return preparation or filing. Generated by the Operating Support Services, LLC application (ossadvisorygroup.com).';

  const csvCommentLines = [
    `# ${preparedBy} (${website})`,
    `# Module: ${moduleName}`,
    `# Entity: ${entityName} (EIN ${entityEin}) | Tax Year: ${year}`,
    `# Report Cutoff / As-Of Date: ${asOfDateDisplay} (${bs.as_of_date}) | Remaining Days Through ${yearEndDisplay}: ${remainingDays} days (${elapsedDays} of ${totalYearDays} YTD days elapsed)`,
    `# Accounting Records Source: ${sourceMode}`,
    `# Active Forecast Assumptions: ${activeAssumptionsSummary}`,
    `# Purpose: Preliminary tax-planning projection for review with your CPA (does not replace professional CPA, tax, legal, or accounting advice).`,
    `# Disclaimer: ${disclaimerBody}`,
  ];

  return {
    preparedBy,
    website,
    moduleName,
    sourceMode,
    forecastMethodSummary,
    asOfDate: bs.as_of_date,
    asOfDateDisplay,
    projectionYear: year,
    yearEndDisplay,
    elapsedDays,
    remainingDays,
    totalYearDays,
    activeAssumptions,
    activeAssumptionsSummary,
    disclaimerHeadline,
    disclaimerBody,
    csvCommentLines,
  };
}

export function buildCpaProjectionCsv(
  setup: SetupConfig,
  pnlState: PnlBalanceSheetState,
  comp: ComputedPnlBalanceSheet,
  entityName: string,
  entityEin: string,
  options?: CpaReportMetadata
): string {
  const { primaryName, spouseName } = getPersonNames(setup);
  const meta = buildCpaPackageMetadata(setup, pnlState, comp, entityName, entityEin, options);

  const rows: (string | number)[][] = [
    ...meta.csvCommentLines.map((line) => [line]),
    [],
    ['CPA YEAR-END TAX PROJECTION PACKAGE'],
    ['Prepared By', `${meta.preparedBy} (${meta.website})`],
    ['Module', meta.moduleName],
    ['Entity', entityName],
    ['EIN', entityEin],
    ['Projection Tax Year', pnlState.projection_year],
    ['Report Cutoff / As-Of Date', `${meta.asOfDateDisplay} (${meta.asOfDate})`],
    [
      `Remaining Days Through ${meta.yearEndDisplay}`,
      `${meta.remainingDays} days (${meta.elapsedDays} of ${meta.totalYearDays} YTD days elapsed)`,
    ],
    ['Accounting Records Source', meta.sourceMode],
    [
      'Ownership Split',
      `${primaryName} ${comp.billSharePct}% / ${spouseName} ${comp.debraSharePct}%`,
    ],
    [
      'Projected State Apportionment',
      `CA ${comp.caPct.projected}% / AZ ${comp.azPct.projected}%`,
    ],
    ['Active Forecast Assumptions', meta.activeAssumptionsSummary],
    ['CPA Review Disclaimer', `${meta.disclaimerHeadline} — ${meta.disclaimerBody}`],
    [],
    [
      'PROFIT & LOSS PROJECTION (FORM 1120-S)',
      '1120-S Ref',
      'YTD Actuals',
      'Remaining Forecast',
      'Projected Full Year',
      'Prior-Year Filed Actuals',
      'YoY Change ($)',
    ],
  ];

  const pushTriple = (label: string, ref: string, t: ComputedColumnTriple) => {
    rows.push([
      label,
      ref,
      t.ytd.toFixed(2),
      t.remaining.toFixed(2),
      t.projected.toFixed(2),
      t.filed2025.toFixed(2),
      round2(t.projected - t.filed2025).toFixed(2),
    ]);
  };

  for (const section of PNL_SECTIONS) {
    rows.push([section.title.toUpperCase(), '', '', '', '', '', '']);
    const sectionItems = PNL_OPERATING_ITEMS.filter((i) => i.section === section.id);
    for (const item of sectionItems) {
      pushTriple(getPnlLineLabel(item, setup), item.form1120sRef, comp.lines[item.id]);
      if (item.id === 'meals_gross') {
        pushTriple(
          '  -> 50% Deductible Meals (Included in 1120-S Expenses)',
          'Line 19 (50%)',
          comp.mealsDeductible50
        );
        pushTriple(
          '  -> 50% Nondeductible Meals (Schedule M-1 / Basis)',
          'Sch M-1 / K-16c',
          comp.mealsNondeductible50
        );
      }
    }
    if (section.id === 'revenue') {
      pushTriple('Total Gross Receipts', 'Line 1a Total', comp.totalRevenue);
    } else if (section.id === 'compensation') {
      pushTriple('Total W-2 Compensation', 'Lines 7 + 8', comp.totalCompensation);
    } else if (section.id === 'retirement') {
      pushTriple('Total Retirement & Benefits', 'Lines 17 + 18', comp.totalRetirementBenefits);
    } else if (section.id === 'operating_expenses') {
      pushTriple(
        'Total Operating Expenses (Excl. W-2 & Retirement · Tax Deductible)',
        'Lines 11-19',
        comp.totalOperatingExpensesDeductible
      );
    }
  }

  rows.push([]);
  pushTriple(
    'PROJECTED ORDINARY BUSINESS INCOME (FORM 1120-S LINE 22)',
    'Line 22 / K-1 Box 1',
    comp.ordinaryBusinessIncome
  );
  pushTriple(
    'Schedule K Interest Income (Portfolio · Excl. from Line 22, Incl. in Basis)',
    'Sch K Line 4',
    comp.scheduleKInterest
  );
  pushTriple(
    'Book Net Income (Line 22 + Sch K Interest - 50% Nondeductible Meals)',
    'Sch M-1 Line 1',
    comp.bookNetIncome
  );

  const bs = pnlState.balance_sheet;
  rows.push([]);
  rows.push([
    'BALANCE SHEET & SHAREHOLDER BASIS PROJECTION (SCHEDULE L & FORM 7203)',
    `Beginning of Year (1/1/${pnlState.projection_year})`,
    `Current YTD (${bs.as_of_date})`,
    `Projected Year-End (12/31/${pnlState.projection_year})`,
  ]);
  rows.push([
    'Operating Cash',
    bs.operating_cash_beg.toFixed(2),
    bs.operating_cash_ytd.toFixed(2),
    comp.projectedCashYe.toFixed(2),
  ]);
  rows.push([
    'Pension / Retirement Expense Payable',
    bs.pension_payable_beg.toFixed(2),
    bs.pension_payable_ytd.toFixed(2),
    bs.pension_payable_ye.toFixed(2),
  ]);
  rows.push([
    'Credit Card / Accounts Payable',
    bs.cc_ap_beg.toFixed(2),
    bs.cc_ap_ytd.toFixed(2),
    bs.cc_ap_ye.toFixed(2),
  ]);
  rows.push([
    'Net Cash After Short-Term Liabilities',
    comp.netCashPositionBeg.toFixed(2),
    comp.netCashPositionYtd.toFixed(2),
    comp.netCashPositionYe.toFixed(2),
  ]);

  const billPct = comp.billSharePct / 100;
  const billBeg = round2(comp.beginningStockBasis * billPct);
  const debraBeg = round2(comp.beginningStockBasis - billBeg);
  const posInc = Math.max(0, comp.ordinaryBusinessIncome.projected);
  const billInc = round2(posInc * billPct);
  const debraInc = round2(posInc - billInc);
  const posInt = Math.max(0, comp.scheduleKInterest.projected);
  const billInt = round2(posInt * billPct);
  const debraInt = round2(posInt - billInt);
  const billCap = round2(comp.projectedCapitalContributionsTotal * billPct);
  const debraCap = round2(comp.projectedCapitalContributionsTotal - billCap);
  const billDraws = round2(comp.projectedDrawsTotal * billPct);
  const debraDraws = round2(comp.projectedDrawsTotal - billDraws);
  const billNonded = round2(comp.mealsNondeductible50.projected * billPct);
  const debraNonded = round2(comp.mealsNondeductible50.projected - billNonded);

  rows.push([]);
  rows.push([
    'FORM 7203 SHAREHOLDER STOCK BASIS PROJECTION',
    'Combined (100%)',
    `${primaryName} (${comp.billSharePct}%)`,
    `${spouseName} (${comp.debraSharePct}%)`,
  ]);
  rows.push([
    `Beginning Stock Basis (1/1/${pnlState.projection_year})`,
    comp.beginningStockBasis.toFixed(2),
    billBeg.toFixed(2),
    debraBeg.toFixed(2),
  ]);
  rows.push([
    '+ Projected Ordinary Business Income (K-1 Box 1)',
    posInc.toFixed(2),
    billInc.toFixed(2),
    debraInc.toFixed(2),
  ]);
  rows.push([
    '+ Schedule K Interest Income (Line 4)',
    posInt.toFixed(2),
    billInt.toFixed(2),
    debraInt.toFixed(2),
  ]);
  rows.push([
    '+ Capital Contributions (YTD + Remaining)',
    comp.projectedCapitalContributionsTotal.toFixed(2),
    billCap.toFixed(2),
    debraCap.toFixed(2),
  ]);
  rows.push(['= Basis Available Before Distributions', comp.basisAvailableBeforeDraws.toFixed(2), '', '']);
  rows.push([
    '- Member Draws / Distributions (YTD + Planned Remaining)',
    (-comp.projectedDrawsTotal).toFixed(2),
    (-billDraws).toFixed(2),
    (-debraDraws).toFixed(2),
  ]);
  rows.push([
    '- Nondeductible Expenses (50% Meals Sch M-1)',
    (-comp.mealsNondeductible50.projected).toFixed(2),
    (-billNonded).toFixed(2),
    (-debraNonded).toFixed(2),
  ]);
  rows.push([
    `= Projected Ending Stock Basis (12/31/${pnlState.projection_year})`,
    comp.projectedEndingStockBasis.toFixed(2),
    comp.billProjectedBasisEnding.toFixed(2),
    comp.debraProjectedBasisEnding.toFixed(2),
  ]);
  rows.push([
    'Form 8949 Excess Distribution Capital Gain',
    comp.projectedExcessDistributionGain.toFixed(2),
    comp.billExcessGain.toFixed(2),
    comp.debraExcessGain.toFixed(2),
  ]);
  rows.push([]);
  rows.push(['PACKAGE BRANDING & CPA DISCLAIMER']);
  rows.push(['Prepared By', `${meta.preparedBy} (${meta.website})`]);
  rows.push(['Module', meta.moduleName]);
  rows.push([
    'As-Of Date & Remaining Days',
    `${meta.asOfDateDisplay} (${meta.asOfDate}) | ${meta.remainingDays} remaining days through ${meta.yearEndDisplay}`,
  ]);
  rows.push(['Active Forecast Assumptions', meta.activeAssumptionsSummary]);
  rows.push(['Disclaimer', meta.disclaimerBody]);

  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
