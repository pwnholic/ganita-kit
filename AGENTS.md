# AGENTS.md

Coding guidelines for all TypeScript files inside `pi/extensions/`.
Every agent or contributor writing or modifying code must follow these rules without exception.

---

## When You Are Unsure

Before writing any code, if you are unsure about how PI works, how an extension hook behaves,
or what a type expects — stop and read the documentation first.

Documentation is located in `docs/pi/`:

| File                  | Read when you need to understand...                  |
| --------------------- | ---------------------------------------------------- |
| `sdk.md`              | Core PI SDK, available APIs, lifecycle hooks         |
| `extensions.md`       | How extensions are structured and registered         |
| `sessions.md`         | Session lifecycle, state, and persistence            |
| `session-format.md`   | Shape of session objects passed through the system   |
| `settings.md`         | How user and extension settings are read and written |
| `packages.md`         | Available built-in packages and how to import them   |
| `prompt-templates.md` | How to write and inject prompt templates             |
| `skills.md`           | Skill format, registration, and invocation           |
| `compaction.md`       | How PI compacts context and what survives compaction |
| `json.md`             | JSON transport format between PI and extensions      |
| `tui.md`              | Terminal UI primitives available to extensions       |
| `themes.md`           | Theme tokens available for UI components             |

Do not guess. Do not assume. Read the relevant doc, then write the code.

If documentation does not answer your question, add a comment in the code explaining
what you assumed and why, so a human can verify it later.

---

## 1. Core Principles

- Explicitness over cleverness. Code must be readable on first pass.
- Type-safe everywhere. No `any`. No `as unknown as X` without a comment explaining why.
- One responsibility per file. Each file has one clear purpose.
- Fail loudly. Never silence errors. Throw or return a typed `Result`. Do not swallow exceptions.
- No magic. Avoid implicit behavior, dynamic keys, or runtime type coercion without documentation.

---

## 2. TypeScript Rules

### 2.1 Strict Mode

The project runs with `strict: true` plus additional checks. Never disable them.

```ts
// Wrong
const value: any = getData();

// Wrong — suppressing the error without explanation
// @ts-ignore
doSomething(value);

// Correct
const value: SessionData = getData();
```

### 2.2 No Implicit Any

All function parameters and return types must be explicitly annotated.

```ts
// Wrong
function process(data) {
  return data.result;
}

// Correct
function process(data: CommandInput): CommandResult {
  return data.result;
}
```

### 2.3 Import Types Explicitly

Use `import type` for anything that is only needed at compile time.
This is required by `verbatimModuleSyntax` in tsconfig.

```ts
// Wrong
import { CommandHandler, runCommand } from "@commands/base";

// Correct — type-only import separated
import type { CommandHandler } from "@types/commands";
import { runCommand } from "@commands/base";
```

### 2.4 Avoid Type Assertions

Only use `as` when you have verified the shape at runtime and there is no better option.
Always leave a comment when you do.

```ts
// Wrong
const config = getConfig() as ExtensionConfig;

// Correct — assertion justified after runtime check
if (!isExtensionConfig(response)) {
  throw new Error("getConfig returned unexpected shape");
}
// Shape verified by isExtensionConfig guard above
const config = response as ExtensionConfig;
```

### 2.5 Use `Result` Pattern for Fallible Operations

Do not throw for expected failure cases. Return a discriminated union instead.

```ts
type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

// Usage
function parseConfig(raw: unknown): Result<ExtensionConfig> {
  if (!isValid(raw)) {
    return { ok: false, error: "Invalid config shape" };
  }
  return { ok: true, value: raw as ExtensionConfig };
}
```

Reserve `throw` for truly unexpected errors (programming errors, invariant violations).

---

## 3. Naming Conventions

| Construct          | Convention           | Example                        |
| ------------------ | -------------------- | ------------------------------ |
| Files              | kebab-case           | `web-search.ts`                |
| Variables          | camelCase            | `sessionData`                  |
| Functions          | camelCase            | `parseConfig()`                |
| Classes            | PascalCase           | `CommandRegistry`              |
| Types / Interfaces | PascalCase           | `CommandHandler`, `SessionMap` |
| Constants          | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT`              |
| Path aliases       | @-prefixed           | `@commands/bloks`              |

Interface names must not be prefixed with `I`. Use `CommandHandler`, not `ICommandHandler`.

---

## 4. Inline Comments

Use inline comments only for logic that is not obvious from the code itself.
Do not comment what the code does. Comment why it does it.

### When to add a comment

- Complex algorithm or non-trivial control flow.
- A workaround for a PI SDK limitation or known bug.
- A type assertion that required runtime verification.
- Any assumption made because documentation was unclear.
- Performance-sensitive code where a simpler alternative was deliberately rejected.

### Comment style

```ts
// Single-line comment for a brief explanation above the relevant line.

