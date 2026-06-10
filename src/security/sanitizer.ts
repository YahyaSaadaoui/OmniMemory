interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const redactionRules: RedactionRule[] = [
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_ACCESS_KEY]'
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]'
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]'
  },
  {
    pattern: /\b(?:xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]'
  },
  {
    pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi,
    replacement: '[REDACTED_SECRET_ASSIGNMENT]'
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
  {
    pattern: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
    replacement: '[REDACTED_HIGH_ENTROPY_VALUE]'
  }
];

export function sanitizeEngineeringText(value: string): string {
  return redactionRules.reduce(
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    value
  );
}
