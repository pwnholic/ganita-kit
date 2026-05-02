import { describe, expect, it } from "vitest";
import { register } from "../cli/webclaw.js";
import { createMockPi } from "./helpers.js";

const ALL_TOOL_NAMES = [
    "webclaw_scrape",
    "webclaw_batch",
    "webclaw_crawl",
    "webclaw_map",
    "webclaw_extract",
    "webclaw_brand",
    "webclaw_vertical",
    "webclaw_extractors",
    "webclaw_research",
    "webclaw_summarize",
    "webclaw_diff",
    "webclaw_watch",
    "webclaw_bench",
];

describe("webclaw register", () => {
    it(`registers all ${ALL_TOOL_NAMES.length} webclaw tools`, () => {
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

describe("webclaw_scrape", () => {
    it("calls webclaw with url, llm format, and --only-main-content by default", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "# Hello\nWorld" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        const result = await tool.execute("c1", { url: "https://example.com" }, undefined);

        expect(result.content[0]!.text).toContain("Hello");
        expect(result.isError).toBeFalsy();

        const call = capture.execCalls[0]!;
        expect(call.command).toBe("webclaw");
        expect(call.args).toContain("https://example.com");
        expect(call.args).toContain("-f");
        expect(call.args).toContain("llm");
        expect(call.args).toContain("--only-main-content");
    });

    it("passes custom format, selectors, proxy, browser, metadata", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "{}" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        await tool.execute(
            "c2",
            {
                url: "https://example.com",
                format: "json",
                only_main_content: false,
                include_selectors: "article,.content",
                exclude_selectors: "nav,.sidebar",
                metadata: true,
                proxy: "http://proxy:8080",
                browser: "firefox",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("json");
        expect(args).not.toContain("--only-main-content");
        expect(args).toContain("--include");
        expect(args).toContain("article,.content");
        expect(args).toContain("--exclude");
        expect(args).toContain("nav,.sidebar");
        expect(args).toContain("--metadata");
        expect(args).toContain("-p");
        expect(args).toContain("http://proxy:8080");
        expect(args).toContain("-b");
        expect(args).toContain("firefox");
    });

    it("passes pdf_mode, timeout, header, cookie, cookie_file", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        await tool.execute(
            "c2b",
            {
                url: "https://example.com/doc.pdf",
                pdf_mode: "fast",
                timeout: 60,
                header: "X-Custom: test",
                cookie: "session=abc",
                cookie_file: "/tmp/cookies.json",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--pdf-mode");
        expect(args).toContain("fast");
        expect(args).toContain("-t");
        expect(args).toContain("60");
        expect(args).toContain("-H");
        expect(args).toContain("X-Custom: test");
        expect(args).toContain("--cookie");
        expect(args).toContain("session=abc");
        expect(args).toContain("--cookie-file");
        expect(args).toContain("/tmp/cookies.json");
    });

    it("uses --file flag for local file extraction", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "local content" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        await tool.execute("c2c", { file: "/tmp/page.html" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--file");
        expect(args).toContain("/tmp/page.html");
    });

    it("uses --stdin flag", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "stdin content" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        await tool.execute("c2d", { stdin: true }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--stdin");
    });

    it("passes raw_html, verbose, cloud, output_dir flags", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        await tool.execute(
            "c2e",
            {
                url: "https://example.com",
                raw_html: true,
                verbose: true,
                cloud: true,
                output_dir: "/tmp/out",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--raw-html");
        expect(args).toContain("-v");
        expect(args).toContain("--cloud");
        expect(args).toContain("--output-dir");
        expect(args).toContain("/tmp/out");
    });

    it("returns isError on non-zero exit", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "", exitCode: 1 }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        const result = await tool.execute("c3", { url: "https://fail.com" }, undefined);
        expect(result.isError).toBe(true);
    });
});

describe("webclaw_batch", () => {
    it("passes multiple URLs and defaults to json format", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "[{}]" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_batch")!;
        await tool.execute("b1", { urls: ["https://a.com", "https://b.com"] }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("https://a.com");
        expect(args).toContain("https://b.com");
        expect(args).toContain("-f");
        expect(args).toContain("json");
        expect(args).toContain("--only-main-content");
    });

    it("uses --urls-file when provided", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_batch")!;
        await tool.execute("b2", { urls_file: "/tmp/urls.txt" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--urls-file");
        expect(args).toContain("/tmp/urls.txt");
    });

    it("passes pdf_mode and shared options", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_batch")!;
        await tool.execute(
            "b3",
            {
                urls: ["https://example.com/doc.pdf"],
                pdf_mode: "auto",
                proxy: "socks5://proxy:1080",
                verbose: true,
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--pdf-mode");
        expect(args).toContain("auto");
        expect(args).toContain("-p");
        expect(args).toContain("socks5://proxy:1080");
        expect(args).toContain("-v");
    });
});

describe("webclaw_crawl", () => {
    it("calls with --crawl and defaults", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "crawled" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_crawl")!;
        await tool.execute("c4", { url: "https://docs.example.com" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--crawl");
    });

    it("passes all crawl options including crawl_state", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_crawl")!;
        await tool.execute(
            "c5",
            {
                url: "https://docs.example.com",
                depth: 5,
                max_pages: 200,
                concurrency: 10,
                delay: 50,
                path_prefix: "/api/",
                sitemap: true,
                crawl_state: "/tmp/crawl-state.json",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--depth");
        expect(args).toContain("5");
        expect(args).toContain("--max-pages");
        expect(args).toContain("200");
        expect(args).toContain("--concurrency");
        expect(args).toContain("10");
        expect(args).toContain("--delay");
        expect(args).toContain("50");
        expect(args).toContain("--path-prefix");
        expect(args).toContain("/api/");
        expect(args).toContain("--sitemap");
        expect(args).toContain("--crawl-state");
        expect(args).toContain("/tmp/crawl-state.json");
    });
});

describe("webclaw_map", () => {
    it("calls with --map and json format", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_map")!;
        await tool.execute("c6", { url: "https://example.com" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--map");
        expect(args).toContain("-f");
        expect(args).toContain("json");
    });
});

describe("webclaw_extract", () => {
    it("calls with --extract-prompt", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: '{"data":1}' }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_extract")!;
        await tool.execute("c7", { url: "https://shop.com", prompt: "prices" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--extract-prompt");
        expect(args).toContain("prices");
    });

    it("calls with --extract-json when schema provided", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "{}" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_extract")!;
        await tool.execute(
            "c7b",
            { url: "https://shop.com", json_schema: '{"type":"object"}' },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--extract-json");
        expect(args).toContain('{"type":"object"}');
    });
});

describe("webclaw_brand", () => {
    it("calls with --brand flag", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: '{"name":"X"}' }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_brand")!;
        await tool.execute("c8", { url: "https://example.com" }, undefined);

        expect(capture.execCalls[0]!.args).toContain("--brand");
    });
});

describe("webclaw_vertical", () => {
    it("calls vertical subcommand", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: '{"price":99}' }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_vertical")!;
        await tool.execute(
            "c13",
            { extractor: "amazon_product", url: "https://amazon.com/dp/123" },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args[0]).toBe("vertical");
        expect(args).toContain("amazon_product");
    });
});

describe("webclaw_extractors", () => {
    it("calls extractors subcommand", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "[]" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_extractors")!;
        await tool.execute("c14", {}, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args[0]).toBe("extractors");
    });
});

describe("webclaw_research", () => {
    it("calls with --research and topic", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "report" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_research")!;
        await tool.execute("c9", { topic: "Rust vs Go performance" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--research");
        expect(args).toContain("Rust vs Go performance");
    });

    it("passes --deep flag", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "deep report" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_research")!;
        await tool.execute("c9b", { topic: "quantum computing", deep: true }, undefined);

        expect(capture.execCalls[0]!.args).toContain("--deep");
    });
});

describe("webclaw_summarize", () => {
    it("calls with --summarize and sentence count", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "Summary" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_summarize")!;
        await tool.execute("c10", { url: "https://example.com", sentences: 5 }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--summarize");
        expect(args).toContain("5");
    });
});

describe("webclaw_diff", () => {
    it("calls with --diff-with", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "diff" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_diff")!;
        await tool.execute(
            "c11",
            { url: "https://example.com", snapshot: '{"title":"old"}' },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--diff-with");
        expect(args).toContain('{"title":"old"}');
    });
});

describe("webclaw_watch", () => {
    it("calls with --watch and interval", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "watching" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_watch")!;
        await tool.execute("c12", { url: "https://example.com", interval: 60 }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--watch");
        expect(args).toContain("--watch-interval");
        expect(args).toContain("60");
    });

    it("passes webhook and on_change options", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "ok" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_watch")!;
        await tool.execute(
            "c12b",
            {
                url: "https://example.com",
                webhook: "https://hooks.example.com/notify",
                on_change: "echo changed",
            },
            undefined,
        );

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--webhook");
        expect(args).toContain("https://hooks.example.com/notify");
        expect(args).toContain("--on-change");
        expect(args).toContain("echo changed");
    });
});

describe("webclaw_bench", () => {
    it("calls bench subcommand with url", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "bench data" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_bench")!;
        await tool.execute("b1", { url: "https://example.com" }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args[0]).toBe("bench");
        expect(args).toContain("https://example.com");
    });

    it("passes --json flag", async () => {
        const { pi, capture } = createMockPi(new Map([["webclaw", { stdout: "{}" }]]));
        register(pi as never);

        const tool = capture.tools.get("webclaw_bench")!;
        await tool.execute("b2", { url: "https://example.com", json: true }, undefined);

        const args = capture.execCalls[0]!.args;
        expect(args).toContain("--json");
    });
});

describe("webclaw error handling", () => {
    it("returns isError on non-zero exit", async () => {
        const { pi, capture } = createMockPi(
            new Map([["webclaw", { stdout: "error", exitCode: 1 }]]),
        );
        register(pi as never);

        const tool = capture.tools.get("webclaw_scrape")!;
        const result = await tool.execute("err", { url: "https://fail.com" }, undefined);
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("webclaw error");
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
            .get("webclaw_scrape")!
            .execute("kill", { url: "https://example.com" }, undefined);
        expect(result!.content[0]!.text).toBe("Operation cancelled.");
    });
});
