/**
 * Short synthetic recordings to try the app with when no audio is at hand: one machine hum, the same hum with a
 * tonal whine, and the same hum with periodic clicks. All three share the same noise, so comparing them shows only
 * the added fault. They are built on the page (no files are shipped) as 16-bit mono WAV.
 */
export const SAMPLE_RATE_HZ = 16000;
export const SAMPLE_SECONDS = 4;

export interface SampleRecording {
    name: string;
    bytes: Uint8Array;
}

/** A small deterministic generator, so every visitor gets the same recordings. */
function noise(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}

/** The hum every sample shares: a 120 Hz fundamental with falling harmonics over low-passed noise. */
function hum(length: number): Float64Array {
    const out = new Float64Array(length);
    const random = noise(1);
    let lowPassed = 0;
    for (let n = 0; n < length; n++) {
        const t = n / SAMPLE_RATE_HZ;
        let tone = 0;
        for (let k = 1; k <= 6; k++) tone += Math.sin(2 * Math.PI * 120 * k * t + k) / (k * k);
        lowPassed += 0.2 * (random() - lowPassed);
        out[n] = 0.12 * tone + 0.1 * lowPassed;
    }
    return out;
}

function withWhine(base: Float64Array): Float64Array {
    return base.map((value, n) => value + 0.02 * Math.sin(2 * Math.PI * 2800 * n / SAMPLE_RATE_HZ));
}

/** A 4 kHz ring of 10 ms every half second. */
function withClicks(base: Float64Array): Float64Array {
    const every = SAMPLE_RATE_HZ / 2;
    return base.map((value, n) => {
        const since = (n % every) / SAMPLE_RATE_HZ;
        return value + 0.3 * Math.exp(-since / 0.002) * Math.sin(2 * Math.PI * 4000 * since);
    });
}

export function wavBytes(samples: Float64Array, sampleRate = SAMPLE_RATE_HZ): Uint8Array {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string): void => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((value, n) => view.setInt16(44 + n * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true));
    return bytes;
}

export function sampleRecordings(): SampleRecording[] {
    const base = hum(SAMPLE_RATE_HZ * SAMPLE_SECONDS);
    return [
        { name: 'sample-1-hum.wav', bytes: wavBytes(base) },
        { name: 'sample-2-hum-whine-2800Hz.wav', bytes: wavBytes(withWhine(base)) },
        { name: 'sample-3-hum-clicks-2-per-s.wav', bytes: wavBytes(withClicks(base)) },
    ];
}
