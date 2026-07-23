(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@capacitor-community/native-audio/dist/esm/definitions.js
  var init_definitions = __esm({
    "node_modules/@capacitor-community/native-audio/dist/esm/definitions.js"() {
    }
  });

  // node_modules/@capacitor-community/native-audio/dist/esm/audio-asset.js
  var AudioAsset;
  var init_audio_asset = __esm({
    "node_modules/@capacitor-community/native-audio/dist/esm/audio-asset.js"() {
      AudioAsset = class {
        constructor(audio) {
          this.audio = audio;
        }
      };
    }
  });

  // node_modules/@capacitor-community/native-audio/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    NativeAudioWeb: () => NativeAudioWeb
  });
  var NativeAudioWeb;
  var init_web = __esm({
    "node_modules/@capacitor-community/native-audio/dist/esm/web.js"() {
      init_dist();
      init_audio_asset();
      NativeAudioWeb = class _NativeAudioWeb extends WebPlugin {
        async resume(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          if (audio.paused) {
            return audio.play();
          }
        }
        async pause(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          return audio.pause();
        }
        async getCurrentTime(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          return { currentTime: audio.currentTime };
        }
        async getDuration(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          if (Number.isNaN(audio.duration)) {
            throw "no duration available";
          }
          if (!Number.isFinite(audio.duration)) {
            throw "duration not available => media resource is streaming";
          }
          return { duration: audio.duration };
        }
        async configure(options) {
          throw `configure is not supported for web: ${JSON.stringify(options)}`;
        }
        async preload(options) {
          var _a;
          if (_NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.has(options.assetId)) {
            throw "AssetId already exists. Unload first if like to change!";
          }
          if (!((_a = options.assetPath) === null || _a === void 0 ? void 0 : _a.length)) {
            throw "no assetPath provided";
          }
          if (!options.isUrl && !new RegExp("^/?" + _NativeAudioWeb.FILE_LOCATION).test(options.assetPath)) {
            const slashPrefix = options.assetPath.startsWith("/") ? "" : "/";
            options.assetPath = `${_NativeAudioWeb.FILE_LOCATION}${slashPrefix}${options.assetPath}`;
          }
          const audio = new Audio(options.assetPath);
          audio.autoplay = false;
          audio.loop = false;
          audio.preload = "auto";
          if (options.volume) {
            audio.volume = options.volume;
          }
          _NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.set(options.assetId, new AudioAsset(audio));
        }
        async play(options) {
          var _a;
          const audio = this.getAudioAsset(options.assetId).audio;
          await this.stop(options);
          audio.loop = false;
          audio.currentTime = (_a = options.time) !== null && _a !== void 0 ? _a : 0;
          return audio.play();
        }
        async loop(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          await this.stop(options);
          audio.loop = true;
          return audio.play();
        }
        async stop(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          audio.pause();
          audio.loop = false;
          audio.currentTime = 0;
        }
        async unload(options) {
          await this.stop(options);
          _NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.delete(options.assetId);
        }
        async setVolume(options) {
          if (typeof (options === null || options === void 0 ? void 0 : options.volume) !== "number") {
            throw "no volume provided";
          }
          const audio = this.getAudioAsset(options.assetId).audio;
          audio.volume = options.volume;
        }
        async isPlaying(options) {
          const audio = this.getAudioAsset(options.assetId).audio;
          return { isPlaying: !audio.paused };
        }
        getAudioAsset(assetId) {
          this.checkAssetId(assetId);
          if (!_NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.has(assetId)) {
            throw `no asset for assetId "${assetId}" available. Call preload first!`;
          }
          return _NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.get(assetId);
        }
        checkAssetId(assetId) {
          if (typeof assetId !== "string") {
            throw "assetId must be a string";
          }
          if (!(assetId === null || assetId === void 0 ? void 0 : assetId.length)) {
            throw "no assetId provided";
          }
        }
      };
      NativeAudioWeb.FILE_LOCATION = "assets/sounds";
      NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID = /* @__PURE__ */ new Map();
    }
  });

  // node_modules/@capacitor-community/native-audio/dist/esm/index.js
  var NativeAudio;
  var init_esm = __esm({
    "node_modules/@capacitor-community/native-audio/dist/esm/index.js"() {
      init_dist();
      init_definitions();
      NativeAudio = registerPlugin("NativeAudio", {
        web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.NativeAudioWeb())
      });
    }
  });

  // src/audioManager.js
  var require_audioManager = __commonJS({
    "src/audioManager.js"() {
      init_esm();
      var SOUNDS = {
        click: "assets/sounds/click.wav",
        card_open: "assets/sounds/card_open.wav",
        delete: "assets/sounds/delete.wav",
        give_a_box: "assets/sounds/give_a_box.wav",
        purr: "assets/sounds/purr.mp3",
        // Reminder-sound picker options (see previewReminderSound below and the picker page in
        // index.html) — curated files a user dropped into www/sounds/alarm/, synced here flat by
        // scripts/sync-sounds.js. Keep in sync with TASK_REMINDER_SOUNDS in src/notifications.js.
        fairy_tail_happy: "assets/sounds/fairy_tail_happy.mp3",
        last_magic: "assets/sounds/last_magic.mp3",
        magic: "assets/sounds/magic.mp3",
        magical_classic: "assets/sounds/magical_classic.mp3",
        thank_you: "assets/sounds/thank_you.mp3",
        the_magic_knights: "assets/sounds/the_magic_knights.mp3",
        violin: "assets/sounds/violin.mp3",
        violin_music: "assets/sounds/violin_music.mp3"
      };
      var MUTE_STORAGE_KEY = "mr_lapkins_sound_muted";
      var preloadedIds = {};
      var muted = readMutedFromStorage();
      function readMutedFromStorage() {
        try {
          return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
        } catch (e) {
          return false;
        }
      }
      function writeMutedToStorage(value) {
        try {
          localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
        } catch (e) {
          console.error("AudioManager: failed to persist mute state", e);
        }
      }
      function init() {
        Object.keys(SOUNDS).forEach(function(assetId) {
          NativeAudio.preload({
            assetId,
            assetPath: SOUNDS[assetId],
            audioChannelNum: 1,
            isUrl: false
          }).then(function() {
            preloadedIds[assetId] = true;
          }).catch(function(e) {
            console.error("AudioManager: failed to preload '" + assetId + "'", e);
          });
        });
        NativeAudio.addListener("complete", function(event) {
          if (event.assetId === previewingReminderSoundKey) setPreviewingReminderSoundKey(null);
        });
      }
      function play(assetId) {
        if (muted) return;
        if (!preloadedIds[assetId]) {
          console.error("AudioManager: '" + assetId + "' isn't preloaded yet, skipping play");
          return;
        }
        NativeAudio.play({ assetId }).catch(function(e) {
          console.error("AudioManager: failed to play '" + assetId + "'", e);
        });
      }
      function loop(assetId) {
        if (muted) return;
        if (!preloadedIds[assetId]) {
          console.error("AudioManager: '" + assetId + "' isn't preloaded yet, skipping loop");
          return;
        }
        NativeAudio.loop({ assetId }).catch(function(e) {
          console.error("AudioManager: failed to loop '" + assetId + "'", e);
        });
      }
      function stop(assetId) {
        if (!preloadedIds[assetId]) return;
        NativeAudio.stop({ assetId }).catch(function(e) {
          console.error("AudioManager: failed to stop '" + assetId + "'", e);
        });
      }
      var previewingReminderSoundKey = null;
      var onReminderSoundPreviewChangeFn = null;
      function setPreviewingReminderSoundKey(key) {
        previewingReminderSoundKey = key;
        if (onReminderSoundPreviewChangeFn) onReminderSoundPreviewChangeFn(key);
      }
      function previewReminderSound(key) {
        if (previewingReminderSoundKey === key) {
          stop(key);
          setPreviewingReminderSoundKey(null);
          return;
        }
        if (previewingReminderSoundKey) stop(previewingReminderSoundKey);
        play(key);
        setPreviewingReminderSoundKey(key);
      }
      function stopReminderSoundPreview() {
        if (!previewingReminderSoundKey) return;
        stop(previewingReminderSoundKey);
        setPreviewingReminderSoundKey(null);
      }
      function isMuted() {
        return muted;
      }
      function setMuted(value) {
        muted = !!value;
        writeMutedToStorage(muted);
      }
      function toggleMuted() {
        setMuted(!muted);
        return muted;
      }
      window.AudioManager = {
        init,
        playClick: function() {
          play("click");
        },
        playCardOpen: function() {
          play("card_open");
        },
        playDelete: function() {
          play("delete");
        },
        playGiveABox: function() {
          play("give_a_box");
        },
        startPurrLoop: function() {
          loop("purr");
        },
        stopPurrLoop: function() {
          stop("purr");
        },
        previewReminderSound,
        stopReminderSoundPreview,
        getPreviewingReminderSoundKey: function() {
          return previewingReminderSoundKey;
        },
        onReminderSoundPreviewChange: function(fn) {
          onReminderSoundPreviewChangeFn = fn;
        },
        isMuted,
        setMuted,
        toggleMuted
      };
    }
  });
  require_audioManager();
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
