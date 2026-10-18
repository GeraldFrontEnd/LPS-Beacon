// src/components/Dialog.tsx
// A small centred box that asks for a name (new / rename project) or for a yes (delete).

import { useEffect, useRef, useState } from "react";

export interface DialogOptions {
  title: string;
  body?: string; // extra explanation under the title
  input?: { value: string; placeholder?: string }; // show a text box, starting with this value
  confirmLabel?: string;
  destructive?: boolean; // red confirm button, for deleting
  onConfirm: (value: string) => void; // gets the text box value ("" when there is no box)
}

interface DialogProps extends DialogOptions {
  onClose: () => void;
}

export default function Dialog({
  title,
  body,
  input,
  confirmLabel = "OK",
  destructive,
  onConfirm,
  onClose,
}: DialogProps) {
  const [value, setValue] = useState(input?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The latest onClose, so the effect below runs only once (when the dialog opens).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus the text box (or the confirm button) when the dialog opens; Escape closes it.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      confirmRef.current?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit() {
    onConfirm(value);
    onClose();
  }

  return (
    // Clicking the dark backdrop (not the box) closes it.
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        {input && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={input.placeholder}
            aria-label={title}
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={destructive ? "dialog-confirm destructive" : "dialog-confirm"}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
