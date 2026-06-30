#!/usr/bin/env node

const message = {
  ok: false,
  retired: true,
  script: "phase2g-repair-source-safety",
  reason:
    "This benchmark repair helper adjusted stock-source safety metadata directly. Stock-provider repair paths are no longer part of the primary creative workflow.",
  replacement: {
    export: "npm run codex:asset-pack:export -- --project-id <project-id>",
    import: "npm run codex:asset-pack:import -- --file <codex_asset_import.json>",
  },
};

console.error(JSON.stringify(message, null, 2));
process.exitCode = 1;
