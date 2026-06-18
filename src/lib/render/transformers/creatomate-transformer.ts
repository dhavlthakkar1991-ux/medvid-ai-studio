import type { RenderSpec } from "../render-spec";

/** STUB — Convert RenderSpec into a Creatomate payload. */
export function specToCreatomate(spec: RenderSpec): Record<string, unknown> {
  return {
    output_format: "mp4",
    width: spec.canvas.width,
    height: spec.canvas.height,
    frame_rate: spec.canvas.fps,
    duration: spec.canvas.duration_seconds,
    elements: spec.items.map((it) => ({
      type: "composition",
      track: 1,
      time: it.start_time,
      duration: Math.max(0, it.end_time - it.start_time),
      source_asset_id: it.asset_id,
      transition: { type: it.transition_in, duration: 0.3 },
    })),
  };
}