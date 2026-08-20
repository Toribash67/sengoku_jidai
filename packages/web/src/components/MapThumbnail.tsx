import { useEffect, useState } from "react";
import { ensureThumbnailLoaded, thumbnailSvgFor } from "../client/maps.js";

/**
 * A small simplified land/sea preview of a map. Renders a cached thumbnail SVG (see
 * `mapThumbnailSvg`), loading it on demand. Shows an empty square placeholder while the
 * map's geometry is being fetched, and leaves the placeholder if the fetch fails.
 */
export function MapThumbnail({ mapId, name }: { mapId: string; name: string }) {
  const [svg, setSvg] = useState<string | null>(() => thumbnailSvgFor(mapId));

  useEffect(() => {
    const cached = thumbnailSvgFor(mapId);
    if (cached) {
      setSvg(cached);
      return;
    }
    setSvg(null);
    let cancelled = false;
    ensureThumbnailLoaded(mapId)
      .then(() => {
        if (!cancelled) {
          setSvg(thumbnailSvgFor(mapId));
        }
      })
      .catch(() => {
        // Leave the placeholder; the map is still usable via its row actions.
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  return (
    <div className="map-thumb" role="img" aria-label={`Map preview: ${name}`}>
      {svg ? <div className="map-thumb-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
    </div>
  );
}
