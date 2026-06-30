import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Profiler, FrameClass } from '@zakkster/lite-profiler';
import { createProfilerView } from '../index.js';

let clock = 0, realNow;
beforeEach(() => { clock = 0; realNow = performance.now; performance.now = () => clock; });
afterEach(() => { performance.now = realNow; });

// overwrite the whole window with frames of an exact total (so frame p99 == totalMs), then pulse once
function fillWindow(p, view, totalMs, phaseMs) {
  for (let i = 0; i < p.capacity; i++) {
    const t0 = clock;
    p.beginFrame();
    for (let j = 0; j < p.phaseCount; j++) { p.beginAt(j); clock += phaseMs[j]; p.endAt(j); }
    clock = t0 + totalMs;
    p.endFrame();
  }
  view.pulse();
}

describe('detectors', () => {
  it('onJank fires when the classifier leaves STEADY', () => {
    const p = new Profiler(64, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    let fired = 0, lastCls = null;
    v.onJank((c) => { fired++; lastCls = c; });

    fillWindow(p, v, 8, [1]);
    assert.equal(fired, 0, 'steady window does not fire');
    fillWindow(p, v, 40, [1]);
    assert.equal(fired, 1, 'fires once on entering throttled');
    assert.equal(lastCls, FrameClass.THROTTLED);

    v.dispose(); p.destroy();
  });

  it('onRegression fires when a phase p99 jumps over its rolling baseline', () => {
    const p = new Profiler(32, ['physics']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    let event = null;
    v.onRegression('physics', (e) => { event = e; }, { factor: 2, window: 4 });

    for (const ms of [5, 6, 7, 8]) fillWindow(p, v, ms + 2, [ms]);
    assert.equal(event, null, 'no regression during a calm rising baseline');

    fillWindow(p, v, 42, [40]);
    assert.ok(event, 'regression fired on the spike');
    assert.equal(event.tag, 'physics');
    assert.ok(event.p99 > 30, `p99=${event && event.p99}`);

    v.dispose(); p.destroy();
  });

  it('onJank disposer stops delivery', () => {
    const p = new Profiler(64, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    let fired = 0;
    const off = v.onJank(() => { fired++; });
    off();
    fillWindow(p, v, 40, [1]);
    assert.equal(fired, 0);
    v.dispose(); p.destroy();
  });
});
