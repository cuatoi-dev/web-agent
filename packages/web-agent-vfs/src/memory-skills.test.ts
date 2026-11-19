import { describe, expect, it } from "vitest";
import { MemoryBackend, memorySkills, vfsTools } from "./index.js";
import type { VfsOptions } from "./types.js";

const provider = (memory?: VfsOptions["memory"]) =>
  vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend(), memory });

describe("memorySkills", () => {
  it("M1: memory off returns no skills", () => {
    for (const p of [provider(), provider(false)]) {
      expect(memorySkills(p)).toEqual([]);
      expect(p.memory).toBeNull();
    }
  });

  it("M2: memory on returns the two skills, in order, as model-invoked skills", () => {
    const skills = memorySkills(provider(true));
    expect(skills.map((s) => s.name)).toEqual(["remember", "onboarding"]);
    expect(skills[0].description).toBe(
      "Save, change or forget an entry in USER.md or MEMORY.md. Use only when the user asks you to remember, change or forget something, or agrees when you offer.",
    );
    expect(skills[1].description).toBe("Create USER.md with the user, when it does not exist yet.");
    expect(skills.every((s) => s.command === undefined && s.disableModelInvocation === undefined)).toBe(true);
  });

  it("M3: the default text names the default paths, limits and entry format", () => {
    const [remember, onboarding] = memorySkills(provider(true));
    for (const t of [
      "/home/shared/USER.md",
      "/home/agent/MEMORY.md",
      "under 2000 characters",
      "under 4000 characters",
      "- {entry} ({YYYY-MM-DD HH:mm})",
      "# User\n\n## About\n\n## Preferences",
      "# Memory\n\n## Facts\n\n## Decisions",
    ]) expect(remember.definition).toContain(t);
    for (const t of [
      "four short questions",
      "What should I call you?",
      "What is your role?",
      "How do you like answers",
      "Anything else I should always keep in mind?",
      "# User\n\n## About\n\n## Preferences",
    ]) expect(onboarding.definition).toContain(t);
  });

  it("M4: custom paths and limits replace the defaults", () => {
    const [remember, onboarding] = memorySkills(
      provider({ userPath: "/home/agent/me.md", memoryPath: "/home/shared/notes/mem.md", userMaxChars: 1234, memoryMaxChars: 5678 }),
    );
    for (const t of ["/home/agent/me.md", "/home/shared/notes/mem.md", "under 1234 characters", "under 5678 characters"]) {
      expect(remember.definition).toContain(t);
    }
    expect(remember.definition).not.toContain("/home/shared/USER.md");
    expect(remember.definition).not.toContain("/home/agent/MEMORY.md");
    expect(onboarding.definition).toContain("/home/agent/me.md");
    expect(onboarding.definition).not.toContain("/home/shared/USER.md");
  });

  it("M5: onboarding: false still returns both skills", () => {
    expect(memorySkills(provider({ onboarding: false })).map((s) => s.name)).toEqual(["remember", "onboarding"]);
  });

  it("M6: the provider exposes the resolved options", () => {
    const p = provider({ userPath: "/home/agent/me.md", userMaxChars: 1234 });
    expect(p.memory!.userPath).toBe("/home/agent/me.md");
    expect(p.memory!.userMaxChars).toBe(1234);
    // The untouched option is still resolved to a path.
    expect(p.memory!.memoryPath).toMatch(/MEMORY\.md$/);
  });
});
