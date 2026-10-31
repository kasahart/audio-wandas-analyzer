import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { replaceTrackAudio, retireAudio } from '../webview/runtime/trackAudioHost';

function fakeFader() {
    const calls: string[] = [];
    const afters: Array<() => void> = [];
    return {
        calls,
        finishFades: () => afters.splice(0).forEach(after => after()),
        pauseSmoothly(_el: unknown, after?: () => void) { calls.push('pause'); if (after) afters.push(after); },
        release() { calls.push('release'); },
    };
}

test('a retired element gives up its id at once and is removed only after its fade', () => {
    const { document } = new JSDOM('<div id="host"><audio id="audio-0"></audio></div>').window;
    const audio = document.querySelector('audio');
    assert.ok(audio);
    const fader = fakeFader();
    retireAudio(audio, fader);
    assert.equal(audio.id, '');
    assert.equal(audio.isConnected, true);
    assert.deepEqual(fader.calls, ['pause']);
    fader.finishFades();
    assert.equal(audio.isConnected, false);
    assert.deepEqual(fader.calls, ['pause', 'release']);
});

test('replaced audio fades out in the body while the new elements take the host', () => {
    const { document } = new JSDOM('<div id="host"><audio id="audio-0"></audio><audio id="audio-1"></audio></div>').window;
    const host = document.getElementById('host');
    assert.ok(host);
    const fader = fakeFader();
    replaceTrackAudio(document, host, '<audio id="audio-0" data-new></audio>', fader);
    assert.deepEqual(Array.from(host.querySelectorAll('audio')).map(audio => audio.hasAttribute('data-new')), [true]);
    assert.equal(document.getElementById('audio-0')?.hasAttribute('data-new'), true);
    const parked = Array.from(document.body.children).filter(child => child.tagName === 'AUDIO');
    assert.equal(parked.length, 2);
    fader.finishFades();
    assert.equal(document.querySelectorAll('audio').length, 1);
    assert.deepEqual(fader.calls, ['pause', 'pause', 'release', 'release']);
});
