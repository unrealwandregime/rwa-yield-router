import { describe, expect, it } from "vitest";

import { ratioToPercentagePoints } from "./handlers.js";

describe("worker observation normalization", () => {
  it("converts API decimal ratios to exact percentage points", () => {
    expect(ratioToPercentagePoints("0.043210000000000001")).toBe("4.3210000000000001");
    expect(ratioToPercentagePoints("0")).toBe("0");
    expect(ratioToPercentagePoints("1")).toBe("100");
  });
});
