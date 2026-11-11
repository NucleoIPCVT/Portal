/* Aparência própria do Planner. O modelo verde e creme é o padrão. */
(() => {
  const key = 'ipcvt-planner-aparencia-v1'
  let theme = 'light'
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark' } catch {}
  function apply() {
    const dark = theme === 'dark'
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = dark ? '#2e4434' : '#d8e0d2'
    const button = document.getElementById('theme-toggle')
    if (!button) return
    const label = dark ? 'Ativar modo claro' : 'Ativar modo noturno'
    button.setAttribute('aria-pressed', String(dark))
    button.setAttribute('aria-label', label)
    button.title = label
    button.querySelector('.theme-icon').textContent = dark ? '☀' : '☾'
    button.querySelector('.theme-label').textContent = dark ? 'Modo claro' : 'Modo noturno'
  }
  apply()
  document.addEventListener('DOMContentLoaded', () => {
    apply()
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      theme = theme === 'light' ? 'dark' : 'light'
      apply()
      try { localStorage.setItem(key, theme) } catch {}
    })
  })
})()
