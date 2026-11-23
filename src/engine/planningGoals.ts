import type {
  CustomGoalMetricKey,
  FilingStatus,
  PlanningGoalGuardrail,
  PlanningGuardrailStatus,
  PnlBalanceSheetState,
  SetupConfig,
} from '../types/tax';
import type { ComputedPnlBalanceSheet } from './pnlBalanceSheet';
import { formatCurrencyExact, formatFilingStatus } from '../utils/format';
import { getSetupStates } from '../utils/setupHelpers';
import { resolveIrmaaThresholdForYear } from './irmaa';

function formatFilingStatusShort(status: FilingStatus): string {
  switch (status) {
    case 'married_filing_jointly':
      return 'MFJ';
    case 'married_filing_separately':
      return 'MFS';
    case 'head_of_household':
      return 'HOH';
    case 'single':
    default:
      return 'Single';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CustomGoalMetricOption {
  key: CustomGoalMetricKey;
  label: string;
  defaultUnit: 'currency' | 'percent';
}

export const CUSTOM_GOAL_METRIC_OPTIONS: CustomGoalMetricOption[] = [
  { key: 'manual', label: 'Manual / Custom Value (No auto-link)', defaultUnit: 'currency' },
  {
    key: 'ordinary_business_income',
    label: 'Projected Ordinary Business Income (1120-S Line 22)',
    defaultUnit: 'currency',
  },
  {
    key: 'gross_receipts',
    label: 'Projected Gross Receipts (Line 1a)',
    defaultUnit: 'currency',
  },
  {
    key: 'member_draws',
    label: 'Projected Member Draws / Distributions',
    defaultUnit: 'currency',
  },
  {
    key: 'ending_stock_basis',
    label: 'Projected Ending Stock Basis (Form 7203)',
    defaultUnit: 'currency',
  },
  {
    key: 'operating_cash_ye',
    label: 'Projected Year-End Operating Cash (Sch L)',
    defaultUnit: 'currency',
  },
  {
    key: 'net_cash_ye',
    label: 'Net Cash After Short-Term Liabilities (YE)',
    defaultUnit: 'currency',
  },
  {
    key: 'total_retirement',
    label: 'Total Projected DBP + Employer 401(k)',
    defaultUnit: 'currency',
  },
  {
    key: 'ca_revenue_pct',
    label: 'Projected Primary State Revenue Share (%)',
    defaultUnit: 'percent',
  },
];

export interface LinkedIrmaaCeilingMeta {
  projectionYear: number;
  coverageYear: number;
  threshold: number;
  filingStatus: FilingStatus;
  filingStatusShort: string;
  filingStatusLabel: string;
  isGoalTargetOverridden: boolean;
  isCoverageYearOverridden: boolean;
}

export interface EvaluatedPlanningGoal {
  goal: PlanningGoalGuardrail;
  status: PlanningGuardrailStatus;
  statusLabel: 'Within Guardrail' | 'Watch' | 'Over Target';
  targetDisplay: string;
  currentDisplay: string;
  currentNumeric: number | null;
  varianceSummary: string;
  linkedIrmaa?: LinkedIrmaaCeilingMeta;
}

const LEGACY_INCOME_CEILING_WHY =
  'Keeps pass-through / ordinary business income below your target threshold to avoid unwanted tax brackets, IRMAA surcharges, or benefit triggers (such as Social Security benefit taxation or phaseouts).';

export function getLinkedIrmaaCeilingForProjectionYear(
  projectionYear: number,
  setup?: SetupConfig
): {
  projectionYear: number;
  coverageYear: number;
  threshold: number;
  filingStatus: FilingStatus;
  filingStatusShort: string;
  filingStatusLabel: string;
  isCoverageYearOverridden: boolean;
} {
  const safeProjectionYear = Number.isFinite(projectionYear) ? projectionYear : 2026;
  const coverageYear = safeProjectionYear + 2;
  const filingStatus: FilingStatus = setup?.filing_status ?? 'married_filing_jointly';
  const resolved = resolveIrmaaThresholdForYear(coverageYear, setup);
  return {
    projectionYear: safeProjectionYear,
    coverageYear,
    threshold: resolved.effectiveThreshold,
    filingStatus,
    filingStatusShort: formatFilingStatusShort(filingStatus),
    filingStatusLabel: formatFilingStatus(filingStatus),
    isCoverageYearOverridden: resolved.isOverridden,
  };
}

export function buildIncomeCeilingWhyItMatters(
  projectionYear: number,
  coverageYear: number,
  effectiveTarget: number,
  linkedThreshold: number,
  isGoalTargetOverridden: boolean,
  filingStatusLabel = 'Married Filing Jointly'
): string {
  const targetStr = formatCurrencyExact(effectiveTarget);
  const linkedStr = formatCurrencyExact(linkedThreshold);
  if (isGoalTargetOverridden && Math.abs(effectiveTarget - linkedThreshold) > 0.005) {
    return `${projectionYear} income sets the two-year lookback for ${coverageYear} Medicare IRMAA Tier 1 (${filingStatusLabel}: ≤ ${linkedStr}); custom guardrail target set to ≤ ${targetStr} to keep pass-through / ordinary business income below your threshold and avoid IRMAA surcharges or benefit triggers.`;
  }
  return `${projectionYear} income sets the two-year lookback for ${coverageYear} Medicare IRMAA Tier 1 (${filingStatusLabel}: ≤ ${targetStr}). Keeping pass-through / ordinary business income at or below this threshold helps avoid Medicare IRMAA surcharges, higher tax brackets, and benefit phaseouts.`;
}

export function getStatusLabel(status: PlanningGuardrailStatus): 'Within Guardrail' | 'Watch' | 'Over Target' {
  if (status === 'over') return 'Over Target';
  if (status === 'watch') return 'Watch';
  return 'Within Guardrail';
}

export function generateCustomGoalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `goal-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Default planning goals & guardrails tailored to entity/module settings.
 * All five core guardrails are included so the user can check/uncheck or adjust thresholds anytime.
 */
export function createDefaultPlanningGoals(
  setup?: SetupConfig,
  projectionYear?: number
): PlanningGoalGuardrail[] {
  const hasStockBasis = setup ? setup.has_stock_basis !== false : true;
  const hasDbp = setup ? Boolean(setup.has_dbp || setup.has_401k_or_ira) : true;
  const hasMultiState = setup ? Boolean(setup.multi_state_active) : true;
  const activeProjectionYear = projectionYear ?? setup?.current_tax_year ?? 2026;
  const linkedIrmaa = getLinkedIrmaaCeilingForProjectionYear(activeProjectionYear, setup);

  return [
    {
      id: 'goal-income-ceiling',
      kind: 'income_ceiling',
      title: 'Income Ceiling Guardrail',
      enabled: true,
      target_value: linkedIrmaa.threshold,
      target_overridden: false,
      unit: 'currency',
      comparator: 'max',
      why_it_matters: buildIncomeCeilingWhyItMatters(
        linkedIrmaa.projectionYear,
        linkedIrmaa.coverageYear,
        linkedIrmaa.threshold,
        linkedIrmaa.threshold,
        false,
        linkedIrmaa.filingStatusLabel
      ),
      why_it_matters_custom: false,
    },
    {
      id: 'goal-stock-basis-floor',
      kind: 'stock_basis_floor',
      title: 'Non-Negative Stock Basis Floor',
      enabled: hasStockBasis,
      target_value: 0,
      unit: 'currency',
      comparator: 'min',
      why_it_matters:
        'Prevents member draws and distributions from exceeding shareholder stock basis (Form 7203), avoiding excess-distribution capital gain (Form 8949) or suspended losses.',
    },
    {
      id: 'goal-member-draw-cushion',
      kind: 'member_draw_cushion',
      title: 'Member Draw & Basis Cushion Guardrail',
      enabled: hasStockBasis,
      target_value: 25000,
      unit: 'currency',
      comparator: 'min',
      why_it_matters:
        'Keeps owner distributions aligned with available stock basis and projected year-end cash reserves so short-term liabilities and tax estimates remain comfortably covered.',
    },
    {
      id: 'goal-retirement-cap',
      kind: 'retirement_cap',
      title: 'Retirement Plan Contribution & Cap Guardrail',
      enabled: hasDbp,
      target_value: 75000,
      unit: 'currency',
      comparator: 'max',
      why_it_matters:
        'Tracks Defined Benefit Plan (DBP) and employer 401(k) contributions against actuarial deduction limits, year-end payable funding, and plan wind-down or termination plans.',
    },
    {
      id: 'goal-multistate-apportionment',
      kind: 'multistate_apportionment',
      title: 'Multi-State Sourcing & Apportionment Watch',
      enabled: hasMultiState,
      target_value: 50,
      unit: 'percent',
      comparator: 'max',
      why_it_matters: (() => {
        const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
        const stateMix =
          primaryStateCode && secondaryStateCode
            ? `${primaryStateCode} vs. ${secondaryStateCode} sourcing`
            : 'multi-state revenue sourcing';
        return `Tracks state revenue mix (${stateMix}) and nonresident filing considerations so year-end billing and state tax estimates stay aligned.`;
      })(),
    },
  ];
}

export function resolvePlanningGoals(
  saved: PlanningGoalGuardrail[] | undefined,
  setup?: SetupConfig,
  projectionYear?: number
): PlanningGoalGuardrail[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return createDefaultPlanningGoals(setup, projectionYear);
  }

  const activeProjectionYear = projectionYear ?? setup?.current_tax_year ?? 2026;
  const linkedIrmaa = getLinkedIrmaaCeilingForProjectionYear(activeProjectionYear, setup);
  const sameYearIrmaa = resolveIrmaaThresholdForYear(activeProjectionYear, setup).effectiveThreshold;

  return saved.map((goal) => {
    if (goal.kind !== 'income_ceiling') return goal;

    // Upgrade legacy saved defaults (which previously anchored to same-year IRMAA such as $218,000 MFJ / $109,000 Single
    // instead of the dynamic 2-year lookback coverage-year Tier 1 bracket)
    const isLegacySameYearValue =
      goal.target_value === null ||
      goal.target_value === 218000 ||
      goal.target_value === 109000 ||
      goal.target_value === 212000 ||
      goal.target_value === 106000 ||
      goal.target_value === sameYearIrmaa ||
      goal.target_value === linkedIrmaa.threshold;

    const isLegacyUntouchedTarget =
      goal.target_overridden === undefined && isLegacySameYearValue;

    const targetOverridden =
      goal.target_overridden === true
        ? true
        : goal.target_overridden === false || isLegacyUntouchedTarget
        ? false
        : true;

    const effectiveTarget =
      targetOverridden && typeof goal.target_value === 'number' && Number.isFinite(goal.target_value)
        ? goal.target_value
        : linkedIrmaa.threshold;

    const isLegacyOrEmptyWhy =
      !goal.why_it_matters_custom &&
      (!goal.why_it_matters.trim() || goal.why_it_matters.trim() === LEGACY_INCOME_CEILING_WHY);

    const whyCustom =
      goal.why_it_matters_custom === true
        ? true
        : goal.why_it_matters_custom === false || isLegacyOrEmptyWhy
        ? false
        : true;

    const effectiveWhy = whyCustom
      ? goal.why_it_matters
      : buildIncomeCeilingWhyItMatters(
          linkedIrmaa.projectionYear,
          linkedIrmaa.coverageYear,
          effectiveTarget,
          linkedIrmaa.threshold,
          targetOverridden,
          linkedIrmaa.filingStatusLabel
        );

    return {
      ...goal,
      target_value: effectiveTarget,
      target_overridden: targetOverridden,
      why_it_matters: effectiveWhy,
      why_it_matters_custom: whyCustom,
    };
  });
}

function fmtTarget(goal: PlanningGoalGuardrail): string {
  if (goal.unit === 'text' || goal.target_value === null) {
    return goal.target_label?.trim() || 'CPA Review Item';
  }
  const prefix = goal.comparator === 'max' ? '≤ ' : goal.comparator === 'min' ? '≥ ' : '';
  if (goal.unit === 'percent') {
    return `${prefix}${goal.target_value.toFixed(1)}%`;
  }
  return `${prefix}${formatCurrencyExact(goal.target_value)}`;
}

function fmtValue(val: number, unit: PlanningGoalGuardrail['unit']): string {
  if (unit === 'percent') return `${val.toFixed(1)}%`;
  return formatCurrencyExact(val);
}

function evaluateNumericAgainstTarget(
  actual: number,
  target: number,
  comparator: PlanningGoalGuardrail['comparator'],
  unit: PlanningGoalGuardrail['unit']
): { status: PlanningGuardrailStatus; varianceSummary: string } {
  const diff = round2(actual - target);
  const absDiff = Math.abs(diff);

  if (comparator === 'info') {
    return {
      status: 'within',
      varianceSummary: `Target reference ${fmtValue(target, unit)}`,
    };
  }

  if (comparator === 'max') {
    if (actual > target + 0.005) {
      return {
        status: 'over',
        varianceSummary: `Over ceiling by ${fmtValue(absDiff, unit)}`,
      };
    }
    const watchBand =
      unit === 'percent' ? Math.max(3, target * 0.1) : Math.max(5000, Math.abs(target) * 0.1);
    if (target - actual <= watchBand) {
      return {
        status: 'watch',
        varianceSummary: `Within ${fmtValue(absDiff, unit)} of ceiling`,
      };
    }
    return {
      status: 'within',
      varianceSummary: `${fmtValue(absDiff, unit)} below ceiling`,
    };
  }

  // comparator === 'min'
  if (actual < target - 0.005) {
    return {
      status: 'over',
      varianceSummary: `Short of floor by ${fmtValue(absDiff, unit)}`,
    };
  }
  const watchBand =
    unit === 'percent' ? 5 : target === 0 ? 10000 : Math.max(5000, Math.abs(target) * 0.15);
  if (actual - target < watchBand) {
    return {
      status: 'watch',
      varianceSummary: `Thin cushion: ${fmtValue(absDiff, unit)} above floor`,
    };
  }
  return {
    status: 'within',
    varianceSummary: `${fmtValue(absDiff, unit)} above floor`,
  };
}

function resolveCustomMetricNumeric(
  binding: CustomGoalMetricKey | undefined,
  computed: ComputedPnlBalanceSheet
): number | null {
  switch (binding) {
    case 'ordinary_business_income':
      return computed.ordinaryBusinessIncome.projected;
    case 'gross_receipts':
      return computed.totalRevenue.projected;
    case 'member_draws':
      return computed.projectedDrawsTotal;
    case 'ending_stock_basis':
      return computed.projectedEndingStockBasis;
    case 'operating_cash_ye':
      return computed.projectedCashYe;
    case 'net_cash_ye':
      return computed.netCashPositionYe;
    case 'total_retirement':
      return round2(
        computed.lines.dbp_contribution.projected + computed.lines.employer_401k.projected
      );
    case 'ca_revenue_pct':
      return computed.caPct.projected;
    default:
      return null;
  }
}

export function evaluatePlanningGoal(
  goal: PlanningGoalGuardrail,
  computed: ComputedPnlBalanceSheet,
  pnlState: PnlBalanceSheetState,
  setup?: SetupConfig
): EvaluatedPlanningGoal {
  const targetDisplay = fmtTarget(goal);

  if (goal.kind === 'income_ceiling') {
    const projectionYear = pnlState.projection_year || setup?.current_tax_year || 2026;
    const linked = getLinkedIrmaaCeilingForProjectionYear(projectionYear, setup);
    const isGoalTargetOverridden =
      goal.target_overridden === true &&
      typeof goal.target_value === 'number' &&
      Number.isFinite(goal.target_value) &&
      Math.abs(goal.target_value - linked.threshold) > 0.005;

    const target = isGoalTargetOverridden ? (goal.target_value as number) : linked.threshold;
    const actual = computed.ordinaryBusinessIncome.projected;
    const diff = round2(actual - target);
    const absDiff = Math.abs(diff);
    const res = evaluateNumericAgainstTarget(actual, target, goal.comparator, 'currency');

    const effectiveWhy = goal.why_it_matters_custom
      ? goal.why_it_matters
      : buildIncomeCeilingWhyItMatters(
          linked.projectionYear,
          linked.coverageYear,
          target,
          linked.threshold,
          isGoalTargetOverridden,
          linked.filingStatusLabel
        );

    const effectiveGoal: PlanningGoalGuardrail = {
      ...goal,
      target_value: target,
      target_overridden: isGoalTargetOverridden,
      why_it_matters: effectiveWhy,
    };

    const targetFormatted = formatCurrencyExact(target);
    const actualFormatted = formatCurrencyExact(actual);
    const benchmarkNote = isGoalTargetOverridden
      ? `Projected ${linked.projectionYear} 1120-S Line 22: ${actualFormatted}; ${linked.coverageYear} IRMAA Tier 1 (${linked.filingStatusShort}) is ${formatCurrencyExact(
          linked.threshold
        )}`
      : `Projected ${linked.projectionYear} 1120-S Line 22: ${actualFormatted} vs. ${linked.coverageYear} IRMAA Tier 1 (${linked.filingStatusShort} · 2-yr lookback)`;

    const varianceSummary =
      diff > 0.005
        ? `+${formatCurrencyExact(absDiff)} above ${targetFormatted} (${benchmarkNote})`
        : diff < -0.005
        ? `-${formatCurrencyExact(absDiff)} below ${targetFormatted} (${benchmarkNote})`
        : `$0.00 variance vs. ${targetFormatted} (${benchmarkNote})`;

    return {
      goal: effectiveGoal,
      status: res.status,
      statusLabel: getStatusLabel(res.status),
      targetDisplay: fmtTarget(effectiveGoal),
      currentDisplay: actualFormatted,
      currentNumeric: actual,
      varianceSummary,
      linkedIrmaa: {
        projectionYear: linked.projectionYear,
        coverageYear: linked.coverageYear,
        threshold: linked.threshold,
        filingStatus: linked.filingStatus,
        filingStatusShort: linked.filingStatusShort,
        filingStatusLabel: linked.filingStatusLabel,
        isGoalTargetOverridden,
        isCoverageYearOverridden: linked.isCoverageYearOverridden,
      },
    };
  }

  if (goal.kind === 'stock_basis_floor') {
    const actual = computed.projectedEndingStockBasis;
    const target = goal.target_value ?? 0;
    let status: PlanningGuardrailStatus = 'within';
    let varianceSummary = '';
    if (computed.drawsExceedBasis || actual < target - 0.005) {
      status = 'over';
      varianceSummary = computed.drawsExceedBasis
        ? `Draws exceed basis — Form 8949 excess gain ${formatCurrencyExact(
            computed.projectedExcessDistributionGain
          )}`
        : `Below floor by ${formatCurrencyExact(round2(target - actual))}`;
    } else if (actual - target < 10000) {
      status = 'watch';
      varianceSummary = `Thin cushion: ${formatCurrencyExact(round2(actual - target))} above floor`;
    } else {
      status = 'within';
      varianceSummary = `${formatCurrencyExact(round2(actual - target))} cushion · No excess dist. gain`;
    }

    return {
      goal,
      status,
      statusLabel: getStatusLabel(status),
      targetDisplay,
      currentDisplay: formatCurrencyExact(actual),
      currentNumeric: actual,
      varianceSummary,
    };
  }

  if (goal.kind === 'member_draw_cushion') {
    const useStockBasis = setup ? setup.has_stock_basis !== false : true;
    const basisCushion = computed.projectedEndingStockBasis;
    const cashCushion = computed.netCashPositionYe;
    const limitingCushion = useStockBasis ? Math.min(basisCushion, cashCushion) : cashCushion;
    const target = goal.target_value ?? 25000;

    const excl404Note =
      computed.subsequentYearRetirementAddback > 0 &&
      pnlState.balance_sheet.operating_cash_ye_override === null
        ? ' · excl. next-yr §404(a)(6) funding'
        : '';

    let status: PlanningGuardrailStatus = 'within';
    let detail = '';
    if ((useStockBasis && computed.drawsExceedBasis) || limitingCushion < 0) {
      status = 'over';
      detail =
        useStockBasis && computed.drawsExceedBasis
          ? `Draws (${formatCurrencyExact(computed.projectedDrawsTotal)}) exceed available basis`
          : `Negative reserve cushion (${formatCurrencyExact(limitingCushion)}) after draws`;
    } else if (limitingCushion < target - 0.005) {
      status = 'watch';
      detail = `${formatCurrencyExact(round2(target - limitingCushion))} below reserve target (Basis ${formatCurrencyExact(
        basisCushion
      )} · Net Cash ${formatCurrencyExact(cashCushion)}${excl404Note})`;
    } else {
      status = 'within';
      detail = `${formatCurrencyExact(round2(limitingCushion - target))} above cushion target (Draws ${formatCurrencyExact(
        computed.projectedDrawsTotal
      )} · Net Cash ${formatCurrencyExact(cashCushion)}${excl404Note})`;
    }

    return {
      goal,
      status,
      statusLabel: getStatusLabel(status),
      targetDisplay,
      currentDisplay: formatCurrencyExact(limitingCushion),
      currentNumeric: limitingCushion,
      varianceSummary: detail,
    };
  }

  if (goal.kind === 'retirement_cap') {
    const dbp = computed.lines.dbp_contribution.projected;
    const k401 = computed.lines.employer_401k.projected;
    const totalRet = round2(dbp + k401);
    const target = goal.target_value ?? 75000;
    const res = evaluateNumericAgainstTarget(totalRet, target, goal.comparator, 'currency');
    const payableNote =
      pnlState.balance_sheet.pension_payable_ye > 0
        ? ` · YE Payable ${formatCurrencyExact(pnlState.balance_sheet.pension_payable_ye)}`
        : totalRet > 0
        ? ' · YE Payable $0.00 (IRC §404(a)(6) / cash-basis)'
        : '';
    return {
      goal,
      status: res.status,
      statusLabel: getStatusLabel(res.status),
      targetDisplay,
      currentDisplay: formatCurrencyExact(totalRet),
      currentNumeric: totalRet,
      varianceSummary: `${res.varianceSummary} (DBP ${formatCurrencyExact(dbp)} + 401(k) ${formatCurrencyExact(
        k401
      )}${payableNote})`,
    };
  }

  if (goal.kind === 'multistate_apportionment') {
    const s1Pct = computed.caPct.projected;
    const s2Pct = computed.azPct.projected;
    const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
    const s1 = primaryStateCode || 'State 1';
    const s2 = secondaryStateCode || 'State 2';
    const target = goal.target_value ?? 50;
    const res = evaluateNumericAgainstTarget(s1Pct, target, goal.comparator, 'percent');
    return {
      goal,
      status: res.status,
      statusLabel: getStatusLabel(res.status),
      targetDisplay: `${targetDisplay} ${s1}`,
      currentDisplay: setup?.multi_state_active
        ? `${s1} ${s1Pct.toFixed(1)}% / ${s2} ${s2Pct.toFixed(1)}%`
        : `${s1} ${s1Pct.toFixed(1)}%`,
      currentNumeric: s1Pct,
      varianceSummary: `${res.varianceSummary} (${s1} ${formatCurrencyExact(
        computed.lines.ca_revenue.projected
      )}${
        setup?.multi_state_active
          ? ` · ${s2} ${formatCurrencyExact(computed.lines.az_revenue.projected)}`
          : ''
      })`,
    };
  }

  // Custom goal
  const boundNumeric = resolveCustomMetricNumeric(goal.metric_binding, computed);
  const currentNumeric =
    boundNumeric !== null
      ? boundNumeric
      : typeof goal.custom_current_value === 'number' && Number.isFinite(goal.custom_current_value)
      ? goal.custom_current_value
      : null;

  if (goal.unit === 'text' || goal.target_value === null) {
    return {
      goal,
      status: 'within',
      statusLabel: 'Within Guardrail',
      targetDisplay,
      currentDisplay: goal.custom_current_label?.trim() || 'For CPA Discussion',
      currentNumeric: null,
      varianceSummary: goal.custom_current_label?.trim()
        ? `Current status: ${goal.custom_current_label.trim()}`
        : 'Qualitative planning objective',
    };
  }

  if (currentNumeric === null) {
    return {
      goal,
      status: 'watch',
      statusLabel: 'Watch',
      targetDisplay,
      currentDisplay: 'Not entered',
      currentNumeric: null,
      varianceSummary: 'Enter current value or link a live metric to evaluate',
    };
  }

  const res = evaluateNumericAgainstTarget(currentNumeric, goal.target_value, goal.comparator, goal.unit);
  return {
    goal,
    status: res.status,
    statusLabel: getStatusLabel(res.status),
    targetDisplay,
    currentDisplay: fmtValue(currentNumeric, goal.unit),
    currentNumeric,
    varianceSummary: res.varianceSummary,
  };
}

export function evaluateAllPlanningGoals(
  goals: PlanningGoalGuardrail[],
  computed: ComputedPnlBalanceSheet,
  pnlState: PnlBalanceSheetState,
  setup?: SetupConfig
): EvaluatedPlanningGoal[] {
  return goals.map((g) => evaluatePlanningGoal(g, computed, pnlState, setup));
}
