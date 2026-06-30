# Codex Asset Pack Workflow

This workflow moves final asset generation out of the Worker primary path.
Studio remains the director: render manifest rows and asset candidates define
the intent. Codex generates the final raster/video assets, then Studio imports
them as normal approved media.

## Export Briefs

After the project has a render manifest and Codex handoff candidates:

```bash
npm run codex:asset-pack:export -- --project-id <project_id>
```

Output goes to:

```text
data/codex-asset-packs/<project_id>/
```

Key files:

- `codex_asset_pack.json`
- `imagegen_prompts.md`
- `hyperframes_prompts.md`
- `codex_asset_import_template.json`

## Generate Assets

Use Codex ImageGen for still/raster assets from `imagegen_prompts.md`.
Use HyperFrames for b-roll/video assets from `hyperframes_prompts.md`.

Primary workflow rules:

- Use PNG, WebP, JPG, or MP4 outputs.
- Do not use SVG outputs.
- Do not generate or approve invented medical facts.
- Use Studio-approved narration, labels, and timeline intent only.

## Import Generated Assets

Edit `codex_asset_import_template.json` so each row has either:

- `local_path`: path to a generated PNG/WebP/JPG/MP4 file, or
- `source_url`: URL to generated media.

Dry-run:

```bash
npm run codex:asset-pack:import -- --file data/codex-asset-packs/<project_id>/codex_asset_import_template.json
```

Apply:

```bash
npm run codex:asset-pack:import -- --file data/codex-asset-packs/<project_id>/codex_asset_import_template.json --apply
```

The importer:

- rejects SVG files,
- uploads local files to the existing `videos` bucket,
- inserts approved `assets` rows,
- links `asset_candidates`,
- updates matching `render_manifest` rows to `ready`.

No database schema changes are required.
