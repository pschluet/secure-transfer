import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { UserProfile } from "../types";

export function EditUserForm({
  user,
  onSaved,
}: {
  user: UserProfile;
  onSaved: (user: UserProfile) => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateUser(user.sub, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="edit-first-name">First name</label>
      <input
        id="edit-first-name"
        required
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />

      <label htmlFor="edit-last-name">Last name</label>
      <input
        id="edit-last-name"
        required
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />

      <label htmlFor="edit-email">Email</label>
      <input id="edit-email" value={user.email} disabled />

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
