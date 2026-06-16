
-- ============ Helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  specialty TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.ai_settings(user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

-- ============ ai_settings ============
CREATE TABLE public.ai_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_llm_provider TEXT NOT NULL DEFAULT 'lovable',
  default_transcription_provider TEXT NOT NULL DEFAULT 'lovable',
  model_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_keys JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_settings" ON public.ai_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_ai_settings_updated BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- on auth user created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ specialty_templates ============
CREATE TABLE public.specialty_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  template_name TEXT NOT NULL,
  default_audience TEXT,
  default_brand_voice TEXT,
  default_visual_style TEXT,
  default_scene_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_infographic_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_broll_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_thumbnail_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.specialty_templates TO authenticated;
GRANT ALL ON public.specialty_templates TO service_role;
ALTER TABLE public.specialty_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read builtin or own templates" ON public.specialty_templates
  FOR SELECT USING (is_builtin = true OR owner_user_id = auth.uid());
CREATE POLICY "insert own templates" ON public.specialty_templates
  FOR INSERT WITH CHECK (owner_user_id = auth.uid() AND is_builtin = false);
CREATE POLICY "update own templates" ON public.specialty_templates
  FOR UPDATE USING (owner_user_id = auth.uid() AND is_builtin = false);
CREATE POLICY "delete own templates" ON public.specialty_templates
  FOR DELETE USING (owner_user_id = auth.uid() AND is_builtin = false);

-- ============ projects ============
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  video_path TEXT,
  duration_seconds NUMERIC,
  specialty_template_id UUID REFERENCES public.specialty_templates(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects" ON public.projects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_projects_user ON public.projects(user_id);

-- ============ project_context ============
CREATE TABLE public.project_context (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  audience TEXT,
  specialty TEXT,
  brand_voice TEXT,
  target_platform TEXT,
  content_type TEXT,
  visual_style TEXT,
  scene_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  infographic_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  broll_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  thumbnail_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  render_intent TEXT,
  visual_density TEXT,
  retention_priority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_context TO authenticated;
GRANT ALL ON public.project_context TO service_role;
ALTER TABLE public.project_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own project_context" ON public.project_context FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_project_context_updated BEFORE UPDATE ON public.project_context FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ transcripts ============
CREATE TABLE public.transcripts (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  full_text TEXT NOT NULL DEFAULT '',
  words JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT,
  provider_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT ALL ON public.transcripts TO service_role;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transcripts" ON public.transcripts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_transcripts_updated BEFORE UPDATE ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ analysis_versions ============
CREATE TABLE public.analysis_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  provider TEXT,
  model TEXT,
  models_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_versions TO authenticated;
GRANT ALL ON public.analysis_versions TO service_role;
ALTER TABLE public.analysis_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analysis_versions" ON public.analysis_versions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE INDEX idx_analysis_versions_project_task ON public.analysis_versions(project_id, task, version DESC);

-- ============ usage_logs ============
CREATE TABLE public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.usage_logs TO authenticated;
GRANT ALL ON public.usage_logs TO service_role;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own usage_logs read" ON public.usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own usage_logs insert" ON public.usage_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_usage_logs_user_project ON public.usage_logs(user_id, project_id, created_at DESC);

-- ============ jobs ============
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON public.jobs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_jobs_project ON public.jobs(project_id, created_at DESC);

-- ============ render_profiles (Phase 2) ============
CREATE TABLE public.render_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  intro_video TEXT,
  outro_video TEXT,
  watermark TEXT,
  logo TEXT,
  subtitle_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_profiles TO authenticated;
GRANT ALL ON public.render_profiles TO service_role;
ALTER TABLE public.render_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own render_profiles" ON public.render_profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_render_profiles_updated BEFORE UPDATE ON public.render_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ render_jobs (Phase 2) ============
CREATE TABLE public.render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  output_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_jobs TO authenticated;
GRANT ALL ON public.render_jobs TO service_role;
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own render_jobs" ON public.render_jobs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_render_jobs_updated BEFORE UPDATE ON public.render_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Storage policies for 'videos' bucket ============
CREATE POLICY "own videos read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own videos insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own videos update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own videos delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);
