# MedVideo AI Active Goal

This file consolidates the currently active workspace prompts into one working goal so Studio and Worker changes stay aligned.

## North Star

Make the local/self-hosted MedVideo AI pipeline reliably produce professional medical videos from a real project:

Upload/project video -> local AI pipeline -> asset review -> manifest/timeline -> RenderSpec -> Custom Worker -> MP4 -> Studio persistence.

## Current Priority Order

1. Keep Studio self-hosted and local-runner friendly.
   - `JOB_RUNNER_SECRET` is the explicit local pipeline runner secret.
   - Runtime AI provider resolution should prefer configured Gemini/OpenAI/Groq/OpenRouter keys before legacy Lovable.
   - Lovable remains optional legacy support, not a hidden default dependency.

2. Make Review Assets scene-centric and human-approvable.
   - Group requirements, candidates, approved assets, manifest status, prompts, and readiness by scene.
   - Keep raw/debug candidate lists collapsed.
   - Hide unsafe/low-quality placeholder candidates from the primary scene workflow.
   - Allow scene-level multi-select approval, rejection, missing marking, prompt copy/export, upload/replace, paste URL, timing repair, and layout repair.

3. Preserve honest render readiness.
   - Do not fake-pass placeholders.
   - Approved assets must have usable media URLs before being treated as render-ready.
   - Manifest/timeline/RenderSpec coverage must be reconciled after approval.

4. Keep Worker behavior stable while Studio review improves.
   - Do not change the provider contract unless a verified integration bug requires it.
   - Preserve existing FFmpeg, layout-aware compositing, callback, cancellation, and output-serving behavior.

## Latest Checkpoint - 2026-06-26

Phase 2F-G/G1 workflow verification is green for benchmark project `24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99`, and required professional render readiness is now unblocked.

