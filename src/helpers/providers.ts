import { ChatCompletionRequestMessage, Model } from 'openai';
import { IncomingMessage } from 'http';
import { KnownError } from './error';
import { streamToIterable } from './stream-to-iterable';
import type { AxiosError } from 'axios';
import { streamToString } from './stream-to-string';
import dedent from 'dedent';
import { LocalStreamHandler } from './local-stream';

export interface Provider {
  name: string;
  generateCompletion(params: {
    prompt: string | ChatCompletionRequestMessage[];
    number?: number;
    model?: string;
    key: string;
    apiEndpoint: string;
  }): Promise<IncomingMessage>;
  getModels(params: {
    key: string;
    apiEndpoint: string;
  }): Promise<Model[]>;
}

export class OpenAIProvider implements Provider {
  name = 'openai';

  async generateCompletion({
    prompt,
    number = 1,
    model,
    key,
    apiEndpoint,
  }: {
    prompt: string | ChatCompletionRequestMessage[];
    number?: number;
    model?: string;
    key: string;
    apiEndpoint: string;
  }): Promise<IncomingMessage> {
    const { OpenAIApi, Configuration } = await import('openai');
    const openAi = new OpenAIApi(
      new Configuration({ apiKey: key, basePath: apiEndpoint })
    );

    try {
      const completion = await openAi.createChatCompletion(
        {
          model: model || 'gpt-4o-mini',
          messages: Array.isArray(prompt)
            ? prompt
            : [{ role: 'user', content: prompt }],
          n: Math.min(number, 10),
          stream: true,
        },
        { responseType: 'stream' }
      );

      return completion.data as unknown as IncomingMessage;
    } catch (err) {
      const error = err as AxiosError;

      if (error.code === 'ENOTFOUND') {
        throw new KnownError(
          `Error connecting to ${error.request.hostname} (${error.request.syscall}). Are you connected to the internet?`
        );
      }

      const response = error.response;
      let message = response?.data as string | object | IncomingMessage;
      if (response && message instanceof IncomingMessage) {
        message = await streamToString(
          response.data as unknown as IncomingMessage
        );
        try {
          message = JSON.parse(message);
        } catch (e) {
          // Ignore
        }
      }

      const messageString = message && JSON.stringify(message, null, 2);
      if (response?.status === 429) {
        throw new KnownError(
          dedent`
          Request to OpenAI failed with status 429. This is due to incorrect billing setup or excessive quota usage. Please follow this guide to fix it: https://help.openai.com/en/articles/6891831-error-code-429-you-exceeded-your-current-quota-please-check-your-plan-and-billing-details

          You can activate billing here: https://platform.openai.com/account/billing/overview . Make sure to add a payment method if not under an active grant from OpenAI.

          Full message from OpenAI:
        ` +
            '\n\n' +
            messageString +
            '\n'
        );
      } else if (response && message) {
        throw new KnownError(
          dedent`
          Request to OpenAI failed with status ${response?.status}:
        ` +
            '\n\n' +
            messageString +
            '\n'
        );
      }

      throw error;
    }
  }

  async getModels({
    key,
    apiEndpoint,
  }: {
    key: string;
    apiEndpoint: string;
  }): Promise<Model[]> {
    const { OpenAIApi, Configuration } = await import('openai');
    const openAi = new OpenAIApi(
      new Configuration({ apiKey: key, basePath: apiEndpoint })
    );
    const response = await openAi.listModels();
    return response.data.data.filter((model) => model.object === 'model');
  }
}

export class LocalProvider implements Provider {
  name = 'local';

  async generateCompletion({
    prompt,
    number = 1,
    model,
    key,
    apiEndpoint,
  }: {
    prompt: string | ChatCompletionRequestMessage[];
    number?: number;
    model?: string;
    key: string;
    apiEndpoint: string;
  }): Promise<IncomingMessage> {
    // For local models, use the model parameter as the model name
    // and apiEndpoint as the server URL
    const localModel = model || key;
    const localEndpoint = apiEndpoint || 'http://localhost:11434';

    try {
      const messages = Array.isArray(prompt)
        ? prompt
        : [{ role: 'user', content: prompt }];

      const { stream } = await LocalStreamHandler.createStream(
        localEndpoint,
        localModel,
        messages
      );

      return stream;
    } catch (error) {
      throw new KnownError(
        `Failed to connect to local model server at ${localEndpoint}. Make sure your local model server (Ollama, LM Studio, etc.) is running.\n\nError: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getModels({
    key,
    apiEndpoint,
  }: {
    key: string;
    apiEndpoint: string;
  }): Promise<Model[]> {
    const localEndpoint = apiEndpoint || 'http://localhost:11434';

    try {
      const models = await LocalStreamHandler.listModels(localEndpoint);
      return models.map((model: any) => ({
        id: model.id || model.name,
        object: 'model',
        created: Date.now(),
        owned_by: 'local',
      }));
    } catch (error) {
      // Return default models if we can't fetch them
      return this.getDefaultModels();
    }
  }

  private getDefaultModels(): Model[] {
    return [
      { id: 'llama2', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:7b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:13b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:70b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:7b-chat', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:13b-chat', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'llama2:70b-chat', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'codellama', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'codellama:7b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'codellama:34b-code-q5_K_M', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'codellama:13b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'codellama:34b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'nous-hermes2:34b', object: 'model', created: Date.now(), owned_by: 'local' },
      { id: 'nous-hermes:34b-instruct', object: 'model', created: Date.now(), owned_by: 'local' },
    ];
  }
}

export const providers: Record<string, Provider> = {
  openai: new OpenAIProvider(),
  local: new LocalProvider(),
};

export function getProvider(name: string): Provider {
  const provider = providers[name];
  if (!provider) {
    throw new KnownError(`Unknown provider: ${name}`);
  }
  return provider;
} 