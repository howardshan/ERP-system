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
const { join }    = require('path');

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

// ── Print PNG ─────────────────────────────────────────────────────────────────
// Body: { png: "<base64>", printer?: "<cups-queue>" }
//
// The app sends a landscape 606×404 PNG (PRINT_DPI=101).
// lp option `ppi=203` tells CUPS the true resolution → natural size = 3"×2",
// which fills a 2"×3" label in landscape orientation.  No media override —
// the printer queue is configured for the right paper size.
app.post('/print', async (req, res) => {
  const { png, printer } = req.body || {};

  if (!png) {
    return res.status(400).json({ error: 'missing png' });
  }

  const tmpFile = join(tmpdir(), `label_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

  try {
    await writeFile(tmpFile, Buffer.from(png, 'base64'));

    const printerName = (printer || DEFAULT_PRINTER).trim();

    if (IS_WINDOWS) {
      // ── Windows: PowerShell + System.Drawing ──────────────────────────────
      // 606px ÷ 203dpi = 2.985" ≈ 3"  |  404px ÷ 203dpi = 1.990" ≈ 2"
      // PrintDocument Graphics unit = 1/100 inch → multiply by 100
      const escapedPath = tmpFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
      const escapedPrinter = printerName.replace(/'/g, "''");
      const ps = [
        `Add-Type -AssemblyName System.Drawing`,
        `$img = [System.Drawing.Bitmap]::FromFile('${escapedPath}')`,
        `$pd  = New-Object System.Drawing.Printing.PrintDocument`,
        escapedPrinter ? `$pd.PrinterSettings.PrinterName = '${escapedPrinter}'` : '',
        `$pd.DefaultPageSettings.Landscape = $true`,
        `$script:bmp = $img`,
        `$pd.add_PrintPage({`,
        `  param($s, $e)`,
        `  $w = [int][Math]::Round(606.0 / 203.0 * 100)`,   // ≈ 299  (1/100 inch)
        `  $h = [int][Math]::Round(404.0 / 203.0 * 100)`,   // ≈ 199  (1/100 inch)
        `  $e.Graphics.DrawImage($script:bmp, 0, 0, $w, $h)`,
        `})`,
        `$pd.Print()`,
        `$img.Dispose()`,
      ].filter(Boolean).join('; ');

      await new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-Command', ps], (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr?.trim() || err.message));
          else resolve();
        });
      });

    } else {
      // ── macOS / Linux: lp (CUPS) ──────────────────────────────────────────
      const args = [];
      if (printerName) args.push('-d', printerName);
      args.push('-o', 'ppi=203');  // 606÷203 = 3" × 404÷203 = 2" landscape
      args.push(tmpFile);

      await new Promise((resolve, reject) => {
        execFile('lp', args, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr?.trim() || err.message));
          else resolve();
        });
      });
    }

    res.json({ ok: true, printer: printerName || '(default)' });
  } catch (e) {
    console.error('[print-bridge] error:', e.message);
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
