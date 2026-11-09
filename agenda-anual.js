import { readPublicCalendar } from './planner-public.js';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const TIME_ZONE = 'America/Sao_Paulo';
const byId = id => document.getElementById(id);

const yearSelect = byId('year-select');
const printButton = byId('print-button');
const refreshButton = byId('refresh-button');
const status = byId('load-status');
let snapshot = null;
let selectedYear = null;

function pad(value) { return String(value).padStart(2, '0'); }
function dateKey(year, monthIndex, day) { return `${year}-${pad(monthIndex + 1)}-${pad(day)}`; }
function lastDay(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function toUtcDate(value) { return new Date(`${value}T12:00:00.000Z`); }
function weekdayOf(value) { return WEEKDAYS[toUtcDate(value).getUTCDay()]; }
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(value)); }
function formatHour(value) { return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE }).format(new Date(value)); }
function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function monthEvents(events, year, monthIndex) {
  const from = dateKey(year, monthIndex, 1);
  const to = dateKey(year, monthIndex, lastDay(year, monthIndex));
  return events.filter(event => event.startDate <= to && event.endDate >= from);
}

function occupiedDays(events, year, monthIndex) {
  const days = new Set();
  const monthStart = dateKey(year, monthIndex, 1);
  const monthEnd = dateKey(year, monthIndex, lastDay(year, monthIndex));
  for (const event of events) {
    if (event.startDate > monthEnd || event.endDate < monthStart) continue;
    const from = event.startDate < monthStart ? 1 : Number(event.startDate.slice(8));
    const to = event.endDate > monthEnd ? lastDay(year, monthIndex) : Number(event.endDate.slice(8));
    for (let day = from; day <= to; day += 1) days.add(day);
  }
  return days;
}

function renderMiniMonth(year, monthIndex, events) {
  const monthCard = textElement('section', 'mini-month', '');
  const header = textElement('div', 'mini-month-head', '');
  header.append(textElement('strong', '', MONTHS[monthIndex]));
  header.append(textElement('span', '', `${events.length} evento${events.length === 1 ? '' : 's'}`));
  monthCard.append(header);

  const grid = textElement('div', 'mini-month-grid', '');
  for (const day of ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']) grid.append(textElement('span', 'weekday', day));
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  for (let i = 0; i < firstWeekday; i += 1) grid.append(textElement('span', 'empty-day', ''));
  const marked = occupiedDays(events, year, monthIndex);
  for (let day = 1; day <= lastDay(year, monthIndex); day += 1) {
    const cell = textElement('span', marked.has(day) ? 'day has-event' : 'day', String(day));
    if (marked.has(day)) cell.setAttribute('aria-label', `${day} de ${MONTHS[monthIndex]}, com evento`);
    grid.append(cell);
  }
  monthCard.append(grid);
  return monthCard;
}

function rangeForMonth(event, year, monthIndex) {
  const monthStart = dateKey(year, monthIndex, 1);
  const monthEnd = dateKey(year, monthIndex, lastDay(year, monthIndex));
  const start = event.startDate < monthStart ? monthStart : event.startDate;
  const end = event.endDate > monthEnd ? monthEnd : event.endDate;
  const day = start.slice(8);
  return {
    weekday: weekdayOf(start),
    day: start === end ? day : `${day}–${end.slice(8)}`,
    period: start !== end,
  };
}

function renderEvent(event, year, monthIndex) {
  const item = textElement('article', 'event-row', '');
  const date = rangeForMonth(event, year, monthIndex);
  const dateBlock = textElement('div', 'event-date', '');
  dateBlock.append(textElement('span', 'event-weekday', date.weekday));
  dateBlock.append(textElement('strong', date.period ? 'event-day-range' : 'event-day', date.day));
  item.append(dateBlock);

  const detail = textElement('div', 'event-details', '');
  detail.append(textElement('h4', '', event.title || 'Evento sem título'));
  const parts = [];
  if (!event.allDay && event.startAt) parts.push(`Às ${formatHour(event.startAt)}`);
  if (event.location) parts.push(event.location.trim());
  if (parts.length) detail.append(textElement('p', 'event-meta', parts.join('  ·  ')));
  item.append(detail);
  return item;
}

function renderMonthPanel(year, monthIndex, events) {
  const panel = textElement('div', 'month-panel', '');
  const heading = textElement('div', 'month-panel-heading', '');
  heading.append(textElement('div', 'month-number', pad(monthIndex + 1)));
  heading.append(textElement('h3', '', MONTHS[monthIndex]));
  heading.append(textElement('span', 'month-count', `${events.length} evento${events.length === 1 ? '' : 's'}`));
  panel.append(heading);

  const list = textElement('div', 'event-list', '');
  if (!events.length) list.append(textElement('p', 'empty-month', 'Nenhum evento cadastrado para este mês.'));
  for (const event of events) list.append(renderEvent(event, year, monthIndex));
  panel.append(list);
  return panel;
}

function renderDetailSheet(year, monthIndexes, monthData, pageNumber, totalPages) {
  const sheet = textElement('section', 'print-sheet detail-sheet', '');
  sheet.setAttribute('aria-label', `Eventos de ${monthIndexes.map(index => MONTHS[index]).join(' e ')}`);
  const masthead = textElement('div', 'detail-masthead', '');
  const title = textElement('div', '', '');
  title.append(textElement('span', 'overline', 'Programação da igreja'));
  title.append(textElement('h2', '', 'Agenda de eventos'));
  masthead.append(title);
  masthead.append(textElement('div', 'detail-year', String(year)));
  sheet.append(masthead);

  const columns = textElement('div', 'month-columns', '');
  for (const monthIndex of monthIndexes) columns.append(renderMonthPanel(year, monthIndex, monthData[monthIndex]));
  sheet.append(columns);

  const foot = textElement('div', 'detail-foot', '');
  foot.append(textElement('span', '', 'Igreja Presbiteriana Central em Vilar dos Teles  ·  Agenda IPCVT'));
  foot.append(textElement('span', '', `${pageNumber} / ${totalPages}`));
  sheet.append(foot);
  return sheet;
}

function render() {
  if (!snapshot || !Number.isInteger(selectedYear)) return;
  const year = selectedYear;
  const yearEvents = snapshot.events.filter(event => event.startDate <= `${year}-12-31` && event.endDate >= `${year}-01-01`)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)
      || (a.startAt || '').localeCompare(b.startAt || '') || a.title.localeCompare(b.title, 'pt-BR'));
  const months = MONTHS.map((_, index) => monthEvents(yearEvents, year, index));

  byId('cover-year').textContent = year;
  byId('cover-summary').textContent = `${yearEvents.length} eventos registrados  ·  Fonte: Google Agenda`;
  const calendarGrid = byId('calendar-grid');
  calendarGrid.replaceChildren(...months.map((items, index) => renderMiniMonth(year, index, items)));

  const activeIndexes = months.map((items, index) => items.length ? index : -1).filter(index => index !== -1);
  const groups = [];
  for (let i = 0; i < activeIndexes.length; i += 2) groups.push(activeIndexes.slice(i, i + 2));
  const details = byId('detail-pages');
  details.replaceChildren(...groups.map((indexes, index) => renderDetailSheet(year, indexes, months, index + 2, groups.length + 1)));
  byId('print-area').hidden = false;
  printButton.disabled = false;
  const fileDate = snapshot.generatedAt ? `Arquivo gerado em ${formatDate(snapshot.generatedAt)}.` : '';
  status.textContent = `${yearEvents.length} eventos em ${year}. ${fileDate} "Atualizar" busca a última cópia publicada no Portal; alterações recentes feitas no Google podem levar alguns minutos para aparecer.`;
  status.classList.remove('is-error');
}

