---
name: wandas-analyst
description: Use when analyzing audio or vibration signals end-to-end, generating Jupyter Notebook analysis reports, comparing multiple measurement conditions, evaluating noise or sound quality, detecting anomalies in sensor data, or performing adaptive signal investigation driven by hypothesis and findings with wandas.
---

# wandas-analyst: Adaptive Signal Analysis Agent

<SUBAGENT-STOP>
サブエージェントとして呼び出された場合、このスキルのオーケストレーションプロトコルを起動しない。呼び出し元のプロンプトに従う。
</SUBAGENT-STOP>

## Mandatory Rules

1. **Wandas-first**: 全解析に wandas を使う。scipy/numpy の直接実装禁止。
2. **Purpose-first**: 常に「調査目的（北極星）」を最初に確認・保持する。
3. **Diagnostician-first**: 解析前に必ず Diagnostician サブエージェントを実行する。
4. **Synthesis-isolation**: Synthesis Agent には生データを渡さない。発見サマリーのみ。
5. **Notebook JSON**: `.ipynb` ファイルは Write ツールで JSON 直書きする（NotebookEdit ツールは存在しない）。

## 適応型解析プロトコル

固定テンプレートではなく、発見に基づいて調査を進める。

```
固定フロー（旧）: 目的 → テンプレート → レポート
適応型（新）:     目的 → 仮説 → 最小解析 → 発見 → 再仮説 → … → 統合
```

### ステップ

```
Step 1: 調査設計
  ├─ 解析目的を確認（不明なら質問）
  ├─ 初期仮説を立てる（データを見る前に）
  └─ 複数ファイルなら条件・比較軸を定義

Step 2: Diagnostician 実行（1回のみ）
  └─ 信号品質・特徴・推奨解析を確認

Step 3: 調査ラウンドの計画
  └─ Diagnostician 結果＋仮説から最初のラウンドを決定

Step 4: 調査ラウンドループ
  ├─ Analysis Agent に「問い＋解析種別」を与えて呼び出す
  ├─ 返ってきた発見を記録
  └─ 収束判断:
       1. この発見は仮説を支持／否定／拡張するか？
       2. 次に調べる価値があるか？
       3. 目的に対して十分な情報が集まったか？
       → Yes → 次ラウンド or 完了

Step 5: Synthesis Agent 実行（1回のみ）
  └─ 目的＋全発見サマリー（生データなし）から結論を生成

Step 6: Notebook 組み立て
  └─ 固定フレーム＋ラウンドセル＋統合考察を .ipynb JSON で構築
```

## サブエージェント構成

```
Orchestrator (このスキル)
  ├─ Diagnostician  ← 冒頭に1回
  ├─ Analysis Agent ← 調査ラウンドごとに1回
  └─ Synthesis Agent ← 最後に1回
```

---

## Diagnostician プロンプトテンプレート

```
あなたは信号診断エージェントです。以下のファイルを wandas で解析し、信号品質を報告してください。

FILES: {file_paths}

**REQUIRED SUB-SKILL:** wandas-getting-started

タスク:
1. 各ファイルを `wd.read_wav()` または `wd.read_csv()` で読み込む
2. `sampling_rate`, `n_channels`, `duration`, `labels` を確認
3. クリッピング検出: `np.max(np.abs(frame.data))` が最大値の 99% 超
4. DC オフセット: `np.mean(frame.data)` が有意に 0 から離れているか
5. RMS と crest_factor で信号強度を確認

OUTPUT FORMAT（このフォーマットで出力）:
---
SIGNAL_QUALITY:
  file: {filename}
  sr: {Hz}
  channels: {n}
  duration: {s}
  rms: {value}
  issues: [clipping | dc_offset | low_rms | none]

RECOMMENDED_ANALYSES: [temporal, spectral, level, stft, coherence, psycho, comparison]

NOTES: {気になった点}
---
```

---

## Analysis Agent プロンプトテンプレート

```
あなたは信号解析エージェントです。以下の問いに答えてください。

QUESTION: {今回のラウンドで答えたい問い}
ANALYSIS_TYPE: {temporal | spectral | level | stft | coherence | psycho | comparison}
CONTEXT: {前ラウンドの発見サマリー（最初は "初回解析"）}
FILES: {file_paths}
CONDITIONS: {条件の定義（例: file_a = before treatment, file_b = after treatment）}

**REQUIRED SUB-SKILL:** wandas-signal-processing
**REQUIRED SUB-SKILL:** wandas-spectral-analysis
**REQUIRED SUB-SKILL:** wandas-visualization

タスク:
1. 問いに答えるための最小限の解析コードを書く（wandas のみ）
2. 数値サマリーを出力する（plt.show() は不要。コードのみ）
3. 発見を簡潔に記述する

OUTPUT FORMAT（このフォーマットで出力）:
---
CODE:
```python
{解析コード}
```

NUMERICAL_SUMMARY:
{キー指標の数値}

FINDINGS:
- 観察: {グラフ・数値から読めること}
- 解釈: {なぜそうなっているか}
- 示唆: {次に調べるべきこと、または "converged"}
---
```

