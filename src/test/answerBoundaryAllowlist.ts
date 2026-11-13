/**
 * Why a place is listed, in one of three kinds:
 * - notAnswer: it holds no answer (a request on its way, a drawing, a listener, a constant, the user's choice);
 * - inLayer: it is the layer's own implementation or goes through the store (its key and states are the store's);
 * - unmigrated: it keeps answers outside the store still, with its own key rules. Their number is UNMIGRATED_CEILING,
 *   which only goes down: a new one fails the test, and one moved onto the store lowers it.
 */
export type ListedKind = 'not-answer' | 'in-layer' | 'unmigrated';
export interface Listed { readonly kind: ListedKind; readonly why: string }
export const notAnswer = (why: string): Listed => ({ kind: 'not-answer', why });
const inLayer = (why: string): Listed => ({ kind: 'in-layer', why });
const unmigrated = (why: string): Listed => ({ kind: 'unmigrated', why });

/** How many listed places still keep answers outside the store (kind unmigrated): it only goes down. */
export const UNMIGRATED_CEILING = 19;

/**
 * The collections outside answerStore.ts that outlive a call and hold no answer (answerStoreBoundary.test.ts), each
 * with what it holds instead. The list only shrinks: a cache of answers is never added here, it is moved onto the store.
 */
export const NOT_ANSWERS: Record<string, Listed> = {
    // ── Requests on their way (routing: which callback or screen an answer goes to, never the answer) ──
    'src/webview/runtime/combineSource.ts#asked': notAnswer('the combinations on their way by request id, to route each answer to its key'),
    'src/webview/runtime/hostRequests.ts#known': inLayer('requests on their way by id (which slot an answer is for)'),
    'src/webview/runtime/hostRequests.ts#current': inLayer('each slot\'s current request id'),
    'src/webview/runtime/laneReads.ts#waiting': notAnswer('reads on their way by request id: the callback each answer goes to'),
    'src/webview/runtime/stageReader.ts#waiting': notAnswer('reads on their way by request id: the callback each answer goes to'),
    'src/webview/runtime/fullRead.ts#waiting': notAnswer('readers to call once a read on its way is in'),
    'src/webview/runtime/staticWorker.ts#replies': notAnswer('worker calls on their way by id: the callback each reply goes to'),
    'src/webview/runtime/spectrumRequestScheduler.ts#desired': notAnswer('the latest cursor-spectrum request wanted per track, not yet sent'),
    'src/webview/runtime/entryRedraw.ts#pending': notAnswer('redraws asked for this frame'),
    'src/webview/runtime/entryRedraw.ts#afterwards': notAnswer('callbacks to run after this frame\'s redraws'),
    'src/webview/runtime/staticHost.ts#pendingTreePaths': notAnswer('folder paths whose listing is being read'),

    // ── Listeners ──
    'src/webview/runtime/layoutSettings.ts#listeners': notAnswer('layout change listeners'),
    'src/webview/runtime/playbackController.ts#listeners': notAnswer('playback change listeners'),
    'src/webview/runtime/runtimeEvents.ts#listeners': notAnswer('runtime event listeners'),
    'src/webview/runtime/staticHost.ts#inboundListeners': notAnswer('host message listeners'),
    'src/webview/panels/ComparisonPanel.ts#testMessageDisposables': notAnswer('test bridge listeners per panel, to dispose'),

    // ── What is on screen: canvases, drawings, marks, zoom and gestures ──
    'src/webview/runtime/comparisonRuntime.ts#lanePlots': notAnswer('each lane canvas\'s last drawing, for its pointer readout'),
    'src/webview/runtime/comparisonRuntime.ts#spectrogramPlots': notAnswer('each spectrogram canvas\'s last drawing, for its pointer readout'),
    'src/webview/runtime/comparisonRuntime.ts#spectrogramRasterCache': notAnswer('pixels of a lane\'s spectrogram drawn (by track, channel and theme), let go with the track\'s analysis'),
    'src/webview/runtime/entryDistributionPane.ts#plots': notAnswer('each distribution element\'s last drawing, for its pointer readout'),
    'src/webview/runtime/entryDistribution.ts#layers': notAnswer('a distribution row\'s layers as drawn, kept with the row so a click names the layer its readout read (DistributionRow.clickOf)'),
    'src/webview/runtime/entryDistribution.ts#clicks': notAnswer('what a click on each of a distribution row\'s layers acts on (a recording, a bin), kept with the row\'s drawing (DistributionRow.clickOf)'),
    'src/webview/runtime/entryPlots.ts#overviewCache': notAnswer('each overview canvas\'s drawing, redrawn when its rows key changes'),
    'src/webview/runtime/entryTableHtml.ts#linesOf': notAnswer('a table view\'s lines, keyed by the view object itself'),
    'src/webview/runtime/entrySidePlots.ts#windows': notAnswer('each side plot\'s zoom window'),
    'src/webview/runtime/entrySidePlots.ts#levels': unmigrated('the store\'s levels of the most common reference only, made again on every change to them (version)'),
    'src/webview/runtime/entrySidePlots.ts#windowKeys': notAnswer('what each side plot\'s zoom window was set for'),
    'src/webview/runtime/pairSpectrumPanel.ts#drawn': notAnswer('each pair plot\'s last drawing, for the pointer and gestures'),
    'src/webview/runtime/pairSpectrumPanel.ts#levelWindow': notAnswer('each pair plot\'s level zoom'),
    'src/webview/runtime/pairSpectrumPanel.ts#marks': notAnswer('each pair plot\'s hover marks layer'),
    'src/webview/runtime/plotHoverLayer.ts#filled': notAnswer('hover mark elements in use'),
    'src/webview/runtime/stagePanes.ts#settledOrders': notAnswer('the order lines were last drawn in, per picture set'),
    'src/webview/runtime/stagePanes.ts#recorded': notAnswer('drawings already reported to the test bridge'),
    'src/webview/runtime/stagePanes.ts#paintedGenerations': notAnswer('each canvas\'s paint generation'),
    'src/webview/runtime/stagePanes.ts#fulls': notAnswer('one hover read\'s points per line (within the call; its callback is run at once)'),
    'src/webview/runtime/entryRuntime.ts#written': notAnswer('the text last written into each element, to skip unchanged writes'),
    'src/webview/runtime/trackStageMode.ts#laneDetail': notAnswer('one draw\'s detail specs per lane (the pictures are the stage source\'s)'),
    'src/webview/runtime/trackStageMode.ts#drawnOn': notAnswer('what each stage element last drew'),
    'src/webview/runtime/trackCanvasPainter.ts#laneWaveforms': notAnswer('a waveform\'s lane drawing, keyed by the envelope object itself'),
    'src/webview/runtime/trackCanvasPainter.ts#laneMatrices': notAnswer('a spectrogram\'s matrix for drawing, keyed by the spectrogram object itself'),
    'src/webview/plot/waveformLayer.ts#envelopes': notAnswer('a waveform\'s envelope on an axis, keyed by the waveform object itself'),
    'src/webview/runtime/layoutSettings.ts#canvasSizes': notAnswer('each canvas\'s last size'),
    'src/webview/runtime/keyRouter.ts#contexts': notAnswer('keyboard contexts in focus order'),
    'src/webview/runtime/stageDetail.ts#asked': notAnswer('the detail ranges a zoom asked for (to pick one that covers the view); their pictures are the stage source\'s'),

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
    'src/webview/runtime/stepHistory.ts#past': notAnswer('the step bar\'s undo history'),
    'src/webview/runtime/stepHistory.ts#future': notAnswer('the step bar\'s redo history (kept back for an edit taken back, retract)'),
    'src/webview/runtime/trackStore.ts#records': unmigrated('the tracks open: each track\'s answers are its answer slots (range, spectrogram, zoom window, cursor slices); its analysis is the one result the host sent (state.results), which mergeDetailSpectrograms completes with the spectrogram sent later for that analysis, file version and STFT (see NOT_ANSWER_WRITES)'),
    'src/webview/runtime/trackStore.ts#locallyRemovedIds': notAnswer('tracks the user removed, until the host confirms'),
    'src/webview/runtime/trackStore.ts#protocolOrder': notAnswer('the tracks\' order on the protocol'),
    'src/webview/runtime/trackStore.ts#displayOrder': notAnswer('the tracks\' order on screen'),
    'src/webview/runtime/trackStageMode.ts#IMAGE_FRAMES': notAnswer('a constant: the Frame kinds drawn as images'),
    'src/webview/runtime/trackStageModel.ts#baseAllowed': notAnswer('a constant: the steps a base group may compare'),
    'src/webview/runtime/staticHost.ts#folder': notAnswer('the files of the folder opened in the browser'),
    'src/webview/runtime/staticSources.ts#byMessage': notAnswer('load failures grouped by message, for one notice'),
    'src/webview/runtime/staticWorker.ts#loaded': notAnswer('packages loaded in the worker'),
    'src/webview/runtime/staticDownloads.ts#entries': notAnswer('files of one download being written'),
    'src/webview/panels/ComparisonPanel.ts#testSnapshotsByActionId': notAnswer('test bridge snapshots by action id'),
    'src/webview/panels/ComparisonPanel.ts#resultsByPanel': unmigrated('host side: the analysis results each panel was last sent, to send again on reload'),

    // ── Host side and shared (src/extension, src/shared) ──
    'src/webview/runtime/laneReads.ts#values': inLayer('the reads of one call handed to the store at once (ready of each), not kept by this file'),
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
    'src/webview/runtime/entryRuntime.ts#recipeState.knownRate': notAnswer('the folder\'s sample rate read off the scans, for checking steps (no number shown)'),
    'src/webview/runtime/entryRuntime.ts#recipeState.standard': notAnswer('the host\'s entry Recipe document, the chain the scans run (not an answer of one)'),
    'src/webview/runtime/entryTable.ts#row.reason': notAnswer('a table row built in one call from the scans as they are'),
    'src/webview/runtime/entryTable.ts#row.mismatch': notAnswer('a table row built in one call from the scans as they are'),
    'src/webview/runtime/entryTable.ts#row.durationS': notAnswer('a table row built in one call from the scans as they are'),
    'src/webview/runtime/entryTable.ts#row.values': notAnswer('a table row built in one call from the scans as they are'),
    'src/webview/runtime/entryTable.ts#row.levels': notAnswer('a table row built in one call from the scans as they are'),
    'src/webview/panels/ComparisonPanel.ts#panel.webview.options': notAnswer('the webview\'s resource roots: the folders of the files analysed, so their audio can be played (no answer kept)'),
    'src/webview/runtime/comparisonRuntime.ts#let pythonEnvironmentState': notAnswer('the host\'s word on the Python environment, replaced by each: a status shown, not an answer of a file'),
    'src/webview/runtime/entryHeldPlot.ts#hold.plot': notAnswer('what the held plot drew last, for its pointer readout (made again on each paint)'),
    'src/webview/runtime/entryRuntime.ts#let rows': notAnswer('the table\'s rows, made again from the answers as they are (answerStore) on each rebuild'),
    'src/webview/runtime/entryRuntime.ts#let shownRows': notAnswer('the rows through the filters, made again from `rows` on each rebuild'),
    'src/webview/runtime/fullRead.ts#let next': notAnswer('the pointer\'s latest read asked while one is on its way (a request, not its answer)'),
    'src/webview/runtime/fullRead.ts#let nextLevel': notAnswer('the latest level read asked while one is on its way (a request, not its answer)'),
    'src/webview/runtime/lazyResponses.ts#target[channelIndex].spectrogram': unmigrated('the whole file\'s spectrogram sent after its analysis completes that analysis (state.results): written only once the answer passed the one gate of the file version and the STFT the backend computed with (trackIdAtProtocolBoundary, isOfShownVersion) and is the answer to the slot\'s request (isResponseToLazyRequest); let go with the track\'s analysis (releaseTrackDetail)'),
    'src/webview/runtime/spectrogramSettingsPopover.ts#let reported': notAnswer('the display range last told to the host, so the same one is not told twice (settings, not an answer)'),
    'src/webview/runtime/spectrogramSettingsStore.ts#this.current.display': notAnswer('the spectrogram\'s display range as the user set it (settings)'),
    'src/webview/runtime/staticHost.ts#appState.spectrogramSettings': notAnswer('the browser host\'s spectrogram settings (settings, not an answer)'),
    'src/webview/runtime/trackStageMode.ts#track.input': notAnswer('a track of this paint (deps.tracks() makes them on each call), named by its step\'s fresh scan'),
    'src/webview/runtime/trackStageMode.ts#state.pendingRegion': notAnswer('the time region the user is dragging (a choice, not an answer)'),
    'src/webview/panels/ComparisonPanel.ts#ComparisonPanel.resultsByPanel.set': unmigrated('host side: the results each panel was last sent, to send again on reload (resultsByPanel)'),
    'src/webview/plot/waveformLayer.ts#envelopes.set': notAnswer('an envelope drawn, keyed by the waveform object itself (a new answer is a new key)'),
    'src/webview/runtime/staticHost.ts#regions.add': notAnswer('regions of a download in progress'),
    'src/webview/runtime/trackCanvasPainter.ts#laneWaveforms.set': notAnswer('a lane drawing keyed by the envelope object itself (a new answer is a new key)'),
    'src/webview/runtime/trackCanvasPainter.ts#laneMatrices.set': notAnswer('a drawing matrix keyed by the spectrogram object itself (a new answer is a new key)'),
    'src/webview/runtime/trackStageMode.ts#laneDetail.set': notAnswer('one draw\'s detail specs per lane (the pictures are the stage source\'s)'),
    'src/webview/runtime/trackStagePainter.ts#frame.drawnOn.set': notAnswer('what each element last drew'),
    'src/webview/runtime/triggerLanes.ts#frame.drawnOn.set': notAnswer('what each element last drew'),
    'src/extension/analysisOrchestrator.ts#results.push': notAnswer('one batch\'s results, returned at its end'),
    'src/extension/calibrationStore.ts#next[key]': notAnswer('the calibration profiles being written (the user\'s settings, not an answer)'),
    'src/extension/calibrationStore.ts#latest.channels[channelIndex]': notAnswer('a channel\'s calibration as the user set it (settings)'),
    'src/extension/panelSession.ts#this.cachedResults.set': unmigrated('the host track cache (cachedResultsByFilePath in NOT_ANSWERS): written only with what it was made under (cachedUnder), read only through hasCachedResult'),
    'src/extension/panelSession.ts#this.cachedUnder.set': unmigrated('the version half of the track cache\'s key, written with each result'),
    'src/shared/analysis/entryMetadata.ts#rows[filePath]': notAnswer('rows of one CSV being built'),
    'src/shared/analysis/entryScan.ts#index[filePath]': unmigrated('the saved scan index being read (readIndex): an entry is used only under the file\'s identity, the analysis spec and wandas version, calibration and recipe'),
    'src/shared/analysis/entryScan.ts#kept[filePath]': unmigrated('the saved scan index being written: each entry with the identity, spec, calibration and recipe it was scanned under'),
    'src/shared/recipe/channelSelection.ts#picked.input': notAnswer('one call\'s picked channel'),
    'src/webview/runtime/staticHost.ts#source.result': unmigrated('the browser host\'s analysis of a file it opened (the host side, as the extension\'s panel results)'),
};

