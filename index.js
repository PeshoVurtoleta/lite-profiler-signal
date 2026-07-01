/**
 * @zakkster/lite-profiler-signal
 *
 * Reactive boundary for @zakkster/lite-profiler. The imperative Profiler hot
 * path stays allocation-free and writes no signals; this bridge samples its
 * ring buffers on a throttled pulse and lifts coarse telemetry into lite-signal
 * signals. Mirrors lite-camera -> lite-camera-max.
 *
 * The reactive-profiler trap: never call signal.set() per phase or per frame.
 * Here the only per-frame graph activity is one integer tick set; a lite-throttle
 * window gates the (bounded) recompute, so graph cost is O(1) per frame
 * regardless of phase count or frame rate. Proven by test/antitrap.test.js.
 *
 * Copyright (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License.
 */

import {signal, batch, dispose as disposeNode} from '@zakkster/lite-signal';
import {throttle, throttleRAF} from '@zakkster/lite-throttle';
import {watchPrevious, watchChanged} from '@zakkster/lite-watch-ex';
import {FrameHistogram, FrameClass, summarize, checkRegression, DEFAULT_TOLERANCES} from '@zakkster/lite-profiler';
import {StatsMath} from '@zakkster/lite-stats-math';

const DEFAULT_INTERVAL = 100;     // ~10Hz telemetry
const BUDGET_60 = 1000 / 60;

/**
 * Create a reactive view over a Profiler.
 * @param {import('@zakkster/lite-profiler').Profiler} profiler
 * @param {object} [options]
 * @param {number}  [options.intervalMs=100] throttle window (ms) for the recompute
 * @param {boolean} [options.raf=false]      align the pulse to requestAnimationFrame
 * @param {boolean} [options.leading=true]
 * @param {boolean} [options.trailing=true]
 * @param {string}  [options.label]   default workload label stamped into summaries
 * @param {string}  [options.engine]  default engine label stamped into summaries
 * @param {number}  [options.budgetMs] informational frame budget recorded in summaries
 * @param {Object<string,number>} [options.tolerances] default regression tolerances
 */
