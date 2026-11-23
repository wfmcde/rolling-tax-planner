import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CustomGoalMetricKey,
  PlanningGoalGuardrail,
  PlanningGuardrailComparator,
  PlanningGuardrailStatus,
  PlanningGuardrailUnit,
  PnlBalanceSheetState,
  SetupConfig,
} from '../types/tax';
import type { ComputedPnlBalanceSheet } from '../engine/pnlBalanceSheet';
import {
  CUSTOM_GOAL_METRIC_OPTIONS,
  createDefaultPlanningGoals,
  evaluateAllPlanningGoals,
  generateCustomGoalId,
} from '../engine/planningGoals';
import { formatCurrencyExact } from '../utils/format';
import { getSetupStates } from '../utils/setupHelpers';

interface PlanningGoalsPanelProps {
  setup: SetupConfig;
  goals: PlanningGoalGuardrail[];
  computed: ComputedPnlBalanceSheet;
  pnlState: PnlBalanceSheetState;
  onUpdateGoals: (updater: (prev: PlanningGoalGuardrail[]) => PlanningGoalGuardrail[]) => void;
}

function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s,]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function getStatusBadgeClasses(status: PlanningGuardrailStatus): string {
  if (status === 'over') {
    return 'bg-red-50 text-red-800 border-red-200';
  }
  if (status === 'watch') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-emerald-50 text-emerald-800 border-emerald-200';
}

