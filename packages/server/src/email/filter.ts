import type { ParsedEmail } from './parser.js';
import type { Rule } from '../db/queries.js';
import { logger } from '../logger.js';

/**
 * Matches `value` against `pattern`. If the pattern is wrapped in slashes
 * (`/.../`) it is treated as a case-insensitive regex; otherwise it is a
 * case-insensitive substring ("contains") match. Invalid regexes never throw —
 * they fail closed (no match) and are logged.
 */
export function matchPattern(value: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
    try {
      const regex = new RegExp(trimmed.slice(1, -1), 'i');
      return regex.test(value);
    } catch (err) {
      logger.warn({ pattern, err: (err as Error).message }, 'invalid regex in rule filter');
      return false;
    }
  }
  return value.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Returns true if the email satisfies every non-empty filter on the rule
 * (AND semantics). A rule with no filters set matches every email.
 */
export function matchesRule(email: ParsedEmail, rule: Rule): boolean {
  if (rule.filter_from) {
    const from = email.from?.address ?? '';
    if (!matchPattern(from, rule.filter_from)) return false;
  }

  if (rule.filter_to) {
    const toAddresses = email.to.map((t) => t.address);
    if (!toAddresses.some((addr) => matchPattern(addr, rule.filter_to as string))) return false;
  }

  if (rule.filter_subject) {
    if (!matchPattern(email.subject, rule.filter_subject)) return false;
  }

  if (rule.filter_has_attachment !== null && rule.filter_has_attachment !== undefined) {
    const hasAttachment = email.attachments.length > 0;
    if (rule.filter_has_attachment && !hasAttachment) return false;
    if (!rule.filter_has_attachment && hasAttachment) return false;
  }

  return true;
}

/** Filters a list of rules down to those the email matches. */
export function matchingRules(email: ParsedEmail, rules: Rule[]): Rule[] {
  return rules.filter((rule) => matchesRule(email, rule));
}
