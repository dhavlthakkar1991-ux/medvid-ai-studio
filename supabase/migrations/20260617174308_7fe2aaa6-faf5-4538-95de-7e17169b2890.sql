-- Phase 2A-QA: pipeline observability tables

CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pipeline_version text NOT NULL DEFAULT 'v2',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  warnings_count integer NOT NULL DEFAULT 0,
  failures_count integer NOT NULL DEFAULT 0,
  critical_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_runs_project_id_idx ON public.pipeline_runs(project_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_runs TO authenticated;
GRANT ALL ON public.pipeline_runs TO service_role;
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage pipeline_runs for own projects"
  ON public.pipeline_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pipeline_runs.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pipeline_runs.project_id AND p.user_id = auth.uid()));

CREATE TABLE public.task_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  provider text,
  model text,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,
  fallback_stage text,
  validation_passed boolean,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_executions_run_idx ON public.task_executions(pipeline_run_id);
CREATE INDEX task_executions_project_idx ON public.task_executions(project_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_executions TO authenticated;
GRANT ALL ON public.task_executions TO service_role;
ALTER TABLE public.task_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage task_executions for own projects"
  ON public.task_executions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_executions.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_executions.project_id AND p.user_id = auth.uid()));