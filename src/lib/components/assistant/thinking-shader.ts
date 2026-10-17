// Cel-shaded "Thinking…" indicator: three raymarched drops on a tilted orbit,
// tinted with the theme accent. Chosen by the owner from the round-four demo (spec 019).

export const THINKING_VERTEX = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

export const THINKING_FRAGMENT = `precision mediump float;
uniform vec2 r; uniform float t; uniform vec3 c;
float T;
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
float map(vec3 q) {
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    float fi = float(i); float a = T*(1.1 + fi*0.45) + fi*2.1;
    vec3 cp = vec3(0.42*cos(a), 0.3*sin(a*1.2), 0.35*sin(a*0.9 + fi));
    d = smin(d, length(q - cp) - (0.3 - fi*0.03), 0.22);
  }
  return d;
}
vec3 nrm(vec3 q) {
  vec2 e = vec2(0.002, -0.002);
  return normalize(e.xyy*map(q + e.xyy) + e.yyx*map(q + e.yyx) + e.yxy*map(q + e.yxy) + e.xxx*map(q + e.xxx));
}
bool march(vec2 p, out vec3 pos, out vec3 n, out vec3 rd, out float dm) {
  vec3 ro = vec3(0.0, 0.0, 2.6); rd = normalize(vec3(p, -3.0));
  float tt = 1.4; dm = 1e3; n = vec3(0.0, 0.0, 1.0); pos = ro;
  for (int i = 0; i < 48; i++) {
    pos = ro + rd*tt; float d = map(pos); dm = min(dm, d);
    if (d < 0.002) { n = nrm(pos); return true; }
    tt += d; if (tt > 4.2) break;
  }
  return false;
}
vec3 ramp(vec3 c, float x) {
  return x < 0.6 ? mix(c*0.15, c, x/0.6) : mix(c, mix(c, vec3(1.0), 0.75), (x - 0.6)/0.4);
}
void main() {
  T = t;
  vec2 p = (gl_FragCoord.xy*2.0 - r)/r.y;
  vec3 col; float alpha;
  vec3 pos, n, rd; float dm; bool hit = march(p, pos, n, rd, dm);
  vec3 L = normalize(vec3(-0.5, 0.7, 0.6)), v = -rd, h = normalize(L + v);
  float ndv = max(dot(n, v), 0.0), dif = max(dot(n, L), 0.0);
  float ao = clamp(map(pos + n*0.12)/0.12, 0.0, 1.0), depth = clamp(0.55 + pos.z, 0.0, 1.0);
  if (hit) {
    float lit = dif*(0.6 + 0.4*ao)*(0.75 + 0.25*depth);
    float band = lit > 0.62 ? 0.95 : lit > 0.3 ? 0.62 : 0.3;
    float glint = step(0.985, dot(n, h));
    col = ndv < 0.28 ? c*0.14 : ramp(c, band) + vec3(glint); alpha = 1.0;
  } else { alpha = 1.0 - smoothstep(0.022, 0.034, dm); col = c*0.14; }
  alpha *= smoothstep(1.0, 0.86, max(abs(p.x), abs(p.y)));
  gl_FragColor = vec4(col*alpha, alpha);
}`;

/** `#rrggbb` → linear 0..1 triple for the `c` uniform; null for anything else. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
