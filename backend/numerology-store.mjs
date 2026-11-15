import { readFileSync } from 'node:fs';
import { calculateBirthNumbers, calculateNames, calculateBusinessName, normalizeText, NumerologyError, PROFILES, METHOD_VERSION } from './numerology.mjs';

export const CATALOG = JSON.parse(readFileSync(new URL('./data/numerology-v1.json', import.meta.url), 'utf8'));
export function seedNumerology(db) {
  if (CATALOG.cards.length !== 99 || new Set(CATALOG.cards.map(c => c.id)).size !== 99) throw new Error('Invalid numerology catalogue');
  const insert = db.prepare(`INSERT INTO numerology_texts (content_version, namespace, section, number, payload) VALUES (?,?,?,?,?)`);
  for (const c of CATALOG.cards) {
    if (![c.title, c.resource, c.difficulty, c.task].every(t => typeof t === 'string' && t.trim()) || c.value < 1 || c.value > 9) throw new Error('Incomplete numerology card');
    insert.run(CATALOG.contentVersion, CATALOG.namespace, c.section, c.value, JSON.stringify(c));
  }
}
const FIELDS = ['firstName', 'lastName', 'patronymic', 'everydayName', 'businessName'];
export function numerologyInputs(user, open) {
  return { profile: PROFILES[0], ...Object.fromEntries(FIELDS.map(k => [k, ''])), ...JSON.parse(open(user.numerology_data || '') || '{}') };
}
export function createNumerology({ db, open, seal, mutate }) {
  const lookup = db.prepare('SELECT payload FROM numerology_texts WHERE content_version=? AND namespace=? AND section=? AND number=?');
  function reading(id, label, section, calculation, namespace = 'base9') {
    if (!calculation) return null;
    const value = calculation.value;
    const row = namespace === 'base9' ? lookup.get(CATALOG.contentVersion, namespace, section, value) : null;
    const c = row ? JSON.parse(row.payload) : null;
    // Only the matched user-facing fields leave the server. No complete dictionary endpoint.
    return { id, label, section, namespace, value, calculation,
      interpretationStatus: c ? 'available' : 'source_missing',
      content: c ? { id: c.id, title: c.title, resource: c.resource, difficulty: c.difficulty, task: c.task } : null,
      message: c ? '' : namespace === 'star22' ? 'Для этого расчета используется система 1–22. Описания ее значений пока не добавлены. Здесь доступна последовательность расчета.'
        : section === 'expression' && [11, 22].includes(value) ? `Ваше число экспрессии – ${value}. В книге для него предусмотрено отдельное правило расчета, но индивидуальное описание не приведено. Здесь пока доступен только расчет.`
        : 'Описание этого значения пока не добавлено.' };
  }
  function result(user, day, inputs = numerologyInputs(user, open)) {
    let birth = null, birthError = null;
    try { birth = calculateBirthNumbers(user.birth, day, inputs.profile); }
    catch (e) { if (!(e instanceof NumerologyError)) throw e; birthError = user.birth ? e.code : 'NO_BIRTH'; }
    const names = calculateNames(inputs), birthReadings = [], nameReadings = [];
    if (birth) {
      birthReadings.push(reading('destiny', 'Число судьбы', 'destiny', birth.core9.destiny));
      birthReadings.push(reading('number_core', 'Общий образ числа', 'number_core', birth.core9.destiny));
      const labels = [['A', 'Саморазвитие', 'birth_day'], ['B', 'Духовность', 'birth_month'], ['C', 'Деньги и карьера', 'birth_year'],
        ['D', 'Отношения', 'relationships'], ['E', 'Забота о себе', 'wellbeing'], ['F', 'Высшее предназначение', 'higher_purpose']];
      for (const [k, label, section] of labels) birthReadings.push(reading(k, label, section, birth.star[k], birth.interpretationNamespace));
    }
    for (const [k, label] of [['firstName', 'Официальное имя'], ['lastName', 'Фамилия'], ['patronymic', 'Отчество'], ['everydayName', 'Повседневное имя']]) {
      if (names.components[k]) nameReadings.push(reading(k, label, 'name_number', names.components[k]));
    }
    if (names.expression) nameReadings.push(reading('expression', 'Число экспрессии', 'expression', names.expression));
    let business = null, businessError = null;
    if (inputs.businessName.trim()) {
      try { business = reading('business', 'Название бизнеса', 'business', calculateBusinessName(inputs.businessName)); }
      catch (e) { if (!(e instanceof NumerologyError)) throw e; businessError = e.code; }
    }
    return { methodVersion: METHOD_VERSION, contentVersion: CATALOG.contentVersion, profile: inputs.profile, notice: CATALOG.notice,
      inputs, birth, birthError, birthReadings, nameReadings, nameErrors: names.errors, expressionStatus: names.status, business, businessError };
  }
  function save(user, body, day) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new NumerologyError('INVALID_INPUT');
    const inputs = numerologyInputs(user, open);
    for (const k of FIELDS) if (Object.hasOwn(body, k)) {
      try { inputs[k] = normalizeText(body[k]); }
      catch (e) { if (!(e instanceof NumerologyError)) throw e; e.field = k; throw e; }
    }
    if (Object.hasOwn(body, 'profile')) {
      if (!PROFILES.includes(body.profile)) throw new NumerologyError('PROFILE_REQUIRED');
      inputs.profile = body.profile;
    }
    const computed = result(user, day, inputs), errors = { ...computed.nameErrors };
    if (computed.businessError) errors.businessName = computed.businessError;
    if (Object.keys(errors).length) return { ok: false, error: 'INVALID_INPUT', errors, result: computed };
    mutate(user.id, () => {
      db.prepare('UPDATE users SET numerology_data=? WHERE id=?').run(seal(JSON.stringify(inputs)), user.id);
      return { ok: true };
    });
    return { ok: true, ...computed };
  }
  return { result, save };
}
