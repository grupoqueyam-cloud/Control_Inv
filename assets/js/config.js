window.APP_CONFIG = Object.freeze({
  APP_NAME: 'Control de Investigadores',
  ORGANIZATION: 'Centro de Investigación Sustainability',

  // Pegue aquí la URL terminada en /exec de la implementación de Google Apps Script.
  BRIDGE_URL: 'https://script.google.com/macros/s/AKfycbwpwqMmcXXqhl9q6LLnhvg8Amb-nA2e29OOaTRn6ImKgxGhbTymElS8tsOpW4eJZQ8F/exec',

  // Debe coincidir con el origen autorizado configurado en Code.gs.
  // Ejemplo: https://suusuario.github.io
  GITHUB_ORIGIN: window.location.origin,

  MAX_FILE_SIZE_MB: 8,
  REQUEST_TIMEOUT_MS: 120000,
  SESSION_STORAGE_KEY: 'research_control_session_v1',
  UI_VERSION: '1.3.0'
});
