import { render } from 'solid-js/web'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { items, N, ROW, textFor, attrsFor, css } from '../data.js'
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
function App() {
  const [sel, setSel] = createSignal(-1)
  const [top, setTop] = createSignal(0)
  const range = createMemo(() => { const a = Math.max(0, Math.floor(top() / ROW) - 5), b = Math.min(N, Math.ceil((top() + 800) / ROW) + 5); const r = []; for (let i = a; i < b; i++) r.push(i); return r })
  const it = () => (sel() >= 0 ? items[sel()] : null)
  return <>
    <header>tracey spike (solid)</header>
    <div id="list" onScroll={(e) => setTop(e.currentTarget.scrollTop)}><div id="spacer" style={{ height: N * ROW + 'px' }}>
      <For each={range()}>{(i) => <div class="row" classList={{ sel: i === sel() }} data-i={i} style={{ transform: `translateY(${i * ROW}px)` }} onClick={() => setSel(i)}><span class="k">{items[i].kind}</span><span>{items[i].name}</span><span class={items[i].err ? 'err' : ''}>{items[i].dur} ms</span></div>}</For>
    </div></div>
    <div id="insp"><Show when={it()} fallback="Select a span">{(x) => <><h2>{x().name}</h2><table><For each={attrsFor(x())}>{([k, v]) => <tr><td>{k}</td><td>{v}</td></tr>}</For></table><pre>{textFor(sel())}</pre></>}</Show></div>
  </>
}
render(() => <App />, document.getElementById('app'))
requestAnimationFrame(() => { performance.mark('ready'); window.__ready = performance.now() })
