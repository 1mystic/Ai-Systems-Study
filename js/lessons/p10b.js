/* Phase 10 · LLMOps and delivery (part 2) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 10.5 */
L({
  id: '10.5', title: 'Compose to Kubernetes', minutes: 55, roles: ['be', 'fde'],
  tags: 'Deployments · Services · probes · resources · GPU scheduling · HPA on queue depth · PodDisruptionBudgets · secrets · Helm and Kustomize',
  mental: 'Docker Compose describes containers on one machine; Kubernetes describes desired state for a fleet and keeps reconciling towards it. Moving an AI service across means making explicit what Compose left implicit: resource requests, health probes, scaling signals, disruption limits, GPU placement and secrets.',
  intro: `<p>Most AI prototypes start as a <code class="i">docker-compose.yml</code> (1.8): an API, a vector store, a cache, maybe a local model server. Most enterprise customers run production on Kubernetes (EKS, AKS, GKE or on-premises OpenShift). The FDE often does this translation in the customer’s cluster, under their policies. The AI-specific parts are GPU nodes, model servers that take minutes to start, and autoscaling on queue depth rather than CPU.</p>`,
  points: [
    'Each Compose service becomes a Deployment (stateless) or StatefulSet (stateful) plus a Service for networking.',
    'Set resource requests and limits for every container; GPUs are requested as <code class="i">nvidia.com/gpu</code> limits and land on GPU node pools via selectors and tolerations.',
    'Probes: a startup probe for slow model loading, readiness for traffic, liveness for stuck processes.',
    'Scale model servers on queue depth or in-flight requests (HorizontalPodAutoscaler with custom metrics, or KEDA), not CPU.',
    'PodDisruptionBudgets keep capacity during node upgrades; spread replicas across zones.',
    'Secrets come from the cluster’s secret store (often synced from a cloud secrets manager); never baked into images. Package with Helm or Kustomize per environment.'
  ],
  concept: { title: 'From instructions to intentions', body: `<p>Compose says “start these containers”. Kubernetes says “there should always be three healthy copies of this, each with one GPU, never fewer than two during maintenance, more when the queue grows”, and a control loop makes it so. The translation work is writing down those intentions precisely.</p>` },
  walk: [
    { h: 'A GPU model server', body: '<p>The key fields for a vLLM Deployment (5.x and 9.x lessons): GPU limit, node placement, a generous startup probe and shared memory.</p>', lang: 'yaml', file: 'vllm.yaml', code: String.raw`containers:
  - name: vllm
    image: vllm/vllm-openai:v0.11.0            # pinned, never :latest
    args: ["--model", "/models/llama-8b", "--max-model-len", "16384"]
    resources:
      requests: { cpu: "4", memory: 32Gi, nvidia.com/gpu: 1 }
      limits:   { memory: 32Gi, nvidia.com/gpu: 1 }
    startupProbe:   { httpGet: { path: /health, port: 8000 }, periodSeconds: 10, failureThreshold: 60 }   # up to 10 min to load
    readinessProbe: { httpGet: { path: /health, port: 8000 }, periodSeconds: 5 }
nodeSelector: { gpu: l4 }
tolerations: [{ key: nvidia.com/gpu, operator: Exists, effect: NoSchedule }]` },
    { h: 'Scale on the right signal', body: '<p>GPU servers saturate on batch slots, not CPU. Scale on <code class="i">vllm:num_requests_waiting</code> (exported to Prometheus and exposed via a metrics adapter) or with KEDA. Scale-up is slow because new pods must pull images and load weights: pre-pull images, keep warm capacity, and set stabilisation windows.</p>' },
    { h: 'Environments', body: '<p>One base set of manifests, overlays per environment (Kustomize) or values files (Helm) for replicas, models, node pools and hostnames. GitOps tools (Argo CD, Flux) apply what is in the repository.</p>' }
  ],
  analogy: `<p><b>From a home kitchen to a restaurant chain.</b> At home you just cook. A chain writes down how many cooks each branch needs, which stations need the expensive ovens, how to tell a cook is ready for service, and how many must stay on shift during training days. Managers (controllers) keep every branch matching the plan.</p>`,
  diagram: {
    title: 'An AI service on Kubernetes',
    cols: [['ing', 'sec'], ['gw', 'hpa1'], ['svc', 'vec'], ['vllm', 'hpa2'], ['gpu']],
    nodes: [
      { id: 'ing', label: 'Ingress', sub: 'TLS · auth', tone: 'fde', info: 'Gateway or ingress controller.' },
      { id: 'gw', label: 'Gateway Deployment', sub: 'CPU · 3+ replicas', tone: 'acc', info: 'The LLM gateway / API (9.8).' },
      { id: 'hpa1', label: 'HPA', sub: 'CPU / RPS', info: 'Scales gateway pods.' },
      { id: 'svc', label: 'Service', sub: 'model-server', info: 'Stable name and load balancing to model pods.' },
      { id: 'vllm', label: 'vLLM Deployment', sub: '1 GPU per pod', tone: 'be', info: 'Startup probe for weight loading; pinned image.' },
      { id: 'hpa2', label: 'Autoscaler', sub: 'queue depth (KEDA/HPA)', tone: 'warn', info: 'Scales on waiting requests, not CPU.' },
      { id: 'gpu', label: 'GPU node pool', sub: 'taints · selectors', tone: 'warn', info: 'Only GPU workloads land here.' },
      { id: 'vec', label: 'Vector DB', sub: 'StatefulSet or managed', tone: 'ok', info: 'Persistent volumes, or a managed service.' },
      { id: 'sec', label: 'Secrets', sub: 'synced from cloud KMS', tone: 'bad', info: 'External Secrets or CSI driver.' }
    ],
    edges: [{ a: 'ing', b: 'gw' }, { a: 'hpa1', b: 'gw', dash: true }, { a: 'gw', b: 'svc' }, { a: 'svc', b: 'vllm' }, { a: 'hpa2', b: 'vllm', dash: true }, { a: 'vllm', b: 'gpu' }, { a: 'gw', b: 'vec' }, { a: 'sec', b: 'gw', dash: true }],
    caption: 'Gateway on CPU nodes, model servers on GPU nodes, each scaled on its own signal.'
  },
  illustrated: { title: 'Compose field → Kubernetes field', body: `<div class="tbl"><table><thead><tr><th>Compose</th><th>Kubernetes</th></tr></thead><tbody>
    <tr><td><code class="i">image</code>, <code class="i">command</code></td><td>Deployment container <code class="i">image</code>, <code class="i">args</code></td></tr>
    <tr><td><code class="i">ports</code></td><td>containerPort + Service (+ Ingress for external)</td></tr>
    <tr><td><code class="i">environment</code></td><td>env from ConfigMap; secrets via <code class="i">secretKeyRef</code></td></tr>
    <tr><td><code class="i">volumes</code> (named)</td><td>PersistentVolumeClaim (StatefulSet for databases)</td></tr>
    <tr><td><code class="i">deploy.resources.reservations.devices: gpu</code></td><td><code class="i">nvidia.com/gpu</code> limit + node selector + toleration</td></tr>
    <tr><td><code class="i">depends_on</code>, <code class="i">healthcheck</code></td><td>readiness probes; apps retry connections (no start ordering)</td></tr>
    <tr><td><code class="i">deploy.replicas</code></td><td><code class="i">replicas</code> + HPA + PDB</td></tr></tbody></table></div>` },
  code: {
    title: 'Generate and policy-check manifests for an AI service', file: 'k8s_gen.py', deps: 'uv add pyyaml',
    intro: '<p>Generates the gateway and vLLM Deployments, Services, an HPA on queue depth and a PodDisruptionBudget from a small spec, then runs a policy checker of the kind customers enforce with admission controllers (Kyverno, Gatekeeper): pinned images, requests and limits, probes, non-root, GPU requests equal to limits, secrets by reference. A deliberately sloppy manifest shows the violations.</p>',
    src: String.raw`import yaml

def deployment(name, image, port, replicas, cpu, mem, gpu=0, env=None, secrets=None, startup_s=30, args=None):
    res = {"requests": {"cpu": cpu, "memory": mem}, "limits": {"memory": mem}}
    if gpu:
        res["requests"]["nvidia.com/gpu"] = res["limits"]["nvidia.com/gpu"] = gpu
    container = {"name": name, "image": image, "ports": [{"containerPort": port}], "resources": res,
                 "env": [{"name": k, "value": v} for k, v in (env or {}).items()] +
                        [{"name": k, "valueFrom": {"secretKeyRef": {"name": ref, "key": k.lower()}}} for k, ref in (secrets or {}).items()],
                 "securityContext": {"runAsNonRoot": True, "allowPrivilegeEscalation": False},
                 "startupProbe": {"httpGet": {"path": "/health", "port": port}, "periodSeconds": 10, "failureThreshold": max(3, startup_s // 10)},
                 "readinessProbe": {"httpGet": {"path": "/health", "port": port}, "periodSeconds": 5},
                 "livenessProbe": {"httpGet": {"path": "/health", "port": port}, "periodSeconds": 20}}
    if args: container["args"] = args
    pod = {"containers": [container],
           "topologySpreadConstraints": [{"maxSkew": 1, "topologyKey": "topology.kubernetes.io/zone", "whenUnsatisfiable": "ScheduleAnyway",
                                          "labelSelector": {"matchLabels": {"app": name}}}]}
    if gpu:
        pod["nodeSelector"] = {"gpu": "l4"}
        pod["tolerations"] = [{"key": "nvidia.com/gpu", "operator": "Exists", "effect": "NoSchedule"}]
    return {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": name, "labels": {"app": name}},
            "spec": {"replicas": replicas, "selector": {"matchLabels": {"app": name}},
                     "template": {"metadata": {"labels": {"app": name}}, "spec": pod}}}

def service(name, port):
    return {"apiVersion": "v1", "kind": "Service", "metadata": {"name": name}, "spec": {"selector": {"app": name}, "ports": [{"port": port, "targetPort": port}]}}

def hpa_queue(name, lo, hi, waiting_per_pod):
    return {"apiVersion": "autoscaling/v2", "kind": "HorizontalPodAutoscaler", "metadata": {"name": name},
            "spec": {"scaleTargetRef": {"apiVersion": "apps/v1", "kind": "Deployment", "name": name}, "minReplicas": lo, "maxReplicas": hi,
                     "metrics": [{"type": "Pods", "pods": {"metric": {"name": "vllm_num_requests_waiting"}, "target": {"type": "AverageValue", "averageValue": str(waiting_per_pod)}}}],
                     "behavior": {"scaleDown": {"stabilizationWindowSeconds": 600}}}}

def pdb(name, min_available):
    return {"apiVersion": "policy/v1", "kind": "PodDisruptionBudget", "metadata": {"name": name},
            "spec": {"minAvailable": min_available, "selector": {"matchLabels": {"app": name}}}}

def check(docs):
    issues = []
    for d in (x for x in docs if x["kind"] == "Deployment"):
        n = d["metadata"]["name"]
        for c in d["spec"]["template"]["spec"]["containers"]:
            img = c.get("image", "")
            if ":" not in img or img.endswith(":latest"): issues.append(f"{n}: image '{img}' is not pinned")
            r = c.get("resources", {})
            if not r.get("requests"): issues.append(f"{n}: no resource requests")
            if "memory" not in r.get("limits", {}): issues.append(f"{n}: no memory limit")
            g_req, g_lim = r.get("requests", {}).get("nvidia.com/gpu"), r.get("limits", {}).get("nvidia.com/gpu")
            if (g_req or g_lim) and g_req != g_lim: issues.append(f"{n}: GPU request must equal limit")
            for p in ("readinessProbe", "livenessProbe"):
                if p not in c: issues.append(f"{n}: missing {p}")
            if not c.get("securityContext", {}).get("runAsNonRoot"): issues.append(f"{n}: may run as root")
            for e in c.get("env", []):
                if any(s in e["name"] for s in ("KEY", "PASSWORD", "TOKEN")) and "value" in e:
                    issues.append(f"{n}: secret {e['name']} set as plain value")
    return issues

docs = [deployment("gateway", "registry.acme.io/gateway:3f2a91c", 8080, 3, "500m", "1Gi",
                   env={"MODEL_URL": "http://vllm:8000/v1"}, secrets={"ANTHROPIC_API_KEY": "llm-keys"}),
        service("gateway", 8080),
        deployment("vllm", "vllm/vllm-openai:v0.11.0", 8000, 2, "4", "32Gi", gpu=1, startup_s=600,
                   args=["--model", "/models/llama-8b", "--max-model-len", "16384"]),
        service("vllm", 8000), hpa_queue("vllm", 2, 8, 4), pdb("gateway", 2), pdb("vllm", 1)]
print("generated:", ", ".join(f"{d['kind']}/{d['metadata']['name']}" for d in docs))
print("policy check:", check(docs) or "pass")

sloppy = yaml.safe_load("""
kind: Deployment
metadata: {name: quick-demo}
spec:
  template:
    spec:
      containers:
        - name: app
          image: acme/rag:latest
          env: [{name: OPENAI_API_KEY, value: sk-live-123}]
          resources: {limits: {nvidia.com/gpu: 1}}
""")
print("\nsloppy manifest:")
for i in check([sloppy]): print("  -", i)
print("\n--- vllm Deployment (excerpt) ---")
print("\n".join(yaml.safe_dump(docs[2], sort_keys=False).splitlines()[24:52]))`
  },
  lab: {
    title: 'Translate a prototype’s Compose file to Kubernetes', file: 'compose2k8s_lab.py', browser: true,
    scenario: `<p>The customer’s prototype runs from a Compose file (given as a Python dict): an API, a vLLM server with one GPU, Postgres with a named volume, and Redis. Write a translator that emits Kubernetes objects with the decisions an engineer would make: Deployments for stateless services, a StatefulSet with a volume claim template for Postgres, Services for every port, GPU placement, secrets moved to <code class="i">secretKeyRef</code>, and a TODO list of things the Compose file did not say.</p>`,
    steps: ['Classify each service: stateful if it mounts a named volume.', 'Emit Deployment or StatefulSet + Service; copy image, command, ports and non-secret env.', 'Move env vars whose names contain KEY, PASSWORD, SECRET or TOKEN into a Secret reference.', 'Map GPU device reservations to <code class="i">nvidia.com/gpu</code> limits, node selector and toleration.', 'Produce TODOs: missing resource requests, missing healthchecks (probes), unpinned images, depends_on to replace with readiness and retries.'],
    checks: ['Postgres becomes a StatefulSet with a volume claim.', 'No secret value appears in emitted env.', 'TODOs flag the unpinned Redis image and missing healthchecks.'],
    hints: ['Keep the output as dicts; print a compact summary rather than full YAML.', 'Ports in Compose look like "8080:8080"; the container port is after the colon.'],
    starter: String.raw`COMPOSE = {"services": {
  "api":    {"image": "acme/api:1.4.2", "ports": ["8080:8080"], "environment": {"MODEL_URL": "http://vllm:8000/v1", "DATABASE_PASSWORD": "devpass", "REDIS_URL": "redis://redis:6379"},
             "depends_on": ["vllm", "db", "redis"], "healthcheck": {"test": ["CMD", "curl", "-f", "http://localhost:8080/health"]}},
  "vllm":   {"image": "vllm/vllm-openai:v0.11.0", "command": ["--model", "meta-llama/Llama-3.1-8B-Instruct"], "ports": ["8000:8000"],
             "environment": {"HF_TOKEN": "hf_dev"}, "deploy": {"resources": {"reservations": {"devices": [{"driver": "nvidia", "count": 1, "capabilities": ["gpu"]}]}}}},
  "db":     {"image": "pgvector/pgvector:pg17", "ports": ["5432:5432"], "environment": {"POSTGRES_PASSWORD": "devpass"}, "volumes": ["pgdata:/var/lib/postgresql/data"]},
  "redis":  {"image": "redis", "ports": ["6379:6379"]}},
  "volumes": {"pgdata": {}}}
# TODO: translate(COMPOSE) -> (objects, todos)`,
    solution: String.raw`COMPOSE = {"services": {
  "api":    {"image": "acme/api:1.4.2", "ports": ["8080:8080"], "environment": {"MODEL_URL": "http://vllm:8000/v1", "DATABASE_PASSWORD": "devpass", "REDIS_URL": "redis://redis:6379"},
             "depends_on": ["vllm", "db", "redis"], "healthcheck": {"test": ["CMD", "curl", "-f", "http://localhost:8080/health"]}},
  "vllm":   {"image": "vllm/vllm-openai:v0.11.0", "command": ["--model", "meta-llama/Llama-3.1-8B-Instruct"], "ports": ["8000:8000"],
             "environment": {"HF_TOKEN": "hf_dev"}, "deploy": {"resources": {"reservations": {"devices": [{"driver": "nvidia", "count": 1, "capabilities": ["gpu"]}]}}}},
  "db":     {"image": "pgvector/pgvector:pg17", "ports": ["5432:5432"], "environment": {"POSTGRES_PASSWORD": "devpass"}, "volumes": ["pgdata:/var/lib/postgresql/data"]},
  "redis":  {"image": "redis", "ports": ["6379:6379"]}},
  "volumes": {"pgdata": {}}}
SECRET_WORDS = ("KEY", "PASSWORD", "SECRET", "TOKEN")

def translate(compose):
    objs, todos, secret_keys = [], [], []
    named = set(compose.get("volumes", {}))
    for name, s in compose["services"].items():
        ports = [int(p.split(":")[-1]) for p in s.get("ports", [])]
        env, secret_env = [], []
        for k, v in s.get("environment", {}).items():
            if any(w in k for w in SECRET_WORDS):
                secret_env.append({"name": k, "valueFrom": {"secretKeyRef": {"name": f"{name}-secrets", "key": k.lower()}}})
                secret_keys.append(f"{name}-secrets/{k.lower()}")
            else:
                env.append({"name": k, "value": v})
        c = {"name": name, "image": s["image"], "ports": [{"containerPort": p} for p in ports], "env": env + secret_env}
        if "command" in s: c["args"] = s["command"]
        pod = {"containers": [c]}
        gpus = sum(d.get("count", 0) for d in s.get("deploy", {}).get("resources", {}).get("reservations", {}).get("devices", []) if "gpu" in d.get("capabilities", []))
        if gpus:
            c["resources"] = {"limits": {"nvidia.com/gpu": gpus}, "requests": {"nvidia.com/gpu": gpus}}
            pod["nodeSelector"] = {"gpu": "true"}
            pod["tolerations"] = [{"key": "nvidia.com/gpu", "operator": "Exists", "effect": "NoSchedule"}]
        vols = [v.split(":") for v in s.get("volumes", []) if v.split(":")[0] in named]
        kind = "StatefulSet" if vols else "Deployment"
        spec = {"replicas": 1, "selector": {"matchLabels": {"app": name}}, "template": {"metadata": {"labels": {"app": name}}, "spec": pod}}
        if vols:
            c["volumeMounts"] = [{"name": v, "mountPath": p} for v, p in vols]
            spec["serviceName"] = name
            spec["volumeClaimTemplates"] = [{"metadata": {"name": v}, "spec": {"accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": "20Gi"}}}} for v, _ in vols]
        objs.append({"kind": kind, "metadata": {"name": name}, "spec": spec})
        if ports:
            objs.append({"kind": "Service", "metadata": {"name": name}, "spec": {"selector": {"app": name}, "ports": [{"port": p} for p in ports]}})
        if ":" not in s["image"] or s["image"].endswith(":latest"): todos.append(f"{name}: pin image '{s['image']}'")
        todos.append(f"{name}: set cpu/memory requests and memory limit")
        if "healthcheck" in s: todos.append(f"{name}: convert healthcheck to readiness/liveness probes")
        else: todos.append(f"{name}: no healthcheck; add probes{' (startup probe: model load takes minutes)' if gpus else ''}")
        if s.get("depends_on"): todos.append(f"{name}: depends_on {s['depends_on']} has no K8s equivalent; rely on readiness and connection retries")
    todos.append(f"create Secrets in the cluster store for: {', '.join(secret_keys)} (values were dev placeholders)")
    if any(o["kind"] == "StatefulSet" for o in objs): todos.append("db: consider the customer's managed Postgres instead of running it in-cluster")
    return objs, todos

objs, todos = translate(COMPOSE)
for o in objs:
    extra = ""
    if o["kind"] in ("Deployment", "StatefulSet"):
        c = o["spec"]["template"]["spec"]["containers"][0]
        extra = f"env={[e['name'] + ('*' if 'valueFrom' in e else '') for e in c['env']]}"
        if "resources" in c: extra += f" gpu={c['resources']['limits']['nvidia.com/gpu']}"
        if "volumeClaimTemplates" in o["spec"]: extra += " pvc=" + ",".join(v["metadata"]["name"] for v in o["spec"]["volumeClaimTemplates"])
    print(f"{o['kind']:<12} {o['metadata']['name']:<6} {extra}")
print("(* = from Secret)")
leaks = [e for o in objs if o["kind"] != "Service" for e in o["spec"]["template"]["spec"]["containers"][0]["env"] if e.get("value") in ("devpass", "hf_dev")]
print("secret values in env:", len(leaks))
print("\nTODO:")
for t in todos: print("  -", t)`
  },
  design: {
    lead: '<p>Kubernetes gives AI services self-healing, scaling and standard operations, at the cost of explicitness. For an FDE, the work is fitting the service into the customer’s cluster conventions: their ingress, secret store, policies, GPU pools and GitOps flow.</p>',
    scale: [{ h: 'GPU capacity', p: 'GPU nodes are scarce and slow to provision; use cluster autoscaler or Karpenter with GPU pools, keep warm replicas, and pre-pull large images or cache weights on node-local disks.' }, { h: 'Cold starts', p: 'Model load can take minutes; scaling decisions must anticipate demand (schedules, queue growth rate), and startup probes must allow for load time.' }],
    fail: [{ h: 'No requests and limits', p: 'Pods without requests get evicted or starve neighbours; memory without limits can take down nodes.' }, { h: 'Liveness kills during load', p: 'A liveness probe that fires during a 5-minute model load restarts the pod forever. Use a startup probe.' }],
    trade: [{ h: 'Self-host vs managed endpoints', p: 'Kubernetes model serving gives control and data locality; managed endpoints (10.6) remove GPU operations. Many customers run gateways on Kubernetes and call managed models.' }, { h: 'Helm vs Kustomize', p: 'Helm packages and templates; Kustomize overlays plain YAML. Follow whatever the customer already uses.' }],
    prompt: '<p>The customer’s platform team gives you a namespace in their EKS cluster with Kyverno policies and Argo CD. Deploy the RAG assistant with a self-hosted embedding model.</p>',
    answer: '<ul><li>Manifests in their GitOps repo as a Helm chart or Kustomize overlays; Argo CD syncs.</li><li>Gateway Deployment on CPU nodes with HPA; embedding server on a GPU node pool with startup probe and queue-based scaling.</li><li>Secrets via External Secrets from AWS Secrets Manager; IRSA or Pod Identity for AWS access.</li><li>Pass Kyverno checks (pinned images, non-root, resources); PDBs and zone spread; dashboards and alerts wired into their monitoring.</li></ul>'
  },
  quiz: [
    { q: 'Why use a startup probe for a model server?', o: ['To speed up loading', 'So liveness checks do not kill the pod while weights load for minutes', 'To route traffic', 'It replaces readiness'], a: 1, why: 'Startup probes defer other probes until the app is up.' },
    { q: 'The best autoscaling signal for a vLLM Deployment is usually:', o: ['CPU utilisation', 'Queue depth or in-flight requests', 'Memory', 'Pod age'], a: 1, why: 'GPU servers saturate on batch slots, not CPU.' },
    { q: 'Compose’s depends_on maps in Kubernetes to:', o: ['initContainers always', 'Nothing directly; use readiness probes and connection retries', 'PodDisruptionBudget', 'Service'], a: 1, why: 'Kubernetes has no start ordering between Deployments.' }
  ],
  interview: [
    { q: 'How would you deploy a self-hosted LLM on Kubernetes?', a: '<p>A Deployment with pinned vLLM image, one or more GPUs as limits, node selector and tolerations for the GPU pool, startup probe sized to model load time, readiness and liveness probes, memory limits and shared memory, weights from a volume or cache. A Service in front, autoscaling on queue depth with stabilisation, a PDB, zone spread and dashboards for TTFT, TPOT and GPU utilisation.</p>' },
    { q: 'What changes when moving a prototype from Compose to Kubernetes?', a: '<p>Making implicit things explicit: resources, health probes, scaling signals, disruption budgets, secrets from the cluster store instead of env files, persistent volumes or managed databases for state, no start ordering so apps must retry, and per-environment configuration through Helm or Kustomize applied by GitOps.</p>' }
  ]
});

