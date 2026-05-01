import { describe, expect, it, vi } from "vitest";

// Mock config module — hasBinary returns true by default
vi.mock("../config/config.js", () => ({
    hasBinary: vi.fn().mockReturnValue(true),
}));

// Mock tldr commands module — warmCache resolves successfully by default
vi.mock("../commands/tldr.js", () => ({
    warmCache: vi.fn().mockResolvedValue({ ok: true, output: '{"status":"ok"}' }),
    register: vi.fn(),
}));

import { hasBinary } from "../config/config.js";
import { register } from "../event/event.js";
import { warmCache } from "../tools/tldr.js";

/**
 * Create a minimal mock for event handler testing.
 * Captures pi.on() calls so we can invoke the handler manually.
 */
function createEventMock() {
    const handlers = new Map<
        string,
        Array<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void>>
    >();

    const notifyCalls: Array<{ message: string; level: string }> = [];

    const pi = {
        on(
            event: string,
            handler: (
                event: Record<string, unknown>,
                ctx: Record<string, unknown>,
            ) => Promise<void>,
        ) {
            const existing = handlers.get(event) ?? [];
            existing.push(handler);
            handlers.set(event, existing);
        },
        registerTool: vi.fn(),
        exec: vi.fn(),
    };

    const ctx = {
        cwd: "/test/project",
        ui: {
            notify: (message: string, level: string) => {
                notifyCalls.push({ message, level });
            },
        },
    };

    return { pi, ctx, handlers, notifyCalls };
}

describe("event register", () => {
    it("registers a session_start handler", () => {
        const { pi, handlers } = createEventMock();
        register(pi as never);

        expect(handlers.has("session_start")).toBe(true);
        expect(handlers.get("session_start")!.length).toBe(1);
    });

    it("calls warmCache on session_start with reason startup", async () => {
        vi.mocked(warmCache).mockResolvedValue({
            ok: true,
            output: '{"status":"ok"}',
        });

        const { pi, ctx, handlers } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;
        await handler({ reason: "startup" }, ctx);

        // warmCache runs in background via .then(), flush microtasks
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warmCache).toHaveBeenCalledWith(pi, "/test/project");
    });

    it("notifies on successful warm", async () => {
        vi.mocked(warmCache).mockResolvedValue({
            ok: true,
            output: '{"status":"ok"}',
        });

        const { pi, ctx, handlers, notifyCalls } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;
        await handler({ reason: "startup" }, ctx);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(notifyCalls.length).toBe(1);
        expect(notifyCalls[0]!.message).toBe("tldr cache warmed");
        expect(notifyCalls[0]!.level).toBe("info");
    });

    it("does NOT call warmCache on reload/resume/fork", async () => {
        vi.mocked(warmCache).mockClear();

        const { pi, ctx, handlers } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;

        await handler({ reason: "reload" }, ctx);
        await handler({ reason: "resume" }, ctx);
        await handler({ reason: "fork" }, ctx);
        await handler({ reason: "new" }, ctx);

        expect(warmCache).not.toHaveBeenCalled();
    });

    it("skips warm when tldr binary not installed", async () => {
        vi.mocked(hasBinary).mockReturnValue(false);
        vi.mocked(warmCache).mockClear();

        const { pi, ctx, handlers } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;
        await handler({ reason: "startup" }, ctx);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warmCache).not.toHaveBeenCalled();

        // Restore
        vi.mocked(hasBinary).mockReturnValue(true);
    });

    it("does NOT notify on warm failure", async () => {
        vi.mocked(warmCache).mockResolvedValue({
            ok: false,
            error: "tldr warm failed (exit 1)",
        });

        const { pi, ctx, handlers, notifyCalls } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;
        await handler({ reason: "startup" }, ctx);
        await new Promise((resolve) => setTimeout(resolve, 10));

        // No notification on failure — silently skipped
        expect(notifyCalls.length).toBe(0);
    });

    it("does NOT throw when warmCache rejects", async () => {
        vi.mocked(warmCache).mockRejectedValue(new Error("unexpected"));

        const { pi, ctx, handlers } = createEventMock();
        register(pi as never);

        const handler = handlers.get("session_start")![0]!;

        // Should not throw — the .catch() in event.ts swallows it
        await expect(handler({ reason: "startup" }, ctx)).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
});