- Active Supabase project: `asscnuntwtnyukwvcxbr`.
- Remote asset taxonomy blocker: resolved by manual SQL execution; `npm.cmd run verify:active-goal` now reports `ready=true`, `worker_status=ok`, `taxonomy_pending=false`, and `blockers=[]`.
- Worker health: `GET http://localhost:8788/health` returns `ok=true`, `mode=real-layout-aware`, and `secret_configured=true`.
- Required asset workflow: `npm.cmd run verify:phase2fg` reports 15 deduped requirements, 13 required, 13 required resolved, 0 required unresolved, valid RenderSpec, `professional_ready=true`, and `biopsy_india_map_valid_match_count=0`.
- Professional replacement assets applied for the previous 5 required blockers: India prevalence, oral examination/warning signs, cervical lymph node, early detection/comparison, and CTA branding/contact polish. The open-license oral ulcer image and Studio-curated biopsy workflow remain linked.
- The previous optional doctor lower-third/contextual b-roll mismatch is repaired; professional readiness now reports 0 mismatches, 0 timing problems, and 13/13 required assets resolved. Optional unresolved items still do not block professional readiness, but any mapped mismatch remains a blocker.
- UI smoke: `npm.cmd run smoke:phase2fg-ui` passes all assertions. Latest artifact reports 15 actionable cards, all expected row controls, prompt modal/copy support, raw/debug access, honest zero-mismatch readiness, 0 console errors, and 0 page errors.
- Real-project browser smoke: `STUDIO_SMOKE_PROJECT_ID=24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99 STUDIO_SMOKE_AUTH_MODE=admin_magiclink npm.cmd run smoke:scene-review` passes against the live local Studio server. Artifact: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/scene-review-smoke.json`; screenshot: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/scene-review-smoke.png`. It confirms owner-session auth injection, `Scene Asset Review`, 17 scene groups, 15 asset to-do cards, required row controls, prompt modal/copy behavior, upload input, raw/debug access, and biopsy-vs-India mismatch protection.
- Review Assets performance/readability fix: live review now uses a bounded candidate pool built from approved/locked rows plus top scene/concept/type candidates, while preserving raw candidate counts and export/debug artifacts. This kept the benchmark page actionable instead of processing hundreds of duplicate candidates before showing the scene workflow.
- Self-hosting audit: `npm.cmd run verify:self-hosting` passes and writes `data/review-artifacts/self-hosting/self-hosting-audit.json`. It verifies the active Supabase ref is `asscnuntwtnyukwvcxbr`, the retired Lovable-linked ref is not active, `.env.example` documents required self-hosting keys, `JOB_RUNNER_SECRET` is not coupled to `LOVABLE_API_KEY`, provider defaults prefer Gemini/OpenAI/Groq/OpenRouter before Lovable, custom worker callback/HTTPS requirements are enforced, and there are no app-source hardcoded localhost URLs. It records the generated Lovable auth integration as a non-blocking warning because app routes do not import it.
- Remaining smoke noise is non-blocking: local Vite `ERR_ABORTED` module requests during navigation and browser-blocked external raw/debug previews. Smoke artifacts redact signed URL query tokens before writing evidence JSON.
- Studio verification: `npm.cmd run typecheck` and `npm.cmd run build` pass. Build still emits existing Vite/TanStack deprecation/plugin timing warnings.
- Worker fix applied during final Phase 2F-G/G1 verification: video overlays were being trimmed to their item duration but kept PTS at 0 while the final overlay gate expected timeline time. This made scheduled video B-roll disappear at its intended timestamp. `C:\Users\LENOVO\Documents\medvideo-render-worker\src\server.ts` now offsets non-still overlay PTS by `overlay.startTime` before layout compositing; still-image overlays keep their existing timeline-length loop behavior.
- Latest benchmark preview after the video-overlay timing fix:
  - render job: `731b2488-756e-488f-a921-187ecfe05f18`
  - provider job: `cw_preview_1782481131001_4rc7mk`
  - output: `C:\Users\LENOVO\Documents\medvideo-render-worker\data\outputs\cw_preview_1782481131001_4rc7mk.mp4`
  - Studio persisted `status=completed`, `progress_percent=100`, output URL, `duration_seconds=107.285`, and `file_size=18785164`.
  - HTTP HEAD returned `200` / `video/mp4`; ffprobe reports H.264 1280x720 video and AAC stereo audio.
  - Frame evidence: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/render-frame-checks/latest-cw_preview_1782481131001_4rc7mk/latest_contact_sheet.png`. The tobacco/gutkha video overlay is visible at 00:20/00:22, and no placeholder watermark is present.
- Worker professional gating remains honest after rerender: `data/debug/cw_preview_1782481131001_4rc7mk/render_gating_report.json` reports `professional_ready=true`, `preview_watermark_required=false`, and `failed=[]`; optional unresolved generated-placeholder items are recorded as non-blocking only when they are not mapped mismatches.
- Phase 2F-G debug artifacts were regenerated with signed Supabase storage URL tokens redacted; no raw signed URL token or API key was found in the Phase 2F-G JSON/MD evidence scan.
- Follow-up verifier cleanup: the optional intro lower-third row now correctly counts as resolved when it is represented by an inline compiled graphic in RenderSpec (`graphic:4f29f803-c558-4afe-af98-9a75035c125c`). The evidence layer still keeps clinical/anatomy assets strict: URL-backed and correctly matched assets are required there, and the later Pexels b-roll remap cleared the remaining optional mapped mismatch.

## Latest Coordination Checkpoint - 2026-06-27

The active-goal coordination layer now has a browser-inclusive audited suite and a standalone machine audit that explicitly guard against stale or misleading handoff evidence.

- `npm.cmd run verify:goal-suite:audited` is the current one-command regression for this phase. It runs active-goal readiness, self-hosting audit, Phase 2F-G workflow verification, latest render evidence, Worker typecheck/build, Studio typecheck, Phase 2F-G UI smoke, real-project Scene Review browser smoke, worktree inventory, and completion audit.
- `npm.cmd run audit:active-goal` writes `data/review-artifacts/active-goal-completion-audit.json` with `status=current_phase_verified` when all required evidence gates pass. It is a current-phase verification only, not a claim that the broad thread goal is complete.
- Coordination artifact writes now use temp-file replacement, and the audit requires `active_goal_json_inputs_parseable` and `active_goal_temp_artifacts_absent`.
- The audit requires `worktree_inventory_matches_latest_suite_window`, so `data/review-artifacts/active-goal-worktree-inventory.json` must be generated inside the latest audited suite window.
- The audited suite records suite-started service cleanup, and the standalone audit requires `goal_suite_started_services_cleaned_up` plus `goal_suite_started_service_ports_released` so local Studio/Worker servers are not silently left running.
- The suite's Studio readiness probe uses Vite's `@vite/client` endpoint for server readiness; app-route behavior remains covered by browser smoke tests.

## Evidence Index

- Quick handoff inventory: `docs/active-goal-inventory.md` lists the verified command, current-phase scope, intended coordination files, generated artifacts, and the current open decision.
- Full regression bundle: `data/review-artifacts/goal-suite/goal-suite.json` is the latest combined e2e verifier output. It passed active-goal readiness, self-hosting audit, Phase 2F-G workflow, latest render evidence, worker typecheck/build, Studio typecheck, Phase 2F-G UI smoke, and real-project Scene Review browser smoke.
- Machine-readable audit: `data/review-artifacts/active-goal-completion-audit.json` is generated by `npm.cmd run audit:active-goal` and verifies the current Phase 2F-G/G1 coordination state against the artifacts below. It includes a compact `handoff_summary` with current phase status, guardrails, key commands, key artifacts, render evidence, and the next open decision. It starts with `active_goal_json_inputs_parseable`, so missing or malformed evidence JSON is reported before downstream claims are interpreted, and it requires `active_goal_temp_artifacts_absent` so interrupted temp-file writes are not hidden. It is a current-phase audit, not a claim that the broader thread goal is complete.
- Audited regression command: `npm.cmd run verify:goal-suite:audited` runs the browser-inclusive goal suite, starts the local Worker/Studio servers when their localhost health checks are not already reachable, writes `goal-suite.json`, then runs `audit:active-goal` as a post-check so the audit reads the completed suite artifact instead of stale or partial data. The standalone audit also verifies `goal_suite_started_service_ports_released`, so ports for suite-started services must be closed after cleanup.
- Worktree inventory: `data/review-artifacts/active-goal-worktree-inventory.json` records a path-only inventory for the active-goal coordination files plus broader Studio/Worker dirty-state summaries without reading secret file contents. It now includes `coordination_packaging_plan`, which warns cleanup/PR work to stage explicit coordination files only and not broad untracked parent directories. The completion audit requires `worktree_inventory_matches_latest_suite_window` and `active_goal_coordination_packaging_scope_safe`, so this inventory must be generated during the latest audited suite run and must not include secret-sensitive coordination paths.
- Package manifest: `data/review-artifacts/active-goal-package-manifest.json` is generated by `npm.cmd run audit:active-goal-package` after the worktree inventory. It hashes stable explicit coordination package files, runs a redacted secret-pattern scan over those stable files only, and writes `stage_command_preview` with explicit file-level `git add -- <file>` commands. Its `dependency_closure` adds every `package.json` script file reference plus `package-lock.json` to the recommended stable preview, so cleanup/PR work cannot stage npm script changes without the scripts and lockfile they need. The recommended default command stages stable code/docs only; generated evidence has a separate optional command. Volatile generated evidence files are recorded as existence-only because the audited suite rewrites them during the same run. The completion audit requires `active_goal_package_manifest_secret_scan_clean`; `.env` and other non-coordination secret paths are excluded from the scan and recorded only as path warnings by the worktree inventory.
- Cleanup package audit: `data/review-artifacts/cleanup-pr-package-audit.json` is generated by `npm.cmd run audit:cleanup-pr-package`. It is the final preview-only cleanup/PR package gate for the chosen coordination scope and verifies the current phase is green, the package manifest secret scan is clean, dependency closure is complete, generated evidence is optional rather than part of the stable command, and forbidden paths like `.env`, logs, broad parent directories, `src/`, and `supabase/` are not in the recommended coordination stage.
- Active infrastructure: `data/review-artifacts/active-goal-readiness.json` confirms Supabase project `asscnuntwtnyukwvcxbr`, required tables, Custom Worker as enabled/default, configured callback URL, worker health `ok`, and taxonomy migration accepted for normalized asset roles.
- Required asset triage: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/asset_requirement_triage_report.json`, `canonical_asset_requirements.json`, `asset_todo_list.json`, and `asset_todo_list.md` are the canonical deduped human-workflow artifacts. They currently contain 15 actionable requirements.
- Human-in-the-loop controls: `human_loop_completion_report.json` records required-first ordering and expected row controls: Search providers, Generate with AI, Show prompt, Copy prompt, Upload / Replace, Paste URL, Use existing approved asset, Fix timing, and Preview at timestamp.
- Prompt workflow: `asset_generation_prompts.json`, `external_generation_prompts.md`, and `single_asset_generation_audit.json` contain one prompt/audit entry per actionable requirement; these are for external or individual AI asset generation, not automatic approval.
- Basic in-app AI generation is now merged and verified. Studio PR #6 lets Review Assets request focused generated alternatives while preserving human review, and Worker PR #1 verifies the local `heygen_hyperframes` provider can produce MP4/PNG outputs with `checkStatus`/`downloadResult`. Production cloud/provider-backed HeyGen generation remains a separate hardening target.
- Mismatch and timing gates: `approved_asset_mismatch_report.json` is empty, `asset_timeline_fit_report.json` covers all 15 requirements, and `professional_readiness_summary.json` reports `professional_ready=true`, 0 mismatches, 0 timing problems, and valid RenderSpec.
- Browser proof: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/scene-review-smoke.json` verifies the live project UI with owner auth injection, 17 scene groups, 15 asset to-do cards, required row controls, prompt modal/copy, upload input, raw/debug access, professional readiness honesty, and biopsy-vs-India mismatch protection.
- Render proof: `benchmark_render_latest_verified.json` verifies the latest completed benchmark render without dispatching a duplicate job. It confirms Studio persisted completed status/progress/output, worker output HEAD `200 video/mp4`, local MP4 size 20,047,227 bytes, ffprobe H.264 1280x720 video, AAC stereo audio, and expected worker debug files.

## Active Backlog

### P0

- No required Phase 2F-G/G1 asset-readiness blocker remains for the Oral Cancer benchmark. Keep optional unresolved enhancement rows visible as non-blocking workflow tasks unless the next phase chooses to polish them.

### P1

- Keep the repeatable live browser smoke in the regression loop for real projects:
  `STUDIO_SMOKE_PROJECT_ID=... STUDIO_SMOKE_AUTH_MODE=admin_magiclink npm run smoke:scene-review`, or email/password env values when available.
- Keep `npm.cmd run verify:self-hosting` in the regression loop when changing auth, provider resolution, render provider settings, or local-runner configuration.
- Continue broader local pipeline verification on a real uploaded video when needed. Normal local-runner execution and deliberate keyless-provider behavior are verified.
- Decide and verify the next product phase after Phase 2F-G/G1. Basic local AI generation/review is accepted; remaining choices are production deployment hardening, the next render-quality acceptance target, or cloud/provider-backed AI generation hardening.

### P2

- Improve layout repair from metadata-only repair hints into a fuller deterministic scene-fit proposal, while keeping Studio as Director.
- Add lightweight tests around scene grouping and provider resolution if the existing test setup allows it without new infrastructure.

## Recent Progress

- Merged Studio PR #6 for the focused Review Assets AI generation workflow and Worker PR #1 for the local `heygen_hyperframes` AssetGenerationProvider path.
- Re-ran post-merge verification: `npm.cmd run verify:goal-suite:audited`, `npm.cmd run audit:active-goal`, and Worker `npm.cmd run verify:generation-provider` passed.
- Added the scene-centric Review Assets workspace.
- Added scene-level multi-asset approval and layout repair metadata flow.
- Collapsed raw/debug candidate lists by default.
- Added missing scene requirement actions: upload/replace, paste URL, reject, mark missing.
- Renamed and gated unsafe auto-pick behavior as `Auto-pick best safe candidate`.
- Made runtime AI provider resolution prefer self-hosted provider keys over legacy Lovable when saved settings still say `lovable`.
- Made job-runner token generation require `JOB_RUNNER_SECRET` explicitly instead of falling back to `LOVABLE_API_KEY`.
- Removed remaining Lovable Cloud-specific setup wording from Supabase env errors, render diagnostics, and render provider settings copy. The app now tells self-hosted users to set secrets in the local/deployment server environment.
- Added `supabase/migrations/20260624152000_self_hosted_ai_settings_defaults.sql` so fresh schemas default `ai_settings` to `gemini` for LLM and transcription providers while keeping Lovable available when explicitly configured.
- Added `npm run smoke:scene-review`, a Playwright email/password browser smoke that opens a supplied project, checks the Review Assets scene workspace, verifies scene groups exist, and writes screenshot/JSON artifacts under `data/review-artifacts/<project>/browser-smoke/`.
- Aligned provider resolver fallbacks with self-hosting: unspecified LLM/transcription provider preferences now default to `gemini`, while explicit `lovable` settings still work when `LOVABLE_API_KEY` is configured.
- Added `npm run verify:asset-taxonomy`, a Supabase admin probe that creates a temporary project, attempts normalized `assets.asset_type` inserts, cleans up, and writes `data/review-artifacts/asset-taxonomy/asset-taxonomy-probe.json` without printing secrets.

## Verification Snapshot

- `npm.cmd run typecheck` passed after the latest Studio edits.
- `npm.cmd run build` passed after the latest Studio edits.
- Fresh authenticated browser smoke passed against the disposable scene-review project using email/password login after allowing the auth route to hydrate before clicking sign-in.
- A disposable authenticated smoke project verified the Scene Asset Review UI through real email/password login.
- The smoke exposed and fixed hidden scene candidates that were mapped to a scene but not matched to a derived requirement; they now appear under `Other scene candidates`.
- Historical: live approval of the smoke `lower_third` candidate exposed the database constraint mismatch that led to the manual taxonomy migration. The active project has since been updated manually; current readiness reports `taxonomy_pending=false`.
- Studio still stores normalized asset roles in metadata while remaining compatible with legacy `assets.asset_type` values. The smoke `lower_third` approval persisted as `asset_type=overlay` with `metadata.normalized_asset_type=lower_third`, and the expanded remote taxonomy now accepts the normalized render roles used by Phase 2F-G.
- The scene repair/linking path no longer rebuilds the manifest after linking, because that erased `asset_id`/`asset_url`. The same single-row manifest fallback rule was verified against the smoke project and produced a ready manifest row with asset id and URL.
- `npm.cmd run typecheck` and `npm.cmd run build` passed after the latest fixes.
- The real Oral Cancer benchmark project RenderSpec was generated directly from Studio code and validated successfully. Artifact: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/active-goal-real-project-audit/benchmark-renderspec-validation.json`.
- Benchmark RenderSpec evidence: 15 assets, 8 tracks, 15 items, 11 graphics, 0 captions, 0 validation errors, 0 warnings. Presenter asset `source:presenter` has a signed source URL and a 107.285s presenter item.
- The six target layout/action rows are present in RenderSpec, including `show_lower_third`, `kinetic_typography`, `show_callout`, and `show_text_overlay`. URL-less text/CTA-style manifest rows are represented as inline `graphic`/text-compatible assets, which the validator allows.
- Fixed scene review manifest readiness so it counts the same renderable rows as the RenderSpec builder: approved URL/asset rows, compiled graphics, presenter video rows, and inline text/CTA actions. This prevents false "missing" scene status for renderable lower thirds, callouts, kinetic typography, and presenter rows.
- Benchmark manifest readiness probe after the fix: 15 total manifest rows, 15 renderable rows, 0 missing. Artifact: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/active-goal-real-project-audit/manifest-row-readiness-after-inline-fix.json`.
- `npm.cmd run typecheck` passed after the scene readiness predicate fix.
- Live Scene Asset Review approval smoke artifact: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/scene-review-ui-smoke.json`. It confirms the scene workspace, candidate, and approved strip render, with no `manifest mismatch` or missing-from-manifest warning after approval.
- Authoritative DB/RenderSpec smoke artifacts:
  - `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/scene-review-db-renderspec-after-approve.json`
  - `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/scene-review-current-manifest-after-approve.json`
  The approved candidate is linked to a DB-compatible `overlay` asset with `metadata.normalized_asset_type=lower_third`, current manifest has a ready row with `asset_url`, and RenderSpec validation remains OK with matching asset/item.
