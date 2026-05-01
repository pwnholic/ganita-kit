import { describe, expect, it } from "vitest";
import { register } from "../tools/tldr.js";
import { createMockPi } from "./helpers.js";

/** All tool names registered by tldr in registration order. */
const ALL_TLDR_TOOLS = [
    // L1 — AST
    "tldr_tree",
    "tldr_structure",
    "tldr_extract",
    "tldr_imports",
    "tldr_importers",
    "tldr_definition",
    "tldr_references",
    "tldr_interface",
    "tldr_surface",
    "tldr_inheritance",
    // L2 — Call Graph
    "tldr_calls",
    "tldr_impact",
    "tldr_dead",
    "tldr_whatbreaks",
    "tldr_change_impact",
    "tldr_deps",
    // L3/L4/L5 — CFG/DFG/PDG
    "tldr_reaching_defs",
    "tldr_available",
    "tldr_dead_stores",
    "tldr_slice",
    "tldr_chop",
    // Search
    "tldr_search",
    // Context
    "tldr_context",
    // Quality & Metrics
    "tldr_smells",
    "tldr_complexity",
    "tldr_cognitive",
    "tldr_halstead",
    "tldr_loc",
    "tldr_churn",
    "tldr_debt",
    "tldr_health",
    "tldr_hubs",
    "tldr_patterns",
    "tldr_clones",
    "tldr_dice",
    "tldr_diff",
    "tldr_cohesion",
    "tldr_coupling",
    "tldr_hotspots",
    "tldr_coverage",
    "tldr_todo",
    // Security
    "tldr_taint",
    "tldr_vuln",
    "tldr_secure",
    "tldr_api_check",
    "tldr_resources",
    // Contracts / Specs / Invariants
    "tldr_contracts",
    "tldr_specs",
    "tldr_invariants",
    "tldr_temporal",
    // Verification & Explanation
    "tldr_verify",
    "tldr_explain",
    "tldr_diagnostics",
    "tldr_fix",
    "tldr_bugbot",
    // Infrastructure
    "tldr_warm",
    "tldr_cache_stats",
    "tldr_cache_clear",
    "tldr_daemon_status",
    "tldr_stats",
] as const;

describe("tldr register", () => {
    it(`registers all ${ALL_TLDR_TOOLS.length} tldr tools`, () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const names = [...capture.tools.keys()];
        expect(names).toEqual([...ALL_TLDR_TOOLS]);
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

// Spot-check key tools for correct CLI argument mapping

describe("tldr_tree", () => {
    it("passes path and optional extensions", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_tree")!
            .execute("c1", { path: "src/", ext: ".py,.ts" }, undefined);
        const args = capture.execCalls[0]!.args;
        expect(args).toContain("tree");
        expect(args).toContain("src/");
        expect(args).toContain("-e");
        expect(args).toContain(".py");
        expect(args).toContain("-e");
        expect(args).toContain(".ts");
    });
});

describe("tldr_structure", () => {
    it("calls structure with json format", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: '{"files":[]}' }]]));
        register(pi as never);

        const result = await capture.tools
            .get("tldr_structure")!
            .execute("c2", { path: "src/" }, undefined);
        expect(result.content[0]!.text).toContain("files");
        expect(capture.execCalls[0]!.args).toEqual(["structure", "src/", "-f", "json"]);
    });
});

describe("tldr_impact", () => {
    it("passes function name and path", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: '{"callers":[]}' }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_impact")!
            .execute("c3", { function_name: "parse", path: "src/" }, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["impact", "parse", "src/", "-f", "json"]);
    });
});

describe("tldr_taint", () => {
    it("passes file and function name", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: '{"flows":[]}' }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_taint")!
            .execute("c4", { file: "app.py", function_name: "login" }, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["taint", "app.py", "login", "-f", "json"]);
    });
});

describe("tldr_vuln", () => {
    it("passes severity and vuln_type filters", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "[]" }]]));
        register(pi as never);

        await capture.tools.get("tldr_vuln")!.execute(
            "c5",
            {
                path: "src/",
                severity: "high",
                vuln_type: "sql_injection",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--severity");
        expect(args).toContain("high");
        expect(args).toContain("--vuln-type");
        expect(args).toContain("sql_injection");
    });
});

describe("tldr_slice", () => {
    it("passes file, function, and line", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "[]" }]]));
        register(pi as never);

        await capture.tools.get("tldr_slice")!.execute(
            "c6",
            {
                file: "app.py",
                function_name: "process",
                line: 42,
            },
            undefined,
        );

        expect(capture.execCalls[0]!.args).toEqual([
            "slice",
            "app.py",
            "process",
            "42",
            "-f",
            "json",
        ]);
    });
});

