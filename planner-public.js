// Fonte pública da igreja, sem OAuth dos integrantes do Planner.
export const publicCalendar = Object.freeze({
  id: '0d88300041a5eeef838f5f57c87594ebbd4e2ae41b4f5745335825299acdc5de@group.calendar.google.com',
  name: 'Agenda IPCVT',
  sourceUrl: 'https://calendar.google.com/calendar/u/1?cid=MGQ4ODMwMDA0MWE1ZWVlZjgzOGY1ZjU3Yzg3NTk0ZWJiZDRlMmFlNDFiNGY1NzQ1MzM1ODI1Mjk5YWNkYzVkZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t',
  snapshotUrl: 'https://raw.githubusercontent.com/NucleoIPCVT/Portal/main/agenda-ipcvt.json'
})

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 250 && /^[A-Za-z0-9_.@+\-]+$/.test(id)
}

export function parseCalendarSourceUrl(text) {
  let url
  try { url = new URL(String(text || '').trim()) } catch { throw new Error('Informe o link completo da agenda pública do Google.') }
  if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || !url.pathname.startsWith('/calendar/')) {
    throw new Error('Use um link HTTPS do Google Agenda (calendar.google.com).')
  }
  let id = url.searchParams.get('src') || ''
  if (!id && url.searchParams.has('cid')) {
    const cid = url.searchParams.get('cid').trim()
    try { id = atob(cid.replace(/-/g, '+').replace(/_/g, '/')) } catch { id = cid }
  }
  if (!id) {
    const match = url.pathname.match(/\/calendar\/ical\/([^/]+)\/public\/basic[.]ics$/)
    if (match) id = decodeURIComponent(match[1])
  }
  if (!validId(id)) throw new Error('Não foi possível identificar a agenda neste link. Copie o link de compartilhamento público no Google Agenda.')
  return { calendarId: id, sourceUrl: url.toString() }
}

export function calendarWebUrl(id = publicCalendar.id) {
  return 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(id) + '&ctz=America%2FSao_Paulo'
}

export async function readPublicCalendar({ calendarId = publicCalendar.id, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  let snapshot
  try {
    // A API de conteúdos do GitHub entrega o arquivo da branch principal
    // sem depender do cache do GitHub Pages ou do raw.githubusercontent.com.
    const endpoint = 'https://api.github.com/repos/NucleoIPCVT/Portal/contents/agenda-ipcvt.json'
    const response = await fetchImpl(`${endpoint}?ref=main&at=${now}`, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`)
    const file = await response.json()
    if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('Arquivo não encontrado na API.')
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0))
    snapshot = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    console.warn('Consulta direta ao GitHub indisponível; usando a cópia pública.', error)
    try {
      const response = await fetchImpl(`${publicCalendar.snapshotUrl}?at=${now}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      snapshot = await response.json()
    } catch {
      throw new Error('Não foi possível consultar a Agenda IPCVT. Confira sua conexão e tente novamente.')
    }
  }
  if (!snapshot || !Array.isArray(snapshot.events)
    || snapshot.events.some(event => !event || typeof event.id !== 'string'
      || typeof event.startDate !== 'string' || typeof event.endDate !== 'string'
      || event.sourceCalendarId !== snapshot.calendarId || !event.sourceKey?.startsWith('public-ical:'))) {
    throw new Error('O GitHub retornou uma versão inválida da Agenda IPCVT.')
  }
  if (snapshot.calendarId !== calendarId) {
    throw new Error('A nova agenda ainda está sendo preparada no GitHub. Aguarde a próxima atualização automática.')
  }
  return snapshot
}

export function eventFingerprint(event) {
  return JSON.stringify([
    event.title || '', event.startDate || '', event.endDate || '',
    event.startAt || '', event.endAt || '', event.location || '',
    event.description || '', event.status || 'confirmed'
  ])
}

export function summarizeCalendarEvents(events) {
  return events.map(event => ({
    id: event.id,
    title: event.title,
    startDate: event.startDate,
    fingerprint: eventFingerprint(event)
  }))
}

export function diffCalendarEvents(previous, current) {
  const before = new Map((previous || []).map(event => [event.id, event]))
  const after = new Map((current || []).map(event => [event.id, event]))
  const changes = []
  for (const event of current || []) {
    const old = before.get(event.id)
    if (!old) changes.push({ type: 'added', id: event.id, title: event.title, date: event.startDate })
    else if (old.fingerprint !== event.fingerprint) changes.push({ type: 'changed', id: event.id, title: event.title, date: event.startDate })
  }
  for (const event of previous || []) if (!after.has(event.id)) {
    changes.push({ type: 'removed', id: event.id, title: event.title, date: event.startDate })
  }
  return changes
}

export function eventsInRange(events, from, to) {
  return events.filter(event => event.startDate <= to && event.endDate >= from)
}
