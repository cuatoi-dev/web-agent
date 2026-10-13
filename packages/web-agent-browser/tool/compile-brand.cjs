const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const { SIDE_PANEL_TOOL_NAMES } = require("./sidepanel-tools.cjs");

/** Theme ids the registry already ships. A brand theme may not reuse one. */
const THEME_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const BUILT_IN_THEME_IDS = ["wa1-dark", "wa2-dark", "wa2-light"];
const THEME_SCHEMES = ["dark", "light"];

/** The only agent a prompt may name. `plugin.yml` is the brand owner's file,
 *  so a misspelled key is a mistake, not an extension point. Side panel
 *  agents get their prompt from `instructions` in `brand/agents/<id>.yml`
 *  instead. */
const AGENT_PROMPT_KEYS = ["inPage"];

/** The side panel skills every agent may name in `skills` / `excludeSkills`
 *  without shipping its own `brand/skills/` file — the built-in sets
 *  `mergeBrandSkills` spreads for the side panel (`tabSkills()` names, plus
 *  `website_edit`, `playwright_script`, `test_plan` and `test_healer`). A name
 *  here builds even when its group is switched off; the group switch removes it
 *  at run time. */
const BUILTIN_SIDE_PANEL_SKILLS = ["tab_management", "page_agent", "website_edit", "playwright_script", "test_plan", "test_healer"];

/** The three wire formats the bubble accepts
 *  (src/lib/types.ts:20). A fourth value is a typo, not an extension point. */
const WIRE_FORMATS = ["anthropic", "openai", "gemini"];

/** Every field a model entry must carry as a non-empty string. `streaming` is
 *  optional and is filled in with false. */
const MODEL_FIELDS = ["id", "label", "endpoint", "wireFormat", "model"];

/** The four tool groups `plugin.yml`'s `tools` block may switch. `scheduler`
 *  and `todo` are host opt-ins on the session config
 *  (packages/web-agent-core/src/controller.types.ts:118,121). `data` and
 *  `genui` are built by dataTools() and genuiTools()
 *  (packages/web-agent-core/src/tools/builders.ts:60,70). */
const TOOL_GROUPS = ["scheduler", "todo", "data", "genui"];

/** The six skill groups `plugin.yml`'s `skills` block may switch. They are the
 *  built-in sets the two agents spread today: core, dom and pageFetch in the
 *  bubble (src/content.ts, `mount`), tab, websiteEdit and playwright in the
 *  side panel (src/sidepanel.ts, `buildAgentPanel`). */
const SKILL_GROUPS = ["core", "dom", "pageFetch", "tab", "websiteEdit", "playwright"];

/** The shape a skill's `name` must take. It is what the model calls and what
 *  the user types after a slash, so a space or a capital cannot be invoked. */
const SKILL_NAME = /^[a-z][a-z0-9_]*$/;

/** The one file in `brand/skills/` that is documentation, not a skill. The
 *  default brand ships the folder holding nothing else. */
const SKILLS_README = "README.md";

/** Every key `dist/brand.json` carries, all empty. A brand that leaves a block
 *  out keeps the key with its empty value, so a reader never has to test for a
 *  missing key. */
function emptyBrand() {
  return {
    agents: [],
    defaultAgent: "",
    prompts: {},
    tools: {},
    skills: {},
    options: {},
    models: [],
    skillDefs: [],
    hosts: [],
    themes: [],
  };
}

/**
 * Validates and compiles plugin.yml's `themes` array.
 *
 * Every failure names plugin.yml, the entry index and the offending field.
 * The CSS file is checked by `web-agent-theme-check.mjs` before the entry is
 * accepted, so a typo in a token name fails the build instead of shipping a
 * theme that silently does nothing.
 *
 * @param {string} brandDir - the `brand/` folder
 * @param {unknown} rawThemes - the raw value of plugin.yml's `themes`
 * @returns {Array<{id: string, label: string, scheme: string, base: string, css: string, sourcePath: string}>}
 * @throws {Error} naming plugin.yml, the entry index and the offending field,
 *   or the checker's own error line
 */
