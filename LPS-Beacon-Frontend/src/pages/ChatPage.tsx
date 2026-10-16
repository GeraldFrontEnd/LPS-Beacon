// src/pages/ChatPage.tsx
// The chat screen. It owns the data (messages, loading, error) and passes it to smaller components.

import { useRef, useState } from "react";
import { sendMessage } from "../api/client";
import type { ChatMessage, Sender } from "../api/types";
import MessageList from "../components/MessageList";
import MessageInput from "../components/MessageInput";
import { useAuth } from "../auth/useAuth";

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
const GREETING = "Hi, I can help with manpower availability and project cost. What would you like to know?";

export default function ChatPage() {
  const { user, token } = useAuth(); // who is logged in, and the token that proves it

  // The conversation. The function form of useState runs once.
  const [messages, setMessages] = useState<ChatMessage[]>(() => [makeMessage("assistant", GREETING)]);
  const [isLoading, setIsLoading] = useState(false); // true while we wait for the backend
  const [error, setError] = useState<string | null>(null); // error text, or null
  const sessionId = useRef(crypto.randomUUID()); // one id per conversation, kept between renders

  // Example questions shown as buttons. Only finance users get the cost question.
  const suggestions = [
    "How many people are available for Project A next month?",
    "Which projects are short of staff?",
    ...(user?.role === "finance" ? ["What is the monthly cost of Project A?"] : []),
  ];

  // Sends a question and adds the answer. Called by the input box and by the suggestion buttons.
  async function handleSend(text: string) {
    setError(null);
    setMessages((prev) => [...prev, makeMessage("user", text)]); // show the user's bubble right away
    setIsLoading(true);
    try {
      const { reply } = await sendMessage(
        { sessionId: sessionId.current, message: text },
        token ?? undefined // turns null into undefined, which is what sendMessage expects
      );
      setMessages((prev) => [...prev, makeMessage("assistant", reply)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsLoading(false); // runs on success and failure, so the input always unlocks
    }
  }

  // Starts a fresh conversation: back to the greeting, with a new session id.
  function handleNewChat() {
    setMessages([makeMessage("assistant", GREETING)]);
    setError(null);
    sessionId.current = crypto.randomUUID();
  }

  // Suggestions only appear before the user has asked anything.
  const showSuggestions = messages.length === 1 && !isLoading;

  return (
    <main className="chat-page">
      <header className="chat-header chat-header-row">
        <div>
          <h1>Manpower assistant</h1>
          <p>Ask about team availability and project cost.</p>
        </div>
        <button type="button" className="secondary-button" onClick={handleNewChat} disabled={isLoading}>
          New chat
        </button>
      </header>

      <MessageList messages={messages} isLoading={isLoading} />

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
    </main>
  );
}
