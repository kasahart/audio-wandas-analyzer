/**
 * The plots' shared layout constants. A leaf module: stagePanes and comparePanes import each other, so a constant read
 * while a module loads lives here, where it is defined whichever of them loads first.
 */

/** The width of a plot's left gutter (its value axis), px. */
export const PANE_LEFT = 52;
