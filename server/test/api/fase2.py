import json, urllib.request, threading, sys
BASE = "http://127.0.0.1:4000"
fails = 0
def call(method, path, body=None, tenant="central", token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Host", f"{tenant}.localhost:4000")
    if data is not None: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None), dict(e.headers)
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond: fails += 1
def login(tenant, user, pw):
    return call("POST", "/api/auth/login", {"login": user, "password": pw}, tenant)[1]["token"]

T = login("central", "admin", "Admin123!xyz")
# parámetros: recargo factura 13% (seed), primer paciente 50%, vale 50
docA = call("POST", "/api/doctors", {"full_name": "Dr. Porcentaje", "use_percentage": True, "default_commission_pct": 10, "agreement_discount_pct": 10}, token=T)[1]
docB = call("POST", "/api/doctors", {"full_name": "Dr. Fijo", "use_percentage": False}, token=T)[1]
st, s1, _ = call("POST", "/api/studies", {"name": "Tomografía", "fixed_commission": 30}, token=T)
check("crear estudio", st == 201, s1)
st, p1, _ = call("POST", f"/api/studies/{s1['id']}/prices", {"price_with_report": 250, "price_without_report": 150, "effective_date": "2026-01-01"}, token=T)
st, p2, _ = call("POST", f"/api/studies/{s1['id']}/prices", {"price_with_report": 300, "price_without_report": 200, "effective_date": "2026-10-01"}, token=T)
prices = call("GET", f"/api/studies/{s1['id']}/prices", token=T)[1]
check("solo una tarifa activa", [p["is_active"] for p in prices].count(True) == 1 and next(p for p in prices if p["is_active"])["id"] == p2["id"], prices)
st, _, _ = call("PATCH", f"/api/study-prices/{p1['id']}", {"is_active": True}, token=T)
prices = call("GET", f"/api/studies/{s1['id']}/prices", token=T)[1]
check("reactivar tarifa vieja desactiva la nueva", st == 200 and [p["id"] for p in prices if p["is_active"]] == [p1["id"]], prices)
call("PATCH", f"/api/study-prices/{p2['id']}", {"is_active": True}, token=T)
h1 = call("GET", "/api/studies", token=T)[2].get("X-Cache"); lst = call("GET", "/api/studies", token=T)
check("caché de estudios MISS→HIT", h1 == "MISS" and lst[2].get("X-Cache") == "HIT", (h1, lst[2].get("X-Cache")))
check("lista muestra tarifa activa", next(s for s in lst[1] if s["id"] == s1["id"])["price_with_report"] == 300)
s2 = call("POST", "/api/studies", {"name": "Panorámica", "fixed_commission": 20}, token=T)[1]
call("POST", f"/api/studies/{s2['id']}/prices", {"price_with_report": 120, "price_without_report": 80, "effective_date": "2026-10-01"}, token=T)
s3 = call("POST", "/api/studies", {"name": "Sin tarifa"}, token=T)[1]

st, bad, _ = call("POST", "/api/patients", {"full_name": "X", "doctor_id": docA["id"], "birth_date": "2999-01-01"}, token=T)
check("fecha de nacimiento futura rechazada", st == 400, bad)
st, bad, _ = call("POST", "/api/patients", {"full_name": "X"}, token=T)
check("paciente sin doctor rechazado", st == 400, bad)
pa = call("POST", "/api/patients", {"full_name": "Ana Pérez", "doctor_id": docA["id"], "birth_date": "1990-05-10", "phone": "70011122"}, token=T)[1]
check("paciente creado con DATE sin conversión", pa["birth_date"] == "1990-05-10" and pa["doctor_name"] == "Dr. Porcentaje", pa)
pb = call("POST", "/api/patients", {"full_name": "Beto Rojas", "doctor_id": docB["id"]}, token=T)[1]

# Atención doctor A (porcentaje 10%, convenio 10%), con factura (13%), 2 estudios
body = {"patient_id": pa["id"], "with_invoice": True, "invoice_number": "F-1", "payment_method": "cash", "amount_paid": 515,
        "items": [{"study_id": s1["id"], "has_report": True}, {"study_id": s1["id"], "has_report": False}]}
st, a1, _ = call("POST", "/api/attentions", body, token=T)
check("atención creada", st == 201, a1)
if st == 201:
    # 300 + 39 recargo - 30 descuento = 309 ; 200 + 26 - 20 = 206 ; total 515
    check("total = precio + recargo - descuento", a1["total"] == 515 and [i["total"] for i in a1["items"]] == [309, 206], a1)
    check("comisión primer paciente 50% solo en el primer estudio", [i["commission"] for i in a1["items"]] == [150, 20] and [i["percentage"] for i in a1["items"]] == [50, 10], a1["items"])
    check("pago repartido", [i["paid"] for i in a1["items"]] == [309, 206] and a1["debt"] == 0, a1)
st, e, _ = call("POST", "/api/attentions", {**body, "amount_paid": 516}, token=T)
check("pago mayor al total rechazado", st == 400, e)
st, e, _ = call("POST", "/api/attentions", {**body, "items": [{"study_id": s3["id"]}]}, token=T)
check("estudio sin tarifa rechazado", st == 400 and "tarifa" in e["error"]["message"], e)
st, e, _ = call("POST", "/api/attentions", {**body, "price": 1, "amount_paid": 0, "items": [{"study_id": s2["id"], "has_report": True}]}, token=T)
check("el cliente no puede fijar el precio", st == 201 and e["total"] == 120 + 15.6 - 12, e)

