import type { TerrainOption } from "./terrainImages.js";

interface TerrainPickerProps {
  options: TerrainOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

/** Compact play-view terrain selector. Renders nothing when there is only Flat to pick
 *  (a map with no committed asset and no ready terrain). */
export function TerrainPicker({ options, selectedKey, onSelect }: TerrainPickerProps) {
  if (options.length <= 1) {
    return null;
  }
  return (
    <label className="terrain-picker">
      <span className="terrain-picker-label">Terrain</span>
      <select
        aria-label="Terrain"
        value={selectedKey}
        onChange={(event) => onSelect(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
