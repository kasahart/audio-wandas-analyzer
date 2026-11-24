# 図の種類を足す手順

新しい経路（図のサービスと Figure 部品）に、図の種類を 1 つ足すときの手順です。熱図（`image`）、時間信号（`band`）、分布図（`bins`）の 3 つを実際に足したときの通りに書いています。設計の全体は [figure-design.md](figure-design.md)、ファイルごとの役割は [`python-backend/figures/README.md`](../python-backend/figures/README.md) にあります。

## 先に知っておくこと

測った値そのもの（答え）を作るのは 1 層目です。2 層目（`python-backend/figures/`）は、その答えから「何を載せるか、どこまで見せるか、どの点を描くか、どの点を読むか」を決めます。決め方は 5 種類しかありません。

| 計算 | ファイル | 決めること |
|---|---|---|
| ア | `members.py` | 何を載せるか、何件か |
| イ | `ranges.py` | 軸の範囲（間引く前の値から） |
| ウ／配置 | `thinning.py` | 描く用の点、区間や点の置き場所 |
| エ | `pick.py` | ポインターが読む点（間引く前の値から） |
| オ | `headline.py` | 見出しに出す点 |

新しい図の種類は、この 5 つのファイルに関数を足して作ります。計算の種類は増やしません。平均、中央値、差、dB への変換のような「新しい数」が要るなら、それは 1 層目（wandas、wandas-extras）の仕事です。**5 種類に収まらないと思ったら、実装を止めて相談してください**（設計書 第 1 節を変えることになるため）。

3 層目（`src/webview/figure/`）は、絵が言う数字を画面の場所と色に直すだけです。数えない、まとめない、選ばない。

## 手順

### 0. いまの振る舞いを記録する

図の種類を作り替えるなら、先にいまの答えを共有のテストデータにします。こうしておくと、作り替えたあとも同じ答えを出すことを 1 件ずつ確かめられ、変えた点も 1 件ずつ言えます。まったく新しい種類なら、この手順は飛ばします。

- 記録するテスト：`src/test/figure<種類>Cases.test.ts`。いまの関数に入力を与え、答えを `python-backend/tests/fixtures/figure_<種類>_cases.json` と比べます。その関数を消すときに、このテストも消します。テストデータは残り、図のサービスのテストが読み続けます（分布図がこの形です：`python-backend/test_figures_distribution.py`）。
- 記録するもの：軸の範囲、描く用の点、読み値の文、クリックで起きること。

### 1. 5 種類の計算のどれを、どの順に呼ぶかを書く

コードの前に、表を 1 つ書きます。3 つの種類ではこうなりました。

| 種類 | ア | イ | ウ／配置 | エ |
|---|---|---|---|---|
| `image`（熱図） | 載せる録音 1 つ（段ごと） | `image_axes`、`image_extent`、`image_colour`（同じ図の熱図は範囲をそろえる） | `drawn_image`（2 px に 1 列、その中の最大の値。符号つきは絶対値が最大の値） | `pick_cell`（まとめる前のセル） |
| `band`（時間信号） | 録音ごとに 1 本 | `band_range`（画面内の標本の最大の絶対値） | `drawn_band`（区画ごとの最小と最大の標本） | `pick_sample`（標本そのもの） |
| `bins`（分布図） | `rows_shown`、`rows_picked`、`bin_counts` | `value_axis`、`count_axis` | `bin_edges`、`bin_of`、`stacked_levels` | `pick`（`bin_lines` が読む線に直す）、`bin_under` |

分布図のように、同じ計算を 2 回呼ぶ図もあります（ア 行、イ 値の軸、配置、ア 件数、イ 件数の軸）。順は設計書 第 1 節に書いてあります。

### 2. 2 層目を足す（Python）

1. **答えの型**（`answers.py`）。その図が描く「答え」の形を 1 つ足します（`ImageAnswer`、`SignalAnswer`、`ColumnAnswer`）。値、軸、単位と基準、版、大きさ（`nbytes`）。
2. **宣言**（`spec.py`）。段の種類（`LaneKind`）を足し、その段が名指すもの（鍵、行など）を読みます。おかしな宣言はここで断ります。
3. **5 つのファイルに関数を足す。** numpy を使えるのはこの 5 つだけです。読み値と範囲の関数は、描く用の点（`Drawn`）を受け取れません。
4. **絵**（`picture.py`）。段の絵の形を足します。算術はしません。
5. **サービス**（`service.py`）。draw で関数を手順 1 の順に呼び、read で読む関数を呼びます。絵の計画の型（`AnyPlan`）、取り置き（`_Holding`）、read の振り分け（ポインター、矢印キー、名前の 3 つとも）に、その種類を足します。見積り（`_estimate`）にその種類の量を足します。計算の途中で答えと同じ大きさの配列を作らないこと（切り出しは写さずに見る）。
6. **答えの渡し口**（`transport/figure_answers.py`）。鍵から答えを引けるようにします。
7. **プロトコル**（`protocol_schema.py`）。段の種類と絵の形を足します。数の配列には必ず印をつけます：`x-drawn`（間引いた点）、`x-whole`（全部の値）、`x-place`（場所や境界）。そのあと `node scripts/generate-protocol-types.mjs --write` で TypeScript の型を作り直します。

