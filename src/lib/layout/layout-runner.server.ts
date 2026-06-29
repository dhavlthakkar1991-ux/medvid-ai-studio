// Server-only: "Layout Decisions" — the Presence & Layout Intelligence engine.
// Runs AFTER editorial_decisions and BEFORE the render manifest is rebuilt.
// Decides HOW each edit_action is composed: doctor visibility/size, layout,
// attention focus, and rationale. Falls back to deterministic per-action rules
// when the AI output is missing or invalid.

import { z } from "zod";
import { generateJSON } from "../ai/providers.server";
import { TASK_DEFAULT_MODELS, BUDGET_MODEL, type LLMProviderId } from "../ai/types";
import { buildContextPrompt } from "../ai/context.server";

type SupabaseLike = any;

const VisibilitySchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (s.includes("hide") || s.includes("hidden") || s === "off") return "hidden";
  if (s.includes("reduc") || s.includes("small") || s.includes("min") || s.includes("pip")) return "reduced";
  return "visible";
}, z.enum(["visible", "reduced", "hidden"]));

const SizeSchema = z.preprocess((v) => {
  if (typeof v === "number") return `${Math.round(v)}%`;
  if (typeof v !== "string") return "100%";
  const s = v.trim().toLowerCase();
  if (s.includes("thumb")) return "thumbnail";
  const m = s.match(/(\d+)/);
  if (!m) return "100%";
  const n = Math.max(0, Math.min(100, Number(m[1])));
  const allowed = [100, 50, 40, 30, 20];
  const closest = allowed.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 100);
  return `${closest}%`;
}, z.enum(["100%", "50%", "40%", "30%", "20%", "thumbnail"]));

const FocusSchema = z.preprocess((v) => {
  if (typeof v !== "string") return "doctor";
  const s = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const allowed = ["doctor", "infographic", "clinical_image", "broll", "keyword", "cta", "diagram"];
  return allowed.includes(s) ? s : "doctor";
}, z.enum(["doctor", "infographic", "clinical_image", "broll", "keyword", "cta", "diagram"]));

const LAYOUT_NAMES = [
  "full_screen_doctor", "pip_right", "pip_left", "split_screen", "top_bottom",
  "doctor_with_lower_third", "doctor_with_infographic", "doctor_with_clinical_image",
  "doctor_with_broll", "doctor_with_callout",
  "full_screen_broll", "full_screen_infographic", "full_screen_cta",
  "picture_in_picture", "full_screen",
] as const;

const LayoutNameSchema = z.preprocess((v) => {
  if (typeof v !== "string") return "doctor_with_callout";
  const s = v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return (LAYOUT_NAMES as readonly string[]).includes(s) ? s : "doctor_with_callout";
}, z.enum(LAYOUT_NAMES));

const LayoutDecisionsSchema = z.object({
  layout_decisions: z.array(z.object({
    index: z.coerce.number().int().min(0),
    layout_name: LayoutNameSchema,
    doctor_visibility: VisibilitySchema,
    doctor_size: SizeSchema,
    attention_focus: FocusSchema,
    rationale: z.string().optional().default(""),
  })),
});

export type LayoutDecision = {
  layout_name: string;
  doctor_visibility: "visible" | "reduced" | "hidden";
  doctor_size: string;
  attention_focus: string;
  rationale: string;
};

