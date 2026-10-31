/**
 * CSV diagnostics, ported from asd-insight packages/domain/csv-diagnostics.ts (commit 40ea4a0):
 * a data row whose column count differs from the header's is reported with the evidence around it.
 * The words are the UI's (csvColumnCountMessage); the diagnostic carries only the facts.
 */
export type CSVColumnCountDiagnostic = {
  kind: 'column-count';
  fileName: string;
  dataRow: number;
  startLine: number;
  endLine: number;
  headerLine: number;
  delimiter: ',' | '\t';
  expectedColumns: number;
  actualColumns: number;
  columns: Array<{
    position: number;
    header: string | null;
    value: string | null;
  }>;
  omittedColumns: number;
  rawRecord: string;
  rawRecordTruncated: boolean;
};

export const CSV_DIAGNOSTIC_LIMITS = {
  columns: 12,
  headerCharacters: 120,
  valueCharacters: 240,
  recordCharacters: 2000,
  fileNameCharacters: 320,
} as const;

// Diagnostics are plain text, never HTML or executable spreadsheet content.
// Preserve the original characters; the UI must render them as text nodes.
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let prefix = value.slice(0, limit - 1);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

function recordPreview(value: string): { text: string; truncated: boolean } {
  const limit = CSV_DIAGNOSTIC_LIMITS.recordCharacters;
  if (value.length <= limit) return { text: value, truncated: false };
  // Keep the record's end too: an extra trailing delimiter is often useful
  // evidence. Do not split a Unicode surrogate pair at either boundary.
  let head = value.slice(0, 1500);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  let tail = value.slice(-(limit - 1501));
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  return { text: head + '…' + tail, truncated: true };
}

export function columnCountDiagnostic({
  fileName,
  dataRow,
  startLine,
  endLine,
  headerLine,
  delimiter,
  headers,
  cells,
  rawRecord,
}: {
  fileName: string;
  dataRow: number;
  startLine: number;
  endLine: number;
  headerLine: number;
  delimiter: ',' | '\t';
  headers: readonly string[];
  cells: readonly string[];
  rawRecord: string;
}): CSVColumnCountDiagnostic {
  const expectedColumns = headers.length;
  const actualColumns = cells.length;
  const total = Math.max(expectedColumns, actualColumns);
  const boundary = Math.min(expectedColumns, actualColumns);
  const positions = new Set<number>();
  const add = (position: number) => {
    if (position >= 1 && position <= total) positions.add(position);
  };
  for (let position = 1; position <= 4; position++) add(position);
  for (let position = boundary - 1; position <= boundary + 2; position++)
    add(position);
  for (let position = total - 2; position <= total; position++) add(position);
  for (
    let position = 1;
    positions.size < Math.min(total, CSV_DIAGNOSTIC_LIMITS.columns);
    position++
  )
    add(position);
  const columns = [...positions]
    .sort((a, b) => a - b)
    .map((position) => ({
      position,
      header:
        position <= expectedColumns
          ? truncate(
              headers[position - 1],
              CSV_DIAGNOSTIC_LIMITS.headerCharacters,
            )
          : null,
      value:
        position <= actualColumns
          ? truncate(cells[position - 1], CSV_DIAGNOSTIC_LIMITS.valueCharacters)
          : null,
    }));
  const preview = recordPreview(rawRecord);
  return {
    kind: 'column-count',
    fileName: truncate(fileName, CSV_DIAGNOSTIC_LIMITS.fileNameCharacters),
    dataRow,
    startLine,
    endLine,
    headerLine,
    delimiter,
    expectedColumns,
    actualColumns,
    columns,
    omittedColumns: total - columns.length,
    rawRecord: preview.text,
    rawRecordTruncated: preview.truncated,
  };
}

export class CSVColumnCountError extends Error {
  readonly diagnostic: CSVColumnCountDiagnostic;

  constructor(diagnostic: CSVColumnCountDiagnostic) {
    super(
      `Data row ${diagnostic.dataRow} has ${diagnostic.actualColumns} columns; the header has ${diagnostic.expectedColumns}.`,
    );
    this.name = 'CSVColumnCountError';
    this.diagnostic = diagnostic;
  }
}

export interface CSVColumnCountWords {
  csvColumnsMismatch: string;
  csvColumnsHintExtra: string;
  csvColumnsHintMissing: string;
  csvDelimiterComma: string;
  csvDelimiterTab: string;
}

/** The diagnostic as one or two sentences in the UI's language: what differs, then what to look for. */
export function csvColumnCountMessage(diagnostic: CSVColumnCountDiagnostic, words: CSVColumnCountWords): string {
  const lines =
    diagnostic.startLine === diagnostic.endLine
      ? String(diagnostic.startLine)
      : `${diagnostic.startLine}–${diagnostic.endLine}`;
  const delimiter =
    diagnostic.delimiter === '\t' ? words.csvDelimiterTab : words.csvDelimiterComma;
  const hint =
    diagnostic.actualColumns > diagnostic.expectedColumns
      ? words.csvColumnsHintExtra.replace('{delimiter}', delimiter)
      : words.csvColumnsHintMissing;
  return (
    words.csvColumnsMismatch
      .replace('{row}', String(diagnostic.dataRow))
      .replace('{lines}', lines)
      .replace('{header}', String(diagnostic.headerLine))
      .replace('{expected}', String(diagnostic.expectedColumns))
      .replace('{actual}', String(diagnostic.actualColumns)) +
    ' ' +
    hint
  );
}
