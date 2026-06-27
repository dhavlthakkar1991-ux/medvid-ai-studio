-- Prefer self-hosted provider defaults for new installs.
-- Lovable remains supported when explicitly selected and configured.

ALTER TABLE public.ai_settings
  ALTER COLUMN default_llm_provider SET DEFAULT 'gemini',
  ALTER COLUMN default_transcription_provider SET DEFAULT 'gemini';
