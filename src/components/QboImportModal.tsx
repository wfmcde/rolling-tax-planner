import React, { useMemo, useRef, useState } from 'react';
import { Check, FileSpreadsheet, Upload, X } from 'lucide-react';
import type { PnlLineId, SetupConfig } from '../types/tax';
import {
  PNL_LINE_ITEMS,
  SAMPLE_QBO_BS_TEXT,
  SAMPLE_QBO_PNL_TEXT,
  getPnlLineLabel,
  parseQboReportText,
  type ParsedQboRow,
  type QboTargetField,
} from '../engine/pnlBalanceSheet';
import { formatCurrencyExact } from '../utils/format';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface QboImportModalProps {
  setup: SetupConfig;
  initialTab?: 'pnl' | 'balance_sheet';
  asOfDate: string;
  onClose: () => void;
  onApplyImport: (payload: {
    reportType: 'pnl' | 'balance_sheet';
    asOfDate: string;
    preserveProjectedFullYear: boolean;
    pnlYtdUpdates: Partial<Record<PnlLineId, number>>;
    bsYtdUpdates: {
      operating_cash_ytd?: number;
      pension_payable_ytd?: number;
      cc_ap_ytd?: number;
      member_draws_ytd?: number;
      capital_contributions_ytd?: number;
    };
    importedRowCount: number;
  }) => void;
}

