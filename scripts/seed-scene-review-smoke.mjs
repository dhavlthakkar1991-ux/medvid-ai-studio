#!/usr/bin/env node

const message = {
  ok: false,
  retired: true,
  script: "seed-scene-review-smoke",
  reason:
    "This helper previously seeded a generated lower-third fixture. The primary asset workflow now exports Codex generation tasks and imports reviewed raster/video assets.",
  replacement: {
    export: "npm run codex:asset-pack:export -- --project <project-id>",
    import: "npm run codex:asset-pack:import -- --file <codex_asset_import.json>",
  },
};

console.error(JSON.stringify(message, null, 2));
process.exitCode = 1;
