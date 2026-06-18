import type {
  RenderAsset, RenderItem, RenderLayout, RenderSpec, RenderTransition,
} from "../render-spec";

/**
 * Convert a RenderSpec into a Creatomate source composition.
 *
 * Creatomate accepts either { template_id, modifications } OR a free-form
 * { source: { elements: [...] } } composition. We use the latter so the
 * editorial decisions in RenderSpec map 1:1 to elements without depending
 * on a hand-maintained template.
 *
 * Reference: https://creatomate.com/docs/api/rest-api/the-render-object
 *            https://creatomate.com/docs/json/elements
 *
 * Track convention (Creatomate stacks higher track numbers above lower):
 *   1 — background / b-roll
 *   2 — presenter (full or PiP)
 *   3 — clinical images, diagrams, infographics
 *   4 — compiled graphics / overlays (lower-thirds, callouts, CTAs)
 *   5 — captions (always on top)
 */

type ElementBox = { x: string; y: string; width: string; height: string };

const TRACKS = {
  background: 1,
  presenter: 2,
  visual: 3,
  overlay: 4,
  caption: 5,
} as const;

function transitionFor(t: RenderTransition, durationS = 0.3) {
  if (t === "cut") return undefined;
  const map: Record<Exclude<RenderTransition, "cut">, string> = {
    fade: "fade",
    dissolve: "fade",
    slide: "slide",
  };
  return { type: map[t as Exclude<RenderTransition, "cut">], duration: durationS };
}

function boxForLayout(layout: RenderLayout, kind: "presenter" | "visual"): ElementBox {
  // Defaults expressed as percentages of the canvas so the same payload works
  // for both preview (1280x720) and full (1920x1080).
  if (layout === "full_screen") {
    return { x: "50%", y: "50%", width: "100%", height: "100%" };
  }
  if (layout === "pip_left") {
    return kind === "presenter"
      ? { x: "18%", y: "78%", width: "30%", height: "38%" }
      : { x: "50%", y: "50%", width: "100%", height: "100%" };
  }
  if (layout === "pip_right") {
    return kind === "presenter"
      ? { x: "82%", y: "78%", width: "30%", height: "38%" }
      : { x: "50%", y: "50%", width: "100%", height: "100%" };
  }
  if (layout === "split_screen") {
    return kind === "presenter"
      ? { x: "25%", y: "50%", width: "50%", height: "100%" }
      : { x: "75%", y: "50%", width: "50%", height: "100%" };
  }
  if (layout === "doctor_with_infographic") {
    return kind === "presenter"
      ? { x: "25%", y: "50%", width: "50%", height: "100%" }
      : { x: "75%", y: "50%", width: "48%", height: "78%" };
  }
  // "overlay" and unknown — float visuals at a comfortable safe area
  return kind === "presenter"
    ? { x: "50%", y: "50%", width: "100%", height: "100%" }
    : { x: "50%", y: "30%", width: "70%", height: "55%" };
}

