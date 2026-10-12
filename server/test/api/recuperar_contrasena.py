"""Recuperar la contraseña con código por correo. Lee los correos de Mailpit (buzón local de prueba).
Uso: OWNER_PASS=... python3 test/api/recuperar_contrasena.py <id-de-sucursal-nueva>
Requisitos: la API con MAIL_SMTP_HOST=127.0.0.1 y MAIL_SMTP_PORT=1025 (Mailpit:
docker run -d --name dental3d-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:v1.27)
Variables: API, OWNER_EMAIL, MAILPIT (http://127.0.0.1:8025), MYSQL (para envejecer códigos en la prueba).
"""
import json, os, re, shlex, subprocess, sys, time, urllib.request

API = os.environ.get("API", "http://127.0.0.1:4000")
MAILPIT = os.environ.get("MAILPIT", "http://127.0.0.1:8025")
T = sys.argv[1] if len(sys.argv) > 1 else "reset1"
H = f"{T}.localhost"
PASS = "Vieja#Clave-2026"
NEW = "Nueva#Clave-2026"
EMAIL = f"ana@{T}.prueba"
ok_n = fail_n = 0


def check(n, c, info=""):
    global ok_n, fail_n
    ok_n, fail_n = (ok_n + 1, fail_n) if c else (ok_n, fail_n + 1)
    print(("OK   " if c else "FAIL ") + n + ("" if c else f"  -> {str(info)[:400]}"))


def http(m, url, b=None, headers=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(url, data=d, method=m)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
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


def call(m, p, b=None, host=H, tok=None):
    h = {"Host": host}
    if tok:
        h["Authorization"] = "Bearer " + tok
    return http(m, API + p, b, h)


def sql(q):
    cmd = shlex.split(os.environ.get("MYSQL", "mysql -h127.0.0.1 -uroot")) + ["-N", "-e", q]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30).returncode == 0


def mails(to):
    s, b = http("GET", f"{MAILPIT}/api/v1/search?query=" + urllib.parse.quote(f'to:"{to}"'))
    return b.get("messages", []) if s == 200 else []


def wait_mails(to, n, seconds=10):
    for _ in range(seconds * 4):
        m = mails(to)
        if len(m) >= n:
            return m
        time.sleep(0.25)
    return mails(to)


def last_code(to):
    m = mails(to)
    if not m:
        return None, None
    s, full = http("GET", f"{MAILPIT}/api/v1/message/{m[0]['ID']}")
    code = re.search(r"\b(\d{6})\b", full.get("Text", ""))
    return (code.group(1) if code else None), full


import urllib.parse  # noqa: E402

# ---------- Sucursal y usuario ----------
_, b = http("POST", API + "/admin/api/auth/login", {"email": os.environ.get("OWNER_EMAIL", "owner@dental3d.local"), "password": os.environ["OWNER_PASS"], "mode": "token"}, {"Host": "localhost"})
PT = b["token"]
http("POST", API + "/admin/api/tenants", {"id": T, "name": f"Clínica {T}"}, {"Host": "localhost", "Authorization": "Bearer " + PT})
for _ in range(60):
    s, t = http("GET", f"{API}/admin/api/tenants/{T}", None, {"Host": "localhost", "Authorization": "Bearer " + PT})
    if s == 200 and (t.get("tenant") or t)["status"] == "active":
        break
    time.sleep(1)
http("POST", f"{API}/admin/api/tenants/{T}/users", {"name": "Ana Recepción", "email": EMAIL, "role": "RECEPCION", "password": PASS}, {"Host": "localhost", "Authorization": "Bearer " + PT})
s, b = call("POST", "/api/auth/login", {"login": EMAIL, "password": PASS})
OLD_TOKEN = b["token"]

s, st = call("GET", "/api/auth/password-reset")
check("la recuperación por correo está activada", s == 200 and st["enabled"] is True, st)

