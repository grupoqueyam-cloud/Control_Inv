# Estructura de Google Sheets

La función `setupSystem()` crea y configura automáticamente siete pestañas.

## Usuarios

Contiene las cuentas del sistema. La contraseña no se almacena en texto plano.

Campos principales: `id`, `username`, `password_hash`, `salt`, `role`, `investigator_id`, `full_name`, `email`, `active`, `must_change_password`, `last_login`.

## Investigadores

Directorio del personal y asociación con la carpeta principal de Drive.

Campos: `id`, `full_name`, `identification`, `email`, `phone`, `specialty`, `employment_type`, `status`, `drive_folder_id`, `drive_folder_url`.

## Procesos

Registro central de producción y seguimiento.

Campos principales: cliente, título, producto, indexación, revista, estado, prioridad, avance, investigador, contrato, fechas, APC, próxima acción, observaciones y carpeta de Drive.

## Documentos

Historial de archivos cargados desde el sistema. Google Drive conserva el archivo físico; la hoja conserva la trazabilidad y la versión lógica.

## Credenciales

Accesos de plataformas y revistas. `secret_encrypted` contiene el valor cifrado; la clave maestra se encuentra en Script Properties, no en la hoja.

## Auditoria

Registra inicio y cierre de sesión, creación y modificación de entidades, carga o eliminación de documentos y revelado de credenciales.

## Sesiones

Conserva únicamente el hash del token de sesión, el usuario, las fechas y el estado. El token real solo existe en el navegador durante la sesión.

## No modificar encabezados

Los nombres de las columnas son utilizados por el backend. Puede aplicar colores, filtros o formatos, pero no debe renombrar, eliminar ni reordenar columnas sin adaptar también `HEADERS` y el código correspondiente.
