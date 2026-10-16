// THROWAWAY spike. Timeline strip / waterfall renderers: Canvas 2D vs WebGL2, with and without sub-pixel LOD merging.
import { PAL, css, BG, loadModel, stats, nextFrame, glInfo, compile } from './common.js'

// ---- lane packing: greedy interval partitioning so overlapping spans get different lanes
export function layoutLanes(m) {
  const N = m.N
  const idx = new Uint32Array(N); for (let i = 0; i < N; i++) idx[i] = i
  idx.sort((a, b) => m.start[a] - m.start[b])
  // min-heap of [endTime, lane]
  const heapE = [], heapL = []
  const push = (e, l) => { let i = heapE.length; heapE.push(e); heapL.push(l); while (i > 0) { const p = (i - 1) >> 1; if (heapE[p] <= heapE[i]) break;[heapE[p], heapE[i]] = [heapE[i], heapE[p]];[heapL[p], heapL[i]] = [heapL[i], heapL[p]]; i = p } }
  const pop = () => { const e = heapE[0], l = heapL[0]; const le = heapE.pop(), ll = heapL.pop(); if (heapE.length) { heapE[0] = le; heapL[0] = ll; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heapE.length) break; if (c + 1 < heapE.length && heapE[c + 1] < heapE[c]) c++; if (heapE[i] <= heapE[c]) break;[heapE[c], heapE[i]] = [heapE[i], heapE[c]];[heapL[c], heapL[i]] = [heapL[i], heapL[c]]; i = c } } return l }
  const lane = new Uint16Array(N); let lanes = 0
  for (let k = 0; k < N; k++) {
    const i = idx[k]; const s = m.start[i], e = s + m.dur[i]
    let l
    if (heapE.length && heapE[0] <= s) l = pop(); else l = lanes++
    lane[i] = l; push(e, l)
  }
  // per-lane arrays sorted by start
  const counts = new Uint32Array(lanes + 1)
  for (let i = 0; i < N; i++) counts[lane[i] + 1]++
  for (let l = 0; l < lanes; l++) counts[l + 1] += counts[l]
  const off = counts.slice(), fill = counts.slice(0, lanes)
  const order = new Uint32Array(N)
  for (let k = 0; k < N; k++) { const i = idx[k]; order[fill[lane[i]]++] = i }
  const cls = new Uint8Array(N); for (let i = 0; i < N; i++) cls[i] = m.err[i] ? 5 : m.kind[i]
  // flat, lane-sorted copies (cache friendly for the CPU path and ready for GPU upload)
  const sx = new Float64Array(N), sd = new Float64Array(N), sc = new Uint8Array(N), sl = new Uint16Array(N)
  for (let k = 0; k < N; k++) { const i = order[k]; sx[k] = m.start[i]; sd[k] = m.dur[i]; sc[k] = cls[i]; sl[k] = lane[i] }
  let maxT = 0; for (let k = 0; k < N; k++) maxT = Math.max(maxT, sx[k] + sd[k])
  return { N, lanes, off, sx, sd, sc, sl, maxT }
}

const ROW = 6, ROWH = 5 // css px per lane, drawn height

