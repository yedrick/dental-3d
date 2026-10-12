import json, urllib.request, threading, sys, subprocess, datetime
BASE = "http://127.0.0.1:4000"
fails = 0
def call(method, path, body=None, tenant="central", token=None, raw=None, ctype=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Host", f"{tenant}.localhost:4000")
    if data is not None: req.add_header("Content-Type", ctype or "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            raw_b = r.read(); h = dict(r.headers)
            return r.status, (json.loads(raw_b) if raw_b and "json" in h.get("Content-Type", "") else raw_b), h
    except urllib.error.HTTPError as e:
        raw_b = e.read(); h = dict(e.headers)
        return e.code, (json.loads(raw_b) if raw_b and "json" in h.get("Content-Type", "") else raw_b), h
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond: fails += 1
def login(tenant, user, pw): return call("POST", "/api/auth/login", {"login": user, "password": pw}, tenant)[1]["token"]
def sql(db, q): subprocess.run(["docker", "exec", "dental3d-mysql", "mysql", "-uroot", "-proot_dev_password", db, "-e", q], capture_output=True)

T = login("central", "admin", "Admin123!xyz"); TS = login("sur", "admin", "Admin123!xyz")

# ---------- Caja chica ----------
b0 = call("GET", "/api/cashbox/balance", token=T)[1]["balance"]
st, m1, _ = call("POST", "/api/cashbox", {"description": "Fondo inicial", "income": 100}, token=T)
st2, m2, _ = call("POST", "/api/cashbox", {"description": "Material", "expense": 30.5}, token=T)
check("caja: saldo = anterior + ingreso − gasto", st == 201 and m1["balance"] == b0 + 100 and m2["balance"] == round(b0 + 69.5, 2), (m1, m2))
st, e, _ = call("POST", "/api/cashbox", {"description": "Gasto grande", "expense": 99999}, token=T)
check("caja: gasto mayor al saldo rechazado", st == 400 and e["error"]["code"] == "INSUFFICIENT_BALANCE", e)
st, e, _ = call("POST", "/api/cashbox", {"description": "x", "income": 5, "expense": 5}, token=T)
check("caja: ingreso y gasto a la vez rechazado", st == 400, e)
st, e, _ = call("POST", "/api/cashbox", {"description": "x"}, token=T)
check("caja: movimiento en cero rechazado", st == 400, e)
before = call("GET", "/api/cashbox/balance", token=T)[1]["balance"]
res = []
def mov(i): res.append(call("POST", "/api/cashbox", {"description": f"Ingreso {i}", "income": 10}, token=T))
th = [threading.Thread(target=mov, args=(i,)) for i in range(10)]; [t.start() for t in th]; [t.join() for t in th]
after = call("GET", "/api/cashbox/balance", token=T)[1]["balance"]
bals = sorted(r[1]["balance"] for r in res if r[0] == 201)
check("caja: 10 movimientos simultáneos, saldo exacto y sin repetidos",
      all(r[0] == 201 for r in res) and round(after - before, 2) == 100 and len(set(bals)) == 10 and bals[-1] == after, (before, after, bals))
lst = call("GET", "/api/cashbox?limit=3", token=T)[1]
check("caja: lista paginada con saldo actual", len(lst["data"]) == 3 and lst["summary"]["balance"] == after and lst["data"][0]["balance"] == after, lst["summary"])
sql("dental_central", "UPDATE app_params SET value_bool=1 WHERE `key`='cashbox_allow_negative'")
st, neg, _ = call("POST", "/api/cashbox", {"description": "Adelanto", "expense": after + 1}, token=T)
check("caja: con cashbox_allow_negative=1 permite negativo", st == 201 and neg["balance"] == -1, neg)
sql("dental_central", "UPDATE app_params SET value_bool=0 WHERE `key`='cashbox_allow_negative'")
call("POST", "/api/cashbox", {"description": "Reposición", "income": 1}, token=T)

# ---------- Comprobantes ----------
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
st, up, _ = call("POST", "/api/receipts", raw=PNG, ctype="image/png", token=T)
check("comprobante PNG subido", st == 201 and up["key"].startswith("receipts/"), up)
st, e, _ = call("POST", "/api/receipts", raw=b"<svg onload=alert(1)>", ctype="image/png", token=T)
check("comprobante SVG disfrazado rechazado", st == 415, e)
st, pdf, _ = call("POST", "/api/receipts", raw=b"%PDF-1.4 fake", ctype="application/pdf", token=T)
check("comprobante PDF subido", st == 201 and pdf["key"].endswith(".pdf"), pdf)
st, e, _ = call("POST", "/api/receipts", raw=b"\x89PNG\r\n\x1a\n" + b"0" * (6 * 1024 * 1024), ctype="image/png", token=T)
check("comprobante > 5 MB rechazado", st == 413, st)
st, dep, _ = call("POST", "/api/deposits", {"amount": 1500, "deposit_date": "2026-10-08", "reference": "BNB-001", "receipt_key": up["key"]}, token=T)
check("depósito con comprobante", st == 201 and dep["receipt_url"] == up["key"] and dep["deposit_date"] == "2026-10-08", dep)
st, e, _ = call("POST", "/api/deposits", {"amount": 10, "deposit_date": "2026-10-08", "receipt_key": "receipts/2026/10/00000000-0000-0000-0000-000000000000.png"}, token=T)
check("depósito con comprobante inexistente rechazado", st == 400, e)
st, upS, _ = call("POST", "/api/receipts", raw=PNG, ctype="image/png", tenant="sur", token=TS)
st, e, _ = call("POST", "/api/deposits", {"amount": 10, "deposit_date": "2026-10-08", "receipt_key": upS["key"]}, token=T)
check("no se puede usar un comprobante de otra sucursal", st == 400, e)
st, e, _ = call("POST", "/api/deposits", {"amount": 0, "deposit_date": "2026-10-08"}, token=T)
check("depósito en cero rechazado", st == 400, e)
st, link, _ = call("GET", "/api/receipts/url?key=" + up["key"], token=T)
st, body, h = call("GET", link["url"])
check("enlace firmado descarga el archivo", st == 200 and body == PNG and h.get("Content-Type") == "image/png" and "sandbox" in h.get("Content-Security-Policy", ""), (st, h))
st, _, _ = call("GET", link["url"].replace("sig=", "sig=x"))
check("firma alterada → 403", st == 403)
st, _, _ = call("GET", link["url"], tenant="sur")
check("enlace de central no sirve en sur", st == 403)
st, _, _ = call("GET", link["url"].replace("exp=", "exp=1"))
check("expiración alterada → 403", st == 403)
st, _, _ = call("GET", "/api/receipts/file?key=../../../.env&exp=9999999999&sig=x")
check("ruta manipulada (../) → 400", st == 400)
dl = call("GET", "/api/deposits?from=2026-10-01&to=2026-10-31", token=T)[1]
check("lista de depósitos con total", dl["summary"]["total"] >= 1500 and any(d["reference"] == "BNB-001" for d in dl["data"]), dl["summary"])

# ---------- Pagos a terceros ----------
st, tp, _ = call("POST", "/api/third-party-payments", {"provider_name": "Lab Imagen", "service_type": "Mantenimiento", "amount": 800, "service_date": "2026-10-01", "payment_date": "2026-10-08", "receipt_key": pdf["key"]}, token=T)
check("pago a terceros registrado", st == 201 and tp["service_date"] == "2026-10-01", tp)
st, e, _ = call("PATCH", f"/api/third-party-payments/{tp['id']}", {"service_date": "2026-09-30"}, token=T)
check("fecha de servicio bloqueada", st == 400 and e["error"]["code"] == "SERVICE_DATE_LOCKED", e)
st, u, _ = call("PATCH", f"/api/third-party-payments/{tp['id']}", {"amount": 850, "service_date": "2026-10-01"}, token=T)
check("se puede corregir el monto (misma fecha de servicio)", st == 200 and u["amount"] == 850 and u["service_date"] == "2026-10-01", u)
st, e, _ = call("POST", "/api/third-party-payments", {"provider_name": "X", "service_type": "Y", "amount": 1, "service_date": "2026-13-01", "payment_date": "2026-10-08"}, token=T)
check("fecha inválida rechazada", st == 400, e)

# ---------- Agenda ----------
pat = call("GET", "/api/patients?limit=1&sort=name", token=T)[1]["data"][0]
st, ap, _ = call("POST", "/api/appointments", {"patient_id": pat["id"], "starts_at": "2026-10-20T09:30:00-04:00", "duration_min": 30}, token=T)
check("cita: nombre y doctor tomados del paciente; hora guardada en UTC",
      st == 201 and ap["patient_name"] == pat["full_name"] and ap["doctor_id"] == pat["doctor_id"] and str(ap["starts_at"]).startswith("2026-10-20T13:30:00"), ap)
st, ap2, _ = call("POST", "/api/appointments", {"patient_name": "Walk-in", "doctor_id": pat["doctor_id"], "starts_at": "2026-10-20T09:45:00-04:00"}, token=T)
check("cita que se cruza: se registra y avisa", st == 201 and len(ap2["overlaps"]) == 1, ap2.get("overlaps"))
st, e, _ = call("POST", "/api/appointments", {"patient_name": "X", "starts_at": "2026-10-20 09:45"}, token=T)
check("hora sin zona horaria rechazada", st == 400, e)
day = call("GET", "/api/appointments?from=2026-10-20&to=2026-10-20", token=T)[1]
check("citas del día local", {a["id"] for a in day} >= {ap["id"], ap2["id"]}, len(day))
st, s_, _ = call("PATCH", f"/api/appointments/{ap['id']}", {"status": "CONFIRMED"}, token=T)
check("cambiar estado no toca los demás campos", st == 200 and s_["status"] == "CONFIRMED" and s_["duration_min"] == 30 and s_["patient_name"] == pat["full_name"], s_)
st, e, _ = call("PATCH", f"/api/appointments/{ap['id']}", {"status": "PERDIDA"}, token=T)
check("estado inválido rechazado", st == 400, e)
st, _, _ = call("DELETE", f"/api/appointments/{ap2['id']}", token=T)
check("cita eliminada", st == 204)

# ---------- Notificaciones ----------
call("POST", "/api/auth/register", {"email": "caja@central.com", "password": "Caja123!xyzA", "username": "caja", "full_name": "Cajera Central"}, "central")
sql("dental_central", "UPDATE users SET approved=1 WHERE username='caja'; UPDATE user_roles ur JOIN users u ON u.id=ur.user_id SET ur.role='CAJA' WHERE u.username='caja'")
TC = login("central", "caja", "Caja123!xyzA")
c0 = call("GET", "/api/notifications/unread-count", token=TC)[1]["count"]
st, n, _ = call("POST", "/api/notifications", {"title": "Reunión", "body": "Mañana 8:00", "target": "all"}, token=T)
check("notificación enviada a todos (menos quien envía)", st == 201 and n["recipients"] >= 1, n)
cnt = call("GET", "/api/notifications/unread-count", token=TC)
check("contador de no leídas", cnt[1]["count"] == c0 + 1, cnt[1])
st304, _, _ = call("GET", "/api/notifications/unread-count", token=TC, headers={"If-None-Match": cnt[2]["ETag"]})
check("consulta periódica sin cambios → 304", st304 == 304, st304)
inbox = call("GET", "/api/notifications?unread=true", token=TC)[1]
check("bandeja de entrada", inbox["data"][0]["title"] == "Reunión" and inbox["data"][0]["sender_name"] == "Admin Central", inbox["data"][:1])
st, e, _ = call("POST", f"/api/notifications/{inbox['data'][0]['id']}/read", token=T)
check("no se puede marcar la notificación de otro usuario", st == 404, e)
call("POST", f"/api/notifications/{inbox['data'][0]['id']}/read", token=TC)
check("marcar leída", call("GET", "/api/notifications/unread-count", token=TC)[1]["count"] == c0)
sent = call("GET", "/api/notifications/sent", token=T)[1]["data"][0]
check("enviadas con conteo de leídas", sent["read_count"] == 1 and sent["recipients"] >= 1, sent)
check("CAJA no puede enviar notificaciones", call("POST", "/api/notifications", {"title": "x", "body": "y", "target": "all"}, token=TC)[0] == 403)

# ---------- Permisos ----------
check("CAJA ve caja y registra movimientos", call("POST", "/api/cashbox", {"description": "Venta", "income": 5}, token=TC)[0] == 201)
check("CAJA no ve pagos a terceros", call("GET", "/api/third-party-payments", token=TC)[0] == 403)
check("CAJA no ve la agenda", call("GET", "/api/appointments", token=TC)[0] == 403)
TR = login("sur", "recep", "Recep123!xyz")
check("RECEPCION no ve la caja", call("GET", "/api/cashbox", tenant="sur", token=TR)[0] == 403)
check("RECEPCION no sube comprobantes", call("POST", "/api/receipts", raw=PNG, ctype="image/png", tenant="sur", token=TR)[0] == 403)
check("RECEPCION gestiona la agenda", call("POST", "/api/appointments", {"patient_name": "Juan", "starts_at": "2026-10-21T10:00:00-04:00"}, tenant="sur", token=TR)[0] == 201)
check("aislamiento: la caja de sur es independiente", call("GET", "/api/cashbox/balance", tenant="sur", token=TS)[1]["balance"] == 0)
print("\nFALLOS:", fails); sys.exit(1 if fails else 0)
