// src/components/MessageList.tsx
// Shows all the chat bubbles and keeps the newest one in view.

import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../api/types";

// The assistant writes Markdown (bold, lists, tables). It is turned into real elements here. react-markdown never
// runs HTML found in the text (it is shown as plain text), so a reply cannot inject markup or scripts.
// Links open in a new tab and do not give the new page access to this one.
function AssistantText({ text }: { text: string }) {
  return (
    <div className="message-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Wide tables scroll sideways inside the bubble instead of stretching the page.
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

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
          {/* Only the assistant's replies are Markdown; the user's own text is shown exactly as typed. */}
          {m.sender === "assistant" ? <AssistantText text={m.text} /> : m.text}
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
