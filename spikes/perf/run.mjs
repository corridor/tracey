// THROWAWAY spike. Benchmark orchestrator. usage: node run.mjs [parse|detect|timeline|graph|shell|node|all ...]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(path.dirname(fileURLToPath(import.meta.url)), '.browsers')
const { chromium } = await import('playwright')
const root = path.dirname(fileURLToPath(import.meta.url))
const stages = process.argv.slice(2).length ? process.argv.slice(2) : ['all']
const want = (s) => stages.includes('all') || stages.includes(s)
const save = (n, v) => { fs.mkdirSync(path.join(root, 'results'), { recursive: true }); fs.writeFileSync(path.join(root, 'results', n + '.json'), JSON.stringify(v, null, 1)); console.error('saved', n) }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.bin': 'application/octet-stream', '.json': 'application/json' }

// static server: gzips text assets like a real CDN would; data/ is served raw
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0])
  const f = path.join(root, u)
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  const ext = path.extname(f), body = fs.readFileSync(f)
  const h = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } // COOP/COEP => 5us timer resolution
  if (/\.(html|js|css)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { h['content-encoding'] = 'gzip'; res.writeHead(200, h); return res.end(zlib.gzipSync(body)) }
  res.writeHead(200, h); res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const FLAGS = { sw: [], gpu: ['--use-angle=metal'] } // sw = SwiftShader software GL (Playwright default), gpu = real Apple GPU via ANGLE/Metal
const COMMON = ['--enable-precise-memory-info', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']
const launch = (gpu = 'gpu') => chromium.launch({ headless: true, args: [...COMMON, ...FLAGS[gpu]] })
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }

function rssMB() { // total RSS of all processes started from the spike's private chromium
  const out = execSync(`ps -axo rss=,command=`, { encoding: 'utf8', maxBuffer: 1 << 26 })
  let kb = 0; for (const l of out.split('\n')) if (l.includes(path.join(root, '.browsers'))) kb += parseInt(l, 10)
  return kb / 1024
}
async function withPeak(fn) {
  const idle = rssMB(); let peak = idle, stop = false
  const t = (async () => { while (!stop) { peak = Math.max(peak, rssMB()); await new Promise((r) => setTimeout(r, 40)) } })()
  try { return { out: await fn(), peakRssMB: +peak.toFixed(0), idleRssMB: +idle.toFixed(0), extraPeakMB: +(Math.max(peak, rssMB()) - idle).toFixed(0) } } finally { stop = true; await t }
}

if (want('parse') || want('detect')) {
  const b = await launch('gpu')
  const files = [['1k (2.1MB)', 'trace-1000'], ['1k (5.3MB)', 'trace-1000-5mb'], ['10k (23MB)', 'trace-10000'], ['100k (241MB)', 'trace-100000']]
  const parse = [], detect = []
  for (const [label, f] of files) for (let rep = 0; rep < 3; rep++) {
    if (want('parse')) for (const mode of ['main', 'worker']) for (const variant of ['whole', 'lines', 'scan']) {
      const page = await b.newPage(); await page.goto(`${base}/dist/parse.html`)
      await page.setInputFiles('#f', path.join(root, 'data', f + (variant === 'whole' ? '.json' : '.jsonl')))
      await page.waitForTimeout(300) // let the file-chooser settle so idle RSS is stable
      const r = await withPeak(() => page.evaluate(([m, v]) => window.runParse(m, v), [mode, variant]))
      parse.push({ file: label, rep, ...r.out, peakRssMB: r.peakRssMB, idleRssMB: r.idleRssMB, extraPeakMB: r.extraPeakMB })
      await page.close()
      console.error('parse', label, mode, variant, parse.at(-1).totalMs, 'first', parse.at(-1).firstSpansMs, 'extraPeak', r.extraPeakMB)
    }
    if (want('detect') && rep === 0) {
      const page = await b.newPage(); await page.goto(`${base}/dist/parse.html`)
      await page.setInputFiles('#f', path.join(root, 'data', f + '.jsonl'))
      detect.push({ file: label, ...(await page.evaluate(() => window.runDetect())) }); await page.close()
    }
  }
  if (parse.length) save('parse-browser', parse)
  if (detect.length) save('detect-browser', detect)
  await b.close()
}

async function renderStage(name, page_, cases, configs) {
  const out = []
  for (const cfg of configs) {
    const b = await launch(cfg.gpu)
    for (const c of cases) {
      const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => console.error('PAGEERROR', e.message))
      await page.goto(`${base}/dist/${page_}.html`)
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cfg.cpu })
      try {
        const r = await page.evaluate((a) => window[a.fn](a.args), { fn: name, args: c })
        out.push({ gpuMode: cfg.gpu, cpuThrottle: cfg.cpu, ...r })
        console.error(name, cfg.gpu, 'x' + cfg.cpu, JSON.stringify(c), 'draw+sync p50/p95', r.drawSyncMs.p50, r.drawSyncMs.p95, 'idle', r.idleSyncMs.p50, 'js p50', r.jsMs.p50, 'setup', r.setupMs)
      } catch (e) { console.error('FAIL', JSON.stringify(c), e.message); out.push({ gpuMode: cfg.gpu, cpuThrottle: cfg.cpu, ...c, error: e.message }) }
      await ctx.close()
    }
    await b.close()
  }
  return out
}
const CONFIGS = [{ gpu: 'gpu', cpu: 1 }, { gpu: 'gpu', cpu: 4 }, { gpu: 'sw', cpu: 1 }]

