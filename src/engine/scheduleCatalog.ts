import type { ComputedTaxYear, SetupConfig } from '../types/tax';
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format';

export type ScheduleSectionId =
  | 'income_comp'
  | 'scorp_basis'
  | 'retirement_health'
  | 'personal_taxable'
  | 'tax_cashflow';

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
  | 'debra_w2'
  | 'bill_w2'
  | 'ss_debra'
  | 'ss_bill'
  | 'member_draws'
  | 'capital_contributions'
  | 'dbp_contribution'
  | 'sehi_medicare_premiums';

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
  /** Optional compact inline status/flag badge */
  badge?: {
    text: string;
    tone: CellTone;
  };
}

export interface ScheduleLineItem {
  id: string;
  section: ScheduleSectionId;
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
  const primaryName = setup.primary_name?.trim() || 'Primary';
  const spouseName = setup.spouse_name?.trim() || 'Spouse';
  return { primaryName, spouseName };
}

export function getScheduleRowLabel(row: ScheduleLineItem, setup: SetupConfig): string {
  return row.getLabel ? row.getLabel(setup) : row.label;
}

export const SCHEDULE_SECTIONS: ScheduleSectionMeta[] = [
  {
    id: 'income_comp',
    title: 'Group 1 — Income & Compensation Inputs (2025 Locked · 2026–2030 Inline Editable)',
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
    description: 'Federal, employee/employer FICA, CA & AZ state taxes, combined totals, rates, safe harbor estimates, and net household cash flow.',
  },
];

function inflationScale(taxYear: number, rate: number): number {
  return Math.pow(1 + rate, Math.max(0, taxYear - 2025));
}

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

function getIrmaaCliffInfo(
  currentMagi: number,
  lookbackMagi: number,
  setup: SetupConfig,
  taxYear: number
): { tier1Threshold: number; currentExceeds: boolean; lookbackExceeds: boolean } {
  const scale = inflationScale(taxYear, setup.assumptions.inflation_rate);
  const mfj = setup.filing_status === 'married_filing_jointly';
  const tier1Threshold = Math.round((mfj ? 212000 : 106000) * scale);
  return {
    tier1Threshold,
    currentExceeds: currentMagi > tier1Threshold,
    lookbackExceeds: lookbackMagi > tier1Threshold,
  };
}

function computeStateCell(c: ComputedTaxYear, stateCode: 'CA' | 'AZ'): ScheduleCellResult {
  const filing = c.state_filings_out.find((sf) => sf.state_code === stateCode);
  const waFiling = c.state_filings_out.find((sf) => sf.state_code === 'WA');

  if (!filing) {
    return {
      display: '$0',
      numericValue: 0,
      badge: { text: 'Not active', tone: 'neutral' },
    };
  }

  const appPct = Number((filing.state_apportionment_factor * 100).toFixed(1));
  const persTax = filing.state_personal_tax_liability;
  const entityTax = filing.state_entity_tax_liability;
  const pteTax = filing.state_pte_payment_amount;
  const totalTax = filing.state_income_tax_liability;

  if (stateCode === 'CA') {
    let badgeText: string;
    let badgeTone: CellTone;
    let formCode: string;

    if (filing.residency_status === 'resident') {
      badgeText = 'CA Res';
      badgeTone = 'accent';
      formCode = '540';
    } else if (filing.residency_status === 'part_year_resident') {
      badgeText = waFiling ? 'Part-Yr CA/WA' : 'Part-Yr CA';
      badgeTone = 'warning';
      formCode = '540NR';
    } else {
      badgeText = 'CA Non-Res';
      badgeTone = waFiling?.residency_status === 'resident' ? 'positive' : 'neutral';
      formCode = '540NR';
    }

    const bizTotal = entityTax + pteTax;
    const bizTag = pteTax > 0 ? '100S/PTE' : '100S';
    const subLabel = `${bizTag} ${formatCurrency(bizTotal)} · ${formCode} ${formatCurrency(persTax)}`;

    return {
      display: formatCurrency(totalTax),
      numericValue: totalTax,
      badge: { text: badgeText, tone: badgeTone },
      subLabel,
      subTone: 'neutral',
      filedRef: c.tax_year === 2025 ? 'Filed: $5,362 540' : undefined,
    };
  }

  // Arizona State Tax (AZ Form 120S entity/PTE + AZ Form 140NR nonresident personal)
  const azBadgeText =
    filing.residency_status === 'resident'
      ? 'AZ Res'
      : filing.residency_status === 'part_year_resident'
      ? `AZ Part-Yr · ${appPct}%`
      : `AZ Non-Res · ${appPct}%`;
  const azBadgeTone: CellTone =
    filing.residency_status === 'resident'
      ? 'accent'
      : filing.residency_status === 'part_year_resident'
      ? 'warning'
      : 'neutral';

  let azSubLabel: string;
  if (pteTax > 0) {
    azSubLabel = `PTE ${formatCurrency(pteTax)} · 140NR ${formatCurrency(persTax)}`;
  } else if (filing.credit_for_taxes_paid_to_other_states > 0) {
    azSubLabel = `140NR ${formatCurrency(persTax)} (OSTC -${formatCurrency(
      filing.credit_for_taxes_paid_to_other_states
    )})`;
  } else {
    azSubLabel = `140NR ${formatCurrency(persTax)}`;
  }

  return {
    display: formatCurrency(totalTax),
    numericValue: totalTax,
    badge: { text: azBadgeText, tone: azBadgeTone },
    subLabel: azSubLabel,
    subTone: filing.credit_for_taxes_paid_to_other_states > 0 ? 'positive' : 'neutral',
    filedRef: c.tax_year === 2025 ? 'Filed: $0 140NR' : undefined,
  };
}

