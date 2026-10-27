import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitAtHighlight, tokenizePlaceholders } from "./highlight";
import { canonicalize, countCharacters, readTranscriptFile } from "./transcript";

describe("canonical text and character limit", () => {
  it("removes one BOM and normalizes line endings like the backend", () => {
    expect(canonicalize("\uFEFFA: hi\r\nB: yo\rC: ok")).toBe("A: hi\nB: yo\nC: ok");
    expect(canonicalize("a\u2028b\u2029c\u0085d")).toBe("a\nb\nc\nd");
  });

  it("counts Unicode code points, matching Python len()", () => {
    expect(countCharacters("A: 🎉🎉🎉\r\n")).toBe(7);
    expect("A: 🎉🎉🎉\n".length).toBe(10); // UTF-16 length differs; the limit must not use it
  });
});

describe("uploads", () => {
  const file = (bytes: BlobPart, name = "meeting.txt") => new File([bytes], name, { type: "text/plain" });

  it("accepts UTF-8 text and canonicalizes it", async () => {
    const result = await readTranscriptFile(file("\uFEFFArun: Hi\r\nMeera: Hello"), 1024);
    expect(result).toEqual({ ok: true, text: "Arun: Hi\nMeera: Hello", name: "meeting.txt" });
  });

  it("rejects non-UTF-8 bytes instead of guessing an encoding", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x3a, 0x00]);
    const result = await readTranscriptFile(file(utf16), 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not UTF-8/);
  });

  it("rejects oversized and non-.txt files without truncating", async () => {
    const big = await readTranscriptFile(file("A: " + "x".repeat(2000)), 1024);
    expect(big.ok).toBe(false);
    const pdf = await readTranscriptFile(file("A: hi", "notes.pdf"), 1024);
    expect(pdf.ok).toBe(false);
  });
});

describe("highlight offsets (UTF-16 code units, shared convention with the backend)", () => {
  it("slices the verified quotation after an emoji", () => {
    // Offsets produced by backend/prism/validation.py for the bundled age-dismissal sample (turn T2).
    const sample = canonicalize(readFileSync(new URL("../../../samples/age-dismissal.txt", import.meta.url), "utf8"));
    const lines = sample.split("\n");
    const t2 = `${lines[1].slice("Meera: ".length)}\n${lines[2]}`;
    const parts = splitAtHighlight(t2, { start: 166, end: 196, occurrences: 1 }, "p95 latency stays under 200 ms");
    expect(parts?.match).toBe("p95 latency stays under 200 ms");
    expect(parts?.before.endsWith("traffic, and ")).toBe(true);
  });

  it("falls back to exact matching when offsets do not line up, and never invents a match", () => {
    expect(splitAtHighlight("We should test. Then test again.", { start: 0, end: 4, occurrences: 2 }, "test")?.before).toBe("We should ");
    expect(splitAtHighlight("Nothing here", { start: 0, end: 4, occurrences: 1 }, "absent")).toBeNull();
  });

  it("keeps bracketed placeholders visible in generated wording", () => {
    expect(tokenizePlaceholders("My concern is [specific technical issue].")).toEqual([
      { kind: "text", value: "My concern is " },
      { kind: "placeholder", value: "[specific technical issue]" },
      { kind: "text", value: "." },
    ]);
  });
});
