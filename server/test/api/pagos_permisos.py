"""Pagos (tabla payments), doctor no registrado, permisos de "ver" y rol DOCTOR, y nombre de usuario sin "@".
Uso: OWNER_PASS=... python3 test/api/pagos_permisos.py <id-de-sucursal-nueva>
Variables: API (http://127.0.0.1:4000), OWNER_EMAIL, MYSQL (comando mysql para mover una atención a ayer;
por defecto "mysql -h127.0.0.1 -uroot"; si falla, se salta esa comprobación).
"""
import json, os, shlex, subprocess, sys, time, urllib.request

API = os.environ.get("API", "http://127.0.0.1:4000")
T = sys.argv[1] if len(sys.argv) > 1 else "pagos1"
H = f"{T}.localhost"
PASS = "Pagos#Prueba-2026"
ok_n = fail_n = 0


def check(n, c, info=""):
    global ok_n, fail_n
    ok_n, fail_n = (ok_n + 1, fail_n) if c else (ok_n, fail_n + 1)
    print(("OK   " if c else "FAIL ") + n + ("" if c else f"  -> {str(info)[:400]}"))


def call(m, p, b=None, host="localhost", tok=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(API + p, data=d, method=m)
    r.add_header("Host", host)
    if d:
        r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            raw = x.read()
            return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def sql(q):
    cmd = shlex.split(os.environ.get("MYSQL", "mysql -h127.0.0.1 -uroot")) + ["-N", "-e", q]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).returncode == 0
    except Exception:
        return False


# ---------- Sucursal y usuarios ----------
_, b = call("POST", "/admin/api/auth/login", {"email": os.environ.get("OWNER_EMAIL", "owner@dental3d.local"), "password": os.environ["OWNER_PASS"], "mode": "token"})
PT = b["token"]
call("POST", "/admin/api/tenants", {"id": T, "name": "Prueba Pagos", "plan": "clinica"}, tok=PT)  # todos los módulos
for _ in range(60):
    s, t = call("GET", f"/admin/api/tenants/{T}", tok=PT)
    if s == 200 and (t.get("tenant") or t)["status"] == "active":
        break
    time.sleep(1)
call("POST", f"/admin/api/tenants/{T}/users", {"name": "Admin Pagos", "email": f"admin@{T}.prueba", "role": "ADMIN", "password": PASS}, tok=PT)


def login(user, pw=PASS):
    s, b = call("POST", "/api/auth/login", {"login": user, "password": pw}, host=H)
    return b.get("token") if s == 200 else None


TK = login(f"admin@{T}.prueba")
c = lambda m, p, b=None, tok=None: call(m, p, b, host=H, tok=tok or TK)

s, st = c("POST", "/api/studies", {"name": "Panorámica", "fixed_commission": 20})
c("POST", f"/api/studies/{st['id']}/prices", {"price_with_report": 200, "price_without_report": 150, "effective_date": "2026-01-01"})
STUDY = st["id"]
s, dA = c("POST", "/api/doctors", {"full_name": "Dra. Ana", "use_percentage": True, "default_commission_pct": 10, "agreement_discount_pct": 0})
s, dB = c("POST", "/api/doctors", {"full_name": "Dr. Beto", "use_percentage": True, "default_commission_pct": 10, "agreement_discount_pct": 0})
s, pA = c("POST", "/api/patients", {"full_name": "Paciente de Ana", "doctor_id": dA["id"]})
s, pB = c("POST", "/api/patients", {"full_name": "Paciente de Beto", "doctor_id": dB["id"]})
s, pX = c("POST", "/api/patients", {"full_name": "Paciente sin doctor"})
item = [{"study_id": STUDY, "has_report": True}]

# ---------- 1. Pagos: cada cobro con su fecha y su método ----------
s, a1 = c("POST", "/api/attentions", {"patient_id": pA["id"], "payment_method": "qr", "amount_paid": 50, "items": item})
id1 = a1["inserted_ids"][0]
c("POST", f"/api/attentions/{id1}/charge", {"amount": 20, "payment_method": "card"})
s, ca = c("POST", "/api/attentions/charge-all", {"patient_id": pA["id"], "payment_method": "cash"})
s, pays = c("GET", f"/api/attentions/payments?attention_id={id1}")
got = sorted((float(p["amount"]), p["method"], p["source"]) for p in pays)
check("pagos de una atención: QR al registrar, tarjeta en un cobro y efectivo en 'cobrar todo'",
      got == [(20.0, "card", "cobro"), (50.0, "qr", "registro"), (130.0, "cash", "cobrar_todo")], got)