describe("tldr_chop", () => {
    it("passes file, function, source_line, target_line", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "[]" }]]));
        register(pi as never);

        await capture.tools.get("tldr_chop")!.execute(
            "c7",
            {
                file: "app.py",
                function_name: "process",
                source_line: 10,
                target_line: 20,
            },
            undefined,
        );

        expect(capture.execCalls[0]!.args).toEqual([
            "chop",
            "app.py",
            "process",
            "10",
            "20",
            "-f",
            "json",
        ]);
    });
});

describe("tldr_context", () => {
    it("passes entry point and optional path/depth", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "ctx" }]]));
        register(pi as never);

        await capture.tools.get("tldr_context")!.execute(
            "c8",
            {
                entry: "main",
                path: "src/",
                depth: 3,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("context");
        expect(args).toContain("main");
        expect(args).toContain("-p");
        expect(args).toContain("src/");
        expect(args).toContain("-d");
        expect(args).toContain("3");
    });
});

describe("tldr_explain", () => {
    it("passes file, function, and optional depth", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "explain" }]]));
        register(pi as never);

        await capture.tools.get("tldr_explain")!.execute(
            "c9",
            {
                file: "app.py",
                function_name: "handler",
                depth: 2,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("explain");
        expect(args).toContain("handler");
        expect(args).toContain("--depth");
        expect(args).toContain("2");
    });
});

describe("tldr_smells", () => {
    it("passes threshold option", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "[]" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_smells")!
            .execute("c10", { path: "src/", threshold: "strict" }, undefined);
        expect(capture.execCalls[0]!.args).toContain("strict");
    });
});

describe("tldr_clones", () => {
    it("passes min_tokens option", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "[]" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_clones")!
            .execute("c11", { path: "src/", min_tokens: 50 }, undefined);
        expect(capture.execCalls[0]!.args).toContain("50");
    });
});

describe("tldr_coupling", () => {
    it("passes path_a only for project-wide scan", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools.get("tldr_coupling")!.execute("c12", { path_a: "src/" }, undefined);
        expect(capture.execCalls[0]!.args).toContain("coupling");
    });

    it("passes path_a and path_b for pair mode", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_coupling")!
            .execute("c13", { path_a: "src/auth/", path_b: "src/api/" }, undefined);
        const args = capture.execCalls[0]!.args;
        expect(args).toContain("src/auth/");
        expect(args).toContain("src/api/");
    });
});

describe("tldr_dice", () => {
    it("passes two targets", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "0.8" }]]));
        register(pi as never);

        await capture.tools.get("tldr_dice")!.execute(
            "c14",
            {
                target1: "a.py::fn1",
                target2: "b.py::fn2",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("a.py::fn1");
        expect(args).toContain("b.py::fn2");
    });
});

describe("tldr_diff", () => {
    it("passes two file paths", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "diff" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_diff")!
            .execute("c15", { file_a: "a.py", file_b: "b.py" }, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["diff", "a.py", "b.py", "-f", "json"]);
    });
});

describe("tldr_fix", () => {
    it("passes error output to fix diagnose", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "fix" }]]));
        register(pi as never);

        await capture.tools
            .get("tldr_fix")!
            .execute("c16", { error_output: "TypeError: x is not iterable" }, undefined);
        const args = capture.execCalls[0]!.args;
        expect(args).toContain("fix");
        expect(args).toContain("diagnose");
    });
});

describe("tldr infrastructure", () => {
    it("warm calls warm subcommand", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "warmed" }]]));
        register(pi as never);

        await capture.tools.get("tldr_warm")!.execute("c17", { path: "src/" }, undefined);
        expect(capture.execCalls[0]!.args[0]).toBe("warm");
    });

    it("cache_stats calls cache stats", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools.get("tldr_cache_stats")!.execute("c18", {}, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["cache", "stats", "-f", "json"]);
    });

    it("cache_clear calls cache clear", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "cleared" }]]));
        register(pi as never);

        await capture.tools.get("tldr_cache_clear")!.execute("c19", {}, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["cache", "clear", "-f", "json"]);
    });

    it("daemon_status calls daemon status", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools.get("tldr_daemon_status")!.execute("c20", {}, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["daemon", "status", "-f", "json"]);
    });

    it("stats calls stats subcommand", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "{}" }]]));
        register(pi as never);

        await capture.tools.get("tldr_stats")!.execute("c21", {}, undefined);
        expect(capture.execCalls[0]!.args).toEqual(["stats", "-f", "json"]);
    });
});

describe("tldr error handling", () => {
    it("returns isError on non-zero exit", async () => {
        const { pi, capture } = createMockPi(new Map([["tldr", { stdout: "error", exitCode: 1 }]]));
        register(pi as never);

        const result = await capture.tools
            .get("tldr_structure")!
            .execute("err", { path: "bad/" }, undefined);
        expect(result!.isError).toBe(true);
        expect(result!.content[0]!.text).toContain("tldr error");
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
            .get("tldr_structure")!
            .execute("kill", { path: "src/" }, undefined);
        expect(result!.content[0]!.text).toBe("Operation cancelled.");
    });
});
