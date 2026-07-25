import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { UserProfile } from "../types";

export function CreateUserForm({ onCreated }: { onCreated: (user: UserProfile) => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.adminCreateUser({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
      });
      onCreated(user);
      setFirstName("");
      setLastName("");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input
        placeholder="First name"
        required
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <input
        placeholder="Last name"
        required
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <input
        type="email"
        placeholder="Email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add user"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
