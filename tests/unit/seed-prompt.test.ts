import { test } from "node:test";
import assert from "node:assert/strict";
import { promptInitialSuperAdminPassword, type PromptIo } from "../../prisma/seed-prompt";

function fakeIo(answers: string[], isTTY = true) {
  const asked: string[] = [];
  const written: string[] = [];
  const io: PromptIo = {
    isTTY,
    askHidden: async (q) => {
      asked.push(q);
      const a = answers.shift();
      if (a === undefined) throw new Error("unexpected extra prompt");
      return a;
    },
    write: (m) => {
      written.push(m);
    },
  };
  return { io, asked, written };
}

test("valid password entered twice is returned", async () => {
  const { io, asked } = fakeIo(["Str0ngPass!", "Str0ngPass!"]);
  assert.equal(await promptInitialSuperAdminPassword("ishan", io), "Str0ngPass!");
  assert.equal(asked.length, 2);
});

test("mismatched confirmation re-asks", async () => {
  const { io, written } = fakeIo(["Str0ngPass!", "different1!", "Str0ngPass!", "Str0ngPass!"]);
  assert.equal(await promptInitialSuperAdminPassword("ishan", io), "Str0ngPass!");
  assert.ok(written.some((m) => m.includes("did not match")));
});

test("invalid (too short) password re-asks without a confirm prompt", async () => {
  const { io, asked, written } = fakeIo(["short", "Str0ngPass!", "Str0ngPass!"]);
  assert.equal(await promptInitialSuperAdminPassword("shaji", io), "Str0ngPass!");
  assert.equal(asked.length, 3);
  assert.ok(written.some((m) => m.includes("Invalid password")));
});

test("empty entry skips the account", async () => {
  const { io, asked } = fakeIo([""]);
  assert.equal(await promptInitialSuperAdminPassword("shaji", io), null);
  assert.equal(asked.length, 1);
});

test("gives up after the max attempts", async () => {
  const { io } = fakeIo(["short", "short", "short"]);
  assert.equal(await promptInitialSuperAdminPassword("shaji", io), null);
});

test("non-TTY never prompts, warns, and skips", async () => {
  const { io, asked, written } = fakeIo([], false);
  assert.equal(await promptInitialSuperAdminPassword("devadmin", io), null);
  assert.equal(asked.length, 0);
  assert.ok(written.some((m) => m.includes("SKIPPED")));
});

test("plaintext is never written to output", async () => {
  const { io, written } = fakeIo(["Str0ngPass!", "nope-nope-1", "Str0ngPass!", "Str0ngPass!"]);
  await promptInitialSuperAdminPassword("ishan", io);
  assert.ok(written.every((m) => !m.includes("Str0ngPass!") && !m.includes("nope-nope-1")));
});
