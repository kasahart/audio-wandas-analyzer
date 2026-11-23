/**
 * answers/ (figure-design.md 第 6 節): the figure service's requests from the webview. Per Figure and kind at
 * most one runs and one (the latest) waits; a click's read is counted apart; only the newest draw's reply is used; a
 * superseded draw is cancelled where the host can (VS Code) and run out where it cannot (the browser's Worker);
 * disposing releases the Figure's holdings, and a draw reply after it releases them again; the keys carry the answer
 * store's freshness in the service's words.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFigureAnswers, type FigureHostChannel } from '../webview/answers/figureRequests';
import { answersLetGo, figureKey, keysChange, keyState, type AnswerFreshness } from '../webview/answers/figureKeys';
import type { Answer } from '../webview/runtime/answerTypes';
import type { FigureCancelMessage, FigureRequestMessage } from '../shared/protocol/figureMessages';
import type { FigureSpec } from '../shared/protocol/generated/backendProtocolSchema';

const SPEC: FigureSpec = { lanes: [{ id: 'l', kind: 'lines', lines: [{ id: 'a', of: { key: 'k' } }] }], keys: [{ key: 'k', state: 'usable', version: 'v' }] };

function host(cancels: boolean, holds = false) {
    const posted: Array<FigureRequestMessage | FigureCancelMessage> = [];
    const channel: FigureHostChannel = { cancels, holdsReadsWhileComputing: holds, post: message => { posted.push(message); } };
    const answers = createFigureAnswers(channel);
    const requests = (command: string) => posted.filter((message): message is FigureRequestMessage => message.type === 'figure-request' && message.command === command);
    const reply = (message: FigureRequestMessage, result: unknown): void => { answers.handle({ type: 'figure-result', requestId: message.requestId, command: message.command, result }); };
    return { posted, answers, requests, reply };
}
const drawReply = (message: FigureRequestMessage, picture = 'p') => {
    const payload = message.payload as { figureId: string; generation: number; requestNumber: number };
    return { status: 'picture', figureId: payload.figureId, generation: payload.generation, requestNumber: payload.requestNumber, pictureId: picture, dataId: 'd', lanes: [], headlines: [] };
};

test('draws: one runs and the latest waits, never more; only the newest draw\'s reply is used; VS Code cancels the stale running one', () => {
    const { answers, requests, reply, posted } = host(true);
    const figure = answers.figure();
    const got: number[] = [];
    for (let generation = 1; generation <= 6; generation++) {
        figure.draw({ generation, spec: SPEC, width: 100, height: 50 }, result => { got.push(result?.generation ?? -1); });
        const queued = figure.queued('draw');
        assert.ok(queued.running <= 1 && queued.waiting <= 1, `generation ${generation}: ${JSON.stringify(queued)}`);
    }
    assert.equal(requests('figure-draw').length, 1, 'only the first was sent; the latest waits');
    assert.ok(posted.some(message => message.type === 'figure-cancel' && message.requestIds.includes(requests('figure-draw')[0].requestId)), 'the stale running draw is cancelled (VS Code)');
    reply(requests('figure-draw')[0], drawReply(requests('figure-draw')[0]));
    assert.deepEqual(got, [], 'the stale draw\'s reply is not used');
    const latest = requests('figure-draw')[1];
    assert.equal((latest.payload as { generation: number }).generation, 6, 'the latest is sent next; the ones between were dropped');
    reply(latest, drawReply(latest));
    assert.deepEqual(got, [6]);
});

test('the browser\'s Worker cannot cancel: a superseded draw runs out, and nothing asks it to stop', () => {
    const { answers, posted } = host(false);
    const figure = answers.figure();
    figure.draw({ generation: 1, spec: SPEC, width: 100, height: 50 }, () => undefined);
    figure.draw({ generation: 2, spec: SPEC, width: 100, height: 50 }, () => undefined);
    assert.equal(posted.filter(message => message.type === 'figure-cancel').length, 0);
});

test('draws that only moved (a scroll held on): the running draw is not stopped and its picture is delivered though a newer waits; a draw of another spec ends that', () => {
    const { answers, requests, reply, posted } = host(true);
    const figure = answers.figure();
    const got: number[] = [];
    const draw = (generation: number, moved: boolean): void => { figure.draw({ generation, spec: SPEC, width: 100, height: 50 }, result => { got.push(result?.generation ?? -1); }, moved); };
    draw(1, false);
    draw(2, true);
    draw(3, true);
    assert.equal(posted.filter(message => message.type === 'figure-cancel').length, 0, 'a draw that only moved stops nothing');
    reply(requests('figure-draw')[0], drawReply(requests('figure-draw')[0]));
    assert.deepEqual(got, [1], 'the picture asked a moment ago is delivered, to be shown meanwhile');
    // The latest waiting one is sent next (2 was dropped unsent); another spec asked while it runs makes it stale for good.
    const second = requests('figure-draw')[1];
    assert.equal((second.payload as { generation: number }).generation, 3);
    draw(4, false);
    assert.ok(posted.some(message => message.type === 'figure-cancel' && message.requestIds.includes(second.requestId)), 'a draw of another spec stops the running one');
    reply(second, drawReply(second));
    assert.deepEqual(got, [1], 'a picture of the spec before is never delivered');
    // Only a picture is delivered meanwhile: a stale draw that failed or was busy says nothing.
    const third = requests('figure-draw')[2];
    draw(5, true);
    reply(third, { ...drawReply(third), status: 'failed' });
    assert.deepEqual(got, [1]);
    reply(requests('figure-draw')[3], drawReply(requests('figure-draw')[3]));
    assert.deepEqual(got, [1, 5]);
});

test('reads: one hover read runs and the latest waits; a read a click claims is counted apart and is never dropped by a later hover', () => {
    const { answers, requests, reply } = host(true);
    const figure = answers.figure();
    const shown: number[] = [];
    const clicked: number[] = [];
    const read = (x: number) => figure.read({ pictureId: 'p', pointer: { lane: 'l', x, y: 0, scale: [1, 1] } }, (result, number) => { if (result) shown.push(number); });
    read(1);
    const waiting = read(2);
    assert.deepEqual(figure.queued('read'), { running: 1, waiting: 1 });
    waiting!.claimForClick(result => { if (result) clicked.push(result.requestNumber); });
    assert.deepEqual(figure.queued('read'), { running: 1, waiting: 0 });
    assert.deepEqual(figure.queued('clickRead'), { running: 1, waiting: 0 }, 'the click\'s read goes out at once, in its own place');
    for (let x = 3; x < 10; x++) {
        read(x);
        assert.ok(figure.queued('read').waiting <= 1);
    }
    const sent = requests('figure-read');
    assert.equal(sent.length, 2, 'the hover\'s first and the click\'s');
    const echo = (message: FigureRequestMessage) => ({ status: 'outside', figureId: figure.figureId, pictureId: 'p', requestNumber: (message.payload as { requestNumber: number }).requestNumber });
    reply(sent[1], echo(sent[1]));
    assert.deepEqual(clicked, [2]);
    reply(sent[0], echo(sent[0]));
    const next = requests('figure-read')[2];
    assert.equal((next.payload as { pointer: { x: number } }).pointer.x, 9, 'the latest hover is sent next');
    reply(next, echo(next));
    assert.deepEqual(shown, [2, 1, 9], 'every reply is told with its number: the Figure keeps the newest');
});

test('disposing releases the Figure\'s holdings, and a draw reply that arrives after it releases them again', () => {
    const { answers, requests, reply } = host(true);
    const figure = answers.figure();
    let used = 0;
    figure.draw({ generation: 1, spec: SPEC, width: 100, height: 50 }, () => { used++; });
    const [draw] = requests('figure-draw');
    figure.dispose();
    assert.equal(requests('figure-release').length, 1);
    assert.deepEqual(requests('figure-release')[0].payload, { figureId: figure.figureId });
    reply(draw, drawReply(draw));
    assert.equal(used, 0, 'no reply is used after dispose');
    assert.equal(requests('figure-release').length, 2, 'released again');
    assert.equal(figure.read({ pictureId: 'p', name: { lane: 'l', line: 'a', x: 1 } }, () => undefined), null, 'nothing is asked after dispose');
});

test('a "no-picture" asks for a redraw twice at most with no successful read between; a successful read starts the count again', () => {
    const { answers } = host(true);
    const figure = answers.figure();
    assert.equal(figure.readStatus('no-picture'), 'redraw');
    assert.equal(figure.readStatus('no-picture'), 'redraw');
    assert.equal(figure.readStatus('no-picture'), 'failed');
    assert.equal(figure.readStatus('point'), 'ok');
    assert.equal(figure.readStatus('no-picture'), 'redraw');
    figure.resetRetries();
    assert.equal(figure.readStatus('no-picture'), 'redraw');
});

test('spec 4 (Web): a long computation is counted from asked to answered; reads are held meanwhile and resumed after; an export is one', () => {
    const { answers, requests, reply } = host(false, true);
    const figure = answers.figure();
    const told: boolean[] = [];
    figure.onReadsHeld(heldNow => told.push(heldNow));
    const end = answers.computations.begin();
    assert.equal(figure.readsHeld(), true);
    assert.equal(figure.read({ pictureId: 'p', pointer: { lane: 'l', x: 1, y: 1, scale: [1, 1] } }, () => undefined), null, 'no read is sent');
    end();
    end();
    assert.equal(answers.computations.count(), 0, 'an end is told once');
    assert.deepEqual(told, [true, false]);
    figure.export({ spec: SPEC, dataId: 'd' }, () => undefined);
    assert.equal(figure.readsHeld(), true, 'an export holds the reads until it is answered');
    const [exported] = requests('figure-export');
    reply(exported, { status: 'rows' });
    assert.equal(figure.readsHeld(), false);
    // VS Code is unchanged: nothing is held.
    const vscode = host(true, false);
    const other = vscode.answers.figure();
    vscode.answers.computations.begin();
    assert.equal(other.readsHeld(), false);
});

test('the keys carry the answer store\'s freshness in the figure service\'s words; a change to stale alone is told apart', () => {
    // The answer store's states (answerTypes.ts) are exactly the freshness answers/ maps: a new state fails to compile here.
    const states: Record<Answer<unknown>['state'], AnswerFreshness> = { ready: 'ready', stale: 'stale', pending: 'pending', empty: 'empty', failed: 'failed', missing: 'missing' };
    assert.deepEqual(Object.values(states).map(keyState), ['usable', 'stale', 'pending', 'failed', 'failed', 'evicted']);
    const before = [figureKey('a', 'ready', 'v1'), figureKey('b', 'ready', 'v1')];
    assert.equal(keysChange(before, [figureKey('a', 'ready', 'v1'), figureKey('b', 'ready', 'v1')]), 'same');
    assert.equal(keysChange(before, [figureKey('a', 'stale', 'v1'), figureKey('b', 'ready', 'v1')]), 'stale-only');
    assert.equal(keysChange(before, [figureKey('a', 'ready', 'v2'), figureKey('b', 'ready', 'v1')]), 'changed');
    assert.equal(keysChange(before, [figureKey('a', 'failed', 'v1'), figureKey('b', 'ready', 'v1')]), 'changed');
});

test('a reply to another page\'s request, or to none, is told apart from a figure reply', () => {
    const { answers } = host(true);
    assert.equal(answers.handle({ type: 'compare-combine-result', requestId: 'x' }), false);
    assert.equal(answers.handle({ type: 'figure-result', requestId: 'figure-999', command: 'figure-read', result: {} }), true);
});

test('the host hands a figure request to the backend under its own request id, and a figure-cancel stops those ids in the backend\'s request table: the host keeps no table of its own', async () => {
    const { ComparisonSessionController } = await import('../shared/session/comparisonSessionController');
    const asked: string[] = [], cancelled: string[][] = [];
    const published: Array<{ type: string; requestId?: string }> = [];
    const entry = {
        identity: async () => undefined, scan: async () => ({ ok: false, reason: 'x' }), read: () => undefined, write: () => undefined,
        figure: async (_command: string, _payload: unknown, requestId: string) => { asked.push(requestId); return { status: 'superseded', figureId: 'f', generation: 1, requestNumber: 1 }; },
        cancelFigure: (requestIds: readonly string[]) => { cancelled.push([...requestIds]); },
    };
    const controller = new ComparisonSessionController({
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: { type: string; requestId?: string }) => { published.push(message); },
        entry,
    } as never);
    await controller.dispatch({ type: 'figure-request', requestId: 'figure-7', command: 'figure-draw', payload: { figureId: 'f', generation: 1, requestNumber: 1, spec: { lanes: [], keys: [] }, width: 10, height: 10 } });
    assert.deepEqual(asked, ['figure-7']);
    assert.deepEqual(published.map(message => [message.type, message.requestId]), [['figure-result', 'figure-7']]);
    await controller.dispatch({ type: 'figure-cancel', requestIds: ['figure-7', 'figure-8'] });
    assert.deepEqual(cancelled, [['figure-7', 'figure-8']]);
});

test('the answers a picture counted as let go are those declared usable: by their own key, a part\'s mark taken off, each once', () => {
    const declared = [figureKey('a', 'ready', 'a'), figureKey('step#events', 'ready', 'step'), figureKey('step#event:2', 'ready', 'step'), figureKey('missing|spec|b', 'missing', '0'), figureKey('c', 'ready', 'c')];
    const excluded = [
        { key: 'a', reason: 'evicted' }, { key: 'step#events', reason: 'evicted' }, { key: 'step#event:2', reason: 'evicted' },
        // Never asked (the screen's own "missing" is declared evicted): no scan of it to forget.
        { key: 'missing|spec|b', reason: 'evicted' },
        // Left out for another reason: its answer is held.
        { key: 'c', reason: 'other-reference' },
    ];
    assert.deepEqual(answersLetGo(excluded, declared), ['a', 'step']);
    assert.deepEqual(answersLetGo([], declared), []);
});
