"""Real embedding/index smoke test. Synthetic namespaces are purged on completion."""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid

URL = os.environ.get('RAG_URL', 'http://127.0.0.1:5052')
TOKEN = os.environ.get('RAG_SERVICE_TOKEN', 'local-synthetic-test-token-000000000000')

def call(path, body=None, token=TOKEN):
    request = urllib.request.Request(URL + path, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)

def item(owner, text):
    return {'id': hashlib.sha256((owner + text).encode()).hexdigest(), 'text': text}

a, b = str(uuid.uuid4()), str(uuid.uuid4())
try:
    try:
        call('/health', token='wrong')
        raise AssertionError('unauthorized access allowed')
    except urllib.error.HTTPError as error:
        assert error.code == 401
    texts = [
        'Дневник 2024-02-01. После тяжелого дня мне помогает прогулка у реки. Когда тревожно, я иду гулять.',
        'Дневник 2026-10-01. Люблю завтракать овсяной кашей и пить зеленый чай.',
        'Натальная карта. Солнце в Водолее. Астрологическая интерпретация — символическая, не факт о поведении.',
    ]
    items = [item(a, t) for t in texts]
    foreign = item(b, 'Я справляюсь с тревогой, звоня своему брату Борису. Секрет другого пользователя.')
    started = time.monotonic()
    assert call('/index', {'namespace': a, 'items': items})['embedded'] == 3
    assert call('/index', {'namespace': b, 'items': [foreign]})['embedded'] == 1
    assert call('/index', {'namespace': a, 'items': items})['embedded'] == 0
    result = call('/search', {'namespace': a, 'query': 'Что помогает мне успокоиться после трудного дня?', 'top_k': 3})
    assert result['items'][0]['id'] == items[0]['id'], result
    assert all(x['id'] != foreign['id'] for x in result['items'])
    print('PASS semantic retrieval and tenant filter; scores:', [round(x['score'], 3) for x in result['items']])
    updated = item(a, 'Дневник. Теперь я предпочитаю плавание в бассейне, оно помогает успокоиться.')
    assert call('/index', {'namespace': a, 'items': [updated]})['count'] == 1
    result = call('/search', {'namespace': a, 'query': 'Прогулка у реки', 'top_k': 3})
    assert all(x['id'] != items[0]['id'] for x in result['items'])
    call('/purge', {'namespace': a})
    try:
        call('/index', {'namespace': a, 'items': items})
        raise AssertionError('deleted namespace resurrected')
    except urllib.error.HTTPError as error:
        assert error.code == 410
    print('PASS incremental updates, deletion and permanent tombstone; seconds:', round(time.monotonic() - started, 2))
finally:
    call('/purge', {'namespace': a})
    call('/purge', {'namespace': b})
