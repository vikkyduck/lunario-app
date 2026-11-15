"""Private CPU embedding/search service. Chroma stores vectors and opaque IDs only.
Run Chroma separately; one serialized writer and durable purge tombstones prevent resurrection.
"""
import hashlib
import os
import sqlite3
import threading
from contextlib import asynccontextmanager
from pathlib import Path

os.environ.setdefault('ANONYMIZED_TELEMETRY', 'False')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
import chromadb
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL = os.environ.get('RAG_MODEL', 'intfloat/multilingual-e5-small')
ROOT = Path(os.environ.get('RAG_DATA_DIR', './data/rag'))
LOCK = threading.RLock()
TOKEN = os.environ.get('RAG_SERVICE_TOKEN', '')
if not TOKEN or len(TOKEN) < 32:
    raise RuntimeError('RAG_SERVICE_TOKEN must contain at least 32 characters')
model = collection = meta = None

@asynccontextmanager
async def lifespan(app):
    global model, collection, meta
    ROOT.mkdir(parents=True, exist_ok=True)
    import torch
    torch.set_num_threads(int(os.environ.get('RAG_CPU_THREADS', '2')))
    model = SentenceTransformer(MODEL, device='cpu')
    client = chromadb.HttpClient(host=os.environ.get('CHROMA_HOST', '127.0.0.1'), port=int(os.environ.get('CHROMA_PORT', '5033')))
    name = 'lunario-' + hashlib.sha256(MODEL.encode()).hexdigest()[:16]
    collection = client.get_or_create_collection(name, metadata={'hnsw:space': 'cosine'}, embedding_function=None)
    meta = sqlite3.connect(ROOT / 'purges.sqlite', check_same_thread=False)
    meta.execute('CREATE TABLE IF NOT EXISTS purged (namespace TEXT PRIMARY KEY)')
    meta.commit()
    yield
    meta.close()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

def authorize(authorization):
    import hmac
    if not hmac.compare_digest(authorization or '', 'Bearer ' + TOKEN):
        raise HTTPException(401)

class Item(BaseModel):
    id: str = Field(pattern=r'^[a-f0-9]{64}$')
    text: str = Field(min_length=1, max_length=1400)

class Index(BaseModel):
    namespace: str = Field(pattern=r'^[a-f0-9-]{36}$')
    items: list[Item] = Field(max_length=100000)

class Search(BaseModel):
    namespace: str = Field(pattern=r'^[a-f0-9-]{36}$')
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=16, ge=1, le=30)

class Purge(BaseModel):
    namespace: str = Field(pattern=r'^[a-f0-9-]{36}$')

def alive(namespace):
    if meta.execute('SELECT 1 FROM purged WHERE namespace=?', (namespace,)).fetchone():
        raise HTTPException(410)

@app.get('/health')
def health(authorization: str | None = Header(default=None)):
    authorize(authorization)
    return {'ok': model is not None, 'model': MODEL}

@app.post('/index')
def index(body: Index, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with LOCK:
        alive(body.namespace)
        old = set(collection.get(where={'owner': body.namespace}, include=[])['ids'])
        wanted = {x.id for x in body.items}
        new = [x for x in body.items if x.id not in old]
        for start in range(0, len(new), 32):
            batch = new[start:start + 32]
            vectors = model.encode(['passage: ' + x.text for x in batch], normalize_embeddings=True, show_progress_bar=False).tolist()
            collection.upsert(ids=[x.id for x in batch], embeddings=vectors, metadatas=[{'owner': body.namespace} for _ in batch])
        obsolete = list(old - wanted)
        for start in range(0, len(obsolete), 1000):
            collection.delete(ids=obsolete[start:start + 1000])
        return {'ok': True, 'count': len(wanted), 'embedded': len(new)}

@app.post('/search')
def search(body: Search, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with LOCK:
        alive(body.namespace)
        vector = model.encode(['query: ' + body.query], normalize_embeddings=True, show_progress_bar=False).tolist()
        result = collection.query(query_embeddings=vector, n_results=body.top_k, where={'owner': body.namespace}, include=['distances'])
        return {'items': [{'id': i, 'score': 1 - d} for i, d in zip(result['ids'][0], result['distances'][0])]}

@app.post('/purge')
def purge(body: Purge, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with LOCK:
        meta.execute('INSERT OR IGNORE INTO purged VALUES (?)', (body.namespace,))
        meta.commit()  # tombstone before deletion; a retry always finishes the purge
        collection.delete(where={'owner': body.namespace})
        return {'ok': True}
