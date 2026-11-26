import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import type {
  ComputedTaxYear,
  GuardrailAcknowledgment,
  PnlBalanceSheetState,
  SetupConfig,
  ValidationIssue,
} from '../types/tax';
import {
  PNL_OPERATING_ITEMS,
  PNL_SECTIONS,
  SCHEDULE_K_LINE_META,
  buildCpaPackageMetadata,
  getPnlLineLabel,
  type ComputedPnlBalanceSheet,
  type CpaPackageMetadata,
  type CpaReportMetadata,
} from '../engine/pnlBalanceSheet';
import {
  buildCpaHorizonSummary,
  computePnlVsHorizonReconciliation,
  type CpaHorizonSummaryTable,
  type PnlHorizonReconciliation,
} from '../engine/cpaHorizonSummary';
import { getPersonNames } from '../engine/scheduleCatalog';
import {
  formatReasonableCompExplanationSummary,
  formatReasonableCompFindingMessage,
  getGuardrailAckStatusLabel,
  syncReasonableCompNoteText,
} from '../engine/validator';
import { getSetupStates } from '../utils/setupHelpers';
import { formatCurrency, formatCurrencyExact } from '../utils/format';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCpaEntityLabels(
  setup: SetupConfig,
  primaryName: string,
  spouseName: string,
  computed: ComputedPnlBalanceSheet
) {
  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const entityType = setup.entity_type;
  const packageEyebrow =
    entityType === 'scorp_llc'
      ? 'Form 1120-S Year-End Financial & Tax Projection Package'
      : entityType === 'partnership'
      ? 'Form 1065 Year-End Financial & Tax Projection Package'
      : entityType === 'ccorp'
      ? 'Form 1120 Year-End Financial & Tax Projection Package'
      : entityType === 'sole_prop'
      ? 'Schedule C Year-End Financial & Tax Projection Package'
      : 'Year-End Financial & Tax Projection Package';
  const entityFormLabel =
    entityType === 'scorp_llc'
      ? 'Form 1120-S'
      : entityType === 'partnership'
      ? 'Form 1065'
      : entityType === 'ccorp'
      ? 'Form 1120'
      : entityType === 'sole_prop'
      ? 'Schedule C'
      : 'Business P&L';
  const ordinaryIncomeCardLabel =
    entityType === 'scorp_llc'
      ? 'Projected 1120-S Line 22'
      : entityType === 'partnership'
      ? 'Projected 1065 Ordinary Income'
      : entityType === 'ccorp'
      ? 'Projected 1120 Taxable Income'
      : entityType === 'sole_prop'
      ? 'Projected Schedule C Net Profit'
      : 'Projected Net Operating Income';
  const ordinaryIncomeRowLabel =
    entityType === 'scorp_llc'
      ? 'Projected Ordinary Business Income (Form 1120-S Line 22)'
      : entityType === 'partnership'
      ? 'Projected Ordinary Business Income (Form 1065 Line 23)'
      : entityType === 'ccorp'
      ? 'Projected Taxable Income (Form 1120 Line 30)'
      : entityType === 'sole_prop'
      ? 'Projected Net Profit (Schedule C Line 31)'
      : 'Projected Net Operating Income';
  const ordinaryIncomeRef =
    entityType === 'scorp_llc'
      ? 'Line 22'
      : entityType === 'partnership'
      ? 'Line 23'
      : entityType === 'ccorp'
      ? 'Line 30'
      : entityType === 'sole_prop'
      ? 'Line 31'
      : 'Net';
  const filingStatusLabel =
    setup.filing_status === 'married_filing_jointly'
      ? 'MFJ'
      : setup.filing_status === 'married_filing_separately'
      ? 'MFS'
      : setup.filing_status === 'head_of_household'
      ? 'HOH'
      : 'Single';
  const ownershipLabel =
    setup.filing_status === 'married_filing_jointly'
      ? `${primaryName} ${computed.billSharePct}% / ${spouseName} ${computed.debraSharePct}%`
      : `${primaryName} 100%`;
  const activeStatesLabel =
    setup.multi_state_active && primaryStateCode && secondaryStateCode
      ? `${primaryStateCode} / ${secondaryStateCode}`
      : primaryStateCode || '';
  return {
    packageEyebrow,
    entityFormLabel,
    ordinaryIncomeCardLabel,
    ordinaryIncomeRowLabel,
    ordinaryIncomeRef,
    filingStatusLabel,
    ownershipLabel,
    activeStatesLabel,
  };
}

export interface StandaloneHtmlParams {
  setup: SetupConfig;
  pnlState: PnlBalanceSheetState;
  computed: ComputedPnlBalanceSheet;
  computedYears?: ComputedTaxYear[];
  entityName: string;
  entityEin: string;
  primaryName: string;
  spouseName: string;
  generatedOn: string;
  meta: CpaPackageMetadata;
  horizonSummary?: CpaHorizonSummaryTable | null;
  pnlRecon?: PnlHorizonReconciliation | null;
  basisRows: {
    billBeg: number;
    debraBeg: number;
    posInc: number;
    billInc: number;
    debraInc: number;
    ordLoss: number;
    billLoss: number;
    debraLoss: number;
    posInt: number;
    billInt: number;
    debraInt: number;
    billCap: number;
    debraCap: number;
    billDraws: number;
    debraDraws: number;
    billNonded: number;
    debraNonded: number;
  };
  acknowledgedGuardrails: {
    ack: GuardrailAcknowledgment;
    title: string;
    message: string;
    explanationNote: string;
    explanationRatioSummary?: string;
    severity: string;
  }[];
  activeGuardrailCount: number;
}

