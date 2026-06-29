import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.STUDIO_BASE_URL ?? "http://localhost:8080";
const EMAIL = process.env.STUDIO_SMOKE_EMAIL;
const PASSWORD = process.env.STUDIO_SMOKE_PASSWORD;
const PROJECT_ID = process.env.STUDIO_SMOKE_PROJECT_ID;
const OUT_DIR =
  process.env.STUDIO_SMOKE_OUT_DIR ??
  path.join("data", "review-artifacts", PROJECT_ID ?? "scene-review-smoke", "browser-smoke");

function loadEnv(file) {
  if (!fsSync.existsSync(file)) return;
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ??= value;
  }
}

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing ${name}. Set it before running npm run smoke:scene-review.`);
}

function redactUrl(value) {
  if (typeof value !== "string" || !value) return value ?? null;
  try {
    const url = new URL(value);
    for (const key of ["token", "token_hash", "access_token", "refresh_token", "apikey", "signature"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&](?:token|token_hash|access_token|refresh_token|apikey|signature)=)[^&]+/gi, "$1[redacted]");
  }
}

function redactText(value) {
  if (typeof value !== "string" || !value) return value ?? "";
  return value
    .replace(/([?&](?:token|token_hash|access_token|refresh_token|apikey|signature)=)[^"'&\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted.jwt]");
}

function isIgnorableConsoleNoise(text) {
  return /TypeError: Failed to fetch[\s\S]+serverFnFetcher/i.test(text);
}

function addCheck(result, name, ok, extra = {}) {
  result.checks.push({ name, ok: Boolean(ok), ...extra });
}

async function safeBodyText(page, { retries = 3, delayMs = 1000, timeout = 5000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {});
      return await page.locator("body").innerText({ timeout });
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Target page|closed|navigation/i.test(String(error?.message ?? error))) {
        throw error;
      }
      await page.waitForTimeout(delayMs).catch(() => {});
    }
  }
  return lastError ? "" : "";
}

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = String(email).split("@");
  return `${local.slice(0, 2)}***@${domain ?? "***"}`;
}

function projectUrl(baseUrl, projectId) {
  return `${baseUrl.replace(/\/$/, "")}/projects/${projectId}`;
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function signInDirectly(email, password) {
  loadEnv(path.resolve(".env"));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Missing public Supabase env for direct smoke login fallback.");
  const sb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Direct email/password auth failed: ${error?.message ?? "missing session"}`);
  return {
    storageKey: `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`,
    session: data.session,
    userId: data.user?.id ?? null,
  };
}

async function signInWithAdminMagicLink(projectId, requestedEmail) {
  loadEnv(path.resolve(".env"));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase service/public env for admin magic-link smoke login.");
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  let email = requestedEmail;
  let ownerUserId = null;

  if (!email) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();
    if (projectError) throw projectError;
    ownerUserId = project?.user_id ?? null;
    const { data: users, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (userError) throw userError;
    const owner = users.users.find((user) => user.id === ownerUserId);
    email = owner?.email ?? null;
  }

  if (!email) throw new Error("Could not resolve smoke login email from STUDIO_SMOKE_EMAIL or project owner.");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;
  const actionLink = link?.properties?.action_link;
  const tokenHash =
    link?.properties?.hashed_token ||
    (actionLink ? new URL(actionLink).searchParams.get("token_hash") : null);
  const linkType = (actionLink ? new URL(actionLink).searchParams.get("type") : null) || "magiclink";
  if (!tokenHash) throw new Error("Admin magic-link generation did not return a token hash.");

  const attemptedTypes = Array.from(new Set([linkType, "magiclink", "email"]));
  const attempts = [];
  for (const type of attemptedTypes) {
    const { data, error } = await anon.auth.verifyOtp({ token_hash: tokenHash, type });
    attempts.push({ type, ok: Boolean(data?.session), error: error?.message ?? null });
    if (data?.session) {
      return {
        storageKey: `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`,
        session: data.session,
        userId: data.user?.id ?? null,
        ownerUserId,
        maskedEmail: maskEmail(email),
        attempts,
      };
    }
  }

  throw new Error(`Admin magic-link smoke auth failed: ${JSON.stringify(attempts)}`);
}

