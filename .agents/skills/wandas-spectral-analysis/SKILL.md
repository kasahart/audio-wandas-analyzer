---
name: wandas-spectral-analysis
description: Use when performing FFT, STFT, Welch PSD estimation, 1/N octave band analysis, coherence, cross-spectral density, or transfer function analysis with wandas.
---

# wandas: Spectral Analysis

`ChannelFrame` を周波数域フレームに変換する。各メソッドは新しいフレームを返す。

## Mandatory Rules

1. **Wandas-first**: `np.fft.fft()` 等の直接呼び出し禁止。必ず wandas メソッドを使う。
2. **Method chaining**: 各メソッドは新しいフレームを返す（イミュータブル）。
3. **Visualization**: `.plot()` / `.describe()` を使う。`plt.plot` は禁止。

## 変換メソッド（ChannelFrame → スペクトルフレーム）

| メソッド | シグネチャ | 返り値 |
|---------|-----------|--------|
| `.fft` | `(n_fft: int = None, window: str = "hann")` | SpectralFrame |
| `.welch` | `(n_fft: int = 2048, hop_length: int = None, win_length: int = None, window: str = "hann", average: str = "mean")` | SpectralFrame |
| `.stft` | `(n_fft: int = 2048, hop_length: int = None, win_length: int = None, window: str = "hann")` | SpectrogramFrame |
| `.noct_spectrum` | `(fmin: float = 25, fmax: float = 20000, n: int = 3, G: int = 10, fr: int = 1000)` | NOctFrame |
| `.coherence` | `(n_fft: int = 2048, hop_length: int = None, win_length: int = None, window: str = "hann", detrend: str = "constant")` | SpectralFrame |
| `.csd` | `(n_fft: int = 2048, hop_length: int = None, win_length: int = None, window: str = "hann", detrend: str = "constant", scaling: str = "spectrum", average: str = "mean")` | SpectralFrame |
| `.transfer_function` | `(n_fft: int = 2048, hop_length: int = None, win_length: int = None, window: str = "hann", detrend: str = "constant", scaling: str = "spectrum", average: str = "mean")` | SpectralFrame |

デフォルト値: `hop_length = n_fft // 4`、`win_length = n_fft`（None 時）

## 逆変換

| メソッド | 入力フレーム | 返り値 |
|---------|------------|--------|
| `.ifft()` | SpectralFrame | ChannelFrame |
| `.istft()` | SpectrogramFrame | ChannelFrame |

## SpectralFrame プロパティ

| プロパティ | 説明 |
|-----------|------|
| `.freqs` | 周波数軸（Hz）の ndarray |
| `.magnitude` | 振幅スペクトル |
| `.phase` | 位相スペクトル |
| `.power` | パワースペクトル |
| `.dB` | dB 換算値 |
| `.dBA` | A 重み付き dB |

## SpectrogramFrame プロパティ

| プロパティ | 説明 |
|-----------|------|
| `.freqs` | 周波数軸（Hz）|
| `.times` | 時間軸（秒）|
| `.n_frames` | 時間フレーム数 |
| `.n_freq_bins` | 周波数ビン数 |
| `.magnitude` | 振幅スペクトログラム |
| `.dB` | dB スペクトログラム |
| `.dBA` | A 重み付き dB スペクトログラム |

## Patterns

### 基本的な FFT スペクトル

```python
import wandas as wd

signal = wd.read_wav("audio.wav")
spectrum = signal.fft()
spectrum.plot(title="Frequency Spectrum")
print(f"卓越周波数: {spectrum.freqs[spectrum.data.argmax()]:.1f} Hz")
```

### Welch 法による PSD 推定

```python
psd = signal.welch(n_fft=2048, hop_length=512)
psd.plot(title="Power Spectral Density")
```

### STFT スペクトログラムで時間-周波数解析

```python
import wandas as wd

sensor = wd.read_csv("sensor.csv", time_column="Time")
spectrogram = (sensor
    .high_pass_filter(cutoff=50)
    .stft(n_fft=2048, hop_length=512))
spectrogram.plot(cmap="inferno", title="Anomaly Detection")
```

### 1/3 オクターブバンド解析

```python
noct = signal.noct_spectrum(fmin=25, fmax=8000, n=3)
noct.plot(title="1/3 Octave Band Spectrum")
```

### 2チャンネル間のコヒーレンス

```python
import wandas as wd

ref = wd.read_wav("ref.wav")
meas = wd.read_wav("meas.wav")
combined = ref.add_channel(meas)
coh = combined.coherence(n_fft=2048)
coh.plot(title="Coherence")
```

### 伝達関数推定

```python
combined = input_sig.add_channel(output_sig)
tf = combined.transfer_function(n_fft=2048)
tf.plot_matrix()  # チャンネル間マトリクス表示
```

## Common Mistakes

| 間違い | 正解 |
|--------|------|
| `SpectralFrame.fft()` を呼ぶ | すでに周波数域。`ifft()` で時間域に戻す |
| `welch()` が SpectrogramFrame と思う | `welch()` は SpectralFrame（時間平均済み）を返す |
| `.coherence()` を単chフレームで呼ぶ | コヒーレンスは **2ch 以上**必要 |
| `noct_spectrum` の fmax がナイキスト以下と思う | `fmax` デフォルトは 20000（sr 非依存）|
| `welch` の `average` を忘れる | `average="mean"`（デフォルト）または `"median"` |

## Documentation Map

- [`examples/workflows.md`](examples/workflows.md) — スペクトル解析のシナリオ別コード例
- [`references/spectral_api.md`](references/spectral_api.md) — 全変換メソッドの詳細 API