# Doctor B (fijo): vale + estudio normal, anticipo parcial, sin factura
st, a2, _ = call("POST", "/api/attentions", {"patient_id": pb["id"], "payment_method": "qr", "amount_paid": 50,
        "items": [{"study_id": s2["id"], "is_voucher": True}, {"study_id": s1["id"], "has_report": True}]}, token=T)
check("vale: precio 0 y comisión 50 fija; estudio: comisión fija del estudio",
      st == 201 and [i["total"] for i in a2["items"]] == [0, 300] and [i["commission"] for i in a2["items"]] == [50, 30], a2)
if st == 201:
    rid = a2["items"][1]["id"]
    st, e, _ = call("POST", f"/api/attentions/{rid}/charge", {"amount": 251}, token=T)
    check("cobro mayor al saldo rechazado (saldo 250)", st == 400, e)
    st, c, _ = call("POST", f"/api/attentions/{rid}/charge", {"amount": 100.5}, token=T)
    check("cobro parcial", st == 200 and c["balance_after"] == 149.5, c)
    st, c, _ = call("POST", "/api/attentions/charge-all", {"patient_id": pb["id"]}, token=T)
    check("cobrar todo", st == 200 and c["amount"] == 149.5, c)
    st, c, _ = call("POST", "/api/attentions/charge-all", {"patient_id": pb["id"]}, token=T)
    check("cobrar todo sin saldo → 400", st == 400, c)
    st, d, _ = call("POST", "/api/attentions/deliver", {"ids": [i["id"] for i in a2["items"]]}, token=T)
    st2, d2, _ = call("POST", "/api/attentions/deliver", {"ids": [i["id"] for i in a2["items"]]}, token=T)
    check("entregar (y no volver a entregar)", d["delivered"] == 2 and d2["delivered"] == 0, (d, d2))

hist = call("GET", f"/api/patients/{pb['id']}/attentions", token=T)[1]
check("historial con saldo 0", all(float(h["debt"]) == 0 for h in hist) and len(hist) == 2, hist)
lst = call("GET", "/api/attentions?status=debt", token=T)[1]
check("filtro con saldo pendiente", all(float(r["debt"]) > 0 for r in lst["data"]), lst["summary"])
import datetime
today = (datetime.datetime.utcnow() - datetime.timedelta(hours=4)).date().isoformat()
lst = call("GET", f"/api/attentions?from={today}&to={today}&limit=2", token=T)[1]
check("filtro por día local + paginación + resumen", lst["total"] == 5 and len(lst["data"]) == 2 and lst["pages"] == 3, {k: lst[k] for k in ("total","pages","summary")})

# Concurrencia: dos primeras atenciones simultáneas para un doctor nuevo
docC = call("POST", "/api/doctors", {"full_name": "Dr. Nuevo", "use_percentage": True, "default_commission_pct": 5}, token=T)[1]
pc = [call("POST", "/api/patients", {"full_name": f"Pac {i}", "doctor_id": docC["id"]}, token=T)[1] for i in range(2)]
res = []
def go(p): res.append(call("POST", "/api/attentions", {"patient_id": p["id"], "payment_method": "cash", "items": [{"study_id": s2["id"]}]}, token=T))
th = [threading.Thread(target=go, args=(p,)) for p in pc]; [t.start() for t in th]; [t.join() for t in th]
pcts = sorted(r[1]["items"][0]["percentage"] for r in res if r[0] == 201)
check("concurrencia: solo una atención cuenta como primer paciente", pcts == [5, 50], [r[:2] for r in res])

com = call("GET", f"/api/commissions?doctor_id={docA['id']}", token=T)[1]
check("comisiones del doctor A", com["summary"]["total"] == 150 + 20 + 12 and com["data"][0]["patient_name"] == "Ana Pérez", com["summary"])

st, e, _ = call("DELETE", f"/api/patients/{pa['id']}", token=T)
check("no borra paciente con atenciones (409)", st == 409, e)
st, e, _ = call("DELETE", f"/api/studies/{s1['id']}", token=T)
check("no borra estudio con atenciones (409)", st == 409, e)
st, _, _ = call("DELETE", f"/api/studies/{s3['id']}", token=T)
check("borra estudio sin atenciones", st == 204)

# Permisos con RECEPCION (sucursal sur)
TR = login("sur", "recep", "Recep123!xyz")
check("RECEPCION no ve comisiones", call("GET", "/api/commissions", tenant="sur", token=TR)[0] == 403)
check("RECEPCION no crea estudios", call("POST", "/api/studies", {"name": "x"}, tenant="sur", token=TR)[0] == 403)
check("RECEPCION lista pacientes", call("GET", "/api/patients", tenant="sur", token=TR)[0] == 200)
check("aislamiento: sur no ve pacientes de central", call("GET", "/api/patients", tenant="sur", token=TR)[1]["total"] == 0)
print("\nFALLOS:", fails); sys.exit(1 if fails else 0)
