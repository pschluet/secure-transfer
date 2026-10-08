import { StatusPill } from "./StatusPill";

/** A message the current user sent, with whether the other party has opened it. */
export function SentMessage({ message, viewedAt }: { message: string; viewedAt?: string }) {
  return (
    <div className="message">
      <div className="message-header">
        <span>Message</span>
        <StatusPill tone={viewedAt ? "success" : "neutral"}>
          {viewedAt ? "Viewed" : "Not viewed"}
        </StatusPill>
      </div>
      <p className="message-text">{message}</p>
    </div>
  );
}
