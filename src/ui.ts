// MCP-side UI layer: source resolution and local text matching.
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
  visionCapabilities,
  type CaptureOptions,
  type CaptureResult,
  type ScreenFrame,
  type VisionBlock,
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

/**
 * What this machine can do right now. `visionCapabilities()` is memoized by the
 * library, so repeat calls cost one helper spawn for permissions and displays.
 */
export async function capabilities(): Promise<object> {
  const staticInfo = {
    capture: { engine: "screencapture", windowCapture: true, regionCapture: true },
    privacy: "captures stay on disk; tools return only paths, geometry, and extracted text",
  };
  try {
    const [vision, permissions, displays] = await Promise.all([
      visionCapabilities(),
      checkPermissions(),
      listDisplays(),
    ]);
    return {
      macosVersion: vision.macosVersion,
      permissions,
      displays,
      visionFeatures: vision.features,
      ocrLanguages: vision.ocrLanguages.length,
      ...staticInfo,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ...staticInfo };
  }
}
