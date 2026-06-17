
-- assets
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('broll','image','infographic','thumbnail','overlay','animation','logo','video')),
  source_type text NOT NULL CHECK (source_type IN ('pexels','pixabay','upload','generated','library','manual')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','rejected','rendered')),
  title text,
  description text,
  url text,
  thumbnail_url text,
  duration_seconds numeric,
  width integer,
  height integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage assets for own projects" ON public.assets FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = assets.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = assets.project_id AND p.user_id = auth.uid()));
CREATE INDEX assets_project_idx ON public.assets(project_id);
CREATE INDEX assets_scene_idx ON public.assets(scene_id);
CREATE INDEX assets_status_idx ON public.assets(status);
CREATE TRIGGER assets_set_updated_at BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- asset_candidates
CREATE TABLE public.asset_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE CASCADE,
  storyboard_item_id uuid REFERENCES public.storyboard_items(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  search_query text NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  provider text NOT NULL DEFAULT 'any',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','searched','approved','rejected')),
  candidate_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_candidates TO authenticated;
GRANT ALL ON public.asset_candidates TO service_role;
ALTER TABLE public.asset_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage asset_candidates for own projects" ON public.asset_candidates FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = asset_candidates.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = asset_candidates.project_id AND p.user_id = auth.uid()));
CREATE INDEX asset_candidates_project_idx ON public.asset_candidates(project_id);
CREATE INDEX asset_candidates_scene_idx ON public.asset_candidates(scene_id);

-- scene_assets
CREATE TABLE public.scene_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  render_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, asset_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene_assets TO authenticated;
GRANT ALL ON public.scene_assets TO service_role;
ALTER TABLE public.scene_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage scene_assets for own projects" ON public.scene_assets FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON p.id = s.project_id WHERE s.id = scene_assets.scene_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON p.id = s.project_id WHERE s.id = scene_assets.scene_id AND p.user_id = auth.uid()));
CREATE INDEX scene_assets_scene_idx ON public.scene_assets(scene_id);
CREATE INDEX scene_assets_asset_idx ON public.scene_assets(asset_id);

-- timeline_instructions
CREATE TABLE public.timeline_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  storyboard_item_id uuid REFERENCES public.storyboard_items(id) ON DELETE SET NULL,
  timeline_start numeric NOT NULL DEFAULT 0,
  timeline_end numeric NOT NULL DEFAULT 0,
  duration numeric NOT NULL DEFAULT 0,
  layer integer NOT NULL DEFAULT 0,
  transition text NOT NULL DEFAULT 'cut',
  caption_enabled boolean NOT NULL DEFAULT true,
  render_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeline_instructions TO authenticated;
GRANT ALL ON public.timeline_instructions TO service_role;
ALTER TABLE public.timeline_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage timeline_instructions for own projects" ON public.timeline_instructions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_instructions.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_instructions.project_id AND p.user_id = auth.uid()));
CREATE INDEX timeline_instructions_project_idx ON public.timeline_instructions(project_id);
CREATE INDEX timeline_instructions_scene_idx ON public.timeline_instructions(scene_id);
CREATE INDEX timeline_instructions_render_order_idx ON public.timeline_instructions(project_id, render_order);