// ---- CPU: cull + LOD merge into per-colour rect lists (x0,x1,lane triples, in CSS px)
function makeBuckets(cap) { return PAL.map(() => ({ a: new Float32Array(cap * 3), n: 0 })) }
function cull(L, view, W, laneLo, laneHi, B, lod) {
  for (const b of B) b.n = 0
  const k = W / (view.t1 - view.t0)
  let drawn = 0
  for (let l = laneLo; l < laneHi; l++) {
    let lo = L.off[l], hi = L.off[l + 1]
    // first span with end >= t0 (ends are sorted inside a lane because lanes do not overlap)
    let a = lo, b = hi
    while (a < b) { const mid = (a + b) >> 1; if (L.sx[mid] + L.sd[mid] < view.t0) a = mid + 1; else b = mid }
    let runX0 = -1, runX1 = -1, runC = 0
    for (let i = a; i < hi; i++) {
      const s = L.sx[i]; if (s > view.t1) break
      const x0 = (s - view.t0) * k, w = L.sd[i] * k
      const c = L.sc[i]
      if (!lod) { const bk = B[c]; const o = bk.n * 3; bk.a[o] = x0; bk.a[o + 1] = x0 + (w < 1 ? 1 : w); bk.a[o + 2] = l; bk.n++; drawn++; continue }
      const x1 = x0 + (w < 1 ? 1 : w)
      if (w >= 1) { // big span: flush any pending run, emit as is
        if (runX0 >= 0) { const bk = B[runC]; const o = bk.n * 3; bk.a[o] = runX0; bk.a[o + 1] = runX1; bk.a[o + 2] = l; bk.n++; drawn++; runX0 = -1 }
        const bk = B[c]; const o = bk.n * 3; bk.a[o] = x0; bk.a[o + 1] = x1; bk.a[o + 2] = l; bk.n++; drawn++
      } else if (runX0 >= 0 && x0 <= runX1 + 0.5) { // merge sub-pixel neighbours; errors win the colour
        if (x1 > runX1) runX1 = x1
        if (c === 5) runC = 5
      } else {
        if (runX0 >= 0) { const bk = B[runC]; const o = bk.n * 3; bk.a[o] = runX0; bk.a[o + 1] = runX1; bk.a[o + 2] = l; bk.n++; drawn++ }
        runX0 = x0; runX1 = x1; runC = c
      }
    }
    if (runX0 >= 0) { const bk = B[runC]; const o = bk.n * 3; bk.a[o] = runX0; bk.a[o + 1] = runX1; bk.a[o + 2] = l; bk.n++; drawn++ }
  }
  return drawn
}

export function canvas2d(host, L, W, H, dpr) {
  const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'
  host.appendChild(cv)
  const ctx = cv.getContext('2d', { alpha: false })
  ctx.scale(dpr, dpr)
  const B = makeBuckets(L.N)
  const cols = PAL.map(css), bg = css(BG)
  return {
    name: 'canvas2d', cv,
    sync() { ctx.getImageData(0, 0, 1, 1) }, // force raster + GPU completion so timings include it
    draw(view, lod) {
      const lanesVis = Math.ceil(H / ROW)
      const lo = Math.min(view.lane0, Math.max(0, L.lanes - 1)), hi = Math.min(L.lanes, lo + lanesVis)
      const n = cull(L, view, W, lo, hi, B, lod)
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
      for (let c = 0; c < B.length; c++) {
        const b = B[c]; if (!b.n) continue
        ctx.fillStyle = cols[c]
        const a = b.a
        for (let i = 0; i < b.n; i++) { const o = i * 3; ctx.fillRect(a[o], (a[o + 2] - lo) * ROW, a[o + 1] - a[o], ROWH) }
      }
      return n
    },
  }
}

const VS = `#version 300 es
in vec2 a_c; in vec4 i_a; in float i_c;   // i_a = (hi, lo, dur, lane)
uniform vec2 u_view;      // (hi, lo) of view start
uniform vec4 u_p;         // scale px per unit, W, H, lane0
uniform float u_row, u_rowh, u_minw;
out float v_c;
void main(){
  float x0 = ((i_a.x - u_view.x) + (i_a.y - u_view.y)) * u_p.x;
  float w = max(i_a.z * u_p.x, u_minw);
  float px = x0 + a_c.x * w;
  float py = (i_a.w - u_p.w) * u_row + a_c.y * u_rowh;
  gl_Position = vec4(px / u_p.y * 2.0 - 1.0, 1.0 - py / u_p.z * 2.0, 0.0, 1.0);
  v_c = i_c;
}`
const FS = `#version 300 es
precision mediump float;
uniform vec3 u_pal[6]; in float v_c; out vec4 o;
void main(){ o = vec4(u_pal[int(v_c + 0.5)], 1.0); }`

