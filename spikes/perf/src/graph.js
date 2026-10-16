// THROWAWAY spike. Graph canvas bench: layout in worker, Canvas 2D vs WebGL2 draw with viewport culling.
import { PAL, css, BG, loadModel, stats, nextFrame, glInfo, compile } from './common.js'
import { NW, NH } from './graph-layout.js'

export const KN = ['step', 'agent', 'llm', 'tool', 'chain']
export function sub(m, n) { return { N: Math.min(n, m.N), start: m.start, dur: m.dur, parent: m.parent, kind: m.kind, err: m.err } }

export function runLayout(model, algo) {
  return new Promise((res) => {
    const w = new Worker('./layout-worker.js', { type: 'module' })
    const t0 = performance.now()
    w.onmessage = (e) => { const roundTrip = performance.now() - t0; w.terminate(); res({ ...e.data, roundTripMs: roundTrip }) }
    // copy (not transfer) the model so it can be reused; this copy is part of the round trip
    w.postMessage({ algo, model: { N: model.N, start: model.start.slice(0, model.N), dur: model.dur.slice(0, model.N), parent: model.parent.slice(0, model.N), kind: model.kind.slice(0, model.N), err: model.err.slice(0, model.N) } })
  })
}

export const PHASES = ['fit', 'zoomIn', 'pan', 'zoomOut']
export function view(i, frames, W, H, bounds) {
  const fit = Math.min(W / (bounds.w + 100), H / (bounds.h + 100))
  const q = frames / 4, ph = Math.min(3, Math.floor(i / q)), f = (i - ph * q) / q, zmax = 1.0
  const fx = bounds.w * 0.3, fy = bounds.h * 0.2
  let z, cx, cy
  if (ph === 0) { z = fit * (1 + 0.01 * Math.sin(f * 20)); cx = bounds.w / 2; cy = bounds.h / 2 } // hold fully zoomed out: everything eligible
  else if (ph === 1) { z = fit * Math.pow(zmax / fit, f); cx = bounds.w / 2 + (fx - bounds.w / 2) * f; cy = bounds.h / 2 + (fy - bounds.h / 2) * f }
  else if (ph === 2) { z = zmax; cx = fx + (f - 0.5) * 4000; cy = fy + Math.sin(f * 6) * 300 }
  else { z = zmax * Math.pow(fit / zmax, f); cx = fx + (bounds.w / 2 - fx) * f; cy = fy + (bounds.h / 2 - fy) * f }
  return { z, cx, cy, phase: ph }
}

