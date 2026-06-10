import { exec } from 'child_process';
import { promisify } from 'util';
import { truncate } from '../text';

const execAsync = promisify(exec);

export interface CommandVerificationResult {
  exitCode: number;
  output: string;
}

export async function runVerificationCommand(
  command: string,
  cwd: string,
  maxOutputCharacters: number
): Promise<CommandVerificationResult> {
  try {
    const result = await execAsync(command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });

    return {
      exitCode: 0,
      output: truncate([result.stdout, result.stderr].filter(Boolean).join('\n'), maxOutputCharacters)
    };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      output: truncate(
        [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n'),
        maxOutputCharacters
      )
    };
  }
}
