// UI-testing layer: screen capture + window introspection + local text matching.
//
// Privacy invariant: no function in this module ever returns image bytes to the
// model. Captures land on disk; only paths, geometry, and extracted text flow back.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { VisionBlock } from "macos-vision";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const UI_HELPER = join(pkgRoot, "bin", "ui-helper");
const UI_HELPER_SRC = join(pkgRoot, "src", "native", "ui-helper.swift");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WindowInfo {
  windowId: number;
  app: string;
  pid: number;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  isOnScreen: boolean;
}

interface DisplayInfo {
  displayId: number;
  isMain: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

interface PermissionsInfo {
  screenRecording: boolean;
  accessibility: boolean;
}

/** Rectangle in global screen points, top-left origin (CGEvent click space). */
export interface ScreenFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureResult {
  path: string;
  /** Pixel dimensions of the PNG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Screen region the image covers, in global screen points (top-left origin). */
  frame: ScreenFrame;
  scale: number;
  capturedAt: string;
  target: string;
}

export interface ElementMatch {
  text: string;
  confidence: number;
  score: number;
  method: "exact" | "substring" | "fuzzy";
  /** Normalized 0–1 bbox within the captured image (top-left origin). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Center of the element in global screen points — feed this to any click driver. */
  clickPoint: { x: number; y: number } | null;
}

// ─── ui-helper (lazy compile) ────────────────────────────────────────────────
// Interim distribution: compiled with swiftc on first use. The proper home is the
// macos-vision package's prebuilt-binary pipeline (install-native.js) — tracked in
// docs/PLAN-ui-testing-vision.md.

let helperReady = false;

async function ensureUiHelper(): Promise<void> {
  if (helperReady) return;
  if (existsSync(UI_HELPER)) {
    helperReady = true;
    return;
  }
  if (!existsSync(UI_HELPER_SRC)) {
    throw new Error(`ui-helper binary missing and source not found at ${UI_HELPER_SRC}`);
  }
  mkdirSync(dirname(UI_HELPER), { recursive: true });
  try {
    await execFileAsync("swiftc", ["-O", UI_HELPER_SRC, "-o", UI_HELPER], {
      timeout: 120_000,
    });
  } catch (err) {
    throw new Error(
      `Could not compile ui-helper (requires Xcode Command Line Tools: xcode-select --install). ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  helperReady = true;
}

async function runUiHelper<T>(...args: string[]): Promise<T> {
  await ensureUiHelper();
  const { stdout } = await execFileAsync(UI_HELPER, args, { timeout: 15_000 });
  return JSON.parse(stdout) as T;
}

export const listWindows = (includeAll = false): Promise<WindowInfo[]> =>
  runUiHelper<WindowInfo[]>("--windows", ...(includeAll ? ["--all"] : []));

const listDisplays = (): Promise<DisplayInfo[]> => runUiHelper<DisplayInfo[]>("--displays");

const checkPermissions = (): Promise<PermissionsInfo> =>
  runUiHelper<PermissionsInfo>("--permissions");

// ─── Capture ─────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  windowId?: number;
  /** App name (exact or case-insensitive prefix) — its frontmost window wins. */
  app?: string;
  /** Region in global screen points, top-left origin. */
  rect?: ScreenFrame;
  displayId?: number;
  outPath?: string;
}

function capturePath(outPath?: string): string {
  if (outPath) return outPath;
  const dir = join(tmpdir(), "macos-vision-mcp");
  mkdirSync(dir, { recursive: true });
  return join(dir, `capture-${Date.now()}.png`);
}

/** Width/height straight from the PNG IHDR header — no subprocess. */
async function pngPixelSize(path: string): Promise<{ w: number; h: number }> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 16); // IHDR starts at byte 8; width/height at 16/20
    return { w: buf.readUInt32BE(0), h: buf.readUInt32BE(4) };
  } finally {
    await fh.close();
  }
}

async function resolveWindow(opts: CaptureOptions): Promise<WindowInfo> {
  const windows = await listWindows();
  if (opts.windowId != null) {
    const win = windows.find((w) => w.windowId === opts.windowId);
    if (!win) throw new Error(`Window ${opts.windowId} not found (use list_windows)`);
    return win;
  }
  if (opts.app) {
    const q = opts.app.toLowerCase();
    // CGWindowList is front-to-back — first match is the frontmost window of that app.
    // App-name matching only: title search would silently capture the wrong app.
    const win = windows.find((w) => w.app.toLowerCase() === q || w.app.toLowerCase().startsWith(q));
    if (!win) {
      const apps = [...new Set(windows.map((w) => w.app))].join(", ");
      throw new Error(`No on-screen window matches app "${opts.app}". Visible apps: ${apps}`);
    }
    return win;
  }
  throw new Error("window target requires windowId or app");
}

// Screen Recording can only change for this process via an app restart, so one
// successful preflight is valid for the process lifetime.
let screenRecordingOk = false;

export async function captureScreen(opts: CaptureOptions = {}): Promise<CaptureResult> {
  if (!screenRecordingOk) {
    const perms = await checkPermissions();
    if (!perms.screenRecording) {
      throw new Error(
        "Screen Recording permission missing. Grant it to the app hosting this MCP server " +
          "(Terminal / Claude Desktop / Cursor) in System Settings → Privacy & Security → Screen Recording, then restart it.",
      );
    }
    screenRecordingOk = true;
  }

  const mode = opts.windowId != null || opts.app ? "window" : opts.rect ? "region" : "display";
  const out = capturePath(opts.outPath);
  const args = ["-x", "-t", "png"];
  let frame: ScreenFrame;
  let targetDesc: string;

  if (mode === "window") {
    const win = await resolveWindow(opts);
    args.push("-o", "-l", String(win.windowId));
    frame = { x: win.x, y: win.y, w: win.w, h: win.h };
    targetDesc = `window ${win.windowId} (${win.app}${win.title ? `: ${win.title}` : ""})`;
  } else if (mode === "region") {
    const { x, y, w, h } = opts.rect!;
    args.push(`-R${x},${y},${w},${h}`);
    frame = { x, y, w, h };
    targetDesc = `region ${x},${y} ${w}×${h}`;
  } else {
    const displays = await listDisplays();
    const display =
      opts.displayId != null
        ? displays.find((d) => d.displayId === opts.displayId)
        : (displays.find((d) => d.isMain) ?? displays[0]);
    if (!display) throw new Error(`Display ${opts.displayId} not found`);
    const idx = displays.indexOf(display) + 1; // screencapture -D is 1-based ordinal
    args.push("-D", String(idx));
    frame = { x: display.x, y: display.y, w: display.w, h: display.h };
    targetDesc = `display ${display.displayId}`;
  }

  args.push(out);
  try {
    await execFileAsync("/usr/sbin/screencapture", args, { timeout: 15_000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(
      `screencapture failed for ${targetDesc}${stderr ? ` (${stderr})` : ""}. ` +
        `Common causes: the screen is locked or asleep, or the window was closed.`,
    );
  }
  if (!existsSync(out)) {
    throw new Error(`screencapture produced no file for ${targetDesc} — is the window on screen?`);
  }
  const px = await pngPixelSize(out);
  return {
    path: out,
    pixelWidth: px.w,
    pixelHeight: px.h,
    frame,
    scale: frame.w > 0 ? px.w / frame.w : 1,
    capturedAt: new Date().toISOString(),
    target: targetDesc,
  };
}

/**
 * Shared source resolution for OCR-consuming tools: either use a pre-captured
 * image (path + optional frame for screen-point mapping) or capture live.
 */
export async function resolveImageSource(
  opts: CaptureOptions & { path?: string; frame?: ScreenFrame },
): Promise<{ imagePath: string; screenFrame: ScreenFrame | null; capture?: CaptureResult }> {
  if (opts.path) {
    return { imagePath: opts.path, screenFrame: opts.frame ?? null };
  }
  const capture = await captureScreen(opts);
  return { imagePath: capture.path, screenFrame: capture.frame, capture };
}

// ─── Text normalization & matching ───────────────────────────────────────────

/**
 * Vision likes to swap dashes/quotes; UI strings mix NBSP and space. Flatten all of it.
 *
 * Every class below uses \u escapes on purpose. Written as literal characters, the
 * invisible ones are indistinguishable in an editor and a formatter can silently
 * rewrite one — an NBSP normalized to a plain space turns the whitespace class into
 * the range U+0020-U+200B, which swallows all of ASCII and makes this function
 * return "" for every input. That shipped once; keep the escapes.
 */
function normalizeText(s: string, caseSensitive = false): string {
  let t = s
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!caseSensitive) t = t.toLowerCase();
  return t;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

function bboxCenterToScreenPoint(
  bbox: { x: number; y: number; width: number; height: number },
  frame: ScreenFrame | null,
): { x: number; y: number } | null {
  if (!frame) return null;
  return {
    x: Math.round((frame.x + (bbox.x + bbox.width / 2) * frame.w) * 10) / 10,
    y: Math.round((frame.y + (bbox.y + bbox.height / 2) * frame.h) * 10) / 10,
  };
}

export interface MatchOptions {
  caseSensitive?: boolean;
  /** Minimum fuzzy similarity (0–1) for a fuzzy match to count. Default 0.75. */
  fuzzyThreshold?: number;
  minConfidence?: number;
}

export function findMatches(
  blocks: VisionBlock[],
  query: string,
  frame: ScreenFrame | null,
  opts: MatchOptions = {},
): { matches: ElementMatch[]; nearMisses: ElementMatch[] } {
  const caseSensitive = opts.caseSensitive ?? false;
  const fuzzyThreshold = opts.fuzzyThreshold ?? 0.75;
  const minConfidence = opts.minConfidence ?? 0.3;
  const nearMissThreshold = fuzzyThreshold - 0.2;
  const q = normalizeText(query, caseSensitive);

  const matches: ElementMatch[] = [];
  const nearMisses: ElementMatch[] = [];

  for (const block of blocks) {
    if (block.confidence < minConfidence) continue;
    const t = normalizeText(block.text, caseSensitive);
    if (!t) continue;

    const bbox = { x: block.x, y: block.y, width: block.width, height: block.height };
    const toMatch = (score: number, method: ElementMatch["method"]): ElementMatch => ({
      text: block.text,
      confidence: block.confidence,
      score,
      method,
      bbox,
      clickPoint: bboxCenterToScreenPoint(bbox, frame),
    });

    if (t === q) {
      matches.push(toMatch(1, "exact"));
    } else if (t.includes(q) && q.length >= 2) {
      matches.push(toMatch(0.9, "substring"));
    } else {
      // Length gate: dist >= |Δlen|, so blocks too different in length can never
      // reach even the near-miss threshold — skip the O(m×n) DP for them.
      const maxLen = Math.max(t.length, q.length);
      if (Math.abs(t.length - q.length) / maxLen > 1 - nearMissThreshold) continue;
      const sim = 1 - levenshtein(t, q) / maxLen;
      const score = Math.round(sim * 100) / 100;
      if (sim >= fuzzyThreshold) {
        matches.push(toMatch(score, "fuzzy"));
      } else if (sim >= nearMissThreshold) {
        nearMisses.push(toMatch(score, "fuzzy"));
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  nearMisses.sort((a, b) => b.score - a.score);
  return { matches, nearMisses: nearMisses.slice(0, 5) };
}

// ─── Capability report ───────────────────────────────────────────────────────

let macosVersionPromise: Promise<string> | undefined;

export async function capabilities(): Promise<object> {
  macosVersionPromise ??= execFileAsync("sw_vers", ["-productVersion"]).then((r) =>
    r.stdout.trim(),
  );
  const staticInfo = {
    capture: { engine: "screencapture", windowCapture: true, regionCapture: true },
    privacy: "captures stay on disk; tools return only paths, geometry, and extracted text",
  };
  try {
    const [macosVersion, permissions, displays] = await Promise.all([
      macosVersionPromise,
      checkPermissions(),
      listDisplays(),
    ]);
    return { macosVersion, permissions, displays, ...staticInfo };
  } catch (err) {
    return {
      macosVersion: await macosVersionPromise.catch(() => "unknown"),
      error: err instanceof Error ? err.message : String(err),
      ...staticInfo,
    };
  }
}
