// THROWAWAY spike. Prints the markdown tables used in docs/verification/perf-spike.md from results/*.json
import fs from 'node:fs'
const R = (n) => JSON.parse(fs.readFileSync(`results/${n}.json`, 'utf8'))
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const f = (x, d = 1) => (x === undefined || x === null ? '-' : Number(x).toFixed(d))
const table = (h, rows) => [`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

console.log('### parse (browser, median of 3)')
{
  const P = R('parse-browser'); const keys = [...new Set(P.map((r) => `${r.file}|${r.mode}|${r.variant}`))]
  const rows = keys.map((k) => { const g = P.filter((r) => `${r.file}|${r.mode}|${r.variant}` === k); const [file, mode, variant] = k.split('|'); return [file, mode, variant, f(med(g.map((r) => r.totalMs))), f(med(g.map((r) => r.firstSpansMs))), f(med(g.map((r) => r.maxFrameGapMs))), f(med(g.map((r) => r.extraPeakMB)), 0), f(med(g.map((r) => r.heapAfterMB)), 0)] })
  console.log(table(['file', 'thread', 'strategy', 'total ms', 'first spans ms', 'max frame gap ms', 'peak extra RSS MB', 'main JS heap after MB'], rows))
}
console.log('\n### parse (node, median of 3)')
console.log(table(['file', 'strategy', 'keep text', 'total ms', 'first chunk ms', 'JSON.parse ms', 'retained heap MB', 'peak RSS MB'], R('parse-node').map((r) => [r.file, r.variant, r.keepText ? 'yes' : 'no', f(r.ms), f(r.firstChunkMs), f(r.jsonParseMs), f(r.retainedHeapMB), f(r.peakRssMB, 0)])))
console.log('\n### detect browser')
console.log(table(['file', 'size MB', 'sniff median ms', 'sniff max ms', 'precise median ms', 'result'], R('detect-browser').map((r) => [r.file, f(r.size / 1e6), f(r.medianMs, 2), f(r.maxMs, 2), f(r.preciseMedianMs, 2), `${r.result.container}/${r.result.flavour}`])))
console.log('\n### detect node')
console.log(table(['file', 'size MB', 'sniff median ms', 'precise median ms'], R('detect-node').map((r) => [r.file, r.sizeMB, r.medianMs, r.preciseMedianMs])))
console.log('\n### timeline')
{
  const T = R('timeline')
  for (const [g, c] of [['gpu', 1], ['gpu', 4], ['sw', 1]]) {
    console.log(`\n#### ${g} cpu x${c}`)
    console.log(table(['spans', 'renderer', 'LOD', 'draw+GPU p50 ms', 'p95', 'full-extent p50 / p95', 'rects/frame (full)', 'setup ms', 'lane prep ms'], T.filter((r) => r.gpuMode === g && r.cpuThrottle === c).map((r) => [r.n, r.renderer, r.lod ? 'merge' : 'none', f(r.drawSyncMs.p50, 2), f(r.drawSyncMs.p95, 2), `${f(r.perPhase.full.drawSync.p50, 2)} / ${f(r.perPhase.full.drawSync.p95, 2)}`, r.perPhase.full.rects, f(r.setupMs), f(r.prepMs)])))
  }
  const r0 = T[0]; console.log('\nGPU strings:', [...new Set(T.map((r) => r.gpuMode + ': ' + r.gpu))].join(' ; '), 'lanes@100k', T.find((r) => r.n === 100000).lanes, 'lanes@10k', T.find((r) => r.n === 10000).lanes)
}
console.log('\n### graph')
{
  const G = R('graph')
  const L = G.find((r) => r.gpuMode === 'gpu' && r.cpuThrottle === 1 && r.n === 1000).layoutStats, L2 = G.find((r) => r.gpuMode === 'gpu' && r.cpuThrottle === 1 && r.n === 10000).layoutStats
  console.log('layout 1k', JSON.stringify(L), '\nlayout 10k', JSON.stringify(L2))
  for (const [g, c] of [['gpu', 1], ['gpu', 4], ['sw', 1]]) {
    console.log(`\n#### ${g} cpu x${c}`)
    console.log(table(['nodes', 'edges', 'renderer', 'labels', 'LOD', 'draw+GPU p50 ms', 'p95', 'fit-all p50', 'zoom-in p50', 'pan p50', 'setup ms'], G.filter((r) => r.gpuMode === g && r.cpuThrottle === c).map((r) => [r.n, r.edges, r.mode, r.labels ? 'yes' : 'no', r.mode === 'canvas2d' ? (r.lod ? 'edge-skip' : 'none') : 'GPU', f(r.drawSyncMs.p50, 2), f(r.drawSyncMs.p95, 2), f(r.perPhase.fit.p50, 2), f(r.perPhase.zoomIn.p50, 2), f(r.perPhase.pan.p50, 2), f(r.setupMs)])))
  }
}
console.log('\n### shell')
{
  const S = R('shell')
  console.log(table(['app', 'JS raw KB', 'JS gzip KB', 'JS brotli KB', 'cold TTI ms (x1)', 'x4 CPU', 'x4 CPU + 4G', 'FCP x1'], ['vanilla', 'preact', 'solid'].map((a) => { const c = (k) => S.find((r) => r.app === a && r.kind === k); const z = c('cold').size.js; return [a, f(z.raw / 1024), f(z.gzip / 1024, 2), f(z.brotli / 1024, 2), f(c('cold').readyMs), f(c('cold-x4cpu').readyMs), f(c('cold-x4cpu-4g').readyMs), f(c('cold').fcpMs)] })))
  console.log(table(['app', 'cpu', 'select->DOM p50/p95 ms', 'select->paint p50/p95', 'scroll re-render p50/p95', 'scroll->paint p50/p95'], S.filter((r) => r.kind.startsWith('interact')).map((r) => [r.app, r.kind.split('-')[1], `${r.selectDomMs.p50} / ${r.selectDomMs.p95}`, `${r.selectToPaintMs.p50} / ${r.selectToPaintMs.p95}`, `${r.scrollDomMs.p50} / ${r.scrollDomMs.p95}`, `${r.scrollToPaintMs.p50} / ${r.scrollToPaintMs.p95}`])))
}
console.log('\n### sizes'); const Z = R('sizes'); console.log(table(['piece', 'min KB', 'gzip KB', 'brotli KB'], Object.entries(Z).map(([k, v]) => [k, v.minKB, v.gzipKB, v.brotliKB])))
