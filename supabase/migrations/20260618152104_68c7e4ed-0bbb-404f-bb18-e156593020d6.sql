
-- 1. graphic_templates
CREATE TABLE public.graphic_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  graphic_type text NOT NULL,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  svg_template text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (graphic_type, template_name, owner_user_id)
);
CREATE INDEX idx_graphic_templates_type ON public.graphic_templates(graphic_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.graphic_templates TO authenticated;
GRANT ALL ON public.graphic_templates TO service_role;

ALTER TABLE public.graphic_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read system or own templates" ON public.graphic_templates
  FOR SELECT TO authenticated USING (is_system OR owner_user_id = auth.uid());
CREATE POLICY "manage own templates" ON public.graphic_templates
  FOR ALL TO authenticated USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE TRIGGER trg_graphic_templates_updated BEFORE UPDATE ON public.graphic_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. compiled_graphics
CREATE TABLE public.compiled_graphics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  edit_action_id uuid REFERENCES public.edit_actions(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.graphic_templates(id) ON DELETE SET NULL,
  graphic_type text NOT NULL,
  template_name text,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  svg text NOT NULL DEFAULT '',
  thumbnail_url text,
  preview_url text,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edit_action_id)
);
CREATE INDEX idx_compiled_graphics_project ON public.compiled_graphics(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compiled_graphics TO authenticated;
GRANT ALL ON public.compiled_graphics TO service_role;

ALTER TABLE public.compiled_graphics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compiled_graphics owned via project" ON public.compiled_graphics
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = compiled_graphics.project_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = compiled_graphics.project_id AND p.user_id = auth.uid())
  );

CREATE TRIGGER trg_compiled_graphics_updated BEFORE UPDATE ON public.compiled_graphics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Link timeline_items and render_manifest to compiled graphics
ALTER TABLE public.timeline_items
  ADD COLUMN compiled_graphic_id uuid REFERENCES public.compiled_graphics(id) ON DELETE SET NULL;
ALTER TABLE public.render_manifest
  ADD COLUMN compiled_graphic_id uuid REFERENCES public.compiled_graphics(id) ON DELETE SET NULL,
  ADD COLUMN manifest_version integer NOT NULL DEFAULT 5;

CREATE INDEX idx_timeline_items_compiled_graphic ON public.timeline_items(compiled_graphic_id);
CREATE INDEX idx_render_manifest_compiled_graphic ON public.render_manifest(compiled_graphic_id);

-- 4. Seed one system template per graphic_type
INSERT INTO public.graphic_templates (template_name, graphic_type, is_system, spec, svg_template) VALUES
  ('default_lower_third', 'show_lower_third', true,
    '{"bg":"#0f172a","accent":"#38bdf8","fg":"#f8fafc","font":"Inter","title_size":48,"subtitle_size":22}'::jsonb,
    'lower_third_v1'),
  ('default_callout', 'show_callout', true,
    '{"bg":"#fde047","fg":"#0f172a","border":"#a16207","font":"Inter","title_size":36}'::jsonb,
    'callout_v1'),
  ('default_kinetic_typography', 'kinetic_typography', true,
    '{"bg":"transparent","fg":"#f8fafc","stroke":"#ec4899","font":"Inter","title_size":96}'::jsonb,
    'kinetic_v1'),
  ('default_highlight_keyword', 'highlight_keyword', true,
    '{"bg":"#fef08a","fg":"#7c2d12","font":"Inter","title_size":56}'::jsonb,
    'highlight_v1'),
  ('default_text_overlay', 'show_text_overlay', true,
    '{"bg":"#0f172abb","fg":"#f1f5f9","accent":"#22d3ee","font":"Inter","title_size":40}'::jsonb,
    'text_overlay_v1'),
  ('default_cta', 'show_cta', true,
    '{"bg":"#ec4899","fg":"#ffffff","border":"#831843","font":"Inter","title_size":48,"subtitle_size":22}'::jsonb,
    'cta_v1');