export const QboImportModal: React.FC<QboImportModalProps> = ({
  setup,
  initialTab = 'pnl',
  asOfDate,
  onClose,
  onApplyImport,
}) => {
  const [reportType, setReportType] = useState<'pnl' | 'balance_sheet'>(initialTab);
  const [rawText, setRawText] = useState('');
  const [dateDraft, setDateDraft] = useState(asOfDate);
  const [preserveProjected, setPreserveProjected] = useState(false);
  const [targetOverrides, setTargetOverrides] = useState<Record<string, QboTargetField>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parsedRows: ParsedQboRow[] = useMemo(() => {
    if (!rawText.trim()) return [];
    return parseQboReportText(rawText, reportType);
  }, [rawText, reportType]);

  const effectiveTarget = (row: ParsedQboRow): QboTargetField =>
    targetOverrides[row.id] ?? row.suggestedTarget;

  const targetOptions = useMemo(() => {
    if (reportType === 'pnl') {
      return [
        { value: 'ignore' as QboTargetField, label: 'Skip / Ignore' },
        { value: 'split_revenue_ca_az' as QboTargetField, label: 'Revenue — Split 50/50 CA & AZ' },
        ...PNL_LINE_ITEMS.map((item) => ({
          value: item.id as QboTargetField,
          label: `${getPnlLineLabel(item, setup)} (${item.form1120sRef})`,
        })),
      ];
    }
    return [
      { value: 'ignore' as QboTargetField, label: 'Skip / Ignore' },
      { value: 'operating_cash_ytd' as QboTargetField, label: 'Operating Cash (BlueVine Checking)' },
      {
        value: 'pension_payable_ytd' as QboTargetField,
        label: 'Pension Expense Payable (DBP + OSS 401K Payable)',
      },
      {
        value: 'cc_ap_ytd' as QboTargetField,
        label: 'Credit Card / Accounts Payable (Amazon, Amtrak, AMX, Cap One)',
      },
      { value: 'member_draws_ytd' as QboTargetField, label: 'Member Draws / Distributions (YTD)' },
      { value: 'capital_contributions_ytd' as QboTargetField, label: 'Capital Contributions (YTD)' },
    ];
  }, [reportType, setup]);

  const matchedCount = useMemo(
    () => parsedRows.filter((r) => effectiveTarget(r) !== 'ignore').length,
    [parsedRows, targetOverrides]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    try {
      const content = await file.text();
      setRawText(content);
      setTargetOverrides({});
    } catch {
      setFileError(
        'Unable to read the selected file. Please upload a plain-text CSV export from QuickBooks Online.'
      );
    }
  };

  const handleSwitchReportType = (next: 'pnl' | 'balance_sheet') => {
    setReportType(next);
    setTargetOverrides({});
  };

  const handleApply = () => {
    const pnlTotals: Partial<Record<PnlLineId, number>> = {};
    const bsTotals: {
      operating_cash_ytd?: number;
      pension_payable_ytd?: number;
      cc_ap_ytd?: number;
      member_draws_ytd?: number;
      capital_contributions_ytd?: number;
    } = {};

    let importedRowCount = 0;

    for (const row of parsedRows) {
      const target = effectiveTarget(row);
      if (target === 'ignore') continue;
      importedRowCount += 1;

      if (reportType === 'pnl') {
        if (target === 'split_revenue_ca_az') {
          const halfCa = round2(row.amount * 0.5);
          const halfAz = round2(row.amount - halfCa);
          pnlTotals.ca_revenue = round2((pnlTotals.ca_revenue ?? 0) + halfCa);
          pnlTotals.az_revenue = round2((pnlTotals.az_revenue ?? 0) + halfAz);
        } else {
          const lineId = target as PnlLineId;
          pnlTotals[lineId] = round2((pnlTotals[lineId] ?? 0) + row.amount);
        }
      } else {
        if (target === 'operating_cash_ytd') {
          bsTotals.operating_cash_ytd = round2((bsTotals.operating_cash_ytd ?? 0) + row.amount);
        } else if (target === 'pension_payable_ytd') {
          bsTotals.pension_payable_ytd = round2((bsTotals.pension_payable_ytd ?? 0) + row.amount);
        } else if (target === 'cc_ap_ytd') {
          bsTotals.cc_ap_ytd = round2((bsTotals.cc_ap_ytd ?? 0) + row.amount);
        } else if (target === 'member_draws_ytd') {
          bsTotals.member_draws_ytd = round2(
            (bsTotals.member_draws_ytd ?? 0) + Math.abs(row.amount)
          );
        } else if (target === 'capital_contributions_ytd') {
          bsTotals.capital_contributions_ytd = round2(
            (bsTotals.capital_contributions_ytd ?? 0) + Math.abs(row.amount)
          );
        }
      }
    }

    onApplyImport({
      reportType,
      asOfDate: dateDraft,
      preserveProjectedFullYear: preserveProjected,
      pnlYtdUpdates: pnlTotals,
      bsYtdUpdates: bsTotals,
      importedRowCount,
    });
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Paste or Upload QuickBooks Online Report"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Paste / Upload QuickBooks Online Report
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configured for Operating Support Services, LLC QBO accounts (auto-separates Travel meals, routes Schedule K Interest, and deduplicates subtotals).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => handleSwitchReportType('pnl')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  reportType === 'pnl'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Profit &amp; Loss (YTD)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchReportType('balance_sheet')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  reportType === 'balance_sheet'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Balance Sheet (YTD)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>As-Of Date</span>
                <input
                  type="date"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                Upload QBO CSV
              </button>

              <button
                type="button"
                onClick={() => {
                  setRawText(reportType === 'pnl' ? SAMPLE_QBO_PNL_TEXT : SAMPLE_QBO_BS_TEXT);
                  setTargetOverrides({});
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100/70 transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Load OSS QBO Sample
              </button>
            </div>
          </div>

          {fileError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {fileError}
            </div>
          )}

          {/* Paste Area */}
          <div>
            <label htmlFor="qbo-paste-area" className="block text-xs font-medium text-slate-700 mb-1.5">
              Paste QBO {reportType === 'pnl' ? 'Profit & Loss' : 'Balance Sheet'} rows (Tab-separated, CSV, or space-aligned)
            </label>
            <textarea
              id="qbo-paste-area"
              rows={6}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setTargetOverrides({});
              }}
              placeholder={
                reportType === 'pnl'
                  ? 'Consulting - Debra (CA)\t127,340.00\nConsulting - Bill (AZ)\t165,443.71\nState\t-466.84\nInterest Income\t609.18'
                  : 'BlueVine Checking\t42,580.89\nAmazon CC\t842.15\nAMX CC\t1,125.40\nMember Draws\t(121,939.75)'
              }
              className="w-full px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-teal-700"
            />
          </div>

          {reportType === 'pnl' && (
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveProjected}
                onChange={(e) => setPreserveProjected(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-teal-800 focus:ring-teal-700"
              />
              <span>
                Keep existing Projected Full Year totals fixed (recalculate Remaining Forecast = Projected Full Year − Imported YTD). Unchecked keeps Remaining Forecast unchanged and updates Projected Full Year.
              </span>
            </label>
          )}

          {/* Parsed Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-900">Parsed Mapping Preview</h3>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {matchedCount} of {parsedRows.length} rows mapped
              </span>
            </div>

            {parsedRows.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-md py-8 px-4 text-center text-xs text-slate-500">
                Paste QuickBooks Online rows above or upload a CSV file to preview automatic line-item mapping. Total/summary rows are automatically skipped or deduplicated.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <th className="py-2 px-3">QBO Account / Row</th>
                      <th className="py-2 px-3 text-right">Parsed YTD</th>
                      <th className="py-2 px-3">Target Line Item</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {parsedRows.map((row) => {
                      const target = effectiveTarget(row);
                      return (
                        <tr
                          key={row.id}
                          className={
                            target === 'ignore'
                              ? 'bg-slate-50/50 text-slate-400'
                              : 'hover:bg-slate-50/60'
                          }
                        >
                          <td className="py-2 px-3">
                            <div className="font-medium text-slate-800">{row.rawLabel}</div>
                            {row.note && (
                              <div className="text-[10px] text-teal-700 mt-0.5">{row.note}</div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                            {formatCurrencyExact(row.amount)}
                          </td>
                          <td className="py-1.5 px-3">
                            <select
                              value={target}
                              onChange={(e) =>
                                setTargetOverrides((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.value as QboTargetField,
                                }))
                              }
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white text-slate-800 focus:outline-none focus:border-teal-700"
                            >
                              {targetOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
          <p className="text-xs text-slate-500">
            Multiple QBO accounts mapped to the same target line are automatically summed.
          </p>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={matchedCount === 0}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              Apply {matchedCount} {matchedCount === 1 ? 'Row' : 'Rows'} to YTD Actuals
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
