// Structured task fields. These editors keep the existing Firestore payload shape.
let editorSequence = 0

export function createTaskEditor({ assigneesRoot, checklistRoot, dependencyRoot }) {
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
  function renderPeople() {
    peopleField.list.replaceChildren()
    if (!assignees.length) emptyList(peopleField.list, 'Nenhum responsável definido.')
    for (const [index, person] of assignees.entries()) {
      const label = person.name || person.email
      const row = element('li', 'assignee-chip')
      const avatar = element('span', 'assignee-chip-avatar', (person.name || person.email).split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())
      avatar.setAttribute('aria-hidden', 'true')
      const info = element('span', 'assignee-chip-label', label)
      if (person.name && person.email) info.append(element('small', 'assignee-chip-info', person.email))
      const remove = button('×', () => {
        assignees.splice(index, 1)
        renderPeople()
        report(peopleField)
        personInput.focus()
      }, 'assignee-chip-remove')
      remove.setAttribute('aria-label', 'Remover responsável ' + label)
      row.append(avatar, info, remove)
      peopleField.list.append(row)
    }
    peopleField.counter.textContent = assignees.length + ' de 10 responsáveis'
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
  function renderChecklist() {
    checklistField.list.replaceChildren()
    if (!checklist.length) emptyList(checklistField.list, 'Divida a entrega em pequenas etapas.')
    for (const [index, item] of checklist.entries()) {
      const row = element('li', 'checklist-row' + (item.done ? ' is-done' : ''))
      const check = element('input')
      check.type = 'checkbox'
      check.checked = item.done
      const title = input('Texto do item ' + (index + 1), 'Descreva esta etapa', 300)
      title.className = 'checklist-row-text'
      title.value = item.text
      const updateCheckboxLabel = () => check.setAttribute('aria-label', 'Concluir ' + (item.text || 'item ' + (index + 1)))
      updateCheckboxLabel()
      check.addEventListener('change', () => {
        item.done = check.checked
        row.classList.toggle('is-done', item.done)
        updateChecklistCounter()
      })
      title.addEventListener('input', () => {
        item.text = title.value
        updateCheckboxLabel()
        report(checklistField)
      })
      title.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault()
          checklistInput.focus()
        }
      })
      const remove = button('×', () => {
        checklist.splice(index, 1)
        renderChecklist()
        report(checklistField)
        checklistInput.focus()
      }, 'task-editor-remove')
      remove.setAttribute('aria-label', 'Remover item ' + (index + 1))
      row.append(check, title, remove)
      checklistField.list.append(row)
    }
    updateChecklistCounter()
  }
  function updateChecklistCounter() {
    checklistField.counter.textContent = checklist.filter(item => item.done).length + ' concluídos · ' + checklist.length + ' de 20 itens'
  }
  function addChecklistItem({ focus = true } = {}) {
    const text = checklistInput.value.trim()
    if (!text) return report(checklistField, 'Descreva o item do checklist.')
    if (text.length > 300) return report(checklistField, 'Cada item pode ter até 300 caracteres.')
    if (checklist.length >= 20) return report(checklistField, 'Use até 20 itens no checklist.')
    checklist.push({ id: globalThis.crypto.randomUUID(), text, done: false })
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
    validate,
    getAssignees: () => assignees.map(person => ({ ...person })),
    getChecklist: () => checklist.map(item => ({ ...item, text: item.text.trim() })),
    getDependencyIds: () => [...dependencyIds]
  }
}
