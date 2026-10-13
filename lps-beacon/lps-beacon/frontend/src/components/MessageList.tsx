// src/components/MessageList.tsx
// Shows all the chat bubbles and keeps the newest one in view.

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../api/types";

// "Props" are the inputs a component receives from its parent.
interface MessageListProps {
  messages: ChatMessage[]; // the conversation so far
  isLoading: boolean; // true while we wait for the assistant's reply
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  // A ref points to a real element on the page. This one marks the very bottom of the list.
  const bottomRef = useRef<HTMLDivElement>(null);

  // useEffect runs after the screen updates. Whenever messages or isLoading change,
  // scroll the bottom marker into view so the newest content is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    // role="log" and aria-live="polite" make screen readers announce new messages.
    <div className="message-list" role="log" aria-live="polite">
      {/* .map turns each message into a bubble. "key" lets React track each one. */}
      {messages.map((m) => (
        <div key={m.id} className={`message message-${m.sender}`}>
          {m.text}
        </div>
      ))}

      {/* Only shown while waiting for the backend. */}
      {isLoading && (
        <div className="message message-assistant message-pending">Looking that up…</div>
      )}

      {/* Invisible marker at the bottom that we scroll to. */}
      <div ref={bottomRef} />
    </div>
  );
}
