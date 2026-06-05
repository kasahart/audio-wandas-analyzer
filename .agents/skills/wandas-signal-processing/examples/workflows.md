# wandas-signal-processing: Workflows

## Scenario 1: 環境騒音の dB(A) 評価

```python
import wandas as wd
import numpy as np

# 物理単位付きで読み込み（WAV が Pa スケールの場合）
frame = wd.read_wav("noise.wav", normalize=True)
# または numpy から作成:
# frame = wd.from_numpy(data_pa, sampling_rate=sr, ch_units=["Pa"])

# A 重み付き音圧レベル（時系列）
spl = frame.sound_level(freq_weighting="A", time_weighting="Fast", dB=True)

# 統計量
print(f"Leq:  {np.mean(spl.data):.1f} dB(A)")
print(f"Lmax: {np.max(spl.data):.1f} dB(A)")
print(f"Lmin: {np.min(spl.data):.1f} dB(A)")

# 時系列プロット
spl.plot(title="Sound Pressure Level [dB(A)]")
```

## Scenario 2: 機械振動のバンドパスフィルタリング

```python
import wandas as wd

sensor = wd.read_csv("vibration.csv", time_column="Time")

# 目的の周波数帯域を抽出（例: 100-3000 Hz）
filtered = (sensor
    .remove_dc()                                        # DC 成分除去
    .band_pass_filter(low_cutoff=100, high_cutoff=3000) # 帯域抽出
    .normalize())                                        # 正規化

# フィルタ前後を比較
import matplotlib.pyplot as plt
ax = sensor.plot(overlay=True, label="Original", alpha=0.5)
filtered.plot(ax=ax, overlay=True, label="Filtered", title="Bandpass Filter")
plt.legend()
plt.show()
```

## Scenario 3: 心理音響総合評価

```python
import wandas as wd
import numpy as np

sig = wd.read_wav("product_sound.wav")  # 44.1kHz 以上推奨

# 時変指標（ChannelFrame として返る）
loudness = sig.loudness_zwtv(field_type="free")
roughness = sig.roughness_dw(overlap=0.5)
sharpness = sig.sharpness_din(weighting="din")

# 各指標の可視化
loudness.plot(title="Loudness [sone]")
roughness.plot(title="Roughness [asper]")
sharpness.plot(title="Sharpness [acum]")

# 定常値（スカラー）— .plot() はチェーンできない
loudness_val = sig.loudness_zwst(field_type="free")   # NDArrayReal
sharpness_val = sig.sharpness_din_st(weighting="din") # NDArrayReal
print(f"定常ラウドネス: {loudness_val} sone")
print(f"定常シャープネス: {sharpness_val} acum")

# ラフネス Bark スペクトログラム
roughness_spec = sig.roughness_dw_spec(overlap=0.5)
roughness_spec.plot(cmap="viridis", title="Roughness Spectrogram [asper/Bark]")
```

## Scenario 4: 時変 RMS トレンドで音量変化を監視

```python
import wandas as wd

signal = wd.read_wav("machine_run.wav")

# A 重み付き dB(A) トレンド
rms_aw = signal.rms_trend(
    frame_length=2048,
    hop_length=512,
    dB=True,
    Aw=True
)
rms_aw.plot(title="A-weighted RMS Level over Time")

# Z 重み（フラット）との比較
rms_z = signal.rms_trend(frame_length=2048, hop_length=512, dB=True, Aw=False)
import matplotlib.pyplot as plt
ax = rms_z.plot(overlay=True, label="Z-weighted", alpha=0.7)
rms_aw.plot(ax=ax, overlay=True, label="A-weighted", title="RMS Level Comparison")
plt.legend()
plt.show()
```

## Scenario 5: HPSS で楽音と打楽音を分離する

```python
import wandas as wd

music = wd.read_wav("music.wav")

harmonic = music.hpss_harmonic(kernel_size=31)
percussive = music.hpss_percussive(kernel_size=31)

harmonic.describe(title="Harmonic Component")
percussive.describe(title="Percussive Component")
```
