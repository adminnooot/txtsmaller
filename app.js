/**
 * TxtSmaller – UI Controller (Two-Step Flow)
 *
 * Step 1: Upload file → auto-compress with live progress
 * Step 2: Choose split count → see per-file estimates → download
 */

(function () {
  /* ── DOM refs ──────────────────────────────────── */
  const uploadArea      = document.getElementById('upload-area');
  const fileInput       = document.getElementById('file-input');
  const fileInfo        = document.getElementById('file-info');
  const fileName        = document.getElementById('file-name');
  const fileSize        = document.getElementById('file-size');
  const removeFileBtn   = document.getElementById('remove-file');

  const progressSection = document.getElementById('progress-section');
  const progressStage   = document.getElementById('progress-stage');
  const progressPercent = document.getElementById('progress-percent');
  const progressBar     = document.getElementById('progress-bar');
  const progressDetail  = document.getElementById('progress-detail');

  const splitSection    = document.getElementById('split-section');
  const splitRange      = document.getElementById('split-count');
  const splitValue      = document.getElementById('split-value');
  const splitEachSize   = document.getElementById('split-each-size');
  const splitEachWords  = document.getElementById('split-each-words');
  const startOverBtn    = document.getElementById('start-over-btn');

  const statOriginal    = document.getElementById('original-size');
  const statCompressed  = document.getElementById('compressed-size');
  const statSavings     = document.getElementById('savings');
  const statCodes       = document.getElementById('codes-used');
  const statNoise       = document.getElementById('noise-removed');
  const filesGrid       = document.getElementById('files-grid');
  const downloadDict    = document.getElementById('download-dict-btn');
  const downloadAll     = document.getElementById('download-all-btn');

  /* ── State ─────────────────────────────────────── */
  let rawText = null;
  let currentResult = null; // { compressed, dictionary, dictionaryText, stats }
  let currentFiles  = null; // [{ name, content, size, words }]
  let compressing   = false;

  /* ── File Upload ───────────────────────────────── */
  uploadArea.addEventListener('click', function () { fileInput.click(); });

  uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', function () {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  removeFileBtn.addEventListener('click', resetAll);
  startOverBtn.addEventListener('click', resetAll);

  function handleFile(file) {
    if (!file.name.match(/\.(txt|text)$/i)) {
      alert('Please upload a .txt or .text file.');
      return;
    }

    if (compressing) return;

    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileInfo.classList.remove('hidden');
    uploadArea.classList.add('hidden');
    splitSection.classList.add('hidden');

    // Show progress immediately
    showProgress('Reading file…', 0, 'Loading ' + formatBytes(file.size) + '…');

    const reader = new FileReader();

    reader.onprogress = function (e) {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 10); // reading is 0-10%
        showProgress('Reading file…', pct, formatBytes(e.loaded) + ' of ' + formatBytes(e.total) + ' loaded');
      }
    };

    reader.onload = function (e) {
      rawText = e.target.result;
      showProgress('File loaded', 10, formatBytes(rawText.length) + ' ready – starting compression…');
      startCompression();
    };

    reader.onerror = function () {
      alert('Error reading file.');
      resetAll();
    };

    reader.readAsText(file);
  }

  function resetAll() {
    rawText = null;
    currentResult = null;
    currentFiles = null;
    compressing = false;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    uploadArea.classList.remove('hidden');
    splitSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    splitRange.value = 1;
    splitValue.textContent = '1 file';
    filesGrid.innerHTML = '';
  }

  /* ── Progress helpers ──────────────────────────── */
  function showProgress(stage, percent, detail) {
    progressSection.classList.remove('hidden');
    progressStage.textContent = stage;
    progressPercent.textContent = percent + '%';
    progressBar.style.width = percent + '%';
    if (detail) progressDetail.textContent = detail;
  }

  /* ── Compression (auto-starts after upload) ────── */
  async function startCompression() {
    if (!rawText || compressing) return;
    compressing = true;

    try {
      // Map compressor progress (0-100) to our display (10-100, since 0-10 was file reading)
      currentResult = await compressTextAsync(rawText, function (stage, pct, detail) {
        const displayPct = 10 + Math.round(pct * 0.9);
        showProgress(stage, displayPct, detail);
      });

      showProgress('Done!', 100, 'Compression complete – choose how to split your file below');

      // Default to 1 file
      splitRange.value = 1;
      splitValue.textContent = '1 file';
      updateSplitPreview();
      renderStats();

      // Show step 2
      splitSection.classList.remove('hidden');
      splitSection.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      alert('Error compressing file: ' + err.message);
      console.error(err);
      resetAll();
    } finally {
      compressing = false;
    }
  }

  /* ── Split Slider ──────────────────────────────── */
  splitRange.addEventListener('input', function () {
    const count = splitRange.value;
    splitValue.textContent = count === '1' ? '1 file' : count + ' files';
    updateSplitPreview();
    renderFileCards();
  });

  function updateSplitPreview() {
    if (!currentResult) return;

    const splitCount = parseInt(splitRange.value, 10);
    const baseName = (fileName.textContent || 'output').replace(/\.[^.]+$/, '');
    currentFiles = splitText(currentResult.compressed, splitCount, baseName);

    if (currentFiles.length === 1) {
      splitEachSize.textContent = formatBytes(currentFiles[0].size);
      splitEachWords.textContent = currentFiles[0].words.toLocaleString();
    } else {
      // Show average
      let totalSize = 0;
      let totalWords = 0;
      for (let i = 0; i < currentFiles.length; i++) {
        totalSize += currentFiles[i].size;
        totalWords += currentFiles[i].words;
      }
      splitEachSize.textContent = '~' + formatBytes(Math.round(totalSize / currentFiles.length));
      splitEachWords.textContent = '~' + Math.round(totalWords / currentFiles.length).toLocaleString();
    }
  }

  /* ── Render Stats ──────────────────────────────── */
  function renderStats() {
    const s = currentResult.stats;

    statOriginal.textContent   = formatBytes(s.originalSize);
    statCompressed.textContent = formatBytes(s.compressedSize);
    statCodes.textContent      = s.codesUsed;

    if (s.removedChars > 0) {
      statNoise.textContent = formatBytes(s.removedChars);
      statNoise.style.color = '#4ade80';
    } else {
      statNoise.textContent = 'None';
      statNoise.style.color = '#94a3b8';
    }

    if (s.savings > 0) {
      statSavings.textContent = formatBytes(s.savings) + ' (' + s.savingsPercent + '%)';
      statSavings.style.color = '#4ade80';
    } else {
      statSavings.textContent = 'No savings (file may already be minimal)';
      statSavings.style.color = '#fbbf24';
    }

    // Show/hide dictionary button
    downloadDict.style.display = s.codesUsed > 0 ? '' : 'none';

    renderFileCards();
  }

  function renderFileCards() {
    if (!currentFiles) return;

    filesGrid.innerHTML = '';
    currentFiles.forEach(function (file, idx) {
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

    filesGrid.querySelectorAll('.download-single').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = parseInt(btn.dataset.index, 10);
        downloadFile(currentFiles[i].name, currentFiles[i].content);
      });
    });
  }

  /* ── Downloads ─────────────────────────────────── */
  downloadDict.addEventListener('click', function () {
    if (!currentResult) return;
    downloadFile('code_dictionary.txt', currentResult.dictionaryText);
  });

  downloadAll.addEventListener('click', async function () {
    if (!currentResult || !currentFiles) return;

    if (typeof JSZip === 'undefined') {
      alert('Zip packaging is unavailable. Files will be downloaded individually.');
      if (currentResult.stats.codesUsed > 0) {
        downloadFile('code_dictionary.txt', currentResult.dictionaryText);
      }
      currentFiles.forEach(function (f) { downloadFile(f.name, f.content); });
      return;
    }

    const zip = new JSZip();
    if (currentResult.stats.codesUsed > 0) {
      zip.file('code_dictionary.txt', currentResult.dictionaryText);
    }
    currentFiles.forEach(function (f) { zip.file(f.name, f.content); });

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
