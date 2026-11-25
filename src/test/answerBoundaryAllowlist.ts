/**
 * Why a place is listed, in one of three kinds:
 * - notAnswer: it holds no answer (a request on its way, a drawing, a listener, a constant, the user's choice);
 * - inLayer: it is the layer's own implementation or goes through the store (its key and states are the store's);
 * - unmigrated: it keeps answers outside the store still, with its own key rules. Their number is UNMIGRATED_CEILING,
 *   which only goes down: a new one fails the test, and one moved onto the store lowers it.
 */
export type ListedKind = 'not-answer' | 'in-layer' | 'unmigrated';
export interface Listed { readonly kind: ListedKind; readonly why: string }
const notAnswer = (why: string): Listed => ({ kind: 'not-answer', why });
const inLayer = (why: string): Listed => ({ kind: 'in-layer', why });
const unmigrated = (why: string): Listed => ({ kind: 'unmigrated', why });

/** How many listed places still keep answers outside the store (kind unmigrated): it only goes down. */
export const UNMIGRATED_CEILING = 11;

/** How many answer sources may keep timers of their own (SCHEDULING_OWNERS): it only goes down. */
export const SCHEDULING_OWNERS_CEILING = 2;

/**
 * The collections outside answerStore.ts that outlive a call and hold no answer (answerStoreBoundary.test.ts), each
 * with what it holds instead. The list only shrinks: a cache of answers is never added here, it is moved onto the store.
 */
