import { Trace } from '@ggx/trace-model'
import type { Loaded } from './load'
import type { WorkerRequest, WorkerResponse } from './worker'

let worker: Worker | undefined

/** Parse, detect and analyse off the main thread so the page stays responsive on large files. */
export function loadInWorker(name: string, source: File | string, subagents?: WorkerRequest['subagents']): Promise<Loaded> {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      cleanup()
      const r = e.data
      if (!r.ok) return reject(new Error(r.error))
      resolve({
        name: r.name,
        detection: r.detection,
        trace: Trace.fromTransfer(r.trace),
        findings: r.findings,
        summary: r.summary,
        traceCount: r.traceCount,
      })
    }
    const onError = (e: ErrorEvent) => {
      cleanup()
      worker = undefined
      reject(new Error(e.message || 'The reader crashed. Try a smaller file.'))
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ name, source, ...(subagents?.length ? { subagents } : {}) } satisfies WorkerRequest)
  })
}
