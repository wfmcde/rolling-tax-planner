import React, { useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type {
  EntityType,
  FilingStatus,
  ProvenanceField,
  SetupConfig,
} from '../types/tax';
import { NumericField } from './NumericField';

interface SetupViewProps {
  setup: SetupConfig;
  onUpdateSetup: (next: SetupConfig) => void;
  onReprojectForecast: () => void;
}

interface AiIntakeResponse {
  summary?: string;
  proposed_setup?: Partial<SetupConfig>;
  provenance?: ProvenanceField[];
  follow_up_questions?: string[];
}

const SAMPLE_PROMPTS = [
  'Married filing jointly, born 1960 and 1962. We run an LLC taxed as an S-Corp with an active Defined Benefit Plan winding down in 2027, plus a 401(k). We moved part-year from California to Arizona in 2025 and want to evaluate State PTE elections.',
  'Single filer born 1978, sole proprietor transitioning to an LLC taxed as an S-Corp in Colorado with a 401(k) and no Defined Benefit Plan, single state only.',
];

export const SetupView: React.FC<SetupViewProps> = ({
  setup,
  onUpdateSetup,
  onReprojectForecast,
}) => {
  const [intakeText, setIntakeText] = useState('');
  const [loadingIntake, setLoadingIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeResult, setIntakeResult] = useState<AiIntakeResponse | null>(null);
  const [appliedBanner, setAppliedBanner] = useState(false);

  const handleToggle = (key: keyof SetupConfig, val: boolean) => {
    const next: SetupConfig = { ...setup, [key]: val };
    if (key === 'has_scorp') {
      next.entity_type = val ? 'scorp_llc' : 'none';
    }
    onUpdateSetup(next);
  };

  const handleEntityTypeChange = (entityType: EntityType) => {
    onUpdateSetup({
      ...setup,
      entity_type: entityType,
      has_scorp: entityType === 'scorp_llc',
    });
  };

  const handleRunIntake = async () => {
    if (!intakeText.trim()) return;
    setLoadingIntake(true);
    setIntakeError(null);
    setIntakeResult(null);
    setAppliedBanner(false);
    try {
      const res = await fetch('/api/ai/intake-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: intakeText }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse setup intake.');
      }
      setIntakeResult(data as AiIntakeResponse);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Unable to parse description.');
    } finally {
      setLoadingIntake(false);
    }
  };

  const handleApplyProposed = () => {
    if (!intakeResult?.proposed_setup) return;
    const p = intakeResult.proposed_setup;
    const next: SetupConfig = {
      ...setup,
      filing_status: (p.filing_status as FilingStatus) || setup.filing_status,
      primary_birth_year:
        typeof p.primary_birth_year === 'number' && p.primary_birth_year > 1920
          ? p.primary_birth_year
          : setup.primary_birth_year,
      spouse_birth_year:
        typeof p.spouse_birth_year === 'number' && p.spouse_birth_year > 1920
          ? p.spouse_birth_year
          : setup.spouse_birth_year,
      entity_type: (p.entity_type as EntityType) || (p.has_scorp ? 'scorp_llc' : setup.entity_type),
      has_scorp: typeof p.has_scorp === 'boolean' ? p.has_scorp : setup.has_scorp,
      has_dbp: typeof p.has_dbp === 'boolean' ? p.has_dbp : setup.has_dbp,
      has_401k_or_ira:
        typeof p.has_401k_or_ira === 'boolean' ? p.has_401k_or_ira : setup.has_401k_or_ira,
      has_annuity: typeof p.has_annuity === 'boolean' ? p.has_annuity : setup.has_annuity,
      has_pte: typeof p.has_pte === 'boolean' ? p.has_pte : setup.has_pte,
      multi_state_active:
        typeof p.multi_state_active === 'boolean'
          ? p.multi_state_active
          : setup.multi_state_active,
      residency_change_active:
        typeof p.residency_change_active === 'boolean'
          ? p.residency_change_active
          : setup.residency_change_active,
    };
    onUpdateSetup(next);
    setAppliedBanner(true);
  };

  const primaryYear1Age = setup.anchor_actuals_year - setup.primary_birth_year;
  const primaryYear6Age = setup.forecast_years[5] - setup.primary_birth_year;
  const spouseYear1Age =
    setup.spouse_birth_year ? setup.anchor_actuals_year - setup.spouse_birth_year : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Setup &amp; Module Decision Tree
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Module 1 configuration · Active selections dynamically govern sidebar workflows, deterministic calculation layers, and required IRS &amp; state forms.
        </p>
      </div>

      {/* Guided Natural-Language AI Intake (Module 4 §2) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Guided Natural-Language Setup Intake
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Describe your household, entity structure, retirement plans, or state moves in plain English. Proposed Module 1 flags require your confirmation before applying.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIntakeText(SAMPLE_PROMPTS[0])}
              className="text-xs font-medium text-teal-800 hover:underline whitespace-nowrap"
            >
              Load S-Corp / DBP Example
            </button>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setIntakeText(SAMPLE_PROMPTS[1])}
              className="text-xs font-medium text-teal-800 hover:underline whitespace-nowrap"
            >
              Load Single-State Example
            </button>
          </div>
        </div>

        <textarea
          rows={3}
          value={intakeText}
          onChange={(e) => setIntakeText(e.target.value)}
          placeholder="Example: Married filing jointly, born 1960 and 1962. LLC taxed as an S-Corp with a Defined Benefit Plan terminating in 2027, 401(k), and part-year move from CA to AZ..."
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
        />

        <div className="mt-3 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-500">
            AI parses setup toggles only · All tax math executes in the deterministic engine
          </span>
          <button
            type="button"
            onClick={handleRunIntake}
            disabled={loadingIntake || !intakeText.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {loadingIntake ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {loadingIntake ? 'Parsing Setup Flags...' : 'Parse Setup Flags'}
          </button>
        </div>

        {intakeError && (
          <div className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
            {intakeError}
          </div>
        )}

        {intakeResult && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            {intakeResult.summary && (
              <p className="text-xs text-slate-700">{intakeResult.summary}</p>
            )}

            {intakeResult.provenance && intakeResult.provenance.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3 font-medium">Field</th>
                      <th className="py-2 px-3 font-medium">Extracted Value</th>
                      <th className="py-2 px-3 font-medium">Source</th>
                      <th className="py-2 px-3 font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {intakeResult.provenance.map((p, idx) => (
                      <tr key={`${p.field_path}-${idx}`}>
                        <td className="py-2 px-3 font-mono text-slate-800">{p.field_path}</td>
                        <td className="py-2 px-3 font-mono font-medium text-slate-900">
                          {String(p.extracted_value)}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{p.source_document}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`font-medium ${
                              p.confidence_level === 'high'
                                ? 'text-emerald-700'
                                : p.confidence_level === 'medium'
                                ? 'text-amber-700'
                                : 'text-red-700'
                            }`}
                          >
                            {p.confidence_level}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              {appliedBanner ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <Check className="w-4 h-4" /> Confirmed flags applied to Module 1 setup.
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  Review provenance tags above before applying changes.
                </span>
              )}
              <button
                type="button"
                onClick={handleApplyProposed}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                Confirm &amp; Apply Setup Flags
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Core Filing & Household Profile */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              1. Core Filing &amp; Household Profile (Form 1040)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drives federal brackets, age 65+ standard deduction add-ons, Social Security timing, and Medicare IRMAA thresholds.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Filing Status
              </label>
              <select
                value={setup.filing_status}
                onChange={(e) =>
                  onUpdateSetup({
                    ...setup,
                    filing_status: e.target.value as FilingStatus,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                <option value="married_filing_jointly">Married Filing Jointly</option>
                <option value="single">Single</option>
                <option value="head_of_household">Head of Household</option>
                <option value="married_filing_separately">Married Filing Separately</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumericField
                label="Primary Birth Year"
                fieldCode="primary_birth_year"
                value={setup.primary_birth_year}
                step={1}
                min={1925}
                max={2008}
                onChange={(v) => onUpdateSetup({ ...setup, primary_birth_year: Math.round(v) })}
                helperText={`Age ${primaryYear1Age} in ${setup.anchor_actuals_year} → Age ${primaryYear6Age} in ${setup.forecast_years[5]}`}
              />
              {setup.filing_status === 'married_filing_jointly' && (
                <NumericField
                  label="Spouse Birth Year"
                  fieldCode="spouse_birth_year"
                  value={setup.spouse_birth_year ?? 1962}
                  step={1}
                  min={1925}
                  max={2008}
                  onChange={(v) => onUpdateSetup({ ...setup, spouse_birth_year: Math.round(v) })}
                  helperText={
                    spouseYear1Age !== null
                      ? `Age ${spouseYear1Age} in ${setup.anchor_actuals_year} (65+ add-on triggers at 65)`
                      : undefined
                  }
                />
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-semibold text-slate-800">
              2. Business &amp; Entity Ownership Branch
            </h3>
            <select
              value={setup.entity_type}
              onChange={(e) => handleEntityTypeChange(e.target.value as EntityType)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            >
              <option value="none">None (W-2 / Investment Household Only)</option>
              <option value="sole_prop">Sole Proprietorship / Single-Member LLC (Schedule C)</option>
              <option value="scorp_llc">LLC with S-Corporation Designation (Form 1120-S / K-1)</option>
              <option value="partnership">Partnership / Multi-Member LLC (Form 1065)</option>
              <option value="ccorp">C-Corporation (Form 1120)</option>
            </select>
          </div>
        </div>

        {/* 2. Conditional Sub-Modules & Multi-State Branch */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              3. Conditional Sub-Modules &amp; State Footprint
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enable only the branches applicable to your return. Inactive modules are excluded from calculations and filing requirements.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {[
              {
                key: 'has_scorp' as const,
                title: 'S-Corporation (Form 1120-S) Module',
                desc: 'Officer W-2 vs. distributions, employer payroll taxes, stock basis, and AAA tracking.',
              },
              {
                key: 'has_dbp' as const,
                title: 'Defined Benefit Plan (DBP)',
                desc: 'Actuarial contribution limits, termination/wind-down timeline, rollover, and participant loan rules.',
              },
              {
                key: 'has_401k_or_ira' as const,
                title: 'Qualified Plans (401(k) / Profit Sharing / IRA)',
                desc: 'Tracks employee/employer deferrals and direct rollover targets.',
              },
              {
                key: 'has_annuity' as const,
                title: 'Annuity Contracts',
                desc: 'Tracks annuity contract values and taxable payout streams.',
              },
              {
                key: 'has_pte' as const,
                title: 'State Pass-Through Entity (PTE) Elections',
                desc: 'Entity-level state tax deduction on 1120-S with offsetting personal state credit.',
              },
              {
                key: 'multi_state_active' as const,
                title: 'Multi-State Sourcing & Filings',
                desc: 'Revenue apportionment across multiple states (e.g., AZ / CA) and other-state tax credits.',
              },
              {
                key: 'residency_change_active' as const,
                title: 'Interstate Residency Change / Part-Year Move',
                desc: 'Part-year residency date validation and day/income allocation splits.',
              },
            ].map((item) => {
              const checked = Boolean(setup[item.key]);
              return (
                <label
                  key={item.key}
                  className="py-2.5 flex items-start justify-between gap-4 cursor-pointer"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{item.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{item.desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => handleToggle(item.key, e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5-Year Forward Projection Assumptions */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              4. Forward Forecast Assumptions (Years 2–6)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Controls bracket inflation indexing and baseline projection growth rates when regenerating Years {setup.forecast_years[1]}–{setup.forecast_years[5]}.
            </p>
          </div>
          <button
            type="button"
            onClick={onReprojectForecast}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-project Years 2–6 from Year 1
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <NumericField
            label="Bracket Inflation Rate"
            fieldCode="inflation_rate"
            value={Number((setup.assumptions.inflation_rate * 100).toFixed(2))}
            suffix="%"
            step={0.1}
            min={0}
            max={12}
            onChange={(v) =>
              onUpdateSetup({
                ...setup,
                assumptions: { ...setup.assumptions, inflation_rate: v / 100 },
              })
            }
          />
          <NumericField
            label="Entity Revenue Growth"
            fieldCode="revenue_growth_rate"
            value={Number((setup.assumptions.revenue_growth_rate * 100).toFixed(2))}
            suffix="%"
            step={0.5}
            min={-25}
            max={50}
            onChange={(v) =>
              onUpdateSetup({
                ...setup,
                assumptions: { ...setup.assumptions, revenue_growth_rate: v / 100 },
              })
            }
          />
          <NumericField
            label="Officer W-2 Wage Growth"
            fieldCode="wage_growth_rate"
            value={Number((setup.assumptions.wage_growth_rate * 100).toFixed(2))}
            suffix="%"
            step={0.5}
            min={-25}
            max={30}
            onChange={(v) =>
              onUpdateSetup({
                ...setup,
                assumptions: { ...setup.assumptions, wage_growth_rate: v / 100 },
              })
            }
          />
          <NumericField
            label="Investment Income Growth"
            fieldCode="investment_growth_rate"
            value={Number((setup.assumptions.investment_growth_rate * 100).toFixed(2))}
            suffix="%"
            step={0.5}
            min={-15}
            max={25}
            onChange={(v) =>
              onUpdateSetup({
                ...setup,
                assumptions: { ...setup.assumptions, investment_growth_rate: v / 100 },
              })
            }
          />
        </div>
      </div>
    </div>
  );
};