function compileThemes(brandDir, rawThemes) {
  if (rawThemes === undefined) return [];
  if (!Array.isArray(rawThemes)) {
    throw new Error(`plugin.yml themes must be a list, got ${describe(rawThemes)}`);
  }
  const checkerScript = path.resolve(__dirname, "../../web-agent-lit/bin/web-agent-theme-check.mjs");
  const seenIds = new Set();
  const compiled = [];

  for (let i = 0; i < rawThemes.length; i++) {
    const entry = rawThemes[i];
    if (!isMapping(entry)) {
      throw new Error(`plugin.yml themes[${i}] must be a mapping, got ${describe(entry)}`);
    }
    const { id, label, scheme, base, css } = entry;
    if (typeof id !== "string" || !THEME_ID_PATTERN.test(id)) {
      throw new Error(`plugin.yml themes[${i}].id: invalid theme id "${id}"; must match /^[a-z][a-z0-9-]*$/`);
    }
    if (BUILT_IN_THEME_IDS.includes(id)) {
      throw new Error(`plugin.yml themes[${i}].id: "${id}" collides with a built-in theme`);
    }
    if (seenIds.has(id)) {
      throw new Error(`plugin.yml themes[${i}].id: duplicate theme id "${id}"`);
    }
    seenIds.add(id);

    if (typeof label !== "string" || label.trim() === "") {
      throw new Error(`plugin.yml themes[${i}].label: missing or empty label`);
    }
    if (!THEME_SCHEMES.includes(scheme)) {
      throw new Error(`plugin.yml themes[${i}].scheme: invalid scheme "${scheme}"; expected ${orList(THEME_SCHEMES)}`);
    }
    if (typeof base !== "string" || !BUILT_IN_THEME_IDS.includes(base)) {
      throw new Error(`plugin.yml themes[${i}].base: "${base}" is not a built-in theme; expected ${orList(BUILT_IN_THEME_IDS)}`);
    }
    if (typeof css !== "string" || css.trim() === "") {
      throw new Error(`plugin.yml themes[${i}].css: missing or empty css path`);
    }
    const cssPath = path.resolve(brandDir, css);
    if (!fs.existsSync(cssPath)) {
      throw new Error(`plugin.yml themes[${i}].css: file not found: ${css}`);
    }

    // Run the theme checker. A non-zero exit with no "error:" line still fails.
    const run = spawnSync(process.execPath, [checkerScript, cssPath, "--base", base], { encoding: "utf8" });
    const output = (run.stdout || "") + "\n" + (run.stderr || "");
    const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
    const errorLine = lines.find((l) => l.startsWith("error:"));
    if (errorLine || run.status !== 0) {
      throw new Error(`plugin.yml themes[${i}]: ${errorLine || "theme check failed"}`);
    }
    for (const w of lines.filter((l) => l.startsWith("warn:"))) {
      console.warn(`plugin.yml themes[${i}]: ${w}`);
    }

    compiled.push({
      id,
      label,
      scheme,
      base,
      css: `brand-themes/${id}.css`,
      sourcePath: cssPath,
    });
  }
  return compiled;
}

/** True for a YAML mapping. `typeof []` is `"object"` and `typeof null` is
 *  `"object"`, so both are ruled out by hand. */
function isMapping(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The word the failure message uses for a value that is not a mapping. */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value;
}

