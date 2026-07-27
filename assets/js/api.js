(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const pending = new Map();
  let bridgeReady = false;
  let bridgeOrigin = null;
  let channel = '';
  let iframe = null;
  let readyPromise = null;

  function configured() {
    return Boolean(
      config.BRIDGE_URL &&
      !config.BRIDGE_URL.includes('PEGAR_AQUI') &&
      /^https:\/\//i.test(config.BRIDGE_URL)
    );
  }

  function init() {
    if (readyPromise) return readyPromise;

    readyPromise = new Promise((resolve, reject) => {
      if (!configured()) {
        reject(new Error('Debe configurar BRIDGE_URL en assets/js/config.js.'));
        return;
      }

      try {
        bridgeOrigin = new URL(config.BRIDGE_URL).origin;
        channel = `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      } catch (error) {
        reject(new Error('La URL de Apps Script no es válida.'));
        return;
      }

      iframe = document.createElement('iframe');
      iframe.id = 'apps-script-bridge';
      const separator = config.BRIDGE_URL.includes('?') ? '&' : '?';
      iframe.src = `${config.BRIDGE_URL}${separator}channel=${encodeURIComponent(channel)}`;
      iframe.title = 'Puente seguro de Google Apps Script';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.border = '0';
      iframe.style.left = '-9999px';
      document.body.appendChild(iframe);

      const timeout = window.setTimeout(() => {
        if (!bridgeReady) reject(new Error('No se pudo conectar con Google Apps Script. Revise la implementación y los orígenes permitidos.'));
      }, 20000);

      function onReady() {
        window.clearTimeout(timeout);
        resolve(true);
      }

      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow || !isTrustedBridgeOrigin(event.origin) || !event.data || typeof event.data !== 'object' || event.data.channel !== channel) return;

        if (event.data.type === 'bridge-ready') {
          bridgeReady = true;
          onReady();
          return;
        }

        if (event.data.type !== 'bridge-response') return;
        const item = pending.get(event.data.requestId);
        if (!item) return;

        window.clearTimeout(item.timeout);
        pending.delete(event.data.requestId);

        if (event.data.ok) item.resolve(event.data.result);
        else item.reject(normalizeError(event.data.error));
      });
    });

    return readyPromise;
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
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`La operación “${action}” excedió el tiempo permitido.`));
      }, config.REQUEST_TIMEOUT_MS);

      pending.set(requestId, { resolve, reject, timeout });
      iframe.contentWindow.postMessage({
        type: 'bridge-request',
        requestId,
        action,
        payload,
        token,
        channel
      }, '*');
    });
  }

  window.BackendAPI = {
    configured,
    init,
    call
  };
})();
