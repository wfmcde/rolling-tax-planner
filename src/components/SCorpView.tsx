import React from 'react';
import { Lock } from 'lucide-react';
import type { ComputedTaxYear, SetupConfig, TaxYearRecord } from '../types/tax';
import { formatCurrency, formatPercent } from '../utils/format';
import { NumericField } from './NumericField';

interface SCorpViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
}

export const SCorpView: React.FC<SCorpViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const comp = computed.find((c) => c.tax_year === yr.tax_year) ?? computed[0];
  const isLocked = yr.is_locked_actuals;

  const updateScorp = (patch: Partial<TaxYearRecord['scorp_1120s']>) => {
    if (isLocked) return;
    onUpdateYear(yr.tax_year, (prev) => ({
      ...prev,
      scorp_1120s: {
        ...prev.scorp_1120s,
        ...patch,
      },
    }));
  };

  const updateSourcingPercent = (index: number, pct: number) => {
    if (isLocked) return;
    onUpdateYear(yr.tax_year, (prev) => {
      const nextBreakdown = prev.scorp_1120s.state_sourcing_breakdown.map((item, idx) =>
        idx === index ? { ...item, apportionment_percent: pct } : item
      );
      const nextStates = prev.state_filings.map((sf) => {
        const match = nextBreakdown.find((b) => b.state_code === sf.state_code);
        return match ? { ...sf, state_apportionment_factor: match.apportionment_percent / 100 } : sf;
      });
      return {
        ...prev,
        scorp_1120s: {
          ...prev.scorp_1120s,
          state_sourcing_breakdown: nextBreakdown,
        },
        state_filings: nextStates,
      };
    });
  };

  const sourcingTotal = yr.scorp_1120s.state_sourcing_breakdown.reduce(
    (s, item) => s + item.apportionment_percent,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            S-Corporation (Form 1120-S) &amp; Distributions
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {yr.scorp_1120s.entity_name} · Officer W-2 vs. distribution split, employer payroll taxes, stock basis, and Accumulated Adjustments Account (AAA).
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {years.map((y) => (
            <button
              key={y.tax_year}
              type="button"
              onClick={() => onSelectYear(y.tax_year)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
                y.tax_year === yr.tax_year
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {y.is_locked_actuals && <Lock className="w-3 h-3 text-teal-700" />}
              {y.tax_year}
            </button>
          ))}
        </div>
      </div>

      {!setup.has_scorp && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs text-slate-600">
          The S-Corporation module is currently disabled in Setup &amp; Profile. Enable <span className="font-mono text-slate-900">has_scorp</span> to include Form 1120-S calculations in the six-year plan.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Entity Operations &amp; Officer Compensation ({yr.tax_year})
            </h2>
            {isLocked && (
              <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Year 1 Locked
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Entity Name</label>
            <input
              type="text"
              disabled={isLocked}
              value={yr.scorp_1120s.entity_name}
              onChange={(e) => updateScorp({ entity_name: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumericField
              label="Gross Receipts / Revenue"
              fieldCode="gross_receipts_revenue"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.gross_receipts_revenue}
              disabled={isLocked}
              onChange={(v) => updateScorp({ gross_receipts_revenue: v })}
            />
            <NumericField
              label="Operating Expenses (excl. W-2 & DBP)"
              fieldCode="operating_expenses"
              prefix="$"
              step={2000}
              value={yr.scorp_1120s.operating_expenses}
              disabled={isLocked}
              onChange={(v) => updateScorp({ operating_expenses: v })}
            />
            <NumericField
              label="Officer W-2 Wages"
              fieldCode="officer_w2_wages"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.officer_w2_wages}
              disabled={isLocked}
              onChange={(v) => updateScorp({ officer_w2_wages: v })}
              helperText={`Reasonable comp ratio: ${formatPercent(comp.scorp_out.reasonable_comp_ratio * 100, 1)}`}
            />
            <NumericField
              label="Shareholder Distributions Total"
              fieldCode="scorp_distributions_total"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.scorp_distributions_total}
              disabled={isLocked}
              onChange={(v) => updateScorp({ scorp_distributions_total: v })}
            />
            <NumericField
              label="Beginning Stock Basis"
              fieldCode="stock_basis_beginning"
              prefix="$"
              step={5000}
              value={comp.scorp_in.stock_basis_beginning}
              disabled={isLocked || yr.tax_year !== years[0].tax_year}
              onChange={(v) => updateScorp({ stock_basis_beginning: v })}
              helperText={
                yr.tax_year === years[0].tax_year
                  ? 'Year 1 starting shareholder basis'
                  : 'Carried forward automatically from prior year ending basis'
              }
            />
            <NumericField
              label="Beginning AAA Balance"
              fieldCode="aaa_balance_beginning"
              prefix="$"
              step={5000}
              value={comp.scorp_in.aaa_balance_beginning}
              disabled={isLocked || yr.tax_year !== years[0].tax_year}
              onChange={(v) => updateScorp({ aaa_balance_beginning: v })}
            />
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  State Revenue Sourcing Breakdown
                </h3>
                <p className="text-[11px] text-slate-500">
                  Must total 100% across active states. Updates linked state apportionment factors automatically.
                </p>
              </div>
              <span
                className={`text-xs font-mono font-semibold tabular-nums ${
                  Math.abs(sourcingTotal - 100) <= 0.5 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                Total: {sourcingTotal.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {yr.scorp_1120s.state_sourcing_breakdown.map((item, idx) => (
                <NumericField
                  key={item.state_code}
                  label={`${item.state_code} Apportionment Share`}
                  fieldCode={`state_sourcing[${item.state_code}]`}
                  suffix="%"
                  step={5}
                  min={0}
                  max={100}
                  value={item.apportionment_percent}
                  disabled={isLocked}
                  onChange={(v) => updateSourcingPercent(idx, v)}
                />
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                disabled={isLocked || !setup.has_pte}
                checked={setup.has_pte && yr.scorp_1120s.pte_election_active}
                onChange={(e) => updateScorp({ pte_election_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-teal-700"
              />
              <span>
                Entity-level Pass-Through Entity (PTE) Tax Election active in {yr.tax_year}
                {!setup.has_pte && ' (enable has_pte in Setup)'}
              </span>
            </label>
          </div>
        </div>

        {/* Right: S-Corp Deterministic Rollforward Output */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Form 1120-S &amp; Basis Schedule ({yr.tax_year})
          </h2>

          <dl className="divide-y divide-slate-100 text-xs">
            {[
              {
                label: 'Gross Receipts Revenue',
                code: 'gross_receipts_revenue',
                val: formatCurrency(yr.scorp_1120s.gross_receipts_revenue),
              },
              {
                label: 'Officer W-2 Wages',
                code: 'officer_w2_wages',
                val: formatCurrency(-yr.scorp_1120s.officer_w2_wages),
              },
              {
                label: 'Employer Payroll Taxes (FICA + FUTA)',
                code: 'employer_payroll_taxes',
                val: formatCurrency(-comp.scorp_out.employer_payroll_taxes),
              },
              {
                label: 'DBP Deductible Entity Contribution',
                code: 'dbp_actual_contribution',
                val: formatCurrency(
                  setup.has_dbp ? -yr.dbp_and_retirement.dbp_actual_contribution : 0
                ),
              },
              {
                label: 'Entity PTE Tax Paid (All States)',
                code: 'pte_tax_paid_total',
                val: formatCurrency(-comp.scorp_out.pte_tax_paid_total),
              },
              {
                label: 'Ordinary Business Income (Line 21 / K-1 Box 1)',
                code: 'ordinary_business_income_1120s',
                val: formatCurrency(comp.scorp_out.ordinary_business_income_1120s),
                bold: true,
              },
              {
                label: 'Stock Basis Beginning',
                code: 'stock_basis_beginning',
                val: formatCurrency(comp.scorp_in.stock_basis_beginning),
              },
              {
                label: 'Stock Basis Additions (K-1 Income)',
                code: 'stock_basis_additions',
                val: formatCurrency(comp.scorp_out.stock_basis_additions, true),
              },
              {
                label: 'Stock Basis Reductions (Distributions / Losses)',
                code: 'stock_basis_reductions',
                val: formatCurrency(-comp.scorp_out.stock_basis_reductions),
              },
              {
                label: 'Ending Stock Basis (Form 7203)',
                code: 'stock_basis_ending',
                val: formatCurrency(comp.scorp_out.stock_basis_ending),
                bold: true,
              },
              {
                label: 'Ending AAA Balance',
                code: 'aaa_balance_ending',
                val: formatCurrency(comp.scorp_out.aaa_balance_ending),
              },
              {
                label: 'Excess Distribution Capital Gain',
                code: 'excess_distribution_capital_gain',
                val: formatCurrency(comp.scorp_out.excess_distribution_capital_gain),
                warn: comp.scorp_out.excess_distribution_capital_gain > 0,
              },
            ].map((row) => (
              <div key={row.code} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <dt className={row.bold ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                    {row.label}
                  </dt>
                  <div className="text-[11px] font-mono text-slate-400">{row.code}</div>
                </div>
                <dd
                  className={`font-mono tabular-nums ${
                    row.warn
                      ? 'font-semibold text-red-700'
                      : row.bold
                      ? 'text-sm font-semibold text-teal-800'
                      : 'text-slate-800'
                  }`}
                >
                  {row.val}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* 6-Year Stock Basis & Distribution Schedule */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Six-Year S-Corp Compensation, K-1 &amp; Stock Basis Rollforward
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[760px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-medium">Tax Year</th>
                <th className="py-2.5 px-3 text-right font-medium">Gross Receipts</th>
                <th className="py-2.5 px-3 text-right font-medium">Officer W-2</th>
                <th className="py-2.5 px-3 text-right font-medium">K-1 Ordinary</th>
                <th className="py-2.5 px-3 text-right font-medium">Distributions</th>
                <th className="py-2.5 px-3 text-right font-medium">Ending Basis</th>
                <th className="py-2.5 px-4 text-right font-medium">Comp Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {computed.map((c) => (
                <tr
                  key={c.tax_year}
                  onClick={() => onSelectYear(c.tax_year)}
                  className={`cursor-pointer hover:bg-slate-50 ${
                    c.tax_year === yr.tax_year ? 'bg-teal-50/40' : ''
                  }`}
                >
                  <td className="py-2.5 px-4 font-semibold text-slate-900">
                    {c.tax_year} {c.is_locked_actuals ? '(Act)' : ''}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatCurrency(c.scorp_in.gross_receipts_revenue)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatCurrency(c.scorp_in.officer_w2_wages)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatCurrency(c.scorp_out.ordinary_business_income_1120s)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatCurrency(c.scorp_in.scorp_distributions_total)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                    {formatCurrency(c.scorp_out.stock_basis_ending)}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {formatPercent(c.scorp_out.reasonable_comp_ratio * 100, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
