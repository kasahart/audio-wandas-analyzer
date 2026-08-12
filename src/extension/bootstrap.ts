import type * as vscode from 'vscode';
import { installCalibrationPanelRuntime } from './calibrationPanelRuntime';
import { activate as activateExtension, deactivate as deactivateExtension } from './index';

export function activate(context: vscode.ExtensionContext): void {
    installCalibrationPanelRuntime(context);
    activateExtension(context);
}

export function deactivate(): void {
    deactivateExtension();
}
