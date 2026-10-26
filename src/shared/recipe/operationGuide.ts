/**
 * How the step bar's ＋ menu lists wandas' operations: by what they do (filters, preparation, change over
 * time, frequency, the rest), each with a one-line hint in the UI's language.
 */
import { operationName } from './recipeCatalog';

export type OperationGroup = 'filter' | 'prepare' | 'time' | 'frequency' | 'other';

export const OPERATION_GROUPS: readonly OperationGroup[] = ['filter', 'prepare', 'time', 'frequency', 'other'];

const GROUP_OF: Readonly<Record<string, OperationGroup>> = {
    highpass_filter: 'filter', lowpass_filter: 'filter', bandpass_filter: 'filter', a_weighting: 'filter', hpss_harmonic: 'filter', hpss_percussive: 'filter',
    normalize: 'prepare', remove_dc: 'prepare', trim: 'prepare', time_slice: 'prepare', fix_length: 'prepare', fade: 'prepare', resampling: 'prepare',
    get_channel: 'prepare', remove_channel: 'prepare', rename_channels: 'prepare', with_calibration: 'prepare', with_source_time_offset: 'prepare',
    channel_difference: 'prepare', abs: 'prepare', power: 'prepare', sum: 'prepare', mean: 'prepare', astype: 'prepare', index: 'prepare', select_pair: 'prepare',
    rms_trend: 'time', sound_level: 'time', loudness_zwtv: 'time', roughness_dw: 'time', roughness_dw_spec: 'time', sharpness_din: 'time',
    fft: 'frequency', welch: 'frequency', noct_spectrum: 'frequency', stft: 'frequency', cepstrum: 'frequency', coherence: 'frequency', csd: 'frequency',
    transfer_function: 'frequency', ifft: 'frequency', noct_synthesis: 'frequency', lifter: 'frequency', to_spectral_envelope: 'frequency',
    absolute: 'frequency', get_frame_at: 'frequency', to_channel_frame: 'frequency',
};

export function operationGroup(id: string): OperationGroup {
    if (id.startsWith('wandas.operator.')) return 'other';
    return GROUP_OF[operationName(id)] ?? 'other';
}

const HINTS: Readonly<Record<'en' | 'ja', Readonly<Record<string, string>>>> = {
    en: {
        highpass_filter: 'remove what is below a frequency', lowpass_filter: 'remove what is above a frequency', bandpass_filter: 'keep one band',
        a_weighting: 'weight by the ear\'s sensitivity', hpss_harmonic: 'keep the tonal part', hpss_percussive: 'keep the impulsive part',
        normalize: 'scale the peak to 1', remove_dc: 'subtract the mean', trim: 'keep a time range', time_slice: 'keep a time range',
        fix_length: 'pad or cut to a length', fade: 'smooth both ends', resampling: 'change the sampling rate', get_channel: 'keep one channel',
        remove_channel: 'drop a channel', rename_channels: 'rename the channels', with_calibration: 'set the calibration', with_source_time_offset: 'shift the time origin',
        channel_difference: 'subtract one channel from the others', abs: 'absolute value', power: 'raise to a power', sum: 'sum the channels', mean: 'average the channels',
        astype: 'change the number type', index: 'select by index', select_pair: 'keep one channel pair',
        rms_trend: 'level over time', sound_level: 'sound level over time', loudness_zwtv: 'loudness over time (Zwicker)', roughness_dw: 'roughness over time',
        roughness_dw_spec: 'roughness per critical band', sharpness_din: 'sharpness over time (DIN)',
        fft: 'spectrum of the whole signal', welch: 'averaged spectrum', noct_spectrum: '1/1 or 1/3 octave bands', stft: 'spectrum over time',
        cepstrum: 'real cepstrum', coherence: 'coherence between channels', csd: 'cross-spectral density', transfer_function: 'transfer function between channels',
        ifft: 'back to a time signal', noct_synthesis: 'octave bands from a spectrum', lifter: 'keep low or high quefrencies',
        to_spectral_envelope: 'smooth spectral envelope', absolute: 'magnitude', get_frame_at: 'the spectrum at one time', to_channel_frame: 'back to a time signal (inverse STFT)',
    },
    ja: {
        highpass_filter: '低い音を消す', lowpass_filter: '高い音を消す', bandpass_filter: '帯域だけ残す', a_weighting: '耳の感度で重み付け',
        hpss_harmonic: '音の調波成分だけ残す', hpss_percussive: '打撃的な成分だけ残す',
        normalize: '最大値を 1 に', remove_dc: '平均値を引く', trim: '時間範囲を残す', time_slice: '時間範囲を残す', fix_length: '長さをそろえる',
        fade: '両端をなめらかに', resampling: 'サンプリング周波数を変える', get_channel: '1 チャネルだけ残す', remove_channel: 'チャネルを外す',
        rename_channels: 'チャネル名を変える', with_calibration: '校正値を設定', with_source_time_offset: '時刻の起点をずらす',
        channel_difference: 'チャネルどうしの差', abs: '絶対値', power: 'べき乗', sum: 'チャネルの和', mean: 'チャネルの平均', astype: '数値の型を変える',
        index: '番号で選ぶ', select_pair: 'チャネルの組を 1 つ残す',
        rms_trend: '音量の時間変化', sound_level: '騒音レベルの時間変化', loudness_zwtv: 'ラウドネスの時間変化（Zwicker）', roughness_dw: 'ラフネスの時間変化',
        roughness_dw_spec: '臨界帯域ごとのラフネス', sharpness_din: 'シャープネスの時間変化（DIN）',
        fft: '全体の周波数成分', welch: '区間平均したスペクトル', noct_spectrum: '1/1・1/3 オクターブ帯域', stft: '成分の時間変化', cepstrum: '実ケプストラム',
        coherence: 'チャネル間のコヒーレンス', csd: 'クロススペクトル', transfer_function: 'チャネル間の伝達関数', ifft: '時間信号に戻す',
        noct_synthesis: 'スペクトルからオクターブ帯域', lifter: '低い／高いケフレンシーを残す', to_spectral_envelope: 'スペクトル包絡',
        absolute: '振幅', get_frame_at: 'ある時刻のスペクトル', to_channel_frame: '時間信号に戻す（逆 STFT）',
    },
};

/** One line on what the operation does; empty for one without a hint. */
export function operationHint(id: string, locale: string): string {
    return HINTS[locale === 'ja' ? 'ja' : 'en'][operationName(id)] ?? '';
}
