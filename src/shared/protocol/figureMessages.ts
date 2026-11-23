/**
 * The figure service's five requests (python-backend/figures/service.py: draw, read, export, release, count) as they
 * travel between the webview's answers/ and the host, which hands them to the backend unchanged
 * (figure-design.md 第 6 節). The host adds nothing and decides nothing: the payload is the protocol's own.
 *
 * A superseded draw is cancelled by its request id (VS Code: the backend's cancel; the browser's Worker cannot
 * cancel and lets the running one finish).
 */
import type { BackendPayload, BackendResult } from './backendProtocol';

export const FIGURE_COMMANDS = ['figure-draw', 'figure-read', 'figure-export', 'figure-release', 'figure-count'] as const;
export type FigureCommand = typeof FIGURE_COMMANDS[number];

/** Webview → host: one request of the figure service. */
export interface FigureRequestMessage<K extends FigureCommand = FigureCommand> {
    type: 'figure-request';
    requestId: string;
    command: K;
    payload: BackendPayload<K>;
}

/** Webview → host: stop these requests if they still run (a superseded draw). */
export interface FigureCancelMessage {
    type: 'figure-cancel';
    requestIds: string[];
}

/** Host → webview: the service's answer, or that it failed (`failed`: no answer will come for the request). */
export type FigureResultMessage<K extends FigureCommand = FigureCommand> =
    | { type: 'figure-result'; requestId: string; command: K; result: BackendResult<K> }
    | { type: 'figure-result'; requestId: string; command: K; failed: string };

export const isFigureCommand = (value: unknown): value is FigureCommand => typeof value === 'string' && (FIGURE_COMMANDS as readonly string[]).includes(value);

/** A webview message of the figure service, its shape checked (the payload is checked by the backend's schema). */
export function isFigureRequestMessage(value: unknown): value is FigureRequestMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    return message['type'] === 'figure-request' && typeof message['requestId'] === 'string' && message['requestId'].length > 0
        && isFigureCommand(message['command']) && !!message['payload'] && typeof message['payload'] === 'object' && !Array.isArray(message['payload']);
}

export function isFigureCancelMessage(value: unknown): value is FigureCancelMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    return message['type'] === 'figure-cancel' && Array.isArray(message['requestIds']) && message['requestIds'].every(id => typeof id === 'string');
}
