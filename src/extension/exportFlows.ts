import * as path from 'path';
import * as vscode from 'vscode';
import { fileCountLabel, fillTemplate, getStrings } from '../shared/i18n/strings';
import type { ExportReportOptionsMessage, ExportWavLoopMessage } from '../shared/utils/audioTarget';
import type { ReportFormat } from '../shared/utils/exportArtifact';
import { userErrorText, type ExportWavLoopResult } from '../shared/protocol/backendProtocol';
import type { ReportArtifactFile, WavExportPlan } from '../shared/session/comparisonSessionController';

export interface WavExportBackend {
    exportWavLoop(filePath: string, startNorm: number, endNorm: number): Promise<ExportWavLoopResult>;
}

export interface ExportHost {
    pickOutputFolder(): Promise<vscode.Uri | undefined>;
    pickReportFormat(): Promise<'markdown' | 'notebook' | undefined>;
    pickReportDestination(defaultName: string, format: 'markdown' | 'notebook'): Promise<vscode.Uri | undefined>;
    pickRecipeDestination(fileName: string): Promise<vscode.Uri | undefined>;
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
            openLabel: getStrings(vscode.env.language).exportSelectOutputFolder,
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
    async pickRecipeDestination(fileName) {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return vscode.window.showSaveDialog({
            defaultUri: workspacePath ? vscode.Uri.file(path.join(workspacePath, fileName)) : undefined,
            filters: { 'Recipe JSON': ['json'] },
            saveLabel: getStrings(vscode.env.language).recipeSaveLabel,
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
                    errors.push(`${source.fileName}: ${userErrorText(error, getStrings(this.host.language()))}`);
                    return true;
                },
            },
            complete: () => {
                const strings = getStrings(this.host.language());
                if (errors.length > 0) {
                    this.host.showError(fillTemplate(strings.exportWavPartial, {
                        succeeded: successCount,
                        failed: errors.length,
                        errors: errors.join('; '),
                    }));
                } else {
                    this.host.showInformation(fillTemplate(strings.exportWavComplete, {
                        files: fileCountLabel(strings, successCount),
                        folder: outputFolder.fsPath,
                    }));
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

    async saveRecipe(file: ReportArtifactFile): Promise<void> {
        const destination = await this.host.pickRecipeDestination(file.name);
        if (!destination) { return; }
        await this.host.writeFile(destination, Buffer.from(file.content, 'utf-8'));
        this.host.showInformation(getStrings(this.host.language()).recipeSavedPrefix + destination.fsPath);
    }
}
