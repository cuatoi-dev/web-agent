import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { agentAllows } from "./brand-capabilities";

// The compiler is a CommonJS build script, not part of the src/ TypeScript
// graph — it runs from tool/build.cjs, never inside a bundled entry.
const require = createRequire(import.meta.url);
const { compileBrand, compileThemes } = require("../../tool/compile-brand.cjs") as {
  compileBrand: (brandDir: string) => Record<string, unknown>;
  compileThemes: (brandDir: string, rawThemes: unknown) => Record<string, unknown>[];
};
const { SIDE_PANEL_TOOL_NAMES, DEBUGGER_GATED_TOOLS } = require("../../tool/sidepanel-tools.cjs") as {
  SIDE_PANEL_TOOL_NAMES: string[];
  DEBUGGER_GATED_TOOLS: string[];
};

const BRAND_DIR = path.resolve(__dirname, "../../brand");

/** A minimal agent file that satisfies every `compileAgents` rule with "*"
 *  tools and skills, so a test can focus on whatever it is actually
 *  checking. */
const VALID_AGENT_YAML =
  "displayName: Chromagent\n"
  + "description: Test agent.\n"
  + "instructions: Be a helpful test agent.\n"
  + 'tools: "*"\n'
  + 'skills: "*"\n';

describe("compileBrand", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function writePlugin(dir: string, contents: string): void {
    fs.writeFileSync(path.join(dir, "plugin.yml"), contents);
  }

  function writeModel(dir: string, contents: string): void {
    fs.writeFileSync(path.join(dir, "model.yml"), contents);
  }

  function writeSkill(dir: string, file: string, contents: string): void {
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", file), contents);
  }

  function writeAgent(dir: string, file: string, contents: string): void {
    fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(dir, "agents", file), contents);
  }

  /** Writes `agents/chromagent.yml`, the default agent every non-agent-focused
   *  test in this file needs so `compileAgents` succeeds and the code under
   *  test is reached. */
  function writeDefaultAgent(dir: string): void {
    writeAgent(dir, "chromagent.yml", VALID_AGENT_YAML);
  }

  /** Writes `<id>.home/<name>` for every entry, creating the folder. */
  function writeHome(dir: string, id: string, files: Record<string, string>): void {
    const home = path.join(dir, "agents", `${id}.home`);
    fs.mkdirSync(home, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(home, name), contents);
    }
  }

  it("the default brand compiles to all ten keys", () => {
    const brand = compileBrand(BRAND_DIR);
    expect(Object.keys(brand).sort()).toEqual([
      "agents",
      "defaultAgent",
      "hosts",
      "models",
      "options",
      "prompts",
      "skillDefs",
      "skills",
      "themes",
      "tools",
    ]);
    expect((brand as { themes: unknown[] }).themes).toEqual([]);
  });

  it("the default brand carries inPage agent prompt and no sidePanel prompt", () => {
    const brand = compileBrand(BRAND_DIR) as { prompts: Record<string, string> };
    expect(typeof brand.prompts.inPage).toBe("string");
    expect(brand.prompts.inPage.trim().length).toBeGreaterThan(0);
    expect(brand.prompts.sidePanel).toBeUndefined();
  });

  describe("agents", () => {
    it("empty brand/agents/ directory throws expected message", () => {
      const tempDir = makeTempDir();
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/ has no agent files; add at least one <id>.yml, for example chromagent.yml",
      );
    });

    it("missing defaultAgent throws expected message", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml defaultAgent is missing; expected chromagent",
      );
    });

    it("unknown defaultAgent throws expected message", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: helper\n");
      expect(() => compileBrand(tempDir)).toThrow(
        'plugin.yml defaultAgent "helper" has no file brand/agents/helper.yml; expected chromagent',
      );
    });

    it("prompts.sidePanel present throws migration message", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, 'defaultAgent: chromagent\nprompts:\n  sidePanel: "x"\n');
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml prompts.sidePanel is no longer read; move the text to instructions in brand/agents/<id>.yml",
      );
    });

    it("invalid agent filename throws naming character rules", () => {
      const tempDir = makeTempDir();
      writeAgent(tempDir, "Bad Name.yml", VALID_AGENT_YAML);
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/Bad Name.yml file name must use lowercase letters, digits, - and _, starting with a letter",
      );
    });

    it("empty agent displayName/description/instructions throws", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: ""\ninstructions: "Be helpful."\ntools: "*"\nskills: "*"\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/tesagent.yml description must be a non-empty string",
      );
    });

    it("unknown model id throws", () => {
      const tempDir = makeTempDir();
      writeModel(
        tempDir,
        'models:\n  - id: model-a\n    label: A\n    endpoint: "https://a.test"\n    wireFormat: openai\n    model: m\n',
      );
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\nmodel: gpt-9\ntools: "*"\nskills: "*"\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        'brand/agents/tesagent.yml model "gpt-9" is not an id in model.yml; expected model-a',
      );
    });

    it("invalid tools/skills shape throws", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\nskills: "*"\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        'brand/agents/tesagent.yml tools must be "*" or a list of names',
      );
    });

    it("non-list excludeTools throws", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\ntools: "*"\nskills: "*"\nexcludeTools: close_tab\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/tesagent.yml excludeTools must be a list of names",
      );
    });

    it("unknown tool name throws", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\ntools:\n  - page_nonexistent_tool\nskills: "*"\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        'brand/agents/tesagent.yml tools lists "page_nonexistent_tool", which is not a side panel tool; expected "*" or names such as read_tabs, page_eval, page_screenshot',
      );
    });

    it("unknown skill or exclude name throws", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\ntools: "*"\nskills:\n  - not_a_real_skill\n',
      );
      expect(() => compileBrand(tempDir)).toThrow(
        /brand\/agents\/tesagent\.yml skills lists "not_a_real_skill", which is not a side panel skill/,
      );
    });

    it("an agent with skills: [test_plan] builds and keeps the list", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\ntools: "*"\nskills:\n  - test_plan\n',
      );
      writePlugin(tempDir, "defaultAgent: tesagent\n");
      const brand = compileBrand(tempDir) as { agents: { id: string; skills: unknown }[] };
      expect(brand.agents.find((a) => a.id === "tesagent")?.skills).toEqual(["test_plan"]);
    });

    it("an agent with excludeSkills: [test_plan] builds and keeps the list", () => {
      const tempDir = makeTempDir();
      writeAgent(tempDir, "chromagent.yml", `${VALID_AGENT_YAML}excludeSkills:\n  - test_plan\n`);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      const brand = compileBrand(tempDir) as { agents: { id: string; excludeSkills?: unknown }[] };
      expect(brand.agents.find((a) => a.id === "chromagent")?.excludeSkills).toEqual(["test_plan"]);
    });

    it("accepts every built-in side panel skill name in skills and excludeSkills", () => {
      const builtIn = [
        "tab_management",
        "page_agent",
        "website_edit",
        "test_plan",
        "test_report",
        "explore_app",
      ];
      for (const s of builtIn) {
        const skillsDir = makeTempDir();
        writeAgent(
          skillsDir,
          "chromagent.yml",
          `${VALID_AGENT_YAML.replace('skills: "*"\n', `skills:\n  - ${s}\n`)}`,
        );
        writePlugin(skillsDir, "defaultAgent: chromagent\n");
        const brand = compileBrand(skillsDir) as { agents: { skills: unknown }[] };
        expect(brand.agents[0].skills).toEqual([s]);

        const excludeDir = makeTempDir();
        writeAgent(excludeDir, "chromagent.yml", `${VALID_AGENT_YAML}excludeSkills:\n  - ${s}\n`);
        writePlugin(excludeDir, "defaultAgent: chromagent\n");
        const excluded = compileBrand(excludeDir) as { agents: { excludeSkills?: unknown }[] };
        expect(excluded.agents[0].excludeSkills).toEqual([s]);
      }
    });

    it("reads <id>.home/AGENTS.md into homeAgentsMd (127/004)", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writeHome(tempDir, "chromagent", { "AGENTS.md": "# Starter\n\nLayout.\n" });
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      const brand = compileBrand(tempDir) as { agents: { id: string; homeAgentsMd?: string }[] };
      expect(brand.agents.find((a) => a.id === "chromagent")?.homeAgentsMd)
        .toBe("# Starter\n\nLayout.\n");
    });

    it("an agent with no .home folder carries no homeAgentsMd", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      const brand = compileBrand(tempDir) as { agents: Record<string, unknown>[] };
      expect("homeAgentsMd" in brand.agents[0]).toBe(false);
    });

    it("a second entry in <id>.home fails the build and names it", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writeHome(tempDir, "chromagent", { "AGENTS.md": "starter", "notes.txt": "extra" });
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/chromagent.home may only contain AGENTS.md (found: AGENTS.md, notes.txt)",
      );
    });

    it("an empty <id>.home folder fails the build", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writeHome(tempDir, "chromagent", {});
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/agents/chromagent.home may only contain AGENTS.md (found: nothing)",
      );
    });

    it("<id>.home that is a file, or AGENTS.md that is a folder, fails the build", () => {
      const fileTemp = makeTempDir();
      writeDefaultAgent(fileTemp);
      fs.mkdirSync(path.join(fileTemp, "agents"), { recursive: true });
      fs.writeFileSync(path.join(fileTemp, "agents", "chromagent.home"), "not a folder");
      writePlugin(fileTemp, "defaultAgent: chromagent\n");
      expect(() => compileBrand(fileTemp)).toThrow(
        "brand/agents/chromagent.home must be a folder",
      );

      const dirTemp = makeTempDir();
      writeDefaultAgent(dirTemp);
      fs.mkdirSync(path.join(dirTemp, "agents", "chromagent.home", "AGENTS.md"), { recursive: true });
      writePlugin(dirTemp, "defaultAgent: chromagent\n");
      expect(() => compileBrand(dirTemp)).toThrow(
        "brand/agents/chromagent.home/AGENTS.md must be a file",
      );
    });

    it("the default brand seeds tesagent and not chromagent", () => {
      const brand = compileBrand(BRAND_DIR) as {
        agents: { id: string; homeAgentsMd?: string }[];
      };
      const starter = fs.readFileSync(
        path.join(BRAND_DIR, "agents", "tesagent.home", "AGENTS.md"),
        "utf8",
      );
      expect(brand.agents.find((a) => a.id === "tesagent")?.homeAgentsMd).toBe(starter);
      expect("homeAgentsMd" in (brand.agents.find((a) => a.id === "chromagent") ?? {})).toBe(false);
    });

    it("memory: true and memory: false are copied onto the agent", () => {
      const onDir = makeTempDir();
      writeAgent(onDir, "chromagent.yml", `${VALID_AGENT_YAML}memory: true\n`);
      writePlugin(onDir, "defaultAgent: chromagent\n");
      const onBrand = compileBrand(onDir) as { agents: { memory?: boolean }[] };
      expect(onBrand.agents[0].memory).toBe(true);

      const offDir = makeTempDir();
      writeAgent(offDir, "chromagent.yml", `${VALID_AGENT_YAML}memory: false\n`);
      writePlugin(offDir, "defaultAgent: chromagent\n");
      const offBrand = compileBrand(offDir) as { agents: { memory?: boolean }[] };
      expect(offBrand.agents[0].memory).toBe(false);
    });

    it("an agent without memory has no memory key", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      const brand = compileBrand(tempDir) as { agents: object[] };
      expect("memory" in brand.agents[0]).toBe(false);
    });

    it("a memory value that is not true or false fails the build", () => {
      for (const value of ['"yes"', "1", "null"]) {
        const tempDir = makeTempDir();
        writeAgent(tempDir, "chromagent.yml", `${VALID_AGENT_YAML}memory: ${value}\n`);
        writePlugin(tempDir, "defaultAgent: chromagent\n");
        expect(() => compileBrand(tempDir)).toThrow(
          "brand/agents/chromagent.yml memory must be true or false",
        );
      }
    });

    it("the default brand lets chromagent and tesagent use memory", () => {
      const brand = compileBrand(BRAND_DIR) as { agents: { id: string; memory?: boolean }[] };
      expect(brand.agents.find((a) => a.id === "chromagent")?.memory).toBe(true);
      expect(brand.agents.find((a) => a.id === "tesagent")?.memory).toBe(true);
    });

    it("an agent naming a removed skill fails the build", () => {
      const tempDir = makeTempDir();
      writeAgent(
        tempDir,
        "tesagent.yml",
        'displayName: tesagent\ndescription: "Test."\ninstructions: "Be helpful."\ntools: "*"\nskills:\n  - playwright_script\n',
      );
      writePlugin(tempDir, "defaultAgent: tesagent\n");
      expect(() => compileBrand(tempDir)).toThrow(/playwright_script.*not a side panel skill/);
    });

    it("chromagent has every side panel tool and skill; tesagent lacks the three in-page agent tools (155400-001)", () => {
      const brand = compileBrand(BRAND_DIR) as {
        agents: { id: string; tools: "*" | string[]; excludeTools?: string[]; skills: "*" | string[]; excludeSkills?: string[] }[];
      };
      const agentOf = (id: string) => {
        const agent = brand.agents.find((a) => a.id === id);
        if (!agent) throw new Error(`expected a compiled ${id} agent`);
        return agent;
      };
      const toolsOf = (id: string): string[] => {
        const agent = agentOf(id);
        return SIDE_PANEL_TOOL_NAMES.filter((name) => agentAllows(agent.tools, agent.excludeTools, name));
      };
      const pageAgentTools = ["toggle_page_agent", "send_to_page_agent", "read_page_agent"];
      const chromagentTools = toolsOf("chromagent");
      const tesagentTools = toolsOf("tesagent");
      expect(chromagentTools).toEqual(SIDE_PANEL_TOOL_NAMES);
      for (const name of tesagentTools) {
        expect(chromagentTools, `chromagent must offer tesagent's ${name}`).toContain(name);
      }
      expect(chromagentTools.filter((name) => !tesagentTools.includes(name)).sort()).toEqual([...pageAgentTools].sort());
      for (const name of pageAgentTools) {
        expect(tesagentTools, `tesagent must not offer ${name}`).not.toContain(name);
      }
      const chromagent = agentOf("chromagent");
      for (const name of ["test_plan"]) {
        expect(agentAllows(chromagent.skills, chromagent.excludeSkills, name)).toBe(true);
      }
    });

    it("the sample brand turns todo and the scheduler on (155400-001)", () => {
      const brand = compileBrand(BRAND_DIR) as { tools: Record<string, { enabled: boolean }> };
      expect(brand.tools.todo).toEqual({ enabled: true });
      expect(brand.tools.scheduler).toEqual({ enabled: true });
    });

    describe("debugger-gated tools build warning", () => {
      it("warns when tools is * and excludeTools contains start_debugging", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const tempDir = makeTempDir();
          writeAgent(
            tempDir,
            "chromagent.yml",
            `${VALID_AGENT_YAML}excludeTools:\n  - start_debugging\n`,
          );
          writePlugin(tempDir, "defaultAgent: chromagent\n");
          const brand = compileBrand(tempDir) as { agents: { id: string }[] };
          expect(warn).toHaveBeenCalledTimes(1);
          const message = warn.mock.calls[0][0] as string;
          expect(message).toContain("brand/agents/chromagent.yml");
          expect(message).toContain("start_debugging");
          for (const name of DEBUGGER_GATED_TOOLS) {
            expect(message, `the warning must name the gated tool ${name}`).toContain(name);
          }
          expect(brand.agents).toHaveLength(1);
          expect(brand.agents[0].id).toBe("chromagent");
        } finally {
          warn.mockRestore();
        }
      });

      it("warns naming only the enabled gated tools when tools list omits start_debugging", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const tempDir = makeTempDir();
          writeAgent(
            tempDir,
            "chromagent.yml",
            "displayName: Chromagent\n"
              + "description: Test agent.\n"
              + "instructions: Test.\n"
              + "tools:\n  - page_eval\n  - read_tabs\n"
              + 'skills: "*"\n',
          );
          writePlugin(tempDir, "defaultAgent: chromagent\n");
          compileBrand(tempDir);
          expect(warn).toHaveBeenCalledTimes(1);
          const message = warn.mock.calls[0][0] as string;
          expect(message).toContain("brand/agents/chromagent.yml");
          expect(message).toContain("start_debugging");
          expect(message).toContain("page_eval");
          for (const name of DEBUGGER_GATED_TOOLS) {
            if (name === "page_eval") continue;
            expect(message, `the warning must not name the gated tool ${name}`).not.toContain(name);
          }
        } finally {
          warn.mockRestore();
        }
      });

      it("does not warn when start_debugging and every gated tool are excluded", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const tempDir = makeTempDir();
          writeAgent(
            tempDir,
            "chromagent.yml",
            "displayName: Chromagent\n"
              + "description: Test agent.\n"
              + "instructions: Test.\n"
              + "tools:\n  - read_tabs\n  - open_tab\n"
              + 'skills: "*"\n',
          );
          writePlugin(tempDir, "defaultAgent: chromagent\n");
          compileBrand(tempDir);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      it("does not warn when start_debugging is enabled", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const tempDir = makeTempDir();
          writeDefaultAgent(tempDir);
          writePlugin(tempDir, "defaultAgent: chromagent\n");
          compileBrand(tempDir);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      it("returns identical brand structure when warning is emitted", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const tempDir = makeTempDir();
          writeAgent(
            tempDir,
            "chromagent.yml",
            `${VALID_AGENT_YAML}excludeTools:\n  - start_debugging\n`,
          );
          writePlugin(tempDir, "defaultAgent: chromagent\n");
          const brand = compileBrand(tempDir);
          expect(Object.keys(brand).sort()).toEqual([
            "agents",
            "defaultAgent",
            "hosts",
            "models",
            "options",
            "prompts",
            "skillDefs",
            "skills",
            "themes",
            "tools",
          ]);
        } finally {
          warn.mockRestore();
        }
      });

      it("compiling the repo brand folder produces no warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          compileBrand(BRAND_DIR);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      it("DEBUGGER_GATED_TOOLS exports the 18 expected tools matching SIDE_PANEL_TOOL_NAMES", () => {
        expect(DEBUGGER_GATED_TOOLS).toHaveLength(18);
        expect(new Set(DEBUGGER_GATED_TOOLS).size).toBe(18);
        expect(DEBUGGER_GATED_TOOLS).not.toContain("start_debugging");
        for (const name of DEBUGGER_GATED_TOOLS) {
          expect(SIDE_PANEL_TOOL_NAMES).toContain(name);
        }
      });
    });
  });

  it("lockModel: true compiles to true", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "defaultAgent: chromagent\noptions:\n  lockModel: true\n");
    const brand = compileBrand(tempDir);
    expect(brand.options).toEqual({ lockModel: true, builtInProviders: false });
  });

  it("a non-boolean lockModel leaves the fields editable", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'defaultAgent: chromagent\noptions:\n  lockModel: "yes"\n');
    const brand = compileBrand(tempDir);
    expect(brand.options).toEqual({ lockModel: false, builtInProviders: false });
  });

  it("an absent plugin.yml still requires a defaultAgent", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml defaultAgent is missing; expected chromagent",
    );
  });

  it("an absent model.yml is legal", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "defaultAgent: chromagent\ntools: {}\n");
    const brand = compileBrand(tempDir);
    expect(brand.models).toEqual([]);
  });

  it("model.yml compiles regardless of prompts, given a defaultAgent", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "defaultAgent: chromagent\n");
    writeModel(
      tempDir,
      'models:\n  - id: a\n    label: A\n    endpoint: "https://a.test"\n    wireFormat: openai\n    model: m\n',
    );
    const brand = compileBrand(tempDir);
    expect((brand.models as { id: string }[])[0].id).toBe("a");
    expect(brand.prompts).toEqual({});
  });

  it("an absent prompts key is legal", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "defaultAgent: chromagent\ntools: {}\n");
    const brand = compileBrand(tempDir) as { prompts: Record<string, string> };
    expect(brand.prompts).toEqual({});
  });

  it("one prompt alone is legal", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'defaultAgent: chromagent\nprompts:\n  inPage: "x"\n');
    const brand = compileBrand(tempDir) as { prompts: Record<string, string> };
    expect(brand.prompts).toEqual({ inPage: "x" });
  });

  it("a misspelled agent key fails, naming the key and the accepted value", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'prompts:\n  sidepanel: "x"\n');
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml prompts.sidepanel is not a known agent; expected inPage",
    );
  });

  it("an empty prompt fails, naming the key", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'prompts:\n  inPage: ""\n');
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml prompts.inPage is empty; remove the key instead",
    );
  });

  it("a whitespace-only prompt fails the same way", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'prompts:\n  inPage: "   \\n  "\n');
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml prompts.inPage is empty; remove the key instead",
    );
  });

  it("a non-string prompt fails, naming the key", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "prompts:\n  inPage: 42\n");
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml prompts.inPage must be a string",
    );
  });

  it("a scalar plugin.yml fails, naming the type", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "hello\n");
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml must contain a YAML mapping, got string",
    );
  });

  it("a list plugin.yml fails, naming the type", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "- a\n- b\n");
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml must contain a YAML mapping, got a list",
    );
  });

  it("an empty plugin.yml fails", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "");
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml must contain a YAML mapping, got undefined",
    );
  });

  it("a comment-only plugin.yml fails", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "# a comment\n");
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml must contain a YAML mapping, got null",
    );
  });

  it("a non-mapping prompts value fails", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'prompts: "hello"\n');
    expect(() => compileBrand(tempDir)).toThrow(
      "plugin.yml prompts must be a YAML mapping, got string",
    );
  });

  it("broken YAML fails with a message naming the file", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "a: [\n");
    expect(() => compileBrand(tempDir)).toThrow(/brand\/plugin\.yml/);
  });

  it("a model.yml with no models: list fails", () => {
    const tempDir = makeTempDir();
    writeModel(tempDir, "a: 1\n");
    expect(() => compileBrand(tempDir)).toThrow("model.yml must have a models: list");
  });

  it("an empty models list fails with the cannot-answer message", () => {
    const tempDir = makeTempDir();
    writeModel(tempDir, "models: []\n");
    expect(() => compileBrand(tempDir)).toThrow(
      "model.yml lists no models; an extension with no model cannot answer",
    );
  });

  it("a missing required field fails, naming the index and the field", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: a\n    endpoint: "https://a.test"\n    wireFormat: openai\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow("model.yml models[0].label is required");
  });

  it("an empty required field fails the same way", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: a\n    label: ""\n    endpoint: "https://a.test"\n    wireFormat: openai\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow("model.yml models[0].label is required");
  });

  it("a duplicate id fails, naming the id", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: dup\n    label: A\n    endpoint: "https://a.test"\n    wireFormat: openai\n    model: m\n  - id: dup\n    label: B\n    endpoint: "https://b.test"\n    wireFormat: openai\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow("model.yml has two models with id 'dup'");
  });

  it("an unknown wireFormat fails, naming the value and the three accepted ones", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: a\n    label: A\n    endpoint: "https://a.test"\n    wireFormat: claude\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow(
      "model.yml models[0].wireFormat 'claude' is unknown; expected anthropic, openai or gemini",
    );
  });

  it("an endpoint with no scheme fails", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: a\n    label: A\n    endpoint: "ai.acme.com"\n    wireFormat: openai\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow(
      "model.yml models[0].endpoint must be an absolute http(s) URL",
    );
  });

  it("a non-http scheme fails", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      'models:\n  - id: a\n    label: A\n    endpoint: "ftp://ai.acme.com"\n    wireFormat: openai\n    model: m\n',
    );
    expect(() => compileBrand(tempDir)).toThrow(
      "model.yml models[0].endpoint must be an absolute http(s) URL",
    );
  });

  it("compiles the default model entries with only their supported fields", () => {
    const brand = compileBrand(BRAND_DIR);
    const models = brand.models as { id: string; label: string; provider?: string; vision?: boolean; apiKey?: string }[];
    expect(models.map((entry) => entry.id)).toEqual(["anthropic-sonnet", "openai-sonnet", "gemini-flash"]);
    expect(models.map((entry) => entry.label)).toEqual(["Sonnet", "Sonnet OpenAI", "Gemini Flash"]);
    for (const entry of models) {
      expect(Object.keys(entry).sort()).toEqual(["apiKey", "endpoint", "id", "label", "model", "provider", "vision", "wireFormat"]);
    }
    expect(models.map((e) => [e.provider, e.vision])).toEqual([["Gateway", true], ["Gateway", true], ["Gateway", true]]);
    // The three Gateway entries share one non-empty key. The literal is not
    // repeated here: the acceptance grep allows it only in model.yml.
    expect(new Set(models.map((e) => e.apiKey)).size).toBe(1);
    expect((models[0].apiKey ?? "").length).toBeGreaterThan(0);
  });

  it("compiles optional vision and provider fields", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      `models:
  - id: v1
    label: V1
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m1
    vision: true
  - id: v2
    label: V2
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m2
  - id: v3
    label: V3
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m3
    vision: "yes"
  - id: p1
    label: P1
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m4
    provider: Acme
  - id: p2
    label: P2
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m5
    provider: ""
  - id: p3
    label: P3
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m6
    provider: 5
`,
    );
    writePlugin(tempDir, "defaultAgent: chromagent\n");
    writeDefaultAgent(tempDir);
    const brand = compileBrand(tempDir);
    const models = brand.models as { id: string; vision?: boolean; provider?: string }[];
    expect(models[0].vision).toBe(true);
    expect(models[1].vision).toBe(false);
    expect(models[2].vision).toBe(false);
    expect(models[3].provider).toBe("Acme");
    expect("provider" in models[4]).toBe(false);
    expect("provider" in models[5]).toBe(false);
  });

  it("compiles an optional apiKey: trimmed when non-blank, dropped otherwise", () => {
    const tempDir = makeTempDir();
    writeModel(
      tempDir,
      `models:
  - id: k1
    label: K1
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m1
    apiKey: "  k1  "
  - id: k2
    label: K2
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m2
    apiKey: ""
  - id: k3
    label: K3
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m3
    apiKey: "   "
  - id: k4
    label: K4
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m4
    apiKey: 5
  - id: k5
    label: K5
    endpoint: "https://a.test/v1"
    wireFormat: openai
    model: m5
`,
    );
    writePlugin(tempDir, "defaultAgent: chromagent\n");
    writeDefaultAgent(tempDir);
    const brand = compileBrand(tempDir);
    const models = brand.models as { id: string; apiKey?: string }[];
    expect(models[0].apiKey).toBe("k1");
    expect("apiKey" in models[1]).toBe(false);
    expect("apiKey" in models[2]).toBe(false);
    expect("apiKey" in models[3]).toBe(false);
    expect("apiKey" in models[4]).toBe(false);
  });

  it("broken YAML in model.yml names the file", () => {
    const tempDir = makeTempDir();
    writeModel(tempDir, "models: [\n");
    expect(() => compileBrand(tempDir)).toThrow(/brand\/model\.yml/);
  });

  describe("skills", () => {
    it("C2: brand/skills/README.md in the real folder does not throw and skillDefs is empty", () => {
      const brand = compileBrand(BRAND_DIR) as { skillDefs: unknown[] };
      expect(brand.skillDefs).toEqual([]);
    });

    it("C3: one valid skill file compiles to one SkillDef", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      writeSkill(
        tempDir,
        "claims_lookup.md",
        "---\nname: claims_lookup\ndescription: Find a claim by number.\n---\n\nExplain the claim.\n",
      );
      const brand = compileBrand(tempDir) as {
        skillDefs: { name: string; description: string; definition: string; command: boolean; argumentHint?: string }[];
      };
      expect(brand.skillDefs).toHaveLength(1);
      const [skill] = brand.skillDefs;
      expect(skill.name).toBe("claims_lookup");
      expect(skill.description).toBe("Find a claim by number.");
      expect(skill.definition).toBe("Explain the claim.");
      expect(skill.command).toBe(false);
      expect(skill.argumentHint).toBeUndefined();
    });

    it("C4: command: true and an argumentHint are carried through", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      writeSkill(
        tempDir,
        "claims_lookup.md",
        '---\nname: claims_lookup\ndescription: Find a claim.\ncommand: true\nargumentHint: "[claim number]"\n---\n\nBody text.\n',
      );
      const brand = compileBrand(tempDir) as {
        skillDefs: { command: boolean; argumentHint?: string }[];
      };
      expect(brand.skillDefs[0].command).toBe(true);
      expect(brand.skillDefs[0].argumentHint).toBe("[claim number]");
    });

    it("C5: skill files are read in sorted-filename order, not directory order", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      writeSkill(tempDir, "c.md", "---\nname: c_skill\ndescription: C.\n---\n\nC body.\n");
      writeSkill(tempDir, "a.md", "---\nname: a_skill\ndescription: A.\n---\n\nA body.\n");
      writeSkill(tempDir, "b.md", "---\nname: b_skill\ndescription: B.\n---\n\nB body.\n");
      const brand = compileBrand(tempDir) as { skillDefs: { name: string }[] };
      expect(brand.skillDefs.map((s) => s.name)).toEqual(["a_skill", "b_skill", "c_skill"]);
    });

    it("C6: no --- at the top fails, naming the file", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "name: bad\ndescription: no frontmatter block\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md has no YAML frontmatter; expected a --- block at the top",
      );
    });

    it("C7: frontmatter opened and never closed fails", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\nname: bad\ndescription: unclosed\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md frontmatter is not closed with ---",
      );
    });

    it("C8: frontmatter with no name fails, naming the file", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\ndescription: no name\n---\n\nbody\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md frontmatter is missing 'name'",
      );
    });

    it("C9: frontmatter with no description fails, naming the file", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\nname: bad\n---\n\nbody\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md frontmatter is missing 'description'",
      );
    });

    it("C10: frontmatter with an empty body fails, naming the file", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\nname: bad\ndescription: empty body\n---\n\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md has frontmatter but no body; the body is the skill's definition",
      );
    });

    it("C11: a capitalised name fails with the lower_snake_case message", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\nname: Claims Lookup\ndescription: Bad name.\n---\n\nbody\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md name 'Claims Lookup' must be lower_snake_case; it is what the model calls",
      );
    });

    it("C12: a non-boolean command fails", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", '---\nname: bad\ndescription: Bad command.\ncommand: "yes"\n---\n\nbody\n');
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md frontmatter 'command' must be true or false",
      );
    });

    it("C13: two files with the same name fail, naming both paths", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "a.md", "---\nname: dup\ndescription: First.\n---\n\nbody a\n");
      writeSkill(tempDir, "b.md", "---\nname: dup\ndescription: Second.\n---\n\nbody b\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "two skills are both named 'dup': brand/skills/a.md and brand/skills/b.md",
      );
    });

    it("C14: an empty frontmatter block throws the missing-name message, not a TypeError", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "bad.md", "---\n---\n\nbody\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "brand/skills/bad.md frontmatter is missing 'name'",
      );
    });

    it("C20: no plugin.yml but a skills folder still requires a defaultAgent", () => {
      const tempDir = makeTempDir();
      writeSkill(tempDir, "a.md", "---\nname: a_skill\ndescription: A.\n---\n\nA body.\n");
      writeAgent(tempDir, "a_skill.yml", VALID_AGENT_YAML);
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml defaultAgent is missing; expected a_skill",
      );
    });
  });

  describe("flag blocks", () => {
    it("C15: tools: { genui: { enabled: false } } fails the build; genui is no longer a group", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\ntools:\n  genui: { enabled: false }\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml tools.genui is not a known tool group; expected scheduler, todo or data",
      );
    });

    it("C16: an unknown tool group fails, listing the three accepted names", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\ntools:\n  genie: { enabled: false }\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml tools.genie is not a known tool group; expected scheduler, todo or data",
      );
    });

    it("C17: skills: { core: { enabled: false } } compiles through", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nskills:\n  core: { enabled: false }\n");
      const brand = compileBrand(tempDir);
      expect(brand.skills).toEqual({ core: { enabled: false } });
    });

    it("C18: an unknown skill group fails, listing the six accepted names", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nskills:\n  coer: { enabled: false }\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml skills.coer is not a known skill group; expected core, dom, pageFetch, tab, websiteEdit or testing",
      );
    });

    it("C19: a flag value that is not { enabled: boolean } fails", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\ntools:\n  data: false\n");
      expect(() => compileBrand(tempDir)).toThrow(
        "plugin.yml tools.data must be a mapping with a boolean 'enabled', for example { enabled: false }",
      );
    });

    it("C22: skills: { websiteEdit: { enabled: false } } compiles through", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nskills:\n  websiteEdit: { enabled: false }\n");
      const brand = compileBrand(tempDir);
      expect(brand.skills).toEqual({ websiteEdit: { enabled: false } });
    });

    it("C23: skills: { testing: { enabled: false } } compiles through", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nskills:\n  testing: { enabled: false }\n");
      const brand = compileBrand(tempDir);
      expect(brand.skills).toEqual({ testing: { enabled: false } });
    });

    it("C21: a plugin.yml with neither block leaves tools and skills empty", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\noptions:\n  lockModel: false\n");
      const brand = compileBrand(tempDir);
      expect(brand.tools).toEqual({});
      expect(brand.skills).toEqual({});
    });
  });

  describe("hosts", () => {
    it("absent hosts key returns an empty list", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, 'defaultAgent: chromagent\nprompts:\n  inPage: "x"\n');
      const brand = compileBrand(tempDir) as { hosts: string[] };
      expect(brand.hosts).toEqual([]);
    });

    it("a list of patterns is carried through unchanged", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, 'defaultAgent: chromagent\nhosts:\n  - "<all_urls>"\n  - "https://acme.com/*"\n');
      const brand = compileBrand(tempDir) as { hosts: string[] };
      expect(brand.hosts).toEqual(["<all_urls>", "https://acme.com/*"]);
    });

    it("a mapping instead of a list throws naming plugin.yml hosts and 'object'", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nhosts:\n  a: 1\n");
      const fn = () => compileBrand(tempDir);
      expect(fn).toThrow(/plugin.yml hosts must be a YAML list of match patterns/);
      expect(fn).toThrow(/object/);
    });

    it("a bare string instead of a list throws", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, 'defaultAgent: chromagent\nhosts: "https://acme.com/*"\n');
      expect(() => compileBrand(tempDir)).toThrow(/must be a YAML list/);
    });

    it("an empty string entry throws naming the index", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, 'defaultAgent: chromagent\nhosts:\n  - ""\n  - "https://a.com/*"\n');
      expect(() => compileBrand(tempDir)).toThrow(/plugin.yml hosts\[0\] must be a non-empty string/);
    });

    it("a non-string entry throws naming the index", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\nhosts:\n  - 42\n");
      expect(() => compileBrand(tempDir)).toThrow(/hosts\[0\] must be a non-empty string/);
    });
  });

  describe("themes", () => {
    function writeTheme(dir: string, relPath: string, contents: string): void {
      const file = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }

    const VALID_THEME_YAML =
      "defaultAgent: chromagent\n"
      + "themes:\n"
      + "  - id: acme-dense\n"
      + "    label: Acme Dense\n"
      + "    scheme: dark\n"
      + "    base: wa2-dark\n"
      + "    css: themes/acme-dense.css\n";

    const VALID_THEME_CSS =
      '[data-theme="acme-dense"] {\n'
      + "  --wa-action-color-info: hsl(150deg 80% 40%);\n"
      + "}\n";

    it("an omitted themes key compiles to an empty list", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, "defaultAgent: chromagent\n");
      expect(compileThemes(tempDir, undefined)).toEqual([]);
      expect((compileBrand(tempDir) as { themes: unknown[] }).themes).toEqual([]);
    });

    it("a valid theme compiles to a brand-themes path", () => {
      const tempDir = makeTempDir();
      writeDefaultAgent(tempDir);
      writePlugin(tempDir, VALID_THEME_YAML);
      writeTheme(tempDir, "themes/acme-dense.css", VALID_THEME_CSS);
      const brand = compileBrand(tempDir) as {
        themes: { id: string; label: string; scheme: string; base: string; css: string; sourcePath: string }[];
      };
      expect(brand.themes).toHaveLength(1);
      expect(brand.themes[0]).toMatchObject({
        id: "acme-dense",
        label: "Acme Dense",
        scheme: "dark",
        base: "wa2-dark",
        css: "brand-themes/acme-dense.css",
      });
      expect(path.isAbsolute(brand.themes[0].sourcePath)).toBe(true);
    });

    it("a non-list themes value throws", () => {
      expect(() => compileThemes("/tmp", "acme")).toThrow(
        "plugin.yml themes must be a list, got string",
      );
    });

    it("a non-mapping entry throws naming the index", () => {
      expect(() => compileThemes("/tmp", ["acme"])).toThrow(
        "plugin.yml themes[0] must be a mapping, got string",
      );
    });

    it("an invalid id throws naming the pattern", () => {
      expect(() => compileThemes("/tmp", [
        { id: "Acme", label: "A", scheme: "dark", base: "wa2-dark", css: "t.css" },
      ])).toThrow('plugin.yml themes[0].id: invalid theme id "Acme"; must match /^[a-z][a-z0-9-]*$/');
    });

    it("a built-in id throws", () => {
      expect(() => compileThemes("/tmp", [
        { id: "wa2-dark", label: "A", scheme: "dark", base: "wa2-dark", css: "t.css" },
      ])).toThrow('plugin.yml themes[0].id: "wa2-dark" collides with a built-in theme');
    });

    it("a duplicate id throws naming the second entry", () => {
      const tempDir = makeTempDir();
      writeTheme(tempDir, "themes/acme-dense.css", VALID_THEME_CSS);
      const entry = { id: "acme-dense", label: "A", scheme: "dark", base: "wa2-dark", css: "themes/acme-dense.css" };
      expect(() => compileThemes(tempDir, [entry, entry])).toThrow(
        'plugin.yml themes[1].id: duplicate theme id "acme-dense"',
      );
    });

    it("an invalid scheme throws naming the accepted values", () => {
      expect(() => compileThemes("/tmp", [
        { id: "acme", label: "A", scheme: "sepia", base: "wa2-dark", css: "t.css" },
      ])).toThrow('plugin.yml themes[0].scheme: invalid scheme "sepia"; expected dark or light');
    });

    it("an invalid base throws naming the built-ins", () => {
      expect(() => compileThemes("/tmp", [
        { id: "acme", label: "A", scheme: "dark", base: "unknown-base", css: "t.css" },
      ])).toThrow(
        'plugin.yml themes[0].base: "unknown-base" is not a built-in theme; expected wa1-dark, wa2-dark or wa2-light',
      );
    });

    it("a missing css file throws naming the path", () => {
      const tempDir = makeTempDir();
      expect(() => compileThemes(tempDir, [
        { id: "acme", label: "A", scheme: "dark", base: "wa2-dark", css: "does-not-exist.css" },
      ])).toThrow("plugin.yml themes[0].css: file not found: does-not-exist.css");
    });

    it("an unknown token runs the checker and throws its exact line", () => {
      const tempDir = makeTempDir();
      writeTheme(tempDir, "themes/bad.css", '[data-theme="acme"] {\n  --wa-font-size-mm: 9px;\n}\n');
      expect(() => compileThemes(tempDir, [
        { id: "acme", label: "A", scheme: "dark", base: "wa2-dark", css: "themes/bad.css" },
      ])).toThrow("plugin.yml themes[0]: error: --wa-font-size-mm is not a web-agent token");
    });
  });
  it("builtInProviders: true compiles to true", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, "defaultAgent: chromagent\noptions:\n  builtInProviders: true\n");
    const brand = compileBrand(tempDir);
    expect(brand.options).toEqual({ lockModel: false, builtInProviders: true });
  });

  it("a non-boolean builtInProviders leaves the custom form in place", () => {
    const tempDir = makeTempDir();
    writeDefaultAgent(tempDir);
    writePlugin(tempDir, 'defaultAgent: chromagent\noptions:\n  builtInProviders: "yes"\n');
    const brand = compileBrand(tempDir);
    expect(brand.options).toEqual({ lockModel: false, builtInProviders: false });
  });
});
