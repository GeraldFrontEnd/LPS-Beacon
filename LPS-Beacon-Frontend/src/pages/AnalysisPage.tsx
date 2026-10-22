// src/pages/AnalysisPage.tsx
// Shows the capacity plan the system generates. Cells that hold an input (see isEditableCell) can be edited;
// everything else is calculated by the system and shown as it comes back.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BANDS,
  FISCAL_YEARS,
  PLAN_COLUMNS,
  PLAN_SECTIONS,
  actualMonthKeys,
  isActualColumn,
  isEditableCell,
  maxFor,
  rowId,
} from "../analysis/capacityPlanLayout";
import type { PlanColumn, PlanSection, ValueFormat } from "../analysis/capacityPlanLayout";
import { downloadCapacityPlan } from "../analysis/exportCapacityPlan";
import { formatPlanValue, parseInputText, toInputText } from "../analysis/formatPlanValue";
import { clearMyCapacityPlanEdits, getCapacityPlan, saveCapacityPlanEdit } from "../api/client";
import type { CapacityPlan, CapacityPlanEdit, CellEditInfo } from "../api/types";
import { useAuth } from "../auth/useAuth";
import Dialog from "../components/Dialog";

// Sections that have band rows underneath them, so they can be opened and closed.
const EXPANDABLE_IDS = PLAN_SECTIONS.filter((s) => s.bands).map((s) => s.id);

// One column on screen. A collapsed financial year shows a single empty "stub" column in place of its 12 months.
interface ColumnSlot {
  kind: "column";
  column: PlanColumn;
  blockStart: boolean; // the first column of a block (a year's months, or its quarters) gets a strong line on its left
  quarterStart: boolean; // the first month of Jul, Oct and Jan gets a thin line on its left
}
interface StubSlot {
  kind: "stub";
  fiscalYear: string;
}
type Slot = ColumnSlot | StubSlot;

// The columns to show, in order: for each financial year its months (or the stub), then its quarters and year total.
function buildSlots(collapsedYears: Set<string>): Slot[] {
  const slots: Slot[] = [];
  for (const fy of FISCAL_YEARS) {
    const months = PLAN_COLUMNS.filter((c) => c.fiscalYear === fy && c.kind === "month");
    const totals = PLAN_COLUMNS.filter((c) => c.fiscalYear === fy && c.kind !== "month");
    if (collapsedYears.has(fy)) {
      slots.push({ kind: "stub", fiscalYear: fy });
    } else {
      months.forEach((column, i) => slots.push({ kind: "column", column, blockStart: i === 0, quarterStart: i > 0 && i % 3 === 0 }));
    }
    totals.forEach((column, i) => slots.push({ kind: "column", column, blockStart: i === 0, quarterStart: false }));
  }
  return slots;
}

function edgeClass(slot: ColumnSlot): string | undefined {
  if (slot.blockStart) return "plan-block-start";
  if (slot.quarterStart) return "plan-quarter-start";
  return undefined;
}

// An edit box. It is "uncontrolled": the browser holds what is typed, and the box is rebuilt (through its key)
// whenever the saved value changes or a save fails. The change is sent when the person leaves the box or presses Enter.
function EditableCell({
  value,
  format,
  max,
  label,
  disabled,
  resetCount,
  canReset,
  onCommit,
}: {
  value: number | null | undefined;
  format: ValueFormat;
  max?: number;
  label: string;
  disabled: boolean;
  resetCount: number;
  canReset: boolean; // the cell was changed by someone: clearing the box puts the calculated value back
  onCommit: (value: number | null) => void;
}) {
  const original = toInputText(value, format);
  return (
    <input
      key={`${original}-${resetCount}`}
      className="plan-input"
      type="text"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      defaultValue={original}
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
        if (text === "" && canReset) {
          onCommit(null); // back to the value the system works out
          return;
        }
        const parsed = parseInputText(text, format, max);
        if (parsed === null) {
          e.currentTarget.value = original; // not acceptable: put the old value back
          return;
        }
        onCommit(parsed);
      }}
    />
  );
}

