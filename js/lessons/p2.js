/* Phase 2 · LLM foundations (bridge to AI-LLM Lab) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 2.1 */
L({
  id: '2.1', title: 'Tokens, context windows, sampling', minutes: 45, roles: ['fde', 'be'], llmlab: true,
  tags: 'tokenization · BPE · context window · temperature · top-p · determinism',
  mental: 'A model reads and writes tokens, not words. Every limit you hit in production (context length, cost, latency, rate limits) is counted in tokens, and every answer is a sample from a probability distribution you can shape with temperature and top-p.',
  sim: 'sampling',
  intro: `<p>AI-LLM Lab covers how tokenizers and transformers work inside. This lesson is the engineer’s view: the numbers you need to reason about a system. How many tokens is a support ticket? Why does the same prompt cost more in Hindi than in English? Why does a model give a different answer on the second try, and when should it not?</p>
  <p>FDEs use these numbers in the first week of a pilot to estimate cost from a customer’s data. AI backend engineers use them to set context budgets, rate limits and <code class="i">max_tokens</code> caps.</p>`,
  points: [
    'Subword tokenizers (BPE and relatives) split text into frequent pieces: common English words are one token, rare words and code identifiers are several.',
    'Non-Latin scripts and code often need more tokens per character, so the same meaning can cost 1.5 to 3 times more.',
    'The context window bounds input plus output tokens per request; long contexts also cost more and can lower attention to details in the middle.',
    'The model outputs a probability for every next token; <b>temperature</b> sharpens (&lt;1) or flattens (&gt;1) it, <b>top-p</b> keeps only the smallest set of tokens covering p of the probability mass.',
    'Use temperature 0 (or near it) for extraction, classification and tool arguments; higher values for brainstorming and creative text.',
    'Even at temperature 0, outputs are not guaranteed identical across runs or model versions. Design for variation; test structure, not exact wording.'
  ],
  concept: { title: 'Everything is metered in tokens', body: `<p>Price per million input and output tokens, tokens per minute rate limits, time to first token (which grows with input tokens) and decode speed (tokens per second): all four engineering constraints are token counts. Converting a customer’s workload into tokens is the first calculation in any AI design, and it is the bridge from “this demo works” to “this will cost $X per month and answer in Y seconds”.</p>` },
  walk: [
    { h: 'Learn a tiny BPE tokenizer', body: '<p>Byte-pair encoding starts from characters and repeatedly merges the most frequent adjacent pair. Run it: frequent words collapse into single tokens, rare ones stay split.</p>', code: String.raw`from collections import Counter

def train_bpe(corpus: list[str], merges: int) -> list[tuple[str, str]]:
    words = Counter(tuple(w) + ("</w>",) for line in corpus for w in line.split())
    rules = []
    for _ in range(merges):
        pairs = Counter()
        for w, f in words.items():
            for a, b in zip(w, w[1:]):
                pairs[(a, b)] += f
        if not pairs:
            break
        best = max(pairs, key=pairs.get)
        rules.append(best)
        new = {}
        for w, f in words.items():
            out, i = [], 0
            while i < len(w):
                if i < len(w) - 1 and (w[i], w[i + 1]) == best:
                    out.append(w[i] + w[i + 1]); i += 2
                else:
                    out.append(w[i]); i += 1
            new[tuple(out)] = f
        words = new
    return rules

def encode(word: str, rules) -> list[str]:
    toks = list(word) + ["</w>"]
    for a, b in rules:
        i, out = 0, []
        while i < len(toks):
            if i < len(toks) - 1 and toks[i] == a and toks[i + 1] == b:
                out.append(a + b); i += 2
            else:
                out.append(toks[i]); i += 1
        toks = out
    return toks

corpus = ["refund the charge", "the charge was refunded", "refund request for the invoice"] * 20
rules = train_bpe(corpus, merges=30)
for w in ["refund", "charge", "invoice", "chargeback", "reimbursement"]:
    print(f"{w:<14}", encode(w, rules))`, run: true, browser: true },
    { h: 'Estimate tokens before you call', body: '<p>Exact counts come from the provider’s token-counting endpoint or tokenizer. For planning, about 4 characters per token for English prose is a useful first estimate; code and many non-English languages need more tokens per character, so measure on real samples.</p>' },
    { h: 'Shape the distribution', body: '<p>Temperature divides the logits before softmax; top-p then cuts the low-probability tail. The simulator on the Visualize tab shows both on a real distribution.</p>', code: String.raw`import math

def probs(logits, temperature=1.0, top_p=1.0):
    t = max(temperature, 1e-6)
    ex = [math.exp(l / t) for l in logits]
    p = [e / sum(ex) for e in ex]
    order = sorted(range(len(p)), key=lambda i: -p[i])
    keep, cum = set(), 0.0
    for i in order:
        keep.add(i); cum += p[i]
        if cum >= top_p:
            break
    z = sum(p[i] for i in keep)
    return [round(p[i] / z, 3) if i in keep else 0.0 for i in range(len(p))]

tokens = ["billing", "bug", "other", "refund", "spam"]
logits = [3.1, 2.2, 1.0, 0.9, -1.5]
for t, tp in [(1.0, 1.0), (0.3, 1.0), (1.5, 1.0), (1.0, 0.8)]:
    print(f"T={t:<3} top_p={tp:<3}", dict(zip(tokens, probs(logits, t, tp))))`, run: true, browser: true }
  ],
  analogy: `<p><b>A taxi meter.</b> The model charges by distance travelled, and the distance is tokens. A long route (a 40-page contract in the prompt) costs more before the car even moves (prefill), and every word it speaks back adds to the fare (decode). Temperature is how adventurous the driver is: at 0 the same road every time, at 1.5 scenic detours.</p>`,
  diagram: {
    title: 'From text to a sampled answer',
    cols: [['txt'], ['tok'], ['ctx'], ['model'], ['dist'], ['samp', 'out']],
    nodes: [
      { id: 'txt', label: 'Text', sub: 'prompt + history', info: 'System prompt, conversation, retrieved documents and tool results, all concatenated.' },
      { id: 'tok', label: 'Tokenizer', sub: 'BPE pieces', tone: 'acc', info: 'Splits text into token ids. The count drives cost, latency and context limits.' },
      { id: 'ctx', label: 'Context window', sub: 'input + output ≤ limit', tone: 'be', info: 'Hard upper bound per request. Exceeding it is an error; filling it is expensive.' },
      { id: 'model', label: 'Model', sub: 'next-token logits', info: 'One forward pass per generated token after the prompt is processed once.' },
      { id: 'dist', label: 'Distribution', sub: 'temperature · top-p', tone: 'acc', info: 'Logits are turned into probabilities and reshaped by sampling parameters.' },
      { id: 'samp', label: 'Sample', sub: 'one token', info: 'A token is drawn; it is appended and the loop repeats until a stop token or max_tokens.' },
      { id: 'out', label: 'Answer', sub: 'stream of tokens', tone: 'ok', info: 'Output tokens are billed and limited by max_tokens.' }
    ],
    edges: [{ a: 'txt', b: 'tok', step: 1 }, { a: 'tok', b: 'ctx', step: 2 }, { a: 'ctx', b: 'model', step: 3 }, { a: 'model', b: 'dist', step: 4 }, { a: 'dist', b: 'samp', step: 5 }, { a: 'samp', b: 'model', dash: true, label: 'append', step: 6 }, { a: 'samp', b: 'out', step: 6 }],
    steps: ['Everything the model sees starts as text.', 'The tokenizer turns it into ids; count them.', 'Input plus planned output must fit the window.', 'Each step produces logits for the next token.', 'Sampling parameters reshape the distribution.', 'A token is drawn, appended, and the loop continues.'],
    caption: 'Tokens in, tokens out, one sampled step at a time.'
  },
  illustrated: { title: 'Pricing a customer’s workload in tokens', body: `<p>A customer sends 60,000 support tickets a month. A sample of 200 tickets averages 1,400 characters, the system prompt plus instructions is 2,000 characters, and answers average 600 characters.</p>
    <div class="tbl"><table><thead><tr><th>quantity</th><th>estimate</th></tr></thead><tbody>
    <tr><td>input per call</td><td class="n">(1,400 + 2,000) / 4 ≈ 850 tokens</td></tr>
    <tr><td>output per call</td><td class="n">600 / 4 ≈ 150 tokens</td></tr>
    <tr><td>monthly input</td><td class="n">60,000 × 850 = 51M tokens</td></tr>
    <tr><td>monthly output</td><td class="n">60,000 × 150 = 9M tokens</td></tr>
    <tr><td>cost at an example price of $1 / $5 per million in/out</td><td class="n">$51 + $45 = $96 per month</td></tr></tbody></table></div>
    <p>Prices here are placeholders; use your provider’s current price sheet. If 30% of tickets are in a script that needs twice the tokens, rerun the numbers with measured counts.</p>` },
  code: {
    title: 'Token budgets and sampling settings per task', file: 'token_budget.py', browser: true,
    intro: '<p>A small planning tool you can reuse: estimate tokens from samples, check a request fits the window with room for output, and pick sampling settings by task type.</p>',
    src: String.raw`from dataclasses import dataclass

CHARS_PER_TOKEN = {"en_prose": 4.0, "code": 3.0, "hi_devanagari": 2.0}   # measure these on your own data

@dataclass
class Budget:
    window: int
    max_output: int

    def check(self, parts: dict[str, int]) -> str:
        used = sum(parts.values())
        room = self.window - used - self.max_output
        detail = ", ".join(f"{k}={v}" for k, v in parts.items())
        return f"input={used} ({detail}) output_cap={self.max_output} -> " + ("OK, spare " + str(room) if room >= 0 else f"OVER by {-room}")

def est_tokens(text: str, kind: str = "en_prose") -> int:
    return round(len(text) / CHARS_PER_TOKEN[kind])

SAMPLING = {
    "classification": {"temperature": 0.0, "max_tokens": 20},
    "extraction":     {"temperature": 0.0, "max_tokens": 600},
    "reply_draft":    {"temperature": 0.4, "max_tokens": 400},
    "brainstorm":     {"temperature": 1.0, "max_tokens": 800},
}

ticket = "I was charged twice for the Pro plan on 14 October. Please refund the duplicate. " * 6
system = "You are a support triage assistant. Label tickets and draft replies following policy. " * 20
b = Budget(window=200_000, max_output=SAMPLING["reply_draft"]["max_tokens"])
print(b.check({"system": est_tokens(system), "ticket": est_tokens(ticket), "history": 1200}))

contract = "x" * 900_000
print(Budget(window=200_000, max_output=2000).check({"system": 500, "contract": est_tokens(contract)}))

for task, cfg in SAMPLING.items():
    print(f"{task:<15} {cfg}")`
  },
  lab: {
    title: 'A sampler you can reason about', file: 'sampler_lab.py', browser: true,
    scenario: `<p>A product manager asks why the triage label sometimes flips between “billing” and “bug” for the same ticket. Build a sampler with temperature and top-p, sample the same distribution 1,000 times at different settings, and show the flip rate, so you can explain and fix it.</p>`,
    steps: ['Implement softmax with temperature.', 'Implement top-p truncation and renormalisation.', 'Sample 1,000 times with a seeded RNG for T = 1.0, 0.5, 0.2 and greedy (argmax).', 'Report how often the label differs from the most likely one.', 'Write one sentence recommending settings for classification.'],
    checks: ['Greedy sampling never flips.', 'Flip rate falls as temperature falls.', 'Probabilities after top-p sum to 1.'],
    hints: ['Greedy is the limit of temperature going to 0: just take the argmax.', '<code class="i">random.choices(range(n), weights=p)</code> draws one index.'],
    starter: String.raw`import math, random
random.seed(0)
labels = ["billing", "bug", "other"]
logits = [2.0, 1.6, 0.2]

def softmax(logits, t):
    # TODO
    return [1 / len(logits)] * len(logits)

def sample(p):
    return random.choices(range(len(p)), weights=p)[0]

for t in [1.0, 0.5, 0.2]:
    p = softmax(logits, t)
    flips = sum(sample(p) != 0 for _ in range(1000))
    print(f"T={t}: p={[round(x, 3) for x in p]} flip rate={flips / 1000:.1%}")`,
    solution: String.raw`import math, random
random.seed(0)
labels = ["billing", "bug", "other"]
logits = [2.0, 1.6, 0.2]

def softmax(logits, t):
    m = max(logits)
    ex = [math.exp((l - m) / t) for l in logits]
    s = sum(ex)
    return [e / s for e in ex]

def top_p(p, cutoff):
    order = sorted(range(len(p)), key=lambda i: -p[i])
    keep, cum = [], 0.0
    for i in order:
        keep.append(i); cum += p[i]
        if cum >= cutoff:
            break
    z = sum(p[i] for i in keep)
    return [p[i] / z if i in keep else 0.0 for i in range(len(p))]

def sample(p):
    return random.choices(range(len(p)), weights=p)[0]

for t in [1.0, 0.5, 0.2]:
    p = softmax(logits, t)
    flips = sum(sample(p) != 0 for _ in range(1000))
    print(f"T={t}: p={[round(x, 3) for x in p]} flip rate={flips / 1000:.1%}")
p = top_p(softmax(logits, 1.0), 0.6)
print("top_p=0.6 keeps:", [l for l, x in zip(labels, p) if x], "sum", round(sum(p), 6))
greedy = max(range(3), key=lambda i: logits[i])
print("greedy flip rate: 0.0% (always", labels[greedy] + ")")
print("Recommendation: temperature 0 for classification, and treat close calls (billing 0.55 vs bug 0.37) as low confidence.")`
  },
  design: {
    lead: '<p>Token arithmetic is how you size, price and protect an AI system. The design decisions are budgets per request, caps per tenant, and which tasks get deterministic versus creative sampling.</p>',
    scale: [{ h: 'Budget per component', p: 'Give the system prompt, retrieved context, history and output each a token budget, so one long document cannot crowd out instructions or the answer (Phase 6.1).' }, { h: 'Count once, reuse', p: 'Count tokens at ingestion and store the count with each chunk so request assembly can budget without re-tokenizing.' }],
    fail: [{ h: 'Silent truncation', p: 'Some pipelines cut input to fit the window without telling anyone, dropping the part of the contract the user asked about. Fail loudly or summarise deliberately.' }, { h: 'max_tokens too low', p: 'Structured outputs cut off mid-JSON when max_tokens is too small. Size it from the schema and check the stop reason.' }],
    trade: [{ h: 'Bigger window vs retrieval', p: 'Stuffing 150k tokens into every call is simple but slow and expensive; retrieving the right 5k tokens is cheaper and often more accurate.' }, { h: 'Determinism vs variety', p: 'Low temperature makes outputs stable and testable; higher temperature gives variety but needs evals that tolerate it.' }],
    prompt: '<p>A legal customer wants to ask questions over 3,000 contracts averaging 40 pages each. Estimate tokens and say whether you would put contracts in the context or retrieve from them.</p>',
    answer: '<ul><li>About 500 words per page, 40 pages: about 20k words or roughly 27k tokens per contract; 3,000 contracts is about 80M tokens.</li><li>Single-contract questions: the whole contract fits in a long context window; cache it if many questions hit the same contract.</li><li>Cross-contract questions: retrieval over chunks with metadata filters; never put the corpus in context.</li><li>Set output caps and cite clause locations.</li></ul>'
  },
  quiz: [
    { q: 'Why might the same message cost more tokens in Hindi than in English?', o: ['Providers charge more for Hindi', 'Tokenizers trained mostly on English split Devanagari text into more tokens', 'Hindi needs a bigger model', 'It does not'], a: 1, why: 'Tokenizer vocabularies favour frequent scripts, so other scripts often need more tokens per character.' },
    { q: 'Which settings fit extracting invoice fields into JSON?', o: ['temperature 1.2', 'temperature 0 and a max_tokens sized for the schema', 'top_p 0.1 and temperature 2', 'Any; it does not matter'], a: 1, why: 'Extraction wants the most likely answer every time and enough room to finish the JSON.' },
    { q: 'What does top-p = 0.9 do?', o: ['Keeps the 90 most likely tokens', 'Samples only from the smallest set of tokens whose probabilities add up to 0.9', 'Sets temperature to 0.9', 'Limits output to 90% of max_tokens'], a: 1, why: 'It truncates the low-probability tail, then renormalises.' }
  ],
  interview: [
    { q: 'How do you estimate the monthly cost of an LLM feature before building it?', a: '<p>Sample real inputs, measure tokens with the provider’s counter, add system prompt and expected output, multiply by monthly volume and the per-token prices, then add retries and headroom. Then model the levers: caching repeated prefixes, smaller models for easy cases, shorter outputs.</p>' },
    { q: 'A test that compares model output to an expected string keeps failing intermittently. What do you change?', a: '<p>Model output varies even at temperature 0, so exact-string unit tests are the wrong tool. Constrain the output with a schema, assert on structure and the decision your code makes, and move quality checks into an eval suite with tolerant metrics.</p>' }
  ]
});

