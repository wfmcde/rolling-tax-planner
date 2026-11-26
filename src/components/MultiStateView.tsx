import React from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type {
  ComputedTaxYear,
  ResidencyStatus,
  SetupConfig,
  StateFilingInputs,
  TaxYearRecord,
} from '../types/tax';
import { STATE_TAX_RULES } from '../engine/taxEngine';
import { formatCurrency } from '../utils/format';
import { ALL_US_STATE_OPTIONS, getStateFullName } from '../utils/setupHelpers';
import { NumericField } from './NumericField';

interface MultiStateViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  onUpdateSetup?: (next: SetupConfig) => void;
}

const AVAILABLE_STATES = ALL_US_STATE_OPTIONS.map((st) => st.code);

export const MultiStateView: React.FC<MultiStateViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
  onUpdateSetup,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const comp = computed.find((c) => c.tax_year === yr.tax_year) ?? computed[0];
  const isLocked = yr.is_locked_actuals;

  const updateStateAt = (index: number, patch: Partial<StateFilingInputs>) => {
    if (isLocked) return;
    if (patch.state_pte_elected === true && !setup.has_pte && onUpdateSetup) {
      onUpdateSetup({ ...setup, has_pte: true });
    }
    onUpdateYear(yr.tax_year, (prev) => {
      const nextFilings = prev.state_filings.map((sf, idx) =>
        idx === index ? { ...sf, ...patch } : sf
      );
      const nextSourcing = nextFilings.map((sf) => ({
        state_code: sf.state_code,
        apportionment_percent: Math.round(sf.state_apportionment_factor * 100),
      }));
      const anyStatePteElected = nextFilings.some((sf) => Boolean(sf.state_pte_elected));
      return {
        ...prev,
        state_filings: nextFilings,
        scorp_1120s: {
          ...prev.scorp_1120s,
          state_sourcing_breakdown: nextSourcing,
          pte_election_active: anyStatePteElected,
        },
      };
    });
  };

  const addState = () => {
    if (isLocked) return;
    const existingCodes = new Set(yr.state_filings.map((s) => s.state_code));
    const nextCode = AVAILABLE_STATES.find((c) => !existingCodes.has(c)) ?? AVAILABLE_STATES[0] ?? 'TX';
    onUpdateYear(yr.tax_year, (prev) => {
      const nextItem: StateFilingInputs = {
        state_code: nextCode,
        residency_status: 'non_resident',
        residency_start_date: `${prev.tax_year}-01-01`,
        residency_end_date: `${prev.tax_year}-12-31`,
        residency_day_or_income_ratio: 0,
        state_return_type: `${nextCode} Non-Resident Personal + S-Corp`,
        state_apportionment_factor: 0,
        state_pte_elected: false,
        other_state_credits_claimed: 0,
        state_tax_withholding_and_estimates: 0,
      };
      const nextFilings = [...prev.state_filings, nextItem];
      return {
        ...prev,
        state_filings: nextFilings,
        scorp_1120s: {
          ...prev.scorp_1120s,
          state_sourcing_breakdown: nextFilings.map((sf) => ({
            state_code: sf.state_code,
            apportionment_percent: Math.round(sf.state_apportionment_factor * 100),
          })),
        },
      };
    });
  };

  const removeState = (index: number) => {
    if (isLocked || yr.state_filings.length <= 1) return;
    onUpdateYear(yr.tax_year, (prev) => {
      const nextFilings = prev.state_filings.filter((_, idx) => idx !== index);
      return {
        ...prev,
        state_filings: nextFilings,
        scorp_1120s: {
          ...prev.scorp_1120s,
          state_sourcing_breakdown: nextFilings.map((sf) => ({
            state_code: sf.state_code,
            apportionment_percent: Math.round(sf.state_apportionment_factor * 100),
          })),
        },
      };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Multi-State Residency, Sourcing &amp; PTE
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Module 2 §5 · Full-year, part-year, and non-resident filings, state apportionment, Pass-Through Entity (PTE) elections, and other-state tax credits.
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

      {/* State Filing Cards */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-600">
          {yr.tax_year} Total State Liability:{' '}
          <span className="font-mono font-semibold text-slate-900">
            {formatCurrency(comp.total_state_tax)}
          </span>
          <span className="mx-2 text-slate-300">·</span>
          Entity PTE Payments:{' '}
          <span className="font-mono font-semibold text-slate-900">
            {formatCurrency(comp.scorp_out.pte_tax_paid_total)}
          </span>
        </div>

        {!isLocked && (
          <button
            type="button"
            onClick={addState}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add State Jurisdiction
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {yr.state_filings.map((sf, idx) => {
          const out = comp.state_filings_out[idx];
          const rule = STATE_TAX_RULES[sf.state_code];
          return (
            <div
              key={`${sf.state_code}-${idx}`}
              className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {rule?.name ?? getStateFullName(sf.state_code)} ({sf.state_code})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">{sf.state_return_type}</p>
                </div>
                {!isLocked && yr.state_filings.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeState(idx)}
                    aria-label={`Remove ${sf.state_code}`}
                    className="p-1.5 text-slate-400 hover:text-red-700 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">State Code</label>
                  <select
                    disabled={isLocked}
                    value={sf.state_code}
                    onChange={(e) => updateStateAt(idx, { state_code: e.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono text-slate-900 disabled:bg-slate-50"
                  >
                    {AVAILABLE_STATES.map((code) => (
                      <option key={code} value={code}>
                        {code} — {STATE_TAX_RULES[code]?.name ?? getStateFullName(code)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Residency Status
                  </label>
                  <select
                    disabled={isLocked}
                    value={sf.residency_status}
                    onChange={(e) =>
                      updateStateAt(idx, {
                        residency_status: e.target.value as ResidencyStatus,
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-50"
                  >
                    <option value="resident">Full-Year Resident</option>
                    <option value="part_year_resident">Part-Year Resident</option>
                    <option value="non_resident">Non-Resident (Sourced)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Residency Start
                  </label>
                  <input
                    type="date"
                    disabled={isLocked}
                    value={sf.residency_start_date}
                    onChange={(e) => updateStateAt(idx, { residency_start_date: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-900 disabled:bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Residency End
                  </label>
                  <input
                    type="date"
                    disabled={isLocked}
                    value={sf.residency_end_date}
                    onChange={(e) => updateStateAt(idx, { residency_end_date: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-900 disabled:bg-slate-50"
                  />
                </div>

                <NumericField
                  label="Residency Allocation Ratio"
                  fieldCode="residency_day_or_income_ratio"
                  suffix="%"
                  step={5}
                  min={0}
                  max={100}
                  value={Math.round(sf.residency_day_or_income_ratio * 100)}
                  disabled={isLocked}
                  onChange={(v) => updateStateAt(idx, { residency_day_or_income_ratio: v / 100 })}
                />

                <NumericField
                  label="S-Corp Apportionment Factor"
                  fieldCode="state_apportionment_factor"
                  suffix="%"
                  step={5}
                  min={0}
                  max={100}
                  value={Math.round(sf.state_apportionment_factor * 100)}
                  disabled={isLocked}
                  onChange={(v) => updateStateAt(idx, { state_apportionment_factor: v / 100 })}
                />

                <NumericField
                  label="State Withholding & Estimates"
                  fieldCode="state_tax_withholding_and_estimates"
                  prefix="$"
                  step={500}
                  value={sf.state_tax_withholding_and_estimates}
                  disabled={isLocked}
                  onChange={(v) => updateStateAt(idx, { state_tax_withholding_and_estimates: v })}
                />

                <NumericField
                  label="Other State-Specific Credits"
                  fieldCode="other_state_credits_claimed"
                  prefix="$"
                  step={250}
                  value={sf.other_state_credits_claimed}
                  disabled={isLocked}
                  onChange={(v) => updateStateAt(idx, { other_state_credits_claimed: v })}
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isLocked || !setup.has_scorp || !rule?.pteAvailable}
                  checked={
                    Boolean(rule?.pteAvailable) &&
                    setup.has_scorp &&
                    sf.state_pte_elected &&
                    (!isLocked || (setup.has_pte && yr.scorp_1120s.pte_election_active))
                  }
                  onChange={(e) => updateStateAt(idx, { state_pte_elected: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                <span>
                  Elect {sf.state_code} PTE Tax
                  {rule?.pteAvailable
                    ? ` (${(rule.pteRate * 100).toFixed(2)}% entity rate)`
                    : ' (Not applicable)'}
                </span>
              </label>

              {out && (
                <div className="pt-3 border-t border-slate-200 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="text-slate-500">Apportioned / Allocated Income</div>
                  <div className="text-right font-mono tabular-nums text-slate-900">
                    {formatCurrency(out.state_apportioned_income)}
                  </div>
                  <div className="text-slate-500">State Taxable Income</div>
                  <div className="text-right font-mono tabular-nums text-slate-900">
                    {formatCurrency(out.state_taxable_income)}
                  </div>
                  <div className="text-slate-500">Other-State Tax Credit (OSTC)</div>
                  <div className="text-right font-mono tabular-nums text-emerald-700">
                    {out.credit_for_taxes_paid_to_other_states > 0
                      ? `-${formatCurrency(out.credit_for_taxes_paid_to_other_states)}`
                      : '$0'}
                  </div>
                  <div className="text-slate-500">PTE Entity Payment / Credit</div>
                  <div className="text-right font-mono tabular-nums text-slate-800">
                    {formatCurrency(out.state_pte_payment_amount)} / -{formatCurrency(out.state_pte_credit_or_exclusion_amount)}
                  </div>
                  <div className="text-slate-500">
                    Business Entity Tax ({sf.state_code === 'CA' ? 'Form 100S' : sf.state_code === 'AZ' ? 'Form 120S' : 'Entity'})
                  </div>
                  <div className="text-right font-mono tabular-nums text-slate-900">
                    {formatCurrency(out.state_entity_tax_liability)}
                  </div>
                  <div className="text-slate-500">
                    Net Personal State Tax
                    {out.state_personal_tax_liability < 0 && (
                      <span className="ml-1 text-[10px] text-emerald-700">
                        ({sf.state_code === 'AZ' ? 'PTE Refund' : 'PTE Credit/Carryfwd'})
                      </span>
                    )}
                  </div>
                  <div
                    className={`text-right font-mono tabular-nums ${
                      out.state_personal_tax_liability < 0
                        ? 'text-emerald-700 font-medium'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatCurrency(out.state_personal_tax_liability)}
                  </div>
                  <div className="font-semibold text-slate-900">Total State Tax Liability</div>
                  <div className="text-right font-mono tabular-nums font-semibold text-teal-800">
                    {formatCurrency(out.state_income_tax_liability)}
                  </div>
                  <div className="text-slate-500">Net Tax Due / (Refund)</div>
                  <div
                    className={`text-right font-mono tabular-nums font-medium ${
                      out.state_net_tax_due_or_refund > 0 ? 'text-slate-900' : 'text-emerald-700'
                    }`}
                  >
                    {formatCurrency(out.state_net_tax_due_or_refund, true)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Six-Year Multi-State Summary Matrix */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Six-Year Multi-State Tax &amp; Residency Matrix
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-medium">Tax Year</th>
                <th className="py-2.5 px-3 font-medium">Active Jurisdictions &amp; Residency</th>
                <th className="py-2.5 px-3 text-right font-medium">PTE Paid</th>
                <th className="py-2.5 px-3 text-right font-medium">OSTC Claimed</th>
                <th className="py-2.5 px-4 text-right font-medium">Total State Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {computed.map((c) => {
                const ostcTotal = c.state_filings_out.reduce(
                  (s, sf) => s + sf.credit_for_taxes_paid_to_other_states,
                  0
                );
                return (
                  <tr
                    key={c.tax_year}
                    onClick={() => onSelectYear(c.tax_year)}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      c.tax_year === yr.tax_year ? 'bg-teal-50/40' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {c.tax_year}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {c.state_filings_out
                        .map(
                          (sf) =>
                            `${sf.state_code} (${sf.residency_status.replace(/_/g, ' ')}, ${Math.round(
                              sf.state_apportionment_factor * 100
                            )}%)`
                        )
                        .join(' · ')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatCurrency(c.scorp_out.pte_tax_paid_total)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatCurrency(ostcTotal)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatCurrency(c.total_state_tax)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
