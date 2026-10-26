/**
 * CSV diagnostics, ported unchanged from asd-insight packages/domain/csv-diagnostics.ts (commit 40ea4a0):
 * a data row whose column count differs from the header's is reported with the evidence around it.
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
  hints: string[];
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
  const delimiterName = delimiter === '\t' ? 'タブ' : 'カンマ（,）';
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
    hints: [
      `区切り文字は${delimiterName}として読み取りました。ヘッダーと該当行で同じ区切りを使っているか確認してください。`,
      `セル内に${delimiterName}や改行を含む場合は、セル全体を二重引用符（"）で囲み、セル内の " は "" と書いているか確認してください。`,
      actualColumns > expectedColumns
        ? '行末の余分な区切りや、引用符で囲まれていないセル内の区切りがないか確認してください。'
        : '値が空でも区切りを省略せず、ヘッダーと同じ列位置を保っているか確認してください。',
    ],
  };
}

export class CSVColumnCountError extends Error {
  readonly diagnostic: CSVColumnCountDiagnostic;

  constructor(diagnostic: CSVColumnCountDiagnostic) {
    const physicalLines =
      diagnostic.startLine === diagnostic.endLine
        ? `${diagnostic.startLine}行目`
        : `${diagnostic.startLine}〜${diagnostic.endLine}行目`;
    const difference = diagnostic.actualColumns - diagnostic.expectedColumns;
    super(
      `データ行 ${diagnostic.dataRow}（ファイル${physicalLines}）の列数がヘッダーと一致しません。` +
        `ヘッダー（${diagnostic.headerLine}行目）は${diagnostic.expectedColumns}列、実際は${diagnostic.actualColumns}列（${Math.abs(difference)}列${difference < 0 ? '不足' : '超過'}）です。`,
    );
    this.name = 'CSVColumnCountError';
    this.diagnostic = diagnostic;
  }
}
