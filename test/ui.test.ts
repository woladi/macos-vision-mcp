import { describe, it, expect } from "vitest";
import { findMatches, levenshtein, normalizeText } from "../src/ui.js";
import type { VisionBlock } from "macos-vision";

const block = (text: string, over: Partial<VisionBlock> = {}): VisionBlock => ({
  text,
  x: 0.1,
  y: 0.2,
  width: 0.2,
  height: 0.05,
  confidence: 0.9,
  ...over,
});

describe("normalizeText", () => {
  // The bug this guards against: the whitespace class was written with literal
  // invisible characters, a formatter normalized the leading NBSP to a plain
  // space, and the class silently became the range U+0020–U+200B — which
  // swallows all of ASCII and made this function return "" for every input.
  // find_element and assert_text were then 100% broken with no visible symptom.
  it("preserves ASCII — regression guard for the U+0020–U+200B range bug", () => {
    expect(normalizeText("80 Artifacts")).toBe("80 artifacts");
    expect(normalizeText("Save")).toBe("save");
    expect(normalizeText("abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      "abcdefghijklmnopqrstuvwxyz0123456789",
    );
    // Every printable ASCII character must survive as something non-empty.
    for (let c = 0x21; c <= 0x7e; c++) {
      expect(normalizeText(String.fromCharCode(c))).not.toBe("");
    }
  });

  it("folds unicode spaces to a plain space", () => {
    expect(normalizeText("Zapisz plik")).toBe("zapisz plik"); // NBSP
    expect(normalizeText("Zapisz plik")).toBe("zapisz plik"); // thin space
    expect(normalizeText("Zapisz　plik")).toBe("zapisz plik"); // ideographic
    expect(normalizeText("a​b")).toBe("a b"); // zero-width space
  });

  it("folds the dashes and quotes Vision likes to substitute", () => {
    expect(normalizeText("e‑mail")).toBe("e-mail");
    expect(normalizeText("A—B")).toBe("a-b");
    expect(normalizeText("A−B")).toBe("a-b");
    expect(normalizeText("“Quoted”")).toBe('"quoted"');
    expect(normalizeText("It’s")).toBe("it's");
    expect(normalizeText("A-B")).toBe("a-b"); // ASCII hyphen untouched
  });

  it("collapses whitespace runs and trims", () => {
    expect(normalizeText("  Save   as\n\tPDF  ")).toBe("save as pdf");
  });

  it("respects caseSensitive", () => {
    expect(normalizeText("Save", true)).toBe("Save");
    expect(normalizeText("Save", false)).toBe("save");
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("save", "save")).toBe(0);
    expect(levenshtein("save", "")).toBe(4);
    expect(levenshtein("zapisr", "zapisz")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("findMatches", () => {
  it("matches exactly, ignoring case by default", () => {
    const { matches } = findMatches([block("Zapisz")], "zapisz", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("exact");
    expect(matches[0].score).toBe(1);
  });

  it("matches a substring inside a longer OCR block", () => {
    const { matches } = findMatches([block("80 Artifacts")], "Artifacts", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("substring");
  });

  it("matches fuzzily when OCR misreads a character", () => {
    const { matches } = findMatches([block("Zapisr")], "Zapisz", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("fuzzy");
    expect(matches[0].score).toBeGreaterThan(0.75);
  });

  it("reports a near miss instead of a match below the threshold", () => {
    const { matches, nearMisses } = findMatches([block("Zapmsx")], "Zapisz", null);
    expect(matches).toHaveLength(0);
    expect(nearMisses.length).toBeGreaterThan(0);
  });

  it("returns nothing for unrelated text", () => {
    const { matches, nearMisses } = findMatches([block("Anuluj")], "Zapisz", null);
    expect(matches).toHaveLength(0);
    expect(nearMisses).toHaveLength(0);
  });

  it("skips blocks below minConfidence", () => {
    const low = [block("Zapisz", { confidence: 0.2 })];
    expect(findMatches(low, "Zapisz", null).matches).toHaveLength(0);
    expect(findMatches(low, "Zapisz", null, { minConfidence: 0.1 }).matches).toHaveLength(1);
  });

  it("ranks better matches first", () => {
    const blocks = [block("Zapisr"), block("Zapisz"), block("Zapisz jako")];
    const { matches } = findMatches(blocks, "Zapisz", null);
    expect(matches[0].text).toBe("Zapisz"); // exact beats substring beats fuzzy
    expect(matches.map((m) => m.method)).toEqual(["exact", "substring", "fuzzy"]);
  });

  it("maps a bbox centre to global screen points when a frame is given", () => {
    // Block centre is at (0.2, 0.225) of an image covering 1000×500pt at (100, 50).
    const frame = { x: 100, y: 50, w: 1000, h: 500 };
    const { matches } = findMatches([block("Zapisz")], "Zapisz", frame);
    expect(matches[0].clickPoint).toEqual({ x: 300, y: 162.5 });
  });

  it("returns a null clickPoint without a frame", () => {
    const { matches } = findMatches([block("Zapisz")], "Zapisz", null);
    expect(matches[0].clickPoint).toBeNull();
  });

  it("honours caseSensitive on the exact path", () => {
    const blocks = [block("zapisz")];
    // Same case → exact. Different case → no longer exact; fuzzy may still
    // accept it, since to edit distance a case flip is just one substitution.
    expect(findMatches(blocks, "zapisz", null, { caseSensitive: true }).matches[0].method).toBe(
      "exact",
    );
    expect(
      findMatches(blocks, "Zapisz", null, { caseSensitive: true }).matches[0]?.method,
    ).not.toBe("exact");
    // Insensitive by default, so the same pair is exact.
    expect(findMatches(blocks, "Zapisz", null).matches[0].method).toBe("exact");
  });

  it("case-sensitive substring matching respects case", () => {
    const blocks = [block("Save As")];
    expect(findMatches(blocks, "Save", null, { caseSensitive: true }).matches[0].method).toBe(
      "substring",
    );
    expect(findMatches(blocks, "save", null, { caseSensitive: true }).matches).toHaveLength(0);
  });

  it("finds text across the unicode substitutions Vision makes", () => {
    // OCR read a non-breaking space and a curly apostrophe; the query is typed plainly.
    const { matches } = findMatches([block("It’s here")], "It's here", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("exact");
  });
});
