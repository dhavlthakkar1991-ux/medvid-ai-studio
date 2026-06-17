// Pure validators for every pipeline task. Each returns { valid, warnings, errors }.
// Safe to import on the client or server.

export type ValidationResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
};

const ok = (warnings: string[] = []): ValidationResult => ({ valid: true, warnings, errors: [] });
const fail = (errors: string[], warnings: string[] = []): ValidationResult => ({ valid: false, warnings, errors });

const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);

export function validateChapters(data: any): ValidationResult {
  const items = arr(data?.chapters);
  if (items.length < 2) return fail(["chapters: fewer than 2 chapters"]);
  const errs: string[] = [];
  items.forEach((c, i) => {
    if (!isStr(c?.title)) errs.push(`chapter[${i}].title missing`);
    if (!isStr(c?.start)) errs.push(`chapter[${i}].start missing`);
    if (!isStr(c?.end)) errs.push(`chapter[${i}].end missing`);
  });
  return errs.length ? fail(errs) : ok();
}

export function validateScenePlan(data: any): ValidationResult {
  const items = arr(data?.scene_plan);
  if (items.length === 0) return fail(["scene_plan: empty"]);
  const errs: string[] = [];
  const warns: string[] = [];
  items.forEach((s, i) => {
    const hasTitle = isStr(s?.title);
    const hasObjective = isStr(s?.objective) || isStr(s?.prompt);
    const hasNarration = isStr(s?.narration_text) || isStr(s?.prompt);
    if (!hasTitle) errs.push(`scene[${i}].title missing`);
    if (!hasObjective) errs.push(`scene[${i}].objective missing`);
    if (!hasNarration) warns.push(`scene[${i}].narration_text missing`);
    if (!isStr(s?.t) && !isNum(s?.start_seconds)) errs.push(`scene[${i}].time missing`);
  });
  return errs.length ? fail(errs, warns) : ok(warns);
}

export function validateVisualStoryboard(data: any, opts?: { transcriptDuration?: number }): ValidationResult {
  const items = arr(data?.visual_storyboard);
  if (items.length === 0) return fail(["visual_storyboard: empty"]);
  const errs: string[] = [];
  const warns: string[] = [];
  let total = 0;
  items.forEach((it, i) => {
    if (!isStr(it?.asset_prompt)) errs.push(`storyboard[${i}].asset_prompt missing`);
    if (!isStr(it?.visual_type)) errs.push(`storyboard[${i}].visual_type missing`);
    if (!isStr(it?.time)) errs.push(`storyboard[${i}].time missing`);
    const dur = Number(it?.duration_seconds);
    if (!Number.isFinite(dur) || dur <= 0) errs.push(`storyboard[${i}].duration missing`);
    else total += dur;
  });
  const td = opts?.transcriptDuration ?? 0;
  if (td > 0 && total > 0) {
    const delta = Math.abs(total - td) / td;
    if (delta > 0.2) warns.push(`storyboard total duration ${total}s differs from transcript ${td}s by ${Math.round(delta * 100)}%`);
  }
  return errs.length ? fail(errs, warns) : ok(warns);
}

export function validateBroll(data: any): ValidationResult {
  const items = arr(data?.broll);
  if (items.length < 5) return fail([`broll: only ${items.length} items (need >= 5)`]);
  const errs: string[] = [];
  items.forEach((b, i) => {
    if (!isStr(b?.keyword)) errs.push(`broll[${i}].keyword empty`);
    if (!isStr(b?.search_prompt) && !isStr(b?.asset_prompt)) errs.push(`broll[${i}].search_prompt empty`);
    if (!isStr(b?.placement_reason)) errs.push(`broll[${i}].placement_reason empty`);
    if (!isStr(b?.recommended_start) && !isStr(b?.t)) errs.push(`broll[${i}].recommended_start empty`);
    if (!isStr(b?.recommended_end)) errs.push(`broll[${i}].recommended_end empty`);
  });
  return errs.length ? fail(errs) : ok();
}

export function validateInfographics(data: any): ValidationResult {
  const items = arr(data?.infographics);
  if (items.length === 0) return fail(["infographics: empty"]);
  const errs: string[] = [];
  items.forEach((it, i) => {
    if (!isStr(it?.title)) errs.push(`infographic[${i}].title missing`);
    if (!isStr(it?.asset_prompt)) errs.push(`infographic[${i}].asset_prompt missing`);
    if (!Array.isArray(it?.bullets) || it.bullets.length < 2) errs.push(`infographic[${i}].bullets too few`);
  });
  return errs.length ? fail(errs) : ok();
}