- Fixed `Approve + Fix Scene Layout` so multiple selected assets get distinct ready `render_manifest` rows instead of overwriting one scene row. The repair path now records layout repair metadata and allocates manifest rows for each approved asset.
- Multi-asset Scene Asset Review smoke passed:
  - seed artifact: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/multiasset-seed.json`
  - UI artifact: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/multiasset-ui-smoke.json`
  - screenshot: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/multiasset-after-approve-fix.png`
  - DB/RenderSpec artifact: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-scene-review-smoke/multiasset-db-renderspec-after-approve-fix.json`
  Evidence: 2 selected candidates approved, 2 assets created with `layout_repair.layout_name=doctor_with_infographic`, 2 current manifest rows ready with asset URLs, RenderSpec validation OK, 2 matching RenderSpec assets and 2 matching RenderSpec items.
- `npm.cmd run typecheck` passed after the multi-asset manifest allocation fix.
- Remote taxonomy constraint probe failed as expected before applying the latest migration: disposable `assets.asset_type=lower_third` insert was rejected by `assets_asset_type_check` with Postgres code `23514`. Artifact: `data/review-artifacts/f5f0c7cf-2512-4f0d-a7f1-32b0e67296c5/active-goal-taxonomy/remote-asset-taxonomy-probe.json`.
- Supabase CLI is installed but not authenticated in this Windows profile; `supabase.cmd projects list --debug` reports missing `C:\Users\LENOVO\.supabase\profile`. `.env` has Supabase URL/anon/service-role values but no direct database password/connection string for DDL.
- Regenerated `supabase/combined_manual_migration.sql` from all 22 migration files in chronological order. It now includes `20260624143000_expand_assets_asset_type_taxonomy.sql` at the end, so running the combined file or the single latest migration in Supabase Dashboard SQL Editor will update the taxonomy constraint.
- Local/self-hosted pipeline runner probe passed with configured `JOB_RUNNER_SECRET` and Gemini:
  - latest pointer: `data/review-artifacts/active-goal-local-runner-latest.json`
  - project artifact: `data/review-artifacts/b9c3c5ec-8cc3-4258-a815-bb24f05e417a/active-goal-local-runner/local-runner-transcript-probe.json`
  Evidence: public runner endpoint returned `task:chapters`, created 1 `pipeline_runs` row, completed `task_executions.chapters` with provider `gemini` / model `google/gemini-2.5-pro`, and started `scene_plan`.