s, a2 = c("POST", "/api/attentions", {"patient_id": pB["id"], "amount_paid": 0, "items": item})
check("registrar 'en entrega' (0 Bs) no exige método de pago", s == 201, (s, a2))
s, e = c("POST", "/api/attentions", {"patient_id": pB["id"], "amount_paid": 10, "items": item})
check("si se paga algo al registrar, sí exige el método", s == 400, (s, e))

# Cobrado HOY de una atención de AYER
moved = sql(f"UPDATE dental_{T}.patient_studies SET created_at = created_at - INTERVAL 1 DAY WHERE id = '{a2['inserted_ids'][0]}'")
s, ch = c("POST", f"/api/attentions/{a2['inserted_ids'][0]}/charge", {"amount": 80, "payment_method": "qr"})
s, dash = c("GET", "/api/dashboard")
check("dashboard: cobrado hoy = suma de los pagos de hoy (200 + 80)", abs(dash["collected_today"] - 280) < 0.01, dash)
if moved:
    check("dashboard: de lo cobrado hoy, 80 son de una atención de ayer", abs(dash["collected_today_previous"] - 80) < 0.01, dash)
s, rep = c("GET", f"/api/reports/summary?from={dash['date']}&to={dash['date']}")
bym = {m["method"]: m["amount"] for m in rep["financial"]["by_method"]}
check("reporte: cobrado por método según la fecha de cada pago", bym == {"qr": 130, "card": 20, "cash": 130} and abs(rep["financial"]["collected"] - 280) < 0.01, rep["financial"])

# ---------- 2. Doctor no registrado ----------
ext_pct = {"name": "Dr. Externo Pérez", "commission_type": "pct", "commission_value": 15}
s, a3 = c("POST", "/api/attentions", {"patient_id": pX["id"], "external_doctor": ext_pct, "items": item})
check("atención con doctor no registrado (15 %): comisión 30 de 200", s == 201 and a3["items"][0]["commission"] == 30, (s, a3))
s, a4 = c("POST", "/api/attentions", {"patient_id": pX["id"], "external_doctor": {"name": "Dra. Fija", "commission_type": "fixed", "commission_value": 45}, "items": item * 2})
check("doctor no registrado con monto fijo: 45 Bs por cada estudio", s == 201 and [i["commission"] for i in a4["items"]] == [45, 45], (s, a4))
s, e = c("POST", "/api/attentions", {"patient_id": pX["id"], "external_doctor": {"name": "X Y", "commission_type": "pct", "commission_value": 150}, "items": item})
check("porcentaje de más de 100 → error", s == 400, (s, e))
s, e = c("POST", "/api/attentions", {"patient_id": pX["id"], "doctor_id": dA["id"], "external_doctor": ext_pct, "items": item})
check("doctor registrado Y no registrado a la vez → error", s == 400, (s, e))
s, com = c("GET", "/api/commissions?limit=100")
names = {d["doctor_name"]: (d["external"], d["total"]) for d in com["summary"]["by_doctor"]}
check("comisiones: los no registrados aparecen con su nombre", names.get("Dr. Externo Pérez") == (True, 30) and names.get("Dra. Fija") == (True, 90), names)
s, rep = c("GET", f"/api/reports/summary?from={dash['date']}&to={dash['date']}")
check("reporte: 'Dr. Externo Pérez (no registrado)' en comisiones por doctor",
      any(r["doctor"] == "Dr. Externo Pérez (no registrado)" for r in rep["financial"]["commissions_by_doctor"]), rep["financial"]["commissions_by_doctor"])

