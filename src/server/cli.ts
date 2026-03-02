/**
 * CLI argument parser for the Helios standalone server.
 *
 * Supported flags:
 *   --config <path>   Path to a JSON or YAML config file
 *   --port <number>   Port to listen on (1–65535)
 *   --help / -h       Print usage information
 */

export interface CliArgs {
    configFile?: string;
    port?: number;
    help?: boolean;
}

/**
 * Parses CLI arguments into a structured {@link CliArgs} object.
 *
 * @param args  Raw argument list (e.g. process.argv.slice(2))
 * @throws Error if an argument is invalid or a required value is missing
 */
export function parseCli(args: string[]): CliArgs {
    const result: CliArgs = {};
    let i = 0;

    while (i < args.length) {
        const arg = args[i];

        if (arg === '--help' || arg === '-h') {
            result.help = true;
            i++;
            continue;
        }

        if (arg === '--port') {
            if (i + 1 >= args.length) {
                throw new Error('--port requires a value');
            }
            const raw = args[i + 1];
            const port = Number(raw);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error(`Invalid port value: "${raw}". Must be an integer between 1 and 65535`);
            }
            result.port = port;
            i += 2;
            continue;
        }

        if (arg === '--config') {
            if (i + 1 >= args.length) {
                throw new Error('--config requires a value');
            }
            result.configFile = args[i + 1];
            i += 2;
            continue;
        }

        throw new Error(`Unknown argument: "${arg}"`);
    }

    return result;
}

/**
 * Returns the help text string for the CLI.
 */
export function helpText(): string {
    return `
Helios Standalone Server

Usage:
  bun run helios-server.ts [options]

Options:
  --config <path>   Path to a JSON or YAML config file
  --port <number>   Port to listen on (default: 5701)
  --help, -h        Show this help message
`.trim();
}
