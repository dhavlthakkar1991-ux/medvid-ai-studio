# Active Goal Inventory

Last updated: 2026-06-27

This file is the small handoff index for the combined active goal:

> there are multiple active / pending prompts triggered inside this workspace currently. to avoid chaos, combine them into a goal and work towards it

It does not replace `docs/active-medvideo-goal.md`. That file is the fuller narrative. This file is the quick inventory of current coordination assets and verification commands.

## Current Verified Command

Use this as the one-command current-phase regression:

```powershell
npm.cmd run verify:goal-suite:audited
```

Latest result:

- `ready=true`
- `include_browser=true`
- `run_completion_audit=true`
- Worker HTTP preflight passed and was started by the suite.
- Studio dev-server preflight passed and was started by the suite.
- `active_goal_worktree_inventory` post-check passed.
- `cleanup_pr_package_audit` post-check passed.
- `active_goal_completion_audit` post-check passed.
- `worktree_inventory_matches_latest_suite_window` passed, so the path-only worktree inventory was generated during the latest audited suite run rather than reused from an older handoff.
- The suite runner exits explicitly after writing the final summary and stopping suite-started services, so shell success/failure should match the `ready` value in `goal-suite.json`.
- Studio dev-server preflight probes Vite's `@vite/client` endpoint for server readiness; app-route correctness is still verified by the browser smoke checks.
- Suite-started service cleanup records an `ok` field, so already-exited Windows process parents do not look like live leftover servers merely because `taskkill` returns a nonzero code.
- Standalone `audit:active-goal` enforces `goal_suite_started_service_ports_released`, so ports for suite-started Studio/Worker services must be closed after cleanup.
- Coordination artifacts are written through temp-file replacement, so interrupted runs should not leave half-written JSON handoff files.
- `audit:active-goal` starts with `active_goal_json_inputs_parseable`, which reports any missing or malformed evidence JSON explicitly before interpreting downstream checks.
- `audit:active-goal` requires `active_goal_temp_artifacts_absent`, which fails if temp-file replacement leaves any `*.tmp` evidence files under `data/review-artifacts`.
- `audit:active-goal` writes a compact `handoff_summary` inside `active-goal-completion-audit.json`, so the current phase status, guardrails, key artifacts, key commands, and next open decision can be read without scanning the full checks array.
- `audit:active-goal-worktree` writes a `coordination_packaging_plan` inside `active-goal-worktree-inventory.json`. It is path-only, does not read secret contents, and tells cleanup/PR work to stage explicit coordination file paths only instead of staging broad untracked parent directories like `scripts/`, `docs/`, or `data/`.
- `audit:active-goal-package` writes `active-goal-package-manifest.json`, a preview-only package manifest with file hashes, a redacted secret-pattern scan over stable explicit coordination files only, and `stage_command_preview` with explicit `git add -- <file>` commands. Its `dependency_closure` adds every `package.json` script file reference plus `package-lock.json` to the recommended stable preview, so cleanup/PR work cannot stage npm script changes without the scripts and lockfile they need. Its recommended default command stages stable code/docs only; generated evidence has a separate optional command. Volatile generated evidence files are recorded as existence-only because the audited suite rewrites them during the same run. It does not stage files and does not read `.env`.
- `audit:cleanup-pr-package` writes `cleanup-pr-package-audit.json`, the final preview-only cleanup/PR package gate for the chosen coordination scope. It verifies the current phase is green, the package manifest secret scan is clean, dependency closure is complete, generated evidence is optional rather than part of the stable command, and forbidden paths like `.env`, logs, broad parent directories, `src/`, and `supabase/` are not in the recommended coordination stage.
- `audit:active-goal` requires `active_goal_coordination_packaging_scope_safe`, which fails if the coordination packaging plan is missing or if a secret-sensitive path becomes part of the coordination stage scope.
- `audit:active-goal` also requires `active_goal_package_manifest_secret_scan_clean`, so the explicit coordination package must exist, all listed files must be present, and the scoped secret scan must be clean.
- The audit now includes this inventory as an informational guardrail check.
- When `audit:active-goal` runs inside `verify:goal-suite:audited`, the suite appends that post-check after the audit process exits; the audit artifact records this lifecycle explicitly in `audit_context`.

Primary artifacts:

- `data/review-artifacts/goal-suite/goal-suite.json`
- `data/review-artifacts/active-goal-completion-audit.json` (`handoff_summary` is the compact machine-readable handoff inside this file)
- `data/review-artifacts/active-goal-worktree-inventory.json`
- `data/review-artifacts/active-goal-package-manifest.json`
- `data/review-artifacts/cleanup-pr-package-audit.json`

## Current-Phase Scope

The current verified phase is Phase 2F-G/G1 coordination:

- Required Asset Triage
- Human-in-the-Loop Completion Workflow
- Individual AI Asset Prompt Workflow
- Timeline Fit Correction
- Professional readiness honesty
- Scene Review browser smoke
- Latest render evidence

The audit status is `current_phase_verified`, not broad thread-goal completion.

## Intended Coordination Files

These files are part of the active-goal coordination layer:

