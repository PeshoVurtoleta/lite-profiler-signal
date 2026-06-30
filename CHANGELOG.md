# Changelog

All notable changes to `@zakkster/lite-profiler-signal` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-06-30

### Changed
- Raised the `@zakkster/lite-signal` peer range to `>=1.3.0 || >=1.4.0-beta.1` (was `^1.2.0`). 1.3.0 is the current stable floor; the range also admits the 1.4.0 stable candidate, published as `1.4.0-beta.1`.

### Verified
- The full test suite -- including the anti-trap pool-flatness proof -- passes unchanged against both `lite-signal` 1.3.0 and 1.4.0-beta.1. No source or API change in this package: the `stats()` counters and flush semantics the anti-trap test relies on are identical across the line.

### Note
- Installing the whole stack on a 1.4.0 *prerelease* can surface peer warnings from `lite-throttle` / `lite-watch-ex`, which still declare stable-only (`^1.x`) lite-signal peers. Use an npm `overrides` block or `--legacy-peer-deps` until those siblings bump; this package's own peer already admits the prerelease.

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
