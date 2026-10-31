/** The roles' colours: the base blue, slots 1–3 yellow, purple and magenta; a difference green; a failure orange; no role grey. */
const DARK_ROLE_COLORS: Readonly<Record<number, string>> = { 0: '#3b82f6', 1: '#d4b20f', 2: '#a371f7', 3: '#e85aad' };
/** The same roles darkened for a light background, each at least 3:1 against it (the yellow is 1.9:1 otherwise). */
export const LIGHT_ROLE_COLORS: Readonly<Record<number, string>> = { 0: '#3b82f6', 1: '#a08300', 2: '#8957e5', 3: '#d0428f' };
export const LIGHT_DIFF_COLOR = '#2f8f3e';
export const ROLE_COLORS: Readonly<Record<number, string>> = { ...DARK_ROLE_COLORS };
export const DIFF_COLOR = '#3fb950';
export const FLAG_COLOR = '#e8833a';
export const NO_ROLE_COLOR = '#8b949e';
/** The body classes of a light theme, High Contrast Light included: the canvases and the stylesheet both take the light roles for these. */
export const LIGHT_THEME_BODY_SELECTORS: readonly string[] = ['.vscode-light', '.vscode-high-contrast-light', '[data-theme-kind="light"]'];

/** Switches ROLE_COLORS in place for the theme: every painter reads it when it paints, so a repaint follows the theme. */
export function useLightRoleColors(light: boolean): void {
    Object.assign(ROLE_COLORS as Record<number, string>, light ? LIGHT_ROLE_COLORS : DARK_ROLE_COLORS);
}
