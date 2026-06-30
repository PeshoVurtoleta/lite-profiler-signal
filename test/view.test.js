import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Profiler, FrameClass } from '@zakkster/lite-profiler';
import { createProfilerView } from '../index.js';

let clock = 0, realNow;
beforeEach(() => { clock = 0; realNow = performance.now; performance.now = () => clock; });
afterEach(() => { performance.now = realNow; });

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ~= ${b}`);

function frameOnce(p, view, totalMs, phaseMs) {
  const t0 = clock;
  p.beginFrame();
  for (let i = 0; i < p.phaseCount; i++) { p.beginAt(i); clock += phaseMs[i]; p.endAt(i); }
  clock = t0 + totalMs;
  p.endFrame();
  view.pulse();
}

describe('createProfilerView', () => {
  it('requires a Profiler instance', () => {
    assert.throws(() => createProfilerView(null), TypeError);
    assert.throws(() => createProfilerView({}), TypeError);
  });

  it('starts at zero before any frame', () => {
    const p = new Profiler(64, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    assert.equal(v.fps(), 0);
    assert.equal(v.frameP99(), 0);
    assert.equal(v.frameClass(), FrameClass.STEADY);
    v.dispose(); p.destroy();
  });

  it('lifts frame + phase telemetry into signals on pulse', () => {
    const p = new Profiler(64, ['physics', 'render']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    for (let i = 0; i < 30; i++) frameOnce(p, v, 10, [3, 6]);
    near(v.frameAvg(), 10, 0.05);
    near(v.fps(), 100, 1);
    near(v.phases.physics.last(), 3, 0.05);
    near(v.phases.render.p99(), 6, 0.2);
    assert.equal(v.frameClass(), FrameClass.STEADY);
    v.dispose(); p.destroy();
  });

  it('flips frameClass to THROTTLED under sustained over-budget frames', () => {
    const p = new Profiler(64, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    for (let i = 0; i < 64; i++) frameOnce(p, v, 22, [1]);
    assert.equal(v.frameClass(), FrameClass.THROTTLED);
    v.dispose(); p.destroy();
  });

  it('phase(tag) returns the bundle or null', () => {
    const p = new Profiler(16, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    assert.ok(v.phase('a'));
    assert.equal(v.phase('nope'), null);
    v.dispose(); p.destroy();
  });

  it('dispose() is idempotent and stops updating without throwing', () => {
    const p = new Profiler(64, ['a']);
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });
    for (let i = 0; i < 10; i++) frameOnce(p, v, 12, [2]);
    assert.doesNotThrow(() => { v.dispose(); v.dispose(); });
    assert.doesNotThrow(() => { for (let i = 0; i < 5; i++) frameOnce(p, v, 40, [2]); });
    p.destroy();
  });
});
