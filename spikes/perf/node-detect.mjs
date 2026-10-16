// THROWAWAY spike. Node-side detection timing. usage: node node-detect.mjs <file>
import fs from 'node:fs'
import { detect, detectPrecise } from './src/detect.js'
const f = await fs.openAsBlob(process.argv[2])
const r = []
for (let i = 0; i < 7; i++) { const t0 = performance.now(); const d = await detect(f); r.push({ ms: performance.now() - t0, d }) }
r.sort((a, b) => a.ms - b.ms)
const q=[];for(let i=0;i<7;i++){const t0=performance.now();const d=await detectPrecise(f);q.push({ms:performance.now()-t0,d})}q.sort((a,b)=>a.ms-b.ms)
console.log(JSON.stringify({ file: process.argv[2].split('/').pop(), sizeMB: +(f.size / 1e6).toFixed(1), medianMs: +r[3].ms.toFixed(2), minMs: +r[0].ms.toFixed(2), maxMs: +r[6].ms.toFixed(2), result: r[3].d, preciseMedianMs: +q[3].ms.toFixed(2), preciseResult: q[3].d }))
