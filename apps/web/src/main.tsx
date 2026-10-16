import { render } from 'solid-js/web'
import '@ggx/trace-theme/theme.css'
import './app.css'
import { App } from './App'

render(() => <App />, document.getElementById('root')!)

// Offline support in production builds only (the dev server must not be cached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
