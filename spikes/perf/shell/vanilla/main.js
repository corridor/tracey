import { items, N, ROW, textFor, attrsFor, css } from '../data.js'
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
const app = document.getElementById('app')
app.innerHTML = '<header>tracey spike (vanilla)</header><div id=list><div id=spacer></div></div><div id=insp></div>'
const list = document.getElementById('list'), spacer = document.getElementById('spacer'), insp = document.getElementById('insp')
spacer.style.height = N * ROW + 'px'
let selected = -1, pool = []
function renderInsp() {
  if (selected < 0) { insp.textContent = 'Select a span'; return }
  const it = items[selected]
  insp.innerHTML = `<h2>${it.name}</h2><table>${attrsFor(it).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table><pre>${textFor(selected)}</pre>`
}
function renderList() {
  const top = list.scrollTop, h = list.clientHeight
  const a = Math.max(0, Math.floor(top / ROW) - 5), b = Math.min(N, Math.ceil((top + h) / ROW) + 5)
  while (pool.length < b - a) { const d = document.createElement('div'); d.className = 'row'; d.innerHTML = '<span class=k></span><span class=n></span><span class=d></span>'; spacer.appendChild(d); pool.push(d) }
  for (let i = 0; i < pool.length; i++) {
    const d = pool[i], idx = a + i
    if (idx >= b) { d.style.display = 'none'; continue }
    const it = items[idx]
    d.style.display = ''; d.style.transform = `translateY(${idx * ROW}px)`; d.dataset.i = idx
    d.className = 'row' + (idx === selected ? ' sel' : '')
    d.children[0].textContent = it.kind; d.children[1].textContent = it.name; d.children[2].textContent = it.dur + ' ms'
    d.children[2].className = it.err ? 'err' : ''
  }
}
list.addEventListener('scroll', renderList)
list.addEventListener('click', (e) => { const r = e.target.closest('.row'); if (!r) return; selected = +r.dataset.i; renderInsp(); renderList() })
renderInsp(); renderList()
requestAnimationFrame(() => { performance.mark('ready'); window.__ready = performance.now() })
