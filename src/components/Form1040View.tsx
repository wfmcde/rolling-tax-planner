import React, { useState } from 'react';
import { Check, FileText, Loader2, Lock, Unlock } from 'lucide-react';
import type {
  ComputedTaxYear,
  DeductionMethod,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { formatCurrency, formatPercent } from '../utils/format';
import { NumericField } from './NumericField';

interface Form1040ViewProps {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onUpdateYear: (taxYear: number, updater: (yr: TaxYearRecord) => TaxYearRecord) => void;
}

interface ExtractedField {
  field_path: string;
  label: string;
  source_document: string;
  extracted_value: string;
  numeric_value?: number;
  confidence_level: string;
  notes?: string;
}

interface ExtractActualsResponse {
  detected_tax_year?: number;
  detected_forms?: string[];
  extracted_fields?: ExtractedField[];
  reconciliation_warnings?: string[];
}

const SAMPLE_RETURN_TEXT = `2025 Federal Form 1040 Summary (Married Filing Jointly)
Line 1a W-2 Wages: $180,000
Line 2b Taxable Interest: $5,400
Line 3a Qualified Dividends: $7,200 | Line 3b Ordinary Dividends: $9,100
Schedule D Net Long-Term Capital Gain: $8,500
Schedule K-1 (Operating Support Services, LLC - Form 1120-S) Box 1 Ordinary Business Income: $95,000
Form 1120-S Shareholder Distributions: $60,000 | Ending Stock Basis: $140,000
Defined Benefit Plan Deductible Contribution: $45,000
Standard Deduction Method Elected | Form 1040 Line 15 Taxable Income: $225,000`;

export const Form1040View: React.FC<Form1040ViewProps> = ({
  setup,
  years,
  computed,
  selectedYear,
  onSelectYear,
  onUpdateYear,
}) => {
  const yr = years.find((y) => y.tax_year === selectedYear) ?? years[0];
  const comp = computed.find((c) => c.tax_year === yr.tax_year) ?? computed[0];

  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  // AI Actuals Extraction state
  const [showExtractor, setShowExtractor] = useState(false);
  const [docText, setDocText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('2025 Filed Form 1040 & K-1 Summary');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractActualsResponse | null>(null);
  const [appliedNotice, setAppliedNotice] = useState(false);

  const isLocked = yr.is_locked_actuals;

  const update1040 = (patch: Partial<TaxYearRecord['form_1040']>) => {
    if (isLocked) return;
    onUpdateYear(yr.tax_year, (prev) => ({
      ...prev,
      form_1040: {
        ...prev.form_1040,
        ...patch,
        // Clear locked override when actively editing amended Year 1 figures
        locked_taxable_income_override:
          'locked_taxable_income_override' in patch
            ? patch.locked_taxable_income_override
            : undefined,
      },
    }));
  };

  const handleConfirmUnlock = () => {
    if (!unlockReason.trim()) return;
    onUpdateYear(yr.tax_year, (prev) => ({
      ...prev,
      is_locked_actuals: false,
      amended_unlock_reason: unlockReason.trim(),
    }));
    setShowUnlockPrompt(false);
    setUnlockReason('');
  };

  const handleRelock = () => {
    onUpdateYear(yr.tax_year, (prev) => ({
      ...prev,
      is_locked_actuals: true,
    }));
  };

  const handleExtractActuals = async () => {
    if (!docText.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);
    setAppliedNotice(false);
    try {
      const res = await fetch('/api/ai/extract-actuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentText: docText, sourceLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse document.');
      setExtractResult(data as ExtractActualsResponse);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleApplyExtracted = () => {
    if (!extractResult?.extracted_fields) return;
    const fields = extractResult.extracted_fields;
    onUpdateYear(years[0].tax_year, (prev) => {
      const next: TaxYearRecord = JSON.parse(JSON.stringify(prev));
      for (const f of fields) {
        const num =
          typeof f.numeric_value === 'number' && !Number.isNaN(f.numeric_value)
            ? f.numeric_value
            : Number(String(f.extracted_value).replace(/[^0-9.-]/g, ''));

        switch (f.field_path) {
          case 'form_1040.w2_wages_total':
            if (!Number.isNaN(num)) next.form_1040.w2_wages_total = num;
            break;
          case 'form_1040.taxable_interest':
            if (!Number.isNaN(num)) next.form_1040.taxable_interest = num;
            break;
          case 'form_1040.ordinary_dividends':
            if (!Number.isNaN(num)) next.form_1040.ordinary_dividends = num;
            break;
          case 'form_1040.qualified_dividends':
            if (!Number.isNaN(num)) next.form_1040.qualified_dividends = num;
            break;
          case 'form_1040.long_term_capital_gain_loss':
            if (!Number.isNaN(num)) next.form_1040.long_term_capital_gain_loss = num;
            break;
          case 'form_1040.schedule_k1_ordinary_income':
            if (!Number.isNaN(num)) {
              next.form_1040.schedule_k1_ordinary_income = num;
              next.scorp_1120s.locked_ordinary_income_override = num;
            }
            break;
          case 'form_1040.social_security_gross':
            if (!Number.isNaN(num)) next.form_1040.social_security_gross = num;
            break;
          case 'form_1040.deduction_method':
            if (
              String(f.extracted_value).toLowerCase().includes('itemized')
            ) {
              next.form_1040.deduction_method = 'itemized';
            } else {
              next.form_1040.deduction_method = 'standard';
            }
            break;
          case 'form_1040.locked_taxable_income_override':
            if (!Number.isNaN(num)) next.form_1040.locked_taxable_income_override = num;
            break;
          case 'scorp_1120s.officer_w2_wages':
            if (!Number.isNaN(num)) next.scorp_1120s.officer_w2_wages = num;
            break;
          case 'scorp_1120s.scorp_distributions_total':
            if (!Number.isNaN(num)) next.scorp_1120s.scorp_distributions_total = num;
            break;
          case 'scorp_1120s.stock_basis_ending':
            if (!Number.isNaN(num)) next.scorp_1120s.locked_stock_basis_ending_override = num;
            break;
          case 'dbp_and_retirement.dbp_actual_contribution':
            if (!Number.isNaN(num)) next.dbp_and_retirement.dbp_actual_contribution = num;
            break;
          default:
            break;
        }
      }
      next.is_locked_actuals = true;
      return next;
    });
    setAppliedNotice(true);
  };

  return (
    <div className="space-y-6">
      {/* Header & Year Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Form 1040 Household Return
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Year {yr.tax_year} · {yr.record_mode === 'actuals' ? 'Actuals Baseline Anchor' : 'Rolling Forecast'} ·{' '}
            {comp.primary_age !== null ? `Primary Age ${comp.primary_age}` : 'Primary DOB blank'}
            {comp.spouse_age !== null ? ` / Spouse Age ${comp.spouse_age}` : ''}
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {years.map((y) => (
            <button
              key={y.tax_year}
              type="button"
              onClick={() => onSelectYear(y.tax_year)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
                y.tax_year === yr.tax_year
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {y.is_locked_actuals && <Lock className="w-3 h-3 text-teal-700" />}
              {y.tax_year}
            </button>
          ))}
        </div>
      </div>

      {/* Year 1 Lock Integrity Controls (Module 4 §3) */}
      {yr.record_mode === 'actuals' && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {isLocked ? (
                <Lock className="w-4 h-4 text-teal-800 mt-0.5 shrink-0" />
              ) : (
                <Unlock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              )}
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  {isLocked
                    ? `Year 1 (${yr.tax_year}) Locked to Filed Return`
                    : `Year 1 (${yr.tax_year}) Unlocked — Amended-Return Mode`}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isLocked
                    ? 'Direct edits are blocked to preserve filed baseline integrity. Use Amended-Return Unlock or AI Document Extraction to update.'
                    : `Amendment reason: ${yr.amended_unlock_reason || 'Manual amendment'}. Re-lock after reconciliation.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowExtractor((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 transition-colors whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                {showExtractor ? 'Hide Return Parser' : 'Parse Filed Return (AI)'}
              </button>
              {isLocked ? (
                <button
                  type="button"
                  onClick={() => setShowUnlockPrompt((v) => !v)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Amended-Return Unlock
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRelock}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors whitespace-nowrap"
                >
                  Re-Lock Year 1 Actuals
                </button>
              )}
            </div>
          </div>

          {showUnlockPrompt && isLocked && (
            <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="Enter reason for unlocking Year 1 (e.g., Form 1040-X amended K-1 reconciliation)..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleConfirmUnlock}
                disabled={!unlockReason.trim()}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-amber-700 rounded-md hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap"
              >
                Confirm Unlock
              </button>
            </div>
          )}

          {showExtractor && (
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">
                  AI Year 1 Actuals Extraction (Provenance &amp; Confidence Review)
                </div>
                <button
                  type="button"
                  onClick={() => setDocText(SAMPLE_RETURN_TEXT)}
                  className="text-xs font-medium text-teal-800 hover:underline"
                >
                  Load Sample 1040 / K-1 Text
                </button>
              </div>
              <input
                type="text"
                value={sourceLabel}
                onChange={(e) => setSourceLabel(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                placeholder="Source document name"
              />
              <textarea
                rows={4}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste lines from Form 1040, Form 1120-S, Schedule K-1, or state return summary..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleExtractActuals}
                  disabled={extracting || !docText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 disabled:opacity-50"
                >
                  {extracting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {extracting ? 'Extracting Fields...' : 'Extract & Tag Provenance'}
                </button>
              </div>

              {extractError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
                  {extractError}
                </div>
              )}

              {extractResult?.extracted_fields && (
                <div className="space-y-3">
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="py-2 px-3 font-medium">Schema Field</th>
                          <th className="py-2 px-3 font-medium">Extracted Value</th>
                          <th className="py-2 px-3 font-medium">Source Document</th>
                          <th className="py-2 px-3 font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {extractResult.extracted_fields.map((f, i) => (
                          <tr key={`${f.field_path}-${i}`}>
                            <td className="py-2 px-3 font-mono text-slate-800">{f.field_path}</td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                              {f.extracted_value}
                            </td>
                            <td className="py-2 px-3 text-slate-500">{f.source_document}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`font-medium ${
                                  f.confidence_level === 'high'
                                    ? 'text-emerald-700'
                                    : f.confidence_level === 'medium'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                                }`}
                              >
                                {f.confidence_level}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {appliedNotice ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <Check className="w-4 h-4" /> Confirmed fields applied and locked to Year 1 actuals.
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Explicit confirmation required before writing and locking Year 1 actuals.
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleApplyExtracted}
                      className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
                    >
                      Confirm &amp; Lock into Year 1
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Two-Column Split: Inputs vs Live Deterministic Tax Output */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Form 1040 Inputs */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Income Streams</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {setup.has_scorp && yr.scorp_1120s.auto_sync_k1 && !yr.is_locked_actuals
                ? 'S-Corp Auto-Sync is enabled for forecast years: Officer W-2 and Schedule K-1 ordinary income sync from Form 1120-S.'
                : 'Enter Form 1040 household income lines directly.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumericField
              label="W-2 Wages Total"
              fieldCode="w2_wages_total"
              prefix="$"
              value={comp.form_1040_in.w2_wages_total}
              disabled={isLocked}
              onChange={(v) => update1040({ w2_wages_total: v })}
            />
            <NumericField
              label="Schedule K-1 Ordinary Income"
              fieldCode="schedule_k1_ordinary_income"
              prefix="$"
              value={comp.form_1040_in.schedule_k1_ordinary_income}
              disabled={isLocked || (setup.has_scorp && yr.scorp_1120s.auto_sync_k1 && !yr.is_locked_actuals)}
              onChange={(v) => update1040({ schedule_k1_ordinary_income: v })}
              helperText={
                setup.has_scorp && yr.scorp_1120s.auto_sync_k1 && !yr.is_locked_actuals
                  ? 'Synced from S-Corp 1120-S module'
                  : undefined
              }
            />
            <NumericField
              label="Taxable Interest"
              fieldCode="taxable_interest"
              prefix="$"
              step={500}
              value={yr.form_1040.taxable_interest}
              disabled={isLocked}
              onChange={(v) => update1040({ taxable_interest: v })}
            />
            <NumericField
              label="Tax-Exempt Interest"
              fieldCode="tax_exempt_interest"
              prefix="$"
              step={500}
              value={yr.form_1040.tax_exempt_interest}
              disabled={isLocked}
              onChange={(v) => update1040({ tax_exempt_interest: v })}
            />
            <NumericField
              label="Ordinary Dividends"
              fieldCode="ordinary_dividends"
              prefix="$"
              step={500}
              value={yr.form_1040.ordinary_dividends}
              disabled={isLocked}
              onChange={(v) => update1040({ ordinary_dividends: v })}
            />
            <NumericField
              label="Qualified Dividends"
              fieldCode="qualified_dividends"
              prefix="$"
              step={500}
              value={yr.form_1040.qualified_dividends}
              disabled={isLocked}
              onChange={(v) => update1040({ qualified_dividends: v })}
            />
            <NumericField
              label="Short-Term Capital Gain / Loss"
              fieldCode="short_term_capital_gain_loss"
              prefix="$"
              step={1000}
              value={yr.form_1040.short_term_capital_gain_loss}
              disabled={isLocked}
              onChange={(v) => update1040({ short_term_capital_gain_loss: v })}
            />
            <NumericField
              label="Long-Term Capital Gain / Loss"
              fieldCode="long_term_capital_gain_loss"
              prefix="$"
              step={1000}
              value={yr.form_1040.long_term_capital_gain_loss}
              disabled={isLocked}
              onChange={(v) => update1040({ long_term_capital_gain_loss: v })}
            />
            <NumericField
              label="Social Security Gross"
              fieldCode="social_security_gross"
              prefix="$"
              step={1000}
              value={comp.form_1040_out.social_security_gross_effective}
              disabled={
                isLocked ||
                Boolean(setup.primary_profile?.social_security.receiving) ||
                (setup.filing_status === 'married_filing_jointly' &&
                  Boolean(setup.spouse_profile?.social_security.receiving))
              }
              onChange={(v) => update1040({ social_security_gross: v })}
              helperText={
                setup.primary_profile?.social_security.receiving ||
                (setup.filing_status === 'married_filing_jointly' &&
                  setup.spouse_profile?.social_security.receiving)
                  ? `Primary ${formatCurrency(comp.form_1040_out.primary_ss_gross)} (${comp.form_1040_out.primary_ss_status})${
                      setup.filing_status === 'married_filing_jointly'
                        ? ` · Spouse ${formatCurrency(comp.form_1040_out.spouse_ss_gross)} (${comp.form_1040_out.spouse_ss_status})`
                        : ''
                    } · Taxable: ${formatCurrency(comp.form_1040_out.social_security_taxable)}`
                  : `Taxable portion computed: ${formatCurrency(comp.form_1040_out.social_security_taxable)}`
              }
            />
            <NumericField
              label="Taxable IRA Distributions"
              fieldCode="ira_distributions_taxable"
              prefix="$"
              step={1000}
              value={yr.form_1040.ira_distributions_taxable}
              disabled={isLocked}
              onChange={(v) =>
                update1040({ ira_distributions_taxable: v, ira_distributions_gross: v })
              }
            />
            <NumericField
              label="Taxable Pensions & Annuities"
              fieldCode="pensions_and_annuities_taxable"
              prefix="$"
              step={1000}
              value={yr.form_1040.pensions_and_annuities_taxable}
              disabled={isLocked}
              onChange={(v) =>
                update1040({
                  pensions_and_annuities_taxable: v,
                  pensions_and_annuities_gross: v,
                })
              }
            />
            <NumericField
              label="Schedule 1 Other Income"
              fieldCode="schedule_1_other_income"
              prefix="$"
              step={1000}
              value={yr.form_1040.schedule_1_other_income}
              disabled={isLocked}
              onChange={(v) => update1040({ schedule_1_other_income: v })}
            />
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Deductions &amp; Healthcare Premiums
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-700">Deduction Method</label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
                  {(['standard', 'itemized'] as DeductionMethod[]).map((method) => (
                    <button
                      key={method}
                      type="button"
                      disabled={isLocked}
                      onClick={() => update1040({ deduction_method: method })}
                      className={`py-1.5 text-xs font-medium rounded transition-colors capitalize ${
                        yr.form_1040.deduction_method === method
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      } ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <NumericField
                label="Medical / Health Insurance Premiums"
                fieldCode="health_insurance_premiums"
                prefix="$"
                step={500}
                value={yr.form_1040.health_insurance_premiums}
                disabled={isLocked}
                onChange={(v) => update1040({ health_insurance_premiums: v })}
                helperText={
                  setup.has_scorp
                    ? 'Deducted above-the-line for >2% S-Corp shareholder'
                    : 'Included in medical itemized threshold'
                }
              />

              {yr.form_1040.deduction_method === 'itemized' && (
                <NumericField
                  label="Itemized Deductions Total (Schedule A)"
                  fieldCode="itemized_deductions_input"
                  prefix="$"
                  step={500}
                  value={yr.form_1040.itemized_deductions_input}
                  disabled={isLocked}
                  onChange={(v) => update1040({ itemized_deductions_input: v })}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right: Deterministic Form 1040 Output Summary */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Deterministic Form 1040 Summary ({yr.tax_year})
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {yr.is_locked_actuals ? 'Anchored' : 'Calculated'}
            </span>
          </div>

          <dl className="divide-y divide-slate-100 text-xs">
            {[
              { label: 'Total Income', code: 'total_income', value: formatCurrency(comp.form_1040_out.total_income) },
              {
                label: 'Adjustments to Income (Sch 1)',
                code: 'adjustments_to_income',
                value: formatCurrency(-comp.form_1040_out.adjustments_to_income),
              },
              {
                label: 'Adjusted Gross Income (AGI)',
                code: 'adjusted_gross_income',
                value: formatCurrency(comp.form_1040_out.adjusted_gross_income),
                bold: true,
              },
              {
                label: `Deduction (${yr.form_1040.deduction_method})`,
                code: 'deduction_amount',
                value: formatCurrency(-comp.form_1040_out.deduction_amount),
              },
              {
                label: 'QBI Deduction (Section 199A)',
                code: 'qualified_business_income_deduction',
                value: formatCurrency(-comp.form_1040_out.qualified_business_income_deduction),
              },
              {
                label: 'Taxable Income',
                code: 'taxable_income',
                value: formatCurrency(comp.form_1040_out.taxable_income),
                bold: true,
              },
              {
                label: 'Ordinary Taxable Stack',
                code: 'ordinary_taxable_income',
                value: formatCurrency(comp.form_1040_out.ordinary_taxable_income),
              },
              {
                label: 'Preferential Cap Gains / Qual Divs',
                code: 'preferential_income',
                value: formatCurrency(comp.form_1040_out.preferential_income),
              },
              {
                label: 'Net Investment Income Tax (3.8%)',
                code: 'niit_tax',
                value: formatCurrency(comp.form_1040_out.niit_tax),
              },
              {
                label: 'Federal Income Tax',
                code: 'federal_income_tax',
                value: formatCurrency(comp.form_1040_out.federal_income_tax),
                bold: true,
                accent: true,
              },
              {
                label: 'Marginal Federal Tax Rate',
                code: 'marginal_tax_rate',
                value: formatPercent(comp.form_1040_out.marginal_tax_rate, 0),
              },
              {
                label: 'Effective Federal Tax Rate (% of AGI)',
                code: 'effective_tax_rate',
                value: formatPercent(comp.form_1040_out.effective_tax_rate, 2),
              },
            ].map((row) => (
              <div key={row.code} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <dt className={row.bold ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                    {row.label}
                  </dt>
                  <div className="text-[11px] font-mono text-slate-400">{row.code}</div>
                </div>
                <dd
                  className={`font-mono tabular-nums ${
                    row.accent
                      ? 'text-base font-semibold text-teal-800'
                      : row.bold
                      ? 'text-sm font-semibold text-slate-900'
                      : 'text-slate-800'
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="pt-3 border-t border-slate-200 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-800">
                  Medicare &amp; IRMAA (2-Yr Lookback MAGI: {formatCurrency(comp.form_1040_out.irmaa_lookback_magi)})
                </div>
                <div className="text-slate-500 mt-0.5">{comp.form_1040_out.irmaa_tier}</div>
              </div>
              <div className="font-mono tabular-nums font-semibold text-slate-900">
                {comp.form_1040_out.irmaa_annual_surcharge > 0
                  ? `+${formatCurrency(comp.form_1040_out.irmaa_annual_surcharge)}/yr`
                  : '$0/yr'}
              </div>
            </div>

            {(setup.primary_profile?.medicare.enrolled ||
              (setup.filing_status === 'married_filing_jointly' &&
                setup.spouse_profile?.medicare.enrolled)) && (
              <div className="grid grid-cols-1 gap-1 pt-1 text-[11px] font-mono tabular-nums text-slate-600">
                {setup.primary_profile?.medicare.enrolled && (
                  <div className="flex justify-between">
                    <span>Primary Enrolled (Base / IRMAA)</span>
                    <span>
                      {formatCurrency(comp.form_1040_out.primary_medicare_base_annual)} / +
                      {formatCurrency(comp.form_1040_out.primary_irmaa_surcharge)}
                    </span>
                  </div>
                )}
                {setup.filing_status === 'married_filing_jointly' &&
                  setup.spouse_profile?.medicare.enrolled && (
                    <div className="flex justify-between">
                      <span>Spouse Enrolled (Base / IRMAA)</span>
                      <span>
                        {formatCurrency(comp.form_1040_out.spouse_medicare_base_annual)} / +
                        {formatCurrency(comp.form_1040_out.spouse_irmaa_surcharge)}
                      </span>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
