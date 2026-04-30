---
name: wandas-visualization
description: Use when plotting waveforms, frequency spectra, spectrograms, octave band charts, roughness heatmaps, overlaying multiple signals on the same axes, or configuring describe() with frequency range and colormap settings with wandas.
---

# wandas: Visualization

全フレーム型が `.plot()` メソッドを持つ。`describe()` は ChannelFrame の総合サマリーを生成する。

## Mandatory Rules

1. **Wandas-first**: `matplotlib` 直接描画禁止。必ず `.plot()` / `.describe()` を使う。
2. **Axes 受け渡し**: オーバーレイは `ax=` パラメータで行う。
3. **Method chaining**: フレームメソッドを使う。`plt.plot(frame.data)` は禁止。

## フレーム型別 .plot() メソッド

| フレーム | メソッド | 主要パラメータ |
|---------|---------|--------------|
| `ChannelFrame` | `.plot(plot_type="waveform", ax=None, title=None, overlay=False, alpha=1.0, xlim=None, ylim=None)` | 時間波形 |
| `ChannelFrame` | `.rms_plot(ax=None, title=None, overlay=True, Aw=False)` | RMS トレンド |
| `ChannelFrame` | `.describe(...)` | 3パネル総合サマリー |
| `SpectralFrame` | `.plot(plot_type="frequency", ax=None, title=None, overlay=False, Aw=False, xlim=None, ylim=None)` | 周波数スペクトル |
| `SpectralFrame` | `.plot_matrix()` | 多チャンネルマトリクス |
| `SpectrogramFrame` | `.plot(plot_type="spectrogram", ax=None, title=None, cmap="jet", vmin=None, vmax=None, fmin=0, fmax=None, Aw=False)` | 時間-周波数 |
| `SpectrogramFrame` | `.plot_Aw()` | A重み付きスペクトログラム |
| `NOctFrame` | `.plot(plot_type="noct", ax=None, title=None, overlay=False, Aw=False)` | オクターブ帯域棒グラフ |
| `RoughnessFrame` | `.plot(plot_type="heatmap", ax=None, title=None, cmap="viridis", vmin=None, vmax=None)` | Bark×時間ヒートマップ |

## describe() パラメータ

```python
signal.describe(
    normalize=True,     # 波形を正規化して表示
    is_close=True,      # 表示後に自動クローズ
    fmin=0,             # スペクトル/スペクトログラムの下限周波数 (Hz)
    fmax=None,          # 上限周波数（None = ナイキスト）
    cmap="jet",         # スペクトログラムのカラーマップ
    vmin=None,          # スペクトログラムの最小値 (dB)
    vmax=None,          # スペクトログラムの最大値 (dB)
    xlim=None,          # 時間軸の範囲 (s, s)
    ylim=None,          # 振幅軸の範囲
    Aw=False,           # A 重み付きスペクトログラム
    waveform=None,      # 波形プロットへの追加 kwargs
    spectral=None,      # スペクトルプロットへの追加 kwargs
)
```

`describe()` は3パネル（波形＋Welch スペクトル＋STFT スペクトログラム）を生成し、Jupyter ではオーディオ再生ウィジェットも追加する。

## Patterns

### WAV ファイルの総合サマリー

```python
import wandas as wd

signal = wd.read_wav("audio.wav")
signal.describe(fmin=100, fmax=5000, cmap="inferno", vmin=-80, vmax=-20)
```

### 2つのスペクトルをオーバーレイ比較

```python
import wandas as wd
import matplotlib.pyplot as plt

original = wd.read_wav("noisy.wav")
filtered = original.band_pass_filter(low_cutoff=100, high_cutoff=4000)

ax = original.fft().plot(overlay=True, label="Original")
filtered.fft().plot(ax=ax, overlay=True, label="Filtered", title="フィルタ比較")
plt.legend()
plt.show()
```

### A 重み付きスペクトログラム

```python
spectrogram = signal.stft(n_fft=2048, hop_length=512)
spectrogram.plot_Aw()  # または spectrogram.plot(Aw=True)
```

### 1/3 オクターブバンドチャート

```python
noct = signal.noct_spectrum(fmin=25, fmax=8000, n=3)
noct.plot(title="1/3 Octave Band", Aw=True)
```

### RoughnessFrame ヒートマップ

```python
roughness_spec = signal.roughness_dw_spec(overlap=0.5)
roughness_spec.plot(cmap="viridis", title="Roughness [asper/Bark]")
```

### コヒーレンスのマトリクス表示

```python
combined = ref.add_channel(meas)
coh = combined.coherence(n_fft=2048)
coh.plot_matrix()
```

## Common Mistakes

| 間違い | 正解 |
|--------|------|
| `plt.show()` を省略（Jupyter 外）| `.plot()` は Axes を返すだけ。スクリプトでは `plt.show()` が必要 |
| 別フレームの比較で `overlay=True` | 別フレームの比較は `ax=` を渡す |
| `describe()` を subplot 内で使う | `describe()` は3パネルを独立生成する。subplot グリッドには入らない |
| `RoughnessFrame.plot(cmap="jet")` | デフォルトは `"viridis"`。意図的に変える場合のみ指定 |
| `SpectralFrame` で `Aw=True` を知らない | `.plot(Aw=True)` で A 重み付きスペクトルを表示できる |

## Documentation Map

- [`examples/workflows.md`](examples/workflows.md) — 可視化シナリオ別コード例
- [`references/plot_api.md`](references/plot_api.md) — 全 .plot() メソッドの詳細 API