/** "a, b or c" — the tail of an "expected …" message. */
function orList(values) {
  if (values.length < 2) return values.join("");
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

/**
 * Compiles one `{ group: { enabled: boolean } }` block from `plugin.yml`.
 *
 * An absent block is `{}` and every group keeps its default. An unknown group
 * name throws, for the same reason a misspelled prompt key does: a silently
 * ignored flag is the failure this feature exists to stop.
 *
 * @param {unknown} block - the raw value of `plugin.yml`'s `tools` or `skills`
 * @param {string} blockName - "tools" or "skills"
 * @param {string} groupWord - "tool" or "skill", for the message
 * @param {string[]} groups - the group names this block accepts
 * @returns {Record<string, {enabled: boolean}>}
 * @throws {Error} naming plugin.yml, the block, the key and the accepted names
 */
function compileFlags(block, blockName, groupWord, groups) {
  if (block === undefined) return {};
  if (!isMapping(block)) {
    throw new Error(`plugin.yml ${blockName} must be a YAML mapping, got ${describe(block)}`);
  }
  const out = {};
  for (const key of Object.keys(block)) {
    if (!groups.includes(key)) {
      throw new Error(
        `plugin.yml ${blockName}.${key} is not a known ${groupWord} group; `
        + `expected ${orList(groups)}`,
      );
    }
    const value = block[key];
    if (!isMapping(value) || typeof value.enabled !== "boolean") {
      throw new Error(
        `plugin.yml ${blockName}.${key} must be a mapping with a boolean 'enabled', `
        + "for example { enabled: false }",
      );
    }
    out[key] = { enabled: value.enabled };
  }
  return out;
}

/**
 * Compiles `plugin.yml`'s `hosts` list.
 *
 * Only the shape is checked here — that it is a list of non-empty strings. Each
 * entry is checked against Chrome's match-pattern grammar by `deriveHosts` in
 * tool/manifest.cjs, where the pattern is actually used.
 *
 * @param {unknown} block - the raw value of plugin.yml's `hosts`
 * @returns {string[]}
 * @throws {Error} naming plugin.yml and what it found
 */
function compileHosts(block) {
  if (block === undefined) return [];
  if (!Array.isArray(block)) {
    throw new Error(`plugin.yml hosts must be a YAML list of match patterns, got ${describe(block)}`);
  }
  block.forEach((entry, i) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`plugin.yml hosts[${i}] must be a non-empty string`);
    }
  });
  return block;
}

/**
 * Compiles one `brand/skills/<file>.md` into a `SkillDef`.
 *
 * The frontmatter is a `---` block at the very top; the body below it is the
 * skill's definition. Every failure names the file, because the brand owner is
 * looking at a folder of them.
 *
 * @param {string} file - absolute path to the skill file
 * @returns {{name: string, description: string, definition: string, command: boolean, argumentHint: (string|undefined)}}
 * @throws {Error} naming the file and the offending part
 */
function compileSkill(file) {
  const where = `brand/skills/${path.basename(file)}`;
  const text = fs.readFileSync(file, "utf8");

  if (!text.startsWith("---\n")) {
    throw new Error(`${where} has no YAML frontmatter; expected a --- block at the top`);
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`${where} frontmatter is not closed with ---`);
  }

  // yaml.load("") returns undefined, not {} — verified against js-yaml 4.3.0 on
  // 2026-09-11. Without this an empty frontmatter block would throw a
  // TypeError instead of the "missing 'name'" message below.
  const parsed = yaml.load(text.slice(4, end), { filename: where });
  const fm = isMapping(parsed) ? parsed : {};
  const body = text.slice(end + 4).trim();

  if (typeof fm.name !== "string" || fm.name.trim() === "") {
    throw new Error(`${where} frontmatter is missing 'name'`);
  }
  if (!SKILL_NAME.test(fm.name)) {
    throw new Error(
      `${where} name '${fm.name}' must be lower_snake_case; it is what the model calls`,
    );
  }
  if (typeof fm.description !== "string" || fm.description.trim() === "") {
    throw new Error(`${where} frontmatter is missing 'description'`);
  }
  if (body === "") {
    throw new Error(`${where} has frontmatter but no body; the body is the skill's definition`);
  }
  if (fm.command !== undefined && typeof fm.command !== "boolean") {
    throw new Error(`${where} frontmatter 'command' must be true or false`);
  }

  return {
    name: fm.name,
    description: fm.description,
    definition: body,
    command: fm.command ?? false,
    argumentHint: fm.argumentHint,
  };
}

