ALTER TABLE public.project_context
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS specialty_id text;