import type {
  CadenceForecasterState,
  EntityType,
  MultiProfileStore,
  NewProfileOptions,
  PlannerState,
  PnlBalanceSheetState,
  PnlLineId,
  ProfileModuleFlags,
  SetupConfig,
  TaxProfileRecord,
  TaxYearRecord,
  WorkspaceProfileMode,
} from '../types/tax';
import {
  createInitialBaselineState,
  normalizePlannerState,
  reconcileDerivedPlannerState,
} from './baseline';
import {
  DEFAULT_EXP_SMOOTH_ALPHA,
  createInitialCadenceForecasterState,
  loadSavedPayeeAliases,
} from './cadenceEngine';
import { PNL_LINE_ITEMS } from './pnlBalanceSheet';
import { ALL_SCHEDULE_ITEM_IDS } from './scheduleCatalog';
import { createDefaultPersonProfile } from '../utils/personTax';
import {
  BLANK_USER_META,
  DEFAULT_PROFILE_SEED,
  TEST_PERSONA_META,
  createBlankUserPlannerState,
  createTestPersonaPlannerState,
  sanitizeDemoBaselineState,
} from '../data/profiles';

/** Dedicated isolated storage key for the user's real "My Profile" workspace (never overwritten by test modes) */
export const MY_PROFILE_STORAGE_KEY = 'rolling-tax-planner-my-profile-v1';
export const PROFILES_STORAGE_KEY = 'rolling-tax-planner-profiles-v1';
export const LEGACY_STATE_STORAGE_KEY = 'rolling-tax-planner-state-v7';
export const WORKSPACE_MODE_STORAGE_KEY = 'rolling-tax-planner-workspace-mode-v1';
export const TEST_PERSONA_STORAGE_KEY = 'rolling-tax-planner-test-persona-v1';
export const BLANK_USER_STORAGE_KEY = 'rolling-tax-planner-blank-user-v1';

export interface OptionalModuleDefinition {
  key: keyof ProfileModuleFlags;
  title: string;
  shortLabel: string;
  description: string;
}

export const OPTIONAL_PROFILE_MODULES: OptionalModuleDefinition[] = [
  {
    key: 'has_scorp',
    title: 'S-Corp / Business Cadence & P&L (Form 1120-S / Ledger Forecaster)',
    shortLabel: 'S-Corp / P&L',
    description:
      'Activates Transaction Cadence Forecast, Form 1120-S (including Schedule L & M-2), K-1 pass-through, and officer W-2 vs. distributions.',
  },
  {
    key: 'has_ss_medicare',
    title: 'Social Security & Medicare Planning',
    shortLabel: 'SS & Medicare',
    description:
      'Individual Social Security claiming, FRA-to-70 voluntary suspension (+8%/yr DRC), Medicare Parts A/B/D/Medigap, and IRMAA lookback.',
  },
  {
    key: 'has_dbp',
    title: 'Defined Benefit / Retirement Plan & Payables',
    shortLabel: 'DBP & Retirement',
    description:
      'Defined Benefit Plan actuarial contributions, termination & rollover scheduling, 401(k) profit-sharing caps, and retirement payables.',
  },
  {
    key: 'multi_state_active',
    title: 'Multi-State Apportionment',
    shortLabel: 'Multi-State',
    description:
      'Multi-state revenue sourcing, part-year interstate residency transitions, other-state tax credits, and PTE elections.',
  },
  {
    key: 'has_stock_basis',
    title: 'Shareholder Stock Basis (Form 7203)',
    shortLabel: 'Stock Basis (7203)',
    description:
      'Tracks beginning-to-ending shareholder stock basis, member draws vs. basis alerts, and Form 8949 excess distribution capital gain.',
  },
];

export function generateProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `prof-${crypto.randomUUID()}`;
  }
  return `prof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const PROFILE_SNAPSHOT_SCHEMA_VERSION = '3.0' as const;
export const PROFILE_SNAPSHOT_APP_ID = 'rolling-tax-planner' as const;

export interface ProfileSnapshotEnvelope {
  schemaVersion: typeof PROFILE_SNAPSHOT_SCHEMA_VERSION;
  exportedAt: string;
  app: typeof PROFILE_SNAPSHOT_APP_ID;
  profile: TaxProfileRecord;
}

export type SnapshotImportMode = 'new_profile' | 'overwrite_active';

export interface ParsedProfileImport {
  kind: 'single' | 'bundle';
  schemaVersion: string;
  exportedAt: string | null;
  profiles: TaxProfileRecord[];
}

export function sanitizeFilenameSegment(input: string, fallback = 'Tax_Profile'): string {
  const cleaned = input.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function sanitizeSnapshotSlug(input: string, fallback = 'tax-profile'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function buildProfileSnapshotFilename(
  profile: Pick<TaxProfileRecord, 'name' | 'entity_name'>,
  now: Date = new Date()
): string {
  const rawLabel = profile.name?.trim() || profile.entity_name?.trim() || '';
  const slug = sanitizeSnapshotSlug(rawLabel, 'tax-profile');
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${slug}-snapshot-${year}-${month}-${day}.json`;
}

export function getProfileEntitySummary(profile: TaxProfileRecord): string {
  const setup = profile.state.setup;
  if (setup.has_scorp) {
    return setup.entity_type === 'scorp_llc' ? 'S-Corp (1120-S)' : 'Business / 1120-S';
  }
  switch (setup.entity_type) {
    case 'sole_prop':
      return 'Schedule C / Sole Prop';
    case 'partnership':
      return 'Partnership (1065)';
    case 'ccorp':
      return 'C-Corp (1120)';
    default:
      return 'Form 1040 Core';
  }
}

export function getFilingStatusShortLabel(status: SetupConfig['filing_status']): string {
  switch (status) {
    case 'married_filing_jointly':
      return 'MFJ';
    case 'single':
      return 'Single';
    case 'head_of_household':
      return 'HOH';
    case 'married_filing_separately':
      return 'MFS';
  }
}

