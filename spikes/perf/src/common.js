// THROWAWAY spike. Shared helpers for render benches.
export const hsl = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0), f(8), f(4)] }
// docs/design.md dark tokens. 0 other/chain, 1 agent, 2 llm, 3 tool, 4 chain, 5 error
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
export const PAL = [hex('#94a0b3'), hsl(281, 82, 63), hex('#3b9ef0'), hsl(101, 82, 63), hex('#7cc4fd'), hsl(339, 82, 63)]
export const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
export const BG = hex('#0d1219'), SURFACE = hex('#171d28')

export async function loadModel(n) {
  const buf = await (await fetch(`/data/model-${n}.bin`)).arrayBuffer()
  const N = new Uint32Array(buf, 0, 1)[0]
  let o = 8
  const take = (T, bytes) => { const a = new T(buf, o, N); o += N * bytes; return a }
  const start = take(Float64Array, 8), dur = take(Float64Array, 8), parent = take(Int32Array, 4), kind = take(Uint8Array, 1), err = take(Uint8Array, 1)
  return { N, start, dur, parent, kind, err }
}
export function stats(a) { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) } }
export const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
export function glInfo(gl) { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }
export function compile(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  return p
}
