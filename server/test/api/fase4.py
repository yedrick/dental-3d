import json, urllib.request, sys, subprocess
BASE = "http://127.0.0.1:4000"; TEN = "importada"; fails = 0
def call(method, path, body=None, tenant=TEN, token=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Host", f"{tenant}.localhost:4000")
    if data is not None: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None), dict(e.headers)
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond: fails += 1
def login(user, pw, tenant=TEN):
    st, b, _ = call("POST", "/api/auth/login", {"login": user, "password": pw}, tenant)
    return b.get("token") if st == 200 else None
def audit_rows(action):
    out = subprocess.run(["docker","exec","dental3d-mysql","mysql","-uroot","-proot_dev_password","-N","dental_importada","-e",
        f"SELECT data FROM audit_logs WHERE action='{action}' ORDER BY id DESC LIMIT 1"], capture_output=True, text=True).stdout
    return out.strip()

# ---------- Datos importados ----------
T = login("admin@clinica.com", "Clave123!xyz")
check("login con la contraseña original de Supabase (bcrypt de GoTrue)", T is not None)
TC = login("caja@clinica.com", "Caja123!xyzA")
check("email importado normalizado a minúsculas", TC is not None)
check("usuario sin contraseña en Supabase no puede entrar", login("recep2@clinica.com", "Recep123!xyz") is None)
st, rep, h = call("GET", "/api/reports/summary?from=2026-10-01&to=2026-10-31", token=TC)
check("matriz personalizada importada: CAJA ve reportes", st == 200, rep)
st, rep, h = call("GET", "/api/reports/summary?from=2026-10-01&to=2026-10-31", token=T)
days = {d["day"]: d["count"] for d in rep["operational"]["by_day"]}
check("reporte agrupa por día local (23:59:59 UTC → 7 oct en Bolivia)", days.get("2026-10-07") == 1 and days.get("2026-10-01") == 1 and days.get("2026-10-08") == 1, days)
f = rep["financial"]
check("reporte financiero", f["billed"] == 395 and f["collected"] == 365 and f["commissions"] == 230 and f["deposits"] == 1500 and f["third_party"] == 800 and f["net"] == 395 - 230 - 800, f)
check("controles: sin sobrepagos, sin errores de fecha", rep["control"]["overpaid_attentions"] == 0 and rep["control"]["date_errors"]["delivered_before_created"] == 0, rep["control"])
check("controles: atención sin usuario (el vale importado)", rep["control"]["attentions_without_user"] == 1, rep["control"])
h2 = call("GET", "/api/reports/summary?from=2026-10-01&to=2026-10-31", token=T)[2]
check("reporte cacheado (HIT)", h2.get("X-Cache") == "HIT", h2.get("X-Cache"))
call("POST", "/api/cashbox", {"description": "Ajuste", "income": 50}, token=T)
r3 = call("GET", "/api/reports/summary?from=2026-10-01&to=2026-10-31", token=T)
check("un cambio de datos invalida el reporte (MISS y cifra nueva)", r3[2].get("X-Cache") == "MISS" and r3[1]["financial"]["cash_in"] == 210, (r3[2].get("X-Cache"), r3[1]["financial"]["cash_in"]))
st, e, _ = call("GET", "/api/reports/summary?from=2026-10-31&to=2026-10-01", token=T)
check("período invertido rechazado", st == 400, e)
st, dash, _ = call("GET", "/api/dashboard", token=T)
check("dashboard", st == 200 and dash["patients"] == 2 and dash["doctors"] == 2 and dash["cashbox_balance"] == 130, dash)

