import { readComparisonBootstrap, type ComparisonWindow } from './browserAdapter';
import { startComparisonRuntime } from './comparisonRuntime';

startComparisonRuntime(readComparisonBootstrap(window as unknown as ComparisonWindow));
