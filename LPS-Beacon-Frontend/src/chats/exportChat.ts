// src/chats/exportChat.ts
// Share / Export: turns a conversation into text and copies, downloads or shares it.

import type { ChatMessage } from "../api/types";

interface ExportableChat {
  title: string;
  messages: ChatMessage[];
}

const speaker = (m: ChatMessage) => (m.sender === "user" ? "You" : "LPS-Beacon");

// Markdown: a title, then each message under a bold speaker name.
export function chatToMarkdown(chat: ExportableChat): string {
  const body = chat.messages.map((m) => `**${speaker(m)}** (${new Date(m.timestamp).toLocaleString()})\n\n${m.text}`);
  return `# ${chat.title}\n\n${body.join("\n\n---\n\n")}\n`;
}

// Plain text, for copying into an email or a message.
export function chatToText(chat: ExportableChat): string {
  const body = chat.messages.map((m) => `${speaker(m)}: ${m.text}`);
  return `${chat.title}\n\n${body.join("\n\n")}\n`;
}

// A safe file name made from the title, for example "q3-headcount-forecast".
export function fileNameFor(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${slug || "chat"}.${extension}`;
}

// Makes the browser save the text as a file.
export function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // give the download a moment to start
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// The phone/OS share sheet exists on most phones and some desktop browsers only.
export const canShare = () => typeof navigator.share === "function";

export async function shareText(title: string, text: string): Promise<void> {
  await navigator.share({ title, text });
}
