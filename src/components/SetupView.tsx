import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FlaskConical,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  DeductionMethod,
  EntityType,
  FilingStatus,
  PersonProfile,
  ProvenanceField,
  SetupConfig,
  StateApportionmentSplit,
  WorkspaceProfileMode,
} from '../types/tax';
import { parseBirthDate } from '../utils/personTax';
import {
  ALL_US_STATE_OPTIONS,
  NO_INCOME_TAX_STATE_CODES,
  addApportionmentState,
  autoBalanceSplitOnEdit,
  getActiveBusinessStates,
  getStateFullName,
  normalizeStateSplit,
  removeApportionmentState,
  resolveStateApportionmentForYear,
  sumStateSplit,
  updateDefaultStateApportionmentSplit,
  updateYearStateApportionmentSplit,
} from '../utils/setupHelpers';
import { formatCurrency } from '../utils/format';
import {
  DEFAULT_IRMAA_GROWTH_RATE,
  getIrmaaGrowthRate,
  resolveIrmaaThresholdForYear,
  setIrmaaThresholdOverride,
} from '../engine/irmaa';
import { NumericField } from './NumericField';
import { PersonProfileCard } from './PersonProfileCard';

interface SetupViewProps {
  setup: SetupConfig;
  workspaceMode: WorkspaceProfileMode;
  onSwitchWorkspaceMode: (mode: WorkspaceProfileMode) => void;
  onResetSandboxMode: (mode: 'test_persona' | 'blank_user') => void;
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
  'Married filing jointly, both in our early 60s. We run an LLC taxed as an S-Corp with an active Defined Benefit Plan winding down in 3 years, plus a 401(k). We operate across two states and want to evaluate State PTE elections.',
  'Single filer in my late 40s, sole proprietor transitioning to an LLC taxed as an S-Corp with a 401(k) and no Defined Benefit Plan, single state only.',
];

