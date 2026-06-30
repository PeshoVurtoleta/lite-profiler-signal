import type { Profiler, FrameClassLabel } from '@zakkster/lite-profiler';
import type { Signal } from '@zakkster/lite-signal';

export interface ProfilerViewOptions {
  /** Throttle window in milliseconds for the recompute. Default 100 (~10Hz). */
  intervalMs?: number;
  /** Align the pulse to requestAnimationFrame instead of a timer window. */
  raf?: boolean;
  /** Emit on the leading edge of each window. Default true. */
  leading?: boolean;
  /** Emit the trailing value at window end. Default true. */
  trailing?: boolean;
}

export interface PhaseSignals {
  avg: Signal<number>;
  p99: Signal<number>;
  last: Signal<number>;
}

export interface RegressionEvent {
  tag: string;
  p99: number;
  baseline: number;
}

export interface RegressionOptions {
  /** Fire when current p99 exceeds factor x baseline. Default 1.5. */
  factor?: number;
  /** Rolling baseline window length. Default 8. */
  window?: number;
}

export interface ProfilerView {
  readonly fps: Signal<number>;
  readonly frameAvg: Signal<number>;
  readonly frameP99: Signal<number>;
  readonly frameMax: Signal<number>;
  readonly jank: Signal<number>;
  readonly spike: Signal<number>;
  readonly frameClass: Signal<FrameClassLabel>;
  readonly phases: Record<string, PhaseSignals>;
  phase(tag: string): PhaseSignals | null;
  /** Call once per frame, after profiler.endFrame(). One cheap tick set; the throttle gates the recompute. */
  pulse(): void;
  /** Force any pending throttled recompute to run synchronously now. */
  flush(): void;
  /** Convenience: drive pulse() on requestAnimationFrame. Returns a detacher. Browser-only. */
  attach(): () => void;
  detach(): void;
  /** Fire when the classifier leaves STEADY (enters spiking or throttled). Returns a disposer. */
  onJank(handler: (cls: FrameClassLabel) => void): () => void;
  /** Fire when a phase's p99 exceeds `factor` times its rolling baseline. Returns a disposer. */
  onRegression(tag: string, handler: (event: RegressionEvent) => void, options?: RegressionOptions): () => void;
  dispose(): void;
}

/** Create a reactive view over a lite-profiler Profiler. */
export declare function createProfilerView(profiler: Profiler, options?: ProfilerViewOptions): ProfilerView;