export function getActiveOptionalModules(setup: SetupConfig): OptionalModuleDefinition[] {
  return OPTIONAL_PROFILE_MODULES.filter((mod) => {
    if (mod.key === 'has_ss_medicare') {
      return setup.has_ss_medicare !== false;
    }
    if (mod.key === 'has_stock_basis') {
      return setup.has_stock_basis ?? setup.has_scorp;
    }
    if (mod.key === 'has_dbp') {
      return Boolean(setup.has_dbp || setup.has_401k_or_ira || setup.has_annuity);
    }
    if (mod.key === 'multi_state_active') {
      return Boolean(
        setup.multi_state_active || setup.residency_change_active || setup.has_pte
      );
    }
    return Boolean(setup[mod.key]);
  });
}

export function createBlankPnlBalanceSheetState(projectionYear: number): PnlBalanceSheetState {
  const pnl = {} as Record<PnlLineId, { ytd: number; remaining: number }>;
  for (const item of PNL_LINE_ITEMS) {
    pnl[item.id] = { ytd: 0, remaining: 0 };
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
      member_draws_remaining: 0,
      capital_contributions_ytd: 0,
      capital_contributions_remaining: 0,
      beginning_stock_basis_override: null,
    },
  };
}

export function createBlankCadenceForecasterState(projectionYear: number): CadenceForecasterState {
  return {
    projection_year: projectionYear,
    source_label: 'No transactions imported yet',
    ledger_format: 'transaction_list',
    as_of_date: `${projectionYear}-12-31`,
    exp_smooth_alpha: DEFAULT_EXP_SMOOTH_ALPHA,
    exp_smooth_day_fraction: false,
    payee_aliases: [],
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
      beginning_stock_basis_override: null,
    },
  };
}

function createCleanPersonProfile(): ReturnType<typeof createDefaultPersonProfile> {
  return {
    birth_date: '',
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
  };
}

function buildBlankTaxYearRecord(
  taxYear: number,
  isFirstYear: boolean,
  options: NewProfileOptions,
  entityId: string
): TaxYearRecord {
  const isJoint = options.filing_status === 'married_filing_jointly';
  const entityName = options.entity_name.trim();
  const entityEin = options.entity_ein.trim();

  return {
    tax_year: taxYear,
    record_mode: isFirstYear ? 'actuals' : 'forecast',
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
      health_insurance_premiums: 0,
      itemized_deductions_input: 0,
      deduction_method: 'standard',
    },
    scorp_1120s: {
      entity_id: entityId,
      entity_name: entityName,
      entity_ein: entityEin,
      bill_ownership_pct: isJoint ? 50 : 100,
      debra_ownership_pct: isJoint ? 50 : 0,
      ca_revenue: 0,
      az_revenue: 0,
      gross_receipts_revenue: 0,
      operating_expenses: 0,
      use_detailed_1120s_deductions: false,
      debra_w2_wages: 0,
      bill_w2_wages: 0,
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
      dbp_plan_id: `dbp-${entityId}`,
      dbp_status: options.modules.has_dbp ? 'active' : 'terminated',
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
  };
}

export function createBlankProfilePlannerState(options: NewProfileOptions): PlannerState {
  const currentTaxYear =
    Number.isFinite(options.tax_year) && options.tax_year >= 2020 && options.tax_year <= 2040
      ? Math.round(options.tax_year)
      : 2026;
  const anchorYear = currentTaxYear - 1;
  const forecastYears = [0, 1, 2, 3, 4, 5].map((offset) => anchorYear + offset);
  const entityType: EntityType = options.modules.has_scorp
    ? options.entity_type === 'none'
      ? 'scorp_llc'
      : options.entity_type
    : options.entity_type === 'scorp_llc'
    ? 'none'
    : options.entity_type;

  const setup: SetupConfig = {
    filing_status: options.filing_status,
    primary_name: options.primary_name.trim() || 'Primary',
    spouse_name:
      options.filing_status === 'married_filing_jointly'
        ? options.spouse_name.trim() || 'Spouse'
        : '',
    primary_birth_year: 1975,
    spouse_birth_year: options.filing_status === 'married_filing_jointly' ? 1975 : null,
    primary_profile: createCleanPersonProfile(),
    spouse_profile: createCleanPersonProfile(),
    business_name: options.entity_name.trim(),
    business_website: (options.entity_website ?? '').trim(),
    business_ein: options.entity_ein.trim(),
    home_state: '',
    secondary_state: '',
    workspace_profile_kind: 'custom',
    deduction_method: 'standard',
    custom_itemized_deduction: 30000,
    entity_type: entityType,
    has_scorp: options.modules.has_scorp,
    has_ss_medicare: options.modules.has_ss_medicare,
    has_stock_basis: options.modules.has_stock_basis,
    has_dbp: options.modules.has_dbp,
    dbp_planned_termination_year: null,
    post_dbp_profit_sharing_rate: 0.06,
    dbp_actuarial: {
      historical_high_3_w2: 0,
      boy_assets_anchor: 0,
      plan_year_anchor: 1,
      trust_growth_rate: 0,
      valuation_interest_rate: 0.05,
    },
    has_401k_or_ira: options.modules.has_dbp,
    has_annuity: false,
    has_pte: false,
    multi_state_active: options.modules.multi_state_active,
    residency_change_active: false,
    anchor_actuals_year: anchorYear,
    current_tax_year: currentTaxYear,
    forecast_length: 6,
    forecast_years: forecastYears,
    assumptions: {
      inflation_rate: 0.025,
      ss_cola_rate: 0.026,
      medicare_inflation_rate: 0.055,
      irmaa_threshold_growth_rate: 0.03,
      revenue_growth_rate: 0.03,
      wage_growth_rate: 0.025,
      investment_growth_rate: 0.035,
      expense_ratio: 0.2,
      opex_scaling_mode: 'revenue_proportional',
    },
    irmaa_threshold_overrides: {},
  };

  const entityId = `entity-${Date.now().toString(36)}`;
  const years = forecastYears.map((yr, idx) =>
    buildBlankTaxYearRecord(yr, idx === 0, options, entityId)
  );

  return {
    setup,
    years,
    archived_years: [],
    schedule_view: {
      preset: 'full',
      custom_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
      hidden_line_item_ids: [],
    },
    pnl_balance_sheet: createBlankPnlBalanceSheetState(currentTaxYear),
    cadence_forecaster: createBlankCadenceForecasterState(currentTaxYear),
  };
}

