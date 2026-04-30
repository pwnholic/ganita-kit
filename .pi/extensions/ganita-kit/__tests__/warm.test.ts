import { describe, expect, it } from "vitest";
import { register, warmCache } from "../commands/tldr.js";
import { createMockPi } from "./helpers.js";

describe("warmCache", () => {
    it("returns ok with output on success", async () => {
        const { pi } = createMockPi(
            new Map([
                [
                    "tldr",
                    {
                        stdout: '{"status":"ok","files":5,"edges":12}',
                    },
                ],
            ]),
        );

        const result = await warmCache(pi as never, "/project/src");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output).toContain('"status":"ok"');
            expect(result.output).toContain('"files":5');
        }
    });

    it("passes correct args to exec", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: '{"status":"ok"}' }]]));

        await warmCache(pi as never, "/my/project");

        expect(capture.execCalls.length).toBe(1);
        const call = capture.execCalls[0]!;
        expect(call.command).toBe("tldr");
        expect(call.args).toEqual(["warm", "/my/project", "-f", "json", "-q"]);
    });

    it("truncates output longer than 500 chars", async () => {
        const longOutput = "x".repeat(600);
        const { pi } = createMockPi(new Map([["tldr", { stdout: longOutput }]]));

        const result = await warmCache(pi as never, "/project");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output.length).toBeLessThan(600);
            expect(result.output).toContain("...");
        }
    });

    it("returns error on non-zero exit code", async () => {
        const { pi } = createMockPi(new Map([["tldr", { stdout: "", exitCode: 1 }]]));

        const result = await warmCache(pi as never, "/project");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("tldr warm failed");
            expect(result.error).toContain("exit 1");
        }
    });

    it("returns error when tldr binary not found", async () => {
        const { pi } = createMockPi(new Map());

        const result = await warmCache(pi as never, "/project");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("tldr warm failed");
        }
    });
});

describe("tldr register (warm-related)", () => {
    it("registers tldr_warm tool", () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "" }]]));
        register(pi as never);

        const tool = capture.tools.get("tldr_warm");
        expect(tool).toBeDefined();
        expect(tool!.description).toContain("cache");
    });

    it("tldr_warm tool passes path to exec", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: '{"status":"ok"}' }]]));
        register(pi as never);

        const tool = capture.tools.get("tldr_warm")!;
        await tool.execute("w1", { path: "src/" }, undefined);

        const call = capture.execCalls[0]!;
        expect(call.args).toContain("warm");
        expect(call.args).toContain("src/");
    });
});
