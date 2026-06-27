import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("data", "review-artifacts", "self-hosting");
const OUT_FILE = path.join(OUT_DIR, "self-hosting-audit.json");
const SELF_FILE = path.join("scripts", "verify-self-hosting.mjs");
const EXPECTED_PROJECT_REF = process.env.EXPECTED_SUPABASE_PROJECT_REF ?? "asscnuntwtnyukwvcxbr";
const RETIRED_PROJECT_REFS = new Set(["yfsmwrwhfleksgrflgkv"]);

function loadEnv(file) {
  if (!fsSync.existsSync(file)) return {};
  const env = {};
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function projectRefFromUrl(value) {
  try {
    return new URL(value).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function read(file) {
  return fs.readFile(file, "utf8");
}

async function listFiles(root, allowedExtensions) {
  const out = [];
  async function walk(current) {
    if (!fsSync.existsSync(current)) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "data") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (allowedExtensions.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

function addCheck(result, name, ok, details = {}) {
  const check = { name, ok: Boolean(ok), ...details };
  result.checks.push(check);
  if (!check.ok) result.failures.push(check);
  return check;
}

function addWarning(result, name, details = {}) {
  result.warnings.push({ name, ...details });
}

function indexOrder(text, terms) {
  return terms.map((term) => ({ term, index: text.indexOf(term) }));
}

function orderedBefore(text, firstTerms, laterTerm) {
  const later = text.indexOf(laterTerm);
  return later >= 0 && firstTerms.every((term) => {
    const index = text.indexOf(term);
    return index >= 0 && index < later;
  });
}

function compactMatches(files, pattern) {
  const matches = [];
  for (const [file, text] of files.entries()) {
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line)) {
        matches.push({
          file,
          line: index + 1,
          preview: line.trim().slice(0, 240),
        });
      }
    }
  }
  return matches;
}

async function main() {
  const env = { ...loadEnv(".env"), ...process.env };
  const result = {
    generated_at: new Date().toISOString(),
    expected_project_ref: EXPECTED_PROJECT_REF,
    checks: [],
    warnings: [],
    failures: [],
  };

  const packageJson = JSON.parse(await read("package.json"));
  const envExample = await read(".env.example");
  const settingsFunctions = await read(path.join("src", "lib", "settings.functions.ts"));
  const providersServer = await read(path.join("src", "lib", "ai", "providers.server.ts"));
  const jobRunnerToken = await read(path.join("src", "lib", "job-runner-token.server.ts"));
  const renderProviders = await read(path.join("src", "lib", "render-providers.functions.ts"));
  const customWorkerProvider = await read(path.join("src", "lib", "render", "providers", "custom-worker-provider.server.ts"));
  const renderProviderSettings = await read(path.join("src", "routes", "_authenticated", "settings.render-providers.tsx"));

  const sourceFiles = new Map();
  const files = [
    ...(await listFiles("src", new Set([".ts", ".tsx"]))),
    ...(await listFiles("scripts", new Set([".mjs"]))),
    ...(await listFiles("supabase", new Set([".sql", ".toml"]))),
    ".env.example",
  ].filter((file) => file !== SELF_FILE);
  for (const file of files) {
    sourceFiles.set(file, await read(file));
  }

  const supabaseRef = projectRefFromUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "");
  result.supabase = {
    configured: Boolean(supabaseRef),
    project_ref: supabaseRef,
    retired_project_ref_detected: RETIRED_PROJECT_REFS.has(String(supabaseRef)),
  };
  addCheck(result, "active_supabase_project_ref", supabaseRef === EXPECTED_PROJECT_REF, {
    project_ref: supabaseRef,
  });
  addCheck(result, "retired_lovable_project_not_active", !RETIRED_PROJECT_REFS.has(String(supabaseRef)), {
    retired_refs: Array.from(RETIRED_PROJECT_REFS),
  });

  const requiredEnvKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "JOB_RUNNER_SECRET",
    "CUSTOM_WORKER_SECRET",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "PEXELS_API_KEY",
  ];
  const missingEnvExample = requiredEnvKeys.filter((key) => !envExample.includes(`${key}=`));
  addCheck(result, "env_example_documents_self_hosting_keys", missingEnvExample.length === 0, {
    missing: missingEnvExample,
  });

  addCheck(result, "job_runner_uses_only_job_runner_secret", jobRunnerToken.includes("JOB_RUNNER_SECRET") && !jobRunnerToken.includes("LOVABLE_API_KEY"), {
    file: "src/lib/job-runner-token.server.ts",
  });

  addCheck(result, "llm_resolver_prefers_self_hosted_before_lovable", orderedBefore(
    providersServer,
    ['"gemini"', '"openai"', '"groq"', '"openrouter"'],
    'requested === "lovable"',
  ), {
    order: indexOrder(providersServer, ['"gemini"', '"openai"', '"groq"', '"openrouter"', 'requested === "lovable"']),
  });

  addCheck(result, "settings_default_llm_prefers_self_hosted_before_lovable", orderedBefore(
    settingsFunctions,
    ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"],
    "LOVABLE_API_KEY",
  ), {
    order: indexOrder(settingsFunctions, ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "LOVABLE_API_KEY"]),
  });

  addCheck(result, "settings_default_transcription_prefers_self_hosted_before_lovable", orderedBefore(
    settingsFunctions,
    ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"],
    "LOVABLE_API_KEY",
  ), {
    order: indexOrder(settingsFunctions, ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "LOVABLE_API_KEY"]),
  });

  const cloudOnlyMatches = compactMatches(
    new Map([...sourceFiles].filter(([file]) => !file.includes(`${path.sep}docs${path.sep}`))),
    /Connect Supabase in Lovable Cloud|Lovable Cloud secrets|Contact support/i,
  );
  addCheck(result, "no_cloud_only_setup_or_support_copy", cloudOnlyMatches.length === 0, {
    matches: cloudOnlyMatches,
  });

  const sourceLocalhostMatches = compactMatches(
    new Map([...sourceFiles].filter(([file]) => file.startsWith("src"))),
    /https?:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?)/i,
  );
  addCheck(result, "no_hardcoded_localhost_in_app_source", sourceLocalhostMatches.length === 0, {
    matches: sourceLocalhostMatches,
  });

  addCheck(result, "custom_worker_requires_callback_url_for_real_dispatch", customWorkerProvider.includes("Set callback_url in provider configuration."), {
    file: "src/lib/render/providers/custom-worker-provider.server.ts",
  });
  addCheck(result, "render_provider_settings_require_https_public_urls", renderProviders.includes("must use HTTPS outside local development") && renderProviderSettings.includes("Use HTTPS outside local development"), {
    files: [
      "src/lib/render-providers.functions.ts",
      "src/routes/_authenticated/settings.render-providers.tsx",
    ],
  });

  const lovableIntegrationImports = compactMatches(sourceFiles, /createLovableAuth|@lovable\.dev\/cloud-auth-js|integrations\/lovable/i);
  const usedOutsideIntegration = lovableIntegrationImports.filter((match) => !match.file.includes(`${path.sep}integrations${path.sep}lovable${path.sep}`));
  if (lovableIntegrationImports.length > 0) {
    addWarning(result, "legacy_lovable_auth_integration_present", {
      blocking: usedOutsideIntegration.length > 0,
      matches: lovableIntegrationImports,
    });
  }
  addCheck(result, "legacy_lovable_auth_not_used_by_app_routes", usedOutsideIntegration.length === 0, {
    matches: usedOutsideIntegration,
  });

  addCheck(result, "verify_self_hosting_script_registered", packageJson.scripts?.["verify:self-hosting"] === "node scripts/verify-self-hosting.mjs", {
    script: packageJson.scripts?.["verify:self-hosting"] ?? null,
  });

  result.ready = result.failures.length === 0;
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({
    ready: result.ready,
    failures: result.failures.map((failure) => failure.name),
    warnings: result.warnings.map((warning) => warning.name),
    artifact: OUT_FILE,
  }, null, 2));
  if (!result.ready) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
