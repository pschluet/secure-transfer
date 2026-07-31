import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { CreateUserForm } from "./CreateUserForm";

vi.mock("../lib/api");

describe("CreateUserForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the name and email fields as required", () => {
    render(<CreateUserForm onCreated={() => {}} />);
    expect(screen.getByPlaceholderText("First name")).toBeRequired();
    expect(screen.getByPlaceholderText("Last name")).toBeRequired();
    expect(screen.getByPlaceholderText("Email")).toBeRequired();
  });

  it("submits trimmed names and a trimmed lowercased email, then calls onCreated", async () => {
    const user = userEvent.setup();
    const created = { sub: "s1" };
    vi.mocked(api.adminCreateUser).mockResolvedValue(created as never);
    const onCreated = vi.fn();

    render(<CreateUserForm onCreated={onCreated} />);
    await user.type(screen.getByPlaceholderText("First name"), "  John  ");
    await user.type(screen.getByPlaceholderText("Last name"), "  Doe  ");
    await user.type(screen.getByPlaceholderText("Email"), "  JOHN@EXAMPLE.COM  ");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    await waitFor(() =>
      expect(api.adminCreateUser).toHaveBeenCalledWith({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      })
    );
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("surfaces the caught error message and does not call onCreated", async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminCreateUser).mockRejectedValue(new Error("Email already exists"));
    const onCreated = vi.fn();

    render(<CreateUserForm onCreated={onCreated} />);
    await user.type(screen.getByPlaceholderText("First name"), "John");
    await user.type(screen.getByPlaceholderText("Last name"), "Doe");
    await user.type(screen.getByPlaceholderText("Email"), "john@example.com");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByText("Email already exists")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
