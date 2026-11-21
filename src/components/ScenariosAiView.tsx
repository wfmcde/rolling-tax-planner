import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRightLeft, Check, Loader2, Sparkles } from 'lucide-react';
import type {
  ComputedTaxYear,
  PlannerState,
  ScenarioDefinition,
  ValidationIssue,
} from '../types/tax';
import { calculateSixYearPlan } from '../engine/taxEngine';
import { SCENARIO_PRESETS } from '../engine/scenarios';
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format';

interface ScenariosAiViewProps {
  state: PlannerState;
  baselineComputed: ComputedTaxYear[];
  issues: ValidationIssue[];
  onAdoptScenario: (scenario: ScenarioDefinition) => void;
}

export const ScenariosAiView: React.FC<ScenariosAiViewProps> = ({
  state,
  baselineComputed,
  issues,
  onAdoptScenario,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SCENARIO_PRESETS[0].id);
  const [adoptedId, setAdoptedId] = useState<string | null>(null);

  const [userQuestion, setUserQuestion] = useState('');
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const activePreset =
    SCENARIO_PRESETS.find((p) => p.id === selectedPresetId) ?? SCENARIO_PRESETS[0];

  const scenarioDef = useMemo(() => activePreset.build(state), [activePreset, state]);

  const scenarioComputed = useMemo(
    () => calculateSixYearPlan(scenarioDef.setup, scenarioDef.years),
    [scenarioDef]
  );

  const baseline6YrTax = baselineComputed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const scenario6YrTax = scenarioComputed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const taxDelta = scenario6YrTax - baseline6YrTax; // negative = savings

  const baseline6YrCash = baselineComputed.reduce((s, c) => s + c.estimated_net_cash_flow, 0);
  const scenario6YrCash = scenarioComputed.reduce((s, c) => s + c.estimated_net_cash_flow, 0);
  const cashDelta = scenario6YrCash - baseline6YrCash;

  const chartData = baselineComputed.map((b, idx) => {
    const alt = scenarioComputed[idx];
    return {
      year: String(b.tax_year),
      Baseline: b.total_all_in_tax,
      Alternative: alt?.total_all_in_tax ?? b.total_all_in_tax,
    };
  });

  const handleAdopt = () => {
    onAdoptScenario(scenarioDef);
    setAdoptedId(scenarioDef.id);
  };

  const handleGenerateNarrative = async () => {
    setLoadingAi(true);
    setAiError(null);
    try {
      const compactBaseline = baselineComputed.map((c) => ({
        tax_year: c.tax_year,
        record_mode: c.record_mode,
        is_locked_actuals: c.is_locked_actuals,
        w2_wages_total: c.form_1040_in.w2_wages_total,
        schedule_k1_ordinary_income: c.form_1040_in.schedule_k1_ordinary_income,
        adjusted_gross_income: c.form_1040_out.adjusted_gross_income,
        deduction_amount: c.form_1040_out.deduction_amount,
        qualified_business_income_deduction: c.form_1040_out.qualified_business_income_deduction,
        taxable_income: c.form_1040_out.taxable_income,
        federal_income_tax: c.form_1040_out.federal_income_tax,
        marginal_tax_rate: c.form_1040_out.marginal_tax_rate,
        effective_tax_rate: c.form_1040_out.effective_tax_rate,
        primary_ss_gross: c.form_1040_out.primary_ss_gross,
        spouse_ss_gross: c.form_1040_out.spouse_ss_gross,
        social_security_taxable: c.form_1040_out.social_security_taxable,
        irmaa_lookback_magi: c.form_1040_out.irmaa_lookback_magi,
        irmaa_tier: c.form_1040_out.irmaa_tier,
        primary_irmaa_surcharge: c.form_1040_out.primary_irmaa_surcharge,
        spouse_irmaa_surcharge: c.form_1040_out.spouse_irmaa_surcharge,
        irmaa_annual_surcharge: c.form_1040_out.irmaa_annual_surcharge,
        officer_w2_wages: c.scorp_in.officer_w2_wages,
        scorp_distributions_total: c.scorp_in.scorp_distributions_total,
        stock_basis_ending: c.scorp_out.stock_basis_ending,
        aaa_balance_ending: c.scorp_out.aaa_balance_ending,
        dbp_status: c.dbp_in.dbp_status,
        dbp_actual_contribution: c.dbp_in.dbp_actual_contribution,
        pte_tax_paid_total: c.scorp_out.pte_tax_paid_total,
        state_income_tax_liability: c.total_state_tax,
        total_all_in_tax: c.total_all_in_tax,
        all_in_effective_rate: c.all_in_effective_rate,
      }));

      const compactAlt = scenarioComputed.map((c) => ({
        tax_year: c.tax_year,
        adjusted_gross_income: c.form_1040_out.adjusted_gross_income,
        qualified_business_income_deduction: c.form_1040_out.qualified_business_income_deduction,
        taxable_income: c.form_1040_out.taxable_income,
        federal_income_tax: c.form_1040_out.federal_income_tax,
        pte_tax_paid_total: c.scorp_out.pte_tax_paid_total,
        state_income_tax_liability: c.total_state_tax,
        total_all_in_tax: c.total_all_in_tax,
        all_in_effective_rate: c.all_in_effective_rate,
      }));

      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline: compactBaseline,
          alternative: compactAlt,
          alternativeName: scenarioDef.name,
          issues: issues.map((i) => ({
            severity: i.severity,
            tax_year: i.tax_year,
            title: i.title,
            field_reference: i.field_reference,
          })),
          userQuestion: userQuestion.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate grounded explanation.');
      setNarrative(data.narrative);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate narrative.');
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Six-Year Scenarios &amp; Grounded AI Narrative
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Module 4 §4 · Deterministic multi-year scenario comparison paired with plain-English explanations strictly anchored to named calculation output fields.
        </p>
      </div>

      {/* Scenario Selector */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Select Alternative Forecast Strategy
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compares your current Baseline against a modeled strategy across the full six-year window ({state.setup.forecast_years[0]}–{state.setup.forecast_years[5]}).
            </p>
          </div>
          <button
            type="button"
            onClick={handleAdopt}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            {adoptedId === scenarioDef.id ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" /> Adopted as Baseline
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-3.5 h-3.5" /> Adopt Strategy as Baseline
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SCENARIO_PRESETS.map((preset) => {
            const active = preset.id === selectedPresetId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSelectedPresetId(preset.id);
                  setAdoptedId(null);
                }}
                className={`text-left p-3.5 rounded-md border transition-colors ${
                  active
                    ? 'border-teal-700 bg-teal-50/40'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-semibold text-slate-900">{preset.name}</div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Delta KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Baseline 6-Year All-In Tax</div>
            <div className="mt-1 text-xl font-mono font-semibold tabular-nums text-slate-900">
              {formatCurrency(baseline6YrTax)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Alternative 6-Year All-In Tax</div>
            <div className="mt-1 text-xl font-mono font-semibold tabular-nums text-slate-900">
              {formatCurrency(scenario6YrTax)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">6-Year Cumulative Tax Impact</div>
            <div
              className={`mt-1 text-xl font-mono font-semibold tabular-nums ${
                taxDelta <= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {formatCurrency(taxDelta, true)}
              <span className="ml-2 text-xs font-sans font-normal text-slate-500">
                ({taxDelta <= 0 ? 'Projected Savings' : 'Higher Tax'} · Cash {formatCurrency(cashDelta, true)})
              </span>
            </div>
          </div>
        </div>

        {/* Comparison Chart */}
        <div className="h-[240px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 12, fill: '#475569', fontFamily: 'IBM Plex Mono' }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => formatCompactCurrency(v)}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value)), String(name)]}
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'IBM Plex Mono',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="Baseline" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Alternative" fill="#0f766e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Year-by-Year Delta Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-left border-collapse text-xs min-w-[680px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2 px-3 font-medium">Tax Year</th>
                <th className="py-2 px-3 text-right font-medium">Baseline All-In Tax</th>
                <th className="py-2 px-3 text-right font-medium">Alternative All-In Tax</th>
                <th className="py-2 px-3 text-right font-medium">Annual Delta</th>
                <th className="py-2 px-3 text-right font-medium">Baseline Eff. Rate</th>
                <th className="py-2 px-3 text-right font-medium">Alt. Eff. Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {baselineComputed.map((b, idx) => {
                const a = scenarioComputed[idx];
                const diff = a.total_all_in_tax - b.total_all_in_tax;
                return (
                  <tr key={b.tax_year}>
                    <td className="py-2 px-3 font-semibold text-slate-900">
                      {b.tax_year} {b.is_locked_actuals ? '(Act)' : ''}
                    </td>
                    <td className="py-2 px-3 text-right">{formatCurrency(b.total_all_in_tax)}</td>
                    <td className="py-2 px-3 text-right">{formatCurrency(a.total_all_in_tax)}</td>
                    <td
                      className={`py-2 px-3 text-right font-semibold ${
                        diff < 0
                          ? 'text-emerald-700'
                          : diff > 0
                          ? 'text-red-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {diff === 0 ? '$0' : formatCurrency(diff, true)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatPercent(b.all_in_effective_rate, 1)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatPercent(a.all_in_effective_rate, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grounded AI Executive Narrative Panel */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Grounded Six-Year Tax Narrative &amp; Scenario Briefing
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every dollar figure, rate, and variance is attributed strictly to the deterministic calculation engine outputs above. Acronyms (DBP, PTE, QBI, AAA, AGI, IRMAA) are defined on first use.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            placeholder="Optional focus question (e.g., How does DBP termination in 2027 affect our federal bracket and IRMAA exposure?)"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleGenerateNarrative}
            disabled={loadingAi}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {loadingAi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {loadingAi ? 'Synthesizing Grounded Briefing...' : 'Generate Grounded Briefing'}
          </button>
        </div>

        {aiError && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
            {aiError}
          </div>
        )}

        {narrative && (
          <div className="pt-4 border-t border-slate-200 space-y-2 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {narrative}
          </div>
        )}

        {!narrative && !loadingAi && !aiError && (
          <div className="p-4 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
            Click <strong>Generate Grounded Briefing</strong> to produce a plain-English six-year comparison of your Baseline vs. <strong>{scenarioDef.name}</strong>, anchored directly to your deterministic Form 1040, Form 1120-S, Defined Benefit Plan, and multi-state figures.
          </div>
        )}
      </div>
    </div>
  );
};
