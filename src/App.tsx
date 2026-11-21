import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CalendarRange,
  Compass,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Landmark,
  MapPin,
  Menu,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import type {
  CadenceForecasterState,
  PlannerState,
  PnlBalanceSheetState,
  ScenarioDefinition,
  ScheduleViewConfig,
  SetupConfig,
  TaxYearRecord,
  WorkspaceTab,
} from './types/tax';
import {
  createInitialBaselineState,
  normalizePlannerState,
  projectNextYear,
  rollWindowForward,
} from './engine/baseline';
import { calculateSixYearPlan } from './engine/taxEngine';
import { runGuardrailValidation } from './engine/validator';
import { buildFilingFormsMap } from './engine/formsMap';
import {
  createInitialPnlBalanceSheetState,
  type ComputedPnlBalanceSheet,
} from './engine/pnlBalanceSheet';
import { createInitialCadenceForecasterState } from './engine/cadenceEngine';
import { HorizonView } from './components/HorizonView';
import { SetupView } from './components/SetupView';
import { PnlBalanceSheetView } from './components/PnlBalanceSheetView';
import { TransactionCadenceView } from './components/TransactionCadenceView';
import { Form1040View } from './components/Form1040View';
import { SCorpView } from './components/SCorpView';
import { DbpView } from './components/DbpView';
import { MultiStateView } from './components/MultiStateView';
import { FormsMapView } from './components/FormsMapView';
import { ScenariosAiView } from './components/ScenariosAiView';
import { RollForwardModal } from './components/RollForwardModal';

const STORAGE_KEY = 'rolling-tax-planner-state-v7';

function loadInitialState(): PlannerState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlannerState;
      if (parsed?.setup && Array.isArray(parsed?.years) && parsed.years.length === 6) {
        return normalizePlannerState(parsed);
      }
    }
  } catch {
    // Fallback to canonical sample-baseline.json
  }
  return createInitialBaselineState();
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  horizon: 'Six-Year Horizon',
  setup: 'Setup & Decision Tree',
  pnl_bs: 'P&L & Balance Sheet',
  cadence_forecaster: 'Transaction Cadence Forecaster',
  form1040: 'Form 1040 Return',
  scorp: 'S-Corp (1120-S)',
  dbp: 'DBP & Retirement',
  multistate: 'Multi-State & PTE',
  forms: 'IRS Forms Map',
  scenarios: 'Scenarios & AI',
};

