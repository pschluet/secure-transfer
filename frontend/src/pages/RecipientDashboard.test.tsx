import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareGroup, UploadGroup } from "../types";
import { api } from "../lib/api";
import { triggerBrowserDownload } from "../lib/upload";
import { RecipientDashboard } from "./RecipientDashboard";

vi.mock("../lib/api");
vi.mock("../lib/upload");
vi.mock("../lib/zip");
vi.mock("../lib/poll");

const share: ShareGroup = {
  id: "sh1",
  recipientSub: "r1",
  files: [
    { fileId: "f1", name: "report.pdf", size: 100, status: "ready" },
    { fileId: "f2", name: "pending.doc", size: 50, status: "pending" },
  ],
  fileCount: 2,
  readyCount: 1,
  totalSize: 150,
  createdAt: "2024-01-01T00:00:00Z",
  expiresAt: "2999-01-01T00:00:00Z",
  status: "ready",
};

describe("RecipientDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.meShares).mockResolvedValue([share]);
    vi.mocked(api.meUploads).mockResolvedValue([]);
  });

  it("renders the shares returned by the API on the default tab", async () => {
    render(<RecipientDashboard />);
    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("pending.doc")).toBeInTheDocument();
  });

  it("shows loading then empty states across all three tabs", async () => {
    vi.mocked(api.meShares).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RecipientDashboard />);

    expect(await screen.findByText("Nothing shared with you yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Your upload history" }));
    expect(await screen.findByText("You haven’t sent anything yet.")).toBeInTheDocument();
  });

  it("switches to the send tab and disables submit with no files selected", async () => {
    const user = userEvent.setup();
    const { container } = render(<RecipientDashboard />);
    await screen.findByText("report.pdf");

    await user.click(screen.getByRole("button", { name: "Send files" }));
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
  });

  it("downloads a ready share file via meDownloadShareFile", async () => {
    vi.mocked(api.meDownloadShareFile).mockResolvedValue({ url: "https://x/download" });
    render(<RecipientDashboard />);
    await screen.findByText("report.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(api.meDownloadShareFile).toHaveBeenCalledWith("sh1", "f1"));
    await waitFor(() => expect(triggerBrowserDownload).toHaveBeenCalledWith("https://x/download"));
  });

  it("does not surface an error when the post-download refresh fails on mobile Safari", async () => {
    // Reproduces the reported bug: the download itself succeeds, but the
    // background list-refresh fired right after it is aborted by mobile
    // Safari's download hand-off, rejecting with the literal WebKit error
    // ("Load failed") rather than Chrome's "Failed to fetch". This must
    // never surface as a red error banner — the download already worked.
    vi.mocked(api.meDownloadShareFile).mockResolvedValue({ url: "https://x/download" });
    vi.mocked(api.meShares)
      .mockResolvedValueOnce([share]) // initial mount load
      .mockRejectedValueOnce(new TypeError("Load failed")); // post-download refresh

    render(<RecipientDashboard />);
    await screen.findByText("report.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    // The primary action must still complete...
    await waitFor(() => expect(triggerBrowserDownload).toHaveBeenCalledWith("https://x/download"));
    // ...and the silenced background refresh must actually have run and
    // rejected (not just been silently skipped) before we assert on it.
    await waitFor(() => expect(api.meShares).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("Load failed")).not.toBeInTheDocument();
    expect(document.querySelector(".error")).not.toBeInTheDocument();
  });

  it("still surfaces an error when the download itself fails", async () => {
    // Regression guard: the fix must only silence the background refresh,
    // never a genuine failure of the download action itself.
    vi.mocked(api.meDownloadShareFile).mockRejectedValue(new Error("Not found"));
    render(<RecipientDashboard />);
    await screen.findByText("report.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("still surfaces an error when the manual refresh button fails", async () => {
    // Regression guard: refreshes NOT triggered by a download (e.g. the
    // user explicitly clicking Refresh) must still show real failures.
    vi.mocked(api.meShares)
      .mockResolvedValueOnce([share])
      .mockRejectedValueOnce(new TypeError("Load failed"));
    const user = userEvent.setup();

    render(<RecipientDashboard />);
    await screen.findByText("report.pdf");

    await user.click(screen.getByRole("button", { name: "Refresh shared files" }));

    expect(await screen.findByText("Load failed")).toBeInTheDocument();
  });
});

const upload: UploadGroup = {
  id: "up1",
  senderSub: "r1",
  files: [{ fileId: "f1", name: "sent.txt", size: 10, status: "ready" }],
  fileCount: 1,
  readyCount: 1,
  totalSize: 10,
  createdAt: "2024-01-01T00:00:00Z",
  status: "ready",
};

describe("RecipientDashboard upload history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.meShares).mockResolvedValue([]);
    vi.mocked(api.meUploads).mockResolvedValue([upload]);
  });

  it("lists prior uploads on the history tab", async () => {
    const user = userEvent.setup();
    render(<RecipientDashboard />);
    await screen.findByText("Nothing shared with you yet.");

    await user.click(screen.getByRole("button", { name: "Your upload history" }));
    expect(await screen.findByText("sent.txt")).toBeInTheDocument();
  });
});
