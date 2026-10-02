import assert from 'node:assert/strict';
import {loadNatalTexts, natalMeanings} from '../backend/natal-texts.mjs';
import {natalChart} from '../backend/astro.mjs';
const names=['Меркурий','Венера','Марс','Юпитер','Сатурн','Хирон','Уран','Нептун'];
const signs=['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const rows=names.flatMap(name=>signs.map(sign=>[name,sign,`${name}: ${sign}\\n\\nВозможный ресурс\\n\\nОпора\\n\\nВозможные трудности\\n\\nТрудности`]));
const texts=loadNatalTexts(file=>file==='планеты-в-знаках.txt'?rows:[]);
assert.equal(Object.keys(texts.planetSign).length,96);
for(const birth of ['1989-02-01','2000-07-17','1975-11-22']){
  const chart=natalChart({birth,time:'12:00',tzOffsetMin:180,lat:55.75,lon:37.62});
  const readings=natalMeanings(chart,texts).planets.filter(p=>p.inSign);
  assert.equal(readings.length,8);
  for(const p of readings){
    const actual=chart.planets.find(x=>x.key===p.key);
    assert.equal(p.inSign.text,`${actual.name}: ${actual.sign}\n\nВозможный ресурс\n\nОпора\n\nВозможные трудности\n\nТрудности`);
    assert.equal(p.inSign.text.includes('\\n'),false);
  }
  for(const p of natalMeanings(chart,texts).planets.filter(p=>!names.includes(p.name))) assert.equal(p.inSign,null);
}
console.log('PASS: only 8 matching descriptions out of 96, paragraphs preserved, absent planets have no invented text');
