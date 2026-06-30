import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] ??= value;
  }
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  return [
    "Usage:",
    "  npm run codex:asset-pack:export -- --project-id <project_id> [--out-dir <dir>] [--include-ready]",
    "",
    "Exports prompt-only Codex handoff candidates after Studio has a render_manifest.",
    "No secrets are written to the output files.",
  ].join("\n");
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeFilePart(value) {
  return String(value ?? "asset").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "asset";
}

function isCodexHandoffCandidate(candidate) {
  const data = plainObject(candidate?.candidate_data);
  const metadata = plainObject(data.metadata);
  return Boolean(
    candidate?.provider === "codex_creative_handoff" ||
      data.provider === "codex_creative_handoff" ||
      data.codex_creative_workflow ||
      metadata.codex_creative_workflow ||
      data.codex_tool ||
      metadata.codex_tool,
  );
}

function hasMedia(candidate) {
  const data = plainObject(candidate?.candidate_data);
  return Boolean(
    firstString(
      candidate?.thumbnail_url,
      data.url,
      data.source_url,
      data.media_url,
      data.preview_url,
      data.thumbnail_url,
      data.result_url,
    )
  );
}

function toolForCandidate(candidate) {
  const data = plainObject(candidate?.candidate_data);
  const metadata = plainObject(data.metadata);
  const raw = String(data.codex_tool ?? metadata.codex_tool ?? data.generation_provider ?? "").toLowerCase();
  if (raw.includes("hyperframes")) return "hyperframes";
  if (raw.includes("imagegen")) return "imagegen";
  const type = String(candidate?.asset_type ?? "").toLowerCase();
  return type.includes("video") || type.includes("broll") ? "hyperframes" : "imagegen";
}

function candidatePrompt(candidate) {
  const data = plainObject(candidate?.candidate_data);
  const metadata = plainObject(data.metadata);
  const intent = plainObject(data.intent);
  return firstString(
    data.generation_prompt,
    metadata.generation_prompt,
    candidate?.description,
    candidate?.search_query,
    intent.visual_goal,
    intent.expected_visual,
    intent.original_instruction,
  ) ?? "";
}

function finalPromptForBrief(brief) {
  const prompt = String(brief.prompt ?? "").trim();
  if (brief.tool === "hyperframes") {
    return [
      "Create this MedVideo supporting visual as a HyperFrames-generated MP4.",
      "",
      prompt,
      "",
      `Timeline target: ${brief.timeline.start ?? "-"}-${brief.timeline.end ?? "-"}s.`,
      `Layout intent: ${brief.layout_name ?? "unspecified"}.`,
      `Action intent: ${brief.action_type ?? "unspecified"}.`,
      "Output must be a polished 16:9 MP4 b-roll/supporting visual. Do not use SVG or watermark assets.",
    ].join("\n");
  }

  return [
    "Use case: scientific-educational",
    "Asset type: MedVideo Studio final raster image asset",
    "",
    prompt,
    "",
    "Output requirements: 16:9 PNG/WebP/JPG raster image, professional medical education style, no SVG, no watermark.",
    `Layout intent: ${brief.layout_name ?? "unspecified"}.`,
    `Action intent: ${brief.action_type ?? "unspecified"}.`,
  ].join("\n");
}

function generationTaskForBrief(brief) {
  const prompt = finalPromptForBrief(brief);
  return {
    task_id: `generate:${brief.candidate_id}`,
    candidate_id: brief.candidate_id,
    render_manifest_id: brief.render_manifest_id,
    tool: brief.tool,
    codex_skill: brief.tool === "hyperframes" ? "@hyperframes" : "$imagegen",
    mode: brief.tool === "hyperframes" ? "video_broll_mp4" : "raster_image",
    title: brief.title,
    timeline: brief.timeline,
    layout_name: brief.layout_name,
    action_type: brief.action_type,
    prompt,
    negative_prompt: brief.negative_prompt,
    output_path: brief.suggested_output_path,
    import_row: {
      candidate_id: brief.candidate_id,
      render_manifest_id: brief.render_manifest_id,
      tool: brief.tool,
      title: brief.title,
      local_path: brief.suggested_output_path,
      source_url: "",
      content_type: brief.tool === "hyperframes" ? "video/mp4" : "image/png",
      duration_seconds: brief.timeline.duration_seconds,
      width: 1920,
      height: 1080,
      generation_prompt: prompt,
      negative_prompt: brief.negative_prompt,
    },
  };
}

function roleFor(assetType) {
  const type = String(assetType ?? "").toLowerCase();
  if (type.includes("broll") || type.includes("video")) return "B-roll";
  if (type.includes("clinical")) return "Clinical Image";
  if (type.includes("diagram") || type.includes("illustration")) return "Medical Diagram";
  if (type.includes("lower") || type.includes("overlay") || type.includes("cta")) return "Overlay";
  return "Infographic";
}

