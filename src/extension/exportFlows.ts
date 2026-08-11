import * as path from 'path';
import * as vscode from 'vscode';
import { getStrings } from '../shared/i18n/strings';
import type { ExportReportOptionsMessage, ExportWavLoopMessage } from '../shared/utils/audioTarget';
import type { ExportWavLoopResult } from './backendProtocol';

export interface WavExportBackend {
    exportWavLoop(filePath: string, startNorm: number, endNorm: number): Promise<ExportWavLoopResult>;
}

export interface ExportHost {
    pickOutputFolder(): Promise<vscode.Uri | undefined>;
    pickReportFormat(): Promise<'markdown' | 'notebook' | undefined>;
    pickReportDestination(defaultName: string, format: 'markdown' | 'notebook'): Promise<vscode.Uri | undefined>;
    writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
    showInformation(message: string): void;
    showError(message: string): void;
    language(): string;
}

const defaultHost: ExportHost = {
    async pickOutputFolder() {
        const folders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select output folder',
        });
        return folders?.[0];
    },
    async pickReportFormat() {
        const strings = getStrings(vscode.env.language);
        const selected = await vscode.window.showQuickPick(
            [
                { label: strings.reportFormatMarkdown, value: 'markdown' as const },
                { label: strings.reportFormatNotebook, value: 'notebook' as const },
            ],
            { placeHolder: strings.reportFormatPlaceholder },
        );
        return selected?.value;
    },
    async pickReportDestination(defaultName, format) {
        const strings = getStrings(vscode.env.language);
        const extension = format === 'markdown' ? '.md' : '.ipynb';
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return vscode.window.showSaveDialog({
            defaultUri: workspacePath
                ? vscode.Uri.file(path.join(workspacePath, defaultName + extension))
                : undefined,
            filters: format === 'markdown' ? { Markdown: ['md'] } : { Notebook: ['ipynb'] },
            saveLabel: strings.reportSaveLabel,
        });
    },
    writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
    showInformation: (message) => { void vscode.window.showInformationMessage(message); },
    showError: (message) => { void vscode.window.showErrorMessage(message); },
    language: () => vscode.env.language,
};

export class ExportFlows {
    constructor(
        private readonly backend: WavExportBackend,
        private readonly host: ExportHost = defaultHost,
    ) {}

    async exportWavLoop(message: ExportWavLoopMessage): Promise<void> {
        const outputFolder = await this.host.pickOutputFolder();
        if (!outputFolder) { return; }

        let successCount = 0;
        const errors: string[] = [];
        const usedNames = new Set<string>();
        for (const filePath of message.filePaths) {
            try {
                const result = await this.backend.exportWavLoop(filePath, message.startNorm, message.endNorm);
                const stem = path.basename(filePath, path.extname(filePath));
                let baseName = `${stem}_loop.wav`;
                if (usedNames.has(baseName)) {
                    let suffix = 2;
                    while (usedNames.has(`${stem}_loop_${suffix}.wav`)) { suffix++; }
                    baseName = `${stem}_loop_${suffix}.wav`;
                }
                usedNames.add(baseName);
                await this.host.writeFile(
                    vscode.Uri.joinPath(outputFolder, baseName),
                    Buffer.from(result.wavBase64, 'base64'),
                );
                successCount++;
            } catch (error) {
                errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (errors.length > 0) {
            this.host.showError(
                `WAV export: ${successCount} succeeded, ${errors.length} failed — ${errors.join('; ')}`,
            );
        } else {
            this.host.showInformation(
                `WAV export complete (${successCount} file${successCount !== 1 ? 's' : ''}) → ${outputFolder.fsPath}`,
            );
        }
    }

    async exportReport(message: ExportReportOptionsMessage): Promise<void> {
        const format = await this.host.pickReportFormat();
        if (!format) { return; }
        const destination = await this.host.pickReportDestination(message.defaultName, format);
        if (!destination) { return; }
        const content = format === 'markdown' ? message.markdownContent : message.notebookContent;
        await this.host.writeFile(destination, Buffer.from(content, 'utf-8'));
        this.host.showInformation(getStrings(this.host.language()).reportExportedPrefix + destination.fsPath);
    }
}
