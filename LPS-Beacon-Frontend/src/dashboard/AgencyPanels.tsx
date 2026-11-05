// src/dashboard/AgencyPanels.tsx
// "HC (Details)": headcount details by agency, under the header cards (Hwee Yu's layout, 4 Nov 2026). One panel per
// agency in the last month of the period: FTE as sold, as planned and actual side by side, the total actual cost and
// ADR, its projects (ADR is worked out by project), and the list of its people with name, skill, band and salary
// scale. With an agency picked in the filter only that agency shows; with a project, only that project.
//   As sold        business case (Bcase): no source file yet, shown as "–"
//   As planned     SL x RP man-days ÷ 18 (the PM's plan)
//   Actual         billable days clocked in MSPO ÷ 18; a forecast month has none
//   Total actual cost   clocked days × rate card (iRate) by band, as on the Analysis page (pipeline hcCost)
//   ADR            revenue ÷ billable days clocked (baseline.ts adr): actual months only
//   Skill          the standardised position, until the files carry a per-person skill
//   Salary scale   H / M / L: no salary source yet, shown as "–"
// The people come from GET /dashboard (lambda-api agency_panels, from results/capacity/roster.json). Names are on
// it: the Dashboard is Finance/HR only.

import { useMemo, useState } from "react";
import type { AgencyPanel, AgencyPanels as Panels, CapacityPlan, ProductivityFigures } from "../api/types";
import { adr, fmt, monthName } from "../analysis/baseline";

const SHOWN = 6;
const RED_BELOW = 15.3;
const RED_ABOVE = 18;
const TYPE: Record<string, string> = { permanent: "Permanent", secondment: "Secondment", other: "Supplemental" };

function Fte({ label, value, how }: { label: string; value: string; how: string }) {
  return (
    <div className="hcd-fte" title={how}>
      <span className="hcd-fte-label">{label}</span>
      <span className="hcd-fte-box">{value}</span>
    </div>
  );
}

