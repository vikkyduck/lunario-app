/* Правило владелицы: в приложении нет буквы «ё» — ни в разметке, ни в скриптах, ни в текстах сервера.
   Файлы контента могут содержать «ё» (их не трогаем) — на чтении заменяет content.mjs (noYo). Запускается из deploy.sh. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dirs = [['site', /\.(html|js|webmanifest)$/], ['backend', /\.mjs$/], ['backend/http', /\.mjs$/]];
const bad = [];
for (const [dir, re] of dirs) for (const f of readdirSync(dir)) {
  if (!re.test(f)) continue;
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  lines.forEach((l, i) => { if (/[ёЁ]/.test(l)) bad.push(`${dir}/${f}:${i + 1}`); });
}
if (bad.length) { console.error('❌ Буква «ё» в приложении:\n' + bad.slice(0, 20).join('\n') + (bad.length > 20 ? `\n… и еще ${bad.length - 20}` : '')); process.exit(1); }
console.log('PASS: буквы «ё» в приложении нет');
