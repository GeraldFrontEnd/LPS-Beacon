// src/components/Sidebar.tsx
// The chat sidebar: brand, New chat, project folders, past chats grouped by day, settings and Clear all chats.
// It only shows things and reports clicks; ChatPage owns the data and decides what each click does.

import { useState } from "react";
import type { Chat, Project } from "../chats/useChatHistory";
import type { ThemeChoice } from "../theme/theme";
import ActionMenu from "./ActionMenu";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageIcon,
  MonitorIcon,
  MoonIcon,
  PencilIcon,
  SettingsIcon,
  SquarePenIcon,
  SunIcon,
  TrashIcon,
} from "./icons";

interface SidebarProps {
  chats: Chat[];
  projects: Project[];
  pendingIds: string[]; // chats waiting for a reply
  activeChatId: string | null;
  activeProjectId: string | null; // the folder that is open, or that holds the open chat
  open: boolean; // phones only: whether the drawer is pulled out
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onMoveChat: (chatId: string, projectId: string) => void;
  onExportChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onClearAll: () => void;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
}

// Pulsing dot: the assistant is still replying. Solid dot: a reply arrived that hasn't been read.
function StatusDot({ pending, unread }: { pending: boolean; unread: boolean }) {
  if (pending) return <span className="status-dot pulsing" role="img" aria-label="Replying" title="Replying…" />;
  if (unread) return <span className="status-dot" role="img" aria-label="Unread reply" title="Unread reply" />;
  return null;
}

// Sorts chats newest first and puts them under Today / Yesterday / Previous 7 days / Older.
function groupByDay(chats: Chat[]) {
  const today = new Date().setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groups = [
    { label: "Today", chats: [] as Chat[] },
    { label: "Yesterday", chats: [] as Chat[] },
    { label: "Previous 7 days", chats: [] as Chat[] },
    { label: "Older", chats: [] as Chat[] },
  ];
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const i = c.updatedAt >= today ? 0 : c.updatedAt >= today - day ? 1 : c.updatedAt >= today - 7 * day ? 2 : 3;
    groups[i].chats.push(c);
  }
  return groups.filter((g) => g.chats.length > 0);
}

