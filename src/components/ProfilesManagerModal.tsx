import React, { useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Check,
  Copy,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  EntityType,
  FilingStatus,
  NewProfileOptions,
  ProfileModuleFlags,
  TaxProfileRecord,
} from '../types/tax';
import {
  OPTIONAL_PROFILE_MODULES,
  getActiveOptionalModules,
  getFilingStatusShortLabel,
  getProfileEntitySummary,
} from '../engine/profileStore';

interface ProfilesManagerModalProps {
  profiles: TaxProfileRecord[];
  activeProfileId: string;
  initialMode?: 'list' | 'create';
  onClose: () => void;
  onSwitchProfile: (profileId: string) => void;
  onCreateProfile: (options: NewProfileOptions) => void;
  onDuplicateProfile: (profileId: string) => void;
  onRenameProfile: (
    profileId: string,
    updates: { name: string; entity_name?: string; entity_ein?: string; notes?: string }
  ) => void;
  onDeleteProfile: (profileId: string) => void;
  onExportSingleProfile: (profile: TaxProfileRecord) => void;
  onExportAllProfiles: () => void;
  onImportProfilesJson: (rawText: string) => { ok: boolean; message: string };
}

type ProfileFilter = 'all' | 'scorp' | 'core_1040' | 'multistate' | 'retirement';

const DEFAULT_MODULES: ProfileModuleFlags = {
  has_scorp: false,
  has_ss_medicare: false,
  has_dbp: false,
  multi_state_active: false,
  has_stock_basis: false,
};

