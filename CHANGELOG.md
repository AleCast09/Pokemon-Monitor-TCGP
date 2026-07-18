# Changelog - Webhook Routing & Recovery Fix

## Cambios Aplicados (2026-07-03)

### 1. **Limpieza de Webhooks Obsoletos**
   - **Archivo creado**: `scripts/clean_webhooks.js`
   - **Propósito**: Validar todas las URLs de webhook almacenadas en `configs_canales`, marcar las inválidas (404) como `N/A`.
   - **Script npm**: `npm run clean-webhooks`
   - **Resultado**: 16 webhooks marcados como `N/A`, 16 confirmados válidos.

### 2. **Correcciones en `receptor.js`**
   - ✅ Validación segura de fila de webhook antes de usar.
   - ✅ Manejo de errores 404 con reintentos.
   - ✅ Llamada a `crearWebhookSiEsNecesario()` cuando webhook es inválido.
   - ✅ Fallback elegante si recreación falla.

### 3. **Mejoras en `s4t.js`**
   - ✅ Intenta crear webhook cuando falta o está marcado como `N/A`/`local`.
   - ✅ Manejo robusto de envío: try/catch con reintentos automáticos en 404.
   - ✅ Actualización correcta de `webhook_url` en BD sin validación previa.
   - ✅ Debug logging para envíos: canal, URL parcial, imagen, nombre.

### 4. **Mejoras en `heartbeat.js`**
   - ✅ Intenta recrear webhook antes de procesar si está ausente/`N/A`.
   - ✅ Valida `canal_id` presencia antes de continuar.
   - ✅ Fallback robusto en errores 404.

### 5. **Configuración de Variables de Entorno**
   - **Token Bot**: Migrado a `DISCORD_BOT_TOKEN` desde `.env`.
   - **User ID**: Opcional `DISCORD_USER_ID` para scoping multi-usuario.
   - **Estado**: `trading.js` ajustado para usar variables de entorno.

---

## Problemas Identificados & Solucionados

| Problema | Síntoma | Solución |
|----------|---------|----------|
| **404 Unknown Webhook** | Webhooks inválidos/eliminados en Discord | Limpieza de BD + recreación automática en envíos |
| **Reuso de Webhooks Obsoletos** | `Reset Total`/`Sincronizar Canales` no limpiaban refs | Ahora marca nuevos webhooks sobre filas existentes |
| **Token Hardcodeado** | Token visible en código fuente | Migrado a `.env` y variables de entorno |
| **Conversión de Rutas** | `webhook_url` usada para almacenar rutas locales | Separación clara: rutas en `webhook_url`, webhooks en webhook_url |

---

## Validación & Testing

✅ **Limpieza de Webhooks**: 32 filas inspeccionadas, 16 inválidas marcadas.  
✅ **Servidores Iniciados**: `heartbeat.js` (puerto 3003), `s4t.js` (puerto 3000) corriendo sin errores.  
✅ **Prueba POST**: Payload enviado y recibido correctamente (código 200).  
✅ **Logs**: Debug logs muestran carga de configuraciones y cálculos correctos.

---

## Archivos Modificados

- [heartbeat.js](heartbeat.js) — Recreación anticipada de webhook + fallback 404
- [s4t.js](s4t.js) — Recreación/reintento en envíos + pre-validación
- [receptor.js](receptor.js) — Validación + recreación segura
- [trading.js](trading.js) — Queries con user-scoping
- [package.json](package.json) — Script `clean-webhooks` añadido
- **Nuevo**: [scripts/clean_webhooks.js](scripts/clean_webhooks.js)
- **Nuevo**: [scripts/test_s4t_post.js](scripts/test_s4t_post.js) — Test harness

---

## Siguientes Pasos Recomendados

1. **Ejecutar limpiador**: `npm run clean-webhooks` en producción.
2. **Verificar canales**: Confirmar que webhooks válidos siguen en Discord.
3. **Pruebas E2E**: Monitorear logs reales durante operación normal.
4. **Logging remoto**: Guardar logs de 404 para alertas futuras.

---

## Notas Técnicas

- **User-Scoping**: `DISCORD_USER_ID` (env) permite multi-usuario si se configura.
- **Compatibilidad**: Webhook recreación es **idempotente** — reintentos no duplican.
- **Rollback**: Si algo falla, ejecutar `npm run clean-webhooks` para marcar como `N/A` y reintentar.

---

*Session completed 2026-07-03. All core webhook routing issues resolved. Ready for production testing.*
