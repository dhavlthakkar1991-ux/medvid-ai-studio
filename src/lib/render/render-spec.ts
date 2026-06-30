/**
 * Internal Canonical Render Specification (RenderSpec v1).
 *
 * Manifest V6 is the editorial/timeline source of truth. Providers (Creatomate,
 * Shotstack, custom workers, ...) each speak a different dialect. To
 * keep provider-specific logic out of upstream systems, every render flows
 * through this canonical shape:
 *
 *   Manifest V6  →  RenderSpec  →  Provider Transformer  →  Provider
 *
 * A RenderSpec is a *pure data* description of the final video. It contains
 * no provider-specific fields. Transformers read RenderSpec and emit the
 * payload their provider needs.
 */

export type RenderSpecVersion = 1;

export interface RenderCanvas {
  width: number;
  height: number;
  fps: number;
  background_color: string;
  duration_seconds: number;
}

export type RenderTrackKind =
  | "presenter"
  | "broll"
  | "graphics"
  | "captions"
  | "audio"
  | "overlay";

export interface RenderTrack {
  id: string;
  kind: RenderTrackKind;
  z_index: number;
  label?: string;
}

export type RenderAssetKind =
  | "video"
  | "image"
  | "audio"
  | "graphic"
  | "text"
  | "caption"
  | "cta";

export interface RenderAsset {
  id: string;                // stable id used by render items to reference this asset
  kind: RenderAssetKind;
  source_url: string | null; // null when payload is fully inlined (text overlays, captions)
  mime_type?: string;
  intrinsic_width?: number;
  intrinsic_height?: number;
  duration_seconds?: number;
  // optional inline payload — used for text/caption/cta assets that have no URL
  inline?: {
    text?: string;
    style?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
}

export type RenderLayout =
  | "full_screen"
  | "full_screen_broll"
  | "full_screen_cta"
  | "full_screen_doctor"
  | "pip_left"
  | "pip_right"
  | "split_screen"
  | "doctor_with_infographic"
  | "doctor_with_clinical_image"
  | "doctor_with_broll"
  | "doctor_with_callout"
  | "doctor_with_lower_third"
  | "lower_third"
  | "show_lower_third"
  | "show_text_overlay"
  | "show_callout"
  | "show_cta"
  | "kinetic_typography"
  | "highlight_keyword"
  | "top_bottom"
  | "picture_in_picture"
  | "overlay"
  | (string & {});

export type RenderTransition = "cut" | "fade" | "dissolve" | "slide";

export interface RenderItem {
  id: string;
  track_id: string;
  asset_id: string;
  start_time: number;        // seconds, absolute on the master timeline
  end_time: number;          // seconds, absolute on the master timeline
  layout: RenderLayout;
  layout_name?: string | null;
  layout_type?: string | null;
  action_type?: string | null;
  original_action_type?: string | null;
  item_type?: string | null;
  item_kind?: string | null;
  source_timeline_item_id?: string | null;
  source_render_manifest_id?: string | null;
  source_asset_id?: string | null;
  track_kind?: string | null;
  track_type?: string | null;
  asset_kind?: string | null;
  asset_type?: string | null;
  x?: number | string | null;
  y?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  anchor?: string | null;
  position?: string | null;
  margin?: number | string | null;
  padding?: number | string | null;
  safe_area?: unknown;
  doctor_position?: string | null;
  asset_position?: string | null;
  text_position?: string | null;
  overlay_position?: string | null;
  scale?: number | string | null;
  fit?: string | null;
  object_fit?: string | null;
  aspect_mode?: string | null;
  crop?: unknown;
  opacity?: number | string | null;
  z_index?: number | null;
  track_index?: number | null;
  priority?: number | null;
  duration?: number | null;
  source_start?: number | null;
  source_end?: number | null;
  trim_start?: number | null;
  trim_end?: number | null;
  transition?: string | null;
  transition_type?: string | null;
  transition_duration?: number | null;
  transition_in_type?: string | null;
  transition_out_type?: string | null;
  fade_in?: number | boolean | null;
  fade_out?: number | boolean | null;
  text?: string | null;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  font_size?: number | string | null;
  font_weight?: number | string | null;
  alignment?: string | null;
  text_align?: string | null;
  background?: string | null;
  background_opacity?: number | string | null;
  color?: string | null;
  style?: unknown;
  lower_third_variant?: string | null;
  transition_in: RenderTransition;
  transition_out: RenderTransition;
  // optional sub-rectangle on the canvas (0..1 normalized); transformers may ignore
  rect?: { x: number; y: number; w: number; h: number };
  // free-form metadata — transformers may inspect, MUST tolerate missing keys
  meta?: Record<string, unknown>;
}

export interface RenderCaption {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
  style?: string; // e.g. "default", "highlight"
}

export interface RenderGraphic {
  id: string;
  compiled_graphic_id: string | null;
  template: string | null;
  preview_url: string | null;
  payload: Record<string, unknown>;
}

export interface RenderSpec {
  spec_version: RenderSpecVersion;
  project_id: string;
  source_manifest_version: number; // Manifest V6 etc.
  canvas: RenderCanvas;
  tracks: RenderTrack[];
  assets: RenderAsset[];
  items: RenderItem[];        // ordered by start_time
  graphics: RenderGraphic[];
  captions: RenderCaption[];
  metadata: {
    title?: string | null;
    generated_at: string;
    notes?: string[];
  };
}

export const RENDER_SPEC_VERSION: RenderSpecVersion = 1;

export const DEFAULT_CANVAS_FULL: Omit<RenderCanvas, "duration_seconds"> = {
  width: 1920,
  height: 1080,
  fps: 30,
  background_color: "#000000",
};

export const DEFAULT_CANVAS_PREVIEW: Omit<RenderCanvas, "duration_seconds"> = {
  width: 1280,
  height: 720,
  fps: 30,
  background_color: "#000000",
};
