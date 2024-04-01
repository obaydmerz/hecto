import { spawn } from "node:child_process";
import EventEmitter from "node:events";
import { assert, extractData } from "./lib/utils.js";
import { Result } from "./lib/result.js";
import {
  IncompleteCommand,
  InterpreterNotFound,
  MismatchStateError,
  StartTimeoutException,
  BadExitException,
  StartupError,
  TimeoutException,
  handleError,
} from "./lib/errors.js";
import { Context } from "./lib/context.js";

class Hecto extends EventEmitter {
  get hardcode() {
    const that = this;
    // Abstract class
    return undefined;
  }

  // Execution's queue
  #queue = [];
  // Child process
  #child = null;
  // Child's outputs
  #readout = null;
  // Indicates if the instance is started and fully working
  #started = false;
  // A temporary output holder mainly used to keep event-based
  // triggering system
  #events_readout = null;
  // Indicates if the instance is busy so it shouldn't annoy child
  // By sending wrong other things
  #working = true;
  // A temporary object to hold timeouts
  #timeouts = { start: null };

  #global = new Context();

  #extra = {};

  get global() {
    return this.#global.data;
  }

  // Metadata about the shell
  #shell = "";
  get metadata() {
    return {
      shell: this.#shell,
    };
  }

  constructor({
    shellNames = [],
    autoStart = true,
    args = ["-i"],
    cwd = undefined,
    debug = {
      incoming: false,
      outcoming: false,
    },
  } = {}) {
    super();
    if (this.hardcode == undefined)
      throw new Error("You cannot instantiate this abstract class!");

    this.#extra = { debug };

    this.on("sync", async () => {
      if (typeof this.hardcode.global == "object") {
        this.#global.updateContextContents(await this.hardcode.global.fetch());
      }
    });

    this.#setupShell(
      shellNames || this.hardcode.defaultShellNames || [],
      args,
      { cwd }
    ).then(() => {
      this.#setupListeners();

      if (autoStart) {
        this.start();
      }

      this.once("start", async () => {
        if (typeof this.hardcode.global == "object") {
          this.#global.getter = (prop, value) => {
            let [type, v] = value?.includes(">")
              ? value.split(">")
              : [undefined, value];

            return this.hardcode.global.get(prop, v, {
              type: type?.substring(1),
            });
          };
          this.#global.setter = this.hardcode.global.set;
        }

        this.#started = true;
      });
    });
  }

  // Reception of child's raw output
  #setupListeners() {
    const onData = async (data) => {
      data = data.toString();
      this.#extra?.debug?.incoming
        ? typeof this.#extra.debug.incoming == "funciton"
          ? this.#extra.debug.incoming(data)
          : console.log("<--", data.replaceAll("\n", "\n<-- "))
        : undefined;

      // Custom events handling mechanism
      if (data.includes("¬-") || data.includes("-¬")) {
        const startIndex = data.indexOf("¬-");
        const endIndex = data.indexOf("-¬");

        this.#events_readout =
          this.#events_readout != null ? this.#events_readout : "";
        this.#events_readout += data.substring(
          startIndex !== -1 ? startIndex + 2 : 0,
          endIndex > 0 ? endIndex : undefined
        );

        // Received a full custom events packet
        if (endIndex > 0) {
          let [event, res] = this.#events_readout.split(">");

          // No confusion with built-in events
          // Didn't add sync so child can force sync
          if (["start"].includes(event)) event += "#";

          try {
            res = JSON.parse(res);
          } catch (error) {} // Not json parsable :(

          this.emit(event, res);
        }
      } else if (data.includes("¬¬*¬¬")) {
        if (this.#readout != null) {
          // Done receiving a full regular output packet
          this.#readout += data.substring(0, data.indexOf("¬¬*¬¬"));
          this.process(this.#readout);
        } else {
          // Done starting
          this.#working = false;
          clearTimeout(this.#timeouts.start);
          this.emit("start");
        }
        this.#readout = "";
      } else if (
        data.endsWith("...") &&
        this.#readout != null &&
        (this.#readout.length === 0 || this.#readout.endsWith("\n"))
      ) {
        this.#readout = "";
        if (this.#working && this.#queue[0]) {
          this.__raw_write("\x03\n");
          if (this.#queue[0].started)
            this.#queue.shift().trigger.incompleteCommand();
        }
      } else {
        if (this.#events_readout != null) this.#events_readout += data;
        else if (this.#readout != null) this.#readout += data;
      }
    };

    this.#child.stdout.on("data", onData);
    // Some interpreters output interactive data through stderr
    this.#child.stderr.on("data", onData);

    const update = () => {
      if (!this.#working) {
        if (typeof this.#queue[0] === "object" && !this.#queue[0].started) {
          this.hardcode.writeExecutionCommand(this.#queue[0].command);
          this.#queue[0].started = true;
          this.#working = true;
        }
      }
      if (this.#child != null) setTimeout(update, 200);
    };

    update();
  }

  // Finds an intrepreter and starts it up
  // It ensures that it won't exit immediately on the first 500ms
  async #setupShell(shellNames, args, options) {
    for (const sname of shellNames) {
      try {
        if (this.#child) break;
        this.#child = spawn(sname, args, options);
        this.#shell = sname;

        let timeclear = undefined;

        this.#child.once("exit", (errcode) => {
          this.#child = null;
          timeclear?.();
        });

        await new Promise((res) => {
          const timeout = setTimeout(() => {
            res();
          }, 500);

          timeclear = () => {
            clearTimeout(timeout);
            res();
          };
        });
      } catch (e) {}
    }

    if (this.#child == null) {
      throw new InterpreterNotFound(
        "Cannot find a python interpreter! Try installing python or adding your own."
      );
    }
  }

  // Inits the instance
  async start() {
    if (this.#started) return;

    assert(
      this.#child != null,
      "Cannot restart a stopped instance!",
      StartupError
    );

    // Calls the setup funciton to handle pre startup things
    this.hardcode.setup();

    this.#child.once("exit", (errcode) => {
      if (errcode === 0) return;
      this.#started = false;
      this.#working = false;
      this.#child = undefined;
      throw new BadExitException(`Exited with code ${errcode}`);
    });

    this.#timeouts.start = setTimeout(() => {
      this.#started = false;
      this.#working = false;
      throw new StartTimeoutException();
    }, 8000);

    await this.waitStart();
  }

  // A legacy way to wait for the start
  async waitStart() {
    if (this.#started) return;
    return new Promise((res) => this.once("start", res));
  }

  async sync() {
    await Promise.all(this.rawListeners("sync").map((e) => e()));
  }

  async exec(config = {}) {
    assert(this.#started, "The shell isn't started yet!!", MismatchStateError);

    if (typeof config === "string") {
      config = { command: config };
    }

    config = {
      command: "",
      timeout: 20000,
      ...(typeof config === "object" ? config : {}),
    };

    return new Promise((resolve, reject) => {
      let tm = null;
      if (config.timeout > 0) {
        tm = setTimeout(() => {
          reject(
            new TimeoutException(
              `Your code exceeded the timeout of ${config.timeout}ms!`
            )
          );
        }, config.timeout);
      }

      this.#queue.push({
        ...config,
        started: false,
        trigger: {
          incompleteCommand() {
            reject(new IncompleteCommand());
          },
        },
        resolve(out) {
          if (tm != null) clearTimeout(tm);
          const { json, errjson } = extractData(out);

          if (errjson != null) {
            return handleError(errjson, errjson.fn || "<console>");
          }

          resolve(
            typeof json === "number" || typeof json === "string"
              ? json
              : json
              ? new Result(json)
              : undefined
          );
        },
      });
    });
  }

  __raw_write(data) {
    this.#extra?.debug?.outcoming
      ? typeof this.#extra.debug.outcoming == "funciton"
        ? this.#extra.debug.outcoming(data)
        : console.log("-->", data.replaceAll("\n", "\n--> "))
      : undefined;
    return this.#child?.stdin?.write(data);
  }

  exit() {
    if (!this.#started) return false;

    if (this.#child && this.#child.stdin) {
      this.__raw_write("exit()\n");
      this.#child = null;
      this.#started = false;
      return true;
    }
  }

  async process(out) {
    if (typeof this.#queue[0] === "object" && this.#queue[0].started) {
      const { resolve, noReSync = false, command } = this.#queue.shift();
      this.#working = false;

      if (!noReSync) {
        await this.sync();
      }

      resolve(out);
    }
  }
}

export { Hecto, Result };
