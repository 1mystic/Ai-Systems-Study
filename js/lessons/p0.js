/* Phase 0 · Production Python */
(function () {
const L = AISA.lesson;

/* ===================================================================== 0.1 */
L({
  id: '0.1', title: 'Typing, dataclasses and Pydantic v2', minutes: 50, roles: ['fde', 'be'],
  tags: 'type hints · dataclasses · Pydantic v2 · validation · JSON Schema',
  mental: 'Type hints describe the shape of data inside your code. Pydantic enforces that shape at the boundary, where untrusted data enters: HTTP bodies, LLM tool calls, customer CSV exports.',
  intro: `<p>Every AI system is a chain of boundaries. A customer\u2019s CRM export arrives as messy JSON, a model returns tool-call arguments it generated itself, a warehouse hands you rows with surprising nulls. If any of that flows into your code unchecked, the failure shows up three functions later as a confusing <code class="i">KeyError</code>, or worse, as a wrong refund.</p>
  <p>Pydantic v2 is the validation layer under FastAPI and under the official OpenAI and Anthropic Python SDKs, so you will meet it on day one in either role. The <b>FDE</b> uses it to tame customer data during integration; the <b>AI backend engineer</b> uses it to validate requests and structured model outputs before anything executes.</p>`,
  points: [
    'Type hints such as <code class="i">list[str]</code>, <code class="i">dict[str, int]</code> and <code class="i">str | None</code> are checked by your editor and by mypy or pyright. Python itself ignores them at runtime.',
    '<code class="i">@dataclass(frozen=True, slots=True)</code> gives cheap, immutable value objects for data you created yourself.',
    'A Pydantic <code class="i">BaseModel</code> validates and converts at runtime: in the default lax mode <code class="i">"42"</code> becomes <code class="i">42</code>; strict mode rejects it.',
    'Validate once at the edges (API request, LLM output, file import), then pass typed objects inward and trust them.',
    '<code class="i">model_validate</code> / <code class="i">model_validate_json</code> bring data in; <code class="i">model_dump</code> / <code class="i">model_dump_json</code> send it out; <code class="i">model_json_schema()</code> is the schema you hand a model for structured output.',
    'Use <code class="i">Field(...)</code> constraints, <code class="i">Literal</code> for closed sets, and <code class="i">field_validator</code> / <code class="i">model_validator</code> for business rules.'
  ],
  concept: { title: 'Parse, don\u2019t validate', body: `<p>Checking a dict and passing the same dict along means every downstream function must trust that someone checked it. Parsing converts the raw input <b>once</b> into a typed object that cannot be invalid. Downstream code receives a <code class="i">Ticket</code>, not \u201ca dict that probably has a priority key\u201d.</p><p>The payoff is precise errors at the boundary: Pydantic reports the location, the error type and the offending input for every field at once, which is exactly what you need to return a clean 422 to a client or to send a correction back to a model.</p>` },
  walk: [
    { h: 'Annotate functions so tools can check them', body: '<p>Annotations cost nothing at runtime and catch whole classes of bugs before you run anything. Run <code class="i">uv run pyright</code> or <code class="i">mypy</code> in CI.</p>', code: String.raw`from typing import Literal

Queue = Literal["billing", "bug", "other"]

def route(subject: str, tags: list[str]) -> Queue:
    if "refund" in tags or "invoice" in subject.lower():
        return "billing"
    if "error" in subject.lower():
        return "bug"
    return "other"

print(route("Invoice charged twice", ["refund"]))
print(route("500 error on export", []))`, run: true, browser: true },
    { h: 'Use dataclasses for values you create yourself', body: '<p><code class="i">frozen=True</code> stops accidental mutation; <code class="i">slots=True</code> saves memory when you hold millions of them, for example one per LLM call in a cost report.</p>', code: String.raw`from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class Usage:
    input_tokens: int
    output_tokens: int

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens

u = Usage(input_tokens=1200, output_tokens=350)
print(u, u.total)
try:
    u.input_tokens = 0
except Exception as e:
    print(type(e).__name__, "-", e)`, run: true, browser: true },
    { h: 'Put a Pydantic model at the boundary', body: '<p>Messy input goes in, a typed object or a precise error comes out. Notice the whitespace-padded id string becoming an <code class="i">int</code> and the ISO timestamp becoming a <code class="i">datetime</code>.</p>', code: String.raw`from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, ValidationError

class Ticket(BaseModel):
    id: int
    subject: str = Field(min_length=3, max_length=200)
    priority: Literal["P1", "P2", "P3"] = "P3"
    created_at: datetime

t = Ticket.model_validate({"id": " 4812 ", "subject": "Charged twice",
                           "priority": "P1", "created_at": "2026-10-14T09:12:00Z"})
print(repr(t.id), t.created_at.isoformat())

try:
    Ticket.model_validate({"id": "abc", "subject": "Hi", "priority": "urgent",
                           "created_at": "yesterday"})
except ValidationError as e:
    for err in e.errors():
        print(err["loc"], "->", err["msg"])`, run: true, browser: true },
    { h: 'Encode business rules as validators', body: '<p>A <code class="i">field_validator</code> cleans one field; a <code class="i">model_validator(mode="after")</code> checks rules that span fields, such as \u201cdue date must be after creation\u201d.</p>', code: String.raw`from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator

class Window(BaseModel):
    email: str
    created_at: datetime
    due_at: datetime

    @field_validator("email")
    @classmethod
    def normalise(cls, v: str) -> str:
        return v.strip().lower()

    @model_validator(mode="after")
    def due_after_created(self):
        if self.due_at <= self.created_at:
            raise ValueError("due_at must be after created_at")
        return self

w = Window(email="  Ana@ACME.com ", created_at="2026-10-14T09:00:00Z", due_at="2026-10-15T09:00:00Z")
print(w.email)`, run: true, browser: true },
    { h: 'Choose strict or lax, and export a JSON Schema', body: '<p>Lax mode is friendly for human-entered data. For machine-to-machine payloads, strict mode surfaces bugs instead of quietly converting them. The JSON Schema is what you pass to a model\u2019s structured-output or tool-definition parameter in Phase 3.</p>', code: String.raw`import json
from pydantic import BaseModel, ConfigDict, ValidationError

class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    ticket_id: int

try:
    Strict.model_validate({"ticket_id": "42"})
except ValidationError as e:
    print(e.errors()[0]["type"])

print(json.dumps(Strict.model_json_schema()))`, run: true, browser: true }
  ],
  analogy: `<p><b>Passport control.</b> Inside an airport terminal nobody checks your passport at every gate, because it was checked once at the border. Type hints are the signs inside the terminal telling everyone where things go. Pydantic is passport control: thorough, at one place, and it either admits you with a stamp (a typed object) or tells you exactly which document is wrong.</p>`,
  diagram: {
    title: 'Validation at the boundary', w: 820, h: 330,
    groups: [{ x: 16, y: 20, w: 180, h: 290, label: 'UNTRUSTED' }, { x: 420, y: 20, w: 384, h: 290, label: 'TYPED DOMAIN' }],
    nodes: [
      { id: 'http', x: 32, y: 50, label: 'HTTP request', sub: 'JSON body', info: 'A client or a customer system posts JSON. Anything can be in it.' },
      { id: 'llm', x: 32, y: 140, label: 'LLM tool call', sub: 'generated args', info: 'A model proposes arguments for a tool. Models produce plausible but wrong values, extra fields and wrong types.' },
      { id: 'csv', x: 32, y: 230, label: 'CSV / warehouse', sub: 'customer export', info: 'FDE reality: spreadsheets with padded strings, mixed date formats and comma-joined tags.' },
      { id: 'pyd', x: 236, y: 132, w: 150, h: 70, label: 'Pydantic model', sub: 'parse + validate', tone: 'acc', info: 'The single checkpoint: coerces types, enforces constraints and validators, and returns either a typed object or a list of precise errors.' },
      { id: 'err', x: 236, y: 250, label: 'ValidationError', sub: 'loc · type · input', tone: 'bad', info: 'Becomes a 422 response for HTTP clients, or a correction message sent back to the model so it can retry the tool call.' },
      { id: 'svc', x: 452, y: 132, label: 'Service logic', sub: 'trusts types', tone: 'ok', info: 'Business code receives a Ticket object. No defensive dict checks needed.' },
      { id: 'db', x: 640, y: 60, label: 'Database', sub: 'typed rows', info: 'Writes typed values; the schema in the DB and the model agree.' },
      { id: 'out', x: 640, y: 210, label: 'Response / event', sub: 'model_dump_json()', info: 'Serialization is the mirror image of parsing: the same model defines the output contract.' }
    ],
    edges: [
      { a: 'http', b: 'pyd', step: 1 }, { a: 'llm', b: 'pyd', step: 1 }, { a: 'csv', b: 'pyd', step: 1 },
      { a: 'pyd', b: 'err', label: 'invalid', dash: true, step: 2 },
      { a: 'pyd', b: 'svc', label: 'Ticket', step: 3 }, { a: 'svc', b: 'db', step: 4 }, { a: 'svc', b: 'out', step: 4 }
    ],
    steps: ['Raw data from three untrusted sources arrives at one model.', 'Anything invalid stops here with every field error listed at once.', 'Valid data crosses the boundary as a typed object.', 'Inside, code trusts the types: storage and output use the same model.'],
    caption: 'One checkpoint between untrusted inputs and typed business logic.'
  },
  illustrated: { title: 'One messy CRM row, before and after', body: `<p>An FDE receives this row from a customer\u2019s ticketing export. The production model on the Code tab turns it into a clean object:</p>
    <div class="tbl"><table><thead><tr><th>field</th><th>raw input</th><th>after parsing</th><th>rule that did it</th></tr></thead><tbody>
    <tr><td>id</td><td class="n">" 4812 "</td><td class="n">4812</td><td>lax int coercion strips whitespace</td></tr>
    <tr><td>email</td><td class="n">"Ana@ACME.com "</td><td class="n">"ana@acme.com"</td><td>field_validator normalises</td></tr>
    <tr><td>tags</td><td class="n">"billing, refund"</td><td class="n">["billing", "refund"]</td><td>before-validator splits a comma string</td></tr>
    <tr><td>created_at</td><td class="n">"2026-10-14T09:12:00Z"</td><td class="n">datetime, UTC</td><td>ISO 8601 parsing</td></tr>
    <tr><td>due_at</td><td class="n">"2026-10-13T09:00:00Z"</td><td>rejected</td><td>model_validator: due before created</td></tr></tbody></table></div>
    <p>One bad row produces one <code class="i">ValidationError</code> listing every problem. In a 40,000-row import you log the row number with those errors and keep going, instead of failing the whole batch on row 1,317.</p>` },
  code: {
    title: 'Ticket models for a customer import', file: 'ticket_models.py', deps: 'uv add "pydantic>=2.10"', browser: true,
    intro: '<p>A production-shaped model: closed sets with <code class="i">Literal</code>, constraints with <code class="i">Field</code>, a before-validator that accepts both lists and comma strings, a cross-field rule, and a batch importer that collects errors per row.</p>',
    src: String.raw`from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError, field_validator, model_validator

def split_tags(v: object) -> object:
    if isinstance(v, str):
        return [t.strip().lower() for t in v.split(",") if t.strip()]
    return v

Tags = Annotated[list[str], BeforeValidator(split_tags)]

class Ticket(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    id: int = Field(gt=0)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$")
    subject: str = Field(min_length=3, max_length=200)
    priority: Literal["P1", "P2", "P3"] = "P3"
    tags: Tags = []
    created_at: datetime
    due_at: datetime | None = None

    @field_validator("email", mode="before")
    @classmethod
    def lower_email(cls, v: object) -> object:
        return v.strip().lower() if isinstance(v, str) else v

    @model_validator(mode="after")
    def due_after_created(self) -> "Ticket":
        if self.due_at and self.due_at <= self.created_at:
            raise ValueError("due_at must be after created_at")
        return self

def import_rows(rows: list[dict]) -> tuple[list[Ticket], list[str]]:
    ok, problems = [], []
    for n, row in enumerate(rows, start=1):
        try:
            ok.append(Ticket.model_validate(row))
        except ValidationError as e:
            msgs = "; ".join(f"{'.'.join(map(str, x['loc'])) or 'model'}: {x['msg']}" for x in e.errors())
            problems.append(f"row {n}: {msgs}")
    return ok, problems

rows = [
    {"id": " 4812 ", "email": "Ana@ACME.com ", "subject": "Charged twice on Pro plan",
     "priority": "P1", "tags": "billing, refund", "created_at": "2026-10-14T09:12:00Z",
     "crm_internal_field": "ignored"},
    {"id": "4813", "email": "not-an-email", "subject": "Hi", "priority": "urgent",
     "created_at": "2026-10-14T10:00:00Z"},
    {"id": 4814, "email": "raj@globex.io", "subject": "Export fails with 500",
     "created_at": "2026-10-14T09:12:00Z", "due_at": "2026-10-13T09:00:00Z"},
]

tickets, problems = import_rows(rows)
print(f"imported {len(tickets)} of {len(rows)}")
print(tickets[0].model_dump_json())
for p in problems:
    print(p)
print("schema fields:", list(Ticket.model_json_schema()["properties"]))`
  },
  lab: {
    title: 'Validate a model\u2019s refund tool call before executing it', file: 'refund_guard.py', browser: true,
    scenario: `<p>A support agent built on an LLM can issue refunds through a tool. The model sends arguments as a JSON string. Last week it sent an amount in dollars instead of cents, plus an unexpected <code class="i">"approve": true</code> field. You are adding the guard that runs <b>before</b> any money moves.</p>`,
    steps: [
      'Define <code class="i">RefundRequest</code> with <code class="i">ticket_id</code> (int &gt; 0), <code class="i">amount_cents</code> (int, 1 to 50,000), <code class="i">currency</code> (USD, EUR or INR) and <code class="i">reason</code> (10 to 500 chars).',
      'Forbid extra fields and use strict mode so <code class="i">"4800"</code> as a string is rejected.',
      'Write <code class="i">parse_tool_call(raw: str)</code> returning either the model or a list of short error strings a model can act on.',
      'Run the four sample payloads and check that exactly one passes.',
      'Stretch: add a rule that INR refunds above 20,000 cents need <code class="i">reason</code> to mention a manager.'
    ],
    checks: ['Payload 1 passes and prints a typed object.', 'Payloads 2–4 print one line per problem, naming the field.', 'No refund function is ever called with an invalid request.'],
    hints: ['<code class="i">ConfigDict(strict=True, extra="forbid")</code> covers two requirements at once.', '<code class="i">RefundRequest.model_validate_json(raw)</code> parses and validates in one step and handles bad JSON too.', 'Format errors with <code class="i">".".join(map(str, e["loc"]))</code>.'],
    starter: String.raw`from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError

class RefundRequest(BaseModel):
    # TODO: strict mode + forbid extra fields
    ticket_id: int
    amount_cents: int
    currency: str
    reason: str

def parse_tool_call(raw: str) -> "RefundRequest | list[str]":
    # TODO: validate raw JSON, return the model or a list of "field: message" strings
    ...

payloads = [
    '{"ticket_id": 4812, "amount_cents": 4800, "currency": "USD", "reason": "Duplicate charge on 14 Oct"}',
    '{"ticket_id": 4812, "amount_cents": 48.0, "currency": "USD", "reason": "Duplicate charge on 14 Oct", "approve": true}',
    '{"ticket_id": "4812", "amount_cents": 4800, "currency": "usd", "reason": "dup"}',
    '{"ticket_id": 4812, "amount_cents": 900000, "currency": "EUR"',
]
for p in payloads:
    print(parse_tool_call(p))`,
    solution: String.raw`from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError

class RefundRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    ticket_id: int = Field(gt=0)
    amount_cents: int = Field(ge=1, le=50_000)
    currency: Literal["USD", "EUR", "INR"]
    reason: str = Field(min_length=10, max_length=500)

def parse_tool_call(raw: str) -> "RefundRequest | list[str]":
    try:
        return RefundRequest.model_validate_json(raw)
    except ValidationError as e:
        return [f"{'.'.join(map(str, x['loc'])) or 'json'}: {x['msg']}" for x in e.errors()]

payloads = [
    '{"ticket_id": 4812, "amount_cents": 4800, "currency": "USD", "reason": "Duplicate charge on 14 Oct"}',
    '{"ticket_id": 4812, "amount_cents": 48.0, "currency": "USD", "reason": "Duplicate charge on 14 Oct", "approve": true}',
    '{"ticket_id": "4812", "amount_cents": 4800, "currency": "usd", "reason": "dup"}',
    '{"ticket_id": 4812, "amount_cents": 900000, "currency": "EUR"',
]
for p in payloads:
    result = parse_tool_call(p)
    if isinstance(result, RefundRequest):
        print("OK  ", result)
    else:
        print("FAIL", result)`
  },
  design: {
    lead: '<p>At scale, validation is both a reliability feature and a cost. Pydantic v2\u2019s core is written in Rust, so validating JSON is cheap compared with the network call that produced it. The design questions are where to validate, how strict to be, and how to keep schemas in sync across services and models.</p>',
    scale: [{ h: 'Validate JSON directly', p: '<code class="i">model_validate_json(bytes)</code> parses and validates in one pass and is faster than <code class="i">json.loads</code> followed by <code class="i">model_validate</code>.' }, { h: 'Reuse adapters for bulk data', p: 'For a list of 100k rows build one <code class="i">TypeAdapter(list[Ticket])</code> once and reuse it instead of re-creating validators in a loop.' }],
    fail: [{ h: 'Silent coercion', p: 'Lax mode turns <code class="i">"1"</code> into <code class="i">1</code> and may accept values you meant to reject. Machine-to-machine payloads deserve strict mode.' }, { h: 'Schema drift', p: 'A downstream service or a prompt still expects the old field name. Version schemas, and generate the tool schema from the model instead of hand-writing it.' }],
    trade: [{ h: 'Strict vs lax', p: 'Strict catches upstream bugs early but breaks on harmless variations in customer data. Common split: lax for imports, strict for internal APIs and tool calls.' }, { h: 'Validate everywhere vs at edges', p: 'Re-validating at every function wastes CPU and hides where trust was established. Validate at process boundaries only.' }],
    prompt: '<p>A customer sends 2 million ticket rows per night from three regional CRMs with different date formats. Design the import so one bad row never blocks the batch and the customer can see what was rejected and why.</p>',
    answer: '<ul><li>Stream rows; validate each with one reused model and a per-region before-validator for dates.</li><li>Write good rows in batches; write rejects with row number, source file and the error list to a quarantine table.</li><li>Expose a reject report (counts by error type, sample rows) to the customer.</li><li>Alert when the reject rate jumps, which usually signals a schema change upstream.</li></ul>'
  },
  quiz: [
    { q: 'What does Python do at runtime with the hint <code class="i">def f(x: int)</code> when called as <code class="i">f("3")</code>?', o: ['Raises TypeError', 'Converts "3" to 3', 'Nothing: hints are not enforced at runtime', 'Logs a warning'], a: 2, why: 'Type hints are metadata for tools such as pyright or mypy. Runtime enforcement needs a library like Pydantic.' },
    { q: 'In Pydantic v2 lax mode, what happens to the input <code class="i">" 4812 "</code> for a field typed <code class="i">int</code>?', o: ['Validation error', 'It becomes 4812', 'It stays a string', 'It becomes None'], a: 1, why: 'Lax mode coerces numeric strings, ignoring surrounding whitespace. Strict mode would reject it.' },
    { q: 'Which tool checks a rule that spans two fields, such as <code class="i">due_at</code> after <code class="i">created_at</code>?', o: ['field_validator on due_at', 'model_validator(mode="after")', 'Field(gt=created_at)', 'A Literal type'], a: 1, why: 'An after-mode model validator runs once all fields are parsed, so it can compare them.' },
    { q: 'Why export <code class="i">model_json_schema()</code> in an AI system?', o: ['To speed up validation', 'To give a model the exact structure its output or tool arguments must follow', 'To create database tables', 'To encrypt payloads'], a: 1, why: 'Structured-output and tool-calling APIs accept a JSON Schema. Generating it from the model keeps code and prompt in sync.' }
  ],
  interview: [
    { q: 'Where would you validate data in an LLM agent that calls internal APIs?', a: '<p>At every trust boundary: incoming user requests, every tool call the model proposes before execution, and every response from external systems before it re-enters the context. Inside the service I pass typed objects. Tool-call validation errors go back to the model as a short correction so it can retry, with a retry cap.</p>' },
    { q: 'Dataclass or Pydantic model: how do you choose?', a: '<p>Dataclasses for internal value objects I construct myself: no runtime validation needed, minimal overhead. Pydantic at boundaries where data is untrusted or needs coercion, serialization or a JSON Schema.</p>' },
    { q: 'A customer import silently loaded wrong amounts for a month. What went wrong and how do you prevent it?', a: '<p>Likely lax coercion or a unit mismatch accepted without a rule, for example dollars parsed into a cents field. Prevent it with strict types for money (integers in minor units), explicit constraints, a quarantine table for rejects, and monitoring on the reject rate and value distributions per batch.</p>' }
  ]
});

/* ===================================================================== 0.2 */
L({
  id: '0.2', title: 'Concurrency with asyncio and httpx', minutes: 60, roles: ['fde', 'be'],
  tags: 'asyncio · gather · Semaphore · TaskGroup · timeouts · httpx.AsyncClient',
  mental: 'An LLM call is a wait measured in seconds. asyncio lets one process wait on hundreds of them at once, and a Semaphore makes sure you never ask a provider for more concurrent requests than it allows.',
  sim: 'fanout',
  intro: `<p>Classify 5,000 support tickets with a model whose calls take 600 ms each. One at a time, that is 50 minutes. With 20 calls in flight, it is about 2.5 minutes on the same laptop, because the CPU was idle almost the whole time, waiting on the network.</p>
  <p>This is the most common performance fix in AI backends, and the most common source of <b>429 Too Many Requests</b> incidents when done without a limit. FDEs hit it during backfills on customer data; AI backend engineers build it into every fan-out: RAG retrieval across shards, parallel tool calls, evaluation runs over thousands of cases.</p>`,
  points: [
    '<code class="i">async def</code> defines a coroutine; <code class="i">await</code> pauses it while the event loop runs other coroutines.',
    'Concurrency helps I/O-bound work (HTTP, databases, model calls). CPU-bound work such as tokenizing large corpora needs processes, not asyncio.',
    '<code class="i">asyncio.gather</code> or a <code class="i">TaskGroup</code> runs many coroutines together; without a limit, all of them start at once.',
    'An <code class="i">asyncio.Semaphore(n)</code> caps how many are in flight. Set it below the provider\u2019s concurrency or rate limit.',
    '<code class="i">asyncio.timeout()</code> (Python 3.11+) puts a deadline on a block of awaits so one slow call cannot hang a request.',
    'Share one <code class="i">httpx.AsyncClient</code> for the whole process: it reuses connections. Creating a client per call wastes a TLS handshake every time.'
  ],
  concept: { title: 'One waiter, many tables', body: `<p>The event loop is a single thread that keeps a list of coroutines. When a coroutine hits <code class="i">await</code> on I/O, it parks and the loop resumes another one that is ready. Nothing runs in parallel on the CPU; the gain comes from overlapping waits.</p><p>That gives two rules. Never call blocking functions such as <code class="i">time.sleep</code> or <code class="i">requests.get</code> inside a coroutine, because they freeze the only thread. And always bound fan-out, because the loop will happily open 10,000 connections if you ask it to.</p>` },
  walk: [
    { h: 'Sequential awaits add up', body: '<p>Awaiting in a for-loop waits for each call before starting the next, so total time is the sum.</p>', code: String.raw`import asyncio, time

async def fake_llm(i: int) -> str:
    await asyncio.sleep(0.2)          # stands in for a 200 ms model call
    return f"label-{i}"

async def main():
    t = time.perf_counter()
    out = [await fake_llm(i) for i in range(5)]
    print(out, f"{time.perf_counter() - t:.1f}s")

asyncio.run(main())`, run: true, browser: true },
    { h: 'gather overlaps the waits', body: '<p>Five 200 ms calls finish in about 200 ms. Results come back in input order, which matters when you zip them with the inputs.</p>', code: String.raw`import asyncio, time

async def fake_llm(i: int) -> str:
    await asyncio.sleep(0.2)
    return f"label-{i}"

async def main():
    t = time.perf_counter()
    out = await asyncio.gather(*(fake_llm(i) for i in range(5)))
    print(out, f"{time.perf_counter() - t:.1f}s")

asyncio.run(main())`, run: true, browser: true },
    { h: 'A Semaphore bounds the fan-out', body: '<p>Twelve calls with at most four in flight run as three waves. Peak concurrency never exceeds the limit, which is the property the provider cares about.</p>', code: String.raw`import asyncio, time

in_flight = peak = 0

async def fake_llm(i: int, sem: asyncio.Semaphore) -> str:
    global in_flight, peak
    async with sem:
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.2)
        in_flight -= 1
        return f"label-{i}"

async def main():
    sem = asyncio.Semaphore(4)
    t = time.perf_counter()
    out = await asyncio.gather(*(fake_llm(i, sem) for i in range(12)))
    print(len(out), "results, peak in flight =", peak, f"time {time.perf_counter() - t:.1f}s")

asyncio.run(main())`, run: true, browser: true },
    { h: 'TaskGroup and timeouts for structured concurrency', body: '<p>A <code class="i">TaskGroup</code> cancels its siblings if one task fails, so you never leak background tasks. <code class="i">asyncio.timeout</code> enforces a deadline across everything inside the block.</p>', code: String.raw`import asyncio

async def call(i: int, delay: float) -> int:
    await asyncio.sleep(delay)
    return i

async def main():
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(call(i, 0.1)) for i in range(3)]
    print([t.result() for t in tasks])

    try:
        async with asyncio.timeout(0.3):
            await call(99, 2.0)        # a stuck provider
    except TimeoutError:
        print("deadline hit, returning a fallback answer")

asyncio.run(main())`, run: true, browser: true }
  ],
  analogy: `<p><b>A restaurant waiter.</b> A bad waiter takes one table\u2019s order, walks to the kitchen, waits for the food, serves it, and only then greets the next table. A good waiter takes orders from every table while the kitchen cooks. That is <code class="i">gather</code>. But the kitchen only has eight burners, so a smart waiter never hands in more than eight orders at once. That is the <code class="i">Semaphore</code>, and the burners are the provider\u2019s rate limit.</p>`,
  diagram: {
    title: 'Bounded fan-out to a model provider', w: 820, h: 320,
    groups: [{ x: 196, y: 20, w: 330, h: 280, label: 'ONE PYTHON PROCESS' }],
    nodes: [
      { id: 'job', x: 20, y: 136, label: 'Batch job', sub: '5,000 tickets', info: 'A backfill or eval run produces thousands of independent calls.' },
      { id: 'loop', x: 216, y: 56, label: 'Event loop', sub: 'single thread', tone: 'acc', info: 'Switches between coroutines whenever one awaits I/O. CPU stays nearly idle.' },
      { id: 'sem', x: 216, y: 150, label: 'Semaphore(16)', sub: 'admission control', tone: 'be', info: 'At most 16 coroutines may hold a slot. The rest wait in line inside your process instead of at the provider.' },
      { id: 'client', x: 216, y: 236, label: 'AsyncClient', sub: 'shared pool', info: 'One httpx.AsyncClient with a connection pool and timeouts, shared by every coroutine.' },
      { id: 'tasks', x: 380, y: 150, w: 130, label: 'Coroutines', sub: '16 in flight', info: 'Each coroutine sends one request and awaits the response.' },
      { id: 'prov', x: 600, y: 110, w: 190, h: 64, label: 'LLM provider', sub: 'cap: 20 concurrent', tone: 'fde', info: 'Providers enforce request, token and concurrency limits per key. Exceeding them returns 429.' },
      { id: 'r429', x: 600, y: 236, w: 190, label: '429 Too Many Requests', tone: 'bad', info: 'What you get with an unbounded gather. Each 429 must be retried, adding load exactly when the provider is busy.' }
    ],
    edges: [
      { a: 'job', b: 'sem', label: 'submit', step: 1 }, { a: 'loop', b: 'tasks', dash: true, step: 2 }, { a: 'sem', b: 'tasks', label: 'acquire', step: 2 },
      { a: 'tasks', b: 'prov', label: 'HTTPS', step: 3 }, { a: 'client', b: 'tasks', dash: true, step: 3 }, { a: 'prov', b: 'r429', dash: true, label: 'over cap', step: 4 }
    ],
    steps: ['The job submits every call as a coroutine immediately.', 'Only 16 acquire the semaphore; the event loop interleaves them.', 'Requests share pooled connections to the provider.', 'Stay below the provider cap and 429s never happen; exceed it and they pile up.'],
    caption: 'Admission control inside your process keeps the provider below its limit.'
  },
  illustrated: { title: 'Backfill maths for 5,000 tickets', body: `<p>Average call latency 600 ms, provider limit 20 concurrent requests per key.</p>
    <div class="tbl"><table><thead><tr><th>strategy</th><th>in flight</th><th>wall time</th><th>429s</th><th>verdict</th></tr></thead><tbody>
    <tr><td>for-loop await</td><td class="n">1</td><td class="n">5,000 × 0.6 s = 50 min</td><td class="n">0</td><td>too slow</td></tr>
    <tr><td>gather, no limit</td><td class="n">5,000</td><td class="n">seconds, then retries</td><td class="n">≈ 4,980 on the first wave</td><td>incident</td></tr>
    <tr><td>Semaphore(16)</td><td class="n">16</td><td class="n">5,000 / 16 × 0.6 s ≈ 3.1 min</td><td class="n">0</td><td>ship it</td></tr></tbody></table></div>
    <p>The limit is set to 16, not 20, to leave headroom for other services sharing the same API key. Try the same trade-offs in the simulator below.</p>` },
  code: {
    title: 'Bounded, retrying fan-out with httpx', file: 'fanout.py', deps: 'uv add httpx',
    intro: '<p>A realistic batch classifier: one shared <code class="i">AsyncClient</code>, a semaphore, per-call timeouts, retries on 429 that honour <code class="i">Retry-After</code>, and results in input order. A mock transport plays the provider (20 ms latency, max 4 concurrent) so the script runs anywhere without keys.</p>',
    src: String.raw`import asyncio, random, time
import httpx

CAP = 4  # the fake provider rejects more than 4 concurrent requests
in_flight = 0

async def provider(request: httpx.Request) -> httpx.Response:
    global in_flight
    if in_flight >= CAP:
        return httpx.Response(429, headers={"retry-after": "0.05"}, json={"error": "rate_limited"})
    in_flight += 1
    try:
        await asyncio.sleep(0.02)
        ticket = request.url.params["ticket"]
        return httpx.Response(200, json={"ticket": ticket, "label": random.choice(["billing", "bug", "other"])})
    finally:
        in_flight -= 1

async def classify(client: httpx.AsyncClient, sem: asyncio.Semaphore, ticket: int, stats: dict) -> str:
    for attempt in range(5):
        async with sem:
            r = await client.get("/classify", params={"ticket": ticket})
        if r.status_code == 429:
            stats["429"] += 1
            backoff = float(r.headers.get("retry-after", "0.1")) * (2 ** attempt)
            await asyncio.sleep(random.uniform(0, backoff))    # full jitter, see lesson 1.7
            continue
        r.raise_for_status()
        return r.json()["label"]
    stats["failed"] += 1
    return "needs_retry"      # park it for a later pass instead of failing the batch

async def run(n: int, limit: int) -> None:
    random.seed(0)
    stats = {"429": 0, "failed": 0}
    sem = asyncio.Semaphore(limit)
    transport = httpx.MockTransport(provider)
    async with httpx.AsyncClient(transport=transport, base_url="https://llm.example",
                                 timeout=httpx.Timeout(5.0, connect=2.0)) as client:
        t = time.perf_counter()
        labels = await asyncio.gather(*(classify(client, sem, i, stats) for i in range(n)))
        dt = time.perf_counter() - t
    print(f"limit={limit:<3} labelled={len(labels) - stats['failed']:<3} gave_up={stats['failed']:<3} 429s={stats['429']:<4} ~{dt:.1f}s")

async def main():
    for limit in (1, 4, 50):
        await run(40, limit)

asyncio.run(main())`
  },
  lab: {
    title: 'Bounded fan-out with retries and a deadline', file: 'fanout_lab.py', browser: true,
    scenario: `<p>An eval run sends 30 prompts to a model. The fake provider below raises <code class="i">RateLimited</code> whenever more than 5 calls are in flight. Make the run finish with zero failures and inside a 2-second overall deadline, returning labels in input order.</p>`,
    steps: ['Run the starter as is and note how many calls fail with an unbounded gather.', 'Add an <code class="i">asyncio.Semaphore</code> so no more than 5 calls are in flight.', 'Wrap each call in a retry loop: on <code class="i">RateLimited</code>, wait 50 ms × 2^attempt and try again, at most 3 attempts.', 'Wrap the whole run in <code class="i">asyncio.timeout(2)</code> and print a clear message if it expires.', 'Print: results count, failures, peak in flight and elapsed time.'],
    checks: ['30 results, 0 failures.', 'Peak in flight is 5 or less.', 'Elapsed time is under 2 seconds.'],
    hints: ['The semaphore must wrap only the call itself, not the retry sleep, so a waiting retry does not hold a slot.', '<code class="i">asyncio.gather(*coros, return_exceptions=True)</code> lets you count failures without crashing the run.'],
    starter: String.raw`import asyncio, time

class RateLimited(Exception):
    pass

in_flight = peak = 0

async def fake_provider(i: int) -> str:
    global in_flight, peak
    if in_flight >= 5:
        raise RateLimited(f"call {i}")
    in_flight += 1
    peak = max(peak, in_flight)
    try:
        await asyncio.sleep(0.1)
        return f"label-{i % 3}"
    finally:
        in_flight -= 1

async def run_all(n: int) -> list:
    # TODO: bound concurrency, retry RateLimited with backoff, keep input order
    return await asyncio.gather(*(fake_provider(i) for i in range(n)), return_exceptions=True)

async def main():
    t = time.perf_counter()
    results = await run_all(30)
    fails = sum(isinstance(r, Exception) for r in results)
    print(f"results={len(results)} failures={fails} peak={peak} elapsed={time.perf_counter() - t:.2f}s")

asyncio.run(main())`,
    solution: String.raw`import asyncio, time

class RateLimited(Exception):
    pass

in_flight = peak = 0

async def fake_provider(i: int) -> str:
    global in_flight, peak
    if in_flight >= 5:
        raise RateLimited(f"call {i}")
    in_flight += 1
    peak = max(peak, in_flight)
    try:
        await asyncio.sleep(0.1)
        return f"label-{i % 3}"
    finally:
        in_flight -= 1

async def with_retry(i: int, sem: asyncio.Semaphore, attempts: int = 3) -> str:
    for attempt in range(attempts):
        try:
            async with sem:
                return await fake_provider(i)
        except RateLimited:
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(0.05 * 2 ** attempt)   # outside the semaphore

async def run_all(n: int, limit: int = 5) -> list:
    sem = asyncio.Semaphore(limit)
    return await asyncio.gather(*(with_retry(i, sem) for i in range(n)), return_exceptions=True)

async def main():
    t = time.perf_counter()
    try:
        async with asyncio.timeout(2):
            results = await run_all(30)
    except TimeoutError:
        print("deadline exceeded: return partial results and flag the run")
        return
    fails = sum(isinstance(r, Exception) for r in results)
    print(f"results={len(results)} failures={fails} peak={peak} elapsed={time.perf_counter() - t:.2f}s")
    print("first five:", results[:5])

asyncio.run(main())`
  },
  design: {
    lead: '<p>In production the limit is rarely one number. Providers meter requests per minute, tokens per minute and concurrent requests, per key and per model. Several services often share one key. The design work is turning those shared limits into admission control that every caller respects.</p>',
    scale: [{ h: 'Limit across processes', p: 'A Semaphore only protects one process. With 12 pods, use a shared limiter in Redis (Phase 1.5) or route all calls through a gateway (Phase 9.1).' }, { h: 'Budget tokens, not just requests', p: 'A 30k-token prompt costs as much quota as 30 small ones. Track estimated tokens per call and admit against the tokens-per-minute budget.' }],
    fail: [{ h: 'Blocking calls inside async code', p: 'One <code class="i">requests.get</code> or heavy JSON parse in a coroutine stalls every other request on that worker. Use async clients or <code class="i">asyncio.to_thread</code>.' }, { h: 'Leaked tasks', p: 'Fire-and-forget <code class="i">create_task</code> without keeping a reference can be garbage-collected or fail silently. Prefer TaskGroup.' }],
    trade: [{ h: 'Throughput vs tail latency', p: 'Higher concurrency raises throughput until the provider queues you, then p95 latency climbs. Tune the limit by watching p95, not just total time.' }, { h: 'asyncio vs threads vs processes', p: 'asyncio for many waits; threads to wrap blocking SDKs; processes for CPU-heavy steps such as PDF parsing.' }],
    prompt: '<p>You must re-embed 40 million document chunks over a weekend. The embedding API allows 3,000 requests per minute and 5 million tokens per minute per key, and you have two keys. Sketch the job.</p>',
    answer: '<ul><li>Token budget is the binding limit: 2 keys × 5M tokens/min. At 400 tokens per chunk that is 25k chunks/min, so about 27 hours: it fits the weekend.</li><li>Batch chunks per request to stay under 3,000 requests/min.</li><li>A queue of batches, workers with per-key token-bucket limiters, checkpoints after every batch so a crash resumes instead of restarting.</li><li>Track throughput, 429 rate and cost on a dashboard; alert if 429s exceed 1%.</li></ul>'
  },
  quiz: [
    { q: 'Why does <code class="i">gather</code> over five 200 ms <code class="i">asyncio.sleep</code> calls take about 200 ms instead of 1 s?', o: ['Python runs them on five CPU cores', 'The event loop overlaps the waits on one thread', 'asyncio caches the results', 'sleep is skipped inside gather'], a: 1, why: 'Concurrency on one thread: while one coroutine waits, others run. No parallel CPU work is involved.' },
    { q: 'You call <code class="i">time.sleep(2)</code> inside a coroutine in a FastAPI app. What happens?', o: ['Only that request waits', 'The whole worker stops serving every request for 2 s', 'asyncio converts it to asyncio.sleep', 'It raises an error'], a: 1, why: 'time.sleep blocks the single event-loop thread, freezing all coroutines on that worker.' },
    { q: 'The provider allows 20 concurrent requests per key, and two services share the key. A good Semaphore value for your service is:', o: ['20', '40', 'Below your share, such as 8 to 10', '1'], a: 2, why: 'Concurrency limits are per key, so your service gets a share of the cap, with headroom.' },
    { q: 'What does <code class="i">asyncio.TaskGroup</code> add over plain <code class="i">gather</code>?', o: ['Faster execution', 'Automatic retries', 'If one task fails, the others are cancelled and errors are raised together', 'It runs tasks in threads'], a: 2, why: 'Structured concurrency: no orphaned tasks, and failures propagate predictably as an ExceptionGroup.' }
  ],
  interview: [
    { q: 'How would you speed up a script that classifies 100k tickets with an LLM API, without getting rate-limited?', a: '<p>Make calls async with one shared client, bound concurrency with a semaphore sized from the provider\u2019s limits and our share of the key, retry 429 and 5xx with exponential backoff plus jitter honoring Retry-After, checkpoint progress so reruns skip completed items, and batch inputs where the API supports it. I would measure throughput and p95 latency while tuning the limit.</p>' },
    { q: 'When is asyncio the wrong tool?', a: '<p>For CPU-bound work such as parsing large PDFs, tokenizing a corpus or running a local model on CPU, because one thread cannot use more cores. Use a process pool or separate workers. Also when the only client library is blocking and cannot be replaced, wrap it with <code class="i">asyncio.to_thread</code> or use threads.</p>' },
    { q: 'Your async service\u2019s p99 latency spikes every few minutes with no traffic change. What do you check?', a: '<p>Something blocking the event loop: a synchronous call, a large JSON serialization, regex on huge strings, or a CPU-heavy step. Enable asyncio debug mode or slow-callback logging, profile with py-spy, and look for connection-pool exhaustion if the client limit is lower than the concurrency.</p>' }
  ]
});

/* ===================================================================== 0.3 */
L({
  id: '0.3', title: 'Project tooling: uv, pyproject, ruff', minutes: 40, roles: ['fde', 'be'],
  tags: 'uv · pyproject.toml · uv.lock · ruff · pyright · pre-commit',
  mental: 'A project is reproducible when someone else can clone it and get the identical environment with one command. In 2026 that command is uv sync, driven by pyproject.toml and a committed uv.lock.',
  intro: `<p>As an FDE you will open a customer\u2019s laptop, a locked-down VM or a CI runner you have never seen, and your code must behave exactly as it did on yours. As an AI backend engineer you ship services whose dependency trees include fast-moving SDKs: an unpinned minor version of an LLM client can change retry behaviour or response types overnight.</p>
  <p><b>uv</b>, from Astral, replaces pip, pip-tools, virtualenv and pyenv with one fast tool. <b>ruff</b>, from the same team, replaces flake8, isort and black. Together with a type checker they are the baseline any reviewer expects to see in a Python repo.</p>`,
  points: [
    '<code class="i">pyproject.toml</code> is the single source of truth: project metadata, dependencies, dependency groups and tool settings.',
    '<code class="i">uv add httpx</code> updates pyproject.toml and the lockfile together; <code class="i">uv sync</code> makes the environment match the lockfile exactly.',
    'Commit <code class="i">uv.lock</code>. It pins every transitive dependency with hashes, so CI and production install the same bytes.',
    '<code class="i">uv run &lt;cmd&gt;</code> runs inside the project environment without activating anything; <code class="i">uv python install 3.12</code> manages interpreters.',
    'Dev-only tools go in a dependency group (<code class="i">uv add --dev ruff pytest</code>) so they never ship in the production image.',
    'ruff lints and formats in milliseconds; run it in pre-commit and CI so style never reaches code review.'
  ],
  concept: { title: 'Declared intent, locked reality', body: `<p>pyproject.toml declares what you want, with ranges such as <code class="i">httpx&gt;=0.27</code>. uv.lock records what you actually got: exact versions and hashes for every package in the tree. Humans edit the first; tools write the second.</p><p>Deployments always install from the lock. Upgrades are deliberate: <code class="i">uv lock --upgrade-package httpx</code>, run the tests and evals, then commit the new lock in its own reviewed change.</p>` },
  walk: [
    { h: 'Create the project and pin Python', body: '<p>One command scaffolds the layout and a pinned interpreter version.</p>', lang: 'bash', file: 'terminal', code: String.raw`uv init triage-service --package --python 3.12
cd triage-service
uv add "fastapi>=0.115" "httpx>=0.27" "pydantic>=2.10"
uv add --dev ruff pytest pytest-asyncio pyright
uv run python -c "import fastapi, sys; print(fastapi.__version__, sys.version.split()[0])"` },
    { h: 'Read the resulting pyproject.toml', body: '<p>Runtime dependencies live under <code class="i">[project]</code>; dev tools under <code class="i">[dependency-groups]</code>; tool configuration under <code class="i">[tool.*]</code>.</p>', lang: 'toml', file: 'pyproject.toml', code: String.raw`[project]
name = "triage-service"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "httpx>=0.27",
    "pydantic>=2.10",
]

[dependency-groups]
dev = ["ruff>=0.7", "pytest>=8", "pytest-asyncio>=0.24", "pyright>=1.1.380"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "ASYNC", "S"]

[tool.pytest.ini_options]
asyncio_mode = "auto"` },
    { h: 'Lint and format with ruff', body: '<p>The <code class="i">ASYNC</code> rules catch blocking calls inside coroutines, the bug from lesson 0.2. <code class="i">S</code> (bandit rules) flags security smells such as hard-coded passwords and tokens, <code class="i">shell=True</code> and unsafe YAML loading.</p>', lang: 'bash', file: 'terminal', code: String.raw`uv run ruff check .          # lint
uv run ruff check . --fix    # auto-fix safe issues (imports, pyupgrade)
uv run ruff format .         # format like black
uv run pyright               # type-check` },
    { h: 'Gate commits with pre-commit', body: '<p>Hooks run on staged files before each commit, so CI rarely fails on trivia.</p>', lang: 'yaml', file: '.pre-commit-config.yaml', code: String.raw`repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.7.4
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format` },
    { h: 'Install exactly the lock in CI and Docker', body: '<p><code class="i">--frozen</code> fails if the lock is out of date instead of silently resolving new versions; <code class="i">--no-dev</code> keeps test tools out of production images.</p>', lang: 'bash', file: 'terminal', code: String.raw`uv sync --frozen            # CI: exact lock, includes dev group
uv sync --frozen --no-dev   # production image: runtime deps only
uv lock --upgrade-package httpx   # deliberate upgrade, reviewed in its own PR` }
  ],
  analogy: `<p><b>A recipe and a shopping receipt.</b> pyproject.toml is the recipe: \u201c2 eggs, any brand\u201d. uv.lock is the receipt from the exact shop: \u201cFarm Fresh large eggs, batch 1142\u201d. To cook the identical dish in another kitchen, you shop from the receipt, not the recipe.</p>`,
  diagram: {
    title: 'From pyproject to reproducible environments', w: 820, h: 300,
    nodes: [
      { id: 'dev', x: 20, y: 120, label: 'Developer', sub: 'uv add / uv lock', info: 'Edits intent (pyproject.toml) through uv commands; never hand-edits the lock.' },
      { id: 'pp', x: 220, y: 50, label: 'pyproject.toml', sub: 'declared ranges', tone: 'acc', info: 'Metadata, dependency ranges, groups and tool config. Reviewed by humans.' },
      { id: 'lock', x: 220, y: 190, label: 'uv.lock', sub: 'exact + hashes', tone: 'be', info: 'Every transitive package pinned with hashes. Machine-written, committed to git.' },
      { id: 'git', x: 420, y: 120, label: 'Git repo', sub: 'both committed', info: 'Code, pyproject.toml and uv.lock travel together in every commit.' },
      { id: 'ci', x: 630, y: 30, label: 'CI runner', sub: 'uv sync --frozen', tone: 'ok', info: 'Installs the exact lock plus dev tools, then runs ruff, pyright and pytest.' },
      { id: 'img', x: 630, y: 120, label: 'Docker image', sub: '--frozen --no-dev', tone: 'ok', info: 'Runtime dependencies only, byte-identical to what CI tested.' },
      { id: 'cust', x: 630, y: 210, label: 'Customer VM', sub: 'uv sync --frozen', tone: 'fde', info: 'The FDE case: the same command recreates the same environment in a customer network, often from a mirror.' }
    ],
    edges: [{ a: 'dev', b: 'pp', step: 1 }, { a: 'dev', b: 'lock', label: 'uv lock', step: 1 }, { a: 'pp', b: 'git', step: 2 }, { a: 'lock', b: 'git', step: 2 }, { a: 'git', b: 'ci', step: 3 }, { a: 'git', b: 'img', step: 3 }, { a: 'git', b: 'cust', step: 3 }],
    steps: ['The developer changes dependencies through uv, which updates both files.', 'Both files are committed together.', 'Every environment installs from the lock, never from the ranges.'],
    caption: 'Intent is reviewed; reality is locked; every environment installs the lock.'
  },
  illustrated: { title: 'The overnight SDK upgrade', body: `<p>A team pinned <code class="i">openai&gt;=1.0</code> without a lockfile. A new minor release changed a default timeout. Their nightly Docker build picked it up; long summarization calls started failing at 02:00.</p>
    <div class="tbl"><table><thead><tr><th>setup</th><th>what the 02:00 build installed</th><th>outcome</th></tr></thead><tbody>
    <tr><td>ranges only, no lock</td><td>newest matching release</td><td>behaviour change ships untested</td></tr>
    <tr><td>committed uv.lock, <code class="i">uv sync --frozen</code></td><td>the exact version CI tested</td><td>nothing changes until someone upgrades on purpose</td></tr></tbody></table></div>
    <p>The real output on the Code tab shows ruff catching a blocking <code class="i">time.sleep</code> inside an async function, an unused import and a hard-coded token before review.</p>` },
  code: {
    title: 'ruff catching real bugs in an async handler', file: 'terminal', lang: 'bash', deps: 'uv add --dev ruff',
    intro: '<p>A small but realistic file with three problems: a blocking sleep inside a coroutine, an unused import, and a hard-coded API token. ruff\u2019s ASYNC, F and S rules catch all three, plus an import-order nit. The S105 rule works from variable names, so a secret stored as <code class="i">X = "sk-..."</code> slips through: keep a real secret scanner such as gitleaks or GitHub push protection as well. Output from a real run.</p>',
    files: {
      'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 110\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "ASYNC", "S"]\n',
      'handler.py': 'import os\nimport time\nimport httpx\n\nAPI_TOKEN = "sk-live-1234567890abcdef"\n\n\nasync def classify(text: str) -> str:\n    time.sleep(0.5)  # wait for the rate limiter\n    async with httpx.AsyncClient() as client:\n        r = await client.post("https://llm.example/v1", json={"q": text}, headers={"x-key": API_TOKEN})\n    return r.json()["label"]\n'
    },
    src: String.raw`cat handler.py
ruff check . --output-format concise || true`
  },
  lab: {
    title: 'Make the triage repo reproducible', file: 'pyproject.toml', lang: 'toml', run: false,
    scenario: `<p>You inherit a repo with a <code class="i">requirements.txt</code> containing unpinned names, no lockfile, and a README that says \u201cinstall stuff then run app.py\u201d. The customer\u2019s security team will only allow builds from a lockfile. Convert it.</p>`,
    setup: String.raw`curl -LsSf https://astral.sh/uv/install.sh | sh     # or: pipx install uv
mkdir triage-lab && cd triage-lab
printf "fastapi\nhttpx\npydantic\nrequests\n" > requirements.txt`,
    steps: ['Run <code class="i">uv init --package</code> and import the requirements with <code class="i">uv add -r requirements.txt</code>.', 'Remove <code class="i">requests</code> if nothing needs it, and add ruff, pytest and pyright to the dev group.', 'Configure ruff with the E, F, I, B, UP, ASYNC and S rule sets.', 'Commit <code class="i">uv.lock</code>, then prove reproducibility: delete <code class="i">.venv</code> and run <code class="i">uv sync --frozen</code>.', 'Add a pre-commit config and a short README section titled \u201cRun it\u201d with exactly three commands.'],
    checks: ['A fresh clone runs tests with <code class="i">uv sync --frozen && uv run pytest</code>.', '<code class="i">uv sync --frozen --no-dev</code> installs no test tools.', 'ruff passes with the configured rules.'],
    hints: ['<code class="i">uv tree</code> shows why a package is installed.', '<code class="i">uv export --format requirements-txt</code> regenerates a pinned requirements file if a legacy system needs one.'],
    starter: String.raw`[project]
name = "triage-lab"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

# TODO: dependency-groups, [tool.ruff], [tool.pytest.ini_options]`,
    solution: String.raw`[project]
name = "triage-lab"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "httpx>=0.27",
    "pydantic>=2.10",
]

[dependency-groups]
dev = ["ruff>=0.7", "pytest>=8", "pytest-asyncio>=0.24", "pyright>=1.1.380", "pre-commit>=4"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "ASYNC", "S"]
ignore = ["S101"]          # allow assert in tests

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.pyright]
pythonVersion = "3.12"
typeCheckingMode = "standard"`
  },
  design: {
    lead: '<p>Tooling decisions compound across a team and across customer deployments. The questions at scale are how upgrades flow, how builds stay fast, and how you install inside networks that cannot reach PyPI.</p>',
    scale: [{ h: 'Workspaces for monorepos', p: 'uv workspaces share one lock across several packages (api, worker, shared models), so they never drift apart.' }, { h: 'Cache in CI and Docker', p: 'Mount uv\u2019s cache in Docker builds and cache it in CI; a warm sync takes seconds.' }],
    fail: [{ h: 'Air-gapped customers', p: 'Many regulated customers block PyPI. Mirror wheels into their Artifactory or Nexus, or ship a wheelhouse built from the lock.' }, { h: 'Lock drift', p: 'Someone edits pyproject.toml by hand and forgets to relock; <code class="i">--frozen</code> in CI makes that fail loudly.' }],
    trade: [{ h: 'Tight vs loose ranges', p: 'Libraries keep wide ranges for compatibility; applications rely on the lock and keep ranges loose so upgrades are easy.' }, { h: 'Automated upgrade PRs', p: 'Renovate or Dependabot keeps the lock fresh, but every LLM-SDK bump should also run your eval suite, not just unit tests.' }],
    prompt: '<p>Your team ships the same agent to 30 enterprise customers, each in its own VPC, three of them air-gapped. How do you manage dependencies and upgrades?</p>',
    answer: '<ul><li>One lockfile per release; build one image per release from it.</li><li>Air-gapped sites get the image or a wheelhouse pushed into their registry.</li><li>Upgrades happen centrally: bump, run tests plus evals, cut a release, roll out in rings.</li><li>Record the release version per customer so incidents can be reproduced exactly.</li></ul>'
  },
  quiz: [
    { q: 'Which file guarantees CI installs exactly the versions you tested?', o: ['pyproject.toml', 'uv.lock', 'requirements.in', '.python-version'], a: 1, why: 'The lock pins every transitive package with hashes; pyproject only declares ranges.' },
    { q: 'What does <code class="i">uv sync --frozen</code> do if pyproject.toml changed but uv.lock was not updated?', o: ['Silently resolves new versions', 'Fails, because the lock is out of date', 'Deletes the lock', 'Installs only dev tools'], a: 1, why: 'Frozen means use the lock as-is and refuse to resolve, so drift is caught.' },
    { q: 'Which ruff rule family flags <code class="i">time.sleep</code> inside an <code class="i">async def</code>?', o: ['E', 'F', 'ASYNC', 'I'], a: 2, why: 'The ASYNC rules (from flake8-async) detect blocking calls inside coroutines.' }
  ],
  interview: [
    { q: 'How do you make a Python service build reproducibly across dev, CI and production?', a: '<p>Declare dependencies in pyproject.toml, commit a lockfile with hashes, install with a frozen sync everywhere, pin the Python version, and build the production image from the same lock without dev groups. Upgrades are explicit PRs that run tests and evals.</p>' },
    { q: 'A customer\u2019s network cannot reach PyPI. How do you deploy?', a: '<p>Build wheels for the target platform from the lock into a wheelhouse, or push a container image to their registry. If they run Artifactory or Nexus, point uv at that index. Verify hashes so their security team can audit exactly what was installed.</p>' }
  ]
});

/* ===================================================================== 0.4 */
L({
  id: '0.4', title: 'Testing with pytest and fakes', minutes: 55, roles: ['fde', 'be'],
  tags: 'pytest · fixtures · parametrize · fakes · dependency injection · pytest-asyncio',
  mental: 'Tests pin down behaviour so you can change prompts, models and code without fear. Never call a real model in unit tests: inject a fake client and assert on what your code does with its answers, including the bad ones.',
  intro: `<p>LLM features fail in ways classic code does not: the model returns malformed JSON, picks a label outside your set, times out, or answers differently tomorrow. Unit tests cannot judge answer quality (that is Phase 7, evals). They can prove that <b>your code</b> handles every shape of answer correctly, deterministically, in milliseconds.</p>
  <p>Interviewers in both roles probe this directly: \u201chow do you test code that calls an LLM?\u201d The strong answer separates deterministic code (unit tests with fakes), integration (a few tests against a sandbox) and quality (evals).</p>`,
  points: [
    'Write plain functions named <code class="i">test_*</code> with bare <code class="i">assert</code>; pytest rewrites asserts to show the values on failure.',
    'Fixtures (<code class="i">@pytest.fixture</code>) build reusable setup, such as a fake client or a temporary database, and are injected by argument name.',
    '<code class="i">@pytest.mark.parametrize</code> runs one test over many cases, which is ideal for routing rules and edge inputs.',
    'Depend on an interface (a <code class="i">Protocol</code>), not a vendor SDK; tests pass a fake that implements the same method.',
    'Test the unhappy paths: malformed JSON, unknown labels, timeouts and rate limits. That is where production incidents live.',
    'Use <code class="i">pytest-asyncio</code> for coroutines and <code class="i">respx</code> or <code class="i">httpx.MockTransport</code> to fake HTTP at the transport layer.'
  ],
  concept: { title: 'Fakes at the seam', body: `<p>A <b>seam</b> is the place where your code meets something you do not control: the model provider, the clock, the network. Put an interface there and your code becomes testable: production passes the real client, tests pass a fake that returns scripted answers.</p><p>Prefer fakes (small working implementations) over deep mocks of a vendor SDK. Mocks that mirror every SDK call break whenever the SDK changes and mostly test that you called the SDK, not that your logic is correct.</p>` },
  walk: [
    { h: 'Define the seam as a Protocol', body: '<p>Anything with a matching <code class="i">complete</code> method satisfies it: the real SDK wrapper in production, a fake in tests.</p>', code: String.raw`from typing import Protocol

class LLM(Protocol):
    async def complete(self, prompt: str) -> str: ...` },
    { h: 'Write code against the seam with a safe fallback', body: '<p>The classifier validates the model\u2019s output and falls back to a safe label instead of crashing or trusting garbage.</p>', code: String.raw`import json

LABELS = {"billing", "bug", "other"}

async def classify(llm: "LLM", text: str) -> str:
    raw = await llm.complete(f"Label this ticket as billing, bug or other. JSON only.\n{text}")
    try:
        label = json.loads(raw)["label"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return "other"
    return label if label in LABELS else "other"` },
    { h: 'A fake that scripts answers', body: '<p>The fake records prompts so tests can also assert on what was sent.</p>', code: String.raw`class FakeLLM:
    def __init__(self, *answers: str):
        self.answers = list(answers)
        self.prompts: list[str] = []

    async def complete(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.answers.pop(0)` },
    { h: 'Parametrize over good and bad answers', body: '<p>Five cases, one test function. Each case documents a real failure mode.</p>', code: String.raw`import pytest

@pytest.mark.parametrize("answer, expected", [
    ('{"label": "billing"}', "billing"),
    ('{"label": "Bug"}', "other"),          # case mismatch is not silently accepted
    ('not json at all', "other"),
    ('{"category": "bug"}', "other"),       # wrong key
    ('{"label": "refund"}', "other"),       # outside the label set
])
async def test_classify_handles_model_output(answer, expected):
    assert await classify(FakeLLM(answer), "charged twice") == expected` }
  ],
  analogy: `<p><b>A flight simulator.</b> Pilots do not practise engine failures on a real aircraft. The simulator has the same cockpit (the interface) and can produce any failure on demand, every time, safely. Your fake LLM is the simulator: same method, scripted failures, no cost, no randomness.</p>`,
  diagram: {
    title: 'The testing pyramid for LLM features', w: 820, h: 320,
    nodes: [
      { id: 'unit', x: 40, y: 230, w: 230, h: 60, label: 'Unit tests · hundreds', sub: 'fakes · ms · every commit', tone: 'ok', info: 'Deterministic logic: parsing, routing, validation, fallbacks, retries. Fake LLM and fake clock. Run on every commit.' },
      { id: 'int', x: 80, y: 130, w: 150, h: 60, label: 'Integration · few', sub: 'sandbox API · nightly', tone: 'acc', info: 'A handful of tests against a real sandbox key or a local model, to catch SDK and auth changes. Tolerant assertions.' },
      { id: 'eval', x: 110, y: 40, w: 90, h: 56, label: 'Evals', sub: 'Phase 7', tone: 'be', info: 'Quality on a labelled dataset, scored by metrics or judges. Measures the model and prompt, not your plumbing.' },
      { id: 'code', x: 430, y: 60, label: 'classify()', sub: 'your logic', info: 'Depends only on the LLM protocol.' },
      { id: 'proto', x: 430, y: 160, label: 'LLM Protocol', sub: 'the seam', tone: 'acc', info: 'The interface: async complete(prompt) -> str.' },
      { id: 'real', x: 620, y: 110, label: 'Real client', sub: 'production', tone: 'fde', info: 'Wraps the vendor SDK with timeouts and retries.' },
      { id: 'fake', x: 620, y: 230, label: 'FakeLLM', sub: 'tests', tone: 'ok', info: 'Returns scripted answers, records prompts.' }
    ],
    edges: [{ a: 'code', b: 'proto', label: 'depends on' }, { a: 'real', b: 'proto', dash: true }, { a: 'fake', b: 'proto', dash: true }],
    caption: 'Left: how many tests of each kind. Right: the seam that makes the bottom layer possible; dashed arrows mean \u201cimplements\u201d.'
  },
  illustrated: { title: 'The bug the fake caught', body: `<p>A team\u2019s classifier used <code class="i">json.loads(raw)["label"]</code> with no fallback. In production, about 0.4% of responses wrapped JSON in a Markdown code fence. At 200,000 tickets a day that was 800 crashed requests daily, each retried, doubling cost for those tickets.</p>
    <div class="tbl"><table><thead><tr><th>model answer</th><th>before</th><th>after the fix and test</th></tr></thead><tbody>
    <tr><td class="n">{"label": "bug"}</td><td>bug</td><td>bug</td></tr>
    <tr><td class="n">\`\`\`json {"label": "bug"} \`\`\`</td><td>JSONDecodeError → 500</td><td>other, logged for review</td></tr>
    <tr><td class="n">{"label": "Refund"}</td><td>"Refund" stored, breaks reports</td><td>other</td></tr></tbody></table></div>
    <p>One parametrized test with these inputs would have caught it before release.</p>` },
  code: {
    title: 'A tested classifier with fakes and async tests', file: 'terminal', lang: 'bash', deps: 'uv add --dev pytest pytest-asyncio',
    intro: '<p>Two files and a real pytest run: parametrized unhappy paths, a fixture, prompt assertions, a timeout path using a fake that sleeps, and <code class="i">pytest.raises</code>. The output below is captured from an actual run.</p>',
    files: {
      'triage.py': 'import asyncio\nimport json\nfrom typing import Protocol\n\nLABELS = {"billing", "bug", "other"}\n\n\nclass LLM(Protocol):\n    async def complete(self, prompt: str) -> str: ...\n\n\nasync def classify(llm: LLM, text: str, timeout: float = 2.0) -> str:\n    if not text.strip():\n        raise ValueError("empty ticket")\n    prompt = f"Label this ticket as billing, bug or other. Reply as JSON.\\n{text}"\n    try:\n        async with asyncio.timeout(timeout):\n            raw = await llm.complete(prompt)\n    except TimeoutError:\n        return "other"\n    raw = raw.strip().removeprefix("```json").removesuffix("```").strip()\n    try:\n        label = json.loads(raw)["label"]\n    except (json.JSONDecodeError, KeyError, TypeError):\n        return "other"\n    return label if label in LABELS else "other"\n',
      'test_triage.py': 'import asyncio\nimport pytest\nfrom triage import classify\n\n\nclass FakeLLM:\n    def __init__(self, *answers: str, delay: float = 0.0):\n        self.answers = list(answers)\n        self.delay = delay\n        self.prompts: list[str] = []\n\n    async def complete(self, prompt: str) -> str:\n        self.prompts.append(prompt)\n        await asyncio.sleep(self.delay)\n        return self.answers.pop(0)\n\n\n@pytest.fixture\ndef billing_llm():\n    return FakeLLM(\'{"label": "billing"}\')\n\n\n@pytest.mark.parametrize("answer, expected", [\n    (\'{"label": "billing"}\', "billing"),\n    (\'```json\\n{"label": "bug"}\\n```\', "bug"),\n    (\'{"label": "Bug"}\', "other"),\n    ("not json", "other"),\n    (\'{"category": "bug"}\', "other"),\n    (\'{"label": "refund"}\', "other"),\n])\nasync def test_model_output_shapes(answer, expected):\n    assert await classify(FakeLLM(answer), "charged twice") == expected\n\n\nasync def test_prompt_contains_ticket_text(billing_llm):\n    await classify(billing_llm, "Invoice 991 charged twice")\n    assert "Invoice 991 charged twice" in billing_llm.prompts[0]\n\n\nasync def test_slow_model_falls_back():\n    slow = FakeLLM(\'{"label": "bug"}\', delay=0.5)\n    assert await classify(slow, "export broken", timeout=0.05) == "other"\n\n\nasync def test_empty_ticket_rejected(billing_llm):\n    with pytest.raises(ValueError, match="empty"):\n        await classify(billing_llm, "   ")\n',
      'pyproject.toml': '[tool.pytest.ini_options]\nasyncio_mode = "auto"\n'
    },
    src: String.raw`python -m pytest -q -p no:cacheprovider 2>&1 | tail -n 3
python -m pytest -q -p no:cacheprovider --collect-only 2>&1 | head -n 6`
  },
  lab: {
    title: 'Test a router you did not write', file: 'test_router.py', browser: true,
    scenario: `<p>A teammate wrote <code class="i">route()</code>, which decides whether a ticket goes to the model, to a human, or straight to the billing system. It has at least two bugs. Write tests that expose them, then fix the function. The starter runs your tests with a tiny built-in runner so it works in the browser; locally you can run it with pytest unchanged.</p>`,
    steps: ['Read <code class="i">route()</code> and list the rules it is supposed to follow (in the docstring).', 'Write one test per rule, including the boundary values 0, 499 and 500 for <code class="i">amount_cents</code> overrides.', 'Run the tests and note which fail.', 'Fix <code class="i">route()</code> until every test passes.', 'Add a test for an unknown language code, which must go to a human.'],
    checks: ['At least six tests.', 'All tests pass after your fix.', 'Each test name says which rule it checks.'],
    hints: ['Watch the comparison operators at the 500-cent boundary.', 'Check what happens to VIP customers whose ticket is also a refund.'],
    starter: String.raw`def route(ticket: dict) -> str:
    """Rules:
    1. refunds of 500 cents or more go to "human"
    2. refunds under 500 cents go to "billing_api"
    3. VIP customers always go to "human"
    4. non-English tickets (lang != "en") go to "human"
    5. everything else goes to "llm"
    """
    if ticket.get("refund_cents", 0) > 500:
        return "human"
    if ticket.get("refund_cents", 0) > 0:
        return "billing_api"
    if ticket.get("vip"):
        return "human"
    if ticket.get("lang", "en") != "en":
        return "human"
    return "llm"

# ---- your tests ----
def test_small_refund_goes_to_billing():
    assert route({"refund_cents": 499}) == "billing_api"

# ---- tiny runner (pytest finds the same tests locally) ----
fails = 0
for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        try:
            fn(); print("PASS", name)
        except AssertionError as e:
            fails += 1; print("FAIL", name, e)
print("failures:", fails)`,
    solution: String.raw`def route(ticket: dict) -> str:
    """Rules:
    1. refunds of 500 cents or more go to "human"
    2. refunds under 500 cents go to "billing_api"
    3. VIP customers always go to "human"
    4. non-English tickets (lang != "en") go to "human"
    5. everything else goes to "llm"
    """
    if ticket.get("vip"):                      # bug 2: VIP must win over refunds
        return "human"
    refund = ticket.get("refund_cents", 0)
    if refund >= 500:                          # bug 1: 500 itself is a human refund
        return "human"
    if refund > 0:
        return "billing_api"
    if ticket.get("lang", "en") != "en":
        return "human"
    return "llm"

def test_refund_at_500_goes_to_human():
    assert route({"refund_cents": 500}) == "human"

def test_small_refund_goes_to_billing():
    assert route({"refund_cents": 499}) == "billing_api"

def test_zero_refund_is_not_billing():
    assert route({"refund_cents": 0}) == "llm"

def test_vip_refund_goes_to_human():
    assert route({"refund_cents": 100, "vip": True}) == "human"

def test_non_english_goes_to_human():
    assert route({"lang": "hi"}) == "human"

def test_unknown_language_goes_to_human():
    assert route({"lang": "xx"}) == "human"

def test_plain_ticket_goes_to_llm():
    assert route({"subject": "how do I export?"}) == "llm"

fails = 0
for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        try:
            fn(); print("PASS", name)
        except AssertionError as e:
            fails += 1; print("FAIL", name, e)
print("failures:", fails)`
  },
  design: {
    lead: '<p>A healthy LLM codebase has hundreds of fast deterministic tests, a few integration tests against real providers, and a separate eval suite for quality. Mixing these layers creates slow, flaky suites that teams learn to ignore.</p>',
    scale: [{ h: 'Run fast tests on every commit', p: 'Unit tests with fakes should finish in seconds. Mark slow or networked tests and run them nightly or before release.' }, { h: 'Record and replay', p: 'For integration tests, record real provider responses once (VCR-style cassettes) and replay them, refreshing on purpose.' }],
    fail: [{ h: 'Flaky tests from real models', p: 'Asserting on exact model wording in unit tests guarantees flakes. Assert on structure and your code\u2019s decisions instead.' }, { h: 'Mocking the SDK too deeply', p: 'Tests that mirror every SDK call break on SDK upgrades and test nothing about your logic.' }],
    trade: [{ h: 'Fakes vs mocks', p: 'Fakes take a few more lines but survive refactors; mocks are quick but brittle. Use mocks for verifying a single interaction, fakes for behaviour.' }, { h: 'Coverage vs value', p: '100% line coverage of glue code is less valuable than one test per known failure mode of the model output.' }],
    prompt: '<p>An FDE deployment calls three customer systems and a model. Tests currently hit the customer\u2019s staging APIs and fail whenever staging is down. Redesign the test strategy.</p>',
    answer: '<ul><li>Introduce a seam per external system; unit tests use fakes for all four.</li><li>Contract tests validate our fakes against recorded staging responses, refreshed weekly.</li><li>A small smoke suite runs against staging, separately from CI gating.</li><li>Quality of model answers moves to an eval suite with a fixed dataset.</li></ul>'
  },
  quiz: [
    { q: 'Why should unit tests avoid calling a real LLM API?', o: ['APIs forbid it', 'Results are slow, cost money and vary run to run, so tests flake', 'pytest cannot do async', 'It leaks the prompt'], a: 1, why: 'Unit tests must be fast and deterministic. Quality of answers is measured separately with evals.' },
    { q: 'What does <code class="i">@pytest.mark.parametrize</code> give you?', o: ['Parallel execution', 'One test function run over many input cases', 'Retries for flaky tests', 'Fixtures shared across files'], a: 1, why: 'Each tuple becomes its own test case with its own pass or fail.' },
    { q: 'The best thing to assert when testing code that consumes a model\u2019s answer is:', o: ['The exact wording of the answer', 'That your code makes the right decision for each answer shape, including malformed ones', 'That the SDK was called once', 'Token counts'], a: 1, why: 'You own the decisions your code makes, not the model\u2019s wording.' }
  ],
  interview: [
    { q: 'How do you test a feature that depends on an LLM?', a: '<p>Three layers. Unit tests with a fake client cover parsing, validation, routing, fallbacks and retries, including malformed outputs and timeouts. A few integration tests run against a sandbox or recorded responses to catch SDK and auth changes. An eval suite measures answer quality on a labelled dataset and gates prompt and model changes.</p>' },
    { q: 'A test passes locally and fails in CI one run in ten. How do you approach it?', a: '<p>Look for hidden nondeterminism: real network calls, time, randomness without a seed, ordering of dicts or async tasks, shared state between tests. Reproduce by running it in a loop with the same seed, then inject the clock, seed the RNG or isolate state. Never just add a retry to the test.</p>' }
  ]
});

/* ===================================================================== 0.5 */
L({
  id: '0.5', title: 'Git workflow and code review', minutes: 45, roles: ['fde', 'be'],
  tags: 'branches · commits · rebase · bisect · revert · pull requests',
  mental: 'Git is your undo button and your team\u2019s communication channel. Small, focused commits on short-lived branches, reviewed in pull requests, are how a customer learns to trust the changes you push into their environment.',
  intro: `<p>An FDE often works inside a customer\u2019s Git server (GitHub Enterprise, GitLab, Azure DevOps) with their branch protection rules and their reviewers. An AI backend engineer changes code, prompts and configs that all alter behaviour, so knowing exactly which commit changed what is how incidents get resolved in minutes instead of days.</p>
  <p>This lesson covers the commands you actually use under pressure: inspecting history, cleaning up a branch before review, reverting a bad change safely, and bisecting to find which commit broke something.</p>`,
  points: [
    'One logical change per commit, with a message that says why, not just what. Prompts and configs are code: commit them the same way.',
    'Short-lived feature branches off <code class="i">main</code>, merged through a pull request with at least one reviewer and green CI.',
    '<code class="i">git rebase -i</code> squashes and rewords your own unpublished commits; never rewrite history others have pulled.',
    '<code class="i">git revert &lt;sha&gt;</code> undoes a published commit by adding a new one, which is safe on shared branches.',
    '<code class="i">git bisect run &lt;test&gt;</code> binary-searches history for the commit that broke a test: 1,000 commits take about 10 steps.',
    'Never commit secrets. If one leaks, rotate the key first; removing it from history comes second.'
  ],
  concept: { title: 'History is a debugging tool', body: `<p>Clean history is not about neatness. When an eval score drops on Thursday, you want <code class="i">git log</code> to show \u201cprompt: ask for JSON output\u201d as its own commit, so you can revert exactly that change and nothing else, or bisect straight to it.</p><p>A commit that mixes a prompt tweak, a dependency bump and a refactor is impossible to revert safely and impossible to review well.</p>` },
  walk: [
    { h: 'Branch, commit, push', body: '<p>Conventional prefixes such as <code class="i">feat:</code>, <code class="i">fix:</code> and <code class="i">prompt:</code> make history scannable.</p>', lang: 'bash', file: 'terminal', code: String.raw`git switch -c feat/refund-guard
git add refund_guard.py tests/test_refund_guard.py
git commit -m "feat: validate refund tool calls before execution"
git push -u origin feat/refund-guard` },
    { h: 'Inspect what changed and why', body: '<p>These four answer most \u201cwho changed this\u201d questions.</p>', lang: 'bash', file: 'terminal', code: String.raw`git log --oneline --graph -15
git show <sha> --stat
git log -p -S "temperature" -- prompts/      # commits that added or removed the word
git blame -L 40,60 app/triage.py` },
    { h: 'Clean up before review', body: '<p>Squash \u201cfix typo\u201d and \u201cwip\u201d commits into the commit they belong to. Use <code class="i">--fixup</code> while working, then autosquash.</p>', lang: 'bash', file: 'terminal', code: String.raw`git commit --fixup=<sha-of-original>
git rebase -i --autosquash origin/main
git push --force-with-lease     # safe force: refuses if someone else pushed` },
    { h: 'Undo safely on a shared branch', body: '<p>Revert creates a new commit that inverts the bad one. History stays intact and everyone can pull.</p>', lang: 'bash', file: 'terminal', code: String.raw`git revert <bad-sha> -m "revert: prompt change dropped eval score from 0.91 to 0.78"
git push` },
    { h: 'Find the breaking commit automatically', body: '<p>Give bisect a good and bad commit and a command that exits 0 for good. It does the search.</p>', lang: 'bash', file: 'terminal', code: String.raw`git bisect start
git bisect bad HEAD
git bisect good v1.4.0
git bisect run python -m pytest -q tests/test_routing.py
git bisect reset` }
  ],
  analogy: `<p><b>A lab notebook.</b> A good scientist writes one experiment per page, dated, with what was changed and why. When a result cannot be reproduced months later, the notebook shows exactly which change made the difference. Messy notebooks with five changes per page make that impossible. Commits are the pages.</p>`,
  diagram: {
    title: 'Trunk-based flow with pull requests', w: 820, h: 300,
    nodes: [
      { id: 'main', x: 20, y: 130, w: 140, label: 'main', sub: 'protected', tone: 'acc', info: 'Always deployable. Direct pushes blocked; merges only through reviewed PRs with green checks.' },
      { id: 'br', x: 220, y: 40, label: 'feat/refund-guard', sub: 'short-lived', info: 'One feature, one to three days. Rebased on main before review.' },
      { id: 'pr', x: 420, y: 40, label: 'Pull request', sub: 'review + CI', tone: 'be', info: 'A reviewer reads the diff; CI runs ruff, pyright, pytest and, for prompt changes, the eval subset.' },
      { id: 'ci', x: 420, y: 150, label: 'CI checks', sub: 'lint · tests · evals', tone: 'ok', info: 'Required status checks gate the merge button.' },
      { id: 'merge', x: 620, y: 40, label: 'Squash merge', sub: 'one commit on main', info: 'One clean commit per PR keeps main easy to revert and bisect.' },
      { id: 'deploy', x: 620, y: 150, label: 'Deploy', sub: 'tagged release', tone: 'fde', info: 'Main is tagged and deployed; the tag ties a running version to an exact commit.' },
      { id: 'rev', x: 220, y: 230, label: 'git revert', sub: 'fast rollback', tone: 'bad', info: 'If a release misbehaves, revert the merge commit on main and redeploy.' }
    ],
    edges: [{ a: 'main', b: 'br', label: 'branch', step: 1 }, { a: 'br', b: 'pr', label: 'push', step: 2 }, { a: 'pr', b: 'ci', step: 2 }, { a: 'pr', b: 'merge', label: 'approved', step: 3 }, { a: 'merge', b: 'deploy', step: 4 }, { a: 'deploy', b: 'rev', dash: true, label: 'regression', step: 5 }, { a: 'rev', b: 'main', dash: true, step: 5 }],
    steps: ['Branch from main for one change.', 'Push and open a PR; CI runs required checks.', 'After approval, squash-merge to main.', 'Tag and deploy main.', 'If something regresses, revert on main and redeploy.'],
    caption: 'Short branches, required checks, squash merges, revert to roll back.'
  },
  illustrated: { title: 'Bisecting a routing regression', body: `<p>The Code tab builds a real repository with six commits. One of them silently breaks the 500-cent refund rule from lesson 0.4. <code class="i">git bisect run</code> finds it automatically by running the test at each step.</p>
    <div class="tbl"><table><thead><tr><th>commits in range</th><th>bisect steps needed</th></tr></thead><tbody><tr><td class="n">8</td><td class="n">3</td></tr><tr><td class="n">100</td><td class="n">7</td></tr><tr><td class="n">1,000</td><td class="n">10</td></tr></tbody></table></div>
    <p>Each step halves the range, so the number of steps grows with log₂ of the commit count.</p>` },
  code: {
    title: 'A real repository, a regression, and git bisect run', file: 'terminal', lang: 'bash',
    intro: '<p>This script creates a repo, makes six commits (one of which breaks a rule), then lets bisect find the culprit. Author and dates are fixed so the hashes are reproducible.</p>',
    src: String.raw`export GIT_AUTHOR_NAME=Ana GIT_AUTHOR_EMAIL=ana@example.com GIT_COMMITTER_NAME=Ana GIT_COMMITTER_EMAIL=ana@example.com
export GIT_AUTHOR_DATE="2026-10-01T10:00:00Z" GIT_COMMITTER_DATE="2026-10-01T10:00:00Z"
git init -q -b main repo && cd repo
commit() { git add -A && git commit -q -m "$1"; }

printf 'def route(c):\n    return "human" if c >= 500 else "billing_api"\n' > router.py
printf 'from router import route\nassert route(500) == "human"\nassert route(499) == "billing_api"\n' > check.py
commit "feat: refund router"
git tag v1.0
echo "# triage" > README.md;                       commit "docs: readme"
echo 'TIMEOUT = 30' > config.py;                   commit "chore: add config"
sed -i 's/c >= 500/c > 500/' router.py;            commit "refactor: simplify comparison"
echo 'MODEL = "small"' >> config.py;               commit "config: switch model"
echo "Run: uv run app" >> README.md;               commit "docs: run instructions"

git log --oneline --graph
git bisect start HEAD v1.0 >/dev/null
git bisect run python3 check.py 2>/dev/null | grep -E "is the first bad commit|^commit|^    "
git bisect reset >/dev/null`
  },
  lab: {
    title: 'Rescue a messy branch', file: 'rescue.sh', lang: 'bash', run: false,
    scenario: `<p>A teammate\u2019s branch has seven commits: \u201cwip\u201d, \u201cfix\u201d, \u201cprompt v2\u201d, \u201cfix again\u201d, \u201cbump httpx\u201d, \u201cprompt v3\u201d and \u201cremove debug\u201d. Review is blocked because nobody can tell what changed. A customer also reports that a prompt change from last week is producing longer answers. Clean the branch and roll back only the prompt.</p>`,
    setup: String.raw`mkdir rescue && cd rescue && git init -b main
# create the messy branch yourself with 7 small commits touching prompts/, app/ and pyproject.toml`,
    steps: ['Use <code class="i">git log --oneline main..HEAD</code> to list the branch commits.', 'Interactive-rebase into three commits: one for code, one for the dependency bump, one for the prompt.', 'Push with <code class="i">--force-with-lease</code>.', 'On main, find last week\u2019s prompt commit with <code class="i">git log -- prompts/</code> and revert only that commit.', 'Write PR descriptions that explain why for each of the three commits.'],
    checks: ['The branch has exactly three commits with clear messages.', 'main has a revert commit that touches only files under prompts/.', 'No force-push to main ever happened.'],
    hints: ['In the rebase todo list, change <code class="i">pick</code> to <code class="i">fixup</code> for commits that should melt into the one above them.', '<code class="i">git revert --no-edit &lt;sha&gt;</code> skips the editor.'],
    starter: String.raw`# 1. inspect
git log --oneline main..HEAD

# 2. squash into 3 commits
git rebase -i main

# 3. publish safely
# TODO

# 4. roll back only the prompt on main
# TODO`,
    solution: String.raw`# 1. inspect
git log --oneline main..HEAD

# 2. squash into 3 commits: in the editor reorder and mark
#    pick  wip            -> pick   (rename to "feat: ...")
#    fixup fix / fix again / remove debug
#    pick  bump httpx     -> pick   "chore(deps): bump httpx to 0.28"
#    pick  prompt v2      -> pick   "prompt: ask for JSON with citations"
#    fixup prompt v3
git rebase -i main

# 3. publish safely
git push --force-with-lease

# 4. roll back only the prompt on main
git switch main && git pull
git log --oneline -5 -- prompts/
git revert --no-edit <prompt-sha>
git push`
  },
  design: {
    lead: '<p>For AI systems, \u201cwhat is deployed\u201d includes code, prompt files, model versions and retrieval settings. Git becomes the audit log for all of them, which regulated customers increasingly require.</p>',
    scale: [{ h: 'Branch protection as policy', p: 'Required reviewers, required checks and signed commits turn team norms into enforced rules, which auditors like.' }, { h: 'CODEOWNERS', p: 'Route prompt changes to the people who own evals, and infrastructure changes to platform owners, automatically.' }],
    fail: [{ h: 'Leaked secrets', p: 'Keys pushed even once are compromised. Rotate first, then scrub with git filter-repo; enable secret scanning and push protection.' }, { h: 'Long-lived branches', p: 'A branch open for three weeks conflicts with everything. Merge small and often, using feature flags for unfinished work.' }],
    trade: [{ h: 'Squash vs merge commits', p: 'Squash keeps main linear and easy to revert; merge commits keep branch detail. Most product teams squash.' }, { h: 'Prompts in Git vs a registry', p: 'Git gives review and history; a prompt registry (Phase 10.2) allows changes without a deploy. Many teams keep the source in Git and publish to the registry from CI.' }],
    prompt: '<p>A bank requires that every change to a production AI assistant is reviewed, traceable to a ticket, and reversible within 15 minutes. Describe the Git setup.</p>',
    answer: '<ul><li>Protected main, required review from CODEOWNERS, required CI including the eval gate.</li><li>Commit messages or PR titles reference the ticket ID, enforced by a check.</li><li>Every deploy is a tag; rollback is a revert or a redeploy of the previous tag, rehearsed.</li><li>Prompts and configs live in the repo so they follow the same rules.</li></ul>'
  },
  quiz: [
    { q: 'You pushed a bad commit to a shared main branch. The safest undo is:', o: ['git reset --hard and force-push', 'git revert the commit', 'Delete the branch', 'Edit the file and amend'], a: 1, why: 'Revert adds an inverse commit without rewriting history that others have pulled.' },
    { q: 'About how many test runs does git bisect need to search 1,000 commits?', o: ['1,000', '100', 'About 10', '2'], a: 2, why: 'Binary search: log₂(1000) is about 10.' },
    { q: 'What does <code class="i">--force-with-lease</code> protect against?', o: ['Overwriting commits someone else pushed since your last fetch', 'Pushing secrets', 'Merge conflicts', 'Unsigned commits'], a: 0, why: 'It refuses to overwrite the remote if it changed since you last saw it.' }
  ],
  interview: [
    { q: 'An eval score dropped after this week\u2019s release. How do you find the cause?', a: '<p>Diff the release tags to list what changed: code, prompts, model version, retrieval config. If several changed, bisect using the eval subset as the test command, or revert candidates one at a time in staging. Clean single-purpose commits make this fast, which is why prompts and configs belong in version control.</p>' },
    { q: 'How do you keep a pull request easy to review?', a: '<p>Keep it small and single-purpose, explain why in the description, include test evidence or eval numbers, split refactors from behaviour changes, and clean up fixup commits before requesting review.</p>' }
  ]
});

/* ===================================================================== 0.6 */
L({
  id: '0.6', title: 'Linux and shell for engineers', minutes: 45, roles: ['fde', 'be'],
  tags: 'pipes · grep · awk · jq · processes · ports · disk · env',
  mental: 'In a customer\u2019s environment you often get SSH and a terminal before you get dashboards. Pipes let you answer questions about logs, processes and networks in one line.',
  intro: `<p>On day two of an FDE engagement the pilot breaks, and the customer\u2019s observability stack will not be connected for a week. You have SSH into a VM and a 2 GB log file. Being able to answer \u201cwhen did errors start, for which tenant, on which endpoint\u201d in two minutes with <code class="i">grep</code>, <code class="i">jq</code> and <code class="i">sort | uniq -c</code> is what earns trust in the room.</p>
  <p>AI backend engineers need the same skills on containers and GPU nodes: is the process alive, which port is it listening on, is the disk full of model weights, what environment variables did it actually start with.</p>`,
  points: [
    'Small tools joined by pipes: each reads lines on stdin and writes lines on stdout.',
    'Structured JSON logs + <code class="i">jq</code> beat regex. Ask for JSON logs in every service you build.',
    '<code class="i">sort | uniq -c | sort -rn | head</code> is the universal \u201ctop N\u201d pattern.',
    'Processes: <code class="i">ps aux</code>, <code class="i">top</code> or <code class="i">htop</code>, <code class="i">kill -TERM</code> before <code class="i">-KILL</code>. Ports: <code class="i">ss -ltnp</code>. Disk: <code class="i">df -h</code> and <code class="i">du -sh * | sort -h</code>.',
    'Check the environment a running process really has with <code class="i">cat /proc/&lt;pid&gt;/environ | tr \'\\0\' \'\\n\'</code>, which settles \u201cbut I set the variable\u201d debates.',
    '<code class="i">curl -sS -w \'%{http_code} %{time_total}\\n\'</code> times an endpoint from inside the network, separating network problems from app problems.'
  ],
  concept: { title: 'Ask the logs a question', body: `<p>Start every investigation with a question, then build the pipeline one stage at a time: filter the lines that matter, extract the field you care about, group and count, sort. Each stage is checkable on its own by stopping the pipe there and looking at the output.</p>` },
  walk: [
    { h: 'Filter, then extract', body: '<p>Select error lines, then pull out only the field you need.</p>', lang: 'bash', file: 'terminal', code: String.raw`grep '"status": 429' app.log | head -3
jq -r 'select(.status >= 500) | .endpoint' app.log | sort | uniq -c | sort -rn` },
    { h: 'Group by time to find when it started', body: '<p>Cut the timestamp to the minute and count. The first minute with a jump is your start time.</p>', lang: 'bash', file: 'terminal', code: String.raw`jq -r 'select(.status == 429) | .ts[0:16]' app.log | uniq -c` },
    { h: 'Rank tenants by cost', body: '<p>jq can aggregate too: group, sum and sort in one expression.</p>', lang: 'bash', file: 'terminal', code: String.raw`jq -s 'group_by(.tenant) | map({tenant: .[0].tenant, tokens: (map(.tokens) | add)}) | sort_by(-.tokens)' app.log` },
    { h: 'Check the machine', body: '<p>The usual suspects when a service dies: disk full, port taken, wrong environment, out of memory.</p>', lang: 'bash', file: 'terminal', code: String.raw`df -h /                         # disk
ss -ltnp | grep 8000            # who listens on 8000
ps aux --sort=-%mem | head -5   # memory hogs
dmesg -T | grep -i "killed process" | tail -3   # OOM killer
tr '\0' '\n' < /proc/$(pgrep -f uvicorn | head -1)/environ | grep -E 'MODEL|URL'` }
  ],
  analogy: `<p><b>A water treatment line.</b> Raw water (the log) flows through a series of filters, each doing one job: remove sand (grep), separate what you want (jq or cut), measure (uniq -c), rank (sort). You can tap the line after any filter and inspect the water, which is exactly how you debug a pipeline.</p>`,
  diagram: {
    title: 'Anatomy of a log pipeline', w: 820, h: 220,
    nodes: [
      { id: 'log', x: 16, y: 80, w: 120, label: 'app.log', sub: 'JSON lines', info: 'One JSON object per line: ts, tenant, endpoint, status, latency_ms, tokens.' },
      { id: 'f', x: 166, y: 80, w: 120, label: 'filter', sub: 'jq select()', tone: 'acc', info: 'Keep only lines that matter, such as status 429.' },
      { id: 'x', x: 316, y: 80, w: 120, label: 'extract', sub: '.ts[0:16]', tone: 'acc', info: 'Pull out one field per line, here the timestamp truncated to the minute.' },
      { id: 'g', x: 466, y: 80, w: 120, label: 'count', sub: 'uniq -c', tone: 'acc', info: 'Collapse identical adjacent lines into counts. Input must be sorted, or already grouped by time.' },
      { id: 's', x: 616, y: 80, w: 120, label: 'rank', sub: 'sort -rn | head', tone: 'acc', info: 'Biggest first, top N only.' },
      { id: 'ans', x: 666, y: 160, w: 140, h: 40, label: 'answer', tone: 'ok', info: 'A number you can say out loud to the customer.' }
    ],
    edges: [{ a: 'log', b: 'f', label: '|', step: 1 }, { a: 'f', b: 'x', label: '|', step: 2 }, { a: 'x', b: 'g', label: '|', step: 3 }, { a: 'g', b: 's', label: '|', step: 4 }, { a: 's', b: 'ans', step: 5 }],
    steps: ['Read lines and keep only the relevant ones.', 'Extract the field you are grouping by.', 'Count occurrences.', 'Sort to rank.', 'Read the answer, then refine the question.'],
    caption: 'Each stage is testable on its own: stop the pipe there and look.'
  },
  illustrated: { title: 'Two minutes into an incident', body: `<p>The Code tab generates 2,000 log lines from a realistic incident and answers four questions with one-liners. The output is real.</p>
    <div class="tbl"><table><thead><tr><th>question</th><th>tool</th></tr></thead><tbody>
    <tr><td>How many requests were rate-limited?</td><td>jq select + wc -l</td></tr>
    <tr><td>When did 429s start?</td><td>jq timestamp slice + uniq -c</td></tr>
    <tr><td>Which tenant is causing it?</td><td>jq group_by and add</td></tr>
    <tr><td>What is p95 latency for successful calls?</td><td>jq + sort -n + awk</td></tr></tbody></table></div>` },
  code: {
    title: 'Incident triage on a real log with jq and coreutils', file: 'terminal', lang: 'bash',
    intro: '<p>A small seeded generator writes the log; everything after it is plain shell. Copy the generator to reproduce locally.</p>',
    files: { 'gen.py': 'import json, random\nrandom.seed(42)\ntenants = ["acme", "globex", "initech", "umbrella"]\nfor i in range(2000):\n    minute = i // 100\n    tenant = random.choice(tenants)\n    status = 200\n    if minute >= 12 and tenant == "globex" and random.random() < 0.7:\n        status = 429\n    elif random.random() < 0.01:\n        status = 500\n    lat = int(random.lognormvariate(6.3, 0.35)) if status == 200 else random.randint(5, 40)\n    toks = random.randint(300, 2400) if status == 200 else 0\n    if tenant == "globex" and minute >= 10:\n        toks *= 3\n    print(json.dumps({"ts": f"2026-10-24T09:{minute:02d}:{(i % 100) * 0.6:04.1f}", "tenant": tenant, "endpoint": random.choice(["/triage", "/summarize"]), "status": status, "latency_ms": lat, "tokens": toks}))\n' },
    src: String.raw`python3 gen.py > app.log
echo "lines: $(wc -l < app.log)"

echo "--- 429s total"
jq 'select(.status == 429)' -c app.log | wc -l

echo "--- 429s per minute (first rows)"
jq -r 'select(.status == 429) | .ts[0:16]' app.log | uniq -c | head -4

echo "--- 429s by tenant"
jq -r 'select(.status == 429) | .tenant' app.log | sort | uniq -c | sort -rn

echo "--- tokens by tenant"
jq -s -c 'group_by(.tenant) | map({tenant: .[0].tenant, tokens: (map(.tokens) | add)}) | sort_by(-.tokens) | .[]' app.log

echo "--- p95 latency of 200s (ms)"
jq 'select(.status == 200) | .latency_ms' app.log | sort -n | awk '{a[NR]=$1} END {print a[int(NR*0.95)]}'`
  },
  lab: {
    title: 'Write the five-line incident note', file: 'triage.sh', lang: 'bash', run: false,
    scenario: `<p>Use the same generator from the Code tab (it is deterministic). The customer\u2019s VP asks: what happened, since when, who is affected, is it us or the provider, and what do we do now? Answer with shell only, then write a five-line note.</p>`,
    setup: String.raw`# save gen.py from the Code tab, then
python3 gen.py > app.log`,
    steps: ['Find the first minute where 429s exceed 10 per minute.', 'Show that one tenant accounts for nearly all 429s.', 'Show that the same tenant\u2019s token usage tripled two minutes before the 429s began.', 'Compute p95 latency for successful calls before and after the incident started.', 'Write the note: impact, start time, cause, scope, next action.'],
    checks: ['Every claim in the note comes from a command you can paste.', 'The note is five lines and contains numbers, not adjectives.'],
    hints: ['Filter on <code class="i">.ts &lt; "2026-10-24T09:12"</code> for the before window; jq compares strings lexicographically.', 'Token tripling for one tenant suggests a client-side change on their side, such as a new long prompt, rather than a provider fault.'],
    starter: String.raw`# when did 429s exceed 10/minute?
jq -r 'select(.status == 429) | .ts[0:16]' app.log | uniq -c | awk '$1 > 10' | head -1

# who?
# TODO

# tokens per tenant per minute, globex only
# TODO

# p95 before vs after 09:12
# TODO`,
    solution: String.raw`# when did 429s exceed 10/minute?
jq -r 'select(.status == 429) | .ts[0:16]' app.log | uniq -c | awk '$1 > 10' | head -1

# who?
jq -r 'select(.status == 429) | .tenant' app.log | sort | uniq -c | sort -rn

# tokens per minute for globex
jq -r 'select(.tenant == "globex") | [.ts[0:16], .tokens] | @tsv' app.log \
  | awk '{s[$1]+=$2} END {for (m in s) print m, s[m]}' | sort | sed -n '8,14p'

# p95 before vs after 09:12
for w in before after; do
  if [ "$w" = before ]; then f='.ts < "2026-10-24T09:12"'; else f='.ts >= "2026-10-24T09:12"'; fi
  printf "%s p95: " "$w"
  jq "select(.status == 200 and ($f)) | .latency_ms" app.log | sort -n | awk '{a[NR]=$1} END {print a[int(NR*0.95)]}'
done

# note
# 09:12 UTC: globex requests began failing with 429 (rate limited).
# Scope: globex only; other tenants unaffected, p95 latency unchanged.
# Cause: globex token usage tripled from 09:10, exhausting its quota.
# Not a provider outage: 200s keep flowing for all other tenants.
# Next: confirm the globex prompt change, raise or split its quota, add a per-tenant alert.`
  },
  design: {
    lead: '<p>Shell skills are the fallback when platforms are missing. The design lesson is to make services that are easy to inspect this way: structured logs, health endpoints, and configuration that can be read from the running process.</p>',
    scale: [{ h: 'Structured logs first', p: 'JSON lines with request_id, tenant, model, tokens and latency make jq answers trivial and feed straight into log platforms later.' }, { h: 'Sample big files', p: 'On multi-GB logs, use <code class="i">tail -n 200000</code> or <code class="i">awk \'NR % 10 == 0\'</code> to explore before running the full scan.' }],
    fail: [{ h: 'Unparseable logs', p: 'Free-text logs with stack traces across lines break line tools. Log exceptions as one JSON line with the trace in a field.' }, { h: 'Logging secrets or PII', p: 'Prompt text often contains customer data. Redact before logging; you will be grepping these files in front of the customer.' }],
    trade: [{ h: 'One-liners vs scripts', p: 'One-liners for exploration; once a question is asked twice, save it as a script in the runbook.' }, { h: 'Local vs central logs', p: 'Local files are always there; central platforms are searchable across machines. Ship both, but never depend only on the central one.' }],
    prompt: '<p>Design the logging format for a new LLM service so that an FDE with only SSH can answer cost, latency and error questions in under five minutes.</p>',
    answer: '<ul><li>JSON lines, UTC ISO timestamps, one event per request.</li><li>Fields: request_id, tenant, endpoint, model, prompt_version, status, latency_ms, ttft_ms, input_tokens, output_tokens, cost_usd, error_type.</li><li>No raw prompt text by default; a redacted sample flag for debugging.</li><li>Rotated files with a predictable path, plus the same events shipped to the central platform.</li></ul>'
  },
  quiz: [
    { q: 'Which pipeline gives the top 5 most frequent endpoints in a list of lines?', o: ['uniq -c | sort | head -5', 'sort | uniq -c | sort -rn | head -5', 'sort -rn | uniq | head -5', 'head -5 | sort | uniq -c'], a: 1, why: 'uniq only collapses adjacent duplicates, so sort first, count, then sort by count descending.' },
    { q: 'A service will not start: \u201caddress already in use\u201d. Which command shows who owns port 8000?', o: ['df -h', 'ss -ltnp', 'du -sh', 'dmesg'], a: 1, why: 'ss lists listening TCP sockets with the owning process.' },
    { q: 'The process restarts silently and dmesg shows \u201cKilled process\u201d. The likely cause is:', o: ['A Python exception', 'The kernel OOM killer', 'A full disk', 'A bad deploy tag'], a: 1, why: 'The out-of-memory killer terminates processes and logs it in the kernel ring buffer.' }
  ],
  interview: [
    { q: 'You have SSH and a 5 GB log. Users say \u201cit\u2019s slow since this morning\u201d. Walk me through it.', a: '<p>Confirm the symptom with numbers: p50 and p95 latency per 10-minute bucket. Find the change point. Split by endpoint, tenant and model to see whether it is global or scoped. Check machine health at that time: CPU, memory, disk, OOM kills. Correlate with deploys or config changes. Then state impact, scope, start time and a hypothesis, and pick the cheapest test of it.</p>' },
    { q: 'Why do you insist on JSON logs?', a: '<p>Machines query them reliably: jq on a VM today, the log platform tomorrow. Fields are explicit, multiline traces stay in one record, and adding a field never breaks parsers.</p>' }
  ]
});

/* ===================================================================== 0.7 */
L({
  id: '0.7', title: 'SQL for AI engineers: CTEs, windows, plans', minutes: 60, roles: ['fde', 'be'],
  tags: 'CTEs · window functions · top-N per group · EXPLAIN · indexes',
  mental: 'Most enterprise AI questions start as SQL: which tickets, which customers, how many tokens. CTEs name each step, window functions compare rows without collapsing them, and EXPLAIN tells you why a query is slow.',
  sim: 'window',
  intro: `<p>FDE job descriptions list SQL fluency, including window functions, CTEs and query optimization on large datasets, right next to Python. The reason is practical: discovery with a customer usually starts with \u201cshow me the data\u201d, and the data lives in Snowflake, BigQuery, Databricks or Postgres.</p>
  <p>AI backend engineers write the same queries over their own telemetry: cost per tenant per day, the most expensive conversations, retry rates by model. This lesson uses SQLite so everything runs in your browser; the syntax is identical in Postgres and very close in the warehouses.</p>`,
  points: [
    'A CTE (<code class="i">WITH name AS (...)</code>) names an intermediate result. Chain several to make a long query readable top to bottom.',
    'Window functions (<code class="i">... OVER (PARTITION BY x ORDER BY y)</code>) add a computed column to every row without collapsing rows like GROUP BY does.',
    'Top N per group: <code class="i">ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY cost DESC)</code>, then filter on the row number in an outer query.',
    'Running totals and moving averages: <code class="i">SUM(x) OVER (ORDER BY day)</code> and <code class="i">AVG(x) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)</code>.',
    '<code class="i">LAG</code> and <code class="i">LEAD</code> compare a row with its neighbour: day-over-day change, time between retries.',
    '<code class="i">EXPLAIN</code> shows the plan. A full scan on a large table filtered by a selective column is the classic sign of a missing index.'
  ],
  concept: { title: 'Rows stay, context is added', body: `<p>GROUP BY answers \u201cone number per group\u201d and throws the detail away. A window function answers \u201cfor each row, what is the number for its group, or its rank, or its neighbour\u201d, and keeps every row. That is why windows solve the questions customers actually ask: \u201cshow each ticket with its share of the tenant\u2019s spend\u201d, \u201cthe three most expensive calls per tenant\u201d, \u201cdays where usage jumped more than 50%\u201d.</p>` },
  walk: [
    { h: 'Name each step with a CTE', body: '<p>Daily totals first, then everything else reads from that named result.</p>', lang: 'sql', file: 'query.sql', code: String.raw`WITH daily AS (
  SELECT tenant, date(ts) AS day, SUM(cost_usd) AS cost
  FROM llm_calls
  GROUP BY tenant, date(ts)
)
SELECT * FROM daily ORDER BY tenant, day;` },
    { h: 'Running totals and moving averages', body: '<p>The frame clause controls which rows the window sees.</p>', lang: 'sql', file: 'query.sql', code: String.raw`SELECT tenant, day, cost,
       SUM(cost) OVER (PARTITION BY tenant ORDER BY day) AS month_to_date,
       AVG(cost) OVER (PARTITION BY tenant ORDER BY day
                       ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS avg_7d
FROM daily;` },
    { h: 'Top N per group', body: '<p>Rank inside each tenant, then keep ranks 1 to 3. You cannot filter on a window result in the same SELECT, hence the CTE.</p>', lang: 'sql', file: 'query.sql', code: String.raw`WITH ranked AS (
  SELECT tenant, ticket_id, SUM(cost_usd) AS cost,
         ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY SUM(cost_usd) DESC) AS rn
  FROM llm_calls
  GROUP BY tenant, ticket_id
)
SELECT tenant, ticket_id, cost FROM ranked WHERE rn <= 3;` },
    { h: 'Compare neighbours with LAG', body: '<p>Day-over-day change; flag jumps above 50%.</p>', lang: 'sql', file: 'query.sql', code: String.raw`SELECT tenant, day, cost,
       cost / LAG(cost) OVER (PARTITION BY tenant ORDER BY day) - 1 AS change
FROM daily;` },
    { h: 'Read the plan', body: '<p>In SQLite, <code class="i">EXPLAIN QUERY PLAN</code>; in Postgres, <code class="i">EXPLAIN ANALYZE</code>. SCAN means full table scan; SEARCH ... USING INDEX means the index is used.</p>', lang: 'sql', file: 'query.sql', code: String.raw`EXPLAIN QUERY PLAN
SELECT * FROM llm_calls WHERE tenant = 'acme' AND ts >= '2026-10-20';` }
  ],
  analogy: `<p><b>A class report card.</b> GROUP BY is the class average: one number, individual students gone. A window function writes on each student\u2019s own card \u201cyour rank in the class\u201d and \u201chow you changed since last term\u201d. Every student keeps their card; each card gains context from the others.</p>`,
  diagram: {
    title: 'How a window query is evaluated', w: 820, h: 270,
    nodes: [
      { id: 'from', x: 16, y: 110, w: 110, label: 'FROM', sub: 'llm_calls', info: 'Rows are read, using an index if the WHERE clause allows.' },
      { id: 'where', x: 146, y: 110, w: 110, label: 'WHERE', sub: 'filter rows', info: 'Row filters run before grouping and windows.' },
      { id: 'group', x: 276, y: 110, w: 120, label: 'GROUP BY', sub: 'optional', info: 'Collapses rows into groups; aggregates such as SUM are computed here.' },
      { id: 'win', x: 416, y: 110, w: 140, label: 'WINDOW', sub: 'partition + order', tone: 'acc', info: 'For each row, compute values over its partition: ranks, running sums, LAG. Rows are not collapsed.' },
      { id: 'sel', x: 576, y: 110, w: 100, label: 'SELECT', sub: 'project', info: 'Choose columns. Window results exist only now, which is why you cannot use them in WHERE.' },
      { id: 'outer', x: 696, y: 110, w: 110, label: 'outer query', sub: 'WHERE rn <= 3', tone: 'ok', info: 'Wrap in a CTE to filter on window results, such as top 3 per tenant.' }
    ],
    edges: [{ a: 'from', b: 'where', step: 1 }, { a: 'where', b: 'group', step: 2 }, { a: 'group', b: 'win', step: 3 }, { a: 'win', b: 'sel', step: 4 }, { a: 'sel', b: 'outer', label: 'CTE', step: 5 }],
    steps: ['Read rows (ideally through an index).', 'Filter rows.', 'Group and aggregate if needed.', 'Compute window values per row.', 'Filter on window values in an outer query.'],
    caption: 'Logical order of evaluation. Windows come after WHERE and GROUP BY.'
  },
  illustrated: { title: 'Spend report a customer asked for', body: `<p>The customer\u2019s CFO asks: \u201cfor each team, the three most expensive tickets last week, and which days spend jumped more than 50%\u201d. That is one CTE for daily totals, one ROW_NUMBER for top three, one LAG for the jump. The Code tab builds a 3,000-row table and answers it; the plan output shows the effect of adding a composite index on <code class="i">(tenant, ts)</code>.</p>` },
  code: {
    title: 'Spend analytics with CTEs, windows and a query plan', file: 'spend_report.py', browser: true,
    intro: '<p>Uses only the standard library, so it runs in your browser. The SQL is portable to Postgres; in Snowflake or BigQuery replace <code class="i">date(ts)</code> with <code class="i">DATE(ts)</code> or <code class="i">CAST(ts AS DATE)</code>.</p>',
    src: String.raw`import random, sqlite3

random.seed(7)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE llm_calls (id INTEGER PRIMARY KEY, tenant TEXT, ticket_id INT, ts TEXT, cost_usd REAL)")
rows = []
for i in range(3000):
    tenant = random.choice(["acme", "globex", "initech"])
    day = random.randint(14, 20)
    boost = 2.5 if tenant == "globex" and day >= 19 else 1.0
    rows.append((tenant, random.randint(1, 400), f"2026-10-{day:02d}T{random.randint(0, 23):02d}:00:00",
                 round(random.uniform(0.001, 0.03) * boost, 4)))
db.executemany("INSERT INTO llm_calls (tenant, ticket_id, ts, cost_usd) VALUES (?, ?, ?, ?)", rows)

def show(title, sql):
    print(f"-- {title}")
    for r in db.execute(sql):
        print("  ", r)

show("top 3 tickets per tenant by cost", """
WITH ranked AS (
  SELECT tenant, ticket_id, ROUND(SUM(cost_usd), 3) AS cost,
         ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY SUM(cost_usd) DESC) AS rn
  FROM llm_calls GROUP BY tenant, ticket_id)
SELECT tenant, ticket_id, cost FROM ranked WHERE rn <= 3""")

show("days where spend jumped > 50%", """
WITH daily AS (
  SELECT tenant, date(ts) AS day, SUM(cost_usd) AS cost FROM llm_calls GROUP BY tenant, date(ts)),
changes AS (
  SELECT tenant, day, ROUND(cost, 2) AS cost,
         ROUND(cost / LAG(cost) OVER (PARTITION BY tenant ORDER BY day) - 1, 2) AS change
  FROM daily)
SELECT * FROM changes WHERE change > 0.5""")

q = "SELECT COUNT(*) FROM llm_calls WHERE tenant = 'acme' AND ts >= '2026-10-19'"
print("-- plan before index:", [r[-1] for r in db.execute("EXPLAIN QUERY PLAN " + q)])
db.execute("CREATE INDEX idx_calls_tenant_ts ON llm_calls (tenant, ts)")
print("-- plan after index: ", [r[-1] for r in db.execute("EXPLAIN QUERY PLAN " + q)])
print("-- rows:", db.execute(q).fetchone()[0])`,
    more: [{ note: 'The same idea in Postgres, captured from a real Postgres 16 run on 200,000 rows. <code class="i">EXPLAIN ANALYZE</code> executes the query and reports actual time. Timings on your machine will differ; the plan shape is the lesson.', file: 'postgres · psql', lang: 'sql', key: 'pg', pg: true, src: String.raw`CREATE TABLE llm_calls AS
SELECT g AS id,
       (ARRAY['acme','globex','initech'])[1 + g % 3] AS tenant,
       timestamptz '2026-09-01' + (g * interval '13 seconds') AS ts,
       random() * 0.03 AS cost_usd
FROM generate_series(1, 200000) g;
ANALYZE llm_calls;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT count(*) FROM llm_calls WHERE tenant = 'acme' AND ts >= '2026-10-01';

CREATE INDEX idx_calls_tenant_ts ON llm_calls (tenant, ts);
ANALYZE llm_calls;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT count(*) FROM llm_calls WHERE tenant = 'acme' AND ts >= '2026-10-01';` }]
  },
  lab: {
    title: 'Token-spend report for a customer\u2019s warehouse', file: 'spend_lab.py', browser: true,
    scenario: `<p>The customer\u2019s finance team wants a weekly report from the <code class="i">llm_calls</code> table: spend per tenant per day with a 3-day moving average, each tenant\u2019s share of total spend, and every ticket that needed more than three model calls (a sign of retries or a looping agent).</p>`,
    steps: ['Write a CTE <code class="i">daily</code> with tenant, day and spend.', 'Add a 3-day moving average with a window frame.', 'Compute each tenant\u2019s share of total spend with <code class="i">SUM(...) OVER ()</code>, an empty window over all rows.', 'List tickets with more than three calls, with their call count, highest count first.', 'Print each result with a heading.'],
    checks: ['Moving average equals the plain value on each tenant\u2019s first day.', 'Shares add up to 1.0.', 'The retry query uses GROUP BY with HAVING.'],
    hints: ['<code class="i">SUM(cost) / SUM(SUM(cost)) OVER ()</code> works in one query after GROUP BY tenant.', '<code class="i">ROWS BETWEEN 2 PRECEDING AND CURRENT ROW</code> is a 3-row frame.'],
    starter: String.raw`import random, sqlite3
random.seed(1)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE llm_calls (tenant TEXT, ticket_id INT, day TEXT, cost_usd REAL)")
for _ in range(1500):
    t = random.choice(["acme", "globex", "initech"])
    db.execute("INSERT INTO llm_calls VALUES (?, ?, ?, ?)",
               (t, random.randint(1, 300), f"2026-10-{random.randint(18, 24)}", random.uniform(0.002, 0.02)))

def show(title, sql):
    print("--", title)
    for r in db.execute(sql):
        print("  ", r)

show("daily spend with 3-day moving average", """
-- TODO
SELECT 1
""")`,
    solution: String.raw`import random, sqlite3
random.seed(1)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE llm_calls (tenant TEXT, ticket_id INT, day TEXT, cost_usd REAL)")
for _ in range(1500):
    t = random.choice(["acme", "globex", "initech"])
    db.execute("INSERT INTO llm_calls VALUES (?, ?, ?, ?)",
               (t, random.randint(1, 300), f"2026-10-{random.randint(18, 24)}", random.uniform(0.002, 0.02)))

def show(title, sql, limit=None):
    print("--", title)
    for i, r in enumerate(db.execute(sql)):
        if limit and i >= limit:
            break
        print("  ", r)

show("daily spend with 3-day moving average (acme)", """
WITH daily AS (
  SELECT tenant, day, SUM(cost_usd) AS cost FROM llm_calls GROUP BY tenant, day)
SELECT tenant, day, ROUND(cost, 3),
       ROUND(AVG(cost) OVER (PARTITION BY tenant ORDER BY day
                             ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 3) AS avg_3d
FROM daily WHERE tenant = 'acme'""")

show("share of total spend", """
SELECT tenant, ROUND(SUM(cost_usd), 2) AS spend,
       ROUND(SUM(cost_usd) / SUM(SUM(cost_usd)) OVER (), 3) AS share
FROM llm_calls GROUP BY tenant ORDER BY spend DESC""")

show("tickets with more than 3 calls", """
SELECT tenant, ticket_id, COUNT(*) AS calls
FROM llm_calls GROUP BY tenant, ticket_id
HAVING COUNT(*) > 3 ORDER BY calls DESC, tenant, ticket_id""", limit=5)`
  },
  design: {
    lead: '<p>On warehouse-scale data the same SQL behaves differently: you pay per byte scanned in BigQuery and per warehouse-second in Snowflake. Good AI engineers write queries that read less data, and they design telemetry tables so the common questions are cheap.</p>',
    scale: [{ h: 'Partition and cluster', p: 'Partition telemetry tables by day and cluster by tenant so a \u201clast 7 days for acme\u201d query reads a tiny fraction of the table.' }, { h: 'Pre-aggregate', p: 'Maintain a daily rollup (tenant, day, model, tokens, cost) for dashboards instead of scanning raw calls every time.' }],
    fail: [{ h: 'Fan-out joins', p: 'Joining calls to tickets to messages multiplies rows and inflates sums. Aggregate before joining, or count distinct keys.' }, { h: 'Timezone bugs', p: '<code class="i">date(ts)</code> in UTC versus the customer\u2019s local day shifts spend across days. Agree on the reporting timezone in discovery.' }],
    trade: [{ h: 'Index vs write cost', p: 'Every index speeds some reads and slows every insert. Telemetry tables with heavy writes get few, well-chosen indexes.' }, { h: 'SQL vs pandas', p: 'Push filtering and aggregation into the database; pull only the result into Python. Moving 50 million rows to a notebook to group them is the slow path.' }],
    prompt: '<p>Design the telemetry schema that powers per-tenant cost dashboards for an LLM platform handling 30 million calls per day.</p>',
    answer: '<ul><li>Raw table: one row per call with request_id, tenant, model, prompt_version, tokens, latency, cost, status; partitioned by day, clustered by tenant.</li><li>Hourly rollup table updated incrementally; dashboards read the rollup.</li><li>Retention: raw for 30 to 90 days, rollups for years.</li><li>Cost is computed at write time from a versioned price table, so price changes do not rewrite history.</li></ul>'
  },
  quiz: [
    { q: 'You need each ticket\u2019s cost and its tenant\u2019s total on the same row. Use:', o: ['GROUP BY tenant', 'SUM(cost) OVER (PARTITION BY tenant)', 'A self-join only', 'DISTINCT'], a: 1, why: 'A window keeps every row and adds the partition total alongside it.' },
    { q: 'Why can\u2019t you write <code class="i">WHERE ROW_NUMBER() OVER (...) &lt;= 3</code>?', o: ['ROW_NUMBER is not standard', 'Window functions are computed after WHERE, so filter in an outer query or CTE', 'It needs HAVING', 'SQLite does not support it'], a: 1, why: 'Logical evaluation order puts windows after WHERE and GROUP BY.' },
    { q: 'EXPLAIN shows a full SCAN of a 200-million-row table for <code class="i">WHERE tenant = ? AND ts &gt;= ?</code>. A good fix is:', o: ['An index on (ts, cost)', 'A composite index on (tenant, ts)', 'Adding LIMIT 10', 'Using DISTINCT'], a: 1, why: 'Equality column first, range column second lets the index jump to the tenant and scan a time range.' }
  ],
  interview: [
    { q: 'Write a query for the three most expensive conversations per customer last week.', a: '<p>Aggregate cost per customer and conversation filtered to last week in a CTE, add <code class="i">ROW_NUMBER() OVER (PARTITION BY customer ORDER BY cost DESC)</code>, then select rows with rank 1 to 3. Mention ties: use RANK if ties should all appear.</p>' },
    { q: 'A dashboard query got 20 times slower after the table grew. How do you investigate?', a: '<p>Run EXPLAIN ANALYZE and look for full scans, bad row estimates and sorts spilling to disk. Check that statistics are fresh, that the filter columns have a suitable composite index, and whether the query should read a pre-aggregated rollup instead of raw rows.</p>' }
  ]
});
})();