function manifestForCandidate(candidate, manifestById, manifestRows) {
  const data = plainObject(candidate?.candidate_data);
  const intent = plainObject(data.intent);
  const directId = firstString(data.source_render_manifest_id, data.render_manifest_id, intent.render_manifest_id);
  if (directId && manifestById.has(directId)) return manifestById.get(directId);
  return manifestRows.find((row) => {
    if (candidate.edit_action_id && row.edit_action_id && String(candidate.edit_action_id) === String(row.edit_action_id)) return true;
    if (candidate.storyboard_item_id && row.storyboard_item_id && String(candidate.storyboard_item_id) === String(row.storyboard_item_id)) return true;
    if (candidate.scene_id && row.scene_id && String(candidate.scene_id) === String(row.scene_id)) {
      const cText = `${candidate.search_query ?? ""} ${candidate.title ?? ""}`.toLowerCase();
      const rText = `${row.asset_query ?? ""} ${row.action_type ?? ""} ${row.asset_type ?? ""}`.toLowerCase();
      return cText.split(/\W+/).filter((word) => word.length > 3).some((word) => rText.includes(word));
    }
    return false;
  }) ?? null;
}

loadEnv(path.resolve(".env"));

if (flag("--help") || flag("-h")) {
  console.log(usage());
  process.exit(0);
}

const projectId = argValue("--project-id", process.env.CODEX_ASSET_PROJECT_ID ?? process.env.PROJECT_ID);
if (!projectId) throw new Error("Missing --project-id.");

const outDir = path.resolve(argValue("--out-dir", path.join("data", "codex-asset-packs", projectId)));
const includeReady = flag("--include-ready");
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const [{ data: project, error: projectError }, { data: candidates, error: candidateError }, { data: manifest, error: manifestError }] = await Promise.all([
  sb.from("projects").select("id,title,topic,duration_seconds,width,height").eq("id", projectId).maybeSingle(),
  sb.from("asset_candidates").select("*").eq("project_id", projectId).order("priority", { ascending: true }),
  sb.from("render_manifest").select("*").eq("project_id", projectId).order("timeline_start", { ascending: true }),
]);

if (projectError) throw new Error(projectError.message);
if (!project) throw new Error(`Project ${projectId} not found.`);
if (candidateError) throw new Error(candidateError.message);
if (manifestError) throw new Error(manifestError.message);

const manifestRows = manifest ?? [];
const manifestById = new Map(manifestRows.map((row) => [String(row.id), row]));
const codexCandidates = (candidates ?? [])
  .filter(isCodexHandoffCandidate)
  .filter((candidate) => includeReady || !hasMedia(candidate));

const briefs = codexCandidates.map((candidate, index) => {
  const data = plainObject(candidate.candidate_data);
  const metadata = plainObject(data.metadata);
  const intent = plainObject(data.intent);
  const row = manifestForCandidate(candidate, manifestById, manifestRows);
  const tool = toolForCandidate(candidate);
  const start = numberOrNull(row?.timeline_start ?? data.matched_manifest_timeline_start ?? data.start_time ?? intent.start_time ?? plainObject(intent.time_range).start);
  const end = numberOrNull(row?.timeline_end ?? data.matched_manifest_timeline_end ?? data.end_time ?? intent.end_time ?? plainObject(intent.time_range).end);
  const prompt = candidatePrompt(candidate);
  const filenameBase = `${String(index + 1).padStart(2, "0")}_${safeFilePart(tool)}_${safeFilePart(candidate.title ?? candidate.search_query ?? candidate.id)}`;
  return {
    asset_brief_id: `codex:${candidate.id}`,
    candidate_id: candidate.id,
    project_id: projectId,
    render_manifest_id: row?.id ?? data.source_render_manifest_id ?? null,
    scene_id: candidate.scene_id ?? row?.scene_id ?? null,
    edit_action_id: candidate.edit_action_id ?? row?.edit_action_id ?? null,
    storyboard_item_id: candidate.storyboard_item_id ?? row?.storyboard_item_id ?? null,
    asset_type: candidate.asset_type,
    role: roleFor(candidate.asset_type),
    tool,
    title: candidate.title ?? candidate.search_query ?? `Codex asset ${index + 1}`,
    prompt,
    negative_prompt: data.negative_prompt ?? metadata.negative_prompt ?? "No watermark. No SVG. No fake facts. No extra medical labels not present in the prompt.",
    timeline: {
      start,
      end,
      duration_seconds: start !== null && end !== null ? Math.max(0, end - start) : null,
    },
    layout_name: row?.layout_name ?? data.layout_name ?? metadata.layout_name ?? plainObject(intent).layout_name ?? null,
    action_type: row?.action_type ?? data.action_type ?? metadata.action_type ?? null,
    required_labels: intent.required_labels ?? metadata.required_labels ?? [],
    required_callouts: intent.required_callouts ?? metadata.required_callouts ?? [],
    must_avoid: intent.must_avoid ?? metadata.must_avoid ?? [],
    output_contract: {
      allowed_formats: tool === "hyperframes" ? ["mp4"] : ["png", "webp", "jpg"],
      disallowed_formats: ["svg"],
      preferred_size: tool === "hyperframes" ? "1920x1080 MP4" : "1920x1080 raster image",
      storage_note: "After Codex generation, put local_path or source_url into codex_asset_import_template.json and run codex:asset-pack:import.",
    },
    suggested_output_path: path.join("generated", `${filenameBase}.${tool === "hyperframes" ? "mp4" : "png"}`).replace(/\\/g, "/"),
  };
});

