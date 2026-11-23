/**
 * Every number the backend's protocol answers with (protocol_schema.py, generated as backendProtocolSchema.ts): the
 * rows of the table it becomes, or why it is never shown. A field the backend starts sending fails the test until it
 * is mapped here.
 */

/** Definitions that carry nothing shown: requests the webview sends, and the backend's own notices and limits. */
export const NOT_SHOWN: readonly RegExp[] = [/Payload$/, /^StftOptions$/, /Notification$/, /Control$/, /^BrowserLimits$/, /^ScanRegion$/, /^ScanReference$/, /^RecipeChannel$/, /^PairSource$/, /^RegionPeakSource$/];

/** A field (`Definition.path`) to the rows it is a value of, or why it is not shown. */
export const SCHEMA_FIELDS: Readonly<Record<string, readonly string[] | string>> = {
    'DbScaleMetadata.referenceValue': "sent with a file's analysis for the old lanes' first picture; a Tracks row is the figure service's picture now and the webview reads none of it; not shown",
    'ChannelMeasurementContext.factor': ['track-header.peak'],
    'ChannelMeasurementContext.referenceValue': ['track-header.peak'],
    'ChannelSummary.peakAbsolute': ['track-header.peak', 'analysis-report.export'],
    'ChannelSummary.peakLevelDb': ['track-header.peak', 'analysis-report.export'],
    'ChannelSummary.rawPeakFullScale': ['track-header.peak', 'analysis-report.export'],
    'AnalysisResult.sampleRateHz': ['track-header.meta'],
    'AnalysisResult.channelCount': ['track-header.meta'],
    'AnalysisResult.durationSeconds': ['time-ruler.ticks', 'analysis-report.export'],
    'AnalysisResult.sampleCount': 'the file\'s sample count; the webview does not read it',
    'AnalysisResult.analysisRevision': 'the analysis revision an answer is of, so a stale answer is dropped; not shown',
    // The same two figures' answers kept by key for the figure service: the reply carries no value of a line.
    'CursorAnswersResult.channels.channelIndex': 'which request or recording an answer belongs to; not shown',
    'CursorAnswersResult.analysisRevision': 'the analysis revision an answer is of, so a stale answer is dropped; not shown',
    'CursorAnswersResult.windowStartNorm': ['track-header.analysis-window'],
    'CursorAnswersResult.windowEndNorm': ['track-header.analysis-window'],
    // A Tracks row's answers kept by key the same way: no value of a lane is in the reply.
    'TrackAnswersResult.channels.channelIndex': 'which request or recording an answer belongs to; not shown',
    'TrackAnswersResult.analysisRevision': 'the analysis revision an answer is of, so a stale answer is dropped; not shown',
    'TrackAnswersResult.sampleRateHz': 'the recording the kept answers are of; no row of the table shows it',
    'TrackAnswersResult.durationSeconds': 'the recording the kept answers are of; no row of the table shows it',
    'TrackAnswersResult.windowSize': 'the STFT the kept levels are of; no row of the table shows it',
    'TrackAnswersResult.hopSize': 'the STFT the kept levels are of; no row of the table shows it',
    'PairAnswersResponse.channelIndex':'which request or recording an answer belongs to; not shown',
    'PairAnswersResponse.analysisRevision': 'the analysis revision an answer is of, so a stale answer is dropped; not shown',
    'PairAnswersResponse.startSeconds': ['pair-view.summary'],
    'PairAnswersResponse.endSeconds': ['pair-view.summary'],
    'PairAnswersResponse.averages': ['pair-view.summary'],
    'PairAnswersResult.channelIndex': 'which request or recording an answer belongs to; not shown',
    'PairAnswersResult.analysisRevision': 'the analysis revision an answer is of, so a stale answer is dropped; not shown',
    'PairAnswersResult.nFft': 'the pair spectrum\'s FFT settings as the backend used them; the webview does not read them',
    'PairAnswersResult.hopLength': 'the pair spectrum\'s FFT settings as the backend used them; the webview does not read them',
    'ExportWavLoopResult.sampleRate': 'the exported WAV\'s rate, written into the file by the host; not shown',
    'RegionPeakResult.peak': 'the largest sample of the compared channels over the region, from every sample: where a new trigger\'s level starts (half of it); a setting\'s default, on no chart',
    'StageView.pair.output': 'a step\'s description (stage_view.py `describe`): which pair, power or event it is of, what the figure\'s spec is made of; not a number a chart shows',
    'StageView.pair.input': 'a step\'s description (stage_view.py `describe`): which pair, power or event it is of, what the figure\'s spec is made of; not a number a chart shows',
    'StageView.measureExponent': 'a step\'s description (stage_view.py `describe`): which pair, power or event it is of, what the figure\'s spec is made of; not a number a chart shows',
    'StageView.events.id': 'a step\'s description (stage_view.py `describe`): which pair, power or event it is of, what the figure\'s spec is made of; not a number a chart shows',
    'StageView.events.time': 'a step\'s description (stage_view.py `describe`): which pair, power or event it is of, what the figure\'s spec is made of; not a number a chart shows',
    'ScanInput.fs': 'what a scan says of the recording it read; the entry shows a file\'s length and rate from its header, and the comparison reads only the level identity (unit, reference); not shown',
    'ScanInput.channels': 'which channels a scan read; the entry counts a file\'s channels from its header (entry-probe); not shown',
    'ScanInput.durationS': 'what a scan says of the recording it read; the entry shows a file\'s length and rate from its header, and the comparison reads only the level identity (unit, reference); not shown',
    'ScanInput.ref': 'what a scan says of the recording it read; the entry shows a file\'s length and rate from its header, and the comparison reads only the level identity (unit, reference); not shown',
    'ScanResult.specVersion': 'the analysis spec a scan was measured by, to tell stale scans; not shown',
    'ScanResult.elapsedMs': 'the backend\'s time for a scan; not shown',
};
