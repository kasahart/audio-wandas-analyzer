import type { AudioFader } from './audioFade';

type RetiredAudio = Pick<HTMLAudioElement, 'removeAttribute' | 'remove' | 'muted' | 'paused' | 'pause'>;

/**
 * Takes a track's audio element out of use: it loses its id at once (so a new element can take it), fades out,
 * and is removed once quiet. `parking` keeps it in the document meanwhile; detaching it would cut it off.
 */
export function retireAudio(audio: RetiredAudio & Node, fader: Pick<AudioFader, 'pauseSmoothly' | 'release'>, parking?: Node): void {
    audio.removeAttribute('id');
    parking?.appendChild(audio);
    fader.pauseSmoothly(audio, function () {
        audio.remove();
        fader.release(audio);
    });
}

/** Swaps every audio element in `audioHost` for the ones `html` builds; the old ones fade out in `document.body`. */
export function replaceTrackAudio(document: Document, audioHost: HTMLElement, html: string, fader: Pick<AudioFader, 'pauseSmoothly' | 'release'>): void {
    audioHost.querySelectorAll('audio').forEach(function (audio) {
        retireAudio(audio, fader, document.body);
    });
    audioHost.innerHTML = html;
}
