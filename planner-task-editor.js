// Structured task fields. These editors keep the existing Firestore payload shape.
let editorSequence = 0

export function createTaskEditor({ assigneesRoot, checklistRoot, dependencyRoot, onAssigneesChange = () => {} }) {
  const document = assigneesRoot.ownerDocument
  const prefix = 'task-editor-' + (++editorSequence)
  let assignees = []
  let checklist = []
  let dependencyIds = new Set()
  let dependencyChoices = []

  function element(tag, className, text) {
    const result = document.createElement(tag)
    if (className) result.className = className
    if (text !== undefined) result.textContent = text
    return result
  }
  function button(label, handler, className = 'button button-small') {
    const result = element('button', className, label)
    result.type = 'button'
    result.addEventListener('click', handler)
    return result
  }
  function input(label, placeholder, maxLength) {
    const result = element('input', 'task-editor-input')
    result.type = 'text'
    result.setAttribute('aria-label', label)
    result.placeholder = placeholder
    result.maxLength = maxLength
    return result
  }
  function section(root, label) {
    root.classList.add('task-editor')
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', label)
    const list = element('ul', 'task-editor-list')
    const feedback = element('p', 'task-editor-feedback')
    feedback.setAttribute('role', 'status')
    feedback.setAttribute('aria-live', 'polite')
    feedback.hidden = true
    const counter = element('span', 'task-editor-counter')
    const meta = element('div', 'task-editor-meta')
    meta.append(counter)
    root.replaceChildren(list, meta, feedback)
    return { root, list, feedback, counter }
  }
  function report(target, message = '') {
    target.feedback.textContent = message
    target.feedback.hidden = !message
    return message
  }
  function emptyList(list, message) {
    list.replaceChildren(element('li', 'task-editor-empty', message))
  }
  function enterToAdd(field, add) {
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      add()
    })
  }
  const peopleField = section(assigneesRoot, 'Responsáveis pela demanda')
  const checklistField = section(checklistRoot, 'Checklist da demanda')
  const dependencyField = section(dependencyRoot, 'Dependências da demanda')
  const personInput = input('Adicionar responsável por nome ou e-mail', 'Nome ou e-mail do responsável', 380)
  personInput.autocomplete = 'off'
  personInput.setAttribute('list', prefix + '-people')
  const peopleSuggestions = element('datalist')
  peopleSuggestions.id = prefix + '-people'
  const personAdd = element('div', 'task-editor-add')
  personAdd.append(personInput, button('Adicionar', () => addPerson()))
  peopleField.root.insertBefore(personAdd, peopleField.counter.parentElement)
  peopleField.root.append(peopleSuggestions)
  const checklistInput = input('Adicionar item ao checklist', 'Adicionar uma etapa', 300)
  const checklistAdd = element('div', 'task-editor-add')
  checklistAdd.append(checklistInput, button('Adicionar', () => addChecklistItem()))
  checklistField.root.insertBefore(checklistAdd, checklistField.counter.parentElement)

  // A disclosure avoids a long multi-select and works equally with touch and keyboard.
  const dependenciesPicker = element('details', 'dependency-picker')
  const dependencySummary = element('summary', '', 'Selecionar demandas anteriores')
  dependenciesPicker.append(dependencySummary, dependencyField.list)
  dependencyField.root.insertBefore(dependenciesPicker, dependencyField.counter.parentElement)

  const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
  function parsePerson(raw) {
    const value = raw.trim()
    if (!value) return { error: 'Informe o nome ou e-mail do responsável.' }
    let name = ''
    let email = ''
    const complete = value.match(/^(.*?)\s*<([^<>]+)>$/)
    if (complete) {
      name = complete[1].trim()
      email = complete[2].trim().toLowerCase()
    } else if (value.includes('@')) {
      email = value.toLowerCase()
    } else {
      name = value
    }
    if (value.includes('<') || value.includes('>')) {
      if (!complete) return { error: 'Use um nome, um e-mail ou Nome <email@exemplo.com>.' }
    }
    if (email && (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254)) {
      return { error: 'Informe um e-mail válido, como nome@exemplo.com.' }
    }
    if (name.length > 120) return { error: 'O nome do responsável deve ter até 120 caracteres.' }
    return { person: { name, email } }
  }
  function samePerson(first, second) {
    if (first.email && second.email) return first.email.toLowerCase() === second.email.toLowerCase()
    return Boolean(first.name && second.name && normalizeName(first.name) === normalizeName(second.name))
  }
  // A mesma ordem da lista é mantida no payload do Firestore. O arraste
  // funciona no desktop; as setas garantem operação por toque e teclado.
  let dragged = null
  function moveEntry(items, from, to, refresh) {
    if (from < 0 || to < 0 || to >= items.length || from === to) return
    const [entry] = items.splice(from, 1)
    items.splice(to, 0, entry)
    refresh()
  }
  function orderControls(row, entry, items, refresh, label) {
    const grip = element('span', 'keep-list-grip', '⋮⋮')
    grip.title = 'Arraste para mudar a ordem'
    grip.setAttribute('aria-hidden', 'true')
    grip.draggable = true
    grip.addEventListener('dragstart', event => {
      dragged = { items, entry }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(items.indexOf(entry)))
      row.classList.add('is-dragging')
    })
    grip.addEventListener('dragend', () => {
      dragged = null
      row.classList.remove('is-dragging')
    })
    row.addEventListener('dragover', event => {
      if (!dragged || dragged.items !== items || dragged.entry === entry) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      row.classList.add('is-drag-target')
    })
    row.addEventListener('dragleave', () => row.classList.remove('is-drag-target'))
    row.addEventListener('drop', event => {
      row.classList.remove('is-drag-target')
      if (!dragged || dragged.items !== items) return
      event.preventDefault()
      const from = items.indexOf(dragged.entry)
      const to = items.indexOf(entry)
      dragged = null
      moveEntry(items, from, to, refresh)
    })
    const actions = element('span', 'keep-order-actions')
    for (const [shift, symbol, text] of [[-1, '↑', 'Mover para cima'], [1, '↓', 'Mover para baixo']]) {
      const position = items.indexOf(entry)
      const control = button(symbol, () => moveEntry(items, items.indexOf(entry), items.indexOf(entry) + shift, refresh), 'keep-order-arrow')
      control.setAttribute('aria-label', text + ': ' + label)
      control.disabled = position + shift < 0 || position + shift >= items.length
      actions.append(control)
    }
    return { grip, actions }
  }
  function personText(person) {
    return person.email ? (person.name ? person.name + ' <' + person.email + '>' : person.email) : person.name
  }
  function renderPeople() {
    peopleField.list.replaceChildren()
    if (!assignees.length) emptyList(peopleField.list, 'Adicione os responsáveis abaixo.')
    for (const [index, person] of assignees.entries()) {
      const label = person.name || person.email
      const row = element('li', 'keep-person-row')
      const { grip, actions } = orderControls(row, person, assignees, renderPeople, label)
      const avatar = element('span', 'assignee-chip-avatar', label.split(/\\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())
      avatar.setAttribute('aria-hidden', 'true')
      const field = input('Editar responsável ' + (index + 1), 'Nome ou e-mail', 380)
      field.className = 'keep-person-text'
      field.value = personText(person)
      const commit = () => {
        const raw = field.value.trim()
        const parsed = parsePerson(raw)
        if (parsed.error) {
          report(peopleField, parsed.error)
          field.value = personText(person)
          return false
        }
        if (assignees.some((other, position) => position !== index && samePerson(other, parsed.person))) {
          report(peopleField, 'Este responsável já está na lista.')
          field.value = personText(person)
          return false
        }
        const altered = personText(person) !== personText(parsed.person)
        if (altered) {
          assignees[index] = parsed.person
          const name = parsed.person.name || parsed.person.email
          avatar.textContent = name.split(/\\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
          onAssigneesChange(assignees.map(item => ({ ...item })))
        }
        report(peopleField)
        return true
      }
      field.addEventListener('change', commit)
      field.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return
        event.preventDefault()
        if (commit()) personInput.focus()
      })
      const remove = button('×', () => {
        assignees.splice(index, 1)
        renderPeople()
        report(peopleField)
        personInput.focus()
      }, 'assignee-chip-remove')
      remove.setAttribute('aria-label', 'Remover responsável ' + label)
      row.append(grip, avatar, field, actions, remove)
      peopleField.list.append(row)
    }
    peopleField.counter.textContent = assignees.length + ' de 10 responsáveis'
    onAssigneesChange(assignees.map(person => ({ ...person })))
  }
  function addPerson({ focus = true } = {}) {
    const parsed = parsePerson(personInput.value)
    if (parsed.error) return report(peopleField, parsed.error)
    if (assignees.some(person => samePerson(person, parsed.person))) {
      return report(peopleField, 'Esse responsável já foi adicionado.')
    }
    if (assignees.length >= 10) return report(peopleField, 'Use até 10 responsáveis por demanda.')
    assignees.push(parsed.person)
    personInput.value = ''
    report(peopleField)
    renderPeople()
    if (focus) personInput.focus()
    return ''
  }
  function updateChecklistCounter() {
    checklistField.counter.textContent = checklist.filter(item => item.done).length + ' concluídos · ' + checklist.length + ' de 20 itens'
  }
  function renderChecklist(focusId = '') {
    checklistField.list.replaceChildren()
    if (!checklist.length) emptyList(checklistField.list, 'Digite abaixo para criar o primeiro item.')
    for (const [index, item] of checklist.entries()) {
      const row = element('li', 'checklist-row keep-checklist-row' + (item.done ? ' is-done' : ''))
      const { grip, actions } = orderControls(row, item, checklist, renderChecklist, item.text || 'Item ' + (index + 1))
      const check = element('input')
      check.type = 'checkbox'
      check.checked = item.done
      const title = input('Texto do item ' + (index + 1), 'Escreva o item do checklist', 300)
      title.className = 'checklist-row-text'
      title.value = item.text
      title.dataset.keepItemId = item.id
      const checkboxLabel = () => check.setAttribute('aria-label', (item.done ? 'Reabrir ' : 'Concluir ') + (item.text || 'item ' + (index + 1)))
      checkboxLabel()
      check.addEventListener('change', () => {
        item.done = check.checked
        // Como no Keep, os itens concluídos descem, preservando a ordem relativa.
        checklist.sort((left, right) => Number(left.done) - Number(right.done))
        renderChecklist()
        report(checklistField)
      })
      title.addEventListener('input', () => {
        item.text = title.value
        checkboxLabel()
        report(checklistField)
      })
      title.addEventListener('keydown', event => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          if (!title.value.trim()) return
          if (checklist.length >= 20) return report(checklistField, 'Use até 20 itens no checklist.')
          const newItem = { id: globalThis.crypto.randomUUID(), text: '', done: false }
          checklist.splice(checklist.indexOf(item) + 1, 0, newItem)
          renderChecklist(newItem.id)
          report(checklistField)
        } else if (event.key === 'Backspace' && !title.value && checklist.length > 1) {
          event.preventDefault()
          const previous = checklist[index - 1]
          checklist.splice(index, 1)
          renderChecklist(previous?.id || '')
          if (!previous) checklistInput.focus()
        }
      })
      title.addEventListener('blur', () => {
        if (item.text.trim() || !checklist.includes(item)) return
        checklist.splice(checklist.indexOf(item), 1)
        renderChecklist()
      })
      const remove = button('×', () => {
        checklist.splice(checklist.indexOf(item), 1)
        renderChecklist()
        report(checklistField)
        checklistInput.focus()
      }, 'task-editor-remove')
      remove.setAttribute('aria-label', 'Remover item ' + (index + 1))
      row.append(grip, check, title, actions, remove)
      checklistField.list.append(row)
    }
    updateChecklistCounter()
    if (focusId) [...checklistField.list.querySelectorAll('.checklist-row-text')]
      .find(field => field.dataset.keepItemId === focusId)?.focus()
  }
  function addChecklistItem({ focus = true } = {}) {
    const text = checklistInput.value.trim()
    if (!text) return report(checklistField, 'Descreva o item do checklist.')
    if (text.length > 300) return report(checklistField, 'Cada item pode ter até 300 caracteres.')
    if (checklist.length >= 20) return report(checklistField, 'Use até 20 itens no checklist.')
    const newItem = { id: globalThis.crypto.randomUUID(), text, done: false }
    const firstFinished = checklist.findIndex(item => item.done)
    checklist.splice(firstFinished < 0 ? checklist.length : firstFinished, 0, newItem)
    checklistInput.value = ''
    report(checklistField)
    renderChecklist()
    if (focus) checklistInput.focus()
    return ''
  }
  function updateDependencyCounter() {
    dependencyField.counter.textContent = dependencyIds.size + ' de 20 dependências'
    dependencySummary.textContent = dependencyIds.size
      ? dependencyIds.size + (dependencyIds.size === 1 ? ' demanda anterior selecionada' : ' demandas anteriores selecionadas')
      : 'Selecionar demandas anteriores'
  }
  function renderDependencies() {
    dependencyField.list.replaceChildren()
    if (!dependencyChoices.length) {
      emptyList(dependencyField.list, 'Não há outras demandas neste plano.')
    }
    for (const dependency of dependencyChoices) {
      const row = element('li')
      const label = element('label', 'dependency-option')
      const check = element('input')
      check.type = 'checkbox'
      check.value = dependency.id
      check.checked = dependencyIds.has(dependency.id)
      check.addEventListener('change', () => {
        if (check.checked && dependencyIds.size >= 20) {
          check.checked = false
          report(dependencyField, 'Use até 20 dependências por demanda.')
          return
        }
        if (check.checked) dependencyIds.add(dependency.id)
        else dependencyIds.delete(dependency.id)
        report(dependencyField)
        updateDependencyCounter()
      })
      const title = dependency.title || 'Demanda indisponível'
      label.append(check, element('span', '', (dependency.deleted ? '[Excluída] ' : '') + title))
      row.append(label)
      dependencyField.list.append(row)
    }
    updateDependencyCounter()
  }
  enterToAdd(personInput, () => addPerson())
  enterToAdd(checklistInput, () => addChecklistItem())
  personInput.addEventListener('input', () => report(peopleField))
  checklistInput.addEventListener('input', () => report(checklistField))

  function setDependencies(dependencies = [], selectedIds = []) {
    dependencyIds = new Set(selectedIds)
    dependencyChoices = dependencies.filter(item => !item.deleted || dependencyIds.has(item.id)).map(item => ({ ...item }))
    // A deleted or missing reference is still visible, so editing another field never silently drops it.
    for (const id of dependencyIds) {
      if (!dependencyChoices.some(item => item.id === id)) dependencyChoices.push({ id, title: 'Demanda indisponível', deleted: true })
    }
    report(dependencyField)
    renderDependencies()
  }
  function setTask(task = {}, { people = [], dependencies = [] } = {}) {
    assignees = (task.assignees || []).map(person => ({ name: person.name || '', email: person.email || '' }))
    checklist = (task.checklist || []).map(item => ({ id: item.id, text: item.text || '', done: Boolean(item.done) }))
    setDependencies(dependencies, task.dependencyIds || [])
    const seen = new Set()
    peopleSuggestions.replaceChildren()
    for (const person of people) {
      const value = person.email ? (person.name ? person.name + ' <' + person.email + '>' : person.email) : person.name
      if (!value || seen.has(value.toLowerCase())) continue
      seen.add(value.toLowerCase())
      const option = element('option')
      option.value = value
      peopleSuggestions.append(option)
    }
    personInput.value = ''
    checklistInput.value = ''
    dependenciesPicker.open = false
    for (const field of [peopleField, checklistField, dependencyField]) report(field)
    renderPeople()
    renderChecklist()
  }
  function validate() {
    // Save also commits a typed draft; users need not click Add before Save.
    if (personInput.value.trim()) {
      const error = addPerson({ focus: false })
      if (error) { personInput.focus(); return error }
    }
    if (checklistInput.value.trim()) {
      const error = addChecklistItem({ focus: false })
      if (error) { checklistInput.focus(); return error }
    }
    if (assignees.length > 10) return report(peopleField, 'Use até 10 responsáveis por demanda.')
    if (checklist.length > 20) return report(checklistField, 'Use até 20 itens no checklist.')
    const blank = checklist.findIndex(item => !item.text.trim())
    if (blank >= 0) {
      checklistField.list.querySelectorAll('.checklist-row-text')[blank]?.focus()
      return report(checklistField, 'Descreva o item vazio do checklist ou remova-o.')
    }
    if (checklist.some(item => item.text.length > 300)) return report(checklistField, 'Cada item pode ter até 300 caracteres.')
    if (dependencyIds.size > 20) return report(dependencyField, 'Use até 20 dependências por demanda.')
    return ''
  }

  setTask()
  return {
    setTask,
    setDependencies,
    setAssignees: list => {
      assignees = list.map(person => ({ name:person.name || '', email:person.email || '' }))
      report(peopleField)
      renderPeople()
    },
    validate,
    getAssignees: () => assignees.map(person => ({ ...person })),
    getChecklist: () => checklist.map(item => ({ ...item, text: item.text.trim() })),
    getDependencyIds: () => [...dependencyIds]
  }
}
