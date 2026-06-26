// M-155: build the WA/MC testing export workbook, matching the customer's
// "WA_MC Template.xlsx" layout (two-row header with grouped Mc%/Aw Standard
// Min/Max, merged cells). Columns we don't capture stay blank except the
// derived Retest/Accept. Uses the project's xlsx (SheetJS) dependency.
import * as XLSX from 'xlsx';
import type { TestingExportRow } from '../../services/qcApi';

// Exact header strings from the template (incl. the original spacing).
const HEADER_ROW_1 = [
  'Product Description', 'Size', 'Date', 'Item#', 'WO# /Lot#', 'Carts#',
  'Mc%', 'Aw', 'Testing Temp (°C)', 'Humidity %', 'Room Temp  (°F)',
  'Inspector', 'Test Result', 'Mc% Standard', '', 'Aw Standard', '',
  'Verification Time', 'Retest/Accept', 'Verify', 'Note ',
];
const HEADER_ROW_2 = [
  '', '', '', '', '', '', '', '', '', '', '', '', '',
  'Min', 'Max', 'Min', 'Max', '', '', '', '',
];

// Vertically-merged columns (header spans both rows). N/O and P/Q are the
// horizontally-merged group headers handled separately.
const VMERGE_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'R', 'S', 'T', 'U'];

const COL_WIDTHS = [
  28, 6, 12, 10, 14, 16, 9, 9, 12, 11, 12, 11, 11, 7, 7, 7, 7, 14, 13, 8, 24,
];

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const num = (v: number | null): number | string => (v == null ? '' : v);

export function buildTestingExportWorkbook(rows: TestingExportRow[]): XLSX.WorkBook {
  const aoa: (string | number)[][] = [HEADER_ROW_1, HEADER_ROW_2];

  for (const r of rows) {
    aoa.push([
      r.product_name ?? '',                       // A Product Description
      '',                                         // B Size (not captured)
      fmtDate(r.test_date),                        // C Date
      r.item_no ?? '',                             // D Item#
      r.wo_lot ?? '',                              // E WO# /Lot#
      r.sample_id ?? '',                           // F Carts# = sample number
      num(r.mc_value),                             // G Mc%
      num(r.aw_value),                             // H Aw
      num(r.testing_temp),                         // I Testing Temp (°C)
      num(r.humidity),                             // J Humidity %
      num(r.room_temp),                            // K Room Temp (°F)
      r.inspector ?? '',                           // L Inspector
      r.result === 'pass' ? 'Pass' : 'Fail',       // M Test Result
      num(r.mc_min),                               // N Mc% Std Min
      num(r.mc_max),                               // O Mc% Std Max
      num(r.aw_min),                               // P Aw Std Min
      num(r.aw_max),                               // Q Aw Std Max
      '',                                          // R Verification Time (manual)
      r.retest_accept ?? '',                       // S Retest/Accept (derived)
      '',                                          // T Verify (manual)
      r.note ?? '',                                // U Note
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    ...VMERGE_COLS.map(c => XLSX.utils.decode_range(`${c}1:${c}2`)),
    XLSX.utils.decode_range('N1:O1'),   // Mc% Standard group header
    XLSX.utils.decode_range('P1:Q1'),   // Aw Standard group header
  ];
  ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

/** Build + trigger a browser download of the testing export workbook. */
export function exportTestingXlsx(rows: TestingExportRow[], filename: string): void {
  XLSX.writeFile(buildTestingExportWorkbook(rows), filename);
}
