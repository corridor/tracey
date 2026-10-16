import type { Loaded } from './load'
import { duration } from './format'

/** One honest sentence about the run, before the details. */
export function verdictText(l: Loaded): { tone: 'error' | 'warning' | 'ok'; text: string } {
  const first = l.summary.firstError
  if (first) {
    const at = l.trace.start[first.spans[0]!]! - l.trace.t0
    return { tone: 'error', text: `First failure: ${l.trace.nameOf(first.spans[0]!)}, ${duration(at)} into the run` }
  }
  if (l.summary.warnings > 0) {
    return { tone: 'warning', text: `No failures, but ${l.summary.warnings} ${l.summary.warnings === 1 ? 'thing is' : 'things are'} worth a look` }
  }
  return { tone: 'ok', text: 'No problems found' }
}
