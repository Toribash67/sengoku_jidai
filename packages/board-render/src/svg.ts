/** Minimal, DOM-free SVG element serializer. board-render emits strings, never touches a DOM. */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;"
};

export function escapeAttr(v: string): string {
  return v.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

export function el(
  tag: string,
  attrs: Record<string, string | number | undefined>,
  children?: string
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) {
      continue;
    }
    parts.push(`${k}="${escapeAttr(String(v))}"`);
  }
  const open = parts.length > 0 ? `${tag} ${parts.join(" ")}` : tag;
  return children === undefined ? `<${open}/>` : `<${open}>${children}</${tag}>`;
}
