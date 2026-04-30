---
name: wandas-getting-started
description: Use when starting with wandas, loading audio or sensor data from WAV or CSV files, creating signals from NumPy arrays, understanding ChannelFrame and other frame types, inspecting signal metadata, or setting up physical units (Pa, m/s²) for dB calculations.
---

# wandas: Getting Started

wandas は音声・振動信号解析のための Python ライブラリ。pandas スタイルのフレーム API でメソッドチェーンが可能。

## Mandatory Rules

1. **Wandas-first**: `wd.read_wav()` / `wd.from_numpy()` を使う。`scipy.io.wavfile` や生 NumPy I/O は禁止。
2. **Method chaining**: 全操作は新しいフレームを返す（イミュータブル）。元のフレームは変更されない。
3. **Visualization**: `.plot()` / `.describe()` を使う。`plt.plot(frame.data)` は禁止。

## I/O 関数

| 関数 | シグネチャ | 返り値 | 注意 |
|------|-----------|--------|------|
| `wd.read_wav` | `(filename, labels=None, normalize=False)` | ChannelFrame | `normalize=False` は生 PCM 値。`normalize=True` で [-1, 1] に正規化 |
| `wd.read_csv` | `(filename, time_column=0, labels=None, delimiter=",", header=0)` | ChannelFrame | `time_column` は列インデックス(int)または列名(str) |
| `wd.from_numpy` | `(data, sampling_rate, label=None, metadata=None, ch_labels=None, ch_units=None)` | ChannelFrame | shape: `(channels, samples)` または 1-D（自動変換）。`ch_refs` パラメータは存在しない |
| `wd.generate_sin` | `(freqs=1000.0, sampling_rate=16000, duration=1.0, label=None)` | ChannelFrame | `freqs` をリストにすると多チャンネル |
| `wd.from_folder` | `(folder_path, sampling_rate=None, file_extensions=None, recursive=False, lazy_loading=True)` | ChannelFrameDataset | 遅延バッチ読み込み |

## フレーム型一覧

| フレーム | ドメイン | 生成元 |
|---------|---------|--------|
| `ChannelFrame` | 時間 | I/O, `from_numpy` |
| `SpectralFrame` | 周波数 | `.fft()`, `.welch()`, `.coherence()`, `.csd()`, `.transfer_function()` |
| `SpectrogramFrame` | 時間-周波数 | `.stft()` |
| `NOctFrame` | オクターブ帯域 | `.noct_spectrum()` |
| `RoughnessFrame` | 心理音響 | `.roughness_dw_spec()` |

## ChannelFrame プロパティ

| プロパティ | 型 | 説明 |
|-----------|----|------|
| `sampling_rate` | float | サンプリングレート (Hz) |
| `duration` | float | 信号長（秒）|
| `n_samples` | int | サンプル数 |
| `n_channels` | int | チャンネル数 |
| `labels` | list[str] | チャンネル名リスト |
| `time` | ndarray | 時間軸配列 |
| `rms` | ndarray | RMS 値（チャンネルごと）|
| `crest_factor` | ndarray | クレストファクタ |
| `data` | ndarray | **NumPy 配列**（`.compute()` 不要） |
| `operation_history` | list[dict] | 処理履歴 |

## Patterns

### WAV ファイルを読み込んで検査する
```python
import wandas as wd

signal = wd.read_wav("audio.wav")
signal.info()
print(f"Duration: {signal.duration:.2f}s, SR: {signal.sampling_rate}Hz, Ch: {signal.n_channels}")
```

### CSV センサーデータを読み込む
```python
# 時間列名で指定
sensor = wd.read_csv("sensor.csv", time_column="Time")

# 時間列番号で指定
sensor = wd.read_csv("sensor.csv", time_column=0)
```

### NumPy から物理単位付きフレームを作成する
```python
import numpy as np
import wandas as wd

# 音圧信号（Pa 単位）— ch_units='Pa' で参照値 2e-5 が自動設定される
amplitude = 2e-5 * 10**(80/20)  # 80 dB SPL の振幅
signal_pa = amplitude * np.sin(2 * np.pi * 440 * np.linspace(0, 1, 16000))

frame = wd.from_numpy(
    data=signal_pa[np.newaxis, :],  # shape: (1, n_samples)
    sampling_rate=16000,
    ch_units=["Pa"]  # 参照値は自動設定される（ch_refs パラメータは不要）
)
# sound_level(dB=True) が正しい dB SPL を返す
spl = frame.sound_level("A", "Fast", dB=True)
```

### テスト信号を生成する
```python
# 単一周波数
tone = wd.generate_sin(freqs=440.0, sampling_rate=44100, duration=1.0)

# 多チャンネル（複数周波数）
multi = wd.generate_sin(freqs=[440, 880], sampling_rate=44100, duration=1.0)
print(f"Channels: {multi.n_channels}")  # 2
```

### describe() で総合サマリーを表示
```python
signal = wd.read_wav("audio.wav")
signal.describe(fmin=100, fmax=8000, cmap="inferno")
```

## Common Mistakes

| 間違い | 正解 |
|--------|------|
| `frame.data.compute()` を呼ぶ | `.data` は既に NumPy 配列。`.compute()` 不要 |
| `wd.from_ndarray(...)` を使う | 非推奨。`wd.from_numpy(...)` を使う |
| `ChannelFrame(data=..., sampling_rate=...)` で直接作成 | `wd.from_numpy()` / `wd.read_wav()` を使う |
| `read_wav()` で [-1,1] を期待する | デフォルト `normalize=False` は生 PCM 値。正規化するには `normalize=True` |
| `from_numpy(data, sr, ch_refs=[2e-5])` を使う | `ch_refs` パラメータは存在しない。`ch_units=['Pa']` で参照値は自動設定 |
| `from_numpy` に 1-D 配列を渡せないと思う | 1-D は自動的に `(1, n_samples)` に変換される |

## Documentation Map

- [`examples/workflows.md`](examples/workflows.md) — コピペで動く I/O レシピ集
- [`references/io_api.md`](references/io_api.md) — 全パラメータの辞書的リファレンス・フレーム型遷移図