export function validateThumbnails(data: any): ValidationResult {
  const items = arr(data?.thumbnails);
  if (items.length === 0) return fail(["thumbnails: empty"]);
  const errs: string[] = [];
  items.forEach((t, i) => {
    if (!isStr(t?.concept)) errs.push(`thumbnail[${i}].concept missing`);
    if (!isStr(t?.asset_prompt)) errs.push(`thumbnail[${i}].asset_prompt missing`);
  });
  return errs.length ? fail(errs) : ok();
}

export function validateSeo(data: any): ValidationResult {
  const s = data?.seo;
  if (!s) return fail(["seo: missing"]);
  const errs: string[] = [];
  if (!Array.isArray(s.titles) || s.titles.length === 0) errs.push("seo.titles empty");
  if (!isStr(s.description)) errs.push("seo.description empty");
  if (!Array.isArray(s.tags) || s.tags.length < 5) errs.push("seo.tags too few");
  return errs.length ? fail(errs) : ok();
}

export function validateShorts(data: any): ValidationResult {
  const items = arr(data?.shorts);
  if (items.length === 0) return fail(["shorts: empty"]);
  const errs: string[] = [];
  items.forEach((sh, i) => {
    if (!isStr(sh?.start) || !isStr(sh?.end)) errs.push(`short[${i}] start/end missing`);
    if (!isStr(sh?.hook)) errs.push(`short[${i}].hook missing`);
  });
  return errs.length ? fail(errs) : ok();
}

export function validateEditorialDecisions(data: any, opts?: { sceneCount?: number }): ValidationResult {
  const items = arr(data?.edit_actions);
  if (items.length === 0) return fail(["edit_actions: empty"]);
  const errs: string[] = [];
  const warns: string[] = [];
  const coveredScenes = new Set<number>();
  items.forEach((a, i) => {
    if (!isStr(a?.action_type)) errs.push(`action[${i}].action_type missing`);
    if (!isNum(a?.start_time)) errs.push(`action[${i}].start_time missing`);
    if (!isNum(a?.end_time)) errs.push(`action[${i}].end_time missing`);
    if (a?.scene_number == null) errs.push(`action[${i}].scene_id missing`);
    else coveredScenes.add(Number(a.scene_number));
    if (a?.layer == null) errs.push(`action[${i}].layer missing`);
  });
  const sc = opts?.sceneCount ?? 0;
  if (sc > 0) {
    for (let i = 1; i <= sc; i++) {
      if (!coveredScenes.has(i)) warns.push(`scene ${i} has no editorial action`);
    }
  }
  return errs.length ? fail(errs, warns) : ok(warns);
}

export function validateRenderManifest(rows: any[]): ValidationResult {
  if (!Array.isArray(rows) || rows.length === 0) return fail(["render_manifest: empty"]);
  const errs: string[] = [];
  rows.forEach((r, i) => {
    if (!Number.isFinite(Number(r?.timeline_start))) errs.push(`manifest[${i}].timeline_start missing`);
    if (!Number.isFinite(Number(r?.timeline_end))) errs.push(`manifest[${i}].timeline_end missing`);
  });
  return errs.length ? fail(errs) : ok();
}

export type TaskValidatorKey =
  | "chapters"
  | "scene_plan"
  | "visual_storyboard"
  | "broll"
  | "infographics"
  | "thumbnails"
  | "seo"
  | "shorts"
  | "editorial_decisions";

export function validateTaskOutput(
  task: TaskValidatorKey,
  data: any,
  ctx?: { transcriptDuration?: number; sceneCount?: number },
): ValidationResult {
  switch (task) {
    case "chapters": return validateChapters(data);
    case "scene_plan": return validateScenePlan(data);
    case "visual_storyboard": return validateVisualStoryboard(data, ctx);
    case "broll": return validateBroll(data);
    case "infographics": return validateInfographics(data);
    case "thumbnails": return validateThumbnails(data);
    case "seo": return validateSeo(data);
    case "shorts": return validateShorts(data);
    case "editorial_decisions": return validateEditorialDecisions(data, ctx);
  }
}

// Critical tasks: a project cannot be marked completed if these stay invalid.
export const CRITICAL_TASKS: TaskValidatorKey[] = [
  "scene_plan",
  "visual_storyboard",
  "broll",
  "editorial_decisions",
];