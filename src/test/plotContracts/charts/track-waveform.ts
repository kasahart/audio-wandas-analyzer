import { TICK_PLACES, CLICK_READ, CLICK_TEST, PRESS_READ_TEST, RT, SP, t, tt, type ChartContract } from '../model';

/** トラックの波形レーン */
export const trackWaveform: ChartContract = {
    chart: {
        id: 'track-waveform', name: 'トラックの波形レーン',
        paintedBy: [`${RT}:drawTrackWaveform`],
        requires: ['readout', 'step', 'range', 'ticks', 'axis', 'click'],
    },
    rows: [
        {
            id: 'track-waveform.readout', value: 'readout', what: '波形レーンの読み値（名前・時刻・振幅）',
            computedIn: ['src/webview/runtime/trackLaneHover.ts:laneReadoutText', `${SP}:lineRead`, 'src/webview/runtime/laneReads.ts:createLaneReads', 'python-backend/analysis_service.py:waveform_range'],
            from: 'full', trace: 'laneReads.waveform がファイルの全サンプルからマウスのまわりを取り寄せる。描いた包絡は読まない。',
            tests: [
                tt('src/test/trackLaneHover.test.ts', 'the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)'),
                t('src/test/fullRead.test.ts', 'a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)'),
                t('python-backend/test_full_read.py', 'test_a_lane_reads_its_files_own_samples_and_stft_cells'),
            ],
        },
        {
            id: 'track-waveform.step', value: 'step', what: '波形レーンの ← / →（1 サンプルずつ）',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '全サンプルの次の点。',
            tests: [
                tt('src/test/trackLaneHover.test.ts', 'the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)'),
                t('src/test/trackPointerEvents.test.ts', 'a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one\'s readout (R7)'),
            ],
        },
        {
            id: 'track-waveform.step-focus', value: 'step', what: 'キーボードのフォーカスがあるレーンの ← / →（カーソルを動かす）',
            computedIn: ['src/webview/runtime/trackPointerEvents.ts:attachTrackPointerListeners'],
            from: 'input', trace: 'クリックしてカーソルを置いたレーンでは、← / → は読み値でなくカーソルを動かす。',
            tests: [
                t('src/test/trackPointerEvents.test.ts', 'a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one\'s readout (R7)'),
                t('src/test/shortcuts.test.ts', 'keydownIntent moves the time cursor with arrows only while a track canvas has focus (R7)'),
                t('src/test/shortcuts.test.ts', 'arrowCursorStep moves one pixel of the zoomed view, or 0.1 s with Shift (R7)'),
            ],
            exception: { rule: 'R7', quote: 'トラック表示のレーンにキーボードのフォーカスがあるとき（クリックしてカーソルを置いた、Tab で選んだ）は、マウスがそのレーンに乗っていても、← / → は再生の時刻カーソルを動かします。' },
        },
        {
            id: 'track-waveform.range', value: 'range', what: '振幅の軸の範囲',
            computedIn: [`${RT}:laneAmplitudeAxis`, `${RT}:amplitudeScaleFor`, 'src/webview/runtime/figureModel.ts:laneAmplitudeRange', 'python-backend/decimator.py:decimated_waveform'],
            from: 'full', trace: 'absolutePeak（全サンプルの絶対値の最大、間引く前に求める）か、つないだ録音で共有するピークから決める。',
            tests: [
                tt('python-backend/test_decimator.py', 'test_absolute_peak_is_every_samples_not_a_line_thinned_by_averaging'),
                t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not'),
            ],
        },
        {
            id: 'track-waveform.ticks', value: 'ticks', what: '振幅の目盛り',
            computedIn: ['src/webview/runtime/laneAxes.ts:laneAmplitudeTicks', `${SP}:valueAxisTicks`],
            from: 'axis', trace: '範囲から、どのグラフとも同じ規則で決める。',
            tests: [
                TICK_PLACES.lanes,
                t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'track-waveform.axis', value: 'axis', what: '振幅の軸の名前',
            computedIn: [`${SP}:amplitudeAxisTitle`, `${RT}:laneAmplitudeAxis`, 'src/webview/runtime/figureModel.ts:plainNames'],
            from: 'words', trace: '量・単位・校正を比較台の波形と同じく書く。',
            tests: [
                t('src/test/laneAxes.test.ts', 'a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'track-waveform.range-popover', value: 'range', what: '軸のダブルクリックで開く範囲の欄の値（振幅・スペクトログラムの周波数と色）',
            computedIn: [`${RT}:openWaveformRangePopup`, `${RT}:openSpectrogramRangePopup`, `${RT}:zoomLanesToBox`],
            from: 'axis', trace: '軸を描いた端をそのまま書く（exactFieldText、R9）。自動の振幅の範囲は入力欄の桁まで外へ広げ、拡大の窓の端は入力欄の桁で作って描く（figureModel.fieldWindow）。',
            tests: [
                t('src/test/uiSmoke/waveformAmplitudeRange.spec.ts', 'double-clicking the waveform amplitude axis sets the vertical range from a popover'),
            ],
        },
        {
            id: 'track-waveform.click', value: 'click', what: 'クリックで動く時刻のカーソル',
            computedIn: [...CLICK_READ, `${RT}:endLaneDrag`, `${RT}:laneReadNorm`, `${RT}:showLaneReadout`],
            from: 'full', trace: '押した所でレーンの読み値が読んだサンプル（PlotHoverLayer.clicked、次の描画を待たずに showLaneReadout で出す）の時刻（ほかのレーンの時刻の線と同じ laneReadNorm）へカーソルを動かす。画素の時刻は使わない。読み値が何も読まない所（値なし、解析後に変わったファイル）では動かない。',
            tests: [
                tt('src/test/trackLaneHover.test.ts', 'a click on a track lane moves the cursor to the sample its readout reads, not to a point of the envelope drawn nor the pixel\'s own time (R7, R13)'),
                t('src/test/plotInteraction.test.ts', PRESS_READ_TEST),
                t('src/test/uiSmoke/plotContract.spec.ts', CLICK_TEST),
            ],
        },
    ],
    knownGaps: {},
};
