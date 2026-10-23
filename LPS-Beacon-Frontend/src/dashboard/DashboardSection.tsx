// src/dashboard/DashboardSection.tsx
// One section of the Dashboard ("Capacity plan", "Sales pipeline", ...), drawn as a box whose heading opens and
// closes it. Closed, only the heading row of the box shows.
// Which sections are closed is remembered in this browser only (a convenience; nothing is lost without it).
// The page's "Expand all" / "Collapse all" buttons reach every section through setAllDashboardSections()
// (sectionState.ts).

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TOGGLE_ALL_EVENT, readClosed, rememberClosed } from "./sectionState";

interface Props {
  id: string; // stable, used to remember whether it is closed
  title: ReactNode; // the clickable part of the heading
  aside?: ReactNode; // extra text after the title (e.g. "· headcount as of ...")
  children: ReactNode;
}

export default function DashboardSection({ id, title, aside, children }: Props) {
  const [open, setOpen] = useState(() => !readClosed().has(id));

  useEffect(() => {
    const onToggleAll = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setOpen(next);
      rememberClosed(id, !next);
    };
    window.addEventListener(TOGGLE_ALL_EVENT, onToggleAll);
    return () => window.removeEventListener(TOGGLE_ALL_EVENT, onToggleAll);
  }, [id]);

  function toggle() {
    setOpen((was) => {
      rememberClosed(id, was);
      return !was;
    });
  }

  const bodyId = `dashboard-section-${id}`;
  return (
    <section className={`dashboard-section${open ? "" : " closed"}`}>
      <h2 className="dashboard-heading">
        {/* The whole heading row is the button, so a closed box opens wherever it is clicked. */}
        <button type="button" className="dashboard-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="dashboard-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span>
            {title}
            {aside}
          </span>
        </button>
      </h2>
      {/* Charts are only drawn while open, so a closed section costs nothing. */}
      <div id={bodyId} className="dashboard-section-body" hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
