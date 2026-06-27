-- Prefer the external Custom Worker for render dispatch.
-- Provider URLs and secrets remain environment-specific configuration.

UPDATE public.render_providers
SET is_default = false
WHERE provider_type <> 'custom_worker';

UPDATE public.render_providers
SET enabled = false,
    is_default = false
WHERE provider_type = 'mock';

UPDATE public.render_providers
SET enabled = true,
    is_default = true
WHERE provider_type = 'custom_worker';
