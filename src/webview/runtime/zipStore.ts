const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

// Stored ZIP keeps WAV output lossless and avoids multiple-download browser permissions.
export function zipStore(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array<ArrayBuffer> {
    const names = entries.map(entry => new TextEncoder().encode(entry.name));
    if (!entries.length || entries.length > 8 || entries.some((entry, i) => /[\\/\u0000]/.test(entry.name) || names[i].length > 65535)
        || entries.reduce((size, entry) => size + entry.bytes.length, 0) > 32 * 1024 * 1024) {
        throw new Error('ZIP exceeds browser export limits');
    }
    const length = entries.reduce((size, entry, i) => size + 30 + names[i].length + entry.bytes.length + 46 + names[i].length, 22);
    const output = new Uint8Array(length);
    const view = new DataView(output.buffer);
    const offsets: number[] = [];
    const checksums: number[] = [];
    let cursor = 0;
    entries.forEach((entry, i) => {
        offsets.push(cursor);
        let crc = 0xffffffff;
        for (const byte of entry.bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
        checksums.push((crc ^ 0xffffffff) >>> 0);
        view.setUint32(cursor, 0x04034b50, true); view.setUint16(cursor + 4, 20, true);
        view.setUint16(cursor + 6, 0x800, true); view.setUint16(cursor + 12, 0x21, true);
        view.setUint32(cursor + 14, checksums[i], true);
        view.setUint32(cursor + 18, entry.bytes.length, true); view.setUint32(cursor + 22, entry.bytes.length, true);
        view.setUint16(cursor + 26, names[i].length, true);
        output.set(names[i], cursor + 30); output.set(entry.bytes, cursor + 30 + names[i].length);
        cursor += 30 + names[i].length + entry.bytes.length;
    });
    const centralStart = cursor;
    entries.forEach((entry, i) => {
        view.setUint32(cursor, 0x02014b50, true); view.setUint16(cursor + 4, 20, true); view.setUint16(cursor + 6, 20, true);
        view.setUint16(cursor + 8, 0x800, true); view.setUint16(cursor + 14, 0x21, true);
        view.setUint32(cursor + 16, checksums[i], true);
        view.setUint32(cursor + 20, entry.bytes.length, true); view.setUint32(cursor + 24, entry.bytes.length, true);
        view.setUint16(cursor + 28, names[i].length, true); view.setUint32(cursor + 42, offsets[i], true);
        output.set(names[i], cursor + 46); cursor += 46 + names[i].length;
    });
    view.setUint32(cursor, 0x06054b50, true);
    view.setUint16(cursor + 8, entries.length, true); view.setUint16(cursor + 10, entries.length, true);
    view.setUint32(cursor + 12, cursor - centralStart, true); view.setUint32(cursor + 16, centralStart, true);
    return output;
}
