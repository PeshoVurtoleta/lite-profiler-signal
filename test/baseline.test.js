import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { stats } from '@zakkster/lite-signal';
import { Profiler } from '@zakkster/lite-profiler';
import { createProfilerView } from '../index.js';

// Deterministic clock, identical to the other suites in this package.
let clock = 0, realNow;
beforeEach(() => { clock = 0; realNow = performance.now; performance.now = () => clock; });
afterEach(() => { performance.now = realNow; });

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ~= ${b}`);

// One frame of exactly `totalMs`, optionally with per-phase durations.
function frame(p, view, totalMs, phaseMs) {
    const t0 = clock;
    p.beginFrame();
    if (phaseMs) for (let i = 0; i < p.phaseCount; i++) { p.beginAt(i); clock += phaseMs[i]; p.endAt(i); }
    clock = t0 + totalMs;
    p.endFrame();
    view.pulse();
}
function feed(p, view, n, totalMs, phaseMs) { for (let i = 0; i < n; i++) frame(p, view, totalMs, phaseMs); }

// intervalMs:0 + trailing:false => a leading recompute on every pulse.
const OPTS = { intervalMs: 0, trailing: false };

describe('baseline-aware regression', () => {
    it('does not fire on equal performance, fires on a real slowdown', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);

        feed(p, v, 16, 8);                       // window: all 8ms -> avg 8
        v.setBaseline(v.summary({ label: 'base', engine: 'lite-signal@1.3.0' }));

        feed(p, v, 16, 8);                       // identical speed
        assert.equal(v.regressed(), false, 'equal performance must not regress (no false positive)');

        feed(p, v, 16, 14);                      // +75% slower
        assert.equal(v.regressed(), true, 'a real +75% slowdown must regress');

        v.dispose();
    });

    it('gates fps in the higher-is-better direction', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, { ...OPTS, tolerances: { 'frame.fps': 0.10 } });

        feed(p, v, 16, 10);                      // fps 100
        v.setBaseline(v.summary());

        feed(p, v, 16, 8);                       // faster: fps 125
        assert.equal(v.regressed(), false, 'faster than baseline is not an fps regression');

        feed(p, v, 16, 20);                      // slower: fps 50
        assert.equal(v.regressed(), true, 'slower than baseline drops fps -> regression');

        v.dispose();
    });

    it('gates per-phase metrics and skips metrics the baseline lacks', () => {
        const p = new Profiler(16, ['update', 'render']);
        const v = createProfilerView(p, {
            ...OPTS,
            tolerances: { 'phase.update.p99': 0.10, 'phase.ghost.p99': 0.10 } // ghost: not a real phase
        });

        feed(p, v, 16, 10, [4, 6]);              // update ~4ms, render ~6ms
        v.setBaseline(v.summary());

        feed(p, v, 16, 10, [4, 6]);              // same timings; the ghost gate must be skipped, not crash
        assert.equal(v.regressed(), false, 'same phase timings + missing-metric gate skipped -> no regression');

        feed(p, v, 16, 22, [10, 6]);             // update p99 jumps 4 -> 10
        assert.equal(v.regressed(), true, 'update phase p99 regression fires');

        v.dispose();
    });

    it('checkAgainstBaseline report agrees with the live regressed signal', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);

        feed(p, v, 16, 8);
        v.setBaseline(v.summary());

        feed(p, v, 16, 8);
        assert.equal(v.regressed(), false);
        assert.equal(v.checkAgainstBaseline().ok, true, 'report is ok when the live gate is clean');

        feed(p, v, 16, 14);
        assert.equal(v.regressed(), true);
        const r = v.checkAgainstBaseline();
        assert.equal(r.ok, false, 'report flags when the live gate flags');
        assert.ok(
            r.regressions.some((x) => x.metric === 'frame.avg' || x.metric === 'frame.p99'),
            'the offending frame metric is named'
        );

        v.dispose();
    });

    it('onBaselineRegression fires once on the within-budget -> regressed transition', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);

        feed(p, v, 16, 8);
        v.setBaseline(v.summary());

        let fired = 0, lastReport = null;
        v.onBaselineRegression((rep) => { fired++; lastReport = rep; });

        feed(p, v, 16, 8);                       // clean
        assert.equal(fired, 0, 'no fire while within budget');

        feed(p, v, 16, 14);                      // cross into regressed
        assert.equal(fired, 1, 'fires once on entering regressed');

        feed(p, v, 8, 14);                       // stays regressed
        assert.equal(fired, 1, 'does not re-fire while still regressed');
        assert.ok(lastReport && lastReport.ok === false, 'handler received the structured report');

        v.dispose();
    });

    it('with no baseline armed, regressed stays false and checkAgainstBaseline is null', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);
        feed(p, v, 16, 40);                      // slow, but nothing to compare against
        assert.equal(v.regressed(), false, 'no baseline -> never regressed');
        assert.equal(v.checkAgainstBaseline(), null, 'no baseline -> null report');
        v.dispose();
    });

    it('captureBaseline snapshots live; a run is never regressed against itself', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);
        feed(p, v, 16, 12);
        const snap = v.captureBaseline({ label: 'self' });
        assert.equal(snap.label, 'self');
        feed(p, v, 16, 12);                      // identical re-run
        assert.equal(v.regressed(), false, 'identical re-run is never a regression');
        v.dispose();
    });

    it('clearing the baseline (setBaseline(null)) disarms the gate', () => {
        const p = new Profiler(16, []);
        const v = createProfilerView(p, OPTS);
        feed(p, v, 16, 8);
        v.setBaseline(v.summary());
        feed(p, v, 16, 40);
        assert.equal(v.regressed(), true, 'armed + slow -> regressed');
        v.setBaseline(null);
        feed(p, v, 16, 40);
        assert.equal(v.regressed(), false, 'disarmed -> not regressed');
        assert.equal(v.getBaseline(), null);
        v.dispose();
    });
});

describe('single source of truth', () => {
    it('summary() agrees with the reactive telemetry signals', () => {
        const p = new Profiler(64, ['work']);
        const v = createProfilerView(p, OPTS);
        feed(p, v, 20, 16, [9]);                 // frame 16ms, work 9ms

        const s = v.summary();
        near(s.frame.avg, v.frameAvg());
        near(s.frame.p99, v.frameP99());
        near(s.frame.max, v.frameMax());
        near(s.frame.fps, v.fps());
        near(s.frame.jankRatio, v.jank());
        near(s.phases.work.p99, v.phase('work').p99());
        assert.equal(s.frame.frameClass, v.frameClass());

        v.dispose();
    });
});

describe('anti-trap under baseline gating', () => {
    it('does not grow the reactive graph per frame while gating', () => {
        const p = new Profiler(64, ['a']);
        const v = createProfilerView(p, OPTS);

        feed(p, v, 8, 8, [4]);
        v.setBaseline(v.summary());
        for (let i = 0; i < 50; i++) frame(p, v, 8, [4]);   // warm up under a live gate

        const s0 = stats();
        for (let i = 0; i < 2000; i++) frame(p, v, 14, [7]); // 2000 regressed frames
        const s1 = stats();

        assert.equal(v.regressed(), true, 'gate is active');
        assert.equal(s1.signals - s0.signals, 0, 'no signals created across 2000 gated recomputes');
        assert.equal(s1.computeds - s0.computeds, 0, 'no computeds created');
        assert.equal(s1.effects - s0.effects, 0, 'effect count flat');
        assert.equal(s1.activeNodes - s0.activeNodes, 0, 'live node count flat');
        assert.equal(s1.nodePoolCapacity - s0.nodePoolCapacity, 0, 'node pool never grew');

        v.dispose(); p.destroy();
    });
});