export function c2d(host, G, W, H, dpr, labels, lod = true) {
  const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; host.appendChild(cv)
  const ctx = cv.getContext('2d', { alpha: false })
  const cols = PAL.map(css), bg = css(BG)
  const vis = PAL.map(() => new Int32Array(G.N))
  const vn = new Int32Array(PAL.length)
  return {
    name: 'canvas2d' + (labels ? '+labels' : '') + (lod ? '+lod' : ''), cv,
    sync() { ctx.getImageData(0, 0, 1, 1) },
    draw(v) {
      // Screen-space drawing: world->screen is done in JS (x*s+tx) so the 2D context never sees huge coordinates.
      const s = v.z, tx = W / 2 - v.cx * s, ty = H / 2 - v.cy * s
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
      const x0 = -tx / s - NW, x1 = (W - tx) / s, y0 = -ty / s - NH, y1 = (H - ty) / s
      ctx.beginPath(); let ec = 0
      const curve = s > 0.25, hw = NW / 2 * s, nh = NH * s
      for (let e = 0; e < G.E; e++) {
        const a = G.src[e], b = G.dst[e]
        const wax = G.x[a] + NW / 2, way = G.y[a] + NH, wbx = G.x[b] + NW / 2, wby = G.y[b]
        if ((wax < x0 && wbx < x0) || (wax > x1 && wbx > x1) || (way < y0 && wby < y0) || (way > y1 && wby > y1)) continue
        const ax = wax * s + tx, ay = way * s + ty, bx = wbx * s + tx, by = wby * s + ty
        if (lod && Math.abs(bx - ax) + Math.abs(by - ay) < 3) continue // sub-pixel edge: skip
        ctx.moveTo(ax, ay)
        if (curve) { const my = (ay + by) / 2; ctx.bezierCurveTo(ax, my, bx, my, bx, by) } else ctx.lineTo(bx, by)
        ec++
      }
      ctx.strokeStyle = '#556072'; ctx.lineWidth = 1.2; ctx.stroke()
      vn.fill(0); let nc = 0
      for (let i = 0; i < G.N; i++) {
        const x = G.x[i], y = G.y[i]
        if (x < x0 || x > x1 || y < y0 || y > y1) continue
        const c = G.c[i]; vis[c][vn[c]++] = i; nc++
      }
      const nw = NW * s, small = nw < 4
      for (let c = 0; c < PAL.length; c++) {
        ctx.fillStyle = cols[c]
        const a = vis[c]
        if (small) for (let k = 0; k < vn[c]; k++) { const i = a[k]; ctx.fillRect(G.x[i] * s + tx, G.y[i] * s + ty, 2, 2) } // sub-pixel node: min dot
        else { ctx.beginPath(); for (let k = 0; k < vn[c]; k++) { const i = a[k]; if (s > 0.35) ctx.roundRect(G.x[i] * s + tx, G.y[i] * s + ty, nw, nh, 8 * s); else ctx.rect(G.x[i] * s + tx, G.y[i] * s + ty, nw, nh) } ctx.fill() }
      }
      if (labels && s > 0.5) {
        ctx.fillStyle = '#e5e9f0'; ctx.font = '14px sans-serif'; ctx.textBaseline = 'middle'
        for (let c = 0; c < PAL.length; c++) for (let k = 0; k < vn[c]; k++) { const i = vis[c][k]; ctx.fillText(G.label[i], G.x[i] * s + tx + 10 * s, G.y[i] * s + ty + nh / 2) }
      }
      return nc + ec
    },
  }
}

