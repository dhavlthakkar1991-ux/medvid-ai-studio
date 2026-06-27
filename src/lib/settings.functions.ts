import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SettingsInput = z.object({
  default_llm_provider: z.string(),
  default_transcription_provider: z.string(),
  model_overrides: z.record(z.string(), z.string()),
  provider_keys: z.record(z.string(), z.string()),
  budget_mode: z.boolean(),
});

function getDefaultLLMProvider() {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.LOVABLE_API_KEY) return "lovable";
  return "gemini";
}

function getDefaultTranscriptionProvider() {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.LOVABLE_API_KEY) return "lovable";
  return "gemini";
}

export const getAISettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const ins = await context.supabase
        .from("ai_settings")
        .insert({
          user_id: context.userId,
          default_llm_provider: getDefaultLLMProvider(),
          default_transcription_provider: getDefaultTranscriptionProvider(),
        })
        .select()
        .single();
      if (ins.error) throw new Error(ins.error.message);
      return ins.data;
    }
    return data;
  });

export const updateAISettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SettingsInput.parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("ai_settings")
      .upsert({ user_id: context.userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getUsageTotals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("usage_logs")
      .select("provider, model, task, input_tokens, output_tokens, estimated_cost, project_id")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const totalCost = (data ?? []).reduce((s, r) => s + Number(r.estimated_cost), 0);
    const totalTokens = (data ?? []).reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);
    return { totalCost, totalTokens, rows: data ?? [] };
  });