/**
 * Compiles every skill file in `brand/skills/` into the list `dist/brand.json`
 * carries.
 *
 * An absent folder returns an empty list. Files are read in sorted order so the
 * output is deterministic, and a duplicate `name` throws rather than
 * last-wins — which file won would otherwise depend on directory order.
 *
 * `README.md` is skipped: the default brand ships the folder with only that
 * file in it, and a README has no frontmatter. Every other `.md` file is a
 * skill file.
 *
 * @param {string} brandDir - the `brand/` folder
 * @returns {object[]}
 * @throws {Error} naming the offending file, or both files on a duplicate name
 */
function compileSkills(brandDir) {
  const dir = path.resolve(brandDir, "skills");
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== SKILLS_README)
    .sort();

  const out = [];
  const seen = new Map();
  for (const file of files) {
    const skill = compileSkill(path.join(dir, file));
    if (seen.has(skill.name)) {
      throw new Error(
        `two skills are both named '${skill.name}': `
        + `brand/skills/${seen.get(skill.name)} and brand/skills/${file}`,
      );
    }
    seen.set(skill.name, file);
    out.push(skill);
  }
  return out;
}

/**
 * Compiles `brand/model.yml` into the entry list `dist/brand.json` carries.
 *
 * An absent file returns an empty list, which the runtime reads as "fall back
 * to the compiled presets". A file that is present but wrong fails the build:
 * a brand owner who wrote the file meant it to be used.
 *
 * @param {string} brandDir - the `brand/` folder
 * @returns {{id: string, label: string, endpoint: string, wireFormat: string, model: string, streaming: boolean}[]}
 * @throws {Error} naming `model.yml`, the entry index and the offending field
 */
function compileModels(brandDir) {
  const modelPath = path.resolve(brandDir, "model.yml");
  if (!fs.existsSync(modelPath)) return [];

  const doc = yaml.load(fs.readFileSync(modelPath, "utf8"), {
    filename: "brand/model.yml",
  });
  if (!isMapping(doc) || !Array.isArray(doc.models)) {
    throw new Error("model.yml must have a models: list");
  }
  if (doc.models.length === 0) {
    throw new Error("model.yml lists no models; an extension with no model cannot answer");
  }

  const seen = new Set();
  doc.models.forEach((entry, i) => {
    if (!isMapping(entry)) {
      throw new Error(`model.yml models[${i}] must be a YAML mapping, got ${describe(entry)}`);
    }
    for (const field of MODEL_FIELDS) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new Error(`model.yml models[${i}].${field} is required`);
      }
    }
    // Duplicate ids are fatal, not last-wins: the picker keys on id, so a
    // duplicate silently hides an entry the brand owner shipped.
    if (seen.has(entry.id)) {
      throw new Error(`model.yml has two models with id '${entry.id}'`);
    }
    seen.add(entry.id);
    if (!WIRE_FORMATS.includes(entry.wireFormat)) {
      throw new Error(
        `model.yml models[${i}].wireFormat '${entry.wireFormat}' is unknown; `
        + "expected anthropic, openai or gemini",
      );
    }
    let url = null;
    try {
      url = new URL(entry.endpoint);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new Error(`model.yml models[${i}].endpoint must be an absolute http(s) URL`);
    }
    if (entry.streaming !== undefined && typeof entry.streaming !== "boolean") {
      throw new Error(`model.yml models[${i}].streaming must be true or false`);
    }
    entry.streaming = entry.streaming ?? false;
  });

  return doc.models;
}

/**
 * Compiles every `brand/agents/<id>.yml` file into the agent list
 * `dist/brand.json` carries.
 *
 * At least one agent file is required — an extension with no agent has
 * nothing to run. Files are read in sorted order so the output is
 * deterministic. Every failure names the file, key or name at fault, because
 * the brand owner is looking at a folder of them.
 *
 * @param {string} brandDir - the `brand/` folder
 * @param {string[]} modelIds - every id in `brand/model.yml`, for validating `model`
 * @param {string[]} skillNames - every side panel skill name, for validating `skills` / `excludeSkills`
 * @param {string[]} toolNames - every side panel tool name, for validating `tools` / `excludeTools`
 * @returns {object[]}
 * @throws {Error} naming the offending file, key or name
 */
