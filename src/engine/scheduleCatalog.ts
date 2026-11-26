import type { ComputedTaxYear, SetupConfig } from '../types/tax';
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format';
import { getSetupPersonNames, getSetupStates } from '../utils/setupHelpers';
import {
  formatTaxBalanceDue,
  getYearTaxBalances,
  getYearTaxPayments,
} from '../utils/taxPayments';
import { resolveIrmaaThresholdForYear } from './irmaa';
import { DEFAULT_PROFILE_SEED, isDefaultSeedSetup } from '../data/profiles';

function formatCompactBalanceDue(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded < 0) {
    return `(${formatCompactCurrency(Math.abs(rounded))})`;
  }
  return formatCompactCurrency(rounded);
}

function getDefaultFiledRef(
  taxYear: number,
  setup: SetupConfig,
  amount: number
): string | undefined {
  if (taxYear !== 2025 || !isDefaultSeedSetup(setup)) return undefined;
  return `Filed: ${formatCurrency(amount)}`;
}

export type ScheduleSectionId =
  | 'income_comp'
  | 'scorp_basis'
  | 'retirement_health'
  | 'personal_taxable'
  | 'tax_cashflow'
  | 'taxes_paid';

export interface ScheduleSectionMeta {
  id: ScheduleSectionId;
  title: string;
  shortTitle: string;
  description: string;
}

export type CellTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';

export type ScheduleEditField =
  | 'ca_scorp_revenue'
  | 'az_scorp_revenue'
  | 'operating_expenses'
  | 'debra_w2'
  | 'bill_w2'
  | 'ss_debra'
  | 'ss_bill'
  | 'member_draws'
  | 'capital_contributions'
  | 'dbp_contribution'
  | 'sehi_medicare_premiums'
  | 'irmaa_threshold'
  | 'federal_taxes_paid'
  | 'federal_tax_withholding'
  | 'federal_estimated_tax_payments'
  | 'state_taxes_paid'
  | 'primary_state_taxes_paid'
  | 'secondary_state_taxes_paid';

export interface ScheduleCellResult {
  /** Primary formatted value displayed right-aligned in monospace tabular numerals */
  display: string;
  /** Numeric value for 6-year total aggregation when summable */
  numericValue?: number;
  /** Raw editable numeric value for inline input cells */
  rawEditValue?: number;
  /** True when an auto-escalated cell (SS / SEHI Medicare) is using a manual inline override */
  isOverridden?: boolean;
  /** Optional compact sub-label aligned directly under the cell */
  subLabel?: string;
  /** Semantic tone for the sub-label */
  subTone?: CellTone;
  /** Optional subtle filed-return reference sub-label shown for Year 1 (2025) comparison */
  filedRef?: string;
  /** Optional filed-return reference shown in a compact hover tooltip instead of an extra stacked row */
  filedRefTooltip?: string;
  /** Optional compact breakdown detail shown in a hover tooltip to keep cells within 2 lines max */
  detailTooltip?: string;
  /** Optional compact inline status/flag badge */
  badge?: {
    text: string;
    tone: CellTone;
  };
}

export interface ScheduleLineItem {
  id: string;
  section: ScheduleSectionId;
  /** Optional parent row id when this line item belongs to an expandable/collapsible parent group */
  parentId?: string;
  label: string;
  getLabel?: (setup: SetupConfig) => string;
  code: string;
  description: string;
  bold?: boolean;
  highlight?: 'primary' | 'secondary';
  summable?: boolean;
  editField?: ScheduleEditField;
  computeCell: (
    c: ComputedTaxYear,
    index: number,
    allYears: ComputedTaxYear[],
    setup: SetupConfig
  ) => ScheduleCellResult;
  computeTotalDisplay?: (allYears: ComputedTaxYear[], setup: SetupConfig) => string;
}

export function getPersonNames(setup: SetupConfig): {
  primaryName: string;
  spouseName: string;
} {
  return getSetupPersonNames(setup);
}

export function getScheduleRowLabel(row: ScheduleLineItem, setup: SetupConfig): string {
  return row.getLabel ? row.getLabel(setup) : row.label;
}

export const SCHEDULE_SECTIONS: ScheduleSectionMeta[] = [
  {
    id: 'income_comp',
    title: 'Group 1 — Income & Compensation Inputs (Prior-Year Locked · Forecast Editable)',
    shortTitle: 'Group 1 · Income & Compensation',
    description: 'S-Corp gross revenue, per-spouse W-2 compensation, and individual Social Security schedules.',
  },
  {
    id: 'scorp_basis',
    title: 'Group 2 — S-Corp Profit, Draws & Stock Basis',
    shortTitle: 'Group 2 · S-Corp Profit & Basis',
    description: 'Pass-through K-1 profit, member draws, capital contributions, Form 7203 ending stock basis, and Form 8949 excess gain.',
  },
  {
    id: 'retirement_health',
    title: 'Group 3 — Retirement & Health Deductions',
    shortTitle: 'Group 3 · Retirement & Health',
    description: 'Defined Benefit Plan contributions, 401(k) employer profit sharing & employee deferrals, tax shield value, and SEHI Medicare.',
  },
  {
    id: 'personal_taxable',
    title: 'Group 4 — Personal Taxable Income & Threshold Flags',
    shortTitle: 'Group 4 · Taxable Income & Flags',
    description: 'Enhanced Senior Deduction, Section 199A QBI, taxable Social Security, Joint AGI with IRMAA cliff watchdog, and taxable income headroom.',
  },
  {
    id: 'tax_cashflow',
    title: 'Group 5 — Tax Liability, Rates & Cash Flow',
    shortTitle: 'Group 5 · Taxes, Rates & Cash Flow',
    description: 'Federal, employee/employer FICA, state taxes, combined totals, payments & balance due, rates, safe harbor estimates, and net household cash flow.',
  },
  {
    id: 'taxes_paid',
    title: 'Group 6 — Taxes Paid (Withholding & Estimates)',
    shortTitle: 'Group 6 · Taxes Paid',
    description: 'Editable annual federal and state withholding & estimated tax payments, synced with Form 1040 and Multi-State filings and structured for future Quicken/CSV import.',
  },
];

function getSafeHarborInfo(
  c: ComputedTaxYear,
  index: number,
  allYears: ComputedTaxYear[]
): { amount: number; basisLabel: string; tone: CellTone } {
  const cy90 = Math.round(c.form_1040_out.federal_income_tax * 0.9);
  if (index === 0) {
    return { amount: cy90, basisLabel: '90% CY Safe', tone: 'neutral' };
  }
  const prev = allYears[index - 1];
  const prevAgi = prev.form_1040_out.adjusted_gross_income;
  const pyMult = prevAgi > 150000 ? 1.1 : 1.0;
  const pySafe = Math.round(prev.form_1040_out.federal_income_tax * pyMult);
  if (pySafe <= cy90) {
    return {
      amount: pySafe,
      basisLabel: prevAgi > 150000 ? '110% PY Safe' : '100% PY Safe',
      tone: 'accent',
    };
  }
  return { amount: cy90, basisLabel: '90% CY Safe', tone: 'positive' };
}

