import { render } from 'preact'
import { useState } from 'preact/hooks'
import { items, N, ROW, textFor, attrsFor, css } from '../data.js'
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
function App() {
  const [sel, setSel] = useState(-1)
  const [top, setTop] = useState(0)
  const h = 800
  const a = Math.max(0, Math.floor(top / ROW) - 5), b = Math.min(N, Math.ceil((top + h) / ROW) + 5)
  const rows = []
  for (let i = a; i < b; i++) { const it = items[i]; rows.push(<div key={i} class={'row' + (i === sel ? ' sel' : '')} data-i={i} style={{ transform: `translateY(${i * ROW}px)` }} onClick={() => setSel(i)}><span class="k">{it.kind}</span><span>{it.name}</span><span class={it.err ? 'err' : ''}>{it.dur} ms</span></div>) }
  const it = sel >= 0 ? items[sel] : null
  return <><header>tracey spike (preact)</header>
    <div id="list" onScroll={(e) => setTop(e.currentTarget.scrollTop)}><div id="spacer" style={{ height: N * ROW + 'px' }}>{rows}</div></div>
    <div id="insp">{it ? <><h2>{it.name}</h2><table>{attrsFor(it).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</table><pre>{textFor(sel)}</pre></> : 'Select a span'}</div></>
}
render(<App />, document.getElementById('app'))
requestAnimationFrame(() => { performance.mark('ready'); window.__ready = performance.now() })
