"""Reportes: entregas por fecha de ENTREGA, pendientes al cierre y utilidad con gastos de caja chica.
Uso (después de test/api/pagos_permisos.py <id>, que deja atenciones de hoy sin entregar):
  MYSQL="mysql -h127.0.0.1 -uroot" python3 test/api/reportes.py <id>
Variables: API (http://127.0.0.1:4000), MYSQL (para mover atenciones a ayer).
"""
import datetime, json, os, shlex, subprocess, sys, urllib.request

API = os.environ.get("API", "http://127.0.0.1:4000")
T = sys.argv[1] if len(sys.argv) > 1 else "pagos1"
H = f"{T}.localhost"
ok_n = fail_n = 0


def check(n, c, info=""):
    global ok_n, fail_n
    ok_n, fail_n = (ok_n + 1, fail_n) if c else (ok_n, fail_n + 1)
    print(("OK   " if c else "FAIL ") + n + ("" if c else f"  -> {str(info)[:400]}"))


def call(m, p, b=None, tok=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(API + p, data=d, method=m)
    r.add_header("Host", H)
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


def sql(q):
    cmd = shlex.split(os.environ.get("MYSQL", "mysql -h127.0.0.1 -uroot")) + ["-N", "-e", q]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30).returncode == 0


s, b = call("POST", "/api/auth/login", {"login": f"admin@{T}.prueba", "password": "Pagos#Prueba-2026"})
TK = b["token"]
c = lambda m, p, body=None: call(m, p, body, TK)

# Días locales de la clínica (Bolivia, UTC-4)
now_bo = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=4)
TODAY = now_bo.date().isoformat()
YESTERDAY = (now_bo.date() - datetime.timedelta(days=1)).isoformat()
summary = lambda day: c("GET", f"/api/reports/summary?from={day}&to={day}")[1]

# Dos atenciones sin entregar: A y B pasan a "ayer"
s, rows = c("GET", "/api/attentions?status=pending_delivery&limit=100")
items = rows.get("items", rows.get("data", [])) if isinstance(rows, dict) else rows
pend = [r["id"] for r in items if not r.get("delivered_at")]
check("hay al menos 2 atenciones sin entregar para la prueba", len(pend) >= 2, (s, str(rows)[:200]))
A, B = pend[0], pend[1]
moved = sql(f"UPDATE dental_{T}.patient_studies SET created_at = created_at - INTERVAL 1 DAY WHERE id IN ('{A}', '{B}')")
check("A y B se movieron a ayer", moved)

before = summary(TODAY)
s, d = c("POST", "/api/attentions/deliver", {"ids": [A]})
check("se entrega A hoy", s == 200 and d["delivered"] == 1, (s, d))
after = summary(TODAY)
op0, op1 = before["operational"], after["operational"]
check("Hoy: 'Entregados' suma A aunque se registró ayer", op1["delivered"] == op0["delivered"] + 1, (op0["delivered"], op1["delivered"]))
check("Hoy: se marca como entrega de una atención de días anteriores", op1["delivered_previous"] == op0["delivered_previous"] + 1, (op0, op1))
check("Hoy: 'Pendientes' baja en 1 (incluye los de días anteriores)", op1["pending_delivery"] == op0["pending_delivery"] - 1, (op0["pending_delivery"], op1["pending_delivery"]))
ayer = summary(YESTERDAY)["operational"]
check("Ayer: A no cuenta como entregada (se entregó hoy)", ayer["delivered"] == 0, ayer)
check("Ayer: al cierre de ayer A y B estaban pendientes", ayer["pending_delivery"] >= 2, ayer)

# Utilidad = ventas − comisiones − pagos a terceros − gastos de caja chica
fin0 = after["financial"]
check("la utilidad descuenta los gastos de caja", abs(fin0["net"] - (fin0["billed"] - fin0["commissions"] - fin0["third_party"] - fin0["cash_out"])) < 0.01, fin0)
s, _ = c("POST", "/api/cashbox", {"description": "Gasto de prueba del reporte", "income": 1000})
s2, _ = c("POST", "/api/cashbox", {"description": "Gasto de prueba del reporte", "expense": 50})
fin1 = summary(TODAY)["financial"]
check("un gasto de caja de 50 baja la utilidad en 50", s2 == 201 and abs(fin1["net"] - (fin0["net"] - 50)) < 0.01 and abs(fin1["cash_out"] - (fin0["cash_out"] + 50)) < 0.01, (s, s2, fin0["net"], fin1["net"]))
check("un ingreso de caja no cambia la utilidad", abs(fin1["billed"] - fin0["billed"]) < 0.01, fin1)

print(f"\n{ok_n}/{ok_n + fail_n} OK")
sys.exit(1 if fail_n else 0)