- Deliberately keyless provider probe passed:
  - latest pointer: `data/review-artifacts/active-goal-keyless-provider-latest.json`
  - project artifact: `data/review-artifacts/32343042-2e66-49ed-ac16-19b265b4e53b/active-goal-local-runner/keyless-provider-probe.json`
  Evidence: with Gemini/OpenAI/Groq/OpenRouter/Anthropic/DeepSeek/Lovable env keys removed and user provider keys emptied for the isolated run, task attempts recorded the clear message `No LLM provider key configured. Add GEMINI_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY...`; `chapters` then completed via deterministic fallback with provider `fallback` / model `deterministic`.
- Self-hosting cleanup verification passed:
  - `Select-String` found no remaining `Connect Supabase in Lovable Cloud` / `Lovable Cloud secrets` wording in scanned `src`, `supabase`, `docs`, or `.env.example` files.
  - `supabase/combined_manual_migration.sql` was regenerated from 23 migrations and includes both `20260624143000_expand_assets_asset_type_taxonomy.sql` and `20260624152000_self_hosted_ai_settings_defaults.sql`.
  - `npm.cmd run typecheck` passed.
  - `npm.cmd run build` passed; warnings are existing Vite/TanStack deprecation and plugin timing warnings.
- Browser smoke tooling verification passed:
  - `node --check scripts/scene-review-smoke.mjs` passed.
  - `npm.cmd run typecheck` passed.
  - `npm.cmd run build` passed; warnings are existing Vite/TanStack deprecation and plugin timing warnings.
  - Live execution still requires a running Studio server and explicit `STUDIO_SMOKE_EMAIL`, `STUDIO_SMOKE_PASSWORD`, and `STUDIO_SMOKE_PROJECT_ID` values.
