#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Build self-contained print-bridge binaries (no Node needed on the target
// machine) and package per-OS installer bundles into
//   eee-main/public/print-bridge/
// so they can be downloaded straight from the ERP website.
//
// Run on a Mac (the `zip` tool is used). Produces all three targets via the
// cross-compiling @yao-pkg/pkg fork:
//   • erp-print-bridge-macos-arm64   (Apple Silicon)
//   • erp-print-bridge-macos-x64     (Intel Mac)
//   • erp-print-bridge-win-x64.exe   (Windows)
//
// Usage:
//   cd eee-main/scripts/print-bridge
//   npm install
//   npm run build
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here         = dirname(fileURLToPath(import.meta.url));
const installerDir = join(here, 'installer');
const distBin      = join(here, 'dist-bin');
const vendorDir    = join(here, 'vendor');
const publicDir    = join(here, '..', '..', 'public', 'print-bridge');

// Windows prints the vector PDF via SumatraPDF (portable, ~6 MB). Drop the exe
// at scripts/print-bridge/vendor/SumatraPDF.exe before building to include it.
// Download: https://www.sumatrapdfreader.org/download-free-pdf-viewer (portable 64-bit)
const sumatra = join(vendorDir, 'SumatraPDF.exe');
const SUMATRA_URL = 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.exe';
let hasSumatra = existsSync(sumatra);

const NODE = 'node22';
const builds = [
  { target: `${NODE}-macos-arm64`, name: 'erp-print-bridge-macos-arm64' },
  { target: `${NODE}-macos-x64`,   name: 'erp-print-bridge-macos-x64' },
  { target: `${NODE}-win-x64`,     name: 'erp-print-bridge-win-x64.exe' },
];

function sh(cmd, args) {
  console.log('>', cmd, args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', cwd: here });
}

// ── 1. Compile the binaries ───────────────────────────────────────────────────
rmSync(distBin, { recursive: true, force: true });
mkdirSync(distBin, { recursive: true });

for (const b of builds) {
  sh('npx', ['--yes', '@yao-pkg/pkg', 'server.js', '--target', b.target, '--output', join(distBin, b.name)]);
}

// ── 1b. Fetch SumatraPDF (Windows PDF printer) if missing ─────────────────────
if (!hasSumatra) {
  try {
    mkdirSync(vendorDir, { recursive: true });
    console.log('Downloading SumatraPDF (portable, for Windows PDF printing)…');
    sh('curl', ['-fL', '--retry', '2', '-o', sumatra, SUMATRA_URL]);
    hasSumatra = existsSync(sumatra);
  } catch {
    hasSumatra = false;   // fall back to the manual-step warning below
  }
}

// ── 2. Package per-OS installer zips for website download ──────────────────────
mkdirSync(publicDir, { recursive: true });

function makeZip(zipPath, files) {
  rmSync(zipPath, { force: true });
  sh('zip', ['-j', '-q', zipPath, ...files]);   // -j: flat (no directory paths)
}

makeZip(join(publicDir, 'erp-print-bridge-macos.zip'), [
  join(distBin, 'erp-print-bridge-macos-arm64'),
  join(distBin, 'erp-print-bridge-macos-x64'),
  join(installerDir, 'install-macos.command'),
  join(installerDir, 'uninstall-macos.command'),
  join(installerDir, 'README.txt'),
]);

const winFiles = [
  join(distBin, 'erp-print-bridge-win-x64.exe'),
  join(installerDir, 'install-windows.bat'),
  join(installerDir, 'uninstall-windows.bat'),
  join(installerDir, 'README.txt'),
];
if (hasSumatra) winFiles.push(sumatra);
makeZip(join(publicDir, 'erp-print-bridge-windows.zip'), winFiles);

console.log('\n✓ Built installer bundles into', publicDir);
console.log('  • erp-print-bridge-macos.zip');
console.log('  • erp-print-bridge-windows.zip');
if (!hasSumatra) {
  console.log('\n⚠ vendor/SumatraPDF.exe NOT found — the Windows package will print');
  console.log('  nothing until you add it. Download the portable 64-bit SumatraPDF,');
  console.log('  rename to SumatraPDF.exe, put it in scripts/print-bridge/vendor/, rebuild.');
}
