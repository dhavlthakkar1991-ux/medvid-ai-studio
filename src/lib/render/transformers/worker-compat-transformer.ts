import type { RenderSpec } from "../render-spec";

/**
 * Minimal compatibility graph for older Custom Worker payloads.
 *
 * The current primary render path consumes RenderSpec directly and renders via
 * the worker's HyperFrames/Remotion flow. The outbound payload still includes
 * the historical `ffmpeg_graph` key so already-deployed workers and Studio
 * callback records remain shape-compatible.
 */
export interface WorkerCompatGraph {
  canvas: { width: number; height: number; fps: number; duration: number; background: string };
  inputs: Array<{ id: string; url: string | null; kind: string }>;
  clips: Array<{
    id: string;
    input_id: string;
    start: number;
    end: number;
    layout: string;
    transition_in: string;
    transition_out: string;
  }>;
  captions: Array<{ id: string; start: number; end: number; text: string; style: string }>;
}

export function specToWorkerCompatGraph(spec: RenderSpec): WorkerCompatGraph {
  return {
    canvas: {
      width: spec.canvas.width,
      height: spec.canvas.height,
      fps: spec.canvas.fps,
      duration: spec.canvas.duration_seconds,
      background: spec.canvas.background_color,
    },
    inputs: spec.assets.map((a) => ({ id: a.id, url: a.source_url, kind: a.kind })),
    clips: spec.items.map((it) => ({
      id: it.id,
      input_id: it.asset_id,
      start: it.start_time,
      end: it.end_time,
      layout: it.layout,
      transition_in: it.transition_in,
      transition_out: it.transition_out,
    })),
    captions: spec.captions.map((c) => ({
      id: c.id,
      start: c.start_time,
      end: c.end_time,
      text: c.text,
      style: c.style ?? "default",
    })),
  };
}
