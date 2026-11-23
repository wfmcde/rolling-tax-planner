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
import { createInitialBaselineState, normalizePlannerState } from './baseline';
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
      'Activates P&L & Balance Sheet, Transaction Cadence Forecaster, Form 1120-S, K-1 pass-through, and officer W-2 vs. distributions.',
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

export function sanitizeFilenameSegment(input: string, fallback = 'Tax_Profile'): string {
  const cleaned = input.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
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
  const entityName = options.entity_name.trim() || options.name.trim() || 'Business Entity';
  const entityEin = options.entity_ein.trim() || '00-0000000';

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
    business_website: '',
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
  const cleanEntityName =
    options.entity_name.trim() ||
    (options.modules.has_scorp ? cleanName : `${options.primary_name.trim() || 'Household'} Personal`);
  const cleanEntityEin = options.entity_ein.trim() || (options.modules.has_scorp ? '00-0000000' : '');

  let state: PlannerState;
  if (options.template === 'sample_oss') {
    const base = createInitialBaselineState();
    base.cadence_forecaster = createInitialCadenceForecasterState(0, [], base.setup);
    state = {
      ...base,
      setup: {
        ...base.setup,
        filing_status: options.filing_status,
        primary_name: options.primary_name.trim() || base.setup.primary_name,
        spouse_name:
          options.filing_status === 'married_filing_jointly'
            ? options.spouse_name.trim() || base.setup.spouse_name
            : '',
        has_scorp: options.modules.has_scorp,
        has_ss_medicare: options.modules.has_ss_medicare,
        has_dbp: options.modules.has_dbp,
        multi_state_active: options.modules.multi_state_active,
        has_stock_basis: options.modules.has_stock_basis,
        entity_type: options.modules.has_scorp ? 'scorp_llc' : 'none',
      },
      years: base.years.map((yr) => ({
        ...yr,
        scorp_1120s: {
          ...yr.scorp_1120s,
          entity_name: cleanEntityName || yr.scorp_1120s.entity_name,
          entity_ein: cleanEntityEin || yr.scorp_1120s.entity_ein,
        },
      })),
    };
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

function normalizeProfileRecord(raw: TaxProfileRecord): TaxProfileRecord {
  const normalizedState = normalizePlannerState(raw.state);
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
    (typeof raw.entity_name === 'string' && raw.entity_name.trim()) ||
    normalizedState.years[0]?.scorp_1120s.entity_name ||
    raw.name ||
    'Tax Profile';
  const entityEin =
    (typeof raw.entity_ein === 'string' && raw.entity_ein.trim()) ||
    normalizedState.years[0]?.scorp_1120s.entity_ein ||
    '';

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateProfileId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : entityName,
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
        nextState.years[0]?.scorp_1120s.entity_name?.trim() || profile.entity_name;
      const nextEntityEin =
        nextState.years[0]?.scorp_1120s.entity_ein?.trim() ?? profile.entity_ein;
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
        updates.entity_name !== undefined
          ? updates.entity_name.trim() || cleanName
          : profile.entity_name;
      const nextEntityEin =
        updates.entity_ein !== undefined ? updates.entity_ein.trim() : profile.entity_ein;
      const nextNotes = updates.notes !== undefined ? updates.notes.trim() : profile.notes;

      const syncedYears = profile.state.years.map((yr) => ({
        ...yr,
        scorp_1120s: {
          ...yr.scorp_1120s,
          entity_name: nextEntityName || yr.scorp_1120s.entity_name,
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

export function serializeSingleProfileBackup(profile: TaxProfileRecord): string {
  return JSON.stringify(
    {
      format: 'rolling-tax-planner-profile-v1',
      exported_at: new Date().toISOString(),
      profile,
    },
    null,
    2
  );
}

export function serializeAllProfilesBackup(store: MultiProfileStore): string {
  return JSON.stringify(
    {
      format: 'rolling-tax-planner-backup-v1',
      exported_at: new Date().toISOString(),
      active_profile_id: store.active_profile_id,
      profiles: store.profiles,
    },
    null,
    2
  );
}

export interface ImportProfilesResult {
  nextStore: MultiProfileStore;
  importedCount: number;
  importedNames: string[];
}

export function importProfilesFromJson(
  rawText: string,
  existingStore: MultiProfileStore
): ImportProfilesResult {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  const existingIds = new Set(existingStore.profiles.map((p) => p.id));
  const now = new Date().toISOString();

  const ensureUniqueId = (candidate?: string): string => {
    if (candidate && !existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
    const fresh = generateProfileId();
    existingIds.add(fresh);
    return fresh;
  };

  const importedRecords: TaxProfileRecord[] = [];

  // Format 1: Multi-profile backup bundle
  if (Array.isArray(parsed.profiles)) {
    for (const rawProf of parsed.profiles) {
      const p = rawProf as Partial<TaxProfileRecord>;
      if (!p?.state?.setup || !Array.isArray(p.state.years) || p.state.years.length === 0) {
        continue;
      }
      const norm = normalizeProfileRecord(p as TaxProfileRecord);
      importedRecords.push({
        ...norm,
        id: ensureUniqueId(norm.id),
        updated_at: now,
      });
    }
  }
  // Format 2: Single profile backup wrapper
  else if (
    parsed.profile &&
    typeof parsed.profile === 'object' &&
    (parsed.profile as Partial<TaxProfileRecord>).state?.setup &&
    Array.isArray((parsed.profile as Partial<TaxProfileRecord>).state?.years)
  ) {
    const norm = normalizeProfileRecord(parsed.profile as TaxProfileRecord);
    importedRecords.push({
      ...norm,
      id: ensureUniqueId(norm.id),
      updated_at: now,
    });
  }
  // Format 3: Legacy single PlannerState JSON export
  else if (
    parsed.setup &&
    typeof parsed.setup === 'object' &&
    Array.isArray(parsed.years) &&
    parsed.years.length > 0
  ) {
    const plannerState = normalizePlannerState(parsed as unknown as PlannerState);
    const entityName =
      plannerState.years[0]?.scorp_1120s.entity_name ||
      `${plannerState.setup.primary_name || 'Imported'} Plan`;
    const entityEin = plannerState.years[0]?.scorp_1120s.entity_ein || '';
    const profileName = plannerState.setup.has_scorp
      ? `${entityName} (${plannerState.setup.primary_name || 'Imported'})`
      : `${plannerState.setup.primary_name || 'Imported'}${
          plannerState.setup.spouse_name ? ` & ${plannerState.setup.spouse_name}` : ''
        } (${plannerState.setup.current_tax_year})`;

    importedRecords.push(
      normalizeProfileRecord({
        id: ensureUniqueId(),
        name: profileName,
        entity_name: entityName,
        entity_ein: entityEin,
        notes: 'Imported from plan JSON',
        created_at: now,
        updated_at: now,
        state: plannerState,
      })
    );
  }

  if (importedRecords.length === 0) {
    throw new Error(
      'Invalid JSON backup: expected a Rolling Tax Planner profile backup or plan export.'
    );
  }

  return {
    nextStore: {
      version: 1,
      active_profile_id: importedRecords[0].id,
      profiles: [...existingStore.profiles, ...importedRecords],
    },
    importedCount: importedRecords.length,
    importedNames: importedRecords.map((p) => p.name),
  };
}
