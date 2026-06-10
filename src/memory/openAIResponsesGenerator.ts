import * as https from 'https';
import { generatedMemorySchema } from './generatedPayload';

export interface OpenAIResponsesOptions {
  endpoint: string;
  model: string;
  apiKeyEnvVar: string;
  input: string;
  timeoutMs: number;
}

export async function runOpenAIResponsesGenerator(options: OpenAIResponsesOptions): Promise<string> {
  const apiKey = process.env[options.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Environment variable ${options.apiKeyEnvVar} is not set.`);
  }

  const body = JSON.stringify({
    model: options.model,
    input: [
      {
        role: 'system',
        content: [
          'Convert engineering conversations and Git context into one concise engineering memory card.',
          'Only include facts supported by the input. Use "not explicitly captured" when evidence is missing.',
          'Prefer root cause, failed attempts, final solution, verification evidence, and reusable lessons.'
        ].join(' ')
      },
      {
        role: 'user',
        content: options.input
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'omnimemory_card',
        strict: true,
        schema: generatedMemorySchema
      }
    }
  });

  const response = await postJson(options.endpoint, apiKey, body, options.timeoutMs);
  const outputText = extractOutputText(JSON.parse(response));

  if (!outputText) {
    throw new Error('OpenAI response did not include output text.');
  }

  return outputText;
}

function postJson(endpoint: string, apiKey: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const request = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || 443,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += String(chunk);
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
            return;
          }

          reject(new Error(`OpenAI request failed with status ${response.statusCode}: ${data.slice(0, 1000)}`));
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`OpenAI request timed out after ${timeoutMs}ms.`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractOutputText(response: unknown): string | undefined {
  if (!isObject(response)) {
    return undefined;
  }

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  if (!Array.isArray(response.output)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (!isObject(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (isObject(content) && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim() || undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
