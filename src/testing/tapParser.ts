export interface ParsedTapTestResult {
    kind: 'suite' | 'test';
    title: string;
    titlePath: string[];
    fullName: string;
    status: 'passed' | 'failed';
    durationMs?: number;
    diagnostics: string;
}

interface PendingResult {
    indent: number;
    title: string;
    titlePath: string[];
    status: 'passed' | 'failed';
    diagnostics: string[];
    durationMs?: number;
    kind: 'suite' | 'test';
}

export function parseTapTestResults(output: string): ParsedTapTestResult[] {
    const results: ParsedTapTestResult[] = [];
    const stack: Array<{ indent: number; title: string }> = [];
    let pending: PendingResult | undefined;

    const finalizePending = (): void => {
        if (!pending) {
            return;
        }

        results.push({
            kind: pending.kind,
            title: pending.title,
            titlePath: pending.titlePath,
            fullName: pending.titlePath.join(' > '),
            status: pending.status,
            durationMs: pending.durationMs,
            diagnostics: pending.diagnostics.join('\n').trim(),
        });
        pending = undefined;
    };

    for (const rawLine of output.split(/\r?\n/)) {
        const subtestMatch = rawLine.match(/^(\s*)# Subtest: (.+)$/);
        if (subtestMatch) {
            finalizePending();
            const indent = subtestMatch[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }
            stack.push({ indent, title: subtestMatch[2] });
            continue;
        }

        const resultMatch = rawLine.match(/^(\s*)(ok|not ok)\s+\d+\s+-\s+(.+)$/);
        if (resultMatch) {
            finalizePending();
            const indent = resultMatch[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
                stack.pop();
            }

            pending = {
                indent,
                title: resultMatch[3],
                titlePath: stack.map((entry) => entry.title),
                status: resultMatch[2] === 'ok' ? 'passed' : 'failed',
                diagnostics: [],
                kind: 'test',
            };

            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }
            continue;
        }

        if (!pending) {
            continue;
        }

        const trimmed = rawLine.trim();
        if (!trimmed || trimmed === '---' || trimmed === '...') {
            if (trimmed === '...') {
                finalizePending();
            }
            continue;
        }

        const typeMatch = trimmed.match(/^type:\s+'(suite|test)'$/);
        if (typeMatch) {
            pending.kind = typeMatch[1] === 'suite' ? 'suite' : 'test';
            continue;
        }

        const durationMatch = trimmed.match(/^duration_ms:\s+([0-9.]+)$/);
        if (durationMatch) {
            pending.durationMs = Number(durationMatch[1]);
            continue;
        }

        pending.diagnostics.push(trimmed);
    }

    finalizePending();
    return results;
}

export function buildNodeTestNamePattern(titlePath: string[], kind: 'suite' | 'test'): string {
    const joined = titlePath.map(escapeForRegularExpression).join('.*');
    return kind === 'suite'
        ? `^${joined}(?:$|.*)$`
        : `^${joined}$`;
}

function escapeForRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}