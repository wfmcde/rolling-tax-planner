import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GitMerge,
  Info,
  Layers,
  List,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  BalanceSheetProjectionInputs,
  CadenceForecastMode,
  CadenceForecasterState,
  CadenceGroupingMode,
  ComputedTaxYear,
  GuardrailAcknowledgment,
  PayeeAliasMatchType,
  PayeeAliasRule,
  PlanningGoalGuardrail,
  PnlBalanceSheetState,
  PnlLineId,
  PushToHorizonImpact,
  SetupConfig,
  ValidationIssue,
  WorkspaceTab,
} from '../types/tax';
import {
  PNL_OPERATING_ITEMS,
  PNL_SECTIONS,
  SCHEDULE_K_LINE_META,
  buildCpaDisclosureMetadata,
  buildCpaProjectionCsv,
  getPnlLineLabel,
  type ComputedPnlBalanceSheet,
  type CpaReportMetadata,
} from '../engine/pnlBalanceSheet';
import { getSetupBusinessIdentity, getSetupStates } from '../utils/setupHelpers';
import {
  DEFAULT_EXP_SMOOTH_ALPHA,
  buildStateFromImportedTransactions,
  clampExpSmoothAlpha,
  computeCadenceForecast,
  createInitialCadenceForecasterState,
  parseQboTransactionArrayBuffer,
  parseQboTransactionText,
  type AuditRowCategory,
} from '../engine/cadenceEngine';
import { evaluateAllPlanningGoals } from '../engine/planningGoals';
import { getPersonNames } from '../engine/scheduleCatalog';
import { formatCurrency, formatCurrencyExact } from '../utils/format';
import { CpaPrintPackageModal } from './CpaPrintPackageModal';
import { PlanningGoalsPanel } from './PlanningGoalsPanel';

const HIDE_EXCL_ZERO_STORAGE_KEY = 'rolling-tax-planner-hide-excl-zero-v1';

function formatSignedDelta(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return '$0';
  return `${rounded > 0 ? '+' : '-'}${formatCurrency(Math.abs(rounded))}`;
}

interface TransactionCadenceViewProps {
  setup: SetupConfig;
  cadenceState: CadenceForecasterState;
  planningGoals: PlanningGoalGuardrail[];
  issues?: ValidationIssue[];
  guardrailAcknowledgments?: Record<string, GuardrailAcknowledgment>;
  year2025Computed?: ComputedTaxYear;
  year2026Computed?: ComputedTaxYear;
  onUpdateCadenceState: (
    updater: (prev: CadenceForecasterState) => CadenceForecasterState
  ) => void;
  onUpdatePlanningGoals: (
    updater: (prev: PlanningGoalGuardrail[]) => PlanningGoalGuardrail[]
  ) => void;
  onPushTo2026Schedule: (
    pnlSnapshot: PnlBalanceSheetState,
    computed: ComputedPnlBalanceSheet
  ) => PushToHorizonImpact | void;
  onNavigate: (tab: WorkspaceTab) => void;
}

type PnlEditColumn = 'ytd' | 'remaining' | 'projected';
type StreamFilterTab =
  | 'all'
  | 'cadence'
  | 'exp_smooth'
  | 'run_rate'
  | 'one_time'
  | 'flagged'
  | 'overridden';

