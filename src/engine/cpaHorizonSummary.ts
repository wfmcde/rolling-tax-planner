import type {
  ComputedTaxYear,
  PnlBalanceSheetState,
  SetupConfig,
} from '../types/tax';
import type { ComputedPnlBalanceSheet } from './pnlBalanceSheet';
import {
  evaluateIncomeCeilingGoalWithMagi,
  type EvaluatedPlanningGoal,
} from './planningGoals';
import { computeReasonableCompRatio } from './validator';
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format';
import { getSetupStates } from '../utils/setupHelpers';

export type HorizonSummaryTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';

export interface HorizonSummaryCell {
  taxYear: number;
  numericValue: number;
  display: string;
  subLabel?: string;
  badgeText?: string;
  tone?: HorizonSummaryTone;
}

export interface HorizonSummaryRow {
  id:
    | 'gross_receipts'
    | 'operating_expenses'
    | 'officer_w2'
    | 'sehi_premiums'
    | 'employer_payroll_taxes'
    | 'dbp_contribution'
    | 'employer_401k'
    | 'k1_ordinary_income'
    | 'reasonable_comp_ratio'
    | 'qbi_deduction'
    | 'agi_magi'
    | 'taxable_income'
    | 'federal_income_tax'
    | 'total_state_tax'
    | 'irmaa_lookback'
    | 'capital_contributions'
    | 'member_draws'
    | 'ending_stock_basis';
  section: 'entity' | 'personal' | 'basis';
  label: string;
  shortRef: string;
  bold?: boolean;
  highlight?: 'primary' | 'secondary';
  cells: HorizonSummaryCell[];
  totalNumeric: number;
  totalDisplay: string;
  totalSubLabel?: string;
}

export interface CpaHorizonSummaryTable {
  years: number[];
  rows: HorizonSummaryRow[];
  hasScorp: boolean;
  hasDbp: boolean;
  hasStockBasis: boolean;
  hasSsMedicare: boolean;
  sixYearAllInTax: number;
  sixYearNetCashFlow: number;
}

export interface PnlHorizonReconLine {
  label: string;
  pnlValue: number;
  horizonValue: number;
  variance: number;
}

export interface PnlHorizonReconciliation {
  projectionYear: number;
  isReconciled: boolean;
  pnlObi: number;
  horizonObi: number;
  pteEntityTaxDeduction: number;
  obiVariance: number;
  obiAfterPteVariance: number;
  basisVariance: number;
  rcPnlPct: number;
  rcHorizonPct: number;
  rcVariancePct: number;
  mismatchedLines: PnlHorizonReconLine[];
}

function getEntityFormShort(setup: SetupConfig): string {
  switch (setup.entity_type) {
    case 'partnership':
      return '1065';
    case 'ccorp':
      return '1120';
    case 'sole_prop':
      return 'Sch C';
    case 'none':
      return '1040';
    default:
      return '1120-S';
  }
}

function getOrdinaryIncomeShortRef(setup: SetupConfig): string {
  switch (setup.entity_type) {
    case 'partnership':
      return '1065 Ln 23';
    case 'ccorp':
      return '1120 Ln 30';
    case 'sole_prop':
      return 'Sch C Ln 31';
    case 'none':
      return 'Sch E';
    default:
      return '1120-S Ln 22';
  }
}

function getYearW2(c: ComputedTaxYear, setup: SetupConfig): number {
  if (!setup.has_scorp) return c.form_1040_in.w2_wages_total;
  return (
    c.scorp_in.bill_w2_wages +
    (setup.filing_status === 'married_filing_jointly' ? c.scorp_in.debra_w2_wages : 0)
  );
}

function getYearDbp(c: ComputedTaxYear, setup: SetupConfig): number {
  if (!setup.has_dbp || c.dbp_in.dbp_status === 'terminated') return 0;
  return c.dbp_in.dbp_actual_contribution;
}

function getYearStateBreakdownSub(c: ComputedTaxYear): string {
  if (!c.state_filings_out || c.state_filings_out.length === 0) {
    return 'No active state';
  }
  const active = c.state_filings_out.filter(
    (sf) =>
      sf.state_income_tax_liability > 0 ||
      sf.residency_status === 'resident' ||
      sf.residency_status === 'part_year_resident'
  );
  const list = active.length > 0 ? active : c.state_filings_out.slice(0, 2);
  return list
    .slice(0, 2)
    .map((sf) => `${sf.state_code} ${formatCompactCurrency(sf.state_income_tax_liability)}`)
    .join(' · ');
}

