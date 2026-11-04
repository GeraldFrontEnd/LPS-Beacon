// src/components/TooltipLayer.tsx
// One tooltip for the whole app: any element with a title="..." shows it in a readable bubble instead of the
// browser's small native tooltip. Mounted once in App.tsx, so every existing and future title gets it with no
// change to the page that sets it.
//
// How it works: when the pointer (or keyboard focus) reaches an element with a title, the title is moved to
// data-tip (which stops the native tooltip from also appearing) and copied to aria-description (so screen readers
// still read it). After a short delay the bubble appears above the element, or below it when there is no room,
// kept inside the window. It hides when the pointer leaves, on scroll, on a click or on Escape. Line breaks in a
// title ("\n") are kept.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 250;
const GAP = 8; // between the element and the bubble
const MARGIN = 8; // between the bubble and the window edge

interface Tip {
  text: string;
  anchor: DOMRect;
}

function tipTarget(node: EventTarget | null): HTMLElement | SVGElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest("[title], [data-tip]");
  if (!el || !(el instanceof HTMLElement || el instanceof SVGElement)) return null;
  const title = el.getAttribute("title");
  if (title !== null) {
    // Take over the title (the page may set a new one later: it is picked up again the next time).
    el.removeAttribute("title");
    if (title.trim()) {
      el.setAttribute("data-tip", title);
      if (!el.hasAttribute("aria-description")) el.setAttribute("aria-description", title);
    }
  }
  return el.getAttribute("data-tip") ? el : null;
}

export default function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const current = useRef<Element | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const bubble = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
      setPlace(null);
    };
    const show = (event: Event) => {
      const el = tipTarget(event.target);
      if (el === current.current) return;
      window.clearTimeout(timer.current);
      current.current = el;
      if (!el) {
        setTip(null);
        setPlace(null);
        return;
      }
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        setPlace(null);
        setTip({ text: el.getAttribute("data-tip") ?? "", anchor: el.getBoundingClientRect() });
      }, SHOW_DELAY_MS);
    };
    const leave = (event: PointerEvent) => {
      const to = event.relatedTarget;
      if (current.current && to instanceof Node && current.current.contains(to)) return;
      if (!(to instanceof Element) || !to.closest("[title], [data-tip]")) hide();
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && hide();
    document.addEventListener("pointerover", show, true);
    document.addEventListener("pointerout", leave, true);
    document.addEventListener("focusin", show, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("pointerover", show, true);
      document.removeEventListener("pointerout", leave, true);
      document.removeEventListener("focusin", show, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Place the bubble once it is drawn and its size is known: above the element, else below; inside the window.
  useEffect(() => {
    if (!tip || !bubble.current) return;
    const box = bubble.current.getBoundingClientRect();
    const a = tip.anchor;
    const centre = a.left + a.width / 2;
    const left = Math.min(Math.max(centre - box.width / 2, MARGIN), window.innerWidth - box.width - MARGIN);
    const below = a.top - GAP - box.height < MARGIN;
    const top = below ? a.bottom + GAP : a.top - GAP - box.height;
    const arrow = Math.min(Math.max(centre - left, 14), box.width - 14);
    setPlace({ left, top, below, arrow });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      className={`tip-bubble${place?.below ? " below" : ""}`}
      role="tooltip"
      style={{
        left: place?.left ?? -9999,
        top: place?.top ?? -9999,
        visibility: place ? "visible" : "hidden",
        ["--tip-arrow" as string]: `${place?.arrow ?? 0}px`,
      }}
    >
      {tip.text}
    </div>,
    document.body
  );
}
