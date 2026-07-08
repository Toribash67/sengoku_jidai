import { fal } from "@fal-ai/client";
import type { FalClient } from "./backend.js";

/** Build a configured FalClient from an API key. Keeps the `@fal-ai/client` SDK dependency
 *  encapsulated inside the terrain package — consumers (e.g. the server) never import it. */
export function createFalClient(credentials: string): FalClient {
  fal.config({ credentials });
  return fal as unknown as FalClient;
}