**解析種別ガイド:**

| `ANALYSIS_TYPE` | 使うメソッド |
|----------------|-------------|
| `temporal` | `.plot()`, `.rms_trend()` |
| `spectral` | `.fft()`, `.welch()`, `.noct_spectrum()` |
| `level` | `.sound_level()` + 統計量 |
| `stft` | `.stft()` → `.plot()` |
| `coherence` | `.coherence()`, `.transfer_function()` |
| `psycho` | `.loudness_zwtv()`, `.roughness_dw()`, `.sharpness_din()` |
| `comparison` | 条件間の差分・比率テーブル |

---

## Synthesis Agent プロンプトテンプレート

```
あなたは信号解析のシンセシスエージェントです。
生データやグラフは見ていません。以下の情報のみに基づいて結論を書いてください。

INVESTIGATION_PURPOSE: {調査目的}
INITIAL_HYPOTHESES: {初期仮説リスト}

FINDINGS_SUMMARY:
Round 1 ({analysis_type}): {findings_text}
Round 2 ({analysis_type}): {findings_text}
...

タスク（必ずこの構造で出力）:
---
## 仮説検証
{各仮説について: 支持/否定/未決 + 根拠}

## 主要な結論
1. {結論}
2. {結論}
...

## 次のステップ
{追加調査の提案}

## 未解決の問い
{答えられなかった問い}
---
```

---

## Notebook 構造

`templates/analysis_report.ipynb` をベースに使用。

### セル構成

```
[固定] Section 0: 調査設計
  ├─ [Markdown] 目的・初期仮説・条件定義
  └─ [Code]     データ読み込み＋Diagnostician 結果

[適応] Investigation Round N:
  ├─ [Markdown] ## Round N: {今回の問い}
  │              - 動機: {前ラウンドからの示唆 or 初期仮説}
  │              - 問い: {このラウンドで答えること}
  ├─ [Code]     解析コード（Analysis Agent の CODE セクション）
  ├─ [Code]     数値サマリー
  └─ [Markdown] ### Findings
  │              - 観察: ...
  │              - 解釈: ...
  │              - 示唆: ...

[固定] Section Final: 統合考察
  ├─ [Markdown] 仮説検証（Synthesis Agent の出力）
  ├─ [Code]     全指標サマリーテーブル・条件間比較
  └─ [Markdown] 結論・次のステップ・未解決の問い
```

### Notebook JSON セル構築パターン

```python
import json
from uuid import uuid4

def md_cell(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "id": str(uuid4())[:8],
        "metadata": {},
        "source": source
    }

def code_cell(source: str) -> dict:
    return {
        "cell_type": "code",
        "id": str(uuid4())[:8],
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": source
    }

# Notebook 組み立て
cells = []
cells.append(md_cell("## Section 0: 調査設計\n\n**目的**: ...\n\n**仮説**: ..."))
cells.append(code_cell("import wandas as wd\nimport numpy as np\n\nsignal = wd.read_wav('audio.wav')\nsignal.info()"))
# ... ラウンドセルを追加 ...

notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.10.0"}
    },
    "cells": cells
}

# ファイルに書き込む（Write ツールを使う）
with open("analysis_report.ipynb", "w") as f:
    json.dump(notebook, f, ensure_ascii=False, indent=2)
```

---

## Common Mistakes

| 間違い | 正解 |
|--------|------|
| Diagnostician をスキップ | 信号品質の問題（クリッピング・DC）を後から発見するのを防ぐ |
| Synthesis Agent に生データを渡す | 発見テキストのサマリーのみを渡す |
| 全解析を1ラウンドで実行 | 各ラウンドは1つの問いに集中する |
| NotebookEdit ツールを使おうとする | 存在しない。Write ツールで .ipynb JSON を直接生成する |
| 収束前に終了 | Synthesis Agent の出力で「未解決の問い」が多い場合は追加ラウンドを検討 |

## Documentation Map

- [`examples/workflows.md`](examples/workflows.md) — 典型的な解析シナリオ（騒音評価・異常検知・条件比較）
- [`templates/analysis_report.ipynb`](templates/analysis_report.ipynb) — Notebook テンプレート
- [`references/notebook_structure.md`](references/notebook_structure.md) — セル構成の詳細
- [`references/subagent_protocol.md`](references/subagent_protocol.md) — サブエージェントのプロトコル詳細

## Required Sub-Skills

**REQUIRED SUB-SKILL:** wandas-getting-started
**REQUIRED SUB-SKILL:** wandas-signal-processing
**REQUIRED SUB-SKILL:** wandas-spectral-analysis
**REQUIRED SUB-SKILL:** wandas-visualization
