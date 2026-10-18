// src/components/ActionMenu.tsx
// A small pop-up menu opened from a button (the "⋯" on a chat or project, the Share and Settings buttons).
// The menu is drawn on document.body so the sidebar's scrolling area cannot cut it off.

import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./icons";
import type { IconProps } from "./icons";

export interface MenuAction {
  label: string;
  icon?: ComponentType<IconProps>;
  onSelect: () => void;
  destructive?: boolean; // shown in red, for deleting
  checked?: boolean; // shows a tick, for choices like the theme
}

interface ActionMenuProps {
  label: string; // what screen readers hear for the button and the menu
  actions: MenuAction[];
  heading?: string; // small grey title above the items
  buttonClassName: string;
  children: ReactNode; // what the button shows (an icon, or an icon and text)
  placement?: "below" | "above"; // "above" for buttons at the bottom of the screen
}

const MENU_WIDTH = 224;

export default function ActionMenu({
  label,
  actions,
  heading,
  buttonClassName,
  children,
  placement = "below",
}: ActionMenuProps) {
  // Where the menu is drawn, or null while it is closed.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // While open: Escape, a click elsewhere, resizing or scrolling closes it.
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    // Move keyboard focus into the menu so arrow-free Tab navigation works.
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pos]);

  // Opens the menu next to the button, kept inside the window.
  function toggle() {
    if (pos) return setPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    const height = actions.length * 38 + (heading ? 30 : 0) + 12;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const fitsBelow = r.bottom + 6 + height <= window.innerHeight;
    const top = placement === "above" || !fitsBelow ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    setPos({ top, left });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className={buttonClassName}
      >
        {children}
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} role="menu" aria-label={label} className="action-menu" style={pos}>
            {heading && <p className="action-menu-heading">{heading}</p>}
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  type="button"
                  role={a.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={a.checked}
                  className={a.destructive ? "action-menu-item destructive" : "action-menu-item"}
                  onClick={() => {
                    setPos(null);
                    a.onSelect();
                  }}
                >
                  {Icon && <Icon />}
                  <span className="action-menu-label">{a.label}</span>
                  {a.checked && <CheckIcon className="action-menu-check" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