export function createProfileRecord(options: NewProfileOptions): TaxProfileRecord {
  const now = new Date().toISOString();
  const cleanName = options.name.trim() || 'Untitled Tax Profile';
  const cleanEntityName = options.entity_name.trim();
  const cleanEntityEin = options.entity_ein.trim();

  let state: PlannerState;
  if (options.template === 'sample_oss') {
    const base = createInitialBaselineState();
    state = sanitizeDemoBaselineState(base, options, cleanEntityName, cleanEntityEin);
  } else {
    state = createBlankProfilePlannerState({
      ...options,
      name: cleanName,
      entity_name: cleanEntityName,
      entity_ein: cleanEntityEin,
    });
  }

  return {
    id: generateProfileId(),
    name: cleanName,
    entity_name: cleanEntityName,
    entity_ein: cleanEntityEin,
    notes: options.notes?.trim() || '',
    created_at: now,
    updated_at: now,
    state: normalizePlannerState(state),
  };
}

function buildDefaultSeedProfile(
  migratedState?: PlannerState,
  legacyAliases?: ReturnType<typeof loadSavedPayeeAliases>
): TaxProfileRecord {
  const now = new Date().toISOString();
  const base = migratedState ? normalizePlannerState(migratedState) : createInitialBaselineState();

  if (!base.cadence_forecaster) {
    base.cadence_forecaster = createInitialCadenceForecasterState(0, legacyAliases ?? [], base.setup);
  } else if (base.cadence_forecaster.payee_aliases === undefined) {
    base.cadence_forecaster = {
      ...base.cadence_forecaster,
      payee_aliases: legacyAliases ?? [],
    };
  }

  const firstEntityName =
    base.setup.business_name?.trim() ||
    base.years[0]?.scorp_1120s.entity_name ||
    DEFAULT_PROFILE_SEED.business_name;
  const firstEntityEin =
    base.setup.business_ein?.trim() ||
    base.years[0]?.scorp_1120s.entity_ein ||
    DEFAULT_PROFILE_SEED.business_ein;
  const primary = base.setup.primary_name?.trim() || 'Primary';
  const spouse = base.setup.spouse_name?.trim() || '';
  const label =
    base.setup.has_scorp && firstEntityName
      ? `${firstEntityName} (${primary}${spouse ? ` & ${spouse}` : ''})`
      : `${primary}${spouse ? ` & ${spouse}` : ''} Tax Plan`;

  return {
    id: generateProfileId(),
    name: label,
    entity_name: firstEntityName,
    entity_ein: firstEntityEin,
    notes: 'Default primary profile',
    created_at: now,
    updated_at: now,
    state: base,
  };
}

function finiteNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function migrateTaxYearForV3(yr: TaxYearRecord, setup: SetupConfig): TaxYearRecord {
  const taxYear = finiteNum(yr.tax_year, setup.current_tax_year || 2026);
  const rawF = (yr.form_1040 ?? {}) as Partial<TaxYearRecord['form_1040']>;
  const rawS = (yr.scorp_1120s ?? {}) as Partial<TaxYearRecord['scorp_1120s']>;
  const rawD = (yr.dbp_and_retirement ?? {}) as Partial<TaxYearRecord['dbp_and_retirement']>;
  const rawStates = Array.isArray(yr.state_filings) ? yr.state_filings : [];

  const safeForm1040: TaxYearRecord['form_1040'] = {
    ...rawF,
    w2_wages_total: finiteNum(rawF.w2_wages_total, 0),
    use_explicit_w2_box1: rawF.use_explicit_w2_box1 ?? false,
    taxable_interest: finiteNum(rawF.taxable_interest, 0),
    tax_exempt_interest: finiteNum(rawF.tax_exempt_interest, 0),
    ordinary_dividends: finiteNum(rawF.ordinary_dividends, 0),
    qualified_dividends: finiteNum(rawF.qualified_dividends, 0),
    short_term_capital_gain_loss: finiteNum(rawF.short_term_capital_gain_loss, 0),
    long_term_capital_gain_loss: finiteNum(rawF.long_term_capital_gain_loss, 0),
    schedule_d_includes_excess_gain: rawF.schedule_d_includes_excess_gain ?? false,
    schedule_1_other_income: finiteNum(rawF.schedule_1_other_income, 0),
    schedule_k1_ordinary_income: finiteNum(rawF.schedule_k1_ordinary_income, 0),
    schedule_k1_other_items: finiteNum(rawF.schedule_k1_other_items, 0),
    ira_distributions_gross: finiteNum(rawF.ira_distributions_gross, 0),
    ira_distributions_taxable: finiteNum(rawF.ira_distributions_taxable, 0),
    pensions_and_annuities_gross: finiteNum(rawF.pensions_and_annuities_gross, 0),
    pensions_and_annuities_taxable: finiteNum(rawF.pensions_and_annuities_taxable, 0),
    social_security_gross: finiteNum(rawF.social_security_gross, 0),
    health_insurance_premiums: finiteNum(rawF.health_insurance_premiums, 0),
    schedule_1_adjustments_input: finiteNum(rawF.schedule_1_adjustments_input, 0),
    deduction_method: rawF.deduction_method === 'itemized' ? 'itemized' : 'standard',
    itemized_deductions_input: finiteNum(rawF.itemized_deductions_input, 0),
    federal_tax_withholding:
      rawF.federal_tax_withholding !== undefined
        ? finiteNum(rawF.federal_tax_withholding, 0)
        : undefined,
    federal_estimated_tax_payments:
      rawF.federal_estimated_tax_payments !== undefined
        ? finiteNum(rawF.federal_estimated_tax_payments, 0)
        : undefined,
    unallocated_state_tax_payments:
      rawF.unallocated_state_tax_payments !== undefined
        ? finiteNum(rawF.unallocated_state_tax_payments, 0)
        : undefined,
  };

  const grossRev = finiteNum(rawS.gross_receipts_revenue, 0);
  const hasExplicitCaRev = typeof rawS.ca_revenue === 'number' && Number.isFinite(rawS.ca_revenue);
  const hasExplicitAzRev = typeof rawS.az_revenue === 'number' && Number.isFinite(rawS.az_revenue);
  const firstAppFactor =
    Array.isArray(rawStates) &&
    typeof rawStates[0]?.state_apportionment_factor === 'number' &&
    Number.isFinite(rawStates[0].state_apportionment_factor)
      ? Math.min(1, Math.max(0, rawStates[0].state_apportionment_factor))
      : 1;
  const migratedCaRev =
    hasExplicitCaRev && hasExplicitAzRev
      ? rawS.ca_revenue!
      : Math.round(grossRev * firstAppFactor);
  const migratedAzRev =
    hasExplicitCaRev && hasExplicitAzRev
      ? rawS.az_revenue!
      : Math.max(0, grossRev - migratedCaRev);

  const officerW2 = finiteNum(rawS.officer_w2_wages, 0);
  const hasExplicitBillW2 =
    typeof rawS.bill_w2_wages === 'number' && Number.isFinite(rawS.bill_w2_wages);
  const hasExplicitDebraW2 =
    typeof rawS.debra_w2_wages === 'number' && Number.isFinite(rawS.debra_w2_wages);
  const migratedBillW2 =
    hasExplicitBillW2 && hasExplicitDebraW2 ? rawS.bill_w2_wages! : Math.round(officerW2 * 0.5);
  const migratedDebraW2 =
    hasExplicitBillW2 && hasExplicitDebraW2
      ? rawS.debra_w2_wages!
      : Math.max(0, officerW2 - migratedBillW2);

  const safeScorp: TaxYearRecord['scorp_1120s'] = {
    ...rawS,
    entity_id: typeof rawS.entity_id === 'string' && rawS.entity_id ? rawS.entity_id : 'entity-1',
    entity_name: typeof rawS.entity_name === 'string' ? rawS.entity_name : setup.business_name ?? '',
    entity_ein: typeof rawS.entity_ein === 'string' ? rawS.entity_ein : setup.business_ein ?? '',
    gross_receipts_revenue: migratedCaRev + migratedAzRev,
    ca_revenue: migratedCaRev,
    az_revenue: migratedAzRev,
    operating_expenses: finiteNum(rawS.operating_expenses, 0),
    officer_w2_wages: migratedBillW2 + migratedDebraW2,
    debra_w2_wages: migratedDebraW2,
    bill_w2_wages: migratedBillW2,
    scorp_distributions_total: finiteNum(rawS.scorp_distributions_total, 0),
    capital_contributions: finiteNum(rawS.capital_contributions, 0),
    schedule_k_interest_income: finiteNum(rawS.schedule_k_interest_income, 0),
    schedule_k_nondeductible_expenses: finiteNum(rawS.schedule_k_nondeductible_expenses, 0),
    stock_basis_beginning: finiteNum(rawS.stock_basis_beginning, 0),
    aaa_balance_beginning: finiteNum(rawS.aaa_balance_beginning, 0),
    pte_election_active: Boolean(rawS.pte_election_active),
    state_sourcing_breakdown: Array.isArray(rawS.state_sourcing_breakdown)
      ? rawS.state_sourcing_breakdown.map((row) => ({
          state_code: typeof row?.state_code === 'string' ? row.state_code : '',
          apportionment_percent: finiteNum(row?.apportionment_percent, 0),
        }))
      : [],
    auto_sync_k1: rawS.auto_sync_k1 ?? true,
  };

  const safeDbpStatus =
    rawD.dbp_status === 'active' ||
    rawD.dbp_status === 'terminating' ||
    rawD.dbp_status === 'terminated' ||
    rawD.dbp_status === 'frozen'
      ? rawD.dbp_status
      : 'terminated';

  const safeDbp: TaxYearRecord['dbp_and_retirement'] = {
    ...rawD,
    dbp_plan_id:
      typeof rawD.dbp_plan_id === 'string' && rawD.dbp_plan_id ? rawD.dbp_plan_id : 'dbp-1',
    dbp_status: safeDbpStatus,
    dbp_target_termination_year: finiteNum(rawD.dbp_target_termination_year, 2099),
    dbp_max_deductible_contribution: finiteNum(rawD.dbp_max_deductible_contribution, 0),
    dbp_actual_contribution: finiteNum(rawD.dbp_actual_contribution, 0),
    dbp_rollover_target_account:
      typeof rawD.dbp_rollover_target_account === 'string'
        ? rawD.dbp_rollover_target_account
        : 'Traditional IRA Rollover',
    dbp_loan_balance: finiteNum(rawD.dbp_loan_balance, 0),
    dbp_collateral_requirement: finiteNum(rawD.dbp_collateral_requirement, 0),
    qualified_plan_contribution: finiteNum(rawD.qualified_plan_contribution, 0),
    rollover_amount: finiteNum(rawD.rollover_amount, 0),
    rollover_source_type:
      typeof rawD.rollover_source_type === 'string' ? rawD.rollover_source_type : 'None',
    annuity_contract_value: finiteNum(rawD.annuity_contract_value, 0),
    annuity_payout_amount: finiteNum(rawD.annuity_payout_amount, 0),
  };

  const safeStates = rawStates.map((sf) => ({
    ...sf,
    state_code: typeof sf.state_code === 'string' ? sf.state_code.toUpperCase() : '',
    residency_status:
      sf.residency_status === 'resident' ||
      sf.residency_status === 'part_year_resident' ||
      sf.residency_status === 'non_resident'
        ? sf.residency_status
        : ('resident' as const),
    residency_start_date:
      typeof sf.residency_start_date === 'string'
        ? sf.residency_start_date
        : `${taxYear}-01-01`,
    residency_end_date:
      typeof sf.residency_end_date === 'string' ? sf.residency_end_date : `${taxYear}-12-31`,
    residency_day_or_income_ratio: Math.min(
      1,
      Math.max(0, finiteNum(sf.residency_day_or_income_ratio, 1))
    ),
    state_return_type:
      typeof sf.state_return_type === 'string'
        ? sf.state_return_type
        : `${sf.state_code || 'State'} Return`,
    state_apportionment_factor: Math.min(
      1,
      Math.max(0, finiteNum(sf.state_apportionment_factor, 0))
    ),
    state_pte_elected: Boolean(sf.state_pte_elected),
    other_state_credits_claimed: finiteNum(sf.other_state_credits_claimed, 0),
    state_tax_withholding_and_estimates: finiteNum(sf.state_tax_withholding_and_estimates, 0),
    state_conformity_adjustment:
      sf.state_conformity_adjustment !== undefined
        ? finiteNum(sf.state_conformity_adjustment, 0)
        : undefined,
  }));

  const syncedScorp: TaxYearRecord['scorp_1120s'] = {
    ...safeScorp,
    pte_election_active: safeStates.some((sf) => Boolean(sf.state_pte_elected)),
  };

  return {
    ...yr,
    tax_year: taxYear,
    record_mode: yr.record_mode === 'actuals' ? 'actuals' : 'forecast',
    is_locked_actuals: Boolean(yr.is_locked_actuals),
    form_1040: safeForm1040,
    scorp_1120s: syncedScorp,
    dbp_and_retirement: safeDbp,
    state_filings: safeStates,
  };
}

