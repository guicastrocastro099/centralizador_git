declare const Bun: {
  serve: (options: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => void;
  spawn: (
    command: string[],
    options: { stdout: "inherit"; stderr: "inherit"; stdin: "inherit" },
  ) => { kill: () => void; exited: Promise<number> };
};

declare const process: {
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
  on: (event: string, listener: () => void) => void;
};
