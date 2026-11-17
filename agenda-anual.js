import { publicCalendar, readPublicCalendar, hasDirectGoogleAccess, parseCalendarSourceUrl, calendarWebUrl } from './planner-public.js?v=20261116-multi-source-ids-v1';
import { createAgendaSources } from './agenda-fontes.js?v=20261117-remove-v1';
let calendarSource = { calendarId: publicCalendar.id, sourceUrl: publicCalendar.sourceUrl };
let calendarRequestSequence = 0;
function activeCalendarName() {
  if(snapshot?.calendarId===calendarSource.calendarId&&snapshot.calendarName?.trim())
    return snapshot.calendarName.trim();
  return calendarSource.calendarId===publicCalendar.id ? publicCalendar.name : calendarSource.calendarId;
}
function updateCalendarSourceLabels() {
  const name=activeCalendarName();
  byId('agenda-active-source-name').textContent=name;
  byId('agenda-config-current').textContent='Fonte atual: '+name;
  byId('agenda-google-link').href=calendarWebUrl(calendarSource.calendarId);
  byId('agenda-google-link').title='Ver “'+name+'” diretamente no Google Agenda';
}

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
// As preferências locais e as fontes adicionais não alteram o calendário principal do Planner.
const sourceManager=createAgendaSources({getPrimary:()=>calendarSource,onChange:()=>void loadCalendar({checkWorkflow:false})});

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
    if (marked.has(day)) {
      const dayKey=dateKey(year,monthIndex,day);
      const sourceIds=new Set();
      for(const event of events){
        if(event.startDate<=dayKey&&event.endDate>=dayKey){
          for(const sourceId of event.sourceIds||[event.sourceId]) if(sourceId)sourceIds.add(sourceId);
        }
      }
      // Contorno multicolorido: uma cor ocupa todo o perímetro; várias
      // fontes dividem o contorno em segmentos proporcionais, sem pontos.
      const colors=[...sourceIds]
        .map(sourceId=>sourceManager.info(sourceId)?.color)
        .filter(Boolean);
      if(colors.length){
        const stops=colors.map((color,index)=>{
          const from=(index*100/colors.length).toFixed(4);
          const to=((index+1)*100/colors.length).toFixed(4);
          return color+' '+from+'% '+to+'%';
        });
        cell.classList.add('agenda-source-ring');
        cell.style.setProperty('--agenda-ring-gradient','conic-gradient('+stops.join(', ')+')');
      }
      cell.setAttribute('aria-label',day+' de '+MONTHS[monthIndex]+': '+[...sourceIds].map(id=>sourceManager.info(id)?.name||'').filter(Boolean).join(', '));
    }
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
  const item = textElement('article', 'event-row agenda-colored-event', '');
  item.style.setProperty('--event-color',sourceManager.info(event.sourceId)?.color||'#668e74');
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
  const sources=textElement('div','agenda-event-source-line','');
  for(const sourceId of event.sourceIds||[event.sourceId]){
    const source=sourceManager.info(sourceId);
    if(!source)continue;
    const chip=textElement('span','agenda-event-source-chip',source.name);
    chip.style.setProperty('--source-color',source.color);
    sources.append(chip);
  }
  detail.append(sources);
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
  foot.append(textElement('span', '', 'Igreja Presbiteriana Central em Vilar dos Teles  ·  ' + activeCalendarName()));
  foot.append(textElement('span', '', `${pageNumber} / ${totalPages}`));
  sheet.append(foot);
  return sheet;
}

function duplexMonth(monthIndex, events) {
  const panel = textElement('section', 'duplex-month', '');
  panel.dataset.monthIndex = String(monthIndex);
  const heading = textElement('header', 'duplex-month-heading', '');
  heading.append(textElement('strong', '', MONTHS[monthIndex]));
  heading.append(textElement('span', '', `${events.length}`));
  panel.append(heading);

  for (const event of events) {
    const row = textElement('article', 'duplex-event-row agenda-colored-event', '');
    row.style.setProperty('--event-color',sourceManager.info(event.sourceId)?.color||'#668e74');
    const date = textElement('div', 'duplex-event-date', '');
    date.append(textElement('strong', '', event.startDate.slice(8)));
    if (event.startDate !== event.endDate) {
      const end = event.endDate;
      const range = event.startDate.slice(5, 7) === end.slice(5, 7)
        ? `–${end.slice(8)}` : `até ${end.slice(8)}/${end.slice(5, 7)}`;
      date.append(textElement('small', '', range));
    }
    const detail = textElement('div', 'duplex-event-detail', '');
    detail.append(textElement('strong', '', event.title || 'Evento sem título'));
    if (!event.allDay && event.startAt) detail.append(textElement('span', 'duplex-event-time', ` · ${formatHour(event.startAt)}`));
    if (event.location?.trim()) {
      const place = event.location.trim().replace(/^Igreja Presbiteriana Central em Vilar dos Teles$/i, 'IPCVT');
      detail.append(textElement('span', 'duplex-event-place', ` · ${place}`));
    }
    row.append(date, detail);
    panel.append(row);
  }
  return panel;
}

