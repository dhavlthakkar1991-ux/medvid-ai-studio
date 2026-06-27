import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const BASE_URL = process.env.STUDIO_BASE_URL ?? "http://localhost:8080";
const OWNER_EMAIL = process.env.PHASE2FG_OWNER_EMAIL ?? "dhavlthakkar1991@gmail.com";
const OUT_DIR =
  process.env.PHASE2FG_UI_OUT_DIR ??
  path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1", "ui-smoke");
const READINESS_PATH = path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1", "professional_readiness_summary.json");

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

function projectRefFromUrl(url) {
  return new URL(url).hostname.split(".")[0];
}

async function createBrowserSession() {
  loadEnv(path.resolve(".env"));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase URL, service role key, or anon key for UI smoke session.");
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: OWNER_EMAIL });
  if (link.error || !link.data.properties?.email_otp) {
    throw new Error(`Could not create benchmark owner magic session: ${link.error?.message ?? "missing OTP"}`);
  }
  const verified = await anon.auth.verifyOtp({
    email: OWNER_EMAIL,
    token: link.data.properties.email_otp,
    type: "magiclink",
  });
  if (verified.error || !verified.data.session) {
    throw new Error(`Could not verify benchmark owner session: ${verified.error?.message ?? "missing session"}`);
  }
  return {
    storageKey: `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`,
    session: verified.data.session,
  };
}

function addCheck(result, name, ok, extra = {}) {
  result.checks.push({ name, ok: Boolean(ok), ...extra });
}

function redactUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return String(value).replace(/([?&](?:token|apikey|key|sig|signature|access_token)=)[^&]+/gi, "$1[redacted]");
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const result = {
    project_id: PROJECT_ID,
    base_url: BASE_URL,
    started_at: new Date().toISOString(),
    checks: [],
    console: [],
    page_errors: [],
    request_failures: [],
  };

  const session = await createBrowserSession();
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1050 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (/error|warn|failed|unauthor/i.test(text)) result.console.push({ type: message.type(), text: text.slice(0, 800) });
  });
  page.on("pageerror", (error) => result.page_errors.push({ message: error.message }));
  page.on("requestfailed", (request) => {
    result.request_failures.push({
      method: request.method(),
      url: redactUrl(request.url()),
      failure: request.failure()?.errorText ?? null,
    });
  });

  try {
    const base = BASE_URL.replace(/\/$/, "");
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ storageKey, browserSession }) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem(storageKey, JSON.stringify(browserSession));
      },
      { storageKey: session.storageKey, browserSession: session.session },
    );
    await page.goto(`${base}/projects/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});

    const reviewTab = page.getByRole("tab", { name: /Review Assets/i }).first();
    if (await reviewTab.count()) await reviewTab.click();
    if (!(await page.getByText("Asset To-Do List", { exact: true }).isVisible({ timeout: 2500 }).catch(() => false))) {
      await page.getByText("Review Assets", { exact: true }).first().click();
    }
    await page.getByText("Asset To-Do List", { exact: true }).waitFor({ timeout: 45000 });

    const cards = page.locator("[data-asset-todo-id]");
    const cardCount = await cards.count();
    addCheck(result, "asset_todo_cards_present", cardCount > 0, { count: cardCount });
    const firstCard = cards.first();
    const firstCardText = await firstCard.innerText();
    addCheck(result, "required_items_first", /required/i.test(firstCardText), { first_card_preview: firstCardText.slice(0, 400) });

    const expectedButtons = [
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
    const buttonResults = {};
    for (const label of expectedButtons) {
      buttonResults[label] = await firstCard.getByText(label, { exact: true }).count();
    }
    addCheck(result, "required_row_controls_present", Object.values(buttonResults).every((count) => count > 0), { buttonResults });

    addCheck(result, "upload_replace_file_input_present", (await firstCard.locator('input[type="file"]').count()) > 0);

    await firstCard.getByText("Show prompt", { exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Generate asset for this requirement" }).first();
    await dialog.waitFor({ timeout: 15000 });
    const promptValue = await dialog.locator("textarea").first().inputValue();
    addCheck(result, "prompt_modal_opens", await dialog.isVisible());
    addCheck(result, "prompt_specific_to_requirement", /Required visual:|Asset type:|Visible during/.test(promptValue), {
      prompt_preview: promptValue.slice(0, 500),
    });
    addCheck(result, "dialog_upload_generated_result_present", (await dialog.locator('input[type="file"]').count()) > 0);
    await dialog.getByText("Copy prompt", { exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    addCheck(result, "copy_prompt_copies_text", copied.length > 40 && /Required visual:|Professional medical visual|Create a professional/i.test(copied));
    await dialog.getByRole("button", { name: "Close" }).first().click();

    const rawDebugButton = page.getByText("Show raw/debug list", { exact: true }).first();
    addCheck(result, "raw_debug_toggle_present", (await rawDebugButton.count()) > 0);
    if (await rawDebugButton.count()) await rawDebugButton.click();
    addCheck(result, "raw_debug_list_visible", await page.getByText(/Raw\/debug list|Rejected \/ Debug candidates/i).first().isVisible().catch(() => false));

    const bodyText = await page.locator("body").innerText();
    const biopsyIndiaValid = /Biopsy[\s\S]{0,600}India prevalence map\/stat visual/i.test(bodyText);
    addCheck(result, "biopsy_does_not_show_india_map_as_valid_asset", !biopsyIndiaValid);
    const readiness = JSON.parse(await fs.readFile(READINESS_PATH, "utf8").catch(() => "{}"));
    const mismatchVisible = /approved_asset_mismatch|Approved asset exists but does not satisfy this requirement|non_professional_asset|internal\/template-generated substitute/i.test(bodyText);
    addCheck(result, "mismatch_visible_if_present", Number(readiness.mismatch_count ?? 0) > 0 ? mismatchVisible : !mismatchVisible, {
      expected_mismatch_count: readiness.mismatch_count ?? null,
    });
    if (readiness.professional_ready === true) {
      addCheck(result, "professional_readiness_not_false_green", !/quality score is too low for professional readiness/i.test(bodyText), {
        expected_professional_ready: true,
        required_unresolved: readiness.required_unresolved ?? null,
      });
    } else {
      addCheck(result, "professional_readiness_not_false_green", /non_professional_asset|wrong_asset_mapped|quality score is too low|missing_required/i.test(bodyText), {
        expected_professional_ready: false,
        required_unresolved: readiness.required_unresolved ?? null,
      });
    }

    const screenshot = path.join(OUT_DIR, "phase2fg-ui-smoke.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = screenshot;
    result.finished_at = new Date().toISOString();
    result.ok = result.checks.every((check) => check.ok);
    await fs.writeFile(path.join(OUT_DIR, "phase2fg-ui-smoke.json"), JSON.stringify(result, null, 2), "utf8");
    if (!result.ok) throw new Error(`Phase 2F-G UI smoke failed: ${JSON.stringify(result.checks)}`);
  } catch (error) {
    result.finished_at = new Date().toISOString();
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
    result.current_url = page.url();
    result.body_text_preview = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    await page.screenshot({ path: path.join(OUT_DIR, "phase2fg-ui-smoke-failed.png"), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(OUT_DIR, "phase2fg-ui-smoke.json"), JSON.stringify(result, null, 2), "utf8");
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
