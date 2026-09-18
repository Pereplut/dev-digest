/**
 * Strip credentials out of any URL embedded in free text.
 *
 * Why this exists: `repos/service.ts` embeds a GitHub PAT in the clone URL so
 * private clones authenticate non-interactively. git echoes the full remote —
 * credentials included — in its failure stderr, and simple-git builds its Error
 * message from that output verbatim. Anything that persists or logs such a
 * message would otherwise write the PAT in cleartext, with no attacker
 * involved: a typo'd URL, a private repo or an expired token is enough.
 *
 * Redact at the chokepoint (where the message is stored/logged) rather than at
 * each call site, so a new error path cannot silently reintroduce the leak.
 */

/** `scheme://user:secret@host` — the credential segment is group 2. */
const URL_CREDENTIALS = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+@/g;

/** Replace `https://x-access-token:ghp_…@github.com/…` with `https://***@github.com/…`. */
export function redactCredentials(text: string): string {
  return text.replace(URL_CREDENTIALS, (_match, scheme: string) => `${scheme}***@`);
}
