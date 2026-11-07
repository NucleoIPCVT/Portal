import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GoogleCalendarClient, googleScopes } from '../planner-google.js';

const calendar = { id: 'comissao@group.calendar.google.com', summary: 'Comissão', backgroundColor: '#225544', accessRole: 'reader' };
const range = { from: '2026-11-01', to: '2026-11-30' };

function mockFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      assert.ok(responses.length, 'Unexpected HTTP request');
      const { status = 200, body } = responses.shift();
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
}

test('readonly scopes are frozen and access token is not exposed on the instance', () => {
  assert.deepEqual(googleScopes, [
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ]);
  assert.ok(Object.isFrozen(googleScopes));
  const client = new GoogleCalendarClient('private-memory-token');
  assert.deepEqual(Object.keys(client), []);
  assert.equal(JSON.stringify(client), '{}');
});

test('fetch runs with the global receiver required by native browser fetch', async () => {
  let called = false;
  const client = new GoogleCalendarClient('token', {
    fetchImpl: async function () {
      assert.equal(this, globalThis);
      called = true;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    },
  });
  assert.deepEqual(await client.listCalendars(), []);
  assert.equal(called, true);
});

test('listCalendars follows pagination, includes shared agendas and preserves access roles', async () => {
  const mock = mockFetch([
    { body: { items: [{ id: 'primary-id', summary: 'Pessoal', accessRole: 'owner' }], nextPageToken: 'page2' } },
    { body: { items: [calendar, { id: 'availability-only', summary: 'Ocupado', accessRole: 'freeBusyReader' }, { id: 'removed', deleted: true }] } },
  ]);
  const client = new GoogleCalendarClient('token', mock);
  const result = await client.listCalendars();
  assert.equal(result.length, 3);
  assert.deepEqual(result[1], calendar);
  assert.equal(result[2].accessRole, 'freeBusyReader');
  assert.equal(mock.calls[0].url.pathname, '/calendar/v3/users/me/calendarList');
  assert.equal(mock.calls[0].url.searchParams.get('showHidden'), 'true');
  assert.equal(mock.calls[1].url.searchParams.get('pageToken'), 'page2');
  for (const { options } of mock.calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.credentials, 'omit');
  }
});

test('readEvents paginates and uses inclusive São Paulo date bounds', async () => {
  const mock = mockFetch([
    { body: { items: [{ id: 'retreat', summary: 'Retiro', start: { date: '2026-11-07' }, end: { date: '2026-11-10' }, status: 'confirmed' }], nextPageToken: 'events2' } },
    { body: { items: [{ id: 'service', summary: 'Culto', start: { dateTime: '2026-11-09T01:00:00Z' }, end: { dateTime: '2026-11-09T02:00:00Z' }, status: 'confirmed' }] } },
  ]);
  const events = await new GoogleCalendarClient('token', mock).readEvents(calendar, range);
  assert.equal(events.length, 2);
  assert.equal(events[0].startDate, '2026-11-07');
  assert.equal(events[0].endDate, '2026-11-09');
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].startAt, null);
  assert.equal(events[1].startDate, '2026-11-08');
  assert.equal(events[1].endDate, '2026-11-08');
  assert.equal(events[1].allDay, false);
  assert.equal(events[1].timeZone, 'America/Sao_Paulo');
  for (const { url } of mock.calls) {
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('showDeleted'), 'true');
    assert.equal(url.searchParams.get('timeZone'), 'America/Sao_Paulo');
    assert.equal(url.searchParams.get('timeMin'), '2026-11-01T03:00:00.000Z');
    assert.equal(url.searchParams.get('timeMax'), '2026-12-01T03:00:00.000Z');
    assert.equal(url.pathname, '/calendar/v3/calendars/comissao%40group.calendar.google.com/events');
  }
  assert.equal(mock.calls[1].url.searchParams.get('pageToken'), 'events2');
});

test('exclusive timed end at midnight does not create another visible day', async () => {
  const mock = mockFetch([{ body: { items: [{ id: 'midnight', start: { dateTime: '2026-11-07T23:00:00-03:00' }, end: { dateTime: '2026-11-08T00:00:00-03:00' } }] } }]);
  const [event] = await new GoogleCalendarClient('token', mock).readEvents(calendar, range);
  assert.equal(event.startDate, '2026-11-07');
  assert.equal(event.endDate, '2026-11-07');
  assert.equal(event.startAt, '2026-11-08T02:00:00.000Z');
  assert.equal(event.endAt, '2026-11-08T03:00:00.000Z');
});

