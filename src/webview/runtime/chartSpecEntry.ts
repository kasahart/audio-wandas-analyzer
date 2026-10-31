import type { ChartSpecGlobals } from '../panels/chartSpecDocument';
import { startChartSpecRenderer } from './chartSpecRuntime';

startChartSpecRenderer(window, document, window as Partial<ChartSpecGlobals>);
