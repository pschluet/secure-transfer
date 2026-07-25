import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { formatBytes } from "../lib/format";

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Merges newly picked files into the existing selection, skipping exact duplicates. */
function mergeFiles(existing: File[], incoming: FileList | File[]): File[] {
  const merged = [...existing];
  for (const file of Array.from(incoming)) {
    if (!merged.some((f) => f.name === file.name && f.size === file.size)) {
      merged.push(file);
    }
  }
  return merged;
}

export function FilePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    if (e.dataTransfer.files.length) {
      onChange(mergeFiles(files, e.dataTransfer.files));
    }
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div style={{ width: "100%" }}>
      <div
        className={`dropzone${dragActive ? " drag-active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <UploadIcon />
        <span className="dropzone-title">
          Drop files here or <strong>browse</strong>
        </span>
        <span className="dropzone-hint">Any file type, any number of files</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) onChange(mergeFiles(files, e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="selected-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}>
              <span className="file-item-name">{f.name}</span>
              <span className="file-item-size mono">{formatBytes(f.size)}</span>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                onClick={() => removeAt(i)}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