export const ProfilesManagerModal: React.FC<ProfilesManagerModalProps> = ({
  profiles,
  activeProfileId,
  initialMode = 'list',
  onClose,
  onSwitchProfile,
  onCreateProfile,
  onDuplicateProfile,
  onRenameProfile,
  onDeleteProfile,
  onExportSingleProfile,
  onExportAllProfiles,
  onImportProfilesJson,
}) => {
  const [mode, setMode] = useState<'list' | 'create'>(initialMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ProfileFilter>('all');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEntityName, setEditEntityName] = useState('');
  const [editEntityEin, setEditEntityEin] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Inline delete confirmation state (no window.confirm)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // New Profile form state
  const [newName, setNewName] = useState('');
  const [newFilingStatus, setNewFilingStatus] = useState<FilingStatus>('married_filing_jointly');
  const [newTaxYear, setNewTaxYear] = useState<number>(2026);
  const [newPrimaryName, setNewPrimaryName] = useState('');
  const [newSpouseName, setNewSpouseName] = useState('');
  const [newEntityType, setNewEntityType] = useState<EntityType>('none');
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityEin, setNewEntityEin] = useState('');
  const [newEntityWebsite, setNewEntityWebsite] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newTemplate, setNewTemplate] = useState<'blank' | 'sample_oss'>('blank');
  const [newModules, setNewModules] = useState<ProfileModuleFlags>({ ...DEFAULT_MODULES });

  const importFileRef = useRef<HTMLInputElement | null>(null);

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return profiles.filter((p) => {
      if (filter === 'scorp' && !p.state.setup.has_scorp) return false;
      if (filter === 'core_1040' && p.state.setup.has_scorp) return false;
      if (
        filter === 'multistate' &&
        !p.state.setup.multi_state_active &&
        !p.state.setup.residency_change_active &&
        !p.state.setup.has_pte
      ) {
        return false;
      }
      if (
        filter === 'retirement' &&
        !p.state.setup.has_dbp &&
        !p.state.setup.has_401k_or_ira
      ) {
        return false;
      }
      if (!q) return true;
      const entitySummary = getProfileEntitySummary(p).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.entity_name.toLowerCase().includes(q) ||
        p.entity_ein.toLowerCase().includes(q) ||
        entitySummary.includes(q) ||
        String(p.state.setup.current_tax_year).includes(q) ||
        p.state.setup.primary_name.toLowerCase().includes(q) ||
        p.state.setup.spouse_name.toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [profiles, searchQuery, filter]);

  const startInlineEdit = (profile: TaxProfileRecord) => {
    setConfirmDeleteId(null);
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditEntityName(profile.entity_name);
    setEditEntityEin(profile.entity_ein);
    setEditNotes(profile.notes ?? '');
  };

  const commitInlineEdit = (profileId: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setStatusBanner({ type: 'error', text: 'Profile name cannot be empty.' });
      return;
    }
    onRenameProfile(profileId, {
      name: trimmed,
      entity_name: editEntityName.trim(),
      entity_ein: editEntityEin.trim(),
      notes: editNotes.trim(),
    });
    setEditingId(null);
    setStatusBanner({ type: 'success', text: `Updated profile "${trimmed}".` });
  };

  const handleToggleNewModule = (key: keyof ProfileModuleFlags, checked: boolean) => {
    setNewModules((prev) => {
      const next = { ...prev, [key]: checked };
      if (key === 'has_scorp') {
        if (checked) {
          setNewEntityType('scorp_llc');
          next.has_stock_basis = true;
        } else {
          setNewEntityType('none');
        }
      }
      return next;
    });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedName =
      newName.trim() ||
      newEntityName.trim() ||
      (newPrimaryName.trim()
        ? `${newPrimaryName.trim()}${
            newFilingStatus === 'married_filing_jointly' && newSpouseName.trim()
              ? ` & ${newSpouseName.trim()}`
              : ''
          } (${newTaxYear})`
        : `Client Profile ${profiles.length + 1}`);

    onCreateProfile({
      name: resolvedName,
      filing_status: newFilingStatus,
      primary_name: newPrimaryName.trim() || 'Primary',
      spouse_name:
        newFilingStatus === 'married_filing_jointly'
          ? newSpouseName.trim() || 'Spouse'
          : '',
      tax_year: newTaxYear,
      entity_type: newModules.has_scorp
        ? newEntityType === 'none'
          ? 'scorp_llc'
          : newEntityType
        : newEntityType,
      entity_name: newEntityName.trim(),
      entity_ein: newEntityEin.trim(),
      entity_website: newEntityWebsite.trim(),
      notes: newNotes.trim(),
      template: newTemplate,
      modules: newModules,
    });
    onClose();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = onImportProfilesJson(text);
      setStatusBanner({
        type: result.ok ? 'success' : 'error',
        text: result.message,
      });
    };
    reader.onerror = () => {
      setStatusBanner({ type: 'error', text: 'Could not read the selected JSON file.' });
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profiles-manager-title"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={importFileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFileChange}
          className="hidden"
        />

        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            <h2 id="profiles-manager-title" className="text-base font-bold text-slate-900">
              {mode === 'create'
                ? 'Create New Tax Profile'
                : `Tax Profiles & Client Workspaces (${profiles.length})`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'create'
                ? 'Start from Form 1040 Core and enable only the tax & planning modules needed for this profile.'
                : 'Each profile maintains completely isolated tax schedules, ledger imports, payee aliases, assumptions, and CPA exports.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mode === 'list' ? (
              <>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  Import JSON
                </button>
                <button
                  type="button"
                  onClick={onExportAllProfiles}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Export All ({profiles.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatusBanner(null);
                    setMode('create');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Profile
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setMode('list')}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
              >
                Back to Saved Profiles ({profiles.length})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close profiles manager"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusBanner && (
          <div
            className={`px-5 py-2 text-xs border-b flex items-center justify-between gap-2 shrink-0 ${
              statusBanner.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Body */}
        {mode === 'list' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Search & Filter Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by profile name, client, entity, EIN, notes, or tax year..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(
                  [
                    { id: 'all', label: `All (${profiles.length})` },
                    {
                      id: 'scorp',
                      label: `S-Corp (${profiles.filter((p) => p.state.setup.has_scorp).length})`,
                    },
                    {
                      id: 'core_1040',
                      label: `1040 Core (${profiles.filter((p) => !p.state.setup.has_scorp).length})`,
                    },
                    {
                      id: 'multistate',
                      label: `Multi-State (${
                        profiles.filter(
                          (p) =>
                            p.state.setup.multi_state_active ||
                            p.state.setup.residency_change_active ||
                            p.state.setup.has_pte
                        ).length
                      })`,
                    },
                    {
                      id: 'retirement',
                      label: `DBP/Ret (${
                        profiles.filter(
                          (p) => p.state.setup.has_dbp || p.state.setup.has_401k_or_ira
                        ).length
                      })`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                      filter === tab.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Profile List */}
            {filteredProfiles.length === 0 ? (
              <div className="border border-dashed border-slate-300 rounded-lg p-8 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  No profiles match your search or filter.
                </p>
                <p className="text-xs text-slate-500">
                  Clear your search filter or create a new client/personal profile.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
                {filteredProfiles.map((profile) => {
                  const isActive = profile.id === activeProfileId;
                  const isEditing = editingId === profile.id;
                  const isConfirmingDelete = confirmDeleteId === profile.id;
                  const activeModules = getActiveOptionalModules(profile.state.setup);
                  const txCount = profile.state.cadence_forecaster?.transactions?.length ?? 0;

                  return (
                    <div
                      key={profile.id}
                      className={`p-4 transition-colors ${
                        isActive ? 'bg-teal-50/40' : 'bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                Profile Name
                              </label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                Entity / Account Name (Used on Reports)
                              </label>
                              <input
                                type="text"
                                value={editEntityName}
                                onChange={(e) => setEditEntityName(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                EIN (Optional)
                              </label>
                              <input
                                type="text"
                                value={editEntityEin}
                                onChange={(e) => setEditEntityEin(e.target.value)}
                                placeholder="XX-XXXXXXX"
                                className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                Client Notes / Code (Optional)
                              </label>
                              <input
                                type="text"
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                placeholder="e.g., Client #104 · Multi-state plan"
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => commitInlineEdit(profile.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900"
                            >
                              Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="w-6 h-6 rounded bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                                {profile.state.setup.has_scorp ? (
                                  <Briefcase className="w-3.5 h-3.5 text-teal-800" />
                                ) : (
                                  <User className="w-3.5 h-3.5 text-slate-600" />
                                )}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {profile.name}
                              </span>
                              {isActive && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-teal-800 text-white rounded">
                                  <Check className="w-3 h-3" /> Active
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-600 font-mono flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-8">
                              <span>{getProfileEntitySummary(profile)}</span>
                              <span className="text-slate-300">·</span>
                              <span>
                                {getFilingStatusShortLabel(profile.state.setup.filing_status)}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span>
                                Window {profile.state.setup.forecast_years[0]}–
                                {profile.state.setup.forecast_years[5]} (TY{' '}
                                {profile.state.setup.current_tax_year})
                              </span>
                              {profile.state.setup.has_scorp && profile.entity_ein && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span>EIN {profile.entity_ein}</span>
                                </>
                              )}
                              {profile.state.setup.has_scorp && txCount > 0 && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span>{txCount} ledger rows</span>
                                </>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 pl-8 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-slate-700">Modules:</span>
                              <span>Form 1040 Core</span>
                              {activeModules.map((m) => (
                                <span key={m.key} className="text-slate-600">
                                  + {m.shortLabel}
                                </span>
                              ))}
                              {profile.notes && (
                                <span className="text-slate-400 italic">· {profile.notes}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pl-8 lg:pl-0 shrink-0">
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSwitchProfile(profile.id);
                                  onClose();
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors"
                              >
                                Switch
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startInlineEdit(profile)}
                              title="Rename profile or edit entity details"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
                            >
                              <Pencil className="w-3.5 h-3.5 text-slate-400" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onDuplicateProfile(profile.id);
                                setStatusBanner({
                                  type: 'success',
                                  text: `Duplicated "${profile.name}" into a new isolated profile.`,
                                });
                              }}
                              title="Duplicate profile with isolated data"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
                            >
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                              Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => onExportSingleProfile(profile)}
                              title="Export JSON backup for this profile"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
                            >
                              <Download className="w-3.5 h-3.5 text-slate-400" />
                              JSON
                            </button>

                            {isConfirmingDelete ? (
                              <div className="inline-flex items-center gap-1 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                                <span className="text-[11px] font-medium text-red-800">
                                  Delete?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteProfile(profile.id);
                                    setConfirmDeleteId(null);
                                    setStatusBanner({
                                      type: 'success',
                                      text: `Deleted profile "${profile.name}".`,
                                    });
                                  }}
                                  className="px-2 py-0.5 text-[11px] font-semibold text-white bg-red-700 rounded hover:bg-red-800"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setConfirmDeleteId(profile.id);
                                }}
                                title="Delete profile"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:border-red-200"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Create New Profile Form */
          <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Step 1: Basic Profile Info */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Profile &amp; Taxpayer Identity
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Profile Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Smith Household — Apex Advisory LLC"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Filing Status
                    </label>
                    <select
                      value={newFilingStatus}
                      onChange={(e) => setNewFilingStatus(e.target.value as FilingStatus)}
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="married_filing_jointly">Married Filing Jointly</option>
                      <option value="single">Single</option>
                      <option value="head_of_household">Head of Household</option>
                      <option value="married_filing_separately">Married Filing Separately</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Active Tax Year
                    </label>
                    <input
                      type="number"
                      min={2022}
                      max={2035}
                      value={newTaxYear}
                      onChange={(e) => setNewTaxYear(Number(e.target.value) || 2026)}
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Primary Taxpayer Name
                  </label>
                  <input
                    type="text"
                    value={newPrimaryName}
                    onChange={(e) => setNewPrimaryName(e.target.value)}
                    placeholder="Primary"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                {newFilingStatus === 'married_filing_jointly' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Spouse Name
                    </label>
                    <input
                      type="text"
                      value={newSpouseName}
                      onChange={(e) => setNewSpouseName(e.target.value)}
                      placeholder="Spouse"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Client Notes / Reference (Optional)
                    </label>
                    <input
                      type="text"
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      placeholder="e.g., Client #204"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Checkbox-Driven Module Setup */}
            <div className="space-y-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    2. Module Setup (Form 1040 Core + Optional Modules)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Every profile starts with lightweight Form 1040 Core. Check only the modules you want enabled; you can toggle any box later without losing saved data.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 bg-white">
                {/* Base Form 1040 Core (always checked) */}
                <div className="p-3.5 bg-slate-50/80 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                      Form 1040 Core (Included Baseline)
                      <span className="text-[10px] font-mono text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                        Always Active
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Personal W-2 &amp; investment income, standard/itemized deductions, federal tax brackets, safe harbor estimates, and Six-Year Horizon.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    disabled
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 opacity-70 shrink-0"
                  />
                </div>

                {/* Optional Modules */}
                {OPTIONAL_PROFILE_MODULES.map((mod) => {
                  const checked = newModules[mod.key];
                  return (
                    <div key={mod.key} className="p-3.5">
                      <label className="flex items-start justify-between gap-4 cursor-pointer">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">{mod.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{mod.description}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => handleToggleNewModule(mod.key, e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
                        />
                      </label>

                      {mod.key === 'has_scorp' && checked && (
                        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-700 mb-1">
                              Business / S-Corp Entity Name
                            </label>
                            <input
                              type="text"
                              value={newEntityName}
                              onChange={(e) => setNewEntityName(e.target.value)}
                              placeholder="e.g., Apex Advisory Group, LLC"
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-700 mb-1">
                              Entity EIN (Optional)
                            </label>
                            <input
                              type="text"
                              value={newEntityEin}
                              onChange={(e) => setNewEntityEin(e.target.value)}
                              placeholder="XX-XXXXXXX"
                              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-700 mb-1">
                              Business Website (Optional)
                            </label>
                            <input
                              type="text"
                              value={newEntityWebsite}
                              onChange={(e) => setNewEntityWebsite(e.target.value)}
                              placeholder="e.g., apexadvisory.com"
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:border-teal-700 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Starting Data Template */}
            <div className="space-y-2.5 pt-4 border-t border-slate-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Starting Data Template
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    newTemplate === 'blank'
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="profile_template"
                      checked={newTemplate === 'blank'}
                      onChange={() => setNewTemplate('blank')}
                      className="mt-0.5 text-teal-700 focus:ring-teal-700"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Clean Slate (Recommended)
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Zeroed schedule, empty ledger, and isolated aliases ready for a new client or personal return.
                      </div>
                    </div>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    newTemplate === 'sample_oss'
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="profile_template"
                      checked={newTemplate === 'sample_oss'}
                      onChange={() => setNewTemplate('sample_oss')}
                      className="mt-0.5 text-teal-700 focus:ring-teal-700"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Pre-Populated Demo Baseline
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Loads sample 6-year numbers and ledger transactions for testing or client walkthroughs.
                      </div>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Footer Submit */}
            <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode('list')}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 rounded-md hover:bg-teal-900 transition-colors"
              >
                Create &amp; Switch to Profile
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
