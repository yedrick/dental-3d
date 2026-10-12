"""Paciente sin doctor (migración 008) y carga masiva de estudios y tarifas desde Excel (/api/studies/import).
Uso: OWNER_PASS=... python3 test/api/pacientes_estudios.py <id-de-sucursal-nueva>
Crea la sucursal desde el panel, con un ADMIN admin@<id>.prueba (contraseña Excel#Prueba-2026)."""
import json, os, sys, time, urllib.request
API=os.environ.get("API","http://127.0.0.1:4000"); T=sys.argv[1] if len(sys.argv)>1 else "excelapi"; H=f"{T}.localhost"
ok_n=fail_n=0
def check(n,c,info=""):
    global ok_n,fail_n
    if c: ok_n+=1
    else: fail_n+=1
    print(("OK   " if c else "FAIL ")+n+("" if c else f"  -> {str(info)[:400]}"))
def call(m,p,b=None,host="localhost",tok=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(API+p,data=d,method=m); r.add_header("Host",host)
    if d: r.add_header("Content-Type","application/json")
    if tok: r.add_header("Authorization","Bearer "+tok)
    try:
        with urllib.request.urlopen(r,timeout=60) as x: b=x.read(); return x.status,(json.loads(b) if b else None)
    except urllib.error.HTTPError as e:
        b=e.read(); 
        try: return e.code,json.loads(b)
        except: return e.code,b
_,b=call("POST","/admin/api/auth/login",{"email":os.environ.get("OWNER_EMAIL","owner@dental3d.local"),"password":os.environ["OWNER_PASS"],"mode":"token"}); PT=b["token"]
call("POST","/admin/api/tenants",{"id":T,"name":"Prueba Excel"},tok=PT)
for _ in range(60):
    s,t=call("GET",f"/admin/api/tenants/{T}",tok=PT)
    if s==200 and (t.get("tenant") or t)["status"]=="active": break
    time.sleep(1)
call("POST",f"/admin/api/tenants/{T}/users",{"name":"Admin Excel","email":f"admin@{T}.prueba","role":"ADMIN","password":"Excel#Prueba-2026"},tok=PT)
_,b=call("POST","/api/auth/login",{"login":f"admin@{T}.prueba","password":"Excel#Prueba-2026"},host=H); TK=b["token"]
c=lambda m,p,b=None: call(m,p,b,host=H,tok=TK)

# ---- Paciente sin doctor ----
s,p=c("POST","/api/patients",{"full_name":"Paciente Sin Doctor"})
check("crear paciente SIN doctor", s==201 and p["doctor_id"] is None, (s,p))
s,lst=c("GET","/api/patients?limit=50")
check("aparece en la lista (LEFT JOIN)", any(x["id"]==p["id"] for x in lst["data"]), lst)
s,lst=c("GET","/api/patients?doctor_id=none")
check("filtro 'sin doctor'", s==200 and [x["full_name"] for x in lst["data"]]==["Paciente Sin Doctor"], lst)
s,e=c("POST","/api/patients",{"full_name":"X","doctor_id":"00000000-0000-4000-8000-000000000000"})
check("doctor inexistente sigue dando error", s==400, (s,e))

# ---- Excel: vista previa, aplicar, repetir, errores ----
filas=[
 {"fila":2,"nombre":"Panorámica","precio_con_informe":150,"precio_sin_informe":100,"comision_fija":20,"activo":True},
 {"fila":3,"nombre":"Tomografía 3D","descripcion":"CBCT","precio_con_informe":450.5,"precio_sin_informe":350,"comision_fija":50},
 {"fila":4,"nombre":"Periapical"},
]
s,r=c("POST","/api/studies/import",{"filas":filas,"fecha_vigencia":"2026-10-12"})
check("vista previa: 3 a crear, 2 tarifas, nada aplicado", s==200 and r["aplicado"] is False and r["resumen"]["crear"]==3 and r["resumen"]["nuevas_tarifas"]==2, r)
check("vista previa avisa del estudio sin tarifa", any(f.get("aviso") for f in r["filas"] if f["nombre"]=="Periapical"), r["filas"])
s,st=c("GET","/api/studies"); check("la vista previa no guardó nada", st==[], st)
s,r=c("POST","/api/studies/import",{"filas":filas,"fecha_vigencia":"2026-10-12","aplicar":True})
check("aplicar: creados", s==200 and r["aplicado"] and r["resumen"]["crear"]==3, r)
s,st=c("GET","/api/studies"); m={x["name"]:x for x in st}
check("precios y comisión guardados", float(m["Tomografía 3D"]["price_with_report"])==450.5 and float(m["Panorámica"]["fixed_commission"])==20 and m["Periapical"]["price_with_report"] is None, m)
s,r=c("POST","/api/studies/import",{"filas":filas,"fecha_vigencia":"2026-10-12"})
check("subir el mismo archivo otra vez: sin cambios", r["resumen"]["sin_cambios"]==3 and r["resumen"]["crear"]==0, r)
filas2=[{"fila":2,"nombre":"panoramica","precio_con_informe":180,"precio_sin_informe":120},{"fila":3,"nombre":"Periapical","precio_con_informe":60,"precio_sin_informe":40,"activo":False}]
s,r=c("POST","/api/studies/import",{"filas":filas2,"fecha_vigencia":"2026-11-01","aplicar":True})
check("'panoramica' sin tilde = mismo estudio; nuevas tarifas", r["aplicado"] and r["resumen"]["actualizar"]==2 and r["resumen"]["crear"]==0 and r["resumen"]["nuevas_tarifas"]==2, r)
s,st=c("GET","/api/studies"); m={x["name"]:x for x in st}
s,hist=c("GET",f"/api/studies/{m['Panorámica']['id']}/prices")
check("historial: la tarifa vieja queda inactiva y la nueva activa", len(hist)==2 and sum(1 for h in hist if h["is_active"])==1 and float([h for h in hist if h["is_active"]][0]["price_with_report"])==180, hist)
check("Periapical desactivado", m["Periapical"]["active"] is False, m["Periapical"])
malas=[{"fila":2,"nombre":"","precio_con_informe":10,"precio_sin_informe":5},{"fila":3,"nombre":"Nuevo","precio_con_informe":10},
       {"fila":4,"nombre":"Otro","precio_con_informe":-5,"precio_sin_informe":3},{"fila":5,"nombre":"Rx","precio_con_informe":1.234,"precio_sin_informe":1},
       {"fila":6,"nombre":"Bien","precio_con_informe":10,"precio_sin_informe":5},{"fila":7,"nombre":"BIEN","precio_con_informe":11,"precio_sin_informe":5}]
s,r=c("POST","/api/studies/import",{"filas":malas,"fecha_vigencia":"2026-10-12","aplicar":True})
check("con errores no se aplica nada (todo o nada)", r["aplicado"] is False and {e["fila"] for e in r["errores"]}=={2,3,4,5,7}, r["errores"])
s,st=c("GET","/api/studies"); check("…y no se creó 'Bien'", not any(x["name"]=="Bien" for x in st), [x["name"] for x in st])
print("\n".join(f"   fila {e['fila']}: {e['mensaje']}" for e in r["errores"]))

# ---- Atenciones ----
pano=m["Panorámica"]["id"]
s,a=c("POST","/api/attentions",{"patient_id":p["id"],"with_invoice":False,"payment_method":"cash","amount_paid":0,"items":[{"study_id":pano,"has_report":True}]})
check("atención de paciente sin doctor: se registra", s==201 and a["doctor_id"] is None and a["total"]==180, (s,a))
check("…sin comisión", a.get("items",[{}])[0].get("commission")==0, a)
s,com=c("GET","/api/commissions?limit=50"); check("…y no aparece en comisiones", com["total"]==0, com)
s,d=c("POST","/api/doctors",{"full_name":"Dra. Con Convenio","use_percentage":True,"default_commission_pct":10,"agreement_discount_pct":10})
s,p2=c("POST","/api/patients",{"full_name":"Paciente Con Doctor","doctor_id":d["id"]})
s,a2=c("POST","/api/attentions",{"patient_id":p2["id"],"with_invoice":False,"payment_method":"cash","amount_paid":0,"items":[{"study_id":pano,"has_report":True}]})
check("paciente con doctor: descuento y comisión como antes (primer paciente 50%)", s==201 and a2["total"]==162 and a2["items"][0]["commission"]==90, a2)
s,p3=c("PATCH",f"/api/patients/{p2['id']}",{"doctor_id":None})
check("quitarle el doctor a un paciente", s==200 and p3["doctor_id"] is None, (s,p3))
s,lst=c("GET","/api/attentions?limit=50"); check("lista de atenciones incluye la sin doctor", lst["total"]==2, lst["total"])
# ---- "Primer paciente": cuenta por el doctor de la ATENCIÓN (bug corregido) ----
import concurrent.futures as cf
s,dB=c("POST","/api/doctors",{"full_name":"Dr. Primer Paciente","use_percentage":True,"default_commission_pct":10,"agreement_discount_pct":0})
s,pS=c("POST","/api/patients",{"full_name":"Sin doctor, atendido por Dr. Primer"})
pcts=[c("POST","/api/attentions",{"patient_id":pS["id"],"doctor_id":dB["id"],"with_invoice":False,"payment_method":"cash","amount_paid":0,
       "items":[{"study_id":pano,"has_report":True}]})[1]["items"][0]["percentage"] for _ in range(3)]
check("paciente sin doctor atendido por un doctor: 50% solo la primera vez", pcts==[50,10,10], pcts)
s,dC=c("POST","/api/doctors",{"full_name":"Dr. Concurrente","use_percentage":True,"default_commission_pct":10,"agreement_discount_pct":0})
pats=[c("POST","/api/patients",{"full_name":f"Concurrente {i}"})[1]["id"] for i in range(15)]
def una(pid):
    return c("POST","/api/attentions",{"patient_id":pid,"doctor_id":dC["id"],"with_invoice":False,"payment_method":"cash","amount_paid":0,
             "items":[{"study_id":pano,"has_report":True}]})[1]["items"][0]["percentage"]
with cf.ThreadPoolExecutor(15) as ex: conc=list(ex.map(una,pats))
check("15 atenciones a la vez del mismo doctor: exactamente UNA con 50%", conc.count(50)==1 and conc.count(10)==14, conc)

print(f"\n{ok_n}/{ok_n+fail_n} OK"); sys.exit(1 if fail_n else 0)