export default function Sidebar(props: SidebarProps) {
  const { chats, projects, pendingIds, activeChatId, activeProjectId, open, theme } = props;
  const [projectsOpen, setProjectsOpen] = useState(true);

  // Chats filed in a folder are listed inside that folder, not in the main list.
  const unfiledChats = chats.filter((c) => !c.projectId);

  return (
    <>
      {/* Phones: a dark layer behind the drawer; tapping it closes the drawer. */}
      {open && <div className="sidebar-backdrop" onClick={props.onClose} />}

      <aside className={open ? "sidebar open" : "sidebar"} aria-label="Chat sidebar">
        {/* The LPS-Beacon logo, white on the brand purple. */}
        <div className="sidebar-brand">
          <span className="sidebar-brand-name">LPS-Beacon</span>
          <span className="sidebar-brand-slogan">Workforce Analytics Assistant</span>
        </div>

        <div className="sidebar-top">
          <button type="button" className="sidebar-new-chat" onClick={props.onNewChat}>
            New chat
            <SquarePenIcon />
          </button>
        </div>

        {/* ---- Project folders ---- */}
        <section className="sidebar-projects" aria-label="Projects">
          <div className="sidebar-section-row">
            <button
              type="button"
              className="sidebar-section-toggle"
              onClick={() => setProjectsOpen((v) => !v)}
              aria-expanded={projectsOpen}
            >
              {projectsOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              Projects
            </button>
            <button
              type="button"
              className="sidebar-icon-button"
              onClick={props.onCreateProject}
              title="New project"
              aria-label="New project"
            >
              <FolderPlusIcon />
            </button>
          </div>

          {projectsOpen && (
            <div className="sidebar-project-list">
              {projects.map((p) => {
                const inside = chats.filter((c) => c.projectId === p.id);
                const isActive = activeProjectId === p.id;
                return (
                  <div key={p.id} className={isActive ? "sidebar-row active-project" : "sidebar-row"}>
                    <button
                      type="button"
                      className="sidebar-row-main"
                      onClick={() => props.onSelectProject(p.id)}
                      aria-pressed={isActive}
                    >
                      <span className="sidebar-folder-icon">
                        <FolderIcon size={14} />
                      </span>
                      <span className="sidebar-row-title">{p.name}</span>
                      <span className="sidebar-count">{inside.length}</span>
                      <StatusDot
                        pending={inside.some((c) => pendingIds.includes(c.id))}
                        unread={inside.some((c) => c.unread)}
                      />
                    </button>
                    <ActionMenu
                      label={`Actions for project ${p.name}`}
                      buttonClassName="sidebar-row-menu"
                      actions={[
                        { label: "Rename", icon: PencilIcon, onSelect: () => props.onRenameProject(p) },
                        {
                          label: `Delete “${p.name}”`,
                          icon: TrashIcon,
                          destructive: true,
                          onSelect: () => props.onDeleteProject(p),
                        },
                      ]}
                    >
                      <EllipsisIcon />
                    </ActionMenu>
                  </div>
                );
              })}
              {projects.length === 0 && <p className="sidebar-empty">No projects yet</p>}
            </div>
          )}
        </section>

        {/* ---- Chat history ---- */}
        <nav className="sidebar-history" aria-label="Chat history">
          <p className="sidebar-history-heading">
            <MessageIcon size={14} />
            Chats
          </p>
          {unfiledChats.length === 0 && <p className="sidebar-empty">No chats yet</p>}
          {groupByDay(unfiledChats).map((group) => (
            <div key={group.label} className="sidebar-group">
              <p className="sidebar-group-label">{group.label}</p>
              {group.chats.map((c) => (
                <div key={c.id} className={c.id === activeChatId ? "sidebar-row active" : "sidebar-row"}>
                  <button
                    type="button"
                    className="sidebar-row-main"
                    onClick={() => props.onSelectChat(c.id)}
                    title={c.title}
                    aria-current={c.id === activeChatId ? "page" : undefined}
                  >
                    <span className="sidebar-row-title">{c.title}</span>
                    <StatusDot pending={pendingIds.includes(c.id)} unread={!!c.unread} />
                  </button>
                  <ActionMenu
                    label={`Actions for chat ${c.title}`}
                    heading={projects.length ? "Move to project" : undefined}
                    buttonClassName="sidebar-row-menu"
                    actions={[
                      ...projects.map((p) => ({
                        label: p.name,
                        icon: FolderIcon,
                        onSelect: () => props.onMoveChat(c.id, p.id),
                      })),
                      { label: "Export as Markdown", icon: DownloadIcon, onSelect: () => props.onExportChat(c.id) },
                      {
                        label: "Delete chat",
                        icon: TrashIcon,
                        destructive: true,
                        onSelect: () => props.onDeleteChat(c.id),
                      },
                    ]}
                  >
                    <EllipsisIcon />
                  </ActionMenu>
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* ---- Settings and Clear all chats ---- */}
        <div className="sidebar-footer">
          <ActionMenu
            label="Settings"
            heading="Appearance"
            placement="above"
            buttonClassName="sidebar-footer-button"
            actions={[
              {
                label: "Light mode",
                icon: SunIcon,
                checked: theme === "light",
                onSelect: () => props.onThemeChange("light"),
              },
              {
                label: "Dark mode",
                icon: MoonIcon,
                checked: theme === "dark",
                onSelect: () => props.onThemeChange("dark"),
              },
              {
                label: "Match my computer",
                icon: MonitorIcon,
                checked: theme === "system",
                onSelect: () => props.onThemeChange("system"),
              },
            ]}
          >
            <SettingsIcon />
            Settings
          </ActionMenu>
          {chats.length > 0 && (
            <button type="button" className="sidebar-footer-button" onClick={props.onClearAll}>
              <TrashIcon />
              Clear all chats
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
