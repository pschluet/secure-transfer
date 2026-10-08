import { useState } from "react";

/**
 * A share's message, hidden behind a "View message" button so opening it is a
 * deliberate act — `onView` fires on that first click and is what records the
 * message as viewed for the sender. Once viewed, it stays open on later visits.
 */
export function MessageBox({
  message,
  viewedAt,
  onView,
}: {
  message: string;
  viewedAt?: string;
  onView: () => void;
}) {
  const [open, setOpen] = useState(!!viewedAt);

  if (!open) {
    return (
      <div className="message">
        <button
          className="secondary small"
          onClick={() => {
            setOpen(true);
            onView();
          }}
        >
          View message
        </button>
      </div>
    );
  }
  return (
    <div className="message">
      <p className="message-text">{message}</p>
    </div>
  );
}
