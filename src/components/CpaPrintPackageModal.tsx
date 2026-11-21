import React from 'react';
import { AlertTriangle, Download, Printer, X } from 'lucide-react';
import type { PnlBalanceSheetState, SetupConfig } from '../types/tax';
import {
  PNL_OPERATING_ITEMS,
  PNL_SECTIONS,
  SCHEDULE_K_LINE_META,
  buildCpaPackageMetadata,
  getPnlLineLabel,
  type ComputedPnlBalanceSheet,
  type CpaReportMetadata,
} from '../engine/pnlBalanceSheet';
import { getPersonNames } from '../engine/scheduleCatalog';
import { formatCurrencyExact } from '../utils/format';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CpaPrintPackageModalProps {
  setup: SetupConfig;
  pnlState: PnlBalanceSheetState;
  computed: ComputedPnlBalanceSheet;
  entityName: string;
  entityEin: string;
  reportMeta?: CpaReportMetadata;
  moduleName?: string;
  forecastAssumptions?: string;
  onDownloadCsv: () => void;
  onClose: () => void;
}

export const CpaPrintPackageModal: React.FC<CpaPrintPackageModalProps> = ({
  setup,
  pnlState,
  computed,
  entityName,
  entityEin,
  reportMeta,
  moduleName,
  forecastAssumptions,
  onDownloadCsv,
  onClose,
}) => {
  const { primaryName, spouseName } = getPersonNames(setup);
  const bs = pnlState.balance_sheet;
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const meta = buildCpaPackageMetadata(setup, pnlState, computed, entityName, entityEin, {
    ...reportMeta,
    moduleName: reportMeta?.moduleName ?? moduleName,
    forecastAssumptions: reportMeta?.forecastAssumptions ?? forecastAssumptions,
  });

  const billPct = computed.billSharePct / 100;
  const billBeg = round2(computed.beginningStockBasis * billPct);
  const debraBeg = round2(computed.beginningStockBasis - billBeg);
  const posInc = Math.max(0, computed.ordinaryBusinessIncome.projected);
  const billInc = round2(posInc * billPct);
  const debraInc = round2(posInc - billInc);
  const posInt = Math.max(0, computed.scheduleKInterest.projected);
  const billInt = round2(posInt * billPct);
  const debraInt = round2(posInt - billInt);
  const billCap = round2(computed.projectedCapitalContributionsTotal * billPct);
  const debraCap = round2(computed.projectedCapitalContributionsTotal - billCap);
  const billDraws = round2(computed.projectedDrawsTotal * billPct);
  const debraDraws = round2(computed.projectedDrawsTotal - billDraws);
  const billNonded = round2(computed.mealsNondeductible50.projected * billPct);
  const debraNonded = round2(computed.mealsNondeductible50.projected - billNonded);

  return (
    <div
      className="print-only-container fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="CPA Year-End Projection Package"
    >
      <div className="print-only-container bg-white border border-slate-200 rounded-lg max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Non-print Action Bar */}
        <div className="no-print px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              CPA Year-End Projection Package — Print &amp; Export View
            </h2>
            <p className="text-xs text-slate-500">
              Preliminary tax-planning schedule formatted for review with your CPA (Form 1120-S P&amp;L, Schedule M-1 Meals Split, Schedule L, and Form 7203 Basis).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onDownloadCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close print preview"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="print-only-container flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-white text-slate-900">
          {/* Formal Statement Header & Branding */}
          <header className="space-y-3 border-b-2 border-slate-900 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-900">{meta.preparedBy}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-teal-800">{meta.website}</span>
              </div>
              <div className="font-medium text-slate-700">Module: {meta.moduleName}</div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Form 1120-S Year-End Financial &amp; Tax Projection Package
                </p>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-0.5">
                  {entityName}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-1">
                  <span className="font-mono">EIN {entityEin}</span>
                  <span aria-hidden="true">·</span>
                  <span>Tax Year {pnlState.projection_year}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Ownership: {primaryName} {computed.billSharePct}% / {spouseName}{' '}
                    {computed.debraSharePct}%
                  </span>
                </div>
              </div>
              <div className="text-right text-xs text-slate-600 space-y-0.5">
                <div>
                  As-Of Date:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {meta.asOfDateDisplay}
                  </span>{' '}
                  <span className="font-mono text-[11px] text-slate-400">({meta.asOfDate})</span>
                </div>
                <div>
                  Remaining Through {meta.yearEndDisplay}:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {meta.remainingDays} days
                  </span>{' '}
                  <span className="font-mono text-[11px] text-slate-500">
                    ({meta.elapsedDays}/{meta.totalYearDays} YTD)
                  </span>
                </div>
                <div>
                  Apportionment (Projected):{' '}
                  <span className="font-mono font-medium text-slate-900">
                    CA {computed.caPct.projected}% / AZ {computed.azPct.projected}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">Generated {generatedOn}</div>
              </div>
            </div>
          </header>

          {/* Prominent CPA Review Disclaimer */}
          <div
            role="note"
            className="bg-amber-50/80 border border-amber-300 border-l-4 border-l-amber-600 rounded px-4 py-3 text-xs text-amber-950"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold tracking-wide text-[11px] text-amber-900">
                  {meta.disclaimerHeadline}
                </div>
                <p className="text-[11px] leading-relaxed text-amber-950/90">
                  {meta.disclaimerBody}
                </p>
              </div>
            </div>
          </div>

          {/* Active Forecast Assumptions Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded px-4 py-3">
            <div className="text-[11px] font-bold tracking-wide text-slate-800 uppercase mb-1.5">
              Active Forecast Assumptions
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {meta.activeAssumptions.map((item) => (
                <div key={item.label} className="leading-snug">
                  <dt className="inline font-semibold text-slate-700">{item.label}: </dt>
                  <dd className="inline text-slate-600">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Executive Summary Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-2">
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected Gross Receipts</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.totalRevenue.projected)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                CA {computed.caPct.projected}% · AZ {computed.azPct.projected}%
              </div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected 1120-S Line 22</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                2025 Filed: {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
              </div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected Member Draws</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.projectedDrawsTotal)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Cap Contrib: {formatCurrencyExact(computed.projectedCapitalContributionsTotal)}
              </div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected Ending Basis</div>
              <div
                className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                  computed.drawsExceedBasis ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {formatCurrencyExact(computed.projectedEndingStockBasis)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                {computed.drawsExceedBasis
                  ? `Excess Gain: ${formatCurrencyExact(computed.projectedExcessDistributionGain)}`
                  : 'No excess dist gain'}
              </div>
            </div>
          </div>

          {/* 1. Profit & Loss Statement */}
          <section>
            <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
              1. Profit &amp; Loss Projection (Form 1120-S Structure)
            </h2>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-300 text-[11px] font-semibold text-slate-600">
                  <th className="py-1.5 pr-3">Line Item</th>
                  <th className="py-1.5 px-2">Ref</th>
                  <th className="py-1.5 px-2 text-right">YTD Actuals</th>
                  <th className="py-1.5 px-2 text-right">Remaining</th>
                  <th className="py-1.5 px-2 text-right">Projected {pnlState.projection_year}</th>
                  <th className="py-1.5 pl-2 text-right">2025 Filed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {PNL_SECTIONS.map((sec) => {
                  const items = PNL_OPERATING_ITEMS.filter((i) => i.section === sec.id);
                  return (
                    <React.Fragment key={sec.id}>
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="py-1.5 px-2 font-semibold text-slate-800">
                          {sec.title}
                        </td>
                      </tr>
                      {items.map((item) => {
                        const vals = computed.lines[item.id];
                        return (
                          <React.Fragment key={item.id}>
                            <tr>
                              <td className="py-1 pr-3 pl-2 text-slate-800">
                                {getPnlLineLabel(item, setup)}
                              </td>
                              <td className="py-1 px-2 text-[10px] font-mono text-slate-500">
                                {item.form1120sRef}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums">
                                {formatCurrencyExact(vals.ytd)}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums">
                                {formatCurrencyExact(vals.remaining)}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums font-medium">
                                {formatCurrencyExact(vals.projected)}
                              </td>
                              <td className="py-1 pl-2 text-right font-mono tabular-nums text-slate-500">
                                {formatCurrencyExact(vals.filed2025)}
                              </td>
                            </tr>
                            {item.id === 'meals_gross' && (
                              <>
                                <tr className="text-[11px] text-slate-600 bg-slate-50/40">
                                  <td className="py-1 pr-3 pl-6">
                                    ↳ 50% Deductible Meals (Included in 1120-S)
                                  </td>
                                  <td className="py-1 px-2 text-[10px] font-mono text-slate-400">
                                    Line 19
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.ytd)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.remaining)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.projected)}
                                  </td>
                                  <td className="py-1 pl-2 text-right font-mono tabular-nums text-slate-500">
                                    {formatCurrencyExact(computed.mealsDeductible50.filed2025)}
                                  </td>
                                </tr>
                                <tr className="text-[11px] text-amber-800 bg-amber-50/30">
                                  <td className="py-1 pr-3 pl-6">
                                    ↳ 50% Nondeductible Meals (Sch M-1 / Basis)
                                  </td>
                                  <td className="py-1 px-2 text-[10px] font-mono text-amber-700">
                                    Sch M-1
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.ytd)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.remaining)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.projected)}
                                  </td>
                                  <td className="py-1 pl-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.filed2025)}
                                  </td>
                                </tr>
                              </>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {sec.id === 'revenue' && (
                        <tr className="font-semibold border-t border-slate-200 bg-slate-50/60">
                          <td className="py-1.5 pr-3 pl-2">Total Gross Receipts</td>
                          <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">Line 1a</td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.ytd)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.remaining)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.projected)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalRevenue.filed2025)}
                          </td>
                        </tr>
                      )}
                      {sec.id === 'operating_expenses' && (
                        <tr className="font-semibold border-t border-slate-200 bg-slate-50/60">
                          <td className="py-1.5 pr-3 pl-2">
                            Total Operating Expenses (Excl. W-2 &amp; Retirement · Tax Deductible)
                          </td>
                          <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">
                            Lines 11–19
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.ytd)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.remaining)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.projected)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.filed2025)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                <tr className="border-t-2 border-slate-900 font-bold bg-slate-100/70">
                  <td className="py-2 pr-3 pl-2">
                    Projected Ordinary Business Income (Form 1120-S Line 22)
                  </td>
                  <td className="py-2 px-2 text-[10px] font-mono text-slate-600">Line 22</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.ytd)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.remaining)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
                  </td>
                  <td className="py-2 pl-2 text-right font-mono tabular-nums text-slate-600">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
                  </td>
                </tr>
                <tr className="bg-slate-50/70 text-slate-800">
                  <td className="py-1.5 pr-3 pl-2 font-medium">
                    {SCHEDULE_K_LINE_META.label} (Excl. from Line 22 · Adds to Basis)
                  </td>
                  <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">
                    {SCHEDULE_K_LINE_META.form1120sRef}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.scheduleKInterest.ytd)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.scheduleKInterest.remaining)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">
                    {formatCurrencyExact(computed.scheduleKInterest.projected)}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-500">
                    {formatCurrencyExact(computed.scheduleKInterest.filed2025)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 2. Schedule L Balance Sheet & 3. Form 7203 Basis Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                2. Schedule L Balance Sheet Projection
              </h2>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-2">Account</th>
                    <th className="py-1.5 px-2 text-right">Beg (1/1)</th>
                    <th className="py-1.5 px-2 text-right">YTD</th>
                    <th className="py-1.5 pl-2 text-right">Proj 12/31</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1.5 pr-2">Operating Cash</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.operating_cash_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.operating_cash_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(computed.projectedCashYe)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">Pension Expense Payable</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.pension_payable_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.pension_payable_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(bs.pension_payable_ye)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">Credit Card / Accounts Payable</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.cc_ap_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.cc_ap_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(bs.cc_ap_ye)}
                    </td>
                  </tr>
                  <tr className="font-semibold bg-slate-50 border-t border-slate-200">
                    <td className="py-1.5 pr-2">Net Cash After Short-Term Liab.</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionBeg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionYtd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionYe)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                3. Form 7203 Shareholder Stock Basis ({primaryName} {computed.billSharePct}% /{' '}
                {spouseName} {computed.debraSharePct}%)
              </h2>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-2">Basis Component</th>
                    <th className="py-1.5 px-2 text-right">Combined</th>
                    <th className="py-1.5 px-2 text-right">{primaryName}</th>
                    <th className="py-1.5 pl-2 text-right">{spouseName}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1.5 pr-2">Beginning Stock Basis</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.beginningStockBasis)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(billBeg)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(debraBeg)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Projected K-1 Ordinary Income</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(posInc)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(billInc)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(debraInc)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Schedule K Interest Income (Line 4)</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(posInt)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(billInt)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(debraInt)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Capital Contributions</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.projectedCapitalContributionsTotal)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(billCap)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(debraCap)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">− Member Draws / Distributions</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-computed.projectedDrawsTotal)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-billDraws)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-debraDraws)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">− Nondeductible (50% Meals)</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-computed.mealsNondeductible50.projected)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-billNonded)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-debraNonded)}
                    </td>
                  </tr>
                  <tr className="font-semibold bg-slate-50 border-t border-slate-200">
                    <td className="py-1.5 pr-2">Projected Ending Stock Basis</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.projectedEndingStockBasis)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.billProjectedBasisEnding)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.debraProjectedBasisEnding)}
                    </td>
                  </tr>
                  {computed.drawsExceedBasis && (
                    <tr className="font-semibold text-red-700 bg-red-50/60">
                      <td className="py-1.5 pr-2">Form 8949 Excess Dist. Gain</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrencyExact(computed.projectedExcessDistributionGain)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrencyExact(computed.billExcessGain)}
                      </td>
                      <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                        {formatCurrencyExact(computed.debraExcessGain)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>

          {/* Formal Branding, Assumptions & CPA Disclaimer Footer */}
          <footer className="border-t-2 border-slate-300 pt-3.5 mt-4 text-[11px] leading-relaxed text-slate-600 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-800">
              <div>
                <span className="font-semibold">{meta.preparedBy}</span>{' '}
                <span className="font-mono text-teal-800">({meta.website})</span>
                <span className="mx-1.5 text-slate-400">·</span>
                <span className="text-slate-700">{meta.moduleName}</span>
              </div>
              <div className="font-mono text-slate-700">
                As-Of {meta.asOfDateDisplay} · {meta.remainingDays} remaining days through{' '}
                {meta.yearEndDisplay}
              </div>
            </div>
            <div>
              <span className="font-semibold text-slate-800">Active Forecast Assumptions:</span>{' '}
              {meta.activeAssumptionsSummary}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-700">
              <span className="font-semibold text-slate-900">{meta.disclaimerHeadline}:</span>{' '}
              {meta.disclaimerBody}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
