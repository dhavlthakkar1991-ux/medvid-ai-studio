/**
 * Internal Canonical Render Specification (RenderSpec v1).
 *
 * Manifest V6 is the editorial/timeline source of truth. Providers (Creatomate,
 * Shotstack, custom FFmpeg workers, ...) each speak a different dialect. To
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
}

export type RenderLayout =
  | "full_screen"
  | "pip_left"
  | "pip_right"
  | "split_screen"
  | "doctor_with_infographic"
  | "overlay";

export type RenderTransition = "cut" | "fade" | "dissolve" | "slide";

export interface RenderItem {
  id: string;
  track_id: string;
  asset_id: string;
  start_time: number;        // seconds, absolute on the master timeline
  end_time: number;          // seconds, absolute on the master timeline
  layout: RenderLayout;
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
