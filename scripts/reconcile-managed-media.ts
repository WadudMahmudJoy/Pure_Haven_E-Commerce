import { mediaReconciliationService } from "../lib/media/mediaReconciliationService";

function parsePositiveInt(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

async function main() {
  const limit = parsePositiveInt(process.argv[2], 100);
  const result = await mediaReconciliationService.runBatch(limit);
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
