# wandas Visualization API Reference

ソース: `wandas/wandas/frames/channel.py`, `frames/spectral.py`, `frames/spectrogram.py`, `frames/noct.py`, `frames/roughness.py`

## ChannelFrame.plot

```python
.plot(
    plot_type: str = "waveform",
    ax=None,
    title: str | None = None,
    overlay: bool = False,
    xlabel: str | None = None,
    ylabel: str | None = None,
    alpha: float = 1.0,
    xlim=None,
    ylim=None,
    **kwargs
) -> Axes
```

## ChannelFrame.rms_plot

```python
.rms_plot(
    ax=None,
    title: str | None = None,
    overlay: bool = True,
    Aw: bool = False,
    **kwargs
) -> Axes
```

## ChannelFrame.describe

```python
.describe(
    normalize: bool = True,
    is_close: bool = True,
    *,
    fmin: float = 0,
    fmax: float | None = None,
    cmap: str = "jet",
    vmin: float | None = None,
    vmax: float | None = None,
    xlim=None,
    ylim=None,
    Aw: bool = False,
    waveform: dict | None = None,
    spectral: dict | None = None,
    image_save: str | None = None,
    **kwargs
) -> list[Figure] | None
```
3パネル（波形・Welch スペクトル・STFT スペクトログラム）を生成。Jupyter では IPython.display.Audio によるオーディオ再生も追加。

## SpectralFrame.plot

```python
.plot(
    plot_type: str = "frequency",
    ax=None,
    title: str | None = None,
    overlay: bool = False,
    xlabel: str | None = None,
    ylabel: str | None = None,
    alpha: float = 1.0,
    xlim=None,
    ylim=None,
    Aw: bool = False,
    **kwargs
) -> Axes
```

## SpectralFrame.plot_matrix

```python
.plot_matrix(plot_type: str = "matrix", **kwargs) -> Axes
```

## SpectrogramFrame.plot

```python
.plot(
    plot_type: str = "spectrogram",
    ax=None,
    title: str | None = None,
    cmap: str = "jet",
    vmin: float | None = None,
    vmax: float | None = None,
    fmin: float = 0,
    fmax: float | None = None,
    xlim=None,
    ylim=None,
    Aw: bool = False,
    overlay: bool = False,
    **kwargs
) -> Axes
```

## SpectrogramFrame.plot_Aw

```python
.plot_Aw(plot_type: str = "spectrogram", ax=None, **kwargs) -> Axes
```
`plot(Aw=True)` のショートカット。

## NOctFrame.plot

```python
.plot(
    plot_type: str = "noct",
    ax=None,
    title: str | None = None,
    overlay: bool = False,
    xlabel: str | None = None,
    ylabel: str | None = None,
    alpha: float = 1.0,
    xlim=None,
    ylim=None,
    Aw: bool = False,
    **kwargs
) -> Axes
```
⚠️ `NOctFrame` に対するバイナリ演算（`+`, `-` 等）は `NotImplementedError` になる。

## RoughnessFrame.plot

```python
.plot(
    plot_type: str = "heatmap",
    ax=None,
    title: str | None = None,
    cmap: str = "viridis",           # デフォルトは "viridis"（"jet" ではない）
    vmin: float | None = None,
    vmax: float | None = None,
    xlabel: str = "Time [s]",
    ylabel: str = "Frequency [Bark]",
    colorbar_label: str = "Specific Roughness [Asper/Bark]",
    **kwargs
) -> Axes
```

---

## ax= パターン（オーバーレイ）

```python
import matplotlib.pyplot as plt

# パターン1: overlay=True で同フレームの全チャンネルを重ねる
ax = frame.fft().plot(overlay=True)

# パターン2: ax= で別フレームを同 Axes に追加
ax = frame_a.fft().plot(overlay=True, label="A")
frame_b.fft().plot(ax=ax, overlay=True, label="B")
plt.legend()
plt.show()
```

## Jupyter vs スクリプト

| 環境 | .plot() の挙動 |
|------|--------------|
| Jupyter Notebook | インライン表示 |
| Python スクリプト | `plt.show()` が必要 |
| describe() Jupyter | オーディオ再生ウィジェット付き |
