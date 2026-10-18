// src/chats/useChatHistory.ts
// The list of past chats and the project folders they can be filed in.
// TODO: the backend has no chat-history endpoint yet, so everything is kept in this browser's localStorage,
// one list per signed-in user. When the backend stores history (DynamoDB, keyed by sessionId = chat id),
// load and save through src/api/client.ts here instead; the screens will not need to change.

import { useEffect, useState } from "react";
import type { ChatMessage } from "../api/types";

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
  unread?: boolean; // a reply arrived while another chat was open
}

interface History {
  chats: Chat[];
  projects: Project[];
}

// The folders every user starts with. They can be renamed or deleted like any other.
const DEFAULT_PROJECTS: Project[] = [
  { id: "p-forecast-quarterly", name: "Forecasted Quarterly" },
  { id: "p-utilisation-bench", name: "Under & Overutilized Benching" },
  { id: "p-margin-costing", name: "Margin Costing" },
  { id: "p-headcount", name: "Headcount" },
];

const storageKey = (owner: string) => `lps-beacon:chats:${owner}`;

function load(owner: string): History {
  try {
    const saved = localStorage.getItem(storageKey(owner));
    if (saved) return JSON.parse(saved) as History;
  } catch {
    // ignore: blocked or damaged storage starts a fresh history
  }
  return { chats: [], projects: DEFAULT_PROJECTS };
}

// Builds a sidebar title from the first question.
export function titleFrom(text: string): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine || "New chat";
}

// "owner" separates users who share a browser (their email).
export function useChatHistory(owner: string) {
  const [history, setHistory] = useState<History>(() => load(owner));

  // Save after every change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(history));
    } catch {
      // ignore: full or blocked storage; the history still works until the page is reloaded
    }
  }, [owner, history]);

  // Changes only the chat with this id.
  const updateChat = (id: string, change: (chat: Chat) => Chat) =>
    setHistory((h) => ({ ...h, chats: h.chats.map((c) => (c.id === id ? change(c) : c)) }));

  return {
    chats: history.chats,
    projects: history.projects,

    addChat: (chat: Omit<Chat, "updatedAt">) =>
      setHistory((h) => ({ ...h, chats: [{ ...chat, updatedAt: Date.now() }, ...h.chats] })),

    // Adds a message to a chat. markUnread: the reply landed while the user was looking at another chat.
    addMessage: (chatId: string, message: ChatMessage, markUnread = false) =>
      updateChat(chatId, (c) => ({
        ...c,
        messages: [...c.messages, message],
        updatedAt: Date.now(),
        unread: markUnread || c.unread,
      })),

    markRead: (chatId: string) => updateChat(chatId, (c) => (c.unread ? { ...c, unread: false } : c)),

    moveChat: (chatId: string, projectId: string | null) => updateChat(chatId, (c) => ({ ...c, projectId })),

    deleteChat: (chatId: string) => setHistory((h) => ({ ...h, chats: h.chats.filter((c) => c.id !== chatId) })),

    clearAll: () => setHistory((h) => ({ ...h, chats: [] })),

    // Returns the new project's id.
    createProject: (name: string) => {
      const project = { id: crypto.randomUUID(), name };
      setHistory((h) => ({ ...h, projects: [...h.projects, project] }));
      return project.id;
    },

    renameProject: (projectId: string, name: string) =>
      setHistory((h) => ({ ...h, projects: h.projects.map((p) => (p.id === projectId ? { ...p, name } : p)) })),

    // Deleting a folder keeps its chats: they move back to the main Chats list.
    deleteProject: (projectId: string) =>
      setHistory((h) => ({
        projects: h.projects.filter((p) => p.id !== projectId),
        chats: h.chats.map((c) => (c.projectId === projectId ? { ...c, projectId: null } : c)),
      })),
  };
}
