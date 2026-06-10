import { CapturedCommit, CapturedConversation, MemoryGenerationOptions, MemoryGenerationResult } from '../types';
import { runCommandGenerator } from './commandGenerator';
import { buildGeneratorInput, parseJsonPayload, payloadToMemoryDraft } from './generatedPayload';
import { runOpenAIResponsesGenerator } from './openAIResponsesGenerator';
import { synthesizeMemory } from './synthesizer';

export async function generateMemoryDraft(
  conversation: CapturedConversation,
  commit: CapturedCommit,
  options: MemoryGenerationOptions
): Promise<MemoryGenerationResult> {
  const heuristicDraft = synthesizeMemory(conversation, commit);

  if (options.provider === 'heuristic') {
    return {
      draft: heuristicDraft,
      provider: 'heuristic'
    };
  }

  try {
    const input = buildGeneratorInput(conversation, commit, options.maxInputCharacters);
    const rawOutput = options.provider === 'command'
      ? await runCommandGenerator(options.command, input, options.timeoutMs)
      : await runOpenAIResponsesGenerator({
        endpoint: options.openAIEndpoint,
        model: options.openAIModel,
        apiKeyEnvVar: options.openAIApiKeyEnvVar,
        input,
        timeoutMs: options.timeoutMs
      });
    const payload = parseJsonPayload(rawOutput);

    return {
      draft: payloadToMemoryDraft(payload, conversation, commit),
      provider: options.provider
    };
  } catch (error) {
    return {
      draft: heuristicDraft,
      provider: 'heuristic',
      fallbackReason: error instanceof Error ? error.message : String(error)
    };
  }
}