function computeDynamicStateCell(
  c: ComputedTaxYear,
  setup: SetupConfig,
  slot: 'primary' | 'secondary'
): ScheduleCellResult {
  const states = getSetupStates(setup);
  const targetCode =
    slot === 'primary' ? states.primaryStateCode : states.secondaryStateCode;

  const filing = targetCode
    ? c.state_filings_out.find((sf) => sf.state_code === targetCode)
    : slot === 'primary'
    ? c.state_filings_out[0]
    : c.state_filings_out[1];

  if (!filing) {
    return {
      display: '$0',
      numericValue: 0,
      badge: { text: targetCode ? `${targetCode} Inactive` : 'Not active', tone: 'neutral' },
    };
  }

  const stateCode = filing.state_code;
  const appPct = Number((filing.state_apportionment_factor * 100).toFixed(1));
  const persTax = filing.state_personal_tax_liability;
  const entityTax = filing.state_entity_tax_liability;
  const pteTax = filing.state_pte_payment_amount;
  const totalTax = filing.state_income_tax_liability;

  // No-income-tax states (TX, WA, NV, FL, TN, etc.)
  if (totalTax === 0 && persTax === 0 && entityTax === 0 && pteTax === 0 && filing.credit_for_taxes_paid_to_other_states === 0) {
    const resLabel =
      filing.residency_status === 'resident'
        ? `${stateCode} Res`
        : filing.residency_status === 'part_year_resident'
        ? `${stateCode} Part-Yr`
        : `${stateCode} Non-Res`;
    return {
      display: '$0',
      numericValue: 0,
      badge: { text: resLabel, tone: 'positive' },
      detailTooltip: `${stateCode} · 0% state income tax`,
    };
  }

  if (stateCode === 'CA') {
    const otherRes = c.state_filings_out.find(
      (sf) => sf.state_code !== 'CA' && sf.residency_status !== 'non_resident'
    );
    let badgeText: string;
    let badgeTone: CellTone;
    let formCode: string;

    if (filing.residency_status === 'resident') {
      badgeText = 'CA Res';
      badgeTone = 'accent';
      formCode = '540';
    } else if (filing.residency_status === 'part_year_resident') {
      badgeText = otherRes ? `Part-Yr CA/${otherRes.state_code}` : 'Part-Yr CA';
      badgeTone = 'warning';
      formCode = '540NR';
    } else {
      badgeText = 'CA Non-Res';
      badgeTone = otherRes?.residency_status === 'resident' ? 'positive' : 'neutral';
      formCode = '540NR';
    }

    const bizTotal = entityTax + pteTax;
    const bizTag = pteTax > 0 ? '100S/PTE' : '100S';
    const detailTooltip = `${bizTag} ${formatCurrency(bizTotal)} · ${formCode} ${formatCurrency(persTax)}`;

    return {
      display: formatCurrency(totalTax),
      numericValue: totalTax,
      badge: { text: badgeText, tone: badgeTone },
      detailTooltip,
    };
  }

  const badgeText =
    filing.residency_status === 'resident'
      ? `${stateCode} Res`
      : filing.residency_status === 'part_year_resident'
      ? `${stateCode} Part-Yr · ${appPct}%`
      : `${stateCode} Non-Res · ${appPct}%`;
  const badgeTone: CellTone =
    filing.residency_status === 'resident'
      ? 'accent'
      : filing.residency_status === 'part_year_resident'
      ? 'warning'
      : 'neutral';

  let detailTooltip: string;
  if (pteTax > 0) {
    detailTooltip = `PTE ${formatCurrency(pteTax)} · Pers ${formatCurrency(persTax)}`;
  } else if (filing.credit_for_taxes_paid_to_other_states > 0) {
    detailTooltip = `Pers ${formatCurrency(persTax)} · OSTC -${formatCurrency(
      filing.credit_for_taxes_paid_to_other_states
    )}`;
  } else if (entityTax > 0) {
    detailTooltip = `Entity ${formatCurrency(entityTax)} · Pers ${formatCurrency(persTax)}`;
  } else {
    detailTooltip = `${stateCode} Pers ${formatCurrency(persTax)}`;
  }

  return {
    display: formatCurrency(totalTax),
    numericValue: totalTax,
    badge: { text: badgeText, tone: badgeTone },
    detailTooltip,
  };
}

