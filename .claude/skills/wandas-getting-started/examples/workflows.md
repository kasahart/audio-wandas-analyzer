# wandas-getting-started: Workflows

## Recipe 1: WAV ファイルを読み込んで検査する

```python
import wandas as wd

signal = wd.read_wav("recording.wav")
signal.info()
# → Duration, SR, n_channels, labels を表示

signal.describe()
# → 波形・スペクトル・スペクトログラムの3パネル表示
```

## Recipe 2: CSV センサーデータを読み込む

```python
import wandas as wd

# 列名で時間軸を指定
sensor = wd.read_csv("vibration.csv", time_column="Time")

# 列番号で指定（0 = 最初の列）
sensor = wd.read_csv("vibration.csv", time_column=0)

print(f"SR: {sensor.sampling_rate:.1f} Hz, Duration: {sensor.duration:.2f}s")
sensor.plot(title="Vibration Waveform")
```

## Recipe 3: 物理単位付きフレームを作成する（Pa / dB SPL）

```python
import numpy as np
import wandas as wd

# 80 dB SPL の 440 Hz 正弦波
amplitude = 2e-5 * 10**(80/20)
t = np.linspace(0, 1, 16000)
signal_pa = amplitude * np.sin(2 * np.pi * 440 * t)

# ch_units=['Pa'] で参照値 2e-5 Pa が自動設定される
frame = wd.from_numpy(
    data=signal_pa[np.newaxis, :],  # shape: (1, n_samples)
    sampling_rate=16000,
    ch_units=["Pa"]
)

spl = frame.sound_level("A", "Fast", dB=True)
print(f"SPL: {np.mean(spl.data):.1f} dB(A)")  # ~80 dB(A)
```

**物理単位と参照値:**

| `ch_units` | 物理量 | 参照値 | 用途 |
|-----------|--------|--------|------|
| `"Pa"` | 音圧 | 2e-5 Pa | 騒音・音響 |
| `"m/s²"` | 加速度 | 1e-6 m/s² | 振動計測 |
| `"V"` | 電圧 | 1 V | 電気信号 |

## Recipe 4: テスト信号を生成する

```python
import wandas as wd

# 単一周波数のサイン波
tone = wd.generate_sin(freqs=440.0, sampling_rate=44100, duration=1.0)

# 複数周波数（チャンネルごと）
multi = wd.generate_sin(freqs=[440, 880, 1760], sampling_rate=44100, duration=1.0)
print(f"Channels: {multi.n_channels}")  # 3
```

## Recipe 5: フォルダから一括読み込み

```python
import wandas as wd

# 遅延読み込み（メモリ効率が良い）
dataset = wd.from_folder("./measurements/", file_extensions=[".wav"])

# 各フレームをイテレート
for frame in dataset:
    print(f"{frame.labels}: {frame.duration:.1f}s")
```

## Recipe 6: 操作履歴を確認する

```python
import wandas as wd

signal = wd.read_wav("audio.wav")
processed = signal.high_pass_filter(cutoff=100).a_weighting()

for op in processed.operation_history:
    print(f"{op['operation']}: {op['params']}")
```
