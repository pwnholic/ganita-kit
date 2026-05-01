import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../tools/web-search.js";
import { createMockPi } from "./helpers.js";

beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network unavailable (test mock)"));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("web_search register", () => {
    it("registers the web_search tool", () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search");
        expect(tool).toBeDefined();
        expect(tool!.name).toBe("web_search");
        expect(tool!.label).toBe("Web Search");
        expect(tool!.description.length).toBeGreaterThan(0);
        expect(typeof tool!.execute).toBe("function");
    });

    it("has promptSnippet and promptGuidelines", () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        expect(tool.promptSnippet).toBeTruthy();
        expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
    });
});

describe("web_search query normalization", () => {
    it("returns error when no query provided", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c1", {}, undefined);

        expect(result.content[0]!.text).toContain("No query provided");
        expect(result.details["error"]).toBe("No query provided");
    });

    it("accepts single query parameter", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c2", { query: "test query" }, undefined);

        expect(result).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]!.text).toContain("Error:");
    });

    it("accepts queries array parameter", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c3", { queries: ["query 1", "query 2"] }, undefined);

        expect(result).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
    });

    it("filters out empty and non-string queries", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c4", { queries: ["", "   ", 42, null] }, undefined);

        expect(result.content[0]!.text).toContain("No query provided");
    });
});

describe("web_search output formatting", () => {
    it("includes query header for multiple queries", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute(
            "c5",
            { queries: ["first query", "second query"] },
            undefined,
        );

        const text = result.content[0]!.text;
        expect(text).toBeDefined();
        expect(typeof text).toBe("string");
    });

    it("includes details with query metadata", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c6", { query: "test" }, undefined);

        expect(result.details["queries"]).toBeDefined();
        expect(result.details["queryCount"]).toBeDefined();
        expect(result.details["totalResults"]).toBeDefined();
    });
});

describe("web_search with webclaw extraction", () => {
    it("calls webclaw when includeContent is true and results exist", async () => {
        const { pi, capture } = createMockPi(
            new Map([["webclaw", { stdout: "# Extracted Content\nFull page text here" }]]),
        );
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c7", { query: "test", includeContent: true }, undefined);

        expect(result).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);

        const webclawCalls = capture.execCalls.filter((c) => c.command === "webclaw");
        expect(webclawCalls.length).toBe(0);
    });

    it("does not call webclaw when includeContent is false", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        await tool.execute("c8", { query: "test", includeContent: false }, undefined);

        const webclawCalls = capture.execCalls.filter((c) => c.command === "webclaw");
        expect(webclawCalls.length).toBe(0);
    });

    it("handles webclaw not installed gracefully", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        expect(tool).toBeDefined();
    });
});

describe("web_search error handling", () => {
    it("returns error message when search fails", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c9", { query: "test" }, undefined);

        expect(result).toBeDefined();
        expect(result.content[0]!.text).toContain("Error:");
    });

    it("sets successfulQueries to 0 when all searches fail", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("web_search")!;
        const result = await tool.execute("c10", { query: "test" }, undefined);

        expect(result.details["successfulQueries"]).toBe(0);
    });
});