export const SetupView: React.FC<SetupViewProps> = ({
  setup,
  workspaceMode,
  onSwitchWorkspaceMode,
  onResetSandboxMode,
  onUpdateSetup,
  onReprojectForecast,
}) => {
  const [intakeText, setIntakeText] = useState('');
  const [loadingIntake, setLoadingIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeResult, setIntakeResult] = useState<AiIntakeResponse | null>(null);
  const [appliedBanner, setAppliedBanner] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [stateToAdd, setStateToAdd] = useState('');
  const [autoBalanceSplit, setAutoBalanceSplit] = useState(true);
  const [defaultDraftSplit, setDefaultDraftSplit] = useState<StateApportionmentSplit | null>(null);
  const [yearDraftSplits, setYearDraftSplits] = useState<Record<number, StateApportionmentSplit>>(
    {}
  );

  const activeApportionmentStatesKey = getActiveBusinessStates(setup).join(',');

  useEffect(() => {
    setDefaultDraftSplit(null);
    setYearDraftSplits({});
    setStateToAdd('');
  }, [workspaceMode, activeApportionmentStatesKey]);

  useEffect(() => {
    if (!showHelp) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showHelp]);

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

  const handlePrimaryProfileChange = (nextProfile: PersonProfile) => {
    const parsed = parseBirthDate(nextProfile.birth_date);
    onUpdateSetup({
      ...setup,
      primary_profile: nextProfile,
      primary_birth_year: parsed ? parsed.year : setup.primary_birth_year,
    });
  };

  const handleSpouseProfileChange = (nextProfile: PersonProfile) => {
    const parsed = parseBirthDate(nextProfile.birth_date);
    onUpdateSetup({
      ...setup,
      spouse_profile: nextProfile,
      spouse_birth_year: parsed ? parsed.year : null,
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
    const nextPrimaryBirthYear =
      typeof p.primary_birth_year === 'number' && p.primary_birth_year > 1920
        ? p.primary_birth_year
        : setup.primary_birth_year;
    const nextSpouseBirthYear =
      typeof p.spouse_birth_year === 'number' && p.spouse_birth_year > 1920
        ? p.spouse_birth_year
        : setup.spouse_birth_year;

    const next: SetupConfig = {
      ...setup,
      filing_status: (p.filing_status as FilingStatus) || setup.filing_status,
      primary_birth_year: nextPrimaryBirthYear,
      spouse_birth_year: nextSpouseBirthYear,
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

  const isJoint = setup.filing_status === 'married_filing_jointly';

  return (
    <div className="space-y-6">
      {/* Header + Contextual Help Button (?) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Setup &amp; Module Decision Tree
            </h1>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              aria-label="About Setup and Module Decision Tree"
              title="What this screen shows and why it matters"
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-teal-800 hover:bg-teal-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Module 1 configuration · Active selections dynamically govern sidebar workflows, deterministic calculation layers, and required IRS &amp; state forms.
          </p>
        </div>
      </div>

      {/* Non-Destructive 3-Way Profile Switcher: My Profile | Test Persona | Blank User */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">
                Active Workspace Profile
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Switch instantly to test multi-user behavior or blank onboarding.{' '}
              <span className="font-medium text-slate-700">My Profile</span> is persisted under its own isolated storage key and is never overwritten by test modes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              role="group"
              aria-label="Workspace profile mode"
              className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg"
            >
              {(
                [
                  {
                    id: 'my_profile' as const,
                    label: 'My Profile',
                    icon: UserCheck,
                  },
                  {
                    id: 'test_persona' as const,
                    label: 'Test Persona',
                    icon: FlaskConical,
                  },
                  {
                    id: 'blank_user' as const,
                    label: 'Blank User',
                    icon: UserPlus,
                  },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const active = workspaceMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSwitchWorkspaceMode(option.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-teal-800 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {option.label}
                  </button>
                );
              })}
            </div>

            {workspaceMode !== 'my_profile' && (
              <button
                type="button"
                onClick={() => onResetSandboxMode(workspaceMode)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                Reset {workspaceMode === 'test_persona' ? 'Test Persona' : 'Blank User'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          {workspaceMode === 'my_profile' && (
            <span>
              Viewing <strong className="font-semibold text-slate-800">My Profile</strong> — edits save directly to your household workspace.
            </span>
          )}
          {workspaceMode === 'test_persona' && (
            <span>
              Viewing synthetic persona:{' '}
              <strong className="font-semibold text-slate-800">
                {[setup.primary_name, setup.spouse_name]
                  .map((s) => s?.trim())
                  .filter(Boolean)
                  .join(' & ') || 'Test Persona'}
              </strong>{' '}
              ({[
                setup.home_state,
                setup.business_name?.trim(),
                setup.business_website?.trim(),
              ]
                .filter(Boolean)
                .join(' · ') || 'Synthetic test workspace'}).
            </span>
          )}
          {workspaceMode === 'blank_user' && (
            <span>
              Viewing <strong className="font-semibold text-slate-800">Blank User</strong> — empty names, zeroed inputs, and clean onboarding defaults.
            </span>
          )}
        </div>
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
          placeholder="Example: Married filing jointly, LLC taxed as an S-Corp with a 401(k), optional Defined Benefit Plan, and single- or multi-state apportionment..."
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

      {/* 1. Core Filing & Household Profile (Form 1040) — Per-Person Cards */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                1. Core Filing &amp; Household Profile (Form 1040)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Monthly Social Security and Medicare baselines apply as exact figures for{' '}
                <span className="font-mono font-medium text-slate-700">{setup.current_tax_year}</span>{' '}
                (0% COLA/inflation markup); {setup.anchor_actuals_year} stays locked as Prior-Year Actuals.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-auto shrink-0">
              <div className="w-full sm:w-52">
                <label
                  htmlFor="current_tax_year_select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Current / Setup Tax Year
                </label>
                <select
                  id="current_tax_year_select"
                  value={setup.current_tax_year}
                  onChange={(e) =>
                    onUpdateSetup({
                      ...setup,
                      current_tax_year: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {setup.forecast_years.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr === setup.anchor_actuals_year
                        ? `${yr} (Prior-Yr Actuals)`
                        : yr === setup.current_tax_year
                        ? `${yr} (Active Setup Year)`
                        : `${yr}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full sm:w-56">
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
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="married_filing_jointly">Married Filing Jointly</option>
                  <option value="single">Single</option>
                  <option value="head_of_household">Head of Household</option>
                  <option value="married_filing_separately">Married Filing Separately</option>
                </select>
              </div>
            </div>
          </div>

          {/* Standard vs. Custom Itemized Deduction Selector */}
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className={setup.deduction_method === 'itemized' ? 'md:col-span-7' : 'md:col-span-12'}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Deduction Method (Applied to Forecast Years {setup.forecast_years[1]}–{setup.forecast_years[5]})
              </label>
              <select
                value={setup.deduction_method}
                onChange={(e) =>
                  onUpdateSetup({
                    ...setup,
                    deduction_method: e.target.value as DeductionMethod,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                <option value="standard">Standard Deduction (IRS Indexed + Age 65+)</option>
                <option value="itemized">Custom Itemized Deduction</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Governed here rather than as a separate row in the Six-Year Financial Schedule.
              </p>
            </div>

            {setup.deduction_method === 'itemized' && (
              <div className="md:col-span-5">
                <NumericField
                  label="Annual Custom Itemized Deduction"
                  fieldCode="custom_itemized_deduction"
                  prefix="$"
                  step={1000}
                  min={0}
                  value={setup.custom_itemized_deduction}
                  onChange={(v) =>
                    onUpdateSetup({
                      ...setup,
                      custom_itemized_deduction: Math.max(0, v),
                    })
                  }
                  helperText="Applied annually across forecast years 2–6"
                />
              </div>
            )}
          </div>
        </div>

        {/* Side-by-Side Per-Person Cards */}
        <div className={`grid grid-cols-1 ${isJoint ? 'lg:grid-cols-2' : ''} gap-4 items-start`}>
          <PersonProfileCard
            roleLabel="Primary Taxpayer"
            name={setup.primary_name}
            profile={setup.primary_profile}
            forecastYears={setup.forecast_years}
            currentTaxYear={setup.current_tax_year}
            showSsMedicare={setup.has_ss_medicare !== false}
            onNameChange={(nextName) =>
              onUpdateSetup({
                ...setup,
                primary_name: nextName,
              })
            }
            onChange={handlePrimaryProfileChange}
          />
          {isJoint && (
            <PersonProfileCard
              roleLabel="Spouse"
              name={setup.spouse_name}
              profile={setup.spouse_profile}
              forecastYears={setup.forecast_years}
              currentTaxYear={setup.current_tax_year}
              showSsMedicare={setup.has_ss_medicare !== false}
              onNameChange={(nextName) =>
                onUpdateSetup({
                  ...setup,
                  spouse_name: nextName,
                })
              }
              onChange={handleSpouseProfileChange}
            />
          )}
        </div>
      </div>

      {/* Entity Ownership & Conditional Sub-Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* 2. Business & Entity Ownership Branch */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              2. Business &amp; Entity Ownership Branch
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select the operating entity structure to activate Form 1120-S / Schedule K-1, reasonable compensation, and stock basis tracking.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Entity Type</label>
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

          {/* Dynamic Business Identity (feeds CPA headers, footers & Form 1120-S) */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div>
              <label
                htmlFor="setup_business_name"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Business / Entity Name
              </label>
              <input
                id="setup_business_name"
                type="text"
                value={setup.business_name ?? ''}
                placeholder="e.g., Your Business, LLC"
                onChange={(e) =>
                  onUpdateSetup({
                    ...setup,
                    business_name: e.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="setup_business_website"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Website / Domain (Optional)
                </label>
                <input
                  id="setup_business_website"
                  type="text"
                  value={setup.business_website ?? ''}
                  placeholder="e.g., yourfirm.com"
                  onChange={(e) =>
                    onUpdateSetup({
                      ...setup,
                      business_website: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
                />
              </div>
              <div>
                <label
                  htmlFor="setup_business_ein"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Entity EIN (Optional)
                </label>
                <input
                  id="setup_business_ein"
                  type="text"
                  value={setup.business_ein ?? ''}
                  placeholder="XX-XXXXXXX"
                  onChange={(e) =>
                    onUpdateSetup({
                      ...setup,
                      business_ein: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
                />
              </div>
            </div>

            {/* Dynamic State Domicile & Apportionment States */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label
                  htmlFor="setup_home_state"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Primary / Home State
                </label>
                <select
                  id="setup_home_state"
                  value={setup.home_state ?? ''}
                  onChange={(e) =>
                    onUpdateSetup({
                      ...setup,
                      home_state: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="">Not set</option>
                  {ALL_US_STATE_OPTIONS.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.code} — {st.name}
                    </option>
                  ))}
                </select>
              </div>
              {(setup.multi_state_active || setup.residency_change_active || setup.secondary_state) && (
                <div>
                  <label
                    htmlFor="setup_secondary_state"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Secondary / Apportionment State
                  </label>
                  <select
                    id="setup_secondary_state"
                    value={setup.secondary_state ?? ''}
                    onChange={(e) =>
                      onUpdateSetup({
                        ...setup,
                        secondary_state: e.target.value,
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">None (Single State)</option>
                    {ALL_US_STATE_OPTIONS.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.code} — {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {setup.has_scorp && (() => {
              const activeStates = getActiveBusinessStates(setup);
              const defaultSplit = resolveStateApportionmentForYear(
                {
                  ...setup,
                  state_revenue_apportionment: {
                    states: activeStates,
                    default_split: setup.state_revenue_apportionment?.default_split ?? {},
                    year_overrides: {},
                  },
                },
                setup.current_tax_year
              );
              if (activeStates.length === 0) {
                return (
                  <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded-md px-2.5 py-1.5">
                    Business Revenue Sourcing: <span className="font-medium text-slate-800">No states selected</span> · Add states in the apportionment panel below
                  </div>
                );
              }
              return (
                <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate">
                    Default Forecast Apportionment:{' '}
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {activeStates
                        .map((code) => `${code} ${defaultSplit.split[code] ?? 0}%`)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-[11px] text-teal-800 font-medium whitespace-nowrap shrink-0">
                    Editable below
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* 3. Modular Feature Checklist (Form 1040 Core + Optional Modules) */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              3. Modular Feature Setup (Form 1040 Core + Optional Modules)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Start with lightweight Form 1040 Core and toggle optional modules below. Unchecking a box hides its tabs, inputs, and report sections while keeping all saved data intact.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            <div className="py-2.5 flex items-start justify-between gap-4 bg-slate-50/70 px-2.5 -mx-2.5 rounded-md">
              <div>
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                  Form 1040 Core (Base Module)
                  <span className="text-[10px] font-mono text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                    Always Active
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Personal W-2, interest/dividends, capital gains, deductions, federal tax brackets, and Six-Year Horizon.
                </div>
              </div>
              <input
                type="checkbox"
                checked
                readOnly
                disabled
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 opacity-70 shrink-0"
              />
            </div>
            {[
              {
                key: 'has_scorp' as const,
                title: 'S-Corp / Business Cadence & P&L (Form 1120-S / Ledger Forecaster)',
                desc: 'Activates P&L & Balance Sheet, Transaction Cadence Forecaster, Form 1120-S, K-1 pass-through, and officer W-2 vs. distributions.',
              },
              {
                key: 'has_ss_medicare' as const,
                title: 'Social Security & Medicare Planning',
                desc: 'Individual Social Security claiming, FRA-to-70 voluntary suspension (+8%/yr DRC), Medicare Parts A/B/D/Medigap, and IRMAA lookback.',
              },
              {
                key: 'has_dbp' as const,
                title: 'Defined Benefit / Retirement Plan & Payables',
                desc: 'Actuarial contribution limits, termination/wind-down timeline, rollover, participant loans, and retirement payables.',
              },
              {
                key: 'multi_state_active' as const,
                title: 'Multi-State Apportionment',
                desc: 'Revenue apportionment across any number of US states with per-year overrides and other-state tax credit handling.',
              },
              {
                key: 'has_stock_basis' as const,
                title: 'Shareholder Stock Basis (Form 7203)',
                desc: 'Beginning-to-ending Form 7203 stock basis schedule, draws vs. basis alerts, and Form 8949 excess gain tracking.',
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
                key: 'residency_change_active' as const,
                title: 'Interstate Residency Change / Part-Year Move',
                desc: 'Part-year residency date validation and day/income allocation splits.',
              },
            ].map((item) => {
              const checked =
                item.key === 'has_ss_medicare'
                  ? setup.has_ss_medicare !== false
                  : item.key === 'has_stock_basis'
                  ? setup.has_stock_basis ?? setup.has_scorp
                  : Boolean(setup[item.key]);
              return (
                <div key={item.key} className="py-2.5">
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
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

                  {/* DBP Planned Termination Year & Post-DBP 401(k) Profit-Sharing Controls */}
                  {item.key === 'has_dbp' && checked && (
                    <div className="mt-3 ml-1 pl-3 border-l border-slate-200 bg-slate-50/70 rounded-r-md p-3 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Planned Termination Year
                          </label>
                          <select
                            value={
                              setup.dbp_planned_termination_year === null
                                ? 'none'
                                : String(setup.dbp_planned_termination_year)
                            }
                            onChange={(e) => {
                              const val =
                                e.target.value === 'none' ? null : Number(e.target.value);
                              onUpdateSetup({
                                ...setup,
                                dbp_planned_termination_year: val,
                              });
                            }}
                            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:border-teal-700 focus:outline-none"
                          >
                            <option value="none">None (Keep Active)</option>
                            {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>

                        <NumericField
                          label="Post-DBP 401(k) Profit-Sharing Rate"
                          fieldCode="post_dbp_profit_sharing_rate"
                          value={Number((setup.post_dbp_profit_sharing_rate * 100).toFixed(1))}
                          suffix="%"
                          step={1}
                          min={0}
                          max={25}
                          onChange={(v) =>
                            onUpdateSetup({
                              ...setup,
                              post_dbp_profit_sharing_rate: Math.min(25, Math.max(0, v)) / 100,
                            })
                          }
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Employer 401(k) Profit Sharing stays capped at the <span className="font-mono text-slate-700">6%</span> combined-plan limit while DBP is active through{' '}
                        <span className="font-mono text-slate-700">
                          {setup.dbp_planned_termination_year ?? 'active DBP years'}
                        </span>
                        {setup.dbp_planned_termination_year !== null && (
                          <>
                            . Once DBP terminates, the statutory cap rises to{' '}
                            <span className="font-mono text-slate-700">25%</span> of cash W-2 starting in{' '}
                            <span className="font-mono text-slate-700">
                              {setup.dbp_planned_termination_year + 1}
                            </span>{' '}
                            (currently elected at{' '}
                            <span className="font-mono text-slate-700">
                              {Number((setup.post_dbp_profit_sharing_rate * 100).toFixed(1))}%
                            </span>
                            , subject to IRS §415(c) limits) while DBP contributions default to $0.
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Forward Forecast Assumptions (Years 2–6) */}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {setup.has_ss_medicare !== false && (
            <>
              <NumericField
                label="Social Security Annual COLA (%)"
                fieldCode="ss_cola_rate"
                value={Number(((setup.assumptions.ss_cola_rate ?? 0.026) * 100).toFixed(2))}
                suffix="%"
                step={0.1}
                min={0}
                max={12}
                onChange={(v) =>
                  onUpdateSetup({
                    ...setup,
                    assumptions: { ...setup.assumptions, ss_cola_rate: Math.max(0, v) / 100 },
                  })
                }
                helperText={`Applied automatically starting in Current Tax Year + 1 (${setup.current_tax_year + 1}+); inline cell overrides in the schedule take precedence.`}
              />
              <NumericField
                label="Medicare Premium Annual Inflation (%)"
                fieldCode="medicare_inflation_rate"
                value={Number(((setup.assumptions.medicare_inflation_rate ?? 0.055) * 100).toFixed(2))}
                suffix="%"
                step={0.1}
                min={0}
                max={20}
                onChange={(v) =>
                  onUpdateSetup({
                    ...setup,
                    assumptions: {
                      ...setup.assumptions,
                      medicare_inflation_rate: Math.max(0, v) / 100,
                    },
                  })
                }
                helperText={`Applied automatically starting in Current Tax Year + 1 (${setup.current_tax_year + 1}+) unless overridden inline in the schedule.`}
              />
              <NumericField
                label="IRMAA Threshold Annual Step-Up (%)"
                fieldCode="irmaa_threshold_growth_rate"
                value={Number((getIrmaaGrowthRate(setup) * 100).toFixed(2))}
                suffix="%"
                step={0.1}
                min={0}
                max={15}
                onChange={(v) =>
                  onUpdateSetup({
                    ...setup,
                    assumptions: {
                      ...setup.assumptions,
                      irmaa_threshold_growth_rate: Math.max(0, v) / 100,
                    },
                  })
                }
                helperText={
                  setup.filing_status === 'married_filing_jointly'
                    ? '2025: $212k MFJ · 2026: $218k MFJ · 2027+: compounds from 2026 baseline, rounded to nearest $1,000.'
                    : '2025: $106k Single · 2026: $109k Single · 2027+: compounds from 2026 baseline, rounded to nearest $1,000.'
                }
              />
            </>
          )}
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
                assumptions: { ...setup.assumptions, inflation_rate: Math.max(0, v) / 100 },
              })
            }
            helperText="Indexes IRS tax brackets, standard deduction, and retirement caps."
          />
          {setup.has_scorp && (
            <>
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Forecast Operating Expenses Scaling ({setup.current_tax_year + 1}+)
                </label>
                <select
                  value={setup.assumptions.opex_scaling_mode ?? 'revenue_proportional'}
                  onChange={(e) =>
                    onUpdateSetup({
                      ...setup,
                      assumptions: {
                        ...setup.assumptions,
                        opex_scaling_mode:
                          e.target.value === 'fixed_inflation'
                            ? 'fixed_inflation'
                            : 'revenue_proportional',
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="revenue_proportional">
                    Revenue-Proportional (% of Gross Receipts)
                  </option>
                  <option value="fixed_inflation">Fixed / Inflation-Indexed</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Applies to unlocked future forecast years ({setup.current_tax_year + 1}+); prior actuals stay locked and per-year overrides take precedence.
                </p>
              </div>
              <NumericField
                label="Forecast Operating Expense Ratio"
                fieldCode="expense_ratio"
                value={Number(((setup.assumptions.expense_ratio ?? 0.2) * 100).toFixed(1))}
                suffix="%"
                step={0.5}
                min={0}
                max={100}
                disabled={
                  (setup.assumptions.opex_scaling_mode ?? 'revenue_proportional') !==
                  'revenue_proportional'
                }
                onChange={(v) =>
                  onUpdateSetup({
                    ...setup,
                    assumptions: {
                      ...setup.assumptions,
                      expense_ratio: Math.min(100, Math.max(0, v)) / 100,
                    },
                  })
                }
                helperText={`Scales unlocked ${setup.current_tax_year + 1}+ S-Corp Operating Expenses proportionally to projected revenue.`}
              />
            </>
          )}
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

      {/* State Revenue Apportionment Schedule (Dynamic N-State Selector + Per-Year Forecast Overrides) */}
      {(setup.has_scorp || setup.multi_state_active) && (() => {
        const forecastOnlyYears = (
          setup.forecast_years.length > 0
            ? setup.forecast_years
            : [2025, 2026, 2027, 2028, 2029, 2030]
        ).filter((y) => y !== setup.anchor_actuals_year);
        const activeStates = getActiveBusinessStates(setup);
        const availableToAdd = ALL_US_STATE_OPTIONS.filter(
          (st) => !activeStates.includes(st.code)
        );
        const homeStateCode = (setup.home_state ?? '').trim().toUpperCase();

        const defaultResolved = resolveStateApportionmentForYear(
          {
            ...setup,
            state_revenue_apportionment: {
              states: activeStates,
              default_split: setup.state_revenue_apportionment?.default_split ?? {},
              year_overrides: {},
            },
          },
          setup.current_tax_year
        );

        const overrideCount = forecastOnlyYears.filter(
          (y) => resolveStateApportionmentForYear(setup, y).isYearOverride
        ).length;
        const firstForecastYr = forecastOnlyYears[0] ?? setup.current_tax_year;
        const lastForecastYr =
          forecastOnlyYears[forecastOnlyYears.length - 1] ?? firstForecastYr + 4;

        const displayedDefaultSplit: StateApportionmentSplit =
          defaultDraftSplit ?? defaultResolved.split;
        const defaultTotalPct = sumStateSplit(displayedDefaultSplit, activeStates);
        const defaultBalanced =
          activeStates.length === 0 || Math.abs(defaultTotalPct - 100) <= 0.05;
        const defaultDelta = Math.round((defaultTotalPct - 100) * 10) / 10;

        const handleAddSelectedState = (codeOverride?: string) => {
          const target = (codeOverride ?? stateToAdd).trim().toUpperCase();
          if (!target || activeStates.includes(target)) return;
          setDefaultDraftSplit(null);
          setYearDraftSplits({});
          setStateToAdd('');
          onUpdateSetup(addApportionmentState(setup, target));
        };

        const handleRemoveState = (code: string) => {
          if (activeStates.length <= 1) return;
          setDefaultDraftSplit(null);
          setYearDraftSplits({});
          onUpdateSetup(removeApportionmentState(setup, code));
        };

        const handleEditDefaultStatePct = (code: string, parsed: number) => {
          const clamped = Math.round(Math.min(100, Math.max(0, parsed)) * 10) / 10;
          if (autoBalanceSplit) {
            const balanced = autoBalanceSplitOnEdit(
              defaultResolved.split,
              activeStates,
              code,
              clamped
            );
            setDefaultDraftSplit(null);
            onUpdateSetup(updateDefaultStateApportionmentSplit(setup, balanced));
            return;
          }
          const nextDraft: StateApportionmentSplit = {
            ...displayedDefaultSplit,
            [code]: clamped,
          };
          const nextSum = sumStateSplit(nextDraft, activeStates);
          if (Math.abs(nextSum - 100) <= 0.05) {
            setDefaultDraftSplit(null);
            onUpdateSetup(updateDefaultStateApportionmentSplit(setup, nextDraft));
          } else {
            setDefaultDraftSplit(nextDraft);
          }
        };

        const handleBalanceDefaultDraft = () => {
          if (!defaultDraftSplit) return;
          const normalized = normalizeStateSplit(defaultDraftSplit, activeStates, 50);
          setDefaultDraftSplit(null);
          onUpdateSetup(updateDefaultStateApportionmentSplit(setup, normalized));
        };

        const handleEditYearStatePct = (yr: number, code: string, parsed: number) => {
          const clamped = Math.round(Math.min(100, Math.max(0, parsed)) * 10) / 10;
          const resolved = resolveStateApportionmentForYear(setup, yr);
          const currentRowSplit = yearDraftSplits[yr] ?? resolved.split;

          if (autoBalanceSplit) {
            const balanced = autoBalanceSplitOnEdit(
              resolved.split,
              activeStates,
              code,
              clamped
            );
            setYearDraftSplits((prev) => {
              if (!prev[yr]) return prev;
              const copy = { ...prev };
              delete copy[yr];
              return copy;
            });
            onUpdateSetup(updateYearStateApportionmentSplit(setup, yr, balanced));
            return;
          }

          const nextDraft: StateApportionmentSplit = {
            ...currentRowSplit,
            [code]: clamped,
          };
          const nextSum = sumStateSplit(nextDraft, activeStates);
          if (Math.abs(nextSum - 100) <= 0.05) {
            setYearDraftSplits((prev) => {
              const copy = { ...prev };
              delete copy[yr];
              return copy;
            });
            onUpdateSetup(updateYearStateApportionmentSplit(setup, yr, nextDraft));
          } else {
            setYearDraftSplits((prev) => ({
              ...prev,
              [yr]: nextDraft,
            }));
          }
        };

        const handleBalanceYearDraft = (yr: number) => {
          const draft = yearDraftSplits[yr];
          if (!draft) return;
          const normalized = normalizeStateSplit(draft, activeStates, 50);
          setYearDraftSplits((prev) => {
            const copy = { ...prev };
            delete copy[yr];
            return copy;
          });
          onUpdateSetup(updateYearStateApportionmentSplit(setup, yr, normalized));
        };

        const handleClearYearDraft = (yr: number) => {
          setYearDraftSplits((prev) => {
            const copy = { ...prev };
            delete copy[yr];
            return copy;
          });
        };

        return (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            {/* Header & Dynamic State Selector Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  State Revenue Apportionment
                </h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                  <span>
                    Forecast Years {firstForecastYr}–{lastForecastYr}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-700">
                    {activeStates.length > 0 ? activeStates.join(' / ') : 'No states selected'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{setup.anchor_actuals_year} filed actuals locked</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Add or remove any US state (including 0% states such as zero-income-tax domicile states). Active splits sum to{' '}
                  <span className="font-mono font-medium text-slate-700">100%</span> and sync live with Six-Year Horizon, Multi-State Sourcing, and Transaction Cadence Forecaster.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="inline-flex items-center gap-1.5">
                  <select
                    aria-label="Select US state to add to revenue apportionment"
                    value={stateToAdd}
                    onChange={(e) => setStateToAdd(e.target.value)}
                    disabled={availableToAdd.length === 0}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700/20 max-w-[220px]"
                  >
                    <option value="">Select US state to add...</option>
                    {availableToAdd.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.code} — {st.name}
                        {NO_INCOME_TAX_STATE_CODES.has(st.code) ? ' (0% tax)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!stateToAdd}
                    onClick={() => handleAddSelectedState()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add State
                  </button>
                </div>

                {overrideCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setYearDraftSplits({});
                      onUpdateSetup({
                        ...setup,
                        state_revenue_apportionment: {
                          states: activeStates,
                          default_split: defaultResolved.split,
                          year_overrides: {},
                        },
                      });
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Overrides ({overrideCount})
                  </button>
                )}
              </div>
            </div>

            {activeStates.length === 0 ? (
              <div className="p-4 rounded-md bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  No states are configured for revenue apportionment yet. Choose any US state from the selector above to start at 100%, then add additional states (including 0% states) as needed.
                </p>
              </div>
            ) : (
              <>
                {/* Default Forecast Split Bar */}
                <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Default Forecast Split ({firstForecastYr}–{lastForecastYr})
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {activeStates.length === 1
                          ? 'Single active state receives 100% of business revenue. Add another US state above to model multi-state splits.'
                          : autoBalanceSplit
                          ? 'Auto-balance is on: editing any state adjusts active revenue-generating states to 100% while preserving 0% states.'
                          : 'Manual validation mode: edit any combination of states freely; changes apply automatically once the row sums to 100%.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {activeStates.length >= 2 && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={autoBalanceSplit}
                            onChange={(e) => {
                              const nextAuto = e.target.checked;
                              setAutoBalanceSplit(nextAuto);
                              if (nextAuto) {
                                setDefaultDraftSplit(null);
                                setYearDraftSplits({});
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                          />
                          <span>Auto-balance to 100%</span>
                        </label>
                      )}

                      {defaultBalanced ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums text-emerald-700 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Total: {defaultTotalPct}%
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums text-amber-800 whitespace-nowrap">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Total: {defaultTotalPct}% ({defaultDelta > 0 ? `+${defaultDelta}%` : `${defaultDelta}%`})
                          </span>
                          <button
                            type="button"
                            onClick={handleBalanceDefaultDraft}
                            className="px-2.5 py-1 text-[11px] font-medium text-white bg-teal-800 rounded hover:bg-teal-900 whitespace-nowrap"
                          >
                            Balance to 100%
                          </button>
                          <button
                            type="button"
                            onClick={() => setDefaultDraftSplit(null)}
                            className="text-[11px] font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                          >
                            Revert
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Active State Inputs */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    {activeStates.map((code) => {
                      const pctVal = displayedDefaultSplit[code] ?? 0;
                      const isZeroTax = NO_INCOME_TAX_STATE_CODES.has(code);
                      const isHome = code === homeStateCode;
                      return (
                        <div
                          key={code}
                          className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-md px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <label
                              htmlFor={`default_state_pct_${code}`}
                              className="text-xs font-semibold text-slate-900"
                            >
                              <span className="font-mono">{code}</span>{' '}
                              <span className="font-normal text-slate-600">
                                {getStateFullName(code)}
                              </span>
                            </label>
                            {(isHome || isZeroTax) && (
                              <span className="text-[11px] text-slate-400">
                                · {[isHome ? 'Home' : null, isZeroTax ? '0% tax' : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </div>

                          <div className="inline-flex items-center">
                            <input
                              id={`default_state_pct_${code}`}
                              type="number"
                              step={1}
                              min={0}
                              max={100}
                              disabled={activeStates.length === 1}
                              value={pctVal}
                              onChange={(e) => {
                                const parsed = Number(e.target.value);
                                if (Number.isFinite(parsed)) {
                                  handleEditDefaultStatePct(code, parsed);
                                }
                              }}
                              className="w-16 text-right font-mono text-xs tabular-nums px-1.5 py-1 rounded-l border border-slate-300 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-700"
                            />
                            <span className="px-1.5 py-1 text-[11px] font-mono text-slate-500 bg-slate-100 border border-l-0 border-slate-300 rounded-r">
                              %
                            </span>
                          </div>

                          {activeStates.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveState(code)}
                              aria-label={`Remove ${code} (${getStateFullName(code)})`}
                              title={`Remove ${code} and rebalance remaining states to 100%`}
                              className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Per-Year Forecast Override Table (shown whenever 2+ states are selected) */}
                {activeStates.length >= 2 && (
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                          <th className="py-2 px-3 whitespace-nowrap">Forecast Year</th>
                          {activeStates.map((code) => (
                            <th key={code} className="py-2 px-3 text-right whitespace-nowrap">
                              <span className="font-mono text-slate-800">{code}</span>{' '}
                              <span className="font-normal text-slate-500">
                                ({getStateFullName(code)})
                              </span>{' '}
                              %
                            </th>
                          ))}
                          <th className="py-2 px-3 text-right whitespace-nowrap">Total</th>
                          <th className="py-2 px-3 text-right whitespace-nowrap">
                            Status / Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {forecastOnlyYears.map((yr) => {
                          const resolved = resolveStateApportionmentForYear(setup, yr);
                          const rowDraft = yearDraftSplits[yr];
                          const rowSplit = rowDraft ?? resolved.split;
                          const rowTotal = sumStateSplit(rowSplit, activeStates);
                          const rowBalanced = Math.abs(rowTotal - 100) <= 0.05;
                          const rowDelta = Math.round((rowTotal - 100) * 10) / 10;

                          return (
                            <tr
                              key={yr}
                              className={
                                !rowBalanced
                                  ? 'bg-amber-50/70'
                                  : resolved.isYearOverride
                                  ? 'bg-amber-50/35'
                                  : 'hover:bg-slate-50/60'
                              }
                            >
                              <td className="py-2 px-3 font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                                {yr}
                              </td>
                              {activeStates.map((code) => {
                                const val = rowSplit[code] ?? 0;
                                return (
                                  <td key={code} className="py-2 px-3 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center justify-end">
                                      <input
                                        type="number"
                                        step={1}
                                        min={0}
                                        max={100}
                                        aria-label={`${code} revenue split percentage for ${yr}`}
                                        value={val}
                                        onChange={(e) => {
                                          const parsed = Number(e.target.value);
                                          if (Number.isFinite(parsed)) {
                                            handleEditYearStatePct(yr, code, parsed);
                                          }
                                        }}
                                        className={`w-16 text-right font-mono text-xs tabular-nums px-1.5 py-1 rounded-l border focus:outline-none focus:ring-1 focus:ring-teal-700 ${
                                          !rowBalanced
                                            ? 'border-amber-500 bg-white text-slate-900 font-semibold'
                                            : resolved.isYearOverride
                                            ? 'border-amber-400 bg-white text-slate-900 font-semibold'
                                            : 'border-slate-300 bg-white text-slate-800'
                                        }`}
                                      />
                                      <span className="px-1.5 py-1 text-[11px] font-mono text-slate-500 bg-slate-100 border border-l-0 border-slate-300 rounded-r">
                                        %
                                      </span>
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="py-2 px-3 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                                {rowBalanced ? (
                                  <span className="inline-flex items-center justify-end gap-1 text-emerald-700">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    {rowTotal}%
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center justify-end gap-1 text-amber-800 font-semibold">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    {rowTotal}% ({rowDelta > 0 ? `+${rowDelta}%` : `${rowDelta}%`})
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap">
                                {!rowBalanced ? (
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleBalanceYearDraft(yr)}
                                      className="px-2 py-0.5 text-[11px] font-medium text-white bg-teal-800 rounded hover:bg-teal-900 whitespace-nowrap"
                                    >
                                      Balance to 100%
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleClearYearDraft(yr)}
                                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                                    >
                                      Revert
                                    </button>
                                  </div>
                                ) : resolved.isYearOverride ? (
                                  <div className="inline-flex items-center justify-end gap-2 text-[11px]">
                                    <span className="font-medium text-amber-800">
                                      Year Override
                                    </span>
                                    <span className="text-slate-300" aria-hidden="true">
                                      ·
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateSetup(
                                          updateYearStateApportionmentSplit(setup, yr, null)
                                        )
                                      }
                                      className="inline-flex items-center gap-1 font-medium text-teal-800 hover:text-teal-950 hover:underline whitespace-nowrap"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      Reset to default
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-500">Default Split</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* IRMAA Starting Threshold Schedule (Per-Year Overrides + Coverage / 2-Yr Lookback MAGI) */}
      {setup.has_ss_medicare !== false && (() => {
        const horizonYears = setup.forecast_years.length > 0 ? setup.forecast_years : [2025, 2026, 2027, 2028, 2029, 2030];
        const lastHorizonYear = horizonYears[horizonYears.length - 1] ?? 2030;
        const scheduleYears = [...horizonYears, lastHorizonYear + 1, lastHorizonYear + 2];
        const growthRate = getIrmaaGrowthRate(setup);
        const growthPct = Number((growthRate * 100).toFixed(2));
        const overrideCount = scheduleYears.filter(
          (y) => resolveIrmaaThresholdForYear(y, setup).isOverridden
        ).length;
        const isMfj = setup.filing_status === 'married_filing_jointly';

        return (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  IRMAA Starting Threshold Schedule ({isMfj ? 'Married Filing Jointly' : 'Single / Non-MFJ'})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  2025 baseline is hardcoded at {isMfj ? '$212,000' : '$106,000'}, 2026 is set to{' '}
                  {isMfj ? '$218,000' : '$109,000'}, and 2027+ steps up at{' '}
                  <span className="font-mono font-medium text-slate-700">{growthPct}%/yr</span>{' '}
                  (rounded to the nearest $1,000). Override any individual year (e.g., 2027 to $224,000) without affecting other years.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {growthRate !== DEFAULT_IRMAA_GROWTH_RATE && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSetup({
                        ...setup,
                        assumptions: {
                          ...setup.assumptions,
                          irmaa_threshold_growth_rate: DEFAULT_IRMAA_GROWTH_RATE,
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-md hover:bg-slate-100"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset Rate to 3.0%
                  </button>
                )}
                {overrideCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSetup({
                        ...setup,
                        irmaa_threshold_overrides: {},
                      })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset All Overrides ({overrideCount})
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Coverage Year</th>
                    <th className="py-2 px-3">2-Yr Lookback MAGI Tested</th>
                    <th className="py-2 px-3 text-right">Formula Threshold</th>
                    <th className="py-2 px-3 text-right">Active Threshold (Editable)</th>
                    <th className="py-2 px-3 text-right">Status / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {scheduleYears.map((covYear) => {
                    const resolved = resolveIrmaaThresholdForYear(covYear, setup);
                    const isForwardOnly = covYear > lastHorizonYear;
                    return (
                      <tr
                        key={covYear}
                        className={
                          resolved.isOverridden
                            ? 'bg-amber-50/40'
                            : isForwardOnly
                            ? 'bg-slate-50/40'
                            : 'hover:bg-slate-50/60'
                        }
                      >
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                          {covYear}
                          {isForwardOnly && (
                            <span className="ml-1.5 text-[10px] font-sans font-normal text-slate-500">
                              (Forward Watch)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-700">
                          <span className="font-mono font-medium text-slate-900">
                            {resolved.lookbackMagiYear} MAGI
                          </span>
                          <span className="text-[11px] text-slate-500 ml-1.5">
                            → determines {covYear} Medicare IRMAA
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                          <div>{formatCurrency(resolved.formulaThreshold)}</div>
                          <div className="text-[10px] font-sans text-slate-400">
                            {covYear === 2025
                              ? '2025 Baseline'
                              : covYear === 2026
                              ? '2026 Baseline'
                              : `+${growthPct}%/yr rounded $1k`}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <span className="text-slate-400 font-mono text-xs">$</span>
                            <input
                              type="number"
                              step={1000}
                              min={0}
                              aria-label={`IRMAA starting threshold for coverage year ${covYear}`}
                              value={resolved.effectiveThreshold}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                if (raw === '') {
                                  onUpdateSetup(setIrmaaThresholdOverride(setup, covYear, null));
                                  return;
                                }
                                const parsed = Number(raw);
                                if (Number.isFinite(parsed) && parsed >= 0) {
                                  const rounded = Math.round(parsed);
                                  if (rounded === resolved.formulaThreshold && !resolved.isOverridden) {
                                    return;
                                  }
                                  onUpdateSetup(
                                    setIrmaaThresholdOverride(
                                      setup,
                                      covYear,
                                      rounded === resolved.formulaThreshold ? null : rounded
                                    )
                                  );
                                }
                              }}
                              className={`w-28 text-right font-mono text-xs tabular-nums px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-teal-700 ${
                                resolved.isOverridden
                                  ? 'border-amber-400 bg-white text-slate-900 font-semibold'
                                  : 'border-slate-300 bg-white text-slate-800'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          {resolved.isOverridden ? (
                            <div className="inline-flex items-center justify-end gap-2">
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                                Manual Override
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateSetup(setIrmaaThresholdOverride(setup, covYear, null))
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-800 hover:text-teal-950 hover:underline whitespace-nowrap"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Reset to formula
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              {resolved.sourceLabel}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Contextual Help Modal (?) */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-help-title"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
              <div>
                <h2 id="setup-help-title" className="text-base font-semibold text-slate-900">
                  Setup &amp; Module Decision Tree
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Plain-English Guide
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Close help popup"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">What This Screen Shows</h3>
                <p>
                  This screen sets the structural rules for your six-year tax plan: filing status, individual dates of birth for Primary Taxpayer and Spouse, per-person Social Security claiming and suspension choices, individual Medicare enrollments, business entity branches (such as an S-Corporation or Defined Benefit Plan), multi-state residency toggles, and forward growth assumptions.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Why It Matters</h3>
                <p>
                  Couples rarely retire, claim Social Security, or enroll in Medicare on the exact same date. Configuring each spouse independently supports staggered timelines—such as one spouse enrolling in Medicare while the other stays on employer/S-Corp coverage, or suspending one spouse&apos;s Social Security benefit between Full Retirement Age (FRA) and age 70 to earn +8%/year Delayed Retirement Credits.
                </p>
                <p className="mt-2">
                  The deterministic tax engine automatically sums active individual Social Security benefits for joint Form 1040 taxability (0%–85%), applies age-65+ standard deductions only where birth dates qualify, and computes income-based Medicare IRMAA surcharges strictly per enrolled individual using two-year lookback Modified Adjusted Gross Income (MAGI).
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="px-4 py-1.5 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
