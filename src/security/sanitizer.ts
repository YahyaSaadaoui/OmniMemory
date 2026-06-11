interface RedactionRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

export interface RedactionFinding {
  label: string;
  replacement: string;
  count: number;
}

export interface SanitizationReport {
  text: string;
  findings: RedactionFinding[];
  redactionCount: number;
}

const redactionRules: RedactionRule[] = [
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_ACCESS_KEY]'
  },
  {
    label: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]'
  },
  {
    label: 'API key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]'
  },
  {
    label: 'Slack token',
    pattern: /\b(?:xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]'
  },
  {
    label: 'Secret assignment',
    pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi,
    replacement: '[REDACTED_SECRET_ASSIGNMENT]'
  },
  {
    label: 'Private key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
  {
    label: 'High entropy value',
    pattern: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
    replacement: '[REDACTED_HIGH_ENTROPY_VALUE]'
  }
];

export function sanitizeEngineeringText(value: string): string {
  return sanitizeEngineeringTextWithReport(value).text;
}

export function sanitizeEngineeringTextWithReport(value: string): SanitizationReport {
  const findings: RedactionFinding[] = [];
  let text = value;

  for (const rule of redactionRules) {
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });

    if (count > 0) {
      findings.push({
        label: rule.label,
        replacement: rule.replacement,
        count
      });
    }
  }

  return {
    text,
    findings,
    redactionCount: findings.reduce((sum, finding) => sum + finding.count, 0)
  };
}
