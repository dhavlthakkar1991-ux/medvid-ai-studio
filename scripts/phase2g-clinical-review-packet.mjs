import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = process.env.PHASE2G_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const QUALITY_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2g-render-quality");
const REPORT_PATH = path.join(QUALITY_DIR, "render_quality_report.json");
const OUT_DIR = path.join(QUALITY_DIR, "clinical_human_review");
const FRAME_DIR = path.join(OUT_DIR, "frames");

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `${command} exited ${result.status}`}`);
  }
  return result;
}

function safeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "scene";
}

function secondsLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}

function sceneWindow(scene) {
  const overlays = Array.isArray(scene.active_overlays) ? scene.active_overlays : [];
  const primary = overlays.find((row) => Number.isFinite(Number(row.start_time)) && Number(row.duration_seconds) > 0);
  if (primary) {
    const start = Number(primary.start_time);
    const duration = Number(primary.duration_seconds);
    return {
      start,
      end: start + duration,
      duration,
      source: "active_overlay",
    };
  }
  const seconds = Number(scene.seconds ?? 0);
  return {
    start: Math.max(0, seconds - 2),
    end: seconds + 2,
    duration: 4,
    source: "target_timestamp_fallback",
  };
}

function frameTimesFor(scene) {
  const window = sceneWindow(scene);
  const target = Number(scene.seconds ?? window.start);
  const times = [
    window.start,
    Math.max(window.start, target - 1),
    target,
    Math.min(window.end, target + 1),
    window.end,
  ];
  return Array.from(new Set(times.map((value) => Number(value.toFixed(2)))))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
}

function extractFrame(videoPath, seconds, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  run("ffmpeg", [
    "-y",
    "-ss",
    String(seconds),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outPath,
  ], `extract ${outPath}`);
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const report = readJson(REPORT_PATH);
if (!report.output_path || !fs.existsSync(report.output_path)) {
  throw new Error(`Latest output MP4 is missing: ${report.output_path ?? "unknown"}`);
}

const reviewScenes = (report.scenes ?? []).filter((scene) => scene.human_review_required);
if (!reviewScenes.length) {
  throw new Error("No human-review scenes found in Phase 2G render-quality report.");
}

fs.mkdirSync(FRAME_DIR, { recursive: true });

const packetScenes = reviewScenes.map((scene) => {
  const window = sceneWindow(scene);
  const base = `${secondsLabel(scene.seconds)}_${safeName(scene.required_intent)}`;
  const frames = frameTimesFor(scene).map((seconds, index) => {
    const file = path.join(FRAME_DIR, `${base}_${String(index + 1).padStart(2, "0")}_${secondsLabel(seconds)}.jpg`);
    extractFrame(report.output_path, seconds, file);
    return {
      seconds,
      path: file,
      relative_path: path.relative(OUT_DIR, file),
    };
  });
  return {
    time: scene.time,
    seconds: scene.seconds,
    review_window: window,
    required_intent: scene.required_intent,
    expected_visual_behavior: scene.expected_visual_behavior,
    narration_excerpt: scene.narration_excerpt,
    storyboard_intent: scene.storyboard_intent,
    layout_intent: scene.layout_intent,
    requirement_id: scene.requirement_id,
    timeline_item_id: scene.timeline_item_id,
    asset_id: scene.asset_id,
    asset_type: scene.asset_type,
    source_domain: scene.source_domain,
    license_status: scene.license_status,
    approval_status: scene.approval_status,
    active_overlays: scene.active_overlays,
    automated_remaining_gap: scene.remaining_gap,
    review_questions: [
      "Does the visual accurately match the narration without introducing unsupported medical facts?",
      "Is the anatomy or clinical concept appropriate for patient education?",
      "Is the tone reassuring and non-fearmongering?",
      "Are labels, if any, readable and sourced from approved Studio content?",
      "Should this scene be accepted as-is, replaced, simplified, or escalated for manual editing?",
    ],
    frames,
  };
});

const packet = {
  generated_at: new Date().toISOString(),
  project_id: PROJECT_ID,
  render_job_id: report.render_job_id,
  provider_job_id: report.provider_job_id,
  output_path: report.output_path,
  output_url_redacted: report.output_url_redacted,
  ffprobe: report.ffprobe,
  quality_report_path: REPORT_PATH,
  contact_sheet_path: report.contact_sheet_path,
  gate_status: "PASS_TECHNICAL_CHECKS_REQUIRES_HUMAN_CLINICAL_REVIEW",
  publication_status: "DO_NOT_PUBLISH_UNTIL_HUMAN_MEDICAL_DESIGN_APPROVAL",
  review_scope: "Clinical/anatomy visual appropriateness for remaining Phase 2G scenes only.",
  scenes: packetScenes,
};

writeJson(path.join(OUT_DIR, "clinical_human_review_packet.json"), packet);

const rows = packetScenes.map((scene) => [
  scene.time,
  scene.required_intent,
  scene.asset_type,
  scene.source_domain,
  scene.license_status,
  scene.automated_remaining_gap,
  scene.frames.map((frame) => `[${frame.seconds}s](${frame.relative_path.replace(/\\/g, "/")})`).join("<br>"),
].map(markdownEscape));

const md = `# Phase 2G Clinical Human Review Packet

