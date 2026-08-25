import { describe, it, expect } from "vitest";
import { findMatches, splitByAssertionStrength } from "../src/ui.js";
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

/** What assert_text computes, without spawning the server. */
const verdict = (blocks: VisionBlock[], expectText: string, mode: "present" | "absent") => {
  const { matches } = findMatches(blocks, expectText, null);
  const { qualifying, incidental } = splitByAssertionStrength(matches);
  return {
    satisfied: mode === "present" ? qualifying.length > 0 : qualifying.length === 0,
    qualifying,
    incidental,
  };
};

describe("splitByAssertionStrength", () => {
  it("keeps exact and fuzzy matches as evidence", () => {
    const { matches } = findMatches([block("Save"), block("Sav3")], "Save", null);
    const { qualifying, incidental } = splitByAssertionStrength(matches);
    expect(qualifying).toHaveLength(2);
    expect(incidental).toHaveLength(0);
  });

  it("keeps a whole-word substring as evidence", () => {
    const { matches } = findMatches([block("Don't Save")], "Save", null);
    expect(splitByAssertionStrength(matches).qualifying).toHaveLength(1);
  });

  it("demotes a mid-word substring to incidental", () => {
    const { matches } = findMatches([block("Unsaved changes")], "Save", null);
    const { qualifying, incidental } = splitByAssertionStrength(matches);
    expect(qualifying).toHaveLength(0);
    expect(incidental.map((m) => m.text)).toEqual(["Unsaved changes"]);
  });

  it("never drops a match — every input lands in exactly one bucket", () => {
    const { matches } = findMatches(
      [block("Save"), block("Don't Save"), block("Unsaved changes"), block("autosaved")],
      "Save",
      null,
    );
    const { qualifying, incidental } = splitByAssertionStrength(matches);
    expect(qualifying.length + incidental.length).toBe(matches.length);
  });
});

describe("assert_text verdicts — regressions from 0.6.7", () => {
  // Both of these shipped. The screen showed "Unsaved changes" and "Your document
  // has been autosaved." and no Save button anywhere.
  const autosavedScreen = [
    block("Unsaved changes"),
    block("Your document has been autosaved."),
    block("OK"),
  ];

  it("does not report a Save button present because 'Unsaved' contains 'save'", () => {
    const v = verdict(autosavedScreen, "Save", "present");
    expect(v.satisfied).toBe(false);
    expect(v.incidental.map((m) => m.text)).toEqual([
      "Unsaved changes",
      "Your document has been autosaved.",
    ]);
  });

  it("reports a Save button absent when it genuinely is", () => {
    expect(verdict(autosavedScreen, "Save", "absent").satisfied).toBe(true);
  });

  it("still reports the incidental hits when the assertion passes", () => {
    // The verdict must not be reached by pretending OCR saw less than it did.
    expect(verdict(autosavedScreen, "Save", "absent").incidental).toHaveLength(2);
  });

  it("still fails 'absent' when the label really is on screen", () => {
    expect(verdict([...autosavedScreen, block("Save")], "Save", "absent").satisfied).toBe(false);
  });

  it("still passes 'present' for a label that really is on screen", () => {
    expect(verdict([...autosavedScreen, block("Save")], "Save", "present").satisfied).toBe(true);
  });

  it("passes 'present' on a whole-word substring — a real button reading 'Save Changes'", () => {
    expect(verdict([block("Save Changes")], "Save", "present").satisfied).toBe(true);
  });

  it("is symmetric: the same evidence decides both modes", () => {
    for (const blocks of [autosavedScreen, [...autosavedScreen, block("Save")]]) {
      const present = verdict(blocks, "Save", "present").satisfied;
      const absent = verdict(blocks, "Save", "absent").satisfied;
      expect(present).toBe(!absent);
    }
  });
});
