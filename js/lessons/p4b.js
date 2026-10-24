/* Phase 4 · Retrieval and RAG (part 2: 4.5–4.8). Uses AISA.PY4 snippets defined in p4.js. */
(function () {
const L = AISA.lesson;
const { CORPUS, EMB, BM25 } = AISA.PY4;
const FAKE_NOTE = '<p class="callout"><b>Runs without a key</b> The SDK is real; only the network is replaced by a local fake of the Messages API, so you can see what is sent and received. Delete the fake and set <code class="i">ANTHROPIC_API_KEY</code> to call the real service.</p>';

/* ===================================================================== 4.5 */
L({
  id: '4.5', title: 'Hybrid BM25 + vector', minutes: 50, roles: ['be', 'fde'], sim: 'fusion',
  tags: 'BM25 · inverted index · Postgres full-text · reciprocal rank fusion · weighted fusion · recall@k · MRR',
  mental: 'Keyword search and vector search fail in opposite ways: keywords miss paraphrases, vectors miss exact identifiers. Run both and fuse the rankings. Reciprocal rank fusion is the robust default because it needs no score calibration.',
  intro: `<p>Customers search for error codes, SKUs, contract numbers, people’s names and acronyms, and they also ask vague questions in their own words. No single retrieval method handles both. Hybrid search, BM25 plus vectors, is the production default in 2026 for exactly this reason, and nearly every vector database and search engine now supports it natively.</p>
  <p>This lesson measures the difference on the help-centre corpus from lesson 4.3, where the vector search confused E4012 with E4013.</p>`,
  points: [
    '<b>BM25</b> scores documents by query-term frequency, weighted by how rare each term is (IDF) and normalised by document length.',
    'Keywords excel at exact matches: codes, ids, names, rare technical terms. They miss synonyms and paraphrases.',
    'Vectors excel at meaning and paraphrase. They blur rare identifiers and can return related-but-wrong documents.',
    '<b>Reciprocal rank fusion (RRF)</b>: score = Σ 1 / (k + rank) across lists, with k usually 60. Uses ranks only, so no score calibration is needed.',
    '<b>Weighted fusion</b> combines normalised scores with a weight; it can beat RRF when tuned on an eval set, and is fragile when not.',
    'Evaluate with recall@k and MRR on labelled queries; keep both retrievers’ candidate lists around 20 to 100 before fusing.'
  ],
  concept: { title: 'Two imperfect witnesses', body: `<p>BM25 and vector search make different mistakes. When both rank a document highly, it is very likely relevant; when only one does, it is still worth a look. RRF captures exactly that: documents near the top of either list get a boost, and documents near the top of both get the biggest boost. Because it ignores raw scores, it works across retrievers whose scores live on completely different scales.</p>` },
  walk: [
    { h: 'BM25 in one line of maths', body: '<p>For each query term t in document d: <code class="i">IDF(t) · f(t,d)·(k1+1) / (f(t,d) + k1·(1 − b + b·|d|/avgdl))</code>, summed over terms. k1 (about 1.2 to 2) controls term-frequency saturation; b (about 0.75) controls length normalisation.</p>' },
    { h: 'Fuse with RRF', body: '<p>Ten lines that work with any number of rankers.</p>', code: String.raw`def rrf(rankings: list[list[str]], k: int = 60) -> list[str]:
    scores = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)

fused = rrf([bm25_ids[:50], vector_ids[:50]])` },
    { h: 'Or do it in the database', body: '<p>Postgres full-text search plus pgvector, fused in SQL, is a common production setup; the Code tab runs it. Search engines such as Elasticsearch, OpenSearch and Qdrant (with sparse vectors) offer built-in hybrid queries with RRF.</p>' }
  ],
  analogy: `<p><b>Asking a librarian and a subject expert.</b> The librarian finds every book with “E4012” in the index but has never heard the phrase “money back”. The expert knows what you mean but cannot remember exact codes. Ask both, and trust most the books they both pull off the shelf.</p>`,
  diagram: {
    title: 'Hybrid retrieval',
    cols: [['q'], ['bm25', 'vec'], ['l1', 'l2'], ['rrf'], ['out']],
    nodes: [
      { id: 'q', label: 'Query', sub: 'text', tone: 'fde', info: 'The same query goes to both retrievers.' },
      { id: 'bm25', label: 'BM25', sub: 'inverted index', tone: 'be', info: 'Keyword scoring over tokens; exact ids and rare terms.' },
      { id: 'vec', label: 'Vector search', sub: 'ANN index', tone: 'acc', info: 'Embedding similarity; paraphrases and meaning.' },
      { id: 'l1', label: 'Keyword ranking', sub: 'top 50', info: 'Ranked list by BM25 score.' },
      { id: 'l2', label: 'Vector ranking', sub: 'top 50', info: 'Ranked list by cosine similarity.' },
      { id: 'rrf', label: 'Fusion', sub: 'RRF k=60', tone: 'warn', info: 'Combines ranks; no score calibration needed.' },
      { id: 'out', label: 'Candidates', sub: 'to reranker', tone: 'ok', info: 'Top 20 to 50 go to the reranker (lesson 4.6).' }
    ],
    edges: [{ a: 'q', b: 'bm25', step: 1 }, { a: 'q', b: 'vec', step: 1 }, { a: 'bm25', b: 'l1', step: 2 }, { a: 'vec', b: 'l2', step: 2 }, { a: 'l1', b: 'rrf', step: 3 }, { a: 'l2', b: 'rrf', step: 3 }, { a: 'rrf', b: 'out', step: 4 }],
    steps: ['The query goes to both retrievers in parallel.', 'Each returns its own ranking.', 'Fusion combines the rankings by rank position.', 'The fused candidates move on to reranking.'],
    caption: 'Run both, fuse by rank, rerank the short list.'
  },
  illustrated: { title: 'RRF by hand', body: `<p>k = 60. Query: “refund for duplicate charge error E4012”.</p>
    <div class="tbl"><table><thead><tr><th>doc</th><th>BM25 rank</th><th>vector rank</th><th>RRF score</th></tr></thead><tbody>
    <tr><td>refund-policy</td><td class="n">1</td><td class="n">4</td><td class="n">1/61 + 1/64 = 0.0320</td></tr>
    <tr><td>money-back</td><td class="n">8</td><td class="n">1</td><td class="n">1/68 + 1/61 = 0.0311</td></tr>
    <tr><td>error-E4012</td><td class="n">2</td><td class="n">9</td><td class="n">1/62 + 1/69 = 0.0306</td></tr>
    <tr><td>billing-faq</td><td class="n">3</td><td class="n">2</td><td class="n">1/63 + 1/62 = 0.0320</td></tr></tbody></table></div>
    <p>A document ranked well by both lists (billing-faq) ties with one ranked first by one list. The simulator lets you move k and compare with weighted fusion.</p>` },
  code: {
    title: 'BM25 vs vector vs hybrid, measured', file: 'hybrid.py', deps: 'uv add rank-bm25 numpy',
    intro: '<p>The corpus and toy embedding from lesson 4.3, BM25 from the <code class="i">rank_bm25</code> library, and RRF. For each labelled query we record the rank of the right document under each method, then report hit@1, hit@3 and MRR.</p>',
    src: CORPUS + EMB + String.raw`
from rank_bm25 import BM25Okapi

texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]
bm25 = BM25Okapi([tokens(t) for t in texts])
M = np.stack([embed(t) for t in texts])

def rank_bm25(q): return [ids[i] for i in np.argsort(-bm25.get_scores(tokens(q)), kind="stable")]
def rank_vec(q):  return [ids[i] for i in np.argsort(-(M @ embed(q)), kind="stable")]
def rrf(rankings, k=60):
    s = {}
    for r in rankings:
        for pos, d in enumerate(r, 1):
            s[d] = s.get(d, 0) + 1 / (k + pos)
    return sorted(s, key=s.get, reverse=True)
def rank_hybrid(q): return rrf([rank_bm25(q), rank_vec(q)])

methods = {"bm25": rank_bm25, "vector": rank_vec, "hybrid": rank_hybrid}
positions = {m: [] for m in methods}
print(f"{'query':<46}" + "".join(f"{m:>8}" for m in methods))
for q, rel in QUERIES:
    row = []
    for m, fn in methods.items():
        pos = min(fn(q).index(r) for r in rel) + 1
        positions[m].append(pos); row.append(pos)
    print(f"{q[:45]:<46}" + "".join(f"{p:>8}" for p in row))
print("\nrank of the right document (1 = top). Summary:")
for m, p in positions.items():
    print(f"  {m:<7} hit@1={sum(x == 1 for x in p)}/{len(p)}  hit@3={sum(x <= 3 for x in p)}/{len(p)}  MRR={np.mean([1 / x for x in p]):.3f}")`,
    more: [{ note: '<b>Hybrid search inside Postgres.</b> Full-text search (tsvector, GIN index) and pgvector, fused with RRF in one SQL statement. Three-dimension vectors keep it readable.', file: 'hybrid.sql', lang: 'sql', pg: true, key: 'sql', src: String.raw`SET search_path = lab, public;
CREATE TABLE docs (
  id        text PRIMARY KEY,
  body      text NOT NULL,
  tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
  embedding vector(3) NOT NULL
);
CREATE INDEX docs_tsv ON docs USING gin (tsv);
CREATE INDEX docs_vec ON docs USING hnsw (embedding vector_cosine_ops);
INSERT INTO docs VALUES
 ('refund-policy', 'Duplicate charges are refunded automatically within 5 business days.', DEFAULT, '[0.9, 0.2, 0.0]'),
 ('money-back',    'Request your money back from the Billing page.',                       DEFAULT, '[0.85, 0.1, 0.05]'),
 ('error-e4012',   'E4012 means the card issuer declined a retry of a failed payment.',    DEFAULT, '[0.3, 0.9, 0.0]'),
 ('error-e4013',   'E4013 means the card on file has expired.',                            DEFAULT, '[0.32, 0.92, 0.02]'),
 ('sso-setup',     'Sign in with SAML single sign-on through Okta.',                       DEFAULT, '[0.0, 0.1, 0.95]');

-- query "payment error E4012": keywords OR-ed for recall, plus its (toy) embedding
WITH q AS (SELECT websearch_to_tsquery('english', 'E4012 or payment or error') AS tsq, '[0.33, 0.93, 0.01]'::vector AS v),
kw AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q.tsq) DESC) AS r
  FROM docs, q WHERE tsv @@ q.tsq ORDER BY r LIMIT 20),
vec AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> q.v) AS r
  FROM docs, q ORDER BY embedding <=> q.v LIMIT 20)
SELECT coalesce(kw.id, vec.id) AS id, kw.r AS keyword_rank, vec.r AS vector_rank,
       round(coalesce(1.0 / (60 + kw.r), 0) + coalesce(1.0 / (60 + vec.r), 0), 4) AS rrf
FROM kw FULL OUTER JOIN vec ON kw.id = vec.id
ORDER BY rrf DESC LIMIT 4;` }]
  },
  lab: {
    title: 'BM25 from scratch and two fusion methods', file: 'fusion_lab.py', browser: true,
    scenario: `<p>A customer’s security team will not approve new dependencies this quarter. Implement BM25 yourself, then compare RRF with weighted score fusion (min-max normalised per query) across a range of weights. Report which you would ship and why.</p>`,
    steps: ['Implement BM25 (k1 = 1.5, b = 0.75) with the IDF formula <code class="i">log((N - n + 0.5) / (n + 0.5) + 1)</code>.', 'Rank the corpus for each query with BM25 and with the toy embedding.', 'Implement RRF with k = 60 and weighted fusion: <code class="i">(1 - w)·bm25_norm + w·cos_norm</code>.', 'Compute MRR for BM25, vector, RRF, and weighted fusion at w = 0.1, 0.3, 0.5, 0.7, 0.9.', 'Print a recommendation.'],
    checks: ['Your BM25 ranks "what does error E4012 mean" correctly at position 1.', 'RRF’s MRR is at least as good as the better single retriever.', 'The weighted-fusion table shows its sensitivity to w.'],
    hints: ['Min-max normalise within one query’s scores; guard against max == min.', 'Keep sorting stable so ties are deterministic.'],
    starter: CORPUS + EMB + String.raw`
def mrr(rank_fn):
    return np.mean([1 / (min(rank_fn(q).index(r) for r in rel) + 1) for q, rel in QUERIES])

# TODO: BM25 class, rankers, rrf, weighted fusion, MRR table
`,
    solution: CORPUS + EMB + BM25 + String.raw`
texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]
bm = BM25([tokens(t) for t in texts])
M = np.stack([embed(t) for t in texts])

def order(scores): return [ids[i] for i in np.argsort(-np.asarray(scores), kind="stable")]
def rank_bm25(q): return order(bm.scores(tokens(q)))
def rank_vec(q):  return order(M @ embed(q))
def rrf(q, k=60):
    s = {}
    for r in (rank_bm25(q), rank_vec(q)):
        for pos, d in enumerate(r, 1):
            s[d] = s.get(d, 0) + 1 / (k + pos)
    return sorted(s, key=s.get, reverse=True)
def norm(x):
    x = np.asarray(x, float); lo, hi = x.min(), x.max()
    return (x - lo) / (hi - lo) if hi > lo else np.zeros_like(x)
def weighted(w):
    return lambda q: order((1 - w) * norm(bm.scores(tokens(q))) + w * norm(M @ embed(q)))

def mrr(rank_fn):
    return np.mean([1 / (min(rank_fn(q).index(r) for r in rel) + 1) for q, rel in QUERIES])

print("E4012 top result with our BM25:", rank_bm25("what does error E4012 mean")[0])
print(f"{'method':<16}{'MRR':>6}")
for name, fn in [("bm25", rank_bm25), ("vector", rank_vec), ("rrf k=60", rrf)] + [(f"weighted w={w}", weighted(w)) for w in (0.1, 0.3, 0.5, 0.7, 0.9)]:
    print(f"{name:<16}{mrr(fn):>6.3f}")
ws = {w: mrr(weighted(w)) for w in (0.1, 0.3, 0.5, 0.7, 0.9)}
best = max(ws, key=ws.get)
print(f"Best weighted (w={best}) scores {ws[best]:.3f} vs RRF {mrr(rrf):.3f}, but MRR swings {min(ws.values()):.3f} to {max(ws.values()):.3f} with w")
print("on only 9 queries. Ship RRF as the default and tune a weight only on a much larger eval set.")`
  },
  design: {
    lead: '<p>Hybrid search doubles the retrieval paths and the indexes to keep in sync. Run them in parallel, keep them consistent, and measure each path separately so you know which one is failing.</p>',
    scale: [{ h: 'Parallel retrievers', p: 'Query BM25 and vectors concurrently; total latency is the slower of the two plus fusion, which is microseconds.' }, { h: 'One index or two', p: 'Engines with native hybrid (sparse plus dense vectors in one collection, or text plus vector fields) avoid keeping two systems consistent.' }],
    fail: [{ h: 'Tokeniser mismatch', p: 'BM25 that splits "E-4012" into "e" and "4012" will not match "E4012". Normalise identifiers at index and query time.' }, { h: 'Language analysers', p: 'English stemming on German or Hindi text hurts recall. Choose analysers per language or rely more on multilingual vectors.' }],
    trade: [{ h: 'RRF vs weighted', p: 'RRF is parameter-light and robust; weighted fusion can be better with a large eval set and stable score distributions.' }, { h: 'Learned sparse retrieval', p: 'Models like SPLADE produce sparse vectors that behave like smarter BM25; stronger, but another model to host.' }],
    prompt: '<p>Support agents search 3 million tickets by ticket id, customer name, error code and free text. Design retrieval.</p>',
    answer: '<ul><li>Exact-match fast path: regex for ticket ids and error codes goes straight to a keyed lookup.</li><li>Hybrid otherwise: BM25 with identifier-aware tokenisation plus vectors, fused with RRF.</li><li>Filters for tenant, date and product applied inside both retrievers.</li><li>Eval set of real agent searches, recall@10 per query type, reviewed monthly.</li></ul>'
  },
  quiz: [
    { q: 'Which query type favours BM25 over vector search?', o: ['"how do I get my money back"', '"error E4012"', '"I cannot sign in"', '"what is your refund policy"'], a: 1, why: 'Exact rare identifiers are BM25’s strength.' },
    { q: 'Why is RRF easy to use?', o: ['It needs a trained model', 'It only uses ranks, so scores from different retrievers never need calibration', 'It is the fastest index', 'It removes duplicates'], a: 1, why: 'Rank-based fusion ignores score scales.' },
    { q: 'In BM25, what does the b parameter control?', o: ['Term rarity', 'Document length normalisation', 'Number of results', 'Stemming'], a: 1, why: 'b = 0 ignores length; b = 1 fully normalises by length.' }
  ],
  interview: [
    { q: 'Why hybrid search instead of only embeddings?', a: '<p>Embeddings capture meaning but blur exact identifiers, rare terms and names; BM25 nails those and misses paraphrases. Users send both kinds of queries. Fusing both lists with RRF consistently improves recall on mixed query sets, and it is cheap because both retrievers run in parallel.</p>' },
    { q: 'How do you know hybrid helped?', a: '<p>A labelled query set grouped by type (identifiers, paraphrases, questions), with recall@k and MRR for BM25, vectors and hybrid side by side. I look at the per-type breakdown, not just the average, and check that the fused candidate list contains the answer before blaming the generator.</p>' }
  ]
});

/* ===================================================================== 4.6 */
L({
  id: '4.6', title: 'Reranking', minutes: 45, roles: ['be', 'fde'],
  tags: 'two-stage retrieval · cross-encoders · LLM rerankers · MRR · nDCG · candidate depth · latency budget',
  mental: 'First-stage retrieval is fast and broad; a reranker is slow and precise. Retrieve 20 to 100 candidates cheaply, then score each one against the query with a model that reads both together, and keep the best few for the prompt.',
  intro: `<p>Embeddings compress a query and a document separately, then compare the results. A <b>cross-encoder</b> reads the query and a candidate together and scores how well the candidate answers the query, which is far more accurate and far too slow to run on the whole corpus. Combining the two gives you both properties: recall from the first stage, precision from the second.</p>
  <p>Reranking is usually the single biggest quality gain after hybrid search, and it lets you send fewer, better chunks to the model, which also cuts cost.</p>`,
  points: [
    'Two stages: hybrid retrieval for recall (top 20 to 100), reranker for precision (top 3 to 10).',
    'Options: open cross-encoders (self-hosted), hosted rerank APIs, or an LLM asked to rank candidates.',
    'The reranker can only reorder what stage one found: measure stage-one recall@N first.',
    'Cost and latency grow with the number of candidates; choose N from a measured recall curve.',
    'Measure with ranking metrics: MRR (where the first right answer lands), nDCG@k (graded relevance with position discount), recall@k.',
    'Set a relevance threshold so irrelevant candidates are dropped instead of padded into the prompt.'
  ],
  concept: { title: 'Cheap and broad, then expensive and precise', body: `<p>Think of the first stage as a net and the reranker as a person sorting the catch. A bigger net (larger N) catches more of what you want and gives the sorter more work. The sorter cannot find fish that were never caught. So you size the net from recall measurements and the sorting effort from your latency budget.</p>` },
  walk: [
    { h: 'A cross-encoder reranker', body: '<p>An open model from the sentence-transformers ecosystem; hosted rerank APIs (Cohere, Voyage, Jina and others) take the same inputs. Shown, not run here.</p>', code: String.raw`from sentence_transformers import CrossEncoder
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
pairs = [(query, c.text) for c in candidates]           # 20 to 100 candidates from hybrid search
scores = reranker.predict(pairs, batch_size=32)
top = [c for _, c in sorted(zip(scores, candidates), key=lambda x: -x[0])][:5]` },
    { h: 'An LLM as reranker', body: '<p>Useful when you need domain reasoning or have no reranker hosting; slower and costlier per query. Ask for ids only, with structured output.</p>', code: String.raw`prompt = "Rank these passages by how well they answer the question. Return the ids of relevant passages, best first.\n"
prompt += "".join(f'<passage id="{c.id}">{c.text}</passage>\n' for c in candidates)
# output_config with schema {"ids": [string]} ; drop ids not in the candidate set` },
    { h: 'Read the metrics', body: '<p><b>MRR</b> = average of 1 / rank of the first relevant result. <b>nDCG@k</b> = discounted gain of graded relevance, divided by the best possible ordering, so 1.0 is perfect. <b>Recall@k</b> = share of relevant items found in the top k.</p>' }
  ],
  analogy: `<p><b>Hiring.</b> A recruiter skims 500 CVs in an hour by keywords and picks 30 (first stage). Interviewers spend an hour with each of those 30 and pick 3 (reranker). Interviews are accurate but expensive, so you never interview all 500, and you never hire someone the recruiter discarded.</p>`,
  diagram: {
    title: 'Two-stage retrieval',
    cols: [['q'], ['hyb'], ['cand'], ['rr'], ['thr'], ['ctx']],
    nodes: [
      { id: 'q', label: 'Query', tone: 'fde', info: 'The user question, possibly rewritten (lesson 4.7).' },
      { id: 'hyb', label: 'Hybrid retrieval', sub: 'fast · broad', tone: 'be', info: 'BM25 plus vectors, fused (lesson 4.5).' },
      { id: 'cand', label: 'Top N candidates', sub: 'N = 20 to 100', info: 'Size N from a stage-one recall curve.' },
      { id: 'rr', label: 'Reranker', sub: 'query + passage together', tone: 'acc', info: 'Cross-encoder, hosted rerank API, or LLM.' },
      { id: 'thr', label: 'Threshold + top k', sub: 'k = 3 to 8', tone: 'warn', info: 'Drop low scores instead of padding the prompt.' },
      { id: 'ctx', label: 'Prompt context', sub: 'with ids for citations', tone: 'ok', info: 'Fewer, better chunks: higher quality and lower cost.' }
    ],
    edges: [{ a: 'q', b: 'hyb', step: 1 }, { a: 'hyb', b: 'cand', step: 2 }, { a: 'cand', b: 'rr', step: 3 }, { a: 'rr', b: 'thr', step: 4 }, { a: 'thr', b: 'ctx', step: 5 }],
    steps: ['The query enters hybrid retrieval.', 'A broad candidate set comes back.', 'The reranker scores each candidate against the query.', 'Low scores are dropped and the top k kept.', 'The survivors go into the prompt with their ids.'],
    caption: 'Recall first, precision second, then a threshold.'
  },
  illustrated: { title: 'Choosing N from a latency budget', body: `<p>Suppose a reranker takes about 4 ms per candidate on your GPU when batched, and you have 120 ms for reranking.</p>
    <div class="tbl"><table><thead><tr><th>N</th><th>stage-one recall@N</th><th>rerank time</th><th>fits budget?</th></tr></thead><tbody>
    <tr><td class="n">10</td><td class="n">0.78</td><td class="n">40 ms</td><td>yes, but misses 22% of answers</td></tr>
    <tr><td class="n">30</td><td class="n">0.93</td><td class="n">120 ms</td><td>yes</td></tr>
    <tr><td class="n">50</td><td class="n">0.96</td><td class="n">200 ms</td><td>no</td></tr></tbody></table></div>
    <p>N = 30 is the sweet spot here; illustrative numbers, and the lab computes the curve from data.</p>` },
  code: {
    title: 'Measure a reranker: MRR and nDCG before and after', file: 'rerank.py', browser: true,
    intro: '<p>Hybrid retrieval returns 6 candidates per query; a reranker reorders them. Running a cross-encoder needs a model download, so a hand-weighted feature scorer (shared concepts, exact identifier match, title match, keyword score) stands in for it here. The pipeline and the metrics are exactly what you would use with a real reranker: swap in <code class="i">CrossEncoder.predict</code> and nothing else changes.</p>',
    src: CORPUS + EMB + BM25 + String.raw`
texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]; by_id = {d["id"]: d for d in DOCS}
bm = BM25([tokens(t) for t in texts]); M = np.stack([embed(t) for t in texts])

def hybrid(q, n=6, k=60):
    s = {}
    for scores in (bm.scores(tokens(q)), M @ embed(q)):
        for pos, i in enumerate(np.argsort(-np.asarray(scores), kind="stable"), 1):
            s[ids[i]] = s.get(ids[i], 0) + 1 / (k + pos)
    return sorted(s, key=s.get, reverse=True)[:n]

def rerank_score(q, doc_id):                     # stand-in for reranker.predict([(q, text)])
    d = by_id[doc_id]; text = d["title"] + ". " + d["text"]
    qc, dc = set(concepts(q)), set(concepts(text))
    codes = {t for t in tokens(q) if any(ch.isdigit() for ch in t)}
    return (2.0 * len(qc & dc) + 3.0 * len(codes & set(tokens(text)))
            + 0.5 * len(set(tokens(q)) & set(tokens(d["title"]))) + 0.1 * bm.scores(tokens(q))[ids.index(doc_id)])

def rerank(q, cands):
    return sorted(cands, key=lambda c: -rerank_score(q, c))

def mrr(ranked, rel):  return next((1 / i for i, d in enumerate(ranked, 1) if d in rel), 0.0)
def ndcg(ranked, rel, k=3):
    dcg = sum(1 / np.log2(i + 1) for i, d in enumerate(ranked[:k], 1) if d in rel)
    ideal = sum(1 / np.log2(i + 1) for i in range(1, min(k, len(rel)) + 1))
    return dcg / ideal

rows = []
for q, rel in QUERIES:
    first = hybrid(q); second = rerank(q, first)
    rows.append((mrr(first, rel), mrr(second, rel), ndcg(first, rel), ndcg(second, rel)))
    if first[0] != second[0]:
        print(f"reordered: {q[:44]!r}: {first[0]} -> {second[0]}")
r = np.array(rows).mean(0)
print(f"\n{'':<12}{'MRR':>7}{'nDCG@3':>9}")
print(f"{'hybrid':<12}{r[0]:>7.3f}{r[2]:>9.3f}")
print(f"{'+ rerank':<12}{r[1]:>7.3f}{r[3]:>9.3f}")
print("stage-one recall@6:", np.mean([any(d in rel for d in hybrid(q)) for q, rel in QUERIES]))
print("caution: this scorer was written with these 9 queries in view, so a perfect score is overfitting;")
print("judge a real reranker on a held-out set of hundreds of queries (Phase 7).")`
  },
  lab: {
    title: 'Size the candidate set from data', file: 'depth_lab.py', browser: true,
    scenario: `<p>The customer’s reranker costs 4 ms per candidate and the latency budget for reranking is 150 ms. You have stage-one results for 500 evaluation queries: for each query, the rank at which each of its relevant documents appeared (or none). Compute recall@N for N from 5 to 100, find the smallest N reaching 95% recall, check it fits the budget, and implement nDCG@k with graded relevance for the final report.</p>`,
    steps: ['Generate the synthetic evaluation data with the seeded generator in the starter.', 'Compute recall@N: share of relevant documents found within the top N, averaged over queries.', 'Find the smallest N with recall ≥ 0.95 and its reranking time.', 'Implement <code class="i">ndcg(gains, k)</code> where gains are graded relevance values (0 to 3) in ranked order.', 'Print the recall table and a one-line recommendation.'],
    checks: ['recall@N never decreases as N grows.', 'nDCG is 1.0 for an ideally ordered list.', 'The recommendation states N, recall and milliseconds.'],
    hints: ['A relevant document with rank None was never retrieved: it counts as a miss at every N.', 'Ideal DCG sorts the same gains in descending order.'],
    starter: String.raw`import math, random
random.seed(6)
# each query: list of ranks (1-based) at which its relevant docs appeared in stage one; None = not retrieved
queries = []
for _ in range(500):
    n_rel = random.choice([1, 1, 2, 3])
    queries.append([None if random.random() < 0.03 else max(1, int(random.expovariate(1 / 9))) for _ in range(n_rel)])
MS_PER_CANDIDATE, BUDGET_MS = 4, 150

def recall_at(n):
    # TODO
    return 0.0

def ndcg(gains, k):
    # TODO
    return 0.0

print(recall_at(10), ndcg([3, 2, 0, 1], 4))`,
    solution: String.raw`import math, random
random.seed(6)
queries = []
for _ in range(500):
    n_rel = random.choice([1, 1, 2, 3])
    queries.append([None if random.random() < 0.03 else max(1, int(random.expovariate(1 / 9))) for _ in range(n_rel)])
MS_PER_CANDIDATE, BUDGET_MS = 4, 150

def recall_at(n):
    return sum(sum(r is not None and r <= n for r in q) / len(q) for q in queries) / len(queries)

def dcg(gains):
    return sum((2 ** g - 1) / math.log2(i + 1) for i, g in enumerate(gains, 1))

def ndcg(gains, k):
    ideal = dcg(sorted(gains, reverse=True)[:k])
    return dcg(gains[:k]) / ideal if ideal else 0.0

print(f"{'N':>4} {'recall@N':>9} {'rerank ms':>10}")
for n in (5, 10, 20, 30, 40, 50, 75, 100):
    print(f"{n:>4} {recall_at(n):>9.3f} {n * MS_PER_CANDIDATE:>10}")
best = next(n for n in range(1, 201) if recall_at(n) >= 0.95)
print(f"smallest N with recall >= 0.95: {best} ({best * MS_PER_CANDIDATE} ms, budget {BUDGET_MS} ms -> {'fits' if best * MS_PER_CANDIDATE <= BUDGET_MS else 'does not fit'})")
print(f"ceiling: {recall_at(10**6):.3f} (relevant docs never retrieved cap recall; fix stage one for those)")
print("nDCG@4 examples:", round(ndcg([3, 2, 1, 0], 4), 3), round(ndcg([0, 1, 2, 3], 4), 3), round(ndcg([3, 2, 0, 1], 4), 3))`
  },
  design: {
    lead: '<p>The reranker is a model-serving dependency on the hot path. Budget its latency, batch its inputs, cache where queries repeat, and keep a fallback when it is slow or down.</p>',
    scale: [{ h: 'Batching and GPUs', p: 'Cross-encoders run efficiently in batches on GPUs; one batched call for all N candidates, not N calls.' }, { h: 'Truncation', p: 'Rerankers have input limits; truncate passages to the window that matters, usually the chunk itself without long headers.' }],
    fail: [{ h: 'Reranker outage', p: 'Fall back to the first-stage order with a smaller k rather than failing the request; alert on fallback rate.' }, { h: 'Domain mismatch', p: 'General rerankers trained on web search can misjudge legal or medical text. Evaluate on your data; consider fine-tuning (Phase 13).' }],
    trade: [{ h: 'Cross-encoder vs LLM reranker', p: 'Cross-encoders: milliseconds and cheap. LLM rerankers: better at reasoning, slower and more expensive per query.' }, { h: 'More candidates vs latency', p: 'Each extra candidate adds rerank time; pick N where the recall curve flattens.' }],
    prompt: '<p>Add reranking to a support assistant with a 1.5-second p95 end-to-end budget and 200 QPS.</p>',
    answer: '<ul><li>Hybrid stage returns 40 candidates in about 60 ms.</li><li>Self-hosted cross-encoder on a GPU pool, batched, about 80 ms p95; autoscaled on queue depth.</li><li>Threshold plus top 5 into the prompt; fallback to hybrid order if reranking exceeds 150 ms.</li><li>Track MRR and nDCG on a nightly eval, and reranker latency and fallback rate live.</li></ul>'
  },
  quiz: [
    { q: 'Why not run a cross-encoder over the whole corpus?', o: ['It cannot read documents', 'It scores one query-passage pair at a time, far too slow for millions of passages', 'It needs BM25', 'It only works on titles'], a: 1, why: 'Cross-encoders are accurate per pair but cost scales with the number of pairs.' },
    { q: 'Stage-one recall@50 is 0.80. What is the best possible recall after reranking those 50?', o: ['1.0', '0.80', '0.90', 'Unknown'], a: 1, why: 'A reranker can only reorder what was retrieved.' },
    { q: 'nDCG@k equals 1.0 when:', o: ['Any relevant document is in the top k', 'The top k is ordered exactly as the ideal ranking by relevance grade', 'k = 1', 'MRR = 0.5'], a: 1, why: 'nDCG divides by the ideal DCG.' }
  ],
  interview: [
    { q: 'How do you decide how many candidates to rerank?', a: '<p>Plot stage-one recall@N on a labelled set and the reranker’s latency per candidate. Pick the N where recall flattens and that fits the latency budget, then confirm end-to-end quality with the reranker included. If recall is too low at any N, fix the first stage, not the reranker.</p>' },
    { q: 'MRR or nDCG: which do you report?', a: '<p>MRR when there is usually one right answer and what matters is how high it lands, as in support FAQs. nDCG when there are several relevant documents with different degrees of relevance, as in research or legal search. I usually report recall@k too, because the generator needs the answer somewhere in its context.</p>' }
  ]
});

/* ===================================================================== 4.7 */
L({
  id: '4.7', title: 'Advanced RAG patterns', minutes: 55, roles: ['fde', 'be'],
  tags: 'query rewriting · multi-query · HyDE · decomposition · citations · abstention · corrective and agentic RAG',
  mental: 'Basic RAG is retrieve then generate. Production RAG adds steps around both: improve the query before retrieval, judge what came back, ground the answer in cited sources, verify the citations, and say “I don’t know” when the sources do not support an answer.',
  intro: `<p>With ingestion, chunking, hybrid search and reranking in place, most remaining failures are about the question or the answer, not the index: a vague or multi-part question, an answer that blends sources or invents details, or a confident reply when nothing relevant exists. The patterns in this lesson address those failures. Each adds latency and cost, so you add them when an eval shows the failure they fix.</p>`,
  points: [
    '<b>Query rewriting</b>: turn a chatty follow-up (“and for annual?”) into a standalone query using the conversation.',
    '<b>Multi-query</b>: generate a few phrasings, retrieve for each, fuse with RRF. <b>HyDE</b>: embed a hypothetical answer instead of the question.',
    '<b>Decomposition</b>: split a multi-part question into sub-questions, retrieve for each, then answer together.',
    '<b>Grounded generation</b>: put sources in tagged blocks with ids, require a citation for every claim, and validate the citations in code.',
    '<b>Abstention</b>: when retrieval confidence is low or the sources do not contain the answer, say so and offer escalation.',
    '<b>Corrective and agentic RAG</b>: grade the retrieved chunks, retry with a rewritten query or another source, or let an agent call search as a tool (Phase 5).'
  ],
  concept: { title: 'Ground, cite, verify, or abstain', body: `<p>A RAG answer is only as trustworthy as its link to the sources. Make that link explicit: each claim carries a source id, your code checks that the id was in the context and that quoted text really appears there, and the system refuses when the evidence is missing. These checks are cheap and catch the most damaging failures, such as invented policies and cross-customer leaks, before a customer sees them.</p>` },
  walk: [
    { h: 'Give sources ids and demand citations', body: '<p>The prompt makes the contract explicit.</p>', code: String.raw`SYSTEM = """Answer only from the sources. Cite every sentence with its source id like [refund-policy].
If the sources do not answer the question, reply exactly: NOT_FOUND."""
context = "\n".join(f'<source id="{c.id}">{c.text}</source>' for c in chunks)
user = f"{context}\n<question>{question}</question>"` },
    { h: 'Check before you show', body: '<p>Parse the citations, reject ids not in the context, and optionally check that each cited sentence overlaps its source. Anthropic’s API also offers a citations feature on document blocks that returns exact cited spans, which removes most of this parsing.</p>' },
    { h: 'Add patterns only where evals say so', body: `<div class="tbl"><table><thead><tr><th>failure in your eval</th><th>pattern</th><th>cost</th></tr></thead><tbody>
      <tr><td>follow-up questions retrieve nothing</td><td>query rewriting with history</td><td>one small model call</td></tr>
      <tr><td>vocabulary mismatch</td><td>multi-query or HyDE</td><td>one call plus extra searches</td></tr>
      <tr><td>multi-part questions half-answered</td><td>decomposition</td><td>several searches</td></tr>
      <tr><td>invented answers on unknown topics</td><td>abstention threshold, NOT_FOUND</td><td>almost free</td></tr>
      <tr><td>answers need several hops across sources</td><td>agentic RAG (search as a tool)</td><td>several model calls</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A careful research assistant.</b> They rephrase your vague request before searching, check several catalogues, put a footnote on every claim, double-check that each footnote says what they claim, and tell you plainly when the library has nothing on the topic rather than making something up.</p>`,
  diagram: {
    title: 'A production RAG request',
    cols: [['q'], ['rw'], ['ret'], ['grade'], ['gen', 'abst'], ['cite'], ['ans']],
    nodes: [
      { id: 'q', label: 'Question', sub: '+ history', tone: 'fde', info: 'The user turn and recent conversation.' },
      { id: 'rw', label: 'Rewrite', sub: 'standalone · multi-query', info: 'Resolve references; optionally generate alternative phrasings.' },
      { id: 'ret', label: 'Retrieve', sub: 'hybrid + rerank', tone: 'be', info: 'Lessons 4.5 and 4.6, with ACL filters (4.8).' },
      { id: 'grade', label: 'Grade', sub: 'enough evidence?', tone: 'warn', info: 'Score threshold or a small judge model decides whether to answer, retry or abstain.' },
      { id: 'gen', label: 'Generate', sub: 'cite every claim', tone: 'acc', info: 'Model answers from tagged sources with ids.' },
      { id: 'abst', label: 'Abstain', sub: 'NOT_FOUND · escalate', tone: 'bad', info: 'Say so and offer a human or another channel.' },
      { id: 'cite', label: 'Verify citations', sub: 'ids · quotes', info: 'Reject unknown ids; check quoted spans exist in the sources.' },
      { id: 'ans', label: 'Answer', sub: 'with sources', tone: 'ok', info: 'Rendered with links to the cited documents.' }
    ],
    edges: [{ a: 'q', b: 'rw', step: 1 }, { a: 'rw', b: 'ret', step: 2 }, { a: 'ret', b: 'grade', step: 3 }, { a: 'grade', b: 'gen', step: 4 }, { a: 'grade', b: 'abst', dash: true, step: 4 }, { a: 'gen', b: 'cite', step: 5 }, { a: 'cite', b: 'ans', step: 6 }, { a: 'grade', b: 'rw', dash: true, bend: -50 }],
    steps: ['The question and recent history arrive.', 'It is rewritten into a standalone query, possibly several.', 'Hybrid retrieval and reranking fetch evidence.', 'A grader decides: answer, retry with a rewrite, or abstain.', 'The model answers with a citation per claim; code verifies them.', 'Only verified answers are shown, with sources.'],
    caption: 'Every answer is either grounded and verified, or an explicit abstention.'
  },
  illustrated: { title: 'Rewriting a follow-up', body: `<div class="tbl"><table><thead><tr><th>turn</th><th>raw text</th><th>retrieval query after rewriting</th></tr></thead><tbody>
    <tr><td class="n">1</td><td>I was charged twice for Pro this month</td><td>duplicate charge Pro plan refund</td></tr>
    <tr><td class="n">2</td><td>and what about annual?</td><td>refund for duplicate charge on an annual Pro plan</td></tr>
    <tr><td class="n">3</td><td>ok, who approves it?</td><td>who approves refunds for annual plan duplicate charges</td></tr></tbody></table></div>
    <p>Without rewriting, turn 2 searches for “what about annual” and retrieves nothing useful.</p>` },
  code: {
    title: 'Grounded answers with verified citations and abstention', file: 'rag.py', deps: 'uv add anthropic rank-bm25 numpy',
    intro: FAKE_NOTE + '<p>Hybrid retrieval from lesson 4.5, a confidence check that abstains before calling the model, a prompt with tagged sources, and a citation validator. The fake model answers extractively from the sources it receives, and on one question it deliberately cites a source it was not given, so you can see the validator catch it.</p>',
    src: CORPUS + EMB + String.raw`
import json, re
import anthropic
from rank_bm25 import BM25Okapi
try:
    import httpx2 as httpx
except ImportError:
    import httpx

# ---- fake Messages API: extractive answers from the <source> blocks it is sent ----
def fake_api(request):
    body = json.loads(request.content)
    user = body["messages"][-1]["content"]
    sources = re.findall(r'<source id="([^"]+)">(.*?)</source>', user, re.S)
    question = re.search(r"<question>(.*?)</question>", user, re.S).group(1)
    overlap = lambda s: 2 * len(set(concepts(question)) & set(concepts(s[1]))) + len(set(tokens(question)) & set(tokens(s[1])))
    best = max(sources, key=overlap)
    sentence = re.split(r"(?<=\.)\s", best[1])[0]
    text = f"{sentence} [{best[0]}]"
    if question.startswith("Which plans"):       # misbehaves on purpose: cites a source it never saw
        text = "SAML SSO is included in Pro and Enterprise. [pricing-2025]"
    return httpx.Response(200, json={"id": "m", "type": "message", "role": "assistant", "model": body["model"],
        "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
        "usage": {"input_tokens": 300, "output_tokens": 30}})
client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(fake_api)))
# ---------------------------------------------------------------------------

texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]; by_id = {d["id"]: d for d in DOCS}
bm25 = BM25Okapi([tokens(t) for t in texts]); M = np.stack([embed(t) for t in texts])

def retrieve(q, k=3):
    v, b = M @ embed(q), bm25.get_scores(tokens(q))
    fused = {}
    for scores in (v, b):
        for pos, i in enumerate(np.argsort(-scores, kind="stable"), 1):
            fused[ids[i]] = fused.get(ids[i], 0) + 1 / (60 + pos)
    top = sorted(fused, key=fused.get, reverse=True)[:k]
    confidence = float(v.max())                  # best cosine similarity as a cheap confidence signal
    return top, confidence

SYSTEM = ("Answer only from the sources. Cite every sentence with its source id like [refund-policy]. "
          "If the sources do not answer the question, reply exactly: NOT_FOUND.")

def answer(question, min_confidence=0.25):
    top, conf = retrieve(question)
    if conf < min_confidence:
        return f"ABSTAIN (confidence {conf:.2f}): I could not find this in the help centre. Want me to open a ticket?"
    context = "\n".join(f'<source id="{i}">{by_id[i]["text"]}</source>' for i in top)
    resp = client.messages.create(model="claude-haiku-5-5", max_tokens=300, system=SYSTEM,
                                  messages=[{"role": "user", "content": f"{context}\n<question>{question}</question>"}])
    text = resp.content[0].text
    cited = re.findall(r"\[([a-z0-9-]+)\]", text)
    unknown = [c for c in cited if c not in top]
    if not cited or unknown:
        return f"BLOCKED: citation check failed (cited {cited}, allowed {top}). Falling back to showing the sources."
    return f"{text}   (confidence {conf:.2f})"

for q in ["I was charged twice, when do I get the money back?",
          "what does error E4013 mean",
          "Which plans include SAML SSO?",
          "Do you accept payment in bitcoin?"]:
    print(f"Q: {q}\nA: {answer(q)}\n")`
  },
  lab: {
    title: 'Corrective RAG with multi-query fusion', file: 'crag_lab.py', browser: true,
    scenario: `<p>Users of a customer’s portal write short, slangy queries (“got billed 2x”, “kill my sub”) that retrieve poorly. Build a corrective loop: retrieve, grade the evidence, and if it is weak, rewrite the query into several alternatives, retrieve for each, fuse with RRF, grade again, and abstain if it is still weak.</p>`,
    steps: ['Write <code class="i">grade(query, doc_ids)</code>: the best cosine similarity among the top results (toy embedding).', 'Write <code class="i">rewrite(query)</code> returning up to 3 alternatives using the slang table in the starter (a stand-in for an LLM rewrite call).', 'Write <code class="i">corrective_retrieve(query)</code>: one pass; if grade < 0.3, multi-query plus RRF; if still < 0.3, return ABSTAIN.', 'Run on the five portal queries and print the path taken (direct, rewritten, abstain) and the top document.'],
    checks: ['“got billed 2x” ends on refund-policy via the rewrite path.', '“do you sell hardware” abstains.', 'Queries that already work take the direct path with no extra calls.'],
    hints: ['Fuse the rankings of all alternatives plus the original.', 'Count retrieval calls per query to show the cost of the corrective path.'],
    starter: CORPUS + EMB + String.raw`
SLANG = {"billed 2x": ["charged twice", "duplicate charge refund"], "kill my sub": ["cancel subscription", "terminate plan"],
         "cant get in": ["cannot log in", "reset password sign in"], "too many calls": ["rate limit 429", "too many requests"]}
texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]
M = np.stack([embed(t) for t in texts])
def search(q, k=5):
    s = M @ embed(q); order = np.argsort(-s, kind="stable")[:k]
    return [ids[i] for i in order], float(s[order[0]])

# TODO: rewrite, corrective_retrieve
for q in ["got billed 2x", "kill my sub", "what does error E4012 mean", "cant get in", "do you sell hardware"]:
    print(q, search(q))`,
    solution: CORPUS + EMB + String.raw`
SLANG = {"billed 2x": ["charged twice", "duplicate charge refund"], "kill my sub": ["cancel subscription", "terminate plan"],
         "cant get in": ["cannot log in", "reset password sign in"], "too many calls": ["rate limit 429", "too many requests"]}
texts = [d["title"] + ". " + d["text"] for d in DOCS]
ids = [d["id"] for d in DOCS]
M = np.stack([embed(t) for t in texts])
calls = {"n": 0}
def search(q, k=5):
    calls["n"] += 1
    s = M @ embed(q); order = np.argsort(-s, kind="stable")[:k]
    return [ids[i] for i in order], float(s[order[0]])

def rewrite(q):                                   # stand-in for a small LLM call that returns alternatives
    out = []
    for slang, alts in SLANG.items():
        if slang in q.lower():
            out += [q.lower().replace(slang, a) for a in alts]
    return out[:3]

def rrf(rankings, k=60):
    s = {}
    for r in rankings:
        for pos, d in enumerate(r, 1):
            s[d] = s.get(d, 0) + 1 / (k + pos)
    return sorted(s, key=s.get, reverse=True)

def corrective_retrieve(q, threshold=0.3):
    calls["n"] = 0
    ranked, grade = search(q)
    if grade >= threshold:
        return "direct", ranked[0], grade, calls["n"]
    alts = rewrite(q)
    results = [search(a) for a in alts]           # the original ranking was graded weak: leave it out of the fusion
    best_grade = max([g for _, g in results] + [grade])
    if not alts or best_grade < threshold:
        return "abstain", None, best_grade, calls["n"]
    return "rewritten", rrf([r for r, _ in results])[0], best_grade, calls["n"]

for q in ["got billed 2x", "kill my sub", "what does error E4012 mean", "cant get in", "do you sell hardware"]:
    path, top, g, n = corrective_retrieve(q)
    print(f"{q:<28} path={path:<9} top={str(top):<15} grade={g:.2f} searches={n}")
print("note: vector-only search still confuses E4012 with E4013; fusing BM25 (lesson 4.5) fixes that one.")`
  },
  design: {
    lead: '<p>Each pattern adds a model call or a search to the request path. Design RAG as a pipeline of optional stages with budgets, switched on per use case by evidence from evals.</p>',
    scale: [{ h: 'Small models for helper steps', p: 'Rewriting, grading and multi-query generation run well on a small, fast model; reserve the large model for the final answer.' }, { h: 'Parallelism', p: 'Multi-query searches run concurrently; decomposition sub-questions can too.' }],
    fail: [{ h: 'Citation theatre', p: 'Citations that are never checked give false confidence. Validate ids and spot-check quotes; track citation precision in evals.' }, { h: 'Over-abstaining', p: 'A threshold set too high frustrates users. Tune it on an eval set with answerable and unanswerable questions.' }],
    trade: [{ h: 'Pipeline vs agentic RAG', p: 'Fixed pipelines are predictable, cheap and easy to evaluate. Agentic RAG handles multi-hop questions but costs more calls and is harder to bound.' }, { h: 'Long context vs retrieval', p: 'Large context windows let you skip retrieval for small corpora; retrieval still wins on cost, freshness and permissions at scale.' }],
    prompt: '<p>An insurer wants an assistant that answers policy questions for agents, where a wrong answer can cost money. Design the RAG flow.</p>',
    answer: '<ul><li>Query rewriting with conversation history; hybrid retrieval with ACL filters; reranking.</li><li>Grader with a conservative threshold; abstain and route to an underwriter queue.</li><li>Answers must cite clause ids; validator checks ids and quoted spans; the UI shows the clause text.</li><li>Evals with unanswerable questions and adversarial phrasing; weekly review of abstentions and user feedback.</li></ul>'
  },
  quiz: [
    { q: 'A follow-up "and for annual?" retrieves nothing useful. Best fix?', o: ['Bigger chunks', 'Rewrite the query into a standalone question using the conversation', 'Lower temperature', 'More GPUs'], a: 1, why: 'The query lacks the context needed for retrieval.' },
    { q: 'What should code do with a citation id that was not in the context?', o: ['Show it anyway', 'Treat the answer as failing verification and fall back or retry', 'Remove the brackets', 'Ignore citations'], a: 1, why: 'An unknown id means the claim is not grounded in what you supplied.' },
    { q: 'When is abstaining the right behaviour?', o: ['Never', 'When retrieval confidence is low or the sources do not contain the answer', 'Whenever the question is long', 'Only for refunds'], a: 1, why: 'Saying "I don’t know" beats an invented answer.' }
  ],
  interview: [
    { q: 'How do you reduce hallucinations in a RAG system?', a: '<p>Improve retrieval first, because most "hallucinations" are missing evidence. Then constrain generation: tagged sources with ids, an instruction to answer only from them, a NOT_FOUND path, and citations validated in code. Add a confidence threshold for abstention, and measure faithfulness and citation precision with evals on answerable and unanswerable questions.</p>' },
    { q: 'When would you move from a RAG pipeline to agentic RAG?', a: '<p>When evals show multi-hop or exploratory questions that a single retrieval cannot answer, for example comparing two contracts or following references. I would give the agent search tools with filters, a step and token budget, and keep the same citation verification on the final answer.</p>' }
  ]
});

/* ===================================================================== 4.8 */
L({
  id: '4.8', title: 'Permission-aware retrieval and freshness', minutes: 55, roles: ['fde', 'be'],
  tags: 'ACLs · tenant isolation · pre-filter vs post-filter · Postgres row-level security · incremental sync · deletes · staleness',
  mental: 'A RAG system must never show a user text they could not open in the source system, and should not answer from yesterday’s version of a policy. Carry permissions with every chunk, enforce them inside the search, and keep the index in sync with changes, including deletions and permission changes.',
  intro: `<p>This is where enterprise RAG projects are won or lost. A demo over public help pages is easy; a deployment over a company’s SharePoint, Google Drive or Confluence, where an HR document and an engineering wiki sit side by side with different audiences, is a security project. One leaked salary spreadsheet ends the pilot.</p>
  <p>The second half of the problem is freshness: documents change, get deleted and get re-shared every day, and the index must follow.</p>`,
  points: [
    'Capture each document’s ACL at ingestion (users and groups), and resolve the requesting user’s groups at query time from the identity provider.',
    '<b>Pre-filter</b>: only search chunks the user may read. <b>Post-filter</b> (search everything, drop forbidden results) loses recall and is one bug away from a leak.',
    'Enforce isolation in the data layer where possible: per-tenant collections, or database row-level security, not only in application code.',
    'Deny by default: a chunk with a missing or unknown ACL is not retrievable.',
    'Sync incrementally: watermarks or change feeds for edits, tombstones for deletions, and metadata-only updates when only permissions change.',
    'Prompt caches, semantic caches and logs also hold retrieved text: scope them by tenant and permission too.'
  ],
  concept: { title: 'The index must be as strict as the source', body: `<p>Your index is a copy of customer data. Every access rule of the source system has to hold on the copy, at query time, for every chunk, including when permissions changed five minutes ago. If you cannot guarantee that for a source, do not index it, or fetch permissions live at query time for that source.</p>` },
  walk: [
    { h: 'Filter inside the search', body: '<p>Pass the user’s groups into the vector query so that only permitted chunks are candidates.</p>', code: String.raw`groups = idp.groups_for(user)                     # from your identity provider, cached briefly
hits = client.query_points("chunks", query=qvec, limit=10, query_filter=models.Filter(must=[
    models.FieldCondition(key="tenant", match=models.MatchValue(value=user.tenant)),
    models.FieldCondition(key="acl", match=models.MatchAny(any=groups)),
])).points` },
    { h: 'Or let the database enforce it', body: '<p>Postgres row-level security attaches the rule to the table: every query, from any code path, is filtered. The Code tab runs it with pgvector.</p>' },
    { h: 'Sync changes, not snapshots', body: `<div class="tbl"><table><thead><tr><th>change in source</th><th>index action</th><th>re-embed?</th></tr></thead><tbody>
      <tr><td>document edited</td><td>re-chunk; replace changed chunks</td><td>changed chunks only</td></tr>
      <tr><td>document deleted</td><td>tombstone, delete chunks</td><td>no</td></tr>
      <tr><td>permissions changed</td><td>update ACL metadata on all its chunks</td><td>no</td></tr>
      <tr><td>moved or renamed</td><td>update url and path metadata</td><td>no (unless path is in the chunk header)</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A hotel key card system.</b> Your card opens your room and the gym, not other rooms, and the check is in the lock (the data layer), not in a guard’s memory. When you check out, the card stops working immediately (permission change), and when a room is renovated the old key is useless (freshness).</p>`,
  diagram: {
    title: 'Permission-aware retrieval',
    cols: [['user'], ['idp'], ['q'], ['idx', 'sync'], ['res']],
    nodes: [
      { id: 'user', label: 'User request', sub: 'token', tone: 'fde', info: 'Authenticated user with tenant and identity.' },
      { id: 'idp', label: 'Identity provider', sub: 'groups', info: 'Resolve groups (cached briefly) at query time.' },
      { id: 'q', label: 'Filtered query', sub: 'tenant + acl ∩ groups', tone: 'acc', info: 'Permissions are part of the search, not an afterthought.' },
      { id: 'idx', label: 'Index', sub: 'chunks + ACL metadata', tone: 'be', info: 'Each chunk carries tenant and ACL; RLS or filters enforce them.' },
      { id: 'sync', label: 'Sync worker', sub: 'edits · deletes · ACLs', info: 'Change feeds update content and permissions continuously.' },
      { id: 'res', label: 'Permitted chunks', sub: 'only', tone: 'ok', info: 'Results the user could open in the source system.' }
    ],
    edges: [{ a: 'user', b: 'idp', step: 1 }, { a: 'idp', b: 'q', step: 2 }, { a: 'q', b: 'idx', step: 3 }, { a: 'idx', b: 'res', step: 4 }, { a: 'sync', b: 'idx', dash: true, label: 'changes' }],
    steps: ['The user’s identity comes with the request.', 'Their groups are resolved from the identity provider.', 'The search runs with tenant and ACL filters inside it.', 'Only permitted chunks come back.'],
    caption: 'Permissions travel with the data and are enforced inside the search.'
  },
  illustrated: { title: 'Post-filtering leaks and loses', body: `<p>A user in group “engineering” asks about “bonus policy”. The top 5 by similarity are all HR-only documents.</p>
    <div class="tbl"><table><thead><tr><th>approach</th><th>result</th></tr></thead><tbody>
    <tr><td>search, then filter in app code</td><td>0 results after filtering; and if someone forgets the filter on a new endpoint, 5 HR documents leak</td></tr>
    <tr><td>pre-filter in the vector query</td><td>the top 5 engineering-visible documents about bonuses, such as the public benefits page</td></tr>
    <tr><td>row-level security in the database</td><td>same as pre-filter, and a forgotten filter in code cannot leak</td></tr></tbody></table></div>` },
  code: {
    title: 'Row-level security on a pgvector table', file: 'rls.sql', lang: 'sql', pg: true,
    intro: '<p>A chunks table with tenant and ACL columns, a row-level security policy that reads the tenant and groups from session settings, and a non-superuser role for the application (superusers bypass RLS). The same similarity query returns different rows for different users, and nothing for a user with no groups. In an application, set these with <code class="i">SET LOCAL</code> inside each request’s transaction so pooled connections never carry one user’s settings into another’s request.</p>',
    src: String.raw`SET search_path = lab, public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_app') THEN CREATE ROLE rag_app; END IF;
END $$;

CREATE TABLE chunks (
  id        serial PRIMARY KEY,
  tenant    text   NOT NULL,
  doc_id    text   NOT NULL,
  acl       text[] NOT NULL,
  body      text   NOT NULL,
  embedding vector(3) NOT NULL
);
INSERT INTO chunks (tenant, doc_id, acl, body, embedding) VALUES
 ('acme',   'benefits-page',  '{all-staff}',       'Bonuses are paid in March for the previous year.',    '[0.7, 0.6, 0.1]'),
 ('acme',   'bonus-bands-2026','{hr}',             'Bonus bands: L4 10%, L5 15%, L6 20%.',                '[0.75, 0.62, 0.05]'),
 ('acme',   'eng-oncall',     '{engineering}',     'On-call engineers get a weekly stipend.',             '[0.4, 0.8, 0.2]'),
 ('globex', 'globex-bonus',   '{all-staff}',       'Globex bonuses are paid quarterly.',                  '[0.72, 0.6, 0.1]');

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_and_acl ON chunks FOR SELECT USING (
  tenant = current_setting('app.tenant', true)
  AND acl && string_to_array(current_setting('app.groups', true), ',')
);
GRANT USAGE ON SCHEMA lab TO rag_app;
GRANT SELECT ON chunks TO rag_app;

SET ROLE rag_app;                                  -- the application's role, not a superuser

\echo '-- engineer at acme asks about bonuses'
SET app.tenant = 'acme'; SET app.groups = 'all-staff,engineering';
SELECT doc_id, round((1 - (embedding <=> '[0.74, 0.61, 0.08]'))::numeric, 3) AS sim
FROM chunks ORDER BY embedding <=> '[0.74, 0.61, 0.08]' LIMIT 3;

\echo '-- HR partner at acme, same query'
SET app.groups = 'all-staff,hr';
SELECT doc_id, round((1 - (embedding <=> '[0.74, 0.61, 0.08]'))::numeric, 3) AS sim
FROM chunks ORDER BY embedding <=> '[0.74, 0.61, 0.08]' LIMIT 3;

\echo '-- request with no groups resolved (deny by default)'
RESET app.groups;
SELECT count(*) AS visible_rows FROM chunks;
RESET ROLE;`
  },
  lab: {
    title: 'An incremental, permission-aware indexer', file: 'sync_lab.py', browser: true,
    scenario: `<p>You are syncing a customer’s wiki into the index every 10 minutes. Over one day the source changes: an edit, a deletion, a permission change on a sensitive page, and a new page. Build the sync with SQLite as the index store and prove three things: only changed content is re-embedded, deleted pages are gone, and a revoked user loses access on the next sync.</p>`,
    steps: ['Store chunks in SQLite with doc_id, content_hash, acl (comma-separated), updated_at, and a fake embedding.', 'Write <code class="i">sync(snapshot, watermark)</code>: process docs with <code class="i">updated_at &gt; watermark</code>; re-embed only if the content hash changed; update ACLs in place; delete docs missing from the snapshot’s id list (tombstones).', 'Write <code class="i">search(user_groups, query)</code> that filters by ACL in SQL before ranking.', 'Run sync for the morning and afternoon snapshots, printing embeddings computed and rows changed.', 'Assert that after the afternoon sync the contractor can no longer see the salary page.'],
    checks: ['Afternoon sync embeds only the edited page and the new page.', 'The deleted page returns no rows.', 'The contractor’s search excludes the salary page after the ACL change.'],
    hints: ['Use <code class="i">instr(\',\' || acl || \',\', \',\' || ? || \',\')</code> to test group membership in SQL, once per group.', 'A full id list from the source each sync detects deletions even without a change feed.'],
    starter: String.raw`import hashlib, sqlite3
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE chunks (doc_id TEXT PRIMARY KEY, body TEXT, content_hash TEXT, acl TEXT, updated_at TEXT, emb TEXT)")
stats = {"embedded": 0}
def embed(text):
    stats["embedded"] += 1
    return hashlib.md5(text.encode()).hexdigest()[:8]

morning = [
    {"id": "handbook", "body": "Expenses are reimbursed monthly.", "acl": "all-staff", "updated_at": "2026-10-24T08:00"},
    {"id": "salaries", "body": "Salary bands for 2026.", "acl": "hr,contractor-ops", "updated_at": "2026-10-24T08:00"},
    {"id": "old-vpn", "body": "Use the legacy VPN client.", "acl": "all-staff", "updated_at": "2026-10-24T08:00"},
]
afternoon = [
    {"id": "handbook", "body": "Expenses are reimbursed every two weeks.", "acl": "all-staff", "updated_at": "2026-10-24T14:00"},
    {"id": "salaries", "body": "Salary bands for 2026.", "acl": "hr", "updated_at": "2026-10-24T14:05"},
    {"id": "sso-guide", "body": "Sign in with Okta from today.", "acl": "all-staff", "updated_at": "2026-10-24T14:10"},
]   # old-vpn was deleted

def sync(snapshot, watermark):
    # TODO
    return watermark

def search(groups, query):
    # TODO
    return []`,
    solution: String.raw`import hashlib, sqlite3
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE chunks (doc_id TEXT PRIMARY KEY, body TEXT, content_hash TEXT, acl TEXT, updated_at TEXT, emb TEXT)")
stats = {"embedded": 0}
def embed(text):
    stats["embedded"] += 1
    return hashlib.md5(text.encode()).hexdigest()[:8]

morning = [
    {"id": "handbook", "body": "Expenses are reimbursed monthly.", "acl": "all-staff", "updated_at": "2026-10-24T08:00"},
    {"id": "salaries", "body": "Salary bands for 2026.", "acl": "hr,contractor-ops", "updated_at": "2026-10-24T08:00"},
    {"id": "old-vpn", "body": "Use the legacy VPN client.", "acl": "all-staff", "updated_at": "2026-10-24T08:00"},
]
afternoon = [
    {"id": "handbook", "body": "Expenses are reimbursed every two weeks.", "acl": "all-staff", "updated_at": "2026-10-24T14:00"},
    {"id": "salaries", "body": "Salary bands for 2026.", "acl": "hr", "updated_at": "2026-10-24T14:05"},
    {"id": "sso-guide", "body": "Sign in with Okta from today.", "acl": "all-staff", "updated_at": "2026-10-24T14:10"},
]   # old-vpn was deleted

def sync(snapshot, watermark):
    before = stats["embedded"]; changes = {"embedded": 0, "acl_only": 0, "deleted": 0}
    for d in snapshot:
        if d["updated_at"] <= watermark:
            continue
        h = hashlib.sha256(d["body"].encode()).hexdigest()
        row = db.execute("SELECT content_hash FROM chunks WHERE doc_id = ?", (d["id"],)).fetchone()
        if row and row[0] == h:                        # same text: metadata-only update, no embedding call
            db.execute("UPDATE chunks SET acl = ?, updated_at = ? WHERE doc_id = ?", (d["acl"], d["updated_at"], d["id"]))
            changes["acl_only"] += 1
        else:
            db.execute("INSERT OR REPLACE INTO chunks VALUES (?, ?, ?, ?, ?, ?)", (d["id"], d["body"], h, d["acl"], d["updated_at"], embed(d["body"])))
    live = {d["id"] for d in snapshot}
    for (doc_id,) in db.execute("SELECT doc_id FROM chunks").fetchall():
        if doc_id not in live:                         # tombstone: gone from the source
            db.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,)); changes["deleted"] += 1
    db.commit()
    changes["embedded"] = stats["embedded"] - before
    return max([watermark] + [d["updated_at"] for d in snapshot]), changes

def search(groups, query):
    if not groups:
        return []                                      # deny by default
    clause = " OR ".join(["instr(',' || acl || ',', ',' || ? || ',') > 0"] * len(groups))
    rows = db.execute(f"SELECT doc_id, body FROM chunks WHERE ({clause})", groups).fetchall()
    q = set(query.lower().split())
    return [d for d, body in sorted(rows, key=lambda r: -len(q & set(r[1].lower().split())))]

wm, ch = sync(morning, "")
print("morning   :", ch, "| contractor sees:", search(["all-staff", "contractor-ops"], "salary bands"))
wm, ch = sync(afternoon, wm)
print("afternoon :", ch, "| contractor sees:", search(["all-staff", "contractor-ops"], "salary bands"))
print("hr sees   :", search(["hr"], "salary bands"), "| old-vpn rows:", db.execute("SELECT count(*) FROM chunks WHERE doc_id = 'old-vpn'").fetchone()[0])
print("no groups :", search([], "salary"))
assert "salaries" not in search(["all-staff", "contractor-ops"], "salary bands")`
  },
  design: {
    lead: '<p>Permission-aware RAG is an access-control system with a search engine attached. Design it with security reviewers: where permissions come from, how fast changes propagate, where enforcement happens, and how you prove it.</p>',
    scale: [{ h: 'Group explosion', p: 'Users in hundreds of groups make filters large. Pre-compute effective principals per document, or use engines with efficient set filters; cache user groups for minutes, not hours.' }, { h: 'Freshness SLOs', p: 'Agree targets with the customer, for example content changes within 15 minutes and permission revocations within 5, and monitor sync lag per source.' }],
    fail: [{ h: 'Caches bypassing ACLs', p: 'A semantic cache keyed only by question can serve an HR answer to an engineer. Key caches by tenant and permission set (Phase 9.2).' }, { h: 'Connector blind spots', p: 'Some sources do not expose inherited or link-shared permissions via API. Detect unsupported cases and exclude those documents.' }],
    trade: [{ h: 'Index-time ACLs vs live checks', p: 'Index-time ACLs are fast but can be stale; live permission checks per result are exact but slow. Many systems combine both for sensitive sources.' }, { h: 'Collection per tenant vs shared', p: 'Separate collections isolate structurally and cost more to operate; shared collections with filters are efficient and need rigorous testing.' }],
    prompt: '<p>Design RAG over a 30,000-employee company’s Google Drive and Confluence with strict permission requirements and a security review.</p>',
    answer: '<ul><li>Connectors capture ACLs including group and inherited permissions; unsupported sharing modes excluded and reported.</li><li>Chunks carry tenant and effective principals; queries filter inside the engine; RLS where Postgres is the store.</li><li>Change feeds plus nightly full id reconciliation for deletions; revocation lag monitored with a 5-minute SLO.</li><li>Automated leak tests per release: synthetic users query for documents they must not see; audit logs of every retrieval.</li></ul>'
  },
  quiz: [
    { q: 'Why is post-filtering (search all, then drop forbidden results) risky?', o: ['It is slower to write', 'It loses recall and any endpoint that forgets the filter leaks data', 'Vector DBs forbid it', 'It breaks citations'], a: 1, why: 'Enforcement outside the search is easy to miss and returns too few results.' },
    { q: 'A document’s permissions changed but its text did not. What should the sync do?', o: ['Re-embed the document', 'Update the ACL metadata on its chunks without re-embedding', 'Nothing until the text changes', 'Delete the index'], a: 1, why: 'Permission changes are metadata updates and must apply quickly.' },
    { q: 'Why does the RLS demo switch to a non-superuser role?', o: ['For speed', 'Superusers bypass row-level security', 'pgvector needs it', 'To change the schema'], a: 1, why: 'RLS policies do not apply to superusers or table owners by default.' }
  ],
  interview: [
    { q: 'How do you make sure a RAG assistant never shows a user something they cannot access?', a: '<p>Capture ACLs at ingestion, resolve the user’s groups at request time, and enforce the filter inside the retrieval engine or with database row-level security, deny by default. Scope every cache and log the same way. Then prove it: automated leak tests with synthetic users each release, audit logs of retrieved chunk ids, and revocation-lag monitoring.</p>' },
    { q: 'How do you keep a RAG index fresh without re-indexing everything nightly?', a: '<p>Incremental sync: change feeds or updated-at watermarks per source, content hashes so only changed chunks are re-embedded, metadata-only updates for permission and path changes, and a periodic reconciliation of the full id list to catch deletions. I agree freshness targets with the customer and alert on sync lag.</p>' }
  ]
});
})();
