/**
 * The figure service's protocol types, as answers/ hands them on: the Figure (src/webview/figure/) names the protocol
 * through here only (figure-design.md 第 8 節: figure/ imports answers/ and shell/; answers/ the protocol's types).
 */
export type {
    FigureAxis, FigureColumn, FigureDrawn, FigureDrawResult, FigureExportResult, FigureHeadline, FigureKey, FigureLane, FigureLine, FigureMembers, FigurePoint, FigureReadPayload, FigureReadResult,
    FigureSpec, FigureView,
} from '../../shared/protocol/generated/backendProtocolSchema';
