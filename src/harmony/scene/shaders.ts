/**
 * GLSL for the harmony scene (WebGL2 / GLSL ES 3.00).
 *
 * Passes:
 *  1. WORLD: sky, sun/moon, stars, aurora and five parallax layers of
 *     procedural hills + trees with drifting fog between them. With
 *     uMaskOnly it outputs the silhouette coverage instead (for god rays).
 *  2. RAYS: radial blur of the sky light towards the sun, at low resolution.
 *  3. particles (see PARTICLE_*), additive, on top of the world.
 *  4. POST: rays, chord shockwaves, storm grading after wrong notes
 *     (cold desaturation, a little aberration), vignette, grain, tone mapping.
 *
 * The world also has a sea (uSea: water with a glitter path replaces the near
 * hills), wind that sways the trees (uWind) and a storm (uStorm: dark clouds,
 * dimmed sun, rougher water; uFlash for lightning).
 */

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(float x) {
  float i = floor(x), f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1, 0)), c = hash2(i + vec2(0, 1)), d = hash2(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(float x) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(x); x = x * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise2(p); p = p * 2.02 + vec2(11.3, 7.7); a *= 0.5; }
  return v;
}
`;

export const WORLD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform vec3 uSkyTop, uSkyHor, uSun, uGlow, uFog, uFar, uNear;
uniform float uMeadow;   // 0 spruce forest .. 1 meadow
uniform float uNight;    // 0 day .. 1 night
uniform float uReveal;   // 0 fog-bound .. 1 clear world
uniform float uPulse;    // chord bloom, decays
uniform float uStreak;   // 0..1
uniform float uLevel;    // input level 0..1
uniform vec2 uSunPos;
uniform float uHue;
uniform float uMaskOnly;
uniform float uSea;      // 0 land .. 1 open sea below the horizon
uniform float uWind;     // 0 calm .. 1 gale: tree sway
uniform float uStorm;    // 0 clear .. 1 storm
uniform float uFlash;    // lightning, decays
uniform float uBolt;     // a lightning bolt, decays
uniform float uBoltX;    // where it strikes, 0..1 across the screen
uniform float uBoltSeed;

const float HORIZON = 0.36;

${COMMON}

// one tree layer; returns coverage (0..1). p.x in screen-height units.
float trees(vec2 p, float depth, float seed, float px) {
  float spacing = mix(0.05, 0.19, depth) * mix(1.0, 1.9, uMeadow);
  float hMin = mix(0.05, 0.2, depth);
  float hMax = mix(0.11, 0.46, depth);
  float density = mix(0.92, 0.6, uMeadow);
  float cell = floor(p.x / spacing);
  float cover = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    if (hash(c * 1.37 + seed) > density) continue;
    float cx = (c + 0.5 + (hash(c * 3.1 + seed) - 0.5) * 0.7) * spacing;
    float H = mix(hMin, hMax, hash(c * 7.13 + seed));
    float gx = cx; // ground under this tree
    float base = p.y - (mix(0.40, 0.06, depth) + (fbm(gx * mix(3.0, 1.2, depth) + seed) - 0.5) * mix(0.1, 0.22, depth));
    // spruce: tiered cone, branch tiers flare out at their bottom edge
    float y = base / H;
    // wind: each tree sways on its own phase, more at the top and up close
    float sway = (sin(uTime * (0.9 + 0.5 * hash(c + seed)) + c * 1.7) * 0.7 + sin(uTime * 2.6 + c * 3.1) * 0.3)
      * (0.02 + 0.1 * uWind) * H * (0.3 + 0.7 * depth);
    float bend = max(y, 0.0);
    float dx = abs(p.x - cx - sway * bend * bend);
    float tiers = 6.0 + floor(hash(c + seed * 5.0) * 4.0);
    float tier = fract(y * tiers);
    float w = (1.0 - y) * H * 0.3 * (0.72 + 0.34 * (1.0 - tier));
    w += (noise(p.y * 90.0 + c) - 0.5) * H * 0.02; // needle raggedness
    float spruce = (y > -0.02 && y < 1.0) ? smoothstep(px, -px, dx - w) : 0.0;
    float trunk = (y > -0.1 && y < 0.2) ? smoothstep(px, -px, dx - H * 0.025) : 0.0;
    spruce = max(spruce, trunk);
    // meadow tree: trunk + lumpy round canopy
    float R = H * 0.34;
    vec2 cc = vec2(cx, 0.0);
    float cy = base - H * 0.62;
    vec2 q = vec2(p.x - cx - sway * 0.45, cy);
    float ang = atan(q.y, q.x);
    // leaves rustle: the canopy edge ripples, faster in the wind
    float rustle = 0.035 * (0.4 + uWind) * sin(ang * 9.0 + uTime * (2.5 + 5.0 * uWind) + c * 4.0);
    float r = R * (1.0 + 0.09 * sin(ang * 5.0 + c) + 0.06 * sin(ang * 11.0 + c * 2.0) + rustle);
    float canopy = smoothstep(px, -px, length(q) - r);
    float mtrunk = (base > -0.02 && base < H * 0.5) ? smoothstep(px, -px, dx - H * 0.03) : 0.0;
    float round_ = max(canopy, mtrunk);
    cover = max(cover, mix(spruce, round_, uMeadow));
  }
  return cover;
}

float ground(vec2 p, float depth, float seed, float px) {
  float h = mix(0.40, 0.06, depth) + (fbm(p.x * mix(3.0, 1.2, depth) + seed) - 0.5) * mix(0.1, 0.22, depth);
  return smoothstep(px, -px, p.y - h);
}

float grass(vec2 p, float px) {
  float spacing = 0.006;
  float c = floor(p.x / spacing);
  float cover = 0.0;
  for (int k = -1; k <= 1; k++) {
    float cc = c + float(k);
    float h = (0.025 + 0.06 * hash(cc * 1.7)) * (1.0 + uMeadow * 0.6);
    float sway = sin(uTime * 1.3 + cc * 0.35) * 0.35 + uLevel * 0.6 * sin(uTime * 6.0 + cc);
    float y = p.y / h;
    float cx = (cc + 0.5) * spacing + sway * y * y * h * 0.35;
    float w = spacing * 0.55 * (1.0 - y);
    if (y > 0.0 && y < 1.0) cover = max(cover, smoothstep(px, -px, abs(p.x - cx) - w));
  }
  return cover * step(p.y, 0.12);
}

float layerCover(vec2 p, int i, float px) {
  float depth = float(i) / 4.0;
  float seed = float(i) * 19.7 + 3.0;
  float speed = 0.06 + depth * depth * 0.9;
  vec2 q = vec2(p.x + uScroll * speed + seed * 3.0, p.y);
  float c = max(ground(q, depth, seed, px), trees(q, depth, seed, px));
  if (i == 4) c = max(c, grass(vec2(p.x + uScroll * 1.2, p.y), px));
  // at sea only the far coast stays
  if (i > 0) c *= 1.0 - uSea;
  return c;
}

vec3 hueRotate(vec3 c, float a) {
  // rotate around the grey axis in YIQ space
  mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float cs = cos(a), sn = sin(a);
  yiq.yz = mat2(cs, sn, -sn, cs) * yiq.yz;
  return toRGB * yiq;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  float px = 1.5 / uRes.y;
  vec2 sun = vec2(uSunPos.x * aspect, uSunPos.y);

  if (uMaskOnly > 0.5) {
    float m = 0.0;
    for (int i = 0; i < 5; i++) m = max(m, layerCover(p, i, px * 2.0));
    m = max(m, uSea * step(p.y, HORIZON));
    frag = vec4(vec3(1.0 - m), 1.0);
    return;
  }

  // ---- sky
  float h = smoothstep(0.18, 1.0, p.y);
  vec3 col = mix(uSkyHor, uSkyTop, pow(h, 0.8));
  vec3 stormSky = mix(vec3(0.2, 0.23, 0.28), vec3(0.05, 0.06, 0.09), uNight);
  col = mix(col, stormSky * (0.8 + 0.4 * h), uStorm * 0.75);
  float sd = length(p - sun);
  float pulse = uPulse;
  col += uGlow * (exp(-sd * 4.5) * (0.35 + 0.45 * pulse) + exp(-sd * 18.0) * 0.45) * (1.0 - 0.75 * uStorm);
  // clouds / high haze; a storm rolls in thick and fast
  float cl = fbm2(vec2(p.x * 1.6 + uTime * (0.008 + 0.05 * uStorm) + uScroll * 0.03, p.y * 5.0));
  vec3 cloudCol = mix(mix(uSkyHor, uGlow, 0.35), stormSky * 0.7, uStorm);
  float cloudAmt = smoothstep(0.55 - 0.35 * uStorm, 0.85 - 0.3 * uStorm, cl) * (0.35 + 0.55 * uStorm);
  col = mix(col, cloudCol, cloudAmt * smoothstep(0.35 - 0.2 * uStorm, 0.8, p.y));
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.75 * smoothstep(0.3, 1.0, p.y));
  // lightning bolt: a jagged line from the top of the sky down behind the trees,
  // with one fork; flickers while it fades
  if (uBolt > 0.01 && p.y > 0.22) {
    float flick = 0.65 + 0.35 * sin(uTime * 70.0 + uBoltSeed);
    float y = p.y;
    float bx = uBoltX * aspect + (fbm(y * 5.0 + uBoltSeed) - 0.5) * 0.22 + (noise(y * 45.0 + uBoltSeed * 3.0) - 0.5) * 0.035;
    float d = abs(p.x - bx);
    float fy = 0.62 + 0.1 * hash(uBoltSeed);
    float fork = 0.0;
    if (y < fy) {
      float fx = bx + (fy - y) * (0.35 + 0.3 * hash(uBoltSeed + 1.0)) + (noise(y * 50.0 + uBoltSeed * 7.0) - 0.5) * 0.03;
      fork = exp(-abs(p.x - fx) * 700.0) * smoothstep(fy - 0.25, fy, y);
    }
    float core = exp(-d * 650.0) + fork * 0.7;
    float halo = exp(-d * 35.0) * 0.4 + exp(-length(vec2(d, 0.0)) * 8.0) * 0.12;
    col += vec3(0.8, 0.86, 1.0) * uBolt * flick * (core * 2.2 + halo) * smoothstep(0.22, 0.32, y);
  }
  // stars
  if (uNight > 0.01) {
    vec2 g = floor(p * 170.0);
    float s = hash2(g);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
    float star = step(0.9965, s) * tw * smoothstep(0.35, 0.9, p.y);
    col += vec3(star) * uNight * (0.55 + 0.45 * uReveal) * (1.0 - uStorm);
    // aurora ribbon, grows with the streak
    float ay = 0.72 + 0.08 * sin(p.x * 1.7 + uTime * 0.07) + (fbm(p.x * 1.3 + uTime * 0.03) - 0.5) * 0.18;
    float band = exp(-pow((p.y - ay) / 0.075, 2.0)) * smoothstep(0.2, 0.8, fbm(p.x * 5.0 - uTime * 0.12));
    vec3 aur = mix(vec3(0.2, 1.0, 0.6), vec3(0.55, 0.35, 1.0), smoothstep(ay - 0.05, ay + 0.08, p.y));
    col += aur * band * uNight * (0.08 + 0.55 * uStreak) * uReveal;
  }
  // sun / moon disc
  float disc = smoothstep(0.042, 0.038, sd);
  col = mix(col, uSun * (1.1 + 0.4 * pulse), disc * (1.0 - 0.85 * uStorm));

  // ---- layers back to front, with fog in between
  for (int i = 0; i < 5; i++) {
    float depth = float(i) / 4.0;
    float c = layerCover(p, i, px);
    vec3 lc = mix(uFar, uNear, pow(depth, 0.9));
    // aerial perspective: distant layers dissolve into the fog colour
    float fogAmt = mix(0.55, 0.0, pow(depth, 0.7)) + (1.0 - uReveal) * mix(0.3, 0.12, depth) + uStorm * 0.2;
    lc = mix(lc, uFog, clamp(fogAmt, 0.0, 0.95));
    // rim light on the side facing the sun
    lc += uGlow * 0.035 * (1.0 - depth) * (1.0 + pulse);
    col = mix(col, lc, c);
    // drifting mist bank above this layer
    float my = mix(0.42, 0.1, depth);
    float mist = fbm2(vec2(p.x * 2.2 + uTime * (0.012 + depth * 0.02) + uScroll * (0.06 + depth * 0.5), p.y * 7.0 + float(i) * 3.0));
    float band = smoothstep(my + 0.14, my - 0.02, p.y) * smoothstep(0.35, 0.75, mist);
    float mistStrength = (mix(0.14, 0.05, uMeadow) + (1.0 - uReveal) * 0.25) * (i > 0 ? 1.0 - 0.8 * uSea : 1.0);
    col = mix(col, uFog * (1.0 + 0.3 * pulse), band * mistStrength * (1.0 - depth * 0.5));

    // the sea, right in front of the far coast
    if (i == 0 && uSea > 0.001) {
      float below = smoothstep(px, -px, p.y - HORIZON);
      if (below > 0.0) {
        float d = clamp((HORIZON - p.y) / HORIZON, 0.0, 1.0); // 0 horizon .. 1 bottom
        float z = 1.0 / (d + 0.04);
        vec2 wp = vec2(p.x * z * 0.9, z * 1.2);
        float rough = 1.0 + 2.0 * uStorm;
        float wv = noise2(wp * vec2(3.0, 5.0) + vec2(uTime * 0.25, -uTime * 0.6 * rough))
                 + 0.5 * noise2(wp * vec2(7.0, 11.0) + vec2(-uTime * 0.4, -uTime * 1.1 * rough));
        vec3 refl = mix(uSkyHor, uSkyTop, clamp(d * 1.4, 0.0, 1.0));
        refl = mix(refl, stormSky, uStorm * 0.7);
        vec3 water = refl * (0.55 - 0.25 * d) + uNear * 0.35 * d;
        water += (wv - 0.75) * 0.08 * rough * (uSkyHor + 0.3);
        // the sun's glitter path, sparkling harder with each note
        float path = exp(-pow((p.x - sun.x) / (0.025 + 0.28 * d), 2.0)) * exp(-d * 1.2);
        float glint = smoothstep(0.72 - 0.12 * pulse - 0.08 * uLevel, 0.95, noise2(vec2(p.x * z * 22.0, z * 40.0 - uTime * 2.2)));
        water += uSun * path * (0.25 + 1.6 * glint) * (1.0 - 0.8 * uStorm) * (0.8 + 0.4 * pulse);
        water += vec3(0.75, 0.8, 1.0) * uFlash * 0.3;
        water = mix(water, uFog, exp(-d * 18.0) * 0.6);
        col = mix(col, water, below * uSea);
      }
    }
  }

  // ground fog glow near the horizon
  col += uGlow * 0.035 * exp(-abs(p.y - 0.3) * 8.0) * (1.0 + pulse);

  col = hueRotate(col, uHue);
  frag = vec4(max(col, 0.0), 1.0);
}`;

