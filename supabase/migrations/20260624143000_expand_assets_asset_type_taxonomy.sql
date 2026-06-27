-- Keep the database asset taxonomy aligned with the scene-centric review UI,
-- RenderSpec builder, and worker layout roles.

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check
  CHECK (
    asset_type = ANY (
      ARRAY[
        'broll',
        'image',
        'infographic',
        'thumbnail',
        'overlay',
        'animation',
        'logo',
        'video',
        'clinical_image',
        'medical_diagram',
        'broll_video',
        'icon',
        'stock_video',
        'diagram',
        'callout',
        'lower_third',
        'cta_branding',
        'contextual_broll',
        'text_overlay',
        'end_card',
        'caption',
        'presenter_video'
      ]
    )
  );
