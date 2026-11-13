/**
 * Calcula rotas de dependência do Gantt sem depender do navegador ou do Firebase.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = value => Number(value.toFixed(1))
const spread = (rank, total) => total <= 1 ? 0 : (rank - (total - 1) / 2) * Math.min(4, 10 / (total - 1))

export function ganttLinkRoutes(nodes, dependencies, {
  width = 720, focusedId = '', showAll = false, denseLimit = 6
} = {}) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen=new Set()
  const all = dependencies.filter(link => {
    const key=link.from+'→'+link.to
    if(link.from===link.to||!byId.has(link.from)||!byId.has(link.to)||seen.has(key))return false
    seen.add(key)
    return true
  })
    .sort((a, b) => byId.get(a.to).y - byId.get(b.to).y ||
      byId.get(a.from).y - byId.get(b.from).y ||
      a.from.localeCompare(b.from))
  const isDense = all.length > denseLimit
  const included = !showAll && isDense
    ? all.filter(link => focusedId && (link.from === focusedId || link.to === focusedId))
    : all

  const outgoing = new Map(), incoming = new Map()
  for (const link of included) {
    if (!outgoing.has(link.from)) outgoing.set(link.from, [])
    if (!incoming.has(link.to)) incoming.set(link.to, [])
    outgoing.get(link.from).push(link)
    incoming.get(link.to).push(link)
  }
  const ranks = new Map()
  for (const links of outgoing.values()) {
    links.sort((a, b) => byId.get(a.to).y - byId.get(b.to).y)
    links.forEach((link, i) => {
      const key = link.from + '→' + link.to
      ranks.set(key, { ...(ranks.get(key) || {}), out: spread(i, links.length) })
    })
  }
  for (const links of incoming.values()) {
    links.sort((a, b) => byId.get(a.from).y - byId.get(b.from).y)
    links.forEach((link, i) => {
      const key = link.from + '→' + link.to
      ranks.set(key, { ...(ranks.get(key) || {}), into: spread(i, links.length) })
    })
  }

  const routes = included.map((link, index) => {
    const from = byId.get(link.from), to = byId.get(link.to)
    const key = link.from + '→' + link.to
    const offsets = ranks.get(key) || {}
    const y1 = round(from.y + (offsets.out || 0))
    const y2 = round(to.y + (offsets.into || 0))
    const x1 = round(clamp(from.right + 3, 2, width - 2))
    const x2 = round(clamp(to.left - 7, 2, width - 2))
    const forward = to.left - from.right >= 24
    let d
    if (forward) {
      const gap = to.left - from.right
      const lane = clamp(from.right + gap * .5 + ((index % 5) - 2) * 3,
        from.right + 8, to.left - 9)
      const x = round(lane)
      if (Math.abs(y2 - y1) < 2) {
        d = 'M ' + x1 + ' ' + y1 + ' H ' + x2
      } else {
        const sign = Math.sign(y2 - y1)
        const r = Math.min(4, Math.abs(y2 - y1) / 2,
          Math.abs(x - x1) / 2, Math.abs(x2 - x) / 2)
        const radius = round(Math.max(0, r))
        d = radius > 0
          ? 'M ' + x1 + ' ' + y1 + ' H ' + round(x - radius) +
            ' Q ' + x + ' ' + y1 + ' ' + x + ' ' + round(y1 + sign * radius) +
            ' V ' + round(y2 - sign * radius) +
            ' Q ' + x + ' ' + y2 + ' ' + round(x + radius) + ' ' + y2 +
            ' H ' + x2
          : 'M ' + x1 + ' ' + y1 + ' H ' + x + ' V ' + y2 + ' H ' + x2
      }
    } else {
      // Relações que recuam na linha do tempo usam um corredor externo.
      const outside = Math.max(from.right, to.right) + 12 + (index % 4) * 6
      const lane = round(Math.min(width - 3, Math.max(x1 + 2, outside)))
      d = 'M ' + x1 + ' ' + y1 + ' H ' + lane + ' V ' + y2 + ' H ' + x2
    }
    return {
      ...link, d, backward: !forward,
      active: Boolean(focusedId && (link.from === focusedId || link.to === focusedId)),
      title: (from.title || 'Demanda') + ' → ' + (to.title || 'Demanda')
    }
  })
  return { routes, total: all.length, dense: isDense, visible: routes.length }
}
