import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Check,
  ChevronDown,
  FolderKanban,
  Plus,
  Search,
  User,
} from 'lucide-react';
import type { TaxProfileRecord } from '../types/tax';
import {
  getFilingStatusShortLabel,
  getProfileEntitySummary,
} from '../engine/profileStore';

interface ProfileSwitcherProps {
  profiles: TaxProfileRecord[];
  activeProfile: TaxProfileRecord;
  onSwitchProfile: (profileId: string) => void;
  onOpenNewProfile: () => void;
  onOpenManageProfiles: () => void;
}

export const ProfileSwitcher: React.FC<ProfileSwitcherProps> = ({
  profiles,
  activeProfile,
  onSwitchProfile,
  onOpenNewProfile,
  onOpenManageProfiles,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
    }
  }, [open]);

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const entityLabel = getProfileEntitySummary(p).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.entity_name.toLowerCase().includes(q) ||
        p.entity_ein.toLowerCase().includes(q) ||
        entityLabel.includes(q) ||
        String(p.state.setup.current_tax_year).includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [profiles, query]);

  const activeEntitySummary = getProfileEntitySummary(activeProfile);
  const activeTaxYear = activeProfile.state.setup.current_tax_year;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 max-w-[260px] sm:max-w-[360px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50/80 hover:bg-slate-100/80 hover:border-slate-300 transition-colors text-left"
      >
        <div className="w-6 h-6 rounded bg-teal-800 text-white flex items-center justify-center shrink-0">
          {activeProfile.state.setup.has_scorp ? (
            <Briefcase className="w-3.5 h-3.5" />
          ) : (
            <User className="w-3.5 h-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900 truncate leading-tight">
            {activeProfile.name}
          </div>
          <div className="text-[11px] text-slate-500 truncate leading-tight font-mono">
            {activeEntitySummary} · {getFilingStatusShortLabel(activeProfile.state.setup.filing_status)} · {activeTaxYear}
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Switch tax profile"
          className="absolute left-0 mt-1.5 w-[320px] sm:w-[380px] bg-white border border-slate-200 rounded-lg shadow-lg z-40 overflow-hidden"
        >
          <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-700">
              Saved Profiles ({profiles.length})
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenNewProfile();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-white bg-teal-800 rounded hover:bg-teal-900 transition-colors"
            >
              <Plus className="w-3 h-3" />
              New Profile
            </button>
          </div>

          {profiles.length >= 3 && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search profiles, entities, EIN, or tax year..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100" role="listbox">
            {filteredProfiles.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-slate-500">
                No profiles match &ldquo;{query}&rdquo;.
              </div>
            ) : (
              filteredProfiles.map((profile) => {
                const isActive = profile.id === activeProfile.id;
                const summary = getProfileEntitySummary(profile);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onSwitchProfile(profile.id);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left flex items-start justify-between gap-2.5 transition-colors ${
                      isActive ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-semibold truncate ${
                            isActive ? 'text-teal-950' : 'text-slate-900'
                          }`}
                        >
                          {profile.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                        {summary} · {getFilingStatusShortLabel(profile.state.setup.filing_status)} · TY{' '}
                        {profile.state.setup.current_tax_year}
                        {profile.state.setup.has_scorp && profile.entity_ein
                          ? ` · EIN ${profile.entity_ein}`
                          : ''}
                      </div>
                    </div>
                    {isActive && (
                      <span className="mt-0.5 text-teal-800 shrink-0" aria-label="Active profile">
                        <Check className="w-4 h-4" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="p-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenManageProfiles();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5 text-slate-500" />
              Manage Profiles, Backups &amp; Setup
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
