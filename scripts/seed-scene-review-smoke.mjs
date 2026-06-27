import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ??= value;
  }
}

function randomPassword() {
  return `MvSmoke-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

loadEnv(path.resolve(".env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const marker = `scene_review_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const email = `${marker}@example.test`;
const password = randomPassword();
const outDir = path.join("data", "review-artifacts", marker);
const outPath = path.join(outDir, "scene-review-smoke-fixture.json");

await fsp.mkdir(outDir, { recursive: true });

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const result = {
  generated_at: new Date().toISOString(),
  marker,
  email,
  password,
  created: {},
  cleanup_note: "Disposable smoke fixture. Delete user/project manually when no longer needed.",
};

try {
  const { data: userData, error: userError } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "scene_review_smoke", marker },
  });
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Supabase did not return a created user id.");
  result.created.user_id = userId;

  const { data: project, error: projectError } = await sb
    .from("projects")
    .insert({
      user_id: userId,
      title: "Scene Review Smoke Fixture",
      topic: "Smoke test medical education scene",
      status: "draft",
      duration_seconds: 8,
      width: 1280,
      height: 720,
      fps: 30,
      video_path: `${marker}/presenter.mp4`,
    })
    .select("id")
    .single();
  if (projectError) throw projectError;
  result.created.project_id = project.id;

  const { data: scene, error: sceneError } = await sb
    .from("scenes")
    .insert({
      project_id: project.id,
      scene_number: 1,
      title: "Lower-third introduction",
      start_time: 0,
      end_time: 8,
      duration: 8,
      narration_text: "Introduce the doctor and topic with a professional lower third.",
      objective: "Verify scene-centric asset review grouping.",
    })
    .select("id")
    .single();
  if (sceneError) throw sceneError;
  result.created.scene_id = scene.id;

  const mediaUrl =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320"><rect width="1280" height="320" rx="24" fill="#10344a"/><rect x="34" y="34" width="1212" height="252" rx="20" fill="#f8fbfc"/><text x="88" y="142" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#10344a">Dr. Smoke Test</text><text x="88" y="218" font-family="Arial, sans-serif" font-size="36" fill="#356274">Professional lower-third review fixture</text></svg>`,
    );

  const { data: manifest, error: manifestError } = await sb
    .from("render_manifest")
    .insert({
      project_id: project.id,
      scene_id: scene.id,
      render_order: 1,
      manifest_version: 6,
      asset_type: "lower_third",
      asset_query: "Professional doctor lower third",
      asset_source: "asset_review_required",
      status: "pending",
      timeline_start: 0,
      timeline_end: 8,
      layout_name: "lower_third",
      action_type: "show_lower_third",
      caption_style: "",
      transition: "cut",
      priority: 100,
    })
    .select("id")
    .single();
  if (manifestError) throw manifestError;
  result.created.render_manifest_id = manifest.id;

  const { data: candidate, error: candidateError } = await sb
    .from("asset_candidates")
    .insert({
      project_id: project.id,
      scene_id: scene.id,
      asset_type: "lower_third",
      search_query: "Professional doctor lower third",
      provider: "smoke_fixture",
      priority: 100,
      status: "searched",
      title: "Professional doctor lower third",
      description: "Renderable lower-third asset for the Scene Asset Review smoke test.",
      thumbnail_url: mediaUrl,
      candidate_data: {
        url: mediaUrl,
        source_url: mediaUrl,
        preview_url: mediaUrl,
        thumbnail_url: mediaUrl,
        license_status: "known_open",
        usage_recommendation: "safe_to_use",
        overall_asset_score: 96,
        intent_match_score: 96,
        visual_quality_score: 92,
        source_domain: "fixture.local",
        medical_asset_taxonomy: "INFOGRAPHIC_CARD",
        medical_source_class: "manual_upload",
        layout_name: "lower_third",
        action_type: "show_lower_third",
        render_manifest_id: manifest.id,
        narration_context: "Introduce the doctor and topic with a professional lower third.",
      },
    })
    .select("id")
    .single();
  if (candidateError) throw candidateError;
  result.created.candidate_id = candidate.id;

  result.smoke_env = {
    STUDIO_SMOKE_EMAIL: email,
    STUDIO_SMOKE_PASSWORD: password,
    STUDIO_SMOKE_PROJECT_ID: project.id,
  };
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  result.finished_at = new Date().toISOString();
  await fsp.writeFile(outPath, JSON.stringify(result, null, 2));
}

console.log(JSON.stringify({
  ok: result.ok,
  email: result.email,
  project_id: result.created.project_id,
  artifact: outPath,
}, null, 2));
