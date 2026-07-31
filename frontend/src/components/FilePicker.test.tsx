import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePicker } from "./FilePicker";

function makeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("FilePicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges newly selected files into the existing selection", () => {
    const existing = [makeFile("a.txt", 10)];
    const onChange = vi.fn();
    const { container } = render(<FilePicker files={existing} onChange={onChange} />);

    fireEvent.change(fileInput(container), { target: { files: [makeFile("b.txt", 20)] } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as File[];
    expect(next.map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("does not duplicate a file with the same name and size", () => {
    const existing = [makeFile("a.txt", 10)];
    const onChange = vi.fn();
    const { container } = render(<FilePicker files={existing} onChange={onChange} />);

    fireEvent.change(fileInput(container), { target: { files: [makeFile("a.txt", 10)] } });

    const next = onChange.mock.calls[0][0] as File[];
    expect(next).toHaveLength(1);
  });

  it("removes an individual selected file", () => {
    const files = [makeFile("a.txt", 10), makeFile("b.txt", 20)];
    const onChange = vi.fn();
    render(<FilePicker files={files} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove a.txt"));

    const next = onChange.mock.calls[0][0] as File[];
    expect(next.map((f) => f.name)).toEqual(["b.txt"]);
  });

  it("opens the file input from the dropzone on Enter and Space", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(<FilePicker files={[]} onChange={() => {}} />);
    const dropzone = screen.getByRole("button");

    fireEvent.keyDown(dropzone, { key: "Enter" });
    fireEvent.keyDown(dropzone, { key: " " });

    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
