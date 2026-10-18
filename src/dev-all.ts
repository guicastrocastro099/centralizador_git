const api = Bun.spawn(["bun", "--watch", "src/dev.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
const web = Bun.spawn(["bun", "run", "--cwd", "apps/web", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

function stop() {
  api.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await Promise.race([api.exited, web.exited]);
stop();

export {};
