/**
 * TxtSmaller – Text Compression Engine
 *
 * Cleans noise (HTML, MIME headers, base64, email artifacts, etc.)
 * from text files to reduce size for AI consumption.
 *
 * Supports async compression with progress callbacks for large files.
 */

/* ---------- helpers ---------- */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function countWords(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Yield control to the browser so the UI can update.
 * Used inside async compression to avoid freezing.
 */
function yieldToUI() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

/* ---------- content cleaning (chunked) ---------- */

/**
 * Clean content in chunks for large files.
 * onProgress(stage, fraction) is called with 0..1 progress.
 * Returns { cleaned, removedChars }.
 */
async function cleanContentAsync(text, onProgress) {
  const original = text;
  const CHUNK = 500000; // 500 KB per step for regex passes
  const steps = 13; // total regex-pass steps
  let step = 0;

  function report() {
    step++;
    if (onProgress) onProgress('Cleaning noise…', step / steps);
  }

  // 1. Remove MIME boundary lines
  text = text.replace(/^-{2,}[\w=_.]+(-{2})?[ \t]*$/gm, '');
  report(); await yieldToUI();

  // 2. Remove MIME / email-transport headers
  text = text.replace(/^(Content-Type|Content-Transfer-Encoding|Content-Disposition|MIME-Version|Content-ID|X-Attachment-Id):.*(?:\r?\n[ \t]+.*)*/gm, '');
  report(); await yieldToUI();

  // 3. Remove standalone charset / boundary / name params
  text = text.replace(/^\s*(charset|boundary|name|filename)\s*=\s*"[^"]*".*$/gm, '');
  report(); await yieldToUI();

  // 4. Remove blocks of base64 data
  text = text.replace(/(^[A-Za-z0-9+/=]{60,}[ \t]*\r?\n){3,}/gm, '');
  report(); await yieldToUI();

  // 5. Remove <style>…</style> blocks
  let prev;
  do { prev = text; text = text.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ''); } while (text !== prev);
  report(); await yieldToUI();

  // 5b. Remove <script>…</script> blocks
  do { prev = text; text = text.replace(/<script\b[\s\S]*?<\/\s*script[\s\S]*?>/gi, ''); } while (text !== prev);
  report(); await yieldToUI();

  // 6. Remove HTML comments
  do { prev = text; text = text.replace(/<!--[\s\S]*?--!?\s*>/g, ''); } while (text !== prev);
  report(); await yieldToUI();

  // 7. Strip all HTML tags
  text = text.replace(/<\/?[a-zA-Z][^>]*\/?>/g, '');
  text = text.replace(/--!?\s*>/g, '');
  text = text.replace(/<!--/g, '');
  report(); await yieldToUI();

  // 7c. Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&#x?[0-9A-Fa-f]+;/g, '');
  text = text.replace(/&amp;/gi, '&');
  report(); await yieldToUI();

  // 8. Decode quoted-printable artifacts
  text = text.replace(/=\r?\n/g, '');
  text = text.replace(/=([0-9A-Fa-f]{2})/g, function (_m, hex) {
    const charCode = parseInt(hex, 16);
    if (charCode >= 0x20 && charCode <= 0x7E) return String.fromCharCode(charCode);
    return '';
  });
  report(); await yieldToUI();

  // 9. Remove whitespace-only lines
  text = text.replace(/^[ \t\r]*$/gm, '');
  report(); await yieldToUI();

  // 10. Collapse blank lines
  text = text.replace(/(\r?\n){3,}/g, '\n\n');
  report(); await yieldToUI();

  text = text.trim() + '\n';
  report();

  var removedChars = original.length - text.length;
  return { cleaned: text, removedChars: Math.max(0, removedChars) };
}

/* ---------- compression (async with progress) ---------- */

/**
 * Compress the given text asynchronously with progress updates.
 * Cleans noise from the text (HTML, MIME, base64, etc.).
 * onProgress(stage, percent, detail) is called throughout.
 * Returns { compressed, stats }.
 */
async function compressTextAsync(text, onProgress) {
  if (!onProgress) onProgress = function () {};

  // Phase 1: Clean noise (0–90%)
  onProgress('Cleaning…', 0, 'Removing noise and email artifacts…');
  const cleanResult = await cleanContentAsync(text, function (stage, frac) {
    onProgress(stage, Math.round(frac * 90), 'Processing ' + formatBytes(text.length) + ' of text…');
  });
  const compressed = cleanResult.cleaned;

  // Phase 2: Finalize (90–100%)
  onProgress('Finalizing…', 90, 'Calculating statistics…');
  await yieldToUI();

  const originalSize = new Blob([text]).size;
  const compressedSize = new Blob([compressed]).size;

  onProgress('Done!', 100, 'Compression complete');

  return {
    compressed: compressed,
    stats: {
      originalSize: originalSize,
      compressedSize: compressedSize,
      savings: originalSize - compressedSize,
      savingsPercent: originalSize > 0 ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(1) : '0.0',
      removedChars: cleanResult.removedChars,
    }
  };
}

/* ---------- splitting ---------- */

/**
 * Split compressed text into `count` roughly equal parts, breaking on
 * paragraph / line boundaries where possible.
 * Returns an array of { name, content, size, words } objects.
 */
function splitText(compressedText, count, baseName) {
  if (count <= 1) {
    return [{
      name: baseName + '_compressed.txt',
      content: compressedText,
      size: new Blob([compressedText]).size,
      words: countWords(compressedText),
    }];
  }

  const totalLen = compressedText.length;
  const targetLen = Math.ceil(totalLen / count);

  // Split on paragraph boundaries (double newline), fallback to single newline
  const parts = [];
  let remaining = compressedText;

  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      // Last chunk gets everything remaining
      parts.push(remaining);
      break;
    }

    if (remaining.length <= targetLen) {
      parts.push(remaining);
      remaining = '';
      break;
    }

    // Look for a paragraph break near the target length
    let splitAt = -1;
    const searchStart = Math.max(0, targetLen - 200);
    const searchEnd = Math.min(remaining.length, targetLen + 200);
    const searchZone = remaining.substring(searchStart, searchEnd);

    // Try paragraph break first
    const paraBreak = searchZone.lastIndexOf('\n\n');
    if (paraBreak !== -1) {
      splitAt = searchStart + paraBreak + 2;
    } else {
      // Try line break
      const lineBreak = searchZone.lastIndexOf('\n');
      if (lineBreak !== -1) {
        splitAt = searchStart + lineBreak + 1;
      } else {
        // Hard split at target
        splitAt = targetLen;
      }
    }

    parts.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }

  // If we ran out of text before reaching `count`, pad with empty
  while (parts.length < count) {
    parts.push('');
  }

  // Remove trailing empty parts
  while (parts.length > 1 && parts[parts.length - 1].trim() === '') {
    parts.pop();
  }

  return parts.map((content, idx) => ({
    name: baseName + '_part' + (idx + 1) + '.txt',
    content,
    size: new Blob([content]).size,
    words: countWords(content),
  }));
}