if (want('timeline')) {
  const cases = []
  for (const n of [10000, 100000]) for (const [renderer, lod] of [['canvas2d', false], ['canvas2d', true], ['webgl2', false], ['webgl2', true]]) cases.push({ n, renderer, lod })
  save('timeline', await renderStage('runTimeline', 'timeline', cases, CONFIGS))
}
if (want('graph')) {
  const cases = []
  for (const n of [1000, 10000]) for (const [mode, labels, lod] of [['canvas2d', true, true], ['canvas2d', false, true], ['canvas2d', false, false], ['webgl2', false, true], ['webgl2', true, true]]) cases.push({ n, mode, labels, lod })
  if (process.env.QUICK) { console.error(JSON.stringify((await renderStage('runGraph', 'graph', cases.filter((c) => c.n === 10000), CONFIGS.slice(0, 1))).map((r) => [r.mode, r.labels, Object.fromEntries(Object.entries(r.perPhase).map(([k, v]) => [k, v.p50]))]))); server.close(); process.exit(0) }
  save('graph', await renderStage('runGraph', 'graph', cases, CONFIGS))
}

if (want('shell')) {
  const res = []
  const b = await launch('gpu')
  const APPS = ['vanilla', 'preact', 'solid']
  const sizes = {}
  for (const app of APPS) {
    const dir = path.join(root, 'dist/shell', app, 'assets')
    sizes[app] = Object.fromEntries(fs.readdirSync(dir).map((f) => { const buf = fs.readFileSync(path.join(dir, f)); return [f.endsWith('.js') ? 'js' : 'css', { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, brotli: zlib.brotliCompressSync(buf).length }] }))
  }
  // cold start: runs are interleaved across apps so machine drift/warm-up hits every app equally
  for (const [label, cpu, net] of [['cold', 1, null], ['cold-x4cpu', 4, null], ['cold-x4cpu-4g', 4, { downloadThroughput: (9 * 1e6) / 8, uploadThroughput: (9 * 1e6) / 8, latency: 170 }]]) {
    const T = Object.fromEntries(APPS.map((a) => [a, { ready: [], fcp: [] }]))
    for (let i = 0; i < 25; i++) for (const app of APPS) {
      const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
      if (net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net }) }
      await page.goto(`${base}/dist/shell/${app}/index.html`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__ready)
      const m = await page.evaluate(() => ({ ready: window.__ready, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime }))
      if (i >= 3) { T[app].ready.push(m.ready); T[app].fcp.push(m.fcp) }
      await ctx.close()
    }
    for (const app of APPS) { const t = T[app].ready; res.push({ app, kind: label, size: sizes[app], readyMs: +med(t).toFixed(1), readyMin: +Math.min(...t).toFixed(1), readyMax: +Math.max(...t).toFixed(1), fcpMs: +med(T[app].fcp).toFixed(1) }); console.error('shell', app, label, med(t)) }
  }
  for (const app of APPS) {
    // interaction cost
    for (const cpu of [1, 4]) {
      const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
      await page.goto(`${base}/dist/shell/${app}/index.html`); await page.waitForFunction(() => window.__ready)
      const r = await page.evaluate(async () => {
        const q = (a) => { const s = [...a].sort((x, y) => x - y); return { p50: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s.at(-1).toFixed(2) } }
        const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        const mo = (el) => new Promise((res) => { const t0 = performance.now(); const o = new MutationObserver(() => { o.disconnect(); res(performance.now() - t0) }); o.observe(el, { childList: true, subtree: true, attributes: true }); mo.start(); })
        const list = document.getElementById('list'), insp = document.getElementById('insp')
        const sel = [], selPaint = [], scr = [], scrPaint = []
        await nextFrame()
        for (let k = 0; k < 100; k++) {
          const rows = [...document.querySelectorAll('.row')].filter((r) => r.style.display !== 'none')
          const row = rows[(k * 7) % Math.min(rows.length, 20)]
          const t0 = performance.now(); let tm
          const p = new Promise((res) => { const o = new MutationObserver(() => { o.disconnect(); res(performance.now() - t0) }); o.observe(insp, { childList: true, subtree: true, attributes: true, characterData: true }) })
          row.click(); tm = await p; sel.push(tm)
          await nextFrame(); selPaint.push(performance.now() - t0)
          await new Promise((r) => setTimeout(r, 20))
        }
        for (let k = 0; k < 100; k++) {
          const spacer = document.getElementById('spacer')
          const t0 = performance.now()
          const p = new Promise((res) => { const o = new MutationObserver(() => { o.disconnect(); res(performance.now() - t0) }); o.observe(spacer, { childList: true, subtree: true, attributes: true, characterData: true }) })
          list.scrollTop = ((k * 3571) % 9000) * 28 + 14 + (k % 2) * 700
          list.dispatchEvent(new Event('scroll'))
          scr.push(await p); await nextFrame(); scrPaint.push(performance.now() - t0)
          await new Promise((r) => setTimeout(r, 10))
        }
        return { selectDomMs: q(sel), selectToPaintMs: q(selPaint), scrollDomMs: q(scr), scrollToPaintMs: q(scrPaint), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null, rowsInDom: document.querySelectorAll('.row').length }
      })
      res.push({ app, kind: 'interact-x' + cpu, ...r }); console.error('shell interact', app, cpu, JSON.stringify(r.selectDomMs), JSON.stringify(r.scrollDomMs))
      await ctx.close()
    }
  }
  save('shell', res); await b.close()
}

