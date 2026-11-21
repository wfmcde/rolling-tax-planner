import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  Upload,
} from 'lucide-react';
import type {
  BalanceSheetProjectionInputs,
  ComputedTaxYear,
  PnlBalanceSheetState,
  PnlLineId,
  SetupConfig,
  WorkspaceTab,
} from '../types/tax';
import {
  PNL_OPERATING_ITEMS,
  PNL_SECTIONS,
  SCHEDULE_K_LINE_META,
  buildCpaProjectionCsv,
  calculatePnlBalanceSheet,
  getPnlLineLabel,
  type ComputedPnlBalanceSheet,
  type CpaReportMetadata,
} from '../engine/pnlBalanceSheet';
import { getPersonNames } from '../engine/scheduleCatalog';
import { formatCurrencyExact } from '../utils/format';
import { QboImportModal } from './QboImportModal';
import { CpaPrintPackageModal } from './CpaPrintPackageModal';

interface PnlBalanceSheetViewProps {
  setup: SetupConfig;
  pnlState: PnlBalanceSheetState;
  year2025Computed?: ComputedTaxYear;
  year2026Computed?: ComputedTaxYear;
  onUpdatePnlState: (updater: (prev: PnlBalanceSheetState) => PnlBalanceSheetState) => void;
  onPushTo2026Schedule: (
    pnlState: PnlBalanceSheetState,
    computed: ComputedPnlBalanceSheet
  ) => void;
  onResetFrom2026Schedule: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

type PnlEditColumn = 'ytd' | 'remaining' | 'projected';

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
  const signed = negative ? -Math.abs(num) : num;
  return round2(signed);
}

