import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RecipeRunnerResult } from '../shared/chartSpec';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { resolveConfiguredPythonCommand } from './pythonEnvironment';

const RECIPE_RUNNER_SCRIPT = 'recipe_runner.py';
const RUN_TIMEOUT_MS = 120_000;

export interface RunRecipeOptions {
    /** Recipe with `{{selection}}` and relative inputs already resolved. */
    recipe: RecipeDocument;
    extensionPath: string;
    pythonCommand?: string;
}

/**
 * Spawn python recipe_runner.py with the resolved recipe JSON on stdin and
 * return the parsed ChartSpec payload. Input substitution is shared with the
 * Web host in src/shared/recipe; only the child process is native.
 */
export async function runRecipe(opts: RunRecipeOptions): Promise<RecipeRunnerResult> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = resolveConfiguredPythonCommand(opts.pythonCommand ?? config.get<string>('pythonCommand', 'python3'));
    const scriptDir = path.join(opts.extensionPath, 'python-backend');
    const scriptPath = path.join(scriptDir, RECIPE_RUNNER_SCRIPT);
    const payload = JSON.stringify(opts.recipe);

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
