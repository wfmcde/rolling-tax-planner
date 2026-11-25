import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CalendarRange,
  Compass,
  Download,
  FileSpreadsheet,
  FolderKanban,
  GitCompareArrows,
  Landmark,
  MapPin,
  Menu,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import type {
  CadenceForecasterState,
  GuardrailAcknowledgment,
  MultiProfileStore,
  NewProfileOptions,
  PlannerState,
  PlanningGoalGuardrail,
  PnlBalanceSheetState,
  PushToHorizonImpact,
  ScenarioDefinition,
  ScheduleViewConfig,
  SetupConfig,
  TaxProfileRecord,
  TaxYearRecord,
  WorkspaceProfileMode,
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
import {
  buildCpaProjectionCsv,
  calculatePnlBalanceSheet,
  createInitialPnlBalanceSheetState,
  type ComputedPnlBalanceSheet,
} from './engine/pnlBalanceSheet';
import { createInitialCadenceForecasterState } from './engine/cadenceEngine';
import { evaluateAllPlanningGoals, resolvePlanningGoals } from './engine/planningGoals';
import {
  addProfileToStore,
  buildFreshBlankUserRecord,
  buildFreshTestPersonaRecord,
  deleteProfileFromStore,
  duplicateProfileInStore,
  getActiveProfile,
  importProfilesFromJson,
  loadIsolatedSandboxProfile,
  loadMultiProfileStore,
  loadWorkspaceProfileMode,
  renameProfileInStore,
  sanitizeFilenameSegment,
  saveIsolatedSandboxProfile,
  saveMultiProfileStore,
  saveWorkspaceProfileMode,
  serializeAllProfilesBackup,
  serializeSingleProfileBackup,
  switchActiveProfileInStore,
  updateActiveProfileStateInStore,
} from './engine/profileStore';
import {
  addApportionmentState,
  applySetupApportionmentToYear,
  getActiveBusinessStates,
  getSetupStates,
  normalizeStateApportionmentConfig,
  replaceApportionmentStateCode,
  resolveStateApportionmentForYear,
  setYearStateApportionmentOverride,
  updateYearStateApportionmentSplit,
} from './utils/setupHelpers';
import { HorizonView } from './components/HorizonView';
import { SetupView } from './components/SetupView';
import { TransactionCadenceView } from './components/TransactionCadenceView';
import { Form1040View } from './components/Form1040View';
import { SCorpView } from './components/SCorpView';
import { DbpView } from './components/DbpView';
import { MultiStateView } from './components/MultiStateView';
import { FormsMapView } from './components/FormsMapView';
import { ScenariosAiView } from './components/ScenariosAiView';
import { RollForwardModal } from './components/RollForwardModal';
import { CpaPrintPackageModal } from './components/CpaPrintPackageModal';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { ProfilesManagerModal } from './components/ProfilesManagerModal';
import { exportShadowTaxReturnXlsx } from './utils/shadowReturnExport';

const TAB_LABELS: Record<WorkspaceTab, string> = {
  setup: 'Setup & Profile',
  horizon: 'Six-Year Horizon',
  dbp: 'DBP & Retirement',
  cadence_forecaster: 'Transaction Cadence Forecast',
  form1040: 'Form 1040 Return',
  scorp: 'S-Corp (1120-S)',
  multistate: 'Multi-State & PTE',
  forms: 'IRS Forms Map',
  scenarios: 'Scenarios & AI',
};

export function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceProfileMode>(() =>
    loadWorkspaceProfileMode()
  );
  const [profileStore, setProfileStore] = useState<MultiProfileStore>(() =>
    loadMultiProfileStore()
  );
  const [testPersonaRecord, setTestPersonaRecord] = useState<TaxProfileRecord>(() =>
    loadIsolatedSandboxProfile('test_persona')
  );
  const [blankUserRecord, setBlankUserRecord] = useState<TaxProfileRecord>(() =>
    loadIsolatedSandboxProfile('blank_user')
  );

  const myActiveProfile = useMemo(() => getActiveProfile(profileStore), [profileStore]);
  const activeProfile = useMemo(() => {
    if (workspaceMode === 'test_persona') return testPersonaRecord;
    if (workspaceMode === 'blank_user') return blankUserRecord;
    return myActiveProfile;
  }, [workspaceMode, testPersonaRecord, blankUserRecord, myActiveProfile]);

  const state = activeProfile.state;

  const setState = (
    nextOrUpdater: PlannerState | ((prev: PlannerState) => PlannerState)
  ) => {
    if (workspaceMode === 'test_persona') {
      setTestPersonaRecord((prevRec) => ({
        ...prevRec,
        updated_at: new Date().toISOString(),
        state:
          typeof nextOrUpdater === 'function' ? nextOrUpdater(prevRec.state) : nextOrUpdater,
      }));
      return;
    }
    if (workspaceMode === 'blank_user') {
      setBlankUserRecord((prevRec) => ({
        ...prevRec,
        updated_at: new Date().toISOString(),
        state:
          typeof nextOrUpdater === 'function' ? nextOrUpdater(prevRec.state) : nextOrUpdater,
      }));
      return;
    }
    setProfileStore((prevStore) =>
      updateActiveProfileStateInStore(prevStore, (prevState) =>
        typeof nextOrUpdater === 'function' ? nextOrUpdater(prevState) : nextOrUpdater
      )
    );
  };

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('horizon');
  const [selectedYear, setSelectedYear] = useState<number>(state.setup.anchor_actuals_year);
  const [showRollModal, setShowRollModal] = useState(false);
  const [showHorizonCpaModal, setShowHorizonCpaModal] = useState(false);
  const [profilesModalMode, setProfilesModalMode] = useState<'list' | 'create' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveWorkspaceProfileMode(workspaceMode);
  }, [workspaceMode]);

  useEffect(() => {
    saveMultiProfileStore(profileStore);
  }, [profileStore]);

  useEffect(() => {
    saveIsolatedSandboxProfile('test_persona', testPersonaRecord);
  }, [testPersonaRecord]);

  useEffect(() => {
    saveIsolatedSandboxProfile('blank_user', blankUserRecord);
  }, [blankUserRecord]);

  // Keep selectedYear valid whenever switching profiles or rolling the window
  useEffect(() => {
    if (!state.setup.forecast_years.includes(selectedYear)) {
      setSelectedYear(state.setup.anchor_actuals_year);
    }
  }, [state.setup.forecast_years, state.setup.anchor_actuals_year, selectedYear]);

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
      const businessChanged =
        prev.setup.business_name !== nextSetup.business_name ||
        prev.setup.business_ein !== nextSetup.business_ein;
      const statesChanged =
        prev.setup.home_state !== nextSetup.home_state ||
        prev.setup.secondary_state !== nextSetup.secondary_state ||
        prev.setup.multi_state_active !== nextSetup.multi_state_active;
      const apportionmentChanged =
        JSON.stringify(prev.setup.state_revenue_apportionment ?? null) !==
        JSON.stringify(nextSetup.state_revenue_apportionment ?? null);

      if (!termChanged && !businessChanged && !statesChanged && !apportionmentChanged) {
        return {
          ...prev,
          setup: nextSetup,
        };
      }

      const prevHomeState = (prev.setup.home_state ?? '').trim().toUpperCase();
      const prevSecondaryState = (prev.setup.secondary_state ?? '').trim().toUpperCase();
      const nextHomeState = (nextSetup.home_state ?? '').trim().toUpperCase();
      const nextSecondaryState = (nextSetup.secondary_state ?? '').trim().toUpperCase();
      const prevActiveStates = getActiveBusinessStates(prev.setup);

      // If Section 2 home/secondary state changed without an explicit apportionment edit, transfer split codes cleanly
      let effectiveNextSetup: SetupConfig = nextSetup;
      if (statesChanged && !apportionmentChanged) {
        if (prevHomeState !== nextHomeState) {
          effectiveNextSetup = replaceApportionmentStateCode(
            effectiveNextSetup,
            prevHomeState,
            nextHomeState
          );
        }
        if (prevSecondaryState !== nextSecondaryState) {
          effectiveNextSetup = replaceApportionmentStateCode(
            effectiveNextSetup,
            prevSecondaryState,
            nextSecondaryState
          );
        }
      }
      if (statesChanged || apportionmentChanged) {
        effectiveNextSetup = {
          ...effectiveNextSetup,
          state_revenue_apportionment: normalizeStateApportionmentConfig(
            effectiveNextSetup.state_revenue_apportionment,
            effectiveNextSetup
          ),
        };
      }

      const nextActiveStates = getActiveBusinessStates(effectiveNextSetup);
      const removedStates = new Set(
        prevActiveStates.filter((code) => !nextActiveStates.includes(code))
      );
      const termYear = effectiveNextSetup.dbp_planned_termination_year;

      const referenceDbpContrib =
        prev.years.find((y) => y.dbp_and_retirement.dbp_actual_contribution > 0)?.dbp_and_retirement
          .dbp_actual_contribution ?? 0;
      const referenceDbpMax =
        prev.years.find((y) => y.dbp_and_retirement.dbp_max_deductible_contribution > 0)
          ?.dbp_and_retirement.dbp_max_deductible_contribution ?? referenceDbpContrib;

      const updatedYears = prev.years.map((yr) => {
        let nextYr = yr;

        if (businessChanged) {
          nextYr = {
            ...nextYr,
            scorp_1120s: {
              ...nextYr.scorp_1120s,
              entity_name:
                nextSetup.business_name !== undefined
                  ? nextSetup.business_name
                  : nextYr.scorp_1120s.entity_name,
              entity_ein:
                nextSetup.business_ein !== undefined
                  ? nextSetup.business_ein
                  : nextYr.scorp_1120s.entity_ein,
            },
          };
        }

        if (statesChanged && !nextYr.is_locked_actuals) {
          const updatedFilings = [...nextYr.state_filings];
          if (nextHomeState) {
            const homeIdx = updatedFilings.findIndex(
              (sf) => sf.state_code === nextHomeState || sf.state_code === prevHomeState
            );
            if (homeIdx >= 0) {
              updatedFilings[homeIdx] = {
                ...updatedFilings[homeIdx],
                state_code: nextHomeState,
                residency_status: 'resident',
              };
            } else {
              updatedFilings.unshift({
                state_code: nextHomeState,
                residency_status: 'resident',
                residency_start_date: `${nextYr.tax_year}-01-01`,
                residency_end_date: `${nextYr.tax_year}-12-31`,
                residency_day_or_income_ratio: 1,
                state_return_type: `${nextHomeState} Resident Return`,
                state_apportionment_factor: nextSetup.multi_state_active && nextSecondaryState ? 0.5 : 1,
                state_pte_elected: nextSetup.has_pte,
                other_state_credits_claimed: 0,
                state_tax_withholding_and_estimates: 0,
              });
            }
          }
          if (nextSetup.multi_state_active && nextSecondaryState && nextSecondaryState !== nextHomeState) {
            const secIdx = updatedFilings.findIndex(
              (sf) => sf.state_code === nextSecondaryState || (prevSecondaryState && sf.state_code === prevSecondaryState && sf.state_code !== nextHomeState)
            );
            if (secIdx >= 0) {
              updatedFilings[secIdx] = {
                ...updatedFilings[secIdx],
                state_code: nextSecondaryState,
              };
            } else {
              updatedFilings.push({
                state_code: nextSecondaryState,
                residency_status: 'non_resident',
                residency_start_date: `${nextYr.tax_year}-01-01`,
                residency_end_date: `${nextYr.tax_year}-12-31`,
                residency_day_or_income_ratio: 0,
                state_return_type: `${nextSecondaryState} Non-Resident Return`,
                state_apportionment_factor: 0,
                state_pte_elected: false,
                other_state_credits_claimed: 0,
                state_tax_withholding_and_estimates: 0,
              });
            }
          }
          nextYr = {
            ...nextYr,
            state_filings: updatedFilings,
          };
        }

        if ((statesChanged || apportionmentChanged) && !nextYr.is_locked_actuals) {
          if (removedStates.size > 0 && nextYr.state_filings.length > 1) {
            const prunedFilings = nextYr.state_filings.filter(
              (sf) => !removedStates.has(sf.state_code) || sf.residency_status !== 'non_resident'
            );
            if (prunedFilings.length > 0) {
              nextYr = {
                ...nextYr,
                state_filings: prunedFilings,
              };
            }
          }
          nextYr = applySetupApportionmentToYear(nextYr, effectiveNextSetup);
        }

        if (!termChanged || nextYr.is_locked_actuals) return nextYr;

        if (termYear === null) {
          const restoredContrib =
            nextYr.dbp_and_retirement.dbp_actual_contribution > 0
              ? nextYr.dbp_and_retirement.dbp_actual_contribution
              : referenceDbpContrib;
          return {
            ...nextYr,
            dbp_and_retirement: {
              ...nextYr.dbp_and_retirement,
              dbp_status: 'active' as const,
              dbp_target_termination_year: 2099,
              dbp_max_deductible_contribution: Math.max(
                referenceDbpMax,
                nextYr.dbp_and_retirement.dbp_max_deductible_contribution
              ),
              dbp_actual_contribution: restoredContrib,
              rollover_amount: 0,
              rollover_source_type: 'None',
            },
          };
        }

        if (nextYr.tax_year > termYear) {
          return {
            ...nextYr,
            dbp_and_retirement: {
              ...nextYr.dbp_and_retirement,
              dbp_status: 'terminated' as const,
              dbp_target_termination_year: termYear,
              dbp_max_deductible_contribution: 0,
              dbp_actual_contribution: 0,
              rollover_amount: 0,
              rollover_source_type: 'None',
            },
          };
        }

        if (nextYr.tax_year === termYear) {
          const halfRef = Math.round(referenceDbpContrib * 0.5);
          const termContrib =
            nextYr.dbp_and_retirement.dbp_actual_contribution > 0
              ? Math.min(nextYr.dbp_and_retirement.dbp_actual_contribution, halfRef || nextYr.dbp_and_retirement.dbp_actual_contribution)
              : halfRef;
          return {
            ...nextYr,
            dbp_and_retirement: {
              ...nextYr.dbp_and_retirement,
              dbp_status: 'terminating' as const,
              dbp_target_termination_year: termYear,
              dbp_max_deductible_contribution: Math.max(
                referenceDbpMax,
                nextYr.dbp_and_retirement.dbp_max_deductible_contribution
              ),
              dbp_actual_contribution: termContrib,
              rollover_amount: nextYr.dbp_and_retirement.rollover_amount,
              rollover_source_type: 'Defined Benefit Plan Termination',
            },
          };
        }

        const activeContrib =
          nextYr.dbp_and_retirement.dbp_actual_contribution > 0
            ? nextYr.dbp_and_retirement.dbp_actual_contribution
            : referenceDbpContrib;
        return {
          ...nextYr,
          dbp_and_retirement: {
            ...nextYr.dbp_and_retirement,
            dbp_status: 'active' as const,
            dbp_target_termination_year: termYear,
            dbp_max_deductible_contribution: Math.max(
              referenceDbpMax,
              nextYr.dbp_and_retirement.dbp_max_deductible_contribution
            ),
            dbp_actual_contribution: activeContrib,
            rollover_amount: 0,
            rollover_source_type: 'None',
          },
        };
      });

      return {
        ...prev,
        setup: effectiveNextSetup,
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
    setState((prev) => {
      let nextSetup = prev.setup;
      const nextYears = prev.years.map((prevYr) => {
        if (prevYr.tax_year !== taxYear) return prevYr;
        const rawUpdatedYr = updater(prevYr);
        const capContribChanged =
          rawUpdatedYr.scorp_1120s.capital_contributions !==
          prevYr.scorp_1120s.capital_contributions;
        const updatedYr: TaxYearRecord = capContribChanged
          ? {
              ...rawUpdatedYr,
              scorp_1120s: {
                ...rawUpdatedYr.scorp_1120s,
                capital_contributions_source:
                  rawUpdatedYr.scorp_1120s.capital_contributions_source ?? 'manual',
              },
            }
          : rawUpdatedYr;

        if (!updatedYr.is_locked_actuals) {
          const prevActiveStates = getActiveBusinessStates(prev.setup);
          const revChanged =
            updatedYr.scorp_1120s.ca_revenue !== prevYr.scorp_1120s.ca_revenue ||
            updatedYr.scorp_1120s.az_revenue !== prevYr.scorp_1120s.az_revenue;

          const filingsFactorsChanged =
            updatedYr.state_filings.length !== prevYr.state_filings.length ||
            updatedYr.state_filings.some((sf, idx) => {
              const prevSf = prevYr.state_filings[idx];
              return (
                !prevSf ||
                prevSf.state_code !== sf.state_code ||
                Math.abs(prevSf.state_apportionment_factor - sf.state_apportionment_factor) > 0.0001
              );
            });

          if (revChanged && prevActiveStates.length >= 2) {
            const totalRev =
              Math.max(0, updatedYr.scorp_1120s.ca_revenue) +
              Math.max(0, updatedYr.scorp_1120s.az_revenue);
            if (totalRev > 0) {
              const nextPrimaryPct =
                Math.round((Math.max(0, updatedYr.scorp_1120s.ca_revenue) / totalRev) * 1000) /
                10;
              nextSetup = setYearStateApportionmentOverride(
                prev.setup,
                taxYear,
                nextPrimaryPct
              );
              return applySetupApportionmentToYear(updatedYr, nextSetup);
            }
          } else if (filingsFactorsChanged && updatedYr.state_filings.length > 0) {
            let workingSetup = prev.setup;
            // Register any newly added jurisdiction from Multi-State Sourcing into Setup's state list
            for (const sf of updatedYr.state_filings) {
              if (!getActiveBusinessStates(workingSetup).includes(sf.state_code)) {
                workingSetup = addApportionmentState(workingSetup, sf.state_code);
              }
            }
            const activeCodes = getActiveBusinessStates(workingSetup);
            if (activeCodes.length >= 2) {
              const splitMap: Record<string, number> = {};
              let sumPct = 0;
              for (const code of activeCodes) {
                const match = updatedYr.state_filings.find((sf) => sf.state_code === code);
                const pct = match ? Math.round(match.state_apportionment_factor * 1000) / 10 : 0;
                splitMap[code] = pct;
                sumPct += pct;
              }
              if (sumPct > 0) {
                nextSetup = updateYearStateApportionmentSplit(workingSetup, taxYear, splitMap);
                return applySetupApportionmentToYear(updatedYr, nextSetup);
              }
              nextSetup = workingSetup;
            }
          }
        }

        return updatedYr;
      });

      return {
        ...prev,
        setup: nextSetup,
        years: nextYears,
      };
    });
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
    return createInitialPnlBalanceSheetState(
      yr2026,
      computed[0]?.scorp_out.stock_basis_ending ?? 0,
      state.setup
    );
  }, [state.pnl_balance_sheet, state.years, state.setup, computed]);

  const handleUpdatePnlState = (
    updater: (prev: PnlBalanceSheetState) => PnlBalanceSheetState
  ) => {
    setState((prev) => {
      const yr2026 = prev.years.find((y) => y.tax_year === 2026) ?? prev.years[1];
      const base =
        prev.pnl_balance_sheet ??
        createInitialPnlBalanceSheetState(
          yr2026,
          computed[0]?.scorp_out.stock_basis_ending ?? 0,
          prev.setup
        );
      const nextPnl = updater(base);

      // Keep matching cadence_forecaster balance sheet fields in sync when edited from 1120-S Schedule L
      let nextCadence = prev.cadence_forecaster;
      if (nextCadence && nextCadence.projection_year === nextPnl.projection_year) {
        const bsPatch: Partial<CadenceForecasterState['balance_sheet']> = {};
        const prevBs = base.balance_sheet;
        const currBs = nextPnl.balance_sheet;
        if (currBs.operating_cash_beg !== prevBs.operating_cash_beg) {
          bsPatch.operating_cash_beg = currBs.operating_cash_beg;
        }
        if (currBs.operating_cash_ye_override !== prevBs.operating_cash_ye_override) {
          bsPatch.operating_cash_ye_override = currBs.operating_cash_ye_override;
        }
        if (currBs.cc_ap_ye !== prevBs.cc_ap_ye) {
          bsPatch.cc_ap_ye = currBs.cc_ap_ye;
        }
        if (currBs.pension_payable_ye !== prevBs.pension_payable_ye) {
          bsPatch.pension_payable_ye = currBs.pension_payable_ye;
        }
        if (Object.keys(bsPatch).length > 0) {
          nextCadence = {
            ...nextCadence,
            balance_sheet: {
              ...nextCadence.balance_sheet,
              ...bsPatch,
            },
          };
        }
      }

      return {
        ...prev,
        pnl_balance_sheet: nextPnl,
        cadence_forecaster: nextCadence,
      };
    });
  };

  const activeCadenceState: CadenceForecasterState = useMemo(() => {
    if (state.cadence_forecaster) return state.cadence_forecaster;
    return createInitialCadenceForecasterState(
      computed[0]?.scorp_out.stock_basis_ending ?? 0,
      [],
      state.setup
    );
  }, [state.cadence_forecaster, state.setup, computed]);

  const handleUpdateCadenceState = (
    updater: (prev: CadenceForecasterState) => CadenceForecasterState
  ) => {
    setState((prev) => {
      const base =
        prev.cadence_forecaster ??
        createInitialCadenceForecasterState(
          computed[0]?.scorp_out.stock_basis_ending ?? 0,
          [],
          prev.setup
        );
      return {
        ...prev,
        cadence_forecaster: updater(base),
      };
    });
  };

  const handleSyncGlCapitalContributionsByYear = (byYear: Record<number, number>) => {
    const entries = Object.entries(byYear)
      .map(([yrStr, amt]) => [Number(yrStr), Math.round(Math.max(0, amt))] as const)
      .filter(([yr]) => Number.isFinite(yr));
    if (entries.length === 0) return;

    const mapByYear = new Map<number, number>(entries);
    setState((prev) => {
      const nextYears = prev.years.map((yr) => {
        if (yr.is_locked_actuals) return yr;
        if (!mapByYear.has(yr.tax_year)) return yr;
        const addedAmt = mapByYear.get(yr.tax_year) ?? 0;
        return {
          ...yr,
          scorp_1120s: {
            ...yr.scorp_1120s,
            capital_contributions: addedAmt,
            capital_contributions_source: 'gl_import' as const,
          },
        };
      });

      const nextPnlBalanceSheet =
        prev.pnl_balance_sheet && mapByYear.has(prev.pnl_balance_sheet.projection_year)
          ? {
              ...prev.pnl_balance_sheet,
              balance_sheet: {
                ...prev.pnl_balance_sheet.balance_sheet,
                capital_contributions_ytd:
                  mapByYear.get(prev.pnl_balance_sheet.projection_year) ??
                  prev.pnl_balance_sheet.balance_sheet.capital_contributions_ytd,
              },
            }
          : prev.pnl_balance_sheet;

      return {
        ...prev,
        years: nextYears,
        pnl_balance_sheet: nextPnlBalanceSheet,
      };
    });
  };

  const activeProjectionYear =
    state.pnl_balance_sheet?.projection_year ??
    state.cadence_forecaster?.projection_year ??
    state.setup.current_tax_year;

  const activePlanningGoals = useMemo(
    () => resolvePlanningGoals(state.planning_goals, state.setup, activeProjectionYear),
    [state.planning_goals, state.setup, activeProjectionYear]
  );

  const handleUpdatePlanningGoals = (
    updater: (prev: PlanningGoalGuardrail[]) => PlanningGoalGuardrail[]
  ) => {
    setState((prev) => {
      const projYear =
        prev.pnl_balance_sheet?.projection_year ??
        prev.cadence_forecaster?.projection_year ??
        prev.setup.current_tax_year;
      return {
        ...prev,
        planning_goals: updater(resolvePlanningGoals(prev.planning_goals, prev.setup, projYear)),
      };
    });
  };

  const applyProjected2026Years = (
    prev: PlannerState,
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ): TaxYearRecord[] => {
    const targetYear = pnlSnapshot.projection_year || 2026;
    const { primaryStateCode, secondaryStateCode, hasSecondaryState } = getSetupStates(prev.setup);
    const resolvedTarget = resolveStateApportionmentForYear(prev.setup, targetYear);
    const activeCodes =
      resolvedTarget.activeStates.length > 0
        ? resolvedTarget.activeStates
        : primaryStateCode
        ? hasSecondaryState && secondaryStateCode
          ? [primaryStateCode, secondaryStateCode]
          : [primaryStateCode]
        : [];
    const hasSecond = Boolean(
      prev.setup.multi_state_active || hasSecondaryState || activeCodes.length >= 2
    );

    const targetTotalRev = Math.round(Math.max(0, pnlComp.totalRevenue.projected));
    const caRev = hasSecond
      ? Math.min(targetTotalRev, Math.round(Math.max(0, pnlComp.lines.ca_revenue.projected)))
      : targetTotalRev;
    const azRev = hasSecond ? Math.max(0, targetTotalRev - caRev) : 0;
    const totalRev = caRev + azRev;
    const caApp = totalRev > 0 ? caRev / totalRev : 0;
    const azApp = totalRev > 0 ? azRev / totalRev : 0;

    const targetTotalW2 = Math.round(Math.max(0, pnlComp.totalCompensation.projected));
    const billW2 = Math.min(
      targetTotalW2,
      Math.round(Math.max(0, pnlComp.lines.bill_officer_w2.projected))
    );
    const debraW2 = Math.max(0, targetTotalW2 - billW2);
    const totalW2 = billW2 + debraW2;
    const dbpContrib = Math.round(Math.max(0, pnlComp.lines.dbp_contribution.projected));
    const emp401kProjected = Math.round(Math.max(0, pnlComp.lines.employer_401k.projected));
    const sehiProjected = Math.round(Math.max(0, pnlComp.lines.sehi_medicare.projected));
    const drawsTotal = Math.round(Math.max(0, pnlComp.projectedDrawsTotal));
    const capContrib = Math.round(Math.max(0, pnlComp.projectedCapitalContributionsTotal));
    const nondedMeals = Math.round(Math.max(0, pnlComp.mealsNondeductible50.projected));
    const schedKInterest = Math.round(Math.max(0, pnlComp.scheduleKInterest.projected));

    const pCode = activeCodes[0] || primaryStateCode || prev.years[0]?.state_filings[0]?.state_code || 'HOME';
    const sCode = activeCodes[1] || secondaryStateCode || prev.years[0]?.state_filings[1]?.state_code || 'OTHER';
    const nextBreakdown = hasSecond
      ? activeCodes.map((code, idx) => ({
          state_code: code,
          apportionment_percent:
            idx === 0
              ? Number((caApp * 100).toFixed(2))
              : idx === 1
              ? Number((azApp * 100).toFixed(2))
              : 0,
        }))
      : primaryStateCode
      ? [{ state_code: primaryStateCode, apportionment_percent: 100 }]
      : [];

    const rawOpExExclPayroll = Math.round(
      Math.max(0, pnlComp.totalOperatingExpensesExclPayroll.projected)
    );
    const payrollTaxesProjected = Math.round(
      Math.max(0, pnlComp.lines.payroll_taxes.projected)
    );
    // Absorb at most +/-$1 of cent-rounding sum drift into OpEx so rounded K-1 OBI ties to $0
    const targetObi = Math.round(pnlComp.ordinaryBusinessIncome.projected);
    const impliedObi =
      totalRev -
      totalW2 -
      sehiProjected -
      payrollTaxesProjected -
      dbpContrib -
      emp401kProjected -
      rawOpExExclPayroll;
    const obiCentDrift = impliedObi - targetObi;
    const opExExclPayroll =
      Math.abs(obiCentDrift) <= 2 && rawOpExExclPayroll + obiCentDrift >= 0
        ? rawOpExExclPayroll + obiCentDrift
        : rawOpExExclPayroll;

    return prev.years.map((yr) => {
      if (yr.tax_year !== targetYear) return yr;
      return {
        ...yr,
        form_1040: {
          ...yr.form_1040,
          w2_wages_total: totalW2,
          health_insurance_premiums: sehiProjected,
          sehi_medicare_override: sehiProjected,
        },
        scorp_1120s: {
          ...yr.scorp_1120s,
          ca_revenue: caRev,
          az_revenue: azRev,
          gross_receipts_revenue: totalRev,
          operating_expenses: opExExclPayroll,
          operating_expenses_override:
            prev.setup.assumptions.opex_scaling_mode === 'revenue_proportional'
              ? opExExclPayroll
              : null,
          payroll_taxes_input: payrollTaxesProjected,
          use_detailed_1120s_deductions: false,
          bill_w2_wages: billW2,
          debra_w2_wages: debraW2,
          officer_w2_wages: totalW2,
          scorp_distributions_total: drawsTotal,
          capital_contributions: capContrib,
          capital_contributions_source:
            capContrib > 0
              ? yr.scorp_1120s.capital_contributions_source ?? 'gl_import'
              : yr.scorp_1120s.capital_contributions_source,
          schedule_k_interest_income: schedKInterest,
          schedule_k_nondeductible_expenses: nondedMeals,
          state_sourcing_breakdown: nextBreakdown,
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
          sf.state_code === pCode
            ? { ...sf, state_apportionment_factor: hasSecond ? caApp : 1 }
            : hasSecond && sf.state_code === sCode
            ? { ...sf, state_apportionment_factor: azApp }
            : hasSecond && activeCodes.includes(sf.state_code)
            ? { ...sf, state_apportionment_factor: 0 }
            : sf
        ),
      };
    });
  };

  const syncSetupSplitFromPnlPush = (
    prevSetup: SetupConfig,
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ): SetupConfig => {
    const targetYear = pnlSnapshot.projection_year || 2026;
    const caRev = Math.round(Math.max(0, pnlComp.lines.ca_revenue.projected));
    const azRev = Math.round(Math.max(0, pnlComp.lines.az_revenue.projected));
    const totalRev = caRev + azRev;
    if (totalRev <= 0 || !prevSetup.multi_state_active) return prevSetup;
    const resolved = resolveStateApportionmentForYear(prevSetup, targetYear);
    if (!resolved.hasSecondary) return prevSetup;
    const nextPrimaryPct = Math.round((caRev / totalRev) * 1000) / 10;
    return setYearStateApportionmentOverride(prevSetup, targetYear, nextPrimaryPct);
  };

  const computePushImpact = (
    prevState: PlannerState,
    nextSetup: SetupConfig,
    nextYears: TaxYearRecord[],
    targetYear: number
  ): PushToHorizonImpact => {
    const prevComputedYear = computed.find((c) => c.tax_year === targetYear);
    const nextComputed = calculateSixYearPlan(nextSetup, nextYears);
    const nextComputedYear = nextComputed.find((c) => c.tax_year === targetYear);
    const prevK1 = prevComputedYear?.scorp_out.ordinary_business_income_1120s ?? 0;
    const newK1 = nextComputedYear?.scorp_out.ordinary_business_income_1120s ?? 0;
    const prevAllInTax = prevComputedYear?.total_all_in_tax ?? 0;
    const newAllInTax = nextComputedYear?.total_all_in_tax ?? 0;
    void prevState;
    return {
      taxYear: targetYear,
      prevK1,
      newK1,
      k1Delta: newK1 - prevK1,
      prevAllInTax,
      newAllInTax,
      taxDelta: newAllInTax - prevAllInTax,
    };
  };

  const handleSaveGuardrailAck = (ack: GuardrailAcknowledgment) => {
    setState((prev) => ({
      ...prev,
      guardrail_acknowledgments: {
        ...(prev.guardrail_acknowledgments ?? {}),
        [ack.key]: ack,
      },
    }));
  };

  const handleReopenGuardrailAck = (ackKey: string) => {
    setState((prev) => {
      const nextAcks = { ...(prev.guardrail_acknowledgments ?? {}) };
      delete nextAcks[ackKey];
      return {
        ...prev,
        guardrail_acknowledgments: nextAcks,
      };
    });
  };

  const handlePushCadenceTo2026Schedule = (
    pnlSnapshot: PnlBalanceSheetState,
    pnlComp: ComputedPnlBalanceSheet
  ): PushToHorizonImpact => {
    const targetYear = pnlSnapshot.projection_year || state.setup.current_tax_year || 2026;
    const nextSetup = syncSetupSplitFromPnlPush(state.setup, pnlSnapshot, pnlComp);
    const nextYears = applyProjected2026Years({ ...state, setup: nextSetup }, pnlSnapshot, pnlComp);
    const impact = computePushImpact(state, nextSetup, nextYears, targetYear);
    setState((prev) => {
      const baseCadence =
        prev.cadence_forecaster ??
        createInitialCadenceForecasterState(
          computed[0]?.scorp_out.stock_basis_ending ?? 0,
          [],
          prev.setup
        );
      const updatedSetup = syncSetupSplitFromPnlPush(prev.setup, pnlSnapshot, pnlComp);
      const pushedAt = new Date().toISOString();
      return {
        ...prev,
        setup: updatedSetup,
        years: applyProjected2026Years({ ...prev, setup: updatedSetup }, pnlSnapshot, pnlComp),
        pnl_balance_sheet: {
          ...pnlSnapshot,
          last_pushed_at: pushedAt,
        },
        cadence_forecaster: {
          ...baseCadence,
          balance_sheet: {
            ...baseCadence.balance_sheet,
            capital_contributions_ytd: pnlSnapshot.balance_sheet.capital_contributions_ytd,
            capital_contributions_remaining:
              pnlSnapshot.balance_sheet.capital_contributions_remaining,
          },
          last_pushed_at: pushedAt,
        },
      };
    });
    return impact;
  };

  const triggerJsonDownload = (jsonText: string, filename: string) => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProfilesJsonText = (
    rawText: string
  ): { ok: boolean; message: string } => {
    try {
      const result = importProfilesFromJson(rawText, profileStore);
      setProfileStore(result.nextStore);
      const msg =
        result.importedCount === 1
          ? `Imported profile "${result.importedNames[0]}" and switched to it.`
          : `Imported ${result.importedCount} profiles from backup.`;
      setImportNotice({ type: 'ok', text: msg });
      return { ok: true, message: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to import JSON file.';
      setImportNotice({ type: 'error', text: msg });
      return { ok: false, message: msg };
    }
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      handleImportProfilesJsonText(text);
    } catch (err) {
      setImportNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to read JSON file.',
      });
    }
  };

  const handleResetBaseline = () => {
    const fresh = createInitialBaselineState();
    fresh.cadence_forecaster = createInitialCadenceForecasterState(0, [], fresh.setup);
    setState(fresh);
    setSelectedYear(fresh.setup.anchor_actuals_year);
    setImportNotice(null);
    setActiveTab('horizon');
  };

  const handleExportSingleProfile = (profile: TaxProfileRecord) => {
    const safeName = sanitizeFilenameSegment(profile.name, 'tax-profile');
    triggerJsonDownload(
      serializeSingleProfileBackup(profile),
      `${safeName}-${profile.state.setup.forecast_years[0]}-${profile.state.setup.forecast_years[5]}.json`
    );
  };

  const handleExportAllProfiles = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    triggerJsonDownload(
      serializeAllProfilesBackup(profileStore),
      `rolling-tax-planner-all-profiles-${stamp}.json`
    );
  };

  const [exportingShadowReturn, setExportingShadowReturn] = useState(false);

  const handleExportJson = () => {
    handleExportSingleProfile(activeProfile);
  };

  const handleExportShadowReturn = async () => {
    if (exportingShadowReturn) return;
    setExportingShadowReturn(true);
    try {
      const targetYear =
        selectedYear === 2025 ? state.setup.current_tax_year : selectedYear;
      const filename = await exportShadowTaxReturnXlsx({
        setup: state.setup,
        years: state.years,
        computed,
        selectedYear: targetYear,
        pnlState: activePnlState,
      });
      setImportNotice({
        type: 'ok',
        text: `Downloaded ${filename} (8 formula-driven tabs).`,
      });
    } catch (err) {
      setImportNotice({
        type: 'error',
        text:
          err instanceof Error
            ? `Excel export failed: ${err.message}`
            : 'Excel export failed.',
      });
    } finally {
      setExportingShadowReturn(false);
    }
  };

  const handleSwitchWorkspaceMode = (mode: WorkspaceProfileMode) => {
    setWorkspaceMode(mode);
    setImportNotice(null);
  };

  const handleResetSandboxMode = (mode: 'test_persona' | 'blank_user') => {
    if (mode === 'test_persona') {
      setTestPersonaRecord(buildFreshTestPersonaRecord());
    } else {
      setBlankUserRecord(buildFreshBlankUserRecord());
    }
  };

  const handleSwitchProfile = (profileId: string) => {
    setWorkspaceMode('my_profile');
    setProfileStore((prev) => switchActiveProfileInStore(prev, profileId));
    setImportNotice(null);
  };

  const handleCreateProfile = (options: NewProfileOptions) => {
    setWorkspaceMode('my_profile');
    setProfileStore((prev) => addProfileToStore(prev, options));
    setImportNotice({ type: 'ok', text: `Created profile "${options.name}".` });
    setActiveTab('setup');
  };

  const handleDuplicateProfile = (profileId: string) => {
    setWorkspaceMode('my_profile');
    setProfileStore((prev) => duplicateProfileInStore(prev, profileId, undefined, true));
  };

  const handleRenameProfile = (
    profileId: string,
    updates: { name: string; entity_name?: string; entity_ein?: string; notes?: string }
  ) => {
    setProfileStore((prev) => renameProfileInStore(prev, profileId, updates));
  };

  const handleDeleteProfile = (profileId: string) => {
    setProfileStore((prev) => deleteProfileFromStore(prev, profileId));
  };

  const navSections: {
    title: string;
    items: {
      id: WorkspaceTab;
      label: string;
      icon: React.FC<{ className?: string }>;
      visible: boolean;
      count?: number;
    }[];
  }[] = useMemo(
    () => [
      {
        title: 'Workspace',
        items: [
          { id: 'setup', label: 'Setup & Profile', icon: SlidersHorizontal, visible: true },
        ],
      },
      {
        title: 'Planning & Strategy',
        items: [
          { id: 'horizon', label: 'Six-Year Horizon', icon: CalendarRange, visible: true },
          {
            id: 'dbp',
            label: 'DBP & Retirement',
            icon: Landmark,
            visible:
              state.setup.has_dbp || state.setup.has_401k_or_ira || state.setup.has_annuity,
          },
          {
            id: 'cadence_forecaster',
            label: 'Transaction Cadence Forecast',
            icon: CalendarClock,
            visible: state.setup.has_scorp,
          },
        ],
      },
      {
        title: 'Tax Forms & Verification',
        items: [
          { id: 'form1040', label: 'Form 1040', icon: FileSpreadsheet, visible: true },
          {
            id: 'scorp',
            label: 'S-Corp (1120-S)',
            icon: Building2,
            visible: state.setup.has_scorp,
          },
          {
            id: 'multistate',
            label: 'Multi-State & PTE',
            icon: MapPin,
            visible:
              state.setup.multi_state_active ||
              state.setup.residency_change_active ||
              state.setup.has_pte,
          },
          {
            id: 'forms',
            label: 'IRS Forms Map',
            icon: Compass,
            visible: true,
            count: formsMap.length,
          },
          { id: 'scenarios', label: 'Scenarios & AI', icon: GitCompareArrows, visible: true },
        ],
      },
    ],
    [state.setup, formsMap.length]
  );

  const navItems = useMemo(
    () => navSections.flatMap((section) => section.items),
    [navSections]
  );

  // Redirect away from a tab if the active profile or module checklist hides it
  useEffect(() => {
    const activeItem = navItems.find((i) => i.id === activeTab);
    if (!activeItem || !activeItem.visible) {
      setActiveTab('horizon');
    }
  }, [activeTab, navItems]);

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

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4" aria-label="Primary modules">
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) => item.visible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.title} className="space-y-0.5">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </div>
              {visibleItems.map((item) => {
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
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            setProfilesModalMode('list');
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-teal-900 bg-teal-50/70 hover:bg-teal-100/70 border border-teal-200/80 rounded-md transition-colors whitespace-nowrap"
        >
          <span className="flex items-center gap-2">
            <FolderKanban className="w-3.5 h-3.5 text-teal-800" />
            Profiles Manager
          </span>
          <span className="font-mono text-[11px] text-teal-800">
            {profileStore.profiles.length}
          </span>
        </button>
        <button
          type="button"
          onClick={handleExportShadowReturn}
          disabled={exportingShadowReturn}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
          <span className="truncate">
            {exportingShadowReturn ? 'Generating Excel…' : 'Shadow Tax Return (.xlsx)'}
          </span>
        </button>
        <button
          type="button"
          onClick={handleExportJson}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 text-slate-400" />
          Export Profile JSON
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5 text-slate-400" />
          Import Profile / Backup
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
        {/* Unified Sticky Top Shell: Testing Mode Safety Banner + Main Header */}
        <div className="no-print sticky top-0 z-20">
          {workspaceMode !== 'my_profile' && (
            <div
              role="status"
              aria-live="polite"
              className="bg-amber-50 border-b border-amber-300 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-200/80 text-[10px] font-bold uppercase tracking-wider text-amber-950">
                  {workspaceMode === 'test_persona' ? 'Test Persona' : 'Blank User'}
                </span>
                <span className="font-semibold text-amber-950">
                  Testing Mode Active — Your saved profile is untouched
                </span>
                <span className="hidden sm:inline text-amber-800/90">
                  ({workspaceMode === 'test_persona'
                    ? [
                        [state.setup.primary_name, state.setup.spouse_name]
                          .map((s) => s?.trim())
                          .filter(Boolean)
                          .join(' & '),
                        state.setup.home_state,
                        state.setup.business_name?.trim(),
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Synthetic test persona'
                    : 'Empty $0 day-one onboarding baseline'})
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleResetSandboxMode(workspaceMode)}
                  className="px-2.5 py-1 text-[11px] font-medium text-amber-900 bg-white border border-amber-300 rounded hover:bg-amber-100/70 transition-colors whitespace-nowrap"
                >
                  Reset Sandbox
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchWorkspaceMode('my_profile')}
                  className="px-3 py-1 text-[11px] font-semibold text-white bg-teal-800 rounded hover:bg-teal-900 transition-colors whitespace-nowrap"
                >
                  Return to My Profile
                </button>
              </div>
            </div>
          )}

          {/* Top Bar: Profile Switcher + Breadcrumb on Left, Primary CTA on Right */}
          <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation"
                className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
              >
                <Menu className="w-5 h-5" />
              </button>

              <ProfileSwitcher
                profiles={profileStore.profiles}
                activeProfile={activeProfile}
                onSwitchProfile={handleSwitchProfile}
                onOpenNewProfile={() => setProfilesModalMode('create')}
                onOpenManageProfiles={() => setProfilesModalMode('list')}
              />

              <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 truncate pl-2 border-l border-slate-200">
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
        </div>

        {/* Active Module Viewport (keyed by workspaceMode + activeProfile.id to guarantee zero state bleed) */}
        <main
          key={`${workspaceMode}:${activeProfile.id}`}
          className={
            activeTab === 'cadence_forecaster' || activeTab === 'dbp'
              ? 'flex-1 px-3 py-4 sm:px-4 sm:py-5 lg:px-5 lg:py-5 max-w-[1600px] w-full mx-auto'
              : 'flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto'
          }
        >
          {activeTab === 'horizon' && (
            <HorizonView
              setup={state.setup}
              years={state.years}
              computed={computed}
              issues={issues}
              guardrailAcknowledgments={state.guardrail_acknowledgments ?? {}}
              archivedYears={state.archived_years}
              selectedYear={selectedYear}
              scheduleView={state.schedule_view}
              onUpdateSetup={handleUpdateSetup}
              onUpdateScheduleView={handleUpdateScheduleView}
              onUpdateYear={handleUpdateYear}
              onSaveGuardrailAck={handleSaveGuardrailAck}
              onReopenGuardrailAck={handleReopenGuardrailAck}
              onSelectYear={(yr, nav) => {
                setSelectedYear(yr);
                if (nav) setActiveTab(nav);
              }}
              onNavigate={setActiveTab}
              onOpenCpaPackage={() => setShowHorizonCpaModal(true)}
              onExportShadowReturn={handleExportShadowReturn}
              exportingShadowReturn={exportingShadowReturn}
            />
          )}

          {activeTab === 'setup' && (
            <SetupView
              setup={state.setup}
              workspaceMode={workspaceMode}
              onSwitchWorkspaceMode={handleSwitchWorkspaceMode}
              onResetSandboxMode={handleResetSandboxMode}
              onUpdateSetup={handleUpdateSetup}
              onReprojectForecast={handleReprojectForecast}
            />
          )}

          {activeTab === 'cadence_forecaster' && (
            <TransactionCadenceView
              setup={state.setup}
              cadenceState={activeCadenceState}
              planningGoals={activePlanningGoals}
              issues={issues}
              guardrailAcknowledgments={state.guardrail_acknowledgments ?? {}}
              year2025Computed={computed.find((c) => c.tax_year === 2025) ?? computed[0]}
              year2026Computed={
                computed.find((c) => c.tax_year === state.setup.current_tax_year) ?? computed[1]
              }
              computedYears={computed}
              onUpdateCadenceState={handleUpdateCadenceState}
              onSyncGlCapitalContributionsByYear={handleSyncGlCapitalContributionsByYear}
              onUpdatePlanningGoals={handleUpdatePlanningGoals}
              onPushTo2026Schedule={handlePushCadenceTo2026Schedule}
              onNavigate={setActiveTab}
              onExportShadowReturn={handleExportShadowReturn}
              exportingShadowReturn={exportingShadowReturn}
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
              onUpdateSetup={handleUpdateSetup}
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
              pnlState={activePnlState}
              onUpdatePnlState={handleUpdatePnlState}
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
              onUpdateSetup={handleUpdateSetup}
              onApplyPresetState={(nextSetup, nextYears) =>
                setState((prev) => ({
                  ...prev,
                  setup: nextSetup,
                  years: nextYears,
                }))
              }
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

      {/* Horizon Direct CPA Print Package Modal */}
      {showHorizonCpaModal && (() => {
        const y25 = computed.find((c) => c.tax_year === 2025) ?? computed[0];
        const y26 = computed.find((c) => c.tax_year === state.setup.current_tax_year) ?? computed[1];
        const horizonPnlComp = calculatePnlBalanceSheet(activePnlState, y25, y26, state.setup);
        const entityName =
          state.setup.business_name?.trim() ||
          y26?.scorp_in.entity_name ||
          y25?.scorp_in.entity_name ||
          'Business Entity';
        const entityEin =
          state.setup.business_ein?.trim() ||
          y26?.scorp_in.entity_ein ||
          y25?.scorp_in.entity_ein ||
          '';
        const evaluatedGoals = evaluateAllPlanningGoals(
          activePlanningGoals,
          horizonPnlComp,
          activePnlState,
          state.setup,
          y26
        );
        const horizonReportMeta = {
          moduleName: 'Six-Year Tax Horizon & CPA Package',
          sourceMode: 'Working P&L Projection + Six-Year Tax Engine',
          activeGoals: evaluatedGoals,
        };
        const handleDownloadHorizonCsv = () => {
          const csv = buildCpaProjectionCsv(
            state.setup,
            activePnlState,
            horizonPnlComp,
            entityName,
            entityEin,
            horizonReportMeta,
            computed
          );
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const safeEntity =
            entityName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'CPA_Report';
          a.download = `${safeEntity}_${activePnlState.projection_year}_CPA_Horizon_Package.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };
        return (
          <CpaPrintPackageModal
            setup={state.setup}
            pnlState={activePnlState}
            computed={horizonPnlComp}
            computedYears={computed}
            entityName={entityName}
            entityEin={entityEin}
            reportMeta={horizonReportMeta}
            issues={issues}
            guardrailAcknowledgments={state.guardrail_acknowledgments ?? {}}
            onDownloadCsv={handleDownloadHorizonCsv}
            onExportShadowReturn={handleExportShadowReturn}
            exportingShadowReturn={exportingShadowReturn}
            onClose={() => setShowHorizonCpaModal(false)}
          />
        );
      })()}

      {/* Multi-Profile Manager & New Profile Modal */}
      {profilesModalMode !== null && (
        <ProfilesManagerModal
          profiles={profileStore.profiles}
          activeProfileId={activeProfile.id}
          initialMode={profilesModalMode}
          onClose={() => setProfilesModalMode(null)}
          onSwitchProfile={handleSwitchProfile}
          onCreateProfile={handleCreateProfile}
          onDuplicateProfile={handleDuplicateProfile}
          onRenameProfile={handleRenameProfile}
          onDeleteProfile={handleDeleteProfile}
          onExportSingleProfile={handleExportSingleProfile}
          onExportAllProfiles={handleExportAllProfiles}
          onImportProfilesJson={handleImportProfilesJsonText}
        />
      )}
    </div>
  );
}

export default App;
