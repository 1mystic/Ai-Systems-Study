/* Phase 12 · System design cases (part 2) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 12.4 */
L({
  id: '12.4', title: 'Deep-research agent', minutes: 60, roles: ['be', 'fde'],
  tags: 'orchestrator-workers · query planning · parallel search · source quality · citation verification · budgets and stopping · long-running jobs · report synthesis',
  mental: 'A deep-research agent is a long-running, parallel job: a lead agent plans sub-questions, worker agents search and read in parallel with their own context windows, findings are compressed with sources, and a synthesis step writes a cited report that is checked claim by claim. Budgets, checkpoints and verification turn it from a demo into a product.',
  intro: `<p>Research features in assistants (and internal “analyst” agents at enterprises) run for minutes, issue dozens to hundreds of searches, read many documents and produce long reports. Published accounts of such systems describe an orchestrator-worker design where parallel sub-agents explore with separate context windows, at a large multiple of the tokens of a chat turn. The design problems are planning, parallelism, cost control, source quality, citation accuracy, and running as a durable background job.</p>`,
  points: [
    'Clarify scope first (one or two questions back to the user) to avoid expensive research on the wrong question.',
    'Lead agent plans sub-questions; workers research in parallel, each with a fresh context and a token or step budget.',
    'Workers return compressed findings with source ids and quotes, not raw pages, protecting the lead’s context (6.x).',
    'Source quality: prefer primary and recent sources; record publication dates; deduplicate syndicated content.',
    'Synthesis writes the report; a verification pass checks every claim against its cited source and removes or fixes unsupported ones.',
    'Run as a durable job (queue, checkpoints, resumability, progress events), with per-job budgets and stop conditions.'
  ],
  concept: { title: 'An editor and a team of researchers', body: `<p>A newspaper editor splits a big story into angles, sends researchers out in parallel, and asks each for a short memo with sources rather than their whole notebook. The editor writes the piece from the memos, then a fact-checker verifies every claim against the cited sources before it is published.</p>` },
  walk: [
    { h: 'Plan, fan out, compress', body: '<p>The lead produces a plan with sub-questions, each with a budget. Workers run concurrently (bounded by a semaphore and rate limits), and each returns a structured memo.</p>', code: String.raw`class Memo(BaseModel):
    question: str
    findings: list[Finding]          # claim, source_id, quote, date
    open_questions: list[str]
    tokens_used: int

plan = await lead.plan(user_question)                       # 3-8 sub-questions with budgets
memos = await gather_bounded([worker.research(q, budget=q.budget) for q in plan], limit=5)
report = await lead.synthesize(user_question, memos)
report = await verify_citations(report, sources)            # claim-by-claim check` },
    { h: 'Budgets and stopping', body: '<p>Set budgets per job (tokens, searches, wall time) and per worker. Stop when the plan is answered with sufficient sources, when new searches stop adding new sources (diminishing returns), or when the budget is reached; report what remains open rather than silently stopping.</p>' },
    { h: 'Durable execution', body: '<p>A research job can take 10 minutes or more. Run it as a background job with a queue, checkpoint after each worker completes (LangGraph checkpointers or a workflow engine), stream progress events to the UI, and allow resume after failures without redoing finished workers.</p>' }
  ],
  analogy: `<p><b>A consultancy project in miniature.</b> The partner scopes the question with the client, managers split it into workstreams, analysts research in parallel and write short memos, the partner synthesises, and quality control checks every number before the deck goes out.</p>`,
  diagram: {
    title: 'Deep-research agent',
    cols: [['user'], ['clarify'], ['lead'], ['w1', 'w2', 'w3'], ['memos'], ['synth'], ['verify']],
    nodes: [
      { id: 'user', label: 'Research question', sub: 'user', tone: 'fde', info: 'Possibly vague.' },
      { id: 'clarify', label: 'Clarify scope', sub: '1–2 questions', tone: 'acc', info: 'Avoid researching the wrong thing.' },
      { id: 'lead', label: 'Lead agent', sub: 'plan · budgets', tone: 'be', info: 'Sub-questions with budgets; durable job.' },
      { id: 'w1', label: 'Worker 1', sub: 'search · read', tone: 'warn', info: 'Own context window and budget.' },
      { id: 'w2', label: 'Worker 2', sub: 'search · read', tone: 'warn', info: 'Runs in parallel.' },
      { id: 'w3', label: 'Worker 3', sub: 'search · read', tone: 'warn', info: 'Bounded concurrency.' },
      { id: 'memos', label: 'Memos', sub: 'claims + sources', tone: 'acc', info: 'Compressed findings with quotes and dates.' },
      { id: 'synth', label: 'Synthesis', sub: 'report draft', tone: 'be', info: 'Structured report with citations.' },
      { id: 'verify', label: 'Citation check', sub: 'claim vs source', tone: 'ok', info: 'Remove or fix unsupported claims.' }
    ],
    edges: [{ a: 'user', b: 'clarify' }, { a: 'clarify', b: 'lead' }, { a: 'lead', b: 'w1' }, { a: 'lead', b: 'w2' }, { a: 'lead', b: 'w3' }, { a: 'w1', b: 'memos' }, { a: 'w2', b: 'memos' }, { a: 'w3', b: 'memos' }, { a: 'memos', b: 'synth' }, { a: 'synth', b: 'verify' }, { a: 'memos', b: 'lead', dash: true, bend: 70, label: 'gaps' }],
    caption: 'Plan, research in parallel, compress, synthesise, verify.'
  },
  illustrated: { title: 'Where the tokens go in one job', body: `<div class="tbl"><table><thead><tr><th>stage</th><th>calls</th><th>tokens (illustrative)</th></tr></thead><tbody>
    <tr><td>clarify + plan</td><td class="n">2</td><td class="n">15k</td></tr>
    <tr><td>5 workers × 8 searches, reading pages</td><td class="n">60</td><td class="n">900k</td></tr>
    <tr><td>synthesis</td><td class="n">2</td><td class="n">80k</td></tr>
    <tr><td>citation verification (40 claims)</td><td class="n">40</td><td class="n">160k</td></tr>
    <tr><td><b>total</b></td><td class="n">~104</td><td class="n">~1.2M</td></tr></tbody></table><p>Compared with a chat turn of perhaps 5k tokens, a research job is two orders of magnitude more expensive. That justifies clarifying scope first, using smaller models for workers where quality allows, and caching.</p></div>` },
  code: {
    title: 'Orchestrator-workers research with budgets, memos and citation checks', file: 'research.py', browser: true,
    intro: '<p>A lead plans sub-questions; workers run concurrently with asyncio and a semaphore against a small search corpus (standing in for web search), each within a search budget; they return memos with quotes and dates. Synthesis writes claims with source ids, and a verifier checks each claim’s key numbers and terms against the cited text, dropping unsupported ones. Planning and writing are rule-based stand-ins so the run is deterministic; in production each is a model call.</p>',
    src: String.raw`import asyncio, re
from dataclasses import dataclass, field

CORPUS = {
    "s1": ("2026-03", "Report: enterprise AI adoption", "In a 2026 survey of 1,200 firms, 64% had at least one generative AI application in production."),
    "s2": ("2025-11", "Blog: AI budgets", "Average generative AI budgets grew 38% year over year according to the vendor's customer base."),
    "s3": ("2026-05", "Analyst note: agents", "Only 12% of surveyed enterprises run autonomous agents in production; most use assisted workflows."),
    "s4": ("2024-02", "Old survey", "In 2023, 23% of firms had a generative AI application in production."),
    "s5": ("2026-04", "Regulation update", "The EU AI Act's obligations for general-purpose AI models have applied since August 2025."),
    "s6": ("2026-05", "Syndicated copy", "In a 2026 survey of 1,200 firms, 64% had at least one generative AI application in production."),
}
def search(q, k=3):
    words = set(re.findall(r"[a-z]+", q.lower()))
    scored = [(len(words & set(re.findall(r"[a-z]+", t.lower() + " " + body.lower()))), sid) for sid, (_, t, body) in CORPUS.items()]
    scored.sort(key=lambda x: (-x[0], CORPUS[x[1]][0]))          # ties: earliest copy first (originals before syndication)
    return [sid for s, sid in scored[:k] if s > 1]

@dataclass
class Memo:
    question: str
    findings: list = field(default_factory=list)      # (claim, source_id, date)
    searches: int = 0

async def worker(q, budget, sem, seen_text):
    memo = Memo(q)
    async with sem:
        for attempt in range(budget):
            await asyncio.sleep(0.01)                    # network latency stand-in
            memo.searches += 1
            for sid in search(q + (" production survey" if attempt else "")):
                date, title, body = CORPUS[sid]
                if body in seen_text: continue           # dedupe syndicated copies
                seen_text.add(body)
                memo.findings.append((body, sid, date))
            if len(memo.findings) >= 2: break            # enough evidence for this sub-question
    return memo

def plan(question):
    return [("How many enterprises run generative AI in production?", 2), ("How common are autonomous agents in enterprises?", 2),
            ("How fast did generative AI budgets grow?", 1), ("Which EU AI Act obligations apply to general-purpose AI models?", 1)]

def synthesize(memos):
    claims = []
    for m in memos:
        for body, sid, date in sorted(m.findings, key=lambda f: f[2], reverse=True):
            if date < "2025-01": continue                 # prefer recent sources
            claims.append((body.split(";")[0].rstrip("."), sid))
    claims.append(("Half of enterprises run autonomous agents in production", "s3"))   # a hallucinated claim
    return claims

QUANT = {"half", "most", "majority", "all", "none", "double", "doubled", "tripled"}
def verify(claim, sid):
    text = CORPUS[sid][2].lower()
    nums = re.findall(r"\d[\d,.]*%?", claim) + [w for w in re.findall(r"[a-z]+", claim.lower()) if w in QUANT]
    keyterms = [w for w in re.findall(r"[a-z]{5,}", claim.lower())]
    return all(n.lower() in text for n in nums) and sum(w in text for w in keyterms) / max(1, len(keyterms)) >= 0.6

async def research(question, max_parallel=3):
    sem, seen = asyncio.Semaphore(max_parallel), set()
    memos = await asyncio.gather(*(worker(q, b, sem, seen) for q, b in plan(question)))
    claims = synthesize(memos)
    kept = [(c, s) for c, s in claims if verify(c, s)]
    dropped = [(c, s) for c, s in claims if not verify(c, s)]
    print(f"plan: {len(memos)} sub-questions | searches used: {sum(m.searches for m in memos)} | sources: {sorted({f[1] for m in memos for f in m.findings})}")
    print("REPORT")
    for c, s in kept: print(f"  - {c}. [{s}, {CORPUS[s][0]}]")
    print("removed by citation check:", dropped)
    print("skipped as outdated or duplicate: s4 (2024), s6 (syndicated copy of s1)")

asyncio.run(research("State of enterprise generative AI adoption in 2026"))`
  },
  lab: {
    title: 'Diminishing returns: when should a worker stop searching?', file: 'stopping_lab.py', browser: true,
    scenario: `<p>Workers waste most of their budget on searches that return sources they have already seen. Using a simulated search engine where each query returns sources from a fixed pool with popularity skew, compare stopping rules for a worker with a cap of 20 searches: always use all 20; stop after 2 consecutive searches with no new source; stop when the estimated unseen share (Good–Turing: singletons / total observations) falls below 15%. Measure coverage of the source pool and searches used, and choose a rule.</p>`,
    steps: ['Pool of 40 relevant sources with Zipf-like popularity; each search returns 5 sources sampled by popularity.', 'Simulate 2,000 workers per rule.', 'Coverage = distinct sources found / 40, and coverage of the 10 most important (rarest but highest value) sources.', 'Report mean searches, coverage and cost per covered source.', 'Recommend a rule with reasons.'],
    checks: ['The fixed 20-search budget uses the most searches.', 'Adaptive rules cut searches, and the coverage cost is quantified.', 'The recommendation mentions the trade-off for rare sources.'],
    hints: ['Good–Turing estimates the probability that the next draw is new as (number of sources seen exactly once) / (total draws).', 'Rare sources are the ones popularity-skewed search keeps missing; query diversification helps more than more of the same query.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(12)
POOL = 40
pop = 1 / np.arange(1, POOL + 1) ** 1.1; pop /= pop.sum()
important = set(range(30, 40))          # valuable but rarely surfaced sources
def one_search():
    return rng.choice(POOL, size=5, replace=False, p=pop)
# TODO: rules, simulation, report`,
    solution: String.raw`import numpy as np
from collections import Counter
rng = np.random.default_rng(12)
POOL = 40
pop = 1 / np.arange(1, POOL + 1) ** 1.1; pop /= pop.sum()
important = set(range(30, 40))
def one_search():
    return rng.choice(POOL, size=5, replace=False, p=pop)

def run(rule, max_searches=20):
    counts, no_new, n = Counter(), 0, 0
    while n < max_searches:
        before = len(counts)
        counts.update(one_search().tolist()); n += 1
        no_new = no_new + 1 if len(counts) == before else 0
        if rule == "fixed20" and n >= 20: break
        if rule == "two_dry" and no_new >= 2: break
        if rule == "good_turing" and n >= 2:
            singletons = sum(1 for c in counts.values() if c == 1)
            if singletons / sum(counts.values()) < 0.15: break
    return n, len(counts) / POOL, len(set(counts) & important) / len(important)

print(f"{'rule':<12} {'searches':>8} {'coverage':>9} {'important':>10} {'searches per source':>20}")
res = {}
for rule in ("fixed20", "two_dry", "good_turing"):
    r = np.array([run(rule) for _ in range(2000)])
    s, cov, imp = res[rule] = r.mean(axis=0)
    print(f"{rule:<12} {s:8.1f} {cov:9.1%} {imp:10.1%} {s / (cov * POOL):20.2f}")
f, g = res["fixed20"], res["good_turing"]
print(f"""
Good-Turing stopping saves {1 - g[0] / f[0]:.0%} of searches for {100 * (f[1] - g[1]):.0f} points less coverage,
but loses {100 * (f[2] - g[2]):.0f} points on the rare, important sources: more of the same query mostly re-finds popular pages.
Recommendation: stop early on diminishing returns, and spend the saved budget on diversified queries
(different phrasings, primary-source sites, other languages), which is what reaches the rare sources.""")`
  },
  design: {
    lead: '<p>Deep research is an expensive, long-running agentic workload. Its design priorities: clarify before spending, parallelise with isolation, compress findings, verify citations, control budgets, and run durably with progress visible to the user.</p>',
    scale: [{ h: 'Concurrency and rate limits', p: 'Hundreds of concurrent jobs each fanning out to many searches and model calls need global rate limiting, per-tenant quotas and queueing (1.x, 9.10).' }, { h: 'Caching', p: 'Cache search results and fetched pages across jobs (with freshness limits) and prompt-cache stable instructions; popular topics repeat.' }],
    fail: [{ h: 'Citation errors', p: 'Reports that cite sources that do not support claims destroy trust. Verify every claim; show quotes on hover.' }, { h: 'Runaway jobs', p: 'Agents that keep searching burn budgets. Hard caps on tokens, searches and time, plus diminishing-returns stopping.' }],
    trade: [{ h: 'Depth vs cost and time', p: 'More workers and searches improve coverage with diminishing returns; offer depth levels to users and default to the smallest that answers the question.' }, { h: 'Single agent vs multi-agent', p: 'Multi-agent parallelism helps breadth-first research; for narrow questions a single agent is cheaper and simpler.' }],
    prompt: '<p>Design a research assistant for a consulting firm’s analysts that searches the web and internal reports and produces cited briefs in under 10 minutes.</p>',
    answer: '<ul><li>Clarify scope; plan sub-questions; parallel workers over web search and permission-aware internal retrieval, each budgeted.</li><li>Durable job on a queue with checkpoints and streamed progress; resumable.</li><li>Memos with quotes, dates and source types; synthesis into the firm’s brief template; claim-level citation verification.</li><li>Budgets per job and tenant, caching, evaluations on a set of past briefs (coverage, citation precision, analyst ratings).</li></ul>'
  },
  quiz: [
    { q: 'Why do workers return memos rather than raw pages?', o: ['Formatting', 'To keep the lead agent’s context small and focused', 'Pages are illegal', 'Speed of search'], a: 1, why: 'Compression protects context and cost.' },
    { q: 'What should happen to a claim whose cited source does not support it?', o: ['Keep it', 'Remove or fix it in a verification pass', 'Add more citations', 'Bold it'], a: 1, why: 'Citation precision is a core quality metric.' },
    { q: 'Why run research as a durable background job?', o: ['Fashion', 'Long runtimes need checkpoints, resume, progress and isolation from request timeouts', 'Cheaper tokens', 'Required by search APIs'], a: 1, why: 'Minutes-long work needs job semantics.' }
  ],
  interview: [
    { q: 'Design a deep-research feature for an AI assistant.', a: '<p>Clarify scope with the user; a lead agent plans sub-questions with budgets; parallel workers with separate contexts search and read, returning compressed memos with quotes and dates; synthesis writes a structured report; a verifier checks each claim against its source. It runs as a durable job with checkpoints, progress events, caching, budgets and stop rules, and is evaluated on coverage, citation precision, cost and time.</p>' },
    { q: 'How do you control the cost of multi-agent research?', a: '<p>Clarify before researching; cap tokens, searches and time per job and worker; stop on diminishing returns; use smaller models for workers where evals allow; compress findings; cache searches, pages and prompts; and offer depth levels so expensive runs are opt-in.</p>' }
  ]
});

/* ===================================================================== 12.5 */
L({
  id: '12.5', title: 'Financial document processing', minutes: 60, roles: ['fde', 'be'],
  tags: 'invoices and statements · OCR and layout · schema-bound extraction · Decimal arithmetic · cross-field validation · confidence routing · three-way match · audit trails',
  mental: 'Financial document processing is extraction under accounting rules: every number is validated against arithmetic and business constraints, low-confidence or inconsistent documents go to humans, and every value keeps a link to where it came from on the page. Straight-through processing rate at a guaranteed error rate is the metric.',
  intro: `<p>Accounts payable, expense audit, loan underwriting and KYC all process large volumes of semi-structured documents: invoices, receipts, bank statements, pay slips. Errors cost real money, and auditors need to know where each value came from. The design combines document parsing (4.1), schema-bound extraction with models (3.3), deterministic validation, human review queues and reconciliation against systems of record.</p>`,
  points: [
    'Pipeline: ingest → classify document type → parse (OCR and layout for scans) → extract to a schema → validate → route → reconcile → post to the ERP.',
    'Use <code class="i">Decimal</code> for money, never floats; carry currency explicitly.',
    'Validate: line items sum to subtotal, subtotal plus tax equals total, tax rates allowed for the country, dates plausible, supplier known, IBAN checksum valid.',
    'Every extracted field stores provenance: page, bounding box or text span, and extraction confidence.',
    'Route by field-level confidence and validation results: straight-through, review specific fields, or full manual.',
    'Three-way match (invoice vs purchase order vs goods receipt) with tolerances catches overbilling.'
  ],
  concept: { title: 'A careful bookkeeper with a calculator', body: `<p>A good bookkeeper reads the invoice, but trusts the calculator: lines must add up, tax must match the rate, the supplier must be on the approved list, and the order and delivery note must agree. Anything that does not add up goes into a tray for a second look, with a sticky note saying exactly what is wrong.</p>` },
  walk: [
    { h: 'Schema with provenance', body: '<p>Extraction targets a schema where each value carries where it came from and how confident the extractor was.</p>', code: String.raw`class Money(BaseModel):
    amount: Decimal
    currency: Literal["EUR", "USD", "GBP", "INR"]

class Field_(BaseModel, Generic[T]):
    value: T
    confidence: float
    page: int
    span: tuple[int, int]            # character offsets or a bounding box

class Invoice(BaseModel):
    supplier_vat_id: Field_[str]
    invoice_number: Field_[str]
    issue_date: Field_[date]
    lines: list[Line]
    subtotal: Field_[Money]; tax: Field_[Money]; total: Field_[Money]` },
    { h: 'Validate deterministically', body: '<p>Models extract; code checks. Arithmetic, tax rules, master data lookups (supplier, PO) and checksums catch most extraction errors, and they produce precise reasons for reviewers. The Code tab shows the validator.</p>' },
    { h: 'Review UI', body: '<p>Reviewers see the document with highlighted spans and only the failing or low-confidence fields; corrections are stored as labelled data for evals and future fine-tuning (13.x).</p>' }
  ],
  analogy: `<p><b>Airport baggage screening.</b> Machines scan every bag (automated extraction and checks); most pass straight through; bags that look odd go to a human with the exact area highlighted on screen. Every decision is logged.</p>`,
  diagram: {
    title: 'Invoice processing pipeline',
    cols: [['in'], ['cls'], ['parse'], ['ext'], ['val'], ['stp', 'rev'], ['match'], ['erp']],
    nodes: [
      { id: 'in', label: 'Inbox / upload', sub: 'PDF · scan · e-invoice', tone: 'fde', info: 'Email, portal, EDI.' },
      { id: 'cls', label: 'Classify', sub: 'invoice · credit note · other', tone: 'acc', info: 'Route by document type.' },
      { id: 'parse', label: 'Parse', sub: 'OCR · layout · tables', tone: 'acc', info: 'Structured e-invoices skip OCR.' },
      { id: 'ext', label: 'Extract', sub: 'schema + provenance', tone: 'warn', info: 'Model with structured outputs; confidence per field.' },
      { id: 'val', label: 'Validate', sub: 'arithmetic · tax · master data', tone: 'bad', info: 'Deterministic rules with reasons.' },
      { id: 'stp', label: 'Straight-through', sub: 'all checks pass', tone: 'ok', info: 'No human touch.' },
      { id: 'rev', label: 'Review queue', sub: 'only failing fields', tone: 'fde', info: 'Corrections become labels.' },
      { id: 'match', label: '3-way match', sub: 'PO · receipt · invoice', tone: 'be', info: 'Tolerances on price and quantity.' },
      { id: 'erp', label: 'Post to ERP', sub: 'audit trail', tone: 'ok', info: 'Every value linked to its source.' }
    ],
    edges: [{ a: 'in', b: 'cls' }, { a: 'cls', b: 'parse' }, { a: 'parse', b: 'ext' }, { a: 'ext', b: 'val' }, { a: 'val', b: 'stp' }, { a: 'val', b: 'rev' }, { a: 'stp', b: 'match' }, { a: 'rev', b: 'match' }, { a: 'match', b: 'erp' }],
    caption: 'Models extract, code validates, people review only what fails.'
  },
  illustrated: { title: 'What validation catches', body: `<div class="tbl"><table><thead><tr><th>check</th><th>catches</th></tr></thead><tbody>
    <tr><td>lines sum to subtotal</td><td>missed or duplicated line, misread digit</td></tr>
    <tr><td>subtotal + tax = total, rate allowed</td><td>wrong tax extraction, invalid rate</td></tr>
    <tr><td>supplier VAT id in master data</td><td>unknown supplier, fraud attempts</td></tr>
    <tr><td>IBAN checksum and matches supplier record</td><td>payment diversion fraud</td></tr>
    <tr><td>invoice number not already paid</td><td>duplicate payments</td></tr>
    <tr><td>3-way match within tolerance</td><td>overbilling, partial deliveries</td></tr></tbody></table></div>` },
  code: {
    title: 'Extraction validation and routing with Decimal and provenance', file: 'invoices.py', browser: true,
    intro: '<p>Pydantic models with <code class="i">Decimal</code> money and per-field confidence; a validator for arithmetic, tax rates, supplier master data, IBAN checksum (ISO 13616 mod 97) and duplicates; and routing to straight-through, field review or manual. Five extracted invoices (as a model would return them) exercise each path.</p>',
    src: String.raw`from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel

class F(BaseModel):
    value: str
    confidence: float
    page: int = 1

class Line(BaseModel):
    description: str; qty: Decimal; unit_price: Decimal; amount: Decimal

class Invoice(BaseModel):
    supplier_vat: F; number: F; issue_date: F; iban: F; currency: str
    lines: list[Line]; subtotal: F; tax_rate: F; tax: F; total: F

SUPPLIERS = {"DE811907980": {"name": "Muster GmbH", "iban": "DE89370400440532013000"}, "FR40303265045": {"name": "Exemple SA", "iban": "FR1420041010050500013M02606"}}
ALLOWED_RATES = {"DE": {Decimal("0.19"), Decimal("0.07")}, "FR": {Decimal("0.20"), Decimal("0.10"), Decimal("0.055")}}
PAID = {("DE811907980", "2026-1187")}
C = lambda x: Decimal(x).quantize(Decimal("0.01"), ROUND_HALF_UP)

def iban_ok(iban):
    s = iban[4:] + iban[:4]
    return int("".join(str(int(ch, 36)) for ch in s)) % 97 == 1

def validate(inv: Invoice):
    issues = []
    lines_sum = sum((l.amount for l in inv.lines), Decimal("0"))
    for l in inv.lines:
        if C(l.qty * l.unit_price) != C(l.amount): issues.append(("lines", f"{l.description}: {l.qty} x {l.unit_price} != {l.amount}"))
    if C(lines_sum) != C(inv.subtotal.value): issues.append(("subtotal", f"lines sum {C(lines_sum)} != subtotal {inv.subtotal.value}"))
    rate = Decimal(inv.tax_rate.value)
    if rate not in ALLOWED_RATES.get(inv.supplier_vat.value[:2], set()): issues.append(("tax_rate", f"rate {rate} not allowed for {inv.supplier_vat.value[:2]}"))
    if C(Decimal(inv.subtotal.value) * rate) != C(inv.tax.value): issues.append(("tax", f"{inv.subtotal.value} x {rate} != {inv.tax.value}"))
    if C(Decimal(inv.subtotal.value) + Decimal(inv.tax.value)) != C(inv.total.value): issues.append(("total", "subtotal + tax != total"))
    sup = SUPPLIERS.get(inv.supplier_vat.value)
    if not sup: issues.append(("supplier_vat", "unknown supplier"))
    if not iban_ok(inv.iban.value): issues.append(("iban", "checksum failed"))
    elif sup and inv.iban.value != sup["iban"]: issues.append(("iban", "differs from supplier master data: possible payment diversion"))
    if (inv.supplier_vat.value, inv.number.value) in PAID: issues.append(("number", "already paid"))
    low = [k for k in ("supplier_vat", "number", "issue_date", "iban", "subtotal", "tax", "total") if getattr(inv, k).confidence < 0.85]
    return issues, low

def route(inv):
    issues, low = validate(inv)
    hard = {"supplier_vat", "iban", "number"}
    if any(f in hard for f, _ in issues): mode = "manual (risk)"
    elif issues or low: mode = "review fields: " + ", ".join(sorted({f for f, _ in issues} | set(low)))
    else: mode = "straight-through"
    return mode, issues

def make(number="2026-2201", vat="DE811907980", iban="DE89370400440532013000", lines=(("Licences", "10", "45.00", "450.00"), ("Support", "1", "120.00", "120.00")),
         subtotal="570.00", rate="0.19", tax="108.30", total="678.30", conf=0.97):
    f = lambda v, c=conf: F(value=v, confidence=c)
    return Invoice(supplier_vat=f(vat), number=f(number), issue_date=f("2026-10-12"), iban=f(iban), currency="EUR",
                   lines=[Line(description=d, qty=Decimal(q), unit_price=Decimal(u), amount=Decimal(a)) for d, q, u, a in lines],
                   subtotal=f(subtotal), tax_rate=f(rate), tax=f(tax), total=f(total))

cases = {"clean": make(), "misread digit": make(subtotal="510.00", total="618.30", tax="96.90"),
         "low confidence": make(conf=0.78), "changed bank details": make(iban="GB82WEST12345698765432"),
         "duplicate": make(number="2026-1187"), "bad tax rate": make(rate="0.16", tax="91.20", total="661.20")}
for name, inv in cases.items():
    mode, issues = route(inv)
    print(f"{name:<22} -> {mode}")
    for f, why in issues: print(f"{'':<25}{f}: {why}")`
  },
  lab: {
    title: 'Three-way match with tolerances and an exception report', file: 'threeway_lab.py', browser: true,
    scenario: `<p>After extraction, invoices must be matched to purchase orders (what was ordered, at what price) and goods receipts (what was delivered). Policy: unit price may exceed the PO by at most 2%; invoiced quantity must not exceed received quantity; total invoice may exceed PO value by at most €50 for freight. Implement the match per line and per invoice using Decimal, classify each invoice as matched, matched within tolerance, or exception with reasons, and compute the straight-through rate and the value held for review.</p>`,
    steps: ['Tables (dicts): POs with lines (sku, qty, unit_price), receipts (sku, qty received), invoices with lines.', 'Match invoice lines to PO lines by SKU; flag unknown SKUs.', 'Apply price, quantity and total tolerances; collect reasons.', 'Classify invoices and compute STP rate and value on hold.', 'Print an exception report sorted by value.'],
    checks: ['All arithmetic uses Decimal.', 'Partial deliveries are exceptions only when invoiced quantity exceeds received.', 'The report lists reasons per invoice.'],
    hints: ['Tolerances belong in config so finance can tune them (10.1).', 'Freight lines often have no PO line; treat them under the total tolerance.'],
    starter: String.raw`from decimal import Decimal as D
POS = {"PO-1": {"A": (D("10"), D("45.00")), "B": (D("2"), D("120.00"))}, "PO-2": {"C": (D("100"), D("3.10"))}, "PO-3": {"D": (D("5"), D("800.00"))}}
RECEIPTS = {"PO-1": {"A": D("10"), "B": D("2")}, "PO-2": {"C": D("60")}, "PO-3": {"D": D("5")}}
INVOICES = [
  ("INV-11", "PO-1", [("A", D("10"), D("45.00")), ("B", D("2"), D("120.00")), ("FREIGHT", D("1"), D("35.00"))]),
  ("INV-12", "PO-2", [("C", D("60"), D("3.15"))]),
  ("INV-13", "PO-2", [("C", D("100"), D("3.10"))]),
  ("INV-14", "PO-3", [("D", D("5"), D("840.00"))]),
  ("INV-15", "PO-1", [("A", D("10"), D("45.00")), ("Z", D("1"), D("99.00"))]),
]
PRICE_TOL, TOTAL_TOL = D("0.02"), D("50.00")
# TODO`,
    solution: String.raw`from decimal import Decimal as D
POS = {"PO-1": {"A": (D("10"), D("45.00")), "B": (D("2"), D("120.00"))}, "PO-2": {"C": (D("100"), D("3.10"))}, "PO-3": {"D": (D("5"), D("800.00"))}}
RECEIPTS = {"PO-1": {"A": D("10"), "B": D("2")}, "PO-2": {"C": D("60")}, "PO-3": {"D": D("5")}}
INVOICES = [
  ("INV-11", "PO-1", [("A", D("10"), D("45.00")), ("B", D("2"), D("120.00")), ("FREIGHT", D("1"), D("35.00"))]),
  ("INV-12", "PO-2", [("C", D("60"), D("3.15"))]),
  ("INV-13", "PO-2", [("C", D("100"), D("3.10"))]),
  ("INV-14", "PO-3", [("D", D("5"), D("840.00"))]),
  ("INV-15", "PO-1", [("A", D("10"), D("45.00")), ("Z", D("1"), D("99.00"))]),
]
PRICE_TOL, TOTAL_TOL = D("0.02"), D("50.00")

def match(inv_id, po_id, lines):
    po, rec = POS[po_id], RECEIPTS[po_id]
    reasons, within = [], []
    inv_total = sum((q * p for _, q, p in lines), D("0"))
    po_value = sum((po[s][0] * po[s][1] for s, _, _ in lines if s in po), D("0"))
    for sku, qty, price in lines:
        if sku == "FREIGHT": continue
        if sku not in po:
            reasons.append(f"{sku}: not on {po_id}"); continue
        po_qty, po_price = po[sku]
        if qty > rec.get(sku, D("0")):
            reasons.append(f"{sku}: invoiced {qty} > received {rec.get(sku, D('0'))}")
        diff = (price - po_price) / po_price
        if diff > PRICE_TOL: reasons.append(f"{sku}: price {price} is {diff:.1%} above PO {po_price}")
        elif diff > 0: within.append(f"{sku}: price +{diff:.1%}")
    extra = inv_total - po_value
    if extra > TOTAL_TOL: reasons.append(f"total {inv_total} exceeds PO value {po_value} by {extra}")
    elif extra > 0: within.append(f"total +{extra} (freight)")
    status = "exception" if reasons else ("matched within tolerance" if within else "matched")
    return status, reasons or within, inv_total

rows = [(inv, *match(inv, po, lines)) for inv, po, lines in INVOICES]
stp = [r for r in rows if r[1] != "exception"]
print(f"straight-through: {len(stp)}/{len(rows)} invoices ({len(stp)/len(rows):.0%}), value on hold: EUR {sum(r[3] for r in rows if r[1] == 'exception')}")
for inv, status, notes, total in sorted(rows, key=lambda r: -r[3]):
    print(f"{inv}  EUR {total:>9}  {status:<26} {'; '.join(notes)}")`
  },
  design: {
    lead: '<p>Financial document AI is judged by straight-through rate at a guaranteed error rate, plus auditability. Combine model extraction with deterministic validation, precise review routing, reconciliation against systems of record and complete provenance.</p>',
    scale: [{ h: 'Volume and peaks', p: 'Month-end peaks of several times normal volume: queue-based processing with batch model APIs where latency allows, autoscaled OCR workers, and priority for due-soon invoices.' }, { h: 'Supplier variety', p: 'Thousands of layouts: model-based extraction generalises; per-supplier hints (learned from corrections) improve accuracy for frequent suppliers.' }],
    fail: [{ h: 'Payment diversion fraud', p: 'Changed bank details on otherwise valid invoices are a common fraud. Compare with master data and require out-of-band verification for changes.' }, { h: 'Float arithmetic', p: 'Binary floats produce cent errors that break reconciliations. Use Decimal end to end.' }],
    trade: [{ h: 'Automation rate vs error rate', p: 'Raising confidence thresholds lowers errors and increases review work; set thresholds from measured error costs per field.' }, { h: 'E-invoices vs extraction', p: 'Structured e-invoicing (mandated in more countries over time) removes extraction for those documents; keep extraction for the long tail.' }],
    prompt: '<p>Design accounts-payable automation for a company receiving 50,000 supplier invoices a month in 12 countries.</p>',
    answer: '<ul><li>Ingest from email, portal and e-invoicing networks; classify; OCR and layout only for non-structured documents.</li><li>Schema-bound extraction with provenance and confidence; deterministic validation (arithmetic, country tax rules, master data, IBAN, duplicates).</li><li>Routing: straight-through, field review, manual; three-way match with configured tolerances; post to ERP with audit trail.</li><li>Metrics: STP rate, field accuracy from audits, exception reasons, cost per invoice; corrections feed evals; fraud checks on bank detail changes.</li></ul>'
  },
  quiz: [
    { q: 'Why use Decimal for money?', o: ['It is faster', 'Binary floats cannot represent most cents exactly, causing reconciliation errors', 'Pydantic requires it', 'For currencies'], a: 1, why: '0.1 + 0.2 != 0.3 in floats.' },
    { q: 'An invoice is valid but the IBAN differs from the supplier master record. Route to:', o: ['Straight-through', 'Manual review with fraud check', 'Delete', 'Auto-update master data'], a: 1, why: 'Classic payment diversion pattern.' },
    { q: 'Why store provenance (page, span) for each field?', o: ['Decoration', 'Reviewers and auditors can see exactly where values came from', 'Smaller files', 'Required by OCR'], a: 1, why: 'Auditability and fast review.' }
  ],
  interview: [
    { q: 'Design an invoice processing system with LLMs.', a: '<p>Classify and parse documents, extract to a schema with per-field confidence and provenance using structured outputs, validate deterministically (arithmetic with Decimal, tax rules, master data, IBAN, duplicates), route to straight-through or targeted review, perform three-way matching with tolerances, post with an audit trail, and measure STP rate and audited error rate; corrections feed evals.</p>' },
    { q: 'How do you set the auto-approval threshold?', a: '<p>From the cost of errors versus the cost of review per field: measure field-level accuracy by confidence on audited data, choose thresholds that keep expected error cost below target, and monitor with ongoing audit samples, tightening automatically if error rates rise.</p>' }
  ]
});

/* ===================================================================== 12.6 */
L({
  id: '12.6', title: 'High-QPS inference platform', minutes: 60, roles: ['be'],
  tags: 'multi-tenant serving · admission control · weighted fair queuing · priority classes · prefix-aware routing · autoscaling · SLOs per tier · noisy neighbours',
  mental: 'A shared inference platform turns GPUs into a reliable multi-tenant service: admit requests by quota and priority, queue fairly so one tenant cannot starve others, route to replicas that already hold the prompt prefix in cache, scale on queue depth, and protect latency SLOs per tier by shedding or deferring lower-priority work.',
  intro: `<p>Large companies run internal platforms that serve many teams’ LLM traffic, whether on self-hosted models (9.x) or by brokering provider capacity. At thousands of requests per second the hard problems are fairness, tail latency, cache efficiency and cost. This case combines the gateway (9.8), batching and KV cache (9.3–9.5), capacity planning (9.7) and Kubernetes autoscaling (10.5).</p>`,
  points: [
    'Tiers: interactive (strict TTFT SLO), standard, and batch (deadline in hours). Each tier has its own SLO and price.',
    'Admission control: per-tenant token-rate quotas; reject or defer early with clear errors rather than letting queues grow.',
    'Fair queuing: weighted fair queuing by tenant within a tier, so one heavy tenant cannot starve others (noisy neighbour).',
    'Routing: send requests sharing a prompt prefix to the same replica (prefix-aware or consistent-hash routing) to reuse KV cache; balance with load.',
    'Autoscale on queue depth and KV-cache utilisation; keep warm capacity for interactive tiers; fill idle GPU time with batch work.',
    'Observe per tenant and tier: TTFT, TPOT, queue time, rejections, tokens, cost; enforce budgets.'
  ],
  concept: { title: 'A busy restaurant kitchen with reservations', body: `<p>The kitchen has a limited number of stoves (GPUs). Reservations (quotas) cap how many covers each party books; diners with tickets for the theatre (interactive tier) are served first; large catering orders (batch) are cooked when stoves are free; and orders for the same dish go to the cook who already has it on the stove (prefix routing).</p>` },
  walk: [
    { h: 'Requirements and estimates', body: '<p>Example: 40 internal tenants, 3,000 requests/s at peak, mean 2,000 input and 250 output tokens; interactive TTFT p99 < 800 ms; batch completes within 6 hours. Input throughput 6M tokens/s, output 750k tokens/s at peak: GPU count follows from measured per-replica throughput (9.7).</p>' },
    { h: 'Fairness and priority', body: '<p>Weighted fair queuing gives each tenant a virtual finish time based on its weight and request cost (tokens); the scheduler always picks the smallest. Strict priority between tiers, with preemption or limits so batch never delays interactive.</p>', code: String.raw`# weighted fair queuing on token cost
finish = max(virtual_time, last_finish[tenant]) + request.tokens / weight[tenant]
last_finish[tenant] = finish
heapq.heappush(queue[tier], (finish, request))
# dispatcher: interactive queue first, then standard, then batch if capacity is idle` },
    { h: 'Prefix-aware routing', body: '<p>Many requests share long system prompts or documents. Routing by a hash of the prefix sends them to replicas that already cache it, cutting prefill compute and TTFT; bounded-load consistent hashing keeps any replica from overloading. The lab measures the effect.</p>' }
  ],
  analogy: `<p><b>A highway with lanes and ramp meters.</b> Ramp meters (admission control) stop on-ramps from flooding the highway; an express lane (interactive tier) keeps moving; trucks (batch) drive at night; and car-pool lanes group travellers going the same way (prefix routing).</p>`,
  diagram: {
    title: 'Multi-tenant inference platform',
    cols: [['tenants'], ['gw'], ['adm'], ['q1', 'q2', 'q3'], ['router'], ['r1', 'r2', 'r3'], ['scale']],
    nodes: [
      { id: 'tenants', label: 'Tenants', sub: '40 teams · SDKs', tone: 'fde', info: 'Each with quotas and budgets.' },
      { id: 'gw', label: 'Gateway', sub: 'auth · metering', tone: 'acc', info: 'OpenAI-compatible API (9.8).' },
      { id: 'adm', label: 'Admission', sub: 'token quotas · shed', tone: 'bad', info: 'Reject or defer early.' },
      { id: 'q1', label: 'Interactive queue', sub: 'WFQ · p99 TTFT SLO', tone: 'warn', info: 'Strict priority.' },
      { id: 'q2', label: 'Standard queue', sub: 'WFQ', tone: 'be', info: 'Normal priority.' },
      { id: 'q3', label: 'Batch queue', sub: 'deadline hours', tone: 'ok', info: 'Fills idle capacity.' },
      { id: 'router', label: 'Prefix-aware router', sub: 'cache affinity + load', tone: 'acc', info: 'Bounded-load consistent hashing.' },
      { id: 'r1', label: 'Replica pool A', sub: 'model X · vLLM/SGLang', tone: 'be', info: 'Continuous batching, paged KV cache.' },
      { id: 'r2', label: 'Replica pool B', sub: 'model Y', tone: 'be', info: 'Different model or size.' },
      { id: 'r3', label: 'Provider overflow', sub: 'API capacity', tone: 'warn', info: 'Burst to managed APIs when allowed.' },
      { id: 'scale', label: 'Autoscaler', sub: 'queue depth · KV use', tone: 'ok', info: 'Warm pools for interactive.' }
    ],
    edges: [{ a: 'tenants', b: 'gw' }, { a: 'gw', b: 'adm' }, { a: 'adm', b: 'q1' }, { a: 'adm', b: 'q2' }, { a: 'adm', b: 'q3' }, { a: 'q1', b: 'router' }, { a: 'q2', b: 'router' }, { a: 'q3', b: 'router' }, { a: 'router', b: 'r1' }, { a: 'router', b: 'r2' }, { a: 'router', b: 'r3' }, { a: 'scale', b: 'r1', dash: true }],
    caption: 'Admit, queue fairly by tier, route for cache affinity, scale on queue depth.'
  },
  illustrated: { title: 'Tier policy', body: `<div class="tbl"><table><thead><tr><th>tier</th><th>SLO</th><th>when overloaded</th><th>price</th></tr></thead><tbody>
    <tr><td>interactive</td><td>TTFT p99 < 800 ms</td><td>reserved capacity; overflow to provider</td><td>highest</td></tr>
    <tr><td>standard</td><td>TTFT p99 < 3 s</td><td>queue, then 429 with retry-after</td><td>base</td></tr>
    <tr><td>batch</td><td>done within 6 h</td><td>paused; resumes in idle capacity</td><td>~50% of base</td></tr></tbody></table></div>` },
  code: {
    title: 'Noisy neighbours: FIFO vs weighted fair queuing with tiers', file: 'fair_queue_sim.py', browser: true,
    intro: '<p>A discrete-event simulation of a GPU pool with fixed concurrent slots. Three tenants share it; one floods with large requests. Compares FIFO with weighted fair queuing plus an interactive tier, reporting p50/p99 queue wait per tenant. Service time is proportional to tokens; numbers are illustrative.</p>',
    src: String.raw`import heapq, random
from collections import defaultdict

def workload(seed=5, seconds=120):
    rng, reqs = random.Random(seed), []
    spec = {"search-team": (6, 800, "interactive"), "support-bot": (10, 1500, "interactive"), "data-backfill": (11, 6000, "standard")}
    for tenant, (rate, tokens, tier) in spec.items():
        t = 0.0
        while t < seconds:
            t += rng.expovariate(rate)
            reqs.append((t, tenant, max(100, int(rng.gauss(tokens, tokens * 0.3))), tier))
    return sorted(reqs)

SLOTS, TOK_PER_S_PER_SLOT = 32, 2500           # pool throughput ~80k tokens/s
WEIGHT = {"search-team": 1, "support-bot": 1, "data-backfill": 1}

def simulate(reqs, policy):
    events, waits = [], defaultdict(list)
    free, now, i = SLOTS, 0.0, 0
    queue, vt, last_finish = [], 0.0, defaultdict(float)
    def push(r):
        t, tenant, tok, tier = r
        if policy == "fifo":
            key = (0, t)
        else:
            f = max(vt, last_finish[tenant]) + tok / WEIGHT[tenant]
            last_finish[tenant] = f
            key = (0 if tier == "interactive" else 1, f)
        heapq.heappush(queue, (key, r))
    while i < len(reqs) or events or queue:
        next_arrival = reqs[i][0] if i < len(reqs) else float("inf")
        next_done = events[0][0] if events else float("inf")
        if next_arrival <= next_done:
            now = next_arrival; push(reqs[i]); i += 1
        else:
            now, _ = heapq.heappop(events); free += 1
        while free and queue:
            key, (t, tenant, tok, tier) = heapq.heappop(queue)
            if policy != "fifo": vt = max(vt, key[1] - tok / WEIGHT[tenant])
            waits[tenant].append(now - t); free -= 1
            heapq.heappush(events, (now + tok / TOK_PER_S_PER_SLOT, tenant))
    return waits

reqs = workload()
load = sum(r[2] for r in reqs) / 120 / (SLOTS * TOK_PER_S_PER_SLOT)
print(f"{len(reqs)} requests, offered load {load:.0%} of pool capacity (backfill floods with large requests)")
for policy in ("fifo", "wfq+tiers"):
    w = simulate(reqs, policy)
    print(f"--- {policy} ---")
    for tenant, xs in w.items():
        xs.sort()
        print(f"  {tenant:<14} queue wait p50 {xs[len(xs)//2]*1000:7.0f} ms   p99 {xs[int(len(xs)*0.99)]*1000:8.0f} ms")`
  },
  lab: {
    title: 'Prefix-aware routing vs round robin', file: 'prefix_routing_lab.py', browser: true,
    scenario: `<p>Eight replicas each have a KV cache that can hold 40 distinct prompt prefixes (LRU). Traffic comes from 150 distinct long prefixes (system prompts and shared documents of different apps) with Zipf popularity. A cache hit saves most of the prefill time. Compare round robin, least-loaded, and consistent hashing on the prefix with bounded load (a replica may take at most 1.25× the average load; otherwise the next replica on the ring). Measure cache hit rate, mean and p99 TTFT, and load imbalance.</p>`,
    steps: ['Generate 60,000 requests with prefix ids drawn by Zipf popularity.', 'TTFT model: queue proxy (replica load) plus prefill: 400 ms on miss, 60 ms on hit.', 'Implement the three routers; keep per-replica LRU caches and recent load counters.', 'Report hit rate, TTFT mean and p99, and max/mean load across replicas.', 'Explain why bounded load matters for popular prefixes.'],
    checks: ['Consistent hashing has a much higher hit rate than round robin.', 'Bounded load keeps imbalance near 1.25 or below.', 'TTFT p99 improves with cache affinity.'],
    hints: ['An OrderedDict with move_to_end is a compact LRU.', 'Use a sliding window of recent assignments as the load signal.'],
    starter: String.raw`import bisect, hashlib, random
from collections import OrderedDict, deque
random.seed(6)
R, CAP, P, N = 8, 40, 150, 60_000
weights = [1 / (k + 1) ** 1.05 for k in range(P)]
reqs = random.choices(range(P), weights=weights, k=N)
# TODO: routers, caches, metrics`,
    solution: String.raw`import bisect, hashlib, random
from collections import OrderedDict, deque
random.seed(6)
R, CAP, P, N = 8, 40, 150, 60_000
weights = [1 / (k + 1) ** 1.05 for k in range(P)]
reqs = random.choices(range(P), weights=weights, k=N)
h = lambda s: int(hashlib.md5(s.encode()).hexdigest(), 16)
RING = sorted((h(f"replica-{r}-{v}"), r) for r in range(R) for v in range(50))
KEYS = [k for k, _ in RING]

def run(policy):
    caches = [OrderedDict() for _ in range(R)]
    window, load = deque(), [0] * R
    hits, ttft, rr = 0, [], 0
    for i, p in enumerate(reqs):
        if policy == "round_robin":
            r = rr % R; rr += 1
        elif policy == "least_loaded":
            r = min(range(R), key=lambda x: load[x])
        else:
            limit = 1.25 * (len(window) + 1) / R
            j = bisect.bisect(KEYS, h(f"prefix-{p}")) % len(RING)
            for step in range(len(RING)):
                r = RING[(j + step) % len(RING)][1]
                if load[r] + 1 <= limit: break
        c = caches[r]
        hit = p in c
        if hit: c.move_to_end(p); hits += 1
        else:
            c[p] = True
            if len(c) > CAP: c.popitem(last=False)
        window.append(r); load[r] += 1
        if len(window) > 400: load[window.popleft()] -= 1
        ttft.append(load[r] * 8 + (60 if hit else 400))        # ms: queue proxy + prefill
    ttft.sort()
    return hits / N, sum(ttft) / N, ttft[int(N * 0.99)], max(load) / (sum(load) / R)

print(f"{'router':<16} {'hit rate':>8} {'TTFT mean':>10} {'TTFT p99':>9} {'max/mean load':>14}")
for policy in ("round_robin", "least_loaded", "prefix_hash_bounded"):
    hit, mean, p99, imb = run(policy)
    print(f"{policy:<16} {hit:8.1%} {mean:9.0f}ms {p99:8.0f}ms {imb:14.2f}")
print("\nBounded load stops the most popular prefixes from overloading one replica: overflow spills to the next replica on the ring,")
print("which then also caches that prefix, so hot prefixes end up replicated on a few replicas instead of one.")`
  },
  design: {
    lead: '<p>A shared inference platform is a scheduling and economics problem as much as a serving one. Tiers, quotas, fair queuing, cache-aware routing and queue-based autoscaling let many teams share expensive GPUs with predictable latency.</p>',
    scale: [{ h: 'Thousands of requests per second', p: 'Stateless gateways scale horizontally; queues and routing state sit in fast shared stores or in a dedicated scheduler per pool; replicas expose load and cache metrics for routing.' }, { h: 'Heterogeneous models', p: 'Separate pools per model and size; routing by model and tenant policy; capacity planning per pool (9.7); disaggregated prefill and decode for long-context workloads (9.6).' }],
    fail: [{ h: 'Noisy neighbours', p: 'FIFO lets one tenant’s burst starve everyone. Quotas and weighted fair queuing are required, not optional.' }, { h: 'Cold capacity', p: 'Scaling up takes minutes (image pull, weight load). Keep warm pools for interactive tiers and use predictive scaling for known peaks.' }],
    trade: [{ h: 'Cache affinity vs load balance', p: 'Strict affinity maximises cache hits and can overload replicas; bounded-load hashing trades a little hit rate for balance.' }, { h: 'Utilisation vs latency', p: 'Higher utilisation lowers cost and raises queueing delay; reserve headroom for interactive tiers and fill the rest with batch.' }],
    prompt: '<p>Design an internal LLM serving platform for 40 product teams at 3,000 requests per second peak.</p>',
    answer: '<ul><li>Tiers with SLOs and prices; per-team token quotas and budgets; OpenAI-compatible gateway with metering.</li><li>Admission control; weighted fair queuing per tier; strict priority for interactive; batch fills idle capacity.</li><li>Model pools on Kubernetes with vLLM or SGLang; prefix-aware bounded-load routing; queue-depth autoscaling with warm pools; provider overflow for bursts.</li><li>Per-tenant dashboards for TTFT, TPOT, queue time, rejections and cost; chargeback; capacity planning reviews monthly.</li></ul>'
  },
  quiz: [
    { q: 'What problem does weighted fair queuing solve?', o: ['Encryption', 'One tenant’s burst starving others in a shared queue', 'Model accuracy', 'Disk space'], a: 1, why: 'Noisy neighbours.' },
    { q: 'Why route requests by prompt prefix?', o: ['For security', 'Reuse cached KV for shared prefixes, reducing prefill and TTFT', 'To sort logs', 'It is random'], a: 1, why: 'Cache affinity saves compute.' },
    { q: 'Batch work in a shared platform should:', o: ['Have top priority', 'Fill idle capacity without hurting interactive SLOs', 'Be rejected', 'Run only on CPUs'], a: 1, why: 'Raises utilisation safely.' }
  ],
  interview: [
    { q: 'How do you keep latency SLOs for interactive traffic on a shared GPU pool?', a: '<p>Separate tiers with strict priority, reserved capacity and admission control; weighted fair queuing within tiers; batch confined to idle capacity and preemptible; prefix-aware routing to cut prefill; autoscaling on queue depth with warm pools; and overflow to provider APIs where policy allows.</p>' },
    { q: 'What metrics would you put on the platform dashboard?', a: '<p>Per tenant and tier: request rate, tokens in and out, TTFT and TPOT percentiles, queue time, rejections and throttles, error rates, cost and budget burn. Per pool: GPU and KV-cache utilisation, batch size, prefix-cache hit rate, replica count and scaling events.</p>' }
  ]
});
})();
