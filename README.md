# macos-vision-mcp

MCP server for Claude Code that wraps Apple's Vision Framework — local OCR, face detection, barcode reading and image classification. **No cloud. No API keys. Everything stays on your Mac.**

## Requirements

- macOS 12 Monterey or later
- Node.js 18+
- Xcode Command Line Tools

```sh
xcode-select --install
```

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

| Tool | What it does |
|---|---|
| `ocr_image` | Extract text from an image or PDF (JPG, PNG, HEIC, TIFF, PDF). Returns plain text or structured blocks with bounding boxes. |
| `detect_faces` | Detect human faces and return their count and positions. |
| `detect_barcodes` | Read QR codes, EAN, UPC, Code128, PDF417, Aztec and other 1D/2D codes. |
| `classify_image` | Classify image content into 1000+ categories with confidence scores. |
| `analyze_document` | Full pipeline: OCR + faces + barcodes + rectangles in one shot. |

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