function duplexCalendarPage(year, months, totalEvents) {
  const page = textElement('section', 'duplex-sheet duplex-calendar-page', '');
  page.setAttribute('aria-label', `Frente: calendário completo de ${year}`);
  const heading = textElement('header', 'duplex-calendar-heading', '');
  const brand = textElement('div', 'duplex-calendar-brand', '');
  const churchLogo = document.createElement('img');
  churchLogo.src = 'logo-igreja.png';
  churchLogo.alt = '';
  brand.append(churchLogo);
  const identity = textElement('div', '', '');
  identity.append(textElement('span', '', 'Igreja Presbiteriana Central em Vilar dos Teles'));
  identity.append(textElement('h2', '', 'Calendário anual'));
  brand.append(identity);
  heading.append(brand, textElement('strong', '', String(year)));
  page.append(heading);

  const grid = textElement('div', 'duplex-calendar-grid', '');
  for (let index = 0; index < 12; index += 1) grid.append(renderMiniMonth(year, index, months[index]));
  page.append(grid);

  const footer = textElement('footer', 'duplex-calendar-footer', '');
  footer.append(textElement('span', '', `● Dias com eventos  ·  ${totalEvents} compromissos no ano`));
  const societies = textElement('div', 'duplex-calendar-societies', '');
  for (const [name, label] of [
    ['saf', 'Sociedade Auxiliadora Feminina'],
    ['uph', 'União Presbiteriana de Homens'],
    ['ucp', 'União de Crianças Presbiterianas'],
    ['ump', 'União de Mocidade Presbiteriana'],
    ['upa', 'União Presbiteriana de Adolescentes'],
  ]) {
    const logo = document.createElement('img');
    logo.src = `logo-${name}.webp`;
    logo.alt = label;
    societies.append(logo);
  }
  footer.append(societies);
  page.append(footer);
  return page;
}

function balancedMonthRanges(eventMonths, measuredHeights) {
  const weights = measuredHeights || eventMonths.map(items => items.length ? 2 + items.reduce((sum, event) =>
    sum + 1 + Math.max(0, (event.title?.length || 0) + (event.location?.length || 0) - 70) / 85, 0) : 0);
  const weight = (start, end) => weights.slice(start, end).reduce((sum, value) => sum + value, 0);
  let best = [3, 6, 9];
  let score = Infinity;
  for (let first = 1; first <= 9; first += 1) {
    for (let second = first + 1; second <= 10; second += 1) {
      for (let third = second + 1; third <= 11; third += 1) {
        const loads = [weight(0, first), weight(first, second), weight(second, third), weight(third, 12)];
        const nextScore = Math.max(...loads) + (Math.max(...loads) - Math.min(...loads)) * .15;
        if (nextScore < score) { score = nextScore; best = [first, second, third]; }
      }
    }
  }
  return [[0, best[0]], [best[0], best[1]], [best[1], best[2]], [best[2], 12]];
}

function rebalanceDuplexColumns(page) {
  const columns = [...page.querySelectorAll('.duplex-event-column')];
  const panels = [...page.querySelectorAll('.duplex-month')];
  if (columns.length !== 4 || !panels.length) return columns;
  // O peso usado inicialmente é estimado. Aqui o navegador já pode medir
  // títulos longos e locais com quebras de linha na largura real da coluna.
  const heights = Array(12).fill(0);
  for (const panel of panels) {
    const style = getComputedStyle(panel);
    heights[Number(panel.dataset.monthIndex)] = panel.getBoundingClientRect().height + parseFloat(style.marginBottom || '0') + 3;
  }
  const ranges = balancedMonthRanges([], heights);
  ranges.forEach(([start, end], index) => {
    columns[index].replaceChildren(...panels.filter(panel => {
      const month = Number(panel.dataset.monthIndex);
      return month >= start && month < end;
    }));
  });
  return columns;
}