export function webgl2(host, L, W, H, dpr) {
  const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'
  host.appendChild(cv)
  const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
  const prog = compile(gl, VS, FS); gl.useProgram(prog)
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const ac = gl.getAttribLocation(prog, 'a_c'); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0)
  const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst)
  const ia = gl.getAttribLocation(prog, 'i_a'), ic = gl.getAttribLocation(prog, 'i_c')
  gl.enableVertexAttribArray(ia); gl.vertexAttribPointer(ia, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(ia, 1)
  gl.enableVertexAttribArray(ic); gl.vertexAttribPointer(ic, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(ic, 1)
  const U = (n) => gl.getUniformLocation(prog, n)
  const u = { view: U('u_view'), p: U('u_p'), row: U('u_row'), rowh: U('u_rowh'), minw: U('u_minw'), pal: U('u_pal') }
  gl.uniform3fv(u.pal, new Float32Array(PAL.flat())); gl.uniform1f(u.row, ROW * dpr); gl.uniform1f(u.rowh, ROWH * dpr)
  gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(BG[0], BG[1], BG[2], 1)
  const B = makeBuckets(L.N)
  // static instances (all spans, uploaded once): hi/lo split keeps float32 exact enough at 1e11 us extents
  const all = new Float32Array(L.N * 5)
  for (let i = 0; i < L.N; i++) { const hi = Math.fround(L.sx[i]); all[i * 5] = hi; all[i * 5 + 1] = L.sx[i] - hi; all[i * 5 + 2] = L.sd[i]; all[i * 5 + 3] = L.sl[i]; all[i * 5 + 4] = L.sc[i] }
  const dyn = new Float32Array(L.N * 5), px = new Uint8Array(4)
  let uploaded = false
  return {
    name: 'webgl2', cv, gl,
    sync() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) },
    draw(view, lod) {
      let n
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindBuffer(gl.ARRAY_BUFFER, inst)
      if (!lod) {
        if (!uploaded) { gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW); uploaded = true }
        const hi = Math.fround(view.t0)
        gl.uniform2f(u.view, hi, view.t0 - hi)
        gl.uniform4f(u.p, (W / (view.t1 - view.t0)) * dpr, W * dpr, H * dpr, view.lane0)
        gl.uniform1f(u.minw, 1 * dpr)
        n = L.N
      } else { // CPU cull+merge, upload only what is visible; coords already in css px
        uploaded = false
        const lanesVis = Math.ceil(H / ROW), lo = Math.min(view.lane0, Math.max(0, L.lanes - 1)), hi2 = Math.min(L.lanes, lo + lanesVis)
        cull(L, view, W, lo, hi2, B, true)
        n = 0
        for (let c = 0; c < B.length; c++) { const b = B[c]; for (let i = 0; i < b.n; i++) { const o = i * 3, q = n * 5; dyn[q] = b.a[o]; dyn[q + 1] = 0; dyn[q + 2] = b.a[o + 1] - b.a[o]; dyn[q + 3] = b.a[o + 2]; dyn[q + 4] = c; n++ } }
        gl.bufferData(gl.ARRAY_BUFFER, dyn.subarray(0, n * 5), gl.DYNAMIC_DRAW)
        gl.uniform2f(u.view, 0, 0); gl.uniform4f(u.p, dpr, W * dpr, H * dpr, lo); gl.uniform1f(u.minw, 1 * dpr)
      }
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
      return n
    },
  }
}

// scripted interaction (deterministic in frame index): hold fully zoomed out (every span eligible) while scrolling lanes,
// zoom in to 3% of the extent, pan across it, zoom back out.
export const PHASES = ['full', 'zoomIn', 'pan', 'zoomOut']
export function viewAt(i, frames, maxT, lanes) {
  const q = frames / 4, ph = Math.min(3, Math.floor(i / q)), f = (i - ph * q) / q
  const zoomed = maxT * 0.03, focus = maxT * 0.4
  let span, centre
  if (ph === 0) { span = maxT * (1 - 0.01 * Math.sin(f * 20)); centre = maxT / 2 }
  else if (ph === 1) { span = maxT * Math.pow(zoomed / maxT, f); centre = maxT / 2 + (focus - maxT / 2) * f }
  else if (ph === 2) { span = zoomed; centre = focus + (f - 0.5) * zoomed * 2 }
  else { span = zoomed * Math.pow(maxT / zoomed, f); centre = focus + (maxT / 2 - focus) * f }
  return { t0: centre - span / 2, t1: centre + span / 2, lane0: Math.floor((Math.sin(i / 20) * 0.5 + 0.5) * Math.max(0, lanes - 100)), phase: ph }
}
