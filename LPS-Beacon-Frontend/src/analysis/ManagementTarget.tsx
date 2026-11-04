// src/analysis/ManagementTarget.tsx (shown on the Analysis page, below the agencies)
// Management target vs actual (4 Nov 2026 meeting): Finance's P&L summary for one fiscal year, the full year with the
// four quarters beside it.
//
//   Full year   last fiscal year, management target (MT), this fiscal year (actual + forecast), YoY (this year − last
//               year) and vs MT (this year − MT)
//   Quarters    MT, actual + forecast, vs MT
//
// The MT column (full year and each quarter) is a set figure from management: every line is typed in, nothing is
// worked out or filled from the files, and it starts blank (4 Nov 2026).
// In the other columns people type the lines no file has (cost of sales, staff cost, opex); the page works out the
// formula lines the same way Finance's sheet does:
//   Gross staff cost  = perm + secondment staff cost          Net staff cost = gross staff cost + staff cost transfer
//   GP                = revenue + COS + net staff cost        GP %           = GP ÷ revenue
//   Total delivery HC = secondment + permanent                avg staff cost = staff cost ÷ HC (and per perm / sec)
//   Revenue per HC, GP per HC (quarters annualised x 4)       Revenue ÷ gross staff cost
//   PCON              = GP + opex                             PCON %         = PCON ÷ revenue
// Costs are negative, as on the sheet. What the files give is filled in when nobody typed a value (shown in grey
// italics): revenue (ABCD, actual + forecast) and average delivery HC (capacity plan) for this year; average HC and
// gross staff cost for last year (MBR headcount file, plan_settings.priorYear). Typed values are shared
// (plan/management_target.json on the backend) and override what the files give.

import { useMemo } from "react";
import { PLAN_COLUMNS } from "./capacityPlanLayout";
import type { CapacityPlan, ManagementTargetCell, ManagementTargetEdit } from "../api/types";

type Period = "FY" | "Q1" | "Q2" | "Q3" | "Q4";
type Column = "prior" | "mt" | "current";
type Unit = "usdM" | "usdK" | "int" | "pct" | "ratio";

interface Row {
  id: string;
  label: string;
  unit: Unit;
  input?: boolean; // typed in; the others are worked out
  strong?: boolean;
  indent?: boolean;
  italic?: boolean;
  gapBefore?: boolean;
  boxed?: boolean; // the ratios Finance boxes on its sheet
  better?: "up"; // YoY / vs MT above zero is good (green), below is bad (red)
}

