import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders its children", () => {
    render(<StatusPill tone="success">Downloaded</StatusPill>);
    expect(screen.getByText("Downloaded")).toBeInTheDocument();
  });

  it("applies the tone-specific class", () => {
    const { rerender } = render(<StatusPill tone="success">x</StatusPill>);
    expect(screen.getByText("x")).toHaveClass("pill", "pill-success");

    rerender(<StatusPill tone="pending">x</StatusPill>);
    expect(screen.getByText("x")).toHaveClass("pill", "pill-pending");

    rerender(<StatusPill tone="neutral">x</StatusPill>);
    expect(screen.getByText("x")).toHaveClass("pill", "pill-neutral");
  });
});
