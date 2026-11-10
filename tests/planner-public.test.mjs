import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publicCalendar, parseCalendarSourceUrl, readPublicCalendar, diffCalendarEvents, summarizeCalendarEvents } from '../planner-public.js';

test('parses church shared URL and extracts exact calendar ID', () => {
  const config = parseCalendarSourceUrl(publicCalendar.sourceUrl);
  assert.equal(config.calendarId, publicCalendar.id);
  assert.equal(parseCalendarSourceUrl('https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(publicCalendar.id)).calendarId, publicCalendar.id);
  assert.throws(() => parseCalendarSourceUrl('https://example.com?src=not-a-calendar'));
  assert.throws(() => parseCalendarSourceUrl('https://calendar.google.com/calendar/u/1'));
});

test('accepts matching public snapshots and rejects a stale calendar source', async () => {
  const event = {
    id: '123', sourceCalendarId: publicCalendar.id, sourceKey: 'public-ical:' + publicCalendar.id + ':event',
    startDate: '2026-11-09', endDate: '2026-11-09', title: 'Culto'
  };
  const body = { calendarId: publicCalendar.id, generatedAt: '2026-11-09T00:00:00Z', events: [event] };
  const response = { ok: true, json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify(body)).toString('base64') }) };
  const snapshot = await readPublicCalendar({ fetchImpl: async () => response });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.sourceKind, 'github-snapshot');
  await assert.rejects(readPublicCalendar({ calendarId: 'other@group.calendar.google.com', fetchImpl: async () => response }), /ainda está sendo preparada/);
});

test('reads the public Google Calendar API directly, paginates, preserves iCal IDs and dates', async () => {
  const event = {
    id: 'google-id', iCalUID: 'meeting@google.com', summary: 'Ensaio', status: 'confirmed',
    start: { dateTime: '2026-11-12T19:00:00-03:00' },
    end: { dateTime: '2026-11-12T20:30:00-03:00' },
    updated: '2026-11-10T11:00:00Z'
  };
  const another = {
    id: 'second-id', iCalUID: 'day@google.com', summary: 'Retiro',
    start: { date: '2026-11-13' }, end: { date: '2026-11-16' }
  };
  const requested = [];
  const snapshot = await readPublicCalendar({
    now: Date.parse('2026-11-10T14:00:00Z'), apiKey: 'test-key',
    fetchImpl: async url => {
      requested.push(new URL(url));
      return { ok: true, json: async () => requested.length === 1
        ? { items: [event], nextPageToken: 'next' } : { items: [another] } };
    }
  });
  const expectedId = createHash('sha256')
    .update(JSON.stringify([publicCalendar.id, event.iCalUID])).digest('hex');
  assert.equal(snapshot.sourceKind, 'google-api');
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events[0].id, expectedId);
  assert.equal(snapshot.events[0].startAt, '2026-11-12T22:00:00.000Z');
  assert.equal(snapshot.events[0].startDate, '2026-11-12');
  assert.equal(snapshot.events[1].startDate, '2026-11-13');
  assert.equal(snapshot.events[1].endDate, '2026-11-15');
  assert.equal(requested[0].searchParams.get('singleEvents'), 'true');
  assert.equal(requested[0].searchParams.get('key'), 'test-key');
  assert.equal(requested[1].searchParams.get('pageToken'), 'next');
});

test('shows a warning when direct Google fails and the GitHub backup is available', async () => {
  const body = { calendarId: publicCalendar.id, generatedAt: '2026-11-09T00:00:00Z', events: [] };
  const snapshot = await readPublicCalendar({ apiKey: 'test-key', fetchImpl: async url => {
    if (url.includes('googleapis.com')) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify(body)).toString('base64') }) };
  } });
  assert.equal(snapshot.sourceKind, 'github-backup');
  assert.match(snapshot.warning, /consulta direta ao Google falhou/);
});

test('detects additions, reschedules, and removals without false duplicates', () => {
  const oldEvents = summarizeCalendarEvents([{ id: 'a', title: 'Culto', startDate: '2026-11-10', endDate: '2026-11-10' }, { id: 'b', title: 'Evento antigo', startDate: '2026-11-08', endDate: '2026-11-08' }]);
  const updated = summarizeCalendarEvents([{ id: 'a', title: 'Culto', startDate: '2026-11-11', endDate: '2026-11-11' }, { id: 'c', title: 'Evento novo', startDate: '2026-11-13', endDate: '2026-11-13' }]);
  const changes = diffCalendarEvents(oldEvents, updated);
  assert.deepEqual(changes.map(c => c.type), ['changed', 'added', 'removed']);
  assert.deepEqual(diffCalendarEvents(updated, updated), []);
});
