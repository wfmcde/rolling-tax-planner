import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Lock,
  PauseCircle,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  ComputedTaxYear,
  DbpActuarialConfig,
  DbpStatus,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { formatCurrency } from '../utils/format';
import {
  applyFreezePostYr10Preset,
  applyMaxOut404Preset,
  applyTargetYr10ExitPreset,
  computeDbpActuarialWaterfall,
  type ActuarialRowStatusCode,
} from '../engine/dbpActuarial';
import { NumericField } from './NumericField';

interface DbpViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  onUpdateSetup: (nextSetup: SetupConfig) => void;
  onApplyPresetState: (nextSetup: SetupConfig, nextYears: TaxYearRecord[]) => void;
}

const parseCleanNumber = (raw: string): number | null => {
  const cleaned = raw.replace(/[$,%\s,]/g, '').trim();
  if (cleaned === '') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const renderStatusIndicator = (code: ActuarialRowStatusCode, label: string) => {
  switch (code) {
    case 'over_ceiling':
    case 'over_404':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-red-700">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'near_ceiling':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'yr10_exit':
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-teal-800">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'nominal':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'locked_actual':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
          <Lock className="w-3 h-3 text-teal-700 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'frozen':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-sky-800">
          <PauseCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    case 'terminated':
    case 'inactive':
    default:
      return <span className="font-medium text-slate-500">{label}</span>;
  }
};

export const DbpView: React.FC<DbpViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
  onUpdateSetup,
  onApplyPresetState,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const isLocked = yr.is_locked_actuals;
  const dbp = yr.dbp_and_retirement;

  const [editingCell, setEditingCell] = useState<{
    key: string;
    draft: string;
  } | null>(null);
  const [presetBanner, setPresetBanner] = useState<string | null>(null);
  const [customGrowthOpen, setCustomGrowthOpen] = useState<boolean>(false);

  const waterfall = useMemo(
    () => computeDbpActuarialWaterfall(setup, years, computed),
    [setup, years, computed]
  );

  const config = waterfall.config;
  const anchorYear = years[0]?.tax_year ?? setup.anchor_actuals_year;
  const selectedRow =
    waterfall.rows.find((r) => r.taxYear === yr.tax_year) ?? waterfall.rows[0];

  const growthMode: 'zero' | 'five' | 'custom' = useMemo(() => {
    if (customGrowthOpen) return 'custom';
    if (Math.abs(config.trust_growth_rate) < 0.0001) return 'zero';
    if (Math.abs(config.trust_growth_rate - 0.05) < 0.0001) return 'five';
    return 'custom';
  }, [config.trust_growth_rate, customGrowthOpen]);

  const updateActuarialConfig = (patch: Partial<DbpActuarialConfig>) => {
    onUpdateSetup({
      ...setup,
      dbp_actuarial: {
        ...config,
        ...patch,
      },
    });
  };

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

  /**
   * Bi-directional W-2 Salary sync with Six-Year Horizon:
   * - S-Corp MFJ: preserves existing spouse W-2 split ratio (50/50 if currently $0),
   *   updating bill_w2_wages, debra_w2_wages, officer_w2_wages, and form_1040.w2_wages_total.
   * - Single/HOH: assigns 100% to primary W-2.
   * - Non-S-Corp: updates form_1040.w2_wages_total directly.
   */
  const commitSyncedW2Salary = (taxYear: number, nextTotalW2: number) => {
    const cleanW2 = Math.max(0, Math.round(nextTotalW2));
    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      if (!setup.has_scorp) {
        return {
          ...prev,
          form_1040: {
            ...prev.form_1040,
            w2_wages_total: cleanW2,
          },
        };
      }
      const isJoint = setup.filing_status === 'married_filing_jointly';
      const prevPrimary = prev.scorp_1120s.bill_w2_wages ?? 0;
      const prevSpouse = prev.scorp_1120s.debra_w2_wages ?? 0;
      const prevTotal = prevPrimary + prevSpouse;
      const primaryRatio = !isJoint ? 1 : prevTotal > 0 ? prevPrimary / prevTotal : 0.5;
      const nextPrimary = Math.round(cleanW2 * primaryRatio);
      const nextSpouse = isJoint ? Math.max(0, cleanW2 - nextPrimary) : 0;

      return {
        ...prev,
        scorp_1120s: {
          ...prev.scorp_1120s,
          bill_w2_wages: nextPrimary,
          debra_w2_wages: nextSpouse,
          officer_w2_wages: cleanW2,
        },
        form_1040: {
          ...prev.form_1040,
          w2_wages_total: cleanW2,
        },
      };
    });
  };

  /**
   * Bi-directional Planned DBP sync with Six-Year Horizon:
   * Updates dbp_actual_contribution, auto-activates from terminated if > 0,
   * and syncs dbp_max_deductible_contribution with the live Dynamic 404 Max Limit.
   */
  const commitSyncedPlannedDbp = (
    taxYear: number,
    nextPlannedDbp: number,
    dynamic404Max: number
  ) => {
    const cleanDbp = Math.max(0, Math.round(nextPlannedDbp));
    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      const nextStatus: DbpStatus =
        cleanDbp > 0 && prev.dbp_and_retirement.dbp_status === 'terminated'
          ? 'active'
          : prev.dbp_and_retirement.dbp_status;
      return {
        ...prev,
        dbp_and_retirement: {
          ...prev.dbp_and_retirement,
          dbp_actual_contribution: cleanDbp,
          dbp_status: nextStatus,
          dbp_max_deductible_contribution:
            dynamic404Max > 0
              ? dynamic404Max
              : Math.max(prev.dbp_and_retirement.dbp_max_deductible_contribution, cleanDbp),
        },
      };
    });
  };

  const handleRunPreset = (preset: 'yr10_exit' | 'max_404' | 'freeze_post_10') => {
    const result =
      preset === 'yr10_exit'
        ? applyTargetYr10ExitPreset(setup, years)
        : preset === 'max_404'
        ? applyMaxOut404Preset(setup, years)
        : applyFreezePostYr10Preset(setup, years);
    onApplyPresetState(result.nextSetup, result.nextYears);
    setPresetBanner(result.summaryText);
  };

  const handleEnableDbp = () => {
    const nextSetup: SetupConfig = {
      ...setup,
      has_dbp: true,
    };
    const nextYears = years.map((y) =>
      y.is_locked_actuals
        ? y
        : {
            ...y,
            dbp_and_retirement: {
              ...y.dbp_and_retirement,
              dbp_status:
                y.dbp_and_retirement.dbp_status === 'terminated'
                  ? ('active' as DbpStatus)
                  : y.dbp_and_retirement.dbp_status,
            },
          }
    );
    onApplyPresetState(nextSetup, nextYears);
    setPresetBanner(
      'Enabled Defined Benefit Plan modeling for this household. Enter Schedule SB baselines or select a preset to project 404/415(b) limits.'
    );
  };

  const renderInlineMatrixCell = (
    cellKey: string,
    value: number,
    locked: boolean,
    disabled: boolean,
    onCommit: (num: number) => void,
    toneClass = 'text-slate-900'
  ) => {
    const isEditing = editingCell?.key === cellKey;

    if (locked || disabled) {
      return (
        <span className={`font-mono tabular-nums text-xs ${toneClass}`}>
          {formatCurrency(value)}
        </span>
      );
    }

    if (isEditing) {
      return (
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={editingCell.draft}
          onChange={(e) => setEditingCell({ key: cellKey, draft: e.target.value })}
          onBlur={() => {
            const parsed = parseCleanNumber(editingCell.draft);
            if (parsed !== null) onCommit(parsed);
            setEditingCell(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const parsed = parseCleanNumber(editingCell.draft);
              if (parsed !== null) onCommit(parsed);
              setEditingCell(null);
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[104px] ml-auto block rounded border border-teal-700 bg-white px-1.5 py-0.5 text-right font-mono tabular-nums text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-700"
        />
      );
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditingCell({ key: cellKey, draft: String(Math.round(value)) });
        }}
        title="Click to edit inline (syncs bi-directionally with Six-Year Horizon)"
        className={`w-full max-w-[104px] ml-auto block rounded border border-slate-200/90 bg-slate-50/70 hover:bg-white hover:border-teal-600 px-1.5 py-0.5 text-right font-mono tabular-nums text-xs transition-colors ${toneClass}`}
      >
        {formatCurrency(value)}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header + Year Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Defined Benefit Plan (DBP) &amp; Retirement
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Interactive IRC §415(b) / §417(e) / §404(o) actuarial waterfall &amp; rolling High-3 engine ({years[0]?.tax_year}–{years[years.length - 1]?.tax_year}), bi-directionally synced with the Six-Year Horizon.
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

      {/* Inactive DBP Banner for Households Without DBP Enabled */}
      {!setup.has_dbp && (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-slate-900">
              Defined Benefit Plan is currently inactive for this profile
            </div>
            <p className="text-xs text-slate-600">
              Enable DBP modeling to run the §415(b) High-3 actuarial waterfall, test IRC §404 deduction ceilings, and sync planned contributions with the Six-Year Horizon.
            </p>
          </div>
          <button
            type="button"
            onClick={handleEnableDbp}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap shrink-0"
          >
            Enable DBP Modeling
          </button>
        </div>
      )}

      {/* Preset Confirmation Banner */}
      {presetBanner && (
        <div
          role="status"
          aria-live="polite"
          className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-emerald-950"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span className="leading-snug">{presetBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setPresetBanner(null)}
            aria-label="Dismiss notification"
            className="text-emerald-800 hover:text-emerald-950 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* Interactive Actuarial Waterfall & High-3 Engine                   */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Top Title + KPI Strip */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Interactive Actuarial Waterfall &amp; High-3 Engine ({years[0]?.tax_year}–{years[years.length - 1]?.tax_year})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any unlocked W-2 Salary or Planned DBP cell to edit live; changes sync bi-directionally with the Six-Year Horizon and tax engine.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
            <div>
              <span className="text-slate-500">6-Yr Planned DBP:</span>{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {formatCurrency(waterfall.totalSixYearPlannedDbp)}
              </strong>
            </div>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <div>
              <span className="text-slate-500">Est. Exit Rollover:</span>{' '}
              <strong className="font-mono tabular-nums text-teal-900">
                {formatCurrency(waterfall.projectedExitRollover)}
              </strong>
            </div>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <div>
              <span className="text-slate-500">Peak §415(b) Ceiling:</span>{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {formatCurrency(waterfall.peakStatutoryCeiling)}
              </strong>
            </div>
          </div>
        </div>

        {/* Editable Schedule SB Baselines */}
        <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumericField
              label="Historical High-3 W-2 (Schedule SB)"
              fieldCode="historical_high_3_w2"
              prefix="$"
              step={1000}
              min={0}
              value={config.historical_high_3_w2}
              onChange={(v) => updateActuarialConfig({ historical_high_3_w2: Math.max(0, Math.round(v)) })}
              helperText="Prior 3-yr high average before window"
            />
            <NumericField
              label={`${anchorYear} BOY Trust Assets (Sch SB)`}
              fieldCode="boy_assets_anchor"
              prefix="$"
              step={5000}
              min={0}
              value={config.boy_assets_anchor}
              onChange={(v) => updateActuarialConfig({ boy_assets_anchor: Math.max(0, Math.round(v)) })}
              helperText={`Beginning trust market value (${anchorYear})`}
            />
            <NumericField
              label={`${anchorYear} Plan Year`}
              fieldCode="plan_year_anchor"
              step={1}
              min={1}
              max={40}
              value={config.plan_year_anchor}
              onChange={(v) =>
                updateActuarialConfig({
                  plan_year_anchor: Math.min(40, Math.max(1, Math.round(v))),
                })
              }
              helperText={
                waterfall.yr10TaxYear
                  ? `100% phase-in (Yr 10) reached in ${waterfall.yr10TaxYear}`
                  : '10-yr §415(b)(5) phase-in schedule'
              }
            />
            <NumericField
              label="§417(e) Valuation Rate"
              fieldCode="valuation_interest_rate"
              suffix="%"
              step={0.25}
              min={1}
              max={12}
              value={Number((config.valuation_interest_rate * 100).toFixed(2))}
              onChange={(v) =>
                updateActuarialConfig({
                  valuation_interest_rate: Math.min(0.12, Math.max(0.01, v / 100)),
                })
              }
              helperText={
                selectedRow
                  ? `Age ${selectedRow.participantAge ?? 62} factor: ×${selectedRow.factor417e.toFixed(2)}`
                  : 'IRS unisex lump-sum discount rate'
              }
            />
          </div>
        </div>

        {/* Trust Growth Toggle + Actuarial Strategy Presets */}
        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {/* Trust Growth % Segmented Control */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
              Trust Growth %
            </span>
            <div
              role="group"
              aria-label="Trust growth rate assumption"
              className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md border border-slate-200/80"
            >
              <button
                type="button"
                onClick={() => {
                  setCustomGrowthOpen(false);
                  updateActuarialConfig({ trust_growth_rate: 0 });
                }}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  growthMode === 'zero'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                0%
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomGrowthOpen(false);
                  updateActuarialConfig({ trust_growth_rate: 0.05 });
                }}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  growthMode === 'five'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                5%
              </button>
              <button
                type="button"
                onClick={() => setCustomGrowthOpen(true)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  growthMode === 'custom'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Custom
              </button>
            </div>

            {growthMode === 'custom' && (
              <div className="inline-flex items-center gap-1">
                <input
                  type="number"
                  step={0.5}
                  min={-20}
                  max={25}
                  aria-label="Custom trust growth percentage"
                  value={Number((config.trust_growth_rate * 100).toFixed(2))}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (Number.isFinite(num)) {
                      updateActuarialConfig({
                        trust_growth_rate: Math.min(0.25, Math.max(-0.2, num / 100)),
                      });
                    }
                  }}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right font-mono tabular-nums text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                />
                <span className="text-xs font-mono text-slate-500">%</span>
              </div>
            )}
          </div>

          {/* Strategy Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              Presets:
            </span>
            <button
              type="button"
              onClick={() => handleRunPreset('yr10_exit')}
              className="px-3 py-1.5 text-xs font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100/70 transition-colors whitespace-nowrap shrink-0"
              title="Pace unlocked DBP funding cleanly through Plan Yr 10 (100% phase-in) and schedule IRA rollover exit"
            >
              Target Yr 10 Exit
            </button>
            <button
              type="button"
              onClick={() => handleRunPreset('max_404')}
              className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Maximize every unlocked active year to 100% of its Dynamic 404 Max Limit"
            >
              Max Out 404
            </button>
            <button
              type="button"
              onClick={() => handleRunPreset('freeze_post_10')}
              className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Keep plan active through Plan Yr 10, then freeze accruals ($0 contributions) for Plan Yr 11+"
            >
              Freeze Post-Yr 10
            </button>
          </div>
        </div>

        {/* Actuarial Formula Chain Strip (Live for Selected Year) */}
        {selectedRow && (
          <div className="px-5 py-3 bg-slate-900 text-slate-100 border-b border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="text-[11px] font-semibold text-teal-300">
                Actuarial Formula Chain · {selectedRow.taxYear} (Plan Yr {selectedRow.planYear}
                {selectedRow.participantAge !== null ? ` · Age ${selectedRow.participantAge}` : ''})
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                Trust Growth: {(config.trust_growth_rate * 100).toFixed(1)}% · §417(e) Rate:{' '}
                {(config.valuation_interest_rate * 100).toFixed(2)}%
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">W-2</span>
                <span className="text-white font-semibold">
                  {formatCurrency(selectedRow.w2Salary)}
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">High-3</span>
                <span className="text-white font-semibold">
                  {formatCurrency(selectedRow.rollingHigh3)}
                </span>
              </div>
              <span className="text-slate-500">×</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">Phase-In</span>
                <span className="text-slate-200">
                  {Math.round(selectedRow.phaseInPct * 100)}%
                </span>
              </div>
              <span className="text-slate-500">=</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">415(b)</span>
                <span className="text-white font-semibold">
                  {formatCurrency(selectedRow.annuity415b)}
                </span>
              </div>
              <span className="text-slate-500">×</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">417(e)</span>
                <span className="text-slate-200">{selectedRow.factor417e.toFixed(2)}</span>
              </div>
              <span className="text-slate-500">=</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">Ceiling</span>
                <span className="text-white font-semibold">
                  {formatCurrency(selectedRow.statutoryCeiling)}
                </span>
              </div>
              <span className="text-slate-500">−</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-slate-400">BOY×(1+g)</span>
                <span className="text-slate-200">
                  {formatCurrency(selectedRow.preContribAssets)}
                </span>
              </div>
              <span className="text-slate-500">=</span>
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[11px] text-teal-300">Dynamic 404 Max</span>
                <span className="text-teal-300 font-semibold">
                  {formatCurrency(selectedRow.dynamic404Max)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 10-Column Interactive Actuarial Matrix (2025-2030) */}
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse text-xs">
            <colgroup>
              <col className="w-[9.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[9.5%]" />
              <col className="w-[9.5%]" />
              <col className="w-[9.5%]" />
              <col className="w-[9.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[9.5%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3">Year / Plan Yr</th>
                <th className="py-2.5 px-2 text-right">W-2 Salary</th>
                <th className="py-2.5 px-2 text-right">Rolling High-3</th>
                <th className="py-2.5 px-2 text-right">415(b) Annuity</th>
                <th className="py-2.5 px-2 text-right">BOY Assets</th>
                <th className="py-2.5 px-2 text-right">Dynamic 404 Max</th>
                <th className="py-2.5 px-2 text-right">Planned DBP</th>
                <th className="py-2.5 px-2 text-right">EOY Assets</th>
                <th className="py-2.5 px-2 text-right">Statutory Ceiling</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {waterfall.rows.map((row) => {
                const isSelected = row.taxYear === yr.tax_year;
                const isOver404 =
                  !row.isLockedActuals &&
                  setup.has_dbp &&
                  row.dbpStatus !== 'terminated' &&
                  row.plannedDbp > row.dynamic404Max + 1;
                const isOverCeiling =
                  !row.isLockedActuals &&
                  setup.has_dbp &&
                  row.dbpStatus !== 'terminated' &&
                  row.statutoryCeiling > 0 &&
                  row.eoyAssets > row.statutoryCeiling + 1;

                return (
                  <tr
                    key={row.taxYear}
                    onClick={() => onSelectYear(row.taxYear)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-teal-50/45' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    {/* 1. Year / Plan Yr */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="flex items-center gap-1 font-mono font-semibold text-slate-900 tabular-nums">
                        {row.isLockedActuals && (
                          <Lock className="w-3 h-3 text-teal-700 shrink-0" aria-hidden="true" />
                        )}
                        <span>{row.taxYear}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                        Plan Yr {row.planYear}
                        {row.participantAge !== null ? ` · Age ${row.participantAge}` : ''}
                      </div>
                    </td>

                    {/* 2. W-2 Salary (bi-directionally synced with Horizon) */}
                    <td className="py-2.5 px-2 align-top text-right">
                      {renderInlineMatrixCell(
                        `w2:${row.taxYear}`,
                        row.w2Salary,
                        row.isLockedActuals,
                        false,
                        (val) => commitSyncedW2Salary(row.taxYear, val),
                        'text-slate-900 font-medium'
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono tabular-nums">
                        {row.isLockedActuals ? 'Locked' : 'Horizon sync'}
                      </div>
                    </td>

                    {/* 3. Rolling High-3 Avg */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div
                        className={`font-medium ${
                          row.high3Ratcheted ? 'text-teal-800 font-semibold' : 'text-slate-800'
                        }`}
                      >
                        {formatCurrency(row.rollingHigh3)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-0.5">
                        {row.high3Ratcheted ? (
                          <span className="inline-flex items-center gap-0.5 text-teal-700 font-sans font-medium">
                            <TrendingUp className="w-2.5 h-2.5" aria-hidden="true" />
                            Ratchet
                          </span>
                        ) : (
                          <span>3-yr {formatCurrency(row.trailing3Avg)}</span>
                        )}
                      </div>
                    </td>

                    {/* 4. 415(b) Annuity */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div className="text-slate-900 font-medium">
                        {formatCurrency(row.annuity415b)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {Math.round(row.phaseInPct * 100)}% phase-in
                      </div>
                    </td>

                    {/* 5. BOY Assets */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div className="text-slate-800">{formatCurrency(row.boyAssets)}</div>
                      {row.trustGrowthDollars !== 0 && (
                        <div
                          className={`text-[10px] mt-0.5 ${
                            row.trustGrowthDollars > 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {row.trustGrowthDollars > 0 ? '+' : ''}
                          {formatCurrency(row.trustGrowthDollars)}
                        </div>
                      )}
                    </td>

                    {/* 6. Dynamic 404 Max Limit */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div
                        className={`font-semibold ${
                          row.dynamic404Max > 0 ? 'text-teal-900' : 'text-slate-400'
                        }`}
                      >
                        {formatCurrency(row.dynamic404Max)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">IRC §404</div>
                    </td>

                    {/* 7. Planned DBP (bi-directionally synced with Horizon) */}
                    <td className="py-2.5 px-2 align-top text-right">
                      {renderInlineMatrixCell(
                        `dbp:${row.taxYear}`,
                        row.plannedDbp,
                        row.isLockedActuals,
                        !setup.has_dbp,
                        (val) => commitSyncedPlannedDbp(row.taxYear, val, row.dynamic404Max),
                        isOver404 ? 'text-red-700 font-semibold' : 'text-slate-900 font-semibold'
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono tabular-nums">
                        {row.isLockedActuals
                          ? 'Filed actual'
                          : row.dbpStatus === 'terminated'
                          ? 'Terminated'
                          : 'Horizon sync'}
                      </div>
                    </td>

                    {/* 8. EOY Assets */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div
                        className={`font-semibold ${
                          isOverCeiling ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {formatCurrency(row.eoyAssets)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {row.rolloverOutAmount > 0
                          ? 'Est. rollover'
                          : row.dbpStatus === 'terminated'
                          ? 'Rolled out'
                          : row.statutoryCeiling > 0
                          ? `${row.fundingRatioPct}% funded`
                          : '—'}
                      </div>
                    </td>

                    {/* 9. Statutory Ceiling */}
                    <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums">
                      <div className="text-slate-900 font-medium">
                        {formatCurrency(row.statutoryCeiling)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        ×{row.factor417e.toFixed(2)} unisex
                      </div>
                    </td>

                    {/* 10. Status */}
                    <td
                      className="py-2.5 px-3 align-top text-right"
                      title={row.statusNote}
                    >
                      <div className="flex justify-end text-[11px] leading-snug">
                        {renderStatusIndicator(row.statusCode, row.statusLabel)}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight truncate">
                        {row.statusCode === 'over_ceiling'
                          ? `+${formatCurrency(row.eoyAssets - row.statutoryCeiling)}`
                          : row.statusCode === 'over_404'
                          ? `+${formatCurrency(row.plannedDbp - row.dynamic404Max)}`
                          : row.dbpStatus === 'terminated' || row.statusCode === 'inactive'
                          ? row.statusNote
                          : row.statutoryCeiling > 0
                          ? `${formatCurrency(Math.max(0, row.headroomToCeiling))} room`
                          : '—'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200 font-mono tabular-nums text-[11px] font-semibold text-slate-800">
                <td className="py-2.5 px-3 font-sans text-slate-700">6-Yr Summary</td>
                <td className="py-2.5 px-2 text-right">
                  {formatCurrency(waterfall.rows.reduce((s, r) => s + r.w2Salary, 0))}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-500">
                  {formatCurrency(
                    waterfall.rows.reduce((m, r) => Math.max(m, r.rollingHigh3), 0)
                  )}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-500">
                  {formatCurrency(
                    waterfall.rows.reduce((m, r) => Math.max(m, r.annuity415b), 0)
                  )}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-400">—</td>
                <td className="py-2.5 px-2 text-right text-teal-900">
                  {formatCurrency(waterfall.totalSixYearDynamic404Room)}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-900">
                  {formatCurrency(waterfall.totalSixYearPlannedDbp)}
                </td>
                <td className="py-2.5 px-2 text-right text-teal-900">
                  {formatCurrency(waterfall.projectedExitRollover)}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-800">
                  {formatCurrency(waterfall.peakStatutoryCeiling)}
                </td>
                <td className="py-2.5 px-3 text-right font-sans text-[11px]">
                  {waterfall.overCeilingYearCount > 0 || waterfall.overLimitYearCount > 0 ? (
                    <span className="text-red-700">
                      {waterfall.overCeilingYearCount + waterfall.overLimitYearCount} alert
                      {waterfall.overCeilingYearCount + waterfall.overLimitYearCount === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-emerald-700">Within limits</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Selected-Year DBP Controls & Qualified Plans (401(k)/Annuities)   */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Defined Benefit Plan Controls */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Defined Benefit Plan Details ({yr.tax_year})
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {setup.has_dbp ? `${dbp.dbp_plan_id} · Plan Yr ${selectedRow?.planYear ?? 1}` : 'Inactive in Setup'}
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

            <div>
              <NumericField
                label="Max Deductible Contribution"
                fieldCode="dbp_max_deductible_contribution"
                prefix="$"
                step={2500}
                value={dbp.dbp_max_deductible_contribution}
                disabled={isLocked || !setup.has_dbp}
                onChange={(v) => updateDbp({ dbp_max_deductible_contribution: v })}
              />
              {!isLocked &&
                setup.has_dbp &&
                selectedRow &&
                selectedRow.dynamic404Max !== dbp.dbp_max_deductible_contribution && (
                  <button
                    type="button"
                    onClick={() =>
                      updateDbp({ dbp_max_deductible_contribution: selectedRow.dynamic404Max })
                    }
                    className="mt-1 text-[11px] font-medium text-teal-800 hover:text-teal-950 underline"
                  >
                    Sync to Dynamic 404 Max ({formatCurrency(selectedRow.dynamic404Max)})
                  </button>
                )}
            </div>

            <NumericField
              label="Actual / Planned Contribution"
              fieldCode="dbp_actual_contribution"
              prefix="$"
              step={2500}
              value={dbp.dbp_actual_contribution}
              disabled={isLocked || !setup.has_dbp}
              onChange={(v) => updateDbp({ dbp_actual_contribution: v })}
              helperText="Synced bi-directionally with Actuarial Matrix & Six-Year Horizon"
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Qualified Plans (401(k) / IRA) &amp; Annuities ({yr.tax_year})
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {setup.has_401k_or_ira ? '401(k) / PS Active' : '401(k) Inactive'}
            </span>
          </div>

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
    </div>
  );
};