const ROWS: Row[] = [
  {
    id: "revenue",
    label: "Revenue",
    unit: "usdM",
    input: true,
    strong: true,
    better: "up",
  },
  { id: "cos", label: "COS", unit: "usdM", input: true },
  {
    id: "gross-staff-cost",
    label: "Gross staff cost",
    unit: "usdM",
    gapBefore: true,
  },
  {
    id: "perm-staff-cost",
    label: "Perm staff cost",
    unit: "usdM",
    input: true,
    indent: true,
    italic: true,
  },
  {
    id: "secondment-staff-cost",
    label: "Secondment staff cost",
    unit: "usdM",
    input: true,
    indent: true,
    italic: true,
  },
  {
    id: "staff-cost-transfer",
    label: "Staff cost transfer (project time)",
    unit: "usdM",
    input: true,
  },
  { id: "net-staff-cost", label: "Net staff cost", unit: "usdM", strong: true },
  {
    id: "third-party-cost",
    label: "Third party cost",
    unit: "usdM",
    input: true,
    gapBefore: true,
  },
  {
    id: "gp",
    label: "GP",
    unit: "usdM",
    strong: true,
    gapBefore: true,
    better: "up",
  },
  { id: "gp-pct", label: "GP %", unit: "pct", better: "up" },
  {
    id: "hc-secondment",
    label: "Delivery secondment HC",
    unit: "int",
    input: true,
    gapBefore: true,
  },
  {
    id: "hc-permanent",
    label: "Delivery permanent HC",
    unit: "int",
    input: true,
  },
  { id: "hc-total", label: "Total delivery HC", unit: "int", strong: true },
  {
    id: "avg-staff-cost",
    label: "Avg gross staff cost (delivery HC)",
    unit: "usdK",
    boxed: true,
    gapBefore: true,
  },
  {
    id: "avg-perm-cost",
    label: "Avg gross staff cost (permanent HC)",
    unit: "usdK",
    boxed: true,
  },
  {
    id: "avg-sec-cost",
    label: "Avg gross staff cost (secondment HC)",
    unit: "usdK",
    boxed: true,
  },
  {
    id: "revenue-per-hc",
    label: "Revenue per HC",
    unit: "usdK",
    boxed: true,
    better: "up",
  },
  {
    id: "gp-per-hc",
    label: "GP per HC",
    unit: "usdK",
    boxed: true,
    better: "up",
  },
  {
    id: "revenue-per-staff-cost",
    label: "Revenue ÷ gross staff cost",
    unit: "ratio",
    boxed: true,
  },
  { id: "opex", label: "Opex", unit: "usdM", input: true, gapBefore: true },
  {
    id: "pcon",
    label: "PCON",
    unit: "usdM",
    strong: true,
    gapBefore: true,
    better: "up",
  },
  { id: "pcon-pct", label: "PCON %", unit: "pct", better: "up" },
];

const QUARTERS: Period[] = ["Q1", "Q2", "Q3", "Q4"];

type Values = Record<string, number | null>;
interface Resolved {
  value: number | null;
  source: "typed" | "file" | "formula" | null;
  title?: string;
}

const sum = (...xs: (number | null)[]) =>
  xs.some((x) => x === null) ? null : xs.reduce<number>((t, x) => t + (x as number), 0);
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);

// Works out every line of one column (period + a / b / c) from the typed lines and the file defaults.
function resolveColumn(typed: Values, defaults: Record<string, { value: number; title: string }>, annualise: number) {
  const out: Record<string, Resolved> = {};
  const pick = (id: string): Resolved => {
    if (typed[id] !== undefined && typed[id] !== null) return { value: typed[id], source: "typed" };
    const d = defaults[id];
    return d ? { value: d.value, source: "file", title: d.title } : { value: null, source: null };
  };
  const formula = (id: string, value: number | null): Resolved => {
    if (value !== null) return { value, source: "formula" };
    return pick(id); // components missing: what the files give for the line itself, if anything
  };
  for (const r of ROWS) if (r.input) out[r.id] = pick(r.id);
  const v = (id: string) => out[id]?.value ?? null;
  out["gross-staff-cost"] = formula("gross-staff-cost", sum(v("perm-staff-cost"), v("secondment-staff-cost")));
  out["net-staff-cost"] = formula("net-staff-cost", sum(v("gross-staff-cost"), v("staff-cost-transfer")));
  out["gp"] = formula("gp", sum(v("revenue"), v("cos"), v("net-staff-cost")));
  out["gp-pct"] = formula("gp-pct", div(v("gp"), v("revenue")));
  out["hc-total"] = formula("hc-total", sum(v("hc-secondment"), v("hc-permanent")));
  const yearly = (x: number | null) => (x === null ? null : x * annualise);
  out["avg-staff-cost"] = formula("avg-staff-cost", yearly(div(v("gross-staff-cost"), v("hc-total"))));
  out["avg-perm-cost"] = formula("avg-perm-cost", yearly(div(v("perm-staff-cost"), v("hc-permanent"))));
  out["avg-sec-cost"] = formula("avg-sec-cost", yearly(div(v("secondment-staff-cost"), v("hc-secondment"))));
  out["revenue-per-hc"] = formula("revenue-per-hc", yearly(div(v("revenue"), v("hc-total"))));
  out["gp-per-hc"] = formula("gp-per-hc", yearly(div(v("gp"), v("hc-total"))));
  out["revenue-per-staff-cost"] = formula("revenue-per-staff-cost", div(v("revenue"), v("gross-staff-cost")));
  out["pcon"] = formula("pcon", sum(v("gp"), v("opex")));
  out["pcon-pct"] = formula("pcon-pct", div(v("pcon"), v("revenue")));
  return out;
}