Project: \`${PROJECT_ID}\`

Render job: \`${packet.render_job_id}\`

Provider job: \`${packet.provider_job_id}\`

Gate status: \`${packet.gate_status}\`

Publication status: \`${packet.publication_status}\`

This packet does not approve medical accuracy. It packages the remaining clinical/anatomy scenes for human medical/design review after automated technical, source-safety, and render checks passed.

## Output

- MP4: \`${packet.output_path}\`
- Output URL: \`${packet.output_url_redacted}\`
- Quality report: \`${REPORT_PATH}\`
- Contact sheet: \`${packet.contact_sheet_path}\`
- Codec: \`${packet.ffprobe?.video?.codec ?? "unknown"}\` video, \`${packet.ffprobe?.audio?.codec ?? "unknown"}\` audio
- Duration: \`${packet.ffprobe?.duration_seconds ?? "unknown"}s\`
- Resolution: \`${packet.ffprobe?.video?.width ?? "?"}x${packet.ffprobe?.video?.height ?? "?"}\`

## Scenes Requiring Human Clinical Review

| Time | Intent | Asset Type | Source | License | Automated Gap | Frames |
| --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Reviewer Questions

For each scene:

1. Does the visual accurately match the narration without introducing unsupported medical facts?
2. Is the anatomy or clinical concept appropriate for patient education?
3. Is the tone reassuring and non-fearmongering?
4. Are labels, if any, readable and sourced from approved Studio content?
5. Should this scene be accepted as-is, replaced, simplified, or escalated for manual editing?

## Approval Language

If acceptable, reply:

\`\`\`text
Human medical/design review approved for Phase 2G clinical scenes:
- 00:36
- 00:48
- 00:59
- 01:21

Proceed to final Phase 2G acceptance packaging.
\`\`\`

If changes are needed, reply with scene time, issue, and exact correction.
`;

fs.writeFileSync(path.join(OUT_DIR, "clinical_human_review_packet.md"), md, "utf8");

const medicalSafetyReview = `# Medical Safety Review Checklist

Status: HUMAN REVIEW REQUIRED

Render job: \`${packet.render_job_id}\`

This checklist is intentionally conservative. Automated checks cannot certify clinical/anatomy accuracy from pixels.

## Review Items

${packetScenes.map((scene) => `### ${scene.time} - ${scene.required_intent}

- Narration: ${scene.narration_excerpt ?? "Unknown"}
- Asset: ${scene.asset_id ?? "Unknown"} (${scene.asset_type ?? "unknown type"})
- Source: ${scene.source_domain ?? "unknown"} / ${scene.license_status ?? "unknown license"}
- Check medical accuracy, tone, label correctness, and whether the visual could mislead patients.
- Automated note: ${scene.automated_remaining_gap ?? "None"}
`).join("\n")}

## Do Not Publish Until

- A human medical/design reviewer approves the scenes above.
- Any requested scene-specific corrections are made and rerendered.
`;

fs.writeFileSync(path.join(OUT_DIR, "medical_safety_review.md"), medicalSafetyReview, "utf8");

const humanPrompt = `Please review the Phase 2G Oral Cancer render clinical scenes.

Video:
${packet.output_path}

Review packet:
${path.join(OUT_DIR, "clinical_human_review_packet.md")}

Medical safety checklist:
${path.join(OUT_DIR, "medical_safety_review.md")}

Frame folder:
${FRAME_DIR}

Review for:
1. Medical accuracy
2. Anatomy/clinical visual appropriateness
3. Tone and patient sensitivity
4. No fearmongering
5. No unsupported medical claims or labels
6. Visual readability and professional polish

If approved, reply:
"Human medical/design review approved for Phase 2G clinical scenes; proceed to final Phase 2G acceptance packaging."

If changes are needed, list:
scene time, issue, and exact requested correction.
`;

fs.writeFileSync(path.join(OUT_DIR, "human_review_prompt.md"), humanPrompt, "utf8");

console.log(JSON.stringify({
  ok: true,
  project_id: PROJECT_ID,
  render_job_id: packet.render_job_id,
  provider_job_id: packet.provider_job_id,
  gate_status: packet.gate_status,
  scenes_requiring_review: packetScenes.map((scene) => scene.time),
  output_dir: OUT_DIR,
  files: [
    path.join(OUT_DIR, "clinical_human_review_packet.json"),
    path.join(OUT_DIR, "clinical_human_review_packet.md"),
    path.join(OUT_DIR, "medical_safety_review.md"),
    path.join(OUT_DIR, "human_review_prompt.md"),
  ],
}, null, 2));
