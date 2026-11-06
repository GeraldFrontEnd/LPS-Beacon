// src/analysis/ProjectResources.tsx
// The people on one project, under its row on the Analysis page (5 Nov 2026: the resource list moved here from the
// Dashboard). One row per person in the last month of the period, all in FTE:
//   Position name     the standardised position
//   Salary scale      H / M / L: no salary source yet, shown as "–"
//   Planned FTE       their man-days on this project in the PM's plan ÷ 18
//   Actual FTE        billable days they clocked to this project ÷ 18 (a forecast month has none)
//   Average billable MD   billable man-days they clocked a month on all their projects; red below 15.3 or above 18
// Over a quarter or the year every figure is an average a month over the period's months (6 Nov 2026, Crislyn: one
// month swings with leave), from GET /dashboard ... &months=
// Loaded from GET /dashboard?agency=&projectId=&month=&people=1 when the row is opened. Names are on it: the page is
// Finance/HR only.

import { useEffect, useState } from "react";
import { getDashboardView } from "../api/client";
import type { AgencyPanelProject } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { fmt, monthName } from "./baseline";

const RED_BELOW = 15.3;
const RED_ABOVE = 18;
const TYPE: Record<string, string> = { permanent: "Permanent", secondment: "Secondment", other: "Supplemental" };

export default function ProjectResources({
  agency,
  projectId,
  month,
  months,
}: {
  agency: string;
  projectId: string;
  month: string; // the period's last month
  months: string[]; // the period's months: the figures are averaged a month over them
}) {
  const { token } = useAuth();
  // What was loaded, and for which project and month: a different key means it is still loading.
  const key = `${agency}|${projectId}|${months.join(",")}`;
  const [loaded, setLoaded] = useState<{ key: string; project: AgencyPanelProject | null; error: string | null } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    getDashboardView({ agency, projectId, month, months, people: true }, token ?? undefined)
      .then((v) => {
        if (cancelled) return;
        const found = v?.agencyPanels?.agencies.flatMap((a) => a.projects).find((p) => p.projectId === projectId);
        setLoaded({ key, project: found ?? null, error: null });
      })
      .catch(
        (err) =>
          !cancelled &&
          setLoaded({ key, project: null, error: err instanceof Error ? err.message : "Could not load the people." })
      );
    return () => {
      cancelled = true;
    };
  }, [agency, projectId, month, months, token, key]);

  const project = loaded?.key === key ? loaded.project : undefined;
  const error = loaded?.key === key ? loaded.error : null;
  if (error) return <p className="note">{error}</p>;
  if (project === undefined) return <p className="note">Loading the people…</p>;
  const people = project?.people ?? [];
  if (!people.length) return <p className="note">Nobody is planned or clocked on this project in {monthName(month)}.</p>;
  const outside = people.filter(
    (p) => p.clockedDaysAllProjects != null && (p.clockedDaysAllProjects < RED_BELOW || p.clockedDaysAllProjects > RED_ABOVE)
  ).length;

  return (
    <div className="res">
      <p className="res-summary">
        <strong>{people.length}</strong> {people.length === 1 ? "person" : "people"}{" "}
        {months.length > 1 ? `${monthName(months[0])} – ${monthName(month)}, average a month` : `in ${monthName(month)}`} ·
        As sold{" "}
        {fmt.dec1(project?.asSoldFte)} · As planned {fmt.dec1(project?.planFte)} · Actual {fmt.dec1(project?.actualFte)} FTE
        {outside > 0 && <span className="people-flag"> · {outside} outside 15.3 to 18 billable MD</span>}
      </p>
      <div className="res-scroll">
        <table className="people-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" title="Standardised position">Position name</th>
              <th scope="col" className="num">Band</th>
              <th scope="col" title="High / Medium / Low within the band. No salary source yet">Salary scale</th>
              <th scope="col" className="num" title="Their man-days on this project in the PM's plan ÷ 18">Planned FTE</th>
              <th scope="col" className="num" title="Billable days they clocked to this project ÷ 18">Actual FTE</th>
              <th scope="col" className="num" title="Billable man-days they clocked a month on all their projects, averaged over the period. Red below 15.3 or above 18">
                Average billable MD
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p, i) => {
              const all = p.clockedDaysAllProjects;
              const red = all != null && (all < RED_BELOW || all > RED_ABOVE);
              return (
                <tr key={`${p.name}-${i}`}>
                  <th scope="row">
                    {p.name ?? "–"}
                    {p.employment && TYPE[p.employment] && <span className="people-sub">{TYPE[p.employment]}</span>}
                  </th>
                  <td>{p.skill ?? "–"}</td>
                  <td className="num">{p.band ?? "–"}</td>
                  <td>{p.salaryScale ?? "–"}</td>
                  <td className="num">{fmt.dec1(p.planFte)}</td>
                  <td className="num">{fmt.dec1(p.actualFte)}</td>
                  <td
                    className={`num${red ? " people-red" : ""}`}
                    title={red ? (all! < RED_BELOW ? "Under-utilised: below 15.3 days" : "Over-utilised: above 18 days") : undefined}
                  >
                    {fmt.dec1(all)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
