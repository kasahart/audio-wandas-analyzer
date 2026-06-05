---
name: wandas-signal-processing
description: Use when applying filters (lowpass, highpass, bandpass, A-weighting), normalizing signals, resampling, trimming, adding fades, computing RMS trends, calculating sound level (dB, A-weighting), or computing psychoacoustic metrics (loudness, roughness, sharpness) with wandas.
---

# wandas: Signal Processing

`ChannelFrame` の時間域処理。各メソッドは新しいフレームを返す（イミュータブル）。

## Mandatory Rules

1. **Wandas-first**: `scipy.signal.butter` 等の直接呼び出し禁止。必ず wandas メソッドを使う。
2. **Method chaining**: 各メソッドは新しいフレームを返す。元のフレームは変更されない。
3. **Visualization**: `.plot()` / `.describe()` を使う。`plt.plot(frame.data)` は禁止。

## フィルタ・前処理

| メソッド | シグネチャ | 返り値 |
|---------|-----------|--------|
| `.high_pass_filter` | `(cutoff: float, order: int = 4)` | ChannelFrame |
| `.low_pass_filter` | `(cutoff: float, order: int = 4)` | ChannelFrame |
| `.band_pass_filter` | `(low_cutoff: float, high_cutoff: float, order: int = 4)` | ChannelFrame |
| `.a_weighting` | `()` | ChannelFrame |
| `.normalize` | `(norm: float = inf, axis: int = -1, threshold=None, fill=None)` | ChannelFrame |
| `.remove_dc` | `()` | ChannelFrame |
| `.resampling` | `(target_sr: float)` | ChannelFrame |
| `.trim` | `(start: float = 0, end: float = None)` | ChannelFrame |
| `.fix_length` | `(length: int = None, duration: float = None)` | ChannelFrame |
| `.fade` | `(fade_ms: float = 50)` | ChannelFrame |
| `.hpss_harmonic` | `(kernel_size: int = 31)` | ChannelFrame |
| `.hpss_percussive` | `(kernel_size: int = 31)` | ChannelFrame |

## 音圧レベル・トレンド

| メソッド | シグネチャ | 返り値 | 注意 |
|---------|-----------|--------|------|
| `.sound_level` | `(freq_weighting: str = "Z", time_weighting: str = "Fast", dB: bool = False)` | ChannelFrame | `dB=True` で dB 換算。`ch_units=['Pa']` 設定時のみ正しい dB SPL |
| `.rms_trend` | `(frame_length: int = 2048, hop_length: int = 512, dB: bool = False, Aw: bool = False)` | ChannelFrame | フレームごとの時変 RMS |

`freq_weighting` オプション: `"A"`, `"C"`, `"Z"`（フラット）
`time_weighting` オプション: `"Fast"`（125ms）, `"Slow"`（1s）

## 心理音響指標

| メソッド | シグネチャ | 返り値 | 単位 |
|---------|-----------|--------|------|
| `.loudness_zwtv` | `(field_type: str = "free")` | ChannelFrame | sone（ISO 532-1） |
| `.loudness_zwst` | `(field_type: str = "free")` | **NDArrayReal** | sone（スカラー値）|
| `.roughness_dw` | `(overlap: float = 0.5)` | ChannelFrame | asper |
| `.roughness_dw_spec` | `(overlap: float = 0.5)` | RoughnessFrame | asper/Bark |
| `.sharpness_din` | `(weighting: str = "din", field_type: str = "free")` | ChannelFrame | acum |
| `.sharpness_din_st` | `(weighting: str = "din", field_type: str = "free")` | **NDArrayReal** | acum（スカラー値）|

⚠️ `loudness_zwst` と `sharpness_din_st` は **フレームではなく NDArrayReal** を返す。`.plot()` はチェーンできない。

`field_type` オプション: `"free"`（自由音場）, `"diffuse"`（拡散音場）
`weighting` オプション: `"din"`, `"aures"`, `"bismarck"`, `"fastl"`

## Patterns

### ノイズ除去パイプライン

```python
import wandas as wd

signal = wd.read_wav("noisy.wav")
cleaned = (signal
    .high_pass_filter(cutoff=50)       # 低周波ノイズを除去
    .low_pass_filter(cutoff=8000)      # 高周波ノイズを除去
    .normalize()                        # ピーク正規化
    .fade(fade_ms=10))                  # エッジをスムーズ化
cleaned.describe()
```

### 音圧レベル dB(A) の計算

```python
import wandas as wd
import numpy as np

# 物理単位付きフレーム（ch_units='Pa' で参照値 2e-5 が自動設定）
frame = wd.from_numpy(signal_pa, sampling_rate=sr, ch_units=["Pa"])
spl = frame.sound_level(freq_weighting="A", time_weighting="Fast", dB=True)
print(f"Leq: {np.mean(spl.data):.1f} dB(A)")
print(f"Lmax: {np.max(spl.data):.1f} dB(A)")
```

### 心理音響総合評価

```python
import wandas as wd

sig = wd.read_wav("audio.wav")  # 44.1kHz 以上推奨

# 時変指標（フレームとして返る）
loudness = sig.loudness_zwtv(field_type="free")    # sone
roughness = sig.roughness_dw(overlap=0.5)           # asper
sharpness = sig.sharpness_din(weighting="din")      # acum

loudness.plot(title="Time-varying Loudness [sone]")
roughness.plot(title="Time-varying Roughness [asper]")
sharpness.plot(title="Time-varying Sharpness [acum]")

# 定常値（スカラー）
loudness_val = sig.loudness_zwst(field_type="free")   # NDArrayReal
sharpness_val = sig.sharpness_din_st(weighting="din") # NDArrayReal
print(f"Loudness: {loudness_val} sone")
print(f"Sharpness: {sharpness_val} acum")
```

### RMS トレンド（A 重み付き）

```python
rms = frame.rms_trend(frame_length=2048, hop_length=512, dB=True, Aw=True)
rms.plot(title="A-weighted RMS Trend")
```

### HPSS による楽音・打楽音分離

```python
import wandas as wd

signal = wd.read_wav("music.wav")
harmonic = signal.hpss_harmonic()
percussive = signal.hpss_percussive()
harmonic.describe()
```

## Common Mistakes

| 間違い | 正解 |
|--------|------|
| `.band_pass_filter(low=100, high=5000)` | `.band_pass_filter(low_cutoff=100, high_cutoff=5000)` |
| `.fft().a_weighting()` | `a_weighting()` は ChannelFrame にのみ適用可能 |
| `normalize()` が RMS 正規化 | デフォルトはピーク正規化（`norm=inf`） |
| カットオフをナイキスト以上に設定 | `cutoff < sampling_rate / 2` を確認 |
| `loudness_zwst().plot()` を呼ぶ | `loudness_zwst` は NDArrayReal を返す。フレームではない |
| `sound_level(dB=True)` の値がおかしい | `ch_units=['Pa']` 未設定時は参照値 1.0 で計算される |

## Documentation Map

- [`examples/workflows.md`](examples/workflows.md) — コピペで動くワークフロー集
- [`references/filters_api.md`](references/filters_api.md) — フィルタ・前処理の詳細 API
- [`references/psychoacoustic_api.md`](references/psychoacoustic_api.md) — 心理音響指標の詳細 API