/* ===================================================================== 10.6 */
L({
  id: '10.6', title: 'AWS, Azure, GCP managed AI platforms', minutes: 50, roles: ['fde', 'be'],
  tags: 'Amazon Bedrock and AgentCore · Microsoft Foundry · Gemini Enterprise Agent Platform (formerly Vertex AI) · private networking · IAM · quotas · data residency · committed spend',
  mental: 'Enterprises usually consume frontier models through the cloud they already trust, inside their own network, identity and billing boundary. Knowing how each major cloud exposes models (and what is the same underneath) lets an FDE fit an AI system into the customer’s existing contracts and controls.',
  intro: `<p>A customer with a large AWS commitment will ask for Amazon Bedrock; a Microsoft shop will want Microsoft Foundry (renamed from Azure AI Foundry in late 2025); a Google Cloud customer will use the Gemini Enterprise Agent Platform, which Google announced in April 2026 as the successor to Vertex AI. Each offers models from several providers (Claude is available on all three), plus agent runtimes, evaluation, guardrails and private networking. The concepts transfer; the names, IAM models and quotas differ.</p>
  <p>Platform names and capabilities change quickly. Treat the specifics here as a snapshot of late 2026 and check each provider’s current documentation during an engagement.</p>`,
  points: [
    'Why customers choose them: existing contracts and committed spend, data staying inside their cloud account and region, their IAM and audit, private networking, consolidated billing.',
    'Amazon Bedrock: many model families through one API; AgentCore for running agents (runtime, memory, identity, gateway, observability); Guardrails; Knowledge Bases.',
    'Microsoft Foundry: models from OpenAI, Anthropic and others; Foundry Agent Service; content safety; tight Entra ID and Azure networking integration.',
    'Gemini Enterprise Agent Platform: Gemini and partner models (including Claude), agent building and runtime, evaluation; the successor to Vertex AI.',
    'Model ids, features, regional availability and quotas differ per platform and lag the provider’s direct API at times: verify before promising.',
    'Keep the application portable: a gateway (9.8) and a thin client layer so the platform is configuration, not code.'
  ],
  concept: { title: 'Same engine, different dealerships', body: `<p>A given Claude model behaves essentially the same whether called directly or through Bedrock, Foundry or Google’s platform. What differs is the dealership: how you authenticate, which regions and features are offered, how quotas are raised, how the bill arrives, and which network paths are allowed. Customers pick the dealership they already have an account with.</p>` },
  walk: [
    { h: 'One SDK, several clouds', body: '<p>The Anthropic Python SDK includes clients for each platform; the request shape stays the Messages API, while authentication and endpoints change. The Code tab runs these against a mock transport to show the real URLs and auth schemes.</p>', code: String.raw`from anthropic import Anthropic, AnthropicBedrock, AnthropicVertex, AnthropicFoundry
direct  = Anthropic()                                                 # ANTHROPIC_API_KEY
bedrock = AnthropicBedrock(aws_region="eu-central-1")                 # AWS credential chain, SigV4
vertex  = AnthropicVertex(region="europe-west1", project_id="acme-ai")# Google ADC, OAuth bearer
foundry = AnthropicFoundry(resource="acme-foundry")                   # Azure key or Entra ID token provider
msg = bedrock.messages.create(model=MODEL_IDS["bedrock"]["sonnet"], max_tokens=500, messages=[...])` },
    { h: 'Network and identity', body: '<p>Production calls go through private endpoints (AWS PrivateLink, Azure Private Link, Google Private Service Connect) with workload identity (IAM roles for service accounts, managed identities, workload identity federation): no static keys, no public internet.</p>' },
    { h: 'Quotas and capacity', body: '<p>Default quotas are often far below production needs. Request increases early, consider provisioned throughput or reserved capacity for steady load, and design for throttling (429s) with retries and fallbacks (2.x, 9.8).</p>' }
  ],
  analogy: `<p><b>Buying the same car through your company’s fleet contract.</b> You could buy directly from the manufacturer, but the company already has a fleet deal: negotiated price, insurance, maintenance and an approved supplier list. The car is the same; paperwork, delivery time and optional extras differ by dealer.</p>`,
  diagram: {
    title: 'Calling models inside the customer’s cloud',
    cols: [['app'], ['gw'], ['pe'], ['aws', 'az', 'gcp'], ['models']],
    nodes: [
      { id: 'app', label: 'Customer app', sub: 'in VPC / VNet', tone: 'fde', info: 'Runs in the customer’s account.' },
      { id: 'gw', label: 'LLM gateway', sub: 'routes by config', tone: 'acc', info: 'Portable layer: auth, budgets, fallbacks (9.8).' },
      { id: 'pe', label: 'Private endpoint', sub: 'no public internet', tone: 'warn', info: 'PrivateLink / Private Link / PSC.' },
      { id: 'aws', label: 'Amazon Bedrock', sub: '+ AgentCore', tone: 'be', info: 'IAM roles, SigV4, CloudTrail.' },
      { id: 'az', label: 'Microsoft Foundry', sub: '+ Agent Service', tone: 'be', info: 'Entra ID, managed identity.' },
      { id: 'gcp', label: 'Gemini Enterprise Agent Platform', sub: 'formerly Vertex AI', tone: 'be', info: 'Google IAM, workload identity.' },
      { id: 'models', label: 'Models', sub: 'Claude · GPT · Gemini · open', tone: 'ok', info: 'Availability varies by platform and region.' }
    ],
    edges: [{ a: 'app', b: 'gw' }, { a: 'gw', b: 'pe' }, { a: 'pe', b: 'aws' }, { a: 'pe', b: 'az' }, { a: 'pe', b: 'gcp' }, { a: 'aws', b: 'models' }, { a: 'az', b: 'models' }, { a: 'gcp', b: 'models' }],
    caption: 'A portable gateway in front, the customer’s chosen cloud behind private endpoints.'
  },
  illustrated: { title: 'What to check on day one', body: `<div class="tbl"><table><thead><tr><th>question</th><th>why it matters</th></tr></thead><tbody>
    <tr><td>Which cloud and region holds their data and commitments?</td><td>decides the platform and residency</td></tr>
    <tr><td>Are the needed models and features available in that region?</td><td>features such as batch, caching or specific tools vary</td></tr>
    <tr><td>Current quotas versus projected tokens per minute</td><td>increases take time; provisioned capacity may be needed</td></tr>
    <tr><td>Private networking and identity pattern</td><td>security review will require it</td></tr>
    <tr><td>Logging and data-use terms</td><td>what is stored, where, and whether it is used for training</td></tr>
    <tr><td>Who approves new models</td><td>many enterprises keep an allow-list</td></tr></tbody></table></div>` },
  code: {
    title: 'One request, four platforms: endpoints and auth', file: 'platforms.py', deps: 'uv add "anthropic[bedrock,vertex]"',
    intro: '<p>Builds a direct client and Bedrock, Vertex (Google) and Foundry clients with dummy credentials and a mock HTTP transport, sends the same Messages request through each, and prints the endpoint and auth scheme the SDK actually used. Nothing leaves the machine. Model ids are illustrative: each platform’s catalogue gives the exact id per region.</p>',
    src: String.raw`import anthropic
try:
    import httpx2 as httpx
except ImportError:
    import httpx

seen = []
def handler(request):
    auth = request.headers.get("authorization", "")
    scheme = auth.split(" ")[0] if auth else ("api-key header" if "api-key" in request.headers else "x-api-key header")
    seen.append((request.url.host, request.url.path, scheme))
    return httpx.Response(200, json={"id": "msg_1", "type": "message", "role": "assistant", "model": "m",
                                     "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn",
                                     "stop_sequence": None, "usage": {"input_tokens": 9, "output_tokens": 1}})
http = lambda: httpx.Client(transport=httpx.MockTransport(handler))

MODEL_IDS = {"direct": "claude-sonnet-5-5", "bedrock": "claude-sonnet-5-5", "vertex": "claude-sonnet-5-5", "foundry": "claude-sonnet-5-5"}  # illustrative
clients = {
    "direct":  anthropic.Anthropic(api_key="sk-ant-demo", http_client=http()),
    "bedrock": anthropic.AnthropicBedrock(aws_region="eu-central-1", aws_access_key="AKIADEMO", aws_secret_key="demo", http_client=http()),
    "vertex":  anthropic.AnthropicVertex(region="europe-west1", project_id="acme-ai", access_token="ya29.demo", http_client=http()),
    "foundry": anthropic.AnthropicFoundry(resource="acme-foundry", api_key="azure-demo", http_client=http()),
}
for name, client in clients.items():
    client.messages.create(model=MODEL_IDS[name], max_tokens=100, messages=[{"role": "user", "content": "Summarise ticket 4411"}])
    host, path, scheme = seen[-1]
    print(f"{name:<8} {scheme:<17} https://{host}{path}")

def pick_platform(tenant):                      # the gateway's routing decision is configuration
    return {"aws": "bedrock", "gcp": "vertex", "azure": "foundry"}.get(tenant["cloud"], "direct")
for t in [{"name": "acme", "cloud": "aws"}, {"name": "globex", "cloud": "azure"}, {"name": "startup", "cloud": None}]:
    print(f"tenant {t['name']:<8} -> {pick_platform(t)}")`
  },
  lab: {
    title: 'A platform decision matrix for a customer', file: 'platform_lab.py', browser: true,
    scenario: `<p>A European insurer asks which platform to use for a claims assistant. Facts: their data lake and most workloads are on Azure with a large committed spend, a smaller analytics team uses Google Cloud, data must stay in the EU, they need a Claude model and an OpenAI model available side by side, and their security team mandates private networking and their existing identity provider. Encode hard constraints and weighted criteria, score three options (plus calling providers directly), and explain the result, including what would change the answer.</p>`,
    steps: ['Hard constraints: EU residency, both model families available, private networking, SSO with their identity provider. Options failing any are excluded.', 'Weighted criteria (sum 1.0): commitment fit, integration with data, team familiarity, feature coverage, operational simplicity; score 1–5.', 'Compute weighted totals and rank feasible options.', 'Sensitivity: vary each weight by ±0.1 (renormalised) and check whether the winner changes.', 'Print the recommendation with the key reasons and the flip conditions.'],
    checks: ['Infeasible options are excluded with the failing constraint shown.', 'Sensitivity analysis reports whether the winner is robust.', 'The write-up names what would change the decision.'],
    hints: ['The scores here are example inputs from a discovery workshop, not facts about the platforms; in a real engagement verify each with current documentation.', 'Robustness matters more to executives than the decimal places.'],
    starter: String.raw`OPTIONS = {
  "Microsoft Foundry":               {"eu": True, "claude_and_openai": True, "private": True, "sso": True},
  "Amazon Bedrock":                  {"eu": True, "claude_and_openai": True, "private": True, "sso": True},
  "Gemini Enterprise Agent Platform":{"eu": True, "claude_and_openai": False, "private": True, "sso": True},
  "Direct provider APIs":            {"eu": True, "claude_and_openai": True, "private": False, "sso": True},
}
WEIGHTS = {"commitment": 0.30, "data_integration": 0.25, "familiarity": 0.20, "features": 0.15, "ops": 0.10}
SCORES = {  # workshop scores, 1-5
  "Microsoft Foundry": {"commitment": 5, "data_integration": 5, "familiarity": 4, "features": 4, "ops": 4},
  "Amazon Bedrock": {"commitment": 1, "data_integration": 2, "familiarity": 2, "features": 5, "ops": 3},
  "Gemini Enterprise Agent Platform": {"commitment": 2, "data_integration": 3, "familiarity": 3, "features": 4, "ops": 4},
  "Direct provider APIs": {"commitment": 1, "data_integration": 2, "familiarity": 3, "features": 5, "ops": 3},
}
# TODO`,
    solution: String.raw`OPTIONS = {
  "Microsoft Foundry":               {"eu": True, "claude_and_openai": True, "private": True, "sso": True},
  "Amazon Bedrock":                  {"eu": True, "claude_and_openai": True, "private": True, "sso": True},
  "Gemini Enterprise Agent Platform":{"eu": True, "claude_and_openai": False, "private": True, "sso": True},
  "Direct provider APIs":            {"eu": True, "claude_and_openai": True, "private": False, "sso": True},
}
WEIGHTS = {"commitment": 0.30, "data_integration": 0.25, "familiarity": 0.20, "features": 0.15, "ops": 0.10}
SCORES = {  # workshop scores, 1-5
  "Microsoft Foundry": {"commitment": 5, "data_integration": 5, "familiarity": 4, "features": 4, "ops": 4},
  "Amazon Bedrock": {"commitment": 1, "data_integration": 2, "familiarity": 2, "features": 5, "ops": 3},
  "Gemini Enterprise Agent Platform": {"commitment": 2, "data_integration": 3, "familiarity": 3, "features": 4, "ops": 4},
  "Direct provider APIs": {"commitment": 1, "data_integration": 2, "familiarity": 3, "features": 5, "ops": 3},
}

feasible = {}
for name, c in OPTIONS.items():
    failed = [k for k, ok in c.items() if not ok]
    if failed: print(f"excluded {name}: fails {failed}")
    else: feasible[name] = SCORES[name]

def rank(weights):
    tot = {n: sum(weights[k] * s[k] for k in weights) for n, s in feasible.items()}
    return sorted(tot.items(), key=lambda x: -x[1])

ranking = rank(WEIGHTS)
for n, t in ranking: print(f"  {n:<20} {t:.2f}")
winner = ranking[0][0]
flips = []
for k in WEIGHTS:
    for d in (-0.1, 0.1):
        w = dict(WEIGHTS); w[k] = max(0.0, w[k] + d)
        s = sum(w.values()); w = {x: v / s for x, v in w.items()}
        if rank(w)[0][0] != winner: flips.append((k, d))
print("winner:", winner, "| robust to +-0.1 weight changes:", "yes" if not flips else f"no, flips on {flips}")
gap = ranking[0][1] - ranking[1][1]
print(f"\nRecommendation: {winner}. It fits the Azure commitment and data estate, offers both model families in EU regions,"
      f" and uses their existing identity and private networking. Lead over {ranking[1][0]}: {gap:.2f} points.")
print("Would change if: a required model or feature is missing in their EU region, the Azure commitment is exhausted,"
      " or the analytics team's Google workload becomes primary. Keep a gateway so switching is configuration.")`
  },
  design: {
    lead: '<p>Choose the platform the customer already trusts, verify what is actually available there, and keep the application portable behind a gateway so the choice remains reversible.</p>',
    scale: [{ h: 'Quotas and throughput', p: 'Plan tokens per minute per region; request increases early; use provisioned throughput for steady volume and spread across regions where residency allows.' }, { h: 'Multi-region', p: 'Cross-region inference options can raise capacity but may conflict with residency rules; check with the customer’s compliance team.' }],
    fail: [{ h: 'Feature lag', p: 'A feature available on the provider’s direct API may arrive later on a cloud platform. Confirm before designing around it.' }, { h: 'Throttling surprises', p: 'Launch-day traffic hits default quotas. Load test against the real quotas.' }],
    trade: [{ h: 'Cloud platform vs direct API', p: 'Cloud platforms bring contracts, identity, networking and residency; direct APIs bring the newest features first. Many customers use both through one gateway.' }, { h: 'Platform agent runtimes vs your own', p: 'Managed agent runtimes reduce operations and tie you to the platform; a self-built LangGraph or SDK agent stays portable.' }],
    prompt: '<p>A customer on AWS wants a Claude-based agent with tool access to internal systems, strict network isolation and audit. Outline the platform design.</p>',
    answer: '<ul><li>Claude via Amazon Bedrock in the customer’s region through a PrivateLink endpoint; IAM roles for workloads; CloudTrail and invocation logging per policy.</li><li>Agent runtime either on AgentCore or self-hosted (LangGraph on EKS); tools exposed via MCP servers inside the VPC with scoped credentials.</li><li>Quotas sized from load tests; fallbacks and budgets in the gateway.</li><li>Guardrails and evals as in Phases 7–8; a portability layer so other models or platforms remain an option.</li></ul>'
  },
  quiz: [
    { q: 'Why do enterprises often use models through their cloud platform rather than directly?', o: ['Models are smarter there', 'Existing contracts, identity, private networking, residency and billing', 'It is always cheaper', 'Direct APIs are unavailable'], a: 1, why: 'The platform fits their governance and commercial setup.' },
    { q: 'What did Google announce in April 2026 as the successor to Vertex AI?', o: ['Google AI Studio', 'Gemini Enterprise Agent Platform', 'Bedrock', 'Colab Enterprise'], a: 1, why: 'Vertex AI capabilities continue under the new platform.' },
    { q: 'What should you verify before promising a feature on a cloud platform?', o: ['Nothing', 'Availability of the model and feature in the customer’s region and quotas', 'The logo', 'The SDK version only'], a: 1, why: 'Availability and quotas vary.' }
  ],
  interview: [
    { q: 'A customer is on Azure but your team built on the direct Anthropic API. What do you do?', a: '<p>Check that the needed Claude models and features are available on Microsoft Foundry in their region, switch the client through the gateway configuration (the SDK has a Foundry client with Entra ID support), set up private networking and managed identity, size quotas, rerun the eval suite on the platform endpoint to confirm parity, and keep the direct path as a configured fallback where policy allows.</p>' },
    { q: 'Compare the three major cloud AI platforms briefly.', a: '<p>All offer multiple model families, agent runtimes, evaluation, safety filters and private networking. Bedrock is AWS-native with IAM and AgentCore; Microsoft Foundry integrates with Entra ID and Azure data services and hosts OpenAI and Anthropic models; Google’s Gemini Enterprise Agent Platform, the successor to Vertex AI, centres on Gemini with partner models including Claude. The right one is usually the customer’s existing cloud, subject to model and regional availability.</p>' }
  ]
});

