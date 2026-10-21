// src/pages/ChatPage.tsx
// The chat screen: the sidebar (past chats and project folders) on the left, the open conversation on the right.
// It owns the data (chat history, waiting replies, errors) and passes it to smaller components.

import { useEffect, useRef, useState } from "react";
import { sendMessage } from "../api/client";
import type { ChatMessage, Sender } from "../api/types";
import MessageList from "../components/MessageList";
import MessageInput from "../components/MessageInput";
import Sidebar from "../components/Sidebar";
import ActionMenu from "../components/ActionMenu";
import Dialog from "../components/Dialog";
import type { DialogOptions } from "../components/Dialog";
import type { MenuAction } from "../components/ActionMenu";
import { CopyIcon, DownloadIcon, EllipsisIcon, FolderIcon, MenuIcon, ShareIcon, TrashIcon } from "../components/icons";
import { useAuth } from "../auth/useAuth";
import { titleFrom, useChatHistory } from "../chats/useChatHistory";
import type { Chat, Project } from "../chats/useChatHistory";
import {
  canShare,
  chatToMarkdown,
  chatToText,
  copyText,
  downloadText,
  fileNameFor,
  shareText,
} from "../chats/exportChat";
import { useTheme } from "../theme/theme";

// Builds a ChatMessage so we don't repeat ourselves.
function makeMessage(sender: Sender, text: string): ChatMessage {
  return {
    id: crypto.randomUUID(), // built-in browser function that makes a unique id
    sender,
    text,
    timestamp: new Date().toISOString(),
  };
}

// The first message of every conversation.
const GREETING =
  "Hi! I can help you uncover workforce insights on resource availability, skills, capacity, and project staffing.";

// What the right-hand side shows: an existing chat, a new (not yet sent) chat, or a project folder's contents.
type View = { kind: "chat"; id: string } | { kind: "new"; projectId: string | null } | { kind: "project"; id: string };

