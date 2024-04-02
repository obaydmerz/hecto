class Context {
  #raw = {};
  data = {};

  get raw() {
    return this.#raw;
  }

  constructor() {
    this.updateContextContents({});
  }

  updateContextContents(newData) {
    if (typeof newData != "object") return;
    this.#raw = { ...this.#raw, ...newData };

    this.data = Context.Proxify(this.#raw, {
      setter: this.setter,
      getter: this.getter,
    });
  }

  static SetByPath(object, target, value) {
    let obj = object;
    let path = target.split(".");
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    obj[path[path.length - 1]] = value;
  }

  static GetByPath(object, target) {
    let obj = object;
    let path = target.split(".");
    for (let i = 0; i < path.length; i++) {
      obj = obj[path[i]];
    }
    return obj;
  }

  static Proxify(
    object,
    {
      setter = (prop, value, oldValue) => {
        return value;
      },
      getter = (prop, value) => {
        return value;
      },
      hidePrefix = "",
      prefix = "",
    } = {}
  ) {
    return new Proxy(object, {
      get: (target, prop, receiver) => {
        if (hidePrefix && prop.startsWith(hidePrefix)) return undefined;
        const prepath = prefix.length ? prefix + "." + prop : prop;
        const realValue = Reflect.get(target, prop, receiver);
        if (typeof realValue === "object" && realValue !== null) {
          return this.Proxify(realValue, {
            getter,
            setter,
            prefix: prepath,
          });
        }
        return getter(prepath, realValue);
      },
      set: (target, prop, value, receiver) => {
        if (hidePrefix && prop.startsWith(hidePrefix)) return undefined;
        const prepath = prefix.length ? prefix + "." + prop : prop;
        const oldValue = Reflect.get(target, prop, receiver);
        return Reflect.set(
          target,
          prop,
          setter(prepath, value, oldValue),
          receiver
        );
      },
    });
  }

  // Overwritable
  getter(target, value) {
    return value;
  }

  // Overwritable
  setter(target, value, oldValue) {
    return value;
  }
}

export { Context };