# ---------- Usuarios ----------
st, users, _ = call("GET", "/api/users", token=T)
check("lista de usuarios con roles", st == 200 and any(u["username"] == "admin" and u["roles"] == ["ADMIN"] for u in users), users)
pending = next(u for u in users if u["email"] == "recep2@clinica.com")
st, a, _ = call("POST", f"/api/users/{pending['id']}/approve", {"approved": True}, token=T)
st2, a2, _ = call("PATCH", f"/api/users/{pending['id']}", {"password": "Nueva123!xyz"}, token=T)
check("aprobar y dar contraseña nueva", st == 200 and a["approved"] and st2 == 200 and login("recep2@clinica.com", "Nueva123!xyz") is not None, (a, a2))
st, e, _ = call("POST", "/api/users", {"email": "x@x.com", "username": "x", "full_name": "X", "password": "corta", "roles": ["CAJA"]}, token=T)
check("contraseña débil rechazada al crear", st == 400, e)
st, sub, _ = call("POST", "/api/users", {"email": "sub@clinica.com", "username": "sub", "full_name": "Sub Admin", "password": "Sub123!xyzAB", "roles": ["SUBADMIN"]}, token=T)
check("crear usuario (queda aprobado)", st == 201 and sub["approved"] and sub["roles"] == ["SUBADMIN"], sub)
admin_id = next(u["id"] for u in users if u["username"] == "admin")
caja_id = next(u["id"] for u in users if u["username"] == "caja")

# SUBADMIN con permisos de usuarios no puede escalar
for k in ["view.users", "users.manage_roles", "users.edit", "users.create"]:
    call("PUT", f"/api/roles/SUBADMIN/permissions/{k}", token=T)
TSUB = login("sub", "Sub123!xyzAB")
check("permiso nuevo vale de inmediato (SUBADMIN lista usuarios)", call("GET", "/api/users", token=TSUB)[0] == 200)
st, e, _ = call("PUT", f"/api/users/{sub['id']}/roles", {"roles": ["ADMIN"]}, token=TSUB)
check("no-ADMIN no puede darse ADMIN", st == 403, e)
st, e, _ = call("PATCH", f"/api/users/{admin_id}", {"password": "Hack123!xyzAB"}, token=TSUB)
check("no-ADMIN no puede modificar a un ADMIN", st == 403, e)
st, e, _ = call("POST", "/api/users", {"email": "evil@x.com", "username": "evil", "full_name": "E", "password": "Evil123!xyzA", "roles": ["ADMIN"]}, token=TSUB)
check("no-ADMIN no puede crear un ADMIN", st == 403, e)

# Último ADMIN y auto-protección
st, e, _ = call("PUT", f"/api/users/{admin_id}/roles", {"roles": ["CAJA"]}, token=T)
check("no se puede quitar el último ADMIN", st == 409 and e["error"]["code"] == "LAST_ADMIN", e)
check("no puedes desactivarte", call("PATCH", f"/api/users/{admin_id}", {"active": False}, token=T)[0] == 400)
check("no puedes eliminarte", call("DELETE", f"/api/users/{admin_id}", token=T)[0] == 400)

# Revocación de sesiones
st, _, _ = call("PUT", f"/api/users/{caja_id}/roles", {"roles": ["CAJA", "AUDITOR"]}, token=T)
st, e, _ = call("GET", "/api/auth/me", token=TC)
check("cambiar roles cierra las sesiones del usuario", st == 401 and e["error"]["code"] == "SESSION_REVOKED", e)
TC = login("caja@clinica.com", "Caja123!xyzA")
st, cp, _ = call("POST", "/api/auth/change-password", {"current_password": "Caja123!xyzA", "new_password": "Caja456!xyzB"}, token=TC)
check("cambiar contraseña: token viejo deja de servir, el nuevo sí",
      st == 200 and call("GET", "/api/auth/me", token=TC)[0] == 401 and call("GET", "/api/auth/me", token=cp["token"])[0] == 200, cp)
TC = cp["token"]

