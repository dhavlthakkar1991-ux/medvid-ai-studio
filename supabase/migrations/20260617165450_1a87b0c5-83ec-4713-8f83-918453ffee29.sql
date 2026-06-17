
ALTER TABLE public.render_manifest
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transition text NOT NULL DEFAULT 'cut';
CREATE INDEX IF NOT EXISTS render_manifest_asset_idx ON public.render_manifest(asset_id);
