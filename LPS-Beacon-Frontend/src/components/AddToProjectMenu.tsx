// src/components/AddToProjectMenu.tsx
// The "+" button at the bottom left of the prompt box. It opens a small menu with "Add to project ›";
// hovering (or clicking) that row opens a second list with every project folder from the sidebar.
// Picking a folder files the open chat there (or, for a chat not sent yet, the chat it is about to become).

import { useEffect, useRef, useState } from "react";
import type { Project } from "../chats/useChatHistory";
import { CheckIcon, ChevronRightIcon, FolderIcon, FolderPlusIcon, PlusIcon } from "./icons";

interface AddToProjectMenuProps {
  projects: Project[];
  currentProjectId: string | null; // the folder the chat is in now (gets a tick), or null
  onSelect: (projectId: string) => void;
  onCreateProject: () => void; // "New project": asks for a name, then files the chat there
}

export default function AddToProjectMenu({
  projects,
  currentProjectId,
  onSelect,
  onCreateProject,
}: AddToProjectMenuProps) {
  const [open, setOpen] = useState(false); // the first menu
  const [subOpen, setSubOpen] = useState(false); // the list of projects
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setSubOpen(false);
  }

  // While open: Escape or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Opening the project list from the keyboard moves focus into it.
  function openSubFromKeyboard() {
    setSubOpen(true);
    requestAnimationFrame(() => subRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  return (
    // stopPropagation: a click in here must not focus the text box behind it (see MessageInput's prompt-box).
    <div className="add-menu" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className="add-button"
        aria-label="Add to project"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <PlusIcon size={20} />
      </button>

      {open && (
        <div className="add-menu-panel" role="menu" aria-label="Add">
          {/* The row and its project list share one wrapper, so moving the mouse from one to the other keeps it open. */}
          <div className="add-menu-row" onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
            <button
              type="button"
              role="menuitem"
              className="action-menu-item"
              aria-haspopup="menu"
              aria-expanded={subOpen}
              onClick={() => (subOpen ? setSubOpen(false) : openSubFromKeyboard())}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  openSubFromKeyboard();
                }
              }}
            >
              <FolderIcon />
              <span className="action-menu-label">Add to project</span>
              <ChevronRightIcon className="add-menu-chevron" />
            </button>

            {subOpen && (
              <div
                ref={subRef}
                className="add-menu-panel add-menu-sub"
                role="menu"
                aria-label="Projects"
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setSubOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="action-menu-item"
                  onClick={() => {
                    close();
                    onCreateProject();
                  }}
                >
                  <FolderPlusIcon />
                  <span className="action-menu-label">New project</span>
                </button>
                {projects.length > 0 && <hr className="add-menu-divider" />}
                <div className="add-menu-list">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={p.id === currentProjectId}
                      className="action-menu-item"
                      title={p.name}
                      onClick={() => {
                        close();
                        if (p.id !== currentProjectId) onSelect(p.id);
                      }}
                    >
                      <span className="sidebar-folder-icon">
                        <FolderIcon />
                      </span>
                      <span className="action-menu-label">{p.name}</span>
                      {p.id === currentProjectId && <CheckIcon className="action-menu-check" />}
                    </button>
                  ))}
                </div>
                {projects.length === 0 && <p className="add-menu-empty">No projects yet.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
