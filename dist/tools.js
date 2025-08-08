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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeToolExecutor = void 0;
exports.createToolExecutor = createToolExecutor;
exports.executeTool = executeTool;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class SafeToolExecutor {
    workspaceRoot;
    execTimeout;
    execMaxBuffer;
    execBlocklist;
    constructor(workspaceRoot, execTimeout = 8000, execMaxBuffer = 1048576, execBlocklist = 'rm -rf|shutdown|reboot|mkfs|:\\(\\)\\{:\\|:\\&\\}\\;:') {
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.execTimeout = execTimeout;
        this.execMaxBuffer = execMaxBuffer;
        this.execBlocklist = new RegExp(execBlocklist, 'i');
    }
    resolveInRoot(relativePath) {
        try {
            const resolved = path.resolve(this.workspaceRoot, relativePath);
            if (!resolved.startsWith(this.workspaceRoot)) {
                return null;
            }
            return resolved;
        }
        catch {
            return null;
        }
    }
    isCommandBlocked(cmd) {
        return this.execBlocklist.test(cmd);
    }
    async listFiles(args) {
        try {
            const targetPath = this.resolveInRoot(args.path || '.');
            if (!targetPath) {
                return { success: false, error: 'Path outside WORKSPACE_ROOT' };
            }
            if (!fs.existsSync(targetPath)) {
                return { success: false, error: 'Path does not exist' };
            }
            const stats = fs.statSync(targetPath);
            if (!stats.isDirectory()) {
                return { success: false, error: 'Path is not a directory' };
            }
            const items = fs.readdirSync(targetPath).map(name => {
                const itemPath = path.join(targetPath, name);
                const itemStats = fs.statSync(itemPath);
                return {
                    name,
                    type: itemStats.isDirectory() ? 'dir' : 'file'
                };
            });
            return { success: true, result: items };
        }
        catch (error) {
            return { success: false, error: `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async readFile(args) {
        try {
            const targetPath = this.resolveInRoot(args.path);
            if (!targetPath) {
                return { success: false, error: 'Path outside WORKSPACE_ROOT' };
            }
            if (!fs.existsSync(targetPath)) {
                return { success: false, error: 'File does not exist' };
            }
            const stats = fs.statSync(targetPath);
            if (!stats.isFile()) {
                return { success: false, error: 'Path is not a file' };
            }
            if (stats.size > 256 * 1024) {
                return { success: false, error: 'File too large (max 256KB)' };
            }
            const content = fs.readFileSync(targetPath, 'utf-8');
            return { success: true, result: content };
        }
        catch (error) {
            return { success: false, error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async writeFile(args) {
        try {
            const targetPath = this.resolveInRoot(args.path);
            if (!targetPath) {
                return { success: false, error: 'Path outside WORKSPACE_ROOT' };
            }
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(targetPath, args.content, 'utf-8');
            return { success: true, result: `File written successfully: ${args.path}` };
        }
        catch (error) {
            return { success: false, error: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async execCmd(args) {
        try {
            if (this.isCommandBlocked(args.cmd)) {
                return { success: false, error: 'TOOL_ERROR: blocked command' };
            }
            const workingDir = this.resolveInRoot(args.cwd || '.');
            if (!workingDir) {
                return { success: false, error: 'Working directory outside WORKSPACE_ROOT' };
            }
            const { stdout, stderr } = await execAsync(args.cmd, {
                cwd: workingDir,
                timeout: this.execTimeout,
                maxBuffer: this.execMaxBuffer,
                shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
            });
            const result = {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                cmd: args.cmd,
                cwd: args.cwd || '.'
            };
            return { success: true, result };
        }
        catch (error) {
            let errorMsg = 'Command execution failed';
            if (error.code === 'ETIMEDOUT') {
                errorMsg = 'Command timed out';
            }
            else if (error.signal === 'SIGTERM') {
                errorMsg = 'Command was terminated';
            }
            else if (error.stderr) {
                errorMsg = error.stderr;
            }
            else if (error.message) {
                errorMsg = error.message;
            }
            return { success: false, error: `TOOL_ERROR: ${errorMsg}` };
        }
    }
    async git(args) {
        const gitCmd = `git ${args.sub}`;
        return this.execCmd({ cmd: gitCmd, cwd: args.cwd });
    }
}
exports.SafeToolExecutor = SafeToolExecutor;
function createToolExecutor() {
    const workspaceRoot = process.env.WORKSPACE_ROOT || '/app/workspace';
    const execTimeout = parseInt(process.env.EXEC_TIMEOUT_MS || '8000');
    const execMaxBuffer = parseInt(process.env.EXEC_MAX_BUFFER || '1048576');
    const execBlocklist = process.env.EXEC_BLOCKLIST || 'rm -rf|shutdown|reboot|mkfs|:\\(\\)\\{:\\|:\\&\\}\\;:';
    return new SafeToolExecutor(workspaceRoot, execTimeout, execMaxBuffer, execBlocklist);
}
async function executeTool(toolCall) {
    const executor = createToolExecutor();
    let result;
    try {
        switch (toolCall.tool) {
            case 'list_files':
                result = await executor.listFiles(toolCall.args);
                break;
            case 'read_file':
                result = await executor.readFile(toolCall.args);
                break;
            case 'write_file':
                result = await executor.writeFile(toolCall.args);
                break;
            case 'exec_cmd':
                result = await executor.execCmd(toolCall.args);
                break;
            case 'git':
                result = await executor.git(toolCall.args);
                break;
            default:
                return `TOOL_ERROR: Unknown tool: ${toolCall.tool}`;
        }
        if (result.success) {
            const resultStr = typeof result.result === 'string'
                ? result.result
                : JSON.stringify(result.result, null, 2);
            return `[Tool ${toolCall.tool} Result]\n${resultStr}`;
        }
        else {
            return `TOOL_ERROR: ${result.error}`;
        }
    }
    catch (error) {
        return `TOOL_ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}
