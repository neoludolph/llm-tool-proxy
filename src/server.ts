/**
 * Main server implementation with OpenAI-compatible streaming proxy
 */

import express, { Request, Response, NextFunction } from 'express';
import { createParser } from 'eventsource-parser';
import * as dotenv from 'dotenv';
import { 
  extractJsonBlocks, 
  safeJsonParse, 
  isValidToolCall, 
  generateToolCallId,
  createSSEChunk,
  createToolCallChunk,
  createContentChunk,
  createFinalChunk,
  createInitialChunk,
  ToolCall
} from './util';
import { executeTool } from './tools';
import { SYSTEM_PROMPT } from './prompts';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS headers for browser compatibility
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Main chat completions endpoint
app.post('/v1/chat/completions', async (req: Request, res: Response): Promise<void> => {
  try {
  const { messages, model, stream = true, tools, tool_choice, ...otherParams } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Invalid messages format' });
      return;
    }

    // Determine mode: Agent (native tools) vs Local tools via JSON-fences
    const isAgentMode = Array.isArray(tools) || typeof tool_choice !== 'undefined';

    // Inject system prompt only in local-tools mode
    const modifiedMessages = isAgentMode
      ? messages
      : [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.filter((msg: any) => msg.role !== 'system')
        ];

    // Prepare upstream request
    const upstreamRequest: any = {
      messages: modifiedMessages,
      model: model || process.env.DEFAULT_MODEL || 'llama3.1:8b',
      stream: true,
      ...otherParams
    };

    // Preserve tools for Agent mode; strip for local-tools mode
    if (isAgentMode) {
      if (Array.isArray(tools)) upstreamRequest.tools = tools;
      if (typeof tool_choice !== 'undefined') upstreamRequest.tool_choice = tool_choice;
    }

    // Set up SSE headers (must be event-stream for OpenAI-compatible clients)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    // Send initial chunk in local-tools mode only (Agent mode will receive role chunk from upstream)
    if (!isAgentMode) {
      res.write(createSSEChunk(createInitialChunk()));
    }

    // Make request to upstream
    const upstreamUrl = process.env.UPSTREAM_URL;
    if (!upstreamUrl) {
      throw new Error('UPSTREAM_URL not configured');
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.UPSTREAM_API_KEY || ''}`,
      },
      body: JSON.stringify(upstreamRequest),
    });

    if (!upstreamResponse.ok) {
      throw new Error(`Upstream error: ${upstreamResponse.status} ${upstreamResponse.statusText}`);
    }

    if (!upstreamResponse.body) {
      throw new Error('No response body from upstream');
    }

    // In Agent mode, pass through upstream SSE stream unmodified
    if (isAgentMode) {
      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch (error) {
        console.error('Agent-mode passthrough error:', error);
      } finally {
        res.end();
      }
      return;
    }

    // Buffer for accumulating content
    let contentBuffer = '';
    const processedJsonBlocks = new Set<string>();
    let pendingToolTasks = 0;
    let upstreamDone = false;
    const maybeFinish = () => {
      if (upstreamDone && pendingToolTasks === 0) {
        res.write(createSSEChunk(createFinalChunk()));
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };

    // Create parser for SSE stream
    const parser = createParser((event) => {
      if (event.type === 'event') {
        if (event.data === '[DONE]') {
          upstreamDone = true;
          maybeFinish();
          return;
        }

        try {
          const data = JSON.parse(event.data);
          const choice = data.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            contentBuffer += delta.content;

            // Check for complete JSON blocks in the buffer
            const jsonBlocks = extractJsonBlocks(contentBuffer);
            
            for (const jsonBlock of jsonBlocks) {
              // Skip if we've already processed this block
              if (processedJsonBlocks.has(jsonBlock)) {
                continue;
              }

              const toolCall = safeJsonParse<ToolCall>(jsonBlock);
              if (toolCall && isValidToolCall(toolCall)) {
                processedJsonBlocks.add(jsonBlock);

                // Generate tool call ID
                const toolCallId = generateToolCallId();

                // Send tool call chunk
                const toolCallChunk = createToolCallChunk(
                  toolCallId,
                  toolCall.tool,
                  JSON.stringify(toolCall.args)
                );
                res.write(createSSEChunk(toolCallChunk));

                // Execute tool asynchronously
                pendingToolTasks++;
                executeTool(toolCall)
                  .then(result => {
                    // Send tool result as content
                    const resultChunk = createContentChunk(`\n\n${result}`);
                    res.write(createSSEChunk(resultChunk));
                  })
                  .catch(error => {
                    // Send error as content
                    const errorChunk = createContentChunk(`\n\nTOOL_ERROR: ${error.message}`);
                    res.write(createSSEChunk(errorChunk));
                  })
                  .finally(() => {
                    pendingToolTasks = Math.max(0, pendingToolTasks - 1);
                    maybeFinish();
                  });

                // Remove the processed JSON block from content buffer
                const jsonFence = `\`\`\`json\n${jsonBlock}\n\`\`\``;
                contentBuffer = contentBuffer.replace(jsonFence, '');
              }
            }

            // Send remaining content (non-tool content)
            if (delta.content && !extractJsonBlocks(delta.content).length) {
              // Only send content that doesn't contain JSON blocks
              const cleanContent = delta.content.replace(/```json[\s\S]*?```/g, '');
              if (cleanContent.trim()) {
                const contentChunk = createContentChunk(cleanContent);
                res.write(createSSEChunk(contentChunk));
              }
            }
          } else {
            // Ignore other upstream deltas to keep response schema consistent
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
          // Emit a content delta with a parse error message to keep schema stable
          res.write(createSSEChunk(createContentChunk('\n\n[Proxy Parse Error] Unable to parse upstream chunk.')));
        }
      }
    });

    // Process the stream
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        parser.feed(chunk);
      }
    } catch (error) {
  console.error('Error reading stream:', error);
  res.write(createSSEChunk(createContentChunk('\n\n[Proxy Stream Error] Upstream stream interrupted.')));
      res.end();
    }

  } catch (error) {
  console.error('Error in chat completions:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      res.write(createSSEChunk(createContentChunk('\n\n[Proxy Error] Internal server error.')));
      res.end();
    }
  }
});

// Catch-all for unsupported endpoints
app.use('*', (_req: Request, res: Response) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'This proxy only supports /v1/chat/completions and /healthz'
  });
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  
  if (!res.headersSent) {
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LLM Tool Proxy running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/healthz`);
  console.log(`🔧 Chat completions: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`📁 Workspace root: ${process.env.WORKSPACE_ROOT || '/app/workspace'}`);
  console.log(`🔗 Upstream URL: ${process.env.UPSTREAM_URL || 'Not configured'}`);
});

export default app;