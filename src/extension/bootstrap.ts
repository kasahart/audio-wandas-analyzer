import type * as vscode from 'vscode';
import { installCalibrationPanelRuntime } from './calibrationPanelRuntime';
import { CalibrationStore } from './calibrationStore';
import { activate as activateExtension, deactivate as deactivateExtension } from './index';

export function activate(context: vscode.ExtensionContext): void {
    const calibration = new CalibrationStore(context);
    installCalibrationPanelRuntime(context, calibration);
    activateExtension(context, calibration);
}

export function deactivate(): void {
    deactivateExtension();
}
