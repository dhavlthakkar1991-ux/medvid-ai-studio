#!/usr/bin/env node

const message = {
  ok: false,
  retired: true,
  script: "phase2fg-create-approved-text-overlay",
  reason:
    "This repair helper created and linked a generated text-overlay asset directly. Text and infographic assets now go through Codex asset-pack generation, review, and import.",
  replacement: {
    export: "npm run codex:asset-pack:export -- --project <project-id>",
    import: "npm run codex:asset-pack:import -- --file <codex_asset_import.json>",
  },
};

console.error(JSON.stringify(message, null, 2));
process.exitCode = 1;
