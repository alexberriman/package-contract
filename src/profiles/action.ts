import { compareCodeUnits } from "../core/order.js";

export type ActionValue =
  | boolean
  | number
  | string
  | null
  | readonly ActionValue[]
  | { readonly [key: string]: ActionValue };

export type RuntimeActionInput =
  | {
      readonly exportName: string;
      readonly kind: "call";
      readonly arguments?: readonly ActionValue[];
      readonly subpath: string;
    }
  | {
      readonly exportName: string;
      readonly kind: "export";
      readonly subpath: string;
    }
  | {
      readonly exportName: string;
      readonly kind: "read-file";
      readonly subpath: string;
    };

export interface RuntimeAction {
  readonly arguments: readonly ActionValue[];
  readonly exportName: string;
  readonly kind: RuntimeActionInput["kind"];
  readonly subpath: string;
}

export interface BinActionInput {
  readonly arguments?: readonly string[];
  readonly name: string;
}

export interface BinAction {
  readonly arguments: readonly string[];
  readonly name: string;
}

function isActionValue(value: unknown): value is ActionValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isActionValue);
  }
  return (
    typeof value === "object" &&
    Object.entries(value).every(
      ([key, child]) =>
        key.length > 0 &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Action object keys reject control bytes.
        !/[\u0000-\u001F\u007F]/.test(key) &&
        isActionValue(child),
    )
  );
}

function validSubpath(subpath: string): boolean {
  return (
    subpath === "." ||
    (subpath.startsWith("./") &&
      !subpath.includes("\\") &&
      !subpath
        .slice(2)
        .split("/")
        .some((part) => part === "" || part === "." || part === ".."))
  );
}

function freezeActionValue(value: ActionValue): ActionValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeActionValue));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, freezeActionValue(child)]),
      ),
    );
  }
  return value;
}

export function defineRuntimeActions(
  inputs: readonly RuntimeActionInput[],
): readonly RuntimeAction[] {
  const actions = inputs.map((input) => {
    if (!validSubpath(input.subpath)) {
      throw new TypeError("runtime action subpath is invalid");
    }
    if (
      input.exportName.length === 0 ||
      input.exportName.length > 256 ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Export names reject control bytes.
      /[\u0000-\u001F\u007F]/.test(input.exportName)
    ) {
      throw new TypeError("runtime action export name is invalid");
    }
    const arguments_ = input.kind === "call" ? (input.arguments ?? []) : [];
    if (!arguments_.every(isActionValue)) {
      throw new TypeError("runtime action arguments must contain JSON values");
    }
    return Object.freeze({
      arguments: Object.freeze(
        arguments_.map((argument) => freezeActionValue(structuredClone(argument))),
      ),
      exportName: input.exportName,
      kind: input.kind,
      subpath: input.subpath,
    });
  });
  actions.sort(
    (left, right) =>
      compareCodeUnits(left.subpath, right.subpath) ||
      compareCodeUnits(left.kind, right.kind) ||
      compareCodeUnits(left.exportName, right.exportName) ||
      compareCodeUnits(JSON.stringify(left.arguments), JSON.stringify(right.arguments)),
  );
  return Object.freeze(actions);
}

export function defineBinActions(
  inputs: readonly BinActionInput[],
): readonly BinAction[] {
  const actions = inputs.map((input) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.name) || input.name.length > 214) {
      throw new TypeError("bin action name is invalid");
    }
    const arguments_ = input.arguments ?? [];
    if (
      arguments_.length > 64 ||
      arguments_.some(
        (argument) =>
          argument.length > 4_096 ||
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Bin arguments reject control bytes.
          /[\u0000-\u001F\u007F]/.test(argument),
      )
    ) {
      throw new TypeError("bin action arguments are invalid");
    }
    return Object.freeze({
      arguments: Object.freeze([...arguments_]),
      name: input.name,
    });
  });
  actions.sort(
    (left, right) =>
      compareCodeUnits(left.name, right.name) ||
      compareCodeUnits(JSON.stringify(left.arguments), JSON.stringify(right.arguments)),
  );
  return Object.freeze(actions);
}
