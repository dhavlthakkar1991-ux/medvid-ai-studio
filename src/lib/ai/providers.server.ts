import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z, type ZodSchema } from "zod";
import type { LLMProviderId, TranscriptionProviderId, Usage } from "./types";

type LLMOpts = { model: string; system: string; prompt: string; schema: ZodSchema };
type LLMResult<T> = { data: T; usage: Usage; provider: string; model: string };

function getProviderConfig(provider: LLMProviderId, userKeys: Record<string, string>): {
  baseURL: string;
  apiKey: string;
  headers: Record<string, string>;
  name: string;
} {
  switch (provider) {
    case "lovable":
      return {
        baseURL: "https://ai.gateway.lovable.dev/v1",
        apiKey: process.env.LOVABLE_API_KEY ?? "",
        headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY ?? "" } as Record<string, string>,
        name: "lovable",
      };
    case "openai":
      return { baseURL: "https://api.openai.com/v1", apiKey: userKeys.openai ?? "", headers: {}, name: "openai" };
    case "gemini":
      return { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: userKeys.gemini ?? "", headers: {}, name: "gemini" };
    case "openrouter":
      return { baseURL: "https://openrouter.ai/api/v1", apiKey: userKeys.openrouter ?? "", headers: {}, name: "openrouter" };
    case "groq":
      return { baseURL: "https://api.groq.com/openai/v1", apiKey: userKeys.groq ?? "", headers: {}, name: "groq" };
    case "deepseek":
      return { baseURL: "https://api.deepseek.com/v1", apiKey: userKeys.deepseek ?? "", headers: {}, name: "deepseek" };
    case "anthropic":
      return { baseURL: "https://api.anthropic.com/v1", apiKey: userKeys.anthropic ?? "", headers: {}, name: "anthropic" };
  }
}

function normalizeModel(provider: LLMProviderId, model: string) {
  // openai-compatible providers expect bare model ids
  if (provider === "lovable" || provider === "openrouter") return model;
  // Strip "provider/" prefix when calling that provider directly
  return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}

export async function generateJSON<T>(
  provider: LLMProviderId,
  userKeys: Record<string, string>,
  opts: LLMOpts,
): Promise<LLMResult<T>> {
  const cfg = getProviderConfig(provider, userKeys);
  if (!cfg.apiKey && provider !== "lovable") {
    throw new Error(`No API key configured for provider "${provider}". Add it in Settings → AI.`);
  }
  if (provider === "lovable" && !cfg.apiKey) {
    throw new Error("Lovable AI is not configured. Contact support.");
  }

  const gateway = createOpenAICompatible({
    name: cfg.name,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    headers: cfg.headers,
  });
  const modelId = normalizeModel(provider, opts.model);

  try {
    const result = await generateObject({
      model: gateway(modelId),
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
    });
    const usage: Usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    };
    return { data: result.object as T, usage, provider: cfg.name, model: opts.model };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("429")) throw new Error("AI rate limit reached. Please retry in a moment.");
    if (msg.includes("402")) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`AI call failed (${provider}/${opts.model}): ${msg}`);
  }
}

/* ============ Transcription ============ */

export type TranscriptResult = {
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  language: string | null;
  provider: string;
  durationSeconds: number;
};

function getTranscriptionEndpoint(provider: TranscriptionProviderId, userKeys: Record<string, string>) {
  switch (provider) {
    case "openai":
      return { url: "https://api.openai.com/v1/audio/transcriptions", apiKey: userKeys.openai ?? "", model: "whisper-1" };
    case "groq":
      return { url: "https://api.groq.com/openai/v1/audio/transcriptions", apiKey: userKeys.groq ?? "", model: "whisper-large-v3-turbo" };
    case "assemblyai":
    case "deepgram":
      throw new Error(`Transcription provider "${provider}" is not yet implemented in Phase 1.`);
  }
}

export async function transcribeAudio(
  provider: TranscriptionProviderId,
  userKeys: Record<string, string>,
  audio: Blob,
  filename: string,
): Promise<TranscriptResult> {
  const ep = getTranscriptionEndpoint(provider, userKeys);
  if (!ep.apiKey) {
    throw new Error(`No API key configured for transcription provider "${provider}". Add it in Settings → AI.`);
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", ep.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await fetch(ep.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ep.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Transcription failed (${provider}): ${res.status} ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const words = Array.isArray(json.words)
    ? json.words.map((w: any) => ({ word: w.word, start: Number(w.start), end: Number(w.end) }))
    : [];
  return {
    text: String(json.text ?? ""),
    words,
    language: json.language ?? null,
    provider,
    durationSeconds: Number(json.duration ?? 0),
  };
}
