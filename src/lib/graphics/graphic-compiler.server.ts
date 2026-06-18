// Server-only: Graphics Compiler (Phase 2B-2).
//
// Converts editorial actions whose `action_type` is one of the six
// non-asset graphic types into renderable compiled graphics (SVG + JSON
// spec) keyed on the originating edit_action_id.
//
// After compilation:
//   • timeline_items.compiled_graphic_id is wired up for graphic rows.
//   • render_manifest.compiled_graphic_id is wired up and the manifest
//     row's asset_source becomes "compiled_graphic" with status "ready".
//   • Manifest V6 = "every timeline item is either an approved media
//     asset or a compiled graphic asset — no virtual items remain."

type Sb = any;

export const GRAPHIC_ACTION_TYPES = [
  "show_lower_third",
  "show_callout",
  "kinetic_typography",
  "highlight_keyword",
  "show_text_overlay",
  "show_cta",
] as const;
export type GraphicActionType = (typeof GRAPHIC_ACTION_TYPES)[number];

export function isGraphicAction(t: string | null | undefined): t is GraphicActionType {
  return !!t && (GRAPHIC_ACTION_TYPES as readonly string[]).includes(t);
}

const W = 1920;
const H = 1080;

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function pickText(ea: any): { title: string; subtitle: string } {
  const p = ea?.parameters ?? {};
  const title = String(p.title ?? p.text ?? p.headline ?? p.keyword ?? ea?.asset_query ?? ea?.action_type ?? "").trim();
  const subtitle = String(p.subtitle ?? p.subheadline ?? p.body ?? p.caption ?? "").trim();
  return { title: title || "(untitled)", subtitle };
}

function renderSVG(graphicType: string, spec: any, ea: any): string {
  const { title, subtitle } = pickText(ea);
  const bg = String(spec.bg ?? "#0f172a");
  const fg = String(spec.fg ?? "#f8fafc");
  const accent = String(spec.accent ?? "#38bdf8");
  const border = String(spec.border ?? accent);
  const font = String(spec.font ?? "Inter, system-ui, sans-serif");
  const tSize = Number(spec.title_size ?? 48);
  const sSize = Number(spec.subtitle_size ?? 22);

  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(font)}">`;
  const tail = `</svg>`;

  switch (graphicType) {
    case "show_lower_third":
      return head + [
        `<rect x="0" y="${H - 260}" width="${W}" height="260" fill="${bg}" opacity="0.92"/>`,
        `<rect x="80" y="${H - 260}" width="12" height="260" fill="${accent}"/>`,
        `<text x="120" y="${H - 160}" fill="${fg}" font-size="${tSize}" font-weight="700">${esc(title)}</text>`,
        subtitle ? `<text x="120" y="${H - 110}" fill="${fg}" font-size="${sSize}" opacity="0.85">${esc(subtitle)}</text>` : "",
      ].join("") + tail;

    case "show_callout":
      return head + [
        `<rect x="${W - 720}" y="120" rx="24" ry="24" width="640" height="220" fill="${bg}" stroke="${border}" stroke-width="6"/>`,
        `<text x="${W - 700}" y="220" fill="${fg}" font-size="${tSize}" font-weight="800">${esc(title)}</text>`,
        subtitle ? `<text x="${W - 700}" y="280" fill="${fg}" font-size="${sSize}" opacity="0.85">${esc(subtitle)}</text>` : "",
      ].join("") + tail;

    case "kinetic_typography":
      return head + [
        `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(tSize, 96)}" font-weight="900" fill="${fg}" stroke="${spec.stroke ?? accent}" stroke-width="3">${esc(title.toUpperCase())}</text>`,
      ].join("") + tail;

    case "highlight_keyword":
      return head + [
        `<rect x="${W / 2 - 540}" y="${H / 2 - 80}" rx="16" ry="16" width="1080" height="160" fill="${bg}"/>`,
        `<text x="${W / 2}" y="${H / 2 + 20}" text-anchor="middle" font-size="${Math.max(tSize, 64)}" font-weight="800" fill="${fg}">${esc(title)}</text>`,
      ].join("") + tail;

    case "show_text_overlay":
      return head + [
        `<rect x="120" y="${H - 380}" rx="14" ry="14" width="${W - 240}" height="260" fill="${bg}"/>`,
        `<rect x="120" y="${H - 380}" width="${W - 240}" height="6" fill="${accent}"/>`,
        `<text x="160" y="${H - 280}" fill="${fg}" font-size="${tSize}" font-weight="700">${esc(title)}</text>`,
        subtitle ? `<text x="160" y="${H - 220}" fill="${fg}" font-size="${sSize}" opacity="0.85">${esc(subtitle)}</text>` : "",
      ].join("") + tail;

    case "show_cta":
      return head + [
        `<rect x="${W / 2 - 540}" y="${H / 2 - 180}" rx="32" ry="32" width="1080" height="360" fill="${bg}" stroke="${border}" stroke-width="8"/>`,
        `<text x="${W / 2}" y="${H / 2 - 30}" text-anchor="middle" fill="${fg}" font-size="${tSize}" font-weight="900">${esc(title)}</text>`,
        subtitle ? `<text x="${W / 2}" y="${H / 2 + 50}" text-anchor="middle" fill="${fg}" font-size="${sSize}" opacity="0.9">${esc(subtitle)}</text>` : "",
      ].join("") + tail;

    default:
      return head + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${fg}" font-size="48">${esc(title)}</text>` + tail;
  }
}