function Panel({
  panel,
  money,
  month,
  clocked,
  pending,
}: {
  panel: AgencyPanel;
  money: (key: string, kind: "agency" | "project") => { revenue: number | null; cost: number | null; adr: number | null };
  month: string;
  clocked: boolean;
  pending: Panels["pending"];
}) {
  const totals = money(panel.agency, "agency");
  const outside = panel.people.filter(
    (p) => p.clockedDaysAllProjects != null && (p.clockedDaysAllProjects < RED_BELOW || p.clockedDaysAllProjects > RED_ABOVE)
  ).length;
  return (
    <article className="hcd-panel" aria-label={panel.agency}>
      <header className="hcd-head">
        <div className="hcd-ftes">
          <Fte label="As sold" value={fmt.dec1(panel.asSoldFte)} how={`FTE in the business case (Bcase). ${pending.asSold}.`} />
          <Fte label="As planned" value={fmt.dec1(panel.planFte)} how={`PM's plan: ${fmt.dec1(panel.planDays)} man-days ÷ 18`} />
          <Fte
            label="Actual"
            value={fmt.dec1(panel.actualFte)}
            how={clocked ? `Clocked in MSPO: ${fmt.dec1(panel.actualDays)} billable days ÷ 18` : "Not clocked yet (forecast month)"}
          />
        </div>
        <dl className="hcd-money">
          <div title="Billable days clocked × rate card (iRate) of each person's band">
            <dt>Total actual cost</dt>
            <dd>{fmt.usd(totals.cost)}</dd>
          </div>
          <div title="Average daily revenue: revenue ÷ billable days clocked = monthly revenue ÷ (FTE actual × 18)">
            <dt>ADR</dt>
            <dd>{totals.adr === null ? "–" : `${fmt.usd(totals.adr)}/day`}</dd>
          </div>
        </dl>
      </header>
      <h4 className="hcd-agency">{panel.agency}</h4>

      <table className="people-table hcd-projects">
        <caption className="hcd-caption">
          {panel.projects.length} project{panel.projects.length === 1 ? "" : "s"} in {monthName(month)}
        </caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col" className="num">HC</th>
            <th scope="col" className="num" title="Business case (Bcase): no source yet">As sold</th>
            <th scope="col" className="num" title="Planned man-days ÷ 18">As planned</th>
            <th scope="col" className="num" title="Billable days clocked ÷ 18">Actual</th>
            <th scope="col" className="num" title="ABCD revenue that month">Revenue</th>
            <th scope="col" className="num" title="Revenue ÷ billable days clocked = monthly revenue ÷ (FTE actual × 18)">ADR</th>
          </tr>
        </thead>
        <tbody>
          {panel.projects.map((pr) => {
            const m = money(pr.projectId, "project");
            return (
              <tr key={pr.projectId}>
                <th scope="row">
                  {pr.name ?? pr.projectId}
                  <span className="people-sub">{pr.projectId}</span>
                </th>
                <td className="num">{fmt.int(pr.headcount)}</td>
                <td className="num">{fmt.dec1(pr.asSoldFte)}</td>
                <td className="num">{fmt.dec1(pr.planFte)}</td>
                <td className="num">{fmt.dec1(pr.actualFte)}</td>
                <td className="num">{fmt.usd(m.revenue)}</td>
                <td className="num">{fmt.usd(m.adr)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="hcd-people-scroll">
        <table className="people-table">
          <caption className="hcd-caption">
            List of employees: {panel.headcount}
            {outside > 0 && <span className="people-flag"> · {outside} outside 15.3 to 18 days</span>}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" title="Standardised position (no per-person skill in the files yet)">Skill</th>
              <th scope="col" className="num">Band</th>
              <th scope="col" title={`High / Medium / Low within the band. ${pending.salaryScale}.`}>Salary scale</th>
              <th scope="col" className="num" title="Man-days planned on this agency's projects">Planned days</th>
              <th scope="col" className="num" title="Billable days clocked to this agency's projects">Clocked days</th>
              <th scope="col" className="num" title="Clocked days ÷ 18">FTE</th>
              <th scope="col" className="num" title="Billable days clocked on all their projects that month. Red below 15.3 or above 18">
                All projects
              </th>
            </tr>
          </thead>
          <tbody>
            {panel.people.map((p, i) => {
              const all = p.clockedDaysAllProjects;
              const red = all != null && (all < RED_BELOW || all > RED_ABOVE);
              return (
                <tr key={`${p.name}-${i}`}>
                  <th scope="row">
                    {p.name ?? "–"}
                    <span className="people-sub">
                      {[p.employment ? TYPE[p.employment] ?? null : null, p.projects > 1 ? `${p.projects} projects` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  <td>{p.skill ?? "–"}</td>
                  <td className="num">{p.band ?? "–"}</td>
                  <td>{p.salaryScale ?? "–"}</td>
                  <td className="num">{fmt.dec1(p.planDays)}</td>
                  <td className="num">{clocked ? fmt.dec1(p.actualDays) : "–"}</td>
                  <td className="num">{clocked ? fmt.dec1(p.actualFte) : "–"}</td>
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
    </article>
  );
}

export default function AgencyPanels({ panels, plan }: { panels: Panels | undefined; plan: CapacityPlan }) {
  const [showAll, setShowAll] = useState(false);

  // Revenue, cost and ADR of an agency or project in the panels' month, from the Analysis figures (byMonth).
  const money = useMemo(() => {
    const p = plan.productivity;
    const agencies = new Map<string, ProductivityFigures>();
    const projects = new Map<string, ProductivityFigures>();
    for (const a of p?.agencies ?? []) {
      agencies.set(a.agency, a);
      for (const pr of a.projects) projects.set(pr.projectId, pr);
    }
    const month = panels?.month ?? "";
    const usable = !!p && p.clocked !== false && p.months.includes(month);
    return (key: string, kind: "agency" | "project") => {
      const cell = usable ? (kind === "agency" ? agencies : projects).get(key)?.byMonth?.[month] : undefined;
      return {
        revenue: cell ? cell.revenue : null,
        cost: cell ? cell.hcCost : null,
        adr: cell ? adr({ [month]: cell }, [month]) : null,
      };
    };
  }, [plan, panels?.month]);

  if (!panels) return <p className="note">Loading the headcount details…</p>;
  if (!panels.month || !panels.agencies.length)
    return <p className="note">Nobody is planned or clocked on any project{panels.month ? ` in ${monthName(panels.month)}` : ""}.</p>;

  const shown = showAll ? panels.agencies : panels.agencies.slice(0, SHOWN);
  return (
    <div className="hcd">
      <p className="hcd-note">
        {monthName(panels.month)}
        {panels.clocked ? "" : " · forecast month: plan only, nothing clocked yet"} · As sold and salary scale are
        waiting for their source files.
      </p>
      {shown.map((a) => (
        <Panel key={a.agency} panel={a} money={money} month={panels.month!} clocked={panels.clocked} pending={panels.pending} />
      ))}
      {panels.agencies.length > SHOWN && (
        <button type="button" className="secondary-button people-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${panels.agencies.length} agencies`}
        </button>
      )}
    </div>
  );
}
