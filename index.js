import { spawn } from "node:child_process";
import EventEmitter from "node:events";
import { assert, extractData } from "./lib/utils.js";
import { Result } from "./lib/result.js";
import * as Errors from "./lib/errors.js";
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
  #readout = "";
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

  #context = new Context();

  #extra = {};

  get context() {
    return this.#context.data;
  }

  // Metadata about the shell
  #shell = "";
  get metadata() {
    return {
      shell: this.#shell,
    };
  }

  constructor({
    shellNames = undefined,
    args = ["-i"],
    cwd = undefined,
    debug = {
      incoming: false,
      outcoming: false,
    },
  } = {}) {
    super();
    if (this.hardcode == undefined)
      throw new TypeError("You cannot instantiate this abstract class!");

    this.#extra = { debug };

    this.#setupShell(
      shellNames || this.hardcode.defaultShellNames || [],
      args,
      { cwd }
    ).then(() => {
      this.#setupListeners();

      // Run hardcoded setup things
      this.hardcode.setup();

      // Prevent interruption
      this.#working = true;

      // Handle exits
      this.#child.once("exit", (errcode) => {
        if (errcode === 0) return;
        this.#started = false;
        this.#working = false;
        this.#child = undefined;
        throw new Errors.UnexpectedExitError(`Exited with code ${errcode}`);
      });

      // Register timeout
      this.#timeouts.start = setTimeout(() => {
        this.#started = false;
        this.#working = false;
        throw new Errors.StartTimeoutError();
      }, 8000);

      // Context handler
      if (typeof this.hardcode.context == "object") {
        this.#context.getter = (prop, value) => {
          let [type, v] =
            typeof value === "string" && value.includes(">")
              ? value.split(">")
              : [undefined, value];

          return this.hardcode.context.get(prop, v, {
            type: type?.substring(1),
          });
        };
        this.#context.setter = this.hardcode.context.set;
      }
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

      if (
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
      }

      if (this.#events_readout != null) this.#events_readout += data;
      else this.#readout += data;

      // Custom event trigger is matched
      const eventMatches = this.#readout.match(
        /¬-([\s\S]*?)¬&\[([\s\S]*?)\]-¬/gm
      );

      if (eventMatches) {
        for (const matched of eventMatches.map((e) => {
          this.#readout = this.#readout.replace(e, "");
          return e.substring(2, e.length - 2).replace(/[\r\n]/gm, "");
        })) {
          const [event, args] = matched.split("¬&");

          // No confusion with built-in events
          if (["start", "init"].includes(event)) event += "#";

          try {
            this.emit(event, ...JSON.parse(args));
          } catch (error) {} // Not json parsable ):
        }
      }

      // Ret is matched
      const dataRetMatch = this.#readout.match(/¬\^\{([\s\S]*?)\}\^¬/gm);
      if (dataRetMatch) {
        // There is no more than ret match
        const matched = dataRetMatch[dataRetMatch.length - 1];
        if (this.hardcode.context)
          try {
            this.#context.updateContextContents(
              JSON.parse(
                matched.substring(2, matched.length - 2).replace(/[\r\n]/gm, "")
              )
            );
          } catch (error) {}

        if (this.#started) {
          // Done receiving a full regular output packet
          this.process(this.#readout);
        } else {
          // Done starting
          this.#working = false;
          this.#started = true;
          clearTimeout(this.#timeouts.start);

          // Allow for pre-things to be done before starting
          this.asyncEmit("init").then(() => this.emit("start"));
        }

        this.#readout = "";
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
      throw new Errors.InterpreterNotFound(
        "Cannot find an interpreter! Try installing it or add your own."
      );
    }
  }

  start() {
    if (this.#started) return;
    return new Promise((res) => this.once("start", res));
  }

  asyncEmit(event, ...args) {
    return Promise.all(this.rawListeners(event).map((e) => e(...args)));
  }

  async exec(config = {}) {
    assert(
      this.#started,
      "The shell isn't started yet!!",
      Errors.MismatchStateError
    );

    const that = this;

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
            new Errors.TimeoutError(
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
            reject(new Errors.IncompleteCommand());
          },
        },
        resolve(out) {
          if (tm != null) clearTimeout(tm);
          const { json, errjson } = extractData(out);

          if (errjson != null) {
            const err = handleError(
              errjson,
              errjson.fn || "<console>",
              that.hardcode.exceptionHandler
            );

            if (err) {
              // Error is handled and silenced by the custom execption handler
              resolve(err);
            }
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
      const { resolve } = this.#queue.shift();
      this.#working = false;
      resolve(out);
    }
  }
}

export { Hecto, Result, Errors };
