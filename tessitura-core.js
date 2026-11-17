// Tessitura IPCVT — teoria musical em semitons (MIDI; Dó4 = 60).
export const NOTE_LABELS = ['Dó','Dó♯','Ré','Mi♭','Mi','Fá','Fá♯','Sol','Lá♭','Lá','Si♭','Si'];
export const KEY_LABELS = ['Dó (C)','Ré♭ (Db)','Ré (D)','Mi♭ (Eb)','Mi (E)','Fá (F)','Sol♭ (Gb)','Sol (G)','Lá♭ (Ab)','Lá (A)','Si♭ (Bb)','Si (B)'];
export const VOICE_TYPES = ['Soprano','Mezzo-soprano','Contralto','Tenor','Barítono','Baixo','Não classificado'];
export const midiLabel = value => Number.isInteger(value) ? NOTE_LABELS[((value % 12) + 12) % 12] + (Math.floor(value / 12) - 1) : '—';
export const hasRange = p => Number.isInteger(p.grave) && Number.isInteger(p.aguda) && p.grave <= p.aguda;
export const comfortRange = p => Number.isInteger(p.confortoGrave) && Number.isInteger(p.confortoAguda)
  ? [p.confortoGrave, p.confortoAguda] : [p.grave, p.aguda];
export const normalizePerson = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');

function singerFit(person, low, high) {
  const [cLow, cHigh] = comfortRange(person);
  let best = null;
  // Uma mesma melodia pode ser cantada uma ou duas oitavas acima/abaixo,
  // preservando a tonalidade. Isto NÃO substitui a análise de harmonizações.
  for (const octave of [-24, -12, 0, 12, 24]) {
    const from = low + octave, to = high + octave;
    const excessComfort = Math.max(0, cLow - from) + Math.max(0, to - cHigh);
    const excessTotal = Math.max(0, person.grave - from) + Math.max(0, to - person.aguda);
    const fitsComfort = excessComfort === 0;
    const fitsTotal = excessTotal === 0;
    const center = (from + to) / 2;
    const centerComfort = (cLow + cHigh) / 2;
    const centerPenalty = Math.abs(center - centerComfort) * .12;
    const penalty = excessTotal * 90 + excessComfort * 15 + centerPenalty + Math.abs(octave) * .035;
    if (!best || penalty < best.penalty) best = {
      octave, penalty, fitsComfort, fitsTotal,
      status: fitsComfort ? 'confortavel' : fitsTotal ? 'limite' : 'fora'
    };
  }
  return { id: person.id, nome: person.nome, classificacao: person.classificacao, ...best };
}

export function calculateTones(people, lowest, highest, originalKey = null) {
  const low = Number(lowest), high = Number(highest);
  if (!Number.isInteger(low) || !Number.isInteger(high) || low >= high) {
    throw new Error('Informe duas notas válidas; a mais grave deve ser inferior à mais aguda.');
  }
  const singers = people.filter(p => p.ativo !== false && hasRange(p));
  if (!singers.length) throw new Error('Cadastre o alcance de pelo menos um cantor ativo para calcular.');
  const results = [];
  for (let shift = -6; shift <= 6; shift++) {
    const evaluations = singers.map(p => singerFit(p, low + shift, high + shift));
    const comfortable = evaluations.filter(e => e.fitsComfort).length;
    const reachable = evaluations.filter(e => e.fitsTotal).length;
    const penalty = evaluations.reduce((sum, e) => sum + e.penalty, 0);
    // Prioridade: notas confortáveis para mais integrantes, depois alcance,
    // depois centralidade e, por fim, menor distância do tom original.
    const score = comfortable * 100000 + reachable * 10000 - penalty * 10 - Math.abs(shift) * 10;
    results.push({ shift, comfortable, reachable, total: singers.length, penalty, score, evaluations,
      key: Number.isInteger(originalKey) ? (originalKey + shift + 120) % 12 : null });
  }
  results.sort((a, b) => b.score - a.score || Math.abs(a.shift) - Math.abs(b.shift) || a.shift - b.shift);
  return { best: results[0], alternatives: results.slice(1, 4), all: results,
    incomplete: people.filter(p => p.ativo !== false && !hasRange(p)).length };
}


// Sugestão orientativa de naipe (não é diagnóstico vocal).
// Perfis de referência aproximados para canto coral, em notas MIDI.
// Tessituras se sobrepõem; timbre, passaggi e resistência são decisivos.
export const VOCAL_REFERENCE = Object.freeze([
  { type: 'Soprano', low: 60, high: 81, family: 'aguda' },
  { type: 'Mezzo-soprano', low: 57, high: 77, family: 'aguda' },
  { type: 'Contralto', low: 53, high: 72, family: 'aguda' },
  { type: 'Tenor', low: 48, high: 69, family: 'grave' },
  { type: 'Barítono', low: 43, high: 64, family: 'grave' },
  { type: 'Baixo', low: 40, high: 60, family: 'grave' }
]);
export function suggestVoiceSection(person) {
  const low = person?.confortoGrave, high = person?.confortoAguda;
  if (!Number.isInteger(low) || !Number.isInteger(high) || low >= high) return null;
  const current = VOCAL_REFERENCE.find(p => p.type === person.classificacao);
  const candidates = VOCAL_REFERENCE.filter(p => !current || p.family === current.family)
    .map(p => ({
      type: p.type,
      score: Math.abs(low - p.low) * .85 +
        Math.abs(high - p.high) * .85 +
        Math.abs((low + high) / 2 - (p.low + p.high) / 2) * .6
    }))
    .sort((a,b) => a.score - b.score);
  const first = candidates[0], second = candidates[1];
  if (!first) return null;
  const gap = second ? second.score - first.score : 999;
  return {
    type: first.type,
    alternate: second?.type || null,
    lowConfidence: gap < 3.5,
    basis: 'tessitura confortável',
    // Diferença expressiva de centro ou limites reduz a confiabilidade.
    outOfReference: first.score > 16
  };
}
