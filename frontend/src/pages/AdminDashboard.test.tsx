import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow, AuditPage } from "../types";
import { api } from "../lib/api";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../lib/api");
vi.mock("../lib/upload");
vi.mock("../lib/zip");
vi.mock("../lib/poll");

const userRow: AdminUserRow = {
  sub: "u1",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  createdAt: "2024-01-01T00:00:00Z",
  hasDownloaded: false,
  hasSent: false,
};

const emptyAudit: AuditPage = { entries: [], total: 0, page: 1, pageSize: 25 };

function auditWith(total: number): AuditPage {
  return {
    entries: [
      {
        id: "a1",
        action: "download",
        context: "share",
        fileName: "report.pdf",
        fileId: "f1",
        actorSub: "u1",
        actorEmail: "jane@example.com",
        actorName: "Jane Doe",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ],
    total,
    page: 1,
    pageSize: 25,
  };
}

function setDefaults() {
  vi.mocked(api.adminListUsers).mockResolvedValue([]);
  vi.mocked(api.adminListShares).mockResolvedValue([]);
  vi.mocked(api.adminListUploads).mockResolvedValue([]);
  vi.mocked(api.adminListAudit).mockResolvedValue(emptyAudit);
}

describe("AdminDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaults();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the loading state on the default users tab before data resolves", () => {
    vi.mocked(api.adminListUsers).mockReturnValue(new Promise(() => {}));
    render(<AdminDashboard />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows per-tab empty states while switching tabs", async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);

    expect(await screen.findByText("No users yet — add one above.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Shares sent" }));
    expect(await screen.findByText("Nothing shared yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Files received" }));
    expect(await screen.findByText("Nothing received yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Audit log" }));
    expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
  });

  it("deletes a user after confirmation", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([userRow]);
    vi.mocked(api.adminDeleteUser).mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<AdminDashboard />);
    await screen.findByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(api.adminDeleteUser).toHaveBeenCalledWith("u1"));
  });

  it("does not delete a user when confirmation is cancelled", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([userRow]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<AdminDashboard />);
    await screen.findByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("debounces the audit file-name filter", async () => {
    vi.useFakeTimers();
    vi.mocked(api.adminListAudit).mockResolvedValue(emptyAudit);

    render(<AdminDashboard />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const initialCalls = vi.mocked(api.adminListAudit).mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: "Audit log" }));
    const input = screen.getByPlaceholderText("Filter by file name…");
    fireEvent.change(input, { target: { value: "r" } });
    fireEvent.change(input, { target: { value: "re" } });
    fireEvent.change(input, { target: { value: "rep" } });

    expect(vi.mocked(api.adminListAudit).mock.calls.length).toBe(initialCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(vi.mocked(api.adminListAudit).mock.calls.length).toBe(initialCalls + 1);
    expect(vi.mocked(api.adminListAudit).mock.lastCall?.[0]).toMatchObject({ fileName: "rep" });

    vi.useRealTimers();
  });

  it("disables both pagination buttons when there is a single page", async () => {
    vi.mocked(api.adminListAudit).mockResolvedValue(auditWith(10));
    const user = userEvent.setup();

    render(<AdminDashboard />);
    await user.click(screen.getByRole("button", { name: "Audit log" }));
    await screen.findByText("report.pdf");

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("enables Next but disables Previous on the first of multiple pages", async () => {
    vi.mocked(api.adminListAudit).mockResolvedValue(auditWith(30));
    const user = userEvent.setup();

    render(<AdminDashboard />);
    await user.click(screen.getByRole("button", { name: "Audit log" }));
    await screen.findByText("report.pdf");

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("renders received files on the uploads tab", async () => {
    vi.mocked(api.adminListUploads).mockResolvedValue([
      {
        id: "up1",
        senderSub: "s1",
        sender: { ...userRow },
        files: [{ fileId: "f1", name: "sent.txt", size: 10, status: "ready" }],
        fileCount: 1,
        readyCount: 1,
        totalSize: 10,
        createdAt: "2024-01-01T00:00:00Z",
        status: "ready",
      },
    ]);
    const user = userEvent.setup();

    render(<AdminDashboard />);
    await user.click(screen.getByRole("button", { name: "Files received" }));
    expect(await screen.findByText("sent.txt")).toBeInTheDocument();
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
  });
});
