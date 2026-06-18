
-- Extend render_jobs
ALTER TABLE public.render_jobs
  ADD COLUMN IF NOT EXISTS render_type text NOT NULL DEFAULT 'preview',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manifest_version integer,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id);

-- render_outputs
CREATE TABLE IF NOT EXISTS public.render_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id uuid NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  output_type text NOT NULL DEFAULT 'preview',
  file_url text,
  thumbnail_url text,
  duration_seconds numeric,
  resolution text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_outputs TO authenticated;
GRANT ALL ON public.render_outputs TO service_role;

ALTER TABLE public.render_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their render outputs"
ON public.render_outputs FOR ALL
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = render_outputs.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = render_outputs.project_id AND p.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_render_outputs_project ON public.render_outputs(project_id);
CREATE INDEX IF NOT EXISTS idx_render_outputs_job ON public.render_outputs(render_job_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_project ON public.render_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON public.render_jobs(status);
