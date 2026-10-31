import { readComparisonBootstrap } from './browserAdapter';
import { startComparisonRuntime } from './comparisonRuntime';

startComparisonRuntime(readComparisonBootstrap(window));
