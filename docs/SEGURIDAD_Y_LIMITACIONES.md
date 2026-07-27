# Seguridad y limitaciones

## Medidas incluidas

- El frontend no contiene claves de Google ni acceso directo a Sheets o Drive.
- El puente de Apps Script acepta mensajes únicamente desde los orígenes incluidos en `ALLOWED_ORIGINS`.
- Cada solicitud autenticada vuelve a validar el token, el usuario, el rol y el proceso solicitado.
- Las contraseñas de inicio de sesión se almacenan mediante hash iterativo SHA-256 con sal individual.
- Los tokens de sesión se almacenan en Sheets únicamente como hash.
- Las sesiones caducan y se invalidan al restablecer la contraseña.
- Se bloquea temporalmente el usuario después de cinco intentos fallidos.
- Las contraseñas externas se cifran con una clave maestra guardada en Script Properties.
- El acceso a una credencial queda registrado en auditoría.
- Las operaciones de Drive verifican que la carpeta o archivo esté dentro del proceso autorizado.
- Solo el administrador puede eliminar carpetas, archivos y credenciales.

## Consideraciones de GitHub Pages

GitHub Pages es público y está diseñado para contenido estático. La seguridad no depende de ocultar botones o archivos JavaScript; depende de las comprobaciones del backend de Apps Script. No coloque secretos dentro del repositorio.

## Permisos de Google Drive

La aplicación web se ejecuta como la cuenta propietaria del Apps Script. Los investigadores no necesitan acceso directo a la carpeta de Drive para usar el sistema. Si se comparte manualmente una carpeta o un archivo desde Google Drive, esa autorización queda fuera del control de la aplicación.

## Archivos

La versión entregada utiliza transferencia Base64 a través del puente de Apps Script y está configurada para 8 MB por archivo. No es adecuada para archivos científicos muy grandes, bases completas, videos o imágenes de alta resolución.

Para archivos grandes se recomienda implementar carga reanudable con Google Drive API desde un backend dedicado, como Cloud Run.

## Concurrencia y escala

La solución es apropiada para un equipo pequeño o mediano con uso administrativo normal. Google Apps Script y Google Sheets tienen cuotas, límites de ejecución y rendimiento inferior a una base de datos transaccional.

Considere migrar a Firebase, Cloud SQL o PostgreSQL cuando existan:

- decenas de usuarios conectados simultáneamente;
- miles de procesos activos;
- cargas masivas de archivos;
- necesidad de disponibilidad contractual;
- integraciones con pagos, firma electrónica o datos personales regulados.

## Copias de seguridad

Se recomienda crear copias periódicas de la hoja y conservar la carpeta de Drive bajo una cuenta institucional. La eliminación desde la aplicación envía elementos a la papelera, pero no reemplaza una política formal de respaldo.
