import { zipStore } from './zipStore';

export interface DownloadDeps {
    document: Document;
    URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
    setTimeout: typeof setTimeout;
}

/** A browser cannot write files, so everything the Web version saves becomes a download. */
export interface StaticDownloads {
    bytes(bytes: Uint8Array, name: string, type: string): void;
    text(content: string, name: string, type: string): void;
    /** A report folder as one zip named after it. */
    folder(folder: string, files: Array<{ name: string; bytes: Uint8Array }>): void;
    /** Collects exported WAV regions; one region downloads as itself, several as `selected-regions.zip`. */
    wavRegions(limits: { maxEntries: number; maxBytes: number }): WavRegionDownload;
}

export interface WavRegionDownload {
    add(name: string, wavBase64: string): void;
    /** Downloads what was added; false when nothing was. */
    complete(): boolean;
}

const REPORT_FOLDER_LIMITS = { maxEntries: 16, maxBytes: 64 * 1024 * 1024 };

export function createStaticDownloads({ document, URL, setTimeout }: DownloadDeps): StaticDownloads {
    function bytes(content: Uint8Array, name: string, type: string): void {
        const url = URL.createObjectURL(new Blob([content as Uint8Array<ArrayBuffer>], { type }));
        const link = document.createElement('a'); link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return {
        bytes,
        text: (content, name, type) => { bytes(new TextEncoder().encode(content), name, type); },
        folder: (folder, files) => { bytes(zipStore(files, REPORT_FOLDER_LIMITS), `${folder}.zip`, 'application/zip'); },
        wavRegions(limits) {
            const entries: Array<{ name: string; bytes: Uint8Array }> = [];
            return {
                add: (name, wavBase64) => { entries.push({ name, bytes: Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0)) }); },
                complete(): boolean {
                    const [only] = entries;
                    if (!only) return false;
                    if (entries.length === 1) bytes(only.bytes, only.name, 'audio/wav');
                    else bytes(zipStore(entries, limits), 'selected-regions.zip', 'application/zip');
                    return true;
                },
            };
        },
    };
}
