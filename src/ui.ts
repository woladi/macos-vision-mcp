// MCP-side UI layer: source resolution, local text matching, and honesty about
// what this machine can actually do right now.
//
// Capture, window/display introspection and permissions live in `macos-vision`,
// which owns the native-helper pipeline and ships `ui-helper` prebuilt. This
// module keeps only what is specific to serving these as MCP tools.
//
// Privacy invariant: nothing here ever returns image bytes to the model.
// Captures land on disk; only paths, geometry, and extracted text flow back.

import {
  captureScreen,
  checkPermissions,
  listDisplays,
  listWindows,
  visionCapabilities,
  type CaptureOptions,
  type CaptureResult,
  type ScreenFrame,
  type VisionBlock,
  type WindowInfo,
} from "macos-vision";

export { captureScreen, listWindows, listDisplays, checkPermissions } from "macos-vision";
export type {
  CaptureResult,
  ScreenFrame,
  WindowInfo,
  DisplayInfo,
  PermissionsInfo,
} from "macos-vision";

export interface ElementMatch {
  text: string;
  confidence: number;
  score: number;
  method: "exact" | "substring" | "fuzzy";
  /**
   * True when the query occupies whole words in the block — "Save" in "Don't Save",
   * but not "Save" inside "Unsaved". A mid-word hit is a coincidence of spelling, not
   * evidence that the label is on screen, so assertions must not rest on one alone.
   */
  wholeWord: boolean;
  /** Normalized 0–1 bbox within the captured image (top-left origin). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Center of the element in global screen points — feed this to any click driver. */
  clickPoint: { x: number; y: number } | null;
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

// ─── Occlusion ───────────────────────────────────────────────────────────────

/**
 * Window capture pierces occlusion — `screencapture -l` returns the target's own
 * pixels even when it is buried. A click driver does not: it hits whatever is on
 * top at that point. So a clickPoint derived from a buried window aims at another
 * app entirely. Report the windows standing in front of the captured region so the
 * caller can raise the target first instead of clicking blind.
 */
export function windowsInFrontOf(
  target: WindowInfo,
  windows: WindowInfo[],
): { app: string; title: string; windowId: number }[] {
  const at = windows.findIndex((w) => w.windowId === target.windowId);
  if (at < 0) return [];
  return windows
    .slice(0, at)
    .filter(
      (w) =>
        w.isOnScreen &&
        w.x < target.x + target.w &&
        w.x + w.w > target.x &&
        w.y < target.y + target.h &&
        w.y + w.h > target.y,
    )
    .map((w) => ({ app: w.app, title: w.title, windowId: w.windowId }));
}

/**
 * Which window a capture targeted, by the same rule `macos-vision` applies:
 * windowId wins, otherwise the frontmost window of an app matched exactly or by
 * case-insensitive prefix. Identifying the target by geometry instead would be
 * ambiguous — two maximized windows share a frame exactly.
 */
export function resolveTargetWindow(
  windows: WindowInfo[],
  spec: { windowId?: number; app?: string },
): WindowInfo | null {
  if (spec.windowId != null) {
    return windows.find((w) => w.windowId === spec.windowId) ?? null;
  }
  if (spec.app) {
    const q = spec.app.toLowerCase();
    return (
      windows.find((w) => w.app.toLowerCase() === q || w.app.toLowerCase().startsWith(q)) ?? null
    );
  }
  return null;
}

/**
 * Best-effort obstruction report for a window capture. Advisory only, so every
 * uncertain path returns undefined rather than a claim: an absent field reads as
 * "not determined", where an empty list would read as "verified unobstructed".
 */
export async function obstructionFor(
  spec: { windowId?: number; app?: string },
  frame: ScreenFrame,
): Promise<
  | {
      frontmost: false;
      obscuredBy: { app: string; title: string; windowId: number }[];
      note: string;
    }
  | undefined
> {
  try {
    const windows = await listWindows();
    const target = resolveTargetWindow(windows, spec);
    if (!target) return undefined;
    // The window list is read after the capture, so it can have moved on. If the
    // geometry no longer agrees, say nothing rather than report a stale layout.
    if (
      target.x !== frame.x ||
      target.y !== frame.y ||
      target.w !== frame.w ||
      target.h !== frame.h
    )
      return undefined;

    const inFront = windowsInFrontOf(target, windows);
    if (inFront.length === 0) return undefined;
    const names = [...new Set(inFront.map((w) => w.app))].join(", ");
    return {
      frontmost: false,
      obscuredBy: inFront,
      note:
        `This window is behind ${names}. The capture saw through them, but a click at these ` +
        "coordinates would land on the window in front — raise the target application first.",
    };
  } catch {
    return undefined;
  }
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
export function normalizeText(s: string, caseSensitive = false): string {
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

export function levenshtein(a: string, b: string): number {
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

// `\b` is ASCII-only, so it reports a boundary in the middle of "café" and none
// around "łódź". Test the adjacent characters against a Unicode letter/number
// class instead — UI labels are not ASCII.
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Does `needle` occur in `haystack` bounded by non-word characters (or string ends)? */
export function isWholeWordHit(haystack: string, needle: string): boolean {
  if (!needle) return false;
  for (let from = 0; ; from++) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = haystack[i - 1];
    const after = haystack[i + needle.length];
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return true;
    from = i;
  }
}

/**
 * Rank a substring hit. A flat score for every substring made "Don't Save" and
 * "Save Changes" indistinguishable for the query "Save", and the tie fell to OCR
 * emission order — so "click Save" could return the destructive button. Grade by
 * the three things that actually separate a button label from a coincidence:
 * whether the query stands on word boundaries, whether it opens the label, and how
 * much of the label it covers. Stays strictly below the exact-match score of 1.
 */
function substringScore(block: string, query: string): number {
  const coverage = query.length / block.length;
  const raw =
    0.6 +
    (isWholeWordHit(block, query) ? 0.15 : 0) +
    (block.startsWith(query) ? 0.1 : 0) +
    0.15 * coverage;
  return Math.min(0.99, Math.round(raw * 100) / 100);
}

function bboxCenterToScreenPoint(
  bbox: { x: number; y: number; width: number; height: number },
  frame: ScreenFrame | null,
): { x: number; y: number } | null {
  if (!frame) return null;
  // Whole pixels: sub-pixel precision means nothing to a click, and drivers
  // (macos-mcp, cliclick) take integers — a fractional value is rejected outright.
  return {
    x: Math.round(frame.x + (bbox.x + bbox.width / 2) * frame.w),
    y: Math.round(frame.y + (bbox.y + bbox.height / 2) * frame.h),
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
    const toMatch = (
      score: number,
      method: ElementMatch["method"],
      wholeWord: boolean,
    ): ElementMatch => ({
      text: block.text,
      confidence: block.confidence,
      score,
      method,
      wholeWord,
      bbox,
      clickPoint: bboxCenterToScreenPoint(bbox, frame),
    });

    if (t === q) {
      matches.push(toMatch(1, "exact", true));
    } else if (t.includes(q) && q.length >= 2) {
      matches.push(toMatch(substringScore(t, q), "substring", isWholeWordHit(t, q)));
    } else {
      // Length gate: dist >= |Δlen|, so blocks too different in length can never
      // reach even the near-miss threshold — skip the O(m×n) DP for them.
      const maxLen = Math.max(t.length, q.length);
      if (Math.abs(t.length - q.length) / maxLen > 1 - nearMissThreshold) continue;
      const sim = 1 - levenshtein(t, q) / maxLen;
      const score = Math.round(sim * 100) / 100;
      // Fuzzy compares whole strings, so a fuzzy hit is by construction whole-word.
      if (sim >= fuzzyThreshold) {
        matches.push(toMatch(score, "fuzzy", true));
      } else if (sim >= nearMissThreshold) {
        nearMisses.push(toMatch(score, "fuzzy", true));
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  nearMisses.sort((a, b) => b.score - a.score);
  return { matches, nearMisses: nearMisses.slice(0, 5) };
}

/**
 * Split matches into those that can carry an assertion and those that cannot.
 *
 * `assert_text("Save")` used to pass on a screen whose only "save" was inside
 * "Unsaved changes" — a green verdict for a button that was not there — and
 * `mode:"absent"` failed on the same screen for the same reason. Presence is
 * decided by exact, fuzzy and whole-word substring matches; mid-word hits are
 * reported separately so nothing is hidden, but they do not decide the verdict.
 */
export function splitByAssertionStrength(matches: ElementMatch[]): {
  qualifying: ElementMatch[];
  incidental: ElementMatch[];
} {
  const qualifying: ElementMatch[] = [];
  const incidental: ElementMatch[] = [];
  for (const m of matches) (m.wholeWord ? qualifying : incidental).push(m);
  return { qualifying, incidental };
}

// ─── Capability report ───────────────────────────────────────────────────────

const PRIVACY_NOTE = "captures stay on disk; tools return only paths, geometry, and extracted text";

/**
 * What this machine can do right now. `visionCapabilities()` is memoized by the
 * library, so repeat calls cost one helper spawn for permissions and displays.
 *
 * Every capability flag below is derived from the permissions actually reported.
 * They used to be hardcoded `true`, which meant this report claimed window and
 * region capture worked while capture was failing — the one tool whose stated job
 * is to explain that failure.
 */
export async function capabilities(): Promise<object> {
  try {
    const [vision, permissions, displays] = await Promise.all([
      visionCapabilities(),
      checkPermissions(),
      listDisplays(),
    ]);

    const canCapture = permissions.screenRecording && !permissions.screenLocked;
    const blockers: string[] = [];
    if (!permissions.screenRecording) {
      blockers.push(
        "Screen Recording is not granted to the process hosting this server, so capture_screen, " +
          "read_screen_text, find_element and assert_text cannot run, and list_windows reports " +
          "every window title as an empty string. Grant it to the host application (Terminal / " +
          "Claude Desktop / Cursor) in System Settings → Privacy & Security → Screen Recording, " +
          "then restart that application — the permission is per host process, not per package.",
      );
    }
    if (permissions.screenLocked) {
      blockers.push(
        "The screen is locked. Window and region capture fail outright and a full-screen capture " +
          "would only show the lock screen; retrying cannot succeed until someone unlocks.",
      );
    }
    if (!permissions.accessibility) {
      blockers.push(
        "Accessibility is not granted to the host process, so ui_snapshot cannot read the layout " +
          "tree. The OCR-based tools are unaffected.",
      );
    }

    return {
      macosVersion: vision.macosVersion,
      helperVersion: vision.helperVersion,
      permissions,
      displays,
      visionFeatures: vision.features,
      ocrLanguages: vision.ocrLanguages.length,
      capture: {
        engine: "screencapture",
        windowCapture: canCapture,
        regionCapture: canCapture,
        windowTitles: permissions.screenRecording,
      },
      ready: canCapture,
      blockers,
      privacy: PRIVACY_NOTE,
    };
  } catch (err) {
    // The helper itself failed, so nothing about this machine has been observed.
    // Report that and stop — capability claims here would be invention.
    return {
      error: err instanceof Error ? err.message : String(err),
      ready: false,
      blockers: [
        "The bundled native helper could not be run, so no capability could be verified. " +
          "Reinstall the package (`npm i macos-vision-mcp`) so the prebuilt helper is restored.",
      ],
      privacy: PRIVACY_NOTE,
    };
  }
}
