# リファクタリング計画

実証ベース・段階的に進める計画。観測された痛みのみを直し、抽象化は 2 回目の重複が出るまで導入しない。

## 指針

1. 観測された痛みのみを直す。仮想の痛みには着手しない。
2. 各 PR が単独で価値を生む（マージしても次に進まなくて良い）。
3. 抽象化は 2 回目の重複が出るまで導入しない。今は構造のみ整える。
4. 逆行可能性を最優先。1 PR は半日以下、レビューしやすい diff。
5. Python は触らない（壊れていないため）。

## 観測された痛み（直す対象）

- (a) `ComparisonPanel.ts` の `renderScript()` が巨大な inline JS テンプレートリテラル
- (b) `webviewTestEnv` の canvas mock が「呼ばれた API しか実装しない」ため新メソッド追加で連鎖失敗
- (c) `waveformRenderer.ts` ↔ `media/comparisonWaveform.js` の二重実装
- (d) E2E ケースに独立性がなく、ケース順入れ替え/挿入が破壊的

## 達成条件

- 「次に同種の変更が来たとき、1 ファイルだけ触れば済む」状態を作る。
- 各ステップ後に既存 9 E2E + 全 unit が green。
- どこまでやって止めるかは ROI で判断する。

---

## ステップ

### Step 1 — canvas mock を Proxy 化（半日）

**対象痛み:** (b)

`src/test/helpers/webviewTestEnv.ts` の DOM canvas mock を Proxy で「呼ばれていない API は no-op、戻り値が必要なものは known テーブル」に変更。

**得るもの:** 描画 API 追加で連鎖失敗ゼロ。今後の作業の地ならし。

### Step 2 — `renderScript()` を新規ファイルに分離（半日）

**対象痛み:** (a) 前半

`ComparisonPanel.ts` から `renderScript()` 関数を `src/webview/comparisonRenderScript.ts` に物理移動（ロジック不変）。

**得るもの:** `ComparisonPanel.ts` が ~500行に縮小、renderScript の直接 import が可能に。

### Step 3 — renderScript 内の描画関数を `webview/draw/` 配下に切り出し（1日）

**対象痛み:** (a)

`drawTrackWaveform / drawSpectrogram / drawSpectrumLine / drawSpectrumAxes / drawCursorOnCanvas` を `(ctx, model)` を取る pure 関数に切り出し。state はクロージャ経由ではなく引数で受ける。

renderScript はファサードとして残し、各関数を呼ぶだけにする。

**得るもの:**
- 各描画関数を import して unit test で直接呼べる（jsdom 不要）
- 入力データに対する出力の一致を検証可能
- 新ビュー追加が局所化される

**撤退条件:** `drawSpectrogram` が状態を多く参照する場合は後回し可。

### Step 4 — waveform 二重実装の解消（1日）

**対象痛み:** (c)

`media/comparisonWaveform.js` を削除し、`waveformRenderer.ts` を webview に直接配信。

実現方法（最小コスト順に試す）:
1. `tsc --module none --outFile` で単一 JS 出力
2. それで不足なら `esbuild` 1 コマンドで bundle 化

**得るもの:** 二重実装が物理的に消える。CI で parity 担保ロジック不要。

### Step 5 — E2E ケースの独立化（半日）

**対象痛み:** (d)

各 E2E ケース冒頭で必要な前提状態を明示的に呼ぶ（`requiresMultiTrack()` 等のヘルパー）。前ケースの暗黙状態に依存しない。

**得るもの:** ケース順序を入れ替えても通る。新規ケース挿入が破壊的でなくなる。

### Step 6（オプション） — 並行作業ハーネス最小版

Step 1–5 完了後に再判断。実際の衝突パターンを観測してから決める:

- 衝突が `comparisonRenderScript.ts` だけで起きるなら → さらに分割
- 衝突が複数モジュールにまたがるなら → state 管理を別ファイル化
- 衝突が発生しないなら → 何もしない

ハーネス系は実証ベースで足す。想像で先回りしない。

---

## やらないリスト

| 項目 | 理由 |
|------|------|
| ports-and-adapters / hex / DI コンテナ | 差し替え先がない |
| Zod ランタイム検証 | 両端同一リポ、tsc strict で十分 |
| OWNERS ファイル | 社会契約は機械強制不可 |
| 視覚回帰テスト（pixelmatch 等） | flaky、本当に必要になってから |
| Python backend 再構成 | 壊れていない |
| `app/` ユースケース層 | 単一画面アプリには過剰 |
| ADR テンプレート整備 | 書く文化が育ってから |
| webview esbuild フル バンドル化 | Step 4 で最小コストで済むなら不要 |
| per-worktree `.venv` | 実害なし |
| カスタム CI ルール（lint-ownership 等） | 守るべきルールが具体化してから |

---

## テスト戦略

| レイヤ | テスト方針 |
|--------|----------|
| Step 3 で切り出した pure 描画関数 | 入力 → 出力の決定論的 unit test（Proxy mock で十分） |
| `comparisonRenderScript.ts` | jsdom 統合テスト（現行を維持） |
| webview ↔ extension IPC | 型共有のみ（runtime validate しない） |
| E2E | Step 5 で独立化、現行 9 ケースをそのまま走らせる |
| 視覚 | 手動確認 + Step 3 の構造的 assert（pixel diff は導入しない） |

---

## ROI 判断

| Step | コスト | 直接得るもの | 次を可能にするか |
|------|--------|------|---------|
| 1 | 半日 | mock fragility 解消 | 単独完結 |
| 2 | 半日 | renderScript の import が可能 | Step 3 の前提 |
| 3 | 1 日 | 描画の unit test 化、新ビュー追加が局所化 | 並行開発の実質的解放 |
| 4 | 1 日 | 二重実装の物理消滅 | 単独完結 |
| 5 | 半日 | E2E の独立性 | 単独完結 |
| 6 | 観測待ち | 必要性が判明してから | – |

合計 ~3.5 日で「並行開発に耐える最低限の構造」に到達。これ以上の投資は実際の衝突を観測してから判断する。
