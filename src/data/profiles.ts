/**
 * ISOLATED PROFILE DATA MODULE (ARCHITECTURE_RULES.md — RULE 3)
 *
 * This is the ONLY file in `src/` permitted to hold default household seeds,
 * synthetic test personas, or reference filed-return benchmarks.
 * Calculation engines and UI components MUST read dynamically from `SetupConfig` / `PlannerState`.
 */

import type {
  BalanceSheetProjectionInputs,
  CadenceForecasterState,
  CadenceTransactionRow,
  EntityType,
  NewProfileOptions,
  PlannerState,
  PnlBalanceSheetState,
  PnlLineAmounts,
  PnlLineId,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { DEFAULT_IRMAA_GROWTH_RATE } from '../engine/irmaa';
import { createDefaultPersonProfile } from '../utils/personTax';

// ============================================================================
// 1. Default Initial Profile Seed (used ONLY when initializing default baseline)
// ============================================================================

export interface DefaultVerificationBenchmarks {
  k1_ordinary_income: number;
  qbi_deduction: number;
  agi: number;
  taxable_income: number;
  federal_tax: number;
  primary_state_personal_tax: number;
  secondary_state_personal_tax: number;
  schedule_d_net_filed: number;
  ss_annual_test_amount: number;
  ending_stock_basis: number;
  excess_dist_gain: number;
  enhanced_senior_deduction: number;
  taxable_social_security: number;
}

export interface ForecastSeedYearInput {
  ca_revenue: number;
  az_revenue: number;
  operating_expenses?: number;
  debra_w2: number;
  bill_w2: number;
  member_draws: number;
  capital_contributions: number;
  dbp_contribution: number;
  sehi_medicare_premiums: number;
}

export const DEFAULT_PROFILE_SEED = {
  primary_name: 'Bill',
  spouse_name: 'Debra',
  primary_birth_date: '1960-05-06',
  spouse_birth_date: '1960-08-10',
  primary_birth_year: 1960,
  spouse_birth_year: 1960,
  primary_ss_monthly: 3291.67,
  spouse_ss_monthly: 3291.67,
  business_name: 'Operating Support Services, LLC',
  business_website: 'ossadvisorygroup.com',
  business_ein: '83-1706286',
  home_state: 'CA',
  secondary_state: 'AZ',
  /** Default 2026–2030 state revenue apportionment split (37% CA / 63% AZ matching 2026 projected year-end actuals) */
  default_state_revenue_split: {
    CA: 37,
    AZ: 63,
  } as Record<string, number>,
  /** Legacy 50/50 placeholder 2026–2030 revenues used strictly for one-time migration of saved profiles */
  legacy_5050_forecast_revenues: {
    2026: { ca_revenue: 169500, az_revenue: 169500 },
    2027: { ca_revenue: 165000, az_revenue: 165000 },
    2028: { ca_revenue: 104500, az_revenue: 104500 },
    2029: { ca_revenue: 104500, az_revenue: 104500 },
    2030: { ca_revenue: 55500, az_revenue: 55500 },
  } as Record<number, { ca_revenue: number; az_revenue: number }>,
  /** Legacy 2026 seed W-2 amounts that previously had S-Corp SEHI baked in (used strictly for one-time migration) */
  legacy_2026_w2_with_sehi: {
    bill_w2: 29758,
    debra_w2: 29759,
  },
  /** Default non-payroll OpEx ratio matching 2026 GL/P&L baseline ($40,230 / $339,000 = 11.9%) */
  default_expense_ratio: 0.119,
  /** Legacy 2025-derived expense ratio used strictly for one-time migration of saved default profiles */
  legacy_expense_ratio: 0.164,
  /** Legacy 2026 seed OpEx inflated from 2025 actuals ($61,867 * 1.025 = $63,414) used strictly for one-time migration */
  legacy_2026_operating_expenses: 63414,
  /** Legacy 2026 seed Capital Contributions placeholder ($15,000) used strictly for one-time migration to GL actual ($0) */
  legacy_2026_capital_contributions: 15000,
  /** Default Projected 12/31 Pension Expense Payable ($0 under IRC §404(a)(6) / cash-basis funding) */
  default_pension_payable_ye: 0,
  /** Legacy 2026 accrued pension payable seed used strictly for one-time migration */
  legacy_2026_pension_payable_ye: 64571.0,
  /** Legacy 2026 Cadence Line 17 manual override seed used strictly for one-time migration to live Horizon sync */
  legacy_2026_cadence_retirement_overrides: {
    dbp_contribution: 61000.0,
    employer_401k: 3571.0,
  },
  /** Schedule SB DBP actuarial baselines strictly isolated to default profile seed */
  dbp_actuarial_baseline: {
    historical_high_3_w2: 83100,
    boy_assets_anchor: 706470,
    plan_year_anchor: 8,
    trust_growth_rate: 0,
    valuation_interest_rate: 0.0475,
  },
  forecast_2026_2030_inputs: {
    2026: {
      ca_revenue: 125430, // 37% of $339,000
      az_revenue: 213570, // 63% of $339,000
      operating_expenses: 40230, // 2026 GL/P&L non-payroll deductible OpEx (excl. W-2, employer payroll taxes, SEHI & retirement)
      debra_w2: 24478,
      bill_w2: 24478,
      member_draws: 120000,
      capital_contributions: 0,
      dbp_contribution: 61000,
      sehi_medicare_premiums: 9916,
    },
    2027: {
      ca_revenue: 122100, // 37% of $330,000
      az_revenue: 207900, // 63% of $330,000
      debra_w2: 64500,
      bill_w2: 64500,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 44000,
      sehi_medicare_premiums: 9916,
    },
    2028: {
      ca_revenue: 77330, // 37% of $209,000
      az_revenue: 131670, // 63% of $209,000
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
    2029: {
      ca_revenue: 77330, // 37% of $209,000
      az_revenue: 131670, // 63% of $209,000
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 50000,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
    2030: {
      ca_revenue: 41070, // 37% of $111,000
      az_revenue: 69930, // 63% of $111,000
      debra_w2: 24000,
      bill_w2: 24000,
      member_draws: 0,
      capital_contributions: 0,
      dbp_contribution: 0,
      sehi_medicare_premiums: 13900,
    },
  } as Record<number, ForecastSeedYearInput>,
  verification_benchmarks_2025: {
    k1_ordinary_income: 91498,
    qbi_deduction: 14337,
    agi: 150511,
    taxable_income: 89536,
    federal_tax: 6402,
    primary_state_personal_tax: 5362,
    secondary_state_personal_tax: 0,
    schedule_d_net_filed: 32122,
    ss_annual_test_amount: 39500,
    ending_stock_basis: 0,
    excess_dist_gain: 32182,
    enhanced_senior_deduction: 11938,
    taxable_social_security: 0,
  } satisfies DefaultVerificationBenchmarks,
  /** Default 2025 baseline DBP & rollover seeds (isolated to default household only) */
  default_dbp_max_2025: 140000,
  default_dbp_rollover_estimate: 480000,
  /** Default 2025 filed state return labels */
  default_2025_return_types: {
    primary: 'CA Form 540 (Full-Year Resident) + CA 100S (Sch R)',
    secondary: 'AZ Form 140NR (Non-Resident) + AZ 120S (Sch A)',
  },
  /** Default household 2026 residency transition parameters (CA -> WA mid-year) */
  default_residency_transition: {
    move_year: 2026,
    from_state: 'CA',
    to_state: 'WA',
    secondary_state: 'AZ',
    depart_date: '2026-06-19',
    arrive_date: '2026-06-20',
    from_day_ratio: 170 / 365,
    to_day_ratio: 195 / 365,
    part_year_from_label: 'CA Form 540NR (Part-Year thru Jun 19) + CA 100S',
    part_year_to_label: 'WA Part-Year Resident (from Jun 20 · 0% Personal Tax)',
    post_move_to_label: 'WA Full-Year Resident (0% Personal Income Tax)',
    post_move_from_label: 'CA Form 540NR (Non-Resident) + CA 100S',
    secondary_non_resident_label: 'AZ Form 140NR (Non-Resident) + AZ 120S',
  },
  /** Default 2026 QBO P&L & Balance Sheet seed (isolated strictly to default household) */
  default_pnl_2026: {
    as_of_date: '2026-11-21',
    bill_w2_ytd: 20534.52,
    debra_w2_ytd: 20257.99,
    pnl_fixed_lines: {
      ca_revenue: { ytd: 127340.0, remaining: 15672.62 },
      az_revenue: { ytd: 191943.71, remaining: 23623.84 },
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
    } as Partial<Record<PnlLineId, PnlLineAmounts>>,
    balance_sheet: {
      as_of_date: '2026-11-21',
      operating_cash_beg: 48500.0,
      operating_cash_ytd: 42580.89,
      operating_cash_ye_override: null,
      pension_payable_beg: 144540.0,
      pension_payable_ytd: 0,
      pension_payable_ye: 0,
      cc_ap_beg: 4200.0,
      cc_ap_ytd: 2963.77,
      cc_ap_ye: 2963.77,
      member_draws_ytd: 121939.75,
      member_draws_remaining: 0,
      capital_contributions_ytd: 0,
      capital_contributions_remaining: 0,
      beginning_stock_basis_override: null,
    } satisfies BalanceSheetProjectionInputs,
    /** Earlier placeholder seed signature used strictly for one-time migration */
    legacy_2026_09_30_placeholder: {
      as_of_date: '2026-09-30',
      operating_cash_ytd: 72400,
      member_draws_ytd: 90000,
      ca_revenue_ytd: 127125,
    },
  },
  /** Default 2026 QBO Transaction Cadence seed & reconciliation benchmarks */
  default_cadence_2026: {
    projection_year: 2026,
    as_of_date: '2026-11-21',
    source_label: 'Sample QBO Transaction Ledger (1/1/2026–11/21/2026)',
    extra_card_account_names: ['amtrak', 'onekey'] as readonly string[],
    balance_sheet: {
      as_of_date: '2026-11-21',
      operating_cash_beg: 76904.25,
      operating_cash_ytd: 42580.89,
      operating_cash_ye_override: null,
      pension_payable_beg: 144540.0,
      pension_payable_ytd: 0.0,
      pension_payable_ye: 0,
      cc_ap_beg: 2400.0,
      cc_ap_ytd: 2963.77,
      cc_ap_ye: 2963.77,
      member_draws_ytd: 121939.75,
      member_draws_remaining: 0.0,
      capital_contributions_ytd: 0.0,
      capital_contributions_remaining: 0.0,
      beginning_stock_basis_override: null,
    } satisfies BalanceSheetProjectionInputs,
    qbo_expected: {
      revenue: 319283.71,
      expenses: 88300.27,
      interest_income: 609.18,
      cash: 42580.89,
      credit_cards: 2963.77,
      member_draws: 121939.75,
    },
  },
  /** Default-profile-only Shadow Tax Return (.xlsx) branding, 2025 filed baseline & 2026 overrides */
  shadow_return_seed: {
    branding: {
      creator: 'Operating Support Services, LLC (OSS Advisory Group)',
      title: 'OSS Shadow Tax Return & CPA Verification Suite',
      filename_prefix: 'OSS',
      eyebrow:
        'OPERATING SUPPORT SERVICES, LLC  \u2022  OSS ADVISORY GROUP  |  EXECUTIVE TAX & FINANCIAL PLANNING  |  ossadvisorygroup.com',
      header_left: 'Operating Support Services, LLC \u2014 OSS Advisory Group',
      header_right: 'Executive Tax & Financial Planning | ossadvisorygroup.com',
      disclaimer_entity: 'Operating Support Services, LLC',
      disclaimer_taxpayers: 'William & Debra McDermott',
    },
    filed_2025: {
      primary_ownership_pct: 0.51,
      spouse_ownership_pct: 0.49,
      ca_revenue: 136770,
      az_revenue: 242815,
      other_revenue: 0,
      scorp_interest: 619,
      officer_w2: 42000,
      staff_w2: 33550,
      rents: 35447,
      payroll_taxes: 6130,
      ca_entity_state_tax: 2891,
      dbp_contribution: 140000,
      er_401k_match: 4540,
      sehi_medicare: 0,
      advertising: 0,
      other_opex: 23529,
      nondeductible_meals: 1910,
      ca_depr_adj: 0,
      ca_conformity_adj: 969,
      beg_cash: 48500,
      end_cash: 48500,
      other_assets_eoy: 0,
      ap_cc_eoy: 4200,
      pension_payable_eoy: 144540,
      paid_in_capital: 1000,
      beg_aaa: -39908,
      capital_contributions: 0,
      distributions: 135315,
      primary_beg_stock_basis: 5615,
      spouse_beg_stock_basis: 5401,
      ca_beg_stock_basis: 11016,
      ca_100s_est_paid: 800,
      primary_ee_401k: 31000,
      spouse_ee_401k: 30500,
      other_w2_wages: 0,
      personal_interest: 163,
      tax_exempt_interest: 0,
      ordinary_dividends: 505,
      qualified_dividends: 67,
      ira_taxable: 12935,
      pensions_taxable: 250,
      ss_gross: 0,
      ss_taxable: 0,
      brokerage_cap_gain: -60,
      other_sch1_adj: 1631,
      itemized_deductions: 0,
      seniors_65_plus_count: 2,
      fed_withholding: 0,
      fed_estimates: 0,
      ca_residency_factor: 1.0,
      ca_withholding_est: 0,
      az_withholding_est: 0,
      cpa_filed_tieout: {
        gross_receipts: 379585,
        total_deductions: 288087,
        obi_1120s: 91498,
        ending_stock_basis: 0,
        excess_dist_cap_gain: 32182,
        w2_box1: 14050,
        total_income_1040: 152142,
        agi_1040: 150511,
        std_or_itemized_ded: 34700,
        senior_deduction: 11938,
        qbi_deduction: 14337,
        taxable_income_1040: 89536,
        total_tax_1040: 6402,
        ca_540_tax: 5362,
        az_140nr_tax: 0,
        ca_100s_franchise_tax: 800,
      },
    },
    projected_2026_overrides: {
      ca_depr_disposal_adj: -1278,
      beg_aaa: -85016,
      ca_100s_est_paid: 800,
    },
  },
} as const;

/**
 * Returns true ONLY when the active SetupConfig belongs to the default seed household
 * (My Profile). Returns false for Test Persona, Blank User, and custom households.
 */
export function isDefaultSeedSetup(setup?: SetupConfig | null): boolean {
  if (!setup) return false;
  if (
    setup.workspace_profile_kind === 'test_persona' ||
    setup.workspace_profile_kind === 'blank' ||
    setup.workspace_profile_kind === 'custom'
  ) {
    return false;
  }
  const biz = (setup.business_name ?? '').trim().toLowerCase();
  const ein = (setup.business_ein ?? '').trim();
  const primary = (setup.primary_name ?? '').trim().toLowerCase();
  const spouse = (setup.spouse_name ?? '').trim().toLowerCase();
  const seedPrimary = DEFAULT_PROFILE_SEED.primary_name.toLowerCase();
  const seedSpouse = DEFAULT_PROFILE_SEED.spouse_name.toLowerCase();
  return (
    ein === DEFAULT_PROFILE_SEED.business_ein ||
    (biz.length > 0 && biz === DEFAULT_PROFILE_SEED.business_name.toLowerCase()) ||
    (primary === seedPrimary && spouse === seedSpouse)
  );
}

/**
 * Sanitizes a Pre-Populated Demo Baseline state so it inherits every user-provided
 * field (entity/business name, website, EIN, taxpayer names, filing status, modules)
 * and NEVER leaks DEFAULT_PROFILE_SEED branding into UI, CPA Print Package, ledger,
 * or Shadow Tax Return Excel exports.
 */
export function sanitizeDemoBaselineState(
  base: PlannerState,
  options: NewProfileOptions,
  cleanEntityName: string,
  cleanEntityEin: string
): PlannerState {
  const isMfj = options.filing_status === 'married_filing_jointly';
  const primaryName = options.primary_name.trim() || 'Primary';
  const spouseName = isMfj ? options.spouse_name.trim() || 'Spouse' : '';
  const cleanWebsite = (options.entity_website ?? '').trim();
  const entityType: EntityType = options.modules.has_scorp
    ? options.entity_type === 'none'
      ? 'scorp_llc'
      : options.entity_type
    : options.entity_type === 'scorp_llc'
    ? 'none'
    : options.entity_type;

  const sanitizedSetup: SetupConfig = {
    ...base.setup,
    workspace_profile_kind: 'custom',
    filing_status: options.filing_status,
    primary_name: primaryName,
    spouse_name: spouseName,
    business_name: options.modules.has_scorp ? cleanEntityName : options.entity_name.trim(),
    business_website: cleanWebsite,
    business_ein: cleanEntityEin,
    has_scorp: options.modules.has_scorp,
    has_ss_medicare: options.modules.has_ss_medicare,
    has_dbp: options.modules.has_dbp,
    multi_state_active: options.modules.multi_state_active,
    has_stock_basis: options.modules.has_stock_basis,
    entity_type: entityType,
  };

  const replaceIdentityText = (text: string): string => {
    const spouseDisplay = spouseName || 'Spouse';
    return text
      .replace(/Operating Support Services,\s*LLC/gi, cleanEntityName || 'Demo Advisory Group, LLC')
      .replace(/Operating Support Services\s+LLC/gi, cleanEntityName || 'Demo Advisory Group, LLC')
      .replace(/ossadvisorygroup\.com/gi, cleanWebsite)
      .replace(/83-1706286/g, cleanEntityEin)
      .replace(/\bOSS\s+401K\s+Plan\s+Payable\b/gi, '401(k) Plan Payable')
      .replace(/\bOSS\s+401\(k\)\s+Trust\b/gi, '401(k) Plan Trust')
      .replace(/\bOSS\s+Payroll\b/gi, 'Company Payroll')
      .replace(/\bBill\s*&\s*Debra\b/gi, isMfj ? `${primaryName} & ${spouseDisplay}` : primaryName)
      .replace(/\bBill\b/g, primaryName)
      .replace(/\bDebra\b/g, spouseDisplay);
  };

  const demoTransactions: CadenceTransactionRow[] = createDefaultSeedCadenceTransactions().map(
    (tx, idx) => ({
      ...tx,
      id: `demo-${idx + 1}`,
      vendor: replaceIdentityText(tx.vendor),
      account: replaceIdentityText(tx.account),
      split_account: replaceIdentityText(tx.split_account),
      memo: replaceIdentityText(tx.memo),
    })
  );

  const seedCadence = DEFAULT_PROFILE_SEED.default_cadence_2026;
  const sanitizedCadence: CadenceForecasterState = {
    projection_year: seedCadence.projection_year,
    source_label: 'Pre-Populated Demo Transaction Ledger (1/1/2026–11/21/2026)',
    ledger_format: 'transaction_list',
    as_of_date: seedCadence.as_of_date,
    grouping_mode: 'category',
    exp_smooth_alpha: base.cadence_forecaster?.exp_smooth_alpha ?? 0.35,
    exp_smooth_day_fraction: false,
    payee_aliases: [],
    transactions: demoTransactions,
    stream_overrides: {},
    pnl_line_overrides: {},
    balance_sheet: {
      ...seedCadence.balance_sheet,
      pension_payable_ye: DEFAULT_PROFILE_SEED.default_pension_payable_ye,
      beginning_stock_basis_override: null,
    },
  };

  return {
    ...base,
    setup: sanitizedSetup,
    years: base.years.map((yr) => ({
      ...yr,
      scorp_1120s: {
        ...yr.scorp_1120s,
        entity_name: cleanEntityName,
        entity_ein: cleanEntityEin,
      },
    })),
    cadence_forecaster: sanitizedCadence,
  };
}

export const DEFAULT_PROFILE_META = {
  id: 'workspace-my-profile',
  label: 'My Profile',
};

export const TEST_PERSONA_META = {
  id: 'workspace-test-persona',
  name: 'Summit Ridge Advisory, LLC (Jordan & Taylor Rivera)',
  entity_name: 'Summit Ridge Advisory, LLC',
  entity_ein: '74-3194820',
  website: 'summitridge.example',
  notes: 'Synthetic multi-user test persona (TX · Single-State · 401(k) · Born Mar 1965 & Nov 1968)',
};

export const BLANK_USER_META = {
  id: 'workspace-blank-user',
  name: 'Blank Household Workspace',
  entity_name: '',
  entity_ein: '',
  notes: 'Clean blank workspace for testing new household onboarding from scratch',
};

// ============================================================================
// 2. Generic Sample Accounting Import Snippets (for QBO modal testing)
// ============================================================================

export const SAMPLE_GENERIC_RETURN_TEXT = `2025 Federal Form 1040 Summary (Married Filing Jointly)
Line 1a W-2 Wages: $180,000
Line 2b Taxable Interest: $5,400
Line 3a Qualified Dividends: $7,200 | Line 3b Ordinary Dividends: $9,100
Schedule D Net Long-Term Capital Gain: $8,500
Schedule K-1 (Business Entity - Form 1120-S) Box 1 Ordinary Business Income: $95,000
Form 1120-S Shareholder Distributions: $60,000 | Ending Stock Basis: $140,000
Defined Benefit Plan Deductible Contribution: $45,000
Standard Deduction Method Elected | Form 1040 Line 15 Taxable Income: $225,000`;

export const SAMPLE_TEST_PERSONA_QBO_PNL = `Advisory Retainers (TX)\t328,400.00
Project Consulting (TX)\t116,800.00
Officer Compensation - Jordan\t92,000.00
Salaries & Wages - Taylor\t71,000.00
Employer 401(k) Match\t19,800.00
Office Rent & Coworking\t24,600.00
Payroll Taxes\t12,480.00
Professional & Legal Fees\t9,450.00
Software & Cloud Subscriptions\t7,820.00
Business Travel\t6,340.00
Client Meals\t4,200.00
Insurance\t5,100.00
Bank & Merchant Fees\t1,450.00
Interest Income\t2,180.00`;

export const SAMPLE_TEST_PERSONA_QBO_BS = `Business Operating Checking\t118,450.00
Retirement Contribution Payable\t19,800.00
Corporate Credit Card\t3,420.00
Member Draws\t(95,000.00)`;

// ============================================================================
// 3. Synthetic Test Persona Builder ("Jordan & Taylor Rivera" — TX)
// ============================================================================

const ALL_PNL_LINE_IDS: PnlLineId[] = [
  'ca_revenue',
  'az_revenue',
  'bill_officer_w2',
  'debra_salaries_wages',
  'dbp_contribution',
  'employer_401k',
  'sehi_medicare',
  'rents',
  'payroll_taxes',
  'ca_ftb_tax',
  'professional_fees',
  'subscriptions_software',
  'telephone_internet',
  'travel',
  'meals_gross',
  'office_expense',
  'insurance',
  'utilities',
  'bank_payroll_fees',
  'other_deductions',
  'schedule_k_interest',
];

function buildEmptyPnlMap(): Record<PnlLineId, { ytd: number; remaining: number }> {
  const map = {} as Record<PnlLineId, { ytd: number; remaining: number }>;
  for (const id of ALL_PNL_LINE_IDS) {
    map[id] = { ytd: 0, remaining: 0 };
  }
  return map;
}

function buildTestPersonaYear(taxYear: number, yearIndex: number): TaxYearRecord {
  const revGrowth = Math.pow(1.045, yearIndex);
  const wageGrowth = Math.pow(1.03, yearIndex);
  const infGrowth = Math.pow(1.025, yearIndex);

  const txRevenue = Math.round(465000 * revGrowth);
  const jordanW2 = Math.round(110000 * wageGrowth);
  const taylorW2 = Math.round(85000 * wageGrowth);
  const totalW2 = jordanW2 + taylorW2;
  const opEx = Math.round(96500 * infGrowth);
  const draws = Math.round(115000 * revGrowth);
  const isFirst = yearIndex === 0;

  return {
    tax_year: taxYear,
    record_mode: isFirst ? 'actuals' : 'forecast',
    is_locked_actuals: isFirst,
    form_1040: {
      w2_wages_total: totalW2,
      use_explicit_w2_box1: false,
      taxable_interest: Math.round(6800 * infGrowth),
      tax_exempt_interest: 1200,
      ordinary_dividends: Math.round(12400 * Math.pow(1.04, yearIndex)),
      qualified_dividends: Math.round(10200 * Math.pow(1.04, yearIndex)),
      short_term_capital_gain_loss: 0,
      long_term_capital_gain_loss: Math.round(14000 * Math.pow(1.03, yearIndex)),
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: 0,
      schedule_1_adjustments_input: 0,
      schedule_k1_ordinary_income: 0,
      schedule_k1_other_items: 0,
      ira_distributions_gross: 0,
      ira_distributions_taxable: 0,
      pensions_and_annuities_gross: 0,
      pensions_and_annuities_taxable: 0,
      social_security_gross: 0,
      ss_bill_mode: taxYear >= 2027 ? 'on' : 'off',
      ss_debra_mode: taxYear >= 2030 ? 'on' : 'off',
      health_insurance_premiums: Math.round(14400 * Math.pow(1.05, yearIndex)),
      itemized_deductions_input: 28000,
      deduction_method: 'standard',
    },
    scorp_1120s: {
      entity_id: 'entity-summit-ridge-tx',
      entity_name: TEST_PERSONA_META.entity_name,
      entity_ein: TEST_PERSONA_META.entity_ein,
      bill_ownership_pct: 60,
      debra_ownership_pct: 40,
      ca_revenue: txRevenue,
      az_revenue: 0,
      gross_receipts_revenue: txRevenue,
      operating_expenses: opEx,
      use_detailed_1120s_deductions: false,
      bill_w2_wages: jordanW2,
      debra_w2_wages: taylorW2,
      officer_w2_wages: totalW2,
      scorp_distributions_total: draws,
      capital_contributions: 0,
      stock_basis_beginning: isFirst ? 82500 : 0,
      aaa_balance_beginning: isFirst ? 82500 : 0,
      schedule_k_interest_income: 2180,
      schedule_k_nondeductible_expenses: 2100,
      state_sourcing_breakdown: [{ state_code: 'TX', apportionment_percent: 100 }],
      pte_election_active: false,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      dbp_plan_id: 'dbp-summit-ridge-tx',
      dbp_status: 'terminated',
      dbp_max_deductible_contribution: 0,
      dbp_actual_contribution: 0,
      dbp_target_termination_year: 2099,
      dbp_rollover_target_account: 'Traditional IRA Rollover',
      dbp_loan_balance: 0,
      dbp_collateral_requirement: 0,
      qualified_plan_contribution: 24000,
      rollover_amount: 0,
      rollover_source_type: 'None',
      annuity_contract_value: 0,
      annuity_payout_amount: 0,
    },
    state_filings: [
      {
        state_code: 'TX',
        residency_status: 'resident',
        residency_start_date: `${taxYear}-01-01`,
        residency_end_date: `${taxYear}-12-31`,
        residency_day_or_income_ratio: 1,
        state_return_type: 'TX No Personal Income Tax (Franchise Report Only)',
        state_apportionment_factor: 1,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      },
    ],
  };
}

export function buildTestPersonaPnl(projectionYear: number): PnlBalanceSheetState {
  const pnl = buildEmptyPnlMap();
  pnl.ca_revenue = { ytd: 410000, remaining: 75925 };
  pnl.az_revenue = { ytd: 0, remaining: 0 };
  pnl.bill_officer_w2 = { ytd: 94400, remaining: 18900 };
  pnl.debra_salaries_wages = { ytd: 72950, remaining: 14600 };
  pnl.dbp_contribution = { ytd: 0, remaining: 0 };
  pnl.employer_401k = { ytd: 18500, remaining: 5602 };
  pnl.sehi_medicare = { ytd: 12600, remaining: 2520 };
  pnl.rents = { ytd: 30000, remaining: 6000 };
  pnl.payroll_taxes = { ytd: 13500, remaining: 2705 };
  pnl.ca_ftb_tax = { ytd: 0, remaining: 0 };
  pnl.professional_fees = { ytd: 13500, remaining: 2700 };
  pnl.subscriptions_software = { ytd: 10500, remaining: 2100 };
  pnl.telephone_internet = { ytd: 2640, remaining: 528 };
  pnl.travel = { ytd: 6340, remaining: 1268 };
  pnl.meals_gross = { ytd: 3600, remaining: 600 };
  pnl.office_expense = { ytd: 3250, remaining: 650 };
  pnl.insurance = { ytd: 5100, remaining: 1020 };
  pnl.utilities = { ytd: 1800, remaining: 360 };
  pnl.bank_payroll_fees = { ytd: 1450, remaining: 290 };
  pnl.other_deductions = { ytd: 6100, remaining: 1216 };
  pnl.schedule_k_interest = { ytd: 1820, remaining: 360 };

  return {
    projection_year: projectionYear,
    pnl,
    balance_sheet: {
      as_of_date: `${projectionYear}-10-31`,
      operating_cash_beg: 94200,
      operating_cash_ytd: 118450,
      operating_cash_ye_override: null,
      pension_payable_beg: 12000,
      pension_payable_ytd: 18500,
      pension_payable_ye: 0,
      cc_ap_beg: 2800,
      cc_ap_ytd: 3420,
      cc_ap_ye: 3100,
      member_draws_ytd: 95175,
      member_draws_remaining: 25000,
      capital_contributions_ytd: 0,
      capital_contributions_remaining: 0,
      beginning_stock_basis_override: null,
    },
  };
}

export function buildTestPersonaCadence(projectionYear: number): CadenceForecasterState {
  return {
    projection_year: projectionYear,
    source_label: 'Summit Ridge Advisory, LLC — Synthetic Ledger',
    ledger_format: 'transaction_list',
    as_of_date: `${projectionYear}-10-31`,
    exp_smooth_alpha: 0.5,
    exp_smooth_day_fraction: false,
    payee_aliases: [],
    transactions: [],
    stream_overrides: {},
    pnl_line_overrides: {},
    balance_sheet: buildTestPersonaPnl(projectionYear).balance_sheet,
  };
}

export function createTestPersonaPlannerState(allScheduleItemIds: string[]): PlannerState {
  const forecastYears = [2025, 2026, 2027, 2028, 2029, 2030];
  const jordanProfile = createDefaultPersonProfile('1965-03-14');
  jordanProfile.social_security = {
    receiving: true,
    monthly_benefit: 2650,
    suspend_fra_to_70: false,
    suspend_start_year: null,
    resume_age: 70,
  };
  jordanProfile.medicare = {
    enrolled: false,
    part_a_monthly: null,
    part_b_monthly: null,
    part_d_monthly: null,
    medigap_plan_g_monthly: null,
  };

  const taylorProfile = createDefaultPersonProfile('1968-11-22');
  taylorProfile.social_security = {
    receiving: true,
    monthly_benefit: 2150,
    suspend_fra_to_70: false,
    suspend_start_year: null,
    resume_age: 70,
  };
  taylorProfile.medicare = {
    enrolled: false,
    part_a_monthly: null,
    part_b_monthly: null,
    part_d_monthly: null,
    medigap_plan_g_monthly: null,
  };

  const setup: SetupConfig = {
    filing_status: 'married_filing_jointly',
    primary_name: 'Jordan Rivera',
    spouse_name: 'Taylor Rivera',
    primary_birth_year: 1965,
    spouse_birth_year: 1968,
    primary_profile: jordanProfile,
    spouse_profile: taylorProfile,
    business_name: TEST_PERSONA_META.entity_name,
    business_website: TEST_PERSONA_META.website,
    business_ein: TEST_PERSONA_META.entity_ein,
    home_state: 'TX',
    secondary_state: '',
    state_revenue_apportionment: {
      default_split: { TX: 100 },
      year_overrides: {},
    },
    workspace_profile_kind: 'test_persona',
    deduction_method: 'standard',
    custom_itemized_deduction: 32000,
    entity_type: 'scorp_llc',
    has_scorp: true,
    has_ss_medicare: true,
    has_stock_basis: true,
    has_dbp: false,
    dbp_planned_termination_year: null,
    post_dbp_profit_sharing_rate: 0.12,
    dbp_actuarial: {
      historical_high_3_w2: 0,
      boy_assets_anchor: 0,
      plan_year_anchor: 1,
      trust_growth_rate: 0,
      valuation_interest_rate: 0.05,
    },
    has_401k_or_ira: true,
    has_annuity: false,
    has_pte: false,
    multi_state_active: false,
    residency_change_active: false,
    anchor_actuals_year: 2025,
    current_tax_year: 2026,
    forecast_length: 6,
    forecast_years: forecastYears,
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      irmaa_threshold_growth_rate: DEFAULT_IRMAA_GROWTH_RATE,
      revenue_growth_rate: 0.045,
      wage_growth_rate: 0.03,
      investment_growth_rate: 0.04,
      expense_ratio: 0.21,
      opex_scaling_mode: 'revenue_proportional',
    },
    irmaa_threshold_overrides: {},
  };

  return {
    setup,
    years: forecastYears.map((yr, idx) => buildTestPersonaYear(yr, idx)),
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...allScheduleItemIds],
      hidden_line_item_ids: [],
    },
    pnl_balance_sheet: buildTestPersonaPnl(2026),
    cadence_forecaster: buildTestPersonaCadence(2026),
  };
}