function duplexEventsPage(year, events, pageNumber, totalPages) {
  const page = textElement('section', 'duplex-sheet duplex-events-page', '');
  page.setAttribute('aria-label', `Verso: eventos de ${year}, parte ${pageNumber} de ${totalPages}`);
  const heading = textElement('header', 'duplex-events-heading', '');
  const headerText = textElement('div', '', '');
  headerText.append(textElement('span', '', activeCalendarName() + ' · Programação da igreja'));
  headerText.append(textElement('h2', '', 'Eventos do ano'));
  heading.append(headerText, textElement('strong', '', String(year)));
  page.append(heading);

  const eventMonths = MONTHS.map((_, index) => events.filter(event => {
    const month = event.startDate < `${year}-01-01` ? 1 : Number(event.startDate.slice(5, 7));
    return month === index + 1;
  }));
  const columns = textElement('div', 'duplex-event-columns', '');
  for (const [start, end] of balancedMonthRanges(eventMonths)) {
    const column = textElement('div', 'duplex-event-column', '');
    for (let index = start; index < end; index += 1) {
      if (eventMonths[index].length) column.append(duplexMonth(index, eventMonths[index]));
    }
    columns.append(column);
  }
  page.append(columns);
  const footer = textElement('footer', 'duplex-events-footer', '');
  footer.append(textElement('span', '', `Fonte: Google Agenda  ·  ${events.length} eventos nesta página`));
  footer.append(textElement('span', '', totalPages > 1 ? `${pageNumber} / ${totalPages}` : 'IPCVT'));
  page.append(footer);
  return page;
}

function renderDuplex(year, months, yearEvents) {
  const area = byId('booklet-print-area');
  const front = duplexCalendarPage(year, months, yearEvents.length);
  // Uma página de eventos no verso. Anos excepcionalmente cheios ganham
  // uma página de continuação para não cortar compromissos da agenda.
  let groups = [yearEvents];
  requestAnimationFrame(() => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const backs = groups.map((events, index) => duplexEventsPage(year, events, index + 1, groups.length));
      area.replaceChildren(front, ...backs);
      const overflow = [];
      backs.forEach((back, index) => {
        let columns = rebalanceDuplexColumns(back);
        let font = 8.2;
        while (font > 6.8 && columns.some(col => col.scrollHeight > col.clientHeight * .98 + 1)) {
          font = Math.max(6.8, font - .2);
          back.style.setProperty('--duplex-event-font', `${font.toFixed(1)}pt`);
          columns = rebalanceDuplexColumns(back);
        }
        if (columns.some(col => col.scrollHeight > col.clientHeight + 1)) overflow.push(index);
      });
      if (!overflow.length) break;
      const next = [];
      for (let index = 0; index < groups.length; index += 1) {
        const events = groups[index];
        if (overflow.includes(index) && events.length > 1) {
          const middle = Math.ceil(events.length / 2);
          next.push(events.slice(0, middle), events.slice(middle));
        } else next.push(events);
      }
      if (next.length === groups.length) break;
      groups = next;
    }
    const pageCount = area.querySelectorAll('.duplex-sheet').length;
    byId('booklet-sheet-count').textContent = pageCount === 2
      ? ` · ${yearEvents.length} eventos, 2 páginas (frente e verso).`
      : ` · ${yearEvents.length} eventos, ${pageCount} páginas para não cortar a programação.`;
  });
}

function render() {
  if (!snapshot || !Number.isInteger(selectedYear)) return;
  const year = selectedYear;
  const yearEvents = snapshot.events.filter(event => event.startDate <= `${year}-12-31` && event.endDate >= `${year}-01-01`)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)
      || (a.startAt || '').localeCompare(b.startAt || '') || a.title.localeCompare(b.title, 'pt-BR'));
  const months = MONTHS.map((_, index) => monthEvents(yearEvents, year, index));

  byId('cover-year').textContent = year;
  byId('cover-summary').textContent = yearEvents.length+' registros no ano · '+sourceManager.active().length+' fontes ativas';
  const legend=byId('agenda-colors-legend');
  if(legend){
    legend.replaceChildren();
    for(const source of sourceManager.active()){
      const item=textElement('span','','');
      const dot=textElement('i','','');dot.style.backgroundColor=source.color;
      item.append(dot,document.createTextNode(source.name));legend.append(item);
    }
  }
  updateCalendarSourceLabels();
  const calendarGrid = byId('calendar-grid');
  calendarGrid.replaceChildren(...months.map((items, index) => renderMiniMonth(year, index, items)));

  const activeIndexes = months.map((items, index) => items.length ? index : -1).filter(index => index !== -1);
  const groups = [];
  for (let i = 0; i < activeIndexes.length; i += 2) groups.push(activeIndexes.slice(i, i + 2));
  const details = byId('detail-pages');
  details.replaceChildren(...groups.map((indexes, index) => renderDetailSheet(year, indexes, months, index + 2, groups.length + 1)));
  renderDuplex(year, months, yearEvents);
  byId('print-area').hidden = false;
  printButton.disabled = false;
  const direct = snapshot.sourceKind === 'google-api';
  const fileDate = snapshot.generatedAt
    ? `${direct ? 'Consulta direta ao Google' : 'Última alteração importada'}: ${formatDate(snapshot.generatedAt)}.` : '';
  const verifiedDate = !direct && lastSuccessfulSync
    ? `Última consulta automática ao Google: ${formatDate(lastSuccessfulSync)}.` : '';
  const overdue = !direct && lastSuccessfulSync && Date.now() - Date.parse(lastSuccessfulSync) > 45 * 60 * 1000;
  const explanation = snapshot.warnings?.length
    ? 'Algumas fontes não puderam ser atualizadas: '+snapshot.warnings.join(' | ')
    : direct
    ? 'Agendas Google consultadas diretamente. Datas oficiais IPB de 2026 incluídas como edição publicada.'
    : snapshot.warning || (overdue
      ? 'A sincronização automática está atrasada. Confira o Google Agenda para ver as alterações mais recentes.'
      : 'Atualizar consulta a cópia sincronizada no Portal; a integração direta ainda não está configurada.');
  status.textContent = `${yearEvents.length} eventos em ${year}. ${fileDate} ${verifiedDate} ${explanation}`;
  status.classList.remove('is-error');
  status.classList.toggle('is-warning', Boolean(overdue || snapshot.warning || snapshot.warnings?.length));
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
  const request = ++calendarRequestSequence;
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  status.textContent = 'Buscando os eventos de ' + activeCalendarName() + '...';
  try {
    const fresh = await sourceManager.readAll();
    if (request !== calendarRequestSequence) return;
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
    if (request !== calendarRequestSequence) return;
    status.textContent = error.message || 'Não foi possível obter a agenda. Tente novamente.';
    status.classList.add('is-error');
    if (!snapshot) {
      byId('print-area').hidden = true;
      printButton.disabled = true;
    }
  } finally {
    if (request === calendarRequestSequence) {
      refreshButton.disabled = false;
      refreshButton.classList.remove('is-loading');
    }
  }
}


