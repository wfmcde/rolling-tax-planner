import React, { useMemo, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  Info,
  Lock,
  Pencil,
  Printer,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import type {
  ArchivedActualsRecord,
  ComputedTaxYear,
  GuardrailAckStatus,
  GuardrailAcknowledgment,
  ScheduleViewConfig,
  SetupConfig,
  SsYearMode,
  TaxYearRecord,
  ValidationIssue,
  WorkspaceTab,
} from '../types/tax';
import {
  ALL_SCHEDULE_ITEM_IDS,
  MASTER_SCHEDULE_CATALOG,
  SCHEDULE_SECTIONS,
  getScheduleRowLabel,
  type CellTone,
  type ScheduleEditField,
} from '../engine/scheduleCatalog';
import { isDefaultSeedSetup } from '../data/profiles';
import {
  GUARDRAIL_ACK_STATUS_OPTIONS,
  formatReasonableCompExplanationSummary,
  getGuardrailAckStatusLabel,
  syncReasonableCompNoteText,
} from '../engine/validator';
import { setIrmaaThresholdOverride } from '../engine/irmaa';
import {
  formatCompactCurrency,
  formatCurrency,
  formatFilingStatus,
  formatPercent,
} from '../utils/format';
import {
  MONTH_SHORT_NAMES,
  getPersonBirthMonth,
  updateProfileBirthMonth,
} from '../utils/personTax';
import { getSetupStates } from '../utils/setupHelpers';
import { ScheduleRowPickerDrawer } from './ScheduleRowPickerDrawer';
import { TaxReductionLeversDrawer } from './TaxReductionLeversDrawer';
import { VerificationCheckpointsCard } from './VerificationCheckpointsCard';

interface HorizonViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  issues: ValidationIssue[];
  guardrailAcknowledgments: Record<string, GuardrailAcknowledgment>;
  archivedYears: ArchivedActualsRecord[];
  selectedYear: number;
  scheduleView: ScheduleViewConfig;
  onUpdateSetup: (next: SetupConfig) => void;
  onUpdateScheduleView: (next: ScheduleViewConfig) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  onSaveGuardrailAck: (ack: GuardrailAcknowledgment) => void;
  onReopenGuardrailAck: (ackKey: string) => void;
  onSelectYear: (year: number, navigateTo?: WorkspaceTab) => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onOpenCpaPackage?: () => void;
  onExportShadowReturn?: () => void;
  exportingShadowReturn?: boolean;
}

const SUB_TONE_CLASS: Record<CellTone, string> = {
  neutral: 'text-slate-400',
  positive: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
  accent: 'text-teal-700',
};

const BADGE_TONE_CLASS: Record<CellTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  positive: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  accent: 'bg-teal-50 text-teal-800 border-teal-200',
};

const IRMAA_LOOKBACK_TOOLTIP =
  "Medicare IRMAA uses a 2-year lookback: each year's MAGI (AGI + tax-exempt interest) is tested against the Medicare threshold 2 years later (e.g., 2026 income sets 2028 premiums at ≤$231k, not the 2026 threshold of $218k which tested 2024 income).";

