/**
 * Path names as text, the way POSIX and Windows read them, without the runtime's path module: core runs where there
 * is none. Only what core needs: normalizing a relative path, its folder, and whether a path is rooted on Windows.
 */

/** The Windows root a path starts with (`C:\`, `C:`, `\\server\share\`, `\`, `/`), or "" for a relative path. */
export function windowsRoot(path: string): string {
  const unc = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]?/.exec(path);
  if (unc) return unc[0];
  const drive = /^[a-zA-Z]:[\\/]?/.exec(path);
  if (drive) return drive[0];
  return /^[\\/]/.test(path) ? path[0] : "";
}

/** POSIX `normalize`: `.` segments and repeated slashes go, `..` takes its parent with it, a trailing slash stays. */
export function posixNormalize(path: string): string {
  if (path === "") return ".";
  const absolute = path.startsWith("/");
  const trailing = path.endsWith("/");
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  let result = out.join("/");
  if (absolute) result = `/${result}`;
  if (result === "") return absolute ? "/" : ".";
  return trailing && !result.endsWith("/") ? `${result}/` : result;
}

/** POSIX `dirname`: the path without its last segment; `.` for a bare name, `/` for a file at the root. */
export function posixDirname(path: string): string {
  if (path === "") return ".";
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end--;
  const slash = path.lastIndexOf("/", end - 1);
  if (slash === -1) return ".";
  if (slash === 0) return "/";
  // POSIX leaves a root of exactly two slashes as it is.
  if (slash === 1 && path.startsWith("/")) return "//";
  return path.slice(0, slash);
}
