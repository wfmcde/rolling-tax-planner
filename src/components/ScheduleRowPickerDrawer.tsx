import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Search, X } from 'lucide-react';
import type { ScheduleViewConfig, SetupConfig } from '../types/tax';
import {
  ALL_SCHEDULE_ITEM_IDS,
  MASTER_SCHEDULE_CATALOG,
  SCHEDULE_SECTIONS,
  getScheduleRowLabel,
} from '../engine/scheduleCatalog';

interface ScheduleRowPickerPopoverProps {
  open: boolean;
  setup: SetupConfig;
  scheduleView: ScheduleViewConfig;
  hiddenRowIds: Set<string>;
  onChange: (next: ScheduleViewConfig) => void;
  onClose: () => void;
}

export const ScheduleRowPickerDrawer: React.FC<ScheduleRowPickerPopoverProps> = ({
  open,
  setup,
  scheduleView,
  hiddenRowIds,
  onChange,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open, onClose]);

  const normalizedQuery = query.trim().toLowerCase();

  const groupedSections = useMemo(() => {
    return SCHEDULE_SECTIONS.map((section) => {
      const allInSection = MASTER_SCHEDULE_CATALOG.filter((item) => item.section === section.id);
      const matched = normalizedQuery
        ? allInSection.filter(
            (item) =>
              getScheduleRowLabel(item, setup).toLowerCase().includes(normalizedQuery) ||
              item.code.toLowerCase().includes(normalizedQuery) ||
              section.shortTitle.toLowerCase().includes(normalizedQuery)
          )
        : allInSection;
      return {
        section,
        allInSection,
        matched,
      };
    }).filter((g) => g.matched.length > 0);
  }, [normalizedQuery, setup]);

  if (!open) return null;

  const commitHidden = (nextHidden: Set<string>) => {
    const orderedHidden = ALL_SCHEDULE_ITEM_IDS.filter((id) => nextHidden.has(id));
    onChange({
      ...scheduleView,
      preset: orderedHidden.length === 0 ? 'full' : 'custom',
      hidden_line_item_ids: orderedHidden,
    });
  };

  const handleToggleItem = (id: string) => {
    const next = new Set(hiddenRowIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    commitHidden(next);
  };

  const handleToggleSection = (sectionIds: string[], allVisible: boolean) => {
    const next = new Set(hiddenRowIds);
    for (const id of sectionIds) {
      if (allVisible) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
    commitHidden(next);
  };

  const handleShowAll = () => {
    onChange({
      ...scheduleView,
      preset: 'full',
      hidden_line_item_ids: [],
    });
  };

  const handleHideAll = () => {
    onChange({
      ...scheduleView,
      preset: 'custom',
      hidden_line_item_ids: [...ALL_SCHEDULE_ITEM_IDS],
    });
  };

  const totalCount = ALL_SCHEDULE_ITEM_IDS.length;
  const visibleCount = totalCount - hiddenRowIds.size;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Show or hide schedule rows"
      className="absolute right-0 top-full mt-2 z-40 w-[380px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col max-h-[70vh]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div>
          <div className="text-xs font-semibold text-slate-900">Show / Hide Schedule Rows</div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums">
            {visibleCount} of {totalCount} rows shown · Hidden rows still calculate
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close row visibility popover"
          className="p-1 text-slate-400 hover:text-slate-700 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search & Quick Actions */}
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 space-y-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter rows..."
            className="w-full rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleShowAll}
              className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
            >
              <Eye className="w-3 h-3" />
              Show All
            </button>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              onClick={handleHideAll}
              className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 hover:underline"
            >
              <EyeOff className="w-3 h-3" />
              Hide All
            </button>
          </div>
          {hiddenRowIds.size > 0 && (
            <span className="font-mono text-amber-700">{hiddenRowIds.size} hidden</span>
          )}
        </div>
      </div>

      {/* Grouped Checkboxes */}
      <div className="overflow-y-auto px-4 py-3 space-y-4">
        {groupedSections.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No rows match &ldquo;{query}&rdquo;.
          </div>
        ) : (
          groupedSections.map(({ section, allInSection, matched }) => {
            const sectionIds = allInSection.map((i) => i.id);
            const shownInSection = sectionIds.filter((id) => !hiddenRowIds.has(id)).length;
            const allShown = shownInSection === sectionIds.length;

            return (
              <div key={section.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-100">
                  <span className="text-[11px] font-semibold text-slate-800 truncate">
                    {section.shortTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleSection(sectionIds, allShown)}
                    className="text-[11px] font-medium text-teal-800 hover:underline whitespace-nowrap shrink-0"
                  >
                    {allShown ? 'Hide group' : 'Show group'}
                  </button>
                </div>

                <div className="space-y-0.5">
                  {matched.map((item) => {
                    const isVisible = !hiddenRowIds.has(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex items-center justify-between gap-2.5 py-1 px-1.5 -mx-1.5 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={() => handleToggleItem(item.id)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700 shrink-0"
                          />
                          <span
                            className={`text-xs truncate ${
                              isVisible ? 'text-slate-800' : 'text-slate-400 line-through'
                            }`}
                          >
                            {getScheduleRowLabel(item, setup)}
                          </span>
                        </span>
                        {item.editField && (
                          <span className="text-[10px] font-mono text-teal-700 shrink-0">
                            Input
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 shrink-0 rounded-b-lg">
        <span className="text-[11px] text-slate-500">Saved in Plan JSON</span>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 text-xs font-medium text-white bg-teal-800 rounded-md hover:bg-teal-900"
        >
          Done
        </button>
      </div>
    </div>
  );
};