- Self-hosted provider resolver verification passed:
  - no remaining `preferred ?? "lovable"` fallback was found in scanned Studio source.
  - `npm.cmd run typecheck` passed.
  - `npm.cmd run build` passed; warnings are existing Vite/TanStack deprecation and plugin timing warnings.
- Repeatable taxonomy probe verification added and run:
  - `node --check scripts/verify-asset-taxonomy.mjs` passed.
  - `npm.cmd run typecheck` passed.
  - `npm.cmd run build` passed; warnings are existing Vite/TanStack deprecation and plugin timing warnings.
  - `npm run verify:asset-taxonomy` currently fails against active project `asscnuntwtnyukwvcxbr` as expected because the remote constraint still rejects all 7 normalized asset types with Postgres code `23514`.
  - Fresh artifact: `data/review-artifacts/asset-taxonomy/asset-taxonomy-probe.json`; cleanup of temporary project/assets reported `ok`.
- Disposable Scene Asset Review fixture tooling added and verified:
  - `npm run seed:scene-review-smoke` creates a temporary auth user, project, scene, manifest row, and candidate with no secrets printed.
  - Smoke fixture artifact: `data/review-artifacts/scene_review_smoke_1782314436265_mtlyk8/scene-review-smoke-fixture.json`.
  - Smoke project id: `4e56e4d7-b456-4af2-86a3-fe72f8efdc0c`.
