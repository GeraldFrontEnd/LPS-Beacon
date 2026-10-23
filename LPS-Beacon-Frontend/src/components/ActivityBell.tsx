// src/components/ActivityBell.tsx
// The bell on the top bar: who uploaded files, went through a review step or changed the capacity plan, and when.
// A red dot means someone else did something since you last opened it. Opening the list clears the dot on the
// server, so it stays cleared on your other devices too. The list is checked every minute while the tab is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { getActivity, markActivitySeen } from "../api/client";
import type { ActivityEvent, ActivityFeed } from "../api/types";
import { BellIcon } from "./icons";

const POLL_MS = 60_000;
const DETAILS_SHOWN = 3; // detail lines shown before "Show more"

// "just now", "5 min ago", "3 h ago", "yesterday", then the date.
function relativeTime(iso: string, now: number): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "yesterday";
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
}

export default function ActivityBell() {
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0); // when the list was last loaded, for "5 min ago"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getActivity();
      setFeed(next);
      setNow(Date.now());
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the activity");
      return null;
    }
  }, []);

  // First load, then every minute (and when the tab comes back into view) while the tab is visible.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // While open: Escape or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setExpanded(new Set());
    const latest = await load(); // the entries stay marked "new" while the list is open
    if (latest && latest.unseen > 0) {
      setFeed({ ...latest, unseen: 0 });
      markActivitySeen().catch(() => undefined); // the dot comes back on the next check; nothing else breaks
    }
  }

  function toggleDetails(id: string) {
    setExpanded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const unseen = feed?.unseen ?? 0;
  const label = unseen > 0 ? `Activity, ${unseen} new` : "Activity";

  function renderEvent(e: ActivityEvent) {
    const showAll = expanded.has(e.id);
    const details = showAll ? e.details : e.details.slice(0, DETAILS_SHOWN);
    const hidden = e.details.length - DETAILS_SHOWN;
    return (
      <li key={e.id} className={e.new ? "activity-item new" : "activity-item"}>
        <p className="activity-text">
          <span className="activity-who">{e.mine ? "You" : e.email}</span> {e.text}
        </p>
        {details.length > 0 && (
          <ul className="activity-details">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <button type="button" className="link-button activity-more" onClick={() => toggleDetails(e.id)}>
            {showAll ? "Show less" : `Show ${hidden} more`}
          </button>
        )}
        <p className="activity-meta">
          {e.area} · <time dateTime={e.at} title={fullTime(e.at)}>{relativeTime(e.at, now)}</time>
          {e.new && <span className="activity-new-tag">New</span>}
        </p>
      </li>
    );
  }

  return (
    <div className="activity" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="activity-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => void toggle()}
      >
        <BellIcon size={18} />
        {unseen > 0 && <span className="activity-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="activity-panel" role="dialog" aria-label="Recent activity">
          <div className="activity-head">
            <h2>Recent activity</h2>
            <span>Uploads, reviews and capacity plan changes, last 90 days</span>
          </div>
          {error && <p className="activity-empty">Could not load the activity. {error}</p>}
          {!feed && !error && <p className="activity-empty">Loading…</p>}
          {feed && feed.events.length === 0 && (
            <p className="activity-empty">Nothing yet. Uploads, reviews and capacity plan changes will show here.</p>
          )}
          {feed && feed.events.length > 0 && <ul className="activity-list">{feed.events.map(renderEvent)}</ul>}
        </div>
      )}
    </div>
  );
}
