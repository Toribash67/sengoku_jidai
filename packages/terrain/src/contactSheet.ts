import sharp, { type OverlayOptions } from "sharp";

export interface SheetOpts {
  columns: number;
  cellWidth: number;
  cellHeight: number;
  captionHeight: number;
}

export interface GridLayout {
  canvasWidth: number;
  canvasHeight: number;
  cells: { x: number; y: number }[];
}

/** Pure grid math: where each cell sits and how big the canvas is. */
export function gridLayout(count: number, opts: SheetOpts): GridLayout {
  const usedCols = Math.min(opts.columns, Math.max(count, 1));
  const rows = Math.ceil(count / opts.columns);
  const rowHeight = opts.cellHeight + opts.captionHeight;
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % opts.columns;
    const row = Math.floor(i / opts.columns);
    cells.push({ x: col * opts.cellWidth, y: row * rowHeight });
  }
  return {
    canvasWidth: usedCols * opts.cellWidth,
    canvasHeight: rows * rowHeight,
    cells
  };
}

/** Escape text for embedding in the caption SVG. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A dark caption strip with the candidate label. */
function captionSvg(label: string, width: number, height: number): Buffer {
  const fontSize = Math.max(10, Math.round(height * 0.5));
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111111"/>
    <text x="6" y="${Math.round(height * 0.7)}" font-family="sans-serif" font-size="${fontSize}" fill="#eeeeee">${escapeXml(label)}</text>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Composite candidates into one labelled grid PNG. A null image (a failed candidate)
 * renders as a dark placeholder cell so the grid stays aligned.
 */
export async function buildContactSheet(
  cells: { label: string; image: Buffer | null }[],
  opts: SheetOpts
): Promise<Buffer> {
  const layout = gridLayout(cells.length, opts);
  const overlays: OverlayOptions[] = [];

  for (let i = 0; i < cells.length; i++) {
    const { x, y } = layout.cells[i]!;
    const cell = cells[i]!;
    const thumb = cell.image
      ? await sharp(cell.image)
          .resize(opts.cellWidth, opts.cellHeight, { fit: "fill" })
          .png()
          .toBuffer()
      : await sharp({
          create: {
            width: opts.cellWidth,
            height: opts.cellHeight,
            channels: 3,
            background: { r: 50, g: 50, b: 50 }
          }
        })
          .png()
          .toBuffer();
    overlays.push({ input: thumb, left: x, top: y });
    overlays.push({
      input: captionSvg(cell.label, opts.cellWidth, opts.captionHeight),
      left: x,
      top: y + opts.cellHeight
    });
  }

  return await sharp({
    create: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      channels: 3,
      background: { r: 17, g: 17, b: 17 }
    }
  })
    .composite(overlays)
    .png()
    .toBuffer();
}
