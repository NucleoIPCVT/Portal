import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCalendar, readPublicCalendar, eventsInRange } from '../planner-public.js';

test('lê o calendário público sem token pessoal', async () => {
  let requestedUrl;
  const result = await readPublicCalendar({
    now: 1,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.deepEqual(options, { cache: 'no-store' });
      return { ok: true, json: async () => ({ calendarId: publicCalendar.id, events: [
        { id: '1', sourceCalendarId: publicCalendar.id, sourceKey: 'public-ical:1', startDate: '2026-11-07', endDate: '2026-11-07' }
      ] }) };
    }
  });
  assert.equal(result.events.length, 1);
  assert.equal(requestedUrl, `${publicCalendar.snapshotUrl}?at=1`);
});

test('inclui eventos de vários dias que atravessam o período', () => {
  const events = [
    { startDate: '2026-12-30', endDate: '2027-01-03' },
    { startDate: '2027-02-01', endDate: '2027-02-01' }
  ];
  assert.deepEqual(eventsInRange(events, '2027-01-01', '2027-01-31'), [events[0]]);
});

test('rejeita dados de outra agenda', async () => {
  await assert.rejects(readPublicCalendar({ fetchImpl: async () => ({ ok: true, json: async () => ({ calendarId: 'outra', events: [] }) }) }), /inválida/);
});
