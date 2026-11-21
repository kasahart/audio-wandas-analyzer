

export const METADATA_EXTENSIONS = ['.csv', '.tsv'] as const;

export function baseName(filePath: string): string {
    return filePath.slice(filePath.replace(/\\/g, '/').lastIndexOf('/') + 1);
}

export function isMetadataCandidate(filePath: string): boolean {
    const name = baseName(filePath).toLowerCase();
    return METADATA_EXTENSIONS.some(extension => name.endsWith(extension));
}

/** asd-insight normalizedAudioPath: `/` separators, no leading `./`. */
export function normalizedAudioPath(value: string): string {
    return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}
