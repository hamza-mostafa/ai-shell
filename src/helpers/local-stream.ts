import { IncomingMessage } from 'http';
import { KnownError } from './error';

export interface LocalStreamResponse {
  stream: IncomingMessage;
  format: 'ollama' | 'openai' | 'lmstudio';
}

export class LocalStreamHandler {
  static async createStream(
    endpoint: string,
    model: string,
    messages: any[],
    format?: 'ollama' | 'openai' | 'lmstudio'
  ): Promise<LocalStreamResponse> {
    if (format) {
      return this.createStreamWithFormat(endpoint, model, messages, format);
    }

    // Try different formats in order of preference
    const formats: Array<'ollama' | 'openai' | 'lmstudio'> = ['ollama', 'lmstudio', 'openai'];
    
    for (const fmt of formats) {
      try {
        const result = await this.createStreamWithFormat(endpoint, model, messages, fmt);
        return result;
      } catch (error) {
        // Continue to next format
        continue;
      }
    }

    throw new KnownError(
      `Failed to connect to any local model server at ${endpoint}. Supported formats: Ollama, LM Studio, OpenAI-compatible`
    );
  }

  private static async createStreamWithFormat(
    endpoint: string,
    model: string,
    messages: any[],
    format: 'ollama' | 'openai' | 'lmstudio'
  ): Promise<LocalStreamResponse> {
    let url: string;
    let body: any;
    let isOllama = format === 'ollama';

    switch (format) {
      case 'ollama':
        url = `${endpoint}/api/chat`;
        body = {
          model,
          messages,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        };
        break;

      case 'lmstudio':
        url = `${endpoint}/v1/chat/completions`;
        body = {
          model,
          messages,
          stream: true,
          temperature: 0.7,
        };
        break;

      case 'openai':
        url = `${endpoint}/chat/completions`;
        body = {
          model,
          messages,
          stream: true,
        };
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    try {
      // Try streaming first
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok && response.body && isOllama) {
        // Check if content-type is application/x-ndjson or text/event-stream
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream')) {
          return {
            stream: response.body as unknown as IncomingMessage,
            format,
          };
        }
        // If not streaming, fall through to try non-streaming
      } else if (response.ok && response.body) {
        // For other providers, just return the stream
        return {
          stream: response.body as unknown as IncomingMessage,
          format,
        };
      }

      // Retry with stream: false for Ollama
      if (isOllama) {
        body.stream = false;
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`${format} request failed (non-stream): ${response.statusText}`);
        }
        const json = await response.json();
        // Return a fake stream that yields the content as if it were a stream
        const { Readable } = require('stream');
        const fakeStream = new Readable({
          read() {
            // Simulate a streaming payload
            this.push(`data: ${JSON.stringify(json)}\n`);
            this.push(null);
          },
        });
        return {
          stream: fakeStream,
          format,
        };
      }

      throw new Error(`${format} request failed: ${response.statusText}`);
    } catch (err) {
      throw err;
    }
  }

  static async listModels(endpoint: string): Promise<any[]> {
    const formats = [
      { format: 'ollama', url: `${endpoint}/api/tags`, transform: (data: any) => data.models?.map((m: any) => ({ id: m.name, name: m.name })) || [] },
      { format: 'lmstudio', url: `${endpoint}/v1/models`, transform: (data: any) => data.data?.map((m: any) => ({ id: m.id, name: m.id })) || [] },
      { format: 'openai', url: `${endpoint}/models`, transform: (data: any) => data.data?.map((m: any) => ({ id: m.id, name: m.id })) || [] },
    ];

    for (const { format, url, transform } of formats) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          return transform(data);
        }
      } catch (error) {
        // Continue to next format
        continue;
      }
    }

    return [];
  }
} 