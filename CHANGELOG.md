# Changelog

User-visible changes per release. Pull requests add a line under **Unreleased**; the release PR turns it into the version heading (the tag `vX.Y.Z` must match `package.json`).

## Unreleased

- Analysis chain: entry table for up to 100,000 recordings, a dataset table with distributions, a step bar that builds a wandas Recipe, and per-folder sessions (#410, #414, #415).
- Compare view: roles per recording, the tracks' selection carried in as the region, recordings drawn as they are computed, cross-correlation (#452–#456, #468, #472).
- Track lanes: waveform over spectrogram on one time axis, linked amplitude/colour/frequency scales, only lanes near the view drawn and fetched (#427, #442, #444).
- Cursor spectrum snaps to the nearest STFT frame; spectrogram cells centred on their windows (#436, #438).
- Trackpad sideways swipe pans the timeline (#471).
- Python backend answers requests for different recordings concurrently and reads audio straight into float32 (#462, #464).
- Updated to wandas 0.12.0 (#409, #446, #468).
- Review fixes: stuck spectrogram errors, cache thrash, UTF-8 stdio, VSIX contents.
- Tooling: CI runs verify on Linux, Windows and macOS; releases publish only after every CI job passes; pinned CI Python packages; Dependabot.

## 0.0.14

- Marketplace icon shrunk below the upload limit (#405).

## 0.0.13

- Save the bottom-panel analysis as a wandas Recipe (#396).
- Recipe replay checked on other inputs, per-command validation (#399).
- README points to the browser version; Marketplace tags listed (#401).
