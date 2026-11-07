// A agenda é pública. A cópia JSON é atualizada pelo GitHub Actions a partir do iCal da igreja.
// Nunca usa o calendário particular nem o token do membro que acessa o Planner.
export const publicCalendar = Object.freeze({
  id: '0d88300041a5eeef838f5f57c87594ebbd4e2ae41b4f5745335825299acdc5de@group.calendar.google.com',
  name: 'Agenda IPCVT',
  snapshotUrl: 'https://raw.githubusercontent.com/NucleoIPCVT/Portal/main/agenda-ipcvt.json',
  calendarUrl: 'https://calendar.google.com/calendar/embed?src=0d88300041a5eeef838f5f57c87594ebbd4e2ae41b4f5745335825299acdc5de%40group.calendar.google.com&ctz=America%2FSao_Paulo',
});

export async function readPublicCalendar({ fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  let response;
  try {
    response = await fetchImpl(`${publicCalendar.snapshotUrl}?at=${now}`, { cache: 'no-store' });
  } catch {
    throw new Error('Não foi possível consultar a Agenda IPCVT no GitHub. Confira sua conexão.');
  }
  if (!response.ok) {
    throw new Error('A cópia pública da Agenda IPCVT ainda não está disponível no GitHub. Aguarde a primeira atualização automática.');
  }
  let snapshot;
  try { snapshot = await response.json(); } catch { /* invalid JSON */ }
  if (!snapshot || snapshot.calendarId !== publicCalendar.id || !Array.isArray(snapshot.events)
    || snapshot.events.some(event => !event || typeof event.id !== 'string'
      || typeof event.startDate !== 'string' || typeof event.endDate !== 'string'
      || event.sourceCalendarId !== publicCalendar.id || !event.sourceKey?.startsWith('public-ical:'))) {
    throw new Error('O GitHub retornou uma versão inválida da Agenda IPCVT.');
  }
  return snapshot;
}

export function eventsInRange(events, from, to) {
  return events.filter(event => event.startDate <= to && event.endDate >= from);
}
