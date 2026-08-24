#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ocr,
  detectFaces,
  detectBarcodes,
  detectRectangles,
  detectDocument,
  classify,
  inferLayout,
  type VisionBlock,
  type Face,
  type Barcode,
  type Rectangle,
  type DocumentBounds,
  uiSnapshot,
  type Classification,
} from "macos-vision";
import { z } from "zod";
import { capabilities, captureScreen, findMatches, listWindows, resolveImageSource } from "./ui.js";

// Read version from package.json so release-it bumps stay in sync automatically.
const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require("../package.json") as { version: string };

const server = new McpServer({
  name: "macos-vision-mcp",
  version: PACKAGE_VERSION,
});

// ─── Internal types: structured document output ──────────────────────────────

interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Paragraph {
  paragraphId: number;
  lineIds: number[];
  text: string;
}

interface TextBlockOut {
  text: string;
  lineId: number;
  paragraphId: number;
  confidence: number;
  bbox: Bbox;
}

interface BarcodeOut {
  value: string;
  symbology: string;
  bbox: Bbox;
}

interface RectangleOut {
  confidence: number;
  bbox: Bbox;
}

interface PageAnalysis {
  page: number;
  paragraphs: Paragraph[];
  textBlocks: TextBlockOut[];
  faces: Bbox[];
  barcodes: BarcodeOut[];
  rectangles: RectangleOut[];
}

