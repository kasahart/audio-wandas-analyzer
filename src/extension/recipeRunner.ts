import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RecipeRunnerResult } from '../shared/chartSpec';

const RECIPE_RUNNER_SCRIPT = 'recipe_runner.py';
const RUN_TIMEOUT_MS = 120_000;

export interface RunRecipeOptions {
    recipePath: string;
    selectionFilePaths: string[];
    extensionPath: string;
    pythonCommand?: string;
}

/**
 * Read a recipe JSON file, substitute {{selection}} placeholders with the
 * provided file paths in order, then spawn python recipe_runner.py with the
 * resolved JSON on stdin. Returns the parsed ChartSpec payload.
 */
export async function runRecipe(opts: RunRecipeOptions): Promise<RecipeRunnerResult> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = opts.pythonCommand ?? config.get<string>('pythonCommand', 'python3');
    const scriptDir = path.join(opts.extensionPath, 'python-backend');
    const scriptPath = path.join(scriptDir, RECIPE_RUNNER_SCRIPT);

    const recipeText = await vscode.workspace.fs.readFile(vscode.Uri.file(opts.recipePath));
    const recipe = JSON.parse(Buffer.from(recipeText).toString('utf-8')) as {
        inputs?: Array<{ name: string; file: string }>;
        steps?: unknown;
        display?: unknown;
    };

    const resolved = substituteSelection(recipe, opts.selectionFilePaths, path.dirname(opts.recipePath));
    const payload = JSON.stringify(resolved);

    return await new Promise<RecipeRunnerResult>((resolve, reject) => {
        const proc = spawn(pythonCommand, [scriptPath, '--recipe', '-'], {
            cwd: scriptDir,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`recipe_runner timed out after ${RUN_TIMEOUT_MS} ms`));
        }, RUN_TIMEOUT_MS);

        proc.stdout.setEncoding('utf-8');
        proc.stderr.setEncoding('utf-8');
        proc.stdout.on('data', (chunk: string) => { stdout += chunk; });
        proc.stderr.on('data', (chunk: string) => { stderr += chunk; });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`recipe_runner exited with code ${code}: ${stderr.trim() || 'no stderr'}`));
                return;
            }
            try {
                const parsed = JSON.parse(stdout) as RecipeRunnerResult;
                resolve(parsed);
            } catch (parseError) {
                reject(new Error(`Failed to parse recipe_runner output: ${(parseError as Error).message}`));
            }
        });

        proc.stdin.end(payload, 'utf-8');
    });
}

function substituteSelection(
    recipe: { inputs?: Array<{ name: string; file: string }> } & Record<string, unknown>,
    selectionFilePaths: string[],
    recipeDir: string,
): unknown {
    const inputs = Array.isArray(recipe.inputs) ? recipe.inputs : [];
    let selectionCursor = 0;
    const resolvedInputs = inputs.map((input) => {
        if (input.file === '{{selection}}') {
            const fp = selectionFilePaths[selectionCursor];
            selectionCursor += 1;
            if (!fp) {
                throw new Error(
                    `Recipe expects ${inputs.filter((i) => i.file === '{{selection}}').length} file(s) ` +
                    `from the panel selection but ${selectionFilePaths.length} are checked.`,
                );
            }
            return { ...input, file: fp };
        }
        if (!path.isAbsolute(input.file)) {
            return { ...input, file: path.resolve(recipeDir, input.file) };
        }
        return input;
    });
    return { ...recipe, inputs: resolvedInputs };
}
