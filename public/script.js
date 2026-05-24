// ── Runtime detection ─────────────────────────────────────────────────────────
const IS_ELECTRON = !!window.electronAPI?.isElectron;

// Browser CDN libraries (ignored when running in Electron)
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Guard: file:// only allowed when running inside Electron
if (!IS_ELECTRON && window.location.protocol === 'file:') {
  document.querySelector('main').innerHTML = `
    <div class="status-card" style="text-align:center;padding:2rem">
      <p style="font-size:1.1rem;font-weight:600;color:#f59e0b">⚠ Open via the server, not as a file</p>
      <p style="margin-top:.75rem;color:#94a3b8">Start with <code style="background:#0f172a;padding:.2rem .5rem;border-radius:.3rem">node server.js</code>
      then open <a href="http://localhost:3000" style="color:#6366f1">http://localhost:3000</a></p>
    </div>`;
}

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const statusCard = document.getElementById('statusCard');
const statusContent = document.getElementById('statusContent');

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function getExt(name) { return name.split('.').pop().toLowerCase(); }
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}
function outputName(n) {
  const p = n.split('.'); if (p.length > 1) p.pop(); return p.join('.') + '.md';
}

// ── Entry ─────────────────────────────────────────────────────────────────────
function handleFile(file) {
  const ext = getExt(file.name);
  if (!['pdf', 'doc', 'docx'].includes(ext))
    return showError(file, 'Unsupported file type. Please upload a PDF, DOC, or DOCX.');
  if (file.size > 50 * 1024 * 1024)
    return showError(file, 'File exceeds the 50 MB limit.');
  convertFile(file);
}

// ── File integrity validation ─────────────────────────────────────────────────
function validateMagicBytes(arrayBuffer, ext) {
  const b = new Uint8Array(arrayBuffer, 0, 8);

  if (ext === 'pdf') {
    // Must start with %PDF-
    if (b[0] !== 0x25 || b[1] !== 0x50 || b[2] !== 0x44 || b[3] !== 0x46)
      throw new Error('Not a valid PDF — file header is missing or corrupt (expected %PDF-).');
  }

  if (ext === 'docx') {
    // DOCX is a ZIP — must start with PK\x03\x04
    if (b[0] !== 0x50 || b[1] !== 0x4B || b[2] !== 0x03 || b[3] !== 0x04)
      throw new Error('Not a valid DOCX — file header is missing or corrupt (expected ZIP/PK signature).');
  }

  if (ext === 'doc') {
    // Legacy DOC is OLE2 — must start with D0 CF 11 E0
    const isOle = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;
    // Some .doc files are actually RTF — start with {\rtf
    const isRtf = b[0] === 0x7B && b[1] === 0x5C && b[2] === 0x72 && b[3] === 0x74;
    if (!isOle && !isRtf)
      throw new Error('Not a valid DOC — file header is missing or corrupt.');
  }
}

// ── Client-side conversion ────────────────────────────────────────────────────
async function convertFile(file) {
  const ext = getExt(file.name);
  showProgress(file, 'Reading file…');

  let arrayBuffer;
  try {
    arrayBuffer = await readAsArrayBuffer(file);
  } catch (e) {
    return showError(file, `Could not read file: ${e.message}`);
  }

  if (arrayBuffer.byteLength === 0)
    return showError(file, 'File is empty.');

  try {
    validateMagicBytes(arrayBuffer, ext);
  } catch (e) {
    return showError(file, e.message);
  }

  showProgress(file, 'Converting…');

  try {
    let markdown = '';

    if (IS_ELECTRON) {
      // ── Electron: use Node.js via IPC (no CDN, no network) ──────────────────
      const result = await window.electronAPI.convert(file.name, arrayBuffer);
      if (!result.success) throw new Error(result.error);
      markdown = result.markdown;

    } else {
      // ── Browser: use CDN libraries ───────────────────────────────────────────
      if (ext === 'docx' || ext === 'doc') {
        if (!window.mammoth)
          throw new Error('Mammoth library not loaded — check internet connection.');
        const result = await mammoth.convertToMarkdown({ arrayBuffer });
        markdown = result.value;
      } else if (ext === 'pdf') {
        if (!pdfjsLib)
          throw new Error('PDF.js library not loaded — check internet connection.');
        markdown = await pdfToMarkdown(arrayBuffer);
      }
    }

    if (IS_ELECTRON) {
      // Native save dialog
      const name   = outputName(file.name);
      const result = await window.electronAPI.saveFile(name, markdown);
      if (result.saved) showSaved(file, result.filePath);
      else showError(file, 'Save cancelled.');
    } else {
      showResult(file, markdown, outputName(file.name));
    }

  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('zip') || msg.includes('ZIP') || msg.includes('central directory'))
      showError(file, 'File appears corrupt — could not open it as a DOCX (broken ZIP structure).');
    else if (msg.includes('Invalid XFA') || msg.includes('PDF'))
      showError(file, 'File appears corrupt — could not parse the PDF structure.');
    else
      showError(file, `Conversion failed: ${msg}`);
  }
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(reader.error?.message || 'FileReader failed'));
    reader.readAsArrayBuffer(file);
  });
}

// ── PDF → Markdown ────────────────────────────────────────────────────────────
async function pdfToMarkdown(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Group text items into lines by Y position
    const lineMap = {};
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y        = Math.round(item.transform[5]);
      const fontSize = Math.abs(item.transform[3]);
      if (!lineMap[y]) lineMap[y] = { text: '', maxFont: 0 };
      lineMap[y].text   += item.str;
      lineMap[y].maxFont = Math.max(lineMap[y].maxFont, fontSize);
    }

    const sortedYs   = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    const fontSizes  = sortedYs.map(y => lineMap[y].maxFont).filter(Boolean).sort((a,b)=>a-b);
    const median     = fontSizes[Math.floor(fontSizes.length / 2)] || 12;

    const lines = [];
    for (const y of sortedYs) {
      const { text, maxFont } = lineMap[y];
      const t = text.trim();
      if (!t) continue;
      if      (maxFont >= median * 1.6) lines.push(`# ${t}`);
      else if (maxFont >= median * 1.25) lines.push(`## ${t}`);
      else {
        const bullet = t.match(/^[•·▪▸►▶➢➣➤]\s*(.+)/);
        lines.push(bullet ? `- ${bullet[1]}` : t);
      }
    }
    if (lines.length) pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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
      <div class="progress-bar"><div class="progress-fill indeterminate"></div></div>
    </div>`;
}

function showSaved(file, filePath) {
  const name = filePath.split(/[\\/]/).pop();
  showFileCard(file);
  statusContent.innerHTML += `
    <div class="result-row">
      <span class="result-icon">✓</span>
      <span class="result-name" title="${esc(filePath)}">${esc(name)}</span>
      <span style="font-size:.8rem;color:#22c55e;white-space:nowrap">Saved</span>
    </div>
    <button class="convert-another" onclick="reset()">Convert another file</button>`;
}

function showResult(file, markdown, name) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
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
  if (file) showFileCard(file); else { statusCard.classList.remove('hidden'); statusContent.innerHTML=''; }
  statusContent.innerHTML += `
    <div class="error-row"><span>⚠</span><span>${esc(message)}</span></div>
    <button class="convert-another" onclick="reset()">Try again</button>`;
}

function reset() { fileInput.value=''; statusCard.classList.add('hidden'); statusContent.innerHTML=''; }

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
