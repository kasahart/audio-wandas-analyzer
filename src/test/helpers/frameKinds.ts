import { INPUT_FRAME, outputOf, WANDAS_OPERATIONS } from '../../shared/recipe/recipeCatalog';

/**
 * Every Frame kind a chain of steps from ＋ can give, from the recording (a ChannelFrame), each with the shortest chain
 * of operations that gives it (the operation catalogue's inputs and outputs, as the step bar offers them).
 */
export function reachableFrameKinds(): Map<string, string[]> {
    const paths = new Map<string, string[]>([[INPUT_FRAME, []]]);
    const queue = [INPUT_FRAME];
    while (queue.length) {
        const frame = queue.shift()!;
        for (const operation of WANDAS_OPERATIONS) {
            const output = outputOf(operation, frame);
            if (!output || paths.has(output)) continue;
            paths.set(output, [...paths.get(frame)!, operation.id]);
            queue.push(output);
        }
    }
    return paths;
}
