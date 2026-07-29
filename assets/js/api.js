(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const pending = new Map();
  const channel = `${Date.now()}_${randomId_()}_${randomId_()}`;
  let initialized = false;
  let initPromise = null;

  function randomId_() {
    try {
      const values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      return Array.from(values, value => value.toString(36)).join('');
    } catch (error) {
      return Math.random().toString(36).slice(2);
    }
  }

  function configured() {
    return Boolean(
      config &&
      config.BRIDGE_URL &&
      !config.BRIDGE_URL.includes('PEGAR_AQUI') &&
      /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(config.BRIDGE_URL)
    );
  }

  function normalizeError(error) {
    if (error instanceof Error) return error;

    const normalized = new Error(
      typeof error === 'string'
        ? error
        : (error && error.message) || 'Error inesperado del servidor.'
    );

    if (error && error.code) normalized.code = error.code;
    return normalized;
  }

  function cleanupRequest(requestId) {
    const item = pending.get(requestId);
    if (!item) return;

    window.clearTimeout(item.timeout);

    if (item.iframe && item.iframe.parentNode) {
      item.iframe.parentNode.removeChild(item.iframe);
    }

    pending.delete(requestId);
  }

  function handleWindowMessage(event) {
    // La respuesta final llega desde bridge-callback.html, alojado en el
    // mismo origen que la aplicación de GitHub Pages.
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'bridge-response-v4') return;
    if (data.channel !== channel || !data.requestId) return;

    const item = pending.get(data.requestId);
    if (!item) return;

    cleanupRequest(data.requestId);

    if (data.ok) {
      item.resolve(data.result);
    } else {
      item.reject(normalizeError(data.error));
    }
  }

  window.addEventListener('message', handleWindowMessage);

  function submitRequest(action, payload, token) {
    if (!configured()) {
      return Promise.reject(
        new Error('La URL /exec no está configurada correctamente en assets/js/config.js.')
      );
    }

    const requestId = `${Date.now()}_${randomId_()}`;
    const frameName = `gas_response_${requestId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const callbackUrl = new URL('./bridge-callback.html', document.baseURI).href;

    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.name = frameName;
      iframe.id = frameName;
      iframe.title = 'Respuesta de Google Apps Script';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.border = '0';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';

      const timeout = window.setTimeout(() => {
        cleanupRequest(requestId);
        reject(new Error(
          'Apps Script recibió la solicitud, pero no pudo regresar la respuesta a GitHub Pages. Verifique que bridge-callback.html esté publicado y que Conexion.gs/BridgeResponse.html sean la versión 1.4.0.'
        ));
      }, Number(config.REQUEST_TIMEOUT_MS) || 60000);

      pending.set(requestId, { resolve, reject, timeout, iframe });
      document.body.appendChild(iframe);

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = config.BRIDGE_URL;
      form.target = frameName;
      form.enctype = 'application/x-www-form-urlencoded';
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';

      const request = {
        action: action,
        payload: payload || {},
        token: token || '',
        requestId: requestId,
        channel: channel,
        clientVersion: '1.4.0'
      };

      const fields = {
        request: JSON.stringify(request),
        origin: window.location.origin,
        bridgeChannel: channel,
        requestId: requestId,
        callbackUrl: callbackUrl
      };

      Object.keys(fields).forEach((name) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = fields[name];
        form.appendChild(input);
      });

      document.body.appendChild(form);

      try {
        form.submit();
      } catch (error) {
        cleanupRequest(requestId);
        reject(normalizeError(error));
      } finally {
        window.setTimeout(() => {
          if (form.parentNode) form.parentNode.removeChild(form);
        }, 0);
      }
    });
  }

  function init() {
    if (initialized) return Promise.resolve(true);
    if (initPromise) return initPromise;

    initPromise = submitRequest('__ping__', {
      origin: window.location.origin,
      uiVersion: config.UI_VERSION || '1.4.0'
    }, '')
      .then((result) => {
        if (!result || result.connected !== true) {
          throw new Error('Apps Script respondió, pero no confirmó la conexión.');
        }

        initialized = true;
        return true;
      })
      .catch((error) => {
        initPromise = null;
        throw error;
      });

    return initPromise;
  }

  async function call(action, payload = {}, token = null) {
    if (action !== '__ping__') await init();
    return submitRequest(action, payload, token);
  }

  window.BackendAPI = {
    configured,
    init,
    call
  };
})();
