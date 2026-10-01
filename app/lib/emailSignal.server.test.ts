import { describe, it, expect, vi } from "vitest";
import { emailSignalFrom } from "./emailSignal.server";

// Hoisted by vitest above the import: the pure helper never touches the DB.
vi.mock("../db.server", () => ({ default: {} }));

describe("emailSignalFrom", () => {
  it("waits on every capture until a destination exists", () => {
    expect(emailSignalFrom(128, false)).toEqual({ captured: 128, waiting: 128 });
    expect(emailSignalFrom(128, true)).toEqual({ captured: 128, waiting: 0 });
    expect(emailSignalFrom(0, false)).toEqual({ captured: 0, waiting: 0 });
  });
});
