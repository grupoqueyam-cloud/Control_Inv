/**
 * TRANSPORTE PARA GITHUB PAGES — VERSIÓN 1.3.0
 *
 * IMPORTANTE:
 * - Elimine la función doGet(e) antigua de Code.gs.
 * - Pegue TODO este archivo al final de Code.gs.
 * - Cree BridgeResponse.html en Google Apps Script.
 * - Publique una NUEVA VERSIÓN de la implementación.
 */

function doGet(e) {
  const receivedOrigin = normalizeBridgeOrigin_(
    e && e.parameter ? e.parameter.origin : ''
  );
  const originAllowed = isAllowedBridgeOrigin_(receivedOrigin);

  const diagnostics = {
    app_name: SETTINGS.APP_NAME,
    backend_version: '1.3.0',
    transport: 'HTML form POST + postMessage',
    active: true,
    origin_received: receivedOrigin,
    origin_allowed: originAllowed,
    spreadsheet_configured:
      Boolean(SETTINGS.SPREADSHEET_ID) &&
      String(SETTINGS.SPREADSHEET_ID).indexOf('PEGAR_') === -1,
    drive_configured:
      Boolean(SETTINGS.ROOT_FOLDER_ID) &&
      String(SETTINGS.ROOT_FOLDER_ID).indexOf('PEGAR_') === -1
  };

  return HtmlService
    .createHtmlOutput(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Backend activo</title></head>' +
      '<body style="font-family:Arial,sans-serif;padding:24px;line-height:1.5">' +
      '<h2>Backend activo</h2>' +
      '<pre style="white-space:pre-wrap;background:#f3f4f6;padding:16px;border-radius:8px">' +
      escapeBridgeHtml_(JSON.stringify(diagnostics, null, 2)) +
      '</pre></body></html>'
    )
    .setTitle(SETTINGS.APP_NAME + ' - Backend 1.3.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const receivedOrigin = normalizeBridgeOrigin_(
    e && e.parameter ? e.parameter.origin : ''
  );
  const targetOrigin = isAllowedBridgeOrigin_(receivedOrigin)
    ? receivedOrigin
    : '*';

  let requestId = e && e.parameter && e.parameter.requestId
    ? String(e.parameter.requestId)
    : '';
  let bridgeChannel = e && e.parameter && e.parameter.bridgeChannel
    ? String(e.parameter.bridgeChannel)
    : '';
  let envelope;

  try {
    if (!isAllowedBridgeOrigin_(receivedOrigin)) {
      throwBridgeError_(
        'ORIGIN_NOT_ALLOWED',
        'El origen recibido no está autorizado: ' +
        (receivedOrigin || '(vacío)') +
        '. Revise SETTINGS.ALLOWED_ORIGINS.'
      );
    }

    validateSettings_();

    const rawRequest = e && e.parameter && e.parameter.request
      ? String(e.parameter.request)
      : '';

    if (!rawRequest) {
      throwBridgeError_(
        'BAD_REQUEST',
        'La solicitud POST no contiene el campo request.'
      );
    }

    const request = JSON.parse(rawRequest);
    requestId = requestId || String(request.requestId || '');
    bridgeChannel = bridgeChannel || String(request.channel || '');

    if (!requestId || !bridgeChannel) {
      throwBridgeError_(
        'BAD_REQUEST',
        'La solicitud no contiene requestId o bridgeChannel.'
      );
    }

    if (String(request.action || '') === '__ping__') {
      // Confirma también que Apps Script puede abrir los recursos configurados.
      SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID).getId();
      DriveApp.getFolderById(SETTINGS.ROOT_FOLDER_ID).getId();

      envelope = {
        ok: true,
        result: {
          connected: true,
          backendVersion: '1.3.0',
          appName: SETTINGS.APP_NAME,
          timestamp: new Date().toISOString()
        }
      };
    } else {
      envelope = bridgeCall({
        action: String(request.action || ''),
        payload: request.payload || {},
        token: request.token || ''
      });
    }
  } catch (error) {
    envelope = {
      ok: false,
      error: {
        code: error && error.code
          ? error.code
          : 'POST_BRIDGE_ERROR',
        message: error && error.message
          ? error.message
          : 'No se pudo procesar la solicitud enviada a Apps Script.'
      }
    };
  }

  const template = HtmlService.createTemplateFromFile('BridgeResponse');
  template.targetOrigin = targetOrigin;
  template.bridgeChannel = bridgeChannel;
  template.requestId = requestId;
  template.envelope = envelope;

  return template.evaluate()
    .setTitle(SETTINGS.APP_NAME + ' - Respuesta 1.3.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function normalizeBridgeOrigin_(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function isAllowedBridgeOrigin_(origin) {
  if (!origin) return false;

  return SETTINGS.ALLOWED_ORIGINS.some(function (allowedOrigin) {
    return normalizeBridgeOrigin_(allowedOrigin) === origin;
  });
}

function throwBridgeError_(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function escapeBridgeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
