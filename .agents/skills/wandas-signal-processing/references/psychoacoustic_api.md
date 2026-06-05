# wandas Psychoacoustic Metrics API Reference

ソース: `wandas/wandas/frames/mixins/channel_processing_mixin.py`

## ラウドネス（Loudness）

### loudness_zwtv — 時変ラウドネス
```python
.loudness_zwtv(field_type: str = "free") -> ChannelFrame
```
- **返り値**: ChannelFrame（時変、単位: sone）
- **規格**: ISO 532-1:2017 Zwicker 法
- `field_type`: `"free"`（自由音場）または `"diffuse"`（拡散音場）
- 結果は `.plot()` でチェーン可能

### loudness_zwst — 定常ラウドネス
```python
.loudness_zwst(field_type: str = "free") -> NDArrayReal
```
- **返り値**: NDArrayReal（チャンネルごとのスカラー値、単位: sone）
- **注意**: フレームではない → `.plot()` はチェーンできない
- 定常（stationary）信号向け

---

## ラフネス（Roughness）

### roughness_dw — 時変ラフネス
```python
.roughness_dw(overlap: float = 0.5) -> ChannelFrame
```
- **返り値**: ChannelFrame（時変、単位: asper）
- **規格**: Daniel & Weber 法
- `overlap`: フレーム間のオーバーラップ率（0.0〜1.0）
- 結果は `.plot()` でチェーン可能

### roughness_dw_spec — Bark スペクトログラム
```python
.roughness_dw_spec(overlap: float = 0.5) -> RoughnessFrame
```
- **返り値**: RoughnessFrame（Bark 帯域 × 時間、shape: `(47, n_time)`）
- 47 Bark 帯域での特定ラフネス分布
- `.plot(cmap="viridis")` で Bark ヒートマップを表示

---

## シャープネス（Sharpness）

### sharpness_din — 時変シャープネス
```python
.sharpness_din(
    weighting: str = "din",
    field_type: str = "free"
) -> ChannelFrame
```
- **返り値**: ChannelFrame（時変、単位: acum）
- **規格**: DIN 45692
- `weighting`: `"din"`, `"aures"`, `"bismarck"`, `"fastl"`
- `field_type`: `"free"` または `"diffuse"`
- 結果は `.plot()` でチェーン可能

### sharpness_din_st — 定常シャープネス
```python
.sharpness_din_st(
    weighting: str = "din",
    field_type: str = "free"
) -> NDArrayReal
```
- **返り値**: NDArrayReal（チャンネルごとのスカラー値、単位: acum）
- **注意**: フレームではない → `.plot()` はチェーンできない

---

## 心理音響指標の対応表

| 指標 | 単位 | 知覚との対応 | メソッド |
|------|------|------------|---------|
| ラウドネス | sone | 音の「大きさ」の知覚 | `loudness_zwtv`, `loudness_zwst` |
| ラフネス | asper | 音の「ざらつき感」 | `roughness_dw`, `roughness_dw_spec` |
| シャープネス | acum | 音の「鋭さ・高域感」 | `sharpness_din`, `sharpness_din_st` |

---

## 注意事項

- 全心理音響メソッドは十分なサンプリングレート（推奨 **44.1kHz 以上**）が必要
- `loudness_zwst` と `sharpness_din_st` は **NDArrayReal を返す**（ChannelFrame ではない）
- `loudness_zwtv` は長い信号（1秒以上）で意味ある結果を返す
- ラフネス計算は信号に周期的な振幅変調（AM）がある場合に大きな値になる