# Suplantación
st, imp, _ = call("POST", f"/api/users/{caja_id}/impersonate", token=T)
check("iniciar sesión como otro usuario", st == 200 and imp["expires_in"] == 3600, imp)
me = call("GET", "/api/auth/me", token=imp["token"])[1]
check("la sesión suplantada se identifica", me["user"]["id"] == caja_id and me["impersonated_by"] == admin_id, me.get("impersonated_by"))
call("POST", "/api/cashbox", {"description": "Hecho suplantando", "income": 1}, token=imp["token"])
check("la auditoría registra quién suplantaba", admin_id in audit_rows("INSERT") and "_impersonated_by" in audit_rows("INSERT"), audit_rows("INSERT"))
check("no se puede suplantar a un ADMIN", call("POST", f"/api/users/{admin_id}/impersonate", token=T)[0] == 403)
check("no se puede suplantar desde una sesión suplantada", call("POST", f"/api/users/{sub['id']}/impersonate", token=imp["token"])[0] in (400, 403))
check("SUBADMIN sin el permiso no puede suplantar", call("POST", f"/api/users/{caja_id}/impersonate", token=TSUB)[0] == 403)

# Eliminar usuario conserva su historial
st, _, _ = call("DELETE", f"/api/users/{sub['id']}", token=T)
check("eliminar usuario", st == 204 and call("GET", f"/api/users/{sub['id']}", token=T)[0] == 404)

# ---------- Roles y parámetros ----------
st, roles, _ = call("GET", "/api/roles", token=T)
check("matriz de roles (ADMIN con todos)", st == 200 and len(roles["matrix"]["ADMIN"]) == len(roles["permissions"]) and "view.reports" in roles["matrix"]["CAJA"], roles["matrix"]["CAJA"])
check("el rol ADMIN no se edita", call("DELETE", "/api/roles/ADMIN/permissions/view.cashbox", token=T)[0] == 400)
call("DELETE", "/api/roles/CAJA/permissions/view.reports", token=T)
check("quitar permiso vale de inmediato", call("GET", "/api/reports/summary?from=2026-10-01&to=2026-10-31", token=TC)[0] == 403)
check("permiso inexistente → 404", call("PUT", "/api/roles/CAJA/permissions/no.existe", token=T)[0] == 404)
params = call("GET", "/api/params", token=TC)[1]
check("parámetros importados (recargo 15, vale 60)", {p["key"]: p["value_num"] for p in params}.get("invoice_surcharge_pct") == 15 and {p["key"]: p["value_num"] for p in params}.get("voucher_amount") == 60, params)
check("parámetro fuera de rango rechazado", call("PATCH", "/api/params/invoice_surcharge_pct", {"value_num": 200}, token=T)[0] == 400)
st, p_, _ = call("PATCH", "/api/params/invoice_surcharge_pct", {"value_num": 13}, token=T)
check("editar parámetro (y la caché se actualiza)", st == 200 and {p["key"]: p["value_num"] for p in call("GET", "/api/params", token=T)[1]}["invoice_surcharge_pct"] == 13, p_)
check("parámetro booleano", call("PATCH", "/api/params/cashbox_allow_negative", {"value_bool": True}, token=T)[0] == 200)
check("CAJA no edita parámetros", call("PATCH", "/api/params/voucher_amount", {"value_num": 1}, token=TC)[0] == 403)

# ---------- Auditoría ----------
st, au, _ = call("GET", "/api/audit?action=USER_ROLES", token=T)
check("auditoría filtrada por acción", st == 200 and au["total"] >= 1 and au["data"][0]["user_name"] == "Admin Clínica", au["data"][:1])
st, fac, _ = call("GET", "/api/audit/facets", token=T)
check("facetas de auditoría (incluye la importación)", "IMPORT_SUPABASE" in fac["actions"], fac)
check("CAJA no ve auditoría", call("GET", "/api/audit", token=TC)[0] == 403)
TR = login("recep", "Recep123!xyz", "sur")
check("RECEPCION no ve usuarios", call("GET", "/api/users", tenant="sur", token=TR)[0] == 403)
st, me, _ = call("PATCH", "/api/auth/me", {"full_name": "Recep Sur Editada"}, tenant="sur", token=TR)
check("cada usuario edita su perfil", st == 200 and me["full_name"] == "Recep Sur Editada", me)
print("\nFALLOS:", fails); sys.exit(1 if fails else 0)
