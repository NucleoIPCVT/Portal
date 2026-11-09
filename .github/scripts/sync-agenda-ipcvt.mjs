import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import ical from 'node-ical';

// The link shared by the church identifies this public Google Calendar.
let calendarId = '0d88300041a5eeef838f5f57c87594ebbd4e2ae41b4f5745335825299acdc5de@group.calendar.google.com';
const calendarName = 'Agenda IPCVT';
const outputFile = new URL('../../agenda-ipcvt.json', import.meta.url);
const zone = 'America/Sao_Paulo';

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
});

function brazilDay(value) {
  const parts = Object.fromEntries(dateParts.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function previousDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function normalize(entry, occurrence, recurring) {
  const start = occurrence.start;
  const end = occurrence.end || start;
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date)) return null;

  const allDay = Boolean(occurrence.isFullDay || entry.start?.dateOnly);
  const startDate = allDay ? start.toISOString().slice(0, 10) : brazilDay(start);
  const endDate = allDay
    ? previousDay((end.getTime() > start.getTime() ? end : new Date(start.getTime() + 86400000)).toISOString().slice(0, 10))
    : brazilDay(new Date(Math.max(end.getTime() - 1, start.getTime())));

  // A recurrence ID, when provided, stays stable when one occurrence moves.
  const original = occurrence.recurrenceId || occurrence.recurrenceid || occurrence.originalStart || start;
  const instanceKey = original instanceof Date ? original.toISOString() : String(original);
  const sourceEventId = recurring ? `${entry.uid}/${instanceKey}` : text(entry.uid);
  if (!sourceEventId) return null;
  const id = createHash('sha256').update(JSON.stringify([calendarId, sourceEventId])).digest('hex');

  return {
    id,
    source: 'google',
    sourceCalendarId: calendarId,
    sourceEventId,
    sourceKey: `public-ical:${calendarId}:${sourceEventId}`,
    calendarName,
    status: 'confirmed',
    title: text(occurrence.summary || entry.summary) || 'Evento sem título',
    description: text(occurrence.description || entry.description),
    location: text(occurrence.location || entry.location),
    htmlLink: text(occurrence.url || entry.url),
    sourceUpdatedAt: entry.lastmodified instanceof Date ? entry.lastmodified.toISOString() : '',
    recurringEventId: recurring ? text(entry.uid) : '',
    originalStartTime: recurring ? { dateTime: instanceKey } : null,
    allDay,
    timeZone: zone,
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    startAt: allDay ? null : start.toISOString(),
    endAt: allDay ? null : end.toISOString(),
  };
}

const configEndpoint = 'https://firestore.googleapis.com/v1/projects/repertorio-ipcvt/databases/(default)/documents/comissao_planner/main/config/calendar';

async function resolveCalendarId() {
  let response;
  try {
    response = await fetch(configEndpoint, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  } catch {
    console.warn('A configuração remota está indisponível. Mantendo a Agenda IPCVT original.');
    return calendarId;
  }
  if (response.status === 403 || response.status === 404) {
    console.warn('Configuração administrativa ainda não publicada; usando a agenda original.');
    return calendarId;
  }
  if (!response.ok) throw new Error(`Não foi possível ler a configuração da agenda (HTTP ${response.status}).`);
  const payload = await response.json();
  const configuredId = payload?.fields?.calendarId?.stringValue;
  if (typeof configuredId !== 'string' || !/^[-A-Za-z0-9_.@+]{1,250}$/.test(configuredId)) {
    throw new Error('O Firebase retornou um identificador de agenda inválido.');
  }
  return configuredId;
}

async function main() {
  calendarId = await resolveCalendarId();
  const calendarUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  const response = await fetch(calendarUrl, { signal: AbortSignal.timeout(30000), headers: { Accept: 'text/calendar' } });
  if (!response.ok) throw new Error(`Agenda pública não respondeu corretamente (HTTP ${response.status}).`);
  const content = await response.text();
  if (!content.includes('BEGIN:VCALENDAR')) throw new Error('O link não retornou um calendário iCal público.');

  const parsed = ical.sync.parseICS(content);
  const year = new Date().getUTCFullYear();
  const from = new Date(`${year - 1}-01-01T00:00:00Z`);
  const to = new Date(`${year + 3}-01-01T00:00:00Z`);
  const events = new Map();

  for (const entry of Object.values(parsed)) {
    if (entry?.type !== 'VEVENT' || !(entry.start instanceof Date) || entry.status?.toUpperCase() === 'CANCELLED') continue;
    const recurring = Boolean(entry.rrule || entry.rdate);
    const occurrences = ical.expandRecurringEvent(entry, { from, to, includeOverrides: true, excludeExdates: true });
    for (const occurrence of occurrences) {
      if (occurrence.status?.toUpperCase() === 'CANCELLED') continue;
      const normalized = normalize(entry, occurrence, recurring);
      if (normalized) events.set(normalized.id, normalized);
    }
  }

  const sortedEvents = [...events.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  let previous;
  try { previous = JSON.parse(await readFile(outputFile, 'utf8')); } catch { /* first import */ }
  if (previous?.calendarId === calendarId && JSON.stringify(previous.events) === JSON.stringify(sortedEvents)) {
    console.log(`Agenda IPCVT sem alterações: ${sortedEvents.length} eventos.`);
    return;
  }

  const snapshot = { calendarId, calendarName, generatedAt: new Date().toISOString(), events: sortedEvents };
  await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Agenda IPCVT atualizada: ${sortedEvents.length} eventos.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