async function main() {
  loadEnv(path.resolve(".env"));
  const baseUrl = process.env.STUDIO_BASE_URL ?? BASE_URL;
  const projectId = process.env.STUDIO_SMOKE_PROJECT_ID ?? PROJECT_ID;
  const email = process.env.STUDIO_SMOKE_EMAIL ?? EMAIL;
  const password = process.env.STUDIO_SMOKE_PASSWORD ?? PASSWORD;
  const authMode = process.env.STUDIO_SMOKE_AUTH_MODE ?? (password ? "password" : "admin_magiclink");
  const outDir =
    process.env.STUDIO_SMOKE_OUT_DIR ??
    path.join("data", "review-artifacts", projectId ?? "scene-review-smoke", "browser-smoke");

  requireEnv("STUDIO_SMOKE_PROJECT_ID", projectId);
  if (authMode === "password") {
    requireEnv("STUDIO_SMOKE_EMAIL", email);
    requireEnv("STUDIO_SMOKE_PASSWORD", password);
  }

  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const result = {
    base_url: baseUrl,
    project_id: projectId,
    project_url: projectUrl(baseUrl, projectId),
    auth_mode: authMode,
    started_at: new Date().toISOString(),
    checks: [],
    console: [],
    ignored_console: [],
    page_errors: [],
    request_failures: [],
    interesting_responses: [],
  };

  page.on("console", (message) => {
    const text = message.text();
    if (/error|warn|unauthor|failed|supabase|server/i.test(text)) {
      const entry = { type: message.type(), text: redactText(text).slice(0, 1000) };
      if (isIgnorableConsoleNoise(text)) {
        result.ignored_console.push({ ...entry, reason: "server_function_fetch_aborted_during_smoke_navigation_or_teardown" });
      } else {
        result.console.push(entry);
      }
    }
  });
  page.on("pageerror", (error) => {
    result.page_errors.push({ message: error.message, stack: error.stack?.slice(0, 1500) ?? null });
  });
  page.on("requestfailed", (request) => {
    result.request_failures.push({
      method: request.method(),
      url: redactUrl(request.url()),
      failure: request.failure()?.errorText ?? null,
    });
  });
  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 400 || /_server|functions|projects|assets|supabase/i.test(url)) {
      const entry = {
        status,
        method: response.request().method(),
        url: redactUrl(url),
      };
      if (/_serverFn/.test(url) && result.interesting_responses.length < 80) {
        const text = await response.text().catch(() => "");
        entry.body_preview = redactText(text).slice(0, 1200);
      }
      result.interesting_responses.push(entry);
    }
  });

  try {
    if (authMode === "admin_magiclink") {
      const direct = await signInWithAdminMagicLink(projectId, email);
      await page.addInitScript(
        ({ storageKey, session }) => {
          window.localStorage.setItem(storageKey, JSON.stringify(session));
        },
        { storageKey: direct.storageKey, session: direct.session },
      );
      addCheck(result, "admin_magiclink_login_injected", true, {
        user_id: direct.userId,
        owner_user_id: direct.ownerUserId,
        email: direct.maskedEmail,
        attempts: direct.attempts,
      });
    } else {
      await page.goto(`${baseUrl.replace(/\/$/, "")}/auth`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const emailInput = page.locator('input[type="email"]:visible').first();
      const passwordInput = page.locator('input[type="password"]:visible').first();
      if (await emailInput.count()) await emailInput.fill(email);
      else await page.getByLabel("Email").first().fill(email);
      if (await passwordInput.count()) await passwordInput.fill(password);
      else await page.getByLabel("Password").first().fill(password);
      await page.locator("button", { hasText: /^Sign in$/ }).last().click();
      await page.waitForURL(/\/dashboard|\/projects|\/auth/, { timeout: 20000 }).catch(() => {});
      addCheck(result, "email_password_login_submitted", true, { url: redactUrl(page.url()) });
      if (/\/auth/.test(page.url())) {
        const direct = await signInDirectly(email, password);
        await page.addInitScript(
          ({ storageKey, session }) => {
            window.localStorage.setItem(storageKey, JSON.stringify(session));
          },
          { storageKey: direct.storageKey, session: direct.session },
        );
        addCheck(result, "email_password_login_direct_fallback", true, { user_id: direct.userId });
      }
    }

    await page.goto(projectUrl(baseUrl, projectId), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    addCheck(result, "project_page_loaded", /\/projects\//.test(page.url()), { url: redactUrl(page.url()) });
    result.local_storage_keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("sb-")));

    const reviewTab = page.getByRole("tab", { name: /Review Assets/i }).first();
    if (await reviewTab.count()) {
      await reviewTab.click();
    } else {
      await page.getByText("Review Assets", { exact: true }).first().click().catch(async () => {
        await page.getByText(/Review Workspace|Scene Asset Review/i).first().click({ trial: true }).catch(() => {});
      });
    }
    await page.getByText("Asset To-Do List", { exact: true }).first().waitFor({ timeout: 45000 });
    const sceneReviewVisible =
      (await page.getByText("Scene Asset Review", { exact: true }).first().isVisible().catch(() => false)) ||
      (await page.getByText("Review Assets", { exact: true }).first().isVisible().catch(() => false)) ||
      (await page.getByText("Asset To-Do List", { exact: true }).first().isVisible().catch(() => false));
    const sceneGroups = page.locator("[data-scene-asset-group]");
    const sceneGroupCount = await sceneGroups.count();
    addCheck(result, "scene_asset_review_visible", sceneReviewVisible);
    addCheck(result, "scene_groups_present", sceneGroupCount > 0, { count: sceneGroupCount });

    const todoCards = page.locator("[data-asset-todo-id]");
    const todoCount = await todoCards.count();
    addCheck(result, "asset_todo_list_visible", true);
    addCheck(result, "asset_todo_cards_present", todoCount > 0, { count: todoCount });
    const firstCard = todoCards.first();
    const firstCardText = todoCount > 0 ? await firstCard.innerText() : "";
    addCheck(result, "required_items_first", /required/i.test(firstCardText), {
      first_card_preview: redactText(firstCardText).slice(0, 400),
    });

    const expectedControls = [
      "Search providers",
      "Generate with AI",
      "Show prompt",
      "Copy prompt",
      "Upload / Replace",
      "Paste URL",
      "Use existing approved asset",
      "Fix timing",
      "Preview at timestamp",
    ];
    const controlCounts = {};
    for (const label of expectedControls) {
      controlCounts[label] = await firstCard.getByText(label, { exact: true }).count();
    }
    addCheck(result, "required_row_controls_present", Object.values(controlCounts).every((count) => count > 0), {
      controlCounts,
    });
    addCheck(result, "upload_replace_file_input_present", (await firstCard.locator('input[type="file"]').count()) > 0);

    await firstCard.getByText("Show prompt", { exact: true }).click();
    const promptDialog = page.getByRole("dialog").filter({ hasText: "Generate asset for this requirement" }).first();
    await promptDialog.waitFor({ timeout: 15000 });
    const promptValue = await promptDialog.locator("textarea").first().inputValue();
    const promptHasGenerationIntent = /Required visual:|Professional medical visual|Create a professional/i.test(promptValue);
    const promptHasSpecificAsset = /Medical visual asset|Asset type:|presenter_video|clinical_image|infographic|contextual_broll|lower_third|cta_branding/i.test(promptValue);
    const promptHasLayoutOrFormat = /Visible during|Layout target:|Format:|full_screen|split_screen|pip_left|pip_right/i.test(promptValue);
    addCheck(result, "prompt_modal_opens", await promptDialog.isVisible());
    addCheck(result, "prompt_specific_to_requirement", promptHasGenerationIntent && promptHasSpecificAsset && promptHasLayoutOrFormat, {
      prompt_preview: redactText(promptValue).slice(0, 500),
    });
    addCheck(result, "dialog_upload_generated_result_present", (await promptDialog.locator('input[type="file"]').count()) > 0);
    await promptDialog.getByText("Copy prompt", { exact: true }).click();
    const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    addCheck(result, "copy_prompt_copies_text", copiedPrompt.length > 40 && /Professional medical visual|Create a professional|Required visual:/i.test(copiedPrompt));
    await promptDialog.getByRole("button", { name: "Close" }).first().click();

    const rawDebugButton = page.getByText("Show raw/debug list", { exact: true }).first();
    addCheck(result, "raw_debug_toggle_present", (await rawDebugButton.count()) > 0);
    if (await rawDebugButton.count()) await rawDebugButton.click();
    const rawDebugVisible = await page.getByText(/Raw\/debug list|Rejected \/ Debug candidates/i).first().isVisible().catch(() => false);
    addCheck(result, "raw_debug_section_present", rawDebugVisible);

    const bodyText = await safeBodyText(page);
    const biopsyIndiaValid = /Biopsy[\s\S]{0,600}India prevalence map\/stat visual/i.test(bodyText);
    addCheck(result, "biopsy_does_not_show_india_map_as_valid_asset", !biopsyIndiaValid);
    const readinessPath = path.join("data", "review-artifacts", projectId, "phase-2fg-g1", "professional_readiness_summary.json");
    const readiness = JSON.parse(await fs.readFile(readinessPath, "utf8").catch(() => "{}"));
    const visibleBlocker = /approved_asset_mismatch|wrong_asset_mapped|non_professional_asset|internal\/template-generated substitute|Mismatch\s+[1-9]|Timing\s+[1-9]/i.test(bodyText);
    addCheck(
      result,
      "professional_readiness_not_false_green",
      readiness.professional_ready === false ? visibleBlocker : !visibleBlocker,
      {
        expected_professional_ready: readiness.professional_ready ?? null,
        mismatch_count: readiness.mismatch_count ?? null,
        timing_problem_count: readiness.timing_problem_count ?? null,
      },
    );

    const screenshot = path.join(outDir, "scene-review-smoke.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = screenshot;
    result.finished_at = new Date().toISOString();
    result.ok = result.checks.every((check) => check.ok);
    await fs.writeFile(path.join(outDir, "scene-review-smoke.json"), JSON.stringify(result, null, 2));
    if (!result.ok) throw new Error(`Scene review smoke failed: ${JSON.stringify(result.checks)}`);
  } catch (error) {
    result.finished_at = new Date().toISOString();
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
    result.current_url = redactUrl(page.url());
    result.body_text_preview = redactText(await safeBodyText(page, { retries: 2, delayMs: 500, timeout: 2000 }).catch(() => ""));
    await page.screenshot({ path: path.join(outDir, "scene-review-smoke-failed.png"), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(outDir, "scene-review-smoke.json"), JSON.stringify(result, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
