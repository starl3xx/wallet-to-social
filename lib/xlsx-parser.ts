import readXlsxFile from 'read-excel-file';
import type { ParseResult, WalletRow } from './csv-parser';

function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    // read-excel-file reads first sheet by default
    const rows = await readXlsxFile(buffer);

    if (rows.length === 0) {
      return { rows: [], headers: [], error: 'Empty spreadsheet' };
    }

    // First row is headers
    const headers = rows[0].map((cell) => String(cell ?? '').trim());

    // Find wallet column
    let walletColumnIndex = headers.findIndex(
      (h) => h.toLowerCase() === 'wallet' || h.toLowerCase() === 'address'
    );
    if (walletColumnIndex === -1) {
      walletColumnIndex = 0;
    }

    const parsedRows: WalletRow[] = [];

    // Process data rows (skip header)
    for (let i = 1; i < rows.length; i++) {
      const rowData = rows[i];
      if (!rowData || rowData.every((cell) => cell === null || cell === '')) {
        continue;
      }

      const walletValue = String(rowData[walletColumnIndex] ?? '').trim();

      if (!walletValue || !isValidEthAddress(walletValue)) {
        continue;
      }

      const row: WalletRow = { wallet: walletValue.toLowerCase() };

      // Preserve other columns
      headers.forEach((header, index) => {
        if (
          index !== walletColumnIndex &&
          rowData[index] !== null &&
          rowData[index] !== undefined
        ) {
          row[header] = String(rowData[index]);
        }
      });

      parsedRows.push(row);
    }

    if (parsedRows.length === 0) {
      return {
        rows: [],
        headers: [],
        error: 'No valid wallet addresses found in spreadsheet',
      };
    }

    // Deduplicate by wallet address
    const uniqueRows = Array.from(
      new Map(parsedRows.map((row) => [row.wallet, row])).values()
    );

    return {
      rows: uniqueRows,
      headers: headers.filter(
        (_, i) =>
          i !== walletColumnIndex || headers[i].toLowerCase() !== 'wallet'
      ),
    };
  } catch (err) {
    console.error('XLSX parsing error:', err);
    return {
      rows: [],
      headers: [],
      error:
        err instanceof Error
          ? `Failed to parse Excel file: ${err.message}`
          : 'Failed to parse Excel file',
    };
  }
}
