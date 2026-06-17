export async function createJobRunnerToken(jobId: string) {
  const secret = process.env.LOVABLE_API_KEY;
  if (!secret) throw new Error("Job runner is not configured.");
  const data = new TextEncoder().encode(`${jobId}.${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isValidJobRunnerToken(jobId: string, token: string | null) {
  if (!token) return false;
  return token === await createJobRunnerToken(jobId);
}