const m2 = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const k1 = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const i0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function show(value: number | null, unit: Unit, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "";
  const sign = signed && value > 0 ? "+" : value < 0 ? "−" : "";
  const a = Math.abs(value);
  switch (unit) {
    case "usdM":
      return sign + m2.format(a / 1e6);
    case "usdK":
      return sign + k1.format(a / 1e3);
    case "int":
      return sign + i0.format(a);
    case "pct":
      return sign + k1.format(a * 100) + (signed ? " pts" : "%");
    case "ratio":
      return sign + m2.format(a);
  }
}

// Typed in the unit the table shows: USD M, USD K (per HC), percent, a plain ratio, or people.
function inputText(value: number | null, unit: Unit): string {
  if (value === null) return "";
  switch (unit) {
    case "usdM":
      return String(Number((value / 1e6).toFixed(4)));
    case "usdK":
      return String(Number((value / 1e3).toFixed(3)));
    case "pct":
      return String(Number((value * 100).toFixed(3)));
    default:
      return String(value);
  }
}

function parse(text: string, unit: Unit): number | null | "bad" {
  const t = text.replace(/[,\s$%]/g, "").replace("−", "-");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "bad";
  switch (unit) {
    case "int":
      return Number.isInteger(n) && n >= 0 ? n : "bad";
    case "usdM":
      return Math.round(n * 1e6);
    case "usdK":
      return Math.round(n * 1e3);
    case "pct":
      return n / 100;
    case "ratio":
      return n;
  }
}

// The MT column: what was typed, line by line, and nothing else.
function typedOnly(typed: Values): Record<string, Resolved> {
  const out: Record<string, Resolved> = {};
  for (const r of ROWS) {
    const v = typed[r.id];
    out[r.id] = v === undefined || v === null ? { value: null, source: null } : { value: v, source: "typed" };
  }
  return out;
}

function Cell({
  row,
  cell,
  editable,
  disabled,
  label,
  edit,
  onSave,
  first,
}: {
  first?: boolean; // the first cell of a block: a strong line on its left
  row: Row;
  cell: Resolved;
  editable: boolean;
  disabled: boolean;
  label: string;
  edit?: ManagementTargetCell;
  onSave: (value: number | null) => void;
}) {
  const cls = [
    first ? "plan-block-start" : undefined,
    cell.source === "file" ? "mt-from-file" : undefined,
    edit ? "plan-edited" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const who = edit ? `Typed by ${edit.mine ? "you" : edit.byName || "another user"}` : cell.title;
  if (!editable) {
    return (
      <td className={cls || undefined} title={who}>
        {show(cell.value, row.unit)}
      </td>
    );
  }
  const typed = cell.source === "typed" ? cell.value : null;
  const original = inputText(typed, row.unit);
  return (
    <td className={cls || undefined} title={who}>
      <input
        key={`${original}-${cell.value}`}
        className="plan-input mt-input"
        type="text"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        defaultValue={original}
        placeholder={cell.source === "file" ? show(cell.value, row.unit) : ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = original;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const text = e.currentTarget.value.trim();
          if (text === original) return;
          const parsed = parse(text, row.unit);
          if (parsed === "bad") {
            e.currentTarget.value = original;
            return;
          }
          onSave(parsed);
        }}
      />
    </td>
  );
}

