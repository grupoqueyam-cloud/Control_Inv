# DIAGNÓSTICO DEL ZIP RECIBIDO

El ZIP recibido mezcla dos versiones incompatibles:

- `assets/js/api.js`: transporte POST, espera `doPost(e)` y `BridgeResponse.html`.
- `backend/Code.gs`: versión antigua, solo contiene `doGet(e)`.
- `backend/Bridge.html`: versión antigua basada en `parent.postMessage()`.
- No existía `backend/BridgeResponse.html`.
- El `Code.gs` guardado en el ZIP conserva `PEGAR_ID_DE_GOOGLE_SHEETS`,
  `PEGAR_ID_DE_CARPETA_DRIVE` y `https://PEGAR_USUARIO.github.io`.

## Punto fundamental

GitHub Pages NO ejecuta archivos `.gs`. Tener `backend/Code.gs` dentro del
repositorio no actualiza el proyecto publicado en Google Apps Script.

Debe copiarse el parche dentro de `script.google.com`, crear el archivo HTML
`BridgeResponse`, guardar y publicar una nueva versión de la aplicación web.

## Origen correcto

Para:

`https://grupoqueyam-cloud.github.io/Control_Inv/`

use:

```javascript
ALLOWED_ORIGINS: ['https://grupoqueyam-cloud.github.io'],
```

## Prueba obligatoria

Abra:

`URL_EXEC?origin=https%3A%2F%2Fgrupoqueyam-cloud.github.io`

La página debe mostrar:

- `Backend activo`
- `"backend_version": "1.3.0"`
- `"origin_allowed": true`
- `"spreadsheet_configured": true`
- `"drive_configured": true`

Mientras no aparezcan esos cinco resultados, GitHub Pages seguirá mostrando
error porque la URL `/exec` todavía apunta a código antiguo o incompleto.
