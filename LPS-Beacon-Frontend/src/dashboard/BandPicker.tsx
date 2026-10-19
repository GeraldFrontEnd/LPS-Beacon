// src/dashboard/BandPicker.tsx
// A drop-down list of checkboxes for choosing which bands a chart shows. At least one band stays selected.

import { useEffect, useRef, useState } from "react";
import { BANDS } from "../analysis/capacityPlanLayout";

interface Props {
  selected: string[]; // band ids, for example ["b7", "b6"]
  onChange: (selected: string[]) => void;
}

export default function BandPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // While open: Escape or a click elsewhere closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const all = selected.length === BANDS.length;
  const summary = all
    ? "All bands"
    : selected.length <= 2
      ? BANDS.filter((b) => selected.includes(b.id)).map((b) => b.label).join(", ")
      : `${selected.length} bands`;

  // Keep the bands in their usual order whatever order they were ticked in.
  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    onChange(BANDS.map((b) => b.id).filter((b) => next.includes(b)));
  }

  return (
    <div className="band-picker" ref={boxRef}>
      <button type="button" className="band-picker-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {summary} ▾
      </button>
      {open && (
        <div className="band-picker-menu" role="group" aria-label="Bands to show">
          <label className="band-picker-option">
            <input type="checkbox" checked={all} disabled={all} onChange={() => onChange(BANDS.map((b) => b.id))} />
            All bands
          </label>
          {BANDS.map((b) => {
            const checked = selected.includes(b.id);
            return (
              <label key={b.id} className="band-picker-option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && selected.length === 1}
                  onChange={() => toggle(b.id)}
                />
                {b.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
