import { describe, expect, it } from "vitest";
import { MANUAL_SCROLL_GRACE_MS, recentlyScrolledByHand } from "./useFollowActive";

describe("recentlyScrolledByHand", () => {
  it("holds the list during the grace period after a manual scroll", () => {
    expect(recentlyScrolledByHand(10_000, 10_000 - MANUAL_SCROLL_GRACE_MS + 1)).toBe(true);
  });

  it("follows the current item again once the grace period is over", () => {
    expect(recentlyScrolledByHand(10_000, 10_000 - MANUAL_SCROLL_GRACE_MS)).toBe(false);
  });

  it("follows when the operator never scrolled", () => {
    expect(recentlyScrolledByHand(0, -Infinity)).toBe(false);
  });
});