function svgDataUrl(svg: string): string {
  // Use base64 to safely embed in <img src>.
  const b64 = typeof Buffer !== "undefined"
    ? Buffer.from(svg, "utf8").toString("base64")
    : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

export async function compileGraphicsForProject(supabase: Sb, projectId: string) {
  const [{ data: editActions }, { data: templates }] = await Promise.all([
    supabase.from("edit_actions").select("*").eq("project_id", projectId),
    supabase.from("graphic_templates").select("*").eq("is_system", true),
  ]);

  const eas = (editActions ?? []) as any[];
  const tpls = (templates ?? []) as any[];
  const tplByType = new Map<string, any>();
  for (const t of tpls) if (!tplByType.has(t.graphic_type)) tplByType.set(t.graphic_type, t);

  const graphicEAs = eas.filter((ea) => isGraphicAction(ea.action_type));

  // Delete compiled rows whose edit_action no longer applies.
  await supabase
    .from("compiled_graphics")
    .delete()
    .eq("project_id", projectId)
    .not("edit_action_id", "in", `(${graphicEAs.map((e) => `'${e.id}'`).join(",") || "''"})`);

  let compiled = 0;
  const compiledByAction = new Map<string, string>(); // edit_action_id → compiled_graphic_id
  for (const ea of graphicEAs) {
    const tpl = tplByType.get(ea.action_type);
    if (!tpl) continue;
    const mergedSpec = { ...(tpl.spec ?? {}), ...((ea.parameters ?? {}).style ?? {}) };
    const svg = renderSVG(ea.action_type, mergedSpec, ea);
    const dataUrl = svgDataUrl(svg);
    const row = {
      project_id: projectId,
      edit_action_id: ea.id,
      template_id: tpl.id,
      graphic_type: ea.action_type,
      template_name: tpl.template_name,
      spec: { ...mergedSpec, text: pickText(ea) },
      svg,
      thumbnail_url: dataUrl,
      preview_url: dataUrl,
      status: "ready",
    };
    const { data: up, error } = await supabase
      .from("compiled_graphics")
      .upsert(row, { onConflict: "edit_action_id" })
      .select("id, edit_action_id")
      .single();
    if (error) { console.warn("compile graphic failed", ea.id, error.message); continue; }
    compiled++;
    compiledByAction.set(ea.id, up.id);
  }

  // Wire timeline_items.compiled_graphic_id + mark status approved.
  for (const [eaId, cgId] of compiledByAction) {
    await supabase
      .from("timeline_items")
      .update({ compiled_graphic_id: cgId, status: "approved" })
      .eq("project_id", projectId)
      .eq("edit_action_id", eaId);
  }

  // Wire render_manifest rows → compiled_graphic_id, asset_source, status, manifest_version=6.
  for (const [eaId, cgId] of compiledByAction) {
    await supabase
      .from("render_manifest")
      .update({
        compiled_graphic_id: cgId,
        asset_source: "compiled_graphic",
        status: "ready",
        manifest_version: 6,
      })
      .eq("project_id", projectId)
      .eq("edit_action_id", eaId);
  }

  // Any manifest row that already has a real asset_id is also V6-renderable.
  await supabase
    .from("render_manifest")
    .update({ manifest_version: 6 })
    .eq("project_id", projectId)
    .not("asset_id", "is", null);

  // Count remaining virtual items (no asset_id AND no compiled_graphic_id).
  const { count: virtualCount } = await supabase
    .from("render_manifest")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("asset_id", null)
    .is("compiled_graphic_id", null);

  return {
    compiled,
    graphicActions: graphicEAs.length,
    virtualItemsRemaining: virtualCount ?? 0,
    manifestVersion: 6,
  };
}