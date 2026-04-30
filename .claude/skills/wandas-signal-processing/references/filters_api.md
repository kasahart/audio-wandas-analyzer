# wandas Signal Processing API Reference

ソース: `wandas/wandas/frames/mixins/channel_processing_mixin.py`

## フィルタメソッド

全フィルタは Butterworth 設計（`scipy.signal.butter`）＋ `filtfilt` による零位相フィルタリング。

### high_pass_filter
```python
.high_pass_filter(cutoff: float, order: int = 4) -> ChannelFrame
```
- `cutoff`: カットオフ周波数 (Hz)。`sampling_rate / 2` 未満であること
- `order`: フィルタ次数（デフォルト 4）

### low_pass_filter
```python
.low_pass_filter(cutoff: float, order: int = 4) -> ChannelFrame
```

### band_pass_filter
```python
.band_pass_filter(low_cutoff: float, high_cutoff: float, order: int = 4) -> ChannelFrame
```
- 引数名は `low_cutoff` / `high_cutoff`（`low` / `high` ではない）

### a_weighting
```python
.a_weighting() -> ChannelFrame
```
IEC 61672-1 に基づく A 重み付けフィルタ。ChannelFrame にのみ適用可能（SpectralFrame 不可）。

## 正規化・整形

### normalize
```python
.normalize(
    norm: float | None = float("inf"),
    axis: int | None = -1,
    threshold: float | None = None,
    fill: bool | None = None
) -> ChannelFrame
```
- `norm=float("inf")`: ピーク正規化（デフォルト）
- `norm=2`: L2 ノルム（RMS 正規化相当）

### remove_dc
```python
.remove_dc() -> ChannelFrame
```
DC オフセット（直流成分）を除去。

### resampling
```python
.resampling(target_sr: float, **kwargs) -> ChannelFrame
```

### trim
```python
.trim(start: float = 0, end: float | None = None) -> ChannelFrame
```
- `start`, `end`: 秒単位の時間。`end=None` で信号末尾まで

### fix_length
```python
.fix_length(length: int | None = None, duration: float | None = None) -> ChannelFrame
```
- `length`: サンプル数で指定
- `duration`: 秒数で指定（どちらか一方）

### fade
```python
.fade(fade_ms: float = 50) -> ChannelFrame
```
Tukey 窓によるフェードイン/アウト（対称）。

## 音圧レベル

### sound_level
```python
.sound_level(
    freq_weighting: str | None = "Z",
    time_weighting: str = "Fast",
    dB: bool = False
) -> ChannelFrame
```
- `freq_weighting`: `"A"`, `"C"`, `"Z"`
- `time_weighting`: `"Fast"`（125ms 時定数）, `"Slow"`（1s 時定数）
- `dB=False`: 線形値（デフォルト）。`dB=True` で dB 換算
- **注意**: 正しい dB SPL を得るには `ch_units=['Pa']` を設定すること

### rms_trend
```python
.rms_trend(
    frame_length: int = 2048,
    hop_length: int = 512,
    dB: bool = False,
    Aw: bool = False
) -> ChannelFrame
```
- `Aw=True`: A 重み付きフィルタを適用してから RMS 計算

## HPSS（調和-打楽音分離）

### hpss_harmonic / hpss_percussive
```python
.hpss_harmonic(
    kernel_size: int = 31,
    power: float = 2,
    margin: float = 1,
    n_fft: int = 2048,
    hop_length: int | None = None,
    win_length: int | None = None,
    window: str = "hann",
    center: bool = True,
    pad_mode: str = "constant"
) -> ChannelFrame
```
librosa の HPSS アルゴリズムを使用。
