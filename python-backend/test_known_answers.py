"""Known answers across views: a tone of known frequency and level reads the same wherever it is drawn.

Each view (the cursor spectrum under the tracks, Compare's spectra, before and after a zoom, and band levels) is
checked against the answer the signal was made with, not against its own previous output, so two views that
disagree with each other cannot both pass (docs/display-rules.md R1-R3).
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from stage_view import stage_view

RATE = 48_000
TONE_HZ = 1000.0
#: The tone's peak amplitude 0.5: -6.02 dB re 1 as an amplitude spectrum, -9.03 dB as an RMS band level.
AMPLITUDE = 0.5
PEAK_DB = 20 * np.log10(AMPLITUDE)
RMS_DB = 20 * np.log10(AMPLITUDE / np.sqrt(2))
#: A Hann window reads a tone between two bins up to 1.42 dB low (scalloping); on a bin it reads it exactly.
HANN_SCALLOP_DB = 1.45
#: The second channel: ten times quieter, at another frequency.
SECOND_HZ, SECOND_AMPLITUDE = 2500.0, 0.05


@pytest.fixture(scope="module")
def tones(tmp_path_factory: pytest.TempPathFactory) -> Path:
    t = np.arange(RATE * 2) / RATE
    rows = np.stack(
        [AMPLITUDE * np.sin(2 * np.pi * TONE_HZ * t), SECOND_AMPLITUDE * np.sin(2 * np.pi * SECOND_HZ * t)], axis=1
    )
    path = tmp_path_factory.mktemp("known") / "tones.wav"
    sf.write(path, rows, RATE, subtype="FLOAT")
    return path


def _slice_peak(result: dict, channel: int) -> tuple[float, float, float]:
    values = np.asarray(result["channels"][channel]["values"], dtype=float)
    index = int(np.argmax(values))
    step = result["maxFrequencyHz"] / (2 * (result.get("frequencyBins", 2) - 1))
    if "frequenciesHz" in result:
        return float(result["frequenciesHz"][index]), float(values[index]), step
    if "bandCentersHz" in result:
        return float(result["bandCentersHz"][index]), float(values[index]), 0.0
    return index * result["maxFrequencyHz"] / (result["frequencyBins"] - 1), float(values[index]), step


def _view_peak(view: dict) -> tuple[float, float]:
    values = np.asarray([np.nan if value is None else value for value in view["values"]], dtype=float)
    index = int(np.nanargmax(values))
    return float(view["xs"][index]), float(values[index])


@pytest.mark.parametrize("full_resolution", [False, True])
def test_the_cursor_spectrum_reads_each_channels_tone_at_its_frequency_and_amplitude(
    tones: Path, full_resolution: bool
) -> None:
    n_fft = 8192
    result = AnalysisService(AnalysisEngine()).spectrum_slice(
        tones,
        cursor_norm=0.5,
        stft_options={"nFft": n_fft, "overlapPercent": 75, "window": "hann"},
        full_resolution=full_resolution,
    )
    # A row cut for display (8192-point FFT, more bins than the panel's budget) keeps each tone's bin and level.
    assert ("frequenciesHz" in result) is not full_resolution
    bin_hz = RATE / n_fft
    for channel, (hz, amplitude) in enumerate([(TONE_HZ, AMPLITUDE), (SECOND_HZ, SECOND_AMPLITUDE)]):
        frequency, level, _ = _slice_peak(result, channel)
        assert abs(frequency - hz) <= bin_hz / 2 + 1e-9
        assert 20 * np.log10(amplitude) - HANN_SCALLOP_DB <= level <= 20 * np.log10(amplitude) + 0.05


def test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks(tones: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    options = {"nFft": 16384, "overlapPercent": 75, "window": "hann"}
    shown = service.spectrum_slice(tones, cursor_norm=0.3, stft_options=options)
    full = service.spectrum_slice(tones, cursor_norm=0.3, stft_options=options, full_resolution=True)
    for channel in range(2):
        assert _slice_peak(shown, channel)[:2] == pytest.approx(_slice_peak(full, channel)[:2], abs=1e-3)


@pytest.mark.parametrize("operation", ["fft", "welch"])
def test_compare_reads_the_tone_at_its_frequency_and_amplitude_before_and_after_a_zoom(
    tones: Path, operation: str
) -> None:
    frame = wd.read_wav(str(tones)).get_channel(0)
    spectrum = frame.fft() if operation == "fft" else frame.welch(n_fft=4096)
    bin_hz = float(np.asarray(spectrum.freqs)[1])
    whole = stage_view(spectrum)
    zoomed = stage_view(spectrum, None, {"x": [800.0, 1250.0], "points": 400})
    for view in (whole, zoomed):
        frequency, level = _view_peak(view)
        assert abs(frequency - TONE_HZ) <= bin_hz / 2 + 1e-9
        assert PEAK_DB - HANN_SCALLOP_DB <= level <= PEAK_DB + 0.05
    # A zoom draws the same peak the whole picture drew.
    assert _view_peak(zoomed)[1] == pytest.approx(_view_peak(whole)[1], abs=0.02)


def test_band_levels_read_the_tones_rms_in_the_cursor_spectrum_and_in_compare(tones: Path) -> None:
    bands = AnalysisService(AnalysisEngine()).spectrum_slice(
        tones, cursor_norm=0.5, stft_options={"nFft": 8192, "overlapPercent": 75, "window": "hann"}, bands_per_octave=3
    )
    frequency, level, _ = _slice_peak(bands, 0)
    assert frequency == pytest.approx(TONE_HZ) and level == pytest.approx(RMS_DB, abs=0.3)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        noct = wd.read_wav(str(tones)).get_channel(0).noct_spectrum(fmin=25.0, fmax=12500.0, n=3)
    frequency, compare_level = _view_peak(stage_view(noct))
    assert frequency == pytest.approx(TONE_HZ) and compare_level == pytest.approx(RMS_DB, abs=0.3)
    # The same band reads the same level under the tracks and in Compare.
    assert compare_level == pytest.approx(level, abs=0.3)
