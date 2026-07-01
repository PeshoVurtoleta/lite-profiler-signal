# @zakkster/lite-profiler-signal

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-profiler-signal?style=for-the-badge)](https://www.npmjs.com/package/@zakkster/lite-profiler-signal)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-profiler-signal?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-profiler-signal)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-profiler-signal?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-profiler-signal)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-profiler-signal?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-profiler-signal)
[![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE.txt)
[![types](https://img.shields.io/badge/types-included-blue?style=for-the-badge)](./index.d.ts)
[![module](https://img.shields.io/badge/module-ESM-f7df1e?style=for-the-badge)](#)
[![built on lite-signal](https://img.shields.io/badge/built%20on-lite--signal-00ffc6?style=for-the-badge)](https://www.npmjs.com/package/@zakkster/lite-signal)

**The reactive boundary for [`@zakkster/lite-profiler`](https://www.npmjs.com/package/@zakkster/lite-profiler).** It lifts coarse frame and per-phase telemetry into [`lite-signal`](https://www.npmjs.com/package/@zakkster/lite-signal) signals you can bind to a HUD, a dashboard, or an alerting hook -- *without* paying a reactive cost on the frame loop.

This is to `lite-profiler` what [`lite-camera-max`](https://www.npmjs.com/package/@zakkster/lite-camera-max) is to `lite-camera`: a thin reactive wrapper over a fast imperative engine. The engine stays imperative and allocation-free; the wrapper hands you signals.

> **One rule, enforced by a test:** the profiler hot path never writes a signal, and steady-state pulsing creates **zero** graph nodes. See [the anti-trap proof](#the-reactive-profiler-trap).

---

## The reactive-profiler trap

The obvious way to make a profiler "reactive" is to push every measurement into a signal: `phaseSignal.set(elapsed)` at the end of every phase, every frame. At 120fps with eight phases that is ~1000 signal writes per second, each one waking subscribers, each one potentially churning the reactive graph. You have turned a zero-GC profiler into a garbage fountain. That is the trap.

`lite-profiler-signal` refuses it. The imperative `Profiler` keeps writing frame and phase times into its zero-GC ring buffers exactly as before. The bridge adds **one** integer signal -- a frame `tick` -- and bumps it once per frame. A `lite-throttle` window over that tick gates a single recompute that, at most ~10 times per second, reads the buffers and writes a **fixed, bounded** set of output signals inside a `batch()`.

|                                   | Naive reactive profiler        | `lite-profiler-signal`            |
| --------------------------------- | ------------------------------ | --------------------------------- |
| Signal writes per frame           | phases x fps (hundreds+)       | **1** (a tick)                    |
| Recompute / propagation cadence   | every frame                    | throttled, ~10Hz                  |
| Graph nodes created per frame     | grows with churn               | **0**                             |
| Hot-path allocations              | one `set()` per phase          | **none**                          |
| Cost scaling                      | O(phases x fps)                | **O(1) per frame**                |

### The proof

`test/antitrap.test.js` builds a view over a four-phase profiler, warms it up, snapshots `lite-signal`'s registry via `stats()`, then runs **5000 frames** -- each one a full recompute (`intervalMs: 0`) that re-derives every output signal. After 5000 recomputes:

- `signals` created: **+0**
- `computeds` created: **+0**
- live `activeNodes`: **+0**
- `nodePoolCapacity`: **+0** (the pool never had to grow)

A full reactive derivation, 5000 times, allocates nothing on the graph.

---

## Install

```sh
npm install @zakkster/lite-profiler-signal @zakkster/lite-signal
```

`@zakkster/lite-signal` (`>=1.3.0`, including the `1.4.0` beta line) is a **peer dependency** -- the bridge shares your registry, so the signals it hands you are the same kind your own effects already track. `@zakkster/lite-profiler`, `@zakkster/lite-stats-math`, `@zakkster/lite-throttle`, and `@zakkster/lite-watch-ex` are regular dependencies.

> **Resolution note:** the telemetry trio (`lite-ring-buffer`, `lite-stats-math`, `lite-canvas-graph`) must be at **>= 1.0.1** for native Node ESM. Earlier `1.0.0` tarballs shipped an `exports` map missing the `./` target prefix, which bundlers tolerate but Node rejects. `lite-profiler` already pins the fixed range.

---

## Quick start

```js
import { Profiler } from "@zakkster/lite-profiler";
import { createProfilerView } from "@zakkster/lite-profiler-signal";
import { effect } from "@zakkster/lite-signal";

const profiler = new Profiler(512, ["update", "render"]);
const view = createProfilerView(profiler);   // ~10Hz by default

// 1. Your existing loop fills the profiler, then pulses the view once.
function frame() {
  profiler.beginFrame();

  profiler.begin("update"); simulate(); profiler.end("update");
  profiler.begin("render"); draw();     profiler.end("render");

  profiler.endFrame();
  view.pulse();                 // one cheap tick; recompute is throttled
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 2. Bind telemetry to the DOM -- this effect re-runs ~10Hz, not 120Hz.
effect(() => {
  fpsEl.textContent = view.fps().toFixed(0);
  fpsEl.dataset.state = view.frameClass();   // "steady" | "spiking" | "throttled"
});

// 3. Get alerted, not polled.
view.onJank((cls) => console.warn("frame budget missed:", cls));
view.onRegression("render", (e) =>
  console.warn(`render p99 ${e.p99.toFixed(1)}ms vs baseline ${e.baseline.toFixed(1)}ms`));
```

If you do not already have a loop (e.g. a passive monitor), let the view drive itself:

```js
const detach = view.attach();   // pulses on requestAnimationFrame; browser only
// ... later
detach();
```

---

## API

### `createProfilerView(profiler, options?) -> ProfilerView`

| option       | default | meaning                                                        |
| ------------ | ------- | -------------------------------------------------------------- |
| `intervalMs` | `100`   | throttle window for the recompute (~10Hz)                      |
| `raf`        | `false` | align the pulse to `requestAnimationFrame` instead of a timer  |
| `leading`    | `true`  | emit on the leading edge of each window                        |
| `trailing`   | `true`  | emit the trailing value at window end (so the last frame lands)|
| `label`      | -       | default workload label stamped into `summary()` output         |
| `engine`     | -       | default engine label stamped into summaries                    |
| `budgetMs`   | `16.67` | informational frame budget recorded in summaries               |
| `tolerances` | avg/p99 | default regression tolerances (metric path -> fraction)        |

Throws `TypeError` if `profiler` is not a `Profiler` instance.

### Signals

Read them by calling them (`view.fps()`); track them inside any `effect`, `computed`, `watch`, or `.subscribe()`. **Do not `.set()` them** -- they are derived outputs.

| signal               | type                                          | meaning                                   |
| -------------------- | --------------------------------------------- | ----------------------------------------- |
| `fps`                | `Signal<number>`                              | `1000 / frameAvg`                         |
| `frameAvg`           | `Signal<number>`                              | mean frame time (ms)                      |
| `frameP99`           | `Signal<number>`                              | 99th percentile frame time (ms)           |
| `frameMax`           | `Signal<number>`                              | worst frame in the window (ms)            |
| `jank`               | `Signal<number>`                              | fraction of frames >= 16ms                |
| `spike`              | `Signal<number>`                              | fraction of frames >= 33ms                |
| `frameClass`         | `Signal<"steady" \| "spiking" \| "throttled">`| classifier verdict                        |
| `phases[tag]`        | `{ avg, p99, last }` of `Signal<number>`      | per-phase stats (ms)                      |
| `regressed`          | `Signal<boolean>`                             | live: window past the armed baseline? (`false` when unarmed) |

`view.phase(tag)` returns the bundle for a registered phase, or `null`.

### Methods

| method               | description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| `pulse()`            | Call once per frame, after `profiler.endFrame()`. One tick set.             |
| `flush()`            | Force any pending throttled recompute to run synchronously now.             |
| `attach()`           | Drive `pulse()` on `requestAnimationFrame`. Returns a detacher. Browser only.|
| `detach()`           | Stop the `attach()` driver.                                                 |
| `dispose()`          | Idempotent. Tears down the throttle, all watchers, and every signal.        |
| `summary(meta?)`     | Snapshot the current window as a self-describing `CaptureSummary` (JSON).    |
| `setBaseline(s\|null)` | Arm (or clear) a baseline `CaptureSummary` for the live `regressed` gate.  |
| `getBaseline()`      | The armed baseline, or `null`.                                              |
| `setTolerances(t)`   | Replace the tolerance map used by the gate and `checkAgainstBaseline()`.    |
| `captureBaseline(meta?)` | Snapshot the current window and arm it as the baseline. Returns it.     |
| `checkAgainstBaseline(t?)` | On-demand structured `RegressionReport` vs the baseline (`null` if none). |

### Detectors

Both return a disposer; both are also cleaned up by `dispose()`.

```ts
onJank(handler: (cls: FrameClassLabel) => void): () => void;
```
Fires when the classifier **leaves** `STEADY` (enters `spiking`/`throttled`). Edge-triggered: it will not spam while you stay janky, and re-arms when you recover.

```ts
onRegression(
  tag: string,
  handler: (e: { tag: string; p99: number; baseline: number }) => void,
  options?: { factor?: number; window?: number }   // default factor 1.5, window 8
): () => void;
```
Fires when a phase's p99 exceeds `factor` times the rolling mean of its previous `window` samples. Catches "this phase quietly got 2x slower" without you picking an absolute threshold.

```ts
onBaselineRegression(handler: (report: RegressionReport | null) => void): () => void;
```
Fires once each time live telemetry crosses from within-budget to **regressed vs an armed baseline**. Unlike `onRegression` (which watches a phase against its own *rolling* history), this watches the whole window against a *fixed* baseline you captured earlier -- e.g. a saved run on a previous engine version. The handler receives the full `checkAgainstBaseline()` report at the moment of the transition.

### Baseline regression: verifying across engine versions

`onRegression` catches drift *within* a session. Baseline regression catches drift *between* builds. Because the underlying profiler is engine-agnostic, you capture one workload's summary on the current engine, save it as JSON, then arm it while running the same workload on the next engine -- and the `regressed` signal (and `onBaselineRegression`) tell you the moment it slips. This is how the bridge turns lite-profiler's comparison core into a live cross-version guard for lite-signal itself.

```js
import { Profiler } from '@zakkster/lite-profiler';
import { createProfilerView } from '@zakkster/lite-profiler-signal';

const view = createProfilerView(profiler, {
  label: 'fan-out-1k',
  engine: 'lite-signal@1.4.0-beta.1',
  tolerances: { 'frame.avg': 0.10, 'frame.p99': 0.10, 'phase.propagate.p99': 0.15 }
});

// arm a baseline captured earlier on the previous engine (loaded from JSON)
view.setBaseline(JSON.parse(baselineJson));   // a summary from lite-signal@1.3.0

view.onBaselineRegression((report) => {
  console.warn('slower than the 1.3.0 baseline:', report.regressions);
});
// ...run the workload, pulse() each frame; regressed() flips true if it slips.
```

Metric paths are `frame.<metric>` or `phase.<tag>.<metric>`; `fps` is higher-is-better and gated in the opposite direction automatically. The live `regressed` gate is zero-allocation (pre-parsed tolerances, scalar reads on the recompute path); the full structured `RegressionReport` is built only on demand or at a transition.

---

## How it works

```
  per frame:      pulse()  ->  tick.set(n + 1)  ->  throttle(tick, intervalMs)
                                                          |
  at most ~10Hz:                                          v
                  recompute():  read ring buffers (StatsMath + FrameHistogram)
                                batch(() => set ~8 + 3 * phases signals)
```

- The **only** per-frame graph activity is `tick.set()` and the throttle's internal lockout check -- both allocation-free (`lite-throttle` makes no per-change allocations).
- The recompute reuses pre-allocated scratch objects and only ever `.set()`s signals that already exist, inside a single `batch()` so subscribers wake once.
- `onJank` is `lite-watch-ex`'s `watchChanged` over `frameClass`; `onRegression` is `watchPrevious` (rolling history) over a phase's `p99`; `onBaselineRegression` is `watchChanged` over the `regressed` signal. No extra polling loop.
- Baseline gating stays on the O(1) path: tolerances are pre-parsed into scalar gates when a baseline is armed, and the recompute sets `regressed` from scalar reads only. `summary()` / `checkAgainstBaseline()` (which build objects) run only when you call them.

---

## Testing

```sh
npm test          # node --test, zero external test deps
```

Four suites:
- **`view`** -- telemetry is lifted correctly; `frameClass` flips under load; `dispose()` is idempotent.
- **`antitrap`** -- 5000 full recomputes create zero graph nodes and never grow the pool (the headline guarantee).
- **`detectors`** -- `onJank` edge-triggers on leaving `STEADY`; `onRegression` fires on a phase p99 spike over its rolling baseline; disposers stop delivery.
- **`baseline`** -- the gate does not false-positive on equal performance and does fire on a real slowdown; `fps` is gated higher-is-better; baseline-missing metrics are skipped; the live `regressed` signal agrees with the on-demand `checkAgainstBaseline()` report; `summary()` equals the reactive signals; and 2000 gated frames still create zero graph nodes.

---

## Compatibility

| package                       | range            | role  |
| ----------------------------- | ---------------- | ----- |
| `@zakkster/lite-signal`       | `>=1.3.0 \|\| >=1.4.0-beta.1` | peer |
| `@zakkster/lite-profiler`     | `^1.1.0`         | dep   |
| `@zakkster/lite-stats-math`   | `^1.0.1`         | dep   |
| `@zakkster/lite-throttle`     | `^1.1.0`         | dep   |
| `@zakkster/lite-watch-ex`     | `^1.1.0`         | dep   |

ESM only. `sideEffects: false`. Node 18+.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