/** answerKey calls that name no file, each with where its versions are instead (answerStoreBoundary.test.ts). */
export const FILELESS_KEYS: Record<string, Listed> = {
    'src/webview/runtime/combineSource.ts#key': inLayer('the backend\'s data keys (each a hash of the file version, Recipe, region, channels, calibration and step)'),
    'src/webview/runtime/combineSource.ts#combineKey': inLayer('the backend\'s data keys (each a hash of the file version, Recipe, region, channels, calibration and step)'),
    'src/webview/runtime/fullRead.ts#keyOf': inLayer('the source it is kept in: one per track and channel (laneReads) or per data key (stageReader), itself kept under the file version'),
    'src/webview/runtime/pairSpectrumPanel.ts#pairKey': inLayer('the request as sent: each file\'s sourceVersion, plus each channel\'s calibration signature'),
    'src/webview/runtime/stageReader.ts#source': inLayer('the backend\'s data keys of the two Frames read'),
};

/** createLatestAnswers outside the store, each with what keys its subjects and what makes a value no longer current. */
export const LATEST_ANSWERS: Record<string, Listed> = {
    'src/webview/runtime/comparisonRuntime.ts#rangeLandedAskedAt': notAnswer('per lane, when its drawn range was asked (a time, not an answer); a lane let go is forgotten'),
    'src/webview/runtime/comparisonRuntime.ts#shownWindowBands': notAnswer('per track, the band last drawn while one action\'s spectra arrive; made again on each commit'),
    'src/webview/runtime/entryHeldPlot.ts#binsAskedFor': notAnswer('per spec and file, the table spectrum the bins were asked with (a request); the bins are the stage source\'s'),
    'src/webview/runtime/entryRuntime.ts#calibrations': notAnswer('per file, how many calibration changes the host told of: the epoch in every scan\'s key (fileEpoch)'),
    'src/webview/runtime/entryRuntime.ts#sources': notAnswer('per file, how many changes on disk the watcher told of: the epoch in every scan\'s key (fileEpoch)'),
    'src/webview/runtime/entryScanQueue.ts#channelAnswers': unmigrated('per file, its header\'s channels; forgotten when the file changes on disk (entry-source-changed) and failures held by createFailureHold'),
    'src/webview/runtime/entryScanQueue.ts#durationAnswers': unmigrated('per file, its header\'s length; forgotten with channelAnswers'),
    'src/webview/runtime/entrySidePlots.ts#levels': unmigrated('per row, levels of the store\'s fresh scans, made again when a scan replaces them (scanned)'),
    'src/webview/runtime/entrySidePlots.ts#scanned': unmigrated('per recording, the rows of `levels` it made, so a replacing scan removes all of them'),
    'src/webview/runtime/entrySidePlots.ts#ownMarks': unmigrated('per fresh recording, its reference mark, made again with the folder reference (shared.version)'),
    'src/webview/runtime/stageSource.ts#known': inLayer('per file, the basis string last computed (scan condition, calibration, sourceVersion, fileEpoch): the version of the pictures\' keys'),
    'src/webview/runtime/trackStore.ts#spectrumSliceCache': unmigrated('per cursor time, a slice of one track\'s analysis; let go with the track record (a new analysis is a new record)'),
};
