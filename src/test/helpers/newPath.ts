/**
 * The folders of the figure path (docs/figure-design.md 第 8 節). The scanners of runtime/ (the plot
 * contracts' list of number-writing functions, the answer store's boundary, the figure model's layer, the drawing
 * surfaces) do not look into them: these folders are held by their own rules (eslint.config.mjs per folder,
 * src/test/figureImportRules.test.ts, figureComponent.test.ts, figureRequests.test.ts).
 * shell/ is not among them: its helpers (number text, the key router, the range popover) are used by runtime/ too,
 * so the scanners keep holding it.
 */
const NEW_PATH = ['src/webview/figure/', 'src/webview/answers/', 'src/webview/charts/', 'src/webview/screens/', 'src/webview/state/'];

/** Whether a repo-relative path is the figure path's own code, except the files of figure/ that runtime/ uses too. */
export const isNewPath = (rel: string): boolean => NEW_PATH.some(dir => rel.startsWith(dir)) && !SHARED_WITH_OLD.has(rel);

/**
 * Files of figure/ that runtime/ uses too (one implementation of a rule, 第 2 節 D): the scanners of runtime/ keep
 * holding them.
 */
export const SHARED_WITH_OLD: ReadonlySet<string> = new Set([
    'src/webview/figure/axisScale.ts', 'src/webview/figure/ticks.ts', 'src/webview/figure/fieldWindow.ts', 'src/webview/figure/pressArbiter.ts', 'src/webview/figure/axisNames.ts',
]);