/* ===================================================================== 2.2 */
L({
  id: '2.2', title: 'Model landscape and selection', minutes: 45, roles: ['fde', 'be'], llmlab: true,
  tags: 'frontier vs small models · open weights · reasoning · eval-driven selection · fallbacks',
  mental: 'There is no best model, only the cheapest model that passes your eval for this task, with a fallback. Choose with your own data, not a leaderboard, and revisit the choice every time a new model ships.',
  intro: `<p>In 2026 a team can call frontier models from several labs, smaller and faster tiers of the same families, open-weight models they host themselves, and specialised models for embeddings, speech or vision. Model releases arrive every few weeks, so the decision is never made once.</p>
  <p>An FDE is constantly asked “which model should we use?” by customers whose procurement has already approved one cloud. An AI backend engineer builds the routing layer that lets the answer change without a code rewrite (Phase 9.1). Both need a repeatable selection method.</p>`,
  points: [
    'Model families come in tiers: the largest for hard reasoning and agents, mid tiers for most production work, the smallest for high-volume simple tasks.',
    'Hosted APIs are fastest to adopt; open-weight models give control over data location, cost at scale and customisation, at the price of running GPUs.',
    'Reasoning or extended-thinking modes improve hard multi-step tasks but add latency and output tokens; turn them on per task, not globally.',
    'Constraints often decide before quality does: data residency, approved cloud, context length, latency budget and price.',
    'Select with an eval on your own labelled examples: pick the cheapest model that clears the quality bar, then confirm latency and cost.',
    'Pin exact model versions in production and re-run the eval before moving to a new one.'
  ],
  concept: { title: 'Requirements first, leaderboard last', body: `<p>Public benchmarks measure someone else’s task. Your customer’s task has its own data, its own failure costs and its own constraints. The repeatable method: write the requirements, filter candidates by hard constraints, score the survivors on 100 to 500 of your own labelled examples, and pick the cheapest one above the bar, with a second model as fallback.</p>` },
  walk: [
    { h: 'Write requirements as numbers', body: '<div class="tbl"><table><thead><tr><th>requirement</th><th>example for ticket triage</th></tr></thead><tbody><tr><td>quality bar</td><td>≥ 92% label accuracy on 300 labelled tickets</td></tr><tr><td>latency</td><td>p95 under 1.5 s end to end</td></tr><tr><td>cost</td><td>under $0.002 per ticket</td></tr><tr><td>hard constraints</td><td>EU data residency, available on the customer’s approved cloud</td></tr></tbody></table></div>' },
    { h: 'Filter on constraints', body: '<p>Drop every model that fails a hard constraint before spending time on evals. This often removes half the list.</p>' },
    { h: 'Score on your eval set', body: '<p>Run each surviving model with the same prompt on the same labelled set. Record accuracy, p95 latency and cost per item. Keep the outputs; you will need them when the next model ships.</p>' },
    { h: 'Pick, pin and plan the fallback', body: '<p>Choose the cheapest model above the bar, pin its exact version string, and name a fallback (another provider or a bigger tier) for outages and hard cases.</p>' }
  ],
  analogy: `<p><b>Hiring for a role.</b> You would not hire the most famous candidate for every job. You write the job description (requirements), screen out people who cannot legally work in that country (hard constraints), give the shortlist the same work sample (eval set), and hire the one who meets the bar at a sensible salary, with a runner-up you could call.</p>`,
  diagram: {
    title: 'Eval-driven model selection',
    cols: [['req'], ['cand'], ['filt'], ['eval'], ['pick', 'fb']],
    nodes: [
      { id: 'req', label: 'Requirements', sub: 'quality · p95 · $', tone: 'acc', info: 'Numbers you can test: accuracy bar, latency budget, cost per item, hard constraints.' },
      { id: 'cand', label: 'Candidates', sub: 'hosted · open-weight', info: 'Tiers from several providers plus self-hosted open-weight options.' },
      { id: 'filt', label: 'Constraint filter', sub: 'residency · cloud', tone: 'fde', info: 'Remove anything the customer cannot legally or contractually use.' },
      { id: 'eval', label: 'Eval on your data', sub: '300 labelled items', tone: 'be', info: 'Same prompt, same data, every model. Measure quality, latency and cost.' },
      { id: 'pick', label: 'Pinned choice', sub: 'cheapest above bar', tone: 'ok', info: 'Exact version string in config, not "latest".' },
      { id: 'fb', label: 'Fallback', sub: 'outages · hard cases', info: 'Second model for provider incidents and low-confidence escalations.' }
    ],
    edges: [{ a: 'req', b: 'cand', step: 1 }, { a: 'cand', b: 'filt', step: 2 }, { a: 'filt', b: 'eval', step: 3 }, { a: 'eval', b: 'pick', step: 4 }, { a: 'eval', b: 'fb', dash: true, step: 4 }],
    steps: ['Write requirements as numbers.', 'List candidate models.', 'Remove those that break hard constraints.', 'Score the rest on your own labelled data, then pin the winner and name a fallback.'],
    caption: 'Constraints prune, evals decide, config pins.'
  },
  illustrated: { title: 'A selection run with three tiers', body: `<p>Illustrative results for ticket triage (fictional models and example prices, not real benchmark data):</p>
    <div class="tbl"><table><thead><tr><th>model</th><th>accuracy</th><th>p95</th><th>$ / 1k tickets</th><th>verdict</th></tr></thead><tbody>
    <tr><td>large</td><td class="n">96.0%</td><td class="n">2.4 s</td><td class="n">$9.80</td><td>fails latency</td></tr>
    <tr><td>medium</td><td class="n">94.3%</td><td class="n">1.1 s</td><td class="n">$2.10</td><td>passes</td></tr>
    <tr><td>small</td><td class="n">89.7%</td><td class="n">0.4 s</td><td class="n">$0.35</td><td>fails quality</td></tr></tbody></table></div>
    <p>Medium wins. A cascade (Phase 9.1) could do better still: small first, escalate to medium when confidence is low.</p>` },
  code: {
    title: 'A reusable model-selection scorer', file: 'select_model.py', browser: true,
    intro: '<p>Encode requirements, filter on constraints, score candidates on recorded eval results and pick the cheapest that passes. The candidates and numbers are illustrative; plug in your own eval output.</p>',
    src: String.raw`from dataclasses import dataclass

@dataclass
class Candidate:
    name: str
    regions: set[str]
    clouds: set[str]
    accuracy: float          # from YOUR eval set
    p95_s: float
    usd_per_1k: float

@dataclass
class Requirements:
    min_accuracy: float
    max_p95_s: float
    max_usd_per_1k: float
    region: str
    cloud: str

def select(cands: list[Candidate], req: Requirements):
    report = []
    for c in cands:
        why = []
        if req.region not in c.regions: why.append(f"no {req.region} residency")
        if req.cloud not in c.clouds: why.append(f"not on {req.cloud}")
        if c.accuracy < req.min_accuracy: why.append(f"accuracy {c.accuracy:.1%} < {req.min_accuracy:.0%}")
        if c.p95_s > req.max_p95_s: why.append(f"p95 {c.p95_s}s > {req.max_p95_s}s")
        if c.usd_per_1k > req.max_usd_per_1k: why.append(f"${'$'}{c.usd_per_1k}/1k over budget")
        report.append((c, why))
    passing = sorted((c for c, why in report if not why), key=lambda c: c.usd_per_1k)
    return passing, report

cands = [
    Candidate("vendor-a-large",  {"us", "eu"}, {"aws", "azure"}, 0.960, 2.4, 9.80),
    Candidate("vendor-a-medium", {"us", "eu"}, {"aws", "azure"}, 0.943, 1.1, 2.10),
    Candidate("vendor-a-small",  {"us", "eu"}, {"aws", "azure"}, 0.897, 0.4, 0.35),
    Candidate("vendor-b-medium", {"us"},       {"gcp"},          0.951, 0.9, 1.60),
    Candidate("open-weights-70b", {"eu", "us", "in"}, {"self-hosted", "aws"}, 0.928, 1.3, 1.20),
]
req = Requirements(min_accuracy=0.92, max_p95_s=1.5, max_usd_per_1k=3.0, region="eu", cloud="aws")
passing, report = select(cands, req)
for c, why in report:
    print(f"{c.name:<17} {'PASS' if not why else 'fail: ' + '; '.join(why)}")
print("choose:", passing[0].name, "| fallback:", passing[1].name if len(passing) > 1 else "none")`
  },
  lab: {
    title: 'Run a selection on simulated eval outputs', file: 'selection_lab.py', browser: true,
    scenario: `<p>You have predictions from three models on 300 labelled tickets (simulated with a seed, so the run is reproducible). Compute accuracy per model and per class, find where the cheaper model fails, and recommend a model plus a routing rule.</p>`,
    steps: ['Compute overall accuracy for each model.', 'Compute accuracy per true class; find the class where the small model is weakest.', 'Compute cost per 1,000 tickets from the given prices.', 'Recommend: cheapest model above 92%, or a rule such as “small model except for class X”.', 'Estimate the blended accuracy and cost of your rule.'],
    checks: ['Per-class table printed for all three models.', 'The routing rule’s blended accuracy is computed, not guessed.'],
    hints: ['Group by the true label, not the predicted one.', 'Blended accuracy = sum over classes of share × accuracy of the model used for that class.'],
    starter: String.raw`import random
random.seed(42)
CLASSES = ["billing", "bug", "how_to", "account"]
truth = [random.choice(CLASSES) for _ in range(300)]
SKILL = {"small": {"billing": .97, "bug": .70, "how_to": .95, "account": .93},
         "medium": {"billing": .97, "bug": .91, "how_to": .96, "account": .94},
         "large": {"billing": .98, "bug": .95, "how_to": .97, "account": .96}}
PRICE_PER_1K = {"small": 0.35, "medium": 2.10, "large": 9.80}
preds = {m: [t if random.random() < SKILL[m][t] else random.choice([c for c in CLASSES if c != t]) for t in truth] for m in SKILL}

# TODO: accuracy overall and per class, then a recommendation`,
    solution: String.raw`import random
random.seed(42)
CLASSES = ["billing", "bug", "how_to", "account"]
truth = [random.choice(CLASSES) for _ in range(300)]
SKILL = {"small": {"billing": .97, "bug": .70, "how_to": .95, "account": .93},
         "medium": {"billing": .97, "bug": .91, "how_to": .96, "account": .94},
         "large": {"billing": .98, "bug": .95, "how_to": .97, "account": .96}}
PRICE_PER_1K = {"small": 0.35, "medium": 2.10, "large": 9.80}
preds = {m: [t if random.random() < SKILL[m][t] else random.choice([c for c in CLASSES if c != t]) for t in truth] for m in SKILL}

def acc(model, cls=None):
    pairs = [(t, p) for t, p in zip(truth, preds[model]) if cls is None or t == cls]
    return sum(t == p for t, p in pairs) / len(pairs)

print(f"{'model':<7} overall " + " ".join(f"{c:>8}" for c in CLASSES) + "   $/1k")
for m in SKILL:
    print(f"{m:<7} {acc(m):7.1%} " + " ".join(f"{acc(m, c):8.1%}" for c in CLASSES) + f"   {PRICE_PER_1K[m]:.2f}")

share = {c: truth.count(c) / len(truth) for c in CLASSES}
# rule: the small model handles everything except tickets it would label "bug"; those go to medium
route = [("medium" if p == "bug" else "small") for p in preds["small"]]
final = [preds[r][i] for i, r in enumerate(route)]
blended = sum(t == f for t, f in zip(truth, final)) / len(truth)
cost = sum(PRICE_PER_1K[r] for r in route) / len(route) + PRICE_PER_1K["small"] * route.count("medium") / len(route)
print(f"rule 'small, escalate predicted bugs to medium': accuracy {blended:.1%}, ~${'$'}{cost:.2f} per 1k")
missed = sum(1 for t, p in zip(truth, preds["small"]) if t == "bug" and p != "bug")
print(f"small model's bug errors that it labelled as some other class: {missed}")
print("finding: escalating on the small model's PREDICTED label cannot catch those, so accuracy barely moves.")
print("recommendation: use medium now; to cut cost, route on a confidence score (Phase 9.1 cascades), not on the predicted label.")`
  },
  design: {
    lead: '<p>Model choice is a recurring operational decision, not a one-time architecture choice. Design so that swapping models is a config change gated by an eval, and so that different tasks in the same product can use different models.</p>',
    scale: [{ h: 'Per-task models', p: 'Classification, extraction, drafting and agent planning often want different tiers. Route per task through a gateway.' }, { h: 'Keep the eval harness warm', p: 'When a new model ships, re-running the same eval should take minutes, so you can adopt improvements or price cuts quickly.' }],
    fail: [{ h: 'Silent model updates', p: 'Aliases such as "latest" can change behaviour without a deploy. Pin versions; re-evaluate on purpose.' }, { h: 'Leaderboard choice', p: 'A model that tops a public benchmark may be worse on your domain, slower, or unavailable in the customer’s region.' }],
    trade: [{ h: 'Hosted vs self-hosted', p: 'Hosted: no GPUs, newest models, per-token cost. Self-hosted open weights: control and lower marginal cost at high volume, but you own serving, scaling and upgrades (Phase 9).' }, { h: 'One vendor vs several', p: 'One vendor simplifies contracts and prompts; several give resilience and price leverage but need a gateway and per-model prompt tuning.' }],
    prompt: '<p>A bank in India requires data to stay in India, wants under 2 seconds p95, and expects 3 million documents a month. Walk through model selection.</p>',
    answer: '<ul><li>Hard filter: models offered in an Indian region by an approved provider, or open weights self-hosted in India.</li><li>Eval on 300 to 500 of the bank’s documents with their labels; record accuracy, p95 and cost.</li><li>At 3M documents a month, compare per-token cost of hosted options with GPU cost for self-hosting.</li><li>Pin the winner, keep a fallback that also satisfies residency, re-evaluate quarterly.</li></ul>'
  },
  quiz: [
    { q: 'What should decide the model for a production task first?', o: ['The top public benchmark score', 'Hard constraints, then an eval on your own labelled data', 'The newest release', 'The largest context window'], a: 1, why: 'Constraints prune options; your own eval measures what matters for this task.' },
    { q: 'Why pin an exact model version?', o: ['It is cheaper', 'So behaviour does not change without an evaluated, deliberate upgrade', 'Providers require it', 'It increases the context window'], a: 1, why: 'Floating aliases can shift behaviour under you.' },
    { q: 'Two models both pass your quality bar. The usual pick is:', o: ['The larger one', 'The cheaper one that also meets latency, with the other as fallback', 'Both at random', 'Whichever has more parameters'], a: 1, why: 'Above the bar, cost and latency decide; keep a fallback for resilience.' }
  ],
  interview: [
    { q: 'A customer asks which LLM they should use. How do you answer?', a: '<p>I ask about the task, quality bar, latency, volume, data rules and approved clouds. Then I propose a short eval on their own data across two or three candidates that satisfy the constraints, and recommend the cheapest that passes, with a fallback and a plan to re-evaluate when models change.</p>' },
    { q: 'When would you self-host an open-weight model?', a: '<p>When data cannot leave an environment that hosted APIs do not cover, when volume is high and steady enough that GPU cost per token beats API pricing, or when we need fine-tuning or latency control that a hosted API cannot give. Otherwise hosted APIs are faster to ship and easier to operate.</p>' }
  ]
});

