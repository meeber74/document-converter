// Configure PDF.js worker
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const statusCard = document.getElementById('statusCard');
const statusContent = document.getElementById('statusContent');

// Drag-and-drop events
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
['dragleave', 'dragend'].forEach(evt =>
  dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'))
);
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function getExt(name) {
  return name.split('.').pop().toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function outputName(originalName) {
  const parts = originalName.split('.');
  if (parts.length > 1) parts.pop();
  return parts.join('.') + '.md';
}

function handleFile(file) {
  const ext = getExt(file.name);
  if (!['pdf', 'doc', 'docx'].includes(ext)) {
    showError(null, 'Unsupported file type. Please upload a PDF, DOC, or DOCX file.');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showError(file, 'File exceeds the 50 MB size limit.');
    return;
  }
  convertFile(file);
}

async function convertFile(file) {
  const ext = getExt(file.name);
  showProgress(file, 'Reading file…');

  try {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    showProgress(file, 'Converting…');

    let markdown = '';
    if (ext === 'docx' || ext === 'doc') {
      if (!window.mammoth) throw new Error('Mammoth library failed to load — check your internet connection.');
      const result = await mammoth.convertToMarkdown({ arrayBuffer });
      markdown = result.value;
    } else if (ext === 'pdf') {
      if (!pdfjsLib) throw new Error('PDF.js library failed to load — check your internet connection.');
      markdown = await pdfToMarkdown(arrayBuffer);
    }

    showResult(file, markdown, outputName(file.name));
  } catch (err) {
    showError(file, err.message || 'Conversion failed.');
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

async function pdfToMarkdown(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    // Group items into lines by their Y position
    const lineMap = {};
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const fontSize = Math.abs(item.transform[3]);
      if (!lineMap[y]) lineMap[y] = { text: '', maxFontSize: 0 };
      lineMap[y].text += item.str;
      lineMap[y].maxFontSize = Math.max(lineMap[y].maxFontSize, fontSize);
    }

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
    const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);

    // Compute median font size to identify headings
    const fontSizes = sortedYs.map(y => lineMap[y].maxFontSize).filter(s => s > 0);
    fontSizes.sort((a, b) => a - b);
    const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] || 12;
    const h1Threshold = medianFont * 1.6;
    const h2Threshold = medianFont * 1.25;

    const lines = [];
    for (const y of sortedYs) {
      const { text, maxFontSize } = lineMap[y];
      const t = text.trim();
      if (!t) continue;

      if (maxFontSize >= h1Threshold) {
        lines.push(`# ${t}`);
      } else if (maxFontSize >= h2Threshold) {
        lines.push(`## ${t}`);
      } else {
        // Detect bullet points in raw text
        const bulletMatch = t.match(/^[•·▪▸►▶➢➣➤]\s*(.+)/);
        if (bulletMatch) {
          lines.push(`- ${bulletMatch[1]}`);
        } else if (/^\d+[\.\)]\s+\S/.test(t)) {
          lines.push(t);
        } else {
          lines.push(t);
        }
      }
    }

    if (lines.length > 0) {
      pageTexts.push(lines.join('\n'));
    }
  }

  return pageTexts.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function showFileCard(file) {
  if (!file) return;
  const ext = getExt(file.name);
  statusCard.classList.remove('hidden');
  statusContent.innerHTML = `
    <div class="file-info">
      <div class="file-icon ${ext}">${ext.toUpperCase()}</div>
      <div class="file-meta">
        <div class="file-name" title="${esc(file.name)}">${esc(file.name)}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
      </div>
    </div>`;
}

function showProgress(file, label) {
  showFileCard(file);
  statusContent.innerHTML += `
    <div class="progress-wrap">
      <div class="progress-label"><span>${esc(label)}</span></div>
      <div class="progress-bar">
        <div class="progress-fill indeterminate"></div>
      </div>
    </div>`;
}

function showResult(file, markdown, name) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  showFileCard(file);
  statusContent.innerHTML += `
    <div class="result-row">
      <span class="result-icon">✓</span>
      <span class="result-name" title="${esc(name)}">${esc(name)}</span>
      <a class="download-btn" href="${url}" download="${esc(name)}">Download</a>
    </div>
    <button class="convert-another" onclick="reset()">Convert another file</button>`;
}

function showError(file, message) {
  if (file) showFileCard(file);
  else {
    statusCard.classList.remove('hidden');
    statusContent.innerHTML = '';
  }
  statusContent.innerHTML += `
    <div class="error-row">
      <span>⚠</span>
      <span>${esc(message)}</span>
    </div>
    <button class="convert-another" onclick="reset()">Try again</button>`;
}

function reset() {
  fileInput.value = '';
  statusCard.classList.add('hidden');
  statusContent.innerHTML = '';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
