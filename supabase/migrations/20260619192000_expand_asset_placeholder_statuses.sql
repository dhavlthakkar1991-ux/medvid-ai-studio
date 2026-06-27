-- Allow Studio to distinguish renderable media from planning placeholders
-- without changing table shape.

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'candidate',
        'approved',
        'rejected',
        'rendered',
        'locked',
        'pending',
        'render_ready',
        'approved_placeholder',
        'needs_asset',
        'placeholder_plan'
      ]
    )
  );

ALTER TABLE public.asset_candidates DROP CONSTRAINT IF EXISTS asset_candidates_status_check;
ALTER TABLE public.asset_candidates ADD CONSTRAINT asset_candidates_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending',
        'searched',
        'approved',
        'rejected',
        'locked',
        'replaced',
        'approved_placeholder',
        'needs_asset',
        'placeholder_plan'
      ]
    )
  );

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_status_check;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending',
        'approved',
        'rejected',
        'locked',
        'render_ready',
        'approved_placeholder',
        'needs_asset',
        'placeholder_plan'
      ]
    )
  );
