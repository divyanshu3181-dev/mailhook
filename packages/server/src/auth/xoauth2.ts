/**
 * Builds the XOAUTH2 SASL initial-client-response string.
 *
 * Note: imapflow accepts `{ user, accessToken }` in its auth options and
 * constructs XOAUTH2 internally, so most call sites never need this. It is
 * provided for completeness / non-imapflow IMAP paths and testing.
 */
export function buildXOAuth2Token(user: string, accessToken: string): string {
  const authString = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(authString, 'utf8').toString('base64');
}
