import type { ParseResult } from './csv-parser';

export type SupportedFileType = 'csv' | 'xlsx';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function detectFileType(fileName: string): SupportedFileType | null {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'csv':
      return 'csv';
    case 'xlsx':
      return 'xlsx';
    default:
      return null;
  }
}

export async function parseFile(file: File): Promise<ParseResult> {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      rows: [],
      headers: [],
      error: 'File too large. Maximum size is 10MB.',
    };
  }

  const fileType = detectFileType(file.name);

  if (!fileType) {
    // Check for old Excel format
    if (file.name.toLowerCase().endsWith('.xls')) {
      return {
        rows: [],
        headers: [],
        error:
          'Old Excel format (.xls) is not supported. Please save as .xlsx or export to CSV.',
      };
    }

    return {
      rows: [],
      headers: [],
      error: 'Unsupported file type. Please upload a .csv or .xlsx file.',
    };
  }

  if (fileType === 'csv') {
    const text = await file.text();
    const { parseCSV } = await import('./csv-parser');
    return parseCSV(text);
  }

  if (fileType === 'xlsx') {
    const buffer = await file.arrayBuffer();
    const { parseXLSX } = await import('./xlsx-parser');
    return parseXLSX(buffer);
  }

  return { rows: [], headers: [], error: 'Unknown error parsing file' };
}
