/**
 * WebUSB label printer — direct browser → USB communication.
 *
 * Flow:
 *   1. First call: browser shows "Select USB device" picker (one-time per browser profile).
 *   2. Subsequent calls: reuses the previously authorised device automatically.
 *   3. Canvas → 1-bit raster → ESC/POS GS v 0 → USB bulk-OUT endpoint.
 *
 * Supported browsers: Chrome / Edge (WebUSB required).
 * GP-1324D uses standard USB Printer class (bInterfaceClass = 7).
 */

// ─── Device management ────────────────────────────────────────────────────────

/** Cached open device across prints in the same page session. */
let _device: USBDevice | null = null;

/** True when we've already claimed the interface this session. */
let _claimed = false;

/**
 * Return the USB bulk-OUT endpoint and alternate-setting for a printer interface.
 * USB Printer class (bInterfaceClass=7) puts bulk endpoints on alternate setting 1
 * (not 0).  We must call selectAlternateInterface() with the correct alt setting
 * number after claimInterface() or the endpoint is never activated.
 */
function findBulkOut(device: USBDevice): {
  interfaceNum: number;
  altSettingNum: number;
  endpointNum: number;
} {
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass === 7 /* USB Printer */) {
          for (const ep of alt.endpoints) {
            if (ep.direction === 'out' && ep.type === 'bulk') {
              return {
                interfaceNum:  iface.interfaceNumber,
                altSettingNum: alt.alternateSetting,
                endpointNum:   ep.endpointNumber,
              };
            }
          }
          // Printer interface found but no bulk-OUT listed — assume alt=1, ep=1
          return { interfaceNum: iface.interfaceNumber, altSettingNum: 1, endpointNum: 1 };
        }
      }
    }
  }
  // Generic fallback
  return { interfaceNum: 0, altSettingNum: 1, endpointNum: 1 };
}

/**
 * Open (or reuse) a USB label printer.
 * On first call, shows the browser device-picker.
 * Subsequent calls reuse the already-authorised device without any dialog.
 */
export async function openUsbPrinter(): Promise<USBDevice> {
  // Reuse cached open device (same page session, still connected)
  if (_device?.opened && _claimed) return _device;

  // Device handle stale — reset claim flag so we re-claim below
  _claimed = false;

  // Try a previously authorised device (no picker shown)
  const authorised = await navigator.usb.getDevices();
  const printer = authorised.find(d =>
    d.configurations.some(c =>
      c.interfaces.some(i =>
        i.alternates.some(a => a.interfaceClass === 7),
      ),
    ),
  );

  _device = printer ?? await navigator.usb.requestDevice({
    filters: [{ classCode: 7 }], // USB Printer class
  });

  if (!_device.opened) {
    await _device.open();
  }
  // selectConfiguration may throw if already selected — ignore
  try { await _device.selectConfiguration(1); } catch { /* already configured */ }

  const { interfaceNum, altSettingNum } = findBulkOut(_device);
  await _device.claimInterface(interfaceNum);
  // Activate the alternate setting that contains the bulk-OUT endpoint.
  // Without this the endpoint exists in the descriptor but is not enabled.
  try {
    await _device.selectAlternateInterface(interfaceNum, altSettingNum);
  } catch { /* some devices only have one alt setting and ignore this */ }
  _claimed = true;

  return _device;
}

/** Release the USB interface and close the device. Call on page unload if needed. */
export async function closeUsbPrinter(): Promise<void> {
  if (_device?.opened) {
    try {
      const { interfaceNum } = findBulkOut(_device);
      await _device.releaseInterface(interfaceNum);
    } catch { /* ignore */ }
    try { await _device.close(); } catch { /* ignore */ }
  }
  _device = null;
  _claimed = false;
}

// ─── Raster conversion (TSPL) ────────────────────────────────────────────────
//
// The GP-1324D (Zhuhai Howbest / Gprinter) uses TSPL — Thermal Scripting
// Programming Language — NOT ESC/POS.  TSPL is the native protocol for TSC and
// compatible label printers.
//
// TSPL BITMAP command format:
//   BITMAP x,y,width_bytes,height_dots,mode,<binary_raster_data>\r\n
//
// Raster pixel format: same as ESC/POS — 1=black, MSB first, rows top→bottom.
// The canvas passed in is portrait (812 wide × 1218 tall at 203 DPI = 4"×6").