export function buildStandalonePrintHtml({
  setup,
  pnlState,
  computed,
  computedYears,
  entityName,
  entityEin,
  primaryName,
  spouseName,
  generatedOn,
  meta,
  horizonSummary: providedHorizonSummary,
  pnlRecon: providedPnlRecon,
  basisRows,
  acknowledgedGuardrails,
  activeGuardrailCount,
}: StandaloneHtmlParams): string {
  const bs = pnlState.balance_sheet;
  const e = escapeHtml;
  const cur = (n: number) => e(formatCurrencyExact(n));
  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const pCode = primaryStateCode || 'State 1';
  const sCode = secondaryStateCode || 'State 2';
  const isMfj = setup.filing_status === 'married_filing_jointly';
  const priorYearLabel = `${pnlState.projection_year - 1} Filed`;
  const labels = getCpaEntityLabels(setup, primaryName, spouseName, computed);
  const horizonSummary =
    providedHorizonSummary !== undefined
      ? providedHorizonSummary
      : computedYears && computedYears.length > 0
      ? buildCpaHorizonSummary(setup, computedYears)
      : null;
  const pnlRecon =
    providedPnlRecon !== undefined
      ? providedPnlRecon
      : computedYears && computedYears.length > 0
      ? computePnlVsHorizonReconciliation(pnlState, computed, computedYears, setup)
      : null;
  const entityMetaParts = [
    entityEin.trim() ? `<span class="mono">EIN ${e(entityEin.trim())}</span>` : '',
    `Tax Year ${e(pnlState.projection_year)}`,
    `Filing: ${e(labels.filingStatusLabel)}${labels.activeStatesLabel ? ` · ${e(labels.activeStatesLabel)}` : ''}`,
    `Ownership: ${e(labels.ownershipLabel)}`,
  ].filter(Boolean);

  const assumptionsHtml = (meta.activeAssumptions ?? [])
    .map(
      (item) =>
        `<div class="assumption-item"><span class="assumption-label">${e(item.label)}:</span> ${e(
          item.value
        )}</div>`
    )
    .join('');

  const pnlRowsHtml = PNL_SECTIONS.map((sec) => {
    const items = PNL_OPERATING_ITEMS.filter((i) => i.section === sec.id);
    const itemRows = items
      .map((item) => {
        const vals = computed.lines[item.id];
        const mealsSubRows =
          item.id === 'meals_gross'
            ? `
              <tr class="sub-row">
                <td class="indent">&#8627; 50% Deductible Meals (Included in ${e(labels.entityFormLabel)})</td>
                <td class="mono muted">Line 19</td>
                <td class="num">${cur(computed.mealsDeductible50.ytd)}</td>
                <td class="num">${cur(computed.mealsDeductible50.remaining)}</td>
                <td class="num">${cur(computed.mealsDeductible50.projected)}</td>
                <td class="num muted">${cur(computed.mealsDeductible50.filed2025)}</td>
              </tr>
              <tr class="sub-row amber-row">
                <td class="indent">&#8627; 50% Nondeductible Meals (Sch M-1 / Basis)</td>
                <td class="mono amber-text">Sch M-1</td>
                <td class="num">${cur(computed.mealsNondeductible50.ytd)}</td>
                <td class="num">${cur(computed.mealsNondeductible50.remaining)}</td>
                <td class="num">${cur(computed.mealsNondeductible50.projected)}</td>
                <td class="num">${cur(computed.mealsNondeductible50.filed2025)}</td>
              </tr>
            `
            : '';

        return `
          <tr>
            <td class="pad-l">${e(getPnlLineLabel(item, setup))}</td>
            <td class="mono muted">${e(item.form1120sRef)}</td>
            <td class="num">${cur(vals.ytd)}</td>
            <td class="num">${cur(vals.remaining)}</td>
            <td class="num strong">${cur(vals.projected)}</td>
            <td class="num muted">${cur(vals.filed2025)}</td>
          </tr>
          ${mealsSubRows}
        `;
      })
      .join('');

    const sectionSubtotal =
      sec.id === 'revenue'
        ? `
          <tr class="subtotal-row">
            <td class="pad-l">Total Gross Receipts</td>
            <td class="mono muted">Line 1a</td>
            <td class="num">${cur(computed.totalRevenue.ytd)}</td>
            <td class="num">${cur(computed.totalRevenue.remaining)}</td>
            <td class="num">${cur(computed.totalRevenue.projected)}</td>
            <td class="num muted">${cur(computed.totalRevenue.filed2025)}</td>
          </tr>
        `
        : sec.id === 'operating_expenses'
          ? `
            <tr class="subtotal-row">
              <td class="pad-l">
                Total Operating Expenses (Excl. W-2 &amp; Retirement &middot; Tax Deductible)
                <div class="muted" style="font-size:9px;font-weight:400;margin-top:2px;">
                  Excl. Payroll Taxes (${e(labels.entityFormLabel)} / Horizon OpEx): ${cur(computed.totalOperatingExpensesExclPayroll.projected)}
                </div>
              </td>
              <td class="mono muted">Lines 11&ndash;19</td>
              <td class="num">${cur(computed.totalOperatingExpensesDeductible.ytd)}</td>
              <td class="num">${cur(computed.totalOperatingExpensesDeductible.remaining)}</td>
              <td class="num">${cur(computed.totalOperatingExpensesDeductible.projected)}</td>
              <td class="num muted">${cur(computed.totalOperatingExpensesDeductible.filed2025)}</td>
            </tr>
          `
          : '';

    return `
      <tr class="section-row">
        <td colspan="6">${e(sec.title)}</td>
      </tr>
      ${itemRows}
      ${sectionSubtotal}
    `;
  }).join('');

  const excessGainRowHtml = computed.drawsExceedBasis
    ? isMfj
      ? `
      <tr class="danger-row">
        <td>Form 8949 Excess Dist. Gain</td>
        <td class="num">${cur(computed.projectedExcessDistributionGain)}</td>
        <td class="num">${cur(computed.billExcessGain)}</td>
        <td class="num">${cur(computed.debraExcessGain)}</td>
      </tr>
    `
      : `
      <tr class="danger-row">
        <td>Form 8949 Excess Dist. Gain</td>
        <td class="num">${cur(computed.projectedExcessDistributionGain)}</td>
      </tr>
    `
    : '';

  const ordinaryLossRowHtml =
    basisRows.ordLoss > 0
      ? isMfj
        ? `
      <tr>
        <td>&minus; Projected Ordinary Loss</td>
        <td class="num">${cur(-basisRows.ordLoss)}</td>
        <td class="num">${cur(-basisRows.billLoss)}</td>
        <td class="num">${cur(-basisRows.debraLoss)}</td>
      </tr>
    `
        : `
      <tr>
        <td>&minus; Projected Ordinary Loss</td>
        <td class="num">${cur(-basisRows.ordLoss)}</td>
      </tr>
    `
      : '';

  let nextSectionNum = setup.has_stock_basis !== false ? 4 : 3;
  const horizonSectionNum = horizonSummary ? nextSectionNum++ : 0;
  const goalsSectionNum = meta.activeGoals.length > 0 ? nextSectionNum++ : 0;
  const ackSectionNum = acknowledgedGuardrails.length > 0 ? nextSectionNum++ : 0;

  const horizonSectionHtml = horizonSummary
    ? (() => {
        const firstYr = horizonSummary.years[0];
        const lastYr = horizonSummary.years[horizonSummary.years.length - 1];
        const yrCols = horizonSummary.years
          .map(
            (y) =>
              `<th class="num">${e(y)}${
                y === setup.anchor_actuals_year ? '<div class="h-th-sub">Actuals</div>' : ''
              }</th>`
          )
          .join('');
        const colDefs = `<col style="width:28%;" />${horizonSummary.years
          .map(() => `<col style="width:10%;" />`)
          .join('')}<col style="width:12%;" />`;

        let lastSec = '';
        const secHeaders: Record<string, string> = {
          entity: `${labels.entityFormLabel} Entity Operations & Retirement`,
          personal: 'Form 1040 Taxable Income, Federal/State Taxes & IRMAA',
          basis: 'Shareholder Capital Contributions, Draws & Stock Basis',
        };
        const rowsHtml = horizonSummary.rows
          .map((row) => {
            const secBanner =
              row.section !== lastSec
                ? `<tr class="section-row"><td colspan="${
                    horizonSummary.years.length + 2
                  }">${e(secHeaders[row.section] || row.section)}</td></tr>`
                : '';
            lastSec = row.section;
            const rowCls =
              row.highlight === 'primary'
                ? 'grand-total-row'
                : row.highlight === 'secondary'
                ? 'subtotal-row'
                : '';
            const cellsHtml = row.cells
              .map((cell) => {
                const badgeCls =
                  cell.tone === 'danger'
                    ? 'badge-over'
                    : cell.tone === 'warning'
                    ? 'badge-watch'
                    : cell.tone === 'positive'
                    ? 'badge-within'
                    : '';
                const valHtml = cell.badgeText
                  ? `<span class="h-badge ${badgeCls}">${e(cell.badgeText)}</span>`
                  : `<span class="${row.bold ? 'strong' : ''}">${e(cell.display)}</span>`;
                const subHtml = cell.subLabel
                  ? `<div class="h-sub">${e(cell.subLabel)}</div>`
                  : '';
                return `<td class="num">${valHtml}${subHtml}</td>`;
              })
              .join('');
            const totalSub = row.totalSubLabel
              ? `<div class="h-sub">${e(row.totalSubLabel)}</div>`
              : '';
            return `${secBanner}<tr class="${rowCls}">
              <td><span class="${row.bold ? 'strong' : ''}">${e(row.label)}</span> <span class="h-ref">${e(row.shortRef)}</span></td>
              ${cellsHtml}
              <td class="num strong">${e(row.totalDisplay)}${totalSub}</td>
            </tr>`;
          })
          .join('');

        return `
    <section class="horizon-section">
      <h2>${horizonSectionNum}. Multi-Year Tax &amp; Cash-Flow Horizon Summary (${e(firstYr)}&ndash;${e(lastYr)})</h2>
      <table class="horizon-table">
        <colgroup>${colDefs}</colgroup>
        <thead>
          <tr>
            <th>Horizon Metric</th>
            ${yrCols}
            <th class="num">${e(horizonSummary.years.length)}-Yr Total / End</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div class="h-footnote">
        All ${e(firstYr)}&ndash;${e(lastYr)} figures tie directly to the 6-Year Horizon Tax Engine ($0 variance). Medicare IRMAA follows the statutory 2-year lookback (e.g., 2026 MAGI sets 2028 Medicare premiums).
      </div>
    </section>`;
      })()
    : '';

  const reconStripHtml =
    pnlRecon && setup.has_scorp
      ? pnlRecon.isReconciled
        ? `<div class="recon-box recon-ok">
      <strong>${e(pnlRecon.projectionYear)} Working P&amp;L &harr; ${e(pnlRecon.projectionYear)} Horizon Reconciled ($0 Operating Variance):</strong>
      Gross Receipts, OpEx, Officer W-2, SEHI, Payroll Taxes, DBP, 401(k), Capital Contributions &amp; Draws tie identically${
        pnlRecon.pteEntityTaxDeduction > 0
          ? ` &middot; Pre-PTE Working P&amp;L OBI ${e(
              formatCurrency(pnlRecon.pnlObi)
            )} &minus; Entity PTE Deduction ${e(
              formatCurrency(pnlRecon.pteEntityTaxDeduction)
            )} = ${e(formatCurrency(pnlRecon.horizonObi))} Form 1120-S K-1 OBI`
          : ' &middot; K-1 OBI &amp; Ending Stock Basis tie to $0'
      } &middot; Reasonable Comp ${e(pnlRecon.rcHorizonPct.toFixed(1))}%.
    </div>`
        : `<div class="recon-box recon-delta">
      <strong>${e(pnlRecon.projectionYear)} Working P&amp;L vs. ${e(pnlRecon.projectionYear)} Horizon Variance Notice:</strong>
      Working P&amp;L reflects live bookkeeping/cadence projections not yet pushed to the ${e(
        pnlRecon.projectionYear
      )} Horizon schedule (${
            pnlRecon.pteEntityTaxDeduction > 0
              ? `Pre-PTE OBI ${e(formatCurrency(pnlRecon.pnlObi))} &minus; Entity PTE ${e(
                  formatCurrency(pnlRecon.pteEntityTaxDeduction)
                )} vs. Horizon K-1 ${e(formatCurrency(pnlRecon.horizonObi))}, net delta ${e(
                  pnlRecon.obiAfterPteVariance >= 0 ? '+' : ''
                )}${e(formatCurrency(pnlRecon.obiAfterPteVariance))}`
              : `K-1 OBI delta ${e(pnlRecon.obiVariance >= 0 ? '+' : '')}${e(
                  formatCurrency(pnlRecon.obiVariance)
                )}`
          }, Basis delta ${e(pnlRecon.basisVariance >= 0 ? '+' : '')}${e(
            formatCurrency(pnlRecon.basisVariance)
          )}, RC ${e(pnlRecon.rcPnlPct.toFixed(1))}% vs. ${e(
            pnlRecon.rcHorizonPct.toFixed(1)
          )}%). Section ${horizonSectionNum} below shows the authoritative ${e(
            horizonSummary?.years[0] ?? 2025
          )}&ndash;${e(
            horizonSummary?.years[horizonSummary.years.length - 1] ?? 2030
          )} Horizon Tax Plan.
    </div>`
      : '';

  const goalsSectionHtml =
    meta.activeGoals.length > 0
      ? `
    <section class="goals-section">
      <h2>${goalsSectionNum}. Planning Goals &amp; Guardrails for CPA Review (${meta.activeGoals.length} Active)</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 24%;">Goal / Guardrail</th>
            <th class="num" style="width: 14%;">Target</th>
            <th class="num" style="width: 16%;">Projected</th>
            <th style="width: 14%;">Status</th>
            <th style="width: 32%;">Why This Matters &amp; Variance Context</th>
          </tr>
        </thead>
        <tbody>
          ${meta.activeGoals
            .map((item) => {
              const badgeCls =
                item.status === 'over'
                  ? 'badge-over'
                  : item.status === 'watch'
                    ? 'badge-watch'
                    : 'badge-within';
              const targetSubHtml =
                item.goal.kind === 'income_ceiling' && item.linkedIrmaa
                  ? `<div class="goal-var">${
                      item.linkedIrmaa.isGoalTargetOverridden
                        ? `Custom &middot; ${e(item.linkedIrmaa.coverageYear)} IRMAA (${e(
                            item.linkedIrmaa.filingStatusShort
                          )}) ${cur(item.linkedIrmaa.threshold)}`
                        : `${e(item.linkedIrmaa.coverageYear)} IRMAA Tier 1 (${e(
                            item.linkedIrmaa.filingStatusShort
                          )} &middot; 2-yr lookback)`
                    }</div>`
                  : '';
              return `
          <tr>
            <td class="strong">${e(item.goal.title)}</td>
            <td class="num"><div>${e(item.targetDisplay)}</div>${targetSubHtml}</td>
            <td class="num strong">${e(item.currentDisplay)}</td>
            <td><span class="status-badge ${badgeCls}">${e(item.statusLabel)}</span></td>
            <td>
              <div class="goal-why">${e(item.goal.why_it_matters)}</div>
              <div class="goal-var">${e(item.varianceSummary)}</div>
            </td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </section>
      `
      : '';

  const pageTitle = `${entityName} — ${pnlState.projection_year} CPA Year-End Projection Package`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${e(pageTitle)}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0.45in 0.5in;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      max-width: 960px;
      margin: 0 auto 14px auto;
      padding: 10px 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .toolbar-note {
      font-size: 11px;
      color: #475569;
    }
    .toolbar-btn {
      background: #115e59;
      color: #ffffff;
      border: none;
      border-radius: 5px;
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .toolbar-btn:hover {
      background: #134e4a;
    }
    .sheet {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 26px 28px;
    }
    .brand-bar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 8px;
      margin-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 10.5px;
      color: #475569;
    }
    .brand-strong {
      font-weight: 700;
      color: #0f172a;
    }
    .brand-site {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #115e59;
    }
    .header-main {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-end;
      gap: 14px;
      padding-bottom: 14px;
      border-bottom: 2px solid #0f172a;
      margin-bottom: 14px;
    }
    .eyebrow {
      font-size: 10.5px;
      font-weight: 600;
      color: #64748b;
      margin: 0 0 2px 0;
    }
    h1 {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.015em;
      margin: 0;
      color: #0f172a;
    }
    .entity-meta {
      margin-top: 4px;
      font-size: 11px;
      color: #475569;
    }
    .header-right {
      text-align: right;
      font-size: 11px;
      color: #475569;
      line-height: 1.5;
    }
    .disclaimer-box {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-left: 4px solid #d97706;
      border-radius: 5px;
      padding: 10px 13px;
      margin-bottom: 14px;
      break-inside: avoid;
    }
    .disclaimer-title {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: #78350f;
      margin-bottom: 3px;
    }
    .disclaimer-body {
      font-size: 10.5px;
      line-height: 1.45;
      color: #78350f;
      margin: 0;
    }
    .assumptions-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      padding: 10px 13px;
      margin-bottom: 16px;
      break-inside: avoid;
    }
    .assumptions-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #1e293b;
      margin-bottom: 6px;
    }
    .assumptions-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px 18px;
      font-size: 10px;
      color: #475569;
    }
    .assumption-label {
      font-weight: 600;
      color: #334155;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
      break-inside: avoid;
    }
    .summary-card {
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      padding: 9px 11px;
    }
    .summary-label {
      font-size: 10px;
      color: #64748b;
    }
    .summary-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 2px;
    }
    .summary-value.positive {
      color: #047857;
    }
    .summary-value.negative {
      color: #b91c1c;
    }
    .summary-sub {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
    }
    section {
      margin-bottom: 18px;
    }
    h2 {
      font-size: 11.5px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
      margin: 0 0 6px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    th {
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      color: #475569;
      padding: 5px 6px;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 4px 6px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    .pad-l {
      padding-left: 8px;
    }
    .indent {
      padding-left: 20px;
    }
    .num {
      text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    th.num {
      text-align: right;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 9.5px;
    }
    .strong {
      font-weight: 600;
      color: #0f172a;
    }
    .muted {
      color: #64748b;
    }
    .section-row td {
      background: #f8fafc;
      font-weight: 700;
      color: #1e293b;
      padding: 5px 8px;
    }
    .sub-row td {
      font-size: 10px;
      color: #475569;
      background: #fafafa;
    }
    .amber-row td {
      background: #fffbeb;
      color: #92400e;
    }
    .amber-text {
      color: #b45309;
    }
    .subtotal-row td {
      font-weight: 600;
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      padding-top: 5px;
      padding-bottom: 5px;
    }
    .grand-total-row td {
      font-weight: 700;
      background: #f1f5f9;
      border-top: 2px solid #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .schk-row td {
      background: #f8fafc;
      font-weight: 500;
    }
    .danger-row td {
      background: #fef2f2;
      color: #b91c1c;
      font-weight: 600;
    }
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      break-inside: avoid;
    }
    .goals-section {
      break-inside: avoid;
    }
    .horizon-section {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .horizon-table {
      table-layout: fixed;
      width: 100%;
      font-size: 9px;
    }
    .horizon-table th {
      font-size: 8.5px;
      padding: 4px 3px;
    }
    .horizon-table td {
      padding: 3.5px 3px;
      line-height: 1.25;
      overflow-wrap: break-word;
    }
    .h-th-sub {
      font-size: 7.5px;
      font-weight: 500;
      color: #64748b;
    }
    .h-ref {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 7.5px;
      color: #64748b;
      margin-left: 2px;
    }
    .h-sub {
      font-size: 7.5px;
      color: #64748b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }
    .h-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 700;
      border: 1px solid #cbd5e1;
      background: #f1f5f9;
      color: #334155;
      white-space: nowrap;
    }
    .h-footnote {
      font-size: 8.5px;
      color: #64748b;
      margin-top: 5px;
    }
    .recon-box {
      border-radius: 5px;
      padding: 7px 11px;
      margin-bottom: 14px;
      font-size: 9.5px;
      line-height: 1.4;
      break-inside: avoid;
    }
    .recon-ok {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }
    .recon-delta {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .badge-within {
      background: #ecfdf5;
      color: #065f46;
      border-color: #a7f3d0;
    }
    .badge-watch {
      background: #fffbeb;
      color: #92400e;
      border-color: #fde68a;
    }
    .badge-over {
      background: #fef2f2;
      color: #991b1b;
      border-color: #fecaca;
    }
    .goal-why {
      font-size: 10px;
      color: #334155;
      line-height: 1.38;
    }
    .goal-var {
      font-size: 9.5px;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-top: 2px;
    }
    footer {
      border-top: 2px solid #cbd5e1;
      padding-top: 11px;
      margin-top: 10px;
      font-size: 10px;
      color: #475569;
      break-inside: avoid;
    }
    .footer-top {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      color: #1e293b;
      margin-bottom: 6px;
    }
    .footer-assumptions {
      margin-bottom: 6px;
    }
    .footer-disclaimer {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 7px 10px;
      color: #334155;
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .toolbar {
        display: none !important;
      }
      .sheet {
        max-width: none;
        border: none;
        border-radius: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-note">
      Standalone printable CPA Year-End Projection Package &mdash; use <strong>Print / Save as PDF</strong> to save a PDF copy for review with your CPA.
    </div>
    <button type="button" class="toolbar-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <main class="sheet">
    <header>
      ${
        setup.workspace_profile_kind === 'test_persona' ||
        setup.workspace_profile_kind === 'blank'
          ? `<div style="background:#fffbeb;border:1px solid #f59e0b;color:#78350f;padding:6px 10px;border-radius:4px;margin-bottom:10px;font-size:10px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;">
        Testing Mode Active &mdash; ${
          setup.workspace_profile_kind === 'test_persona'
            ? 'Synthetic Test Persona Data'
            : 'Blank User Sandbox'
        } (Not Saved Profile &middot; Not for CPA Filing)
      </div>`
          : ''
      }
      <div class="brand-bar">
        <div>
          <span class="brand-strong">${e(meta.preparedBy)}</span>
          ${meta.website ? `&nbsp;&middot;&nbsp;<span class="brand-site">${e(meta.website)}</span>` : ''}
        </div>
        <div><strong>Module:</strong> ${e(meta.moduleName)}</div>
      </div>

      <div class="header-main">
        <div>
          <p class="eyebrow">${e(labels.packageEyebrow)}</p>
          <h1>${e(entityName)}</h1>
          <div class="entity-meta">
            ${entityMetaParts.join('&nbsp;&middot;&nbsp;')}
          </div>
        </div>
        <div class="header-right">
          <div>
            As-Of Date: <strong class="mono">${e(meta.asOfDateDisplay)}</strong>
            <span class="mono muted">(${e(meta.asOfDate)})</span>
          </div>
          <div>
            Remaining Through ${e(meta.yearEndDisplay)}:
            <strong class="mono">${e(meta.remainingDays)} days</strong>
            <span class="mono muted">(${e(meta.elapsedDays)}/${e(meta.totalYearDays)} YTD)</span>
          </div>
          ${
            setup.multi_state_active
              ? `<div>
            Apportionment (Projected):
            <strong class="mono">${e(pCode)} ${e(computed.caPct.projected)}% / ${e(sCode)} ${e(
                  computed.azPct.projected
                )}%</strong>
          </div>`
              : ''
          }
          <div class="muted">Generated ${e(generatedOn)}</div>
        </div>
      </div>
    </header>

    <div class="disclaimer-box" role="note">
      <div class="disclaimer-title">${e(meta.disclaimerHeadline)}</div>
      <p class="disclaimer-body">${e(meta.disclaimerBody)}</p>
    </div>

    <div class="assumptions-box">
      <div class="assumptions-title">Active Forecast Assumptions</div>
      <div class="assumptions-grid">${assumptionsHtml}</div>
    </div>

    <div class="summary-grid" style="${
      setup.has_stock_basis === false ? 'grid-template-columns: repeat(3, minmax(0, 1fr));' : ''
    }">
      <div class="summary-card">
        <div class="summary-label">Projected Gross Receipts</div>
        <div class="summary-value">${cur(computed.totalRevenue.projected)}</div>
        <div class="summary-sub">${
          setup.multi_state_active
            ? `${e(pCode)} ${e(computed.caPct.projected)}% &middot; ${e(sCode)} ${e(computed.azPct.projected)}%`
            : `YTD ${cur(computed.totalRevenue.ytd)}`
        }</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${e(labels.ordinaryIncomeCardLabel)}</div>
        <div class="summary-value">${cur(computed.ordinaryBusinessIncome.projected)}</div>
        <div class="summary-sub">${e(priorYearLabel)}: ${cur(computed.ordinaryBusinessIncome.filed2025)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Projected Member Draws</div>
        <div class="summary-value">${cur(computed.projectedDrawsTotal)}</div>
        <div class="summary-sub">Cap Contrib: ${cur(computed.projectedCapitalContributionsTotal)}</div>
      </div>
      ${
        setup.has_stock_basis !== false
          ? `<div class="summary-card">
        <div class="summary-label">Projected Ending Basis</div>
        <div class="summary-value ${computed.drawsExceedBasis ? 'negative' : 'positive'}">${cur(
              computed.projectedEndingStockBasis
            )}</div>
        <div class="summary-sub">${
          computed.drawsExceedBasis
            ? `Excess Gain: ${cur(computed.projectedExcessDistributionGain)}`
            : 'No excess dist gain'
        }</div>
      </div>`
          : ''
      }
    </div>

    ${reconStripHtml}

    <section>
      <h2>1. Profit &amp; Loss Projection (${e(labels.entityFormLabel)} Structure)</h2>
      <table>
        <thead>
          <tr>
            <th>Line Item</th>
            <th>Ref</th>
            <th class="num">YTD Actuals</th>
            <th class="num">Remaining</th>
            <th class="num">Projected ${e(pnlState.projection_year)}</th>
            <th class="num">${e(priorYearLabel)}</th>
          </tr>
        </thead>
        <tbody>
          ${pnlRowsHtml}
          <tr class="grand-total-row">
            <td class="pad-l">${e(labels.ordinaryIncomeRowLabel)}</td>
            <td class="mono">${e(labels.ordinaryIncomeRef)}</td>
            <td class="num">${cur(computed.ordinaryBusinessIncome.ytd)}</td>
            <td class="num">${cur(computed.ordinaryBusinessIncome.remaining)}</td>
            <td class="num">${cur(computed.ordinaryBusinessIncome.projected)}</td>
            <td class="num muted">${cur(computed.ordinaryBusinessIncome.filed2025)}</td>
          </tr>
          <tr class="schk-row">
            <td class="pad-l">${e(SCHEDULE_K_LINE_META.label)} (Excl. from ${e(labels.ordinaryIncomeRef)} &middot; Adds to Basis)</td>
            <td class="mono muted">${e(SCHEDULE_K_LINE_META.form1120sRef)}</td>
            <td class="num">${cur(computed.scheduleKInterest.ytd)}</td>
            <td class="num">${cur(computed.scheduleKInterest.remaining)}</td>
            <td class="num strong">${cur(computed.scheduleKInterest.projected)}</td>
            <td class="num muted">${cur(computed.scheduleKInterest.filed2025)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="${setup.has_stock_basis !== false ? 'two-col' : ''}">
      <section>
        <h2>2. Schedule L Balance Sheet Projection</h2>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th class="num">Beg (1/1)</th>
              <th class="num">YTD</th>
              <th class="num">Proj 12/31</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Operating Cash</td>
              <td class="num">${cur(bs.operating_cash_beg)}</td>
              <td class="num">${cur(bs.operating_cash_ytd)}</td>
              <td class="num strong">${cur(computed.projectedCashYe)}</td>
            </tr>
            <tr>
              <td>
                Pension Expense Payable${
                  bs.pension_payable_ye === 0 &&
                  computed.lines.dbp_contribution.projected + computed.lines.employer_401k.projected >
                    0
                    ? '<div class="muted" style="font-size:9px;">IRC &sect;404(a)(6) / cash-basis funding</div>'
                    : ''
                }
              </td>
              <td class="num">${cur(bs.pension_payable_beg)}</td>
              <td class="num">${cur(bs.pension_payable_ytd)}</td>
              <td class="num strong">${cur(bs.pension_payable_ye)}</td>
            </tr>
            <tr>
              <td>Credit Card / Accounts Payable</td>
              <td class="num">${cur(bs.cc_ap_beg)}</td>
              <td class="num">${cur(bs.cc_ap_ytd)}</td>
              <td class="num strong">${cur(bs.cc_ap_ye)}</td>
            </tr>
            <tr class="subtotal-row">
              <td>Net Cash After Short-Term Liab.</td>
              <td class="num">${cur(computed.netCashPositionBeg)}</td>
              <td class="num">${cur(computed.netCashPositionYtd)}</td>
              <td class="num">${cur(computed.netCashPositionYe)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      ${
        setup.has_stock_basis !== false
          ? `<section>
        <h2>3. Form 7203 Shareholder Stock Basis (${e(labels.ownershipLabel)})</h2>
        <table>
          <thead>
            <tr>
              <th>Basis Component</th>
              ${
                isMfj
                  ? `<th class="num">Combined</th>
              <th class="num">${e(primaryName)}</th>
              <th class="num">${e(spouseName)}</th>`
                  : `<th class="num">${e(primaryName)} (100%)</th>`
              }
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Beginning Stock Basis</td>
              <td class="num">${cur(computed.beginningStockBasis)}</td>
              ${isMfj ? `<td class="num">${cur(basisRows.billBeg)}</td><td class="num">${cur(basisRows.debraBeg)}</td>` : ''}
            </tr>
            <tr>
              <td>+ Projected K-1 Ordinary Income</td>
              <td class="num">${cur(basisRows.posInc)}</td>
              ${isMfj ? `<td class="num">${cur(basisRows.billInc)}</td><td class="num">${cur(basisRows.debraInc)}</td>` : ''}
            </tr>
            <tr>
              <td>+ Schedule K Interest Income (Line 4)</td>
              <td class="num">${cur(basisRows.posInt)}</td>
              ${isMfj ? `<td class="num">${cur(basisRows.billInt)}</td><td class="num">${cur(basisRows.debraInt)}</td>` : ''}
            </tr>
            <tr>
              <td>+ Capital Contributions</td>
              <td class="num">${cur(computed.projectedCapitalContributionsTotal)}</td>
              ${isMfj ? `<td class="num">${cur(basisRows.billCap)}</td><td class="num">${cur(basisRows.debraCap)}</td>` : ''}
            </tr>
            <tr>
              <td>&minus; Member Draws / Distributions</td>
              <td class="num">${cur(-computed.projectedDrawsTotal)}</td>
              ${isMfj ? `<td class="num">${cur(-basisRows.billDraws)}</td><td class="num">${cur(-basisRows.debraDraws)}</td>` : ''}
            </tr>
            <tr>
              <td>&minus; Nondeductible (50% Meals)</td>
              <td class="num">${cur(-computed.mealsNondeductible50.projected)}</td>
              ${isMfj ? `<td class="num">${cur(-basisRows.billNonded)}</td><td class="num">${cur(-basisRows.debraNonded)}</td>` : ''}
            </tr>
            ${ordinaryLossRowHtml}
            <tr class="subtotal-row">
              <td>Projected Ending Stock Basis</td>
              <td class="num">${cur(computed.projectedEndingStockBasis)}</td>
              ${isMfj ? `<td class="num">${cur(computed.billProjectedBasisEnding)}</td><td class="num">${cur(computed.debraProjectedBasisEnding)}</td>` : ''}
            </tr>
            ${excessGainRowHtml}
          </tbody>
        </table>
      </section>`
          : ''
      }
    </div>

    ${horizonSectionHtml}

    ${goalsSectionHtml}

    ${
      acknowledgedGuardrails.length > 0
        ? `<section class="goals-section" style="margin-top:16px;">
      <h2>${ackSectionNum}. Acknowledged Guardrail Findings &amp; Explanations (${acknowledgedGuardrails.length})${
            activeGuardrailCount > 0
              ? ` <span class="muted" style="font-weight:400;font-size:10px;">&middot; ${activeGuardrailCount} active ${
                  activeGuardrailCount === 1 ? 'finding' : 'findings'
                } still open</span>`
              : ''
          }</h2>
      <table>
        <thead>
          <tr>
            <th>Guardrail Finding</th>
            <th style="white-space:nowrap;">Status</th>
            <th>Explanation / Rationale</th>
            <th style="white-space:nowrap;">Acknowledged</th>
          </tr>
        </thead>
        <tbody>
          ${acknowledgedGuardrails
            .map((entry) => {
              const badgeClass =
                entry.ack.status === 'intentional_cpa_reviewed'
                  ? 'badge-within'
                  : entry.ack.status === 'mitigation_planned'
                  ? 'badge-watch'
                  : '';
              const badgeStyle =
                entry.ack.status === 'prior_year_historical'
                  ? 'background:#f1f5f9;color:#334155;border-color:#cbd5e1;'
                  : '';
              return `<tr>
                <td style="vertical-align:top;">
                  <strong>${e(entry.title)}</strong>
                  <div class="goal-why" style="margin-top:2px;color:#64748b;">${e(entry.message)}</div>
                </td>
                <td style="vertical-align:top;white-space:nowrap;">
                  <span class="status-badge ${badgeClass}" style="${badgeStyle}">${e(
                    getGuardrailAckStatusLabel(entry.ack.status)
                  )}</span>
                </td>
                <td style="vertical-align:top;">
                  <div class="goal-why">${e(entry.explanationNote)}</div>
                  ${
                    entry.explanationRatioSummary
                      ? `<div class="goal-var">${e(entry.explanationRatioSummary)}</div>`
                      : ''
                  }
                </td>
                <td class="mono muted" style="vertical-align:top;white-space:nowrap;">${e(
                  entry.ack.acknowledged_at
                )}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </section>`
        : ''
    }

    <footer>
      <div class="footer-top">
        <div>
          <span class="brand-strong">${e(meta.preparedBy)}</span>
          ${meta.website ? `<span class="brand-site">(${e(meta.website)})</span>` : ''}
          &nbsp;&middot;&nbsp;
          <span>${e(meta.moduleName)}</span>
        </div>
        <div class="mono">
          As-Of ${e(meta.asOfDateDisplay)} &middot; ${e(meta.remainingDays)} remaining days through ${e(
            meta.yearEndDisplay
          )}
        </div>
      </div>
      <div class="footer-assumptions">
        <strong>Active Forecast Assumptions:</strong> ${e(meta.activeAssumptionsSummary)}
      </div>
      <div class="footer-disclaimer">
        <strong>${e(meta.disclaimerHeadline)}:</strong> ${e(meta.disclaimerBody)}
      </div>
    </footer>
  </main>
</body>
</html>`;
}

interface CpaPrintPackageModalProps {
  setup: SetupConfig;
  pnlState: PnlBalanceSheetState;
  computed: ComputedPnlBalanceSheet;
  computedYears?: ComputedTaxYear[];
  entityName: string;
  entityEin: string;
  reportMeta?: CpaReportMetadata;
  moduleName?: string;
  forecastAssumptions?: string;
  issues?: ValidationIssue[];
  guardrailAcknowledgments?: Record<string, GuardrailAcknowledgment>;
  onDownloadCsv: () => void;
  onExportShadowReturn?: () => void;
  exportingShadowReturn?: boolean;
  onSyncHorizon?: () => void;
  onClose: () => void;
}

export const CpaPrintPackageModal: React.FC<CpaPrintPackageModalProps> = ({
  setup,
  pnlState,
  computed,
  computedYears,
  entityName,
  entityEin,
  reportMeta,
  moduleName,
  forecastAssumptions,
  issues = [],
  guardrailAcknowledgments = {},
  onDownloadCsv,
  onExportShadowReturn,
  exportingShadowReturn,
  onSyncHorizon,
  onClose,
}) => {
  const { primaryName, spouseName } = getPersonNames(setup);
  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const pCode = primaryStateCode || 'State 1';
  const sCode = secondaryStateCode || 'State 2';
  const isMfj = setup.filing_status === 'married_filing_jointly';
  const bs = pnlState.balance_sheet;
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const meta = buildCpaPackageMetadata(setup, pnlState, computed, entityName, entityEin, {
    ...reportMeta,
    moduleName: reportMeta?.moduleName ?? moduleName,
    forecastAssumptions: reportMeta?.forecastAssumptions ?? forecastAssumptions,
  });

  const horizonSummary =
    computedYears && computedYears.length > 0
      ? buildCpaHorizonSummary(setup, computedYears)
      : null;
  const pnlRecon =
    computedYears && computedYears.length > 0
      ? computePnlVsHorizonReconciliation(pnlState, computed, computedYears, setup)
      : null;

  // Resolve acknowledged guardrail findings (matched against live P&L projection or Horizon issues)
  const issueByAckKey = new Map(issues.map((item) => [item.ack_key, item]));
  const livePnlOfficerW2 = Math.max(0, computed.totalCompensation.projected);
  const livePnlObi = Math.max(0, computed.ordinaryBusinessIncome.projected);

  const acknowledgedGuardrails = Object.values(guardrailAcknowledgments)
    .map((ack) => {
      const liveIssue = issueByAckKey.get(ack.key);
      let message = liveIssue?.message ?? ack.finding_message;
      let explanationNote = ack.note;
      let explanationRatioSummary: string | undefined;

      if (ack.rule_id === 'low_reasonable_comp') {
        const useLivePnl = ack.tax_year === pnlState.projection_year;
        const w2Basis = useLivePnl
          ? livePnlOfficerW2
          : liveIssue?.reasonable_comp_meta?.officer_w2;
        const obiBasis = useLivePnl
          ? livePnlObi
          : liveIssue?.reasonable_comp_meta?.ordinary_business_income;

        if (w2Basis !== undefined && obiBasis !== undefined) {
          message = formatReasonableCompFindingMessage(w2Basis, obiBasis);
          explanationNote = syncReasonableCompNoteText(
            ack.note,
            ack.finding_message,
            w2Basis,
            obiBasis
          );
          explanationRatioSummary = formatReasonableCompExplanationSummary(
            w2Basis,
            obiBasis,
            useLivePnl
              ? `${pnlState.projection_year} Projected P&L`
              : ack.tax_year
              ? `${ack.tax_year} Forecast`
              : undefined
          );
        }
      }

      return {
        ack,
        title: liveIssue?.title ?? ack.finding_title,
        message,
        explanationNote,
        explanationRatioSummary,
        severity: liveIssue?.severity ?? ack.finding_severity,
      };
    })
    .sort((a, b) => (a.ack.tax_year ?? 9999) - (b.ack.tax_year ?? 9999));
  const activeGuardrailCount = issues.filter(
    (item) => !guardrailAcknowledgments[item.ack_key]
  ).length;
  let nextSecNum = setup.has_stock_basis !== false ? 4 : 3;
  const horizonSectionNum = horizonSummary ? nextSecNum++ : 0;
  const goalsSectionNum = meta.activeGoals.length > 0 ? nextSecNum++ : 0;
  const ackSectionNum = acknowledgedGuardrails.length > 0 ? nextSecNum++ : 0;

  const [printStatus, setPrintStatus] = useState<{
    type: 'opened' | 'downloaded';
    message: string;
  } | null>(null);
  const labels = getCpaEntityLabels(setup, primaryName, spouseName, computed);

  const billPct = computed.billSharePct / 100;
  const billBeg = round2(computed.beginningStockBasis * billPct);
  const debraBeg = round2(computed.beginningStockBasis - billBeg);
  const posInc = Math.max(0, computed.ordinaryBusinessIncome.projected);
  const billInc = round2(posInc * billPct);
  const debraInc = round2(posInc - billInc);
  const ordLoss =
    computed.ordinaryBusinessIncome.projected < 0
      ? Math.abs(computed.ordinaryBusinessIncome.projected)
      : 0;
  const billLoss = round2(ordLoss * billPct);
  const debraLoss = round2(ordLoss - billLoss);
  const posInt = Math.max(0, computed.scheduleKInterest.projected);
  const billInt = round2(posInt * billPct);
  const debraInt = round2(posInt - billInt);
  const billCap = round2(computed.projectedCapitalContributionsTotal * billPct);
  const debraCap = round2(computed.projectedCapitalContributionsTotal - billCap);
  const billDraws = round2(computed.projectedDrawsTotal * billPct);
  const debraDraws = round2(computed.projectedDrawsTotal - billDraws);
  const billNonded = round2(computed.mealsNondeductible50.projected * billPct);
  const debraNonded = round2(computed.mealsNondeductible50.projected - billNonded);

  const handlePrintOrSavePdf = () => {
    const html = buildStandalonePrintHtml({
      setup,
      pnlState,
      computed,
      computedYears,
      entityName,
      entityEin,
      primaryName,
      spouseName,
      generatedOn,
      meta,
      horizonSummary,
      pnlRecon,
      acknowledgedGuardrails,
      activeGuardrailCount,
      basisRows: {
        billBeg,
        debraBeg,
        posInc,
        billInc,
        debraInc,
        ordLoss,
        billLoss,
        debraLoss,
        posInt,
        billInt,
        debraInt,
        billCap,
        debraCap,
        billDraws,
        debraDraws,
        billNonded,
        debraNonded,
      },
    });

    let openedAndPrinted = false;
    try {
      const printWin = window.open('', '_blank');
      if (printWin && !printWin.closed && printWin.document) {
        printWin.document.open();
        printWin.document.write(html);
        printWin.document.close();
        openedAndPrinted = true;
        window.setTimeout(() => {
          try {
            printWin.focus();
            printWin.print();
          } catch {
            // User can still use the built-in Print / Save as PDF button in the opened tab
          }
        }, 180);
      }
    } catch {
      openedAndPrinted = false;
    }

    if (openedAndPrinted) {
      setPrintStatus({
        type: 'opened',
        message: 'Opened standalone print report in a new browser tab. Choose Print → Save as PDF if the dialog does not appear automatically.',
      });
      return;
    }

    const safeEntity = entityName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'CPA_Report';
    const fileName = `${safeEntity}_${pnlState.projection_year}_CPA_Projection_Package.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setPrintStatus({
      type: 'downloaded',
      message: `Downloaded standalone printable report (${fileName}) because popup printing is restricted in this preview frame. Open it in your browser and choose Print → Save as PDF.`,
    });
  };

  return (
    <div
      className="print-only-container fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="CPA Year-End Projection Package"
    >
      <div className="print-only-container bg-white border border-slate-200 rounded-lg max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Non-print Action Bar */}
        <div className="no-print px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              CPA Year-End Projection Package — Print &amp; Export View
            </h2>
            <p className="text-xs text-slate-500">
              Preliminary tax-planning schedule formatted for review with your CPA ({labels.entityFormLabel} P&amp;L, Schedule M-1 Meals Split, Schedule L{setup.has_stock_basis !== false ? ', and Form 7203 Basis' : ''}).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onExportShadowReturn && (
              <button
                type="button"
                onClick={onExportShadowReturn}
                disabled={Boolean(exportingShadowReturn)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-md hover:bg-emerald-100 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                {exportingShadowReturn
                  ? 'Generating…'
                  : 'Export Shadow Tax Return (.xlsx)'}
              </button>
            )}
            <button
              type="button"
              onClick={onDownloadCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={handlePrintOrSavePdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close print preview"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {printStatus && (
          <div
            className={`no-print px-6 py-2 text-xs border-b shrink-0 flex items-center justify-between gap-3 ${
              printStatus.type === 'downloaded'
                ? 'bg-teal-50 border-teal-200 text-teal-900'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <span>{printStatus.message}</span>
            <button
              type="button"
              onClick={() => setPrintStatus(null)}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-800 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {(setup.workspace_profile_kind === 'test_persona' ||
          setup.workspace_profile_kind === 'blank') && (
          <div
            role="alert"
            className="no-print bg-amber-50 border-b border-amber-300 px-6 py-2.5 flex items-center gap-2 text-xs text-amber-950 shrink-0"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong className="font-semibold">Testing Mode Active</strong> — This preview uses{' '}
              {setup.workspace_profile_kind === 'test_persona'
                ? `synthetic Test Persona data (${primaryName}${
                    setup.filing_status === 'married_filing_jointly' && spouseName
                      ? ` & ${spouseName}`
                      : ''
                  })`
                : 'the Blank User sandbox'}{' '}
              and is not your saved profile. Switch back to <strong>My Profile</strong> before exporting a final CPA report.
            </span>
          </div>
        )}

        {/* Printable Document Body */}
        <div className="print-only-container flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-white text-slate-900">
          {/* Formal Statement Header & Branding */}
          <header className="space-y-3 border-b-2 border-slate-900 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-900">{meta.preparedBy}</span>
                {meta.website && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-teal-800">{meta.website}</span>
                  </>
                )}
              </div>
              <div className="font-medium text-slate-700">Module: {meta.moduleName}</div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {labels.packageEyebrow}
                </p>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-0.5">
                  {entityName}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-1">
                  {entityEin.trim() && (
                    <>
                      <span className="font-mono">EIN {entityEin.trim()}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>Tax Year {pnlState.projection_year}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Filing: {labels.filingStatusLabel}
                    {labels.activeStatesLabel ? ` · ${labels.activeStatesLabel}` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Ownership: {labels.ownershipLabel}</span>
                </div>
              </div>
              <div className="text-right text-xs text-slate-600 space-y-0.5">
                <div>
                  As-Of Date:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {meta.asOfDateDisplay}
                  </span>{' '}
                  <span className="font-mono text-[11px] text-slate-400">({meta.asOfDate})</span>
                </div>
                <div>
                  Remaining Through {meta.yearEndDisplay}:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {meta.remainingDays} days
                  </span>{' '}
                  <span className="font-mono text-[11px] text-slate-500">
                    ({meta.elapsedDays}/{meta.totalYearDays} YTD)
                  </span>
                </div>
                {setup.multi_state_active && (
                  <div>
                    Apportionment (Projected):{' '}
                    <span className="font-mono font-medium text-slate-900">
                      {pCode} {computed.caPct.projected}% / {sCode} {computed.azPct.projected}%
                    </span>
                  </div>
                )}
                <div className="text-[11px] text-slate-400">Generated {generatedOn}</div>
              </div>
            </div>
          </header>

          {/* Prominent CPA Review Disclaimer */}
          <div
            role="note"
            className="bg-amber-50/80 border border-amber-300 border-l-4 border-l-amber-600 rounded px-4 py-3 text-xs text-amber-950"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold tracking-wide text-[11px] text-amber-900">
                  {meta.disclaimerHeadline}
                </div>
                <p className="text-[11px] leading-relaxed text-amber-950/90">
                  {meta.disclaimerBody}
                </p>
              </div>
            </div>
          </div>

          {/* Active Forecast Assumptions Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded px-4 py-3">
            <div className="text-[11px] font-bold tracking-wide text-slate-800 uppercase mb-1.5">
              Active Forecast Assumptions
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {meta.activeAssumptions.map((item) => (
                <div key={item.label} className="leading-snug">
                  <dt className="inline font-semibold text-slate-700">{item.label}: </dt>
                  <dd className="inline text-slate-600">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Executive Summary Row */}
          <div
            className={`grid grid-cols-2 ${
              setup.has_stock_basis !== false ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
            } gap-4 pb-2`}
          >
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected Gross Receipts</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.totalRevenue.projected)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                {setup.multi_state_active
                  ? `${pCode} ${computed.caPct.projected}% · ${sCode} ${computed.azPct.projected}%`
                  : `YTD ${formatCurrencyExact(computed.totalRevenue.ytd)}`}
              </div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">{labels.ordinaryIncomeCardLabel}</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                {pnlState.projection_year - 1} Filed:{' '}
                {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
              </div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-[11px] text-slate-500">Projected Member Draws</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyExact(computed.projectedDrawsTotal)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Cap Contrib: {formatCurrencyExact(computed.projectedCapitalContributionsTotal)}
              </div>
            </div>
            {setup.has_stock_basis !== false && (
              <div className="border border-slate-200 rounded p-3">
                <div className="text-[11px] text-slate-500">Projected Ending Basis</div>
                <div
                  className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                    computed.drawsExceedBasis ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {formatCurrencyExact(computed.projectedEndingStockBasis)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                  {computed.drawsExceedBasis
                    ? `Excess Gain: ${formatCurrencyExact(computed.projectedExcessDistributionGain)}`
                    : 'No excess dist gain'}
                </div>
              </div>
            )}
          </div>

          {/* 2026 Working P&L <-> Horizon Reconciliation Banner */}
          {pnlRecon && setup.has_scorp && (
            <div
              className={`rounded border px-3.5 py-2 text-[11px] leading-snug flex items-start gap-2 ${
                pnlRecon.isReconciled
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50/80 border-amber-200 text-amber-950'
              }`}
            >
              {pnlRecon.isReconciled ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div>
                {pnlRecon.isReconciled ? (
                  <>
                    <strong className="font-semibold">
                      {pnlRecon.projectionYear} Working P&amp;L ↔ {pnlRecon.projectionYear} Horizon
                      Reconciled ($0 Operating Variance):
                    </strong>{' '}
                    Gross Receipts, OpEx, Officer W-2, SEHI, Payroll Taxes, DBP, 401(k), Capital
                    Contributions &amp; Draws tie identically
                    {pnlRecon.pteEntityTaxDeduction > 0
                      ? ` · Pre-PTE Working P&L OBI ${formatCurrency(
                          pnlRecon.pnlObi
                        )} − Entity PTE Deduction ${formatCurrency(
                          pnlRecon.pteEntityTaxDeduction
                        )} = ${formatCurrency(pnlRecon.horizonObi)} Form 1120-S K-1 OBI`
                      : ' · K-1 OBI & Ending Stock Basis tie to $0'}{' '}
                    · Reasonable Comp {pnlRecon.rcHorizonPct.toFixed(1)}%.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold">
                      {pnlRecon.projectionYear} Working P&amp;L vs. {pnlRecon.projectionYear}{' '}
                      Horizon Variance Notice:
                    </strong>{' '}
                    Working P&amp;L reflects live bookkeeping/cadence projections not yet pushed to
                    the {pnlRecon.projectionYear} Horizon schedule (
                    {pnlRecon.pteEntityTaxDeduction > 0
                      ? `Pre-PTE OBI ${formatCurrency(
                          pnlRecon.pnlObi
                        )} − Entity PTE ${formatCurrency(
                          pnlRecon.pteEntityTaxDeduction
                        )} vs. Horizon K-1 ${formatCurrency(pnlRecon.horizonObi)}, net delta ${
                          pnlRecon.obiAfterPteVariance >= 0 ? '+' : ''
                        }${formatCurrency(pnlRecon.obiAfterPteVariance)}`
                      : `K-1 OBI delta ${pnlRecon.obiVariance >= 0 ? '+' : ''}${formatCurrency(
                          pnlRecon.obiVariance
                        )}`}
                    , Basis delta {pnlRecon.basisVariance >= 0 ? '+' : ''}
                    {formatCurrency(pnlRecon.basisVariance)}, RC {pnlRecon.rcPnlPct.toFixed(1)}% vs.{' '}
                    {pnlRecon.rcHorizonPct.toFixed(1)}%). Section {horizonSectionNum} below shows
                    the authoritative {horizonSummary?.years[0] ?? 2025}–
                    {horizonSummary?.years[horizonSummary.years.length - 1] ?? 2030} Horizon Tax
                    Plan.
                    {onSyncHorizon && (
                      <button
                        type="button"
                        onClick={onSyncHorizon}
                        className="no-print ml-2 inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold text-white bg-teal-800 rounded hover:bg-teal-900 transition-colors"
                      >
                        Push &amp; Sync {pnlRecon.projectionYear} Horizon
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 1. Profit & Loss Statement */}
          <section>
            <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
              1. Profit &amp; Loss Projection ({labels.entityFormLabel} Structure)
            </h2>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-300 text-[11px] font-semibold text-slate-600">
                  <th className="py-1.5 pr-3">Line Item</th>
                  <th className="py-1.5 px-2">Ref</th>
                  <th className="py-1.5 px-2 text-right">YTD Actuals</th>
                  <th className="py-1.5 px-2 text-right">Remaining</th>
                  <th className="py-1.5 px-2 text-right">Projected {pnlState.projection_year}</th>
                  <th className="py-1.5 pl-2 text-right">{pnlState.projection_year - 1} Filed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {PNL_SECTIONS.map((sec) => {
                  const items = PNL_OPERATING_ITEMS.filter((i) => i.section === sec.id);
                  return (
                    <React.Fragment key={sec.id}>
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="py-1.5 px-2 font-semibold text-slate-800">
                          {sec.title}
                        </td>
                      </tr>
                      {items.map((item) => {
                        const vals = computed.lines[item.id];
                        return (
                          <React.Fragment key={item.id}>
                            <tr>
                              <td className="py-1 pr-3 pl-2 text-slate-800">
                                {getPnlLineLabel(item, setup)}
                              </td>
                              <td className="py-1 px-2 text-[10px] font-mono text-slate-500">
                                {item.form1120sRef}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums">
                                {formatCurrencyExact(vals.ytd)}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums">
                                {formatCurrencyExact(vals.remaining)}
                              </td>
                              <td className="py-1 px-2 text-right font-mono tabular-nums font-medium">
                                {formatCurrencyExact(vals.projected)}
                              </td>
                              <td className="py-1 pl-2 text-right font-mono tabular-nums text-slate-500">
                                {formatCurrencyExact(vals.filed2025)}
                              </td>
                            </tr>
                            {item.id === 'meals_gross' && (
                              <>
                                <tr className="text-[11px] text-slate-600 bg-slate-50/40">
                                  <td className="py-1 pr-3 pl-6">
                                    ↳ 50% Deductible Meals (Included in {labels.entityFormLabel})
                                  </td>
                                  <td className="py-1 px-2 text-[10px] font-mono text-slate-400">
                                    Line 19
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.ytd)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.remaining)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsDeductible50.projected)}
                                  </td>
                                  <td className="py-1 pl-2 text-right font-mono tabular-nums text-slate-500">
                                    {formatCurrencyExact(computed.mealsDeductible50.filed2025)}
                                  </td>
                                </tr>
                                <tr className="text-[11px] text-amber-800 bg-amber-50/30">
                                  <td className="py-1 pr-3 pl-6">
                                    ↳ 50% Nondeductible Meals (Sch M-1 / Basis)
                                  </td>
                                  <td className="py-1 px-2 text-[10px] font-mono text-amber-700">
                                    Sch M-1
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.ytd)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.remaining)}
                                  </td>
                                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.projected)}
                                  </td>
                                  <td className="py-1 pl-2 text-right font-mono tabular-nums">
                                    {formatCurrencyExact(computed.mealsNondeductible50.filed2025)}
                                  </td>
                                </tr>
                              </>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {sec.id === 'revenue' && (
                        <tr className="font-semibold border-t border-slate-200 bg-slate-50/60">
                          <td className="py-1.5 pr-3 pl-2">Total Gross Receipts</td>
                          <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">Line 1a</td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.ytd)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.remaining)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalRevenue.projected)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalRevenue.filed2025)}
                          </td>
                        </tr>
                      )}
                      {sec.id === 'operating_expenses' && (
                        <tr className="font-semibold border-t border-slate-200 bg-slate-50/60">
                          <td className="py-1.5 pr-3 pl-2">
                            <div>Total Operating Expenses (Excl. W-2 &amp; Retirement · Tax Deductible)</div>
                            <div className="text-[10px] font-normal text-slate-500">
                              Excl. Payroll Taxes ({labels.entityFormLabel} / Horizon OpEx):{' '}
                              <span className="font-mono tabular-nums">
                                {formatCurrencyExact(computed.totalOperatingExpensesExclPayroll.projected)}
                              </span>
                            </div>
                          </td>
                          <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">
                            Lines 11–19
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.ytd)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.remaining)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.projected)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-600">
                            {formatCurrencyExact(computed.totalOperatingExpensesDeductible.filed2025)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                <tr className="border-t-2 border-slate-900 font-bold bg-slate-100/70">
                  <td className="py-2 pr-3 pl-2">
                    {labels.ordinaryIncomeRowLabel}
                  </td>
                  <td className="py-2 px-2 text-[10px] font-mono text-slate-600">
                    {labels.ordinaryIncomeRef}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.ytd)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.remaining)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.projected)}
                  </td>
                  <td className="py-2 pl-2 text-right font-mono tabular-nums text-slate-600">
                    {formatCurrencyExact(computed.ordinaryBusinessIncome.filed2025)}
                  </td>
                </tr>
                <tr className="bg-slate-50/70 text-slate-800">
                  <td className="py-1.5 pr-3 pl-2 font-medium">
                    {SCHEDULE_K_LINE_META.label} (Excl. from {labels.ordinaryIncomeRef} · Adds to Basis)
                  </td>
                  <td className="py-1.5 px-2 text-[10px] font-mono text-slate-500">
                    {SCHEDULE_K_LINE_META.form1120sRef}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.scheduleKInterest.ytd)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(computed.scheduleKInterest.remaining)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">
                    {formatCurrencyExact(computed.scheduleKInterest.projected)}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-500">
                    {formatCurrencyExact(computed.scheduleKInterest.filed2025)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 2. Schedule L Balance Sheet & 3. Form 7203 Basis Side-by-Side */}
          <div
            className={`grid grid-cols-1 ${
              setup.has_stock_basis !== false ? 'md:grid-cols-2' : ''
            } gap-6`}
          >
            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                2. Schedule L Balance Sheet Projection
              </h2>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-2">Account</th>
                    <th className="py-1.5 px-2 text-right">Beg (1/1)</th>
                    <th className="py-1.5 px-2 text-right">YTD</th>
                    <th className="py-1.5 pl-2 text-right">Proj 12/31</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1.5 pr-2">Operating Cash</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.operating_cash_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.operating_cash_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(computed.projectedCashYe)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">
                      <div>Pension Expense Payable</div>
                      {bs.pension_payable_ye === 0 &&
                        computed.lines.dbp_contribution.projected +
                          computed.lines.employer_401k.projected >
                          0 && (
                          <div className="text-[10px] text-slate-400">
                            IRC §404(a)(6) / cash-basis funding
                          </div>
                        )}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.pension_payable_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.pension_payable_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(bs.pension_payable_ye)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">Credit Card / Accounts Payable</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.cc_ap_beg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(bs.cc_ap_ytd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-medium">
                      {formatCurrencyExact(bs.cc_ap_ye)}
                    </td>
                  </tr>
                  <tr className="font-semibold bg-slate-50 border-t border-slate-200">
                    <td className="py-1.5 pr-2">Net Cash After Short-Term Liab.</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionBeg)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionYtd)}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.netCashPositionYe)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            {setup.has_stock_basis !== false && (
            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                3. Form 7203 Shareholder Stock Basis ({labels.ownershipLabel})
              </h2>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-2">Basis Component</th>
                    {isMfj ? (
                      <>
                        <th className="py-1.5 px-2 text-right">Combined</th>
                        <th className="py-1.5 px-2 text-right">{primaryName}</th>
                        <th className="py-1.5 pl-2 text-right">{spouseName}</th>
                      </>
                    ) : (
                      <th className="py-1.5 pl-2 text-right">{primaryName} (100%)</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1.5 pr-2">Beginning Stock Basis</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.beginningStockBasis)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(billBeg)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(debraBeg)}
                        </td>
                      </>
                    )}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Projected K-1 Ordinary Income</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(posInc)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(billInc)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(debraInc)}
                        </td>
                      </>
                    )}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Schedule K Interest Income (Line 4)</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(posInt)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(billInt)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(debraInt)}
                        </td>
                      </>
                    )}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">+ Capital Contributions</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.projectedCapitalContributionsTotal)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(billCap)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(debraCap)}
                        </td>
                      </>
                    )}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">− Member Draws / Distributions</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-computed.projectedDrawsTotal)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(-billDraws)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(-debraDraws)}
                        </td>
                      </>
                    )}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2">− Nondeductible (50% Meals)</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(-computed.mealsNondeductible50.projected)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(-billNonded)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(-debraNonded)}
                        </td>
                      </>
                    )}
                  </tr>
                  {ordLoss > 0 && (
                    <tr>
                      <td className="py-1.5 pr-2">− Projected Ordinary Loss</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrencyExact(-ordLoss)}
                      </td>
                      {isMfj && (
                        <>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(-billLoss)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(-debraLoss)}
                          </td>
                        </>
                      )}
                    </tr>
                  )}
                  <tr className="font-semibold bg-slate-50 border-t border-slate-200">
                    <td className="py-1.5 pr-2">Projected Ending Stock Basis</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCurrencyExact(computed.projectedEndingStockBasis)}
                    </td>
                    {isMfj && (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.billProjectedBasisEnding)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatCurrencyExact(computed.debraProjectedBasisEnding)}
                        </td>
                      </>
                    )}
                  </tr>
                  {computed.drawsExceedBasis && (
                    <tr className="font-semibold text-red-700 bg-red-50/60">
                      <td className="py-1.5 pr-2">Form 8949 Excess Dist. Gain</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrencyExact(computed.projectedExcessDistributionGain)}
                      </td>
                      {isMfj && (
                        <>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.billExcessGain)}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(computed.debraExcessGain)}
                          </td>
                        </>
                      )}
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
            )}
          </div>

          {/* Multi-Year Tax & Cash-Flow Horizon Summary (2025-2030) */}
          {horizonSummary && (
            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                {horizonSectionNum}. Multi-Year Tax &amp; Cash-Flow Horizon Summary (
                {horizonSummary.years[0]}–{horizonSummary.years[horizonSummary.years.length - 1]})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px] min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-300 text-[10px] font-semibold text-slate-600">
                      <th className="py-1.5 pr-2 w-[28%]">Horizon Metric</th>
                      {horizonSummary.years.map((y) => (
                        <th key={y} className="py-1.5 px-1.5 text-right whitespace-nowrap">
                          <div>{y}</div>
                          {y === setup.anchor_actuals_year && (
                            <div className="text-[9px] font-normal text-slate-400">Actuals</div>
                          )}
                        </th>
                      ))}
                      <th className="py-1.5 pl-2 text-right whitespace-nowrap">
                        {horizonSummary.years.length}-Yr Total / End
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {horizonSummary.rows.map((row, idx) => {
                      const prevSec = idx > 0 ? horizonSummary.rows[idx - 1].section : '';
                      const secHeaders: Record<string, string> = {
                        entity: `${labels.entityFormLabel} Entity Operations & Retirement`,
                        personal: 'Form 1040 Taxable Income, Federal/State Taxes & IRMAA',
                        basis: 'Shareholder Capital Contributions, Draws & Stock Basis',
                      };
                      const rowCls =
                        row.highlight === 'primary'
                          ? 'border-t-2 border-slate-900 font-bold bg-slate-100/70'
                          : row.highlight === 'secondary'
                          ? 'font-semibold bg-slate-50 border-t border-slate-200'
                          : '';
                      return (
                        <React.Fragment key={row.id}>
                          {row.section !== prevSec && (
                            <tr className="bg-slate-50">
                              <td
                                colSpan={horizonSummary.years.length + 2}
                                className="py-1 px-2 text-[10px] font-bold text-slate-700"
                              >
                                {secHeaders[row.section] || row.section}
                              </td>
                            </tr>
                          )}
                          <tr className={rowCls}>
                            <td className="py-1 pr-2 pl-2 text-slate-800">
                              <span className={row.bold ? 'font-semibold text-slate-900' : ''}>
                                {row.label}
                              </span>{' '}
                              <span className="text-[9px] font-mono text-slate-400">
                                {row.shortRef}
                              </span>
                            </td>
                            {row.cells.map((cell) => {
                              const badgeCls =
                                cell.tone === 'danger'
                                  ? 'bg-red-50 text-red-800 border-red-200'
                                  : cell.tone === 'warning'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : cell.tone === 'positive'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200';
                              return (
                                <td
                                  key={cell.taxYear}
                                  className="py-1 px-1.5 text-right font-mono tabular-nums align-top whitespace-nowrap"
                                >
                                  {cell.badgeText ? (
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold border ${badgeCls}`}
                                    >
                                      {cell.badgeText}
                                    </span>
                                  ) : (
                                    <span className={row.bold ? 'font-semibold text-slate-900' : ''}>
                                      {cell.display}
                                    </span>
                                  )}
                                  {cell.subLabel && (
                                    <div className="text-[9px] font-sans text-slate-400 leading-tight mt-0.5">
                                      {cell.subLabel}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-1 pl-2 text-right font-mono tabular-nums font-semibold text-slate-900 align-top whitespace-nowrap">
                              <div>{row.totalDisplay}</div>
                              {row.totalSubLabel && (
                                <div className="text-[9px] font-sans font-normal text-slate-500 leading-tight mt-0.5">
                                  {row.totalSubLabel}
                                </div>
                              )}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                All {horizonSummary.years[0]}–{horizonSummary.years[horizonSummary.years.length - 1]}{' '}
                figures tie directly to the 6-Year Horizon Tax Engine ($0 variance). Medicare IRMAA
                follows the statutory 2-year lookback (e.g., 2026 MAGI sets 2028 Medicare premiums).
              </p>
            </section>
          )}

          {/* Planning Goals & Guardrails for CPA Review */}
          {meta.activeGoals.length > 0 && (
            <section>
              <h2 className="text-xs font-bold tracking-wide text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
                {goalsSectionNum}. Planning Goals &amp; Guardrails for CPA Review ({meta.activeGoals.length} Active)
              </h2>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-3">Goal / Guardrail</th>
                    <th className="py-1.5 px-2 text-right whitespace-nowrap">Target</th>
                    <th className="py-1.5 px-2 text-right whitespace-nowrap">Projected</th>
                    <th className="py-1.5 px-2 whitespace-nowrap">Status</th>
                    <th className="py-1.5 pl-2">Why This Matters &amp; Variance Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {meta.activeGoals.map((item) => {
                    const badgeCls =
                      item.status === 'over'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : item.status === 'watch'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200';
                    return (
                      <tr key={item.goal.id}>
                        <td className="py-2 pr-3 align-top font-semibold text-slate-900">
                          {item.goal.title}
                        </td>
                        <td className="py-2 px-2 align-top text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          <div>{item.targetDisplay}</div>
                          {item.goal.kind === 'income_ceiling' && item.linkedIrmaa && (
                            <div className="text-[10px] font-sans text-slate-400 mt-0.5 whitespace-normal">
                              {item.linkedIrmaa.isGoalTargetOverridden
                                ? `Custom · ${item.linkedIrmaa.coverageYear} IRMAA (${item.linkedIrmaa.filingStatusShort}) ${formatCurrencyExact(
                                    item.linkedIrmaa.threshold
                                  )}`
                                : `${item.linkedIrmaa.coverageYear} IRMAA Tier 1 (${item.linkedIrmaa.filingStatusShort} · 2-yr lookback)`}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 align-top text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {item.currentDisplay}
                        </td>
                        <td className="py-2 px-2 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeCls}`}
                          >
                            {item.statusLabel}
                          </span>
                        </td>
                        <td className="py-2 pl-2 align-top">
                          <div className="text-[11px] text-slate-700 leading-snug">
                            {item.goal.why_it_matters}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {item.varianceSummary}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Acknowledged Guardrail Findings & Explanations for CPA Review */}
          {acknowledgedGuardrails.length > 0 && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-300 pb-1.5 mb-2">
                <h2 className="text-xs font-bold tracking-wide text-slate-900">
                  {ackSectionNum}. Acknowledged Guardrail Findings &amp; Explanations (
                  {acknowledgedGuardrails.length})
                </h2>
                {activeGuardrailCount > 0 && (
                  <span className="text-[11px] text-amber-800 font-medium">
                    {activeGuardrailCount} active {activeGuardrailCount === 1 ? 'finding' : 'findings'} still open
                  </span>
                )}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px] font-semibold text-slate-600">
                    <th className="py-1.5 pr-3">Guardrail Finding</th>
                    <th className="py-1.5 px-2 whitespace-nowrap">Status</th>
                    <th className="py-1.5 px-2">Explanation / Rationale</th>
                    <th className="py-1.5 pl-2 whitespace-nowrap text-right">Acknowledged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {acknowledgedGuardrails.map((entry) => {
                    const statusCls =
                      entry.ack.status === 'intentional_cpa_reviewed'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : entry.ack.status === 'mitigation_planned'
                        ? 'bg-teal-50 text-teal-800 border-teal-200'
                        : 'bg-slate-100 text-slate-700 border-slate-300';
                    return (
                      <tr key={entry.ack.key}>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-900">{entry.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            {entry.message}
                          </div>
                        </td>
                        <td className="py-2 px-2 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${statusCls}`}
                          >
                            {getGuardrailAckStatusLabel(entry.ack.status)}
                          </span>
                        </td>
                        <td className="py-2 px-2 align-top text-[11px] text-slate-800 leading-snug">
                          <div>{entry.explanationNote}</div>
                          {entry.explanationRatioSummary && (
                            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                              {entry.explanationRatioSummary}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pl-2 align-top text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {entry.ack.acknowledged_at}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Formal Branding, Assumptions & CPA Disclaimer Footer */}
          <footer className="border-t-2 border-slate-300 pt-3.5 mt-4 text-[11px] leading-relaxed text-slate-600 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-800">
              <div>
                <span className="font-semibold">{meta.preparedBy}</span>
                {meta.website && (
                  <>
                    {' '}
                    <span className="font-mono text-teal-800">({meta.website})</span>
                  </>
                )}
                <span className="mx-1.5 text-slate-400">·</span>
                <span className="text-slate-700">{meta.moduleName}</span>
              </div>
              <div className="font-mono text-slate-700">
                As-Of {meta.asOfDateDisplay} · {meta.remainingDays} remaining days through{' '}
                {meta.yearEndDisplay}
              </div>
            </div>
            <div>
              <span className="font-semibold text-slate-800">Active Forecast Assumptions:</span>{' '}
              {meta.activeAssumptionsSummary}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-700">
              <span className="font-semibold text-slate-900">{meta.disclaimerHeadline}:</span>{' '}
              {meta.disclaimerBody}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
