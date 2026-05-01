import type http from "node:http";
import type { SummaryMeta } from "./search.js";

/** State machine for the curator server lifecycle. */
export type CuratorServerState = "SEARCHING" | "RESULT_SELECTION" | "COMPLETED";

/** Options for starting a curator server. */
export interface CuratorServerOptions {
	queries: string[];
	sessionToken: string;
	timeout: number;
	defaultProvider: string;
}

/** Callbacks for curator server events. */
export interface CuratorServerCallbacks {
	onSubmit: (payload: {
		selectedQueryIndices: number[];
		summary?: string;
		summaryMeta?: SummaryMeta;
		rawResults?: boolean;
	}) => void;
	onCancel: (reason: "user" | "timeout" | "stale") => void;
	onProviderChange: (provider: string) => void;
	onAddSearch: (
		query: string,
		queryIndex: number,
		provider?: string,
	) => Promise<{
		answer: string;
		results: Array<{ title: string; url: string; domain: string }>;
		provider: string;
	}>;
	onSummarize: (
		selectedQueryIndices: number[],
		signal: AbortSignal,
		model?: string,
		feedback?: string,
	) => Promise<{ summary: string; meta: SummaryMeta }>;
	onRewriteQuery: (query: string, signal: AbortSignal) => Promise<string>;
}

/** Handle for controlling a curator server. */
export interface CuratorServerHandle {
	server: http.Server;
	url: string;
	close: () => void;
	pushResult: (
		queryIndex: number,
		data: {
			answer: string;
			results: Array<{ title: string; url: string; domain: string }>;
			provider: string;
		},
	) => void;
	pushError: (queryIndex: number, error: string, provider?: string) => void;
	searchesDone: () => void;
}
