/* Aparência própria do Planner. O modelo verde e creme é o padrão. */
(() => {
  const key = 'ipcvt-planner-aparencia-v1'
  let theme = 'light'
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark' } catch {}
  function apply() {
    const dark = theme === 'dark'
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = dark ? '#2b3034' : '#d8e0d2'
    const label = dark ? 'Ativar modo claro' : 'Ativar modo noturno'
    for (const id of ['theme-toggle', 'theme-toggle-gate']) {
      const button = document.getElementById(id)
      if (!button) continue
      button.setAttribute('aria-pressed', String(dark))
      button.setAttribute('aria-label', label)
      button.title = label
      const moon = button.querySelector('.pm-theme-moon')
      const sun = button.querySelector('.pm-theme-sun')
      if (moon) moon.hidden = dark
      if (sun) sun.hidden = !dark
      const caption = button.querySelector('.theme-label')
      if (caption) caption.textContent = dark ? 'Modo claro' : 'Modo noturno'
    }
  }
  apply()
  document.addEventListener('DOMContentLoaded', () => {
    apply()
    for (const id of ['theme-toggle', 'theme-toggle-gate']) {
      document.getElementById(id)?.addEventListener('click', () => {
        theme = theme === 'light' ? 'dark' : 'light'
        apply()
        try { localStorage.setItem(key, theme) } catch {}
      })
    }
  })
})()