- Live browser Scene Asset Review smoke passed against the disposable fixture after two verifier fixes:
  - The smoke runner now captures console, page errors, failed requests, interesting serverFn responses, localStorage Supabase keys, and body text on failure.
  - It uses direct Supabase email/password auth fallback when the UI login remains on `/auth`, without printing credentials.
  - It asserts the exact `Scene Asset Review` heading and recognizes the actual `Rejected / Debug candidates` section label.
  - Passing artifact: `data/review-artifacts/4e56e4d7-b456-4af2-86a3-fe72f8efdc0c/browser-smoke/scene-review-smoke.json`.
  - Passing screenshot: `data/review-artifacts/4e56e4d7-b456-4af2-86a3-fe72f8efdc0c/browser-smoke/scene-review-smoke.png`.
- Fixed a local self-hosting auth mismatch: `src/integrations/supabase/auth-middleware.ts` now falls back from `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` to the already configured Vite-prefixed Supabase URL/key values. Without this, browser auth succeeded but server functions returned encoded `Missing Supabase environment variable(s): SUPABASE_URL` errors and project pages stayed on `Loading...`.
- Historical blocker note: the remote taxonomy constraint previously rejected expanded layout-role asset types, and this repository still keeps `supabase/pending_remote_taxonomy_migration.sql` plus `docs/pending-supabase-taxonomy-migration.md` as the manual handoff record. That blocker is superseded by the 2026-06-26 checkpoint above; active verification now reports the migration applied and taxonomy pending false.
- Added consolidated readiness and Phase 2F-G verification commands:
  - `npm.cmd run audit:active-goal`
  - `npm.cmd run audit:active-goal-worktree`
  - `npm.cmd run verify:active-goal`
  - `npm.cmd run verify:self-hosting`
  - `npm.cmd run verify:goal-suite`
  - `npm.cmd run verify:goal-suite:audited`
  - `npm.cmd run verify:goal-suite:e2e`
  - `npm.cmd run verify:goal-suite:full`
  - `npm.cmd run verify:phase2fg`
  - `npm.cmd run verify:phase2fg-render-latest`
  - `npm.cmd run smoke:phase2fg-ui`
  - `npm.cmd run smoke:scene-review`
