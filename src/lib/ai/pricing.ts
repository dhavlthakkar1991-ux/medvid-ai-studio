/** Estimated USD per million tokens. Kept conservative; informational only. */
const PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "google/gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "google/gemini-2.5-flash-lite": { input: 0.04, output: 0.15 },
  "openai/gpt-5": { input: 5, output: 15 },
  "openai/gpt-5-mini": { input: 0.5, output: 2 },
  "openai/gpt-5-nano": { input: 0.1, output: 0.4 },
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-opus-4": { input: 15, output: 75 },
  "deepseek/deepseek-chat": { input: 0.27, output: 1.1 },
  // Transcription (per minute, billed via output_tokens field as seconds*100)
  "openai/whisper-1": { input: 0, output: 0.006 / 60 * 1_000_000 },
  "groq/whisper-large-v3-turbo": { input: 0, output: 0.04 / 60 * 1_000_000 / 10 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICING[model] ?? { input: 1, output: 3 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