function normalizeProfileRecord(raw: TaxProfileRecord): TaxProfileRecord {
  const preMigratedYears = Array.isArray(raw.state?.years)
    ? raw.state.years.map((yr) => migrateTaxYearForV3(yr, raw.state.setup))
    : [];
  const normalizedState = normalizePlannerState({
    ...raw.state,
    years: preMigratedYears,
    archived_years: Array.isArray(raw.state?.archived_years) ? raw.state.archived_years : [],
    planning_goals: Array.isArray(raw.state?.planning_goals) ? raw.state.planning_goals : undefined,
    guardrail_acknowledgments:
      raw.state?.guardrail_acknowledgments &&
      typeof raw.state.guardrail_acknowledgments === 'object'
        ? raw.state.guardrail_acknowledgments
        : {},
  });
  const yearProj =
    normalizedState.setup.current_tax_year ?? normalizedState.setup.forecast_years[1] ?? 2026;
  if (!normalizedState.cadence_forecaster) {
    normalizedState.cadence_forecaster = createBlankCadenceForecasterState(yearProj);
  } else if (!Array.isArray(normalizedState.cadence_forecaster.payee_aliases)) {
    normalizedState.cadence_forecaster = {
      ...normalizedState.cadence_forecaster,
      payee_aliases: [],
    };
  }

  const entityName =
    typeof raw.entity_name === 'string'
      ? raw.entity_name.trim()
      : (normalizedState.setup.business_name?.trim() ??
          normalizedState.years[0]?.scorp_1120s.entity_name?.trim() ??
          '');
  const entityEin =
    typeof raw.entity_ein === 'string'
      ? raw.entity_ein.trim()
      : (normalizedState.setup.business_ein?.trim() ??
          normalizedState.years[0]?.scorp_1120s.entity_ein?.trim() ??
          '');

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateProfileId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : entityName || 'Tax Profile',
    entity_name: entityName,
    entity_ein: entityEin,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
    state: normalizedState,
  };
}

export function loadMultiProfileStore(): MultiProfileStore {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Dedicated My Profile key takes precedence; falls back seamlessly to prior PROFILES_STORAGE_KEY
      const savedProfilesRaw =
        window.localStorage.getItem(MY_PROFILE_STORAGE_KEY) ||
        window.localStorage.getItem(PROFILES_STORAGE_KEY);
      if (savedProfilesRaw) {
        const parsed = JSON.parse(savedProfilesRaw) as Partial<MultiProfileStore>;
        if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          const profiles = parsed.profiles
            .filter(
              (p): p is TaxProfileRecord =>
                Boolean(p && p.state && p.state.setup && Array.isArray(p.state.years))
            )
            .map(normalizeProfileRecord);
          if (profiles.length > 0) {
            const activeExists = profiles.some((p) => p.id === parsed.active_profile_id);
            return {
              version: 1,
              active_profile_id: activeExists
                ? (parsed.active_profile_id as string)
                : profiles[0].id,
              profiles,
            };
          }
        }
      }

      // One-time seamless migration from legacy single-profile localStorage state
      const legacyRaw = window.localStorage.getItem(LEGACY_STATE_STORAGE_KEY);
      const legacyAliases = loadSavedPayeeAliases();
      if (legacyRaw) {
        const parsedLegacy = JSON.parse(legacyRaw) as PlannerState;
        if (parsedLegacy?.setup && Array.isArray(parsedLegacy.years) && parsedLegacy.years.length > 0) {
          const migrated = buildDefaultSeedProfile(parsedLegacy, legacyAliases);
          return {
            version: 1,
            active_profile_id: migrated.id,
            profiles: [migrated],
          };
        }
      }

      const initialProfile = buildDefaultSeedProfile(undefined, legacyAliases);
      return {
        version: 1,
        active_profile_id: initialProfile.id,
        profiles: [initialProfile],
      };
    }
  } catch {
    // Fallback cleanly to default baseline profile
  }

  const fallback = buildDefaultSeedProfile();
  return {
    version: 1,
    active_profile_id: fallback.id,
    profiles: [fallback],
  };
}