# ---------- Pedir el código ----------
s, r1 = call("POST", "/api/auth/forgot-password", {"email": EMAIL.upper()})
s2, r2 = call("POST", "/api/auth/forgot-password", {"email": f"noexiste@{T}.prueba"})
check("misma respuesta exista o no el email", s == s2 == 200 and r1 == r2, (s, r1, s2, r2))
m = wait_mails(EMAIL, 1)
check("llegó UN correo al usuario", len(m) == 1, m)
check("no se envía nada a un email que no existe", len(mails(f"noexiste@{T}.prueba")) == 0)
code, full = last_code(EMAIL)
check("el correo trae un código de 6 dígitos", bool(code), full and full.get("Text"))
frm = (full or {}).get("From", {})
check("el remitente lleva el nombre de la sucursal", frm.get("Name") == f"Clínica {T}", frm)
check("el asunto trae el código y la sucursal", code in full.get("Subject", "") and f"Clínica {T}" in full.get("Subject", ""), full.get("Subject"))
check("el correo trae el enlace a la pantalla con el email", f"/reset-password?email=" in full.get("Text", ""), full.get("Text"))
call("POST", "/api/auth/forgot-password", {"email": EMAIL})
time.sleep(1.5)
check("pedir de nuevo antes de 1 minuto no manda otro correo", len(mails(EMAIL)) == 1, len(mails(EMAIL)))

# ---------- Código equivocado y límite de intentos ----------
wrong = "000000" if code != "000000" else "111111"
s, e = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": wrong, "new_password": NEW})
check("código equivocado → 400", s == 400 and e["error"]["code"] == "INVALID_CODE", (s, e))
s, e = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": code, "new_password": "corta"})
check("contraseña débil → error de validación", s in (400, 422), (s, e))
for _ in range(4):
    call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": wrong, "new_password": NEW})
s, e = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": code, "new_password": NEW})
check("tras 5 intentos fallidos el código queda anulado (ni el correcto sirve)", s == 400, (s, e))

# ---------- Código nuevo, vencido ----------
sql(f"UPDATE dental_{T}.password_resets SET created_at = created_at - INTERVAL 2 MINUTE")
call("POST", "/api/auth/forgot-password", {"email": EMAIL})
wait_mails(EMAIL, 2)
code2, _ = last_code(EMAIL)
check("pasado el minuto se puede pedir otro código", code2 is not None and len(mails(EMAIL)) == 2, len(mails(EMAIL)))
if sql(f"UPDATE dental_{T}.password_resets SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE used_at IS NULL"):
    s, e = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": code2, "new_password": NEW})
    check("código vencido → 400", s == 400, (s, e))

# ---------- Cambio correcto ----------
sql(f"UPDATE dental_{T}.password_resets SET created_at = created_at - INTERVAL 2 MINUTE")
call("POST", "/api/auth/forgot-password", {"email": EMAIL})
wait_mails(EMAIL, 3)
code3, _ = last_code(EMAIL)
s, b = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": code3, "new_password": NEW})
check("con el código correcto cambia la contraseña y devuelve una sesión", s == 200 and bool(b.get("token")), (s, b))
NEW_TOKEN = (b or {}).get("token")
s, me = call("GET", "/api/auth/me", tok=NEW_TOKEN)
check("la sesión nueva funciona", s == 200 and me["user"]["email"] == EMAIL, (s, me))
s, e = call("GET", "/api/auth/me", tok=OLD_TOKEN)
check("las sesiones anteriores se cerraron", s == 401, (s, e))
s, _ = call("POST", "/api/auth/login", {"login": EMAIL, "password": NEW})
check("entra con la contraseña nueva", s == 200)
s, _ = call("POST", "/api/auth/login", {"login": EMAIL, "password": PASS})
check("la contraseña vieja ya no sirve", s == 401)
s, e = call("POST", "/api/auth/reset-password", {"email": EMAIL, "code": code3, "new_password": "Otra#Clave-2026"})
check("el código no se puede usar dos veces", s == 400, (s, e))
s, _ = call("GET", f"/api/audit?table_name=users&limit=50", tok=None)

print(f"\n{ok_n}/{ok_n + fail_n} OK")
sys.exit(1 if fail_n else 0)
