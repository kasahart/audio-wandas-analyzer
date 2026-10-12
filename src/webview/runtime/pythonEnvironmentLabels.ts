/** フルパスから basename だけを返す（パス区切り文字なしならそのまま返す） */
function shortPythonName(cmd: string): string {
    const s = String(cmd);
    const last = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return last >= 0 ? (s.slice(last + 1) || s) : s;
}

/** Python ボタンのラベル文字列を生成する（短い表示名のみ） */
export function buildPythonButtonText(cmd: string, isWarning: boolean): string {
    return 'Python: ' + shortPythonName(cmd || 'python3') + (isWarning ? ' ⚠' : '');
}

/** Python ボタンのツールチップ文字列を生成する（フルパス＋説明） */
export function buildPythonTooltip(cmd: string, tooltip: string): string {
    const full = cmd || 'python3';
    return tooltip ? full + ' — ' + tooltip : full;
}

export function isPythonEnvError(msg: string): boolean {
    if (!msg) {
        return false;
    }
    return /Failed to start Python process|No module named|ModuleNotFoundError|ENOENT|spawn.*python|command not found/i.test(msg);
}
