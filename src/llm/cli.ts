import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { LLMError, type LLMClient, type LLMModel } from './types.js';

/**
 * Shell-out client a `claude -p "$prompt" --output-format text`.
 * Pensado para fase de prototipo. Latencia ~1-2s/call por startup del CLI.
 */
export class ClaudeCLIClient implements LLMClient {
  async classify(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.runCli(prompt, opts.model);
  }

  async generateText(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.runCli(prompt, opts.model);
  }

  async extractFromImage(
    prompt: string,
    image: Buffer,
    opts: { model?: LLMModel } = {},
  ): Promise<string> {
    // CLI no acepta imágenes vía stdin; escribimos a archivo temp y referenciamos.
    const tmpPath = join(tmpdir(), `politica-${randomUUID()}.png`);
    await writeFile(tmpPath, image);
    try {
      // El CLI acepta @path/to/file.png como referencia inline en el prompt.
      const promptWithImage = `${prompt}\n\n@${tmpPath}`;
      return await this.runCli(promptWithImage, opts.model ?? 'sonnet');
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  private runCli(prompt: string, model?: LLMModel): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'text'];
      if (model === 'haiku') args.push('--model', 'claude-haiku-4-5');
      if (model === 'sonnet') args.push('--model', 'claude-sonnet-4-6');

      const proc = spawn(env.LLM_CLI_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new LLMError(`CLI timeout after ${env.LLM_CLI_TIMEOUT_MS}ms`));
      }, env.LLM_CLI_TIMEOUT_MS);

      proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new LLMError(`Failed to spawn ${env.LLM_CLI_BIN}: ${err.message}`, err));
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          logger.warn({ stderr, code }, 'claude CLI exited non-zero');
          reject(new LLMError(`CLI exit code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
