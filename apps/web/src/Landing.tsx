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
      <details class="where">
        <summary>Where are my Claude Code logs?</summary>
        <p>
          Sessions are the <code class="mono">.jsonl</code> files in <code class="mono">~/.claude/projects/&lt;project&gt;/</code>. That folder is hidden: in the file
          picker press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd> on macOS (<kbd>Ctrl</kbd> <kbd>H</kbd> on Linux) to show it, or press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>G</kbd> and type
          the path. Drop a session together with its sub-agents folder to see those too. The desktop app and the CLI list your sessions for you.
        </p>
      </details>
    </main>
  )
}
