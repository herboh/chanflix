import dataSource from "@server/datasource";
import { getNegativeAiTraceExports } from "@server/lib/aiTraceStore";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const main = async () => {
  const limitFlag = process.argv.indexOf("--limit");
  const parsedLimit =
    limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : undefined;
  const limit =
    parsedLimit && Number.isInteger(parsedLimit) ? parsedLimit : undefined;
  await dataSource.initialize();
  try {
    const traces = await getNegativeAiTraceExports(limit);
    const outputDirectory = path.join(process.cwd(), "evals", "review");
    mkdirSync(outputDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(
      outputDirectory,
      `negative-traces-${stamp}.jsonl`
    );
    writeFileSync(
      outputPath,
      traces.map((trace) => JSON.stringify(trace)).join("\n") +
        (traces.length ? "\n" : ""),
      { encoding: "utf8", mode: 0o600 }
    );
    process.stdout.write(`${outputPath}\n${traces.length} trace(s) exported\n`);
  } finally {
    await dataSource.destroy();
  }
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
