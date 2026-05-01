import { describe, expect, it } from "vitest";
import { register } from "../tools/bloks.js";
import { createMockPi } from "./helpers.js";

const ALL_TOOL_NAMES = [
    "bloks_add",
    "bloks_add_local",
    "bloks_remove",
    "bloks_refresh",
    "bloks_reindex",
    "bloks_index_url",
    "bloks_card",
    "bloks_deck",
    "bloks_modules",
    "bloks_search",
    "bloks_recipe",
    "bloks_context",
    "bloks_learn",
    "bloks_new",
    "bloks_cards",
    "bloks_report",
    "bloks_feedback",
    "bloks_ack",
    "bloks_nack",
    "bloks_stats",
    "bloks_list",
    "bloks_info",
];

describe("bloks register", () => {
    it(`registers all ${ALL_TOOL_NAMES.length} bloks tools`, () => {
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

describe("bloks_add", () => {
    it("passes package name, registry, docs, force", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: '{"status":"ok"}' }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_add")!;
        await tool.execute(
            "a1",
            {
                names: "react react-dom",
                registry: "npm",
                docs: "https://react.dev/docs",
                force: true,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("add");
        expect(args).toContain("react");
        expect(args).toContain("react-dom");
        expect(args).toContain("--registry");
        expect(args).toContain("npm");
        expect(args).toContain("--docs");
        expect(args).toContain("https://react.dev/docs");
        expect(args).toContain("--force");
    });
});

describe("bloks_card", () => {
    it("passes library, symbol, module, level, all", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: '{"card":{}}' }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_card")!;
        await tool.execute(
            "c1",
            {
                library: "react",
                symbol: "useState",
                module: "hooks",
                level: "docs",
                all: true,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("card");
        expect(args).toContain("react");
        expect(args).toContain("--symbol");
        expect(args).toContain("useState");
        expect(args).toContain("--module");
        expect(args).toContain("hooks");
        expect(args).toContain("--level");
        expect(args).toContain("docs");
        expect(args).toContain("--all");
    });

    it("minimal call with just library", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: '{"card":{}}' }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_card")!;
        await tool.execute("c2", { library: "react" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("card");
        expect(args).toContain("react");
        expect(args).not.toContain("--symbol");
    });
});

describe("bloks_search", () => {
    it("passes query, library, kind, path, limit", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_search")!;
        await tool.execute(
            "s1",
            {
                query: "middleware auth",
                library: "express",
                kind: "api",
                path: "src/middleware",
                limit: 5,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("search");
        expect(args).toContain("middleware auth");
        expect(args).toContain("--lib");
        expect(args).toContain("express");
        expect(args).toContain("--kind");
        expect(args).toContain("api");
        expect(args).toContain("--path");
        expect(args).toContain("src/middleware");
        expect(args).toContain("--limit");
        expect(args).toContain("5");
    });
});

describe("bloks_recipe", () => {
    it("passes library, keywords, limit", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "{}" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_recipe")!;
        await tool.execute(
            "r1",
            { library: "express", keywords: ["auth", "jwt"], limit: 3 },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("recipe");
        expect(args).toContain("express");
        expect(args).toContain("auth");
        expect(args).toContain("jwt");
        expect(args).toContain("--limit");
        expect(args).toContain("3");
    });
});

describe("bloks_context", () => {
    it("passes path, budget, project", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "context" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_context")!;
        await tool.execute("ctx1", { path: "/project", budget: 100, project: "myapp" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("context");
        expect(args).toContain("/project");
        expect(args).toContain("--budget");
        expect(args).toContain("100");
        expect(args).toContain("--project");
        expect(args).toContain("myapp");
    });
});

describe("bloks_learn", () => {
    it("passes library, note, kind", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: '{"ok":true}' }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_learn")!;
        await tool.execute(
            "l1",
            { library: "react", note: "useState returns an array", kind: "fact" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("learn");
        expect(args).toContain("react");
        expect(args).toContain("--kind");
        expect(args).toContain("fact");
    });
});

describe("bloks_new", () => {
    it("passes kind, title, tags, from", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: '{"ok":true}' }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_new")!;
        await tool.execute(
            "n1",
            {
                kind: "rule",
                title: "Always use const",
                tags: "style,eslint",
                from: "/tmp/rule.md",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("new");
        expect(args).toContain("rule");
        expect(args).toContain("Always use const");
        expect(args).toContain("--tags");
        expect(args).toContain("style,eslint");
        expect(args).toContain("--from");
        expect(args).toContain("/tmp/rule.md");
    });
});

describe("bloks_cards", () => {
    it("passes tag, kind, history filters", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_cards")!;
        await tool.execute(
            "cards1",
            { tag: "auth", kind: "correction", history: "card-123" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--tag");
        expect(args).toContain("auth");
        expect(args).toContain("--kind");
        expect(args).toContain("correction");
        expect(args).toContain("--history");
        expect(args).toContain("card-123");
    });
});

describe("bloks_report", () => {
    it("passes library, error_type, description", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "reported" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_report")!;
        await tool.execute(
            "rep1",
            {
                library: "react",
                error_type: "deprecated_api",
                description: "componentWillMount is removed",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("report");
        expect(args).toContain("react");
        expect(args).toContain("deprecated_api");
        expect(args).toContain("componentWillMount is removed");
    });
});

describe("bloks_ack", () => {
    it("passes card IDs", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "acked" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_ack")!;
        await tool.execute("ack1", { card_ids: ["c1", "c2"] }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("ack");
        expect(args).toContain("c1");
        expect(args).toContain("c2");
    });

    it("passes session flag", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "acked" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_ack")!;
        await tool.execute("ack2", { session: "sess-abc" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--session");
        expect(args).toContain("sess-abc");
    });
});

describe("bloks_nack", () => {
    it("passes card IDs and session", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "nacked" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_nack")!;
        await tool.execute("nack1", { card_ids: ["c3"], session: "sess-xyz" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("nack");
        expect(args).toContain("c3");
        expect(args).toContain("--session");
        expect(args).toContain("sess-xyz");
    });
});

describe("bloks_stats", () => {
    it("passes library and limit", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_stats")!;
        await tool.execute("stat1", { library: "react", limit: 5 }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("stats");
        expect(args).toContain("--lib");
        expect(args).toContain("react");
        expect(args).toContain("--limit");
        expect(args).toContain("5");
    });
});

describe("bloks_refresh", () => {
    it("passes library and stale flag", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "refreshed" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_refresh")!;
        await tool.execute("ref1", { library: "react", stale: true }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("refresh");
        expect(args).toContain("react");
        expect(args).toContain("--stale");
    });
});

describe("bloks_reindex", () => {
    it("calls reindex command", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "reindexed" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_reindex")!;
        await tool.execute("ri1", {}, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("reindex");
    });
});

describe("bloks_index_url", () => {
    it("passes library and multiple URLs", async () => {
        const { pi, capture } = createMockPi(new Map([["bloks", { stdout: "indexed" }]]));
        register(pi as never);

        const tool = capture.tools.get("bloks_index_url")!;
        await tool.execute(
            "iu1",
            {
                library: "react",
                urls: ["https://react.dev/docs/hooks", "https://react.dev/docs/refs"],
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("index-url");
        expect(args).toContain("react");
        expect(args).toContain("https://react.dev/docs/hooks");
        expect(args).toContain("https://react.dev/docs/refs");
    });
});

describe("bloks error handling", () => {
    it("returns isError on non-zero exit", async () => {
        const { pi, capture } = createMockPi(
            new Map([["bloks", { stdout: "error", exitCode: 1 }]]),
        );
        register(pi as never);

        const tool = capture.tools.get("bloks_list")!;
        const result = await tool.execute("err", {}, undefined);
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("bloks error");
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

        const result = await killedCapture.tools.get("bloks_list")!.execute("kill", {}, undefined);
        expect(result!.content[0]!.text).toBe("Operation cancelled.");
    });
});
