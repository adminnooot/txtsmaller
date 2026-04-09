/**
 * TxtSmaller – Text Compression Engine
 *
 * Replaces recurring patterns (email addresses, quoted blocks, URLs,
 * repeated long phrases) with short codes and builds a dictionary
 * so an AI (or human) can decode the file.
 *
 * Supports async compression with progress callbacks for large files.
 */

/* ---------- helpers ---------- */

/**
 * Generate short code labels: %A%, %B%, … %Z%, %AA%, %AB%, …
 */
function generateCode(index) {
  let code = '';
  let n = index;
  do {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return '%' + code + '%';
}

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

/* ---------- pattern extraction (chunked for n-grams) ---------- */

/**
 * Extract recurring patterns from the text, ordered by total savings.
 * Yields to UI periodically for large texts.
 * Returns an array of { pattern: string, count: number }.
 */
async function extractPatternsAsync(text, onProgress) {
  const found = new Map();

  if (onProgress) onProgress('Finding emails & URLs…', 0);
  await yieldToUI();

  // 1. Email addresses
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  for (const m of text.matchAll(emailRe)) {
    found.set(m[0], (found.get(m[0]) || 0) + 1);
  }

  // 2. URLs
  const urlRe = /https?:\/\/[^\s"<>)\]]+/g;
  for (const m of text.matchAll(urlRe)) {
    found.set(m[0], (found.get(m[0]) || 0) + 1);
  }

  if (onProgress) onProgress('Finding quoted lines…', 0.15);
  await yieldToUI();

  // 3. Quoted lines
  const quotedLineRe = /^>.*$/gm;
  for (const m of text.matchAll(quotedLineRe)) {
    const line = m[0].trim();
    if (line.length > 10) {
      found.set(line, (found.get(line) || 0) + 1);
    }
  }

  if (onProgress) onProgress('Finding header patterns…', 0.25);
  await yieldToUI();

  // 4. Common email header patterns
  const headerPatterns = [
    /From:.*$/gm, /To:.*$/gm, /Subject:.*$/gm, /Date:.*$/gm,
    /Sent:.*$/gm, /Cc:.*$/gm, /Content-Type:.*$/gm,
    /MIME-Version:.*$/gm, /Message-ID:.*$/gm,
  ];
  for (const re of headerPatterns) {
    for (const m of text.matchAll(re)) {
      const val = m[0].trim();
      if (val.length > 15) {
        found.set(val, (found.get(val) || 0) + 1);
      }
    }
  }

  // 5. Repeated phrases (n-grams) — chunked to avoid UI freeze
  if (onProgress) onProgress('Finding repeated phrases…', 0.35);
  await yieldToUI();

  const words = text.split(/\s+/);
  const totalNgramSteps = 9; // n = 4..12
  let ngramStep = 0;

  for (let n = 4; n <= 12; n++) {
    const ngramCounts = new Map();
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length >= 20) {
        ngramCounts.set(phrase, (ngramCounts.get(phrase) || 0) + 1);
      }
      // Yield every 50000 iterations to keep UI responsive
      if (i % 50000 === 0 && i > 0) {
        await yieldToUI();
      }
    }
    for (const [phrase, count] of ngramCounts) {
      if (count >= 2) {
        found.set(phrase, Math.max(found.get(phrase) || 0, count));
      }
    }
    ngramStep++;
    if (onProgress) onProgress('Finding repeated phrases… (n=' + n + ')', 0.35 + 0.55 * (ngramStep / totalNgramSteps));
    await yieldToUI();
  }

  if (onProgress) onProgress('Sorting patterns…', 0.95);
  await yieldToUI();

  // Filter and sort
  const patterns = [];
  for (const [pattern, count] of found) {
    if (count >= 2) {
      patterns.push({ pattern, count });
    }
  }

  patterns.sort((a, b) => (b.pattern.length * b.count) - (a.pattern.length * a.count));

  if (onProgress) onProgress('Patterns ready', 1);
  return patterns;
}

