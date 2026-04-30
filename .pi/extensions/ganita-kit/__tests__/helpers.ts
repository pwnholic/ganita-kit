/**
 * Test helpers for ganita-kit extension unit tests.
 *
 * Provides a mock ExtensionAPI that captures pi.registerTool() calls
 * and stubs pi.exec() with configurable responses.
 */

/** Shape of a tool registered via pi.registerTool(). */
export type RegisteredTool = {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
    ) => Promise<ToolExecuteResult>;
    promptSnippet?: string;
    promptGuidelines?: string[];
};

/** Shape returned by tool execute functions. */
export type ToolExecuteResult = {
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
};

/** Shape of a call to pi.exec(). */
export type ExecCall = {
    command: string;
    args: string[];
    options: Record<string, unknown>;
};

/**
 * Result of capturing registerTool calls on a mock ExtensionAPI.
 * Provides access to registered tools and exec call history.
 */
export type MockPiCapture = {
    tools: Map<string, RegisteredTool>;
    execCalls: ExecCall[];
};

/**
 * Creates a mock ExtensionAPI that records registerTool calls
 * and stubs exec with configurable responses.
 *
 * @param execResults - Map of binary name to stdout output.
 *   Key is the binary name (e.g. "webclaw"), value is the stdout string.
 *   If a command is not in the map, exec returns exit code 1 with stderr.
 * @returns Object with the mock `pi` and a `capture` object for assertions.
 */
export function createMockPi(execResults: Map<string, { stdout: string; exitCode?: number }>): {
    pi: {
        registerTool: (tool: RegisteredTool) => void;
        exec: (
            command: string,
            args: string[],
            options: Record<string, unknown>,
        ) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
    };
    capture: MockPiCapture;
} {
    const capture: MockPiCapture = {
        tools: new Map(),
        execCalls: [],
    };

    const pi = {
        registerTool(tool: RegisteredTool): void {
            capture.tools.set(tool.name, tool);
        },
        async exec(
            command: string,
            args: string[],
            options: Record<string, unknown>,
        ): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> {
            capture.execCalls.push({ command, args, options });

            const result = execResults.get(command);

            if (!result) {
                return {
                    stdout: "",
                    stderr: `${command}: command not found in mock`,
                    code: 1,
                    killed: false,
                };
            }

            return {
                stdout: result.stdout,
                stderr: "",
                code: result.exitCode ?? 0,
                killed: false,
            };
        },
    };

    return { pi, capture };
}