test('recurrence identity survives rescheduling and is distinct per source calendar', async () => {
  const raw = { id: 'weekly-occurrence', recurringEventId: 'weekly-parent', originalStartTime: { dateTime: '2026-11-08T19:00:00-03:00', timeZone: 'America/Sao_Paulo' }, start: { dateTime: '2026-11-09T19:00:00-03:00' }, end: { dateTime: '2026-11-09T21:00:00-03:00' } };
  const mock = mockFetch([{ body: { items: [raw] } }, { body: { items: [{ ...raw, start: { dateTime: '2026-11-10T19:00:00-03:00' } }] } }, { body: { items: [raw] } }]);
  const client = new GoogleCalendarClient('token', mock);
  const [first] = await client.readEvents(calendar, range);
  const [moved] = await client.readEvents(calendar, range);
  const [anotherCalendar] = await client.readEvents({ ...calendar, id: 'other-calendar' }, range);
  assert.equal(first.id, createHash('sha256').update(JSON.stringify([calendar.id, raw.id])).digest('hex'));
  assert.equal(first.id, moved.id);
  assert.notEqual(first.id, anotherCalendar.id);
  assert.equal(first.sourceKey, `google:${calendar.id}:${raw.id}`);
  assert.deepEqual(first.originalStartTime, raw.originalStartTime);
  assert.equal(first.recurringEventId, 'weekly-parent');
});

test('cancellation tombstones preserve identity without inventing title or dates', async () => {
  const mock = mockFetch([{ body: { items: [{ id: 'cancelled-occurrence', status: 'cancelled', recurringEventId: 'weekly', originalStartTime: { date: '2026-11-08' } }] } }]);
  const [event] = await new GoogleCalendarClient('token', mock).readEvents(calendar, range);
  assert.equal(event.status, 'cancelled');
  assert.equal(event.source, 'google');
  assert.equal(event.sourceEventId, 'cancelled-occurrence');
  assert.equal('title' in event, false);
  assert.equal('startDate' in event, false);
  assert.equal('allDay' in event, false);
  const merged = { title: 'Culto', startDate: '2026-11-08', ...event };
  assert.equal(merged.title, 'Culto');
  assert.equal(merged.startDate, '2026-11-08');
});

test('RFC3339 range bounds keep their exact instants', async () => {
  const mock = mockFetch([{ body: { items: [] } }]);
  await new GoogleCalendarClient('token', mock).readEvents(calendar, { from: '2026-11-01T09:00:00-03:00', to: '2026-11-01T18:00:00-03:00' });
  assert.equal(mock.calls[0].url.searchParams.get('timeMin'), '2026-11-01T12:00:00.000Z');
  assert.equal(mock.calls[0].url.searchParams.get('timeMax'), '2026-11-01T21:00:00.000Z');
});

test('401 requests reconnection and does not expose provider content or tokens', async () => {
  const mock = mockFetch([{ status: 401, body: { error: { message: 'sensitive-provider-content token=secret' } } }]);
  await assert.rejects(new GoogleCalendarClient('secret', mock).listCalendars(), error => {
    assert.equal(error.code, 'GOOGLE_AUTH_EXPIRED');
    assert.equal(error.status, 401);
    assert.match(error.message, /Conectar Google Agenda/);
    assert.doesNotMatch(error.message, /secret|sensitive-provider/);
    return true;
  });
});

test('403 distinguishes disabled API from missing consent', async () => {
  const cases = [
    [{ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 'GOOGLE_API_DISABLED', /habilitada/],
    [{ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 'GOOGLE_API_DISABLED', /Calendar API/],
    [{ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 'GOOGLE_SCOPE_MISSING', /Reconecte/],
    [{ error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'GOOGLE_SCOPE_MISSING', /permita/],
    [{ error: { errors: [{ reason: 'forbidden' }] } }, 'GOOGLE_FORBIDDEN', /compartilhamento/],
  ];
  for (const [body, code, message] of cases) {
    const mock = mockFetch([{ status: 403, body }]);
    await assert.rejects(new GoogleCalendarClient('token', mock).listCalendars(), error => error.code === code && message.test(error.message));
  }
});

test('invalid ranges and availability-only agendas fail before HTTP', async () => {
  const mock = mockFetch([]);
  const client = new GoogleCalendarClient('token', mock);
  await assert.rejects(client.readEvents(calendar, { from: '2026-02-30', to: '2026-03-01' }), { code: 'GOOGLE_INVALID_RANGE' });
  await assert.rejects(client.readEvents(calendar, { from: '2026-11-30', to: '2026-11-01' }), { code: 'GOOGLE_INVALID_RANGE' });
  await assert.rejects(client.readEvents({ ...calendar, accessRole: 'freeBusyReader' }, range), { code: 'GOOGLE_CALENDAR_NO_DETAIL_ACCESS' });
  assert.equal(mock.calls.length, 0);
});

test('network failures and malformed pagination have safe errors', async () => {
  const client = new GoogleCalendarClient('secret', { fetchImpl: async () => { throw new Error('secret-provider-text'); } });
  await assert.rejects(client.listCalendars(), error => error.code === 'GOOGLE_NETWORK_ERROR' && !error.message.includes('secret'));
  const mock = mockFetch([{ body: { items: [], nextPageToken: 'repeat' } }, { body: { items: [], nextPageToken: 'repeat' } }]);
  await assert.rejects(new GoogleCalendarClient('token', mock).listCalendars(), { code: 'GOOGLE_INVALID_RESPONSE' });
});
