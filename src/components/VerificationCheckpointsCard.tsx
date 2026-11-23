import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
} from 'lucide-react';
import type { ComputedTaxYear, SetupConfig } from '../types/tax';
import { getPersonNames } from '../engine/scheduleCatalog';
import { DEFAULT_PROFILE_SEED } from '../data/profiles';
import { formatCurrency } from '../utils/format';

interface VerificationCheckpointsCardProps {
  setup: SetupConfig;
  year2025: ComputedTaxYear;
  onSet2025Ss: (person: 'debra' | 'bill', amount: number) => void;
}

interface CheckpointRow {
  id: string;
  label: string;
  formRef: string;
  computed: number;
  target: number;
  note: string;
}

function formatSignedVariance(diff: number): string {
  if (diff === 0) return '$0';
  const sign = diff > 0 ? '+' : '-';
  return `${sign}${formatCurrency(Math.abs(diff))}`;
}

export const VerificationCheckpointsCard: React.FC<VerificationCheckpointsCardProps> = ({
  setup,
  year2025,
  onSet2025Ss,
}) => {
  const { primaryName, spouseName } = getPersonNames(setup);

  const caFiling = year2025.state_filings_out.find((s) => s.state_code === 'CA');
  const azFiling = year2025.state_filings_out.find((s) => s.state_code === 'AZ');

  const billSs = year2025.form_1040_out.primary_ss_gross;
  const debraSs = year2025.form_1040_out.spouse_ss_gross;
  const ssActive = billSs > 0 || debraSs > 0;

  const k1 = year2025.scorp_out.ordinary_business_income_1120s;
  const qbi = year2025.form_1040_out.qualified_business_income_deduction;
  const agi = year2025.form_1040_out.adjusted_gross_income;
  const taxable = year2025.form_1040_out.taxable_income;
  const fedTax = year2025.form_1040_out.federal_income_tax;
  const ca540 = caFiling?.state_personal_tax_liability ?? 0;
  const ca100s = caFiling?.state_entity_tax_liability ?? 0;
  const az140nr = azFiling?.state_personal_tax_liability ?? 0;

  const bench = DEFAULT_PROFILE_SEED.verification_benchmarks_2025;
  const k1Diff = k1 - bench.k1_ordinary_income;
  const stdDed = year2025.form_1040_out.deduction_amount;
  const seniorDed = year2025.form_1040_out.enhanced_senior_deduction_allowed;
  const ssTestAmt = bench.ss_annual_test_amount;
  const ssTestLabel = `$${(ssTestAmt / 1000).toFixed(1)}k`;
  const primaryOwnPct = year2025.scorp_in.bill_ownership_pct ?? 50;
  const spouseOwnPct = year2025.scorp_in.debra_ownership_pct ?? 50;

  const checkpoints: CheckpointRow[] = [
    {
      id: 'k1',
      label: 'S-Corp Ordinary Business Income',
      formRef: 'Form 1120-S, Line 22',
      computed: k1,
      target: bench.k1_ordinary_income,
      note:
        k1Diff === 0
          ? 'Exact match to filed Form 1120-S.'
          : `Gross receipts minus 1120-S deductions differs by ${formatSignedVariance(k1Diff)}.`,
    },
    {
      id: 'qbi',
      label: 'Form 8995 QBI Deduction',
      formRef: 'Form 1040, Line 13a',
      computed: qbi,
      target: bench.qbi_deduction,
      note: ssActive
        ? `Includes $${(billSs + debraSs).toLocaleString()} gross SS baseline; 20% K-1 cap applies.`
        : qbi === bench.qbi_deduction
        ? 'Exact match: 20% × (Taxable before QBI − Net Cap Gain − Qualified Div).'
        : `Differs from filed reference target by ${formatSignedVariance(qbi - bench.qbi_deduction)}.`,
    },
    {
      id: 'agi',
      label: 'Form 1040 AGI',
      formRef: 'Form 1040, Line 11',
      computed: agi,
      target: bench.agi,
      note: ssActive
        ? `Reflects +${formatCurrency(year2025.form_1040_out.social_security_taxable)} taxable SS (Line 6b).`
        : agi === bench.agi
        ? 'Exact match to filed Form 1040 Line 11.'
        : `Differs from filed reference target by ${formatSignedVariance(agi - bench.agi)}.`,
    },
    {
      id: 'taxable',
      label: 'Form 1040 Taxable Income',
      formRef: 'Form 1040, Line 15',
      computed: taxable,
      target: bench.taxable_income,
      note: ssActive
        ? `Std Ded ${formatCurrency(stdDed)} · Sch 1-A Senior Ded ${formatCurrency(seniorDed)}.`
        : taxable === bench.taxable_income
        ? `Exact match (Std Ded ${formatCurrency(stdDed)} · Sch 1-A Senior Ded ${formatCurrency(seniorDed)}).`
        : `Std Ded ${formatCurrency(stdDed)} · Sch 1-A Senior Ded ${formatCurrency(seniorDed)}.`,
    },
    {
      id: 'fedTax',
      label: 'Form 1040 Total Tax',
      formRef: 'Form 1040, Line 24',
      computed: fedTax,
      target: bench.federal_tax,
      note: ssActive
        ? `Effective ${year2025.form_1040_out.effective_tax_rate.toFixed(2)}% · Marginal ${year2025.form_1040_out.marginal_tax_rate}% with SS active.`
        : fedTax === bench.federal_tax
        ? 'Exact match using QDCG Worksheet + IRS $50 Tax Table midpoint.'
        : `Differs from filed reference target by ${formatSignedVariance(fedTax - bench.federal_tax)}.`,
    },
    {
      id: 'ca540',
      label: 'CA Form 540 Tax (Before Penalties/Interest)',
      formRef: 'CA Form 540',
      computed: ca540,
      target: bench.primary_state_personal_tax,
      note:
        ca540 === bench.primary_state_personal_tax
          ? `Exact match: CA AGI ${formatCurrency(caFiling?.state_apportioned_income ?? 0)}; CA 100S ${formatCurrency(ca100s)} tracked separately.`
          : `CA AGI ${formatCurrency(caFiling?.state_apportioned_income ?? 0)} · CA 100S ${formatCurrency(ca100s)} tracked separately; SS exempt in CA.`,
    },
    {
      id: 'az140nr',
      label: 'AZ Form 140NR Net Tax (After Credit)',
      formRef: 'AZ Form 140NR / Form 309',
      computed: az140nr,
      target: bench.secondary_state_personal_tax,
      note:
        az140nr === bench.secondary_state_personal_tax
          ? 'Exact match: statutory CA/AZ reverse credit (AZ Form 309) offsets 100% of AZ non-resident tax.'
          : 'Review CA resident / AZ non-resident reverse credit configuration.',
    },
  ];

  const exactCount = checkpoints.filter((c) => c.computed === c.target).length;
  const mismatchCount = checkpoints.length - exactCount;

  // Default to collapsed whenever all checkpoints pass; auto-expand whenever any checkpoint fails
  const [expanded, setExpanded] = useState<boolean>(() => mismatchCount > 0);
  const prevMismatchCountRef = useRef<number>(mismatchCount);

  useEffect(() => {
    if (mismatchCount > 0 && prevMismatchCountRef.current === 0) {
      setExpanded(true);
    }
    prevMismatchCountRef.current = mismatchCount;
  }, [mismatchCount]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div
        className={`px-5 py-3.5 ${
          expanded ? 'border-b border-slate-200' : ''
        } flex flex-col lg:flex-row lg:items-center justify-between gap-3`}
      >
        <div className="flex items-start gap-2.5">
          <FlaskConical className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                2025 Deterministic Engine Verification Checkpoints
              </h2>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                  mismatchCount === 0
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {exactCount}/{checkpoints.length} Exact Match
                {ssActive ? ` ($${((billSs + debraSs) / 1000).toFixed(0)}k SS On)` : ''}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              All 2025 outputs computed strictly from filed constant inputs (zero hardcoded overrides). Discrepancies against filed returns are flagged transparently below.
            </p>
          </div>
        </div>

        {/* Independent 2025 Primary & Spouse SS Test Controls + Collapse Toggle */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium">2025 {primaryName} SS:</span>
            <div
              className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5"
              role="group"
              aria-label={`2025 ${primaryName} Social Security test value`}
            >
              {[0, ssTestAmt].map((val) => {
                const active = billSs === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onSet2025Ss('bill', val)}
                    className={`px-2 py-0.5 text-[11px] font-mono tabular-nums rounded-sm transition-colors ${
                      active
                        ? 'bg-teal-800 text-white font-medium'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {val === 0 ? '$0' : ssTestLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium">2025 {spouseName} SS:</span>
            <div
              className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5"
              role="group"
              aria-label={`2025 ${spouseName} Social Security test value`}
            >
              {[0, ssTestAmt].map((val) => {
                const active = debraSs === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onSet2025Ss('debra', val)}
                    className={`px-2 py-0.5 text-[11px] font-mono tabular-nums rounded-sm transition-colors ${
                      active
                        ? 'bg-teal-800 text-white font-medium'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {val === 0 ? '$0' : ssTestLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 bg-white"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                Hide <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Show <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                <th className="py-2 px-4">Checkpoint</th>
                <th className="py-2 px-3 text-right">Engine Output</th>
                <th className="py-2 px-3 text-right">Filed Target</th>
                <th className="py-2 px-3 text-right">Variance</th>
                <th className="py-2 px-4">Diagnostic Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {checkpoints.map((row) => {
                const diff = row.computed - row.target;
                const isExact = diff === 0;
                return (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-4 align-top">
                      <div className="font-medium text-slate-900">{row.label}</div>
                      <div className="text-[10px] text-slate-500">{row.formRef}</div>
                    </td>
                    <td className="py-2 px-3 text-right align-top font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(row.computed)}
                    </td>
                    <td className="py-2 px-3 text-right align-top font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatCurrency(row.target)}
                    </td>
                    <td className="py-2 px-3 text-right align-top whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-mono tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded border ${
                          isExact
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {isExact ? (
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                        )}
                        {formatSignedVariance(diff)}
                      </span>
                    </td>
                    <td className="py-2 px-4 align-top text-[11px] text-slate-600 leading-snug">
                      {row.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
            <div>
              <span className="font-semibold text-slate-800">Form 7203 Basis Check:</span>{' '}
              Beg Basis {formatCurrency(year2025.scorp_in.stock_basis_beginning)} + K-1{' '}
              {formatCurrency(k1)} + Sch K Int{' '}
              {formatCurrency(year2025.scorp_in.schedule_k_interest_income ?? 0)} − Dist{' '}
              {formatCurrency(year2025.scorp_in.scorp_distributions_total)} → Excess Dist Gain{' '}
              <span className="font-mono font-semibold text-slate-900">
                {formatCurrency(year2025.scorp_out.excess_distribution_capital_gain)}
              </span>{' '}
              + Non-S-Corp {formatCurrency(year2025.form_1040_in.long_term_capital_gain_loss)} = Sch D Net{' '}
              <span className="font-mono font-semibold text-slate-900">
                {formatCurrency(
                  year2025.scorp_out.excess_distribution_capital_gain +
                    year2025.form_1040_in.long_term_capital_gain_loss
                )}
              </span>{' '}
              (Filed: {formatCurrency(bench.schedule_d_net_filed)}).
            </div>
            <div className="font-mono tabular-nums text-slate-500">
              EIN {year2025.scorp_in.entity_ein || setup.business_ein || '—'} · {primaryOwnPct}% {primaryName} / {spouseOwnPct}% {spouseName}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
