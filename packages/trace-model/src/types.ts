export const SpanKind = {
  Other: 0,
  Agent: 1,
  Llm: 2,
  Tool: 3,
  Retrieval: 4,
  Embedding: 5,
  Chain: 6,
} as const
export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind]

export const SpanStatus = { Unset: 0, Ok: 1, Error: 2 } as const
export type SpanStatus = (typeof SpanStatus)[keyof typeof SpanStatus]

const KIND_LABELS = ['other', 'agent', 'llm', 'tool', 'retrieval', 'embedding', 'chain'] as const
const STATUS_LABELS = ['unset', 'ok', 'error'] as const

export const kindLabel = (k: SpanKind): string => KIND_LABELS[k] ?? 'other'
export const statusLabel = (s: SpanStatus): string => STATUS_LABELS[s] ?? 'unset'

export type AttrValue = string | number | boolean | null | AttrValue[] | { [k: string]: AttrValue }
export type Attrs = Record<string, AttrValue>

/** Everything an adapter knows about one span. Times are epoch milliseconds (fractions allowed). */
export interface SpanInit {
  id: string
  parentId?: string | undefined
  name: string
  kind?: SpanKind
  status?: SpanStatus
  start: number
  end: number
  model?: string
  tokensIn?: number
  tokensOut?: number
  input?: string
  output?: string
  error?: string
  attrs?: Attrs
}
