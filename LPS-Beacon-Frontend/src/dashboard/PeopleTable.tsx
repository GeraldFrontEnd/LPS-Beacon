// src/dashboard/PeopleTable.tsx
// "Who is on it?" for the agency or project picked in the Dashboard's filter (4 Nov 2026): one row per person and
// project in the last month of the period (the same month the People card counts), with planned days (SL x RP),
// days clocked to that project (MSPO clocking) and their FTE. Days clocked on all their projects that month are
// red outside 15.3 to 18. A forecast month has no clocking yet, so it shows the plan only.
// The list comes from GET /dashboard?agency= or ?projectId= with &month= (lambda-api selection_people). Names are
// on it: the Dashboard is Finance/HR only.

import { useMemo, useState } from "react";
import type { DashboardPeople, DashboardPerson } from "../api/types";
import { fmt, monthName } from "../analysis/baseline";

type SortKey = "name" | "position" | "project" | "planDays" | "actualDays" | "clockedDaysAllProjects";
const PAGE = 50;
const RED_BELOW = 15.3;
const RED_ABOVE = 18;

const TYPE: Record<string, string> = { permanent: "Permanent", secondment: "Secondment", other: "Supplemental" };

function value(p: DashboardPerson, key: SortKey): string | number {
  switch (key) {
    case "project":
      return `${p.projectName ?? ""} ${p.projectId}`;
    case "name":
    case "position":
      return (p[key] ?? "").toLowerCase();
    default:
      return p[key] ?? -1;
  }
}

export default function PeopleTable({
  people,
  kind,
}: {
  people: DashboardPeople | undefined;
  kind: "agency" | "project";
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: "name", up: true });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = (people?.rows ?? []).filter(
      (p) =>
        !q ||
        [p.name, p.position, p.projectId, p.projectName].some((t) => (t ?? "").toLowerCase().includes(q))
    );
    const dir = sort.up ? 1 : -1;
    return [...found].sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [people, query, sort]);

  if (!people) return <p className="note">Loading the people…</p>;
  if (!people.rows.length)
    return (
      <p className="note">
        Nobody is planned or clocked on {kind === "agency" ? "its projects" : "this project"} in{" "}
        {people.month ? monthName(people.month) : "this month"}.
      </p>
    );

  const distinct = new Set(people.rows.map((p) => p.name ?? p.projectId + p.position));
  const projects = new Set(people.rows.map((p) => p.projectId));
  const outside = people.clocked
    ? [...new Map(people.rows.map((p) => [p.name, p.clockedDaysAllProjects])).values()].filter(
        (d) => d !== null && d !== undefined && (d < RED_BELOW || d > RED_ABOVE)
      ).length
    : 0;
  const shown = showAll ? rows : rows.slice(0, PAGE);

  const head = (key: SortKey, label: string, num = false, title?: string) => (
    <th scope="col" className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.up ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="people-sort"
        title={title}
        onClick={() => setSort((s) => ({ key, up: s.key === key ? !s.up : !num }))}
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.up ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="people">
      <div className="people-bar">
        <p className="people-summary">
          <strong>{distinct.size}</strong> {distinct.size === 1 ? "person" : "people"}
          {kind === "agency" && (
            <>
              {" "}on <strong>{projects.size}</strong> project{projects.size === 1 ? "" : "s"}
            </>
          )}{" "}
          in {people.month ? monthName(people.month) : "–"}
          {people.clocked ? (
            outside > 0 && (
              <>
                {" · "}
                <span className="people-flag">{outside} outside 15.3 to 18 days</span>
              </>
            )
          ) : (
            " · plan only (not clocked yet)"
          )}
        </p>
        <input
          className="people-search"
          type="search"
          placeholder="Search name, position or project"
          aria-label="Search the people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="people-scroll">
        <table className="people-table">
          <thead>
            <tr>
              {head("name", "Name")}
              {head("position", "Position")}
              {kind === "agency" && head("project", "Project")}
              {head("planDays", "Planned days", true, "Man-days planned on this project in the resource plan")}
              {head("actualDays", "Clocked days", true, "Billable days clocked to this project in MSPO")}
              <th scope="col" className="num" title="Clocked days ÷ 18">
                FTE
              </th>
              {head("clockedDaysAllProjects", "All projects", true, "Billable days clocked on all their projects that month. Red below 15.3 or above 18")}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const all = p.clockedDaysAllProjects;
              const red = all !== null && all !== undefined && (all < RED_BELOW || all > RED_ABOVE);
              return (
                <tr key={`${p.projectId}-${p.name}-${i}`}>
                  <th scope="row">
                    {p.name ?? "–"}
                    <span className="people-sub">
                      {[p.band ? `Band ${p.band}` : null, p.employment ? TYPE[p.employment] ?? null : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  <td>{p.position ?? "–"}</td>
                  {kind === "agency" && (
                    <td>
                      {p.projectName ?? p.projectId}
                      <span className="people-sub">{p.projectId}</span>
                    </td>
                  )}
                  <td className="num">{p.planDays ? fmt.dec1(p.planDays) : p.planDays === 0 ? "not planned" : "–"}</td>
                  {people.clocked && (all === null || all === undefined) ? (
                    <td className="num people-none" colSpan={2} title="Not on the clocking for this month">
                      not clocked
                    </td>
                  ) : (
                    <>
                      <td className="num">{fmt.dec1(p.actualDays)}</td>
                      <td className="num">{fmt.dec1(p.actualFte)}</td>
                    </>
                  )}
                  <td className={`num${red ? " people-red" : ""}`}
                    title={red ? (all! < RED_BELOW ? "Under-utilised: below 15.3 days" : "Over-utilised: above 18 days") : undefined}>
                    {fmt.dec1(all)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="note">Nobody matches “{query}”.</p>}
      {rows.length > PAGE && (
        <button type="button" className="secondary-button people-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