export function App() {
  const [state, setState] = useState<PlannerState>(() => loadInitialState());
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('horizon');
  const [selectedYear, setSelectedYear] = useState<number>(state.setup.anchor_actuals_year);
  const [showRollModal, setShowRollModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota issues
    }
  }, [state]);

  const computed = useMemo(
    () => calculateSixYearPlan(state.setup, state.years),
    [state.setup, state.years]
  );

  const issues = useMemo(
    () => runGuardrailValidation(state.setup, state.years, computed),
    [state.setup, state.years, computed]
  );

  const formsMap = useMemo(
    () => buildFilingFormsMap(state.setup, computed),
    [state.setup, computed]
  );

  const handleUpdateSetup = (nextSetup: SetupConfig) => {
    setState((prev) => {
      const termChanged =
        prev.setup.dbp_planned_termination_year !== nextSetup.dbp_planned_termination_year;
      if (!termChanged) {
        return {
          ...prev,
          setup: nextSetup,
        };
      }

      const termYear = nextSetup.dbp_planned_termination_year;
      const updatedYears = prev.years.map((yr) => {
        if (yr.is_locked_actuals) return yr;
        if (termYear === null) {
          const restoredContrib =
            yr.dbp_and_retirement.dbp_actual_contribution > 0
              ? yr.dbp_and_retirement.dbp_actual_contribution
              : 58000;
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'active' as const,
              dbp_target_termination_year: 2099,
              dbp_max_deductible_contribution: Math.max(
                64000,
                yr.dbp_and_retirement.dbp_max_deductible_contribution
              ),
              dbp_actual_contribution: restoredContrib,
              rollover_amount: 0,
              rollover_source_type: 'None',
            },
          };
        }

        if (yr.tax_year > termYear) {
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'terminated' as const,
              dbp_target_termination_year: termYear,
              dbp_max_deductible_contribution: 0,
              dbp_actual_contribution: 0,
              rollover_amount: 0,
              rollover_source_type: 'None',
            },
          };
        }

        if (yr.tax_year === termYear) {
          const termContrib =
            yr.dbp_and_retirement.dbp_actual_contribution > 0
              ? Math.min(yr.dbp_and_retirement.dbp_actual_contribution, 32000)
              : 29000;
          return {
            ...yr,
            dbp_and_retirement: {
              ...yr.dbp_and_retirement,
              dbp_status: 'terminating' as const,
              dbp_target_termination_year: termYear,
              dbp_max_deductible_contribution: Math.max(
                64000,
                yr.dbp_and_retirement.dbp_max_deductible_contribution
              ),
              dbp_actual_contribution: termContrib,
              rollover_amount: yr.dbp_and_retirement.rollover_amount || 480000,
              rollover_source_type: 'Defined Benefit Plan Termination',
            },
          };
        }

        const activeContrib =
          yr.dbp_and_retirement.dbp_actual_contribution > 0
            ? yr.dbp_and_retirement.dbp_actual_contribution
            : 58000;
        return {
          ...yr,
          dbp_and_retirement: {
            ...yr.dbp_and_retirement,
            dbp_status: 'active' as const,
            dbp_target_termination_year: termYear,
            dbp_max_deductible_contribution: Math.max(
              64000,
              yr.dbp_and_retirement.dbp_max_deductible_contribution
            ),
            dbp_actual_contribution: activeContrib,
            rollover_amount: 0,
            rollover_source_type: 'None',
          },
        };
      });

      return {
        ...prev,
        setup: nextSetup,
        years: updatedYears,
      };
    });
  };

  const handleReprojectForecast = () => {
    setState((prev) => {
      const year1 = prev.years[0];
      const nextYears: TaxYearRecord[] = [year1];
      for (let i = 1; i < 6; i++) {
        nextYears.push(projectNextYear(nextYears[i - 1], year1.tax_year + i, prev.setup));
      }
      return {
        ...prev,
        setup: {
          ...prev.setup,
          forecast_years: nextYears.map((y) => y.tax_year),
        },
        years: nextYears,
      };
    });
  };

  const handleUpdateYear = (
    taxYear: number,
    updater: (yr: TaxYearRecord) => TaxYearRecord
  ) => {
    setState((prev) => ({
      ...prev,
      years: prev.years.map((y) => (y.tax_year === taxYear ? updater(y) : y)),
    }));
  };

  const handleConfirmRoll = (overrides: {
    w2_wages_total: number;
    schedule_k1_ordinary_income: number;
    taxable_income: number;
    officer_w2_wages: number;
    scorp_distributions_total: number;
    dbp_actual_contribution: number;
  }) => {
    const yr1Comp = computed[0];
    const nextState = rollWindowForward(state, overrides, {
      adjusted_gross_income: yr1Comp.form_1040_out.adjusted_gross_income,
      taxable_income: yr1Comp.form_1040_out.taxable_income,
      federal_income_tax: yr1Comp.form_1040_out.federal_income_tax,
      total_state_tax: yr1Comp.total_state_tax,
      effective_tax_rate: yr1Comp.form_1040_out.effective_tax_rate,
    });
    setState(nextState);
    setSelectedYear(nextState.setup.anchor_actuals_year);
    setShowRollModal(false);
    setActiveTab('horizon');
  };

  const handleAdoptScenario = (scenario: ScenarioDefinition) => {
    setState((prev) => ({
      ...prev,
      setup: scenario.setup,
      years: scenario.years,
    }));
  };

  const handleUpdateScheduleView = (nextScheduleView: ScheduleViewConfig) => {
    setState((prev) => ({
      ...prev,
      schedule_view: nextScheduleView,
    }));
  };

  const activePnlState: PnlBalanceSheetState = useMemo(() => {
    if (state.pnl_balance_sheet) return state.pnl_balance_sheet;
    const yr2026 = state.years.find((y) => y.tax_year === 2026) ?? state.years[1];
    return createInitialPnlBalanceSheetState(yr2026, computed[0]?.scorp_out.stock_basis_ending ?? 0);
  }, [state.pnl_balance_sheet, state.years, computed]);

  const handleUpdatePnlState = (
    updater: (prev: PnlBalanceSheetState) => PnlBalanceSheetState
  ) => {
    setState((prev) => {
      const yr2026 = prev.years.find((y) => y.tax_year === 2026) ?? prev.years[1];
      const base =
        prev.pnl_balance_sheet ??
        createInitialPnlBalanceSheetState(yr2026, computed[0]?.scorp_out.stock_basis_ending ?? 0);
      return {
        ...prev,
        pnl_balance_sheet: updater(base),
      };
    });
  };

  const handleResetPnlFrom2026Schedule = () => {
    setState((prev) => {
      const yr2026 = prev.years.find((y) => y.tax_year === 2026) ?? prev.years[1];
      return {
        ...prev,
        pnl_balance_sheet: createInitialPnlBalanceSheetState(
          yr2026,
          computed[0]?.scorp_out.stock_basis_ending ?? 0
        ),
      };
    });
  };

  const activeCadenceState: CadenceForecasterState = useMemo(() => {
    if (state.cadence_forecaster) return state.cadence_forecaster;
    return createInitialCadenceForecasterState(computed[0]?.scorp_out.stock_basis_ending ?? 0);
  }, [state.cadence_forecaster, computed]);

  const handleUpdateCadenceState = (
    updater: (prev: CadenceForecasterState) => CadenceForecasterState
  ) => {
    setState((prev) => {
      const base =
        prev.cadence_forecaster ??
        createInitialCadenceForecasterState(computed[0]?.scorp_out.stock_basis_ending ?? 0);
      return {
        ...prev,
        cadence_forecaster: updater(base),
      };
    });
  };

  const applyProjected2026Years = (
    prev: PlannerState,
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ): TaxYearRecord[] => {
    const targetYear = pnlSnapshot.projection_year || 2026;
    const caRev = Math.round(Math.max(0, pnlComp.lines.ca_revenue.projected));
    const azRev = Math.round(Math.max(0, pnlComp.lines.az_revenue.projected));
    const totalRev = caRev + azRev;
    const caApp = totalRev > 0 ? caRev / totalRev : 0;
    const azApp = totalRev > 0 ? azRev / totalRev : 0;
    const billW2 = Math.round(Math.max(0, pnlComp.lines.bill_officer_w2.projected));
    const debraW2 = Math.round(Math.max(0, pnlComp.lines.debra_salaries_wages.projected));
    const totalW2 = billW2 + debraW2;
    const dbpContrib = Math.round(Math.max(0, pnlComp.lines.dbp_contribution.projected));
    const sehiProjected = Math.round(Math.max(0, pnlComp.lines.sehi_medicare.projected));
    const drawsTotal = Math.round(Math.max(0, pnlComp.projectedDrawsTotal));
    const capContrib = Math.round(Math.max(0, pnlComp.projectedCapitalContributionsTotal));
    const nondedMeals = Math.round(Math.max(0, pnlComp.mealsNondeductible50.projected));
    const schedKInterest = Math.round(Math.max(0, pnlComp.scheduleKInterest.projected));

    const buildYears = (opEx: number) =>
      prev.years.map((yr) => {
        if (yr.tax_year !== targetYear) return yr;
        return {
          ...yr,
          form_1040: {
            ...yr.form_1040,
            w2_wages_total: totalW2,
            health_insurance_premiums: sehiProjected,
            sehi_medicare_override: sehiProjected > 0 ? sehiProjected : null,
          },
          scorp_1120s: {
            ...yr.scorp_1120s,
            ca_revenue: caRev,
            az_revenue: azRev,
            gross_receipts_revenue: totalRev,
            operating_expenses: opEx,
            use_detailed_1120s_deductions: false,
            bill_w2_wages: billW2,
            debra_w2_wages: debraW2,
            officer_w2_wages: totalW2,
            scorp_distributions_total: drawsTotal,
            capital_contributions: capContrib,
            schedule_k_interest_income: schedKInterest,
            schedule_k_nondeductible_expenses: nondedMeals,
            state_sourcing_breakdown: [
              { state_code: 'CA', apportionment_percent: Number((caApp * 100).toFixed(2)) },
              { state_code: 'AZ', apportionment_percent: Number((azApp * 100).toFixed(2)) },
            ],
            auto_sync_k1: true,
          },
          dbp_and_retirement: {
            ...yr.dbp_and_retirement,
            dbp_actual_contribution: dbpContrib,
            dbp_max_deductible_contribution: Math.max(
              yr.dbp_and_retirement.dbp_max_deductible_contribution,
              dbpContrib
            ),
          },
          state_filings: yr.state_filings.map((sf) =>
            sf.state_code === 'CA'
              ? { ...sf, state_apportionment_factor: caApp }
              : sf.state_code === 'AZ'
              ? { ...sf, state_apportionment_factor: azApp }
              : sf
          ),
        };
      });

    const probeComputed = calculateSixYearPlan(prev.setup, buildYears(0));
    const probe2026 = probeComputed.find((c) => c.tax_year === targetYear);
    const engineErPayroll = probe2026?.scorp_out.employer_payroll_taxes ?? 0;
    const engineEr401k = probe2026?.form_1040_out.employer_401k_total ?? 0;
    const calibratedOpEx = Math.max(
      0,
      Math.round(
        totalRev -
          totalW2 -
          dbpContrib -
          engineErPayroll -
          engineEr401k -
          Math.round(pnlComp.ordinaryBusinessIncome.projected)
      )
    );

    return buildYears(calibratedOpEx);
  };

  const handlePushPnlTo2026Schedule = (
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ) => {
    setState((prev) => ({
      ...prev,
      years: applyProjected2026Years(prev, pnlSnapshot, pnlComp),
      pnl_balance_sheet: {
        ...pnlSnapshot,
        last_pushed_at: new Date().toISOString(),
      },
    }));
  };

  const handlePushCadenceTo2026Schedule = (
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ) => {
    setState((prev) => {
      const baseCadence =
        prev.cadence_forecaster ??
        createInitialCadenceForecasterState(computed[0]?.scorp_out.stock_basis_ending ?? 0);
      return {
        ...prev,
        years: applyProjected2026Years(prev, pnlSnapshot, pnlComp),
        cadence_forecaster: {
          ...baseCadence,
          last_pushed_at: new Date().toISOString(),
        },
      };
    });
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PlannerState;
      if (!parsed?.setup || !Array.isArray(parsed?.years) || parsed.years.length !== 6) {
        throw new Error('Invalid plan file: expected setup and 6-year records.');
      }
      const normalized = normalizePlannerState(parsed);
      setState(normalized);
      setSelectedYear(normalized.setup.anchor_actuals_year);
      setImportNotice({ type: 'ok', text: `Imported ${file.name}` });
    } catch (err) {
      setImportNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to import JSON file.',
      });
    }
  };

  const handleResetBaseline = () => {
    const fresh = createInitialBaselineState();
    setState(fresh);
    setSelectedYear(fresh.setup.anchor_actuals_year);
    setImportNotice(null);
    setActiveTab('horizon');
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rolling-tax-plan-${state.setup.forecast_years[0]}-${state.setup.forecast_years[5]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const navItems: {
    id: WorkspaceTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    visible: boolean;
    count?: number;
  }[] = [
    { id: 'horizon', label: 'Six-Year Horizon', icon: CalendarRange, visible: true },
    { id: 'setup', label: 'Setup & Profile', icon: SlidersHorizontal, visible: true },
    { id: 'pnl_bs', label: 'P&L & Balance Sheet', icon: Scale, visible: true },
    {
      id: 'cadence_forecaster',
      label: 'Transaction Cadence Forecaster',
      icon: CalendarClock,
      visible: true,
    },
    { id: 'form1040', label: 'Form 1040', icon: FileSpreadsheet, visible: true },
    { id: 'scorp', label: 'S-Corp (1120-S)', icon: Building2, visible: state.setup.has_scorp },
    {
      id: 'dbp',
      label: 'DBP & Retirement',
      icon: Landmark,
      visible: state.setup.has_dbp || state.setup.has_401k_or_ira || state.setup.has_annuity,
    },
    {
      id: 'multistate',
      label: 'Multi-State & PTE',
      icon: MapPin,
      visible: state.setup.multi_state_active || state.setup.residency_change_active || state.setup.has_pte,
    },
    { id: 'forms', label: 'IRS Forms Map', icon: Compass, visible: true, count: formsMap.length },
    { id: 'scenarios', label: 'Scenarios & AI', icon: GitCompareArrows, visible: true },
  ];

  const handleSelectNav = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => handleSelectNav('horizon')}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap"
        >
          Rolling Tax Planner
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden p-1 text-slate-500 hover:text-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500 font-mono tabular-nums">
        Window {state.setup.forecast_years[0]}–{state.setup.forecast_years[5]}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5" aria-label="Primary modules">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-teal-800' : 'text-slate-400'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span className="font-mono text-[11px] text-slate-400">{item.count}</span>
                )}
              </button>
            );
          })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-1.5">
        <button
          type="button"
          onClick={handleExportJson}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 text-slate-400" />
          Export Plan JSON
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5 text-slate-400" />
          Import Plan JSON
        </button>
        <button
          type="button"
          onClick={handleResetBaseline}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          Reset Sample Baseline
        </button>
        {importNotice && (
          <div
            className={`px-3 pt-1 text-[11px] leading-snug ${
              importNotice.type === 'error' ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {importNotice.text}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportJson}
        className="hidden"
      />
      {/* Desktop Fixed Sidebar */}
      <aside className="no-print hidden lg:block w-64 shrink-0 fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden flex">
          <div className="w-64 max-w-[80vw] h-full shadow-xl">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 print:pl-0 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on Left, Single Primary CTA on Right */}
        <header className="no-print sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-mono text-slate-700 whitespace-nowrap">
                {state.setup.forecast_years[0]}–{state.setup.forecast_years[5]}
              </span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">
                {TAB_LABELS[activeTab]}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowRollModal(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap shrink-0"
          >
            Roll Window Forward
          </button>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto">
          {activeTab === 'horizon' && (
            <HorizonView
              setup={state.setup}
              computed={computed}
              issues={issues}
              archivedYears={state.archived_years}
              selectedYear={selectedYear}
              scheduleView={state.schedule_view}
              onUpdateScheduleView={handleUpdateScheduleView}
              onUpdateYear={handleUpdateYear}
              onSelectYear={(yr, nav) => {
                setSelectedYear(yr);
                if (nav) setActiveTab(nav);
              }}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'setup' && (
            <SetupView
              setup={state.setup}
              onUpdateSetup={handleUpdateSetup}
              onReprojectForecast={handleReprojectForecast}
            />
          )}

          {activeTab === 'pnl_bs' && (
            <PnlBalanceSheetView
              setup={state.setup}
              pnlState={activePnlState}
              year2025Computed={computed.find((c) => c.tax_year === 2025) ?? computed[0]}
              year2026Computed={computed.find((c) => c.tax_year === 2026) ?? computed[1]}
              onUpdatePnlState={handleUpdatePnlState}
              onPushTo2026Schedule={handlePushPnlTo2026Schedule}
              onResetFrom2026Schedule={handleResetPnlFrom2026Schedule}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'cadence_forecaster' && (
            <TransactionCadenceView
              setup={state.setup}
              cadenceState={activeCadenceState}
              year2025Computed={computed.find((c) => c.tax_year === 2025) ?? computed[0]}
              year2026Computed={computed.find((c) => c.tax_year === 2026) ?? computed[1]}
              onUpdateCadenceState={handleUpdateCadenceState}
              onPushTo2026Schedule={handlePushCadenceTo2026Schedule}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'form1040' && (
            <Form1040View
              setup={state.setup}
              years={state.years}
              computed={computed}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              onUpdateYear={handleUpdateYear}
            />
          )}

          {activeTab === 'scorp' && (
            <SCorpView
              setup={state.setup}
              years={state.years}
              computed={computed}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              onUpdateYear={handleUpdateYear}
            />
          )}

          {activeTab === 'dbp' && (
            <DbpView
              setup={state.setup}
              years={state.years}
              computed={computed}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              onUpdateYear={handleUpdateYear}
            />
          )}

          {activeTab === 'multistate' && (
            <MultiStateView
              setup={state.setup}
              years={state.years}
              computed={computed}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              onUpdateYear={handleUpdateYear}
            />
          )}

          {activeTab === 'forms' && <FormsMapView forms={formsMap} />}

          {activeTab === 'scenarios' && (
            <ScenariosAiView
              state={state}
              baselineComputed={computed}
              issues={issues}
              onAdoptScenario={handleAdoptScenario}
            />
          )}
        </main>
      </div>

      {/* Annual Roll Forward Modal */}
      {showRollModal && state.years.length >= 2 && (
        <RollForwardModal
          year1={state.years[0]}
          year2={state.years[1]}
          year1Computed={computed[0]}
          year2Computed={computed[1]}
          nextYear6={state.years[state.years.length - 1].tax_year + 1}
          onClose={() => setShowRollModal(false)}
          onConfirmRoll={handleConfirmRoll}
        />
      )}
    </div>
  );
}

export default App;
