import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

function fill(container: HTMLElement): HTMLElement {
  return container.querySelector(".progress-fill") as HTMLElement;
}

describe("ProgressBar", () => {
  it("renders the rounded percentage for a mid value", () => {
    const { container } = render(<ProgressBar value={0.5} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(fill(container).style.width).toBe("50%");
    expect(fill(container)).not.toHaveClass("done");
  });

  it("clamps below 0 to 0%", () => {
    const { container } = render(<ProgressBar value={-0.5} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(fill(container).style.width).toBe("0%");
  });

  it("clamps above 1 to 100% and applies the done state", () => {
    const { container } = render(<ProgressBar value={1.5} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(fill(container).style.width).toBe("100%");
    expect(fill(container)).toHaveClass("done");
  });
});
