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
import {FrameHistogram, FrameClass} from '@zakkster/lite-profiler';
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
 */
export function createProfilerView(profiler, options = {}) {
    if (!profiler || typeof profiler.beginFrame !== 'function') {
        throw new TypeError('createProfilerView: a lite-profiler Profiler instance is required');
    }

    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL;
    const leading = options.leading !== false;
    const trailing = options.trailing !== false;

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

    const tags = profiler.phaseTags ? profiler.phaseTags.slice() : [];
    const phases = Object.create(null);
    const phaseList = [];
    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const bundle = {avg: signal(0), p99: signal(0), last: signal(0)};
        phases[tag] = bundle;
        phaseList.push({buf: profiler.phase(tag), avg: bundle.avg, p99: bundle.p99, last: bundle.last});
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
                    continue;
                }
                stats.compute(ph.buf, pOut);
                ph.last.set(ph.buf.peekNewest());
                ph.avg.set(pOut.avg);
                ph.p99.set(pOut.p99);
            }
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

    function destroy() {
        if (disposed) return;
        disposed = true;
        detach();
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
        for (let i = 0; i < phaseList.length; i++) {
            disposeNode(phaseList[i].avg);
            disposeNode(phaseList[i].p99);
            disposeNode(phaseList[i].last);
        }
        hist.destroy();
        if (typeof stats.destroy === 'function') stats.destroy();
    }

    return {
        fps, frameAvg, frameP99, frameMax, jank, spike, frameClass,
        phases,
        phase(tag) {
            return phases[tag] || null;
        },
        pulse, flush, attach, detach,
        onJank, onRegression,
        dispose: destroy
    };
}
