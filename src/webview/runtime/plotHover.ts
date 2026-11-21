/**
 * Where the Tracks rows' readout is shown (R7): in the toolbar's row just above the rows (toolbarHtml), never laid over
 * a plot, so the lines under the pointer stay in view. The readout keeps its room while it is empty, so a hover never
 * moves the plots. (The steps view, the cursor spectrum and the pair plot have a readout in their own header.)
 */
export const PLOT_READOUT_ID = 'plot-readout';
