# macos-vision-mcp

Local OCR & image analysis for any MCP client — private, offline, no API keys.

[![npm version](https://img.shields.io/npm/v/macos-vision-mcp?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/macos-vision-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-ffd60a?style=flat-square)](LICENSE)
[![macOS 13.0+](https://img.shields.io/badge/macOS-13.0%2B-0078d7?logo=apple&logoColor=white&style=flat-square)](https://developer.apple.com/documentation/vision)
[![No API Key](https://img.shields.io/badge/no%20API%20key-required-brightgreen?style=flat-square)](#)
[![Offline](https://img.shields.io/badge/offline-yes-blue?style=flat-square)](#)

Pre-extracts text and image data locally before your AI ever sees it — cutting token usage by ~97% on real documents. Files never leave your Mac: no cloud API, no API keys, no network requests.

## What you get

- OCR for images and PDFs (JPG, PNG, HEIC, TIFF, multi-page PDF) via Apple Vision Framework.
- ~97% token reduction: a 44-page PDF costs ~2,400 tokens instead of ~73,500.
- Face detection, barcode/QR reading, and image classification — all on-device.
- Full document pipeline: OCR + faces + barcodes + rectangles in a single tool call.
- Works with Claude Code, Claude Desktop, and Cursor — any MCP-compatible client.

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

**Step 1** — Install the package:

```sh
npm install -g macos-vision-mcp
```

**Step 2** — Add to your MCP client (example for Claude Code):

```sh
claude mcp add macos-vision-mcp -- macos-vision-mcp
```

Restart your client. The tools appear automatically.

> **Note:** The native module `macos-vision` compiles against your local Node.js at install time. If you switch Node versions, run `npm rebuild` inside the package directory.

## Available Tools

| Tool               | What it does                                                                                                                | Example prompt                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ocr_image`        | Extract text from an image or PDF (JPG, PNG, HEIC, TIFF, PDF). Returns plain text or structured blocks with bounding boxes. | "Read the text from ~/Desktop/screenshot.png"  |
| `detect_faces`     | Detect human faces and return their count and positions.                                                                    | "How many people are in this photo?"           |
| `detect_barcodes`  | Read QR codes, EAN, UPC, Code128, PDF417, Aztec, and other 1D/2D codes.                                                     | "What does the QR code in /tmp/qr.jpg say?"    |
| `classify_image`   | Classify image content into 1000+ categories with confidence scores.                                                        | "What is in this image?"                       |
| `analyze_document` | Full pipeline: OCR + faces + barcodes + rectangles in one call.                                                             | "Extract everything from this scanned invoice" |

## Configuration

### Claude Code

```sh
claude mcp add macos-vision-mcp -- macos-vision-mcp
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-vision-mcp": {
      "command": "macos-vision-mcp"
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
      "command": "macos-vision-mcp"
    }
  }
}
```

If you installed with `npx` rather than globally, replace `"command": "macos-vision-mcp"` with `"command": "npx", "args": ["macos-vision-mcp"]`.

## Privacy by design

- No files are uploaded to any server
- Powered by Apple Vision Framework — same engine as Live Text in Photos.app
- 100% offline after `npm install`

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
