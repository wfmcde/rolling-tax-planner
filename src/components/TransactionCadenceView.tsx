import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type {
  BalanceSheetProjectionInputs,
  CadenceForecastMode,
  CadenceForecasterState,
  ComputedTaxYear,
  PnlBalanceSheetState,
  PnlLineId,
  SetupConfig,
  WorkspaceTab,
} from '../types/tax';
import {
  CPA_DISCLOSURE_METADATA,
  PNL_OPERATING_ITEMS,
  PNL_SECTIONS,
  SCHEDULE_K_LINE_META,
  buildCpaProjectionCsv,
  getPnlLineLabel,
  type ComputedPnlBalanceSheet,
  type CpaReportMetadata,
} from '../engine/pnlBalanceSheet';
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
import { getPersonNames } from '../engine/scheduleCatalog';
import { formatCurrencyExact } from '../utils/format';
import { CpaPrintPackageModal } from './CpaPrintPackageModal';

interface TransactionCadenceViewProps {
  setup: SetupConfig;
  cadenceState: CadenceForecasterState;
  year2025Computed?: ComputedTaxYear;
  year2026Computed?: ComputedTaxYear;
  onUpdateCadenceState: (
    updater: (prev: CadenceForecasterState) => CadenceForecasterState
  ) => void;
  onPushTo2026Schedule: (
    pnlSnapshot: PnlBalanceSheetState,
    computed: ComputedPnlBalanceSheet
  ) => void;
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

export const TransactionCadenceView: React.FC<TransactionCadenceViewProps> = ({
  setup,
  cadenceState,
  year2025Computed,
  year2026Computed,
  onUpdateCadenceState,
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
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'push' | 'import';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { primaryName, spouseName } = getPersonNames(setup);
  const entityName = year2025Computed?.scorp_in.entity_name ?? 'Operating Support Services LLC';
  const entityEin = year2025Computed?.scorp_in.entity_ein ?? '83-1706286';

  const forecast = useMemo(
    () => computeCadenceForecast(cadenceState, year2025Computed),
    [cadenceState, year2025Computed]
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
        }
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
      }
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

  const handleLoadSampleOss = () => {
    setImportError(null);
    const fresh = createInitialCadenceForecasterState(
      year2025Computed?.scorp_out.stock_basis_ending ?? 0
    );
    onUpdateCadenceState(() => fresh);
    setShowImportPanel(false);
    setBannerMessage({
      type: 'import',
      text: `Loaded Sample OSS QBO Transaction Ledger (1/1/2026–11/21/2026 · ${fresh.transactions.length} transactions) reconciling to $319,283.71 revenue, $88,300.27 expenses, $609.18 interest, $42,580.89 BlueVine Checking, $2,963.77 credit cards, and $121,939.75 draws.`,
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

  const variableEligibleStreams = useMemo(
    () =>
      forecast.streams.filter(
        (s) => s.detectedMode === 'run_rate' && s.activeMonthCount >= 2 && s.activeMode !== 'manual'
      ),
    [forecast.streams]
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

  const cpaReportMeta = useMemo<CpaReportMetadata>(() => {
    const rawLabel = cadenceState.source_label?.trim() || 'Sample Ledger';
    const isSample = /sample|built-in/i.test(rawLabel);
    const formatPrefix = isSample
      ? 'Sample / Built-in Ledger'
      : forecast.ledgerFormat === 'general_ledger'
        ? 'QBO General Ledger'
        : 'QBO Transaction List';
    const sourceMode = `${formatPrefix} (${rawLabel} · ${cadenceState.transactions.length} rows)`;

    const modeParts: string[] = [];
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
    };
  }, [
    cadenceState.source_label,
    cadenceState.transactions.length,
    forecast.elapsedDays,
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
    a.download = `Operating_Support_Services_${pnlState.projection_year}_Cadence_CPA_Projection.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePush = () => {
    onPushTo2026Schedule(pnlState, computed);
    setBannerMessage({
      type: 'push',
      text: `Pushed cadence-projected ${pnlState.projection_year} financials to the Six-Year Financial Schedule (Revenue ${formatCurrencyExact(
        computed.totalRevenue.projected
      )} · K-1 Profit ${formatCurrencyExact(
        computed.ordinaryBusinessIncome.projected
      )} · Sch K Interest ${formatCurrencyExact(
        computed.scheduleKInterest.projected
      )} · Draws ${formatCurrencyExact(computed.projectedDrawsTotal)}).`,
    });
  };

  const filteredStreams = useMemo(() => {
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
        targetLabel.includes(q) ||
        s.cadenceLabel.toLowerCase().includes(q) ||
        s.sourceAccounts.some((a) => a.toLowerCase().includes(q)) ||
        (s.flaggedTransferNote ?? '').toLowerCase().includes(q)
      );
    });
  }, [forecast.streams, streamFilter, streamSearch, lineLabelMap]);

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
          className="w-28 px-2 py-1 text-right text-xs font-mono tabular-nums bg-white border border-teal-700 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
        />
      );
    }

    return (
      <div className="inline-flex flex-col items-end">
        <button
          type="button"
          onClick={() => setActiveEdit({ key: editKey, draft: String(round2(value)) })}
          title="Click to edit inline"
          className={`group inline-flex items-center justify-end gap-1 px-1.5 py-0.5 -mr-1.5 rounded hover:bg-teal-50/80 transition-colors font-mono tabular-nums text-xs whitespace-nowrap ${
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
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Push Projected 2026 to Six-Year Schedule
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
                Upload a QBO Transaction List by Date or General Ledger export (.csv or .xlsx), paste rows directly, or test immediately with Operating Support Services, LLC&apos;s 11/21/2026 ledger.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadSampleOss}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100/70 transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Load Sample OSS QBO Transaction Ledger (1/1/2026–11/21/2026)
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
                placeholder={'Date\tTransaction Type\tNum\tName\tMemo/Description\tAccount\tSplit\tAmount\n01/09/2026\tPayroll Check\t\tOSS Payroll — Bill\tBiweekly salary\tBlueVine Checking\tSalary -> Bill\t-892.81'}
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
              onClick={handleLoadSampleOss}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              Reload Sample OSS Ledger
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
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-md max-h-64 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[720px]">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Vendor / Name</th>
                      <th className="py-2 px-3">Account → Split</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                      <th className="py-2 px-3">Audit Treatment</th>
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
            CA {computed.caPct.projected}% · AZ {computed.azPct.projected}%
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Projected 1120-S Ordinary Income</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            2025 Filed {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
            {k1DiffFromSchedule !== null && Math.abs(k1DiffFromSchedule) >= 1
              ? ` · Schedule Δ ${formatCurrencyExact(k1DiffFromSchedule, true)}`
              : ' · Synced w/ 2026'}
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
      </div>

      {/* ================================================================= */}
      {/* 1. Interactive Detected Cadence & Remaining-Year Schedule Drawer  */}
      {/* ================================================================= */}
      <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowCadenceDrawer((v) => !v)}
            className="flex items-start gap-2 text-left"
          >
            {showCadenceDrawer ? (
              <ChevronDown className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            )}
            <div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-teal-800 shrink-0" />
                <span>1. Detected Cadence &amp; Remaining-Year Schedule</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {forecast.streams.length} vendor/account streams · Mode A counts exact calendar occurrences after {forecast.asOfDate} through 12/31; Mode B projects variable pace ({forecast.remainingDays}/{forecast.elapsedDays}d); Mode C defaults one-time/discretionary items to $0.
              </p>
            </div>
          </button>

          {showCadenceDrawer && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={streamSearch}
                  onChange={(e) => setStreamSearch(e.target.value)}
                  placeholder="Filter vendor or account..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 w-52"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
                {(
                  [
                    ['all', `All (${streamCounts.all})`],
                    ['cadence', `Cadence (${streamCounts.cadence})`],
                    ['exp_smooth', `Exp. Smooth (${streamCounts.exp_smooth})`],
                    ['run_rate', `Run-Rate (${streamCounts.run_rate})`],
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
                    onClick={() => setStreamFilter(tab)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
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

        {/* Monthly Exponential Smoothing Controls Toolbar */}
        {showCadenceDrawer && (
          <div className="px-5 py-2.5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700 whitespace-nowrap">
                  Exp. Smooth α
                </span>
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
                title="Applies Monthly Exp. Smooth to all variable Run-Rate streams with 2+ active months, keeping Cadence bills, Exclude ($0) items, and Manual overrides untouched."
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100/80 disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
              >
                Apply Exp. Smooth to Variable Streams ({variableEligibleStreams.length})
              </button>
              {variableOnExpSmoothCount > 0 && (
                <button
                  type="button"
                  onClick={handleRevertVariableToRunRate}
                  className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap"
                >
                  Revert Variable to Run-Rate ({variableOnExpSmoothCount})
                </button>
              )}
            </div>
          </div>
        )}

        {showCadenceDrawer && (
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            {filteredStreams.length === 0 ? (
              <div className="py-10 px-6 text-center text-xs text-slate-500">
                No vendor/account streams match your current filter.
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[1080px]">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Vendor / Stream</th>
                    <th className="py-2.5 px-3">Target Line Item</th>
                    <th className="py-2.5 px-3">Detected Cadence / Basis</th>
                    <th className="py-2.5 px-3 text-right">YTD Actual</th>
                    <th className="py-2.5 px-3 text-right">Latest Amt</th>
                    <th className="py-2.5 px-3 text-right">Rem. Basis</th>
                    <th className="py-2.5 px-3 text-right">Remaining Forecast ($)</th>
                    <th className="py-2.5 px-4 text-right">Forecast Mode (1-Click)</th>
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

                    return (
                      <tr key={s.streamKey} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2 px-4 align-top">
                          <div className="font-medium text-slate-900">{s.vendor}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                            {s.transactionCount} {s.transactionCount === 1 ? 'txn' : 'txns'} · last{' '}
                            {s.latestDate}
                            {s.sourceAccounts.length > 0 ? ` · ${s.sourceAccounts.join(', ')}` : ''}
                          </div>
                          {s.hasTransferFlag && s.flaggedTransferNote && (
                            <div className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{s.flaggedTransferNote}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-slate-700 whitespace-nowrap">
                          {targetLabel}
                        </td>
                        <td
                          className={`py-2 px-3 align-top text-[11px] font-mono ${cadenceTone}`}
                          title={monthlyTooltip}
                        >
                          {s.activeMode === 'exp_smooth' ? (
                            <div>
                              <div>
                                Exp. Smooth (α={forecast.expSmoothAlpha.toFixed(2)}) ·{' '}
                                {s.monthlySeries.length} mos
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
                              {s.activeMonthCount >= 2 && s.detectedMode === 'run_rate' && (
                                <div className="text-[10px] text-slate-400 font-normal tabular-nums mt-0.5">
                                  SES (α={forecast.expSmoothAlpha.toFixed(2)}):{' '}
                                  {formatCurrencyExact(s.expSmoothRemainingAmount)}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatCurrencyExact(s.ytdAmount)}
                        </td>
                        <td className="py-2 px-3 align-top text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatCurrencyExact(s.latestAmount)}
                        </td>
                        <td
                          className="py-2 px-3 align-top text-right font-mono tabular-nums text-slate-600 whitespace-nowrap"
                          title={monthlyTooltip}
                        >
                          {remCountDisplay}
                        </td>
                        <td className="py-2 px-3 align-top text-right bg-teal-50/15">
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
                        <td className="py-2 px-4 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <div
                              role="group"
                              aria-label={`Forecast mode for ${s.vendor}`}
                              className="inline-flex items-center bg-slate-100 p-0.5 rounded border border-slate-200/80"
                            >
                              {(
                                [
                                  ['cadence', 'Cadence'],
                                  ['exp_smooth', 'Exp. Smooth'],
                                  ['run_rate', 'Run-Rate'],
                                  ['manual', 'Manual'],
                                  ['one_time', 'Exclude $0'],
                                ] as const
                              ).map(([modeKey, modeLabel]) => {
                                const isActive = s.activeMode === modeKey;
                                return (
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
                                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
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
                                    {modeLabel}
                                  </button>
                                );
                              })}
                            </div>
                            {s.isOverridden && (
                              <button
                                type="button"
                                onClick={() => handleResetStreamOverride(s.streamKey)}
                                title="Reset to auto-detected cadence"
                                className="text-[10px] text-teal-700 hover:text-teal-900 underline"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
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

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4 w-[38%]">Line Item</th>
                <th className="py-2.5 px-3 text-right">YTD Actuals (QBO)</th>
                <th className="py-2.5 px-3 text-right">Remaining Forecast</th>
                <th className="py-2.5 px-3 text-right">Projected Full Year</th>
                <th className="py-2.5 px-4 text-right text-slate-500">2025 Filed Actuals</th>
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
                                  subLabel: hasRemOv ? 'Manual' : undefined,
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
                            Auto-summed CA + AZ revenue · Live state apportionment split
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-900">
                            {formatCurrencyExact(computed.totalRevenue.ytd)}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums font-normal text-teal-800 mt-0.5">
                            CA {computed.caPct.ytd}% / AZ {computed.azPct.ytd}%
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-900">
                            {formatCurrencyExact(computed.totalRevenue.remaining)}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums font-normal text-teal-800 mt-0.5">
                            CA {computed.caPct.remaining}% / AZ {computed.azPct.remaining}%
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <div className="font-mono tabular-nums text-teal-900">
                            {formatCurrencyExact(computed.totalRevenue.projected)}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums font-medium text-teal-800 mt-0.5">
                            CA {computed.caPct.projected}% / AZ {computed.azPct.projected}%
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right align-top">
                          <div className="font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalRevenue.filed2025)}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums font-normal text-slate-500 mt-0.5">
                            CA {computed.caPct.filed2025}% / AZ {computed.azPct.filed2025}%
                          </div>
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
                            Tax-deductible total (includes 50% Meals) · Book total w/ 100% Meals:{' '}
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
        {computed.drawsExceedBasis ? (
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
              Projected 2026 distributions ({formatCurrencyExact(computed.projectedDrawsTotal)}) exceed
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
              <span className="font-semibold">Stock Basis Clear:</span> Projected 2026 member draws (
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
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Left: Schedule L */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                3A. Balance Sheet Projection (Schedule L)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                BlueVine Checking cash, accrued pension liabilities &amp; credit card balances.
              </p>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse min-w-[460px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Account</th>
                    <th className="py-2.5 px-2.5 text-right">Beg of Year (2026)</th>
                    <th className="py-2.5 px-2.5 text-right">Current YTD (QBO)</th>
                    <th className="py-2.5 px-4 text-right">Projected YE (12/31)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 align-top">
                      <div className="font-medium text-slate-800">Operating Cash</div>
                      <div className="text-[11px] text-slate-400">QBO: BlueVine Checking</div>
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
                        QBO: Defined Benefit Plan Payable + OSS 401K Plan Payable
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
                        { bold: true }
                      )}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 align-top">
                      <div className="font-medium text-slate-800">
                        Credit Card / Accounts Payable
                      </div>
                      <div className="text-[11px] text-slate-400">
                        QBO: Amazon CC, Cap One CC, AMX CC, Amtrak
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
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                3B. Shareholder Draws &amp; Stock Basis Projection (Form 7203)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                IRC §1367 ordering with automatic excess distribution capital gain monitoring.
              </p>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse min-w-[460px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Form 7203 Line Item</th>
                    <th className="py-2.5 px-2.5 text-right">YTD (QBO)</th>
                    <th className="py-2.5 px-2.5 text-right">Planned Rem.</th>
                    <th className="py-2.5 px-4 text-right">Projected YE (12/31)</th>
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
        </div>
      </section>

      {/* Prepared By, Purpose & Disclaimer Notice */}
      <footer className="bg-white border border-slate-200 rounded-lg px-5 py-3.5 text-[11px] leading-relaxed text-slate-600 space-y-1">
        <div>
          <span className="font-semibold text-slate-800">Prepared by:</span>{' '}
          {CPA_DISCLOSURE_METADATA.preparedBy}
        </div>
        <div>
          <span className="font-semibold text-slate-800">Purpose:</span>{' '}
          {CPA_DISCLOSURE_METADATA.purpose}
        </div>
        <div>
          <span className="font-semibold text-slate-800">Disclaimer:</span>{' '}
          {CPA_DISCLOSURE_METADATA.disclaimer}
        </div>
      </footer>

      {/* CPA Print Package Modal */}
      {showPrintModal && (
        <CpaPrintPackageModal
          setup={setup}
          pnlState={pnlState}
          computed={computed}
          entityName={entityName}
          entityEin={entityEin}
          reportMeta={cpaReportMeta}
          onDownloadCsv={handleDownloadCsv}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};
