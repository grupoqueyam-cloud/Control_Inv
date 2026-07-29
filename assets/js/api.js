(function () {
  'use strict';

  const config = window.APP_CONFIG;
  let initialized = false;
  let initPromise = null;

  function randomId_() {
    try {
      const values = new Uint32Array(6);
      window.crypto.getRandomValues(values);
      return Array.from(values, value => value.toString(36)).join('');
    } catch (error) {
      return (
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2)
      );
    }
  }

  function configured() {
    return Boolean(
      config &&
      config.BRIDGE_URL &&
      !config.BRIDGE_URL.includes('PEGAR_AQUI') &&
      /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(
        config.BRIDGE_URL
      )
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

  function wait_(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function buildUrl_(parameters) {
    const url = new URL(config.BRIDGE_URL);

    Object.keys(parameters).forEach(key => {
      const value = parameters[key];
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    url.searchParams.set('_', String(Date.now()));
    return url.href;
  }

  function jsonp_(parameters, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName =
        '__controlInvJsonp_' +
        Date.now().toString(36) +
        '_' +
        randomId_().replace(/[^a-zA-Z0-9_]/g, '');

      const script = document.createElement('script');
      let completed = false;

      function cleanup() {
        if (completed) return;
        completed = true;
        window.clearTimeout(timeout);
        if (script.parentNode) script.parentNode.removeChild(script);

        try {
          delete window[callbackName];
        } catch (error) {
          window[callbackName] = undefined;
        }
      }

      window[callbackName] = function (payload) {
        cleanup();
        resolve(payload);
      };

      const timeout = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            'Apps Script no respondió al sondeo JSONP. Verifique que doGet(e) delegue en handleBridgeGet(e) y que la implementación publicada sea la versión 1.5.0.'
          )
        );
      }, timeoutMs || 15000);

      script.async = true;
      script.src = buildUrl_(
        Object.assign({}, parameters, {
          callback: callbackName
        })
      );

      script.onerror = function () {
        cleanup();
        reject(
          new Error(
            'No se pudo cargar la respuesta JSONP desde Google Apps Script.'
          )
        );
      };

      document.head.appendChild(script);
    });
  }

  function submitPost_(request, origin, pollToken) {
    const frameName =
      'gas_post_' +
      request.requestId.replace(/[^a-zA-Z0-9_]/g, '_');

    const iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.id = frameName;
    iframe.title = 'Envío a Google Apps Script';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = config.BRIDGE_URL;
    form.target = frameName;
    form.enctype = 'application/x-www-form-urlencoded';
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const fields = {
      request: JSON.stringify(request),
      origin: origin,
      bridgeChannel: request.channel,
      requestId: request.requestId,
      pollToken: pollToken
    };

    Object.keys(fields).forEach(name => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = fields[name];
      form.appendChild(input);
    });

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    try {
      form.submit();
    } finally {
      window.setTimeout(() => {
        if (form.parentNode) form.parentNode.removeChild(form);
      }, 0);

      // El iframe solo transporta el POST; la respuesta se recupera por JSONP.
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 30000);
    }
  }

  async function retrieveResponse_(
    requestId,
    bridgeChannel,
    pollToken,
    deadline
  ) {
    let metadata = null;

    while (Date.now() < deadline) {
      const response = await jsonp_(
        {
          mode: 'poll',
          stage: 'meta',
          origin: window.location.origin,
          requestId: requestId,
          bridgeChannel: bridgeChannel,
          pollToken: pollToken
        },
        15000
      );

      if (response && response.status === 'ready') {
        metadata = response;
        break;
      }

      if (response && response.status === 'error') {
        throw normalizeError(response.error);
      }

      await wait_(500);
    }

    if (!metadata) {
      throw new Error(
        'Apps Script procesó la solicitud, pero el resultado no quedó disponible antes de vencer el tiempo de espera.'
      );
    }

    const chunks = [];

    for (let index = 0; index < Number(metadata.totalChunks || 0); index++) {
      const chunkResponse = await jsonp_(
        {
          mode: 'poll',
          stage: 'chunk',
          chunk: index,
          origin: window.location.origin,
          requestId: requestId,
          bridgeChannel: bridgeChannel,
          pollToken: pollToken
        },
        15000
      );

      if (!chunkResponse || chunkResponse.status !== 'chunk') {
        throw new Error(
          'La respuesta de Apps Script está incompleta. Falta el bloque ' +
            (index + 1) +
            ' de ' +
            metadata.totalChunks +
            '.'
        );
      }

      chunks.push(String(chunkResponse.data || ''));
    }

    let message;

    try {
      message = JSON.parse(chunks.join(''));
    } catch (error) {
      throw new Error(
        'Apps Script devolvió una respuesta que no pudo interpretarse.'
      );
    }

    if (
      message.requestId !== requestId ||
      message.channel !== bridgeChannel
    ) {
      throw new Error(
        'La respuesta recibida no corresponde con la solicitud actual.'
      );
    }

    if (message.ok) return message.result;
    throw normalizeError(message.error);
  }

  async function submitRequest(action, payload, token) {
    if (!configured()) {
      throw new Error(
        'La URL /exec no está configurada correctamente en assets/js/config.js.'
      );
    }

    const requestId = Date.now() + '_' + randomId_();
    const bridgeChannel = randomId_() + randomId_();
    const pollToken = randomId_() + randomId_();

    const request = {
      action: action,
      payload: payload || {},
      token: token || '',
      requestId: requestId,
      channel: bridgeChannel,
      clientVersion: '1.5.0'
    };

    submitPost_(request, window.location.origin, pollToken);

    return retrieveResponse_(
      requestId,
      bridgeChannel,
      pollToken,
      Date.now() + (Number(config.REQUEST_TIMEOUT_MS) || 120000)
    );
  }

  function init() {
    if (initialized) return Promise.resolve(true);
    if (initPromise) return initPromise;

    initPromise = submitRequest(
      '__ping__',
      {
        origin: window.location.origin,
        uiVersion: config.UI_VERSION || '1.5.0'
      },
      ''
    )
      .then(result => {
        if (!result || result.connected !== true) {
          throw new Error(
            'Apps Script respondió, pero no confirmó la conexión.'
          );
        }

        initialized = true;
        return true;
      })
      .catch(error => {
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
