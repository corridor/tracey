export type Theme = 'dark' | 'light' | 'auto'

/** Apply a theme to the document root. `auto` removes the override so the OS preference applies. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/** Token values resolved for the current theme, for canvas renderers (read once per theme change). */
export function readTokens(root: HTMLElement = document.documentElement): Record<string, string> {
  const cs = getComputedStyle(root)
  const names = [
    'bg', 'surface', 'border', 'text', 'text-secondary', 'text-muted', 'text-strong', 'accent', 'accent-text',
    'error', 'warning', 'success', 'purple', 'kind-agent', 'kind-llm', 'kind-tool', 'kind-retrieval', 'kind-other',
  ]
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--tracey-${n}`).trim()]))
}
