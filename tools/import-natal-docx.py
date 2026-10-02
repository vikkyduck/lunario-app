"""Extract the approved 8 x 12 planet/sign descriptions into the editable content table.
Usage: python import-natal-docx.py source.docx destination.txt
Requires python-docx (available in the bundled document runtime).
"""
import hashlib
import sys
from pathlib import Path
from docx import Document

PLANETS = ['Меркурий', 'Венера', 'Марс', 'Юпитер', 'Сатурн', 'Хирон', 'Уран', 'Нептун']
SIGNS = dict(zip(['Овне', 'Тельце', 'Близнецах', 'Раке', 'Льве', 'Деве', 'Весах', 'Скорпионе', 'Стрельце', 'Козероге', 'Водолее', 'Рыбах'], ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы']))

def extract(path):
    entries = []
    current = None
    for paragraph in Document(path).paragraphs:
        text = paragraph.text.strip()
        style = paragraph.style.name
        if style == 'Heading 1':
            current = None
        elif style == 'Heading 2':
            planet, separator, sign = text.replace(' во ', ' в ').partition(' в ')
            if not separator or planet not in PLANETS or sign not in SIGNS:
                raise ValueError(f'Unknown placement: {text}')
            current = {'planet': planet, 'sign': SIGNS[sign], 'paragraphs': []}
            entries.append(current)
        elif current is not None and text:
            if style not in ['Normal', 'Card Label']:
                raise ValueError(f'Unexpected style in description: {style}')
            if '|' in text or '\\' in text:
                raise ValueError('Unescaped content table delimiter')
            current['paragraphs'].append(text)
    expected = {(planet, sign) for planet in PLANETS for sign in SIGNS.values()}
    keys = [(e['planet'], e['sign']) for e in entries]
    if len(keys) != 96 or set(keys) != expected:
        raise ValueError('Expected exactly 96 distinct planet/sign descriptions')
    for entry in entries:
        for label in ['Возможный ресурс', 'Возможные трудности']:
            if entry['paragraphs'].count(label) != 1:
                raise ValueError(f'Missing or duplicate section: {entry["planet"]} / {entry["sign"]}')
    return entries

if __name__ == '__main__':
    source, target = map(Path, sys.argv[1:3])
    entries = extract(source)
    lines = ['# Планеты в знаках — редакция из ' + source.name,
             '# SHA-256 исходного документа: ' + hashlib.sha256(source.read_bytes()).hexdigest(),
             '# Формат: планета | знак | текст. \\n\\n разделяет абзацы.',
             '# Только персональные описания сочетаний; общие вступления и редакторские примечания не импортируются.']
    for entry in entries:
        body = '\\n\\n'.join(entry['paragraphs']).replace('ё', 'е').replace('Ё', 'Е')
        lines.append(f'{entry["planet"]} | {entry["sign"]} | {body}')
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Imported {len(entries)} descriptions; all planet/sign pairs and section labels verified')
