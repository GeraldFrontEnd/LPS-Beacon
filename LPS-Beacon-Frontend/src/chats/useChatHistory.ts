// src/chats/useChatHistory.ts
// The list of past chats and the project folders they can be filed in.
//
// Where the history lives:
//  - Normally on the server (DynamoDB, through src/api/client.ts), so it follows the user to any browser.
//    The sidebar list and the folders load when the page opens; a chat's messages load when it is opened.
//    Changes show on screen at once and are then saved; if saving fails, the list is reloaded from the server
//    and onError is called with a message for the user.
//    Questions and answers are saved by the server itself during POST /chat, so they are only added on screen here.
//  - With VITE_USE_MOCK=true, in this browser's localStorage instead, one list per signed-in user, so the app still
//    works without a backend.
// The screens use the same functions either way.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, FolderSummary, SessionSummary } from "../api/types";
import {
  USE_SERVER_HISTORY,
  createFolder,
  deleteFolder,
  deleteSession,
  getSessionMessages,
  listFolders,
  listSessions,
  renameFolder,
  updateSession,
} from "../api/client";

export interface Project {
  id: string;
  name: string;
}

export interface Chat {
  id: string; // also sent to the backend as the sessionId
  title: string; // the first question, shortened
  projectId: string | null; // the folder it is filed in, or null for the main Chats list
  updatedAt: number; // milliseconds since 1970, for sorting and the Today / Yesterday groups
  messages: ChatMessage[];
  loaded: boolean; // false while a chat from the server has not had its messages fetched yet
  unread?: boolean; // a reply arrived while another chat was open
}

interface History {
  chats: Chat[];
  projects: Project[];
}

// The folders every user starts with in mock mode. On the server, the backend creates the same ones.
const DEFAULT_PROJECTS: Project[] = [
  { id: "p-forecast-quarterly", name: "Forecasted Quarterly" },
  { id: "p-utilisation-bench", name: "Under & Overutilized Benching" },
  { id: "p-margin-costing", name: "Margin Costing" },
  { id: "p-headcount", name: "Headcount" },
];

const storageKey = (owner: string) => `lps-beacon:chats:${owner}`;

function loadLocal(owner: string): History {
  try {
    const saved = localStorage.getItem(storageKey(owner));
    if (saved) {
      const h = JSON.parse(saved) as History;
      return { ...h, chats: h.chats.map((c) => ({ ...c, loaded: true })) };
    }
  } catch {
    // ignore: blocked or damaged storage starts a fresh history
  }
  return { chats: [], projects: DEFAULT_PROJECTS };
}

const emptyHistory = (): History => ({ chats: [], projects: [] });

function fromServer(s: SessionSummary): Chat {
  return { id: s.id, title: s.title, projectId: s.projectId, updatedAt: s.updatedAt, messages: [], loaded: false };
}

function folderToProject(f: FolderSummary): Project {
  return { id: f.id, name: f.name };
}

// Builds a sidebar title from the first question.
export function titleFrom(text: string): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine || "New chat";
}

