import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = process.env.PHASE2G_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const QUALITY_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2g-render-quality");
const CLINICAL_DIR = path.join(QUALITY_DIR, "clinical_human_review");
const QUALITY_REPORT_PATH = path.join(QUALITY_DIR, "render_quality_report.json");
const CLINICAL_PACKET_PATH = path.join(CLINICAL_DIR, "clinical_human_review_packet.json");
const APPROVAL_PATH = process.env.PHASE2G_HUMAN_APPROVAL_PATH ?? path.join(CLINICAL_DIR, "human_approval.json");
const APPROVAL_TEMPLATE_PATH = path.join(CLINICAL_DIR, "human_approval.template.json");
const OUT_PATH = path.join(QUALITY_DIR, "phase2g_final_acceptance.json");

const EXPECTED_CLINICAL_TIMES = ["00:36", "00:48", "00:59", "01:21"];

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (!required) return null;
    throw new Error(`Missing required file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function unique(values) {
  return Array.from(new Set(values));
}

function sceneTimes(scenes) {
  return unique((Array.isArray(scenes) ? scenes : []).map((scene) => scene.time).filter(Boolean)).sort();
}

function missingValues(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value));
}

function createTemplate(packet, report) {
  return {
    status: "approved",
    reviewer_name: "",
    reviewer_role: "medical/design reviewer",
    reviewed_at: new Date().toISOString(),
    evidence_project_id: PROJECT_ID,
    evidence_render_job_id: report?.render_job_id ?? packet?.render_job_id ?? "",
    evidence_provider_job_id: report?.provider_job_id ?? packet?.provider_job_id ?? "",
    approval_statement:
      "Human medical/design review approved the listed Phase 2G clinical scenes for patient-education visual appropriateness. No unsupported medical claims or misleading labels were identified.",
    scenes: EXPECTED_CLINICAL_TIMES.map((time) => ({
      time,
      decision: "approved",
      notes: "",
    })),
  };
}

function validateApproval({ approval, packet, report }) {
  const failures = [];
  const reportClinicalScenes = (report?.scenes ?? []).filter((scene) => scene.human_review_required === true);
  const packetScenes = packet?.scenes ?? [];
  const approvalScenes = approval?.scenes ?? [];
  const approvedTimes = sceneTimes(approvalScenes.filter((scene) => scene.decision === "approved"));

  if (report?.technical_checks_pass !== true) failures.push("Phase 2G technical checks are not passing.");
  if (report?.overall_verdict !== "NEEDS_HUMAN_REVIEW_OR_SMALL_FIXES" && report?.overall_verdict !== "ACCEPTED") {
    failures.push(`Unexpected Phase 2G render-quality verdict: ${report?.overall_verdict ?? "missing"}.`);
  }
  if (packet?.gate_status !== "PASS_TECHNICAL_CHECKS_REQUIRES_HUMAN_CLINICAL_REVIEW") {
    failures.push(`Unexpected clinical packet gate_status: ${packet?.gate_status ?? "missing"}.`);
  }
  if (packet?.publication_status !== "DO_NOT_PUBLISH_UNTIL_HUMAN_MEDICAL_DESIGN_APPROVAL") {
    failures.push(`Unexpected clinical packet publication_status: ${packet?.publication_status ?? "missing"}.`);
  }

  const reportMissing = missingValues(EXPECTED_CLINICAL_TIMES, sceneTimes(reportClinicalScenes));
  if (reportMissing.length) failures.push(`Render-quality report is missing clinical review scene(s): ${reportMissing.join(", ")}.`);
  const packetMissing = missingValues(EXPECTED_CLINICAL_TIMES, sceneTimes(packetScenes));
  if (packetMissing.length) failures.push(`Clinical review packet is missing scene(s): ${packetMissing.join(", ")}.`);
  const approvalMissing = missingValues(EXPECTED_CLINICAL_TIMES, approvedTimes);
  if (approvalMissing.length) failures.push(`Human approval is missing approved scene(s): ${approvalMissing.join(", ")}.`);

  if (approval?.status !== "approved") failures.push(`Human approval status must be approved, got: ${approval?.status ?? "missing"}.`);
  if (!approval?.reviewer_name) failures.push("Human approval reviewer_name is required.");
  if (!approval?.reviewer_role) failures.push("Human approval reviewer_role is required.");
  if (!approval?.reviewed_at || Number.isNaN(Date.parse(approval.reviewed_at))) {
    failures.push("Human approval reviewed_at must be a valid date.");
  }
  if (!approval?.approval_statement || String(approval.approval_statement).trim().length < 40) {
    failures.push("Human approval approval_statement is required and must be specific.");
  }
  if (approval?.evidence_project_id !== PROJECT_ID) {
    failures.push(`Human approval evidence_project_id must match ${PROJECT_ID}.`);
  }
  if (approval?.evidence_render_job_id !== report?.render_job_id) {
    failures.push("Human approval evidence_render_job_id must match the current Phase 2G render-quality report.");
  }
  if (approval?.evidence_provider_job_id !== report?.provider_job_id) {
    failures.push("Human approval evidence_provider_job_id must match the current Phase 2G render-quality report.");
  }

  for (const scene of packetScenes) {
    for (const frame of Array.isArray(scene.frames) ? scene.frames : []) {
      if (!frame.path || !fs.existsSync(frame.path)) {
        failures.push(`Clinical review frame is missing for ${scene.time}: ${frame.path ?? "unknown"}.`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    expected_clinical_times: EXPECTED_CLINICAL_TIMES,
    report_clinical_times: sceneTimes(reportClinicalScenes),
    packet_scene_times: sceneTimes(packetScenes),
    approved_scene_times: approvedTimes,
  };
}

const report = readJson(QUALITY_REPORT_PATH);
const packet = readJson(CLINICAL_PACKET_PATH);
const approval = readJson(APPROVAL_PATH, false);

if (!approval) {
  const template = createTemplate(packet, report);
  writeJson(APPROVAL_TEMPLATE_PATH, template);
  const pending = {
    generated_at: new Date().toISOString(),
    status: "missing_human_approval",
    project_id: PROJECT_ID,
    approval_path: APPROVAL_PATH,
    approval_template_path: APPROVAL_TEMPLATE_PATH,
    required_scene_times: EXPECTED_CLINICAL_TIMES,
    next_action:
      "Copy human_approval.template.json to human_approval.json, fill reviewer details and scene decisions, then rerun npm.cmd run review:phase2g-final.",
  };
  writeJson(OUT_PATH, pending);
  console.log(JSON.stringify(pending, null, 2));
  process.exit(1);
}

const validation = validateApproval({ approval, packet, report });
const accepted = {
  generated_at: new Date().toISOString(),
  status: validation.ok ? "accepted_by_human_review" : "needs_attention",
  project_id: PROJECT_ID,
  render_job_id: report.render_job_id,
  provider_job_id: report.provider_job_id,
  output_path: report.output_path,
  output_url_redacted: report.output_url_redacted,
  approval_path: APPROVAL_PATH,
  quality_report_path: QUALITY_REPORT_PATH,
  clinical_packet_path: CLINICAL_PACKET_PATH,
  validation,
};
writeJson(OUT_PATH, accepted);
console.log(JSON.stringify(accepted, null, 2));
if (!validation.ok) process.exit(1);
