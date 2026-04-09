/**
 * TxtSmaller – UI Controller
 */

(function () {
  /* ── DOM refs ──────────────────────────────────── */
  const uploadArea     = document.getElementById('upload-area');
  const fileInput      = document.getElementById('file-input');
  const fileInfo       = document.getElementById('file-info');
  const fileName       = document.getElementById('file-name');
  const fileSize       = document.getElementById('file-size');
  const removeFileBtn  = document.getElementById('remove-file');

  const optionsSection = document.getElementById('options-section');
  const splitRange     = document.getElementById('split-count');
  const splitValue     = document.getElementById('split-value');
  const compressBtn    = document.getElementById('compress-btn');

  const resultsSection = document.getElementById('results-section');
  const statOriginal   = document.getElementById('original-size');
  const statCompressed = document.getElementById('compressed-size');
  const statSavings    = document.getElementById('savings');
  const statCodes      = document.getElementById('codes-used');
  const filesGrid      = document.getElementById('files-grid');
  const downloadDict   = document.getElementById('download-dict-btn');
  const downloadAll    = document.getElementById('download-all-btn');

  /* ── State ─────────────────────────────────────── */
  let rawText = null;
  let currentResult = null; // { compressed, dictionary, dictionaryText, stats }
  let currentFiles  = null; // [{ name, content, size, words }]

  /* ── File Upload ───────────────────────────────── */
  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  removeFileBtn.addEventListener('click', resetAll);

  function handleFile(file) {
    if (!file.name.match(/\.(txt|text)$/i)) {
      alert('Please upload a .txt or .text file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      rawText = e.target.result;
      fileName.textContent = file.name;
      fileSize.textContent = formatBytes(file.size);
      fileInfo.classList.remove('hidden');
      uploadArea.classList.add('hidden');
      optionsSection.classList.remove('hidden');
      resultsSection.classList.add('hidden');
    };
    reader.readAsText(file);
  }

  function resetAll() {
    rawText = null;
    currentResult = null;
    currentFiles = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    uploadArea.classList.remove('hidden');
    optionsSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
  }

  /* ── Split Slider ──────────────────────────────── */
  splitRange.addEventListener('input', () => {
    const v = splitRange.value;
    splitValue.textContent = v === '1' ? '1 file' : v + ' files';
  });

  /* ── Compress ──────────────────────────────────── */
  compressBtn.addEventListener('click', () => {
    if (!rawText) return;

    compressBtn.disabled = true;
    compressBtn.textContent = '⏳ Compressing…';

    // Use setTimeout so the UI updates before heavy work
    setTimeout(() => {
      try {
        currentResult = compressText(rawText);
        const splitCount = parseInt(splitRange.value, 10);
        const baseName = (fileName.textContent || 'output').replace(/\.[^.]+$/, '');
        currentFiles = splitText(currentResult.compressed, splitCount, baseName);

        renderResults();
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        alert('Error compressing file: ' + err.message);
        console.error(err);
      } finally {
        compressBtn.disabled = false;
        compressBtn.textContent = '🔧 Compress & Optimize';
      }
    }, 50);
  });

  /* ── Render Results ────────────────────────────── */
  function renderResults() {
    const s = currentResult.stats;

    statOriginal.textContent   = formatBytes(s.originalSize);
    statCompressed.textContent = formatBytes(s.compressedSize);
    statCodes.textContent      = s.codesUsed;

    if (s.savings > 0) {
      statSavings.textContent = formatBytes(s.savings) + ' (' + s.savingsPercent + '%)';
      statSavings.style.color = '#4ade80';
    } else {
      statSavings.textContent = 'No savings (file may already be minimal)';
      statSavings.style.color = '#fbbf24';
    }

    // Show/hide dictionary button based on whether codes were used
    downloadDict.style.display = s.codesUsed > 0 ? '' : 'none';

    // File cards
    filesGrid.innerHTML = '';
    currentFiles.forEach((file, idx) => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.innerHTML =
        '<h3>' + escapeHtml(file.name) + '</h3>' +
        '<div class="meta">' +
          '<span><strong>Size:</strong> ' + formatBytes(file.size) + '</span>' +
          '<span><strong>Words:</strong> ' + file.words.toLocaleString() + '</span>' +
        '</div>' +
        '<button class="btn-secondary download-single" data-index="' + idx + '">⬇ Download</button>';
      filesGrid.appendChild(card);
    });

    // Attach download handlers
    filesGrid.querySelectorAll('.download-single').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.index, 10);
        downloadFile(currentFiles[i].name, currentFiles[i].content);
      });
    });
  }

  /* ── Downloads ─────────────────────────────────── */
  downloadDict.addEventListener('click', () => {
    if (!currentResult) return;
    downloadFile('code_dictionary.txt', currentResult.dictionaryText);
  });

  downloadAll.addEventListener('click', async () => {
    if (!currentResult || !currentFiles) return;

    if (typeof JSZip === 'undefined') {
      // Fallback: download dictionary + first file individually
      downloadFile('code_dictionary.txt', currentResult.dictionaryText);
      currentFiles.forEach((f) => downloadFile(f.name, f.content));
      return;
    }

    const zip = new JSZip();
    zip.file('code_dictionary.txt', currentResult.dictionaryText);
    currentFiles.forEach((f) => zip.file(f.name, f.content));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'txtsmaller_output.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function downloadFile(name, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Utilities ─────────────────────────────────── */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