function compileAgents(brandDir, modelIds, skillNames, toolNames) {
  const dir = path.resolve(brandDir, "agents");
  if (!fs.existsSync(dir)) {
    throw new Error("brand/agents/ has no agent files; add at least one <id>.yml, for example chromagent.yml");
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .sort();

  if (files.length === 0) {
    throw new Error("brand/agents/ has no agent files; add at least one <id>.yml, for example chromagent.yml");
  }

  const agents = [];
  for (const file of files) {
    const id = path.basename(file, ".yml");
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
      throw new Error(
        `brand/agents/${file} file name must use lowercase letters, digits, - and _, starting with a letter`,
      );
    }
    const where = `brand/agents/${file}`;
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const doc = yaml.load(raw, { filename: where });
    if (!isMapping(doc)) {
      throw new Error(`brand/agents/${file} must contain a YAML mapping, got ${describe(doc)}`);
    }

    for (const key of ["displayName", "description", "instructions"]) {
      if (typeof doc[key] !== "string" || doc[key].trim() === "") {
        throw new Error(`brand/agents/${file} ${key} must be a non-empty string`);
      }
    }

    if (doc.model !== undefined) {
      if (typeof doc.model !== "string" || !modelIds.includes(doc.model)) {
        throw new Error(
          `brand/agents/${file} model "${doc.model}" is not an id in model.yml; expected ${modelIds.join(", ")}`,
        );
      }
    }

    for (const key of ["tools", "skills"]) {
      const val = doc[key];
      const isStringList = Array.isArray(val) && val.every((item) => typeof item === "string");
      if (val !== "*" && !isStringList) {
        throw new Error(`brand/agents/${file} ${key} must be "*" or a list of names`);
      }
    }

    for (const key of ["excludeTools", "excludeSkills"]) {
      const val = doc[key];
      if (val !== undefined) {
        const isStringList = Array.isArray(val) && val.every((item) => typeof item === "string");
        if (!isStringList) {
          throw new Error(`brand/agents/${file} ${key} must be a list of names`);
        }
      }
    }

    for (const key of ["tools", "excludeTools"]) {
      const val = doc[key];
      if (Array.isArray(val)) {
        for (const name of val) {
          if (!toolNames.includes(name)) {
            throw new Error(
              `brand/agents/${file} ${key} lists "${name}", which is not a side panel tool; expected "*" or names such as read_tabs, page_eval, page_screenshot`,
            );
          }
        }
      }
    }

    for (const key of ["skills", "excludeSkills"]) {
      const val = doc[key];
      if (Array.isArray(val)) {
        for (const name of val) {
          if (!skillNames.includes(name)) {
            const sample = skillNames.slice(0, 3).join(", ");
            throw new Error(
              `brand/agents/${file} ${key} lists "${name}", which is not a side panel skill; expected "*" or names such as ${sample}`,
            );
          }
        }
      }
    }

    const agent = {
      id,
      displayName: doc.displayName,
      description: doc.description,
      instructions: doc.instructions,
      tools: doc.tools,
      skills: doc.skills,
    };
    if (doc.model !== undefined) agent.model = doc.model;
    if (doc.excludeTools !== undefined) agent.excludeTools = doc.excludeTools;
    if (doc.excludeSkills !== undefined) agent.excludeSkills = doc.excludeSkills;
    agents.push(agent);
  }

  return agents;
}

/**
 * Compiles `brand/` into the object `dist/brand.json` holds.
 *
 * An absent `plugin.yml`, and an absent `prompts` key, are both legal and mean
 * "today's behaviour". An unknown or empty prompt key throws, because a
 * silently ignored prompt is the failure mode this feature exists to prevent.
 *
 * @param {string} brandDir - the `brand/` folder
 * @returns {{agents: object[], defaultAgent: string, prompts: Record<string, string>, tools: object, skills: object, options: object, models: unknown[], skillDefs: unknown[], hosts: string[]}}
 * @throws {Error} naming `plugin.yml` or `brand/agents/`, the offending key, and the accepted values
 */