function boxFromRect(rect?: RenderItem["rect"]): ElementBox | null {
  if (!rect) return null;
  const cx = (rect.x + rect.w / 2) * 100;
  const cy = (rect.y + rect.h / 2) * 100;
  return { x: `${cx}%`, y: `${cy}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };
}

function assetMap(spec: RenderSpec): Map<string, RenderAsset> {
  const m = new Map<string, RenderAsset>();
  for (const a of spec.assets) m.set(a.id, a);
  return m;
}

function videoOrImageElement(
  item: RenderItem, asset: RenderAsset, track: number, box: ElementBox,
): Record<string, unknown> | null {
  if (!asset.source_url) return null;
  const duration = Math.max(0.1, item.end_time - item.start_time);
  const base: Record<string, unknown> = {
    type: asset.kind === "video" ? "video" : "image",
    track,
    time: item.start_time,
    duration,
    source: asset.source_url,
    fit: "cover",
    ...box,
  };
  const tIn = transitionFor(item.transition_in);
  const tOut = transitionFor(item.transition_out);
  if (tIn) base.animations = [{ ...tIn, easing: "linear", time: "start" }];
  if (tOut) {
    const arr = (base.animations as any[] | undefined) ?? [];
    arr.push({ ...tOut, easing: "linear", time: "end", reversed: true });
    base.animations = arr;
  }
  return base;
}

function textElement(
  item: RenderItem, asset: RenderAsset, fallbackText: string | undefined,
): Record<string, unknown> | null {
  const text = asset.inline?.text ?? fallbackText;
  if (!text) return null;
  const style = (asset.inline?.style ?? {}) as Record<string, unknown>;
  const duration = Math.max(0.5, item.end_time - item.start_time);
  const box = boxFromRect(item.rect) ?? {
    x: "50%", y: "85%", width: "80%", height: "15%",
  };
  return {
    type: "text",
    track: TRACKS.overlay,
    time: item.start_time,
    duration,
    text,
    font_family: (style.font_family as string) ?? "Inter",
    font_weight: (style.font_weight as string) ?? "700",
    font_size: (style.font_size as string) ?? "5 vmin",
    fill_color: (style.fill_color as string) ?? "#ffffff",
    background_color: (style.background_color as string) ?? "rgba(0,0,0,0.55)",
    background_x_padding: "3%",
    background_y_padding: "3%",
    background_border_radius: "12",
    line_height: "120%",
    ...box,
  };
}

function trackForItem(asset: RenderAsset, layout: RenderLayout): number {
  if (asset.kind === "video") {
    // A full-screen video on a non-overlay slot is the background; a PiP is the presenter.
    if (layout === "full_screen") return TRACKS.background;
    return TRACKS.presenter;
  }
  if (asset.kind === "image") return TRACKS.visual;
  if (asset.kind === "graphic") return TRACKS.overlay;
  if (asset.kind === "text" || asset.kind === "cta") return TRACKS.overlay;
  if (asset.kind === "caption") return TRACKS.caption;
  if (asset.kind === "audio") return 0; // audio elements ignore visual stacking
  return TRACKS.visual;
}

function captionElement(
  c: RenderSpec["captions"][number],
): Record<string, unknown> {
  return {
    type: "text",
    track: TRACKS.caption,
    time: c.start_time,
    duration: Math.max(0.2, c.end_time - c.start_time),
    text: c.text,
    font_family: "Inter",
    font_weight: "600",
    font_size: "4.2 vmin",
    fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.65)",
    background_x_padding: "2%",
    background_y_padding: "2%",
    background_border_radius: "10",
    x: "50%", y: "92%", width: "86%", height: "12%",
    text_wrap: true,
    text_alignment: "center",
  };
}

export interface CreatomateComposition {
  output_format: "mp4";
  frame_rate: number;
  width: number;
  height: number;
  duration: number;
  fill_color: string;
  elements: Record<string, unknown>[];
}

/** Build a Creatomate composition from a canonical RenderSpec. */
export function specToCreatomate(spec: RenderSpec): CreatomateComposition {
  const assets = assetMap(spec);
  const elements: Record<string, unknown>[] = [];

  for (const item of spec.items) {
    const asset = assets.get(item.asset_id);
    if (!asset) continue;
    const track = trackForItem(asset, item.layout);

    if (asset.kind === "video" || asset.kind === "image") {
      const kind: "presenter" | "visual" = track === TRACKS.presenter ? "presenter" : "visual";
      const box = boxFromRect(item.rect) ?? boxForLayout(item.layout, kind);
      const el = videoOrImageElement(item, asset, track, box);
      if (el) elements.push(el);
      continue;
    }

    if (asset.kind === "graphic") {
      // Compiled graphics are rendered as overlay images when we have a URL,
      // otherwise fall back to a text card using the graphic's inline payload.
      if (asset.source_url) {
        const box = boxFromRect(item.rect) ?? { x: "50%", y: "78%", width: "70%", height: "22%" };
        const el = videoOrImageElement(item, asset, TRACKS.overlay, box);
        if (el) elements.push(el);
      } else {
        const el = textElement(item, asset, (asset.inline?.style as any)?.headline as string | undefined);
        if (el) elements.push(el);
      }
      continue;
    }

    if (asset.kind === "text" || asset.kind === "cta" || asset.kind === "caption") {
      const el = textElement(item, asset, undefined);
      if (el) elements.push(el);
      continue;
    }

    if (asset.kind === "audio" && asset.source_url) {
      elements.push({
        type: "audio",
        time: item.start_time,
        duration: Math.max(0.1, item.end_time - item.start_time),
        source: asset.source_url,
      });
    }
  }

  // Spec-level captions render on top of everything.
  for (const c of spec.captions) elements.push(captionElement(c));

  return {
    output_format: "mp4",
    frame_rate: spec.canvas.fps,
    width: spec.canvas.width,
    height: spec.canvas.height,
    duration: Math.max(1, spec.canvas.duration_seconds),
    fill_color: spec.canvas.background_color || "#000000",
    elements,
  };
}