#!/usr/bin/env node

const message = {
  ok: false,
  retired: true,
  script: "phase2g-replace-cta-asset",
  reason:
    "This phase-specific repair helper generated an internal CTA graphic directly. CTA visuals must now be fulfilled through Codex asset-pack generation and human review before approval.",
  replacement: {
    export: "npm run codex:asset-pack:export -- --project <project-id>",
    import: "npm run codex:asset-pack:import -- --file <codex_asset_import.json>",
  },
};

console.error(JSON.stringify(message, null, 2));
process.exitCode = 1;
