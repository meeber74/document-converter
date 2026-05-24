const express = require('express');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', reason => console.error('UNHANDLED REJECTION:', reason));

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Parse raw binary body (up to 50 MB) for the /convert route
app.use('/convert', express.raw({ type: 'application/octet-stream', limit: '50mb' }));

app.post('/convert', async (req, res) => {
  const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'upload';
  const ext = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, ext);
  const outputName = baseName + '.md';

  console.log(`POST /convert — file="${filename}" ext=${ext} body-type=${typeof req.body} body-len=${req.body?.length ?? 'n/a'}`);

  if (!['.pdf', '.doc', '.docx'].includes(ext)) {
    return res.status(400).json({ error: 'Only PDF, DOC, and DOCX files are supported.' });
  }

  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'No file data received.' });
  }
  console.log(`Body received, bytes=${buffer.length}`);

  try {
    let markdown = '';

    if (ext === '.docx' || ext === '.doc') {
      console.log('Step: mammoth start');
      const result = await mammoth.convertToMarkdown({ buffer });
      console.log('Step: mammoth done, length=', result.value.length);
      markdown = result.value;
    } else if (ext === '.pdf') {
      console.log('Step: pdf-parse start');
      const data = await pdfParse(buffer);
      console.log('Step: pdf-parse done, pages=', data.numpages);
      markdown = pdfTextToMarkdown(data.text, data.info);
    }

    console.log('Step: sending response');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('X-Output-Filename', encodeURIComponent(outputName));
    res.send(markdown);

  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err.message);
  res.status(500).json({ error: err.message });
});

function pdfTextToMarkdown(text, info) {
  const lines = text.split('\n');
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
    if (trimmed.length <= 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/[.!?,;]$/.test(trimmed) && trimmed.split(' ').length <= 10) {
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

app.listen(PORT, () => {
  console.log(`Document Converter running at http://localhost:${PORT}`);
});
