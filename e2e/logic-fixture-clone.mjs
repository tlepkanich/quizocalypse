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
