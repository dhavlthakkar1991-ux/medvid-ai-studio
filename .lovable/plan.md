## Phase 1.5 — Architecture Hardening Plan

This is a backend-only hardening sprint. UI behavior stays the same; we add a canonical relational layer underneath the existing JSON-blob pipeline so Phase 2 (FFmpeg) can render deterministically.

### Approach

Keep `analysis_versions` JSON blobs intact (versioning + history preserved). Add a normalized relational layer alongside them, and write to both. The pipeline gains a post-processing "normalize" step after each task that projects JSON → relational rows. A new `timeline_builder` server module produces the `render_manifest` from canonical tables.

### Step A — Database migrations (single migration, additive only)

New tables (all with `project_id` FK to `projects`, RLS scoped to `auth.uid()` via project ownership, full GRANTs):

1. `scenes` — canonical timeline scenes (id, project_id, scene_number, title, start_time, end_time, duration, narration_text, objective, timestamps)
2. `transcript_segments` — timestamped narration (id, project_id, start_time, end_time, duration, text, word_count, segment_index)
3. `scene_transcript_map` — N:N link (scene_id, transcript_segment_id)
4. `storyboard_items` — normalized storyboard (scene_id FK, visual_type, asset_prompt, animation, priority, screen_layout, duration_seconds, timeline_start, timeline_end, asset_status, asset_url, render_notes)
5. `broll_items` — normalized b-roll (scene_id FK nullable, keyword, search_prompt, placement_reason, recommended_start, recommended_end)
6. `infographic_items` — normalized (scene_id nullable, type, title, bullets jsonb, asset_prompt, t)
7. `thumbnail_items` — normalized (concept, layout, text, palette jsonb, asset_prompt)
8. `render_manifest` — canonical render contract (project_id, scene_id, storyboard_item_id, timeline_start, timeline_end, render_order, asset_type, asset_source, asset_query, asset_url, caption_style, status)

Indexes on: `project_id`, `scene_id`, `transcript_segment_id`, `storyboard_item_id`, `render_order`, `status`.

RLS: all tables scoped via `EXISTS (SELECT 1 FROM projects WHERE projects.id = <table>.project_id AND projects.user_id = auth.uid())`. GRANTs to `authenticated` + `service_role` per project conventions.

### Step B — Shared contracts folder

Move/refactor `src/lib/ai/schemas.ts` into `src/lib/ai/contracts/` with one file per task. Add new contract fields where needed:
- `scene_plan` items add `scene_number`, `start_time`, `end_time` (numeric seconds), `narration_text`, `objective`
- `visual_storyboard` items add `scene_number` (reference to parent scene), keep current fields
- `broll` items match required shape: `scene_number`, `keyword`, `search_prompt`, `placement_reason`, `recommended_start`, `recommended_end`

Contracts are provider-independent (already are — Gemini/OpenAI/etc. all go through same Zod parse).

### Step C — Transcript segmentation

Update transcription step (in `src/lib/job-runner.server.ts` / transcript writer) to also populate `transcript_segments` from the Whisper/AssemblyAI segments we already get back. Currently we store `full_text` + raw `segments` JSON on `transcripts` — we project that JSON into rows.

### Step D — Pipeline normalization layer

New module `src/lib/analysis/normalize.server.ts` with per-task functions:
- `normalizeScenePlan(projectId, json)` → upserts `scenes` + builds `scene_transcript_map` by overlapping timestamps with `transcript_segments`
- `normalizeStoryboard(projectId, json)` → resolves each item's `scene_number` → `scene_id`, computes `timeline_start/end` from the scene's transcript-derived times (not LLM guesses), writes `storyboard_items`
- `normalizeBroll`, `normalizeInfographics`, `normalizeThumbnails` analogous

Hook into `runTaskForProject` in `src/lib/analysis-runner.server.ts`: after `analysis_versions.insert`, call the appropriate normalizer. JSON history is preserved.

### Step E — Transcript-derived durations

In `normalizeStoryboard`, `duration_seconds = scene.end_time - scene.start_time` distributed across items in that scene (proportional to LLM `duration_seconds` weights, but clamped to scene window). LLM duration is treated as a hint, not authoritative.

### Step F — B-roll hardening

In `runTaskForProject` for `task === "broll"`:
- After generation, if `broll.length < 5`, retry once with a stricter prompt requiring exactly 5+ items keyed to scene numbers
- If still short, synthesize fallback items from scene titles (one per scene, generic stock-footage keywords)
- Schema enforces `min(5)` after fallback. Never persist an empty array.

### Step G — Timeline builder

New `src/lib/render/timeline-builder.server.ts`:
- Input: `projectId`
- Reads: `scenes`, `storyboard_items`, `broll_items`
- Output: writes `render_manifest` rows in `render_order` matching scene order; assigns `asset_type` (storyboard | broll | infographic), `asset_source`, `timeline_start/end` from canonical scene times.
- Expose as `buildRenderManifest` server fn, called automatically after the full pipeline completes (in `job-runner.server.ts`) and also exposed as a regenerate action.

### Step H — UI (minimal, developer-mode only)

In `src/routes/_authenticated/projects.$id.tsx`:
- Add a small "Dev mode" toggle (localStorage-backed) above the Tabs
- When on, the Storyboard, Scene Plan, and Render Manifest tabs render an extra table column showing: `scene_id` (short), `timeline_start`, `timeline_end`, `duration`, `asset_status`
- Add a new "Render Manifest" tab fed from `render_manifest`
- No restyling, no layout overhaul

### Step I — Backwards compatibility

- Existing projects: tables are empty until next regenerate. Add a one-time "Rebuild canonical data" button on the project page that re-runs normalization over the latest `analysis_versions` rows without re-calling the LLM.
- All new tables are additive. `analysis_versions` unchanged. Existing code paths keep working.

### Technical notes

- All new DB code uses `createServerFn` + `requireSupabaseAuth` (RLS as user), per stack rules.
- `timeline_builder` is a server fn, not an edge function.
- New tables go in one migration with GRANTs and RLS in the required order.
- Contracts stay Zod; preprocessors for enum normalization carry over.
- No changes to auth, no changes to existing tables' shape (additive columns only if strictly needed — current plan adds zero columns to existing tables).

### Out of scope

- FFmpeg rendering itself (that's Phase 2)
- Any visual redesign
- Replacing the JSON-blob version history

### Scale

This is a large migration: ~8 new tables, ~6 new server modules, contracts refactor, pipeline hook changes, and a small UI addition. Estimated 12–18 file additions and 4–6 edits to existing files.