// A API pública do GitHub consulta o arquivo publicado na branch principal e
// evita a demora eventual do cache CDN de raw.githubusercontent.com.
// O Planner continua utilizando sua integração existente.
async function readLatestPublishedCalendar() {
  try {
    const endpoint = 'https://api.github.com/repos/NucleoIPCVT/Portal/contents/agenda-ipcvt.json';
    const response = await fetch(`${endpoint}?ref=main&at=${Date.now()}`, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error('API do GitHub indisponível');
    const file = await response.json();
    if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('Arquivo indisponível');
    const binary = atob(file.content.replace(/\\s/g, ''));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || !Array.isArray(data.events) || data.calendarId !== '0d88300041a5eeef838f5f57c87594ebbd4e2ae41b4f5745335825299acdc5de@group.calendar.google.com') {
      throw new Error('Calendário publicado não corresponde à Agenda IPCVT');
    }
    return data;
  } catch (error) {
    console.warn('Consulta direta ao GitHub falhou; tentando a cópia pública tradicional.', error);
    return readPublicCalendar({ now: Date.now() });
  }
}

async function loadCalendar() {
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  status.textContent = 'Buscando os eventos da Agenda IPCVT...';
  try {
    const fresh = await readLatestPublishedCalendar();
    snapshot = fresh;
    const years = [...new Set(fresh.events.flatMap(event => {
      const start = Number(event.startDate.slice(0, 4));
      const end = Number(event.endDate.slice(0, 4));
      return Array.from({ length: Math.min(end - start + 1, 10) }, (_, index) => start + index);
    }))].filter(year => year >= 2000 && year <= 2100).sort((a, b) => a - b);
    if (!years.length) years.push(new Date().getFullYear());
    const nowYear = new Date().getFullYear();
    if (!years.includes(selectedYear)) selectedYear = years.includes(nowYear) ? nowYear : years[years.length - 1];
    yearSelect.replaceChildren(...years.map(year => {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      return option;
    }));
    yearSelect.value = String(selectedYear);
    yearSelect.disabled = false;
    render();
  } catch (error) {
    status.textContent = error.message || 'Não foi possível obter a agenda. Tente novamente.';
    status.classList.add('is-error');
    if (!snapshot) {
      byId('print-area').hidden = true;
      printButton.disabled = true;
    }
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
  }
}

yearSelect.addEventListener('change', () => {
  selectedYear = Number(yearSelect.value);
  render();
});
refreshButton.addEventListener('click', loadCalendar);
printButton.addEventListener('click', () => window.print());
loadCalendar();
