# wandas I/O API Reference

## wd.read_wav

```python
wd.read_wav(
    filename: str | Path,
    labels: list[str] | None = None,
    normalize: bool = False
) -> ChannelFrame
```

- `filename`: WAV ファイルパス
- `labels`: チャンネル名リスト（省略時は "ch0", "ch1", ...）
- `normalize`: `True` で [-1, 1] に正規化。`False`（デフォルト）は生 PCM 値（16bit なら ±32768 スケール）

## wd.read_csv

```python
wd.read_csv(
    filename: str | Path,
    time_column: int | str = 0,
    labels: list[str] | None = None,
    delimiter: str = ",",
    header: int = 0
) -> ChannelFrame
```

- `time_column`: 時間軸の列（インデックスまたは列名）
- サンプリングレートは時間列から自動計算される

## wd.from_numpy

```python
wd.from_numpy(
    data: NDArrayReal,
    sampling_rate: float,
    label: str | None = None,
    metadata: FrameMetadata | dict | None = None,
    ch_labels: list[str] | None = None,
    ch_units: list[str] | str | None = None
) -> ChannelFrame
```

- `data`: shape `(channels, samples)` または 1-D（自動変換）。3-D 以上はエラー
- `ch_units`: `["Pa"]` で音圧参照値 2e-5 Pa が自動設定される。`ch_refs` パラメータは存在しない

## wd.generate_sin

```python
wd.generate_sin(
    freqs: float | list[float] = 1000,
    sampling_rate: float = 16000,
    duration: float = 1.0,
    label: str | None = None
) -> ChannelFrame
```

- `freqs`: スカラーなら単チャンネル。リストなら各周波数が1チャンネル

## wd.from_folder

```python
wd.from_folder(
    folder_path: str | Path,
    sampling_rate: float | None = None,
    file_extensions: list[str] | None = None,
    recursive: bool = False,
    lazy_loading: bool = True
) -> ChannelFrameDataset
```

## 物理単位と参照値

| `ch_units` 値 | 物理量 | 自動設定される参照値 | dB 式 |
|--------------|--------|-------------------|-------|
| `"Pa"` | 音圧 | 2e-5 Pa (20 μPa) | 20·log₁₀(p/2e-5) = dB SPL |
| `"m/s²"` | 加速度 | 1e-6 m/s² | 20·log₁₀(a/1e-6) = dB (振動) |
| `"V"` | 電圧 | 1 V | 20·log₁₀(V/1) |
| その他 / None | — | 1.0（デフォルト）| — |

## フレーム型遷移図

```
ChannelFrame（時間域）
    │
    ├─ .fft(n_fft) ──────────────────────→ SpectralFrame（周波数域）
    │                                            └─ .ifft() → ChannelFrame
    │
    ├─ .welch(n_fft) ────────────────────→ SpectralFrame（平均 PSD）
    │
    ├─ .stft(n_fft, hop_length) ─────────→ SpectrogramFrame（時間-周波数域）
    │                                            ├─ .istft() → ChannelFrame
    │                                            └─ .get_frame_at(t) → SpectralFrame
    │
    ├─ .noct_spectrum(fmin, fmax, n) ────→ NOctFrame（オクターブ帯域）
    │
    ├─ .coherence(n_fft) ────────────────→ SpectralFrame（コヒーレンス）
    ├─ .csd(n_fft) ──────────────────────→ SpectralFrame（クロスパワースペクトル）
    ├─ .transfer_function(n_fft) ────────→ SpectralFrame（伝達関数）
    │
    └─ .roughness_dw_spec() ─────────────→ RoughnessFrame（Bark×時間）
```

## インスタンスメソッド（クラスメソッド）

```python
# 最も汎用的なリーダー
ChannelFrame.from_file(
    path,
    channel=None,
    start=None,
    end=None,
    ch_labels=None,
    file_type=None,       # None で自動判定
    normalize=False
) -> ChannelFrame

# WAV として保存
frame.to_wav(path, format=None)

# HDF5 として保存
frame.save(path, format="hdf5", compress="gzip", overwrite=False)

# HDF5 から読み込み
ChannelFrame.load(path, format="hdf5")
```
