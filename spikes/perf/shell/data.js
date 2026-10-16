// THROWAWAY spike. Shared fake data for the three shell variants.
export const N = 10000, ROW = 28
const KINDS = ['agent', 'llm', 'tool', 'chain']
const NAMES = ['invoke_agent planner', 'chat gpt-4o-mini', 'execute_tool search_flights', 'execute_tool get_weather', 'retrieve docs', 'chat claude-sonnet']
export const items = Array.from({ length: N }, (_, i) => ({ id: i, name: NAMES[i % NAMES.length] + ' #' + i, kind: KINDS[i % 4], dur: ((i * 37) % 4000) + 5, tokens: (i * 13) % 5000, err: i % 53 === 0 }))
export const textFor = (i) => { let s = ''; for (let k = 0; k < 40; k++) s += 'span ' + i + ' payload line ' + k + ' the agent called a tool and got a result. '; return s }
export const attrsFor = (it) => [['gen_ai.operation.name', it.kind], ['duration_ms', it.dur], ['tokens', it.tokens], ['status', it.err ? 'error' : 'ok'], ['span.id', it.id.toString(16).padStart(16, '0')], ['service.name', 'travel-planner'], ['model', 'gpt-4o-mini'], ['finish_reason', 'stop']]
export const css = `
*{box-sizing:border-box}body{margin:0;background:#0d1219;color:#c3cad6;font:14px/1.4 ui-sans-serif,system-ui,sans-serif}
#app{display:grid;grid-template-columns:420px 1fr;grid-template-rows:44px 1fr;height:100vh}
header{grid-column:1/3;background:#171d28;border-bottom:1px solid #2a3342;padding:10px 14px;color:#f8fafc;font-weight:600}
#list{overflow:auto;position:relative;border-right:1px solid #2a3342}
#spacer{position:relative}
.row{position:absolute;left:0;right:0;height:28px;display:flex;gap:10px;align-items:center;padding:0 12px;cursor:pointer;white-space:nowrap;overflow:hidden}
.row:hover{background:#94a3b81a}.row.sel{background:#0c8ce929}.row .err{color:#f0577f}.row .k{color:#7cc4fd;width:44px}
#insp{padding:16px;overflow:auto}#insp h2{margin:0 0 8px;color:#f8fafc;font-size:17px}#insp table td{padding:2px 12px 2px 0;color:#94a0b3}#insp pre{white-space:pre-wrap;word-break:break-word;color:#c3cad6}
`