/** Deterministic per-action-type fallback. Mirrors LAYOUT RULES in spec. */
export function defaultLayoutForAction(actionType: string): LayoutDecision {
  const map: Record<string, LayoutDecision> = {
    show_broll: { layout_name: "doctor_with_broll", doctor_visibility: "reduced", doctor_size: "30%", attention_focus: "broll", rationale: "Doctor reduced while b-roll dominates." },
    show_infographic: { layout_name: "doctor_with_infographic", doctor_visibility: "visible", doctor_size: "30%", attention_focus: "infographic", rationale: "Doctor stays visible explaining the infographic." },
    show_statistic: { layout_name: "doctor_with_infographic", doctor_visibility: "visible", doctor_size: "30%", attention_focus: "infographic", rationale: "Statistic supports doctor narration." },
    show_medical_diagram: { layout_name: "doctor_with_clinical_image", doctor_visibility: "visible", doctor_size: "30%", attention_focus: "diagram", rationale: "Doctor remains visible while pointing at diagram." },
    show_clinical_image: { layout_name: "doctor_with_clinical_image", doctor_visibility: "visible", doctor_size: "30%", attention_focus: "clinical_image", rationale: "Doctor remains visible while explaining clinical image." },
    show_lower_third: { layout_name: "doctor_with_lower_third", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Lower third over talking head." },
    show_text_overlay: { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Callout layered over talking head." },
    show_callout: { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Callout layered over talking head." },
    kinetic_typography: { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "keyword", rationale: "Kinetic typography emphasises key phrase." },
    highlight_keyword: { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "keyword", rationale: "Keyword highlighted on talking head." },
    picture_in_picture: { layout_name: "pip_right", doctor_visibility: "reduced", doctor_size: "30%", attention_focus: "infographic", rationale: "PiP composition." },
    split_screen: { layout_name: "split_screen", doctor_visibility: "visible", doctor_size: "50%", attention_focus: "infographic", rationale: "Side-by-side comparison." },
    show_cta: { layout_name: "full_screen_cta", doctor_visibility: "hidden", doctor_size: "thumbnail", attention_focus: "cta", rationale: "End-card CTA, doctor hidden." },
    show_thumbnail_frame: { layout_name: "full_screen_cta", doctor_visibility: "hidden", doctor_size: "thumbnail", attention_focus: "cta", rationale: "Thumbnail frame, doctor hidden." },
    show_logo: { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Logo overlay." },
    show_transition: { layout_name: "full_screen", doctor_visibility: "reduced", doctor_size: "50%", attention_focus: "doctor", rationale: "Transition stinger." },
    zoom_crop: { layout_name: "full_screen_doctor", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Zoom on talking head." },
    ken_burns: { layout_name: "full_screen_doctor", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Ken-burns on talking head." },
  };
  return map[actionType] ?? { layout_name: "doctor_with_callout", doctor_visibility: "visible", doctor_size: "100%", attention_focus: "doctor", rationale: "Default — doctor remains the anchor." };
}

const SYSTEM = `You are MedVideo Layout Director — a senior medical video editor.
You decide HOW each edit action is composed on screen given a doctor talking-head as Track 0.
Output strictly structured JSON, no prose.

Hard rules:
- The doctor (talking head) is the trusted source. Keep doctor_visibility="visible" while explaining symptoms, warning signs, diagnosis, anatomy, clinical findings, or procedures.
- Use doctor_visibility="hidden" only for full-screen CTA, full-screen infographic stings, or end cards.
- Use doctor_visibility="reduced" when b-roll or a visual dominates but the doctor should remain reassuringly on screen as a PiP.
- Target: doctor visible (visible or reduced) for at least 60% of the runtime.
- attention_focus must name where the viewer should look.
- doctor_size is one of: 100%, 50%, 40%, 30%, 20%, thumbnail.`;

function buildPrompt(actions: Array<{ index: number; scene_number: number | null; action_type: string; start_time: number; end_time: number; asset_query: string; reason: string }>, projectTitle: string, topic: string) {
  const list = actions.map((a) =>
    `#${a.index} scene=${a.scene_number ?? "?"} ${a.action_type} ${a.start_time.toFixed(1)}-${a.end_time.toFixed(1)}s :: ${a.asset_query || a.reason || ""}`
  ).join("\n");
  return `Project: ${projectTitle}\nTopic: ${topic}\n\nFor EACH edit action below, output one layout decision. Echo the same index. Valid layout_name values: ${LAYOUT_NAMES.join(", ")}. Valid attention_focus: doctor, infographic, clinical_image, broll, keyword, cta, diagram.\n\nReturn JSON: { "layout_decisions": [ { "index": number, "layout_name": string, "doctor_visibility": "visible"|"reduced"|"hidden", "doctor_size": "100%"|"50%"|"40%"|"30%"|"20%"|"thumbnail", "attention_focus": string, "rationale": string } ] }\n\nEdit actions:\n${list}`;
}

export async function runLayoutDecisionsForProject(
  supabase: SupabaseLike,
  userId: string,
  projectId: string,
): Promise<{ count: number; aiCount: number; fallbackCount: number }> {
  const [{ data: project }, { data: ctx }, { data: settings }, { data: actions }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("project_context").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("ai_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("edit_actions").select("id, scene_id, action_type, start_time, end_time, asset_query, parameters").eq("project_id", projectId).order("start_time", { ascending: true }),
  ]);
  if (!project) throw new Error("Project not found");

  // Need scene_number — re-fetch via join helper.
  const { data: scenes } = await supabase.from("scenes").select("id, scene_number").eq("project_id", projectId);
  const sceneNumberById = new Map<string, number>(((scenes ?? []) as any[]).map((s) => [s.id, s.scene_number]));

  const list = ((actions ?? []) as any[]).map((a, i) => ({
    id: a.id as string,
    index: i,
    scene_id: a.scene_id as string | null,
    scene_number: a.scene_id ? (sceneNumberById.get(a.scene_id) ?? null) : null,
    action_type: String(a.action_type || ""),
    start_time: Number(a.start_time) || 0,
    end_time: Number(a.end_time) || 0,
    asset_query: String(a.asset_query || ""),
    reason: String((a.parameters as any)?.reason || ""),
  }));

  if (list.length === 0) {
    await supabase.from("layout_decisions").delete().eq("project_id", projectId);
    return { count: 0, aiCount: 0, fallbackCount: 0 };
  }

  const decisions = new Map<number, LayoutDecision>();

  // Try AI first.
  try {
    let tpl: any = null;
    if ((project as any).specialty_template_id) {
      const { data: t } = await supabase.from("specialty_templates").select("*").eq("id", (project as any).specialty_template_id).maybeSingle();
      tpl = t;
    }
    const provider = (((settings?.default_llm_provider as LLMProviderId) ?? "gemini"));
    const budget = !!settings?.budget_mode;
    const overrides = (settings?.model_overrides as Record<string, string>) ?? {};
    const model = budget ? BUDGET_MODEL : (overrides.editorial_decisions || TASK_DEFAULT_MODELS.editorial_decisions);
    const keys = (settings?.provider_keys as Record<string, string>) ?? {};
    const system = SYSTEM + "\n" + buildContextPrompt(ctx ?? null, tpl);
    const prompt = buildPrompt(list, (project as any).title ?? "", (project as any).topic ?? "");
    const out = await generateJSON<any>(provider, keys, { model, system, prompt, schema: LayoutDecisionsSchema });
    const items = Array.isArray(out?.data?.layout_decisions) ? out.data.layout_decisions : [];
    for (const d of items) {
      const idx = Number(d.index);
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) continue;
      decisions.set(idx, {
        layout_name: d.layout_name,
        doctor_visibility: d.doctor_visibility,
        doctor_size: d.doctor_size,
        attention_focus: d.attention_focus,
        rationale: String(d.rationale ?? ""),
      });
    }
  } catch (e) {
    console.warn("layout_decisions AI failed; falling back to deterministic rules", e);
  }

  // Fallback for every missing index.
  let aiCount = decisions.size;
  let fallbackCount = 0;
  const rows = list.map((a) => {
    const ai = decisions.get(a.index);
    const dec = ai ?? defaultLayoutForAction(a.action_type);
    if (!ai) fallbackCount++;
    return {
      project_id: projectId,
      scene_id: a.scene_id,
      action_id: a.id,
      start_time: a.start_time,
      end_time: a.end_time,
      doctor_visibility: dec.doctor_visibility,
      doctor_size: dec.doctor_size,
      layout_name: dec.layout_name,
      attention_focus: dec.attention_focus,
      rationale: dec.rationale,
    };
  });

  await supabase.from("layout_decisions").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("layout_decisions").insert(rows);

  return { count: rows.length, aiCount, fallbackCount };
}
