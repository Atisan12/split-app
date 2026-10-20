import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StatusBadge from "@/components/StatusBadge";

/**
 * Snapshot test for StatusBadge — a small, stable, presentational
 * component (no internal randomness, derives entirely from props via
 * STATUS_CONFIG). Guards against unintended markup/className regressions.
 */
describe("StatusBadge (snapshot)", () => {
  it("renders a Pending badge consistently", () => {
    const { container } = render(<StatusBadge status="Pending" size="md" />);
    expect(container).toMatchSnapshot();
  });

  it("renders a Released badge at lg size consistently", () => {
    const { container } = render(<StatusBadge status="Released" size="lg" />);
    expect(container).toMatchSnapshot();
  });
});