interface ActiveInlineEdit {
  key: string;
  draft: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNumericInput(raw: string): number | null {
  let trimmed = raw.trim();
  let negative = false;
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    negative = true;
    trimmed = trimmed.slice(1, -1);
  }
  const cleaned = trimmed.replace(/[$,\s]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return round2(negative ? -Math.abs(num) : num);
}

const AUDIT_CATEGORY_LABELS: Record<AuditRowCategory, string> = {
  transfer_cc_payment: 'Internal Transfer / CC Payment',
  liability_payoff: 'Liability Payoff',
  opening_balance: 'Opening Balance',
  duplicate: 'Duplicate Skipped',
  unmapped: 'Unmapped Account',
  non_target_year: 'Outside Date Window',
};

const EXP_SMOOTH_TOOLTIP =
  "Exponential Smoothing weights recent values more heavily than older ones using a smoothing factor (alpha, between 0 and 1) to filter out one-off noise and project underlying trend. Lower alpha (e.g., 0.05 to 0.09) reacts more slowly to single spikes so a one-time bill or invoice doesn't swing the forecast; moving from 0.05 to 0.09 gives slightly more weight to recent changes while still keeping the forecast steady.";

const ExpSmoothHoverTooltip: React.FC<{
  text?: string;
  children: React.ReactNode;
}> = ({ text = EXP_SMOOTH_TOOLTIP, children }) => {
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const showFromElement = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const tooltipWidth = 320;
    const margin = 12;
    const centerX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      margin,
      Math.min(window.innerWidth - tooltipWidth - margin, centerX - tooltipWidth / 2)
    );
    const showBelow = rect.top < 160;
    setCoords({
      left: clampedLeft,
      top: showBelow ? rect.bottom + 8 : rect.top - 8,
      placement: showBelow ? 'bottom' : 'top',
    });
  };

  return (
    <span
      className="inline-flex items-center"
      onMouseEnter={(e) => showFromElement(e.currentTarget)}
      onMouseLeave={() => setCoords(null)}
      onFocus={(e) => showFromElement(e.currentTarget)}
      onBlur={() => setCoords(null)}
    >
      {children}
      {coords && (
        <span
          role="tooltip"
          style={{
            left: `${coords.left}px`,
            top: `${coords.top}px`,
            transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
          className="fixed z-50 w-80 px-3 py-2 rounded-md bg-slate-900 text-slate-50 border border-slate-700/80 shadow-lg text-[11px] font-normal leading-relaxed text-left whitespace-normal pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
};

export const TransactionCadenceView: React.FC<TransactionCadenceViewProps> = ({
  setup,
  cadenceState,
  planningGoals,
  issues,
  guardrailAcknowledgments,
  year2025Computed,
  year2026Computed,
  onUpdateCadenceState,
  onUpdatePlanningGoals,
  onPushTo2026Schedule,
  onNavigate,
}) => {
  const [activeEdit, setActiveEdit] = useState<ActiveInlineEdit | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(cadenceState.transactions.length === 0);
  const [pasteText, setPasteText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<'all' | AuditRowCategory>('all');
  const [showCadenceDrawer, setShowCadenceDrawer] = useState(true);
  const [streamFilter, setStreamFilter] = useState<StreamFilterTab>('all');
  const [streamSearch, setStreamSearch] = useState('');
  const [hideExcludedZeroRows, setHideExcludedZeroRows] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
      return window.localStorage.getItem(HIDE_EXCL_ZERO_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [showAliasPanel, setShowAliasPanel] = useState(false);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasPatternDraft, setAliasPatternDraft] = useState('');
  const [aliasMatchTypeDraft, setAliasMatchTypeDraft] = useState<PayeeAliasMatchType>('contains');
  const [aliasCanonicalDraft, setAliasCanonicalDraft] = useState('');
  const [quickMergeStreamKey, setQuickMergeStreamKey] = useState<string | null>(null);
  const [quickMergePattern, setQuickMergePattern] = useState('');
  const [quickMergeMatchType, setQuickMergeMatchType] = useState<PayeeAliasMatchType>('contains');
  const [quickMergeCanonical, setQuickMergeCanonical] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'push' | 'import';
    text: string;
  } | null>(null);
  const [pushToast, setPushToast] = useState<PushToHorizonImpact | null>(null);

  useEffect(() => {
    if (!pushToast) return;
    const timer = window.setTimeout(() => {
      setPushToast(null);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [pushToast]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { primaryName, spouseName } = getPersonNames(setup);
  const { businessName, businessEin } = getSetupBusinessIdentity(
    setup,
    year2025Computed?.scorp_in.entity_name
  );
  const entityName = businessName;
  const entityEin = businessEin || year2025Computed?.scorp_in.entity_ein?.trim() || '';
  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const pCode = primaryStateCode || 'State 1';
  const sCode = secondaryStateCode || 'State 2';
  const priorYearLabel = `${cadenceState.projection_year - 1} Filed`;
  const cpaDisclosure = buildCpaDisclosureMetadata(setup, entityName);
  const showStockBasis = setup.has_stock_basis !== false;

  const payeeAliases = cadenceState.payee_aliases ?? [];

  const updatePayeeAliases = (updater: (prev: PayeeAliasRule[]) => PayeeAliasRule[]) => {
    onUpdateCadenceState((prev) => {
      const nextAliases = updater(prev.payee_aliases ?? []);
      return {
        ...prev,
        payee_aliases: nextAliases,
      };
    });
  };

  const handleToggleHideExcludedZero = () => {
    setHideExcludedZeroRows((prev) => {
      const next = !prev;
      if (next && streamFilter === 'one_time') {
        setStreamFilter('all');
      }
      try {
        window.localStorage.setItem(HIDE_EXCL_ZERO_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleSelectStreamFilter = (tab: StreamFilterTab) => {
    setStreamFilter(tab);
    if (tab === 'one_time' && hideExcludedZeroRows) {
      setHideExcludedZeroRows(false);
      try {
        window.localStorage.setItem(HIDE_EXCL_ZERO_STORAGE_KEY, 'false');
      } catch {
        // Ignore storage errors
      }
    }
  };

  const handleSubmitAliasForm = (e: React.FormEvent) => {
    e.preventDefault();
    const pattern = aliasPatternDraft.trim();
    const canonical = aliasCanonicalDraft.trim();
    if (!pattern || !canonical) return;

    if (editingAliasId) {
      updatePayeeAliases((prev) =>
        prev.map((rule) =>
          rule.id === editingAliasId
            ? { ...rule, pattern, match_type: aliasMatchTypeDraft, canonical_name: canonical }
            : rule
        )
      );
      setEditingAliasId(null);
    } else {
      const newRule: PayeeAliasRule = {
        id: `alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        pattern,
        match_type: aliasMatchTypeDraft,
        canonical_name: canonical,
      };
      updatePayeeAliases((prev) => [...prev, newRule]);
    }

    setAliasPatternDraft('');
    setAliasMatchTypeDraft('contains');
    setAliasCanonicalDraft('');
  };

  const handleStartEditAlias = (rule: PayeeAliasRule) => {
    setEditingAliasId(rule.id);
    setAliasPatternDraft(rule.pattern);
    setAliasMatchTypeDraft(rule.match_type);
    setAliasCanonicalDraft(rule.canonical_name);
    setShowAliasPanel(true);
  };

  const handleCancelEditAlias = () => {
    setEditingAliasId(null);
    setAliasPatternDraft('');
    setAliasMatchTypeDraft('contains');
    setAliasCanonicalDraft('');
  };

  const handleDeleteAlias = (id: string) => {
    updatePayeeAliases((prev) => prev.filter((r) => r.id !== id));
    if (editingAliasId === id) {
      handleCancelEditAlias();
    }
  };

  const handleOpenQuickMerge = (streamKey: string, vendorName: string) => {
    if (quickMergeStreamKey === streamKey) {
      setQuickMergeStreamKey(null);
      return;
    }
    setQuickMergeStreamKey(streamKey);
    setQuickMergePattern(vendorName);
    setQuickMergeMatchType('contains');
    setQuickMergeCanonical('');
  };

  const handleApplyQuickMerge = (
    patternInput: string,
    canonicalInput: string,
    matchType: PayeeAliasMatchType = 'contains'
  ) => {
    const pattern = patternInput.trim();
    const canonical = canonicalInput.trim();
    if (!pattern || !canonical) return;

    updatePayeeAliases((prev) => {
      const existingIdx = prev.findIndex(
        (r) =>
          r.pattern.trim().toLowerCase() === pattern.toLowerCase() &&
          r.match_type === matchType
      );
      if (existingIdx >= 0) {
        return prev.map((r, idx) =>
          idx === existingIdx ? { ...r, canonical_name: canonical } : r
        );
      }
      return [
        ...prev,
        {
          id: `alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          pattern,
          match_type: matchType,
          canonical_name: canonical,
        },
      ];
    });
    setQuickMergeStreamKey(null);
    setQuickMergePattern('');
    setQuickMergeCanonical('');
  };

  const forecast = useMemo(
    () => computeCadenceForecast(cadenceState, year2025Computed, year2026Computed, setup),
    [cadenceState, year2025Computed, year2026Computed, setup]
  );

  const computed = forecast.pnlComputed;
  const pnlState = forecast.synthesizedPnlState;
  const bs = pnlState.balance_sheet;

  const lineLabelMap = useMemo(() => {
    const map = new Map<PnlLineId, string>();
    for (const item of PNL_OPERATING_ITEMS) {
      map.set(item.id, getPnlLineLabel(item, setup));
    }
    map.set(SCHEDULE_K_LINE_META.id, SCHEDULE_K_LINE_META.label);
    return map;
  }, [setup]);

  const canonicalPayeeSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const s of forecast.granularStreams) {
      if (s.vendor.trim()) names.add(s.vendor.trim());
    }
    for (const r of payeeAliases) {
      if (r.canonical_name.trim()) names.add(r.canonical_name.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [forecast.granularStreams, payeeAliases]);

  // File upload handler (CSV / TSV / XLSX / XLS)
  const handleFileUpload = async (file: File) => {
    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseQboTransactionArrayBuffer(buffer, file.name);
      if (parsed.transactions.length === 0) {
        setImportError(
          `No recognizable QuickBooks transaction rows found in "${file.name}". Verify the file has Date and Amount (or Debit/Credit) columns.`
        );
        return;
      }

      const nextState = buildStateFromImportedTransactions(
        parsed.transactions,
        file.name,
        parsed.detectedAsOfDate,
        parsed.detectedYear,
        cadenceState.balance_sheet,
        parsed.ledgerFormat,
        cadenceState.qbo_expected,
        {
          alpha: cadenceState.exp_smooth_alpha,
          dayFraction: cadenceState.exp_smooth_day_fraction,
        },
        cadenceState.payee_aliases,
        cadenceState.grouping_mode,
        setup
      );
      onUpdateCadenceState(() => nextState);
      setShowImportPanel(false);
      setBannerMessage({
        type: 'import',
        text: `Ingested ${parsed.transactions.length} rows from "${file.name}" (${
          parsed.ledgerFormat === 'general_ledger' ? 'QBO General Ledger' : 'QBO Transaction List'
        } · As-Of ${nextState.as_of_date}). Section-grouped P&L, Balance Sheet rollups, and calendar cadences updated.`,
      });
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : `Unable to read "${file.name}".`
      );
    }
  };

  const handleParsePastedRows = () => {
    setImportError(null);
    if (!pasteText.trim()) {
      setImportError('Paste QuickBooks Online General Ledger or Transaction List rows (CSV or tab-separated) first.');
      return;
    }
    const parsed = parseQboTransactionText(pasteText);
    if (parsed.transactions.length === 0) {
      setImportError(
        'Could not parse any valid transaction rows. Expected QBO General Ledger or Transaction List columns (Date, Transaction Type, Name, Memo/Description, Split, Amount, Balance).'
      );
      return;
    }
    const nextState = buildStateFromImportedTransactions(
      parsed.transactions,
      `Pasted QBO ${parsed.ledgerFormat === 'general_ledger' ? 'General Ledger' : 'Transactions'} (${parsed.transactions.length} rows)`,
      parsed.detectedAsOfDate,
      parsed.detectedYear,
      cadenceState.balance_sheet,
      parsed.ledgerFormat,
      cadenceState.qbo_expected,
      {
        alpha: cadenceState.exp_smooth_alpha,
        dayFraction: cadenceState.exp_smooth_day_fraction,
      },
      cadenceState.payee_aliases,
      cadenceState.grouping_mode,
      setup
    );
    onUpdateCadenceState(() => nextState);
    setPasteText('');
    setShowImportPanel(false);
    setBannerMessage({
      type: 'import',
      text: `Parsed ${parsed.transactions.length} pasted rows (${
        parsed.ledgerFormat === 'general_ledger' ? 'QBO General Ledger' : 'QBO Transaction List'
      } · As-Of ${nextState.as_of_date}). Calendar cadences & Balance Sheet rollups refreshed.`,
    });
  };

  const handleLoadSampleLedger = () => {
    setImportError(null);
    const fresh = createInitialCadenceForecasterState(
      year2025Computed?.scorp_out.stock_basis_ending ?? 0,
      cadenceState.payee_aliases ?? [],
      setup
    );
    fresh.grouping_mode = cadenceState.grouping_mode ?? 'category';
    onUpdateCadenceState(() => fresh);
    setShowImportPanel(false);
    setBannerMessage({
      type: 'import',
      text: `Loaded Sample QBO Transaction Ledger (${fresh.transactions.length} transactions) for cadence forecasting and reconciliation testing.`,
    });
  };

  // Stream mode / manual override handlers
  const handleStreamModeChange = (
    streamKey: string,
    mode: CadenceForecastMode,
    currentRemaining: number
  ) => {
    onUpdateCadenceState((prev) => ({
      ...prev,
      stream_overrides: {
        ...prev.stream_overrides,
        [streamKey]:
          mode === 'manual'
            ? { mode: 'manual', manual_remaining: round2(currentRemaining) }
            : { mode },
      },
    }));
    if (mode === 'manual') {
      setActiveEdit({ key: `stream:${streamKey}`, draft: String(round2(currentRemaining)) });
    }
  };

  const handleStreamManualAmountCommit = (streamKey: string, draft: string) => {
    const parsed = parseNumericInput(draft);
    setActiveEdit(null);
    if (parsed === null) return;
    onUpdateCadenceState((prev) => ({
      ...prev,
      stream_overrides: {
        ...prev.stream_overrides,
        [streamKey]: { mode: 'manual', manual_remaining: parsed },
      },
    }));
  };

  const handleResetStreamOverride = (streamKey: string) => {
    onUpdateCadenceState((prev) => {
      const next = { ...prev.stream_overrides };
      delete next[streamKey];
      return { ...prev, stream_overrides: next };
    });
  };

  // Monthly Exponential Smoothing controls
  const handleAlphaChange = (rawAlpha: number) => {
    const clamped = clampExpSmoothAlpha(rawAlpha);
    onUpdateCadenceState((prev) => ({
      ...prev,
      exp_smooth_alpha: clamped,
    }));
  };

  const handleResetAlpha = () => {
    onUpdateCadenceState((prev) => ({
      ...prev,
      exp_smooth_alpha: DEFAULT_EXP_SMOOTH_ALPHA,
    }));
  };

  const handleToggleDayFraction = (checked: boolean) => {
    onUpdateCadenceState((prev) => ({
      ...prev,
      exp_smooth_day_fraction: checked,
    }));
  };

  const isCategoryMode = forecast.groupingMode === 'category';

  const handleGroupingModeChange = (nextMode: CadenceGroupingMode) => {
    setQuickMergeStreamKey(null);
    setActiveEdit(null);
    if (streamFilter === 'run_rate' && nextMode === 'category') {
      setStreamFilter('all');
    }
    onUpdateCadenceState((prev) => ({
      ...prev,
      grouping_mode: nextMode,
    }));
  };

  const handleToggleCategoryExpSmooth = (
    streamKey: string,
    activeMode: CadenceForecastMode,
    detectedMode: Exclude<CadenceForecastMode, 'manual'>
  ) => {
    onUpdateCadenceState((prev) => {
      const nextOverrides = { ...prev.stream_overrides };
      if (activeMode === 'exp_smooth') {
        if (detectedMode === 'cadence') {
          delete nextOverrides[streamKey];
        } else {
          nextOverrides[streamKey] = { mode: 'cadence' };
        }
      } else {
        nextOverrides[streamKey] = { mode: 'exp_smooth' };
      }
      return {
        ...prev,
        stream_overrides: nextOverrides,
      };
    });
  };

  const variableEligibleStreams = useMemo(
    () =>
      forecast.streams.filter((s) =>
        isCategoryMode
          ? Boolean(s.isVariableCategory) && s.activeMonthCount >= 2 && s.activeMode !== 'manual'
          : s.detectedMode === 'run_rate' && s.activeMonthCount >= 2 && s.activeMode !== 'manual'
      ),
    [forecast.streams, isCategoryMode]
  );

  const variableOnExpSmoothCount = useMemo(
    () => variableEligibleStreams.filter((s) => s.activeMode === 'exp_smooth').length,
    [variableEligibleStreams]
  );

  const handleApplyExpSmoothToVariable = () => {
    if (variableEligibleStreams.length === 0) return;
    onUpdateCadenceState((prev) => {
      const nextOverrides = { ...prev.stream_overrides };
      for (const s of variableEligibleStreams) {
        if (nextOverrides[s.streamKey]?.mode === 'manual') continue;
        nextOverrides[s.streamKey] = { mode: 'exp_smooth' };
      }
      return {
        ...prev,
        stream_overrides: nextOverrides,
      };
    });
  };

  const handleRevertVariableToRunRate = () => {
    onUpdateCadenceState((prev) => {
      const nextOverrides = { ...prev.stream_overrides };
      for (const s of variableEligibleStreams) {
        if (nextOverrides[s.streamKey]?.mode === 'exp_smooth') {
          delete nextOverrides[s.streamKey];
        }
      }
      return {
        ...prev,
        stream_overrides: nextOverrides,
      };
    });
  };

  // Two-way P&L table inline edit commit
  const commitPnlEdit = (lineId: PnlLineId, col: PnlEditColumn, draft: string) => {
    const parsed = parseNumericInput(draft);
    setActiveEdit(null);
    if (parsed === null) return;

    onUpdateCadenceState((prev) => {
      const currentVals = computed.lines[lineId];
      const existingOv = prev.pnl_line_overrides[lineId] ?? {};
      let nextOv = { ...existingOv };

      if (col === 'ytd') {
        nextOv.ytd = parsed;
      } else if (col === 'remaining') {
        nextOv.remaining = parsed;
      } else {
        // Two-way back-solve: Remaining = Projected - YTD
        nextOv.remaining = round2(parsed - currentVals.ytd);
      }

      return {
        ...prev,
        pnl_line_overrides: {
          ...prev.pnl_line_overrides,
          [lineId]: nextOv,
        },
      };
    });
  };

  const resetPnlLineOverride = (lineId: PnlLineId) => {
    onUpdateCadenceState((prev) => {
      const next = { ...prev.pnl_line_overrides };
      delete next[lineId];
      return { ...prev, pnl_line_overrides: next };
    });
  };

  // Balance Sheet / Basis inline edit commit
  const commitBsField = (
    field:
      | keyof Pick<
          BalanceSheetProjectionInputs,
          | 'operating_cash_beg'
          | 'operating_cash_ytd'
          | 'operating_cash_ye_override'
          | 'pension_payable_beg'
          | 'pension_payable_ytd'
          | 'pension_payable_ye'
          | 'cc_ap_beg'
          | 'cc_ap_ytd'
          | 'cc_ap_ye'
          | 'member_draws_ytd'
          | 'member_draws_remaining'
          | 'capital_contributions_ytd'
          | 'capital_contributions_remaining'
          | 'beginning_stock_basis_override'
        >
      | 'member_draws_projected'
      | 'capital_contributions_projected',
    draft: string
  ) => {
    const parsed = parseNumericInput(draft);
    setActiveEdit(null);
    if (parsed === null) return;

    onUpdateCadenceState((prev) => {
      const nextBs = { ...prev.balance_sheet };
      if (field === 'member_draws_projected') {
        nextBs.member_draws_remaining = round2(parsed - nextBs.member_draws_ytd);
      } else if (field === 'capital_contributions_projected') {
        nextBs.capital_contributions_remaining = round2(
          parsed - nextBs.capital_contributions_ytd
        );
      } else {
        nextBs[field] = parsed;
      }
      return {
        ...prev,
        balance_sheet: nextBs,
      };
    });
  };

  // Filtered cadence streams
  const streamCounts = useMemo(() => {
    let cadence = 0;
    let exp_smooth = 0;
    let run_rate = 0;
    let manual = 0;
    let one_time = 0;
    let flagged = 0;
    let overridden = 0;
    for (const s of forecast.streams) {
      if (s.activeMode === 'cadence') cadence++;
      if (s.activeMode === 'exp_smooth') exp_smooth++;
      if (s.activeMode === 'run_rate') run_rate++;
      if (s.activeMode === 'manual') manual++;
      if (s.activeMode === 'one_time') one_time++;
      if (s.hasTransferFlag) flagged++;
      if (s.isOverridden) overridden++;
    }
    return {
      all: forecast.streams.length,
      cadence,
      exp_smooth,
      run_rate,
      manual,
      one_time,
      flagged,
      overridden,
    };
  }, [forecast.streams]);

  const activeEvaluatedGoals = useMemo(
    () =>
      evaluateAllPlanningGoals(planningGoals, computed, pnlState, setup).filter(
        (g) => g.goal.enabled
      ),
    [planningGoals, computed, pnlState, setup]
  );

  const cpaReportMeta = useMemo<CpaReportMetadata>(() => {
    const rawLabel = cadenceState.source_label?.trim() || 'Sample Ledger';
    const isSample = /sample|built-in/i.test(rawLabel);
    const formatPrefix = isSample
      ? 'Sample / Built-in Ledger'
      : forecast.ledgerFormat === 'general_ledger'
        ? 'QBO General Ledger'
        : 'QBO Transaction List';
    const sourceMode = `${formatPrefix} (${rawLabel} · ${cadenceState.transactions.length} rows)`;

    const modeParts: string[] = [
      forecast.groupingMode === 'category'
        ? `P&L Category Rollup (${forecast.categoryCount} categories)`
        : `Granular Streams (${forecast.granularStreamCount} streams)`,
    ];
    if (streamCounts.cadence > 0) modeParts.push(`Cadence (${streamCounts.cadence})`);
    if (streamCounts.exp_smooth > 0) {
      modeParts.push(
        `Exp. Smooth α=${forecast.expSmoothAlpha.toFixed(2)} (${streamCounts.exp_smooth}, ${
          forecast.expSmoothDayFraction ? 'day-fraction' : '1-mo level'
        })`
      );
    } else {
      modeParts.push(`Exp. Smooth α=${forecast.expSmoothAlpha.toFixed(2)} (0 active)`);
    }
    if (streamCounts.run_rate > 0) modeParts.push(`Run-Rate (${streamCounts.run_rate})`);
    if (streamCounts.manual > 0) modeParts.push(`Manual (${streamCounts.manual})`);
    if (streamCounts.one_time > 0) modeParts.push(`Excl. $0 (${streamCounts.one_time})`);

    return {
      moduleName: 'Rolling Tax Planner — Transaction Cadence Forecaster',
      sourceMode,
      forecastMethodSummary: modeParts.join(' · '),
      elapsedDays: forecast.elapsedDays,
      remainingDays: forecast.remainingDays,
      activeGoals: activeEvaluatedGoals,
    };
  }, [
    activeEvaluatedGoals,
    cadenceState.source_label,
    cadenceState.transactions.length,
    forecast.categoryCount,
    forecast.elapsedDays,
    forecast.granularStreamCount,
    forecast.groupingMode,
    forecast.remainingDays,
    forecast.ledgerFormat,
    forecast.expSmoothAlpha,
    forecast.expSmoothDayFraction,
    streamCounts,
  ]);

  const handleDownloadCsv = () => {
    const csv = buildCpaProjectionCsv(
      setup,
      pnlState,
      computed,
      entityName,
      entityEin,
      cpaReportMeta
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeEntity =
      entityName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'CPA_Report';
    a.download = `${safeEntity}_${pnlState.projection_year}_Cadence_CPA_Projection.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canPushForecast =
    cadenceState.transactions.length > 0 ||
    computed.totalRevenue.projected > 0 ||
    computed.lines.bill_officer_w2.projected > 0 ||
    computed.lines.debra_salaries_wages.projected > 0;

  const handlePush = () => {
    if (!canPushForecast) return;
    const impact = onPushTo2026Schedule(pnlState, computed);
    if (impact) {
      setPushToast(impact);
      setBannerMessage({
        type: 'push',
        text: `Pushed ${impact.taxYear} forecast to Six-Year Horizon — Updated ${
          impact.taxYear
        } K-1: ${formatCurrency(impact.newK1)} (${formatSignedDelta(
          impact.k1Delta
        )}) · Total ${impact.taxYear} All-In Tax: ${formatCurrency(
          impact.newAllInTax
        )} (${formatSignedDelta(impact.taxDelta)}).`,
      });
    } else {
      setBannerMessage({
        type: 'push',
        text: `Pushed cadence-projected ${pnlState.projection_year} financials to the Six-Year Financial Schedule (Revenue ${formatCurrencyExact(
          computed.totalRevenue.projected
        )} · K-1 Profit ${formatCurrencyExact(
          computed.ordinaryBusinessIncome.projected
        )} · Draws ${formatCurrencyExact(computed.projectedDrawsTotal)}).`,
      });
    }
  };

  const streamsMatchingTabAndSearch = useMemo(() => {
    const q = streamSearch.trim().toLowerCase();
    return forecast.streams.filter((s) => {
      if (streamFilter === 'cadence' && s.activeMode !== 'cadence') return false;
      if (streamFilter === 'exp_smooth' && s.activeMode !== 'exp_smooth') return false;
      if (streamFilter === 'run_rate' && s.activeMode !== 'run_rate') return false;
      if (streamFilter === 'one_time' && s.activeMode !== 'one_time') return false;
      if (streamFilter === 'flagged' && !s.hasTransferFlag) return false;
      if (streamFilter === 'overridden' && !s.isOverridden) return false;
      if (!q) return true;
      const targetLabel = (lineLabelMap.get(s.targetLineId) ?? '').toLowerCase();
      return (
        s.vendor.toLowerCase().includes(q) ||
        s.mergedRawVendors.some((rv) => rv.toLowerCase().includes(q)) ||
        targetLabel.includes(q) ||
        s.cadenceLabel.toLowerCase().includes(q) ||
        s.sourceAccounts.some((a) => a.toLowerCase().includes(q)) ||
        (s.flaggedTransferNote ?? '').toLowerCase().includes(q)
      );
    });
  }, [forecast.streams, streamFilter, streamSearch, lineLabelMap]);

  const hiddenExcludedZeroCount = useMemo(() => {
    if (!hideExcludedZeroRows) return 0;
    return streamsMatchingTabAndSearch.filter((s) => s.activeMode === 'one_time').length;
  }, [streamsMatchingTabAndSearch, hideExcludedZeroRows]);

  // Display-only filter: hiding Excl. $0 rows never alters YTD totals, remaining projections, or CPA reports
  const filteredStreams = useMemo(() => {
    if (!hideExcludedZeroRows) return streamsMatchingTabAndSearch;
    return streamsMatchingTabAndSearch.filter((s) => s.activeMode !== 'one_time');
  }, [streamsMatchingTabAndSearch, hideExcludedZeroRows]);

  const filteredAuditRows = useMemo(() => {
    if (auditCategoryFilter === 'all') return forecast.auditRows;
    return forecast.auditRows.filter((r) => r.category === auditCategoryFilter);
  }, [forecast.auditRows, auditCategoryFilter]);

  const renderEditableCell = (
    editKey: string,
    value: number,
    onCommit: (draft: string) => void,
    options?: {
      bold?: boolean;
      accent?: boolean;
      subLabel?: string;
      resetAction?: () => void;
    }
  ) => {
    const isEditing = activeEdit?.key === editKey;
    if (isEditing) {
      return (
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={activeEdit.draft}
          onChange={(e) => setActiveEdit({ key: editKey, draft: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => onCommit(activeEdit.draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(activeEdit.draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setActiveEdit(null);
            }
          }}
          className="w-full max-w-[96px] px-1.5 py-0.5 text-right text-[11px] font-mono tabular-nums bg-white border border-teal-700 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
        />
      );
    }

    return (
      <div className="inline-flex flex-col items-end">
        <button
          type="button"
          onClick={() => setActiveEdit({ key: editKey, draft: String(round2(value)) })}
          title="Click to edit inline"
          className={`group inline-flex items-center justify-end gap-0.5 px-1 py-0.5 -mr-1 rounded hover:bg-teal-50/80 transition-colors font-mono tabular-nums text-[11px] whitespace-nowrap ${
            options?.bold ? 'font-semibold text-slate-900' : 'text-slate-800'
          } ${options?.accent ? 'text-teal-900' : ''}`}
        >
          <Pencil className="w-2.5 h-2.5 text-teal-600/0 group-hover:text-teal-600/80 transition-opacity shrink-0" />
          <span>{formatCurrencyExact(value)}</span>
        </button>
        {(options?.subLabel || options?.resetAction) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {options?.subLabel && (
              <span className="text-[10px] font-mono tabular-nums text-slate-500">
                {options.subLabel}
              </span>
            )}
            {options?.resetAction && (
              <button
                type="button"
                onClick={options.resetAction}
                className="text-[10px] text-teal-700 hover:text-teal-900 underline"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const schedule2026K1 = year2026Computed?.scorp_out.ordinary_business_income_1120s;
  const k1DiffFromSchedule =
    schedule2026K1 !== undefined
      ? round2(computed.ordinaryBusinessIncome.projected - schedule2026K1)
      : null;

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileUpload(f);
        }}
        className="hidden"
      />

      {/* Page Title, Context Metadata & Toolbar Actions */}
      <div className="no-print flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Transaction Cadence Forecaster
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{entityName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">EIN {entityEin}</span>
            <span aria-hidden="true">·</span>
            <label className="inline-flex items-center gap-1.5">
              <span>As-Of Date</span>
              <input
                type="date"
                value={cadenceState.as_of_date}
                onChange={(e) =>
                  onUpdateCadenceState((prev) => ({
                    ...prev,
                    as_of_date: e.target.value,
                    balance_sheet: { ...prev.balance_sheet, as_of_date: e.target.value },
                  }))
                }
                className="px-1.5 py-0.5 text-xs font-mono text-slate-700 bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
              />
            </label>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-700">
              {forecast.elapsedDays}d elapsed / {forecast.remainingDays}d remaining
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowImportPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            {showImportPanel ? 'Hide QBO Import' : 'Upload / Paste QBO Ledger'}
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export CPA CSV
          </button>

          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            CPA Print View
          </button>

          <button
            type="button"
            onClick={handlePush}
            disabled={!canPushForecast}
            title={
              canPushForecast
                ? `Push projected ${pnlState.projection_year} forecast to the Six-Year Horizon schedule`
                : 'Import QBO transactions or enter projected figures before pushing to the 6-Year Horizon'
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Push Projected {pnlState.projection_year} to Six-Year Schedule
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerMessage && (
        <div className="no-print bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>{bannerMessage.text}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {bannerMessage.type === 'push' && (
              <button
                type="button"
                onClick={() => onNavigate('horizon')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:text-teal-950 whitespace-nowrap"
              >
                View Six-Year Horizon
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Single-File QBO Transaction Ingestion Panel (CSV / XLSX / Paste)  */}
      {/* ================================================================= */}
      {showImportPanel && (
        <section className="no-print bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Single-File QuickBooks Online Transaction Ingestion
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload a QBO Transaction List by Date or General Ledger export (.csv or .xlsx), paste rows directly, or load a sample transaction ledger to test cadence forecasting.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadSampleLedger}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100/70 transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Load Sample QBO Transaction Ledger
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFileUpload(f);
              }}
              className={`border border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition-colors ${
                isDragOver
                  ? 'border-teal-700 bg-teal-50/50'
                  : 'border-slate-300 bg-slate-50/60 hover:border-teal-600'
              }`}
            >
              <Upload className="w-6 h-6 text-slate-400 mb-2" />
              <div className="text-xs font-semibold text-slate-800">
                Upload QBO Transaction List (CSV / XLSX)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
                Reads Date, Transaction Type, Num, Name/Vendor, Memo/Description, Account, Split Account, and Amount. Auto-detects As-Of Date and filters internal transfers &amp; CC payments.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap"
              >
                Choose CSV or Excel File
              </button>
            </div>

            {/* Paste Box */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="qbo-tx-paste"
                className="text-xs font-semibold text-slate-800"
              >
                Paste QBO Transaction Rows (CSV or Tab-Delimited)
              </label>
              <textarea
                id="qbo-tx-paste"
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'Date\tTransaction Type\tNum\tName\tMemo/Description\tAccount\tSplit\tAmount\n01/15/2026\tPayroll Check\t\tOfficer Payroll\tBiweekly salary\tOperating Checking\tOfficer Compensation\t-2500.00'}
                className="flex-1 w-full p-2.5 text-[11px] font-mono text-slate-800 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700 resize-y"
              />
              <div className="flex items-center justify-end gap-2">
                {pasteText && (
                  <button
                    type="button"
                    onClick={() => setPasteText('')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleParsePastedRows}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200/70 transition-colors whitespace-nowrap"
                >
                  Parse &amp; Forecast Pasted Rows
                </button>
              </div>
            </div>
          </div>

          {importError && (
            <div className="bg-red-50 border border-red-200 rounded-md px-3.5 py-2.5 text-xs text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* QBO Reconciliation Check Banner + Unmapped / Ignored Drawer       */}
      {/* ================================================================= */}
      <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck
              className={`w-4 h-4 shrink-0 ${
                forecast.reconciliation.allMatched ? 'text-emerald-700' : 'text-amber-600'
              }`}
            />
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900">QBO Reconciliation Check</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-slate-600">{cadenceState.source_label}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {forecast.ledgerFormat === 'general_ledger' ? 'General Ledger' : 'Transaction List'} ·{' '}
                  {forecast.parsedTransactionCount} rows ({forecast.pnlTransactionCount} P&amp;L
                  {forecast.bsSectionEntryCount > 0 ? ` · ${forecast.bsSectionEntryCount} BS` : ''} ·{' '}
                  {forecast.transferExcludedCount} transfers guarded · {forecast.unmappedCount} unmapped)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleLoadSampleLedger}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              Reload Sample Ledger
            </button>
            <button
              type="button"
              onClick={() => setShowAuditDrawer((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              {showAuditDrawer ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              )}
              Unmapped / Ignored Rows ({forecast.auditRows.length})
            </button>
          </div>
        </div>

        {/* 6-Column Reconciliation Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          {forecast.reconciliation.items.map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="text-[11px] text-slate-500 truncate">{item.label}</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(item.computed)}
              </div>
              <div className="text-[11px] font-mono tabular-nums mt-0.5">
                {item.status === 'matched' && (
                  <span className="text-emerald-700">Matched · $0.00 diff</span>
                )}
                {item.status === 'variance' && item.variance !== null && (
                  <span className="text-amber-700">
                    Δ {formatCurrencyExact(item.variance, true)} vs QBO
                  </span>
                )}
                {item.status === 'info' && (
                  <span className="text-slate-400">Rolled up from ledger</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Expandable Unmapped / Ignored & Internal Transfers Audit Drawer */}
        {showAuditDrawer && (
          <div className="border-t border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                Every transfer, credit card payment, liability payoff, opening balance, duplicate, or unmapped transaction is logged here so zero rows disappear silently.
              </div>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/60 rounded-md">
                {(
                  [
                    ['all', `All (${forecast.auditRows.length})`],
                    [
                      'transfer_cc_payment',
                      `Transfers / CC Pmts (${forecast.auditRows.filter((r) => r.category === 'transfer_cc_payment').length})`,
                    ],
                    [
                      'unmapped',
                      `Unmapped (${forecast.auditRows.filter((r) => r.category === 'unmapped').length})`,
                    ],
                    [
                      'opening_balance',
                      `Opening (${forecast.auditRows.filter((r) => r.category === 'opening_balance').length})`,
                    ],
                    [
                      'liability_payoff',
                      `Liability Payoffs (${forecast.auditRows.filter((r) => r.category === 'liability_payoff').length})`,
                    ],
                  ] as const
                ).map(([cat, label]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setAuditCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      auditCategoryFilter === cat
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredAuditRows.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                No rows in this audit category.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-md max-h-64 overflow-y-auto">
                <table className="w-full table-fixed text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <tr>
                      <th className="py-2 px-2.5 w-[11%]">Date</th>
                      <th className="py-2 px-2.5 w-[16%]">Category</th>
                      <th className="py-2 px-2.5 w-[20%]">Vendor / Name</th>
                      <th className="py-2 px-2.5 w-[20%]">Account → Split</th>
                      <th className="py-2 px-2.5 w-[11%] text-right">Amount</th>
                      <th className="py-2 px-2.5 w-[22%]">Audit Treatment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAuditRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="py-1.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {row.date}
                        </td>
                        <td className="py-1.5 px-3 font-medium whitespace-nowrap">
                          <span
                            className={
                              row.category === 'unmapped'
                                ? 'text-amber-700'
                                : 'text-slate-700'
                            }
                          >
                            {AUDIT_CATEGORY_LABELS[row.category]}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-slate-800">{row.vendor}</td>
                        <td className="py-1.5 px-3 font-mono text-[11px] text-slate-600">
                          {row.account || '—'} → {row.split_account || '—'}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {formatCurrencyExact(row.amount)}
                        </td>
                        <td className="py-1.5 px-3 text-[11px] text-slate-500">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4-Column Executive KPI Strip */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Projected 2026 Gross Receipts</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencyExact(computed.totalRevenue.projected)}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            {setup.multi_state_active
              ? `${pCode} ${computed.caPct.projected}% · ${sCode} ${computed.azPct.projected}%`
              : `${pCode} 100%`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Projected 1120-S Ordinary Income</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            {priorYearLabel} {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
            {k1DiffFromSchedule !== null && Math.abs(k1DiffFromSchedule) >= 1
              ? ` · Schedule Δ ${formatCurrencyExact(k1DiffFromSchedule, true)}`
              : ` · Synced w/ ${cadenceState.projection_year}`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Projected Member Draws</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencyExact(computed.projectedDrawsTotal)}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            YTD {formatCurrencyExact(bs.member_draws_ytd)} · Rem{' '}
            {formatCurrencyExact(bs.member_draws_remaining)}
          </div>
        </div>

        {showStockBasis && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Projected Ending Stock Basis</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                computed.drawsExceedBasis ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {formatCurrencyExact(computed.projectedEndingStockBasis)}
            </div>
            <div
              className={`text-xs font-medium mt-1 ${
                computed.drawsExceedBasis ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {computed.drawsExceedBasis
                ? `Alert: Excess gain ${formatCurrencyExact(computed.projectedExcessDistributionGain)}`
                : `Safe · Cushion before draws ${formatCurrencyExact(
                    computed.basisAvailableBeforeDraws - computed.projectedDrawsTotal
                  )}`}
            </div>
          </div>
        )}
      </div>

      {/* Planning Goals & Guardrails Selector (Live Evaluation + Auto-Included in CPA Package & CSV) */}
      <div className="no-print">
        <PlanningGoalsPanel
          setup={setup}
          goals={planningGoals}
          computed={computed}
          pnlState={pnlState}
          onUpdateGoals={onUpdatePlanningGoals}
        />
      </div>

      {/* ================================================================= */}
      {/* 1. Interactive Detected Cadence & Remaining-Year Schedule Drawer  */}
      {/* ================================================================= */}
      <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowCadenceDrawer((v) => !v)}
              className="flex items-start gap-2 text-left min-w-0 flex-1"
            >
              {showCadenceDrawer ? (
                <ChevronDown className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-teal-800 shrink-0" />
                  <span>1. Detected Cadence &amp; Remaining-Year Schedule</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                  {isCategoryMode
                    ? `${forecast.categoryCount} operational P&L categories (from ${forecast.granularStreamCount} streams · Balance Sheet excluded) · Toggle lumpy lines to Exp. Smooth (α=${forecast.expSmoothAlpha.toFixed(2)}) in 1 click.`
                    : `${forecast.granularStreamCount} vendor/account streams · Mode A counts calendar occurrences after ${forecast.asOfDate} through 12/31; Mode B projects variable pace (${forecast.remainingDays}/${forecast.elapsedDays}d); Mode C defaults discretionary items to $0.`}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handlePush}
              disabled={!canPushForecast}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-45 disabled:cursor-not-allowed shadow-xs transition-colors whitespace-nowrap shrink-0"
              title={
                canPushForecast
                  ? `Push projected ${pnlState.projection_year} state-split Gross Revenue, Officer W-2, SEHI, Operating Expenses, and Member Draws directly into the Six-Year Horizon schedule`
                  : 'Import QBO transactions or enter projected figures before pushing to the 6-Year Horizon'
              }
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span>Push Forecast to 6-Year Horizon</span>
            </button>
          </div>

          {pushToast && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="leading-snug">
                  <strong className="font-semibold">{pushToast.taxYear} Horizon updated:</strong>{' '}
                  K-1{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatCurrency(pushToast.newK1)}
                  </span>{' '}
                  <span className="font-mono text-emerald-800">
                    ({formatSignedDelta(pushToast.k1Delta)})
                  </span>{' '}
                  · Total All-In Tax{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatCurrency(pushToast.newAllInTax)}
                  </span>{' '}
                  <span className="font-mono text-emerald-800">
                    ({formatSignedDelta(pushToast.taxDelta)})
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate('horizon')}
                  className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:text-teal-950 whitespace-nowrap"
                >
                  <span>View 6-Year Horizon</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPushToast(null)}
                  className="text-emerald-700 hover:text-emerald-950"
                  aria-label="Dismiss push confirmation"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {showCadenceDrawer && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={streamSearch}
                  onChange={(e) => setStreamSearch(e.target.value)}
                  placeholder={
                    isCategoryMode
                      ? 'Filter P&L category or payee...'
                      : 'Filter vendor or account...'
                  }
                  className="pl-8 pr-3 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 w-52"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                {(
                  [
                    ['all', `All (${streamCounts.all})`],
                    ['cadence', `Cadence (${streamCounts.cadence})`],
                    ['exp_smooth', `Exp. Smooth (${streamCounts.exp_smooth})`],
                    ...(!isCategoryMode || streamCounts.run_rate > 0
                      ? ([['run_rate', `Run-Rate (${streamCounts.run_rate})`]] as const)
                      : []),
                    ['one_time', `Exclude $0 (${streamCounts.one_time})`],
                    ...(streamCounts.flagged > 0
                      ? ([['flagged', `Flagged (${streamCounts.flagged})`]] as const)
                      : []),
                    ['overridden', `Overrides (${streamCounts.overridden})`],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => handleSelectStreamFilter(tab)}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      streamFilter === tab
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Active-Only Filter Bar ("Hide Excl. $0 Rows") + P&L Category / Granular View Mode + Payee Aliases */}
        {showCadenceDrawer && (
          <datalist id="canonical-payee-suggestions">
            {canonicalPayeeSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}

        {showCadenceDrawer && (
          <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Group by P&L Category vs Granular Streams View Switch */}
              <div
                role="group"
                aria-label="Forecast row grouping mode"
                className="inline-flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200/90"
              >
                <button
                  type="button"
                  onClick={() => handleGroupingModeChange('category')}
                  aria-pressed={isCategoryMode}
                  title="Roll up operational P&L transactions into clean P&L categories (excludes bank/card/equity/liability Balance Sheet accounts while preserving multi-state revenue sourcing, 50% Meals, and Schedule K tax rules)."
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    isCategoryMode
                      ? 'bg-teal-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>Group by P&amp;L Category ({forecast.categoryCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGroupingModeChange('stream')}
                  aria-pressed={!isCategoryMode}
                  title="View and forecast every individual vendor/description stream separately."
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    !isCategoryMode
                      ? 'bg-teal-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5 shrink-0" />
                  <span>Granular Streams ({forecast.granularStreamCount})</span>
                </button>
              </div>

              <span aria-hidden="true" className="text-slate-300 hidden sm:inline">|</span>

              <button
                type="button"
                role="switch"
                aria-checked={hideExcludedZeroRows}
                onClick={handleToggleHideExcludedZero}
                title="Display-only filter — hides Excl. $0 rows while reviewing without altering YTD totals, remaining projections, or CPA report numbers."
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  hideExcludedZeroRows
                    ? 'bg-teal-800 text-white border-teal-800 hover:bg-teal-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {hideExcludedZeroRows ? (
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span>Hide Excl. $0 Rows</span>
              </button>

              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono tabular-nums bg-slate-100 text-slate-700 border border-slate-200/80">
                {hideExcludedZeroRows
                  ? `Showing ${filteredStreams.length} active ${
                      isCategoryMode
                        ? filteredStreams.length === 1
                          ? 'category'
                          : 'categories'
                        : filteredStreams.length === 1
                        ? 'stream'
                        : 'streams'
                    } · ${hiddenExcludedZeroCount} Excl. $0 hidden`
                  : `Showing ${filteredStreams.length} of ${streamCounts.all} ${
                      isCategoryMode
                        ? streamCounts.all === 1
                          ? 'category'
                          : 'categories'
                        : streamCounts.all === 1
                        ? 'stream'
                        : 'streams'
                    } · ${streamCounts.one_time} Excl. $0`}
              </span>
              {hideExcludedZeroRows && (
                <span className="text-[11px] text-slate-400 hidden xl:inline">
                  Display filter only · YTD &amp; CPA totals unchanged
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAliasPanel((v) => !v)}
              aria-expanded={showAliasPanel}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium border transition-colors whitespace-nowrap ${
                showAliasPanel || payeeAliases.length > 0
                  ? 'bg-teal-50 text-teal-900 border-teal-200 hover:bg-teal-100/70'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <GitMerge className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              <span>
                Payee / Description Aliases ({payeeAliases.length}
                {forecast.aliasedTransactionCount > 0
                  ? ` · ${forecast.aliasedTransactionCount} txns`
                  : ''}
                )
              </span>
              {showAliasPanel ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
            </button>
          </div>
        )}

        {/* Collapsible Payee / Description Aliases Panel */}
        {showCadenceDrawer && showAliasPanel && (
          <div className="px-5 py-4 bg-slate-50/70 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5 text-teal-800" />
                  <span>Payee / Description Alias Rules (Merge Split Descriptions)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Rules run before stream grouping, cadence detection, run-rate, and exponential smoothing so split descriptions (e.g., &ldquo;PayPal&rdquo; → &ldquo;Cowie Pokey&rdquo;) combine into one unified stream. Saved automatically in browser storage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAliasPanel(false)}
                className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Collapse
              </button>
            </div>

            <form
              onSubmit={handleSubmitAliasForm}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-white border border-slate-200 rounded-md p-3"
            >
              <div className="sm:col-span-4">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Raw Import Text / Pattern
                </label>
                <input
                  type="text"
                  value={aliasPatternDraft}
                  onChange={(e) => setAliasPatternDraft(e.target.value)}
                  placeholder='e.g., PayPal or AMZN Mktp'
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Match Mode
                </label>
                <select
                  value={aliasMatchTypeDraft}
                  onChange={(e) => setAliasMatchTypeDraft(e.target.value as PayeeAliasMatchType)}
                  className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700"
                >
                  <option value="contains">Contains</option>
                  <option value="exact">Exact match</option>
                </select>
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Canonical Payee / Stream Name
                </label>
                <input
                  type="text"
                  list="canonical-payee-suggestions"
                  value={aliasCanonicalDraft}
                  onChange={(e) => setAliasCanonicalDraft(e.target.value)}
                  placeholder="e.g., Cowie Pokey"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="sm:col-span-2 flex items-center gap-1.5">
                <button
                  type="submit"
                  disabled={!aliasPatternDraft.trim() || !aliasCanonicalDraft.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-800 rounded hover:bg-teal-900 disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {editingAliasId ? 'Save' : 'Add Rule'}
                </button>
                {editingAliasId && (
                  <button
                    type="button"
                    onClick={handleCancelEditAlias}
                    className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            {payeeAliases.length === 0 ? (
              <div className="text-[11px] text-slate-500 bg-white border border-dashed border-slate-200 rounded-md px-3 py-2.5">
                No alias rules configured yet. Add a rule above—or click{' '}
                <span className="font-medium text-slate-700">Merge / Alias</span> on any stream row
                below—to combine split payee descriptions into a single stream.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 px-3">Raw Pattern</th>
                      <th className="py-1.5 px-2.5">Match</th>
                      <th className="py-1.5 px-3">Canonical Payee / Stream</th>
                      <th className="py-1.5 px-3 text-right">Matched Txns</th>
                      <th className="py-1.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payeeAliases.map((rule) => {
                      const matches = forecast.aliasMatchCounts[rule.id] ?? 0;
                      const isEditing = editingAliasId === rule.id;
                      return (
                        <tr
                          key={rule.id}
                          className={isEditing ? 'bg-teal-50/40' : 'hover:bg-slate-50/70'}
                        >
                          <td className="py-1.5 px-3 font-mono text-slate-800">
                            &ldquo;{rule.pattern}&rdquo;
                          </td>
                          <td className="py-1.5 px-2.5 text-[11px] text-slate-600 whitespace-nowrap">
                            {rule.match_type === 'exact' ? 'Exact' : 'Contains'}
                          </td>
                          <td className="py-1.5 px-3 font-medium text-slate-900">
                            <span className="text-slate-400 mr-1.5">→</span>
                            {rule.canonical_name}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums text-[11px]">
                            <span className={matches > 0 ? 'text-teal-800 font-medium' : 'text-slate-400'}>
                              {matches} {matches === 1 ? 'txn' : 'txns'}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditAlias(rule)}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-teal-800"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAlias(rule.id)}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-700"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Monthly Exponential Smoothing Controls Toolbar */}
        {showCadenceDrawer && (
          <div className="px-5 py-2.5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <ExpSmoothHoverTooltip>
                  <span
                    tabIndex={0}
                    className="inline-flex items-center gap-1 font-semibold text-slate-700 whitespace-nowrap cursor-help focus:outline-none focus:text-teal-800"
                  >
                    <span>Exp. Smooth α</span>
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                  </span>
                </ExpSmoothHoverTooltip>
                <input
                  type="range"
                  aria-label="Exponential smoothing factor alpha"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={forecast.expSmoothAlpha}
                  onChange={(e) => handleAlphaChange(Number(e.target.value))}
                  className="w-24 accent-teal-800 cursor-pointer"
                />
                <input
                  type="number"
                  aria-label="Exponential smoothing factor alpha numeric input"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={forecast.expSmoothAlpha.toFixed(2)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) handleAlphaChange(v);
                  }}
                  className="w-16 px-1.5 py-0.5 text-right text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700"
                />
                <button
                  type="button"
                  onClick={handleResetAlpha}
                  disabled={Math.abs(forecast.expSmoothAlpha - DEFAULT_EXP_SMOOTH_ALPHA) < 0.001}
                  className="px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
                >
                  Reset to 0.50
                </button>
              </div>

              <span aria-hidden="true" className="text-slate-300 hidden sm:inline">|</span>

              <label
                className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none"
                title="Default (unchecked) uses smoothed level S_T directly when ~1 month or less remains (<=45 days). Check to scale S_T by remainingDays / 30.4375."
              >
                <input
                  type="checkbox"
                  checked={forecast.expSmoothDayFraction}
                  onChange={(e) => handleToggleDayFraction(e.target.checked)}
                  className="rounded border-slate-300 accent-teal-800"
                />
                <span>
                  Scale S<sub>T</sub> by exact day-fraction ({forecast.remainingDays}/30.44d ={' '}
                  {(forecast.remainingDays / 30.4375).toFixed(2)}×)
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleApplyExpSmoothToVariable}
                disabled={variableEligibleStreams.length === 0}
                title={
                  isCategoryMode
                    ? 'Switches all irregular/lumpy P&L categories with 2+ active months to Monthly Exp. Smooth, keeping exact calendar-scheduled categories, Exclude ($0) items, and Manual overrides untouched.'
                    : 'Applies Monthly Exp. Smooth to all variable Run-Rate streams with 2+ active months, keeping Cadence bills, Exclude ($0) items, and Manual overrides untouched.'
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100/80 disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
              >
                {isCategoryMode
                  ? `Exp. Smooth Irregular Categories (${variableEligibleStreams.length})`
                  : `Apply Exp. Smooth to Variable Streams (${variableEligibleStreams.length})`}
              </button>
              {variableOnExpSmoothCount > 0 && (
                <button
                  type="button"
                  onClick={handleRevertVariableToRunRate}
                  className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap"
                >
                  {isCategoryMode
                    ? `Revert Irregular to Cadence (${variableOnExpSmoothCount})`
                    : `Revert Variable to Run-Rate (${variableOnExpSmoothCount})`}
                </button>
              )}
            </div>
          </div>
        )}

        {showCadenceDrawer && (
          <div className="max-h-[540px] overflow-y-auto overflow-x-hidden">
            {filteredStreams.length === 0 ? (
              <div className="py-10 px-6 text-center text-xs text-slate-500">
                {isCategoryMode
                  ? 'No P&L categories match your current filter.'
                  : 'No vendor/account streams match your current filter.'}
              </div>
            ) : (
              <table className="w-full table-fixed text-left border-collapse">
                <colgroup>
                  {isCategoryMode ? (
                    <>
                      <col className="w-[20%]" />
                      <col className="w-[14.5%]" />
                      <col className="w-[16.5%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10.5%]" />
                      <col className="w-[10%]" />
                      <col className="w-[18.5%]" />
                    </>
                  ) : (
                    <>
                      <col className="w-[19%]" />
                      <col className="w-[13%]" />
                      <col className="w-[15%]" />
                      <col className="w-[9%]" />
                      <col className="w-[8.5%]" />
                      <col className="w-[6.5%]" />
                      <col className="w-[10.5%]" />
                      <col className="w-[18.5%]" />
                    </>
                  )}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="py-2 px-2.5">
                      {isCategoryMode ? 'P&L Category' : 'Vendor / Stream'}
                    </th>
                    <th className="py-2 px-2">
                      {isCategoryMode ? '1120-S / Tax Rule' : 'Target Line'}
                    </th>
                    <th className="py-2 px-2">
                      {isCategoryMode ? 'Cadence / Smoothing' : 'Cadence / Basis'}
                    </th>
                    <th className="py-2 px-2 text-right">YTD Actual</th>
                    {!isCategoryMode && (
                      <>
                        <th className="py-2 px-1.5 text-right">Latest</th>
                        <th className="py-2 px-1.5 text-right">Basis</th>
                      </>
                    )}
                    <th className="py-2 px-2 text-right">Remaining ($)</th>
                    {isCategoryMode && (
                      <th className="py-2 px-2 text-right">Proj. YE</th>
                    )}
                    <th className="py-2 px-2 text-right">
                      {isCategoryMode ? (
                        <ExpSmoothHoverTooltip>
                          <span
                            tabIndex={0}
                            className="inline-flex items-center justify-end gap-1 cursor-help focus:outline-none focus:text-teal-800"
                          >
                            <span>Mode / Actions</span>
                            <Info className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                          </span>
                        </ExpSmoothHoverTooltip>
                      ) : (
                        'Mode / Actions'
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredStreams.map((s) => {
                    const targetLabel = lineLabelMap.get(s.targetLineId) ?? s.targetLineId;
                    const cadenceTone =
                      s.activeMode === 'cadence'
                        ? 'text-teal-800 font-medium'
                        : s.activeMode === 'exp_smooth'
                        ? 'text-sky-800 font-medium'
                        : s.activeMode === 'manual'
                        ? 'text-amber-800 font-medium'
                        : s.activeMode === 'one_time'
                        ? 'text-slate-500'
                        : 'text-slate-700';

                    const remCountDisplay =
                      s.activeMode === 'cadence'
                        ? `${s.remainingCount} occ.`
                        : s.activeMode === 'exp_smooth'
                        ? `α=${forecast.expSmoothAlpha.toFixed(2)}`
                        : s.activeMode === 'run_rate'
                        ? `${forecast.remainingDays}/${forecast.elapsedDays}d`
                        : s.activeMode === 'manual'
                        ? 'Manual'
                        : '0';

                    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const latestMonthNum = Number(s.latestMonthLabel.slice(5, 7));
                    const latestMonthShort = monthShortNames[latestMonthNum - 1] ?? s.latestMonthLabel;
                    const monthlyTooltip = [
                      `Monthly SES (${s.monthlySeries.length} mos · ${s.activeMonthCount} active · α=${forecast.expSmoothAlpha.toFixed(2)})`,
                      s.monthlySeries
                        .map((pt) => {
                          const mn = monthShortNames[Number(pt.month.slice(5, 7)) - 1] ?? pt.month;
                          return `${mn}: ${formatCurrencyExact(pt.amount)}`;
                        })
                        .join(' | '),
                      `S_T = ${formatCurrencyExact(s.expSmoothLevel)} · ${s.expSmoothScaleNote} → ${formatCurrencyExact(s.expSmoothRemainingAmount)}`,
                    ].join('\n');

                      const isQuickMergeOpen = quickMergeStreamKey === s.streamKey;
                      const sameLinePeers = isQuickMergeOpen
                        ? forecast.streams
                            .filter(
                              (peer) =>
                                peer.targetLineId === s.targetLineId &&
                                peer.streamKey !== s.streamKey
                            )
                            .slice(0, 6)
                        : [];

                      const projectedYearEnd = round2(s.ytdAmount + s.effectiveRemainingAmount);
                      const taxRuleTag =
                        s.targetLineId === 'ca_revenue'
                          ? { label: `${pCode} Source`, cls: 'bg-sky-50 text-sky-800 border-sky-200' }
                          : s.targetLineId === 'az_revenue'
                          ? { label: `${sCode} Source`, cls: 'bg-amber-50 text-amber-800 border-amber-200' }
                          : s.targetLineId === 'meals_gross'
                          ? { label: '50% Meals · M-1', cls: 'bg-rose-50 text-rose-800 border-rose-200' }
                          : s.targetLineId === 'schedule_k_interest'
                          ? { label: 'Sch K · Separate', cls: 'bg-teal-50 text-teal-800 border-teal-200' }
                          : null;

                      const payeeTooltip =
                        isCategoryMode && s.mergedRawVendors.length > 0
                          ? `Included payees (${s.mergedRawVendors.length}): ${s.mergedRawVendors.join(', ')}`
                          : undefined;

                      return (
                      <tr key={s.streamKey} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2 px-2.5 align-top break-words" title={payeeTooltip}>
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="font-medium text-slate-900 leading-snug break-words min-w-0">
                              {s.vendor}
                            </div>
                            {!isCategoryMode && (
                              <button
                                type="button"
                                onClick={() => handleOpenQuickMerge(s.streamKey, s.vendor)}
                                title="Map this raw description to an existing or canonical payee name"
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                                  isQuickMergeOpen
                                    ? 'bg-teal-800 text-white border-teal-800'
                                    : 'bg-white text-slate-500 border-slate-200 hover:text-teal-800 hover:border-teal-300'
                                }`}
                              >
                                <GitMerge className="w-2.5 h-2.5" />
                                Merge
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono tabular-nums leading-tight break-words">
                            {isCategoryMode ? (
                              <>
                                {s.transactionCount} {s.transactionCount === 1 ? 'txn' : 'txns'}
                                {s.subStreamCount
                                  ? ` · ${s.subStreamCount} ${
                                      s.subStreamCount === 1 ? 'payee' : 'payees'
                                    }`
                                  : ''}
                                {' · '}last {s.latestDate}
                              </>
                            ) : (
                              <>
                                {s.transactionCount} {s.transactionCount === 1 ? 'txn' : 'txns'} ·{' '}
                                {s.latestDate}
                                {s.sourceAccounts.length > 0 ? ` · ${s.sourceAccounts.join(', ')}` : ''}
                              </>
                            )}
                          </div>
                          {isCategoryMode && s.mergedRawVendors.length > 0 && (
                            <div className="text-[10px] text-slate-400 mt-0.5 leading-tight break-words line-clamp-2">
                              {s.mergedRawVendors.slice(0, 3).join(', ')}
                              {s.mergedRawVendors.length > 3
                                ? ` +${s.mergedRawVendors.length - 3} more`
                                : ''}
                            </div>
                          )}
                          {!isCategoryMode && s.isAliased && (
                            <div className="text-[10px] text-teal-800 mt-0.5 flex items-start gap-1 break-words">
                              <GitMerge className="w-3 h-3 shrink-0 mt-0.5" />
                              <span className="leading-tight">
                                Aliased ({s.appliedAliasCount}{' '}
                                {s.appliedAliasCount === 1 ? 'txn' : 'txns'}
                                {s.mergedRawVendors.length > 1
                                  ? ` · merged: ${s.mergedRawVendors.join(', ')}`
                                  : s.mergedRawVendors.length === 1 &&
                                      s.mergedRawVendors[0].toLowerCase() !==
                                        s.vendor.toLowerCase()
                                    ? ` · from: ${s.mergedRawVendors[0]}`
                                    : ''}
                                )
                              </span>
                            </div>
                          )}
                          {s.hasTransferFlag && s.flaggedTransferNote && (
                            <div className="text-[10px] text-amber-700 mt-0.5 flex items-start gap-1 leading-tight break-words">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{s.flaggedTransferNote}</span>
                            </div>
                          )}
                          {!isCategoryMode && isQuickMergeOpen && (
                            <div className="mt-2 p-2.5 bg-slate-50 border border-teal-200 rounded-md space-y-2">
                              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-teal-900">
                                <span>Merge &ldquo;{s.vendor}&rdquo; into canonical payee</span>
                                <button
                                  type="button"
                                  onClick={() => setQuickMergeStreamKey(null)}
                                  className="text-slate-400 hover:text-slate-700"
                                  aria-label="Close merge editor"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>

                              {sameLinePeers.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-slate-500">
                                    1-click merge into stream on {targetLabel}:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {sameLinePeers.map((peer) => (
                                      <button
                                        key={peer.streamKey}
                                        type="button"
                                        onClick={() =>
                                          handleApplyQuickMerge(
                                            quickMergePattern || s.vendor,
                                            peer.vendor,
                                            quickMergeMatchType
                                          )
                                        }
                                        className="px-2 py-0.5 text-[10px] font-medium text-teal-900 bg-white border border-teal-200 rounded hover:bg-teal-50 transition-colors"
                                      >
                                        → {peer.vendor}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="text"
                                  value={quickMergePattern}
                                  onChange={(e) => setQuickMergePattern(e.target.value)}
                                  placeholder="Match text"
                                  className="w-28 px-2 py-1 text-[11px] bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700"
                                />
                                <select
                                  value={quickMergeMatchType}
                                  onChange={(e) =>
                                    setQuickMergeMatchType(e.target.value as PayeeAliasMatchType)
                                  }
                                  className="px-1.5 py-1 text-[11px] bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:border-teal-700"
                                >
                                  <option value="contains">Contains</option>
                                  <option value="exact">Exact</option>
                                </select>
                                <span className="text-[11px] text-slate-400">→</span>
                                <input
                                  type="text"
                                  list="canonical-payee-suggestions"
                                  value={quickMergeCanonical}
                                  onChange={(e) => setQuickMergeCanonical(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleApplyQuickMerge(
                                        quickMergePattern,
                                        quickMergeCanonical,
                                        quickMergeMatchType
                                      );
                                    } else if (e.key === 'Escape') {
                                      setQuickMergeStreamKey(null);
                                    }
                                  }}
                                  placeholder="Canonical payee name..."
                                  className="flex-1 min-w-[140px] px-2 py-1 text-[11px] bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                                />
                                <button
                                  type="button"
                                  disabled={!quickMergePattern.trim() || !quickMergeCanonical.trim()}
                                  onClick={() =>
                                    handleApplyQuickMerge(
                                      quickMergePattern,
                                      quickMergeCanonical,
                                      quickMergeMatchType
                                    )
                                  }
                                  className="px-2.5 py-1 text-[11px] font-medium text-white bg-teal-800 rounded hover:bg-teal-900 disabled:opacity-40 transition-colors whitespace-nowrap"
                                >
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 align-top text-[11px] text-slate-700 leading-snug break-words">
                          <div>{targetLabel}</div>
                          {isCategoryMode && taxRuleTag && (
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.2 text-[10px] font-medium rounded border whitespace-nowrap ${taxRuleTag.cls}`}
                            >
                              {taxRuleTag.label}
                            </span>
                          )}
                        </td>
                        <td
                          className={`py-2 px-2 align-top text-[11px] font-mono leading-snug break-words ${cadenceTone}`}
                          title={monthlyTooltip}
                        >
                          {s.activeMode === 'exp_smooth' ? (
                            <div>
                              <div>
                                Exp. Smooth (α={forecast.expSmoothAlpha.toFixed(2)}) ·{' '}
                                {s.monthlySeries.length}m
                              </div>
                              <div className="text-[10px] text-slate-500 font-normal tabular-nums mt-0.5">
                                {latestMonthShort} {formatCurrencyExact(s.latestMonthActual)} → S
                                <sub>T</sub> {formatCurrencyExact(s.expSmoothLevel)}
                                {forecast.expSmoothDayFraction || forecast.remainingDays > 45
                                  ? ` · ${s.expSmoothScaleNote}`
                                  : ''}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div>{s.cadenceLabel}</div>
                              {s.activeMonthCount >= 2 &&
                                (isCategoryMode || s.detectedMode === 'run_rate') && (
                                  <div className="text-[10px] text-slate-400 font-normal tabular-nums mt-0.5">
                                    SES ({forecast.expSmoothAlpha.toFixed(2)}):{' '}
                                    {formatCurrencyExact(s.expSmoothRemainingAmount)}
                                  </div>
                                )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 align-top text-right font-mono tabular-nums text-[11px] text-slate-700 whitespace-nowrap">
                          {formatCurrencyExact(s.ytdAmount)}
                        </td>
                        {!isCategoryMode && (
                          <>
                            <td className="py-2 px-1.5 align-top text-right font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                              {formatCurrencyExact(s.latestAmount)}
                            </td>
                            <td
                              className="py-2 px-1.5 align-top text-right font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap"
                              title={monthlyTooltip}
                            >
                              {remCountDisplay}
                            </td>
                          </>
                        )}
                        <td className="py-2 px-2 align-top text-right bg-teal-50/15">
                          {renderEditableCell(
                            `stream:${s.streamKey}`,
                            s.effectiveRemainingAmount,
                            (draft) => handleStreamManualAmountCommit(s.streamKey, draft),
                            {
                              bold: s.effectiveRemainingAmount !== 0,
                              accent: s.activeMode === 'cadence' || s.activeMode === 'exp_smooth',
                            }
                          )}
                        </td>
                        {isCategoryMode && (
                          <td className="py-2 px-2 align-top text-right font-mono tabular-nums text-[11px] font-semibold text-slate-900 whitespace-nowrap">
                            {formatCurrencyExact(projectedYearEnd)}
                          </td>
                        )}
                        <td className="py-2 px-2 align-top text-right">
                          {isCategoryMode ? (
                            <div className="flex flex-col items-end gap-1">
                              <div
                                role="group"
                                aria-label={`Forecast mode for ${s.vendor}`}
                                className="inline-flex flex-wrap justify-end items-center bg-slate-100 p-0.5 rounded border border-slate-200/80"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStreamModeChange(
                                      s.streamKey,
                                      'cadence',
                                      s.effectiveRemainingAmount
                                    )
                                  }
                                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap ${
                                    s.activeMode === 'cadence'
                                      ? 'bg-teal-800 text-white shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  Cadence
                                </button>
                                <ExpSmoothHoverTooltip>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={s.activeMode === 'exp_smooth'}
                                    onClick={() =>
                                      handleToggleCategoryExpSmooth(
                                        s.streamKey,
                                        s.activeMode,
                                        s.detectedMode
                                      )
                                    }
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap ${
                                      s.activeMode === 'exp_smooth'
                                        ? 'bg-sky-700 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-sky-800'
                                    }`}
                                  >
                                    <span>Smooth</span>
                                  </button>
                                </ExpSmoothHoverTooltip>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStreamModeChange(
                                      s.streamKey,
                                      'one_time',
                                      s.effectiveRemainingAmount
                                    )
                                  }
                                  title="Set remaining forecast to $0"
                                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap ${
                                    s.activeMode === 'one_time'
                                      ? 'bg-slate-700 text-white shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  Set $0
                                </button>
                              </div>

                              {(s.activeMode === 'manual' || s.isOverridden) && (
                                <div className="inline-flex items-center gap-1.5">
                                  {s.activeMode === 'manual' && (
                                    <span className="px-1.5 py-0.2 text-[10px] font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                                      Manual
                                    </span>
                                  )}
                                  {s.isOverridden && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetStreamOverride(s.streamKey)}
                                      title="Reset category to default Cadence baseline"
                                      className="text-[10px] font-medium text-teal-700 hover:text-teal-900 underline whitespace-nowrap"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <div
                                role="group"
                                aria-label={`Forecast mode for ${s.vendor}`}
                                className="inline-flex flex-wrap justify-end items-center gap-0.5 bg-slate-100 p-0.5 rounded border border-slate-200/80"
                              >
                                {(
                                  [
                                    ['cadence', 'Cad'],
                                    ['exp_smooth', 'Smooth'],
                                    ['run_rate', 'Rate'],
                                    ['manual', 'Man'],
                                    ['one_time', 'Set $0'],
                                  ] as const
                                ).map(([modeKey, modeLabel]) => {
                                  const isActive = s.activeMode === modeKey;
                                  const modeButton = (
                                    <button
                                      key={modeKey}
                                      type="button"
                                      onClick={() =>
                                        handleStreamModeChange(
                                          s.streamKey,
                                          modeKey,
                                          s.effectiveRemainingAmount
                                        )
                                      }
                                      title={
                                        modeKey === 'cadence'
                                          ? 'Calendar Cadence'
                                          : modeKey === 'exp_smooth'
                                          ? 'Monthly Exponential Smoothing'
                                          : modeKey === 'run_rate'
                                          ? 'Variable Run-Rate'
                                          : modeKey === 'manual'
                                          ? 'Manual Override'
                                          : 'Set remaining forecast to $0'
                                      }
                                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap ${
                                        isActive
                                          ? modeKey === 'cadence'
                                            ? 'bg-teal-800 text-white shadow-xs'
                                            : modeKey === 'exp_smooth'
                                            ? 'bg-sky-700 text-white shadow-xs'
                                            : modeKey === 'manual'
                                            ? 'bg-amber-700 text-white shadow-xs'
                                            : modeKey === 'one_time'
                                            ? 'bg-slate-700 text-white shadow-xs'
                                            : 'bg-white text-slate-900 shadow-xs'
                                          : 'text-slate-600 hover:text-slate-900'
                                      }`}
                                    >
                                      <span>{modeLabel}</span>
                                    </button>
                                  );
                                  return modeKey === 'exp_smooth' ? (
                                    <ExpSmoothHoverTooltip key={modeKey}>
                                      {modeButton}
                                    </ExpSmoothHoverTooltip>
                                  ) : (
                                    modeButton
                                  );
                                })}
                              </div>
                              {s.isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => handleResetStreamOverride(s.streamKey)}
                                  title="Reset to auto-detected cadence"
                                  className="text-[10px] font-medium text-teal-700 hover:text-teal-900 underline whitespace-nowrap"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {showCadenceDrawer && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Proj. {pnlState.projection_year} Revenue:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {formatCurrencyExact(computed.totalRevenue.projected)}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                Proj. 1120-S Line 22 (K-1):{' '}
                <strong className="font-mono tabular-nums text-teal-900">
                  {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                Draws:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {formatCurrencyExact(computed.projectedDrawsTotal)}
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={handlePush}
              disabled={!canPushForecast}
              title={
                canPushForecast
                  ? `Push projected ${pnlState.projection_year} forecast to the Six-Year Horizon schedule`
                  : 'Import QBO transactions or enter projected figures before pushing to the 6-Year Horizon'
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span>Push Forecast to 6-Year Horizon</span>
            </button>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* 2. Profit & Loss Projection Table (Form 1120-S Structure)         */}
      {/* ================================================================= */}
      <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              2. Profit &amp; Loss Projection (Form 1120-S Structure)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aggregated from detected transaction cadence streams with full two-way inline editing (editing Projected Full Year back-solves Remaining Forecast).
            </p>
          </div>
        </div>

        <div>
          <table className="w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3 w-[40%]">Line Item</th>
                <th className="py-2.5 px-2.5 text-right w-[15%]">YTD Actuals</th>
                <th className="py-2.5 px-2.5 text-right w-[15%]">Remaining</th>
                <th className="py-2.5 px-2.5 text-right w-[15%]">Projected Full Yr</th>
                <th className="py-2.5 px-3 text-right w-[15%] text-slate-500">{priorYearLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {PNL_SECTIONS.map((section) => {
                const items = PNL_OPERATING_ITEMS.filter((i) => i.section === section.id);
                return (
                  <React.Fragment key={section.id}>
                    <tr className="bg-slate-50/90 border-t border-slate-200">
                      <td colSpan={5} className="py-2 px-4">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {section.title}
                          </span>
                          <span className="text-[11px] text-slate-500">{section.subtitle}</span>
                        </div>
                      </td>
                    </tr>

                    {items.map((item) => {
                      const vals = computed.lines[item.id];
                      const label = getPnlLineLabel(item, setup);
                      const lineOv = cadenceState.pnl_line_overrides[item.id];
                      const hasRemOv = lineOv?.remaining !== undefined;
                      const hasYtdOv = lineOv?.ytd !== undefined;

                      return (
                        <React.Fragment key={item.id}>
                          <tr className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-2 px-4 align-top">
                              <div className="font-medium text-slate-800">{label}</div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                                <span className="font-mono">{item.form1120sRef}</span>
                                {item.note && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{item.note}</span>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right align-top">
                              {renderEditableCell(
                                `pnl:${item.id}:ytd`,
                                vals.ytd,
                                (d) => commitPnlEdit(item.id, 'ytd', d),
                                {
                                  subLabel: hasYtdOv ? 'Manual YTD' : undefined,
                                  resetAction: hasYtdOv
                                    ? () => resetPnlLineOverride(item.id)
                                    : undefined,
                                }
                              )}
                            </td>
                            <td className="py-2 px-3 text-right align-top">
                              {renderEditableCell(
                                `pnl:${item.id}:rem`,
                                vals.remaining,
                                (d) => commitPnlEdit(item.id, 'remaining', d),
                                {
                                  subLabel: hasRemOv
                                    ? 'Manual'
                                    : (item.id === 'dbp_contribution' ||
                                        item.id === 'employer_401k') &&
                                      Boolean(year2026Computed) &&
                                      (vals.remaining > 0 || vals.projected > 0)
                                    ? 'Horizon Plan'
                                    : undefined,
                                  resetAction: hasRemOv
                                    ? () => resetPnlLineOverride(item.id)
                                    : undefined,
                                }
                              )}
                            </td>
                            <td className="py-2 px-3 text-right align-top bg-teal-50/20">
                              {renderEditableCell(
                                `pnl:${item.id}:proj`,
                                vals.projected,
                                (d) => commitPnlEdit(item.id, 'projected', d),
                                { bold: true, accent: true }
                              )}
                            </td>
                            <td className="py-2 px-4 text-right align-top font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {formatCurrencyExact(vals.filed2025)}
                            </td>
                          </tr>

                          {/* Automatic 50/50 Meals Schedule M-1 Split */}
                          {item.id === 'meals_gross' && (
                            <>
                              <tr className="bg-slate-50/40 text-[11px] text-slate-600">
                                <td className="py-1.5 pl-8 pr-4">
                                  ↳ 50% Deductible Meals (Included in 1120-S Operating Expenses)
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                                  {formatCurrencyExact(computed.mealsDeductible50.ytd)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                                  {formatCurrencyExact(computed.mealsDeductible50.remaining)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium text-slate-800 bg-teal-50/20">
                                  {formatCurrencyExact(computed.mealsDeductible50.projected)}
                                </td>
                                <td className="py-1.5 px-4 text-right font-mono tabular-nums text-slate-500">
                                  {formatCurrencyExact(computed.mealsDeductible50.filed2025)}
                                </td>
                              </tr>
                              <tr className="bg-amber-50/40 text-[11px] text-amber-900">
                                <td className="py-1.5 pl-8 pr-4">
                                  ↳ 50% Nondeductible Meals (Schedule M-1 Addback · Reduces Stock Basis)
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                                  {formatCurrencyExact(computed.mealsNondeductible50.ytd)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                                  {formatCurrencyExact(computed.mealsNondeductible50.remaining)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium bg-amber-50/60">
                                  {formatCurrencyExact(computed.mealsNondeductible50.projected)}
                                </td>
                                <td className="py-1.5 px-4 text-right font-mono tabular-nums text-amber-800/80">
                                  {formatCurrencyExact(computed.mealsNondeductible50.filed2025)}
                                </td>
                              </tr>
                            </>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Section Subtotals */}
                    {section.id === 'revenue' && (
                      <tr className="bg-teal-50/50 border-t border-slate-200 font-semibold">
                        <td className="py-2.5 px-4 align-top">
                          <div className="text-slate-900">Total Gross Receipts</div>
                          <div className="text-[11px] font-normal text-slate-500">
                            {setup.multi_state_active
                              ? `Auto-summed ${pCode} + ${sCode} revenue · Live state apportionment split`
                              : 'Auto-summed gross receipts'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-900">
                            {formatCurrencyExact(computed.totalRevenue.ytd)}
                          </div>
                          {setup.multi_state_active && (
                            <div className="text-[10px] font-mono tabular-nums font-normal text-teal-800 mt-0.5">
                              {pCode} {computed.caPct.ytd}% / {sCode} {computed.azPct.ytd}%
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-900">
                            {formatCurrencyExact(computed.totalRevenue.remaining)}
                          </div>
                          {setup.multi_state_active && (
                            <div className="text-[10px] font-mono tabular-nums font-normal text-teal-800 mt-0.5">
                              {pCode} {computed.caPct.remaining}% / {sCode} {computed.azPct.remaining}%
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-teal-900">
                            {formatCurrencyExact(computed.totalRevenue.projected)}
                          </div>
                          {setup.multi_state_active && (
                            <div className="text-[10px] font-mono tabular-nums font-medium text-teal-800 mt-0.5">
                              {pCode} {computed.caPct.projected}% / {sCode} {computed.azPct.projected}%
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalRevenue.filed2025)}
                          </div>
                          {setup.multi_state_active && (
                            <div className="text-[10px] font-mono tabular-nums font-normal text-slate-500 mt-0.5">
                              {pCode} {computed.caPct.filed2025}% / {sCode} {computed.azPct.filed2025}%
                            </div>
                          )}
                        </td>
                      </tr>
                    )}

                    {section.id === 'compensation' && (
                      <tr className="bg-slate-50/70 border-t border-slate-200 font-semibold text-slate-800">
                        <td className="py-2 px-4">Total W-2 Compensation</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalCompensation.ytd)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalCompensation.remaining)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 bg-teal-50/20">
                          {formatCurrencyExact(computed.totalCompensation.projected)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                          {formatCurrencyExact(computed.totalCompensation.filed2025)}
                        </td>
                      </tr>
                    )}

                    {section.id === 'retirement' && (
                      <tr className="bg-slate-50/70 border-t border-slate-200 font-semibold text-slate-800">
                        <td className="py-2 px-4">Total Retirement &amp; Benefits</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalRetirementBenefits.ytd)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalRetirementBenefits.remaining)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 bg-teal-50/20">
                          {formatCurrencyExact(computed.totalRetirementBenefits.projected)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                          {formatCurrencyExact(computed.totalRetirementBenefits.filed2025)}
                        </td>
                      </tr>
                    )}

                    {section.id === 'operating_expenses' && (
                      <tr className="bg-slate-100/70 border-t border-slate-200 font-semibold text-slate-900">
                        <td className="py-2.5 px-4 align-top">
                          <div>Total Operating Expenses (Excl. W-2 &amp; Retirement)</div>
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                            Excl. Payroll Taxes (1120-S / Horizon OpEx):{' '}
                            <span className="font-mono tabular-nums font-medium text-slate-700">
                              {formatCurrencyExact(computed.totalOperatingExpensesExclPayroll.projected)}
                            </span>{' '}
                            · Book total w/ 100% Meals:{' '}
                            <span className="font-mono tabular-nums">
                              {formatCurrencyExact(computed.totalOperatingExpensesBook.projected)}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right align-top font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalOperatingExpensesDeductible.ytd)}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top font-mono tabular-nums">
                          {formatCurrencyExact(computed.totalOperatingExpensesDeductible.remaining)}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top font-mono tabular-nums bg-teal-50/30">
                          {formatCurrencyExact(computed.totalOperatingExpensesDeductible.projected)}
                        </td>
                        <td className="py-2.5 px-4 text-right align-top font-mono tabular-nums text-slate-600">
                          {formatCurrencyExact(computed.totalOperatingExpensesDeductible.filed2025)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {/* Form 1120-S Line 22 Ordinary Business Income */}
              <tr className="bg-slate-900 text-white font-semibold">
                <td className="py-3 px-4 align-top">
                  <div className="text-xs font-semibold text-white">
                    Projected Ordinary Business Income (Form 1120-S Line 22)
                  </div>
                  <div className="text-[11px] font-normal text-slate-300 mt-0.5">
                    Flows to Schedule K-1 Box 1 ({primaryName} {computed.billSharePct}% /{' '}
                    {spouseName} {computed.debraSharePct}%) · Book Net Income (incl. Sch K Interest
                    &amp; 100% Meals):{' '}
                    <span className="font-mono tabular-nums">
                      {formatCurrencyExact(computed.bookNetIncome.projected)}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-3 text-right align-top font-mono tabular-nums text-slate-200 whitespace-nowrap">
                  {formatCurrencyExact(computed.ordinaryBusinessIncome.ytd)}
                </td>
                <td className="py-3 px-3 text-right align-top font-mono tabular-nums text-slate-200 whitespace-nowrap">
                  {formatCurrencyExact(computed.ordinaryBusinessIncome.remaining)}
                </td>
                <td className="py-3 px-3 text-right align-top font-mono tabular-nums text-white text-sm whitespace-nowrap">
                  {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
                </td>
                <td className="py-3 px-4 text-right align-top font-mono tabular-nums text-slate-300 whitespace-nowrap">
                  {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
                </td>
              </tr>

              {/* Separately Stated Schedule K Interest Income */}
              <tr className="bg-slate-50/90 border-t border-slate-200">
                <td colSpan={5} className="py-1.5 px-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      Schedule K Separately Stated Items
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Excluded from Line 22 Ordinary Income · Included in Form 7203 stock basis
                    </span>
                  </div>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/60 transition-colors">
                <td className="py-2 px-4 align-top">
                  <div className="font-medium text-slate-800">{SCHEDULE_K_LINE_META.label}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                    <span className="font-mono">{SCHEDULE_K_LINE_META.form1120sRef}</span>
                    <span aria-hidden="true">·</span>
                    <span>QBO: Interest Income · Increases Form 7203 basis</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-right align-top">
                  {renderEditableCell(
                    'pnl:schedule_k_interest:ytd',
                    computed.scheduleKInterest.ytd,
                    (d) => commitPnlEdit('schedule_k_interest', 'ytd', d)
                  )}
                </td>
                <td className="py-2 px-3 text-right align-top">
                  {renderEditableCell(
                    'pnl:schedule_k_interest:rem',
                    computed.scheduleKInterest.remaining,
                    (d) => commitPnlEdit('schedule_k_interest', 'remaining', d)
                  )}
                </td>
                <td className="py-2 px-3 text-right align-top bg-teal-50/20">
                  {renderEditableCell(
                    'pnl:schedule_k_interest:proj',
                    computed.scheduleKInterest.projected,
                    (d) => commitPnlEdit('schedule_k_interest', 'projected', d),
                    { bold: true, accent: true }
                  )}
                </td>
                <td className="py-2 px-4 text-right align-top font-mono tabular-nums text-slate-500 whitespace-nowrap">
                  {formatCurrencyExact(computed.scheduleKInterest.filed2025)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 3. Balance Sheet (Schedule L) & Form 7203 Shareholder Stock Basis */}
      {/* ================================================================= */}
      <section className="no-print space-y-4">
        {showStockBasis && (computed.drawsExceedBasis ? (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3.5 flex items-start gap-2.5 text-xs text-red-900 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                Stock Basis Alert — Planned Draws Exceed Available Basis by{' '}
                <span className="font-mono tabular-nums">
                  {formatCurrencyExact(computed.basisShortfall)}
                </span>
                :
              </span>{' '}
              Projected {pnlState.projection_year} distributions ({formatCurrencyExact(computed.projectedDrawsTotal)}) exceed
              available Form 7203 stock basis ({formatCurrencyExact(computed.basisAvailableBeforeDraws)}),
              triggering a{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatCurrencyExact(computed.projectedExcessDistributionGain)}
              </span>{' '}
              Form 8949 long-term capital gain.
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg px-5 py-3 flex items-center gap-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              <span className="font-semibold">Stock Basis Clear:</span> Projected {pnlState.projection_year} member draws (
              <span className="font-mono tabular-nums">
                {formatCurrencyExact(computed.projectedDrawsTotal)}
              </span>
              ) remain within available Form 7203 basis (
              <span className="font-mono tabular-nums">
                {formatCurrencyExact(computed.basisAvailableBeforeDraws)}
              </span>
              ), leaving{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatCurrencyExact(computed.projectedEndingStockBasis)}
              </span>{' '}
              in projected ending stock basis after 50% nondeductible meals.
            </span>
          </div>
        ))}

        <div className={`grid grid-cols-1 ${showStockBasis ? 'lg:grid-cols-2' : ''} gap-6 items-stretch`}>
          {/* Left: Schedule L */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                3A. Balance Sheet Projection (Schedule L)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Operating checking cash, accrued pension liabilities &amp; credit card balances.
              </p>
            </div>

            <div className="flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Account</th>
                    <th className="py-2 px-2 text-right">Beg (1/1)</th>
                    <th className="py-2 px-2 text-right">YTD</th>
                    <th className="py-2 px-3 text-right">Proj. 12/31</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 align-top">
                      <div className="font-medium text-slate-800">Operating Cash</div>
                      <div className="text-[11px] text-slate-400">QBO: Business Operating Checking / Cash</div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:cash_beg', bs.operating_cash_beg, (d) =>
                        commitBsField('operating_cash_beg', d)
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:cash_ytd', bs.operating_cash_ytd, (d) =>
                        commitBsField('operating_cash_ytd', d)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right align-top bg-teal-50/20">
                      {renderEditableCell(
                        'bs:cash_ye',
                        computed.projectedCashYe,
                        (d) => commitBsField('operating_cash_ye_override', d),
                        {
                          bold: true,
                          accent: true,
                          subLabel:
                            bs.operating_cash_ye_override !== null
                              ? 'Override'
                              : computed.subsequentYearRetirementAddback > 0
                              ? 'Auto · excl. §404(a)(6)'
                              : 'Auto cash flow',
                          resetAction:
                            bs.operating_cash_ye_override !== null
                              ? () =>
                                  onUpdateCadenceState((prev) => ({
                                    ...prev,
                                    balance_sheet: {
                                      ...prev.balance_sheet,
                                      operating_cash_ye_override: null,
                                    },
                                  }))
                              : undefined,
                        }
                      )}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 align-top">
                      <div className="font-medium text-slate-800">Pension Expense Payable</div>
                      <div className="text-[11px] text-slate-400">
                        QBO: Defined Benefit Plan Payable + Employer 401(k) Payable
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:pension_beg', bs.pension_payable_beg, (d) =>
                        commitBsField('pension_payable_beg', d)
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:pension_ytd', bs.pension_payable_ytd, (d) =>
                        commitBsField('pension_payable_ytd', d)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right align-top bg-teal-50/20">
                      {renderEditableCell(
                        'bs:pension_ye',
                        bs.pension_payable_ye,
                        (d) => commitBsField('pension_payable_ye', d),
                        {
                          bold: true,
                          subLabel:
                            bs.pension_payable_ye === 0 &&
                            computed.lines.dbp_contribution.projected +
                              computed.lines.employer_401k.projected >
                              0
                              ? 'IRC §404(a)(6) / cash-basis'
                              : undefined,
                        }
                      )}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 align-top">
                      <div className="font-medium text-slate-800">
                        Credit Card / Accounts Payable
                      </div>
                      <div className="text-[11px] text-slate-400">
                        QBO: Business Credit Cards &amp; Accounts Payable
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:cc_beg', bs.cc_ap_beg, (d) =>
                        commitBsField('cc_ap_beg', d)
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right align-top">
                      {renderEditableCell('bs:cc_ytd', bs.cc_ap_ytd, (d) =>
                        commitBsField('cc_ap_ytd', d)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right align-top bg-teal-50/20">
                      {renderEditableCell(
                        'bs:cc_ye',
                        bs.cc_ap_ye,
                        (d) => commitBsField('cc_ap_ye', d),
                        { bold: true }
                      )}
                    </td>
                  </tr>

                  <tr className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
                    <td className="py-2.5 px-4">
                      <div>Net Cash After Short-Term Liabilities</div>
                      <div className="text-[11px] font-normal text-slate-500">
                        Operating Cash − Pension Payable − CC / AP
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatCurrencyExact(computed.netCashPositionBeg)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatCurrencyExact(computed.netCashPositionYtd)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                        computed.netCashPositionYe < 0 ? 'text-amber-700' : 'text-slate-900'
                      }`}
                    >
                      {formatCurrencyExact(computed.netCashPositionYe)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Form 7203 Basis */}
          {showStockBasis && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                3B. Shareholder Draws &amp; Stock Basis Projection (Form 7203)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                IRC §1367 ordering with automatic excess distribution capital gain monitoring.
              </p>
            </div>

            <div className="flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Form 7203 Line Item</th>
                    <th className="py-2 px-2 text-right">YTD</th>
                    <th className="py-2 px-2 text-right">Rem.</th>
                    <th className="py-2 px-3 text-right">Proj. 12/31</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">Beginning Stock Basis (1/1/2026)</div>
                      <div className="text-[11px] text-slate-400">From 2025 ending Form 7203</div>
                    </td>
                    <td className="py-2 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2 px-4 text-right">
                      {renderEditableCell(
                        'bs:beg_basis',
                        computed.beginningStockBasis,
                        (d) => commitBsField('beginning_stock_basis_override', d),
                        { bold: true }
                      )}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">
                        + S-Corp Ordinary Income (K-1 Box 1)
                      </div>
                      <div className="text-[11px] text-slate-400">Auto-linked from P&amp;L Line 22</div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(Math.max(0, computed.ordinaryBusinessIncome.ytd))}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(computed.ordinaryBusinessIncome.remaining)}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums font-medium text-emerald-700">
                      {formatCurrencyExact(Math.max(0, computed.ordinaryBusinessIncome.projected))}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">
                        + Schedule K Interest Income (Line 4)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Separately stated portfolio income · Adds to stock basis
                      </div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(Math.max(0, computed.scheduleKInterest.ytd))}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(computed.scheduleKInterest.remaining)}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums font-medium text-emerald-700">
                      {formatCurrencyExact(Math.max(0, computed.scheduleKInterest.projected))}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">+ Capital Contributions</div>
                      <div className="text-[11px] text-slate-400">Adds dollar-for-dollar basis</div>
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {renderEditableCell('bs:cap_ytd', bs.capital_contributions_ytd, (d) =>
                        commitBsField('capital_contributions_ytd', d)
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {renderEditableCell('bs:cap_rem', bs.capital_contributions_remaining, (d) =>
                        commitBsField('capital_contributions_remaining', d)
                      )}
                    </td>
                    <td className="py-2 px-4 text-right bg-teal-50/20">
                      {renderEditableCell(
                        'bs:cap_proj',
                        computed.projectedCapitalContributionsTotal,
                        (d) => commitBsField('capital_contributions_projected', d),
                        { bold: true, accent: true }
                      )}
                    </td>
                  </tr>

                  <tr className="bg-slate-50/70 font-semibold text-slate-800">
                    <td className="py-2 px-4">= Basis Available Before Draws</td>
                    <td className="py-2 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.basisAvailableBeforeDraws)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">− Member Draws / Distributions</div>
                      <div className="text-[11px] text-slate-400">
                        QBO: Member Draws · YTD + Planned Remaining (two-way editable)
                      </div>
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {renderEditableCell('bs:draws_ytd', bs.member_draws_ytd, (d) =>
                        commitBsField('member_draws_ytd', d)
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {renderEditableCell('bs:draws_rem', bs.member_draws_remaining, (d) =>
                        commitBsField('member_draws_remaining', d)
                      )}
                    </td>
                    <td className="py-2 px-4 text-right bg-teal-50/20">
                      {renderEditableCell(
                        'bs:draws_proj',
                        computed.projectedDrawsTotal,
                        (d) => commitBsField('member_draws_projected', d),
                        { bold: true, accent: true }
                      )}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-800">
                        − Nondeductible Expenses (50% Meals)
                      </div>
                      <div className="text-[11px] text-slate-400">Auto-linked Schedule M-1 item</div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(-computed.mealsNondeductible50.ytd)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrencyExact(-computed.mealsNondeductible50.remaining)}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-amber-800">
                      {formatCurrencyExact(-computed.mealsNondeductible50.projected)}
                    </td>
                  </tr>

                  <tr className="bg-slate-900 text-white font-semibold">
                    <td className="py-2.5 px-4">
                      <div>Projected Ending Stock Basis (12/31/2026)</div>
                      <div className="text-[11px] font-normal text-slate-300 mt-0.5 font-mono tabular-nums">
                        {primaryName} ({computed.billSharePct}%):{' '}
                        {formatCurrencyExact(computed.billProjectedBasisEnding)} · {spouseName} (
                        {computed.debraSharePct}%):{' '}
                        {formatCurrencyExact(computed.debraProjectedBasisEnding)}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2.5 px-2.5 text-right text-slate-400 font-mono">—</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-sm">
                      {formatCurrencyExact(computed.projectedEndingStockBasis)}
                    </td>
                  </tr>

                  {computed.drawsExceedBasis && (
                    <tr className="bg-red-50 text-red-800 font-semibold">
                      <td className="py-2 px-4">
                        <div>Form 8949 Excess Distribution Capital Gain</div>
                        <div className="text-[11px] font-normal text-red-700 font-mono tabular-nums">
                          {primaryName}: {formatCurrencyExact(computed.billExcessGain)} · {spouseName}:{' '}
                          {formatCurrencyExact(computed.debraExcessGain)}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono">—</td>
                      <td className="py-2 px-2.5 text-right font-mono">—</td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums">
                        {formatCurrencyExact(computed.projectedExcessDistributionGain)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      </section>

      {/* Prepared By, Purpose & Disclaimer Notice */}
      <footer className="bg-white border border-slate-200 rounded-lg px-5 py-3.5 text-[11px] leading-relaxed text-slate-600 space-y-1">
        <div>
          <span className="font-semibold text-slate-800">Prepared by:</span>{' '}
          {cpaDisclosure.preparedBy}
        </div>
        <div>
          <span className="font-semibold text-slate-800">Purpose:</span>{' '}
          {cpaDisclosure.purpose}
        </div>
        <div>
          <span className="font-semibold text-slate-800">Disclaimer:</span>{' '}
          {cpaDisclosure.disclaimer}
        </div>
      </footer>

      {/* Brief confirmation toast after pushing forecast to 6-Year Horizon */}
      {pushToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-40 max-w-md bg-slate-900 text-white border border-teal-700/60 rounded-lg shadow-xl px-4 py-3 text-xs"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold text-white">
                {pushToast.taxYear} Forecast Pushed to 6-Year Horizon
              </div>
              <div className="text-[11px] text-slate-200 font-mono tabular-nums leading-relaxed">
                K-1: {formatCurrency(pushToast.newK1)} ({formatSignedDelta(pushToast.k1Delta)})
                <span className="mx-1.5 text-slate-500">·</span>
                Total Tax: {formatCurrency(pushToast.newAllInTax)} (
                {formatSignedDelta(pushToast.taxDelta)})
              </div>
              <div className="flex items-center gap-3 pt-0.5">
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => {
                      setPushToast(null);
                      onNavigate('horizon');
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-300 hover:text-teal-200 transition-colors"
                  >
                    <span>View 6-Year Horizon</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPushToast(null)}
                  className="text-[11px] text-slate-400 hover:text-white transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPushToast(null)}
              aria-label="Dismiss push notification"
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* CPA Print Package Modal */}
      {showPrintModal && (
        <CpaPrintPackageModal
          setup={setup}
          pnlState={pnlState}
          computed={computed}
          entityName={entityName}
          entityEin={entityEin}
          reportMeta={cpaReportMeta}
          issues={issues}
          guardrailAcknowledgments={guardrailAcknowledgments}
          onDownloadCsv={handleDownloadCsv}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};
