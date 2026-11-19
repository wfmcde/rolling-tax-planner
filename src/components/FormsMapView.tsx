import React, { useState } from 'react';
import type { FilingFormRequirement } from '../types/tax';

interface FormsMapViewProps {
  forms: FilingFormRequirement[];
}

export const FormsMapView: React.FC<FormsMapViewProps> = ({ forms }) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const categories = ['All', 'Individual', 'Entity', 'Retirement', 'State & PTE'];

  const filtered =
    categoryFilter === 'All'
      ? forms
      : forms.filter((f) => f.category === categoryFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            IRS &amp; State Filing Forms Map
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Module 1 §4 · Required federal returns, schedules, entity forms, retirement plan checkpoints, and state/PTE filings generated dynamically from active setup toggles.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[780px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-3 px-4 font-semibold">Form / Schedule</th>
                <th className="py-3 px-3 font-semibold">Jurisdiction</th>
                <th className="py-3 px-3 font-semibold">Category</th>
                <th className="py-3 px-3 font-semibold">Due Date</th>
                <th className="py-3 px-3 font-semibold">Active Years</th>
                <th className="py-3 px-4 font-semibold">Trigger &amp; Planning Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((form) => (
                <tr key={`${form.jurisdiction}-${form.form_code}`} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 align-top">
                    <div className="font-mono font-semibold text-slate-900">{form.form_code}</div>
                    <div className="text-slate-600 mt-0.5">{form.title}</div>
                  </td>
                  <td className="py-3 px-3 align-top text-slate-700 whitespace-nowrap">
                    {form.jurisdiction}
                  </td>
                  <td className="py-3 px-3 align-top text-slate-600 whitespace-nowrap">
                    {form.category}
                  </td>
                  <td className="py-3 px-3 align-top font-mono text-slate-700 whitespace-nowrap">
                    {form.due_date}
                  </td>
                  <td className="py-3 px-3 align-top font-mono text-slate-700">
                    {form.active_years.length === 6
                      ? `${form.active_years[0]}–${form.active_years[5]}`
                      : form.active_years.join(', ')}
                  </td>
                  <td className="py-3 px-4 align-top">
                    <div className="font-medium text-slate-800">{form.driven_by}</div>
                    <p className="text-slate-500 mt-0.5 leading-relaxed">{form.notes}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
