
# OncoVideo AI Studio — Phase 1 MVP (Final, with Specialty Templates)

Working AI Video Production Assistant for medical educators. No video rendering in Phase 1, but every schema, provider interface, and AI output is shaped so Phases 2–7 (asset generation, auto-editor, rendering, publishing) plug in without migrations or refactors. Oncology specialty intelligence is built in from day one.

## Scope

In: auth, projects, **medical specialty templates**, project knowledge base, video upload, multi-provider transcription, multi-provider AI analysis with task-specific defaults, **visual storyboard as canonical asset spec**, **analysis versioning**, **cost tracking**, preview dashboard, exports (PDF/JSON/TXT/SRT).

Out (later phases): FFmpeg rendering, AI image/video asset generation, timeline editor, AI Director, YouTube publishing, Stripe billing.

## Decision hierarchy (used by every AI call)

```
Project Context  ▸  Specialty Template  ▸  User Defaults  ▸  Workspace Defaults
```

Every analysis server fn assembles a `MergedContext` from these layers, then injects it into the system prompt. Same precedence applies to model selection and transcription provider.

## User flow

1. Sign up / log in (`/auth`, email + Google).
2. Dashboard → projects grid → "New Project".
3. **Pick a Specialty Template** (Surgical Oncology, Breast, Head & Neck, GI, Urological, Gynecological, General Cancer Awareness) → form pre-fills audience, brand voice, visual style, default infographic/B-roll/thumbnail patterns.
4. User can override any field per project (project_context).
5. Upload video; background job: `queued → transcribing → analyzing → completed`.
6. Project page tabs: Transcript · Chapters · Scene Plan · **Visual Storyboard** · B-Roll · Infographics · Thumbnails · SEO · Shorts · Versions · Cost · Export.
7. Per-tab "Regenerate" creates a new `analysis_versions` row; prior versions remain browsable.
8. Export buttons: PDF report, JSON edit plan, transcript TXT, SRT.

## Architecture

- TanStack Start + Tailwind + shadcn, dark medical SaaS theme via semantic tokens.
- Lovable Cloud (Supabase) for auth, Postgres, Storage. No Lovable-only APIs in app code → repo stays GitHub-portable for Vercel / VPS / Docker.
- All secret-bearing work in `createServerFn` handlers; admin client only via `await import("@/integrations/supabase/client.server")` inside handlers.

### Provider abstraction (built now)

`src/lib/ai/`:

- **`TranscriptionProvider`** — `transcribe(audioUrl, opts) → { text, words[], language, usage }`. Phase 1: `openai-whisper`, `groq-whisper`. Stubs: `assemblyai`, `deepgram`.
- **`LLMProvider`** — `generateJSON(schema, prompt, opts) → { data, usage }`. Always returns Zod-validated **structured JSON**; markdown blobs forbidden anywhere in the pipeline. Phase 1: `lovable`, `openai`, `gemini`, `openrouter`. Stubs: `anthropic`, `groq`, `deepseek`.

### Task-specific default models (configurable in Settings)

| Task | Default model |
|---|---|
| Transcript Analysis | `google/gemini-2.5-pro` |
| Scene Planning | `anthropic/claude-sonnet-4` |
| Visual Storyboard | `anthropic/claude-sonnet-4` |
| SEO Package | `openai/gpt-5` |
| Thumbnail Concepts | `google/gemini-2.5-flash` |
| Shorts | `google/gemini-2.5-flash` |
| Budget Mode (global override) | `deepseek/deepseek-chat` |

### Usage logging

Every adapter call returns a `usage` object; the wrapper writes a `usage_logs` row (provider, model, task, input/output tokens, estimated USD). Static `src/lib/ai/pricing.ts` table converts tokens → cost. Project page + settings show totals.

## Data model (all migrations include GRANTs + RLS scoped to `auth.uid()`)

Used in Phase 1:
- `profiles` (id=auth.users.id, full_name, specialty, avatar_url)
- `ai_settings` (user_id PK, default_llm_provider, default_transcription_provider, model_overrides jsonb, encrypted keys per provider, budget_mode bool)
- **`specialty_templates`** (id, owner_user_id nullable [NULL = built-in system template], specialty text, template_name text, default_audience text, default_brand_voice text, default_visual_style text, default_scene_patterns jsonb, default_infographic_types jsonb, default_broll_types jsonb, default_thumbnail_style jsonb, is_builtin bool, created_at). RLS: SELECT allowed on built-ins for all `authenticated`; full CRUD on rows where `owner_user_id = auth.uid()`. Seeded via migration with the 7 oncology templates.
- `projects` (id, user_id, title, topic, status, video_path, duration_seconds, **specialty_template_id** nullable, created_at)
- `project_context` (project_id PK, audience, specialty, brand_voice, target_platform, content_type, visual_style, scene_patterns jsonb, infographic_types jsonb, broll_types jsonb, thumbnail_style jsonb, render_intent, visual_density, retention_priority). Populated from chosen template on create; user can override any field.
- `transcripts` (project_id PK, full_text, words jsonb, language, provider_used)
- `analysis_versions` (id, project_id, task enum [`full`,`scene_plan`,`visual_storyboard`,`seo`,`thumbnails`,`shorts`,`broll`,`infographics`,`chapters`], version int, provider, models_used jsonb, analysis_data jsonb, created_at)
- `usage_logs` (id, user_id, project_id, provider, model, task, input_tokens, output_tokens, estimated_cost numeric, created_at)
- `jobs` (id, project_id, kind, state, progress, error, created_at, updated_at)
- Storage bucket `videos` (private, signed URLs).

