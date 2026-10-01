#!/usr/bin/env node
// Results handoff §4 defect 0 — list every published quiz (current doc AND the
// kept QuizVersion history) whose publishedJson carries an integration
// credential or a discount code that /q/:id.json served before the redaction
// in stripPublicDoc landed. Any credential listed here WAS public and must be
// rotated by the merchant. Prints ids and key names only — never a value.
//
//   set -a; source .env; set +a; node scripts/audit-published-credentials.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function findings(doc) {
  const out = [];
  if (!doc || typeof doc !== "object") return out;
  for (const node of Array.isArray(doc.nodes) ? doc.nodes : []) {
    if (node?.type !== "integration") continue;
    for (const action of node.data?.actions ?? []) {
      if (action?.api_key) out.push(`node ${node.id}: klaviyo api_key`);
      if (action?.secret) out.push(`node ${node.id}: webhook secret`);
    }
  }
  const dc = doc.discount_config ?? {};
  if (dc.static_code) out.push("discount_config.static_code");
  if (dc.existing_code) out.push("discount_config.existing_code");
  if (dc.code && doc.logic_model === "decider") out.push("discount_config.code (decider)");
  return out;
}

async function main() {
  const quizzes = await prisma.quiz.findMany({
    select: { id: true, name: true, shop: { select: { shopDomain: true } }, publishedJson: true },
  });
  const versions = await prisma.quizVersion.findMany({
    select: { quizId: true, version: true, publishedJson: true },
  });
  console.log(`Scanned ${quizzes.filter((q) => q.publishedJson).length} published quizzes, ${versions.length} versions.`);
  let hits = 0;
  for (const q of quizzes) {
    const f = findings(q.publishedJson);
    if (f.length === 0) continue;
    hits += 1;
    console.log(`${q.id}\t${q.shop?.shopDomain ?? "?"}\t${q.name}\n  ${f.join("\n  ")}`);
  }
  for (const v of versions) {
    const f = findings(v.publishedJson);
    if (f.length === 0) continue;
    hits += 1;
    console.log(`${v.quizId} (history v${v.version})\n  ${f.join("\n  ")}`);
  }
  console.log(hits === 0 ? "No exposed credentials or codes found." : `${hits} exposed document(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
