export const OPENSHIFT_SERVER_URL_MAX_LENGTH = 2048;
export const OPENSHIFT_TEXT_MAX_LENGTH = 255;
export const OPENSHIFT_NAMESPACE_MAX_LENGTH = 63;

const OPENSHIFT_NAMESPACE = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

export function isValidOpenShiftServerUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > OPENSHIFT_SERVER_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password && !url.search && !url.hash
    );
  } catch {
    return false;
  }
}

export function isValidOpenShiftNamespace(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= OPENSHIFT_NAMESPACE_MAX_LENGTH && OPENSHIFT_NAMESPACE.test(trimmed);
}

export function isValidOpenShiftText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= OPENSHIFT_TEXT_MAX_LENGTH;
}