export const MASTER_SCHEDULE_CATALOG: ScheduleLineItem[] = [
  // =========================================================================
  // Group 1 — Income & Compensation Inputs
  // =========================================================================
  {
    id: 'scorp_gross_revenue',
    section: 'income_comp',
    label: 'Total S-Corp Gross Revenue',
    code: 'gross_receipts_revenue',
    description: 'Auto-calculated sum of S-Corp gross receipts across active states (expand to edit individual state revenues).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const s1 = setup.has_scorp ? c.scorp_in.ca_revenue : 0;
      const s2 = setup.has_scorp ? c.scorp_in.az_revenue : 0;
      const total = setup.has_scorp ? s1 + s2 : 0;
      return {
        display: formatCurrency(total),
        numericValue: total,
      };
    },
  },
  {
    id: 'ca_scorp_revenue',
    section: 'income_comp',
    parentId: 'scorp_gross_revenue',
    label: 'Primary State S-Corp Revenue',
    getLabel: (s) => {
      const { primaryStateName, hasPrimaryState } = getSetupStates(s);
      return hasPrimaryState ? `${primaryStateName} S-Corp Revenue` : 'Primary S-Corp Revenue';
    },
    code: 'ca_revenue',
    description: 'Primary-state S-Corp gross receipts (inline editable in forecast years). Drives primary state apportionment %.',
    summable: true,
    editField: 'ca_scorp_revenue',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.ca_revenue : 0;
      const total = setup.has_scorp ? c.scorp_in.gross_receipts_revenue : 0;
      const pct = total > 0 ? (val / total) * 100 : 0;
      const { primaryStateCode } = getSetupStates(setup);
      const stateTag = primaryStateCode || 'Primary';
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: setup.has_scorp ? `${pct.toFixed(1)}% ${stateTag} share` : 'S-Corp off',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'az_scorp_revenue',
    section: 'income_comp',
    parentId: 'scorp_gross_revenue',
    label: 'Secondary State S-Corp Revenue',
    getLabel: (s) => {
      const { secondaryStateName, hasSecondaryState } = getSetupStates(s);
      return hasSecondaryState
        ? `${secondaryStateName} S-Corp Revenue`
        : 'Secondary State S-Corp Revenue';
    },
    code: 'az_revenue',
    description: 'Secondary-state S-Corp gross receipts when multi-state apportionment is active.',
    summable: true,
    editField: 'az_scorp_revenue',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.az_revenue : 0;
      const total = setup.has_scorp ? c.scorp_in.gross_receipts_revenue : 0;
      const pct = total > 0 ? (val / total) * 100 : 0;
      const { secondaryStateCode } = getSetupStates(setup);
      const stateTag = secondaryStateCode || 'Secondary';
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: setup.has_scorp ? `${pct.toFixed(1)}% ${stateTag} share` : 'S-Corp off',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'total_w2_comp',
    section: 'income_comp',
    label: 'Total W-2 Compensation',
    code: 'total_w2_compensation',
    description: 'Auto-calculated combined cash W-2 compensation (expand to edit individual W-2 compensation inputs).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const primaryVal = setup.has_scorp ? c.scorp_in.bill_w2_wages : c.form_1040_in.w2_wages_total;
      const spouseVal =
        setup.has_scorp && setup.filing_status === 'married_filing_jointly'
          ? c.scorp_in.debra_w2_wages
          : 0;
      const total = primaryVal + spouseVal;
      return {
        display: formatCurrency(total),
        numericValue: total,
      };
    },
  },
  {
    id: 'bill_w2_comp',
    section: 'income_comp',
    parentId: 'total_w2_comp',
    label: 'Primary W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).primaryName} W-2 Compensation`,
    code: 'bill_w2_wages',
    description: 'Primary Taxpayer cash W-2 compensation (Box 3/5 FICA & 401(k) wage base, excluding S-Corp >2% SEHI add-back; inline editable in forecast years).',
    summable: true,
    editField: 'bill_w2',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.bill_w2_wages : c.form_1040_in.w2_wages_total;
      const box1 = c.form_1040_in.use_explicit_w2_box1 ? c.form_1040_in.bill_w2_box1 : undefined;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: box1 !== undefined ? `Box 1: ${formatCurrency(box1)}` : undefined,
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'debra_w2_comp',
    section: 'income_comp',
    parentId: 'total_w2_comp',
    label: 'Spouse W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).spouseName} W-2 Compensation`,
    code: 'debra_w2_wages',
    description: 'Spouse officer cash W-2 compensation (Box 3/5 FICA & 401(k) wage base, excluding S-Corp >2% SEHI add-back; inline editable in forecast years).',
    summable: true,
    editField: 'debra_w2',
    computeCell: (c, _i, _all, setup) => {
      const val =
        setup.has_scorp && setup.filing_status === 'married_filing_jointly'
          ? c.scorp_in.debra_w2_wages
          : 0;
      const box1 = c.form_1040_in.use_explicit_w2_box1 ? c.form_1040_in.debra_w2_box1 : undefined;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel:
          setup.filing_status !== 'married_filing_jointly'
            ? 'Single filing'
            : box1 !== undefined
            ? `Box 1: ${formatCurrency(box1)}`
            : undefined,
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'total_social_security',
    section: 'income_comp',
    label: 'Total Social Security',
    code: 'social_security_gross_effective',
    description: 'Auto-calculated combined annual gross Social Security benefits (expand to edit individual schedules and status toggles).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const primaryVal = c.form_1040_out.primary_ss_gross;
      const spouseVal =
        setup.filing_status === 'married_filing_jointly' ? c.form_1040_out.spouse_ss_gross : 0;
      const total = primaryVal + spouseVal;
      return {
        display: formatCurrency(total),
        numericValue: total,
      };
    },
  },
  {
    id: 'ss_bill',
    section: 'income_comp',
    parentId: 'total_social_security',
    label: 'Primary Social Security',
    getLabel: (s) => {
      const { primaryName } = getPersonNames(s);
      return primaryName === 'Primary'
        ? 'Primary Social Security'
        : `Primary (${primaryName}) Social Security`;
    },
    code: 'primary_ss_gross',
    description: 'Primary Taxpayer annual gross Social Security benefit with On / Suspended / Off toggle and inline dollar override.',
    summable: true,
    editField: 'ss_bill',
    computeCell: (c) => {
      const val = c.form_1040_out.primary_ss_gross;
      const mode = c.form_1040_out.primary_ss_mode;
      const isOverridden =
        !c.is_locked_actuals &&
        mode === 'on' &&
        typeof c.form_1040_in.ss_bill_override === 'number' &&
        Number.isFinite(c.form_1040_in.ss_bill_override);
      const rawStatus = c.form_1040_out.primary_ss_status;
      const subLabel = isOverridden
        ? rawStatus.includes('DRC')
          ? rawStatus.replace(/^Override\s*/, '')
          : undefined
        : rawStatus;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        isOverridden,
        subLabel,
        subTone:
          mode === 'suspended'
            ? 'accent'
            : mode === 'on' && val > 0
            ? 'positive'
            : 'neutral',
      };
    },
  },
  {
    id: 'ss_debra',
    section: 'income_comp',
    parentId: 'total_social_security',
    label: 'Spouse Social Security',
    getLabel: (s) => {
      const { spouseName } = getPersonNames(s);
      return spouseName === 'Spouse'
        ? 'Spouse Social Security'
        : `Spouse (${spouseName}) Social Security`;
    },
    code: 'spouse_ss_gross',
    description: 'Spouse annual gross Social Security benefit with On / Suspended / Off toggle and inline dollar override.',
    summable: true,
    editField: 'ss_debra',
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_out.spouse_ss_gross;
      const mode = c.form_1040_out.spouse_ss_mode;
      const isOverridden =
        !c.is_locked_actuals &&
        setup.filing_status === 'married_filing_jointly' &&
        mode === 'on' &&
        typeof c.form_1040_in.ss_debra_override === 'number' &&
        Number.isFinite(c.form_1040_in.ss_debra_override);
      const rawStatus = c.form_1040_out.spouse_ss_status;
      const subLabel = isOverridden
        ? rawStatus.includes('DRC')
          ? rawStatus.replace(/^Override\s*/, '')
          : undefined
        : rawStatus;
      return {
        display:
          setup.filing_status === 'married_filing_jointly' ? formatCurrency(val) : '—',
        numericValue: val,
        rawEditValue: val,
        isOverridden,
        subLabel,
        subTone:
          mode === 'suspended'
            ? 'accent'
            : mode === 'on' && val > 0
            ? 'positive'
            : 'neutral',
      };
    },
  },

  // =========================================================================
  // Group 2 — S-Corp Profit, Draws & Stock Basis
  // =========================================================================
  {
    id: 'scorp_operating_expenses',
    section: 'scorp_basis',
    label: 'S-Corp Operating Expenses',
    code: 'effective_operating_expenses',
    description:
      'Non-payroll, non-retirement S-Corp operating expenses (excludes W-2 wages, employer payroll taxes, >2% SEHI, DBP, and employer 401(k)). Unlocked future forecast years auto-scale proportionally with Gross Revenue unless switched to Fixed mode or manually overridden per year.',
    summable: true,
    editField: 'operating_expenses',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_out.effective_operating_expenses : 0;
      const rev = setup.has_scorp ? c.scorp_in.gross_receipts_revenue : 0;
      const pctOfRev = rev > 0 ? ((val / rev) * 100).toFixed(1) : '0.0';
      const setupBaseYear = setup.current_tax_year ?? 2026;
      const ratioPct = Number(((setup.assumptions.expense_ratio ?? 0.2) * 100).toFixed(1));
      const isOverridden = setup.has_scorp && c.scorp_out.operating_expenses_is_overridden;
      const isScaled = setup.has_scorp && c.scorp_out.operating_expenses_is_scaled;

      let subLabel: string | undefined;
      if (!setup.has_scorp) {
        subLabel = 'S-Corp off';
      } else if (c.is_locked_actuals) {
        subLabel = `${pctOfRev}% rev · Act`;
      } else if (isOverridden) {
        subLabel = `${pctOfRev}% rev`;
      } else if (isScaled) {
        subLabel = `${ratioPct}% rev (auto)`;
      } else if (c.tax_year <= setupBaseYear) {
        subLabel = `${pctOfRev}% rev (base)`;
      } else {
        subLabel = `${pctOfRev}% rev (fixed)`;
      }

      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        isOverridden,
        subLabel,
        subTone: isScaled ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'scorp_k1_profit',
    section: 'scorp_basis',
    label: 'S-Corp K-1 Profit (Line 22)',
    code: 'schedule_k1_ordinary_income',
    description: 'Form 1120-S Line 22 ordinary business income passing through to Form 1040 via Schedule K-1 Box 1 (net of operating expenses, cash W-2, S-Corp >2% SEHI, employer payroll taxes, DBP, employer 401(k), and PTE).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_in.schedule_k1_ordinary_income;
      return {
        display: formatCurrency(val),
        numericValue: val,
        subLabel:
          c.tax_year === 2025
            ? undefined
            : setup.has_scorp
            ? 'Auto calc · K-1 Box 1'
            : 'S-Corp off',
        subTone: 'neutral',
        filedRef: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.k1_ordinary_income
        ),
      };
    },
  },
  {
    id: 'member_draws',
    section: 'scorp_basis',
    label: 'Member Draws',
    code: 'scorp_distributions_total',
    description: 'Shareholder cash distributions from S-Corp (inline editable 2026–2030).',
    summable: true,
    editField: 'member_draws',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.scorp_distributions_total : 0;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
      };
    },
  },
  {
    id: 'capital_contributions',
    section: 'scorp_basis',
    label: 'Capital Contributions (Basis Added)',
    code: 'capital_contributions',
    description: 'Shareholder paid-in capital increasing Form 7203 stock basis (inline editable 2026–2030).',
    summable: true,
    editField: 'capital_contributions',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.capital_contributions || 0 : 0;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
      };
    },
  },
  {
    id: 'ending_stock_basis',
    section: 'scorp_basis',
    label: 'Ending Stock Basis',
    code: 'stock_basis_ending',
    description: 'Prior Basis + K-1 Profit + Sch K Interest + Capital Contributions − Member Draws − Nondeductible (Form 7203).',
    bold: true,
    summable: false,
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_out.stock_basis_ending : 0;
      return {
        display: setup.has_scorp ? formatCurrency(val) : '—',
        subLabel: setup.has_scorp
          ? `Beg ${formatCompactCurrency(c.scorp_in.stock_basis_beginning)}`
          : undefined,
        subTone: setup.has_scorp && val <= 0 ? 'warning' : 'neutral',
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.ending_stock_basis
        ),
      };
    },
  },
  {
    id: 'form_8949_excess_gain',
    section: 'scorp_basis',
    label: 'Form 8949 Excess Gain (Cap Gain)',
    code: 'excess_distribution_capital_gain',
    description: 'Taxable capital gain triggered whenever Member Draws exceed available stock basis.',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const excess = c.scorp_out.excess_distribution_capital_gain;
      return {
        display: formatCurrency(excess),
        numericValue: excess,
        badge:
          excess > 0
            ? { text: 'Basis Exceeded', tone: 'danger' }
            : { text: 'Basis OK', tone: 'positive' },
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.excess_dist_gain
        ),
      };
    },
  },

  // =========================================================================
  // Group 3 — Retirement & Health Deductions
  // =========================================================================
  {
    id: 'dbp_contribution',
    section: 'retirement_health',
    label: 'Defined Benefit Plan Contributions',
    code: 'dbp_actual_contribution',
    description:
      'Defined Benefit Plan deductible contribution (inline editable; defaults to $0 starting in Termination Year + 1). Expand to view DBP + Profit Share tax savings.',
    bold: true,
    summable: true,
    editField: 'dbp_contribution',
    computeCell: (c, _i, _all, setup) => {
      const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
      const isPostTerm = setup.has_dbp && termYear !== null && c.tax_year > termYear;
      const val =
        setup.has_dbp && c.dbp_in.dbp_status !== 'terminated'
          ? c.dbp_in.dbp_actual_contribution
          : 0;
      const statusText = !setup.has_dbp
        ? 'DBP inactive'
        : isPostTerm || c.dbp_in.dbp_status === 'terminated'
        ? 'Terminated'
        : c.dbp_in.dbp_status === 'terminating'
        ? 'Final year'
        : 'Active';
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: statusText,
        subTone:
          c.dbp_in.dbp_status === 'terminating'
            ? 'warning'
            : val > 0
            ? 'accent'
            : 'neutral',
      };
    },
  },
  {
    id: 'dbp_ps_tax_reduction',
    section: 'retirement_health',
    parentId: 'dbp_contribution',
    label: 'DBP + Profit Share Tax Reduction',
    code: 'dbp_and_ps_tax_reduction',
    description: 'Estimated federal tax shield from entity-deductible DBP and Employer 401(k) profit-sharing contributions.',
    summable: true,
    computeCell: (c) => {
      const shield = c.form_1040_out.dbp_and_ps_tax_reduction;
      const isZeroFedTax =
        c.form_1040_out.taxable_income <= 0 && c.form_1040_out.federal_income_tax <= 0;
      return {
        display: formatCurrency(shield),
        numericValue: shield,
        subLabel:
          isZeroFedTax
            ? '$0 · 0% marginal'
            : shield > 0
            ? `@ ${formatPercent(c.form_1040_out.marginal_tax_rate, 0)} marginal`
            : 'No active shield',
        subTone: shield > 0 ? 'positive' : 'neutral',
      };
    },
  },
  {
    id: 'total_401k_contributions',
    section: 'retirement_health',
    label: '401(k) Contributions',
    code: 'total_401k_contributions',
    description:
      'Auto-calculated combined Employer 401(k) Profit Sharing / Match plus Employee 401(k) Elective Deferrals (expand to view employer vs. employee breakdown).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const emp = c.form_1040_out.employer_401k_total;
      const ee = c.form_1040_out.employee_401k_total;
      const total = emp + ee;
      return {
        display: formatCurrency(total),
        numericValue: total,
        subLabel: !setup.has_401k_or_ira ? 'Inactive' : 'Employer + Employee',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'employer_401k_ps',
    section: 'retirement_health',
    parentId: 'total_401k_contributions',
    label: 'Employer 401(k) Profit Sharing / Match',
    code: 'employer_401k_total',
    description: 'Employer profit sharing: 6% IRC §404(a)(7) combined-plan cap while DBP is active; rises to 25% of cash W-2 wages once DBP is terminated (subject to IRS §415(c)).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_out.employer_401k_total;
      const pct = Math.round(c.form_1040_out.employer_401k_rate_applied * 1000) / 10;
      const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
      const isDbpTerminatedOrInactive =
        !setup.has_dbp ||
        c.dbp_in.dbp_status === 'terminated' ||
        (termYear !== null && c.tax_year > termYear && c.dbp_in.dbp_status !== 'active');
      return {
        display: formatCurrency(val),
        numericValue: val,
        subLabel:
          !setup.has_401k_or_ira || !setup.has_scorp
            ? 'Inactive'
            : isDbpTerminatedOrInactive
            ? `${pct}% elected · 25% max`
            : `${pct}% DBP cap`,
        subTone: isDbpTerminatedOrInactive && pct > 6 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'employee_401k_deferrals',
    section: 'retirement_health',
    parentId: 'total_401k_contributions',
    label: 'Employee 401(k) Elective Deferrals',
    code: 'employee_401k_total',
    description: 'Maximized per person from W-2 minus employee FICA, capped at annual IRS 402(g) + age 50+/60–63 catch-up limits.',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const total = c.form_1040_out.employee_401k_total;
      const d = c.form_1040_out.employee_401k_debra;
      const b = c.form_1040_out.employee_401k_bill;
      let subLabel = 'Inactive';
      if (setup.has_401k_or_ira && total > 0) {
        const { primaryName, spouseName } = getPersonNames(setup);
        const pInit = primaryName.charAt(0).toUpperCase();
        const sInit = spouseName.charAt(0).toUpperCase();
        subLabel =
          d > 0
            ? `${pInit} ${formatCompactCurrency(b)} · ${sInit} ${formatCompactCurrency(d)}`
            : `${pInit} ${formatCompactCurrency(b)}`;
      }
      return {
        display: formatCurrency(total),
        numericValue: total,
        subLabel,
        subTone: total > 0 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'sehi_medicare_premiums',
    section: 'retirement_health',
    label: 'Medicare Premiums (SEHI)',
    code: 'sehi_medicare_premiums_effective',
    description:
      'Pulls enrolled Medicare / health premiums from Setup (exact in Current Tax Year, escalated by Medicare inflation in Current Year + 1); inline editable with override & reset controls. Expand to view the Schedule 1 Line 17 deduction.',
    bold: true,
    summable: true,
    editField: 'sehi_medicare_premiums',
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_out.sehi_medicare_premiums_effective;
      const isOverridden =
        !c.is_locked_actuals &&
        typeof c.form_1040_in.sehi_medicare_override === 'number' &&
        Number.isFinite(c.form_1040_in.sehi_medicare_override);
      const setupMedCombined =
        c.form_1040_out.primary_medicare_base_annual +
        c.form_1040_out.spouse_medicare_base_annual;
      const setupBaseYear = setup.current_tax_year ?? 2026;
      const medPct = Number(((setup.assumptions.medicare_inflation_rate ?? 0.055) * 100).toFixed(1));
      const hasIrmaa = c.form_1040_out.irmaa_annual_surcharge > 0;

      let subLabel: string | undefined;
      if (c.is_locked_actuals) {
        subLabel = `${c.tax_year} Actuals`;
      } else if (isOverridden) {
        subLabel = undefined;
      } else if (setupMedCombined > 0) {
        if (c.tax_year <= setupBaseYear) {
          subLabel = hasIrmaa ? `${setupBaseYear} + IRMAA` : `${setupBaseYear} Exact`;
        } else {
          subLabel = hasIrmaa ? `+${medPct}% + IRMAA` : `+${medPct}%/yr`;
        }
      } else {
        subLabel = 'Plan baseline';
      }

      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        isOverridden,
        subLabel,
        subTone: hasIrmaa && !isOverridden && setupMedCombined > 0 ? 'warning' : 'neutral',
      };
    },
  },
  {
    id: 'sehi_medicare_deduction',
    section: 'retirement_health',
    parentId: 'sehi_medicare_premiums',
    label: 'SEHI Deduction (Schedule 1, Line 17)',
    code: 'sehi_medicare_deduction',
    description:
      'Above-the-line >2% S-Corp shareholder health & Medicare deduction (IRS Form 7206 Line 11 / IRC § 162(l)(5)), capped at combined W-2 Box 5 Medicare wages (gross W-2 before 401(k) deferrals, excluding the S-Corp 2% health insurance add-back).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const ded = c.form_1040_out.sehi_medicare_deduction;
      const prem = c.form_1040_out.sehi_medicare_premiums_effective;
      const combinedBox5Wages =
        Math.max(0, c.scorp_in.bill_w2_wages) +
        (setup.filing_status === 'married_filing_jointly'
          ? Math.max(0, c.scorp_in.debra_w2_wages)
          : 0);
      const capped = setup.has_scorp && prem > 0 && prem > combinedBox5Wages && prem > ded;
      return {
        display: ded > 0 ? formatCurrency(-ded) : '$0',
        numericValue: -ded,
        subLabel: capped ? 'Box 5 wage-capped' : ded > 0 ? 'Sch 1 Ln 17' : 'None',
        subTone: capped ? 'warning' : ded > 0 ? 'positive' : 'neutral',
      };
    },
  },

  // =========================================================================
  // Group 4 — Personal Taxable Income & Threshold Flags
  // =========================================================================
  {
    id: 'enhanced_senior_deduction',
    section: 'personal_taxable',
    label: 'Enhanced Senior Deduction',
    code: 'enhanced_senior_deduction_allowed',
    description:
      'Schedule 1-A age 65+ enhanced senior deduction ($6,000 per eligible spouse, $12,000 MFJ max; 2025–2028 statutory window, sunsets after 2028) with MAGI phaseout tracking.',
    summable: true,
    computeCell: (c, _idx, _all, setup) => {
      if (c.tax_year > 2028) {
        return {
          display: '$0',
          numericValue: 0,
          subLabel: 'Sunset after 2028',
          subTone: 'neutral',
        };
      }
      const allowed = c.form_1040_out.enhanced_senior_deduction_allowed;
      const max = c.form_1040_out.enhanced_senior_deduction_max;
      const lost = c.form_1040_out.enhanced_senior_deduction_lost;
      let subLabel = 'Under age 65';
      let subTone: CellTone = 'neutral';
      if (max > 0) {
        if (lost > 0) {
          subLabel = `${formatCurrency(lost)} lost to MAGI`;
          subTone = 'warning';
        } else {
          subLabel = 'Full deduction allowed';
          subTone = 'positive';
        }
      }
      return {
        display: allowed > 0 ? formatCurrency(-allowed) : '$0',
        numericValue: -allowed,
        subLabel,
        subTone,
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          -DEFAULT_PROFILE_SEED.verification_benchmarks_2025.enhanced_senior_deduction
        ),
      };
    },
  },
  {
    id: 'qbi_deduction',
    section: 'personal_taxable',
    label: 'Section 199A QBI Deduction',
    code: 'qualified_business_income_deduction',
    description: 'Form 8995 Qualified Business Income deduction (up to 20% of QBI net of S-Corp >2% SEHI, capped by 20% of taxable income less net capital gain & qualified dividends).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_out.qualified_business_income_deduction;
      return {
        display: val > 0 ? formatCurrency(-val) : '$0',
        numericValue: -val,
        subLabel: val > 0 ? 'Form 8995 (20%)' : 'Not applicable',
        subTone: val > 0 ? 'positive' : 'neutral',
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          -DEFAULT_PROFILE_SEED.verification_benchmarks_2025.qbi_deduction
        ),
      };
    },
  },
  {
    id: 'taxable_social_security',
    section: 'personal_taxable',
    label: 'Taxable Social Security (Line 6b)',
    code: 'social_security_taxable',
    description: 'Federally taxable portion (0%–85%) of combined active individual Social Security benefits.',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const taxable = c.form_1040_out.social_security_taxable;
      const gross = c.form_1040_out.social_security_gross_effective;
      const pct = gross > 0 ? Math.round((taxable / gross) * 100) : 0;
      return {
        display: formatCurrency(taxable),
        numericValue: taxable,
        subLabel:
          gross > 0
            ? `${pct}% of ${formatCompactCurrency(gross)}`
            : 'No active SS',
        subTone: 'neutral',
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.taxable_social_security
        ),
      };
    },
  },
  {
    id: 'irmaa_starting_threshold',
    section: 'personal_taxable',
    label: 'IRMAA Starting Threshold (MFJ)',
    getLabel: (setup) =>
      setup.filing_status === 'married_filing_jointly'
        ? 'IRMAA Starting Threshold (MFJ)'
        : 'IRMAA Starting Threshold (Single)',
    code: 'irmaa_tier1_threshold',
    description:
      'Medicare IRMAA Tier 1 starting threshold by coverage year (2025: $212k, 2026: $218k, 2027+: configurable step-up rounded to $1,000). Click any year to override individually without altering other years.',
    editField: 'irmaa_threshold',
    computeCell: (c, _i, _all, setup) => {
      const resolved = resolveIrmaaThresholdForYear(c.tax_year, setup);
      const shortLookback = String(resolved.lookbackMagiYear).slice(-2);
      const lookbackNote = `${resolved.coverageYear} Cov · Tests '${shortLookback} MAGI`;
      const formulaHint = resolved.isOverridden
        ? `Formula: ${formatCompactCurrency(resolved.formulaThreshold)}`
        : resolved.sourceLabel;

      return {
        display: formatCurrency(resolved.effectiveThreshold),
        numericValue: resolved.effectiveThreshold,
        rawEditValue: resolved.effectiveThreshold,
        isOverridden: resolved.isOverridden,
        subLabel: lookbackNote,
        subTone: resolved.isOverridden ? 'warning' : 'neutral',
        filedRef: formulaHint,
      };
    },
  },
  {
    id: 'total_joint_agi',
    section: 'personal_taxable',
    label: 'Total Joint AGI (Form 1040)',
    code: 'adjusted_gross_income',
    description:
      'Form 1040 Line 11 AGI with inline IRMAA Cliff Watchdog showing active coverage-year surcharge (2-yr lookback MAGI) and forward coverage-year (+2 yr) cliff test.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const agi = c.form_1040_out.adjusted_gross_income;
      const currentMagi = agi + c.form_1040_in.tax_exempt_interest;
      const surcharge = c.form_1040_out.irmaa_annual_surcharge;
      const lookbackYear = c.form_1040_out.irmaa_lookback_year;
      const lookbackMagi = c.form_1040_out.irmaa_lookback_magi;
      const covThreshold = c.form_1040_out.irmaa_tier1_threshold;
      const lookbackExceeds = lookbackMagi > covThreshold;
      const futureCovYear = c.form_1040_out.irmaa_future_coverage_year;
      const futureThreshold = c.form_1040_out.irmaa_future_tier1_threshold;
      const currentExceedsFuture = c.form_1040_out.irmaa_current_magi_exceeds_cliff;
      const futureHeadroom = futureThreshold - currentMagi;
      const approachingFutureCliff =
        !currentExceedsFuture && futureHeadroom >= 0 && futureHeadroom <= 10000;

      const shortYear = String(c.tax_year).slice(-2);
      const shortLookback = String(lookbackYear).slice(-2);
      const shortFutureCov = String(futureCovYear).slice(-2);

      let badge: ScheduleCellResult['badge'];
      let subLabel: string | undefined;
      let subTone: CellTone = 'neutral';

      if (setup.has_ss_medicare !== false) {
        if (surcharge > 0) {
          badge = {
            text: `IRMAA +${formatCompactCurrency(surcharge)}`,
            tone: 'danger',
          };
          subLabel = `'${shortYear} Cov ('${shortLookback} MAGI)`;
          subTone = 'danger';
        } else if (lookbackExceeds) {
          badge = {
            text: `${c.tax_year} IRMAA >${formatCompactCurrency(covThreshold)}`,
            tone: 'warning',
          };
          subLabel = `'${shortLookback} MAGI > '${shortYear} Cov`;
          subTone = 'warning';
        } else if (currentExceedsFuture) {
          badge = {
            text: `${futureCovYear} Cliff >${formatCompactCurrency(futureThreshold)}`,
            tone: 'warning',
          };
          subLabel = `'${shortYear} MAGI → '${shortFutureCov} Cov`;
          subTone = 'warning';
        } else if (approachingFutureCliff) {
          badge = {
            text: `Near IRMAA (${formatCompactCurrency(futureHeadroom)})`,
            tone: 'warning',
          };
          subLabel = `≤${formatCompactCurrency(futureThreshold)} ('${shortFutureCov} Cov)`;
          subTone = 'warning';
        } else {
          badge = {
            text: 'IRMAA: Shielded',
            tone: 'positive',
          };
          subLabel = `≤${formatCompactCurrency(futureThreshold)} ('${shortFutureCov} Cov)`;
          subTone = 'neutral';
        }
      }

      return {
        display: formatCurrency(agi),
        numericValue: agi,
        badge,
        subLabel,
        subTone,
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.agi
        ),
      };
    },
  },
  {
    id: 'taxable_income',
    section: 'personal_taxable',
    label: 'Taxable Income (Line 15)',
    code: 'taxable_income',
    description: 'Form 1040 Line 15 taxable income with inline marginal bracket headroom indicator.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const headroom = c.form_1040_out.next_bracket_headroom;
      const nextRate = c.form_1040_out.next_bracket_rate;
      let badge: ScheduleCellResult['badge'];
      if (headroom !== null && nextRate !== null) {
        badge = {
          text: `${formatCompactCurrency(headroom)} to ${nextRate}%`,
          tone: headroom < 15000 ? 'warning' : 'neutral',
        };
      } else {
        badge = {
          text: 'Top 37% bracket',
          tone: 'warning',
        };
      }
      return {
        display: formatCurrency(c.form_1040_out.taxable_income),
        numericValue: c.form_1040_out.taxable_income,
        badge,
        filedRefTooltip: getDefaultFiledRef(
          c.tax_year,
          setup,
          DEFAULT_PROFILE_SEED.verification_benchmarks_2025.taxable_income
        ),
      };
    },
  },

  // =========================================================================
  // Group 5 — Tax Liability, Rates & Cash Flow
  // =========================================================================
  {
    id: 'federal_income_tax',
    section: 'tax_cashflow',
    label: 'Federal Income Tax Liability',
    code: 'federal_income_tax',
    description: 'Total federal ordinary, preferential capital gains, and Net Investment Income Tax (NIIT).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => ({
      display: formatCurrency(c.form_1040_out.federal_income_tax),
      numericValue: c.form_1040_out.federal_income_tax,
      subLabel:
        c.form_1040_out.niit_tax > 0
          ? `Incl. ${formatCompactCurrency(c.form_1040_out.niit_tax)} NIIT`
          : undefined,
      subTone: c.form_1040_out.niit_tax > 0 ? 'warning' : 'neutral',
      filedRefTooltip: getDefaultFiledRef(
        c.tax_year,
        setup,
        DEFAULT_PROFILE_SEED.verification_benchmarks_2025.federal_tax
      ),
    }),
  },
  {
    id: 'total_fica_payroll_tax',
    section: 'tax_cashflow',
    label: 'Total FICA / Payroll Taxes',
    code: 'total_fica_payroll_tax',
    description: 'Combined personal (employee SS & Medicare) and business (employer payroll) FICA taxes.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const personal = c.form_1040_out.personal_fica_tax;
      const business = setup.has_scorp ? c.scorp_out.employer_payroll_taxes : 0;
      const total = personal + business;
      return {
        display: formatCurrency(total),
        numericValue: total,
        subLabel: setup.has_scorp ? 'Pers + Bus Payroll' : 'Employee SS & Med',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'personal_fica_tax',
    section: 'tax_cashflow',
    parentId: 'total_fica_payroll_tax',
    label: 'Personal FICA / Payroll Taxes',
    code: 'personal_fica_tax',
    description: 'Employee Social Security (6.2% up to wage base), Medicare (1.45%), and 0.9% Additional Medicare withheld.',
    summable: true,
    computeCell: (c) => ({
      display: formatCurrency(c.form_1040_out.personal_fica_tax),
      numericValue: c.form_1040_out.personal_fica_tax,
      subLabel: 'Employee SS & Med',
      subTone: 'neutral',
    }),
  },
  {
    id: 'business_fica_tax',
    section: 'tax_cashflow',
    parentId: 'total_fica_payroll_tax',
    label: 'Business FICA / Payroll Taxes',
    code: 'employer_payroll_taxes',
    description: 'Employer-side payroll taxes (Form 1120-S payroll tax line / Employer FICA + FUTA).',
    summable: true,
    computeCell: (c) => ({
      display: formatCurrency(c.scorp_out.employer_payroll_taxes),
      numericValue: c.scorp_out.employer_payroll_taxes,
      subLabel: 'Employer Payroll',
      subTone: 'neutral',
    }),
  },
  {
    id: 'total_state_taxes',
    section: 'tax_cashflow',
    label: 'Total State Taxes',
    code: 'total_state_tax',
    description: 'Combined active state taxes (entity/franchise, PTE, and personal income tax across configured states).',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const states = getSetupStates(setup);
      const filings = c.state_filings_out;
      const pteTotal = c.scorp_out.pte_tax_paid_total;
      const hasPteActive =
        !c.is_locked_actuals && c.tax_year > setup.anchor_actuals_year && pteTotal > 0;
      let subLabel: string | undefined;

      if (filings.length >= 2) {
        const ordered = [
          states.primaryStateCode
            ? filings.find((sf) => sf.state_code === states.primaryStateCode)
            : filings[0],
          states.secondaryStateCode
            ? filings.find((sf) => sf.state_code === states.secondaryStateCode)
            : filings[1],
        ].filter((sf): sf is NonNullable<typeof sf> => Boolean(sf));
        const shown = ordered.length >= 2 ? ordered.slice(0, 2) : filings.slice(0, 2);
        const baseSplit = shown
          .map((sf) => `${sf.state_code} ${formatCompactCurrency(sf.state_income_tax_liability)}`)
          .join(' · ');
        subLabel = hasPteActive ? `${baseSplit} (PTE)` : baseSplit;
      } else if (filings.length === 1) {
        const sf = filings[0];
        const resTag =
          sf.residency_status === 'resident'
            ? 'Res'
            : sf.residency_status === 'part_year_resident'
            ? 'Part-Yr'
            : 'Non-Res';
        subLabel = hasPteActive ? `${sf.state_code} ${resTag} (PTE)` : `${sf.state_code} ${resTag}`;
      } else if (states.hasPrimaryState) {
        subLabel = `${states.primaryStateCode} Active`;
      }

      return {
        display: formatCurrency(c.total_state_tax),
        numericValue: c.total_state_tax,
        subLabel,
        subTone: hasPteActive ? 'accent' : 'neutral',
        filedRef: hasPteActive ? `PTE ${formatCompactCurrency(pteTotal)}` : undefined,
      };
    },
  },
  {
    id: 'ca_state_tax',
    section: 'tax_cashflow',
    parentId: 'total_state_taxes',
    label: 'Primary State Tax',
    getLabel: (s) => {
      const { primaryStateName, hasPrimaryState } = getSetupStates(s);
      return hasPrimaryState ? `${primaryStateName} State Tax` : 'Primary State Tax';
    },
    code: 'ca_state_tax_liability',
    description: 'Total primary state tax (entity/franchise + personal income tax).',
    summable: true,
    computeCell: (c, _i, _all, setup) => computeDynamicStateCell(c, setup, 'primary'),
  },
  {
    id: 'az_state_tax',
    section: 'tax_cashflow',
    parentId: 'total_state_taxes',
    label: 'Secondary State Tax',
    getLabel: (s) => {
      const { secondaryStateName, hasSecondaryState } = getSetupStates(s);
      return hasSecondaryState ? `${secondaryStateName} State Tax` : 'Secondary State Tax';
    },
    code: 'az_state_tax_liability',
    description: 'Total secondary state tax when multi-state filing or sourcing is active.',
    summable: true,
    computeCell: (c, _i, _all, setup) => computeDynamicStateCell(c, setup, 'secondary'),
  },
  {
    id: 'total_fed_state_tax',
    section: 'tax_cashflow',
    label: 'Total Federal and State Taxes',
    code: 'total_federal_and_state_tax',
    description: 'Combined federal income tax plus total state taxes (business + personal).',
    bold: true,
    highlight: 'primary',
    summable: true,
    computeCell: (c) => {
      const combined = c.form_1040_out.federal_income_tax + c.total_state_tax;
      return {
        display: formatCurrency(combined),
        numericValue: combined,
      };
    },
  },
  {
    id: 'total_taxes_paid',
    section: 'tax_cashflow',
    label: 'Taxes Paid (Federal + State)',
    code: 'total_taxes_paid',
    description: 'Combined federal and state withholding and estimated tax payments synced from Group 6, Form 1040, and Multi-State & PTE.',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const b = getYearTaxBalances(c, setup);
      const hasStateActivity = b.stateTax > 0 || b.statePaid > 0;
      const subLabel =
        b.combinedPaid > 0
          ? hasStateActivity
            ? `Fed ${formatCompactCurrency(b.federalPaid)} · State ${formatCompactCurrency(b.statePaid)}`
            : `Fed ${formatCompactCurrency(b.federalPaid)}`
          : undefined;
      return {
        display: formatCurrency(b.combinedPaid),
        numericValue: b.combinedPaid,
        subLabel,
        subTone: b.combinedPaid > 0 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'net_tax_due_or_refund',
    section: 'tax_cashflow',
    label: 'Net Tax Due / (Refund)',
    code: 'net_tax_due_or_refund',
    description: 'Remaining combined tax balance due or (refund) after subtracting Federal and State taxes paid from Total Federal and State Taxes.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const b = getYearTaxBalances(c, setup);
      const hasStateActivity = b.stateTax > 0 || b.statePaid > 0;
      let subLabel: string | undefined;
      let subTone: CellTone = 'neutral';
      if (b.combinedNetDue < 0) {
        subLabel = hasStateActivity
          ? `Refund · Fed ${formatCompactBalanceDue(b.federalNetDue)} · St ${formatCompactBalanceDue(b.stateNetDue)}`
          : 'Refund';
        subTone = 'positive';
      } else if (b.combinedNetDue === 0 && b.combinedTax > 0) {
        subLabel = 'Paid in full';
        subTone = 'positive';
      } else if (hasStateActivity) {
        subLabel = `Fed ${formatCompactBalanceDue(b.federalNetDue)} · State ${formatCompactBalanceDue(b.stateNetDue)}`;
        subTone = b.combinedPaid > 0 ? 'neutral' : 'neutral';
      } else if (b.combinedPaid > 0 && b.combinedNetDue > 0) {
        subLabel = 'Balance due';
        subTone = 'warning';
      }
      return {
        display: formatTaxBalanceDue(b.combinedNetDue),
        numericValue: b.combinedNetDue,
        subLabel,
        subTone,
      };
    },
  },
  {
    id: 'federal_net_tax_due',
    section: 'tax_cashflow',
    parentId: 'net_tax_due_or_refund',
    label: 'Federal Net Tax Due / (Refund)',
    code: 'federal_net_tax_due_or_refund',
    description: 'Federal Income Tax Liability minus Federal Taxes Paid (Form 1040 withholding + 1040-ES estimates).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const b = getYearTaxBalances(c, setup);
      let subLabel: string | undefined;
      let subTone: CellTone = 'neutral';
      if (b.federalNetDue < 0) {
        subLabel = `Refund · Paid ${formatCompactCurrency(b.federalPaid)}`;
        subTone = 'positive';
      } else if (b.federalNetDue === 0 && b.federalTax > 0) {
        subLabel = 'Paid in full';
        subTone = 'positive';
      } else if (b.federalPaid > 0) {
        subLabel = `Paid ${formatCompactCurrency(b.federalPaid)}`;
      }
      return {
        display: formatTaxBalanceDue(b.federalNetDue),
        numericValue: b.federalNetDue,
        subLabel,
        subTone,
      };
    },
  },
  {
    id: 'state_net_tax_due',
    section: 'tax_cashflow',
    parentId: 'net_tax_due_or_refund',
    label: 'State Net Tax Due / (Refund)',
    code: 'state_net_tax_due_or_refund',
    description: 'Total State Tax minus State Taxes Paid (withholding and estimated payments across active state filings).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const b = getYearTaxBalances(c, setup);
      let subLabel: string | undefined;
      let subTone: CellTone = 'neutral';
      if (b.stateNetDue < 0) {
        subLabel = `Refund · Paid ${formatCompactCurrency(b.statePaid)}`;
        subTone = 'positive';
      } else if (b.stateNetDue === 0 && b.stateTax > 0) {
        subLabel = 'Paid in full';
        subTone = 'positive';
      } else if (b.statePaid > 0) {
        subLabel = `Paid ${formatCompactCurrency(b.statePaid)}`;
      }
      return {
        display: formatTaxBalanceDue(b.stateNetDue),
        numericValue: b.stateNetDue,
        subLabel,
        subTone,
      };
    },
  },
  {
    id: 'effective_marginal_rate',
    section: 'tax_cashflow',
    label: 'Effective / Marginal Tax',
    code: 'effective_marginal_rate',
    description: 'Federal effective tax rate (% of AGI) paired with top federal marginal tax bracket.',
    bold: true,
    highlight: 'secondary',
    summable: false,
    computeCell: (c) => ({
      display: `${formatPercent(c.form_1040_out.effective_tax_rate, 2)} / ${formatPercent(
        c.form_1040_out.marginal_tax_rate,
        0
      )}`,
      subLabel: `All-in ${formatPercent(c.all_in_effective_rate, 1)}`,
      subTone: 'neutral',
    }),
    computeTotalDisplay: (allYears) => {
      const totFed = allYears.reduce((s, y) => s + y.form_1040_out.federal_income_tax, 0);
      const totAgi = allYears.reduce((s, y) => s + y.form_1040_out.adjusted_gross_income, 0);
      const avgEff = totAgi > 0 ? (totFed / totAgi) * 100 : 0;
      return `${formatPercent(avgEff, 1)} avg`;
    },
  },
  {
    id: 'quarterly_safe_harbor',
    section: 'tax_cashflow',
    label: 'Quarterly Estimated Tax Safe Harbor',
    code: 'quarterly_safe_harbor',
    description: 'Quarterly IRS estimated tax safe-harbor target (expand for Statutory Minimum Penalty Shield and Suggested 1040-ES details).',
    bold: true,
    summable: false,
    computeCell: (c, idx, all) => {
      const sh = getSafeHarborInfo(c, idx, all);
      return {
        display: `${formatCurrency(Math.round(sh.amount / 4))}/qtr`,
        badge: { text: sh.basisLabel, tone: sh.tone },
      };
    },
  },
  {
    id: 'statutory_min_penalty_shield',
    section: 'tax_cashflow',
    parentId: 'quarterly_safe_harbor',
    label: 'Statutory Minimum Penalty Shield',
    code: 'safe_harbor_minimum',
    description: 'IRS quarterly underpayment safe harbor (lesser of 90% current-year or 100%/110% prior-year federal tax).',
    summable: false,
    computeCell: (c, idx, all) => {
      const sh = getSafeHarborInfo(c, idx, all);
      return {
        display: `${formatCurrency(Math.round(sh.amount / 4))}/qtr`,
        badge: { text: sh.basisLabel, tone: sh.tone },
      };
    },
  },
  {
    id: 'suggested_1040es',
    section: 'tax_cashflow',
    parentId: 'quarterly_safe_harbor',
    label: 'Suggested 1040-ES (Pay-As-You-Go)',
    code: 'suggested_1040es_quarterly',
    description: 'Suggested quarterly federal estimated tax installment (25% of annual federal tax / safe harbor).',
    summable: false,
    computeCell: (c, idx, all) => {
      const sh = getSafeHarborInfo(c, idx, all);
      const qtr = Math.round(sh.amount / 4);
      return {
        display: `${formatCurrency(qtr)}/qtr`,
        subLabel: 'Pre-withholding',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'estimated_net_cash_flow',
    section: 'tax_cashflow',
    label: 'Estimated Net Household Cash Flow',
    code: 'estimated_net_cash_flow',
    description: 'Bottom-line annual household cash flow after federal/state taxes, employee FICA, 401(k) deferrals, capital contributions, and Medicare/IRMAA.',
    bold: true,
    summable: true,
    computeCell: (c) => ({
      display: formatCurrency(c.estimated_net_cash_flow),
      numericValue: c.estimated_net_cash_flow,
    }),
  },

  // =========================================================================
  // Group 6 — Taxes Paid (Withholding & Estimates)
  // =========================================================================
  {
    id: 'federal_taxes_paid',
    section: 'taxes_paid',
    label: 'Federal Taxes Paid (Withholding & Estimates)',
    code: 'federal_taxes_paid_total',
    description: 'Annual federal tax payments (W-2/1099 withholding + 1040-ES estimates). Inline editable directly or by component; synced with Form 1040 Lines 25d & 26.',
    bold: true,
    summable: true,
    editField: 'federal_taxes_paid',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      let subLabel: string | undefined;
      if (p.federalTotal > 0) {
        subLabel = `W/H ${formatCompactCurrency(p.federalWithholding)} · Est ${formatCompactCurrency(p.federalEstimates)}`;
      } else if (c.is_locked_actuals) {
        subLabel = `${c.tax_year} Actuals`;
      } else {
        subLabel = 'Withholding & 1040-ES';
      }
      return {
        display: formatCurrency(p.federalTotal),
        numericValue: p.federalTotal,
        rawEditValue: p.federalTotal,
        subLabel,
        subTone: p.federalTotal > 0 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'federal_tax_withholding',
    section: 'taxes_paid',
    parentId: 'federal_taxes_paid',
    label: 'Federal W-2 / 1099 Withholding',
    code: 'federal_tax_withholding',
    description: 'Federal income tax withheld on W-2 and 1099 statements (Form 1040 Line 25d).',
    summable: true,
    editField: 'federal_tax_withholding',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      return {
        display: formatCurrency(p.federalWithholding),
        numericValue: p.federalWithholding,
        rawEditValue: p.federalWithholding,
        subLabel: 'Form 1040 Ln 25d',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'federal_estimated_tax_payments',
    section: 'taxes_paid',
    parentId: 'federal_taxes_paid',
    label: 'Federal 1040-ES Estimated Payments',
    code: 'federal_estimated_tax_payments',
    description: 'Federal quarterly estimated tax payments and prior-year overpayments applied (Form 1040 Line 26).',
    summable: true,
    editField: 'federal_estimated_tax_payments',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      return {
        display: formatCurrency(p.federalEstimates),
        numericValue: p.federalEstimates,
        rawEditValue: p.federalEstimates,
        subLabel: 'Form 1040 Ln 26',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'state_taxes_paid',
    section: 'taxes_paid',
    label: 'State Taxes Paid (Withholding & Estimates)',
    code: 'state_taxes_paid_total',
    description: 'Annual state tax withholding and estimated payments across active state filings. Synced with Multi-State & PTE.',
    bold: true,
    summable: true,
    editField: 'state_taxes_paid',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      const { primaryStateCode, secondaryStateCode, hasPrimaryState, hasSecondaryState } =
        getSetupStates(setup);
      let subLabel: string | undefined;
      if (p.stateTotal > 0 && p.primaryStateCode && p.secondaryStateCode && hasSecondaryState) {
        subLabel = `${p.primaryStateCode} ${formatCompactCurrency(p.primaryStatePaid)} · ${p.secondaryStateCode} ${formatCompactCurrency(p.secondaryStatePaid)}`;
      } else if (c.is_locked_actuals) {
        subLabel = `${c.tax_year} Actuals`;
      } else if (hasPrimaryState && hasSecondaryState) {
        subLabel = `${primaryStateCode} & ${secondaryStateCode} W/H & Est`;
      } else if (hasPrimaryState) {
        subLabel = `${primaryStateCode} Withholding & Est`;
      } else {
        subLabel = 'State Withholding & Est';
      }
      return {
        display: formatCurrency(p.stateTotal),
        numericValue: p.stateTotal,
        rawEditValue: p.stateTotal,
        subLabel,
        subTone: p.stateTotal > 0 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'primary_state_taxes_paid',
    section: 'taxes_paid',
    parentId: 'state_taxes_paid',
    label: 'Primary State Taxes Paid',
    getLabel: (s) => {
      const { primaryStateName, hasPrimaryState } = getSetupStates(s);
      return hasPrimaryState ? `${primaryStateName} Taxes Paid` : 'Primary State Taxes Paid';
    },
    code: 'primary_state_tax_withholding_and_estimates',
    description: 'Primary state withholding and estimated tax payments synced to the primary state filing.',
    summable: true,
    editField: 'primary_state_taxes_paid',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      return {
        display: formatCurrency(p.primaryStatePaid),
        numericValue: p.primaryStatePaid,
        rawEditValue: p.primaryStatePaid,
        subLabel: p.primaryStateCode ? `${p.primaryStateCode} W/H & Est` : undefined,
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'secondary_state_taxes_paid',
    section: 'taxes_paid',
    parentId: 'state_taxes_paid',
    label: 'Secondary State Taxes Paid',
    getLabel: (s) => {
      const { secondaryStateName, hasSecondaryState } = getSetupStates(s);
      return hasSecondaryState ? `${secondaryStateName} Taxes Paid` : 'Secondary State Taxes Paid';
    },
    code: 'secondary_state_tax_withholding_and_estimates',
    description: 'Secondary state withholding and estimated tax payments synced to the secondary state filing.',
    summable: true,
    editField: 'secondary_state_taxes_paid',
    computeCell: (c, _i, _all, setup) => {
      const p = getYearTaxPayments(c, setup);
      return {
        display: formatCurrency(p.secondaryStatePaid),
        numericValue: p.secondaryStatePaid,
        rawEditValue: p.secondaryStatePaid,
        subLabel: p.secondaryStateCode ? `${p.secondaryStateCode} W/H & Est` : undefined,
        subTone: 'neutral',
      };
    },
  },
];

export const ALL_SCHEDULE_ITEM_IDS: string[] = MASTER_SCHEDULE_CATALOG.map(
  (item) => item.id
);

const VALID_ITEM_ID_SET = new Set(ALL_SCHEDULE_ITEM_IDS);

export function sanitizeHiddenItemIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw === 'string' && VALID_ITEM_ID_SET.has(raw) && !seen.has(raw)) {
      seen.add(raw);
      unique.push(raw);
    }
  }
  return unique;
}
