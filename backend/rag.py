import os, re, uuid
from pypdf import PdfReader
from docx import Document as Docx
from fastembed import TextEmbedding
from qdrant_client import QdrantClient, models as M

COLL = "hr_chunks"
_emb = TextEmbedding("BAAI/bge-small-en-v1.5")  # local embeddings, no API key needed
qd = QdrantClient(url=os.getenv("QDRANT_URL")) if os.getenv("QDRANT_URL") else QdrantClient(path="./qdrant_data")
if not qd.collection_exists(COLL):
    qd.create_collection(COLL, vectors_config=M.VectorParams(size=384, distance=M.Distance.COSINE))
    for f in ("organization_id", "document_id"):
        qd.create_payload_index(COLL, f, M.PayloadSchemaType.KEYWORD)

def embed(texts): return [v.tolist() for v in _emb.embed(texts)]

def extract(path):
    ext = path.rsplit(".", 1)[-1].lower()
    if ext == "pdf": return [(i + 1, p.extract_text() or "") for i, p in enumerate(PdfReader(path).pages)]
    if ext == "docx": return [(1, "\n".join(p.text for p in Docx(path).paragraphs))]
    return [(1, open(path, encoding="utf-8", errors="ignore").read())]

HEAD = re.compile(r"^(\d+(\.\d+)*[.)]?\s+\S.*|[A-Z][A-Z0-9 \-&]{4,})$")

def chunk(pages, size=900, overlap=150):
    out, sec = [], "General"
    for pg, txt in pages:
        buf = ""
        for line in re.sub(r"[ \t]+", " ", txt).split("\n"):
            line = line.strip()
            if not line: continue
            if HEAD.match(line) and len(line) < 90:  # section boundary
                if buf.strip(): out.append((pg, sec, buf.strip()))
                buf, sec = "", line
                continue
            buf += line + " "
            if len(buf) > size:
                out.append((pg, sec, buf.strip())); buf = buf[-overlap:]
        if len(buf.strip()) > overlap: out.append((pg, sec, buf.strip()))
    return out

def index(org, doc_id, name, version, pages):
    ch = chunk(pages)
    if not ch: return 0
    vecs = embed([c[2] for c in ch])
    qd.upsert(COLL, [M.PointStruct(id=str(uuid.uuid4()), vector=v, payload=dict(
        organization_id=org, document_id=doc_id, document_name=name, version=version,
        page=pg, section=sec, text=t, active=True)) for v, (pg, sec, t) in zip(vecs, ch)])
    return len(ch)

def _doc(doc_id): return M.Filter(must=[M.FieldCondition(key="document_id", match=M.MatchValue(value=doc_id))])
def set_active(doc_id, on): qd.set_payload(COLL, {"active": on}, points=_doc(doc_id))
def delete_doc(doc_id): qd.delete(COLL, M.FilterSelector(filter=_doc(doc_id)))

def search(org, query, k=5):
    f = M.Filter(must=[M.FieldCondition(key="organization_id", match=M.MatchValue(value=org)),  # tenant isolation
                       M.FieldCondition(key="active", match=M.MatchValue(value=True))])
    r = qd.query_points(COLL, query=embed([query])[0], query_filter=f, limit=k).points
    return [(p.score, p.payload) for p in r]
