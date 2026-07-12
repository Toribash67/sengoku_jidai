/** gpt-image only outputs these fixed sizes; we letterbox the board into the least-padding one. */
const GPT_IMAGE_SIZES = [
  { id: "1024x1024", w: 1024, h: 1024 },
  { id: "1536x1024", w: 1536, h: 1024 },
  { id: "1024x1536", w: 1024, h: 1536 }
] as const;

export interface AspectPlan {
  imageSize: "1024x1024" | "1536x1024" | "1024x1536";
  targetW: number;
  targetH: number;
  contentW: number;
  contentH: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
}

/** Pick the fixed gpt-image output size that contains the board aspect with the least padding,
 *  and the symmetric letterbox margins to pad the control into it. The padding is filled with the
 *  sea colour at generation time and cropped off after. */
export function planGptImageAspect(boardW: number, boardH: number): AspectPlan {
  let best: AspectPlan | undefined;
  let bestPad = Number.POSITIVE_INFINITY;
  for (const size of GPT_IMAGE_SIZES) {
    const scale = Math.min(size.w / boardW, size.h / boardH);
    const contentW = Math.round(boardW * scale);
    const contentH = Math.round(boardH * scale);
    const padArea = size.w * size.h - contentW * contentH;
    if (padArea < bestPad) {
      bestPad = padArea;
      const padLeft = Math.floor((size.w - contentW) / 2);
      const padTop = Math.floor((size.h - contentH) / 2);
      best = {
        imageSize: size.id,
        targetW: size.w,
        targetH: size.h,
        contentW,
        contentH,
        padLeft,
        padTop,
        padRight: size.w - contentW - padLeft,
        padBottom: size.h - contentH - padTop
      };
    }
  }
  // GPT_IMAGE_SIZES is non-empty, so best is always assigned.
  return best as AspectPlan;
}