### 3. 2 層目のテストを書く

`python-backend/test_figures_<種類>.py` に、手順 0 のデータを再生するテストを書きます。

- 関数ごと、そしてプロトコル経由（`command_dispatch` を通す draw / read / count）の両方。
- 記録した答えと変えた点は、ファイルの先頭に列挙し、テストの中に古い答えと新しい答えを並べます（黙って期待値を合わせない）。
- その種類が守る規則を 1 つ、乱数で確かめます（例：分布図の「選んだ区間が取る行は、その棒が数えた行と同じ」）。
- 「画面に入っているもの」の規則が、描く、読む（ポインター、矢印キー、名前）、範囲で同じであることを確かめます。範囲の端で切れるもの、拡大して画面の外に出たものを読むテストを 1 つずつ書きます（評価で、熱図の端のセルと、分布図の画面外の行で見つかりました）。
- プロセスに 1 つしかないもの（答えの取り置き、列、予算）を使ったら、テストの後で空にします。残すと、予算を数えるほかのテストが落ちます。

### 4. 3 層目を足す（TypeScript）

1. **絵の型**（`figure/picturePoints.ts`）。
2. **段の描き方**（`figure/imageLane.ts`、`figure/binsLane.ts` のような 1 種類 1 ファイル。帯は `figure/denseLine.ts`）。絵の数字を枠の中の場所に直す関数（`place…`）と、塗る関数（`paint…`）を分けます。場所の関数はテストから見えるようにします。Canvas に描くファイルは `scripts/lint-webview-patterns.js` の `CANVAS_DRAWING_FILES` に足します。
3. **Figure**（`figure/figure.ts`）。軸の名前、読み値の文、クリックで出す合図を足します。数の書き方は `shell/numberText.ts` の関数を使います。
4. **言葉。** 新しい言葉は `src/shared/i18n/strings.ts` と、テストの代役 `src/test/helpers/figureStandIn.ts` の両方に足します。

### 5. 3 層目のテストを書く

- `src/test/figure<種類>Lane.test.ts`：代役の答えで、場所、読み値、クリック、待っているあいだの動き。
- `src/test/uiSmoke/figure<種類>Kind.spec.ts`：本物のブラウザと本物のバックエンドで 1 本。古い図があるなら、同じ画面で古い図の数字と比べます。

新しい種類は、それを出す画面（`src/webview/screens/` の 1 ファイル。分布図なら `distributionFigure.ts`）から製品の枠に直接載せます。Figure の大きさは枠から取り、固定しません。テスト用だけの表示は作りません。

### 6. 文書と検査

- `python-backend/figures/README.md` の「図の種類ごとの関数」の表に 1 行足す。
- `npm run verify` と `npm run test:ui` を通す。

## 引っかかったところ

| 起きたこと | 直し方 |
|---|---|
| verify の契約表のテストが「数を書く関数が表にない」と言う | 図の値なら `src/test/plotContracts/charts/` の行に、書き方の補助なら `values.ts` の `VALUE_HELPERS` に足す。表を変えたら `npm run compile && node dist/test/plotContracts/render.js` で `docs/plot-contracts.md` を作り直す |
| 関数の名前を変えたら契約表のテストが「その関数がない」と言う | 表の `ファイル:関数` を新しい名前に直す |
| import の検査（`scripts/check_figure_imports.py`）が落ちる | `figures/` から `transport/` や `services/` を import していないか、5 つのファイルの外で numpy を使っていないかを見る |
| 読み値が描く用の点と同じ値になっている | 読む関数に渡しているのが答え（間引く前）かを見る。`Drawn` と `DrawnImage` は `thinning.py` と `picture.py` の外に出せない |
| 大きい答えで遅い、メモリが増える | 答えを写さない（見るだけにする）。Figure に取り置かず、読むたびに鍵で引き直す（時間信号のやり方） |
| 記録した答えと合わない | 記録した答えが規則として正しいかを先に考える。変えるなら、変えた点として記録し、利用者に見える違いは相談する（分布図の区間の端の規則） |

## 終わったと言える条件

- 5 種類の計算に収まっている（設計書 第 1 節に例外を足していない）。
- 手順 0 のデータを新しい経路で再生するテストがあり、変えた点が 1 件ずつ書いてある。
- 期待値を変えた既存のテストがない（あれば 1 件ずつ理由を書く）。
- `npm run verify` と `npm run test:ui` が通る。