export const NOT_ANSWERS: Record<string, Listed> = {
    // ── Requests on their way (routing: which callback or screen an answer goes to, never the answer) ──
    'src/webview/runtime/hostRequests.ts#known': inLayer('requests on their way by id (which slot an answer is for)'),
    'src/webview/runtime/hostRequests.ts#current': inLayer('each slot\'s current request id'),
    'src/webview/runtime/regionPeak.ts#waiting': notAnswer('region peaks on their way by request id: the callback each answer goes to (the answers are kept in the store beside it)'),
    'src/webview/runtime/spectrumRequestScheduler.ts#desired': notAnswer('the latest cursor-spectrum request wanted per track, not yet sent'),
    'src/webview/runtime/entryRedraw.ts#pending': notAnswer('redraws asked for this frame'),
    'src/webview/runtime/entryRedraw.ts#afterwards': notAnswer('callbacks to run after this frame\'s redraws'),
    'src/webview/runtime/staticHost.ts#pendingTreePaths': notAnswer('folder paths whose listing is being read'),
    'src/webview/runtime/entryHeaders.ts#again': notAnswer('paths whose header is to be read again (the file changed on disk); the earlier header shows until the new one is in'),

    // ── Listeners ──
    'src/webview/runtime/layoutSettings.ts#listeners': notAnswer('layout change listeners'),
    'src/webview/runtime/playbackController.ts#listeners': notAnswer('playback change listeners'),
    'src/webview/runtime/runtimeEvents.ts#listeners': notAnswer('runtime event listeners'),
    'src/webview/runtime/staticHost.ts#inboundListeners': notAnswer('host message listeners'),
    'src/webview/runtime/staticHost.ts#waiting': notAnswer('the Worker tasks waiting their turn (loads, scans, figure requests), not their answers'),
    'src/webview/panels/ComparisonPanel.ts#testMessageDisposables': notAnswer('test bridge listeners per panel, to dispose'),

    // ── What is on screen: canvases, drawings, marks, zoom and gestures ──
    'src/webview/runtime/entryRuntime.ts#written': notAnswer('the text last written into each element, to skip unchanged writes'),
    'src/webview/runtime/layoutSettings.ts#canvasSizes': notAnswer('each canvas\'s last size'),
    'src/webview/shell/keyRouter.ts#contexts': notAnswer('keyboard contexts in focus order'),

    // ── Audio ──
    'src/webview/runtime/audioFade.ts#routes': notAnswer('audio nodes per media element'),
    'src/webview/runtime/audioFade.ts#ramps': notAnswer('gain ramps per audio parameter'),
    'src/webview/runtime/audioFade.ts#pendingPauses': notAnswer('pauses waiting for a fade to end'),

    // ── The user's choices and the files open ──
    'src/webview/runtime/entryRuntime.ts#excluded': notAnswer('rows the user took off'),
    'src/webview/runtime/entryRuntime.ts#memo': notAnswer('the user\'s memo per row'),
    'src/webview/runtime/entryRuntime.ts#byKey': notAnswer('the table\'s rows by key, made again when the rows are'),
    'src/webview/runtime/entryRuntime.ts#filtered': notAnswer('rows the filter keeps, made again on each filter change'),
    'src/webview/runtime/selectionSync.ts#hostSelection': notAnswer('the files the host has selected'),
    'src/webview/runtime/selectionSync.ts#awaiting': notAnswer('the files of the last request to analyse that the host has not answered for yet (paths only; the answers are the tracks)'),
    'src/webview/runtime/stepHistory.ts#past': notAnswer('the step bar\'s undo history'),
    'src/webview/runtime/stepHistory.ts#future': notAnswer('the step bar\'s redo history (kept back for an edit taken back, retract)'),
    'src/webview/runtime/trackStore.ts#records': unmigrated('the tracks open: each track\'s answers are its answer slots (range, spectrogram, zoom window, cursor slices); its analysis is the one result the host sent (state.results), which mergeDetailSpectrograms completes with the spectrogram sent later for that analysis, file version and STFT (see NOT_ANSWER_WRITES)'),
    'src/webview/runtime/trackStore.ts#locallyRemovedIds': notAnswer('tracks the user removed, until the host confirms'),
    'src/webview/runtime/trackStore.ts#protocolOrder': notAnswer('the tracks\' order on the protocol'),
    'src/webview/runtime/trackStore.ts#displayOrder': notAnswer('the tracks\' order on screen'),
    'src/webview/runtime/trackStageMode.ts#IMAGE_FRAMES': notAnswer('a constant: the Frame kinds drawn as images'),
    'src/webview/runtime/trackStageMode.ts#FIGURE_FRAMES': notAnswer('a constant: the Frame kinds whose lines the Figure overlays'),
    'src/webview/runtime/trackStageModel.ts#baseAllowed': notAnswer('a constant: the steps a base group may compare'),
    'src/webview/runtime/staticHost.ts#folder': notAnswer('the files of the folder opened in the browser'),
    'src/webview/runtime/staticSources.ts#byMessage': notAnswer('load failures grouped by message, for one notice'),
    'src/webview/runtime/staticDownloads.ts#entries': notAnswer('files of one download being written'),
    'src/webview/panels/ComparisonPanel.ts#testSnapshotsByActionId': notAnswer('test bridge snapshots by action id'),
    'src/webview/panels/ComparisonPanel.ts#resultsByPanel': unmigrated('host side: the analysis results each panel was last sent, to send again on reload'),

    // ── Host side and shared (src/extension, src/shared) ──
    'src/extension/analysisOrchestrator.ts#results': notAnswer('one analysis batch\'s results, returned at its end (the batch is the call)'),
    'src/extension/backendIpc.ts#lines': notAnswer('the lines of one reply being read off the pipe'),
    'src/extension/calibrationPanelRuntime.ts#tracked': notAnswer('the panels whose calibration events are already listened to'),
    'src/extension/calibrationStore.ts#analysisRevisions': notAnswer('each file\'s calibration revision counter: the version part of the track cache\'s key, not an answer'),
    'src/extension/calibrationStore.ts#listeners': notAnswer('calibration change listeners'),
    'src/extension/exportFlows.ts#errors': notAnswer('one export\'s errors, shown at its end'),
    'src/extension/folderStore.ts#cache': notAnswer('the folder\'s saved settings (workspace storage), the user\'s choices'),
    'src/extension/folderStore.ts#writing': notAnswer('writes of the saved settings on their way, one per folder'),
    'src/extension/panelController.ts#sessions': notAnswer('the panels open and their sessions'),
    'src/extension/panelController.ts#calibrationRefreshQueues': notAnswer('per session, the calibration refresh on its way and the next one'),
    'src/extension/panelController.ts#watchers': notAnswer('per session, the folder watchers that say a file changed on disk'),
    'src/extension/panelController.ts#cachedResultsByFilePath': unmigrated('host side: the backend\'s analyses of the files selected (the track cache, handles the backend keeps): each one kept under its calibration revision and analysedUnder (the STFT asked and the file\'s size, ns mtime, ns ctime and inode); one of another is analysed again (hasCachedResult), and a watcher\'s change forgets it (forgetCached)'),
    'src/extension/panelSession.ts#activeResultPaths': notAnswer('the files whose results are on screen, in order'),
    'src/extension/panelSession.ts#cachedUnder': unmigrated('what each cached analysis was made under (analysedUnder), the version half of the track cache\'s key'),
    'src/extension/pythonBackendServer.ts#abandoned': notAnswer('requests given up on whose reply may still come (dropped, not reported)'),
    'src/extension/pythonBackendServer.ts#armOnStart': notAnswer('timeouts to arm once Python starts a request'),
    'src/extension/pythonEnvironment.ts#found': notAnswer('Python interpreters found by one search'),
    'src/extension/pythonEnvironment.ts#seen': notAnswer('interpreter paths already looked at by one search'),
    'src/extension/targetDiscovery.ts#waiting': notAnswer('folders waiting to be read by one discovery'),
    'src/extension/targetDiscovery.ts#reads': notAnswer('one discovery\'s folder listings on their way'),
    'src/shared/analysis/analysisClient.ts#listeners': notAnswer('backend progress listeners'),
    'src/shared/analysis/analysisSession.ts#records': unmigrated('the track cache\'s storage (SourceResults: release on drop), keyed by panelSession as cachedResultsByFilePath says'),
    'src/shared/dataset/asdData.ts#audioIndexes': notAnswer('a dataset\'s audio file index, keyed by the dataset object itself'),
    'src/shared/dataset/csvDiagnostics.ts#positions': notAnswer('row positions of one CSV check'),
    'src/shared/dataset/datasetTable.ts#nameOrder': notAnswer('names\' natural sort order (text only, no answer)'),
    'src/shared/protocol/schemaValidation.ts#REQUEST_ENVELOPE_KEYS': notAnswer('a constant: the request envelope\'s keys'),
    'src/shared/protocol/schemaValidation.ts#RESPONSE_ENVELOPE_KEYS': notAnswer('a constant: the response envelope\'s keys'),
    'src/shared/recipe/recipeOpen.ts#SIDE_STEPS': notAnswer('a constant: steps opened beside the chain'),
    'src/shared/recipe/recipeOpen.ts#PAIR_PICKS': notAnswer('a constant: the pair picks of a step'),
    'src/shared/recipe/recipeSteps.ts#CROSS_CHANNEL': notAnswer('a constant: cross-channel steps'),
    'src/shared/recipe/recipeSteps.ts#NEEDS_TWO_CHANNELS': notAnswer('a constant: steps that need two channels'),
    'src/shared/recipe/recipeSteps.ts#PAIRED_ON_ADD': notAnswer('a constant: steps paired when added'),
    'src/shared/recipe/recipeSteps.ts#SLOT_REFERABLE': notAnswer('a constant: steps a slot may refer to'),
    'src/shared/recipe/recipeSteps.ts#ONE_CHANNEL': notAnswer('a constant: one-channel steps'),
    'src/shared/recipe/recipeSteps.ts#PAIRWISE_FRAMES': notAnswer('a constant: pairwise Frame kinds'),
    'src/shared/recipe/recipeSteps.ts#MENU_HIDDEN': notAnswer('a constant: steps not offered in the menu'),
    'src/shared/session/comparisonSessionController.ts#compareScans': notAnswer('compare scans on their way by request id: which panel each answer goes to'),
    'src/shared/session/comparisonSessionController.ts#lazyInFlight': notAnswer('lazy requests on their way by id: which panel each answer goes to'),
    'src/shared/utils/audioTarget.ts#SUPPORTED_AUDIO_FILE_EXTENSIONS': notAnswer('a constant: audio extensions read'),
    'src/shared/utils/audioTarget.ts#PLAYABLE_AUDIO_FILE_EXTENSIONS': notAnswer('a constant: audio extensions played'),
    'src/shared/utils/directorySelection.ts#paths': notAnswer('one call\'s selected paths, in order'),
    'src/shared/utils/directorySelection.ts#members': notAnswer('one call\'s selected paths, for lookup'),
    'src/shared/utils/exportArtifact.ts#usedNames': notAnswer('names already used by one export'),
};

