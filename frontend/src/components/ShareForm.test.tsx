import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../types";
import { api } from "../lib/api";
import { uploadFiles } from "../lib/upload";
import { ShareForm } from "./ShareForm";

vi.mock("../lib/api");
vi.mock("../lib/upload");

const recipient: UserProfile = {
  sub: "r1",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  createdAt: "2024-01-01T00:00:00Z",
};

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function makeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("ShareForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults the expiry select to 24 hours with the documented options", () => {
    render(<ShareForm recipient={recipient} onDone={() => {}} />);
    const select = screen.getByLabelText("Expires in") as HTMLSelectElement;
    expect(select.value).toBe("24");
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["1 hour", "24 hours", "3 days", "7 days", "30 days"]);
  });

  it("disables submit with no files and no message", () => {
    render(<ShareForm recipient={recipient} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  it("shares a message on its own without uploading anything", async () => {
    vi.mocked(api.adminCreateShare).mockResolvedValue({ group: {}, uploads: [] } as never);
    const onDone = vi.fn();
    render(<ShareForm recipient={recipient} onDone={onDone} />);

    fireEvent.change(screen.getByLabelText("Message (optional)"), {
      target: { value: "  Hello  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(api.adminCreateShare).toHaveBeenCalledWith("r1", {
        files: [],
        message: "Hello",
        expiresInHours: 24,
      })
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("creates the share then uploads the selected files", async () => {
    const uploads = [{ fileId: "f1", name: "a.txt", uploadUrl: "https://x/f1" }];
    vi.mocked(api.adminCreateShare).mockResolvedValue({ group: {}, uploads } as never);
    vi.mocked(uploadFiles).mockResolvedValue(undefined);
    const onDone = vi.fn();

    const { container } = render(<ShareForm recipient={recipient} onDone={onDone} />);
    const file = makeFile("a.txt", 10);
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(api.adminCreateShare).toHaveBeenCalledWith("r1", {
        files: [{ name: "a.txt", size: 10 }],
        message: undefined,
        expiresInHours: 24,
      })
    );
    await waitFor(() =>
      expect(uploadFiles).toHaveBeenCalledWith([file], uploads, expect.any(Function))
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
