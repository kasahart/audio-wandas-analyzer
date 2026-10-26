"""Analysis spec: the fixed metrics ``scan`` takes from every file's region frame.

The entry table compares numbers across files, so how each number is computed is pinned here and
versioned. Changing any value below changes what a cached number means: bump
``ANALYSIS_SPEC_VERSION`` with it, since the version is part of every condition ID.
"""

from __future__ import annotations

# v2: no high-pass of its own; filtering is the Recipe's (the entry Recipe high-passes at 20 Hz).
# v3: 1/3-octave bands whose centre lies outside the Recipe's filter passband are null; the spectrum
# follows the Recipe's average-spectrum step (n_fft, window).
# v4: the spectrum's 192 points are log-spaced from SPECTRUM_MIN_HZ to Nyquist, so the low bands are as
# wide on screen as the high ones.
# v5: the 20 Hz 1/3-octave band is measured (wandas 0.10 computes it; 0.9 could not).
ANALYSIS_SPEC_VERSION = 5

# wandas filters zero-phase (filtfilt), so a Recipe's filters ring at both ends of the file: left in, the
# entry Recipe's 20 Hz high-pass raises a pure tone's crest factor from 1.41 to 2.08. Metrics skip this
# much of a region where it touches the file's start or end, which brings the tone back within 0.1 %.
EDGE_GUARD_S = 0.15
WELCH_N_FFT = 1024
# Same display resolution as the comparison view's spectra (analyzer.SPECTROGRAM_FREQUENCY_BIN_LIMIT).
SPECTRUM_POINTS = 192
# The spectrum's lowest point edge; points are geometric means of log-spaced edges up to Nyquist.
SPECTRUM_MIN_HZ = 20.0
# Lowest frequency the dominant-component search looks at.
PEAK_MIN_HZ = 20.0
# Nominal 1/3-octave centres the result always reports, 20 Hz to 8 kHz; bands a file cannot give are null.
THIRD_OCTAVE_CENTERS_HZ: tuple[float, ...] = (
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0,
)  # fmt: skip
# MoSQITo rejects band centres above 0.88 × Nyquist.
THIRD_OCTAVE_NYQUIST_FRACTION = 0.88
# Reported decimals: levels in dB, frequencies in whole Hz, crest factor as a ratio.
DB_DECIMALS = 2
CREST_DECIMALS = 3
# Floor for levels of silent channels, which would otherwise be -inf and not JSON.
MIN_LEVEL_DB = -300.0
