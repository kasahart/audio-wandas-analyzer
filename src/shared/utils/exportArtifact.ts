import { runAnalysisBatch } from '../analysis/analysisCoordinator';
import type { ExportWavLoopResult } from '../protocol/backendProtocol';
import type { ExportReportOptionsMessage, ExportWavLoopMessage } from './audioTarget';

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

export function wavExportCommands(message: ExportWavLoopMessage, filePaths = message.filePaths) {
    return filePaths.map(filePath => {
        const region = message.fileRegions?.find(region => region.filePath === filePath) ?? message;
        return { cmd: 'export-wav-loop' as const, filePath, startNorm: region.startNorm, endNorm: region.endNorm };
    });
}

export interface WavExportSource { filePath: string; fileName: string }
export interface WavExportSink {
    isCurrent(): boolean;
    isSelected?(source: WavExportSource): boolean;
    prepare?(commands: ReturnType<typeof wavExportCommands>): Promise<void>;
    exportWavLoop(filePath: string, startNorm: number, endNorm: number): Promise<ExportWavLoopResult>;
    write(source: WavExportSource, name: string, result: ExportWavLoopResult): Promise<void>;
    failed?(source: WavExportSource, error: unknown): boolean;
}

export async function exportWavRegions(message: ExportWavLoopMessage, sources: WavExportSource[], sink: WavExportSink): Promise<void> {
    const commands = wavExportCommands(message, sources.map(source => source.filePath));
    await sink.prepare?.(commands);
    const usedNames = new Set<string>();
    const planned = sources.map((source, index) => ({ source, command: commands[index] }));
    await runAnalysisBatch(planned, {
        isCurrent: sink.isCurrent,
        isSelected: item => !sink.isSelected || sink.isSelected(item.source),
        analyze: item => sink.exportWavLoop(item.command.filePath, item.command.startNorm, item.command.endNorm),
        commit: async (item, result) => { await sink.write(item.source, wavLoopName(item.source.fileName, usedNames), result); },
        failed: sink.failed ? (item, error) => sink.failed!(item.source, error) : undefined,
    });
}
