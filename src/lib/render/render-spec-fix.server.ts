/**
 * Canonical RenderSpec issue repair.
 *
 * Operates on the validation issues emitted by validateRenderSpec() and
 * resolves them deterministically against the underlying tables. NO new
 * pipeline stages — only canonical mutations on assets / compiled_graphics /
 * render_manifest / timeline_items, followed by a manifest rebuild.
 *
 * Fix policy:
 *   missing_asset_url       → backfill assets.url from assets.preview_url
 *                              or thumbnail_url. If still empty, reject the
 *                              asset row and unlink candidates/references so
 *                              the composer cannot pick it again.
 *   missing_graphic_payload → delete the compiled_graphic row.
 *   unused_asset            → delete the unused asset / compiled_graphic.
 *   orphan_item             → delete the offending timeline_item & manifest row.
 *   missing_asset           → delete the offending timeline_item & manifest row.
 *   invalid_time            → delete the zero-length timeline_item.
 *   out_of_bounds           → clamp end_time to canvas duration.
 *   item_overlap            → leave alone (timeline composer responsibility).
 */
import type { RenderValidationReport } from "./render-validation";

type Sb = any;
type ParsedRef = { kind: "asset" | "graphic" | "url" | "item"; id: string };

function parseRef(ref?: string | null): ParsedRef | null {
  if (!ref) return null;
  if (ref.startsWith("asset:")) return { kind: "asset", id: ref.slice(6) };
  if (ref.startsWith("graphic:")) return { kind: "graphic", id: ref.slice(8) };
  if (ref.startsWith("url:")) return { kind: "url", id: ref.slice(4) };
  return { kind: "item", id: ref };
}

function refLabel(r: ParsedRef | null) {
  return r?.id ? r.id.slice(0, 8) : "unknown";
}

async function rejectUnusableAssets(sb: Sb, projectId: string, ids: string[]) {
  if (ids.length === 0) return;
  await sb.from("asset_candidates")
    .update({ status: "rejected", linked_asset_id: null, review_note: "RenderSpec fix: asset has no renderable URL" })
    .eq("project_id", projectId)
    .in("linked_asset_id", ids);
  await sb.from("project_assets").delete().eq("project_id", projectId).in("asset_id", ids);
  await sb.from("render_manifest").update({ asset_id: null, asset_url: null, status: "pending", asset_source: "unresolved_asset" }).eq("project_id", projectId).in("asset_id", ids);
  await sb.from("timeline_items").update({ asset_id: null, status: "missing_asset" }).eq("project_id", projectId).in("asset_id", ids);
  await sb.from("assets").update({ status: "rejected", review_note: "RenderSpec fix: asset has no renderable URL" }).eq("project_id", projectId).in("id", ids);
}

