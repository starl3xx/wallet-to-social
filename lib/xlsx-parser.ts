import readXlsxFile from 'read-excel-file';
import type { ParseResult, WalletRow } from './csv-parser';

function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Scan all columns to find which one contains the most valid Ethereum addresses.
 * Returns the column index, or -1 if no valid addresses found.
 */
function detectWalletColumn(rows: unknown[][]): number {
  if (rows.length === 0) return -1;

  const columnCount = Math.max(...rows.map((r) => r.length));
  let bestColumn = -1;
  let bestCount = 0;

  for (let col = 0; col < columnCount; col++) {
    let validCount = 0;
    for (const row of rows) {
      const value = String(row[col] ?? '').trim();
      if (value && isValidEthAddress(value)) {
        validCount++;
      }
    }
    if (validCount > bestCount) {
      bestCount = validCount;
      bestColumn = col;
    }
  }

  return bestColumn;
}

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    // read-excel-file reads first sheet by default
    const rows = await readXlsxFile(buffer);

    if (rows.length === 0) {
      return { rows: [], headers: [], error: 'Empty spreadsheet' };
    }

    // Find the column with the most valid Ethereum addresses
    const walletColumnIndex = detectWalletColumn(rows);

    if (walletColumnIndex === -1) {
      return {
        rows: [],
        headers: [],
        error: 'No valid wallet addresses found in spreadsheet',
      };
    }

    // Check if first row contains a valid address (headerless file)
    const firstRowValue = String(rows[0]?.[walletColumnIndex] ?? '').trim();
    const hasHeader = !isValidEthAddress(firstRowValue);

    // Determine headers
    let headers: string[];
    let dataStartIndex: number;

    if (hasHeader) {
      headers = rows[0].map((cell) => String(cell ?? '').trim());
      dataStartIndex = 1;
    } else {
      // Generate placeholder headers (Column A, Column B, etc.)
      const columnCount = Math.max(...rows.map((r) => r.length));
      headers = Array.from({ length: columnCount }, (_, i) =>
        String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '')
      );
      dataStartIndex = 0;
    }

    const parsedRows: WalletRow[] = [];

    // Process data rows
    for (let i = dataStartIndex; i < rows.length; i++) {
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
      headers: headers.filter((_, i) => i !== walletColumnIndex),
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
