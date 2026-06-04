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
  type Classification,
} from "macos-vision";
import { z } from "zod";

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

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start macos-vision-mcp:", err);
  process.exit(1);
});
