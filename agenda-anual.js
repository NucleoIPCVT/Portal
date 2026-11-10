import { readPublicCalendar, hasDirectGoogleAccess } from './planner-public.js';

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
let lastSuccessfulSync = null;
let lastCalendarLoad = 0;

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

function bookletPage(className, label) {
  const page = textElement('section', `booklet-page ${className}`, '');
  page.setAttribute('aria-label', label);
  return page;
}

function bookletCover(year, totalEvents) {
  const page = bookletPage('booklet-cover', `Capa da agenda de ${year}`);
  const identity = textElement('div', 'booklet-cover-identity', '');
  const logo = document.createElement('img');
  logo.src = 'logo-igreja.png';
  logo.alt = '';
  identity.append(logo);
  identity.append(textElement('p', '', 'Igreja Presbiteriana Central em Vilar dos Teles'));
  page.append(identity);
  const center = textElement('div', 'booklet-cover-center', '');
  center.append(textElement('span', 'booklet-cover-kicker', 'Programação da igreja'));
  center.append(textElement('h1', '', 'Agenda anual'));
  center.append(textElement('strong', 'booklet-cover-year', String(year)));
  center.append(textElement('p', '', 'Encontros, celebrações e atividades da nossa comunidade.'));
  page.append(center);
  const footer = textElement('div', 'booklet-cover-footer', '');
  const societies = textElement('div', 'booklet-cover-societies', '');
  const logos = [
    ['saf', 'Sociedade Auxiliadora Feminina'],
    ['uph', 'União Presbiteriana de Homens'],
    ['ucp', 'União de Crianças Presbiterianas'],
    ['ump', 'União de Mocidade Presbiteriana'],
    ['upa', 'União Presbiteriana de Adolescentes'],
  ];
  for (const [name, label] of logos) {
    const logo = document.createElement('img');
    logo.src = `logo-${name}.webp`;
    logo.alt = label;
    societies.append(logo);
  }
  footer.append(societies);
  footer.append(textElement('p', 'booklet-cover-bottom', `IPCVT  ·  ${totalEvents} eventos registrados`));
  page.append(footer);
  return page;
}

function bookletMonthPage(year, indexes, months) {
  const page = bookletPage('booklet-events-page', `Programação de ${indexes.map(index => MONTHS[index]).join(' e ')}`);
  const header = textElement('header', 'booklet-events-header', '');
  header.append(textElement('span', '', 'Agenda IPCVT'));
  header.append(textElement('strong', '', String(year)));
  page.append(header);
  const list = textElement('div', 'booklet-month-list', '');
  for (const index of indexes) list.append(renderMonthPanel(year, index, months[index]));
  page.append(list);
  return page;
}

function bookletCalendar(year, months) {
  const page = bookletPage('booklet-calendar-page', `Calendário de ${year}`);
  const heading = textElement('div', 'booklet-calendar-heading', '');
  heading.append(textElement('span', '', 'IPCVT  ·  Calendário anual'));
  heading.append(textElement('h2', '', String(year)));
  page.append(heading);
  const grid = textElement('div', 'booklet-calendar-grid', '');
  for (let i = 0; i < 12; i += 1) grid.append(renderMiniMonth(year, i, months[i]));
  page.append(grid);
  page.append(textElement('div', 'booklet-calendar-legend', '● Dias com eventos na Agenda IPCVT'));
  return page;
}

