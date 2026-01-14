export interface WalletRow {
  wallet: string;
  [key: string]: string;
}

export interface ParseResult {
  rows: WalletRow[];
  headers: string[];
  error?: string;
}

export function parseCSV(content: string): ParseResult {
  const lines = content.trim().split(/\r?\n/);

  if (lines.length === 0) {
    return { rows: [], headers: [], error: 'Empty CSV file' };
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Find wallet column (look for 'wallet' or use first column)
  let walletColumnIndex = headers.findIndex(
    (h) => h.toLowerCase() === 'wallet' || h.toLowerCase() === 'address'
  );

  if (walletColumnIndex === -1) {
    // Use first column as wallet
    walletColumnIndex = 0;
  }

  const rows: WalletRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const wallet = values[walletColumnIndex]?.trim();

    // Validate wallet address (basic check for Ethereum address)
    if (!wallet || !isValidEthAddress(wallet)) {
      continue;
    }

    const row: WalletRow = { wallet: wallet.toLowerCase() };

    // Preserve all other columns
    headers.forEach((header, index) => {
      if (index !== walletColumnIndex && values[index] !== undefined) {
        row[header] = values[index];
      }
    });

    rows.push(row);
  }

  if (rows.length === 0) {
    return {
      rows: [],
      headers: [],
      error: 'No valid wallet addresses found in CSV',
    };
  }

  // Deduplicate by wallet address
  const uniqueRows = Array.from(
    new Map(rows.map((row) => [row.wallet, row])).values()
  );

  return {
    rows: uniqueRows,
    headers: headers.filter(
      (_, i) => i !== walletColumnIndex || headers[i].toLowerCase() !== 'wallet'
    ),
  };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function exportToCSV(
  data: Record<string, unknown>[],
  headers: string[]
): string {
  const csvRows: string[] = [];

  // Add header row
  csvRows.push(headers.map(escapeCSVField).join(','));

  // Add data rows
  for (const row of data) {
    const values = headers.map((header) => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      return escapeCSVField(String(value));
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
