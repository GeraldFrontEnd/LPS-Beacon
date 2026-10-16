// src/components/MessageInput.tsx
// The text box and Send button at the bottom of the chat.

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

interface MessageInputProps {
  onSend: (text: string) => void; // function from the parent that handles a finished message
  disabled: boolean; // true while the assistant is replying, to prevent double sending
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  // "text" holds what the user has typed so far; setText updates it.
  const [text, setText] = useState("");

  // Shared logic for "the user wants to send".
  function submit() {
    const trimmed = text.trim(); // remove spaces at the start and end
    if (!trimmed || disabled) return; // ignore empty messages or sending while busy
    onSend(trimmed); // hand the message to the parent
    setText(""); // clear the box
  }

  // Runs when the form is submitted (Send button clicked).
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
      {/* Hidden label so screen readers know what the box is for. */}
      <label htmlFor="chat-text" className="visually-hidden">
        Your question
      </label>
      <textarea
        id="chat-text"
        rows={2}
        value={text} // the box always shows the "text" state
        onChange={(e) => setText(e.target.value)} // update state on every keystroke
        onKeyDown={handleKeyDown}
        placeholder="Ask about availability or cost, for example: how many people can join Project A?"
      />
      {/* Disabled when busy or when the box is empty. */}
      <button type="submit" disabled={disabled || text.trim() === ""}>
        Send
      </button>
    </form>
  );
}
