export interface CanvasDirtyState {
    markDirty(trackIndex?: number): void;
    isDirty(trackIndex: number): boolean;
    markClean(trackIndex: number): void;
    /** キャンバス幅変化時の処理。変化あり→true、なし→false */
    handleResize(trackIndex: number, newW: number, height: number): boolean;
    /** オーバーレイ幅変化時の処理。変化あり→true、なし→false */
    handleOverlayResize(newW: number): boolean;
    /** 現在登録されているオフスクリーンキーの一覧（テスト・デバッグ用） */
    offscreenKeys(): string[];
}

export function createCanvasDirtyState(trackCount: number): CanvasDirtyState {
    // undefined = 未初期化（dirty 扱い）, true = dirty, false = clean
    const dirtyFlags = new Map<number, boolean>();
    const widthCache = new Map<number | 'overlay', number>();
    // "trackIndex-W-H" 形式のキーを管理（実際の offscreen は ComparisonPanel 側が持つ）
    const keys = new Set<string>();

    function markDirty(trackIndex?: number): void {
        if (trackIndex === undefined) {
            for (let i = 0; i < trackCount; i++) {
                dirtyFlags.set(i, true);
            }
        } else {
            dirtyFlags.set(trackIndex, true);
        }
    }

    function isDirty(trackIndex: number): boolean {
        const v = dirtyFlags.get(trackIndex);
        // undefined（未初期化）は dirty 扱い
        return v !== false;
    }

    function markClean(trackIndex: number): void {
        dirtyFlags.set(trackIndex, false);
    }

    function handleResize(trackIndex: number, newW: number, height: number): boolean {
        const oldW = widthCache.get(trackIndex);
        if (oldW === newW) { return false; }

        // 旧キーを削除
        if (oldW !== undefined) {
            keys.delete(`${trackIndex}-${oldW}-${height}`);
        }
        widthCache.set(trackIndex, newW);
        keys.add(`${trackIndex}-${newW}-${height}`);
        markDirty(trackIndex);
        return true;
    }

    function handleOverlayResize(newW: number): boolean {
        const oldW = widthCache.get('overlay');
        if (oldW === newW) { return false; }
        widthCache.set('overlay', newW);
        markDirty();
        return true;
    }

    function offscreenKeys(): string[] {
        return Array.from(keys);
    }

    return { markDirty, isDirty, markClean, handleResize, handleOverlayResize, offscreenKeys };
}
