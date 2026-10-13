import { formatClockTime } from '../../shared/utils/format';

/**
 * Shows the playing position in `#playback-display`. The element is looked up on each update because the
 * toolbar can be rebuilt, while the last written state is cached so per-frame updates skip unchanged DOM writes.
 */
export function createPlaybackDisplay(doc: Document, prefix: string): (timeSec: number | null) => void {
    let visible = false;
    let shownText = '';
    return function update(timeSec) {
        const el = doc.getElementById('playback-display');
        if (!el) {
            return;
        }
        if (timeSec === null) {
            if (visible) {
                el.style.display = 'none';
                el.textContent = '';
                visible = false;
                shownText = '';
            }
            return;
        }
        const text = prefix + ' ' + formatClockTime(timeSec);
        if (!visible) {
            el.style.display = 'inline';
            visible = true;
        }
        if (text !== shownText) {
            el.textContent = text;
            shownText = text;
        }
    };
}
