const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.doc', '.docx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const baseName = path.basename(req.file.originalname, ext);
  const outputName = baseName + '.md';

  try {
    let markdown = '';

    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.convertToMarkdown({ path: req.file.path });
      markdown = result.value;
      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages.filter(m => m.type === 'warning');
        if (warnings.length > 0) {
          console.log('Conversion warnings:', warnings.map(w => w.message).join(', '));
        }
      }
    } else if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      markdown = pdfTextToMarkdown(data.text, data.info);
    }

    fs.unlinkSync(req.file.path);

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('X-Output-Filename', encodeURIComponent(outputName));
    res.send(markdown);

  } catch (err) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Conversion error:', err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

function pdfTextToMarkdown(text, info) {
  const lines = text.split('\n');
  const output = [];

  // Add document title from PDF metadata if available
  if (info && info.Title && info.Title.trim()) {
    output.push(`# ${info.Title.trim()}`);
    output.push('');
  }

  let prevBlank = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (!prevBlank) output.push('');
      prevBlank = true;
      continue;
    }
    prevBlank = false;

    // All-caps short line → H2
    if (trimmed.length <= 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/[.!?,;]$/.test(trimmed) && trimmed.split(' ').length <= 10) {
      output.push(`## ${toTitleCase(trimmed)}`);
      continue;
    }

    // Numbered list items
    if (/^\d+[\.\)]\s+\S/.test(trimmed)) {
      output.push(trimmed);
      continue;
    }

    // Bullet points using common bullet characters
    const bulletMatch = trimmed.match(/^[•·▪▸►▶➢➣➤\-–—]\s+(.+)/);
    if (bulletMatch) {
      output.push(`- ${bulletMatch[1]}`);
      continue;
    }

    output.push(trimmed);
  }

  // Collapse 3+ blank lines to 2
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

app.listen(PORT, () => {
  console.log(`Document Converter running at http://localhost:${PORT}`);
});
