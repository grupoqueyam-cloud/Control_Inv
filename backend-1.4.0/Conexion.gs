/**
 * CONEXIÓN GITHUB PAGES -> GOOGLE APPS SCRIPT
 * Versión 1.4.0
 *
 * Reemplace completamente el contenido actual de Conexion.gs por este archivo.
 */

function doPost(e) {
  const receivedOrigin = normalizeBridgeOrigin_(
    e && e.parameter ? e.parameter.origin : ''
  );

  let requestId = e && e.parameter && e.parameter.requestId
    ? String(e.parameter.requestId)
    : '';

  let bridgeChannel = e && e.parameter && e.parameter.bridgeChannel
    ? String(e.parameter.bridgeChannel)
    : '';

  let callbackUrl = e && e.parameter && e.parameter.callbackUrl
    ? String(e.parameter.callbackUrl)
    : '';

  let envelope;

  try {
    if (!isAllowedBridgeOrigin_(receivedOrigin)) {
      throwBridgeTransportError_(
        'ORIGIN_NOT_ALLOWED',
        'El origen recibido no está autorizado: ' +
          (receivedOrigin || '(vacío)') +
          '. Revise SETTINGS.ALLOWED_ORIGINS.'
      );
    }

    callbackUrl = validateBridgeCallbackUrl_(callbackUrl, receivedOrigin);
    validateSettings_();

    const rawRequest = e && e.parameter && e.parameter.request
      ? String(e.parameter.request)
      : '';

    if (!rawRequest) {
      throwBridgeTransportError_(
        'BAD_REQUEST',
        'La solicitud POST no contiene el campo request.'
      );
    }

    const request = JSON.parse(rawRequest);

    requestId = requestId || String(request.requestId || '');
    bridgeChannel = bridgeChannel || String(request.channel || '');

    if (!requestId || !bridgeChannel) {
      throwBridgeTransportError_(
        'BAD_REQUEST',
        'La solicitud no contiene requestId o bridgeChannel.'
      );
    }

    if (String(request.action || '') === '__ping__') {
      SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID).getId();
      DriveApp.getFolderById(SETTINGS.ROOT_FOLDER_ID).getId();

      envelope = {
        ok: true,
        result: {
          connected: true,
          backendVersion: '1.4.0',
          appName: SETTINGS.APP_NAME,
          origin: receivedOrigin,
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

    // Si la URL de retorno era inválida, usar una dirección segura del
    // primer origen configurado para que el error pueda visualizarse.
    if (!callbackUrl || callbackUrl.indexOf('https://') !== 0) {
      callbackUrl = normalizeBridgeOrigin_(SETTINGS.ALLOWED_ORIGINS[0]) +
        '/Control_Inv/bridge-callback.html';
    }
  }

  const template = HtmlService.createTemplateFromFile('BridgeResponse');
  template.callbackUrl = callbackUrl;
  template.bridgeChannel = bridgeChannel;
  template.requestId = requestId;
  template.envelope = envelope;

  return template.evaluate()
    .setTitle(SETTINGS.APP_NAME + ' - Respuesta 1.4.0')
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

function validateBridgeCallbackUrl_(value, allowedOrigin) {
  const callbackUrl = String(value || '').trim();
  const normalizedOrigin = normalizeBridgeOrigin_(allowedOrigin);

  if (!callbackUrl || callbackUrl.indexOf(normalizedOrigin + '/') !== 0) {
    throwBridgeTransportError_(
      'INVALID_CALLBACK',
      'La URL de retorno no pertenece al origen autorizado.'
    );
  }

  if (callbackUrl.indexOf('#') >= 0) {
    throwBridgeTransportError_(
      'INVALID_CALLBACK',
      'La URL de retorno no puede contener fragmentos.'
    );
  }

  return callbackUrl;
}

function throwBridgeTransportError_(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function testBackendConnection() {
  validateSettings_();

  const spreadsheet = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const rootFolder = DriveApp.getFolderById(SETTINGS.ROOT_FOLDER_ID);

  const template = HtmlService.createTemplateFromFile('BridgeResponse');
  template.callbackUrl =
    normalizeBridgeOrigin_(SETTINGS.ALLOWED_ORIGINS[0]) +
    '/Control_Inv/bridge-callback.html';
  template.bridgeChannel = 'test-channel';
  template.requestId = 'test-request';
  template.envelope = {
    ok: true,
    result: {
      connected: true,
      backendVersion: '1.4.0'
    }
  };
  template.evaluate();

  const result = {
    success: true,
    backendVersion: '1.4.0',
    spreadsheetName: spreadsheet.getName(),
    rootFolderName: rootFolder.getName(),
    allowedOrigin: SETTINGS.ALLOWED_ORIGINS[0],
    bridgeResponseCompiled: true
  };

  console.log(JSON.stringify(result, null, 2));
  return JSON.stringify(result, null, 2);
}
