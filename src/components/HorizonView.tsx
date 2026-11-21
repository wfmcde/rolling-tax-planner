import React, { useMemo, useState } from 'react';
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
  Eye,
  Lock,
  Pencil,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import type {
  ArchivedActualsRecord,
  ComputedTaxYear,
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
import {
  formatCompactCurrency,
  formatCurrency,
  formatFilingStatus,
  formatPercent,
} from '../utils/format';
import { ScheduleRowPickerDrawer } from './ScheduleRowPickerDrawer';
import { VerificationCheckpointsCard } from './VerificationCheckpointsCard';

interface HorizonViewProps {
  setup: SetupConfig;
  computed: ComputedTaxYear[];
  issues: ValidationIssue[];
  archivedYears: ArchivedActualsRecord[];
  selectedYear: number;
  scheduleView: ScheduleViewConfig;
  onUpdateScheduleView: (next: ScheduleViewConfig) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
  onSelectYear: (year: number, navigateTo?: WorkspaceTab) => void;
  onNavigate: (tab: WorkspaceTab) => void;
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

function parseCurrencyDraft(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '').trim();
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}

export const HorizonView: React.FC<HorizonViewProps> = ({
  setup,
  computed,
  issues,
  archivedYears,
  selectedYear,
  scheduleView,
  onUpdateScheduleView,
  onUpdateYear,
  onSelectYear,
  onNavigate,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    taxYear: number;
    draft: string;
    initialValue: number;
  } | null>(null);

  const year1 = computed[0];
  const cumulativeAllInTax = computed.reduce((s, c) => s + c.total_all_in_tax, 0);
  const cumulativeFederal = computed.reduce((s, c) => s + c.form_1040_out.federal_income_tax, 0);
  const cumulativeState = computed.reduce((s, c) => s + c.total_state_tax, 0);
  const cumulativeGrossCashIncome = computed.reduce(
    (s, c) => s + c.total_gross_cash_income,
    0
  );
  const avgEffectiveRate =
    cumulativeGrossCashIncome > 0
      ? (cumulativeAllInTax / cumulativeGrossCashIncome) * 100
      : 0;

  const year1BillSs = year1?.form_1040_out.primary_ss_gross ?? 0;
  const year1DebraSs = year1?.form_1040_out.spouse_ss_gross ?? 0;
  const year1TotalSs = year1BillSs + year1DebraSs;
  const year1CardTitle =
    year1?.tax_year === 2025
      ? year1TotalSs === 0
        ? 'Year 1 (2025) Filed Anchor'
        : year1BillSs === 39500 && year1DebraSs === 39500
        ? 'Year 1 (2025) Baseline ($79k SS On)'
        : `Year 1 (2025) Baseline (${formatCompactCurrency(year1TotalSs)} SS On)`
      : `Year 1 (${year1?.tax_year}) Filed Anchor`;

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  const chartData = computed.map((c) => ({
    year: c.is_locked_actuals ? `${c.tax_year} (Act)` : String(c.tax_year),
    taxYear: c.tax_year,
    Federal: c.form_1040_out.federal_income_tax,
    State: c.total_state_tax,
    'Payroll & PTE': c.total_entity_and_payroll_tax,
    'All-In Eff. Rate': c.all_in_effective_rate,
  }));

  const hiddenRowIds = useMemo(
    () => new Set(scheduleView.hidden_line_item_ids ?? []),
    [scheduleView.hidden_line_item_ids]
  );

  const visibleRowCount = ALL_SCHEDULE_ITEM_IDS.length - hiddenRowIds.size;

  const visibleSections = useMemo(() => {
    return SCHEDULE_SECTIONS.map((section) => ({
      section,
      rows: MASTER_SCHEDULE_CATALOG.filter(
        (item) => item.section === section.id && !hiddenRowIds.has(item.id)
      ),
    })).filter((g) => g.rows.length > 0);
  }, [hiddenRowIds]);

  const isCellEditable = (editField: ScheduleEditField | undefined, c: ComputedTaxYear): boolean => {
    if (!editField || c.is_locked_actuals) return false;
    if (
      (editField === 'ca_scorp_revenue' ||
        editField === 'az_scorp_revenue' ||
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
        editField === 'sehi_medicare_premiums') &&
      trimmed !== '' &&
      parsed === initialValue
    ) {
      setEditingCell(null);
      return;
    }

    onUpdateYear(taxYear, (prev) => {
      if (prev.is_locked_actuals) return prev;
      switch (editField) {
        case 'ca_scorp_revenue':
        case 'az_scorp_revenue': {
          if (parsed === null) return prev;
          const nextCa =
            editField === 'ca_scorp_revenue' ? parsed : prev.scorp_1120s.ca_revenue;
          const nextAz =
            editField === 'az_scorp_revenue' ? parsed : prev.scorp_1120s.az_revenue;
          const nextTotal = nextCa + nextAz;
          const nextCaApp = nextTotal > 0 ? nextCa / nextTotal : 0;
          const nextAzApp = nextTotal > 0 ? nextAz / nextTotal : 0;
          return {
            ...prev,
            scorp_1120s: {
              ...prev.scorp_1120s,
              ca_revenue: nextCa,
              az_revenue: nextAz,
              gross_receipts_revenue: nextTotal,
              state_sourcing_breakdown: [
                { state_code: 'CA', apportionment_percent: Number((nextCaApp * 100).toFixed(2)) },
                { state_code: 'AZ', apportionment_percent: Number((nextAzApp * 100).toFixed(2)) },
              ],
            },
            state_filings: prev.state_filings.map((sf) =>
              sf.state_code === 'CA'
                ? { ...sf, state_apportionment_factor: nextCaApp }
                : sf.state_code === 'AZ'
                ? { ...sf, state_apportionment_factor: nextAzApp }
                : sf
            ),
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

      {/* 4-Column Flat KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">6-Year All-In Tax Projection</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(cumulativeAllInTax)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Fed {formatCompactCurrency(cumulativeFederal)} · State {formatCompactCurrency(cumulativeState)}
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
            {errorCount > 0 ? (
              <>
                <ShieldAlert className="w-5 h-5 text-red-700 shrink-0" />
                <span className="text-lg font-semibold text-red-700">
                  {errorCount} Blocking {errorCount === 1 ? 'Issue' : 'Issues'}
                </span>
              </>
            ) : warningCount > 0 ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                <span className="text-lg font-semibold text-amber-700">
                  {warningCount} Review {warningCount === 1 ? 'Alert' : 'Alerts'}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span className="text-lg font-semibold text-emerald-700">All Checks Passed</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigate(issues[0]?.target_tab ?? 'scenarios')}
            className="mt-1 text-left text-xs font-medium text-teal-800 hover:underline"
          >
            {issues.length > 0 ? 'Inspect guardrail alert →' : 'Open Scenarios & Grounded AI →'}
          </button>
        </div>
      </div>

      {/* Guardrail Escalation Strip (only shown when errors or warnings exist) */}
      {issues.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Validation &amp; Guardrail Findings ({issues.length})
            </h2>
            <span className="text-xs text-slate-500">
              Module 4 §3 deterministic ruleset
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
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
                          issue.severity === 'error' ? 'text-red-700 mr-1.5' : 'text-amber-700 mr-1.5'
                        }
                      >
                        {issue.severity === 'error' ? 'Blocking Error:' : 'Warning:'}
                      </span>
                      {issue.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{issue.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onSelectYear(issue.tax_year ?? setup.anchor_actuals_year, issue.target_tab)
                  }
                  className="text-xs font-medium text-teal-800 hover:text-teal-950 whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  Review in {issue.target_tab} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Six-Year Tax Trajectory Chart */}
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

      {/* 2025 Deterministic Engine Verification Checkpoints */}
      {year1 && year1.tax_year === 2025 && (
        <VerificationCheckpointsCard
          setup={setup}
          year2025={year1}
          onSet2025Ss={handleSet2025Ss}
        />
      )}

      {/* Interactive Top-Down Cash & Tax Waterfall Schedule */}
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

          <div className="relative shrink-0 self-start sm:self-center">
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
                              {row.editField && (
                                <Pencil
                                  className="w-2.5 h-2.5 text-teal-600/70 shrink-0"
                                  aria-label="Inline editable 2026–2030"
                                />
                              )}
                            </div>
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
                                      isSsRow || row.editField === 'sehi_medicare_premiums'
                                        ? 'Click to enter dollar override (leave blank to reset to Setup formula)'
                                        : `Click to edit ${rowLabel} for ${c.tax_year}`
                                    }
                                    className="font-mono text-xs tabular-nums whitespace-nowrap text-slate-900 border-b border-dashed border-teal-600/60 hover:border-teal-800 hover:bg-teal-50/70 rounded-sm px-1 -mr-1 transition-colors"
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

                                {/* Subtle Override Indicator + One-Click Reset Back to Formula */}
                                {editable && cell.isOverridden && row.editField && (
                                  <div className="mt-0.5 flex items-center justify-end gap-1">
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 leading-none">
                                      Override
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleResetCellOverride(row.editField!, c.tax_year)
                                      }
                                      title={`Reset ${rowLabel} (${c.tax_year}) back to Setup formula`}
                                      aria-label={`Reset ${rowLabel} ${c.tax_year} override back to formula`}
                                      className="inline-flex items-center gap-0.5 text-[9px] font-medium text-teal-800 hover:text-teal-950 hover:underline leading-none"
                                    >
                                      <RotateCcw className="w-2.5 h-2.5" />
                                      Reset
                                    </button>
                                  </div>
                                )}

                                {/* Compact On / Suspended / Off Toggle for Primary & Spouse SS (2026–2030) */}
                                {isSsRow && editable && (
                                  <div
                                    className="mt-1 inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 gap-0.5"
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
                                )}

                                {/* Status / Alert Badge */}
                                {cell.badge && (
                                  <div className="mt-1 flex justify-end">
                                    <span
                                      className={`inline-block text-[10px] font-medium leading-tight px-1.5 py-0.5 rounded border whitespace-nowrap ${
                                        BADGE_TONE_CLASS[cell.badge.tone]
                                      }`}
                                    >
                                      {cell.badge.text}
                                    </span>
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
    </div>
  );
};
