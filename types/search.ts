/** A single search result from a search provider. */
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/** Response from a search query. */
export interface SearchResponse {
    answer: string;
    results: SearchResult[];
}

/** Options for search operations. */
export interface SearchOptions {
    numResults?: number;
    recencyFilter?: "day" | "week" | "month" | "year";
    domainFilter?: string[];
    signal?: AbortSignal;
}

/** Extended options that include content extraction via webclaw. */
export interface ExaSearchOptions extends SearchOptions {
    includeContent?: boolean;
}

/** Metadata about a generated summary. */
export interface SummaryMeta {
    model: string | null;
    durationMs: number;
    tokenEstimate: number;
    fallbackUsed: boolean;
    fallbackReason?: string;
    edited?: boolean;
}

/** Data for a single query result in the curator. */
export interface QueryResultData {
    query: string;
    answer: string;
    results: Array<{ title: string; url: string }>;
    error: string | null;
    provider?: string;
}
