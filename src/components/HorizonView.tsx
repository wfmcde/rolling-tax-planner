import React from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import type {
  ArchivedActualsRecord,
  ComputedTaxYear,
  SetupConfig,
  ValidationIssue,
  WorkspaceTab,
} from '../types/tax';
import {
  formatCompactCurrency,
  formatCurrency,
  formatFilingStatus,
  formatPercent,
} from '../utils/format';

interface HorizonViewProps {
  setup: SetupConfig;
  computed: ComputedTaxYear[];
  issues: ValidationIssue[];
  archivedYears: ArchivedActualsRecord[];
  selectedYear: number;
  onSelectYear: (year: number, navigateTo?: WorkspaceTab) => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

export const HorizonView: React.FC<HorizonViewProps> = ({
  setup,
  computed,
  issues,
  archivedYears,
  selectedYear,
  onSelectYear,
  onNavigate,
}) => {
  const year1 = computed[0];
  const cumulativeAllInTax = computed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const cumulativeFederal = computed.reduce((s, c) => s + c.form_1040_out.federal_income_tax, 0);
  const cumulativeState = computed.reduce((s, c) => s + c.total_state_tax, 0);
  const cumulativeAgi = computed.reduce((s, c) => s + c.form_1040_out.adjusted_gross_income, 0);
  const avgEffectiveRate =
    cumulativeAgi > 0 ? (cumulativeAllInTax / cumulativeAgi) * 100 : 0;

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  const chartData = computed.map((c) => ({
    year: c.is_locked_actuals ? `${c.tax_year} (Act)` : String(c.tax_year),
    taxYear: c.tax_year,
    Federal: c.form_1040_out.federal_income_tax,
    State: c.total_state_tax,
    'Payroll & PTE': c.total_entity_and_payroll_tax,
    'All-In Eff. Rate': c.all_in_effective_rate,
  }));

  const ledgerSections: {
    heading: string;
    rows: {
      label: string;
      code: string;
      bold?: boolean;
      highlight?: boolean;
      format?: 'currency' | 'percent' | 'text';
      getValue: (c: ComputedTaxYear) => number | string;
    }[];
  }[] = [
    {
      heading: 'Household Return (Form 1040)',
      rows: [
        {
          label: 'W-2 Wages Total',
          code: 'w2_wages_total',
          getValue: (c) => c.form_1040_in.w2_wages_total,
        },
        {
          label: 'Schedule K-1 Ordinary Income',
          code: 'schedule_k1_ordinary_income',
          getValue: (c) => c.form_1040_in.schedule_k1_ordinary_income,
        },
        {
          label: 'Investment & Retirement Taxable Income',
          code: 'interest_div_cap_ss_ira',
          getValue: (c) =>
            c.form_1040_in.taxable_interest +
            c.form_1040_in.ordinary_dividends +
            Math.max(-3000, c.form_1040_in.short_term_capital_gain_loss + c.form_1040_in.long_term_capital_gain_loss) +
            c.form_1040_in.ira_distributions_taxable +
            c.form_1040_in.pensions_and_annuities_taxable +
            c.form_1040_out.social_security_taxable,
        },
        {
          label: 'Adjusted Gross Income (AGI)',
          code: 'adjusted_gross_income',
          bold: true,
          getValue: (c) => c.form_1040_out.adjusted_gross_income,
        },
        {
          label: 'Standard / Itemized Deduction',
          code: 'deduction_amount',
          getValue: (c) => -c.form_1040_out.deduction_amount,
        },
        {
          label: 'QBI Deduction (Section 199A)',
          code: 'qualified_business_income_deduction',
          getValue: (c) => -c.form_1040_out.qualified_business_income_deduction,
        },
        {
          label: 'Taxable Income',
          code: 'taxable_income',
          bold: true,
          getValue: (c) => c.form_1040_out.taxable_income,
        },
      ],
    },
    ...(setup.has_scorp || setup.has_dbp
      ? [
          {
            heading: 'S-Corporation (1120-S) & Defined Benefit Plan',
            rows: [
              ...(setup.has_scorp
                ? [
                    {
                      label: 'Entity Gross Receipts',
                      code: 'gross_receipts_revenue',
                      getValue: (c: ComputedTaxYear) => c.scorp_in.gross_receipts_revenue,
                    },
                    {
                      label: 'Shareholder Distributions',
                      code: 'scorp_distributions_total',
                      getValue: (c: ComputedTaxYear) => c.scorp_in.scorp_distributions_total,
                    },
                    {
                      label: 'Ending Stock Basis',
                      code: 'stock_basis_ending',
                      getValue: (c: ComputedTaxYear) => c.scorp_out.stock_basis_ending,
                    },
                  ]
                : []),
              ...(setup.has_dbp
                ? [
                    {
                      label: 'DBP Deductible Contribution',
                      code: 'dbp_actual_contribution',
                      getValue: (c: ComputedTaxYear) => c.dbp_in.dbp_actual_contribution,
                    },
                    {
                      label: 'DBP Plan Status',
                      code: 'dbp_status',
                      format: 'text' as const,
                      getValue: (c: ComputedTaxYear) => c.dbp_in.dbp_status,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    {
      heading: 'Tax Liability & Effective Rates',
      rows: [
        {
          label: 'Federal Income Tax (incl. NIIT)',
          code: 'federal_income_tax',
          getValue: (c) => c.form_1040_out.federal_income_tax,
        },
        {
          label: 'Total State Tax Liability',
          code: 'state_income_tax_liability',
          getValue: (c) => c.total_state_tax,
        },
        {
          label: 'Employer Payroll & Entity PTE Tax',
          code: 'employer_payroll_and_pte',
          getValue: (c) => c.total_entity_and_payroll_tax,
        },
        {
          label: 'Total All-In Tax Obligation',
          code: 'total_all_in_tax',
          bold: true,
          highlight: true,
          getValue: (c) => c.total_all_in_tax,
        },
        {
          label: 'Federal Marginal Rate',
          code: 'marginal_tax_rate',
          format: 'percent',
          getValue: (c) => c.form_1040_out.marginal_tax_rate,
        },
        {
          label: 'Federal Effective Rate',
          code: 'effective_tax_rate',
          format: 'percent',
          getValue: (c) => c.form_1040_out.effective_tax_rate,
        },
        {
          label: 'All-In Effective Rate (% of AGI)',
          code: 'all_in_effective_rate',
          format: 'percent',
          bold: true,
          getValue: (c) => c.all_in_effective_rate,
        },
        {
          label: 'Estimated Net Household Cash Flow',
          code: 'estimated_net_cash_flow',
          bold: true,
          getValue: (c) => c.estimated_net_cash_flow,
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Title & Context Metadata */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Six-Year Rolling Tax Horizon
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{formatFilingStatus(setup.filing_status)}</span>
          <span aria-hidden="true">·</span>
          <span>
            Anchor Year {setup.anchor_actuals_year} ({year1?.is_locked_actuals ? 'Locked Actuals' : 'Unlocked Amendment Mode'})
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Forecast Years {setup.forecast_years[1]}–{setup.forecast_years[5]}
          </span>
          {setup.has_scorp && (
            <>
              <span aria-hidden="true">·</span>
              <span>{computed[0]?.scorp_in.entity_name} (1120-S)</span>
            </>
          )}
        </div>
      </div>

      {/* 4-Column Flat KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">6-Year All-In Tax Projection</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(cumulativeAllInTax)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Fed {formatCompactCurrency(cumulativeFederal)} · State {formatCompactCurrency(cumulativeState)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">6-Year All-In Effective Rate</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatPercent(avgEffectiveRate, 1)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Year 1 Federal Eff. {formatPercent(year1?.form_1040_out.effective_tax_rate ?? 0, 1)} · Marginal{' '}
            {formatPercent(year1?.form_1040_out.marginal_tax_rate ?? 0, 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Year 1 ({year1?.tax_year}) Filed Anchor
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(year1?.form_1040_out.taxable_income ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Taxable Income · AGI {formatCurrency(year1?.form_1040_out.adjusted_gross_income ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500">Deterministic Guardrails</div>
          <div className="mt-1.5 flex items-center gap-2">
            {errorCount > 0 ? (
              <>
                <ShieldAlert className="w-5 h-5 text-red-700 shrink-0" />
                <span className="text-lg font-semibold text-red-700">
                  {errorCount} Blocking {errorCount === 1 ? 'Issue' : 'Issues'}
                </span>
              </>
            ) : warningCount > 0 ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                <span className="text-lg font-semibold text-amber-700">
                  {warningCount} Review {warningCount === 1 ? 'Alert' : 'Alerts'}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span className="text-lg font-semibold text-emerald-700">All Checks Passed</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigate(issues[0]?.target_tab ?? 'scenarios')}
            className="mt-1 text-left text-xs font-medium text-teal-800 hover:underline"
          >
            {issues.length > 0 ? 'Inspect guardrail alert →' : 'Open Scenarios & Grounded AI →'}
          </button>
        </div>
      </div>

      {/* Guardrail Escalation Strip (only shown when errors or warnings exist) */}
      {issues.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Validation &amp; Guardrail Findings ({issues.length})
            </h2>
            <span className="text-xs text-slate-500">
              Module 4 §3 deterministic ruleset
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-start gap-2.5">
                  {issue.severity === 'error' ? (
                    <ShieldAlert className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      <span
                        className={
                          issue.severity === 'error' ? 'text-red-700 mr-1.5' : 'text-amber-700 mr-1.5'
                        }
                      >
                        {issue.severity === 'error' ? 'Blocking Error:' : 'Warning:'}
                      </span>
                      {issue.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{issue.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onSelectYear(issue.tax_year ?? setup.anchor_actuals_year, issue.target_tab)
                  }
                  className="text-xs font-medium text-teal-800 hover:text-teal-950 whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  Review in {issue.target_tab} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Six-Year Tax Trajectory Chart */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Six-Year Tax Composition &amp; Effective Rate Trajectory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Annual federal, state, and employer payroll / PTE tax layers stacked against all-in effective rate (% of AGI).
            </p>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {setup.forecast_years[0]} Actuals → {setup.forecast_years[5]} Forecast
          </div>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 12, fill: '#475569', fontFamily: 'IBM Plex Mono' }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => formatCompactCurrency(v)}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 45]}
                tick={{ fontSize: 11, fill: '#0f766e', fontFamily: 'IBM Plex Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const num = Number(value);
                  const label = String(name);
                  if (label.includes('Rate')) return [`${num.toFixed(1)}%`, label];
                  return [formatCurrency(num), label];
                }}
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'IBM Plex Mono',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Bar yAxisId="left" dataKey="Federal" stackId="tax" fill="#0f172a" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="State" stackId="tax" fill="#0f766e" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="Payroll & PTE" stackId="tax" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="All-In Eff. Rate"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 3.5, fill: '#d97706' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* High-Density Six-Year Ledger Grid */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Six-Year Financial Schedule
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any year header to inspect and edit its Form 1040, 1120-S, DBP, or multi-state inputs.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            All amounts in USD · Monospace tabular alignment
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-[260px]">
                  Line Item
                </th>
                {computed.map((c) => {
                  const isSel = c.tax_year === selectedYear;
                  return (
                    <th key={c.tax_year} className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectYear(c.tax_year, 'form1040')}
                        className={`inline-flex flex-col items-end group transition-colors ${
                          isSel ? 'text-teal-800' : 'text-slate-900 hover:text-teal-800'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1 text-sm font-mono font-semibold tabular-nums">
                          {c.is_locked_actuals && (
                            <Lock className="w-3 h-3 text-teal-700" aria-label="Locked actuals" />
                          )}
                          {c.tax_year}
                        </span>
                        <span className="text-[11px] font-normal text-slate-500 group-hover:text-teal-700">
                          {c.record_mode === 'actuals' ? 'Actuals' : 'Forecast'} · Age {c.primary_age}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600">
                  6-Yr Total
                </th>
              </tr>
            </thead>
            <tbody>
              {ledgerSections.map((section) => (
                <React.Fragment key={section.heading}>
                  <tr className="bg-slate-50/50 border-y border-slate-200">
                    <td
                      colSpan={computed.length + 2}
                      className="py-2 px-4 text-xs font-semibold text-slate-700"
                    >
                      {section.heading}
                    </td>
                  </tr>
                  {section.rows.map((row) => {
                    const fmt = row.format ?? 'currency';
                    const totalVal =
                      fmt === 'currency'
                        ? computed.reduce((s, c) => s + Number(row.getValue(c)), 0)
                        : null;
                    return (
                      <tr
                        key={row.code}
                        className={`border-b border-slate-100 hover:bg-slate-50/70 transition-colors ${
                          row.highlight ? 'bg-teal-50/30' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div
                            className={`text-xs ${
                              row.bold ? 'font-semibold text-slate-900' : 'text-slate-700'
                            }`}
                          >
                            {row.label}
                          </div>
                        </td>
                        {computed.map((c) => {
                          const raw = row.getValue(c);
                          let display = String(raw);
                          if (fmt === 'currency') display = formatCurrency(Number(raw));
                          if (fmt === 'percent') display = formatPercent(Number(raw), 1);
                          return (
                            <td
                              key={c.tax_year}
                              className={`py-2.5 px-3 text-right font-mono text-xs tabular-nums ${
                                row.bold ? 'font-semibold text-slate-900' : 'text-slate-700'
                              } ${c.record_mode === 'actuals' ? 'bg-slate-50/40' : ''}`}
                            >
                              {display}
                            </td>
                          );
                        })}
                        <td
                          className={`py-2.5 px-4 text-right font-mono text-xs tabular-nums ${
                            row.bold ? 'font-semibold text-slate-900' : 'text-slate-600'
                          }`}
                        >
                          {totalVal !== null ? formatCurrency(totalVal) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Archived Actuals History (shown after performing an Annual Roll Forward) */}
      {archivedYears.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Retired Actuals Archive ({archivedYears.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            Prior Year 1 filed returns archived when rolling the six-year horizon forward.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Tax Year</th>
                  <th className="py-2 px-4 font-medium">Archived On</th>
                  <th className="py-2 px-4 text-right font-medium">AGI</th>
                  <th className="py-2 px-4 text-right font-medium">Taxable Income</th>
                  <th className="py-2 px-4 text-right font-medium">Federal Tax</th>
                  <th className="py-2 pl-4 text-right font-medium">State Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                {archivedYears.map((arc) => (
                  <tr key={`${arc.tax_year}-${arc.archived_at}`}>
                    <td className="py-2 pr-4 font-semibold text-slate-900">{arc.tax_year}</td>
                    <td className="py-2 px-4 text-slate-500">{arc.archived_at}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.adjusted_gross_income)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.taxable_income)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.federal_income_tax)}</td>
                    <td className="py-2 pl-4 text-right">{formatCurrency(arc.summary.total_state_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