export function saveMultiProfileStore(store: MultiProfileStore): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const payload = JSON.stringify(store);
      window.localStorage.setItem(MY_PROFILE_STORAGE_KEY, payload);
      window.localStorage.setItem(PROFILES_STORAGE_KEY, payload);
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function loadWorkspaceProfileMode(): WorkspaceProfileMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY);
      if (saved === 'my_profile' || saved === 'test_persona' || saved === 'blank_user') {
        return saved;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return 'my_profile';
}

export function saveWorkspaceProfileMode(mode: WorkspaceProfileMode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function buildFreshTestPersonaRecord(): TaxProfileRecord {
  const now = new Date().toISOString();
  const state = normalizePlannerState(createTestPersonaPlannerState(ALL_SCHEDULE_ITEM_IDS));
  return {
    id: TEST_PERSONA_META.id,
    name: TEST_PERSONA_META.name,
    entity_name: TEST_PERSONA_META.entity_name,
    entity_ein: TEST_PERSONA_META.entity_ein,
    notes: TEST_PERSONA_META.notes,
    created_at: now,
    updated_at: now,
    state,
  };
}

export function buildFreshBlankUserRecord(): TaxProfileRecord {
  const now = new Date().toISOString();
  const state = normalizePlannerState(createBlankUserPlannerState(ALL_SCHEDULE_ITEM_IDS));
  return {
    id: BLANK_USER_META.id,
    name: BLANK_USER_META.name,
    entity_name: BLANK_USER_META.entity_name,
    entity_ein: BLANK_USER_META.entity_ein,
    notes: BLANK_USER_META.notes,
    created_at: now,
    updated_at: now,
    state,
  };
}

export function loadIsolatedSandboxProfile(mode: 'test_persona' | 'blank_user'): TaxProfileRecord {
  const key = mode === 'test_persona' ? TEST_PERSONA_STORAGE_KEY : BLANK_USER_STORAGE_KEY;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TaxProfileRecord>;
        if (parsed?.state?.setup && Array.isArray(parsed.state.years) && parsed.state.years.length > 0) {
          return normalizeProfileRecord(parsed as TaxProfileRecord);
        }
      }
    }
  } catch {
    // Fall back cleanly to fresh template
  }
  return mode === 'test_persona' ? buildFreshTestPersonaRecord() : buildFreshBlankUserRecord();
}

export function saveIsolatedSandboxProfile(
  mode: 'test_persona' | 'blank_user',
  record: TaxProfileRecord
): void {
  const key = mode === 'test_persona' ? TEST_PERSONA_STORAGE_KEY : BLANK_USER_STORAGE_KEY;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(record));
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function getActiveProfile(store: MultiProfileStore): TaxProfileRecord {
  return (
    store.profiles.find((p) => p.id === store.active_profile_id) ?? store.profiles[0]
  );
}

export function addProfileToStore(
  store: MultiProfileStore,
  options: NewProfileOptions
): MultiProfileStore {
  const created = createProfileRecord(options);
  return {
    version: 1,
    active_profile_id: created.id,
    profiles: [...store.profiles, created],
  };
}

export function switchActiveProfileInStore(
  store: MultiProfileStore,
  profileId: string
): MultiProfileStore {
  if (!store.profiles.some((p) => p.id === profileId)) return store;
  return {
    ...store,
    active_profile_id: profileId,
  };
}

export function updateActiveProfileStateInStore(
  store: MultiProfileStore,
  updater: (prev: PlannerState) => PlannerState
): MultiProfileStore {
  const now = new Date().toISOString();
  return {
    ...store,
    profiles: store.profiles.map((profile) => {
      if (profile.id !== store.active_profile_id) return profile;
      const nextState = updater(profile.state);
      const nextEntityName =
        typeof nextState.setup.business_name === 'string'
          ? nextState.setup.business_name.trim()
          : (nextState.years[0]?.scorp_1120s.entity_name?.trim() ?? profile.entity_name);
      const nextEntityEin =
        typeof nextState.setup.business_ein === 'string'
          ? nextState.setup.business_ein.trim()
          : (nextState.years[0]?.scorp_1120s.entity_ein?.trim() ?? profile.entity_ein);
      return {
        ...profile,
        entity_name: nextEntityName,
        entity_ein: nextEntityEin,
        updated_at: now,
        state: nextState,
      };
    }),
  };
}

export function renameProfileInStore(
  store: MultiProfileStore,
  profileId: string,
  updates: { name: string; entity_name?: string; entity_ein?: string; notes?: string }
): MultiProfileStore {
  const now = new Date().toISOString();
  const cleanName = updates.name.trim();
  if (!cleanName) return store;

  return {
    ...store,
    profiles: store.profiles.map((profile) => {
      if (profile.id !== profileId) return profile;
      const nextEntityName =
        updates.entity_name !== undefined ? updates.entity_name.trim() : profile.entity_name;
      const nextEntityEin =
        updates.entity_ein !== undefined ? updates.entity_ein.trim() : profile.entity_ein;
      const nextNotes = updates.notes !== undefined ? updates.notes.trim() : profile.notes;

      const syncedYears = profile.state.years.map((yr) => ({
        ...yr,
        scorp_1120s: {
          ...yr.scorp_1120s,
          entity_name: nextEntityName,
          entity_ein: nextEntityEin,
        },
      }));

      return {
        ...profile,
        name: cleanName,
        entity_name: nextEntityName,
        entity_ein: nextEntityEin,
        notes: nextNotes,
        updated_at: now,
        state: {
          ...profile.state,
          setup: {
            ...profile.state.setup,
            business_name: nextEntityName,
            business_ein: nextEntityEin,
          },
          years: syncedYears,
        },
      };
    }),
  };
}

