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

  // Parse all lines to detect wallet column
  const parsedLines = lines.map((line) => parseCSVLine(line));

  // Find the column with the most valid Ethereum addresses
  const walletColumnIndex = detectWalletColumn(parsedLines);

  if (walletColumnIndex === -1) {
    return {
      rows: [],
      headers: [],
      error: 'No valid wallet addresses found in CSV',
    };
  }

  // Check if first row contains a valid address (headerless file)
  const firstRowValue = parsedLines[0]?.[walletColumnIndex]?.trim();
  const hasHeader = !isValidEthAddress(firstRowValue || '');

  // Determine headers
  let headers: string[];
  let dataStartIndex: number;

  if (hasHeader) {
    headers = parsedLines[0];
    dataStartIndex = 1;
  } else {
    // Generate placeholder headers (Column A, Column B, etc.)
    const columnCount = Math.max(...parsedLines.map((l) => l.length));
    headers = Array.from(
      { length: columnCount },
      (_, i) =>
        String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '')
    );
    dataStartIndex = 0;
  }

  const rows: WalletRow[] = [];

  for (let i = dataStartIndex; i < parsedLines.length; i++) {
    const values = parsedLines[i];
    const wallet = values[walletColumnIndex]?.trim();

    // Validate wallet address
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
    headers: headers.filter((_, i) => i !== walletColumnIndex),
  };
}

/**
 * Scan all columns to find which one contains the most valid Ethereum addresses.
 * Returns the column index, or -1 if no valid addresses found.
 */
function detectWalletColumn(parsedLines: string[][]): number {
  if (parsedLines.length === 0) return -1;

  const columnCount = Math.max(...parsedLines.map((l) => l.length));
  let bestColumn = -1;
  let bestCount = 0;

  for (let col = 0; col < columnCount; col++) {
    let validCount = 0;
    for (const line of parsedLines) {
      const value = line[col]?.trim();
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

// Column names that indicate holdings/value data
const HOLDINGS_COLUMN_PATTERNS = [
  'peak index dtf value',
  'dtf value',
  'value',
  'balance',
  'holdings',
  // Contract imports label the column "Bag", and a customer CSV may too.
  'bag',
  'amount',
  'usd',
  'usd_value',
  'usd value',
  'total',
  'total_value',
  'portfolio',
];

export function findHoldingsColumn(headers: string[]): string | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  for (const pattern of HOLDINGS_COLUMN_PATTERNS) {
    const index = lowerHeaders.findIndex(
      (h) => h === pattern || h.includes(pattern)
    );
    if (index !== -1) {
      return headers[index];
    }
  }

  return null;
}

export function parseHoldingsValue(value: string | undefined): number | null {
  if (!value) return null;

  // Remove currency symbols, commas, and whitespace
  const cleaned = value.replace(/[$,\s]/g, '').trim();

  // Try to parse as number
  const num = parseFloat(cleaned);

  if (isNaN(num)) return null;

  return num;
}

/**
 * What the priority score means, in one sentence, for anywhere a reader can
 * ask.
 *
 * Kept beside the function rather than typed into the component, because the
 * sentence is a claim about this arithmetic and the two have to move together.
 * The column header carried "Based on holdings × follower reach", which names
 * the inputs and hides the part worth knowing: the follower term is
 * logarithmic, so ten times the audience is not ten times the score, and a
 * reader comparing two rows cannot work out why the bigger account did not win
 * without being told. It also never said which followers. Both are said here.
 */
export const PRIORITY_EXPLANATION =
  'Holdings multiplied by the base-10 logarithm of combined Farcaster and X ' +
  'followers plus one. The logarithm is deliberate: it keeps a very large ' +
  'audience from swamping the size of the position. A row missing an input ' +
  'counts it as zero, and a row with no audience at all counts as one.';

/**
 * Holdings against reach, with reach summed across both platforms.
 *
 * X followers were absent from this for one reason and it was not a decision:
 * the score was computed mid-pipeline and `x_followers` does not exist until
 * `stampReachability` runs in the finalize step, so the input was unavailable
 * at the only moment anybody looked. A product sold on X reach ranked on
 * Farcaster reach alone, and 1,048,530 wallets carry an X handle against
 * 4.7M carrying a Farcaster id, so the two are not interchangeable.
 *
 * SUMMED rather than maximised. The audiences overlap, certainly, but a
 * person reachable on both platforms is more reachable than the same person
 * on one, and the logarithm compresses the double-count to almost nothing:
 * ten thousand on each scores 4.30 against 4.00 for ten thousand on one.
 * Taking the maximum would have thrown the second platform away entirely.
 *
 * The floor moved from one follower to zero, and only the all-zero case keeps
 * a floor. `fcFollowers || 1` treated a wallet with no Farcaster account as
 * though it had one follower, which was harmless while that was the only
 * term and is wrong now: it would have added a phantom follower to every X
 * account's reach. A row with neither still scores `h * log10(2)`, exactly as
 * before, so nothing that had no audience moves.
 */
export function calculatePriorityScore(
  holdings: number | undefined,
  fcFollowers: number | undefined,
  xFollowers?: number | undefined
): number {
  const h = holdings || 1;
  const reach = (fcFollowers || 0) + (xFollowers || 0);
  return h * Math.log10(Math.max(reach, 1) + 1);
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
