import type { Loaded } from './load'
import { SOURCE_NAMES, compact, duration } from './format'

export function Chips(props: { loaded: Loaded }) {
  const s = () => props.loaded.summary
  const tokens = () => s().tokensIn + s().tokensOut
  return (
    <div class="chips">
      <span class="chip" title={props.loaded.detection.candidates[0]?.evidence.join('\n')}>
        <span class="dot ok" />
        {SOURCE_NAMES[props.loaded.detection.source] ?? props.loaded.detection.source}
      </span>
      <span class="meta mono">
        {s().spans} spans · {duration(s().durationMs)}
        {tokens() ? ` · ${compact(tokens())} tok` : ''}
      </span>
      {s().errors > 0 && <span class="chip err">{s().errors} {s().errors === 1 ? 'error' : 'errors'}</span>}
      {s().warnings > 0 && <span class="chip warn">{s().warnings} {s().warnings === 1 ? 'warning' : 'warnings'}</span>}
    </div>
  )
}
