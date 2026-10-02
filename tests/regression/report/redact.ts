/** Pure secret masking for anything that ends up in results.json / report.json / report.html (R22). */

export const MASK = "[REDACTED]";
/** Env vars whose literal VALUES are masked wherever they appear. */
export const SECRET_ENV_KEYS = [
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "TEST_SA_PASSWORD",
  "TEST_SA_USERNAME",
  "TEST_ADMIN_PASSWORD",
  "RGR_RUN_PASSWORD",
] as const;

/** Values of the secret env vars that are set and long enough to mask without wrecking normal text. */
export function secretsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return SECRET_ENV_KEYS.map((k) => env[k]).filter((v): v is string => typeof v === "string" && v.length >= 6);
}

const HEADER_NAMES = "cookie|set-cookie|authorization|proxy-authorization|x-vercel-protection-bypass|x-vercel-set-bypass-cookie";

export function redact(text: string, secrets: string[] = []): string {
  let s = text;
  // 1. literal secret values (longest first so a prefix secret cannot leave a tail behind)
  for (const v of [...new Set(secrets.filter((x) => x.length >= 6))].sort((a, b) => b.length - a.length)) s = s.split(v).join(MASK);
  // 2. whole header lines: `Cookie: a=b; c=d`
  s = s.replace(new RegExp(`^([ \\t]*(?:${HEADER_NAMES})[ \\t]*[:=][ \\t]*).*$`, "gim"), `$1${MASK}`);
  // 3. quoted header/JSON-ish forms: 'cookie': '...' / "authorization": "..."
  s = s.replace(new RegExp(`((["'])(?:${HEADER_NAMES})\\2\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\3).)*\\3`, "gi"), `$1"${MASK}"`);
  // 4. session cookies / SA token by name
  s = s.replace(/((?:__Secure-)?qs\.session_token|qs-sa-token)=[^;\s"',]+/g, `$1=${MASK}`);
  // 5. JSON password fields (also the backslash-escaped form seen in stringified bodies)
  s = s.replace(/("(?:password|newPassword|adminPassword)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, `$1"${MASK}"`);
  s = s.replace(/(\\"(?:password|newPassword|adminPassword)\\"\s*:\s*)\\".*?\\"/gi, `$1\\"${MASK}\\"`);
  // 6. password=... pairs, token=... patterns
  s = s.replace(/\b((?:new|admin)?password)=[^&\s"']+/gi, `$1=${MASK}`);
  s = s.replace(/\b([A-Za-z_]*token)=[^&\s;"']+/gi, `$1=${MASK}`);
  // 7. bearer tokens
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${MASK}`);
  return s;
}
