import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, generateText } from "ai";
import { z, type ZodSchema } from "zod";
import type { LLMProviderId, TranscriptionProviderId, Usage } from "./types";

type LLMOpts = { model: string; system: string; prompt: string; schema: ZodSchema };
type LLMResult<T> = { data: T; usage: Usage; provider: string; model: string };

function getProviderConfig(provider: LLMProviderId, userKeys: Record<string, string>): {
  baseURL: string;
  apiKey?: string;
  headers: Record<string, string>;
  name: string;
} {
  switch (provider) {
    case "lovable":
      return {
        baseURL: "https://ai.gateway.lovable.dev/v1",
        headers: {
          "Lovable-API-Key": process.env.LOVABLE_API_KEY ?? "",
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        } as Record<string, string>,
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
  if (provider === "lovable" && !cfg.headers["Lovable-API-Key"]) {
    throw new Error("Lovable AI is not configured. Contact support.");
  }

  const gateway = createOpenAICompatible({
    name: cfg.name,
    baseURL: cfg.baseURL,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    headers: cfg.headers,
  });
  const modelId = normalizeModel(provider, opts.model);

  try {
    if (provider === "gemini") {
      const result = await generateText({
        model: gateway(modelId),
        system: opts.system + "\n\nRespond with ONLY valid minified JSON matching the requested schema. No markdown, no commentary.",
        prompt: opts.prompt,
        maxOutputTokens: 8192,
      });
      const parsed = extractJson(result.text);
      const data = opts.schema.parse(coerceToSchemaShape(parsed, opts.schema)) as T;
      const usage: Usage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      };
      return { data, usage, provider: cfg.name, model: opts.model };
    }
    const result = await generateObject({
      model: gateway(modelId),
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: 8192,
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

function extractJson(response: string): unknown {
  let cleaned = response.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const startIdx = cleaned.search(/[\{\[]/);
  if (startIdx === -1) throw new Error("No JSON found in response");
  const opener = cleaned[startIdx];
  const closer = opener === "[" ? "]" : "}";
  const endIdx = cleaned.lastIndexOf(closer);
  if (endIdx === -1) throw new Error("Unterminated JSON in response");
  cleaned = cleaned.substring(startIdx, endIdx + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    cleaned = cleaned
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(cleaned);
  }
}

function coerceToSchemaShape(parsed: unknown, schema: ZodSchema): unknown {
  // Schemas are { someKey: Array<...> }. If the model returned just the array, wrap it.
  const def: any = (schema as any)._def;
  const shape = getObjectShape(schema);
  if (shape && typeof shape === "object") {
    const keys = Object.keys(shape);
    if (Array.isArray(parsed) && keys.length === 1) {
      return { [keys[0]]: parsed };
    }
    // Unwrap single-element array containing the expected object
    if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "object") {
      parsed = parsed[0];
    }
    // If the schema has a single key and the model returned the inner shape directly,
    // wrap it under that key.
    if (
      keys.length === 1 &&
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      !(keys[0] in (parsed as Record<string, unknown>))
    ) {
      parsed = { [keys[0]]: parsed };
    }
    // Fill in missing required fields with safe defaults so Zod doesn't reject
    // partial JSON from providers that omit empty sections.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return fillMissingSchemaDefaults(parsed, schema);
    }
  }
  return parsed;
}

function getObjectShape(schema: any): Record<string, any> | null {
  const def = schema?._def;
  const shape = def?.shape?.() ?? def?.shape;
  if (shape && typeof shape === "object") return shape;
  return null;
}

function getSchemaTypeName(schema: any): string | undefined {
  const def = schema?._def;
  return def?.typeName ?? def?.innerType?._def?.typeName ?? def?.schema?._def?.typeName;
}

function getArrayElementSchema(schema: any): any | null {
  const def = schema?._def;
  if (getSchemaTypeName(schema) !== "ZodArray") return null;
  return def?.type ?? def?.element ?? null;
}

function defaultForSchema(schema: any): unknown {
  const typeName = getSchemaTypeName(schema);
  if (typeName === "ZodArray") return [];
  if (typeName === "ZodObject") return {};
  if (typeName === "ZodString") return "";
  if (typeName === "ZodNumber" || typeName === "ZodNaN") return 0;
  if (typeName === "ZodBoolean") return false;
  return undefined;
}

function fillMissingSchemaDefaults(value: unknown, schema: any): unknown {
  const shape = getObjectShape(schema);
  if (!shape || !value || typeof value !== "object" || Array.isArray(value)) return value;

  const obj = value as Record<string, unknown>;
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (obj[key] === undefined) obj[key] = defaultForSchema(fieldSchema);

    // Coerce object → [object] when schema expects an array.
    if (getSchemaTypeName(fieldSchema) === "ZodArray" && obj[key] && !Array.isArray(obj[key])) {
      obj[key] = typeof obj[key] === "object" ? [obj[key]] : [];
    }

    const nestedShape = getObjectShape(fieldSchema);
    if (nestedShape && obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      fillMissingSchemaDefaults(obj[key], fieldSchema);
    }

    const elementSchema = getArrayElementSchema(fieldSchema);
    if (elementSchema && Array.isArray(obj[key])) {
      for (const item of obj[key]) fillMissingSchemaDefaults(item, elementSchema);
    }
  }

  return obj;
}

/* ============ Transcription ============ */

export type TranscriptResult = {
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  language: string | null;
  provider: string;
  durationSeconds: number;
};

type WhisperTranscriptionProviderId = Extract<TranscriptionProviderId, "openai" | "groq">;

function getTranscriptionEndpoint(provider: WhisperTranscriptionProviderId, userKeys: Record<string, string>) {
  if (provider === "openai") return { url: "https://api.openai.com/v1/audio/transcriptions", apiKey: userKeys.openai ?? "", model: "whisper-1" };
  return { url: "https://api.groq.com/openai/v1/audio/transcriptions", apiKey: userKeys.groq ?? "", model: "whisper-large-v3-turbo" };
}

function getMediaMimeType(audio: Blob, filename: string) {
  if (audio.type) return audio.type;
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

async function transcribeWithGemini(apiKey: string, audio: Blob, filename: string): Promise<TranscriptResult> {
  if (!apiKey) throw new Error('No API key configured for transcription provider "gemini". Add it in Settings → AI.');
  const mimeType = getMediaMimeType(audio, filename);
  const bytes = await audio.arrayBuffer();
  const uploadStart = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({ file: { display_name: filename } }),
  });
  if (!uploadStart.ok) throw new Error(`Transcription failed (gemini upload): ${uploadStart.status} ${(await uploadStart.text()).slice(0, 200)}`);
  const uploadUrl = uploadStart.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Transcription failed (gemini): upload URL missing.");

  const uploadFinish = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!uploadFinish.ok) throw new Error(`Transcription failed (gemini file): ${uploadFinish.status} ${(await uploadFinish.text()).slice(0, 200)}`);
  const uploaded = await uploadFinish.json();
  let file = uploaded.file ?? uploaded;
  if (!file?.uri) throw new Error("Transcription failed (gemini): uploaded file URI missing.");

  for (let attempt = 0; file.state && file.state !== "ACTIVE" && attempt < 30; attempt++) {
    if (file.state === "FAILED") throw new Error("Transcription failed (gemini): uploaded file processing failed.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`);
    if (!statusRes.ok) throw new Error(`Transcription failed (gemini status): ${statusRes.status} ${(await statusRes.text()).slice(0, 200)}`);
    const statusJson = await statusRes.json();
    file = statusJson.file ?? statusJson;
  }
  if (file.state && file.state !== "ACTIVE") throw new Error("Transcription failed (gemini): uploaded file was not ready in time.");

  const abort = new AbortController();
  const timeoutId = setTimeout(() => abort.abort(), 120000);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    signal: abort.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "Transcribe the spoken words in this media file. Return only the verbatim transcript text, with no summary or commentary." },
          { file_data: { mime_type: file.mimeType ?? mimeType, file_uri: file.uri } },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  }).finally(() => clearTimeout(timeoutId));
  if (!res.ok) throw new Error(`Transcription failed (gemini): ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = (json.candidates ?? [])
    .flatMap((c: any) => c.content?.parts ?? [])
    .map((p: any) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) throw new Error("Transcription failed (gemini): empty transcript returned.");
  return { text, words: [], language: null, provider: "gemini", durationSeconds: 0 };
}

async function transcribeWithLovable(audio: Blob, filename: string): Promise<TranscriptResult> {
  const apiKey = process.env.LOVABLE_API_KEY ?? "";
  if (!apiKey) throw new Error("Lovable AI is not configured. Contact support.");
  const mediaType = getMediaMimeType(audio, filename);
  const gateway = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
  const result = await generateText({
    model: gateway("google/gemini-2.5-flash"),
    temperature: 0,
    maxOutputTokens: 8192,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Transcribe the spoken words in this media file. Return only the verbatim transcript text, with no summary or commentary." },
        { type: "file", data: new Uint8Array(await audio.arrayBuffer()), mediaType, filename },
      ],
    }],
  });
  const text = result.text.trim();
  if (!text) throw new Error("Transcription failed (Lovable AI): empty transcript returned.");
  return { text, words: [], language: null, provider: "lovable", durationSeconds: 0 };
}

export async function transcribeAudio(
  provider: TranscriptionProviderId,
  userKeys: Record<string, string>,
  audio: Blob,
  filename: string,
): Promise<TranscriptResult> {
  if (provider === "lovable") return transcribeWithLovable(audio, filename);
  if (provider === "gemini") return transcribeWithGemini(userKeys.gemini ?? "", audio, filename);
  if (provider === "assemblyai" || provider === "deepgram") {
    throw new Error(`Transcription provider "${provider}" is not yet implemented in Phase 1.`);
  }
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