export function createProfilerView(profiler, options = {}) {
    if (!profiler || typeof profiler.beginFrame !== 'function') {
        throw new TypeError('createProfilerView: a lite-profiler Profiler instance is required');
    }

    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL;
    const leading = options.leading !== false;
    const trailing = options.trailing !== false;

    const viewLabel = options.label ?? null;
    const viewEngine = options.engine ?? null;
    const budgetMs = options.budgetMs ?? BUDGET_60;
    let baseline = null;                                  // armed CaptureSummary, or null
    let tolerances = options.tolerances || DEFAULT_TOLERANCES;
    let gates = null;                                     // pre-parsed tolerance gates (zero-alloc recompute)

    // analysis scratch (off the hot path)
    const stats = new StatsMath(profiler.capacity);
    const hist = new FrameHistogram();
    const fOut = {avg: 0, min: 0, max: 0, p01: 0, p99: 0};
    const pOut = {avg: 0, min: 0, max: 0, p01: 0, p99: 0};

    // output signals -- created once; recompute only .set()s them
    const fps = signal(0);
    const frameAvg = signal(0);
    const frameP99 = signal(0);
    const frameMax = signal(0);
    const jank = signal(0);
    const spike = signal(0);
    const frameClass = signal(FrameClass.STEADY);
    const regressed = signal(false);   // live: is the window past baseline tolerance?

    const tags = profiler.phaseTags ? profiler.phaseTags.slice() : [];
    const phases = Object.create(null);
    const phaseList = [];
    const phaseByTag = Object.create(null);
    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const bundle = {avg: signal(0), p99: signal(0), last: signal(0)};
        phases[tag] = bundle;
        // scalar mirrors (_avg .. _last) let the baseline gate read live phase
        // values with zero allocation on the recompute path.
        const entry = {
            buf: profiler.phase(tag), avg: bundle.avg, p99: bundle.p99, last: bundle.last,
            _avg: 0, _min: 0, _max: 0, _p01: 0, _p99: 0, _last: 0
        };
        phaseList.push(entry);
        phaseByTag[tag] = entry;
    }

    // recompute: a bounded number of sets, batched into a single flush
    function recompute() {
        const frame = profiler.frame;
        if (frame.count === 0) return;
        stats.compute(frame, fOut);
        hist.update(frame);
        batch(() => {
            fps.set(fOut.avg > 0 ? 1000 / fOut.avg : 0);
            frameAvg.set(fOut.avg);
            frameP99.set(fOut.p99);
            frameMax.set(fOut.max);
            jank.set(hist.jankRatio);
            spike.set(hist.spikeRatio);
            frameClass.set(hist.classify());
            for (let i = 0; i < phaseList.length; i++) {
                const ph = phaseList[i];
                if (ph.buf.count === 0) {
                    ph.last.set(0);
                    ph.avg.set(0);
                    ph.p99.set(0);
                    ph._avg = 0; ph._min = 0; ph._max = 0; ph._p01 = 0; ph._p99 = 0; ph._last = 0;
                    continue;
                }
                stats.compute(ph.buf, pOut);
                const last = ph.buf.peekNewest();
                ph.last.set(last);
                ph.avg.set(pOut.avg);
                ph.p99.set(pOut.p99);
                ph._avg = pOut.avg; ph._min = pOut.min; ph._max = pOut.max;
                ph._p01 = pOut.p01; ph._p99 = pOut.p99; ph._last = last;
            }
            regressed.set(gates ? evaluateBaseline() : false);
        });
    }

    // the pulse: one integer set per frame; the throttle gates the recompute
    const tick = signal(0);
    const gated = options.raf
        ? throttleRAF(() => tick(), {leading, trailing})
        : throttle(() => tick(), intervalMs, {leading, trailing});
    const pump = gated.subscribe(recompute);   // fires on each throttled emit

    let disposed = false;
    let rafId = 0;
    const watchers = [];

    function pulse() {
        if (disposed) return;
        tick.set(tick.peek() + 1);
    }

    function flush() {
        if (disposed) return;
        gated.flush();
    }

    function detach() {
        if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
        rafId = 0;
    }

    function attach() {
        if (disposed || typeof requestAnimationFrame === 'undefined') return detach;
        const loop = () => {
            pulse();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return detach;
    }

    /** Fire when the classifier leaves STEADY (enters spiking or throttled). */
    function onJank(handler) {
        const off = watchChanged(
            () => frameClass(),
            (c) => c !== FrameClass.STEADY,
            (c) => handler(c)
        );
        watchers.push(off);
        return off;
    }

    /** Fire when a phase's p99 exceeds `factor` times its rolling baseline. */
    function onRegression(tag, handler, opts = {}) {
        const bundle = phases[tag];
        if (!bundle) throw new RangeError(`onRegression: unknown phase '${tag}'`);
        const factor = opts.factor ?? 1.5;
        const window = Math.max(2, opts.window ?? 8);
        const off = watchPrevious(() => bundle.p99(), (cur, history) => {
            let sum = 0, n = 0;
            for (let i = 0; i < history.length; i++) {
                const h = history[i];
                if (h !== undefined) {
                    sum += h;
                    n++;
                }
            }
            if (n < window - 1) return;            // not enough baseline yet
            const baseline = sum / n;
            if (baseline > 0 && cur > baseline * factor) handler({tag, p99: cur, baseline});
        }, {depth: window});
        watchers.push(off);
        return off;
    }

    // ---- baseline-aware regression (consumes lite-profiler summarize/checkRegression) ----

    function mergeMeta(meta) {
        const m = {label: viewLabel, engine: viewEngine, budgetMs};
        if (meta) {
            if (meta.label != null) m.label = meta.label;
            if (meta.engine != null) m.engine = meta.engine;
            if (meta.budgetMs != null) m.budgetMs = meta.budgetMs;
            if (meta.timestamp != null) m.timestamp = meta.timestamp;
        }
        return m;
    }

    /** Snapshot the current window as a self-describing CaptureSummary. */
    function summary(meta) {
        return summarize(profiler, mergeMeta(meta));
    }

    function armGates() {
        if (!baseline) { gates = null; return; }
        const g = [];
        for (const path in tolerances) {
            const parts = path.split('.');
            let bval;
            if (parts[0] === 'frame') {
                bval = baseline.frame ? baseline.frame[parts[1]] : undefined;
                if (typeof bval !== 'number' || !isFinite(bval)) continue;
                g.push({k0: 0, m: parts[1], tol: tolerances[path], higher: parts[1] === 'fps', bval});
            } else if (parts[0] === 'phase') {
                const pb = baseline.phases ? baseline.phases[parts[1]] : null;
                bval = pb ? pb[parts[2]] : undefined;
                if (typeof bval !== 'number' || !isFinite(bval)) continue;
                g.push({k0: 1, tag: parts[1], m: parts[2], tol: tolerances[path], higher: parts[2] === 'fps', bval});
            }
        }
        gates = g.length ? g : null;
    }

    function liveForGate(g) {
        if (g.k0 === 0) {
            switch (g.m) {
                case 'avg': return fOut.avg;
                case 'min': return fOut.min;
                case 'max': return fOut.max;
                case 'p01': return fOut.p01;
                case 'p99': return fOut.p99;
                case 'fps': return fOut.avg > 0 ? 1000 / fOut.avg : 0;
                case 'jankRatio': return hist.jankRatio;
                case 'spikeRatio': return hist.spikeRatio;
                default: return undefined;
            }
        }
        const ph = phaseByTag[g.tag];
        if (!ph) return undefined;
        switch (g.m) {
            case 'avg': return ph._avg;
            case 'min': return ph._min;
            case 'max': return ph._max;
            case 'p01': return ph._p01;
            case 'p99': return ph._p99;
            case 'last': return ph._last;
            default: return undefined;
        }
    }

    // zero-allocation on the recompute path: pre-parsed gates, scalar reads only
    function evaluateBaseline() {
        for (let i = 0; i < gates.length; i++) {
            const g = gates[i];
            const live = liveForGate(g);
            if (typeof live !== 'number' || !isFinite(live)) continue;
            let worse;
            if (g.bval === 0) worse = live <= 0 ? -1 : Infinity;
            else worse = g.higher ? (g.bval - live) / g.bval : (live - g.bval) / g.bval;
            if (worse > g.tol) return true;
        }
        return false;
    }

    /** Arm (or clear, with null) a baseline CaptureSummary for the live gate. */
    function setBaseline(s) {
        baseline = s || null;
        armGates();
        return baseline;
    }

    /** The armed baseline, or null. */
    function getBaseline() {
        return baseline;
    }

    /** Replace the tolerance map used by the live gate and checkAgainstBaseline(). */
    function setTolerances(t) {
        tolerances = t || DEFAULT_TOLERANCES;
        armGates();
        return tolerances;
    }

    /** Snapshot the current window and arm it as the baseline. Returns the summary. */
    function captureBaseline(meta) {
        const s = summary(meta);
        setBaseline(s);
        return s;
    }

    /** On-demand structured regression report vs the armed baseline (null if none). */
    function checkAgainstBaseline(tol) {
        if (!baseline) return null;
        return checkRegression(baseline, summary(), tol || tolerances);
    }

    /** Fire once each time live telemetry crosses from within-budget to regressed. */
    function onBaselineRegression(handler) {
        const off = watchChanged(
            () => regressed(),
            (v) => v === true,
            () => handler(checkAgainstBaseline())
        );
        watchers.push(off);
        return off;
    }

    function destroy() {
        if (disposed) return;
        disposed = true;
        detach();
        baseline = null;
        gates = null;
        for (let i = 0; i < watchers.length; i++) watchers[i]();
        watchers.length = 0;
        pump();
        gated.dispose();
        disposeNode(tick);
        disposeNode(fps);
        disposeNode(frameAvg);
        disposeNode(frameP99);
        disposeNode(frameMax);
        disposeNode(jank);
        disposeNode(spike);
        disposeNode(frameClass);
        disposeNode(regressed);
        for (let i = 0; i < phaseList.length; i++) {
            disposeNode(phaseList[i].avg);
            disposeNode(phaseList[i].p99);
            disposeNode(phaseList[i].last);
        }
        hist.destroy();
        if (typeof stats.destroy === 'function') stats.destroy();
    }

    return {
        fps, frameAvg, frameP99, frameMax, jank, spike, frameClass, regressed,
        phases,
        phase(tag) {
            return phases[tag] || null;
        },
        summary, setBaseline, getBaseline, setTolerances, captureBaseline, checkAgainstBaseline,
        pulse, flush, attach, detach,
        onJank, onRegression, onBaselineRegression,
        dispose: destroy
    };
}