function compileBrand(brandDir) {
  const brand = emptyBrand();
  brand.models = compileModels(brandDir);
  // A brand may ship skills and no plugin.yml — the folder is read either way.
  brand.skillDefs = compileSkills(brandDir);
  const modelIds = brand.models.map((m) => m.id);
  const skillNames = [...BUILTIN_SIDE_PANEL_SKILLS, ...brand.skillDefs.map((s) => s.name)];
  brand.agents = compileAgents(brandDir, modelIds, skillNames, SIDE_PANEL_TOOL_NAMES);

  const pluginPath = path.resolve(brandDir, "plugin.yml");
  // The `filename` option puts "brand/plugin.yml" into a YAMLException's own
  // message, so a syntax error names the file without a second catch block.
  const plugin = fs.existsSync(pluginPath)
    ? yaml.load(fs.readFileSync(pluginPath, "utf8"), { filename: "brand/plugin.yml" })
    : {};
  if (!isMapping(plugin)) {
    throw new Error(`plugin.yml must contain a YAML mapping, got ${describe(plugin)}`);
  }

  const prompts = plugin.prompts ?? {};
  if (!isMapping(prompts)) {
    throw new Error(`plugin.yml prompts must be a YAML mapping, got ${describe(prompts)}`);
  }
  if (Object.prototype.hasOwnProperty.call(prompts, "sidePanel")) {
    throw new Error(
      "plugin.yml prompts.sidePanel is no longer read; move the text to instructions in brand/agents/<id>.yml",
    );
  }
  for (const key of Object.keys(prompts)) {
    if (!AGENT_PROMPT_KEYS.includes(key)) {
      throw new Error(
        `plugin.yml prompts.${key} is not a known agent; expected ${orList(AGENT_PROMPT_KEYS)}`,
      );
    }
    if (typeof prompts[key] !== "string") {
      throw new Error(`plugin.yml prompts.${key} must be a string`);
    }
    if (prompts[key].trim() === "") {
      throw new Error(`plugin.yml prompts.${key} is empty; remove the key instead`);
    }
  }

  const agentIds = brand.agents.map((a) => a.id);
  if (typeof plugin.defaultAgent !== "string" || plugin.defaultAgent.trim() === "") {
    throw new Error(`plugin.yml defaultAgent is missing; expected ${orList(agentIds)}`);
  }
  if (!agentIds.includes(plugin.defaultAgent)) {
    throw new Error(
      `plugin.yml defaultAgent "${plugin.defaultAgent}" has no file brand/agents/${plugin.defaultAgent}.yml; expected ${orList(agentIds)}`,
    );
  }
  brand.defaultAgent = plugin.defaultAgent;
  brand.prompts = prompts;

  // `=== true` rather than a validation branch: the plan asks for one flag with
  // a default of false, and nothing more. Anything that is not the boolean true
  // leaves the fields editable, which is the documented default.
  const options = isMapping(plugin.options) ? plugin.options : {};
  brand.options = { lockModel: options.lockModel === true };
  brand.tools = compileFlags(plugin.tools, "tools", "tool", TOOL_GROUPS);
  brand.skills = compileFlags(plugin.skills, "skills", "skill", SKILL_GROUPS);
  brand.hosts = compileHosts(plugin.hosts);
  brand.themes = compileThemes(brandDir, plugin.themes);
  return brand;
}

module.exports = {
  compileBrand,
  compileModels,
  compileSkill,
  compileSkills,
  compileAgents,
  compileFlags,
  compileHosts,
  compileThemes,
  emptyBrand,
  AGENT_PROMPT_KEYS,
  BUILT_IN_THEME_IDS,
  THEME_SCHEMES,
  WIRE_FORMATS,
  TOOL_GROUPS,
  SKILL_GROUPS,
  SIDE_PANEL_TOOL_NAMES,
};
