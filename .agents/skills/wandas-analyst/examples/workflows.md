# wandas-analyst: Workflows

3つの典型的な解析シナリオ。各シナリオは「目的→Diagnostician→調査ラウンド→Synthesis→Notebook」の流れで進む。

---

## Scenario 1: 環境騒音評価

### 調査設計
- **目的**: 工場周辺の騒音レベルが環境基準を満たしているか評価する
- **仮説**: 昼間（条件A）は基準値 60 dB(A) に近く、夜間（条件B）は 45 dB(A) を超えている可能性がある
- **ファイル**: `day.wav`（昼間）、`night.wav`（夜間）
- **比較軸**: 時間帯（昼 vs 夜）

### Diagnostician 結果（例）
```
SIGNAL_QUALITY:
  file: day.wav  → sr: 44100, ch: 1, duration: 60s, issues: none
  file: night.wav → sr: 44100, ch: 1, duration: 60s, issues: none
RECOMMENDED_ANALYSES: [level, spectral, temporal]
```

### Round 1: 音圧レベルの全体評価（ANALYSIS_TYPE: level）
**問い**: 昼夜の平均音圧レベルと統計分布はどの程度違うか？

```python
import wandas as wd
import numpy as np

day = wd.read_wav("day.wav")
night = wd.read_wav("night.wav")

# dB(A) 時系列
spl_day = day.sound_level(freq_weighting="A", time_weighting="Fast", dB=True)
spl_night = night.sound_level(freq_weighting="A", time_weighting="Fast", dB=True)

print("=== 昼間 ===")
print(f"Leq: {np.mean(spl_day.data):.1f} dB(A)")
print(f"Lmax: {np.max(spl_day.data):.1f} dB(A)")
print(f"L90:  {np.percentile(spl_day.data, 10):.1f} dB(A)")

print("=== 夜間 ===")
print(f"Leq: {np.mean(spl_night.data):.1f} dB(A)")
print(f"Lmax: {np.max(spl_night.data):.1f} dB(A)")
print(f"L90:  {np.percentile(spl_night.data, 10):.1f} dB(A)")
```

**Findings:**
- 観察: 昼間 Leq 58 dB(A)、夜間 Leq 51 dB(A)
- 解釈: 夜間基準を超過している可能性。周波数特性を調べる必要あり
- 示唆: 1/3 オクターブで卓越周波数を確認する

### Round 2: 周波数特性（ANALYSIS_TYPE: spectral）
**問い**: 昼夜で卓越する周波数帯域はどこか？

```python
noct_day = day.noct_spectrum(fmin=25, fmax=8000, n=3)
noct_night = night.noct_spectrum(fmin=25, fmax=8000, n=3)

import matplotlib.pyplot as plt
ax = noct_day.plot(overlay=True, label="Day", Aw=True)
noct_night.plot(ax=ax, overlay=True, label="Night", title="1/3 Oct: Day vs Night (A-weighted)")
plt.legend()
```

---

## Scenario 2: 機械異常検知

### 調査設計
- **目的**: モーターに異常振動が発生しているか検知する
- **仮説**: 異常時（条件B）では特定の回転周波数（50 Hz の倍音）のエネルギーが増加している
- **ファイル**: `normal.wav`、`abnormal.wav`
- **比較軸**: 正常 vs 異常

### Round 1: 時間波形で全体把握（ANALYSIS_TYPE: temporal）

```python
import wandas as wd

normal = wd.read_wav("normal.wav")
abnormal = wd.read_wav("abnormal.wav")

import matplotlib.pyplot as plt
ax = normal.plot(overlay=True, label="Normal", alpha=0.7)
abnormal.plot(ax=ax, overlay=True, label="Abnormal", title="Waveform Comparison")
plt.legend()
```

### Round 2: FFT で卓越周波数を特定（ANALYSIS_TYPE: spectral）

```python
import numpy as np

spec_n = normal.fft()
spec_a = abnormal.fft()

ax = spec_n.plot(overlay=True, label="Normal", alpha=0.7)
spec_a.plot(ax=ax, overlay=True, label="Abnormal", title="FFT Comparison")
plt.legend()

# 上位5周波数
top5_idx = np.argsort(np.abs(spec_a.data))[-5:][::-1]
for i in top5_idx:
    print(f"{spec_a.freqs[i]:.1f} Hz: {np.abs(spec_a.data[i]):.4f}")
```

### Round 3: STFT で異常の時間的発生を特定（ANALYSIS_TYPE: stft）

```python
spec_abnormal = abnormal.stft(n_fft=1024, hop_length=128)
spec_abnormal.plot(
    cmap="inferno",
    fmax=1000,
    title="Abnormal: Time-Frequency Map"
)
```

---

## Scenario 3: 施工前後の条件比較

### 調査設計
- **目的**: 防音壁設置前後で室内騒音がどの程度改善されたか評価する
- **仮説**: 施工後は全帯域で 5 dB(A) 以上の低減が期待される
- **ファイル**: `before.wav`、`after.wav`
- **比較軸**: 施工前 vs 施工後

### Round 1: 全体音圧レベルの差分（ANALYSIS_TYPE: level）

```python
import wandas as wd
import numpy as np

before = wd.read_wav("before.wav")
after = wd.read_wav("after.wav")

spl_b = before.sound_level("A", "Fast", dB=True)
spl_a = after.sound_level("A", "Fast", dB=True)

reduction = np.mean(spl_b.data) - np.mean(spl_a.data)
print(f"Before Leq: {np.mean(spl_b.data):.1f} dB(A)")
print(f"After  Leq: {np.mean(spl_a.data):.1f} dB(A)")
print(f"Reduction:  {reduction:.1f} dB")
```

### Round 2: 周波数帯域別の低減量（ANALYSIS_TYPE: comparison）

```python
noct_b = before.noct_spectrum(fmin=25, fmax=8000, n=3)
noct_a = after.noct_spectrum(fmin=25, fmax=8000, n=3)

# 差分（施工前 - 施工後 = 低減量）
import numpy as np
reduction_db = noct_b.dBA - noct_a.dBA

print("帯域別低減量 (dB(A)):")
for f, r in zip(noct_b.freqs, reduction_db[0]):
    print(f"  {f:6.1f} Hz: {r:+.1f} dB")
```

### Round 3: 心理音響的な改善の評価（ANALYSIS_TYPE: psycho）

```python
loudness_b = before.loudness_zwtv(field_type="free")
loudness_a = after.loudness_zwtv(field_type="free")

loudness_b_st = before.loudness_zwst(field_type="free")
loudness_a_st = after.loudness_zwst(field_type="free")

print(f"Before loudness: {loudness_b_st} sone")
print(f"After  loudness: {loudness_a_st} sone")
```
