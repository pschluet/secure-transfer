import type { ReactNode } from "react";

export function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "pending" | "neutral";
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
