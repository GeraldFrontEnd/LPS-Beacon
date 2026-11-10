// src/components/MessageInput.tsx
// The rounded prompt box at the bottom of the chat: a text box that grows as you type, and a round send-arrow button.

import { useLayoutEffect, useRef } from "react";
import { usePageState } from "../lib/pageState";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

interface MessageInputProps {
  onSend: (text: string) => void; // function from the parent that handles a finished message
  disabled: boolean; // true while the assistant is replying, to prevent double sending
  leftActions?: ReactNode; // buttons at the bottom left of the box (the "+" Add to project menu)
}

export default function MessageInput({ onSend, disabled, leftActions }: MessageInputProps) {
  // "text" holds what the user has typed so far; setText updates it.
  // A half-typed question survives leaving the Chat tab (remembered 30 minutes, lib/pageState.ts).
  const [text, setText] = usePageState("chat.draft", "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow (or shrink) the box to fit its text after every change, so long questions never need a scrollbar.
  // useLayoutEffect runs before the screen is painted, so the box never flickers at the wrong height.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto"; // reset first, so the box can also get smaller when text is deleted
    box.style.height = `${box.scrollHeight}px`;
  }, [text]);

  // Shared logic for "the user wants to send".
  function submit() {
    const trimmed = text.trim(); // remove spaces at the start and end
    if (!trimmed || disabled) return; // ignore empty messages or sending while busy
    onSend(trimmed); // hand the message to the parent
    setText(""); // clear the box
  }

  // Runs when the form is submitted (send button clicked).
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // stop the browser from reloading the page
    submit();
  }

  // Enter sends the message; Shift+Enter adds a new line.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // stop Enter from inserting a new line
      submit();
    }
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      {/* The rounded box holds the text and the button, like a modern chat prompt. Clicking anywhere in it focuses the text. */}
      <div className="prompt-box" onClick={() => textareaRef.current?.focus()}>
        {/* Hidden label so screen readers know what the box is for. */}
        <label htmlFor="chat-text" className="visually-hidden">
          Your question
        </label>
        <textarea
          ref={textareaRef}
          id="chat-text"
          rows={1}
          value={text} // the box always shows the "text" state
          onChange={(e) => setText(e.target.value)} // update state on every keystroke
          onKeyDown={handleKeyDown}
          placeholder="Ask about resource supply and demand. For example: 'Who is rolling off projects in the next 3 months?' or 'Which opportunities need resources in the next 3 months, and when do they start?'"
        />
        <div className="prompt-actions">
          <div className="prompt-actions-left">{leftActions}</div>
          {/* Disabled when busy or when the box is empty. */}
          <button type="submit" className="send-button" disabled={disabled || text.trim() === ""} aria-label="Send">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
