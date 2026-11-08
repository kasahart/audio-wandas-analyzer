import { RT, SP, t, tt, type ChartContract } from '../model';

/** トラックの波形レーン */
export const trackWaveform: ChartContract = {
    chart: {
        id: 'track-waveform', name: 'トラックの波形レーン',
        paintedBy: [`${RT}:drawTrackWaveform`],
        requires: ['readout', 'step', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'track-waveform.readout', value: 'readout', what: '波形レーンの読み値（名前・時刻・振幅）',
            computedIn: ['src/webview/runtime/trackLaneHover.ts:laneReadoutText', `${SP}:lineRead`, 'src/webview/runtime/laneReads.ts:createLaneReads', 'python-backend/analysis_service.py:waveform_range'],
            from: 'full', trace: 'laneReads.waveform がファイルの全サンプルからマウスのまわりを取り寄せる。描いた包絡は読まない。',
            tests: [
                tt('src/test/trackLaneHover.test.ts', 'the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)'),
                tt('src/test/fullRead.test.ts', 'a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)'),
                tt('python-backend/test_full_read.py', 'test_a_lane_reads_its_files_own_samples_and_stft_cells'),
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
            ],
            exception: { rule: 'R7', quote: 'ただし、キーボードのフォーカスがあるレーン（クリックしてカーソルを置いたレーン）では、マウスがそのレーンに乗っていても、← / → はこれまでどおりカーソルを動かします。' },
        },
        {
            id: 'track-waveform.range', value: 'range', what: '振幅の軸の範囲',
            computedIn: [`${RT}:laneAmplitudeAxis`, `${RT}:amplitudeScaleFor`, 'src/webview/runtime/laneAxes.ts:laneAmplitudeRange', 'python-backend/decimator.py:decimated_waveform'],
            from: 'full', trace: 'absolutePeak（全サンプルの絶対値の最大、間引く前に求める）か、つないだ録音で共有するピークから決める。',
            tests: [
                tt('python-backend/test_decimator.py', 'test_absolute_peak'),
                t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not'),
            ],
        },
        {
            id: 'track-waveform.ticks', value: 'ticks', what: '振幅の目盛り',
            computedIn: ['src/webview/runtime/laneAxes.ts:laneAmplitudeTicks', `${SP}:valueAxisTicks`],
            from: 'axis', trace: '範囲から、どのグラフとも同じ規則で決める。',
            tests: [
                t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'track-waveform.axis', value: 'axis', what: '振幅の軸の名前',
            computedIn: [`${SP}:amplitudeAxisTitle`, `${RT}:laneAmplitudeAxis`],
            from: 'words', trace: '量・単位・校正を比較台の波形と同じく書く。',
            tests: [
                t('src/test/laneAxes.test.ts', 'a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'track-waveform.range-popover', value: 'range', what: '軸のダブルクリックで開く範囲の欄の値（振幅・スペクトログラムの周波数と色）',
            computedIn: [`${RT}:field`],
            from: 'axis', trace: '今描いている範囲を有効数字 4 桁で書く。',
            tests: [
                t('src/test/uiSmoke/waveformAmplitudeRange.spec.ts', 'double-clicking the waveform amplitude axis sets the vertical range from a popover'),
            ],
        },
    ],
    knownGaps: {},
};
