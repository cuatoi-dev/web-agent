import type { JsonSchemaObject } from "@cuatoi/web-agent-core";

export const READ_FILE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path, for example /home/agent/notes.md." },
    offset: { type: "integer", minimum: 1, description: "1-based line number to start from." },
    limit: { type: "integer", minimum: 1, description: "How many lines to read. Default 2000." },
  },
  required: ["file_path"],
  additionalProperties: false,
};

export const WRITE_FILE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path, for example /home/agent/notes.md." },
    content: { type: "string", description: "The file content. Base64 text when encoding is base64." },
    encoding: { type: "string", enum: ["utf8", "base64"], description: "Default utf8. Use base64 for an image." },
    mime_type: { type: "string", description: "Required when encoding is base64. A text file takes its type from the extension." },
  },
  required: ["file_path", "content"],
  additionalProperties: false,
};

export const EDIT_FILE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path of the file to change." },
    old_string: { type: "string", description: "The exact text to replace. Plain text, not a regular expression." },
    new_string: { type: "string", description: "The replacement text." },
    replace_all: { type: "boolean", description: "Replace every occurrence. Default false." },
  },
  required: ["file_path", "old_string", "new_string"],
  additionalProperties: false,
};

export const READ_FILE_DESCRIPTION =
  "Read a file from the agent file system. Text comes back with line numbers. An image comes back as a picture you can see. Paths are absolute, for example /home/agent/notes.md.";

export const WRITE_FILE_DESCRIPTION =
  "Create a file, or overwrite one you have already read in this chat. Writable paths are /tmp, /home/agent and /home/shared unless the app mounts more. Use encoding base64 with mime_type to write an image.";

export const EDIT_FILE_DESCRIPTION =
  "Replace exact text in a file you have already read in this chat. The old text must appear once, unless you set replace_all.";

export const GLOB_FILES_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Glob pattern to match files against, for example **/*.md or data/*.csv." },
    path: { type: "string", description: "Folder path to search in. Default /home/agent." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

export const SEARCH_FILES_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Regular expression pattern to search for." },
    path: { type: "string", description: "File or folder path to search in. Default /home/agent." },
    glob: { type: "string", description: "Glob pattern to filter files, for example *.csv." },
    output_mode: {
      type: "string",
      enum: ["content", "files_with_matches", "count"],
      description: "Output format. Default files_with_matches.",
    },
    "-i": { type: "boolean", description: "Case-insensitive matching." },
    "-n": { type: "boolean", description: "Show line numbers. Default true in content mode." },
    "-o": { type: "boolean", description: "Only show the matched part of the line." },
    "-A": { type: "integer", minimum: 0, description: "Lines of context to show after each match." },
    "-B": { type: "integer", minimum: 0, description: "Lines of context to show before each match." },
    "-C": { type: "integer", minimum: 0, description: "Lines of context to show before and after each match." },
    context: { type: "integer", minimum: 0, description: "Alias for -C." },
    multiline: { type: "boolean", description: "Match across multiple lines with multiline and dotall flags." },
    head_limit: { type: "integer", minimum: 0, description: "Maximum number of results to return. Default 250 (0 = unlimited)." },
    offset: { type: "integer", minimum: 0, description: "0-based offset into the result list. Default 0." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

export const DELETE_FILE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path of the file to remove, for example /home/agent/notes.md." },
  },
  required: ["file_path"],
  additionalProperties: false,
};

export const MOVE_FILE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    source_path: { type: "string", description: "Absolute path of the existing file to move or rename." },
    destination_path: { type: "string", description: "Absolute path of the new location." },
  },
  required: ["source_path", "destination_path"],
  additionalProperties: false,
};

export const GLOB_FILES_DESCRIPTION =
  "Find files matching a glob pattern across mounts. Lists newest files first, up to 100 paths.";

export const SEARCH_FILES_DESCRIPTION =
  "Search text file contents using regular expressions. Supports content with line numbers/context, file names only, or match counts.";

export const DELETE_FILE_DESCRIPTION =
  "Delete one file from the agent file system. Writable paths are /tmp, /home/agent and /home/shared unless the app mounts more.";

export const MOVE_FILE_DESCRIPTION =
  "Move or rename one file. Works across mounts (for example from /tmp to /home/agent). Fails if the destination exists.";

export const JSON_GET_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path of a .json file, for example /home/agent/data.json." },
    path: { type: "string", description: "Lodash path to read, for example users[3].email or settings.retries. Omit to read the whole document." },
    where: { type: "object", description: "On a list: keep items whose fields all match these key-value pairs (equality only, dotted keys allowed)." },
    fields: { type: "array", items: { type: "string" }, description: "On a list: show only these keys of each item." },
    offset: { type: "integer", description: "On a list: skip this many matching items. Default 0." },
    limit: { type: "integer", description: "On a list: return at most this many items. Default 50." },
  },
  required: ["file_path"],
  additionalProperties: false,
};

export const JSON_GET_DESCRIPTION =
  "Read a value or a page of list items from a JSON file by path. Dotted paths and brackets are supported (for example users[0].id).";

export const JSON_EDIT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path of the .json file to edit." },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["set", "delete", "append", "insert", "update", "remove", "upsert"],
            description: "The operation to perform.",
          },
          path: { type: "string", description: "Target lodash path in the document." },
          value: { description: "Value for set, append, insert, or upsert." },
          index: { type: "integer", description: "0-based position for insert." },
          where: { type: "object", description: "Filter for update or remove: key-value equality conditions." },
          merge: { type: "object", description: "Fields to merge into matching items for update." },
          expect: { type: "integer", description: "Expected count of matching items for update or remove." },
          key: { type: "string", description: "Identifier key for upsert." },
        },
        required: ["op", "path"],
        additionalProperties: false,
      },
      description: "List of changes to apply in order, all or nothing.",
    },
  },
  required: ["file_path", "changes"],
  additionalProperties: false,
};

export const JSON_EDIT_DESCRIPTION =
  "Apply a list of edits to a JSON file by path: set, delete, append, insert, update, remove, or upsert. All changes apply or none are saved.";