/** Host answers written into an object's field outside the store, each with why it is not an answer kept there. */
export const NOT_ANSWER_WRITES: Record<string, Listed> = {
    'src/webview/panels/ComparisonPanel.ts#ComparisonPanel.testSnapshot': notAnswer('the test bridge\'s last snapshot, read by the tests only'),
    'src/webview/runtime/entryRuntime.ts#recipeState.standard': notAnswer('the host\'s entry Recipe document, the chain the scans run (not an answer of one)'),
    'src/webview/panels/ComparisonPanel.ts#panel.webview.options': notAnswer('the webview\'s resource roots: the folders of the files analysed, so their audio can be played (no answer kept)'),
    'src/webview/runtime/comparisonRuntime.ts#let pythonEnvironmentState': notAnswer('the host\'s word on the Python environment, replaced by each: a status shown, not an answer of a file'),
    'src/webview/runtime/spectrogramSettingsPopover.ts#let reported': notAnswer('the display range last told to the host, so the same one is not told twice (settings, not an answer)'),
    'src/webview/runtime/spectrogramSettingsStore.ts#this.current.display': notAnswer('the spectrogram\'s display range as the user set it (settings)'),
    'src/webview/runtime/staticHost.ts#appState.spectrogramSettings': notAnswer('the browser host\'s spectrogram settings (settings, not an answer)'),
    'src/webview/runtime/trackStageMode.ts#track.input': notAnswer('a track of this paint (deps.tracks() makes them on each call), named by its step\'s fresh scan'),
    'src/webview/runtime/trackStageMode.ts#state.pendingRegion': notAnswer('the time region the user is dragging (a choice, not an answer)'),
    'src/webview/panels/ComparisonPanel.ts#ComparisonPanel.resultsByPanel.set': unmigrated('host side: the results each panel was last sent, to send again on reload (resultsByPanel)'),
    'src/webview/runtime/staticHost.ts#regions.add': notAnswer('regions of a download in progress'),
    'src/extension/analysisOrchestrator.ts#results.push': notAnswer('one batch\'s results, returned at its end'),
    'src/extension/calibrationStore.ts#next[key]': notAnswer('the calibration profiles being written (the user\'s settings, not an answer)'),
    'src/extension/calibrationStore.ts#latest.channels[channelIndex]': notAnswer('a channel\'s calibration as the user set it (settings)'),
    'src/extension/panelSession.ts#this.cachedResults.set': unmigrated('the host track cache (cachedResultsByFilePath in NOT_ANSWERS): written only with what it was made under (cachedUnder), read only through hasCachedResult'),
    'src/extension/panelSession.ts#this.cachedUnder.set': unmigrated('the version half of the track cache\'s key, written with each result'),
    'src/webview/runtime/staticHost.ts#source.result': unmigrated('the browser host\'s analysis of a file it opened (the host side, as the extension\'s panel results)'),
};

