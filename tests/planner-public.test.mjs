import test from 'node:test';
import assert from 'node:assert/strict';
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
  const response = { ok: true, json: async () => ({ calendarId: publicCalendar.id, generatedAt: '2026-11-09T00:00:00Z', events: [event] }) };
  const snapshot = await readPublicCalendar({ fetchImpl: async () => response });
  assert.equal(snapshot.events.length, 1);
  await assert.rejects(readPublicCalendar({ calendarId: 'other@group.calendar.google.com', fetchImpl: async () => response }), /ainda está sendo preparada/);
});

test('detects additions, reschedules, and removals without false duplicates', () => {
  const oldEvents = summarizeCalendarEvents([{ id: 'a', title: 'Culto', startDate: '2026-11-10', endDate: '2026-11-10' }, { id: 'b', title: 'Evento antigo', startDate: '2026-11-08', endDate: '2026-11-08' }]);
  const updated = summarizeCalendarEvents([{ id: 'a', title: 'Culto', startDate: '2026-11-11', endDate: '2026-11-11' }, { id: 'c', title: 'Evento novo', startDate: '2026-11-13', endDate: '2026-11-13' }]);
  const changes = diffCalendarEvents(oldEvents, updated);
  assert.deepEqual(changes.map(c => c.type), ['changed', 'added', 'removed']);
  assert.deepEqual(diffCalendarEvents(updated, updated), []);
});