/**
 * Builds the 2025-2030 Multi-Year Horizon Summary table directly from `ComputedTaxYear[]`
 * using the exact same formulas as `HorizonView` / `scheduleCatalog.ts` so React Preview,
 * Standalone Print/PDF Export, and CSV Export all tie to $0 variance against Horizon.
 */
export function buildCpaHorizonSummary(
  setup: SetupConfig,
  computedYears: ComputedTaxYear[]
): CpaHorizonSummaryTable {
  const years = computedYears.map((c) => c.tax_year);
  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const entityForm = getEntityFormShort(setup);
  const obiRef = getOrdinaryIncomeShortRef(setup);

  const hasAnyDbp =
    setup.has_dbp || computedYears.some((c) => getYearDbp(c, setup) > 0);
  const hasSsMedicare = setup.has_ss_medicare !== false;
  const hasStockBasis = setup.has_scorp && setup.has_stock_basis !== false;

  const rows: HorizonSummaryRow[] = [];

  if (setup.has_scorp) {
    // 1. Gross Receipts
    const revCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const s1 = c.scorp_in.ca_revenue;
      const s2 = c.scorp_in.az_revenue;
      const total = s1 + s2;
      const pct1 = total > 0 ? ((s1 / total) * 100).toFixed(0) : '0';
      const pct2 = total > 0 ? ((s2 / total) * 100).toFixed(0) : '0';
      const subLabel =
        setup.multi_state_active && secondaryStateCode
          ? `${primaryStateCode || 'S1'} ${pct1}%/${secondaryStateCode} ${pct2}%`
          : primaryStateCode
          ? `100% ${primaryStateCode}`
          : undefined;
      return {
        taxYear: c.tax_year,
        numericValue: total,
        display: formatCurrency(total),
        subLabel,
      };
    });
    const revSum = revCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'gross_receipts',
      section: 'entity',
      label: `${entityForm} Gross Receipts`,
      shortRef: 'Ln 1a',
      bold: true,
      cells: revCells,
      totalNumeric: revSum,
      totalDisplay: formatCurrency(revSum),
    });

    // 2. Operating Expenses (Excl. Payroll, W-2, SEHI & Retirement)
    const opExCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = c.scorp_out.effective_operating_expenses;
      const rev = c.scorp_in.gross_receipts_revenue;
      const pct = rev > 0 ? `${((val / rev) * 100).toFixed(1)}% rev` : undefined;
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
        subLabel: pct,
      };
    });
    const opExSum = opExCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'operating_expenses',
      section: 'entity',
      label: 'Operating Expenses (Excl. Payroll & Ret.)',
      shortRef: 'OpEx',
      cells: opExCells,
      totalNumeric: opExSum,
      totalDisplay: formatCurrency(opExSum),
    });
  }

  // 3. Officer / Total W-2 Wages
  const w2Cells: HorizonSummaryCell[] = computedYears.map((c) => {
    const val = getYearW2(c, setup);
    return {
      taxYear: c.tax_year,
      numericValue: val,
      display: formatCurrency(val),
    };
  });
  const w2Sum = w2Cells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'officer_w2',
    section: 'entity',
    label: setup.has_scorp ? 'Officer W-2 Wages (Cash FICA)' : 'Total W-2 Wages',
    shortRef: setup.has_scorp ? 'Ln 7–8' : '1040 Ln 1a',
    cells: w2Cells,
    totalNumeric: w2Sum,
    totalDisplay: formatCurrency(w2Sum),
  });

  // 4. SEHI / Owner Health Insurance
  const sehiCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const prem = c.form_1040_out.sehi_medicare_premiums_effective;
    const ded = c.form_1040_out.sehi_medicare_deduction;
    return {
      taxYear: c.tax_year,
      numericValue: prem,
      display: formatCurrency(prem),
      subLabel: ded > 0 ? `Ded ${formatCompactCurrency(ded)}` : undefined,
    };
  });
  const sehiSum = sehiCells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'sehi_premiums',
    section: 'entity',
    label: setup.has_scorp ? 'S-Corp >2% Owner Health (SEHI)' : 'Health / Medicare Premiums',
    shortRef: 'Sch 1 Ln 17',
    cells: sehiCells,
    totalNumeric: sehiSum,
    totalDisplay: formatCurrency(sehiSum),
  });

  // 5. Employer Payroll Taxes
  if (setup.has_scorp) {
    const erPayCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = c.scorp_out.employer_payroll_taxes;
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
      };
    });
    const erPaySum = erPayCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'employer_payroll_taxes',
      section: 'entity',
      label: 'Employer Payroll Taxes (ER FICA/FUTA)',
      shortRef: 'Ln 12',
      cells: erPayCells,
      totalNumeric: erPaySum,
      totalDisplay: formatCurrency(erPaySum),
    });
  }

  // 6. DBP Contribution
  if (hasAnyDbp) {
    const dbpCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = getYearDbp(c, setup);
      const termYear = setup.has_dbp ? setup.dbp_planned_termination_year : null;
      const isPostTerm = setup.has_dbp && termYear !== null && c.tax_year > termYear;
      const status =
        !setup.has_dbp || isPostTerm || c.dbp_in.dbp_status === 'terminated'
          ? 'Terminated'
          : c.dbp_in.dbp_status === 'terminating'
          ? 'Final yr'
          : 'Active';
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
        subLabel: status,
        tone: val > 0 ? 'accent' : 'neutral',
      };
    });
    const dbpSum = dbpCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'dbp_contribution',
      section: 'entity',
      label: 'Defined Benefit Plan Contribution (DBP)',
      shortRef: 'Ln 17',
      cells: dbpCells,
      totalNumeric: dbpSum,
      totalDisplay: formatCurrency(dbpSum),
    });
  }

  // 7. 401(k) Employer Profit Sharing / Match (+ Employee 401(k) Deferral sub-note)
  const k401Cells: HorizonSummaryCell[] = computedYears.map((c) => {
    const er = c.form_1040_out.employer_401k_total;
    const ee = c.form_1040_out.employee_401k_total;
    return {
      taxYear: c.tax_year,
      numericValue: er,
      display: formatCurrency(er),
      subLabel: ee > 0 ? `EE ${formatCompactCurrency(ee)}` : undefined,
    };
  });
  const k401Sum = k401Cells.reduce((s, x) => s + x.numericValue, 0);
  const ee401kSum = computedYears.reduce((s, c) => s + c.form_1040_out.employee_401k_total, 0);
  rows.push({
    id: 'employer_401k',
    section: 'entity',
    label: '401(k) Employer Profit Sharing / Match',
    shortRef: 'Ln 17',
    cells: k401Cells,
    totalNumeric: k401Sum,
    totalDisplay: formatCurrency(k401Sum),
    totalSubLabel: ee401kSum > 0 ? `EE ${formatCompactCurrency(ee401kSum)}` : undefined,
  });

  if (setup.has_scorp) {
    // 8. K-1 Ordinary Business Income
    const obiCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = c.form_1040_in.schedule_k1_ordinary_income;
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
      };
    });
    const obiSum = obiCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'k1_ordinary_income',
      section: 'entity',
      label: `K-1 Ordinary Business Income (${obiRef})`,
      shortRef: 'K-1 Box 1',
      bold: true,
      highlight: 'secondary',
      cells: obiCells,
      totalNumeric: obiSum,
      totalDisplay: formatCurrency(obiSum),
    });

    // 9. Reasonable Comp Ratio (%)
    const rcCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const ratioPct = Number((c.scorp_out.reasonable_comp_ratio * 100).toFixed(1));
      const obi = c.scorp_out.ordinary_business_income_1120s;
      const w2 = getYearW2(c, setup);
      const tone: HorizonSummaryTone =
        obi > 0 && ratioPct < 30 ? 'warning' : w2 > 0 ? 'positive' : 'neutral';
      return {
        taxYear: c.tax_year,
        numericValue: ratioPct,
        display: `${ratioPct.toFixed(1)}%`,
        tone,
      };
    });
    const weightedRcPct = Number(
      (computeReasonableCompRatio(w2Sum, obiSum) * 100).toFixed(1)
    );
    rows.push({
      id: 'reasonable_comp_ratio',
      section: 'entity',
      label: 'Reasonable Comp Ratio (W-2 / [W-2 + K-1])',
      shortRef: 'IRC §3121',
      cells: rcCells,
      totalNumeric: weightedRcPct,
      totalDisplay: `${weightedRcPct.toFixed(1)}%`,
      totalSubLabel: '6-Yr wtd',
    });
  }

  // 10. Form 8995 QBI Deduction
  const qbiCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const val = c.form_1040_out.qualified_business_income_deduction;
    return {
      taxYear: c.tax_year,
      numericValue: val,
      display: val > 0 ? formatCurrency(-val) : '$0',
      tone: val > 0 ? 'positive' : 'neutral',
    };
  });
  const qbiSum = qbiCells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'qbi_deduction',
    section: 'personal',
    label: 'Section 199A QBI Deduction',
    shortRef: 'Form 8995',
    cells: qbiCells,
    totalNumeric: qbiSum,
    totalDisplay: qbiSum > 0 ? formatCurrency(-qbiSum) : '$0',
  });

  // 11. Form 1040 AGI / MAGI
  const agiCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const agi = c.form_1040_out.adjusted_gross_income;
    const taxExemptInt = c.form_1040_in.tax_exempt_interest || 0;
    const magi = getHorizonYearMagi(c);
    return {
      taxYear: c.tax_year,
      numericValue: agi,
      display: formatCurrency(agi),
      subLabel:
        taxExemptInt > 0 ? `MAGI ${formatCompactCurrency(magi)}` : 'MAGI = AGI',
    };
  });
  const agiSum = agiCells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'agi_magi',
    section: 'personal',
    label:
      setup.filing_status === 'married_filing_jointly'
        ? 'Form 1040 Joint AGI / MAGI'
        : 'Form 1040 AGI / MAGI',
    shortRef: '1040 Ln 11',
    bold: true,
    cells: agiCells,
    totalNumeric: agiSum,
    totalDisplay: formatCurrency(agiSum),
  });

  // 12. Form 1040 Taxable Income
  const tiCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const val = c.form_1040_out.taxable_income;
    return {
      taxYear: c.tax_year,
      numericValue: val,
      display: formatCurrency(val),
    };
  });
  const tiSum = tiCells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'taxable_income',
    section: 'personal',
    label: 'Form 1040 Taxable Income',
    shortRef: '1040 Ln 15',
    bold: true,
    cells: tiCells,
    totalNumeric: tiSum,
    totalDisplay: formatCurrency(tiSum),
  });

  // 13. Federal Income Tax
  const fedCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const val = c.form_1040_out.federal_income_tax;
    const eff = formatPercent(c.form_1040_out.effective_tax_rate, 1);
    const marg = formatPercent(c.form_1040_out.marginal_tax_rate, 0);
    return {
      taxYear: c.tax_year,
      numericValue: val,
      display: formatCurrency(val),
      subLabel: `${eff} / ${marg}`,
    };
  });
  const fedSum = fedCells.reduce((s, x) => s + x.numericValue, 0);
  const avgFedEff = agiSum > 0 ? (fedSum / agiSum) * 100 : 0;
  rows.push({
    id: 'federal_income_tax',
    section: 'personal',
    label: 'Federal Income Tax Liability',
    shortRef: '1040 Ln 24',
    bold: true,
    highlight: 'primary',
    cells: fedCells,
    totalNumeric: fedSum,
    totalDisplay: formatCurrency(fedSum),
    totalSubLabel: `${formatPercent(avgFedEff, 1)} avg eff`,
  });

  // 14. Total State Taxes (Personal + Entity + PTE)
  const stateCells: HorizonSummaryCell[] = computedYears.map((c) => {
    const val = c.total_state_tax;
    return {
      taxYear: c.tax_year,
      numericValue: val,
      display: formatCurrency(val),
      subLabel: getYearStateBreakdownSub(c),
    };
  });
  const stateSum = stateCells.reduce((s, x) => s + x.numericValue, 0);
  rows.push({
    id: 'total_state_tax',
    section: 'personal',
    label: 'Total State Taxes (Pers + Entity + PTE)',
    shortRef: 'State',
    bold: true,
    cells: stateCells,
    totalNumeric: stateSum,
    totalDisplay: formatCurrency(stateSum),
  });

  // 15. Medicare IRMAA 2-Yr Lookback & Forward Cliff
  if (hasSsMedicare) {
    const irmaaCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const f = c.form_1040_out;
      const surcharge = f.irmaa_annual_surcharge;
      const lookbackExceeds = f.irmaa_lookback_magi > f.irmaa_tier1_threshold;
      const currentExceedsFuture = f.irmaa_current_magi_exceeds_cliff;

      let badgeText = 'Shielded';
      let tone: HorizonSummaryTone = 'positive';
      let subLabel = `≤${formatCompactCurrency(f.irmaa_future_tier1_threshold)} (${f.irmaa_future_coverage_year})`;

      if (surcharge > 0) {
        badgeText = `+${formatCompactCurrency(surcharge)}`;
        tone = 'danger';
        subLabel = `${f.irmaa_lookback_year} MAGI > ${formatCompactCurrency(f.irmaa_tier1_threshold)}`;
      } else if (lookbackExceeds) {
        badgeText = `${c.tax_year} >${formatCompactCurrency(f.irmaa_tier1_threshold)}`;
        tone = 'warning';
        subLabel = `${f.irmaa_lookback_year} MAGI ${formatCompactCurrency(f.irmaa_lookback_magi)}`;
      } else if (currentExceedsFuture) {
        badgeText = `${f.irmaa_future_coverage_year} Cliff`;
        tone = 'warning';
        subLabel = `>${formatCompactCurrency(f.irmaa_future_tier1_threshold)} (${f.irmaa_future_coverage_year})`;
      }

      return {
        taxYear: c.tax_year,
        numericValue: surcharge,
        display: surcharge > 0 ? formatCurrency(surcharge) : '$0',
        badgeText,
        subLabel,
        tone,
      };
    });
    const irmaaSum = irmaaCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'irmaa_lookback',
      section: 'personal',
      label: 'Medicare IRMAA (2-Yr Lookback & Cliff)',
      shortRef: 'SSA-44',
      cells: irmaaCells,
      totalNumeric: irmaaSum,
      totalDisplay: formatCurrency(irmaaSum),
      totalSubLabel: irmaaSum > 0 ? '6-Yr surch.' : 'No surch.',
    });
  }

  // 16-18. Basis & Shareholder Cash Flow (when S-Corp / Stock Basis active)
  if (hasStockBasis) {
    const capCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = c.scorp_in.capital_contributions || 0;
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
      };
    });
    const capSum = capCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'capital_contributions',
      section: 'basis',
      label: 'Capital Contributions (Basis Added)',
      shortRef: 'Form 7203',
      cells: capCells,
      totalNumeric: capSum,
      totalDisplay: formatCurrency(capSum),
    });

    const drawCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const val = c.scorp_in.scorp_distributions_total;
      return {
        taxYear: c.tax_year,
        numericValue: val,
        display: formatCurrency(val),
      };
    });
    const drawSum = drawCells.reduce((s, x) => s + x.numericValue, 0);
    rows.push({
      id: 'member_draws',
      section: 'basis',
      label: 'Member Draws / Distributions',
      shortRef: 'K-1 16d',
      cells: drawCells,
      totalNumeric: drawSum,
      totalDisplay: formatCurrency(drawSum),
    });

    const basisCells: HorizonSummaryCell[] = computedYears.map((c) => {
      const endBasis = c.scorp_out.stock_basis_ending;
      const excess = c.scorp_out.excess_distribution_capital_gain;
      return {
        taxYear: c.tax_year,
        numericValue: endBasis,
        display: formatCurrency(endBasis),
        subLabel:
          excess > 0
            ? `Gain ${formatCompactCurrency(excess)}`
            : `Beg ${formatCompactCurrency(c.scorp_in.stock_basis_beginning)}`,
        tone: excess > 0 ? 'danger' : endBasis <= 0 ? 'warning' : 'positive',
      };
    });
    const finalBasis = basisCells.length > 0 ? basisCells[basisCells.length - 1].numericValue : 0;
    rows.push({
      id: 'ending_stock_basis',
      section: 'basis',
      label: 'Ending Stock Basis (Form 7203)',
      shortRef: 'Form 7203',
      bold: true,
      highlight: 'secondary',
      cells: basisCells,
      totalNumeric: finalBasis,
      totalDisplay: formatCurrency(finalBasis),
      totalSubLabel: years.length > 0 ? `End ${years[years.length - 1]}` : undefined,
    });
  }

  const sixYearAllInTax = computedYears.reduce((s, c) => s + c.total_all_in_tax, 0);
  const sixYearNetCashFlow = computedYears.reduce((s, c) => s + c.estimated_net_cash_flow, 0);

  return {
    years,
    rows,
    hasScorp: setup.has_scorp,
    hasDbp: hasAnyDbp,
    hasStockBasis,
    hasSsMedicare,
    sixYearAllInTax,
    sixYearNetCashFlow,
  };
}

