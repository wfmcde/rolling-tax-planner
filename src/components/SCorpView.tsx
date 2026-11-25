import React from 'react';
import { Lock } from 'lucide-react';
import type {
  BalanceSheetProjectionInputs,
  ComputedTaxYear,
  PnlBalanceSheetState,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { getPersonNames } from '../engine/scheduleCatalog';
import { getSetupStates } from '../utils/setupHelpers';
import { formatCurrency, formatPercent } from '../utils/format';
import { NumericField } from './NumericField';

interface SCorpViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  pnlState?: PnlBalanceSheetState;
  onUpdatePnlState?: (updater: (prev: PnlBalanceSheetState) => PnlBalanceSheetState) => void;
}

export const SCorpView: React.FC<SCorpViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
  pnlState,
  onUpdatePnlState,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const comp = computed.find((c) => c.tax_year === yr.tax_year) ?? computed[0];
  const isLocked = yr.is_locked_actuals;
  const { primaryName, spouseName } = getPersonNames(setup);
  const {
    primaryStateCode,
    primaryStateName,
    secondaryStateCode,
    secondaryStateName,
    hasPrimaryState,
    hasSecondaryState,
  } = getSetupStates(setup);
  const showSecondaryStateRev = Boolean(setup.multi_state_active || hasSecondaryState || yr.scorp_1120s.az_revenue > 0);
  const pCode = primaryStateCode || yr.state_filings[0]?.state_code || 'HOME';
  const sCode = secondaryStateCode || yr.state_filings[1]?.state_code || 'OTHER';

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

  const updateBalanceSheet = (patch: Partial<BalanceSheetProjectionInputs>) => {
    if (!onUpdatePnlState || isLocked) return;
    onUpdatePnlState((prev) => ({
      ...prev,
      balance_sheet: {
        ...prev.balance_sheet,
        ...patch,
      },
    }));
  };

  const bs = pnlState?.balance_sheet;
  const effectiveEndCash = bs
    ? bs.operating_cash_ye_override ?? bs.operating_cash_ytd ?? bs.operating_cash_beg
    : 0;
  const scheduleLMatchesYear = Boolean(pnlState && pnlState.projection_year === yr.tax_year);

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
              label={hasPrimaryState ? `${primaryStateName} S-Corp Revenue` : 'Primary S-Corp Revenue'}
              fieldCode="ca_revenue"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.ca_revenue}
              disabled={isLocked}
              onChange={(v) => {
                const nextPrimary = Math.max(0, v);
                const nextSecondary = showSecondaryStateRev ? yr.scorp_1120s.az_revenue : 0;
                const nextTotal = nextPrimary + nextSecondary;
                const nextPrimaryApp = nextTotal > 0 ? nextPrimary / nextTotal : 0;
                const nextSecondaryApp = nextTotal > 0 ? nextSecondary / nextTotal : 0;
                const nextBreakdown = showSecondaryStateRev
                  ? [
                      { state_code: pCode, apportionment_percent: Number((nextPrimaryApp * 100).toFixed(2)) },
                      { state_code: sCode, apportionment_percent: Number((nextSecondaryApp * 100).toFixed(2)) },
                    ]
                  : primaryStateCode
                  ? [{ state_code: primaryStateCode, apportionment_percent: 100 }]
                  : [];
                onUpdateYear(yr.tax_year, (prev) => ({
                  ...prev,
                  scorp_1120s: {
                    ...prev.scorp_1120s,
                    ca_revenue: nextPrimary,
                    az_revenue: nextSecondary,
                    gross_receipts_revenue: nextTotal,
                    state_sourcing_breakdown: nextBreakdown,
                  },
                  state_filings: prev.state_filings.map((sf) =>
                    sf.state_code === pCode
                      ? { ...sf, state_apportionment_factor: showSecondaryStateRev ? nextPrimaryApp : 1 }
                      : showSecondaryStateRev && sf.state_code === sCode
                      ? { ...sf, state_apportionment_factor: nextSecondaryApp }
                      : sf
                  ),
                }));
              }}
              helperText={`Total S-Corp Gross Revenue: ${formatCurrency(comp.scorp_in.gross_receipts_revenue)}`}
            />
            {showSecondaryStateRev && (
              <NumericField
                label={hasSecondaryState ? `${secondaryStateName} S-Corp Revenue` : 'Secondary State S-Corp Revenue'}
                fieldCode="az_revenue"
                prefix="$"
                step={5000}
                value={yr.scorp_1120s.az_revenue}
                disabled={isLocked}
                onChange={(v) => {
                  const nextPrimary = yr.scorp_1120s.ca_revenue;
                  const nextSecondary = Math.max(0, v);
                  const nextTotal = nextPrimary + nextSecondary;
                  const nextPrimaryApp = nextTotal > 0 ? nextPrimary / nextTotal : 0;
                  const nextSecondaryApp = nextTotal > 0 ? nextSecondary / nextTotal : 0;
                  onUpdateYear(yr.tax_year, (prev) => ({
                    ...prev,
                    scorp_1120s: {
                      ...prev.scorp_1120s,
                      az_revenue: nextSecondary,
                      gross_receipts_revenue: nextTotal,
                      state_sourcing_breakdown: [
                        { state_code: pCode, apportionment_percent: Number((nextPrimaryApp * 100).toFixed(2)) },
                        { state_code: sCode, apportionment_percent: Number((nextSecondaryApp * 100).toFixed(2)) },
                      ],
                    },
                    state_filings: prev.state_filings.map((sf) =>
                      sf.state_code === pCode
                        ? { ...sf, state_apportionment_factor: nextPrimaryApp }
                        : sf.state_code === sCode
                        ? { ...sf, state_apportionment_factor: nextSecondaryApp }
                        : sf
                    ),
                  }));
                }}
                helperText={
                  comp.scorp_in.gross_receipts_revenue > 0
                    ? `Split: ${pCode} ${((comp.scorp_in.ca_revenue / comp.scorp_in.gross_receipts_revenue) * 100).toFixed(1)}% / ${sCode} ${((comp.scorp_in.az_revenue / comp.scorp_in.gross_receipts_revenue) * 100).toFixed(1)}%`
                    : 'Split: 0% / 0%'
                }
              />
            )}
            {(() => {
              const isFutureForecastYear = !isLocked && yr.tax_year > setup.current_tax_year;
              const isProportionalMode =
                (setup.assumptions.opex_scaling_mode ?? 'revenue_proportional') ===
                'revenue_proportional';
              const ratioPct = Number(((setup.assumptions.expense_ratio ?? 0.2) * 100).toFixed(1));
              const isScaled = comp.scorp_out.operating_expenses_is_scaled;
              const isOverridden = comp.scorp_out.operating_expenses_is_overridden;

              return (
                <div className="space-y-1">
                  <NumericField
                    label="Operating Expenses (Excl. W-2, Payroll Taxes, SEHI & Ret.)"
                    fieldCode="operating_expenses"
                    prefix="$"
                    step={2000}
                    value={comp.scorp_out.effective_operating_expenses}
                    disabled={isLocked}
                    onChange={(v) => {
                      const nextVal = Math.max(0, v);
                      if (isFutureForecastYear && isProportionalMode) {
                        updateScorp({ operating_expenses_override: nextVal });
                      } else {
                        updateScorp({
                          operating_expenses: nextVal,
                          operating_expenses_override: null,
                        });
                      }
                    }}
                    helperText={
                      isLocked
                        ? `${yr.tax_year} locked actuals (detailed Form 1120-S deductions)`
                        : isOverridden
                        ? `Manual per-year override (${ratioPct}% revenue-proportional formula paused for ${yr.tax_year})`
                        : isScaled
                        ? `Auto-scaled at ${ratioPct}% of ${yr.tax_year} gross receipts`
                        : yr.tax_year <= setup.current_tax_year
                        ? `${yr.tax_year} baseline operating expenses`
                        : 'Fixed / inflation-indexed mode'
                    }
                  />
                  {isOverridden && (
                    <button
                      type="button"
                      onClick={() => updateScorp({ operating_expenses_override: null })}
                      className="text-[11px] font-medium text-teal-800 hover:text-teal-950 hover:underline"
                    >
                      Reset {yr.tax_year} Operating Expenses to {ratioPct}% of revenue
                    </button>
                  )}
                </div>
              );
            })()}
            <NumericField
              label={`${primaryName} W-2 Compensation`}
              fieldCode="bill_w2_wages"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.bill_w2_wages}
              disabled={isLocked}
              onChange={(v) => {
                const nextTotal = Math.max(0, v) + yr.scorp_1120s.debra_w2_wages;
                onUpdateYear(yr.tax_year, (prev) => ({
                  ...prev,
                  scorp_1120s: {
                    ...prev.scorp_1120s,
                    bill_w2_wages: Math.max(0, v),
                    officer_w2_wages: nextTotal,
                    payroll_taxes_input: undefined,
                  },
                  form_1040: {
                    ...prev.form_1040,
                    w2_wages_total: nextTotal,
                  },
                }));
              }}
              helperText={`Combined W-2: ${formatCurrency(comp.scorp_in.officer_w2_wages)} · Ratio ${formatPercent(comp.scorp_out.reasonable_comp_ratio * 100, 1)}`}
            />
            <NumericField
              label={`${spouseName} W-2 Compensation`}
              fieldCode="debra_w2_wages"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.debra_w2_wages}
              disabled={isLocked || setup.filing_status !== 'married_filing_jointly'}
              onChange={(v) => {
                const nextTotal = yr.scorp_1120s.bill_w2_wages + Math.max(0, v);
                onUpdateYear(yr.tax_year, (prev) => ({
                  ...prev,
                  scorp_1120s: {
                    ...prev.scorp_1120s,
                    debra_w2_wages: Math.max(0, v),
                    officer_w2_wages: nextTotal,
                    payroll_taxes_input: undefined,
                  },
                  form_1040: {
                    ...prev.form_1040,
                    w2_wages_total: nextTotal,
                  },
                }));
              }}
            />
            <NumericField
              label="Member Draws / Distributions"
              fieldCode="scorp_distributions_total"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.scorp_distributions_total}
              disabled={isLocked}
              onChange={(v) => updateScorp({ scorp_distributions_total: v })}
            />
            <NumericField
              label="Capital Contributions (Basis Added)"
              fieldCode="capital_contributions"
              prefix="$"
              step={5000}
              value={yr.scorp_1120s.capital_contributions}
              disabled={isLocked}
              onChange={(v) => updateScorp({ capital_contributions: Math.max(0, v) })}
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
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Schedule L &amp; M-2 — Balance Sheet, AAA &amp; Separately Stated Items
                </h3>
                <p className="text-[11px] text-slate-500">
                  Schedule M-1 / M-2 inputs for {yr.tax_year} and Schedule L Balance Sheet balances
                  {pnlState ? ` (${pnlState.projection_year} projection)` : ''} synced to Form 1120-S &amp; Shadow Tax Return (.xlsx).
                </p>
              </div>
              {pnlState && !scheduleLMatchesYear && !isLocked && (
                <span className="text-[11px] font-mono text-amber-700 whitespace-nowrap">
                  Sch L applies to {pnlState.projection_year}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumericField
                label="Beginning AAA Balance (Schedule M-2)"
                fieldCode="aaa_balance_beginning"
                prefix="$"
                step={5000}
                value={comp.scorp_in.aaa_balance_beginning}
                disabled={isLocked || yr.tax_year !== years[0].tax_year}
                onChange={(v) => updateScorp({ aaa_balance_beginning: v })}
                helperText={
                  yr.tax_year === years[0].tax_year
                    ? 'Year 1 starting Accumulated Adjustments Account'
                    : 'Carried forward automatically from prior year ending AAA'
                }
              />
              <NumericField
                label="Schedule K Interest Income (Box 4)"
                fieldCode="schedule_k_interest_income"
                prefix="$"
                step={100}
                value={yr.scorp_1120s.schedule_k_interest_income ?? 0}
                disabled={isLocked}
                onChange={(v) => updateScorp({ schedule_k_interest_income: Math.max(0, v) })}
                helperText="Separately stated S-Corp portfolio interest; adds to Form 7203 basis"
              />
              <NumericField
                label="50% Nondeductible Meals / Sch M-1 (Box 16c)"
                fieldCode="schedule_k_nondeductible_expenses"
                prefix="$"
                step={250}
                value={yr.scorp_1120s.schedule_k_nondeductible_expenses ?? 0}
                disabled={isLocked}
                onChange={(v) => updateScorp({ schedule_k_nondeductible_expenses: Math.max(0, v) })}
                helperText="Schedule M-1 nondeductible expenses reducing AAA & stock basis"
              />
            </div>

            {pnlState && bs && onUpdatePnlState && (
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Schedule L Balance Sheet ({pnlState.projection_year} Projection)
                  </div>
                  {isLocked && (
                    <span className="text-[11px] text-slate-400">
                      Select {pnlState.projection_year} to edit Schedule L balances
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NumericField
                    label="Beginning Operating Cash (Sch L Line 1a)"
                    fieldCode="operating_cash_beg"
                    prefix="$"
                    step={1000}
                    value={bs.operating_cash_beg}
                    disabled={isLocked}
                    onChange={(v) => updateBalanceSheet({ operating_cash_beg: v })}
                    helperText="Cash & operating checking balance as of Jan 1"
                  />
                  <div className="space-y-1">
                    <NumericField
                      label="End-of-Year Operating Cash (Sch L Line 1d)"
                      fieldCode="operating_cash_ye"
                      prefix="$"
                      step={1000}
                      value={effectiveEndCash}
                      disabled={isLocked}
                      onChange={(v) => updateBalanceSheet({ operating_cash_ye_override: v })}
                      helperText={
                        bs.operating_cash_ye_override !== null
                          ? 'Manual year-end override active (feeds Shadow Return Inputs!D36)'
                          : `Using current YTD cash (${formatCurrency(bs.operating_cash_ytd)})`
                      }
                    />
                    {!isLocked && bs.operating_cash_ye_override !== null && (
                      <button
                        type="button"
                        onClick={() => updateBalanceSheet({ operating_cash_ye_override: null })}
                        className="text-[11px] font-medium text-teal-800 hover:text-teal-950 hover:underline"
                      >
                        Reset EOY Cash to YTD balance ({formatCurrency(bs.operating_cash_ytd)})
                      </button>
                    )}
                  </div>
                  <NumericField
                    label="Accounts Payable & Credit Cards EOY (Sch L Line 16)"
                    fieldCode="cc_ap_ye"
                    prefix="$"
                    step={500}
                    value={bs.cc_ap_ye}
                    disabled={isLocked}
                    onChange={(v) => updateBalanceSheet({ cc_ap_ye: Math.max(0, v) })}
                    helperText="Year-end business credit card & AP balances"
                  />
                  <NumericField
                    label="Accrued Pension Payable EOY (Sch L Line 18)"
                    fieldCode="pension_payable_ye"
                    prefix="$"
                    step={1000}
                    value={bs.pension_payable_ye}
                    disabled={isLocked}
                    onChange={(v) => updateBalanceSheet({ pension_payable_ye: Math.max(0, v) })}
                    helperText="Accrued DBP / 401(k) liability at 12/31 ($0 under cash-basis / §404(a)(6))"
                  />
                </div>
              </div>
            )}
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
                label: 'Operating Expenses (Excl. W-2, Payroll Taxes, SEHI & Ret.)',
                code: 'effective_operating_expenses',
                val: formatCurrency(-comp.scorp_out.effective_operating_expenses),
              },
              {
                label: 'Officer W-2 Wages',
                code: 'officer_w2_wages',
                val: formatCurrency(-comp.scorp_in.officer_w2_wages),
              },
              {
                label: 'S-Corp >2% SEHI Health / Medicare',
                code: 'sehi_medicare_premiums_effective',
                val: formatCurrency(
                  yr.scorp_1120s.use_detailed_1120s_deductions
                    ? 0
                    : -comp.form_1040_out.sehi_medicare_premiums_effective
                ),
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
                  setup.has_dbp && yr.dbp_and_retirement.dbp_status !== 'terminated'
                    ? -yr.dbp_and_retirement.dbp_actual_contribution
                    : 0
                ),
              },
              {
                label: 'Employer 401(k) Profit Sharing / Match',
                code: 'employer_401k_total',
                val: formatCurrency(-comp.form_1040_out.employer_401k_total),
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
                label: 'Beginning AAA Balance (Schedule M-2 Line 1)',
                code: 'aaa_balance_beginning',
                val: formatCurrency(comp.scorp_in.aaa_balance_beginning),
              },
              {
                label: 'Ending AAA Balance (Schedule M-2 Line 8)',
                code: 'aaa_balance_ending',
                val: formatCurrency(comp.scorp_out.aaa_balance_ending),
                bold: true,
              },
              {
                label: 'Excess Distribution Capital Gain',
                code: 'excess_distribution_capital_gain',
                val: formatCurrency(comp.scorp_out.excess_distribution_capital_gain),
                warn: comp.scorp_out.excess_distribution_capital_gain > 0,
              },
              ...(scheduleLMatchesYear && bs
                ? [
                    {
                      label: 'Schedule L End-of-Year Cash',
                      code: 'operating_cash_ye',
                      val: formatCurrency(effectiveEndCash),
                    },
                    {
                      label: 'Schedule L Short-Term Payables (AP + Pension)',
                      code: 'cc_ap_ye + pension_payable_ye',
                      val: formatCurrency(bs.cc_ap_ye + bs.pension_payable_ye),
                    },
                  ]
                : []),
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
