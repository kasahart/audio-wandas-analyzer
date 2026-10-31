"""Save the bottom panel's analysis as a wandas Recipe.

The workflow runs on silent stand-in frames shaped like the shown files and
``RecipePlan.from_frame`` keeps its operations, the way a user saves a Recipe
in a notebook, so the result is ordinary ``RecipePlan.to_dict()`` JSON that
``recipe_runner`` (or wandas itself) can replay on any matching file.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, NamedTuple, TypedDict

import numpy as np
import wandas as wd
from wandas.pipeline import RecipePlan

ENTRY_HPF_HZ = 20.0


class RecipeSource(NamedTuple):
    """One file the Recipe reads: what its stand-in must look like."""

    n_channels: int
    sampling_rate: float


class _WelchOptions(TypedDict, total=False):
    hop_length: int
    window: str


def _stand_in(source: RecipeSource, n_samples: int) -> wd.ChannelFrame:
    return wd.from_numpy(np.zeros((source.n_channels, n_samples)), sampling_rate=source.sampling_rate)


def spectrum_recipe(
    source: RecipeSource,
    *,
    n_fft: int,
    hop_length: int | None = None,
    window: str | None = None,
    bands: tuple[Sequence[float], int] | None = None,
    hpf_hz: float | None = None,
    trim: tuple[float, float | None] | None = None,
) -> dict[str, Any]:
    """Every channel's Welch spectrum, or its octave band levels when ``bands`` (centres, bands per octave) are given.

    ``hpf_hz`` high-passes the signal first and ``trim`` (seconds, end ``None`` = to the end) slices it
    next, which is where ``scan`` cuts the Recipe to take its region. Unset Welch settings stay at
    wandas' defaults.
    """
    signal = _stand_in(source, 2 * n_fft)
    if hpf_hz is not None:
        signal = signal.high_pass_filter(cutoff=hpf_hz)
    if trim is not None:
        signal = signal.trim(start=trim[0], end=trim[1])
    if bands:
        centers_hz, bands_per_octave = bands
        result = signal.noct_spectrum(fmin=centers_hz[0], fmax=centers_hz[-1], n=bands_per_octave)
    else:
        options: _WelchOptions = {}
        if hop_length is not None:
            options["hop_length"] = hop_length
        if window is not None:
            options["window"] = window
        result = signal.welch(n_fft=n_fft, **options)
    return RecipePlan.from_frame(result, input_names=("signal",)).to_dict()


def entry_scan_recipe() -> dict[str, Any]:
    """The fixed Recipe the entry table scans with (``recipes/entry-scan.recipe.json``).

    Its float parameters are hex-encoded in the JSON, so the file is generated here rather than written
    by hand; ``test_recipe_builder`` keeps the two equal.
    """
    from analysis_spec import WELCH_N_FFT

    # The entry table's only filtering: drops DC and rumble below the audible range.
    return spectrum_recipe(RecipeSource(1, 16000.0), n_fft=WELCH_N_FFT, hpf_hz=ENTRY_HPF_HZ, trim=(0.0, None))


def transfer_recipe(
    files: Sequence[RecipeSource],
    reference_channel: int,
    responses: Sequence[tuple[int, int]],
    *,
    n_fft: int,
    hop_length: int,
    window: str,
) -> dict[str, Any]:
    """Transfer function from the reference channel to each response channel.

    ``files[0]`` holds the reference and becomes input ``reference``; the others become ``response``,
    ``response 2``, … and must be listed in the order ``responses`` (``(file index, channel)`` pairs)
    first uses them, which is the order ``RecipePlan.from_frame`` discovers its inputs in.
    The inputs are assumed synchronized, so offsets between tracks are not replayed.
    """
    frames = [_stand_in(source, 2 * n_fft) for source in files]
    rate = files[0].sampling_rate

    def channel(file_index: int, channel_index: int) -> wd.ChannelFrame:
        # Every channel is resampled, a no-op at the same rate, so the Recipe still runs when it is
        # given files at other rates than the ones it was saved from.
        return frames[file_index].get_channel(channel_index).resampling(target_sr=rate)

    combined = channel(0, reference_channel)
    for index, response in enumerate(responses, start=1):
        combined = combined.concat_frame(channel(*response), suffix_on_dup=f"_{index}", align="truncate")
    transfer = combined.transfer_function(n_fft=n_fft, hop_length=hop_length, window=window)
    result = transfer.select_pairs([transfer.pair_row_index(index, 0) for index in range(1, len(responses) + 1)])
    names = ("reference", *(f"response {index}" if index > 1 else "response" for index in range(1, len(files))))
    return RecipePlan.from_frame(result, input_names=names).to_dict()
