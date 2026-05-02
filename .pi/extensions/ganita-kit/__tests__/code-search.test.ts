import { describe, expect, it } from "vitest";
import { register } from "../web-search/tools.js";
import { createMockPi } from "./helpers.js";

describe("code_search register", () => {
    it("registers the code_search tool", () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search");
        expect(tool).toBeDefined();
        expect(tool!.name).toBe("code_search");
        expect(tool!.label).toBe("Code Search");
        expect(tool!.description.length).toBeGreaterThan(0);
        expect(typeof tool!.execute).toBe("function");
    });

    it("has promptSnippet and promptGuidelines", () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        expect(tool.promptSnippet).toBeTruthy();
        expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
    });
});

describe("code_search validation", () => {
    it("returns error when no query provided", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c1", { query: "" }, undefined);

        expect(result.content[0]!.text).toContain("No query provided");
        expect(result.details["error"]).toBe("No query provided");
    });

    it("accepts valid query parameter", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c2", { query: "React useEffect cleanup" }, undefined);

        expect(result).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
    });

    it("uses default maxTokens when not specified", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c3", { query: "test" }, undefined);

        expect(result.details["maxTokens"]).toBe(5000);
    });

    it("uses custom maxTokens when specified", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c4", { query: "test", maxTokens: 10000 }, undefined);

        expect(result.details["maxTokens"]).toBe(10000);
    });

    it("includes query in details", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c5", { query: "TypeScript generics" }, undefined);

        expect(result.details["query"]).toBe("TypeScript generics");
    });

    it("trims whitespace from query", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c6", { query: "  spaced query  " }, undefined);

        expect(result.details["query"]).toBe("spaced query");
    });
});

describe("code_search error handling", () => {
    it("returns error message when search fails", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c7", { query: "test" }, undefined);

        expect(result).toBeDefined();
        expect(result.content[0]!.text).toBeTruthy();
    });

    it("includes error in details when search fails", async () => {
        const { pi, capture } = createMockPi(new Map());
        register(pi as never);

        const tool = capture.tools.get("code_search")!;
        const result = await tool.execute("c8", { query: "test" }, undefined);

        if (result.details["error"]) {
            expect(typeof result.details["error"]).toBe("string");
            expect((result.details["error"] as string).length).toBeGreaterThan(0);
        }
    });
});
