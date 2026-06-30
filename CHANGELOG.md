# Changelog

All notable changes to `@zakkster/lite-profiler-signal` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-06-30

Initial release. Reactive boundary for `@zakkster/lite-profiler`.

### Added
- `createProfilerView(profiler, options?)` factory returning a reactive view over a `Profiler`.
- Coarse frame signals: `fps`, `frameAvg`, `frameP99`, `frameMax`, `jank`, `spike`, `frameClass`.
- Per-phase signal bundles (`phases[tag]` / `phase(tag)`) exposing `avg`, `p99`, and `last`.
- `pulse()` -- a single integer tick set per frame; a `lite-throttle` window gates the recompute.
- `flush()` to force a pending throttled recompute synchronously.
- `attach()` / `detach()` convenience drivers over `requestAnimationFrame` (browser only).
- `onJank(handler)` -- fires when the classifier leaves `STEADY`, built on `lite-watch-ex` `watchChanged`.
- `onRegression(tag, handler, { factor, window })` -- per-phase rolling-baseline regression alerts, built on `lite-watch-ex` `watchPrevious`.
- `dispose()` -- idempotent teardown of the throttle, watchers, and every signal.
- `raf` option to align the pulse to `requestAnimationFrame` instead of a timer window.

### Notes
- The hot path writes no signals and allocates nothing. The anti-trap guarantee is enforced by a test that runs 5000 full recomputes and asserts the `lite-signal` registry creates zero new nodes and never grows its pool.
- Peer dependency on `@zakkster/lite-signal ^1.2.0`; the same registry instance is shared with your own effects.
- Requires the telemetry trio at `>= 1.0.1` (transitively, via `lite-profiler`) for correct Node ESM resolution.
