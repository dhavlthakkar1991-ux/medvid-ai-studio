import { ProviderNotConfiguredError, type RenderProvider } from "./types";

/** STUB — POSTs the FFmpeg-flavored payload to configuration.webhook_url, signs
 * with CUSTOM_WORKER_SECRET, waits for /api/public/render-callback to advance. */
export const customWorkerProvider: RenderProvider = {
  type: "custom_worker",
  name: "Custom Worker",
  isConfigured(configuration) {
    const url = (configuration?.webhook_url as string | undefined) ?? "";
    return Boolean(url) && Boolean(process.env.CUSTOM_WORKER_SECRET);
  },
  async createRender() { throw new ProviderNotConfiguredError("Custom Worker", "Set webhook_url and CUSTOM_WORKER_SECRET."); },
  async getRenderStatus() { throw new ProviderNotConfiguredError("Custom Worker"); },
  async cancelRender() { /* no-op */ },
  async downloadRender() { throw new ProviderNotConfiguredError("Custom Worker"); },
};