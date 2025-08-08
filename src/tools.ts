/**
 * Tool implementations with security and safety measures
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

export interface ToolExecutor {
  listFiles(args: { path: string }): Promise<ToolResult>;
  readFile(args: { path: string }): Promise<ToolResult>;
  writeFile(args: { path: string; content: string }): Promise<ToolResult>;
  execCmd(args: { cmd: string; cwd?: string }): Promise<ToolResult>;
  git(args: { sub: string; cwd?: string }): Promise<ToolResult>;
}

export class SafeToolExecutor implements ToolExecutor {
  private workspaceRoot: string;
  private execTimeout: number;
  private execMaxBuffer: number;
  private execBlocklist: RegExp;

  constructor(
    workspaceRoot: string,
    execTimeout: number = 8000,
    execMaxBuffer: number = 1048576,
    execBlocklist: string = 'rm -rf|shutdown|reboot|mkfs|:\\(\\)\\{:\\|:\\&\\}\\;:'
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.execTimeout = execTimeout;
    this.execMaxBuffer = execMaxBuffer;
    this.execBlocklist = new RegExp(execBlocklist, 'i');
  }

  /**
   * Resolves and validates paths within workspace root
   */
  private resolveInRoot(relativePath: string): string | null {
    try {
      const resolved = path.resolve(this.workspaceRoot, relativePath);
      if (!resolved.startsWith(this.workspaceRoot)) {
        return null;
      }
      return resolved;
    } catch {
      return null;
    }
  }

  /**
   * Checks if a command is blocked by the security blocklist
   */
  private isCommandBlocked(cmd: string): boolean {
    return this.execBlocklist.test(cmd);
  }

  /**
   * List files and directories
   */
  async listFiles(args: { path: string }): Promise<ToolResult> {
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
    } catch (error) {
      return { success: false, error: `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Read file contents (max 256KB)
   */
  async readFile(args: { path: string }): Promise<ToolResult> {
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
    } catch (error) {
      return { success: false, error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Write content to file (creates directories if needed)
   */
  async writeFile(args: { path: string; content: string }): Promise<ToolResult> {
    try {
      const targetPath = this.resolveInRoot(args.path);
      if (!targetPath) {
        return { success: false, error: 'Path outside WORKSPACE_ROOT' };
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetPath, args.content, 'utf-8');
      return { success: true, result: `File written successfully: ${args.path}` };
    } catch (error) {
      return { success: false, error: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Execute shell command with safety limits
   */
  async execCmd(args: { cmd: string; cwd?: string }): Promise<ToolResult> {
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
    } catch (error: any) {
      let errorMsg = 'Command execution failed';
      if (error.code === 'ETIMEDOUT') {
        errorMsg = 'Command timed out';
      } else if (error.signal === 'SIGTERM') {
        errorMsg = 'Command was terminated';
      } else if (error.stderr) {
        errorMsg = error.stderr;
      } else if (error.message) {
        errorMsg = error.message;
      }

      return { success: false, error: `TOOL_ERROR: ${errorMsg}` };
    }
  }

  /**
   * Execute git commands
   */
  async git(args: { sub: string; cwd?: string }): Promise<ToolResult> {
    const gitCmd = `git ${args.sub}`;
    return this.execCmd({ cmd: gitCmd, cwd: args.cwd });
  }
}

/**
 * Factory function to create tool executor
 */
export function createToolExecutor(): SafeToolExecutor {
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/app/workspace';
  const execTimeout = parseInt(process.env.EXEC_TIMEOUT_MS || '8000');
  const execMaxBuffer = parseInt(process.env.EXEC_MAX_BUFFER || '1048576');
  const execBlocklist = process.env.EXEC_BLOCKLIST || 'rm -rf|shutdown|reboot|mkfs|:\\(\\)\\{:\\|:\\&\\}\\;:';

  return new SafeToolExecutor(workspaceRoot, execTimeout, execMaxBuffer, execBlocklist);
}

/**
 * Execute a tool call and return formatted result
 */
export async function executeTool(toolCall: { tool: string; args: any }): Promise<string> {
  const executor = createToolExecutor();
  let result: ToolResult;

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
    } else {
      return `TOOL_ERROR: ${result.error}`;
    }
  } catch (error) {
    return `TOOL_ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}