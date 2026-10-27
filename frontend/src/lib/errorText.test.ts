import { describe, expect, it } from "vitest";
import { errorDetail, errorTitle } from "./errorText";

describe("error text", () => {
  it("drops a first sentence that only repeats the title", () => {
    const error = { code: "rate_limited", message: "The AI provider is rate-limiting requests. Wait about 7 seconds and try again." };
    expect(errorTitle(error)).toBe("The AI provider is rate-limiting requests");
    expect(errorDetail(error)).toBe("Wait about 7 seconds and try again.");
  });

  it("keeps messages that add information in their first sentence", () => {
    const error = { code: "provider_unavailable", message: "The AI provider is temporarily unavailable or overloaded. Try again shortly." };
    expect(errorDetail(error)).toBe(error.message);
  });

  it("falls back to a generic title for unknown codes", () => {
    expect(errorTitle({ code: "something_new", message: "Details." })).toBe("Something went wrong");
  });
});
