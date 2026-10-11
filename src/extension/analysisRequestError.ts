/** A failed desktop analysis request, carrying the revision it ran against and whether the backend never started. */
export class AnalysisRequestError extends Error {
    constructor(
        message: string,
        readonly analysisRevision: number,
        readonly backendStartupFailure = false,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'AnalysisRequestError';
    }
}
