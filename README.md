# 📄 TxtSmaller

**[🚀 Launch TxtSmaller](https://adminnooot.github.io/txtsmaller/)**

Clean and shrink large text files (e.g. mbox exports) by stripping noise, HTML, and email artifacts — optimized for AI readability.

## Features

- **Upload** a `.txt` file directly in the browser
- **Content cleaning** — automatically strips MIME boundaries, email-transport headers, base64 blobs, HTML tags, style/script blocks, HTML comments, and quoted-printable artifacts
- **Whitespace normalization** — removes blank lines and collapses excessive spacing
- **HTML entity decoding** — converts `&amp;`, `&lt;`, `&nbsp;`, etc. back to plain text
- **File splitting** — divide the output into up to 20 separate files
- **Size & word stats** — see the weight and word count for each output file
- **100% client-side** — all processing happens in your browser; no data leaves your machine

## Usage

1. Open `index.html` in a browser (or visit the GitHub Pages site)
2. Drag-and-drop or browse for your `.txt` file
3. Wait for automatic cleaning to complete
4. Choose how many files to split the output into (1–20)
5. Download the cleaned file(s)

## Deploy to GitHub Pages

1. Go to your repo **Settings → Pages**
2. Set source to the branch containing these files (root `/`)
3. Your site will be live at `https://<user>.github.io/txtsmaller/`

## How It Works

The cleaner removes the following noise from your text:

| Noise type | What gets removed |
|---|---|
| MIME boundaries | `------=_Part_123--` and similar lines |
| Email headers | `Content-Type:`, `Content-Transfer-Encoding:`, `MIME-Version:`, etc. |
| Base64 data | Blocks of encoded binary data |
| HTML markup | Tags, style blocks, script blocks, comments |
| HTML entities | Decoded back to plain characters |
| Quoted-printable | `=3D` → `=`, soft line breaks removed |
| Blank lines | Collapsed to at most one blank line |

## Files

```
index.html      – Main page
style.css       – Styles
compressor.js   – Cleaning engine
app.js          – UI controller
```