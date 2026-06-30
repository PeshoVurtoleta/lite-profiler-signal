# Roadmap / open threads

Last updated: 2026-06-30. Scope: lite-signal release pipeline + the lite-profiler
adapter family + Track A ("make the moat visible"). Facts marked (verified) were
read from uploaded source; everything else is plan or stated priority.

---

## 1. lite-signal release pipeline

**Published on npm:** `1.3.0` (latest, just published). Prior latest was `1.2.x`.

**Staged in source, NOT yet published** (verified from uploaded files):
- `1.5.0` -- `createRoot` (exported).
- `1.6.0` -- adds `createScope`. (`1_1_6.js` in the upload set is a mislabeled,
  byte-identical copy of `1.6.0`, not a real 1.1.6.)
- `1.7.0` -- `createRegistry({ flushStrategy })` + `r.flush()`. This is the head
  source (`Signal.js`).

**API availability (verified by exported declarations):**

| API                                    | First version |
| -------------------------------------- | ------------- |
| `createRegistry`                       | <= 1.5.0      |
| `createRoot`                           | 1.5.0         |
| `createScope`                          | 1.6.0         |
| `createRegistry({ flushStrategy })`, `r.flush()` | 1.7.0 |
| `signalBox` / `computedBox`            | present throughout |

**Open items**
- Publish the 1.5.0 -> 1.7.0 arc. npm is two-plus minors behind the source.
- `1.4.0`: LOW priority (per Zahary) -- decide whether it is a real step or skipped
  on the way to shipping the createRoot/createScope/flushStrategy features.
- Contents of the published `1.3.0` and any `1.4.0` are not captured here (no source
  on hand); fill in when known.

---

## 2. flushStrategy / SAB  (the Track A core primitive)

`createRegistry({ flushStrategy })`, new in **1.7.0** (verified). Resolved once at
registry init to one of two pre-built flush hooks; `eager` body stays byte-identical
to 1.6.0 (preserves the "hoisted function ref + monomorphic inlining, never per-call
closure-var loads" lesson).

- **`"eager"`** (default): `.set` outside batch auto-flushes; batch exit auto-flushes.
  No behavioral change vs 1.6.0.
- **`"sab"`** ("stable after batch", matches Andrii Volynets's `@volynets/reflex`
  sab): `.set` outside batch enqueues + marks but does NOT auto-flush; batch exit
  flushes, effects dedup via `FLAG_SCHEDULED`. This is the apples-to-apples mode for
  the js-reactivity-benchmark update group (eager's empty-path `try/finally` in
  `flushEffects` was the dominant per-write overhead on no-effect tests).
- **`"manual"`**: nothing auto-flushes; only explicit `r.flush()`. For hard-real-time
  loops that need a frame-aligned settle.

**Status:** IMPLEMENTED in 1.7.0 source, UNPUBLISHED. It is NOT an open
"should we ship" question -- the open items are (a) release it, (b) frame it.

**Framing doc TODO** (describe profiler-signal as the same principle one level up):
- Shared principle: do not flush effects on every write.
- `sab`/`manual` defer the FLUSH; the writes still happen and mark. An internal
  consumer batches (or calls `flush()` frame-aligned) and pays one delivery instead
  of N -- no write-pattern restructuring.
- `lite-profiler-signal`'s one-tick-per-frame pulse removes the WRITES too
  (phase x fps -> one tick) AND throttles reads. It is the external-consumer,
  more-aggressive version.
- So: `manual` is the in-engine analog of the pulse's frame-aligned settle; `sab`
  is the zero-restructuring version for consumers who batch; profiler-signal is the
  external version that also kills the write churn. Put this in the 1.7.0 release
  notes and/or the lite-signal README so the relationship is explicit.

---

## 3. Track A -- "make the moat visible"

**A1: DONE.** `@zakkster/lite-profiler-signal` v1.0.0 (published). Its
`test/antitrap.test.js` IS the proof artifact in test form: 5000 full reactive
recomputes through a real four-phase profiler, with `stats()` deltas
(`signals`/`computeds`/`activeNodes`/`nodePoolCapacity`) asserted at zero while
recompute count climbs. The proof was written before any Studio UI version.

**A-next (TODO): the watchable artifact.** A live lite-studio panel / demo that
shows `poolGrowthDelta` / `allocDelta` flat while `recomputeDelta` climbs -- the
visual counterpart to the antitrap test. This is the marketing-grade version of A1.

**A-doc (TODO):** the SAB framing from section 2 (overlaps; same writeup serves
both).

---

## 4. lite-profiler adapter family

**Shipped (all published, all node:test green):**
- `@zakkster/lite-profiler` 1.0.0 -- engine-agnostic frame/phase capture core.
- `@zakkster/lite-profiler-signal` 1.0.0 -- reactive bridge (peer lite-signal
  `^1.2.0`; pulse + throttle; onJank/onRegression).
- `@zakkster/lite-profiler-scheduler` 1.0.0 -- profiles lite-scheduler lanes via
  public surface only; duration-based overruns (shouldYield rejected after probing).

**Next:**
- `@zakkster/lite-profiler-ecs` -- adapter for `@zakkster/lite-ecs`. Documented
  public contract ONLY: no reaching into `world._ticking`, `pool.forEachActive`, or
  similar internals. PREREQUISITE: probe lite-ecs's real public API first (the same
  discipline that saved the scheduler adapter from the shouldYield trap).
- `@zakkster/lite-profiler-gl` -- lite-gl HUD backend; thousands of frames x phases
  in one instanced draw. PREREQUISITE: probe lite-gl's public draw/buffer surface.

**Publish prerequisite chains (now resolved):**
- Telemetry trio (`lite-ring-buffer`, `lite-stats-math`, `lite-canvas-graph`) ->
  fixed `exports` shipped as 1.0.1. DONE.
- `lite-profiler` 1.0.0 depends on the trio `^1.0.1`. DONE.
- `lite-profiler-signal` 1.0.0 depends on `lite-profiler ^1.0.0`. DONE.
- `lite-profiler-scheduler` 1.0.0 -- standalone (deps all published). DONE.

---

## 5. Corrections / notes to self

- Upload labeling: `1_1_6.js` == `1_6_0.js` (both v1.6.0). The set lacks a genuine
  1.1.6 if one was intended.
- Earlier (incorrect) claim during the bridge build: "createRoot/createScope are in
  non-public 1.6.0-preview." Correct: `createRoot` is 1.5.0, `createScope` is 1.6.0
  -- released versions, just above the `^1.2.0` floor chosen for the bridge. The
  manual-disposal decision stands; the justification was wrong.
- When the bridge eventually raises its lite-signal floor to `>=1.6.0`, it can adopt
  `createScope` for owner-cascade disposal instead of the explicit disposer list.
- Minor lite-signal packaging nit (from the npm 1.2.2 manifest): the `exports` map
  lists `"node"` before `"types"`, which can send TS consumers under
  node16/nodenext to the `.js` instead of the `.d.ts`. One-line reorder fixes
  downstream type resolution. Confirm whether it persists in the 1.7.0 publish.
