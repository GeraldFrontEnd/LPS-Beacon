// src/components/FileList.tsx
// Shows the list of chosen files with their status. It only displays data;
// the parent page (UploadPage) decides what happens when "Remove" is clicked.

import type { UploadItem, UploadStatus } from "../api/types";

interface FileListProps {
  items: UploadItem[]; // the files to show
  onRemove: (id: string) => void; // function from the parent that removes a file by its id
  disabled: boolean; // true while uploading, so files can't be removed mid-upload
}

// The words shown for each status. Record<UploadStatus, string> forces us to cover every status.
const STATUS_LABELS: Record<UploadStatus, string> = {
  ready: "Ready to upload",
  uploading: "Uploading…",
  done: "Uploaded",
  error: "Failed",
};

// Turns a size in bytes into something readable like "2.3 MB".
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileList({ items, onRemove, disabled }: FileListProps) {
  // Nothing chosen yet: show nothing (the drop area above already explains what to do).
  if (items.length === 0) return null;

  return (
    <ul className="file-list">
      {/* One row per file. "key" lets React track each row. */}
      {items.map((item) => (
        <li key={item.id} className="file-row">
          <div className="file-info">
            <div className="file-name">{item.file.name}</div>
            {/* The status word gets its own class so CSS can colour it (green for done, red for failed). */}
            <div className="file-meta">
              {formatSize(item.file.size)} ·{" "}
              <span className={`file-status file-status-${item.status}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            {/* Only show the reason when there is one. */}
            {item.error && <div className="file-error">{item.error}</div>}
          </div>
          {/* Hide Remove while this file is being uploaded. */}
          {item.status !== "uploading" && (
            <button
              type="button"
              className="file-remove"
              onClick={() => onRemove(item.id)}
              disabled={disabled}
              aria-label={`Remove ${item.file.name}`}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