export function duplicateProfileInStore(
  store: MultiProfileStore,
  profileId: string,
  customName?: string,
  switchToCopy = true
): MultiProfileStore {
  const source = store.profiles.find((p) => p.id === profileId);
  if (!source) return store;

  const now = new Date().toISOString();
  const existingNames = new Set(store.profiles.map((p) => p.name.toLowerCase()));
  let copyName = customName?.trim() || `${source.name} (Copy)`;
  let suffix = 2;
  while (existingNames.has(copyName.toLowerCase())) {
    copyName = `${source.name} (Copy ${suffix})`;
    suffix++;
  }

  const duplicated: TaxProfileRecord = {
    id: generateProfileId(),
    name: copyName,
    entity_name: source.entity_name,
    entity_ein: source.entity_ein,
    notes: source.notes,
    created_at: now,
    updated_at: now,
    state: deepClone(source.state),
  };

  return {
    version: 1,
    active_profile_id: switchToCopy ? duplicated.id : store.active_profile_id,
    profiles: [...store.profiles, duplicated],
  };
}

export function deleteProfileFromStore(
  store: MultiProfileStore,
  profileId: string
): MultiProfileStore {
  const remaining = store.profiles.filter((p) => p.id !== profileId);
  if (remaining.length === 0) {
    const fresh = createProfileRecord({
      name: 'Personal Form 1040 Profile',
      filing_status: 'married_filing_jointly',
      primary_name: 'Primary',
      spouse_name: 'Spouse',
      tax_year: 2026,
      entity_type: 'none',
      entity_name: 'Personal Household',
      entity_ein: '',
      template: 'blank',
      modules: {
        has_scorp: false,
        has_ss_medicare: false,
        has_dbp: false,
        multi_state_active: false,
        has_stock_basis: false,
      },
    });
    return {
      version: 1,
      active_profile_id: fresh.id,
      profiles: [fresh],
    };
  }

  const nextActive =
    store.active_profile_id === profileId ? remaining[0].id : store.active_profile_id;
  return {
    version: 1,
    active_profile_id: nextActive,
    profiles: remaining,
  };
}

export function serializeSingleProfileBackup(
  profile: TaxProfileRecord,
  exportedAt: string = new Date().toISOString()
): string {
  const cloned = deepClone(profile);
  const reconciledProfile: TaxProfileRecord = {
    ...cloned,
    state: reconcileDerivedPlannerState(cloned.state),
  };
  const envelope: ProfileSnapshotEnvelope = {
    schemaVersion: PROFILE_SNAPSHOT_SCHEMA_VERSION,
    exportedAt,
    app: PROFILE_SNAPSHOT_APP_ID,
    profile: reconciledProfile,
  };
  return JSON.stringify(envelope, null, 2);
}

export const serializeProfileSnapshot = serializeSingleProfileBackup;

