/**
 * Discriminated union for fallible operations.
 * Use instead of throwing for expected failure cases.
 */
export type Result<T, E = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };
