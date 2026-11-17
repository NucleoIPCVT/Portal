/* Assistente progressivo para formulários já existentes do Planner IPCVT.
   Reagrupa os campos sem substituir IDs, listeners, validações ou salvamento. */
export function setupPlannerWizards() {
  const definitions = {
    plan: [
      { title: 'Identificação', hint: 'O que vamos organizar?', selectors: ['.plan-dialog-explain', '#plan-name', '.plan-ownership', '#plan-description'] },
      { title: 'Calendário', hint: 'Tipo, frequência e período', selectors: ['#plan-kind', '#plan-repeat-fields', '#plan-date-fields', '#plan-cycle-preview'] },
      { title: 'Organização', hint: 'Defina as colunas do quadro', selectors: ['#plan-buckets'] },
      { title: 'Revisão', hint: 'Confira antes de concluir', selectors: [] }
    ],
    task: [
      {
        title: 'Informações',
        hint: 'Identificação, datas e posição no quadro',
        selectors: ['.task-primary-title', '.task-primary-grid', '#task-advanced label[for="task-start"]', '#task-advanced label[for="task-bucket"]']
      },
      {
        title: 'Detalhamento',
        hint: 'Descrição, checklist, evento e dependências',
        selectors: ['#task-details .task-editor-section', '.task-event-section', '#legacy-relative-dates', '#task-dependencies-title', '#task-dependencies-editor']
      },
      {
        title: 'Equipe e recorrência',
        hint: 'Responsáveis, repetição e rodízios',
        selectors: ['#task-advanced label[for="task-team"]', '.task-people-section', '.task-repeat-section', '#task-rotation-roster', '#task-rotation-preview-wrap']
      },
      { title: 'Revisão', hint: 'Confira antes de salvar', selectors: [] }
    ]
  };
  const controllers = {};

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function caption(select) {
    const option = select?.selectedOptions?.[0];
    return (option?.textContent || '').trim();
  }
  function labelDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'A definir';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(value + 'T12:00:00Z'));
  }
  function create(name, stages) {
    const dialog = document.getElementById(name + '-dialog');
    const form = document.getElementById(name + '-form');
    if (!dialog || !form || dialog.dataset.wizardReady) return null;
    const body = form.querySelector('.dialog-body');
    const footer = form.querySelector('.dialog-footer');
    const saveButton = footer.querySelector('button[type="submit"]');
    const message = document.getElementById(name === 'task' ? 'task-feedback' : 'plan-feedback');
    if (!body || !footer || !saveButton) return null;
    dialog.classList.add('pm-wizard-dialog');

    // Indicador editorial, sem aparência de abas ou botões.
    const status = el('div', 'pm-wizard-status');
    status.setAttribute('aria-live', 'polite');
    const stepCopy = el('div', 'pm-wizard-status-copy');
    const stepTitle = el('h3', 'pm-wizard-current-title');
    const stepHint = el('p', 'pm-wizard-current-hint');
    stepCopy.append(stepTitle, stepHint);
    const stepCounter = el('span', 'pm-wizard-counter');
    const jumpField = el('label', 'pm-wizard-jump');
    jumpField.append(el('span', 'pm-wizard-jump-label', 'Ir para'));
    const jumpSelect = el('select', 'pm-wizard-jump-select');
    jumpSelect.setAttribute('aria-label', 'Ir diretamente para uma seção da demanda');
    stages.forEach((step, index) => {
      const choice = el('option', '', step.title);
      choice.value = String(index);
      jumpSelect.append(choice);
    });
    jumpField.append(jumpSelect);
    jumpField.hidden = true;
    const position = el('div', 'pm-wizard-position');
    position.append(stepCounter, jumpField);
    status.append(stepCopy, position);
    const progress = el('div', 'pm-wizard-progress');
    progress.setAttribute('aria-label', 'Progresso do preenchimento');
    const fill = el('div', 'pm-wizard-fill');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '1');
    progress.setAttribute('aria-valuemax', String(stages.length));
    progress.append(fill);
    const panels = el('div', 'pm-wizard-panels');
    let current = 0;
    let editing = false;
    jumpSelect.addEventListener('change', () => show(Number(jumpSelect.value)));

    // Guardar todas as referências antes de mover o DOM evita perder campos
    // que originalmente estavam dentro de <details> ou de outras seções.
    const stageFields = stages.map(step => step.selectors.map(source => {
      const node = body.querySelector(source);
      if (!node) throw new Error('Campo do assistente não encontrado: ' + source);
      return node;
    }));

    const allPanels = stages.map((step, index) => {
      const panel = el('section', 'pm-wizard-panel');
      panel.setAttribute('aria-label', step.title);
      for (const node of stageFields[index]) {
        panel.append(node);
      }
      if (index === stages.length - 1) {
        panel.append(el('h3', 'pm-wizard-review-title', 'Pronto para salvar?'));
        panel.append(el('p', 'pm-wizard-review-hint', 'Confira os principais dados. Você pode voltar a qualquer etapa para editar.'));
        panel.append(el('dl', 'pm-wizard-review'));
        if (name === 'task') {
          const history = body.querySelector('#task-history');
          if (history) panel.append(history);
        }
      }
      panels.append(panel);
      return panel;
    });
    const oldAdvanced = document.getElementById('plan-advanced');
    if (name === 'plan' && oldAdvanced) oldAdvanced.hidden = true;
    if (name === 'task') {
      // Os antigos <details> deixam de aparecer como blocos "Mais opções".
      // Os campos foram realocados nas etapas, preservando os seus IDs.
      for (const id of ['task-details', 'task-advanced']) {
        const leftover = document.getElementById(id);
        if (leftover) leftover.hidden = true;
      }
      const instructions = document.getElementById('task-details-title');
      if (instructions) instructions.textContent = 'Orientações e checklist';
    }

    const previous = el('button', 'button button-quiet pm-wizard-back', 'Voltar');
    previous.type = 'button';
    const next = el('button', 'button button-primary pm-wizard-next', 'Continuar');
    next.type = 'button';
    previous.addEventListener('click', () => show(Math.max(0, current - 1)));
    next.addEventListener('click', () => {
      if (editing || validateRange(current, current + 1)) {
        show(Math.min(stages.length - 1, current + 1));
      }
    });
    saveButton.classList.add('pm-wizard-submit');
    saveButton.textContent = name === 'task' ? 'Salvar demanda' : 'Salvar plano';
    footer.insertBefore(previous, saveButton);
    footer.insertBefore(next, saveButton);
    body.prepend(panels);
    body.prepend(progress);
    body.prepend(status);
    form.noValidate = true;

    function rows() {
      const get = id => document.getElementById(id);
      if (name === 'plan') return [
        ['Plano', get('plan-name').value || 'Sem nome'],
        ['Responsável pelo plano', get('plan-owner-email').value || 'Não definido'],
        ['Tipo', caption(get('plan-kind'))],
        ['Periodicidade', get('plan-kind').value === 'recurring'
          ? 'A cada ' + get('plan-repeat-interval').value + ' ' + caption(get('plan-repeat-unit')).toLowerCase()
          : 'Sem repetição'],
        ['Início', labelDate(get('plan-start').value)],
        ['Prazo', labelDate(get('plan-due').value)],
        ['Etapas', (get('plan-buckets').value || '').split('\n').map(x => x.trim()).filter(Boolean).join(' · ') || 'Não definidas']
      ];
      return [
        ['Demanda', get('task-title').value || 'Sem título'],
        ['Plano', caption(get('task-plan'))],
        ['Início', labelDate(get('task-start').value)],
        ['Entrega', labelDate(get('task-due').value)],
        ['Situação', caption(get('task-status'))],
        ['Coluna', caption(get('task-bucket')) || 'Sem coluna'],
        ['Prioridade', caption(get('task-priority'))],
        ['Equipe', get('task-team').value || 'Não definida'],
        ['Repetição', get('task-repeat-mode').closest('.field').hidden ? 'Controlada pelo plano' : caption(get('task-repeat-mode'))],
        ['Evento-alvo', caption(get('task-event')) || 'Sem evento-alvo']
      ];
    }
    function renderReview() {
      const dl = allPanels[stages.length - 1].querySelector('.pm-wizard-review');
      dl.replaceChildren();
      for (const [title, content] of rows()) {
        const row = el('div', 'pm-wizard-review-row');
        row.append(el('dt', '', title), el('dd', '', content));
        dl.append(row);
      }
    }
    function hiddenByContext(element) {
      let parent = element;
      while (parent && parent !== allPanels[current]) {
        if (parent.hidden && !parent.classList.contains('pm-wizard-panel')) return true;
        parent = parent.parentElement;
      }
      return false;
    }
    function validateOne(index) {
      const panel = allPanels[index];
      for (const input of panel.querySelectorAll('input,textarea,select')) {
        if (input.disabled || input.type === 'hidden') continue;
        if (input.closest('[hidden]') && input.closest('[hidden]') !== panel) continue;
        if (!input.validity.valid) {
          message.textContent = 'Preencha corretamente: ' +
            (input.closest('label')?.innerText?.trim().split('\n')[0] || input.getAttribute('aria-label') || 'campo obrigatório') + '.';
          show(index);
          input.focus({ preventScroll: false });
          return false;
        }
      }
      if (name === 'plan' && index === 1 && document.getElementById('plan-kind').value === 'recurring'
          && document.getElementById('plan-repeat-unit').value === 'week') {
        const start = document.getElementById('plan-start').value;
        const due = document.getElementById('plan-due').value;
        const step = Number(document.getElementById('plan-repeat-interval').value) * 7;
        const days = Math.round((Date.parse(due + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86400000);
        if (!start || !due || !Number.isInteger(step) || step < 7 || days < 0 || days >= step) {
          message.textContent = 'Defina um início e um prazo dentro do mesmo ciclo de repetição.';
          show(index);
          document.getElementById('plan-due').focus();
          return false;
        }
      }
      return true;
    }
    function validateRange(from, to) {
      message.textContent = '';
      for (let index = 0; index < to; index++) if (!validateOne(index)) return false;
      return true;
    }
    function show(index) {
      current = index;
      allPanels.forEach((panel, i) => { panel.hidden = i !== index; });
      stepTitle.textContent = stages[index].title;
      stepHint.textContent = stages[index].hint;
      stepCounter.textContent = 'Etapa ' + (index + 1) + ' de ' + stages.length;
      jumpSelect.value = String(index);
      jumpField.hidden = !editing;
      stepCounter.hidden = editing;
      previous.hidden = index === 0;
      next.hidden = index === stages.length - 1;
      saveButton.hidden = !editing && index !== stages.length - 1;
      saveButton.textContent = editing
        ? 'Salvar alterações' : (name === 'task' ? 'Salvar demanda' : 'Salvar plano');
      next.textContent = editing ? 'Próxima seção' : 'Continuar';
      fill.style.width = ((index + 1) / stages.length * 100) + '%';
      progress.setAttribute('aria-valuenow', String(index + 1));
      if (index === stages.length - 1) renderReview();
      if (dialog.open) {
        body.scrollTop = 0;
      }
    }
    form.addEventListener('submit', event => {
      if (!editing && current < stages.length - 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (validateRange(0, current + 1)) show(current + 1);
      } else if (!validateRange(0, stages.length - 1)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    dialog.dataset.wizardReady = 'true';
    show(0);
    return {
      reset({ editing: isEditing = false } = {}) {
        editing = name === 'task' && Boolean(isEditing);
        dialog.classList.toggle('pm-wizard-edit-mode', editing);
        show(0);
        message.textContent = '';
      },
      last() { show(stages.length - 1); }
    };
  }

  for (const [name, stages] of Object.entries(definitions)) controllers[name] = create(name, stages);
  return controllers;
}
