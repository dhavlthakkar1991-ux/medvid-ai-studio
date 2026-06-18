
CREATE TABLE IF NOT EXISTS public.timeline_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('presenter_video','broll','clinical_images','medical_diagrams','infographics','text_overlays','captions','cta')),
  track_index integer NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  locked boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind),
  UNIQUE (project_id, track_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeline_tracks TO authenticated;
GRANT ALL ON public.timeline_tracks TO service_role;
ALTER TABLE public.timeline_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage timeline_tracks for own projects"
  ON public.timeline_tracks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_tracks.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_tracks.project_id AND p.user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS timeline_tracks_project_idx ON public.timeline_tracks(project_id);
CREATE TRIGGER timeline_tracks_set_updated_at BEFORE UPDATE ON public.timeline_tracks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.timeline_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.timeline_tracks(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  edit_action_id uuid REFERENCES public.edit_actions(id) ON DELETE SET NULL,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  asset_type text NOT NULL DEFAULT '',
  title text,
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  duration numeric NOT NULL DEFAULT 0,
  layout text,
  z_index integer NOT NULL DEFAULT 0,
  transition_in text NOT NULL DEFAULT 'cut',
  transition_out text NOT NULL DEFAULT 'cut',
  source_task text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','locked','missing_asset')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeline_items TO authenticated;
GRANT ALL ON public.timeline_items TO service_role;
ALTER TABLE public.timeline_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage timeline_items for own projects"
  ON public.timeline_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_items.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = timeline_items.project_id AND p.user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS timeline_items_project_idx ON public.timeline_items(project_id);
CREATE INDEX IF NOT EXISTS timeline_items_track_idx ON public.timeline_items(track_id);
CREATE INDEX IF NOT EXISTS timeline_items_time_idx ON public.timeline_items(project_id, start_time);
CREATE INDEX IF NOT EXISTS timeline_items_edit_action_idx ON public.timeline_items(edit_action_id);
CREATE TRIGGER timeline_items_set_updated_at BEFORE UPDATE ON public.timeline_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
