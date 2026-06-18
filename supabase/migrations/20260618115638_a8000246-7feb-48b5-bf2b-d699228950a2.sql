
-- 1. Extend assets
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'broll','image','infographic','thumbnail','overlay','animation','logo','video',
    'clinical_image','medical_diagram','broll_video','icon','stock_video','diagram','callout'
  ]));
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_status_check
  CHECK (status = ANY (ARRAY['candidate','approved','rejected','rendered','locked','pending']));
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS preview_url text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS search_query text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS review_note text;

-- 2. Extend asset_candidates
ALTER TABLE public.asset_candidates DROP CONSTRAINT IF EXISTS asset_candidates_status_check;
ALTER TABLE public.asset_candidates ADD CONSTRAINT asset_candidates_status_check
  CHECK (status = ANY (ARRAY['pending','searched','approved','rejected','locked','replaced']));
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS linked_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS edit_action_id uuid REFERENCES public.edit_actions(id) ON DELETE CASCADE;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS broll_item_id uuid REFERENCES public.broll_items(id) ON DELETE CASCADE;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS infographic_item_id uuid REFERENCES public.infographic_items(id) ON DELETE CASCADE;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.asset_candidates ADD COLUMN IF NOT EXISTS thumbnail_url text;
CREATE INDEX IF NOT EXISTS asset_candidates_status_idx ON public.asset_candidates(status);
CREATE INDEX IF NOT EXISTS asset_candidates_edit_action_idx ON public.asset_candidates(edit_action_id);
CREATE INDEX IF NOT EXISTS asset_candidates_broll_idx ON public.asset_candidates(broll_item_id);
CREATE INDEX IF NOT EXISTS asset_candidates_infographic_idx ON public.asset_candidates(infographic_item_id);

-- 3. Create project_assets (approved/curated asset registry per project, grouped by role)
CREATE TABLE IF NOT EXISTS public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK (status = ANY (ARRAY['pending','approved','rejected','locked'])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, asset_id, role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assets TO authenticated;
GRANT ALL ON public.project_assets TO service_role;

ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage project_assets for own projects"
  ON public.project_assets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_assets.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_assets.project_id AND p.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS project_assets_project_idx ON public.project_assets(project_id);
CREATE INDEX IF NOT EXISTS project_assets_asset_idx ON public.project_assets(asset_id);
CREATE INDEX IF NOT EXISTS project_assets_role_idx ON public.project_assets(role);

CREATE TRIGGER project_assets_set_updated_at
  BEFORE UPDATE ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
