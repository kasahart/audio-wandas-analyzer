/**
 * The types shared by the answer store (what is held, under which key, and whether it is still right) and the figure
 * model (what a figure draws of the answers and what it writes). The answer store gives every answer its identity;
 * the figure model only reads it. Neither decides the other's part.
 */
import type { LevelInput } from './comparePanes';

/** What an answer is of: the file's version, its calibration, the recipe, the region and the analysis condition. */
export interface AnswerIdentity {
    path: string;
    /** The file's version (size, ns mtime, ns ctime, inode). */
    fileVersion: string;
    /** The calibration applied to the file's channels. */
    calibrationSignature: string;
    /** What its levels are in: unit, reference and level reference name, with the calibration status. */
    level: LevelInput;
    /** The full recipe text the answer was computed with. */
    recipeKey: string;
    /** The measured region, in whole samples. */
    region: string;
    /** The analysis condition (table conditionId). */
    conditionId: string;
}

/**
 * The state of one answer: only a ready one is counted or read. A stale one carries the value of an earlier recipe,
 * file version or calibration: it may still be shown (greyed) but is never counted in an n, a median or a Δ.
 */
export type Answer<T> =
    | { state: 'ready'; value: T; identity: AnswerIdentity }
    // Measured (value: shown greyed, never counted) or failed (no value) under an earlier chain or condition.
    | { state: 'stale'; value?: T; identity: AnswerIdentity }
    | { state: 'pending' | 'empty' | 'failed' | 'missing'; identity: AnswerIdentity; retryAt?: number };

export function isReady<T>(answer: Answer<T> | undefined): answer is Extract<Answer<T>, { state: 'ready' }> {
    return answer?.state === 'ready';
}
