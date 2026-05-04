/**
 * Abstracción de transporte LLM.
 *
 * En fase 1 solo existe ClaudeCLIClient (shellea a `claude -p`).
 * En fase posterior se agrega ClaudeSDKClient (@anthropic-ai/sdk).
 * El consumidor importa `llm` de ./index.ts y no sabe cuál hay debajo.
 */

export type LLMModel = 'haiku' | 'sonnet';

export interface LLMClient {
  /**
   * Pregunta corta de clasificación. Devuelve el output crudo del LLM (texto).
   * El llamador parsea (sí/no/duda, JSON, etc.) según su contrato.
   */
  classify(prompt: string, opts?: { model?: LLMModel }): Promise<string>;

  /**
   * Extracción estructurada desde una imagen.
   * El prompt debe pedir JSON output explícitamente.
   * Devuelve el texto crudo (típicamente JSON); el llamador hace JSON.parse + zod.
   */
  extractFromImage(prompt: string, image: Buffer, opts?: { model?: LLMModel }): Promise<string>;

  /**
   * Generación de texto libre con prompt + contexto inyectado.
   * Usa modelo por default (haiku) salvo override.
   */
  generateText(prompt: string, opts?: { model?: LLMModel }): Promise<string>;
}

export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LLMError';
  }
}