/* ===================================================================== 2.3 */
L({
  id: '2.3', title: 'Cost and latency math: TTFT, TPOT, tokens/s', minutes: 50, roles: ['be', 'fde'],
  tags: 'TTFT · TPOT · throughput · p95 · prompt caching · cost per request',
  mental: 'Latency has two parts: time to first token, driven by input size and queueing, and time per output token, driven by decode speed. Cost has two parts: input and output tokens. Once you can write both as formulas, you can predict, budget and optimize them.',
  sim: 'latency',
  intro: `<p>“It is slow” and “it is expensive” are the two complaints every AI system gets. The fix is always arithmetic first: break the time and the bill into parts, find the dominant one, and change that. Interviewers for AI backend roles ask exactly this: “where does the latency go in your RAG endpoint?”</p>
  <p>FDEs use the same formulas in customer meetings to set expectations before a pilot and to explain trade-offs to executives in numbers rather than adjectives.</p>`,
  points: [
    '<b>TTFT</b> (time to first token) ≈ network + queueing + prefill. Prefill grows with input tokens.',
    '<b>TPOT</b> (time per output token) is the decode step time; decode speed in tokens/s is its inverse.',
    'Total generation time ≈ TTFT + output_tokens × TPOT. Long answers are slow answers.',
    'Cost per request = input_tokens × input price + output_tokens × output price. Output tokens usually cost several times more than input.',
    'Prompt caching reuses a repeated prefix: on Anthropic’s API, cache writes cost 1.25× base input for the 5-minute TTL and reads cost a fraction of base input (0.1× by default), and cached prefixes also cut prefill time.',
    'Report p50 and p95, not averages: users remember the slow tail.'
  ],
  concept: { title: 'Two formulas you will use every week', body: `<p>Latency: <code class="i">T ≈ RTT + queue + input_tokens / prefill_speed + output_tokens / decode_speed</code>. Cost: <code class="i">C = in_tokens × p_in + out_tokens × p_out</code>, with cached input billed at the cache rate.</p><p>Almost every optimization in this course moves one term: retrieval and compaction shrink input tokens, caching makes repeated input cheap and fast, smaller models raise decode speed, output caps and structured outputs shrink output tokens, streaming hides TTFT’s successor wait.</p>` },
  walk: [
    { h: 'Measure TTFT and TPOT from a stream', body: '<p>Record the time the request is sent, the first token, and the last token. TPOT is (last − first) / (tokens − 1).</p>', code: String.raw`import time

def measure(stream):
    t0 = time.perf_counter(); first = None; n = 0
    for _tok in stream:
        n += 1
        if first is None:
            first = time.perf_counter()
    end = time.perf_counter()
    return {"ttft_ms": (first - t0) * 1000, "tpot_ms": (end - first) * 1000 / max(1, n - 1), "tokens": n}` },
    { h: 'Price a request', body: '<p>Keep prices in config, versioned, and compute cost at request time so finance reports are exact.</p>', code: String.raw`def cost_usd(usage: dict, price_in: float, price_out: float, cache_write_mult=1.25, cache_read_mult=0.1) -> float:
    per = 1e-6
    return (usage["input_tokens"] * price_in
            + usage.get("cache_creation_input_tokens", 0) * price_in * cache_write_mult
            + usage.get("cache_read_input_tokens", 0) * price_in * cache_read_mult
            + usage["output_tokens"] * price_out) * per` },
    { h: 'Find the dominant term', body: '<p>For a RAG answer with 6,000 input tokens and 400 output tokens, decode usually dominates. For classification with 2,000 input and 5 output tokens, prefill and network dominate. Optimize the big term.</p>' }
  ],
  analogy: `<p><b>A printer.</b> TTFT is the warm-up before the first page comes out, longer when the document is large because it has to be processed first. TPOT is the time per page once printing starts. A 2-page memo is dominated by warm-up; a 200-page manual by pages per minute. Caching is keeping the printer warm because you print the same letterhead every time.</p>`,
  diagram: {
    title: 'Where the time goes in one LLM call',
    cols: [['cli'], ['net'], ['q'], ['pre'], ['dec'], ['done']],
    nodes: [
      { id: 'cli', label: 'Client', sub: 't = 0', info: 'Request leaves your service.' },
      { id: 'net', label: 'Network', sub: 'RTT 50–150 ms', info: 'Round trip to the provider region. Pick regions close to your servers.' },
      { id: 'q', label: 'Queue', sub: 'load-dependent', tone: 'warn', info: 'Waiting for capacity at the provider or your own GPUs. Grows at peak.' },
      { id: 'pre', label: 'Prefill', sub: 'input tokens', tone: 'acc', info: 'Processes the whole prompt in parallel. Roughly proportional to input tokens; cached prefixes skip most of it.' },
      { id: 'dec', label: 'Decode', sub: 'output × TPOT', tone: 'be', info: 'One step per output token. Dominates long answers.' },
      { id: 'done', label: 'Last token', sub: 'total latency', tone: 'ok', info: 'TTFT = network + queue + prefill. Total = TTFT + output tokens × TPOT.' }
    ],
    edges: [{ a: 'cli', b: 'net', step: 1 }, { a: 'net', b: 'q', step: 2 }, { a: 'q', b: 'pre', step: 3 }, { a: 'pre', b: 'dec', label: 'first token', step: 4 }, { a: 'dec', b: 'done', step: 5 }],
    steps: ['Your service sends the request.', 'Network round trip to the provider.', 'The request may wait for capacity.', 'Prefill processes all input tokens; the first token appears after this.', 'Decode generates the rest one token at a time.'],
    caption: 'TTFT is everything before the first token; decode is everything after.'
  },
  illustrated: { title: 'Two endpoints, two different bottlenecks', body: `<p>Example rates: prefill 8,000 tokens/s, decode 60 tokens/s, 100 ms network, no queue.</p>
    <div class="tbl"><table><thead><tr><th>endpoint</th><th>input</th><th>output</th><th>TTFT</th><th>total</th><th>dominant term</th></tr></thead><tbody>
    <tr><td>classify ticket</td><td class="n">2,000</td><td class="n">5</td><td class="n">0.1 + 0.25 = 0.35 s</td><td class="n">0.43 s</td><td>prefill + network</td></tr>
    <tr><td>RAG answer</td><td class="n">6,000</td><td class="n">400</td><td class="n">0.1 + 0.75 = 0.85 s</td><td class="n">7.5 s</td><td>decode (400 / 60)</td></tr></tbody></table></div>
    <p>For the RAG endpoint, shortening answers or using a faster model helps far more than trimming context; for classification it is the reverse. The simulator lets you try both.</p>` },
  code: {
    title: 'A latency and cost model with caching and percentiles', file: 'latency_cost.py', browser: true,
    intro: '<p>Simulates 2,000 requests with realistic variation in input size, output size and queueing, then reports p50/p95 latency and monthly cost with and without prompt caching on a shared 4,000-token prefix. Prices are example values; cache multipliers follow Anthropic’s published defaults (1.25× write for 5-minute TTL, 0.1× read).</p>',
    src: String.raw`import random, statistics as st
random.seed(3)

PRICE_IN, PRICE_OUT = 3.00, 15.00          # example $ per million tokens
PREFILL_TPS, DECODE_TPS, RTT = 8000, 60, 0.10
SHARED_PREFIX = 4000                        # system prompt + policy docs, identical on every call

def one_request(cached: bool, warm: bool):
    unique_in = int(random.lognormvariate(6.9, 0.5))      # ~1,000 tokens of ticket + context
    out = int(random.lognormvariate(5.0, 0.6))            # ~150 tokens of answer
    queue = random.expovariate(1 / 0.08)
    prefix_cost_tokens = 0 if (cached and warm) else SHARED_PREFIX
    ttft = RTT + queue + (prefix_cost_tokens + unique_in) / PREFILL_TPS
    total = ttft + out / DECODE_TPS
    if not cached:
        usd = ((SHARED_PREFIX + unique_in) * PRICE_IN + out * PRICE_OUT) / 1e6
    elif warm:
        usd = (SHARED_PREFIX * PRICE_IN * 0.1 + unique_in * PRICE_IN + out * PRICE_OUT) / 1e6
    else:
        usd = (SHARED_PREFIX * PRICE_IN * 1.25 + unique_in * PRICE_IN + out * PRICE_OUT) / 1e6
    return ttft, total, usd

def pct(xs, p):
    xs = sorted(xs); return xs[int(p * (len(xs) - 1))]

for cached in (False, True):
    rows = [one_request(cached, warm=(i % 50 != 0)) for i in range(2000)]   # cache refreshed by traffic, 1 in 50 cold
    ttft, total, usd = zip(*rows)
    monthly = st.mean(usd) * 1_000_000
    print(f"caching={'on ' if cached else 'off'} TTFT p50={pct(ttft, .5):.2f}s p95={pct(ttft, .95):.2f}s | "
          f"total p50={pct(total, .5):.2f}s p95={pct(total, .95):.2f}s | ${'$'}{monthly:,.0f} per 1M requests")`
  },
  lab: {
    title: 'Budget the triage service', file: 'budget_lab.py', browser: true,
    scenario: `<p>The triage service from Phase 1 will call a model on 200,000 tickets a day. Product wants p95 under 2 seconds and the CFO wants a monthly number. Build the budget, find the dominant latency term, and test two optimizations: a 60-token output cap and caching the 3,000-token system prompt.</p>`,
    steps: ['Write functions for TTFT, total latency and cost per call from token counts and rates.', 'Compute baseline monthly cost and p95 latency using the given distributions.', 'Apply the output cap and recompute.', 'Apply caching (assume 98% warm hits) and recompute.', 'Print a three-row comparison table and name the better lever for each metric.'],
    checks: ['Three scenarios printed with p95 and monthly cost.', 'The output cap changes latency more than cost of input; caching changes input cost and TTFT.'],
    hints: ['Monthly calls = 200,000 × 30.', 'Use the same random seed for every scenario so the comparison is fair.'],
    starter: String.raw`import random
PRICE_IN, PRICE_OUT = 1.00, 5.00     # example $ per million tokens
PREFILL_TPS, DECODE_TPS, RTT = 10000, 80, 0.08
SYSTEM_TOKENS = 3000

def sample_call(rng):
    return {"ticket_in": int(rng.lognormvariate(6.2, 0.5)), "out": int(rng.lognormvariate(4.8, 0.5)), "queue": rng.expovariate(1 / 0.1)}

def scenario(name, out_cap=None, cache_hit=0.0):
    rng = random.Random(7)
    # TODO: compute p95 total latency and monthly cost
    print(name)

scenario("baseline")`,
    solution: String.raw`import random
PRICE_IN, PRICE_OUT = 1.00, 5.00
PREFILL_TPS, DECODE_TPS, RTT = 10000, 80, 0.08
SYSTEM_TOKENS = 3000
CALLS_PER_MONTH = 200_000 * 30

def sample_call(rng):
    return {"ticket_in": int(rng.lognormvariate(6.2, 0.5)), "out": int(rng.lognormvariate(4.8, 0.5)), "queue": rng.expovariate(1 / 0.1)}

def scenario(name, out_cap=None, cache_hit=0.0):
    rng = random.Random(7)
    lat, usd = [], []
    for _ in range(5000):
        c = sample_call(rng)
        out = min(c["out"], out_cap) if out_cap else c["out"]
        hit = rng.random() < cache_hit
        prefill_tokens = c["ticket_in"] + (0 if hit else SYSTEM_TOKENS)
        lat.append(RTT + c["queue"] + prefill_tokens / PREFILL_TPS + out / DECODE_TPS)
        sys_cost = SYSTEM_TOKENS * PRICE_IN * (0.1 if hit else (1.25 if cache_hit else 1.0))
        usd.append((sys_cost + c["ticket_in"] * PRICE_IN + out * PRICE_OUT) / 1e6)
    lat.sort()
    p95 = lat[int(0.95 * len(lat))]
    monthly = sum(usd) / len(usd) * CALLS_PER_MONTH
    print(f"{name:<22} p95={p95:.2f}s  monthly=${'$'}{monthly:,.0f}")

scenario("baseline")
scenario("output cap 60", out_cap=60)
scenario("cache system prompt", cache_hit=0.98)
scenario("both", out_cap=60, cache_hit=0.98)
print("Latency lever: the output cap (decode dominates). Cost lever: caching the 3,000-token prefix.")`
  },
  design: {
    lead: '<p>Latency and cost budgets belong in the design document with numbers per component. Measure them in production per request (Phase 9.11) and alert when they drift.</p>',
    scale: [{ h: 'Throughput vs latency', p: 'Self-hosted servers batch requests to raise throughput, which raises TPOT for each user. Set the batch size from your latency SLO (Phase 9.3).' }, { h: 'Cache what repeats', p: 'Long, stable prefixes (system prompts, tool definitions, policy documents) are the cheapest win: lower cost and lower TTFT.' }],
    fail: [{ h: 'Averages hide pain', p: 'A 1.2 s mean can hide a 9 s p99 from a few huge prompts. Track percentiles and the token counts behind the slow requests.' }, { h: 'Unbounded outputs', p: 'Without max_tokens and concise-output instructions, a model occasionally writes 3,000 tokens, blowing both latency and cost.' }],
    trade: [{ h: 'Smaller model vs shorter answers', p: 'Both cut decode time; shorter answers keep quality, a smaller model may not. Try the cheap one first.' }, { h: 'Cache TTL', p: 'Longer TTLs cost more to write; worth it only when the same prefix is reused less often than every few minutes.' }],
    prompt: '<p>Your chat endpoint’s p95 jumped from 3 s to 9 s after adding retrieval. Diagnose with numbers.</p>',
    answer: '<ul><li>Break p95 requests into retrieval time, TTFT and decode time from traces.</li><li>If TTFT jumped, input tokens grew: retrieval adds too many chunks; cut top-k, rerank, compress.</li><li>If decode jumped, answers got longer: cap output, ask for concise answers with citations.</li><li>If retrieval time jumped, look at the vector DB query and run retrieval in parallel with other steps.</li></ul>'
  },
  quiz: [
    { q: 'A classification call has 3,000 input tokens and 3 output tokens. Its latency is dominated by:', o: ['Decode', 'Network, queueing and prefill', 'max_tokens', 'Temperature'], a: 1, why: 'With almost no output, everything happens before the first token.' },
    { q: 'Total generation time is best approximated by:', o: ['TTFT × output tokens', 'TTFT + output tokens × TPOT', 'input tokens / decode speed', 'TPOT only'], a: 1, why: 'Wait for the first token, then one decode step per remaining token.' },
    { q: 'What does prompt caching change?', o: ['Output token price', 'Cost and prefill time of a repeated input prefix', 'Decode speed', 'The context window'], a: 1, why: 'Cached prefixes are read cheaply and skip most prefill work.' }
  ],
  interview: [
    { q: 'Where does the latency go in a RAG endpoint, and how do you reduce it?', a: '<p>Embedding the query, vector search, optional reranking, then TTFT (network, queue, prefill over the retrieved context) and decode for the answer. Measure each span. Reduce retrieval time with caching and parallelism, TTFT with fewer and shorter chunks plus prompt caching, decode with shorter answers or a faster model, and perceived latency with streaming.</p>' },
    { q: 'How would you explain a cost overrun to a CFO?', a: '<p>Cost equals calls × (input tokens × price + output tokens × price). I would show which term grew, for example input tokens per call doubled when retrieval was added, and the fix with its projected saving, such as caching the shared prefix or capping retrieved context, in dollars per month.</p>' }
  ]
});
})();
