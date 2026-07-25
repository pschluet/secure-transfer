import JSZip from "jszip";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Appends " (2)", " (3)", etc. before the extension if `name` is already taken. */
function uniqueZipEntryName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  let candidate = `${base} (${i})${ext}`;
  while (taken.has(candidate)) {
    i++;
    candidate = `${base} (${i})${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Fetches each file from its presigned URL, bundles them into a single zip
 * in the browser, and downloads that. Files are stored unzipped in S3 — this
 * only affects the "download all" experience, not storage or upload.
 */
export async function downloadAllAsZip(
  files: { name: string; url: string }[],
  zipFilename: string
): Promise<void> {
  const zip = new JSZip();
  const taken = new Set<string>();

  await Promise.all(
    files.map(async (f) => {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`Failed to download ${f.name}`);
      const blob = await res.blob();
      zip.file(uniqueZipEntryName(taken, f.name), blob);
    })
  );

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, zipFilename);
}