- `docs/active-medvideo-goal.md`
- `docs/active-goal-inventory.md`
- `docs/phase-2g-render-quality-acceptance.md`
- `scripts/verify-goal-suite.mjs`
- `scripts/audit-active-goal-completion.mjs`
- `scripts/audit-active-goal-worktree.mjs`
- `scripts/audit-active-goal-package.mjs`
- `scripts/audit-cleanup-pr-package.mjs`
- `scripts/phase2g-render-quality-verifier.mjs`
- `package.json` scripts:
  - `audit:active-goal`
  - `audit:active-goal-worktree`
  - `audit:active-goal-package`
  - `audit:cleanup-pr-package`
  - `verify:active-goal`
  - `verify:self-hosting`
  - `verify:goal-suite`
  - `verify:goal-suite:audited`
  - `verify:goal-suite:e2e`
  - `verify:goal-suite:full`
  - `verify:phase2fg`
  - `verify:phase2fg-render-latest`
  - `verify:phase2g-render-quality`
  - `smoke:phase2fg-ui`
  - `smoke:scene-review`
- `audit:active-goal` verifies the expected active-goal npm scripts are still registered.
- `audit:active-goal` verifies this inventory mentions the expected active-goal npm scripts.
- `audit:active-goal` verifies `worktree_inventory_matches_latest_suite_window`, which ties the worktree inventory timestamp to the latest audited suite window.

Generated evidence:

- `data/review-artifacts/goal-suite/goal-suite.json`
- `data/review-artifacts/active-goal-completion-audit.json`
- `data/review-artifacts/active-goal-worktree-inventory.json`
- `data/review-artifacts/active-goal-package-manifest.json`
- `data/review-artifacts/cleanup-pr-package-audit.json`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2fg-g1/*`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/phase-2g-render-quality/*`
- `data/review-artifacts/24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99/browser-smoke/*`

## Current Open Decision

Do not mark the broad active goal complete from this evidence alone. The current phase is verified, but the broader thread contains many product phases and accumulated repository changes. The next useful decision is which verified phase to pursue next, such as:

- first production deployment hardening,
- next render-quality phase,
- cloud/provider-backed AI generation hardening,
- or cleanup/PR packaging of the already verified coordination layer.

## Pending Phase Backlog

This is the active/pending prompt inventory as of the latest audited coordination pass:

| Item | Status | Current evidence | Entry criteria | Next action | Verification expectation |
| --- | --- | --- | --- | --- | --- |
| Phase 2F-G/G1 required asset triage and human-in-loop readiness | `current_phase_verified` | `verify:goal-suite:audited` and `audit:active-goal` pass for the Oral Cancer benchmark. | Active-goal readiness, Phase 2F-G workflow, browser smoke, and latest render evidence are green. | Keep in regression while choosing the next product phase. | `npm.cmd run verify:goal-suite:audited`; `npm.cmd run audit:active-goal`. |
| Production deployment hardening | `pending_next_phase` | Self-hosting audit and local Studio/Worker checks pass; public HTTPS VPS deployment is not covered by the current audit. | Public HTTPS Studio URL, public HTTPS Worker URL, matching `CUSTOM_WORKER_SECRET`, Supabase env, and storage access are available. | Verify public Worker URL, public Studio callback URL, matching secrets, storage access, and remote health/render dispatch. | Run self-hosting audit, active-goal readiness against public provider config, worker `/health` over HTTPS, one Studio-to-Worker dispatch, callback persistence, output HEAD, and ffprobe. |
| Next render-quality phase | `evidence_generated_needs_review` | Latest benchmark MP4 is ffprobe-valid and persisted; `docs/phase-2g-render-quality-acceptance.md` defines the target; `npm.cmd run verify:phase2g-render-quality` now generates frame/contact-sheet evidence and reports `NEEDS_HUMAN_REVIEW_OR_SMALL_FIXES`. The 01:21 oral-exam classification is repaired, warning-patches are evaluated at 00:48, and the 01:39 CTA now passes automated quality checks. | Use the Phase 2G report before changing renderer or layout behavior. | Review the Phase 2G contact sheet and fix only the remaining concrete failed scenes: 00:20 license/source safety, clinical human-review gates, and 01:21 Pexels/source-safety review. | Re-run `npm.cmd run verify:phase2g-render-quality`; require technical checks green, all scenes pass or have explicit human-approved clinical review, Studio persistence, ffprobe, and output URL evidence. |
| Cloud/provider-backed AI asset generation hardening | `pending_next_phase` | Basic local generation/review is merged and verified: Studio PR #6 adds focused Review Assets generation controls, Worker PR #1 adds the `heygen_hyperframes` local HyperFrames provider, and `npm.cmd run verify:generation-provider` proves MP4/PNG output plus `checkStatus`/`downloadResult`. This does not yet prove production cloud HeyGen generation. | Cloud provider credentials, cost/safety boundaries, output hosting, and review-gating rules are explicit. | Verify a cloud/provider-backed generation run from a requirement row without bypassing human review, licensing, or Studio-as-Director constraints. | Generate one cloud-backed asset from a requirement row, store prompt/provider/model/cost/result metadata, show it in Review Assets, approve or reject through human review, then prove Manifest/RenderSpec mapping only after approval. |
| Cleanup and PR packaging | `pending_next_phase` | Path-only worktree inventory exists, but the repository still contains accumulated dirty changes from many phases. | A specific PR scope is chosen, unrelated dirty files are inventoried but not reverted, and secrets/artifacts are excluded. | Separate coordination changes from product changes before staging, committing, or opening PRs. | Run worktree inventory, diff review, secret scan for staged files, focused tests for the chosen scope, then commit/push/PR only that scope. |

## Caution

The Studio worktree is intentionally dirty from many prior phases. Treat `git status` as a mixed inventory, not as a list of only current-turn edits. Do not revert unrelated files without explicit user instruction.
