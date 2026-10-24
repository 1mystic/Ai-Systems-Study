/* Phase 13 · Fine-tuning and multimodal */
(function () {
const L = AISA.lesson;

/* ===================================================================== 13.1 */
L({
  id: '13.1', title: 'When to fine-tune', minutes: 45, roles: ['be', 'fde'],
  tags: 'prompting vs RAG vs fine-tuning · SFT · preference tuning (DPO) · reinforcement fine-tuning · distillation · data readiness · break-even cost · managed fine-tuning',
  mental: 'Fine-tuning changes how a model behaves, not what it knows today. Try prompting, examples, retrieval and tools first; fine-tune when you need consistent format or style at scale, a smaller model to match a larger one on a narrow task (distillation), or lower latency and cost, and only with a clean dataset and an eval set that proves the gain.',
  intro: `<p>Customers often ask for fine-tuning first (“train it on our data”). Usually what they need is retrieval (fresh, citable knowledge) or better prompts and tools. Fine-tuning shines in different situations: high-volume narrow tasks where a small tuned model can replace a large prompted one, strict output styles, classification and extraction with many examples, and domain language a base model handles poorly. Managed fine-tuning is offered by several providers and cloud platforms for selected models; open-weight models can be tuned with LoRA (13.2).</p>`,
  points: [
    'Knowledge that changes or must be cited → retrieval (Phase 4), not fine-tuning.',
    'Behaviour, format, tone, task skill on a narrow distribution → fine-tuning can help.',
    'Supervised fine-tuning (SFT) learns from input–output pairs; preference tuning (e.g. DPO) from chosen vs rejected outputs; reinforcement fine-tuning from a grader’s scores.',
    'Distillation: generate high-quality outputs with a large model (checked by evals or humans), then fine-tune a small model on them.',
    'Data readiness: enough clean, representative, deduplicated examples; no leakage into the eval set; no PII you are not allowed to train on.',
    'Economics: tuning and hosting costs versus per-request savings; plus the maintenance cost of retraining when base models improve.'
  ],
  concept: { title: 'Training a specialist vs giving a generalist a handbook', body: `<p>A capable generalist with a good handbook (prompt and retrieval) handles most office work. For one repetitive, high-volume job with a fixed format (stamping and sorting thousands of forms a day), it can be worth training a specialist who does exactly that, faster and cheaper. But the specialist still needs the handbook for facts that change.</p>` },
  walk: [
    { h: 'A decision ladder', body: '<ol><li>Better prompt, clear instructions, structured outputs (Phase 3).</li><li>Few-shot examples, possibly selected per request by similarity.</li><li>Retrieval and tools for knowledge and live data.</li><li>Model routing: a larger model only where needed.</li><li>Fine-tune (SFT or preference) when evals show a stable gap that the above cannot close, or when cost and latency demand a smaller model.</li></ol>' },
    { h: 'Data formats', body: '<p>Most SFT services accept chat-formatted JSONL: one example per line with messages. Preference data adds chosen and rejected completions.</p>', lang: 'json', file: 'train.jsonl', code: String.raw`{"messages": [{"role": "system", "content": "Extract claim fields as JSON."}, {"role": "user", "content": "<claim text>"}, {"role": "assistant", "content": "{\"policy\": \"MX-4471\", \"loss_date\": \"2026-09-14\", ...}"}]}
{"prompt": [{"role": "user", "content": "Summarise for the adjuster"}], "chosen": "Short, cited summary ...", "rejected": "Long summary with speculation ..."}` },
    { h: 'Prove it with evals', body: '<p>Compare the tuned model with the best prompted baseline on the same held-out eval set, paired (7.2), by slice, including a general-capability check for regressions. Track cost and latency per request. Keep the prompted baseline as a fallback.</p>' }
  ],
  analogy: `<p><b>Tailoring vs buying off the rack.</b> Most people are well served by good off-the-rack clothes adjusted with a belt and the right size (prompts, examples). Tailoring is worth it when you wear the same suit every day and fit matters a lot, and it must be redone when your measurements change (new base models).</p>`,
  diagram: {
    title: 'Choosing an adaptation method',
    cols: [['need'], ['k', 'b', 'c'], ['rag', 'ft', 'small']],
    nodes: [
      { id: 'need', label: 'What is missing?', sub: 'from eval failures', tone: 'fde', info: 'Diagnose with error analysis (7.3).' },
      { id: 'k', label: 'Knowledge', sub: 'facts · fresh · citable', tone: 'acc', info: 'The model does not know or must cite.' },
      { id: 'b', label: 'Behaviour', sub: 'format · style · skill', tone: 'acc', info: 'Consistently wrong shape or approach.' },
      { id: 'c', label: 'Cost / latency', sub: 'high volume, narrow task', tone: 'acc', info: 'Large model too slow or expensive.' },
      { id: 'rag', label: 'Retrieval + tools', sub: 'Phase 4–5', tone: 'ok', info: 'Update the index, not the model.' },
      { id: 'ft', label: 'Prompting → SFT / DPO', sub: 'if evals show a gap', tone: 'warn', info: 'Examples first; tune with clean data.' },
      { id: 'small', label: 'Distil to a small model', sub: 'LoRA or managed FT', tone: 'be', info: 'Teacher outputs checked by evals.' }
    ],
    edges: [{ a: 'need', b: 'k' }, { a: 'need', b: 'b' }, { a: 'need', b: 'c' }, { a: 'k', b: 'rag' }, { a: 'b', b: 'ft' }, { a: 'c', b: 'small' }],
    caption: 'Diagnose the gap first; each gap has a different remedy.'
  },
  illustrated: { title: 'Typical outcomes', body: `<div class="tbl"><table><thead><tr><th>request</th><th>what worked</th></tr></thead><tbody>
    <tr><td>“Fine-tune on our product docs so it knows our product”</td><td>RAG with citations; docs change weekly</td></tr>
    <tr><td>“It keeps writing in the wrong format”</td><td>structured outputs and two examples</td></tr>
    <tr><td>“5 million classifications a day are too expensive”</td><td>distilled small model, 20× cheaper at equal accuracy</td></tr>
    <tr><td>“It does not understand our medical abbreviations”</td><td>glossary in prompt first; SFT when a gap remained on 2,000 labelled notes</td></tr></tbody></table></div>` },
  code: {
    title: 'Break-even analysis: prompted large model vs fine-tuned small model', file: 'breakeven.py', browser: true,
    intro: '<p>Compares the monthly cost of a prompted large model (long few-shot prompt) with a fine-tuned small model (short prompt), including one-off tuning and data costs, hosting or per-token premiums, and periodic retraining. Prints the break-even volume and a recommendation per volume. Prices are illustrative inputs, not current list prices.</p>',
    src: String.raw`import numpy as np

LARGE = {"in": 3.00, "out": 15.00}            # $ per million tokens (example)
SMALL_FT = {"in": 0.60, "out": 2.40}          # tuned small model, per-token premium included (example)
PROMPT_LARGE, PROMPT_SMALL, OUT = 2600, 350, 120   # tokens: few-shot prompt vs short prompt after tuning
ONE_OFF = {"labelling (4,000 examples reviewed)": 9000, "training runs and evals": 2500, "engineering (2 weeks)": 16000}
RETRAIN_PER_YEAR, RETRAIN_COST = 2, 6000      # base model updates, drift
HOSTING_PER_MONTH = 0                         # managed per-token; set for dedicated endpoints

def monthly(requests):
    large = requests * (PROMPT_LARGE * LARGE["in"] + OUT * LARGE["out"]) / 1e6
    small = requests * (PROMPT_SMALL * SMALL_FT["in"] + OUT * SMALL_FT["out"]) / 1e6 + HOSTING_PER_MONTH + RETRAIN_PER_YEAR * RETRAIN_COST / 12
    return large, small

one_off = sum(ONE_OFF.values())
print(f"one-off cost of fine-tuning: ${'$'}{one_off:,}  ({', '.join(ONE_OFF)})")
per_req_large = (PROMPT_LARGE * LARGE["in"] + OUT * LARGE["out"]) / 1e6
per_req_small = (PROMPT_SMALL * SMALL_FT["in"] + OUT * SMALL_FT["out"]) / 1e6
print(f"per request: large prompted ${'$'}{per_req_large * 1000:.2f}/1k, fine-tuned small ${'$'}{per_req_small * 1000:.2f}/1k")
for volume in (50_000, 300_000, 1_000_000, 5_000_000):
    large, small = monthly(volume)
    saving = large - small
    payback = one_off / saving if saving > 0 else float("inf")
    verdict = "stay prompted" if payback > 12 else ("fine-tune (if evals match)" if payback < 6 else "borderline")
    print(f"{volume:>9,} req/month: large ${'$'}{large:>9,.0f}  small ${'$'}{small:>8,.0f}  saving ${'$'}{saving:>9,.0f}  payback {payback:5.1f} months -> {verdict}")
breakeven = (RETRAIN_PER_YEAR * RETRAIN_COST / 12 + HOSTING_PER_MONTH) / (per_req_large - per_req_small)
print(f"monthly break-even (ignoring one-off): {breakeven:,.0f} requests; one-off adds the payback period above")`
  },
  lab: {
    title: 'Data readiness audit before fine-tuning', file: 'data_audit_lab.py', browser: true,
    scenario: `<p>A customer sends 3,000 “gold” examples to fine-tune a claims-extraction model and a separate 300-example eval set. Before spending money, audit: format validity, exact and near duplicates, label (field) coverage, output JSON validity, leakage between train and eval (near-duplicate inputs), PII such as emails and phone numbers, and length outliers. Produce a go/no-go with the counts and the cleaned dataset size.</p>`,
    steps: ['Validate each record: messages with system, user, assistant; assistant content parses as JSON with required keys.', 'Exact duplicates by hash; near duplicates by word 5-gram Jaccard ≥ 0.8 (use MinHash-lite or direct sets on this size).', 'Leakage: eval inputs with a near duplicate in train.', 'PII: regexes for emails and phone numbers in user content.', 'Report and decide: go if cleaned size ≥ 2,000, leakage < 1% of eval, and invalid < 5%.'],
    checks: ['Each problem category is counted.', 'Leaked eval items are listed for removal.', 'The decision follows the stated rule.'],
    hints: ['Near-duplicate checks on 3,000 × 300 pairs are fine with Python sets; at scale use MinHash and LSH.', 'Masking PII before training is often required by policy (8.5).'],
    starter: String.raw`import hashlib, json, random, re
random.seed(13)
FIELDS = ["policy", "loss_date", "amount", "vehicle"]
def claim_text(i):
    if i >= 5000:                                   # genuinely new eval claims, written by different adjusters
        return f"Claimant under contract PX-{i} says a {random.choice(['Skoda Octavia', 'Renault Clio', 'Volvo XC40'])} was hit in a car park last month; garage quote {300 + i % 4000} euros."
    return f"Policy MX-{4000 + i % 900} reported a loss on 2026-0{1 + i % 9}-1{i % 9} involving vehicle {random.choice(['VW Golf', 'Tesla Model 3', 'Fiat 500', 'BMW X1'])}. Estimated damage EUR {200 + (i * 37) % 5000}."
def record(i, text=None, bad_json=False, missing=False, pii=False):
    t = text or claim_text(i)
    if pii: t += " Contact me at jan.kowalski@example.com or +48 601 234 567."
    out = {"policy": f"MX-{4000 + i % 900}", "loss_date": "2026-01-01", "amount": 200 + (i * 37) % 5000, "vehicle": "?"}
    if missing: out.pop("vehicle")
    content = json.dumps(out)[:-3] if bad_json else json.dumps(out)
    return {"messages": [{"role": "system", "content": "Extract claim fields as JSON."}, {"role": "user", "content": t}, {"role": "assistant", "content": content}]}
train = [record(i, bad_json=random.random() < 0.02, missing=random.random() < 0.03, pii=random.random() < 0.04) for i in range(2700)]
train += [random.choice(train) for _ in range(300)]                        # duplicates
evals = [record(5000 + i) for i in range(280)] + [record(i) for i in random.sample(range(2700), 20)]   # 20 leaked
# TODO: audit and decide`,
    solution: String.raw`import hashlib, json, random, re
random.seed(13)
FIELDS = ["policy", "loss_date", "amount", "vehicle"]
def claim_text(i):
    if i >= 5000:                                   # genuinely new eval claims, written by different adjusters
        return f"Claimant under contract PX-{i} says a {random.choice(['Skoda Octavia', 'Renault Clio', 'Volvo XC40'])} was hit in a car park last month; garage quote {300 + i % 4000} euros."
    return f"Policy MX-{4000 + i % 900} reported a loss on 2026-0{1 + i % 9}-1{i % 9} involving vehicle {random.choice(['VW Golf', 'Tesla Model 3', 'Fiat 500', 'BMW X1'])}. Estimated damage EUR {200 + (i * 37) % 5000}."
def record(i, text=None, bad_json=False, missing=False, pii=False):
    t = text or claim_text(i)
    if pii: t += " Contact me at jan.kowalski@example.com or +48 601 234 567."
    out = {"policy": f"MX-{4000 + i % 900}", "loss_date": "2026-01-01", "amount": 200 + (i * 37) % 5000, "vehicle": "?"}
    if missing: out.pop("vehicle")
    content = json.dumps(out)[:-3] if bad_json else json.dumps(out)
    return {"messages": [{"role": "system", "content": "Extract claim fields as JSON."}, {"role": "user", "content": t}, {"role": "assistant", "content": content}]}
train = [record(i, bad_json=random.random() < 0.02, missing=random.random() < 0.03, pii=random.random() < 0.04) for i in range(2700)]
train += [random.choice(train) for _ in range(300)]
evals = [record(5000 + i) for i in range(280)] + [record(i) for i in random.sample(range(2700), 20)]

report = {"total": len(train)}
def valid(r):
    m = r.get("messages", [])
    if [x["role"] for x in m] != ["system", "user", "assistant"]: return "roles"
    try: out = json.loads(m[2]["content"])
    except json.JSONDecodeError: return "bad_json"
    return "missing_fields" if set(FIELDS) - set(out) else None
problems = [valid(r) for r in train]
for p in ("roles", "bad_json", "missing_fields"): report[p] = problems.count(p)

seen, uniq = set(), []
for r, p in zip(train, problems):
    h = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()
    if p is None and h not in seen: seen.add(h); uniq.append(r)
report["exact_duplicates"] = sum(1 for r in train) - len(seen) - sum(p is not None for p in problems)

grams = lambda t: {tuple(w) for w in zip(*[t.lower().split()[k:] for k in range(5)])}
def jacc(a, b): return len(a & b) / max(1, len(a | b))
user = lambda r: re.sub(r" Contact me at .*", "", r["messages"][1]["content"])
train_grams = [grams(user(r)) for r in uniq]
leaked = [i for i, e in enumerate(evals) if any(jacc(grams(user(e)), g) >= 0.8 for g in train_grams)]
report["eval_leakage"] = f"{len(leaked)}/{len(evals)}"
PII = re.compile(r"[\w.]+@[\w.]+\.\w+|\+?\d[\d ]{8,}\d")
report["pii_records"] = sum(bool(PII.search(r["messages"][1]["content"])) for r in uniq)
lens = sorted(len(r["messages"][1]["content"]) for r in uniq)
report["length_p50_p99"] = (lens[len(lens) // 2], lens[int(len(lens) * 0.99)])
report["clean_size"] = len(uniq)
for k, v in report.items(): print(f"  {k:<18} {v}")
invalid_rate = sum(p is not None for p in problems) / len(train)
go = len(uniq) >= 2000 and len(leaked) / len(evals) < 0.01 and invalid_rate < 0.05
print(f"\ninvalid {invalid_rate:.1%} | decision: {'GO' if go else 'NO-GO until fixed'}")
print("actions: drop invalid and duplicate records; remove", len(leaked), "leaked eval items (or re-split by policy id);",
      "mask PII in", report["pii_records"], "records; note that every 'vehicle' label is '?' (labels need review before training).")`
  },
  design: {
    lead: '<p>Fine-tuning is a product decision with lifecycle costs. Decide from error analysis and economics, invest in data quality, prove gains with paired evals, and plan for retraining and fallback.</p>',
    scale: [{ h: 'Many tuned variants', p: 'Per-customer or per-task adapters multiply quickly; serving many LoRA adapters on one base (13.2) and a registry with eval evidence per adapter keep it manageable.' }, { h: 'Data pipelines', p: 'Production corrections (reviewer edits, accepted suggestions) are the best training data; capture them with consent and provenance.' }],
    fail: [{ h: 'Training on the eval set', p: 'Leakage makes results meaningless. Split by entity (customer, policy, document) and check near duplicates.' }, { h: 'Stale tuned models', p: 'A tuned model on last year’s base may lose to a newer base model with a good prompt. Re-run the baseline comparison when bases change.' }],
    trade: [{ h: 'Quality vs flexibility', p: 'A tuned model is excellent on its distribution and brittle outside it; prompted models adapt to new instructions instantly.' }, { h: 'Managed vs self-hosted tuning', p: 'Managed services are simpler and limited to offered models; open-weight tuning gives control and requires MLOps and GPUs.' }],
    prompt: '<p>A customer wants to fine-tune a model on 10 years of support tickets “so it knows everything”. What do you recommend?</p>',
    answer: '<ul><li>Clarify the goal with error analysis: knowledge (use RAG over KB and solved tickets), tone and format (prompt and examples), or cost at volume (distillation).</li><li>Build the RAG copilot first (12.2); measure.</li><li>If a stable behavioural gap remains, fine-tune on curated recent tickets with verified resolutions, PII masked, split by customer, compared with the prompted baseline on a held-out set.</li><li>Plan retraining and keep the prompted path as a fallback.</li></ul>'
  },
  quiz: [
    { q: 'A model lacks knowledge of your weekly-changing price list. Best approach:', o: ['Fine-tune weekly', 'Retrieval or a pricing tool', 'Bigger model', 'Higher temperature'], a: 1, why: 'Fresh, citable knowledge belongs in retrieval or tools.' },
    { q: 'What is distillation?', o: ['Compressing files', 'Training a small model on high-quality outputs of a larger one', 'Removing stop words', 'Quantization only'], a: 1, why: 'Teacher-student transfer for a narrow task.' },
    { q: 'Why check near-duplicates between train and eval?', o: ['To save space', 'Leakage inflates eval results', 'For speed', 'Providers require it'], a: 1, why: 'The eval must measure generalisation.' }
  ],
  interview: [
    { q: 'When would you fine-tune instead of prompting?', a: '<p>When error analysis shows a consistent behavioural gap (format, style, task skill) that prompting, examples and retrieval cannot close, or when volume makes a large model too expensive or slow and a tuned small model can match it on evals. Not for fresh or citable knowledge, which belongs in retrieval.</p>' },
    { q: 'What do you check before fine-tuning?', a: '<p>That a strong prompted baseline and eval set exist; data size, quality and representativeness; duplicates and leakage; PII and licensing; label consistency; the economics including retraining; and a fallback plan.</p>' }
  ]
});

/* ===================================================================== 13.2 */
L({
  id: '13.2', title: 'LoRA vs a prompted baseline', minutes: 55, roles: ['be'],
  tags: 'LoRA mechanics · rank and alpha · trainable parameters · QLoRA · PEFT and TRL · adapter serving · paired evaluation against a prompted baseline',
  mental: 'LoRA freezes the base model and learns a small low-rank update (W + BA) for selected weight matrices. It reaches most of full fine-tuning’s gain with a tiny fraction of trainable parameters, keeps the base intact so many adapters can share it, and must still beat a strong prompted baseline on paired evals to be worth shipping.',
  intro: `<p>Full fine-tuning of a 7B-parameter model updates every weight and needs a lot of GPU memory. LoRA (low-rank adaptation) instead learns two thin matrices per adapted layer, often under 1% of parameters. QLoRA trains LoRA adapters on top of a 4-bit quantised base, making single-GPU tuning of mid-sized models practical. In Python, Hugging Face PEFT and TRL are the common libraries. This lesson implements LoRA from scratch in NumPy on a small network to show the mechanics, then shows the real library configuration.</p>`,
  points: [
    'LoRA update: <code class="i">W′ = W + (α/r)·B·A</code>, with A of shape r×d_in and B of shape d_out×r; only A and B train.',
    'Rank r (4–64) controls capacity; alpha scales the update; target modules are usually attention and MLP projections.',
    'B is initialised to zero so training starts exactly at the base model.',
    'Adapters are small files; merge into the base for serving, or serve many adapters on one base (vLLM and others support multi-LoRA).',
    'Compare against the best prompted baseline (strong prompt plus few-shot, maybe a larger model), paired, by slice, with cost and latency.',
    'Watch for overfitting on small datasets: hold out data, early stopping, and check general capability for regressions.'
  ],
  concept: { title: 'Sticky notes on a textbook', body: `<p>Rewriting a textbook for one course is expensive and ruins it for other courses. Adding a thin set of sticky notes that adjust key pages is cheap, can be removed, and each course can have its own set. LoRA adapters are those sticky notes on the model’s weight matrices.</p>` },
  walk: [
    { h: 'The real configuration', body: '<p>With PEFT and TRL on an open-weight model (shown, not run here: it needs a GPU and model downloads).</p>', code: String.raw`from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

peft_config = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                         target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
                         task_type="CAUSAL_LM")
trainer = SFTTrainer(model=base_model_id, train_dataset=train_ds, eval_dataset=eval_ds, peft_config=peft_config,
                     args=SFTConfig(output_dir="claims-lora", num_train_epochs=2, learning_rate=2e-4,
                                    per_device_train_batch_size=8, gradient_accumulation_steps=4, eval_strategy="steps"))
trainer.train()
trainer.save_model("claims-lora")          # adapter weights only: megabytes, not gigabytes` },
    { h: 'Why low rank works', body: '<p>Task adaptation tends to need a change in a few directions of a weight matrix, not an arbitrary change of all its entries. A rank-r update can express those directions with r·(d_in + d_out) numbers instead of d_in·d_out. The Code tab shows the parameter counts and the accuracy each method reaches.</p>' },
    { h: 'Serving adapters', body: '<p>Merge the adapter for a single dedicated model, or keep adapters separate and load several per base model (multi-LoRA serving), routing each request to its adapter. This makes per-customer or per-task specialisation affordable.</p>' }
  ],
  analogy: `<p><b>Camera lens filters.</b> Instead of building a new camera for each look, you screw a thin filter onto the same lens. Filters are cheap, swappable and leave the camera unchanged; a few well-chosen ones cover most needs.</p>`,
  diagram: {
    title: 'A LoRA-adapted layer',
    cols: [['x'], ['W', 'A'], ['B'], ['sum'], ['y']],
    nodes: [
      { id: 'x', label: 'Input x', sub: 'd_in', tone: 'fde', info: 'Activations entering the layer.' },
      { id: 'W', label: 'Frozen W', sub: 'd_out × d_in', tone: 'acc', info: 'Pretrained weights, never updated.' },
      { id: 'A', label: 'A (trainable)', sub: 'r × d_in', tone: 'warn', info: 'Down-projection to rank r.' },
      { id: 'B', label: 'B (trainable)', sub: 'd_out × r · init 0', tone: 'warn', info: 'Up-projection; zero init means no change at start.' },
      { id: 'sum', label: 'Wx + (α/r)·BAx', sub: 'add', tone: 'be', info: 'Can be merged into W after training.' },
      { id: 'y', label: 'Output y', sub: 'd_out', tone: 'ok', info: 'Same shape as before.' }
    ],
    edges: [{ a: 'x', b: 'W' }, { a: 'x', b: 'A' }, { a: 'A', b: 'B' }, { a: 'W', b: 'sum', bend: -40 }, { a: 'B', b: 'sum' }, { a: 'sum', b: 'y' }],
    caption: 'Only the thin A and B matrices train; W stays frozen.'
  },
  illustrated: { title: 'Parameter counts for one 4096 × 4096 projection', body: `<div class="tbl"><table><thead><tr><th>method</th><th>trainable numbers</th><th>share</th></tr></thead><tbody>
    <tr><td>full fine-tune</td><td class="n">16,777,216</td><td class="n">100%</td></tr>
    <tr><td>LoRA r = 8</td><td class="n">65,536</td><td class="n">0.39%</td></tr>
    <tr><td>LoRA r = 16</td><td class="n">131,072</td><td class="n">0.78%</td></tr>
    <tr><td>LoRA r = 64</td><td class="n">524,288</td><td class="n">3.1%</td></tr></tbody></table><p>r × (d_in + d_out) = 8 × 8192 = 65,536 for r = 8.</p></div>` },
  code: {
    title: 'LoRA from scratch in NumPy vs few-shot, head-only and full fine-tuning', file: 'lora_numpy.py', browser: true,
    intro: '<p>Pretrains a small two-layer network on a source task, then adapts it to a new task with only 200 labelled examples, four ways: a few-shot nearest-centroid on frozen features (the analogue of a prompted baseline), training only a new output head, LoRA on the hidden layer plus head, and full fine-tuning. Prints accuracy and trainable parameters, and checks that LoRA left the base weights untouched. A toy, so absolute numbers mean little; the relative pattern is the lesson.</p>',
    src: String.raw`import numpy as np
rng = np.random.default_rng(0)
V, H = 400, 64

def make_task(n_classes, n, word_sets, sig=0.6, length=20):
    X = np.zeros((n, V), np.float32); y = rng.integers(0, n_classes, n)
    k = max(1, int(length * sig))
    for i, c in enumerate(y):
        np.add.at(X[i], np.concatenate([rng.choice(word_sets[c], k), rng.integers(0, V, length - k)]), 1.0)
    return X / np.linalg.norm(X, axis=1, keepdims=True), y

src_sets = [np.arange(k * 40, k * 40 + 40) for k in range(8)]
tgt_sets = [np.concatenate([np.arange(((k + 1) % 8) * 40, ((k + 1) % 8) * 40 + 20), np.arange(((k + 3) % 8) * 40 + 20, ((k + 3) % 8) * 40 + 40),
                            np.arange(320 + k * 12, 326 + k * 12)]) for k in range(4)]          # recombined old words + new words
Xs, ys = make_task(8, 6000, src_sets); Xs_te, ys_te = make_task(8, 2000, src_sets)
Xt, yt = make_task(4, 200, tgt_sets, sig=0.35, length=10); Xt_te, yt_te = make_task(4, 2000, tgt_sets, sig=0.35, length=10)

def softmax(z):
    z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)
class Adam:
    def __init__(s, params, lr): s.p, s.lr, s.t = params, lr, 0; s.m = [np.zeros_like(p) for p in params]; s.v = [np.zeros_like(p) for p in params]
    def step(s, grads):
        s.t += 1
        for p, g, m, v in zip(s.p, grads, s.m, s.v):
            m *= 0.9; m += 0.1 * g; v *= 0.999; v += 0.001 * g * g
            p -= s.lr * (m / (1 - 0.9 ** s.t)) / (np.sqrt(v / (1 - 0.999 ** s.t)) + 1e-8)
acc = lambda z, y: float((z.argmax(1) == y).mean())

# --- pretrain the base model on the source task
W1 = rng.normal(0, 0.1, (V, H)).astype(np.float32); b1 = np.zeros(H, np.float32)
W2 = rng.normal(0, 0.1, (H, 8)).astype(np.float32); b2 = np.zeros(8, np.float32)
opt = Adam([W1, b1, W2, b2], 0.01)
for ep in range(30):
    for i in range(0, len(Xs), 128):
        X, y = Xs[i:i + 128], ys[i:i + 128]
        h = np.maximum(0, X @ W1 + b1); p = softmax(h @ W2 + b2); p[np.arange(len(y)), y] -= 1; p /= len(y)
        dh = p @ W2.T * (h > 0); opt.step([X.T @ dh, dh.sum(0), h.T @ p, p.sum(0)])
print(f"base model, source task accuracy: {acc(np.maximum(0, Xs_te @ W1 + b1) @ W2 + b2, ys_te):.3f}")
W1_original = W1.copy()

# --- (a) few-shot on frozen features: 5 examples per class, nearest centroid
idx = np.concatenate([np.where(yt == c)[0][:5] for c in range(4)])
feat = lambda X: np.maximum(0, X @ W1 + b1)
cent = np.stack([feat(Xt[idx])[yt[idx] == c].mean(0) for c in range(4)])
f = feat(Xt_te); sims = (f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9)) @ (cent / np.linalg.norm(cent, axis=1, keepdims=True)).T
print(f"{'few-shot (frozen, 20 examples)':<34} target acc {acc(sims, yt_te):.3f}   trainable params {0:>6}")

def adapt(mode, r=4, epochs=80, lr=0.01, alpha=4):
    g = np.random.default_rng(1)
    W, b = W1.copy(), b1.copy()
    Wh = g.normal(0, 0.1, (H, 4)).astype(np.float32); bh = np.zeros(4, np.float32)
    A = g.normal(0, 0.01, (V, r)).astype(np.float32); B = np.zeros((r, H), np.float32)     # B = 0: start at the base model
    params = {"head": [Wh, bh], "lora": [A, B, Wh, bh], "full": [W, b, Wh, bh]}[mode]
    opt, scale = Adam(params, lr), alpha / r
    for ep in range(epochs):
        perm = g.permutation(len(Xt))
        for i in range(0, len(Xt), 32):
            j = perm[i:i + 32]; X, y = Xt[j], yt[j]
            Weff = W + scale * (A @ B) if mode == "lora" else W
            pre = X @ Weff + b; h = np.maximum(0, pre)
            p = softmax(h @ Wh + bh); p[np.arange(len(y)), y] -= 1; p /= len(y)
            dh = p @ Wh.T * (pre > 0); gW = X.T @ dh
            grads = {"head": [h.T @ p, p.sum(0)], "lora": [scale * gW @ B.T, scale * A.T @ gW, h.T @ p, p.sum(0)],
                     "full": [gW, dh.sum(0), h.T @ p, p.sum(0)]}[mode]
            opt.step(grads)
    Weff = W + scale * (A @ B) if mode == "lora" else W
    return acc(np.maximum(0, Xt_te @ Weff + b) @ Wh + bh, yt_te), sum(p.size for p in params), W

for name, mode in (("new head only (linear probe)", "head"), ("LoRA r=4 + head", "lora"), ("full fine-tune", "full")):
    a, n, W_after = adapt(mode)
    print(f"{name:<34} target acc {a:.3f}   trainable params {n:>6}   base W changed: {not np.array_equal(W_after, W1_original)}")
print(f"\nLoRA trains {adapt('lora')[1] / adapt('full')[1]:.0%} of the parameters full fine-tuning trains, and the frozen base can serve other adapters.")`
  },
  lab: {
    title: 'Ship or not: LoRA small model vs prompted large model', file: 'ship_lab.py', browser: true,
    scenario: `<p>Your LoRA-tuned 8B model and the current prompted large model were both evaluated on the same 600 held-out claims (per-item correctness given), plus a 200-item general-instructions set to check regressions. The tuned model is 12× cheaper and 3× faster. Decide whether to ship it, for which slices, with a paired bootstrap on the difference, slice analysis and the regression check. Write the decision.</p>`,
    steps: ['Paired bootstrap (5,000 resamples) of accuracy difference on the 600 items; 95% interval.', 'Per slice (claim type) accuracy for both; flag slices where the tuned model is worse by > 3 points.', 'Regression set: compare accuracy on general instructions.', 'Monthly cost at 2 million requests for each, using the given per-request costs.', 'Decision: ship overall, ship with routing (tuned model for safe slices, large model for the rest), or do not ship.'],
    checks: ['The interval is computed on paired differences.', 'Slice regressions are identified.', 'The decision includes a routing plan if needed and the savings.'],
    hints: ['Routing by slice keeps most of the savings while protecting weak slices.', 'General-instruction regressions matter if the model will see off-distribution inputs.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(17)
slices = rng.choice(["motor", "home", "travel", "liability"], 600, p=[0.5, 0.25, 0.15, 0.10])
base_p = {"motor": 0.90, "home": 0.88, "travel": 0.86, "liability": 0.84}
lora_delta = {"motor": 0.04, "home": 0.03, "travel": 0.01, "liability": -0.09}
latent = rng.random(600)
large = latent < np.vectorize(base_p.get)(slices)
lora = latent < np.vectorize(base_p.get)(slices) + np.vectorize(lora_delta.get)(slices)
general_large = rng.random(200) < 0.93
general_lora = rng.random(200) < 0.85
COST = {"large": 0.0118, "lora": 0.00098}   # $ per request
# TODO`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(17)
slices = rng.choice(["motor", "home", "travel", "liability"], 600, p=[0.5, 0.25, 0.15, 0.10])
base_p = {"motor": 0.90, "home": 0.88, "travel": 0.86, "liability": 0.84}
lora_delta = {"motor": 0.04, "home": 0.03, "travel": 0.01, "liability": -0.09}
latent = rng.random(600)
large = latent < np.vectorize(base_p.get)(slices)
lora = latent < np.vectorize(base_p.get)(slices) + np.vectorize(lora_delta.get)(slices)
general_large = rng.random(200) < 0.93
general_lora = rng.random(200) < 0.85
COST = {"large": 0.0118, "lora": 0.00098}

diff = lora.astype(float) - large.astype(float)
boots = [diff[rng.integers(0, 600, 600)].mean() for _ in range(5000)]
lo, hi = np.percentile(boots, [2.5, 97.5])
print(f"overall: large {large.mean():.3f}, LoRA {lora.mean():.3f}, difference {diff.mean():+.3f} (95% CI {lo:+.3f} to {hi:+.3f})")
weak = []
for s in ["motor", "home", "travel", "liability"]:
    m = slices == s
    d = lora[m].mean() - large[m].mean()
    flag = d < -0.03
    if flag: weak.append(s)
    print(f"  {s:<10} n={m.sum():>3}  large {large[m].mean():.3f}  LoRA {lora[m].mean():.3f}  {d:+.3f} {'<- worse' if flag else ''}")
print(f"general instructions: large {general_large.mean():.3f}, LoRA {general_lora.mean():.3f} (regression {general_lora.mean() - general_large.mean():+.3f})")
N = 2_000_000
share_weak = np.isin(slices, weak).mean()
cost_large, cost_lora = N * COST["large"], N * COST["lora"]
cost_routed = N * (share_weak * COST["large"] + (1 - share_weak) * COST["lora"])
routed_acc = np.where(np.isin(slices, weak), large, lora).mean()
print(f"monthly cost: large ${'$'}{cost_large:,.0f} | LoRA ${'$'}{cost_lora:,.0f} | routed ${'$'}{cost_routed:,.0f} (routed accuracy {routed_acc:.3f})")
print(f"""
DECISION: ship with routing. The tuned model is at least as accurate overall and much cheaper, but worse on {', '.join(weak)}
claims and on general instructions. Route {', '.join(weak)} and any input the claim classifier cannot place to the large model;
send the rest to the LoRA model. Saves ${'$'}{cost_large - cost_routed:,.0f}/month at equal or better accuracy. Collect more {', '.join(weak)}
examples for the next adapter version and re-run this comparison when either model changes.""")`
  },
  design: {
    lead: '<p>LoRA makes specialisation cheap; the hard parts remain data, evaluation and operations. Treat adapters as versioned artefacts with eval evidence, serve them efficiently, and route traffic so each request goes to the model that is best for it.</p>',
    scale: [{ h: 'Multi-LoRA serving', p: 'One base model in GPU memory with many adapters loaded on demand; batch requests across adapters; keep hot adapters resident.' }, { h: 'Training pipeline', p: 'Data versioning, reproducible configs, eval gates and a registry (10.2–10.3) for adapters just like prompts.' }],
    fail: [{ h: 'Overfitting small data', p: 'High rank and many epochs memorise 200 examples; use held-out data, early stopping and lower rank.' }, { h: 'Off-distribution inputs', p: 'Tuned models can regress on general instructions; route unusual inputs to a general model.' }],
    trade: [{ h: 'Rank and targets', p: 'Higher rank and more target modules add capacity and cost; start small (r = 8–16 on attention and MLP projections) and increase only with eval evidence.' }, { h: 'LoRA vs full fine-tune', p: 'Full fine-tuning can reach slightly higher quality with much higher cost and no adapter sharing; LoRA is the default for most teams.' }],
    prompt: '<p>Serve 50 customer-specific adapters of the same 8B base model with low latency.</p>',
    answer: '<ul><li>One base model per GPU replica with multi-LoRA serving; adapters cached in GPU memory by popularity, others loaded from fast storage.</li><li>Router maps tenant to adapter id; batching across adapters.</li><li>Adapter registry with versions, eval results and rollback; canary per adapter.</li><li>Fallback to the base model plus prompt if an adapter fails to load.</li></ul>'
  },
  quiz: [
    { q: 'Why is B initialised to zero in LoRA?', o: ['To save memory', 'So training starts exactly from the base model’s behaviour', 'For speed', 'It is required by GPUs'], a: 1, why: 'BA = 0 at the start.' },
    { q: 'Trainable numbers for LoRA r = 8 on a 4096 × 4096 matrix:', o: ['16.7M', '65,536', '4096', '8'], a: 1, why: 'r × (d_in + d_out) = 8 × 8192.' },
    { q: 'A tuned model is better overall but worse on one slice. A good plan:', o: ['Ship to everything', 'Route that slice to the stronger model and ship the rest', 'Discard the tuned model', 'Ignore slices'], a: 1, why: 'Routing keeps savings and protects quality.' }
  ],
  interview: [
    { q: 'Explain LoRA and why it is popular.', a: '<p>LoRA freezes the pretrained weights and learns a low-rank update BA for selected matrices, scaled by alpha over r. It trains well under 1% of parameters, needs far less memory (especially with QLoRA on a quantised base), produces small adapter files, and lets many adapters share one base model in serving, while reaching most of full fine-tuning’s quality on narrow tasks.</p>' },
    { q: 'How do you decide whether a fine-tuned model replaces a prompted one?', a: '<p>Paired evaluation on the same held-out set with confidence intervals, slice analysis, regression checks on general inputs, and cost and latency comparison. Ship where it wins or ties, route the rest to the prompted model, and re-run the comparison when either model changes.</p>' }
  ]
});

/* ===================================================================== 13.3 */
L({
  id: '13.3', title: 'Vision and audio pipelines', minutes: 55, roles: ['be', 'fde'],
  tags: 'image inputs · visual token cost · resizing · PDFs · document understanding · speech-to-text · VAD and chunking · diarisation · real-time voice · TTS',
  mental: 'Multimodal systems are pipelines: images and documents are resized and encoded into the model’s input with a predictable token cost; audio is usually segmented by voice activity, transcribed, and then processed as text, unless the model accepts audio directly or a real-time voice API is used. Each stage has its own latency, cost and error rate to measure.',
  intro: `<p>Many enterprise inputs are not text: scanned forms, photos of damage, screenshots, charts, call recordings, voice notes. Frontier models accept images and PDFs directly (Claude’s API takes text, images and PDF documents). Audio is often handled by a speech-to-text stage first (Whisper-family models, cloud speech services), though some providers offer native audio input and real-time voice APIs. This lesson covers the engineering: input preparation, cost estimation, chunking, and evaluation per stage.</p>
  <p>Image token costs and size limits differ by model and change over time. The numbers below follow Anthropic’s vision documentation as of late 2026; check it before relying on them.</p>`,
  points: [
    'Images: send as base64 or URL; supported types include JPEG, PNG, GIF (first frame) and WebP.',
    'Cost: Claude counts an image as roughly ⌈width/28⌉ × ⌈height/28⌉ visual tokens after resizing; standard models resize so the long edge is at most 1,568 px (about 1,568 visual tokens max), newer high-resolution models up to 2,576 px (about 4,784).',
    'Pre-resize images yourself to control cost and latency; crop to the relevant region; keep text legible.',
    'PDFs: send as document blocks for text plus page images, or extract text yourself for long documents and send only relevant pages.',
    'Audio: voice activity detection (VAD) → chunks of up to ~30 s with small overlaps → speech-to-text → optional diarisation → text pipeline. Measure word error rate (WER) on your audio.',
    'Real-time voice: streaming STT and TTS or speech-to-speech APIs; budget latency per stage to keep turn-taking natural (under about a second).'
  ],
  concept: { title: 'A translator at a conference', body: `<p>A conference interpreter listens in chunks between pauses, translates each chunk, and keeps a running sense of who is speaking. Visual aids on the screen are read at the size they are projected: a slide shrunk too much becomes unreadable, an unnecessarily huge one wastes time. Multimodal pipelines make the same decisions: where to cut audio, how big to make images.</p>` },
  walk: [
    { h: 'An image request', body: '<p>Content blocks mix images and text. Put the image before the question. The Code tab sends this through a mock transport and validates a structured answer.</p>', code: String.raw`msg = client.messages.create(
    model="claude-sonnet-5-5", max_tokens=600,
    messages=[{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64_png}},
        {"type": "text", "text": "Extract merchant, date, total and currency as JSON. Use null if unreadable."}]}])` },
    { h: 'Estimate tokens before sending', body: '<p>Resize to the model’s effective resolution, then estimate tokens as ⌈w/28⌉·⌈h/28⌉. A 1000 × 1000 image is about 1,296 visual tokens; a 4K screenshot is downscaled to roughly 1,560 (standard) or 4,784 (high-resolution). Cropping to the relevant region is often the biggest saving.</p>' },
    { h: 'Audio pipeline', body: '<p>Shown, not run (it needs model weights): faster-whisper transcribes chunks on CPU or GPU; VAD avoids sending silence; timestamps let you align text with speakers.</p>', code: String.raw`from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, info = model.transcribe("call.wav", vad_filter=True, beam_size=5, language="en")
for s in segments:
    print(f"[{s.start:6.1f}-{s.end:6.1f}] {s.text}")` }
  ],
  analogy: `<p><b>Sending photos to a repair shop.</b> A blurry thumbnail is useless and a 50-megapixel raw file wastes everyone’s time; a clear, cropped photo of the damage gets a quote fastest. Voice messages are best when they are short, clear and to the point.</p>`,
  diagram: {
    title: 'Vision and audio into one text pipeline',
    cols: [['img', 'pdf', 'aud'], ['prep', 'vad'], ['stt'], ['llm'], ['out']],
    nodes: [
      { id: 'img', label: 'Images', sub: 'photos · scans · screenshots', tone: 'fde', info: 'JPEG, PNG, GIF, WebP.' },
      { id: 'pdf', label: 'PDFs', sub: 'reports · contracts', tone: 'fde', info: 'Document blocks or extracted pages.' },
      { id: 'aud', label: 'Audio', sub: 'calls · voice notes', tone: 'fde', info: 'WAV, MP3, streams.' },
      { id: 'prep', label: 'Prepare', sub: 'resize · crop · page select', tone: 'acc', info: 'Control tokens, latency, legibility.' },
      { id: 'vad', label: 'VAD + chunk', sub: '≤30 s · overlap', tone: 'acc', info: 'Skip silence; cut at pauses.' },
      { id: 'stt', label: 'Speech-to-text', sub: 'timestamps · diarisation', tone: 'warn', info: 'Whisper-family or cloud STT; measure WER.' },
      { id: 'llm', label: 'Multimodal model', sub: 'images + text', tone: 'be', info: 'Structured outputs (3.3).' },
      { id: 'out', label: 'Structured result', sub: 'validated', tone: 'ok', info: 'Same validation as text inputs (12.5).' }
    ],
    edges: [{ a: 'img', b: 'prep' }, { a: 'pdf', b: 'prep' }, { a: 'aud', b: 'vad' }, { a: 'vad', b: 'stt' }, { a: 'prep', b: 'llm' }, { a: 'stt', b: 'llm' }, { a: 'llm', b: 'out' }],
    caption: 'Prepare each modality, then reuse the same structured, validated pipeline.'
  },
  illustrated: { title: 'Budget for a voice assistant turn', body: `<div class="tbl"><table><thead><tr><th>stage</th><th>target</th></tr></thead><tbody>
    <tr><td>end-of-speech detection</td><td class="n">200–300 ms</td></tr>
    <tr><td>streaming STT final</td><td class="n">100–200 ms</td></tr>
    <tr><td>LLM time to first token</td><td class="n">300–500 ms</td></tr>
    <tr><td>TTS time to first audio</td><td class="n">100–200 ms</td></tr>
    <tr><td><b>total to first audio</b></td><td class="n"><b>~0.7–1.2 s</b></td></tr></tbody></table><p>Speech-to-speech models can cut stages; tool calls and retrieval add to the LLM stage. Stream every stage.</p></div>` },
  code: {
    title: 'Image preparation, visual-token estimates and a structured receipt extraction', file: 'vision.py', deps: 'uv add anthropic pillow pydantic',
    intro: '<p>Draws a synthetic receipt with Pillow, estimates visual tokens for several sizes under the standard and high-resolution rules (checked against the documented examples), resizes to the effective resolution, and sends an image + text request through the Anthropic SDK with a mock transport that returns JSON, which is validated with Pydantic. The mock stands in for the model; the request payload is exactly what the API receives.</p>',
    src: String.raw`import base64, io, json, math
import anthropic
from PIL import Image, ImageDraw
from pydantic import BaseModel
try:
    import httpx2 as httpx
except ImportError:
    import httpx

TIERS = {"standard": (1568, 1568), "high-res": (2576, 4784)}      # (max long edge px, max visual tokens)
def effective_size(w, h, tier):
    edge, cap = TIERS[tier]
    s = min(1.0, edge / max(w, h), math.sqrt(cap * 784 / (w * h)))
    while math.ceil(w * s / 28) * math.ceil(h * s / 28) > cap: s *= 0.995
    return max(1, round(w * s)), max(1, round(h * s))
tokens = lambda w, h: math.ceil(w / 28) * math.ceil(h / 28)

for w, h in [(200, 200), (1000, 1000), (1920, 1080), (3840, 2160)]:
    row = [f"{w}x{h}"]
    for tier in TIERS:
        ew, eh = effective_size(w, h, tier); row.append(f"{tier}: {ew}x{eh} -> {tokens(ew, eh):,} tokens")
    print(" | ".join(row))

img = Image.new("RGB", (1240, 1754), "white")                    # A4 at 150 dpi
d = ImageDraw.Draw(img)
for y, line in enumerate(["CAFE LUMEN", "Via Roma 12, Milano", "2026-10-21  12:41", "", "2 x Cappuccino      7.00", "1 x Cornetto        1.80", "", "TOTALE EUR          8.80"]):
    d.text((120, 160 + y * 60), line, fill="black")
crop = img.crop((80, 120, 900, 700))                              # only the printed area
ew, eh = effective_size(*crop.size, "standard")
small = crop.resize((ew, eh))
buf = io.BytesIO(); small.save(buf, "PNG"); b64 = base64.b64encode(buf.getvalue()).decode()
print(f"full page {img.size} ~{tokens(*effective_size(*img.size, 'standard')):,} tokens; cropped {small.size} ~{tokens(ew, eh):,} tokens; payload {len(b64) / 1024:.0f} KB")

class Receipt(BaseModel):
    merchant: str | None; date: str | None; total: float | None; currency: str | None

sent = {}
def handler(request):
    sent["body"] = json.loads(request.content)
    answer = {"merchant": "Cafe Lumen", "date": "2026-10-21", "total": 8.80, "currency": "EUR"}
    return httpx.Response(200, json={"id": "msg_1", "type": "message", "role": "assistant", "model": "m", "stop_reason": "end_turn", "stop_sequence": None,
                                     "content": [{"type": "text", "text": json.dumps(answer)}], "usage": {"input_tokens": 1260, "output_tokens": 30}})
client = anthropic.Anthropic(api_key="sk-ant-demo", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
msg = client.messages.create(model="claude-sonnet-5-5", max_tokens=300, messages=[{"role": "user", "content": [
    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
    {"type": "text", "text": "Extract merchant, date (ISO), total and currency as JSON with keys merchant, date, total, currency. Use null if unreadable."}]}])
blocks = sent["body"]["messages"][0]["content"]
print("request content blocks:", [b["type"] for b in blocks], "| image media type:", blocks[0]["source"]["media_type"])
print("validated:", Receipt.model_validate_json(msg.content[0].text))`
  },
  lab: {
    title: 'Voice activity detection and chunking for transcription', file: 'vad_lab.py', browser: true,
    scenario: `<p>A contact centre sends 2-minute call recordings to transcription. Sending whole files wastes money on silence and hits the 30-second window of many speech models. Using a synthetic 16 kHz signal with speech bursts and background noise, implement an energy-based VAD with smoothing and hangover, merge speech regions into chunks of at most 30 s cut at pauses, add 0.3 s padding, and report speech ratio, chunk count and the transcription cost saved versus sending the whole recording.</p>`,
    steps: ['Generate 120 s of audio: noise floor plus speech-like bursts (modulated tones) with pauses of varied lengths.', 'Frame at 30 ms; compute log energy; threshold at noise floor + margin, estimated from the quietest 20% of frames.', 'Smooth with a hangover of 300 ms so short dips inside words do not split speech.', 'Merge regions separated by less than 0.5 s; split regions longer than 30 s at the lowest-energy point.', 'Report regions, chunks, speech ratio and cost at a per-minute STT price.'],
    checks: ['Detected speech overlaps the true bursts (report precision and recall by frame).', 'No chunk exceeds 30 s.', 'Cost saving is computed from audio minutes actually sent.'],
    hints: ['Real systems use neural VADs (for example Silero VAD) that are far more robust to noise; the pipeline logic is the same.', 'Keep chunk boundaries and timestamps so transcripts can be stitched back in order.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(2)
SR, DUR = 16_000, 120
t = np.arange(SR * DUR) / SR
truth = np.zeros_like(t, dtype=bool)
x = rng.normal(0, 0.01, t.size)
pos = 1.0
while pos < DUR - 3:
    length = rng.uniform(1.5, 8.0)
    seg = (t >= pos) & (t < pos + length)
    truth |= seg
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t[seg]) ** 2          # syllable-rate modulation
    x[seg] += 0.2 * envelope * np.sin(2 * np.pi * rng.uniform(140, 260) * t[seg])
    pos += length + rng.choice([0.3, 0.8, 2.0, 5.0, 9.0])     # the other party talking, hold music, typing
PRICE_PER_MIN = 0.006
# TODO: vad(x) -> regions; chunk(regions); report`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(2)
SR, DUR = 16_000, 120
t = np.arange(SR * DUR) / SR
truth = np.zeros_like(t, dtype=bool)
x = rng.normal(0, 0.01, t.size)
pos = 1.0
while pos < DUR - 3:
    length = rng.uniform(1.5, 8.0)
    seg = (t >= pos) & (t < pos + length)
    truth |= seg
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t[seg]) ** 2
    x[seg] += 0.2 * envelope * np.sin(2 * np.pi * rng.uniform(140, 260) * t[seg])
    pos += length + rng.choice([0.3, 0.8, 2.0, 5.0, 9.0])     # the other party talking, hold music, typing
PRICE_PER_MIN = 0.006

FRAME = int(0.03 * SR)
frames = x[: x.size // FRAME * FRAME].reshape(-1, FRAME)
energy = 10 * np.log10((frames ** 2).mean(axis=1) + 1e-12)
floor = np.percentile(energy, 20)
raw = energy > floor + 9                                         # 9 dB above the noise floor
hang = int(0.3 / 0.03)
speech = raw.copy()
last = -10 ** 9
for i, v in enumerate(raw):                                        # hangover: keep speech on for 300 ms after energy drops
    if v: last = i
    speech[i] = v or (i - last) <= hang
fs = 0.03
regions, start = [], None
for i, v in enumerate(np.append(speech, False)):
    if v and start is None: start = i
    if not v and start is not None: regions.append([start * fs, i * fs]); start = None
merged = []
for r in regions:                                                  # merge gaps < 0.5 s
    if merged and r[0] - merged[-1][1] < 0.5: merged[-1][1] = r[1]
    else: merged.append(r)
chunks = []
for s, e in merged:                                                # split at lowest energy if > 30 s
    while e - s > 30:
        lo, hi = int((s + 10) / fs), int((s + 30) / fs)
        cut = (lo + int(np.argmin(energy[lo:hi]))) * fs
        chunks.append((s, cut)); s = cut
    chunks.append((s, e))
padded = [(max(0, s - 0.3), min(DUR, e + 0.3)) for s, e in chunks]

truth_frames = truth[: truth.size // FRAME * FRAME].reshape(-1, FRAME).mean(axis=1) > 0.5
tp = (speech & truth_frames).sum()
print(f"VAD frame precision {tp / speech.sum():.1%}, recall {tp / truth_frames.sum():.1%}")
sent = sum(e - s for s, e in padded)
print(f"{len(merged)} speech regions -> {len(padded)} chunks; longest {max(e - s for s, e in padded):.1f}s; speech ratio {sent / DUR:.0%}")
print(f"transcription cost per call: whole file ${'$'}{DUR / 60 * PRICE_PER_MIN:.4f} vs chunks ${'$'}{sent / 60 * PRICE_PER_MIN:.4f} "
      f"({1 - sent / DUR:.0%} saved); at 50,000 calls/month: ${'$'}{(DUR - sent) / 60 * PRICE_PER_MIN * 50_000:,.0f} saved")
for s, e in padded[:5]: print(f"  chunk {s:6.2f}s - {e:6.2f}s")`
  },
  design: {
    lead: '<p>Multimodal features succeed when each modality is prepared deliberately: images at the right size and crop, documents reduced to relevant pages, audio segmented and transcribed with measured accuracy, and every stage budgeted for cost and latency.</p>',
    scale: [{ h: 'High volumes of images', p: 'Resize and crop client-side or in a preprocessing service; batch APIs for offline work; cache results by image hash.' }, { h: 'Call-centre scale audio', p: 'Queue-based transcription with autoscaled GPU or managed STT; VAD to skip silence; store transcripts with timestamps and speakers for search and QA.' }],
    fail: [{ h: 'Illegible inputs', p: 'Over-compressed or downscaled images cause confident wrong reads. Validate outputs (12.5) and send low-confidence cases to review.' }, { h: 'Domain words in ASR', p: 'Product names and account numbers are often misheard. Provide vocabulary hints where supported, measure WER on your audio, and confirm critical values back to the caller.' }],
    trade: [{ h: 'Native audio vs STT pipeline', p: 'Native audio or speech-to-speech models reduce latency and keep prosody; STT pipelines are cheaper, debuggable and model-agnostic.' }, { h: 'Resolution vs cost', p: 'Higher resolution helps small text and charts and costs more tokens and latency; crop before upscaling the budget.' }],
    prompt: '<p>Design a pipeline that processes 20,000 photos of damaged cars and 5,000 claim calls a day for an insurer.</p>',
    answer: '<ul><li>Photos: resize and crop with a fast detector, extract damage descriptions and parts with a multimodal model to a schema, validate against the repair estimate, route uncertain cases to adjusters.</li><li>Calls: VAD and chunking, STT with timestamps and diarisation, then summarisation and field extraction with citations to timestamps.</li><li>Batch APIs for non-urgent work; caching by hash; per-stage metrics (WER, field accuracy, cost, latency).</li><li>PII handling for voice and images; retention rules; human review for payouts.</li></ul>'
  },
  quiz: [
    { q: 'Roughly how many visual tokens does a 1000 × 1000 image cost under the 28-pixel patch rule?', o: ['100', '1,296', '10,000', '1 million'], a: 1, why: '⌈36⌉ × ⌈36⌉ = 1,296.' },
    { q: 'Why run VAD before speech-to-text?', o: ['To add noise', 'Skip silence and cut audio at natural pauses within model limits', 'To translate', 'To encrypt'], a: 1, why: 'Cost, latency and chunk quality.' },
    { q: 'The cheapest way to cut image cost without losing the relevant detail:', o: ['Send the original', 'Crop to the relevant region and resize to the model’s effective resolution', 'Convert to GIF', 'Send twice'], a: 1, why: 'Fewer pixels, same information.' }
  ],
  interview: [
    { q: 'How would you build a receipt or form extraction feature from photos?', a: '<p>Client-side capture guidance, then crop and resize to the model’s effective resolution, estimate tokens, send image plus instructions with structured outputs, validate with deterministic checks (dates, totals, currency), route low-confidence cases to review, cache by image hash, and measure field accuracy on a labelled set.</p>' },
    { q: 'Design a real-time voice assistant. Where does latency go?', a: '<p>End-of-speech detection, streaming STT, LLM time to first token (plus any tools), and TTS time to first audio. Stream every stage, keep prompts cached, use fast models for turn-taking, handle barge-in, and measure time to first audio per turn; consider speech-to-speech models where available.</p>' }
  ]
});
})();
