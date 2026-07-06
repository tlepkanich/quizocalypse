// Pure quiz-document mutations — no I/O, unit-tested. UIs call these, never
// hand-edit JSON. BIC-2 C3a split the implementation into semantic modules
// under ./mutations/ (question / node / edge / result / decider); this file is
// the stable re-export barrel so the ~27 importers keep their paths. Internal
// helpers (uid, nextPosition, …) live in ./mutations/shared and are NOT
// re-exported here. New cross-module calls inside ./mutations/ must import the
// concrete module, never this barrel (no cycles).
export * from "./mutations/questionMutations";
export * from "./mutations/nodeMutations";
export * from "./mutations/edgeMutations";
export * from "./mutations/resultMutations";
export * from "./mutations/deciderMutations";
