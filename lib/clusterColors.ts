/** Golden-angle hue spread so nearby cluster ids stay visually distinct. */
export function clusterHueDegrees(clusterId: number): number {
  return (clusterId * 137.508 + 42) % 360;
}

/** HSL → RGB for canvas (h: degrees, s/l: 0–1). */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const H = ((h % 360) + 360) % 360;
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = l - C / 2;
  let R = 0;
  let G = 0;
  let B = 0;
  if (H < 60) [R, G, B] = [C, X, 0];
  else if (H < 120) [R, G, B] = [X, C, 0];
  else if (H < 180) [R, G, B] = [0, C, X];
  else if (H < 240) [R, G, B] = [0, X, C];
  else if (H < 300) [R, G, B] = [X, 0, C];
  else [R, G, B] = [C, 0, X];
  return { r: (R + m) * 255, g: (G + m) * 255, b: (B + m) * 255 };
}

export function clusterHighlightRgb(clusterId: number): {
  r: number;
  g: number;
  b: number;
} {
  const h = clusterHueDegrees(clusterId);
  return hslToRgb(h, 0.72, 0.58);
}
