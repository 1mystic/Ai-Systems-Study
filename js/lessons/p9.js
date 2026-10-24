/* Phase 9 · Serving, scale and reliability (part 1: 9.1–9.6) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 9.1 */
L({
  id: '9.1', title: 'Model gateway, routing, cascades', minutes: 55, roles: ['be', 'fde'],
  tags: 'LLM gateway · provider adapters · routing rules · fallbacks · cascades · cost tracking · per-tenant policy',
  mental: 'Put one gateway between your applications and every model provider. It normalises APIs, enforces keys, quotas and policies, routes each request to the cheapest model that meets its quality bar, falls back when providers fail, and records cost per tenant and feature.',
  intro: `<p>By the second AI feature, most companies call several models from several providers, each with its own SDK, limits, outages and prices. Without a gateway, every team re-implements retries, logging and key management, and nobody can answer “what did AI cost us last month, by customer?”. With one, those become platform features.</p>
  <p>Open-source gateways such as LiteLLM and commercial and cloud options (Portkey, Kong and Cloudflare AI gateways, Azure API Management’s AI gateway features and others) exist; many teams also build a thin internal one. This lesson builds the core logic: adapters, routing, fallback and cascades.</p>`,
  points: [
    'One internal API (often OpenAI- or Anthropic-compatible) in front of all providers and self-hosted models.',
    'Central concerns: authentication and keys, rate limits and quotas (9.10), logging and tracing (9.11), caching (9.2), redaction (8.5), cost accounting.',
    '<b>Routing</b>: choose a model by task type, tenant tier, latency budget, data residency or required capability.',
    '<b>Fallbacks</b>: on overload or outage, retry on another provider or region with an equivalent model (3.5).',
    '<b>Cascades</b>: try a cheap model first and escalate to a stronger one only when a check fails or confidence is low.',
    'Measure quality per route with evals; a routing change is a release like any other.'
  ],
  concept: { title: 'A switchboard with a meter', body: `<p>The gateway is a switchboard: applications dial one number, and the gateway connects each call to the right line based on rules, availability and price, while a meter records every minute per customer. Cascades are the switchboard’s cleverest trick: most calls are simple and go to the cheap line, and only the hard ones get forwarded to the expensive specialist.</p>` },
  walk: [
    { h: 'Route by declared intent', body: '<p>Applications send a task label, not a model name; the gateway maps labels to models in configuration, so swapping models needs no application release.</p>', lang: 'yaml', file: 'gateway/routes.yaml', code: String.raw`routes:
  classify_ticket:   {primary: claude-haiku-5-5, fallback: [gpt-mini-eu], max_latency_ms: 1500}
  draft_reply:       {cascade: [claude-haiku-5-5, claude-sonnet-5-5], escalate_if: "validator_failed or confidence < 0.7"}
  contract_analysis: {primary: claude-opus-5-5, residency: eu, tenants: [enterprise]}` },
    { h: 'Cascade with a verifier', body: '<p>The escalation signal should be cheap and reliable: a schema or business-rule validator, a confidence score calibrated on your data, or a small judge. Self-reported model confidence alone is weak.</p>' },
    { h: 'Account for every call', body: '<p>Record tenant, feature, route, model, input, cached and output tokens, latency and cost per request; cost dashboards and chargeback come from this table.</p>' }
  ],
  analogy: `<p><b>A hospital triage desk.</b> Every patient comes in through one entrance. A nurse handles minor cases; complex ones go to a specialist; if one specialist is unavailable, the patient goes to another hospital in the network; and the billing office records every consultation per patient.</p>`,
  diagram: {
    title: 'A model gateway',
    cols: [['apps'], ['gw'], ['policy', 'router'], ['m1', 'm2', 'm3'], ['ledger']],
    nodes: [
      { id: 'apps', label: 'Applications', sub: 'task labels', tone: 'fde', info: 'Send task, tenant and payload; never provider keys.' },
      { id: 'gw', label: 'Gateway API', sub: 'one interface', tone: 'acc', info: 'Normalised request format and auth.' },
      { id: 'policy', label: 'Policies', sub: 'quota · redaction · residency', tone: 'warn', info: 'Applied before any provider call.' },
      { id: 'router', label: 'Router', sub: 'rules · cascade · fallback', tone: 'be', info: 'Chooses model and handles failures.' },
      { id: 'm1', label: 'Small model', sub: 'cheap · fast', info: 'Default for simple tasks and first cascade stage.' },
      { id: 'm2', label: 'Large model', sub: 'escalation', info: 'Used when checks fail or tasks need it.' },
      { id: 'm3', label: 'Self-hosted / other provider', sub: 'fallback · residency', info: 'For outages, data residency or cost.' },
      { id: 'ledger', label: 'Usage ledger', sub: 'tokens · cost · latency', tone: 'ok', info: 'Per tenant, feature and route.' }
    ],
    edges: [{ a: 'apps', b: 'gw' }, { a: 'gw', b: 'policy' }, { a: 'gw', b: 'router' }, { a: 'router', b: 'm1' }, { a: 'router', b: 'm2', dash: true, label: 'escalate' }, { a: 'router', b: 'm3', dash: true }, { a: 'm1', b: 'ledger' }, { a: 'm2', b: 'ledger' }, { a: 'm3', b: 'ledger' }],
    caption: 'One entry point; routes, fallbacks and costs managed centrally.'
  },
  illustrated: { title: 'Cascade economics', body: `<p>100,000 requests a day. Large model: $0.020 per request; small model: $0.002 per request (illustrative prices).</p>
    <div class="tbl"><table><thead><tr><th>strategy</th><th>cost per day</th><th>quality</th></tr></thead><tbody>
    <tr><td>large model for everything</td><td class="n">$2,000</td><td>baseline</td></tr>
    <tr><td>small model for everything</td><td class="n">$200</td><td>fails on hard requests</td></tr>
    <tr><td>cascade: small first, 18% escalated</td><td class="n">$200 + $360 = $560</td><td>close to baseline if the escalation check catches the hard 18%</td></tr></tbody></table></div>` },
  code: {
    title: 'A gateway with adapters, routing, fallback, a cascade and a cost ledger', file: 'gateway.py', browser: true,
    intro: '<p>Three fake providers behind one interface (one has an outage), routes from configuration, a fallback chain, a cascade that escalates when a validator fails, and a usage ledger. Requests and difficulty are simulated with a seed so the cost and quality trade-off is measurable.</p>',
    src: String.raw`import random
from collections import defaultdict
from dataclasses import dataclass

@dataclass
class Result:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    ok: bool

PRICES = {"small": (0.25, 1.25), "large": (3.0, 15.0), "small-eu": (0.30, 1.50)}     # $ per million tokens (illustrative)

class FakeProvider:
    def __init__(self, model, skill, down=False):
        self.model, self.skill, self.down = model, skill, down
    def complete(self, prompt, difficulty, rng):
        if self.down:
            raise ConnectionError(f"{self.model} unavailable")
        return Result(f"answer from {self.model}", self.model, 800, 150, rng.random() < self.skill - 0.6 * difficulty * (1 - self.skill))

PROVIDERS = {"small": FakeProvider("small", 0.97), "large": FakeProvider("large", 0.995), "small-eu": FakeProvider("small-eu", 0.96, down=True)}
ROUTES = {"classify": {"chain": ["small-eu", "small"]},                 # residency preference, falls back
          "draft": {"cascade": ["small", "large"]},
          "analyse": {"chain": ["large"]}}

ledger = defaultdict(lambda: {"requests": 0, "cost": 0.0, "escalations": 0, "fallbacks": 0, "good": 0})

def cost(r):
    pin, pout = PRICES[r.model]
    return (r.tokens_in * pin + r.tokens_out * pout) / 1e6

def call_chain(chain, prompt, difficulty, rng, row):
    for i, name in enumerate(chain):
        try:
            r = PROVIDERS[name].complete(prompt, difficulty, rng)
            row["fallbacks"] += i > 0
            return r
        except ConnectionError:
            continue
    raise RuntimeError("all providers failed")

def gateway(tenant, task, prompt, difficulty, rng):
    route, row = ROUTES[task], ledger[(tenant, task)]
    row["requests"] += 1
    if "cascade" in route:
        cheap, strong = route["cascade"]
        r = call_chain([cheap], prompt, difficulty, rng, row); row["cost"] += cost(r)
        if not r.ok:                                              # validator failed -> escalate
            row["escalations"] += 1
            r = call_chain([strong], prompt, difficulty, rng, row); row["cost"] += cost(r)
    else:
        r = call_chain(route["chain"], prompt, difficulty, rng, row); row["cost"] += cost(r)
    row["good"] += r.ok
    return r

rng = random.Random(1)
for _ in range(3000):
    tenant = rng.choice(["acme", "globex"])
    task = rng.choices(["classify", "draft", "analyse"], weights=[5, 4, 1])[0]
    gateway(tenant, task, "...", rng.random() ** 2, rng)

print(f"{'tenant':<8}{'task':<10}{'reqs':>6}{'good':>7}{'escal.':>8}{'fallbk':>8}{'cost $':>9}")
for (tenant, task), r in sorted(ledger.items()):
    print(f"{tenant:<8}{task:<10}{r['requests']:>6}{r['good'] / r['requests']:>7.1%}{r['escalations']:>8}{r['fallbacks']:>8}{r['cost']:>9.3f}")

# what would "large for every draft" have cost?
drafts = sum(r["requests"] for (t, k), r in ledger.items() if k == "draft")
cascade_cost = sum(r["cost"] for (t, k), r in ledger.items() if k == "draft")
print(f"\ndrafts: cascade ${'$'}{cascade_cost:.2f} vs large-only ${'$'}{drafts * cost(Result('', 'large', 800, 150, True)):.2f}")`
  },
  lab: {
    title: 'Tune a cascade threshold', file: 'cascade_lab.py', browser: true,
    scenario: `<p>For a customer’s drafting feature, the small model returns a confidence score with each answer. You have 1,000 labelled examples with the small model’s confidence and correctness, and the large model’s correctness. Find the confidence threshold below which to escalate that meets the customer’s 95% quality target at the lowest cost, and compare with always using the large model.</p>`,
    steps: ['Use the seeded data in the starter (confidence, small_correct, large_correct per example).', 'For thresholds 0.0 to 1.0 in steps of 0.05: escalate when confidence < threshold; quality = small correct on kept items + large correct on escalated items; cost = 1 per item + 10 per escalated item.', 'Find the cheapest threshold with quality ≥ 95%.', 'Report escalation rate, quality, cost and savings versus large-only.', 'Check calibration: within confidence bins, how often is the small model correct?'],
    checks: ['The chosen threshold meets the 95% target.', 'Savings versus large-only are reported.', 'The calibration table shows whether confidence is trustworthy.'],
    hints: ['Large-only cost is 10 per item, plus nothing else.', 'A poorly calibrated confidence forces a high threshold; calibration fixes that.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(8)
n = 1000
difficulty = rng.random(n) ** 1.5
small_correct = rng.random(n) < 0.99 - 0.45 * difficulty
large_correct = rng.random(n) < 0.995 - 0.08 * difficulty
confidence = np.clip(1 - difficulty + rng.normal(0, 0.12, n), 0, 1)
# TODO`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(8)
n = 1000
difficulty = rng.random(n) ** 1.5
small_correct = rng.random(n) < 0.99 - 0.45 * difficulty
large_correct = rng.random(n) < 0.995 - 0.08 * difficulty
confidence = np.clip(1 - difficulty + rng.normal(0, 0.12, n), 0, 1)

rows = []
for t in np.round(np.arange(0, 1.01, 0.05), 2):
    esc = confidence < t
    quality = np.mean(np.where(esc, large_correct, small_correct))
    cost = n * 1 + 10 * esc.sum()
    rows.append((t, esc.mean(), quality, cost))
ok = [r for r in rows if r[2] >= 0.95]
best = min(ok, key=lambda r: r[3])
large_only = (large_correct.mean(), 10 * n)
print(f"{'thresh':>6} {'escalated':>9} {'quality':>8} {'cost':>6}")
for r in rows[::2]:
    print(f"{r[0]:>6.2f} {r[1]:>9.1%} {r[2]:>8.3f} {r[3]:>6}")
print(f"\nbest: escalate below {best[0]:.2f} -> {best[1]:.0%} escalated, quality {best[2]:.3f}, cost {best[3]} vs large-only {large_only[1]} (quality {large_only[0]:.3f})")
print(f"savings: {1 - best[3] / large_only[1]:.0%}")
print("\ncalibration of small-model confidence:")
for lo in np.arange(0, 1, 0.2):
    m = (confidence >= lo) & (confidence < lo + 0.2)
    if m.any():
        print(f"  confidence {lo:.1f}-{lo + 0.2:.1f}: n={m.sum():>4}, small correct {small_correct[m].mean():.2f}")`
  },
  design: {
    lead: '<p>The gateway becomes critical infrastructure on the path of every AI call. Design it for high availability, low added latency, and clean separation between routing configuration and application code.</p>',
    scale: [{ h: 'Stateless and regional', p: 'Run gateway instances in each region behind load balancers; state such as quotas lives in Redis or a database (9.10).' }, { h: 'Streaming passthrough', p: 'Proxy streaming responses without buffering; added latency should be a few milliseconds.' }],
    fail: [{ h: 'Gateway as single point of failure', p: 'Multiple instances, health checks, and a documented bypass for emergencies.' }, { h: 'Silent route changes', p: 'Changing a route changes product quality. Version routes, require eval results, and log the route with every call.' }],
    trade: [{ h: 'Build vs adopt', p: 'Open-source gateways cover many providers quickly; a thin internal gateway fits custom policies. Many teams start with one and wrap it.' }, { h: 'Cascades vs one model', p: 'Cascades save money when most requests are easy and the escalation check is reliable; otherwise they add latency for little saving.' }],
    prompt: '<p>Design a gateway for a company with 30 AI features, three providers, EU and India data residency rules, and a finance team asking for cost per customer.</p>',
    answer: '<ul><li>Regional gateway deployments with residency-aware routing; providers and regions per route in versioned config.</li><li>Policies: auth, quotas, redaction, logging; fallbacks across equivalent models within the same region.</li><li>Cascades for high-volume features with validated escalation checks.</li><li>Usage ledger with tenant, feature, route and tokens; daily cost reports and budget alerts.</li></ul>'
  },
  quiz: [
    { q: 'Why should applications send a task label instead of a model name?', o: ['Shorter requests', 'So routing can change in gateway configuration without an application release', 'Providers require it', 'For caching'], a: 1, why: 'Decouples product code from model choice.' },
    { q: 'A cascade saves money when:', o: ['All requests are hard', 'Most requests are easy and a reliable check identifies the hard ones', 'The large model is cheaper', 'Latency does not matter'], a: 1, why: 'Escalation must be rare and accurate.' },
    { q: 'What belongs in the usage ledger?', o: ['Only errors', 'Tenant, feature, route, model, tokens, latency and cost per call', 'Raw prompts by default', 'Nothing'], a: 1, why: 'It powers cost reporting and debugging.' }
  ],
  interview: [
    { q: 'Why build an LLM gateway?', a: '<p>To centralise what every team would otherwise repeat: provider adapters, keys, quotas, retries and fallbacks, caching, redaction, logging and tracing, and cost accounting. It also makes model choice a configuration decision, enabling routing and cascades backed by evals, and gives finance cost per tenant and feature.</p>' },
    { q: 'How would you design a model cascade?', a: '<p>Send requests to a cheap model first, run a reliable check such as a schema or business-rule validator or a calibrated confidence, and escalate failures to a stronger model. Tune the threshold on labelled data to hit a quality target at minimum cost, monitor escalation rate and quality per slice, and remember the added latency for escalated requests.</p>' }
  ]
});

/* ===================================================================== 9.2 */
L({
  id: '9.2', title: 'The four caches', minutes: 50, roles: ['be', 'fde'],
  tags: 'provider prompt caching · exact response cache · semantic cache · embedding and retrieval cache · TTL · tenant scoping · invalidation',
  mental: 'Four caches save most of the money in LLM systems: the provider’s prompt (prefix) cache for repeated context, an exact response cache for identical requests, a semantic cache for near-identical questions, and caches for embeddings and retrieval results. Each must be scoped by tenant and permissions and invalidated when its inputs change.',
  intro: `<p>Many LLM requests repeat work: the same 6,000-token system prompt and tool definitions on every call, the same FAQ asked a thousand times a day in slightly different words, the same chunks embedded every night. Caching at the right layer cuts cost and latency dramatically, and caching at the wrong layer serves one customer’s answer to another. This lesson covers all four layers and how to keep them safe.</p>`,
  points: [
    '<b>Prompt (prefix) caching</b> at the provider: mark the stable prefix; cached reads are billed at a fraction of normal input price and are faster. On the Anthropic API, cache writes cost more than normal input (1.25× for the default 5-minute lifetime) and reads far less.',
    '<b>Exact response cache</b>: key on a hash of model, prompt version, parameters and the full input; safe for deterministic tasks like classification.',
    '<b>Semantic cache</b>: embed the request; reuse an answer when a previous request is similar enough. Big savings for FAQs, real risk of wrong hits.',
    '<b>Embedding and retrieval caches</b>: content-hash embeddings (4.3) and short-lived retrieval results for repeated queries.',
    'Scope every cache key by tenant and permission set; never share answers across permission boundaries.',
    'Invalidate on change: prompt version, model, document updates and policy changes; add TTLs.'
  ],
  concept: { title: 'Cache what is stable, scope what is private', body: `<p>The question for every cache is the same: if the inputs that produced this answer change, or the person asking is different, is the cached answer still right? Prompt caching is safe because the provider caches only identical prefixes. Exact caches are safe when the key includes everything that matters. Semantic caches are the risky one: “how do I cancel?” and “how do I cancel my colleague’s plan?” are similar and have different answers.</p>` },
  walk: [
    { h: 'Mark the prefix for provider caching', body: '<p>Put stable content first and mark the end of the stable prefix.</p>', code: String.raw`resp = client.messages.create(
    model=MODEL, max_tokens=500,
    system=[{"type": "text", "text": LONG_POLICY_AND_EXAMPLES, "cache_control": {"type": "ephemeral"}}],
    tools=TOOLS,
    messages=[{"role": "user", "content": question}])
print(resp.usage.cache_creation_input_tokens, resp.usage.cache_read_input_tokens)` },
    { h: 'Key exact caches carefully', body: '<p>Include everything that changes the answer.</p>', code: String.raw`key = sha256(json.dumps({"tenant": tenant, "acl": sorted(groups), "model": model, "prompt": PROMPT_VERSION,
                         "params": {"temperature": 0}, "input": normalised_input}, sort_keys=True).encode()).hexdigest()` },
    { h: 'Guard the semantic cache', body: '<p>Use a high similarity threshold tuned on labelled paraphrase pairs, restrict it to answer types that do not depend on the user (public FAQs), scope by tenant and language, and log hits so wrong ones can be found and evicted.</p>' }
  ],
  analogy: `<p><b>A busy information desk.</b> The clerk keeps the opening hours card on the desk (prefix cache), a stack of printed answers to the exact questions people ask most (exact cache), and recognises “when do you close?” as the same as “what time do you shut?” (semantic cache), but never hands one visitor another visitor’s booking details.</p>`,
  diagram: {
    title: 'Where each cache sits',
    cols: [['req'], ['exact', 'sem'], ['ret'], ['emb', 'llm'], ['pc']],
    nodes: [
      { id: 'req', label: 'Request', sub: 'tenant · acl · input', tone: 'fde', info: 'Every key includes tenant and permission scope.' },
      { id: 'exact', label: 'Exact cache', sub: 'hash of everything', tone: 'ok', info: 'Identical input, prompt version, model and parameters.' },
      { id: 'sem', label: 'Semantic cache', sub: 'similar question', tone: 'warn', info: 'Embedding similarity above a tuned threshold; public answers only.' },
      { id: 'ret', label: 'Retrieval cache', sub: 'query → chunk ids', info: 'Short TTL; invalidated on index updates.' },
      { id: 'emb', label: 'Embedding cache', sub: 'content hash', info: 'Never re-embed identical text (4.3).' },
      { id: 'llm', label: 'Model call', sub: 'stable prefix first', tone: 'acc', info: 'System, tools and examples marked for caching.' },
      { id: 'pc', label: 'Provider prompt cache', sub: 'cheap cached reads', tone: 'be', info: 'Cached prefix tokens are billed at a fraction and processed faster.' }
    ],
    edges: [{ a: 'req', b: 'exact' }, { a: 'req', b: 'sem' }, { a: 'exact', b: 'ret', dash: true, label: 'miss' }, { a: 'sem', b: 'ret', dash: true }, { a: 'ret', b: 'emb' }, { a: 'ret', b: 'llm' }, { a: 'llm', b: 'pc' }],
    caption: 'Answer caches first, then retrieval, then a model call with a cached prefix.'
  },
  illustrated: { title: 'Prompt caching arithmetic', body: `<p>A 10,000-token stable prefix, 500 new tokens per request, 1,000 requests within the cache lifetime. Prices relative to normal input = 1.0; cache write 1.25, cache read 0.1 (Anthropic’s default 5-minute cache).</p>
    <div class="tbl"><table><thead><tr><th></th><th>input token units</th></tr></thead><tbody>
    <tr><td>no caching: 1,000 × 10,500</td><td class="n">10,500,000</td></tr>
    <tr><td>with caching: 1 write (10,000 × 1.25) + 999 reads (10,000 × 0.1) + 1,000 × 500 new</td><td class="n">12,500 + 999,000 + 500,000 = 1,511,500</td></tr></tbody></table></div>
    <p>About 86% less input cost, and lower time to first token. Check current multipliers per model in the provider’s pricing.</p>` },
  code: {
    title: 'Exact and semantic caches with tenant scoping, measured', file: 'caches.py', browser: true,
    intro: '<p>An exact cache and a semantic cache (using the toy embedding idea from Phase 4) over a stream of support questions from two tenants, including paraphrases, near-misses with different meanings, and one tenant-specific question. We measure hit rate, wrong hits and the effect of the similarity threshold, plus the prompt-caching cost arithmetic.</p>',
    src: String.raw`import hashlib, json, re
import numpy as np

SYN = {"cancel": "cancel", "terminate": "cancel", "end": "cancel", "refund": "refund", "money back": "refund",
       "invoice": "invoice", "bill": "invoice", "password": "password", "log in": "login", "sign in": "login", "login": "login"}
def embed(text, dim=128):
    t = text.lower(); v = np.zeros(dim)
    for phrase, c in SYN.items():
        if phrase in t: t = t.replace(phrase, " _" + c + " ")
    for tok in re.findall(r"[a-z_]+", t):
        if len(tok) < 3: continue
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16); v[h % dim] += (3.0 if tok.startswith("_") else 1.0) * (1 if h >> 64 & 1 else -1)
    return v / (np.linalg.norm(v) or 1)

class ExactCache:
    def __init__(self): self.d = {}; self.hits = 0
    def key(self, tenant, prompt_version, q): return hashlib.sha256(json.dumps([tenant, prompt_version, " ".join(q.lower().split())]).encode()).hexdigest()
    def get(self, tenant, pv, q):
        k = self.key(tenant, pv, q)
        if k in self.d: self.hits += 1
        return self.d.get(k)
    def put(self, tenant, pv, q, a): self.d[self.key(tenant, pv, q)] = a

class SemanticCache:
    def __init__(self, threshold): self.t = threshold; self.rows = []; self.hits = 0
    def get(self, tenant, q):
        v = embed(q)
        best = max(((float(v @ e), a, oq) for tn, e, a, oq in self.rows if tn == tenant), default=(0, None, None))
        if best[0] >= self.t:
            self.hits += 1; return best[1], best[2]
        return None, None
    def put(self, tenant, q, a): self.rows.append((tenant, embed(q), a, q))

def answer(q):                      # stand-in for the model: the "intent" decides the right answer
    for intent in ["cancel", "refund", "invoice", "password", "login"]:
        if re.search({"cancel": r"cancel|terminate|end my", "refund": r"refund|money back", "invoice": r"invoice|bill",
                      "password": r"password", "login": r"log in|sign in|login"}[intent], q.lower()):
            return f"ANS:{intent}" + (":colleague" if "colleague" in q else "")
    return "ANS:other"

stream = [("acme", q) for q in ["How do I cancel my plan?", "how do I cancel my plan?", "How can I terminate my subscription?",
          "Where is my invoice?", "where can I download my bill", "I want my money back", "How do I get a refund?",
          "How do I cancel my colleague's plan?", "Reset my password", "I can't sign in"]] + \
         [("globex", "How do I cancel my plan?"), ("globex", "Where is my invoice?")]

for threshold in (0.6, 0.8, 0.95):
    exact, sem, wrong, calls = ExactCache(), SemanticCache(threshold), [], 0
    for tenant, q in stream:
        a = exact.get(tenant, "v3", q)
        if a is None:
            a, matched = sem.get(tenant, q)
            if a is not None and a != answer(q):
                wrong.append(f"'{q}' served answer for '{matched}'")
            if a is None:
                a = answer(q); calls += 1
                sem.put(tenant, q, a)
            exact.put(tenant, "v3", q, a)
    print(f"threshold {threshold}: model calls {calls}/{len(stream)}, exact hits {exact.hits}, semantic hits {sem.hits}, wrong hits {len(wrong)}")
    for w in wrong:
        print("    WRONG:", w)

prefix, new, n = 10_000, 500, 1_000
print("\nno threshold separates 'cancel my plan' from 'cancel my colleague\'s plan': restrict semantic caching to answers that"
      " do not depend on who or what the question refers to, or check key entities before serving a hit.")
print(f"\nprompt caching: {n * (prefix + new):,} input units uncached vs {prefix * 1.25 + (n - 1) * prefix * 0.1 + n * new:,.0f} cached")`
  },
  lab: {
    title: 'Pick a safe semantic-cache threshold', file: 'semcache_lab.py', browser: true,
    scenario: `<p>The customer wants semantic caching for their public FAQ bot but has zero tolerance for serving a wrong answer more than 1 in 200 times. You have 400 labelled question pairs with similarity scores: same-intent pairs (a hit would be correct) and different-intent pairs (a hit would be wrong). Choose the threshold that maximises hit rate subject to wrong-hit rate ≤ 0.5%, and estimate the monthly saving.</p>`,
    steps: ['Use the seeded similarity scores in the starter for same-intent and different-intent pairs.', 'For thresholds 0.70 to 0.99, compute the share of same-intent pairs that would hit (useful hits) and different-intent pairs that would hit (wrong hits).', 'Pick the lowest threshold with wrong-hit rate ≤ 0.5% on different-intent pairs.', 'Estimate savings: 2 million questions a month, 35% of them have an earlier same-intent question in cache, $0.004 per model call.', 'Print the table, the chosen threshold and the saving.'],
    checks: ['Wrong-hit rate at the chosen threshold is ≤ 0.5%.', 'Savings are computed from the useful hit rate.', 'The table shows the trade-off clearly.'],
    hints: ['Useful hits only happen for the 35% of traffic with a same-intent predecessor.', 'Report a bootstrap interval on the wrong-hit rate if you want extra credit.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(17)
same = np.clip(rng.normal(0.90, 0.05, 200), 0, 1)        # similarity of same-intent pairs
diff = np.clip(rng.normal(0.72, 0.09, 200), 0, 1)        # similarity of different-intent pairs
# TODO`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(17)
same = np.clip(rng.normal(0.90, 0.05, 200), 0, 1)
diff = np.clip(rng.normal(0.72, 0.09, 200), 0, 1)

print(f"{'thresh':>6} {'useful hit':>10} {'wrong hit':>10}")
choice = None
for t in np.round(np.arange(0.70, 1.0, 0.02), 2):
    useful, wrong = np.mean(same >= t), np.mean(diff >= t)
    print(f"{t:>6.2f} {useful:>10.1%} {wrong:>10.1%}")
    if choice is None and wrong <= 0.005:
        choice = (t, useful, wrong)
t, useful, wrong = choice
monthly, repeat_share, price = 2_000_000, 0.35, 0.004
saved_calls = monthly * repeat_share * useful
print(f"\nchosen threshold {t:.2f}: useful hits {useful:.0%}, wrong-hit rate {wrong:.1%}")
print(f"saving ~{saved_calls:,.0f} calls/month = ${'$'}{saved_calls * price:,.0f}")
print(f"expected wrong answers: ~{monthly * (1 - repeat_share) * wrong:,.0f}/month from requests whose nearest cached neighbour has a different intent")
print("verdict: at this tolerance the semantic cache saves little; prefer exact caching plus provider prompt caching, or improve the embedding first.")`
  },
  design: {
    lead: '<p>Caches touch correctness, privacy and cost at once. Design keys, scopes, TTLs and invalidation explicitly, and measure hit rates and wrong-hit rates in production.</p>',
    scale: [{ h: 'Shared cache tier', p: 'Redis or a managed cache for exact and semantic caches, keyed by tenant; vector index for semantic lookups at scale.' }, { h: 'Cache-friendly prompts', p: 'Order prompts as stable-to-volatile across all features so provider caches hit; avoid timestamps or request ids in the prefix.' }],
    fail: [{ h: 'Cross-tenant leaks', p: 'A cache key without tenant and permission scope serves private answers to the wrong users. Include both, always.' }, { h: 'Stale answers', p: 'Policy or document changes leave old answers in caches. Invalidate on content and prompt version changes and keep TTLs short for volatile content.' }],
    trade: [{ h: 'Hit rate vs correctness', p: 'Lower semantic thresholds save more and serve more wrong answers. Tune on labelled pairs with a stated tolerance.' }, { h: 'Prefix stability vs personalisation', p: 'Per-user content in the prefix kills cache hits; keep personalisation after the cached prefix.' }],
    prompt: '<p>An FAQ assistant handles 3 million questions a month for 200 tenants with shared public docs and private tenant docs. Design its caching.</p>',
    answer: '<ul><li>Provider prompt caching on the system prompt and tool definitions.</li><li>Exact cache keyed by tenant, permission set, prompt version and normalised question.</li><li>Semantic cache only for answers grounded in public docs, per tenant and language, threshold tuned for ≤ 0.5% wrong hits; hits logged and sampled for review.</li><li>Invalidation on document updates via content hashes; embedding cache for ingestion; dashboards for hit rates and savings.</li></ul>'
  },
  quiz: [
    { q: 'Which cache carries the most risk of serving a wrong answer?', o: ['Provider prompt cache', 'Semantic cache', 'Embedding cache', 'Exact cache keyed on everything'], a: 1, why: 'Similar questions can have different correct answers.' },
    { q: 'Why must tenant and permissions be part of cache keys?', o: ['For speed', 'Otherwise one user can receive an answer built from another user’s private data', 'Providers require it', 'To save memory'], a: 1, why: 'Caches must respect the same boundaries as retrieval.' },
    { q: 'A timestamp at the start of the system prompt will:', o: ['Improve caching', 'Break prefix caching because the prefix changes every call', 'Have no effect', 'Reduce tokens'], a: 1, why: 'Prefix caches need byte-identical prefixes.' }
  ],
  interview: [
    { q: 'How do you reduce LLM costs with caching?', a: '<p>Layered: provider prompt caching for the stable prefix (system, tools, examples), an exact response cache for deterministic repeated requests, a carefully tuned semantic cache for public FAQ-style answers, and embedding and retrieval caches. Every key includes tenant, permissions and versions, with TTLs and invalidation on content changes, and I measure hit and wrong-hit rates.</p>' },
    { q: 'What are the risks of semantic caching?', a: '<p>Serving an answer to a question that is similar in wording but different in meaning or context, and leaking answers across users or tenants. Mitigate with high thresholds tuned on labelled pairs, restricting it to answers that do not depend on the user, scoping keys, short TTLs and monitoring of hits.</p>' }
  ]
});

/* ===================================================================== 9.3 */
L({
  id: '9.3', title: 'Inference internals: batching, paged KV, prefix cache', minutes: 60, roles: ['be'], sim: 'batching',
  tags: 'prefill vs decode · memory-bound decoding · KV cache · continuous batching · PagedAttention · prefix caching · TTFT and TPOT',
  mental: 'Serving an LLM is two different workloads: prefill reads the whole prompt in parallel and is compute-bound; decode produces one token per step and is memory-bandwidth-bound, re-reading all weights each step. Throughput comes from batching many sequences into each decode step, which is limited by KV-cache memory, so modern servers manage that memory in pages and reuse shared prefixes.',
  intro: `<p>Phase 2 explained what the model computes. This lesson explains how inference servers such as vLLM, SGLang and TensorRT-LLM make that computation fast and cheap. You need it to read benchmarks, size GPUs (9.7), choose engines (9.5) and explain to a customer why their latency doubled when traffic grew.</p>`,
  points: [
    '<b>Prefill</b>: process all prompt tokens at once; cost grows with prompt length; drives time to first token (TTFT).',
    '<b>Decode</b>: one token per sequence per step; each step reads all model weights from GPU memory, so a single sequence wastes most compute; drives time per output token (TPOT).',
    '<b>KV cache</b>: keys and values for every past token of every active sequence; size per token = 2 × layers × KV heads × head dimension × bytes.',
    '<b>Continuous batching</b>: admit new sequences into the running batch as others finish, rather than waiting for a whole batch.',
    '<b>Paged KV cache</b> (PagedAttention): allocate KV memory in fixed-size blocks on demand, removing fragmentation and allowing many more concurrent sequences.',
    '<b>Prefix caching</b>: reuse KV blocks for identical prompt prefixes across requests (system prompts, few-shot examples, multi-turn history).'
  ],
  concept: { title: 'One bus, many passengers', body: `<p>Decoding is like a bus that must drive the whole route (read all weights) for every stop (token), however many passengers are on board. One passenger per trip is ruinously expensive; forty passengers cost almost the same trip. Batching fills the bus. The KV cache is each passenger’s luggage: the more luggage, the fewer passengers fit, which is why memory management decides capacity.</p>` },
  walk: [
    { h: 'Compute the KV cache size', body: '<p>For a Llama-3.1-70B-style model: 80 layers, 8 KV heads (grouped-query attention), head dimension 128, BF16 (2 bytes): 2 × 80 × 8 × 128 × 2 = 327,680 bytes, about 320 KB per token. A 32k-token conversation holds about 10 GB of KV cache.</p>' },
    { h: 'Why decode is memory-bound', body: '<p>Each decode step multiplies a small number of new token vectors by every weight matrix. The GPU spends its time moving weights from memory, not computing. An H100 SXM moves about 3.35 TB/s; reading 70 GB of BF16 weights takes about 21 ms, so a single sequence cannot exceed roughly 48 tokens per second however fast the arithmetic units are. Batching 32 sequences shares that read.</p>' },
    { h: 'Watch the metrics that matter', body: `<div class="tbl"><table><thead><tr><th>metric</th><th>driven by</th><th>lever</th></tr></thead><tbody>
      <tr><td>TTFT</td><td>queueing + prefill</td><td>prefix caching, chunked prefill, more capacity</td></tr>
      <tr><td>TPOT</td><td>decode step time</td><td>smaller or quantised models, speculative decoding, fewer sequences per step</td></tr>
      <tr><td>throughput</td><td>batch size per step</td><td>KV memory, paged allocation, continuous batching</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A restaurant kitchen.</b> Prefill is reading and prepping a whole order at once; decode is plating one course at a time for everyone at the table. The pass (memory bandwidth) is the bottleneck, so the kitchen sends courses for many tables together. Table space (KV memory) limits how many parties can be seated; good hosts seat parties as soon as a table frees up (continuous batching) and use flexible table blocks (paging).</p>`,
  diagram: {
    title: 'Inside an inference server',
    cols: [['q'], ['sched'], ['pre', 'dec'], ['kv'], ['out']],
    nodes: [
      { id: 'q', label: 'Request queue', sub: 'prompts arrive', tone: 'fde', info: 'Requests wait for KV memory and batch slots.' },
      { id: 'sched', label: 'Scheduler', sub: 'continuous batching', tone: 'acc', info: 'Each step decides which sequences run, admitting new ones as others finish.' },
      { id: 'pre', label: 'Prefill', sub: 'compute-bound · TTFT', info: 'Whole prompt at once; chunked to avoid stalling decodes.' },
      { id: 'dec', label: 'Decode step', sub: 'bandwidth-bound · TPOT', tone: 'be', info: 'One token for every active sequence per step.' },
      { id: 'kv', label: 'Paged KV cache', sub: 'blocks · prefix sharing', tone: 'warn', info: 'Fixed-size blocks allocated on demand; identical prefixes share blocks.' },
      { id: 'out', label: 'Token streams', sub: 'per request', tone: 'ok', info: 'Streamed back as they are generated.' }
    ],
    edges: [{ a: 'q', b: 'sched' }, { a: 'sched', b: 'pre' }, { a: 'sched', b: 'dec' }, { a: 'pre', b: 'kv' }, { a: 'dec', b: 'kv' }, { a: 'dec', b: 'out' }],
    caption: 'The scheduler packs prefills and decodes into steps; KV memory decides how many fit.'
  },
  illustrated: { title: 'KV cache per token for common shapes (BF16)', body: `<div class="tbl"><table><thead><tr><th>model shape</th><th>layers</th><th>KV heads × dim</th><th>KV per token</th><th>8k-token sequence</th></tr></thead><tbody>
    <tr><td>8B (Llama-3.1-style)</td><td class="n">32</td><td class="n">8 × 128</td><td class="n">128 KB</td><td class="n">1 GB</td></tr>
    <tr><td>70B (Llama-3.1-style)</td><td class="n">80</td><td class="n">8 × 128</td><td class="n">320 KB</td><td class="n">2.6 GB</td></tr>
    <tr><td>405B (Llama-3.1-style)</td><td class="n">126</td><td class="n">8 × 128</td><td class="n">504 KB</td><td class="n">4.1 GB</td></tr></tbody></table></div>
    <p>Without grouped-query attention (one KV head per query head), these would be several times larger.</p>` },
  code: {
    title: 'KV-cache sizing and a continuous-batching scheduler, simulated', file: 'inference_sim.py', browser: true,
    intro: '<p>Part 1 computes KV memory per token and how many concurrent sequences fit after the weights. Part 2 simulates a decode server with a step-time model (base cost plus a small per-sequence cost) and compares static batching with continuous batching on the same seeded arrivals, reporting throughput, latency and slot utilisation.</p>',
    src: String.raw`import numpy as np

def kv_bytes_per_token(layers, kv_heads, head_dim, bytes_per=2):
    return 2 * layers * kv_heads * head_dim * bytes_per

for name, L, kvh, d, params_b in [("8B", 32, 8, 128, 8.0), ("70B", 80, 8, 128, 70.6)]:
    per_tok = kv_bytes_per_token(L, kvh, d)
    gpu_gb, n_gpu, weights_gb = 80, 2, params_b * 1        # FP8 weights: ~1 byte per parameter
    free = gpu_gb * n_gpu * 0.9 - weights_gb - 4
    seqs = free * 1e9 / (per_tok * 8192)
    print(f"{name}: KV {per_tok / 1024:.0f} KB/token; 2xH100, FP8 weights {weights_gb:.0f} GB -> ~{seqs:.0f} concurrent 8k-token sequences")

def simulate(mode, slots=16, n=400, rate=4, seed=2):
    rng = np.random.default_rng(seed)
    arrivals = np.cumsum(rng.exponential(1000 / rate, n))           # ms
    lengths = rng.integers(20, 400, n)                               # output tokens, widely spread
    step = lambda active: 12 + 0.3 * active                          # ms per decode step
    t, nxt, queue, running, finished, busy = 0.0, 0, [], [], [], 0.0
    while len(finished) < n:
        while nxt < n and arrivals[nxt] <= t:
            queue.append(nxt); nxt += 1
        if mode == "continuous":
            while queue and len(running) < slots:
                i = queue.pop(0); running.append([i, lengths[i], t])
        elif not running and queue and (len(queue) >= slots or nxt == n or t - arrivals[queue[0]] > 500):
            while queue and len(running) < slots:
                i = queue.pop(0); running.append([i, lengths[i], t])
        if not running:
            t = arrivals[nxt] if nxt < n else t + 1; continue
        active = sum(r[1] > 0 for r in running)                     # finished-but-held slots do no work
        dt = step(active); t += dt; busy += dt * active
        for r in running: r[1] -= 1 if r[1] > 0 else 0
        done = [r for r in running if r[1] <= 0]
        if mode == "continuous" or all(r[1] <= 0 for r in running):
            for r in done: finished.append((r[0], t))
            running = [r for r in running if r[1] > 0] if mode == "continuous" else []
    lat = np.array([end - arrivals[i] for i, end in finished]) / 1000
    return lengths.sum() / (t / 1000), lat.mean(), np.percentile(lat, 95), busy / (t * slots)

print(f"\n{'scheduler':<12}{'tokens/s':>10}{'mean lat s':>12}{'p95 lat s':>11}{'slot util':>11}")
for mode in ("static", "continuous"):
    tput, mean, p95, util = simulate(mode)
    print(f"{mode:<12}{tput:>10.0f}{mean:>12.2f}{p95:>11.2f}{util:>11.0%}")`
  },
  lab: {
    title: 'Paged vs contiguous KV allocation', file: 'paged_kv_lab.py', browser: true,
    scenario: `<p>Explain to a customer’s platform team why their home-grown server fits far fewer conversations than vLLM on the same GPU. Simulate KV memory allocation for a stream of sequences with unknown final lengths: a contiguous allocator that reserves the maximum length per sequence up front, versus a paged allocator with 16-token blocks allocated on demand, plus prefix sharing for a common 1,024-token system prompt.</p>`,
    steps: ['Memory budget: 20,000 blocks of 16 tokens (320,000 token slots).', 'Sequences: prompt = 1,024 shared system tokens + 50 to 400 user tokens; output 20 to 800 tokens; max length 8,192.', 'Contiguous: reserve 8,192 slots per sequence; count how many fit at once and the share of reserved slots actually used.', 'Paged: allocate ceil(tokens / 16) blocks as sequences grow; count concurrent sequences at the end state.', 'Paged + prefix sharing: the 64 blocks of the system prompt are stored once and shared.'],
    checks: ['Contiguous allocation fits far fewer sequences and wastes most reserved memory.', 'Paged allocation waste is at most one partial block per sequence.', 'Prefix sharing raises capacity further.'],
    hints: ['Concurrent capacity at steady state = budget / average blocks per sequence.', 'Internal fragmentation in paging is (blocks × 16 − tokens) / (blocks × 16).'],
    starter: String.raw`import math, numpy as np
rng = np.random.default_rng(3)
BLOCK, BUDGET_BLOCKS, MAX_LEN, SYSTEM = 16, 20_000, 8_192, 1_024
n = 2000
user = rng.integers(50, 400, n); out = rng.integers(20, 800, n)
total_tokens = SYSTEM + user + out
# TODO: contiguous, paged, paged + prefix sharing`,
    solution: String.raw`import math, numpy as np
rng = np.random.default_rng(3)
BLOCK, BUDGET_BLOCKS, MAX_LEN, SYSTEM = 16, 20_000, 8_192, 1_024
n = 2000
user = rng.integers(50, 400, n); out = rng.integers(20, 800, n)
total_tokens = SYSTEM + user + out
budget_tokens = BUDGET_BLOCKS * BLOCK

contig_capacity = budget_tokens // MAX_LEN
contig_used = total_tokens.mean() / MAX_LEN
blocks = np.ceil(total_tokens / BLOCK)
paged_capacity = BUDGET_BLOCKS / blocks.mean()
frag = ((blocks * BLOCK - total_tokens) / (blocks * BLOCK)).mean()
sys_blocks = SYSTEM // BLOCK
own = np.ceil((user + out) / BLOCK)
shared_capacity = (BUDGET_BLOCKS - sys_blocks) / own.mean()

print(f"average sequence: {total_tokens.mean():.0f} tokens ({SYSTEM} shared system prompt)")
print(f"contiguous (reserve {MAX_LEN}):  {contig_capacity:>6.0f} concurrent sequences, {contig_used:.0%} of reserved memory used")
print(f"paged (16-token blocks):       {paged_capacity:>6.0f} concurrent sequences, {frag:.1%} internal fragmentation")
print(f"paged + prefix sharing:        {shared_capacity:>6.0f} concurrent sequences")
print(f"capacity gain vs contiguous: x{paged_capacity / contig_capacity:.1f} (paged), x{shared_capacity / contig_capacity:.1f} (with sharing)")`
  },
  design: {
    lead: '<p>Inference capacity is governed by memory and scheduling, not just FLOPs. Understanding prefill, decode and KV memory lets you set SLOs, read engine metrics, and pick the right optimisations for each workload.</p>',
    scale: [{ h: 'Separate SLOs', p: 'Set TTFT and TPOT targets separately; long-prompt RAG traffic and long-output generation traffic stress different phases (9.6).' }, { h: 'Prefix-heavy workloads', p: 'Agents and chat re-send long shared prefixes; prefix caching and prefix-aware routing to the replica that holds the prefix cut TTFT and cost.' }],
    fail: [{ h: 'KV exhaustion', p: 'When KV memory fills, engines queue or preempt sequences and latency spikes. Monitor KV utilisation and queue length, not just GPU utilisation.' }, { h: 'Long prompts stalling decodes', p: 'A 100k-token prefill can freeze other users’ streams; chunked prefill interleaves it with decode steps.' }],
    trade: [{ h: 'Batch size vs latency', p: 'Bigger batches raise throughput and slightly slow each sequence; pick the largest batch that meets the TPOT target.' }, { h: 'Context length vs concurrency', p: 'Allowing 128k contexts reserves memory that could serve many more short sessions; cap context per tier.' }],
    prompt: '<p>A customer’s self-hosted 70B model serves 40 users fine but latency explodes at 120. Diagnose and fix.</p>',
    answer: '<ul><li>Check KV-cache utilisation, queue length and preemptions: likely KV memory exhausted.</li><li>Enable or verify paged KV and prefix caching; cap max context per request; quantise weights or KV cache to free memory.</li><li>Use chunked prefill to stop long prompts stalling decode.</li><li>If still short, add replicas or GPUs per replica based on a capacity model (9.7); route by prefix to raise cache hits.</li></ul>'
  },
  quiz: [
    { q: 'Why is single-sequence decoding inefficient on GPUs?', o: ['It is compute-bound', 'Each step reads all weights from memory to produce one token, leaving compute idle', 'It uses too little memory', 'Tokens are large'], a: 1, why: 'Decode is memory-bandwidth-bound; batching shares the weight reads.' },
    { q: 'What does PagedAttention change?', o: ['The model weights', 'KV memory is allocated in fixed blocks on demand instead of reserved contiguously', 'The tokenizer', 'The sampling method'], a: 1, why: 'Paging removes fragmentation and over-reservation.' },
    { q: 'KV size per token for 80 layers, 8 KV heads, head dim 128, BF16?', o: ['32 KB', 'About 320 KB', '3.2 MB', '128 KB'], a: 1, why: '2 × 80 × 8 × 128 × 2 bytes = 327,680 bytes.' }
  ],
  interview: [
    { q: 'Explain prefill and decode and why they matter for serving.', a: '<p>Prefill processes the whole prompt in parallel and is compute-bound; it sets time to first token. Decode generates one token per step per sequence and is memory-bandwidth-bound because each step reads all weights; it sets time per output token. Throughput comes from batching decodes, which is limited by KV-cache memory, so engines use continuous batching, paged KV memory, prefix caching and chunked prefill.</p>' },
    { q: 'How would you estimate how many concurrent users a GPU server supports?', a: '<p>Subtract weights and runtime overhead from usable GPU memory, divide by KV bytes per token times the expected tokens per sequence to get concurrent sequences, then check that the decode step time at that batch size meets the TPOT target using a bandwidth-based estimate, and validate with a load test.</p>' }
  ]
});

