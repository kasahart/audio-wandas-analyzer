/**
 * The webview's half of the time signal's shared test data: what the code before the
 * figure service answered, for python-backend/tests/fixtures/figure_signal_cases.json. Recorded through this call
 * and replayed through it (src/test/figureSignalCases.test.ts): the amplitude
 * axis a time signal's band is drawn on, from every sample's largest magnitude (waveformLayer.waveformRange).
 */

export interface AmplitudeRangeInput { peaks: number[] }

/** A number as the JSON holds it (no number as "nan" / "inf" / "-inf", −0 as 0). */
export const jsonNumber = (value: number): number | string => (Number.isNaN(value) ? 'nan' : value === Infinity ? 'inf' : value === -Infinity ? '-inf' : value + 0);
