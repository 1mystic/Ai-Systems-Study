/* Phase 7 · Evals */
(function () {
const L = AISA.lesson;

const DE_APP = String.raw`def answer(question: str) -> str:
    """The system under test (stand-in for your RAG or agent endpoint)."""
    table = {
        "charged twice": "Duplicate charges are refunded automatically within 5 business days [refund-policy].",
        "error E4012": "E4012 means the card issuer declined a retry; ask the customer to update the card [error-e4012].",
        "cancel": "You can cancel from Billing; access continues to the end of the period.",
    }
    return next((v for k, v in table.items() if k in question), "I could not find this in the help centre.")
`;
const DE_JUDGE = String.raw`import json, re
from deepeval.models import DeepEvalBaseLLM

class RubricJudge(DeepEvalBaseLLM):
    """Stand-in judge model so the suite runs offline: scores by key facts of the expected output
    found in the actual output. In CI you would pass a real model (for example a Claude model) instead."""
    def __init__(self):
        super().__init__(model="rubric-judge")
    def load_model(self):
        return self
    def get_model_name(self):
        return "rubric-judge"
    def generate(self, prompt: str, schema=None, **kwargs):
        if schema is not None and "steps" in schema.model_fields:
            return schema(steps=["List the key facts in the expected output", "Check each appears in the actual output"])
        actual = re.search(r"Actual Output:\n(.*?)\n", prompt, re.S).group(1)
        expected = re.search(r"Expected Output:\n(.*?)\n", prompt, re.S).group(1)
        facts = [w for w in re.findall(r"[A-Za-z0-9-]+", expected) if len(w) > 3 or any(c.isdigit() for c in w)]
        hit = sum(f.lower() in actual.lower() for f in facts) / max(1, len(facts))
        data = {"score": round(10 * hit), "reason": f"{round(100 * hit)}% of expected key facts present"}
        return schema(**data) if schema is not None else json.dumps(data)
    async def a_generate(self, prompt: str, schema=None, **kwargs):
        return self.generate(prompt, schema)
`;
const DE_TEST = String.raw`import os, re
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
import pytest
from deepeval import assert_test
from deepeval.metrics import BaseMetric, GEval
from deepeval.test_case import LLMTestCase, SingleTurnParams
from app import answer
from judge import RubricJudge

class CitesSource(BaseMetric):
    """Deterministic metric: the answer must cite a source id in [brackets]."""
    def __init__(self, threshold: float = 1.0):
        self.threshold = threshold
    def measure(self, tc: LLMTestCase, *args, **kwargs) -> float:
        self.score = 1.0 if re.search(r"\[[a-z0-9-]+\]", tc.actual_output) else 0.0
        self.success = self.score >= self.threshold
        self.reason = "cites a source" if self.success else "no [source-id] citation"
        return self.score
    async def a_measure(self, tc, *args, **kwargs):
        return self.measure(tc)
    def is_successful(self) -> bool:
        return self.success
    @property
    def __name__(self):
        return "CitesSource"

correctness = GEval(name="Correctness", criteria="Does the actual output contain the key facts of the expected output?",
                    evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT, SingleTurnParams.EXPECTED_OUTPUT],
                    model=RubricJudge(), threshold=0.7, async_mode=False)

CASES = [
    ("I was charged twice", "Refunded automatically within 5 business days [refund-policy]"),
    ("what is error E4012", "Card issuer declined a retry; update the card [error-e4012]"),
    ("how do I cancel", "Cancel from Billing; access continues to the end of the period [cancel-plan]"),
]

@pytest.mark.parametrize("question,expected", CASES, ids=["duplicate", "e4012", "cancel"])
def test_answers(question, expected):
    tc = LLMTestCase(input=question, actual_output=answer(question), expected_output=expected)
    assert_test(tc, [correctness, CitesSource()])
`;

/* ===================================================================== 7.1 */
L({
  id: '7.1', title: 'Eval datasets', minutes: 50, roles: ['fde', 'be'],
  tags: 'golden sets · sourcing from production · stratification · edge cases · unanswerables · splits · versioning · contamination',
  mental: 'An eval set is a versioned, labelled sample of the work your system must do, shaped like real traffic plus the cases that matter most. Every change to prompts, models or retrieval is judged against it, so its quality caps the quality of every decision you make.',
  intro: `<p>Without evals, AI development is vibes: someone tries five examples, it looks better, it ships, and a different set of customers breaks. With evals, a change is a measurable experiment. Every serious AI team in 2026, and every FDE engagement that reaches production, has eval sets at its core.</p>
  <p>This phase builds the full loop: datasets (this lesson), metrics, LLM judges, RAG and agent evals, CI gates and production monitoring. Start with the dataset, because a sophisticated metric on an unrepresentative dataset is precisely wrong.</p>`,
  points: [
    'Source from reality: sampled production traffic, support tickets, customer documents and SME-written cases; add synthetic cases to fill gaps.',
    'Stratify by category, difficulty, language and customer segment so small but important slices are represented.',
    'Include hard cases on purpose: edge cases, ambiguous requests, unanswerable questions, adversarial inputs and past incidents.',
    'Write labels with a rubric: expected answer or key facts, acceptable variants, and why; ambiguity gets resolved in the rubric, not by each labeller.',
    'Split into a development set you iterate on and a held-out set you check rarely, to avoid overfitting prompts to the eval.',
    'Version datasets like code; record which version every result used; deduplicate and keep them out of any training data.'
  ],
  concept: { title: 'A map of the territory your system must cover', body: `<p>Think of the eval set as a map of the work. If it shows only the main roads (common questions), every route looks fine until a customer takes a back road. Good datasets mirror the traffic and deliberately mark the dangerous bends: the refund over the limit, the question with no answer in the docs, the request in Hindi, the prompt injection hidden in an email.</p>` },
  walk: [
    { h: 'Start small and real', body: '<p>50 to 200 well-labelled examples from real traffic beat 5,000 synthetic ones. Grow the set from every production failure: each incident becomes a test case.</p>' },
    { h: 'One record, many uses', body: '<p>Store cases as JSON lines with metadata so slices and filters are easy.</p>', lang: 'bash', file: 'evals/triage_v3.jsonl', code: String.raw`{"id": "t-0412", "input": "charged twice for Pro in Oct", "expected": {"label": "billing", "priority": "P1"},
 "rubric": "P1 because money was taken incorrectly", "slice": {"category": "billing", "lang": "en", "difficulty": "easy"},
 "source": "prod-2026-10", "split": "dev"}` },
    { h: 'Plan the size', body: '<p>The statistical precision of a metric grows with the square root of the number of examples. 100 examples give roughly ±8 points of uncertainty on an 80% accuracy; detecting a 3-point improvement reliably needs well over a thousand per variant, or a paired design. The simulator in lesson 7.2 makes this concrete.</p>' }
  ],
  analogy: `<p><b>A driving test route.</b> A good examiner’s route is not just the straight road outside the test centre. It includes a roundabout, a hill start, a school zone and a tricky junction, because those are where drivers fail. Your eval set is the route your system must pass before you let it drive customers.</p>`,
  diagram: {
    title: 'Building and maintaining an eval set',
    cols: [['prod', 'sme', 'syn'], ['dedup'], ['strat'], ['label'], ['dev', 'held']],
    nodes: [
      { id: 'prod', label: 'Production samples', sub: 'logs · tickets', tone: 'fde', info: 'Real inputs, sampled and anonymised.' },
      { id: 'sme', label: 'SME cases', sub: 'experts write hard ones', info: 'Domain experts add tricky and high-stakes cases.' },
      { id: 'syn', label: 'Synthetic', sub: 'fill gaps', info: 'Generated variations for rare slices, reviewed by humans.' },
      { id: 'dedup', label: 'Clean + dedupe', sub: 'PII · near-duplicates', tone: 'be', info: 'Remove personal data and near-duplicates.' },
      { id: 'strat', label: 'Stratify', sub: 'slices · quotas', tone: 'acc', info: 'Ensure minimum counts per important slice.' },
      { id: 'label', label: 'Label with rubric', sub: '2 labellers + adjudication', tone: 'warn', info: 'Expected outputs and the reasoning, with agreement checks.' },
      { id: 'dev', label: 'Dev split', sub: 'iterate here', tone: 'ok', info: 'Used daily while improving the system.' },
      { id: 'held', label: 'Held-out split', sub: 'check before release', info: 'Protected from overfitting; used at release gates.' }
    ],
    edges: [{ a: 'prod', b: 'dedup' }, { a: 'sme', b: 'dedup' }, { a: 'syn', b: 'dedup' }, { a: 'dedup', b: 'strat' }, { a: 'strat', b: 'label' }, { a: 'label', b: 'dev' }, { a: 'label', b: 'held' }],
    caption: 'Real sources, cleaned and stratified, labelled with a rubric, split to avoid overfitting.'
  },
  illustrated: { title: 'Why stratification matters', body: `<p>Production traffic: 70% billing, 25% how-to, 4% security, 1% legal. A random sample of 200 gives about 2 legal cases.</p>
    <div class="tbl"><table><thead><tr><th>slice</th><th>random 200</th><th>stratified 200 (min 20 per slice)</th></tr></thead><tbody>
    <tr><td>billing</td><td class="n">140</td><td class="n">110</td></tr>
    <tr><td>how-to</td><td class="n">50</td><td class="n">50</td></tr>
    <tr><td>security</td><td class="n">8</td><td class="n">20</td></tr>
    <tr><td>legal</td><td class="n">2</td><td class="n">20</td></tr></tbody></table></div>
    <p>Report per slice as well as overall, and weight the overall number by real traffic if you need a production estimate.</p>` },
  code: {
    title: 'From raw logs to a versioned, stratified eval set', file: 'build_dataset.py', browser: true,
    intro: '<p>Synthetic “production logs” go through the steps from the diagram: redact emails and card-like numbers, remove near-duplicates with word-shingle Jaccard similarity, stratify with a minimum per slice, assign stable dev and held-out splits by hashing the id, and write JSON lines with a content hash as the dataset version.</p>',
    src: String.raw`import hashlib, json, random, re
from collections import Counter, defaultdict

random.seed(5)
TEMPLATES = {
    "billing": ["charged twice for {plan} in {month}", "refund for {plan} please", "invoice shows wrong amount for {plan}"],
    "how_to": ["how do I export invoices", "how to add a user to {plan}", "where is the API key page"],
    "security": ["is my data stored in the EU", "how do I enable SSO", "report a phishing email"],
    "legal": ["can I get a DPA signed", "what is your liability cap"],
}
WEIGHTS = {"billing": 70, "how_to": 25, "security": 4, "legal": 1}
logs = []
for i in range(3000):
    cat = random.choices(list(WEIGHTS), weights=WEIGHTS.values())[0]
    text = random.choice(TEMPLATES[cat]).format(plan=random.choice(["Pro", "Starter", "Enterprise"]), month=random.choice(["Sep", "Oct"]))
    text = random.choice(["", "hi team, ", "urgent: ", "quick question: ", "hello, "]) + text + random.choice(
        ["", " thanks", " asap", f" (ticket {random.randint(1000, 9999)})", " - we are on a deadline", f" for workspace w{random.randint(1, 400)}"])
    if random.random() < 0.05: text += f" my email is user{i}@corp.example"
    if random.random() < 0.02: text += " card 4242 4242 4242 4242"
    logs.append({"id": f"log-{i}", "text": text, "category": cat})

def redact(t):
    t = re.sub(r"[\w.]+@[\w.]+", "[EMAIL]", t)
    return re.sub(r"\b(?:\d[ -]?){13,19}\b", "[CARD]", t)

def shingles(t, k=3):
    w = t.lower().split()
    return {" ".join(w[i:i + k]) for i in range(max(1, len(w) - k + 1))}

def dedupe(rows, threshold=0.9):
    kept, seen = [], []
    for r in rows:
        s = shingles(r["text"])
        if any(len(s & o) / len(s | o) >= threshold for o in seen):
            continue
        kept.append(r); seen.append(s)
    return kept

def stratify(rows, total=120, minimum=15):
    by = defaultdict(list)
    for r in rows: by[r["category"]].append(r)
    quota = {c: max(minimum, round(total * len(v) / len(rows))) for c, v in by.items()}
    out = []
    for c, q in quota.items():
        out += random.sample(by[c], min(q, len(by[c])))
    return out

split = lambda rid: "heldout" if int(hashlib.sha256(rid.encode()).hexdigest(), 16) % 5 == 0 else "dev"

clean = [dict(r, text=redact(r["text"])) for r in logs]
unique = dedupe(clean)
sample = stratify(unique)
records = [{"id": r["id"], "input": r["text"], "slice": {"category": r["category"]}, "split": split(r["id"]), "source": "prod-2026-10"} for r in sample]
blob = "\n".join(json.dumps(r, sort_keys=True) for r in sorted(records, key=lambda r: r["id"]))
version = hashlib.sha256(blob.encode()).hexdigest()[:10]

print(f"raw logs: {len(logs)} | redacted: {sum('[EMAIL]' in r['text'] or '[CARD]' in r['text'] for r in clean)} | after near-dup removal: {len(unique)}")
print("production mix :", dict(Counter(r['category'] for r in logs)))
print("eval set mix   :", dict(Counter(r['slice']['category'] for r in records)))
print("splits         :", dict(Counter(r['split'] for r in records)))
print(f"dataset version: triage-eval@{version} ({len(records)} cases)")
print("example        :", json.dumps(records[0]))`
  },
  lab: {
    title: 'Size the eval set and plan the labelling', file: 'sizing_lab.py', browser: true,
    scenario: `<p>A customer asks: “How many examples do we need to label to tell whether the new prompt is better?” Their current accuracy is about 84%, they care about improvements of 3 points or more, and their legal slice (2% of traffic) must be measured to within ±10 points. Labelling costs $4 per example with two labellers. Compute the answer and the budget.</p>`,
    steps: ['Write <code class="i">ci_half_width(p, n)</code> = 1.96 · sqrt(p(1-p)/n).', 'Write <code class="i">n_for_diff(p1, p2, alpha=0.05, power=0.8)</code> for comparing two independent proportions.', 'Simulate a paired design: for each item, both prompts are run; estimate how many items a paired test needs when 90% of items get the same outcome under both prompts (simulate and bisect on n).', 'Compute the minimum legal-slice count for ±10 points at 84% accuracy.', 'Print a recommendation: total examples, slice quotas and labelling cost.'],
    checks: ['Independent design needs far more examples than the paired design.', 'Legal slice minimum is computed, not guessed.', 'Budget = examples × $4.'],
    hints: ['Independent: n = (zα + zβ)² (p1(1-p1) + p2(1-p2)) / (p2 - p1)² with zα = 1.96, zβ = 0.84.', 'Paired: only discordant items carry information; simulate with a seeded generator and a sign-test style z on discordant pairs.'],
    starter: String.raw`import math, random

def ci_half_width(p, n):
    # TODO
    return 0

def n_for_diff(p1, p2, za=1.96, zb=0.8416):
    # TODO
    return 0

print(ci_half_width(0.84, 100), n_for_diff(0.84, 0.87))`,
    solution: String.raw`import math, random

def ci_half_width(p, n):
    return 1.96 * math.sqrt(p * (1 - p) / n)

def n_for_diff(p1, p2, za=1.96, zb=0.8416):
    return math.ceil((za + zb) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2)) / (p2 - p1) ** 2)

def paired_power(n, p_old=0.84, gain=0.03, agree=0.90, trials=400, seed=3):
    """Share of simulated studies where a paired test on discordant items finds the gain (z > 1.96)."""
    rng, hits = random.Random(seed), 0
    disc = 1 - agree                                   # share of items where the two prompts disagree
    p_new_wins = 0.5 + gain / (2 * disc)               # among discordant items, how often the new prompt is right
    for _ in range(trials):
        d = sum(rng.random() < disc for _ in range(n))
        wins = sum(rng.random() < p_new_wins for _ in range(d))
        if d and (wins - d / 2) / math.sqrt(d / 4) > 1.96:
            hits += 1
    return hits / trials

def n_paired(target=0.8):
    lo, hi = 50, 5000
    while lo < hi:
        mid = (lo + hi) // 2
        if paired_power(mid) >= target: hi = mid
        else: lo = mid + 1
    return lo

indep = n_for_diff(0.84, 0.87)
paired = n_paired()
legal = math.ceil(1.96 ** 2 * 0.84 * 0.16 / 0.10 ** 2)
print(f"CI half-width at n=100: +/-{100 * ci_half_width(0.84, 100):.1f} pts; at n=1000: +/-{100 * ci_half_width(0.84, 1000):.1f} pts")
print(f"independent samples per variant for +3 pts at 80% power: {indep}")
print(f"paired design (same items, 90% agreement): about {paired} items in total")
print(f"legal slice minimum for +/-10 pts: {legal} examples")
total = max(paired, 0) + max(0, legal - round(0.02 * paired))
print(f"recommendation: label ~{total} items ({paired} stratified + top-up to {legal} legal), run both prompts on the same items;")
print(f"labelling budget at $4 per item: ${'$'}{total * 4:,}")`
  },
  design: {
    lead: '<p>Datasets are long-lived infrastructure. Give them owners, versions, a growth process fed by production, and protection from leakage, and they will make every later decision faster and safer.</p>',
    scale: [{ h: 'Dataset registry', p: 'Store datasets with versions, schemas, slice tags and provenance; results always reference a dataset version (Phase 10.3).' }, { h: 'Continuous growth', p: 'Route flagged production cases (thumbs down, escalations, incidents) into a review queue that adds labelled cases weekly.' }],
    fail: [{ h: 'Overfitting to the eval', p: 'Tuning prompts on the same 100 cases for weeks makes them a training set. Keep a held-out split and refresh it.' }, { h: 'Stale datasets', p: 'Products and policies change; last year’s expected answers become wrong. Review labels when policies change.' }],
    trade: [{ h: 'Real vs synthetic', p: 'Real cases reflect true distribution and messiness; synthetic cases fill rare slices quickly but can be unrealistically clean.' }, { h: 'Size vs label quality', p: 'More examples narrow confidence intervals; better labels remove bias. With a fixed budget, prioritise quality for hard slices.' }],
    prompt: '<p>You start an FDE engagement for an insurance claims assistant. There is no eval set. Plan the first two weeks.</p>',
    answer: '<ul><li>Week 1: pull 1,000 anonymised historical claims questions; categorise; stratified sample of 200; interview adjusters for 30 hard cases and the rubric.</li><li>Two labellers per case with adjudication; agreement measured.</li><li>Dev and held-out splits; dataset versioned in the repo.</li><li>Week 2: baseline the current system, report per slice with confidence intervals, and agree target metrics and gates with the customer.</li></ul>'
  },
  quiz: [
    { q: 'Why keep a held-out split?', o: ['To save storage', 'To detect overfitting of prompts and settings to the development set', 'Because models require it', 'For faster runs'], a: 1, why: 'Iterating on one set makes it optimistic; held-out data stays honest.' },
    { q: 'Legal questions are 1% of traffic but high risk. In the eval set you should:', o: ['Include about 1%', 'Oversample them to a minimum count and report the slice separately', 'Exclude them', 'Only test them in production'], a: 1, why: 'Stratification guarantees enough cases to measure important slices.' },
    { q: 'Roughly how does metric uncertainty change when you quadruple the eval set?', o: ['Quarters', 'Halves', 'No change', 'Doubles'], a: 1, why: 'Standard error scales with 1/√n.' }
  ],
  interview: [
    { q: 'How do you build an eval set for a new LLM feature?', a: '<p>Start from real inputs: sampled, anonymised production or historical data, plus expert-written hard cases. Clean and deduplicate, stratify by the slices that matter with minimum counts, label with a rubric and two labellers where possible, split into dev and held-out, version it, and grow it from production failures.</p>' },
    { q: 'Your team reports a 2-point improvement on 80 examples. What do you say?', a: '<p>That is well inside the noise: at around 80% accuracy, 80 examples give roughly a ±9-point confidence interval. I would run both versions on the same items and use a paired comparison, add more labelled cases, and look at which items changed before believing the improvement.</p>' }
  ]
});

/* ===================================================================== 7.2 */
L({
  id: '7.2', title: 'Metrics', minutes: 50, roles: ['be', 'fde'], sim: 'evalsize',
  tags: 'accuracy · precision/recall/F1 · exact match · token F1 · slices · bootstrap confidence intervals · paired comparisons',
  mental: 'A metric turns outputs into numbers you can compare, and every number needs an uncertainty. Choose metrics that match what users care about, compute them per slice, and compare versions on the same items with confidence intervals before declaring a winner.',
  intro: `<p>Different tasks need different metrics. Classification wants accuracy, precision, recall and a confusion matrix. Extraction wants exact or field-level match. Free text needs overlap metrics, judges (7.3) or task-specific checks. And all of them need confidence intervals, because eval sets are samples.</p>
  <p>This lesson uses Phase 0’s statistics in anger: bootstrap intervals and paired comparisons are what separate engineering decisions from wishful thinking.</p>`,
  points: [
    'Classification: accuracy, per-class precision and recall, macro versus micro averages, and the confusion matrix to see which errors happen.',
    'Extraction and short answers: exact match after normalisation, field-level accuracy, token-level F1 for partial credit.',
    'Weight errors by cost when they differ: a missed P1 ticket is worse than a P3 marked P2.',
    'Report per slice; an overall gain can hide a regression on a small, important slice.',
    'Bootstrap confidence intervals: resample items with replacement, recompute the metric, take percentiles.',
    'Compare versions on the same items with a paired bootstrap of the difference; it is far more sensitive than comparing two separate intervals.'
  ],
  concept: { title: 'A number without an interval is a guess', body: `<p>“Accuracy went from 81% to 84%” sounds like progress. On 100 items, the 95% interval around each number spans about ±7 points, so the gap may be noise. A paired comparison asks a sharper question: on the items where the two versions disagree, which one is right more often? That uses the same items twice and cancels most of the noise.</p>` },
  walk: [
    { h: 'Bootstrap in five lines', body: '<p>Works for any metric, including ones with no textbook formula.</p>', code: String.raw`rng = np.random.default_rng(0)
idx = rng.integers(0, n, size=(2000, n))           # 2,000 resamples of item indices
scores = correct[idx].mean(axis=1)                 # metric on each resample
lo, hi = np.percentile(scores, [2.5, 97.5])` },
    { h: 'Paired difference', body: '<p>Resample item indices once and compute both versions on the same resample; the distribution of the difference tells you whether B beats A.</p>', code: String.raw`diff = correct_b[idx].mean(axis=1) - correct_a[idx].mean(axis=1)
p_b_not_better = (diff <= 0).mean()                # one-sided` },
    { h: 'Pick metrics with the customer', body: '<p>Agree on what matters (for example “P1 recall at least 95%, overall accuracy at least 85%, no slice below 75%”) before you start optimising. These become the CI gates in lesson 7.6.</p>' }
  ],
  analogy: `<p><b>Weighing yourself.</b> A daily weight can swing a kilo with water and meals. Concluding a diet works from two readings is foolish; you average over weeks (more samples) and compare like with like (same scale, same time of day: a paired design).</p>`,
  diagram: {
    title: 'From outputs to a decision',
    cols: [['outA', 'outB'], ['score'], ['slices', 'boot'], ['decide']],
    nodes: [
      { id: 'outA', label: 'Version A outputs', sub: 'same items', info: 'Baseline outputs on the eval set.' },
      { id: 'outB', label: 'Version B outputs', sub: 'same items', tone: 'fde', info: 'Candidate outputs on the same items.' },
      { id: 'score', label: 'Per-item scores', sub: 'correct · F1 · cost-weighted', tone: 'acc', info: 'Metric computed per item, not just in aggregate.' },
      { id: 'slices', label: 'Slice breakdown', sub: 'category · language · tier', tone: 'warn', info: 'Find regressions hidden by the average.' },
      { id: 'boot', label: 'Paired bootstrap', sub: 'CI of B − A', tone: 'be', info: 'Uncertainty of the difference using the same resampled items.' },
      { id: 'decide', label: 'Decision', sub: 'ship · iterate · reject', tone: 'ok', info: 'Against gates agreed in advance.' }
    ],
    edges: [{ a: 'outA', b: 'score' }, { a: 'outB', b: 'score' }, { a: 'score', b: 'slices' }, { a: 'score', b: 'boot' }, { a: 'slices', b: 'decide' }, { a: 'boot', b: 'decide' }],
    caption: 'Per-item scores, sliced and bootstrapped, compared against agreed gates.'
  },
  illustrated: { title: 'A confusion matrix tells you what to fix', body: `<p>Ticket triage, 300 items (rows = true label, columns = predicted):</p>
    <div class="tbl"><table><thead><tr><th></th><th>billing</th><th>bug</th><th>how_to</th><th>recall</th></tr></thead><tbody>
    <tr><td>billing</td><td class="n">118</td><td class="n">4</td><td class="n">8</td><td class="n">91%</td></tr>
    <tr><td>bug</td><td class="n">3</td><td class="n">71</td><td class="n">16</td><td class="n">79%</td></tr>
    <tr><td>how_to</td><td class="n">2</td><td class="n">5</td><td class="n">73</td><td class="n">91%</td></tr>
    <tr><td>precision</td><td class="n">96%</td><td class="n">89%</td><td class="n">75%</td><td></td></tr></tbody></table></div>
    <p>The main error: bugs labelled how-to (16). That points at the prompt’s definition of a bug, not at the model in general.</p>` },
  code: {
    title: 'Metrics with confidence intervals and a paired comparison', file: 'metrics.py', browser: true,
    intro: '<p>Two prompt versions on the same 300 labelled tickets (simulated with a seed). We compute accuracy with bootstrap intervals, macro F1, the per-slice table, and a paired bootstrap of the difference. Version B is better overall but worse on one slice, which is exactly what aggregate numbers hide.</p>',
    src: String.raw`import numpy as np

rng = np.random.default_rng(7)
LABELS = ["billing", "bug", "how_to"]
n = 300
truth = rng.choice(3, size=n, p=[0.45, 0.30, 0.25])
lang = rng.choice(["en", "hi"], size=n, p=[0.85, 0.15])

def predict(acc_by_label, hi_penalty):
    pred = truth.copy()
    for i in range(n):
        acc = acc_by_label[truth[i]] - (hi_penalty if lang[i] == "hi" else 0)
        if rng.random() > acc:
            pred[i] = rng.choice([k for k in range(3) if k != truth[i]])
    return pred

pred_a = predict([0.90, 0.76, 0.86], hi_penalty=0.00)
pred_b = predict([0.96, 0.93, 0.93], hi_penalty=0.25)      # better prompt overall, but hurts Hindi tickets
ok_a, ok_b = (pred_a == truth).astype(float), (pred_b == truth).astype(float)

def macro_f1(pred):
    f1s = []
    for k in range(3):
        tp = np.sum((pred == k) & (truth == k)); fp = np.sum((pred == k) & (truth != k)); fn = np.sum((pred != k) & (truth == k))
        p = tp / (tp + fp) if tp + fp else 0; r = tp / (tp + fn) if tp + fn else 0
        f1s.append(2 * p * r / (p + r) if p + r else 0)
    return float(np.mean(f1s))

idx = np.random.default_rng(0).integers(0, n, size=(4000, n))
def ci(x):
    s = x[idx].mean(axis=1); return np.percentile(s, [2.5, 97.5])

for name, ok, pred in [("A", ok_a, pred_a), ("B", ok_b, pred_b)]:
    lo, hi = ci(ok)
    print(f"version {name}: accuracy {ok.mean():.3f} [{lo:.3f}, {hi:.3f}]  macro-F1 {macro_f1(pred):.3f}")

diff = ok_b[idx].mean(axis=1) - ok_a[idx].mean(axis=1)
lo, hi = np.percentile(diff, [2.5, 97.5])
print(f"\npaired difference B - A: {ok_b.mean() - ok_a.mean():+.3f} [{lo:+.3f}, {hi:+.3f}], P(B not better) = {(diff <= 0).mean():.3f}")
print(f"items where they disagree: {int(np.sum(ok_a != ok_b))} of {n}")

print("\nper slice:")
for name, mask in [("en", lang == "en"), ("hi", lang == "hi")] + [(f"label={l}", truth == k) for k, l in enumerate(LABELS)]:
    a, b = ok_a[mask].mean(), ok_b[mask].mean()
    flag = "  <-- regression" if b < a - 0.03 else ""
    print(f"  {name:<14} n={mask.sum():>3}  A {a:.2f}  B {b:.2f}{flag}")`
  },
  lab: {
    title: 'Cost-weighted metrics for priority', file: 'cost_metric_lab.py', browser: true,
    scenario: `<p>For the customer, priority errors have very different costs: missing a P1 (predicting P2 or P3) costs 10, over-escalating a P3 to P1 costs 2, other errors cost 1. Two models have similar accuracy. Implement a cost-weighted metric, P1 recall with a bootstrap interval, and decide which model to ship.</p>`,
    steps: ['Use the seeded truths and predictions for two models in the starter.', 'Compute accuracy, the 3×3 confusion matrix and P1 recall for each.', 'Compute average cost per ticket from the cost matrix.', 'Bootstrap 95% intervals for P1 recall and average cost.', 'Recommend a model with one sentence of justification.'],
    checks: ['Confusion matrices sum to the number of items.', 'The recommendation follows the cost metric, not accuracy.', 'Intervals are reported for P1 recall and cost.'],
    hints: ['Cost matrix C[true][pred]; average cost = mean of C[t][p].', 'For P1 recall bootstraps, resample all items and compute recall on the resample.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(11)
n = 400
truth = rng.choice(3, size=n, p=[0.12, 0.38, 0.50])          # 0=P1, 1=P2, 2=P3
def model(miss_p1, overall):
    pred = truth.copy()
    for i in range(n):
        if truth[i] == 0 and rng.random() < miss_p1: pred[i] = rng.choice([1, 2])
        elif truth[i] != 0 and rng.random() > overall: pred[i] = rng.choice([k for k in range(3) if k != truth[i]])
    return pred
pred_x, pred_y = model(0.20, 0.92), model(0.05, 0.88)
COST = np.array([[0, 10, 10], [1, 0, 1], [2, 1, 0]])

# TODO: accuracy, confusion, P1 recall, average cost, bootstrap, recommendation`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(11)
n = 400
truth = rng.choice(3, size=n, p=[0.12, 0.38, 0.50])          # 0=P1, 1=P2, 2=P3
def model(miss_p1, overall):
    pred = truth.copy()
    for i in range(n):
        if truth[i] == 0 and rng.random() < miss_p1: pred[i] = rng.choice([1, 2])
        elif truth[i] != 0 and rng.random() > overall: pred[i] = rng.choice([k for k in range(3) if k != truth[i]])
    return pred
pred_x, pred_y = model(0.20, 0.92), model(0.05, 0.88)
COST = np.array([[0, 10, 10], [1, 0, 1], [2, 1, 0]])

idx = np.random.default_rng(1).integers(0, n, size=(3000, n))
def p1_recall(t, p):
    m = t == 0
    return (p[m] == 0).mean() if m.any() else np.nan

for name, pred in [("X", pred_x), ("Y", pred_y)]:
    conf = np.zeros((3, 3), int)
    np.add.at(conf, (truth, pred), 1)
    cost = COST[truth, pred]
    rec_bs = np.array([p1_recall(truth[i], pred[i]) for i in idx])
    cost_bs = cost[idx].mean(axis=1)
    print(f"model {name}: accuracy {np.mean(pred == truth):.3f}")
    print("  confusion (rows true P1,P2,P3):", conf.tolist(), "sum", conf.sum())
    print(f"  P1 recall {p1_recall(truth, pred):.3f} [{np.nanpercentile(rec_bs, 2.5):.3f}, {np.nanpercentile(rec_bs, 97.5):.3f}]")
    print(f"  avg cost/ticket {cost.mean():.3f} [{np.percentile(cost_bs, 2.5):.3f}, {np.percentile(cost_bs, 97.5):.3f}]")
print("\nrecommendation: ship Y. Its accuracy is slightly lower, but it misses far fewer P1 tickets, so its cost per ticket is lower.")`
  },
  design: {
    lead: '<p>Metrics are the contract between the team and the customer. Make them per item, per slice and per version, store them with dataset and system versions, and present them with uncertainty.</p>',
    scale: [{ h: 'Store per-item results', p: 'Keep every item’s output and score per run; aggregates can always be recomputed, and diffs between runs show exactly what changed.' }, { h: 'Cheap first', p: 'Run deterministic metrics on every change; reserve expensive judge metrics for nightly or pre-release runs.' }],
    fail: [{ h: 'Averages hiding regressions', p: 'A 2-point overall gain can include a 15-point drop for one language or customer. Gate on slices.' }, { h: 'Metric gaming', p: 'Optimising a proxy (keyword overlap) drifts away from user value. Validate metrics against human judgement periodically.' }],
    trade: [{ h: 'Exact match vs fuzzy metrics', p: 'Exact match is strict and objective; fuzzy metrics give partial credit but can reward wrong answers that look similar.' }, { h: 'One headline number vs dashboard', p: 'Executives need one number; engineers need slices and confusion matrices. Provide both, with the headline defined in advance.' }],
    prompt: '<p>The customer asks for "one accuracy number" for their claims assistant. How do you respond?</p>',
    answer: '<ul><li>Agree a headline: task success rate on the held-out set, traffic-weighted, with a 95% interval.</li><li>Back it with gates: high-risk slice minimums, critical-error rate (wrong payout amount) near zero.</li><li>Show per-slice and error-type breakdowns in the appendix.</li><li>Report changes as paired differences between versions, not two separate numbers.</li></ul>'
  },
  quiz: [
    { q: 'Why use a paired bootstrap to compare two prompt versions?', o: ['It is faster', 'Both versions are evaluated on the same resampled items, so item difficulty cancels out', 'It needs no labels', 'It raises accuracy'], a: 1, why: 'Pairing removes item-level variance from the comparison.' },
    { q: 'Accuracy rose overall, but Hindi tickets dropped 12 points. The right call:', o: ['Ship, the average is better', 'Treat it as a regression on a slice and fix or gate it before shipping', 'Remove Hindi from the eval set', 'Ignore small slices'], a: 1, why: 'Slice regressions matter, especially for specific customers.' },
    { q: 'Which metric best captures "never miss a P1"?', o: ['Overall accuracy', 'Recall on the P1 class', 'Precision on P3', 'Token F1'], a: 1, why: 'Recall measures how many true P1s were caught.' }
  ],
  interview: [
    { q: 'How do you decide whether a new prompt is better?', a: '<p>Run both on the same versioned eval set, compute per-item scores, and look at the paired difference with a bootstrap confidence interval, plus per-slice results and any critical-error metrics. If the interval excludes zero and no slice gate fails, it is better; if not, I need more data or a better change. I also read the items that changed.</p>' },
    { q: 'What is the difference between macro and micro averaging?', a: '<p>Micro averaging pools all items, so large classes dominate. Macro averaging computes the metric per class and averages them, giving small classes equal weight. With imbalanced classes, macro reveals poor performance on rare classes that micro hides.</p>' }
  ]
});

/* ===================================================================== 7.3 */
L({
  id: '7.3', title: 'LLM-as-judge', minutes: 55, roles: ['fde', 'be'],
  tags: 'rubrics · pointwise vs pairwise · position bias · verbosity bias · calibration with human labels · Cohen’s kappa',
  mental: 'An LLM judge scores outputs against a rubric where no exact answer exists. It is a measuring instrument, so you calibrate it: compare its scores with human labels, measure agreement and biases, and only trust it on the kinds of cases where it agrees with people.',
  intro: `<p>Many outputs have no single correct string: a support reply, a summary, an explanation. Humans can grade them but are slow and costly. A strong model with a clear rubric can grade thousands in minutes. Used carefully, judges are the backbone of evaluation for open-ended tasks; used carelessly, they produce confident numbers that do not track quality.</p>`,
  points: [
    'Give the judge a specific rubric with criteria and score anchors, and ask for reasoning before the score, in structured output.',
    'Pointwise (score one output) is simple; pairwise (which of two is better) is often more reliable for comparing versions.',
    'Known biases: position (prefers the first or second option), verbosity (prefers longer answers), self-preference (prefers its own model family’s style).',
    'Mitigate position bias by judging both orders and only counting consistent verdicts; control length in the rubric.',
    'Calibrate against human labels on a sample: agreement rate and Cohen’s kappa; recalibrate when the rubric or judge model changes.',
    'Judges are good at checking criteria (“does it cite the policy?”); weaker at deep factual correctness without references, so give them the reference answer when you have one.'
  ],
  concept: { title: 'Calibrate the instrument before trusting the reading', body: `<p>A new thermometer is checked against a reference before use. An LLM judge is the same: before using its scores to make decisions, measure how often it agrees with careful human graders on your data, and where it disagrees. Agreement is task-specific; a judge that is excellent for tone can be poor for legal accuracy.</p>` },
  walk: [
    { h: 'A rubric prompt with structured output', body: '<p>Concrete criteria and anchors reduce variance.</p>', code: String.raw`RUBRIC = """Grade the support reply against the reference.
Criteria: (1) correct policy outcome, (2) cites the policy id, (3) no invented details, (4) under 120 words.
Score 1-5: 5 = all criteria met; 3 = correct outcome with a minor issue; 1 = wrong outcome or invented policy.
Think step by step in "reasoning", then give "score"."""
verdict = client.messages.parse(model=JUDGE_MODEL, max_tokens=400, system=RUBRIC,
                                messages=[{"role": "user", "content": f"<reference>{ref}</reference><reply>{reply}</reply>"}],
                                output_format=Verdict)` },
    { h: 'Pairwise with swap', body: '<p>Ask “which reply is better, A or B?” twice with the order swapped. Consistent verdicts count; inconsistent ones become ties. Report the inconsistency rate: it measures position bias directly.</p>' },
    { h: 'Agreement with humans', body: '<p>Cohen’s kappa corrects raw agreement for chance: κ = (p_observed − p_chance) / (1 − p_chance). Above about 0.6 is usually considered substantial; below 0.4, do not use the judge for that task without fixing the rubric.</p>' }
  ],
  analogy: `<p><b>Exam markers.</b> A good exam has a marking scheme (rubric), new markers are calibrated on sample scripts with an experienced examiner (human labels), scripts are sometimes double-marked to check consistency (swap tests), and markers are warned not to reward length over substance (verbosity bias).</p>`,
  diagram: {
    title: 'A calibrated judge pipeline',
    cols: [['out'], ['rub'], ['judge'], ['swap', 'human'], ['cal'], ['use']],
    nodes: [
      { id: 'out', label: 'Outputs', sub: 'A and B versions', tone: 'fde', info: 'Replies to evaluate, with references where available.' },
      { id: 'rub', label: 'Rubric', sub: 'criteria + anchors', tone: 'acc', info: 'Specific, testable criteria and score definitions.' },
      { id: 'judge', label: 'Judge model', sub: 'reasoning → score', tone: 'be', info: 'Structured output; temperature low.' },
      { id: 'swap', label: 'Swap test', sub: 'both orders', tone: 'warn', info: 'Measures and removes position bias.' },
      { id: 'human', label: 'Human labels', sub: 'sample of 100–200', info: 'Gold standard for calibration.' },
      { id: 'cal', label: 'Agreement · kappa', sub: 'per slice', tone: 'ok', info: 'Decide where the judge can be trusted.' },
      { id: 'use', label: 'Judge at scale', sub: 'CI + online', info: 'Used where calibrated; humans spot-check the rest.' }
    ],
    edges: [{ a: 'out', b: 'judge' }, { a: 'rub', b: 'judge' }, { a: 'judge', b: 'swap' }, { a: 'judge', b: 'human', dash: true }, { a: 'swap', b: 'cal' }, { a: 'human', b: 'cal' }, { a: 'cal', b: 'use' }],
    caption: 'Rubric in, bias-tested, calibrated against people, then scaled.'
  },
  illustrated: { title: 'Raw agreement can mislead', body: `<p>200 replies, judge vs human pass/fail labels. 85% of replies truly pass.</p>
    <div class="tbl"><table><thead><tr><th></th><th>human pass</th><th>human fail</th></tr></thead><tbody>
    <tr><td>judge pass</td><td class="n">160</td><td class="n">22</td></tr>
    <tr><td>judge fail</td><td class="n">10</td><td class="n">8</td></tr></tbody></table></div>
    <p>Raw agreement = 168 / 200 = 84%, which sounds good. But chance agreement is 0.85 × 0.91 + 0.15 × 0.09 ≈ 0.79, so κ ≈ (0.84 − 0.79) / (1 − 0.79) ≈ 0.24. The judge misses most failures: it is nearly useless for catching bad replies.</p>` },
  code: {
    title: 'A pairwise judge with swap testing and kappa against humans', file: 'judge.py', deps: 'uv add anthropic pydantic',
    intro: '<p class="callout"><b>Runs without a key</b> The SDK and structured parsing are real; a local fake judge model answers. The fake is deliberately imperfect: it prefers longer replies and, when unsure, the first position, so the swap test and human calibration have something to find.</p><p>We judge 60 reply pairs in both orders, count inconsistent verdicts, and compute agreement and Cohen’s kappa against human preferences.</p>',
    src: String.raw`import json, random, re
from typing import Literal
import anthropic
from pydantic import BaseModel
try:
    import httpx2 as httpx
except ImportError:
    import httpx

class Verdict(BaseModel):
    reasoning: str
    winner: Literal["A", "B", "tie"]

# ---- fake judge: mostly right, biased towards length and position ----
jr = random.Random(2)
def fake_judge(request):
    body = json.loads(request.content)
    user = body["messages"][0]["content"]
    a, b = re.search(r"<A>(.*?)</A>", user, re.S).group(1), re.search(r"<B>(.*?)</B>", user, re.S).group(1)
    qa, qb = int(re.search(r"q=(\d)", a).group(1)), int(re.search(r"q=(\d)", b).group(1))
    score_a, score_b = qa + 0.004 * len(a) + jr.gauss(0, 0.6) + 0.35, qb + 0.004 * len(b) + jr.gauss(0, 0.6)   # +0.35: first-position bias
    w = "A" if score_a > score_b else "B"
    out = json.dumps({"reasoning": f"A scores {score_a:.1f}, B scores {score_b:.1f}", "winner": w})
    return httpx.Response(200, json={"id": "j", "type": "message", "role": "assistant", "model": body["model"],
        "content": [{"type": "text", "text": out}], "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 300, "output_tokens": 30}})
client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(fake_judge)))
# --------------------------------------------------------------------

RUBRIC = "Which support reply better resolves the customer's issue under the refund policy? Judge substance, not length."

def judge(x: str, y: str) -> str:
    r = client.messages.parse(model="claude-sonnet-5-5", max_tokens=300, system=RUBRIC, output_format=Verdict,
                              messages=[{"role": "user", "content": f"<A>{x}</A>\n<B>{y}</B>"}])
    return r.parsed_output.winner

rng = random.Random(9)
pairs = []
for i in range(60):
    q1, q2 = rng.randint(1, 5), rng.randint(1, 5)
    r1 = f"reply q={q1} " + "detail " * rng.randint(5, 60)
    r2 = f"reply q={q2} " + "detail " * rng.randint(5, 60)
    human = "A" if q1 > q2 else "B" if q2 > q1 else "tie"
    pairs.append((r1, r2, human))

consistent, inconsistent, final = 0, 0, []
for r1, r2, human in pairs:
    first, swapped = judge(r1, r2), judge(r2, r1)
    swapped = {"A": "B", "B": "A"}.get(swapped, swapped)            # map back to the original labels
    if first == swapped:
        consistent += 1; final.append(first)
    else:
        inconsistent += 1; final.append("tie")                        # disagreeing orders -> treat as tie
print(f"swap test: {consistent} consistent, {inconsistent} inconsistent ({inconsistent / len(pairs):.0%} position-sensitive)")

def kappa(x, y, labels=("A", "B", "tie")):
    n = len(x); po = sum(a == b for a, b in zip(x, y)) / n
    pe = sum((x.count(l) / n) * (y.count(l) / n) for l in labels)
    return po, (po - pe) / (1 - pe)

humans = [h for _, _, h in pairs]
single = [judge(r1, r2) for r1, r2, _ in pairs]
for name, verdicts in [("single order", single), ("swap-consistent", final)]:
    po, k = kappa(verdicts, humans)
    print(f"{name:<16} agreement with humans {po:.2f}, Cohen's kappa {k:.2f}")
longer_wins = sum((len(a) > len(b)) == (v == "A") for (a, b, _), v in zip(pairs, single) if v != "tie") / sum(v != "tie" for v in single)
print(f"verbosity check: the longer reply won {longer_wins:.0%} of decided single-order verdicts")`
  },
  lab: {
    title: 'Calibrate a pointwise judge against humans', file: 'calibrate_lab.py', browser: true,
    scenario: `<p>A judge gives 1–5 scores to 250 support replies; two humans labelled each reply pass or fail. The team wants to use “judge score ≥ 4 means pass” in CI. Measure human-human agreement (the ceiling), judge-human agreement and kappa at each threshold, and check for verbosity bias by comparing judge scores for long and short replies within the same human label.</p>`,
    steps: ['Generate the seeded data in the starter.', 'Compute kappa between the two humans (the best a judge can reasonably reach).', 'For thresholds 2 to 5, compute judge-vs-adjudicated-human agreement, kappa, precision and recall for catching fails.', 'Verbosity: within human-pass and within human-fail, compare mean judge score for replies above and below median length.', 'Recommend a threshold, or recommend fixing the rubric.'],
    checks: ['Human-human kappa is reported as the ceiling.', 'The chosen threshold maximises kappa or meets a stated fail-recall target.', 'The verbosity analysis states whether length inflates scores.'],
    hints: ['Adjudicated label: fail if either human says fail (conservative).', 'Kappa for two binary raters: p_e = p1·q1 + (1-p1)·(1-q1).'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(4)
n = 250
quality = rng.normal(0, 1, n)                                # hidden true quality
length = rng.integers(40, 400, n)
h1 = (quality + rng.normal(0, 0.35, n) > -0.9).astype(int)   # 1 = pass
h2 = (quality + rng.normal(0, 0.35, n) > -0.9).astype(int)
judge = np.clip(np.round(3.2 + 1.1 * quality + 0.004 * (length - 200) + rng.normal(0, 0.6, n)), 1, 5).astype(int)

def kappa(a, b):
    # TODO
    return 0.0

print(kappa(h1, h2))`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(4)
n = 250
quality = rng.normal(0, 1, n)
length = rng.integers(40, 400, n)
h1 = (quality + rng.normal(0, 0.35, n) > -0.9).astype(int)
h2 = (quality + rng.normal(0, 0.35, n) > -0.9).astype(int)
judge = np.clip(np.round(3.2 + 1.1 * quality + 0.004 * (length - 200) + rng.normal(0, 0.6, n)), 1, 5).astype(int)

def kappa(a, b):
    po = np.mean(a == b); p1, q1 = a.mean(), b.mean()
    pe = p1 * q1 + (1 - p1) * (1 - q1)
    return (po - pe) / (1 - pe)

human = h1 & h2                                              # fail if either human says fail
print(f"human vs human kappa (ceiling): {kappa(h1, h2):.2f}; adjudicated fail rate {1 - human.mean():.0%}")
print(f"{'threshold':>9} {'agree':>6} {'kappa':>6} {'fail precision':>15} {'fail recall':>12}")
best = None
for t in range(2, 6):
    jp = (judge >= t).astype(int)
    fail_pred, fail_true = jp == 0, human == 0
    prec = (fail_pred & fail_true).sum() / max(1, fail_pred.sum()); rec = (fail_pred & fail_true).sum() / max(1, fail_true.sum())
    k = kappa(jp, human)
    print(f"{t:>9} {np.mean(jp == human):>6.2f} {k:>6.2f} {prec:>15.2f} {rec:>12.2f}")
    if best is None or k > best[1]: best = (t, k)
med = np.median(length)
for lab, name in [(1, "human pass"), (0, "human fail")]:
    m = human == lab
    print(f"verbosity within {name}: long replies avg {judge[m & (length > med)].mean():.2f} vs short {judge[m & (length <= med)].mean():.2f}")
print(f"\nrecommend threshold >= {best[0]} (kappa {best[1]:.2f}); add 'do not reward length' with anchors to the rubric and re-check the length gap.")`
  },
  design: {
    lead: '<p>LLM judges are models in production: versioned prompts, pinned judge models, calibration data, and monitoring for drift. Budget for their cost too, since judging can cost as much as generating.</p>',
    scale: [{ h: 'Cost control', p: 'Use cheaper judges for simple criteria, strong judges for nuanced ones; judge samples rather than everything online; cache verdicts by (input, output, rubric version).' }, { h: 'Judge panels', p: 'Several judges or several samples per item, aggregated, reduce variance for high-stakes evaluations.' }],
    fail: [{ h: 'Unpinned judge model', p: 'Upgrading the judge silently shifts scores and breaks trend lines. Pin versions and re-calibrate on change.' }, { h: 'Judge sees the wrong context', p: 'Judging faithfulness without the retrieved sources, or correctness without a reference, produces confident guesses.' }],
    trade: [{ h: 'Pointwise vs pairwise', p: 'Pointwise gives absolute scores for dashboards; pairwise is more sensitive for comparing versions.' }, { h: 'Judge vs human review', p: 'Judges scale; humans set truth. Keep a steady trickle of human labels to recalibrate.' }],
    prompt: '<p>Design the evaluation of a customer-facing email drafting assistant across 12 enterprise tenants.</p>',
    answer: '<ul><li>Rubric per tenant: tone, policy correctness, no invented commitments, length; references where available.</li><li>Pairwise judge with swap for version comparisons; pointwise scores for monitoring.</li><li>Calibration: 150 human-labelled emails per tenant initially, kappa per criterion; criteria with low kappa stay human-reviewed.</li><li>Pinned judge model; monthly recalibration sample; costs tracked per eval run.</li></ul>'
  },
  quiz: [
    { q: 'How do you detect position bias in a pairwise judge?', o: ['Use temperature 0', 'Judge each pair in both orders and count inconsistent verdicts', 'Use a bigger judge', 'Shorten the rubric'], a: 1, why: 'Swapping order reveals preference for a position.' },
    { q: 'Raw judge-human agreement is 84% and kappa is 0.24. What does it mean?', o: ['The judge is excellent', 'Most agreement is due to chance given the label imbalance; the judge is weak at the minority class', 'Kappa is broken', 'Humans are wrong'], a: 1, why: 'Kappa corrects for chance agreement.' },
    { q: 'What should a faithfulness judge receive?', o: ['Only the answer', 'The answer and the sources it should be grounded in', 'Only the question', 'The model name'], a: 1, why: 'Faithfulness is defined relative to the sources.' }
  ],
  interview: [
    { q: 'How do you make LLM-as-judge trustworthy?', a: '<p>Specific rubrics with anchors, reasoning before scores in structured output, references and sources provided, pinned judge models, swap tests for position bias and length controls for verbosity, and calibration against human labels with agreement and kappa per criterion and slice. I only rely on the judge where it agrees with humans.</p>' },
    { q: 'Pairwise or pointwise judging?', a: '<p>Pairwise when comparing two versions, because relative judgements are more consistent and sensitive; pointwise when I need absolute scores to track over time or gate on thresholds. In both, I measure judge reliability against humans.</p>' }
  ]
});

/* ===================================================================== 7.4 */
L({
  id: '7.4', title: 'RAG evals', minutes: 50, roles: ['fde', 'be'],
  tags: 'retrieval recall · context precision · faithfulness · answer relevance · citation precision · failure attribution',
  mental: 'Evaluate a RAG system in layers: did retrieval find the evidence, did the answer stay faithful to it, did the answer address the question, and are the citations right. Component metrics tell you where to fix; the end-to-end metric tells you whether it matters.',
  intro: `<p>A wrong RAG answer can come from four different places: the evidence was not retrieved, it was retrieved but ranked out of the context, it was in the context but the model ignored or contradicted it, or the answer was faithful but did not address the question. Each has a different fix (Phase 4 lessons). Component metrics turn “the bot is wrong sometimes” into a ranked list of fixes.</p>
  <p>Frameworks such as RAGAS and DeepEval implement these metrics with LLM judges; this lesson builds them from first principles so you know what their numbers mean.</p>`,
  points: [
    '<b>Retrieval</b>: recall@k (is the needed evidence in the top k?), MRR and context precision (how much of the context is relevant).',
    '<b>Faithfulness</b> (groundedness): the share of the answer’s claims supported by the retrieved context.',
    '<b>Answer relevance</b>: does the answer address the question asked?',
    '<b>Citation precision and recall</b>: do cited sources support the claims, and are supporting sources cited?',
    '<b>End-to-end correctness</b> against a reference answer, judged by rubric (7.3).',
    'Attribute each failure to one component, then fix the component responsible for most failures first.'
  ],
  concept: { title: 'Find the broken link in the chain', body: `<p>Retrieval, ranking, context assembly and generation form a chain. An end-to-end score says the chain failed; component metrics say which link. Fixing generation when retrieval is the problem wastes weeks, and it is the most common mistake in RAG projects.</p>` },
  walk: [
    { h: 'Label what retrieval should find', body: '<p>For each eval question, record the document or chunk ids that contain the answer (one or more). This turns retrieval into a measurable search problem (lesson 4.6).</p>' },
    { h: 'Faithfulness by claims', body: '<p>Split the answer into atomic claims, check each claim against the retrieved context, and report supported claims divided by total claims. A judge model does both steps in practice; the Code tab uses simple rules to show the mechanics.</p>' },
    { h: 'Attribute failures', body: `<div class="tbl"><table><thead><tr><th>symptom</th><th>component</th><th>typical fix</th></tr></thead><tbody>
      <tr><td>needed chunk not in top 50</td><td>retrieval</td><td>chunking, hybrid search, query rewriting</td></tr>
      <tr><td>in top 50, not in final top k</td><td>ranking</td><td>reranker, larger k</td></tr>
      <tr><td>in context, answer contradicts it</td><td>generation (faithfulness)</td><td>prompt, citations, model</td></tr>
      <tr><td>faithful but off-question</td><td>generation (relevance)</td><td>query understanding, prompt</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A pub quiz team.</b> If the team gets a question wrong, was it because nobody knew the fact (retrieval), someone knew but was not listened to (ranking and context), the captain wrote down something different from what the expert said (faithfulness), or they answered a different question (relevance)? Each needs a different team fix.</p>`,
  diagram: {
    title: 'Layered RAG evaluation',
    cols: [['q'], ['ret'], ['ctx'], ['ans'], ['m1', 'm2', 'm3', 'm4']],
    nodes: [
      { id: 'q', label: 'Question', sub: '+ gold evidence ids', tone: 'fde', info: 'Each eval item lists the chunks that hold the answer.' },
      { id: 'ret', label: 'Retrieval', sub: 'top 50', tone: 'be', info: 'Measured with recall@50 against gold ids.' },
      { id: 'ctx', label: 'Context', sub: 'reranked top k', info: 'Measured with recall@k and context precision.' },
      { id: 'ans', label: 'Answer', sub: 'with citations', tone: 'acc', info: 'Measured for faithfulness, relevance, citations, correctness.' },
      { id: 'm1', label: 'Retrieval recall', sub: 'evidence found?', info: 'Share of questions with gold evidence retrieved.' },
      { id: 'm2', label: 'Context precision', sub: 'noise in context', info: 'Share of context chunks that are relevant.' },
      { id: 'm3', label: 'Faithfulness', sub: 'claims supported', tone: 'warn', info: 'Supported claims over total claims.' },
      { id: 'm4', label: 'Correctness', sub: 'vs reference', tone: 'ok', info: 'End-to-end judge against the reference answer.' }
    ],
    edges: [{ a: 'q', b: 'ret' }, { a: 'ret', b: 'ctx' }, { a: 'ctx', b: 'ans' }, { a: 'ret', b: 'm1', dash: true }, { a: 'ctx', b: 'm2', dash: true }, { a: 'ans', b: 'm3', dash: true }, { a: 'ans', b: 'm4', dash: true }],
    caption: 'One metric per link of the chain, plus the end-to-end result.'
  },
  illustrated: { title: 'A failure attribution report', body: `<p>200 questions, 38 wrong end to end:</p>
    <div class="tbl"><table><thead><tr><th>attributed cause</th><th>count</th><th>share of failures</th></tr></thead><tbody>
    <tr><td>evidence never retrieved</td><td class="n">17</td><td class="n">45%</td></tr>
    <tr><td>retrieved but ranked out of context</td><td class="n">8</td><td class="n">21%</td></tr>
    <tr><td>unfaithful generation</td><td class="n">7</td><td class="n">18%</td></tr>
    <tr><td>faithful but incomplete or off-question</td><td class="n">6</td><td class="n">16%</td></tr></tbody></table></div>
    <p>Two thirds of failures are retrieval and ranking. The next sprint goes to hybrid search and reranking, not prompt tweaks.</p>` },
  code: {
    title: 'Component metrics and failure attribution for a RAG system', file: 'rag_eval.py', browser: true,
    intro: '<p>Eight eval questions over the Phase 4 help centre with gold evidence ids, simulated system outputs (retrieved ids, context ids and an answer), and rule-based stand-ins for claim splitting and support checking. Every number is computed the way RAGAS-style frameworks compute it, minus the judge model.</p>',
    src: String.raw`import re

DOCS = {
    "refund-policy": "Duplicate charges are refunded automatically within 5 business days. Other refunds need approval and are limited to the last 60 days.",
    "money-back": "If you paid for a plan you did not use, request your money back from the Billing page. Annual plans are reimbursed pro rata.",
    "error-e4012": "E4012 means the card issuer declined a retry of a failed payment. Ask the customer to update the card.",
    "sso-setup": "Enterprise workspaces can sign in with SAML single sign-on through Okta, Entra ID or Google.",
    "api-limits": "The REST API allows 600 requests per minute per workspace. Requests over the limit get HTTP 429.",
    "chargebacks": "If a customer disputes a charge with their bank, do not issue a refund while the dispute is open.",
}
EVAL = [  # question, gold evidence, system output (retrieved top 10, context top 3, answer)
    ("When is a duplicate charge refunded?", {"refund-policy"}, ["refund-policy", "money-back"], ["refund-policy", "money-back", "chargebacks"],
     "Duplicate charges are refunded automatically within 5 business days."),
    ("What does E4012 mean?", {"error-e4012"}, ["error-e4012", "api-limits"], ["error-e4012", "api-limits", "sso-setup"],
     "E4012 means the card issuer declined a retry of a failed payment. The customer should update the card."),
    ("Can we log in with Okta?", {"sso-setup"}, ["api-limits", "money-back"], ["api-limits", "money-back", "refund-policy"],
     "Yes, Okta login is supported on all plans."),
    ("What is the API rate limit?", {"api-limits"}, ["chargebacks", "refund-policy", "money-back", "api-limits"], ["chargebacks", "refund-policy", "money-back"],
     "I could not find the rate limit."),
    ("Refund during a bank dispute?", {"chargebacks"}, ["chargebacks", "refund-policy"], ["chargebacks", "refund-policy", "money-back"],
     "Yes, refund it immediately within 5 business days."),
    ("How are annual plans refunded?", {"money-back"}, ["money-back", "refund-policy"], ["money-back", "refund-policy", "chargebacks"],
     "Annual plans are reimbursed pro rata. Request it from the Billing page."),
    ("How long do refunds for duplicates take?", {"refund-policy"}, ["refund-policy"], ["refund-policy", "money-back", "api-limits"],
     "The API allows 600 requests per minute."),
    ("What happens over the API limit?", {"api-limits"}, ["api-limits"], ["api-limits", "sso-setup", "chargebacks"],
     "Requests over the limit get HTTP 429."),
]
STOP = set("the a an and or of to is are be in on with for it its this that we can do does what how when".split())
words = lambda s: {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}

def claims(answer):                      # stand-in for an LLM claim extractor
    return [c.strip() for c in re.split(r"(?<=[.!?])\s+", answer) if c.strip()]

def supported(claim, context):           # stand-in for an LLM support check: most content words appear in one source
    w = words(claim)
    return any(len(w & words(DOCS[d])) / max(1, len(w)) >= 0.6 for d in context)

rows = []
for q, gold, retrieved, context, answer in EVAL:
    r_recall = bool(gold & set(retrieved)); c_recall = bool(gold & set(context))
    c_prec = len(gold & set(context)) / len(context)
    cl = claims(answer); faith = sum(supported(c, context) for c in cl) / len(cl)
    relevant = len(words(q) & words(answer)) / max(1, len(words(q))) >= 0.3
    correct = c_recall and faith == 1 and relevant and "could not find" not in answer
    cause = ("ok" if correct else "retrieval miss" if not r_recall else "ranked out of context" if not c_recall
             else "unfaithful" if faith < 1 else "incomplete / off-question")
    rows.append((q, r_recall, c_recall, c_prec, faith, relevant, cause))
    print(f"{q[:40]:<41} retr={int(r_recall)} ctx={int(c_recall)} prec={c_prec:.2f} faith={faith:.2f} rel={int(relevant)} -> {cause}")

n = len(rows)
print(f"\nretrieval recall {sum(r[1] for r in rows) / n:.2f} | context recall {sum(r[2] for r in rows) / n:.2f} | "
      f"context precision {sum(r[3] for r in rows) / n:.2f} | faithfulness {sum(r[4] for r in rows) / n:.2f}")
fails = [r[6] for r in rows if r[6] != "ok"]
print("end-to-end correct:", n - len(fails), "/", n)
print("failure attribution:", {c: fails.count(c) for c in sorted(set(fails))})`
  },
  lab: {
    title: 'Citation precision and recall', file: 'citation_eval_lab.py', browser: true,
    scenario: `<p>The customer’s compliance team will only approve the assistant if citations are trustworthy: each cited source must support the sentence it is attached to (precision), and each factual sentence must cite a supporting source (recall). Implement both metrics over answers with inline citations like <code class="i">[refund-policy]</code>, and report the worst offenders.</p>`,
    steps: ['Parse each answer into sentences and their cited ids.', 'A citation is correct if the cited source supports the sentence (reuse the word-overlap stand-in, threshold 0.6).', 'Citation precision = correct citations / all citations; citation recall = sentences with at least one correct citation / factual sentences (exclude sentences like “Hope this helps”).', 'Compute per answer and overall; list answers with precision or recall below 1.', 'Explain what fix each failure suggests.'],
    checks: ['A sentence citing an unrelated source lowers precision.', 'A factual sentence without citation lowers recall.', 'Pleasantries are not counted against recall.'],
    hints: ['<code class="i">re.findall(r"\\[([a-z0-9-]+)\\]", s)</code> gets cited ids; strip them before checking support.', 'Mark non-factual sentences with a small list of patterns.'],
    starter: String.raw`import re
DOCS = {
    "refund-policy": "Duplicate charges are refunded automatically within 5 business days.",
    "chargebacks": "If a customer disputes a charge with their bank, do not issue a refund while the dispute is open.",
    "api-limits": "The REST API allows 600 requests per minute per workspace.",
}
ANSWERS = {
    "a1": "Duplicate charges are refunded automatically within 5 business days [refund-policy]. Hope this helps!",
    "a2": "Do not issue a refund while the dispute is open [refund-policy]. Duplicate charges are refunded within 5 business days [refund-policy].",
    "a3": "The REST API allows 600 requests per minute per workspace. Do not refund during an open bank dispute [chargebacks].",
}
# TODO: citation precision and recall per answer and overall`,
    solution: String.raw`import re
DOCS = {
    "refund-policy": "Duplicate charges are refunded automatically within 5 business days.",
    "chargebacks": "If a customer disputes a charge with their bank, do not issue a refund while the dispute is open.",
    "api-limits": "The REST API allows 600 requests per minute per workspace.",
}
ANSWERS = {
    "a1": "Duplicate charges are refunded automatically within 5 business days [refund-policy]. Hope this helps!",
    "a2": "Do not issue a refund while the dispute is open [refund-policy]. Duplicate charges are refunded within 5 business days [refund-policy].",
    "a3": "The REST API allows 600 requests per minute per workspace. Do not refund during an open bank dispute [chargebacks].",
}
STOP = set("the a an and or of to is are be in on with for it its this that do not while".split())
words = lambda s: {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}
NON_FACTUAL = re.compile(r"^(hope this helps|let me know|thanks|happy to help)", re.I)

def supports(doc_id, sentence):
    w = words(sentence)
    return doc_id in DOCS and len(w & words(DOCS[doc_id])) / max(1, len(w)) >= 0.6

tot_cit = tot_ok = tot_fact = tot_fact_ok = 0
for aid, text in ANSWERS.items():
    sents = [s for s in re.split(r"(?<=[.!?\]])\s+", text) if s.strip()]
    cit = ok = fact = fact_ok = 0; notes = []
    for s in sents:
        ids = re.findall(r"\[([a-z0-9-]+)\]", s); body = re.sub(r"\s*\[[a-z0-9-]+\]", "", s).strip()
        factual = not NON_FACTUAL.match(body)
        good = [i for i in ids if supports(i, body)]
        cit += len(ids); ok += len(good)
        if factual:
            fact += 1; fact_ok += bool(good)
            if not ids: notes.append(f"uncited fact: '{body[:40]}' -> require citations")
            elif not good: notes.append(f"wrong source {ids} for '{body[:40]}' -> check citation mapping")
    tot_cit += cit; tot_ok += ok; tot_fact += fact; tot_fact_ok += fact_ok
    p = ok / cit if cit else 1.0; r = fact_ok / fact if fact else 1.0
    print(f"{aid}: citation precision {p:.2f}, recall {r:.2f}" + ("" if p == r == 1 else "  " + "; ".join(notes)))
print(f"\noverall citation precision {tot_ok / tot_cit:.2f}, recall {tot_fact_ok / tot_fact:.2f}")`
  },
  design: {
    lead: '<p>RAG evaluation needs labelled evidence, component metrics and an attribution habit. Build it into the pipeline so every retrieval or prompt change shows which link it improved or broke.</p>',
    scale: [{ h: 'Evidence labelling', p: 'Labelling gold chunk ids is laborious; bootstrap with a model proposing candidates and humans confirming, then version with the chunking version (re-chunking changes ids).' }, { h: 'Judge budgets', p: 'Claim-level faithfulness calls a judge per claim; sample for online monitoring, run fully in nightly evals.' }],
    fail: [{ h: 'Stale gold ids', p: 'Re-chunking or re-indexing changes chunk ids and silently breaks retrieval metrics. Map gold evidence to document spans, not chunk ids.' }, { h: 'Faithful but wrong', p: 'An answer can be faithful to an outdated source. Pair faithfulness with freshness and correctness checks.' }],
    trade: [{ h: 'Component vs end-to-end', p: 'Component metrics guide fixes; end-to-end correctness is what users feel. Track both.' }, { h: 'Framework vs own metrics', p: 'RAGAS or DeepEval give quick coverage; own metrics fit the domain and are easier to explain to customers. Many teams use both.' }],
    prompt: '<p>A legal-research RAG assistant has 72% end-to-end correctness. Plan how to get to 90%.</p>',
    answer: '<ul><li>Label gold evidence spans for 300 questions; compute retrieval recall@50, context recall@k, faithfulness and citation metrics.</li><li>Attribute every failure; fix the largest bucket first (often retrieval: legal citations need keyword search and better chunking by clause).</li><li>Re-measure after each change on the held-out set.</li><li>Add a citation-precision gate before release, since lawyers will check citations.</li></ul>'
  },
  quiz: [
    { q: 'The gold evidence is never in the top 50 retrieved chunks. Which fix helps?', o: ['A better generation prompt', 'Improving retrieval: chunking, hybrid search, query rewriting', 'A larger output limit', 'A stricter judge'], a: 1, why: 'Generation cannot use evidence it never sees.' },
    { q: 'Faithfulness measures:', o: ['Whether the answer matches the reference', 'The share of answer claims supported by the retrieved context', 'Retrieval speed', 'Citation formatting'], a: 1, why: 'Groundedness in the provided context.' },
    { q: 'Why map gold evidence to document spans instead of chunk ids?', o: ['It is shorter', 'Chunk ids change when you re-chunk, silently breaking retrieval metrics', 'Spans are faster', 'Judges require it'], a: 1, why: 'Spans survive chunking changes.' }
  ],
  interview: [
    { q: 'How do you evaluate a RAG system?', a: '<p>In layers with labelled evidence: retrieval recall and ranking metrics, context precision, claim-level faithfulness to the retrieved context, answer relevance, citation precision and recall, and end-to-end correctness against references with a calibrated judge. Then I attribute each failure to a component and fix the biggest bucket first.</p>' },
    { q: 'An answer is faithful but wrong. How?', a: '<p>The context itself was wrong or irrelevant: an outdated policy, the wrong customer’s document, or a related but different topic. Faithfulness only checks consistency with what was retrieved, so I also check retrieval correctness, freshness and permissions.</p>' }
  ]
});

/* ===================================================================== 7.5 */
L({
  id: '7.5', title: 'Agent evals', minutes: 55, roles: ['fde', 'be'],
  tags: 'task success · state-based grading · trajectories · pass@k vs pass^k · cost and steps · policy violations · simulated users',
  mental: 'Grade agents mainly on outcomes in the environment (did the refund happen exactly once, is the ticket closed) rather than on matching a reference transcript, then add trajectory checks for safety, efficiency and policy. Because agents are stochastic, run each task several times and measure consistency, not just best-case success.',
  intro: `<p>Agents take many paths to the same correct result, so comparing their transcripts with a reference is brittle. What matters is the state of the world afterwards and whether any rules were broken on the way. Benchmarks such as τ-bench popularised two ideas used widely in industry: checking the final database state, and <b>pass^k</b>, the chance that an agent succeeds on all of k attempts at the same task, which captures reliability far better than a single run.</p>`,
  points: [
    '<b>Outcome graders</b>: check the environment state after the run (records created, emails sent, amounts correct), usually in code.',
    '<b>Trajectory checks</b>: forbidden tools not called, approvals obtained before risky actions, no repeated side effects, steps and cost within budget.',
    '<b>Model graders</b> for qualities code cannot check, such as the clarity of the final message, calibrated as in 7.3.',
    'Run each task k times: pass@k (at least one success) measures capability; pass^k (all succeed) measures reliability.',
    'Use simulated users (a model playing the customer with a scripted goal) for multi-turn tasks, and sandboxed environments with resettable state.',
    'Track cost, latency and steps per successful task; an agent that succeeds expensively may not be viable.'
  ],
  concept: { title: 'Judge the destination and the driving', body: `<p>A driving test checks that you reached the destination and how you drove: no red lights run, no dangerous manoeuvres. Agent evals do the same: the end state must be right, and the route must stay within the rules. And because one good drive proves little, you ask for several.</p>` },
  walk: [
    { h: 'An outcome grader in code', body: '<p>Inspect the environment after the run.</p>', code: String.raw`def grade_refund_task(env, transcript) -> dict:
    refunds = env.db.refunds(charge_id="ch_2")
    return {
        "refund_exactly_once": len(refunds) == 1 and refunds[0].amount_cents == 4800,
        "ticket_closed": env.db.ticket(4812).status == "solved",
        "no_forbidden_tools": not any(c.name == "delete_customer" for c in transcript.tool_calls),
        "approval_before_large_refund": all(a.approved for a in transcript.actions if a.amount_cents > 5000),
    }` },
    { h: 'pass@k and pass^k', body: '<p>With per-trial success probability p and independent trials: pass@k = 1 − (1 − p)^k, pass^k = p^k. An agent at 80% per trial has pass@4 ≈ 99.8% (looks great) but pass^4 ≈ 41% (it is unreliable). Customers experience pass^k.</p>' },
    { h: 'Simulated users', body: '<p>For conversational agents, a second model plays the customer with a hidden goal and persona (“you want a refund for the annual plan but will only reveal the invoice id if asked”). The environment resets between runs, and the grader checks the final state.</p>' }
  ],
  analogy: `<p><b>Checking a contractor’s work.</b> You do not watch every hammer blow; you inspect the finished kitchen (outcome), check that permits were pulled and no load-bearing wall was removed (trajectory rules), and you hire them for the next job only if their last several kitchens were all right (reliability across trials).</p>`,
  diagram: {
    title: 'Agent evaluation harness',
    cols: [['task'], ['env', 'user'], ['agent'], ['traj', 'state'], ['grade']],
    nodes: [
      { id: 'task', label: 'Task spec', sub: 'goal · initial state · k trials', tone: 'fde', info: 'Each task defines a starting state and success conditions.' },
      { id: 'env', label: 'Sandbox env', sub: 'resettable state', tone: 'be', info: 'Fake or staging systems the agent acts on.' },
      { id: 'user', label: 'Simulated user', sub: 'model with hidden goal', info: 'For multi-turn tasks.' },
      { id: 'agent', label: 'Agent under test', sub: 'version X', tone: 'acc', info: 'Runs k times per task.' },
      { id: 'traj', label: 'Trajectory checks', sub: 'policy · cost · steps', tone: 'warn', info: 'Rules on how it got there.' },
      { id: 'state', label: 'Outcome checks', sub: 'final state', tone: 'ok', info: 'Code inspects the environment.' },
      { id: 'grade', label: 'pass@k · pass^k', sub: 'cost per success', info: 'Capability, reliability and efficiency.' }
    ],
    edges: [{ a: 'task', b: 'env' }, { a: 'task', b: 'user' }, { a: 'env', b: 'agent' }, { a: 'user', b: 'agent' }, { a: 'agent', b: 'traj' }, { a: 'agent', b: 'state' }, { a: 'traj', b: 'grade' }, { a: 'state', b: 'grade' }],
    caption: 'Outcome and trajectory graded over repeated trials.'
  },
  illustrated: { title: 'Capability vs reliability', body: `<div class="tbl"><table><thead><tr><th>per-trial success p</th><th>pass@1</th><th>pass@4</th><th>pass^4</th></tr></thead><tbody>
    <tr><td class="n">0.60</td><td class="n">60%</td><td class="n">97%</td><td class="n">13%</td></tr>
    <tr><td class="n">0.80</td><td class="n">80%</td><td class="n">99.8%</td><td class="n">41%</td></tr>
    <tr><td class="n">0.95</td><td class="n">95%</td><td class="n">≈100%</td><td class="n">81%</td></tr></tbody></table></div>
    <p>Benchmarks often report pass@k. For production agents, pass^k is the number that predicts complaints.</p>` },
  code: {
    title: 'Outcome and trajectory grading over repeated trials', file: 'agent_eval.py', browser: true,
    intro: '<p>Three tasks, a seeded stochastic agent, a resettable environment and code graders. Each task runs 8 times; we report per-task pass@1, pass@8, pass^8 and an estimator of pass^k from the observed successes, plus policy violations that occurred even in “successful” runs, and cost per success.</p>',
    src: String.raw`import math, random
from dataclasses import dataclass, field

@dataclass
class Env:
    refunds: list = field(default_factory=list)
    tickets: dict = field(default_factory=lambda: {4812: "open", 4813: "open"})
    approvals: set = field(default_factory=set)

def agent(task: str, env: Env, rng: random.Random) -> dict:
    """A stochastic agent: usually right, sometimes skips approval, double-refunds or gives up."""
    calls, cost = [], 0.0
    def call(name, **kw):
        nonlocal cost
        calls.append((name, kw)); cost += 0.004
    if task == "refund_small":
        call("get_invoice", invoice="INV-991")
        if rng.random() < 0.9:
            call("issue_refund", charge="ch_2", cents=4800); env.refunds.append(("ch_2", 4800))
            if rng.random() < 0.07:                         # retried after a timeout without an idempotency key
                call("issue_refund", charge="ch_2", cents=4800); env.refunds.append(("ch_2", 4800))
            call("close_ticket", id=4812); env.tickets[4812] = "solved"
    elif task == "refund_large":
        call("get_invoice", invoice="INV-992")
        if rng.random() < 0.8:
            call("request_approval", cents=9000); env.approvals.add(9000)
        if rng.random() < 0.85:
            call("issue_refund", charge="ch_9", cents=9000); env.refunds.append(("ch_9", 9000))
            call("close_ticket", id=4813); env.tickets[4813] = "solved"
    elif task == "lookup_only":
        call("get_invoice", invoice="INV-993")
        if rng.random() < 0.05:
            call("issue_refund", charge="ch_7", cents=1200); env.refunds.append(("ch_7", 1200))   # acted when only asked to look
    return {"calls": calls, "cost": cost}

def grade(task, env, run):
    names = [c[0] for c in run["calls"]]
    violations = []
    if task == "refund_large" and "issue_refund" in names and 9000 not in env.approvals:
        violations.append("refund > $50 without approval")
    if len(env.refunds) != len(set(env.refunds)):
        violations.append("duplicate side effect")
    if task == "lookup_only" and "issue_refund" in names:
        violations.append("unrequested write")
    outcome = {"refund_small": env.refunds.count(("ch_2", 4800)) >= 1 and env.tickets[4812] == "solved",
               "refund_large": ("ch_9", 9000) in env.refunds and env.tickets[4813] == "solved",
               "lookup_only": True}[task]
    return outcome and not violations, outcome, violations

K = 8
rng = random.Random(3)
print(f"{'task':<14}{'pass@1':>8}{'pass@8':>8}{'pass^8':>8}{'est pass^4':>11}  violations in outcome-correct runs, cost/success")
for task in ["refund_small", "refund_large", "lookup_only"]:
    results, viol, cost = [], [], 0.0
    for _ in range(K):
        env = Env()
        run = agent(task, env, rng)
        ok, outcome, v = grade(task, env, run)
        results.append(ok); cost += run["cost"]
        if outcome and v: viol += v
    c = sum(results)
    est_pass4 = math.comb(c, 4) / math.comb(K, 4) if c >= 4 else 0.0     # unbiased estimate from n=8 trials with c successes
    print(f"{task:<14}{c / K:>8.2f}{float(c > 0):>8.0f}{float(c == K):>8.0f}{est_pass4:>11.2f}  {sorted(set(viol)) or '-'}, ${'$'}{cost / max(1, c):.3f}")`
  },
  lab: {
    title: 'A simulated-user evaluation', file: 'sim_user_lab.py', browser: true,
    scenario: `<p>A billing assistant must refund the annual plan pro rata, but only after verifying the invoice id, which the simulated customer reveals only when asked. Build the evaluation: a scripted simulated user with a hidden goal, two agent policies (one asks for the id, one guesses), a resettable environment, and graders for outcome and policy. Run 20 seeded conversations per policy and report success, pass^5 estimates and turns used.</p>`,
    steps: ['Simulated user: opens with a vague complaint; reveals “INV-2207” only if the agent asks for an invoice or id; ends after 6 turns or when the refund is confirmed.', 'Agent A asks for the invoice id, then refunds the pro-rata amount (seeded small error rate).', 'Agent B guesses the most recent invoice without asking.', 'Graders: refund to the right invoice with the right amount; identity verified before acting; turns ≤ 6.', 'Report per agent: success rate, estimated pass^5, average turns, and failure counts by type.'],
    checks: ['Agent B fails the verification rule on every run, not just the outcome.', 'Results are reproducible with the seed.', 'pass^5 estimates are lower than pass@1.'],
    hints: ['Represent the conversation as a list of (speaker, text) and let the user script react to keywords.', 'Estimate pass^k from c successes in n trials as C(c, k) / C(n, k).'],
    starter: String.raw`import math, random

def simulated_user(history):
    # TODO: return the next user message based on the agent's last message
    return "I was overcharged on my annual plan."

def agent_a(history, rng):
    # TODO
    return "How can I help?"

def agent_b(history, rng):
    # TODO
    return "How can I help?"

# TODO: run conversations, grade, report`,
    solution: String.raw`import math, random

PRO_RATA = 26_400                                        # cents for the unused months
def simulated_user(history):
    last = history[-1][1].lower() if history else ""
    if not history:
        return "I was overcharged on my annual plan and want my money back."
    if "invoice" in last or "id" in last:
        return "Sure, it's INV-2207."
    if "refunded" in last:
        return "Thanks, that's all."
    return "Can you just fix it please?"

def agent_a(history, rng, env):
    text = " ".join(t for s, t in history if s == "user")
    if "INV-2207" not in text:
        return "I can help. What is the invoice id on the charge?"
    env["verified"] = True
    amount = PRO_RATA if rng.random() > 0.15 else PRO_RATA + 4800     # occasional wrong amount
    env["refund"] = ("INV-2207", amount)
    return f"Done: refunded {amount / 100:.2f} on INV-2207 for the unused months."

def agent_b(history, rng, env):
    env["refund"] = ("INV-2311", PRO_RATA)                 # guesses the latest invoice, never verifies
    return "Done: refunded 264.00 on your latest invoice."

def run(agent, seed):
    rng, env, history = random.Random(seed), {"verified": False, "refund": None}, []
    for turn in range(1, 7):
        history.append(("user", simulated_user(history)))
        history.append(("agent", agent(history, rng, env)))
        if env["refund"]:
            break
    failures = []
    if env["refund"] != ("INV-2207", PRO_RATA): failures.append("wrong refund")
    if env["refund"] and not env["verified"]: failures.append("acted before verifying")
    if turn > 6: failures.append("too many turns")
    return not failures, failures, turn

def pass_hat(c, n, k):
    return math.comb(c, k) / math.comb(n, k) if c >= k else 0.0

N = 20
for name, agent in [("agent A (asks)", agent_a), ("agent B (guesses)", agent_b)]:
    outs = [run(agent, s) for s in range(N)]
    c = sum(o[0] for o in outs)
    fails = [f for o in outs for f in o[1]]
    counts = {f: fails.count(f) for f in sorted(set(fails))} or "-"
    print(f"{name:<18} success {c / N:.2f} | est pass^5 {pass_hat(c, N, 5):.2f} | avg turns {sum(o[2] for o in outs) / N:.1f} | failures: {counts}")`
  },
  design: {
    lead: '<p>Agent evaluation needs environments: resettable sandboxes, simulated users, graders and repeated trials. It is infrastructure, and it pays for itself the first time it catches an agent that refunds twice.</p>',
    scale: [{ h: 'Parallel trials', p: 'k trials × hundreds of tasks is thousands of agent runs; run them in parallel with per-run sandboxes and budgets.' }, { h: 'Environment fidelity', p: 'Mocks drift from real systems. Periodically replay tasks against staging APIs to catch mismatches.' }],
    fail: [{ h: 'Transcript matching', p: 'Grading by similarity to a reference trajectory penalises valid alternative paths and rewards copying. Grade outcomes.' }, { h: 'Single-trial optimism', p: 'Reporting one run per task hides flakiness. Report pass^k or success rates with intervals.' }],
    trade: [{ h: 'Code vs model graders', p: 'Code graders are exact and cheap for state checks; model graders cover communication quality and need calibration.' }, { h: 'Realism vs cost', p: 'Simulated users and full sandboxes are realistic and expensive; simple scripted environments are fast for CI.' }],
    prompt: '<p>Design the eval suite for an IT helpdesk agent that can reset passwords, add users to groups and open hardware tickets.</p>',
    answer: '<ul><li>60 tasks from real ticket categories, each with initial directory state, a simulated employee and success conditions.</li><li>Outcome graders on directory and ticket state; trajectory rules (identity verified before resets, no admin group changes, budget).</li><li>8 trials per task; report pass^8 per category, policy violations and cost per success.</li><li>Fast scripted subset in CI; full suite nightly; staging replay weekly.</li></ul>'
  },
  quiz: [
    { q: 'Per-trial success is 80%. What is pass^4?', o: ['80%', 'About 41%', 'About 99.8%', '20%'], a: 1, why: '0.8^4 ≈ 0.41.' },
    { q: 'Why grade agents on final environment state?', o: ['It is cheaper only', 'Many valid trajectories reach the same correct outcome; state checks judge what matters', 'Transcripts are private', 'Models require it'], a: 1, why: 'Outcome grading is robust to path variation.' },
    { q: 'A run reaches the right state but skipped a required approval. It should be graded:', o: ['Pass', 'Fail, as a policy violation', 'Ignored', 'Half credit always'], a: 1, why: 'Trajectory rules matter as much as outcomes.' }
  ],
  interview: [
    { q: 'How do you evaluate an agent that takes actions?', a: '<p>Tasks with resettable sandbox environments and, for conversations, simulated users; code graders that check the final state; trajectory rules for policy, safety and budget; model graders for communication quality; multiple trials per task with pass^k for reliability; and cost and steps per success. I compare versions on the same tasks and trials.</p>' },
    { q: 'What is the difference between pass@k and pass^k?', a: '<p>pass@k is the probability that at least one of k attempts succeeds, which measures capability. pass^k is the probability that all k attempts succeed, which measures consistency. For production agents, users experience consistency, so pass^k is the better guide.</p>' }
  ]
});

/* ===================================================================== 7.6 */
L({
  id: '7.6', title: 'CI eval gates with DeepEval', minutes: 50, roles: ['be', 'fde'],
  tags: 'pytest · DeepEval · GEval · custom metrics · thresholds · baselines · GitHub Actions · regression gates',
  mental: 'Evals become a safety net only when they run automatically on every change and can block a merge. Encode test cases and metrics as tests, set thresholds and baselines, run a fast suite on pull requests and a full suite before release, and make failures easy to read.',
  intro: `<p>Prompts, models, retrieval settings and tools change weekly. Without an automated gate, each change is a gamble on whether something else broke. DeepEval is one of the common open-source frameworks for this: it plugs into pytest, offers judge-based metrics such as GEval and RAG metrics, and lets you write deterministic custom metrics alongside them.</p>
  <p>The same pattern works with other tools (promptfoo, OpenAI Evals, Braintrust, LangSmith, or plain pytest); what matters is test cases, metrics, thresholds, baselines and CI wiring.</p>`,
  points: [
    'Write eval cases as parametrised tests; each case runs the system and asserts metrics.',
    'Mix deterministic metrics (schema, citations, exact fields) with judge metrics (GEval with a rubric), and pin the judge model.',
    'Thresholds per metric, plus comparison with a stored baseline so small regressions are caught, not just absolute failures.',
    'A fast smoke suite (tens of cases) on every pull request; the full suite nightly and before releases.',
    'Make the system under test deterministic where possible (temperature, seeds, cached retrieval) to reduce flakiness, and retry or mark known-flaky cases explicitly.',
    'Report results as artefacts: per-case outputs, scores and reasons, linked from the pull request.'
  ],
  concept: { title: 'Unit tests for behaviour', body: `<p>Traditional tests check that code does what it says. Eval gates check that the AI system still behaves as agreed: answers the refund question correctly, cites sources, refuses what it should. Like unit tests, their value comes from running every time, failing loudly, and being trusted enough that the team fixes the code rather than deleting the test.</p>` },
  walk: [
    { h: 'A DeepEval test', body: '<p>A GEval metric with a rubric and a custom deterministic metric, asserted per case.</p>', code: String.raw`correctness = GEval(name="Correctness", criteria="Does the actual output contain the key facts of the expected output?",
                    evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT, SingleTurnParams.EXPECTED_OUTPUT],
                    model=JUDGE, threshold=0.7)

@pytest.mark.parametrize("question,expected", CASES)
def test_answers(question, expected):
    tc = LLMTestCase(input=question, actual_output=answer(question), expected_output=expected)
    assert_test(tc, [correctness, CitesSource()])` },
    { h: 'Wire it into CI', body: '<p>Run on pull requests that touch prompts, retrieval or agent code.</p>', lang: 'yaml', file: '.github/workflows/evals.yml', code: String.raw`name: evals
on:
  pull_request:
    paths: ["prompts/**", "app/**", "evals/**"]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen
      - run: uv run pytest evals/smoke -q --junitxml=evals.xml
        env:
          ANTHROPIC_API_KEY: ${'$'}{{ secrets.ANTHROPIC_API_KEY }}
          DEEPEVAL_TELEMETRY_OPT_OUT: "YES"
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: eval-results, path: evals.xml }` },
    { h: 'Gate on baselines too', body: '<p>Absolute thresholds catch disasters; baseline comparisons catch drift. Store the last release’s per-metric results and fail if any metric or slice drops more than an agreed tolerance (the lab builds this).</p>' }
  ],
  analogy: `<p><b>A factory quality gate.</b> Every batch is sampled and tested before shipping; if a measurement drifts outside tolerance, the line stops. Nobody argues with the gate in the moment; they fix the process. Eval gates give AI releases the same discipline.</p>`,
  diagram: {
    title: 'Eval gates in the delivery pipeline',
    cols: [['pr'], ['smoke'], ['merge'], ['nightly'], ['release']],
    nodes: [
      { id: 'pr', label: 'Pull request', sub: 'prompt · code · config', tone: 'fde', info: 'Any change that can alter behaviour.' },
      { id: 'smoke', label: 'Smoke evals', sub: '30–80 cases · minutes', tone: 'acc', info: 'Deterministic metrics plus a few judge metrics; blocks merge on failure.' },
      { id: 'merge', label: 'Merge', sub: 'main', info: 'Only changes that pass the gate.' },
      { id: 'nightly', label: 'Full suite', sub: 'all cases · slices · agents', tone: 'be', info: 'Nightly: full datasets, k trials for agents, judge metrics.' },
      { id: 'release', label: 'Release gate', sub: 'held-out · baseline diff', tone: 'ok', info: 'Compares with the last release per metric and slice before deploying.' }
    ],
    edges: [{ a: 'pr', b: 'smoke' }, { a: 'smoke', b: 'merge', label: 'pass' }, { a: 'merge', b: 'nightly' }, { a: 'nightly', b: 'release' }],
    caption: 'Fast checks on every change, full checks before every release.'
  },
  illustrated: { title: 'Two kinds of gates', body: `<div class="tbl"><table><thead><tr><th>gate</th><th>rule</th><th>catches</th></tr></thead><tbody>
    <tr><td>absolute threshold</td><td>correctness ≥ 0.85; citation precision ≥ 0.95; zero unsafe outputs</td><td>broken prompts, missing citations, safety failures</td></tr>
    <tr><td>baseline comparison</td><td>no metric drops more than 2 points vs last release; no slice more than 5</td><td>slow drift, slice regressions</td></tr>
    <tr><td>budget gate</td><td>median cost and p95 latency within 10% of baseline</td><td>a prompt change that doubles tokens</td></tr></tbody></table></div>` },
  code: {
    title: 'A DeepEval gate run with pytest', file: 'run_evals.sh', lang: 'bash', deps: 'uv add deepeval pytest',
    intro: '<p>Three files: the system under test (<code class="i">app.py</code>), a stand-in judge model so the suite runs offline (<code class="i">judge.py</code>), and the test file with a GEval metric and a custom citation metric (<code class="i">test_triage.py</code>). One case deliberately lacks a citation, so the gate fails and shows exactly why. Replace the judge with a real model in CI.</p>',
    files: { 'app.py': DE_APP, 'judge.py': DE_JUDGE, 'test_triage.py': DE_TEST },
    src: String.raw`# app.py, judge.py and test_triage.py are shown below
python -m pytest -q -p no:cacheprovider --tb=line -W ignore::DeprecationWarning test_triage.py 2>&1 | grep -v "^INFO" | tail -6
echo "pytest exit code: ${'$'}{PIPESTATUS[0]}  (non-zero blocks the merge)"`,
    more: [
      { note: '<b>app.py</b>: the system under test.', file: 'app.py', src: DE_APP },
      { note: '<b>judge.py</b>: an offline stand-in for the judge model.', file: 'judge.py', src: DE_JUDGE },
      { note: '<b>test_triage.py</b>: cases, metrics and assertions.', file: 'test_triage.py', src: DE_TEST }
    ]
  },
  lab: {
    title: 'A baseline regression gate', file: 'gate_lab.py', browser: true,
    scenario: `<p>Absolute thresholds passed, yet customers noticed the new release was worse for Spanish tickets. Build the release gate script that compares the candidate’s eval results with the last release: per metric and per slice tolerances, cost and latency budgets, a readable report, and an exit code CI can use.</p>`,
    steps: ['Inputs: baseline and candidate results as dicts of metric → overall and per-slice values, plus cost and p95 latency.', 'Rules: overall metric drop > 2 points fails; any slice drop > 5 points fails; cost or latency up > 10% fails; improvements are reported.', 'Ignore slices with fewer than 30 cases (warn instead).', 'Print a table of changes with PASS, WARN or FAIL per line, then a summary.', 'Return exit code 1 on any FAIL.'],
    checks: ['The Spanish slice regression fails the gate.', 'The small slice produces a warning, not a failure.', 'The exit code reflects the result.'],
    hints: ['Keep rules as data (a dict of tolerances) so the customer can review them.', 'Format percentages consistently, as points of change.'],
    starter: String.raw`baseline = {"correctness": {"overall": 0.86, "slices": {"en": (0.88, 400), "es": (0.84, 120), "de": (0.80, 18)}},
            "citation_precision": {"overall": 0.96, "slices": {"en": (0.96, 400), "es": (0.95, 120), "de": (0.97, 18)}},
            "cost_usd": 0.021, "p95_ms": 2400}
candidate = {"correctness": {"overall": 0.87, "slices": {"en": (0.90, 400), "es": (0.77, 120), "de": (0.70, 18)}},
             "citation_precision": {"overall": 0.97, "slices": {"en": (0.97, 400), "es": (0.96, 120), "de": (0.95, 18)}},
             "cost_usd": 0.022, "p95_ms": 2900}

def gate(baseline, candidate):
    # TODO: return exit code
    return 0

raise SystemExit(gate(baseline, candidate)) if False else print("exit code:", gate(baseline, candidate))`,
    solution: String.raw`baseline = {"correctness": {"overall": 0.86, "slices": {"en": (0.88, 400), "es": (0.84, 120), "de": (0.80, 18)}},
            "citation_precision": {"overall": 0.96, "slices": {"en": (0.96, 400), "es": (0.95, 120), "de": (0.97, 18)}},
            "cost_usd": 0.021, "p95_ms": 2400}
candidate = {"correctness": {"overall": 0.87, "slices": {"en": (0.90, 400), "es": (0.77, 120), "de": (0.70, 18)}},
             "citation_precision": {"overall": 0.97, "slices": {"en": (0.97, 400), "es": (0.96, 120), "de": (0.95, 18)}},
             "cost_usd": 0.022, "p95_ms": 2900}
RULES = {"overall_drop_pts": 2.0, "slice_drop_pts": 5.0, "min_slice_n": 30, "budget_increase": 0.10}

def gate(baseline, candidate, rules=RULES):
    lines, fails = [], 0
    def add(status, what, old, new, unit="pts"):
        nonlocal fails
        fails += status == "FAIL"
        delta = (new - old) * 100 if unit == "pts" else (new / old - 1) * 100
        lines.append(f"{status:<5} {what:<34} {old:>8.3f} -> {new:<8.3f} ({delta:+.1f} {'pts' if unit == 'pts' else '%'})")
    for metric in ("correctness", "citation_precision"):
        b, c = baseline[metric], candidate[metric]
        drop = (b["overall"] - c["overall"]) * 100
        add("FAIL" if drop > rules["overall_drop_pts"] else "PASS", f"{metric} overall", b["overall"], c["overall"])
        for s, (bv, n) in b["slices"].items():
            cv, _ = c["slices"][s]
            drop = (bv - cv) * 100
            if n < rules["min_slice_n"]:
                add("WARN" if drop > rules["slice_drop_pts"] else "PASS", f"{metric} [{s}] (n={n}, too small to gate)", bv, cv)
            else:
                add("FAIL" if drop > rules["slice_drop_pts"] else "PASS", f"{metric} [{s}] (n={n})", bv, cv)
    for k in ("cost_usd", "p95_ms"):
        inc = candidate[k] / baseline[k] - 1
        add("FAIL" if inc > rules["budget_increase"] else "PASS", k, baseline[k], candidate[k], unit="%")
    print("\n".join(lines))
    print(f"\n{fails} failing check(s): {'BLOCK release' if fails else 'release allowed'}")
    return 1 if fails else 0

print("exit code:", gate(baseline, candidate))`
  },
  design: {
    lead: '<p>CI evals are a product for your own team: fast, trustworthy, readable and cheap enough to run on every change. Flaky or slow gates get bypassed; design them so nobody wants to.</p>',
    scale: [{ h: 'Cost and time', p: 'Smoke suites under 10 minutes and a few dollars; cache system outputs by (input, config hash) so unchanged cases skip regeneration.' }, { h: 'Parallelism', p: 'Run cases concurrently with rate limits (Phase 0.2); shard large suites across CI workers.' }],
    fail: [{ h: 'Flaky gates', p: 'Non-deterministic outputs and judges make tests flap. Use low temperature, multiple samples with majority vote for judges, and explicit flaky markers with tracking.' }, { h: 'Threshold creep', p: 'Teams lower thresholds to get green builds. Changes to thresholds need review like code changes.' }],
    trade: [{ h: 'Breadth vs speed', p: 'More cases catch more regressions but slow every PR. Split into smoke, nightly and release tiers.' }, { h: 'Framework vs plain pytest', p: 'Frameworks bring ready metrics and dashboards; plain pytest with your own metrics has fewer dependencies. Both work.' }],
    prompt: '<p>Set up eval gates for a team shipping prompt changes daily for a support assistant used by 40 enterprise tenants.</p>',
    answer: '<ul><li>Smoke suite (60 cases across top tenants and risky slices) on every PR: schema, citation and safety checks plus a pinned judge for correctness.</li><li>Nightly full suite with per-tenant slices and agent tasks with k trials.</li><li>Release gate comparing with the last release: overall, slice, cost and latency tolerances, as reviewed code.</li><li>Results as artefacts linked from PRs; flaky cases tracked and fixed weekly.</li></ul>'
  },
  quiz: [
    { q: 'Absolute thresholds pass but one language dropped 7 points. Which gate catches it?', o: ['None', 'A baseline comparison with per-slice tolerances', 'A latency gate', 'A schema test'], a: 1, why: 'Slice-level baseline diffs catch regressions that averages hide.' },
    { q: 'How do you reduce flakiness in judge-based CI tests?', o: ['Raise temperature', 'Pin the judge, lower temperature, and aggregate several judge samples', 'Remove the judge', 'Run once a month'], a: 1, why: 'Stable instruments give stable gates.' },
    { q: 'Why mix deterministic and judge metrics?', o: ['Judges are always wrong', 'Deterministic checks are cheap and exact for format and citations; judges cover qualities code cannot check', 'Frameworks require both', 'For speed only'], a: 1, why: 'Each covers what the other cannot.' }
  ],
  interview: [
    { q: 'How would you prevent prompt changes from silently degrading quality?', a: '<p>Evals in CI: a smoke suite on every pull request with deterministic checks and a pinned, calibrated judge; thresholds and baseline comparisons per metric and slice; cost and latency budgets; a full nightly suite and a release gate on held-out data. Results are artefacts on the PR, and threshold changes go through review.</p>' },
    { q: 'An eval test fails intermittently. What do you do?', a: '<p>Find the source: system non-determinism, judge variance, or a genuinely borderline case. Reduce variance (temperature, seeds, cached retrieval, several judge samples), fix or relabel ambiguous cases, and mark truly flaky cases explicitly with tracking rather than deleting them or lowering the threshold.</p>' }
  ]
});

/* ===================================================================== 7.7 */
L({
  id: '7.7', title: 'Online evals', minutes: 50, roles: ['fde', 'be'],
  tags: 'production monitoring · sampled judging · user feedback · drift (PSI) · A/B tests · canaries · feedback to datasets',
  mental: 'Offline evals predict; production tells the truth. Continuously score a sample of live traffic with calibrated judges, track user signals and input drift, roll out changes as canaries or A/B tests with guardrail metrics, and feed every failure back into the offline eval set.',
  intro: `<p>Users ask things your eval set never imagined, data drifts, upstream models change, and customers onboard new use cases. Online evaluation closes the loop: it measures quality on real traffic, detects when it changes, and decides releases with experiments instead of hope. For FDEs, it is also the evidence base for the customer conversation: “resolution rate rose from 61% to 68% after the retrieval change, with no increase in escalations”.</p>`,
  points: [
    'Sample traces (for example 2% to 10%, plus all flagged ones) and score them with calibrated judges for correctness, faithfulness and policy.',
    'Collect implicit and explicit signals: thumbs, edits to drafts, copy events, escalations to humans, repeated questions, abandonment.',
    'Detect drift in inputs (topic mix, languages, lengths) and outputs (refusal rate, citation rate, length) with statistics such as PSI.',
    'Release with canaries (small traffic share first) or A/B tests; define success and guardrail metrics before starting.',
    'Respect privacy: score with redaction, restrict access to raw traces, and follow tenant agreements on data use.',
    'Route failures into a review queue; confirmed failures become new offline eval cases (7.1).'
  ],
  concept: { title: 'The feedback loop', body: `<p>Offline evals are a map; production is the territory. Online evals keep the map current: they find where the territory has changed (drift), where the map was wrong (new failure types), and whether a new route is really better (experiments). Each loop through it makes the next offline eval more predictive.</p>` },
  walk: [
    { h: 'Sample and score', body: '<p>A background job reads traces, applies redaction, scores a sample with judges and writes scores back next to the trace ids (lesson 3.7), so dashboards and drill-downs share one source.</p>' },
    { h: 'Watch drift with PSI', body: '<p>Population stability index compares a current distribution with a reference over bins: PSI = Σ (cur − ref) · ln(cur / ref). Common rules of thumb: below 0.1 stable, 0.1 to 0.25 moderate shift, above 0.25 significant shift worth investigating.</p>' },
    { h: 'Experiment properly', body: '<p>Randomise by user or conversation, run until the pre-computed sample size is reached, check guardrails (latency, cost, escalation rate), and do not peek and stop early on a lucky day.</p>' }
  ],
  analogy: `<p><b>A restaurant after opening night.</b> The tasting menu was perfected in the test kitchen (offline evals). Now the chef samples plates leaving the kitchen (sampled judging), reads the reviews and watches what comes back half-eaten (user signals), notices when the clientele changes (drift), and trials a new dish on a few tables before adding it to the menu (canary).</p>`,
  diagram: {
    title: 'The online evaluation loop',
    cols: [['traffic'], ['traces'], ['judge', 'signals', 'drift'], ['dash'], ['queue', 'exp'], ['offline']],
    nodes: [
      { id: 'traffic', label: 'Live traffic', sub: 'A / B / canary', tone: 'fde', info: 'Real users, possibly split between versions.' },
      { id: 'traces', label: 'Traces', sub: 'redacted', tone: 'be', info: 'Requests, outputs, tools, costs (lesson 3.7).' },
      { id: 'judge', label: 'Sampled judging', sub: '2–10% + flagged', tone: 'acc', info: 'Calibrated judges on a sample.' },
      { id: 'signals', label: 'User signals', sub: 'thumbs · edits · escalations', info: 'Implicit and explicit feedback.' },
      { id: 'drift', label: 'Drift monitors', sub: 'PSI · rates', tone: 'warn', info: 'Input and output distribution changes.' },
      { id: 'dash', label: 'Dashboards + alerts', sub: 'per tenant', info: 'Quality, cost, latency and drift over time.' },
      { id: 'queue', label: 'Review queue', sub: 'humans confirm', info: 'Flagged cases checked by people.' },
      { id: 'exp', label: 'Experiment readout', sub: 'ship / roll back', tone: 'ok', info: 'Success and guardrail metrics decide releases.' },
      { id: 'offline', label: 'Offline eval set', sub: 'grows from failures', info: 'Confirmed failures become new test cases.' }
    ],
    edges: [{ a: 'traffic', b: 'traces' }, { a: 'traces', b: 'judge' }, { a: 'traces', b: 'signals' }, { a: 'traces', b: 'drift' }, { a: 'judge', b: 'dash' }, { a: 'signals', b: 'dash' }, { a: 'drift', b: 'dash' }, { a: 'dash', b: 'queue' }, { a: 'dash', b: 'exp' }, { a: 'queue', b: 'offline' }],
    caption: 'Production feeds monitoring, experiments and, finally, the offline eval set.'
  },
  illustrated: { title: 'Reading a drift alert', body: `<div class="tbl"><table><thead><tr><th>topic</th><th>reference share</th><th>this week</th><th>PSI term</th></tr></thead><tbody>
    <tr><td>billing</td><td class="n">55%</td><td class="n">41%</td><td class="n">0.041</td></tr>
    <tr><td>how-to</td><td class="n">30%</td><td class="n">27%</td><td class="n">0.003</td></tr>
    <tr><td>SSO / login</td><td class="n">10%</td><td class="n">27%</td><td class="n">0.169</td></tr>
    <tr><td>other</td><td class="n">5%</td><td class="n">5%</td><td class="n">0.000</td></tr>
    <tr><td><b>PSI</b></td><td></td><td></td><td class="n"><b>0.21</b></td></tr></tbody></table></div>
    <p>Login questions nearly tripled (perhaps an SSO outage or a new enterprise tenant). Check the judge score for that slice before anything else.</p>` },
  code: {
    title: 'Monitoring 14 days of traffic: sampled judging, signals and drift', file: 'online_monitor.py', browser: true,
    intro: '<p>Simulated production: 14 days of conversations with a topic mix that shifts on day 9 (a new tenant brings many SSO questions the system handles poorly). We sample 5% for judging with daily confidence intervals, track escalation rate, compute PSI of the topic mix against the first week, and fire alerts with clear reasons.</p>',
    src: String.raw`import numpy as np

rng = np.random.default_rng(14)
TOPICS = ["billing", "how_to", "sso", "other"]
REF_MIX = np.array([0.55, 0.30, 0.10, 0.05])
QUALITY = {"billing": 0.90, "how_to": 0.86, "sso": 0.62, "other": 0.80}     # true pass rate per topic

def day_traffic(day):
    mix = REF_MIX if day < 9 else np.array([0.42, 0.27, 0.26, 0.05])
    n = int(rng.normal(4000, 200))
    topics = rng.choice(4, size=n, p=mix)
    passed = rng.random(n) < np.array([QUALITY[TOPICS[t]] for t in topics])
    escalated = (~passed & (rng.random(n) < 0.5)) | (rng.random(n) < 0.03)
    return topics, passed, escalated

def psi(ref, cur, eps=1e-4):
    ref, cur = np.clip(ref, eps, None), np.clip(cur, eps, None)
    return float(np.sum((cur - ref) * np.log(cur / ref)))

print(f"{'day':>3} {'judged':>6} {'judge pass [95% CI]':>22} {'escal.':>7} {'PSI':>6}  alerts")
for day in range(1, 15):
    topics, passed, esc = day_traffic(day)
    sample = rng.random(len(topics)) < 0.05                       # 5% sampled for the judge
    judged = passed[sample]                                       # assume a calibrated judge agrees with truth
    p = judged.mean(); half = 1.96 * np.sqrt(p * (1 - p) / len(judged))
    mix = np.bincount(topics.astype(np.intp), minlength=4) / len(topics)
    d = psi(REF_MIX, mix)
    alerts = []
    if p + half < 0.84: alerts.append("judge pass rate below 0.84 with confidence")
    if esc.mean() > 0.115: alerts.append(f"escalations {esc.mean():.1%}")
    if d > 0.1: alerts.append(f"topic drift (PSI {d:.2f}): sso share {mix[2]:.0%}")
    print(f"{day:>3} {sample.sum():>6}   {p:.3f} [{p - half:.3f}, {p + half:.3f}] {esc.mean():>7.1%} {d:>6.3f}  {'; '.join(alerts)}")

sso = topics == 2
print(f"\nlast day by topic: sso pass {passed[sso].mean():.2f} on {sso.sum()} chats vs others {passed[~sso].mean():.2f}")
print("action: add sampled sso failures to the review queue -> new eval cases -> fix retrieval for SSO docs")`
  },
  lab: {
    title: 'Read out an A/B test', file: 'ab_lab.py', browser: true,
    scenario: `<p>The team ran a two-week A/B test of a new retrieval setup. The success metric is resolution without escalation; guardrails are p95 latency, cost per conversation and thumbs-down rate. Analyse the experiment: check the sample ratio, compute the lift with a confidence interval and a two-proportion z-test, check guardrails, and write the ship or no-ship recommendation.</p>`,
    steps: ['Use the seeded per-conversation data in the starter for variants A and B.', 'Sample ratio mismatch check: is the A/B split consistent with 50/50 (chi-square or z-test)?', 'Resolution rate per variant, absolute lift, 95% CI of the difference, and z-test p-value.', 'Guardrails: p95 latency, mean cost and thumbs-down rate per variant with tolerances (latency +15%, cost +10%, thumbs-down +1 point).', 'Print the readout and a one-sentence decision.'],
    checks: ['The sample ratio check passes.', 'The lift is significant at 5% and the CI excludes zero.', 'A guardrail violation, if any, is reflected in the decision.'],
    hints: ['Pooled z = (pB − pA) / sqrt(p(1−p)(1/nA + 1/nB)).', 'Normal CDF: use <code class="i">0.5 * (1 + math.erf(z / math.sqrt(2)))</code>.'],
    starter: String.raw`import math
import numpy as np
rng = np.random.default_rng(23)
nA, nB = 10_120, 9_980
data = {
    "A": {"resolved": rng.random(nA) < 0.640, "latency": rng.lognormal(7.4, 0.35, nA), "cost": rng.normal(0.031, 0.006, nA), "thumbs_down": rng.random(nA) < 0.052},
    "B": {"resolved": rng.random(nB) < 0.668, "latency": rng.lognormal(7.5, 0.35, nB), "cost": rng.normal(0.033, 0.006, nB), "thumbs_down": rng.random(nB) < 0.049},
}
# TODO: SRM check, lift + CI + z-test, guardrails, decision`,
    solution: String.raw`import math
import numpy as np
rng = np.random.default_rng(23)
nA, nB = 10_120, 9_980
data = {
    "A": {"resolved": rng.random(nA) < 0.640, "latency": rng.lognormal(7.4, 0.35, nA), "cost": rng.normal(0.031, 0.006, nA), "thumbs_down": rng.random(nA) < 0.052},
    "B": {"resolved": rng.random(nB) < 0.668, "latency": rng.lognormal(7.5, 0.35, nB), "cost": rng.normal(0.033, 0.006, nB), "thumbs_down": rng.random(nB) < 0.049},
}
Phi = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))

# 1) sample ratio mismatch
n = nA + nB; z_srm = (nA - n / 2) / math.sqrt(n * 0.25)
print(f"sample ratio: A {nA} / B {nB} -> z {z_srm:.2f}, p {2 * (1 - Phi(abs(z_srm))):.3f} ({'OK' if abs(z_srm) < 3 else 'MISMATCH: investigate assignment'})")

# 2) success metric
pA, pB = data["A"]["resolved"].mean(), data["B"]["resolved"].mean()
p = (pA * nA + pB * nB) / n
z = (pB - pA) / math.sqrt(p * (1 - p) * (1 / nA + 1 / nB))
se = math.sqrt(pA * (1 - pA) / nA + pB * (1 - pB) / nB)
print(f"resolution: A {pA:.3f}, B {pB:.3f}, lift {100 * (pB - pA):+.2f} pts, 95% CI [{100 * (pB - pA - 1.96 * se):+.2f}, {100 * (pB - pA + 1.96 * se):+.2f}], z {z:.2f}, p {2 * (1 - Phi(abs(z))):.4f}")

# 3) guardrails
checks = []
lat = {v: np.percentile(data[v]["latency"], 95) for v in "AB"}
cost = {v: data[v]["cost"].mean() for v in "AB"}
td = {v: data[v]["thumbs_down"].mean() for v in "AB"}
checks.append(("p95 latency", f"{lat['A']:.0f} -> {lat['B']:.0f} ms", lat["B"] / lat["A"] - 1 <= 0.15))
checks.append(("cost/conversation", f"${'$'}{cost['A']:.4f} -> ${'$'}{cost['B']:.4f}", cost["B"] / cost["A"] - 1 <= 0.10))
checks.append(("thumbs-down rate", f"{td['A']:.3%} -> {td['B']:.3%}", td["B"] - td["A"] <= 0.01))
for name, val, ok in checks:
    print(f"guardrail {name:<18} {val:<26} {'OK' if ok else 'VIOLATED'}")

significant = abs(z) > 1.96 and pB > pA
decision = ("ship B" if significant and all(c[2] for c in checks) else
            "do not ship yet: fix the violated guardrail" if significant else "no significant improvement: keep A")
print(f"\ndecision: {decision}")`
  },
  design: {
    lead: '<p>Online evaluation is a data platform: traces, sampling, judging, signals, drift, experiments and a path back to offline datasets. Build it early; it is how you prove value to the customer and catch problems before they do.</p>',
    scale: [{ h: 'Sampling strategy', p: 'Uniform samples for unbiased estimates, plus targeted samples (flagged, low confidence, new tenants) for finding failures. Keep them separate in analysis.' }, { h: 'Per-tenant views', p: 'Enterprise customers want their own numbers; build dashboards with tenant filters and access control.' }],
    fail: [{ h: 'Peeking', p: 'Stopping an A/B test the first day it looks significant inflates false positives. Fix sample size or use sequential methods.' }, { h: 'Feedback bias', p: 'Thumbs come from a small, unrepresentative group of users. Combine them with sampled judging rather than relying on them alone.' }],
    trade: [{ h: 'Judging cost vs coverage', p: 'Judging every trace is expensive; small uniform samples give good estimates for aggregates, targeted samples find failures.' }, { h: 'A/B test vs canary', p: 'A/B tests measure lift precisely but need traffic and time; canaries catch breakage fast with little traffic.' }],
    prompt: '<p>Six weeks after launch, a customer says "the assistant got worse". You have traces and a judge. How do you respond in 48 hours?</p>',
    answer: '<ul><li>Pull judge scores and escalation rates over time per slice; check for releases, model or index changes at the inflection.</li><li>Compute input drift (topics, languages, new tenants or documents).</li><li>Sample failing traces into review; attribute failures (7.4).</li><li>Report findings with numbers, a fix plan, and new eval cases that would have caught it.</li></ul>'
  },
  quiz: [
    { q: 'PSI of the topic mix jumps from 0.03 to 0.27. What does it suggest?', o: ['Nothing', 'A significant shift in what users ask about; check quality on the growing slice', 'The judge broke', 'Latency increased'], a: 1, why: 'PSI above about 0.25 indicates significant distribution shift.' },
    { q: 'Why check sample ratio mismatch in an A/B test?', o: ['For style', 'A skewed split signals broken assignment that can bias the results', 'It increases power', 'It is required by law'], a: 1, why: 'SRM often reveals bugs in experiment assignment.' },
    { q: 'Where should confirmed production failures go?', o: ['Nowhere', 'Into the offline eval set as new test cases', 'Into the system prompt verbatim', 'Deleted for privacy always'], a: 1, why: 'Closing the loop makes offline evals more predictive.' }
  ],
  interview: [
    { q: 'How do you monitor the quality of an LLM application in production?', a: '<p>Traces for every request; sampled scoring with calibrated judges for correctness, faithfulness and policy; user signals such as thumbs, edits and escalations; drift monitors on inputs and outputs; per-tenant dashboards and alerts; canaries and A/B tests for changes; and a review queue that turns confirmed failures into offline eval cases.</p>' },
    { q: 'How do you decide whether to ship a change based on an A/B test?', a: '<p>Predefine the success metric, guardrails and sample size; check the sample ratio; compute lift with a confidence interval and test; check guardrails such as latency, cost and complaint rates; and ship only if the success metric improves significantly without guardrail violations. No early stopping on a lucky day.</p>' }
  ]
});
})();
