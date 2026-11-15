/* Pure arithmetic from the supplied specification, versioned separately from the texts. */
export const METHOD_VERSION = 'lunario-numerology-v1';
export const PROFILES = ['base9-v1-proposed', 'star22-v1-proposed'];
export class NumerologyError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new NumerologyError(code); };
export const digits = n => Array.from(String(n), Number);
export const sum = xs => xs.reduce((a, b) => a + b, 0);
export function reduceNumber(input, kind = 'base9') {
  if (!Number.isSafeInteger(input) || input <= 0 || !['base9', 'range22', 'expression'].includes(kind)) fail('INVALID_NUMBER');
  const steps = [input]; let value = input;
  const done = n => kind === 'range22' ? n <= 22 : n <= 9 || (kind === 'expression' && (n === 11 || n === 22));
  while (!done(value)) { value = sum(digits(value)); steps.push(value); }
  return { kind, input, steps, value };
}
const node = (inputs, kind = 'base9') => {
  const total = sum(inputs), reduction = reduceNumber(total, kind);
  return { inputs, sum: total, reduction, value: reduction.value };
};
export function parseBirthDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('INVALID_DATE_FORMAT');
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) fail('INVALID_DATE');
  return { year, month, day };
}
export function calculateBirthNumbers(birthDate, asOfDate, profile) {
  if (!PROFILES.includes(profile)) fail('PROFILE_REQUIRED');
  const { year, month, day } = parseBirthDate(birthDate); parseBirthDate(asOfDate);
  if (birthDate > asOfDate) fail('FUTURE_BIRTH_DATE');
  const yearDigits = digits(year), allDigits = [...digits(day), ...digits(month), ...yearDigits];
  const core9 = { day: node([day]), month: node([month]), year: node(yearDigits), destiny: node(allDigits) };
  const kind = profile === PROFILES[0] ? 'base9' : 'range22';
  const star = { A: node([day], kind), B: node([month], kind), C: node(yearDigits, kind) };
  star.D = node([star.A.value, star.B.value, star.C.value], kind);
  star.E = node([star.A.value, star.B.value, star.C.value, star.D.value], kind);
  star.F = node([star.A.value, star.B.value, star.C.value, star.D.value, star.E.value], kind);
  return { methodVersion: METHOD_VERSION, profile, policyStatus: 'specified_by_supplied_brief',
    interpretationNamespace: kind === 'base9' ? 'base9' : 'star22',
    interpretationStatus: kind === 'base9' ? 'available' : 'source_missing',
    birthDate, yearDigitSum: sum(yearDigits), fullDateDigitSum: sum(allDigits), core9, star };
}
const RU = ['АИСЪ', 'БЙТЫ', 'ВКУЬ', 'ГЛФЭ', 'ДМХЮ', 'ЕНЦЯ', '\u0401ОЧ', 'ЖПШ', 'ЗРЩ'];
const LAT = ['AJS', 'BKT', 'CLU', 'DMV', 'ENW', 'FOX', 'GPY', 'HQZ', 'IR'];
export const LETTERS = Object.fromEntries([RU, LAT].flatMap(groups => groups.flatMap((letters, i) => [...letters].map(c => [c, i + 1]))));
const SEPARATORS = /^[ \-\u2010\u2011'\u2019\u02bc]$/u;
export function normalizeText(text) {
  if (typeof text !== 'string') fail('UNSUPPORTED_CHARACTER');
  if ([...text].length > 200) fail('TEXT_TOO_LONG');
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}
export function calculateName(text) {
  const normalized = normalizeText(text), letters = [];
  let alphabet = null;
  for (const original of normalized) {
    if (SEPARATORS.test(original)) continue;
    const c = original.toUpperCase();
    if (original !== c && original !== c.toLowerCase()) fail('UNSUPPORTED_CHARACTER');
    if (!Object.hasOwn(LETTERS, c)) fail('UNSUPPORTED_CHARACTER');
    const script = /^[A-Z]$/.test(c) ? 'latin' : 'cyrillic';
    if (alphabet && alphabet !== script) fail('MIXED_ALPHABETS');
    alphabet = script; letters.push({ letter: c, value: LETTERS[c] });
  }
  if (!letters.length) fail('EMPTY_NAME');
  return { normalized, alphabet, letters, ...node(letters.map(l => l.value)) };
}
export const calculateBusinessName = calculateName;
export function calculateNames(input) {
  const components = {}, errors = {};
  for (const key of ['firstName', 'lastName', 'patronymic', 'everydayName']) {
    const text = input[key] ?? '';
    if (typeof text === 'string' && !text.trim()) { components[key] = null; continue; }
    try { components[key] = calculateName(text); }
    catch (e) { if (!(e instanceof NumerologyError)) throw e; errors[key] = e.code; components[key] = null; }
  }
  const official = ['firstName', 'lastName', 'patronymic'];
  const scripts = new Set(official.map(k => components[k]?.alphabet).filter(Boolean));
  let expression = null, status = 'available';
  if (official.some(k => errors[k])) status = 'invalid_input';
  else if (scripts.size > 1) { status = 'invalid_input'; errors.expression = 'MIXED_ALPHABETS'; }
  else if (!components.firstName || !components.lastName) status = 'insufficient_input';
  else expression = node(official.map(k => components[k]?.value).filter(Boolean), 'expression');
  return { components, errors, expression, status };
}
