import type { UiStrings } from '../../shared/i18n/strings';
import { SUPPORTED_AUDIO_FILE_EXTENSIONS } from '../../shared/utils/audioTarget';
import { setHint } from './hintFooter';
import { keyRouterFor } from './keyRouter';
import type { PythonState } from './staticWorker';

/** Actions the browser version cannot run: greyed out, and a press says why instead of acting. */
const UNAVAILABLE_ACTIONS = '[data-action="configure-calibration"]';

/** The Web version's footer controls, beside the runtime's hint text and version. */
export interface StaticFooter {
    /** Holds the hidden file inputs and the host's other in-page parts (the drop outline). */
    bar: HTMLElement;
    /** The hidden file and folder inputs the page's own buttons open. */
    pick: HTMLInputElement;
    folderPick: HTMLInputElement;
    /** The status line. */
    announce: (value: string) => void;
    /** `quiet`: a restart the user did not ask for (after a folder scan) keeps to the footer dot, without the centred card. */
    showPythonState: (state: PythonState, quiet?: boolean) => void;
    /** Says in the hint footer, and to screen readers, that the browser version cannot do this. */
    reportUnavailable: () => void;
}

export function createStaticFooter(document: Document, window: Window, strings: UiStrings): StaticFooter {
    // The status line, About and the Python dot share the footer row with the hint text, so the page has no header row.
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0;max-width:60%;padding-right:8px';
    const pick = document.createElement('input');
    pick.setAttribute('data-action', 'browser-open-wav');
    pick.type = 'file'; pick.multiple = true; pick.accept = Array.from(SUPPORTED_AUDIO_FILE_EXTENSIONS).join(','); pick.setAttribute('aria-label', strings.btnOpenFile);
    // The native file input labels itself in the browser's UI language, so a page-language button opens it instead.
    pick.style.cssText = 'display:none';
    const folderPick = document.createElement('input');
    folderPick.type = 'file'; folderPick.multiple = true; folderPick.setAttribute('webkitdirectory', '');
    folderPick.style.cssText = 'display:none';
    // Python's state is a coloured dot at the footer's right end; its text stays for screen readers and the hover hint.
    const pythonIndicator = document.createElement('span');
    pythonIndicator.setAttribute('data-python-indicator', '');
    pythonIndicator.style.cssText = 'display:flex;align-items:center;flex-shrink:0;padding-right:10px';
    const pythonDot = document.createElement('span');
    pythonDot.style.cssText = 'width:8px;height:8px;border-radius:50%';
    const pythonState = document.createElement('span');
    pythonState.setAttribute('data-python-state', '');
    pythonState.setAttribute('aria-live', 'polite');
    pythonState.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    pythonIndicator.append(pythonDot, pythonState);
    // Limits and unavailable features matter only to some visitors, so they sit behind a disclosure instead of a permanent paragraph.
    const about = document.createElement('details');
    about.setAttribute('data-browser-about', '');
    about.style.cssText = 'position:relative';
    const aboutToggle = document.createElement('summary');
    aboutToggle.setAttribute('data-action', 'browser-about');
    aboutToggle.textContent = strings.browserAbout;
    aboutToggle.style.cssText = 'cursor:pointer;list-style:none;color:var(--muted);white-space:nowrap';
    setHint(aboutToggle, strings.hintBrowserAbout);
    const aboutPanel = document.createElement('ul');
    aboutPanel.style.cssText = 'position:absolute;bottom:calc(100% + 6px);right:0;z-index:60;width:max-content;max-width:min(480px,calc(100vw - 16px));margin:0;'
        + 'padding:10px 14px 10px 28px;display:grid;gap:4px;background:var(--panel);color:var(--text);border:1px solid var(--line);'
        + 'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font-size:13px;line-height:1.5';
    for (const text of [strings.browserAboutPrivacy, strings.browserAboutFileLimits, strings.browserAboutSessionLimits, strings.browserAboutRecipes, strings.browserAboutUnsupported]) {
        const item = document.createElement('li');
        item.textContent = text;
        aboutPanel.append(item);
    }
    about.append(aboutToggle, aboutPanel);
    // The disclosure sits at the footer's right end, so the panel opens leftwards and shifts back inside a window narrower than it.
    const clampAbout = (): void => {
        if (!about.open) return;
        aboutPanel.style.right = '0px';
        const overflow = 8 - aboutPanel.getBoundingClientRect().left;
        if (overflow > 0) aboutPanel.style.right = `${-overflow}px`;
    };
    about.ontoggle = clampAbout;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    // Web-only rules: room for the Python dot in the footer, and greyed-out actions the browser version cannot run.
    const webStyles = document.createElement('style');
    // The lane view's status line ("3 tracks; add more") means nothing while the entry table covers the window;
    // docked beside the lanes, the lanes are on screen and their status stays.
    webStyles.textContent = 'body:has(#entry-screen.is-max:not([hidden])) #app-footer [role="status"] { visibility: hidden; }'
        + ` ${UNAVAILABLE_ACTIONS} { opacity: 0.4; cursor: not-allowed; }`
        + ' @keyframes python-dot-pulse { 50% { opacity: 0.3; } }';
    bar.append(pick, folderPick, status, about, webStyles);
    // The footer row keeps the version at its right end, after the Web controls.
    const appVersion = document.getElementById('app-version');
    if (appVersion) appVersion.before(bar, pythonIndicator);
    else (document.getElementById('app-footer') ?? document.body).append(bar, pythonIndicator);
    // The toolbar text alone was easy to miss, so the boot also shows a centred card; it ignores pointer events because commands already wait for the boot.
    const pythonLoading = document.createElement('div');
    pythonLoading.setAttribute('data-python-loading', '');
    pythonLoading.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:70;pointer-events:none;'
        + 'display:flex;align-items:center;gap:12px;padding:16px 24px;background:var(--panel);color:var(--text);border:1px solid var(--line);'
        + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font-family:var(--font-ui);font-size:14px';
    const pythonSpinner = document.createElement('span');
    pythonSpinner.style.cssText = 'width:18px;height:18px;border:3px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:python-loading-spin 0.8s linear infinite';
    const pythonLoadingText = document.createElement('span');
    pythonLoadingText.textContent = strings.browserPythonStarting;
    const pythonSpinnerKeyframes = document.createElement('style');
    pythonSpinnerKeyframes.textContent = '@keyframes python-loading-spin { to { transform: rotate(360deg); } }';
    pythonLoading.append(pythonSpinner, pythonLoadingText, pythonSpinnerKeyframes);
    document.body.prepend(pythonLoading);
    const pythonStates: Record<PythonState, { text: string; color: string }> = {
        // Yellow and green are the compare and Δ roles on the new screens: the status dot stays neutral (the boot pulses).
        starting: { text: strings.browserPythonStarting, color: 'var(--muted)' },
        ready: { text: strings.browserPythonReady, color: 'var(--text)' },
        failed: { text: strings.browserPythonFailed, color: '#e5534b' },
        stopped: { text: strings.browserPythonStopped, color: 'var(--muted)' },
    };
    function showPythonState(state: PythonState, quiet = false): void {
        const { text, color } = pythonStates[state];
        const booting = state === 'starting';
        pythonState.textContent = text;
        setHint(pythonIndicator, text);
        pythonDot.style.background = color;
        pythonDot.style.animation = booting ? 'python-dot-pulse 1.2s ease-in-out infinite' : 'none';
        pythonLoading.style.display = booting && !quiet ? 'flex' : 'none';
    }
    const announce = (value: string): void => { status.textContent = value; };
    const showInFooter = (value: string): void => { const footer = document.getElementById('hint-footer'); if (footer) footer.textContent = value; };
    // Window listeners run around the runtime's document ones: the capture-phase click stops the action first,
    // and the bubble-phase mouseover replaces the hint the runtime has just shown.
    const unavailableTarget = (event: Event): Element | null | undefined => (event.target as Element | null)?.closest?.(UNAVAILABLE_ACTIONS);
    // The footer is aria-hidden, so a visually hidden live region carries the same message to screen readers.
    const unavailableAnnouncer = document.createElement('span');
    unavailableAnnouncer.setAttribute('aria-live', 'polite');
    unavailableAnnouncer.style.cssText = pythonState.style.cssText;
    bar.append(unavailableAnnouncer);
    const reportUnavailable = (): void => {
        showInFooter(strings.browserUnavailable);
        unavailableAnnouncer.textContent = strings.browserUnavailable;
    };
    window.addEventListener('click', event => {
        if (!unavailableTarget(event)) return;
        event.stopPropagation(); event.preventDefault();
        reportUnavailable();
    }, true);
    window.addEventListener('mouseover', event => { if (unavailableTarget(event)) showInFooter(strings.browserUnavailable); });
    // The runtime builds these buttons, so they are marked unavailable for assistive technology when they gain focus.
    window.addEventListener('focusin', event => {
        const target = unavailableTarget(event);
        if (!target) return;
        target.setAttribute('aria-disabled', 'true');
        target.setAttribute('aria-description', strings.browserUnavailable);
    });
    window.addEventListener('pointerdown', event => { if (about.open && !about.contains(event.target as Node)) about.open = false; });
    window.addEventListener('resize', clampAbout);
    keyRouterFor(window).add({
        layer: 'popover',
        keydown(event) {
            if (!about.open || event.key !== 'Escape') return false;
            about.open = false;
            aboutToggle.focus();
            return true;
        },
    });
    return { bar, pick, folderPick, announce, showPythonState, reportUnavailable };
}
