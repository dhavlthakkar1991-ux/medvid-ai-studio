## Problem

Gemini 2.5 Pro is returning `"NaN"` (and sometimes `"mm:ss"` strings) for `start_time` / `end_time` inside `edit_actions`. The schema uses `z.coerce.number()`, which turns `"NaN"` into the JS `NaN` and fails Zod validation. The whole `editorial_decisions` task then errors out instead of degrading gracefully.

## Fix (schema-level, minimal surface)

Edit only `src/lib/ai/schemas.ts` — `EditorialDecisionsSchema`:

1. Replace `z.coerce.number()` on `start_time` and `end_time` with a `z.preprocess` that:
   - Accepts numbers as-is.
   - Parses `"mm:ss"` / `"hh:mm:ss"` strings into seconds.
   - Parses plain numeric strings.
   - Returns `undefined` for `"NaN"`, `null`, empty string, or unparseable input (so Zod can apply a default rather than crash).
2. Wrap the resulting `z.number()` with `.default(0)` for `start_time` and a non-negative number for `end_time`.
3. Add a `.transform` at the object level that, if `end_time <= start_time`, sets `end_time = start_time + 2` (sane default duration) so we never persist zero-length actions.
4. Add a final `.array(...).superRefine` (or `.transform` + filter) that drops any item where times still couldn't be derived, so partial AI failures don't kill the entire task.

## Defense in depth (runner)

In `src/lib/analysis-runner.server.ts`, inside the `editorial_decisions` branch (only — do not touch other tasks):
- After parse, if `edit_actions.length === 0`, log a warning and skip the manifest rebuild instead of throwing. The Editorial tab will remain on the previous version.

No DB migration, no UI change, no other task affected.

## Files touched

- `src/lib/ai/schemas.ts` (EditorialDecisionsSchema only)
- `src/lib/analysis-runner.server.ts` (post-parse guard in the `editorial_decisions` branch)

## Out of scope

- No prompt rewrite, no model swap, no retry loop for this pass (we can add a single retry later if empty results become common).
- No changes to other task schemas, normalization, timeline compiler, or render manifest.