export default function ChatPage() {
  const { user, token } = useAuth(); // who is logged in, and the token that proves it
  const [theme, setTheme] = useTheme();

  const [view, setView] = useState<View>({ kind: "new", projectId: null });
  const [greeting] = useState(() => makeMessage("assistant", GREETING)); // shown in a chat that has no messages yet
  const [pendingIds, setPendingIds] = useState<string[]>([]); // chats waiting for the backend
  const [error, setError] = useState<string | null>(null); // error text for the open chat, or null
  const [sidebarOpen, setSidebarOpen] = useState(false); // phones only: the sidebar drawer
  const [dialog, setDialog] = useState<DialogOptions | null>(null);
  // Short confirmation at the bottom of the screen. "at" counts up, so a repeated message restarts the timer.
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

  // Problems loading or saving the chat history (on the server) appear as a toast.
  const history = useChatHistory(user?.email ?? "guest", token, (message) =>
    setToast((t) => ({ text: message, at: (t?.at ?? 0) + 1 })),
  );

  const activeChat = view.kind === "chat" ? (history.chats.find((c) => c.id === view.id) ?? null) : null;
  const openProject = view.kind === "project" ? (history.projects.find((p) => p.id === view.id) ?? null) : null;
  // The folder to highlight in the sidebar: the open one, or the one holding the open or new chat.
  const activeProjectId =
    view.kind === "project" ? view.id : view.kind === "new" ? view.projectId : (activeChat?.projectId ?? null);
  const activeProject = history.projects.find((p) => p.id === activeProjectId) ?? null;

  // The open chat's id, readable from inside handleSend after the reply arrives (it may have changed by then).
  const activeChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeChatIdRef.current = activeChat?.id ?? null;
  });

  // Example questions shown as buttons. Only Finance/HR users get the extra question.
  const suggestions = [
    "Show all forecasted available L2 Cloud Engineer resources in Q1 within the Infra OS skill family. ",
    "List all Underutilized and Overutilized resources for Q1?",
    ...(user?.role === "finance_hr" ? ["Which ITSO resources are available in Q3?"] : []),
  ];

  // The toast hides itself after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function flash(text: string) {
    setToast((t) => ({ text, at: (t?.at ?? 0) + 1 }));
  }

  // Switches what the right-hand side shows, and closes the drawer on phones.
  function show(next: View) {
    setView(next);
    setError(null);
    setSidebarOpen(false);
  }

  // Sends a question and adds the answer. Called by the input box and by the suggestion buttons.
  async function handleSend(text: string) {
    setError(null);
    const question = makeMessage("user", text);

    // The first question of a new chat creates it (filed in the project it was started from).
    let chatId: string;
    if (activeChat) {
      chatId = activeChat.id;
      history.addMessage(chatId, question);
    } else {
      chatId = crypto.randomUUID();
      history.addChat({
        id: chatId,
        title: titleFrom(text),
        projectId: view.kind === "new" ? view.projectId : null,
        messages: [greeting, question],
      });
      setView({ kind: "chat", id: chatId });
      activeChatIdRef.current = chatId;
    }

    setPendingIds((ids) => [...ids, chatId]);
    try {
      // The chat id doubles as the backend's session id, so each chat keeps its own conversation.
      const { reply } = await sendMessage({ sessionId: chatId, message: text }, token ?? undefined);
      // If the user has moved to another chat meanwhile, the reply is marked unread in the sidebar.
      history.addMessage(chatId, makeMessage("assistant", reply), activeChatIdRef.current !== chatId);
    } catch (err) {
      if (activeChatIdRef.current === chatId) {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
    } finally {
      setPendingIds((ids) => ids.filter((id) => id !== chatId)); // the input unlocks on success and failure
    }
  }

  function selectChat(id: string) {
    history.markRead(id);
    show({ kind: "chat", id });
    void history.loadMessages(id); // a chat from the server fetches its messages the first time it is opened
  }

  function deleteChat(id: string) {
    history.deleteChat(id);
    if (activeChat?.id === id) show({ kind: "new", projectId: null });
    flash("Chat deleted");
  }

  function moveChat(chatId: string, projectId: string | null) {
    history.moveChat(chatId, projectId);
    const name = history.projects.find((p) => p.id === projectId)?.name;
    flash(name ? `Moved to “${name}”` : "Moved to Chats");
  }

  // ---- Project folders ----

  function createProject() {
    setDialog({
      title: "New project",
      input: { value: "", placeholder: "Project name" },
      confirmLabel: "Create",
      onConfirm: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        show({ kind: "project", id: history.createProject(trimmed) });
        flash(`Project “${trimmed}” created`);
      },
    });
  }

  function renameProject(project: Project) {
    setDialog({
      title: "Rename project",
      input: { value: project.name },
      confirmLabel: "Save",
      onConfirm: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        history.renameProject(project.id, trimmed);
        flash("Project renamed");
      },
    });
  }

  function deleteProject(project: Project) {
    setDialog({
      title: `Delete “${project.name}”?`,
      body: "Its chats are not deleted; they move back to Chats.",
      confirmLabel: "Delete project",
      destructive: true,
      onConfirm: () => {
        history.deleteProject(project.id);
        if (activeProjectId === project.id && view.kind !== "chat") show({ kind: "new", projectId: null });
        flash("Project deleted");
      },
    });
  }

  function clearAll() {
    setDialog({
      title: "Clear all chats?",
      body: "Every chat, including the ones in projects, is deleted. This cannot be undone.",
      confirmLabel: "Delete all",
      destructive: true,
      onConfirm: () => {
        history.clearAll();
        show({ kind: "new", projectId: null });
        flash("All chats deleted");
      },
    });
  }

  // ---- Share / Export ----

  function exportMarkdown(chat: Chat) {
    downloadText(fileNameFor(chat.title, "md"), chatToMarkdown(chat), "text/markdown");
  }

  // Exports a chat that may not have been opened yet, so its messages may still need fetching.
  async function exportById(id: string) {
    const chat = await history.loadMessages(id);
    if (chat) exportMarkdown(chat);
  }

  function shareActions(chat: Chat): MenuAction[] {
    return [
      {
        label: "Copy conversation",
        icon: CopyIcon,
        onSelect: () =>
          copyText(chatToText(chat)).then(
            () => flash("Conversation copied"),
            () => flash("Could not copy. Try Download instead."),
          ),
      },
      { label: "Download as Markdown", icon: DownloadIcon, onSelect: () => exportMarkdown(chat) },
      {
        label: "Download as text",
        icon: DownloadIcon,
        onSelect: () => downloadText(fileNameFor(chat.title, "txt"), chatToText(chat), "text/plain"),
      },
      // The system share sheet (email, Teams, ...) only exists on some devices, so it is offered only there.
      ...(canShare()
        ? [
            {
              label: "Share…",
              icon: ShareIcon,
              // Closing the share sheet without choosing counts as an error; there is nothing to report.
              onSelect: () => shareText(chat.title, chatToText(chat)).catch(() => {}),
            },
          ]
        : []),
    ];
  }

  // ---- What the right-hand side shows ----

  // Chats saved on the server do not store the greeting, so it is shown in front of their messages.
  const messages = !activeChat
    ? [greeting]
    : activeChat.messages[0]?.id === greeting.id
      ? activeChat.messages
      : [greeting, ...activeChat.messages];
  const isOpening = !!activeChat && !activeChat.loaded; // its messages are still loading from the server
  const isLoading = isOpening || (!!activeChat && pendingIds.includes(activeChat.id));
  const showSuggestions = !openProject && !activeChat && !isLoading; // only before the first question
  const projectChats = openProject
    ? history.chats.filter((c) => c.projectId === openProject.id).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];

  return (
    <div className="chat-layout">
      <Sidebar
        chats={history.chats}
        projects={history.projects}
        pendingIds={pendingIds}
        activeChatId={activeChat?.id ?? null}
        activeProjectId={activeProjectId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={() => show({ kind: "new", projectId: null })}
        onSelectChat={selectChat}
        onSelectProject={(id) => show({ kind: "project", id })}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onMoveChat={moveChat}
        onExportChat={(id) => void exportById(id)}
        onDeleteChat={deleteChat}
        onClearAll={clearAll}
        theme={theme}
        onThemeChange={setTheme}
      />

      <main className="chat-page">
        <header className="chat-header chat-header-row">
          {/* Phones only: opens the sidebar drawer. */}
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show chats and projects"
            aria-expanded={sidebarOpen}
          >
            <MenuIcon size={20} />
          </button>
          <div className="chat-header-text">
            {activeProject && <p className="chat-breadcrumb">{activeProject.name} ›</p>}
            <h1>{openProject ? openProject.name : (activeChat?.title ?? "Workforce Analytics Virtual Assistant")}</h1>
            {!activeChat && !openProject && <p>Uncover Insights Into LPS Workforce Allocation.</p>}
          </div>
          {activeChat && (
            <ActionMenu
              label="Share or export this chat"
              heading="Share / Export"
              buttonClassName="secondary-button share-button"
              actions={shareActions(activeChat)}
            >
              <ShareIcon />
              Share
            </ActionMenu>
          )}
        </header>

        {openProject ? (
          // A project folder: its chats, and a button to start a new one inside it.
          <section className="project-view" aria-label={`Project ${openProject.name}`}>
            <div className="project-view-top">
              <p className="note">
                {projectChats.length} {projectChats.length === 1 ? "chat" : "chats"} in this project
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => show({ kind: "new", projectId: openProject.id })}
              >
                New chat in this project
              </button>
            </div>
            {projectChats.length === 0 && (
              <p className="note">
                Nothing here yet. Start a chat above, or use a chat's ⋯ menu in the sidebar to move it here.
              </p>
            )}
            <ul className="project-chat-list">
              {projectChats.map((c) => (
                <li key={c.id} className="project-chat-row">
                  <button type="button" className="project-chat-open" onClick={() => selectChat(c.id)}>
                    <span className="sidebar-row-title">{c.title}</span>
                    <span className="note">{new Date(c.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <ActionMenu
                    label={`Actions for chat ${c.title}`}
                    buttonClassName="sidebar-row-menu visible"
                    actions={[
                      { label: "Move back to Chats", icon: FolderIcon, onSelect: () => moveChat(c.id, null) },
                      ...history.projects
                        .filter((p) => p.id !== openProject.id)
                        .map((p) => ({
                          label: `Move to ${p.name}`,
                          icon: FolderIcon,
                          onSelect: () => moveChat(c.id, p.id),
                        })),
                      { label: "Export as Markdown", icon: DownloadIcon, onSelect: () => void exportById(c.id) },
                      { label: "Delete chat", icon: TrashIcon, destructive: true, onSelect: () => deleteChat(c.id) },
                    ]}
                  >
                    <EllipsisIcon />
                  </ActionMenu>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <MessageList
              messages={messages}
              isLoading={isLoading}
              pendingText={isOpening ? "Loading this chat…" : undefined}
            />

            {showSuggestions && (
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}

            <MessageInput onSend={handleSend} disabled={isLoading} />
          </>
        )}
      </main>

      {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
      {toast && (
        <div className="toast" role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