export const PnlBalanceSheetView: React.FC<PnlBalanceSheetViewProps> = ({
  setup,
  pnlState,
  year2025Computed,
  year2026Computed,
  onUpdatePnlState,
  onPushTo2026Schedule,
  onResetFrom2026Schedule,
  onNavigate,
}) => {
  const [activeEdit, setActiveEdit] = useState<ActiveInlineEdit | null>(null);
  const [qboModalTab, setQboModalTab] = useState<'pnl' | 'balance_sheet' | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [sourceMode, setSourceMode] = useState<string>('Preloaded 11/21 QBO / Manual Projection');
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'push' | 'import';
    text: string;
  } | null>(null);

  const { primaryName, spouseName } = getPersonNames(setup);
  const entityName = year2025Computed?.scorp_in.entity_name ?? 'Operating Support Services LLC';
  const entityEin = year2025Computed?.scorp_in.entity_ein ?? '83-1706286';

  const computed = useMemo(
    () => calculatePnlBalanceSheet(pnlState, year2025Computed),
    [pnlState, year2025Computed]
  );

  const cpaReportMeta = useMemo<CpaReportMetadata>(
    () => ({
      moduleName: 'Rolling Tax Planner — P&L & Balance Sheet Projection',
      sourceMode,
      forecastMethodSummary: 'Two-Way Inline Forecast (YTD Actuals + Manual / Run-Rate Remaining)',
    }),
    [sourceMode]
  );

  // Two-way P&L inline edit commit
  const commitPnlEdit = (lineId: PnlLineId, col: PnlEditColumn, draft: string) => {
    const parsed = parseNumericInput(draft);
    setActiveEdit(null);
    if (parsed === null) return;

    onUpdatePnlState((prev) => {
      const current = prev.pnl[lineId] ?? { ytd: 0, remaining: 0 };
      let nextYtd = current.ytd;
      let nextRemaining = current.remaining;

      if (col === 'ytd') {
        nextYtd = parsed;
      } else if (col === 'remaining') {
        nextRemaining = parsed;
      } else {
        // Editing Projected Full Year directly updates Remaining Forecast = Projected - YTD
        nextRemaining = round2(parsed - current.ytd);
      }

      return {
        ...prev,
        pnl: {
          ...prev.pnl,
          [lineId]: { ytd: round2(nextYtd), remaining: round2(nextRemaining) },
        },
      };
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

    onUpdatePnlState((prev) => {
      const bs = { ...prev.balance_sheet };
      if (field === 'member_draws_projected') {
        bs.member_draws_remaining = round2(parsed - bs.member_draws_ytd);
      } else if (field === 'capital_contributions_projected') {
        bs.capital_contributions_remaining = round2(parsed - bs.capital_contributions_ytd);
      } else {
        bs[field] = parsed;
      }
      return {
        ...prev,
        balance_sheet: bs,
      };
    });
  };

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
    a.download = `Operating_Support_Services_${pnlState.projection_year}_CPA_Projection.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePush = () => {
    onPushTo2026Schedule(pnlState, computed);
    setBannerMessage({
      type: 'push',
      text: `Pushed projected ${pnlState.projection_year} financials to the Six-Year Financial Schedule (Revenue ${formatCurrencyExact(
        computed.totalRevenue.projected
      )} · K-1 Profit ${formatCurrencyExact(
        computed.ordinaryBusinessIncome.projected
      )} · DBP ${formatCurrencyExact(computed.lines.dbp_contribution.projected)} · Draws ${formatCurrencyExact(
        computed.projectedDrawsTotal
      )}).`,
    });
  };

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

  const bs = pnlState.balance_sheet;
  const schedule2026K1 = year2026Computed?.scorp_out.ordinary_business_income_1120s;
  const k1DiffFromSchedule =
    schedule2026K1 !== undefined
      ? computed.ordinaryBusinessIncome.projected - schedule2026K1
      : null;

  return (
    <div className="space-y-6">
      {/* Page Title, Entity Context & Toolbar Actions */}
      <div className="no-print flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            P&amp;L &amp; Balance Sheet Projection
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{entityName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">EIN {entityEin}</span>
            <span aria-hidden="true">·</span>
            <span>Tax Year {pnlState.projection_year}</span>
            <span aria-hidden="true">·</span>
            <span>
              {primaryName} {computed.billSharePct}% / {spouseName} {computed.debraSharePct}%
            </span>
            <span aria-hidden="true">·</span>
            <label className="inline-flex items-center gap-1.5">
              <span>QBO As-Of</span>
              <input
                type="date"
                value={bs.as_of_date}
                onChange={(e) =>
                  onUpdatePnlState((prev) => ({
                    ...prev,
                    balance_sheet: { ...prev.balance_sheet, as_of_date: e.target.value },
                  }))
                }
                className="px-1.5 py-0.5 text-xs font-mono text-slate-700 bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setQboModalTab('pnl')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Paste / Upload QBO Report
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

      {/* Sync / Import Feedback Banner */}
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
      {/* 1. Profit & Loss Projection Table (Form 1120-S Structure)         */}
      {/* ================================================================= */}
      <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              1. Profit &amp; Loss Projection (Form 1120-S Structure)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Two-way inline editing: edit YTD Actuals or Remaining Forecast to update Projected Full Year, or edit Projected Full Year directly to back-solve Remaining Forecast.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQboModalTab('pnl')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100/70 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Import QBO P&amp;L
            </button>
            <button
              type="button"
              onClick={onResetFrom2026Schedule}
              title="Re-seed 2026 projection from the current Six-Year Schedule inputs"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Reset from 2026 Plan
            </button>
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
                    {/* Group Header */}
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
                              {renderEditableCell(`pnl:${item.id}:ytd`, vals.ytd, (d) =>
                                commitPnlEdit(item.id, 'ytd', d)
                              )}
                            </td>
                            <td className="py-2 px-3 text-right align-top">
                              {renderEditableCell(`pnl:${item.id}:rem`, vals.remaining, (d) =>
                                commitPnlEdit(item.id, 'remaining', d)
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

              {/* Bottom-Line Ordinary Business Income (Form 1120-S Line 22) */}
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

              {/* Separately Stated Schedule K Item (Excluded from Line 22, Included in Form 7203 Basis) */}
              <tr className="bg-slate-50/90 border-t border-slate-200">
                <td colSpan={5} className="py-1.5 px-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      Schedule K Separately Stated Items
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Portfolio income excluded from Line 22 Ordinary Income · Flows to Schedule K-1 Box 4 &amp; Form 7203 stock basis
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
                  {renderEditableCell('pnl:schedule_k_interest:ytd', computed.scheduleKInterest.ytd, (d) =>
                    commitPnlEdit('schedule_k_interest', 'ytd', d)
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
      {/* 2. Balance Sheet & Shareholder Basis Projection (Sch L & 7203)    */}
      {/* ================================================================= */}
      <section className="no-print space-y-4">
        {/* Basis Excess Alert or Safe Status Strip */}
        {computed.drawsExceedBasis ? (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div className="text-xs text-red-900 leading-relaxed">
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
                Form 8949 long-term capital gain. Contribute at least{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {formatCurrencyExact(computed.basisShortfall)}
                </span>{' '}
                in additional capital or reduce planned remaining draws before December 31 to
                eliminate the excess distribution tax.
              </div>
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
          {/* Left: Schedule L Balance Sheet Projection */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  2A. Balance Sheet Projection (Schedule L)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Operating cash, accrued pension liabilities &amp; short-term payables.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQboModalTab('balance_sheet')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100/70 transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Import QBO BS
              </button>
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
                      <div className="text-[11px] text-slate-400">
                        QBO: BlueVine Checking
                      </div>
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
                                  onUpdatePnlState((prev) => ({
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
                        QBO: Amazon CC, Amtrak, AMX CC, Cap One CC
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

          {/* Right: Form 7203 Shareholder Stock Basis & Draws */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                2B. Shareholder Draws &amp; Stock Basis Projection (Form 7203)
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

      {/* QuickBooks Online Paste / CSV Import Modal */}
      {qboModalTab !== null && (
        <QboImportModal
          setup={setup}
          initialTab={qboModalTab}
          asOfDate={bs.as_of_date}
          onClose={() => setQboModalTab(null)}
          onApplyImport={(payload) => {
            onUpdatePnlState((prev) => {
              const nextPnl = { ...prev.pnl };
              if (payload.reportType === 'pnl') {
                for (const [id, ytdVal] of Object.entries(payload.pnlYtdUpdates)) {
                  const lineId = id as PnlLineId;
                  const existing = nextPnl[lineId] ?? { ytd: 0, remaining: 0 };
                  const oldProjected = round2(existing.ytd + existing.remaining);
                  const newYtd = round2(ytdVal ?? 0);
                  nextPnl[lineId] = {
                    ytd: newYtd,
                    remaining: payload.preserveProjectedFullYear
                      ? round2(oldProjected - newYtd)
                      : existing.remaining,
                  };
                }
              }

              const nextBs = {
                ...prev.balance_sheet,
                as_of_date: payload.asOfDate,
              };
              if (payload.reportType === 'balance_sheet') {
                if (payload.bsYtdUpdates.operating_cash_ytd !== undefined) {
                  nextBs.operating_cash_ytd = round2(payload.bsYtdUpdates.operating_cash_ytd);
                }
                if (payload.bsYtdUpdates.pension_payable_ytd !== undefined) {
                  nextBs.pension_payable_ytd = round2(payload.bsYtdUpdates.pension_payable_ytd);
                }
                if (payload.bsYtdUpdates.cc_ap_ytd !== undefined) {
                  nextBs.cc_ap_ytd = round2(payload.bsYtdUpdates.cc_ap_ytd);
                }
                if (payload.bsYtdUpdates.member_draws_ytd !== undefined) {
                  nextBs.member_draws_ytd = round2(payload.bsYtdUpdates.member_draws_ytd);
                }
                if (payload.bsYtdUpdates.capital_contributions_ytd !== undefined) {
                  nextBs.capital_contributions_ytd = round2(
                    payload.bsYtdUpdates.capital_contributions_ytd
                  );
                }
              }

              return {
                ...prev,
                pnl: nextPnl,
                balance_sheet: nextBs,
              };
            });

            setSourceMode(
              `QBO ${payload.reportType === 'pnl' ? 'Profit & Loss' : 'Balance Sheet'} Import (${
                payload.importedRowCount
              } ${payload.importedRowCount === 1 ? 'row' : 'rows'})`
            );
            setQboModalTab(null);
            setBannerMessage({
              type: 'import',
              text: `Imported ${payload.importedRowCount} QuickBooks Online ${
                payload.reportType === 'pnl' ? 'Profit & Loss' : 'Balance Sheet'
              } ${payload.importedRowCount === 1 ? 'row' : 'rows'} into YTD Actuals (as of ${
                payload.asOfDate
              }).`,
            });
          }}
        />
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
          onDownloadCsv={handleDownloadCsv}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};
