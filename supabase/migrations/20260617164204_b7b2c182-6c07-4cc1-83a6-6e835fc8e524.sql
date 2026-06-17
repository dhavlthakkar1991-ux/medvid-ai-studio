
-- Phase 1.5 canonical relational layer

-- 1) scenes
CREATE TABLE public.scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_number integer NOT NULL,
  title text NOT NULL DEFAULT '',
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  duration numeric NOT NULL DEFAULT 0,
  narration_text text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, scene_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenes TO authenticated;
GRANT ALL ON public.scenes TO service_role;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scenes owner all" ON public.scenes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id AND p.user_id = auth.uid()));
CREATE INDEX scenes_project_idx ON public.scenes(project_id);
CREATE TRIGGER set_scenes_updated_at BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) transcript_segments
CREATE TABLE public.transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  duration numeric NOT NULL DEFAULT 0,
  text text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_segments TO authenticated;
GRANT ALL ON public.transcript_segments TO service_role;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transcript_segments owner all" ON public.transcript_segments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = transcript_segments.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = transcript_segments.project_id AND p.user_id = auth.uid()));
CREATE INDEX transcript_segments_project_idx ON public.transcript_segments(project_id);
CREATE INDEX transcript_segments_time_idx ON public.transcript_segments(project_id, start_time);

-- 3) scene_transcript_map
CREATE TABLE public.scene_transcript_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  transcript_segment_id uuid NOT NULL REFERENCES public.transcript_segments(id) ON DELETE CASCADE,
  UNIQUE(scene_id, transcript_segment_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene_transcript_map TO authenticated;
GRANT ALL ON public.scene_transcript_map TO service_role;
ALTER TABLE public.scene_transcript_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scene_transcript_map owner all" ON public.scene_transcript_map FOR ALL
  USING (EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON p.id = s.project_id WHERE s.id = scene_transcript_map.scene_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON p.id = s.project_id WHERE s.id = scene_transcript_map.scene_id AND p.user_id = auth.uid()));
CREATE INDEX scene_transcript_map_scene_idx ON public.scene_transcript_map(scene_id);
CREATE INDEX scene_transcript_map_segment_idx ON public.scene_transcript_map(transcript_segment_id);

-- 4) storyboard_items
CREATE TABLE public.storyboard_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  item_index integer NOT NULL DEFAULT 0,
  visual_type text NOT NULL DEFAULT '',
  asset_prompt text NOT NULL DEFAULT '',
  animation text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'medium',
  screen_layout text NOT NULL DEFAULT 'Full',
  duration_seconds numeric NOT NULL DEFAULT 0,
  timeline_start numeric NOT NULL DEFAULT 0,
  timeline_end numeric NOT NULL DEFAULT 0,
  asset_status text NOT NULL DEFAULT 'pending',
  asset_url text,
  render_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storyboard_items TO authenticated;
GRANT ALL ON public.storyboard_items TO service_role;
ALTER TABLE public.storyboard_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "storyboard_items owner all" ON public.storyboard_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = storyboard_items.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = storyboard_items.project_id AND p.user_id = auth.uid()));
CREATE INDEX storyboard_items_project_idx ON public.storyboard_items(project_id);
CREATE INDEX storyboard_items_scene_idx ON public.storyboard_items(scene_id);
CREATE INDEX storyboard_items_status_idx ON public.storyboard_items(asset_status);

-- 5) broll_items
CREATE TABLE public.broll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  item_index integer NOT NULL DEFAULT 0,
  keyword text NOT NULL DEFAULT '',
  search_prompt text NOT NULL DEFAULT '',
  placement_reason text NOT NULL DEFAULT '',
  recommended_start numeric NOT NULL DEFAULT 0,
  recommended_end numeric NOT NULL DEFAULT 0,
  asset_status text NOT NULL DEFAULT 'pending',
  asset_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broll_items TO authenticated;
GRANT ALL ON public.broll_items TO service_role;
ALTER TABLE public.broll_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broll_items owner all" ON public.broll_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = broll_items.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = broll_items.project_id AND p.user_id = auth.uid()));
CREATE INDEX broll_items_project_idx ON public.broll_items(project_id);
CREATE INDEX broll_items_scene_idx ON public.broll_items(scene_id);

-- 6) infographic_items
CREATE TABLE public.infographic_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  item_index integer NOT NULL DEFAULT 0,
  t text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_prompt text NOT NULL DEFAULT '',
  asset_status text NOT NULL DEFAULT 'pending',
  asset_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.infographic_items TO authenticated;
GRANT ALL ON public.infographic_items TO service_role;
ALTER TABLE public.infographic_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infographic_items owner all" ON public.infographic_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = infographic_items.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = infographic_items.project_id AND p.user_id = auth.uid()));
CREATE INDEX infographic_items_project_idx ON public.infographic_items(project_id);

-- 7) thumbnail_items
CREATE TABLE public.thumbnail_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_index integer NOT NULL DEFAULT 0,
  concept text NOT NULL DEFAULT '',
  layout text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT '',
  palette jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_prompt text NOT NULL DEFAULT '',
  asset_status text NOT NULL DEFAULT 'pending',
  asset_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thumbnail_items TO authenticated;
GRANT ALL ON public.thumbnail_items TO service_role;
ALTER TABLE public.thumbnail_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "thumbnail_items owner all" ON public.thumbnail_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = thumbnail_items.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = thumbnail_items.project_id AND p.user_id = auth.uid()));
CREATE INDEX thumbnail_items_project_idx ON public.thumbnail_items(project_id);

-- 8) render_manifest
CREATE TABLE public.render_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  storyboard_item_id uuid REFERENCES public.storyboard_items(id) ON DELETE SET NULL,
  render_order integer NOT NULL DEFAULT 0,
  timeline_start numeric NOT NULL DEFAULT 0,
  timeline_end numeric NOT NULL DEFAULT 0,
  asset_type text NOT NULL DEFAULT '',
  asset_source text NOT NULL DEFAULT '',
  asset_query text NOT NULL DEFAULT '',
  asset_url text,
  caption_style text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_manifest TO authenticated;
GRANT ALL ON public.render_manifest TO service_role;
ALTER TABLE public.render_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "render_manifest owner all" ON public.render_manifest FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = render_manifest.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = render_manifest.project_id AND p.user_id = auth.uid()));
CREATE INDEX render_manifest_project_idx ON public.render_manifest(project_id);
CREATE INDEX render_manifest_scene_idx ON public.render_manifest(scene_id);
CREATE INDEX render_manifest_storyboard_idx ON public.render_manifest(storyboard_item_id);
CREATE INDEX render_manifest_order_idx ON public.render_manifest(project_id, render_order);
CREATE INDEX render_manifest_status_idx ON public.render_manifest(status);