/**
 * Reconciles a working P&L snapshot's revenue lines (primary / secondary / total) against the
 * active Six-Year Horizon year when opening the CPA Package from Six-Year Horizon.
 *
 * - If the snapshot already matches Horizon to whole dollars (e.g., immediately after pushing
 *   from Transaction Cadence Forecast), exact cent-level YTD and Remaining figures are preserved.
 * - If the snapshot is stale relative to Horizon (e.g., Horizon was edited directly or an older
 *   saved snapshot drifted by >= $1), Remaining is back-solved from Horizon so Section 1 P&L,
 *   Horizon Group 1, and Section 4 Gross Receipts always tie out with $0 variance.
 */
export function reconcilePnlStateToHorizonRevenue(
  pnlState: PnlBalanceSheetState,
  horizonYear: ComputedTaxYear | undefined,
  setup?: SetupConfig | null
): PnlBalanceSheetState {
  if (!horizonYear) return pnlState;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const horizonCa = Math.round(Math.max(0, horizonYear.scorp_in.ca_revenue));
  const horizonAz = Math.round(Math.max(0, horizonYear.scorp_in.az_revenue));
  const horizonTotal = Math.round(Math.max(0, horizonYear.scorp_in.gross_receipts_revenue));

  const caLine = pnlState.pnl.ca_revenue ?? { ytd: 0, remaining: 0 };
  const azLine = pnlState.pnl.az_revenue ?? { ytd: 0, remaining: 0 };
  const pnlCa = r2(caLine.ytd + caLine.remaining);
  const pnlAz = r2(azLine.ytd + azLine.remaining);
  const pnlTotal = r2(pnlCa + pnlAz);

  const totalMatches = Math.round(pnlTotal) === horizonTotal;
  const caMatches = Math.abs(pnlCa - horizonCa) < 1;
  const azMatches = Math.abs(pnlAz - horizonAz) < 1;

  const targetDbp =
    (setup && setup.has_dbp === false) || horizonYear.dbp_in.dbp_status === 'terminated'
      ? 0
      : Math.max(0, Math.round(horizonYear.dbp_in.dbp_actual_contribution));
  const target401k = Math.max(0, Math.round(horizonYear.form_1040_out.employer_401k_total));
  const dbpLine = pnlState.pnl.dbp_contribution ?? { ytd: 0, remaining: 0 };
  const k401Line = pnlState.pnl.employer_401k ?? { ytd: 0, remaining: 0 };
  const manualRet = pnlState.retirement_line17_manual_overrides;
  const dbpMatches =
    Boolean(manualRet?.dbp_contribution) ||
    Math.abs(r2(dbpLine.ytd + dbpLine.remaining) - targetDbp) < 1;
  const k401Matches =
    Boolean(manualRet?.employer_401k) ||
    Math.abs(r2(k401Line.ytd + k401Line.remaining) - target401k) < 1;

  if (totalMatches && caMatches && azMatches && dbpMatches && k401Matches) {
    return pnlState;
  }

  return {
    ...pnlState,
    pnl: {
      ...pnlState.pnl,
      ...(!(totalMatches && caMatches && azMatches)
        ? {
            ca_revenue: {
              ytd: caLine.ytd,
              remaining: r2(horizonCa - caLine.ytd),
            },
            az_revenue: {
              ytd: azLine.ytd,
              remaining: r2(horizonAz - azLine.ytd),
            },
          }
        : {}),
      ...(!dbpMatches
        ? {
            dbp_contribution: {
              ytd: dbpLine.ytd,
              remaining: r2(targetDbp - dbpLine.ytd),
            },
          }
        : {}),
      ...(!k401Matches
        ? {
            employer_401k: {
              ytd: k401Line.ytd,
              remaining: r2(target401k - k401Line.ytd),
            },
          }
        : {}),
    },
  };
}

