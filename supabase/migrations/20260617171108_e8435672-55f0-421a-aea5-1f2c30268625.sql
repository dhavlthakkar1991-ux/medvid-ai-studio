
-- =========================================================
-- Phase 2A-A: AI Editing System foundation
-- =========================================================

-- ---------- layout_templates ----------
CREATE TABLE IF NOT EXISTS public.layout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.layout_templates TO authenticated;
GRANT ALL ON public.layout_templates TO service_role;
ALTER TABLE public.layout_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "layout_templates readable by authenticated"
  ON public.layout_templates FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_layout_templates_updated_at
  BEFORE UPDATE ON public.layout_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- transition_templates ----------
CREATE TABLE IF NOT EXISTS public.transition_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transition_templates TO authenticated;
GRANT ALL ON public.transition_templates TO service_role;
ALTER TABLE public.transition_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transition_templates readable by authenticated"
  ON public.transition_templates FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_transition_templates_updated_at
  BEFORE UPDATE ON public.transition_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- motion_templates ----------
CREATE TABLE IF NOT EXISTS public.motion_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.motion_templates TO authenticated;
GRANT ALL ON public.motion_templates TO service_role;
ALTER TABLE public.motion_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "motion_templates readable by authenticated"
  ON public.motion_templates FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_motion_templates_updated_at
  BEFORE UPDATE ON public.motion_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- edit_actions ----------
CREATE TABLE IF NOT EXISTS public.edit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  storyboard_item_id uuid REFERENCES public.storyboard_items(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  duration numeric NOT NULL DEFAULT 0,
  layer integer NOT NULL DEFAULT 1,
  priority integer NOT NULL DEFAULT 5,
  layout_id uuid REFERENCES public.layout_templates(id) ON DELETE SET NULL,
  transition_in_id uuid REFERENCES public.transition_templates(id) ON DELETE SET NULL,
  transition_out_id uuid REFERENCES public.transition_templates(id) ON DELETE SET NULL,
  asset_query text,
  source text NOT NULL DEFAULT 'backfill',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edit_actions_project ON public.edit_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_edit_actions_scene ON public.edit_actions(scene_id);
CREATE INDEX IF NOT EXISTS idx_edit_actions_start ON public.edit_actions(project_id, start_time);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_actions TO authenticated;
GRANT ALL ON public.edit_actions TO service_role;
ALTER TABLE public.edit_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edit_actions owned via project"
  ON public.edit_actions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edit_actions.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edit_actions.project_id AND p.user_id = auth.uid()));
CREATE TRIGGER trg_edit_actions_updated_at
  BEFORE UPDATE ON public.edit_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- render_manifest V3 columns ----------
ALTER TABLE public.render_manifest
  ADD COLUMN IF NOT EXISTS edit_action_id uuid REFERENCES public.edit_actions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS layout_id uuid REFERENCES public.layout_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transition_in_id uuid REFERENCES public.transition_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transition_out_id uuid REFERENCES public.transition_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS layer integer,
  ADD COLUMN IF NOT EXISTS action_type text;

-- ---------- Seed: layouts ----------
INSERT INTO public.layout_templates(name, description, config) VALUES
  ('full_screen_doctor', 'Full-frame source video (Track 0 only).', '{"doctor":"full"}'),
  ('full_screen', 'Full-frame overlay covers source video.', '{"overlay":"full"}'),
  ('pip_right', 'Doctor in a small frame on the right; overlay fills the rest.', '{"doctor":{"position":"right","scale":0.3}}'),
  ('pip_left', 'Doctor PiP on the left; overlay fills the rest.', '{"doctor":{"position":"left","scale":0.3}}'),
  ('split_screen', 'Doctor on one half, overlay on the other.', '{"split":"vertical"}'),
  ('top_bottom', 'Doctor on top, overlay on bottom.', '{"split":"horizontal"}'),
  ('doctor_with_infographic', 'Doctor + infographic side-by-side.', '{"doctor":"left","overlay":"infographic"}'),
  ('doctor_with_broll', 'Doctor PiP over b-roll background.', '{"doctor":"pip","overlay":"broll"}'),
  ('doctor_with_callout', 'Doctor full-frame with text callout overlay.', '{"doctor":"full","overlay":"callout"}'),
  ('picture_in_picture', 'Generic PiP overlay.', '{"layout":"pip"}')
ON CONFLICT (name) DO NOTHING;

-- ---------- Seed: transitions ----------
INSERT INTO public.transition_templates(name, description, config) VALUES
  ('cut', 'Hard cut, no transition.', '{"duration":0}'),
  ('fade', 'Standard fade.', '{"duration":0.4}'),
  ('crossfade', 'Crossfade between clips.', '{"duration":0.5}'),
  ('slide', 'Slide transition.', '{"duration":0.4}'),
  ('push', 'Push transition.', '{"duration":0.4}'),
  ('zoom', 'Zoom transition.', '{"duration":0.4}'),
  ('blur', 'Blur transition.', '{"duration":0.4}'),
  ('whip', 'Whip pan transition.', '{"duration":0.3}'),
  ('medical_hud', 'Medical HUD-style transition.', '{"duration":0.5}')
ON CONFLICT (name) DO NOTHING;

-- ---------- Seed: motion templates ----------
INSERT INTO public.motion_templates(name, description, config) VALUES
  ('callout', 'Animated callout box.', '{}'),
  ('animated_arrow', 'Animated pointer arrow.', '{}'),
  ('highlight_box', 'Animated highlight frame.', '{}'),
  ('stat_counter', 'Animated statistic counter.', '{}'),
  ('icon_reveal', 'Animated icon reveal.', '{}'),
  ('keyword_pop', 'Pop-in keyword animation.', '{}'),
  ('anatomy_pointer', 'Anatomy pointer label.', '{}')
ON CONFLICT (name) DO NOTHING;
