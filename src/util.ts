/**
 * Utility functions for JSON extraction and parsing
 */

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  comment?: string;
}

/**
 * Extracts JSON blocks from text using ```json fences
 */
export function extractJsonBlocks(text: string): string[] {
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n\s*```/g;
  const blocks: string[] = [];
  let match;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  return blocks;
}

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T = any>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    return null;
  }
}

/**
 * Validates if a parsed object is a valid tool call
 */
export function isValidToolCall(obj: any): obj is ToolCall {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.tool === 'string' &&
    obj.args &&
    typeof obj.args === 'object' &&
    ['read_file', 'write_file', 'exec_cmd', 'list_files', 'git'].includes(obj.tool)
  );
}

/**
 * Generates a unique ID for tool calls
 */
export function generateToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates an OpenAI-compatible SSE chunk
 */
export function createSSEChunk(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Creates an OpenAI-compatible tool call delta chunk
 */
export function createToolCallChunk(id: string, name: string, args: string, index: number = 0): any {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'proxy-model',
    choices: [{
      index,
      delta: {
        tool_calls: [{
          id,
          type: 'function',
          function: {
            name,
            arguments: args
          }
        }]
      },
      finish_reason: null
    }]
  };
}

/**
 * Creates an OpenAI-compatible content delta chunk
 */
export function createContentChunk(content: string, index: number = 0): any {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'proxy-model',
    choices: [{
      index,
      delta: {
        content
      },
      finish_reason: null
    }]
  };
}

/**
 * Creates an OpenAI-compatible final chunk with finish_reason
 */
export function createFinalChunk(finishReason: string = 'stop', index: number = 0): any {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'proxy-model',
    choices: [{
      index,
      delta: {},
      finish_reason: finishReason
    }]
  };
}

/**
 * Creates an initial empty chunk to start the stream
 */
export function createInitialChunk(index: number = 0): any {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'proxy-model',
    choices: [{
      index,
      delta: {},
      finish_reason: null
    }]
  };
}