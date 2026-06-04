# macos-vision-mcp

<p align="center">
  <img src=".github/assets/hero.jpg" alt="macos-vision-mcp — local, private, offline OCR for MCP-compatible LLMs" width="1200">
</p>

Local OCR & image analysis for any MCP client — private, offline, no API keys.

[![npm version](https://img.shields.io/npm/v/macos-vision-mcp?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/macos-vision-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-ffd60a?style=flat-square)](LICENSE)
[![macOS 13.0+](https://img.shields.io/badge/macOS-13.0%2B-0078d7?logo=apple&logoColor=white&style=flat-square)](https://developer.apple.com/documentation/vision)
[![No API Key](https://img.shields.io/badge/no%20API%20key-required-brightgreen?style=flat-square)](#)
[![Offline](https://img.shields.io/badge/offline-yes-blue?style=flat-square)](#)

Pre-extracts text and image data locally before your AI ever sees it — cutting token usage by ~97% on real documents and returning structured paragraphs, lines, and bounding boxes so the model can reconstruct the document into Markdown, HTML, DOCX, or any other format. Files never leave your Mac: no cloud API, no API keys, no network requests.

## What you get

- OCR for images and PDFs (JPG, PNG, HEIC, TIFF, multi-page PDF) via Apple Vision Framework.
- ~97% token reduction: a 44-page PDF costs ~2,400 tokens instead of ~73,500.
- Reading-order paragraphs + raw text blocks with bounding boxes — rich structure for the model to reconstruct the document into any output format (Markdown, HTML, DOCX, JSON), not a lossy plain-text dump.
- Face detection, barcode/QR reading, and image classification — all on-device.
- Full document pipeline: OCR + faces + barcodes + rectangles in a single tool call.
- Works with Claude Code, Claude Desktop, and Cursor — any MCP-compatible client.
- No files uploaded to any server — processing stays entirely on your Mac.
- 100% offline after `npm install` — powered by Apple Vision Framework, same engine as Live Text in Photos.app.

## ❌ Without / ✅ With

❌ **Without macos-vision-mcp:**

- Sending a 44-page PDF costs ~73,500 tokens
- Every image, invoice, or contract goes through a cloud API
- Sensitive documents leave your machine on every request

✅ **With macos-vision-mcp:**

- Local Apple Vision pre-extracts text before Claude ever sees it
- ~2,400 tokens for the same 44-page PDF — 97% fewer
- Files never leave your Mac

## Privacy layer

macos-vision-mcp acts as a local pre-processing layer between your documents and the cloud. Useful for:

- Legal documents, contracts, NDAs
- Financial reports, invoices, internal spreadsheets
- Medical records or any GDPR-sensitive content
- Any situation where you want to extract structured data locally before deciding what (if anything) to send upstream

Instead of sending the raw document to your AI, you extract the text and structure locally first. The model then works only with the extracted text — never the original file.

## Quick Start

**Add to your MCP client (example for Claude Code):**

```sh
claude mcp add macos-vision-mcp -- npx -y macos-vision-mcp
```

Restart your client. `npx` fetches the package on first run, caches it, and the tools appear automatically — no separate install step. This is the convention used by most MCP servers and recommended by Anthropic, Cursor, and other clients.

> **Note:** On first run, `macos-vision` downloads prebuilt Swift helper binaries (`vision-helper`, `pdf-helper`) from its GitHub Releases (~300 KB, ~1–2s). Subsequent invocations hit the npx cache and start instantly. Xcode Command Line Tools are only required as a fallback when the download can't reach the network — set `MACOS_VISION_SKIP_DOWNLOAD=1` to force local compilation with `swiftc`.

> **Prefer instant cold-starts (no npx cache lookup)?** Install globally with `npm install -g macos-vision-mcp` and use the alternative config shown at the bottom of [Configuration](#configuration).

## Available Tools

| Tool               | What it does                                                                                                                                                                                                                                                   | Example prompt                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ocr_image`        | Extract text from an image or PDF (JPG, PNG, HEIC, TIFF, PDF). Returns plain text, or per-page paragraphs + text blocks with `lineId` / `paragraphId` and bounding boxes. Accepts `start_page` / `max_pages` for partial PDF OCR.                              | "Read the text from ~/Desktop/screenshot.png"        |
| `detect_faces`     | Detect human faces and return their count and positions.                                                                                                                                                                                                       | "How many people are in this photo?"                 |
| `detect_barcodes`  | Read QR codes, EAN, UPC, Code128, PDF417, Aztec, and other 1D/2D codes.                                                                                                                                                                                        | "What does the QR code in /tmp/qr.jpg say?"          |
| `detect_document`  | Detect the four corner points of a document in a photo (paper, receipt, ID). Useful as a crop / deskew hint before OCR.                                                                                                                                        | "Find the document corners in ~/Desktop/receipt.jpg" |
| `classify_image`   | Classify image content into 1000+ categories with confidence scores.                                                                                                                                                                                           | "What is in this image?"                             |
| `analyze_document` | Returns structured JSON with reading-order paragraphs, raw text blocks (bbox / confidence), faces, barcodes, and rectangles — ready for the model to reconstruct into Markdown, HTML, or anything else. Also accepts `start_page` / `max_pages` for long PDFs. | "Reconstruct ~/Desktop/scan.pdf as clean Markdown"   |

## Usage

Use the tool name explicitly in your prompt to guarantee local processing:

**Extract text from an image or PDF:**

```
Use ocr_image to extract text from ~/Desktop/invoice.pdf
```

**Detect faces in a photo:**

```
Use detect_faces on ~/Photos/team.jpg and tell me how many people are in it
```

**Classify image content:**

```
Use classify_image on ~/Downloads/unknown.jpg
```

**Full document analysis + reconstruction:**

```
Use analyze_document on ~/Desktop/report.pdf and reconstruct it as clean Markdown
```

The tool returns structured JSON; the model picks the output format you ask for (Markdown, HTML, DOCX outline, etc.) without any extra dependencies — no Ollama, no cloud LLM, no extra tooling.

## Example workflows

Real-world combinations that work out of the box once the server is connected:

- **"Convert PDF → clean Markdown for LLM"** — `analyze_document` returns reading-order paragraphs and bounding boxes; the model renders Markdown ready to drop into a docs site, knowledge base, or RAG pipeline.
- **"Extract invoice data locally before sending to GPT"** — pull line items, totals, vendor, and dates from the PDF locally with `analyze_document`, then send only the structured JSON upstream. The original document never leaves your Mac.
- **"Scan receipts → JSON → expense tracker"** — `ocr_image` on a phone photo, the model normalizes amount / date / merchant, and pipes the result straight into your expense tool's API.
- **"Decode a QR code from a screenshot"** — `detect_barcodes` returns the decoded value plus symbology in one round trip.
- **"Crop a photo of a paper form before OCR"** — `detect_document` returns the four corner points so you (or a downstream tool) can deskew and crop the image before reading the text.

### Output schema (analyze_document)

```jsonc
{
  "source": { "path": "...", "pageCount": 1, "isPdf": false },
  "pages": [
    {
      "page": 0,
      // primary surface for reconstruction — reading-order paragraphs joined with "\n"
      "paragraphs": [
        { "paragraphId": 0, "lineIds": [0], "text": "ACME COFFEE" },
        { "paragraphId": 1, "lineIds": [1, 2], "text": "12 Main St\nPortland, OR" },
      ],
      // spatial fallback — raw blocks with page-local 0–1 bbox, confidence, line/paragraph membership
      "textBlocks": [
        {
          "text": "ACME COFFEE",
          "lineId": 0,
          "paragraphId": 0,
          "confidence": 0.99,
          "bbox": { "x": 0.21, "y": 0.04, "width": 0.58, "height": 0.06 },
        },
      ],
      "faces": [],
      "barcodes": [],
      "rectangles": [],
    },
  ],
  "summary": {
    "totalTextBlocks": 8,
    "totalParagraphs": 2,
    "totalFaces": 0,
    "totalBarcodes": 0,
    "totalRectangles": 0,
  },
}
```

Use `paragraphs[].text` for the 95% case (rebuild Markdown/HTML/plain text directly). Reach for `textBlocks[]` when you need spatial context — multi-column layouts, tables, forms, IDs.

**Notes:**

- `ocr_image` in `blocks` mode returns the same per-page shape minus the detection sections: `{ pages: [{ page, paragraphs, textBlocks }] }`.
- PDFs are processed page by page. All coordinates are page-local (0–1), and `paragraphId` / `lineId` reset on every page.
- Face, barcode, and rectangle detection on PDFs is best-effort — the underlying binary analyzes the file as a whole rather than per page, so any detections returned are attached to page 0 only.
- Paragraph grouping uses spatial heuristics. For multi-column layouts (magazine spreads, wiki pages with side panels) the heuristic can collapse the whole page into a single paragraph. When that happens, fall back to `textBlocks[]` and reconstruct from the bounding boxes.

## Configuration

All examples below use `npx -y` — the recommended default. No prior `npm install` needed; the package is fetched and cached on first run, and updates pick up automatically when the npx cache rolls over.

### Claude Code

```sh
claude mcp add macos-vision-mcp -- npx -y macos-vision-mcp
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-vision-mcp": {
      "command": "npx",
      "args": ["-y", "macos-vision-mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "macos-vision-mcp": {
      "command": "npx",
      "args": ["-y", "macos-vision-mcp"]
    }
  }
}
```

### Alternative: global install

If you'd rather skip the npx cache lookup on cold starts — or you want to pin a specific version — install once:

```sh
npm install -g macos-vision-mcp
```

…then use `"command": "macos-vision-mcp"` (no `args`) in any of the JSON configs above, or `claude mcp add macos-vision-mcp -- macos-vision-mcp` for Claude Code. Note that global installs can break when switching Node versions with nvm / asdf / volta — re-run `npm install -g` after switching.

## Contributing

Contributions are welcome. Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages — this project uses `release-it` with `@release-it/conventional-changelog` to automate releases.

```sh
git clone <repo>
cd macos-vision-mcp
npm install
npm run dev   # watch mode
```

## License

MIT — Adrian Wolczuk
