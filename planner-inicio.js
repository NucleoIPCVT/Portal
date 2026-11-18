// A navegação ordinária carrega o mesmo módulo principal e as mesmas visões do Planner.
let pending = false
try { pending = Boolean(sessionStorage.getItem('ipcvt:planner:piloto-ia')) } catch { /* armazenamento indisponível */ }
if (/^#ipcvt-ia(?:$|[-=])/.test(location.hash) || pending) {
  const { startPilot } = await import('./planner-piloto-ia.js?v=20261118-2')
  await startPilot(() => import('./planner.js?v=20261117-mobile-v6'))
} else {
  await import('./planner.js?v=20261117-mobile-v6')
}
