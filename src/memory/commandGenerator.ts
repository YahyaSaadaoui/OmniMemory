import { spawn } from 'child_process';

export async function runCommandGenerator(
  command: string,
  input: string,
  timeoutMs: number
): Promise<string> {
  if (!command.trim()) {
    throw new Error('No memory generator command configured.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Command generator timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `Command generator exited with code ${code}.`));
    });

    child.stdin.end(input);
  });
}
