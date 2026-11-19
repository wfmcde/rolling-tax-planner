import React, { useState } from 'react';
import { ArrowRight, Lock, X } from 'lucide-react';
import type { ComputedTaxYear, TaxYearRecord } from '../types/tax';
import { formatCurrency } from '../utils/format';
import { NumericField } from './NumericField';

interface RollForwardModalProps {
  year1: TaxYearRecord;
  year2: TaxYearRecord;
  year1Computed: ComputedTaxYear;
  year2Computed: ComputedTaxYear;
  nextYear6: number;
  onClose: () => void;
  onConfirmRoll: (overrides: {
    w2_wages_total: number;
    schedule_k1_ordinary_income: number;
    taxable_income: number;
    officer_w2_wages: number;
    scorp_distributions_total: number;
    dbp_actual_contribution: number;
  }) => void;
}

export const RollForwardModal: React.FC<RollForwardModalProps> = ({
  year1,
  year2,
  year1Computed,
  year2Computed,
  nextYear6,
  onClose,
  onConfirmRoll,
}) => {
  const [w2, setW2] = useState(year2Computed.form_1040_in.w2_wages_total);
  const [k1, setK1] = useState(year2Computed.form_1040_in.schedule_k1_ordinary_income);
  const [taxable, setTaxable] = useState(year2Computed.form_1040_out.taxable_income);
  const [officerW2, setOfficerW2] = useState(year2.scorp_1120s.officer_w2_wages);
  const [dists, setDists] = useState(year2.scorp_1120s.scorp_distributions_total);
  const [dbpContrib, setDbpContrib] = useState(year2.dbp_and_retirement.dbp_actual_contribution);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roll-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="roll-modal-title" className="text-base font-semibold text-slate-900">
              Roll Six-Year Window Forward (+1 Year)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Module 3 §4 · Retire {year1.tax_year} actuals, promote &amp; lock {year2.tax_year} as new Year 1, and open {nextYear6} as Year 6.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Transition Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
              <div className="text-slate-500 font-medium">1. Archive Oldest</div>
              <div className="mt-1 font-mono font-semibold text-slate-900">
                {year1.tax_year} Actuals → Archive
              </div>
              <div className="mt-0.5 text-slate-500 font-mono">
                Taxable: {formatCurrency(year1Computed.form_1040_out.taxable_income)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-teal-50/50 border border-teal-200">
              <div className="text-teal-800 font-medium">2. Promote &amp; Lock Year 1</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-teal-800" />
                {year2.tax_year} Forecast → Actuals
              </div>
              <div className="mt-0.5 text-slate-600">Reconcile filed figures below</div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
              <div className="text-slate-500 font-medium">3. Append Year 6</div>
              <div className="mt-1 font-mono font-semibold text-slate-900">
                New Slot: {nextYear6}
              </div>
              <div className="mt-0.5 text-slate-500">Projected using Setup assumptions</div>
            </div>
          </div>

          {/* Reconciliation Inputs for New Year 1 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              Reconcile {year2.tax_year} Filed Return Figures (Locks as New Year 1 Actuals)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumericField
                label="Filed W-2 Wages Total"
                fieldCode="w2_wages_total"
                prefix="$"
                value={w2}
                onChange={setW2}
              />
              <NumericField
                label="Filed Schedule K-1 Ordinary Income"
                fieldCode="schedule_k1_ordinary_income"
                prefix="$"
                value={k1}
                onChange={setK1}
              />
              <NumericField
                label="Filed Form 1040 Taxable Income"
                fieldCode="taxable_income"
                prefix="$"
                value={taxable}
                onChange={setTaxable}
              />
              <NumericField
                label="Filed Officer W-2 Wages (1120-S)"
                fieldCode="officer_w2_wages"
                prefix="$"
                value={officerW2}
                onChange={setOfficerW2}
              />
              <NumericField
                label="Filed S-Corp Distributions"
                fieldCode="scorp_distributions_total"
                prefix="$"
                value={dists}
                onChange={setDists}
              />
              <NumericField
                label="Filed DBP Deductible Contribution"
                fieldCode="dbp_actual_contribution"
                prefix="$"
                value={dbpContrib}
                onChange={setDbpContrib}
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirmRoll({
                w2_wages_total: w2,
                schedule_k1_ordinary_income: k1,
                taxable_income: taxable,
                officer_w2_wages: officerW2,
                scorp_distributions_total: dists,
                dbp_actual_contribution: dbpContrib,
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900 whitespace-nowrap"
          >
            Archive {year1.tax_year} &amp; Lock {year2.tax_year}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
