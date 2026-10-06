import * as path from 'path';
import * as vscode from 'vscode';
import { getStrings } from '../shared/i18n/strings';
import type { ExportReportOptionsMessage, ExportWavLoopMessage } from '../shared/utils/audioTarget';
import type { ReportFormat } from '../shared/utils/exportArtifact';
import type { ExportWavLoopResult } from '../shared/protocol/backendProtocol';
import type { ReportArtifactFile, WavExportPlan } from '../shared/session/comparisonSessionController';

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

/** Native export ports: folder and save dialogs, URI writes and VS Code notifications. */
export class ExportFlows {
    constructor(
        private readonly backend: WavExportBackend,
        private readonly host: ExportHost = defaultHost,
    ) {}

    async wavExport(message: ExportWavLoopMessage): Promise<WavExportPlan | undefined> {
        const outputFolder = await this.host.pickOutputFolder();
        if (!outputFolder) { return undefined; }

        let successCount = 0;
        const errors: string[] = [];
        return {
            sources: message.filePaths.map(filePath => ({ filePath, fileName: path.basename(filePath) })),
            sink: {
                isCurrent: () => true,
                exportWavLoop: (filePath, start, end) => this.backend.exportWavLoop(filePath, start, end),
                write: async (_source, name, result) => {
                    await this.host.writeFile(vscode.Uri.joinPath(outputFolder, name), Buffer.from(result.wavBase64, 'base64'));
                    successCount++;
                },
                failed: (source, error) => {
                    errors.push(`${source.fileName}: ${error instanceof Error ? error.message : String(error)}`);
                    return true;
                },
            },
            complete: () => {
                if (errors.length > 0) {
                    this.host.showError(
                        `WAV export: ${successCount} succeeded, ${errors.length} failed — ${errors.join('; ')}`,
                    );
                } else {
                    this.host.showInformation(
                        `WAV export complete (${successCount} file${successCount !== 1 ? 's' : ''}) → ${outputFolder.fsPath}`,
                    );
                }
            },
        };
    }

    pickReportFormat(): Promise<ReportFormat | undefined> {
        return this.host.pickReportFormat();
    }

    async saveReport(artifact: ReportArtifactFile, format: ReportFormat, message: ExportReportOptionsMessage): Promise<void> {
        const destination = await this.host.pickReportDestination(message.defaultName, format);
        if (!destination) { return; }
        await this.host.writeFile(destination, Buffer.from(artifact.content, 'utf-8'));
        this.host.showInformation(getStrings(this.host.language()).reportExportedPrefix + destination.fsPath);
    }
}