function canvasToTspl(canvas: HTMLCanvasElement): Uint8Array {
  const { width, height } = canvas;   // 812 × 1218 portrait
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const bytesPerLine = Math.ceil(width / 8);   // 102
  const raster = new Uint8Array(bytesPerLine * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Red channel == 0 → black dot
      if (pixels[(y * width + x) * 4] === 0) {
        raster[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  // TSPL command sequence:
  //   SIZE  — label dimensions (4" × 6")
  //   GAP   — gap between labels (0 = continuous / black-mark media)
  //   CLS   — clear image buffer
  //   BITMAP — print raster image at (0,0)
  //   PRINT — feed & cut one label
  const enc = new TextEncoder();
  const header = enc.encode(
    'SIZE 4 INCH,6 INCH\r\n' +
    'GAP 0 INCH,0 INCH\r\n' +
    'DIRECTION 0\r\n' +
    'CLS\r\n' +
    `BITMAP 0,0,${bytesPerLine},${height},0,`,
  );
  // Binary raster data follows immediately after the last comma (no \r\n separator).
  // After data, \r\n closes the BITMAP line, then PRINT fires the label.
  const footer = enc.encode('\r\nPRINT 1,1\r\n');

  const out = new Uint8Array(header.length + raster.length + footer.length);
  out.set(header);
  out.set(raster, header.length);
  out.set(footer, header.length + raster.length);
  return out;
}

// ─── Public print API ─────────────────────────────────────────────────────────

/**
 * Print one canvas image to the USB label printer.
 *
 * @param canvas  The 1-bit-thresholded portrait canvas (812 × 1218 for GP-1324D).
 * @param device  An open, claimed USBDevice (from openUsbPrinter()).
 */
export async function printCanvasUsb(canvas: HTMLCanvasElement, device: USBDevice): Promise<void> {
  const data = canvasToTspl(canvas);
  const { endpointNum } = findBulkOut(device);

  console.log(`[usbPrint] sending ${data.length} bytes to endpoint ${endpointNum}`);

  // Send in chunks to avoid USB transfer size limits (typically 64 KB per transfer)
  const CHUNK = 16 * 1024; // 16 KB
  let bytesSent = 0;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const chunk = data.subarray(offset, offset + CHUNK);
    const result = await device.transferOut(endpointNum, chunk);
    if (result.status !== 'ok') {
      throw new Error(`USB transfer failed at offset ${offset}: status=${result.status}`);
    }
    bytesSent += result.bytesWritten ?? chunk.byteLength;
  }
  console.log(`[usbPrint] done — ${bytesSent} bytes sent`);
}

/** Returns true if WebUSB is available in this browser. */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/**
 * Send a minimal ESC/POS text page to the printer.
 * Used to verify the USB connection works at all before troubleshooting raster.
 *
 * Expected output: a small label / feed with the text "USB TEST OK" printed.
 * If nothing comes out, the connection or protocol itself is broken.
 */
/**
 * Send a minimal TSPL text label to verify the printer responds.
 * If TSPL is the correct protocol, a small label with "USB TEST OK" prints.
 */
export async function testPrintUsb(device: USBDevice): Promise<void> {
  const enc = new TextEncoder();
  // Simple TSPL text label — no bitmap, just a text command
  const cmd = enc.encode(
    'SIZE 4 INCH,6 INCH\r\n' +
    'GAP 0 INCH,0 INCH\r\n' +
    'CLS\r\n' +
    'TEXT 50,50,"3",0,2,2,"USB TEST OK"\r\n' +
    'PRINT 1,1\r\n',
  );
  const { endpointNum } = findBulkOut(device);
  console.log('[usbPrint] testPrint (TSPL): sending', cmd.length, 'bytes to endpoint', endpointNum);
  const result = await device.transferOut(endpointNum, cmd);
  console.log('[usbPrint] testPrint result:', result.status, result.bytesWritten, 'bytes');
}
