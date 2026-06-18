import { ProviderNotConfiguredError, type RenderProvider } from "./types";

/** STUB — enable once SHOTSTACK_API_KEY is set and integration is implemented. */
export const shotstackProvider: RenderProvider = {
  type: "shotstack",
  name: "Shotstack",
  isConfigured() { return Boolean(process.env.SHOTSTACK_API_KEY); },
  async createRender() { throw new ProviderNotConfiguredError("Shotstack", "Add SHOTSTACK_API_KEY and finish the integration."); },
  async getRenderStatus() { throw new ProviderNotConfiguredError("Shotstack"); },
  async cancelRender() { /* no-op */ },
  async downloadRender() { throw new ProviderNotConfiguredError("Shotstack"); },
};