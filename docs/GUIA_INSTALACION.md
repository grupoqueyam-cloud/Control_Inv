# Guía de instalación

## 1. Crear Google Sheets

1. Cree una hoja de cálculo vacía en la cuenta que administrará el sistema.
2. Copie el ID de la URL. En una dirección como:

   `https://docs.google.com/spreadsheets/d/1AbC...XYZ/edit`

   el ID corresponde a `1AbC...XYZ`.
3. No cree pestañas manualmente; la función `setupSystem()` las generará.

## 2. Crear la carpeta principal en Google Drive

1. Cree una carpeta, por ejemplo `CONTROL INVESTIGADORES`.
2. Copie el ID ubicado después de `/folders/` en la URL.
3. Mantenga la carpeta privada. Apps Script trabajará con los permisos de la cuenta propietaria.

## 3. Crear el proyecto de Google Apps Script

1. Abra Google Apps Script y cree un proyecto nuevo.
2. Reemplace el contenido de `Code.gs` por el archivo `backend/Code.gs` de este paquete.
3. Cree un archivo HTML llamado exactamente `Bridge` y copie el contenido de `backend/Bridge.html`.
4. En la configuración del proyecto, active la visualización del archivo de manifiesto.
5. Reemplace `appsscript.json` por el contenido de `backend/appsscript.json`.

## 4. Configurar Code.gs

Edite el bloque `SETTINGS` al inicio de `Code.gs`:

```javascript
SPREADSHEET_ID: 'ID_DE_LA_HOJA',
ROOT_FOLDER_ID: 'ID_DE_LA_CARPETA',
ALLOWED_ORIGINS: ['https://SU_USUARIO.github.io'],
INITIAL_ADMIN: {
  username: 'admin',
  password: 'UnaClaveTemporal123',
  full_name: 'Administrador General',
  email: 'correo@empresa.com'
}
```

### Origen permitido

Para un sitio `https://empresa.github.io/control-investigadores/`, el origen es solamente:

`https://empresa.github.io`

No incluya la ruta `/control-investigadores/` ni una barra al final.

## 5. Inicializar el sistema

1. En el selector de funciones de Apps Script, elija `setupSystem`.
2. Pulse **Ejecutar**.
3. Autorice los permisos solicitados para Sheets y Drive.
4. Confirme que la ejecución termina con el mensaje de configuración completada.
5. Abra la hoja de cálculo y compruebe que existen las pestañas:
   - Usuarios
   - Investigadores
   - Procesos
   - Documentos
   - Credenciales
   - Auditoria
   - Sesiones

`setupSystem()` también crea una clave maestra en Script Properties para cifrar las credenciales externas.

## 6. Desplegar Apps Script como aplicación web

1. Pulse **Implementar > Nueva implementación**.
2. Seleccione **Aplicación web**.
3. Configure:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
4. Implemente y copie la URL terminada en `/exec`.
5. No use la URL de prueba terminada en `/dev`.

Cuando modifique `Code.gs` o `Bridge.html`, cree una nueva versión de la implementación o edite la implementación existente para apuntar a una versión nueva.

## 7. Configurar el frontend

Abra `assets/js/config.js` y reemplace:

```javascript
BRIDGE_URL: 'PEGAR_AQUI_URL_DE_APPS_SCRIPT_EXEC'
```

por la URL `/exec` obtenida en el paso anterior.

Compruebe que `MAX_FILE_SIZE_MB` coincide con el límite configurado en `Code.gs`.

## 8. Publicar en GitHub Pages

1. Cree un repositorio, por ejemplo `control-investigadores`.
2. Suba el contenido de la carpeta principal del paquete. `index.html` debe quedar en la raíz.
3. Abra **Settings > Pages**.
4. Seleccione publicación desde una rama.
5. Elija la rama `main` y la carpeta `/root`.
6. Guarde y abra la URL publicada.

El archivo `.nojekyll` evita transformaciones innecesarias de Jekyll.

## 9. Primer ingreso

1. Ingrese con el usuario y contraseña configurados en `INITIAL_ADMIN`.
2. El sistema solicitará cambiar la contraseña de forma obligatoria.
3. Cree primero los investigadores.
4. Cree una cuenta para cada investigador y asóciela con su registro.
5. Cree los procesos y seleccione al investigador responsable.

## 10. Prueba funcional recomendada

Realice estas verificaciones antes de utilizar el sistema con información real:

1. Crear un investigador.
2. Comprobar que aparece su carpeta en Drive.
3. Crear una cuenta de investigador.
4. Crear y asignar un proceso.
5. Comprobar las siete subcarpetas automáticas.
6. Ingresar con el usuario investigador.
7. Verificar que solo visualice su proceso.
8. Subir un archivo de prueba.
9. Crear una credencial y comprobar el revelado.
10. Revisar los registros en la pestaña `Auditoria`.

## Actualización del sistema

Los archivos del frontend pueden actualizarse directamente en GitHub. Los cambios del backend requieren guardar `Code.gs`/`Bridge.html` y actualizar la versión de la implementación web. La URL `/exec` puede conservarse si se edita la implementación existente.