export default function ManagementTarget({
  plan,
  fiscalYear,
  saving,
  onSave,
}: {
  plan: CapacityPlan;
  fiscalYear: string; // "FY'26", as the plan's columns name it
  saving: boolean;
  onSave: (edit: ManagementTargetEdit) => void;
}) {
  const fy = fiscalYear.replace("'", ""); // "FY26"
  const start = 2000 + Number(fy.slice(2)); // FY26 starts in April 2026
  const label = (y: number) => `FY${String(y).slice(2)}/${String(y + 1).slice(2)}`;
  const cells = useMemo(() => plan.managementTarget ?? {}, [plan.managementTarget]);

  const resolved = useMemo(() => {
    const months = PLAN_COLUMNS.filter((c) => c.fiscalYear === fiscalYear && c.kind === "month");
    const monthOfKey = Object.fromEntries((plan.months ?? []).map((m) => [m.key, m]));
    const values = plan.values;
    const typed = (period: Period, column: Column): Values => {
      const out: Values = {};
      for (const r of ROWS) {
        const c = cells[`${fy}|${period}|${column}|${r.id}`];
        if (c) out[r.id] = c.value;
      }
      return out;
    };
    // This year from the files: ABCD revenue (actual, then forecast) and the capacity plan's average Ending HC.
    const current = (period: Period) => {
      const keys = months.filter((c) => period === "FY" || `Q${c.quarter}` === period).map((c) => c.key);
      const actual = keys.filter((k) => monthOfKey[k]?.actual).length;
      const basis = `${actual} of ${keys.length} months actual, the rest forecast`;
      const d: Record<string, { value: number; title: string }> = {};
      const rev = keys.map((k) => values["revenue"]?.[k] ?? null);
      if (rev.every((x) => x !== null)) {
        d["revenue"] = {
          value: rev.reduce<number>((t, x) => t + (x as number), 0),
          title: `ABCD revenue (${basis})`,
        };
      }
      const hc = keys.map((k) => values["ending-hc"]?.[k] ?? null).filter((x): x is number => x !== null);
      if (hc.length === keys.length && hc.length) {
        d["hc-total"] = {
          value: Math.round(hc.reduce((t, x) => t + x, 0) / hc.length),
          title: `Average Ending HC on the capacity plan (${basis})`,
        };
      }
      return d;
    };
    // Last year: the MBR headcount file's average HC and gross staff cost (full year only), ABCD revenue if complete.
    const prior = () => {
      const d: Record<string, { value: number; title: string }> = {};
      const p = plan.settings?.[fy]?.priorYear;
      if (p) {
        d["hc-total"] = {
          value: p.averageHeadcount,
          title: `Average HC, ${p.source}`,
        };
        d["gross-staff-cost"] = {
          value: -p.staffCostUsd,
          title: `Gross staff cost, ${p.source}`,
        };
      }
      const byMonth = plan.revenueByMonth ?? {};
      const last = Array.from({ length: 12 }, (_, i) => {
        const d0 = new Date(start - 1, 3 + i, 1);
        return `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`;
      });
      if (last.every((m) => byMonth[m]?.revenue !== undefined)) {
        d["revenue"] = {
          value: last.reduce((t, m) => t + byMonth[m].revenue, 0),
          title: "ABCD revenue",
        };
      }
      return d;
    };
    const out: Record<string, Record<string, Resolved>> = {};
    for (const period of ["FY", ...QUARTERS] as Period[]) {
      const annualise = period === "FY" ? 1 : 4;
      out[`${period}|mt`] = typedOnly(typed(period, "mt"));
      out[`${period}|current`] = resolveColumn(typed(period, "current"), current(period), annualise);
      if (period === "FY") out[`FY|prior`] = resolveColumn(typed("FY", "prior"), prior(), 1);
    }
    return out;
  }, [plan, cells, fiscalYear, fy, start]);

  const diff = (a: Resolved | undefined, b: Resolved | undefined) =>
    a?.value === null || a?.value === undefined || b?.value === null || b?.value === undefined
      ? null
      : a.value - b.value;
  const tone = (row: Row, d: number | null) =>
    row.better && d !== null && Math.abs(d) > 1e-9 ? (d > 0 ? "mt-good" : "mt-bad") : undefined;

  const save = (period: Period, column: Column, rowId: string) => (value: number | null) =>
    onSave({ fiscalYear: fy, period, column, rowId, value });

  return (
    <table className="plan-table mt-table">
      <caption className="visually-hidden">
        Management target against actual, full year and quarters, {label(start)}
      </caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={2} className="plan-label">
            USD M · HC in people · per-HC in USD K
          </th>
          <th scope="colgroup" colSpan={5} className="plan-fy plan-block-start">
            Full year {label(start)}
          </th>
          {QUARTERS.map((q) => (
            <th key={q} scope="colgroup" colSpan={3} className="plan-fy plan-block-start">
              {q} {label(start)}
            </th>
          ))}
        </tr>
        <tr>
          <th scope="col" className="plan-block-start" title="Last fiscal year, actual">
            {label(start - 1)}
          </th>
          <th scope="col" title="Management target, set by management">
            MT
          </th>
          <th scope="col" title="This fiscal year: actual months, then forecast">
            Act + fcst
          </th>
          <th scope="col" title="Year on year: this year (actual + forecast) minus last year">
            YoY
          </th>
          <th scope="col" title="Against the target: this year (actual + forecast) minus the MT. Above zero = above target">
            vs MT
          </th>
          {QUARTERS.map((q) => [
            <th key={`${q}-mt`} scope="col" className="plan-block-start">
              MT
            </th>,
            <th key={`${q}-c`} scope="col">
              Act + fcst
            </th>,
            <th key={`${q}-d`} scope="col" title="This quarter (actual + forecast) minus the quarter's MT">
              vs MT
            </th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const fyMt = resolved["FY|mt"][row.id];
          const fyC = resolved["FY|current"][row.id];
          const fyA = resolved["FY|prior"][row.id];
          const yoy = diff(fyC, fyA);
          const vsMt = diff(fyC, fyMt);
          const classes = [
            row.strong ? "mt-strong" : undefined,
            row.gapBefore ? "mt-gap" : undefined,
            row.boxed ? "mt-boxed" : undefined,
          ]
            .filter(Boolean)
            .join(" ");
          const cellFor = (period: Period, column: Column, first = false) => (
            <Cell
              key={`${period}-${column}`}
              first={first}
              row={row}
              cell={resolved[`${period}|${column}`][row.id]}
              editable={column === "mt" || !!row.input}
              disabled={saving}
              label={`${row.label}, ${period === "FY" ? "full year" : period}, ${column === "mt" ? "MT" : column === "prior" ? "last year" : "actual and forecast"}`}
              edit={cells[`${fy}|${period}|${column}|${row.id}`]}
              onSave={save(period, column, row.id)}
            />
          );
          return (
            <tr key={row.id} className={classes || undefined}>
              <th
                scope="row"
                className={`plan-label${row.indent ? " mt-indent" : ""}${row.italic ? " mt-italic" : ""}`}
              >
                {row.label}
              </th>
              {cellFor("FY", "prior", true)}
              {cellFor("FY", "mt")}
              {cellFor("FY", "current")}
              <td className={tone(row, yoy)}>{show(yoy, row.unit, true)}</td>
              <td className={tone(row, vsMt)}>{show(vsMt, row.unit, true)}</td>
              {QUARTERS.map((q) => {
                const d = diff(resolved[`${q}|current`][row.id], resolved[`${q}|mt`][row.id]);
                return [
                  cellFor(q, "mt", true),
                  cellFor(q, "current"),
                  <td key={`${q}-d`} className={tone(row, d)}>
                    {show(d, row.unit, true)}
                  </td>,
                ];
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