export const MASTER_SCHEDULE_CATALOG: ScheduleLineItem[] = [
  // =========================================================================
  // Group 1 — Income & Compensation Inputs (2025 Locked · 2026–2030 Inline Editable)
  // =========================================================================
  {
    id: 'ca_scorp_revenue',
    section: 'income_comp',
    label: 'California S-Corp Revenue',
    code: 'ca_revenue',
    description: 'California-sourced S-Corp gross receipts (2025 locked at $136,770; inline editable 2026–2030). Drives CA apportionment %.',
    summable: true,
    editField: 'ca_scorp_revenue',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.ca_revenue : 0;
      const total = setup.has_scorp ? c.scorp_in.gross_receipts_revenue : 0;
      const pct = total > 0 ? (val / total) * 100 : 0;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: setup.has_scorp ? `${pct.toFixed(1)}% CA share` : 'S-Corp off',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'az_scorp_revenue',
    section: 'income_comp',
    label: 'Arizona S-Corp Revenue',
    code: 'az_revenue',
    description: 'Arizona-sourced S-Corp gross receipts (2025 locked at $242,815; inline editable 2026–2030). Drives AZ apportionment %.',
    summable: true,
    editField: 'az_scorp_revenue',
    computeCell: (c, _i, _all, setup) => {
      const val = setup.has_scorp ? c.scorp_in.az_revenue : 0;
      const total = setup.has_scorp ? c.scorp_in.gross_receipts_revenue : 0;
      const pct = total > 0 ? (val / total) * 100 : 0;
      return {
        display: formatCurrency(val),
        numericValue: val,
        rawEditValue: val,
        subLabel: setup.has_scorp ? `${pct.toFixed(1)}% AZ share` : 'S-Corp off',
        subTone: 'neutral',
      };
    },
  },
  {
    id: 'scorp_gross_revenue',
    section: 'income_comp',
    label: 'Total S-Corp Gross Revenue',
    code: 'gross_receipts_revenue',
    description: 'Auto-calculated sum of California S-Corp Revenue + Arizona S-Corp Revenue with live CA% / AZ% apportionment split.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const ca = setup.has_scorp ? c.scorp_in.ca_revenue : 0;
      const az = setup.has_scorp ? c.scorp_in.az_revenue : 0;
      const total = setup.has_scorp ? ca + az : 0;
      const caPct = total > 0 ? ((ca / total) * 100).toFixed(1) : '0.0';
      const azPct = total > 0 ? ((az / total) * 100).toFixed(1) : '0.0';
      return {
        display: formatCurrency(total),
        numericValue: total,
        badge: setup.has_scorp
          ? { text: `CA ${caPct}% / AZ ${azPct}%`, tone: 'accent' }
          : { text: 'S-Corp off', tone: 'neutral' },
      };
    },
  },
  {
    id: 'bill_w2_comp',
    section: 'income_comp',
    label: 'Bill W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).primaryName} W-2 Compensation`,
    code: 'bill_w2_wages',
    description: 'Primary Taxpayer gross W-2 compensation (inline editable 2026–2030).',
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
    label: 'Debra W-2 Compensation',
    getLabel: (s) => `${getPersonNames(s).spouseName} W-2 Compensation`,
    code: 'debra_w2_wages',
    description: 'Spouse officer W-2 compensation (inline editable 2026–2030).',
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
    id: 'ss_bill',
    section: 'income_comp',
    label: 'SS Bill',
    getLabel: (s) => `SS ${getPersonNames(s).primaryName}`,
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
    label: 'SS Debra',
    getLabel: (s) => `SS ${getPersonNames(s).spouseName}`,
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
    id: 'scorp_k1_profit',
    section: 'scorp_basis',
    label: 'S-Corp K-1 Pass-Through Profit (Flows to 1040)',
    code: 'schedule_k1_ordinary_income',
    description: 'Form 1120-S ordinary business income passing through via Schedule K-1 Box 1.',
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
        filedRef: c.tax_year === 2025 ? 'Filed: $91,498' : undefined,
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
        filedRef: c.tax_year === 2025 ? 'Filed: $0' : undefined,
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
    computeCell: (c) => {
      const excess = c.scorp_out.excess_distribution_capital_gain;
      return {
        display: formatCurrency(excess),
        numericValue: excess,
        badge:
          excess > 0
            ? { text: 'Basis Exceeded', tone: 'danger' }
            : { text: 'Basis OK', tone: 'positive' },
        filedRef: c.tax_year === 2025 ? 'Filed: $32,182' : undefined,
      };
    },
  },

  // =========================================================================
  // Group 3 — Retirement & Health Deductions
  // =========================================================================
  {
    id: 'dbp_contribution',
    section: 'retirement_health',
    label: 'DBP Contribution',
    code: 'dbp_actual_contribution',
    description: 'Defined Benefit Plan deductible contribution (defaults to $0 starting in Termination Year + 1).',
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
    id: 'employer_401k_ps',
    section: 'retirement_health',
    label: 'Employer 401(k) Profit Sharing / Match',
    code: 'employer_401k_total',
    description: 'Employer profit sharing: 6% cap through DBP Termination Year, stepping up to Post-DBP rate in Termination Year + 1 (capped by IRS §415(c)).',
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const val = c.form_1040_out.employer_401k_total;
      const pct = Math.round(c.form_1040_out.employer_401k_rate_applied * 1000) / 10;
      const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
      const isPostTerm = setup.has_dbp && termYear !== null && c.tax_year > termYear;
      return {
        display: formatCurrency(val),
        numericValue: val,
        subLabel:
          !setup.has_401k_or_ira || !setup.has_scorp
            ? 'Inactive'
            : isPostTerm
            ? `${pct}% post-DBP`
            : `${pct}% DBP cap`,
        subTone: isPostTerm && pct > 6 ? 'accent' : 'neutral',
      };
    },
  },
  {
    id: 'employee_401k_deferrals',
    section: 'retirement_health',
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
    id: 'dbp_ps_tax_reduction',
    section: 'retirement_health',
    label: 'DBP Contribution + Profit Share Tax Reduction',
    code: 'dbp_and_ps_tax_reduction',
    description: 'Estimated federal tax shield from entity-deductible DBP and Employer 401(k) profit-sharing contributions.',
    summable: true,
    computeCell: (c) => {
      const shield = c.form_1040_out.dbp_and_ps_tax_reduction;
      return {
        display: formatCurrency(shield),
        numericValue: shield,
        subLabel:
          shield > 0
            ? `@ ${formatPercent(c.form_1040_out.marginal_tax_rate, 0)} marginal`
            : 'No active shield',
        subTone: shield > 0 ? 'positive' : 'neutral',
      };
    },
  },
  {
    id: 'sehi_medicare_premiums',
    section: 'retirement_health',
    label: 'SEHI Medicare Premiums',
    code: 'sehi_medicare_premiums_effective',
    description: 'Pulls enrolled Medicare / health premiums from Setup (exact in Current Tax Year, escalated by Medicare inflation in Current Year + 1); inline editable for 2026–2030.',
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
        subLabel = '2025 Actuals';
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
    label: 'SEHI Medicare Deduction (Sched 1 Line 17)',
    code: 'sehi_medicare_deduction',
    description: 'Above-the-line >2% S-Corp shareholder health & Medicare deduction, capped at each shareholder’s available W-2 Box 1 wages (W-2 minus 401(k) deferrals).',
    summable: true,
    computeCell: (c) => {
      const ded = c.form_1040_out.sehi_medicare_deduction;
      const prem = c.form_1040_out.sehi_medicare_premiums_effective;
      const capped = prem > ded && prem > 0;
      return {
        display: ded > 0 ? formatCurrency(-ded) : '$0',
        numericValue: -ded,
        subLabel: capped ? 'Box 1 wage-capped' : ded > 0 ? 'Sch 1 Ln 17' : 'None',
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
    description: 'Schedule 1-A age 65+ enhanced senior deduction ($6,000 per eligible spouse) with MAGI phaseout tracking.',
    summable: true,
    computeCell: (c) => {
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
        filedRef: c.tax_year === 2025 ? 'Filed: -$11,938' : undefined,
      };
    },
  },
  {
    id: 'qbi_deduction',
    section: 'personal_taxable',
    label: 'Section 199A QBI Deduction',
    code: 'qualified_business_income_deduction',
    description: 'Form 8995 Qualified Business Income deduction (up to 20% of QBI, capped by 20% of taxable income less net capital gain & qualified dividends).',
    summable: true,
    computeCell: (c) => {
      const val = c.form_1040_out.qualified_business_income_deduction;
      return {
        display: val > 0 ? formatCurrency(-val) : '$0',
        numericValue: -val,
        subLabel:
          c.tax_year === 2025
            ? undefined
            : val > 0
            ? 'Form 8995 (20%)'
            : 'Not applicable',
        subTone: val > 0 ? 'positive' : 'neutral',
        filedRef: c.tax_year === 2025 ? 'Filed: -$14,337' : undefined,
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
    computeCell: (c) => {
      const taxable = c.form_1040_out.social_security_taxable;
      const gross = c.form_1040_out.social_security_gross_effective;
      const pct = gross > 0 ? Math.round((taxable / gross) * 100) : 0;
      return {
        display: formatCurrency(taxable),
        numericValue: taxable,
        subLabel:
          c.tax_year === 2025 && gross === 0
            ? undefined
            : gross > 0
            ? `${pct}% of ${formatCompactCurrency(gross)}`
            : 'No active SS',
        subTone: 'neutral',
        filedRef: c.tax_year === 2025 ? 'Filed: $0' : undefined,
      };
    },
  },
  {
    id: 'total_joint_agi',
    section: 'personal_taxable',
    label: 'Total Joint AGI (Form 1040)',
    code: 'adjusted_gross_income',
    description: 'Form 1040 Line 11 AGI with inline IRMAA Cliff Watchdog flag when exceeding Medicare MAGI thresholds.',
    bold: true,
    summable: true,
    computeCell: (c, _i, _all, setup) => {
      const agi = c.form_1040_out.adjusted_gross_income;
      const currentMagi = agi + c.form_1040_in.tax_exempt_interest;
      const surcharge = c.form_1040_out.irmaa_annual_surcharge;
      const cliff = getIrmaaCliffInfo(
        currentMagi,
        c.form_1040_out.irmaa_lookback_magi,
        setup,
        c.tax_year
      );

      let badge: ScheduleCellResult['badge'];
      if (surcharge > 0) {
        badge = {
          text: `IRMAA +${formatCompactCurrency(surcharge)}`,
          tone: 'danger',
        };
      } else if (cliff.currentExceeds) {
        badge = {
          text: `IRMAA Cliff >${formatCompactCurrency(cliff.tier1Threshold)}`,
          tone: 'warning',
        };
      } else {
        badge = {
          text: 'IRMAA: Shielded',
          tone: 'positive',
        };
      }

      return {
        display: formatCurrency(agi),
        numericValue: agi,
        badge,
        filedRef: c.tax_year === 2025 ? 'Filed: $150,511' : undefined,
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
    computeCell: (c) => {
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
        filedRef: c.tax_year === 2025 ? 'Filed: $89,536' : undefined,
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
    computeCell: (c) => ({
      display: formatCurrency(c.form_1040_out.federal_income_tax),
      numericValue: c.form_1040_out.federal_income_tax,
      subLabel:
        c.form_1040_out.niit_tax > 0
          ? `Incl. ${formatCompactCurrency(c.form_1040_out.niit_tax)} NIIT`
          : undefined,
      subTone: c.form_1040_out.niit_tax > 0 ? 'warning' : 'neutral',
      filedRef: c.tax_year === 2025 ? 'Filed: $6,402' : undefined,
    }),
  },
  {
    id: 'personal_fica_tax',
    section: 'tax_cashflow',
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
    id: 'ca_state_tax',
    section: 'tax_cashflow',
    label: 'California State Tax',
    code: 'ca_state_tax_liability',
    description: 'Total California tax: Form 100S business tax (max $800 or 1.5% CA-apportioned net income) + Form 540/540NR personal tax.',
    summable: true,
    computeCell: (c) => computeStateCell(c, 'CA'),
  },
  {
    id: 'az_state_tax',
    section: 'tax_cashflow',
    label: 'Arizona State Tax',
    code: 'az_state_tax_liability',
    description: 'Total Arizona tax: Form 120S entity tax ($0 unless PTE elected) + Form 140NR nonresident personal tax (2.5% on AZ-sourced K-1).',
    summable: true,
    computeCell: (c) => computeStateCell(c, 'AZ'),
  },
  {
    id: 'total_fed_state_tax',
    section: 'tax_cashflow',
    label: 'Total Federal and State Taxes',
    code: 'total_federal_and_state_tax',
    description: 'Combined federal income tax plus total California and Arizona state taxes (business + personal).',
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
    id: 'statutory_min_penalty_shield',
    section: 'tax_cashflow',
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
