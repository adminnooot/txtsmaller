/**
 * TxtSmaller – Text Compression Engine
 *
 * Replaces recurring patterns (email addresses, quoted blocks, URLs,
 * repeated long phrases) with short codes and builds a dictionary
 * so an AI (or human) can decode the file.
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

/* ---------- pattern extraction ---------- */

/**
 * Extract recurring patterns from the text, ordered by total savings.
 * Returns an array of { pattern: string, count: number }.
 */
function extractPatterns(text) {
  const found = new Map(); // pattern -> count

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

  // 3. Quoted lines (lines starting with "> " that repeat)
  const quotedLineRe = /^>.*$/gm;
  for (const m of text.matchAll(quotedLineRe)) {
    const line = m[0].trim();
    if (line.length > 10) {
      found.set(line, (found.get(line) || 0) + 1);
    }
  }

  // 4. Common email header patterns
  const headerPatterns = [
    /From:.*$/gm,
    /To:.*$/gm,
    /Subject:.*$/gm,
    /Date:.*$/gm,
    /Sent:.*$/gm,
    /Cc:.*$/gm,
    /Content-Type:.*$/gm,
    /MIME-Version:.*$/gm,
    /Message-ID:.*$/gm,
  ];
  for (const re of headerPatterns) {
    for (const m of text.matchAll(re)) {
      const val = m[0].trim();
      if (val.length > 15) {
        found.set(val, (found.get(val) || 0) + 1);
      }
    }
  }

  // 5. Repeated phrases (sliding window over words for n-grams, n=4..12)
  const words = text.split(/\s+/);
  for (let n = 4; n <= 12; n++) {
    const ngramCounts = new Map();
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length >= 20) {
        ngramCounts.set(phrase, (ngramCounts.get(phrase) || 0) + 1);
      }
    }
    for (const [phrase, count] of ngramCounts) {
      if (count >= 2) {
        // Only add if it provides savings
        found.set(phrase, Math.max(found.get(phrase) || 0, count));
      }
    }
  }

  // Filter: keep only patterns that appear at least 2 times
  const patterns = [];
  for (const [pattern, count] of found) {
    if (count >= 2) {
      patterns.push({ pattern, count });
    }
  }

  // Sort by total characters saved (descending) — prioritize biggest wins
  patterns.sort((a, b) => {
    const savingsA = a.pattern.length * a.count;
    const savingsB = b.pattern.length * b.count;
    return savingsB - savingsA;
  });

  return patterns;
}

/* ---------- compression ---------- */

/**
 * Compress the given text.
 * Returns { compressed, dictionary, stats }.
 */
function compressText(text) {
  const patterns = extractPatterns(text);

  const dictionary = []; // { code, original }
  let compressed = text;
  let codeIndex = 0;

  for (const { pattern } of patterns) {
    // Check if the pattern still exists in the (progressively replaced) text
    // and that replacing it actually saves space
    const occurrences = compressed.split(pattern).length - 1;
    if (occurrences < 2) continue;

    const code = generateCode(codeIndex);
    // Savings = (pattern.length * occurrences) - (code.length * occurrences + dictionary entry overhead)
    const dictEntryOverhead = code.length + 3 + pattern.length; // "code = pattern\n"
    const savings = (pattern.length * occurrences) - (code.length * occurrences + dictEntryOverhead);
    if (savings <= 0) continue;

    // Escape special regex characters in pattern for safe replacement
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    compressed = compressed.replace(new RegExp(escaped, 'g'), code);

    dictionary.push({ code, original: pattern, count: occurrences });
    codeIndex++;
  }

  const originalSize = new Blob([text]).size;
  const compressedSize = new Blob([compressed]).size;
  const dictText = buildDictionaryText(dictionary);
  const dictSize = new Blob([dictText]).size;

  return {
    compressed,
    dictionary,
    dictionaryText: dictText,
    stats: {
      originalSize,
      compressedSize: compressedSize + dictSize,
      compressedBodySize: compressedSize,
      dictSize,
      savings: originalSize - (compressedSize + dictSize),
      savingsPercent: originalSize > 0 ? (((originalSize - (compressedSize + dictSize)) / originalSize) * 100).toFixed(1) : '0.0',
      codesUsed: dictionary.length,
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