// ============================================================================
// 4. Blank User Workspace Builder (Zeroed, Unconfigured Household)
// ============================================================================

export function createBlankUserPlannerState(allScheduleItemIds: string[]): PlannerState {
  const forecastYears = [2025, 2026, 2027, 2028, 2029, 2030];
  const emptyPerson = () => ({
    birth_date: '',
    birth_month: undefined,
    social_security: {
      receiving: false,
      monthly_benefit: null,
      suspend_fra_to_70: false,
      suspend_start_year: null,
      resume_age: 70,
    },
    medicare: {
      enrolled: false,
      part_a_monthly: null,
      part_b_monthly: null,
      part_d_monthly: null,
      medigap_plan_g_monthly: null,
    },
  });

  const setup: SetupConfig = {
    filing_status: 'married_filing_jointly',
    primary_name: '',
    spouse_name: '',
    primary_birth_year: 1975,
    spouse_birth_year: 1975,
    primary_profile: emptyPerson(),
    spouse_profile: emptyPerson(),
    business_name: '',
    business_website: '',
    business_ein: '',
    home_state: '',
    secondary_state: '',
    state_revenue_apportionment: {
      default_split: {},
      year_overrides: {},
    },
    workspace_profile_kind: 'blank',
    deduction_method: 'standard',
    custom_itemized_deduction: 30000,
    entity_type: 'none',
    has_scorp: false,
    has_ss_medicare: true,
    has_stock_basis: false,
    has_dbp: false,
    dbp_planned_termination_year: null,
    post_dbp_profit_sharing_rate: 0.06,
    dbp_actuarial: {
      historical_high_3_w2: 0,
      boy_assets_anchor: 0,
      plan_year_anchor: 1,
      trust_growth_rate: 0,
      valuation_interest_rate: 0.05,
    },
    has_401k_or_ira: false,
    has_annuity: false,
    has_pte: false,
    multi_state_active: false,
    residency_change_active: false,
    anchor_actuals_year: 2025,
    current_tax_year: 2026,
    forecast_length: 6,
    forecast_years: forecastYears,
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      irmaa_threshold_growth_rate: DEFAULT_IRMAA_GROWTH_RATE,
      revenue_growth_rate: 0.03,
      wage_growth_rate: 0.025,
      investment_growth_rate: 0.035,
      expense_ratio: 0.2,
      opex_scaling_mode: 'revenue_proportional',
    },
    irmaa_threshold_overrides: {},
  };

  const blankYears: TaxYearRecord[] = forecastYears.map((taxYear, idx) => ({
    tax_year: taxYear,
    record_mode: idx === 0 ? 'actuals' : 'forecast',
    is_locked_actuals: false,
    form_1040: {
      w2_wages_total: 0,
      use_explicit_w2_box1: false,
      taxable_interest: 0,
      tax_exempt_interest: 0,
      ordinary_dividends: 0,
      qualified_dividends: 0,
      short_term_capital_gain_loss: 0,
      long_term_capital_gain_loss: 0,
      schedule_d_includes_excess_gain: false,
      schedule_1_other_income: 0,
      schedule_1_adjustments_input: 0,
      schedule_k1_ordinary_income: 0,
      schedule_k1_other_items: 0,
      ira_distributions_gross: 0,
      ira_distributions_taxable: 0,
      pensions_and_annuities_gross: 0,
      pensions_and_annuities_taxable: 0,
      social_security_gross: 0,
      ss_bill_mode: 'off',
      ss_debra_mode: 'off',
      health_insurance_premiums: 0,
      itemized_deductions_input: 0,
      deduction_method: 'standard',
    },
    scorp_1120s: {
      entity_id: 'entity-blank',
      entity_name: '',
      entity_ein: '',
      bill_ownership_pct: 50,
      debra_ownership_pct: 50,
      ca_revenue: 0,
      az_revenue: 0,
      gross_receipts_revenue: 0,
      operating_expenses: 0,
      use_detailed_1120s_deductions: false,
      bill_w2_wages: 0,
      debra_w2_wages: 0,
      officer_w2_wages: 0,
      scorp_distributions_total: 0,
      capital_contributions: 0,
      stock_basis_beginning: 0,
      aaa_balance_beginning: 0,
      state_sourcing_breakdown: [],
      pte_election_active: false,
      auto_sync_k1: true,
    },
    dbp_and_retirement: {
      dbp_plan_id: 'dbp-blank',
      dbp_status: 'terminated',
      dbp_max_deductible_contribution: 0,
      dbp_actual_contribution: 0,
      dbp_target_termination_year: 2099,
      dbp_rollover_target_account: 'Traditional IRA Rollover',
      dbp_loan_balance: 0,
      dbp_collateral_requirement: 0,
      qualified_plan_contribution: 0,
      rollover_amount: 0,
      rollover_source_type: 'None',
      annuity_contract_value: 0,
      annuity_payout_amount: 0,
    },
    state_filings: [],
  }));

  const blankPnl: PnlBalanceSheetState = {
    projection_year: 2026,
    pnl: buildEmptyPnlMap(),
    balance_sheet: {
      as_of_date: '2026-12-31',
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
  };

  return {
    setup,
    years: blankYears,
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...allScheduleItemIds],
      hidden_line_item_ids: [],
    },
    pnl_balance_sheet: blankPnl,
    cadence_forecaster: {
      projection_year: 2026,
      source_label: 'No transactions imported yet',
      ledger_format: 'transaction_list',
      as_of_date: '2026-12-31',
      exp_smooth_alpha: 0.5,
      exp_smooth_day_fraction: false,
      payee_aliases: [],
      transactions: [],
      stream_overrides: {},
      pnl_line_overrides: {},
      balance_sheet: blankPnl.balance_sheet,
    },
  };
}