/** radial blur of the light that makes it past the silhouettes */
export const RAYS_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uMask;
uniform vec2 uSunPos;
uniform float uStrength;
void main() {
  vec2 dir = (uSunPos - vUv);
  float acc = 0.0;
  float w = 1.0;
  float tot = 0.0;
  const int N = 40;
  for (int i = 0; i < N; i++) {
    vec2 uv = vUv + dir * (float(i) / float(N)) * 0.95;
    acc += texture(uMask, uv).r * w;
    tot += w;
    w *= 0.97;
  }
  float r = acc / tot;
  float fall = exp(-length((vUv - uSunPos) * vec2(1.6, 1.0)) * 2.2);
  frag = vec4(vec3(r * fall * uStrength), 1.0);
}`;

export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uScene;
uniform sampler2D uRays;
uniform vec2 uRes;
uniform float uTime;
uniform float uWrong;
uniform vec2 uShake;
uniform vec4 uRings[9];   // x, y, radius, strength
uniform vec3 uRingCol[9];
uniform float uAttack;    // a pick was just heard: brief lift from below
uniform vec3 uRayCol;
uniform float uReveal;
${COMMON}
void main() {
  vec2 uv = vUv + uShake;
  float aspect = uRes.x / uRes.y;
  vec3 ringAdd = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    vec4 r = uRings[i];
    if (r.w <= 0.001) continue;
    vec2 d = (uv - r.xy) * vec2(aspect, 1.0);
    float dist = length(d);
    float edge = exp(-pow((dist - r.z) / 0.011, 2.0));
    uv -= normalize(d + 1e-5) / vec2(aspect, 1.0) * edge * 0.012 * r.w;
    ringAdd += uRingCol[i] * edge * r.w * 0.4;
  }
  // chromatic aberration on wrong notes
  vec2 ca = (uv - 0.5) * (0.003 + 0.006 * uWrong);
  vec3 col;
  col.r = texture(uScene, uv + ca * uWrong).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - ca * uWrong).b;
  col += texture(uRays, uv).rgb * uRayCol;
  col += ringAdd;

  // every pick: the scene brightens for a moment, most at the bottom edge
  col *= 1.0 + 0.22 * uAttack;
  col += uRayCol * uAttack * 0.18 * smoothstep(0.45, 0.0, vUv.y);

  // storm: drain the warmth, cold and grey (uWrong = storm strength)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.85, 0.93, 1.08), clamp(uWrong * 0.55, 0.0, 0.55));
  vec2 vc = vUv - 0.5;
  float vig = smoothstep(0.85, 0.25, length(vc * vec2(aspect * 0.8, 1.0)));
  col *= mix(0.55 - 0.15 * uWrong, 1.0, vig);

  // filmic tone map + grain
  col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
  float g = hash2(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
  col += g * 0.045;
  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
in vec2 aPos;     // 0..1 screen, y up
in float aSize;   // px
in vec4 aColor;
in float aKind;   // 0 glow, 1 leaf/petal, 2 shard, 3 raindrop, 4 star, 5 halo ring
in float aRot;
uniform vec2 uRes;
uniform vec2 uShake;
out vec4 vColor;
out float vKind;
out float vRot;
void main() {
  vec2 p = (aPos + uShake) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
  vKind = aKind;
  vRot = aRot;
}`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in float vKind;
in float vRot;
out vec4 frag;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a;
  if (vKind < 0.5) {
    float d = dot(q, q);
    a = exp(-d * 7.0) * 0.45 + exp(-d * 34.0);
  } else {
    float cs = cos(vRot), sn = sin(vRot);
    q = mat2(cs, -sn, sn, cs) * q;
    if (vKind < 1.5) {
      // leaf / petal: pointed ellipse with a soft rim
      float d = length(q * vec2(1.0, 2.6)) + abs(q.x) * 0.35;
      a = smoothstep(0.95, 0.55, d);
    } else if (vKind < 2.5) {
      // shard: thin triangle
      a = step(abs(q.x), 0.5 * (1.0 - q.y) * 0.5) * step(-1.0, q.y) * step(q.y, 1.0);
    } else if (vKind < 3.5) {
      // raindrop: a thin streak along its fall direction
      a = smoothstep(0.1, 0.0, abs(q.x)) * smoothstep(1.0, 0.4, abs(q.y));
    } else if (vKind < 4.5) {
      // star: five soft points and a glowing heart
      float r = length(q);
      float ang = atan(q.y, q.x);
      float edge = 0.28 + 0.6 * pow(abs(cos(ang * 2.5)), 5.0);
      a = smoothstep(edge, edge - 0.14, r) + exp(-r * r * 9.0) * 0.6;
    } else {
      // halo: a thin bright ring with a faint centre
      float r = length(q);
      a = exp(-pow((r - 0.72) / 0.07, 2.0)) + exp(-r * r * 12.0) * 0.35;
    }
  }
  frag = vec4(vColor.rgb * vColor.a * a, 1.0);
}`;
