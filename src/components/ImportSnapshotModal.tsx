import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, PlusCircle, RefreshCw, X } from 'lucide-react';
import type { TaxProfileRecord, WorkspaceProfileMode } from '../types/tax';
import type { ParsedProfileImport, SnapshotImportMode } from '../engine/profileStore';
import { getFilingStatusShortLabel, getProfileEntitySummary } from '../engine/profileStore';

interface ImportSnapshotModalProps {
  parsed: ParsedProfileImport;
  filename: string;
  activeProfile: TaxProfileRecord;
  workspaceMode: WorkspaceProfileMode;
  onConfirm: (mode: SnapshotImportMode) => void;
  onCancel: () => void;
}

export const ImportSnapshotModal: React.FC<ImportSnapshotModalProps> = ({
  parsed,
  filename,
  activeProfile,
  workspaceMode,
  onConfirm,
  onCancel,
}) => {
  const isSingle = parsed.profiles.length === 1;
  const primaryIncoming = parsed.profiles[0];
  const [restoreMode, setRestoreMode] = useState<SnapshotImportMode>('new_profile');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const canOverwrite = isSingle && workspaceMode === 'my_profile';
  const yearList = primaryIncoming.state.years.map((y) => y.tax_year);
  const yearRange =
    yearList.length > 0 ? `${Math.min(...yearList)}–${Math.max(...yearList)}` : '6-Year Plan';

  const formattedExportedAt = (() => {
    if (!parsed.exportedAt) return null;
    const d = new Date(parsed.exportedAt);
    if (Number.isNaN(d.getTime())) return parsed.exportedAt;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (restoreMode === 'overwrite_active' && !confirmOverwrite) return;
    onConfirm(canOverwrite ? restoreMode : 'new_profile');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-snapshot-modal-title"
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-lg max-w-lg w-full shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-teal-800 text-white flex items-center justify-center shrink-0 mt-0.5">
              <FileJson className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="import-snapshot-modal-title"
                className="text-sm font-bold text-slate-900"
              >
                Import Profile Snapshot
              </h2>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {filename} · Schema v{parsed.schemaVersion}
                {formattedExportedAt ? ` · Exported ${formattedExportedAt}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel snapshot import"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Validated Snapshot Summary */}
          <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              {isSingle
                ? 'Validated Profile Snapshot Ready to Restore'
                : `Validated Backup Bundle (${parsed.profiles.length} Profiles)`}
            </div>
            {isSingle ? (
              <div className="mt-2 space-y-1 text-slate-700">
                <div className="font-semibold text-slate-900">{primaryIncoming.name}</div>
                <div className="text-[11px] font-mono text-slate-600">
                  {getProfileEntitySummary(primaryIncoming)} ·{' '}
                  {getFilingStatusShortLabel(primaryIncoming.state.setup.filing_status)} · Tax
                  Years {yearRange}
                  {primaryIncoming.entity_ein ? ` · EIN ${primaryIncoming.entity_ein}` : ''}
                </div>
              </div>
            ) : (
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-700 list-disc pl-4">
                {parsed.profiles.slice(0, 5).map((p, idx) => (
                  <li key={`${p.id}-${idx}`} className="truncate">
                    <span className="font-medium text-slate-900">{p.name}</span> (
                    {getProfileEntitySummary(p)})
                  </li>
                ))}
                {parsed.profiles.length > 5 && (
                  <li className="text-slate-500">
                    +{parsed.profiles.length - 5} additional profile(s)
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Restore Choice */}
          <fieldset className="space-y-2.5">
            <legend className="text-xs font-semibold text-slate-800">
              Choose how to restore this snapshot
            </legend>

            <label
              className={`flex items-start gap-2.5 p-3 rounded-md border cursor-pointer transition-colors ${
                restoreMode === 'new_profile'
                  ? 'border-teal-700 bg-teal-50/50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="snapshot-restore-mode"
                value="new_profile"
                checked={restoreMode === 'new_profile'}
                onChange={() => {
                  setRestoreMode('new_profile');
                  setConfirmOverwrite(false);
                }}
                className="mt-0.5 accent-teal-800"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <PlusCircle className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                  {isSingle
                    ? 'Import as New Profile (Recommended)'
                    : `Import ${parsed.profiles.length} Profiles as New Workspaces`}
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                  Assigns a unique workspace ID and switches to the imported profile. Existing
                  saved profiles, Test Persona, and Blank User remain completely untouched.
                </p>
              </div>
            </label>

            {canOverwrite && (
              <label
                className={`flex items-start gap-2.5 p-3 rounded-md border cursor-pointer transition-colors ${
                  restoreMode === 'overwrite_active'
                    ? 'border-amber-500 bg-amber-50/60'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="snapshot-restore-mode"
                  value="overwrite_active"
                  checked={restoreMode === 'overwrite_active'}
                  onChange={() => setRestoreMode('overwrite_active')}
                  className="mt-0.5 accent-amber-700"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    Overwrite Current Active Profile
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                    Replaces inputs, schedules, PTE elections, and payment records inside{' '}
                    <span className="font-semibold text-slate-900">
                      &ldquo;{activeProfile.name}&rdquo;
                    </span>{' '}
                    in place. Test Persona, Blank User, and all other saved profiles stay
                    isolated.
                  </p>
                </div>
              </label>
            )}

            {workspaceMode !== 'my_profile' && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                Testing mode ({workspaceMode === 'test_persona' ? 'Test Persona' : 'Blank User'})
                is protected from overwrites. Importing will add this snapshot as a new saved
                profile in <span className="font-semibold text-slate-800">My Profile</span> and
                switch to it cleanly.
              </div>
            )}
          </fieldset>

          {canOverwrite && restoreMode === 'overwrite_active' && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmOverwrite}
                onChange={(e) => setConfirmOverwrite(e.target.checked)}
                className="mt-0.5 accent-amber-700"
              />
              <span className="leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 inline mr-1 -mt-0.5" />
                I confirm replacing the current state of{' '}
                <span className="font-semibold">&ldquo;{activeProfile.name}&rdquo;</span> with
                this snapshot.
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={restoreMode === 'overwrite_active' && !confirmOverwrite}
            className={`px-4 py-1.5 text-xs font-semibold text-white rounded-md transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
              restoreMode === 'overwrite_active'
                ? 'bg-amber-700 hover:bg-amber-800'
                : 'bg-teal-800 hover:bg-teal-900'
            }`}
          >
            {restoreMode === 'overwrite_active'
              ? 'Overwrite Active Profile'
              : isSingle
              ? 'Import as New Profile'
              : `Import ${parsed.profiles.length} Profiles`}
          </button>
        </div>
      </form>
    </div>
  );
};
