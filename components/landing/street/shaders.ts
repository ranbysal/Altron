/*
 * Shaders for the price street.
 *
 * Pass 1 renders the scene's light into a small float buffer (2× the dither
 * cell grid, so each cell averages four samples): R = blue light, G = ember
 * light. Pass 2 turns every cell into one square of the 4×4 Bayer dither,
 * the same texture as the band it replaces.
 */

const COMMON = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

export const BOX_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iCenter;
layout(location=3) in vec3 iSize;
layout(location=4) in vec4 iParams;   // fill, edge, accent, id
layout(location=5) in float iPhase;
uniform mat4 uVP;
uniform float uMirror;
uniform float uIntro;
uniform float uGrow;                  // edges are drawn a hair outside the faces
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec4 vParams; out float vReveal;
void main(){
  float e = smoothstep(iPhase * 0.6, iPhase * 0.6 + 0.4, uIntro);
  vec3 c = iCenter;
  vec3 s = iSize * uGrow;
  c.y *= e;
  s.y *= max(e, 0.0001);
  vec3 p = c + aPos * s;
  vec3 n = aNormal;
  if (uMirror > 0.5) { p.y = -p.y; n.y = -n.y; }
  vWorld = p; vNormal = n; vLocal = aPos; vParams = iParams; vReveal = e;
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const BOX_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec4 vParams; in float vReveal;
uniform vec3 uCam;
uniform vec3 uLightP;
uniform float uLightK;
uniform float uScanZ;
uniform float uHover;
uniform float uFlash;
uniform float uMirror;
uniform float uMode;     // 0 faces, 1 edges
uniform float uFog;
uniform float uGain;
out vec4 o;
${COMMON}
void main(){
  float fill = vParams.x, edge = vParams.y, accent = vParams.z, id = vParams.w;
  float I;
  if (uMode < 0.5) {
    vec3 n = normalize(vNormal);
    float shade = n.y > 0.5 ? 1.15 : (n.y < -0.5 ? 0.25 : (abs(n.z) > 0.5 ? (n.z > 0.0 ? 0.88 : 0.38) : 0.62));
    float grad = 0.62 + 0.55 * (vLocal.y + 0.5);
    if (fill < 0.0) {
      // towers: storeys as horizontal bands, darker toward the street
      float yy = vWorld.y * (uMirror > 0.5 ? -1.0 : 1.0);
      float storey = smoothstep(0.0, 0.16, abs(fract(yy * 2.6) - 0.5) * 2.0 - 0.84); // thin bright band at each floor
      float base = 0.45 + 0.55 * smoothstep(0.0, 3.2, yy);
      I = -fill * shade * base * (0.55 + 1.9 * storey);
    } else {
      I = fill * shade * grad;
    }
  } else {
    I = edge;
  }
  float present = step(0.02, I);
  vec3 dl = vWorld - uLightP;
  I += uLightK * 0.5 * exp(-dot(dl, dl) / 3.2) * present;
  I += 0.7 * exp(-pow(vWorld.z - uScanZ, 2.0) * 6.0) * present;
  if (abs(id - uHover) < 0.5) I = I * 1.35 + 0.3 * present;
  if ((id < 0.5 || abs(id - 1000.0) < 0.5) && fill > 0.0) I += uFlash * 0.45 * present;
  I *= exp(-distance(vWorld, uCam) * uFog);
  if (uMirror > 0.5) {
    I *= 0.26 * exp(vWorld.y * 0.55);
    if (hash(floor(gl_FragCoord.xy)) < 0.42) I = 0.0;
  }
  I *= step(0.001, vReveal) * uGain;
  o = vec4(I * (1.0 - accent), I * accent, 0.0, 1.0);
}`;

export const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aA;        // intensity, accent, s, kind
layout(location=2) in float aPhase;   // < 0: static (fades in with the intro)
uniform mat4 uVP;
uniform float uMirror;
uniform float uIntro;
uniform float uScanZ;
uniform float uPointSize;
out vec3 vWorld; out vec4 vA; out float vReveal;
void main(){
  float e = aPhase < 0.0 ? smoothstep(0.0, 0.55, uIntro) : smoothstep(aPhase * 0.6, aPhase * 0.6 + 0.4, uIntro);
  vec3 p = aPos;
  if (aPhase >= 0.0) p.y *= e;
  if (aA.w > 4.5 && aA.w < 5.5) p.z = uScanZ;     // the scan line rides the sweep
  if (uMirror > 0.5) p.y = -p.y;
  vWorld = p; vA = aA; vReveal = e;
  gl_Position = uVP * vec4(p, 1.0);
  gl_PointSize = uPointSize;
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec4 vA; in float vReveal;
uniform vec3 uCam;
uniform float uTime;
uniform float uMirror;
uniform float uFog;
uniform vec3 uLightP;
uniform float uLightK;
uniform float uScanZ;
uniform float uGain;
out vec4 o;
void main(){
  float I = vA.x, acc = vA.y, s = vA.z, kind = vA.w;
  if (kind > 0.5 && kind < 1.5) {                 // dotted, vertical (stilts)
    if (fract(vWorld.y * 5.0) < 0.5) discard;
  } else if (kind > 1.5 && kind < 2.5) {          // dashed along the street (levels)
    if (fract(vWorld.z * 1.4) < 0.42) discard;
  } else if (kind > 2.5 && kind < 3.5) {          // price cable: pulses run toward the viewer
    float x = fract(s * 2.0 + uTime * 0.16);
    float d = min(x, 1.0 - x);
    I += 1.3 * exp(-d * d * 2600.0);
  } else if (kind > 3.5 && kind < 4.5) {          // center line, dashes flowing toward the viewer
    if (fract(vWorld.z * 0.42 - uTime * 0.85) < 0.55) discard;
  } else if (kind > 4.5 && kind < 5.5) {          // scan line
    I *= 0.6 + 0.4 * sin(uTime * 3.0);
  }
  vec3 dl = vWorld - uLightP;
  I += uLightK * 0.45 * exp(-dot(dl, dl) / 3.2) * step(0.04, I);
  I += 0.55 * exp(-pow(vWorld.z - uScanZ, 2.0) * 6.0) * step(0.04, I);
  I *= exp(-distance(vWorld, uCam) * uFog);
  if (uMirror > 0.5) I *= 0.2;
  I *= vReveal * uGain;
  o = vec4(I * (1.0 - acc), I * acc, 0.0, 1.0);
}`;

export const POST_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uCells;       // cell grid size
uniform float uCell;       // cell size, device px
uniform float uGap;        // gap between squares, device px
uniform vec2 uRes;         // canvas size, device px
uniform vec3 uB0; uniform vec3 uB1; uniform vec3 uB2; uniform vec3 uB3;
uniform vec3 uE0; uniform vec3 uE1; uniform vec3 uE2; uniform vec3 uE3;
uniform vec4 uClear;       // center xy + radii, device px (GL coords)
uniform float uClearAmt;
out vec4 o;
const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
void main(){
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 local = gl_FragCoord.xy - cell * uCell;
  if (local.x >= uCell - uGap || local.y >= uCell - uGap) { o = vec4(0.0); return; }
  vec4 sc = texture(uScene, (cell + 0.5) / uCells);
  vec2 cp = (cell + 0.5) * uCell;
  vec2 q = (cp - uClear.xy) / max(uClear.zw, vec2(1.0));
  float keep = mix(1.0 - uClearAmt, 1.0, smoothstep(0.5, 1.15, length(q)));
  float vy = cp.y / uRes.y;
  float fade = smoothstep(0.0, 0.14, vy) * (1.0 - smoothstep(0.84, 0.97, vy));
  float r = sc.r * keep * fade;
  float g = sc.g * keep * fade;
  float I = r + g;
  int ix = int(mod(cell.x, 4.0));
  int iy = int(mod(cell.y, 4.0));
  float b = (BAYER[iy * 4 + ix] + 0.5) / 16.0;
  if (I <= b) { o = vec4(0.0); return; }
  float lv = I + (b - 0.5) * 0.16;
  vec3 col;
  if (g > r * 0.9) col = lv > 0.92 ? uE3 : (lv > 0.6 ? uE2 : (lv > 0.35 ? uE1 : uE0));
  else col = lv > 0.92 ? uB3 : (lv > 0.6 ? uB2 : (lv > 0.35 ? uB1 : uB0));
  o = vec4(col, 1.0);
}`;
