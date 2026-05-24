const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 500,
    minHeight: 480,
    autoHideMenuBar: true,
    title: 'Doc → Markdown Converter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '../public/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Convert file ─────────────────────────────────────────────────────────
ipcMain.handle('convert', async (_event, filename, arrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  const ext    = path.extname(filename).toLowerCase();

  try {
    let markdown = '';

    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.convertToMarkdown({ buffer });
      markdown = result.value;
    } else if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      markdown   = pdfTextToMarkdown(data.text, data.info);
    }

    return { success: true, markdown };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Native save dialog ───────────────────────────────────────────────────
ipcMain.handle('save-file', async (_event, filename, content) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Save Markdown File',
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (canceled || !filePath) return { saved: false };

  fs.writeFileSync(filePath, content, 'utf8');
  return { saved: true, filePath };
});

// ── PDF text → Markdown ───────────────────────────────────────────────────────
function pdfTextToMarkdown(text, info) {
  const lines  = text.split('\n');
  const output = [];

  if (info?.Title?.trim()) {
    output.push(`# ${info.Title.trim()}`);
    output.push('');
  }

  let prevBlank = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (!prevBlank) output.push('');
      prevBlank = true;
      continue;
    }
    prevBlank = false;

    if (trimmed.length <= 80 && trimmed === trimmed.toUpperCase()
        && /[A-Z]/.test(trimmed) && !/[.!?,;]$/.test(trimmed)
        && trimmed.split(' ').length <= 10) {
      output.push(`## ${toTitleCase(trimmed)}`);
    } else if (/^\d+[\.\)]\s+\S/.test(trimmed)) {
      output.push(trimmed);
    } else {
      const bullet = trimmed.match(/^[•·▪▸►▶➢➣➤]\s*(.+)/);
      output.push(bullet ? `- ${bullet[1]}` : trimmed);
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
