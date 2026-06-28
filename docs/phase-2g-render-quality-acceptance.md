# Phase 2G Render Quality Acceptance Target

This document defines the next render-quality target before any new renderer, Worker, or Studio behavior changes.

It is intentionally an acceptance brief, not an implementation plan. Studio remains the Director, the Worker remains the fulfillment/rendering agent, and no provider contract or database schema change is implied by this document.

## Baseline Evidence

Benchmark project:

- Project: `24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99`
- Title: Oral Cancer: Signs You Should Never Ignore
- Current verified render job: `bf84cb89-f03d-40e6-bac7-7dfee3f0951f`
- Current verified provider job: `cw_preview_1782490897297_8sfln2`
- Current verified output: `C:\Users\LENOVO\Documents\medvideo-render-worker\data\outputs\cw_preview_1782490897297_8sfln2.mp4`

Current green technical evidence:

- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/professional_readiness_summary.json`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/asset_todo_list.md`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/benchmark_render_latest_verified.json`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/scene-review-smoke.json`

The baseline proves technical readiness:

- 15 actionable requirements exist.
- 13 required requirements are resolved.
- 0 required requirements are unresolved.
- Approved asset mismatches are clean.
- Timeline fit is clean.
- RenderSpec is valid.
- Studio persisted completed render output.
- Output is HTTP-accessible as `video/mp4`.
- ffprobe reports H.264 video, AAC audio, 1280x720, and 107.285 seconds.

The baseline does not prove final human-grade visual quality. Phase 2G exists to verify and improve that layer.

## Target Scenes

Phase 2G must evaluate these benchmark moments:

| Time | Required intent | Expected visual behavior |
| --- | --- | --- |
| `00:05` | India oral-cancer prevalence / awareness | A polished India-specific visual, map, or stat card using only approved wording; no invented numbers. |
| `00:20` | Tobacco / gutkha risk | Contextual tobacco/gutkha visual or b-roll that is relevant to the Indian oral-cancer risk context; no generic unrelated lifestyle stock. |
| `00:36` | Non-healing oral ulcer | Clinically appropriate oral ulcer visual, review-gated and not cartoonish. |
| `00:43` | Leukoplakia / erythroplakia / warning patches | Accurate white/red patch or warning-sign visual if Studio-approved content exists; otherwise clear non-fabricated educational text, not invented pathology. |
| `00:59` | Neck node warning sign | Cervical lymph node visual that clearly communicates neck lump risk without misleading anatomy. |
| `01:21` | Oral exam / biopsy workflow | Professional workflow diagram or consultation/exam visual that matches the narration and approved labels. |
| `01:39` | CTA / awareness close | Clean branded CTA or awareness card, readable and not visually generic. |

## Pass Criteria

Every target scene must be scored from actual rendered frames, not only from database records or RenderSpec metadata.

Per-scene pass requires:

- Intent fidelity >= 85
- Medical relevance >= 85
- Visual quality >= 80
- Label accuracy >= 90
- Source safety >= 80
- Professional polish >= 80
- No unsafe license issue
- No misleading medical label
- No placeholder watermark
- No generic SVG/card substitute for clinical or anatomy visuals unless explicitly approved as an educational reconstruction

Whole-phase pass requires:

- All required target scenes pass.
- Presenter remains visible whenever the layout requires it.
- Presenter audio remains present and intelligible.
- No target scene has broken, black, distorted, stretched, or missing media.
- Output remains H.264/AAC MP4.
- Output URL returns HTTP 200 with `video/mp4`.
- Studio persists `render_jobs.status=completed`, `progress_percent=100`, `provider_job_id`, `render_outputs.file_url`, `duration_seconds`, and `file_size`.
- Worker debug artifacts include the normalized render plan, downloaded asset map, FFmpeg command/stderr, output probe, and any asset-quality or license audit artifacts available for the run.

## Required Evidence

Phase 2G must produce a new evidence folder:

`data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2g-render-quality/`

Required artifacts:

- `render_quality_report.json`
- `render_quality_report.md`
- `frame_grabs/0005.png`
- `frame_grabs/0020.png`
- `frame_grabs/0036.png`
- `frame_grabs/0043.png`
- `frame_grabs/0059.png`
- `frame_grabs/0121.png`
- `frame_grabs/0139.png`
- `quality_contact_sheet.png`
- `renderspec_asset_map.json`
- `studio_persistence_check.json`
- `worker_debug_artifact_check.json`
- `ffprobe.json`

The JSON report must include, per target scene:

- `time`
- `narration_excerpt`
- `storyboard_intent`
- `layout_intent`
- `asset_id`
- `asset_type`
- `source_url_present`
- `source_domain`
- `license_status`
- `approval_status`
- `intent_fidelity_score`
- `medical_relevance_score`
- `visual_quality_score`
- `label_accuracy_score`
- `source_safety_score`
- `professional_polish_score`
- `pass`
- `failure_reason`
- `remaining_gap`

## Failure Rules

Phase 2G fails if any required target scene:

- Uses Pexels/Pixabay or generic stock for pathology, anatomy, biopsy, surgical, or diagnosis diagrams.
- Shows a generic dental-cleaning or cosmetic-dentistry asset for oral cancer pathology.
- Invents labels, statistics, or medical claims not present in Studio-approved content.
- Has an approved asset in Studio that does not reach RenderSpec or the Worker render plan.
- Has a RenderSpec asset URL that cannot be downloaded by the Worker.
- Renders a placeholder, watermark, blank frame, or unreadable text.
- Passes only because the pipeline completed.

## Second-Topic Regression

To prove the quality rules are not oral-cancer-specific, Phase 2G should run a smaller second-topic regression when a second real project is available.

Minimum second-topic evidence:

- One real project id.
- Three target scenes.
- RenderSpec validity.
- MP4 validity.
- Per-scene visual scores.
- A statement confirming no oral-cancer-specific hardcoding was used.

## Non-Goals

Do not start these until Phase 2G evidence shows the specific need:

- New provider architecture
- New database schema
- New Studio render contract
- Full UI redesign
- Transitions or animation engine redesign
- Multi-audio mixing
- Cloud deployment work
- Automatic approval of generated clinical assets

## Recommended Next Action

Implement a Phase 2G verifier that reads the latest completed render, extracts the target frames, writes the evidence artifacts listed above, and records honest pass/fail scores. Only after that verifier identifies concrete visual failures should renderer or asset-fulfillment code change.