/*
 * Multi-line block comment for a complex function or section.
 * Explain the intent, the constraints, and any edge cases handled.
 */

/**
 * JSDoc for all exported functions, types, and classes.
 * @param input - The raw command string from the user.
 * @returns Parsed command or null if the input does not match.
 */
export function parseCommand(input: string): ParsedCommand | null {
  // ...
}
```

### Example — complex function with inline comments

```ts
/**
 * Resolves the active skill for a session by checking user-defined overrides
 * first, then falling back to the extension default, then the PI global default.
 *
 * This three-tier resolution is required because PI does not expose a unified
 * config API — each tier lives in a different namespace. See docs/pi/settings.md.
 */
function resolveSkill(
  session: Session,
  extensionConfig: ExtensionConfig,
): Skill {
  // User override is stored per-session and takes highest priority.
  const userOverride = session.settings.get("skill");
  if (userOverride) {
    return parseSkill(userOverride);
  }

  // Extension default is set at registration time in config/config.ts.
  // Falls back here when the user has not configured a preference.
  if (extensionConfig.defaultSkill) {
    return extensionConfig.defaultSkill;
  }

  // PI provides a global fallback when neither override nor extension default exists.
  // This should only happen during first-run before any config is written.
  return PI.getDefaultSkill();
}
```

---

## 5. Module and Import Rules

- Always use path aliases defined in `tsconfig.json`. Do not use relative paths that traverse more than one directory level.
- Group imports in this order, separated by a blank line:
  1. Node built-ins
  2. External packages
  3. Internal path aliases (`@commands/`, `@types/`, etc.)
  4. Relative imports within the same folder (if unavoidable)

```ts
// 1. Node built-ins
import { readFile } from "node:fs/promises";

// 2. External packages
import { z } from "zod";

// 3. Internal aliases
import type { CommandHandler } from "@types/commands";
import { runCommand } from "@commands/base";

// 4. Relative (same folder only)
import { parseArgs } from "./args";
```

---

## 6. Command Files (`commands/`)

Each file in `commands/` must export exactly one `CommandHandler` as the default export
and one named `meta` object describing the command.

```ts
import type { CommandHandler, CommandMeta } from "@types/commands";

export const meta: CommandMeta = {
  name: "tldr",
  description: "Summarize the current session into a compact digest.",
  args: [],
};

const handler: CommandHandler = async (ctx) => {
  // implementation
};

export default handler;
```

Do not put unrelated logic inside a command file.
If the command needs a helper, extract it to a separate file and import it.

---

## 7. Type Files (`types/`)

- No runtime logic. Types only.
- Do not import from `commands/`, `ui/`, or `web-search/` inside `types/`.
- Export all types as named exports. No default exports from `types/`.

---

## 8. Error Handling

- Never use empty `catch` blocks.
- Never log an error and continue silently.
- Always include context in error messages.

```ts
// Wrong
try {
  await fetchData(url);
} catch (_) {}

// Wrong — swallows the error after logging
try {
  await fetchData(url);
} catch (err) {
  console.error(err);
}

// Correct
try {
  await fetchData(url);
} catch (err) {
  // Rethrow with context so the caller knows what failed and why.
  throw new Error(`fetchData failed for url "${url}": ${String(err)}`);
}
```

---

## 9. Biome Compliance

This project uses Biome for formatting and linting. Do not fight the formatter.

- Do not add ESLint or Prettier configs.
- Do not disable Biome rules inline unless there is a documented reason in a comment above the suppression.
- Run `biome check --apply` before considering any file done.

---

## 10. File Checklist Before Submitting

Before marking any file as complete, verify:

- [ ] All exports are explicitly typed.
- [ ] No `any` without a justifying comment.
- [ ] All complex functions have inline comments explaining the why.
- [ ] All fallible operations return `Result` or throw with context.
- [ ] Imports follow the ordering and alias rules.
- [ ] File has one clear responsibility.
- [ ] Biome reports no errors or warnings.
- [ ] If you made an assumption due to unclear docs, it is commented in the code.
