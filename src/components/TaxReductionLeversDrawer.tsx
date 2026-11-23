import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { ComputedTaxYear, SetupConfig, TaxYearRecord, WorkspaceTab } from '../types/tax';
import {
  analyzeActionableTaxReductionYears,
  applyTaxReductionScratchpadToYear,
  simulateTaxReductionScratchpad,
  type TaxReductionScratchpadInput,
} from '../engine/taxReductionLevers';
import { formatCompactCurrency, formatCurrency } from '../utils/format';

interface TaxReductionLeversDrawerProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  onSelectYear: (year: number, navigateTo?: WorkspaceTab) => void;
}

const EMPTY_SCRATCHPAD: TaxReductionScratchpadInput = {
  prepaidOpex: 0,
  equipment179: 0,
  billingDeferral: 0,
  extraDbp: 0,
};

function parsePositiveDollar(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
}

export const TaxReductionLeversDrawer: React.FC<TaxReductionLeversDrawerProps> = ({
  setup,
  years,
  computed,
  onUpdateYear,
  onSelectYear,
}) => {
  const flaggedYears = useMemo(
    () => analyzeActionableTaxReductionYears(setup, years, computed),
    [setup, years, computed]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [activeTaxYear, setActiveTaxYear] = useState<number | null>(null);
  const [scratchByYear, setScratchByYear] = useState<
    Record<number, TaxReductionScratchpadInput>
  >({});
  const [committedNotice, setCommittedNotice] = useState<string | null>(null);

  // Keep selected flagged year valid whenever profile or computed triggers change
  useEffect(() => {
    if (flaggedYears.length === 0) {
      setActiveTaxYear(null);
      return;
    }
    if (
      activeTaxYear === null ||
      !flaggedYears.some((item) => item.taxYear === activeTaxYear)
    ) {
      setActiveTaxYear(flaggedYears[0].taxYear);
    }
  }, [flaggedYears, activeTaxYear]);

  const activeAnalysis =
    flaggedYears.find((item) => item.taxYear === activeTaxYear) ?? flaggedYears[0] ?? null;

  const activeScratch: TaxReductionScratchpadInput = activeAnalysis
    ? scratchByYear[activeAnalysis.taxYear] ?? EMPTY_SCRATCHPAD
    : EMPTY_SCRATCHPAD;

  const simulation = useMemo(() => {
    if (!activeAnalysis) return null;
    return simulateTaxReductionScratchpad(setup, years, computed, activeAnalysis, activeScratch);
  }, [setup, years, computed, activeAnalysis, activeScratch]);

  if (flaggedYears.length === 0 || !activeAnalysis || !simulation) {
    return null;
  }

  const updateScratchField = (
    field: keyof TaxReductionScratchpadInput,
    value: number
  ) => {
    setCommittedNotice(null);
    setScratchByYear((prev) => ({
      ...prev,
      [activeAnalysis.taxYear]: {
        ...(prev[activeAnalysis.taxYear] ?? EMPTY_SCRATCHPAD),
        [field]: Math.max(0, Math.round(value)),
      },
    }));
  };

  const resetActiveScratch = () => {
    setCommittedNotice(null);
    setScratchByYear((prev) => ({
      ...prev,
      [activeAnalysis.taxYear]: { ...EMPTY_SCRATCHPAD },
    }));
  };

  const handleQuickFillToClearCliff = () => {
    const gap = activeAnalysis.magiOverIrmaaCliff;
    if (gap <= 0) return;
    setCommittedNotice(null);
    // Prefer filing-deadline DBP Top-Up room first (zero cash-flow distortion before Dec 31),
    // then fill any remainder with cash-basis Prepaid OpEx when S-Corp is active.
    const dbpRoom = activeAnalysis.dbpTopUp.visible ? activeAnalysis.dbpTopUp.remainingRoom : 0;
    const targetBuffer = gap + 500;
    const dbpFill = Math.min(dbpRoom, targetBuffer);
    const remainder = Math.max(0, targetBuffer - dbpFill);
    const prepaidFill = setup.has_scorp ? remainder : 0;

    setScratchByYear((prev) => ({
      ...prev,
      [activeAnalysis.taxYear]: {
        prepaidOpex: prepaidFill,
        equipment179: 0,
        billingDeferral: 0,
        extraDbp: dbpFill,
      },
    }));
  };

  const handleCommitScratchpad = () => {
    if (simulation.totalReductionAttempted <= 0) return;
    const targetYear = activeAnalysis.taxYear;
    const appliedScratch: TaxReductionScratchpadInput = {
      prepaidOpex: activeScratch.prepaidOpex,
      equipment179: activeScratch.equipment179,
      billingDeferral: activeScratch.billingDeferral,
      extraDbp: activeAnalysis.dbpTopUp.visible ? activeScratch.extraDbp : 0,
    };

    onUpdateYear(targetYear, (prev) =>
      applyTaxReductionScratchpadToYear(
        prev,
        setup,
        activeAnalysis.currentEffectiveOpex,
        appliedScratch
      )
    );

    const parts: string[] = [];
    if (appliedScratch.prepaidOpex > 0) {
      parts.push(`+${formatCurrency(appliedScratch.prepaidOpex)} prepaid OpEx`);
    }
    if (appliedScratch.equipment179 > 0) {
      parts.push(`+${formatCurrency(appliedScratch.equipment179)} equipment/§179`);
    }
    if (appliedScratch.billingDeferral > 0) {
      parts.push(`-${formatCurrency(appliedScratch.billingDeferral)} deferred billing`);
    }
    if (appliedScratch.extraDbp > 0) {
      parts.push(`+${formatCurrency(appliedScratch.extraDbp)} DBP top-up`);
    }

    setScratchByYear((prev) => ({
      ...prev,
      [targetYear]: { ...EMPTY_SCRATCHPAD },
    }));
    setCommittedNotice(`Committed to ${targetYear} plan: ${parts.join(', ')}.`);
  };

  // Progress bar scale: anchor bar width so IRMAA cliff marker sits cleanly around ~75%–85% of bar
  const cliffThreshold = Math.max(1, simulation.irmaaCliffThreshold);
  const maxBarScale = Math.max(
    cliffThreshold * 1.25,
    simulation.baselineMagi * 1.05,
    simulation.projectedMagi * 1.05
  );
  const cliffMarkerPct = Math.min(96, Math.max(10, (cliffThreshold / maxBarScale) * 100));
  const projectedBarPct = Math.min(100, Math.max(0, (simulation.projectedMagi / maxBarScale) * 100));
  const baselineMarkerPct = Math.min(100, Math.max(0, (simulation.baselineMagi / maxBarScale) * 100));

  const irmaaFlaggedCount = flaggedYears.filter((y) =>
    y.triggers.some((t) => t.kind === 'irmaa_cliff')
  ).length;
  const seniorFlaggedCount = flaggedYears.filter((y) =>
    y.triggers.some((t) => t.kind === 'senior_phaseout')
  ).length;
  const bracketFlaggedCount = flaggedYears.filter((y) =>
    y.triggers.some((t) => t.kind === 'bracket_jump')
  ).length;

  const hasAnyScratchInput = simulation.totalReductionAttempted > 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Collapsible Drawer Header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-left bg-slate-50/70 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-teal-700 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-teal-700 shrink-0" />
          )}
          <SlidersHorizontal className="w-4 h-4 text-teal-700 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                Actionable Tax-Reduction Levers
              </span>
              <span className="text-[11px] font-mono font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                {flaggedYears.length} unlocked {flaggedYears.length === 1 ? 'year' : 'years'} flagged (
                {flaggedYears.map((y) => y.taxYear).join(', ')})
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {[
                irmaaFlaggedCount > 0 ? `${irmaaFlaggedCount} IRMAA Cliff` : null,
                seniorFlaggedCount > 0 ? `${seniorFlaggedCount} Senior Phaseout` : null,
                bracketFlaggedCount > 0 ? `${bracketFlaggedCount} Bracket Jump` : null,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              — Deadline-grouped deductions &amp; live AGI vs. IRMAA scratchpad
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-teal-800 whitespace-nowrap shrink-0">
          {isOpen ? 'Collapse drawer' : 'Open levers & scratchpad'}
        </span>
      </button>

      {/* Collapsible Drawer Body */}
      {isOpen && (
        <div className="border-t border-slate-200 p-4 sm:p-5 space-y-5">
          {/* Flagged Unlocked Year Selector + Active Trigger Summary */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 mr-1">
                Unlocked Flagged Years:
              </span>
              {flaggedYears.map((item) => {
                const selected = item.taxYear === activeAnalysis.taxYear;
                const hasIrmaa = item.triggers.some((t) => t.kind === 'irmaa_cliff');
                return (
                  <button
                    key={item.taxYear}
                    type="button"
                    onClick={() => {
                      setCommittedNotice(null);
                      setActiveTaxYear(item.taxYear);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-semibold rounded-md border transition-colors ${
                      selected
                        ? 'bg-teal-800 text-white border-teal-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>{item.taxYear}</span>
                    {hasIrmaa && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          selected ? 'bg-amber-300' : 'bg-red-500'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {activeAnalysis.triggers.map((trig) => (
                <span
                  key={trig.kind}
                  title={trig.detail}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border ${
                    trig.severity === 'danger'
                      ? 'bg-red-50 text-red-800 border-red-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{trig.label}</span>
                </span>
              ))}
            </div>
          </div>

          {committedNotice && (
            <div className="px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{committedNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setCommittedNotice(null)}
                className="text-[11px] font-medium text-emerald-800 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* 1. Dynamic Levers Grouped by Statutory Deadline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Column A: Before Dec 31 (Cash-Basis) */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/40 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                    Before Dec 31, {activeAnalysis.taxYear} (Cash-Basis)
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  Hard Year-End Cutoff
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                {setup.has_scorp && (
                  <>
                    <div className="bg-white border border-slate-200 rounded-md p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          Prepaid Operating Expenses (IRS 12-Month Rule)
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                          Curr OpEx {formatCurrency(activeAnalysis.currentEffectiveOpex)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Accelerate recurring subscriptions, insurance, rent, or professional retainers covering ≤12 months (Treas. Reg. §1.263(a)-4(f)) paid before Dec 31 to lower {activeAnalysis.taxYear} K-1 income dollar-for-dollar.
                      </p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-md p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          Equipment / Tech (De Minimis &amp; IRC §179)
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                          §179 K-1 Limit {formatCurrency(Math.max(0, activeAnalysis.currentK1OrdinaryIncome))}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Expense hardware/software placed in service by Dec 31 via De Minimis Safe Harbor (up to $2,500/invoice) or immediate IRC §179 expensing up to positive business income.
                      </p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-md p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          Billing / Collection Deferral
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                          Rev {formatCurrency(activeAnalysis.currentGrossRevenue)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Delay late-December invoicing so cash clears in January {activeAnalysis.taxYear + 1}.
                        {activeAnalysis.nextYearTaxYear !== null &&
                          activeAnalysis.nextYearMagiHeadroomToCliff !== null && (
                            <>
                              {' '}
                              {activeAnalysis.nextYearMagiHeadroomToCliff > 0 ? (
                                <span className="text-emerald-700 font-medium">
                                  {activeAnalysis.nextYearTaxYear} has{' '}
                                  {formatCurrency(activeAnalysis.nextYearMagiHeadroomToCliff)} IRMAA
                                  cliff room to absorb shifted receipts.
                                </span>
                              ) : (
                                <span className="text-amber-700 font-medium">
                                  Note: {activeAnalysis.nextYearTaxYear} is already above its IRMAA
                                  cliff.
                                </span>
                              )}
                            </>
                          )}
                      </p>
                    </div>
                  </>
                )}

                {activeAnalysis.employee401k.enabled && (
                  <div className="bg-white border border-slate-200 rounded-md p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        Remaining Employee 401(k) Room (§402(g) + Catch-Up)
                      </span>
                      <span
                        className={`font-mono text-[11px] font-semibold tabular-nums ${
                          activeAnalysis.employee401k.remainingAtCurrentW2 > 0
                            ? 'text-teal-800'
                            : 'text-slate-500'
                        }`}
                      >
                        {formatCurrency(activeAnalysis.employee401k.remainingAtCurrentW2)} unused
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      Scheduled deferrals:{' '}
                      <span className="font-mono text-slate-700">
                        {formatCurrency(activeAnalysis.employee401k.currentUsedTotal)}
                      </span>{' '}
                      of{' '}
                      <span className="font-mono text-slate-700">
                        {formatCurrency(activeAnalysis.employee401k.statutoryCapTotal)}
                      </span>{' '}
                      statutory household cap.
                      {activeAnalysis.employee401k.remainingAtCurrentW2 === 0 &&
                        activeAnalysis.employee401k.remainingStatutoryWithHigherW2 > 0 && (
                          <>
                            {' '}
                            Fully maximized at current W-2 net of FICA (
                            <span className="font-mono text-slate-700">
                              {formatCurrency(
                                activeAnalysis.employee401k.remainingStatutoryWithHigherW2
                              )}
                            </span>{' '}
                            statutory cap remains if W-2 payroll is increased before Dec 31).
                          </>
                        )}
                    </p>
                  </div>
                )}

                {!setup.has_scorp && !activeAnalysis.employee401k.enabled && (
                  <div className="bg-white border border-slate-200 rounded-md p-2.5 text-[11px] text-slate-500">
                    Enable S-Corp or 401(k)/IRA modules in Setup to unlock cash-basis entity and payroll deferral levers.
                  </div>
                )}
              </div>
            </div>

            {/* Column B: Before Filing / Extension Deadline */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/40 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-teal-700 shrink-0" />
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                    Before Filing / Extension ({activeAnalysis.taxYear + 1})
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-teal-800 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                  IRC §404(a)(6) Window
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* DBP Top-Up: Auto-hidden whenever DBP is inactive, terminated, or frozen */}
                {activeAnalysis.dbpTopUp.visible && (
                  <div className="bg-white border border-teal-200 rounded-md p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        DBP Top-Up (IRC §404(a)(6))
                      </span>
                      <span className="font-mono text-xs font-semibold text-teal-800 tabular-nums">
                        {formatCurrency(activeAnalysis.dbpTopUp.remainingRoom)} room
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      Live Actuarial Waterfall (Plan Yr {activeAnalysis.dbpTopUp.planYear} ·{' '}
                      <span className="capitalize">{activeAnalysis.dbpTopUp.dbpStatus}</span>):
                      Planned{' '}
                      <span className="font-mono text-slate-800">
                        {formatCurrency(activeAnalysis.dbpTopUp.plannedDbp)}
                      </span>{' '}
                      vs. Dynamic §404 Max{' '}
                      <span className="font-mono text-slate-800">
                        {formatCurrency(activeAnalysis.dbpTopUp.dynamic404Max)}
                      </span>
                      . Fundable up to the S-Corp return filing or extension deadline without year-end cash rush.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-slate-500">
                        §415(b) Ceiling Headroom:{' '}
                        {formatCurrency(Math.max(0, activeAnalysis.dbpTopUp.headroomToCeiling))}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectYear(activeAnalysis.taxYear, 'dbp')}
                        className="text-[11px] font-medium text-teal-800 hover:underline"
                      >
                        Open DBP Waterfall →
                      </button>
                    </div>
                  </div>
                )}

                {activeAnalysis.employer401k.enabled && (
                  <div className="bg-white border border-slate-200 rounded-md p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        Remaining Employer 401(k) Profit-Sharing Cap
                      </span>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          activeAnalysis.employer401k.remainingRoomDollars > 0
                            ? 'text-teal-800'
                            : 'text-slate-500'
                        }`}
                      >
                        {formatCurrency(activeAnalysis.employer401k.remainingRoomDollars)} room
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      Scheduled:{' '}
                      <span className="font-mono text-slate-800">
                        {formatCurrency(activeAnalysis.employer401k.currentUsedDollars)}
                      </span>{' '}
                      ({Number((activeAnalysis.employer401k.appliedRate * 100).toFixed(1))}%) vs.{' '}
                      <span className="font-mono text-slate-800">
                        {formatCurrency(activeAnalysis.employer401k.statutoryMaxDollars)}
                      </span>{' '}
                      statutory max (
                      {Math.round(activeAnalysis.employer401k.statutoryMaxRate * 100)}% cap
                      {activeAnalysis.employer401k.cappedByActiveDbp
                        ? ' under IRC §404(a)(7) while DBP is active'
                        : ' post-DBP subject to §415(c)'}
                      ).
                    </p>
                    {!activeAnalysis.employer401k.cappedByActiveDbp &&
                      activeAnalysis.employer401k.remainingRoomDollars > 0 && (
                        <div className="mt-1.5 flex justify-end">
                          <button
                            type="button"
                            onClick={() => onSelectYear(activeAnalysis.taxYear, 'setup')}
                            className="text-[11px] font-medium text-teal-800 hover:underline"
                          >
                            Adjust Post-DBP Profit-Sharing % in Setup →
                          </button>
                        </div>
                      )}
                  </div>
                )}

                {!activeAnalysis.dbpTopUp.visible && !activeAnalysis.employer401k.enabled && (
                  <div className="bg-white border border-slate-200 rounded-md p-3 text-[11px] text-slate-500">
                    No post-year-end retirement contribution room is active for {activeAnalysis.taxYear}
                    {setup.has_dbp ? ' (DBP is terminated or frozen in this year)' : ''}. Use cash-basis levers before Dec 31.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2. Quick-Test Scratchpad with Live AGI vs. IRMAA Cliff Progress Bar */}
          <div className="border border-teal-200/80 rounded-lg p-4 bg-teal-50/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-700 shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Quick-Test Scratchpad ({activeAnalysis.taxYear}) — Test Before Committing
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Runs the live 6-year tax engine in sandbox mode to preview MAGI vs. the{' '}
                    {simulation.irmaaCoverageYear} IRMAA cliff, Senior Deduction recovery, and total tax savings.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeAnalysis.magiOverIrmaaCliff > 0 &&
                  (setup.has_scorp || activeAnalysis.dbpTopUp.visible) && (
                    <button
                      type="button"
                      onClick={handleQuickFillToClearCliff}
                      className="px-2.5 py-1 text-[11px] font-medium text-teal-900 bg-white border border-teal-300 rounded hover:bg-teal-50 transition-colors whitespace-nowrap"
                    >
                      Auto-fill to clear cliff
                    </button>
                  )}
                {hasAnyScratchInput && (
                  <button
                    type="button"
                    onClick={resetActiveScratch}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Scratchpad Numeric Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {setup.has_scorp && (
                <>
                  <div className="bg-white border border-slate-200 rounded-md p-2.5">
                    <label
                      htmlFor={`scratch-prepaid-${activeAnalysis.taxYear}`}
                      className="block text-[11px] font-medium text-slate-700 mb-1"
                    >
                      Prepaid OpEx (Before Dec 31)
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                        $
                      </span>
                      <input
                        id={`scratch-prepaid-${activeAnalysis.taxYear}`}
                        type="text"
                        inputMode="numeric"
                        value={activeScratch.prepaidOpex === 0 ? '' : String(activeScratch.prepaidOpex)}
                        placeholder="0"
                        onChange={(e) =>
                          updateScratchField('prepaidOpex', parsePositiveDollar(e.target.value))
                        }
                        className="w-full pl-6 pr-2 py-1 text-xs font-mono tabular-nums text-right text-slate-900 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-md p-2.5">
                    <label
                      htmlFor={`scratch-equip-${activeAnalysis.taxYear}`}
                      className="block text-[11px] font-medium text-slate-700 mb-1"
                    >
                      Equipment / Tech §179 (Dec 31)
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                        $
                      </span>
                      <input
                        id={`scratch-equip-${activeAnalysis.taxYear}`}
                        type="text"
                        inputMode="numeric"
                        value={activeScratch.equipment179 === 0 ? '' : String(activeScratch.equipment179)}
                        placeholder="0"
                        onChange={(e) =>
                          updateScratchField('equipment179', parsePositiveDollar(e.target.value))
                        }
                        className="w-full pl-6 pr-2 py-1 text-xs font-mono tabular-nums text-right text-slate-900 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-md p-2.5">
                    <label
                      htmlFor={`scratch-defer-${activeAnalysis.taxYear}`}
                      className="block text-[11px] font-medium text-slate-700 mb-1"
                    >
                      Billing Deferral (Dec 31)
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                        $
                      </span>
                      <input
                        id={`scratch-defer-${activeAnalysis.taxYear}`}
                        type="text"
                        inputMode="numeric"
                        value={
                          activeScratch.billingDeferral === 0
                            ? ''
                            : String(activeScratch.billingDeferral)
                        }
                        placeholder="0"
                        onChange={(e) =>
                          updateScratchField('billingDeferral', parsePositiveDollar(e.target.value))
                        }
                        className="w-full pl-6 pr-2 py-1 text-xs font-mono tabular-nums text-right text-slate-900 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeAnalysis.dbpTopUp.visible && (
                <div className="bg-white border border-teal-200 rounded-md p-2.5">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label
                      htmlFor={`scratch-dbp-${activeAnalysis.taxYear}`}
                      className="text-[11px] font-medium text-slate-700"
                    >
                      Extra DBP Top-Up (§404(a)(6))
                    </label>
                    {activeAnalysis.dbpTopUp.remainingRoom > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateScratchField('extraDbp', activeAnalysis.dbpTopUp.remainingRoom)
                        }
                        className="text-[10px] font-mono text-teal-800 hover:underline whitespace-nowrap"
                      >
                        Max {formatCompactCurrency(activeAnalysis.dbpTopUp.remainingRoom)}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                      $
                    </span>
                    <input
                      id={`scratch-dbp-${activeAnalysis.taxYear}`}
                      type="text"
                      inputMode="numeric"
                      value={activeScratch.extraDbp === 0 ? '' : String(activeScratch.extraDbp)}
                      placeholder="0"
                      onChange={(e) =>
                        updateScratchField('extraDbp', parsePositiveDollar(e.target.value))
                      }
                      className={`w-full pl-6 pr-2 py-1 text-xs font-mono tabular-nums text-right text-slate-900 bg-slate-50 border rounded focus:bg-white focus:outline-none ${
                        simulation.exceedsDbpRoom
                          ? 'border-red-400 focus:border-red-600'
                          : 'border-slate-300 focus:border-teal-700'
                      }`}
                    />
                  </div>
                  {simulation.exceedsDbpRoom && (
                    <p className="text-[10px] text-red-700 mt-1">
                      Exceeds live Dynamic §404 room ({formatCurrency(activeAnalysis.dbpTopUp.remainingRoom)})
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Live Progress Bar: Projected AGI / MAGI vs. IRMAA Cliff */}
            <div className="bg-white border border-slate-200 rounded-md p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">
                  Projected {activeAnalysis.taxYear} MAGI vs. {simulation.irmaaCoverageYear} IRMAA Tier 1 Cliff (
                  <span className="font-mono">{formatCurrency(simulation.irmaaCliffThreshold)}</span>)
                </div>
                <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                  {hasAnyScratchInput && (
                    <span className="text-slate-400 line-through">
                      {formatCurrency(simulation.baselineMagi)}
                    </span>
                  )}
                  <span
                    className={`font-semibold ${
                      simulation.cliffCleared ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatCurrency(simulation.projectedMagi)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border ${
                      simulation.cliffCleared
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}
                  >
                    {simulation.cliffCleared
                      ? `Shielded · ${formatCurrency(
                          simulation.irmaaCliffThreshold - simulation.projectedMagi
                        )} below cliff`
                      : `Over cliff by ${formatCurrency(simulation.projectedOverCliff)}`}
                  </span>
                </div>
              </div>

              {/* Horizontal Bar Track with IRMAA Cliff Marker & Baseline Ghost Marker */}
              <div className="relative pt-1 pb-4">
                <div
                  className="h-3 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200 relative"
                  role="progressbar"
                  aria-label={`Projected ${activeAnalysis.taxYear} MAGI vs ${simulation.irmaaCoverageYear} IRMAA cliff`}
                  aria-valuenow={simulation.projectedMagi}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(maxBarScale)}
                >
                  <div
                    style={{ width: `${projectedBarPct}%` }}
                    className={`h-full transition-all duration-200 ${
                      simulation.cliffCleared ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                  />
                </div>

                {/* Baseline Ghost Marker when testing reductions */}
                {hasAnyScratchInput && simulation.magiDelta < 0 && (
                  <div
                    style={{ left: `${baselineMarkerPct}%` }}
                    title={`Baseline MAGI: ${formatCurrency(simulation.baselineMagi)}`}
                    className="absolute top-0.5 h-4 w-0.5 bg-slate-400 -translate-x-1/2 pointer-events-none"
                  />
                )}

                {/* IRMAA Cliff Vertical Marker */}
                <div
                  style={{ left: `${cliffMarkerPct}%` }}
                  className="absolute top-0 h-4 w-0.5 bg-slate-900 -translate-x-1/2 pointer-events-none"
                >
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono font-semibold text-slate-700 whitespace-nowrap">
                    Cliff {formatCompactCurrency(simulation.irmaaCliffThreshold)}
                  </div>
                </div>
              </div>

              {/* Live Impact Readout Strip + Commit CTA */}
              <div className="pt-2 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-500">Projected AGI</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(simulation.projectedAgi)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Est. Tax Savings</div>
                    <div
                      className={`font-mono font-semibold tabular-nums ${
                        simulation.estimatedTaxSavings > 0 ? 'text-emerald-700' : 'text-slate-600'
                      }`}
                    >
                      {simulation.estimatedTaxSavings > 0
                        ? `-${formatCurrency(simulation.estimatedTaxSavings)}`
                        : '$0'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Senior Ded. Recovered</div>
                    <div
                      className={`font-mono font-semibold tabular-nums ${
                        simulation.seniorDeductionRecovered > 0
                          ? 'text-emerald-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {simulation.seniorDeductionRecovered > 0
                        ? `+${formatCurrency(simulation.seniorDeductionRecovered)}`
                        : '$0'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Marginal Bracket</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums">
                      {simulation.baselineMarginalRate !== simulation.projectedMarginalRate
                        ? `${simulation.baselineMarginalRate}% → ${simulation.projectedMarginalRate}%`
                        : `${simulation.projectedMarginalRate}%`}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!hasAnyScratchInput || simulation.exceedsDbpRoom}
                  onClick={handleCommitScratchpad}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  Commit to {activeAnalysis.taxYear} Plan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
