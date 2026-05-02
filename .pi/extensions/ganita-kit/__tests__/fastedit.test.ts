import { describe, expect, it } from "vitest";
import { register } from "../cli/fastedit.js";
import { createMockPi } from "./helpers.js";

const ALL_TOOL_NAMES = [
    "fast_read",
    "fast_search",
    "fast_diff",
    "fast_edit",
    "fast_batch_edit",
    "fast_multi_edit",
    "fast_delete",
    "fast_move",
    "fast_rename",
    "fast_undo",
    "fast_pull",
];

describe("fastedit register", () => {
    it(`registers all ${ALL_TOOL_NAMES.length} fastedit tools`, () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const names = [...capture.tools.keys()];
        expect(names).toEqual(ALL_TOOL_NAMES);
    });

    it("each tool has name, description, parameters, and execute function", () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        for (const tool of capture.tools.values()) {
            expect(tool.name).toBeTruthy();
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.parameters).toBeDefined();
            expect(typeof tool.execute).toBe("function");
        }
    });
});

describe("fast_read", () => {
    it("calls fastedit read with file path", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "fn foo() {}" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_read")!;
        const result = await tool.execute("r1", { file: "src/main.py" }, undefined);

        expect(result.content[0]!.text).toContain("foo");
        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["read", "src/main.py"]);
    });
});

describe("fast_search", () => {
    it("calls search with query and path", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "found" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_search")!;
        await tool.execute("s1", { query: "parseConfig", path: "src/" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("search");
        expect(args).toContain("parseConfig");
        expect(args).toContain("src/");
    });

    it("passes mode, top_k, regex_filter", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_search")!;
        await tool.execute(
            "s2",
            {
                query: "handler",
                mode: "hybrid",
                top_k: 20,
                regex_filter: ".*Handler.*",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--mode");
        expect(args).toContain("hybrid");
        expect(args).toContain("--top-k");
        expect(args).toContain("20");
        expect(args).toContain("--regex-filter");
        expect(args).toContain(".*Handler.*");
    });
});

describe("fast_edit", () => {
    it("uses default backend=mlx and model_path when no params given", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "edited" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_edit")!;
        await tool.execute(
            "e0",
            { file: "src/app.ts", replace: "handler", snippet: "fn handler() {}" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--backend");
        expect(args).toContain("mlx");
        expect(args).toContain("--model-path");
        expect(args).toContain("fastedit-1.7b-mlx-8bit");
    });

    it("calls edit with replace and snippet", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "edited" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_edit")!;
        await tool.execute(
            "e1",
            {
                file: "src/app.ts",
                replace: "handleRequest",
                snippet: "async function handleRequest() {}",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("edit");
        expect(args).toContain("src/app.ts");
        expect(args).toContain("--replace");
        expect(args).toContain("handleRequest");
        expect(args).toContain("--snippet");
    });

    it("calls edit with after and backend options", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_edit")!;
        await tool.execute(
            "e2",
            {
                file: "src/app.ts",
                after: "main",
                snippet: "function helper() {}",
                backend: "vllm",
                api_base: "http://localhost:8000",
                api_model: "fastedit-1.7b",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--after");
        expect(args).toContain("main");
        expect(args).toContain("--backend");
        expect(args).toContain("vllm");
        expect(args).toContain("--api-base");
        expect(args).toContain("http://localhost:8000");
        expect(args).toContain("--api-model");
        expect(args).toContain("fastedit-1.7b");
    });
});

describe("fast_batch_edit", () => {
    it("calls batch-edit with file and edits JSON", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "ok" }]]));
        register(pi as never);

        const edits = '[{"snippet":"x","replace":"y"}]';
        const tool = capture.tools.get("fast_batch_edit")!;
        await tool.execute("be1", { file: "src/app.ts", edits }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("batch-edit");
        expect(args).toContain("--edits");
        expect(args).toContain(edits);
    });

    it("passes backend args", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_batch_edit")!;
        await tool.execute(
            "be2",
            {
                file: "a.ts",
                edits: "[]",
                backend: "mlx",
                model_path: "/models/fastedit",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--backend");
        expect(args).toContain("mlx");
        expect(args).toContain("--model-path");
        expect(args).toContain("/models/fastedit");
    });
});

describe("fast_multi_edit", () => {
    it("calls multi-edit with file_edits JSON", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "ok" }]]));
        register(pi as never);

        const fileEdits = '[{"file_path":"a.ts","edits":[]}]';
        const tool = capture.tools.get("fast_multi_edit")!;
        await tool.execute("me1", { file_edits: fileEdits }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("multi-edit");
        expect(args).toContain("--file-edits");
        expect(args).toContain(fileEdits);
    });
});

describe("fast_delete", () => {
    it("calls delete with file and symbol", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "deleted" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_delete")!;
        await tool.execute("d1", { file: "src/app.ts", symbol: "oldHandler" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["delete", "src/app.ts", "oldHandler"]);
    });
});

describe("fast_move", () => {
    it("calls move with file, symbol, and after", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "moved" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_move")!;
        await tool.execute(
            "m1",
            { file: "src/app.ts", symbol: "helper", after: "main" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("move");
        expect(args).toContain("--after");
        expect(args).toContain("main");
    });
});

describe("fast_rename", () => {
    it("calls rename with file, old_name, new_name", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "renamed" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_rename")!;
        await tool.execute(
            "rn1",
            { file: "src/app.ts", old_name: "foo", new_name: "bar" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["rename", "src/app.ts", "foo", "bar"]);
    });
});

describe("fast_diff", () => {
    it("calls diff with file", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "diff output" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_diff")!;
        await tool.execute("df1", { file: "src/app.ts" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["diff", "src/app.ts"]);
    });
});

describe("fast_undo", () => {
    it("calls undo with file", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "reverted" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_undo")!;
        await tool.execute("u1", { file: "src/app.ts" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["undo", "src/app.ts"]);
    });
});

describe("fast_pull", () => {
    it("calls pull without model", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "downloaded" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_pull")!;
        await tool.execute("p1", {}, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toEqual(["pull"]);
    });

    it("calls pull with model name", async () => {
        const { pi, capture } = createMockPi(new Map([["fastedit", { stdout: "downloaded" }]]));
        register(pi as never);

        const tool = capture.tools.get("fast_pull")!;
        await tool.execute("p2", { model: "fastedit-1.7b-mlx-8bit" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--model");
        expect(args).toContain("fastedit-1.7b-mlx-8bit");
    });
});

describe("fastedit error handling", () => {
    it("returns isError on non-zero exit", async () => {
        const { pi, capture } = createMockPi(
            new Map([["fastedit", { stdout: "error", exitCode: 1 }]]),
        );
        register(pi as never);

        const tool = capture.tools.get("fast_read")!;
        const result = await tool.execute("err", { file: "bad.py" }, undefined);
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("fastedit error");
    });

    it("returns cancellation when killed", async () => {
        const killedCapture = { tools: new Map(), execCalls: [] };
        const killedPi = {
            registerTool(tool: unknown) {
                killedCapture.tools.set((tool as { name: string }).name, tool);
            },
            async exec() {
                return { stdout: "", stderr: "", code: 0, killed: true };
            },
        };
        register(killedPi as never);

        const result = await killedCapture.tools
            .get("fast_read")!
            .execute("kill", { file: "src/main.py" }, undefined);
        expect(result!.content[0]!.text).toBe("Operation cancelled.");
    });
});
