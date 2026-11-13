/**
 * The one CSV writer every CSV the Analyzer writes goes through (the spectrum export, the entry table, 報告.csv,
 * the notes CSV, a batch's targets.csv), in the VS Code panel and the browser build alike, so each is read back by any
 * RFC 4180 reader as it was written.
 *
 * The file format (one for every CSV the Analyzer writes):
 * - UTF-8 with a BOM (EF BB BF) first: a spreadsheet app reads a Japanese header without it as Shift_JIS / ANSI and
 *   shows it garbled (the Japanese UI writes Japanese headers);
 * - CRLF after every record, the last one too (RFC 4180; Excel on Windows reads it as written);
 * - each field through `csvField`, quoted exactly when it must be.
 * `csvFile` is the only place that format is written: an export hands it its header and rows and gets the file's text.
 * The batch's results_index.csv, written by run_recipe.py outside the Analyzer, keeps the same format
 * (`encoding="utf-8-sig"`, the csv module's CRLF). Held by src/test/csvExports.test.ts (the bytes of each export, and no
 * export building CSV text without `csvFile`).
 *
 * Why one place: headers carry the UI's words, and an English one has commas in it ("Level, uncalibrated [dBFS]"),
 * a user's column name or memo can hold a quote or a line break. A writer that joined such a field bare would shift
 * every column after it, and only in some languages; a copy of this rule per export would drift (the spectrum CSV once
 * went out without a BOM and with LF while every other export had both).
 */

/** The byte order mark every CSV the Analyzer writes starts with (U+FEFF, EF BB BF in UTF-8). */
export const CSV_BOM = '\uFEFF';
/** What ends every record of a CSV the Analyzer writes, the last one too. */
export const CSV_RECORD_END = '\r\n';

/** A whole CSV file: the header and the rows, each field quoted when it must be, BOM first, CRLF after every record. */
export function csvFile(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
    return CSV_BOM + [header, ...rows].map(record => record.map(csvField).join(',') + CSV_RECORD_END).join('');
}

/** One field: quoted (a quote doubled) when it holds a comma, a quote or a line break; else as it is. */
export function csvField(text: string): string {
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A CSV the Analyzer wrote, as records of fields: the inverse of `csvField` (RFC 4180: quoted fields, doubled quotes,
 * line breaks inside quotes; CRLF or LF between records; a leading BOM dropped; a last line break ends the last record).
 * It reads back exports in tests and in the browser parity check (scripts/test-browser-parity.js), which must never
 * split a line on ',' by hand. A CSV the user picks is read by asdData.parseCSV, which also checks it as a dataset.
 */
export function csvRecords(text: string): string[][] {
    const records: string[][] = [];
    let record: string[] = [], field = '', quoted = false, started = false;
    const body = text.replace(/^\uFEFF/u, '');
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quoted) {
            if (c !== '"') field += c;
            else if (body[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else if (c === '"' && !field) { quoted = true; started = true; } else if (c === ',') { record.push(field); field = ''; started = true; } else if (c === '\r' || c === '\n') {
            if (c === '\r' && body[i + 1] === '\n') i++;
            records.push([...record, field]);
            record = []; field = ''; started = false;
        } else { field += c; started = true; }
    }
    if (quoted) throw new Error('CSV ends inside a quoted field');
    if (started || field || record.length) records.push([...record, field]);
    return records;
}
