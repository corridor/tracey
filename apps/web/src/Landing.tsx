import { Show } from 'solid-js'

export function Landing(props: { error: string | undefined; busy: string | undefined; onFile: (f: File) => void; onSample: () => void }) {
  let input!: HTMLInputElement
  const pick = () => input.click()
  return (
    <main class="landing">
      <h1>
        Drop a trace to see
        <br />
        what your agent really did.
      </h1>
      <button class="drop" onClick={pick} aria-label="Choose a trace file">
        <span>
          Drop a file, or <b>choose one</b>
        </span>
        <span class="hint">
          or paste <kbd>⌘</kbd> <kbd>V</kbd>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (f) props.onFile(f)
          e.currentTarget.value = ''
        }}
      />
      <button class="btn" onClick={props.onSample}>
        Try a sample ▸
      </button>
      <Show when={props.busy}>
        <p class="fine" role="status">
          Reading {props.busy}…
        </p>
      </Show>
      <Show when={props.error}>
        <p class="error" role="alert">
          {props.error}
        </p>
      </Show>
      <p class="fine">Runs entirely in your browser. Nothing is uploaded.</p>
    </main>
  )
}
