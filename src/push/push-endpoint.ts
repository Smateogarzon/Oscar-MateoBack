// Los servicios de push de los navegadores conocidos. El servidor solo llama a estas direcciones: si
// dejara entregar cualquier URL, quien registra un dispositivo podría hacer que el servidor llame a
// direcciones internas (SSRF). Un host que termine en "." (p. ej. ".notify.windows.com") vale para
// cualquier subdominio.
const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari (iOS 16.4+ con la app instalada, y macOS)
  '.notify.windows.com', // Edge en Windows
];

export const MAX_PUSH_ENDPOINT_LENGTH = 1024;

/** Si la dirección de push es de un servicio conocido y va por https. */
export function isAllowedPushEndpoint(raw: string): boolean {
  if (raw.length > MAX_PUSH_ENDPOINT_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;

  return ALLOWED_PUSH_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}
