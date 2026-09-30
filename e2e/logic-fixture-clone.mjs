import { randomBytes } from "node:crypto";
// Logic step probes — a throwaway COPY of the local Logic fixture
// (cmr7khgd50001vkhscvox8dgt), so a probe can edit freely while other
// agents use the fixture itself. The copy has the same shop, a fresh id,
// its own quiz-scoped Category rows (ids remapped inside draftJson), and is
// deleted (with every row it grew) by `drop()`. Local DB only.
export const LOGIC_FIXTURE = "cmr7khgd50001vkhscvox8dgt";

export async function cloneLogicFixture(prisma, { name, mutateDoc } = {}) {
  const src = await prisma.quiz.findUnique({ where: { id: LOGIC_FIXTURE } });
  if (!src) throw new Error("fixture quiz not found");
  const cats = await prisma.category.findMany({ where: { quizId: LOGIC_FIXTURE } });
  const quiz = await prisma.quiz.create({
    data: {
      shopId: src.shopId,
      name: name ?? "[probe] logic copy",
      status: "draft",
      draftJson: src.draftJson,
    },
  });
  let json = JSON.stringify(src.draftJson);
  for (const c of cats) {
    const { id: oldId, createdAt: _c, updatedAt: _u, quizId: _q, ...rest } = c;
    const created = await prisma.category.create({
      data: { ...rest, quizId: quiz.id, membership: rest.membership ?? undefined },
    });
    json = json.split(oldId).join(created.id);
  }
  let doc = JSON.parse(json);
  if (mutateDoc) doc = mutateDoc(doc) ?? doc;
  await prisma.quiz.update({ where: { id: quiz.id }, data: { draftJson: doc } });
  const drop = async () => {
    await prisma.category.deleteMany({ where: { quizId: quiz.id } });
    await prisma.quiz.delete({ where: { id: quiz.id } }).catch(() => {});
  };
  const read = async () =>
    (await prisma.quiz.findUnique({ where: { id: quiz.id }, select: { draftJson: true } }))?.draftJson;
  return { id: quiz.id, drop, read };
}

// ── Agent D's variant (used by logic-filter-verify / logic-widget-verify) ──
// Shared helper for the Logic step probes: clone the local fixture quiz
// (cmr7khgd50001vkhscvox8dgt) into a THROWAWAY quiz with its quiz-scoped
// Category rows, so a probe can edit freely while other agents and probes
// use the original. The clone's category ids are fresh; every reference in
// the draft is rewritten to them. `drop()` deletes the clone and its rows.

export const FIXTURE_QUIZ = "cmr7khgd50001vkhscvox8dgt";

const newId = (p) => `${p}${randomBytes(10).toString("hex")}`;

export async function cloneFixture(prisma, { from = FIXTURE_QUIZ, name = "Logic probe clone" } = {}) {
  const src = await prisma.quiz.findUnique({ where: { id: from } });
  if (!src) throw new Error(`fixture quiz ${from} not found`);
  const cats = await prisma.category.findMany({ where: { quizId: from } });
  const id = newId("cprobe");
  let json = JSON.stringify(src.draftJson);
  const idMap = new Map(cats.map((c) => [c.id, newId("cprobecat")]));
  for (const [oldId, nid] of idMap) json = json.split(oldId).join(nid);
  await prisma.quiz.create({
    data: {
      id,
      shopId: src.shopId,
      name,
      status: "draft",
      draftJson: JSON.parse(json),
    },
  });
  for (const c of cats) {
    const { id: oldId, createdAt: _c, updatedAt: _u, ...rest } = c;
    await prisma.category.create({
      data: { ...rest, id: idMap.get(oldId), quizId: id, membership: rest.membership ?? undefined },
    });
  }
  return {
    id,
    idMap,
    draft: async () =>
      (await prisma.quiz.findUnique({ where: { id }, select: { draftJson: true } }))?.draftJson,
    setDraft: (draftJson) => prisma.quiz.update({ where: { id }, data: { draftJson } }),
    drop: async () => {
      await prisma.category.deleteMany({ where: { quizId: id } });
      await prisma.quiz.delete({ where: { id } }).catch(() => {});
    },
  };
}
