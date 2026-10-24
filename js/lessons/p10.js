/* Phase 10 · LLMOps and delivery */
(function () {
const L = AISA.lesson;

/* ===================================================================== 10.1 */
L({
  id: '10.1', title: 'Config as code', minutes: 45, roles: ['be', 'fde'],
  tags: 'typed settings · layered config · environment overrides · tenant overrides · feature flags · secrets by reference · config hashes',
  mental: 'Everything that changes an AI system’s behaviour without a code change (model routes, prompt versions, thresholds, limits, feature flags, tenant policies) belongs in typed, validated, versioned configuration. Every request logs the config version it ran with, so any behaviour can be traced back to an exact setting.',
  intro: `<p>AI systems are unusually configuration-heavy: which model per task, which prompt version, retrieval top-k, judge thresholds, guardrail strictness, per-tenant policies. When these live in scattered environment variables and constants, nobody can say what changed when quality dropped last Tuesday. Config as code fixes that with the same discipline as application code: schemas, review, versioning and audit.</p>`,
  points: [
    'Define a typed schema (Pydantic) for all settings; validate at startup and fail fast on bad config.',
    'Layer sources: defaults in code → a checked-in file per environment (TOML or YAML) → environment variables → per-tenant overrides.',
    'Secrets are references (names in a secrets manager), never values in files or repositories.',
    'Feature flags with deterministic percentage rollouts and kill switches let you change behaviour safely in production.',
    'Compute a hash of the effective config and log it with every request and eval run.',
    'Changes go through pull requests with eval evidence for behaviour-changing settings (10.4).'
  ],
  concept: { title: 'One source of truth for behaviour', body: `<p>If two engineers can make the assistant behave differently by editing two different places, you have no control. Config as code makes one place authoritative, validated by a schema, reviewed like code, and stamped on every request. When something changes, the diff of the config is the first thing you read.</p>` },
  walk: [
    { h: 'A typed schema', body: '<p>Validation catches impossible settings before they reach production.</p>', code: String.raw`class RouteConfig(BaseModel):
    model: str
    max_tokens: int = Field(gt=0, le=8192)
    temperature: float = Field(0.0, ge=0, le=1)
    prompt: str = Field(pattern=r"^[a-z_]+@v\d+$")       # e.g. triage@v3

class Settings(BaseModel):
    environment: Literal["dev", "staging", "prod"]
    routes: dict[str, RouteConfig]
    retrieval_top_k: int = Field(8, ge=1, le=50)
    anthropic_api_key_ref: str                           # secret manager path, not the key` },
    { h: 'Layer and override', body: '<p>Base file, environment file, then environment variables, then tenant overrides restricted to an allow-list of keys (tenants can raise retrieval depth, not change the safety policy).</p>' },
    { h: 'Roll out with flags', body: '<p>Deterministic bucketing: hash(flag name + tenant or user id) modulo 100 below the rollout percentage. The same user always gets the same variant, and a kill switch turns it off everywhere instantly.</p>' }
  ],
  analogy: `<p><b>A recipe book with amendments.</b> The master recipe is printed; each restaurant branch has a dated amendment sheet; a few regulars have noted preferences. The kitchen always knows which version of every dish it served, and a bad amendment can be withdrawn in one place.</p>`,
  diagram: {
    title: 'Layered, validated configuration',
    cols: [['def', 'file', 'env', 'tenant'], ['merge'], ['schema'], ['hash'], ['svc']],
    nodes: [
      { id: 'def', label: 'Defaults', sub: 'in code', info: 'Safe defaults for every setting.' },
      { id: 'file', label: 'Env file', sub: 'prod.toml · reviewed', tone: 'acc', info: 'Checked-in per-environment settings.' },
      { id: 'env', label: 'Env variables', sub: 'deploy-time', info: 'Overrides set by the deployment.' },
      { id: 'tenant', label: 'Tenant overrides', sub: 'allow-listed keys', tone: 'fde', info: 'Only permitted keys per tenant.' },
      { id: 'merge', label: 'Merge', sub: 'later wins', info: 'Deterministic precedence.' },
      { id: 'schema', label: 'Validate', sub: 'Pydantic schema', tone: 'be', info: 'Fail fast with clear errors.' },
      { id: 'hash', label: 'Config hash', sub: 'logged per request', tone: 'warn', info: 'Ties behaviour to an exact configuration.' },
      { id: 'svc', label: 'Services', sub: 'read-only config', tone: 'ok', info: 'Use validated settings; secrets fetched by reference.' }
    ],
    edges: [{ a: 'def', b: 'merge' }, { a: 'file', b: 'merge' }, { a: 'env', b: 'merge' }, { a: 'tenant', b: 'merge' }, { a: 'merge', b: 'schema' }, { a: 'schema', b: 'hash' }, { a: 'hash', b: 'svc' }],
    caption: 'Layers merged, validated, hashed, then served read-only.'
  },
  illustrated: { title: 'What belongs where', body: `<div class="tbl"><table><thead><tr><th>setting</th><th>place</th></tr></thead><tbody>
    <tr><td>model per route, prompt version, top-k</td><td>environment config file (reviewed)</td></tr>
    <tr><td>API keys, database passwords</td><td>secrets manager; config holds the reference</td></tr>
    <tr><td>new reranker for 10% of users</td><td>feature flag with deterministic bucketing</td></tr>
    <tr><td>tenant’s retrieval depth or language</td><td>tenant override (allow-listed key)</td></tr>
    <tr><td>guardrail policy</td><td>environment config; tenants may only make it stricter</td></tr></tbody></table></div>` },
  code: {
    title: 'Layered, validated config with tenant overrides and a config hash', file: 'settings.py', browser: true,
    intro: '<p>A Pydantic schema, a TOML base file and a production overlay, environment-variable overrides, allow-listed tenant overrides, validation errors for a bad change, and a stable hash of the effective config to log with requests.</p>',
    src: String.raw`import hashlib, json, tomllib
from typing import Literal
from pydantic import BaseModel, Field, ValidationError

class RouteConfig(BaseModel):
    model: str
    max_tokens: int = Field(gt=0, le=8192)
    temperature: float = Field(0.0, ge=0, le=1)
    prompt: str = Field(pattern=r"^[a-z_]+@v\d+$")

class Settings(BaseModel):
    environment: Literal["dev", "staging", "prod"]
    routes: dict[str, RouteConfig]
    retrieval_top_k: int = Field(8, ge=1, le=50)
    guardrail_level: Literal["standard", "strict"] = "standard"
    anthropic_api_key_ref: str = Field(pattern=r"^(sm|vault)://")

BASE = b"""
environment = "dev"
retrieval_top_k = 8
anthropic_api_key_ref = "sm://ai/anthropic-key"
[routes.triage]
model = "claude-haiku-5-5"
max_tokens = 300
prompt = "triage@v3"
[routes.draft]
model = "claude-sonnet-5-5"
max_tokens = 1200
temperature = 0.3
prompt = "draft@v7"
"""
PROD = b"""
environment = "prod"
guardrail_level = "strict"
[routes.draft]
prompt = "draft@v8"
"""
TENANT_ALLOWED = {"retrieval_top_k", "guardrail_level"}

def deep_merge(a, b):
    out = dict(a)
    for k, v in b.items():
        out[k] = deep_merge(a[k], v) if isinstance(v, dict) and isinstance(a.get(k), dict) else v
    return out

def from_env(env: dict) -> dict:                  # APP__ROUTES__TRIAGE__MAX_TOKENS=400 -> nested keys
    out = {}
    for k, v in env.items():
        if k.startswith("APP__"):
            node, parts = out, k[5:].lower().split("__")
            for p in parts[:-1]: node = node.setdefault(p, {})
            node[parts[-1]] = int(v) if v.isdigit() else v
    return out

def load(env: dict, tenant_overrides: dict | None = None) -> tuple[Settings, str]:
    cfg = deep_merge(deep_merge(tomllib.loads(BASE.decode()), tomllib.loads(PROD.decode())), from_env(env))
    for k, v in (tenant_overrides or {}).items():
        if k not in TENANT_ALLOWED:
            raise PermissionError(f"tenant may not override {k}")
        if k == "guardrail_level" and v != "strict":
            raise PermissionError("tenants may only make guardrails stricter")
        cfg[k] = v
    s = Settings.model_validate(cfg)
    digest = hashlib.sha256(json.dumps(s.model_dump(), sort_keys=True).encode()).hexdigest()[:12]
    return s, digest

s, h = load({"APP__ROUTES__TRIAGE__MAX_TOKENS": "400"})
print("prod config", h, "| draft prompt:", s.routes["draft"].prompt, "| triage max_tokens:", s.routes["triage"].max_tokens, "| guardrails:", s.guardrail_level)
s2, h2 = load({}, {"retrieval_top_k": 16})
print("tenant acme", h2, "| top_k:", s2.retrieval_top_k)
for env, tenant in [({"APP__ROUTES__DRAFT__MAX_TOKENS": "20000"}, None), ({}, {"routes": {}}), ({"APP__ROUTES__TRIAGE__PROMPT": "triage-latest"}, None)]:
    try:
        load(env, tenant)
    except ValidationError as e:
        print("REJECTED:", "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))
    except PermissionError as e:
        print("REJECTED:", e)`
  },
  lab: {
    title: 'Deterministic feature-flag rollout with a kill switch', file: 'flags_lab.py', browser: true,
    scenario: `<p>You are rolling out a new reranker to a customer’s 40,000 users: 5% first, then 25%, then 100%, with the ability to kill it instantly. Implement flags with deterministic bucketing by user, tenant-level forcing (a design partner always gets it), a kill switch, and show that raising the percentage only adds users (nobody flips back and forth).</p>`,
    steps: ['<code class="i">bucket(flag, user) = int(sha256(flag + ":" + user), 16) % 10000</code> (basis points).', '<code class="i">enabled(flag, user, tenant)</code>: kill switch off → False; tenant forced → True; else bucket < rollout × 100.', 'Measure actual share at 5%, 25% and 100% for 40,000 users.', 'Check monotonicity: every user enabled at 5% is still enabled at 25%.', 'Flip the kill switch and confirm everyone is off, including forced tenants.'],
    checks: ['Observed shares are within about half a percentage point of targets.', 'Rollout increases are monotonic.', 'The kill switch overrides everything.'],
    hints: ['Including the flag name in the hash makes different flags independent.', 'Store flags in config (10.1) so changes are reviewed and logged.'],
    starter: String.raw`import hashlib
FLAGS = {"new_reranker": {"rollout_pct": 5, "kill": False, "force_tenants": {"designpartner"}}}
users = [(f"user-{i}", "designpartner" if i % 100 == 0 else "acme") for i in range(40_000)]
# TODO`,
    solution: String.raw`import hashlib
FLAGS = {"new_reranker": {"rollout_pct": 5, "kill": False, "force_tenants": {"designpartner"}}}
users = [(f"user-{i}", "designpartner" if i % 100 == 0 else "acme") for i in range(40_000)]

def bucket(flag, user):
    return int(hashlib.sha256(f"{flag}:{user}".encode()).hexdigest(), 16) % 10_000

def enabled(flag, user, tenant):
    f = FLAGS[flag]
    if f["kill"]:
        return False
    if tenant in f["force_tenants"]:
        return True
    return bucket(flag, user) < f["rollout_pct"] * 100

previous = set()
for pct in (5, 25, 100):
    FLAGS["new_reranker"]["rollout_pct"] = pct
    on = {u for u, t in users if enabled("new_reranker", u, t)}
    acme = [u for u, t in users if t == "acme"]
    share = sum(u in on for u in acme) / len(acme)
    print(f"rollout {pct:>3}%: acme share {share:.2%} | design partner all on: {all(u in on for u, t in users if t == 'designpartner')} | monotonic: {previous <= on}")
    previous = on
FLAGS["new_reranker"]["kill"] = True
print("kill switch: users enabled =", sum(enabled("new_reranker", u, t) for u, t in users))`
  },
  design: {
    lead: '<p>Configuration is a control plane for AI behaviour. Treat it with the same rigour as the data plane: schemas, reviews, staged rollouts, audit logs and fast rollback.</p>',
    scale: [{ h: 'Dynamic config service', p: 'For many services and tenants, serve config from a central service or store with caching and change notifications, still sourced from a reviewed repository.' }, { h: 'Per-tenant scale', p: 'Thousands of tenants need overrides stored as data with an allow-list and validation, not one file per tenant.' }],
    fail: [{ h: 'Hidden constants', p: 'A threshold hard-coded in a module bypasses review and rollback. Move behaviour-affecting values into config.' }, { h: 'Secrets in config', p: 'Keys committed to repositories leak. Store references; fetch at runtime from a secrets manager.' }],
    trade: [{ h: 'Static files vs dynamic service', p: 'Files are simple and reviewable; a dynamic service enables instant changes and needs strong access control and audit.' }, { h: 'Flexibility vs safety', p: 'Letting tenants override more settings increases flexibility and the risk of unsafe combinations. Allow-list and validate.' }],
    prompt: '<p>Design configuration management for an AI platform with 30 features, three environments and 400 tenants.</p>',
    answer: '<ul><li>Typed schema; per-environment files in the repo; reviewed pull requests with eval evidence for behaviour changes.</li><li>Tenant overrides as validated data with allow-listed keys; secrets by reference.</li><li>Feature flags with deterministic bucketing and kill switches; config hash logged with every request and eval run.</li><li>Audit log of changes and one-click rollback to the previous config version.</li></ul>'
  },
  quiz: [
    { q: 'Why log a config hash with every request?', o: ['For compression', 'To trace any behaviour back to the exact configuration that produced it', 'Providers require it', 'To speed up requests'], a: 1, why: 'Reproducibility and debugging.' },
    { q: 'Where should an API key live?', o: ['In prod.toml', 'In a secrets manager, referenced by name in config', 'In the prompt', 'In a feature flag'], a: 1, why: 'Never commit secret values.' },
    { q: 'Why hash flag name plus user id for rollouts?', o: ['It is random each time', 'Deterministic, stable assignment per user and independent across flags', 'To encrypt users', 'For caching'], a: 1, why: 'Users stay in the same bucket as rollout grows.' }
  ],
  interview: [
    { q: 'How do you manage prompts, models and thresholds across environments?', a: '<p>As typed, validated configuration in the repository with per-environment layers, reviewed pull requests that include eval results, secrets by reference, allow-listed tenant overrides, feature flags for gradual rollout, and a config hash logged with every request and eval so behaviour is traceable and reversible.</p>' },
    { q: 'How would you roll out a risky change to an AI feature?', a: '<p>Behind a feature flag with deterministic bucketing: internal users, then a small percentage, then larger, watching online metrics and guardrails at each step (7.7), with a kill switch and the previous config ready for instant rollback.</p>' }
  ]
});

/* ===================================================================== 10.2 */
L({
  id: '10.2', title: 'Prompt registry', minutes: 45, roles: ['be', 'fde'],
  tags: 'immutable versions · aliases (staging, production) · promotion with eval evidence · rollback · MLflow prompt registry · audit',
  mental: 'Prompts are deployable artefacts. Store each version immutably, point environments at versions through aliases like “production”, promote only with eval evidence, and roll back by moving the alias, not by editing text in place.',
  intro: `<p>Lesson 3.6 versioned prompts in code. At platform scale, prompts change more often than code, often edited by domain experts rather than engineers, and every change can shift quality. A prompt registry gives prompts the lifecycle of models: versions, aliases, lineage to eval results and a one-step rollback. MLflow 3, Langfuse and several platforms provide registries; the concepts are the same.</p>`,
  points: [
    'Every save creates a new immutable version with author, message and timestamp.',
    'Aliases (dev, staging, production) point to versions; applications load prompts by alias.',
    'Promotion moves an alias after an eval run on the candidate version passes the gates (7.6).',
    'Rollback moves the alias back; no redeploy needed.',
    'Each production request logs the resolved prompt version (3.7), linking traces to versions.',
    'Templates have declared variables; rendering with missing variables fails loudly.'
  ],
  concept: { title: 'Labels on bottles, not new wine in old bottles', body: `<p>Never change the text of version 7. Write version 8 and move the “production” label from 7 to 8 when it has passed its tasting. If customers complain, move the label back to 7. Every glass poured records which bottle it came from.</p>` },
  walk: [
    { h: 'Register and alias with MLflow', body: '<p>The MLflow 3 GenAI APIs; the Code tab runs them against a local SQLite store.</p>', code: String.raw`import mlflow
p = mlflow.genai.register_prompt(name="triage", template="...{{ticket}}...", commit_message="add unknown label")
mlflow.genai.set_prompt_alias("triage", alias="production", version=p.version)
prompt = mlflow.genai.load_prompt("prompts:/triage@production")
text = prompt.format(ticket=ticket_text)` },
    { h: 'Gate promotions', body: '<p>Promotion is a pipeline step: run the eval suite against the candidate version, compare with the current production version (paired, 7.2), and move the alias only if gates pass. Record the eval run id with the promotion.</p>' },
    { h: 'Separate editing from deploying', body: '<p>Domain experts can draft new versions in a UI; only the promotion pipeline moves production aliases.</p>' }
  ],
  analogy: `<p><b>Software releases with tags.</b> Commits are immutable; a “v2.3 production” tag points at one of them. Releasing means moving the tag after tests pass; rolling back means moving it back. A prompt registry gives prompts the same mechanics.</p>`,
  diagram: {
    title: 'Prompt lifecycle',
    cols: [['author'], ['reg'], ['eval'], ['alias'], ['app', 'traces']],
    nodes: [
      { id: 'author', label: 'Author new version', sub: 'engineer or expert', tone: 'fde', info: 'Drafts a change with a commit message.' },
      { id: 'reg', label: 'Registry', sub: 'immutable versions', tone: 'acc', info: 'v6, v7, v8 ... never edited after creation.' },
      { id: 'eval', label: 'Eval gate', sub: 'candidate vs production', tone: 'warn', info: 'Paired comparison on the eval set; slice gates.' },
      { id: 'alias', label: 'Aliases', sub: 'staging · production', tone: 'be', info: 'Moving an alias is the release or the rollback.' },
      { id: 'app', label: 'Applications', sub: 'load by alias', tone: 'ok', info: 'Resolve the alias at startup or per request with caching.' },
      { id: 'traces', label: 'Traces', sub: 'prompt version per call', info: 'Links behaviour back to the version.' }
    ],
    edges: [{ a: 'author', b: 'reg' }, { a: 'reg', b: 'eval' }, { a: 'eval', b: 'alias', label: 'pass' }, { a: 'alias', b: 'app' }, { a: 'app', b: 'traces' }],
    caption: 'Versions are immutable; aliases move only after evals pass.'
  },
  illustrated: { title: 'A promotion history', body: `<div class="tbl"><table><thead><tr><th>time</th><th>event</th><th>production →</th></tr></thead><tbody>
    <tr><td>Mon 10:00</td><td>v8 registered (“stricter P1 rule”)</td><td>v7</td></tr>
    <tr><td>Mon 10:20</td><td>eval run 4521: v8 +2.1 pts accuracy, P1 recall +4 pts, no slice regressions</td><td>v7</td></tr>
    <tr><td>Mon 10:25</td><td>alias moved</td><td>v8</td></tr>
    <tr><td>Wed 15:10</td><td>online metrics: escalations up 40% for one tenant</td><td>v8</td></tr>
    <tr><td>Wed 15:12</td><td>rollback: alias moved back</td><td>v7</td></tr></tbody></table></div>` },
  code: {
    title: 'MLflow prompt registry: versions, aliases, gated promotion, rollback', file: 'prompt_registry.py', deps: 'uv add mlflow',
    intro: '<p>Registers two versions of a triage prompt in a local MLflow store, points production at v1, runs a (simulated) eval for each version and logs it as an MLflow run, promotes v2 only if it beats v1 without slice regressions, then rolls back by moving the alias. Applications always load <code class="i">prompts:/triage@production</code>.</p>',
    src: String.raw`import os, random, tempfile
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
os.environ.setdefault("MLFLOW_LOGGING_LEVEL", "ERROR")
import warnings; warnings.filterwarnings("ignore")
import mlflow

mlflow.set_tracking_uri("sqlite:///" + os.path.join(tempfile.mkdtemp(), "mlflow.db"))
mlflow.set_experiment("prompt-promotions")

v1 = mlflow.genai.register_prompt(name="triage", commit_message="initial",
        template="Classify the ticket into billing, bug or how_to.\nTicket: {{ticket}}")
v2 = mlflow.genai.register_prompt(name="triage", commit_message="add unknown label, tag the data",
        template="You triage support tickets for Acme. Labels: billing, bug, how_to, unknown.\nIf unsure, use unknown.\n<ticket>{{ticket}}</ticket>")
mlflow.genai.set_prompt_alias("triage", alias="production", version=v1.version)
print("versions:", v1.version, v2.version, "| production ->", mlflow.genai.load_prompt("prompts:/triage@production").version)

def evaluate(version: int) -> dict:                     # stand-in for the eval suite of Phase 7
    rng = random.Random(version)
    base = {1: 0.84, 2: 0.87}[version]
    return {"accuracy": round(base + rng.uniform(-0.005, 0.005), 3),
            "slice_hi_accuracy": round(base - 0.06 + rng.uniform(-0.01, 0.01), 3)}

results = {}
for v in (v1.version, v2.version):
    with mlflow.start_run(run_name=f"eval-triage-v{v}") as run:
        m = evaluate(v)
        mlflow.log_params({"prompt": f"triage@v{v}", "eval_dataset": "triage-eval@4d1f94b630"})
        mlflow.log_metrics(m)
        results[v] = (m, run.info.run_id)

cand, prod = results[v2.version][0], results[v1.version][0]
passes = cand["accuracy"] - prod["accuracy"] >= 0.01 and cand["slice_hi_accuracy"] >= prod["slice_hi_accuracy"] - 0.02
print(f"candidate v2 {cand} vs production v1 {prod} -> {'PROMOTE' if passes else 'REJECT'}")
if passes:
    mlflow.genai.set_prompt_alias("triage", alias="production", version=v2.version)
p = mlflow.genai.load_prompt("prompts:/triage@production")
print("production ->", p.version, "| rendered:", p.format(ticket="charged twice").splitlines()[-1])

mlflow.genai.set_prompt_alias("triage", alias="production", version=v1.version)       # incident: roll back
print("after rollback, production ->", mlflow.genai.load_prompt("prompts:/triage@production").version)
runs = mlflow.search_runs(experiment_names=["prompt-promotions"], order_by=["metrics.accuracy DESC"])
print(runs[["tags.mlflow.runName", "params.prompt", "metrics.accuracy"]].to_string(index=False))`
  },
  lab: {
    title: 'A minimal prompt registry with audit', file: 'registry_lab.py', browser: true,
    scenario: `<p>A customer cannot run MLflow in their environment and needs a small registry inside their existing Postgres (SQLite here). Build it: immutable versions with content hashes, aliases with history, promotion that requires an eval record, template variable checks, and an audit trail answering “what was production at 14:00 on Wednesday?”.</p>`,
    steps: ['Tables: versions(name, version, template, sha, author, message, created), aliases(name, alias, version, set_at, set_by, reason), evals(name, version, passed, run_id).', '<code class="i">register()</code> rejects duplicates of the latest template (same sha) and never updates existing rows.', '<code class="i">promote(name, version, alias)</code> requires a passing eval record; writes a new alias row (history, not overwrite).', '<code class="i">render(name, alias, **vars)</code> fails if variables are missing or extra.', '<code class="i">as_of(name, alias, ts)</code> returns the version that was live at a timestamp.'],
    checks: ['Promotion without a passing eval is refused.', 'Rendering with a missing variable raises a clear error.', 'as_of returns the right versions before and after a rollback.'],
    hints: ['Find variables with <code class="i">re.findall(r"\\{\\{(\\w+)\\}\\}", template)</code>.', 'For as_of, select the latest alias row with set_at ≤ ts.'],
    starter: String.raw`import hashlib, re, sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE versions (name TEXT, version INT, template TEXT, sha TEXT, author TEXT, message TEXT, created TEXT, PRIMARY KEY (name, version));
CREATE TABLE aliases (name TEXT, alias TEXT, version INT, set_at TEXT, set_by TEXT, reason TEXT);
CREATE TABLE evals (name TEXT, version INT, passed INT, run_id TEXT);
""")
# TODO: register, record_eval, promote, render, as_of, demo`,
    solution: String.raw`import hashlib, re, sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE versions (name TEXT, version INT, template TEXT, sha TEXT, author TEXT, message TEXT, created TEXT, PRIMARY KEY (name, version));
CREATE TABLE aliases (name TEXT, alias TEXT, version INT, set_at TEXT, set_by TEXT, reason TEXT);
CREATE TABLE evals (name TEXT, version INT, passed INT, run_id TEXT);
""")

def register(name, template, author, message, ts):
    sha = hashlib.sha256(template.encode()).hexdigest()[:12]
    last = db.execute("SELECT version, sha FROM versions WHERE name=? ORDER BY version DESC LIMIT 1", (name,)).fetchone()
    if last and last[1] == sha:
        raise ValueError(f"identical to v{last[0]}; nothing to register")
    v = (last[0] if last else 0) + 1
    db.execute("INSERT INTO versions VALUES (?,?,?,?,?,?,?)", (name, v, template, sha, author, message, ts))
    return v

def record_eval(name, version, passed, run_id):
    db.execute("INSERT INTO evals VALUES (?,?,?,?)", (name, version, int(passed), run_id))

def promote(name, version, alias, by, reason, ts, require_eval=True):
    if require_eval and not db.execute("SELECT 1 FROM evals WHERE name=? AND version=? AND passed=1", (name, version)).fetchone():
        raise PermissionError(f"{name} v{version} has no passing eval; refusing to set {alias}")
    db.execute("INSERT INTO aliases VALUES (?,?,?,?,?,?)", (name, alias, version, ts, by, reason))

def as_of(name, alias, ts):
    row = db.execute("SELECT version FROM aliases WHERE name=? AND alias=? AND set_at<=? ORDER BY set_at DESC LIMIT 1", (name, alias, ts)).fetchone()
    return row[0] if row else None

def render(name, alias, ts, **vars):
    v = as_of(name, alias, ts)
    template = db.execute("SELECT template FROM versions WHERE name=? AND version=?", (name, v)).fetchone()[0]
    needed = set(re.findall(r"\{\{(\w+)\}\}", template))
    if needed != set(vars):
        raise KeyError(f"template v{v} needs {sorted(needed)}, got {sorted(vars)}")
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(vars[m.group(1)]), template)

v1 = register("triage", "Classify: {{ticket}}", "ana", "initial", "2026-10-19T09:00")
v2 = register("triage", "Classify for {{tenant}}: <ticket>{{ticket}}</ticket>", "raj", "tenant aware", "2026-10-20T09:00")
record_eval("triage", v1, True, "run-1"); promote("triage", v1, "production", "ci", "baseline", "2026-10-19T10:00")
try:
    promote("triage", v2, "production", "raj", "looks better", "2026-10-20T10:00")
except PermissionError as e:
    print("refused:", e)
record_eval("triage", v2, True, "run-2"); promote("triage", v2, "production", "ci", "eval run-2 passed", "2026-10-21T10:00")
promote("triage", v1, "production", "oncall", "rollback: escalations spike", "2026-10-22T15:12", require_eval=False)
for ts in ("2026-10-20T12:00", "2026-10-22T14:00", "2026-10-22T16:00"):
    print(f"production at {ts}: v{as_of('triage', 'production', ts)}")
print(render("triage", "production", "2026-10-22T14:00", tenant="acme", ticket="charged twice"))
try:
    render("triage", "production", "2026-10-22T14:00", ticket="charged twice")
except KeyError as e:
    print("render error:", e)`
  },
  design: {
    lead: '<p>A prompt registry turns prompt changes into auditable releases. Integrate it with evals, tracing and incident response, and make the safe path (version, evaluate, promote) the easy path.</p>',
    scale: [{ h: 'Caching resolution', p: 'Resolve aliases at startup and refresh on change notifications or short TTLs; never fetch the prompt from the registry on every request without a cache.' }, { h: 'Multi-prompt releases', p: 'Features often use several prompts; release them as a bundle (a config version, 10.1) so they move together.' }],
    fail: [{ h: 'Editing in place', p: 'Changing a production prompt’s text without a new version makes incidents impossible to explain. Immutability is the point.' }, { h: 'Registry outage', p: 'If the registry is down, services must keep running with their cached versions.' }],
    trade: [{ h: 'Registry vs prompts in git', p: 'Git gives review and history for engineers; a registry adds aliases, UI editing for experts and eval linkage. Many teams keep git as source and sync to a registry.' }, { h: 'Speed vs gates', p: 'Gates slow small fixes; keep the smoke eval fast so gating stays cheap.' }],
    prompt: '<p>Domain experts at a customer want to edit prompts themselves without engineers. How do you allow that safely?</p>',
    answer: '<ul><li>Experts edit drafts in a registry UI that creates new immutable versions.</li><li>A pipeline runs the eval suite on each draft and shows a comparison with production.</li><li>Promotion to staging is automatic on pass; production requires an approval and a passing release gate.</li><li>Every request logs the prompt version; rollback is one alias move, available to on-call.</li></ul>'
  },
  quiz: [
    { q: 'How do you roll back a bad prompt change with a registry?', o: ['Edit the text back', 'Move the production alias back to the previous version', 'Redeploy the service', 'Delete the version'], a: 1, why: 'Aliases make rollback instant and auditable.' },
    { q: 'Why keep versions immutable?', o: ['To save storage', 'So every request and eval can be traced to exact prompt text', 'Registries require it', 'For speed'], a: 1, why: 'Reproducibility depends on immutability.' },
    { q: 'What should a promotion require?', o: ['A manager’s opinion', 'A passing eval run linked to the candidate version', 'A longer prompt', 'Nothing'], a: 1, why: 'Evidence before release.' }
  ],
  interview: [
    { q: 'How do you manage prompt changes in production?', a: '<p>In a registry with immutable versions and aliases per environment. Every new version runs the eval suite against the current production version; promotion moves the alias only when gates pass, recording the eval run. Services load prompts by alias with caching, log the resolved version with every request, and rollback is moving the alias back.</p>' },
    { q: 'What is the relationship between prompts and config?', a: '<p>Prompts are one kind of behaviour-affecting configuration. Their versions are referenced from the feature’s config bundle together with model, parameters and thresholds, so a release moves a consistent set, and the config hash in traces identifies all of them.</p>' }
  ]
});

/* ===================================================================== 10.3 */
L({
  id: '10.3', title: 'Experiment tracking with MLflow', minutes: 45, roles: ['be', 'fde'],
  tags: 'runs · params · metrics · artifacts · comparing configurations · Pareto fronts · reproducibility · MLflow GenAI tracing and evaluation',
  mental: 'Every attempt to improve an AI system is an experiment: a configuration (model, prompt, retrieval settings) evaluated on a dataset version, producing metrics and artefacts. Tracking them in one place lets the team compare, reproduce and justify decisions, instead of relying on memory and screenshots.',
  intro: `<p>In a week of tuning, a team easily runs a hundred combinations of models, prompts, chunk sizes and rerankers. Without tracking, the best configuration is whatever someone remembers. MLflow, the most widely used open-source experiment tracker, records runs with parameters, metrics and artefacts; its 3.x releases add GenAI features such as tracing, prompt registry (10.2) and LLM evaluation. Weights & Biases and others offer similar capabilities.</p>`,
  points: [
    'A run records parameters (config), metrics (eval results), tags (dataset version, git commit) and artefacts (per-item results, charts).',
    'Group runs into experiments per feature; compare runs side by side or query them in code.',
    'Always log the dataset version and code commit, so any run can be reproduced.',
    'Optimise more than one metric: quality, cost and latency together; look at the Pareto front, not a single score.',
    'Log per-item results as artefacts so you can inspect what changed between runs.',
    'Production traces can feed back into evaluation datasets (7.7), closing the loop.'
  ],
  concept: { title: 'A lab notebook that writes itself', body: `<p>Scientists keep lab notebooks so results can be trusted and repeated: what was done, with which materials, what came out. Experiment tracking is that notebook, filled in automatically by your evaluation scripts, searchable, and shared with the whole team and the customer.</p>` },
  walk: [
    { h: 'Log a run', body: '<p>Wrap each evaluation in a run.</p>', code: String.raw`with mlflow.start_run(run_name=f"{model}-{prompt}-k{top_k}"):
    mlflow.log_params({"model": model, "prompt": prompt, "top_k": top_k, "reranker": reranker})
    mlflow.set_tags({"dataset": "rag-eval@3f2a", "git_commit": commit})
    mlflow.log_metrics({"accuracy": acc, "faithfulness": faith, "cost_per_1k": cost, "p95_latency_s": p95})
    mlflow.log_table(per_item_results, artifact_file="per_item.json")` },
    { h: 'Query and choose', body: '<p><code class="i">mlflow.search_runs</code> returns a DataFrame; filter by constraints (latency, cost) and rank by quality, or compute the Pareto front of quality versus cost.</p>' },
    { h: 'Trace and evaluate', body: '<p>MLflow’s GenAI tracing and evaluation APIs record traces of LLM calls and score them with built-in or custom scorers; the concepts match Phase 7, so use whichever fits the customer’s stack.</p>' }
  ],
  analogy: `<p><b>A chef testing recipes.</b> Each test batch gets a card: ingredients and quantities (parameters), taste scores and cost (metrics), a photo (artefacts). After fifty batches, the chef picks the best dish within the menu price, and can make it again exactly.</p>`,
  diagram: {
    title: 'Experiment tracking loop',
    cols: [['cfg'], ['run'], ['store'], ['compare'], ['decide']],
    nodes: [
      { id: 'cfg', label: 'Configuration', sub: 'model · prompt · top-k', tone: 'fde', info: 'One point in the search space.' },
      { id: 'run', label: 'Eval run', sub: 'dataset version', tone: 'acc', info: 'Runs the eval suite and computes metrics.' },
      { id: 'store', label: 'Tracking server', sub: 'params · metrics · artefacts', tone: 'be', info: 'MLflow or similar; shared by the team.' },
      { id: 'compare', label: 'Compare', sub: 'Pareto: quality × cost × latency', tone: 'warn', info: 'Find configurations no other beats on every metric.' },
      { id: 'decide', label: 'Decision', sub: 'config + evidence', tone: 'ok', info: 'Chosen configuration with linked runs, ready for the release gate.' }
    ],
    edges: [{ a: 'cfg', b: 'run' }, { a: 'run', b: 'store' }, { a: 'store', b: 'compare' }, { a: 'compare', b: 'decide' }, { a: 'decide', b: 'cfg', dash: true, bend: -60, label: 'next ideas' }],
    caption: 'Configure, evaluate, log, compare, decide, repeat.'
  },
  illustrated: { title: 'A Pareto front', body: `<div class="tbl"><table><thead><tr><th>config</th><th>accuracy</th><th>$ per 1k requests</th><th>p95 s</th><th>Pareto?</th></tr></thead><tbody>
    <tr><td>small model, k=8</td><td class="n">0.81</td><td class="n">0.9</td><td class="n">1.1</td><td>yes (cheapest)</td></tr>
    <tr><td>small model + reranker</td><td class="n">0.86</td><td class="n">1.3</td><td class="n">1.4</td><td>yes</td></tr>
    <tr><td>large model, k=8</td><td class="n">0.85</td><td class="n">6.0</td><td class="n">2.6</td><td>no (dominated)</td></tr>
    <tr><td>large model + reranker</td><td class="n">0.90</td><td class="n">6.4</td><td class="n">2.9</td><td>yes (best quality)</td></tr></tbody></table></div>` },
  code: {
    title: 'A tracked configuration sweep with a Pareto front', file: 'sweep.py', deps: 'uv add mlflow pandas',
    intro: '<p>Sweeps 12 configurations (model, top-k, reranker) of a RAG system, with a simulated evaluator, logging each as an MLflow run with dataset and commit tags. Then queries runs, filters by a latency constraint, and computes the Pareto front of accuracy versus cost.</p>',
    src: String.raw`import itertools, os, random, tempfile
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
os.environ.setdefault("MLFLOW_LOGGING_LEVEL", "ERROR")
import warnings; warnings.filterwarnings("ignore")
import mlflow

mlflow.set_tracking_uri("sqlite:///" + os.path.join(tempfile.mkdtemp(), "mlflow.db"))
mlflow.set_experiment("rag-support-sweep")

def evaluate(model, top_k, rerank, seed):            # stand-in for the Phase 7 eval suite
    rng = random.Random(seed)
    acc = {"small": 0.80, "large": 0.86}[model] + (0.04 if rerank else 0) + {4: -0.02, 8: 0.0, 16: 0.01}[top_k]
    cost = {"small": 0.8, "large": 5.5}[model] * (1 + top_k / 16) + (0.3 if rerank else 0)
    p95 = {"small": 0.9, "large": 2.2}[model] + 0.03 * top_k + (0.25 if rerank else 0)
    return {"accuracy": round(acc + rng.uniform(-0.01, 0.01), 3), "cost_per_1k": round(cost, 2), "p95_s": round(p95, 2)}

for i, (model, top_k, rerank) in enumerate(itertools.product(["small", "large"], [4, 8, 16], [False, True])):
    with mlflow.start_run(run_name=f"{model}-k{top_k}-{'rr' if rerank else 'norr'}"):
        mlflow.log_params({"model": model, "top_k": top_k, "reranker": rerank})
        mlflow.set_tags({"dataset": "rag-eval@3f2a", "git_commit": "a1b2c3d"})
        mlflow.log_metrics(evaluate(model, top_k, rerank, i))

df = mlflow.search_runs(experiment_names=["rag-support-sweep"])
df = df[["tags.mlflow.runName", "metrics.accuracy", "metrics.cost_per_1k", "metrics.p95_s"]].rename(columns=lambda c: c.split(".")[-1])
ok = df[df.p95_s <= 2.5]
front = [r for _, r in ok.iterrows()
         if not any((o.accuracy >= r.accuracy and o.cost_per_1k <= r.cost_per_1k) and (o.accuracy > r.accuracy or o.cost_per_1k < r.cost_per_1k) for _, o in ok.iterrows())]
print(f"{len(df)} runs logged; {len(ok)} meet p95 <= 2.5 s")
print("Pareto front (accuracy vs cost, within the latency limit):")
for r in sorted(front, key=lambda r: r.cost_per_1k):
    print(f"  {r.runName:<16} accuracy {r.accuracy:.3f}  ${'$'}{r.cost_per_1k:.2f}/1k  p95 {r.p95_s:.2f}s")`
  },
  lab: {
    title: 'Reproduce and explain a regression between two runs', file: 'run_diff_lab.py', browser: true,
    scenario: `<p>Two tracked runs disagree: last week’s best configuration scored 0.88, today’s rerun of “the same thing” scores 0.83. Using the run records and per-item results (provided as data), find what differs (params, tags, dataset version), which items flipped, and which slice explains the drop. Write the finding as you would post it in the team channel.</p>`,
    steps: ['Compare params and tags of the two runs and list differences.', 'Join per-item results on item id; count items that went correct → wrong and wrong → correct.', 'Group flips by slice and find where the drop concentrates.', 'Check whether the item sets themselves differ (dataset drift).', 'Print a short finding with numbers.'],
    checks: ['All parameter and tag differences are listed.', 'Flips are counted per slice.', 'The finding names the cause supported by the data.'],
    hints: ['Set differences on item ids reveal dataset changes.', 'A changed tokenizer or chunker version often hides in tags, not params.'],
    starter: String.raw`import random
random.seed(5)
run_a = {"params": {"model": "small", "top_k": 8, "reranker": True, "prompt": "rag@v4"}, "tags": {"dataset": "rag-eval@3f2a", "chunker": "v2", "git": "a1b2c3d"}}
run_b = {"params": {"model": "small", "top_k": 8, "reranker": True, "prompt": "rag@v4"}, "tags": {"dataset": "rag-eval@3f2a", "chunker": "v3", "git": "e4f5a6b"}}
items = [{"id": i, "slice": random.choice(["billing", "sso", "api", "contracts"])} for i in range(400)]
res_a = {it["id"]: random.random() < 0.88 for it in items}
res_b = {it["id"]: (res_a[it["id"]] if it["slice"] != "contracts" else random.random() < 0.65) for it in items}
# TODO`,
    solution: String.raw`import random
from collections import Counter
random.seed(5)
run_a = {"params": {"model": "small", "top_k": 8, "reranker": True, "prompt": "rag@v4"}, "tags": {"dataset": "rag-eval@3f2a", "chunker": "v2", "git": "a1b2c3d"}}
run_b = {"params": {"model": "small", "top_k": 8, "reranker": True, "prompt": "rag@v4"}, "tags": {"dataset": "rag-eval@3f2a", "chunker": "v3", "git": "e4f5a6b"}}
items = [{"id": i, "slice": random.choice(["billing", "sso", "api", "contracts"])} for i in range(400)]
res_a = {it["id"]: random.random() < 0.88 for it in items}
res_b = {it["id"]: (res_a[it["id"]] if it["slice"] != "contracts" else random.random() < 0.65) for it in items}

diffs = [(k, run_a[s][k], run_b[s][k]) for s in ("params", "tags") for k in run_a[s] if run_a[s][k] != run_b[s].get(k)]
print("differences:", diffs)
print("same item set:", set(res_a) == set(res_b))
slice_of = {it["id"]: it["slice"] for it in items}
down = Counter(slice_of[i] for i in res_a if res_a[i] and not res_b[i])
up = Counter(slice_of[i] for i in res_a if not res_a[i] and res_b[i])
acc = lambda r: sum(r.values()) / len(r)
print(f"accuracy {acc(res_a):.3f} -> {acc(res_b):.3f}; flips correct->wrong {sum(down.values())}, wrong->correct {sum(up.values())}")
print("correct->wrong by slice:", dict(down))
for s in ("billing", "sso", "api", "contracts"):
    ids = [i for i in res_a if slice_of[i] == s]
    print(f"  {s:<10} {sum(res_a[i] for i in ids) / len(ids):.2f} -> {sum(res_b[i] for i in ids) / len(ids):.2f}")
print("\nfinding: same dataset and params; the chunker tag changed v2 -> v3 (commit e4f5a6b). The whole drop is in the contracts slice;"
      " other slices are unchanged. Next: inspect contract chunks under v3 (clause splitting) and add a chunker-version gate.")`
  },
  design: {
    lead: '<p>Experiment tracking is the memory of an AI team. Make logging automatic in eval scripts, tag runs with everything needed to reproduce them, and use the tracked evidence in release decisions and customer reports.</p>',
    scale: [{ h: 'Shared tracking server', p: 'A managed or self-hosted tracking server with a database backend and artefact store, access-controlled per project and customer.' }, { h: 'Automation', p: 'CI eval jobs (7.6) log runs automatically with commit and config hashes, so tracked history covers every change.' }],
    fail: [{ h: 'Untagged runs', p: 'Runs without dataset version or commit cannot be reproduced and mislead comparisons.' }, { h: 'Leaderboard thinking', p: 'Picking the top accuracy run ignores cost, latency and slices; decide on the Pareto front and gates.' }],
    trade: [{ h: 'MLflow vs SaaS trackers', p: 'MLflow is open source and self-hostable (often required by enterprises); SaaS tools add collaboration features with data leaving the customer’s environment.' }, { h: 'Granularity', p: 'Logging per-item results costs storage and makes debugging fast; it is usually worth it for eval runs.' }],
    prompt: '<p>Set up experiment tracking for a three-month FDE engagement improving a customer’s RAG system.</p>',
    answer: '<ul><li>MLflow server inside the customer’s cloud with SSO; one experiment per feature.</li><li>Eval scripts log params, config hash, dataset version, commit, metrics and per-item tables.</li><li>Weekly review of the Pareto front and slice results; decisions recorded with run links.</li><li>Release gates read the chosen run’s metrics; the final report to the customer cites runs.</li></ul>'
  },
  quiz: [
    { q: 'What must be logged to reproduce an eval run?', o: ['Only the final score', 'Configuration, dataset version and code commit, plus metrics', 'The model weights', 'The team’s opinion'], a: 1, why: 'Reproducibility needs inputs, not just outputs.' },
    { q: 'A configuration is on the Pareto front when:', o: ['It has the highest accuracy', 'No other configuration is at least as good on every metric and better on one', 'It is the cheapest', 'It was run last'], a: 1, why: 'Pareto optimality is about trade-offs.' },
    { q: 'Two runs with identical params differ in score. First check:', o: ['Delete one', 'Tags such as dataset version, chunker version and commit, then per-item flips', 'Increase temperature', 'Nothing'], a: 1, why: 'Hidden differences usually live in tags and data.' }
  ],
  interview: [
    { q: 'How do you keep track of many AI experiments?', a: '<p>Every eval run is logged automatically with parameters, config hash, dataset version and commit as tags, metrics for quality, cost and latency, and per-item results as artefacts. I compare runs on the Pareto front within constraints and by slice, and link chosen runs to release decisions.</p>' },
    { q: 'What does MLflow offer for GenAI work in 2026?', a: '<p>Classic run tracking plus GenAI features: tracing of LLM and agent calls, a prompt registry with versions and aliases, and evaluation APIs with built-in and custom scorers, all self-hostable, which matters for enterprise customers who keep data in their own environment.</p>' }
  ]
});

/* ===================================================================== 10.4 */
L({
  id: '10.4', title: 'CI/CD with GitHub Actions', minutes: 50, roles: ['be', 'fde'],
  tags: 'pipeline stages · path filters · eval jobs · container builds · environments and approvals · canary deploys · automated rollback · OIDC',
  mental: 'An AI delivery pipeline is a normal CI/CD pipeline plus evaluation stages: lint and unit tests, a fast eval smoke suite on pull requests, image builds, deployment to staging with the full eval suite, a canary in production judged by online metrics, then promotion or automatic rollback.',
  intro: `<p>Phase 1.9 and lesson 7.6 introduced Git workflows and eval gates. This lesson assembles the full delivery pipeline as GitHub Actions workflows, the CI system most customers already use, with the AI-specific parts in the right places: path-filtered eval jobs, environment approvals, short-lived cloud credentials through OIDC, and canary analysis that decides promotion with data.</p>`,
  points: [
    'Pull requests: lint, type checks, unit tests and the eval smoke suite (7.6), path-filtered to changes that can alter behaviour.',
    'Main branch: build and push an immutable image tagged by commit; deploy to staging; run the full eval suite and load test.',
    'Production: canary a small share of traffic; compare canary and baseline metrics automatically; promote or roll back.',
    'Use GitHub environments for approvals and secrets; use OIDC to obtain short-lived cloud credentials instead of long-lived keys.',
    'Make everything reproducible: pinned dependencies (uv lock), pinned actions, pinned model and prompt versions in config.',
    'Fail fast and loudly; publish eval and canary reports as artefacts and PR comments.'
  ],
  concept: { title: 'Every change walks the same road', body: `<p>A code change, a prompt change and a model upgrade should all take the same road to production: checked, evaluated, staged, canaried, promoted. The road is automated so it is fast enough that nobody looks for a shortcut, and strict enough that a bad change stops at the first checkpoint it fails.</p>` },
  walk: [
    { h: 'The pull-request workflow', body: '<p>Fast checks plus the eval smoke suite.</p>', lang: 'yaml', file: '.github/workflows/pr.yml', code: String.raw`name: pr
on:
  pull_request:
    paths: ["app/**", "prompts/**", "config/**", "evals/**", "pyproject.toml", "uv.lock"]
permissions: { contents: read, pull-requests: write }
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen
      - run: uv run ruff check . && uv run pytest -q tests/unit
  evals:
    needs: checks
    runs-on: ubuntu-latest
    environment: evals
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen && uv run pytest -q evals/smoke --junitxml=evals.xml
        env: { ANTHROPIC_API_KEY: "${'$'}{{ secrets.ANTHROPIC_API_KEY }}" }` },
    { h: 'The release workflow', body: '<p>On merge to main: build, deploy to staging, full evals, canary, promote. Production deploys require an environment approval and use OIDC to assume a deploy role.</p>' },
    { h: 'Canary analysis', body: '<p>Route 5% of traffic to the new version for a fixed window; compare error rate, latency percentiles, guardrail blocks, escalations and judge scores with the baseline; promote only within tolerances. The lab implements the decision.</p>' }
  ],
  analogy: `<p><b>An airport’s pre-flight process.</b> Every plane, new or routine, goes through the same checks: maintenance log, walk-around, fuel, tower clearance. A new route is first flown with a small plane before the jumbo. The checklist is fast because it is routine, and it is never skipped.</p>`,
  diagram: {
    title: 'Delivery pipeline for an AI service',
    cols: [['pr'], ['ci'], ['build'], ['stg'], ['canary'], ['prod', 'rb']],
    nodes: [
      { id: 'pr', label: 'Pull request', sub: 'code · prompt · config', tone: 'fde', info: 'Any behaviour-changing change.' },
      { id: 'ci', label: 'Checks + smoke evals', sub: 'minutes', tone: 'acc', info: 'Lint, unit tests, eval smoke suite; blocks merge.' },
      { id: 'build', label: 'Build image', sub: 'tag = commit', info: 'Immutable artefact pushed to the registry.' },
      { id: 'stg', label: 'Staging', sub: 'full evals · load test', tone: 'be', info: 'Release gate vs last release (7.6).' },
      { id: 'canary', label: 'Canary 5%', sub: 'online metrics', tone: 'warn', info: 'Automated comparison with baseline.' },
      { id: 'prod', label: 'Promote', sub: '100%', tone: 'ok', info: 'Gradual or full rollout.' },
      { id: 'rb', label: 'Roll back', sub: 'automatic', tone: 'bad', info: 'Previous image and config restored.' }
    ],
    edges: [{ a: 'pr', b: 'ci' }, { a: 'ci', b: 'build', label: 'merge' }, { a: 'build', b: 'stg' }, { a: 'stg', b: 'canary', label: 'approve' }, { a: 'canary', b: 'prod' }, { a: 'canary', b: 'rb', dash: true }],
    caption: 'Checks, evals, staging, canary, then promote or roll back.'
  },
  illustrated: { title: 'Which changes trigger what', body: `<div class="tbl"><table><thead><tr><th>change</th><th>unit tests</th><th>smoke evals</th><th>full evals</th><th>canary</th></tr></thead><tbody>
    <tr><td>README</td><td>no</td><td>no</td><td>no</td><td>no</td></tr>
    <tr><td>app code</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
    <tr><td>prompt or config</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
    <tr><td>model version bump</td><td>yes</td><td>yes</td><td>yes, plus load test</td><td>yes, longer window</td></tr>
    <tr><td>eval dataset update</td><td>no</td><td>yes (re-baseline)</td><td>yes</td><td>no</td></tr></tbody></table></div>` },
  code: {
    title: 'Generate and lint a GitHub Actions pipeline', file: 'pipeline_lint.py', deps: 'uv add pyyaml',
    intro: '<p>A small tool that generates the release workflow from a Python description and lints workflows for common mistakes: unpinned third-party actions, secrets echoed in run steps, production deploys without an environment, missing eval stage before deploy, and long-lived cloud keys instead of OIDC. It is run against a flawed workflow and the generated one.</p>',
    src: String.raw`import re
import yaml

def generate():
    return {"name": "release", "on": {"push": {"branches": ["main"]}},
            "permissions": {"id-token": "write", "contents": "read"},
            "jobs": {
                "build": {"runs-on": "ubuntu-latest", "steps": [{"uses": "actions/checkout@v4"},
                          {"run": "docker build -t $REGISTRY/assistant:$GITHUB_SHA . && docker push $REGISTRY/assistant:$GITHUB_SHA"}]},
                "staging": {"needs": "build", "runs-on": "ubuntu-latest", "environment": "staging",
                            "steps": [{"run": "./deploy.sh staging $GITHUB_SHA"}, {"run": "uv run pytest evals/full -q"}]},
                "canary": {"needs": "staging", "runs-on": "ubuntu-latest", "environment": "production",
                           "steps": [{"uses": "aws-actions/configure-aws-credentials@v4", "with": {"role-to-assume": "arn:aws:iam::123456789012:role/deploy"}},
                                     {"run": "./deploy.sh canary $GITHUB_SHA"}, {"run": "python canary_check.py --window 30m"}]},
                "promote": {"needs": "canary", "runs-on": "ubuntu-latest", "environment": "production",
                            "steps": [{"run": "./deploy.sh production $GITHUB_SHA"}]}}}

def lint(wf):
    issues = []
    jobs = wf.get("jobs", {})
    for name, job in jobs.items():
        for step in job.get("steps", []):
            uses, run = step.get("uses", ""), step.get("run", "")
            if uses and not re.search(r"@(v\d+|[0-9a-f]{40})$", uses):
                issues.append(f"{name}: action '{uses}' not pinned to a version or SHA")
            if re.search(r"echo .*secrets\.", run):
                issues.append(f"{name}: run step echoes a secret")
            if re.search(r"AWS_SECRET_ACCESS_KEY|aws_secret", run + str(step.get("env", "")), re.I):
                issues.append(f"{name}: long-lived cloud key; use OIDC (id-token: write + role)")
        if re.search(r"prod", name) or "production" in str(job.get("steps")):
            if job.get("environment") != "production":
                issues.append(f"{name}: deploys to production without the 'production' environment (no approval)")
    deploy_jobs = [n for n, j in jobs.items() if "deploy.sh" in str(j.get("steps"))]
    has_eval = any("evals" in str(j.get("steps")) for j in jobs.values())
    if deploy_jobs and not has_eval:
        issues.append("pipeline deploys without any eval stage")
    return issues

FLAWED = yaml.safe_load("""
name: release
on: {push: {branches: [main]}}
jobs:
  deploy_prod:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - run: echo ${'$'}{{ secrets.ANTHROPIC_API_KEY }} > .env
      - run: AWS_SECRET_ACCESS_KEY=${'$'}{{ secrets.AWS_KEY }} ./deploy.sh production
""")
print("flawed workflow:")
for i in lint(FLAWED):
    print("  -", i)
generated = generate()
print("\ngenerated workflow:", lint(generated) or "no issues")
print(yaml.safe_dump(generated, sort_keys=False).splitlines()[0:6])`
  },
  lab: {
    title: 'Automated canary analysis', file: 'canary_lab.py', browser: true,
    scenario: `<p>Implement the <code class="i">canary_check</code> step: given 30 minutes of per-minute metrics for baseline (95% of traffic) and canary (5%), decide promote, extend or roll back. Rules: error rate must not exceed baseline by more than 0.5 points with statistical support; p95 latency must not exceed baseline by more than 15%; guardrail block rate and escalation rate must not rise by more than 20% relative; with too few canary requests, extend the window instead of deciding.</p>`,
    steps: ['Use the seeded metrics in the starter for three scenarios: healthy, latency regression, error spike.', 'Aggregate per variant: requests, errors, p95 latency (from per-minute p95s, take the 95th percentile), guardrail blocks, escalations.', 'Error check: two-proportion z-test, fail if canary is worse by > 0.5 points and z > 2. Apply the same significance test to guardrail and escalation rates: with about 3,000 canary requests, a 1% rate is only ~30 events, so a 20% relative rise can be noise.', 'Apply the other rules; if canary requests < 1,000, return extend.', 'Print the decision and reasons per scenario.'],
    checks: ['Healthy promotes (an insignificant blip is reported as a note, not a failure).', 'Latency regression rolls back with a latency reason.', 'Error spike rolls back with an error reason.'],
    hints: ['Keep rules as data so the customer can review thresholds.', 'Return all failing reasons, not just the first.'],
    starter: String.raw`import math, random
def scenario(kind, seed=1):
    rng = random.Random(seed)
    data = {"baseline": [], "canary": []}
    for minute in range(30):
        for v, share in (("baseline", 0.95), ("canary", 0.05)):
            n = int(rng.gauss(2000 * share, 20 * share)) if v == "canary" else int(rng.gauss(2000 * share, 30))
            err = 0.006 + (0.02 if kind == "errors" and v == "canary" else 0)
            lat = 1.4 * (1.35 if kind == "latency" and v == "canary" else 1.0) * rng.uniform(0.95, 1.05)
            data[v].append({"requests": n, "errors": sum(rng.random() < err for _ in range(n)), "p95": lat,
                            "blocks": sum(rng.random() < 0.01 for _ in range(n)), "escalations": sum(rng.random() < 0.05 for _ in range(n))})
    return data
# TODO: canary_check(data) -> (decision, reasons)`,
    solution: String.raw`import math, random
def scenario(kind, seed=1):
    rng = random.Random(seed)
    data = {"baseline": [], "canary": []}
    for minute in range(30):
        for v, share in (("baseline", 0.95), ("canary", 0.05)):
            n = int(rng.gauss(2000 * share, 20 * share)) if v == "canary" else int(rng.gauss(2000 * share, 30))
            err = 0.006 + (0.02 if kind == "errors" and v == "canary" else 0)
            lat = 1.4 * (1.35 if kind == "latency" and v == "canary" else 1.0) * rng.uniform(0.95, 1.05)
            data[v].append({"requests": n, "errors": sum(rng.random() < err for _ in range(n)), "p95": lat,
                            "blocks": sum(rng.random() < 0.01 for _ in range(n)), "escalations": sum(rng.random() < 0.05 for _ in range(n))})
    return data

RULES = {"min_requests": 1000, "error_pts": 0.5, "z": 2.0, "latency_rel": 0.15, "rate_rel": 0.20}

def agg(rows):
    n = sum(r["requests"] for r in rows)
    p95s = sorted(r["p95"] for r in rows)
    return {"n": n, "err": sum(r["errors"] for r in rows) / n, "p95": p95s[int(0.95 * (len(p95s) - 1))],
            "blocks": sum(r["blocks"] for r in rows) / n, "esc": sum(r["escalations"] for r in rows) / n}

def canary_check(data, rules=RULES):
    b, c = agg(data["baseline"]), agg(data["canary"])
    if c["n"] < rules["min_requests"]:
        return "extend", [f"only {c['n']} canary requests"]
    reasons = []
    def z(k):                                   # two-proportion z-test, canary worse => positive
        p = (b[k] * b["n"] + c[k] * c["n"]) / (b["n"] + c["n"])
        return (c[k] - b[k]) / math.sqrt(p * (1 - p) * (1 / b["n"] + 1 / c["n"]))
    if (c["err"] - b["err"]) * 100 > rules["error_pts"] and z("err") > rules["z"]:
        reasons.append(f"error rate {c['err']:.2%} vs {b['err']:.2%} (z={z('err'):.1f})")
    if c["p95"] > b["p95"] * (1 + rules["latency_rel"]):
        reasons.append(f"p95 latency {c['p95']:.2f}s vs {b['p95']:.2f}s")
    for k, label in (("blocks", "guardrail blocks"), ("esc", "escalations")):
        if c[k] > b[k] * (1 + rules["rate_rel"]) and z(k) > rules["z"]:   # relative rise that is also significant
            reasons.append(f"{label} {c[k]:.2%} vs {b[k]:.2%} (z={z(k):.1f})")
        elif c[k] > b[k] * (1 + rules["rate_rel"]):
            reasons.append(f"note only: {label} {c[k]:.2%} vs {b[k]:.2%}, not significant (z={z(k):.1f})")
    if reasons and all(r.startswith("note only") for r in reasons):
        return "promote", reasons
    return ("rollback" if reasons else "promote"), reasons

for kind in ("healthy", "latency", "errors"):
    decision, reasons = canary_check(scenario(kind))
    print(f"{kind:<8} -> {decision.upper():<8} {'; '.join(reasons) or 'all checks within tolerance'}")`
  },
  design: {
    lead: '<p>The delivery pipeline is how an AI team moves fast safely. Keep it fast, deterministic and automated, with evaluation and canary analysis as first-class stages and rollback as a routine operation.</p>',
    scale: [{ h: 'Pipeline speed', p: 'Cache dependencies and images, run evals in parallel, keep the PR path under about 15 minutes so it is never bypassed.' }, { h: 'Many services', p: 'Reusable workflows and composite actions standardise stages across repositories.' }],
    fail: [{ h: 'Secrets exposure', p: 'Printing secrets or using long-lived keys in CI is a common breach path. Use OIDC, environment secrets and least-privilege tokens.' }, { h: 'Canary blind spots', p: 'A 5% canary for 30 minutes cannot detect rare failures. Combine with offline evals and longer bake times for risky changes.' }],
    trade: [{ h: 'Full evals on every PR vs on main', p: 'Full suites on every PR are slow and expensive; smoke on PRs, full on main and before release is the usual balance.' }, { h: 'Automatic vs manual promotion', p: 'Automatic promotion is fast and consistent; regulated customers often require a human approval with the automated report attached.' }],
    prompt: '<p>Design the CI/CD pipeline for a customer’s RAG assistant deployed on Kubernetes in their AWS account.</p>',
    answer: '<ul><li>PR: lint, unit tests, eval smoke suite (path filtered), results as PR comment.</li><li>Main: image build tagged by commit, deploy to staging via OIDC role, full evals and load test, release gate.</li><li>Production: approval, 5% canary with automated analysis, promote or roll back; prompt and config changes take the same path.</li><li>Pinned actions and dependencies; artefacts retained; DORA and eval trend dashboards.</li></ul>'
  },
  quiz: [
    { q: 'Why use OIDC in GitHub Actions for cloud deployments?', o: ['It is faster', 'Jobs get short-lived credentials without storing long-lived cloud keys', 'It replaces tests', 'For logging'], a: 1, why: 'Eliminates static secrets in CI.' },
    { q: 'A prompt-only change should:', o: ['Skip CI', 'Go through the same eval and canary stages as code', 'Be edited directly in production', 'Only run unit tests'], a: 1, why: 'Prompts change behaviour as much as code.' },
    { q: 'The canary has only 400 requests after the window. The right decision:', o: ['Promote', 'Roll back', 'Extend the window to gather enough data', 'Delete metrics'], a: 2, why: 'Too little data cannot support a decision.' }
  ],
  interview: [
    { q: 'Describe a CI/CD pipeline for an LLM application.', a: '<p>PRs run lint, unit tests and an eval smoke suite, path-filtered to behaviour-changing files. Merges build an immutable image, deploy to staging, and run full evals and a load test against the last release. Production uses approvals, OIDC credentials, and a canary with automated analysis of errors, latency, guardrail and quality signals, promoting or rolling back automatically. Prompts and config follow the same path.</p>' },
    { q: 'How do you decide whether a canary is healthy?', a: '<p>Compare canary and baseline over a fixed window with enough traffic: error rate with a significance check, latency percentiles with relative tolerances, guardrail and escalation rates, and sampled quality scores. Extend when data is insufficient; roll back on any failing rule with the reasons attached.</p>' }
  ]
});
})();