/**
 * Reconciles the working projection-year P&L / Form 7203 against the corresponding
 * tax year in the 6-year Horizon model so the CPA report clearly displays $0 parity
 * or highlights any un-pushed working P&L deltas transparently.
 */
export function computePnlVsHorizonReconciliation(
  pnlState: PnlBalanceSheetState,
  pnlComputed: ComputedPnlBalanceSheet,
  computedYears: ComputedTaxYear[],
  setup: SetupConfig
): PnlHorizonReconciliation | null {
  const projYear = pnlState.projection_year;
  const horizonYear = computedYears.find((c) => c.tax_year === projYear);
  if (!horizonYear) return null;

  const r0 = (n: number) => Math.round(n);
  const { primaryStateName, secondaryStateCode, secondaryStateName, hasPrimaryState } =
    getSetupStates(setup);
  const pnlW2 = r0(pnlComputed.totalCompensation.projected);
  const pnlObi = r0(pnlComputed.ordinaryBusinessIncome.projected);
  const horizonW2 = r0(getYearW2(horizonYear, setup));
  const horizonObi = r0(horizonYear.scorp_out.ordinary_business_income_1120s);

  const pteEntityTaxDeduction = r0(Math.max(0, horizonYear.scorp_out.pte_tax_paid_total));
  const pnlObiAfterPte = pnlObi - pteEntityTaxDeduction;
  const pnlEndingBasisAfterPte =
    pteEntityTaxDeduction > 0
      ? Math.max(0, r0(pnlComputed.projectedEndingStockBasis) - pteEntityTaxDeduction)
      : r0(pnlComputed.projectedEndingStockBasis);

  const checks: PnlHorizonReconLine[] = [
    {
      label: 'Gross Receipts',
      pnlValue: r0(pnlComputed.totalRevenue.projected),
      horizonValue: r0(horizonYear.scorp_in.gross_receipts_revenue),
      variance: 0,
    },
    ...(setup.multi_state_active && secondaryStateCode
      ? [
          {
            label: `${hasPrimaryState ? primaryStateName : 'Primary State'} S-Corp Revenue`,
            pnlValue: r0(pnlComputed.lines.ca_revenue.projected),
            horizonValue: r0(horizonYear.scorp_in.ca_revenue),
            variance: 0,
          },
          {
            label: `${secondaryStateName} S-Corp Revenue`,
            pnlValue: r0(pnlComputed.lines.az_revenue.projected),
            horizonValue: r0(horizonYear.scorp_in.az_revenue),
            variance: 0,
          },
        ]
      : []),
    {
      label: 'OpEx (Excl. Payroll)',
      pnlValue: r0(pnlComputed.totalOperatingExpensesExclPayroll.projected),
      horizonValue: r0(horizonYear.scorp_out.effective_operating_expenses),
      variance: 0,
    },
    {
      label: 'Officer W-2 Wages',
      pnlValue: pnlW2,
      horizonValue: horizonW2,
      variance: 0,
    },
    {
      label: 'Owner Health (SEHI)',
      pnlValue: r0(pnlComputed.lines.sehi_medicare.projected),
      horizonValue: r0(horizonYear.form_1040_out.sehi_medicare_premiums_effective),
      variance: 0,
    },
    {
      label: 'Employer Payroll Taxes',
      pnlValue: r0(pnlComputed.lines.payroll_taxes.projected),
      horizonValue: r0(horizonYear.scorp_out.employer_payroll_taxes),
      variance: 0,
    },
    {
      label: 'DBP Contribution',
      pnlValue: r0(pnlComputed.lines.dbp_contribution.projected),
      horizonValue: r0(getYearDbp(horizonYear, setup)),
      variance: 0,
    },
    {
      label: 'Employer 401(k)',
      pnlValue: r0(pnlComputed.lines.employer_401k.projected),
      horizonValue: r0(horizonYear.form_1040_out.employer_401k_total),
      variance: 0,
    },
    {
      label:
        pteEntityTaxDeduction > 0
          ? 'K-1 Ordinary Business Income (Post-PTE)'
          : 'K-1 Ordinary Business Income',
      pnlValue: pnlObiAfterPte,
      horizonValue: horizonObi,
      variance: 0,
    },
    {
      label: 'Capital Contributions',
      pnlValue: r0(pnlComputed.projectedCapitalContributionsTotal),
      horizonValue: r0(horizonYear.scorp_in.capital_contributions || 0),
      variance: 0,
    },
    {
      label: 'Member Draws',
      pnlValue: r0(pnlComputed.projectedDrawsTotal),
      horizonValue: r0(horizonYear.scorp_in.scorp_distributions_total),
      variance: 0,
    },
    {
      label: 'Ending Stock Basis',
      pnlValue: pnlEndingBasisAfterPte,
      horizonValue: r0(horizonYear.scorp_out.stock_basis_ending),
      variance: 0,
    },
  ].map((row) => ({ ...row, variance: row.pnlValue - row.horizonValue }));

  const obiVariance = pnlObi - horizonObi;
  const obiAfterPteVariance = pnlObiAfterPte - horizonObi;
  const basisVariance =
    pnlEndingBasisAfterPte - r0(horizonYear.scorp_out.stock_basis_ending);
  const exactBottomLineTieOut = obiAfterPteVariance === 0 && basisVariance === 0;
  // IRS Form 1120-S rounds cent-level QBO books to whole dollars; when K-1 OBI (after Entity PTE
  // deduction, if elected) and Ending Stock Basis tie to exact $0, a +/-$1 whole-dollar rounding
  // absorption on a single sub-line is reconciled.
  const mismatchedLines = checks.filter((c) =>
    exactBottomLineTieOut ? Math.abs(c.variance) > 1 : c.variance !== 0
  );
  const rcPnlPct = Number((computeReasonableCompRatio(pnlW2, pnlObi) * 100).toFixed(1));
  const rcHorizonPct = Number((horizonYear.scorp_out.reasonable_comp_ratio * 100).toFixed(1));

  return {
    projectionYear: projYear,
    isReconciled: exactBottomLineTieOut && mismatchedLines.length === 0,
    pnlObi,
    horizonObi,
    pteEntityTaxDeduction,
    obiVariance,
    obiAfterPteVariance,
    basisVariance,
    rcPnlPct,
    rcHorizonPct,
    rcVariancePct: Number((rcPnlPct - rcHorizonPct).toFixed(1)),
    mismatchedLines,
  };
}

