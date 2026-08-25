import { describe, it, expect } from "vitest";
import { resolveTargetWindow, windowsInFrontOf } from "../src/ui.js";
import type { WindowInfo } from "macos-vision";

const win = (over: Partial<WindowInfo> & { windowId: number; app: string }): WindowInfo => ({
  pid: 1,
  title: "",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  layer: 0,
  isOnScreen: true,
  ...over,
});

// Front-to-back, the order CGWindowList returns.
const stack: WindowInfo[] = [
  win({ windowId: 1, app: "Claude", x: 0, y: 29, w: 1496, h: 871 }),
  win({ windowId: 2, app: "Ghostty", x: 623, y: 176, w: 819, h: 642 }),
  win({ windowId: 3, app: "Notes", x: 1600, y: 0, w: 400, h: 400 }),
  win({ windowId: 4, app: "Calendar", x: 0, y: 29, w: 1496, h: 867 }),
];

describe("windowsInFrontOf", () => {
  it("reports nothing for the frontmost window", () => {
    expect(windowsInFrontOf(stack[0], stack)).toEqual([]);
  });

  it("reports the overlapping windows ahead of a buried one", () => {
    expect(windowsInFrontOf(stack[3], stack).map((w) => w.app)).toEqual(["Claude", "Ghostty"]);
  });

  it("ignores windows that are in front but do not overlap", () => {
    // Notes sits off to the side of Ghostty and must not be reported for it.
    expect(windowsInFrontOf(stack[1], stack).map((w) => w.app)).toEqual(["Claude"]);
  });

  it("ignores windows that are not on screen", () => {
    const hidden = [{ ...stack[0], isOnScreen: false }, ...stack.slice(1)];
    expect(windowsInFrontOf(hidden[3], hidden).map((w) => w.app)).toEqual(["Ghostty"]);
  });

  it("says nothing when the target is not in the list", () => {
    expect(windowsInFrontOf(win({ windowId: 99, app: "Ghost" }), stack)).toEqual([]);
  });

  it("treats edge-to-edge adjacency as no overlap", () => {
    const left = win({ windowId: 10, app: "Left", x: 0, y: 0, w: 100, h: 100 });
    const right = win({ windowId: 11, app: "Right", x: 100, y: 0, w: 100, h: 100 });
    expect(windowsInFrontOf(right, [left, right])).toEqual([]);
  });
});

describe("resolveTargetWindow", () => {
  it("resolves by windowId", () => {
    expect(resolveTargetWindow(stack, { windowId: 4 })?.app).toBe("Calendar");
  });

  it("resolves an app by exact name to its frontmost window", () => {
    expect(resolveTargetWindow(stack, { app: "Ghostty" })?.windowId).toBe(2);
  });

  it("resolves an app by case-insensitive prefix, as the library does", () => {
    expect(resolveTargetWindow(stack, { app: "cal" })?.windowId).toBe(4);
  });

  it("prefers windowId over app when both are given", () => {
    expect(resolveTargetWindow(stack, { windowId: 2, app: "Calendar" })?.app).toBe("Ghostty");
  });

  it("returns null rather than guessing", () => {
    expect(resolveTargetWindow(stack, {})).toBeNull();
    expect(resolveTargetWindow(stack, { app: "Xcode" })).toBeNull();
    expect(resolveTargetWindow(stack, { windowId: 99 })).toBeNull();
  });

  it("distinguishes two windows that share a frame exactly", () => {
    // Claude and Calendar are both full-screen here; geometry alone cannot tell
    // them apart, which is why the target is identified by id, not by frame.
    const twins = [
      win({ windowId: 1, app: "Claude", x: 0, y: 29, w: 1496, h: 867 }),
      win({ windowId: 2, app: "Calendar", x: 0, y: 29, w: 1496, h: 867 }),
    ];
    expect(resolveTargetWindow(twins, { app: "Calendar" })?.windowId).toBe(2);
    expect(windowsInFrontOf(twins[1], twins).map((w) => w.app)).toEqual(["Claude"]);
    expect(windowsInFrontOf(twins[0], twins)).toEqual([]);
  });
});