async function initializeAgendaConfiguration() {
  // A consulta da Agenda é pública. A edição só aparece depois da validação
  // da sessão Firebase compartilhada com o Painel da Comissão.
  const configButton=byId('agenda-config-button');
  const dialog=byId('agenda-config-dialog');
  const configForm=byId('agenda-config-form');
  const feedback=byId('agenda-config-feedback');
  configButton.hidden=true;
  configForm.hidden=true;
  updateCalendarSourceLabels();
  try {
    const [
      { initializeApp, getApps },
      { getAuth, onAuthStateChanged },
      { getFirestore, doc, onSnapshot, setDoc, serverTimestamp }
    ]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js')
    ]);
    const app=getApps().find(item=>item.name==='ipcvt-comissao')||initializeApp({
      apiKey:'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
      authDomain:'repertorio-ipcvt.firebaseapp.com',
      projectId:'repertorio-ipcvt',
      storageBucket:'repertorio-ipcvt.firebasestorage.app',
      messagingSenderId:'774659782213',
      appId:'1:774659782213:web:5e9cbf88fec30eb382152c'
    },'ipcvt-comissao');
    const auth=getAuth(app),firestore=getFirestore(app);
    const calendarRef=doc(firestore,'comissao_planner','main','config','calendar');
    let canManage=false,managingEmail='',sequence=0,stopPermission=null;
    function setAccess(allowed,email='') {
      canManage=Boolean(allowed);
      managingEmail=canManage?email:'';
      configButton.hidden=!canManage;
      configForm.hidden=!canManage;
      sourceManager.setAdmin(canManage,async changes=>{
        await setDoc(calendarRef,{...changes,updatedBy:managingEmail,updatedAt:serverTimestamp()},{merge:true});
      });
      if(!canManage) {
        if(dialog.open)dialog.close();
        feedback.textContent='';
      }
    }
    configButton.addEventListener('click',()=>{
      if(!canManage||!auth.currentUser)return;
      byId('agenda-config-url').value=calendarSource.sourceUrl;
      updateCalendarSourceLabels();
      feedback.textContent='Administrador autorizado: '+managingEmail;
      dialog.showModal();
    });
    byId('agenda-config-close').addEventListener('click',()=>dialog.close());
    byId('agenda-config-cancel').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{
      if(event.target===dialog)dialog.close();
    });
    onAuthStateChanged(auth,async user=>{
      const current=++sequence;
      stopPermission?.();
      stopPermission=null;
      setAccess(false);
      if(!user?.email)return;
      try {
        const token=await user.getIdTokenResult();
        if(current!==sequence)return;
        const email=user.email.trim().toLowerCase();
        if(!email||!user.emailVerified||token.claims.email_verified!==true||
          token.claims.firebase?.sign_in_provider!=='google.com')return;
        // A revogação ou alteração do perfil na Comissão é refletida imediatamente.
        stopPermission=onSnapshot(doc(firestore,'comissao_acessos',email),record=>{
          if(current!==sequence)return;
          const access=record.exists()?record.data():null;
          setAccess(access?.ativo===true&&access.perfil==='admin',email);
        },error=>{
          if(current!==sequence)return;
          setAccess(false);
          console.warn('Permissão de administrador da Agenda indisponível.',error);
        });
      }catch(error){
        if(current===sequence){
          setAccess(false);
          console.warn('Sessão da Comissão não confirmada para a Agenda.',error);
        }
      }
    });
    configForm.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!canManage||!managingEmail||auth.currentUser?.email?.toLowerCase()!==managingEmail){
        feedback.textContent='Somente um administrador autorizado da Comissão pode alterar a agenda.';
        return;
      }
      const save=byId('agenda-config-save');
      save.disabled=true;
      feedback.textContent='Verificando o calendário público no Google...';
      try {
        const parsed=parseCalendarSourceUrl(byId('agenda-config-url').value);
        const checked=await readPublicCalendar({calendarId:parsed.calendarId});
        if(checked.calendarId!==parsed.calendarId)throw new Error('O calendário retornado não corresponde à origem selecionada.');
        const name=String(checked.calendarName||parsed.calendarId).trim();
        feedback.textContent='Agenda “'+name+'” validada. Salvando...';
        await setDoc(calendarRef,{
          calendarId:parsed.calendarId,sourceUrl:parsed.sourceUrl,
          updatedBy:managingEmail,updatedAt:serverTimestamp()
        },{merge:true});
        feedback.textContent='Fonte salva: “'+name+'”. A Agenda Anual e o Planner utilizarão a mesma origem. A cópia de segurança do GitHub pode levar alguns minutos para sincronizar.';
      }catch(error){
        feedback.textContent=error.code==='permission-denied'
          ?'O Firebase recusou a alteração. Confirme seu perfil de administrador ativo na Comissão.'
          :error.message||'Não foi possível salvar a origem da agenda.';
      }finally{save.disabled=false;}
    });
    // A configuração é legível publicamente; apenas a gravação exige admin.
    onSnapshot(calendarRef,record=>{
      if(!record.exists())return;
      try {
        const data=record.data();
        sourceManager.setSharedSources(data.additionalSources,data.removedSourceIds);
        const parsed=parseCalendarSourceUrl(data.sourceUrl);
        if(parsed.calendarId!==data.calendarId)throw new Error('A configuração remota contém um calendário divergente.');
        const changed=parsed.calendarId!==calendarSource.calendarId;
        calendarSource=parsed;
        if(changed){
          snapshot=null;
          lastSuccessfulSync=null;
          byId('print-area').hidden=true;
          printButton.disabled=true;
          updateCalendarSourceLabels();
          void loadCalendar();
        }else{
          updateCalendarSourceLabels();
        }
        if(canManage&&!dialog.open)byId('agenda-config-url').value=parsed.sourceUrl;
      }catch(error){
        console.warn('Configuração remota de agenda inválida.',error);
      }
    },error=>console.warn('Não foi possível ler a configuração compartilhada; usando a agenda original.',error));
  }catch(error){
    configButton.hidden=true;
    configForm.hidden=true;
    console.warn('Administração da Agenda Anual indisponível. Consulta pública preservada.',error);
  }
}
void initializeAgendaConfiguration();

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
