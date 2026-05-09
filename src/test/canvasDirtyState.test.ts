import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasDirtyState } from '../panels/canvasDirtyState';

test('初期状態は dirty 扱い（undefined !== false）', () => {
    const s = createCanvasDirtyState(2);
    assert.ok(s.isDirty(0), 'track 0 は初期状態で dirty 扱いであること');
    assert.ok(s.isDirty(1), 'track 1 は初期状態で dirty 扱いであること');
});

test('markDirty(i) で特定トラックのみ dirty になる', () => {
    const s = createCanvasDirtyState(2);
    s.markClean(0);
    s.markClean(1);
    s.markDirty(0);
    assert.equal(s.isDirty(0), true);
    assert.equal(s.isDirty(1), false);
});

test('markDirty() 引数なしで全トラック dirty になる', () => {
    const s = createCanvasDirtyState(2);
    s.markClean(0);
    s.markClean(1);
    s.markDirty();
    assert.equal(s.isDirty(0), true);
    assert.equal(s.isDirty(1), true);
});

test('markClean で dirty が解除される', () => {
    const s = createCanvasDirtyState(1);
    s.markDirty(0);
    s.markClean(0);
    assert.equal(s.isDirty(0), false);
});

test('同幅リサイズは何もしない', () => {
    const s = createCanvasDirtyState(1);
    // 初回で幅を確定させ、描画完了（clean）にする
    const first = s.handleResize(0, 800, 80);
    assert.equal(first, true, '初回は変化あり');
    s.markClean(0);
    // 同幅リサイズは no-op
    const second = s.handleResize(0, 800, 80);
    assert.equal(second, false, '同幅は変化なし');
    assert.equal(s.isDirty(0), false, '同幅では dirty にならない');
});

test('[回帰 A] リサイズで dirty フラグが立つ', () => {
    const s = createCanvasDirtyState(1);
    s.handleResize(0, 800, 80);
    s.markClean(0);
    assert.equal(s.isDirty(0), false, '前提: clean 状態');
    s.handleResize(0, 600, 80);
    assert.equal(s.isDirty(0), true, 'リサイズ後は dirty であること');
});

test('[回帰 B] リサイズで旧オフスクリーンキーが削除される', () => {
    const s = createCanvasDirtyState(1);
    s.handleResize(0, 800, 80);
    const keysBefore = s.offscreenKeys();
    assert.ok(keysBefore.includes('0-800-80'), '前提: 旧キーが存在する');
    s.handleResize(0, 600, 80);
    const keysAfter = s.offscreenKeys();
    assert.ok(!keysAfter.includes('0-800-80'), '旧キーが削除されていること');
    assert.ok(keysAfter.includes('0-600-80'), '新キーが登録されていること');
});

test('[回帰 C] オーバーレイリサイズで全トラック dirty になる', () => {
    const s = createCanvasDirtyState(2);
    s.markClean(0);
    s.markClean(1);
    s.handleOverlayResize(600);
    assert.equal(s.isDirty(0), true, 'track 0 が dirty');
    assert.equal(s.isDirty(1), true, 'track 1 が dirty');
});

test('オーバーレイ同幅リサイズは dirty にしない', () => {
    const s = createCanvasDirtyState(1);
    s.handleOverlayResize(800);
    s.markClean(0);
    s.handleOverlayResize(800);
    assert.equal(s.isDirty(0), false, '同幅では dirty にならない');
});

test('[シナリオ] ズーム完了 → リサイズ → 再描画フロー', () => {
    const s = createCanvasDirtyState(1);
    // 1. ズーム後の描画完了
    s.handleResize(0, 800, 80);
    s.markClean(0);
    assert.equal(s.isDirty(0), false, 'ズーム完了後は clean');

    // 2. ウィンドウリサイズ
    s.handleResize(0, 600, 80);
    assert.equal(s.isDirty(0), true, 'リサイズ後は dirty（再描画が必要）');

    // 3. 再描画完了
    s.markClean(0);
    assert.equal(s.isDirty(0), false, '再描画後は clean');
});
