import { describe, it, expect } from "vitest";
import { findMatches, isWholeWordHit, levenshtein, normalizeText } from "../src/ui.js";
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
  it("preserves ASCII — regression guard for the U+0020–U+200B range bug", () => {
    expect(normalizeText("Save")).toBe("save");
    expect(normalizeText("abcdefghijklmnopqrstuvwxyz0123456789", true)).toBe(
      "abcdefghijklmnopqrstuvwxyz0123456789",
    );
    expect(normalizeText("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", true)).toBe(
      "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    );
  });

  it("folds unicode spaces to a plain space", () => {
    expect(normalizeText("a b")).toBe("a b");
    expect(normalizeText("a b")).toBe("a b");
    expect(normalizeText("a　b")).toBe("a b");
  });

  it("folds the dashes and quotes Vision likes to substitute", () => {
    expect(normalizeText("don’t")).toBe("don't");
    expect(normalizeText("“quoted”")).toBe('"quoted"');
    expect(normalizeText("a—b")).toBe("a-b");
    expect(normalizeText("a−b")).toBe("a-b");
  });

  it("collapses whitespace runs and trims", () => {
    expect(normalizeText("  Save   All  ")).toBe("save all");
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
    expect(levenshtein("", "save")).toBe(4);
    expect(levenshtein("save", "sav3")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("isWholeWordHit", () => {
  it("accepts a query bounded by non-word characters", () => {
    expect(isWholeWordHit("don't save", "save")).toBe(true);
    expect(isWholeWordHit("save changes", "save")).toBe(true);
    expect(isWholeWordHit("save", "save")).toBe(true);
  });

  it("rejects a query buried inside a longer word", () => {
    expect(isWholeWordHit("unsaved changes", "save")).toBe(false);
    expect(isWholeWordHit("autosaved", "save")).toBe(false);
  });

  it("keeps scanning past a buried occurrence to find a bounded one", () => {
    // "save" appears mid-word first and standalone second.
    expect(isWholeWordHit("unsaved, save now", "save")).toBe(true);
  });

  it("treats non-ASCII letters as word characters — \\b would not", () => {
    expect(isWholeWordHit("zapiszło", "zapisz")).toBe(false);
    expect(isWholeWordHit("nie zapisuj — zapisz", "zapisz")).toBe(true);
  });
});

describe("findMatches", () => {
  it("matches exactly, ignoring case by default", () => {
    const { matches } = findMatches([block("Save")], "save", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("exact");
    expect(matches[0].score).toBe(1);
    expect(matches[0].wholeWord).toBe(true);
  });

  it("matches a substring inside a longer OCR block", () => {
    const { matches } = findMatches([block("Save Changes")], "Save", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("substring");
  });

  it("matches fuzzily when OCR misreads a character", () => {
    const { matches } = findMatches([block("Sav3")], "Save", null);
    expect(matches).toHaveLength(1);
    expect(matches[0].method).toBe("fuzzy");
    expect(matches[0].wholeWord).toBe(true);
  });

  it("reports a near miss instead of a match below the threshold", () => {
    const { matches, nearMisses } = findMatches([block("Szve")], "Save", null, {
      fuzzyThreshold: 0.8,
    });
    expect(matches).toHaveLength(0);
    expect(nearMisses).toHaveLength(1);
  });

  it("returns nothing for unrelated text", () => {
    const { matches, nearMisses } = findMatches([block("Preferences")], "Save", null);
    expect(matches).toHaveLength(0);
    expect(nearMisses).toHaveLength(0);
  });

  it("skips blocks below minConfidence", () => {
    const { matches } = findMatches([block("Save", { confidence: 0.1 })], "Save", null);
    expect(matches).toHaveLength(0);
  });

  it("returns a null clickPoint without a frame", () => {
    const { matches } = findMatches([block("Save")], "Save", null);
    expect(matches[0].clickPoint).toBeNull();
  });

  it("maps a bbox centre to global screen points when a frame is given", () => {
    const b = block("Save", { x: 0.25, y: 0.5, width: 0.1, height: 0.1 });
    const { matches } = findMatches([b], "Save", { x: 100, y: 200, w: 1000, h: 800 });
    expect(matches[0].clickPoint).toEqual({ x: 100 + 0.3 * 1000, y: 200 + 0.55 * 800 });
  });

  it("returns integer clickPoints — drivers reject fractional coordinates", () => {
    const b = block("Save", { x: 0.333, y: 0.333, width: 0.111, height: 0.111 });
    const { matches } = findMatches([b], "Save", { x: 0, y: 0, w: 1497, h: 869 });
    expect(Number.isInteger(matches[0].clickPoint!.x)).toBe(true);
    expect(Number.isInteger(matches[0].clickPoint!.y)).toBe(true);
  });

  it("honours caseSensitive on the exact path", () => {
    const { matches } = findMatches([block("SAVE")], "Save", null, { caseSensitive: true });
    expect(matches.every((m) => m.method !== "exact")).toBe(true);
  });

  it("case-sensitive substring matching respects case", () => {
    expect(
      findMatches([block("Save Changes")], "save", null, { caseSensitive: true }).matches,
    ).toHaveLength(0);
    expect(
      findMatches([block("Save Changes")], "Save", null, { caseSensitive: true }).matches,
    ).toHaveLength(1);
  });

  it("finds text across the unicode substitutions Vision makes", () => {
    const { matches } = findMatches([block("Don’t Save")], "Don't Save", null);
    expect(matches[0].method).toBe("exact");
  });
});

describe("findMatches — substring ranking", () => {
  // The bug this pins: every substring scored a flat 0.9, so the sort fell through
  // to OCR confidence and then to emission order. On a real Save/Don't Save dialog
  // that returned "Don't Save" as the best answer to the query "Save".
  it("ranks a prefix label above one where the query only trails", () => {
    const { matches } = findMatches([block("Don't Save"), block("Save Changes")], "Save", null);
    expect(matches.map((m) => m.text)).toEqual(["Save Changes", "Don't Save"]);
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it("ranks a buried substring below every whole-word one", () => {
    const { matches } = findMatches(
      [block("Unsaved changes"), block("Don't Save"), block("Save Changes")],
      "Save",
      null,
    );
    expect(matches[matches.length - 1].text).toBe("Unsaved changes");
    expect(matches[matches.length - 1].wholeWord).toBe(false);
  });

  it("keeps every substring score strictly below an exact match", () => {
    const { matches } = findMatches(
      [block("Save"), block("Save All"), block("Saved")],
      "Save",
      null,
    );
    expect(matches[0].text).toBe("Save");
    expect(matches[0].score).toBe(1);
    for (const m of matches.slice(1)) expect(m.score).toBeLessThan(1);
  });

  it("prefers the label the query covers more of, all else equal", () => {
    const { matches } = findMatches(
      [block("Save all open documents"), block("Save all")],
      "Save all",
      null,
    );
    expect(matches[0].text).toBe("Save all");
  });

  it("sorts by score first and OCR confidence only as a tie-break", () => {
    const { matches } = findMatches(
      [block("Don't Save", { confidence: 1 }), block("Save Changes", { confidence: 0.5 })],
      "Save",
      null,
    );
    expect(matches[0].text).toBe("Save Changes");
  });
});
