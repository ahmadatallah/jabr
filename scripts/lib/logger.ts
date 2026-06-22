/**
 * Centralised, colourised logging for jabr.
 *
 * All human-facing diagnostics flow through the exported {@link logger} (built on
 * {@link https://github.com/unjs/consola | consola}) so messages share one
 * consistent, colour-coded format with severity badges. Raw command *data*
 * (branch names, the stack tree) is written directly to stdout by the command
 * handlers so it stays clean and pipeable.
 *
 * @packageDocumentation
 */

import { consola } from "consola";
import picocolors from "picocolors";

/**
 * The shared logger instance, tagged `jabr`.
 *
 * Use the severity-specific methods rather than `console`:
 * - `logger.start(...)` — an operation is beginning (e.g. "pushing 'feature-a'")
 * - `logger.info(...)` — neutral information
 * - `logger.success(...)` — an operation completed
 * - `logger.warn(...)` — a non-fatal concern
 * - `logger.error(...)` — a failure (see also {@link fail})
 */
export const logger = consola.withTag("jabr");

/**
 * Colour helpers ({@link https://github.com/alexeyraspopov/picocolors | picocolors}).
 *
 * Used for ad-hoc colourising of structured output, such as highlighting the
 * current branch in `jabr log`.
 */
export const colors = picocolors;

/**
 * Log an error through the {@link logger} and terminate the process non-zero.
 *
 * The single failure path for the whole engine; its `never` return type lets it
 * be used in expression position without upsetting control-flow analysis.
 *
 * @param message - Human-readable explanation of what went wrong.
 * @returns Never returns — the process exits with status `1`.
 */
export const fail = (message: string): never => {
  logger.error(message);
  process.exit(1);
};
