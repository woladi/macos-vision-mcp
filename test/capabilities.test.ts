import { describe, it, expect, vi, beforeEach } from "vitest";

const visionCapabilities = vi.fn();
const checkPermissions = vi.fn();
const listDisplays = vi.fn();
const listWindows = vi.fn();
const captureScreen = vi.fn();

vi.mock("macos-vision", () => ({
  visionCapabilities: (...a: unknown[]) => visionCapabilities(...a),
  checkPermissions: (...a: unknown[]) => checkPermissions(...a),
  listDisplays: (...a: unknown[]) => listDisplays(...a),
  listWindows: (...a: unknown[]) => listWindows(...a),
  captureScreen: (...a: unknown[]) => captureScreen(...a),
}));

const { capabilities, obstructionFor, resolveImageSource } = await import("../src/ui.js");

interface Report {
  ready: boolean;
  blockers: string[];
  error?: string;
  helperVersion?: string;
  capture?: { windowCapture: boolean; regionCapture: boolean; windowTitles: boolean };
  permissions?: unknown;
  displays?: unknown;
  privacy: string;
}

const vision = {
  macosVersion: "26.5.2",
  helperVersion: "2",
  ocrLanguages: ["en"],
  features: { ocr: true },
};
const displays = [{ displayId: 1, isMain: true, x: 0, y: 0, w: 1496, h: 967, scale: 2 }];
const perms = (over: Partial<Record<string, boolean>> = {}) => ({
  screenRecording: true,
  accessibility: true,
  screenLocked: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  visionCapabilities.mockResolvedValue(vision);
  listDisplays.mockResolvedValue(displays);
});

describe("capabilities", () => {
  it("reports ready with no blockers when everything is granted", async () => {
    checkPermissions.mockResolvedValue(perms());
    const r = (await capabilities()) as Report;
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.capture).toEqual({
      engine: "screencapture",
      windowCapture: true,
      regionCapture: true,
      windowTitles: true,
    });
  });

  it("surfaces the helper version the library actually reports", async () => {
    // The description used to promise a `uiHelper` field that nothing produced.
    checkPermissions.mockResolvedValue(perms());
    const r = (await capabilities()) as Record<string, unknown>;
    expect(r.helperVersion).toBe("2");
    expect(r).not.toHaveProperty("uiHelper");
  });

  it("does not claim capture works when Screen Recording is missing", async () => {
    // The regression: these flags were hardcoded true and were returned unchanged
    // on a machine where every capture call was failing.
    checkPermissions.mockResolvedValue(perms({ screenRecording: false }));
    const r = (await capabilities()) as Report;
    expect(r.ready).toBe(false);
    expect(r.capture!.windowCapture).toBe(false);
    expect(r.capture!.regionCapture).toBe(false);
    expect(r.capture!.windowTitles).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/Screen Recording/);
  });

  it("does not claim capture works while the screen is locked", async () => {
    checkPermissions.mockResolvedValue(perms({ screenLocked: true }));
    const r = (await capabilities()) as Report;
    expect(r.ready).toBe(false);
    expect(r.capture!.windowCapture).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/locked/);
  });

  it("keeps window titles available when only Accessibility is missing", async () => {
    checkPermissions.mockResolvedValue(perms({ accessibility: false }));
    const r = (await capabilities()) as Report;
    expect(r.ready).toBe(true);
    expect(r.capture!.windowTitles).toBe(true);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toMatch(/ui_snapshot/);
  });

  it("lists every blocker at once rather than only the first", async () => {
    checkPermissions.mockResolvedValue({
      screenRecording: false,
      accessibility: false,
      screenLocked: true,
    });
    const r = (await capabilities()) as Report;
    expect(r.blockers).toHaveLength(3);
  });

  it("makes no capability claims when the helper itself fails", async () => {
    checkPermissions.mockRejectedValue(new Error("ui-helper not found"));
    const r = (await capabilities()) as Report;
    expect(r.error).toMatch(/ui-helper not found/);
    expect(r.ready).toBe(false);
    expect(r).not.toHaveProperty("capture");
    expect(r).not.toHaveProperty("permissions");
    expect(r.blockers).toHaveLength(1);
  });

  it("states the privacy invariant on both paths", async () => {
    checkPermissions.mockResolvedValue(perms());
    expect(((await capabilities()) as Report).privacy).toMatch(/stay on disk/);
    checkPermissions.mockRejectedValue(new Error("boom"));
    expect(((await capabilities()) as Report).privacy).toMatch(/stay on disk/);
  });
});

describe("resolveImageSource", () => {
  it("uses a provided path without capturing", async () => {
    const r = await resolveImageSource({ path: "/tmp/shot.png" });
    expect(captureScreen).not.toHaveBeenCalled();
    expect(r).toEqual({ imagePath: "/tmp/shot.png", screenFrame: null });
  });

  it("carries a provided frame through so clickPoints can be mapped", async () => {
    const frame = { x: 10, y: 20, w: 300, h: 400 };
    expect((await resolveImageSource({ path: "/tmp/shot.png", frame })).screenFrame).toEqual(frame);
  });

  it("prefers the provided path over live capture targeting", async () => {
    await resolveImageSource({ path: "/tmp/shot.png", app: "Safari" });
    expect(captureScreen).not.toHaveBeenCalled();
  });

  it("captures when no path is given and returns the capture", async () => {
    const capture = { path: "/tmp/cap.png", frame: { x: 0, y: 0, w: 100, h: 100 } };
    captureScreen.mockResolvedValue(capture);
    const r = await resolveImageSource({ app: "Safari" });
    expect(captureScreen).toHaveBeenCalledWith({ app: "Safari" });
    expect(r).toEqual({ imagePath: capture.path, screenFrame: capture.frame, capture });
  });
});

describe("obstructionFor", () => {
  const frame = { x: 0, y: 29, w: 1496, h: 867 };
  const w = (windowId: number, app: string, box = frame) => ({
    windowId,
    app,
    title: "",
    pid: 1,
    layer: 0,
    isOnScreen: true,
    ...box,
  });

  it("reports the apps in front of a buried window", async () => {
    listWindows.mockResolvedValue([w(1, "Claude"), w(2, "Calendar")]);
    const r = await obstructionFor({ app: "Calendar" }, frame);
    expect(r!.obscuredBy.map((o) => o.app)).toEqual(["Claude"]);
    expect(r!.note).toMatch(/raise the target application/);
  });

  it("stays silent for a frontmost window", async () => {
    listWindows.mockResolvedValue([w(1, "Claude"), w(2, "Calendar")]);
    expect(await obstructionFor({ app: "Claude" }, frame)).toBeUndefined();
  });

  it("stays silent when the target cannot be identified", async () => {
    listWindows.mockResolvedValue([w(1, "Claude")]);
    expect(await obstructionFor({ app: "Xcode" }, frame)).toBeUndefined();
  });

  it("stays silent when the window moved after the capture", async () => {
    // A stale layout would be a claim about a screen that no longer exists.
    listWindows.mockResolvedValue([w(1, "Claude"), w(2, "Calendar", { x: 5, y: 5, w: 10, h: 10 })]);
    expect(await obstructionFor({ app: "Calendar" }, frame)).toBeUndefined();
  });

  it("never throws — the report is advisory, not part of the result", async () => {
    listWindows.mockRejectedValue(new Error("helper died"));
    await expect(obstructionFor({ app: "Calendar" }, frame)).resolves.toBeUndefined();
  });
});
