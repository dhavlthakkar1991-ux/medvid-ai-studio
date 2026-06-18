
-- 1) render_providers
CREATE TABLE public.render_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('mock','creatomate','shotstack','custom_worker')),
  enabled boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.render_providers TO authenticated;
GRANT ALL ON public.render_providers TO service_role;
ALTER TABLE public.render_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers readable by authenticated"
  ON public.render_providers FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_render_providers_updated
  BEFORE UPDATE ON public.render_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) render_provider_jobs
CREATE TABLE public.render_provider_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id uuid NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.render_providers(id),
  provider_job_id text,
  status text NOT NULL DEFAULT 'queued',
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_render_provider_jobs_job ON public.render_provider_jobs(render_job_id);
CREATE INDEX idx_render_provider_jobs_provider_job ON public.render_provider_jobs(provider_job_id);
GRANT SELECT, INSERT, UPDATE ON public.render_provider_jobs TO authenticated;
GRANT ALL ON public.render_provider_jobs TO service_role;
ALTER TABLE public.render_provider_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own provider jobs"
  ON public.render_provider_jobs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.render_jobs rj JOIN public.projects p ON p.id = rj.project_id
                 WHERE rj.id = render_provider_jobs.render_job_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.render_jobs rj JOIN public.projects p ON p.id = rj.project_id
                      WHERE rj.id = render_provider_jobs.render_job_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_render_provider_jobs_updated
  BEFORE UPDATE ON public.render_provider_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) extend render_jobs with provider linkage
ALTER TABLE public.render_jobs
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.render_providers(id),
  ADD COLUMN IF NOT EXISTS provider_job_id text,
  ADD COLUMN IF NOT EXISTS render_spec jsonb;

-- 4) seed the mock provider (enabled + default)
INSERT INTO public.render_providers (name, provider_type, enabled, is_default, configuration)
VALUES ('Mock Renderer', 'mock', true, true, '{"description":"Simulated renderer for testing without external APIs."}'::jsonb);

-- placeholder rows for future providers (disabled)
INSERT INTO public.render_providers (name, provider_type, enabled, is_default, configuration) VALUES
  ('Creatomate', 'creatomate', false, false, '{"api_key_secret":"CREATOMATE_API_KEY"}'::jsonb),
  ('Shotstack', 'shotstack', false, false, '{"api_key_secret":"SHOTSTACK_API_KEY"}'::jsonb),
  ('Custom Worker', 'custom_worker', false, false, '{"webhook_url":"","secret_name":"CUSTOM_WORKER_SECRET"}'::jsonb);