Provisioned for Phase 2+ (empty in MVP):
- `render_profiles` (id, user_id, name, intro_video, outro_video, watermark, logo, subtitle_style jsonb)
- `render_jobs` (id, project_id, status, provider, output_url, settings jsonb, created_at)

### Built-in specialty templates (seeded in migration)

1. Surgical Oncology
2. Breast Oncology
3. Head & Neck Oncology
4. Gastrointestinal Oncology
5. Urological Oncology
6. Gynecological Oncology
7. General Cancer Awareness

Example seed (Surgical Oncology):

```json
{
  "default_audience": "Patients and caregivers",
  "default_brand_voice": "Professional, reassuring, evidence-based",
  "default_visual_style": "Hospital-grade educational",
  "default_scene_patterns": ["intro_hook","problem_framing","risk_factors","screening","treatment_pathway","recovery","cta"],
  "default_infographic_types": ["risk_factors","symptoms","screening_pathways","treatment_pathways"],
  "default_broll_types": ["doctor_consultation","hospital_environment","medical_imaging","patient_education"],
  "default_thumbnail_style": { "palette":["#0a2540","#ffffff","#e63946"], "layout":"face_left_text_right", "tone":"reassuring_authority" }
}
```

## AI analysis JSON contracts (Zod-validated, structured-only)

Every task is its own server fn writing its own `analysis_versions` row. System prompt receives the merged context (project_context + specialty_template + user overrides).

```ts
chapters: [{ title, start, end }]
scene_plan: [{ t, kind, title, prompt }]

visual_storyboard: [{
  time, visual_type, title, screen_layout,
  asset_prompt, animation, priority, duration_seconds
}]

broll:        [{ t, prompt, asset_prompt, keywords[] }]
infographics: [{ t, type, title, bullets[], asset_prompt }]
thumbnails:   [{ concept, layout, text, palette[], asset_prompt }]
seo:          { titles[], description, tags[], chapters_text, pinned_comment }
shorts:       [{ start, end, hook, caption, asset_prompt }]
```

Visual Storyboard is the canonical asset spec for Phase 3/4. B-roll, Infographics, Thumbnails, and Shorts all carry `asset_prompt` so Phase 3 can fan out generation jobs without re-prompting.

## Background processing

- Server fn enqueues `jobs` row, fires `/api/jobs/run/$jobId` server route.
- States: `queued → transcribing → analyzing → completed | failed`.
- UI polls job status every 3s; retry re-fires the route.
- Per-task regenerate is a synchronous server fn writing a new `analysis_versions` row.

## UI surfaces

- `/auth`
- `/_authenticated/dashboard` (project grid + total cost)
- `/_authenticated/projects/new` (specialty template picker → pre-filled context form → upload)
- `/_authenticated/projects/$id` (tabbed preview, job status, per-tab regenerate, version dropdown, cost panel, export panel)
- `/_authenticated/settings/ai` (LLM provider, transcription provider, keys, per-task model overrides, budget mode, usage totals)
- `/_authenticated/settings/templates` (list built-in + user templates, clone & edit, create custom)
- `/_authenticated/settings/brand` (render_profiles row for Phase 2)

## Exports

- **JSON** — latest `analysis_versions` per task + transcripts + project_context + chosen template snapshot.
- **TXT** — plain transcript.
- **SRT** — built from word timings (~7 words/cue).
- **PDF** — `@react-pdf/renderer` cover + chapters + scene plan + visual storyboard + thumbnails + SEO; rendered from structured JSON only.

## Phase 1 success criteria

A doctor picks "Surgical Oncology" template, uploads an educational oncology video, and receives:

- Transcript
- Chapters
- Scene Plan
- Visual Storyboard
- B-Roll Suggestions (with `asset_prompt`)
- Infographic Suggestions (with `asset_prompt`)
- Thumbnail Concepts (specialty-styled)
- SEO Package
- Shorts Ideas
- Analysis Version History (regenerate any task without losing prior versions)
- Cost Tracking (per project, per task)
- Export Package (PDF + JSON + TXT + SRT)

All outputs stored as structured JSON; human-readable UI rendered from that JSON; AI prompts auto-tuned by specialty template + project overrides.

## Build order

1. Enable Lovable Cloud + run all migrations (including `specialty_templates`, `analysis_versions`, `usage_logs`, `render_profiles`, `render_jobs`) + seed 7 built-in templates + storage bucket + Google OAuth.
2. Auth + integration-managed `_authenticated` layout.
3. AI provider abstraction (LLM + Transcription) + pricing table + `usage_logs` writer + `MergedContext` builder.
4. Settings: AI page, Templates page (clone/edit/create), Brand page stub.
5. Projects CRUD + Specialty template picker + upload + project_context form.
6. Job runner route + status polling UI.
7. Transcription pipeline (OpenAI + Groq adapters).
8. Analysis pipeline — one server fn per task, each writing a new `analysis_versions` row using `MergedContext`.
9. Project tabs UI with version dropdown + per-task Regenerate + cost panel.
10. Exports.
11. README: env vars, GitHub sync notes, Vercel/Docker/VPS deploy notes.

## Out of scope reminders

No FFmpeg, no AI asset generation, no timeline editor, no YouTube upload, no Stripe — schema and provider layer are pre-shaped so Phases 2–7 slot in cleanly.
