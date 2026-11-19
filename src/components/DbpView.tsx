import React from 'react';
import { Lock } from 'lucide-react';
import type { ComputedTaxYear, DbpStatus, SetupConfig, TaxYearRecord } from '../types/tax';
import { formatCurrency } from '../utils/format';
import { NumericField } from './NumericField';

interface DbpViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
}

export const DbpView: React.FC<DbpViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const isLocked = yr.is_locked_actuals;
  const dbp = yr.dbp_and_retirement;

  const updateDbp = (patch: Partial<TaxYearRecord['dbp_and_retirement']>) => {
    if (isLocked) return;
    onUpdateYear(yr.tax_year, (prev) => ({
      ...prev,
      dbp_and_retirement: {
        ...prev.dbp_and_retirement,
        ...patch,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Defined Benefit Plan (DBP) &amp; Retirement
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Actuarial contribution limits, plan termination &amp; rollover milestones, participant loan collateral checks, 401(k)/IRA deferrals, and annuity contracts.
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Defined Benefit Plan Controls */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Defined Benefit Plan ({yr.tax_year})
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {setup.has_dbp ? dbp.dbp_plan_id : 'Inactive in Setup'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Plan Status (`dbp_status`)
              </label>
              <select
                disabled={isLocked || !setup.has_dbp}
                value={dbp.dbp_status}
                onChange={(e) => updateDbp({ dbp_status: e.target.value as DbpStatus })}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:border-teal-700 focus:outline-none"
              >
                <option value="active">Active (Funding)</option>
                <option value="frozen">Frozen</option>
                <option value="terminating">Terminating (Wind-Down)</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>

            <NumericField
              label="Target Termination Year"
              fieldCode="dbp_target_termination_year"
              step={1}
              min={2025}
              max={2040}
              value={dbp.dbp_target_termination_year}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_target_termination_year: Math.round(v) })}
            />

            <NumericField
              label="Max Deductible Contribution"
              fieldCode="dbp_max_deductible_contribution"
              prefix="$"
              step={2500}
              value={dbp.dbp_max_deductible_contribution}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_max_deductible_contribution: v })}
            />

            <NumericField
              label="Actual / Planned Contribution"
              fieldCode="dbp_actual_contribution"
              prefix="$"
              step={2500}
              value={dbp.dbp_actual_contribution}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_actual_contribution: v })}
              helperText="Guardrail flags excess above actuarial maximum or post-termination funding"
            />

            <NumericField
              label="Participant Loan Balance"
              fieldCode="dbp_loan_balance"
              prefix="$"
              step={1000}
              value={dbp.dbp_loan_balance}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_loan_balance: v })}
            />

            <NumericField
              label="Loan Collateral Requirement"
              fieldCode="dbp_collateral_requirement"
              prefix="$"
              step={1000}
              value={dbp.dbp_collateral_requirement}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_collateral_requirement: v })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Rollover Target Account (`dbp_rollover_target_account`)
            </label>
            <input
              type="text"
              disabled={isLocked || !setup.has_dbp}
              value={dbp.dbp_rollover_target_account}
              onChange={(e) => updateDbp({ dbp_rollover_target_account: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:border-teal-700 focus:outline-none"
            />
          </div>
        </div>

        {/* Qualified Plans & Annuities */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Qualified Plans (401(k) / IRA) &amp; Annuities ({yr.tax_year})
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumericField
              label="401(k) / Profit-Sharing Contribution"
              fieldCode="qualified_plan_contribution"
              prefix="$"
              step={1000}
              value={dbp.qualified_plan_contribution}
              disabled={isLocked || !setup.has_401k_or_ira}
              onChange={(v) => updateDbp({ qualified_plan_contribution: v })}
            />

            <NumericField
              label="Direct Rollover Amount"
              fieldCode="rollover_amount"
              prefix="$"
              step={10000}
              value={dbp.rollover_amount}
              disabled={isLocked}
              onChange={(v) => updateDbp({ rollover_amount: v })}
              helperText="Non-taxable direct trustee-to-trustee rollover"
            />

            <NumericField
              label="Annuity Contract Value"
              fieldCode="annuity_contract_value"
              prefix="$"
              step={10000}
              value={dbp.annuity_contract_value}
              disabled={isLocked || !setup.has_annuity}
              onChange={(v) => updateDbp({ annuity_contract_value: v })}
            />

            <NumericField
              label="Annual Annuity Payout"
              fieldCode="annuity_payout_amount"
              prefix="$"
              step={1000}
              value={dbp.annuity_payout_amount}
              disabled={isLocked || !setup.has_annuity}
              onChange={(v) => updateDbp({ annuity_payout_amount: v })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Rollover Source Type (`rollover_source_type`)
            </label>
            <input
              type="text"
              disabled={isLocked}
              value={dbp.rollover_source_type}
              onChange={(e) => updateDbp({ rollover_source_type: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:border-teal-700 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Six-Year DBP & Retirement Timeline */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Six-Year Retirement Funding &amp; Termination Schedule
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[740px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-medium">Tax Year</th>
                <th className="py-2.5 px-3 font-medium">DBP Status</th>
                <th className="py-2.5 px-3 text-right font-medium">DBP Max Limit</th>
                <th className="py-2.5 px-3 text-right font-medium">DBP Contribution</th>
                <th className="py-2.5 px-3 text-right font-medium">401(k) / PS</th>
                <th className="py-2.5 px-3 text-right font-medium">Rollover Event</th>
                <th className="py-2.5 px-4 text-right font-medium">Loan Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {computed.map((c) => {
                const overLimit =
                  c.dbp_in.dbp_actual_contribution > c.dbp_in.dbp_max_deductible_contribution;
                return (
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
                    <td className="py-2.5 px-3 font-sans capitalize text-slate-700">
                      {c.dbp_in.dbp_status}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {formatCurrency(c.dbp_in.dbp_max_deductible_contribution)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold ${
                        overLimit ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatCurrency(c.dbp_in.dbp_actual_contribution)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {formatCurrency(c.dbp_in.qualified_plan_contribution)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-teal-800">
                      {c.dbp_in.rollover_amount > 0 ? formatCurrency(c.dbp_in.rollover_amount) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {formatCurrency(c.dbp_in.dbp_loan_balance)}
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
