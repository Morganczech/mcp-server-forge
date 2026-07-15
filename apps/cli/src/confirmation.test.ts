import { describe, expect, it } from "vitest";

import { isConfirmedAnswer } from "./confirmation.js";

describe("isConfirmedAnswer", () => {
  it("accepts only normalized y and yes answers", () => {
    expect(isConfirmedAnswer("y")).toBe(true);
    expect(isConfirmedAnswer("YES")).toBe(true);
    expect(isConfirmedAnswer(" yes ")).toBe(true);
    expect(isConfirmedAnswer("n")).toBe(false);
    expect(isConfirmedAnswer("")).toBe(false);
    expect(isConfirmedAnswer("yes please")).toBe(false);
    expect(isConfirmedAnswer("true")).toBe(false);
  });
});
