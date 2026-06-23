/**
 * ERP Label Print Bridge
 *
 * Cross-platform: macOS/Linux → lp (CUPS)  |  Windows → PowerShell + System.Drawing
 *   Browser → POST /print (PNG base64) → OS print command → USB → printer
 *
 * Usage:
 *   cd scripts/print-bridge && npm install && node server.js
 *
 * Optional env vars:
 *   PORT          (default 6543)
 *   PRINTER_NAME  (default: system default printer)
 */

const express  = require('express');
const cors     = require('cors');
const { execFile } = require('child_process');
const { writeFile, unlink } = require('fs/promises');
const { tmpdir, platform } = require('os');
const { join, dirname } = require('path');

const IS_WINDOWS = platform() === 'win32';

const app  = express();
const PORT = process.env.PORT || 6543;
const DEFAULT_PRINTER = (process.env.PRINTER_NAME || '').trim();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, printer: DEFAULT_PRINTER || '(cups default)', host: require('os').hostname() });
});

// ── List printers ────────────────────────────────────────────────────────────
app.get('/printers', (_req, res) => {
  if (IS_WINDOWS) {
    // PowerShell: enumerate local print queues
    const ps = `Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json`;
    execFile('powershell', ['-NoProfile', '-Command', ps], (_err, stdout) => {
      try {
        const parsed = JSON.parse(stdout || '[]');
        const printers = Array.isArray(parsed) ? parsed : [parsed];
        res.json({ printers: printers.map(String).filter(Boolean) });
      } catch {
        res.json({ printers: [] });
      }
    });
  } else {
    execFile('lpstat', ['-e'], (_err, stdout) => {
      const printers = (stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
      res.json({ printers });
    });
  }
});

// ── Print PNG(s) ────────────────────────────────────────────────────────────
// Body: { pngs: ["<base64>", ...], printer?: "<queue>" }   (preferred)
//   or: { png: "<base64>", printer?: "<queue>" }            (single, legacy)
//
// The app renders each label as a LANDSCAPE 4:3 PNG at the printer's native
// 203 dpi (812×609). The WHOLE batch is printed as ONE job (one `lp` with N
// files / one Windows PrintDocument with N pages) so the data streams to the
// printer continuously — it calibrates the label gap once instead of re-sensing
// every few labels (the cause of ~15 s pauses).
app.post('/print', async (req, res) => {
  const body = req.body || {};
  const { printer } = body;
  const printerName = (printer || DEFAULT_PRINTER).trim();

  // ── Vector PDF path (preferred for web) ───────────────────────────────────
  // The whole batch is one multi-page 4"×3" PDF. Vector text/lines are
  // rasterised by the printer driver at its native dpi → crisp on any model.
  // It's a single job (one PDF), so the label gap is calibrated only once.
  if (body.pdf) {
    const pdfFile = join(tmpdir(), `label_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    try {
      await writeFile(pdfFile, Buffer.from(body.pdf, 'base64'));
      if (IS_WINDOWS) {
        // SumatraPDF.exe ships next to this binary; prints PDF silently.
        // `fit` (not `noscale`): scale + auto-rotate the page to fill the
        // printer's paper, matching the browser's "Windows print" behaviour.
        // `noscale` printed at 100% from a corner, so when the Windows paper
        // size didn't match the label it clipped (~half the label missing).
        const sumatra = join(dirname(process.execPath), 'SumatraPDF.exe');
        const args = ['-silent', '-exit-when-done', '-print-settings', 'fit'];
        args.push(printerName ? '-print-to' : '-print-to-default');
        if (printerName) args.push(printerName);
        args.push(pdfFile);
        await new Promise((resolve, reject) => {
          execFile(sumatra, args, (err, _o, stderr) => {
            if (err) reject(new Error('SumatraPDF: ' + (stderr?.trim() || err.message)));
            else resolve();
          });
        });
      } else {
        // macOS / Linux: CUPS prints the PDF natively at the page's true size
        // (4"×3"). Queue default media should be 4×3 → 1:1, no scaling.
        const args = [];
        if (printerName) args.push('-d', printerName);
        args.push(pdfFile);
        await new Promise((resolve, reject) => {
          execFile('lp', args, (err, _o, stderr) => {
            if (err) reject(new Error(stderr?.trim() || err.message));
            else resolve();
          });
        });
      }
      return res.json({ ok: true, printer: printerName || '(default)', pdf: true });
    } catch (e) {
      console.error('[print-bridge] pdf error:', e.message);
      return res.status(500).json({ error: e.message });
    } finally {
      unlink(pdfFile).catch(() => {});
    }
  }

  // ── Legacy PNG path (Tauri / fallback) ────────────────────────────────────
  const list = Array.isArray(body.pngs) ? body.pngs : (body.png ? [body.png] : []);
  // Per-machine printer resolution (the app renders the PNG at this dpi).
  const dpi = [203, 300, 600].includes(Number(body.dpi)) ? Number(body.dpi) : 203;

  if (list.length === 0) {
    return res.status(400).json({ error: 'missing png(s) or pdf' });
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpFiles = list.map((_, i) => join(tmpdir(), `label_${stamp}_${i}.png`));

  try {
    await Promise.all(tmpFiles.map((f, i) => writeFile(f, Buffer.from(list[i], 'base64'))));

    if (IS_WINDOWS) {
      // ── Windows: one PrintDocument, N pages (single job) ──────────────────
      // PrintDocument units are 1/100 inch → 4"×3" page = 400×300.
      const escapedPrinter = printerName.replace(/'/g, "''");
      const psArray = tmpFiles
        .map(f => `'${f.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
        .join(',');
      const ps = [
        `Add-Type -AssemblyName System.Drawing`,
        `$paths = @(${psArray})`,
        `$script:imgs = @(); foreach ($p in $paths) { $script:imgs += [System.Drawing.Bitmap]::FromFile($p) }`,
        `$script:idx = 0`,
        `$pd = New-Object System.Drawing.Printing.PrintDocument`,
        escapedPrinter ? `$pd.PrinterSettings.PrinterName = '${escapedPrinter}'` : '',
        `$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('ERPLabel4x3', 400, 300)`,
        `$pd.DefaultPageSettings.Margins  = New-Object System.Drawing.Printing.Margins(0,0,0,0)`,
        `$pd.OriginAtMargins = $false`,
        `$pd.add_PrintPage({`,
        `  param($s, $e)`,
        `  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor`,
        `  $e.Graphics.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::Half`,
        `  $e.Graphics.DrawImage($script:imgs[$script:idx], 0, 0, $e.PageBounds.Width, $e.PageBounds.Height)`,
        `  $script:idx++`,
        `  $e.HasMorePages = ($script:idx -lt $script:imgs.Count)`,
        `})`,
        `$pd.Print()`,
        `foreach ($img in $script:imgs) { $img.Dispose() }`,
      ].filter(Boolean).join('; ');

      await new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-Command', ps], (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr?.trim() || err.message));
          else resolve();
        });
      });

    } else {
      // ── macOS / Linux: one `lp` with all files = a single job, N pages ────
      // `ppi=<dpi>`: the image is rendered at the printer's native dpi, so its
      // natural size = 4"×3" (1 px → 1 dot, no rescaling, crisp edges).
      // Page size comes from the QUEUE DEFAULT (set the printer default to 4×3).
      // No per-job `-o media=...`: forcing custom media makes many thermal
      // printers re-run gap calibration every few labels.
      const args = [];
      if (printerName) args.push('-d', printerName);
      args.push('-o', `ppi=${dpi}`);
      args.push(...tmpFiles);   // multiple files → ONE job

      await new Promise((resolve, reject) => {
        execFile('lp', args, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr?.trim() || err.message));
          else resolve();
        });
      });
    }

    res.json({ ok: true, printer: printerName || '(default)', count: list.length });
  } catch (e) {
    console.error('[print-bridge] error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    await Promise.all(tmpFiles.map(f => unlink(f).catch(() => {})));
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Print bridge running → http://127.0.0.1:${PORT}`);
  console.log(`Printer: ${DEFAULT_PRINTER || '(cups default)'}`);
  console.log('Press Ctrl+C to stop.');
});
