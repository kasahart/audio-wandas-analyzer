/**
 * A recording's channel count from the first bytes of its file, without decoding any audio: WAV (RIFF, RF64
 * and their extensible form), FLAC, Ogg (Vorbis, Opus) and MP3. The entry table splits its rows by channel
 * from this as soon as a folder opens, so "ch 2 only" can be chosen before anything is computed.
 */

/** How many bytes are read: enough for the header chunks of every format here, a little cover art before an MP3 frame included. */
export const AUDIO_HEAD_BYTES = 64 * 1024;

/** A header's channel count, and its length when the header says it (WAV, FLAC): what a computation will take is by length. */
export type ChannelProbe = { channels: number; durationS?: number } | { unknown: true } | { error: string };

const text = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));
const u16 = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes: Uint8Array, at: number): number => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const valid = (channels: number): ChannelProbe => (channels >= 1 && channels <= 1024 ? { channels } : { error: `${channels} channels in the header` });

function wav(bytes: Uint8Array): ChannelProbe {
    let format: ChannelProbe | null = null;
    let byteRate = 0;
    for (let at = 12; at + 8 <= bytes.length;) {
        const id = text(bytes, at, 4), size = u32(bytes, at + 4);
        if (id === 'fmt ') {
            if (at + 20 > bytes.length) return { error: 'a cut fmt chunk' };
            format = valid(u16(bytes, at + 10));
            byteRate = u32(bytes, at + 16);
        }
        // The data chunk's size over the byte rate is the length; an RF64 size of 0xFFFFFFFF is in its ds64 chunk (not read).
        if (id === 'data') {
            if (format && 'channels' in format && byteRate > 0 && size !== 0xffffffff) return { ...format, durationS: size / byteRate };
            break;
        }
        // Chunks are word-aligned.
        at += 8 + size + (size % 2);
        // A chunk before fmt (cover art, a long LIST or iXML) can reach past the bytes read; the decoder still reads the file.
        if (at + 8 > bytes.length && bytes.length >= AUDIO_HEAD_BYTES) return { unknown: true };
    }
    return format ?? { error: 'no fmt chunk' };
}

function flac(bytes: Uint8Array): ChannelProbe {
    // fLaC, then STREAMINFO (block type 0): its channel count (minus one) is bits 3–1 of its 13th byte.
    if (bytes.length < 22 || (bytes[4] & 0x7f) !== 0) return { error: 'no STREAMINFO block' };
    const probe = valid(((bytes[20] >> 1) & 0x07) + 1);
    if (!('channels' in probe) || bytes.length < 26) return probe;
    // STREAMINFO: the sample rate (20 bits from byte 18) and the total samples (36 bits from byte 21's low nibble).
    const rate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
    const samples = (bytes[21] & 0x0f) * 2 ** 32 + ((bytes[22] << 24) >>> 0) + (bytes[23] << 16) + (bytes[24] << 8) + bytes[25];
    return rate > 0 && samples > 0 ? { ...probe, durationS: samples / rate } : probe;
}

function ogg(bytes: Uint8Array): ChannelProbe {
    const segments = bytes[26];
    const body = 27 + segments;
    if (text(bytes, body, 7) === '\x01vorbis') return valid(bytes[body + 11]);
    if (text(bytes, body, 8) === 'OpusHead') return valid(bytes[body + 9]);
    return { unknown: true };
}

function mp3(bytes: Uint8Array): ChannelProbe {
    let at = 0;
    if (text(bytes, 0, 3) === 'ID3') {
        // The tag's size is "syncsafe": 7 bits a byte.
        at = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
    }
    for (; at + 4 <= bytes.length; at++) {
        if (bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0 && (bytes[at + 1] & 0x06) !== 0) {
            // Channel mode 3 is mono; stereo, joint stereo and dual channel are two.
            return { channels: (bytes[at + 3] >> 6) === 3 ? 1 : 2 };
        }
    }
    return { unknown: true };
}

/** The channel count in a file's first bytes; `unknown` for a format read here only by its decoder (M4A), `error` when the header is broken. */
export function channelsFromHeader(bytes: Uint8Array, fileName: string): ChannelProbe {
    if (bytes.length >= 12 && (text(bytes, 0, 4) === 'RIFF' || text(bytes, 0, 4) === 'RF64') && text(bytes, 8, 4) === 'WAVE') return wav(bytes);
    if (bytes.length >= 4 && text(bytes, 0, 4) === 'fLaC') return flac(bytes);
    if (bytes.length >= 28 && text(bytes, 0, 4) === 'OggS') return ogg(bytes);
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (extension === '.mp3') return mp3(bytes);
    if (extension === '.wav' || extension === '.flac' || extension === '.ogg') return { error: bytes.length ? `not a ${extension.slice(1).toUpperCase()} header` : 'an empty file' };
    return { unknown: true };
}
