#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ocr,
  detectFaces,
  detectBarcodes,
  detectRectangles,
  classify,
  inferLayout,
  type VisionBlock,
  type Face,
  type Barcode,
  type Rectangle,
  type Classification,
  type LayoutBlock,
} from "macos-vision";
import { z } from "zod";

const server = new McpServer({
  name: "macos-vision-mcp",
  version: "0.1.0",
});

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
        text: `macos-vision-mcp — local Apple Vision Framework for Claude Code
==============================================================

All processing happens ON-DEVICE. No files leave your Mac. No API keys required.

System requirements:
  - macOS 12 Monterey or later
  - Node.js 18+
  - Xcode Command Line Tools (xcode-select --install)

Available capabilities:

  OCR (ocr_image)
    Extract text from images or PDFs using Apple's Vision OCR engine.
    Supports: jpg, jpeg, png, heic, heif, tiff, bmp, pdf
    Modes: "text" (plain string) or "blocks" (structured with bounding boxes)

  Face detection (detect_faces)
    Detect human faces and return their count and bounding box positions.

  Barcode / QR code detection (detect_barcodes)
    Read QR codes, EAN, UPC, Code128, PDF417, Aztec, DataMatrix and more.

  Image classification (classify_image)
    Classify the content of an image into 1000+ categories with confidence scores.

  Document analysis (analyze_document)
    Full pipeline: OCR + face detection + barcode detection + rectangle detection
    + layout inference. Returns a structured report.

  Layout inference (used internally)
    Orders detected text blocks into natural reading order based on visual layout.
`,
      },
    ],
  })
);

// ─── Tool 1: ocr_image ───────────────────────────────────────────────────────

server.tool(
  "ocr_image",
  `Extract text from a local image or PDF file using Apple Vision OCR (offline, no API key needed).

USE WHEN: The user provides a local file path to an image, screenshot, scanned document, or PDF and wants to extract the text from it.
DO NOT USE for: images hosted on URLs (download first), non-macOS systems, or when the user wants face/barcode detection (use the dedicated tools).

Supported formats: jpg, jpeg, png, heic, heif, tiff, bmp, pdf

Parameters:
  path   — absolute or relative path to the image/PDF file
  format — "text" returns a single plain-text string (default)
           "blocks" returns structured text blocks sorted in reading order,
           each block includes the recognized text and its bounding box as
           percentage of image dimensions (top, left, width, height)

Returns: extracted text as a string (format="text") or a JSON array of
         text blocks with position data (format="blocks").`,
  {
    path: z.string().describe("Absolute or relative path to the image or PDF file"),
    format: z
      .enum(["text", "blocks"])
      .default("text")
      .describe('"text" for plain string output, "blocks" for structured blocks with bounding boxes'),
  },
  async ({ path, format }) => {
    if (format === "blocks") {
      const rawBlocks = await ocr(path, { format: "blocks" });
      const layout = inferLayout({ textBlocks: rawBlocks });

      const formatted = layout
        .filter((block): block is LayoutBlock & { kind: "text"; text: string } => block.kind === "text")
        .map((block, i) => ({
          index: i + 1,
          text: block.text,
          position: {
            top: `${(block.y * 100).toFixed(1)}%`,
            left: `${(block.x * 100).toFixed(1)}%`,
            width: `${(block.width * 100).toFixed(1)}%`,
            height: `${(block.height * 100).toFixed(1)}%`,
          },
        }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    }

    const text = await ocr(path, { format: "text" });
    return {
      content: [
        {
          type: "text",
          text,
        },
      ],
    };
  }
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
  }
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
  }
);

// ─── Tool 4: classify_image ──────────────────────────────────────────────────

server.tool(
  "classify_image",
  `Classify the content of a local image into categories using Apple Vision (offline, no API key needed).

USE WHEN: The user wants to know what is depicted in an image — objects, scenes, activities,
          animals, food, etc. Works with 1000+ categories and returns confidence scores.
DO NOT USE for: text extraction (use ocr_image), face/barcode detection (dedicated tools),
                images that need detailed visual description (use Claude's built-in vision).

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
  }
);

// ─── Tool 5: analyze_document ────────────────────────────────────────────────

server.tool(
  "analyze_document",
  `Run a full analysis pipeline on a local image or PDF: OCR text extraction, face detection,
barcode/QR detection, and rectangle detection — all in parallel, fully offline, no API key needed.

USE WHEN: The user wants to extract everything from a single file in one shot — text, faces,
          codes, and structural elements. Ideal for scanned documents, ID cards, receipts,
          forms, photos with mixed content.
DO NOT USE when: the user needs only one specific capability (use the dedicated tool instead,
                 it will be faster).

Returns: a structured text report with four clearly labelled sections:
  EXTRACTED TEXT     — full OCR output in reading order
  DETECTED FACES     — count and positions of faces
  DETECTED CODES     — decoded barcodes/QR codes
  DETECTED RECTANGLES — count and positions of rectangular regions`,
  {
    path: z.string().describe("Absolute or relative path to the image or PDF file"),
  },
  async ({ path }) => {
    const [ocrBlocks, faces, barcodes, rectangles]: [
      VisionBlock[],
      Face[],
      Barcode[],
      Rectangle[],
    ] = await Promise.all([
      ocr(path, { format: "blocks" }).catch((): VisionBlock[] => []),
      detectFaces(path).catch((): Face[] => []),
      detectBarcodes(path).catch((): Barcode[] => []),
      detectRectangles(path).catch((): Rectangle[] => []),
    ]);

    const layout = inferLayout({ textBlocks: ocrBlocks, faces, barcodes, rectangles });

    const extractedText = layout
      .filter((b): b is LayoutBlock & { kind: "text"; text: string } => b.kind === "text")
      .map((b) => b.text)
      .join("\n");

    const facesText =
      faces.length === 0
        ? "None detected."
        : `${faces.length} face${faces.length > 1 ? "s" : ""} detected:\n` +
          faces
            .map(
              (f, i) =>
                `  Face ${i + 1}: top=${(f.y * 100).toFixed(1)}%, left=${(f.x * 100).toFixed(1)}%, width=${(f.width * 100).toFixed(1)}%, height=${(f.height * 100).toFixed(1)}%`
            )
            .join("\n");

    const barcodesText =
      barcodes.length === 0
        ? "None detected."
        : barcodes
            .map(
              (c, i) =>
                `  Code ${i + 1} [${c.type}]: ${c.value}`
            )
            .join("\n");

    const rectanglesText =
      rectangles.length === 0
        ? "None detected."
        : `${rectangles.length} rectangle${rectangles.length > 1 ? "s" : ""} detected:\n` +
          rectangles
            .map(
              (r, i) =>
                `  Rect ${i + 1}: topLeft=(${(r.topLeft[0] * 100).toFixed(1)}%, ${(r.topLeft[1] * 100).toFixed(1)}%), topRight=(${(r.topRight[0] * 100).toFixed(1)}%, ${(r.topRight[1] * 100).toFixed(1)}%), confidence=${(r.confidence * 100).toFixed(1)}%`
            )
            .join("\n");

    const report = [
      "=== EXTRACTED TEXT ===",
      extractedText || "(no text found)",
      "",
      "=== DETECTED FACES ===",
      facesText,
      "",
      "=== DETECTED CODES ===",
      barcodesText,
      "",
      "=== DETECTED RECTANGLES ===",
      rectanglesText,
    ].join("\n");

    return {
      content: [{ type: "text", text: report }],
    };
  }
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
