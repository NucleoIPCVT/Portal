import { googleCalendarPublicApiKey } from './google-calendar-public-config.js';

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

export function hasDirectGoogleAccess() {
  return Boolean(googleCalendarPublicApiKey.trim())
}

const TIME_ZONE = 'America/Sao_Paulo'
const localDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
})

function brazilDay(date) {
  const fields = Object.fromEntries(localDayFormatter.formatToParts(date).map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function previousDay(value) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

async function stableEventId(calendarId, sourceEventId) {
  const bytes = new TextEncoder().encode(JSON.stringify([calendarId, sourceEventId]))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function normalizeGoogleEvent(event, calendarId) {
  const start = event.start?.dateTime || event.start?.date
  const end = event.end?.dateTime || event.end?.date || start
  if (typeof start !== 'string' || typeof end !== 'string' || !event.iCalUID) return null

  const allDay = Boolean(event.start?.date)
  const startAt = allDay ? null : new Date(start).toISOString()
  const endAt = allDay ? null : new Date(end).toISOString()
  if ((!allDay && (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))))) return null

  const startDate = allDay ? start : brazilDay(new Date(startAt))
  const endDate = allDay
    ? previousDay(end > start ? end : new Date(Date.parse(`${start}T00:00:00Z`) + 86400000).toISOString().slice(0, 10))
    : brazilDay(new Date(Math.max(Date.parse(endAt) - 1, Date.parse(startAt))))

  // Mantém os IDs da importação iCal, preservando tarefas vinculadas no Planner.
  const originalStart = event.originalStartTime?.dateTime || event.originalStartTime?.date || start
  const instanceKey = originalStart.includes('T')
    ? new Date(originalStart).toISOString()
    : new Date(`${originalStart}T00:00:00Z`).toISOString()
  const sourceEventId = event.recurringEventId ? `${event.iCalUID}/${instanceKey}` : event.iCalUID
  const id = await stableEventId(calendarId, sourceEventId)
  return {
    id, source: 'google', sourceCalendarId: calendarId, sourceEventId,
    sourceKey: `public-ical:${calendarId}:${sourceEventId}`, calendarName: publicCalendar.name,
    status: 'confirmed', title: event.summary || 'Evento sem título',
    description: event.description || '', location: event.location || '', htmlLink: event.htmlLink || '',
    sourceUpdatedAt: event.updated || '', recurringEventId: event.recurringEventId || '',
    originalStartTime: event.originalStartTime || null,
    allDay, timeZone: TIME_ZONE, startDate,
    endDate: endDate < startDate ? startDate : endDate, startAt, endAt
  }
}

async function readGoogleCalendar({ calendarId, fetchImpl, now, apiKey }) {
  const currentYear = new Date(now).getUTCFullYear()
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const entries = []
  let pageToken = ''
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(endpoint)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('timeMin', `${currentYear - 1}-01-01T00:00:00Z`)
    url.searchParams.set('timeMax', `${currentYear + 3}-01-01T00:00:00Z`)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('showDeleted', 'false')
    url.searchParams.set('maxResults', '2500')
    url.searchParams.set('timeZone', TIME_ZONE)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetchImpl(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Google Calendar API respondeu HTTP ${response.status}.`)
    const result = await response.json()
    if (!Array.isArray(result.items)) throw new Error('O Google não retornou uma lista válida de eventos.')
    entries.push(...result.items.filter(entry => entry.status !== 'cancelled'))
    pageToken = result.nextPageToken || ''
    if (!pageToken) {
      const normalized = await Promise.all(entries.map(entry => normalizeGoogleEvent(entry, calendarId)))
      const events = [...new Map(normalized.filter(Boolean).map(event => [event.id, event])).values()]
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
      return { calendarId, calendarName: publicCalendar.name, generatedAt: new Date().toISOString(),
        sourceKind: 'google-api', events }
    }
  }
  throw new Error('O Google retornou páginas demais. A consulta foi interrompida para evitar dados incompletos.')
}

async function readGitHubSnapshot({ calendarId, fetchImpl, now }) {
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
  return { ...snapshot, sourceKind: 'github-snapshot' }
}

export async function readPublicCalendar({ calendarId = publicCalendar.id, fetchImpl = globalThis.fetch,
  now = Date.now(), apiKey = googleCalendarPublicApiKey } = {}) {
  if (apiKey?.trim()) {
    try {
      return await readGoogleCalendar({ calendarId, fetchImpl, now, apiKey: apiKey.trim() })
    } catch (error) {
      console.warn('Leitura direta do Google indisponível; procurando cópia de segurança.', error)
      try {
        const backup = await readGitHubSnapshot({ calendarId, fetchImpl, now })
        return { ...backup, sourceKind: 'github-backup', warning: 'A consulta direta ao Google falhou. Exibindo a última cópia disponível no Portal.' }
      } catch {
        throw new Error('Não foi possível consultar o Google Agenda nem a cópia de segurança.')
      }
    }
  }
  return readGitHubSnapshot({ calendarId, fetchImpl, now })
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