export function serializeAllProfilesBackup(store: MultiProfileStore): string {
  const reconciledProfiles = store.profiles.map((p) => {
    const cloned = deepClone(p);
    return {
      ...cloned,
      state: reconcileDerivedPlannerState(cloned.state),
    };
  });
  return JSON.stringify(
    {
      schemaVersion: PROFILE_SNAPSHOT_SCHEMA_VERSION,
      app: PROFILE_SNAPSHOT_APP_ID,
      format: 'rolling-tax-planner-backup-v1',
      exportedAt: new Date().toISOString(),
      exported_at: new Date().toISOString(),
      active_profile_id: store.active_profile_id,
      profiles: reconciledProfiles,
    },
    null,
    2
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validatePlannerStateShape(candidate: unknown): candidate is PlannerState {
  if (!isPlainRecord(candidate)) return false;
  if (!isPlainRecord(candidate.setup)) return false;
  if (!Array.isArray(candidate.years) || candidate.years.length === 0) return false;
  for (const yr of candidate.years) {
    if (!isPlainRecord(yr)) return false;
    if (typeof yr.tax_year !== 'number' || !Number.isFinite(yr.tax_year)) return false;
    if (!isPlainRecord(yr.form_1040)) return false;
    if (!isPlainRecord(yr.scorp_1120s)) return false;
    if (!isPlainRecord(yr.dbp_and_retirement)) return false;
  }
  return true;
}

export function parseAndValidateProfileSnapshot(rawText: string): ParsedProfileImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      'Malformed JSON file: please select a valid Rolling Tax Planner .json snapshot.'
    );
  }

  if (!isPlainRecord(parsed)) {
    throw new Error(
      'Invalid snapshot file: expected a JSON object exported from Rolling Tax Planner.'
    );
  }

  if (parsed.app !== undefined && parsed.app !== PROFILE_SNAPSHOT_APP_ID) {
    throw new Error(
      `Incompatible snapshot file: expected app "${PROFILE_SNAPSHOT_APP_ID}", received "${String(parsed.app)}".`
    );
  }

  const schemaVersion =
    typeof parsed.schemaVersion === 'string' && parsed.schemaVersion.trim()
      ? parsed.schemaVersion.trim()
      : typeof parsed.format === 'string'
      ? parsed.format
      : 'legacy';

  const exportedAt =
    typeof parsed.exportedAt === 'string'
      ? parsed.exportedAt
      : typeof parsed.exported_at === 'string'
      ? parsed.exported_at
      : null;

  const now = new Date().toISOString();
  const normalizedProfiles: TaxProfileRecord[] = [];

  // Format 1: Multi-profile backup bundle
  if (Array.isArray(parsed.profiles)) {
    for (const rawProf of parsed.profiles) {
      if (!isPlainRecord(rawProf) || !validatePlannerStateShape(rawProf.state)) {
        continue;
      }
      normalizedProfiles.push(normalizeProfileRecord(rawProf as unknown as TaxProfileRecord));
    }
    if (normalizedProfiles.length === 0) {
      throw new Error(
        'Invalid backup bundle: no valid profiles with required setup and multi-year schedules were found.'
      );
    }
    return {
      kind: 'bundle',
      schemaVersion,
      exportedAt,
      profiles: normalizedProfiles,
    };
  }

  // Format 2: V3 Profile Snapshot envelope or v1 single-profile backup ({ schemaVersion, app, profile })
  if (isPlainRecord(parsed.profile)) {
    if (!validatePlannerStateShape(parsed.profile.state)) {
      throw new Error(
        'Invalid profile snapshot: missing required profile setup or multi-year tax schedules.'
      );
    }
    normalizedProfiles.push(normalizeProfileRecord(parsed.profile as unknown as TaxProfileRecord));
    return {
      kind: 'single',
      schemaVersion,
      exportedAt,
      profiles: normalizedProfiles,
    };
  }

  // Format 3: Raw TaxProfileRecord object ({ id, name, state: { setup, years } })
  if (validatePlannerStateShape(parsed.state)) {
    normalizedProfiles.push(normalizeProfileRecord(parsed as unknown as TaxProfileRecord));
    return {
      kind: 'single',
      schemaVersion,
      exportedAt,
      profiles: normalizedProfiles,
    };
  }

  // Format 4: Raw PlannerState export ({ setup, years })
  if (validatePlannerStateShape(parsed)) {
    const plannerState = normalizePlannerState(parsed as unknown as PlannerState);
    const entityName =
      plannerState.setup.business_name?.trim() ||
      plannerState.years[0]?.scorp_1120s.entity_name?.trim() ||
      '';
    const entityEin =
      plannerState.setup.business_ein?.trim() ||
      plannerState.years[0]?.scorp_1120s.entity_ein?.trim() ||
      '';
    const primaryLabel = plannerState.setup.primary_name?.trim() || 'Imported Profile';
    const profileName =
      plannerState.setup.has_scorp && entityName
        ? `${entityName} (${primaryLabel})`
        : `${primaryLabel}${
            plannerState.setup.spouse_name?.trim()
              ? ` & ${plannerState.setup.spouse_name.trim()}`
              : ''
          } (${plannerState.setup.current_tax_year})`;

    normalizedProfiles.push(
      normalizeProfileRecord({
        id: generateProfileId(),
        name: profileName,
        entity_name: entityName,
        entity_ein: entityEin,
        notes: 'Imported from JSON snapshot',
        created_at: now,
        updated_at: now,
        state: plannerState,
      })
    );
    return {
      kind: 'single',
      schemaVersion,
      exportedAt,
      profiles: normalizedProfiles,
    };
  }

  throw new Error(
    'Unrecognized JSON snapshot: expected a Rolling Tax Planner v3.0 profile snapshot or backup file.'
  );
}

export interface ImportProfilesResult {
  nextStore: MultiProfileStore;
  importedCount: number;
  importedNames: string[];
  mode: SnapshotImportMode;
}

export function applyImportedSnapshotToStore(
  parsed: ParsedProfileImport,
  existingStore: MultiProfileStore,
  mode: SnapshotImportMode = 'new_profile',
  targetProfileId?: string
): ImportProfilesResult {
  const now = new Date().toISOString();

  // Overwrite mode applies strictly to single-profile snapshots and keeps target profile ID intact
  if (mode === 'overwrite_active' && parsed.profiles.length === 1) {
    const targetId = targetProfileId || existingStore.active_profile_id;
    const incoming = deepClone(parsed.profiles[0]);
    const targetExists = existingStore.profiles.some((p) => p.id === targetId);
    if (targetExists) {
      const nextProfiles = existingStore.profiles.map((existing) =>
        existing.id === targetId
          ? {
              ...incoming,
              id: existing.id,
              created_at: existing.created_at,
              updated_at: now,
            }
          : existing
      );
      return {
        nextStore: {
          version: 1,
          active_profile_id: targetId,
          profiles: nextProfiles,
        },
        importedCount: 1,
        importedNames: [incoming.name],
        mode: 'overwrite_active',
      };
    }
  }

  // Default safe mode: Import as New Profile(s) with freshly minted unique IDs (never clobbers existing profiles)
  const existingIds = new Set(existingStore.profiles.map((p) => p.id));
  const mintUniqueId = (): string => {
    let candidate = generateProfileId();
    while (existingIds.has(candidate)) {
      candidate = generateProfileId();
    }
    existingIds.add(candidate);
    return candidate;
  };

  const importedRecords: TaxProfileRecord[] = parsed.profiles.map((rec) => {
    const cloned = deepClone(rec);
    return {
      ...cloned,
      id: mintUniqueId(),
      updated_at: now,
    };
  });

  return {
    nextStore: {
      version: 1,
      active_profile_id: importedRecords[0].id,
      profiles: [...existingStore.profiles, ...importedRecords],
    },
    importedCount: importedRecords.length,
    importedNames: importedRecords.map((p) => p.name),
    mode: 'new_profile',
  };
}

export function importProfilesFromJson(
  rawText: string,
  existingStore: MultiProfileStore,
  mode: SnapshotImportMode = 'new_profile',
  targetProfileId?: string
): ImportProfilesResult {
  const parsed = parseAndValidateProfileSnapshot(rawText);
  return applyImportedSnapshotToStore(parsed, existingStore, mode, targetProfileId);
}
