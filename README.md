# Sistema de Control de Investigadores

Aplicación web preparada para funcionar en **GitHub Pages**, con un backend de **Google Apps Script**, datos estructurados en **Google Sheets** y documentos almacenados en **Google Drive**.

## Funciones incluidas

- Inicio de sesión para administrador e investigadores.
- Creación, edición, activación y desactivación de usuarios.
- Contraseñas de acceso almacenadas como hash con sal individual; nunca se guardan en texto plano.
- Sesiones persistentes con token hash, vencimiento y cierre remoto al restablecer la contraseña.
- Acceso por rol: el administrador visualiza todo y cada investigador solo sus procesos.
- Directorio de investigadores y carpeta principal individual en Drive.
- Procesos con cliente, tema, contrato, producto, indexación, revista, prioridad, fechas, APC, estado, avance y observaciones.
- Creación automática de carpetas estandarizadas para cada proceso.
- Explorador de carpetas y archivos desde la aplicación.
- Crear, renombrar y eliminar carpetas según permisos.
- Subir, abrir, renombrar y eliminar documentos.
- Registro de versiones de archivos con el mismo nombre.
- Credenciales de revistas y plataformas asociadas a procesos.
- Credenciales cifradas con una clave maestra almacenada en Script Properties.
- Revelado de credenciales registrado en auditoría.
- Panel con procesos activos, próximos a vencer, atrasados, avance promedio y actividades recientes.
- Auditoría de accesos, cambios, archivos y credenciales.
- Diseño adaptable para computadora, tableta y teléfono.

## Arquitectura

```text
GitHub Pages
  └── HTML + CSS + JavaScript
          │ postMessage con origen validado
          ▼
Google Apps Script Web App
  ├── autenticación y permisos
  ├── reglas del sistema
  ├── Google Sheets: datos
  └── Google Drive: carpetas y archivos
```

GitHub Pages publica únicamente archivos estáticos. Por esa razón, toda operación sensible se ejecuta en Google Apps Script y el repositorio no contiene claves de Google ni contraseñas.

## Estructura del proyecto

```text
/
├── index.html
├── 404.html
├── .nojekyll
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── config.js
│       ├── api.js
│       └── app.js
├── backend/
│   ├── Code.gs
│   ├── Bridge.html
│   └── appsscript.json
└── docs/
    ├── GUIA_INSTALACION.md
    ├── ESTRUCTURA_SHEETS.md
    └── SEGURIDAD_Y_LIMITACIONES.md
```

## Instalación

Siga [docs/GUIA_INSTALACION.md](docs/GUIA_INSTALACION.md). La instalación requiere:

1. Una hoja de cálculo vacía.
2. Una carpeta principal de Google Drive.
3. Un proyecto de Google Apps Script.
4. Un repositorio de GitHub con Pages habilitado.

## Límite de archivos

La configuración inicial admite hasta **8 MB por archivo**. El límite puede reducirse o aumentarse en `SETTINGS.MAX_FILE_BYTES` y `APP_CONFIG.MAX_FILE_SIZE_MB`, considerando las cuotas y tiempos de ejecución de Google Apps Script.

## Recomendaciones de producción

- Use una cuenta corporativa propietaria de la hoja, la carpeta y el Apps Script.
- No comparta públicamente la hoja de cálculo ni la carpeta principal.
- Cambie inmediatamente la contraseña inicial del administrador.
- Mantenga el repositorio sin IDs privados adicionales ni copias de las hojas.
- Revise periódicamente la pestaña `Auditoria`.
- Para archivos grandes o una cantidad elevada de usuarios simultáneos, migre el backend a Cloud Run/Firebase y utilice la API de Drive con carga reanudable.
