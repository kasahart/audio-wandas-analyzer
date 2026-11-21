/** Where a channel's Figure goes (screens/trackRows.ts): its waveform and spectrogram lanes in one box. */
export function trackRowFigureId(trackIndex: number, channelIndex: number): string {
    return 'track-row-figure-' + trackIndex + (channelIndex === 0 ? '' : '-' + channelIndex);
}
