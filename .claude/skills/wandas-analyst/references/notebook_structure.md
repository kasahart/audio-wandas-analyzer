# wandas-analyst: Notebook Structure Guide

## .ipynb ファイルの JSON 構造

```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {
    "kernelspec": {
      "display_name": "Python 3",
      "language": "python",
      "name": "python3"
    },
    "language_info": {
      "name": "python",
      "version": "3.10.0"
    }
  },
  "cells": [...]
}
```

## セルの JSON 形式

### Markdown セル
```json
{
  "cell_type": "markdown",
  "id": "a1b2c3d4",
  "metadata": {},
  "source": "## Section 0: 調査設計\n\n**目的**: ..."
}
```

### コードセル
```json
{
  "cell_type": "code",
  "id": "e5f6g7h8",
  "metadata": {},
  "execution_count": null,
  "outputs": [],
  "source": "import wandas as wd\nimport numpy as np\n\nsignal = wd.read_wav('audio.wav')"
}
```

**注意:**
- `source` は改行込みの文字列（配列でも可）
- `id` は8文字程度のユニークな文字列
- `outputs` は空配列（未実行状態）

## セクション構成

### Section 0: 調査設計（固定）

```markdown
## 調査設計

### 目的
{調査で答えたい問い}

### 初期仮説
1. {仮説1}
2. {仮説2}

### データ
| ファイル | 条件 | 備考 |
|---------|------|------|
| file_a.wav | {条件A} | ... |
| file_b.wav | {条件B} | ... |
```

続けてコードセルで読み込み＋Diagnostician 結果を表示。

### Round N セル（適応ループ）

```markdown
## Round {N}: {ラウンドの見出し}

**動機**: {前ラウンドの示唆 or 初期仮説から}
**問い**: {このラウンドで答えること}
```

→ コードセル（解析コード）
→ コードセル（数値サマリー）

```markdown
### Findings

**観察**: {グラフ・数値から読めること}

**解釈**: {なぜそうなっているか}

**示唆**: {次に調べるべきこと}
```

### Section Final: 統合考察（固定）

```markdown
## 統合考察

### 仮説検証
{Synthesis Agent の出力}

### 結論
{主要な結論リスト}

### 次のステップ
{推奨する追加調査}

### 未解決の問い
{答えられなかった問い}
```

## Python ヘルパー（Notebook 組み立て用）

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

def build_notebook(cells: list) -> dict:
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3"
            },
            "language_info": {
                "name": "python",
                "version": "3.10.0"
            }
        },
        "cells": cells
    }

# 使用例
cells = []
cells.append(md_cell("## 調査設計\n\n**目的**: 機械異常の検知"))
cells.append(code_cell("import wandas as wd\nimport numpy as np"))
# ... ラウンドセルを追加 ...

notebook = build_notebook(cells)

# Write ツールでファイルに保存
notebook_json = json.dumps(notebook, ensure_ascii=False, indent=2)
# → Write ツールに渡す
```