export const PlanningGoalsPanel: React.FC<PlanningGoalsPanelProps> = ({
  setup,
  goals,
  computed,
  pnlState,
  onUpdateGoals,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Custom goal creation form state
  const [customTitle, setCustomTitle] = useState('');
  const [customMetric, setCustomMetric] = useState<CustomGoalMetricKey>('ordinary_business_income');
  const [customComparator, setCustomComparator] = useState<PlanningGuardrailComparator>('max');
  const [customUnit, setCustomUnit] = useState<PlanningGuardrailUnit>('currency');
  const [customTargetInput, setCustomTargetInput] = useState('');
  const [customCurrentInput, setCustomCurrentInput] = useState('');
  const [customWhy, setCustomWhy] = useState('');

  const evaluated = useMemo(
    () => evaluateAllPlanningGoals(goals, computed, pnlState, setup),
    [goals, computed, pnlState, setup]
  );

  const activeEvaluated = useMemo(
    () => evaluated.filter((item) => item.goal.enabled),
    [evaluated]
  );

  const statusCounts = useMemo(() => {
    let within = 0;
    let watch = 0;
    let over = 0;
    for (const item of activeEvaluated) {
      if (item.status === 'over') over++;
      else if (item.status === 'watch') watch++;
      else within++;
    }
    return { within, watch, over };
  }, [activeEvaluated]);

  const handleToggleGoal = (id: string) => {
    onUpdateGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g))
    );
  };

  const handleTargetChange = (
    id: string,
    raw: string,
    unit: PlanningGuardrailUnit,
    linkedThreshold?: number
  ) => {
    if (unit === 'text') {
      onUpdateGoals((prev) =>
        prev.map((g) => (g.id === id ? { ...g, target_label: raw } : g))
      );
      return;
    }
    const parsed = parseNumeric(raw);
    if (parsed === null && raw.trim() !== '') return;
    const nextVal = parsed ?? 0;
    onUpdateGoals((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        if (g.kind === 'income_ceiling' && typeof linkedThreshold === 'number') {
          const isOverridden = Math.abs(nextVal - linkedThreshold) > 0.005;
          return { ...g, target_value: nextVal, target_overridden: isOverridden };
        }
        return { ...g, target_value: nextVal };
      })
    );
  };

  const handleResetIncomeCeilingToIrmaa = (id: string, linkedThreshold: number) => {
    onUpdateGoals((prev) =>
      prev.map((g) =>
        g.id === id
          ? {
              ...g,
              target_value: linkedThreshold,
              target_overridden: false,
            }
          : g
      )
    );
  };

  const handleCustomCurrentChange = (id: string, raw: string, unit: PlanningGuardrailUnit) => {
    if (unit === 'text') {
      onUpdateGoals((prev) =>
        prev.map((g) => (g.id === id ? { ...g, custom_current_label: raw } : g))
      );
      return;
    }
    const parsed = parseNumeric(raw);
    onUpdateGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, custom_current_value: parsed } : g))
    );
  };

  const handleStartEditNote = (goal: PlanningGoalGuardrail) => {
    setEditingNoteId(goal.id);
    setNoteDraft(goal.why_it_matters);
  };

  const handleSaveNote = (id: string) => {
    const trimmed = noteDraft.trim();
    onUpdateGoals((prev) =>
      prev.map((g) =>
        g.id === id
          ? {
              ...g,
              why_it_matters: trimmed || g.why_it_matters,
              why_it_matters_custom: Boolean(trimmed),
            }
          : g
      )
    );
    setEditingNoteId(null);
  };

  const handleDeleteCustomGoal = (id: string) => {
    onUpdateGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleResetDefaults = () => {
    onUpdateGoals(() => createDefaultPlanningGoals(setup, pnlState.projection_year));
    setEditingNoteId(null);
  };

  const handleMetricChange = (nextMetric: CustomGoalMetricKey) => {
    setCustomMetric(nextMetric);
    const meta = CUSTOM_GOAL_METRIC_OPTIONS.find((o) => o.key === nextMetric);
    if (meta && nextMetric !== 'manual') {
      setCustomUnit(meta.defaultUnit);
    }
  };

  const handleAddCustomGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const title = customTitle.trim();
    if (!title) return;

    const parsedTarget = customUnit === 'text' ? null : parseNumeric(customTargetInput);
    const parsedCurrent =
      customMetric === 'manual' && customUnit !== 'text'
        ? parseNumeric(customCurrentInput)
        : null;

    const newGoal: PlanningGoalGuardrail = {
      id: generateCustomGoalId(),
      kind: 'custom',
      title,
      enabled: true,
      target_value: customUnit === 'text' ? null : parsedTarget ?? 0,
      target_label: customUnit === 'text' ? customTargetInput.trim() || 'CPA Review' : undefined,
      unit: customUnit,
      comparator: customUnit === 'text' ? 'info' : customComparator,
      metric_binding: customMetric,
      custom_current_value: parsedCurrent,
      custom_current_label:
        customUnit === 'text' ? customCurrentInput.trim() || undefined : undefined,
      why_it_matters:
        customWhy.trim() ||
        'Custom planning guardrail selected for year-end review with your CPA.',
      is_custom: true,
    };

    onUpdateGoals((prev) => [...prev, newGoal]);
    setCustomTitle('');
    setCustomTargetInput('');
    setCustomCurrentInput('');
    setCustomWhy('');
    setShowAddForm(false);
    setExpanded(true);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Compact Header Bar with Live Status Summary */}
      <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-start gap-2 text-left group"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-800 shrink-0" />
              <span>Planning Goals &amp; Guardrails</span>
              <span className="px-2 py-0.5 text-[11px] font-mono tabular-nums font-medium rounded bg-slate-100 text-slate-700 border border-slate-200">
                {activeEvaluated.length} of {goals.length} in CPA Package
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select guardrails, edit thresholds, and document plain-English objectives — checked items flow automatically into the CPA Print/PDF Package and CSV export.
            </p>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live status summary pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            {statusCounts.within > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono tabular-nums">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                {statusCounts.within} Within Guardrail
              </span>
            )}
            {statusCounts.watch > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono tabular-nums">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {statusCounts.watch} Watch
              </span>
            )}
            {statusCounts.over > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 font-mono tabular-nums">
                <ShieldAlert className="w-3 h-3 shrink-0" />
                {statusCounts.over} Over Target
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setShowAddForm((v) => !v);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100/80 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Custom Goal
          </button>

          {expanded && (
            <button
              type="button"
              onClick={handleResetDefaults}
              title="Restore default planning guardrails and thresholds"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              Defaults
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="divide-y divide-slate-100">
          {/* Add Custom Goal Form */}
          {showAddForm && (
            <form
              onSubmit={handleAddCustomGoal}
              className="p-4 bg-slate-50/80 border-b border-slate-200 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900">
                  Add Custom Planning Goal or Guardrail
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label="Close custom goal form"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Goal / Guardrail Name
                  </label>
                  <input
                    type="text"
                    required
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g., Year-End Cash Reserve Floor"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Track Live Metric
                  </label>
                  <select
                    value={customMetric}
                    onChange={(e) => handleMetricChange(e.target.value as CustomGoalMetricKey)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700"
                  >
                    {CUSTOM_GOAL_METRIC_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Rule Type
                  </label>
                  <select
                    value={customUnit === 'text' ? 'info' : customComparator}
                    disabled={customUnit === 'text'}
                    onChange={(e) =>
                      setCustomComparator(e.target.value as PlanningGuardrailComparator)
                    }
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700 disabled:bg-slate-100"
                  >
                    <option value="max">Ceiling (≤)</option>
                    <option value="min">Floor (≥)</option>
                    <option value="info">Review Target</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Unit
                  </label>
                  <select
                    value={customUnit}
                    disabled={customMetric !== 'manual'}
                    onChange={(e) => setCustomUnit(e.target.value as PlanningGuardrailUnit)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-700 disabled:bg-slate-100"
                  >
                    <option value="currency">Dollars ($)</option>
                    <option value="percent">Percent (%)</option>
                    <option value="text">Text / Note</option>
                  </select>
                </div>

                <div className={customMetric === 'manual' ? 'sm:col-span-3' : 'sm:col-span-4'}>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Target Threshold
                  </label>
                  <input
                    type={customUnit === 'text' ? 'text' : 'number'}
                    step={customUnit === 'percent' ? '0.5' : '100'}
                    value={customTargetInput}
                    onChange={(e) => setCustomTargetInput(e.target.value)}
                    placeholder={
                      customUnit === 'percent'
                        ? 'e.g., 45'
                        : customUnit === 'text'
                        ? 'e.g., Complete before 12/31'
                        : 'e.g., 35000'
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                  />
                </div>

                {customMetric === 'manual' && (
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Current Projected Value
                    </label>
                    <input
                      type={customUnit === 'text' ? 'text' : 'number'}
                      step={customUnit === 'percent' ? '0.5' : '100'}
                      value={customCurrentInput}
                      onChange={(e) => setCustomCurrentInput(e.target.value)}
                      placeholder={customUnit === 'text' ? 'e.g., In progress' : 'e.g., 28000'}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                    />
                  </div>
                )}

                <div className={customMetric === 'manual' ? 'sm:col-span-6' : 'sm:col-span-8'}>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Why This Matters (Plain-English Note for CPA)
                  </label>
                  <input
                    type="text"
                    value={customWhy}
                    onChange={(e) => setCustomWhy(e.target.value)}
                    placeholder="Explain what tax or cash-flow trigger you want your CPA to review..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!customTitle.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-teal-800 rounded hover:bg-teal-900 disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Save Custom Goal
                </button>
              </div>
            </form>
          )}

          {/* Guardrails Checklist Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[920px]">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="py-2 pl-5 pr-2 w-10">CPA</th>
                  <th className="py-2 px-3">Planning Goal / Guardrail &amp; Why This Matters</th>
                  <th className="py-2 px-3 text-right w-40">Target Threshold</th>
                  <th className="py-2 px-3 text-right w-44">Current Projected</th>
                  <th className="py-2 pl-3 pr-5 text-right w-40">Live Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {evaluated.map((item) => {
                  const { goal } = item;
                  const isEditingNote = editingNoteId === goal.id;
                  const isManualCustom =
                    goal.kind === 'custom' && (goal.metric_binding ?? 'manual') === 'manual';

                  return (
                    <tr
                      key={goal.id}
                      className={`transition-colors ${
                        goal.enabled ? 'hover:bg-slate-50/60' : 'bg-slate-50/40 opacity-65'
                      }`}
                    >
                      <td className="py-2.5 pl-5 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={goal.enabled}
                          onChange={() => handleToggleGoal(goal.id)}
                          aria-label={`Include ${goal.title} in active guardrails and CPA report`}
                          className="mt-0.5 rounded border-slate-300 accent-teal-800 cursor-pointer"
                        />
                      </td>

                      <td className="py-2.5 px-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{goal.title}</span>
                          {goal.is_custom && (
                            <span className="px-1.5 py-0.2 text-[10px] font-medium rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Custom
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleStartEditNote(goal)}
                            title="Edit 'Why this matters' note for CPA review"
                            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-teal-800"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                            Edit note
                          </button>
                          {goal.is_custom && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomGoal(goal.id)}
                              title="Delete custom goal"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-red-700"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              Remove
                            </button>
                          )}
                        </div>

                        {isEditingNote ? (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <input
                              type="text"
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveNote(goal.id);
                                } else if (e.key === 'Escape') {
                                  setEditingNoteId(null);
                                }
                              }}
                              autoFocus
                              className="flex-1 px-2 py-1 text-[11px] bg-white border border-teal-600 rounded text-slate-800 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveNote(goal.id)}
                              className="px-2 py-1 text-[11px] font-medium text-white bg-teal-800 rounded hover:bg-teal-900"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500 leading-snug mt-0.5 max-w-2xl">
                            <span className="font-medium text-slate-600">Why this matters:</span>{' '}
                            {goal.why_it_matters}
                          </p>
                        )}
                      </td>

                      {/* Editable Target Threshold */}
                      <td className="py-2.5 px-3 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          {goal.unit !== 'text' && goal.comparator !== 'info' && (
                            <span className="text-[11px] font-mono text-slate-400">
                              {goal.comparator === 'max' ? '≤' : '≥'}
                            </span>
                          )}
                          {goal.unit === 'currency' && (
                            <span className="text-[11px] font-mono text-slate-400">$</span>
                          )}
                          <input
                            type={goal.unit === 'text' ? 'text' : 'number'}
                            step={goal.unit === 'percent' ? '0.5' : '100'}
                            aria-label={`Target threshold for ${goal.title}`}
                            value={
                              goal.unit === 'text'
                                ? goal.target_label ?? ''
                                : goal.target_value ?? 0
                            }
                            onChange={(e) =>
                              handleTargetChange(
                                goal.id,
                                e.target.value,
                                goal.unit,
                                item.linkedIrmaa?.threshold
                              )
                            }
                            className="w-28 px-2 py-1 text-right text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-teal-700"
                          />
                          {goal.unit === 'percent' && (
                            <span className="text-[11px] font-mono text-slate-500">%</span>
                          )}
                        </div>
                        {goal.kind === 'income_ceiling' && item.linkedIrmaa && (
                          <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                            {item.linkedIrmaa.isGoalTargetOverridden ? (
                              <>
                                <span>Custom · </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleResetIncomeCeilingToIrmaa(
                                      goal.id,
                                      item.linkedIrmaa!.threshold
                                    )
                                  }
                                  className="text-teal-700 hover:text-teal-900 underline"
                                >
                                  Reset to {item.linkedIrmaa.coverageYear} IRMAA (
                                  {formatCurrencyExact(item.linkedIrmaa.threshold)})
                                </button>
                              </>
                            ) : (
                              <span>
                                {item.linkedIrmaa.coverageYear} IRMAA Tier 1 ·{' '}
                                {item.linkedIrmaa.filingStatusShort} (2-yr lookback
                                {item.linkedIrmaa.isCoverageYearOverridden ? ' · Setup override' : ''}
                                )
                              </span>
                            )}
                          </div>
                        )}
                        {goal.kind === 'multistate_apportionment' && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Max {getSetupStates(setup).primaryStateCode || 'Primary State'} share
                          </div>
                        )}
                      </td>

                      {/* Current Projected Value */}
                      <td className="py-2.5 px-3 align-top text-right">
                        {isManualCustom ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            {goal.unit === 'currency' && (
                              <span className="text-[11px] font-mono text-slate-400">$</span>
                            )}
                            <input
                              type={goal.unit === 'text' ? 'text' : 'number'}
                              step={goal.unit === 'percent' ? '0.5' : '100'}
                              aria-label={`Current value for ${goal.title}`}
                              value={
                                goal.unit === 'text'
                                  ? goal.custom_current_label ?? ''
                                  : goal.custom_current_value ?? ''
                              }
                              placeholder="Enter..."
                              onChange={(e) =>
                                handleCustomCurrentChange(goal.id, e.target.value, goal.unit)
                              }
                              className="w-28 px-2 py-1 text-right text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-teal-700"
                            />
                            {goal.unit === 'percent' && (
                              <span className="text-[11px] font-mono text-slate-500">%</span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {item.currentDisplay}
                            </div>
                            <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                              {item.varianceSummary}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Live Status Pill */}
                      <td className="py-2.5 pl-3 pr-5 align-top text-right whitespace-nowrap">
                        {goal.enabled ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${getStatusBadgeClasses(
                              item.status
                            )}`}
                          >
                            {item.status === 'over' ? (
                              <ShieldAlert className="w-3 h-3 shrink-0" />
                            ) : item.status === 'watch' ? (
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                            )}
                            {item.statusLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-400 border border-slate-200">
                            Excluded
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
      )}
    </section>
  );
};
