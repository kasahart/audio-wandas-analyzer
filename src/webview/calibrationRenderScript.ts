export function getCalibrationRenderScript(): string {
    return `
        (function() {
            const vscode = acquireVsCodeApi();
            const state = __APP_STATE__;
            const app = document.getElementById('app');
            let decorationPending = false;
            let observer = null;

            function activeTracks() {
                if (typeof window.__AWA_ACTIVE_TRACKS__ === 'function') {
                    return window.__AWA_ACTIVE_TRACKS__();
                }
                return (state.results || []).map(function(result, trackIndex) {
                    return { trackIndex: trackIndex, result: result };
                });
            }

            function channelsForResult(result) {
                return result && Array.isArray(result.channels) ? result.channels : [];
            }

            function measurementFor(channel) {
                return channel && channel.measurement ? channel.measurement : null;
            }

            function formatNumber(value) {
                const numberValue = Number(value);
                if (!Number.isFinite(numberValue)) { return '—'; }
                const absolute = Math.abs(numberValue);
                if (absolute >= 100) { return numberValue.toFixed(0); }
                if (absolute >= 1) { return numberValue.toFixed(2); }
                if (absolute >= 0.01) { return numberValue.toFixed(3); }
                return numberValue.toPrecision(3);
            }

            function setText(element, text) {
                if (element && element.textContent !== text) {
                    element.textContent = text;
                }
            }

            function levelText(channel, linearKey, levelKey, prefix) {
                const measurement = measurementFor(channel);
                const level = channel && Number(channel[levelKey]);
                if (!measurement || !Number.isFinite(level)) { return null; }
                const levelPart = level.toFixed(1) + ' ' + measurement.levelUnit;
                if (measurement.calibrationStatus === 'uncalibrated') {
                    return prefix + ' ' + levelPart;
                }
                return prefix + ' ' + formatNumber(channel[linearKey]) + ' ' + measurement.linearUnit
                    + ' / ' + levelPart;
            }

            function channelLabel(result, channelIndex) {
                const channels = channelsForResult(result);
                const channel = channels[channelIndex];
                const count = channels.length;
                const base = 'Channel ' + (channelIndex + 1) + (count > 1 ? ' / ' + count : '');
                return channel && channel.label && channel.label !== 'Channel ' + (channelIndex + 1)
                    ? base + ' (' + channel.label + ')'
                    : base;
            }

            function calibrationSummary(channels) {
                const calibrated = channels.filter(function(channel) {
                    const measurement = measurementFor(channel);
                    return measurement && measurement.calibrationStatus === 'calibrated';
                });
                if (calibrated.length === 0) {
                    return { text: 'FS', title: 'Uncalibrated full scale (dBFS)' };
                }
                if (calibrated.length !== channels.length) {
                    return { text: 'PARTIAL', title: 'Some channels use physical calibration' };
                }
                const units = Array.from(new Set(calibrated.map(function(channel) {
                    return measurementFor(channel).linearUnit;
                })));
                return {
                    text: units.length === 1 ? 'CAL: ' + units[0] : 'CAL',
                    title: calibrated.map(function(channel) {
                        const measurement = measurementFor(channel);
                        return measurement.linearUnit + '; factor ' + measurement.factor
                            + '; ' + measurement.levelReferenceLabel;
                    }).join(' | '),
                };
            }

            function ensureStyles() {
                if (document.getElementById('calibration-runtime-styles')) { return; }
                const style = document.createElement('style');
                style.id = 'calibration-runtime-styles';
                style.textContent = [
                    '.calibration-badge{display:inline-block;border:1px solid var(--line);border-radius:2px;padding:0 3px;margin-left:3px;font-size:8px;font-weight:700;color:var(--accent);white-space:nowrap}',
                    '.calibration-overlay-warning{position:absolute;inset:6px 10px;z-index:4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;background:var(--track-bg);color:var(--muted);font-size:11px;border:1px dashed var(--line);border-radius:4px}',
                ].join('');
                document.head.appendChild(style);
            }

            function updateMetricSpans(container, channel, labelOffset) {
                if (!container) { return; }
                const spans = Array.from(container.children).filter(function(child) {
                    return child.tagName === 'SPAN';
                });
                const rmsText = levelText(channel, 'rms', 'rmsLevelDb', 'RMS');
                const peakText = levelText(channel, 'peakAbsolute', 'peakLevelDb', 'Peak');
                if (rmsText && spans[labelOffset]) { setText(spans[labelOffset], rmsText); }
                if (peakText && spans[labelOffset + 1]) { setText(spans[labelOffset + 1], peakText); }
            }

            function ensureCalibrationButton(buttons, result, trackIndex, channels) {
                if (!buttons || buttons.querySelector('[data-action="configure-calibration"]')) { return; }
                const button = document.createElement('button');
                button.className = 'track-btn';
                button.setAttribute('data-action', 'configure-calibration');
                button.title = 'Configure per-channel calibration';
                button.setAttribute('aria-label', 'Configure calibration');
                button.textContent = 'Cal';
                button.addEventListener('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    vscode.postMessage({
                        type: 'configure-calibration',
                        trackIndex: trackIndex,
                        filePath: result.filePath,
                        channels: channels.map(function(channel, channelIndex) {
                            return {
                                channelIndex: channelIndex,
                                label: channel.label || 'Channel ' + (channelIndex + 1),
                            };
                        }),
                    });
                });
                buttons.appendChild(button);
            }

            function updateBadges(titleRow, channels) {
                if (!titleRow) { return; }
                const summary = calibrationSummary(channels);
                let calibrationBadge = titleRow.querySelector('.calibration-badge');
                if (!calibrationBadge) {
                    calibrationBadge = document.createElement('span');
                    calibrationBadge.className = 'calibration-badge';
                    titleRow.appendChild(calibrationBadge);
                }
                setText(calibrationBadge, summary.text);
                if (calibrationBadge.title !== summary.title) {
                    calibrationBadge.title = summary.title;
                }

                const clipped = channels.some(function(channel) {
                    if (!channel) { return false; }
                    if (channel.clipped !== undefined) { return channel.clipped === true; }
                    const rawPeak = Number(channel.rawPeakFullScale);
                    if (Number.isFinite(rawPeak)) { return rawPeak >= 0.99; }
                    const measurement = measurementFor(channel);
                    return (!measurement || measurement.calibrationStatus === 'uncalibrated')
                        && Number(channel.peakAbsolute) >= 0.99;
                });
                let clipBadge = titleRow.querySelector('.clip-badge');
                if (!clipped) {
                    if (clipBadge) { clipBadge.remove(); }
                    return;
                }
                if (!clipBadge) {
                    clipBadge = document.createElement('span');
                    clipBadge.className = 'clip-badge';
                    titleRow.appendChild(clipBadge);
                }
                setText(clipBadge, 'CLIP');
                clipBadge.title = 'Raw source peak reached the full-scale clipping threshold';
            }

            function decorateTrack(result, trackIndex) {
                const row = document.getElementById('track-row-' + trackIndex);
                if (!row || !result) { return; }
                const channels = channelsForResult(result);
                ensureCalibrationButton(row.querySelector('.track-btns'), result, trackIndex, channels);
                updateBadges(row.querySelector('.track-title-row'), channels);

                if (channels.length === 1) {
                    updateMetricSpans(row.querySelector('.track-meta'), channels[0], 0);
                    return;
                }
                channels.forEach(function(channel, channelIndex) {
                    const lane = row.querySelector('.track-channel-lane[data-channel-index="' + channelIndex + '"]');
                    updateMetricSpans(lane && lane.querySelector('.track-channel-lane-header'), channel, 1);
                });
            }

            function visibleLevelReferences() {
                const references = [];
                document.querySelectorAll('.track-row').forEach(function(row) {
                    if (row.style.display === 'none') { return; }
                    const match = /^track-row-(\\d+)$/.exec(row.id);
                    if (!match) { return; }
                    const trackIndex = Number(match[1]);
                    const track = activeTracks().find(function(candidate) {
                        return candidate.trackIndex === trackIndex;
                    });
                    const result = track && track.result;
                    channelsForResult(result).forEach(function(channel) {
                        const measurement = measurementFor(channel);
                        if (!measurement) { return; }
                        references.push([
                            measurement.levelUnit,
                            measurement.referenceValue,
                            measurement.referenceUnit,
                            measurement.levelReferenceLabel,
                        ].join('|'));
                    });
                });
                return Array.from(new Set(references));
            }

            function updateOverlayCompatibility() {
                const wrap = document.getElementById('spectrum-overlay-wrap');
                const canvas = document.getElementById('spectrum-overlay-canvas');
                if (!wrap || !canvas) { return; }
                let warning = wrap.querySelector('.calibration-overlay-warning');
                const incompatible = visibleLevelReferences().length > 1;
                if (canvas.style.visibility !== (incompatible ? 'hidden' : '')) {
                    canvas.style.visibility = incompatible ? 'hidden' : '';
                }
                if (!incompatible) {
                    if (warning) { warning.remove(); }
                    return;
                }
                if (!warning) {
                    warning = document.createElement('div');
                    warning.className = 'calibration-overlay-warning';
                    warning.textContent = 'Spectrum overlay is unavailable because visible channels use incompatible level references. Per-channel spectra remain available.';
                    wrap.appendChild(warning);
                }
            }

            function observeApp() {
                if (observer && app) {
                    observer.observe(app, { childList: true, subtree: true });
                }
            }

            function decorate() {
                decorationPending = false;
                if (observer) { observer.disconnect(); }
                try {
                    ensureStyles();
                    activeTracks().forEach(function(track) {
                        decorateTrack(track.result, track.trackIndex);
                    });
                    updateOverlayCompatibility();
                } finally {
                    observeApp();
                }
            }

            function scheduleDecoration() {
                if (decorationPending) { return; }
                decorationPending = true;
                requestAnimationFrame(decorate);
            }

            window.addEventListener('message', function(event) {
                const message = event.data;
                if (!message) { return; }
                if (message.type === 'calibration-configured') {
                    const settings = window.__AWA_SPECTROGRAM_SETTINGS__
                        ? window.__AWA_SPECTROGRAM_SETTINGS__
                        : {
                            auto: true,
                            stft: { nFft: 1024, hopSize: 256, window: 'hann' },
                            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
                        };
                    vscode.postMessage({ type: 'request-reanalyze', settings: settings });
                    return;
                }
                if (message.type === 'analysis-update') {
                    scheduleDecoration();
                }
            });

            observer = new MutationObserver(scheduleDecoration);
            observeApp();
            scheduleDecoration();
        })();
    `;
}
