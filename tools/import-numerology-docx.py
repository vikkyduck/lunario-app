#!/usr/bin/env python3
"""Import the supplied 99-card Word catalogue, preserving every card field verbatim."""
import hashlib
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

source, output = map(Path, sys.argv[1:3])
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile(source) as z:
    root = ET.fromstring(z.read('word/document.xml'))
lines = [''.join(t.text or '' for t in p.findall('.//w:t', ns)).strip()
         for p in root.findall('.//w:p', ns)]
keys = ['number_core', 'birth_day', 'birth_month', 'birth_year', 'destiny',
        'relationships', 'wellbeing', 'higher_purpose', 'name_number', 'expression', 'business']
sections, cards = {}, []
current = None
for i, line in enumerate(lines):
    h = re.fullmatch(r'(\d{2}) · (.+)', line)
    if h:
        current = keys[int(h[1]) - 1]
        if i + 2 < len(lines) and not re.match(r'^\d{2} · |^Числа ', lines[i + 1]):
            sections[current] = {'title': h[2], 'intro': lines[i + 1], 'source_refs': lines[i + 2]}
    c = re.fullmatch(r'([1-9]) · (.+)', line)
    if not c or not current:
        continue
    card = {'id': f'{current}.{c[1]}', 'section': current, 'value': int(c[1]), 'title': c[2]}
    for offset, (prefix, field) in enumerate([('Возможный ресурс. ', 'resource'),
                                            ('Возможная трудность. ', 'difficulty'),
                                            ('Ваша задача. ', 'task')], 1):
        text = lines[i + offset]
        assert text.startswith(prefix), (card['id'], field, text)
        card[field] = text[len(prefix):]
        assert len(card[field]) > 80
    card.update(source_refs=sections[current]['source_refs'],
                provenance='editorial_adaptation', status='supplied_for_integration')
    cards.append(card)
assert len(cards) == len({c['id'] for c in cards}) == 99
assert all({c['value'] for c in cards if c['section'] == s} == set(range(1, 10)) for s in keys)
catalog = {'contentVersion': 'lunario-numerology-2026-10-02-v1', 'namespace': 'base9',
           'sourceFile': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
           'notice': lines[lines.index('Предупреждение для пользователя') + 1],
           'sections': sections, 'cards': cards}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
print(f'PASS: {len(cards)} cards, 11 sections, all 297 text fields imported verbatim -> {output}')