- Latest active-goal readiness evidence:
  - `ready=true`
  - `project_ref=asscnuntwtnyukwvcxbr`
  - `blockers=[]`
  - `worker_status=ok`
  - `taxonomy_pending=false`
  - artifact: `data/review-artifacts/active-goal-readiness.json`
- Latest self-hosting audit evidence:
  - `data/review-artifacts/self-hosting/self-hosting-audit.json`: `ready=true`, failures `[]`, warning `legacy_lovable_auth_integration_present` only. The warning is non-blocking because `src/integrations/lovable/index.ts` exists but no app route imports it.
  - The transcription provider copy was cleaned up for self-hosted users: missing Lovable key now says to set `LOVABLE_API_KEY` or switch to Gemini/OpenAI/Groq, and quota exhaustion now recommends configured self-hosted providers before optional Lovable gateway.
- Worker status warning audit: `worker_status` is only the `/health` probe result from `verify:active-goal` with a 5s timeout. Current run reports `worker_status=ok`, HTTP 200, `mode=real-layout-aware`, and `secret_configured=true`; no fulfillment/search/scoring/render blocker remains from that previous warning.
- Latest Phase 2F-G evidence:
  - artifact directory: `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1`
  - `benchmark_optional_broll_mismatch_repair.json`: repaired the remaining doctor lower-third/contextual b-roll mapping by replacing internal/template asset `82609bf8-b485-41e0-a0e7-45c6a5334b37` with existing approved Pexels `broll_video` asset `d60b38be-a4ff-4782-bd27-9da84c5eeaae` for manifest row `93374260-2c13-4aac-b150-017f3ae7955e` and timeline item `5cbfefc7-0df9-4e99-ac5b-1e5ae92368cf`. The replacement URL probes as HTTP 206 `video/mp4`.
  - `professional_readiness_summary.json`: professional ready is true, 13/13 required assets resolved, 0 required unresolved, 0 mismatches, 0 timing problems, RenderSpec valid.
  - `approved_asset_mismatch_report.json`: empty after the Pexels b-roll remap. Biopsy/oral lesion requirements still do not accept the India prevalence map.
  - `human_loop_completion_report.json`: actionable required items first and all expected controls recorded. Optional unresolved items remain non-blocking, but mapped approved-asset mismatches are still treated as professional-readiness blockers.
  - `ui-smoke/phase2fg-ui-smoke.json`: all UI checks passed, including `mismatch_visible_if_present` with expected mismatch count 0 and `professional_readiness_not_false_green` with professional readiness expected true. Request failures are non-blocking dev-server aborts plus browser blocks for external raw/debug previews; no page errors or console errors were recorded, and signed URL query tokens are redacted in the artifact.
- Latest real-project Scene Review smoke:
  - `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/scene-review-smoke.json`: passed with `scene_asset_review_visible=true`, `scene_groups_present=true`, `asset_todo_cards_present=true` (`count=15`), `required_row_controls_present=true`, `prompt_modal_opens=true`, `copy_prompt_copies_text=true`, `biopsy_does_not_show_india_map_as_valid_asset=true`, `professional_readiness_not_false_green=true`, and `raw_debug_section_present=true`.
  - The same smoke now reads `professional_readiness_summary.json`; latest run verifies `professional_ready=true`, `mismatch_count=0`, and `timing_problem_count=0`.
  - The smoke can authenticate without stored test passwords by generating and consuming an admin magic-link session for the real project owner using the local service-role key; full tokens and email are not written to artifacts.
- Latest implementation cleanup:
  - Review Assets now derives its actionable todo list from canonical `render_manifest` rows instead of stale candidate-only rows, while keeping raw/debug candidates accessible.
  - Review Assets now shows loading/error states for `listAssetReview`, uses an id-gated query instead of a client-only `typeof window` guard, and avoids the previous false empty-state while the review payload is still loading.
  - Review Assets compacts heavy candidate metadata and builds a bounded live review candidate pool for the scene workflow; raw/debug artifacts remain exportable and the UI reports both shown and raw candidate counts.
  - Review Assets refreshes URLs only for manifest-mapped assets instead of recursively re-signing the entire raw/debug payload.
  - Fixed the Asset To-Do upload control label so rows without a primary candidate id do not compare `null === null` and display a false `Uploading...` state; the row now shows the required `Upload / Replace` label unless a real candidate upload is active.
  - Client server-function auth now has a localStorage fallback for Supabase auth tokens so browser-triggered server functions attach the bearer token reliably.
  - The Phase 2F-G UI smoke clears local/session storage before injecting its test auth session, avoiding stale client-state contamination.
  - The project route has a local type cast for grouped asset entries, clearing `tsc --noEmit`.
