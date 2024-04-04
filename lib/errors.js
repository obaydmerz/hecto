import { formatFilePath } from "./utils.js";

export class UnexpectedExitError extends Error {}

export class TimeoutError extends Error {}

export class MismatchStateError extends Error {}

export class StartupError extends Error {}

export class InterpreterNotFound extends StartupError {}

export class StartTimeoutError extends StartupError {
  message = "Shell took too long to start!";
}

export class IncompleteCommand extends Error {
  message =
    "Your command is incomplete! Verify that you have closed quotes and blocks.";
}

// Execption is always showned by the other side ( the lang )
export class Exception extends Error {
  message = "A statement caused an exception!";
  line = 0;
  pos = 0;
  name = "";
  filename = "";

  constructor(message, line, pos, name) {
    super();
    this.message = message || this.message;
    this.line = line;
    this.pos = pos;
    this.name = name;
    this.filename = filename;
  }
}

export function handleError(
  { message, line, pos, name },
  filename = "<execution>",
  customExceptionHandler = undefined
) {
  let err = new Exception(message, line || "-", pos, name, filename);

  try {
    err = customExceptionHandler(err);
  } catch (error) {}

  // customExceptionHandler should only raise errors using the Exception class
  if (!(err instanceof Exception)) {
    // Silenced
    return err;
  }

  const stack = err.stack.split("\n");
  stack.splice(1, 1, `    at context (${formatFilePath(filename, line, pos)})`);
  err.stack = stack.join("\n");

  throw err;
}
