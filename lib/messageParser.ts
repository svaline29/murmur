/** Matches inline cluster references in assistant messages (see system prompt). */
const CLUSTER_REF_RE = /\[cluster (\d+)\]/g;

export type ClusterRefSegment =
  | { type: "text"; content: string }
  | { type: "cluster_ref"; clusterId: number; raw: string };

/**
 * Splits message text by `[cluster N]` tokens. Returns ordered segments.
 */
export function parseClusterReferences(text: string): ClusterRefSegment[] {
  const segments: ClusterRefSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(CLUSTER_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, m.index) });
    }
    segments.push({
      type: "cluster_ref",
      clusterId: Number(m[1]),
      raw: m[0],
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ type: "text", content: text });
  }
  return segments;
}
