import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  WORKFLOW_TEST_DIR,
  WORKFLOW_TEST_FILES_ENV,
  estimateWorkflowFileSeconds,
  listWorkflowTestFiles,
  selectShard,
} from "./workflow-test-selection.mjs";

// Usage:
//   npm run test:workflow                                  every workflow test
//   npm run test:workflow -- test-workflows/foo.workflow.test.ts [more files]
//   npm run test:workflow -- --shard 2/3                   one third, by run time
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["zotero-plugin", "test", "--no-watch"];
const argv = process.argv.slice(2);
const webChatLive = argv.includes("--webchat-live");
const agentLive = argv.includes("--agent-live");

// After the last test reports, Zotero can take more than a minute to quit.
// The result is already known by then, so we stop waiting after this long.
const QUIT_GRACE_MS = 15_000;

function parseSelection() {
  const files = [];
  let shard = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--webchat-live" || arg === "--agent-live") continue;
    if (arg === "--shard") {
      const match = /^(\d+)\/(\d+)$/.exec(argv[++i] ?? "");
      if (!match) throw new Error("--shard takes the form <index>/<count>");
      shard = { index: Number(match[1]), count: Number(match[2]) };
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    files.push(arg);
  }
  if (!files.length && !shard) return null;
  if (webChatLive || agentLive)
    throw new Error("Live runs choose their own tests; drop the file list");

  const all = listWorkflowTestFiles();
  let selected = all;
  if (files.length) {
    selected = files.map((file) => {
      const name = relative(WORKFLOW_TEST_DIR, resolve(file)).replaceAll(
        "\\",
        "/",
      );
      if (!all.includes(name))
        throw new Error(`Not a workflow test file: ${file}`);
      return name;
    });
  }
  if (shard) {
    const secondsOf = (file) =>
      estimateWorkflowFileSeconds(
        file,
        readFileSync(resolve(WORKFLOW_TEST_DIR, file), "utf8"),
      );
    selected = selectShard(selected, secondsOf, shard.index, shard.count);
  }
  return selected;
}

let selected;
try {
  selected = parseSelection();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (selected) {
  console.log(
    `Running ${selected.length} workflow test file(s):\n  ${selected.join("\n  ")}`,
  );
}

// Its own process group on POSIX, so stopping it also stops Zotero and Xvfb.
const ownGroup = process.platform !== "win32";
const child = spawn(command, args, {
  stdio: ["inherit", "pipe", "pipe"],
  detached: ownGroup,
  env: {
    ...process.env,
    NODE_ENV: "test",
    LLM_FOR_ZOTERO_WORKFLOW_TESTS: "1",
    ...(selected
      ? { [WORKFLOW_TEST_FILES_ENV]: JSON.stringify(selected) }
      : {}),
    ...(webChatLive ? { LLM_FOR_ZOTERO_WEBCHAT_LIVE: "1" } : {}),
    ...(agentLive ? { LLM_FOR_ZOTERO_AGENT_LIVE: "1" } : {}),
  },
});

// The scaffold decides its exit code from the summary line alone, so a run
// whose Zotero quits before the summary used to pass. We read the output
// ourselves: any failed test, or no summary at all, fails the run.
let sawFailure = false;
let summary = null;
let quitTimer = null;
let buffered = "";

function stopChild(signal) {
  try {
    if (ownGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    /* already gone */
  }
}

// A detached group does not get the terminal's Ctrl+C, so pass it on.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChild(signal);
    process.exitCode = 1;
  });
}

// The scaffold colors its output; read the words, not the color codes.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function readLines(chunk) {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const raw of lines) {
    const line = raw.replace(ANSI, "");
    if (/^\s*✖/.test(line)) sawFailure = true;
    const match = /Test run completed - (\d+) passed(?:, (\d+) failed)?/.exec(
      line,
    );
    if (match) {
      summary = { passed: Number(match[1]), failed: Number(match[2] ?? 0) };
      quitTimer ??= setTimeout(() => {
        console.log(
          `Zotero did not quit within ${QUIT_GRACE_MS / 1000} s of the last test; stopping it.`,
        );
        stopChild("SIGKILL");
      }, QUIT_GRACE_MS);
    }
  }
}

for (const [stream, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    target.write(chunk);
    readLines(chunk);
  });
}

// Wait for the child process and its stdio streams to close before allowing
// this wrapper to finish. Exiting on the earlier "exit" event can tear down
// the scaffold's esbuild service pipe while it is still draining, which
// intermittently prints a post-test Go deadlock despite a successful run.
child.on("close", (code, signal) => {
  if (quitTimer) clearTimeout(quitTimer);
  readLines("\n");
  if (!summary) {
    console.error(
      signal
        ? `Workflow tests terminated by ${signal} before they finished`
        : "Workflow tests ended without a result summary",
    );
    process.exitCode = 1;
    return;
  }
  if (summary.failed > 0 || sawFailure) {
    process.exitCode = 1;
    return;
  }
  // Stopped by us after a clean summary counts as a pass.
  process.exitCode = signal ? 0 : (code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
