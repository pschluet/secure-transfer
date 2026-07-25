import type { PresignedFileUpload } from "../types";

function putFile(
  url: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
}

/**
 * Uploads each file directly to its presigned URL in parallel. `files` and
 * `presigned` must be in the same order (both derived from the same request
 * body sent to the backend).
 */
export async function uploadFiles(
  files: File[],
  presigned: PresignedFileUpload[],
  onProgress?: (fractionByFileId: Record<string, number>) => void
): Promise<void> {
  const fraction: Record<string, number> = {};
  await Promise.all(
    files.map((file, i) => {
      const target = presigned[i];
      return putFile(target.uploadUrl, file, (loaded, total) => {
        fraction[target.fileId] = total > 0 ? loaded / total : 0;
        onProgress?.({ ...fraction });
      });
    })
  );
}

export function triggerBrowserDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Since files aren't zipped, "download all" just fires one browser download
 * per file. Staggering them avoids browsers flagging rapid same-origin
 * downloads as a popup burst.
 */
export function downloadAllStaggered(urls: string[], delayMs = 350): void {
  urls.forEach((url, i) => {
    setTimeout(() => triggerBrowserDownload(url), i * delayMs);
  });
}