fs.mkdirSync(outDir, { recursive: true });

const pack = {
  schema: "medvideo.codex_asset_pack.v1",
  exported_at: new Date().toISOString(),
  project,
  project_id: projectId,
  source: "studio_render_manifest_after_codex_handoff",
  policy: {
    studio_is_director: true,
    codex_generates_final_assets: true,
    image_assets_use: "Codex ImageGen raster output",
    broll_assets_use: "HyperFrames MP4 output",
    no_svg_primary_workflow: true,
    no_worker_ffmpeg_asset_generation: true,
  },
  counts: {
    render_manifest_rows: manifestRows.length,
    codex_briefs: briefs.length,
    imagegen: briefs.filter((brief) => brief.tool === "imagegen").length,
    hyperframes: briefs.filter((brief) => brief.tool === "hyperframes").length,
  },
  briefs,
};

const importTemplate = {
  schema: "medvideo.codex_asset_import.v1",
  project_id: projectId,
  generated_assets: briefs.map((brief) => ({
    candidate_id: brief.candidate_id,
    render_manifest_id: brief.render_manifest_id,
    tool: brief.tool,
    title: brief.title,
    local_path: brief.suggested_output_path,
    source_url: "",
    content_type: brief.tool === "hyperframes" ? "video/mp4" : "image/png",
    duration_seconds: brief.timeline.duration_seconds,
    width: 1920,
    height: 1080,
    generation_prompt: finalPromptForBrief(brief),
    negative_prompt: brief.negative_prompt,
    notes: "Replace local_path with the actual generated file path, or provide source_url.",
  })),
};

const generationTasks = {
  schema: "medvideo.codex_generation_tasks.v1",
  project_id: projectId,
  generated_at: new Date().toISOString(),
  policy: {
    studio_is_director: true,
    codex_generates_assets_after_manifest: true,
    imagegen_outputs: ["png", "webp", "jpg"],
    hyperframes_outputs: ["mp4"],
    disallowed_outputs: ["svg"],
    import_after_generation: "Update codex_asset_import_template.json or use each task.import_row, then run codex:asset-pack:import -- --file <template> --apply.",
  },
  tasks: briefs.map(generationTaskForBrief),
};

function writeJson(filename, value) {
  fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePromptMarkdown(filename, tool, rows) {
  const content = [
    `# ${tool === "hyperframes" ? "HyperFrames" : "ImageGen"} Prompts`,
    "",
    ...rows.flatMap((brief) => [
      `## ${brief.title}`,
      "",
      `- candidate_id: \`${brief.candidate_id}\``,
      `- render_manifest_id: \`${brief.render_manifest_id ?? "unmapped"}\``,
      `- time: ${brief.timeline.start ?? "-"}-${brief.timeline.end ?? "-"}s`,
      `- layout: ${brief.layout_name ?? "-"}`,
      `- output: \`${brief.suggested_output_path}\``,
      "",
      "```text",
      finalPromptForBrief(brief),
      "```",
      "",
      "Negative prompt:",
      "",
      "```text",
      brief.negative_prompt,
      "```",
      "",
    ]),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, filename), content, "utf8");
}

writeJson("codex_asset_pack.json", pack);
writeJson("codex_generation_tasks.json", generationTasks);
writeJson("codex_asset_import_template.json", importTemplate);
writePromptMarkdown("imagegen_prompts.md", "imagegen", briefs.filter((brief) => brief.tool === "imagegen"));
writePromptMarkdown("hyperframes_prompts.md", "hyperframes", briefs.filter((brief) => brief.tool === "hyperframes"));
fs.writeFileSync(
  path.join(outDir, "README.md"),
  [
    "# Codex Asset Pack",
    "",
    "This is the primary MedVideo asset-generation handoff. Studio remains the director; Codex produces final reviewable assets after the render manifest exists.",
    "",
    "1. Use `codex_generation_tasks.json` as the authoritative work queue.",
    "2. Generate `$imagegen` tasks as PNG/WebP/JPG raster images.",
    "3. Generate `@hyperframes` tasks as 16:9 MP4 b-roll/supporting visuals.",
    "4. Edit `codex_asset_import_template.json` so each generated asset has a valid `local_path` or `source_url`.",
    "5. Dry-run import:",
    "   `npm run codex:asset-pack:import -- --file <path-to-template>`",
    "6. Apply import:",
    "   `npm run codex:asset-pack:import -- --file <path-to-template> --apply`",
    "",
    "Do not use SVG or worker-side generated placeholder graphics in the primary Codex asset workflow.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(JSON.stringify({
  ok: true,
  project_id: projectId,
  out_dir: outDir,
  codex_briefs: briefs.length,
  imagegen: pack.counts.imagegen,
  hyperframes: pack.counts.hyperframes,
}, null, 2));
