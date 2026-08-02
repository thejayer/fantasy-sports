/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberAvatar } from "@/components/MemberAvatar";

describe("MemberAvatar", () => {
  it("renders an image when given an https URL", () => {
    const { container } = render(
      <MemberAvatar
        name="Jay R"
        imageUrl="https://lh3.googleusercontent.com/a/photo"
      />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe(
      "https://lh3.googleusercontent.com/a/photo",
    );
  });

  it("falls back to a monogram without a usable image", () => {
    render(<MemberAvatar name="Jay R" imageUrl="http://insecure.example/x" />);
    expect(screen.getByText("JR")).toBeTruthy();
  });
});
