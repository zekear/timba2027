# Política de seguridad

## Reportar una vulnerabilidad

Si encontrás una vulnerabilidad de seguridad en Timba, **no la reportes como un issue público**.

Mandame un mail directo a: **ezeq.mina@gmail.com** con:

- Descripción de la vulnerabilidad
- Pasos para reproducirla
- Impacto estimado
- Si tenés un fix sugerido, mejor

Voy a responderte dentro de 72 horas con un acuse de recibo y un plan de remediación. Te voy a dar crédito en el changelog cuando se publique el fix (salvo que prefieras quedarte anónimo).

## Scope

Las cosas que cuentan como vulnerabilidad:

- Bypass del kill switch o de los modos de publicación.
- Exfiltración de credenciales (`X_API_*`, `DATABASE_URL`, `ADMIN_BASIC_AUTH_*`).
- Inyección SQL, XSS, CSRF en el sitio público o admin.
- Cualquier vector que permita publicar contenido no aprobado en X.

## Out of scope

- Bugs de UI sin implicancia de seguridad.
- Rate-limiting de las APIs externas (Polymarket, X, encuestadoras).
- Issues en dependencias que ya tengan CVE público — esos los voy actualizando.
