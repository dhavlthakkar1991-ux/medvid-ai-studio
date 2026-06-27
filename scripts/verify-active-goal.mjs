import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_TABLES = [
  "projects",
  "render_jobs",
  "render_outputs",
  "render_providers",
  "render_provider_jobs",
  "timeline_tracks",
  "timeline_items",
  "assets",
  "asset_candidates",
];

const NORMALIZED_ASSET_TYPES = [
  "clinical_image",
  "medical_diagram",
  "infographic",
  "callout",
  "lower_third",
  "cta_branding",
  "contextual_broll",
  "text_overlay",
  "end_card",
  "caption",
  "presenter_video",
];

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

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

function boolEnv(name) {
  return Boolean(process.env[name]);
}

function shortError(error) {
  if (!error) return null;
  return {
    code: error.code ?? null,
    message: error.message ?? String(error),
    details: error.details ?? null,
  };
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2));
}

async function probeWorkerHealth(workerUrl) {
  if (!workerUrl) return { status: "skipped", reason: "worker_url is not configured" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${String(workerUrl).replace(/\/$/, "")}/health`, { signal: controller.signal })
      .finally(() => clearTimeout(timer));
    const body = await response.json().catch(() => null);
    return {
      status: response.ok ? "ok" : "warn",
      http_status: response.status,
      service: body?.service ?? null,
      mode: body?.mode ?? null,
      secret_configured: body?.secret_configured ?? null,
    };
  } catch (error) {
    return { status: "warn", error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeAssetTaxonomy(sb, userId) {
  const marker = `active_goal_taxonomy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = {
    attempted_asset_types: NORMALIZED_ASSET_TYPES,
    marker,
    accepted: [],
    rejected: [],
    cleanup: {},
    remote_taxonomy_migration_pending: false,
  };
  let projectId = null;
  try {
    const { data: project, error: projectError } = await sb
      .from("projects")
      .insert({
        user_id: userId,
        title: marker,
        status: "draft",
        video_path: `${marker}.mp4`,
        duration_seconds: 1,
      })
      .select("id")
      .single();
    if (projectError) throw projectError;
    projectId = project.id;
    result.project_id = projectId;

    for (const assetType of NORMALIZED_ASSET_TYPES) {
      const { data, error } = await sb
        .from("assets")
        .insert({
        project_id: projectId,
        asset_type: assetType,
        source_type: "manual",
        source: "active_goal_readiness_probe",
          status: "approved",
          title: `${marker}:${assetType}`,
          url: "https://example.com/probe.png",
          metadata: { active_goal_probe: marker, normalized_asset_type: assetType },
        })
        .select("id, asset_type")
        .single();
      if (error) result.rejected.push({ asset_type: assetType, error: shortError(error) });
      else result.accepted.push(data);
    }
  } finally {
    if (projectId) {
      const { error: assetCleanupError } = await sb.from("assets").delete().eq("project_id", projectId);
      result.cleanup.assets = assetCleanupError ? shortError(assetCleanupError) : "ok";
      const { error: projectCleanupError } = await sb.from("projects").delete().eq("id", projectId);
      result.cleanup.project = projectCleanupError ? shortError(projectCleanupError) : "ok";
    }
  }
  result.ok = result.rejected.length === 0 && result.accepted.length === NORMALIZED_ASSET_TYPES.length;
  result.remote_taxonomy_migration_pending =
    !result.ok &&
    result.rejected.some((row) =>
      row.error?.code === "23514" &&
      /assets_asset_type_check/i.test(`${row.error.message ?? ""} ${row.error.details ?? ""}`),
    );
  return result;
}

loadEnv(path.resolve(".env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outPath = process.env.ACTIVE_GOAL_READINESS_OUT ?? path.join("data", "review-artifacts", "active-goal-readiness.json");
const manualTaxonomySqlFile = path.join("supabase", "pending_remote_taxonomy_migration.sql");

const result = {
  generated_at: new Date().toISOString(),
  project_ref: supabaseUrl ? projectRefFromUrl(supabaseUrl) : null,
  env: {
    supabase_url_configured: Boolean(supabaseUrl),
    supabase_service_role_configured: boolEnv("SUPABASE_SERVICE_ROLE_KEY"),
    supabase_publishable_configured:
      boolEnv("SUPABASE_PUBLISHABLE_KEY") ||
      boolEnv("SUPABASE_ANON_KEY") ||
      boolEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
      boolEnv("VITE_SUPABASE_ANON_KEY"),
    job_runner_secret_configured: boolEnv("JOB_RUNNER_SECRET"),
    custom_worker_secret_configured: boolEnv("CUSTOM_WORKER_SECRET"),
    llm_provider_key_configured:
      boolEnv("GEMINI_API_KEY") ||
      boolEnv("OPENAI_API_KEY") ||
      boolEnv("GROQ_API_KEY") ||
      boolEnv("OPENROUTER_API_KEY") ||
      boolEnv("ANTHROPIC_API_KEY") ||
      boolEnv("DEEPSEEK_API_KEY"),
    ddl_capable_supabase_access_configured:
      boolEnv("SUPABASE_ACCESS_TOKEN") ||
      boolEnv("SUPABASE_DB_PASSWORD") ||
      boolEnv("DATABASE_URL") ||
      boolEnv("POSTGRES_URL"),
  },
  migration: {
    required_taxonomy_migration: "20260624143000_expand_assets_asset_type_taxonomy.sql",
    manual_sql_file: manualTaxonomySqlFile,
    manual_sql_file_exists: fs.existsSync(manualTaxonomySqlFile),
    auto_apply_available:
      boolEnv("SUPABASE_ACCESS_TOKEN") ||
      boolEnv("SUPABASE_DB_PASSWORD") ||
      boolEnv("DATABASE_URL") ||
      boolEnv("POSTGRES_URL"),
  },
  database: {
    tables: [],
  },
  render_provider: null,
  worker: null,
  taxonomy: null,
  blockers: [],
};

try {
  if (!supabaseUrl) result.blockers.push("Missing SUPABASE_URL or VITE_SUPABASE_URL.");
  if (!serviceKey) result.blockers.push("Missing SUPABASE_SERVICE_ROLE_KEY.");

  if (supabaseUrl && serviceKey) {
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userRows, error: userError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (userError) throw userError;
    const userId = userRows.users?.[0]?.id;
    if (!userId) result.blockers.push("No Supabase auth user exists for readiness probes.");

    for (const table of EXPECTED_TABLES) {
      const { error, count } = await sb.from(table).select("*", { count: "exact", head: true });
      result.database.tables.push({
        table,
        exists: !error,
        count: error ? null : count,
        error: error ? shortError(error) : null,
      });
      if (error) result.blockers.push(`Missing or unreadable table: ${table}.`);
    }

    const { data: providers, error: providerError } = await sb
      .from("render_providers")
      .select("id, name, provider_type, enabled, is_default, configuration")
      .order("is_default", { ascending: false });
    if (providerError) throw providerError;
    const customWorker = (providers ?? []).find((row) => row.provider_type === "custom_worker") ?? null;
    const defaultProvider = (providers ?? []).find((row) => row.is_default) ?? null;
    const cfg = customWorker?.configuration ?? {};
    result.render_provider = {
      default_provider_type: defaultProvider?.provider_type ?? null,
      custom_worker_present: Boolean(customWorker),
      custom_worker_enabled: Boolean(customWorker?.enabled),
      custom_worker_is_default: Boolean(customWorker?.is_default),
      simulate_worker: Boolean(cfg.simulate_worker),
      worker_url_configured: Boolean(cfg.worker_url || cfg.webhook_url),
      callback_url_configured: Boolean(cfg.callback_url),
      timeout_ms: cfg.timeout_ms ?? null,
    };
    if (!customWorker) result.blockers.push("Custom Worker provider row is missing.");
    if (customWorker && !customWorker.enabled) result.blockers.push("Custom Worker provider is not enabled.");
    if (customWorker && !customWorker.is_default) result.blockers.push("Custom Worker provider is not default.");
    if (customWorker && !cfg.simulate_worker && !cfg.callback_url) {
      result.blockers.push("Custom Worker callback_url is missing while simulate_worker is false.");
    }

    result.worker = await probeWorkerHealth(cfg.worker_url || cfg.webhook_url);

    if (userId) {
      result.taxonomy = await probeAssetTaxonomy(sb, userId);
      if (result.taxonomy.remote_taxonomy_migration_pending) {
        result.blockers.push("Remote assets.asset_type taxonomy migration is pending.");
        if (!result.migration.auto_apply_available) {
          result.operator_actions = [
            "Read docs/pending-supabase-taxonomy-migration.md.",
            `Run ${manualTaxonomySqlFile} in Supabase SQL Editor for project ${result.project_ref}.`,
            "Then rerun npm.cmd run verify:active-goal.",
          ];
        }
      } else if (!result.taxonomy.ok) {
        result.blockers.push("Normalized asset taxonomy probe failed for a non-migration reason.");
      }
    }
  }
} catch (error) {
  result.blockers.push(error instanceof Error ? error.message : String(error));
} finally {
  result.ready = result.blockers.length === 0;
  result.finished_at = new Date().toISOString();
  await writeJson(outPath, result);
}

console.log(JSON.stringify({
  ready: result.ready,
  project_ref: result.project_ref,
  blockers: result.blockers,
  worker_status: result.worker?.status ?? null,
  taxonomy_pending: result.taxonomy?.remote_taxonomy_migration_pending ?? null,
  artifact: outPath,
}, null, 2));

if (!result.ready) process.exit(1);