// "owner" separates users who share a browser (their email). "token" is the login token for the server.
// onError receives a short message for the user when loading or saving fails.
export function useChatHistory(owner: string, token: string | null, onError?: (message: string) => void) {
  const [stored, setHistory] = useState<History>(() => (USE_SERVER_HISTORY ? emptyHistory() : loadLocal(owner)));
  // Whose history `stored` holds. Until this user's history has arrived, nothing is shown, so after one user signs
  // out and another signs in on the same browser, the first user's chats never appear.
  const [loadedOwner, setLoadedOwner] = useState<string | null>(USE_SERVER_HISTORY ? null : owner);
  const history = loadedOwner === owner ? stored : emptyHistory();
  const loading = USE_SERVER_HISTORY && loadedOwner !== owner;

  // The latest token, history and error handler, readable from inside async functions without re-creating them.
  const tokenRef = useRef(token);
  const historyRef = useRef(history);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    tokenRef.current = token;
    historyRef.current = history;
    onErrorRef.current = onError;
  });
  const setError = (message: string) => onErrorRef.current?.(message);

  // ---- Loading from the server ----

  // Fetches the sidebar list and folders. Keeps messages already loaded, and chats started in this tab that the
  // server has not saved yet (their first question is still on its way).
  // forOwner: the user being loaded for the first time (their list replaces whatever was shown before).
  const reload = useCallback(async (forOwner?: string) => {
    if (!USE_SERVER_HISTORY) return;
    const [sessions, folders] = await Promise.all([
      listSessions(tokenRef.current ?? undefined),
      listFolders(tokenRef.current ?? undefined),
    ]);
    setHistory((previous) => {
      const h = forOwner ? emptyHistory() : previous;
      const known = new Map(h.chats.map((c) => [c.id, c]));
      const fromApi = sessions.map((s) => {
        const local = known.get(s.id);
        return local ? { ...fromServer(s), messages: local.messages, loaded: local.loaded, unread: local.unread } : fromServer(s);
      });
      const serverIds = new Set(sessions.map((s) => s.id));
      const unsaved = h.chats.filter((c) => !serverIds.has(c.id) && c.loaded && c.messages.length > 0);
      return { chats: [...unsaved, ...fromApi], projects: folders.map(folderToProject) };
    });
    if (forOwner) setLoadedOwner(forOwner);
  }, []);

  // Runs a save to the server. On failure, shows the error and reloads, so the screen matches what was saved.
  const save = useCallback(
    (what: string, request: () => Promise<unknown>) => {
      if (!USE_SERVER_HISTORY) return;
      request().catch((err: unknown) => {
        onErrorRef.current?.(`Could not ${what}. ${err instanceof Error ? err.message : ""}`.trim());
        reload().catch(() => {});
      });
    },
    [reload],
  );

  // Server mode: load the history when the page opens or a different user signs in.
  const hasToken = !!token;
  useEffect(() => {
    if (!USE_SERVER_HISTORY || !hasToken) return;
    reload(owner).catch((err: unknown) => {
      onErrorRef.current?.(`Could not load your chats. ${err instanceof Error ? err.message : ""}`.trim());
    });
  }, [owner, hasToken, reload]);

  // Mock mode: save to this browser after every change.
  useEffect(() => {
    if (USE_SERVER_HISTORY) return;
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(stored));
    } catch {
      // ignore: full or blocked storage; the history still works until the page is reloaded
    }
  }, [owner, stored]);

  // Changes only the chat with this id.
  const updateChat = (id: string, change: (chat: Chat) => Chat) =>
    setHistory((h) => ({ ...h, chats: h.chats.map((c) => (c.id === id ? change(c) : c)) }));

  // Fetches a chat's messages the first time it is opened. Returns the chat with its messages (null if unknown).
  async function loadMessages(chatId: string): Promise<Chat | null> {
    const chat = historyRef.current.chats.find((c) => c.id === chatId);
    if (!chat) return null;
    if (chat.loaded || !USE_SERVER_HISTORY) return chat;
    try {
      const messages = await getSessionMessages(chatId, tokenRef.current ?? undefined);
      const loadedChat = { ...chat, messages, loaded: true };
      updateChat(chatId, (c) => ({ ...c, messages, loaded: true }));
      return loadedChat;
    } catch (err) {
      setError(`Could not open this chat. ${err instanceof Error ? err.message : ""}`.trim());
      return null;
    }
  }

  return {
    chats: history.chats,
    projects: history.projects,
    loading, // true while the sidebar list is first loading from the server
    loadMessages,

    // A new chat appears at once. On the server it is created by its first question (POST /chat).
    addChat: (chat: Omit<Chat, "updatedAt" | "loaded">) =>
      setHistory((h) => ({ ...h, chats: [{ ...chat, loaded: true, updatedAt: Date.now() }, ...h.chats] })),

    // Adds a message on screen. The server already saved it as part of POST /chat.
    // markUnread: the reply landed while the user was looking at another chat.
    addMessage: (chatId: string, message: ChatMessage, markUnread = false) =>
      updateChat(chatId, (c) => ({
        ...c,
        messages: [...c.messages, message],
        updatedAt: Date.now(),
        unread: markUnread || c.unread,
      })),

    markRead: (chatId: string) => updateChat(chatId, (c) => (c.unread ? { ...c, unread: false } : c)),

    moveChat: (chatId: string, projectId: string | null) => {
      updateChat(chatId, (c) => ({ ...c, projectId }));
      save("move the chat", () => updateSession(chatId, { projectId }, tokenRef.current ?? undefined));
    },

    deleteChat: (chatId: string) => {
      setHistory((h) => ({ ...h, chats: h.chats.filter((c) => c.id !== chatId) }));
      save("delete the chat", () => deleteSession(chatId, tokenRef.current ?? undefined));
    },

    clearAll: () => {
      const ids = historyRef.current.chats.map((c) => c.id);
      setHistory((h) => ({ ...h, chats: [] }));
      save("delete all chats", () => Promise.all(ids.map((id) => deleteSession(id, tokenRef.current ?? undefined))));
    },

    // Returns the new project's id straight away; the folder is saved in the background.
    createProject: (name: string) => {
      const project = { id: crypto.randomUUID(), name };
      setHistory((h) => ({ ...h, projects: [...h.projects, project] }));
      save("create the project", () => createFolder(project, tokenRef.current ?? undefined));
      return project.id;
    },

    renameProject: (projectId: string, name: string) => {
      setHistory((h) => ({ ...h, projects: h.projects.map((p) => (p.id === projectId ? { ...p, name } : p)) }));
      save("rename the project", () => renameFolder(projectId, name, tokenRef.current ?? undefined));
    },

    // Deleting a folder keeps its chats: they move back to the main Chats list (the server does the same).
    deleteProject: (projectId: string) => {
      setHistory((h) => ({
        projects: h.projects.filter((p) => p.id !== projectId),
        chats: h.chats.map((c) => (c.projectId === projectId ? { ...c, projectId: null } : c)),
      }));
      save("delete the project", () => deleteFolder(projectId, tokenRef.current ?? undefined));
    },
  };
}