interface DocumentAnalysisResult {
  source: { path: string; pageCount: number; isPdf: boolean };
  pages: PageAnalysis[];
  summary: {
    totalTextBlocks: number;
    totalParagraphs: number;
    totalFaces: number;
    totalBarcodes: number;
    totalRectangles: number;
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function groupBlocksByPage(blocks: VisionBlock[]): Map<number, VisionBlock[]> {
  const pages = new Map<number, VisionBlock[]>();
  for (const block of blocks) {
    const page = block.page ?? 0;
    const existing = pages.get(page) ?? [];
    existing.push(block);
    pages.set(page, existing);
  }
  return pages;
}

function buildPageAnalysis(
  pageIndex: number,
  pageBlocks: VisionBlock[],
  faces?: Face[],
  barcodes?: Barcode[],
  rectangles?: Rectangle[],
): PageAnalysis {
  const layout = inferLayout({ textBlocks: pageBlocks, faces, barcodes, rectangles });

  const textBlocks: TextBlockOut[] = [];
  const facesOut: Bbox[] = [];
  const barcodesOut: BarcodeOut[] = [];
  const rectanglesOut: RectangleOut[] = [];

  // Insertion-ordered map: paragraphId → { ordered lineIds, per-line text fragments }.
  // Layout iteration order is reading order, so first appearance = correct paragraph order.
  const paragraphMap = new Map<number, { lineIds: number[]; lineTextMap: Map<number, string[]> }>();

  for (const block of layout) {
    switch (block.kind) {
      case "text": {
        textBlocks.push({
          text: block.text,
          lineId: block.lineId,
          paragraphId: block.paragraphId,
          confidence: block.confidence ?? 0,
          bbox: { x: block.x, y: block.y, width: block.width, height: block.height },
        });

        let para = paragraphMap.get(block.paragraphId);
        if (!para) {
          para = { lineIds: [], lineTextMap: new Map() };
          paragraphMap.set(block.paragraphId, para);
        }
        let lineFrags = para.lineTextMap.get(block.lineId);
        if (!lineFrags) {
          lineFrags = [];
          para.lineIds.push(block.lineId);
          para.lineTextMap.set(block.lineId, lineFrags);
        }
        lineFrags.push(block.text);
        break;
      }
      case "face":
        facesOut.push({ x: block.x, y: block.y, width: block.width, height: block.height });
        break;
      case "barcode":
        barcodesOut.push({
          value: block.value,
          symbology: block.type,
          bbox: { x: block.x, y: block.y, width: block.width, height: block.height },
        });
        break;
      case "rectangle":
        rectanglesOut.push({
          confidence: block.confidence ?? 0,
          bbox: { x: block.x, y: block.y, width: block.width, height: block.height },
        });
        break;
    }
  }

  const paragraphs: Paragraph[] = [];
  for (const [paragraphId, info] of paragraphMap) {
    const lines = info.lineIds.map((lineId) => info.lineTextMap.get(lineId)!.join(" "));
    paragraphs.push({ paragraphId, lineIds: info.lineIds, text: lines.join("\n") });
  }

  return {
    page: pageIndex,
    paragraphs,
    textBlocks,
    faces: facesOut,
    barcodes: barcodesOut,
    rectangles: rectanglesOut,
  };
}

// ─── Resource: capabilities ──────────────────────────────────────────────────

server.resource(
  "macos-vision-capabilities",
  "macos-vision://capabilities",
  { mimeType: "text/plain" },
  async () => ({
    contents: [
      {
        uri: "macos-vision://capabilities",
        mimeType: "text/plain",
        text: `macos-vision-mcp — local Apple Vision Framework for any MCP client
==================================================================

All processing happens ON-DEVICE. No files leave your Mac. No API keys required.

System requirements:
  - macOS 13 Ventura or later
  - Node.js 18+
  - Xcode Command Line Tools (xcode-select --install) — optional, only used
    as a fallback if the prebuilt Swift helpers can't be downloaded at install
    time. The common path needs nothing beyond macOS + Node.js.

Available capabilities:

  OCR (ocr_image)
    Extract text from images or PDFs using Apple's Vision OCR engine.
    Supported formats: jpg, jpeg, png, heic, heif, tiff, bmp, pdf
    Modes:
      "text"   — single plain-text string (default).
      "blocks" — JSON { pages: [{ page, paragraphs, textBlocks }] } where
                 paragraphs[].text holds reading-order paragraph text and
                 textBlocks[] preserves bounding boxes, lineId, paragraphId,
                 and confidence for spatial reconstruction.
    PDF page range:
      start_page / max_pages (both 1-based) restrict OCR to a slice of a
      multi-page PDF — useful for previews or processing long documents in
      chunks. Both are ignored for non-PDF inputs.

  Face detection (detect_faces)
    Detect human faces and return their count and bounding box positions.

  Barcode / QR code detection (detect_barcodes)
    Read QR codes, EAN, UPC, Code128, PDF417, Aztec, DataMatrix, and more.

  Document boundary detection (detect_document)
    Locate the quadrilateral of a document in a photo — receipts, paper
    forms, IDs shot at an angle — returning the four corner points and a
    confidence score. Useful for crop / deskew hints before OCR.

  Image classification (classify_image)
    Classify image content into 1000+ categories with confidence scores.

  Document analysis (analyze_document)
    Full pipeline returning structured JSON suitable for reconstructing the
    document into Markdown, HTML, DOCX, or any other format. Includes:
      - paragraphs[] — reading-order text grouped into paragraphs and lines
      - textBlocks[] — every recognized block with bbox/lineId/paragraphId
      - faces, barcodes, rectangles — parallel detection sections
    PDFs are split per-page; coordinates are page-local 0–1. Accepts the
    same start_page / max_pages range options as ocr_image.

  Reconstruction tip
    Concatenate paragraphs[].text with blank lines between paragraphs to get
    reading-order plain text. Use textBlocks[] bounding boxes to recover
    columns, tables, or form layout. PDFs return one entry per page in pages[].
`,
      },
    ],
  }),
);

// ─── Tool 1: ocr_image ───────────────────────────────────────────────────────

server.tool(
  "ocr_image",
  `Extract text from a local image or PDF file using Apple Vision OCR (offline, no API key needed).

USE WHEN: The user provides a local file path to an image, screenshot, scanned document, or PDF and wants to extract the text from it.
DO NOT USE for: images hosted on URLs (download first), non-macOS systems, or when the user wants face/barcode detection (use the dedicated tools).

Supported formats: jpg, jpeg, png, heic, heif, tiff, bmp, pdf

Parameters:
  path       — absolute or relative path to the image/PDF file
  format     — "text"   returns a single plain-text string (default)
               "blocks" returns JSON { pages: [{ page, paragraphs, textBlocks }] }
                        with reading-order paragraphs and per-block bounding boxes.
                        Each textBlock carries lineId, paragraphId, confidence, and
                        page-local bbox (0–1). PDFs return one entry per page.
  start_page — PDFs only — 1-based index of the first page to OCR (default 1).
               Ignored for images. start_page past the end returns an empty result.
  max_pages  — PDFs only — maximum number of pages to OCR from start_page (default: all).
               Ignored for images.

Returns: extracted text as a string (format="text") or a JSON document with
         per-page paragraphs and text blocks (format="blocks").`,
  {
    path: z.string().describe("Absolute or relative path to the image or PDF file"),
    format: z
      .enum(["text", "blocks"])
      .default("text")
      .describe('"text" for plain string output, "blocks" for per-page paragraphs and text blocks'),
    start_page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("PDFs only — 1-based first page to OCR. Ignored for images."),
    max_pages: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("PDFs only — maximum number of pages to OCR. Ignored for images."),
  },
  async ({ path, format, start_page, max_pages }) => {
    if (format === "blocks") {
      const rawBlocks = await ocr(path, {
        format: "blocks",
        startPage: start_page,
        maxPages: max_pages,
      });
      const pageMap = groupBlocksByPage(rawBlocks);
      const sortedPageEntries = [...pageMap.entries()].sort(([a], [b]) => a - b);
      const pages = sortedPageEntries.map(([pageIndex, pageBlocks]) => {
        const analysis = buildPageAnalysis(pageIndex, pageBlocks);
        return {
          page: analysis.page,
          paragraphs: analysis.paragraphs,
          textBlocks: analysis.textBlocks,
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ pages }, null, 2),
          },
        ],
      };
    }

    const text = await ocr(path, {
      format: "text",
      startPage: start_page,
      maxPages: max_pages,
    });
    return {
      content: [
        {
          type: "text",
          text,
        },
      ],
    };
  },
);

