import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { stats } from '@zakkster/lite-signal';
import { Profiler } from '@zakkster/lite-profiler';
import { createProfilerView } from '../index.js';

let clock = 0, realNow;
beforeEach(() => { clock = 0; realNow = performance.now; performance.now = () => clock; });
afterEach(() => { performance.now = realNow; });

function frameOnce(p, view) {
  const t0 = clock;
  p.beginFrame();
  for (let i = 0; i < p.phaseCount; i++) { p.beginAt(i); clock += (i + 1); p.endAt(i); }
  clock = t0 + 10;
  p.endFrame();
  view.pulse();
}

describe('anti-trap: steady-state pulsing allocates no graph nodes', () => {
  it('recomputes every pulse without growing the signal pool', () => {
    const p = new Profiler(256, ['a', 'b', 'c', 'd']);
    // intervalMs 0 + trailing false => a leading emit on every pulse => a full recompute each frame
    const v = createProfilerView(p, { intervalMs: 0, trailing: false });

    for (let i = 0; i < 50; i++) frameOnce(p, v);   // warm up

    const s0 = stats();
    const FRAMES = 5000;
    for (let i = 0; i < FRAMES; i++) frameOnce(p, v);
    const s1 = stats();

    assert.ok(v.fps() > 90 && v.fps() < 110, `fps=${v.fps()} -> recompute actually ran`);

    assert.equal(s1.signals - s0.signals, 0, 'no signals created across 5000 recomputes');
    assert.equal(s1.computeds - s0.computeds, 0, 'no computeds created');
    assert.equal(s1.effects - s0.effects, 0, 'effect count flat');
    assert.equal(s1.activeNodes - s0.activeNodes, 0, 'live node count flat');
    assert.equal(s1.nodePoolCapacity - s0.nodePoolCapacity, 0, 'node pool never grew');

    v.dispose(); p.destroy();
  });
});
