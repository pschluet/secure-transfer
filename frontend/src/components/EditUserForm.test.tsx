import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../types";
import { api } from "../lib/api";
import { EditUserForm } from "./EditUserForm";

vi.mock("../lib/api");

const user: UserProfile = {
  sub: "s1",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("EditUserForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre-fills the name fields and shows a disabled, non-editable email", () => {
    render(<EditUserForm user={user} onSaved={() => {}} />);
    expect(screen.getByLabelText("First name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Last name")).toHaveValue("Doe");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("jane@example.com");
    expect(email).toBeDisabled();
  });

  it("submits trimmed name values for the user's sub, then calls onSaved", async () => {
    const ue = userEvent.setup();
    const updated = { ...user, firstName: "Janet" };
    vi.mocked(api.adminUpdateUser).mockResolvedValue(updated as never);
    const onSaved = vi.fn();

    render(<EditUserForm user={user} onSaved={onSaved} />);
    const first = screen.getByLabelText("First name");
    await ue.clear(first);
    await ue.type(first, "  Janet  ");
    await ue.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.adminUpdateUser).toHaveBeenCalledWith("s1", {
        firstName: "Janet",
        lastName: "Doe",
      })
    );
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it("surfaces the caught error message", async () => {
    const ue = userEvent.setup();
    vi.mocked(api.adminUpdateUser).mockRejectedValue(new Error("Save failed"));

    render(<EditUserForm user={user} onSaved={() => {}} />);
    await ue.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
  });
});
