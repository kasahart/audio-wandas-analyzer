export interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
}

export function processStdoutChunk(
    buf: { value: string },
    chunk: string,
    pending: Map<string, PendingRequest>,
): void {
    buf.value += chunk;
    const lines = buf.value.split('\n');
    buf.value = lines.pop() ?? '';
    for (const line of lines) {
        if (!line.trim()) { continue; }
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (msg['type'] === 'ready') { continue; }
        const id = msg['requestId'];
        if (typeof id !== 'string') { continue; }
        const p = pending.get(id);
        if (!p) { continue; }
        pending.delete(id);
        if (typeof msg['error'] === 'string') {
            p.reject(new Error(msg['error']));
        } else {
            p.resolve(msg);
        }
    }
}