const IrmaaHoverTooltip: React.FC<{
  text: string;
  children: React.ReactNode;
}> = ({ text, children }) => {
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const showFromElement = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const tooltipWidth = 288;
    const margin = 12;
    const centerX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      margin,
      Math.min(window.innerWidth - tooltipWidth - margin, centerX - tooltipWidth / 2)
    );
    const showBelow = rect.top < 115;
    setCoords({
      left: clampedLeft,
      top: showBelow ? rect.bottom + 8 : rect.top - 8,
      placement: showBelow ? 'bottom' : 'top',
    });
  };

  return (
    <span
      className="inline-flex items-center"
      onMouseEnter={(e) => showFromElement(e.currentTarget)}
      onMouseLeave={() => setCoords(null)}
      onFocus={(e) => showFromElement(e.currentTarget)}
      onBlur={() => setCoords(null)}
    >
      {children}
      {coords && (
        <span
          role="tooltip"
          style={{
            left: `${coords.left}px`,
            top: `${coords.top}px`,
            transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
          className="fixed z-50 w-72 px-3 py-2 rounded-md bg-slate-900 text-slate-50 border border-slate-700/80 shadow-lg text-[11px] font-normal leading-relaxed text-left whitespace-normal pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
};

function parseCurrencyDraft(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '').trim();
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}

export const HorizonView: React.FC<HorizonViewProps> = ({
  setup,
  years,
  computed,
  issues,
  guardrailAcknowledgments,
  archivedYears,
  selectedYear,
  scheduleView,
  onUpdateSetup,
  onUpdateScheduleView,
  onUpdateYear,
  onSaveGuardrailAck,
  onReopenGuardrailAck,
  onSelectYear,
  onNavigate,
  onOpenCpaPackage,
  onExportShadowReturn,
  exportingShadowReturn,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    taxYear: number;
    draft: string;
    initialValue: number;
  } | null>(null);

  // Guardrail Acknowledge & Document workflow UI state
  const guardrailSectionRef = useRef<HTMLDivElement | null>(null);
  const [ackFormState, setAckFormState] = useState<{
    ackKey: string;
    status: GuardrailAckStatus;
    note: string;
    error: string | null;
  } | null>(null);
  const [acknowledgedAccordionOpen, setAcknowledgedAccordionOpen] = useState(false);
  const [allAckCardExpanded, setAllAckCardExpanded] = useState(false);

  const year1 = computed[0];
  const cumulativeAllInTax = computed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const cumulativeFederal = computed.reduce((s, c) => s + c.form_1040_out.federal_income_tax, 0);
  const cumulativePte = computed.reduce((s, c) => s + c.scorp_out.pte_tax_paid_total, 0);
  const cumulativeStateExclPte = computed.reduce(
    (s, c) => s + Math.max(0, c.total_state_tax - c.scorp_out.pte_tax_paid_total),
    0
  );
  const cumulativePayrollAndPte =
    computed.reduce((s, c) => s + c.total_entity_and_payroll_tax, 0) + cumulativePte;
  const cumulativePersonalFica = computed.reduce(
    (s, c) => s + c.form_1040_out.personal_fica_tax,
    0
  );
  const cumulativeGrossCashIncome = computed.reduce(
    (s, c) => s + c.total_gross_cash_income,
    0
  );
  const avgEffectiveRate =
    cumulativeGrossCashIncome > 0
      ? (cumulativeAllInTax / cumulativeGrossCashIncome) * 100
      : 0;

  const year1TotalSs =
    (year1?.form_1040_out.primary_ss_gross ?? 0) + (year1?.form_1040_out.spouse_ss_gross ?? 0);
  const year1CardTitle =
    year1TotalSs > 0
      ? `Year 1 (${year1?.tax_year}) Baseline (${formatCompactCurrency(year1TotalSs)} SS On)`
      : `Year 1 (${year1?.tax_year}) Filed Anchor`;

  const activeIssues = useMemo(
    () => issues.filter((issue) => !guardrailAcknowledgments[issue.ack_key]),
    [issues, guardrailAcknowledgments]
  );
  const acknowledgedIssues = useMemo(
    () =>
      issues
        .filter((issue) => Boolean(guardrailAcknowledgments[issue.ack_key]))
        .map((issue) => ({
          issue,
          ack: guardrailAcknowledgments[issue.ack_key],
        })),
    [issues, guardrailAcknowledgments]
  );

  const activeErrorCount = activeIssues.filter((i) => i.severity === 'error').length;
  const activeWarningCount = activeIssues.filter((i) => i.severity === 'warning').length;
  const activeAlertCount = activeIssues.length;
  const acknowledgedCount = acknowledgedIssues.length;

  const openAckFormForIssue = (issue: ValidationIssue, existing?: GuardrailAcknowledgment) => {
    const defaultStatus: GuardrailAckStatus =
      existing?.status ??
      (issue.tax_year !== null && issue.tax_year <= setup.anchor_actuals_year
        ? 'prior_year_historical'
        : 'intentional_cpa_reviewed');
    const syncedExistingNote =
      existing?.note && issue.rule_id === 'low_reasonable_comp' && issue.reasonable_comp_meta
        ? syncReasonableCompNoteText(
            existing.note,
            existing.finding_message,
            issue.reasonable_comp_meta.officer_w2,
            issue.reasonable_comp_meta.ordinary_business_income
          )
        : existing?.note ?? '';
    setAckFormState({
      ackKey: issue.ack_key,
      status: defaultStatus,
      note: syncedExistingNote,
      error: null,
    });
  };

  const handleSubmitAckForm = (issue: ValidationIssue) => {
    if (!ackFormState || ackFormState.ackKey !== issue.ack_key) return;
    const trimmed = ackFormState.note.trim();
    if (!trimmed) {
      setAckFormState({
        ...ackFormState,
        error: 'Please enter a brief explanation before saving.',
      });
      return;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    const existing = guardrailAcknowledgments[issue.ack_key];
    onSaveGuardrailAck({
      key: issue.ack_key,
      rule_id: issue.rule_id,
      tax_year: issue.tax_year,
      status: ackFormState.status,
      note: trimmed,
      acknowledged_at: existing?.acknowledged_at ?? todayIso,
      updated_at: existing ? todayIso : undefined,
      finding_title: issue.title,
      finding_message: issue.message,
      finding_severity: issue.severity,
    });
    setAckFormState(null);
  };

  const handleViewAcknowledgedLog = () => {
    setAllAckCardExpanded(true);
    setAcknowledgedAccordionOpen(true);
    setTimeout(() => {
      guardrailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
  };

  const chartData = computed.map((c) => ({
    year: c.is_locked_actuals ? `${c.tax_year} (Act)` : String(c.tax_year),
    taxYear: c.tax_year,
    Federal: c.form_1040_out.federal_income_tax,
    State: Math.max(0, c.total_state_tax - c.scorp_out.pte_tax_paid_total),
    'Payroll & PTE': c.total_entity_and_payroll_tax + c.scorp_out.pte_tax_paid_total,
    'All-In Eff. Rate': c.all_in_effective_rate,
  }));

  const hiddenRowIds = useMemo(
    () => new Set(scheduleView.hidden_line_item_ids ?? []),
    [scheduleView.hidden_line_item_ids]
  );

  const moduleEligibleItemIds = useMemo(() => {
    const showSsMedicare = setup.has_ss_medicare !== false;
    const showStockBasis = setup.has_stock_basis ?? setup.has_scorp;
    const showRetirement = Boolean(setup.has_dbp || setup.has_401k_or_ira || setup.has_annuity);
    const showMultiState = Boolean(
      setup.multi_state_active || setup.residency_change_active || setup.has_pte
    );
    const isJoint = setup.filing_status === 'married_filing_jointly';

    return new Set(
      MASTER_SCHEDULE_CATALOG.filter((item) => {
        if (
          !setup.has_scorp &&
          (item.id === 'ca_scorp_revenue' ||
            item.id === 'az_scorp_revenue' ||
            item.id === 'scorp_gross_revenue' ||
            item.id === 'scorp_operating_expenses' ||
            item.id === 'scorp_k1_profit' ||
            item.id === 'member_draws' ||
            item.id === 'capital_contributions' ||
            item.id === 'ending_stock_basis' ||
            item.id === 'form_8949_excess_gain' ||
            item.id === 'business_fica_tax' ||
            item.id === 'qbi_deduction' ||
            item.id === 'sehi_medicare_deduction')
        ) {
          return false;
        }
        if (
          !showStockBasis &&
          (item.id === 'ending_stock_basis' || item.id === 'form_8949_excess_gain')
        ) {
          return false;
        }
        if (
          !showSsMedicare &&
          (item.id === 'ss_bill' ||
            item.id === 'ss_debra' ||
            item.id === 'taxable_social_security' ||
            item.id === 'sehi_medicare_premiums' ||
            item.id === 'sehi_medicare_deduction' ||
            item.id === 'irmaa_starting_threshold')
        ) {
          return false;
        }
        if (!isJoint && (item.id === 'debra_w2_comp' || item.id === 'ss_debra')) {
          return false;
        }
        if (!setup.has_dbp && item.id === 'dbp_contribution') {
          return false;
        }
        if (
          !showRetirement &&
          (item.id === 'dbp_contribution' ||
            item.id === 'employer_401k_ps' ||
            item.id === 'employee_401k_deferrals' ||
            item.id === 'dbp_ps_tax_reduction')
        ) {
          return false;
        }
        if (
          !setup.multi_state_active &&
          !setup.secondary_state &&
          item.id === 'az_scorp_revenue'
        ) {
          return false;
        }
        if (!showMultiState && item.id === 'az_state_tax') {
          return false;
        }
        if (!showMultiState && !setup.home_state && item.id === 'ca_state_tax') {
          return false;
        }
        return true;
      }).map((i) => i.id)
    );
  }, [setup]);

  const visibleRowCount = useMemo(
    () =>
      ALL_SCHEDULE_ITEM_IDS.filter(
        (id) => moduleEligibleItemIds.has(id) && !hiddenRowIds.has(id)
      ).length,
    [moduleEligibleItemIds, hiddenRowIds]
  );

  const visibleSections = useMemo(() => {
    return SCHEDULE_SECTIONS.map((section) => ({
      section,
      rows: MASTER_SCHEDULE_CATALOG.filter(
        (item) =>
          item.section === section.id &&
          moduleEligibleItemIds.has(item.id) &&
          !hiddenRowIds.has(item.id)
      ),
    })).filter((g) => g.rows.length > 0);
  }, [moduleEligibleItemIds, hiddenRowIds]);

  const isCellEditable = (editField: ScheduleEditField | undefined, c: ComputedTaxYear): boolean => {
    if (!editField) return false;
    if (editField === 'irmaa_threshold') {
      return setup.has_ss_medicare !== false;
    }
    if (c.is_locked_actuals) return false;
    if (
      (editField === 'ca_scorp_revenue' ||
        editField === 'az_scorp_revenue' ||
        editField === 'operating_expenses' ||
        editField === 'member_draws' ||
        editField === 'capital_contributions') &&
      !setup.has_scorp
    ) {
      return false;
    }
    if (
      editField === 'debra_w2' &&
      (!setup.has_scorp || setup.filing_status !== 'married_filing_jointly')
    ) {
      return false;
    }
    if (editField === 'ss_debra' && setup.filing_status !== 'married_filing_jointly') {
      return false;
    }
    if (editField === 'dbp_contribution' && !setup.has_dbp) {
      return false;
    }
    return true;
  };

  const commitInlineEdit = (
    editField: ScheduleEditField,
    taxYear: number,
    draft: string,
    initialValue: number
  ) => {
    const trimmed = draft.trim();
    const parsed = parseCurrencyDraft(draft);

    // Avoid creating a spurious override when user clicks in and blurs without changing the value
    if (
      (editField === 'ss_bill' ||
        editField === 'ss_debra' ||
        editField === 'sehi_medicare_premiums' ||
        editField === 'irmaa_threshold' ||
        editField === 'operating_expenses') &&
      trimmed !== '' &&
      parsed === initialValue
    ) {
      setEditingCell(null);
      return;
    }

    if (editField === 'irmaa_threshold') {
      onUpdateSetup(setIrmaaThresholdOverride(setup, taxYear, parsed));
      setEditingCell(null);
      return;
    }

    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      switch (editField) {
        case 'ca_scorp_revenue':
        case 'az_scorp_revenue': {
          if (parsed === null) return prev;
          const { primaryStateCode, secondaryStateCode, hasSecondaryState } = getSetupStates(setup);
          const pCode = primaryStateCode || prev.state_filings[0]?.state_code || 'HOME';
          const sCode = secondaryStateCode || prev.state_filings[1]?.state_code || 'OTHER';
          const hasSecond = Boolean(setup.multi_state_active || hasSecondaryState);
          const nextPrimary =
            editField === 'ca_scorp_revenue' ? parsed : prev.scorp_1120s.ca_revenue;
          const nextSecondary =
            editField === 'az_scorp_revenue' ? parsed : prev.scorp_1120s.az_revenue;
          const nextTotal = nextPrimary + nextSecondary;
          const nextPrimaryApp = nextTotal > 0 ? nextPrimary / nextTotal : 0;
          const nextSecondaryApp = nextTotal > 0 ? nextSecondary / nextTotal : 0;
          const nextBreakdown = hasSecond
            ? [
                { state_code: pCode, apportionment_percent: Number((nextPrimaryApp * 100).toFixed(2)) },
                { state_code: sCode, apportionment_percent: Number((nextSecondaryApp * 100).toFixed(2)) },
              ]
            : primaryStateCode
            ? [{ state_code: primaryStateCode, apportionment_percent: 100 }]
            : [];
          return {
            ...prev,
            scorp_1120s: {
              ...prev.scorp_1120s,
              ca_revenue: nextPrimary,
              az_revenue: nextSecondary,
              gross_receipts_revenue: nextTotal,
              state_sourcing_breakdown: nextBreakdown,
            },
            state_filings: prev.state_filings.map((sf) =>
              sf.state_code === pCode
                ? { ...sf, state_apportionment_factor: hasSecond ? nextPrimaryApp : 1 }
                : hasSecond && sf.state_code === sCode
                ? { ...sf, state_apportionment_factor: nextSecondaryApp }
                : sf
            ),
          };
        }
        case 'operating_expenses': {
          const isFutureForecastYear = taxYear > setup.current_tax_year;
          const isProportionalMode =
            (setup.assumptions.opex_scaling_mode ?? 'revenue_proportional') ===
            'revenue_proportional';
          if (isFutureForecastYear && isProportionalMode) {
            return {
              ...prev,
              scorp_1120s: {
                ...prev.scorp_1120s,
                operating_expenses_override: parsed,
              },
            };
          }
          if (parsed === null) return prev;
          return {
            ...prev,
            scorp_1120s: {
              ...prev.scorp_1120s,
              operating_expenses: parsed,
              operating_expenses_override: null,
            },
          };
        }
        case 'bill_w2': {
          if (parsed === null) return prev;
          if (!setup.has_scorp) {
            return {
              ...prev,
              form_1040: { ...prev.form_1040, w2_wages_total: parsed },
            };
          }
          const nextOfficer = parsed + prev.scorp_1120s.debra_w2_wages;
          return {
            ...prev,
            scorp_1120s: {
              ...prev.scorp_1120s,
              bill_w2_wages: parsed,
              officer_w2_wages: nextOfficer,
              payroll_taxes_input: undefined,
            },
            form_1040: {
              ...prev.form_1040,
              w2_wages_total: nextOfficer,
            },
          };
        }
        case 'debra_w2': {
          if (parsed === null) return prev;
          const nextOfficer = prev.scorp_1120s.bill_w2_wages + parsed;
          return {
            ...prev,
            scorp_1120s: {
              ...prev.scorp_1120s,
              debra_w2_wages: parsed,
              officer_w2_wages: nextOfficer,
              payroll_taxes_input: undefined,
            },
            form_1040: {
              ...prev.form_1040,
              w2_wages_total: nextOfficer,
            },
          };
        }
        case 'ss_debra':
          return {
            ...prev,
            form_1040: {
              ...prev.form_1040,
              ss_debra_mode: parsed === null ? prev.form_1040.ss_debra_mode : 'on',
              ss_debra_override: parsed,
            },
          };
        case 'ss_bill':
          return {
            ...prev,
            form_1040: {
              ...prev.form_1040,
              ss_bill_mode: parsed === null ? prev.form_1040.ss_bill_mode : 'on',
              ss_bill_override: parsed,
            },
          };
        case 'member_draws':
          return parsed === null
            ? prev
            : {
                ...prev,
                scorp_1120s: { ...prev.scorp_1120s, scorp_distributions_total: parsed },
              };
        case 'capital_contributions':
          return parsed === null
            ? prev
            : {
                ...prev,
                scorp_1120s: { ...prev.scorp_1120s, capital_contributions: parsed },
              };
        case 'dbp_contribution': {
          if (parsed === null) return prev;
          const termYear = setup.dbp_planned_termination_year;
          const nextStatus =
            parsed === 0 && termYear !== null && taxYear > termYear
              ? 'terminated'
              : termYear !== null && taxYear === termYear
              ? 'terminating'
              : parsed > 0 && prev.dbp_and_retirement.dbp_status === 'terminated'
              ? 'active'
              : prev.dbp_and_retirement.dbp_status;
          return {
            ...prev,
            dbp_and_retirement: {
              ...prev.dbp_and_retirement,
              dbp_actual_contribution: parsed,
              dbp_status: nextStatus,
              dbp_max_deductible_contribution:
                parsed > prev.dbp_and_retirement.dbp_max_deductible_contribution
                  ? parsed
                  : prev.dbp_and_retirement.dbp_max_deductible_contribution,
            },
          };
        }
        case 'sehi_medicare_premiums':
          return {
            ...prev,
            form_1040: {
              ...prev.form_1040,
              sehi_medicare_override: parsed,
            },
          };
        default:
          return prev;
      }
    });
    setEditingCell(null);
  };

  const handleResetCellOverride = (editField: ScheduleEditField, taxYear: number) => {
    if (editField === 'irmaa_threshold') {
      onUpdateSetup(setIrmaaThresholdOverride(setup, taxYear, null));
      return;
    }
    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      if (editField === 'ss_bill') {
        return {
          ...prev,
          form_1040: { ...prev.form_1040, ss_bill_override: null },
        };
      }
      if (editField === 'ss_debra') {
        return {
          ...prev,
          form_1040: { ...prev.form_1040, ss_debra_override: null },
        };
      }
      if (editField === 'sehi_medicare_premiums') {
        return {
          ...prev,
          form_1040: { ...prev.form_1040, sehi_medicare_override: null },
        };
      }
      if (editField === 'operating_expenses') {
        return {
          ...prev,
          scorp_1120s: { ...prev.scorp_1120s, operating_expenses_override: null },
        };
      }
      return prev;
    });
  };

  const handleSsModeChange = (
    person: 'debra' | 'bill',
    taxYear: number,
    mode: SsYearMode
  ) => {
    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      if (person === 'debra') {
        return {
          ...prev,
          form_1040: {
            ...prev.form_1040,
            ss_debra_mode: mode,
            ss_debra_override: mode === 'on' ? prev.form_1040.ss_debra_override : null,
          },
        };
      }
      return {
        ...prev,
        form_1040: {
          ...prev.form_1040,
          ss_bill_mode: mode,
          ss_bill_override: mode === 'on' ? prev.form_1040.ss_bill_override : null,
        },
      };
    });
  };

  const handleSsBirthMonthChange = (person: 'debra' | 'bill', birthMonth: number) => {
    if (person === 'bill') {
      onUpdateSetup({
        ...setup,
        primary_profile: updateProfileBirthMonth(
          setup.primary_profile,
          birthMonth,
          setup.primary_birth_year
        ),
      });
    } else {
      onUpdateSetup({
        ...setup,
        spouse_profile: updateProfileBirthMonth(
          setup.spouse_profile,
          birthMonth,
          setup.spouse_birth_year ?? setup.primary_birth_year
        ),
      });
    }
  };

  const handleSet2025Ss = (person: 'debra' | 'bill', amount: number) => {
    onUpdateYear(2025, (prev) => {
      if (person === 'debra') {
        return {
          ...prev,
          form_1040: {
            ...prev.form_1040,
            ss_debra_mode: amount > 0 ? 'on' : 'off',
            ss_debra_override: amount > 0 ? amount : null,
          },
        };
      }
      return {
        ...prev,
        form_1040: {
          ...prev.form_1040,
          ss_bill_mode: amount > 0 ? 'on' : 'off',
          ss_bill_override: amount > 0 ? amount : null,
        },
      };
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Context Metadata */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Six-Year Rolling Tax Horizon
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{formatFilingStatus(setup.filing_status)}</span>
          <span aria-hidden="true">·</span>
          <span>
            Anchor Year {setup.anchor_actuals_year} ({year1?.is_locked_actuals ? 'Locked Actuals' : 'Unlocked Amendment Mode'})
          </span>
          <span aria-hidden="true">·</span>
          <span>Setup Tax Year {setup.current_tax_year}</span>
          <span aria-hidden="true">·</span>
          <span>
            Forecast Years {setup.forecast_years[1]}–{setup.forecast_years[5]}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {setup.deduction_method === 'itemized'
              ? `Custom Itemized (${formatCompactCurrency(setup.custom_itemized_deduction)})`
              : 'Standard Deduction (IRS Indexed + 65+)'}
          </span>
          {setup.has_scorp && (
            <>
              <span aria-hidden="true">·</span>
              <span>{computed[0]?.scorp_in.entity_name} (1120-S)</span>
            </>
          )}
        </div>
      </div>

      {/* 1. Validation & Guardrail Findings Banner (top-most so alerts are immediately visible) */}
      {issues.length > 0 && (
        <div
          ref={guardrailSectionRef}
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          {activeAlertCount === 0 && !allAckCardExpanded ? (
            <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-emerald-50/40">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="font-semibold text-slate-900">
                  Validation &amp; Guardrail Findings
                </span>
                <span className="text-emerald-800 font-medium">0 Active Alerts</span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="text-slate-600">
                  {acknowledgedCount} {acknowledgedCount === 1 ? 'finding' : 'findings'} acknowledged &amp; documented
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAllAckCardExpanded(true);
                  setAcknowledgedAccordionOpen(true);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:text-teal-950 whitespace-nowrap"
              >
                <span>Expand log</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Validation &amp; Guardrail Findings ({activeAlertCount} Active
                    {acknowledgedCount > 0 ? ` · ${acknowledgedCount} Acknowledged` : ''})
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    Module 4 §3 deterministic ruleset
                  </span>
                  {activeAlertCount === 0 && (
                    <button
                      type="button"
                      onClick={() => setAllAckCardExpanded(false)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Collapse bar
                    </button>
                  )}
                </div>
              </div>

              {/* Active Unacknowledged Findings */}
              {activeIssues.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {activeIssues.map((issue) => {
                    const isFormOpen = ackFormState?.ackKey === issue.ack_key;
                    return (
                      <div key={issue.ack_key} className="py-2.5 space-y-2.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            {issue.severity === 'error' ? (
                              <ShieldAlert className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <div className="text-xs font-semibold text-slate-900">
                                <span
                                  className={
                                    issue.severity === 'error'
                                      ? 'text-red-700 mr-1.5'
                                      : 'text-amber-700 mr-1.5'
                                  }
                                >
                                  {issue.severity === 'error' ? 'Blocking Error:' : 'Warning:'}
                                </span>
                                {issue.title}
                              </div>
                              <p className="text-xs text-slate-600 mt-0.5">{issue.message}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
                            <button
                              type="button"
                              onClick={() =>
                                isFormOpen ? setAckFormState(null) : openAckFormForIssue(issue)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 hover:border-slate-300 transition-colors whitespace-nowrap"
                            >
                              <FileCheck2 className="w-3.5 h-3.5 text-teal-700" />
                              Acknowledge
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onSelectYear(
                                  issue.tax_year ?? setup.anchor_actuals_year,
                                  issue.target_tab
                                )
                              }
                              className="text-xs font-medium text-teal-800 hover:text-teal-950 whitespace-nowrap"
                            >
                              Review in {issue.target_tab} →
                            </button>
                          </div>
                        </div>

                        {isFormOpen && ackFormState && (
                          <div className="ml-0 sm:ml-6 p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <label
                                htmlFor={`ack-status-${issue.ack_key}`}
                                className="text-[11px] font-semibold text-slate-700"
                              >
                                Resolution Status
                              </label>
                              <select
                                id={`ack-status-${issue.ack_key}`}
                                value={ackFormState.status}
                                onChange={(e) =>
                                  setAckFormState({
                                    ...ackFormState,
                                    status: e.target.value as GuardrailAckStatus,
                                  })
                                }
                                className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-700"
                              >
                                {GUARDRAIL_ACK_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`ack-note-${issue.ack_key}`}
                                className="block text-[11px] font-semibold text-slate-700 mb-1"
                              >
                                Explanation / CPA Note <span className="text-red-600">*</span>
                              </label>
                              {issue.rule_id === 'low_reasonable_comp' &&
                                issue.reasonable_comp_meta && (
                                  <div className="text-[10px] font-mono text-teal-800 mb-1.5">
                                    {formatReasonableCompExplanationSummary(
                                      issue.reasonable_comp_meta.officer_w2,
                                      issue.reasonable_comp_meta.ordinary_business_income,
                                      issue.tax_year ? `${issue.tax_year} Plan` : undefined
                                    )}
                                  </div>
                                )}
                              <textarea
                                id={`ack-note-${issue.ack_key}`}
                                rows={2}
                                value={ackFormState.note}
                                onChange={(e) =>
                                  setAckFormState({
                                    ...ackFormState,
                                    note: e.target.value,
                                    error: null,
                                  })
                                }
                                placeholder="Explain why this is acceptable or how it is being addressed..."
                                className="w-full text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-700"
                              />
                              {ackFormState.error && (
                                <p className="text-[11px] text-red-700 mt-1">
                                  {ackFormState.error}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setAckFormState(null)}
                                className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubmitAckForm(issue)}
                                className="px-3 py-1 text-xs font-medium text-white bg-teal-800 rounded hover:bg-teal-900"
                              >
                                Save Acknowledgment
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Collapsed "Acknowledged / Resolved (N)" Accordion */}
              {acknowledgedIssues.length > 0 && (
                <div
                  className={
                    activeIssues.length > 0 ? 'mt-3 pt-3 border-t border-slate-200' : ''
                  }
                >
                  <button
                    type="button"
                    onClick={() => setAcknowledgedAccordionOpen((prev) => !prev)}
                    aria-expanded={acknowledgedAccordionOpen}
                    className="w-full flex items-center justify-between gap-2 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {acknowledgedAccordionOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>Acknowledged / Resolved ({acknowledgedIssues.length})</span>
                    </span>
                    <span className="text-[11px] font-normal text-slate-500">
                      Included in CPA Print Package
                    </span>
                  </button>

                  {acknowledgedAccordionOpen && (
                    <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-md bg-slate-50/60">
                      {acknowledgedIssues.map(({ issue, ack }) => {
                        const isEditingNote = ackFormState?.ackKey === issue.ack_key;
                        const statusBadgeClass =
                          ack.status === 'prior_year_historical'
                            ? 'bg-slate-100 text-slate-700 border-slate-300'
                            : ack.status === 'intentional_cpa_reviewed'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-teal-50 text-teal-800 border-teal-200';
                        return (
                          <div key={issue.ack_key} className="p-3 space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  <span className="text-xs font-semibold text-slate-800">
                                    {issue.title}
                                  </span>
                                  <span
                                    className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${statusBadgeClass}`}
                                  >
                                    {getGuardrailAckStatusLabel(ack.status)}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500">
                                    Acknowledged {ack.acknowledged_at}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500">{issue.message}</p>
                                {!isEditingNote && (
                                  <div className="text-xs text-slate-800 bg-white border border-slate-200 rounded px-2.5 py-1.5 mt-1 space-y-1">
                                    <div>
                                      <span className="font-semibold text-slate-600 mr-1">Note:</span>
                                      {issue.rule_id === 'low_reasonable_comp' &&
                                      issue.reasonable_comp_meta
                                        ? syncReasonableCompNoteText(
                                            ack.note,
                                            ack.finding_message,
                                            issue.reasonable_comp_meta.officer_w2,
                                            issue.reasonable_comp_meta.ordinary_business_income
                                          )
                                        : ack.note}
                                    </div>
                                    {issue.rule_id === 'low_reasonable_comp' &&
                                      issue.reasonable_comp_meta && (
                                        <div className="text-[10px] font-mono text-teal-800">
                                          {formatReasonableCompExplanationSummary(
                                            issue.reasonable_comp_meta.officer_w2,
                                            issue.reasonable_comp_meta.ordinary_business_income,
                                            issue.tax_year ? `${issue.tax_year} Plan` : undefined
                                          )}
                                        </div>
                                      )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    isEditingNote
                                      ? setAckFormState(null)
                                      : openAckFormForIssue(issue, ack)
                                  }
                                  className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap"
                                >
                                  Edit Note
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (ackFormState?.ackKey === issue.ack_key) {
                                      setAckFormState(null);
                                    }
                                    onReopenGuardrailAck(issue.ack_key);
                                  }}
                                  className="px-2 py-1 text-[11px] font-medium text-amber-800 bg-white border border-amber-200 rounded hover:bg-amber-50 whitespace-nowrap"
                                >
                                  Reopen
                                </button>
                              </div>
                            </div>

                            {isEditingNote && ackFormState && (
                              <div className="p-3 bg-white border border-slate-200 rounded-md space-y-2.5">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <label
                                    htmlFor={`edit-ack-status-${issue.ack_key}`}
                                    className="text-[11px] font-semibold text-slate-700"
                                  >
                                    Resolution Status
                                  </label>
                                  <select
                                    id={`edit-ack-status-${issue.ack_key}`}
                                    value={ackFormState.status}
                                    onChange={(e) =>
                                      setAckFormState({
                                        ...ackFormState,
                                        status: e.target.value as GuardrailAckStatus,
                                      })
                                    }
                                    className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-700"
                                  >
                                    {GUARDRAIL_ACK_STATUS_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label
                                    htmlFor={`edit-ack-note-${issue.ack_key}`}
                                    className="block text-[11px] font-semibold text-slate-700 mb-1"
                                  >
                                    Explanation / CPA Note <span className="text-red-600">*</span>
                                  </label>
                                  <textarea
                                    id={`edit-ack-note-${issue.ack_key}`}
                                    rows={2}
                                    value={ackFormState.note}
                                    onChange={(e) =>
                                      setAckFormState({
                                        ...ackFormState,
                                        note: e.target.value,
                                        error: null,
                                      })
                                    }
                                    placeholder="Explain why this is acceptable or how it is being addressed..."
                                    className="w-full text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-700"
                                  />
                                  {ackFormState.error && (
                                    <p className="text-[11px] text-red-700 mt-1">
                                      {ackFormState.error}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setAckFormState(null)}
                                    className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSubmitAckForm(issue)}
                                    className="px-3 py-1 text-xs font-medium text-white bg-teal-800 rounded hover:bg-teal-900"
                                  >
                                    Save Changes
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. Four KPI Summary Cards (directly above the schedule so totals stay visible during inline edits) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span>6-Year All-In Tax Projection</span>
            <span className="relative inline-flex items-center group">
              <button
                type="button"
                aria-label="6-Year All-In Tax Projection breakdown details"
                className="text-slate-400 hover:text-slate-600 focus:text-slate-700 focus:outline-none transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-0 top-full mt-1.5 z-30 w-72 rounded-md bg-slate-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-slate-100 shadow-lg"
              >
                Sums 6-year Federal Income Tax ({formatCurrency(cumulativeFederal)}), State Tax ({formatCurrency(cumulativeStateExclPte)}), and Employer Payroll / PTE Tax ({formatCurrency(cumulativePayrollAndPte)}) to equal {formatCurrency(cumulativeAllInTax)}. Employee FICA ({formatCurrency(cumulativePersonalFica)}) is tracked separately in household cash flow.
              </span>
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(cumulativeAllInTax)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-slate-500 font-mono tabular-nums">
            <span>Fed {formatCurrency(cumulativeFederal)}</span>
            <span aria-hidden="true">·</span>
            <span>State {formatCurrency(cumulativeStateExclPte)}</span>
            <span aria-hidden="true">·</span>
            <span>ER Payroll/PTE {formatCurrency(cumulativePayrollAndPte)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">6-Year All-In Effective Rate</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatPercent(avgEffectiveRate, 1)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Year 1 Federal Eff. {formatPercent(year1?.form_1040_out.effective_tax_rate ?? 0, 1)} · Marginal{' '}
            {formatPercent(year1?.form_1040_out.marginal_tax_rate ?? 0, 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            {year1CardTitle}
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(year1?.form_1040_out.taxable_income ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Taxable Income · AGI {formatCurrency(year1?.form_1040_out.adjusted_gross_income ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500">Deterministic Guardrails</div>
          <div className="mt-1.5 flex items-center gap-2">
            {activeErrorCount > 0 ? (
              <>
                <ShieldAlert className="w-5 h-5 text-red-700 shrink-0" />
                <span className="text-lg font-semibold text-red-700">
                  {activeErrorCount} Blocking {activeErrorCount === 1 ? 'Issue' : 'Issues'}
                </span>
              </>
            ) : activeWarningCount > 0 ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                <span className="text-lg font-semibold text-amber-700">
                  {activeWarningCount} Active {activeWarningCount === 1 ? 'Alert' : 'Alerts'}
                </span>
              </>
            ) : acknowledgedCount > 0 ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span className="text-lg font-semibold text-emerald-700">0 Active Alerts</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span className="text-lg font-semibold text-emerald-700">All Checks Passed</span>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            {activeAlertCount > 0 ? (
              <button
                type="button"
                onClick={() => onNavigate(activeIssues[0]?.target_tab ?? 'scenarios')}
                className="text-left text-xs font-medium text-teal-800 hover:underline"
              >
                Inspect active alert →
              </button>
            ) : acknowledgedCount > 0 ? (
              <button
                type="button"
                onClick={handleViewAcknowledgedLog}
                className="text-left text-xs text-slate-500 hover:text-teal-800 hover:underline"
              >
                {acknowledgedCount} acknowledged — view log
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('scenarios')}
                className="text-left text-xs font-medium text-teal-800 hover:underline"
              >
                Open Scenarios &amp; Grounded AI →
              </button>
            )}
            {activeAlertCount > 0 && acknowledgedCount > 0 && (
              <button
                type="button"
                onClick={handleViewAcknowledgedLog}
                className="text-[11px] text-slate-500 hover:text-teal-800 hover:underline whitespace-nowrap"
              >
                {acknowledgedCount} acknowledged
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2b. Collapsible Actionable Tax-Reduction Levers Drawer (unlocked years with IRMAA cliff, Senior phaseout, or bracket jump) */}
      <TaxReductionLeversDrawer
        setup={setup}
        years={years}
        computed={computed}
        onUpdateYear={onUpdateYear}
        onSelectYear={onSelectYear}
      />

      {/* 3. Six-Year Financial Schedule (interactive 2025–2030 grid) */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Six-Year Financial Schedule
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Top-down cash-and-tax waterfall · {setup.forecast_years[0]} locked actuals · Click any underlined {setup.forecast_years[1]}–{setup.forecast_years[5]} input cell to edit inline.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-center">
            {onExportShadowReturn && (
              <button
                type="button"
                onClick={onExportShadowReturn}
                disabled={Boolean(exportingShadowReturn)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-md hover:bg-emerald-100 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  {exportingShadowReturn
                    ? 'Generating Workbook…'
                    : 'Export Shadow Tax Return (.xlsx)'}
                </span>
              </button>
            )}
            {onOpenCpaPackage && (
              <button
                type="button"
                onClick={onOpenCpaPackage}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>CPA Print Package</span>
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                aria-expanded={pickerOpen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:border-teal-700 hover:text-teal-900 transition-colors whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 text-teal-700" />
                <span>Show / Hide Rows</span>
                <span className="font-mono text-[11px] text-slate-500">
                  ({visibleRowCount}/{ALL_SCHEDULE_ITEM_IDS.length})
                </span>
              </button>

              <ScheduleRowPickerDrawer
                open={pickerOpen}
                setup={setup}
                scheduleView={scheduleView}
                hiddenRowIds={hiddenRowIds}
                onChange={onUpdateScheduleView}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          </div>
        </div>

        {visibleSections.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">All schedule rows are currently hidden</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              All rows remain active in the deterministic tax engine. Restore visibility below.
            </p>
            <button
              type="button"
              onClick={() =>
                onUpdateScheduleView({
                  ...scheduleView,
                  preset: 'full',
                  hidden_line_item_ids: [],
                })
              }
              className="px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900"
            >
              Show All Rows
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-[250px]">
                    Line Item
                  </th>
                  {computed.map((c) => {
                    const isSel = c.tax_year === selectedYear;
                    return (
                      <th
                        key={c.tax_year}
                        className="py-2.5 px-3 last:pr-4 text-right min-w-[104px]"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectYear(c.tax_year, 'form1040')}
                          className={`inline-flex flex-col items-end group transition-colors ${
                            isSel ? 'text-teal-800' : 'text-slate-900 hover:text-teal-800'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1 text-sm font-mono font-semibold tabular-nums">
                            {c.is_locked_actuals && (
                              <Lock className="w-3 h-3 text-teal-700" aria-label="Locked actuals" />
                            )}
                            {c.tax_year}
                          </span>
                          <span className="text-[10px] font-normal text-slate-500 group-hover:text-teal-700">
                            {c.record_mode === 'actuals' ? 'Locked' : 'Editable'}
                            {c.primary_age !== null ? ` · Age ${c.primary_age}` : ''}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleSections.map(({ section, rows }) => (
                  <React.Fragment key={section.id}>
                    <tr className="bg-slate-100/80 border-y border-slate-200">
                      <td
                        colSpan={computed.length + 1}
                        className="py-2 px-4 text-xs font-semibold text-slate-800"
                      >
                        {section.title}
                      </td>
                    </tr>
                    {rows.map((row) => {
                      const rowLabel = getScheduleRowLabel(row, setup);
                      const cells = computed.map((c, idx) =>
                        row.computeCell(c, idx, computed, setup)
                      );

                      const rowBg =
                        row.highlight === 'primary'
                          ? 'bg-slate-900 text-white hover:bg-slate-900'
                          : row.highlight === 'secondary'
                          ? 'bg-teal-50/70 hover:bg-teal-50'
                          : 'hover:bg-slate-50/70';

                      const isPrimaryHighlight = row.highlight === 'primary';
                      const isSsRow = row.editField === 'ss_debra' || row.editField === 'ss_bill';
                      const ssPerson: 'debra' | 'bill' =
                        row.editField === 'ss_debra' ? 'debra' : 'bill';

                      return (
                        <tr
                          key={row.id}
                          className={`border-b ${
                            isPrimaryHighlight ? 'border-slate-800' : 'border-slate-100'
                          } transition-colors ${rowBg}`}
                        >
                          <td className="py-2 px-4 align-top">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-xs leading-snug ${
                                  isPrimaryHighlight
                                    ? 'font-semibold text-white'
                                    : row.bold
                                    ? 'font-semibold text-slate-900'
                                    : 'text-slate-700'
                                }`}
                              >
                                {rowLabel}
                              </span>
                              {row.id === 'irmaa_starting_threshold' && (
                                <IrmaaHoverTooltip text={IRMAA_LOOKBACK_TOOLTIP}>
                                  <span
                                    tabIndex={0}
                                    aria-label="How Medicare IRMAA 2-year lookback works"
                                    className="inline-flex items-center justify-center text-slate-400 hover:text-teal-700 focus:text-teal-700 focus:outline-none cursor-help"
                                  >
                                    <Info className="w-3.5 h-3.5 shrink-0" />
                                  </span>
                                </IrmaaHoverTooltip>
                              )}
                              {row.editField && (
                                <Pencil
                                  className="w-2.5 h-2.5 text-teal-600/70 shrink-0"
                                  aria-label="Inline editable 2026–2030"
                                />
                              )}
                            </div>
                            {isSsRow &&
                              (ssPerson === 'bill' ||
                                setup.filing_status === 'married_filing_jointly') && (
                                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                                  <span>Birth mo:</span>
                                  <select
                                    aria-label={`${rowLabel} birth month for FRA and age-70 proration`}
                                    value={
                                      ssPerson === 'bill'
                                        ? getPersonBirthMonth(setup.primary_profile, 1)
                                        : getPersonBirthMonth(setup.spouse_profile, 1)
                                    }
                                    onChange={(e) =>
                                      handleSsBirthMonthChange(ssPerson, Number(e.target.value))
                                    }
                                    className="text-[10px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded px-1 py-0.2 focus:outline-none focus:border-teal-700 cursor-pointer"
                                  >
                                    {MONTH_SHORT_NAMES.map((mLabel, mIdx) => (
                                      <option key={mLabel} value={mIdx + 1}>
                                        {mLabel}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            {row.id === 'scorp_operating_expenses' && setup.has_scorp && (() => {
                              const opexMode =
                                setup.assumptions.opex_scaling_mode ?? 'revenue_proportional';
                              const ratioPct = Number(
                                ((setup.assumptions.expense_ratio ?? 0.2) * 100).toFixed(1)
                              );
                              const futureStartYear = setup.current_tax_year + 1;
                              return (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                                  <span>{futureStartYear}+:</span>
                                  <div
                                    className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 gap-0.5"
                                    role="group"
                                    aria-label="Forecast Operating Expenses scaling mode"
                                  >
                                    {(
                                      [
                                        { id: 'revenue_proportional', label: '% Rev' },
                                        { id: 'fixed_inflation', label: 'Fixed' },
                                      ] as const
                                    ).map((opt) => {
                                      const active = opexMode === opt.id;
                                      return (
                                        <button
                                          key={opt.id}
                                          type="button"
                                          onClick={() =>
                                            onUpdateSetup({
                                              ...setup,
                                              assumptions: {
                                                ...setup.assumptions,
                                                opex_scaling_mode: opt.id,
                                              },
                                            })
                                          }
                                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded-sm leading-none transition-colors ${
                                            active
                                              ? 'bg-teal-700 text-white'
                                              : 'text-slate-500 hover:text-slate-800'
                                          }`}
                                        >
                                          {opt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {opexMode === 'revenue_proportional' && (
                                    <label className="inline-flex items-center gap-0.5 font-mono text-slate-700">
                                      <input
                                        type="number"
                                        aria-label="Forecast operating expense ratio percent of revenue"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={ratioPct}
                                        onChange={(e) => {
                                          const raw = Number(e.target.value);
                                          if (!Number.isFinite(raw)) return;
                                          const clamped = Math.min(100, Math.max(0, raw)) / 100;
                                          onUpdateSetup({
                                            ...setup,
                                            assumptions: {
                                              ...setup.assumptions,
                                              expense_ratio: clamped,
                                            },
                                          });
                                        }}
                                        className="w-12 text-right text-[10px] font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded px-1 py-0.2 focus:outline-none focus:border-teal-700"
                                      />
                                      <span>%</span>
                                    </label>
                                  )}
                                </div>
                              );
                            })()}
                          </td>

                          {computed.map((c, idx) => {
                            const cell = cells[idx];
                            const editable = isCellEditable(row.editField, c);
                            const isEditing =
                              editingCell?.rowId === row.id && editingCell?.taxYear === c.tax_year;
                            const toneClass = isPrimaryHighlight
                              ? 'text-slate-300'
                              : SUB_TONE_CLASS[cell.subTone ?? 'neutral'];

                            const activeSsMode: SsYearMode =
                              ssPerson === 'bill'
                                ? c.form_1040_out.primary_ss_mode
                                : c.form_1040_out.spouse_ss_mode;

                            return (
                              <td
                                key={c.tax_year}
                                className={`py-2 px-3 last:pr-4 text-right align-top ${
                                  !isPrimaryHighlight && c.record_mode === 'actuals'
                                    ? 'bg-slate-50/50'
                                    : ''
                                }`}
                              >
                                <div className="flex justify-end">
                                  {isEditing && row.editField ? (
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      autoFocus
                                      value={editingCell.draft}
                                      onChange={(e) =>
                                        setEditingCell({
                                          ...editingCell,
                                          draft: e.target.value,
                                        })
                                      }
                                      onFocus={(e) => e.currentTarget.select()}
                                      onBlur={() =>
                                        commitInlineEdit(
                                          row.editField!,
                                          c.tax_year,
                                          editingCell.draft,
                                          editingCell.initialValue
                                        )
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.currentTarget.blur();
                                        } else if (e.key === 'Escape') {
                                          setEditingCell(null);
                                        }
                                      }}
                                      aria-label={`${rowLabel} ${c.tax_year}`}
                                      className="w-24 text-right font-mono text-xs tabular-nums bg-white text-slate-900 border border-teal-700 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-700"
                                    />
                                  ) : editable && row.editField ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingCell({
                                          rowId: row.id,
                                          taxYear: c.tax_year,
                                          draft: String(cell.rawEditValue ?? 0),
                                          initialValue: cell.rawEditValue ?? 0,
                                        })
                                      }
                                      title={
                                        row.editField === 'irmaa_threshold'
                                          ? `Click to override ${c.tax_year} coverage threshold (leave blank to reset to formula)`
                                          : isSsRow ||
                                            row.editField === 'sehi_medicare_premiums' ||
                                            (row.editField === 'operating_expenses' &&
                                              c.tax_year > setup.current_tax_year &&
                                              (setup.assumptions.opex_scaling_mode ??
                                                'revenue_proportional') === 'revenue_proportional')
                                          ? 'Click to enter dollar override (leave blank to reset to Setup formula)'
                                          : `Click to edit ${rowLabel} for ${c.tax_year}`
                                      }
                                      className="font-mono text-xs tabular-nums whitespace-nowrap text-slate-900 border-b border-dashed border-teal-600/60 hover:border-teal-800 hover:bg-teal-50/70 rounded-sm px-1 transition-colors"
                                    >
                                      {cell.display}
                                    </button>
                                  ) : (
                                    <div
                                      className={`font-mono text-xs tabular-nums whitespace-nowrap ${
                                        isPrimaryHighlight
                                          ? 'font-semibold text-white'
                                          : row.bold
                                          ? 'font-semibold text-slate-900'
                                          : 'text-slate-700'
                                      }`}
                                    >
                                      {cell.display}
                                    </div>
                                  )}
                                </div>

                                {/* Subtle Override Indicator + One-Click Reset Back to Formula */}
                                {editable && cell.isOverridden && row.editField && (
                                  <div className="mt-0.5 flex flex-wrap items-center justify-end gap-1">
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 leading-none">
                                      Override
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleResetCellOverride(row.editField!, c.tax_year)
                                      }
                                      title={`Reset ${rowLabel} (${c.tax_year}) back to formula`}
                                      aria-label={`Reset ${rowLabel} ${c.tax_year} override back to formula`}
                                      className="inline-flex items-center gap-0.5 text-[9px] font-medium text-teal-800 hover:text-teal-950 hover:underline leading-none whitespace-nowrap"
                                    >
                                      <RotateCcw className="w-2.5 h-2.5" />
                                      {row.editField === 'irmaa_threshold'
                                        ? 'Reset to formula'
                                        : 'Reset'}
                                    </button>
                                  </div>
                                )}

                                {/* Compact On / Suspended / Off Toggle stacked cleanly beneath dollar value */}
                                {isSsRow && editable && (
                                  <div className="mt-1 flex justify-end">
                                    <div
                                      className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 gap-0.5"
                                      role="group"
                                      aria-label={`${rowLabel} ${c.tax_year} status`}
                                    >
                                      {(
                                        [
                                          { id: 'on', label: 'On' },
                                          { id: 'suspended', label: 'Susp' },
                                          { id: 'off', label: 'Off' },
                                        ] as const
                                      ).map((opt) => {
                                        const active = activeSsMode === opt.id;
                                        return (
                                          <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() =>
                                              handleSsModeChange(ssPerson, c.tax_year, opt.id)
                                            }
                                            className={`px-1 py-0.5 text-[9px] font-medium rounded-sm leading-none transition-colors ${
                                              active
                                                ? opt.id === 'on'
                                                  ? 'bg-emerald-700 text-white'
                                                  : opt.id === 'suspended'
                                                  ? 'bg-teal-700 text-white'
                                                  : 'bg-slate-600 text-white'
                                                : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                          >
                                            {opt.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Status / Alert Badge */}
                                {cell.badge && (
                                  <div className="mt-1 flex justify-end">
                                    {row.id === 'total_joint_agi' ? (
                                      <IrmaaHoverTooltip text={IRMAA_LOOKBACK_TOOLTIP}>
                                        <span
                                          tabIndex={0}
                                          className={`inline-flex items-center gap-1 text-[10px] font-medium leading-tight px-1.5 py-0.5 rounded border whitespace-nowrap cursor-help focus:outline-none focus:ring-1 focus:ring-teal-600 ${
                                            BADGE_TONE_CLASS[cell.badge.tone]
                                          }`}
                                        >
                                          <span>{cell.badge.text}</span>
                                          <Info className="w-2.5 h-2.5 opacity-70 shrink-0" aria-hidden="true" />
                                        </span>
                                      </IrmaaHoverTooltip>
                                    ) : (
                                      <span
                                        className={`inline-block text-[10px] font-medium leading-tight px-1.5 py-0.5 rounded border whitespace-nowrap ${
                                          BADGE_TONE_CLASS[cell.badge.tone]
                                        }`}
                                      >
                                        {cell.badge.text}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Sub-label (skip redundant "On"/"Off" on editable SS rows since toggle already shows it) */}
                                {cell.subLabel &&
                                  !(
                                    isSsRow &&
                                    editable &&
                                    (cell.subLabel === 'On' || cell.subLabel === 'Off')
                                  ) && (
                                    <div
                                      className={`text-[10px] leading-snug mt-0.5 whitespace-normal ${toneClass}`}
                                    >
                                      {cell.subLabel}
                                    </div>
                                  )}

                                {/* Subtle Filed 2025 Return Reference Sub-Label */}
                                {cell.filedRef && (
                                  <div
                                    className={`text-[10px] font-mono tabular-nums leading-tight mt-0.5 whitespace-nowrap ${
                                      isPrimaryHighlight ? 'text-slate-300' : 'text-slate-400'
                                    }`}
                                  >
                                    {cell.filedRef}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Six-Year Tax Composition & Effective Rate Trajectory Stacked Bar Chart */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Six-Year Tax Composition &amp; Effective Rate Trajectory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Annual federal, state, and employer payroll / PTE tax layers stacked against all-in effective rate (% of AGI).
            </p>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {setup.forecast_years[0]} Actuals → {setup.forecast_years[5]} Forecast
          </div>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 12, fill: '#475569', fontFamily: 'IBM Plex Mono' }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => formatCompactCurrency(v)}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 45]}
                tick={{ fontSize: 11, fill: '#0f766e', fontFamily: 'IBM Plex Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const num = Number(value);
                  const label = String(name);
                  if (label.includes('Rate')) return [`${num.toFixed(1)}%`, label];
                  return [formatCurrency(num), label];
                }}
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'IBM Plex Mono',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Bar yAxisId="left" dataKey="Federal" stackId="tax" fill="#0f172a" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="State" stackId="tax" fill="#0f766e" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="Payroll & PTE" stackId="tax" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="All-In Eff. Rate"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 3.5, fill: '#d97706' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Archived Actuals History (shown after performing an Annual Roll Forward) */}
      {archivedYears.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Retired Actuals Archive ({archivedYears.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            Prior Year 1 filed returns archived when rolling the six-year horizon forward.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Tax Year</th>
                  <th className="py-2 px-4 font-medium">Archived On</th>
                  <th className="py-2 px-4 text-right font-medium">AGI</th>
                  <th className="py-2 px-4 text-right font-medium">Taxable Income</th>
                  <th className="py-2 px-4 text-right font-medium">Federal Tax</th>
                  <th className="py-2 pl-4 text-right font-medium">State Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                {archivedYears.map((arc) => (
                  <tr key={`${arc.tax_year}-${arc.archived_at}`}>
                    <td className="py-2 pr-4 font-semibold text-slate-900">{arc.tax_year}</td>
                    <td className="py-2 px-4 text-slate-500">{arc.archived_at}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.adjusted_gross_income)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.taxable_income)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(arc.summary.federal_income_tax)}</td>
                    <td className="py-2 pl-4 text-right">{formatCurrency(arc.summary.total_state_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. 2025 Deterministic Engine Verification Checkpoints (at the very bottom; collapsed by default when 7/7 pass) */}
      {year1 && year1.tax_year === 2025 && isDefaultSeedSetup(setup) && (
        <VerificationCheckpointsCard
          setup={setup}
          year2025={year1}
          onSet2025Ss={handleSet2025Ss}
        />
      )}
    </div>
  );
};
