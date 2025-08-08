"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJsonBlocks = extractJsonBlocks;
exports.safeJsonParse = safeJsonParse;
exports.isValidToolCall = isValidToolCall;
exports.generateToolCallId = generateToolCallId;
exports.createSSEChunk = createSSEChunk;
exports.createToolCallChunk = createToolCallChunk;
exports.createContentChunk = createContentChunk;
exports.createFinalChunk = createFinalChunk;
exports.createInitialChunk = createInitialChunk;
function extractJsonBlocks(text) {
    const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n\s*```/g;
    const blocks = [];
    let match;
    while ((match = jsonBlockRegex.exec(text)) !== null) {
        blocks.push(match[1].trim());
    }
    return blocks;
}
function safeJsonParse(jsonString) {
    try {
        return JSON.parse(jsonString);
    }
    catch (error) {
        return null;
    }
}
function isValidToolCall(obj) {
    return (obj &&
        typeof obj === 'object' &&
        typeof obj.tool === 'string' &&
        obj.args &&
        typeof obj.args === 'object' &&
        ['read_file', 'write_file', 'exec_cmd', 'list_files', 'git'].includes(obj.tool));
}
function generateToolCallId() {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function createSSEChunk(data) {
    return `data: ${JSON.stringify(data)}\n\n`;
}
function createToolCallChunk(id, name, args, index = 0) {
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
function createContentChunk(content, index = 0) {
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
function createFinalChunk(finishReason = 'stop', index = 0) {
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
function createInitialChunk(index = 0) {
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