// ============================================================================
// 5. Default Seed Sample QBO Transaction Ledger (1/1/2026 – 11/21/2026)
// Isolated strictly to DEFAULT_PROFILE_SEED (My Profile).
// ============================================================================

const SEED_MS_PER_DAY = 86400000;

function seedRound2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function seedFormatUtcIso(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitIntoInstallments(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100;
  const arr = Array.from({ length: count }, () => base);
  const diff = seedRound2(total - seedRound2(base * count));
  arr[0] = seedRound2(arr[0] + diff);
  return arr;
}

export function createDefaultSeedCadenceTransactions(): CadenceTransactionRow[] {
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
      amount: seedRound2(amount),
    });
  };

  // --- Opening Balances (1/1/2026) ---
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'BlueVine Checking', 'Opening Balance Equity', 76904.25, '2026 Beginning Cash');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Amazon CC', 'Opening Balance Equity', 950.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Cap One CC', 'Opening Balance Equity', 850.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'AMX CC', 'Opening Balance Equity', 600.00, '2026 Beginning Card Balance');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'Defined Benefit Plan Payable', 'Opening Balance Equity', 140000.00, '2025 Accrued DBP Liability');
  push('2026-01-01', 'Opening Balance', 'Opening Balance', 'OSS 401K Plan Payable', 'Opening Balance Equity', 4540.00, '2025 Accrued 401(k) Profit Sharing');

  // --- Prior-Year Pension Payable Settlements ---
  push('2026-03-10', 'Check', 'Schwab Defined Benefit Trust', 'BlueVine Checking', 'Defined Benefit Plan Payable', -140000.00, '2025 DBP Plan Funding', '1042');
  push('2026-03-10', 'Check', 'OSS 401(k) Trust', 'BlueVine Checking', 'OSS 401K Plan Payable', -4540.00, '2025 401(k) Profit Sharing Funding', '1043');

  // --- 1. Revenue ($319,283.71: CA $127,340.00 + AZ $191,943.71) ---
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
  ];
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
  ];
  for (const [d, v, amt] of azConsulting) {
    push(d, 'Deposit', v, 'BlueVine Checking', 'Consulting - Bill (AZ)', amt, 'AZ consulting engagement');
  }

  const azServicesBill: [string, string, number][] = [
    ['2026-02-26', 'Mesa Field Services', 5250.00],
    ['2026-05-15', 'Mesa Field Services', 5750.00],
    ['2026-08-24', 'Mesa Field Services', 5100.00],
    ['2026-11-12', 'Mesa Field Services', 5400.00],
  ];
  for (const [d, v, amt] of azServicesBill) {
    push(d, 'Deposit', v, 'BlueVine Checking', 'Services - Bill (AZ)', amt, 'Field advisory services');
  }

  push('2026-04-10', 'Deposit', 'Phoenix Municipal Advisory', 'BlueVine Checking', 'Services Income', 2500.00, 'Advisory milestone');
  push('2026-10-05', 'Deposit', 'Phoenix Municipal Advisory', 'BlueVine Checking', 'Services Income', 2500.00, 'Advisory milestone');

  // --- 2. Schedule K Interest Income ($609.18) ---
  const interestInstallments = splitIntoInstallments(609.18, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-22`;
    push(dt, 'Deposit', 'BlueVine Bank Interest', 'BlueVine Checking', 'Interest Income', interestInstallments[m - 1], 'Monthly checking APY interest');
  }

  // --- 3. Biweekly Payroll & Payroll Taxes ---
  const biweeklyDates: string[] = [];
  let bwMs = Date.UTC(2026, 0, 9);
  for (let i = 0; i < 23; i++) {
    biweeklyDates.push(seedFormatUtcIso(bwMs));
    bwMs += 14 * SEED_MS_PER_DAY;
  }

  const billWages = splitIntoInstallments(20534.52, 23);
  const debraWages = splitIntoInstallments(20257.99, 23);
  const fedTaxes = splitIntoInstallments(2531.68, 23);
  const medCareTaxes = splitIntoInstallments(591.50, 23);
  const caSdiTaxes = splitIntoInstallments(498.12, 23);
  const caSuiTaxes = splitIntoInstallments(340.00, 10);
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

  // --- 4. SEHI Medicare Premiums ($6,167.85) ---
  const sehiBill = splitIntoInstallments(3083.93, 11);
  const sehiDebra = splitIntoInstallments(3083.92, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-05`;
    push(dt, 'Expense', 'CMS Medicare & Medigap — Bill', 'BlueVine Checking', 'Shareholder Health - Bill', -sehiBill[m - 1], 'Monthly Medicare Part B/D/G');
    push(dt, 'Expense', 'CMS Medicare & Medigap — Debra', 'BlueVine Checking', 'Shareholder Health - Debra', -sehiDebra[m - 1], 'Monthly Medicare Part B/D/G');
  }

  // --- 5. Rents ($10,487.00) ---
  const rentAmts = splitIntoInstallments(10487.00, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-01`;
    push(dt, 'Check', 'Executive Suites Property Mgmt', 'BlueVine Checking', 'Rents', -rentAmts[m - 1], 'Monthly office suite rent');
  }

  // --- 6. CA FTB State Tax Refund (-$466.84) ---
  push('2026-04-28', 'Deposit', 'CA Franchise Tax Board', 'BlueVine Checking', 'Taxes & Licenses:State', 466.84, 'Prior-year CA 100S overpayment refund');

  // --- 7. Professional Fees ($6,556.00) ---
  push('2026-02-19', 'Expense', 'Vanguard CPA Advisory', 'BlueVine Checking', 'Professional Fees', -2450.00, '1120-S & K-1 preparation');
  push('2026-06-08', 'Expense', 'Actuarial Pension Consultants', 'BlueVine Checking', 'Professional Fees', -1550.00, 'Mid-year DBP actuarial valuation');
  push('2026-09-21', 'Expense', 'Vanguard CPA Advisory', 'BlueVine Checking', 'Professional Fees', -856.00, 'Q3 multi-state nexus review');
  push('2026-04-14', 'Expense', 'Sterling Business Law LLP', 'BlueVine Checking', 'legal fees', -950.00, 'Annual LLC minutes & compliance');
  push('2026-10-16', 'Expense', 'Sterling Business Law LLP', 'BlueVine Checking', 'legal fees', -750.00, 'Client MSA review');

  // --- 8. Subscriptions & Software ($3,797.30) ---
  const subsAmts = splitIntoInstallments(3797.30, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-12`;
    push(dt, 'Credit Card Expense', 'Intuit QBO & Cloud SaaS', 'Cap One CC', 'Subscriptions & Software', subsAmts[m - 1], 'Monthly SaaS stack');
  }

  // --- 9. Telephone & Internet ($2,382.57) ---
  const attAmts = splitIntoInstallments(1450.00, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-22`;
    push(dt, 'Credit Card Expense', 'AT&T Business Wireless', 'AMX CC', 'Telephone Expense', attAmts[m - 1], 'Monthly business mobile lines');
  }
  const coxAmts = splitIntoInstallments(770.00, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-18`;
    push(dt, 'Credit Card Expense', 'Cox Business Fiber', 'Cap One CC', 'Internet', coxAmts[m - 1], 'Office fiber internet');
  }
  push('2026-03-11', 'Credit Card Expense', 'Cloudflare & Domain Registrar', 'Amazon CC', 'Computer and Internet Expenses', 84.57, 'Domain & DNS renewal');
  push('2026-08-29', 'Credit Card Expense', 'Cloudflare & Domain Registrar', 'Amazon CC', 'Computer and Internet Expenses', 78.00, 'SSL & backup storage');

  // --- 10. Travel Excl. Meals ($405.34) ---
  push('2026-03-24', 'Credit Card Expense', 'Amtrak & Uber Business', 'Amtrak', 'Travel Expense:Ground Transportation', 82.40, 'Client site transit');
  push('2026-07-14', 'Credit Card Expense', 'Amtrak & Uber Business', 'Amtrak', 'Travel Expense:Ground Transportation', 60.44, 'Airport ground transfer');
  push('2026-05-07', 'Credit Card Expense', 'Marriott Courtyard', 'AMX CC', 'Travel Expense:Lodging', 142.50, 'Client site overnight');
  push('2026-09-18', 'Credit Card Expense', 'Southwest Airlines', 'AMX CC', 'Travel Expense:Airfare', 120.00, 'Regional client flight');

  // --- 11. Meals 100% Gross ($1,806.58) ---
  push('2026-02-11', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Business Meals at Restaurant (50%)', 248.90, 'Client lunch meeting');
  push('2026-06-19', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Business Meals at Restaurant (50%)', 216.50, 'Quarterly review dinner');
  push('2026-10-08', 'Credit Card Expense', 'Client Dining — Restaurants', 'AMX CC', 'Meals at Restaurant', 220.00, 'Client strategy lunch');
  push('2026-03-25', 'Credit Card Expense', 'Client Travel Dining', 'AMX CC', 'Travel Expense:Business Meals', 284.18, 'On-site client working dinner');
  push('2026-09-19', 'Credit Card Expense', 'Client Travel Dining', 'AMX CC', 'Travel Expense:Business Meals', 258.00, 'Travel business meal');
  push('2026-05-08', 'Credit Card Expense', 'Travel Solo Meals', 'Cap One CC', 'Solo Meals (50%)', 164.50, 'Travel per-diem meals');
  push('2026-08-12', 'Credit Card Expense', 'Travel Solo Meals', 'Cap One CC', 'Solo Meals (50%)', 148.00, 'Travel solo dinner');
  push('2026-07-15', 'Credit Card Expense', 'Travel Individual Meals', 'Cap One CC', 'Travel Expense:Individual Meals', 138.25, 'Out-of-town individual meals');
  push('2026-11-04', 'Credit Card Expense', 'Travel Individual Meals', 'Cap One CC', 'Travel Expense:Individual Meals', 128.25, 'Out-of-town individual meals');

  // --- 12. Office Expense ($7,862.31) ---
  push('2026-01-29', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 892.40, 'Office consumables & toner');
  push('2026-04-03', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1124.91, 'Filing & desk supplies');
  push('2026-07-21', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1285.00, 'Printing & shipping supplies');
  push('2026-10-29', 'Credit Card Expense', 'Amazon Business Supplies', 'Amazon CC', 'Office Supplies', 1085.00, 'Q4 office supplies');
  push('2026-06-04', 'Credit Card Expense', 'Apple Business Store', 'AMX CC', 'Office Equipment', 3475.00, 'Workstation laptop & 4K display (One-Time)');

  // --- 13. Insurance ($1,190.92) ---
  const insAmts = splitIntoInstallments(1190.92, 3);
  push('2026-03-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[0], 'Q1 E&O & General Liability');
  push('2026-06-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[1], 'Q2 E&O & General Liability');
  push('2026-09-15', 'Expense', 'Hiscox Business Insurance', 'BlueVine Checking', 'Insurance', -insAmts[2], 'Q3 E&O & General Liability');

  // --- 14. Utilities ($149.45) ---
  const utilAmts = splitIntoInstallments(149.45, 10);
  for (let m = 1; m <= 10; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-25`;
    push(dt, 'Expense', 'Southwest Office Utilities', 'BlueVine Checking', 'Utilities', -utilAmts[m - 1], 'Monthly office utility share');
  }

  // --- 15. Bank & Payroll Processing Fees ($1,032.99) ---
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-15`;
    push(dt, 'Expense', 'Gusto Payroll Processing', 'BlueVine Checking', 'Payroll Expenses', -80.00, 'Monthly payroll platform fee');
  }
  push('2026-03-31', 'Expense', 'BlueVine Wire & Service Fees', 'BlueVine Checking', 'Bank Service Charges', -75.00, 'Domestic wire fees');
  push('2026-09-30', 'Expense', 'BlueVine Wire & Service Fees', 'BlueVine Checking', 'Bank Service Charges', -77.99, 'Bank service charges');

  // --- 16. Other Deductions ($1,973.43) ---
  push('2026-05-20', 'Credit Card Expense', 'AICPA & CPE Annual Summit', 'Cap One CC', 'Continuing Education', 650.00, 'Annual continuing education (One-Time)');
  push('2026-04-30', 'Expense', 'Commercial Line Interest', 'BlueVine Checking', 'Interest Expense', -92.10, 'Short-term interest');
  push('2026-10-31', 'Expense', 'Commercial Line Interest', 'BlueVine Checking', 'Interest Expense', -92.10, 'Short-term interest');
  push('2026-03-06', 'Expense', 'Office Petty Cash', 'BlueVine Checking', 'Petty Cash', -145.00, 'Postage & office petty cash');
  push('2026-08-19', 'Expense', 'Office Petty Cash', 'BlueVine Checking', 'Petty Cash', -150.00, 'Local courier & petty cash');
  push('2026-02-04', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 281.41, 'Client document shipping');
  push('2026-06-26', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 298.60, 'Equipment return & shipping');
  push('2026-11-09', 'Credit Card Expense', 'FedEx & UPS Business', 'Amazon CC', 'Shipping', 264.22, 'Client binder courier');

  // --- 17. Credit Card Payments ---
  push('2026-03-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');
  push('2026-07-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');
  push('2026-10-20', 'Credit Card Payment', 'Amazon CC Payment', 'BlueVine Checking', 'Amazon CC', -1800.00, 'Autopay card balance');

  push('2026-04-18', 'Credit Card Payment', 'Cap One CC Payment', 'BlueVine Checking', 'Cap One CC', -2850.00, 'Card statement payoff');
  push('2026-09-18', 'Credit Card Payment', 'Cap One CC Payment', 'BlueVine Checking', 'Cap One CC', -2850.00, 'Card statement payoff');

  push('2026-06-24', 'Credit Card Payment', 'AMX CC Payment', 'BlueVine Checking', 'AMX CC', -4000.00, 'AMEX statement payment');
  push('2026-10-24', 'Credit Card Payment', 'AMX CC Payment', 'BlueVine Checking', 'AMX CC', -2000.00, 'AMEX statement payment');

  push('2026-08-05', 'Credit Card Payment', 'Amtrak Card Payment', 'BlueVine Checking', 'Amtrak', -84.56, 'Amtrak statement payment');

  // --- 18. Member Draws ($121,939.75) ---
  const drawInstallments = splitIntoInstallments(121939.75, 11);
  for (let m = 1; m <= 11; m++) {
    const dt = `2026-${String(m).padStart(2, '0')}-15`;
    push(dt, 'Check', 'Shareholder Distribution (Bill & Debra)', 'BlueVine Checking', 'Member Draws', -drawInstallments[m - 1], 'Monthly S-Corp member draw');
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
