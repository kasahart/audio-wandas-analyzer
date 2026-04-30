# wandas Spectral Analysis API Reference

ソース: `wandas/wandas/frames/mixins/channel_transform_mixin.py`

## fft

```python
.fft(
    n_fft: int | None = None,   # None = 信号長と同じ
    window: str = "hann"
) -> SpectralFrame
```
単一フレーム FFT。片側スペクトル。

## welch

```python
.welch(
    n_fft: int = 2048,
    hop_length: int | None = None,   # None → n_fft // 4
    win_length: int | None = None,   # None → n_fft
    window: str = "hann",
    average: str = "mean"            # "mean" または "median"
) -> SpectralFrame
```
Welch 法による時間平均 PSD 推定。

## stft

```python
.stft(
    n_fft: int = 2048,
    hop_length: int | None = None,   # None → n_fft // 4
    win_length: int | None = None,   # None → n_fft
    window: str = "hann"
) -> SpectrogramFrame
```
短時間フーリエ変換。時間-周波数分解能のトレードオフ:
- `n_fft` 大: 周波数解像度↑、時間解像度↓
- `hop_length` 小: 時間解像度↑、計算コスト↑

## noct_spectrum

```python
.noct_spectrum(
    fmin: float = 25,      # 最低周波数 (Hz)
    fmax: float = 20000,   # 最高周波数 (Hz)（sr 非依存）
    n: int = 3,            # 分割数（3 = 1/3 オクターブ）
    G: int = 10,           # 基準（10 進法）
    fr: int = 1000         # 基準周波数 (Hz)
) -> NOctFrame
```

## coherence

```python
.coherence(
    n_fft: int = 2048,
    hop_length: int | None = None,
    win_length: int | None = None,
    window: str = "hann",
    detrend: str = "constant"
) -> SpectralFrame
```
**2チャンネル以上必要。** 全チャンネルペアのコヒーレンスを計算。

## csd

```python
.csd(
    n_fft: int = 2048,
    hop_length: int | None = None,
    win_length: int | None = None,
    window: str = "hann",
    detrend: str = "constant",
    scaling: str = "spectrum",   # "spectrum" または "density"
    average: str = "mean"
) -> SpectralFrame
```
クロスパワースペクトル密度。**2チャンネル以上必要。**

## transfer_function

```python
.transfer_function(
    n_fft: int = 2048,
    hop_length: int | None = None,
    win_length: int | None = None,
    window: str = "hann",
    detrend: str = "constant",
    scaling: str = "spectrum",
    average: str = "mean"
) -> SpectralFrame
```
周波数応答関数 H(f) = CSD(out, in) / PSD(in)。**2チャンネル以上必要。**

---

## SpectralFrame プロパティ一覧

| プロパティ | 型 | 説明 |
|-----------|----|------|
| `.freqs` | ndarray | 周波数軸 (Hz) |
| `.data` | ndarray | 複素スペクトル data（numpy） |
| `.magnitude` | ndarray | 振幅（`np.abs(data)`）|
| `.phase` | ndarray | 位相（`np.angle(data)`）|
| `.power` | ndarray | パワー（`np.abs(data)**2`）|
| `.dB` | ndarray | dB 換算値 |
| `.dBA` | ndarray | A 重み付き dB |
| `.unwrapped_phase` | ndarray | 連続位相 |
| `.n_fft` | int | FFT サイズ |

## SpectrogramFrame プロパティ一覧

| プロパティ | 型 | 説明 |
|-----------|----|------|
| `.freqs` | ndarray | 周波数軸 (Hz) |
| `.times` | ndarray | 時間軸 (s) |
| `.n_frames` | int | 時間フレーム数 |
| `.n_freq_bins` | int | 周波数ビン数 |
| `.data` | ndarray | 複素スペクトログラム |
| `.magnitude` | ndarray | 振幅スペクトログラム |
| `.dB` | ndarray | dB スペクトログラム |
| `.dBA` | ndarray | A 重み付き dB |
| `.hop_length` | int | ホップ長 |
| `.win_length` | int | 窓長 |

## NOctFrame プロパティ一覧

| プロパティ | 説明 |
|-----------|------|
| `.freqs` | 中心周波数配列 (Hz) |
| `.dB` | dB スペクトル |
| `.dBA` | A 重み付き dB |
| `.fmin`, `.fmax` | 周波数範囲 |
| `.n` | 分割数（3 = 1/3 oct） |
