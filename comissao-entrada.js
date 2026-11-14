// A navegação pelo painel é uma barreira de interface, não uma credencial de segurança.
// O Firebase Authentication e as regras do Firestore continuam responsáveis por proteger dados.
const prefix = 'ipcvt:comissao:entrada:'
const duration = 12 * 60 * 60 * 1000

export function grantPanelEntry(tool, uid) {
  if (!['planner', 'tatico'].includes(tool) || !uid) return false
  try {
    sessionStorage.setItem(prefix + tool, JSON.stringify({ uid, validUntil: Date.now() + duration }))
    return true
  } catch {
    return false
  }
}

export function hasPanelEntry(tool, uid = '') {
  try {
    const record = JSON.parse(sessionStorage.getItem(prefix + tool) || 'null')
    const valid = record && typeof record.uid === 'string' && record.uid.length > 0
      && Number.isFinite(record.validUntil) && record.validUntil > Date.now()
      && (!uid || record.uid === uid)
    if (!valid) sessionStorage.removeItem(prefix + tool)
    return Boolean(valid)
  } catch {
    return false
  }
}

export function clearPanelEntry(tool = '') {
  try {
    for (const key of tool ? [tool] : ['planner', 'tatico']) {
      sessionStorage.removeItem(prefix + key)
    }
  } catch { /* Navegação bloqueada caso o armazenamento esteja indisponível. */ }
}