export default function AnalysisPage() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetCount, setResetCount] = useState(0); // bumped after a failed save, to put the old values back in the boxes
  const [confirmClear, setConfirmClear] = useState(false); // "Clear my edits?" dialog
  const [status, setStatus] = useState<string | null>(null); // a short message after clearing
  // Which sections currently show their band rows. Everything starts open, like the template.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set(EXPANDABLE_IDS));
  // Which financial years have their monthly columns hidden. Everything starts open.
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(() => new Set());

  // Load the plan once when the page opens (and again if the token changes).
  useEffect(() => {
    let cancelled = false; // ignore the result if the user already left the page
    getCapacityPlan(token ?? undefined)
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the capacity plan.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function toggleIn(setter: typeof setExpandedRows, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function clearMine() {
    setSaving(true);
    setError(null);
    try {
      const result = await clearMyCapacityPlanEdits(token ?? undefined);
      setPlan(result);
      setStatus(`${result.cleared ?? 0} of your changes removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear your changes.");
    } finally {
      setSaving(false);
    }
  }

  async function commitEdit(edit: CapacityPlanEdit) {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      setPlan(await saveCapacityPlanEdit(edit, token ?? undefined)); // the backend sends back the recalculated plan
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the change.");
      setResetCount((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  const values = plan?.values ?? {};
  const planIsEmpty = plan !== null && Object.keys(plan.values).length === 0;
  const slots = buildSlots(collapsedYears);
  const actualKeys = actualMonthKeys(plan);
  const edited = plan?.edited ?? {};
  const myEditCount = Object.values(edited).filter((e) => e.mine).length;

  // The cells of one row, one per column on screen.
  function rowCells(section: PlanSection, band?: { id: string; label: string }) {
    const id = rowId(section.id, band?.id);
    const format = band ? section.bandFormat ?? section.format : section.format;
    return slots.map((slot) => {
      if (slot.kind === "stub") return <td key={`stub-${slot.fiscalYear}`} className="plan-stub plan-block-start" />;
      const { column } = slot;
      const value = values[id]?.[column.key];
      const editable = !planIsEmpty && isEditableCell(section.id, band?.id, column);
      const change = edited[`${id}|${column.key}`];
      const classes = [edgeClass(slot), change ? "plan-edited" : undefined].filter(Boolean).join(" ") || undefined;
      return (
        <td key={column.key} className={classes} title={change ? changedBy(change) : undefined}>
          {editable ? (
            <EditableCell
              value={value}
              format={format}
              max={maxFor(section.id)}
              label={`${section.label}${band ? `, ${band.label}` : ""}, ${column.label}`}
              disabled={saving}
              resetCount={resetCount}
              canReset={!!change}
              onCommit={(v) => commitEdit({ rowId: id, columnKey: column.key, value: v })}
            />
          ) : (
            formatPlanValue(value, format)
          )}
        </td>
      );
    });
  }

  return (
    <main className="analysis-page">
      <header className="page-header">
        <h1>Analysis</h1>
        <p>
          Capacity plan generated by the system, in {plan?.currency ?? "USD"}. Cells with a blue frame are inputs you can
          edit; the rest are calculated. Changes are shared with everyone and marked with an orange corner; clear an
          edited box to go back to the calculated value.
        </p>
      </header>

      <div className="analysis-toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={!plan || planIsEmpty}
          onClick={() => plan && downloadCapacityPlan(plan)}
        >
          Download
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={saving || myEditCount === 0}
          onClick={() => setConfirmClear(true)}
          title="Remove every change you made. Other people's changes stay."
        >
          Clear my edits{myEditCount > 0 ? ` (${myEditCount})` : ""}
        </button>
        {saving && <span className="analysis-status">Saving…</span>}
        {!saving && status && (
          <span className="analysis-status" role="status">
            {status}
          </span>
        )}
        <span className="analysis-toolbar-spacer" />
        {/* Rows: the band rows under each metric. Columns: the monthly columns of each financial year. */}
        <button type="button" className="secondary-button" onClick={() => setExpandedRows(new Set(EXPANDABLE_IDS))}>
          Expand all rows
        </button>
        <button type="button" className="secondary-button" onClick={() => setCollapsedYears(new Set())}>
          Expand all columns
        </button>
        <button type="button" className="secondary-button" onClick={() => setExpandedRows(new Set())}>
          Collapse all rows
        </button>
        <button type="button" className="secondary-button" onClick={() => setCollapsedYears(new Set(FISCAL_YEARS))}>
          Collapse all columns
        </button>
      </div>

      {error && (
        <p className="error-banner analysis-banner" role="alert">
          {error}
        </p>
      )}
      {!plan && !error && <p className="note analysis-banner">Loading…</p>}
      {plan?.notes && plan.notes.length > 0 && (
        <details className="review-notes analysis-banner">
          <summary>
            {plan.notes.length} note{plan.notes.length === 1 ? "" : "s"} about this plan
          </summary>
          <ul>
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {planIsEmpty && (
        <p className="note analysis-banner">
          No capacity plan has been generated yet. The fields will fill in once the system has processed the uploaded files.
        </p>
      )}

      {plan && (
        <div className="plan-scroll">
          <table className="plan-table">
            <caption className="visually-hidden">Capacity plan by month, quarter and financial year</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="plan-label">
                  Metric
                </th>
                {FISCAL_YEARS.map((fy) => {
                  const collapsed = collapsedYears.has(fy);
                  const monthCount = PLAN_COLUMNS.filter((c) => c.fiscalYear === fy && c.kind === "month").length;
                  const totalCount = PLAN_COLUMNS.filter((c) => c.fiscalYear === fy && c.kind !== "month").length;
                  return [
                    <th key={`${fy}-months`} scope="colgroup" colSpan={collapsed ? 1 : monthCount} className="plan-fy plan-block-start">
                      <button
                        type="button"
                        className="plan-toggle"
                        aria-expanded={!collapsed}
                        title={`${collapsed ? "Show" : "Hide"} the monthly columns of ${fy}`}
                        onClick={() => toggleIn(setCollapsedYears, fy)}
                      >
                        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
                        {fy}
                      </button>
                    </th>,
                    <th key={`${fy}-totals`} scope="colgroup" colSpan={totalCount} className="plan-fy-blank plan-block-start" />,
                  ];
                })}
              </tr>
              <tr>
                {slots.map((slot) =>
                  slot.kind === "stub" ? (
                    <th key={`stub-${slot.fiscalYear}`} scope="col" className="plan-stub plan-block-start" />
                  ) : (
                    <th key={slot.column.key} scope="col" className={edgeClass(slot)}>
                      {slot.column.label}
                      {slot.column.kind === "month" && (
                        <span className={`plan-col-kind${isActualColumn(slot.column, actualKeys) ? " actual" : ""}`}>
                          {isActualColumn(slot.column, actualKeys) ? "Actual" : "Forecast"}
                        </span>
                      )}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {PLAN_SECTIONS.map((section) => {
                const isOpen = expandedRows.has(section.id);
                return [
                  <tr key={section.id} className="plan-section">
                    <th scope="row" className="plan-label">
                      {section.bands ? (
                        <button
                          type="button"
                          className="plan-toggle"
                          aria-expanded={isOpen}
                          onClick={() => toggleIn(setExpandedRows, section.id)}
                        >
                          <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                          {section.label}
                        </button>
                      ) : (
                        <span className="plan-toggle-spacer">{section.label}</span>
                      )}
                    </th>
                    {rowCells(section)}
                  </tr>,
                  ...(section.bands && isOpen
                    ? BANDS.map((band) => (
                        <tr key={`${section.id}:${band.id}`} className="plan-band">
                          <th scope="row" className="plan-label">
                            {band.label}
                          </th>
                          {rowCells(section, band)}
                        </tr>
                      ))
                    : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Rendered on <body>, like the other dialogs. */}
      {confirmClear &&
        createPortal(
          <Dialog
            title="Clear your changes?"
            body={`This removes the ${myEditCount} cell${myEditCount === 1 ? "" : "s"} you changed and puts the calculated values back. Changes made by other people stay.`}
            confirmLabel="Clear my edits"
            destructive
            onConfirm={() => void clearMine()}
            onClose={() => setConfirmClear(false)}
          />,
          document.body
        )}
    </main>
  );
}

// The tooltip of an edited cell: who changed it, and when.
function changedBy(change: CellEditInfo): string {
  const who = change.mine ? "you" : change.byName || "another user";
  const when = change.at
    ? new Date(change.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  return `Changed by ${who}${when ? ` on ${when}` : ""}`;
}
