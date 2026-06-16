/** Merge specialty template + project_context into the system prompt suffix injected
 *  before every LLM call. Decision hierarchy: Project Context ▸ Specialty Template ▸ Defaults. */
export type ContextRow = {
  audience: string | null;
  specialty: string | null;
  brand_voice: string | null;
  target_platform: string | null;
  content_type: string | null;
  visual_style: string | null;
  scene_patterns: unknown;
  infographic_types: unknown;
  broll_types: unknown;
  thumbnail_style: unknown;
  render_intent: string | null;
  visual_density: string | null;
  retention_priority: string | null;
};

export type TemplateRow = {
  template_name: string | null;
  default_audience: string | null;
  default_brand_voice: string | null;
  default_visual_style: string | null;
  default_scene_patterns: unknown;
  default_infographic_types: unknown;
  default_broll_types: unknown;
  default_thumbnail_style: unknown;
} | null;

export function buildContextPrompt(ctx: ContextRow | null, tpl: TemplateRow): string {
  const lines: string[] = ["", "## Project Context"];
  const get = (a: string | null | undefined, b: string | null | undefined) => a || b || "—";
  lines.push(`- Specialty: ${ctx?.specialty || tpl?.template_name || "General"}`);
  lines.push(`- Audience: ${get(ctx?.audience, tpl?.default_audience)}`);
  lines.push(`- Brand voice: ${get(ctx?.brand_voice, tpl?.default_brand_voice)}`);
  lines.push(`- Visual style: ${get(ctx?.visual_style, tpl?.default_visual_style)}`);
  lines.push(`- Target platform: ${ctx?.target_platform || "YouTube"}`);
  lines.push(`- Content type: ${ctx?.content_type || "Educational"}`);
  lines.push(`- Render intent: ${ctx?.render_intent || "youtube_education"}`);
  lines.push(`- Visual density: ${ctx?.visual_density || "medium"}`);
  lines.push(`- Retention priority: ${ctx?.retention_priority || "high"}`);
  const arr = (v: unknown) => Array.isArray(v) ? v.join(", ") : "—";
  const scenes = (Array.isArray(ctx?.scene_patterns) && (ctx?.scene_patterns as unknown[]).length) ? ctx!.scene_patterns : tpl?.default_scene_patterns;
  const infos = (Array.isArray(ctx?.infographic_types) && (ctx?.infographic_types as unknown[]).length) ? ctx!.infographic_types : tpl?.default_infographic_types;
  const broll = (Array.isArray(ctx?.broll_types) && (ctx?.broll_types as unknown[]).length) ? ctx!.broll_types : tpl?.default_broll_types;
  lines.push(`- Preferred scene patterns: ${arr(scenes)}`);
  lines.push(`- Preferred infographic types: ${arr(infos)}`);
  lines.push(`- Preferred B-roll types: ${arr(broll)}`);
  const thumb = (ctx?.thumbnail_style && Object.keys(ctx.thumbnail_style as object).length) ? ctx.thumbnail_style : tpl?.default_thumbnail_style;
  if (thumb) lines.push(`- Thumbnail style: ${JSON.stringify(thumb)}`);
  return lines.join("\n");
}
