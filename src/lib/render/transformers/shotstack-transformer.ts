import type { RenderSpec } from "../render-spec";

/** STUB — Convert RenderSpec into a Shotstack edit JSON payload. */
export function specToShotstack(spec: RenderSpec): Record<string, unknown> {
  return {
    timeline: {
      background: spec.canvas.background_color,
      tracks: [{
        clips: spec.items.map((it) => {
          const asset = spec.assets.find((a) => a.id === it.asset_id);
          return {
            asset: asset?.source_url
              ? { type: asset.kind === "image" ? "image" : "video", src: asset.source_url }
              : { type: "title", text: asset?.inline?.text ?? "" },
            start: it.start_time,
            length: Math.max(0, it.end_time - it.start_time),
            transition: { in: it.transition_in, out: it.transition_out },
          };
        }),
      }],
    },
    output: {
      format: "mp4",
      resolution: spec.canvas.height === 1080 ? "hd" : "sd",
      fps: spec.canvas.fps,
    },
  };
}