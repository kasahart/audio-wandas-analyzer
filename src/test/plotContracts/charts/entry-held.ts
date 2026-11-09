import { SP, t, tt, type ChartContract } from '../model';

/** 入口の保持図（スロットの Δ、手順の有無の Δ、平均スペクトル） */
export const entryHeld: ChartContract = {
    chart: {
        id: 'entry-held', name: '入口の保持図（スロットの Δ、手順の有無の Δ、平均スペクトル）',
        paintedBy: ['src/webview/runtime/entryHeldPlot.ts:paintView'],
        requires: ['readout', 'step', 'delta', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'entry-held.readout', value: 'readout', what: '保持図の読み値',
            computedIn: [`${SP}:lineRead`, 'src/webview/runtime/entryHeldPlot.ts:paintStep', 'src/webview/runtime/entryHeldPlot.ts:paintDelta'],
            from: 'full', trace: '手順の絵は reader.of、手順の有無の Δ は reader.combined、スロットの Δ は全ビンの Δ を localLine で読む。全ビンがないときの帯の Δ は棒（全帯）。',
            tests: [
                tt('src/test/uiSmoke/heldDelta.spec.ts', 'a held slot draws its own channel\'s Δ against its base from every bin the hold asks for (R1, R3, R11)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)'),
            ],
        },
        {
            id: 'entry-held.step', value: 'step', what: '保持図の ← / →',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '読み値と同じ全データの次の点。スロットの Δ は全ビンの次のビン。',
            tests: [
                tt('src/test/entryHeldPlot.test.ts', '← / → on a held slot\'s Δ step to the next of every bin, not the next point drawn of the Δ thinned to the plot\'s width (R7)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)'),
            ],
        },
        {
            id: 'entry-held.delta', value: 'delta', what: 'スロットの Δ（全ビン）と手順の有無の Δ',
            computedIn: ['src/webview/runtime/comparePanes.ts:binsOf', 'src/webview/runtime/comparePanes.ts:fileSide', 'src/webview/runtime/comparePanes.ts:deltaViews', 'src/webview/runtime/combineSource.ts:createCombineSource'],
            from: 'full', trace: 'スロットは押したときに録音と基準の全ビンを取り寄せ、丸める前の値をビンごとに引く（binsOf、R1：丸めるのは書くときだけ）。手順の有無はバックエンドが全データで引く。',
            tests: [
                tt('src/test/entryHeldPlot.test.ts', 'a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)'),
                tt('src/test/comparePanes.test.ts', 'the held Δ zoomed in is drawn again from every bin between its ends, not the whole Δ decimated and stretched (R1, R3)'),
                tt('src/test/comparePanes.test.ts', 'the median and Δ are taken bin by bin from every bin, and only drawing decimates them'),
            ],
        },
        {
            id: 'entry-held.delta-bands', value: 'delta', what: '全ビンが取れないときの帯の Δ（棒）',
            computedIn: ['src/webview/runtime/comparePanes.ts:deltaViews', 'src/webview/runtime/comparePanes.ts:binsOf'],
            from: 'whole', trace: 'スキャンがビンを返さない録音（サンプリング周波数や n_fft が違う）は、全ビンから求めた 1/3 オクターブ帯の Δ を棒で描く。帯は間引かない。',
            tests: [
                t('src/test/comparePanes.test.ts', 'files whose bins differ (another sample rate or n_fft) have no bins to compare'),
                t('src/test/comparePanes.test.ts', 'the report\'s Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1)'),
            ],
            exception: { rule: 'R1', quote: '全ビンが取れない録音（スキャンがビンを返さないとき）は、1/3 オクターブ帯の Δ を棒で描きます。' },
        },
        {
            id: 'entry-held.identity', value: 'identity', what: '取り寄せた全ビンが表の行と同じスペクトルか（つき合わせ）',
            computedIn: ['src/webview/runtime/comparePanes.ts:withBins', 'src/webview/runtime/entryHeldPlot.ts:paintSlot'],
            from: 'whole', trace: '取り寄せた全ビンのスキャンは、表のスキャンと conditionId（ファイルの版＝大きさ・ナノ秒の更新時刻と状態変更時刻・inode、区間、チャンネル、校正、単位、Recipe）が同じときだけ使う（comparePanes.ts sameCondition）。描いた 192 点（spectrumDb）では照合しない。ファイルがスキャンし直されて conditionId が変われば、全ビンを頼み直す（1 つの表の conditionId に 1 回）。',
            tests: [
                t('src/test/entryHeldPlot.test.ts', 'a file scanned again since its bins were kept is asked for again, once, so a hold does not stay at 192 points'),
                t('src/test/comparePanes.test.ts', 'the table\'s results take the bins of a scan of the same condition only, never judged by its 192 drawn points'),
                t('python-backend/test_scan_service.py', 'test_a_file_replaced_within_the_same_millisecond_is_another_input'),
            ],
        },
        {
            id: 'entry-held.range', value: 'range', what: '保持図の値の軸の範囲',
            computedIn: ['src/webview/runtime/entryHeldPlot.ts:paintStep', 'src/webview/runtime/entryHeldPlot.ts:paintDelta', `${SP}:stageRange`, `${SP}:stageDiffRange`, 'src/webview/runtime/comparePanes.ts:binsView'],
            from: 'full', trace: '手順の絵はバックエンドが付けた全データの valueRange、スロットの Δ と手順の有無の Δ は binsView が全ビンから求めた valueRange（範囲内のすべてのビンの最小・最大）から決める。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                tt('src/test/comparePanes.test.ts', 'a spectrum drawn from its bins carries every bin\'s lowest and highest value in its span as its range, the silent floor left out (R1)'),
            ],
        },
        {
            id: 'entry-held.ticks', value: 'ticks', what: '保持図の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'entry-held.axis', value: 'axis', what: '保持図の軸の名前（Δ は「Δ [dB]」）',
            computedIn: [`${SP}:stageAxes`],
            from: 'words', trace: 'dB の Δ は axisDelta（「差 Δ [dB]」）。量（差）と単位を書く。同じ基準の 2 つのレベルの差なので、差そのものの基準はない（基準は凡例と重ね図の軸）。dB でない量は「Δ 量 [単位]」。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)'),
            ],
            names: { quantity: true, unit: true },
        },
    ],
    knownGaps: {
    },
};
