export function getJobRunnerSecret() {
  return process.env.JOB_RUNNER_SECRET || null;
}

export function isJobRunnerConfigured() {
  return Boolean(getJobRunnerSecret());
}

export async function createJobRunnerToken(jobId: string) {
  const secret = getJobRunnerSecret();
  if (!secret) {
    throw new Error(
      "Job runner is not configured. Set JOB_RUNNER_SECRET for local/self-hosted pipeline execution.",
    );
  }
  const data = new TextEncoder().encode(`${jobId}.${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isValidJobRunnerToken(jobId: string, token: string | null) {
  if (!token) return false;
  return token === await createJobRunnerToken(jobId);
}
