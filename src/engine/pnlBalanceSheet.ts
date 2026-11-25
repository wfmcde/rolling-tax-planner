import type {
  BalanceSheetProjectionInputs,
  ComputedTaxYear,
  PnlBalanceSheetState,
  PnlLineAmounts,
  PnlLineId,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import type { EvaluatedPlanningGoal } from './planningGoals';
import { buildCpaHorizonSummary } from './cpaHorizonSummary';
import { getPersonNames } from './scheduleCatalog';
import { getSetupBusinessIdentity, getSetupStates, getStateFullName } from '../utils/setupHelpers';
import {
  buildTestPersonaPnl,
  DEFAULT_PROFILE_SEED,
  isDefaultSeedSetup,
  SAMPLE_TEST_PERSONA_QBO_BS,
  SAMPLE_TEST_PERSONA_QBO_PNL,
} from '../data/profiles';

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
  filed2025: 0,
  note: 'Excluded from Line 22 Ordinary Income · Included in Form 7203 stock basis',
};

/**
 * Canonical Form 1120-S P&L catalog. Prior-year filed comparison figures are derived
 * dynamically from the active household's Year 1 TaxYearRecord rather than hardcoded here.
 */
export const PNL_LINE_ITEMS: PnlLineMeta[] = [
  {
    id: 'ca_revenue',
    section: 'revenue',
    label: 'Primary State S-Corp Revenue',
    getLabel: (s) => {
      const { primaryStateName, hasPrimaryState } = getSetupStates(s);
      return hasPrimaryState ? `${primaryStateName} S-Corp Revenue` : 'Primary S-Corp Revenue';
    },
    form1120sRef: 'Line 1a',
    filed2025: 0,
    note: 'Primary-state sourced gross receipts',
  },
  {
    id: 'az_revenue',
    section: 'revenue',
    label: 'Secondary State S-Corp Revenue',
    getLabel: (s) => {
      const { secondaryStateName, hasSecondaryState } = getSetupStates(s);
      return hasSecondaryState
        ? `${secondaryStateName} S-Corp Revenue`
        : 'Secondary / Other State Revenue';
    },
    form1120sRef: 'Line 1a',
    filed2025: 0,
    note: 'Secondary-state sourced gross receipts',
  },
  {
    id: 'bill_officer_w2',
    section: 'compensation',
    label: 'Primary Officer W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).primaryName} Officer W-2 Compensation`,
    form1120sRef: 'Line 7',
    filed2025: 0,
    note: 'Officer salary (Form 1120-S Line 7)',
  },
  {
    id: 'debra_salaries_wages',
    section: 'compensation',
    label: 'Spouse Salaries & Wages',
    getLabel: (s) => `${getPersonNames(s).spouseName} Salaries & Wages`,
    form1120sRef: 'Line 8',
    filed2025: 0,
    note: 'Salaries & wages (Form 1120-S Line 8)',
  },
  {
    id: 'dbp_contribution',
    section: 'retirement',
    label: 'Defined Benefit Plan (DBP) Contribution',
    form1120sRef: 'Line 17',
    filed2025: 0,
  },
  {
    id: 'employer_401k',
    section: 'retirement',
    label: 'Employer 401(k) Profit Sharing / Match',
    form1120sRef: 'Line 17',
    filed2025: 0,
  },
  {
    id: 'sehi_medicare',
    section: 'retirement',
    label: 'SEHI Medicare Premiums',
    form1120sRef: 'Line 18 / Sch 1 Ln 17',
    filed2025: 0,
    note: 'QBO: >2% Shareholder Health Insurance premiums',
  },
  {
    id: 'rents',
    section: 'operating_expenses',
    label: 'Rents',
    form1120sRef: 'Line 11',
    filed2025: 0,
  },
  {
    id: 'payroll_taxes',
    section: 'operating_expenses',
    label: 'Taxes & Licenses — Payroll Taxes',
    form1120sRef: 'Line 12',
    filed2025: 0,
    note: 'Employer federal & state payroll taxes',
  },
  {
    id: 'ca_ftb_tax',
    section: 'operating_expenses',
    label: 'Taxes & Licenses — State Entity / Franchise Tax',
    getLabel: (s) => {
      const { primaryStateCode } = getSetupStates(s);
      return primaryStateCode
        ? `Taxes & Licenses — ${primaryStateCode} Entity / State Tax`
        : 'Taxes & Licenses — State Entity / Franchise Tax';
    },
    form1120sRef: 'Line 12',
    filed2025: 0,
    note: 'State business taxes, franchise taxes, and prior-year refunds/credits',
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
    filed2025: 0,
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
    filed2025: 0,
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

export interface HorizonRetirementTargets {
  dbpAnnual: number;
  employer401kAnnual: number;
}

/**
 * Extracts annual Form 1120-S Line 17 DBP and Employer 401(k) retirement targets
 * directly from the active projected tax year's Horizon/Setup computation.
 * Completely decoupled from Schedule L 12/31 Pension Expense Payable.
 */
export function resolveHorizonRetirementTargets(
  yearProjectedComputed?: ComputedTaxYear,
  setup?: SetupConfig
): HorizonRetirementTargets {
  if (!yearProjectedComputed) {
    return { dbpAnnual: 0, employer401kAnnual: 0 };
  }
  const hasDbp = setup ? setup.has_dbp !== false : true;
  const has401k = setup ? setup.has_401k_or_ira !== false : true;
  const rawDbp = hasDbp
    ? Math.max(0, yearProjectedComputed.dbp_in.dbp_actual_contribution ?? 0)
    : 0;
  const raw401k = has401k
    ? Math.max(0, yearProjectedComputed.form_1040_out.employer_401k_total ?? 0)
    : 0;
  return {
    dbpAnnual: round2(rawDbp),
    employer401kAnnual: round2(raw401k),
  };
}

/**
 * Computes Remaining Forecast for a Form 1120-S Line 17 retirement deduction from
 * the active Horizon/Setup annual plan minus any YTD actuals already posted.
 */
export function computeRemainingRetirementFromHorizon(
  plannedAnnual: number,
  ytdActual: number
): number {
  return round2(Math.max(0, Math.max(0, plannedAnnual) - Math.max(0, ytdActual)));
}

/**
 * Creates an initial P&L & Balance Sheet projection state for the active household.
 * - Default seed profile ("My Profile"): loads isolated DEFAULT_PROFILE_SEED 2026 baseline.
 * - Synthetic Test Persona: loads isolated TX Test Persona baseline.
 * - Blank User / Custom Household: derives neutral $0-YTD projection from the active year record.
 */
export function createInitialPnlBalanceSheetState(
  year2026?: TaxYearRecord,
  year2025EndingBasis = 0,
  setup?: SetupConfig | null
): PnlBalanceSheetState {
  const projectionYear = year2026?.tax_year ?? setup?.current_tax_year ?? 2026;

  if (setup?.workspace_profile_kind === 'test_persona') {
    const personaPnl = buildTestPersonaPnl(projectionYear);
    return {
      ...personaPnl,
      balance_sheet: {
        ...personaPnl.balance_sheet,
        beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
      },
    };
  }

  const initialDbpRemaining = round2(
    Math.max(0, year2026?.dbp_and_retirement?.dbp_actual_contribution ?? 0)
  );
  const initialEmployer401kRemaining = year2026
    ? Math.round(
        Math.max(
          0,
          year2026.dbp_and_retirement?.qualified_plan_contribution > 0
            ? year2026.dbp_and_retirement.qualified_plan_contribution
            : ((year2026.scorp_1120s.bill_w2_wages ?? 0) +
                (year2026.scorp_1120s.debra_w2_wages ?? 0)) *
                (setup?.post_dbp_profit_sharing_rate ?? 0.06)
        )
      )
    : 0;

  if (isDefaultSeedSetup(setup)) {
    const seedPnl = DEFAULT_PROFILE_SEED.default_pnl_2026;
    const seed2026 = DEFAULT_PROFILE_SEED.forecast_2026_2030_inputs[2026];
    const billW2Ytd = seedPnl.bill_w2_ytd;
    const debraW2Ytd = seedPnl.debra_w2_ytd;
    const billW2Remaining = round2(Math.max(0, (seed2026?.bill_w2 ?? billW2Ytd) - billW2Ytd));
    const debraW2Remaining = round2(Math.max(0, (seed2026?.debra_w2 ?? debraW2Ytd) - debraW2Ytd));

    const fixed = seedPnl.pnl_fixed_lines;
    const getFixed = (id: PnlLineId): PnlLineAmounts =>
      fixed[id] ? { ytd: fixed[id]!.ytd, remaining: fixed[id]!.remaining } : { ytd: 0, remaining: 0 };

    const pnl: Record<PnlLineId, PnlLineAmounts> = {
      ca_revenue: getFixed('ca_revenue'),
      az_revenue: getFixed('az_revenue'),
      bill_officer_w2: { ytd: billW2Ytd, remaining: billW2Remaining },
      debra_salaries_wages: { ytd: debraW2Ytd, remaining: debraW2Remaining },
      dbp_contribution: { ytd: 0, remaining: initialDbpRemaining },
      employer_401k: { ytd: 0, remaining: initialEmployer401kRemaining },
      sehi_medicare: getFixed('sehi_medicare'),
      rents: getFixed('rents'),
      payroll_taxes: getFixed('payroll_taxes'),
      ca_ftb_tax: getFixed('ca_ftb_tax'),
      professional_fees: getFixed('professional_fees'),
      subscriptions_software: getFixed('subscriptions_software'),
      telephone_internet: getFixed('telephone_internet'),
      travel: getFixed('travel'),
      meals_gross: getFixed('meals_gross'),
      office_expense: getFixed('office_expense'),
      insurance: getFixed('insurance'),
      utilities: getFixed('utilities'),
      bank_payroll_fees: getFixed('bank_payroll_fees'),
      other_deductions: getFixed('other_deductions'),
      schedule_k_interest: getFixed('schedule_k_interest'),
    };

    const balance_sheet: BalanceSheetProjectionInputs = {
      ...seedPnl.balance_sheet,
      pension_payable_ye: DEFAULT_PROFILE_SEED.default_pension_payable_ye,
      beginning_stock_basis_override: year2025EndingBasis,
    };

    return {
      projection_year: projectionYear,
      pnl,
      balance_sheet,
    };
  }

  // Neutral household P&L & Balance Sheet derived purely from the active profile's Horizon record
  const pnl = {} as Record<PnlLineId, PnlLineAmounts>;
  for (const item of PNL_LINE_ITEMS) {
    pnl[item.id] = { ytd: 0, remaining: 0 };
  }
  if (year2026) {
    pnl.ca_revenue = { ytd: 0, remaining: round2(Math.max(0, year2026.scorp_1120s.ca_revenue ?? 0)) };
    pnl.az_revenue = { ytd: 0, remaining: round2(Math.max(0, year2026.scorp_1120s.az_revenue ?? 0)) };
    pnl.bill_officer_w2 = { ytd: 0, remaining: round2(Math.max(0, year2026.scorp_1120s.bill_w2_wages ?? 0)) };
    pnl.debra_salaries_wages = { ytd: 0, remaining: round2(Math.max(0, year2026.scorp_1120s.debra_w2_wages ?? 0)) };
    pnl.dbp_contribution = { ytd: 0, remaining: initialDbpRemaining };
    pnl.employer_401k = { ytd: 0, remaining: initialEmployer401kRemaining };
    pnl.sehi_medicare = {
      ytd: 0,
      remaining: round2(Math.max(0, year2026.form_1040.health_insurance_premiums ?? 0)),
    };
    pnl.other_deductions = {
      ytd: 0,
      remaining: round2(Math.max(0, year2026.scorp_1120s.operating_expenses ?? 0)),
    };
    pnl.schedule_k_interest = {
      ytd: 0,
      remaining: round2(Math.max(0, year2026.scorp_1120s.schedule_k_interest_income ?? 0)),
    };
  }

  return {
    projection_year: projectionYear,
    pnl,
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
      member_draws_remaining: round2(Math.max(0, year2026?.scorp_1120s.scorp_distributions_total ?? 0)),
      capital_contributions_ytd: 0,
      capital_contributions_remaining: round2(Math.max(0, year2026?.scorp_1120s.capital_contributions ?? 0)),
      beginning_stock_basis_override: year2025EndingBasis > 0 ? year2025EndingBasis : null,
    },
  };
}

export function normalizePnlBalanceSheetState(
  raw: PnlBalanceSheetState | undefined,
  year2026?: TaxYearRecord,
  setup?: SetupConfig | null
): PnlBalanceSheetState {
  const defaults = createInitialPnlBalanceSheetState(year2026, 0, setup);
  if (!raw || !raw.pnl || !raw.balance_sheet) return defaults;

  const isDefaultProfile = isDefaultSeedSetup(setup);

  // Seamlessly upgrade earlier placeholder seed strictly for saved default-profile records
  if (isDefaultProfile) {
    const legacyPl = DEFAULT_PROFILE_SEED.default_pnl_2026.legacy_2026_09_30_placeholder;
    const isLegacyPlaceholderSeed =
      raw.balance_sheet.as_of_date === legacyPl.as_of_date &&
      raw.balance_sheet.operating_cash_ytd === legacyPl.operating_cash_ytd &&
      raw.balance_sheet.member_draws_ytd === legacyPl.member_draws_ytd &&
      raw.pnl.ca_revenue?.ytd === legacyPl.ca_revenue_ytd;
    if (isLegacyPlaceholderSeed) {
      return defaults;
    }
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

  // One-time migration for saved default-profile 2026 P&L records whose W-2 remaining still baked SEHI into cash W-2
  if (isDefaultProfile) {
    const legacyW2 = DEFAULT_PROFILE_SEED.legacy_2026_w2_with_sehi;
    const seed2026 = DEFAULT_PROFILE_SEED.forecast_2026_2030_inputs[2026];
    if (
      seed2026 &&
      Math.abs(pnl.bill_officer_w2.ytd + pnl.bill_officer_w2.remaining - legacyW2.bill_w2) < 0.05 &&
      Math.abs(pnl.debra_salaries_wages.ytd + pnl.debra_salaries_wages.remaining - legacyW2.debra_w2) <
        0.05 &&
      pnl.sehi_medicare.ytd > 0
    ) {
      pnl.bill_officer_w2 = {
        ytd: pnl.bill_officer_w2.ytd,
        remaining: round2(Math.max(0, seed2026.bill_w2 - pnl.bill_officer_w2.ytd)),
      };
      pnl.debra_salaries_wages = {
        ytd: pnl.debra_salaries_wages.ytd,
        remaining: round2(Math.max(0, seed2026.debra_w2 - pnl.debra_salaries_wages.ytd)),
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
    pension_payable_ye:
      bsRaw.pension_payable_ye === DEFAULT_PROFILE_SEED.legacy_2026_pension_payable_ye
        ? DEFAULT_PROFILE_SEED.default_pension_payable_ye
        : numOr(bsRaw.pension_payable_ye, defaults.balance_sheet.pension_payable_ye),
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

  const rawRetManual = raw.retirement_line17_manual_overrides;
  const retirement_line17_manual_overrides =
    rawRetManual && (rawRetManual.dbp_contribution || rawRetManual.employer_401k)
      ? {
          ...(rawRetManual.dbp_contribution ? { dbp_contribution: true } : {}),
          ...(rawRetManual.employer_401k ? { employer_401k: true } : {}),
        }
      : undefined;

  return {
    projection_year:
      typeof raw.projection_year === 'number' && Number.isFinite(raw.projection_year)
        ? raw.projection_year
        : 2026,
    pnl,
    balance_sheet,
    ...(retirement_line17_manual_overrides ? { retirement_line17_manual_overrides } : {}),
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
  totalOperatingExpensesDeductible: ComputedColumnTriple; // Excl. W-2 & Retirement, includes Payroll Taxes & 50% deductible meals
  totalOperatingExpensesExclPayroll: ComputedColumnTriple; // Excl. W-2, Employer Payroll Taxes, SEHI & Retirement (matches Horizon/1120-S OpEx)
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
  subsequentYearRetirementAddback: number;
  autoProjectedCashYe: number;
  projectedCashYe: number;
  netCashPositionBeg: number;
  netCashPositionYtd: number;
  netCashPositionYe: number;
}

export interface CalculatePnlBalanceSheetOptions {
  /**
   * When true, `state.pnl.dbp_contribution.remaining` and `state.pnl.employer_401k.remaining`
   * have already been resolved by the caller (e.g., Cadence Forecaster merging Horizon targets
   * with explicit inline overrides) and should be used as-is.
   */
  respectStateRetirementRemaining?: boolean;
}

export function calculatePnlBalanceSheet(
  state: PnlBalanceSheetState,
  year2025Computed?: ComputedTaxYear,
  yearProjectedComputed?: ComputedTaxYear,
  setup?: SetupConfig,
  options?: CalculatePnlBalanceSheetOptions
): ComputedPnlBalanceSheet {
  const filedByLine = (id: PnlLineId): number => {
    if (!year2025Computed) return 0;
    const sc = year2025Computed.scorp_in;
    const dbp = year2025Computed.dbp_in;
    const f1040Out = year2025Computed.form_1040_out;
    const nondeductibleMeals = sc.schedule_k_nondeductible_expenses ?? 0;
    switch (id) {
      case 'ca_revenue':
        return round2(sc.ca_revenue ?? 0);
      case 'az_revenue':
        return round2(sc.az_revenue ?? 0);
      case 'bill_officer_w2':
        return round2(
          sc.use_detailed_1120s_deductions
            ? (sc.compensation_of_officers ?? sc.bill_w2_wages ?? 0)
            : (sc.bill_w2_wages ?? 0)
        );
      case 'debra_salaries_wages':
        return round2(
          sc.use_detailed_1120s_deductions
            ? (sc.salaries_and_wages ?? sc.debra_w2_wages ?? 0)
            : (sc.debra_w2_wages ?? 0)
        );
      case 'dbp_contribution':
        return round2(dbp.dbp_actual_contribution ?? 0);
      case 'employer_401k':
        if (sc.use_detailed_1120s_deductions && sc.pension_profit_sharing_input !== undefined) {
          return round2(Math.max(0, sc.pension_profit_sharing_input - (dbp.dbp_actual_contribution ?? 0)));
        }
        return round2(f1040Out.employer_401k_total ?? 0);
      case 'sehi_medicare':
        // When detailed 1120-S lines are used (e.g., filed return where >2% SEHI is folded into
        // W-2 officer/employee compensation Lines 7-8), do not double-deduct SEHI separately.
        // Otherwise match taxEngine.ts scorpSehiDeduction identically.
        return sc.use_detailed_1120s_deductions
          ? 0
          : round2(f1040Out.sehi_medicare_premiums_effective ?? 0);
      case 'rents':
        return round2(sc.rents ?? 0);
      case 'payroll_taxes':
        return round2(sc.payroll_taxes_input ?? year2025Computed.scorp_out.employer_payroll_taxes ?? 0);
      case 'ca_ftb_tax':
        return round2(
          (sc.ftb_state_taxes_input ?? 0) +
            (sc.use_detailed_1120s_deductions
              ? 0
              : (year2025Computed.scorp_out.pte_tax_paid_total ?? 0))
        );
      case 'meals_gross':
        return round2(nondeductibleMeals * 2);
      case 'other_deductions': {
        if (sc.use_detailed_1120s_deductions) {
          return round2(Math.max(0, (sc.other_deductions ?? 0) - nondeductibleMeals));
        }
        const effectiveOpEx =
          year2025Computed.scorp_out.effective_operating_expenses ?? sc.operating_expenses ?? 0;
        const itemized =
          (sc.rents ?? 0) +
          (sc.ftb_state_taxes_input ?? 0) +
          nondeductibleMeals;
        return round2(Math.max(0, effectiveOpEx - itemized));
      }
      case 'schedule_k_interest':
        return round2(sc.schedule_k_interest_income ?? 0);
      default:
        return 0;
    }
  };

  const horizonRetirement = yearProjectedComputed
    ? resolveHorizonRetirementTargets(yearProjectedComputed, setup)
    : null;

  const lines = {} as Record<PnlLineId, ComputedColumnTriple>;
  for (const meta of PNL_LINE_ITEMS) {
    const raw = state.pnl[meta.id] ?? { ytd: 0, remaining: 0 };
    const ytd = round2(raw.ytd);
    let remaining = round2(raw.remaining);

    // Decouple Line 17 retirement deductions from Schedule L 12/31 Pension Payable:
    // source Remaining directly from active Horizon/Setup plan figures minus any YTD actuals posted,
    // unless the caller already resolved overrides or the user manually overrode this line.
    if (horizonRetirement && !options?.respectStateRetirementRemaining) {
      if (
        meta.id === 'dbp_contribution' &&
        !state.retirement_line17_manual_overrides?.dbp_contribution
      ) {
        remaining = computeRemainingRetirementFromHorizon(horizonRetirement.dbpAnnual, ytd);
      } else if (
        meta.id === 'employer_401k' &&
        !state.retirement_line17_manual_overrides?.employer_401k
      ) {
        remaining = computeRemainingRetirementFromHorizon(
          horizonRetirement.employer401kAnnual,
          ytd
        );
      }
    }

    lines[meta.id] = {
      ytd,
      remaining,
      projected: round2(ytd + remaining),
      filed2025: filedByLine(meta.id),
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

  // Non-payroll, non-W2, non-SEHI, non-retirement tax-deductible OpEx (reconciles 1:1 with Horizon & 1120-S OpEx)
  const totalOperatingExpensesExclPayroll: ComputedColumnTriple = {
    ytd: round2(totalOperatingExpensesDeductible.ytd - lines.payroll_taxes.ytd),
    remaining: round2(totalOperatingExpensesDeductible.remaining - lines.payroll_taxes.remaining),
    projected: round2(totalOperatingExpensesDeductible.projected - lines.payroll_taxes.projected),
    filed2025: round2(totalOperatingExpensesDeductible.filed2025 - lines.payroll_taxes.filed2025),
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

  const isMfj = setup ? setup.filing_status === 'married_filing_jointly' : true;
  const billSharePct = isMfj
    ? (year2025Computed?.scorp_in.bill_ownership_pct ?? 50) / 100
    : 1;
  const debraSharePct = isMfj
    ? (year2025Computed?.scorp_in.debra_ownership_pct ?? 50) / 100
    : 0;

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
  // + Subsequent-Year IRC §404(a)(6) Retirement Addback (when 12/31 Pension Payable is $0,
  //   unpaid Remaining Line 17 DBP & Employer 401(k) deductions are funded next year rather than
  //   before 12/31; any YTD retirement cash outflows remain reflected in operating_cash_ytd)
  // + Change in Pension Payable (YE - YTD) + Change in CC/AP (YE - YTD)
  // + Remaining Capital Contributions - Remaining Member Draws
  const remainingRetirementLine17 = round2(
    Math.max(0, lines.dbp_contribution.remaining) + Math.max(0, lines.employer_401k.remaining)
  );
  const subsequentYearRetirementAddback =
    bs.pension_payable_ye === 0 && remainingRetirementLine17 > 0
      ? remainingRetirementLine17
      : 0;
  const pensionAccrualDelta = round2(bs.pension_payable_ye - bs.pension_payable_ytd);
  const ccApDelta = round2(bs.cc_ap_ye - bs.cc_ap_ytd);
  const autoProjectedCashYe = round2(
    bs.operating_cash_ytd +
      bookNetIncome.remaining +
      subsequentYearRetirementAddback +
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
    totalOperatingExpensesExclPayroll,
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
    subsequentYearRetirementAddback,
    autoProjectedCashYe,
    projectedCashYe,
    netCashPositionBeg,
    netCashPositionYtd,
    netCashPositionYe,
  };
}

// ============================================================================
// Accounting / QuickBooks Online (QBO) Paste & CSV Parser
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDynamicNameTokens(setup?: SetupConfig | null): {
  primaryFirst: string;
  spouseFirst: string;
  primaryStateCode: string;
  primaryStateName: string;
  secondaryStateCode: string;
  secondaryStateName: string;
} {
  const primaryFirst = (setup?.primary_name ?? '').trim().split(/\s+/)[0] ?? '';
  const spouseFirst = (setup?.spouse_name ?? '').trim().split(/\s+/)[0] ?? '';
  const primaryStateCode = (setup?.home_state ?? '').trim().toUpperCase();
  const secondaryStateCode = (setup?.secondary_state ?? '').trim().toUpperCase();
  return {
    primaryFirst: primaryFirst.length >= 2 ? primaryFirst : '',
    spouseFirst: spouseFirst.length >= 2 ? spouseFirst : '',
    primaryStateCode,
    primaryStateName: primaryStateCode ? getStateFullName(primaryStateCode) : '',
    secondaryStateCode,
    secondaryStateName: secondaryStateCode ? getStateFullName(secondaryStateCode) : '',
  };
}

function classifyPnlLabel(
  label: string,
  parentSection: string,
  setup?: SetupConfig | null
): { target: QboTargetField; confidence: ParsedQboRow['confidence']; isTravelMealChild?: boolean } {
  const l = label.toLowerCase().trim();
  const p = parentSection.toLowerCase().trim();
  const dyn = getDynamicNameTokens(setup);

  const matchesStateCodeOrName = (code: string, name: string): boolean => {
    if (!code) return false;
    const parts = [escapeRegExp(code)];
    if (name && name.toLowerCase() !== code.toLowerCase()) parts.push(escapeRegExp(name));
    const re = new RegExp(`\\b(${parts.join('|')})\\b`, 'i');
    return re.test(l);
  };

  // 1. State-sourced Revenue accounts (dynamically matched against active profile states)
  const isRevLike = /(rev|sales|income|consult|service|retainer|advisory|fee|billing)/i.test(l) &&
    !/tax|expense|interest|payroll|bank|legal|professional/i.test(l);
  if (isRevLike && dyn.primaryStateCode && matchesStateCodeOrName(dyn.primaryStateCode, dyn.primaryStateName)) {
    return { target: 'ca_revenue', confidence: 'high' };
  }
  if (
    (isRevLike && dyn.secondaryStateCode && matchesStateCodeOrName(dyn.secondaryStateCode, dyn.secondaryStateName)) ||
    /^services income$/i.test(l)
  ) {
    return { target: dyn.secondaryStateCode ? 'az_revenue' : 'ca_revenue', confidence: 'high' };
  }

  // 2. Schedule K Line 4 Interest Income (must be checked BEFORE generic income or interest expense)
  if (/^interest income$/i.test(l) || /interest earned|bank interest/i.test(l)) {
    return { target: 'schedule_k_interest', confidence: 'high' };
  }

  // 3. Compensation: Officer / Spouse salaries (dynamically matched against active household names)
  const primaryRe = dyn.primaryFirst ? new RegExp(`\\b${escapeRegExp(dyn.primaryFirst)}\\b`, 'i') : null;
  const spouseRe = dyn.spouseFirst ? new RegExp(`\\b${escapeRegExp(dyn.spouseFirst)}\\b`, 'i') : null;
  const isPayrollContext = /salary|payroll|wage|comp|officer/i.test(p) || /salary|payroll|wage|comp|officer|w-?2/i.test(l);

  if (
    (primaryRe && isPayrollContext && primaryRe.test(l)) ||
    /officer.*comp|officer.*w-?2/i.test(l)
  ) {
    return { target: 'bill_officer_w2', confidence: 'high' };
  }
  if (
    (spouseRe && isPayrollContext && spouseRe.test(l)) ||
    /salaries\s*(&|and)\s*wages/i.test(l)
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

  // 8. Taxes & Licenses: Payroll Taxes vs State Entity / Franchise Tax
  if (
    /^fed$/i.test(l) ||
    /^medcare$/i.test(l) ||
    /(payroll tax|fica|futa|suta|edd|\bsdi\b|sui[- ]?er)/i.test(l)
  ) {
    return { target: 'payroll_taxes', confidence: 'high' };
  }
  if (
    /^state$/i.test(l) ||
    /(\bftb\b|franchise tax|state.*tax|100s)/i.test(l)
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
  if (/(gross receipt|sales|revenue|income|billings|retainer|consulting)/i.test(l) && !/tax|expense|fee/i.test(l)) {
    return { target: dyn.secondaryStateCode ? 'split_revenue_ca_az' : 'ca_revenue', confidence: 'medium' };
  }

  return { target: 'other_deductions', confidence: 'unmatched' };
}

function classifyBalanceSheetLabel(
  label: string,
  setup?: SetupConfig | null
): { target: QboTargetField; confidence: ParsedQboRow['confidence'] } {
  const l = label.toLowerCase().trim();

  // Operating Cash: Checking / Savings / Operating Cash accounts
  if (
    /(checking|savings|operating.*cash|cash.*bank|bank|money market)/i.test(l) &&
    !/credit card|\bcc\b/i.test(l)
  ) {
    return { target: 'operating_cash_ytd', confidence: 'high' };
  }

  // Pension / Retirement Expense Payable
  if (
    /(defined benefit.*payable|pension.*pay|dbp.*pay|401\(?k\)?.*pay|retirement.*pay|accrued.*pension)/i.test(l)
  ) {
    return { target: 'pension_payable_ytd', confidence: 'high' };
  }

  // Credit Card / Accounts Payable
  const extraCards = isDefaultSeedSetup(setup)
    ? DEFAULT_PROFILE_SEED.default_cadence_2026.extra_card_account_names
    : [];
  const matchesExtraCard = extraCards.some((name) => l.includes(name));
  if (
    matchesExtraCard ||
    /(\bcc\b|credit card|accounts payable|\ba\/p\b|visa|mastercard|amex|capital\s*one|chase ink|payable)/i.test(l)
  ) {
    return { target: 'cc_ap_ytd', confidence: 'high' };
  }

  // Split hierarchical QBO labels (e.g. "Member Equity : Member Draws") so leaf takes precedence
  const leaf = l.split(':').map((p) => p.trim()).filter(Boolean).pop() ?? l;

  // Member Draws / Distributions (check leaf first so "Member Equity : Member Draws" stays in member_draws_ytd)
  if (
    /member\s*draws?|shareholder\s*dist(?:ribution)?s?|owner['’]?s?\s*draws?|owner['’]?s?\s*dist(?:ribution)?s?|\bdistributions\b/i.test(
      leaf
    ) &&
    !/ira|pension|retirement|401\(?k\)?/i.test(leaf)
  ) {
    return { target: 'member_draws_ytd', confidence: 'high' };
  }

  // Explicitly exclude Opening Balance Equity and Retained Earnings from capital contributions
  if (/opening\s*balance\s*equity|retained\s*earnings/i.test(leaf)) {
    return { target: 'ignore', confidence: 'high' };
  }

  // Capital Contributions (including Member Equity, Paid-In Capital, APIC, Owner's Investment)
  if (
    /\bmember\s*equity\b|(?:additional\s+)?paid[-\s]+in\s+capital|shareholder['’]?s?\s+contributions?|member['’]?s?\s+contributions?|owner['’]?s?\s+contributions?|owner['’]?s?\s+investments?|capital\s+contributions?/i.test(
      leaf
    )
  ) {
    return { target: 'capital_contributions_ytd', confidence: 'high' };
  }

  // Fallback check on full path for nested Member Draws sub-accounts
  if (
    /member\s*draws?|shareholder\s*dist(?:ribution)?s?|owner['’]?s?\s*draws?|owner['’]?s?\s*dist(?:ribution)?s?|\bdistributions\b/i.test(
      l
    ) &&
    !/ira|pension|retirement|401\(?k\)?/i.test(l)
  ) {
    return { target: 'member_draws_ytd', confidence: 'high' };
  }

  return { target: 'ignore', confidence: 'unmatched' };
}

export function parseQboReportText(
  rawText: string,
  reportType: 'pnl' | 'balance_sheet',
  setup?: SetupConfig | null
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
      const cls = classifyBalanceSheetLabel(e.label, setup);
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

  const dynTokens = getDynamicNameTokens(setup);
  const memberNameList = [dynTokens.primaryFirst, dynTokens.spouseFirst].filter(Boolean);
  const memberHealthChildRe =
    memberNameList.length > 0
      ? new RegExp(`shareholder health\\s*[-–—:]\\s*(${memberNameList.map(escapeRegExp).join('|')})`, 'i')
      : /shareholder health\s*[-–—:]\s*\w+/i;
  const bareMemberLeafRe =
    memberNameList.length > 0
      ? new RegExp(`^(${memberNameList.map(escapeRegExp).join('|')})$`, 'i')
      : null;

  // P&L pass: detect whether Shareholder Health children or non-meal Travel children exist
  const hasShareholderHealthChildren = entries.some(
    (e) => !e.isTotal && memberHealthChildRe.test(e.label)
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

    const cls = classifyPnlLabel(e.label, e.parent, setup);
    const displayLabel =
      e.parent && bareMemberLeafRe?.test(e.label)
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

export const SAMPLE_QBO_PNL_TEXT = SAMPLE_TEST_PERSONA_QBO_PNL;

export const SAMPLE_QBO_BS_TEXT = SAMPLE_TEST_PERSONA_QBO_BS;

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

export function buildCpaDisclosureMetadata(setup?: SetupConfig | null, fallbackEntityName?: string) {
  const { businessName, businessWebsite, preparedByLabel } = getSetupBusinessIdentity(
    setup,
    fallbackEntityName
  );
  const siteSuffix = businessWebsite ? ` (${businessWebsite})` : '';
  const hasNamedBusiness = Boolean(businessName && businessName !== 'Business Entity');
  const preparedByLine = hasNamedBusiness
    ? `${preparedByLabel}${siteSuffix} - Rolling Tax Planner / Transaction Cadence Forecaster`
    : 'Prepared via Rolling Tax Planner / Transaction Cadence Forecaster';
  const generatedByClause = hasNamedBusiness
    ? `Generated via Rolling Tax Planner for ${businessName}${siteSuffix}.`
    : 'Generated via Rolling Tax Planner.';
  const disclaimer = `This report is a preliminary tax-planning projection for review with your CPA and does not replace professional CPA, tax, legal, or accounting advice. Year-to-date figures reflect imported accounting or bookkeeping records as of the report cutoff date, while remaining-year projections use automated cadence or smoothing rules and user assumptions that require CPA review before tax return preparation or filing. ${generatedByClause}`;

  return {
    preparedBy: preparedByLine,
    purpose:
      'Preliminary tax-planning projection for review with your CPA (does not replace professional CPA, tax, legal, or accounting advice)',
    disclaimer,
    csvHeaderLines: [
      `# ${preparedByLine}`,
      '# Purpose: Preliminary tax-planning projection for review with your CPA (does not replace professional CPA, tax, legal, or accounting advice).',
      `# Disclaimer: ${disclaimer}`,
    ] as const,
  };
}

export interface CpaReportMetadata {
  moduleName?: string;
  sourceMode?: string;
  forecastMethodSummary?: string;
  forecastAssumptions?: string;
  elapsedDays?: number;
  remainingDays?: number;
  activeGoals?: EvaluatedPlanningGoal[];
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
  activeGoals: EvaluatedPlanningGoal[];
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

  const bizIdentity = getSetupBusinessIdentity(setup, entityName, entityEin);
  const setupStates = getSetupStates(setup);
  const state1Code = setupStates.primaryStateCode || 'State 1';
  const state2Code = setupStates.secondaryStateCode || 'State 2';

  const preparedBy = bizIdentity.preparedByLabel;
  const website = bizIdentity.businessWebsite;
  const websiteSuffix = website ? ` (${website})` : '';
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
      )}${
        bs.pension_payable_ye === 0 &&
        comp.lines.dbp_contribution.projected + comp.lines.employer_401k.projected > 0
          ? ' (IRC §404(a)(6) / cash-basis funding)'
          : ''
      }`,
    },
    ...(setup.has_stock_basis !== false
      ? [
          {
            label: 'Tax & Basis Rules',
            value: `50/50 Sch M-1 meals split · Sch K Interest excl. from Ln 22 · Beg. Basis ${fmtUsdExact(
              comp.beginningStockBasis
            )} (${
              bs.beginning_stock_basis_override !== null ? 'Custom Override' : 'Prior-Year Rollover'
            }) · Remaining Draws ${fmtUsdExact(bs.member_draws_remaining)}`,
          },
        ]
      : [
          {
            label: 'Tax & Book Rules',
            value: '50/50 Sch M-1 meals split · Sch K Interest excl. from Ln 22',
          },
        ]),
    {
      label: setup.multi_state_active ? 'Apportionment & Cash' : 'Ownership & Cash',
      value: `${
        setup.multi_state_active
          ? `${state1Code} ${comp.caPct.projected}% / ${state2Code} ${comp.azPct.projected}% · `
          : setupStates.hasPrimaryState
          ? `${state1Code} (Single-State) · `
          : ''
      }Ownership ${
        setup.filing_status === 'married_filing_jointly'
          ? `${primaryName} ${comp.billSharePct}% / ${spouseName} ${comp.debraSharePct}%`
          : `${primaryName} 100%`
      } · YE Cash ${
        bs.operating_cash_ye_override !== null
          ? 'Manual Override'
          : comp.subsequentYearRetirementAddback > 0
          ? 'Auto-Projected, excl. next-yr §404(a)(6) funding'
          : 'Auto-Projected'
      } (${fmtUsdExact(comp.projectedCashYe)})`,
    },
  ];

  const activeAssumptionsSummary = activeAssumptions
    .map((item) => `${item.label}: ${item.value}`)
    .join(' | ');

  const activeGoals = (options?.activeGoals ?? []).filter((g) => g.goal.enabled);
  const activeGoalsBrief =
    activeGoals.length > 0
      ? activeGoals
          .map(
            (g) =>
              `${g.goal.title} [Target ${g.targetDisplay} | Proj ${g.currentDisplay} | ${g.statusLabel}]`
          )
          .join(' ; ')
      : '';

  const disclaimerHeadline = 'PRELIMINARY TAX-PLANNING PROJECTION — FOR REVIEW WITH YOUR CPA';
  const generatedClause =
    bizIdentity.businessName && bizIdentity.businessName !== 'Business Entity'
      ? `Prepared for ${bizIdentity.businessName}${websiteSuffix}.`
      : 'Generated via Rolling Tax Planner.';
  const disclaimerBody = `This report is a preliminary tax-planning projection for review with your CPA and does not replace professional CPA, tax, legal, or accounting advice. Year-to-date figures reflect imported accounting or bookkeeping records as of the report cutoff date, while remaining-year projections use automated cadence or smoothing rules and user assumptions that require CPA review before tax return preparation or filing. ${generatedClause}`;

  const csvCommentLines = [
    `# ${preparedBy}${websiteSuffix}`,
    `# Module: ${moduleName}`,
    `# Entity: ${entityName}${entityEin ? ` (EIN ${entityEin})` : ''} | Tax Year: ${year}`,
    `# Report Cutoff / As-Of Date: ${asOfDateDisplay} (${bs.as_of_date}) | Remaining Days Through ${yearEndDisplay}: ${remainingDays} days (${elapsedDays} of ${totalYearDays} YTD days elapsed)`,
    `# Accounting Records Source: ${sourceMode}`,
    `# Active Forecast Assumptions: ${activeAssumptionsSummary}`,
    ...(activeGoalsBrief
      ? [`# Planning Goals & Guardrails (${activeGoals.length} active): ${activeGoalsBrief}`]
      : []),
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
    activeGoals,
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
  options?: CpaReportMetadata,
  computedYears?: ComputedTaxYear[]
): string {
  const { primaryName, spouseName } = getPersonNames(setup);
  const setupStates = getSetupStates(setup);
  const state1Code = setupStates.primaryStateCode || 'State 1';
  const state2Code = setupStates.secondaryStateCode || 'State 2';
  const isMfj = setup.filing_status === 'married_filing_jointly';
  const entityFormLabel =
    setup.entity_type === 'partnership'
      ? 'FORM 1065'
      : setup.entity_type === 'ccorp'
      ? 'FORM 1120'
      : setup.entity_type === 'sole_prop'
      ? 'SCHEDULE C'
      : 'FORM 1120-S';
  const meta = buildCpaPackageMetadata(setup, pnlState, comp, entityName, entityEin, options);

  const rows: (string | number)[][] = [
    ...meta.csvCommentLines.map((line) => [line]),
    [],
    ['CPA YEAR-END TAX PROJECTION PACKAGE'],
    ['Prepared By', meta.website ? `${meta.preparedBy} (${meta.website})` : meta.preparedBy],
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
      isMfj
        ? `${primaryName} ${comp.billSharePct}% / ${spouseName} ${comp.debraSharePct}%`
        : `${primaryName} 100%`,
    ],
    ...(setup.multi_state_active
      ? [
          [
            'Projected State Apportionment',
            `${state1Code} ${comp.caPct.projected}% / ${state2Code} ${comp.azPct.projected}%`,
          ],
        ]
      : []),
    ['Active Forecast Assumptions', meta.activeAssumptionsSummary],
    ['CPA Review Disclaimer', `${meta.disclaimerHeadline} — ${meta.disclaimerBody}`],
    [],
    [
      `PROFIT & LOSS PROJECTION (${entityFormLabel})`,
      'Form Ref',
      'YTD Actuals',
      'Remaining Forecast',
      'Projected Full Year',
      `${pnlState.projection_year - 1} Filed Actuals`,
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
    bs.pension_payable_ye === 0 &&
    comp.lines.dbp_contribution.projected + comp.lines.employer_401k.projected > 0
      ? 'Pension / Retirement Expense Payable (IRC §404(a)(6) / cash-basis funding)'
      : 'Pension / Retirement Expense Payable',
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

  if (setup.has_stock_basis !== false) {
    rows.push([]);
    if (isMfj) {
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
    } else {
      rows.push([
        'FORM 7203 SHAREHOLDER STOCK BASIS PROJECTION',
        `${primaryName} (100%)`,
      ]);
      rows.push([
        `Beginning Stock Basis (1/1/${pnlState.projection_year})`,
        comp.beginningStockBasis.toFixed(2),
      ]);
      rows.push([
        '+ Projected Ordinary Business Income (K-1 Box 1)',
        posInc.toFixed(2),
      ]);
      rows.push([
        '+ Schedule K Interest Income (Line 4)',
        posInt.toFixed(2),
      ]);
      rows.push([
        '+ Capital Contributions (YTD + Remaining)',
        comp.projectedCapitalContributionsTotal.toFixed(2),
      ]);
      rows.push([
        '= Basis Available Before Distributions',
        comp.basisAvailableBeforeDraws.toFixed(2),
      ]);
      rows.push([
        '- Member Draws / Distributions (YTD + Planned Remaining)',
        (-comp.projectedDrawsTotal).toFixed(2),
      ]);
      rows.push([
        '- Nondeductible Expenses (50% Meals Sch M-1)',
        (-comp.mealsNondeductible50.projected).toFixed(2),
      ]);
      rows.push([
        `= Projected Ending Stock Basis (12/31/${pnlState.projection_year})`,
        comp.projectedEndingStockBasis.toFixed(2),
      ]);
      rows.push([
        'Form 8949 Excess Distribution Capital Gain',
        comp.projectedExcessDistributionGain.toFixed(2),
      ]);
    }
  }

  if (computedYears && computedYears.length > 0) {
    const horizonSummary = buildCpaHorizonSummary(setup, computedYears);
    const firstYr = horizonSummary.years[0];
    const lastYr = horizonSummary.years[horizonSummary.years.length - 1];
    rows.push([]);
    rows.push([
      `MULTI-YEAR TAX & CASH-FLOW HORIZON SUMMARY (${firstYr}-${lastYr})`,
      'Ref',
      ...horizonSummary.years.map((y) => String(y)),
      `${horizonSummary.years.length}-Yr Total / End`,
    ]);
    for (const row of horizonSummary.rows) {
      rows.push([
        row.label,
        row.shortRef,
        ...row.cells.map((cell) =>
          row.id === 'irmaa_lookback' && cell.badgeText
            ? `${cell.display} (${cell.badgeText})`
            : cell.display
        ),
        row.totalDisplay,
      ]);
    }
  }

  if (meta.activeGoals.length > 0) {
    rows.push([]);
    rows.push([
      'PLANNING GOALS & GUARDRAILS FOR CPA REVIEW',
      'Target Threshold',
      'Current Projected',
      'Status',
      'Variance / Context',
      'Why This Matters',
    ]);
    for (const item of meta.activeGoals) {
      rows.push([
        item.goal.title,
        item.targetDisplay,
        item.currentDisplay,
        item.statusLabel,
        item.varianceSummary,
        item.goal.why_it_matters,
      ]);
    }
  }

  rows.push([]);
  rows.push(['PACKAGE BRANDING & CPA DISCLAIMER']);
  rows.push([
    'Prepared By',
    meta.website ? `${meta.preparedBy} (${meta.website})` : meta.preparedBy,
  ]);
  rows.push(['Module', meta.moduleName]);
  rows.push([
    'As-Of Date & Remaining Days',
    `${meta.asOfDateDisplay} (${meta.asOfDate}) | ${meta.remainingDays} remaining days through ${meta.yearEndDisplay}`,
  ]);
  rows.push(['Active Forecast Assumptions', meta.activeAssumptionsSummary]);
  rows.push(['Disclaimer', meta.disclaimerBody]);

  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