const NVS = `#version 300 es
in vec2 a_c; in vec4 i_r; in float i_c; // node: x,y,w,h
uniform vec4 u_v; // scale, tx, ty (css px), unused
uniform vec2 u_s; // W,H css
uniform float u_minpx;
out float v_c; out vec2 v_uv;
void main(){
  vec2 size = max(i_r.zw * u_v.x, vec2(u_minpx));
  vec2 p = vec2(i_r.x, i_r.y) * u_v.x + vec2(u_v.y, u_v.z) + a_c * size;
  gl_Position = vec4(p.x / u_s.x * 2.0 - 1.0, 1.0 - p.y / u_s.y * 2.0, 0.0, 1.0);
  v_c = i_c; v_uv = a_c;
}`
const NFS = `#version 300 es
precision mediump float;
uniform vec3 u_pal[6]; in float v_c; in vec2 v_uv; out vec4 o;
void main(){ vec2 e = min(v_uv, 1.0 - v_uv); float edge = step(min(e.x * 0.12, e.y), 0.05); o = vec4(u_pal[int(v_c + 0.5)] * (1.0 - 0.25 * step(e.y, 0.06)), 1.0); }`
const EVS = `#version 300 es
in vec4 i_e; // x0,y0,x1,y1 (world)
uniform vec4 u_v; uniform vec2 u_s;
void main(){
  vec2 w = gl_VertexID == 0 ? i_e.xy : i_e.zw;
  vec2 p = w * u_v.x + vec2(u_v.y, u_v.z);
  gl_Position = vec4(p.x / u_s.x * 2.0 - 1.0, 1.0 - p.y / u_s.y * 2.0, 0.0, 1.0);
}`
const EFS = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(0.33, 0.38, 0.45, 1.0); }`

export function gl2(host, G, W, H, dpr, labels) {
  const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; host.appendChild(cv)
  let ov = null, octx = null
  if (labels) { ov = document.createElement('canvas'); ov.width = W * dpr; ov.height = H * dpr; ov.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none`; host.style.position = 'relative'; host.appendChild(ov); octx = ov.getContext('2d') }
  const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
  gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(BG[0], BG[1], BG[2], 1)
  const np = compile(gl, NVS, NFS), ep = compile(gl, EVS, EFS)
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  // nodes
  const nv = gl.createVertexArray(); gl.bindVertexArray(nv)
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); let l = gl.getAttribLocation(np, 'a_c'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0)
  const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb)
  const nd = new Float32Array(G.N * 5); for (let i = 0; i < G.N; i++) { nd[i * 5] = G.x[i]; nd[i * 5 + 1] = G.y[i]; nd[i * 5 + 2] = NW; nd[i * 5 + 3] = NH; nd[i * 5 + 4] = G.c[i] }
  gl.bufferData(gl.ARRAY_BUFFER, nd, gl.STATIC_DRAW)
  l = gl.getAttribLocation(np, 'i_r'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(l, 1)
  l = gl.getAttribLocation(np, 'i_c'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(l, 1)
  // edges
  const ev = gl.createVertexArray(); gl.bindVertexArray(ev)
  const eb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, eb)
  const ed = new Float32Array(G.E * 4); for (let e = 0; e < G.E; e++) { const a = G.src[e], b = G.dst[e]; ed[e * 4] = G.x[a] + NW / 2; ed[e * 4 + 1] = G.y[a] + NH; ed[e * 4 + 2] = G.x[b] + NW / 2; ed[e * 4 + 3] = G.y[b] }
  gl.bufferData(gl.ARRAY_BUFFER, ed, gl.STATIC_DRAW)
  l = gl.getAttribLocation(ep, 'i_e'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(l, 1)
  const px = new Uint8Array(4)
  const U = (p, n) => gl.getUniformLocation(p, n)
  const un = { v: U(np, 'u_v'), s: U(np, 'u_s'), m: U(np, 'u_minpx'), pal: U(np, 'u_pal') }, ue = { v: U(ep, 'u_v'), s: U(ep, 'u_s') }
  gl.useProgram(np); gl.uniform3fv(un.pal, new Float32Array(PAL.flat()))
  return {
    name: 'webgl2' + (labels ? '+labelOverlay' : ''), cv, gl,
    sync() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (octx) octx.getImageData(0, 0, 1, 1) },
    draw(v) {
      const s = v.z * dpr, tx = (W / 2 - v.cx * v.z) * dpr, ty = (H / 2 - v.cy * v.z) * dpr
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(ep); gl.bindVertexArray(ev); gl.uniform4f(ue.v, s, tx, ty, 0); gl.uniform2f(ue.s, W * dpr, H * dpr)
      gl.drawArraysInstanced(gl.LINES, 0, 2, G.E)
      gl.useProgram(np); gl.bindVertexArray(nv); gl.uniform4f(un.v, s, tx, ty, 0); gl.uniform2f(un.s, W * dpr, H * dpr); gl.uniform1f(un.m, 2 * dpr)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, G.N)
      let extra = 0
      if (labels) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, W, H)
        if (v.z > 0.5) {
          const x0 = (-(W / 2) / v.z) + v.cx - NW, x1 = (W / 2) / v.z + v.cx, y0 = -(H / 2) / v.z + v.cy - NH, y1 = (H / 2) / v.z + v.cy
          octx.fillStyle = '#e5e9f0'; octx.font = '14px sans-serif'; octx.textBaseline = 'middle'
          const z = v.z, ox = W / 2 - v.cx * z, oy = H / 2 - v.cy * z
          for (let i = 0; i < G.N; i++) { const x = G.x[i], y = G.y[i]; if (x < x0 || x > x1 || y < y0 || y > y1) continue; octx.fillText(G.label[i], x * z + ox + 10 * z, y * z + oy + NH * z / 2); extra++ }
        }
      }
      return G.N + G.E + extra
    },
  }
}

