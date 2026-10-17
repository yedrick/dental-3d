"""Planes y módulos (tenancy-node 0.11, server/src/tenancy/plans.ts): menú, API y límite de usuarios.
Uso: OWNER_PASS=... python3 test/api/planes.py <id-de-sucursal-nueva>
Variables: API (http://127.0.0.1:4000), OWNER_EMAIL.
"""
import json, os, sys, time, urllib.request

API = os.environ.get("API", "http://127.0.0.1:4000")
T = sys.argv[1] if len(sys.argv) > 1 else "planes1"
H = f"{T}.localhost"
PASS = "Planes#Prueba-2026"
ok_n = fail_n = 0


def check(n, c, info=""):
    global ok_n, fail_n
    ok_n, fail_n = (ok_n + 1, fail_n) if c else (ok_n, fail_n + 1)
    print(("OK   " if c else "FAIL ") + n + ("" if c else f"  -> {str(info)[:400]}"))


def http(m, path, b=None, host=H, tok=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(API + path, data=d, method=m)
    r.add_header("Host", host)
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    if d:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            raw = x.read()
            return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


panel = lambda m, p, b=None: http(m, "/admin/api" + p, b, host="localhost", tok=PT)
code = lambda b: (b or {}).get("error", {}).get("code") if isinstance(b, dict) else None

# ---------- Sucursal nueva (sin plan → plan por defecto: Básico) ----------
_, b = http("POST", "/admin/api/auth/login", {"email": os.environ.get("OWNER_EMAIL", "owner@dental3d.local"), "password": os.environ["OWNER_PASS"], "mode": "token"}, host="localhost")
PT = b["token"]
panel("POST", "/tenants", {"id": T, "name": f"Clínica {T}"})
for _ in range(60):
    s, t = panel("GET", f"/tenants/{T}")
    if s == 200 and (t.get("tenant") or t)["status"] == "active":
        break
    time.sleep(1)
panel("POST", f"/tenants/{T}/users", {"name": "Admin Planes", "email": f"admin@{T}.prueba", "role": "ADMIN", "password": PASS})
s, b = http("POST", "/api/auth/login", {"login": f"admin@{T}.prueba", "password": PASS})
TK = b["token"]
c = lambda m, p, body=None: http(m, p, body, tok=TK)

s, plans = http("GET", "/tenancy/plans", host="localhost")
check("GET /tenancy/plans (dominio principal) trae los 3 planes", s == 200 and [p["id"] for p in plans["plans"]] == ["basico", "profesional", "clinica"], plans)
check("el catálogo trae los 8 módulos con nombre en español", len(plans["features"]) == 8 and plans["features"][0]["label"] == "Agenda de citas", plans["features"])

s, me = http("GET", "/tenancy/me")
check("sucursal nueva: plan Básico por defecto (agenda y caja, 3 usuarios)", me.get("planLabel") == "Básico" and me.get("features") == ["agenda", "caja"] and me.get("limits") == {"usuarios": 3}, me)

# ---------- Básico ----------
s, _ = c("GET", "/api/appointments")
check("Básico: Agenda permitida", s == 200, s)
s, _ = c("GET", "/api/cashbox")
check("Básico: Caja permitida", s == 200, s)
for path, name in [("/api/reports/summary?from=2026-01-01&to=2026-01-31", "Reportes"), ("/api/commissions", "Comisiones"),
                   ("/api/audit", "Auditoría"), ("/api/deposits", "Depósitos"), ("/api/third-party-payments", "Pagos a terceros"), ("/api/site", "Página web")]:
    s, e = c("GET", path)
    check(f"Básico: {name} rechazado con 403 TENANCY_FEATURE_NOT_IN_PLAN", s == 403 and code(e) == "TENANCY_FEATURE_NOT_IN_PLAN", (s, e))
s, e = c("POST", "/api/studies/import", {"rows": [], "apply": False})
check("Básico: Importar Excel rechazado", s == 403 and code(e) == "TENANCY_FEATURE_NOT_IN_PLAN", (s, e))
s, _ = c("GET", "/api/patients")
check("Básico: el núcleo (Pacientes) sigue disponible", s == 200, s)
s, _ = c("GET", "/api/dashboard")
check("Básico: Dashboard disponible", s == 200, s)

# Límite: 3 usuarios activos y aprobados. La sucursal nueva ya trae el ADMIN por defecto y el del panel.
mk = lambda i: c("POST", "/api/users", {"email": f"u{i}@{T}.prueba", "username": f"u{i}", "full_name": f"Usuario {i}", "password": PASS, "roles": ["RECEPCION"]})
s, existing = c("GET", "/api/users")
active = sum(1 for u in existing if u["active"] and u["approved"])
created = [mk(2 + i) for i in range(3 - active)]
u3 = created[-1][1]
check(f"Básico: se crean usuarios hasta llegar a 3 (ya había {active})", all(st == 201 for st, _ in created), created)
s4, e = mk(4)
check("Básico: el 4.º usuario → 403 TENANCY_PLAN_LIMIT_REACHED con max=3", s4 == 403 and code(e) == "TENANCY_PLAN_LIMIT_REACHED" and e["error"]["details"]["max"] == 3, (s4, e))
s, _ = c("PATCH", f"/api/users/{u3['id']}", {"active": False})
s4, u4 = mk(4)
check("al desactivar uno se libera el cupo", s == 200 and s4 == 201, (s, s4, u4))
s, e = c("PATCH", f"/api/users/{u3['id']}", {"active": True})
check("reactivar con el cupo lleno → 403", s == 403 and code(e) == "TENANCY_PLAN_LIMIT_REACHED", (s, e))

# Dos altas a la vez no pasan el límite (bloqueo en la transacción)
import threading
c("PATCH", f"/api/users/{u4['id']}", {"active": False})
res = []
ts = [threading.Thread(target=lambda i=i: res.append(mk(10 + i)[0])) for i in range(4)]
[t.start() for t in ts]
[t.join() for t in ts]
check("4 altas a la vez con 1 cupo: entra solo 1", sorted(res) == [201, 403, 403, 403], res)

# ---------- Cambiar de plan desde el panel ----------
s, e = panel("PATCH", f"/tenants/{T}", {"plan": "profesional"})
check("el panel cambia el plan a Profesional", s == 200, (s, e))
time.sleep(0.3)
s, me = http("GET", "/tenancy/me")
check("Profesional: /tenancy/me con los 6 módulos", me.get("planLabel") == "Profesional" and "reportes" in me.get("features", []) and "auditoria" not in me.get("features", []), me)
s, _ = c("GET", "/api/reports/summary?from=2026-01-01&to=2026-01-31")
check("Profesional: Reportes permitido", s == 200, s)
s, _ = c("GET", "/api/commissions")
check("Profesional: Comisiones permitido", s == 200, s)
s, e = c("GET", "/api/audit")
check("Profesional: Auditoría sigue rechazada", s == 403 and code(e) == "TENANCY_FEATURE_NOT_IN_PLAN", (s, e))
s, e = c("PATCH", f"/api/users/{u3['id']}", {"active": True})
check("Profesional: con límite 10 se puede reactivar", s == 200, (s, e))

# Módulo suelto sin cambiar de plan: Profesional + Auditoría
s, e = panel("PATCH", f"/tenants/{T}", {"features": {"add": ["auditoria"]}})
time.sleep(0.3)
s2, _ = c("GET", "/api/audit")
check("módulo suelto: Profesional + Auditoría", s == 200 and s2 == 200, (s, e, s2))

s, e = panel("PATCH", f"/tenants/{T}", {"plan": "clinica", "features": None})
time.sleep(0.3)
s2, _ = c("GET", "/api/deposits")
s3, me = http("GET", "/tenancy/me")
check("Clínica: todo permitido, sin límite de usuarios", s == 200 and s2 == 200 and me.get("limits", {}).get("usuarios") is None, (s, e, s2, me))

# Bajar de plan no borra datos
s, e = panel("PATCH", f"/tenants/{T}", {"plan": "basico"})
time.sleep(0.3)
s, users = c("GET", "/api/users")
check("al bajar a Básico no se borra ningún usuario", s == 200 and len(users) >= 5, (s, len(users) if isinstance(users, list) else users))

print(f"\n{ok_n}/{ok_n + fail_n} OK")
sys.exit(1 if fail_n else 0)
