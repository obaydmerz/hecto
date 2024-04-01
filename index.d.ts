import { ChildProcessWithoutNullStreams } from "child_process";
import { Result } from "./lib/result";

/**
 * HectoOptions interface represents the options that can be passed to the Hecto constructor.
 */
interface HectoOptions {
  /** An array of shell names to try when spawning the child process. */
  shellNames?: string[];
  /** Determines whether the Hecto instance should automatically start upon instantiation. Default is true. */
  autoStart?: boolean;
  /** Additional arguments to pass to the shell process. */
  args?: string[];
  /** The current working directory of the shell process. */
  cwd?: string;
  /** Debugging options. */
  debug?: {
    /** Indicates whether incoming data from the child process should be logged or not. */
    incoming?: boolean | ((data: string) => void);
    /** Indicates whether outgoing data sent to the child process should be logged or not. */
    outcoming?: boolean | ((data: string) => void);
  };
}

/**
 * GlobalFetcher interface represents the methods used for fetching and manipulating global variables.
 */
interface GlobalFetcher {
  /** Fetches the global variables from the interpreter. */
  fetch: () => Promise<Record<string, any>>;
  /**
   * Retrieves the value of a global variable.
   * @param prop The name of the global variable.
   * @param value The current value of the global variable.
   * @param options Additional options.
   * @returns The processed value of the global variable.
   */
  get: (
    prop: string,
    value: any,
    options?: { type?: string }
  ) => any | Promise<any>;
  /**
   * Sets the value of a global variable.
   * @param prop The name of the global variable.
   * @param value The new value to set.
   * @param oldValue The previous value of the global variable.
   * @returns The modified value of the global variable.
   */
  set: (prop: string, value: any, oldValue: any) => any | Promise<any>;
}

/**
 * Hardcode interface represents the hard-coded configuration for Hecto.
 */
interface Hardcode {
  /** The setup string to initialize the interpreter environment. */
  setupString: string;
  /** Executes the setup string to initialize the interpreter environment. */
  setup(): void;
  /**
   * Writes an execution command to the interpreter.
   * @param command The command to execute.
   */
  writeExecutionCommand(command: string): void;
  /** The global variables fetcher. */
  global: GlobalFetcher;
}

/**
 * Hecto class represents a versatile Node.js library for seamless bridging with languages.
 */
declare class Hecto {
  /**
   * The queue of commands to be executed.
   */
  #queue: {
    command: string;
    timeout: number;
    onPrint?: (result: any) => void;
    started: boolean;
    trigger: {
      incompleteCommand(): void;
    };
    resolve: (result: any) => void;
  }[];

  /**
   * The child process for execution.
   */
  #child: ChildProcessWithoutNullStreams | null;

  /**
   * The readout from the execution.
   */
  #readout: string | null;

  /**
   * Indicates whether the session has started.
   */
  #started: boolean;

  /**
   * The active shell being used.
   */
  #shell: string;

  /**
   * Indicates whether the instance is currently working on a query.
   */
  #working: boolean;

  /**
   * Timeouts for various operations.
   */
  #timeouts: {
    start: NodeJS.Timeout | null;
  };

  /**
   * Gets the active shell.
   */
  get shell(): string;

  /**
   * Indicates whether the instance is busy
   * By sending wrong other things
   */
  get working(): boolean;

  /**
   * Defines the hecto behavior
   */
  get hardcode(): Hardcode;

  /**
   * Creates a new Hecto instance.
   * @param options - The configuration options.
   * @throws If the interpreter is not found.
   */
  constructor(options?: HectoOptions);

  /**
   * Processes the execution result.
   * @param out - The output from the execution.
   */
  #process(out: string): void;

  /**
   * Starts the shell process.
   * @returns A promise that resolves when the shell process has started.
   */
  start(): Promise<void>;

  /**
   * Waits for the shell process to start.
   * @returns A promise that resolves when the shell process has started.
   */
  waitStart(): Promise<void>;

  /**
   * Syncs the global variables with the interpreter.
   * @returns A promise that resolves when the global variables have been synced.
   */
  sync(): Promise<void>;

  /**
   * Executes a command in the shell.
   * @param config The configuration for the command execution.
   * @returns A promise that resolves with the result of the execution.
   */
  exec(
    config?: string | { command?: string; timeout?: number }
  ): Promise<Result | void>;

  /**
   * Exits the shell process.
   * @returns True if the shell process was successfully exited, otherwise false.
   */
  exit(): boolean;
}

export { Hecto, Result };
