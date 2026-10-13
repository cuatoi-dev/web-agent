import type { CustomToolDef, ToolOutcome, ToolContext, JsonSchemaObject } from "@cuatoi/web-agent-core";
import { sanitizeName } from "@cuatoi/web-agent-core";
import type {
  ApiSourceConfig,
  ApiOperationDescriptor,
  ApiToolDef,
  ApiToolParameterLocationMap,
} from "./types.js";

/** Placeholder execute handler used when no `execute` is passed; `buildApiTool` replaces it with the live executor. */
const defaultExecute = (): Promise<ToolOutcome> =>
  Promise.resolve({
    content: "API operation execution not implemented.",
  });

/**
 * Map an operation descriptor to an ApiToolDef containing a CustomToolDef and parameter location metadata.
 */
export function operationToToolDef(
  source: ApiSourceConfig,
  descriptor: ApiOperationDescriptor,
  execute?: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>,
): ApiToolDef {
  const sanitizedSource = sanitizeName(source.name, "api");
  const sanitizedOp = sanitizeName(descriptor.operationId, "op");
  const toolName = `${sanitizedSource}_${sanitizedOp}`;

  const description =
    descriptor.summary?.trim() ||
    descriptor.description?.trim() ||
    `API operation ${descriptor.operationId} from ${source.name}`;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  const seenParamNames = new Set<string>();

  for (const param of descriptor.parameters) {
    if (seenParamNames.has(param.name)) {
      throw new Error(
        `API source "${source.name}" operation "${descriptor.operationId}" has duplicate parameter name "${param.name}" across parameter locations.`,
      );
    }
    seenParamNames.add(param.name);

    properties[param.name] = param.schema;

    if (param.in === "path") {
      pathParams.push(param.name);
      required.push(param.name);
    } else if (param.in === "query") {
      queryParams.push(param.name);
      if (param.required) {
        required.push(param.name);
      }
    }
  }

  let hasBody = false;
  if (descriptor.requestBody) {
    if (seenParamNames.has("body")) {
      throw new Error(
        `API source "${source.name}" operation "${descriptor.operationId}" parameter "body" collides with requestBody.`,
      );
    }
    hasBody = true;
    properties["body"] = descriptor.requestBody.schema;
    if (descriptor.requestBody.required) {
      required.push("body");
    }
  }

  const inputSchema: JsonSchemaObject = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  const paramLocations: ApiToolParameterLocationMap = {
    path: pathParams,
    query: queryParams,
    hasBody,
  };

  const toolDef: CustomToolDef = {
    name: toolName,
    description,
    inputSchema,
    execute: execute ?? defaultExecute,
  };

  return {
    toolDef,
    source,
    descriptor,
    paramLocations,
  };
}
