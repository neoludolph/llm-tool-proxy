"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const eventsource_parser_1 = require("eventsource-parser");
const dotenv = __importStar(require("dotenv"));
const util_1 = require("./util");
const tools_1 = require("./tools");
const prompts_1 = require("./prompts");
dotenv.config();
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '11434');
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});
app.get('/healthz', (req, res) => {
    res.json({ ok: true });
});
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model, stream = true, ...otherParams } = req.body;
        if (!messages || !Array.isArray(messages)) {
            res.status(400).json({ error: 'Invalid messages format' });
            return;
        }
        const modifiedMessages = [
            { role: 'system', content: prompts_1.SYSTEM_PROMPT },
            ...messages.filter((msg) => msg.role !== 'system')
        ];
        const upstreamRequest = {
            messages: modifiedMessages,
            model: model || process.env.DEFAULT_MODEL || 'llama3.1:8b',
            stream: true,
            ...otherParams
        };
        delete upstreamRequest.tools;
        delete upstreamRequest.tool_choice;
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write((0, util_1.createSSEChunk)((0, util_1.createInitialChunk)()));
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
        let contentBuffer = '';
        let processedJsonBlocks = new Set();
        const parser = (0, eventsource_parser_1.createParser)((event) => {
            if (event.type === 'event') {
                if (event.data === '[DONE]') {
                    res.write((0, util_1.createSSEChunk)((0, util_1.createFinalChunk)()));
                    res.write('data: [DONE]\n\n');
                    res.end();
                    return;
                }
                try {
                    const data = JSON.parse(event.data);
                    const choice = data.choices?.[0];
                    const delta = choice?.delta;
                    if (delta?.content) {
                        contentBuffer += delta.content;
                        const jsonBlocks = (0, util_1.extractJsonBlocks)(contentBuffer);
                        for (const jsonBlock of jsonBlocks) {
                            if (processedJsonBlocks.has(jsonBlock)) {
                                continue;
                            }
                            const toolCall = (0, util_1.safeJsonParse)(jsonBlock);
                            if (toolCall && (0, util_1.isValidToolCall)(toolCall)) {
                                processedJsonBlocks.add(jsonBlock);
                                const toolCallId = (0, util_1.generateToolCallId)();
                                const toolCallChunk = (0, util_1.createToolCallChunk)(toolCallId, toolCall.tool, JSON.stringify(toolCall.args));
                                res.write((0, util_1.createSSEChunk)(toolCallChunk));
                                (0, tools_1.executeTool)(toolCall).then(result => {
                                    const resultChunk = (0, util_1.createContentChunk)(`\n\n${result}`);
                                    res.write((0, util_1.createSSEChunk)(resultChunk));
                                }).catch(error => {
                                    const errorChunk = (0, util_1.createContentChunk)(`\n\nTOOL_ERROR: ${error.message}`);
                                    res.write((0, util_1.createSSEChunk)(errorChunk));
                                });
                                const jsonFence = `\`\`\`json\n${jsonBlock}\n\`\`\``;
                                contentBuffer = contentBuffer.replace(jsonFence, '');
                            }
                        }
                        if (delta.content && !(0, util_1.extractJsonBlocks)(delta.content).length) {
                            const cleanContent = delta.content.replace(/```json[\s\S]*?```/g, '');
                            if (cleanContent.trim()) {
                                res.write((0, util_1.createSSEChunk)(data));
                            }
                        }
                    }
                    else {
                        res.write((0, util_1.createSSEChunk)(data));
                    }
                }
                catch (error) {
                    console.error('Error parsing SSE data:', error);
                    res.write((0, util_1.createSSEChunk)({ error: 'Parse error' }));
                }
            }
        });
        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                parser.feed(chunk);
            }
        }
        catch (error) {
            console.error('Error reading stream:', error);
            res.write((0, util_1.createSSEChunk)({ error: 'Stream error' }));
            res.end();
        }
    }
    catch (error) {
        console.error('Error in chat completions:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
        else {
            res.write((0, util_1.createSSEChunk)({ error: 'Internal server error' }));
            res.end();
        }
    }
});
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: 'This proxy only supports /v1/chat/completions and /healthz'
    });
});
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
});
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LLM Tool Proxy running on port ${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/healthz`);
    console.log(`🔧 Chat completions: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`📁 Workspace root: ${process.env.WORKSPACE_ROOT || '/app/workspace'}`);
    console.log(`🔗 Upstream URL: ${process.env.UPSTREAM_URL || 'Not configured'}`);
});
exports.default = app;
