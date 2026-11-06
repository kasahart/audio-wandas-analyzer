/** The roles' colours: the base blue, slots 1–3 yellow, purple and magenta; a difference green; a failure orange. */
const DARK_ROLE_COLORS: Readonly<Record<number, string>> = { 0: '#3b82f6', 1: '#d4b20f', 2: '#a371f7', 3: '#e85aad' };
/** The same roles darkened for a light background, each at least 3:1 against it (the yellow is 1.9:1 otherwise). */
export const LIGHT_ROLE_COLORS: Readonly<Record<number, string>> = { 0: '#3b82f6', 1: '#a08300', 2: '#8957e5', 3: '#d0428f' };
export const LIGHT_DIFF_COLOR = '#2f8f3e';
export const ROLE_COLORS: Readonly<Record<number, string>> = { ...DARK_ROLE_COLORS };
export const DIFF_COLOR = '#3fb950';
export const FLAG_COLOR = '#e8833a';
/** A recording without a role: a colour of its own (teal, brown, olive, sand), none of them a role's, the difference's or the failure's. */
const DARK_OWN_COLORS: readonly string[] = ['#2bb3a3', '#b08968', '#8a9a5b', '#c8b79c'];
/** The same, darkened for a light background. */
export const LIGHT_OWN_COLORS: readonly string[] = ['#1a8a7c', '#94704f', '#6f7d44', '#8f7a55'];
export const OWN_COLORS: readonly string[] = [...DARK_OWN_COLORS];
/** The colour of the recording at `index` in the track list while it has no role: it keeps it when the others' roles change. */
export const ownColor = (index: number): string => OWN_COLORS[((index % OWN_COLORS.length) + OWN_COLORS.length) % OWN_COLORS.length];
/** The body classes of a light theme, High Contrast Light included: the canvases and the stylesheet both take the light roles for these. */
export const LIGHT_THEME_BODY_SELECTORS: readonly string[] = ['.vscode-light', '.vscode-high-contrast-light', '[data-theme-kind="light"]'];

/** Switches ROLE_COLORS and OWN_COLORS in place for the theme: every painter reads them when it paints, so a repaint follows the theme. */
export function useLightRoleColors(light: boolean): void {
    Object.assign(ROLE_COLORS as Record<number, string>, light ? LIGHT_ROLE_COLORS : DARK_ROLE_COLORS);
    (OWN_COLORS as string[]).splice(0, OWN_COLORS.length, ...(light ? LIGHT_OWN_COLORS : DARK_OWN_COLORS));
}
