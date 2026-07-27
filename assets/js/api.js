(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const pending = new Map();
  let bridgeReady = false;
  let bridgeOrigin = null;
  let bridgePort = null;
  let channel = '';
  let iframe = null;
  let readyPromise = null;

  function configured() {
    return Boolean(
      config &&
      config.BRIDGE_URL &&
      !config.BRIDGE_URL.includes('PEGAR_AQUI') &&
      /^https:\/\//i.test(config.BRIDGE_URL)
    );
  }

  function init() {
    if (bridgeReady && bridgePort) return Promise.resolve(true);
    if (readyPromise) return readyPromise;

    readyPromise = new Promise((resolve, reject) => {
      if (!configured()) {
        reject(new Error('Debe configurar BRIDGE_URL en assets/js/config.js.'));
        return;
      }

      const frontendOrigin = config.GITHUB_ORIGIN || window.location.origin;

      try {
        bridgeOrigin = new URL(config.BRIDGE_URL).origin;
        channel = `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      } catch (error) {
        reject(new Error('La URL de Apps Script no es válida.'));
        return;
      }

      iframe = document.getElementById('apps-script-bridge');
      if (iframe) iframe.remove();

      iframe = document.createElement('iframe');
      iframe.id = 'apps-script-bridge';
      const separator = config.BRIDGE_URL.includes('?') ? '&' : '?';
      iframe.src = `${config.BRIDGE_URL}${separator}channel=${encodeURIComponent(channel)}&origin=${encodeURIComponent(frontendOrigin)}`;
      iframe.title = 'Puente seguro de Google Apps Script';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.border = '0';
      iframe.style.left = '-9999px';

      const timeout = window.setTimeout(() => {
        cleanupWindowListener();
        readyPromise = null;
        reject(new Error('Google Apps Script no respondió. Verifique que Bridge.html y doGet() sean la versión 1.1.1 y publique una nueva versión.'));
      }, 25000);

      function cleanupWindowListener() {
        window.removeEventListener('message', handleWindowMessage);
      }

      function fail(message) {
        window.clearTimeout(timeout);
        cleanupWindowListener();
        readyPromise = null;
        reject(new Error(message));
      }

      function handleWindowMessage(event) {
        const data = event.data;
        if (!data || typeof data !== 'object' || data.channel !== channel) return;
        if (!isTrustedBridgeOrigin(event.origin)) return;

        if (data.type === 'bridge-error') {
          fail(data.message || 'Google Apps Script rechazó la conexión.');
          return;
        }

        if (data.type !== 'bridge-ready') return;
        if (!event.ports || !event.ports[0]) {
          fail('Apps Script respondió, pero no entregó el canal de comunicación. Actualice Bridge.html con el hotfix.');
          return;
        }

        bridgePort = event.ports[0];
        bridgePort.onmessage = handlePortMessage;
        bridgePort.onmessageerror = function () {
          rejectAllPending(new Error('Se perdió el canal de comunicación con Google Apps Script.'));
        };
        if (typeof bridgePort.start === 'function') bridgePort.start();

        bridgeReady = true;
        window.clearTimeout(timeout);
        cleanupWindowListener();
        resolve(true);
      }

      window.addEventListener('message', handleWindowMessage);
      document.body.appendChild(iframe);
    });

    return readyPromise;
  }

  function handlePortMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'bridge-response' || data.channel !== channel) return;

    const item = pending.get(data.requestId);
    if (!item) return;

    window.clearTimeout(item.timeout);
    pending.delete(data.requestId);

    if (data.ok) item.resolve(data.result);
    else item.reject(normalizeError(data.error));
  }

  function rejectAllPending(error) {
    pending.forEach((item) => {
      window.clearTimeout(item.timeout);
      item.reject(error);
    });
    pending.clear();
    bridgeReady = false;
    bridgePort = null;
    readyPromise = null;
  }

  function isTrustedBridgeOrigin(origin) {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && (
        url.origin === bridgeOrigin ||
        url.hostname === 'script.google.com' ||
        url.hostname === 'script.googleusercontent.com' ||
        url.hostname.endsWith('.script.googleusercontent.com')
      );
    } catch (error) {
      return false;
    }
  }

  function normalizeError(error) {
    if (error instanceof Error) return error;
    const message = typeof error === 'string' ? error : (error && error.message) || 'Error inesperado del servidor.';
    const normalized = new Error(message);
    if (error && error.code) normalized.code = error.code;
    return normalized;
  }

  async function call(action, payload = {}, token = null) {
    await init();
    if (!bridgePort || !bridgeReady) throw new Error('El puente con Google Apps Script no está disponible.');

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`La operación “${action}” excedió el tiempo permitido.`));
      }, config.REQUEST_TIMEOUT_MS);

      pending.set(requestId, { resolve, reject, timeout });

      try {
        bridgePort.postMessage({
          type: 'bridge-request',
          requestId,
          action,
          payload,
          token,
          channel
        });
      } catch (error) {
        window.clearTimeout(timeout);
        pending.delete(requestId);
        reject(normalizeError(error));
      }
    });
  }

  window.BackendAPI = {
    configured,
    init,
    call
  };
})();