/**
 * Returns the exact Form 1040 Joint AGI / MAGI figure reported in Section 4 (Multi-Year Horizon
 * Summary) for a computed tax year (`adjusted_gross_income + tax_exempt_interest`).
 */
export function getHorizonYearMagi(horizonYear: ComputedTaxYear): number {
  const agi = horizonYear.form_1040_out.adjusted_gross_income;
  const taxExemptInt = horizonYear.form_1040_in.tax_exempt_interest || 0;
  return Math.round(agi + taxExemptInt);
}

/**
 * Reconciles Section 5 Planning Goals & Guardrails (specifically the `income_ceiling` IRMAA
 * 2-year lookback guardrail) against Section 4's authoritative projection-year Form 1040 Joint
 * MAGI so Section 4 and Section 5 always report the identical figure, Shielded / Within Guardrail
 * vs. Over Target status, and variance copy across Preview, Print/PDF, and CSV exports.
 */
export function reconcileCpaGoalsWithHorizon(
  activeGoals: EvaluatedPlanningGoal[],
  computedYears: ComputedTaxYear[] | undefined,
  projectionYear: number,
  setup: SetupConfig
): EvaluatedPlanningGoal[] {
  if (!computedYears || computedYears.length === 0 || activeGoals.length === 0) {
    return activeGoals;
  }
  const horizonYear = computedYears.find((c) => c.tax_year === projectionYear);
  if (!horizonYear) return activeGoals;

  const section4Magi = getHorizonYearMagi(horizonYear);
  return activeGoals.map((item) => {
    if (item.goal.kind !== 'income_ceiling') return item;
    return evaluateIncomeCeilingGoalWithMagi(
      item.goal,
      section4Magi,
      projectionYear,
      setup
    );
  });
}