/** answerKey calls that name no file, each with where its versions are instead (answerStoreBoundary.test.ts). */
export const FILELESS_KEYS: Record<string, Listed> = {
    'src/webview/runtime/regionPeak.ts#key': inLayer('the request as sent: each track\'s file, its sourceVersion and its calibration signature (a region\'s peak over several recordings)'),
    'src/webview/runtime/pairSpectrumPanel.ts#pairKey': inLayer('the request as sent: each file\'s sourceVersion, plus each channel\'s calibration signature'),
};

/** createLatestAnswers outside the store, each with what keys its subjects and what makes a value no longer current. */
export const LATEST_ANSWERS: Record<string, Listed> = {
    'src/webview/runtime/comparisonRuntime.ts#shownWindowBands': notAnswer('per track, the band last drawn while one action\'s spectra arrive; made again on each commit'),
    'src/webview/runtime/entryRuntime.ts#calibrations': notAnswer('per file, how many calibration changes the host told of: the epoch in every scan\'s key (fileEpoch)'),
    'src/webview/runtime/entryRuntime.ts#sources': notAnswer('per file, how many changes on disk the watcher told of: the epoch in every scan\'s key (fileEpoch)'),
    'src/webview/runtime/entryHeaders.ts#channelAnswers': unmigrated('per file, its header\'s channels; read again when the file changes on disk (entry-source-changed: the earlier header shows until the new one is in) and failures held by createFailureHold'),
    'src/webview/runtime/entryHeaders.ts#infoAnswers': unmigrated('per file, its header\'s length and sample rate and whether the host has a calibration for it (set again when the host says the calibration changed); read again with channelAnswers'),
    'src/webview/runtime/stageSource.ts#known': inLayer('per file, the basis string last computed (scan condition, calibration, sourceVersion, fileEpoch): the version of the pictures\' keys'),
};

/**
 * Answer sources (a file that calls a maker of answerStore.ts or fetchedSource / fullSource('fetched')) that also
 * schedule with the platform's timers, each with what the timers are for. None of them is a failure's pause or wake:
 * when a failed answer is asked again is the store's (whenFailureEnds, `retried`). The list only shrinks; a new answer
 * source with a timer is not added here, it moves its timing onto the store.
 */
export const SCHEDULING_OWNERS: Record<string, Listed> = {
    'src/webview/runtime/comparisonRuntime.ts': notAnswer('the comparison screen: frames for painting and focus, a range request gathered while scrolling, an export waiting on its pictures'),
    'src/webview/runtime/pairSpectrumPanel.ts': notAnswer('the pair panel: a request gathered while the pointer moves (PAIR_REQUEST_DELAY_MS); its retry is the store\'s `retried`'),
};