function renderBooklet(year, groups, months, totalEvents) {
  // Uma folha dobrada contém quatro páginas. A frente da primeira folha
  // mostra a última página à esquerda e a capa à direita.
  const pages = [
    bookletCover(year, totalEvents),
    ...groups.map(indexes => bookletMonthPage(year, indexes, months)),
    bookletCalendar(year, months),
  ];
  while (pages.length % 4 !== 0) {
    pages.splice(pages.length - 1, 0, bookletPage('booklet-blank-page', 'Página de preenchimento'));
  }

  pages.forEach((page, index) => {
    if (page.classList.contains('booklet-events-page')) {
      page.append(textElement('footer', 'booklet-page-footer', `Igreja Presbiteriana Central em Vilar dos Teles  ·  ${index + 1} / ${pages.length}`));
    }
  });

  const spreads = [];
  for (let sheet = 0; sheet < pages.length / 4; sheet += 1) {
    const front = textElement('div', 'booklet-spread', '');
    front.append(pages[pages.length - 1 - sheet * 2], pages[sheet * 2]);
    front.setAttribute('aria-label', `Folha ${sheet + 1}, frente`);
    const back = textElement('div', 'booklet-spread', '');
    back.append(pages[sheet * 2 + 1], pages[pages.length - 2 - sheet * 2]);
    back.setAttribute('aria-label', `Folha ${sheet + 1}, verso`);
    spreads.push(front, back);
  }
  byId('booklet-print-area').replaceChildren(...spreads);
  const sheets = pages.length / 4;
  byId('booklet-sheet-count').textContent = ` · ${sheets} folha${sheets === 1 ? '' : 's'} A4 (${spreads.length} páginas no PDF).`;
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
  renderBooklet(year, groups, months, yearEvents.length);
  byId('print-area').hidden = false;
  printButton.disabled = false;
  const direct = snapshot.sourceKind === 'google-api';
  const fileDate = snapshot.generatedAt
    ? `${direct ? 'Consulta direta ao Google' : 'Última alteração importada'}: ${formatDate(snapshot.generatedAt)}.` : '';
  const verifiedDate = !direct && lastSuccessfulSync
    ? `Última consulta automática ao Google: ${formatDate(lastSuccessfulSync)}.` : '';
  const overdue = !direct && lastSuccessfulSync && Date.now() - Date.parse(lastSuccessfulSync) > 45 * 60 * 1000;
  const explanation = direct
    ? 'Dados obtidos diretamente do Google Agenda. Atualizar consulta o Google novamente.'
    : snapshot.warning || (overdue
      ? 'A sincronização automática está atrasada. Confira o Google Agenda para ver as alterações mais recentes.'
      : 'Atualizar consulta a cópia sincronizada no Portal; a integração direta ainda não está configurada.');
  status.textContent = `${yearEvents.length} eventos em ${year}. ${fileDate} ${verifiedDate} ${explanation}`;
  status.classList.remove('is-error');
  status.classList.toggle('is-warning', Boolean(overdue || snapshot.warning));
}

// Exibe quando o servidor realmente consultou o Google, inclusive se não
// houve modificações no calendário e o arquivo JSON permaneceu igual.
async function checkLatestSync() {
  try {
    const endpoint = 'https://api.github.com/repos/NucleoIPCVT/Portal/actions/workflows/sync-agenda-ipcvt.yml/runs';
    const response = await fetch(`${endpoint}?per_page=8&at=${Date.now()}`, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const data = await response.json();
    const successful = data.workflow_runs?.find(run => run.status === 'completed' && run.conclusion === 'success');
    if (successful) lastSuccessfulSync = successful.updated_at || successful.run_started_at || successful.created_at;
    if (snapshot) render();
  } catch {
    // O calendário continua disponível quando a API de status está indisponível.
  }
}

async function loadCalendar({ checkWorkflow = true } = {}) {
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  status.textContent = 'Buscando os eventos da Agenda IPCVT...';
  try {
    const fresh = await readPublicCalendar({ now: Date.now() });
    snapshot = fresh;
    lastCalendarLoad = Date.now();
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
    if (checkWorkflow && fresh.sourceKind !== 'google-api') void checkLatestSync();
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
refreshButton.addEventListener('click', () => loadCalendar());
printButton.addEventListener('click', () => window.print());
loadCalendar();

// Atualiza a tela enquanto ela estiver aberta e ao voltar para a aba.
setInterval(() => {
  if (document.visibilityState === 'visible' && !refreshButton.disabled) void loadCalendar({ checkWorkflow: false });
}, hasDirectGoogleAccess() ? 2 * 60 * 1000 : 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastCalendarLoad > 60 * 1000 && !refreshButton.disabled) {
    void loadCalendar({ checkWorkflow: false });
  }
});
