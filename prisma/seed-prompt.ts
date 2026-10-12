import { validateSuperAdminPassword } from "../lib/superadmin-accounts";

// Interactive initial-password prompt for the SuperAdmin bootstrap step of prisma/seed.ts.
// All terminal I/O goes through PromptIo so the logic is unit-testable. The plaintext is only
// ever returned to the caller; it is never written to `io.write`.

export interface PromptIo {
  /** True when stdin is an interactive terminal. Non-TTY runs never prompt. */
  isTTY: boolean;
  /** Read one line with echo hidden. */
  askHidden(question: string): Promise<string>;
  write(message: string): void;
}

export const MAX_PASSWORD_ATTEMPTS = 3;

/**
 * Ask for the initial password of a SuperAdmin that does not exist yet.
 * Returns the password, or null when the account should be skipped (non-TTY, empty entry,
 * or attempts exhausted).
 */
export async function promptInitialSuperAdminPassword(
  username: string,
  io: PromptIo,
  validate: (password: unknown) => string | null = validateSuperAdminPassword,
  maxAttempts: number = MAX_PASSWORD_ATTEMPTS,
): Promise<string | null> {
  if (!io.isTTY) {
    io.write(
      `SuperAdmin "${username}" SKIPPED: stdin is not a terminal, so there is nobody to ask for a password. ` +
        `Note that "npx prisma db seed" never provides a terminal. To create it, run "npm run seed:interactive" ` +
        `(or "npx tsx prisma/seed.ts") from PowerShell, cmd or Windows Terminal. ` +
        `Git Bash/mintty also gives no terminal; prefix the command with "winpty" (untested) or use another terminal.\n`,
    );
    return null;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const first = await io.askHidden(
      `Initial password for new SuperAdmin "${username}" (empty to skip): `,
    );
    if (first === "") {
      io.write(`SuperAdmin "${username}" SKIPPED (empty entry).\n`);
      return null;
    }
    const problem = validate(first);
    if (problem) {
      io.write(`Invalid password: ${problem}.\n`);
      continue;
    }
    const second = await io.askHidden(`Confirm password for "${username}": `);
    if (second !== first) {
      io.write("Passwords did not match.\n");
      continue;
    }
    return first;
  }

  io.write(`SuperAdmin "${username}" SKIPPED (too many failed attempts).\n`);
  return null;
}

/** Real terminal implementation: raw-mode stdin, no echo. */
export function createTerminalIo(): PromptIo {
  const stdin = process.stdin;
  return {
    isTTY: Boolean(stdin.isTTY && process.stdout.isTTY),
    write: (message) => {
      process.stdout.write(message);
    },
    askHidden: (question) =>
      new Promise<string>((resolve, reject) => {
        process.stdout.write(question);
        let buffer = "";
        const finish = (fn: () => void) => {
          stdin.removeListener("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          fn();
        };
        const onData = (chunk: Buffer) => {
          for (const ch of chunk.toString("utf8")) {
            if (ch === "\r" || ch === "\n") return finish(() => resolve(buffer));
            if (ch === "\u0003") return finish(() => reject(new Error("Seed cancelled (Ctrl-C)")));
            if (ch === "\u007f" || ch === "\b") buffer = buffer.slice(0, -1);
            else buffer += ch;
          }
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
      }),
  };
}
