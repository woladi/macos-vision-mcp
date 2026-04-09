# macos-vision-mcp

[![npm version](https://img.shields.io/npm/v/macos-vision-mcp)](https://www.npmjs.com/package/macos-vision-mcp)
[![license](https://img.shields.io/npm/l/macos-vision-mcp)](LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://developer.apple.com/documentation/vision)
[![no API key](https://img.shields.io/badge/no%20API%20key-required-brightgreen)](#)

Pre-extracts text and image data locally before Claude ever sees it — cutting token usage by ~97% on real documents. Files never leave your Mac: no cloud API, no API keys, no network requests.

## Requirements

- macOS 12 Monterey or later
- Node.js 18+
- Xcode Command Line Tools

```sh
xcode-select --install
```

## Why?

Sending images or PDFs directly to Claude is expensive. This server pre-extracts the content locally and sends only the text — a fraction of the tokens:

| Method                                | Tokens (44-page PDF) |
| ------------------------------------- | -------------------- |
| Claude Code reading PDF directly      | ~73,500              |
| Claude.ai file upload                 | ~61,500              |
| **macos-vision-mcp (pre-extraction)** | **~2,400**           |

That's ~97% fewer tokens — meaning more context for your actual work.

## Installation

1. Install the package globally (or use `npx`):

```sh
npm install -g macos-vision-mcp
```

2. Register the MCP server with Claude Code:

```sh
claude mcp add macos-vision-mcp -- macos-vision-mcp
```

3. Restart Claude Code. The tools will appear automatically.

> **Note:** The underlying native module `macos-vision` is compiled against your local Node.js during install. If you switch Node versions, run `npm rebuild` inside the package directory.

## Available Tools

| Tool               | What it does                                                                                                                | Example trigger                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ocr_image`        | Extract text from an image or PDF (JPG, PNG, HEIC, TIFF, PDF). Returns plain text or structured blocks with bounding boxes. | "Read the text from ~/Desktop/screenshot.png"  |
| `detect_faces`     | Detect human faces and return their count and positions.                                                                    | "How many people are in this photo?"           |
| `detect_barcodes`  | Read QR codes, EAN, UPC, Code128, PDF417, Aztec and other 1D/2D codes.                                                      | "What does this QR code say?"                  |
| `classify_image`   | Classify image content into 1000+ categories with confidence scores.                                                        | "What's in this image?"                        |
| `analyze_document` | Full pipeline: OCR + faces + barcodes + rectangles in one shot.                                                             | "Extract everything from this scanned invoice" |

## Usage Examples

**Extract text from a screenshot:**

```
Read the text from ~/Desktop/screenshot.png
```

**Decode a QR code from a saved image:**

```
What does the QR code in /tmp/qr.jpg say?
```

**Full document analysis:**

```
Analyze /Users/me/Documents/scan.pdf and extract everything you can find.
```

## Privacy by design

- No files are uploaded to any server
- Processing uses Apple's on-device Vision framework — same engine as Photos.app and Live Text
- Works fully offline — no network requests after `npm install`

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
