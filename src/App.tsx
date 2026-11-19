import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarRange,
  Compass,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Landmark,
  MapPin,
  Menu,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  PlannerState,
  ScenarioDefinition,
  SetupConfig,
  TaxYearRecord,
  WorkspaceTab,
} from './types/tax';
import {
  createInitialBaselineState,
  projectNextYear,
  rollWindowForward,
} from './engine/baseline';
import { calculateSixYearPlan } from './engine/taxEngine';
import { runGuardrailValidation } from './engine/validator';
import { buildFilingFormsMap } from './engine/formsMap';
import { HorizonView } from './components/HorizonView';
import { SetupView } from './components/SetupView';
import { Form1040View } from './components/Form1040View';
import { SCorpView } from './components/SCorpView';
import { DbpView } from './components/DbpView';
import { MultiStateView } from './components/MultiStateView';
import { FormsMapView } from './components/FormsMapView';
import { ScenariosAiView } from './components/ScenariosAiView';
import { RollForwardModal } from './components/RollForwardModal';

const STORAGE_KEY = 'rolling-tax-planner-state-v1';

function loadInitialState(): PlannerState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlannerState;
      if (parsed?.setup && Array.isArray(parsed?.years) && parsed.years.length === 6) {
        return parsed;
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
    setState((prev) => ({
      ...prev,
      setup: nextSetup,
    }));
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

  const handleResetBaseline = () => {
    const fresh = createInitialBaselineState();
    setState(fresh);
    setSelectedYear(fresh.setup.anchor_actuals_year);
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
          onClick={handleResetBaseline}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          Reset Sample Baseline
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="w-64 max-w-[80vw] h-full shadow-xl">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on Left, Single Primary CTA on Right */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
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