export async function fixRenderSpecIssues(
  sb: Sb,
  projectId: string,
  validation: RenderValidationReport,
  canvasDuration: number,
): Promise<{ fixes: string[]; remaining: number }> {
  const fixes: string[] = [];

  const assetIdsToReject = new Set<string>();
  const graphicIdsToDelete = new Set<string>();
  const itemIdsToDelete = new Set<string>();
  const itemsToClamp: { id: string; end: number }[] = [];
  const graphicAssetsUsedByItems = new Set<string>();

  const assetRefsByItemId = new Map<string, ParsedRef>();
  const assetIdsUsedByItems = new Set<string>();
  const graphicIdsUsedByItems = new Set<string>();
  const { buildRenderSpec } = await import("./render-spec-builder.server");
  const currentSpec = await buildRenderSpec(sb, projectId, { quality: "full" });
  for (const item of currentSpec.items ?? []) {
    const r = parseRef(item.asset_id);
    if (!r) continue;
    assetRefsByItemId.set(item.id, r);
    if (r.kind === "asset") assetIdsUsedByItems.add(r.id);
    if (r.kind === "graphic") graphicIdsUsedByItems.add(r.id);
  }

  // Preload assets we may need for backfill.
  const assetIdsReferenced = new Set<string>();
  for (const iss of validation.issues) {
    const r = parseRef(iss.ref);
    if (r?.kind === "asset") assetIdsReferenced.add(r.id);
  }
  const assetMap = new Map<string, any>();
  if (assetIdsReferenced.size > 0) {
    const { data: rows } = await sb
      .from("assets")
      .select("id, url, preview_url, thumbnail_url, asset_type")
      .in("id", Array.from(assetIdsReferenced));
    for (const r of rows ?? []) assetMap.set(r.id, r);
  }

  for (const iss of validation.issues) {
    const r = parseRef(iss.ref);
    switch (iss.code) {
      case "missing_asset_url": {
        if (r?.kind !== "asset") break;
        const a = assetMap.get(r.id);
        const backfill = a?.preview_url || a?.thumbnail_url || null;
        if (backfill) {
          await sb.from("assets").update({ url: backfill }).eq("id", r.id);
          fixes.push(`Backfilled URL for ${a.asset_type ?? "asset"} ${r.id.slice(0, 8)}`);
        } else {
          assetIdsToReject.add(r.id);
          fixes.push(`Rejected unresolved ${a?.asset_type ?? "asset"} ${r.id.slice(0, 8)}`);
        }
        break;
      }
      case "missing_graphic_payload": {
        if (r?.kind !== "graphic" && r?.kind !== "item") break;
        graphicIdsToDelete.add(r.id);
        fixes.push(`Removed empty graphic ${r.id.slice(0, 8)}`);
        break;
      }
      case "unused_asset": {
        if (r?.kind === "graphic") {
          if (!graphicIdsUsedByItems.has(r.id)) {
            graphicIdsToDelete.add(r.id);
            fixes.push(`Removed unused graphic ${r.id.slice(0, 8)}`);
          }
        } else if (r?.kind === "asset") {
          if (!assetIdsUsedByItems.has(r.id)) {
            assetIdsToReject.add(r.id);
            fixes.push(`Rejected unused asset ${r.id.slice(0, 8)}`);
          }
        }
        break;
      }
      case "orphan_item":
      case "missing_asset":
      case "invalid_time": {
        if (r?.id) {
          itemIdsToDelete.add(r.id);
          fixes.push(`Removed invalid timeline item ${r.id.slice(0, 8)}`);
        }
        break;
      }
      case "out_of_bounds": {
        if (r?.id && canvasDuration > 0) {
          itemsToClamp.push({ id: r.id, end: canvasDuration });
        }
        break;
      }
      default:
        break;
    }
  }

  // Apply asset deletions: cascade via manifest + timeline first.
  if (assetIdsToDelete.size > 0) {
    const ids = Array.from(assetIdsToDelete);
    await sb.from("render_manifest").delete().eq("project_id", projectId).in("asset_id", ids);
    await sb.from("timeline_items").delete().eq("project_id", projectId).in("asset_id", ids);
    await sb.from("assets").delete().eq("project_id", projectId).in("id", ids);
  }
  if (graphicIdsToDelete.size > 0) {
    const ids = Array.from(graphicIdsToDelete);
    await sb.from("render_manifest").delete().eq("project_id", projectId).in("compiled_graphic_id", ids);
    await sb.from("timeline_items").delete().eq("project_id", projectId).in("compiled_graphic_id", ids);
    await sb.from("compiled_graphics").delete().eq("project_id", projectId).in("id", ids);
  }
  if (itemIdsToDelete.size > 0) {
    const ids = Array.from(itemIdsToDelete);
    await sb.from("render_manifest").delete().eq("project_id", projectId).in("id", ids);
    await sb.from("timeline_items").delete().eq("project_id", projectId).in("id", ids);
  }
  for (const c of itemsToClamp) {
    await sb.from("render_manifest").update({ timeline_end: c.end }).eq("id", c.id);
    await sb.from("timeline_items").update({ end_time: c.end }).eq("id", c.id);
    fixes.push(`Clamped item ${c.id.slice(0, 8)} to ${c.end.toFixed(1)}s`);
  }

  // Rebuild manifest + re-validate
  const { buildRenderManifestForProject } = await import("./timeline-builder.server");
  try { await buildRenderManifestForProject(sb, projectId); } catch (e) { console.warn("rebuild after fix failed", e); }

  const { buildRenderSpec } = await import("./render-spec-builder.server");
  const { validateRenderSpec } = await import("./render-validation");
  const spec = await buildRenderSpec(sb, projectId, { quality: "full" });
  const after = validateRenderSpec(spec);

  return { fixes, remaining: after.errorCount + after.warningCount };
}