export const JENKINS_JOB_URL_MAX_LENGTH = 2048;

function parseHttpsJenkinsUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > JENKINS_JOB_URL_MAX_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Configured job URL: HTTPS, no embedded credentials, no query/hash. */
export function isValidJenkinsJobUrl(value: string): boolean {
  const url = parseHttpsJenkinsUrl(value);
  return !!url && !url.search && !url.hash;
}

/** Request URL: HTTPS, no embedded credentials. Query allowed for tree APIs. */
export function isSafeJenkinsRequestUrl(value: string): boolean {
  return parseHttpsJenkinsUrl(value) !== null;
}
