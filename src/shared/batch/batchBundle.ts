/**
 * 「レシピをまとめて書き出す」: the chain found on a few recordings, taken out to run over many outside the app.
 * A folder bundle: the Recipe (one per channel when the targets are channels of recordings, starting with
 * get_channel, as the report's), targets.csv (each recording's path below the folder, its channel and Recipe,
 * and the CSV's sample id), run_recipe.py (the wandas public API only) and a README. Nothing runs in the app.
 */
import type { RecipeDocument } from '../recipe/recipeSelection';
import { withChannel } from '../recipe/channelSelection';
import { recordingKey, type DatasetRow } from '../dataset/datasetTable';
import { RUN_RECIPE_PY } from './runRecipeScript';

export interface BatchFile { name: string; text: string }

export interface BatchInput {
    /** The Recipe as it runs (bypassed steps left out). */
    recipe: RecipeDocument;
    recipeName: string;
    /** The rows to run on (the table's filtered rows, or all), and every row, to tell a whole recording from one of its channels. */
    rows: readonly DatasetRow[];
    allRows: readonly DatasetRow[];
    rootPath: string;
    /** The folder as the user's machine names it, for the README's command; empty when unknown (the Web's picked folder). */
    runRoot?: string;
    /** The CSV's sample id column, copied into targets.csv when the CSV has one. */
    idColumn?: string;
    now: Date;
}

/** How many recordings and channels a target set is ("絞り込んだ n 本 (m ch)"). */
export function batchCount(rows: readonly DatasetRow[]): { recordings: number; channels: number } {
    return { recordings: new Set(rows.map(row => row.filePath)).size, channels: rows.length };
}

export interface BatchTarget { path: string; channel: number | null; recipe: string; id: string }

/**
 * One target per recording whose channels are all among the rows (or that has one channel): its channels
 * together, with the Recipe as it is. A recording only some of whose channels are there: one target per
 * channel, with that channel's Recipe.
 */
export function batchTargets(input: Pick<BatchInput, 'rows' | 'allRows' | 'rootPath' | 'idColumn' | 'recipeName'>): BatchTarget[] {
    const chosen = new Set(input.rows.map(row => row.key));
    const whole = new Map<string, boolean>();
    for (const row of input.allRows) whole.set(row.filePath, (whole.get(row.filePath) ?? true) && chosen.has(row.key));
    const targets: BatchTarget[] = [];
    const seen = new Set<string>();
    for (const row of input.rows) {
        const all = whole.get(row.filePath) ?? true;
        const channel = all || (row.channels ?? 1) <= 1 ? null : row.ch;
        const key = `${row.filePath}#${channel ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({
            path: recordingKey(row.filePath, input.rootPath), channel, recipe: recipeFile(input.recipeName, channel),
            id: input.idColumn ? row.attributes?.[input.idColumn] ?? '' : '',
        });
    }
    return targets;
}

const TARGET_COLUMNS = ['path', 'channel', 'recipe'];
/** The CSV's id column as targets.csv names it: one called path, channel or recipe would hide the column run_recipe.py reads. */
const idHeader = (column: string): string => (TARGET_COLUMNS.includes(column.trim().toLowerCase()) ? `id_${column}` : column);
const recipeFile = (name: string, channel: number | null): string => `${name}${channel ? `.ch${channel}` : ''}.recipe.json`;
const cell = (text: string): string => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function batchFolderName(recipeName: string, now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${recipeName}_batch_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function batchBundle(input: BatchInput): { folder: string; files: BatchFile[] } {
    const targets = batchTargets(input);
    const channels = [...new Set(targets.map(target => target.channel))];
    const recipes = channels.map(channel => ({
        name: recipeFile(input.recipeName, channel),
        text: JSON.stringify(channel ? withChannel(input.recipe, channel) : input.recipe, null, 2) + '\n',
    }));
    const header = [...TARGET_COLUMNS, ...(input.idColumn ? [idHeader(input.idColumn)] : [])];
    const targetsCsv = [header, ...targets.map(target => [target.path, target.channel ? String(target.channel) : '', target.recipe, ...(input.idColumn ? [target.id] : [])])]
        .map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
    const files = [...recipes, { name: 'targets.csv', text: targetsCsv }, { name: 'run_recipe.py', text: RUN_RECIPE_PY }, { name: 'README.txt', text: readme(input, targets.length, channels) }];
    return { folder: batchFolderName(input.recipeName, input.now), files };
}

function readme(input: BatchInput, count: number, channels: ReadonlyArray<number | null>): string {
    const recipes = channels.map(channel => recipeFile(input.recipeName, channel)).join(', ');
    const known = input.runRoot ?? input.rootPath;
    const root = known || '<録音のフォルダ>';
    return `レシピをまとめて実行する（Audio Wandas Analyzer で書き出し）
==============================================================

中身
- ${recipes}: wandas の Recipe。チャンネルごとのものは get_channel から始まります。
- targets.csv: 実行する ${count} 件。録音の相対パス、チャンネル（空欄は全チャンネル）、使う Recipe${input.idColumn ? `、${idHeader(input.idColumn)}` : ''}。
- run_recipe.py: wandas の公開 API だけで、targets.csv の録音に Recipe を順に掛けます。
- アプリの中では何も実行していません。

実行（wandas 0.10.0 以上と、WDF の保存に使う wandas[io]）
  pip install -U "wandas[io]>=0.10.0"
  python run_recipe.py --root "${root}" --out outputs --jobs 4

結果
- outputs/ に録音ごとの出力（WDF。wandas.load で読み戻せます）。
- outputs/results_index.csv に、録音ごとの成否とエラー。失敗があっても残りは続けます。

------------------------------------------------------------------

Running the Recipe over many recordings (exported by Audio Wandas Analyzer)

Contents
- ${recipes}: the wandas Recipe; a channel's starts with get_channel.
- targets.csv: the ${count} targets: each recording's path relative to the folder, its channel (blank: all channels), the Recipe to use${input.idColumn ? `, and ${idHeader(input.idColumn)}` : ''}.
- run_recipe.py: applies the Recipe to every recording in targets.csv, with the wandas public API only.
- Nothing was run in the app.

Run (wandas 0.10.0 or later, with wandas[io] for saving WDF)
  pip install -U "wandas[io]>=0.10.0"
  python run_recipe.py --root "${known || '<the recordings folder>'}" --out outputs --jobs 4

Results
- outputs/: one output per recording (WDF; read it back with wandas.load).
- outputs/results_index.csv: per recording, whether it ran and the error if not. A failure does not stop the rest.
`;
}
