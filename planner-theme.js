/* Tema local: a preferência não é armazenada no Firebase. */
(() => {
  const key = 'ipcvt-planejamento-estrategico-tema';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference = null;
  try { preference = localStorage.getItem(key); } catch { /* Armazenamento indisponível. */ }
  let theme = preference === 'dark' || (preference !== 'light' && media?.matches) ? 'dark' : 'light';

  function apply(next) {
    theme = next;
    document.documentElement.dataset.theme = next;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = next === 'dark' ? '#171a1e' : '#173f35';
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const dark = next === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo noturno');
    button.title = dark ? 'Ativar modo claro' : 'Ativar modo noturno';
    button.querySelector('.theme-icon').textContent = dark ? '☀' : '☾';
    button.querySelector('.theme-label').textContent = dark ? 'Modo claro' : 'Modo noturno';
  }

  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    apply(theme);
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      apply(theme === 'dark' ? 'light' : 'dark');
      preference = theme;
      try { localStorage.setItem(key, theme); } catch { /* Segue funcionando na sessão. */ }
    });
  });
  media?.addEventListener?.('change', event => {
    if (preference !== null) return;
    apply(event.matches ? 'dark' : 'light');
  });
})();
