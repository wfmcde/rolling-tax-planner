import type { ComputedTaxYear, SetupConfig, TaxYearRecord } from '../types/tax';
import { formatCurrency } from './format';
import { getSetupStates } from './setupHelpers';

export interface TaxPaymentSummary {
  federalWithholding: number;
  federalEstimates: number;
  federalTotal: number;
  statePaymentsByCode: Record<string, number>;
  primaryStateCode: string;
  primaryStatePaid: number;
  secondaryStateCode: string;
  secondaryStatePaid: number;
  unallocatedStatePaid: number;
  stateTotal: number;
  combinedTotal: number;
}

export interface TaxBalanceSummary {
  federalTax: number;
  federalPaid: number;
  federalNetDue: number;
  stateTax: number;
  statePaid: number;
  stateNetDue: number;
  combinedTax: number;
  combinedPaid: number;
  combinedNetDue: number;
}

/**
 * Modular import payload contract for future Quicken / CSV tax-payment importers.
 * Applying this payload updates the exact same single-source-of-truth fields used by
 * Six-Year Horizon, Form 1040, Multi-State & PTE, and Shadow Tax Return export.
 */
export interface ImportedTaxPaymentsPayload {
  federal_tax_withholding?: number;
  federal_estimated_tax_payments?: number;
  federal_total_paid?: number;
  state_payments_by_code?: Record<string, number>;
  state_total_paid?: number;
}

function sanitizeAmount(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * Formats a Net Tax Due / (Refund) dollar amount using standard accounting parentheses
 * for refunds (negative balance due) and plain currency for amounts due or $0.
 */
export function formatTaxBalanceDue(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded < 0) {
    return `(${formatCurrency(Math.abs(rounded))})`;
  }
  return formatCurrency(rounded);
}

/**
 * Resolves the primary state filing index for a year record based on Setup's primary state,
 * falling back to the resident filing or the first available filing.
 */
function resolvePrimaryStateFilingIndex(
  stateFilings: TaxYearRecord['state_filings'],
  setup: SetupConfig
): number {
  if (stateFilings.length === 0) return -1;
  const { primaryStateCode } = getSetupStates(setup);
  if (primaryStateCode) {
    const exactIdx = stateFilings.findIndex((sf) => sf.state_code === primaryStateCode);
    if (exactIdx >= 0) return exactIdx;
  }
  const residentIdx = stateFilings.findIndex((sf) => sf.residency_status === 'resident');
  return residentIdx >= 0 ? residentIdx : 0;
}

/**
 * Reads all Federal and State taxes paid (withholding & estimated payments) for a computed year
 * from the single source of truth on Form 1040 inputs and State Filing records.
 */
export function getYearTaxPayments(
  c: ComputedTaxYear,
  setup: SetupConfig
): TaxPaymentSummary {
  const federalWithholding = sanitizeAmount(c.form_1040_in.federal_tax_withholding);
  const federalEstimates = sanitizeAmount(c.form_1040_in.federal_estimated_tax_payments);
  const federalTotal = federalWithholding + federalEstimates;

  const { primaryStateCode, secondaryStateCode } = getSetupStates(setup);
  const statePaymentsByCode: Record<string, number> = {};
  let filingsTotal = 0;

  for (const sf of c.state_filings_out) {
    const amt = sanitizeAmount(sf.state_tax_withholding_and_estimates);
    statePaymentsByCode[sf.state_code] = (statePaymentsByCode[sf.state_code] ?? 0) + amt;
    filingsTotal += amt;
  }

  const unallocatedStatePaid =
    c.state_filings_out.length === 0
      ? sanitizeAmount(c.form_1040_in.unallocated_state_tax_payments)
      : 0;

  const resolvedPrimaryCode = primaryStateCode || c.state_filings_out[0]?.state_code || '';
  const resolvedSecondaryCode =
    secondaryStateCode ||
    c.state_filings_out.find((sf) => sf.state_code !== resolvedPrimaryCode)?.state_code ||
    '';

  const primaryStatePaid = resolvedPrimaryCode
    ? statePaymentsByCode[resolvedPrimaryCode] ?? 0
    : unallocatedStatePaid;
  const secondaryStatePaid = resolvedSecondaryCode
    ? statePaymentsByCode[resolvedSecondaryCode] ?? 0
    : 0;

  const stateTotal = c.state_filings_out.length > 0 ? filingsTotal : unallocatedStatePaid;
  const combinedTotal = federalTotal + stateTotal;

  return {
    federalWithholding,
    federalEstimates,
    federalTotal,
    statePaymentsByCode,
    primaryStateCode: resolvedPrimaryCode,
    primaryStatePaid,
    secondaryStateCode: resolvedSecondaryCode,
    secondaryStatePaid,
    unallocatedStatePaid,
    stateTotal,
    combinedTotal,
  };
}

/**
 * Computes projected tax liability, taxes paid, and Net Tax Due / (Refund) for Federal,
 * State, and Combined totals.
 */
export function getYearTaxBalances(
  c: ComputedTaxYear,
  setup: SetupConfig
): TaxBalanceSummary {
  const payments = getYearTaxPayments(c, setup);
  const federalTax = Math.round(c.form_1040_out.federal_income_tax);
  const stateTax = Math.round(c.total_state_tax);
  const combinedTax = federalTax + stateTax;

  return {
    federalTax,
    federalPaid: payments.federalTotal,
    federalNetDue: federalTax - payments.federalTotal,
    stateTax,
    statePaid: payments.stateTotal,
    stateNetDue: stateTax - payments.stateTotal,
    combinedTax,
    combinedPaid: payments.combinedTotal,
    combinedNetDue: combinedTax - payments.combinedTotal,
  };
}

