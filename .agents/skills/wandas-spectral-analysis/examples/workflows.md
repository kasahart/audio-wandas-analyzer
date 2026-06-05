# wandas-spectral-analysis: Workflows

## Scenario 1: FFT で卓越周波数を特定する

```python
import wandas as wd
import numpy as np

signal = wd.read_wav("machine.wav")

# FFT スペクトル
spectrum = signal.fft()
spectrum.plot(title="Frequency Spectrum")

# 卓越周波数を取得
peak_freq = spectrum.freqs[np.argmax(np.abs(spectrum.data))]
print(f"卓越周波数: {peak_freq:.1f} Hz")

# A 重み付きスペクトルで比較
spectrum.plot(Aw=True, title="A-weighted Spectrum")
```

## Scenario 2: Welch 法で時間平均 PSD を求める

```python
import wandas as wd

signal = wd.read_wav("noise.wav")

# Welch PSD（時間平均化で安定した推定）
psd = signal.welch(n_fft=4096, hop_length=1024, average="mean")
psd.plot(title="Welch Power Spectral Density")

# Median 平均（外れ値に頑健）
psd_med = signal.welch(n_fft=4096, hop_length=1024, average="median")
```

## Scenario 3: STFT で時間変動と異常を検知する

```python
import wandas as wd

sensor = wd.read_csv("sensor_log.csv", time_column="Time")

# STFT スペクトログラム（時間-周波数分解能のトレードオフを調整）
spectrogram = (sensor
    .high_pass_filter(cutoff=50)
    .stft(n_fft=2048, hop_length=256))  # hop 小さい = 時間解像度高い

spectrogram.plot(
    cmap="inferno",
    fmin=0,
    fmax=2000,
    vmin=-80,
    vmax=-20,
    title="Anomaly Detection Spectrogram"
)

# 特定時刻のスペクトルを取り出す
frame_at_t = spectrogram.get_frame_at(10)  # 10秒時点
frame_at_t.plot(title="Spectrum at t=10s")
```

## Scenario 4: 1/3 オクターブバンドで周波数帯域評価

```python
import wandas as wd

signal = wd.read_wav("environment.wav")

# 1/3 オクターブバンドスペクトル
noct = signal.noct_spectrum(fmin=25, fmax=8000, n=3)
noct.plot(title="1/3 Octave Band Spectrum")

# A 重み付き表示
noct.plot(Aw=True, title="A-weighted 1/3 Octave")
```

## Scenario 5: 伝達関数とコヒーレンスで入出力関係を分析する

```python
import wandas as wd

# 入力・出力信号を読み込み
input_sig = wd.read_wav("input.wav")
output_sig = wd.read_wav("output.wav")

# 2チャンネルフレームに結合
combined = input_sig.add_channel(output_sig)

# 伝達関数
tf = combined.transfer_function(n_fft=2048)
tf.plot_matrix()

# コヒーレンス（1.0 に近いほど信頼性が高い）
coh = combined.coherence(n_fft=2048)
coh.plot(title="Coherence (1.0 = highly correlated)")
```
