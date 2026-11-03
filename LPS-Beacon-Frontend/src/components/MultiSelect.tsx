// src/components/MultiSelect.tsx
// A dropdown with a search box and a checkbox per option, for picking several items (e.g. agencies).
// Nothing ticked means "all". Closes on Escape or a click outside.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string; // extra text matched by the search (e.g. the agency's project IDs), not shown
  marker?: ReactNode; // shown before the label (e.g. a coloured status dot)
}

interface Props {
  label: string; // e.g. "Agencies"
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  allLabel?: string; // the button text when nothing is ticked, e.g. "All agencies"
  shortcuts?: { label: string; values: string[] }[]; // quick picks, e.g. "Only red"
}

export default function MultiSelect({ label, options, selected, onChange, allLabel = "All", shortcuts = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  const chosen = new Set(selected);
  const toggle = (v: string) => onChange(chosen.has(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const buttonText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} ${label.toLowerCase()}`;

  return (
    <div className="multiselect" ref={box}>
      <button type="button" className="multiselect-button" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <span className="multiselect-label">{label}</span>
        <span className="multiselect-value">{buttonText}</span>
        <span aria-hidden="true" className="multiselect-caret">▾</span>
      </button>
      {open && (
        <div className="multiselect-pop" role="dialog" aria-label={`Choose ${label.toLowerCase()}`}>
          <input
            className="multiselect-search"
            type="search"
            placeholder="Search by name or project ID"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="multiselect-actions">
            <button type="button" onClick={() => onChange([])}>
              {allLabel}
            </button>
            {query && (
              <button type="button" onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.value)])])}>
                Tick the {shown.length} found
              </button>
            )}
            {shortcuts.map((s) => (
              <button key={s.label} type="button" onClick={() => onChange(s.values)}>
                {s.label}
              </button>
            ))}
          </div>
          <ul className="multiselect-list" role="listbox" aria-multiselectable="true">
            {shown.map((o) => (
              <li key={o.value}>
                <label>
                  <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                  {o.marker}
                  <span>{o.label}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="note multiselect-empty">Nothing matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
