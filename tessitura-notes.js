/* Seletores circulares de notas — interface comum para música e cadastro. */
import { NOTE_LABELS, midiLabel } from './tessitura-core.js?v=20261117-v1';

const labelFor = (i) => NOTE_LABELS[i];
const accidental = new Set([1,3,6,8,10]);

export function createNotePicker({value = null, min = 24, max = 96, octave = true, onChange = () => {}, ariaLabel = 'Nota musical'} = {}) {
  const root = document.createElement('div');
  root.className = 'note-picker' + (octave ? '' : ' note-picker-key');
  let current = Number.isInteger(value) ? value : null;
  const clampOctave = (number) => Math.max(Math.floor(min / 12) - 1,
    Math.min(Math.floor(max / 12) - 1, number));
  let selectedOctave = clampOctave(current === null ? 4 : Math.floor(current / 12) - 1);
  const top = document.createElement('div');
  top.className = 'note-picker-top';
  const readout = document.createElement('span');
  readout.className = 'note-picker-readout';
  readout.setAttribute('aria-live', 'polite');
  const octaveSelect = document.createElement('select');
  octaveSelect.className = 'note-octave-select';
  octaveSelect.setAttribute('aria-label', 'Oitava de ' + ariaLabel);
  if (octave) {
    const first = Math.floor(min / 12) - 1, last = Math.floor(max / 12) - 1;
    for (let n = first; n <= last; n++) {
      const option = new Option('Oitava ' + n + (n === 4 ? ' · Dó central' : ''), String(n));
      octaveSelect.add(option);
    }
    octaveSelect.value = String(selectedOctave);
    top.append(octaveSelect);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'note-clear';
  clear.textContent = 'Limpar';
  clear.title = 'Remover nota selecionada';
  const grid = document.createElement('div');
  grid.className = 'note-picker-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', ariaLabel);
  const buttons = [];
  function currentMidi(index) { return (selectedOctave + 1) * 12 + index; }
  function refresh() {
    if (octave) octaveSelect.value = String(selectedOctave);
    readout.textContent = current === null ? (octave ? 'Sem nota' : 'Sem tom') :
      (octave ? midiLabel(current) : labelFor(current));
    for (const [i, button] of buttons.entries()) {
      const note = octave ? currentMidi(i) : i;
      const outOfRange = octave && (note < min || note > max);
      const selected = !outOfRange && current === note;
      button.disabled = outOfRange;
      button.classList.toggle('is-lit', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.title = octave ? midiLabel(note) : labelFor(i);
    }
    clear.disabled = current === null;
  }
  function choose(v) { current = v; refresh(); onChange(current); }
  for (let i = 0; i < 12; i++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-circle' + (accidental.has(i) ? ' is-accidental' : '');
    button.textContent = labelFor(i);
    button.setAttribute('aria-label', labelFor(i) + (octave ? ' — ' + ariaLabel : ' — tom original'));
    button.addEventListener('click', () => {
      const next = octave ? currentMidi(i) : i;
      choose(next === current ? null : next);
    });
    grid.append(button); buttons.push(button);
  }
  if (octave) {
    octaveSelect.addEventListener('change', () => {
      selectedOctave = Number(octaveSelect.value);
      if (current !== null) {
        const pitch = current % 12;
        const candidate = currentMidi(pitch);
        choose(candidate >= min && candidate <= max ? candidate : null);
      } else refresh();
    });
  }
  clear.addEventListener('click', () => choose(null));
  top.append(readout,clear);
  root.append(top,grid);
  refresh();
  return {
    element:root, getValue:() => current,
    setValue(next) {
      current = Number.isInteger(next) ? next : null;
      if (octave && current !== null) selectedOctave = clampOctave(Math.floor(current/12)-1);
      refresh();
    }
  };
}
