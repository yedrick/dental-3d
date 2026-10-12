"""Pruebas masivas parte 1: aprovisionamiento concurrente, usuarios por panel, escrituras concurrentes, aislamiento."""
import json, os, time, sys, urllib.request, concurrent.futures as cf, subprocess
API = "http://127.0.0.1:4000"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
PREFIX = sys.argv[3] if len(sys.argv) > 3 else "mass"
IDS = [f"{PREFIX}{i:02d}" for i in range(1, N + 1)]
results = []
def check(name, ok, info=""):
    results.append((name, ok, info)); print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(info)[:300]}"), flush=True)
def call(method, path, body=None, host="localhost", token=None, xff=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Host", host)
    if data is not None: req.add_header("Content-Type", ctype or "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    if xff: req.add_header("X-Forwarded-For", xff)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read(); return r.status, (json.loads(b) if b and r.headers.get("Content-Type","").startswith("application/json") else b)
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b
def mysql(q):
    return subprocess.run(["docker","exec","dental3d-mysql","mysql","-uroot","-proot_dev_password","-N","-e",q],capture_output=True,text=True).stdout.strip()

# ---------- Panel ----------
st, b = call("POST", "/admin/api/auth/login", {"email": os.environ.get("OWNER_EMAIL", "owner@dental3d.local"), "password": os.environ["OWNER_PASS"], "mode": "token"})
check("panel: login del dueño", st == 200, b); PT = b["token"]

# ---------- 1. Crear N sucursales a la vez ----------
t0 = time.time()
with cf.ThreadPoolExecutor(N) as ex:
    created = list(ex.map(lambda i: call("POST", "/admin/api/tenants", {"id": i, "name": f"Sucursal {i}"}, token=PT), IDS))
check(f"crear {N} sucursales a la vez (202)", all(s == 202 for s, _ in created), [c for c in created if c[0] != 202][:3])
pending = set(IDS); deadline = time.time() + 600
while pending and time.time() < deadline:
    for i in list(pending):
        s, t = call("GET", f"/admin/api/tenants/{i}", token=PT)
        status = (t.get("tenant") or t).get("status") if isinstance(t, dict) else None
        if status in ("active", "failed"): pending.discard(i); 
        if status == "failed": check(f"{i} aprovisionada", False, t)
    time.sleep(1)
prov = time.time() - t0
check(f"{N} sucursales activas (en {prov:.1f}s)", not pending, pending)
dbs = mysql("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'dental\\_" + PREFIX + "%'")
users = mysql("SELECT COUNT(DISTINCT user) FROM mysql.db WHERE user LIKE 'dental\\_" + PREFIX + "%'")
check(f"{N} bases y {N} usuarios MySQL creados", dbs == str(N) and users == str(N), (dbs, users))
migr = mysql(" UNION ALL ".join(f"SELECT COUNT(*) FROM dental_{i}.tenancy_migrations" for i in IDS)).split()
check("todas con las 7 migraciones", all(m == "7" for m in migr), migr)
admins = mysql(" UNION ALL ".join(f"SELECT COUNT(*) FROM dental_{i}.users WHERE username='admin' AND must_change_password=1" for i in IDS)).split()
check("todas con su ADMIN por defecto (por activar)", all(a == "1" for a in admins), admins)

# ---------- 2. Usuarios por el panel (tenantUsers) ----------
def mkuser(i):
    return call("POST", f"/admin/api/tenants/{i}/users", {"name": f"Gerente {i}", "email": f"Gerente.{i}@Clinica.COM", "role": "ADMIN", "password": "Gerente#2026-Ok"}, token=PT)
with cf.ThreadPoolExecutor(N) as ex: made = list(ex.map(mkuser, IDS))
check("crear un ADMIN por sucursal desde el panel", all(s in (200, 201) for s, _ in made), [m for m in made if m[0] not in (200, 201)][:2])
s, b = call("POST", f"/admin/api/tenants/{IDS[0]}/users", {"name": "X", "email": "x@x.com", "role": "JEFE", "password": "Gerente#2026-Ok"}, token=PT)
check("panel: rol inválido → 422 (corrección)", s == 422, (s, b))
s, b = call("POST", f"/admin/api/tenants/{IDS[0]}/users", {"name": "X", "email": "no-es-email", "role": "CAJA"}, token=PT)
check("panel: email inválido → 422 (corrección)", s == 422, (s, b))
s, lst = call("GET", f"/admin/api/tenants/{IDS[0]}/users?search=gerente", token=PT)
check("panel: listar usuarios de una sucursal", s == 200 and any("gerente" in (u.get("email") or "") for u in (lst.get("items") or lst.get("users") or [])), lst)

def login(i):
    s, b = call("POST", "/api/auth/login", {"login": f"gerente.{i}@clinica.com", "password": "Gerente#2026-Ok"}, host=f"{i}.localhost")
    return b.get("token") if s == 200 else None
with cf.ThreadPoolExecutor(N) as ex: tokens = dict(zip(IDS, ex.map(login, IDS)))
check("login con email en minúsculas (el panel lo guardó normalizado)", all(tokens.values()), [k for k, v in tokens.items() if not v])
s, b = call("POST", "/api/auth/login", {"login": f"gerente.{IDS[0]}@clinica.com", "password": "Gerente#2026-Ok"}, host=f"{IDS[1]}.localhost")
check("el usuario de una sucursal NO entra en otra", s == 401, (s, b))

# ---------- 3. Datos base y escrituras concurrentes por sucursal ----------
K = 20  # atenciones concurrentes por sucursal
def setup(i):
    T = tokens[i]; H = f"{i}.localhost"
    _, d = call("POST", "/api/doctors", {"full_name": f"Dr. {i}", "use_percentage": True, "default_commission_pct": 10, "agreement_discount_pct": 10}, host=H, token=T)
    _, st_ = call("POST", "/api/studies", {"name": f"Tomografía {i}", "fixed_commission": 30}, host=H, token=T)
    call("POST", f"/api/studies/{st_['id']}/prices", {"price_with_report": 300, "price_without_report": 200, "effective_date": "2026-10-01"}, host=H, token=T)
    pats = [call("POST", "/api/patients", {"full_name": f"Paciente {i}-{k}", "doctor_id": d["id"]}, host=H, token=T)[1] for k in range(5)]
    return i, d, st_, pats
with cf.ThreadPoolExecutor(N) as ex: base = {i: (d, s_, p) for i, d, s_, p in ex.map(setup, IDS)}
check("datos base creados en todas las sucursales", all(b[0].get("id") and b[1].get("id") and len(b[2]) == 5 for b in base.values()))

jobs = []
for i in IDS:
    d, st_, pats = base[i]
    for k in range(K):
        jobs.append(("att", i, {"patient_id": pats[k % 5]["id"], "with_invoice": True, "payment_method": "cash", "amount_paid": 0,
                               "items": [{"study_id": st_["id"], "has_report": True}]}))
        jobs.append(("cash", i, {"description": f"Ingreso {k}", "income": 10}))
def run(job):
    kind, i, body = job
    path = "/api/attentions" if kind == "att" else "/api/cashbox"
    return kind, i, call("POST", path, body, host=f"{i}.localhost", token=tokens[i])[0]
t0 = time.time()
with cf.ThreadPoolExecutor(120) as ex: outs = list(ex.map(run, jobs))
el = time.time() - t0
bad = [o for o in outs if o[2] != 201]
check(f"{len(jobs)} escrituras concurrentes en {N} sucursales sin errores ({el:.1f}s, {len(jobs)/el:.0f}/s)", not bad, bad[:5])

# ---------- 4. Verificación exacta por sucursal ----------
def verify(i):
    T = tokens[i]; H = f"{i}.localhost"
    _, att = call("GET", "/api/attentions?limit=500", host=H, token=T)
    _, com = call("GET", "/api/commissions?limit=500", host=H, token=T)
    _, cash = call("GET", "/api/cashbox/balance", host=H, token=T)
    _, docs = call("GET", "/api/doctors", host=H, token=T)
    first = [c for c in com["data"] if float(c["percentage"]) == 50]
    return {
        "i": i,
        "att": att["total"], "billed": att["summary"]["total"],
        "com_total": com["summary"]["total"], "first": len(first),
        "cash": cash["balance"], "docs": [x["full_name"] for x in docs],
    }
with cf.ThreadPoolExecutor(N) as ex: ver = list(ex.map(verify, IDS))
# Cada atención: 300 + 39 (13%) − 30 (convenio 10%) = 309. Comisión: la primera 50% de 300 = 150, el resto 10% = 30.
check(f"cada sucursal tiene exactamente {K} atenciones", all(v["att"] == K for v in ver), [(v["i"], v["att"]) for v in ver if v["att"] != K])
check(f"facturado exacto en todas ({K} × 309 = {K*309})", all(abs(v["billed"] - K * 309) < 0.001 for v in ver), [(v["i"], v["billed"]) for v in ver if abs(v["billed"] - K*309) > 0.001])
check("exactamente UN 50% de primer paciente por sucursal (concurrencia)", all(v["first"] == 1 for v in ver), [(v["i"], v["first"]) for v in ver if v["first"] != 1])
check(f"comisiones exactas (150 + {K-1} × 30)", all(abs(v["com_total"] - (150 + (K - 1) * 30)) < 0.001 for v in ver), [(v["i"], v["com_total"]) for v in ver][:5])
check(f"saldo de caja exacto ({K} × 10 = {K*10}) con movimientos simultáneos", all(abs(v["cash"] - K * 10) < 0.001 for v in ver), [(v["i"], v["cash"]) for v in ver if abs(v["cash"]-K*10)>0.001])
check("aislamiento: cada sucursal solo ve SU doctor", all(v["docs"] == [f"Dr. {v['i']}"] for v in ver), [(v["i"], v["docs"]) for v in ver if v["docs"] != [f"Dr. {v['i']}"]][:3])
rows = mysql(" UNION ALL ".join(f"SELECT '{i}', COUNT(*) FROM dental_{i}.patient_studies" for i in IDS))
check("en MySQL: cada base tiene solo sus atenciones", all(r.split()[1] == str(K) for r in rows.splitlines()), rows[:200])

json.dump({"tokens": tokens, "ids": IDS, "panel": PT, "provision_seconds": prov, "writes": {"count": len(jobs), "seconds": el}}, open(sys.argv[2], "w"))
fails = [r for r in results if not r[1]]
print(f"\n{len(results)-len(fails)}/{len(results)} OK"); sys.exit(1 if fails else 0)
