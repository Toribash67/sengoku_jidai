export interface FalClient {
  storage: { upload(blob: Blob): Promise<string> };
  subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }>;
}

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Pull the first output image URL out of a fal result payload (`{ images: [{ url }] }`). */
export function firstImageUrl(data: unknown): string {
  const images = (data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;
  if (!url) {
    throw new Error(`fal result had no image url: ${JSON.stringify(data)}`);
  }
  return url;
}
