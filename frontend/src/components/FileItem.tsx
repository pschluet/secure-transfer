import type { ReactNode } from "react";
import { formatBytes } from "../lib/format";

/** A single row in a `<ul className="file-items">` list — name, size, and a right-aligned action/status slot, always grid-aligned regardless of filename length. */
export function FileItem({
  name,
  size,
  right,
}: {
  name: string;
  size: number;
  right?: ReactNode;
}) {
  return (
    <li className="file-item">
      <span className="file-item-name" title={name}>
        {name}
      </span>
      <span className="file-item-size mono">{formatBytes(size)}</span>
      <span className="file-item-action">{right}</span>
    </li>
  );
}
