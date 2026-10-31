import type * as vscode from 'vscode';
import { CalibrationPanels } from './calibrationPanelRuntime';
import { CalibrationStore } from './calibrationStore';
import { activate as activateExtension, deactivate as deactivateExtension } from './index';

export function activate(context: vscode.ExtensionContext): void {
    const calibration = new CalibrationStore(context);
    context.subscriptions.push(new CalibrationPanels(calibration));
    activateExtension(context, calibration);
}

export function deactivate(): void {
    deactivateExtension();
}