// ─── Tool 2: detect_faces ────────────────────────────────────────────────────

server.tool(
  "detect_faces",
  `Detect human faces in a local image file using Apple Vision (offline, no API key needed).

USE WHEN: The user wants to know how many faces are in a local image, or needs their positions.
DO NOT USE for: text extraction (use ocr_image), barcode reading (use detect_barcodes).

Returns: JSON with the total face count and an array of face positions expressed
         as percentage of image dimensions (top, left, width, height).`,
  {
    path: z.string().describe("Absolute or relative path to the image file"),
  },
  async ({ path }) => {
    const faces: Face[] = await detectFaces(path);

    const result = {
      count: faces.length,
      faces: faces.map((face, i) => ({
        index: i + 1,
        position: {
          top: `${(face.y * 100).toFixed(1)}%`,
          left: `${(face.x * 100).toFixed(1)}%`,
          width: `${(face.width * 100).toFixed(1)}%`,
          height: `${(face.height * 100).toFixed(1)}%`,
        },
      })),
    };

    const summary =
      faces.length === 0
        ? "No faces detected."
        : `Detected ${faces.length} face${faces.length > 1 ? "s" : ""}.`;

    return {
      content: [
        {
          type: "text",
          text: `${summary}\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  },
);

// ─── Tool 3: detect_barcodes ─────────────────────────────────────────────────

server.tool(
  "detect_barcodes",
  `Detect and decode barcodes or QR codes in a local image file using Apple Vision (offline, no API key needed).

USE WHEN: The user wants to read a QR code, barcode, EAN, UPC, Code128, PDF417, Aztec,
          DataMatrix or other 1D/2D code from a local file.
DO NOT USE for: text extraction (use ocr_image), face detection (use detect_faces).

Supported symbologies: QR, EAN-8, EAN-13, UPC-E, Code39, Code93, Code128,
                       ITF, PDF417, Aztec, DataMatrix, GS1DataBar and more.

Returns: JSON array of detected codes, each with its decoded value and symbology type.`,
  {
    path: z.string().describe("Absolute or relative path to the image file"),
  },
  async ({ path }) => {
    const barcodes: Barcode[] = await detectBarcodes(path);

    if (barcodes.length === 0) {
      return {
        content: [{ type: "text", text: "No barcodes or QR codes detected." }],
      };
    }

    const result = barcodes.map((code, i) => ({
      index: i + 1,
      value: code.value,
      symbology: code.type,
    }));

    return {
      content: [
        {
          type: "text",
          text: `Detected ${barcodes.length} code${barcodes.length > 1 ? "s" : ""}:\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  },
);

// ─── Tool 4: detect_document ─────────────────────────────────────────────────

server.tool(
  "detect_document",
  `Detect the boundary of a document in a local image using Apple Vision (offline, no API key needed).

USE WHEN: The user has a photo of a piece of paper, a receipt, a card, an ID, or any
          rectangular document and wants the four corner points — typically as a hint for
          cropping, deskewing, or straightening the image before further OCR.
DO NOT USE for: reading the document text (use ocr_image), classifying the image
                (use classify_image), or analyzing a PDF (PDFs are already rectangular pages).

Returns: JSON with the four corner points of the detected document — topLeft, topRight,
         bottomLeft, bottomRight — each as { x, y } in 0–1 image coordinates, plus a
         confidence score. Returns { "detected": false } if no document is found.`,
  {
    path: z.string().describe("Absolute or relative path to the image file"),
  },
  async ({ path }) => {
    const doc: DocumentBounds | null = await detectDocument(path);

    if (!doc) {
      return {
        content: [
          {
            type: "text",
            text: `No document detected.\n\n${JSON.stringify({ detected: false }, null, 2)}`,
          },
        ],
      };
    }

    const toCorner = ([x, y]: [number, number]) => ({ x, y });
    const result = {
      detected: true,
      confidence: doc.confidence,
      corners: {
        topLeft: toCorner(doc.topLeft),
        topRight: toCorner(doc.topRight),
        bottomLeft: toCorner(doc.bottomLeft),
        bottomRight: toCorner(doc.bottomRight),
      },
    };

    return {
      content: [
        {
          type: "text",
          text: `Document detected (confidence ${(doc.confidence * 100).toFixed(1)}%).\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  },
);

// ─── Tool 5: classify_image ──────────────────────────────────────────────────

server.tool(
  "classify_image",
  `Classify the content of a local image into categories using Apple Vision (offline, no API key needed).

USE WHEN: The user wants to know what is depicted in an image — objects, scenes, activities,
          animals, food, etc. Works with 1000+ categories and returns confidence scores.
DO NOT USE for: text extraction (use ocr_image), face/barcode detection (dedicated tools),
                images that need detailed visual description (use the model's built-in vision).

Returns: JSON array of classification labels sorted by confidence (highest first),
         each with a label name and confidence score (0–1).`,
  {
    path: z.string().describe("Absolute or relative path to the image file"),
  },
  async ({ path }) => {
    const classifications: Classification[] = await classify(path);

    if (classifications.length === 0) {
      return {
        content: [{ type: "text", text: "No classifications returned." }],
      };
    }

    const result = [...classifications]
      .sort((a, b) => b.confidence - a.confidence)
      .map((item, i) => ({
        rank: i + 1,
        label: item.identifier,
        confidence: `${(item.confidence * 100).toFixed(1)}%`,
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// ─── Tool 6: analyze_document ────────────────────────────────────────────────

server.tool(
  "analyze_document",
  `Run a full analysis pipeline on a local image or PDF and return structured JSON for document
reconstruction: OCR (with line/paragraph grouping in reading order), face detection, barcode/QR
detection, and rectangle detection — all in parallel, fully offline, no API key needed.

USE WHEN: The user wants the model to reconstruct a document into Markdown, HTML, DOCX, or any
          other format — invoices, scanned reports, contracts, IDs, receipts, mixed-content scans.
          Returns enough structure (paragraphs + raw text blocks with bounding boxes) that the
          model can render the output in whatever format the user asks for.
DO NOT USE when: the user needs only one capability (use the dedicated tool — it will be faster).

Returns: JSON with this shape:
  {
    "source":  { "path", "pageCount", "isPdf" },
    "pages":   [
      {
        "page":        0,
        "paragraphs":  [{ "paragraphId", "lineIds", "text" }, ...],   // primary surface
        "textBlocks":  [{ "text", "lineId", "paragraphId",
                          "confidence", "bbox": { "x","y","width","height" } }, ...],
        "faces":       [{ "x","y","width","height" }, ...],
        "barcodes":    [{ "value","symbology","bbox" }, ...],
        "rectangles":  [{ "confidence","bbox" }, ...]
      },
      ...
    ],
    "summary": { "totalTextBlocks","totalParagraphs","totalFaces","totalBarcodes","totalRectangles" }
  }

Use paragraphs[].text as the primary surface for reading-order content. Use textBlocks[] when
spatial information matters — multi-column layouts, tables, forms. PDFs return one entry per
page; all coordinates are page-local 0–1. Face/barcode/rectangle detection on PDFs is best-effort
(the underlying binary analyzes the PDF as a whole rather than per page).

Parameters:
  path       — absolute or relative path to the image/PDF file
  start_page — PDFs only — 1-based index of the first page to analyze (default 1).
               Only narrows the OCR pass; face/barcode/rectangle detections are still
               whole-document and attached to the first returned page. Ignored for images.
  max_pages  — PDFs only — maximum number of pages to OCR from start_page (default: all).
               Ignored for images.`,
  {
    path: z.string().describe("Absolute or relative path to the image or PDF file"),
    start_page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("PDFs only — 1-based first page to analyze. Ignored for images."),
    max_pages: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("PDFs only — maximum number of pages to analyze. Ignored for images."),
  },
  async ({ path, start_page, max_pages }) => {
    const isPdf = path.toLowerCase().endsWith(".pdf");

    const [ocrBlocks, faces, barcodes, rectangles]: [
      VisionBlock[],
      Face[],
      Barcode[],
      Rectangle[],
    ] = await Promise.all([
      ocr(path, { format: "blocks", startPage: start_page, maxPages: max_pages }).catch(
        (): VisionBlock[] => [],
      ),
      detectFaces(path).catch((): Face[] => []),
      detectBarcodes(path).catch((): Barcode[] => []),
      detectRectangles(path).catch((): Rectangle[] => []),
    ]);

    const pageMap = groupBlocksByPage(ocrBlocks);
    const sortedPageEntries = [...pageMap.entries()].sort(([a], [b]) => a - b);

    const pages: PageAnalysis[] = [];

    if (sortedPageEntries.length === 0) {
      // No OCR text. Still emit one synthetic page if there are non-text detections,
      // so downstream callers see a consistent shape.
      if (faces.length > 0 || barcodes.length > 0 || rectangles.length > 0) {
        pages.push(buildPageAnalysis(0, [], faces, barcodes, rectangles));
      }
    } else {
      const firstPageIndex = sortedPageEntries[0][0];
      for (const [pageIndex, pageBlocks] of sortedPageEntries) {
        const isFirstPage = pageIndex === firstPageIndex;
        pages.push(
          buildPageAnalysis(
            pageIndex,
            pageBlocks,
            isFirstPage ? faces : undefined,
            isFirstPage ? barcodes : undefined,
            isFirstPage ? rectangles : undefined,
          ),
        );
      }
    }

    let totalTextBlocks = 0;
    let totalParagraphs = 0;
    let totalFaces = 0;
    let totalBarcodes = 0;
    let totalRectangles = 0;
    for (const p of pages) {
      totalTextBlocks += p.textBlocks.length;
      totalParagraphs += p.paragraphs.length;
      totalFaces += p.faces.length;
      totalBarcodes += p.barcodes.length;
      totalRectangles += p.rectangles.length;
    }

    const result: DocumentAnalysisResult = {
      source: { path, pageCount: pages.length, isPdf },
      pages,
      summary: {
        totalTextBlocks,
        totalParagraphs,
        totalFaces,
        totalBarcodes,
        totalRectangles,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ═══ UI-testing tools ════════════════════════════════════════════════════════
//
// Privacy invariant: none of these tools ever return image bytes to the model.
// Captures land on disk; only paths, geometry, and extracted text flow back.

// ─── Tool 7: vision_capabilities ─────────────────────────────────────────────

server.tool(
  "vision_capabilities",
  `Report what this machine can do: macOS version, Screen Recording / Accessibility permission
state, available displays (with point sizes and Retina scale), and capture engine status.

USE WHEN: Before starting a UI-testing session, or when capture/OCR tools fail unexpectedly —
this tells you whether the problem is a missing permission and what to tell the user.

Returns: JSON { macosVersion, uiHelper, permissions: { screenRecording, accessibility },
displays: [{ displayId, isMain, x, y, w, h, scale }], capture, privacy }.`,
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await capabilities(), null, 2) }],
  }),
);

// ─── Tool 8: list_windows ────────────────────────────────────────────────────

server.tool(
  "list_windows",
  `List on-screen application windows with their global screen-point bounds — front-to-back order
(first window of an app = its frontmost one).

USE WHEN: You need a windowId for capture_screen / find_element, or want to know what apps are
visible before testing their UI.

Returns: JSON array [{ windowId, app, pid, title, x, y, w, h, layer, isOnScreen }].
Coordinates are global screen POINTS with top-left origin — the same space click drivers use.`,
  {
    include_all: z
      .boolean()
      .default(false)
      .describe("Include non-standard layers (menu bar, overlays). Default: normal windows only."),
  },
  async ({ include_all }) => ({
    content: [{ type: "text", text: JSON.stringify(await listWindows(include_all), null, 2) }],
  }),
);

// ─── Tool 9: capture_screen ──────────────────────────────────────────────────

const captureShape = {
  app: z
    .string()
    .optional()
    .describe("Capture the frontmost window of this app (name, case-insensitive prefix ok)"),
  window_id: z.number().int().optional().describe("Capture a specific window (from list_windows)"),
  rect: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional()
    .describe("Capture a screen region, in global screen points (top-left origin)"),
  display_id: z.number().int().optional().describe("Capture a specific display (default: main)"),
  out_path: z.string().optional().describe("Where to save the PNG (default: temp dir)"),
};

// Shared shapes/mappers for the OCR-consuming tools (find_element, assert_text).
const sourceShape = {
  ...captureShape,
  path: z
    .string()
    .optional()
    .describe("Use an existing image instead of capturing (clickPoint needs frame too)"),
  frame: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional()
    .describe("Screen region (points) a provided path covers — enables clickPoint mapping"),
};

const matchShape = {
  case_sensitive: z.boolean().default(false),
  fuzzy_threshold: z.number().min(0).max(1).default(0.75),
  min_confidence: z.number().min(0).max(1).default(0.3),
};

interface CaptureArgs {
  app?: string;
  window_id?: number;
  rect?: { x: number; y: number; w: number; h: number };
  display_id?: number;
  out_path?: string;
  path?: string;
  frame?: { x: number; y: number; w: number; h: number };
}

const toCaptureOpts = (a: CaptureArgs) => ({
  app: a.app,
  windowId: a.window_id,
  rect: a.rect,
  displayId: a.display_id,
  outPath: a.out_path,
  path: a.path,
  frame: a.frame,
});

interface MatchArgs {
  case_sensitive: boolean;
  fuzzy_threshold: number;
  min_confidence: number;
}

const toMatchOpts = (a: MatchArgs) => ({
  caseSensitive: a.case_sensitive,
  fuzzyThreshold: a.fuzzy_threshold,
  minConfidence: a.min_confidence,
});

server.tool(
  "capture_screen",
  `Take a screenshot locally — of the main display, a specific window, an app's frontmost window,
or a screen region. The image is saved to disk and NEVER returned to the model: you get back the
file path plus geometry, so follow-up OCR/assertion tools can map results to screen coordinates.

USE WHEN: Starting any UI check. Then chain: read_screen_text / find_element / assert_text on the
returned path — or skip this tool entirely, since those tools can capture on their own.

Requires: Screen Recording permission for the app hosting this MCP server.

Returns: JSON { path, pixelWidth, pixelHeight, frame: {x,y,w,h} (screen points), scale,
capturedAt, target }. frame is the screen region the image covers — needed to convert
image positions to clickable screen points.`,
  captureShape,
  async (args) => {
    const result = await captureScreen(toCaptureOpts(args));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ─── Tool 10: read_screen_text ───────────────────────────────────────────────

server.tool(
  "read_screen_text",
  `Capture the screen (or a window/app/region) and OCR it in one step — fully local, the
screenshot never leaves this machine. Returns the visible text so you can check UI state
without sending any image to the cloud.

USE WHEN: "What does the screen/app show right now?", verifying a dialog appeared, reading an
error message, checking state after an action.

Parameters: same targeting as capture_screen (app / window_id / rect / display_id), plus:
  format — "text" (default) plain text in reading order, or "blocks" with bboxes + confidence.

Returns: JSON { capture: { path, frame, ... }, text } or { capture, blocks: [...] }.`,
  {
    ...captureShape,
    format: z.enum(["text", "blocks"]).default("text"),
  },
  async ({ format, ...args }) => {
    const capture = await captureScreen(toCaptureOpts(args));
    const result =
      format === "blocks"
        ? await ocr(capture.path, { format: "blocks" })
        : await ocr(capture.path, { format: "text" });
    return {
      content: [{ type: "text", text: JSON.stringify({ capture, [format]: result }, null, 2) }],
    };
  },
);

// ─── Tool 11: find_element ───────────────────────────────────────────────────

server.tool(
  "find_element",
  `Find a UI element by its visible text and return WHERE TO CLICK — center coordinates in global
screen points, ready to hand to any input driver (macos-mcp Click, cliclick, CGEvent). Capture,
OCR, and matching all run locally; no screenshot is ever sent to the model or the cloud.

USE WHEN: An agent needs to click/interact with something it can name ("click Save", "focus the
search field") — this replaces sending a screenshot to a vision model to locate the element.

Matching: text is normalized (unicode, whitespace, dashes/quotes, case) and matched exact →
substring → fuzzy (Levenshtein). nearMisses report close-but-rejected candidates so you can
see when OCR misread a label.

Parameters: targeting like capture_screen (app / window_id / rect / display_id) or a
pre-captured image via path (+ optional frame to map to screen points), plus:
  query           — the visible text to find (button label, menu item, link text)
  case_sensitive  — default false
  fuzzy_threshold — min similarity 0–1 for fuzzy matches (default 0.75)
  min_confidence  — ignore OCR blocks below this confidence (default 0.3)

Returns: JSON { found, capture?, matches: [{ text, score, method, confidence, bbox,
clickPoint: {x,y} | null }], nearMisses }. clickPoint is in global screen points (top-left
origin). Multiple matches are sorted best-first — disambiguate via region or window targeting.`,
  {
    query: z.string().min(1).describe("Visible text of the element to locate"),
    ...sourceShape,
    ...matchShape,
  },
  async ({ query, case_sensitive, fuzzy_threshold, min_confidence, ...args }) => {
    const { imagePath, screenFrame, capture } = await resolveImageSource(toCaptureOpts(args));
    const blocks = await ocr(imagePath, { format: "blocks" });
    const { matches, nearMisses } = findMatches(
      blocks,
      query,
      screenFrame,
      toMatchOpts({ case_sensitive, fuzzy_threshold, min_confidence }),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { found: matches.length > 0, query, capture, matches, nearMisses },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─── Tool 12: assert_text ────────────────────────────────────────────────────

server.tool(
  "assert_text",
  `Assert that text is present on (or absent from) the screen, a window, or a pre-captured image —
a local pass/fail verdict computed on this machine. The deterministic check runs here; no
screenshot and no OCR dump needs to reach a cloud model for a UI test to pass.

USE WHEN: Verifying UI state after an action: "the dialog says Saved", "the error banner is
gone", "all three menu items are visible".

Parameters: targeting like capture_screen (app / window_id / rect / display_id) or a
pre-captured image via path (+ optional frame to map matches to screen points), plus:
  expect          — string or array of strings that must ALL satisfy the mode
  mode            — "present" (default) or "absent"
  case_sensitive, fuzzy_threshold, min_confidence — as in find_element

Returns: JSON { pass, mode, results: [{ expect, satisfied, matches, nearMisses }], capture? }.
nearMisses surface OCR misreads — a near miss on "present" usually means the text IS there
but was transcribed imperfectly; consider lowering fuzzy_threshold.`,
  {
    expect: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .describe("Text (or list of texts) that must all be present/absent"),
    mode: z.enum(["present", "absent"]).default("present"),
    ...sourceShape,
    ...matchShape,
  },
  async ({ expect, mode, case_sensitive, fuzzy_threshold, min_confidence, ...args }) => {
    const { imagePath, screenFrame, capture } = await resolveImageSource(toCaptureOpts(args));
    const blocks = await ocr(imagePath, { format: "blocks" });
    const expectations = Array.isArray(expect) ? expect : [expect];
    const matchOpts = toMatchOpts({ case_sensitive, fuzzy_threshold, min_confidence });

    const results = expectations.map((exp) => {
      const { matches, nearMisses } = findMatches(blocks, exp, screenFrame, matchOpts);
      const satisfied = mode === "present" ? matches.length > 0 : matches.length === 0;
      return { expect: exp, satisfied, matches, nearMisses };
    });

    const pass = results.every((r) => r.satisfied);
    return {
      content: [{ type: "text", text: JSON.stringify({ pass, mode, results, capture }, null, 2) }],
    };
  },
);

// ─── Tool 13: ui_snapshot ────────────────────────────────────────────────────

server.tool(
  "ui_snapshot",
  `Return the layout of an app's window as structured JSON: every element's exact box, role,
label and state from the macOS accessibility tree, optionally with colours and fonts — plus the
visible text the tree does NOT account for. All computed on this Mac; the screenshot it takes
never reaches the model.

USE WHEN: You need to understand or reconstruct a layout rather than just find one element —
"what is on this screen", "review this dialog's layout", "which controls are disabled", "is
anything unlabelled for screen readers". For locating a single element to click, find_element is
far cheaper.

Unlike OCR, geometry here is MEASURED, not inferred: boxes come from the accessibility API in
global screen points (top-left origin), so they are exact and include elements with no text at
all. Roles, enabled/focused state and parent/child structure have no OCR equivalent.

Parameters:
  app / pid   — which application (one is required)
  window      — which window, front-to-back. Default 0 (frontmost)
  detail      — "content" (default) drops unlabelled structural containers, "full" keeps them
  max_elements— cap the walk. Default 1500
  colors      — sample background/border colours from the capture. Default true
  ocr         — also report text the tree misses. Default true (costs ~1s)
  typography  — read font family/size for text elements. Default false

Returns: JSON { app, pid, window: [x,y,w,h], source, budget, nodes: [...], unresolved: [...],
summary: {...} }.
  nodes[]      — { id, parent?, depth, role, label?, value?, box: [x,y,w,h], style?, text?,
                   enabled? (only when false), focused? (only when true) }
  unresolved[] — visible text with no matching node: { text, box, confidence, coveredByNode? }
  summary      — { nodes, labelled, ocrBlocks, unresolved, axTextCoverage, cappedWalk? }

IMPORTANT — reading the output honestly:
  · budget.capped = true means the walk hit max_elements and the tree is INCOMPLETE. Raise
    max_elements before drawing conclusions from it.
  · summary.axTextCoverage is null whenever the walk was capped, because the figure would then
    measure how much of the tree was visited rather than how accessible the app is.
  · unresolved entries with coveredByNode = an element exists but exposes no label (an
    accessibility bug); without it = nothing is exposed there at all (usually custom drawing,
    canvas, WebGL or text baked into an image).
  · style colours come from pixels, so an element hidden behind another window reports the
    colour of whatever is drawn on top. borderWidth is inferred, not measured; there is no
    padding or margin — this is not the CSS box model.

Requires Accessibility permission (System Settings → Privacy & Security → Accessibility) in
addition to Screen Recording. A full window of a dense app runs to a few thousand tokens, so
prefer max_elements or a specific window over dumping everything.`,
  {
    app: z.string().optional().describe("Application name (exact, else case-insensitive prefix)"),
    pid: z.number().int().optional().describe("Target by process id instead of name"),
    window: z.number().int().min(0).optional().describe("Which window, front-to-back. Default 0"),
    detail: z.enum(["content", "full"]).optional(),
    max_elements: z.number().int().min(1).optional(),
    colors: z.boolean().optional().describe("Sample colours from the capture. Default true"),
    ocr: z.boolean().optional().describe("Report text the tree misses. Default true"),
    typography: z.boolean().optional().describe("Read fonts for text elements. Default false"),
  },
  async ({ app, pid, window, detail, max_elements, colors, ocr: wantOcr, typography }) => {
    const snapshot = await uiSnapshot({
      app,
      pid,
      window,
      detail,
      maxElements: max_elements,
      colors,
      ocr: wantOcr,
      typography,
    });
    return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
  },
);

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start macos-vision-mcp:", err);
  process.exit(1);
});