- Latest verification:
  - `npm.cmd run audit:active-goal` passed and wrote `data/review-artifacts/active-goal-completion-audit.json` with `status=current_phase_verified` and `all_required_checks_passed=true`. This audits the current Phase 2F-G/G1 coordination state, not the broader thread goal completion.
  - `npm.cmd run typecheck` passed.
  - `npm.cmd run verify:self-hosting` passed with the non-blocking legacy Lovable integration warning.
  - `npm.cmd run verify:active-goal` passed after the self-hosting audit addition.
  - `npm.cmd run verify:goal-suite` passed and wrote `data/review-artifacts/goal-suite/goal-suite.json`. The suite runs active-goal readiness, self-hosting audit, Phase 2F-G workflow verification, latest render evidence, worker typecheck/build from `C:\Users\LENOVO\Documents\medvideo-render-worker`, and Studio typecheck in one command; set `GOAL_SUITE_INCLUDE_BUILD=1` to include Studio build.
  - `npm.cmd run verify:goal-suite:audited` passed and wrote `data/review-artifacts/goal-suite/goal-suite.json` with `include_browser=true`, `run_completion_audit=true`, and a passed `active_goal_completion_audit` post-check. The suite auto-started local Worker and Studio servers for the HTTP/browser checks, then cleaned up those suite-started processes.
  - `npm.cmd run verify:goal-suite:e2e` passed and wrote `data/review-artifacts/goal-suite/goal-suite.json` with `include_browser=true`. The e2e suite passed all 9 steps: active-goal readiness, self-hosting audit, Phase 2F-G workflow, latest render evidence, worker typecheck, worker build, Studio typecheck, Phase 2F-G UI smoke, and real-project Scene Review browser smoke.
  - `npm.cmd run verify:goal-suite:full` passed and wrote `data/review-artifacts/goal-suite/goal-suite.json` with `include_build=true`. The full suite passed all 8 steps: active-goal readiness, self-hosting audit, Phase 2F-G workflow, latest render evidence, worker typecheck, worker build, Studio typecheck, and Studio build.
  - `npm.cmd run build` passed.
  - `npm.cmd run verify:phase2fg` passed after the Pexels b-roll remap; it now reports `professional_ready=true`, `required_unresolved=0`, `mismatch_count=0`, and `render_spec_valid=true`.
  - `npm.cmd run smoke:scene-review` passed against project `24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99`.
  - `GET http://localhost:8788/health` returned `ok=true`, `mode=real-layout-aware`, and `secret_configured=true`.
  - Worker `npm.cmd run typecheck` passed after the video-overlay timing fix.
  - Worker `npm.cmd run build` passed after the video-overlay timing fix.
  - Studio `npm.cmd run typecheck` passed after the final Phase 2F-G script/artifact changes.
  - Studio `npm.cmd run build` passed after the final Phase 2F-G script/artifact changes; warnings remain existing Vite/TanStack deprecation/plugin timing warnings.
  - `npm.cmd run smoke:phase2fg-render` produced completed render job `bf84cb89-f03d-40e6-bac7-7dfee3f0951f` / provider job `cw_preview_1782490897297_8sfln2` and wrote `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/benchmark_render_bf84cb89-f03d-40e6-bac7-7dfee3f0951f.json`. The shell wrapper timed out at 10 minutes, but the artifact and Supabase rows show completed status, callback progress 100, output URL persisted, HTTP HEAD 200 `video/mp4`, local file size 20,047,227 bytes, ffprobe H.264 1280x720 plus AAC stereo, duration 107.285s.
  - Worker debug artifact `data/debug/cw_preview_1782490897297_8sfln2/normalized_render_plan.json` contains the repaired `asset:d60b38be-a4ff-4782-bd27-9da84c5eeaae` video at 82-89s with `layout=pip_left`, `trackKind=broll`; `downloaded_assets.json` shows it downloaded as MP4 and was not skipped.
  - `scripts/phase2fg-dispatch-benchmark-render.mjs` now forces a flushed process exit after writing render evidence, so successful renders do not remain alive because of imported server/client handles. It also supports `PHASE2FG_VERIFY_LATEST_ONLY=1` to verify the latest completed benchmark render without dispatching a duplicate job.
  - `PHASE2FG_VERIFY_LATEST_ONLY=1 node scripts\phase2fg-dispatch-benchmark-render.mjs` passed and wrote `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/benchmark_render_latest_verified.json` with completed status, output HEAD 200 `video/mp4`, ffprobe H.264/AAC, and expected worker debug files.
  - Added `npm.cmd run verify:phase2fg-render-latest` as the repeatable no-dispatch render evidence command; it passed and verifies the same completed render/output/debug artifact without launching another worker render.
  - `npm.cmd run smoke:phase2fg-ui` passed after the regenerated artifacts; all UI checks remain green, with mismatch count 0.