if (want('node')) {
  const res = []
  const jobs = [['whole', 'trace-1000-5mb.json'], ['lines', 'trace-1000-5mb.jsonl'], ['scan', 'trace-1000-5mb.jsonl'], ['whole', 'trace-10000.json'], ['lines', 'trace-10000.jsonl'], ['scan', 'trace-10000.jsonl'], ['whole', 'trace-100000.json'], ['lines', 'trace-100000.jsonl'], ['scan', 'trace-100000.jsonl'], ['scan', 'trace-100000.jsonl', 'keep'], ['lines', 'trace-100000.jsonl', 'keep'], ['whole', 'trace-100000.json', 'keep']]
  for (const [v, f, k] of jobs) {
    const rs = []
    for (let i = 0; i < 3; i++) rs.push(JSON.parse(execFileSync('node', ['--expose-gc', path.join(root, 'node-parse.mjs'), v, path.join(root, 'data', f), ...(k ? [k] : [])], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').pop()))
    rs.sort((a, b) => a.ms - b.ms); res.push({ ...rs[1], runsMs: rs.map((r) => r.ms) }); console.error('node', v, f, k || '', rs[1].ms, rs[1].peakRssMB)
  }
  save('parse-node', res)
  const det = ['trace-1000-5mb', 'trace-10000', 'trace-100000'].map((f) => JSON.parse(execFileSync('node', [path.join(root, 'node-detect.mjs'), path.join(root, 'data', f + '.jsonl')], { encoding: 'utf8' })))
  save('detect-node', det)
}
server.close()
