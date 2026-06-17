
-- 1) layout_decisions table
CREATE TABLE IF NOT EXISTS public.layout_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  action_id uuid REFERENCES public.edit_actions(id) ON DELETE CASCADE,
  start_time numeric NOT NULL DEFAULT 0,
  end_time numeric NOT NULL DEFAULT 0,
  doctor_visibility text NOT NULL DEFAULT 'visible',
  doctor_size text NOT NULL DEFAULT '100%',
  layout_name text NOT NULL DEFAULT 'full_screen_doctor',
  attention_focus text NOT NULL DEFAULT 'doctor',
  rationale text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.layout_decisions TO authenticated;
GRANT ALL ON public.layout_decisions TO service_role;

ALTER TABLE public.layout_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "layout_decisions owned via project"
  ON public.layout_decisions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = layout_decisions.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = layout_decisions.project_id AND p.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_layout_decisions_project ON public.layout_decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_layout_decisions_action ON public.layout_decisions(action_id);
CREATE INDEX IF NOT EXISTS idx_layout_decisions_scene ON public.layout_decisions(scene_id);

CREATE TRIGGER trg_layout_decisions_updated_at
  BEFORE UPDATE ON public.layout_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) render_manifest enrichment
ALTER TABLE public.render_manifest
  ADD COLUMN IF NOT EXISTS layout_name text,
  ADD COLUMN IF NOT EXISTS doctor_visibility text,
  ADD COLUMN IF NOT EXISTS doctor_size text,
  ADD COLUMN IF NOT EXISTS attention_focus text,
  ADD COLUMN IF NOT EXISTS rationale text;

-- 3) Expand layout library
INSERT INTO public.layout_templates(name, description, config) VALUES
  ('doctor_with_lower_third', 'Doctor full-frame with lower third overlay.', '{"doctor":"full","overlay":"lower_third"}'),
  ('doctor_with_clinical_image', 'Doctor PiP, clinical image dominant.', '{"doctor":{"position":"right","scale":0.3},"overlay":"clinical_image"}'),
  ('full_screen_broll', 'Full-screen b-roll. Doctor hidden.', '{"overlay":"broll","doctor":"hidden"}'),
  ('full_screen_infographic', 'Full-screen infographic. Doctor hidden.', '{"overlay":"infographic","doctor":"hidden"}'),
  ('full_screen_cta', 'Full-screen CTA card. Doctor hidden.', '{"overlay":"cta","doctor":"hidden"}')
ON CONFLICT (name) DO NOTHING;
