import type { Profiler, FrameClassLabel, CaptureSummary, RegressionReport } from '@zakkster/lite-profiler';
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
  /** Default workload label stamped into summaries. */
  label?: string;
  /** Default engine label stamped into summaries (e.g. 'lite-signal@1.4.0-beta.1'). */
  engine?: string;
  /** Informational frame budget in ms recorded in summaries. */
  budgetMs?: number;
  /** Default regression tolerances (metric path -> allowed fractional worsening). */
  tolerances?: Record<string, number>;
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

export interface SummaryMeta {
  label?: string;
  engine?: string;
  budgetMs?: number;
  timestamp?: number;
}

export interface ProfilerView {
  readonly fps: Signal<number>;
  readonly frameAvg: Signal<number>;
  readonly frameP99: Signal<number>;
  readonly frameMax: Signal<number>;
  readonly jank: Signal<number>;
  readonly spike: Signal<number>;
  readonly frameClass: Signal<FrameClassLabel>;
  /** Live: is the current window past the armed baseline's tolerances? false when no baseline. */
  readonly regressed: Signal<boolean>;
  readonly phases: Record<string, PhaseSignals>;
  phase(tag: string): PhaseSignals | null;
  /** Snapshot the current window as a self-describing CaptureSummary. */
  summary(meta?: SummaryMeta): CaptureSummary;
  /** Arm (or clear, with null) a baseline CaptureSummary for the live regressed gate. */
  setBaseline(summary: CaptureSummary | null): CaptureSummary | null;
  /** The armed baseline, or null. */
  getBaseline(): CaptureSummary | null;
  /** Replace the tolerance map used by the live gate and checkAgainstBaseline(). */
  setTolerances(tolerances: Record<string, number> | null): Record<string, number>;
  /** Snapshot the current window and arm it as the baseline. Returns the summary. */
  captureBaseline(meta?: SummaryMeta): CaptureSummary;
  /** On-demand structured regression report vs the armed baseline (null if none). */
  checkAgainstBaseline(tolerances?: Record<string, number>): RegressionReport | null;
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
  /** Fire once each time live telemetry crosses from within-budget to regressed vs the baseline. Returns a disposer. */
  onBaselineRegression(handler: (report: RegressionReport | null) => void): () => void;
  dispose(): void;
}

/** Create a reactive view over a lite-profiler Profiler. */
export declare function createProfilerView(profiler: Profiler, options?: ProfilerViewOptions): ProfilerView;