/* ---------- compression (async with progress) ---------- */

/**
 * Compress the given text asynchronously with progress updates.
 * onProgress(stage, percent, detail) is called throughout.
 * Returns { compressed, dictionary, dictionaryText, stats }.
 */
async function compressTextAsync(text, onProgress) {
  if (!onProgress) onProgress = function () {};

  // Phase 1: Clean noise (0–30%)
  onProgress('Cleaning…', 0, 'Removing noise and email artifacts…');
  const cleanResult = await cleanContentAsync(text, function (stage, frac) {
    onProgress(stage, Math.round(frac * 30), 'Processing ' + formatBytes(text.length) + ' of text…');
  });
  const cleanedText = cleanResult.cleaned;

  // Phase 2: Extract patterns (30–70%)
  onProgress('Analyzing…', 30, 'Scanning for recurring patterns…');
  const patterns = await extractPatternsAsync(cleanedText, function (stage, frac) {
    onProgress(stage, 30 + Math.round(frac * 40), stage);
  });

  // Phase 3: Replace patterns (70–95%)
  onProgress('Compressing…', 70, 'Replacing ' + patterns.length + ' patterns with codes…');
  await yieldToUI();

  const dictionary = [];
  let compressed = cleanedText;
  let codeIndex = 0;
  const batchSize = 20; // yield after every N replacements

  for (let pi = 0; pi < patterns.length; pi++) {
    const pattern = patterns[pi].pattern;
    const occurrences = compressed.split(pattern).length - 1;
    if (occurrences < 2) continue;

    const code = generateCode(codeIndex);
    const dictEntryOverhead = code.length + 3 + pattern.length;
    const savings = (pattern.length * occurrences) - (code.length * occurrences + dictEntryOverhead);
    if (savings <= 0) continue;

    const escaped = pattern.replace(/[.*+?^${}()|\\[\]\\\\]/g, '\\$&');
    compressed = compressed.replace(new RegExp(escaped, 'g'), code);

    dictionary.push({ code, original: pattern, count: occurrences });
    codeIndex++;

    if (pi % batchSize === 0) {
      const pct = 70 + Math.round((pi / patterns.length) * 25);
      onProgress('Compressing…', pct, 'Applied ' + codeIndex + ' codes so far…');
      await yieldToUI();
    }
  }

  // Phase 4: Finalize (95–100%)
  onProgress('Finalizing…', 95, 'Calculating statistics…');
  await yieldToUI();

  const originalSize = new Blob([text]).size;
  const compressedSize = new Blob([compressed]).size;
  const dictText = buildDictionaryText(dictionary);
  const dictSize = new Blob([dictText]).size;

  onProgress('Done!', 100, 'Compression complete');

  return {
    compressed: compressed,
    dictionary: dictionary,
    dictionaryText: dictText,
    stats: {
      originalSize: originalSize,
      compressedSize: compressedSize + dictSize,
      compressedBodySize: compressedSize,
      dictSize: dictSize,
      savings: originalSize - (compressedSize + dictSize),
      savingsPercent: originalSize > 0 ? (((originalSize - (compressedSize + dictSize)) / originalSize) * 100).toFixed(1) : '0.0',
      codesUsed: dictionary.length,
      removedChars: cleanResult.removedChars,
    }
  };
}

/* ---------- dictionary ---------- */

function buildDictionaryText(dictionary) {
  if (dictionary.length === 0) return '';

  let text = '=== TXTSMALLER CODE DICTIONARY ===\n';
  text += 'Use this dictionary to decode the compressed file(s).\n';
  text += 'Each code below maps to the original text it replaced.\n';
  text += '==========================================\n\n';

  for (const entry of dictionary) {
    text += entry.code + ' = ' + entry.original + '\n';
  }

  text += '\n=== END DICTIONARY ===\n';
  return text;
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
