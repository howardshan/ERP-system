/**
 * ERP Label Print Bridge
 *
 * Mirrors the kitchenprep print-bridge pattern:
 *   Browser → POST /print (PNG base64) → lp (CUPS) → USB → printer
 *
 * Usage:
 *   cd scripts/print-bridge && npm install && node server.js
 *
 * Optional env vars:
 *   PORT          (default 6543)
 *   PRINTER_NAME  (default: CUPS default printer)
 */

const express  = require('express');
const cors     = require('cors');
const { execFile } = require('child_process');
const { writeFile, unlink } = require('fs/promises');
const { tmpdir }  = require('os');
const { join }    = require('path');

const app  = express();
const PORT = process.env.PORT || 6543;
const DEFAULT_PRINTER = (process.env.PRINTER_NAME || '').trim();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, printer: DEFAULT_PRINTER || '(cups default)', host: require('os').hostname() });
});

// ── List printers (CUPS) ─────────────────────────────────────────────────────
app.get('/printers', (_req, res) => {
  execFile('lpstat', ['-e'], (_err, stdout) => {
    const printers = (stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    res.json({ printers });
  });
});

// ── Print PNG ─────────────────────────────────────────────────────────────────
// Body: { png: "<base64>", printer?: "<cups-queue>", media?: "w4h6" }
app.post('/print', async (req, res) => {
  const { png, printer, media = 'w4h6' } = req.body || {};

  if (!png) {
    return res.status(400).json({ error: 'missing png' });
  }

  const tmpFile = join(tmpdir(), `label_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

  try {
    await writeFile(tmpFile, Buffer.from(png, 'base64'));

    // Tag DPI so sips knows the physical size (812px / 203dpi = 4", 1218px / 203dpi = 6")
    await new Promise(resolve =>
      execFile('sips', ['-s', 'dpiWidth', '203', '-s', 'dpiHeight', '203', tmpFile], () => resolve())
    );

    // Convert to PDF — the PDF page will be exactly 4×6 inches
    const pdfFile = tmpFile.replace('.png', '.pdf');
    await new Promise((resolve, reject) =>
      execFile('sips', ['-s', 'format', 'pdf', tmpFile, '--out', pdfFile],
        (err) => err ? reject(new Error(String(err))) : resolve())
    );

    const printerName = (printer || DEFAULT_PRINTER).trim();
    const args = [];
    if (printerName) args.push('-d', printerName);
    // PDF already encodes page size — no media override needed
    args.push(pdfFile);

    await new Promise((resolve, reject) => {
      execFile('lp', args, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      });
    });

    res.json({ ok: true, printer: printerName || '(default)' });
  } catch (e) {
    console.error('[print-bridge] lp error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    unlink(tmpFile).catch(() => {});
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Print bridge running → http://127.0.0.1:${PORT}`);
  console.log(`Printer: ${DEFAULT_PRINTER || '(cups default)'}`);
  console.log('Press Ctrl+C to stop.');
});
