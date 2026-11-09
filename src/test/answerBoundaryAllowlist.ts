/**
 * The collections outside answerStore.ts that outlive a call and hold no answer (answerStoreBoundary.test.ts), each
 * with what it holds instead. The list only shrinks: a cache of answers is never added here, it is moved onto the store.
 *
 * Entries marked MOVE are answers still held outside the store, waiting for the shared-component batch that is editing
 * their files; they are moved onto the store next and taken off.
 */
export const NOT_ANSWERS: Record<string, string> = {
    // ── Requests on their way (routing: which callback or screen an answer goes to, never the answer) ──
    'src/webview/runtime/combineSource.ts#asked': 'the combinations on their way by request id, to route each answer to its key',
    'src/webview/runtime/hostRequests.ts#known': 'requests on their way by id (which slot an answer is for)',
    'src/webview/runtime/hostRequests.ts#current': 'each slot\'s current request id',
    'src/webview/runtime/laneReads.ts#waiting': 'reads on their way by request id: the callback each answer goes to',
    'src/webview/runtime/stageReader.ts#waiting': 'reads on their way by request id: the callback each answer goes to',
    'src/webview/runtime/fullRead.ts#waiting': 'readers to call once a read on its way is in',
    'src/webview/runtime/staticWorker.ts#replies': 'worker calls on their way by id: the callback each reply goes to',
    'src/webview/runtime/spectrumRequestScheduler.ts#desired': 'the latest cursor-spectrum request wanted per track, not yet sent',
    'src/webview/runtime/entryRedraw.ts#pending': 'redraws asked for this frame',
    'src/webview/runtime/entryRedraw.ts#afterwards': 'callbacks to run after this frame\'s redraws',
    'src/webview/runtime/staticHost.ts#pendingTreePaths': 'folder paths whose listing is being read',

    // ── Listeners ──
    'src/webview/runtime/layoutSettings.ts#listeners': 'layout change listeners',
    'src/webview/runtime/playbackController.ts#listeners': 'playback change listeners',
    'src/webview/runtime/runtimeEvents.ts#listeners': 'runtime event listeners',
    'src/webview/runtime/staticHost.ts#inboundListeners': 'host message listeners',
    'src/webview/panels/ComparisonPanel.ts#testMessageDisposables': 'test bridge listeners per panel, to dispose',

    // ── What is on screen: canvases, drawings, marks, zoom and gestures ──
    'src/webview/runtime/comparisonRuntime.ts#lanePlots': 'each lane canvas\'s last drawing, for its pointer readout',
    'src/webview/runtime/comparisonRuntime.ts#spectrogramPlots': 'each spectrogram canvas\'s last drawing, for its pointer readout',
    'src/webview/runtime/comparisonRuntime.ts#spectrogramRasterCache': 'pixels of a lane\'s spectrogram drawn (by track, channel and theme), let go with the track\'s analysis',
    'src/webview/runtime/entryDistributionPane.ts#plots': 'each distribution element\'s last drawing, for its pointer readout',
    'src/webview/runtime/entryPlots.ts#overviewCache': 'each overview canvas\'s drawing, redrawn when its rows key changes',
    'src/webview/runtime/entryTableHtml.ts#linesOf': 'a table view\'s lines, keyed by the view object itself',
    'src/webview/runtime/entrySidePlots.ts#windows': 'each side plot\'s zoom window',
    'src/webview/runtime/entrySidePlots.ts#windowKeys': 'what each side plot\'s zoom window was set for',
    'src/webview/runtime/pairSpectrumPanel.ts#drawn': 'each pair plot\'s last drawing, for the pointer and gestures',
    'src/webview/runtime/pairSpectrumPanel.ts#levelWindow': 'each pair plot\'s level zoom',
    'src/webview/runtime/pairSpectrumPanel.ts#marks': 'each pair plot\'s hover marks layer',
    'src/webview/runtime/plotHoverLayer.ts#filled': 'hover mark elements in use',
    'src/webview/runtime/stagePanes.ts#settledOrders': 'the order lines were last drawn in, per picture set',
    'src/webview/runtime/stagePanes.ts#recorded': 'drawings already reported to the test bridge',
    'src/webview/runtime/stagePanes.ts#paintedGenerations': 'each canvas\'s paint generation',
    'src/webview/runtime/stagePanes.ts#fulls': 'one hover read\'s points per line (within the call; its callback is run at once)',
    'src/webview/runtime/entryRuntime.ts#written': 'the text last written into each element, to skip unchanged writes',
    'src/webview/runtime/trackStageMode.ts#laneDetail': 'one draw\'s detail specs per lane (the pictures are the stage source\'s)',
    'src/webview/runtime/trackStagePainter.ts#statuses': 'one call\'s calibration statuses per level identity',
    'src/webview/runtime/trackStageMode.ts#drawnOn': 'what each stage element last drew',
    'src/webview/runtime/trackCanvasPainter.ts#laneWaveforms': 'a waveform\'s lane drawing, keyed by the envelope object itself',
    'src/webview/runtime/trackCanvasPainter.ts#laneMatrices': 'a spectrogram\'s matrix for drawing, keyed by the spectrogram object itself',
    'src/webview/plot/waveformLayer.ts#envelopes': 'a waveform\'s envelope on an axis, keyed by the waveform object itself',
    'src/webview/runtime/layoutSettings.ts#canvasSizes': 'each canvas\'s last size',
    'src/webview/runtime/keyRouter.ts#contexts': 'keyboard contexts in focus order',
    'src/webview/runtime/stageDetail.ts#asked': 'the detail ranges a zoom asked for (to pick one that covers the view); their pictures are the stage source\'s',

    // ── Audio ──
    'src/webview/runtime/audioFade.ts#routes': 'audio nodes per media element',
    'src/webview/runtime/audioFade.ts#ramps': 'gain ramps per audio parameter',
    'src/webview/runtime/audioFade.ts#pendingPauses': 'pauses waiting for a fade to end',

    // ── The user's choices and the files open ──
    'src/webview/runtime/entryRuntime.ts#excluded': 'rows the user took off',
    'src/webview/runtime/entryRuntime.ts#memo': 'the user\'s memo per row',
    'src/webview/runtime/entryRuntime.ts#byKey': 'the table\'s rows by key, made again when the rows are',
    'src/webview/runtime/entryRuntime.ts#filtered': 'rows the filter keeps, made again on each filter change',
    'src/webview/runtime/selectionSync.ts#hostSelection': 'the files the host has selected',
    'src/webview/runtime/stepHistory.ts#past': 'the step bar\'s undo history',
    'src/webview/runtime/trackStore.ts#records': 'the tracks open (each track\'s own state; its answers are the stores\')',
    'src/webview/runtime/trackStore.ts#locallyRemovedIds': 'tracks the user removed, until the host confirms',
    'src/webview/runtime/trackStore.ts#protocolOrder': 'the tracks\' order on the protocol',
    'src/webview/runtime/trackStore.ts#displayOrder': 'the tracks\' order on screen',
    'src/webview/runtime/trackStageMode.ts#IMAGE_FRAMES': 'a constant: the Frame kinds drawn as images',
    'src/webview/runtime/trackStageModel.ts#baseAllowed': 'a constant: the steps a base group may compare',
    'src/webview/runtime/staticHost.ts#folder': 'the files of the folder opened in the browser',
    'src/webview/runtime/staticSources.ts#byMessage': 'load failures grouped by message, for one notice',
    'src/webview/runtime/staticWorker.ts#loaded': 'packages loaded in the worker',
    'src/webview/runtime/staticDownloads.ts#entries': 'files of one download being written',
    'src/webview/panels/ComparisonPanel.ts#testSnapshotsByActionId': 'test bridge snapshots by action id',
    'src/webview/panels/ComparisonPanel.ts#resultsByPanel': 'host side: the analysis results each panel was last sent, to send again on reload',

    // ── MOVE: answers still outside the store, in files the shared-component batch is editing ──
    'src/webview/runtime/fullRead.ts#kept': 'MOVE: full-data windows read (onto createAnswerStore, empty windows as the empty state)',
    'src/webview/runtime/stageReader.ts#sources': 'MOVE: each combined picture\'s full-data source (onto createAnswerStore.keep)',
    'src/webview/runtime/comparisonRuntime.ts#spectrogramZoomFailedAt': 'MOVE: when a lane\'s zoom window failed (onto createFailureHold)',
    'src/webview/runtime/comparisonRuntime.ts#rangeAskedAt': 'MOVE: when each range request was sent (onto createRequestClock)',
    'src/webview/runtime/comparisonRuntime.ts#rangeLandedAskedAt': 'MOVE: when the range each lane draws was asked for (onto createRequestClock)',
    'src/webview/runtime/comparisonRuntime.ts#shownWindowBands': 'MOVE: the cursor spectrum\'s bands kept while its slices arrive',
    'src/webview/runtime/entrySidePlots.ts#levels': 'MOVE: each scanned recording\'s band levels by row, indexed from the entry results',
    'src/webview/runtime/entrySidePlots.ts#levelRows': 'MOVE: the rows of the levels each recording has',
    'src/webview/runtime/entrySidePlots.ts#levelLabels': 'MOVE: each recording\'s level identity, indexed from its scan',
    'src/webview/runtime/entrySidePlots.ts#calibrated': 'MOVE: the recordings scanned with a calibration',
};

/** Retry and failure-pause names still outside the store, in files the shared-component batch is editing (MOVE). */
export const RETRY_TO_MOVE: string[] = [
    'src/webview/runtime/comparisonRuntime.ts#DETAIL_RETRY_MS',
    'src/webview/runtime/comparisonRuntime.ts#spectrogramZoomFailedAt',
    'src/webview/runtime/comparisonRuntime.ts#RANGE_RETRY_MS',
    'src/webview/runtime/fullRead.ts#FAILED_HOLD_MS',
];