/* ===================================================================== 9.4 */
L({
  id: '9.4', title: 'Speculative decoding and quantization', minutes: 55, roles: ['be'],
  tags: 'draft and verify · acceptance rate · lossless speed-up · EAGLE and n-gram drafts · FP8 · INT4 (AWQ, GPTQ) · KV-cache quantisation · accuracy checks',
  mental: 'Two families of tricks make decoding faster and cheaper. Speculative decoding lets a cheap drafter propose several tokens that the big model verifies in one pass, giving the same output distribution in fewer expensive steps. Quantisation stores weights (and the KV cache) in fewer bits, cutting memory and bandwidth at a small, measurable accuracy cost.',
  intro: `<p>Because decode is memory-bound (9.3), the big model can check several proposed tokens in one step for nearly the cost of generating one. Speculative decoding exploits that and, with the standard acceptance rule, is lossless: the output follows exactly the target model’s distribution. Quantisation attacks the same bottleneck differently by moving fewer bytes per step.</p>
  <p>Both are standard options in vLLM, SGLang and TensorRT-LLM. This lesson proves the speculative sampling rule numerically and measures quantisation error so you can reason about what you enable.</p>`,
  points: [
    'Speculative decoding: a drafter (small model, extra heads like EAGLE, or n-gram lookup from the prompt) proposes k tokens; the target scores all of them in one forward pass.',
    'Acceptance rule: accept a drafted token with probability min(1, p_target / p_draft); on rejection, sample from the normalised residual max(0, p_target − p_draft). This keeps the target distribution exactly.',
    'Expected tokens per target step with acceptance rate α and k drafts: (1 − α^(k+1)) / (1 − α). Gains are largest at small batch sizes and for predictable text such as code and structured output.',
    'Quantisation: FP8 weights roughly halve memory versus BF16 with small accuracy loss; 4-bit methods (AWQ, GPTQ and similar) quarter it with more risk; KV-cache quantisation raises concurrency.',
    'Outliers matter: per-channel or group-wise scales protect accuracy compared with a single scale per tensor.',
    'Always validate on your eval set after quantising; check task metrics, not just perplexity.'
  ],
  concept: { title: 'An intern drafts, the partner signs', body: `<p>An intern drafts the next few sentences; the partner reads them all at once and accepts the ones they would have written, fixing the first one they would not. When the intern is good, the partner signs several sentences per read. The partner’s final letter is exactly what they would have written alone, just faster. Quantisation is the partner reading a compressed copy of their notes: much quicker, occasionally missing a nuance, so you check the important letters.</p>` },
  walk: [
    { h: 'Turn it on in an engine', body: '<p>Engines expose speculative decoding and quantisation as configuration; exact flags vary by version, so check the docs for your release.</p>', lang: 'bash', file: 'serve.sh', code: String.raw`# FP8 weights and an n-gram drafter (illustrative vLLM-style configuration)
vllm serve meta-llama/Llama-3.1-70B-Instruct --tensor-parallel-size 2 --quantization fp8 \
  --speculative-config '{"method": "ngram", "num_speculative_tokens": 4, "prompt_lookup_max": 4}'` },
    { h: 'Predict the speed-up', body: '<p>With α = 0.7 and k = 4: (1 − 0.7^5) / 0.3 ≈ 2.77 tokens per target step. Each step costs a bit more (verifying k tokens and running the drafter), so real speed-ups are lower, often 1.5× to 3× at low concurrency, shrinking as batches grow and compute becomes the bottleneck.</p>' },
    { h: 'Quantise with a validation gate', body: '<p>Quantise, run the same eval suite (Phase 7) as the full-precision model, and ship only if task metrics stay within tolerance on every important slice.</p>' }
  ],
  analogy: `<p><b>Autocomplete with a strict editor.</b> Your phone suggests the next three words; you accept them when they are what you meant and type over them when not. Your message ends up identical to what you would have typed, in fewer keystrokes. Quantisation is texting in shorthand: much faster, fine for most messages, risky for a contract.</p>`,
  diagram: {
    title: 'Speculative decoding step',
    cols: [['ctx'], ['draft'], ['target'], ['acc', 'rej'], ['out']],
    nodes: [
      { id: 'ctx', label: 'Context', sub: 'tokens so far', tone: 'fde', info: 'Prompt plus accepted tokens.' },
      { id: 'draft', label: 'Drafter', sub: 'propose k tokens', tone: 'acc', info: 'Small model, extra heads or n-gram lookup; cheap.' },
      { id: 'target', label: 'Target model', sub: 'score k+1 positions in one pass', tone: 'be', info: 'One forward pass, nearly the cost of a single decode step when memory-bound.' },
      { id: 'acc', label: 'Accept prefix', sub: 'min(1, p/q) per token', tone: 'ok', info: 'Tokens accepted left to right until the first rejection.' },
      { id: 'rej', label: 'Resample', sub: 'from max(0, p − q)', tone: 'warn', info: 'Keeps the exact target distribution.' },
      { id: 'out', label: '1 to k+1 tokens', sub: 'per target step', info: 'More tokens per expensive step when the drafter agrees often.' }
    ],
    edges: [{ a: 'ctx', b: 'draft' }, { a: 'draft', b: 'target' }, { a: 'target', b: 'acc' }, { a: 'target', b: 'rej', dash: true }, { a: 'acc', b: 'out' }, { a: 'rej', b: 'out' }],
    caption: 'Cheap proposals, one expensive verification, identical output distribution.'
  },
  illustrated: { title: 'Weight memory by precision', body: `<div class="tbl"><table><thead><tr><th>model</th><th>BF16</th><th>FP8 / INT8</th><th>INT4</th></tr></thead><tbody>
    <tr><td>8B</td><td class="n">16 GB</td><td class="n">8 GB</td><td class="n">≈ 4.5 GB</td></tr>
    <tr><td>70B</td><td class="n">141 GB</td><td class="n">71 GB</td><td class="n">≈ 38 GB</td></tr>
    <tr><td>405B</td><td class="n">810 GB</td><td class="n">405 GB</td><td class="n">≈ 215 GB</td></tr></tbody></table></div>
    <p>INT4 sizes include a small overhead for scales. Halving bytes per weight roughly halves the time each decode step spends reading weights.</p>` },
  code: {
    title: 'Speculative sampling is lossless, and how much it helps', file: 'speculative.py', browser: true,
    intro: '<p>A toy vocabulary with a target distribution p and a drafter distribution q that disagree. We implement the accept/resample rule, draw 200,000 tokens, and show that the empirical distribution matches p, not q. Then we measure tokens per target step for drafts of length k and compare with the closed-form expectation.</p>',
    src: String.raw`import numpy as np
rng = np.random.default_rng(0)
V = 6
p = np.array([0.40, 0.25, 0.15, 0.10, 0.07, 0.03])      # target model
q = np.array([0.30, 0.35, 0.05, 0.15, 0.10, 0.05])      # drafter (cheaper, different)

def speculative_token(p, q):
    x = rng.choice(V, p=q)                                # drafter proposes
    if rng.random() < min(1.0, p[x] / q[x]):              # accept with prob min(1, p/q)
        return x, True
    resid = np.maximum(p - q, 0); resid /= resid.sum()    # otherwise resample from the residual
    return rng.choice(V, p=resid), False

N = 200_000
draws = np.array([speculative_token(p, q)[0] for _ in range(N)])
emp = np.bincount(draws, minlength=V) / N
alpha = np.minimum(p, q).sum()                            # acceptance rate = sum of min(p, q)
print("target p   :", np.round(p, 3))
print("drafter q  :", np.round(q, 3))
print("empirical  :", np.round(emp, 3), "<- matches p, not q")
print(f"acceptance rate alpha = {alpha:.3f}")

def tokens_per_step(k, trials=20_000):
    total = 0
    for _ in range(trials):
        n = 0
        for _ in range(k):
            _, ok = speculative_token(p, q); n += 1
            if not ok:
                break
        else:
            n += 1                                        # all k accepted: the target also yields one bonus token
        total += n
    return total / trials

print(f"\n{'k':>2} {'simulated':>10} {'formula':>8}")
for k in (1, 2, 4, 8):
    print(f"{k:>2} {tokens_per_step(k):>10.2f} {(1 - alpha ** (k + 1)) / (1 - alpha):>8.2f}")`
  },
  lab: {
    title: 'Quantise a weight matrix and measure the damage', file: 'quantize_lab.py', browser: true,
    scenario: `<p>A customer wants to serve a model in INT4 to fit on fewer GPUs. Before trusting the benchmark slide, measure on a realistic weight matrix with outlier channels how much output error each scheme introduces: INT8 per-tensor, INT8 per-channel, INT4 per-channel, and INT4 group-wise (groups of 64), relative to BF16-like float results.</p>`,
    steps: ['Create a 1024×1024 weight matrix with normal values and a few outlier input channels scaled by 20 (seeded).', 'Implement symmetric quantise-dequantise with a given number of bits and scale granularity.', 'Multiply a batch of 64 random activation vectors by the original and each dequantised matrix.', 'Report relative output error (Frobenius norm of the difference over norm of the original) and bytes per weight including scales.', 'Explain why group-wise scales help.'],
    checks: ['Per-tensor INT8 error is noticeably larger than per-channel INT8 because of outliers.', 'Group-wise INT4 beats per-channel INT4.', 'Memory per weight is reported including scale overhead.'],
    hints: ['Symmetric: scale = max|w| / (2^(bits-1) - 1); q = round(w / scale) clipped.', 'For groups, reshape the input dimension into (groups, 64) and compute one scale per group per output row.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(1)
W = rng.normal(0, 0.02, (1024, 1024)).astype(np.float32)        # (out, in)
W[:, rng.choice(1024, 8, replace=False)] *= 20                   # outlier input channels
X = rng.normal(0, 1, (64, 1024)).astype(np.float32)

def quant_dequant(w, bits, axis=None, group=None):
    # TODO
    return w

ref = X @ W.T
# TODO: compare schemes`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(1)
W = rng.normal(0, 0.02, (1024, 1024)).astype(np.float32)
W[:, rng.choice(1024, 8, replace=False)] *= 20
X = rng.normal(0, 1, (64, 1024)).astype(np.float32)

def qdq(w, bits, scale):
    qmax = 2 ** (bits - 1) - 1
    return np.clip(np.round(w / scale), -qmax, qmax) * scale

def quant_dequant(w, bits, mode):
    qmax = 2 ** (bits - 1) - 1
    if mode == "tensor":
        return qdq(w, bits, np.abs(w).max() / qmax), 1
    if mode == "channel":                                      # one scale per output row
        return qdq(w, bits, np.abs(w).max(axis=1, keepdims=True) / qmax), w.shape[0]
    g = w.reshape(w.shape[0], -1, 64)                          # group-wise along the input dimension
    s = np.abs(g).max(axis=2, keepdims=True) / qmax
    return qdq(g, bits, s).reshape(w.shape), s.size

ref = X @ W.T
print(f"{'scheme':<22}{'rel. output error':>18}{'bits/weight':>13}")
for name, bits, mode in [("INT8 per-tensor", 8, "tensor"), ("INT8 per-channel", 8, "channel"),
                         ("INT4 per-channel", 4, "channel"), ("INT4 group-64", 4, "group")]:
    wq, n_scales = quant_dequant(W, bits, mode)
    err = np.linalg.norm(X @ wq.T - ref) / np.linalg.norm(ref)
    bpw = bits + 16 * n_scales / W.size                        # scales stored in 16 bits
    print(f"{name:<22}{err:>18.4f}{bpw:>13.2f}")
print("\nGroup-wise scales adapt to local ranges, so one outlier channel no longer forces a coarse step size on every weight.")`
  },
  design: {
    lead: '<p>Speed-ups and memory savings are product decisions with quality risk. Treat each as a configuration change gated by evals and load tests, and know when each one helps.</p>',
    scale: [{ h: 'Low concurrency, long outputs', p: 'Speculative decoding shines for interactive, low-batch traffic and predictable outputs (code, JSON); at high batch sizes the GPU becomes compute-bound and gains shrink.' }, { h: 'Memory-limited serving', p: 'Quantisation lets a model fit on fewer GPUs or serve more sequences; KV-cache quantisation targets long-context workloads.' }],
    fail: [{ h: 'Silent quality loss', p: 'A quantised model can look fine on general benchmarks and fail on your domain (numbers, rare languages). Gate on your evals.' }, { h: 'Poor drafters', p: 'A drafter with low acceptance adds cost and latency. Monitor acceptance rate in production.' }],
    trade: [{ h: 'FP8 vs INT4', p: 'FP8 is a safe default on hardware that supports it; INT4 saves more memory with more risk.' }, { h: 'Speculation vs batching', p: 'Speculation spends spare compute; if batches already saturate compute, it can hurt throughput.' }],
    prompt: '<p>A coding assistant on a self-hosted 70B model has slow token rates for single users at night and memory pressure at peak. What do you try?</p>',
    answer: '<ul><li>FP8 weights (and possibly FP8 KV cache) to free memory at peak, validated on code evals.</li><li>Speculative decoding with an n-gram or EAGLE-style drafter, which suits code; monitor acceptance rate and TPOT at low and high load.</li><li>Configure speculation to back off at high concurrency if throughput drops.</li><li>Load-test both settings; ship behind a flag with eval gates.</li></ul>'
  },
  quiz: [
    { q: 'Why is standard speculative decoding lossless?', o: ['The drafter is perfect', 'The accept/resample rule guarantees outputs follow the target model’s distribution exactly', 'It skips sampling', 'It uses greedy decoding only'], a: 1, why: 'Accepting with min(1, p/q) and resampling from the residual reproduces p.' },
    { q: 'With acceptance rate 0.8 and k = 4, expected tokens per target step is about:', o: ['1.0', '3.4', '5.0', '0.8'], a: 1, why: '(1 − 0.8^5) / 0.2 ≈ 3.36.' },
    { q: 'Why do group-wise scales help quantisation?', o: ['They use fewer bits', 'Outliers only affect the scale of their own group, not the whole tensor or row', 'They remove the need for evals', 'They speed up prefill'], a: 1, why: 'Finer granularity keeps step sizes small for normal weights.' }
  ],
  interview: [
    { q: 'How does speculative decoding speed up inference without changing outputs?', a: '<p>A cheap drafter proposes several tokens; the target model scores them all in one forward pass, which costs about one decode step because decoding is memory-bound. Tokens are accepted with probability min(1, p/q) and the first rejection is resampled from the residual distribution, so the output distribution equals the target’s. Speed-up depends on the acceptance rate and draft length and is largest at low batch sizes.</p>' },
    { q: 'What would you check before shipping an INT4 model?', a: '<p>Task metrics on the full eval set and per slice versus the full-precision model, especially numeric reasoning, rare languages and long contexts; latency and throughput gains under realistic load; and the quantisation method’s handling of outliers. Ship behind a flag with a rollback path.</p>' }
  ]
});

/* ===================================================================== 9.5 */
L({
  id: '9.5', title: 'vLLM and SGLang hands-on', minutes: 55, roles: ['be'],
  tags: 'OpenAI-compatible servers · engine flags · prefix caching · RadixAttention · load testing · TTFT/TPOT/throughput curves · Prometheus metrics',
  mental: 'vLLM and SGLang turn open-weight models into OpenAI-compatible HTTP services with continuous batching, paged KV memory and prefix caching built in. Your job is to configure them for the workload and prove the configuration with a load test that measures TTFT, TPOT and throughput as concurrency rises.',
  intro: `<p>When a customer needs data to stay on their own infrastructure, wants a fine-tuned open model, or has volumes where per-token API prices hurt, you serve models yourself. vLLM (from UC Berkeley’s Sky Lab, now a large open-source project) and SGLang (whose RadixAttention reuses KV cache across requests with shared prefixes) are the two most common open-source engines in 2026, alongside NVIDIA’s TensorRT-LLM.</p>
  <p>This lesson runs no GPU: you will configure the engines on paper and build the load-testing client against a simulated engine, which is exactly the client you would point at a real one.</p>`,
  points: [
    'Both engines expose OpenAI-compatible endpoints (<code class="i">/v1/chat/completions</code>), so existing SDKs and gateways work unchanged.',
    'Key settings: model and revision, tensor parallel size, max model length, GPU memory fraction for KV cache, quantisation, max concurrent sequences, prefix caching.',
    'SGLang’s RadixAttention organises cached prefixes in a radix tree, which suits agents and multi-turn chat with heavy prefix reuse.',
    'Measure with a load test across concurrency levels: TTFT p50 and p95, TPOT, requests and output tokens per second, error rate.',
    'Engines export Prometheus metrics (running and waiting requests, KV-cache usage, token throughput); scrape and alert on them.',
    'Pin engine and model versions; re-benchmark on upgrades, since defaults and performance change between releases.'
  ],
  concept: { title: 'Find the knee of the curve', body: `<p>As you add concurrent users, throughput rises almost linearly at first because batches fill; then it flattens as the GPU saturates while latency climbs steeply. The “knee” is your operating point: the highest load where TTFT and TPOT still meet the SLO. Load tests exist to find it, for this model, this hardware and this traffic shape.</p>` },
  walk: [
    { h: 'Start the servers', body: '<p>Typical commands; flags evolve, so confirm against the docs for your version.</p>', lang: 'bash', file: 'serve.sh', code: String.raw`# vLLM: OpenAI-compatible server on port 8000
vllm serve meta-llama/Llama-3.1-8B-Instruct --max-model-len 16384 --gpu-memory-utilization 0.90 \
  --tensor-parallel-size 1 --served-model-name llama-8b

# SGLang: OpenAI-compatible server on port 30000
python -m sglang.launch_server --model-path meta-llama/Llama-3.1-8B-Instruct --port 30000

curl -s localhost:8000/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model": "llama-8b", "messages": [{"role": "user", "content": "Say hi"}], "max_tokens": 20}'` },
    { h: 'Use any OpenAI client', body: '<p>Point the SDK at the server’s base URL; streaming works the same.</p>', code: String.raw`from openai import AsyncOpenAI
client = AsyncOpenAI(base_url="http://gpu-node-1:8000/v1", api_key="unused")
stream = await client.chat.completions.create(model="llama-8b", messages=msgs, stream=True, max_tokens=256)` },
    { h: 'Load test realistically', body: '<p>Replay your real prompt and output length distributions (not “hello” with 10 tokens), ramp concurrency, measure per-request TTFT and TPOT from the stream, and plot the curves.</p>' }
  ],
  analogy: `<p><b>Stress-testing a bridge.</b> You add trucks in stages and measure deflection at each load. Up to a point the bridge carries more with little change; past it, deflection grows fast. Engineers certify the bridge below that point with a safety margin. Load tests certify an inference deployment the same way.</p>`,
  diagram: {
    title: 'Self-hosted serving stack',
    cols: [['lt', 'gw'], ['lb'], ['v1', 'v2'], ['prom'], ['dash']],
    nodes: [
      { id: 'lt', label: 'Load tester', sub: 'real prompt mix', tone: 'fde', info: 'Ramps concurrency and records TTFT/TPOT per request.' },
      { id: 'gw', label: 'Gateway', sub: 'OpenAI-compatible', info: 'Routes production traffic (9.1).' },
      { id: 'lb', label: 'Load balancer', sub: 'prefix-aware optional', tone: 'acc', info: 'Routing by prefix increases cache hits.' },
      { id: 'v1', label: 'vLLM replica', sub: 'TP=2 · FP8', tone: 'be', info: 'Continuous batching, paged KV, prefix cache.' },
      { id: 'v2', label: 'SGLang replica', sub: 'RadixAttention', tone: 'be', info: 'Radix-tree prefix reuse for agentic traffic.' },
      { id: 'prom', label: 'Prometheus', sub: '/metrics scrape', info: 'Running and waiting requests, KV usage, tokens per second.' },
      { id: 'dash', label: 'Dashboards + alerts', sub: 'SLOs', tone: 'ok', info: 'TTFT and TPOT SLOs, KV saturation, queue length.' }
    ],
    edges: [{ a: 'lt', b: 'lb' }, { a: 'gw', b: 'lb' }, { a: 'lb', b: 'v1' }, { a: 'lb', b: 'v2' }, { a: 'v1', b: 'prom', dash: true }, { a: 'v2', b: 'prom', dash: true }, { a: 'prom', b: 'dash' }],
    caption: 'Engines behind a balancer, measured by load tests and scraped metrics.'
  },
  illustrated: { title: 'A load-test result to look for', body: `<div class="tbl"><table><thead><tr><th>concurrency</th><th>TTFT p95</th><th>TPOT p50</th><th>output tok/s</th><th>verdict</th></tr></thead><tbody>
    <tr><td class="n">8</td><td class="n">0.3 s</td><td class="n">18 ms</td><td class="n">430</td><td>fine, under-used</td></tr>
    <tr><td class="n">32</td><td class="n">0.6 s</td><td class="n">24 ms</td><td class="n">1,320</td><td>good</td></tr>
    <tr><td class="n">64</td><td class="n">1.4 s</td><td class="n">33 ms</td><td class="n">1,900</td><td>knee: operate here with headroom</td></tr>
    <tr><td class="n">128</td><td class="n">6.8 s</td><td class="n">41 ms</td><td class="n">2,050</td><td>queueing: TTFT SLO broken</td></tr></tbody></table></div>
    <p>Illustrative shape; your numbers depend on model, GPU and traffic.</p>` },
  code: {
    title: 'A streaming load tester against a simulated OpenAI-compatible engine', file: 'loadtest.py', deps: 'uv add openai numpy',
    intro: '<p class="callout"><b>No GPU needed</b> The OpenAI SDK is real; the server is a simulated engine behind a mock transport, with step times that grow with the number of active sequences and prefill time that grows with prompt length, like a continuous-batching server. Point <code class="i">base_url</code> at a real vLLM or SGLang server to run the same test for real.</p><p>We ramp concurrency, stream every response, and compute TTFT, TPOT and throughput per level.</p>',
    src: String.raw`import asyncio, json, time
import numpy as np
from openai import AsyncOpenAI
try:
    import httpx2 as httpx
except ImportError:
    import httpx

ACTIVE = {"n": 0}
SCALE = 0.2                                          # run the simulation 5x faster than real time
async def engine(request):
    body = json.loads(request.content)
    prompt_tokens = sum(len(m["content"].split()) for m in body["messages"]) * 1.3
    out_tokens = body.get("max_tokens", 128)
    async def gen():
        ACTIVE["n"] += 1
        try:
            await asyncio.sleep(SCALE * (0.02 + prompt_tokens * 0.00004 * (1 + ACTIVE["n"] / 32)))      # queue + prefill
            for i in range(out_tokens):
                chunk = {"id": "c", "object": "chat.completion.chunk", "created": 0, "model": body["model"],
                         "choices": [{"index": 0, "delta": {"content": "tok "}, "finish_reason": None}]}
                yield f"data: {json.dumps(chunk)}\n\n".encode()
                await asyncio.sleep(SCALE * (0.012 + 0.0004 * ACTIVE["n"]))                                # decode step
            yield b"data: [DONE]\n\n"
        finally:
            ACTIVE["n"] -= 1
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=gen())

client = AsyncOpenAI(base_url="http://gpu-node-1:8000/v1", api_key="unused",
                     http_client=httpx.AsyncClient(transport=httpx.MockTransport(engine)))
rng = np.random.default_rng(4)

async def one_request():
    prompt = "word " * int(rng.integers(200, 1500))
    t0 = time.perf_counter(); first = None; n = 0
    stream = await client.chat.completions.create(model="llama-8b", messages=[{"role": "user", "content": prompt}],
                                                  stream=True, max_tokens=int(rng.integers(40, 120)))
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            n += 1
            if first is None: first = time.perf_counter()
    end = time.perf_counter()
    return (first - t0) / SCALE, (end - first) / max(1, n - 1) / SCALE, n

async def level(concurrency, requests=48):
    sem = asyncio.Semaphore(concurrency)
    async def bounded():
        async with sem: return await one_request()
    t0 = time.perf_counter()
    res = await asyncio.gather(*(bounded() for _ in range(requests)))
    wall = (time.perf_counter() - t0) / SCALE
    ttft = np.array([r[0] for r in res]); tpot = np.array([r[1] for r in res]); toks = sum(r[2] for r in res)
    return np.percentile(ttft, 50), np.percentile(ttft, 95), np.median(tpot) * 1000, toks / wall

async def main():
    print(f"{'conc':>5}{'TTFT p50':>10}{'TTFT p95':>10}{'TPOT ms':>9}{'out tok/s':>11}")
    for c in (1, 4, 16, 48):
        p50, p95, tpot, tps = await level(c)
        print(f"{c:>5}{p50:>9.2f}s{p95:>9.2f}s{tpot:>9.1f}{tps:>11.0f}")

asyncio.run(main())`
  },
  lab: {
    title: 'Find the operating point from a load test', file: 'knee_lab.py', browser: true,
    scenario: `<p>You load-tested a customer’s vLLM deployment at concurrency levels from 4 to 256. Their SLOs: TTFT p95 under 1.5 s and TPOT p50 under 40 ms. Parse the results, find the highest concurrency meeting both SLOs, keep 20% headroom, and compute how many replicas they need for a peak of 900 concurrent conversations.</p>`,
    steps: ['Use the measured table in the starter (concurrency, TTFT p95, TPOT p50, output tokens/s).', 'Find the maximum concurrency meeting both SLOs.', 'Apply 20% headroom: operating concurrency = 0.8 × that level.', 'Replicas = ceil(900 / operating concurrency); total output tokens per second at peak.', 'Print a one-paragraph recommendation including what would change the answer.'],
    checks: ['The chosen level meets both SLOs.', 'Replica count includes headroom.', 'The recommendation names the binding SLO.'],
    hints: ['Interpolate linearly between measured points for a finer answer if you like.', 'The binding SLO is the one that fails first as concurrency rises.'],
    starter: String.raw`results = [  # concurrency, ttft_p95_s, tpot_p50_ms, out_tokens_per_s
    (4, 0.21, 17, 230), (8, 0.25, 18, 440), (16, 0.34, 21, 800), (32, 0.62, 25, 1350),
    (48, 0.95, 29, 1720), (64, 1.38, 34, 1960), (96, 2.60, 39, 2140), (128, 4.90, 43, 2210), (256, 11.8, 52, 2260)]
SLO_TTFT, SLO_TPOT, PEAK = 1.5, 40, 900
# TODO`,
    solution: String.raw`import math
results = [  # concurrency, ttft_p95_s, tpot_p50_ms, out_tokens_per_s
    (4, 0.21, 17, 230), (8, 0.25, 18, 440), (16, 0.34, 21, 800), (32, 0.62, 25, 1350),
    (48, 0.95, 29, 1720), (64, 1.38, 34, 1960), (96, 2.60, 39, 2140), (128, 4.90, 43, 2210), (256, 11.8, 52, 2260)]
SLO_TTFT, SLO_TPOT, PEAK = 1.5, 40, 900

ok = [r for r in results if r[1] < SLO_TTFT and r[2] < SLO_TPOT]
best = max(ok, key=lambda r: r[0])
first_fail = next(r for r in results if r[0] > best[0])
binding = "TTFT p95" if first_fail[1] >= SLO_TTFT else "TPOT p50"
operating = int(best[0] * 0.8)
replicas = math.ceil(PEAK / operating)
per_conc_tps = best[3] / best[0]
print(f"max concurrency within SLOs: {best[0]} (TTFT p95 {best[1]} s, TPOT {best[2]} ms, {best[3]} tok/s)")
print(f"binding SLO: {binding} (fails at {first_fail[0]})")
print(f"operating point with 20% headroom: {operating} concurrent per replica -> {replicas} replicas for {PEAK} at peak")
print(f"expected peak output: ~{PEAK * per_conc_tps:,.0f} tokens/s across the fleet")
print("Recommendation: run each replica at ~51 concurrent conversations; TTFT is the binding constraint, so prefix caching,"
      " chunked prefill or shorter prompts would raise capacity before more GPUs. Re-test if prompt lengths or the model change.")`
  },
  design: {
    lead: '<p>Self-hosting trades API simplicity for control and potentially lower unit cost at scale. It succeeds when configuration is driven by measured load tests, capacity follows a model (9.7), and operations (upgrades, autoscaling, monitoring) are owned.</p>',
    scale: [{ h: 'Autoscale on the right signal', p: 'Scale on waiting requests or KV-cache utilisation, not CPU; GPU nodes take minutes to start, so keep warm capacity for bursts.' }, { h: 'Prefix-aware routing', p: 'Routing requests that share a prefix to the same replica multiplies prefix-cache hits; several routers support this.' }],
    fail: [{ h: 'Benchmarking the wrong traffic', p: 'Short synthetic prompts flatter results. Replay real length distributions and conversation patterns.' }, { h: 'Unpinned upgrades', p: 'Engine upgrades change defaults and performance. Pin versions, benchmark, roll out gradually.' }],
    trade: [{ h: 'vLLM vs SGLang vs TensorRT-LLM', p: 'All are strong; choose by model support, features you need, hardware, and your team’s operational familiarity, verified by your own benchmark.' }, { h: 'Self-host vs API', p: 'Self-hosting wins on control and high steady volume; APIs win on frontier quality, burst capacity and zero operations.' }],
    prompt: '<p>A customer must keep all data on-premises and expects 400 concurrent users of an 8B fine-tuned model. Plan the deployment.</p>',
    answer: '<ul><li>Benchmark vLLM and SGLang with their real prompts on their GPU type; choose by SLO-meeting concurrency per GPU.</li><li>Size replicas from the knee with headroom; add one replica for failures and rolling upgrades.</li><li>Gateway in front with auth, quotas and logging; prefix-aware routing if prompts share long prefixes.</li><li>Prometheus metrics, SLO alerts on TTFT and TPOT, autoscaling on queue length; pinned versions with a benchmark step in CI.</li></ul>'
  },
  quiz: [
    { q: 'Why do vLLM and SGLang expose OpenAI-compatible APIs?', o: ['It is required by law', 'So existing SDKs, gateways and tools work without changes', 'For faster decoding', 'To avoid streaming'], a: 1, why: 'Compatibility makes self-hosted models drop-in replacements.' },
    { q: 'Which signal best drives autoscaling of an inference fleet?', o: ['CPU utilisation', 'Waiting requests or KV-cache utilisation', 'Disk usage', 'Number of models'], a: 1, why: 'They reflect real serving saturation.' },
    { q: 'In a load test, the knee of the throughput curve is where:', o: ['Throughput starts', 'Throughput flattens while latency rises steeply', 'Errors begin', 'GPU memory is empty'], a: 1, why: 'Beyond it, added load mostly adds queueing.' }
  ],
  interview: [
    { q: 'How would you benchmark a self-hosted LLM deployment?', a: '<p>Replay realistic prompt and output length distributions with a streaming client, ramp concurrency, and record TTFT p50 and p95, TPOT, throughput and errors per level, plus engine metrics such as KV usage and queue length. Find the highest concurrency meeting SLOs, keep headroom, and repeat for each configuration change.</p>' },
    { q: 'What is RadixAttention?', a: '<p>SGLang’s approach to KV-cache reuse: cached prefixes are stored in a radix tree so requests sharing any prefix, such as system prompts, few-shot examples or earlier turns, reuse the cached KV blocks automatically, which cuts prefill cost and TTFT for agentic and multi-turn workloads.</p>' }
  ]
});

/* ===================================================================== 9.6 */
L({
  id: '9.6', title: 'Disaggregated prefill/decode', minutes: 50, roles: ['be'],
  tags: 'prefill and decode interference · separate pools · KV transfer · P:D ratio · NVIDIA Dynamo · llm-d · when it pays off',
  mental: 'Prefill and decode want different hardware behaviour and interfere when they share GPUs: long prefills stall everyone’s token streams. Disaggregation runs them on separate GPU pools and ships the KV cache from prefill to decode workers, so each pool is sized and tuned for its own phase and SLO.',
  intro: `<p>At large scale, mixing phases on the same GPU forces a compromise between TTFT and TPOT. Disaggregated serving, studied in research systems and now supported in vLLM, SGLang and TensorRT-LLM and orchestrated by frameworks such as NVIDIA Dynamo and the open-source llm-d project, separates them. Reported gains reach 2 to 3 times more goodput (requests meeting both SLOs) for some workloads, at the cost of KV transfer and operational complexity.</p>`,
  points: [
    'Interference: a long prefill occupies the GPU for hundreds of milliseconds, delaying decode steps for every active sequence (TPOT spikes).',
    'Disaggregation: prefill workers compute the prompt’s KV cache, transfer it over fast interconnect (NVLink, InfiniBand, RDMA) to decode workers, which generate tokens.',
    'Each pool scales independently: prefill capacity follows input tokens per second, decode capacity follows concurrent sequences and output tokens per second.',
    'The P:D ratio (prefill GPUs to decode GPUs) depends on the workload: long prompts with short answers (RAG) need more prefill; long generations need more decode.',
    'KV transfer cost is real: 320 KB per token for a 70B-class model means a 10k-token prompt ships about 3 GB of KV; bandwidth and latency budgets matter.',
    'Chunked prefill on colocated servers is the simpler first step; disaggregate when scale and SLO pressure justify it.'
  ],
  concept: { title: 'Prep kitchen and line cooks', body: `<p>Busy restaurants separate the prep kitchen (chopping, marinating in bulk) from the line (cooking each plate to order). When the same cooks do both, a big prep job stalls every order on the line. Splitting them lets each station be staffed for its own rhythm, at the cost of carrying trays between them. Disaggregated serving does the same with prefill and decode, and the trays are KV caches.</p>` },
  walk: [
    { h: 'Spot the interference', body: '<p>Symptoms on a colocated fleet: TPOT p99 spikes that correlate with long-prompt arrivals; good TTFT and bad streaming smoothness, or the reverse, depending on scheduler settings.</p>' },
    { h: 'Size the pools', body: '<p>Prefill GPUs needed ≈ input tokens per second ÷ prefill tokens per second per GPU. Decode GPUs needed ≈ concurrent sequences ÷ sequences per GPU at the TPOT target. Then check KV transfer bandwidth: input tokens per second × KV bytes per token.</p>' },
    { h: 'Try simpler things first', body: `<div class="tbl"><table><thead><tr><th>step</th><th>effort</th><th>effect</th></tr></thead><tbody>
      <tr><td>chunked prefill</td><td>configuration</td><td>limits how long a prefill can block decode steps</td></tr>
      <tr><td>separate fleets for long-prompt and chat traffic</td><td>routing</td><td>isolates the worst interference</td></tr>
      <tr><td>prefill/decode disaggregation</td><td>new infrastructure</td><td>independent scaling and tuning of both phases</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A newspaper printing plant.</b> Typesetting a whole edition (prefill) and running the presses (decode) were once done by the same crew, so a late page stopped the presses. Separating them, with plates carried between rooms, let each run at full speed. Carrying plates is the overhead you accept.</p>`,
  diagram: {
    title: 'Colocated vs disaggregated serving',
    cols: [['req'], ['router'], ['pf1', 'pf2'], ['xfer'], ['d1', 'd2', 'd3']],
    groups: [{ cols: [2], label: 'PREFILL POOL' }, { cols: [4], label: 'DECODE POOL' }],
    nodes: [
      { id: 'req', label: 'Requests', sub: 'mixed lengths', tone: 'fde', info: 'Long RAG prompts and chat turns.' },
      { id: 'router', label: 'Router', sub: 'KV-aware', tone: 'acc', info: 'Sends prefill to the prefill pool, picks a decode worker with capacity and, ideally, cached prefixes.' },
      { id: 'pf1', label: 'Prefill GPU', sub: 'compute-bound', tone: 'be', info: 'Large batches of prompt tokens.' },
      { id: 'pf2', label: 'Prefill GPU', sub: 'scales with input tok/s', tone: 'be', info: 'Sized for input token throughput and TTFT.' },
      { id: 'xfer', label: 'KV transfer', sub: 'NVLink · RDMA', tone: 'warn', info: 'Gigabytes per long prompt; needs fast interconnect.' },
      { id: 'd1', label: 'Decode GPU', sub: 'bandwidth-bound', tone: 'ok', info: 'Many concurrent sequences; tuned for TPOT.' },
      { id: 'd2', label: 'Decode GPU', sub: 'scales with sequences', tone: 'ok', info: 'Sized for concurrency and output tokens.' },
      { id: 'd3', label: 'Decode GPU', sub: 'no prefill stalls', tone: 'ok', info: 'Token streams no longer stall on long prompts.' }
    ],
    edges: [{ a: 'req', b: 'router' }, { a: 'router', b: 'pf1' }, { a: 'router', b: 'pf2' }, { a: 'pf1', b: 'xfer' }, { a: 'pf2', b: 'xfer' }, { a: 'xfer', b: 'd1' }, { a: 'xfer', b: 'd2' }, { a: 'xfer', b: 'd3' }],
    caption: 'Two pools, each sized and tuned for its phase, joined by KV transfer.'
  },
  illustrated: { title: 'Sizing a P:D split', body: `<p>Workload: 40 requests/s, 6,000 input tokens and 300 output tokens each. Assume a prefill GPU processes 30,000 input tokens/s and a decode GPU sustains 64 sequences at the TPOT target, each sequence lasting about 9 s.</p>
    <div class="tbl"><table><thead><tr><th>quantity</th><th>value</th></tr></thead><tbody>
    <tr><td>input tokens/s</td><td class="n">40 × 6,000 = 240,000 → 8 prefill GPUs</td></tr>
    <tr><td>concurrent decoding sequences</td><td class="n">40 × 9 s = 360 → 6 decode GPUs</td></tr>
    <tr><td>KV transfer (70B-class, 320 KB/token)</td><td class="n">240,000 × 320 KB ≈ 77 GB/s across the fleet</td></tr></tbody></table></div>
    <p>Illustrative numbers. A RAG-heavy workload like this needs more prefill than decode.</p>` },
  code: {
    title: 'Simulating interference and the effect of disaggregation', file: 'disagg_sim.py', browser: true,
    intro: '<p>A simple model of 8 GPUs serving a mix of long-prompt and chat requests. Colocated: each GPU runs its own prefills without chunking, and every prefill on a GPU stalls the decoding sequences there. Disaggregated: the same 8 GPUs split into prefill and decode pools, with KV transfer at 50 GB/s. We report TTFT and TPOT percentiles and goodput (requests meeting both SLOs) for several P:D splits. The model is deliberately simple; real engines add chunked prefill and smarter scheduling.</p>',
    src: String.raw`import numpy as np

def workload(n=800, seed=1, rate=18):
    rng = np.random.default_rng(seed)
    t = np.cumsum(rng.exponential(1 / rate, n))
    long = rng.random(n) < 0.3
    inp = np.where(long, rng.integers(8000, 24000, n), rng.integers(300, 1500, n))
    out = rng.integers(150, 400, n)
    return t, inp, out

PREFILL_TPS = 30_000
STEP = lambda active: 0.010 + 0.0004 * active
SLO_TTFT, SLO_TPOT = 1.5, 0.025

def colocated(gpus=8):
    t, inp, out = workload()
    n = len(t); g_of = np.arange(n) % gpus
    pre = inp / PREFILL_TPS
    ttft = np.zeros(n); start_dec = np.zeros(n); free = np.zeros(gpus)
    for i in range(n):                                   # prefills queue per GPU, run without chunking
        g = g_of[i]; s = max(t[i], free[g]); free[g] = s + pre[i]
        ttft[i] = s + pre[i] - t[i]; start_dec[i] = s + pre[i]
    conc = 18 * 0.02 * out.mean() / gpus
    base = out * STEP(conc)
    tpot = np.zeros(n)
    for i in range(n):                                   # other prefills on the same GPU stall this sequence's decode
        g = g_of[i]; end = start_dec[i] + base[i]
        others = (g_of == g) & (np.arange(n) != i) & (t + 0 >= start_dec[i]) & (t <= end)
        tpot[i] = (base[i] + pre[others].sum()) / out[i]
    return ttft, tpot

def disaggregated(p, d):
    t, inp, out = workload()
    n = len(t); pre = inp / PREFILL_TPS; free = np.zeros(p); ttft = np.zeros(n)
    for i in range(n):
        g = int(np.argmin(free)); s = max(t[i], free[g]); free[g] = s + pre[i]
        ttft[i] = s + pre[i] + inp[i] * 320e3 / 50e9 - t[i]
    conc = 18 * 0.02 * out.mean() / d
    return ttft, np.full(n, STEP(conc))

def report(name, ttft, tpot):
    good = np.mean((ttft < SLO_TTFT) & (tpot < SLO_TPOT))
    print(f"{name:<22} TTFT p50 {np.percentile(ttft, 50):5.2f}s p95 {np.percentile(ttft, 95):5.2f}s | "
          f"TPOT p50 {1000 * np.percentile(tpot, 50):5.1f}ms p95 {1000 * np.percentile(tpot, 95):5.1f}ms | goodput {good:.0%}")
report("colocated 8 GPUs", *colocated(8))
for p, d in [(2, 6), (3, 5), (4, 4), (5, 3)]:
    report(f"disaggregated {p}P:{d}D", *disaggregated(p, d))
print("\nthe ratio matters: too few prefill GPUs and requests queue for prefill (TTFT explodes); too few decode GPUs and TPOT rises.")`
  },
  lab: {
    title: 'Plan a P:D ratio and KV-transfer budget', file: 'pd_plan_lab.py', browser: true,
    scenario: `<p>A customer runs two traffic classes on a 70B-class model: RAG answers (8,000 input tokens, 250 output) at 25 requests/s and agent chat (1,500 input, 600 output) at 15 requests/s. Using the per-GPU capacities given, compute GPUs for a colocated design (sized for the worst SLO) and for a disaggregated design, the KV transfer bandwidth needed, and whether the interconnect budget allows it.</p>`,
    steps: ['Per GPU: prefill 35,000 input tokens/s; decode 56 concurrent sequences at the TPOT SLO with a decode speed of 30 tokens/s per sequence.', 'Prefill GPUs = total input tokens/s ÷ 35,000 (add 20% headroom).', 'Decode GPUs = concurrent sequences ÷ 56, where concurrency = sum over classes of rate × output tokens ÷ 30 (add 20% headroom).', 'KV transfer = input tokens/s × 320 KB; compare with a fabric budget of 400 GB/s.', 'Colocated estimate: assume interference forces running decode GPUs at 60% of their concurrency; compute the total GPUs needed and compare.'],
    checks: ['Both designs’ GPU counts are reported with headroom.', 'KV bandwidth is compared with the fabric budget.', 'The recommendation states which class drives each pool.'],
    hints: ['Concurrency from Little’s law: arrival rate × time in system.', 'Round GPU counts up.'],
    starter: String.raw`import math
CLASSES = {"rag": {"rate": 25, "inp": 8000, "out": 250}, "agent": {"rate": 15, "inp": 1500, "out": 600}}
PREFILL_TPS, DECODE_SEQS, DECODE_TOK_S, KV_PER_TOKEN, FABRIC_GBPS = 35_000, 56, 30, 320e3, 400
# TODO`,
    solution: String.raw`import math
CLASSES = {"rag": {"rate": 25, "inp": 8000, "out": 250}, "agent": {"rate": 15, "inp": 1500, "out": 600}}
PREFILL_TPS, DECODE_SEQS, DECODE_TOK_S, KV_PER_TOKEN, FABRIC_GBPS = 35_000, 56, 30, 320e3, 400
H = 1.2

input_tps = {k: c["rate"] * c["inp"] for k, c in CLASSES.items()}
concurrency = {k: c["rate"] * c["out"] / DECODE_TOK_S for k, c in CLASSES.items()}
prefill_gpus = math.ceil(sum(input_tps.values()) * H / PREFILL_TPS)
decode_gpus = math.ceil(sum(concurrency.values()) * H / DECODE_SEQS)
kv_gbps = sum(input_tps.values()) * KV_PER_TOKEN / 1e9
colocated = math.ceil(sum(input_tps.values()) * H / PREFILL_TPS + sum(concurrency.values()) * H / (DECODE_SEQS * 0.6))

print("input tokens/s:", {k: f"{v:,}" for k, v in input_tps.items()}, "| decoding concurrency:", {k: round(v) for k, v in concurrency.items()})
print(f"disaggregated: {prefill_gpus} prefill + {decode_gpus} decode = {prefill_gpus + decode_gpus} GPUs")
print(f"colocated (decode at 60% efficiency from interference): ~{colocated} GPUs")
print(f"KV transfer: {kv_gbps:.0f} GB/s vs fabric budget {FABRIC_GBPS} GB/s -> {'OK' if kv_gbps < 0.7 * FABRIC_GBPS else 'too close: add bandwidth or compress KV'}")
print(f"prefill pool driven by RAG ({input_tps['rag'] / sum(input_tps.values()):.0%} of input tokens); decode pool driven by agent chat ({concurrency['agent'] / sum(concurrency.values()):.0%} of concurrency)")`
  },
  design: {
    lead: '<p>Disaggregation is an advanced optimisation for large fleets with strict, conflicting latency SLOs. Its success depends on accurate workload modeling, fast interconnects, KV-aware routing and the operational maturity to run two pools.</p>',
    scale: [{ h: 'Independent autoscaling', p: 'Scale prefill on input-token rate and queueing, decode on concurrent sequences and TPOT; traffic mix shifts move the optimal ratio during the day.' }, { h: 'KV-aware routing', p: 'Route to decode workers that already hold a request’s prefix to avoid transfers; orchestration frameworks such as Dynamo and llm-d provide this.' }],
    fail: [{ h: 'Interconnect bottleneck', p: 'Without fast fabric, KV transfer dominates TTFT. Measure transfer time at realistic prompt sizes before committing.' }, { h: 'Mis-sized pools', p: 'A fixed ratio tuned on Tuesday’s traffic underperforms on Friday’s. Monitor queueing in both pools and rebalance.' }],
    trade: [{ h: 'Goodput vs complexity', p: 'Gains of up to 2 to 3 times goodput are reported for some workloads; for small fleets or mild SLOs, chunked prefill on colocated servers is enough.' }, { h: 'Hardware specialisation', p: 'Pools can use different GPU types (compute-rich for prefill, memory-rich for decode), adding procurement and scheduling complexity.' }],
    prompt: '<p>When would you recommend disaggregated serving to a customer?</p>',
    answer: '<ul><li>Large, steady traffic (tens of GPUs or more) with strict TTFT and TPOT SLOs that conflict under colocation.</li><li>Prompt-heavy workloads (RAG, long agent contexts) where prefill interference is measurable.</li><li>Fast interconnect available and a team able to operate two pools.</li><li>Otherwise: chunked prefill, traffic-class routing and prefix caching first.</li></ul>'
  },
  quiz: [
    { q: 'What problem does disaggregation solve?', o: ['Model accuracy', 'Interference between compute-heavy prefill and bandwidth-bound decode on shared GPUs', 'Tokenization', 'Prompt injection'], a: 1, why: 'Separating phases lets each meet its own SLO.' },
    { q: 'What must move between prefill and decode workers?', o: ['Model weights', 'The prompt’s KV cache', 'The tokenizer', 'Nothing'], a: 1, why: 'Decode needs the KV cache produced by prefill.' },
    { q: 'A RAG workload with long prompts and short answers needs relatively more:', o: ['Decode GPUs', 'Prefill GPUs', 'CPU cores', 'Storage'], a: 1, why: 'Input tokens dominate the work.' }
  ],
  interview: [
    { q: 'Explain disaggregated prefill and decode.', a: '<p>Prefill is compute-bound and bursty; decode is memory-bandwidth-bound and steady. On shared GPUs, long prefills stall decode steps and raise TPOT. Disaggregation runs prefill and decode on separate pools, transfers the KV cache over fast interconnect, and lets each pool scale and tune independently, improving goodput for workloads with strict SLOs, at the cost of KV transfer and operational complexity.</p>' },
    { q: 'How would you size prefill and decode pools?', a: '<p>From the workload: input tokens per second divided by prefill throughput per GPU for the prefill pool; concurrent decoding sequences (arrival rate times generation time) divided by sequences per GPU at the TPOT target for the decode pool; plus headroom. Then check KV transfer bandwidth against the fabric and validate with a load test.</p>' }
  ]
});
})();
