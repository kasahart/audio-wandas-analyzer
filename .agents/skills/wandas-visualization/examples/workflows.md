# wandas-visualization: Workflows

## Scenario 1: WAV の総合サマリーを表示する

```python
import wandas as wd

signal = wd.read_wav("audio.wav")

# 3パネル（波形・スペクトル・スペクトログラム）サマリー
signal.describe(
    fmin=100,
    fmax=8000,
    cmap="inferno",
    vmin=-80,
    vmax=-20,
    Aw=True
)
```

## Scenario 2: フィルタ前後のスペクトルをオーバーレイ比較する

```python
import wandas as wd
import matplotlib.pyplot as plt

original = wd.read_wav("noisy.wav")
filtered = original.band_pass_filter(low_cutoff=100, high_cutoff=4000)

# 同一 Axes にオーバーレイ
ax = original.fft().plot(overlay=True, label="Original", alpha=0.7)
filtered.fft().plot(ax=ax, overlay=True, label="Filtered", title="フィルタ比較")
plt.legend()
plt.show()
```

## Scenario 3: A 重み付きスペクトログラムで時間変動を可視化する

```python
import wandas as wd

signal = wd.read_wav("machine.wav")
spectrogram = signal.stft(n_fft=2048, hop_length=256)

# A 重み付きスペクトログラム
spectrogram.plot_Aw()

# または詳細設定で
spectrogram.plot(
    Aw=True,
    cmap="inferno",
    fmin=100,
    fmax=5000,
    vmin=-70,
    vmax=-20,
    title="A-weighted Spectrogram"
)
```

## Scenario 4: 1/3 オクターブバンドチャート（条件比較）

```python
import wandas as wd
import matplotlib.pyplot as plt

before = wd.read_wav("before_treatment.wav")
after = wd.read_wav("after_treatment.wav")

noct_before = before.noct_spectrum(fmin=25, fmax=8000, n=3)
noct_after = after.noct_spectrum(fmin=25, fmax=8000, n=3)

ax = noct_before.plot(overlay=True, label="Before")
noct_after.plot(ax=ax, overlay=True, label="After", title="1/3 Octave: Before vs After")
plt.legend()
plt.show()
```

## Scenario 5: コヒーレンスのマトリクス表示

```python
import wandas as wd

ref = wd.read_wav("ref.wav")
meas = wd.read_wav("meas.wav")
combined = ref.add_channel(meas)

coh = combined.coherence(n_fft=2048)
coh.plot_matrix()
```

## Scenario 6: RoughnessFrame のヒートマップ

```python
import wandas as wd

signal = wd.read_wav("product_sound.wav")
roughness_spec = signal.roughness_dw_spec(overlap=0.5)

roughness_spec.plot(
    cmap="viridis",
    title="Roughness Spectrogram [asper/Bark]"
)
```
