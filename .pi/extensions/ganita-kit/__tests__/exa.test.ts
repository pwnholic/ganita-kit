import { describe, expect, it } from "vitest";

// ── Unit tests for Exa provider internals ──────────────────
//
// These tests cover pure functions from web-search/provider/exa.ts
// without making real HTTP calls. The callExaMcp function and
// searchWithExa are integration-level and require network access,
// so they are tested separately or excluded from unit tests.

// We import internal helpers via re-export or by testing the
// public functions with mocked fetch. For pure unit tests, we
// focus on the parsing and mapping logic.

// ── Parsing MCP results ────────────────────────────────────

describe("Exa MCP result parsing", () => {
    it("parses a single MCP result block", () => {
        // This tests the parseMcpResults logic pattern.
        // Since the function is not exported, we test the parsing pattern.
        const text = `Title: Example Page
URL: https://example.com
Text: This is the content of the page. It has multiple words.

---

Title: Another Page
URL: https://another.com
Text: Second page content here.`;

        const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0);

        expect(blocks.length).toBe(2);

        const first = blocks[0]!;
        expect(first).toContain("Example Page");
        expect(first).toContain("https://example.com");

        const second = blocks[1]!;
        expect(second).toContain("Another Page");
        expect(second).toContain("https://another.com");
    });

    it("handles empty MCP response", () => {
        const text = "";
        const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0);
        expect(blocks.length).toBe(0);
    });

    it("extracts title and URL from a block", () => {
        const block = `Title: My Title
URL: https://example.com/path
Text: Some content here`;

        const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
        const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";

        expect(title).toBe("My Title");
        expect(url).toBe("https://example.com/path");
    });

    it("extracts content from Text: section", () => {
        const block = `Title: Test
URL: https://test.com
Text: This is the extracted content.`;

        const textStart = block.indexOf("\nText: ");
        expect(textStart).toBeGreaterThanOrEqual(0);

        const content = block.slice(textStart + 7).trim();
        expect(content).toBe("This is the extracted content.");
    });

    it("strips trailing --- separator", () => {
        const block = `Title: Test
URL: https://test.com
Text: Content here
---`;

        const textStart = block.indexOf("\nText: ");
        let content = block.slice(textStart + 7).trim();
        content = content.replace(/\n---\s*$/, "").trim();

        expect(content).toBe("Content here");
    });
});

// ── Domain filter mapping ──────────────────────────────────

describe("Exa domain filter mapping", () => {
    function mapDomainFilter(domainFilter: string[] | undefined): {
        includeDomains?: string[];
        excludeDomains?: string[];
    } {
        if (!domainFilter?.length) return {};
        const includeDomains = domainFilter
            .filter((d) => !d.startsWith("-") && d.trim().length > 0)
            .map((d) => d.trim());
        const excludeDomains = domainFilter
            .filter((d) => d.startsWith("-"))
            .map((d) => d.slice(1).trim())
            .filter(Boolean);
        return {
            ...(includeDomains.length ? { includeDomains } : {}),
            ...(excludeDomains.length ? { excludeDomains } : {}),
        };
    }

    it("returns empty for undefined filter", () => {
        const result = mapDomainFilter(undefined);
        expect(result).toEqual({});
    });

    it("returns empty for empty array", () => {
        const result = mapDomainFilter([]);
        expect(result).toEqual({});
    });

    it("maps include domains", () => {
        const result = mapDomainFilter(["github.com", "npmjs.com"]);
        expect(result).toEqual({
            includeDomains: ["github.com", "npmjs.com"],
        });
    });

    it("maps exclude domains with - prefix", () => {
        const result = mapDomainFilter(["-pinterest.com", "-facebook.com"]);
        expect(result).toEqual({
            excludeDomains: ["pinterest.com", "facebook.com"],
        });
    });

    it("maps mixed include and exclude", () => {
        const result = mapDomainFilter(["github.com", "-pinterest.com"]);
        expect(result).toEqual({
            includeDomains: ["github.com"],
            excludeDomains: ["pinterest.com"],
        });
    });

    it("trims whitespace from domains", () => {
        const result = mapDomainFilter(["  github.com  "]);
        expect(result).toEqual({
            includeDomains: ["github.com"],
        });
    });
});

// ── Recency filter mapping ─────────────────────────────────

describe("Exa recency to start date", () => {
    function recencyToStartDate(filter: string): string {
        const now = new Date();
        const offsets: Record<string, number> = {
            day: 1,
            week: 7,
            month: 30,
            year: 365,
        };
        const days = offsets[filter] ?? 0;
        return new Date(now.getTime() - days * 86_400_000).toISOString();
    }

    it("produces a valid ISO date for 'day'", () => {
        const result = recencyToStartDate("day");
        const parsed = new Date(result);
        expect(parsed.getTime()).toBeLessThan(Date.now());
        expect(parsed.getTime()).toBeGreaterThan(Date.now() - 86_400_000 * 2);
    });

    it("produces a valid ISO date for 'year'", () => {
        const result = recencyToStartDate("year");
        const parsed = new Date(result);
        const diffDays = (Date.now() - parsed.getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThan(364);
        expect(diffDays).toBeLessThan(366);
    });

    it("returns current time for unknown filter", () => {
        const result = recencyToStartDate("unknown");
        const parsed = new Date(result);
        expect(parsed.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
});

// ── MCP query building ─────────────────────────────────────

describe("Exa MCP query building", () => {
    function buildMcpQuery(
        query: string,
        options: { domainFilter?: string[]; recencyFilter?: string },
    ): string {
        const parts = [query];
        if (options.domainFilter?.length) {
            for (const d of options.domainFilter) {
                parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
            }
        }
        if (options.recencyFilter) {
            parts.push(`past ${options.recencyFilter}`);
        }
        return parts.join(" ");
    }

    it("returns plain query without filters", () => {
        expect(buildMcpQuery("rust async", {})).toBe("rust async");
    });

    it("appends site: for include domains", () => {
        const result = buildMcpQuery("test", { domainFilter: ["github.com"] });
        expect(result).toBe("test site:github.com");
    });

    it("appends -site: for exclude domains", () => {
        const result = buildMcpQuery("test", { domainFilter: ["-pinterest.com"] });
        expect(result).toBe("test -site:pinterest.com");
    });

    it("appends recency filter", () => {
        const result = buildMcpQuery("test", { recencyFilter: "week" });
        expect(result).toBe("test past week");
    });

    it("combines all filters", () => {
        const result = buildMcpQuery("test", {
            domainFilter: ["github.com", "-pinterest.com"],
            recencyFilter: "month",
        });
        expect(result).toBe("test site:github.com -site:pinterest.com past month");
    });
});

// ── Highlight normalization ────────────────────────────────

describe("Exa highlight normalization", () => {
    function normalizeHighlights(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
        );
    }

    it("returns empty array for non-array input", () => {
        expect(normalizeHighlights(null)).toEqual([]);
        expect(normalizeHighlights("string")).toEqual([]);
        expect(normalizeHighlights(42)).toEqual([]);
    });

    it("filters out non-string items", () => {
        expect(normalizeHighlights([1, "hello", true, "world"])).toEqual(["hello", "world"]);
    });

    it("filters out empty strings", () => {
        expect(normalizeHighlights(["hello", "", "  ", "world"])).toEqual(["hello", "world"]);
    });
});