/* ===================================================================== 10.7 */
L({
  id: '10.7', title: 'Incidents, rollbacks, runbooks', minutes: 50, roles: ['be', 'fde'], sim: 'burn',
  tags: 'SLOs and error budgets · burn-rate alerts · severity · incident roles · rollback first · runbooks as code · blameless postmortems · AI-specific incidents',
  mental: 'Incidents are inevitable; long incidents are not. Detect with SLO burn-rate alerts, mitigate first (usually by rolling back the last change of model, prompt, config or code), then diagnose, and turn every incident into runbooks, tests and evals so it does not recur.',
  intro: `<p>AI systems fail in the usual ways (outages, latency, bad deploys) and in their own ways: a provider degrades, a prompt change makes answers worse without errors, a retrieval index goes stale, a guardrail starts blocking good requests, costs spike from an agent loop. This lesson brings together observability (3.7, 7.7), delivery (10.4) and config (10.1–10.2) into incident response.</p>`,
  points: [
    'Define SLOs for availability, latency and quality; the error budget is how much failure the SLO allows.',
    'Alert on burn rate (how fast the budget is being spent) over two windows, so alerts are fast for big problems and quiet for noise.',
    'Mitigate before diagnosing: roll back the most recent change (image, prompt alias, config version, model route) or fail over to a fallback provider.',
    'Run incidents with roles: incident commander, operations, communications; keep a timestamped timeline.',
    'Runbooks as code: step-by-step checks and actions that can be executed, tested and kept current.',
    'Blameless postmortems produce actions: tests, eval cases, alerts, guardrails and process changes.'
  ],
  concept: { title: 'Stop the bleeding, then find the cause', body: `<p>An emergency room stabilises the patient before running every test. In production, rolling back the last change is the tourniquet: fast, low-risk and usually effective, because most incidents follow a change. Diagnosis can then happen calmly, with users already back to normal.</p>` },
  walk: [
    { h: 'Burn-rate alerts', body: '<p>For a 99.9% availability SLO over 30 days, the budget is 0.1% of requests. A burn rate of 14.4 means spending 2% of the monthly budget in one hour (the whole budget in about two days). Page when both a 1-hour and a 5-minute window exceed 14.4; open a ticket when 6-hour and 30-minute windows exceed 6.</p>', code: String.raw`burn = error_rate_in_window / (1 - SLO)       # 1.0 = exactly on budget
page   = burn(1h) > 14.4 and burn(5m) > 14.4
ticket = burn(6h) > 6  and burn(30m) > 6` },
    { h: 'Rollback levers', body: '<p>Know every lever and practise using it: previous container image, previous prompt alias version, previous config hash, model route to the last-known-good model, feature flag kill switch, and provider failover in the gateway. Each should take a minute, not a deploy.</p>' },
    { h: 'AI-specific detection', body: '<p>Quality incidents rarely throw errors. Watch online quality signals (7.7): judge scores on sampled traffic, escalation and thumbs-down rates, guardrail block rates, tool-call failure rates, tokens and cost per request. Tie them to the same alerting and rollback machinery.</p>' }
  ],
  analogy: `<p><b>Pilots and checklists.</b> When an engine warning lights up, pilots do not debate causes; they run the memorised checklist to stabilise the aircraft, then work the problem, then land. Afterwards, investigators study what happened without blame, and the checklist improves for every pilot.</p>`,
  diagram: {
    title: 'Incident lifecycle',
    cols: [['detect'], ['triage'], ['mitigate'], ['diag'], ['resolve'], ['pm']],
    nodes: [
      { id: 'detect', label: 'Detect', sub: 'burn-rate · quality signals', tone: 'warn', info: 'SLO burn-rate alerts and online quality monitors.' },
      { id: 'triage', label: 'Triage', sub: 'severity · roles', tone: 'fde', info: 'Assign incident commander; declare severity; open channel.' },
      { id: 'mitigate', label: 'Mitigate', sub: 'rollback · failover · flag off', tone: 'bad', info: 'Restore service first using rehearsed levers.' },
      { id: 'diag', label: 'Diagnose', sub: 'traces · diffs · evals', tone: 'acc', info: 'Find the cause with traces, config diffs, eval reruns.' },
      { id: 'resolve', label: 'Resolve', sub: 'fix forward safely', tone: 'ok', info: 'Fix through the normal pipeline (10.4).' },
      { id: 'pm', label: 'Postmortem', sub: 'blameless · actions', tone: 'be', info: 'Timeline, contributing factors, follow-up actions.' }
    ],
    edges: [{ a: 'detect', b: 'triage' }, { a: 'triage', b: 'mitigate' }, { a: 'mitigate', b: 'diag' }, { a: 'diag', b: 'resolve' }, { a: 'resolve', b: 'pm' }, { a: 'pm', b: 'detect', dash: true, bend: -60, label: 'new alerts, evals, runbooks' }],
    caption: 'Mitigate first, diagnose second, learn always.'
  },
  illustrated: { title: 'Common AI incidents and first moves', body: `<div class="tbl"><table><thead><tr><th>symptom</th><th>likely cause</th><th>first move</th></tr></thead><tbody>
    <tr><td>5xx and timeouts from one provider</td><td>provider degradation, quota</td><td>gateway failover to the fallback model</td></tr>
    <tr><td>quality down, no errors</td><td>prompt, model or config change</td><td>move prompt alias / config back to last good</td></tr>
    <tr><td>answers cite outdated documents</td><td>ingestion pipeline stalled</td><td>pause, re-run ingestion, show freshness banner</td></tr>
    <tr><td>guardrail blocks spike</td><td>new classifier threshold or attack</td><td>check samples; roll back threshold or rate-limit source</td></tr>
    <tr><td>cost per request doubles</td><td>agent loop, missing cache, long contexts</td><td>step and token caps; disable feature flag</td></tr></tbody></table></div>` },
  code: {
    title: 'Burn-rate detection with automatic rollback', file: 'incident_sim.py', browser: true,
    intro: '<p>Simulates per-minute traffic for 6 hours with a bad deploy at minute 200 that raises the error rate. A multi-window burn-rate alert pages, the automation rolls back to the previous config version, and the timeline and error-budget consumption are printed. A second scenario shows a quality-only regression caught by the judge-score monitor.</p>',
    src: String.raw`import random
SLO = 0.999                       # 99.9% of requests succeed over 30 days
BUDGET = 1 - SLO
RPM = 1200                        # requests per minute
MONTH_BUDGET = BUDGET * RPM * 60 * 24 * 30   # errors allowed in 30 days
rng = random.Random(4)

def simulate(bad_at, kind):
    version, history, timeline, spent, rolled_back = "cfg-41", [], [], 0, False
    def burn(window):
        h = history[-window:]
        return (sum(x["errors"] for x in h) / sum(x["n"] for x in h)) / BUDGET
    for m in range(360):
        if m == bad_at:
            version = "cfg-42"; timeline.append((m, "deploy cfg-42 (new prompt + model route)"))
        bad = version == "cfg-42"
        err_rate = 0.0004 + (0.08 if bad and kind == "errors" else 0)
        judge = 0.86 - (0.07 if bad and kind == "quality" else 0) + rng.uniform(-0.01, 0.01)
        errors = sum(rng.random() < err_rate for _ in range(RPM))
        history.append({"n": RPM, "errors": errors, "judge": judge})
        spent += errors
        if bad and not rolled_back:
            if burn(60) > 14.4 and burn(5) > 14.4:
                timeline.append((m, f"PAGE: burn rate 1h={burn(60):.0f}x 5m={burn(5):.0f}x (threshold 14.4x)"))
                version, rolled_back = "cfg-41", True
                timeline.append((m, "auto-rollback to cfg-41 (last known good config)"))
            judge_30 = sum(x["judge"] for x in history[-30:]) / 30
            if kind == "quality" and m - bad_at >= 30 and judge_30 < 0.82:
                timeline.append((m, f"QUALITY ALERT: judge score 30-min average {judge_30:.3f} < 0.82"))
                version, rolled_back = "cfg-41", True
                timeline.append((m, "auto-rollback to cfg-41; incident opened for diagnosis"))
    return timeline, spent / MONTH_BUDGET

for kind in ("errors", "quality"):
    timeline, spent = simulate(200, kind)
    print(f"--- scenario: {kind} regression ---")
    for m, ev in timeline:
        print(f"  t+{m:>3} min  {ev}")
    print(f"  30-day error budget consumed in this 6-hour window: {spent:.1%}")`
  },
  lab: {
    title: 'A runbook as code and a postmortem from its log', file: 'runbook_lab.py', browser: true,
    scenario: `<p>Write the runbook for “assistant answers degraded” as executable steps against a simulated system: each step has a check and an action, and the runner logs a timestamped timeline. Run it on an incident where a stalled ingestion job left the index 3 days stale while a prompt change also shipped. Then generate a blameless postmortem skeleton from the log, with action items.</p>`,
    steps: ['Model the system state: provider health, current and previous prompt versions, config versions, index freshness, guardrail block rate.', 'Define steps in order: check provider health → check recent changes (roll back if within 24h) → check index freshness (re-run ingestion, show banner) → check guardrails → verify recovery with a smoke eval.', 'The runner executes each step, records what was checked, what was done and when (simulated minutes).', 'Verification fails after the rollback alone, so the runbook continues to the freshness step.', 'Generate a postmortem: summary, impact, timeline, contributing factors, what went well, action items with owners.'],
    checks: ['The rollback step runs but is not sufficient; the freshness step finds the stale index.', 'Verification passes only after both mitigations.', 'Postmortem lists at least three concrete actions, none of which blame a person.'],
    hints: ['Steps as small functions returning (finding, action or None) keep the runbook testable.', 'Actions should become alerts and evals: a freshness alert and a stale-document eval case.'],
    starter: String.raw`state = {"provider_ok": True, "prompt": "answer@v12", "prompt_prev": "answer@v11", "prompt_changed_h": 6,
         "index_age_h": 74, "guardrail_block_rate": 0.011, "minute": 0}
def smoke_eval(s):  # simulated: quality depends on prompt and freshness
    q = 0.88 - (0.03 if s["prompt"] == "answer@v12" else 0) - (0.08 if s["index_age_h"] > 24 else 0)
    return round(q, 2)
# TODO: steps, runner, postmortem`,
    solution: String.raw`state = {"provider_ok": True, "prompt": "answer@v12", "prompt_prev": "answer@v11", "prompt_changed_h": 6,
         "index_age_h": 74, "guardrail_block_rate": 0.011, "minute": 0}
def smoke_eval(s):  # simulated: quality depends on prompt and freshness
    q = 0.88 - (0.03 if s["prompt"] == "answer@v12" else 0) - (0.08 if s["index_age_h"] > 24 else 0)
    return round(q, 2)
TARGET = 0.85
log = []
def note(kind, text, cost=2):
    state["minute"] += cost
    log.append((state["minute"], kind, text))

def provider(s):
    note("check", f"provider health ok={s['provider_ok']}")
    if not s["provider_ok"]:
        note("action", "gateway failover to fallback model")
def recent_change(s):
    note("check", f"prompt changed {s['prompt_changed_h']}h ago ({s['prompt_prev']} -> {s['prompt']})")
    if s["prompt_changed_h"] <= 24:
        s["prompt"] = s["prompt_prev"]; note("action", f"moved production alias back to {s['prompt']}", 3)
def verify(s):
    q = smoke_eval(s); ok = q >= TARGET
    note("verify", f"smoke eval {q:.2f} ({'pass' if ok else 'fail'}, target {TARGET})", 5)
    return ok
def freshness(s):
    note("check", f"index age {s['index_age_h']}h (expected < 24h)")
    if s["index_age_h"] > 24:
        note("action", "enabled 'information may be out of date' banner", 1)
        note("action", "restarted ingestion job; reindex complete", 25); s["index_age_h"] = 0
def guardrails(s):
    note("check", f"guardrail block rate {s['guardrail_block_rate']:.1%} (baseline 1.0%)")

RUNBOOK = [provider, recent_change, verify, freshness, guardrails, verify]
note("alert", "online judge score below threshold; incident declared SEV-2, IC assigned", 0)
for step in RUNBOOK:
    result = step(state)
    if step is verify and result:
        note("resolve", "service restored; monitoring for 60 minutes", 0)
        break

print("TIMELINE")
for m, kind, text in log:
    print(f"  t+{m:>2}m  {kind:<7} {text}")
print("""
POSTMORTEM (blameless)
Summary: answer quality degraded for about {m} minutes; two contributing changes.
Impact: grounded-answer quality fell from 0.88 to an estimated 0.77 on sampled traffic; no data exposure.
Contributing factors:
  1. Ingestion job stalled 74h ago without alerting; answers used outdated documents.
  2. Prompt answer@v12 shipped 6h ago; its eval set had no stale-document cases, so the drop compounded.
What went well: quality alert fired; prompt rollback took 3 minutes; runbook guided the freshness check.
Action items:
  - Alert when index age > 24h (owner: data platform, due 1 week)
  - Add stale-document cases to the release eval set (owner: AI team, due 1 week)
  - Show freshness metadata in answers automatically when age > 24h (owner: product, due 2 weeks)
  - Add the freshness check to the top of this runbook (owner: on-call lead, due now)""".format(m=log[-1][0]))`
  },
  design: {
    lead: '<p>Reliable AI services rehearse failure. Clear SLOs, burn-rate alerts, one-minute rollback levers, executable runbooks and blameless postmortems turn incidents into improvements rather than crises.</p>',
    scale: [{ h: 'Many services and tenants', p: 'Standard incident tooling (paging, status pages, incident channels) and per-tenant impact analysis so communications go to the right customers.' }, { h: 'Automation', p: 'Automate rollbacks for well-understood signals (canary failures, burn rate after a deploy); keep humans in the loop for ambiguous quality incidents.' }],
    fail: [{ h: 'Rollback that does not roll back', p: 'If prompts, config or index versions are not versioned, “roll back” only reverts code. Version every behaviour lever (10.1–10.2).' }, { h: 'Alert fatigue', p: 'Threshold alerts on noisy metrics get ignored. Use burn rates and SLOs, and delete alerts nobody acts on.' }],
    trade: [{ h: 'Auto-rollback vs manual', p: 'Automatic rollback shortens incidents and can thrash on noisy signals; require multi-window confirmation and a cool-down.' }, { h: 'Fix forward vs roll back', p: 'Rolling back is safer by default; fix forward only when rollback is impossible (data migrations) or the fix is trivial and tested.' }],
    prompt: '<p>Design incident response for an AI assistant used by 200 enterprise customers, run partly by the customer’s IT team.</p>',
    answer: '<ul><li>SLOs for availability, latency and quality per tenant; burn-rate paging; status page and customer comms templates.</li><li>Versioned levers: image, prompt alias, config, model route, index snapshot, feature flags; documented one-minute rollbacks.</li><li>Shared runbooks with clear ownership boundaries between your team and the customer’s IT (identity, networking, data sources).</li><li>Postmortems shared with affected customers; actions tracked to completion; new eval cases from every quality incident.</li></ul>'
  },
  quiz: [
    { q: 'What is the first priority during an incident?', o: ['Find the root cause', 'Mitigate user impact, usually by rolling back the latest change', 'Write the postmortem', 'Blame the deployer'], a: 1, why: 'Stabilise first, diagnose second.' },
    { q: 'Why multi-window burn-rate alerts?', o: ['They are cheaper', 'Fast detection of big problems with fewer false alarms from short spikes', 'Required by Kubernetes', 'They measure quality'], a: 1, why: 'Long window confirms significance; short window confirms it is still happening.' },
    { q: 'Quality drops with no errors after a release. The likely fastest mitigation:', o: ['Restart pods', 'Move the prompt alias or config back to the last known good version', 'Increase replicas', 'Clear logs'], a: 1, why: 'Behaviour levers need their own rollbacks.' }
  ],
  interview: [
    { q: 'Tell me about handling an incident in an AI system.', a: '<p>Structure it: detection (which signal, how fast), mitigation (what lever, how long), diagnosis (traces, diffs, eval reruns), resolution, and the postmortem actions. Emphasise rollback-first, communication with customers, and turning the incident into alerts, eval cases and runbook steps.</p>' },
    { q: 'How do you detect quality incidents that produce no errors?', a: '<p>Online quality monitors: sampled judge scores, user feedback and escalation rates, guardrail block rates, tool-failure rates, groundedness checks, and cost per request, tracked against baselines with alert thresholds and tied to versioned rollback levers. Every confirmed incident adds cases to the offline eval set.</p>' }
  ]
});
})();
