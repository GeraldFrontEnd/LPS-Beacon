// src/pages/UploadPage.tsx
// The page where users pick files and upload them.
// Flow: choose files -> checks (type, size, duplicates) -> click Upload -> each file is sent one by one.
// The list of files itself lives in UploadProvider, so it is still here when you come back to this page.

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { UploadItem } from "../api/types";
import FileList from "../components/FileList";
import ReviewDrawer from "../review/ReviewDrawer";
import { useReview } from "../review/useReview";
import { useUploads } from "../uploads/useUploads";

// Rules for which files we accept. Confirm the real limits with your teammates.
const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
const MAX_SIZE_MB = 20;

// Returns the ending of a file name in lowercase, for example "Data.CSV" -> ".csv".
function getExtension(name: string): string {
  const dot = name.lastIndexOf("."); // position of the last dot, or -1 if there is none
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export default function UploadPage() {
  // The shared list and the actions on it (they live above this page, so they survive leaving it).
  const { items, isUploading, addItems, removeItem, startUpload } = useUploads();
  // A review in progress reads the stored files; saving new ones underneath it would change its data midway.
  const { canStartReview } = useReview();

  // A message about files we rejected (wrong type, too big, duplicate), or null for none.
  const [message, setMessage] = useState<string | null>(null);

  // true while the user is dragging files over the drop area (used to highlight it).
  const [isDragging, setIsDragging] = useState(false);

  // A reference to the hidden file input, so the drop area button can open the file picker.
  const inputRef = useRef<HTMLInputElement>(null);

  // The page title. The review panel slides up to just below it.
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Checks the chosen files and adds the good ones to the list.
  // FileList here is the browser's own type for "the files the user picked".
  function addFiles(fileList: FileList | null) {
    if (!fileList) return; // nothing was chosen

    const problems: string[] = []; // reasons for rejected files
    const accepted: UploadItem[] = []; // files that passed all checks

    // Array.from turns the browser's file list into a normal array we can loop over.
    for (const file of Array.from(fileList)) {
      // Check 1: file type.
      if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
        problems.push(`${file.name}: only CSV or Excel files are allowed.`);
        continue; // skip to the next file
      }
      // Check 2: file size. 1 MB = 1024 * 1024 bytes.
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        problems.push(`${file.name}: larger than ${MAX_SIZE_MB} MB.`);
        continue;
      }
      // Check 3: same name and size as a file in the list that is still waiting to be sent. A file that was
      // already uploaded doesn't count, so the same file can be sent again (e.g. "Upload without review" later).
      const alreadyAdded = items.some(
        (i) => i.status !== "done" && i.file.name === file.name && i.file.size === file.size
      );
      if (alreadyAdded) {
        problems.push(`${file.name}: already in the list.`);
        continue;
      }
      // Passed everything: add it with the starting status "ready".
      accepted.push({ id: crypto.randomUUID(), file, status: "ready" });
    }

    addItems(accepted); // add the good files to the shared list
    setMessage(problems.length > 0 ? problems.join(" ") : null); // show problems, or clear the old message
  }

  // Runs when the user picks files through the normal file picker.
  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = ""; // reset so choosing the same file again still triggers this function
  }

  // The three drag-and-drop handlers.
  function handleDragOver(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); // without this, the browser refuses to let you drop here
    setIsDragging(true);
  }
  function handleDragLeave() {
    setIsDragging(false);
  }
  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); // stop the browser from opening the dropped file
    setIsDragging(false);
    addFiles(e.dataTransfer.files); // dataTransfer.files = the files that were dropped
  }

  // Runs when an Upload button is clicked. review: false only checks and stores the files (no forecast or matching).
  function handleUpload(review = true) {
    setMessage(null); // clear any old problem message
    void startUpload({ review }); // start sending; progress shows in the list
  }

  // Numbers for the summary text and the button.
  const pendingCount = items.filter((i) => i.status === "ready" || i.status === "error").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <main className="upload-page">
      <header className="page-header">
        <h1 ref={titleRef}>Upload files</h1>
        <p>
          Add manpower and cost files. Files are processed after upload, so new data may take a
          little while to appear in chat answers.
        </p>
      </header>

      <div className="upload-body">
        {/* The real file input is hidden; the drop area button below opens it. */}
        <input
          ref={inputRef}
          type="file"
          multiple // allow choosing several files at once
          accept={ALLOWED_EXTENSIONS.join(",")} // only show CSV and Excel files in the picker
          onChange={handleInputChange}
          hidden
        />

        <button
          type="button"
          className={isDragging ? "dropzone dragging" : "dropzone"}
          onClick={() => inputRef.current?.click()} // open the file picker
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <strong>Choose files or drag them here</strong>
          <span>CSV or Excel, up to {MAX_SIZE_MB} MB each</span>
        </button>

        {/* Only render the banner when some files were rejected. */}
        {message && (
          <p className="error-banner" role="alert">
            {message}
          </p>
        )}

        <FileList items={items} onRemove={removeItem} disabled={isUploading} />
      </div>

      <div className="upload-actions">
        <p className="note">
          {items.length === 0 ? "No files selected." : `${doneCount} of ${items.length} uploaded.`}
        </p>
        <div className="upload-buttons">
          <button
            type="button"
            className="secondary-button"
            onClick={() => handleUpload(false)}
            disabled={isUploading || pendingCount === 0 || !canStartReview}
            title={
              canStartReview
                ? "Check and store the files without running the forecast and matching. Review them later from the review panel."
                : "Finish or clear the review in progress first."
            }
          >
            Upload without review
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => handleUpload()}
            disabled={isUploading || pendingCount === 0} // can't click while busy or with nothing to upload
          >
            {isUploading ? "Uploading…" : `Upload and review ${pendingCount} file${pendingCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      {/* The review bar along the bottom, and the panel that slides up from it. */}
      <ReviewDrawer anchorRef={titleRef} />
    </main>
  );
}
