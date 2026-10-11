/**
 * Unzoomed waveform amplitude: full scale (|value| = peak) reaches this fraction of the canvas
 * height above and below the centre line, leaving a small margin at the top and bottom.
 * Shared by the renderer and the pointer mapping so drawing and hit-testing agree.
 */
export const WAVEFORM_HALF_HEIGHT_RATIO = 0.44;
