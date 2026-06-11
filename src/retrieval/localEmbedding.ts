export const localEmbeddingDimensions = 128;

export interface EmbeddingTextSource {
  title: string;
  problem: string;
  symptoms: string;
  rootCause: string;
  attempts: string;
  solution: string;
  filesChanged: string[];
  lessons: string;
  tags: string[];
}

const embeddingStopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'why',
  'are',
  'was',
  'were',
  'does',
  'did',
  'how',
  'what',
  'when',
  'then',
  'than',
  'have',
  'has',
  'had'
]);

export function buildMemoryEmbeddingText(source: EmbeddingTextSource): string {
  return [
    source.title,
    source.problem,
    source.symptoms,
    source.rootCause,
    source.attempts,
    source.solution,
    source.lessons,
    source.filesChanged.join(' '),
    source.tags.join(' ')
  ].filter(Boolean).join('\n');
}

export function createLocalEmbedding(text: string, dimensions = localEmbeddingDimensions): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeEmbeddingText(text);

  for (const token of tokens) {
    addWeightedToken(vector, token, tokenWeight(token));
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    addWeightedToken(vector, `${tokens[index]} ${tokens[index + 1]}`, 0.6);
  }

  return normalizeVector(vector);
}

export function serializeEmbedding(vector: number[]): string {
  return JSON.stringify(vector.map((value) => Number(value.toFixed(6))));
}

export function deserializeEmbedding(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((entry) => Number.isFinite(entry))
      : [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function tokenizeEmbeddingText(text: string): string[] {
  const normalized = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !embeddingStopWords.has(token));
}

function addWeightedToken(vector: number[], token: string, weight: number): void {
  const index = positiveModulo(hashString(token), vector.length);
  const sign = positiveModulo(hashString(`${token}:sign`), 2) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function tokenWeight(token: string): number {
  if (token.includes('/') || token.includes('.') || token.includes('-')) {
    return 1.3;
  }

  if (token.length >= 12) {
    return 1.15;
  }

  return 1;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
