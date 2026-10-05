import type { ExportReportOptionsMessage } from './audioTarget';

export type ReportFormat = 'markdown' | 'notebook';

export function wavLoopName(fileName: string, used: Set<string>): string {
    const leaf = fileName.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '_');
    const stem = leaf.replace(/\.[^.]+$/, '') || 'audio';
    let name = `${stem}_loop.wav`;
    for (let suffix = 2; used.has(name); suffix++) name = `${stem}_loop_${suffix}.wav`;
    used.add(name);
    return name;
}

export function reportArtifact(message: ExportReportOptionsMessage, format: ReportFormat): { name: string; content: string; type: string } {
    const stem = message.defaultName.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '_') || 'analysis';
    return format === 'markdown'
        ? { name: stem + '.md', content: message.markdownContent, type: 'text/markdown;charset=utf-8' }
        : { name: stem + '.ipynb', content: message.notebookContent, type: 'application/x-ipynb+json' };
}
