/* Phase 1 · Backend core */
(function () {
const L = AISA.lesson;

/* ===================================================================== 1.1 */
L({
  id: '1.1', title: 'HTTP, REST and API design', minutes: 50, roles: ['fde', 'be'],
  tags: 'resources · status codes · cursor pagination · problem+json · Retry-After · versioning',
  mental: 'An API is a contract other teams build against. Design it around resources, tell callers precisely what went wrong with status codes and structured errors, and paginate with cursors so it keeps working at a million rows.',
  intro: `<p>Both roles live on HTTP. The <b>FDE</b> spends weeks integrating with customer APIs that page differently, rate-limit without warning and return errors as HTML. The <b>AI backend engineer</b> designs the APIs that product teams, agents and customers call, and every design mistake becomes a support ticket or a breaking change.</p>
  <p>This lesson builds both muscles: the client that survives a real customer API, and the design rules that make your own API pleasant to consume. Lesson 1.2 then implements the server side in FastAPI.</p>`,
  points: [
    'Model nouns as resources (<code class="i">/v1/tickets/{id}</code>) and use methods for verbs: GET reads, POST creates, PATCH updates part, PUT replaces, DELETE removes.',
    'GET, PUT and DELETE are idempotent by definition; POST is not, so creating resources safely needs an <code class="i">Idempotency-Key</code> header (lesson 1.7).',
    'Status codes are part of the contract: 400 malformed, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict, 422 validation failed, 429 slow down, 5xx our fault.',
    'Return structured errors with <code class="i">application/problem+json</code> (RFC 9457): type, title, status, detail, plus your own fields.',
    'Paginate with an opaque cursor and a <code class="i">limit</code>; offset pagination gets slow and skips rows when data changes underneath.',
    'Version in the path (<code class="i">/v1</code>) or a header, and only add fields within a version; removing or renaming is a breaking change.'
  ],
  concept: { title: 'Design for the caller who is not in the room', body: `<p>Whoever calls your API will never read your code. Everything they need must be in the contract: predictable URLs, honest status codes, machine-readable errors, a stable way to page through data, and headers that tell them when to retry. An LLM agent calling your API as a tool is the most literal caller of all: it acts only on what the response says.</p>` },
  walk: [
    { h: 'Resource design for a triage service', body: `<div class="tbl"><table><thead><tr><th>method + path</th><th>meaning</th><th>success</th></tr></thead><tbody>
      <tr><td class="n">GET /v1/tickets?status=open&amp;limit=50</td><td>list, filtered</td><td>200 + items + next_cursor</td></tr>
      <tr><td class="n">POST /v1/tickets</td><td>create</td><td>201 + Location header</td></tr>
      <tr><td class="n">GET /v1/tickets/4812</td><td>read one</td><td>200 or 404</td></tr>
      <tr><td class="n">PATCH /v1/tickets/4812</td><td>change status or labels</td><td>200 or 409 on version conflict</td></tr>
      <tr><td class="n">POST /v1/tickets/4812/triage</td><td>action that is not CRUD</td><td>202 Accepted + job id</td></tr></tbody></table></div><p>Long-running work such as triage by a model returns <b>202</b> with a job resource the client can poll or subscribe to, instead of holding the connection for 40 seconds.</p>` },
    { h: 'A structured error, not a string', body: '<p>Clients and agents can branch on <code class="i">type</code> and show <code class="i">detail</code> to a human.</p>', lang: 'bash', file: 'HTTP response', code: String.raw`HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/errors/invalid-filter",
  "title": "Invalid filter",
  "status": 422,
  "detail": "since must be an ISO 8601 timestamp, got 'last week'",
  "param": "since"
}` },
    { h: 'Cursor pagination', body: '<p>The cursor encodes “where I stopped” (for example, the last <code class="i">(created_at, id)</code> seen). The server answers with the next page and a new cursor, or <code class="i">null</code> at the end. Lesson 1.4 shows the matching SQL.</p>', lang: 'bash', file: 'HTTP exchange', code: String.raw`GET /v1/tickets?limit=2
-> {"items": [{"id": 1}, {"id": 2}], "next_cursor": "eyJpZCI6Mn0"}

GET /v1/tickets?limit=2&cursor=eyJpZCI6Mn0
-> {"items": [{"id": 3}, {"id": 4}], "next_cursor": null}` },
    { h: 'Rate-limit headers tell callers what to do', body: '<p>Send <code class="i">429</code> with <code class="i">Retry-After</code> (seconds), and optionally the remaining budget. Good clients sleep exactly that long instead of guessing.</p>', lang: 'bash', file: 'HTTP response', code: String.raw`HTTP/1.1 429 Too Many Requests
Retry-After: 2
RateLimit-Limit: 600
RateLimit-Remaining: 0
RateLimit-Reset: 2` }
  ],
  analogy: `<p><b>A library with a good catalogue.</b> Books (resources) have stable shelf numbers. The desk answers with clear slips: “on loan, back Tuesday” (429 with Retry-After), “no such book” (404), “you need a member card” (401), “reference only, cannot borrow” (403). For a long reading list you get a bookmark (the cursor), not “start at book 4,000”.</p>`,
  diagram: {
    title: 'Life of an API request', w: 820, h: 300,
    nodes: [
      { id: 'c', x: 16, y: 120, w: 120, label: 'Client', sub: 'app · agent · ETL', info: 'Anything from a browser to a customer’s nightly job or an LLM agent using your API as a tool.' },
      { id: 'edge', x: 170, y: 120, w: 130, label: 'TLS + gateway', sub: 'auth · rate limit', tone: 'acc', info: 'Terminates TLS, checks credentials, applies per-key rate limits and returns 401 or 429 before your code runs.' },
      { id: 'api', x: 340, y: 120, w: 130, label: 'API service', sub: 'validate · route', tone: 'be', info: 'Validates input (422), checks permissions (403), calls the domain logic.' },
      { id: 'db', x: 520, y: 40, w: 130, label: 'Database', sub: 'source of truth', info: 'Reads and writes; returns 409 on version conflicts.' },
      { id: 'job', x: 520, y: 200, w: 130, label: 'Job queue', sub: '202 Accepted', info: 'Slow work such as model triage is queued; the client gets a job id immediately.' },
      { id: 'resp', x: 690, y: 120, w: 116, label: 'Response', sub: 'status + body', tone: 'ok', info: 'Honest status, JSON body or problem+json, and headers such as Location, Retry-After and the next cursor.' }
    ],
    edges: [{ a: 'c', b: 'edge', label: 'HTTPS', step: 1 }, { a: 'edge', b: 'api', step: 2 }, { a: 'api', b: 'db', step: 3 }, { a: 'api', b: 'job', dash: true, label: 'slow work', step: 3 }, { a: 'db', b: 'resp', step: 4 }, { a: 'job', b: 'resp', dash: true, step: 4 }],
    steps: ['The client sends a request over HTTPS.', 'The edge authenticates and rate-limits; failures end here with 401 or 429.', 'The service validates and either reads or writes, or queues slow work.', 'The response carries a precise status, body and headers.'],
    caption: 'Every hop can answer with a specific status code; the client should be able to act on each one.'
  },
  illustrated: { title: 'Offset vs cursor on a busy table', body: `<p>A customer exports 120,000 tickets at 500 per page while agents create about 30 new tickets per minute.</p>
    <div class="tbl"><table><thead><tr><th></th><th>offset pagination</th><th>cursor pagination</th></tr></thead><tbody>
    <tr><td>page 200 query</td><td class="n">OFFSET 99,500: the database reads and discards 99,500 rows</td><td class="n">WHERE (created_at, id) &lt; cursor: index seek, reads 500 rows</td></tr>
    <tr><td>new rows during export</td><td>pages shift; rows are duplicated or skipped</td><td>stable: each row is seen once</td></tr>
    <tr><td>cost of last page</td><td>grows with table size</td><td>constant</td></tr></tbody></table></div>
    <p>The Code tab shows a client that follows cursors, honours <code class="i">Retry-After</code> and turns problem+json into a typed exception.</p>` },
  code: {
    title: 'A client that survives a real customer API', file: 'customer_api.py', deps: 'uv add httpx',
    intro: '<p>The FDE’s bread and butter. The mock transport behaves like a typical enterprise API: cursor pages, a 429 with Retry-After in the middle, and problem+json errors. The client is the part you would ship.</p>',
    src: String.raw`import base64, json, time
from collections.abc import Iterator
import httpx

TICKETS = [{"id": i, "subject": f"ticket {i}", "created_at": f"2026-10-{1 + i % 20:02d}"} for i in range(1, 12)]
calls = {"n": 0}

def fake_customer_api(request: httpx.Request) -> httpx.Response:
    calls["n"] += 1
    if request.headers.get("authorization") != "Bearer test-token":
        return httpx.Response(401, json={"title": "Unauthorized", "status": 401})
    if calls["n"] == 3:                      # the API throttles us once
        return httpx.Response(429, headers={"retry-after": "0.2"})
    since = request.url.params.get("since", "")
    if since and len(since) != 10:
        return httpx.Response(422, headers={"content-type": "application/problem+json"},
                              json={"type": "https://api.example/errors/invalid-filter", "title": "Invalid filter",
                                    "status": 422, "detail": f"since must be YYYY-MM-DD, got '{since}'", "param": "since"})
    limit = int(request.url.params.get("limit", "4"))
    cursor = request.url.params.get("cursor")
    after = json.loads(base64.urlsafe_b64decode(cursor))["id"] if cursor else 0
    page = [t for t in TICKETS if t["id"] > after][:limit]
    nxt = base64.urlsafe_b64encode(json.dumps({"id": page[-1]["id"]}).encode()).decode() if len(page) == limit else None
    return httpx.Response(200, json={"items": page, "next_cursor": nxt})

class APIError(Exception):
    def __init__(self, status: int, problem: dict):
        self.status, self.problem = status, problem
        super().__init__(f"{status} {problem.get('title')}: {problem.get('detail', '')}")

class CustomerClient:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url="https://crm.customer.example/v1", transport=transport,
                                 headers={"authorization": f"Bearer {token}"}, timeout=httpx.Timeout(10.0, connect=3.0))

    def _get(self, path: str, params: dict, max_retries: int = 5) -> dict:
        for _ in range(max_retries):
            r = self.http.get(path, params=params)
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after", "1"))
                print(f"  429 -> sleeping {wait}s as the server asked")
                time.sleep(wait)
                continue
            if r.status_code >= 400:
                problem = r.json() if "json" in r.headers.get("content-type", "") else {"title": r.text[:200]}
                raise APIError(r.status_code, problem)
            return r.json()
        raise APIError(429, {"title": "rate limited", "detail": "retries exhausted"})

    def iter_tickets(self, since: str = "", page_size: int = 4) -> Iterator[dict]:
        cursor = None
        while True:
            params = {"limit": page_size, **({"cursor": cursor} if cursor else {}), **({"since": since} if since else {})}
            body = self._get("/tickets", params)
            yield from body["items"]
            cursor = body["next_cursor"]
            if not cursor:
                return

client = CustomerClient("test-token", transport=httpx.MockTransport(fake_customer_api))
ids = [t["id"] for t in client.iter_tickets()]
print("fetched", len(ids), "tickets:", ids, "in", calls["n"], "HTTP calls")

try:
    list(client.iter_tickets(since="last week"))
except APIError as e:
    print("typed error ->", e, "| param:", e.problem["param"])`
  },
  lab: {
    title: 'Integrate a paginated customer API', file: 'sync_lab.py', browser: true,
    scenario: `<p>The customer’s helpdesk exposes <code class="i">fetch(path, params)</code> through an internal SDK (simulated below). It pages with <code class="i">next_cursor</code>, throttles with status 429 and a <code class="i">retry_after</code> field, and sometimes returns 503. Write the sync job that pulls every ticket updated since a checkpoint, exactly once, and saves the new checkpoint.</p>`,
    steps: ['Read the fake server: it returns <code class="i">(status, headers, body)</code>.', 'Implement <code class="i">iter_updated(since)</code> following cursors until <code class="i">next_cursor</code> is None.', 'On 429, wait <code class="i">retry_after</code> seconds (use the fake clock). On 503, retry up to 3 times with backoff.', 'Deduplicate by ticket id: the API can return a ticket twice if it was updated mid-sync.', 'Return the tickets and the max <code class="i">updated_at</code> seen as the new checkpoint.'],
    checks: ['Every ticket updated after the checkpoint is returned exactly once (the solution prints the expected count).', 'The fake clock shows you waited for every 429.', 'New checkpoint equals the latest updated_at.'],
    hints: ['Keep a <code class="i">seen</code> set of ids.', 'Treat the checkpoint as exclusive (<code class="i">updated_at &gt; since</code>) and let the server filter.'],
    starter: String.raw`import random
random.seed(3)
CLOCK = {"t": 0.0}
def sleep(s): CLOCK["t"] += s

DATA = [{"id": i, "updated_at": f"2026-10-{10 + i % 14:02d}T0{i % 10}:00"} for i in range(1, 41)]
state = {"calls": 0}
def fetch(path, params):
    state["calls"] += 1
    if state["calls"] % 4 == 0:
        return 429, {"retry_after": 1.5}, None
    if random.random() < 0.15:
        return 503, {}, None
    rows = sorted([d for d in DATA if d["updated_at"] > params["since"]], key=lambda d: d["id"])
    start = params.get("cursor", 0)
    page = rows[start:start + 5]
    if start == 5 and page:            # simulate a ticket updated mid-sync and re-served
        page = page + [rows[0]]
    nxt = start + 5 if start + 5 < len(rows) else None
    return 200, {}, {"items": page, "next_cursor": nxt}

def iter_updated(since):
    # TODO: follow cursors, handle 429 and 503, deduplicate
    yield from []

since = "2026-10-15T00:00"
tickets = list(iter_updated(since))
print(len(tickets), "tickets; waited", CLOCK["t"], "s;", state["calls"], "calls")`,
    solution: String.raw`import random
random.seed(3)
CLOCK = {"t": 0.0}
def sleep(s): CLOCK["t"] += s

DATA = [{"id": i, "updated_at": f"2026-10-{10 + i % 14:02d}T0{i % 10}:00"} for i in range(1, 41)]
state = {"calls": 0}
def fetch(path, params):
    state["calls"] += 1
    if state["calls"] % 4 == 0:
        return 429, {"retry_after": 1.5}, None
    if random.random() < 0.15:
        return 503, {}, None
    rows = sorted([d for d in DATA if d["updated_at"] > params["since"]], key=lambda d: d["id"])
    start = params.get("cursor", 0)
    page = rows[start:start + 5]
    if start == 5 and page:
        page = page + [rows[0]]
    nxt = start + 5 if start + 5 < len(rows) else None
    return 200, {}, {"items": page, "next_cursor": nxt}

def get_page(params, max_503=3):
    failures = 0
    while True:
        status, headers, body = fetch("/tickets", params)
        if status == 200:
            return body
        if status == 429:
            sleep(headers["retry_after"])
            continue
        if status == 503 and failures < max_503:
            sleep(0.5 * 2 ** failures)
            failures += 1
            continue
        raise RuntimeError(f"giving up: HTTP {status}")

def iter_updated(since):
    seen, cursor = set(), 0
    while cursor is not None:
        body = get_page({"since": since, "cursor": cursor})
        for t in body["items"]:
            if t["id"] not in seen:
                seen.add(t["id"])
                yield t
        cursor = body["next_cursor"]

since = "2026-10-15T00:00"
tickets = list(iter_updated(since))
checkpoint = max(t["updated_at"] for t in tickets)
expected = sum(d["updated_at"] > since for d in DATA)
print(len(tickets), "tickets (expected", expected, "); waited", CLOCK["t"], "s;", state["calls"], "calls")
print("new checkpoint:", checkpoint)`
  },
  design: {
    lead: '<p>Public and partner APIs live for years. The design cost is paid once; a breaking change is paid by every integration. For AI services, add one more consumer: agents that read your API’s descriptions and errors and act on them literally.</p>',
    scale: [{ h: 'Pagination at any size', p: 'Cursor pagination with a composite index keeps every page O(page size), whether the table has 10k or 10 billion rows.' }, { h: 'Async for slow work', p: 'Anything that may take longer than a few seconds (model triage, document ingest) returns 202 with a job resource; clients poll or receive a webhook (lesson 1.8).' }],
    fail: [{ h: 'Lying status codes', p: 'Returning 200 with <code class="i">{"error": ...}</code> breaks retries, monitoring and every SDK. Use the real status.' }, { h: 'Unbounded responses', p: 'An endpoint that returns all tickets works in the demo and times out at the first big customer. Always cap and paginate.' }],
    trade: [{ h: 'REST vs GraphQL vs gRPC', p: 'REST for public and partner APIs, GraphQL when many clients need different shapes of the same data, gRPC for internal low-latency service calls (lesson 1.8).' }, { h: 'Strict vs lenient input', p: 'Rejecting unknown fields catches client bugs early but makes rolling upgrades harder. Common choice: ignore unknown fields in requests, never remove fields from responses.' }],
    prompt: '<p>Design the public API for “submit a document, get an AI summary”. Documents can be 300 pages; summaries take 5 seconds to 3 minutes.</p>',
    answer: '<ul><li><code class="i">POST /v1/documents</code> with an upload URL flow for large files; returns 201 and a document id.</li><li><code class="i">POST /v1/documents/{id}/summaries</code> with an Idempotency-Key returns 202 and a summary job.</li><li><code class="i">GET /v1/summaries/{id}</code> to poll, plus an optional webhook on completion.</li><li>Problem+json errors, 429 with Retry-After, cursor pagination on list endpoints, /v1 versioning.</li></ul>'
  },
  quiz: [
    { q: 'A client sends a JSON body with a negative ticket id. The best status is:', o: ['200 with an error field', '400 or 422 with a problem+json body naming the field', '500', '404'], a: 1, why: 'The request reached the server but failed validation: a 4xx that the client can fix, with structured detail.' },
    { q: 'Why is cursor pagination preferred over OFFSET for large, changing tables?', o: ['Cursors are encrypted', 'Each page is an index seek and rows are not skipped or duplicated when data changes', 'OFFSET is not SQL', 'Cursors return more rows'], a: 1, why: 'OFFSET reads and discards rows and shifts when rows are inserted; a keyset cursor resumes from an exact position.' },
    { q: 'An API returns 429 with <code class="i">Retry-After: 2</code>. A well-behaved client:', o: ['Retries immediately', 'Waits about 2 seconds, then retries', 'Gives up', 'Switches to a new API key'], a: 1, why: 'The server told you exactly when capacity returns. Honour it.' }
  ],
  interview: [
    { q: 'You are integrating with a customer API that has no docs and inconsistent errors. How do you start?', a: '<p>Probe it with a small script: record real responses for list, read and error cases, including pagination ends and rate limits. Wrap it in one client class that normalises errors into typed exceptions, handles retries and pagination, and logs every call. Write tests against the recorded responses. Share the findings with the customer’s team as a short integration note.</p>' },
    { q: 'How would you evolve an API without breaking existing clients?', a: '<p>Add fields and endpoints, never rename or remove within a version. Keep defaults stable. Deprecate with headers and dates, measure who still uses old fields, and only remove in a new version after migration.</p>' }
  ]
});

/* ===================================================================== 1.2 */
L({
  id: '1.2', title: 'FastAPI services and SSE streaming', minutes: 60, roles: ['fde', 'be'],
  tags: 'FastAPI · Pydantic models · dependencies · lifespan · StreamingResponse · SSE',
  mental: 'FastAPI turns typed Python functions into an HTTP API: Pydantic validates the request, dependencies inject shared resources, and a streaming response lets users see model output token by token instead of waiting for the whole answer.',
  sim: 'sse',
  intro: `<p>FastAPI is the default Python framework for AI services in 2026: the request and response contract is a Pydantic model, async endpoints fit model calls naturally, and OpenAPI docs come for free. Deloitte’s Bengaluru AI backend roles, for example, list Python with FastAPI, Flask or Django for scalable async services.</p>
  <p>Streaming is the feature that makes AI products feel fast. A 12-second answer that starts appearing after 600 ms feels responsive; the same answer delivered all at once after 12 seconds feels broken. This lesson builds both kinds of endpoint and tests them without starting a server.</p>`,
  points: [
    'Type the request body as a Pydantic model and invalid input becomes a 422 with field-level errors automatically.',
    '<code class="i">response_model</code> filters and documents what you return, so internal fields never leak.',
    '<code class="i">Depends()</code> injects shared things (settings, DB sessions, the model client) and lets tests swap them via <code class="i">app.dependency_overrides</code>.',
    'Create expensive clients once in the <code class="i">lifespan</code> handler and store them on <code class="i">app.state</code>, not per request.',
    'Server-sent events: <code class="i">StreamingResponse</code> with <code class="i">text/event-stream</code>, each message as <code class="i">event: ...\\ndata: ...\\n\\n</code>.',
    'Stop generating when the client disconnects (<code class="i">await request.is_disconnected()</code>) or you keep paying for tokens nobody reads.'
  ],
  concept: { title: 'Contracts in, contracts out, streams in between', body: `<p>A FastAPI endpoint is three contracts. The input model defines what callers may send. The output model defines what they get back. In between, the dependency system declares what the endpoint needs from the outside world. Each is visible in the function signature, which is why FastAPI code is easy to review and easy to test.</p><p>Streaming changes only the output contract: instead of one JSON object, the client receives a sequence of small typed events (token, done, error) over one long HTTP response.</p>` },
  walk: [
    { h: 'Models define the contract', body: '<p>Validation, docs and serialization all come from these two classes.</p>', code: String.raw`from typing import Literal
from pydantic import BaseModel, Field

class TriageIn(BaseModel):
    ticket_id: int = Field(gt=0)
    text: str = Field(min_length=5, max_length=4000)

class TriageOut(BaseModel):
    ticket_id: int
    label: Literal["billing", "bug", "other"]
    model: str` },
    { h: 'Lifespan and dependencies', body: '<p>The model client is created once at startup; the endpoint receives it through a dependency, which tests can override.</p>', code: String.raw`from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = ModelClient()       # one pooled client for the process
    yield
    await app.state.model.close()

app = FastAPI(lifespan=lifespan)

def get_model(request: Request) -> "ModelClient":
    return request.app.state.model` },
    { h: 'A streaming endpoint with server-sent events', body: '<p>Each <code class="i">yield</code> is flushed to the client immediately. The final <code class="i">done</code> event lets the client know the stream ended normally.</p>', code: String.raw`import json
from fastapi.responses import StreamingResponse

@app.post("/v1/triage/stream")
async def triage_stream(body: TriageIn, request: Request, model=Depends(get_model)):
    async def events():
        async for token in model.stream(body.text):
            if await request.is_disconnected():
                break                      # stop paying for tokens nobody reads
            yield f"event: token\ndata: {json.dumps({'t': token})}\n\n"
        yield "event: done\ndata: {}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})` },
    { h: 'Run it', body: '<p><code class="i">fastapi dev</code> reloads on save; in production run uvicorn with several workers behind a load balancer. Interactive docs appear at <code class="i">/docs</code>.</p>', lang: 'bash', file: 'terminal', code: String.raw`uv add "fastapi[standard]"
uv run fastapi dev app.py                     # http://127.0.0.1:8000/docs
curl -N -X POST localhost:8000/v1/triage/stream \
     -H 'content-type: application/json' -d '{"ticket_id": 1, "text": "charged twice"}'` }
  ],
  analogy: `<p><b>A restaurant’s order window.</b> The menu is the input model: you can only order what is on it, and the cashier rejects “one pizza, size purple” (422). The kitchen tools are dependencies, set up before opening (lifespan). Streaming is a sushi conveyor: plates arrive as they are made, so you start eating long before the last plate is ready.</p>`,
  diagram: {
    title: 'Inside a FastAPI request', w: 820, h: 320,
    groups: [{ x: 196, y: 20, w: 450, h: 280, label: 'UVICORN WORKER · ONE EVENT LOOP' }],
    nodes: [
      { id: 'cl', x: 16, y: 136, w: 140, label: 'Client', sub: 'fetch / EventSource', info: 'Browser, mobile app or another service. For streams it reads the response body incrementally.' },
      { id: 'val', x: 216, y: 56, w: 140, label: 'Validation', sub: 'TriageIn', tone: 'acc', info: 'Pydantic parses the JSON body; failures return 422 before your function runs.' },
      { id: 'dep', x: 216, y: 136, w: 140, label: 'Dependencies', sub: 'Depends(...)', tone: 'acc', info: 'Settings, auth, DB session and the model client are resolved and injected.' },
      { id: 'life', x: 216, y: 226, w: 140, label: 'Lifespan', sub: 'app.state', info: 'Created once at startup: connection pools and SDK clients shared by all requests.' },
      { id: 'ep', x: 396, y: 96, w: 120, label: 'Endpoint', sub: 'async def', tone: 'be', info: 'Your function: business logic and calls to the model.' },
      { id: 'gen', x: 396, y: 196, w: 120, label: 'Generator', sub: 'yield events', tone: 'be', info: 'For streams, an async generator yields SSE frames as tokens arrive.' },
      { id: 'mdl', x: 670, y: 136, w: 136, label: 'Model provider', sub: 'token stream', tone: 'fde', info: 'The upstream LLM API, also streaming.' }
    ],
    edges: [{ a: 'cl', b: 'val', label: 'POST', step: 1 }, { a: 'val', b: 'dep', step: 2 }, { a: 'life', b: 'dep', dash: true }, { a: 'dep', b: 'ep', step: 3 }, { a: 'ep', b: 'mdl', step: 4 }, { a: 'mdl', b: 'gen', label: 'tokens', step: 5 }, { a: 'gen', b: 'cl', label: 'SSE frames', step: 6, bend: 30 }],
    steps: ['The client posts JSON.', 'The body is validated against the input model.', 'Dependencies are injected, using clients created at startup.', 'The endpoint calls the model provider.', 'Tokens stream back from the provider.', 'Each token is forwarded to the client as an SSE frame.'],
    caption: 'Validation and dependencies run before your code; streaming forwards tokens as they arrive.'
  },
  illustrated: { title: 'What streaming buys you', body: `<p>Typical answer: 600 ms to first token, 45 tokens per second, 70 tokens of output.</p>
    <div class="tbl"><table><thead><tr><th></th><th>blocking JSON</th><th>SSE stream</th></tr></thead><tbody>
    <tr><td>first visible text</td><td class="n">0.6 + 70 / 45 = 2.16 s</td><td class="n">0.6 s</td></tr>
    <tr><td>complete answer</td><td class="n">2.16 s</td><td class="n">2.16 s</td></tr>
    <tr><td>user can cancel early</td><td>no, tokens are already paid</td><td>yes, generation stops on disconnect</td></tr></tbody></table></div>
    <p>For a 700-token answer the blocking wait grows to over 16 seconds, while streaming still shows text at 0.6 s. Use the simulator to try your own numbers.</p>` },
  code: {
    title: 'A complete service tested without a server', file: 'app.py', deps: 'uv add "fastapi[standard]"',
    intro: '<p>Models, lifespan, dependencies with an override, a JSON endpoint, a streaming endpoint, a health check, and tests using <code class="i">TestClient</code>, which runs the ASGI app in-process. The output below is from a real run.</p>',
    src: String.raw`import asyncio, json
from contextlib import asynccontextmanager
from typing import AsyncIterator, Literal
from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

class Settings(BaseModel):
    model_name: str = "triage-small-2026-10"

class TriageIn(BaseModel):
    ticket_id: int = Field(gt=0)
    text: str = Field(min_length=5, max_length=4000)

class TriageOut(BaseModel):
    ticket_id: int
    label: Literal["billing", "bug", "other"]
    model: str

class FakeModel:                     # stands in for the provider SDK; same shape
    async def stream(self, text: str) -> AsyncIterator[str]:
        for word in "Looks like a duplicate charge, routing to billing.".split():
            await asyncio.sleep(0)
            yield word + " "

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = FakeModel()
    yield

app = FastAPI(title="Triage API", lifespan=lifespan)

def get_settings() -> Settings:
    return Settings()

def get_model(request: Request) -> FakeModel:
    return request.app.state.model

@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}

@app.post("/v1/triage", response_model=TriageOut)
async def triage(body: TriageIn, settings: Settings = Depends(get_settings)) -> TriageOut:
    text = body.text.lower()
    label = "billing" if "charge" in text or "invoice" in text else "bug" if "error" in text else "other"
    return TriageOut(ticket_id=body.ticket_id, label=label, model=settings.model_name)

@app.post("/v1/triage/stream")
async def triage_stream(body: TriageIn, request: Request, model: FakeModel = Depends(get_model)):
    async def events():
        async for token in model.stream(body.text):
            if await request.is_disconnected():
                break
            yield f"event: token\ndata: {json.dumps({'t': token})}\n\n"
        yield "event: done\ndata: {}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

with TestClient(app) as c:
    print("GET  /healthz       ", c.get("/healthz").json())
    print("POST /v1/triage     ", c.post("/v1/triage", json={"ticket_id": 7, "text": "I was charged twice"}).json())
    bad = c.post("/v1/triage", json={"ticket_id": 0, "text": "hi"})
    print("POST invalid        ", bad.status_code, [(e["loc"][-1], e["type"]) for e in bad.json()["detail"]])
    app.dependency_overrides[get_settings] = lambda: Settings(model_name="test-double")
    print("with override       ", c.post("/v1/triage", json={"ticket_id": 8, "text": "export error 500"}).json())
    app.dependency_overrides.clear()
    with c.stream("POST", "/v1/triage/stream", json={"ticket_id": 7, "text": "I was charged twice"}) as r:
        print("stream content-type ", r.headers["content-type"])
        frames = [line for line in r.iter_lines() if line.startswith("data:")]
    print("stream frames       ", len(frames), "| first:", frames[0], "| last:", frames[-1])
    print("openapi paths       ", sorted(app.openapi()["paths"]))`
  },
  lab: {
    title: 'Production-grade streaming endpoint', file: 'stream_lab.py',
    scenario: `<p>The product team is shipping a chat panel. Proxies at the customer’s site kill connections that are silent for 30 seconds, and long reasoning steps can pause token output for that long. Extend the streaming endpoint so it is safe behind those proxies and tells the client clearly what happened.</p>`,
    setup: String.raw`uv init stream-lab && cd stream-lab
uv add "fastapi[standard]"
# paste the starter into stream_lab.py, then
uv run python stream_lab.py`,
    steps: ['Emit a heartbeat comment line (<code class="i">: ping</code>) whenever no token has been sent for N seconds (use 0.05 s in the test).', 'If the model raises, send <code class="i">event: error</code> with a JSON body containing a short code, then end the stream.', 'Number every event with an <code class="i">id:</code> line so a reconnecting client can send <code class="i">Last-Event-ID</code>.', 'Test all three behaviours with <code class="i">TestClient</code>.'],
    checks: ['A slow fake model produces at least one <code class="i">: ping</code> line.', 'A failing fake model produces exactly one error event and no done event.', 'Every data event has an increasing id.'],
    hints: ['Keep one pending task for the next token and wait on it with <code class="i">asyncio.wait({task}, timeout=...)</code>. On a timeout send a ping and keep waiting on the same task.', 'Do not use <code class="i">asyncio.wait_for(anext(it), ...)</code>: on timeout it cancels the pending step, which closes the model\u2019s async generator and ends your stream early.'],
    starter: String.raw`import asyncio, json
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

class SlowModel:
    async def stream(self, text):
        for w in ["thinking", "about", "it"]:
            await asyncio.sleep(0.12)
            yield w

app = FastAPI()
MODEL = SlowModel()

@app.get("/stream")
async def stream():
    async def events():
        # TODO: heartbeat, ids, error event
        async for tok in MODEL.stream("x"):
            yield f"data: {json.dumps({'t': tok})}\n\n"
        yield "event: done\ndata: {}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")

with TestClient(app) as c, c.stream("GET", "/stream") as r:
    for line in r.iter_lines():
        if line:
            print(line)`,
    solution: String.raw`import asyncio, json
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

class SlowModel:
    async def stream(self, text):
        for w in ["thinking", "about", "it"]:
            await asyncio.sleep(0.12)
            yield w

class BrokenModel:
    async def stream(self, text):
        yield "partial"
        raise RuntimeError("upstream 503")

app = FastAPI()
app.state.model = SlowModel()
HEARTBEAT_S = 0.05

def sse_events(model):
    async def events():
        it, n = model.stream("x").__aiter__(), 0
        pending = asyncio.ensure_future(anext(it))   # one task for the next token
        try:
            while True:
                done, _ = await asyncio.wait({pending}, timeout=HEARTBEAT_S)
                if not done:
                    yield ": ping\n\n"             # silence: keep proxies from closing us
                    continue                         # and keep waiting on the SAME task
                try:
                    tok = pending.result()
                except StopAsyncIteration:
                    break
                except Exception as e:             # model failed mid-stream
                    n += 1
                    yield f"id: {n}\nevent: error\ndata: {json.dumps({'code': 'upstream_error', 'detail': str(e)})}\n\n"
                    return
                n += 1
                yield f"id: {n}\ndata: {json.dumps({'t': tok})}\n\n"
                pending = asyncio.ensure_future(anext(it))
            yield f"id: {n + 1}\nevent: done\ndata: {{}}\n\n"
        finally:
            pending.cancel()                         # client left: stop the upstream generator
    return events()

@app.get("/stream")
async def stream():
    return StreamingResponse(sse_events(app.state.model), media_type="text/event-stream")

for name, model in [("slow model", SlowModel()), ("broken model", BrokenModel())]:
    app.state.model = model
    with TestClient(app) as c, c.stream("GET", "/stream") as r:
        lines = [l for l in r.iter_lines() if l]
    pings = sum(l == ": ping" for l in lines)
    print(f"{name}: {pings} pings, events ->", [l for l in lines if not l.startswith(":")])`
  },
  design: {
    lead: '<p>One FastAPI process handles many concurrent streams cheaply because each one is mostly waiting. The limits at scale are open connections, proxy timeouts, and the cost of tokens generated for clients that left.</p>',
    scale: [{ h: 'Workers and connections', p: 'Run several uvicorn workers per container and several containers behind a load balancer. Streams hold connections open, so size for concurrent streams, not requests per second.' }, { h: 'Turn off buffering', p: 'Nginx and some CDNs buffer responses, which destroys streaming. Send <code class="i">X-Accel-Buffering: no</code> and configure proxies to pass through.' }],
    fail: [{ h: 'Blocking code in endpoints', p: 'A synchronous SDK call inside <code class="i">async def</code> stalls every stream on that worker. Use async clients or define the endpoint with plain <code class="i">def</code> so FastAPI runs it in a thread pool.' }, { h: 'Errors after headers are sent', p: 'Once streaming starts the status is already 200. Errors must be sent as an in-band event, which the client must handle.' }],
    trade: [{ h: 'SSE vs WebSockets', p: 'SSE is one-way, plain HTTP, easy through proxies and auto-reconnects. WebSockets are bidirectional, needed for voice or collaborative editing, but harder to operate.' }, { h: 'Stream vs job + poll', p: 'Streaming suits chat. Batch work and very long tasks suit a 202 job resource with polling or a webhook.' }],
    prompt: '<p>Your chat endpoint must support 20,000 concurrent streaming conversations. Estimate what you need and list the failure modes.</p>',
    answer: '<ul><li>Connections are the constraint: about 2,000 to 5,000 concurrent streams per worker process is realistic for an I/O-bound async app, so 5 to 10 containers with several workers each, plus headroom.</li><li>Load balancer idle timeout above the longest silent gap, with heartbeats.</li><li>Cancel upstream generation on disconnect; cap tokens per request.</li><li>Fail over to a second provider through the gateway (Phase 9) and emit error events the UI can render.</li></ul>'
  },
  quiz: [
    { q: 'A request body fails Pydantic validation in FastAPI. What happens by default?', o: ['500 error', 'The endpoint runs with None values', '422 response listing each invalid field', 'The request is retried'], a: 2, why: 'FastAPI validates before calling your function and returns field-level 422 errors.' },
    { q: 'Where should a pooled HTTP client for the model provider be created?', o: ['Inside each endpoint call', 'In the lifespan handler, stored on app.state', 'In a global inside the test file', 'In the Pydantic model'], a: 1, why: 'Create it once at startup so connections are reused across requests.' },
    { q: 'Why check <code class="i">request.is_disconnected()</code> while streaming?', o: ['To compress the stream', 'To stop generating and paying for tokens once the user has left', 'To retry the request', 'It is required by SSE'], a: 1, why: 'Generation continues upstream unless you stop it; abandoned streams waste money and capacity.' }
  ],
  interview: [
    { q: 'How do you test a FastAPI endpoint that calls an LLM?', a: '<p>Depend on the model client through <code class="i">Depends</code>, then use <code class="i">app.dependency_overrides</code> in tests to inject a fake. Exercise it with <code class="i">TestClient</code> or httpx’s ASGI transport, including validation errors, provider failures and the streaming path.</p>' },
    { q: 'Users report the chat answer appears all at once after a long wait, but locally it streams. Why?', a: '<p>Something between the client and the app is buffering the response: a reverse proxy, CDN, compression middleware or the load balancer. Check headers (Content-Type text/event-stream, no gzip on the stream, X-Accel-Buffering: no) and proxy settings, and test with <code class="i">curl -N</code> from inside the network.</p>' }
  ]
});

/* ===================================================================== 1.3 */
L({
  id: '1.3', title: 'Auth: OAuth2/OIDC, JWT, SAML, SCIM', minutes: 60, roles: ['fde', 'be'],
  tags: 'authentication · authorization · OIDC · JWT · scopes · SSO · SAML · SCIM · API keys',
  mental: 'Authentication proves who is calling; authorization decides what they may do. Enterprises want both delegated to their identity provider: users sign in with SSO, accounts are provisioned by SCIM, and your API verifies signed tokens on every request.',
  sim: 'jwt',
  intro: `<p>Integration skills in FDE postings explicitly include REST, GraphQL and streaming, with OAuth, SAML and SCIM auth. In practice this is where enterprise pilots stall: the AI works in the demo, then the customer’s security team asks how users sign in through Okta or Entra ID, how access is removed when someone leaves, and how a model-driven agent is prevented from reading another team’s data.</p>
  <p>AI backend engineers own the server side: verifying tokens, enforcing scopes and tenant isolation on every request, and issuing narrowly scoped credentials to agents and tools.</p>`,
  points: [
    '<b>OIDC</b> (OpenID Connect, on top of OAuth 2.0) is the modern SSO protocol: users sign in at the identity provider, your app receives a signed ID token and an access token.',
    'Use the <b>authorization code flow with PKCE</b> for browser and mobile apps; <b>client credentials</b> for service-to-service and background agents.',
    'A <b>JWT</b> is header.payload.signature, base64url-encoded. Anyone can read the claims; only the signature makes them trustworthy.',
    'Always verify signature, <code class="i">exp</code>, <code class="i">aud</code> and <code class="i">iss</code>. Prefer asymmetric keys (RS256 or ES256) fetched from the provider’s JWKS endpoint.',
    '<b>SAML</b> is the older XML-based SSO still common in banks and governments; <b>SCIM</b> is the REST standard IdPs use to create, update and deactivate users in your app.',
    'Authorize with scopes and roles, and always scope queries by tenant. An agent should receive the least privilege that lets it do its task.'
  ],
  concept: { title: 'Trust the signature, not the payload', body: `<p>A token is a signed statement from the identity provider: “this is agent-17 of tenant acme, allowed to read and write tickets, for the next 15 minutes, for the triage API”. Your API checks the signature with the provider’s public key, then checks that the statement is still valid (exp), meant for you (aud) and from the issuer you trust (iss). Only then does it read the claims and apply its own rules: scopes, roles and tenant boundaries.</p><p>Try it in the inspector on the Visualize tab: change the role to admin and watch the signature fail.</p>` },
  walk: [
    { h: 'Enterprise SSO with OIDC', body: '<p>Authorization code flow with PKCE, the default for user sign-in:</p><ul><li>Your app redirects the user to the IdP (Okta, Entra ID, Google) with a code challenge.</li><li>The user signs in there, with MFA and the customer’s policies.</li><li>The IdP redirects back with a one-time code; your backend exchanges it, plus the code verifier, for tokens.</li><li>Your app creates its own session; APIs receive the access token as <code class="i">Authorization: Bearer ...</code>.</li></ul>' },
    { h: 'Verify a token on every request', body: '<p>With an RS256 token from an IdP you fetch keys from its JWKS URL, cached; with HS256, as in this demo, a shared secret.</p>', code: String.raw`import jwt  # PyJWT

def verify(token: str) -> dict:
    return jwt.decode(
        token,
        key=SIGNING_KEY,                     # or a PyJWKClient(jwks_url).get_signing_key_from_jwt(token).key
        algorithms=["HS256"],                # never accept the algorithm from the token header
        audience="triage-api",
        issuer="https://auth.acme.example",
        leeway=30,                           # tolerate small clock skew
        options={"require": ["exp", "iat", "sub"]},
    )` },
    { h: 'Authorize: scopes, roles and tenants', body: '<p>Authentication is not authorization. Check what the caller may do, and make every query tenant-scoped so one customer can never read another’s data, even through a bug.</p>', code: String.raw`def require(scope: str):
    def check(claims: dict = Depends(current_claims)) -> dict:
        if scope not in claims.get("scope", "").split():
            raise HTTPException(403, f"missing scope {scope}")
        return claims
    return check

@app.get("/v1/tenants/{tenant}/tickets")
def list_tickets(tenant: str, claims: dict = Depends(require("tickets:read"))):
    if claims["tenant"] != tenant:
        raise HTTPException(403, "cross-tenant access")
    return db.tickets_for(tenant)            # the query itself filters by tenant` },
    { h: 'SCIM: users appear and disappear automatically', body: '<p>The customer’s IdP calls your SCIM endpoints when people join, change teams or leave. Deactivation must revoke sessions and API keys immediately; this is often a hard requirement in security reviews.</p>', lang: 'bash', file: 'HTTP · from the IdP', code: String.raw`POST /scim/v2/Users            {"userName": "ana@acme.com", "active": true, ...}
PATCH /scim/v2/Users/8c1f       {"Operations": [{"op": "replace", "path": "active", "value": false}]}
GET  /scim/v2/Users?filter=userName eq "ana@acme.com"` }
  ],
  analogy: `<p><b>A conference badge.</b> Registration (the identity provider) checks your ID and prints a badge with your name, company, access level and the conference dates, plus a hologram. Session doors (your API) do not call registration; they check the hologram (signature), the dates (exp), that it is for this conference (aud), and then whether your level allows this room (scopes). When you leave the company, registration cancels your badge (SCIM deactivation).</p>`,
  diagram: {
    title: 'SSO, tokens and provisioning in an enterprise deployment', w: 820, h: 330,
    groups: [{ x: 16, y: 20, w: 230, h: 290, label: 'CUSTOMER' }, { x: 300, y: 20, w: 504, h: 290, label: 'YOUR PLATFORM' }],
    nodes: [
      { id: 'user', x: 36, y: 50, w: 190, label: 'Employee', sub: 'browser', info: 'Signs in once with the company’s SSO.' },
      { id: 'idp', x: 36, y: 160, w: 190, h: 60, label: 'Identity provider', sub: 'Okta · Entra ID', tone: 'fde', info: 'Owns identities, MFA and group membership. Issues signed tokens (OIDC) or assertions (SAML), and pushes user changes via SCIM.' },
      { id: 'web', x: 330, y: 50, w: 150, label: 'Web app', sub: 'code + PKCE', tone: 'acc', info: 'Redirects to the IdP, exchanges the code for tokens, keeps a session.' },
      { id: 'api', x: 520, y: 50, w: 150, label: 'Triage API', sub: 'verify every token', tone: 'be', info: 'Verifies signature, exp, aud, iss; then scopes, roles and tenant.' },
      { id: 'agent', x: 520, y: 160, w: 150, label: 'AI agent', sub: 'client credentials', info: 'A service identity with narrow scopes, never a human admin token.' },
      { id: 'scim', x: 330, y: 240, w: 150, label: 'SCIM endpoint', sub: '/scim/v2/Users', tone: 'acc', info: 'Receives create, update and deactivate calls from the IdP.' },
      { id: 'db', x: 700, y: 120, w: 96, h: 60, label: 'Data', sub: 'tenant-scoped', info: 'Every query filters by tenant.' }
    ],
    edges: [{ a: 'user', b: 'web', label: 'open app', step: 1 }, { a: 'web', b: 'idp', label: 'redirect', step: 2, bend: -20 }, { a: 'idp', b: 'web', label: 'code', dash: true, step: 3, bend: -20 }, { a: 'web', b: 'api', label: 'Bearer token', step: 4 }, { a: 'agent', b: 'api', label: 'scoped token', step: 5 }, { a: 'api', b: 'db', step: 5 }, { a: 'idp', b: 'scim', label: 'SCIM push', dash: true, step: 6 }],
    steps: ['The employee opens the app.', 'The app redirects to the company IdP with a PKCE challenge.', 'After sign-in, the IdP sends back a one-time code; the app exchanges it for tokens.', 'API calls carry the access token; the API verifies it every time.', 'Agents use their own narrowly scoped service tokens.', 'The IdP provisions and deactivates users through SCIM.'],
    caption: 'Identity stays with the customer’s IdP; your platform verifies and authorizes.'
  },
  illustrated: { title: 'Decode a real token', body: `<p>The inspector below holds a real HS256 token generated for this lesson. Edit the claims and watch the checks change.</p>
    <div class="tbl"><table><thead><tr><th>claim</th><th>value</th><th>what your API does with it</th></tr></thead><tbody>
    <tr><td class="n">sub</td><td class="n">agent-17</td><td>who: logs and audit trail</td></tr>
    <tr><td class="n">tenant</td><td class="n">acme</td><td>filters every query</td></tr>
    <tr><td class="n">scope</td><td class="n">tickets:read tickets:write</td><td>gates each endpoint</td></tr>
    <tr><td class="n">aud</td><td class="n">triage-api</td><td>rejects tokens minted for other services</td></tr>
    <tr><td class="n">exp − iat</td><td class="n">900 s</td><td>15-minute lifetime limits damage from a leaked token</td></tr></tbody></table></div>` },
  code: {
    title: 'Token verification, scopes and tenant isolation in FastAPI', file: 'auth_api.py', deps: 'uv add "fastapi[standard]" pyjwt',
    intro: '<p>A miniature IdP issues tokens; the API verifies them with a dependency and enforces scope and tenant rules. Each request below hits a different failure path. In production swap the shared secret for the IdP’s JWKS and RS256.</p>',
    src: String.raw`import time
import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient

SECRET, ISSUER, AUDIENCE = "dev-only-secret-change-me-0123456789", "https://auth.acme.example", "triage-api"

def issue(sub: str, tenant: str, scope: str, ttl: int = 900, aud: str = AUDIENCE, key: str = SECRET) -> str:
    now = int(time.time())
    return jwt.encode({"sub": sub, "tenant": tenant, "scope": scope, "iss": ISSUER, "aud": aud,
                       "iat": now, "exp": now + ttl}, key, algorithm="HS256")

bearer = HTTPBearer(auto_error=False)
app = FastAPI()

def current_claims(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if cred is None:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    try:
        return jwt.decode(cred.credentials, SECRET, algorithms=["HS256"], audience=AUDIENCE,
                          issuer=ISSUER, leeway=30, options={"require": ["exp", "iat", "sub"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired", headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f"invalid token: {type(e).__name__}")

def require(scope: str):
    def dep(claims: dict = Depends(current_claims)) -> dict:
        if scope not in claims["scope"].split():
            raise HTTPException(403, f"missing scope {scope}")
        return claims
    return dep

TICKETS = {"acme": [{"id": 1, "subject": "Charged twice"}], "globex": [{"id": 9, "subject": "Secret roadmap"}]}

@app.get("/v1/tenants/{tenant}/tickets")
def list_tickets(tenant: str, claims: dict = Depends(require("tickets:read"))):
    if claims["tenant"] != tenant:
        raise HTTPException(403, "cross-tenant access denied")
    return TICKETS.get(tenant, [])

@app.delete("/v1/tenants/{tenant}/tickets/{tid}")
def delete_ticket(tenant: str, tid: int, claims: dict = Depends(require("tickets:admin"))):
    return {"deleted": tid}

cases = [
    ("valid agent token",      "GET",    "/v1/tenants/acme/tickets",     issue("agent-17", "acme", "tickets:read")),
    ("no token",               "GET",    "/v1/tenants/acme/tickets",     None),
    ("expired token",          "GET",    "/v1/tenants/acme/tickets",     issue("agent-17", "acme", "tickets:read", ttl=-120)),
    ("forged signature",       "GET",    "/v1/tenants/acme/tickets",     issue("agent-17", "acme", "tickets:read", key="attacker-secret-attacker-secret-1")),
    ("token for another API",  "GET",    "/v1/tenants/acme/tickets",     issue("agent-17", "acme", "tickets:read", aud="billing-api")),
    ("other tenant's data",    "GET",    "/v1/tenants/globex/tickets",   issue("agent-17", "acme", "tickets:read")),
    ("missing admin scope",    "DELETE", "/v1/tenants/acme/tickets/1",   issue("agent-17", "acme", "tickets:read tickets:write")),
]
with TestClient(app) as c:
    for name, method, path, tok in cases:
        r = c.request(method, path, headers={"Authorization": f"Bearer {tok}"} if tok else {})
        print(f"{name:<23} {r.status_code}  {r.json() if r.status_code == 200 else r.json()['detail']}")`
  },
  lab: {
    title: 'Hashed API keys for customer integrations', file: 'api_keys.py', browser: true,
    scenario: `<p>Some customer systems (a nightly ETL, a legacy ticketing tool) cannot do OAuth. They need long-lived API keys. Security requires that keys are shown once, stored only as hashes, scoped, revocable, and identifiable in logs without revealing the secret.</p>`,
    steps: ['Generate keys as <code class="i">tri_live_&lt;8-char id&gt;_&lt;32-char secret&gt;</code> using <code class="i">secrets.token_urlsafe</code>.', 'Store only the id, a SHA-256 hash of the full key, the tenant, scopes and a revoked flag.', 'Verify with <code class="i">hmac.compare_digest</code> to avoid timing leaks.', 'Implement revoke and show that a revoked key fails.', 'Log only the key id, never the secret.'],
    checks: ['The stored record contains no secret.', 'A valid key authenticates; a wrong secret with a valid id fails; a revoked key fails.', 'Verification looks up by id first, so it never scans all keys.'],
    hints: ['Split on <code class="i">_</code> with a maxsplit so the secret can contain underscores.', 'Real systems add a per-key salt or use a keyed hash (HMAC with a server pepper); SHA-256 is acceptable here because secrets are high-entropy.'],
    starter: String.raw`import hashlib, hmac, secrets

STORE = {}   # key_id -> record

def create_key(tenant: str, scopes: list[str]) -> str:
    # TODO: generate, store hash only, return the full key once
    ...

def verify_key(full_key: str) -> dict | None:
    # TODO
    ...

def revoke(key_id: str) -> None:
    ...

k = create_key("acme", ["tickets:read"])
print("shown once:", k)
print("stored:", STORE)
print("verify ok:", verify_key(k))`,
    solution: String.raw`import hashlib, hmac, secrets

STORE = {}   # key_id -> record

def _hash(full_key: str) -> str:
    return hashlib.sha256(full_key.encode()).hexdigest()

def create_key(tenant: str, scopes: list[str]) -> str:
    key_id = secrets.token_hex(4)
    full = f"tri_live_{key_id}_{secrets.token_urlsafe(24)}"
    STORE[key_id] = {"tenant": tenant, "scopes": scopes, "hash": _hash(full), "revoked": False}
    return full

def verify_key(full_key: str) -> dict | None:
    try:
        prefix, env, key_id, _secret = full_key.split("_", 3)
    except ValueError:
        return None
    rec = STORE.get(key_id)
    if not rec or rec["revoked"] or prefix != "tri":
        return None
    if not hmac.compare_digest(rec["hash"], _hash(full_key)):
        return None
    print(f"auth ok key_id={key_id} tenant={rec['tenant']}")     # log the id, never the secret
    return {"key_id": key_id, "tenant": rec["tenant"], "scopes": rec["scopes"]}

def revoke(key_id: str) -> None:
    STORE[key_id]["revoked"] = True

k = create_key("acme", ["tickets:read"])
key_id = k.split("_")[2]
print("shown once:", k[:22] + "...")
print("stored has secret?", any(k.split("_", 3)[3] in str(v) for v in STORE.values()))
print("valid key       ->", verify_key(k))
print("wrong secret    ->", verify_key(k[:-4] + "XXXX"))
revoke(key_id)
print("after revoke    ->", verify_key(k))`
  },
  design: {
    lead: '<p>Auth design is where security reviews pass or fail. In multi-tenant AI systems the stakes are higher: an agent with a broad token can be talked by a prompt injection into reading or sending another tenant’s data (Phase 8). Least privilege is a design property, not a setting.</p>',
    scale: [{ h: 'Stateless verification', p: 'JWT checks need no database call, so they scale with your API. Cache JWKS keys and refresh on unknown <code class="i">kid</code> to support key rotation.' }, { h: 'Central policy', p: 'As rules grow (roles, per-tenant features, data residency), move them into a policy layer such as OPA or Cedar instead of scattered if-statements.' }],
    fail: [{ h: 'Algorithm confusion', p: 'Accepting the algorithm named in the token header has allowed forged tokens. Pin the allowed algorithms on the server.' }, { h: 'Long-lived, broad tokens', p: 'A leaked 30-day admin token is a breach. Short lifetimes, refresh tokens, narrow scopes and fast revocation limit the damage.' }],
    trade: [{ h: 'JWT vs opaque tokens', p: 'JWTs verify locally but cannot be revoked before expiry without a denylist; opaque tokens need an introspection call but revoke instantly.' }, { h: 'OIDC vs SAML', p: 'OIDC is simpler and modern; SAML is still required by many banks and governments. Supporting both through an auth broker (Auth0, WorkOS, Keycloak) is common for B2B AI products.' }],
    prompt: '<p>A bank wants your AI assistant to read its employees’ tickets and draft replies. Employees sign in with Entra ID. Design authentication and authorization end to end, including the agent.</p>',
    answer: '<ul><li>OIDC SSO with Entra ID, MFA enforced by the bank; SCIM for provisioning and instant deactivation.</li><li>Group-to-role mapping from IdP claims; tenant and team scoping on every query.</li><li>The agent acts on behalf of the signed-in user with a short-lived, down-scoped token (token exchange), never a shared admin key.</li><li>Drafting is read plus write-draft only; sending needs human approval.</li><li>Audit log of every agent action with user, tool and arguments.</li></ul>'
  },
  quiz: [
    { q: 'Which part of a JWT makes its claims trustworthy?', o: ['The header', 'The base64 encoding', 'The signature verified with the issuer’s key', 'The exp claim'], a: 2, why: 'Anyone can decode and even edit the payload; only a valid signature proves the issuer wrote it.' },
    { q: 'A token is valid and signed, but its <code class="i">aud</code> is billing-api. Your triage API should:', o: ['Accept it', 'Reject it with 401', 'Accept read-only requests', 'Forward it to billing'], a: 1, why: 'Audience checks stop a token minted for one service being replayed against another.' },
    { q: 'Which standard lets a customer’s identity provider create and deactivate users in your app?', o: ['SAML', 'SCIM', 'PKCE', 'JWKS'], a: 1, why: 'SCIM (System for Cross-domain Identity Management) is the provisioning API.' },
    { q: 'A valid acme token requests <code class="i">/v1/tenants/globex/tickets</code>. The correct status is:', o: ['200', '401', '403', '404'], a: 2, why: 'The caller is authenticated but not authorized for that tenant. Some APIs return 404 to avoid confirming the resource exists; never 200.' }
  ],
  interview: [
    { q: 'Explain the difference between authentication and authorization with an AI agent example.', a: '<p>Authentication: the agent presents a token proving it is agent-17 acting for tenant acme. Authorization: given that identity, may it call refund, and only for acme’s tickets, and only under a limit? The second is where most real incidents happen, so I enforce it server-side on every tool call, independent of the model.</p>' },
    { q: 'The customer’s security team will not grant your service production credentials. What do you do?', a: '<p>Find out what they are protecting against and offer narrower options: a dedicated service principal with read-only scopes, short-lived credentials via workload identity, access through their existing API gateway, IP allow-listing, and an audit log they can review. Start the pilot on a scoped subset of data to build trust.</p>' }
  ]
});

/* ===================================================================== 1.4 */
L({
  id: '1.4', title: 'Postgres modeling and indexes', minutes: 65, roles: ['fde', 'be'],
  tags: 'schema design · constraints · JSONB · composite and partial indexes · EXPLAIN ANALYZE · keyset pagination · upserts',
  mental: 'Postgres is the source of truth behind most AI products, including their vector search. Model data with constraints that make bad states impossible, then add the few indexes your real queries need, proven with EXPLAIN ANALYZE.',
  sim: 'index',
  intro: `<p>Tickets, conversations, users, tenants, documents, eval results, tool-call audit logs: AI systems are mostly ordinary relational data. Postgres also hosts embeddings through pgvector (Phase 4), so one well-run database often covers both.</p>
  <p>The FDE meets Postgres inside customer stacks and must design small schemas quickly. The AI backend engineer owns query performance: the inbox query that took 40 ms at launch and 4 seconds at the third enterprise customer.</p>`,
  points: [
    'Use constraints as documentation that the database enforces: NOT NULL, CHECK, UNIQUE, foreign keys.',
    'Put <code class="i">tenant_id</code> on every multi-tenant table and lead composite indexes with it.',
    'Composite index column order: equality columns first, then the range or sort column, such as <code class="i">(tenant_id, status, created_at DESC)</code>.',
    'Partial indexes (<code class="i">WHERE status = \'open\'</code>) stay small when queries only touch a subset.',
    'JSONB is good for flexible metadata from customer systems; index the keys you filter on with GIN or an expression index.',
    'Prove every index with <code class="i">EXPLAIN (ANALYZE, BUFFERS)</code> on realistic data volumes; idempotent imports use <code class="i">INSERT ... ON CONFLICT</code>.'
  ],
  concept: { title: 'The index matches the question', body: `<p>An index is a sorted copy of some columns pointing back to rows. It helps when it lets Postgres jump straight to the rows a query wants, in the order it wants them. So you design indexes from queries, not from tables: write down the five queries the product runs most, with their WHERE and ORDER BY, and build the smallest set of indexes that serves them.</p><p>The simulator on the Visualize tab shows the flip side: when a query matches a large share of the table, reading the whole table sequentially is cheaper than thousands of index lookups, and the planner rightly ignores your index.</p>` },
  walk: [
    { h: 'Model with constraints', body: '<p>Bad states such as an unknown priority or a ticket without a tenant become impossible rather than checked in code.</p>', lang: 'sql', file: 'schema.sql', code: String.raw`CREATE TABLE tenants (
  id    BIGSERIAL PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE tickets (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
  external_id TEXT   NOT NULL,                  -- id in the customer's system
  status      TEXT   NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','closed')),
  priority    TEXT   NOT NULL CHECK (priority IN ('P1','P2','P3')),
  subject     TEXT   NOT NULL,
  metadata    JSONB  NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)               -- makes imports idempotent
);` },
    { h: 'Index for the inbox query', body: '<p>The hottest query: a tenant’s open tickets, newest first, 50 at a time.</p>', lang: 'sql', file: 'indexes.sql', code: String.raw`-- the query
SELECT id, subject, priority, created_at FROM tickets
WHERE tenant_id = $1 AND status = 'open'
ORDER BY created_at DESC, id DESC LIMIT 50;

-- the index that serves it: equality columns, then the sort
CREATE INDEX tickets_inbox ON tickets (tenant_id, created_at DESC, id DESC)
WHERE status = 'open';` },
    { h: 'Keyset pagination', body: '<p>The next page starts after the last row seen. With the index above this is a seek, at any depth.</p>', lang: 'sql', file: 'page.sql', code: String.raw`SELECT id, subject, created_at FROM tickets
WHERE tenant_id = $1 AND status = 'open'
  AND (created_at, id) < ($2, $3)        -- cursor from the previous page
ORDER BY created_at DESC, id DESC LIMIT 50;` },
    { h: 'Idempotent imports with upsert', body: '<p>Re-running a sync never creates duplicates; changed rows are updated.</p>', lang: 'sql', file: 'upsert.sql', code: String.raw`INSERT INTO tickets (tenant_id, external_id, priority, subject, metadata)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (tenant_id, external_id)
DO UPDATE SET priority = EXCLUDED.priority, subject = EXCLUDED.subject, metadata = EXCLUDED.metadata;` },
    { h: 'Query JSONB metadata', body: '<p>Containment queries (<code class="i">@&gt;</code>) use a GIN index; an expression index serves one hot key.</p>', lang: 'sql', file: 'jsonb.sql', code: String.raw`CREATE INDEX tickets_meta ON tickets USING GIN (metadata jsonb_path_ops);
SELECT count(*) FROM tickets WHERE metadata @> '{"channel": "email"}';

CREATE INDEX tickets_region ON tickets ((metadata->>'region'));` }
  ],
  analogy: `<p><b>A phone book sorted by city, then surname.</b> Finding “all Sharmas in Bengaluru” is instant: jump to Bengaluru, then to S. Finding “everyone named Sharma in any city” gets no help from that ordering. Column order in a composite index works the same way, and asking for “everyone in Bengaluru” is faster by reading the whole Bengaluru section than by looking up each person one at a time.</p>`,
  diagram: {
    title: 'How Postgres answers the inbox query', w: 820, h: 300,
    nodes: [
      { id: 'q', x: 16, y: 120, w: 130, label: 'Query', sub: 'WHERE + ORDER BY', info: 'tenant_id = 42 AND status = open, newest first, LIMIT 50.' },
      { id: 'pl', x: 186, y: 120, w: 130, label: 'Planner', sub: 'uses statistics', tone: 'acc', info: 'Estimates rows from table statistics (ANALYZE) and picks the cheapest plan.' },
      { id: 'seq', x: 370, y: 40, w: 150, label: 'Seq Scan + Sort', sub: 'reads every row', tone: 'bad', info: 'Without a suitable index: read all rows, filter, sort, keep 50. Cost grows with table size.' },
      { id: 'idx', x: 370, y: 200, w: 150, label: 'Index Scan', sub: 'tickets_inbox', tone: 'ok', info: 'Jumps to tenant 42, walks entries already in created_at DESC order, stops after 50.' },
      { id: 'heap', x: 570, y: 200, w: 120, label: 'Heap pages', sub: 'fetch rows', info: 'Each index entry points to a row in the table; Postgres fetches only those pages.' },
      { id: 'res', x: 720, y: 120, w: 86, label: '50 rows', tone: 'ok', info: 'Same result either way; very different cost.' }
    ],
    edges: [{ a: 'q', b: 'pl', step: 1 }, { a: 'pl', b: 'seq', dash: true, label: 'no index', step: 2 }, { a: 'pl', b: 'idx', label: 'with index', step: 3 }, { a: 'idx', b: 'heap', step: 3 }, { a: 'heap', b: 'res', step: 4 }, { a: 'seq', b: 'res', dash: true, step: 2 }],
    steps: ['The query reaches the planner.', 'Without a matching index it must scan and sort everything.', 'With the composite partial index it seeks to the tenant and reads in order.', 'Only 50 rows are fetched and returned.'],
    caption: 'The planner chooses; your job is to give it an index that matches the question.'
  },
  illustrated: { title: 'Real numbers from 300,000 tickets', body: `<p>The Code tab loads 300,000 tickets across 200 tenants into a real Postgres 16, runs the inbox query, adds the index and runs it again. Look at two lines in each plan: the node type (Seq Scan vs Index Scan) and the buffers read. Exact timings will differ on your machine; the shape of the plan will not.</p>` },
  code: {
    title: 'Inbox query before and after the right index', file: 'postgres · psql', lang: 'sql', pg: true, deps: 'docker run -d -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16',
    intro: '<p>Runs in <code class="i">psql</code> against any Postgres 16. Output below is from a real run; <code class="i">TIMING OFF</code> keeps the plan readable.</p>',
    src: String.raw`CREATE TABLE tickets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','pending','closed')),
  priority TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  subject TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, external_id));

INSERT INTO tickets (tenant_id, external_id, status, priority, subject, metadata, created_at)
SELECT 1 + g % 200, 'EXT-' || g,
       (ARRAY['open','pending','closed','closed','closed'])[1 + (g / 200) % 5],
       (ARRAY['P1','P2','P3'])[1 + g % 3], 'ticket ' || g,
       jsonb_build_object('channel', (ARRAY['email','chat','phone'])[1 + g % 3]),
       timestamptz '2026-01-01' + g * interval '1 minute'
FROM generate_series(1, 300000) g;
ANALYZE tickets;

\echo '--- before: no inbox index'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, subject FROM tickets WHERE tenant_id = 42 AND status = 'open'
ORDER BY created_at DESC, id DESC LIMIT 50;

CREATE INDEX tickets_inbox ON tickets (tenant_id, created_at DESC, id DESC) WHERE status = 'open';

\echo '--- after: composite partial index'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, subject FROM tickets WHERE tenant_id = 42 AND status = 'open'
ORDER BY created_at DESC, id DESC LIMIT 50;

\echo '--- index sizes'
SELECT relname AS index, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class WHERE relname IN ('tickets_inbox', 'tickets_pkey') ORDER BY relname;

\echo '--- idempotent re-import of an existing row'
INSERT INTO tickets (tenant_id, external_id, status, priority, subject, created_at)
VALUES (42, 'EXT-41', 'open', 'P1', 'updated subject', now())
ON CONFLICT (tenant_id, external_id) DO UPDATE SET subject = EXCLUDED.subject
RETURNING id, external_id, subject;`,
    more: [{ note: 'The same queries from Python with psycopg 3: a connection pool, server-side parameters (never string formatting) and keyset pagination. Output from a real run against the database above.', file: 'inbox.py', key: 'py', deps: 'uv add "psycopg[binary,pool]"', src: String.raw`import os
import psycopg

URL = os.environ.get("DATABASE_URL", "postgresql://postgres@localhost:5432/postgres")

def inbox_page(conn, tenant_id: int, cursor: tuple | None, limit: int = 3):
    sql = """SELECT id, subject, created_at FROM tickets
             WHERE tenant_id = %s AND status = 'open' {after}
             ORDER BY created_at DESC, id DESC LIMIT %s"""
    if cursor:
        rows = conn.execute(sql.format(after="AND (created_at, id) < (%s, %s)"), (tenant_id, *cursor, limit)).fetchall()
    else:
        rows = conn.execute(sql.format(after=""), (tenant_id, limit)).fetchall()
    nxt = (rows[-1][2], rows[-1][0]) if len(rows) == limit else None
    return rows, nxt

with psycopg.connect(URL) as conn:
    cur, page = None, 0
    while page < 3:
        rows, cur = inbox_page(conn, 42, cur)
        page += 1
        print(f"page {page}:", [r[0] for r in rows])
        if cur is None:
            break
    # parameters are sent separately from SQL text, so this is just a string, not an injection
    evil = "42; DROP TABLE tickets; --"
    print("injection attempt:", conn.execute("SELECT count(*) FROM tickets WHERE external_id = %s", (evil,)).fetchone())` , pre: '' }]
  },
  lab: {
    title: 'Make the escalation dashboard fast', file: 'lab.sql', lang: 'sql', pg: true,
    pgSetup: String.raw`CREATE TABLE tickets (id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NOT NULL, status TEXT NOT NULL,
  priority TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL);
INSERT INTO tickets (tenant_id, status, priority, metadata, created_at)
SELECT 1 + g % 300, (ARRAY['open','closed','closed','closed'])[1 + (g / 300) % 4], (ARRAY['P1','P2','P3','P3','P3'])[1 + (g / 301) % 5],
       jsonb_build_object('escalated', (g / 300) % 7 = 0, 'region', (ARRAY['in','eu','us'])[1 + g % 3]),
       timestamptz '2026-03-01' + g * interval '30 seconds'
FROM generate_series(1, 400000) g;
ANALYZE tickets;
`,
    scenario: `<p>The support lead’s dashboard shows, per tenant, open P1 tickets that were escalated, newest first. It takes several seconds for large tenants. The table and data are created for you. Make it fast without slowing down inserts more than necessary.</p>`,
    setup: String.raw`docker run -d --name pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
psql postgresql://postgres@localhost:5432/postgres
-- paste the setup block from the solution header, then work in psql`,
    steps: ['Run the dashboard query with <code class="i">EXPLAIN (ANALYZE, BUFFERS)</code> and note the plan and buffers.', 'Decide which predicates are selective: status, priority, the JSONB escalated flag, tenant.', 'Create one partial index that serves the query exactly.', 'Re-run EXPLAIN and compare buffers read.', 'Check the index size; explain why it is small.'],
    checks: ['The plan uses your index (Index Scan or Bitmap Index Scan).', 'Buffers read drop by more than 10×.', 'The index covers only the rows the dashboard can ever show.'],
    hints: ['Escalated open P1 tickets are a tiny subset: put those conditions in the index’s WHERE clause.', 'The indexed columns should be the ones left in WHERE and ORDER BY: tenant_id and created_at.'],
    starter: String.raw`-- dashboard query
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, created_at FROM tickets
WHERE tenant_id = 7 AND status = 'open' AND priority = 'P1'
  AND (metadata->>'escalated')::boolean
ORDER BY created_at DESC LIMIT 20;

-- TODO: create the index, then run EXPLAIN again`,
    solution: String.raw`\echo '--- before'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, created_at FROM tickets
WHERE tenant_id = 7 AND status = 'open' AND priority = 'P1'
  AND (metadata->>'escalated')::boolean
ORDER BY created_at DESC LIMIT 20;

CREATE INDEX tickets_escalated_p1 ON tickets (tenant_id, created_at DESC)
WHERE status = 'open' AND priority = 'P1' AND (metadata->>'escalated')::boolean;
ANALYZE tickets;

\echo '--- after'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, created_at FROM tickets
WHERE tenant_id = 7 AND status = 'open' AND priority = 'P1'
  AND (metadata->>'escalated')::boolean
ORDER BY created_at DESC LIMIT 20;

SELECT pg_size_pretty(pg_relation_size('tickets_escalated_p1')) AS partial_index_size,
       pg_size_pretty(pg_relation_size('tickets')) AS table_size;`
  },
  design: {
    lead: '<p>Most AI products hit database limits through a few hot queries and through multi-tenancy, not through raw size. The design work is keeping hot paths index-backed, isolating tenants, and knowing when to split read and write workloads.</p>',
    scale: [{ h: 'Read replicas and pooling', p: 'Put PgBouncer in front for connection pooling (async apps open many connections) and send analytics and dashboards to a read replica.' }, { h: 'Partition big append-only tables', p: 'Partition audit logs and LLM call telemetry by month so retention is a DROP PARTITION and recent queries touch little data.' }],
    fail: [{ h: 'Missing tenant filter', p: 'One query without <code class="i">tenant_id</code> leaks data across customers. Enforce with row-level security (RLS) as a backstop to application checks.' }, { h: 'Index bloat on hot writes', p: 'Each index adds write cost. Ten speculative indexes on a high-insert table can halve throughput. Drop unused ones (see pg_stat_user_indexes).' }],
    trade: [{ h: 'JSONB vs columns', p: 'JSONB absorbs messy customer fields quickly; promote a key to a real column once you filter, join or constrain on it often.' }, { h: 'Postgres + pgvector vs a vector DB', p: 'One database is simpler to operate and keeps permissions in SQL; a dedicated vector store wins at very large scale or for specialised retrieval features (Phase 4.4).' }],
    prompt: '<p>Design the schema and indexes for storing every LLM conversation in a multi-tenant assistant: 50 customers, 2 million messages a day, kept for one year, searchable by tenant, user and date, with per-message cost.</p>',
    answer: '<ul><li>conversations (id, tenant_id, user_id, created_at, title) and messages (id, conversation_id, tenant_id, role, content, model, tokens, cost, created_at), messages partitioned by month.</li><li>Indexes: messages (tenant_id, created_at), messages (conversation_id, created_at); conversations (tenant_id, user_id, created_at DESC).</li><li>RLS on tenant_id; PII redaction policy for content.</li><li>Daily cost rollup table for dashboards; old partitions moved to cheaper storage or dropped after a year.</li></ul>'
  },
  quiz: [
    { q: 'The hot query is <code class="i">WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50</code>. Best index:', o: ['(created_at)', '(tenant_id, created_at DESC)', '(created_at, tenant_id)', 'A GIN index on tenant_id'], a: 1, why: 'Equality column first lets Postgres jump to the tenant; the second column gives the order, so it stops after 50 rows.' },
    { q: 'Why might Postgres ignore an index on <code class="i">status</code> for <code class="i">WHERE status = \'closed\'</code>?', o: ['Indexes do not work on text', '70% of rows are closed, so a sequential scan is cheaper', 'The index is corrupt', 'status is not unique'], a: 1, why: 'Low selectivity makes random index lookups more expensive than one sequential pass.' },
    { q: 'What makes a nightly import from a customer CRM safe to re-run?', o: ['DELETE everything first', 'A UNIQUE (tenant_id, external_id) constraint with INSERT ... ON CONFLICT DO UPDATE', 'Running it twice as fast', 'Disabling indexes'], a: 1, why: 'The natural key plus an upsert turns duplicates into updates.' }
  ],
  interview: [
    { q: 'A query got slow as a customer grew. How do you fix it?', a: '<p>Capture the real query and parameters, run EXPLAIN (ANALYZE, BUFFERS) on production-like data, and look for sequential scans, bad row estimates and sorts. Check statistics freshness. Design an index from the WHERE and ORDER BY (equality columns first, then sort or range), consider a partial index for a hot subset, verify the plan and buffer counts improve, and watch write latency afterwards.</p>' },
    { q: 'How do you guarantee one tenant never sees another tenant’s rows?', a: '<p>Defence in depth: tenant_id on every table, a data-access layer that always applies it, tenant derived from the verified token not from user input, and Postgres row-level security as a backstop. Add tests that try cross-tenant reads and keep them in CI.</p>' }
  ]
});

/* ===================================================================== 1.5 */
L({
  id: '1.5', title: 'Redis caching and rate limiting', minutes: 55, roles: ['be', 'fde'],
  tags: 'cache-aside · TTL · key design · stampede protection · token bucket · Lua · per-tenant limits',
  mental: 'Redis is shared memory for your whole fleet. Use it to remember expensive answers (cache-aside with a TTL) and to count what every tenant is doing right now (rate limits), atomically, across every process.',
  sim: 'bucket',
  intro: `<p>An LLM call costs real money and hundreds of milliseconds. Many requests repeat: the same FAQ, the same document classification, the same embedding. A cache in front of the model can cut both cost and latency dramatically for those, and it is the simplest of the four AI caches covered in Phase 9.2.</p>
  <p>Rate limiting is the other half. A single tenant’s runaway script, or an agent stuck in a loop, can exhaust your provider quota for every other customer. A per-tenant token bucket in Redis stops that at the door, shared across all your API pods.</p>`,
  points: [
    '<b>Cache-aside</b>: read the cache; on a miss compute the value, store it with a TTL, return it.',
    'Cache keys must include everything that changes the answer: normalised input, model, prompt version, tenant if data differs per tenant.',
    'Always set a TTL. A cache without expiry becomes a stale, ever-growing second database.',
    'Protect against stampedes: when a hot key expires, let one request recompute while others wait or get the stale value (lock with <code class="i">SET NX EX</code>).',
    'A <b>token bucket</b> allows bursts up to its capacity and a long-run rate equal to its refill rate.',
    'Make rate-limit updates atomic with a Lua script (or <code class="i">INCR</code> + <code class="i">EXPIRE</code> for a fixed window), and return 429 with Retry-After when empty.'
  ],
  concept: { title: 'Shared, fast, and forgetful by design', body: `<p>Redis keeps data in memory and executes each command atomically on a single thread, which is exactly what you need for counters shared across 50 pods. It is fast because it forgets: everything should have a TTL, and losing the whole cache must only cost you speed, never correctness.</p><p>That gives the rule for what goes in: derived data you can recompute (model answers, embeddings, sessions with a fallback) and short-lived counters. The source of truth stays in Postgres.</p>` },
  walk: [
    { h: 'Design the cache key', body: '<p>Hash the normalised input together with everything else that changes the answer. Bumping the prompt version invalidates old entries automatically.</p>', code: String.raw`import hashlib, json

def cache_key(text: str, model: str, prompt_version: str) -> str:
    norm = " ".join(text.lower().split())
    h = hashlib.sha256(json.dumps([norm, model, prompt_version]).encode()).hexdigest()[:24]
    return f"triage:v1:{h}"

print(cache_key("I was  CHARGED twice", "small-2026-10", "p7"))
print(cache_key("i was charged twice", "small-2026-10", "p7"))
print(cache_key("i was charged twice", "small-2026-10", "p8"))`, run: true, browser: true },
    { h: 'Cache-aside with a TTL', body: '<p>In production use <code class="i">redis.asyncio.from_url(...)</code>; the commands are identical.</p>', code: String.raw`def classify_cached(r, text: str) -> str:
    key = cache_key(text, MODEL, PROMPT_VERSION)
    if (hit := r.get(key)) is not None:
        return hit.decode()
    label = call_model(text)                 # the expensive part
    r.set(key, label, ex=3600)               # always with a TTL
    return label` },
    { h: 'Atomic token bucket in Lua', body: '<p>The script reads, refills, spends and writes in one atomic step, so 50 pods never race each other.</p>', lang: 'python', code: String.raw`TOKEN_BUCKET = """
local cap, rate, now, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or cap
local ts = tonumber(s[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(cap / rate) + 1)
return {allowed, tostring(tokens)}
"""` },
    { h: 'Return 429 with Retry-After', body: '<p>Tell the caller exactly when one token will be available: <code class="i">(cost − tokens) / rate</code> seconds.</p>' }
  ],
  analogy: `<p><b>A coffee shop loyalty card and a turnstile.</b> The cache is the barista who remembers your usual order: no need to read the menu again, but the memory fades if you stop coming (TTL), and a new menu (prompt version) resets it. The token bucket is a turnstile that lets a group of ten through at once but then only one person every few seconds, so one busload cannot block the entrance for everyone.</p>`,
  diagram: {
    title: 'Redis in front of the model', w: 820, h: 320,
    groups: [{ x: 160, y: 20, w: 330, h: 280, label: 'API PODS · SHARED REDIS' }],
    nodes: [
      { id: 'req', x: 16, y: 130, w: 120, label: 'Request', sub: 'tenant acme', info: 'Every request carries a verified tenant (lesson 1.3).' },
      { id: 'rl', x: 180, y: 50, w: 140, label: 'Rate limit', sub: 'token bucket', tone: 'acc', info: 'One Lua call per request: allowed, or 429 with Retry-After. Shared across every pod.' },
      { id: 'cache', x: 180, y: 160, w: 140, label: 'Cache lookup', sub: 'GET key', tone: 'acc', info: 'Key = hash of normalised input + model + prompt version.' },
      { id: 'lock', x: 180, y: 240, w: 140, label: 'Stampede lock', sub: 'SET NX EX', info: 'On a miss, only the lock holder calls the model; others wait briefly or return the stale value.' },
      { id: 'r429', x: 350, y: 50, w: 120, label: '429', sub: 'bucket empty', tone: 'bad', info: 'Empty bucket: reject before spending any provider quota.' },
      { id: 'hit', x: 350, y: 160, w: 120, label: 'Cache hit', sub: '~1 ms', tone: 'ok', info: 'Answer returned without calling the model.' },
      { id: 'llm', x: 560, y: 220, w: 140, label: 'Model call', sub: '~600 ms · $$', tone: 'fde', info: 'Only on a miss. The result is written back with a TTL.' },
      { id: 'resp', x: 700, y: 120, w: 106, label: 'Response', tone: 'ok' }
    ],
    edges: [{ a: 'req', b: 'rl', step: 1 }, { a: 'rl', b: 'r429', dash: true, step: 2 }, { a: 'rl', b: 'cache', label: 'allowed', step: 2 }, { a: 'cache', b: 'hit', step: 3 }, { a: 'cache', b: 'lock', label: 'miss', dash: true, step: 4 }, { a: 'lock', b: 'llm', step: 4 }, { a: 'llm', b: 'resp', step: 5 }, { a: 'hit', b: 'resp', step: 3 }],
    steps: ['Every request first hits the per-tenant rate limiter.', 'Empty bucket: immediate 429. Otherwise continue.', 'Cache hit: answer in about a millisecond.', 'Miss: take the stampede lock and call the model once.', 'Store the answer with a TTL and respond.'],
    caption: 'Rate limit first, cache second, model last.'
  },
  illustrated: { title: 'What a cache is worth', body: `<p>A support assistant answers 1,000,000 questions a month. About 35% are near-duplicates (password resets, invoice copies). Model calls cost $0.004 each and take 800 ms; cache hits take 2 ms.</p>
    <div class="tbl"><table><thead><tr><th></th><th>no cache</th><th>35% hit rate</th></tr></thead><tbody>
    <tr><td>model calls</td><td class="n">1,000,000</td><td class="n">650,000</td></tr>
    <tr><td>monthly model cost</td><td class="n">$4,000</td><td class="n">$2,600</td></tr>
    <tr><td>mean latency</td><td class="n">800 ms</td><td class="n">0.65 × 800 + 0.35 × 2 ≈ 521 ms</td></tr></tbody></table></div>
    <p>Exact-match caching only catches exact repeats after normalisation. Semantic caching (Phase 9.2) catches paraphrases, at the risk of returning a wrong answer for a similar-looking question.</p>` },
  code: {
    title: 'Cache-aside, a stampede lock and a Lua token bucket', file: 'redis_edge.py', deps: 'uv add redis   (tests: uv add --dev fakeredis lupa)',
    intro: '<p>Runs against fakeredis so you need no server; replace the first line with <code class="i">redis.Redis.from_url("redis://localhost:6379")</code> and nothing else changes. The clock is injected so the bucket behaviour is reproducible.</p>',
    src: String.raw`import hashlib, json, threading, time
import fakeredis

r = fakeredis.FakeRedis()          # prod: redis.Redis.from_url(os.environ["REDIS_URL"])
MODEL, PROMPT_VERSION = "small-2026-10", "p7"
model_calls = {"n": 0}

def call_model(text: str) -> str:
    model_calls["n"] += 1
    time.sleep(0.05)               # pretend this is a 50 ms model call
    return "billing" if "charge" in text.lower() else "other"

def cache_key(text: str) -> str:
    norm = " ".join(text.lower().split())
    return "triage:v1:" + hashlib.sha256(json.dumps([norm, MODEL, PROMPT_VERSION]).encode()).hexdigest()[:24]

def classify(text: str) -> str:
    key = cache_key(text)
    if (hit := r.get(key)) is not None:
        return hit.decode()
    if r.set(key + ":lock", "1", nx=True, ex=10):      # only one caller recomputes
        try:
            label = call_model(text)
            r.set(key, label, ex=3600)
            return label
        finally:
            r.delete(key + ":lock")
    for _ in range(50):                               # others wait briefly for the winner
        time.sleep(0.01)
        if (hit := r.get(key)) is not None:
            return hit.decode()
    return call_model(text)

t = time.perf_counter(); print("miss:", classify("I was CHARGED twice"), f"{(time.perf_counter() - t) * 1000:.0f} ms")
t = time.perf_counter(); print("hit: ", classify("i was charged   twice"), f"{(time.perf_counter() - t) * 1000:.1f} ms")
threads = [threading.Thread(target=classify, args=("refund my charge please",)) for _ in range(20)]
[th.start() for th in threads]; [th.join() for th in threads]
print("20 concurrent misses on one new key -> model calls so far:", model_calls["n"])
print("ttl seconds:", r.ttl(cache_key("i was charged twice")))

TOKEN_BUCKET = r.register_script("""
local cap, rate, now, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or cap
local ts = tonumber(s[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(cap / rate) + 1)
return {allowed, tostring(tokens)}
""")

def allow(tenant: str, now: float, cap: int = 5, rate: float = 1.0, cost: int = 1) -> tuple[bool, float]:
    ok, tokens = TOKEN_BUCKET(keys=[f"rl:{tenant}"], args=[cap, rate, now, cost])
    tokens = float(tokens)
    return bool(ok), 0.0 if ok else round((cost - tokens) / rate, 2)

decisions = [allow("acme", now=0.0)[0] for _ in range(7)]
print("burst of 7 at t=0  :", ["ok" if d else "429" for d in decisions])
print("t=0.5s             :", allow("acme", now=0.5))
print("t=2.0s             :", allow("acme", now=2.0))
print("other tenant at t=0:", allow("globex", now=0.0))`
  },
  lab: {
    title: 'A per-tenant token bucket with an injectable clock', file: 'bucket_lab.py', browser: true,
    scenario: `<p>Before wiring Redis in, the team wants the algorithm itself unit-tested. Implement a token bucket in plain Python with an injectable clock, support weighted costs (a 30k-token request costs more than a 1k-token one), and compute Retry-After. The same logic then moves into the Lua script.</p>`,
    steps: ['Implement <code class="i">TokenBucket(capacity, rate, clock)</code> with <code class="i">try_take(cost) -&gt; (allowed, retry_after)</code>.', 'Refill lazily on each call: <code class="i">min(capacity, tokens + elapsed × rate)</code>.', 'Reject costs larger than capacity outright, since they can never succeed.', 'Keep one bucket per tenant in a dict.', 'Run the scripted scenario and compare with the expected lines in the solution.'],
    checks: ['A burst of 10 with capacity 10 all succeed; the 11th fails with retry_after 0.5 at rate 2/s.', 'After waiting retry_after, the request succeeds.', 'Tenants do not affect each other.'],
    hints: ['Store <code class="i">tokens</code> as a float and the last refill time.', 'Retry-After for a cost c is <code class="i">(c − tokens) / rate</code>.'],
    starter: String.raw`class FakeClock:
    def __init__(self): self.t = 0.0
    def now(self): return self.t
    def advance(self, s): self.t += s

class TokenBucket:
    def __init__(self, capacity: float, rate: float, clock):
        ...

    def try_take(self, cost: float = 1.0) -> tuple[bool, float]:
        # TODO: refill, then spend or compute retry_after
        return True, 0.0

clock = FakeClock()
buckets: dict[str, TokenBucket] = {}
def check(tenant, cost=1.0):
    b = buckets.setdefault(tenant, TokenBucket(10, 2, clock))
    return b.try_take(cost)

print([check("acme")[0] for _ in range(10)])
print("11th:", check("acme"))`,
    solution: String.raw`class FakeClock:
    def __init__(self): self.t = 0.0
    def now(self): return self.t
    def advance(self, s): self.t += s

class TokenBucket:
    def __init__(self, capacity: float, rate: float, clock):
        self.capacity, self.rate, self.clock = capacity, rate, clock
        self.tokens, self.ts = capacity, clock.now()

    def try_take(self, cost: float = 1.0) -> tuple[bool, float]:
        if cost > self.capacity:
            return False, float("inf")            # can never fit: reject, do not ask to retry
        now = self.clock.now()
        self.tokens = min(self.capacity, self.tokens + (now - self.ts) * self.rate)
        self.ts = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True, 0.0
        return False, round((cost - self.tokens) / self.rate, 3)

clock = FakeClock()
buckets: dict[str, TokenBucket] = {}
def check(tenant, cost=1.0):
    b = buckets.setdefault(tenant, TokenBucket(10, 2, clock))
    return b.try_take(cost)

print("burst of 10:", all(check("acme")[0] for _ in range(10)))
ok, wait = check("acme"); print("11th:", ok, "retry_after", wait)
clock.advance(wait); print("after waiting:", check("acme"))
print("globex unaffected:", check("globex"))
print("weighted cost 4 now:", check("acme", 4))
print("cost 50 (> capacity):", check("acme", 50))`
  },
  design: {
    lead: '<p>Redis sits on the hot path of every request, so its failure modes are your failure modes. Decide up front what happens when it is slow or down, and keep it a cache, never the only copy of anything important.</p>',
    scale: [{ h: 'One call per request', p: 'Pipeline or script multiple commands so a request costs one round trip. A Lua token bucket is one call; three separate GET/SET calls are three.' }, { h: 'Cluster by key', p: 'Redis Cluster shards by key; keep a tenant’s keys together with hash tags such as <code class="i">rl:{acme}</code> when a script touches several.' }],
    fail: [{ h: 'Redis down', p: 'Choose per feature: fail open for the cache (call the model directly) and usually fail open with a local in-process limiter for rate limits, with alerts.' }, { h: 'Hot keys and stampedes', p: 'One viral question expiring at once sends thousands of requests to the model. Use locks, early refresh before expiry, or jittered TTLs.' }],
    trade: [{ h: 'Fixed window vs token bucket', p: 'Fixed windows are one INCR but allow 2× bursts at window edges; token buckets are smooth and fair; sliding-window logs are exact but cost memory per request.' }, { h: 'Requests vs tokens', p: 'LLM quotas are in tokens. Rate-limit on estimated tokens (cost = prompt + max output) for fairness, not just request counts.' }],
    prompt: '<p>Design rate limiting for an LLM platform with 300 tenants on one shared provider quota of 2 million tokens per minute, where enterprise tenants pay for guaranteed capacity.</p>',
    answer: '<ul><li>Two layers: a global token bucket matching the provider quota, and per-tenant buckets sized by plan.</li><li>Cost = estimated input tokens + max_tokens, refunded after the real usage is known.</li><li>Reserved capacity for enterprise plans; shared remainder for others; priority queue rather than instant 429 for batch jobs.</li><li>429 with Retry-After and remaining budget headers; dashboards of usage per tenant.</li></ul>'
  },
  quiz: [
    { q: 'Which belongs in an LLM answer cache key?', o: ['Only the raw user text', 'Normalised input plus model and prompt version', 'The request timestamp', 'The pod hostname'], a: 1, why: 'Anything that changes the answer must change the key; timestamps would make every key unique.' },
    { q: 'A token bucket has capacity 20 and refills 5 tokens per second. Over 10 seconds a tenant can make at most:', o: ['50 requests', '70 requests', '20 requests', '200 requests'], a: 1, why: 'The initial burst of 20 plus 5 × 10 refilled tokens.' },
    { q: 'Why implement the bucket as a Lua script in Redis?', o: ['Lua is faster than Python', 'The read-refill-write must be atomic across many pods', 'Redis cannot store floats', 'To encrypt the counter'], a: 1, why: 'Redis runs a script atomically, so concurrent requests cannot both spend the last token.' }
  ],
  interview: [
    { q: 'How would you cache LLM responses safely?', a: '<p>Only for deterministic, non-personal requests (temperature 0, no user-specific data), keyed on normalised input plus model and prompt version, with a TTL and tenant in the key when data differs per tenant. Measure hit rate and cost saved, protect hot keys from stampedes, and invalidate by bumping the version on prompt or model changes.</p>' },
    { q: 'One tenant’s agent got stuck in a loop and exhausted the shared quota. How do you prevent a repeat?', a: '<p>Per-tenant token-based rate limits in front of the provider, per-request and per-run step and spend caps inside the agent, alerts on sudden usage jumps per tenant, and a gateway that reserves capacity so one tenant cannot starve the others.</p>' }
  ]
});

/* ===================================================================== 1.6 */
L({
  id: '1.6', title: 'Queues and background jobs', minutes: 55, roles: ['be', 'fde'],
  tags: 'at-least-once · ack · visibility timeout · idempotent handlers · dead-letter queue · Celery · workers',
  mental: 'Anything slow, bursty or retryable leaves the request path and becomes a job on a queue. Queues deliver at least once, so every handler must be safe to run twice, and jobs that keep failing go to a dead-letter queue instead of looping forever.',
  sim: 'queue',
  intro: `<p>Document ingestion, re-embedding a knowledge base, nightly evaluation runs, sending follow-up emails, long agent tasks: none of these belong inside an HTTP request. A queue absorbs bursts, lets workers scale independently, and retries failures without the user waiting.</p>
  <p>The catch is delivery semantics. A worker can crash after doing the work but before acknowledging it, so the queue delivers the job again. If the handler charged a card or emailed a customer, it does so twice. Designing handlers that tolerate this is the core skill of this lesson.</p>`,
  points: [
    'Producers enqueue a small job message (ids, not big payloads); workers pull, process and <b>acknowledge</b>.',
    'Unacknowledged jobs reappear after a <b>visibility timeout</b> (SQS) or when the worker’s connection drops (RabbitMQ, Celery with acks_late).',
    'This gives <b>at-least-once</b> delivery: plan for duplicates. Exactly-once processing comes from idempotent handlers, not from the queue.',
    'Make handlers idempotent with an idempotency key stored atomically with the side effect, or by using upserts.',
    'Retry with backoff a limited number of times, then move the job to a <b>dead-letter queue</b> for inspection.',
    'Watch queue depth and age of the oldest message: growing depth means workers cannot keep up (utilisation above 1).'
  ],
  concept: { title: 'Effectively once = at least once + idempotency', body: `<p>No practical distributed queue can promise a handler runs exactly once, because “did the worker finish?” cannot always be known when it crashes. What you can build is <b>effectively once</b>: the queue may deliver twice, but the second run sees the work is already done and does nothing.</p><p>The pattern: give each job a stable id; in the same transaction as the side effect, record that id as processed; skip if it is already there.</p>` },
  walk: [
    { h: 'Producer: enqueue ids, return fast', body: '<p>The API stores the document, enqueues a job with its id and returns 202 immediately.</p>', code: String.raw`@app.post("/v1/documents", status_code=202)
async def upload(doc: DocumentIn):
    doc_id = await db.insert_document(doc)          # durable first
    await queue.enqueue("ingest", {"job_id": f"ingest:{doc_id}", "doc_id": doc_id})
    return {"document_id": doc_id, "status": "queued"}` },
    { h: 'Worker: ack only after success', body: '<p>With Celery, <code class="i">acks_late=True</code> acknowledges after the task finishes, and <code class="i">task_reject_on_worker_lost</code> redelivers if the worker dies mid-task.</p>', code: String.raw`from celery import Celery

app = Celery("triage", broker="redis://localhost:6379/0")
app.conf.update(task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1)

@app.task(bind=True, autoretry_for=(TimeoutError,), retry_backoff=True, retry_jitter=True, max_retries=5)
def ingest(self, job_id: str, doc_id: int):
    if already_done(job_id):          # idempotency check
        return "skip"
    chunks = parse_and_chunk(doc_id)
    save_chunks_and_mark_done(job_id, doc_id, chunks)   # one transaction` },
    { h: 'Idempotency in one transaction', body: '<p>The unique constraint makes the “mark done” and the work atomic: a second run fails the insert and rolls back.</p>', lang: 'sql', file: 'idempotency.sql', code: String.raw`CREATE TABLE processed_jobs (job_id TEXT PRIMARY KEY, done_at TIMESTAMPTZ DEFAULT now());

BEGIN;
INSERT INTO processed_jobs (job_id) VALUES ('ingest:4812');   -- fails if already processed
INSERT INTO chunks (doc_id, n, text) VALUES (4812, 0, '...'), (4812, 1, '...');
COMMIT;` },
    { h: 'Dead-letter after N attempts', body: '<p>Poison messages (a corrupt PDF, a bug for one input shape) must not block the queue or retry forever. After the retry budget, park them with the error for a human.</p>' }
  ],
  analogy: `<p><b>A restaurant ticket rail.</b> The waiter clips an order ticket to the rail and goes back to the floor (202 Accepted). Cooks take tickets when free. If a cook walks out mid-dish, the ticket goes back on the rail and another cook makes it. A sensible kitchen writes the table number on the plate so a duplicate dish is noticed and not served twice (idempotency). Tickets nobody can cook (“fish we do not stock”) go to the manager, not back on the rail forever (dead-letter).</p>`,
  diagram: {
    title: 'At-least-once delivery with idempotent workers', w: 820, h: 320,
    nodes: [
      { id: 'api', x: 16, y: 130, w: 120, label: 'API', sub: '202 Accepted', info: 'Stores the record, enqueues a small job, returns immediately.' },
      { id: 'q', x: 180, y: 130, w: 140, h: 60, label: 'Queue', sub: 'visibility timeout', tone: 'acc', info: 'Delivers each job to one worker. If no ack arrives in time, the job becomes visible again.' },
      { id: 'w1', x: 370, y: 50, w: 130, label: 'Worker A', sub: 'crashes mid-job', tone: 'bad', info: 'Did the work but died before acknowledging: the job will be redelivered.' },
      { id: 'w2', x: 370, y: 200, w: 130, label: 'Worker B', sub: 'redelivery', tone: 'ok', info: 'Gets the same job again. The idempotency check sees it is done, or completes it if A had not committed.' },
      { id: 'db', x: 560, y: 130, w: 140, h: 60, label: 'DB transaction', sub: 'work + job_id', tone: 'be', info: 'Side effects and the processed-job record commit together, so a job is applied once.' },
      { id: 'dlq', x: 180, y: 250, w: 140, label: 'Dead-letter queue', sub: 'after N tries', tone: 'bad', info: 'Jobs that fail every retry are parked with their error for a person to inspect and replay.' },
      { id: 'mon', x: 720, y: 40, w: 90, label: 'Metrics', sub: 'depth · age', info: 'Queue depth, oldest message age, failure and DLQ rates.' }
    ],
    edges: [{ a: 'api', b: 'q', label: 'enqueue', step: 1 }, { a: 'q', b: 'w1', step: 2 }, { a: 'w1', b: 'db', dash: true, label: 'no ack', step: 3 }, { a: 'q', b: 'w2', label: 'redeliver', step: 4 }, { a: 'w2', b: 'db', label: 'idempotent', step: 4 }, { a: 'q', b: 'dlq', dash: true, label: 'poison', step: 5 }, { a: 'q', b: 'mon', dash: true }],
    steps: ['The API enqueues a job and returns 202.', 'Worker A receives the job.', 'Worker A crashes before acknowledging.', 'After the visibility timeout the job goes to worker B; the idempotency key prevents double effects.', 'A job that fails every attempt lands in the dead-letter queue.'],
    caption: 'Duplicates are expected; idempotency makes them harmless.'
  },
  illustrated: { title: 'Sizing workers with Little’s law', body: `<p>An enterprise uploads 120 documents per minute during business hours; ingestion takes about 6 seconds each.</p>
    <div class="tbl"><table><thead><tr><th>quantity</th><th>value</th></tr></thead><tbody>
    <tr><td>work arriving per second</td><td class="n">120 / 60 × 6 s = 12 worker-seconds per second</td></tr>
    <tr><td>minimum workers (ρ = 1)</td><td class="n">12</td></tr>
    <tr><td>workers at 70% utilisation</td><td class="n">12 / 0.7 ≈ 18</td></tr>
    <tr><td>with 10 workers</td><td class="n">ρ = 1.2: the queue grows by about 2 docs per second until the burst ends</td></tr></tbody></table></div>
    <p>Utilisation near 1 makes waits explode even when the queue is technically stable. Try it in the simulator.</p>` },
  code: {
    title: 'At-least-once delivery, idempotency and a dead-letter queue', file: 'queue_sim.py', browser: true,
    intro: '<p>A faithful in-process model of an SQS-style queue: visibility timeout, ack, redelivery and a dead-letter queue, with workers that crash at random after doing their work. Compare the naive handler with the idempotent one. Pure asyncio, so it runs in your browser.</p>',
    src: String.raw`import asyncio, random

class Queue:
    """SQS-like: a received message is hidden until acked or until its visibility timeout expires."""
    def __init__(self, visibility: float, max_receives: int):
        self.visibility, self.max_receives = visibility, max_receives
        self.ready: list[dict] = []
        self.inflight: dict[str, tuple[dict, float]] = {}
        self.dlq: list[dict] = []

    def send(self, body: dict):
        self.ready.append({"id": body["job_id"], "body": body, "receives": 0})

    def receive(self, now: float):
        for mid, (m, deadline) in list(self.inflight.items()):      # expired -> visible again
            if now >= deadline:
                del self.inflight[mid]
                (self.dlq if m["receives"] >= self.max_receives else self.ready).append(m)
        if not self.ready:
            return None
        m = self.ready.pop(0)
        m["receives"] += 1
        self.inflight[m["id"]] = (m, now + self.visibility)
        return m

    def ack(self, m: dict):
        self.inflight.pop(m["id"], None)

async def run(handler_name: str, seed: int = 4):
    random.seed(seed)
    q, effects, processed = Queue(visibility=0.05, max_receives=3), [], set()
    for i in range(20):
        q.send({"job_id": f"email:{i}", "to": f"user{i}@acme.com", "poison": i == 13})

    def naive(body):
        effects.append(body["to"])                # send the email

    def idempotent(body):
        if body["job_id"] in processed:           # in real life: same DB transaction as the effect
            return
        effects.append(body["to"])
        processed.add(body["job_id"])

    handler = naive if handler_name == "naive" else idempotent
    loop = asyncio.get_running_loop(); start = loop.time()

    async def worker():
        while True:
            m = q.receive(loop.time() - start)
            if m is None:
                if not q.inflight:
                    return
                await asyncio.sleep(0.01); continue
            if m["body"]["poison"]:
                continue                          # handler throws every time: never acked
            handler(m["body"])
            await asyncio.sleep(0.001)
            if random.random() < 0.25:
                continue                          # worker "crashes" after the side effect, before ack
            q.ack(m)

    await asyncio.gather(*(worker() for _ in range(4)))
    dupes = len(effects) - len(set(effects))
    print(f"{handler_name:<11} emails sent={len(effects):<3} duplicates={dupes:<3} dead-lettered={[m['id'] for m in q.dlq]}")

async def main():
    await run("naive")
    await run("idempotent")

asyncio.run(main())`
  },
  lab: {
    title: 'Make the ingest worker safe to retry', file: 'ingest_lab.py', browser: true,
    scenario: `<p>A document-ingest worker parses a file, writes chunks, then updates the document status. In production some documents ended up with duplicated chunks, and one malformed PDF retried 4,000 times overnight. Fix both with an idempotency check and a retry budget with a dead-letter list.</p>`,
    steps: ['Run the starter: note the duplicate chunk count and the retry count for doc 7.', 'Make <code class="i">handle()</code> idempotent: skip if the job id is already in <code class="i">done_jobs</code>, and record it together with the chunks.', 'Cap retries at 3 per job; after that append to <code class="i">dead_letter</code> with the error message.', 'Re-run and confirm: zero duplicate chunks, doc 7 in the dead-letter list, every other doc processed once.'],
    checks: ['duplicate chunks: 0', 'dead letter: exactly doc 7 with its error', 'processed documents: 9'],
    hints: ['Simulate “one transaction” by writing chunks and adding to done_jobs in the same block, before the possible crash.', 'Track attempts per job id in a dict.'],
    starter: String.raw`import random
random.seed(11)
chunks, done_jobs, dead_letter, attempts = [], set(), [], {}
jobs = [{"job_id": f"ingest:{d}", "doc_id": d} for d in range(10)]

def parse(doc_id):
    if doc_id == 7:
        raise ValueError("malformed PDF: xref table missing")
    return [f"doc{doc_id}-chunk{n}" for n in range(3)]

def handle(job):
    # TODO: idempotency + retry budget
    chunks.extend(parse(job["doc_id"]))

queue = list(jobs)
deliveries = 0
while queue and deliveries < 200:
    job = queue.pop(0); deliveries += 1
    try:
        handle(job)
        if random.random() < 0.3:      # crash after work, before ack -> redelivered
            queue.append(job); continue
    except Exception as e:
        queue.append(job)               # naive: retry forever
print("deliveries:", deliveries, "duplicate chunks:", len(chunks) - len(set(chunks)),
      "dead letter:", dead_letter)`,
    solution: String.raw`import random
random.seed(11)
chunks, done_jobs, dead_letter, attempts = [], set(), [], {}
jobs = [{"job_id": f"ingest:{d}", "doc_id": d} for d in range(10)]
MAX_ATTEMPTS = 3

def parse(doc_id):
    if doc_id == 7:
        raise ValueError("malformed PDF: xref table missing")
    return [f"doc{doc_id}-chunk{n}" for n in range(3)]

def handle(job):
    if job["job_id"] in done_jobs:
        return "skip"
    new = parse(job["doc_id"])
    chunks.extend(new); done_jobs.add(job["job_id"])      # "one transaction"
    return "done"

queue = list(jobs)
deliveries = 0
while queue and deliveries < 200:
    job = queue.pop(0); deliveries += 1
    attempts[job["job_id"]] = attempts.get(job["job_id"], 0) + 1
    try:
        handle(job)
        if random.random() < 0.3:
            queue.append(job); continue
    except Exception as e:
        if attempts[job["job_id"]] >= MAX_ATTEMPTS:
            dead_letter.append((job["job_id"], str(e)))
        else:
            queue.append(job)
print("deliveries:", deliveries, "duplicate chunks:", len(chunks) - len(set(chunks)))
print("dead letter:", dead_letter)
print("processed documents:", len(done_jobs))`
  },
  design: {
    lead: '<p>Queues turn spiky, slow and failure-prone work into a steady stream that workers can scale to. The design choices are which broker, what delivery guarantees you rely on, how you size workers, and how long-running agent work fits in.</p>',
    scale: [{ h: 'Scale workers on queue depth', p: 'Autoscale workers on queue length or oldest-message age (KEDA in Kubernetes) rather than CPU, since workers mostly wait on models and I/O.' }, { h: 'Priorities and fairness', p: 'Separate queues per priority or per tenant tier so one customer’s 50,000-document backfill does not delay everyone’s interactive jobs.' }],
    fail: [{ h: 'Poison messages', p: 'Without a retry cap, one bad input loops forever and burns money. Always cap and dead-letter, and alert on DLQ growth.' }, { h: 'Lost work on deploys', p: 'Workers killed mid-job lose work unless jobs are acked late and handlers are idempotent. Handle SIGTERM: stop taking new jobs, finish current ones.' }],
    trade: [{ h: 'Redis/Celery vs SQS vs Kafka', p: 'Celery or RQ on Redis is quick to start; SQS is managed and durable; Kafka is a durable log for high-volume event streams and replay, but more to operate.' }, { h: 'Queue vs durable workflow', p: 'A queue is great for independent jobs. Multi-step agent runs that wait for humans or last hours fit a durable execution engine such as Temporal (Phase 9.9).' }],
    prompt: '<p>A customer migrates 2 million documents into your RAG system over one weekend while daily users keep uploading. Design the ingestion pipeline.</p>',
    answer: '<ul><li>Two queues: interactive uploads (high priority) and bulk backfill (low priority, rate-limited).</li><li>Small jobs referencing object-storage paths; idempotent handlers keyed by document hash so retries and re-uploads are safe.</li><li>Workers autoscale on queue age; embedding calls go through the shared token-bucket limiter.</li><li>DLQ with a replay tool; progress dashboard for the customer showing processed, failed and remaining.</li></ul>'
  },
  quiz: [
    { q: 'A worker charges a card, then crashes before acknowledging. With at-least-once delivery, what happens next?', o: ['The job is lost', 'The job is redelivered, so the handler must detect it already charged', 'The queue rolls back the charge', 'Nothing, queues are exactly-once'], a: 1, why: 'Unacked jobs come back. Idempotency is your responsibility.' },
    { q: 'What is a dead-letter queue for?', o: ['Jobs from deleted users', 'Jobs that failed every retry, kept for inspection instead of looping', 'Low-priority jobs', 'Archived logs'], a: 1, why: 'It stops poison messages from consuming workers forever while keeping them for diagnosis.' },
    { q: 'Arrivals need 12 worker-seconds per second. With 10 workers the queue:', o: ['Stays empty', 'Grows steadily while the load lasts', 'Shrinks', 'Crashes the broker immediately'], a: 1, why: 'Utilisation is 1.2: demand exceeds capacity, so backlog accumulates.' }
  ],
  interview: [
    { q: 'How do you get exactly-once processing from a queue?', a: '<p>You do not get it from the queue. You accept at-least-once delivery and make handlers idempotent: a stable job id recorded in the same transaction as the side effect, upserts instead of inserts, and idempotency keys when calling external APIs. Then duplicates are harmless.</p>' },
    { q: 'When would you not use a queue?', a: '<p>When the user needs the result synchronously and it is fast enough, such as a 300 ms classification behind a streaming UI. Or when the workflow has many dependent steps, waits and human approvals, where a durable workflow engine models it better than a chain of jobs.</p>' }
  ]
});

/* ===================================================================== 1.7 */
L({
  id: '1.7', title: 'Reliability: timeouts, retries, idempotency, breakers', minutes: 60, roles: ['be', 'fde'],
  tags: 'timeouts · exponential backoff · jitter · tenacity · idempotency keys · circuit breakers · fallbacks',
  mental: 'Every network call can hang, fail or succeed twice. Put a timeout on everything, retry only what is safe with exponential backoff and jitter, make writes idempotent with keys, and stop calling a dependency that is clearly down.',
  sim: 'retry',
  intro: `<p>AI systems depend on more remote services than most software: model providers, vector databases, customer APIs, tools. Each fails differently. Providers return 429 and 529 under load, regional outages happen, and a slow upstream can tie up every worker you have.</p>
  <p>These four patterns are what interviewers mean by “production-ready”. They are also what an FDE adds in week one of a pilot, when the demo meets the customer’s real network.</p>`,
  points: [
    'Set explicit timeouts on every call (connect, read, total). Library defaults are often none or minutes.',
    'Retry only transient failures (timeouts, 429, 502, 503, 504, connection resets), never validation errors (400, 422) or auth failures (401, 403).',
    'Exponential backoff with <b>full jitter</b>: wait a random time between 0 and min(cap, base × 2ⁿ). Jitter prevents clients retrying in synchronized waves.',
    'Retries need an overall budget: a maximum attempt count and a deadline for the whole operation.',
    'Retrying a POST is only safe with an <code class="i">Idempotency-Key</code> that the server uses to return the original result.',
    'A <b>circuit breaker</b> stops calls to a failing dependency for a cool-down period, then lets a trial request through (half-open). Pair it with a fallback.'
  ],
  concept: { title: 'Fail fast, retry gently, never double-charge', body: `<p>A request that hangs for 120 seconds is worse than one that fails in 2: it holds a worker, a connection and the user’s patience. Timeouts turn hangs into failures you can handle.</p><p>Retries turn transient failures into success, but synchronized retries from thousands of clients become a self-inflicted outage the moment the provider recovers. Jitter spreads them out, and a circuit breaker stops sending traffic at all while the dependency is clearly down. Idempotency keys make the retries safe for operations that change things.</p>` },
  walk: [
    { h: 'Timeouts everywhere', body: '<p>httpx lets you set each phase separately. Also bound the whole operation with <code class="i">asyncio.timeout</code> (lesson 0.2).</p>', code: String.raw`import httpx

client = httpx.AsyncClient(timeout=httpx.Timeout(connect=2.0, read=30.0, write=10.0, pool=5.0))
# read timeout is per chunk received; long streams also need an overall deadline` },
    { h: 'Retries with tenacity', body: '<p>Declarative policy: which errors, how many attempts, how long to wait.</p>', code: String.raw`from tenacity import retry, retry_if_exception, stop_after_attempt, stop_after_delay, wait_random_exponential

RETRYABLE = {429, 500, 502, 503, 504, 529}

def transient(e: BaseException) -> bool:
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code in RETRYABLE
    return isinstance(e, (httpx.TimeoutException, httpx.TransportError))

@retry(retry=retry_if_exception(transient), wait=wait_random_exponential(multiplier=0.5, max=20),
       stop=stop_after_attempt(5) | stop_after_delay(60), reraise=True)
async def call_model(payload: dict) -> dict:
    r = await client.post("/v1/messages", json=payload)
    r.raise_for_status()
    return r.json()` },
    { h: 'Idempotency keys for writes', body: '<p>The client generates one key per logical operation and reuses it on every retry. The server stores the first response under that key and replays it.</p>', code: String.raw`import uuid
key = str(uuid.uuid4())                       # one per logical refund, reused on retries
r = await client.post("/v1/refunds", json={"ticket_id": 4812, "amount_cents": 4800},
                      headers={"Idempotency-Key": key})` },
    { h: 'Circuit breaker states', body: `<div class="tbl"><table><thead><tr><th>state</th><th>behaviour</th><th>moves to</th></tr></thead><tbody>
      <tr><td>closed</td><td>calls pass; failures are counted</td><td>open after N consecutive failures</td></tr>
      <tr><td>open</td><td>calls fail instantly, fallback used</td><td>half-open after the cool-down</td></tr>
      <tr><td>half-open</td><td>one trial call allowed</td><td>closed on success, open on failure</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>Calling a busy helpline.</b> You hang up after a few minutes on hold instead of waiting all day (timeout). You call back later, not every second, and not at exactly the same moment as everyone else who was cut off (backoff with jitter). You quote your reference number so they do not open a second case (idempotency key). If the line has been dead all morning, you stop calling and use the website instead (circuit breaker and fallback).</p>`,
  diagram: {
    title: 'A resilient call path to a model provider', w: 820, h: 300,
    nodes: [
      { id: 'app', x: 16, y: 120, w: 120, label: 'Service', sub: 'needs an answer', info: 'Any code path that calls a remote dependency.' },
      { id: 'cb', x: 170, y: 120, w: 130, label: 'Circuit breaker', sub: 'three states', tone: 'acc', info: 'When open, fails instantly without touching the network.' },
      { id: 'rt', x: 340, y: 120, w: 130, label: 'Retry policy', sub: 'backoff + jitter', tone: 'acc', info: 'Retries transient errors within an attempt and time budget.' },
      { id: 'to', x: 510, y: 120, w: 120, label: 'Timeout', sub: 'connect · read', tone: 'acc', info: 'Every attempt has a hard limit.' },
      { id: 'prov', x: 670, y: 50, w: 136, label: 'Primary model', sub: 'provider A', tone: 'fde', info: 'Usually fine; sometimes 429, 529 or slow.' },
      { id: 'fb', x: 670, y: 200, w: 136, label: 'Fallback', sub: 'backup answer', tone: 'ok', info: 'Used when the breaker is open or retries are exhausted: another provider, a smaller model, a cached answer, or a graceful message.' }
    ],
    edges: [{ a: 'app', b: 'cb', step: 1 }, { a: 'cb', b: 'rt', label: 'closed', step: 2 }, { a: 'rt', b: 'to', step: 2 }, { a: 'to', b: 'prov', step: 3 }, { a: 'cb', b: 'fb', dash: true, label: 'open', step: 4, bend: 40 }, { a: 'rt', b: 'fb', dash: true, label: 'exhausted', step: 4 }],
    steps: ['The service asks the breaker for permission.', 'If closed, the retry policy runs attempts, each under a timeout.', 'Attempts reach the primary provider.', 'If the breaker is open or retries run out, the fallback answers.'],
    caption: 'Breaker outside, retries inside, a timeout on every attempt, and always a fallback.'
  },
  illustrated: { title: 'Why jitter matters', body: `<p>1,500 clients lose a provider for 5 seconds. Server capacity after recovery is 400 requests per second.</p>
    <div class="tbl"><table><thead><tr><th>strategy</th><th>what happens at recovery</th></tr></thead><tbody>
    <tr><td>immediate retry</td><td>clients hammer the server during the outage and all arrive together at recovery</td></tr>
    <tr><td>fixed 1 s</td><td>clients stay in lockstep: 1,500 requests land in the same second, 3.75× capacity</td></tr>
    <tr><td>exponential, no jitter</td><td>fewer attempts, but still synchronized waves</td></tr>
    <tr><td>exponential + full jitter</td><td>retries spread across each window; load stays near capacity</td></tr></tbody></table></div>
    <p>The simulator runs exactly this scenario with your numbers.</p>` },
  code: {
    title: 'Retries, idempotency keys and a circuit breaker against a flaky provider', file: 'resilient_client.py', deps: 'uv add httpx tenacity',
    intro: '<p>A mock provider fails in realistic ways: 529 overloaded, then a timeout, then success. A mock refunds API stores responses by idempotency key. A small circuit breaker opens after repeated failures. Output from a real run.</p>',
    src: String.raw`import asyncio, uuid
import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_random_exponential

script = iter([529, "timeout", 200, 200])
refunds_done: dict[str, dict] = {}
attempts = {"refund": 0}

async def provider(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/v1/refunds":
        attempts["refund"] += 1
        key = request.headers["idempotency-key"]
        if key not in refunds_done:                     # first time: perform the side effect
            refunds_done[key] = {"refund_id": f"rf_{len(refunds_done) + 1}", "amount_cents": 4800}
        if attempts["refund"] == 1:
            raise httpx.ReadTimeout("response lost on the way back")   # work done, reply lost
        return httpx.Response(200, json=refunds_done[key])
    step = next(script, 200)
    if step == "timeout":
        raise httpx.ReadTimeout("provider too slow")
    return httpx.Response(step, json={"label": "billing"} if step == 200 else {"error": "overloaded"})

RETRYABLE = {429, 500, 502, 503, 504, 529}
def transient(e: BaseException) -> bool:
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code in RETRYABLE
    return isinstance(e, (httpx.TimeoutException, httpx.TransportError))

def log_retry(state):
    print(f"  attempt {state.attempt_number} failed: {type(state.outcome.exception()).__name__}")

async def with_retries(fn):
    async for attempt in AsyncRetrying(retry=retry_if_exception(transient), stop=stop_after_attempt(5),
                                       wait=wait_random_exponential(multiplier=0.01, max=0.1),
                                       before_sleep=log_retry, reraise=True):
        with attempt:
            return await fn()

class CircuitBreaker:
    def __init__(self, threshold: int, cooldown: float):
        self.threshold, self.cooldown, self.failures, self.opened_at = threshold, cooldown, 0, None

    def state(self, now: float) -> str:
        if self.opened_at is None:
            return "closed"
        return "half-open" if now - self.opened_at >= self.cooldown else "open"

    def record(self, ok: bool, now: float):
        if ok:
            self.failures, self.opened_at = 0, None
        else:
            self.failures += 1
            if self.failures >= self.threshold or self.state(now) == "half-open":
                self.opened_at = now

async def main():
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider), base_url="https://llm.example",
                                 timeout=httpx.Timeout(5.0, connect=1.0)) as client:
        async def classify():
            r = await client.post("/v1/classify", json={"text": "charged twice"})
            r.raise_for_status()
            return r.json()
        print("classify ->", await with_retries(classify))

        key = str(uuid.uuid4())                         # one key for the logical refund
        async def refund():
            r = await client.post("/v1/refunds", json={"ticket_id": 4812}, headers={"Idempotency-Key": key})
            r.raise_for_status()
            return r.json()
        print("refund   ->", await with_retries(refund), "| refunds actually created:", len(refunds_done))

    cb, t = CircuitBreaker(threshold=3, cooldown=10.0), 0.0
    for ok in [False, False, False, None, None, True]:
        st = cb.state(t)
        if st == "open":
            print(f"  t={t:>4}s breaker open -> fallback answer, provider not called")
        else:
            cb.record(bool(ok), t)
            print(f"  t={t:>4}s {st:<9} call {'ok' if ok else 'failed'} -> now {cb.state(t)}")
        t += 4.0

asyncio.run(main())`
  },
  lab: {
    title: 'A circuit breaker with full-jitter backoff', file: 'breaker_lab.py', browser: true,
    scenario: `<p>Your agent calls a customer’s inventory API as a tool. During their maintenance window it fails for about 30 seconds, and the agent currently retries every 100 ms, which their ops team has complained about. Build the client-side protection with a fake clock so it can be tested deterministically.</p>`,
    steps: ['Implement <code class="i">backoff(attempt)</code> returning a full-jitter delay with base 0.5 s and cap 8 s.', 'Implement a breaker that opens after 3 consecutive failures, stays open 10 s, then allows one half-open trial.', 'Write <code class="i">call_tool()</code>: if the breaker is open, return a fallback string without calling the API.', 'Simulate 60 seconds of calls against the fake API (down from t=5 s to t=35 s) and count real API calls.', 'Compare against the naive 100 ms retry loop.'],
    checks: ['The API receives far fewer calls during the outage than the naive loop (the solution prints both).', 'Calls succeed again within one cool-down after the API recovers.', 'Every delay is between 0 and the cap.'],
    hints: ['Full jitter: <code class="i">random.uniform(0, min(cap, base * 2 ** attempt))</code>.', 'Reset the attempt counter after a success.'],
    starter: String.raw`import random
random.seed(2)
clock = {"t": 0.0}
api_calls = {"n": 0}

def inventory_api():
    api_calls["n"] += 1
    if 5 <= clock["t"] < 35:
        raise ConnectionError("maintenance")
    return {"sku": "A-17", "stock": 42}

def backoff(attempt, base=0.5, cap=8.0):
    # TODO: full jitter
    return 0.1

class Breaker:
    # TODO: closed / open / half-open with threshold 3 and cooldown 10 s
    def allow(self): return True
    def record(self, ok): pass

def simulate(use_breaker: bool):
    clock["t"], api_calls["n"] = 0.0, 0
    br, attempt, fallbacks = Breaker(), 0, 0
    while clock["t"] < 60:
        # TODO: use the breaker and backoff
        try:
            inventory_api(); attempt = 0; clock["t"] += 1.0
        except ConnectionError:
            clock["t"] += 0.1
    return api_calls["n"], fallbacks

print("naive:", simulate(False))`,
    solution: String.raw`import random
random.seed(2)
clock = {"t": 0.0}
api_calls = {"n": 0}

def inventory_api():
    api_calls["n"] += 1
    if 5 <= clock["t"] < 35:
        raise ConnectionError("maintenance")
    return {"sku": "A-17", "stock": 42}

def backoff(attempt, base=0.5, cap=8.0):
    return random.uniform(0, min(cap, base * 2 ** attempt))

class Breaker:
    def __init__(self, threshold=3, cooldown=10.0):
        self.threshold, self.cooldown, self.fails, self.opened = threshold, cooldown, 0, None
    def state(self):
        if self.opened is None: return "closed"
        return "half-open" if clock["t"] - self.opened >= self.cooldown else "open"
    def allow(self):
        return self.state() != "open"
    def record(self, ok):
        if ok:
            self.fails, self.opened = 0, None
        else:
            self.fails += 1
            if self.fails >= self.threshold or self.state() == "half-open":
                self.opened = clock["t"]

def simulate(use_breaker: bool):
    clock["t"], api_calls["n"] = 0.0, 0
    br, attempt, fallbacks, recovered_at = Breaker(), 0, 0, None
    while clock["t"] < 60:
        if use_breaker and not br.allow():
            fallbacks += 1; clock["t"] += 1.0           # serve "stock unknown, try later"
            continue
        try:
            inventory_api(); attempt = 0
            if use_breaker: br.record(True)
            if recovered_at is None and clock["t"] >= 35: recovered_at = round(clock["t"], 1)
            clock["t"] += 1.0
        except ConnectionError:
            if use_breaker:
                br.record(False)
                clock["t"] += backoff(attempt); attempt += 1
            else:
                clock["t"] += 0.1
    return {"api_calls": api_calls["n"], "fallbacks": fallbacks, "first_success_after_outage": recovered_at}

print("naive 100 ms loop :", simulate(False))
print("breaker + jitter  :", simulate(True))`
  },
  design: {
    lead: '<p>Reliability is a property of the whole call graph. A single dependency without a timeout can exhaust every worker; retries at five layers multiply into a storm. The design work is choosing where each pattern lives and what the user sees when everything fails.</p>',
    scale: [{ h: 'Retry at one layer', p: 'If the SDK, your client, the gateway and the job queue all retry 5 times, one failure becomes 625 attempts. Pick one layer, usually closest to the caller that knows the deadline.' }, { h: 'Retry budgets', p: 'Cap retries as a share of traffic (for example 10%) so a degraded dependency is not hit with double load.' }],
    fail: [{ h: 'Retrying non-idempotent writes', p: 'Retrying a POST that sends an email or issues a refund without an idempotency key duplicates side effects.' }, { h: 'Timeouts longer than the caller’s', p: 'If the client gives up at 10 s but your server waits 60 s on the model, you burn capacity on answers nobody will read. Propagate deadlines.' }],
    trade: [{ h: 'Fallback quality', p: 'A smaller model or cached answer keeps the product up but lowers quality. Decide per feature, and tell the user when they get a degraded answer.' }, { h: 'Breaker sensitivity', p: 'A twitchy breaker flaps on brief blips; a sluggish one keeps hammering a dead service. Base thresholds on error rate over a window, not just consecutive failures, at scale.' }],
    prompt: '<p>Your assistant depends on one LLM provider, a vector DB and a customer CRM API. The provider has a 20-minute regional outage. Walk through what your system does, minute by minute.</p>',
    answer: '<ul><li>Seconds 0 to 30: timeouts and jittered retries absorb blips; errors rise on dashboards.</li><li>About minute 1: the breaker for provider A opens; the gateway routes to provider B or a smaller model; responses are tagged as degraded.</li><li>Writes such as CRM updates queue with idempotency keys instead of failing.</li><li>Half-open trials detect recovery; traffic shifts back gradually.</li><li>Afterwards: an incident review, eval comparison of fallback answers, and runbook updates.</li></ul>'
  },
  quiz: [
    { q: 'Which errors should a model client retry automatically?', o: ['400 and 422', '401 and 403', '429, 503, 529 and timeouts', 'All errors'], a: 2, why: 'Only transient failures can succeed on retry; 4xx validation and auth errors will fail again.' },
    { q: 'What does jitter add to exponential backoff?', o: ['Longer waits', 'Random spread so many clients do not retry at the same instant', 'Encryption', 'A maximum attempt count'], a: 1, why: 'Synchronized retries recreate the overload; randomness spreads them.' },
    { q: 'A refund POST timed out. Retrying is safe only if:', o: ['The timeout was short', 'The request carries the same Idempotency-Key and the server honours it', 'You wait 10 seconds', 'You use PUT'], a: 1, why: 'The first request may have succeeded; the key lets the server return that result instead of refunding again.' }
  ],
  interview: [
    { q: 'Design the retry strategy for calling an LLM API from a high-traffic service.', a: '<p>Explicit timeouts per attempt and an overall deadline from the caller; retry only 429, 5xx, 529 and network errors; exponential backoff with full jitter honoring Retry-After; at most 3 to 5 attempts; one retrying layer only; a circuit breaker per provider and region; fallback to a second provider or smaller model through a gateway; metrics on retry rate and breaker state.</p>' },
    { q: 'How does a circuit breaker help the dependency, not just you?', a: '<p>When a service is struggling, continued traffic, especially retries, keeps it down. The breaker sheds that load instantly, giving it room to recover, and probes gently in half-open state instead of sending a flood when it comes back.</p>' }
  ]
});

/* ===================================================================== 1.8 */
L({
  id: '1.8', title: 'Service boundaries: gRPC and webhooks', minutes: 50, roles: ['fde', 'be'],
  tags: 'gRPC · protobuf · streaming RPC · webhooks · HMAC signatures · replay protection · event ids',
  mental: 'Inside your platform, services talk over typed, fast RPC such as gRPC. Across company boundaries, you notify customers with webhooks: signed HTTP callbacks they can verify, deduplicate and retry.',
  intro: `<p>As soon as an AI system has more than one service (an API, a retrieval service, an inference service), you need contracts between them. gRPC with protobuf is common for internal, latency-sensitive calls, and model servers such as Triton and many inference gateways expose gRPC endpoints.</p>
  <p>Across the boundary to customers, webhooks are how you say “your summary is ready” or “the agent needs approval”. FDEs build webhook receivers into customer systems constantly, and a receiver that does not verify signatures or handle duplicates is a security finding waiting to happen.</p>`,
  points: [
    'A <code class="i">.proto</code> file defines messages and services; code generators create typed clients and servers in many languages.',
    'gRPC runs over HTTP/2: binary messages, multiplexed connections, deadlines and server, client or bidirectional streaming.',
    'Evolve protobuf safely: add new fields with new numbers, never reuse or renumber existing ones.',
    'A webhook is a POST you send to a customer URL when an event happens. Include an event id, type, timestamp and a small payload or a link.',
    'Sign the raw body with HMAC-SHA256 and a per-customer secret; include a timestamp in the signed content and reject old timestamps to stop replays.',
    'Receivers must verify with a constant-time comparison, deduplicate by event id, respond 2xx fast and do the work asynchronously.'
  ],
  concept: { title: 'Typed inside, signed outside', body: `<p>Inside your network you control both ends, so you optimize for speed and type safety: protobuf contracts, generated stubs, deadlines on every call. Across a company boundary you control only your end, so you optimize for verifiability and tolerance: the receiver must be able to prove a message came from you and was not altered or replayed, and your sender must survive their downtime with retries.</p>` },
  walk: [
    { h: 'Define the internal contract', body: '<p>Field numbers are the wire identity of each field; names can change, numbers cannot.</p>', lang: 'proto', file: 'triage.proto', code: String.raw`syntax = "proto3";
package triage.v1;

service Triage {
  rpc Classify (ClassifyRequest) returns (ClassifyResponse);
  rpc StreamSummary (ClassifyRequest) returns (stream Token);
}

message ClassifyRequest { int64 ticket_id = 1; string text = 2; }
message ClassifyResponse { string label = 1; float confidence = 2; }
message Token { string text = 1; }` },
    { h: 'Generate stubs', body: '<p>One command produces message classes and client/server stubs.</p>', lang: 'bash', file: 'terminal', code: String.raw`uv add grpcio grpcio-tools
uv run python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. triage.proto` },
    { h: 'Sign every webhook', body: '<p>The signature covers the timestamp and the exact raw bytes of the body. Verifying a re-serialized JSON object instead of raw bytes is the most common receiver bug.</p>', code: String.raw`import hmac, hashlib, time

def sign(secret: bytes, body: bytes, ts: int) -> str:
    mac = hmac.new(secret, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"` },
    { h: 'Verify, deduplicate, acknowledge fast', body: '<p>Return 2xx within a few seconds, then process on a queue (lesson 1.6). Senders retry on timeouts and non-2xx, so duplicates will arrive.</p>' }
  ],
  analogy: `<p><b>Internal mail versus registered post.</b> Inside the office, colleagues hand each other forms with standard fields (protobuf) and expect a reply by a deadline. Letters to other companies go by registered post with a wax seal (HMAC signature) and a date stamp (timestamp): the recipient checks the seal, refuses letters stamped weeks ago (replay), and files the reference number so the same letter delivered twice is not acted on twice (event id).</p>`,
  diagram: {
    title: 'Internal gRPC and outbound webhooks', w: 820, h: 320,
    groups: [{ x: 16, y: 20, w: 470, h: 280, label: 'YOUR PLATFORM' }, { x: 520, y: 20, w: 284, h: 280, label: 'CUSTOMER' }],
    nodes: [
      { id: 'api', x: 36, y: 60, w: 130, label: 'Public API', sub: 'REST', info: 'Accepts the customer request.' },
      { id: 'inf', x: 36, y: 200, w: 130, label: 'Inference svc', sub: 'gRPC server', tone: 'be', info: 'Internal service exposing Classify and StreamSummary over gRPC with deadlines.' },
      { id: 'q', x: 200, y: 130, w: 120, label: 'Events', sub: 'job.completed', tone: 'acc', info: 'Domain events written to an outbox table or queue when work finishes.' },
      { id: 'sender', x: 340, y: 200, w: 130, label: 'Webhook sender', sub: 'sign + retry', tone: 'acc', info: 'Signs each delivery, retries with backoff for up to a day, records attempts.' },
      { id: 'recv', x: 550, y: 200, w: 130, label: 'Receiver', sub: 'verify + dedupe', tone: 'fde', info: 'Checks signature and timestamp, ignores seen event ids, returns 200 fast.' },
      { id: 'cq', x: 700, y: 120, w: 96, h: 56, label: 'Their queue', sub: 'async work', info: 'Real processing happens after the acknowledgement.' }
    ],
    edges: [{ a: 'api', b: 'inf', label: 'gRPC + deadline', step: 1 }, { a: 'inf', b: 'q', label: 'emit', step: 2 }, { a: 'q', b: 'sender', step: 3 }, { a: 'sender', b: 'recv', label: 'POST signed', step: 4 }, { a: 'recv', b: 'cq', step: 5 }],
    steps: ['The API calls the inference service over gRPC with a deadline.', 'When work completes, an event is recorded.', 'The webhook sender picks it up.', 'It POSTs a signed payload and retries until it gets a 2xx.', 'The receiver verifies, deduplicates and hands off to its own queue.'],
    caption: 'Typed RPC inside; signed, retried, deduplicated callbacks across the boundary.'
  },
  illustrated: { title: 'Five deliveries, one real event', body: `<p>The Code tab sends one legitimate webhook and four bad ones at a receiver.</p>
    <div class="tbl"><table><thead><tr><th>delivery</th><th>what is wrong</th><th>receiver response</th></tr></thead><tbody>
    <tr><td>original</td><td>nothing</td><td>accepted, processed</td></tr>
    <tr><td>retry of the original</td><td>duplicate event id</td><td>200, ignored</td></tr>
    <tr><td>tampered amount</td><td>body changed after signing</td><td>401 bad signature</td></tr>
    <tr><td>replay from 10 minutes ago</td><td>timestamp outside tolerance</td><td>401 stale</td></tr>
    <tr><td>no signature header</td><td>unsigned</td><td>401</td></tr></tbody></table></div>` },
  code: {
    title: 'Webhook signing, verification and replay protection', file: 'webhooks.py', browser: true,
    intro: '<p>Standard library only, so it runs in your browser. The header format mirrors what Stripe and many SaaS products use: <code class="i">t=&lt;unix&gt;,v1=&lt;hex hmac&gt;</code>.</p>',
    src: String.raw`import hashlib, hmac, json

SECRET = b"whsec_per_customer_secret"
TOLERANCE_S = 300

def sign(body: bytes, ts: int, secret: bytes = SECRET) -> str:
    mac = hmac.new(secret, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"

class Receiver:
    def __init__(self):
        self.seen: set[str] = set()
        self.processed: list[str] = []

    def handle(self, raw_body: bytes, header: str | None, now: int) -> tuple[int, str]:
        if not header:
            return 401, "missing signature"
        try:
            parts = dict(p.split("=", 1) for p in header.split(","))
            ts, sig = int(parts["t"]), parts["v1"]
        except (ValueError, KeyError):
            return 401, "malformed signature header"
        if abs(now - ts) > TOLERANCE_S:
            return 401, "stale timestamp (possible replay)"
        expected = hmac.new(SECRET, f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return 401, "bad signature"
        event = json.loads(raw_body)
        if event["id"] in self.seen:
            return 200, "duplicate ignored"
        self.seen.add(event["id"])
        self.processed.append(event["id"])           # in real life: enqueue, then return
        return 200, f"accepted {event['type']}"

now = 1_793_179_200
event = {"id": "evt_01", "type": "summary.completed", "data": {"document_id": 88, "url": "/v1/summaries/88"}}
body = json.dumps(event, separators=(",", ":")).encode()
good = sign(body, now)
tampered = body.replace(b"88", b"99")
r = Receiver()
for name, b, h, t in [("original", body, good, now + 2),
                      ("sender retry", body, good, now + 30),
                      ("tampered body", tampered, good, now + 3),
                      ("replay +10 min", body, sign(body, now), now + 600),
                      ("unsigned", body, None, now + 1)]:
    status, msg = r.handle(b, h, t)
    print(f"{name:<15} -> {status} {msg}")
print("processed events:", r.processed)`,
    more: [{ note: 'Internal gRPC: unary and server-streaming calls with a deadline. Stubs are generated from the proto above, then server and client run in one process. Output from a real run.', file: 'grpc_demo.py', key: 'grpc', deps: 'uv add grpcio grpcio-tools',
      files: { 'triage.proto': 'syntax = "proto3";\npackage triage.v1;\n\nservice Triage {\n  rpc Classify (ClassifyRequest) returns (ClassifyResponse);\n  rpc StreamSummary (ClassifyRequest) returns (stream Token);\n}\n\nmessage ClassifyRequest { int64 ticket_id = 1; string text = 2; }\nmessage ClassifyResponse { string label = 1; float confidence = 2; }\nmessage Token { string text = 1; }\n' },
      pre: 'python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. triage.proto',
      src: String.raw`from concurrent import futures
import time
import grpc
import triage_pb2 as pb
import triage_pb2_grpc as rpc

class TriageService(rpc.TriageServicer):
    def Classify(self, request, context):
        label = "billing" if "charge" in request.text.lower() else "other"
        return pb.ClassifyResponse(label=label, confidence=0.93)

    def StreamSummary(self, request, context):
        for word in ["Duplicate", "charge", "on", "14", "Oct."]:
            if not context.is_active():
                return
            yield pb.Token(text=word)

class SlowTriage(TriageService):
    def Classify(self, request, context):
        time.sleep(0.5)                    # a stuck dependency behind the RPC
        return pb.ClassifyResponse(label="other")

def start(servicer):
    srv = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    rpc.add_TriageServicer_to_server(servicer, srv)
    port = srv.add_insecure_port("127.0.0.1:0")      # production: TLS or mTLS
    srv.start()
    return srv, port

server, port = start(TriageService())

with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
    stub = rpc.TriageStub(channel)
    resp = stub.Classify(pb.ClassifyRequest(ticket_id=4812, text="I was charged twice"), timeout=1.0)
    print("unary   ->", resp.label, round(resp.confidence, 2))
    tokens = [t.text for t in stub.StreamSummary(pb.ClassifyRequest(ticket_id=4812, text="..."), timeout=1.0)]
    print("stream  ->", " ".join(tokens))
    print("bytes on the wire for the request:", len(pb.ClassifyRequest(ticket_id=4812, text="I was charged twice").SerializeToString()))

slow, slow_port = start(SlowTriage())
with grpc.insecure_channel(f"127.0.0.1:{slow_port}") as channel:
    try:
        rpc.TriageStub(channel).Classify(pb.ClassifyRequest(ticket_id=1, text="x"), timeout=0.1)
    except grpc.RpcError as e:
        print("deadline ->", e.code().name, "after 0.1 s instead of hanging")
server.stop(0); slow.stop(0)` }]
  },
  lab: {
    title: 'A webhook sender that survives customer downtime', file: 'sender_lab.py', browser: true,
    scenario: `<p>Customers complain they miss “agent needs approval” events when their endpoint is briefly down. Build the sending side: sign deliveries, retry with backoff for transient failures, give up after a budget, and record every attempt so support can answer “did you send it?”.</p>`,
    steps: ['Write <code class="i">deliver(event)</code> that serializes once and signs the exact bytes it sends.', 'Retry on connection errors, timeouts and 5xx responses with exponential backoff (fake clock), up to 6 attempts; do not retry 4xx except 429.', 'Record each attempt: time, status, error.', 'Use the fake customer endpoint, which is down for the first 3 attempts, and confirm the event arrives exactly once.', 'Mark events that exhaust retries as failed for a later manual replay.'],
    checks: ['The receiver accepts the event once, even though it saw several attempts.', 'The attempt log shows growing gaps between attempts.', 'A 400 response is not retried.'],
    hints: ['Reuse the same event id and body on every attempt; only the timestamp and signature may change.', 'The receiver deduplicates; your job is to make sure the event eventually arrives.'],
    starter: String.raw`import hashlib, hmac, json
SECRET = b"whsec_demo"
clock = {"t": 1_793_179_200}
calls = {"n": 0}
received = set()

def customer_endpoint(body: bytes, sig: str) -> int:
    calls["n"] += 1
    if calls["n"] <= 3:
        raise ConnectionError("customer endpoint down")
    ts, mac = [p.split("=", 1)[1] for p in sig.split(",")]
    expected = hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, mac):
        return 401
    received.add(json.loads(body)["id"])
    return 200

def deliver(event: dict) -> list[dict]:
    # TODO: sign, retry with backoff, log attempts
    return []

log = deliver({"id": "evt_77", "type": "approval.required", "data": {"run_id": "run_9"}})
print(log)
print("received:", received)`,
    solution: String.raw`import hashlib, hmac, json
SECRET = b"whsec_demo"
clock = {"t": 1_793_179_200}
calls = {"n": 0}
received = set()

def customer_endpoint(body: bytes, sig: str) -> int:
    calls["n"] += 1
    if calls["n"] <= 3:
        raise ConnectionError("customer endpoint down")
    ts, mac = [p.split("=", 1)[1] for p in sig.split(",")]
    expected = hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, mac):
        return 401
    received.add(json.loads(body)["id"])
    return 200

def sign(body: bytes, ts: int) -> str:
    return f"t={ts},v1={hmac.new(SECRET, f'{ts}.'.encode() + body, hashlib.sha256).hexdigest()}"

def deliver(event: dict, max_attempts: int = 6, base: float = 30.0) -> dict:
    body = json.dumps(event, separators=(",", ":")).encode()   # serialize once
    log = []
    for attempt in range(max_attempts):
        ts = clock["t"]
        try:
            status = customer_endpoint(body, sign(body, ts))
            log.append({"t": ts, "status": status})
            if 200 <= status < 300:
                return {"state": "delivered", "attempts": log}
            if 400 <= status < 500 and status != 429:
                return {"state": "failed_permanent", "attempts": log}
        except (ConnectionError, TimeoutError) as e:
            log.append({"t": ts, "error": str(e)})
        clock["t"] += int(base * 2 ** attempt)                 # 30s, 60s, 120s, ...
    return {"state": "failed_retry_later", "attempts": log}

result = deliver({"id": "evt_77", "type": "approval.required", "data": {"run_id": "run_9"}})
print("state:", result["state"])
start = result["attempts"][0]["t"]
for a in result["attempts"]:
    print(f"  +{a['t'] - start:>4}s", a.get("status", a.get("error")))
print("received:", received)`
  },
  design: {
    lead: '<p>Boundaries are where systems break: version mismatches between services, customer endpoints that are down, events that arrive twice or out of order. Design the contract so either side can evolve and recover independently.</p>',
    scale: [{ h: 'Outbox pattern', p: 'Write the event to an outbox table in the same transaction as the state change; a sender process publishes from the outbox. You never lose an event or send one for a change that rolled back.' }, { h: 'gRPC load balancing', p: 'HTTP/2 keeps long-lived connections, so classic L4 load balancers pin clients to one backend. Use client-side balancing or an L7 proxy such as Envoy.' }],
    fail: [{ h: 'Verifying parsed JSON', p: 'Re-serializing the body changes whitespace or key order and breaks signatures, so developers disable verification. Always verify the raw bytes.' }, { h: 'Out-of-order events', p: 'Retries reorder deliveries. Include a version or timestamp, and let receivers fetch the latest state rather than trusting payload order.' }],
    trade: [{ h: 'Fat vs thin payloads', p: 'Fat payloads save a call but leak data to wrong URLs and go stale; thin payloads (id + link) require the receiver to fetch with auth, which is safer for sensitive data.' }, { h: 'gRPC vs REST internally', p: 'gRPC gives types, streaming and speed; REST is simpler to debug and call from anywhere. Many teams use gRPC for model and retrieval services and REST at the edge.' }],
    prompt: '<p>Design the event delivery system that notifies 400 customer endpoints when agent runs finish or need approval. Some endpoints are down for hours.</p>',
    answer: '<ul><li>Outbox table, per-endpoint delivery queue, signed thin payloads with event ids and types.</li><li>Exponential backoff for up to 72 hours, then disable the endpoint and email the customer.</li><li>Delivery log and a replay button in the customer dashboard.</li><li>Per-endpoint concurrency limits so one slow customer cannot block others; secret rotation with two valid secrets during the overlap.</li></ul>'
  },
  quiz: [
    { q: 'Why include a timestamp inside the signed webhook content?', o: ['For logging only', 'So receivers can reject old, replayed deliveries', 'To speed up HMAC', 'It is required by HTTP'], a: 1, why: 'A captured valid request could be replayed forever; a signed timestamp lets receivers bound its age.' },
    { q: 'A receiver computes the HMAC over <code class="i">json.dumps(json.loads(body))</code>. What goes wrong?', o: ['Nothing', 'Re-serialization changes bytes, so valid signatures fail', 'It is slower', 'It leaks the secret'], a: 1, why: 'Signatures cover exact bytes; any change in spacing or key order breaks verification.' },
    { q: 'Which change to a protobuf message is safe for existing clients?', o: ['Renumbering field 2 to 3', 'Adding a new field with a new number', 'Changing int64 to string on field 1', 'Reusing a deleted field number'], a: 1, why: 'New fields with new numbers are ignored by old clients; changing or reusing numbers corrupts data.' }
  ],
  interview: [
    { q: 'How would you build a webhook receiver in a customer’s system for your AI product?', a: '<p>An HTTPS endpoint that reads the raw body, verifies the HMAC signature and timestamp with a constant-time compare, rejects stale or unsigned requests, deduplicates by event id in a store with a TTL, enqueues the work and returns 200 within a second or two. Log the event id for support, alert on signature failures, and support secret rotation.</p>' },
    { q: 'When would you choose gRPC over REST between two of your services?', a: '<p>When both are internal, latency and payload size matter, the contract benefits from strong typing across languages, or I need streaming, for example token streams from an inference service. I would keep REST for public APIs and anything customers or browsers call directly.</p>' }
  ]
});

/* ===================================================================== 1.9 */
L({
  id: '1.9', title: 'Docker and Compose', minutes: 55, roles: ['fde', 'be'],
  tags: 'Dockerfile · multi-stage builds · uv in Docker · non-root · healthchecks · Compose · secrets',
  mental: 'A container image is your service plus everything it needs, frozen into one artifact that runs the same on a laptop, in CI and in a customer’s Kubernetes cluster. Compose runs the whole stack (API, worker, Postgres, Redis) with one command.',
  intro: `<p>Kubernetes and Docker appear in roughly one in eight FDE postings, and in nearly every AI backend role. Whatever cloud the customer runs, the unit you hand over is almost always an image. For air-gapped customers it is literally a file you load into their registry.</p>
  <p>This lesson builds a production-shaped image for the triage service and a Compose file for the full Phase 1 capstone stack. Phase 10 takes the same images to Kubernetes.</p>`,
  points: [
    'Each Dockerfile instruction creates a cached layer: copy dependency files and install them before copying source code so code edits rebuild in seconds.',
    'Multi-stage builds: compile and install in a builder stage, copy only the virtual environment into a slim runtime stage.',
    'Run as a non-root user, set <code class="i">PYTHONUNBUFFERED=1</code> so logs stream, and pin base images by version.',
    'Never bake secrets into images; pass them at runtime through environment variables or mounted secret files.',
    'A <code class="i">HEALTHCHECK</code> and Compose’s <code class="i">depends_on: condition: service_healthy</code> start services in the right order.',
    'Use <code class="i">.dockerignore</code> to keep <code class="i">.venv</code>, <code class="i">.git</code> and data files out of the build context.'
  ],
  concept: { title: 'Build once, run anywhere, configure at runtime', body: `<p>The same image tag moves from CI to staging to production to the customer’s cluster unchanged. Only configuration differs, injected at runtime: database URLs, model names, API keys. If you ever rebuild an image “for production”, you are deploying something you did not test.</p>` },
  walk: [
    { h: 'Layer order for fast rebuilds', body: '<p>Dependencies change rarely; code changes constantly. Put the slow, stable steps first.</p>' },
    { h: 'Build and run', body: '<p>Tag images with the Git commit so every running container maps to exact source.</p>', lang: 'bash', file: 'terminal', code: String.raw`docker build -t triage-api:$(git rev-parse --short HEAD) .
docker run --rm -p 8000:8000 --env-file .env triage-api:$(git rev-parse --short HEAD)
docker image ls triage-api            # check the size
docker run --rm triage-api:latest id  # confirm it is not root` },
    { h: 'Run the stack with Compose', body: '<p>Healthchecks gate start order; named volumes keep data between restarts.</p>', lang: 'bash', file: 'terminal', code: String.raw`docker compose up -d --build
docker compose ps
docker compose logs -f api worker
docker compose exec db psql -U app -c "select count(*) from tickets"
docker compose down            # add -v to also delete volumes` },
    { h: 'Ship to an air-gapped customer', body: '<p>Save the image to a file, transfer it through their approved channel, load it into their registry.</p>', lang: 'bash', file: 'terminal', code: String.raw`docker save triage-api:1.4.0 | gzip > triage-api-1.4.0.tar.gz
# on the customer side
docker load < triage-api-1.4.0.tar.gz
docker tag triage-api:1.4.0 registry.customer.internal/ai/triage-api:1.4.0
docker push registry.customer.internal/ai/triage-api:1.4.0` }
  ],
  analogy: `<p><b>A shipping container.</b> Before containers, every port loaded cargo differently and things broke in transit. A standard box with everything packed inside travels by ship, train and truck without being repacked. The label on the outside (environment variables) tells each destination how to handle it, but nobody opens the box to change what is inside.</p>`,
  diagram: {
    title: 'The Phase 1 capstone stack in Compose', w: 820, h: 320,
    groups: [{ x: 150, y: 20, w: 654, h: 280, label: 'docker compose · one network' }],
    nodes: [
      { id: 'dev', x: 16, y: 136, w: 110, label: 'You / curl', sub: 'localhost:8000', info: 'Only the API port is published to the host.' },
      { id: 'api', x: 180, y: 136, w: 140, label: 'api', sub: 'FastAPI · uvicorn', tone: 'be', info: 'Built from the Dockerfile; waits for db and redis to be healthy.' },
      { id: 'worker', x: 380, y: 236, w: 140, label: 'worker', sub: 'same image', tone: 'be', info: 'Same image, different command: processes background jobs.' },
      { id: 'db', x: 600, y: 50, w: 180, label: 'db', sub: 'postgres:16 · volume', tone: 'acc', info: 'Data persists in a named volume; healthcheck uses pg_isready.' },
      { id: 'redis', x: 600, y: 150, w: 180, label: 'redis', sub: 'cache · limits · broker', tone: 'acc', info: 'Cache, rate-limit buckets and the job broker.' },
      { id: 'sec', x: 600, y: 236, w: 180, label: 'secrets', sub: '.env / secret files', tone: 'fde', info: 'Injected at runtime, never copied into the image.' }
    ],
    edges: [{ a: 'dev', b: 'api', step: 1 }, { a: 'api', b: 'db', step: 2 }, { a: 'api', b: 'redis', label: 'enqueue', step: 3 }, { a: 'redis', b: 'worker', label: 'jobs', step: 4 }, { a: 'worker', b: 'db', step: 4 }, { a: 'sec', b: 'api', dash: true }, { a: 'sec', b: 'worker', dash: true }],
    steps: ['Requests reach the API on the one published port.', 'The API reads and writes Postgres over the internal network.', 'Slow work is enqueued in Redis.', 'The worker, built from the same image, processes jobs and writes results.'],
    caption: 'One image, two roles (api and worker), two stateful services, secrets injected at runtime.'
  },
  illustrated: { title: 'Image size and rebuild time', body: `<p>Typical results for a FastAPI service with about 40 dependencies:</p>
    <div class="tbl"><table><thead><tr><th>approach</th><th>image size</th><th>rebuild after a code change</th></tr></thead><tbody>
    <tr><td><code class="i">FROM python:3.12</code>, copy all, pip install</td><td class="n">about 1.2 GB</td><td>reinstalls every dependency</td></tr>
    <tr><td>slim base, deps layer first</td><td class="n">about 300 MB</td><td>seconds: only the code layer</td></tr>
    <tr><td>multi-stage with uv, venv copied to slim runtime</td><td class="n">about 200 MB</td><td>seconds, and no compilers in production</td></tr></tbody></table></div>
    <p>Sizes vary with dependencies; the ordering of the three rows does not. The Code tab validates the real Compose file with <code class="i">docker compose config</code>.</p>` },
  code: {
    title: 'Production Dockerfile and the capstone Compose file', file: 'terminal', lang: 'bash',
    intro: '<p>A multi-stage Dockerfile using uv, then the Compose file for the full Phase 1 stack. The command validates the Compose file and prints the resolved service graph; this output is from a real run.</p>',
    files: {
      'compose.yaml': 'services:\n  api:\n    build: .\n    image: triage-api:dev\n    ports: ["8000:8000"]\n    env_file: .env\n    environment:\n      DATABASE_URL: postgresql://app:app@db:5432/triage\n      REDIS_URL: redis://redis:6379/0\n    depends_on:\n      db: { condition: service_healthy }\n      redis: { condition: service_healthy }\n    healthcheck:\n      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen(\'http://localhost:8000/healthz\')"]\n      interval: 10s\n      retries: 5\n\n  worker:\n    image: triage-api:dev\n    command: ["python", "-m", "triage.worker"]\n    env_file: .env\n    environment:\n      DATABASE_URL: postgresql://app:app@db:5432/triage\n      REDIS_URL: redis://redis:6379/0\n    depends_on:\n      api: { condition: service_started }\n\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_USER: app\n      POSTGRES_PASSWORD: app\n      POSTGRES_DB: triage\n    volumes: ["pgdata:/var/lib/postgresql/data"]\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U app -d triage"]\n      interval: 5s\n      retries: 10\n\n  redis:\n    image: redis:7\n    healthcheck:\n      test: ["CMD", "redis-cli", "ping"]\n      interval: 5s\n      retries: 10\n\nvolumes:\n  pgdata:\n',
      '.env': 'MODEL_NAME=triage-small-2026-10\nLLM_API_KEY=set-me-at-runtime\n'
    },
    src: String.raw`docker compose config --quiet && echo "compose.yaml is valid"
docker compose config --services
echo "--- start order implied by depends_on"
docker compose config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)["services"]
for name, s in c.items():
    deps = {d: v["condition"] for d, v in (s.get("depends_on") or {}).items()}
    print(name.ljust(7), "waits for", deps or "nothing")'`,
    more: [{ note: 'The Dockerfile. Dependencies install in a cached layer from the lockfile (lesson 0.3); the runtime stage gets only the virtual environment and the code, and runs as a non-root user.', file: 'Dockerfile', lang: 'docker', src: String.raw`# ---- build stage: resolve and install dependencies from the lock ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

# ---- runtime stage: slim, no build tools, non-root ----
FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"
CMD ["uvicorn", "triage.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]` },
      { note: 'Keep the build context small and secret-free.', file: '.dockerignore', lang: 'bash', src: String.raw`.venv
.git
__pycache__
*.pyc
.env
data/
tests/` }]
  },
  lab: {
    title: 'Ship the Phase 1 capstone stack', file: 'compose.yaml', lang: 'yaml', run: false,
    scenario: `<p>This is the Phase 1 capstone. Put together the ticket-triage service from lessons 1.1 to 1.8: FastAPI API with auth, Postgres schema and inbox index, Redis cache and per-tenant rate limit, a worker with idempotent jobs, and retries on outbound calls. Package it so a reviewer can run everything with one command on a clean machine.</p>`,
    setup: String.raw`uv init triage-service --package && cd triage-service
uv add "fastapi[standard]" "psycopg[binary,pool]" redis pyjwt tenacity httpx
mkdir -p src/triage && touch src/triage/{app,worker,db,auth,limits}.py`,
    steps: ['Write the Dockerfile from the Code tab and build it; confirm the image runs as a non-root user.', 'Write compose.yaml with api, worker, db and redis, each with a healthcheck.', 'Add a migration step (a one-shot <code class="i">migrate</code> service or a startup script) that creates the schema and the inbox index.', 'Run <code class="i">docker compose up -d --build</code> and exercise the API: create tickets with an idempotency key, list the inbox with a cursor, hit the rate limit.', 'Write a README with three commands to run it and one to tear it down.'],
    checks: ['<code class="i">docker compose up</code> on a clean clone starts every service healthy.', 'Re-posting a ticket with the same Idempotency-Key does not create a duplicate.', 'The 11th rapid request from one tenant gets 429 with Retry-After.', 'No secret appears in the image (<code class="i">docker history</code> shows none).'],
    hints: ['A one-shot service with <code class="i">restart: "no"</code> and <code class="i">depends_on: db: condition: service_healthy</code> is a clean way to run migrations.', 'Use <code class="i">docker compose exec api env</code> to see what configuration the container really received.'],
    starter: String.raw`services:
  api:
    build: .
    ports: ["8000:8000"]
    # TODO: env, depends_on with healthchecks, healthcheck

  # TODO: worker, migrate, db, redis

volumes:
  pgdata:`,
    solution: String.raw`services:
  migrate:
    image: triage-api:dev
    build: .
    command: ["python", "-m", "triage.db", "migrate"]
    environment: { DATABASE_URL: "postgresql://app:app@db:5432/triage" }
    depends_on: { db: { condition: service_healthy } }
    restart: "no"

  api:
    image: triage-api:dev
    ports: ["8000:8000"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://app:app@db:5432/triage
      REDIS_URL: redis://redis:6379/0
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 10s
      retries: 5

  worker:
    image: triage-api:dev
    command: ["python", "-m", "triage.worker"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://app:app@db:5432/triage
      REDIS_URL: redis://redis:6379/0
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    stop_grace_period: 30s          # finish in-flight jobs on deploy

  db:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: triage }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d triage"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

volumes:
  pgdata:`
  },
  design: {
    lead: '<p>Images are the deployment unit everywhere from a laptop to a regulated customer’s cluster. The design questions are supply-chain trust, size and start time, configuration, and how the same artifact behaves under an orchestrator.</p>',
    scale: [{ h: 'Same image, many roles', p: 'Run API, worker and scheduled jobs from one image with different commands. One build, one scan, one version to track.' }, { h: 'Fast starts for autoscaling', p: 'Small images and no work at import time let new replicas start in seconds when traffic spikes. Large model weights belong in volumes or a model server, not in the API image.' }],
    fail: [{ h: 'Secrets in layers', p: 'A secret copied in and deleted in a later layer is still in the image history. Use runtime env vars, mounted secret files or BuildKit secret mounts.' }, { h: 'Unpinned bases', p: '<code class="i">FROM python:latest</code> changes under you. Pin versions, and for regulated customers pin by digest.' }],
    trade: [{ h: 'Slim vs distroless vs alpine', p: 'Slim is the safe default for Python; distroless is smaller with fewer CVEs but harder to debug; alpine uses musl, which breaks or slows many Python wheels.' }, { h: 'Compose vs Kubernetes', p: 'Compose for development, demos and small single-host pilots; Kubernetes once you need autoscaling, rolling deploys and multi-node resilience (Phase 10.5).' }],
    prompt: '<p>A hospital wants your AI triage service on-premises with no internet access, scanned for vulnerabilities, and updated monthly. Describe your delivery process.</p>',
    answer: '<ul><li>Pinned, minimal base images; multi-stage builds; SBOM generated and images signed in CI.</li><li>Vulnerability scan gate in CI; monthly rebuilds on patched bases.</li><li>Release bundle: signed image tarballs, Compose or Helm files, checksums and release notes, transferred through their approved channel and loaded into their registry.</li><li>Configuration and secrets supplied by their team at runtime; health endpoints and a support runbook.</li></ul>'
  },
  quiz: [
    { q: 'Why copy pyproject.toml and uv.lock and install before copying the source code?', o: ['Docker requires it', 'So code-only changes reuse the cached dependency layer and rebuild in seconds', 'To make the image smaller', 'For security'], a: 1, why: 'Layer caching stops at the first changed instruction; dependencies change far less often than code.' },
    { q: 'A secret was added in one Dockerfile step and deleted in the next. Is it safe?', o: ['Yes, it was deleted', 'No, it remains in the earlier layer and the image history', 'Only if the image is private', 'Only on slim images'], a: 1, why: 'Layers are additive; deletion hides the file but the earlier layer still contains it.' },
    { q: 'What does <code class="i">depends_on: db: condition: service_healthy</code> do?', o: ['Restarts db when the API fails', 'Starts the API only after db’s healthcheck passes', 'Shares db’s environment', 'Links logs'], a: 1, why: 'It orders startup on health, not just on container start.' }
  ],
  interview: [
    { q: 'Walk me through a production Dockerfile for a Python API.', a: '<p>Pinned slim base; multi-stage build installing dependencies from the lockfile in a cached layer before copying code; runtime stage with only the virtual environment and source; non-root user; unbuffered output; a healthcheck; a .dockerignore excluding venvs, git and secrets; configuration and secrets injected at runtime; image tagged with the commit SHA.</p>' },
    { q: 'The container works on your laptop but crashes in the customer’s cluster. What do you check?', a: '<p>Architecture mismatch (ARM laptop vs x86 nodes), missing environment variables or secrets, read-only filesystems, running as an arbitrary non-root UID, network policies blocking egress to the model provider or database, resource limits causing OOM kills, and differences in DNS or proxy settings. Logs, <code class="i">kubectl describe</code> and an exec into a debug pod narrow it quickly.</p>' }
  ]
});
})();