/**
 * Updates combined Federal Taxes Paid while preserving existing W-2/1099 withholding
 * when possible and placing the remainder in 1040-ES estimated payments.
 */
export function applyFederalTaxesPaidTotal(
  yr: TaxYearRecord,
  nextTotal: number
): TaxYearRecord {
  const clamped = sanitizeAmount(nextTotal);
  const currentWh = sanitizeAmount(yr.form_1040.federal_tax_withholding);

  if (clamped >= currentWh) {
    return {
      ...yr,
      form_1040: {
        ...yr.form_1040,
        federal_tax_withholding: currentWh,
        federal_estimated_tax_payments: clamped - currentWh,
      },
    };
  }

  return {
    ...yr,
    form_1040: {
      ...yr.form_1040,
      federal_tax_withholding: clamped,
      federal_estimated_tax_payments: 0,
    },
  };
}

export function applyFederalWithholding(
  yr: TaxYearRecord,
  amount: number
): TaxYearRecord {
  return {
    ...yr,
    form_1040: {
      ...yr.form_1040,
      federal_tax_withholding: sanitizeAmount(amount),
    },
  };
}

export function applyFederalEstimates(
  yr: TaxYearRecord,
  amount: number
): TaxYearRecord {
  return {
    ...yr,
    form_1040: {
      ...yr.form_1040,
      federal_estimated_tax_payments: sanitizeAmount(amount),
    },
  };
}

/**
 * Updates a specific state's withholding & estimated payments by 2-letter state code.
 */
export function applyStatePaymentByCode(
  yr: TaxYearRecord,
  stateCode: string,
  amount: number
): TaxYearRecord {
  const cleanCode = stateCode.trim().toUpperCase();
  const clamped = sanitizeAmount(amount);
  if (!cleanCode || yr.state_filings.length === 0) {
    return {
      ...yr,
      form_1040: {
        ...yr.form_1040,
        unallocated_state_tax_payments: clamped,
      },
    };
  }

  const hasMatch = yr.state_filings.some((sf) => sf.state_code === cleanCode);
  if (!hasMatch) return yr;

  return {
    ...yr,
    form_1040: {
      ...yr.form_1040,
      unallocated_state_tax_payments: undefined,
    },
    state_filings: yr.state_filings.map((sf) =>
      sf.state_code === cleanCode
        ? { ...sf, state_tax_withholding_and_estimates: clamped }
        : sf
    ),
  };
}

/**
 * Updates combined State Taxes Paid across a year's state filings, preserving non-primary
 * state payments when possible and syncing to the primary state filing (or unallocated
 * fallback when no state filings are configured yet).
 */
export function applyStateTaxesPaidTotal(
  yr: TaxYearRecord,
  setup: SetupConfig,
  nextTotal: number
): TaxYearRecord {
  const clamped = sanitizeAmount(nextTotal);
  if (yr.state_filings.length === 0) {
    return {
      ...yr,
      form_1040: {
        ...yr.form_1040,
        unallocated_state_tax_payments: clamped,
      },
    };
  }

  const targetIdx = resolvePrimaryStateFilingIndex(yr.state_filings, setup);
  const otherPaid = yr.state_filings.reduce(
    (sum, sf, idx) =>
      idx === targetIdx ? sum : sum + sanitizeAmount(sf.state_tax_withholding_and_estimates),
    0
  );

  if (clamped >= otherPaid) {
    return {
      ...yr,
      form_1040: {
        ...yr.form_1040,
        unallocated_state_tax_payments: undefined,
      },
      state_filings: yr.state_filings.map((sf, idx) =>
        idx === targetIdx
          ? { ...sf, state_tax_withholding_and_estimates: clamped - otherPaid }
          : sf
      ),
    };
  }

  return {
    ...yr,
    form_1040: {
      ...yr.form_1040,
      unallocated_state_tax_payments: undefined,
    },
    state_filings: yr.state_filings.map((sf, idx) => ({
      ...sf,
      state_tax_withholding_and_estimates: idx === targetIdx ? clamped : 0,
    })),
  };
}

/**
 * Applies a batch of imported tax payments (e.g., from a future Quicken / CSV importer)
 * cleanly onto a single TaxYearRecord without modifying calculation engine logic.
 */
export function applyImportedTaxPaymentsToYear(
  yr: TaxYearRecord,
  setup: SetupConfig,
  payload: ImportedTaxPaymentsPayload
): TaxYearRecord {
  if (yr.is_locked_actuals) return yr;
  let next = yr;

  if (payload.federal_tax_withholding !== undefined) {
    next = applyFederalWithholding(next, payload.federal_tax_withholding);
  }
  if (payload.federal_estimated_tax_payments !== undefined) {
    next = applyFederalEstimates(next, payload.federal_estimated_tax_payments);
  }
  if (
    payload.federal_total_paid !== undefined &&
    payload.federal_tax_withholding === undefined &&
    payload.federal_estimated_tax_payments === undefined
  ) {
    next = applyFederalTaxesPaidTotal(next, payload.federal_total_paid);
  }

  if (payload.state_payments_by_code) {
    for (const [code, amt] of Object.entries(payload.state_payments_by_code)) {
      next = applyStatePaymentByCode(next, code, amt);
    }
  } else if (payload.state_total_paid !== undefined) {
    next = applyStateTaxesPaidTotal(next, setup, payload.state_total_paid);
  }

  return next;
}
