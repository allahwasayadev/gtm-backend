import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';

export interface ParsedAccount {
  accountName: string;
}

export async function parseAccountsFile(
  buffer: Buffer,
  mimetype: string,
  filename: string,
): Promise<ParsedAccount[]> {
  console.log('Received mimetype:', mimetype, 'filename:', filename);

  const extension = filename.toLowerCase().split('.').pop();

  const isCsv =
    extension === 'csv' ||
    mimetype === 'text/csv' ||
    mimetype === 'application/csv' ||
    mimetype === 'text/plain' ||
    mimetype.includes('csv');

  const isExcel =
    extension === 'xlsx' ||
    extension === 'xls' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel' ||
    mimetype === 'application/excel' ||
    mimetype === 'application/x-excel' ||
    mimetype === 'application/x-msexcel' ||
    mimetype.includes('spreadsheet') ||
    mimetype.includes('excel');

  if (isCsv) {
    return parseCsvFile(buffer);
  } else if (isExcel) {
    return parseExcelFile(buffer);
  } else {
    throw new Error(
      `Unsupported file type: ${mimetype} (${filename}). Please upload CSV or Excel file.`,
    );
  }
}

function parseExcelFile(buffer: Buffer): ParsedAccount[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

  const accounts: ParsedAccount[] = [];

  for (const row of data) {
    if (row && row[0] && typeof row[0] === 'string' && row[0].trim()) {
      accounts.push({ accountName: row[0].trim() });
    }
  }

  return accounts;
}

async function parseCsvFile(buffer: Buffer): Promise<ParsedAccount[]> {
  const accounts: ParsedAccount[] = [];
  const stream = Readable.from(buffer.toString());

  return new Promise((resolve, reject) => {
    stream
      .pipe(csvParser())
      .on('data', (row: any) => {
        const firstValue = Object.values(row)[0] as string;
        if (firstValue && firstValue.trim()) {
          accounts.push({ accountName: firstValue.trim() });
        }
      })
      .on('end', () => resolve(accounts))
      .on('error', (error: Error) => reject(error));
  });
}