# ---------- 3. Rol DOCTOR: solo lo suyo ----------
s, uA = c("POST", "/api/users", {"email": f"ana@{T}.prueba", "username": "ana", "full_name": "Dra. Ana", "password": PASS, "roles": ["DOCTOR"], "doctor_id": dA["id"]})
check("crear usuario DOCTOR enlazado a su ficha", s == 201 and uA["doctor_id"] == dA["id"], (s, uA))
s, e = c("POST", "/api/users", {"email": f"otra@{T}.prueba", "username": "otra", "full_name": "Otra", "password": PASS, "roles": ["DOCTOR"], "doctor_id": dA["id"]})
check("la misma ficha no se puede enlazar a dos usuarios (409)", s == 409, (s, e))
TA = login("ana")
s, me = c("GET", "/api/auth/me", tok=TA)
check("/auth/me dice scope 'doctor'", me.get("scope") == "doctor", me.get("scope"))
s, pl = c("GET", "/api/patients?limit=50", tok=TA)
check("DOCTOR ve solo sus pacientes", s == 200 and [p["full_name"] for p in pl["data"]] == ["Paciente de Ana"], pl)
s, e = c("GET", f"/api/patients/{pB['id']}", tok=TA)
check("DOCTOR no puede abrir el paciente de otro doctor (404)", s == 404, (s, e))
s, al = c("GET", "/api/attentions?limit=50", tok=TA)
check("DOCTOR ve solo sus atenciones", s == 200 and al["total"] == 1 and al["data"][0]["patient_name"] == "Paciente de Ana", al.get("total"))
s, cl = c("GET", "/api/commissions?limit=50", tok=TA)
check("DOCTOR ve solo sus comisiones", s == 200 and [d["doctor_name"] for d in cl["summary"]["by_doctor"]] == ["Dra. Ana"], cl.get("summary"))
s, dl = c("GET", "/api/doctors", tok=TA)
check("DOCTOR ve solo su ficha en la lista de doctores", s == 200 and [d["full_name"] for d in dl] == ["Dra. Ana"], dl)
s, dd = c("GET", "/api/dashboard", tok=TA)
check("dashboard del DOCTOR: sus números, sin dinero de la clínica", s == 200 and dd["scope"] == "doctor" and dd["income_today"] is None and dd["cashbox_balance"] is None and dd["patients"] == 1, dd)
for path in ["/api/cashbox/balance", "/api/reports/summary?from=2026-01-01&to=2026-12-31", "/api/deposits", "/api/third-party-payments"]:
    s, e = c("GET", path, tok=TA)
    check(f"DOCTOR no ve {path.split('?')[0]} (403)", s == 403, (s, e))
s, uN = c("POST", "/api/users", {"email": f"sinficha@{T}.prueba", "username": "sinficha", "full_name": "Doctor sin ficha", "password": PASS, "roles": ["DOCTOR"]})
TN = login("sinficha")
s, pl = c("GET", "/api/patients?limit=50", tok=TN)
check("DOCTOR sin ficha enlazada no ve ningún paciente", s == 200 and pl["total"] == 0, pl)

# ---------- 4. Permisos de "ver" según la pantalla Roles ----------
s, uC = c("POST", "/api/users", {"email": f"conta@{T}.prueba", "username": "conta", "full_name": "Contabilidad", "password": PASS, "roles": ["CONTABILIDAD"]})
TC = login("conta")
s, e = c("GET", "/api/patients?limit=5", tok=TC)
check("CONTABILIDAD (sin 'ver pacientes') no ve pacientes (403)", s == 403, (s, e))
c("PUT", "/api/roles/CONTABILIDAD/permissions/view.patients")
s, pl = c("GET", "/api/patients?limit=5", tok=TC)
check("al darle 'ver pacientes' en Roles, ya los ve", s == 200, (s, pl))
c("DELETE", "/api/roles/CONTABILIDAD/permissions/view.patients")
s, e = c("GET", "/api/patients?limit=5", tok=TC)
check("al quitárselo, deja de verlos", s == 403, (s, e))
s, e = c("GET", "/api/attentions?limit=5", tok=TC)
check("CONTABILIDAD sin 'ver atenciones' no ve atenciones (403)", s == 403, (s, e))

# ---------- 5. Nombre de usuario sin "@" ----------
s, e = c("POST", "/api/users", {"email": f"x@{T}.prueba", "username": f"admin@{T}.prueba", "full_name": "Impostor", "password": PASS, "roles": ["RECEPCION"]})
check("no se puede crear un usuario cuyo nombre sea un email (422)", s in (400, 422), (s, e))
s, e = call("POST", "/api/auth/register", {"email": "otro@correo.com", "username": "ana@correo.com", "password": PASS, "full_name": "X"}, host=H)
check("tampoco al registrarse", s in (400, 422), (s, e))

# ---------- 6. Todas las tarifas en una petición ----------
s, prices = c("GET", "/api/study-prices")
check("GET /api/study-prices trae todas las tarifas", s == 200 and len(prices) == 1, prices)

print(f"\n{ok_n}/{ok_n + fail_n} OK")
sys.exit(1 if fail_n else 0)
