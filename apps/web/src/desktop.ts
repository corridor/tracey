/**
 * Bridge to the desktop shell (Tauri). The website knows nothing about Tauri at build time: the shell
 * exposes `window.__TAURI__` and this module uses it only when present, so the web build is unchanged.
 */
interface TauriGlobal {
  core: { invoke: (cmd: string, args?: object) => Promise<unknown>; convertFileSrc: (path: string) => string }
  event: { listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> }
}

export const tauri = (): TauriGlobal | undefined => (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__

export const isDesktop = () => tauri() !== undefined

/** Read a local file the OS asked us to open, through the shell's asset protocol, as a File. */
export async function fileFromPath(path: string): Promise<File> {
  const t = tauri()!
  const res = await fetch(t.core.convertFileSrc(path))
  if (!res.ok) throw new Error(`Could not read ${path}`)
  const name = path.split(/[\\/]/).pop() ?? 'trace'
  return new File([await res.blob()], name)
}

/** Open the file the app was launched with, and any file opened later ("Open with tracey"). */
export function listenForOpens(open: (file: File) => void): void {
  const t = tauri()
  if (!t) return
  const handle = async (path: unknown) => {
    if (typeof path !== 'string') return
    try {
      open(await fileFromPath(path))
    } catch {
      /* the user sees the normal "could not read" state if nothing opens */
    }
  }
  void t.core.invoke('take_pending_open').then(handle)
  void t.event.listen('tracey://open', (e) => handle(e.payload))
}

export interface SessionRow {
  source: string
  path: string
  title?: string
  project?: string
  mtimeMs: number
  size: number
}

export interface OtlpBatch {
  contentType: string
  encoding: string
  bodyB64: string
}

/** Sessions already on this machine, found by the native shell. */
export async function scanSessions(): Promise<SessionRow[]> {
  return ((await tauri()?.core.invoke('scan_sessions')) as SessionRow[] | undefined) ?? []
}

/** Start the shell's loopback OTLP receiver. Resolves to the port; rejects with a readable message. */
export async function listenStart(port: number): Promise<number> {
  return (await tauri()!.core.invoke('listen_start', { port })) as number
}

export async function listenStop(): Promise<void> {
  await tauri()?.core.invoke('listen_stop')
}

export function onOtlp(cb: (b: OtlpBatch) => void): void {
  void tauri()?.event.listen('tracey://otlp', (e) => cb(e.payload as OtlpBatch))
}
