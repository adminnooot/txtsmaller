# 📄 TxtSmaller

Compress large text files (e.g. mbox exports) by replacing recurring patterns with short codes — optimized for AI readability.

## Features

- **Upload** a `.txt` file directly in the browser
- **Automatic pattern detection** — finds recurring email addresses, URLs, quoted lines, headers, and repeated phrases
- **Short-code replacement** — replaces each pattern with a compact code like `%A%`, `%B%`, etc.
- **Code dictionary** — a downloadable lookup table so any AI (or human) can decode the compressed file
- **File splitting** — divide the output into up to 20 separate files
- **Size & word stats** — see the weight and word count for each output file
- **100% client-side** — all processing happens in your browser; no data leaves your machine

## Usage

1. Open `index.html` in a browser (or visit the GitHub Pages site)
2. Drag-and-drop or browse for your `.txt` file
3. Choose how many files to split the output into (1–20)
4. Click **Compress & Optimize**
5. Download the compressed file(s) and the code dictionary

## Deploy to GitHub Pages

1. Go to your repo **Settings → Pages**
2. Set source to the branch containing these files (root `/`)
3. Your site will be live at `https://<user>.github.io/txtsmaller/`

## How It Works

The compressor scans for:

| Pattern | Example |
|---|---|
| Email addresses | `user@example.com` → `%A%` |
| URLs | `https://example.com/path` → `%B%` |
| Quoted lines | `> Original message follows` → `%C%` |
| Email headers | `From: John Doe <john@ex.com>` → `%D%` |
| Repeated phrases | Any 4–12 word phrase appearing 2+ times |

Each replacement only happens when it produces a net size reduction (accounting for dictionary overhead).

## Files

```
index.html      – Main page
style.css       – Styles
compressor.js   – Compression engine
app.js          – UI controller
```