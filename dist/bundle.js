"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }


  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;

      if (typeof name == 'object') {
        for (var p in name)
          exports[p] = name[p];
      }
      else {
        exports[name] = value;
      }

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = depEntry.esModule;
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if (typeof exports == 'object' || typeof exports == 'function') {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    // node core modules
    if (name.substr(0, 6) == '@node/')
      return require(name.substr(6));

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['1'], [], function($__System) {

(function(__global) {
  var loader = $__System;
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
  var cjsRequirePre = "(?:^|[^$_a-zA-Z\\xA0-\\uFFFF.])";
  var cjsRequirePost = "\\s*\\(\\s*(\"([^\"]+)\"|'([^']+)')\\s*\\)";
  var fnBracketRegEx = /\(([^\)]*)\)/;
  var wsRegEx = /^\s+|\s+$/g;
  
  var requireRegExs = {};

  function getCJSDeps(source, requireIndex) {

    // remove comments
    source = source.replace(commentRegEx, '');

    // determine the require alias
    var params = source.match(fnBracketRegEx);
    var requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

    // find or generate the regex for this requireAlias
    var requireRegEx = requireRegExs[requireAlias] || (requireRegExs[requireAlias] = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g'));

    requireRegEx.lastIndex = 0;

    var deps = [];

    var match;
    while (match = requireRegEx.exec(source))
      deps.push(match[2] || match[3]);

    return deps;
  }

  /*
    AMD-compatible require
    To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
  */
  function require(names, callback, errback, referer) {
    // in amd, first arg can be a config object... we just ignore
    if (typeof names == 'object' && !(names instanceof Array))
      return require.apply(null, Array.prototype.splice.call(arguments, 1, arguments.length - 1));

    // amd require
    if (typeof names == 'string' && typeof callback == 'function')
      names = [names];
    if (names instanceof Array) {
      var dynamicRequires = [];
      for (var i = 0; i < names.length; i++)
        dynamicRequires.push(loader['import'](names[i], referer));
      Promise.all(dynamicRequires).then(function(modules) {
        if (callback)
          callback.apply(null, modules);
      }, errback);
    }

    // commonjs require
    else if (typeof names == 'string') {
      var module = loader.get(names);
      return module.__useDefault ? module['default'] : module;
    }

    else
      throw new TypeError('Invalid require');
  }

  function define(name, deps, factory) {
    if (typeof name != 'string') {
      factory = deps;
      deps = name;
      name = null;
    }
    if (!(deps instanceof Array)) {
      factory = deps;
      deps = ['require', 'exports', 'module'].splice(0, factory.length);
    }

    if (typeof factory != 'function')
      factory = (function(factory) {
        return function() { return factory; }
      })(factory);

    // in IE8, a trailing comma becomes a trailing undefined entry
    if (deps[deps.length - 1] === undefined)
      deps.pop();

    // remove system dependencies
    var requireIndex, exportsIndex, moduleIndex;
    
    if ((requireIndex = indexOf.call(deps, 'require')) != -1) {
      
      deps.splice(requireIndex, 1);

      // only trace cjs requires for non-named
      // named defines assume the trace has already been done
      if (!name)
        deps = deps.concat(getCJSDeps(factory.toString(), requireIndex));
    }

    if ((exportsIndex = indexOf.call(deps, 'exports')) != -1)
      deps.splice(exportsIndex, 1);
    
    if ((moduleIndex = indexOf.call(deps, 'module')) != -1)
      deps.splice(moduleIndex, 1);

    var define = {
      name: name,
      deps: deps,
      execute: function(req, exports, module) {

        var depValues = [];
        for (var i = 0; i < deps.length; i++)
          depValues.push(req(deps[i]));

        module.uri = module.id;

        module.config = function() {};

        // add back in system dependencies
        if (moduleIndex != -1)
          depValues.splice(moduleIndex, 0, module);
        
        if (exportsIndex != -1)
          depValues.splice(exportsIndex, 0, exports);
        
        if (requireIndex != -1) 
          depValues.splice(requireIndex, 0, function(names, callback, errback) {
            if (typeof names == 'string' && typeof callback != 'function')
              return req(names);
            return require.call(loader, names, callback, errback, module.id);
          });

        var output = factory.apply(exportsIndex == -1 ? __global : exports, depValues);

        if (typeof output == 'undefined' && module)
          output = module.exports;

        if (typeof output != 'undefined')
          return output;
      }
    };

    // anonymous define
    if (!name) {
      // already defined anonymously -> throw
      if (lastModule.anonDefine)
        throw new TypeError('Multiple defines for anonymous module');
      lastModule.anonDefine = define;
    }
    // named define
    else {
      // if we don't have any other defines,
      // then let this be an anonymous define
      // this is just to support single modules of the form:
      // define('jquery')
      // still loading anonymously
      // because it is done widely enough to be useful
      if (!lastModule.anonDefine && !lastModule.isBundle) {
        lastModule.anonDefine = define;
      }
      // otherwise its a bundle only
      else {
        // if there is an anonDefine already (we thought it could have had a single named define)
        // then we define it now
        // this is to avoid defining named defines when they are actually anonymous
        if (lastModule.anonDefine && lastModule.anonDefine.name)
          loader.registerDynamic(lastModule.anonDefine.name, lastModule.anonDefine.deps, false, lastModule.anonDefine.execute);

        lastModule.anonDefine = null;
      }

      // note this is now a bundle
      lastModule.isBundle = true;

      // define the module through the register registry
      loader.registerDynamic(name, define.deps, false, define.execute);
    }
  }
  define.amd = {};

  // adds define as a global (potentially just temporarily)
  function createDefine(loader) {
    lastModule.anonDefine = null;
    lastModule.isBundle = false;

    // ensure no NodeJS environment detection
    var oldModule = __global.module;
    var oldExports = __global.exports;
    var oldDefine = __global.define;

    __global.module = undefined;
    __global.exports = undefined;
    __global.define = define;

    return function() {
      __global.define = oldDefine;
      __global.module = oldModule;
      __global.exports = oldExports;
    };
  }

  var lastModule = {
    isBundle: false,
    anonDefine: null
  };

  loader.set('@@amd-helpers', loader.newModule({
    createDefine: createDefine,
    require: require,
    define: define,
    lastModule: lastModule
  }));
  loader.amdDefine = define;
  loader.amdRequire = require;
})(typeof self != 'undefined' ? self : global);

"bundle";
$__System.registerDynamic("2", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SettingsService = (function() {
    function SettingsService($window, config) {
      this.$window = $window;
      this.config = config;
      this.settings = {
        debug: false,
        path: ''
      };
      this.settings = JSON.parse($window.localStorage.getItem(this.config.storeName)) || this.settings;
    }
    SettingsService.$inject = ["$window", "config"];
    SettingsService.prototype.getSettings = function() {
      return this.settings;
    };
    SettingsService.prototype.saveSettings = function() {
      var text = JSON.stringify(this.settings);
      if (text && text !== '{}') {
        this.$window.localStorage.setItem(this.config.storeName, text);
      }
    };
    SettingsService.prototype.get = function(name) {
      return this.settings[name];
    };
    SettingsService.prototype.put = function(key, value) {
      if (value === void 0) {
        value = undefined;
      }
      if (value) {
        this.settings[key] = value;
      } else {
        delete this.settings[key];
      }
      this.saveSettings();
    };
    SettingsService.prototype.set = function(key, value) {
      if (value === void 0) {
        value = undefined;
      }
      this.put(key, value);
    };
    SettingsService.prototype.remove = function(key) {
      this.put(key);
    };
    return SettingsService;
  })();
  exports.SettingsService = SettingsService;
  var SettingsServiceProvider = (function() {
    function SettingsServiceProvider() {
      this.config = {storeName: 'iq.settings'};
    }
    SettingsServiceProvider.prototype.configure = function(params) {
      if (!(params instanceof Object)) {
        throw new TypeError('Invalid argument: `config` must be an `Object`.');
      }
      angular.extend(this.config, params);
      return this;
    };
    SettingsServiceProvider.prototype.$get = function($window) {
      return new SettingsService($window, this.config);
    };
    SettingsServiceProvider.prototype.$get.$inject = ["$window"];
    return SettingsServiceProvider;
  })();
  exports.SettingsServiceProvider = SettingsServiceProvider;
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = SettingsService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var RestService = (function() {
    function RestService($http, $q, $window, $rootScope, $log, config) {
      var _this = this;
      this.$http = $http;
      this.$q = $q;
      this.$window = $window;
      this.$rootScope = $rootScope;
      this.$log = $log;
      this.config = config;
      this.headers = {'Content-Type': 'application/json;charset=utf-8'};
      var updateOnlineStatus = function() {
        _this.isOffline = !navigator.onLine;
        if (_this.isOffline) {
          $rootScope.$broadcast('$rest:offline');
        } else {
          $rootScope.$broadcast('$rest:online');
        }
      };
      if ($window.addEventListener) {
        $window.addEventListener('online', updateOnlineStatus);
        $window.addEventListener('offline', updateOnlineStatus);
      } else {
        $window.attachEvent('online', updateOnlineStatus);
        $window.attachEvent('offline', updateOnlineStatus);
      }
      this.isMockupEnabled = config.mockupEnabled;
      if (this.isMockupEnabled) {
        $log.warn('Using Mockup Data');
        return;
      }
      if (config.restURL) {
        this.url = config.restURL.trim();
        if (this.url.charAt(this.url.length - 1) !== '/') {
          this.url += '/';
        }
      }
      $log.info('REST ' + this.url);
    }
    RestService.$inject = ["$http", "$q", "$window", "$rootScope", "$log", "config"];
    RestService.prototype.init = function() {
      var _this = this;
      return this.get({command: 'version'}).then(function(result) {
        _this.$rootScope.$restVersion = result.version + '.' + result.revision;
        _this.$log.info('REST', _this.$rootScope.$restVersion, moment(result.date).format('DD.MM.YYYY hh:mm'));
      });
    };
    RestService.prototype.mockupResponse = function(config) {
      var _this = this;
      var request;
      request = this.$http.get('data/' + config.command + '.json').then(function(response) {
        var content = response.data.content;
        if (_this.isMockupEnabled && content) {
          content = content.slice(config.params.number * config.params.size, (config.params.number + 1) * config.params.size);
          response.data.content = content;
          response.data.numberOfElements = content.length;
        }
        return response.data;
      });
      return request;
    };
    RestService.prototype.putHeader = function(name, value) {
      this.headers[name] = value;
    };
    RestService.prototype.request = function(method, config) {
      var _this = this;
      var deferred = this.$q.defer();
      if (!config.command) {
        throw new Error('REST Error: Command is required for REST call : ' + JSON.stringify(config));
      }
      config.url = this.url + config.command;
      config.method = method;
      config.headers = angular.extend(this.headers, config.headers);
      config.params = config.params || {};
      if (this.isMockupEnabled || config.mockup) {
        return this.mockupResponse(config);
      }
      this.$http(config).success(function(data, status) {
        _this.$log.debug('RESPONSE ', config.command + ': ', 'status: ' + status + (data.content ? ', ' + (data.content && data.content.length) + ' items' : ''));
        if (data.result === 'error') {
          _this.$log.warn('Application error: "' + data.message + '" for: ' + JSON.stringify(config));
          deferred.reject({
            status: status,
            message: data
          });
          return;
        }
        deferred.resolve(data);
      }).error(function(data, status) {
        deferred.reject({
          status: status,
          message: data
        });
      });
      return deferred.promise;
    };
    RestService.prototype.post = function(params) {
      return this.request('POST', params);
    };
    RestService.prototype.patch = function(params) {
      return this.request('PATCH', params);
    };
    RestService.prototype.get = function(params) {
      return this.request('GET', params);
    };
    RestService.prototype.put = function(params) {
      return this.request('PUT', params);
    };
    RestService.prototype.remove = function(params) {
      return this.request('DELETE', params);
    };
    return RestService;
  })();
  exports.RestService = RestService;
  var RestServiceProvider = (function() {
    function RestServiceProvider() {
      this.config = {restURL: window.location.origin};
    }
    RestServiceProvider.prototype.configure = function(params) {
      if (!(params instanceof Object)) {
        throw new TypeError('Invalid argument: `config` must be an `Object`.');
      }
      angular.extend(this.config, params);
      return this;
    };
    RestServiceProvider.prototype.$get = function($http, $q, $window, $rootScope, $log) {
      return new RestService($http, $q, $window, $rootScope, $log, this.config);
    };
    RestServiceProvider.prototype.$get.$inject = ["$http", "$q", "$window", "$rootScope", "$log"];
    return RestServiceProvider;
  })();
  exports.RestServiceProvider = RestServiceProvider;
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = RestService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ConfigServiceProvider = (function() {
    function ConfigServiceProvider() {
      this.config = {};
      angular.extend(this.config, window.CONFIG);
    }
    ConfigServiceProvider.prototype.configure = function(params) {
      if (!(params instanceof Object)) {
        throw new TypeError('Invalid argument: `config` must be an `Object`.');
      }
      angular.extend(this.config, params);
      return this;
    };
    ConfigServiceProvider.prototype.$get = function() {
      return this.config;
    };
    return ConfigServiceProvider;
  })();
  exports.ConfigServiceProvider = ConfigServiceProvider;
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = ConfigServiceProvider;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  function replacer(key, value) {
    if (typeof value === 'string' && value.length > 35) {
      return value.substring(0, 34) + '...';
    }
    return value;
  }
  var HttpInterceptor = (function() {
    function HttpInterceptor($rootScope, $q, $log) {
      var _this = this;
      this.$rootScope = $rootScope;
      this.$q = $q;
      this.$log = $log;
      this.request = function(config) {
        if (config.command) {
          _this.$log.debug(config.method + ' ' + config.command + ': params ' + JSON.stringify(config.params, replacer) + ', headers ' + JSON.stringify(config.headers, replacer) + (config.data ? ', body: ' + JSON.stringify(config.data, replacer) : ''));
        }
        return config;
      };
      this.responseError = function(rejection) {
        _this.$log.error('HTTP Response Error, status: ' + rejection.status + ' message: ' + JSON.stringify(rejection.data, replacer));
        rejection.message = rejection.data && rejection.data.error_description ? rejection.data.error_description : 'Unknown server error';
        rejection.url = rejection.config.url;
        switch (rejection.status) {
          case 0:
          case 500:
          case 502:
          case 503:
            _this.$rootScope.$broadcast('$rest:error:communication', rejection);
            break;
          case 400:
          case 405:
            _this.$rootScope.$broadcast('$rest:error:request', rejection);
            break;
          case 401:
          case 403:
            _this.$rootScope.$broadcast('$rest:error:authorization', rejection);
            break;
        }
        return _this.$q.reject(rejection);
      };
    }
    HttpInterceptor.$inject = ["$rootScope", "$q", "$log"];
    HttpInterceptor.factory = function($rootScope, $q, $log) {
      return new HttpInterceptor($rootScope, $q, $log);
    };
    HttpInterceptor.factory.$inject = ["$rootScope", "$q", "$log"];
    return HttpInterceptor;
  })();
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = HttpInterceptor;
  global.define = __define;
  return module.exports;
});

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() : typeof define === 'function' && define.amd ? define("6", [], factory) : global.moment = factory();
}(this, function() {
  'use strict';
  var hookCallback;
  function utils_hooks__hooks() {
    return hookCallback.apply(null, arguments);
  }
  function setHookCallback(callback) {
    hookCallback = callback;
  }
  function isArray(input) {
    return Object.prototype.toString.call(input) === '[object Array]';
  }
  function isDate(input) {
    return input instanceof Date || Object.prototype.toString.call(input) === '[object Date]';
  }
  function map(arr, fn) {
    var res = [],
        i;
    for (i = 0; i < arr.length; ++i) {
      res.push(fn(arr[i], i));
    }
    return res;
  }
  function hasOwnProp(a, b) {
    return Object.prototype.hasOwnProperty.call(a, b);
  }
  function extend(a, b) {
    for (var i in b) {
      if (hasOwnProp(b, i)) {
        a[i] = b[i];
      }
    }
    if (hasOwnProp(b, 'toString')) {
      a.toString = b.toString;
    }
    if (hasOwnProp(b, 'valueOf')) {
      a.valueOf = b.valueOf;
    }
    return a;
  }
  function create_utc__createUTC(input, format, locale, strict) {
    return createLocalOrUTC(input, format, locale, strict, true).utc();
  }
  function defaultParsingFlags() {
    return {
      empty: false,
      unusedTokens: [],
      unusedInput: [],
      overflow: -2,
      charsLeftOver: 0,
      nullInput: false,
      invalidMonth: null,
      invalidFormat: false,
      userInvalidated: false,
      iso: false
    };
  }
  function getParsingFlags(m) {
    if (m._pf == null) {
      m._pf = defaultParsingFlags();
    }
    return m._pf;
  }
  function valid__isValid(m) {
    if (m._isValid == null) {
      var flags = getParsingFlags(m);
      m._isValid = !isNaN(m._d.getTime()) && flags.overflow < 0 && !flags.empty && !flags.invalidMonth && !flags.invalidWeekday && !flags.nullInput && !flags.invalidFormat && !flags.userInvalidated;
      if (m._strict) {
        m._isValid = m._isValid && flags.charsLeftOver === 0 && flags.unusedTokens.length === 0 && flags.bigHour === undefined;
      }
    }
    return m._isValid;
  }
  function valid__createInvalid(flags) {
    var m = create_utc__createUTC(NaN);
    if (flags != null) {
      extend(getParsingFlags(m), flags);
    } else {
      getParsingFlags(m).userInvalidated = true;
    }
    return m;
  }
  var momentProperties = utils_hooks__hooks.momentProperties = [];
  function copyConfig(to, from) {
    var i,
        prop,
        val;
    if (typeof from._isAMomentObject !== 'undefined') {
      to._isAMomentObject = from._isAMomentObject;
    }
    if (typeof from._i !== 'undefined') {
      to._i = from._i;
    }
    if (typeof from._f !== 'undefined') {
      to._f = from._f;
    }
    if (typeof from._l !== 'undefined') {
      to._l = from._l;
    }
    if (typeof from._strict !== 'undefined') {
      to._strict = from._strict;
    }
    if (typeof from._tzm !== 'undefined') {
      to._tzm = from._tzm;
    }
    if (typeof from._isUTC !== 'undefined') {
      to._isUTC = from._isUTC;
    }
    if (typeof from._offset !== 'undefined') {
      to._offset = from._offset;
    }
    if (typeof from._pf !== 'undefined') {
      to._pf = getParsingFlags(from);
    }
    if (typeof from._locale !== 'undefined') {
      to._locale = from._locale;
    }
    if (momentProperties.length > 0) {
      for (i in momentProperties) {
        prop = momentProperties[i];
        val = from[prop];
        if (typeof val !== 'undefined') {
          to[prop] = val;
        }
      }
    }
    return to;
  }
  var updateInProgress = false;
  function Moment(config) {
    copyConfig(this, config);
    this._d = new Date(config._d != null ? config._d.getTime() : NaN);
    if (updateInProgress === false) {
      updateInProgress = true;
      utils_hooks__hooks.updateOffset(this);
      updateInProgress = false;
    }
  }
  function isMoment(obj) {
    return obj instanceof Moment || (obj != null && obj._isAMomentObject != null);
  }
  function absFloor(number) {
    if (number < 0) {
      return Math.ceil(number);
    } else {
      return Math.floor(number);
    }
  }
  function toInt(argumentForCoercion) {
    var coercedNumber = +argumentForCoercion,
        value = 0;
    if (coercedNumber !== 0 && isFinite(coercedNumber)) {
      value = absFloor(coercedNumber);
    }
    return value;
  }
  function compareArrays(array1, array2, dontConvert) {
    var len = Math.min(array1.length, array2.length),
        lengthDiff = Math.abs(array1.length - array2.length),
        diffs = 0,
        i;
    for (i = 0; i < len; i++) {
      if ((dontConvert && array1[i] !== array2[i]) || (!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
        diffs++;
      }
    }
    return diffs + lengthDiff;
  }
  function Locale() {}
  var locales = {};
  var globalLocale;
  function normalizeLocale(key) {
    return key ? key.toLowerCase().replace('_', '-') : key;
  }
  function chooseLocale(names) {
    var i = 0,
        j,
        next,
        locale,
        split;
    while (i < names.length) {
      split = normalizeLocale(names[i]).split('-');
      j = split.length;
      next = normalizeLocale(names[i + 1]);
      next = next ? next.split('-') : null;
      while (j > 0) {
        locale = loadLocale(split.slice(0, j).join('-'));
        if (locale) {
          return locale;
        }
        if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
          break;
        }
        j--;
      }
      i++;
    }
    return null;
  }
  function loadLocale(name) {
    var oldLocale = null;
    if (!locales[name] && typeof module !== 'undefined' && module && module.exports) {
      try {
        oldLocale = globalLocale._abbr;
        require('./locale/' + name);
        locale_locales__getSetGlobalLocale(oldLocale);
      } catch (e) {}
    }
    return locales[name];
  }
  function locale_locales__getSetGlobalLocale(key, values) {
    var data;
    if (key) {
      if (typeof values === 'undefined') {
        data = locale_locales__getLocale(key);
      } else {
        data = defineLocale(key, values);
      }
      if (data) {
        globalLocale = data;
      }
    }
    return globalLocale._abbr;
  }
  function defineLocale(name, values) {
    if (values !== null) {
      values.abbr = name;
      locales[name] = locales[name] || new Locale();
      locales[name].set(values);
      locale_locales__getSetGlobalLocale(name);
      return locales[name];
    } else {
      delete locales[name];
      return null;
    }
  }
  function locale_locales__getLocale(key) {
    var locale;
    if (key && key._locale && key._locale._abbr) {
      key = key._locale._abbr;
    }
    if (!key) {
      return globalLocale;
    }
    if (!isArray(key)) {
      locale = loadLocale(key);
      if (locale) {
        return locale;
      }
      key = [key];
    }
    return chooseLocale(key);
  }
  var aliases = {};
  function addUnitAlias(unit, shorthand) {
    var lowerCase = unit.toLowerCase();
    aliases[lowerCase] = aliases[lowerCase + 's'] = aliases[shorthand] = unit;
  }
  function normalizeUnits(units) {
    return typeof units === 'string' ? aliases[units] || aliases[units.toLowerCase()] : undefined;
  }
  function normalizeObjectUnits(inputObject) {
    var normalizedInput = {},
        normalizedProp,
        prop;
    for (prop in inputObject) {
      if (hasOwnProp(inputObject, prop)) {
        normalizedProp = normalizeUnits(prop);
        if (normalizedProp) {
          normalizedInput[normalizedProp] = inputObject[prop];
        }
      }
    }
    return normalizedInput;
  }
  function makeGetSet(unit, keepTime) {
    return function(value) {
      if (value != null) {
        get_set__set(this, unit, value);
        utils_hooks__hooks.updateOffset(this, keepTime);
        return this;
      } else {
        return get_set__get(this, unit);
      }
    };
  }
  function get_set__get(mom, unit) {
    return mom._d['get' + (mom._isUTC ? 'UTC' : '') + unit]();
  }
  function get_set__set(mom, unit, value) {
    return mom._d['set' + (mom._isUTC ? 'UTC' : '') + unit](value);
  }
  function getSet(units, value) {
    var unit;
    if (typeof units === 'object') {
      for (unit in units) {
        this.set(unit, units[unit]);
      }
    } else {
      units = normalizeUnits(units);
      if (typeof this[units] === 'function') {
        return this[units](value);
      }
    }
    return this;
  }
  function zeroFill(number, targetLength, forceSign) {
    var absNumber = '' + Math.abs(number),
        zerosToFill = targetLength - absNumber.length,
        sign = number >= 0;
    return (sign ? (forceSign ? '+' : '') : '-') + Math.pow(10, Math.max(0, zerosToFill)).toString().substr(1) + absNumber;
  }
  var formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Q|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g;
  var localFormattingTokens = /(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g;
  var formatFunctions = {};
  var formatTokenFunctions = {};
  function addFormatToken(token, padded, ordinal, callback) {
    var func = callback;
    if (typeof callback === 'string') {
      func = function() {
        return this[callback]();
      };
    }
    if (token) {
      formatTokenFunctions[token] = func;
    }
    if (padded) {
      formatTokenFunctions[padded[0]] = function() {
        return zeroFill(func.apply(this, arguments), padded[1], padded[2]);
      };
    }
    if (ordinal) {
      formatTokenFunctions[ordinal] = function() {
        return this.localeData().ordinal(func.apply(this, arguments), token);
      };
    }
  }
  function removeFormattingTokens(input) {
    if (input.match(/\[[\s\S]/)) {
      return input.replace(/^\[|\]$/g, '');
    }
    return input.replace(/\\/g, '');
  }
  function makeFormatFunction(format) {
    var array = format.match(formattingTokens),
        i,
        length;
    for (i = 0, length = array.length; i < length; i++) {
      if (formatTokenFunctions[array[i]]) {
        array[i] = formatTokenFunctions[array[i]];
      } else {
        array[i] = removeFormattingTokens(array[i]);
      }
    }
    return function(mom) {
      var output = '';
      for (i = 0; i < length; i++) {
        output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
      }
      return output;
    };
  }
  function formatMoment(m, format) {
    if (!m.isValid()) {
      return m.localeData().invalidDate();
    }
    format = expandFormat(format, m.localeData());
    formatFunctions[format] = formatFunctions[format] || makeFormatFunction(format);
    return formatFunctions[format](m);
  }
  function expandFormat(format, locale) {
    var i = 5;
    function replaceLongDateFormatTokens(input) {
      return locale.longDateFormat(input) || input;
    }
    localFormattingTokens.lastIndex = 0;
    while (i >= 0 && localFormattingTokens.test(format)) {
      format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
      localFormattingTokens.lastIndex = 0;
      i -= 1;
    }
    return format;
  }
  var match1 = /\d/;
  var match2 = /\d\d/;
  var match3 = /\d{3}/;
  var match4 = /\d{4}/;
  var match6 = /[+-]?\d{6}/;
  var match1to2 = /\d\d?/;
  var match1to3 = /\d{1,3}/;
  var match1to4 = /\d{1,4}/;
  var match1to6 = /[+-]?\d{1,6}/;
  var matchUnsigned = /\d+/;
  var matchSigned = /[+-]?\d+/;
  var matchOffset = /Z|[+-]\d\d:?\d\d/gi;
  var matchTimestamp = /[+-]?\d+(\.\d{1,3})?/;
  var matchWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i;
  var regexes = {};
  function isFunction(sth) {
    return typeof sth === 'function' && Object.prototype.toString.call(sth) === '[object Function]';
  }
  function addRegexToken(token, regex, strictRegex) {
    regexes[token] = isFunction(regex) ? regex : function(isStrict) {
      return (isStrict && strictRegex) ? strictRegex : regex;
    };
  }
  function getParseRegexForToken(token, config) {
    if (!hasOwnProp(regexes, token)) {
      return new RegExp(unescapeFormat(token));
    }
    return regexes[token](config._strict, config._locale);
  }
  function unescapeFormat(s) {
    return s.replace('\\', '').replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function(matched, p1, p2, p3, p4) {
      return p1 || p2 || p3 || p4;
    }).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
  var tokens = {};
  function addParseToken(token, callback) {
    var i,
        func = callback;
    if (typeof token === 'string') {
      token = [token];
    }
    if (typeof callback === 'number') {
      func = function(input, array) {
        array[callback] = toInt(input);
      };
    }
    for (i = 0; i < token.length; i++) {
      tokens[token[i]] = func;
    }
  }
  function addWeekParseToken(token, callback) {
    addParseToken(token, function(input, array, config, token) {
      config._w = config._w || {};
      callback(input, config._w, config, token);
    });
  }
  function addTimeToArrayFromToken(token, input, config) {
    if (input != null && hasOwnProp(tokens, token)) {
      tokens[token](input, config._a, config, token);
    }
  }
  var YEAR = 0;
  var MONTH = 1;
  var DATE = 2;
  var HOUR = 3;
  var MINUTE = 4;
  var SECOND = 5;
  var MILLISECOND = 6;
  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
  addFormatToken('M', ['MM', 2], 'Mo', function() {
    return this.month() + 1;
  });
  addFormatToken('MMM', 0, 0, function(format) {
    return this.localeData().monthsShort(this, format);
  });
  addFormatToken('MMMM', 0, 0, function(format) {
    return this.localeData().months(this, format);
  });
  addUnitAlias('month', 'M');
  addRegexToken('M', match1to2);
  addRegexToken('MM', match1to2, match2);
  addRegexToken('MMM', matchWord);
  addRegexToken('MMMM', matchWord);
  addParseToken(['M', 'MM'], function(input, array) {
    array[MONTH] = toInt(input) - 1;
  });
  addParseToken(['MMM', 'MMMM'], function(input, array, config, token) {
    var month = config._locale.monthsParse(input, token, config._strict);
    if (month != null) {
      array[MONTH] = month;
    } else {
      getParsingFlags(config).invalidMonth = input;
    }
  });
  var defaultLocaleMonths = 'January_February_March_April_May_June_July_August_September_October_November_December'.split('_');
  function localeMonths(m) {
    return this._months[m.month()];
  }
  var defaultLocaleMonthsShort = 'Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec'.split('_');
  function localeMonthsShort(m) {
    return this._monthsShort[m.month()];
  }
  function localeMonthsParse(monthName, format, strict) {
    var i,
        mom,
        regex;
    if (!this._monthsParse) {
      this._monthsParse = [];
      this._longMonthsParse = [];
      this._shortMonthsParse = [];
    }
    for (i = 0; i < 12; i++) {
      mom = create_utc__createUTC([2000, i]);
      if (strict && !this._longMonthsParse[i]) {
        this._longMonthsParse[i] = new RegExp('^' + this.months(mom, '').replace('.', '') + '$', 'i');
        this._shortMonthsParse[i] = new RegExp('^' + this.monthsShort(mom, '').replace('.', '') + '$', 'i');
      }
      if (!strict && !this._monthsParse[i]) {
        regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
        this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
      }
      if (strict && format === 'MMMM' && this._longMonthsParse[i].test(monthName)) {
        return i;
      } else if (strict && format === 'MMM' && this._shortMonthsParse[i].test(monthName)) {
        return i;
      } else if (!strict && this._monthsParse[i].test(monthName)) {
        return i;
      }
    }
  }
  function setMonth(mom, value) {
    var dayOfMonth;
    if (typeof value === 'string') {
      value = mom.localeData().monthsParse(value);
      if (typeof value !== 'number') {
        return mom;
      }
    }
    dayOfMonth = Math.min(mom.date(), daysInMonth(mom.year(), value));
    mom._d['set' + (mom._isUTC ? 'UTC' : '') + 'Month'](value, dayOfMonth);
    return mom;
  }
  function getSetMonth(value) {
    if (value != null) {
      setMonth(this, value);
      utils_hooks__hooks.updateOffset(this, true);
      return this;
    } else {
      return get_set__get(this, 'Month');
    }
  }
  function getDaysInMonth() {
    return daysInMonth(this.year(), this.month());
  }
  function checkOverflow(m) {
    var overflow;
    var a = m._a;
    if (a && getParsingFlags(m).overflow === -2) {
      overflow = a[MONTH] < 0 || a[MONTH] > 11 ? MONTH : a[DATE] < 1 || a[DATE] > daysInMonth(a[YEAR], a[MONTH]) ? DATE : a[HOUR] < 0 || a[HOUR] > 24 || (a[HOUR] === 24 && (a[MINUTE] !== 0 || a[SECOND] !== 0 || a[MILLISECOND] !== 0)) ? HOUR : a[MINUTE] < 0 || a[MINUTE] > 59 ? MINUTE : a[SECOND] < 0 || a[SECOND] > 59 ? SECOND : a[MILLISECOND] < 0 || a[MILLISECOND] > 999 ? MILLISECOND : -1;
      if (getParsingFlags(m)._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
        overflow = DATE;
      }
      getParsingFlags(m).overflow = overflow;
    }
    return m;
  }
  function warn(msg) {
    if (utils_hooks__hooks.suppressDeprecationWarnings === false && typeof console !== 'undefined' && console.warn) {
      console.warn('Deprecation warning: ' + msg);
    }
  }
  function deprecate(msg, fn) {
    var firstTime = true;
    return extend(function() {
      if (firstTime) {
        warn(msg + '\n' + (new Error()).stack);
        firstTime = false;
      }
      return fn.apply(this, arguments);
    }, fn);
  }
  var deprecations = {};
  function deprecateSimple(name, msg) {
    if (!deprecations[name]) {
      warn(msg);
      deprecations[name] = true;
    }
  }
  utils_hooks__hooks.suppressDeprecationWarnings = false;
  var from_string__isoRegex = /^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/;
  var isoDates = [['YYYYYY-MM-DD', /[+-]\d{6}-\d{2}-\d{2}/], ['YYYY-MM-DD', /\d{4}-\d{2}-\d{2}/], ['GGGG-[W]WW-E', /\d{4}-W\d{2}-\d/], ['GGGG-[W]WW', /\d{4}-W\d{2}/], ['YYYY-DDD', /\d{4}-\d{3}/]];
  var isoTimes = [['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d+/], ['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/], ['HH:mm', /(T| )\d\d:\d\d/], ['HH', /(T| )\d\d/]];
  var aspNetJsonRegex = /^\/?Date\((\-?\d+)/i;
  function configFromISO(config) {
    var i,
        l,
        string = config._i,
        match = from_string__isoRegex.exec(string);
    if (match) {
      getParsingFlags(config).iso = true;
      for (i = 0, l = isoDates.length; i < l; i++) {
        if (isoDates[i][1].exec(string)) {
          config._f = isoDates[i][0];
          break;
        }
      }
      for (i = 0, l = isoTimes.length; i < l; i++) {
        if (isoTimes[i][1].exec(string)) {
          config._f += (match[6] || ' ') + isoTimes[i][0];
          break;
        }
      }
      if (string.match(matchOffset)) {
        config._f += 'Z';
      }
      configFromStringAndFormat(config);
    } else {
      config._isValid = false;
    }
  }
  function configFromString(config) {
    var matched = aspNetJsonRegex.exec(config._i);
    if (matched !== null) {
      config._d = new Date(+matched[1]);
      return;
    }
    configFromISO(config);
    if (config._isValid === false) {
      delete config._isValid;
      utils_hooks__hooks.createFromInputFallback(config);
    }
  }
  utils_hooks__hooks.createFromInputFallback = deprecate('moment construction falls back to js Date. This is ' + 'discouraged and will be removed in upcoming major ' + 'release. Please refer to ' + 'https://github.com/moment/moment/issues/1407 for more info.', function(config) {
    config._d = new Date(config._i + (config._useUTC ? ' UTC' : ''));
  });
  function createDate(y, m, d, h, M, s, ms) {
    var date = new Date(y, m, d, h, M, s, ms);
    if (y < 1970) {
      date.setFullYear(y);
    }
    return date;
  }
  function createUTCDate(y) {
    var date = new Date(Date.UTC.apply(null, arguments));
    if (y < 1970) {
      date.setUTCFullYear(y);
    }
    return date;
  }
  addFormatToken(0, ['YY', 2], 0, function() {
    return this.year() % 100;
  });
  addFormatToken(0, ['YYYY', 4], 0, 'year');
  addFormatToken(0, ['YYYYY', 5], 0, 'year');
  addFormatToken(0, ['YYYYYY', 6, true], 0, 'year');
  addUnitAlias('year', 'y');
  addRegexToken('Y', matchSigned);
  addRegexToken('YY', match1to2, match2);
  addRegexToken('YYYY', match1to4, match4);
  addRegexToken('YYYYY', match1to6, match6);
  addRegexToken('YYYYYY', match1to6, match6);
  addParseToken(['YYYYY', 'YYYYYY'], YEAR);
  addParseToken('YYYY', function(input, array) {
    array[YEAR] = input.length === 2 ? utils_hooks__hooks.parseTwoDigitYear(input) : toInt(input);
  });
  addParseToken('YY', function(input, array) {
    array[YEAR] = utils_hooks__hooks.parseTwoDigitYear(input);
  });
  function daysInYear(year) {
    return isLeapYear(year) ? 366 : 365;
  }
  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }
  utils_hooks__hooks.parseTwoDigitYear = function(input) {
    return toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
  };
  var getSetYear = makeGetSet('FullYear', false);
  function getIsLeapYear() {
    return isLeapYear(this.year());
  }
  addFormatToken('w', ['ww', 2], 'wo', 'week');
  addFormatToken('W', ['WW', 2], 'Wo', 'isoWeek');
  addUnitAlias('week', 'w');
  addUnitAlias('isoWeek', 'W');
  addRegexToken('w', match1to2);
  addRegexToken('ww', match1to2, match2);
  addRegexToken('W', match1to2);
  addRegexToken('WW', match1to2, match2);
  addWeekParseToken(['w', 'ww', 'W', 'WW'], function(input, week, config, token) {
    week[token.substr(0, 1)] = toInt(input);
  });
  function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
    var end = firstDayOfWeekOfYear - firstDayOfWeek,
        daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
        adjustedMoment;
    if (daysToDayOfWeek > end) {
      daysToDayOfWeek -= 7;
    }
    if (daysToDayOfWeek < end - 7) {
      daysToDayOfWeek += 7;
    }
    adjustedMoment = local__createLocal(mom).add(daysToDayOfWeek, 'd');
    return {
      week: Math.ceil(adjustedMoment.dayOfYear() / 7),
      year: adjustedMoment.year()
    };
  }
  function localeWeek(mom) {
    return weekOfYear(mom, this._week.dow, this._week.doy).week;
  }
  var defaultLocaleWeek = {
    dow: 0,
    doy: 6
  };
  function localeFirstDayOfWeek() {
    return this._week.dow;
  }
  function localeFirstDayOfYear() {
    return this._week.doy;
  }
  function getSetWeek(input) {
    var week = this.localeData().week(this);
    return input == null ? week : this.add((input - week) * 7, 'd');
  }
  function getSetISOWeek(input) {
    var week = weekOfYear(this, 1, 4).week;
    return input == null ? week : this.add((input - week) * 7, 'd');
  }
  addFormatToken('DDD', ['DDDD', 3], 'DDDo', 'dayOfYear');
  addUnitAlias('dayOfYear', 'DDD');
  addRegexToken('DDD', match1to3);
  addRegexToken('DDDD', match3);
  addParseToken(['DDD', 'DDDD'], function(input, array, config) {
    config._dayOfYear = toInt(input);
  });
  function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
    var week1Jan = 6 + firstDayOfWeek - firstDayOfWeekOfYear,
        janX = createUTCDate(year, 0, 1 + week1Jan),
        d = janX.getUTCDay(),
        dayOfYear;
    if (d < firstDayOfWeek) {
      d += 7;
    }
    weekday = weekday != null ? 1 * weekday : firstDayOfWeek;
    dayOfYear = 1 + week1Jan + 7 * (week - 1) - d + weekday;
    return {
      year: dayOfYear > 0 ? year : year - 1,
      dayOfYear: dayOfYear > 0 ? dayOfYear : daysInYear(year - 1) + dayOfYear
    };
  }
  function getSetDayOfYear(input) {
    var dayOfYear = Math.round((this.clone().startOf('day') - this.clone().startOf('year')) / 864e5) + 1;
    return input == null ? dayOfYear : this.add((input - dayOfYear), 'd');
  }
  function defaults(a, b, c) {
    if (a != null) {
      return a;
    }
    if (b != null) {
      return b;
    }
    return c;
  }
  function currentDateArray(config) {
    var now = new Date();
    if (config._useUTC) {
      return [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
    }
    return [now.getFullYear(), now.getMonth(), now.getDate()];
  }
  function configFromArray(config) {
    var i,
        date,
        input = [],
        currentDate,
        yearToUse;
    if (config._d) {
      return;
    }
    currentDate = currentDateArray(config);
    if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
      dayOfYearFromWeekInfo(config);
    }
    if (config._dayOfYear) {
      yearToUse = defaults(config._a[YEAR], currentDate[YEAR]);
      if (config._dayOfYear > daysInYear(yearToUse)) {
        getParsingFlags(config)._overflowDayOfYear = true;
      }
      date = createUTCDate(yearToUse, 0, config._dayOfYear);
      config._a[MONTH] = date.getUTCMonth();
      config._a[DATE] = date.getUTCDate();
    }
    for (i = 0; i < 3 && config._a[i] == null; ++i) {
      config._a[i] = input[i] = currentDate[i];
    }
    for (; i < 7; i++) {
      config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
    }
    if (config._a[HOUR] === 24 && config._a[MINUTE] === 0 && config._a[SECOND] === 0 && config._a[MILLISECOND] === 0) {
      config._nextDay = true;
      config._a[HOUR] = 0;
    }
    config._d = (config._useUTC ? createUTCDate : createDate).apply(null, input);
    if (config._tzm != null) {
      config._d.setUTCMinutes(config._d.getUTCMinutes() - config._tzm);
    }
    if (config._nextDay) {
      config._a[HOUR] = 24;
    }
  }
  function dayOfYearFromWeekInfo(config) {
    var w,
        weekYear,
        week,
        weekday,
        dow,
        doy,
        temp;
    w = config._w;
    if (w.GG != null || w.W != null || w.E != null) {
      dow = 1;
      doy = 4;
      weekYear = defaults(w.GG, config._a[YEAR], weekOfYear(local__createLocal(), 1, 4).year);
      week = defaults(w.W, 1);
      weekday = defaults(w.E, 1);
    } else {
      dow = config._locale._week.dow;
      doy = config._locale._week.doy;
      weekYear = defaults(w.gg, config._a[YEAR], weekOfYear(local__createLocal(), dow, doy).year);
      week = defaults(w.w, 1);
      if (w.d != null) {
        weekday = w.d;
        if (weekday < dow) {
          ++week;
        }
      } else if (w.e != null) {
        weekday = w.e + dow;
      } else {
        weekday = dow;
      }
    }
    temp = dayOfYearFromWeeks(weekYear, week, weekday, doy, dow);
    config._a[YEAR] = temp.year;
    config._dayOfYear = temp.dayOfYear;
  }
  utils_hooks__hooks.ISO_8601 = function() {};
  function configFromStringAndFormat(config) {
    if (config._f === utils_hooks__hooks.ISO_8601) {
      configFromISO(config);
      return;
    }
    config._a = [];
    getParsingFlags(config).empty = true;
    var string = '' + config._i,
        i,
        parsedInput,
        tokens,
        token,
        skipped,
        stringLength = string.length,
        totalParsedInputLength = 0;
    tokens = expandFormat(config._f, config._locale).match(formattingTokens) || [];
    for (i = 0; i < tokens.length; i++) {
      token = tokens[i];
      parsedInput = (string.match(getParseRegexForToken(token, config)) || [])[0];
      if (parsedInput) {
        skipped = string.substr(0, string.indexOf(parsedInput));
        if (skipped.length > 0) {
          getParsingFlags(config).unusedInput.push(skipped);
        }
        string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
        totalParsedInputLength += parsedInput.length;
      }
      if (formatTokenFunctions[token]) {
        if (parsedInput) {
          getParsingFlags(config).empty = false;
        } else {
          getParsingFlags(config).unusedTokens.push(token);
        }
        addTimeToArrayFromToken(token, parsedInput, config);
      } else if (config._strict && !parsedInput) {
        getParsingFlags(config).unusedTokens.push(token);
      }
    }
    getParsingFlags(config).charsLeftOver = stringLength - totalParsedInputLength;
    if (string.length > 0) {
      getParsingFlags(config).unusedInput.push(string);
    }
    if (getParsingFlags(config).bigHour === true && config._a[HOUR] <= 12 && config._a[HOUR] > 0) {
      getParsingFlags(config).bigHour = undefined;
    }
    config._a[HOUR] = meridiemFixWrap(config._locale, config._a[HOUR], config._meridiem);
    configFromArray(config);
    checkOverflow(config);
  }
  function meridiemFixWrap(locale, hour, meridiem) {
    var isPm;
    if (meridiem == null) {
      return hour;
    }
    if (locale.meridiemHour != null) {
      return locale.meridiemHour(hour, meridiem);
    } else if (locale.isPM != null) {
      isPm = locale.isPM(meridiem);
      if (isPm && hour < 12) {
        hour += 12;
      }
      if (!isPm && hour === 12) {
        hour = 0;
      }
      return hour;
    } else {
      return hour;
    }
  }
  function configFromStringAndArray(config) {
    var tempConfig,
        bestMoment,
        scoreToBeat,
        i,
        currentScore;
    if (config._f.length === 0) {
      getParsingFlags(config).invalidFormat = true;
      config._d = new Date(NaN);
      return;
    }
    for (i = 0; i < config._f.length; i++) {
      currentScore = 0;
      tempConfig = copyConfig({}, config);
      if (config._useUTC != null) {
        tempConfig._useUTC = config._useUTC;
      }
      tempConfig._f = config._f[i];
      configFromStringAndFormat(tempConfig);
      if (!valid__isValid(tempConfig)) {
        continue;
      }
      currentScore += getParsingFlags(tempConfig).charsLeftOver;
      currentScore += getParsingFlags(tempConfig).unusedTokens.length * 10;
      getParsingFlags(tempConfig).score = currentScore;
      if (scoreToBeat == null || currentScore < scoreToBeat) {
        scoreToBeat = currentScore;
        bestMoment = tempConfig;
      }
    }
    extend(config, bestMoment || tempConfig);
  }
  function configFromObject(config) {
    if (config._d) {
      return;
    }
    var i = normalizeObjectUnits(config._i);
    config._a = [i.year, i.month, i.day || i.date, i.hour, i.minute, i.second, i.millisecond];
    configFromArray(config);
  }
  function createFromConfig(config) {
    var res = new Moment(checkOverflow(prepareConfig(config)));
    if (res._nextDay) {
      res.add(1, 'd');
      res._nextDay = undefined;
    }
    return res;
  }
  function prepareConfig(config) {
    var input = config._i,
        format = config._f;
    config._locale = config._locale || locale_locales__getLocale(config._l);
    if (input === null || (format === undefined && input === '')) {
      return valid__createInvalid({nullInput: true});
    }
    if (typeof input === 'string') {
      config._i = input = config._locale.preparse(input);
    }
    if (isMoment(input)) {
      return new Moment(checkOverflow(input));
    } else if (isArray(format)) {
      configFromStringAndArray(config);
    } else if (format) {
      configFromStringAndFormat(config);
    } else if (isDate(input)) {
      config._d = input;
    } else {
      configFromInput(config);
    }
    return config;
  }
  function configFromInput(config) {
    var input = config._i;
    if (input === undefined) {
      config._d = new Date();
    } else if (isDate(input)) {
      config._d = new Date(+input);
    } else if (typeof input === 'string') {
      configFromString(config);
    } else if (isArray(input)) {
      config._a = map(input.slice(0), function(obj) {
        return parseInt(obj, 10);
      });
      configFromArray(config);
    } else if (typeof(input) === 'object') {
      configFromObject(config);
    } else if (typeof(input) === 'number') {
      config._d = new Date(input);
    } else {
      utils_hooks__hooks.createFromInputFallback(config);
    }
  }
  function createLocalOrUTC(input, format, locale, strict, isUTC) {
    var c = {};
    if (typeof(locale) === 'boolean') {
      strict = locale;
      locale = undefined;
    }
    c._isAMomentObject = true;
    c._useUTC = c._isUTC = isUTC;
    c._l = locale;
    c._i = input;
    c._f = format;
    c._strict = strict;
    return createFromConfig(c);
  }
  function local__createLocal(input, format, locale, strict) {
    return createLocalOrUTC(input, format, locale, strict, false);
  }
  var prototypeMin = deprecate('moment().min is deprecated, use moment.min instead. https://github.com/moment/moment/issues/1548', function() {
    var other = local__createLocal.apply(null, arguments);
    return other < this ? this : other;
  });
  var prototypeMax = deprecate('moment().max is deprecated, use moment.max instead. https://github.com/moment/moment/issues/1548', function() {
    var other = local__createLocal.apply(null, arguments);
    return other > this ? this : other;
  });
  function pickBy(fn, moments) {
    var res,
        i;
    if (moments.length === 1 && isArray(moments[0])) {
      moments = moments[0];
    }
    if (!moments.length) {
      return local__createLocal();
    }
    res = moments[0];
    for (i = 1; i < moments.length; ++i) {
      if (!moments[i].isValid() || moments[i][fn](res)) {
        res = moments[i];
      }
    }
    return res;
  }
  function min() {
    var args = [].slice.call(arguments, 0);
    return pickBy('isBefore', args);
  }
  function max() {
    var args = [].slice.call(arguments, 0);
    return pickBy('isAfter', args);
  }
  function Duration(duration) {
    var normalizedInput = normalizeObjectUnits(duration),
        years = normalizedInput.year || 0,
        quarters = normalizedInput.quarter || 0,
        months = normalizedInput.month || 0,
        weeks = normalizedInput.week || 0,
        days = normalizedInput.day || 0,
        hours = normalizedInput.hour || 0,
        minutes = normalizedInput.minute || 0,
        seconds = normalizedInput.second || 0,
        milliseconds = normalizedInput.millisecond || 0;
    this._milliseconds = +milliseconds + seconds * 1e3 + minutes * 6e4 + hours * 36e5;
    this._days = +days + weeks * 7;
    this._months = +months + quarters * 3 + years * 12;
    this._data = {};
    this._locale = locale_locales__getLocale();
    this._bubble();
  }
  function isDuration(obj) {
    return obj instanceof Duration;
  }
  function offset(token, separator) {
    addFormatToken(token, 0, 0, function() {
      var offset = this.utcOffset();
      var sign = '+';
      if (offset < 0) {
        offset = -offset;
        sign = '-';
      }
      return sign + zeroFill(~~(offset / 60), 2) + separator + zeroFill(~~(offset) % 60, 2);
    });
  }
  offset('Z', ':');
  offset('ZZ', '');
  addRegexToken('Z', matchOffset);
  addRegexToken('ZZ', matchOffset);
  addParseToken(['Z', 'ZZ'], function(input, array, config) {
    config._useUTC = true;
    config._tzm = offsetFromString(input);
  });
  var chunkOffset = /([\+\-]|\d\d)/gi;
  function offsetFromString(string) {
    var matches = ((string || '').match(matchOffset) || []);
    var chunk = matches[matches.length - 1] || [];
    var parts = (chunk + '').match(chunkOffset) || ['-', 0, 0];
    var minutes = +(parts[1] * 60) + toInt(parts[2]);
    return parts[0] === '+' ? minutes : -minutes;
  }
  function cloneWithOffset(input, model) {
    var res,
        diff;
    if (model._isUTC) {
      res = model.clone();
      diff = (isMoment(input) || isDate(input) ? +input : +local__createLocal(input)) - (+res);
      res._d.setTime(+res._d + diff);
      utils_hooks__hooks.updateOffset(res, false);
      return res;
    } else {
      return local__createLocal(input).local();
    }
  }
  function getDateOffset(m) {
    return -Math.round(m._d.getTimezoneOffset() / 15) * 15;
  }
  utils_hooks__hooks.updateOffset = function() {};
  function getSetOffset(input, keepLocalTime) {
    var offset = this._offset || 0,
        localAdjust;
    if (input != null) {
      if (typeof input === 'string') {
        input = offsetFromString(input);
      }
      if (Math.abs(input) < 16) {
        input = input * 60;
      }
      if (!this._isUTC && keepLocalTime) {
        localAdjust = getDateOffset(this);
      }
      this._offset = input;
      this._isUTC = true;
      if (localAdjust != null) {
        this.add(localAdjust, 'm');
      }
      if (offset !== input) {
        if (!keepLocalTime || this._changeInProgress) {
          add_subtract__addSubtract(this, create__createDuration(input - offset, 'm'), 1, false);
        } else if (!this._changeInProgress) {
          this._changeInProgress = true;
          utils_hooks__hooks.updateOffset(this, true);
          this._changeInProgress = null;
        }
      }
      return this;
    } else {
      return this._isUTC ? offset : getDateOffset(this);
    }
  }
  function getSetZone(input, keepLocalTime) {
    if (input != null) {
      if (typeof input !== 'string') {
        input = -input;
      }
      this.utcOffset(input, keepLocalTime);
      return this;
    } else {
      return -this.utcOffset();
    }
  }
  function setOffsetToUTC(keepLocalTime) {
    return this.utcOffset(0, keepLocalTime);
  }
  function setOffsetToLocal(keepLocalTime) {
    if (this._isUTC) {
      this.utcOffset(0, keepLocalTime);
      this._isUTC = false;
      if (keepLocalTime) {
        this.subtract(getDateOffset(this), 'm');
      }
    }
    return this;
  }
  function setOffsetToParsedOffset() {
    if (this._tzm) {
      this.utcOffset(this._tzm);
    } else if (typeof this._i === 'string') {
      this.utcOffset(offsetFromString(this._i));
    }
    return this;
  }
  function hasAlignedHourOffset(input) {
    input = input ? local__createLocal(input).utcOffset() : 0;
    return (this.utcOffset() - input) % 60 === 0;
  }
  function isDaylightSavingTime() {
    return (this.utcOffset() > this.clone().month(0).utcOffset() || this.utcOffset() > this.clone().month(5).utcOffset());
  }
  function isDaylightSavingTimeShifted() {
    if (typeof this._isDSTShifted !== 'undefined') {
      return this._isDSTShifted;
    }
    var c = {};
    copyConfig(c, this);
    c = prepareConfig(c);
    if (c._a) {
      var other = c._isUTC ? create_utc__createUTC(c._a) : local__createLocal(c._a);
      this._isDSTShifted = this.isValid() && compareArrays(c._a, other.toArray()) > 0;
    } else {
      this._isDSTShifted = false;
    }
    return this._isDSTShifted;
  }
  function isLocal() {
    return !this._isUTC;
  }
  function isUtcOffset() {
    return this._isUTC;
  }
  function isUtc() {
    return this._isUTC && this._offset === 0;
  }
  var aspNetRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/;
  var create__isoRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/;
  function create__createDuration(input, key) {
    var duration = input,
        match = null,
        sign,
        ret,
        diffRes;
    if (isDuration(input)) {
      duration = {
        ms: input._milliseconds,
        d: input._days,
        M: input._months
      };
    } else if (typeof input === 'number') {
      duration = {};
      if (key) {
        duration[key] = input;
      } else {
        duration.milliseconds = input;
      }
    } else if (!!(match = aspNetRegex.exec(input))) {
      sign = (match[1] === '-') ? -1 : 1;
      duration = {
        y: 0,
        d: toInt(match[DATE]) * sign,
        h: toInt(match[HOUR]) * sign,
        m: toInt(match[MINUTE]) * sign,
        s: toInt(match[SECOND]) * sign,
        ms: toInt(match[MILLISECOND]) * sign
      };
    } else if (!!(match = create__isoRegex.exec(input))) {
      sign = (match[1] === '-') ? -1 : 1;
      duration = {
        y: parseIso(match[2], sign),
        M: parseIso(match[3], sign),
        d: parseIso(match[4], sign),
        h: parseIso(match[5], sign),
        m: parseIso(match[6], sign),
        s: parseIso(match[7], sign),
        w: parseIso(match[8], sign)
      };
    } else if (duration == null) {
      duration = {};
    } else if (typeof duration === 'object' && ('from' in duration || 'to' in duration)) {
      diffRes = momentsDifference(local__createLocal(duration.from), local__createLocal(duration.to));
      duration = {};
      duration.ms = diffRes.milliseconds;
      duration.M = diffRes.months;
    }
    ret = new Duration(duration);
    if (isDuration(input) && hasOwnProp(input, '_locale')) {
      ret._locale = input._locale;
    }
    return ret;
  }
  create__createDuration.fn = Duration.prototype;
  function parseIso(inp, sign) {
    var res = inp && parseFloat(inp.replace(',', '.'));
    return (isNaN(res) ? 0 : res) * sign;
  }
  function positiveMomentsDifference(base, other) {
    var res = {
      milliseconds: 0,
      months: 0
    };
    res.months = other.month() - base.month() + (other.year() - base.year()) * 12;
    if (base.clone().add(res.months, 'M').isAfter(other)) {
      --res.months;
    }
    res.milliseconds = +other - +(base.clone().add(res.months, 'M'));
    return res;
  }
  function momentsDifference(base, other) {
    var res;
    other = cloneWithOffset(other, base);
    if (base.isBefore(other)) {
      res = positiveMomentsDifference(base, other);
    } else {
      res = positiveMomentsDifference(other, base);
      res.milliseconds = -res.milliseconds;
      res.months = -res.months;
    }
    return res;
  }
  function createAdder(direction, name) {
    return function(val, period) {
      var dur,
          tmp;
      if (period !== null && !isNaN(+period)) {
        deprecateSimple(name, 'moment().' + name + '(period, number) is deprecated. Please use moment().' + name + '(number, period).');
        tmp = val;
        val = period;
        period = tmp;
      }
      val = typeof val === 'string' ? +val : val;
      dur = create__createDuration(val, period);
      add_subtract__addSubtract(this, dur, direction);
      return this;
    };
  }
  function add_subtract__addSubtract(mom, duration, isAdding, updateOffset) {
    var milliseconds = duration._milliseconds,
        days = duration._days,
        months = duration._months;
    updateOffset = updateOffset == null ? true : updateOffset;
    if (milliseconds) {
      mom._d.setTime(+mom._d + milliseconds * isAdding);
    }
    if (days) {
      get_set__set(mom, 'Date', get_set__get(mom, 'Date') + days * isAdding);
    }
    if (months) {
      setMonth(mom, get_set__get(mom, 'Month') + months * isAdding);
    }
    if (updateOffset) {
      utils_hooks__hooks.updateOffset(mom, days || months);
    }
  }
  var add_subtract__add = createAdder(1, 'add');
  var add_subtract__subtract = createAdder(-1, 'subtract');
  function moment_calendar__calendar(time, formats) {
    var now = time || local__createLocal(),
        sod = cloneWithOffset(now, this).startOf('day'),
        diff = this.diff(sod, 'days', true),
        format = diff < -6 ? 'sameElse' : diff < -1 ? 'lastWeek' : diff < 0 ? 'lastDay' : diff < 1 ? 'sameDay' : diff < 2 ? 'nextDay' : diff < 7 ? 'nextWeek' : 'sameElse';
    return this.format(formats && formats[format] || this.localeData().calendar(format, this, local__createLocal(now)));
  }
  function clone() {
    return new Moment(this);
  }
  function isAfter(input, units) {
    var inputMs;
    units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
    if (units === 'millisecond') {
      input = isMoment(input) ? input : local__createLocal(input);
      return +this > +input;
    } else {
      inputMs = isMoment(input) ? +input : +local__createLocal(input);
      return inputMs < +this.clone().startOf(units);
    }
  }
  function isBefore(input, units) {
    var inputMs;
    units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
    if (units === 'millisecond') {
      input = isMoment(input) ? input : local__createLocal(input);
      return +this < +input;
    } else {
      inputMs = isMoment(input) ? +input : +local__createLocal(input);
      return +this.clone().endOf(units) < inputMs;
    }
  }
  function isBetween(from, to, units) {
    return this.isAfter(from, units) && this.isBefore(to, units);
  }
  function isSame(input, units) {
    var inputMs;
    units = normalizeUnits(units || 'millisecond');
    if (units === 'millisecond') {
      input = isMoment(input) ? input : local__createLocal(input);
      return +this === +input;
    } else {
      inputMs = +local__createLocal(input);
      return +(this.clone().startOf(units)) <= inputMs && inputMs <= +(this.clone().endOf(units));
    }
  }
  function diff(input, units, asFloat) {
    var that = cloneWithOffset(input, this),
        zoneDelta = (that.utcOffset() - this.utcOffset()) * 6e4,
        delta,
        output;
    units = normalizeUnits(units);
    if (units === 'year' || units === 'month' || units === 'quarter') {
      output = monthDiff(this, that);
      if (units === 'quarter') {
        output = output / 3;
      } else if (units === 'year') {
        output = output / 12;
      }
    } else {
      delta = this - that;
      output = units === 'second' ? delta / 1e3 : units === 'minute' ? delta / 6e4 : units === 'hour' ? delta / 36e5 : units === 'day' ? (delta - zoneDelta) / 864e5 : units === 'week' ? (delta - zoneDelta) / 6048e5 : delta;
    }
    return asFloat ? output : absFloor(output);
  }
  function monthDiff(a, b) {
    var wholeMonthDiff = ((b.year() - a.year()) * 12) + (b.month() - a.month()),
        anchor = a.clone().add(wholeMonthDiff, 'months'),
        anchor2,
        adjust;
    if (b - anchor < 0) {
      anchor2 = a.clone().add(wholeMonthDiff - 1, 'months');
      adjust = (b - anchor) / (anchor - anchor2);
    } else {
      anchor2 = a.clone().add(wholeMonthDiff + 1, 'months');
      adjust = (b - anchor) / (anchor2 - anchor);
    }
    return -(wholeMonthDiff + adjust);
  }
  utils_hooks__hooks.defaultFormat = 'YYYY-MM-DDTHH:mm:ssZ';
  function toString() {
    return this.clone().locale('en').format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ');
  }
  function moment_format__toISOString() {
    var m = this.clone().utc();
    if (0 < m.year() && m.year() <= 9999) {
      if ('function' === typeof Date.prototype.toISOString) {
        return this.toDate().toISOString();
      } else {
        return formatMoment(m, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
      }
    } else {
      return formatMoment(m, 'YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
    }
  }
  function format(inputString) {
    var output = formatMoment(this, inputString || utils_hooks__hooks.defaultFormat);
    return this.localeData().postformat(output);
  }
  function from(time, withoutSuffix) {
    if (!this.isValid()) {
      return this.localeData().invalidDate();
    }
    return create__createDuration({
      to: this,
      from: time
    }).locale(this.locale()).humanize(!withoutSuffix);
  }
  function fromNow(withoutSuffix) {
    return this.from(local__createLocal(), withoutSuffix);
  }
  function to(time, withoutSuffix) {
    if (!this.isValid()) {
      return this.localeData().invalidDate();
    }
    return create__createDuration({
      from: this,
      to: time
    }).locale(this.locale()).humanize(!withoutSuffix);
  }
  function toNow(withoutSuffix) {
    return this.to(local__createLocal(), withoutSuffix);
  }
  function locale(key) {
    var newLocaleData;
    if (key === undefined) {
      return this._locale._abbr;
    } else {
      newLocaleData = locale_locales__getLocale(key);
      if (newLocaleData != null) {
        this._locale = newLocaleData;
      }
      return this;
    }
  }
  var lang = deprecate('moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.', function(key) {
    if (key === undefined) {
      return this.localeData();
    } else {
      return this.locale(key);
    }
  });
  function localeData() {
    return this._locale;
  }
  function startOf(units) {
    units = normalizeUnits(units);
    switch (units) {
      case 'year':
        this.month(0);
      case 'quarter':
      case 'month':
        this.date(1);
      case 'week':
      case 'isoWeek':
      case 'day':
        this.hours(0);
      case 'hour':
        this.minutes(0);
      case 'minute':
        this.seconds(0);
      case 'second':
        this.milliseconds(0);
    }
    if (units === 'week') {
      this.weekday(0);
    }
    if (units === 'isoWeek') {
      this.isoWeekday(1);
    }
    if (units === 'quarter') {
      this.month(Math.floor(this.month() / 3) * 3);
    }
    return this;
  }
  function endOf(units) {
    units = normalizeUnits(units);
    if (units === undefined || units === 'millisecond') {
      return this;
    }
    return this.startOf(units).add(1, (units === 'isoWeek' ? 'week' : units)).subtract(1, 'ms');
  }
  function to_type__valueOf() {
    return +this._d - ((this._offset || 0) * 60000);
  }
  function unix() {
    return Math.floor(+this / 1000);
  }
  function toDate() {
    return this._offset ? new Date(+this) : this._d;
  }
  function toArray() {
    var m = this;
    return [m.year(), m.month(), m.date(), m.hour(), m.minute(), m.second(), m.millisecond()];
  }
  function toObject() {
    var m = this;
    return {
      years: m.year(),
      months: m.month(),
      date: m.date(),
      hours: m.hours(),
      minutes: m.minutes(),
      seconds: m.seconds(),
      milliseconds: m.milliseconds()
    };
  }
  function moment_valid__isValid() {
    return valid__isValid(this);
  }
  function parsingFlags() {
    return extend({}, getParsingFlags(this));
  }
  function invalidAt() {
    return getParsingFlags(this).overflow;
  }
  addFormatToken(0, ['gg', 2], 0, function() {
    return this.weekYear() % 100;
  });
  addFormatToken(0, ['GG', 2], 0, function() {
    return this.isoWeekYear() % 100;
  });
  function addWeekYearFormatToken(token, getter) {
    addFormatToken(0, [token, token.length], 0, getter);
  }
  addWeekYearFormatToken('gggg', 'weekYear');
  addWeekYearFormatToken('ggggg', 'weekYear');
  addWeekYearFormatToken('GGGG', 'isoWeekYear');
  addWeekYearFormatToken('GGGGG', 'isoWeekYear');
  addUnitAlias('weekYear', 'gg');
  addUnitAlias('isoWeekYear', 'GG');
  addRegexToken('G', matchSigned);
  addRegexToken('g', matchSigned);
  addRegexToken('GG', match1to2, match2);
  addRegexToken('gg', match1to2, match2);
  addRegexToken('GGGG', match1to4, match4);
  addRegexToken('gggg', match1to4, match4);
  addRegexToken('GGGGG', match1to6, match6);
  addRegexToken('ggggg', match1to6, match6);
  addWeekParseToken(['gggg', 'ggggg', 'GGGG', 'GGGGG'], function(input, week, config, token) {
    week[token.substr(0, 2)] = toInt(input);
  });
  addWeekParseToken(['gg', 'GG'], function(input, week, config, token) {
    week[token] = utils_hooks__hooks.parseTwoDigitYear(input);
  });
  function weeksInYear(year, dow, doy) {
    return weekOfYear(local__createLocal([year, 11, 31 + dow - doy]), dow, doy).week;
  }
  function getSetWeekYear(input) {
    var year = weekOfYear(this, this.localeData()._week.dow, this.localeData()._week.doy).year;
    return input == null ? year : this.add((input - year), 'y');
  }
  function getSetISOWeekYear(input) {
    var year = weekOfYear(this, 1, 4).year;
    return input == null ? year : this.add((input - year), 'y');
  }
  function getISOWeeksInYear() {
    return weeksInYear(this.year(), 1, 4);
  }
  function getWeeksInYear() {
    var weekInfo = this.localeData()._week;
    return weeksInYear(this.year(), weekInfo.dow, weekInfo.doy);
  }
  addFormatToken('Q', 0, 0, 'quarter');
  addUnitAlias('quarter', 'Q');
  addRegexToken('Q', match1);
  addParseToken('Q', function(input, array) {
    array[MONTH] = (toInt(input) - 1) * 3;
  });
  function getSetQuarter(input) {
    return input == null ? Math.ceil((this.month() + 1) / 3) : this.month((input - 1) * 3 + this.month() % 3);
  }
  addFormatToken('D', ['DD', 2], 'Do', 'date');
  addUnitAlias('date', 'D');
  addRegexToken('D', match1to2);
  addRegexToken('DD', match1to2, match2);
  addRegexToken('Do', function(isStrict, locale) {
    return isStrict ? locale._ordinalParse : locale._ordinalParseLenient;
  });
  addParseToken(['D', 'DD'], DATE);
  addParseToken('Do', function(input, array) {
    array[DATE] = toInt(input.match(match1to2)[0], 10);
  });
  var getSetDayOfMonth = makeGetSet('Date', true);
  addFormatToken('d', 0, 'do', 'day');
  addFormatToken('dd', 0, 0, function(format) {
    return this.localeData().weekdaysMin(this, format);
  });
  addFormatToken('ddd', 0, 0, function(format) {
    return this.localeData().weekdaysShort(this, format);
  });
  addFormatToken('dddd', 0, 0, function(format) {
    return this.localeData().weekdays(this, format);
  });
  addFormatToken('e', 0, 0, 'weekday');
  addFormatToken('E', 0, 0, 'isoWeekday');
  addUnitAlias('day', 'd');
  addUnitAlias('weekday', 'e');
  addUnitAlias('isoWeekday', 'E');
  addRegexToken('d', match1to2);
  addRegexToken('e', match1to2);
  addRegexToken('E', match1to2);
  addRegexToken('dd', matchWord);
  addRegexToken('ddd', matchWord);
  addRegexToken('dddd', matchWord);
  addWeekParseToken(['dd', 'ddd', 'dddd'], function(input, week, config) {
    var weekday = config._locale.weekdaysParse(input);
    if (weekday != null) {
      week.d = weekday;
    } else {
      getParsingFlags(config).invalidWeekday = input;
    }
  });
  addWeekParseToken(['d', 'e', 'E'], function(input, week, config, token) {
    week[token] = toInt(input);
  });
  function parseWeekday(input, locale) {
    if (typeof input !== 'string') {
      return input;
    }
    if (!isNaN(input)) {
      return parseInt(input, 10);
    }
    input = locale.weekdaysParse(input);
    if (typeof input === 'number') {
      return input;
    }
    return null;
  }
  var defaultLocaleWeekdays = 'Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday'.split('_');
  function localeWeekdays(m) {
    return this._weekdays[m.day()];
  }
  var defaultLocaleWeekdaysShort = 'Sun_Mon_Tue_Wed_Thu_Fri_Sat'.split('_');
  function localeWeekdaysShort(m) {
    return this._weekdaysShort[m.day()];
  }
  var defaultLocaleWeekdaysMin = 'Su_Mo_Tu_We_Th_Fr_Sa'.split('_');
  function localeWeekdaysMin(m) {
    return this._weekdaysMin[m.day()];
  }
  function localeWeekdaysParse(weekdayName) {
    var i,
        mom,
        regex;
    this._weekdaysParse = this._weekdaysParse || [];
    for (i = 0; i < 7; i++) {
      if (!this._weekdaysParse[i]) {
        mom = local__createLocal([2000, 1]).day(i);
        regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
        this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
      }
      if (this._weekdaysParse[i].test(weekdayName)) {
        return i;
      }
    }
  }
  function getSetDayOfWeek(input) {
    var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
    if (input != null) {
      input = parseWeekday(input, this.localeData());
      return this.add(input - day, 'd');
    } else {
      return day;
    }
  }
  function getSetLocaleDayOfWeek(input) {
    var weekday = (this.day() + 7 - this.localeData()._week.dow) % 7;
    return input == null ? weekday : this.add(input - weekday, 'd');
  }
  function getSetISODayOfWeek(input) {
    return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
  }
  addFormatToken('H', ['HH', 2], 0, 'hour');
  addFormatToken('h', ['hh', 2], 0, function() {
    return this.hours() % 12 || 12;
  });
  function meridiem(token, lowercase) {
    addFormatToken(token, 0, 0, function() {
      return this.localeData().meridiem(this.hours(), this.minutes(), lowercase);
    });
  }
  meridiem('a', true);
  meridiem('A', false);
  addUnitAlias('hour', 'h');
  function matchMeridiem(isStrict, locale) {
    return locale._meridiemParse;
  }
  addRegexToken('a', matchMeridiem);
  addRegexToken('A', matchMeridiem);
  addRegexToken('H', match1to2);
  addRegexToken('h', match1to2);
  addRegexToken('HH', match1to2, match2);
  addRegexToken('hh', match1to2, match2);
  addParseToken(['H', 'HH'], HOUR);
  addParseToken(['a', 'A'], function(input, array, config) {
    config._isPm = config._locale.isPM(input);
    config._meridiem = input;
  });
  addParseToken(['h', 'hh'], function(input, array, config) {
    array[HOUR] = toInt(input);
    getParsingFlags(config).bigHour = true;
  });
  function localeIsPM(input) {
    return ((input + '').toLowerCase().charAt(0) === 'p');
  }
  var defaultLocaleMeridiemParse = /[ap]\.?m?\.?/i;
  function localeMeridiem(hours, minutes, isLower) {
    if (hours > 11) {
      return isLower ? 'pm' : 'PM';
    } else {
      return isLower ? 'am' : 'AM';
    }
  }
  var getSetHour = makeGetSet('Hours', true);
  addFormatToken('m', ['mm', 2], 0, 'minute');
  addUnitAlias('minute', 'm');
  addRegexToken('m', match1to2);
  addRegexToken('mm', match1to2, match2);
  addParseToken(['m', 'mm'], MINUTE);
  var getSetMinute = makeGetSet('Minutes', false);
  addFormatToken('s', ['ss', 2], 0, 'second');
  addUnitAlias('second', 's');
  addRegexToken('s', match1to2);
  addRegexToken('ss', match1to2, match2);
  addParseToken(['s', 'ss'], SECOND);
  var getSetSecond = makeGetSet('Seconds', false);
  addFormatToken('S', 0, 0, function() {
    return ~~(this.millisecond() / 100);
  });
  addFormatToken(0, ['SS', 2], 0, function() {
    return ~~(this.millisecond() / 10);
  });
  addFormatToken(0, ['SSS', 3], 0, 'millisecond');
  addFormatToken(0, ['SSSS', 4], 0, function() {
    return this.millisecond() * 10;
  });
  addFormatToken(0, ['SSSSS', 5], 0, function() {
    return this.millisecond() * 100;
  });
  addFormatToken(0, ['SSSSSS', 6], 0, function() {
    return this.millisecond() * 1000;
  });
  addFormatToken(0, ['SSSSSSS', 7], 0, function() {
    return this.millisecond() * 10000;
  });
  addFormatToken(0, ['SSSSSSSS', 8], 0, function() {
    return this.millisecond() * 100000;
  });
  addFormatToken(0, ['SSSSSSSSS', 9], 0, function() {
    return this.millisecond() * 1000000;
  });
  addUnitAlias('millisecond', 'ms');
  addRegexToken('S', match1to3, match1);
  addRegexToken('SS', match1to3, match2);
  addRegexToken('SSS', match1to3, match3);
  var token;
  for (token = 'SSSS'; token.length <= 9; token += 'S') {
    addRegexToken(token, matchUnsigned);
  }
  function parseMs(input, array) {
    array[MILLISECOND] = toInt(('0.' + input) * 1000);
  }
  for (token = 'S'; token.length <= 9; token += 'S') {
    addParseToken(token, parseMs);
  }
  var getSetMillisecond = makeGetSet('Milliseconds', false);
  addFormatToken('z', 0, 0, 'zoneAbbr');
  addFormatToken('zz', 0, 0, 'zoneName');
  function getZoneAbbr() {
    return this._isUTC ? 'UTC' : '';
  }
  function getZoneName() {
    return this._isUTC ? 'Coordinated Universal Time' : '';
  }
  var momentPrototype__proto = Moment.prototype;
  momentPrototype__proto.add = add_subtract__add;
  momentPrototype__proto.calendar = moment_calendar__calendar;
  momentPrototype__proto.clone = clone;
  momentPrototype__proto.diff = diff;
  momentPrototype__proto.endOf = endOf;
  momentPrototype__proto.format = format;
  momentPrototype__proto.from = from;
  momentPrototype__proto.fromNow = fromNow;
  momentPrototype__proto.to = to;
  momentPrototype__proto.toNow = toNow;
  momentPrototype__proto.get = getSet;
  momentPrototype__proto.invalidAt = invalidAt;
  momentPrototype__proto.isAfter = isAfter;
  momentPrototype__proto.isBefore = isBefore;
  momentPrototype__proto.isBetween = isBetween;
  momentPrototype__proto.isSame = isSame;
  momentPrototype__proto.isValid = moment_valid__isValid;
  momentPrototype__proto.lang = lang;
  momentPrototype__proto.locale = locale;
  momentPrototype__proto.localeData = localeData;
  momentPrototype__proto.max = prototypeMax;
  momentPrototype__proto.min = prototypeMin;
  momentPrototype__proto.parsingFlags = parsingFlags;
  momentPrototype__proto.set = getSet;
  momentPrototype__proto.startOf = startOf;
  momentPrototype__proto.subtract = add_subtract__subtract;
  momentPrototype__proto.toArray = toArray;
  momentPrototype__proto.toObject = toObject;
  momentPrototype__proto.toDate = toDate;
  momentPrototype__proto.toISOString = moment_format__toISOString;
  momentPrototype__proto.toJSON = moment_format__toISOString;
  momentPrototype__proto.toString = toString;
  momentPrototype__proto.unix = unix;
  momentPrototype__proto.valueOf = to_type__valueOf;
  momentPrototype__proto.year = getSetYear;
  momentPrototype__proto.isLeapYear = getIsLeapYear;
  momentPrototype__proto.weekYear = getSetWeekYear;
  momentPrototype__proto.isoWeekYear = getSetISOWeekYear;
  momentPrototype__proto.quarter = momentPrototype__proto.quarters = getSetQuarter;
  momentPrototype__proto.month = getSetMonth;
  momentPrototype__proto.daysInMonth = getDaysInMonth;
  momentPrototype__proto.week = momentPrototype__proto.weeks = getSetWeek;
  momentPrototype__proto.isoWeek = momentPrototype__proto.isoWeeks = getSetISOWeek;
  momentPrototype__proto.weeksInYear = getWeeksInYear;
  momentPrototype__proto.isoWeeksInYear = getISOWeeksInYear;
  momentPrototype__proto.date = getSetDayOfMonth;
  momentPrototype__proto.day = momentPrototype__proto.days = getSetDayOfWeek;
  momentPrototype__proto.weekday = getSetLocaleDayOfWeek;
  momentPrototype__proto.isoWeekday = getSetISODayOfWeek;
  momentPrototype__proto.dayOfYear = getSetDayOfYear;
  momentPrototype__proto.hour = momentPrototype__proto.hours = getSetHour;
  momentPrototype__proto.minute = momentPrototype__proto.minutes = getSetMinute;
  momentPrototype__proto.second = momentPrototype__proto.seconds = getSetSecond;
  momentPrototype__proto.millisecond = momentPrototype__proto.milliseconds = getSetMillisecond;
  momentPrototype__proto.utcOffset = getSetOffset;
  momentPrototype__proto.utc = setOffsetToUTC;
  momentPrototype__proto.local = setOffsetToLocal;
  momentPrototype__proto.parseZone = setOffsetToParsedOffset;
  momentPrototype__proto.hasAlignedHourOffset = hasAlignedHourOffset;
  momentPrototype__proto.isDST = isDaylightSavingTime;
  momentPrototype__proto.isDSTShifted = isDaylightSavingTimeShifted;
  momentPrototype__proto.isLocal = isLocal;
  momentPrototype__proto.isUtcOffset = isUtcOffset;
  momentPrototype__proto.isUtc = isUtc;
  momentPrototype__proto.isUTC = isUtc;
  momentPrototype__proto.zoneAbbr = getZoneAbbr;
  momentPrototype__proto.zoneName = getZoneName;
  momentPrototype__proto.dates = deprecate('dates accessor is deprecated. Use date instead.', getSetDayOfMonth);
  momentPrototype__proto.months = deprecate('months accessor is deprecated. Use month instead', getSetMonth);
  momentPrototype__proto.years = deprecate('years accessor is deprecated. Use year instead', getSetYear);
  momentPrototype__proto.zone = deprecate('moment().zone is deprecated, use moment().utcOffset instead. https://github.com/moment/moment/issues/1779', getSetZone);
  var momentPrototype = momentPrototype__proto;
  function moment__createUnix(input) {
    return local__createLocal(input * 1000);
  }
  function moment__createInZone() {
    return local__createLocal.apply(null, arguments).parseZone();
  }
  var defaultCalendar = {
    sameDay: '[Today at] LT',
    nextDay: '[Tomorrow at] LT',
    nextWeek: 'dddd [at] LT',
    lastDay: '[Yesterday at] LT',
    lastWeek: '[Last] dddd [at] LT',
    sameElse: 'L'
  };
  function locale_calendar__calendar(key, mom, now) {
    var output = this._calendar[key];
    return typeof output === 'function' ? output.call(mom, now) : output;
  }
  var defaultLongDateFormat = {
    LTS: 'h:mm:ss A',
    LT: 'h:mm A',
    L: 'MM/DD/YYYY',
    LL: 'MMMM D, YYYY',
    LLL: 'MMMM D, YYYY h:mm A',
    LLLL: 'dddd, MMMM D, YYYY h:mm A'
  };
  function longDateFormat(key) {
    var format = this._longDateFormat[key],
        formatUpper = this._longDateFormat[key.toUpperCase()];
    if (format || !formatUpper) {
      return format;
    }
    this._longDateFormat[key] = formatUpper.replace(/MMMM|MM|DD|dddd/g, function(val) {
      return val.slice(1);
    });
    return this._longDateFormat[key];
  }
  var defaultInvalidDate = 'Invalid date';
  function invalidDate() {
    return this._invalidDate;
  }
  var defaultOrdinal = '%d';
  var defaultOrdinalParse = /\d{1,2}/;
  function ordinal(number) {
    return this._ordinal.replace('%d', number);
  }
  function preParsePostFormat(string) {
    return string;
  }
  var defaultRelativeTime = {
    future: 'in %s',
    past: '%s ago',
    s: 'a few seconds',
    m: 'a minute',
    mm: '%d minutes',
    h: 'an hour',
    hh: '%d hours',
    d: 'a day',
    dd: '%d days',
    M: 'a month',
    MM: '%d months',
    y: 'a year',
    yy: '%d years'
  };
  function relative__relativeTime(number, withoutSuffix, string, isFuture) {
    var output = this._relativeTime[string];
    return (typeof output === 'function') ? output(number, withoutSuffix, string, isFuture) : output.replace(/%d/i, number);
  }
  function pastFuture(diff, output) {
    var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
    return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
  }
  function locale_set__set(config) {
    var prop,
        i;
    for (i in config) {
      prop = config[i];
      if (typeof prop === 'function') {
        this[i] = prop;
      } else {
        this['_' + i] = prop;
      }
    }
    this._ordinalParseLenient = new RegExp(this._ordinalParse.source + '|' + (/\d{1,2}/).source);
  }
  var prototype__proto = Locale.prototype;
  prototype__proto._calendar = defaultCalendar;
  prototype__proto.calendar = locale_calendar__calendar;
  prototype__proto._longDateFormat = defaultLongDateFormat;
  prototype__proto.longDateFormat = longDateFormat;
  prototype__proto._invalidDate = defaultInvalidDate;
  prototype__proto.invalidDate = invalidDate;
  prototype__proto._ordinal = defaultOrdinal;
  prototype__proto.ordinal = ordinal;
  prototype__proto._ordinalParse = defaultOrdinalParse;
  prototype__proto.preparse = preParsePostFormat;
  prototype__proto.postformat = preParsePostFormat;
  prototype__proto._relativeTime = defaultRelativeTime;
  prototype__proto.relativeTime = relative__relativeTime;
  prototype__proto.pastFuture = pastFuture;
  prototype__proto.set = locale_set__set;
  prototype__proto.months = localeMonths;
  prototype__proto._months = defaultLocaleMonths;
  prototype__proto.monthsShort = localeMonthsShort;
  prototype__proto._monthsShort = defaultLocaleMonthsShort;
  prototype__proto.monthsParse = localeMonthsParse;
  prototype__proto.week = localeWeek;
  prototype__proto._week = defaultLocaleWeek;
  prototype__proto.firstDayOfYear = localeFirstDayOfYear;
  prototype__proto.firstDayOfWeek = localeFirstDayOfWeek;
  prototype__proto.weekdays = localeWeekdays;
  prototype__proto._weekdays = defaultLocaleWeekdays;
  prototype__proto.weekdaysMin = localeWeekdaysMin;
  prototype__proto._weekdaysMin = defaultLocaleWeekdaysMin;
  prototype__proto.weekdaysShort = localeWeekdaysShort;
  prototype__proto._weekdaysShort = defaultLocaleWeekdaysShort;
  prototype__proto.weekdaysParse = localeWeekdaysParse;
  prototype__proto.isPM = localeIsPM;
  prototype__proto._meridiemParse = defaultLocaleMeridiemParse;
  prototype__proto.meridiem = localeMeridiem;
  function lists__get(format, index, field, setter) {
    var locale = locale_locales__getLocale();
    var utc = create_utc__createUTC().set(setter, index);
    return locale[field](utc, format);
  }
  function list(format, index, field, count, setter) {
    if (typeof format === 'number') {
      index = format;
      format = undefined;
    }
    format = format || '';
    if (index != null) {
      return lists__get(format, index, field, setter);
    }
    var i;
    var out = [];
    for (i = 0; i < count; i++) {
      out[i] = lists__get(format, i, field, setter);
    }
    return out;
  }
  function lists__listMonths(format, index) {
    return list(format, index, 'months', 12, 'month');
  }
  function lists__listMonthsShort(format, index) {
    return list(format, index, 'monthsShort', 12, 'month');
  }
  function lists__listWeekdays(format, index) {
    return list(format, index, 'weekdays', 7, 'day');
  }
  function lists__listWeekdaysShort(format, index) {
    return list(format, index, 'weekdaysShort', 7, 'day');
  }
  function lists__listWeekdaysMin(format, index) {
    return list(format, index, 'weekdaysMin', 7, 'day');
  }
  locale_locales__getSetGlobalLocale('en', {
    ordinalParse: /\d{1,2}(th|st|nd|rd)/,
    ordinal: function(number) {
      var b = number % 10,
          output = (toInt(number % 100 / 10) === 1) ? 'th' : (b === 1) ? 'st' : (b === 2) ? 'nd' : (b === 3) ? 'rd' : 'th';
      return number + output;
    }
  });
  utils_hooks__hooks.lang = deprecate('moment.lang is deprecated. Use moment.locale instead.', locale_locales__getSetGlobalLocale);
  utils_hooks__hooks.langData = deprecate('moment.langData is deprecated. Use moment.localeData instead.', locale_locales__getLocale);
  var mathAbs = Math.abs;
  function duration_abs__abs() {
    var data = this._data;
    this._milliseconds = mathAbs(this._milliseconds);
    this._days = mathAbs(this._days);
    this._months = mathAbs(this._months);
    data.milliseconds = mathAbs(data.milliseconds);
    data.seconds = mathAbs(data.seconds);
    data.minutes = mathAbs(data.minutes);
    data.hours = mathAbs(data.hours);
    data.months = mathAbs(data.months);
    data.years = mathAbs(data.years);
    return this;
  }
  function duration_add_subtract__addSubtract(duration, input, value, direction) {
    var other = create__createDuration(input, value);
    duration._milliseconds += direction * other._milliseconds;
    duration._days += direction * other._days;
    duration._months += direction * other._months;
    return duration._bubble();
  }
  function duration_add_subtract__add(input, value) {
    return duration_add_subtract__addSubtract(this, input, value, 1);
  }
  function duration_add_subtract__subtract(input, value) {
    return duration_add_subtract__addSubtract(this, input, value, -1);
  }
  function absCeil(number) {
    if (number < 0) {
      return Math.floor(number);
    } else {
      return Math.ceil(number);
    }
  }
  function bubble() {
    var milliseconds = this._milliseconds;
    var days = this._days;
    var months = this._months;
    var data = this._data;
    var seconds,
        minutes,
        hours,
        years,
        monthsFromDays;
    if (!((milliseconds >= 0 && days >= 0 && months >= 0) || (milliseconds <= 0 && days <= 0 && months <= 0))) {
      milliseconds += absCeil(monthsToDays(months) + days) * 864e5;
      days = 0;
      months = 0;
    }
    data.milliseconds = milliseconds % 1000;
    seconds = absFloor(milliseconds / 1000);
    data.seconds = seconds % 60;
    minutes = absFloor(seconds / 60);
    data.minutes = minutes % 60;
    hours = absFloor(minutes / 60);
    data.hours = hours % 24;
    days += absFloor(hours / 24);
    monthsFromDays = absFloor(daysToMonths(days));
    months += monthsFromDays;
    days -= absCeil(monthsToDays(monthsFromDays));
    years = absFloor(months / 12);
    months %= 12;
    data.days = days;
    data.months = months;
    data.years = years;
    return this;
  }
  function daysToMonths(days) {
    return days * 4800 / 146097;
  }
  function monthsToDays(months) {
    return months * 146097 / 4800;
  }
  function as(units) {
    var days;
    var months;
    var milliseconds = this._milliseconds;
    units = normalizeUnits(units);
    if (units === 'month' || units === 'year') {
      days = this._days + milliseconds / 864e5;
      months = this._months + daysToMonths(days);
      return units === 'month' ? months : months / 12;
    } else {
      days = this._days + Math.round(monthsToDays(this._months));
      switch (units) {
        case 'week':
          return days / 7 + milliseconds / 6048e5;
        case 'day':
          return days + milliseconds / 864e5;
        case 'hour':
          return days * 24 + milliseconds / 36e5;
        case 'minute':
          return days * 1440 + milliseconds / 6e4;
        case 'second':
          return days * 86400 + milliseconds / 1000;
        case 'millisecond':
          return Math.floor(days * 864e5) + milliseconds;
        default:
          throw new Error('Unknown unit ' + units);
      }
    }
  }
  function duration_as__valueOf() {
    return (this._milliseconds + this._days * 864e5 + (this._months % 12) * 2592e6 + toInt(this._months / 12) * 31536e6);
  }
  function makeAs(alias) {
    return function() {
      return this.as(alias);
    };
  }
  var asMilliseconds = makeAs('ms');
  var asSeconds = makeAs('s');
  var asMinutes = makeAs('m');
  var asHours = makeAs('h');
  var asDays = makeAs('d');
  var asWeeks = makeAs('w');
  var asMonths = makeAs('M');
  var asYears = makeAs('y');
  function duration_get__get(units) {
    units = normalizeUnits(units);
    return this[units + 's']();
  }
  function makeGetter(name) {
    return function() {
      return this._data[name];
    };
  }
  var milliseconds = makeGetter('milliseconds');
  var seconds = makeGetter('seconds');
  var minutes = makeGetter('minutes');
  var hours = makeGetter('hours');
  var days = makeGetter('days');
  var months = makeGetter('months');
  var years = makeGetter('years');
  function weeks() {
    return absFloor(this.days() / 7);
  }
  var round = Math.round;
  var thresholds = {
    s: 45,
    m: 45,
    h: 22,
    d: 26,
    M: 11
  };
  function substituteTimeAgo(string, number, withoutSuffix, isFuture, locale) {
    return locale.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
  }
  function duration_humanize__relativeTime(posNegDuration, withoutSuffix, locale) {
    var duration = create__createDuration(posNegDuration).abs();
    var seconds = round(duration.as('s'));
    var minutes = round(duration.as('m'));
    var hours = round(duration.as('h'));
    var days = round(duration.as('d'));
    var months = round(duration.as('M'));
    var years = round(duration.as('y'));
    var a = seconds < thresholds.s && ['s', seconds] || minutes === 1 && ['m'] || minutes < thresholds.m && ['mm', minutes] || hours === 1 && ['h'] || hours < thresholds.h && ['hh', hours] || days === 1 && ['d'] || days < thresholds.d && ['dd', days] || months === 1 && ['M'] || months < thresholds.M && ['MM', months] || years === 1 && ['y'] || ['yy', years];
    a[2] = withoutSuffix;
    a[3] = +posNegDuration > 0;
    a[4] = locale;
    return substituteTimeAgo.apply(null, a);
  }
  function duration_humanize__getSetRelativeTimeThreshold(threshold, limit) {
    if (thresholds[threshold] === undefined) {
      return false;
    }
    if (limit === undefined) {
      return thresholds[threshold];
    }
    thresholds[threshold] = limit;
    return true;
  }
  function humanize(withSuffix) {
    var locale = this.localeData();
    var output = duration_humanize__relativeTime(this, !withSuffix, locale);
    if (withSuffix) {
      output = locale.pastFuture(+this, output);
    }
    return locale.postformat(output);
  }
  var iso_string__abs = Math.abs;
  function iso_string__toISOString() {
    var seconds = iso_string__abs(this._milliseconds) / 1000;
    var days = iso_string__abs(this._days);
    var months = iso_string__abs(this._months);
    var minutes,
        hours,
        years;
    minutes = absFloor(seconds / 60);
    hours = absFloor(minutes / 60);
    seconds %= 60;
    minutes %= 60;
    years = absFloor(months / 12);
    months %= 12;
    var Y = years;
    var M = months;
    var D = days;
    var h = hours;
    var m = minutes;
    var s = seconds;
    var total = this.asSeconds();
    if (!total) {
      return 'P0D';
    }
    return (total < 0 ? '-' : '') + 'P' + (Y ? Y + 'Y' : '') + (M ? M + 'M' : '') + (D ? D + 'D' : '') + ((h || m || s) ? 'T' : '') + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s ? s + 'S' : '');
  }
  var duration_prototype__proto = Duration.prototype;
  duration_prototype__proto.abs = duration_abs__abs;
  duration_prototype__proto.add = duration_add_subtract__add;
  duration_prototype__proto.subtract = duration_add_subtract__subtract;
  duration_prototype__proto.as = as;
  duration_prototype__proto.asMilliseconds = asMilliseconds;
  duration_prototype__proto.asSeconds = asSeconds;
  duration_prototype__proto.asMinutes = asMinutes;
  duration_prototype__proto.asHours = asHours;
  duration_prototype__proto.asDays = asDays;
  duration_prototype__proto.asWeeks = asWeeks;
  duration_prototype__proto.asMonths = asMonths;
  duration_prototype__proto.asYears = asYears;
  duration_prototype__proto.valueOf = duration_as__valueOf;
  duration_prototype__proto._bubble = bubble;
  duration_prototype__proto.get = duration_get__get;
  duration_prototype__proto.milliseconds = milliseconds;
  duration_prototype__proto.seconds = seconds;
  duration_prototype__proto.minutes = minutes;
  duration_prototype__proto.hours = hours;
  duration_prototype__proto.days = days;
  duration_prototype__proto.weeks = weeks;
  duration_prototype__proto.months = months;
  duration_prototype__proto.years = years;
  duration_prototype__proto.humanize = humanize;
  duration_prototype__proto.toISOString = iso_string__toISOString;
  duration_prototype__proto.toString = iso_string__toISOString;
  duration_prototype__proto.toJSON = iso_string__toISOString;
  duration_prototype__proto.locale = locale;
  duration_prototype__proto.localeData = localeData;
  duration_prototype__proto.toIsoString = deprecate('toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)', iso_string__toISOString);
  duration_prototype__proto.lang = lang;
  addFormatToken('X', 0, 0, 'unix');
  addFormatToken('x', 0, 0, 'valueOf');
  addRegexToken('x', matchSigned);
  addRegexToken('X', matchTimestamp);
  addParseToken('X', function(input, array, config) {
    config._d = new Date(parseFloat(input, 10) * 1000);
  });
  addParseToken('x', function(input, array, config) {
    config._d = new Date(toInt(input));
  });
  utils_hooks__hooks.version = '2.10.6';
  setHookCallback(local__createLocal);
  utils_hooks__hooks.fn = momentPrototype;
  utils_hooks__hooks.min = min;
  utils_hooks__hooks.max = max;
  utils_hooks__hooks.utc = create_utc__createUTC;
  utils_hooks__hooks.unix = moment__createUnix;
  utils_hooks__hooks.months = lists__listMonths;
  utils_hooks__hooks.isDate = isDate;
  utils_hooks__hooks.locale = locale_locales__getSetGlobalLocale;
  utils_hooks__hooks.invalid = valid__createInvalid;
  utils_hooks__hooks.duration = create__createDuration;
  utils_hooks__hooks.isMoment = isMoment;
  utils_hooks__hooks.weekdays = lists__listWeekdays;
  utils_hooks__hooks.parseZone = moment__createInZone;
  utils_hooks__hooks.localeData = locale_locales__getLocale;
  utils_hooks__hooks.isDuration = isDuration;
  utils_hooks__hooks.monthsShort = lists__listMonthsShort;
  utils_hooks__hooks.weekdaysMin = lists__listWeekdaysMin;
  utils_hooks__hooks.defineLocale = defineLocale;
  utils_hooks__hooks.weekdaysShort = lists__listWeekdaysShort;
  utils_hooks__hooks.normalizeUnits = normalizeUnits;
  utils_hooks__hooks.relativeTimeThreshold = duration_humanize__getSetRelativeTimeThreshold;
  var _moment = utils_hooks__hooks;
  return _moment;
}));

_removeDefine();
})();
$__System.registerDynamic("7", ["6"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var moment = req('6');
  var DATE_FORMAT = 'DD.MM.YYYY HH:mm:ss';
  var UtilsService = (function() {
    function UtilsService($filter, $dateFormat) {
      if ($filter === void 0) {
        $filter = undefined;
      }
      if ($dateFormat === void 0) {
        $dateFormat = DATE_FORMAT;
      }
      this.$filter = $filter;
      this.$dateFormat = $dateFormat;
    }
    UtilsService.$inject = ["$filter", "$dateFormat"];
    UtilsService.prototype.formChanges = function(form, model) {
      var changes = {};
      if (!model) {
        return changes;
      }
      angular.forEach(form, function(value, key) {
        if (key[0] !== '$' && !value.$pristine) {
          if (model[key] !== undefined) {
            changes[key] = model[key];
          }
        }
      });
      return changes;
    };
    UtilsService.prototype.isReadyToSave = function(form, exclusions) {
      var valid = true;
      var dirty = false;
      exclusions = exclusions || [];
      angular.forEach(form, function(value, key) {
        if (key[0] !== '$' && exclusions.indexOf(key) < 0) {
          if (value.$dirty) {
            dirty = true;
          }
          valid = valid && value.$valid;
        }
      });
      return dirty && valid;
    };
    UtilsService.prototype.isEmpty = function(obj) {
      if (obj == null) {
        return true;
      }
      if (obj.length > 0) {
        return false;
      }
      if (obj.length === 0) {
        return true;
      }
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          return false;
        }
        ;
      }
      return true;
    };
    UtilsService.prototype.arrayFilter = function(array, expression, flag) {
      if (flag === void 0) {
        flag = true;
      }
      var resultArray = [];
      if (this.$filter) {
        resultArray = this.$filter('filter')(array, expression, flag);
      }
      return resultArray;
    };
    UtilsService.prototype.arraySearch = function(array, expression, flag) {
      if (flag === void 0) {
        flag = true;
      }
      var result;
      if (this.$filter) {
        result = this.$filter('filter')(array, expression, flag)[0];
      }
      return result;
    };
    UtilsService.prototype.formatDate = function(date) {
      return date ? moment(date).format(this.$dateFormat) : '';
    };
    return UtilsService;
  })();
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = UtilsService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("8", ["2", "3", "4", "5", "7"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SettingsService_1 = req('2');
  exports.SettingsServiceProvider = SettingsService_1.SettingsServiceProvider;
  exports.SettingsService = SettingsService_1.SettingsService;
  var RestService_1 = req('3');
  exports.RestServiceProvider = RestService_1.RestServiceProvider;
  exports.RestService = RestService_1.RestService;
  var ConfigService_1 = req('4');
  exports.ConfigServiceProvider = ConfigService_1.default;
  var HttpInterceptor_1 = req('5');
  exports.HttpInterceptor = HttpInterceptor_1.default;
  var UtilsService_1 = req('7');
  exports.UtilsService = UtilsService_1.default;
  exports.module = angular.module('core', []).value('$dateFormat', 'DD.MM.YYYY HH:mm:ss').filter('dateFormat', ["$utils", function($utils) {
    return function(value) {
      return $utils.formatDate(value);
    };
  }]).config(["$httpProvider", function($httpProvider) {
    $httpProvider.interceptors.push(HttpInterceptor_1.default.factory);
  }]).provider('$rest', RestService_1.RestServiceProvider).provider('$config', ConfigService_1.default).service('$utils', UtilsService_1.default).provider('$settings', SettingsService_1.SettingsServiceProvider);
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = exports.module;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("9", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(window, document, undefined) {
    'use strict';
    function minErr(module, ErrorConstructor) {
      ErrorConstructor = ErrorConstructor || Error;
      return function() {
        var SKIP_INDEXES = 2;
        var templateArgs = arguments,
            code = templateArgs[0],
            message = '[' + (module ? module + ':' : '') + code + '] ',
            template = templateArgs[1],
            paramPrefix,
            i;
        message += template.replace(/\{\d+\}/g, function(match) {
          var index = +match.slice(1, -1),
              shiftedIndex = index + SKIP_INDEXES;
          if (shiftedIndex < templateArgs.length) {
            return toDebugString(templateArgs[shiftedIndex]);
          }
          return match;
        });
        message += '\nhttp://errors.angularjs.org/1.4.7/' + (module ? module + '/' : '') + code;
        for (i = SKIP_INDEXES, paramPrefix = '?'; i < templateArgs.length; i++, paramPrefix = '&') {
          message += paramPrefix + 'p' + (i - SKIP_INDEXES) + '=' + encodeURIComponent(toDebugString(templateArgs[i]));
        }
        return new ErrorConstructor(message);
      };
    }
    var REGEX_STRING_REGEXP = /^\/(.+)\/([a-z]*)$/;
    var VALIDITY_STATE_PROPERTY = 'validity';
    var lowercase = function(string) {
      return isString(string) ? string.toLowerCase() : string;
    };
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var uppercase = function(string) {
      return isString(string) ? string.toUpperCase() : string;
    };
    var manualLowercase = function(s) {
      return isString(s) ? s.replace(/[A-Z]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) | 32);
      }) : s;
    };
    var manualUppercase = function(s) {
      return isString(s) ? s.replace(/[a-z]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) & ~32);
      }) : s;
    };
    if ('i' !== 'I'.toLowerCase()) {
      lowercase = manualLowercase;
      uppercase = manualUppercase;
    }
    var msie,
        jqLite,
        jQuery,
        slice = [].slice,
        splice = [].splice,
        push = [].push,
        toString = Object.prototype.toString,
        getPrototypeOf = Object.getPrototypeOf,
        ngMinErr = minErr('ng'),
        angular = window.angular || (window.angular = {}),
        angularModule,
        uid = 0;
    msie = document.documentMode;
    function isArrayLike(obj) {
      if (obj == null || isWindow(obj)) {
        return false;
      }
      var length = "length" in Object(obj) && obj.length;
      if (obj.nodeType === NODE_TYPE_ELEMENT && length) {
        return true;
      }
      return isString(obj) || isArray(obj) || length === 0 || typeof length === 'number' && length > 0 && (length - 1) in obj;
    }
    function forEach(obj, iterator, context) {
      var key,
          length;
      if (obj) {
        if (isFunction(obj)) {
          for (key in obj) {
            if (key != 'prototype' && key != 'length' && key != 'name' && (!obj.hasOwnProperty || obj.hasOwnProperty(key))) {
              iterator.call(context, obj[key], key, obj);
            }
          }
        } else if (isArray(obj) || isArrayLike(obj)) {
          var isPrimitive = typeof obj !== 'object';
          for (key = 0, length = obj.length; key < length; key++) {
            if (isPrimitive || key in obj) {
              iterator.call(context, obj[key], key, obj);
            }
          }
        } else if (obj.forEach && obj.forEach !== forEach) {
          obj.forEach(iterator, context, obj);
        } else if (isBlankObject(obj)) {
          for (key in obj) {
            iterator.call(context, obj[key], key, obj);
          }
        } else if (typeof obj.hasOwnProperty === 'function') {
          for (key in obj) {
            if (obj.hasOwnProperty(key)) {
              iterator.call(context, obj[key], key, obj);
            }
          }
        } else {
          for (key in obj) {
            if (hasOwnProperty.call(obj, key)) {
              iterator.call(context, obj[key], key, obj);
            }
          }
        }
      }
      return obj;
    }
    function forEachSorted(obj, iterator, context) {
      var keys = Object.keys(obj).sort();
      for (var i = 0; i < keys.length; i++) {
        iterator.call(context, obj[keys[i]], keys[i]);
      }
      return keys;
    }
    function reverseParams(iteratorFn) {
      return function(value, key) {
        iteratorFn(key, value);
      };
    }
    function nextUid() {
      return ++uid;
    }
    function setHashKey(obj, h) {
      if (h) {
        obj.$$hashKey = h;
      } else {
        delete obj.$$hashKey;
      }
    }
    function baseExtend(dst, objs, deep) {
      var h = dst.$$hashKey;
      for (var i = 0,
          ii = objs.length; i < ii; ++i) {
        var obj = objs[i];
        if (!isObject(obj) && !isFunction(obj))
          continue;
        var keys = Object.keys(obj);
        for (var j = 0,
            jj = keys.length; j < jj; j++) {
          var key = keys[j];
          var src = obj[key];
          if (deep && isObject(src)) {
            if (isDate(src)) {
              dst[key] = new Date(src.valueOf());
            } else if (isRegExp(src)) {
              dst[key] = new RegExp(src);
            } else {
              if (!isObject(dst[key]))
                dst[key] = isArray(src) ? [] : {};
              baseExtend(dst[key], [src], true);
            }
          } else {
            dst[key] = src;
          }
        }
      }
      setHashKey(dst, h);
      return dst;
    }
    function extend(dst) {
      return baseExtend(dst, slice.call(arguments, 1), false);
    }
    function merge(dst) {
      return baseExtend(dst, slice.call(arguments, 1), true);
    }
    function toInt(str) {
      return parseInt(str, 10);
    }
    function inherit(parent, extra) {
      return extend(Object.create(parent), extra);
    }
    function noop() {}
    noop.$inject = [];
    function identity($) {
      return $;
    }
    identity.$inject = [];
    function valueFn(value) {
      return function() {
        return value;
      };
    }
    function hasCustomToString(obj) {
      return isFunction(obj.toString) && obj.toString !== Object.prototype.toString;
    }
    function isUndefined(value) {
      return typeof value === 'undefined';
    }
    function isDefined(value) {
      return typeof value !== 'undefined';
    }
    function isObject(value) {
      return value !== null && typeof value === 'object';
    }
    function isBlankObject(value) {
      return value !== null && typeof value === 'object' && !getPrototypeOf(value);
    }
    function isString(value) {
      return typeof value === 'string';
    }
    function isNumber(value) {
      return typeof value === 'number';
    }
    function isDate(value) {
      return toString.call(value) === '[object Date]';
    }
    var isArray = Array.isArray;
    function isFunction(value) {
      return typeof value === 'function';
    }
    function isRegExp(value) {
      return toString.call(value) === '[object RegExp]';
    }
    function isWindow(obj) {
      return obj && obj.window === obj;
    }
    function isScope(obj) {
      return obj && obj.$evalAsync && obj.$watch;
    }
    function isFile(obj) {
      return toString.call(obj) === '[object File]';
    }
    function isFormData(obj) {
      return toString.call(obj) === '[object FormData]';
    }
    function isBlob(obj) {
      return toString.call(obj) === '[object Blob]';
    }
    function isBoolean(value) {
      return typeof value === 'boolean';
    }
    function isPromiseLike(obj) {
      return obj && isFunction(obj.then);
    }
    var TYPED_ARRAY_REGEXP = /^\[object (Uint8(Clamped)?)|(Uint16)|(Uint32)|(Int8)|(Int16)|(Int32)|(Float(32)|(64))Array\]$/;
    function isTypedArray(value) {
      return TYPED_ARRAY_REGEXP.test(toString.call(value));
    }
    var trim = function(value) {
      return isString(value) ? value.trim() : value;
    };
    var escapeForRegexp = function(s) {
      return s.replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1').replace(/\x08/g, '\\x08');
    };
    function isElement(node) {
      return !!(node && (node.nodeName || (node.prop && node.attr && node.find)));
    }
    function makeMap(str) {
      var obj = {},
          items = str.split(","),
          i;
      for (i = 0; i < items.length; i++) {
        obj[items[i]] = true;
      }
      return obj;
    }
    function nodeName_(element) {
      return lowercase(element.nodeName || (element[0] && element[0].nodeName));
    }
    function includes(array, obj) {
      return Array.prototype.indexOf.call(array, obj) != -1;
    }
    function arrayRemove(array, value) {
      var index = array.indexOf(value);
      if (index >= 0) {
        array.splice(index, 1);
      }
      return index;
    }
    function copy(source, destination, stackSource, stackDest) {
      if (isWindow(source) || isScope(source)) {
        throw ngMinErr('cpws', "Can't copy! Making copies of Window or Scope instances is not supported.");
      }
      if (isTypedArray(destination)) {
        throw ngMinErr('cpta', "Can't copy! TypedArray destination cannot be mutated.");
      }
      if (!destination) {
        destination = source;
        if (isObject(source)) {
          var index;
          if (stackSource && (index = stackSource.indexOf(source)) !== -1) {
            return stackDest[index];
          }
          if (isArray(source)) {
            return copy(source, [], stackSource, stackDest);
          } else if (isTypedArray(source)) {
            destination = new source.constructor(source);
          } else if (isDate(source)) {
            destination = new Date(source.getTime());
          } else if (isRegExp(source)) {
            destination = new RegExp(source.source, source.toString().match(/[^\/]*$/)[0]);
            destination.lastIndex = source.lastIndex;
          } else if (isFunction(source.cloneNode)) {
            destination = source.cloneNode(true);
          } else {
            var emptyObject = Object.create(getPrototypeOf(source));
            return copy(source, emptyObject, stackSource, stackDest);
          }
          if (stackDest) {
            stackSource.push(source);
            stackDest.push(destination);
          }
        }
      } else {
        if (source === destination)
          throw ngMinErr('cpi', "Can't copy! Source and destination are identical.");
        stackSource = stackSource || [];
        stackDest = stackDest || [];
        if (isObject(source)) {
          stackSource.push(source);
          stackDest.push(destination);
        }
        var result,
            key;
        if (isArray(source)) {
          destination.length = 0;
          for (var i = 0; i < source.length; i++) {
            destination.push(copy(source[i], null, stackSource, stackDest));
          }
        } else {
          var h = destination.$$hashKey;
          if (isArray(destination)) {
            destination.length = 0;
          } else {
            forEach(destination, function(value, key) {
              delete destination[key];
            });
          }
          if (isBlankObject(source)) {
            for (key in source) {
              destination[key] = copy(source[key], null, stackSource, stackDest);
            }
          } else if (source && typeof source.hasOwnProperty === 'function') {
            for (key in source) {
              if (source.hasOwnProperty(key)) {
                destination[key] = copy(source[key], null, stackSource, stackDest);
              }
            }
          } else {
            for (key in source) {
              if (hasOwnProperty.call(source, key)) {
                destination[key] = copy(source[key], null, stackSource, stackDest);
              }
            }
          }
          setHashKey(destination, h);
        }
      }
      return destination;
    }
    function shallowCopy(src, dst) {
      if (isArray(src)) {
        dst = dst || [];
        for (var i = 0,
            ii = src.length; i < ii; i++) {
          dst[i] = src[i];
        }
      } else if (isObject(src)) {
        dst = dst || {};
        for (var key in src) {
          if (!(key.charAt(0) === '$' && key.charAt(1) === '$')) {
            dst[key] = src[key];
          }
        }
      }
      return dst || src;
    }
    function equals(o1, o2) {
      if (o1 === o2)
        return true;
      if (o1 === null || o2 === null)
        return false;
      if (o1 !== o1 && o2 !== o2)
        return true;
      var t1 = typeof o1,
          t2 = typeof o2,
          length,
          key,
          keySet;
      if (t1 == t2) {
        if (t1 == 'object') {
          if (isArray(o1)) {
            if (!isArray(o2))
              return false;
            if ((length = o1.length) == o2.length) {
              for (key = 0; key < length; key++) {
                if (!equals(o1[key], o2[key]))
                  return false;
              }
              return true;
            }
          } else if (isDate(o1)) {
            if (!isDate(o2))
              return false;
            return equals(o1.getTime(), o2.getTime());
          } else if (isRegExp(o1)) {
            return isRegExp(o2) ? o1.toString() == o2.toString() : false;
          } else {
            if (isScope(o1) || isScope(o2) || isWindow(o1) || isWindow(o2) || isArray(o2) || isDate(o2) || isRegExp(o2))
              return false;
            keySet = createMap();
            for (key in o1) {
              if (key.charAt(0) === '$' || isFunction(o1[key]))
                continue;
              if (!equals(o1[key], o2[key]))
                return false;
              keySet[key] = true;
            }
            for (key in o2) {
              if (!(key in keySet) && key.charAt(0) !== '$' && isDefined(o2[key]) && !isFunction(o2[key]))
                return false;
            }
            return true;
          }
        }
      }
      return false;
    }
    var csp = function() {
      if (!isDefined(csp.rules)) {
        var ngCspElement = (document.querySelector('[ng-csp]') || document.querySelector('[data-ng-csp]'));
        if (ngCspElement) {
          var ngCspAttribute = ngCspElement.getAttribute('ng-csp') || ngCspElement.getAttribute('data-ng-csp');
          csp.rules = {
            noUnsafeEval: !ngCspAttribute || (ngCspAttribute.indexOf('no-unsafe-eval') !== -1),
            noInlineStyle: !ngCspAttribute || (ngCspAttribute.indexOf('no-inline-style') !== -1)
          };
        } else {
          csp.rules = {
            noUnsafeEval: noUnsafeEval(),
            noInlineStyle: false
          };
        }
      }
      return csp.rules;
      function noUnsafeEval() {
        try {
          new Function('');
          return false;
        } catch (e) {
          return true;
        }
      }
    };
    var jq = function() {
      if (isDefined(jq.name_))
        return jq.name_;
      var el;
      var i,
          ii = ngAttrPrefixes.length,
          prefix,
          name;
      for (i = 0; i < ii; ++i) {
        prefix = ngAttrPrefixes[i];
        if (el = document.querySelector('[' + prefix.replace(':', '\\:') + 'jq]')) {
          name = el.getAttribute(prefix + 'jq');
          break;
        }
      }
      return (jq.name_ = name);
    };
    function concat(array1, array2, index) {
      return array1.concat(slice.call(array2, index));
    }
    function sliceArgs(args, startIndex) {
      return slice.call(args, startIndex || 0);
    }
    function bind(self, fn) {
      var curryArgs = arguments.length > 2 ? sliceArgs(arguments, 2) : [];
      if (isFunction(fn) && !(fn instanceof RegExp)) {
        return curryArgs.length ? function() {
          return arguments.length ? fn.apply(self, concat(curryArgs, arguments, 0)) : fn.apply(self, curryArgs);
        } : function() {
          return arguments.length ? fn.apply(self, arguments) : fn.call(self);
        };
      } else {
        return fn;
      }
    }
    function toJsonReplacer(key, value) {
      var val = value;
      if (typeof key === 'string' && key.charAt(0) === '$' && key.charAt(1) === '$') {
        val = undefined;
      } else if (isWindow(value)) {
        val = '$WINDOW';
      } else if (value && document === value) {
        val = '$DOCUMENT';
      } else if (isScope(value)) {
        val = '$SCOPE';
      }
      return val;
    }
    function toJson(obj, pretty) {
      if (typeof obj === 'undefined')
        return undefined;
      if (!isNumber(pretty)) {
        pretty = pretty ? 2 : null;
      }
      return JSON.stringify(obj, toJsonReplacer, pretty);
    }
    function fromJson(json) {
      return isString(json) ? JSON.parse(json) : json;
    }
    function timezoneToOffset(timezone, fallback) {
      var requestedTimezoneOffset = Date.parse('Jan 01, 1970 00:00:00 ' + timezone) / 60000;
      return isNaN(requestedTimezoneOffset) ? fallback : requestedTimezoneOffset;
    }
    function addDateMinutes(date, minutes) {
      date = new Date(date.getTime());
      date.setMinutes(date.getMinutes() + minutes);
      return date;
    }
    function convertTimezoneToLocal(date, timezone, reverse) {
      reverse = reverse ? -1 : 1;
      var timezoneOffset = timezoneToOffset(timezone, date.getTimezoneOffset());
      return addDateMinutes(date, reverse * (timezoneOffset - date.getTimezoneOffset()));
    }
    function startingTag(element) {
      element = jqLite(element).clone();
      try {
        element.empty();
      } catch (e) {}
      var elemHtml = jqLite('<div>').append(element).html();
      try {
        return element[0].nodeType === NODE_TYPE_TEXT ? lowercase(elemHtml) : elemHtml.match(/^(<[^>]+>)/)[1].replace(/^<([\w\-]+)/, function(match, nodeName) {
          return '<' + lowercase(nodeName);
        });
      } catch (e) {
        return lowercase(elemHtml);
      }
    }
    function tryDecodeURIComponent(value) {
      try {
        return decodeURIComponent(value);
      } catch (e) {}
    }
    function parseKeyValue(keyValue) {
      var obj = {};
      forEach((keyValue || "").split('&'), function(keyValue) {
        var splitPoint,
            key,
            val;
        if (keyValue) {
          key = keyValue = keyValue.replace(/\+/g, '%20');
          splitPoint = keyValue.indexOf('=');
          if (splitPoint !== -1) {
            key = keyValue.substring(0, splitPoint);
            val = keyValue.substring(splitPoint + 1);
          }
          key = tryDecodeURIComponent(key);
          if (isDefined(key)) {
            val = isDefined(val) ? tryDecodeURIComponent(val) : true;
            if (!hasOwnProperty.call(obj, key)) {
              obj[key] = val;
            } else if (isArray(obj[key])) {
              obj[key].push(val);
            } else {
              obj[key] = [obj[key], val];
            }
          }
        }
      });
      return obj;
    }
    function toKeyValue(obj) {
      var parts = [];
      forEach(obj, function(value, key) {
        if (isArray(value)) {
          forEach(value, function(arrayValue) {
            parts.push(encodeUriQuery(key, true) + (arrayValue === true ? '' : '=' + encodeUriQuery(arrayValue, true)));
          });
        } else {
          parts.push(encodeUriQuery(key, true) + (value === true ? '' : '=' + encodeUriQuery(value, true)));
        }
      });
      return parts.length ? parts.join('&') : '';
    }
    function encodeUriSegment(val) {
      return encodeUriQuery(val, true).replace(/%26/gi, '&').replace(/%3D/gi, '=').replace(/%2B/gi, '+');
    }
    function encodeUriQuery(val, pctEncodeSpaces) {
      return encodeURIComponent(val).replace(/%40/gi, '@').replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%3B/gi, ';').replace(/%20/g, (pctEncodeSpaces ? '%20' : '+'));
    }
    var ngAttrPrefixes = ['ng-', 'data-ng-', 'ng:', 'x-ng-'];
    function getNgAttribute(element, ngAttr) {
      var attr,
          i,
          ii = ngAttrPrefixes.length;
      for (i = 0; i < ii; ++i) {
        attr = ngAttrPrefixes[i] + ngAttr;
        if (isString(attr = element.getAttribute(attr))) {
          return attr;
        }
      }
      return null;
    }
    function angularInit(element, bootstrap) {
      var appElement,
          module,
          config = {};
      forEach(ngAttrPrefixes, function(prefix) {
        var name = prefix + 'app';
        if (!appElement && element.hasAttribute && element.hasAttribute(name)) {
          appElement = element;
          module = element.getAttribute(name);
        }
      });
      forEach(ngAttrPrefixes, function(prefix) {
        var name = prefix + 'app';
        var candidate;
        if (!appElement && (candidate = element.querySelector('[' + name.replace(':', '\\:') + ']'))) {
          appElement = candidate;
          module = candidate.getAttribute(name);
        }
      });
      if (appElement) {
        config.strictDi = getNgAttribute(appElement, "strict-di") !== null;
        bootstrap(appElement, module ? [module] : [], config);
      }
    }
    function bootstrap(element, modules, config) {
      if (!isObject(config))
        config = {};
      var defaultConfig = {strictDi: false};
      config = extend(defaultConfig, config);
      var doBootstrap = function() {
        element = jqLite(element);
        if (element.injector()) {
          var tag = (element[0] === document) ? 'document' : startingTag(element);
          throw ngMinErr('btstrpd', "App Already Bootstrapped with this Element '{0}'", tag.replace(/</, '&lt;').replace(/>/, '&gt;'));
        }
        modules = modules || [];
        modules.unshift(['$provide', function($provide) {
          $provide.value('$rootElement', element);
        }]);
        if (config.debugInfoEnabled) {
          modules.push(['$compileProvider', function($compileProvider) {
            $compileProvider.debugInfoEnabled(true);
          }]);
        }
        modules.unshift('ng');
        var injector = createInjector(modules, config.strictDi);
        injector.invoke(['$rootScope', '$rootElement', '$compile', '$injector', function bootstrapApply(scope, element, compile, injector) {
          scope.$apply(function() {
            element.data('$injector', injector);
            compile(element)(scope);
          });
        }]);
        return injector;
      };
      var NG_ENABLE_DEBUG_INFO = /^NG_ENABLE_DEBUG_INFO!/;
      var NG_DEFER_BOOTSTRAP = /^NG_DEFER_BOOTSTRAP!/;
      if (window && NG_ENABLE_DEBUG_INFO.test(window.name)) {
        config.debugInfoEnabled = true;
        window.name = window.name.replace(NG_ENABLE_DEBUG_INFO, '');
      }
      if (window && !NG_DEFER_BOOTSTRAP.test(window.name)) {
        return doBootstrap();
      }
      window.name = window.name.replace(NG_DEFER_BOOTSTRAP, '');
      angular.resumeBootstrap = function(extraModules) {
        forEach(extraModules, function(module) {
          modules.push(module);
        });
        return doBootstrap();
      };
      if (isFunction(angular.resumeDeferredBootstrap)) {
        angular.resumeDeferredBootstrap();
      }
    }
    function reloadWithDebugInfo() {
      window.name = 'NG_ENABLE_DEBUG_INFO!' + window.name;
      window.location.reload();
    }
    function getTestability(rootElement) {
      var injector = angular.element(rootElement).injector();
      if (!injector) {
        throw ngMinErr('test', 'no injector found for element argument to getTestability');
      }
      return injector.get('$$testability');
    }
    var SNAKE_CASE_REGEXP = /[A-Z]/g;
    function snake_case(name, separator) {
      separator = separator || '_';
      return name.replace(SNAKE_CASE_REGEXP, function(letter, pos) {
        return (pos ? separator : '') + letter.toLowerCase();
      });
    }
    var bindJQueryFired = false;
    var skipDestroyOnNextJQueryCleanData;
    function bindJQuery() {
      var originalCleanData;
      if (bindJQueryFired) {
        return;
      }
      var jqName = jq();
      jQuery = isUndefined(jqName) ? window.jQuery : !jqName ? undefined : window[jqName];
      if (jQuery && jQuery.fn.on) {
        jqLite = jQuery;
        extend(jQuery.fn, {
          scope: JQLitePrototype.scope,
          isolateScope: JQLitePrototype.isolateScope,
          controller: JQLitePrototype.controller,
          injector: JQLitePrototype.injector,
          inheritedData: JQLitePrototype.inheritedData
        });
        originalCleanData = jQuery.cleanData;
        jQuery.cleanData = function(elems) {
          var events;
          if (!skipDestroyOnNextJQueryCleanData) {
            for (var i = 0,
                elem; (elem = elems[i]) != null; i++) {
              events = jQuery._data(elem, "events");
              if (events && events.$destroy) {
                jQuery(elem).triggerHandler('$destroy');
              }
            }
          } else {
            skipDestroyOnNextJQueryCleanData = false;
          }
          originalCleanData(elems);
        };
      } else {
        jqLite = JQLite;
      }
      angular.element = jqLite;
      bindJQueryFired = true;
    }
    function assertArg(arg, name, reason) {
      if (!arg) {
        throw ngMinErr('areq', "Argument '{0}' is {1}", (name || '?'), (reason || "required"));
      }
      return arg;
    }
    function assertArgFn(arg, name, acceptArrayAnnotation) {
      if (acceptArrayAnnotation && isArray(arg)) {
        arg = arg[arg.length - 1];
      }
      assertArg(isFunction(arg), name, 'not a function, got ' + (arg && typeof arg === 'object' ? arg.constructor.name || 'Object' : typeof arg));
      return arg;
    }
    function assertNotHasOwnProperty(name, context) {
      if (name === 'hasOwnProperty') {
        throw ngMinErr('badname', "hasOwnProperty is not a valid {0} name", context);
      }
    }
    function getter(obj, path, bindFnToScope) {
      if (!path)
        return obj;
      var keys = path.split('.');
      var key;
      var lastInstance = obj;
      var len = keys.length;
      for (var i = 0; i < len; i++) {
        key = keys[i];
        if (obj) {
          obj = (lastInstance = obj)[key];
        }
      }
      if (!bindFnToScope && isFunction(obj)) {
        return bind(lastInstance, obj);
      }
      return obj;
    }
    function getBlockNodes(nodes) {
      var node = nodes[0];
      var endNode = nodes[nodes.length - 1];
      var blockNodes;
      for (var i = 1; node !== endNode && (node = node.nextSibling); i++) {
        if (blockNodes || nodes[i] !== node) {
          if (!blockNodes) {
            blockNodes = jqLite(slice.call(nodes, 0, i));
          }
          blockNodes.push(node);
        }
      }
      return blockNodes || nodes;
    }
    function createMap() {
      return Object.create(null);
    }
    var NODE_TYPE_ELEMENT = 1;
    var NODE_TYPE_ATTRIBUTE = 2;
    var NODE_TYPE_TEXT = 3;
    var NODE_TYPE_COMMENT = 8;
    var NODE_TYPE_DOCUMENT = 9;
    var NODE_TYPE_DOCUMENT_FRAGMENT = 11;
    function setupModuleLoader(window) {
      var $injectorMinErr = minErr('$injector');
      var ngMinErr = minErr('ng');
      function ensure(obj, name, factory) {
        return obj[name] || (obj[name] = factory());
      }
      var angular = ensure(window, 'angular', Object);
      angular.$$minErr = angular.$$minErr || minErr;
      return ensure(angular, 'module', function() {
        var modules = {};
        return function module(name, requires, configFn) {
          var assertNotHasOwnProperty = function(name, context) {
            if (name === 'hasOwnProperty') {
              throw ngMinErr('badname', 'hasOwnProperty is not a valid {0} name', context);
            }
          };
          assertNotHasOwnProperty(name, 'module');
          if (requires && modules.hasOwnProperty(name)) {
            modules[name] = null;
          }
          return ensure(modules, name, function() {
            if (!requires) {
              throw $injectorMinErr('nomod', "Module '{0}' is not available! You either misspelled " + "the module name or forgot to load it. If registering a module ensure that you " + "specify the dependencies as the second argument.", name);
            }
            var invokeQueue = [];
            var configBlocks = [];
            var runBlocks = [];
            var config = invokeLater('$injector', 'invoke', 'push', configBlocks);
            var moduleInstance = {
              _invokeQueue: invokeQueue,
              _configBlocks: configBlocks,
              _runBlocks: runBlocks,
              requires: requires,
              name: name,
              provider: invokeLaterAndSetModuleName('$provide', 'provider'),
              factory: invokeLaterAndSetModuleName('$provide', 'factory'),
              service: invokeLaterAndSetModuleName('$provide', 'service'),
              value: invokeLater('$provide', 'value'),
              constant: invokeLater('$provide', 'constant', 'unshift'),
              decorator: invokeLaterAndSetModuleName('$provide', 'decorator'),
              animation: invokeLaterAndSetModuleName('$animateProvider', 'register'),
              filter: invokeLaterAndSetModuleName('$filterProvider', 'register'),
              controller: invokeLaterAndSetModuleName('$controllerProvider', 'register'),
              directive: invokeLaterAndSetModuleName('$compileProvider', 'directive'),
              config: config,
              run: function(block) {
                runBlocks.push(block);
                return this;
              }
            };
            if (configFn) {
              config(configFn);
            }
            return moduleInstance;
            function invokeLater(provider, method, insertMethod, queue) {
              if (!queue)
                queue = invokeQueue;
              return function() {
                queue[insertMethod || 'push']([provider, method, arguments]);
                return moduleInstance;
              };
            }
            function invokeLaterAndSetModuleName(provider, method) {
              return function(recipeName, factoryFunction) {
                if (factoryFunction && isFunction(factoryFunction))
                  factoryFunction.$$moduleName = name;
                invokeQueue.push([provider, method, arguments]);
                return moduleInstance;
              };
            }
          });
        };
      });
    }
    function serializeObject(obj) {
      var seen = [];
      return JSON.stringify(obj, function(key, val) {
        val = toJsonReplacer(key, val);
        if (isObject(val)) {
          if (seen.indexOf(val) >= 0)
            return '...';
          seen.push(val);
        }
        return val;
      });
    }
    function toDebugString(obj) {
      if (typeof obj === 'function') {
        return obj.toString().replace(/ \{[\s\S]*$/, '');
      } else if (isUndefined(obj)) {
        return 'undefined';
      } else if (typeof obj !== 'string') {
        return serializeObject(obj);
      }
      return obj;
    }
    var version = {
      full: '1.4.7',
      major: 1,
      minor: 4,
      dot: 7,
      codeName: 'dark-luminescence'
    };
    function publishExternalAPI(angular) {
      extend(angular, {
        'bootstrap': bootstrap,
        'copy': copy,
        'extend': extend,
        'merge': merge,
        'equals': equals,
        'element': jqLite,
        'forEach': forEach,
        'injector': createInjector,
        'noop': noop,
        'bind': bind,
        'toJson': toJson,
        'fromJson': fromJson,
        'identity': identity,
        'isUndefined': isUndefined,
        'isDefined': isDefined,
        'isString': isString,
        'isFunction': isFunction,
        'isObject': isObject,
        'isNumber': isNumber,
        'isElement': isElement,
        'isArray': isArray,
        'version': version,
        'isDate': isDate,
        'lowercase': lowercase,
        'uppercase': uppercase,
        'callbacks': {counter: 0},
        'getTestability': getTestability,
        '$$minErr': minErr,
        '$$csp': csp,
        'reloadWithDebugInfo': reloadWithDebugInfo
      });
      angularModule = setupModuleLoader(window);
      angularModule('ng', ['ngLocale'], ['$provide', function ngModule($provide) {
        $provide.provider({$$sanitizeUri: $$SanitizeUriProvider});
        $provide.provider('$compile', $CompileProvider).directive({
          a: htmlAnchorDirective,
          input: inputDirective,
          textarea: inputDirective,
          form: formDirective,
          script: scriptDirective,
          select: selectDirective,
          style: styleDirective,
          option: optionDirective,
          ngBind: ngBindDirective,
          ngBindHtml: ngBindHtmlDirective,
          ngBindTemplate: ngBindTemplateDirective,
          ngClass: ngClassDirective,
          ngClassEven: ngClassEvenDirective,
          ngClassOdd: ngClassOddDirective,
          ngCloak: ngCloakDirective,
          ngController: ngControllerDirective,
          ngForm: ngFormDirective,
          ngHide: ngHideDirective,
          ngIf: ngIfDirective,
          ngInclude: ngIncludeDirective,
          ngInit: ngInitDirective,
          ngNonBindable: ngNonBindableDirective,
          ngPluralize: ngPluralizeDirective,
          ngRepeat: ngRepeatDirective,
          ngShow: ngShowDirective,
          ngStyle: ngStyleDirective,
          ngSwitch: ngSwitchDirective,
          ngSwitchWhen: ngSwitchWhenDirective,
          ngSwitchDefault: ngSwitchDefaultDirective,
          ngOptions: ngOptionsDirective,
          ngTransclude: ngTranscludeDirective,
          ngModel: ngModelDirective,
          ngList: ngListDirective,
          ngChange: ngChangeDirective,
          pattern: patternDirective,
          ngPattern: patternDirective,
          required: requiredDirective,
          ngRequired: requiredDirective,
          minlength: minlengthDirective,
          ngMinlength: minlengthDirective,
          maxlength: maxlengthDirective,
          ngMaxlength: maxlengthDirective,
          ngValue: ngValueDirective,
          ngModelOptions: ngModelOptionsDirective
        }).directive({ngInclude: ngIncludeFillContentDirective}).directive(ngAttributeAliasDirectives).directive(ngEventDirectives);
        $provide.provider({
          $anchorScroll: $AnchorScrollProvider,
          $animate: $AnimateProvider,
          $animateCss: $CoreAnimateCssProvider,
          $$animateQueue: $$CoreAnimateQueueProvider,
          $$AnimateRunner: $$CoreAnimateRunnerProvider,
          $browser: $BrowserProvider,
          $cacheFactory: $CacheFactoryProvider,
          $controller: $ControllerProvider,
          $document: $DocumentProvider,
          $exceptionHandler: $ExceptionHandlerProvider,
          $filter: $FilterProvider,
          $$forceReflow: $$ForceReflowProvider,
          $interpolate: $InterpolateProvider,
          $interval: $IntervalProvider,
          $http: $HttpProvider,
          $httpParamSerializer: $HttpParamSerializerProvider,
          $httpParamSerializerJQLike: $HttpParamSerializerJQLikeProvider,
          $httpBackend: $HttpBackendProvider,
          $xhrFactory: $xhrFactoryProvider,
          $location: $LocationProvider,
          $log: $LogProvider,
          $parse: $ParseProvider,
          $rootScope: $RootScopeProvider,
          $q: $QProvider,
          $$q: $$QProvider,
          $sce: $SceProvider,
          $sceDelegate: $SceDelegateProvider,
          $sniffer: $SnifferProvider,
          $templateCache: $TemplateCacheProvider,
          $templateRequest: $TemplateRequestProvider,
          $$testability: $$TestabilityProvider,
          $timeout: $TimeoutProvider,
          $window: $WindowProvider,
          $$rAF: $$RAFProvider,
          $$jqLite: $$jqLiteProvider,
          $$HashMap: $$HashMapProvider,
          $$cookieReader: $$CookieReaderProvider
        });
      }]);
    }
    JQLite.expando = 'ng339';
    var jqCache = JQLite.cache = {},
        jqId = 1,
        addEventListenerFn = function(element, type, fn) {
          element.addEventListener(type, fn, false);
        },
        removeEventListenerFn = function(element, type, fn) {
          element.removeEventListener(type, fn, false);
        };
    JQLite._data = function(node) {
      return this.cache[node[this.expando]] || {};
    };
    function jqNextId() {
      return ++jqId;
    }
    var SPECIAL_CHARS_REGEXP = /([\:\-\_]+(.))/g;
    var MOZ_HACK_REGEXP = /^moz([A-Z])/;
    var MOUSE_EVENT_MAP = {
      mouseleave: "mouseout",
      mouseenter: "mouseover"
    };
    var jqLiteMinErr = minErr('jqLite');
    function camelCase(name) {
      return name.replace(SPECIAL_CHARS_REGEXP, function(_, separator, letter, offset) {
        return offset ? letter.toUpperCase() : letter;
      }).replace(MOZ_HACK_REGEXP, 'Moz$1');
    }
    var SINGLE_TAG_REGEXP = /^<([\w-]+)\s*\/?>(?:<\/\1>|)$/;
    var HTML_REGEXP = /<|&#?\w+;/;
    var TAG_NAME_REGEXP = /<([\w:-]+)/;
    var XHTML_TAG_REGEXP = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:-]+)[^>]*)\/>/gi;
    var wrapMap = {
      'option': [1, '<select multiple="multiple">', '</select>'],
      'thead': [1, '<table>', '</table>'],
      'col': [2, '<table><colgroup>', '</colgroup></table>'],
      'tr': [2, '<table><tbody>', '</tbody></table>'],
      'td': [3, '<table><tbody><tr>', '</tr></tbody></table>'],
      '_default': [0, "", ""]
    };
    wrapMap.optgroup = wrapMap.option;
    wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
    wrapMap.th = wrapMap.td;
    function jqLiteIsTextNode(html) {
      return !HTML_REGEXP.test(html);
    }
    function jqLiteAcceptsData(node) {
      var nodeType = node.nodeType;
      return nodeType === NODE_TYPE_ELEMENT || !nodeType || nodeType === NODE_TYPE_DOCUMENT;
    }
    function jqLiteHasData(node) {
      for (var key in jqCache[node.ng339]) {
        return true;
      }
      return false;
    }
    function jqLiteBuildFragment(html, context) {
      var tmp,
          tag,
          wrap,
          fragment = context.createDocumentFragment(),
          nodes = [],
          i;
      if (jqLiteIsTextNode(html)) {
        nodes.push(context.createTextNode(html));
      } else {
        tmp = tmp || fragment.appendChild(context.createElement("div"));
        tag = (TAG_NAME_REGEXP.exec(html) || ["", ""])[1].toLowerCase();
        wrap = wrapMap[tag] || wrapMap._default;
        tmp.innerHTML = wrap[1] + html.replace(XHTML_TAG_REGEXP, "<$1></$2>") + wrap[2];
        i = wrap[0];
        while (i--) {
          tmp = tmp.lastChild;
        }
        nodes = concat(nodes, tmp.childNodes);
        tmp = fragment.firstChild;
        tmp.textContent = "";
      }
      fragment.textContent = "";
      fragment.innerHTML = "";
      forEach(nodes, function(node) {
        fragment.appendChild(node);
      });
      return fragment;
    }
    function jqLiteParseHTML(html, context) {
      context = context || document;
      var parsed;
      if ((parsed = SINGLE_TAG_REGEXP.exec(html))) {
        return [context.createElement(parsed[1])];
      }
      if ((parsed = jqLiteBuildFragment(html, context))) {
        return parsed.childNodes;
      }
      return [];
    }
    function JQLite(element) {
      if (element instanceof JQLite) {
        return element;
      }
      var argIsString;
      if (isString(element)) {
        element = trim(element);
        argIsString = true;
      }
      if (!(this instanceof JQLite)) {
        if (argIsString && element.charAt(0) != '<') {
          throw jqLiteMinErr('nosel', 'Looking up elements via selectors is not supported by jqLite! See: http://docs.angularjs.org/api/angular.element');
        }
        return new JQLite(element);
      }
      if (argIsString) {
        jqLiteAddNodes(this, jqLiteParseHTML(element));
      } else {
        jqLiteAddNodes(this, element);
      }
    }
    function jqLiteClone(element) {
      return element.cloneNode(true);
    }
    function jqLiteDealoc(element, onlyDescendants) {
      if (!onlyDescendants)
        jqLiteRemoveData(element);
      if (element.querySelectorAll) {
        var descendants = element.querySelectorAll('*');
        for (var i = 0,
            l = descendants.length; i < l; i++) {
          jqLiteRemoveData(descendants[i]);
        }
      }
    }
    function jqLiteOff(element, type, fn, unsupported) {
      if (isDefined(unsupported))
        throw jqLiteMinErr('offargs', 'jqLite#off() does not support the `selector` argument');
      var expandoStore = jqLiteExpandoStore(element);
      var events = expandoStore && expandoStore.events;
      var handle = expandoStore && expandoStore.handle;
      if (!handle)
        return;
      if (!type) {
        for (type in events) {
          if (type !== '$destroy') {
            removeEventListenerFn(element, type, handle);
          }
          delete events[type];
        }
      } else {
        forEach(type.split(' '), function(type) {
          if (isDefined(fn)) {
            var listenerFns = events[type];
            arrayRemove(listenerFns || [], fn);
            if (listenerFns && listenerFns.length > 0) {
              return;
            }
          }
          removeEventListenerFn(element, type, handle);
          delete events[type];
        });
      }
    }
    function jqLiteRemoveData(element, name) {
      var expandoId = element.ng339;
      var expandoStore = expandoId && jqCache[expandoId];
      if (expandoStore) {
        if (name) {
          delete expandoStore.data[name];
          return;
        }
        if (expandoStore.handle) {
          if (expandoStore.events.$destroy) {
            expandoStore.handle({}, '$destroy');
          }
          jqLiteOff(element);
        }
        delete jqCache[expandoId];
        element.ng339 = undefined;
      }
    }
    function jqLiteExpandoStore(element, createIfNecessary) {
      var expandoId = element.ng339,
          expandoStore = expandoId && jqCache[expandoId];
      if (createIfNecessary && !expandoStore) {
        element.ng339 = expandoId = jqNextId();
        expandoStore = jqCache[expandoId] = {
          events: {},
          data: {},
          handle: undefined
        };
      }
      return expandoStore;
    }
    function jqLiteData(element, key, value) {
      if (jqLiteAcceptsData(element)) {
        var isSimpleSetter = isDefined(value);
        var isSimpleGetter = !isSimpleSetter && key && !isObject(key);
        var massGetter = !key;
        var expandoStore = jqLiteExpandoStore(element, !isSimpleGetter);
        var data = expandoStore && expandoStore.data;
        if (isSimpleSetter) {
          data[key] = value;
        } else {
          if (massGetter) {
            return data;
          } else {
            if (isSimpleGetter) {
              return data && data[key];
            } else {
              extend(data, key);
            }
          }
        }
      }
    }
    function jqLiteHasClass(element, selector) {
      if (!element.getAttribute)
        return false;
      return ((" " + (element.getAttribute('class') || '') + " ").replace(/[\n\t]/g, " ").indexOf(" " + selector + " ") > -1);
    }
    function jqLiteRemoveClass(element, cssClasses) {
      if (cssClasses && element.setAttribute) {
        forEach(cssClasses.split(' '), function(cssClass) {
          element.setAttribute('class', trim((" " + (element.getAttribute('class') || '') + " ").replace(/[\n\t]/g, " ").replace(" " + trim(cssClass) + " ", " ")));
        });
      }
    }
    function jqLiteAddClass(element, cssClasses) {
      if (cssClasses && element.setAttribute) {
        var existingClasses = (' ' + (element.getAttribute('class') || '') + ' ').replace(/[\n\t]/g, " ");
        forEach(cssClasses.split(' '), function(cssClass) {
          cssClass = trim(cssClass);
          if (existingClasses.indexOf(' ' + cssClass + ' ') === -1) {
            existingClasses += cssClass + ' ';
          }
        });
        element.setAttribute('class', trim(existingClasses));
      }
    }
    function jqLiteAddNodes(root, elements) {
      if (elements) {
        if (elements.nodeType) {
          root[root.length++] = elements;
        } else {
          var length = elements.length;
          if (typeof length === 'number' && elements.window !== elements) {
            if (length) {
              for (var i = 0; i < length; i++) {
                root[root.length++] = elements[i];
              }
            }
          } else {
            root[root.length++] = elements;
          }
        }
      }
    }
    function jqLiteController(element, name) {
      return jqLiteInheritedData(element, '$' + (name || 'ngController') + 'Controller');
    }
    function jqLiteInheritedData(element, name, value) {
      if (element.nodeType == NODE_TYPE_DOCUMENT) {
        element = element.documentElement;
      }
      var names = isArray(name) ? name : [name];
      while (element) {
        for (var i = 0,
            ii = names.length; i < ii; i++) {
          if (isDefined(value = jqLite.data(element, names[i])))
            return value;
        }
        element = element.parentNode || (element.nodeType === NODE_TYPE_DOCUMENT_FRAGMENT && element.host);
      }
    }
    function jqLiteEmpty(element) {
      jqLiteDealoc(element, true);
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
    }
    function jqLiteRemove(element, keepData) {
      if (!keepData)
        jqLiteDealoc(element);
      var parent = element.parentNode;
      if (parent)
        parent.removeChild(element);
    }
    function jqLiteDocumentLoaded(action, win) {
      win = win || window;
      if (win.document.readyState === 'complete') {
        win.setTimeout(action);
      } else {
        jqLite(win).on('load', action);
      }
    }
    var JQLitePrototype = JQLite.prototype = {
      ready: function(fn) {
        var fired = false;
        function trigger() {
          if (fired)
            return;
          fired = true;
          fn();
        }
        if (document.readyState === 'complete') {
          setTimeout(trigger);
        } else {
          this.on('DOMContentLoaded', trigger);
          JQLite(window).on('load', trigger);
        }
      },
      toString: function() {
        var value = [];
        forEach(this, function(e) {
          value.push('' + e);
        });
        return '[' + value.join(', ') + ']';
      },
      eq: function(index) {
        return (index >= 0) ? jqLite(this[index]) : jqLite(this[this.length + index]);
      },
      length: 0,
      push: push,
      sort: [].sort,
      splice: [].splice
    };
    var BOOLEAN_ATTR = {};
    forEach('multiple,selected,checked,disabled,readOnly,required,open'.split(','), function(value) {
      BOOLEAN_ATTR[lowercase(value)] = value;
    });
    var BOOLEAN_ELEMENTS = {};
    forEach('input,select,option,textarea,button,form,details'.split(','), function(value) {
      BOOLEAN_ELEMENTS[value] = true;
    });
    var ALIASED_ATTR = {
      'ngMinlength': 'minlength',
      'ngMaxlength': 'maxlength',
      'ngMin': 'min',
      'ngMax': 'max',
      'ngPattern': 'pattern'
    };
    function getBooleanAttrName(element, name) {
      var booleanAttr = BOOLEAN_ATTR[name.toLowerCase()];
      return booleanAttr && BOOLEAN_ELEMENTS[nodeName_(element)] && booleanAttr;
    }
    function getAliasedAttrName(name) {
      return ALIASED_ATTR[name];
    }
    forEach({
      data: jqLiteData,
      removeData: jqLiteRemoveData,
      hasData: jqLiteHasData
    }, function(fn, name) {
      JQLite[name] = fn;
    });
    forEach({
      data: jqLiteData,
      inheritedData: jqLiteInheritedData,
      scope: function(element) {
        return jqLite.data(element, '$scope') || jqLiteInheritedData(element.parentNode || element, ['$isolateScope', '$scope']);
      },
      isolateScope: function(element) {
        return jqLite.data(element, '$isolateScope') || jqLite.data(element, '$isolateScopeNoTemplate');
      },
      controller: jqLiteController,
      injector: function(element) {
        return jqLiteInheritedData(element, '$injector');
      },
      removeAttr: function(element, name) {
        element.removeAttribute(name);
      },
      hasClass: jqLiteHasClass,
      css: function(element, name, value) {
        name = camelCase(name);
        if (isDefined(value)) {
          element.style[name] = value;
        } else {
          return element.style[name];
        }
      },
      attr: function(element, name, value) {
        var nodeType = element.nodeType;
        if (nodeType === NODE_TYPE_TEXT || nodeType === NODE_TYPE_ATTRIBUTE || nodeType === NODE_TYPE_COMMENT) {
          return;
        }
        var lowercasedName = lowercase(name);
        if (BOOLEAN_ATTR[lowercasedName]) {
          if (isDefined(value)) {
            if (!!value) {
              element[name] = true;
              element.setAttribute(name, lowercasedName);
            } else {
              element[name] = false;
              element.removeAttribute(lowercasedName);
            }
          } else {
            return (element[name] || (element.attributes.getNamedItem(name) || noop).specified) ? lowercasedName : undefined;
          }
        } else if (isDefined(value)) {
          element.setAttribute(name, value);
        } else if (element.getAttribute) {
          var ret = element.getAttribute(name, 2);
          return ret === null ? undefined : ret;
        }
      },
      prop: function(element, name, value) {
        if (isDefined(value)) {
          element[name] = value;
        } else {
          return element[name];
        }
      },
      text: (function() {
        getText.$dv = '';
        return getText;
        function getText(element, value) {
          if (isUndefined(value)) {
            var nodeType = element.nodeType;
            return (nodeType === NODE_TYPE_ELEMENT || nodeType === NODE_TYPE_TEXT) ? element.textContent : '';
          }
          element.textContent = value;
        }
      })(),
      val: function(element, value) {
        if (isUndefined(value)) {
          if (element.multiple && nodeName_(element) === 'select') {
            var result = [];
            forEach(element.options, function(option) {
              if (option.selected) {
                result.push(option.value || option.text);
              }
            });
            return result.length === 0 ? null : result;
          }
          return element.value;
        }
        element.value = value;
      },
      html: function(element, value) {
        if (isUndefined(value)) {
          return element.innerHTML;
        }
        jqLiteDealoc(element, true);
        element.innerHTML = value;
      },
      empty: jqLiteEmpty
    }, function(fn, name) {
      JQLite.prototype[name] = function(arg1, arg2) {
        var i,
            key;
        var nodeCount = this.length;
        if (fn !== jqLiteEmpty && (isUndefined((fn.length == 2 && (fn !== jqLiteHasClass && fn !== jqLiteController)) ? arg1 : arg2))) {
          if (isObject(arg1)) {
            for (i = 0; i < nodeCount; i++) {
              if (fn === jqLiteData) {
                fn(this[i], arg1);
              } else {
                for (key in arg1) {
                  fn(this[i], key, arg1[key]);
                }
              }
            }
            return this;
          } else {
            var value = fn.$dv;
            var jj = (isUndefined(value)) ? Math.min(nodeCount, 1) : nodeCount;
            for (var j = 0; j < jj; j++) {
              var nodeValue = fn(this[j], arg1, arg2);
              value = value ? value + nodeValue : nodeValue;
            }
            return value;
          }
        } else {
          for (i = 0; i < nodeCount; i++) {
            fn(this[i], arg1, arg2);
          }
          return this;
        }
      };
    });
    function createEventHandler(element, events) {
      var eventHandler = function(event, type) {
        event.isDefaultPrevented = function() {
          return event.defaultPrevented;
        };
        var eventFns = events[type || event.type];
        var eventFnsLength = eventFns ? eventFns.length : 0;
        if (!eventFnsLength)
          return;
        if (isUndefined(event.immediatePropagationStopped)) {
          var originalStopImmediatePropagation = event.stopImmediatePropagation;
          event.stopImmediatePropagation = function() {
            event.immediatePropagationStopped = true;
            if (event.stopPropagation) {
              event.stopPropagation();
            }
            if (originalStopImmediatePropagation) {
              originalStopImmediatePropagation.call(event);
            }
          };
        }
        event.isImmediatePropagationStopped = function() {
          return event.immediatePropagationStopped === true;
        };
        if ((eventFnsLength > 1)) {
          eventFns = shallowCopy(eventFns);
        }
        for (var i = 0; i < eventFnsLength; i++) {
          if (!event.isImmediatePropagationStopped()) {
            eventFns[i].call(element, event);
          }
        }
      };
      eventHandler.elem = element;
      return eventHandler;
    }
    forEach({
      removeData: jqLiteRemoveData,
      on: function jqLiteOn(element, type, fn, unsupported) {
        if (isDefined(unsupported))
          throw jqLiteMinErr('onargs', 'jqLite#on() does not support the `selector` or `eventData` parameters');
        if (!jqLiteAcceptsData(element)) {
          return;
        }
        var expandoStore = jqLiteExpandoStore(element, true);
        var events = expandoStore.events;
        var handle = expandoStore.handle;
        if (!handle) {
          handle = expandoStore.handle = createEventHandler(element, events);
        }
        var types = type.indexOf(' ') >= 0 ? type.split(' ') : [type];
        var i = types.length;
        while (i--) {
          type = types[i];
          var eventFns = events[type];
          if (!eventFns) {
            events[type] = [];
            if (type === 'mouseenter' || type === 'mouseleave') {
              jqLiteOn(element, MOUSE_EVENT_MAP[type], function(event) {
                var target = this,
                    related = event.relatedTarget;
                if (!related || (related !== target && !target.contains(related))) {
                  handle(event, type);
                }
              });
            } else {
              if (type !== '$destroy') {
                addEventListenerFn(element, type, handle);
              }
            }
            eventFns = events[type];
          }
          eventFns.push(fn);
        }
      },
      off: jqLiteOff,
      one: function(element, type, fn) {
        element = jqLite(element);
        element.on(type, function onFn() {
          element.off(type, fn);
          element.off(type, onFn);
        });
        element.on(type, fn);
      },
      replaceWith: function(element, replaceNode) {
        var index,
            parent = element.parentNode;
        jqLiteDealoc(element);
        forEach(new JQLite(replaceNode), function(node) {
          if (index) {
            parent.insertBefore(node, index.nextSibling);
          } else {
            parent.replaceChild(node, element);
          }
          index = node;
        });
      },
      children: function(element) {
        var children = [];
        forEach(element.childNodes, function(element) {
          if (element.nodeType === NODE_TYPE_ELEMENT) {
            children.push(element);
          }
        });
        return children;
      },
      contents: function(element) {
        return element.contentDocument || element.childNodes || [];
      },
      append: function(element, node) {
        var nodeType = element.nodeType;
        if (nodeType !== NODE_TYPE_ELEMENT && nodeType !== NODE_TYPE_DOCUMENT_FRAGMENT)
          return;
        node = new JQLite(node);
        for (var i = 0,
            ii = node.length; i < ii; i++) {
          var child = node[i];
          element.appendChild(child);
        }
      },
      prepend: function(element, node) {
        if (element.nodeType === NODE_TYPE_ELEMENT) {
          var index = element.firstChild;
          forEach(new JQLite(node), function(child) {
            element.insertBefore(child, index);
          });
        }
      },
      wrap: function(element, wrapNode) {
        wrapNode = jqLite(wrapNode).eq(0).clone()[0];
        var parent = element.parentNode;
        if (parent) {
          parent.replaceChild(wrapNode, element);
        }
        wrapNode.appendChild(element);
      },
      remove: jqLiteRemove,
      detach: function(element) {
        jqLiteRemove(element, true);
      },
      after: function(element, newElement) {
        var index = element,
            parent = element.parentNode;
        newElement = new JQLite(newElement);
        for (var i = 0,
            ii = newElement.length; i < ii; i++) {
          var node = newElement[i];
          parent.insertBefore(node, index.nextSibling);
          index = node;
        }
      },
      addClass: jqLiteAddClass,
      removeClass: jqLiteRemoveClass,
      toggleClass: function(element, selector, condition) {
        if (selector) {
          forEach(selector.split(' '), function(className) {
            var classCondition = condition;
            if (isUndefined(classCondition)) {
              classCondition = !jqLiteHasClass(element, className);
            }
            (classCondition ? jqLiteAddClass : jqLiteRemoveClass)(element, className);
          });
        }
      },
      parent: function(element) {
        var parent = element.parentNode;
        return parent && parent.nodeType !== NODE_TYPE_DOCUMENT_FRAGMENT ? parent : null;
      },
      next: function(element) {
        return element.nextElementSibling;
      },
      find: function(element, selector) {
        if (element.getElementsByTagName) {
          return element.getElementsByTagName(selector);
        } else {
          return [];
        }
      },
      clone: jqLiteClone,
      triggerHandler: function(element, event, extraParameters) {
        var dummyEvent,
            eventFnsCopy,
            handlerArgs;
        var eventName = event.type || event;
        var expandoStore = jqLiteExpandoStore(element);
        var events = expandoStore && expandoStore.events;
        var eventFns = events && events[eventName];
        if (eventFns) {
          dummyEvent = {
            preventDefault: function() {
              this.defaultPrevented = true;
            },
            isDefaultPrevented: function() {
              return this.defaultPrevented === true;
            },
            stopImmediatePropagation: function() {
              this.immediatePropagationStopped = true;
            },
            isImmediatePropagationStopped: function() {
              return this.immediatePropagationStopped === true;
            },
            stopPropagation: noop,
            type: eventName,
            target: element
          };
          if (event.type) {
            dummyEvent = extend(dummyEvent, event);
          }
          eventFnsCopy = shallowCopy(eventFns);
          handlerArgs = extraParameters ? [dummyEvent].concat(extraParameters) : [dummyEvent];
          forEach(eventFnsCopy, function(fn) {
            if (!dummyEvent.isImmediatePropagationStopped()) {
              fn.apply(element, handlerArgs);
            }
          });
        }
      }
    }, function(fn, name) {
      JQLite.prototype[name] = function(arg1, arg2, arg3) {
        var value;
        for (var i = 0,
            ii = this.length; i < ii; i++) {
          if (isUndefined(value)) {
            value = fn(this[i], arg1, arg2, arg3);
            if (isDefined(value)) {
              value = jqLite(value);
            }
          } else {
            jqLiteAddNodes(value, fn(this[i], arg1, arg2, arg3));
          }
        }
        return isDefined(value) ? value : this;
      };
      JQLite.prototype.bind = JQLite.prototype.on;
      JQLite.prototype.unbind = JQLite.prototype.off;
    });
    function $$jqLiteProvider() {
      this.$get = function $$jqLite() {
        return extend(JQLite, {
          hasClass: function(node, classes) {
            if (node.attr)
              node = node[0];
            return jqLiteHasClass(node, classes);
          },
          addClass: function(node, classes) {
            if (node.attr)
              node = node[0];
            return jqLiteAddClass(node, classes);
          },
          removeClass: function(node, classes) {
            if (node.attr)
              node = node[0];
            return jqLiteRemoveClass(node, classes);
          }
        });
      };
    }
    function hashKey(obj, nextUidFn) {
      var key = obj && obj.$$hashKey;
      if (key) {
        if (typeof key === 'function') {
          key = obj.$$hashKey();
        }
        return key;
      }
      var objType = typeof obj;
      if (objType == 'function' || (objType == 'object' && obj !== null)) {
        key = obj.$$hashKey = objType + ':' + (nextUidFn || nextUid)();
      } else {
        key = objType + ':' + obj;
      }
      return key;
    }
    function HashMap(array, isolatedUid) {
      if (isolatedUid) {
        var uid = 0;
        this.nextUid = function() {
          return ++uid;
        };
      }
      forEach(array, this.put, this);
    }
    HashMap.prototype = {
      put: function(key, value) {
        this[hashKey(key, this.nextUid)] = value;
      },
      get: function(key) {
        return this[hashKey(key, this.nextUid)];
      },
      remove: function(key) {
        var value = this[key = hashKey(key, this.nextUid)];
        delete this[key];
        return value;
      }
    };
    var $$HashMapProvider = [function() {
      this.$get = [function() {
        return HashMap;
      }];
    }];
    var FN_ARGS = /^[^\(]*\(\s*([^\)]*)\)/m;
    var FN_ARG_SPLIT = /,/;
    var FN_ARG = /^\s*(_?)(\S+?)\1\s*$/;
    var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
    var $injectorMinErr = minErr('$injector');
    function anonFn(fn) {
      var fnText = fn.toString().replace(STRIP_COMMENTS, ''),
          args = fnText.match(FN_ARGS);
      if (args) {
        return 'function(' + (args[1] || '').replace(/[\s\r\n]+/, ' ') + ')';
      }
      return 'fn';
    }
    function annotate(fn, strictDi, name) {
      var $inject,
          fnText,
          argDecl,
          last;
      if (typeof fn === 'function') {
        if (!($inject = fn.$inject)) {
          $inject = [];
          if (fn.length) {
            if (strictDi) {
              if (!isString(name) || !name) {
                name = fn.name || anonFn(fn);
              }
              throw $injectorMinErr('strictdi', '{0} is not using explicit annotation and cannot be invoked in strict mode', name);
            }
            fnText = fn.toString().replace(STRIP_COMMENTS, '');
            argDecl = fnText.match(FN_ARGS);
            forEach(argDecl[1].split(FN_ARG_SPLIT), function(arg) {
              arg.replace(FN_ARG, function(all, underscore, name) {
                $inject.push(name);
              });
            });
          }
          fn.$inject = $inject;
        }
      } else if (isArray(fn)) {
        last = fn.length - 1;
        assertArgFn(fn[last], 'fn');
        $inject = fn.slice(0, last);
      } else {
        assertArgFn(fn, 'fn', true);
      }
      return $inject;
    }
    function createInjector(modulesToLoad, strictDi) {
      strictDi = (strictDi === true);
      var INSTANTIATING = {},
          providerSuffix = 'Provider',
          path = [],
          loadedModules = new HashMap([], true),
          providerCache = {$provide: {
              provider: supportObject(provider),
              factory: supportObject(factory),
              service: supportObject(service),
              value: supportObject(value),
              constant: supportObject(constant),
              decorator: decorator
            }},
          providerInjector = (providerCache.$injector = createInternalInjector(providerCache, function(serviceName, caller) {
            if (angular.isString(caller)) {
              path.push(caller);
            }
            throw $injectorMinErr('unpr', "Unknown provider: {0}", path.join(' <- '));
          })),
          instanceCache = {},
          instanceInjector = (instanceCache.$injector = createInternalInjector(instanceCache, function(serviceName, caller) {
            var provider = providerInjector.get(serviceName + providerSuffix, caller);
            return instanceInjector.invoke(provider.$get, provider, undefined, serviceName);
          }));
      forEach(loadModules(modulesToLoad), function(fn) {
        if (fn)
          instanceInjector.invoke(fn);
      });
      return instanceInjector;
      function supportObject(delegate) {
        return function(key, value) {
          if (isObject(key)) {
            forEach(key, reverseParams(delegate));
          } else {
            return delegate(key, value);
          }
        };
      }
      function provider(name, provider_) {
        assertNotHasOwnProperty(name, 'service');
        if (isFunction(provider_) || isArray(provider_)) {
          provider_ = providerInjector.instantiate(provider_);
        }
        if (!provider_.$get) {
          throw $injectorMinErr('pget', "Provider '{0}' must define $get factory method.", name);
        }
        return providerCache[name + providerSuffix] = provider_;
      }
      function enforceReturnValue(name, factory) {
        return function enforcedReturnValue() {
          var result = instanceInjector.invoke(factory, this);
          if (isUndefined(result)) {
            throw $injectorMinErr('undef', "Provider '{0}' must return a value from $get factory method.", name);
          }
          return result;
        };
      }
      function factory(name, factoryFn, enforce) {
        return provider(name, {$get: enforce !== false ? enforceReturnValue(name, factoryFn) : factoryFn});
      }
      function service(name, constructor) {
        return factory(name, ['$injector', function($injector) {
          return $injector.instantiate(constructor);
        }]);
      }
      function value(name, val) {
        return factory(name, valueFn(val), false);
      }
      function constant(name, value) {
        assertNotHasOwnProperty(name, 'constant');
        providerCache[name] = value;
        instanceCache[name] = value;
      }
      function decorator(serviceName, decorFn) {
        var origProvider = providerInjector.get(serviceName + providerSuffix),
            orig$get = origProvider.$get;
        origProvider.$get = function() {
          var origInstance = instanceInjector.invoke(orig$get, origProvider);
          return instanceInjector.invoke(decorFn, null, {$delegate: origInstance});
        };
      }
      function loadModules(modulesToLoad) {
        assertArg(isUndefined(modulesToLoad) || isArray(modulesToLoad), 'modulesToLoad', 'not an array');
        var runBlocks = [],
            moduleFn;
        forEach(modulesToLoad, function(module) {
          if (loadedModules.get(module))
            return;
          loadedModules.put(module, true);
          function runInvokeQueue(queue) {
            var i,
                ii;
            for (i = 0, ii = queue.length; i < ii; i++) {
              var invokeArgs = queue[i],
                  provider = providerInjector.get(invokeArgs[0]);
              provider[invokeArgs[1]].apply(provider, invokeArgs[2]);
            }
          }
          try {
            if (isString(module)) {
              moduleFn = angularModule(module);
              runBlocks = runBlocks.concat(loadModules(moduleFn.requires)).concat(moduleFn._runBlocks);
              runInvokeQueue(moduleFn._invokeQueue);
              runInvokeQueue(moduleFn._configBlocks);
            } else if (isFunction(module)) {
              runBlocks.push(providerInjector.invoke(module));
            } else if (isArray(module)) {
              runBlocks.push(providerInjector.invoke(module));
            } else {
              assertArgFn(module, 'module');
            }
          } catch (e) {
            if (isArray(module)) {
              module = module[module.length - 1];
            }
            if (e.message && e.stack && e.stack.indexOf(e.message) == -1) {
              e = e.message + '\n' + e.stack;
            }
            throw $injectorMinErr('modulerr', "Failed to instantiate module {0} due to:\n{1}", module, e.stack || e.message || e);
          }
        });
        return runBlocks;
      }
      function createInternalInjector(cache, factory) {
        function getService(serviceName, caller) {
          if (cache.hasOwnProperty(serviceName)) {
            if (cache[serviceName] === INSTANTIATING) {
              throw $injectorMinErr('cdep', 'Circular dependency found: {0}', serviceName + ' <- ' + path.join(' <- '));
            }
            return cache[serviceName];
          } else {
            try {
              path.unshift(serviceName);
              cache[serviceName] = INSTANTIATING;
              return cache[serviceName] = factory(serviceName, caller);
            } catch (err) {
              if (cache[serviceName] === INSTANTIATING) {
                delete cache[serviceName];
              }
              throw err;
            } finally {
              path.shift();
            }
          }
        }
        function invoke(fn, self, locals, serviceName) {
          if (typeof locals === 'string') {
            serviceName = locals;
            locals = null;
          }
          var args = [],
              $inject = createInjector.$$annotate(fn, strictDi, serviceName),
              length,
              i,
              key;
          for (i = 0, length = $inject.length; i < length; i++) {
            key = $inject[i];
            if (typeof key !== 'string') {
              throw $injectorMinErr('itkn', 'Incorrect injection token! Expected service name as string, got {0}', key);
            }
            args.push(locals && locals.hasOwnProperty(key) ? locals[key] : getService(key, serviceName));
          }
          if (isArray(fn)) {
            fn = fn[length];
          }
          return fn.apply(self, args);
        }
        function instantiate(Type, locals, serviceName) {
          var instance = Object.create((isArray(Type) ? Type[Type.length - 1] : Type).prototype || null);
          var returnedValue = invoke(Type, instance, locals, serviceName);
          return isObject(returnedValue) || isFunction(returnedValue) ? returnedValue : instance;
        }
        return {
          invoke: invoke,
          instantiate: instantiate,
          get: getService,
          annotate: createInjector.$$annotate,
          has: function(name) {
            return providerCache.hasOwnProperty(name + providerSuffix) || cache.hasOwnProperty(name);
          }
        };
      }
    }
    createInjector.$$annotate = annotate;
    function $AnchorScrollProvider() {
      var autoScrollingEnabled = true;
      this.disableAutoScrolling = function() {
        autoScrollingEnabled = false;
      };
      this.$get = ['$window', '$location', '$rootScope', function($window, $location, $rootScope) {
        var document = $window.document;
        function getFirstAnchor(list) {
          var result = null;
          Array.prototype.some.call(list, function(element) {
            if (nodeName_(element) === 'a') {
              result = element;
              return true;
            }
          });
          return result;
        }
        function getYOffset() {
          var offset = scroll.yOffset;
          if (isFunction(offset)) {
            offset = offset();
          } else if (isElement(offset)) {
            var elem = offset[0];
            var style = $window.getComputedStyle(elem);
            if (style.position !== 'fixed') {
              offset = 0;
            } else {
              offset = elem.getBoundingClientRect().bottom;
            }
          } else if (!isNumber(offset)) {
            offset = 0;
          }
          return offset;
        }
        function scrollTo(elem) {
          if (elem) {
            elem.scrollIntoView();
            var offset = getYOffset();
            if (offset) {
              var elemTop = elem.getBoundingClientRect().top;
              $window.scrollBy(0, elemTop - offset);
            }
          } else {
            $window.scrollTo(0, 0);
          }
        }
        function scroll(hash) {
          hash = isString(hash) ? hash : $location.hash();
          var elm;
          if (!hash)
            scrollTo(null);
          else if ((elm = document.getElementById(hash)))
            scrollTo(elm);
          else if ((elm = getFirstAnchor(document.getElementsByName(hash))))
            scrollTo(elm);
          else if (hash === 'top')
            scrollTo(null);
        }
        if (autoScrollingEnabled) {
          $rootScope.$watch(function autoScrollWatch() {
            return $location.hash();
          }, function autoScrollWatchAction(newVal, oldVal) {
            if (newVal === oldVal && newVal === '')
              return;
            jqLiteDocumentLoaded(function() {
              $rootScope.$evalAsync(scroll);
            });
          });
        }
        return scroll;
      }];
    }
    var $animateMinErr = minErr('$animate');
    var ELEMENT_NODE = 1;
    var NG_ANIMATE_CLASSNAME = 'ng-animate';
    function mergeClasses(a, b) {
      if (!a && !b)
        return '';
      if (!a)
        return b;
      if (!b)
        return a;
      if (isArray(a))
        a = a.join(' ');
      if (isArray(b))
        b = b.join(' ');
      return a + ' ' + b;
    }
    function extractElementNode(element) {
      for (var i = 0; i < element.length; i++) {
        var elm = element[i];
        if (elm.nodeType === ELEMENT_NODE) {
          return elm;
        }
      }
    }
    function splitClasses(classes) {
      if (isString(classes)) {
        classes = classes.split(' ');
      }
      var obj = createMap();
      forEach(classes, function(klass) {
        if (klass.length) {
          obj[klass] = true;
        }
      });
      return obj;
    }
    function prepareAnimateOptions(options) {
      return isObject(options) ? options : {};
    }
    var $$CoreAnimateRunnerProvider = function() {
      this.$get = ['$q', '$$rAF', function($q, $$rAF) {
        function AnimateRunner() {}
        AnimateRunner.all = noop;
        AnimateRunner.chain = noop;
        AnimateRunner.prototype = {
          end: noop,
          cancel: noop,
          resume: noop,
          pause: noop,
          complete: noop,
          then: function(pass, fail) {
            return $q(function(resolve) {
              $$rAF(function() {
                resolve();
              });
            }).then(pass, fail);
          }
        };
        return AnimateRunner;
      }];
    };
    var $$CoreAnimateQueueProvider = function() {
      var postDigestQueue = new HashMap();
      var postDigestElements = [];
      this.$get = ['$$AnimateRunner', '$rootScope', function($$AnimateRunner, $rootScope) {
        return {
          enabled: noop,
          on: noop,
          off: noop,
          pin: noop,
          push: function(element, event, options, domOperation) {
            domOperation && domOperation();
            options = options || {};
            options.from && element.css(options.from);
            options.to && element.css(options.to);
            if (options.addClass || options.removeClass) {
              addRemoveClassesPostDigest(element, options.addClass, options.removeClass);
            }
            return new $$AnimateRunner();
          }
        };
        function updateData(data, classes, value) {
          var changed = false;
          if (classes) {
            classes = isString(classes) ? classes.split(' ') : isArray(classes) ? classes : [];
            forEach(classes, function(className) {
              if (className) {
                changed = true;
                data[className] = value;
              }
            });
          }
          return changed;
        }
        function handleCSSClassChanges() {
          forEach(postDigestElements, function(element) {
            var data = postDigestQueue.get(element);
            if (data) {
              var existing = splitClasses(element.attr('class'));
              var toAdd = '';
              var toRemove = '';
              forEach(data, function(status, className) {
                var hasClass = !!existing[className];
                if (status !== hasClass) {
                  if (status) {
                    toAdd += (toAdd.length ? ' ' : '') + className;
                  } else {
                    toRemove += (toRemove.length ? ' ' : '') + className;
                  }
                }
              });
              forEach(element, function(elm) {
                toAdd && jqLiteAddClass(elm, toAdd);
                toRemove && jqLiteRemoveClass(elm, toRemove);
              });
              postDigestQueue.remove(element);
            }
          });
          postDigestElements.length = 0;
        }
        function addRemoveClassesPostDigest(element, add, remove) {
          var data = postDigestQueue.get(element) || {};
          var classesAdded = updateData(data, add, true);
          var classesRemoved = updateData(data, remove, false);
          if (classesAdded || classesRemoved) {
            postDigestQueue.put(element, data);
            postDigestElements.push(element);
            if (postDigestElements.length === 1) {
              $rootScope.$$postDigest(handleCSSClassChanges);
            }
          }
        }
      }];
    };
    var $AnimateProvider = ['$provide', function($provide) {
      var provider = this;
      this.$$registeredAnimations = Object.create(null);
      this.register = function(name, factory) {
        if (name && name.charAt(0) !== '.') {
          throw $animateMinErr('notcsel', "Expecting class selector starting with '.' got '{0}'.", name);
        }
        var key = name + '-animation';
        provider.$$registeredAnimations[name.substr(1)] = key;
        $provide.factory(key, factory);
      };
      this.classNameFilter = function(expression) {
        if (arguments.length === 1) {
          this.$$classNameFilter = (expression instanceof RegExp) ? expression : null;
          if (this.$$classNameFilter) {
            var reservedRegex = new RegExp("(\\s+|\\/)" + NG_ANIMATE_CLASSNAME + "(\\s+|\\/)");
            if (reservedRegex.test(this.$$classNameFilter.toString())) {
              throw $animateMinErr('nongcls', '$animateProvider.classNameFilter(regex) prohibits accepting a regex value which matches/contains the "{0}" CSS class.', NG_ANIMATE_CLASSNAME);
            }
          }
        }
        return this.$$classNameFilter;
      };
      this.$get = ['$$animateQueue', function($$animateQueue) {
        function domInsert(element, parentElement, afterElement) {
          if (afterElement) {
            var afterNode = extractElementNode(afterElement);
            if (afterNode && !afterNode.parentNode && !afterNode.previousElementSibling) {
              afterElement = null;
            }
          }
          afterElement ? afterElement.after(element) : parentElement.prepend(element);
        }
        return {
          on: $$animateQueue.on,
          off: $$animateQueue.off,
          pin: $$animateQueue.pin,
          enabled: $$animateQueue.enabled,
          cancel: function(runner) {
            runner.end && runner.end();
          },
          enter: function(element, parent, after, options) {
            parent = parent && jqLite(parent);
            after = after && jqLite(after);
            parent = parent || after.parent();
            domInsert(element, parent, after);
            return $$animateQueue.push(element, 'enter', prepareAnimateOptions(options));
          },
          move: function(element, parent, after, options) {
            parent = parent && jqLite(parent);
            after = after && jqLite(after);
            parent = parent || after.parent();
            domInsert(element, parent, after);
            return $$animateQueue.push(element, 'move', prepareAnimateOptions(options));
          },
          leave: function(element, options) {
            return $$animateQueue.push(element, 'leave', prepareAnimateOptions(options), function() {
              element.remove();
            });
          },
          addClass: function(element, className, options) {
            options = prepareAnimateOptions(options);
            options.addClass = mergeClasses(options.addclass, className);
            return $$animateQueue.push(element, 'addClass', options);
          },
          removeClass: function(element, className, options) {
            options = prepareAnimateOptions(options);
            options.removeClass = mergeClasses(options.removeClass, className);
            return $$animateQueue.push(element, 'removeClass', options);
          },
          setClass: function(element, add, remove, options) {
            options = prepareAnimateOptions(options);
            options.addClass = mergeClasses(options.addClass, add);
            options.removeClass = mergeClasses(options.removeClass, remove);
            return $$animateQueue.push(element, 'setClass', options);
          },
          animate: function(element, from, to, className, options) {
            options = prepareAnimateOptions(options);
            options.from = options.from ? extend(options.from, from) : from;
            options.to = options.to ? extend(options.to, to) : to;
            className = className || 'ng-inline-animate';
            options.tempClasses = mergeClasses(options.tempClasses, className);
            return $$animateQueue.push(element, 'animate', options);
          }
        };
      }];
    }];
    var $CoreAnimateCssProvider = function() {
      this.$get = ['$$rAF', '$q', function($$rAF, $q) {
        var RAFPromise = function() {};
        RAFPromise.prototype = {
          done: function(cancel) {
            this.defer && this.defer[cancel === true ? 'reject' : 'resolve']();
          },
          end: function() {
            this.done();
          },
          cancel: function() {
            this.done(true);
          },
          getPromise: function() {
            if (!this.defer) {
              this.defer = $q.defer();
            }
            return this.defer.promise;
          },
          then: function(f1, f2) {
            return this.getPromise().then(f1, f2);
          },
          'catch': function(f1) {
            return this.getPromise()['catch'](f1);
          },
          'finally': function(f1) {
            return this.getPromise()['finally'](f1);
          }
        };
        return function(element, options) {
          if (options.cleanupStyles) {
            options.from = options.to = null;
          }
          if (options.from) {
            element.css(options.from);
            options.from = null;
          }
          var closed,
              runner = new RAFPromise();
          return {
            start: run,
            end: run
          };
          function run() {
            $$rAF(function() {
              close();
              if (!closed) {
                runner.done();
              }
              closed = true;
            });
            return runner;
          }
          function close() {
            if (options.addClass) {
              element.addClass(options.addClass);
              options.addClass = null;
            }
            if (options.removeClass) {
              element.removeClass(options.removeClass);
              options.removeClass = null;
            }
            if (options.to) {
              element.css(options.to);
              options.to = null;
            }
          }
        };
      }];
    };
    function Browser(window, document, $log, $sniffer) {
      var self = this,
          rawDocument = document[0],
          location = window.location,
          history = window.history,
          setTimeout = window.setTimeout,
          clearTimeout = window.clearTimeout,
          pendingDeferIds = {};
      self.isMock = false;
      var outstandingRequestCount = 0;
      var outstandingRequestCallbacks = [];
      self.$$completeOutstandingRequest = completeOutstandingRequest;
      self.$$incOutstandingRequestCount = function() {
        outstandingRequestCount++;
      };
      function completeOutstandingRequest(fn) {
        try {
          fn.apply(null, sliceArgs(arguments, 1));
        } finally {
          outstandingRequestCount--;
          if (outstandingRequestCount === 0) {
            while (outstandingRequestCallbacks.length) {
              try {
                outstandingRequestCallbacks.pop()();
              } catch (e) {
                $log.error(e);
              }
            }
          }
        }
      }
      function getHash(url) {
        var index = url.indexOf('#');
        return index === -1 ? '' : url.substr(index);
      }
      self.notifyWhenNoOutstandingRequests = function(callback) {
        if (outstandingRequestCount === 0) {
          callback();
        } else {
          outstandingRequestCallbacks.push(callback);
        }
      };
      var cachedState,
          lastHistoryState,
          lastBrowserUrl = location.href,
          baseElement = document.find('base'),
          pendingLocation = null;
      cacheState();
      lastHistoryState = cachedState;
      self.url = function(url, replace, state) {
        if (isUndefined(state)) {
          state = null;
        }
        if (location !== window.location)
          location = window.location;
        if (history !== window.history)
          history = window.history;
        if (url) {
          var sameState = lastHistoryState === state;
          if (lastBrowserUrl === url && (!$sniffer.history || sameState)) {
            return self;
          }
          var sameBase = lastBrowserUrl && stripHash(lastBrowserUrl) === stripHash(url);
          lastBrowserUrl = url;
          lastHistoryState = state;
          if ($sniffer.history && (!sameBase || !sameState)) {
            history[replace ? 'replaceState' : 'pushState'](state, '', url);
            cacheState();
            lastHistoryState = cachedState;
          } else {
            if (!sameBase || pendingLocation) {
              pendingLocation = url;
            }
            if (replace) {
              location.replace(url);
            } else if (!sameBase) {
              location.href = url;
            } else {
              location.hash = getHash(url);
            }
            if (location.href !== url) {
              pendingLocation = url;
            }
          }
          return self;
        } else {
          return pendingLocation || location.href.replace(/%27/g, "'");
        }
      };
      self.state = function() {
        return cachedState;
      };
      var urlChangeListeners = [],
          urlChangeInit = false;
      function cacheStateAndFireUrlChange() {
        pendingLocation = null;
        cacheState();
        fireUrlChange();
      }
      function getCurrentState() {
        try {
          return history.state;
        } catch (e) {}
      }
      var lastCachedState = null;
      function cacheState() {
        cachedState = getCurrentState();
        cachedState = isUndefined(cachedState) ? null : cachedState;
        if (equals(cachedState, lastCachedState)) {
          cachedState = lastCachedState;
        }
        lastCachedState = cachedState;
      }
      function fireUrlChange() {
        if (lastBrowserUrl === self.url() && lastHistoryState === cachedState) {
          return;
        }
        lastBrowserUrl = self.url();
        lastHistoryState = cachedState;
        forEach(urlChangeListeners, function(listener) {
          listener(self.url(), cachedState);
        });
      }
      self.onUrlChange = function(callback) {
        if (!urlChangeInit) {
          if ($sniffer.history)
            jqLite(window).on('popstate', cacheStateAndFireUrlChange);
          jqLite(window).on('hashchange', cacheStateAndFireUrlChange);
          urlChangeInit = true;
        }
        urlChangeListeners.push(callback);
        return callback;
      };
      self.$$applicationDestroyed = function() {
        jqLite(window).off('hashchange popstate', cacheStateAndFireUrlChange);
      };
      self.$$checkUrlChange = fireUrlChange;
      self.baseHref = function() {
        var href = baseElement.attr('href');
        return href ? href.replace(/^(https?\:)?\/\/[^\/]*/, '') : '';
      };
      self.defer = function(fn, delay) {
        var timeoutId;
        outstandingRequestCount++;
        timeoutId = setTimeout(function() {
          delete pendingDeferIds[timeoutId];
          completeOutstandingRequest(fn);
        }, delay || 0);
        pendingDeferIds[timeoutId] = true;
        return timeoutId;
      };
      self.defer.cancel = function(deferId) {
        if (pendingDeferIds[deferId]) {
          delete pendingDeferIds[deferId];
          clearTimeout(deferId);
          completeOutstandingRequest(noop);
          return true;
        }
        return false;
      };
    }
    function $BrowserProvider() {
      this.$get = ['$window', '$log', '$sniffer', '$document', function($window, $log, $sniffer, $document) {
        return new Browser($window, $document, $log, $sniffer);
      }];
    }
    function $CacheFactoryProvider() {
      this.$get = function() {
        var caches = {};
        function cacheFactory(cacheId, options) {
          if (cacheId in caches) {
            throw minErr('$cacheFactory')('iid', "CacheId '{0}' is already taken!", cacheId);
          }
          var size = 0,
              stats = extend({}, options, {id: cacheId}),
              data = {},
              capacity = (options && options.capacity) || Number.MAX_VALUE,
              lruHash = {},
              freshEnd = null,
              staleEnd = null;
          return caches[cacheId] = {
            put: function(key, value) {
              if (isUndefined(value))
                return;
              if (capacity < Number.MAX_VALUE) {
                var lruEntry = lruHash[key] || (lruHash[key] = {key: key});
                refresh(lruEntry);
              }
              if (!(key in data))
                size++;
              data[key] = value;
              if (size > capacity) {
                this.remove(staleEnd.key);
              }
              return value;
            },
            get: function(key) {
              if (capacity < Number.MAX_VALUE) {
                var lruEntry = lruHash[key];
                if (!lruEntry)
                  return;
                refresh(lruEntry);
              }
              return data[key];
            },
            remove: function(key) {
              if (capacity < Number.MAX_VALUE) {
                var lruEntry = lruHash[key];
                if (!lruEntry)
                  return;
                if (lruEntry == freshEnd)
                  freshEnd = lruEntry.p;
                if (lruEntry == staleEnd)
                  staleEnd = lruEntry.n;
                link(lruEntry.n, lruEntry.p);
                delete lruHash[key];
              }
              delete data[key];
              size--;
            },
            removeAll: function() {
              data = {};
              size = 0;
              lruHash = {};
              freshEnd = staleEnd = null;
            },
            destroy: function() {
              data = null;
              stats = null;
              lruHash = null;
              delete caches[cacheId];
            },
            info: function() {
              return extend({}, stats, {size: size});
            }
          };
          function refresh(entry) {
            if (entry != freshEnd) {
              if (!staleEnd) {
                staleEnd = entry;
              } else if (staleEnd == entry) {
                staleEnd = entry.n;
              }
              link(entry.n, entry.p);
              link(entry, freshEnd);
              freshEnd = entry;
              freshEnd.n = null;
            }
          }
          function link(nextEntry, prevEntry) {
            if (nextEntry != prevEntry) {
              if (nextEntry)
                nextEntry.p = prevEntry;
              if (prevEntry)
                prevEntry.n = nextEntry;
            }
          }
        }
        cacheFactory.info = function() {
          var info = {};
          forEach(caches, function(cache, cacheId) {
            info[cacheId] = cache.info();
          });
          return info;
        };
        cacheFactory.get = function(cacheId) {
          return caches[cacheId];
        };
        return cacheFactory;
      };
    }
    function $TemplateCacheProvider() {
      this.$get = ['$cacheFactory', function($cacheFactory) {
        return $cacheFactory('templates');
      }];
    }
    var $compileMinErr = minErr('$compile');
    $CompileProvider.$inject = ['$provide', '$$sanitizeUriProvider'];
    function $CompileProvider($provide, $$sanitizeUriProvider) {
      var hasDirectives = {},
          Suffix = 'Directive',
          COMMENT_DIRECTIVE_REGEXP = /^\s*directive\:\s*([\w\-]+)\s+(.*)$/,
          CLASS_DIRECTIVE_REGEXP = /(([\w\-]+)(?:\:([^;]+))?;?)/,
          ALL_OR_NOTHING_ATTRS = makeMap('ngSrc,ngSrcset,src,srcset'),
          REQUIRE_PREFIX_REGEXP = /^(?:(\^\^?)?(\?)?(\^\^?)?)?/;
      var EVENT_HANDLER_ATTR_REGEXP = /^(on[a-z]+|formaction)$/;
      function parseIsolateBindings(scope, directiveName, isController) {
        var LOCAL_REGEXP = /^\s*([@&]|=(\*?))(\??)\s*(\w*)\s*$/;
        var bindings = {};
        forEach(scope, function(definition, scopeName) {
          var match = definition.match(LOCAL_REGEXP);
          if (!match) {
            throw $compileMinErr('iscp', "Invalid {3} for directive '{0}'." + " Definition: {... {1}: '{2}' ...}", directiveName, scopeName, definition, (isController ? "controller bindings definition" : "isolate scope definition"));
          }
          bindings[scopeName] = {
            mode: match[1][0],
            collection: match[2] === '*',
            optional: match[3] === '?',
            attrName: match[4] || scopeName
          };
        });
        return bindings;
      }
      function parseDirectiveBindings(directive, directiveName) {
        var bindings = {
          isolateScope: null,
          bindToController: null
        };
        if (isObject(directive.scope)) {
          if (directive.bindToController === true) {
            bindings.bindToController = parseIsolateBindings(directive.scope, directiveName, true);
            bindings.isolateScope = {};
          } else {
            bindings.isolateScope = parseIsolateBindings(directive.scope, directiveName, false);
          }
        }
        if (isObject(directive.bindToController)) {
          bindings.bindToController = parseIsolateBindings(directive.bindToController, directiveName, true);
        }
        if (isObject(bindings.bindToController)) {
          var controller = directive.controller;
          var controllerAs = directive.controllerAs;
          if (!controller) {
            throw $compileMinErr('noctrl', "Cannot bind to controller without directive '{0}'s controller.", directiveName);
          } else if (!identifierForController(controller, controllerAs)) {
            throw $compileMinErr('noident', "Cannot bind to controller without identifier for directive '{0}'.", directiveName);
          }
        }
        return bindings;
      }
      function assertValidDirectiveName(name) {
        var letter = name.charAt(0);
        if (!letter || letter !== lowercase(letter)) {
          throw $compileMinErr('baddir', "Directive name '{0}' is invalid. The first character must be a lowercase letter", name);
        }
        if (name !== name.trim()) {
          throw $compileMinErr('baddir', "Directive name '{0}' is invalid. The name should not contain leading or trailing whitespaces", name);
        }
      }
      this.directive = function registerDirective(name, directiveFactory) {
        assertNotHasOwnProperty(name, 'directive');
        if (isString(name)) {
          assertValidDirectiveName(name);
          assertArg(directiveFactory, 'directiveFactory');
          if (!hasDirectives.hasOwnProperty(name)) {
            hasDirectives[name] = [];
            $provide.factory(name + Suffix, ['$injector', '$exceptionHandler', function($injector, $exceptionHandler) {
              var directives = [];
              forEach(hasDirectives[name], function(directiveFactory, index) {
                try {
                  var directive = $injector.invoke(directiveFactory);
                  if (isFunction(directive)) {
                    directive = {compile: valueFn(directive)};
                  } else if (!directive.compile && directive.link) {
                    directive.compile = valueFn(directive.link);
                  }
                  directive.priority = directive.priority || 0;
                  directive.index = index;
                  directive.name = directive.name || name;
                  directive.require = directive.require || (directive.controller && directive.name);
                  directive.restrict = directive.restrict || 'EA';
                  var bindings = directive.$$bindings = parseDirectiveBindings(directive, directive.name);
                  if (isObject(bindings.isolateScope)) {
                    directive.$$isolateBindings = bindings.isolateScope;
                  }
                  directive.$$moduleName = directiveFactory.$$moduleName;
                  directives.push(directive);
                } catch (e) {
                  $exceptionHandler(e);
                }
              });
              return directives;
            }]);
          }
          hasDirectives[name].push(directiveFactory);
        } else {
          forEach(name, reverseParams(registerDirective));
        }
        return this;
      };
      this.aHrefSanitizationWhitelist = function(regexp) {
        if (isDefined(regexp)) {
          $$sanitizeUriProvider.aHrefSanitizationWhitelist(regexp);
          return this;
        } else {
          return $$sanitizeUriProvider.aHrefSanitizationWhitelist();
        }
      };
      this.imgSrcSanitizationWhitelist = function(regexp) {
        if (isDefined(regexp)) {
          $$sanitizeUriProvider.imgSrcSanitizationWhitelist(regexp);
          return this;
        } else {
          return $$sanitizeUriProvider.imgSrcSanitizationWhitelist();
        }
      };
      var debugInfoEnabled = true;
      this.debugInfoEnabled = function(enabled) {
        if (isDefined(enabled)) {
          debugInfoEnabled = enabled;
          return this;
        }
        return debugInfoEnabled;
      };
      this.$get = ['$injector', '$interpolate', '$exceptionHandler', '$templateRequest', '$parse', '$controller', '$rootScope', '$document', '$sce', '$animate', '$$sanitizeUri', function($injector, $interpolate, $exceptionHandler, $templateRequest, $parse, $controller, $rootScope, $document, $sce, $animate, $$sanitizeUri) {
        var Attributes = function(element, attributesToCopy) {
          if (attributesToCopy) {
            var keys = Object.keys(attributesToCopy);
            var i,
                l,
                key;
            for (i = 0, l = keys.length; i < l; i++) {
              key = keys[i];
              this[key] = attributesToCopy[key];
            }
          } else {
            this.$attr = {};
          }
          this.$$element = element;
        };
        Attributes.prototype = {
          $normalize: directiveNormalize,
          $addClass: function(classVal) {
            if (classVal && classVal.length > 0) {
              $animate.addClass(this.$$element, classVal);
            }
          },
          $removeClass: function(classVal) {
            if (classVal && classVal.length > 0) {
              $animate.removeClass(this.$$element, classVal);
            }
          },
          $updateClass: function(newClasses, oldClasses) {
            var toAdd = tokenDifference(newClasses, oldClasses);
            if (toAdd && toAdd.length) {
              $animate.addClass(this.$$element, toAdd);
            }
            var toRemove = tokenDifference(oldClasses, newClasses);
            if (toRemove && toRemove.length) {
              $animate.removeClass(this.$$element, toRemove);
            }
          },
          $set: function(key, value, writeAttr, attrName) {
            var node = this.$$element[0],
                booleanKey = getBooleanAttrName(node, key),
                aliasedKey = getAliasedAttrName(key),
                observer = key,
                nodeName;
            if (booleanKey) {
              this.$$element.prop(key, value);
              attrName = booleanKey;
            } else if (aliasedKey) {
              this[aliasedKey] = value;
              observer = aliasedKey;
            }
            this[key] = value;
            if (attrName) {
              this.$attr[key] = attrName;
            } else {
              attrName = this.$attr[key];
              if (!attrName) {
                this.$attr[key] = attrName = snake_case(key, '-');
              }
            }
            nodeName = nodeName_(this.$$element);
            if ((nodeName === 'a' && key === 'href') || (nodeName === 'img' && key === 'src')) {
              this[key] = value = $$sanitizeUri(value, key === 'src');
            } else if (nodeName === 'img' && key === 'srcset') {
              var result = "";
              var trimmedSrcset = trim(value);
              var srcPattern = /(\s+\d+x\s*,|\s+\d+w\s*,|\s+,|,\s+)/;
              var pattern = /\s/.test(trimmedSrcset) ? srcPattern : /(,)/;
              var rawUris = trimmedSrcset.split(pattern);
              var nbrUrisWith2parts = Math.floor(rawUris.length / 2);
              for (var i = 0; i < nbrUrisWith2parts; i++) {
                var innerIdx = i * 2;
                result += $$sanitizeUri(trim(rawUris[innerIdx]), true);
                result += (" " + trim(rawUris[innerIdx + 1]));
              }
              var lastTuple = trim(rawUris[i * 2]).split(/\s/);
              result += $$sanitizeUri(trim(lastTuple[0]), true);
              if (lastTuple.length === 2) {
                result += (" " + trim(lastTuple[1]));
              }
              this[key] = value = result;
            }
            if (writeAttr !== false) {
              if (value === null || isUndefined(value)) {
                this.$$element.removeAttr(attrName);
              } else {
                this.$$element.attr(attrName, value);
              }
            }
            var $$observers = this.$$observers;
            $$observers && forEach($$observers[observer], function(fn) {
              try {
                fn(value);
              } catch (e) {
                $exceptionHandler(e);
              }
            });
          },
          $observe: function(key, fn) {
            var attrs = this,
                $$observers = (attrs.$$observers || (attrs.$$observers = createMap())),
                listeners = ($$observers[key] || ($$observers[key] = []));
            listeners.push(fn);
            $rootScope.$evalAsync(function() {
              if (!listeners.$$inter && attrs.hasOwnProperty(key) && !isUndefined(attrs[key])) {
                fn(attrs[key]);
              }
            });
            return function() {
              arrayRemove(listeners, fn);
            };
          }
        };
        function safeAddClass($element, className) {
          try {
            $element.addClass(className);
          } catch (e) {}
        }
        var startSymbol = $interpolate.startSymbol(),
            endSymbol = $interpolate.endSymbol(),
            denormalizeTemplate = (startSymbol == '{{' || endSymbol == '}}') ? identity : function denormalizeTemplate(template) {
              return template.replace(/\{\{/g, startSymbol).replace(/}}/g, endSymbol);
            },
            NG_ATTR_BINDING = /^ngAttr[A-Z]/;
        compile.$$addBindingInfo = debugInfoEnabled ? function $$addBindingInfo($element, binding) {
          var bindings = $element.data('$binding') || [];
          if (isArray(binding)) {
            bindings = bindings.concat(binding);
          } else {
            bindings.push(binding);
          }
          $element.data('$binding', bindings);
        } : noop;
        compile.$$addBindingClass = debugInfoEnabled ? function $$addBindingClass($element) {
          safeAddClass($element, 'ng-binding');
        } : noop;
        compile.$$addScopeInfo = debugInfoEnabled ? function $$addScopeInfo($element, scope, isolated, noTemplate) {
          var dataName = isolated ? (noTemplate ? '$isolateScopeNoTemplate' : '$isolateScope') : '$scope';
          $element.data(dataName, scope);
        } : noop;
        compile.$$addScopeClass = debugInfoEnabled ? function $$addScopeClass($element, isolated) {
          safeAddClass($element, isolated ? 'ng-isolate-scope' : 'ng-scope');
        } : noop;
        return compile;
        function compile($compileNodes, transcludeFn, maxPriority, ignoreDirective, previousCompileContext) {
          if (!($compileNodes instanceof jqLite)) {
            $compileNodes = jqLite($compileNodes);
          }
          forEach($compileNodes, function(node, index) {
            if (node.nodeType == NODE_TYPE_TEXT && node.nodeValue.match(/\S+/)) {
              $compileNodes[index] = jqLite(node).wrap('<span></span>').parent()[0];
            }
          });
          var compositeLinkFn = compileNodes($compileNodes, transcludeFn, $compileNodes, maxPriority, ignoreDirective, previousCompileContext);
          compile.$$addScopeClass($compileNodes);
          var namespace = null;
          return function publicLinkFn(scope, cloneConnectFn, options) {
            assertArg(scope, 'scope');
            options = options || {};
            var parentBoundTranscludeFn = options.parentBoundTranscludeFn,
                transcludeControllers = options.transcludeControllers,
                futureParentElement = options.futureParentElement;
            if (parentBoundTranscludeFn && parentBoundTranscludeFn.$$boundTransclude) {
              parentBoundTranscludeFn = parentBoundTranscludeFn.$$boundTransclude;
            }
            if (!namespace) {
              namespace = detectNamespaceForChildElements(futureParentElement);
            }
            var $linkNode;
            if (namespace !== 'html') {
              $linkNode = jqLite(wrapTemplate(namespace, jqLite('<div>').append($compileNodes).html()));
            } else if (cloneConnectFn) {
              $linkNode = JQLitePrototype.clone.call($compileNodes);
            } else {
              $linkNode = $compileNodes;
            }
            if (transcludeControllers) {
              for (var controllerName in transcludeControllers) {
                $linkNode.data('$' + controllerName + 'Controller', transcludeControllers[controllerName].instance);
              }
            }
            compile.$$addScopeInfo($linkNode, scope);
            if (cloneConnectFn)
              cloneConnectFn($linkNode, scope);
            if (compositeLinkFn)
              compositeLinkFn(scope, $linkNode, $linkNode, parentBoundTranscludeFn);
            return $linkNode;
          };
        }
        function detectNamespaceForChildElements(parentElement) {
          var node = parentElement && parentElement[0];
          if (!node) {
            return 'html';
          } else {
            return nodeName_(node) !== 'foreignobject' && node.toString().match(/SVG/) ? 'svg' : 'html';
          }
        }
        function compileNodes(nodeList, transcludeFn, $rootElement, maxPriority, ignoreDirective, previousCompileContext) {
          var linkFns = [],
              attrs,
              directives,
              nodeLinkFn,
              childNodes,
              childLinkFn,
              linkFnFound,
              nodeLinkFnFound;
          for (var i = 0; i < nodeList.length; i++) {
            attrs = new Attributes();
            directives = collectDirectives(nodeList[i], [], attrs, i === 0 ? maxPriority : undefined, ignoreDirective);
            nodeLinkFn = (directives.length) ? applyDirectivesToNode(directives, nodeList[i], attrs, transcludeFn, $rootElement, null, [], [], previousCompileContext) : null;
            if (nodeLinkFn && nodeLinkFn.scope) {
              compile.$$addScopeClass(attrs.$$element);
            }
            childLinkFn = (nodeLinkFn && nodeLinkFn.terminal || !(childNodes = nodeList[i].childNodes) || !childNodes.length) ? null : compileNodes(childNodes, nodeLinkFn ? ((nodeLinkFn.transcludeOnThisElement || !nodeLinkFn.templateOnThisElement) && nodeLinkFn.transclude) : transcludeFn);
            if (nodeLinkFn || childLinkFn) {
              linkFns.push(i, nodeLinkFn, childLinkFn);
              linkFnFound = true;
              nodeLinkFnFound = nodeLinkFnFound || nodeLinkFn;
            }
            previousCompileContext = null;
          }
          return linkFnFound ? compositeLinkFn : null;
          function compositeLinkFn(scope, nodeList, $rootElement, parentBoundTranscludeFn) {
            var nodeLinkFn,
                childLinkFn,
                node,
                childScope,
                i,
                ii,
                idx,
                childBoundTranscludeFn;
            var stableNodeList;
            if (nodeLinkFnFound) {
              var nodeListLength = nodeList.length;
              stableNodeList = new Array(nodeListLength);
              for (i = 0; i < linkFns.length; i += 3) {
                idx = linkFns[i];
                stableNodeList[idx] = nodeList[idx];
              }
            } else {
              stableNodeList = nodeList;
            }
            for (i = 0, ii = linkFns.length; i < ii; ) {
              node = stableNodeList[linkFns[i++]];
              nodeLinkFn = linkFns[i++];
              childLinkFn = linkFns[i++];
              if (nodeLinkFn) {
                if (nodeLinkFn.scope) {
                  childScope = scope.$new();
                  compile.$$addScopeInfo(jqLite(node), childScope);
                  var destroyBindings = nodeLinkFn.$$destroyBindings;
                  if (destroyBindings) {
                    nodeLinkFn.$$destroyBindings = null;
                    childScope.$on('$destroyed', destroyBindings);
                  }
                } else {
                  childScope = scope;
                }
                if (nodeLinkFn.transcludeOnThisElement) {
                  childBoundTranscludeFn = createBoundTranscludeFn(scope, nodeLinkFn.transclude, parentBoundTranscludeFn);
                } else if (!nodeLinkFn.templateOnThisElement && parentBoundTranscludeFn) {
                  childBoundTranscludeFn = parentBoundTranscludeFn;
                } else if (!parentBoundTranscludeFn && transcludeFn) {
                  childBoundTranscludeFn = createBoundTranscludeFn(scope, transcludeFn);
                } else {
                  childBoundTranscludeFn = null;
                }
                nodeLinkFn(childLinkFn, childScope, node, $rootElement, childBoundTranscludeFn, nodeLinkFn);
              } else if (childLinkFn) {
                childLinkFn(scope, node.childNodes, undefined, parentBoundTranscludeFn);
              }
            }
          }
        }
        function createBoundTranscludeFn(scope, transcludeFn, previousBoundTranscludeFn) {
          var boundTranscludeFn = function(transcludedScope, cloneFn, controllers, futureParentElement, containingScope) {
            if (!transcludedScope) {
              transcludedScope = scope.$new(false, containingScope);
              transcludedScope.$$transcluded = true;
            }
            return transcludeFn(transcludedScope, cloneFn, {
              parentBoundTranscludeFn: previousBoundTranscludeFn,
              transcludeControllers: controllers,
              futureParentElement: futureParentElement
            });
          };
          return boundTranscludeFn;
        }
        function collectDirectives(node, directives, attrs, maxPriority, ignoreDirective) {
          var nodeType = node.nodeType,
              attrsMap = attrs.$attr,
              match,
              className;
          switch (nodeType) {
            case NODE_TYPE_ELEMENT:
              addDirective(directives, directiveNormalize(nodeName_(node)), 'E', maxPriority, ignoreDirective);
              for (var attr,
                  name,
                  nName,
                  ngAttrName,
                  value,
                  isNgAttr,
                  nAttrs = node.attributes,
                  j = 0,
                  jj = nAttrs && nAttrs.length; j < jj; j++) {
                var attrStartName = false;
                var attrEndName = false;
                attr = nAttrs[j];
                name = attr.name;
                value = trim(attr.value);
                ngAttrName = directiveNormalize(name);
                if (isNgAttr = NG_ATTR_BINDING.test(ngAttrName)) {
                  name = name.replace(PREFIX_REGEXP, '').substr(8).replace(/_(.)/g, function(match, letter) {
                    return letter.toUpperCase();
                  });
                }
                var directiveNName = ngAttrName.replace(/(Start|End)$/, '');
                if (directiveIsMultiElement(directiveNName)) {
                  if (ngAttrName === directiveNName + 'Start') {
                    attrStartName = name;
                    attrEndName = name.substr(0, name.length - 5) + 'end';
                    name = name.substr(0, name.length - 6);
                  }
                }
                nName = directiveNormalize(name.toLowerCase());
                attrsMap[nName] = name;
                if (isNgAttr || !attrs.hasOwnProperty(nName)) {
                  attrs[nName] = value;
                  if (getBooleanAttrName(node, nName)) {
                    attrs[nName] = true;
                  }
                }
                addAttrInterpolateDirective(node, directives, value, nName, isNgAttr);
                addDirective(directives, nName, 'A', maxPriority, ignoreDirective, attrStartName, attrEndName);
              }
              className = node.className;
              if (isObject(className)) {
                className = className.animVal;
              }
              if (isString(className) && className !== '') {
                while (match = CLASS_DIRECTIVE_REGEXP.exec(className)) {
                  nName = directiveNormalize(match[2]);
                  if (addDirective(directives, nName, 'C', maxPriority, ignoreDirective)) {
                    attrs[nName] = trim(match[3]);
                  }
                  className = className.substr(match.index + match[0].length);
                }
              }
              break;
            case NODE_TYPE_TEXT:
              if (msie === 11) {
                while (node.parentNode && node.nextSibling && node.nextSibling.nodeType === NODE_TYPE_TEXT) {
                  node.nodeValue = node.nodeValue + node.nextSibling.nodeValue;
                  node.parentNode.removeChild(node.nextSibling);
                }
              }
              addTextInterpolateDirective(directives, node.nodeValue);
              break;
            case NODE_TYPE_COMMENT:
              try {
                match = COMMENT_DIRECTIVE_REGEXP.exec(node.nodeValue);
                if (match) {
                  nName = directiveNormalize(match[1]);
                  if (addDirective(directives, nName, 'M', maxPriority, ignoreDirective)) {
                    attrs[nName] = trim(match[2]);
                  }
                }
              } catch (e) {}
              break;
          }
          directives.sort(byPriority);
          return directives;
        }
        function groupScan(node, attrStart, attrEnd) {
          var nodes = [];
          var depth = 0;
          if (attrStart && node.hasAttribute && node.hasAttribute(attrStart)) {
            do {
              if (!node) {
                throw $compileMinErr('uterdir', "Unterminated attribute, found '{0}' but no matching '{1}' found.", attrStart, attrEnd);
              }
              if (node.nodeType == NODE_TYPE_ELEMENT) {
                if (node.hasAttribute(attrStart))
                  depth++;
                if (node.hasAttribute(attrEnd))
                  depth--;
              }
              nodes.push(node);
              node = node.nextSibling;
            } while (depth > 0);
          } else {
            nodes.push(node);
          }
          return jqLite(nodes);
        }
        function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
          return function(scope, element, attrs, controllers, transcludeFn) {
            element = groupScan(element[0], attrStart, attrEnd);
            return linkFn(scope, element, attrs, controllers, transcludeFn);
          };
        }
        function applyDirectivesToNode(directives, compileNode, templateAttrs, transcludeFn, jqCollection, originalReplaceDirective, preLinkFns, postLinkFns, previousCompileContext) {
          previousCompileContext = previousCompileContext || {};
          var terminalPriority = -Number.MAX_VALUE,
              newScopeDirective = previousCompileContext.newScopeDirective,
              controllerDirectives = previousCompileContext.controllerDirectives,
              newIsolateScopeDirective = previousCompileContext.newIsolateScopeDirective,
              templateDirective = previousCompileContext.templateDirective,
              nonTlbTranscludeDirective = previousCompileContext.nonTlbTranscludeDirective,
              hasTranscludeDirective = false,
              hasTemplate = false,
              hasElementTranscludeDirective = previousCompileContext.hasElementTranscludeDirective,
              $compileNode = templateAttrs.$$element = jqLite(compileNode),
              directive,
              directiveName,
              $template,
              replaceDirective = originalReplaceDirective,
              childTranscludeFn = transcludeFn,
              linkFn,
              directiveValue;
          for (var i = 0,
              ii = directives.length; i < ii; i++) {
            directive = directives[i];
            var attrStart = directive.$$start;
            var attrEnd = directive.$$end;
            if (attrStart) {
              $compileNode = groupScan(compileNode, attrStart, attrEnd);
            }
            $template = undefined;
            if (terminalPriority > directive.priority) {
              break;
            }
            if (directiveValue = directive.scope) {
              if (!directive.templateUrl) {
                if (isObject(directiveValue)) {
                  assertNoDuplicate('new/isolated scope', newIsolateScopeDirective || newScopeDirective, directive, $compileNode);
                  newIsolateScopeDirective = directive;
                } else {
                  assertNoDuplicate('new/isolated scope', newIsolateScopeDirective, directive, $compileNode);
                }
              }
              newScopeDirective = newScopeDirective || directive;
            }
            directiveName = directive.name;
            if (!directive.templateUrl && directive.controller) {
              directiveValue = directive.controller;
              controllerDirectives = controllerDirectives || createMap();
              assertNoDuplicate("'" + directiveName + "' controller", controllerDirectives[directiveName], directive, $compileNode);
              controllerDirectives[directiveName] = directive;
            }
            if (directiveValue = directive.transclude) {
              hasTranscludeDirective = true;
              if (!directive.$$tlb) {
                assertNoDuplicate('transclusion', nonTlbTranscludeDirective, directive, $compileNode);
                nonTlbTranscludeDirective = directive;
              }
              if (directiveValue == 'element') {
                hasElementTranscludeDirective = true;
                terminalPriority = directive.priority;
                $template = $compileNode;
                $compileNode = templateAttrs.$$element = jqLite(document.createComment(' ' + directiveName + ': ' + templateAttrs[directiveName] + ' '));
                compileNode = $compileNode[0];
                replaceWith(jqCollection, sliceArgs($template), compileNode);
                childTranscludeFn = compile($template, transcludeFn, terminalPriority, replaceDirective && replaceDirective.name, {nonTlbTranscludeDirective: nonTlbTranscludeDirective});
              } else {
                $template = jqLite(jqLiteClone(compileNode)).contents();
                $compileNode.empty();
                childTranscludeFn = compile($template, transcludeFn);
              }
            }
            if (directive.template) {
              hasTemplate = true;
              assertNoDuplicate('template', templateDirective, directive, $compileNode);
              templateDirective = directive;
              directiveValue = (isFunction(directive.template)) ? directive.template($compileNode, templateAttrs) : directive.template;
              directiveValue = denormalizeTemplate(directiveValue);
              if (directive.replace) {
                replaceDirective = directive;
                if (jqLiteIsTextNode(directiveValue)) {
                  $template = [];
                } else {
                  $template = removeComments(wrapTemplate(directive.templateNamespace, trim(directiveValue)));
                }
                compileNode = $template[0];
                if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
                  throw $compileMinErr('tplrt', "Template for directive '{0}' must have exactly one root element. {1}", directiveName, '');
                }
                replaceWith(jqCollection, $compileNode, compileNode);
                var newTemplateAttrs = {$attr: {}};
                var templateDirectives = collectDirectives(compileNode, [], newTemplateAttrs);
                var unprocessedDirectives = directives.splice(i + 1, directives.length - (i + 1));
                if (newIsolateScopeDirective) {
                  markDirectivesAsIsolate(templateDirectives);
                }
                directives = directives.concat(templateDirectives).concat(unprocessedDirectives);
                mergeTemplateAttributes(templateAttrs, newTemplateAttrs);
                ii = directives.length;
              } else {
                $compileNode.html(directiveValue);
              }
            }
            if (directive.templateUrl) {
              hasTemplate = true;
              assertNoDuplicate('template', templateDirective, directive, $compileNode);
              templateDirective = directive;
              if (directive.replace) {
                replaceDirective = directive;
              }
              nodeLinkFn = compileTemplateUrl(directives.splice(i, directives.length - i), $compileNode, templateAttrs, jqCollection, hasTranscludeDirective && childTranscludeFn, preLinkFns, postLinkFns, {
                controllerDirectives: controllerDirectives,
                newScopeDirective: (newScopeDirective !== directive) && newScopeDirective,
                newIsolateScopeDirective: newIsolateScopeDirective,
                templateDirective: templateDirective,
                nonTlbTranscludeDirective: nonTlbTranscludeDirective
              });
              ii = directives.length;
            } else if (directive.compile) {
              try {
                linkFn = directive.compile($compileNode, templateAttrs, childTranscludeFn);
                if (isFunction(linkFn)) {
                  addLinkFns(null, linkFn, attrStart, attrEnd);
                } else if (linkFn) {
                  addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd);
                }
              } catch (e) {
                $exceptionHandler(e, startingTag($compileNode));
              }
            }
            if (directive.terminal) {
              nodeLinkFn.terminal = true;
              terminalPriority = Math.max(terminalPriority, directive.priority);
            }
          }
          nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope === true;
          nodeLinkFn.transcludeOnThisElement = hasTranscludeDirective;
          nodeLinkFn.templateOnThisElement = hasTemplate;
          nodeLinkFn.transclude = childTranscludeFn;
          previousCompileContext.hasElementTranscludeDirective = hasElementTranscludeDirective;
          return nodeLinkFn;
          function addLinkFns(pre, post, attrStart, attrEnd) {
            if (pre) {
              if (attrStart)
                pre = groupElementsLinkFnWrapper(pre, attrStart, attrEnd);
              pre.require = directive.require;
              pre.directiveName = directiveName;
              if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
                pre = cloneAndAnnotateFn(pre, {isolateScope: true});
              }
              preLinkFns.push(pre);
            }
            if (post) {
              if (attrStart)
                post = groupElementsLinkFnWrapper(post, attrStart, attrEnd);
              post.require = directive.require;
              post.directiveName = directiveName;
              if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
                post = cloneAndAnnotateFn(post, {isolateScope: true});
              }
              postLinkFns.push(post);
            }
          }
          function getControllers(directiveName, require, $element, elementControllers) {
            var value;
            if (isString(require)) {
              var match = require.match(REQUIRE_PREFIX_REGEXP);
              var name = require.substring(match[0].length);
              var inheritType = match[1] || match[3];
              var optional = match[2] === '?';
              if (inheritType === '^^') {
                $element = $element.parent();
              } else {
                value = elementControllers && elementControllers[name];
                value = value && value.instance;
              }
              if (!value) {
                var dataName = '$' + name + 'Controller';
                value = inheritType ? $element.inheritedData(dataName) : $element.data(dataName);
              }
              if (!value && !optional) {
                throw $compileMinErr('ctreq', "Controller '{0}', required by directive '{1}', can't be found!", name, directiveName);
              }
            } else if (isArray(require)) {
              value = [];
              for (var i = 0,
                  ii = require.length; i < ii; i++) {
                value[i] = getControllers(directiveName, require[i], $element, elementControllers);
              }
            }
            return value || null;
          }
          function setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope) {
            var elementControllers = createMap();
            for (var controllerKey in controllerDirectives) {
              var directive = controllerDirectives[controllerKey];
              var locals = {
                $scope: directive === newIsolateScopeDirective || directive.$$isolateScope ? isolateScope : scope,
                $element: $element,
                $attrs: attrs,
                $transclude: transcludeFn
              };
              var controller = directive.controller;
              if (controller == '@') {
                controller = attrs[directive.name];
              }
              var controllerInstance = $controller(controller, locals, true, directive.controllerAs);
              elementControllers[directive.name] = controllerInstance;
              if (!hasElementTranscludeDirective) {
                $element.data('$' + directive.name + 'Controller', controllerInstance.instance);
              }
            }
            return elementControllers;
          }
          function nodeLinkFn(childLinkFn, scope, linkNode, $rootElement, boundTranscludeFn, thisLinkFn) {
            var i,
                ii,
                linkFn,
                controller,
                isolateScope,
                elementControllers,
                transcludeFn,
                $element,
                attrs;
            if (compileNode === linkNode) {
              attrs = templateAttrs;
              $element = templateAttrs.$$element;
            } else {
              $element = jqLite(linkNode);
              attrs = new Attributes($element, templateAttrs);
            }
            if (newIsolateScopeDirective) {
              isolateScope = scope.$new(true);
            }
            if (boundTranscludeFn) {
              transcludeFn = controllersBoundTransclude;
              transcludeFn.$$boundTransclude = boundTranscludeFn;
            }
            if (controllerDirectives) {
              elementControllers = setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope);
            }
            if (newIsolateScopeDirective) {
              compile.$$addScopeInfo($element, isolateScope, true, !(templateDirective && (templateDirective === newIsolateScopeDirective || templateDirective === newIsolateScopeDirective.$$originalDirective)));
              compile.$$addScopeClass($element, true);
              isolateScope.$$isolateBindings = newIsolateScopeDirective.$$isolateBindings;
              initializeDirectiveBindings(scope, attrs, isolateScope, isolateScope.$$isolateBindings, newIsolateScopeDirective, isolateScope);
            }
            if (elementControllers) {
              var scopeDirective = newIsolateScopeDirective || newScopeDirective;
              var bindings;
              var controllerForBindings;
              if (scopeDirective && elementControllers[scopeDirective.name]) {
                bindings = scopeDirective.$$bindings.bindToController;
                controller = elementControllers[scopeDirective.name];
                if (controller && controller.identifier && bindings) {
                  controllerForBindings = controller;
                  thisLinkFn.$$destroyBindings = initializeDirectiveBindings(scope, attrs, controller.instance, bindings, scopeDirective);
                }
              }
              for (i in elementControllers) {
                controller = elementControllers[i];
                var controllerResult = controller();
                if (controllerResult !== controller.instance) {
                  controller.instance = controllerResult;
                  $element.data('$' + i + 'Controller', controllerResult);
                  if (controller === controllerForBindings) {
                    thisLinkFn.$$destroyBindings();
                    thisLinkFn.$$destroyBindings = initializeDirectiveBindings(scope, attrs, controllerResult, bindings, scopeDirective);
                  }
                }
              }
            }
            for (i = 0, ii = preLinkFns.length; i < ii; i++) {
              linkFn = preLinkFns[i];
              invokeLinkFn(linkFn, linkFn.isolateScope ? isolateScope : scope, $element, attrs, linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers), transcludeFn);
            }
            var scopeToChild = scope;
            if (newIsolateScopeDirective && (newIsolateScopeDirective.template || newIsolateScopeDirective.templateUrl === null)) {
              scopeToChild = isolateScope;
            }
            childLinkFn && childLinkFn(scopeToChild, linkNode.childNodes, undefined, boundTranscludeFn);
            for (i = postLinkFns.length - 1; i >= 0; i--) {
              linkFn = postLinkFns[i];
              invokeLinkFn(linkFn, linkFn.isolateScope ? isolateScope : scope, $element, attrs, linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers), transcludeFn);
            }
            function controllersBoundTransclude(scope, cloneAttachFn, futureParentElement) {
              var transcludeControllers;
              if (!isScope(scope)) {
                futureParentElement = cloneAttachFn;
                cloneAttachFn = scope;
                scope = undefined;
              }
              if (hasElementTranscludeDirective) {
                transcludeControllers = elementControllers;
              }
              if (!futureParentElement) {
                futureParentElement = hasElementTranscludeDirective ? $element.parent() : $element;
              }
              return boundTranscludeFn(scope, cloneAttachFn, transcludeControllers, futureParentElement, scopeToChild);
            }
          }
        }
        function markDirectivesAsIsolate(directives) {
          for (var j = 0,
              jj = directives.length; j < jj; j++) {
            directives[j] = inherit(directives[j], {$$isolateScope: true});
          }
        }
        function addDirective(tDirectives, name, location, maxPriority, ignoreDirective, startAttrName, endAttrName) {
          if (name === ignoreDirective)
            return null;
          var match = null;
          if (hasDirectives.hasOwnProperty(name)) {
            for (var directive,
                directives = $injector.get(name + Suffix),
                i = 0,
                ii = directives.length; i < ii; i++) {
              try {
                directive = directives[i];
                if ((isUndefined(maxPriority) || maxPriority > directive.priority) && directive.restrict.indexOf(location) != -1) {
                  if (startAttrName) {
                    directive = inherit(directive, {
                      $$start: startAttrName,
                      $$end: endAttrName
                    });
                  }
                  tDirectives.push(directive);
                  match = directive;
                }
              } catch (e) {
                $exceptionHandler(e);
              }
            }
          }
          return match;
        }
        function directiveIsMultiElement(name) {
          if (hasDirectives.hasOwnProperty(name)) {
            for (var directive,
                directives = $injector.get(name + Suffix),
                i = 0,
                ii = directives.length; i < ii; i++) {
              directive = directives[i];
              if (directive.multiElement) {
                return true;
              }
            }
          }
          return false;
        }
        function mergeTemplateAttributes(dst, src) {
          var srcAttr = src.$attr,
              dstAttr = dst.$attr,
              $element = dst.$$element;
          forEach(dst, function(value, key) {
            if (key.charAt(0) != '$') {
              if (src[key] && src[key] !== value) {
                value += (key === 'style' ? ';' : ' ') + src[key];
              }
              dst.$set(key, value, true, srcAttr[key]);
            }
          });
          forEach(src, function(value, key) {
            if (key == 'class') {
              safeAddClass($element, value);
              dst['class'] = (dst['class'] ? dst['class'] + ' ' : '') + value;
            } else if (key == 'style') {
              $element.attr('style', $element.attr('style') + ';' + value);
              dst['style'] = (dst['style'] ? dst['style'] + ';' : '') + value;
            } else if (key.charAt(0) != '$' && !dst.hasOwnProperty(key)) {
              dst[key] = value;
              dstAttr[key] = srcAttr[key];
            }
          });
        }
        function compileTemplateUrl(directives, $compileNode, tAttrs, $rootElement, childTranscludeFn, preLinkFns, postLinkFns, previousCompileContext) {
          var linkQueue = [],
              afterTemplateNodeLinkFn,
              afterTemplateChildLinkFn,
              beforeTemplateCompileNode = $compileNode[0],
              origAsyncDirective = directives.shift(),
              derivedSyncDirective = inherit(origAsyncDirective, {
                templateUrl: null,
                transclude: null,
                replace: null,
                $$originalDirective: origAsyncDirective
              }),
              templateUrl = (isFunction(origAsyncDirective.templateUrl)) ? origAsyncDirective.templateUrl($compileNode, tAttrs) : origAsyncDirective.templateUrl,
              templateNamespace = origAsyncDirective.templateNamespace;
          $compileNode.empty();
          $templateRequest(templateUrl).then(function(content) {
            var compileNode,
                tempTemplateAttrs,
                $template,
                childBoundTranscludeFn;
            content = denormalizeTemplate(content);
            if (origAsyncDirective.replace) {
              if (jqLiteIsTextNode(content)) {
                $template = [];
              } else {
                $template = removeComments(wrapTemplate(templateNamespace, trim(content)));
              }
              compileNode = $template[0];
              if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
                throw $compileMinErr('tplrt', "Template for directive '{0}' must have exactly one root element. {1}", origAsyncDirective.name, templateUrl);
              }
              tempTemplateAttrs = {$attr: {}};
              replaceWith($rootElement, $compileNode, compileNode);
              var templateDirectives = collectDirectives(compileNode, [], tempTemplateAttrs);
              if (isObject(origAsyncDirective.scope)) {
                markDirectivesAsIsolate(templateDirectives);
              }
              directives = templateDirectives.concat(directives);
              mergeTemplateAttributes(tAttrs, tempTemplateAttrs);
            } else {
              compileNode = beforeTemplateCompileNode;
              $compileNode.html(content);
            }
            directives.unshift(derivedSyncDirective);
            afterTemplateNodeLinkFn = applyDirectivesToNode(directives, compileNode, tAttrs, childTranscludeFn, $compileNode, origAsyncDirective, preLinkFns, postLinkFns, previousCompileContext);
            forEach($rootElement, function(node, i) {
              if (node == compileNode) {
                $rootElement[i] = $compileNode[0];
              }
            });
            afterTemplateChildLinkFn = compileNodes($compileNode[0].childNodes, childTranscludeFn);
            while (linkQueue.length) {
              var scope = linkQueue.shift(),
                  beforeTemplateLinkNode = linkQueue.shift(),
                  linkRootElement = linkQueue.shift(),
                  boundTranscludeFn = linkQueue.shift(),
                  linkNode = $compileNode[0];
              if (scope.$$destroyed)
                continue;
              if (beforeTemplateLinkNode !== beforeTemplateCompileNode) {
                var oldClasses = beforeTemplateLinkNode.className;
                if (!(previousCompileContext.hasElementTranscludeDirective && origAsyncDirective.replace)) {
                  linkNode = jqLiteClone(compileNode);
                }
                replaceWith(linkRootElement, jqLite(beforeTemplateLinkNode), linkNode);
                safeAddClass(jqLite(linkNode), oldClasses);
              }
              if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
                childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
              } else {
                childBoundTranscludeFn = boundTranscludeFn;
              }
              afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, linkNode, $rootElement, childBoundTranscludeFn, afterTemplateNodeLinkFn);
            }
            linkQueue = null;
          });
          return function delayedNodeLinkFn(ignoreChildLinkFn, scope, node, rootElement, boundTranscludeFn) {
            var childBoundTranscludeFn = boundTranscludeFn;
            if (scope.$$destroyed)
              return;
            if (linkQueue) {
              linkQueue.push(scope, node, rootElement, childBoundTranscludeFn);
            } else {
              if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
                childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
              }
              afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, node, rootElement, childBoundTranscludeFn, afterTemplateNodeLinkFn);
            }
          };
        }
        function byPriority(a, b) {
          var diff = b.priority - a.priority;
          if (diff !== 0)
            return diff;
          if (a.name !== b.name)
            return (a.name < b.name) ? -1 : 1;
          return a.index - b.index;
        }
        function assertNoDuplicate(what, previousDirective, directive, element) {
          function wrapModuleNameIfDefined(moduleName) {
            return moduleName ? (' (module: ' + moduleName + ')') : '';
          }
          if (previousDirective) {
            throw $compileMinErr('multidir', 'Multiple directives [{0}{1}, {2}{3}] asking for {4} on: {5}', previousDirective.name, wrapModuleNameIfDefined(previousDirective.$$moduleName), directive.name, wrapModuleNameIfDefined(directive.$$moduleName), what, startingTag(element));
          }
        }
        function addTextInterpolateDirective(directives, text) {
          var interpolateFn = $interpolate(text, true);
          if (interpolateFn) {
            directives.push({
              priority: 0,
              compile: function textInterpolateCompileFn(templateNode) {
                var templateNodeParent = templateNode.parent(),
                    hasCompileParent = !!templateNodeParent.length;
                if (hasCompileParent)
                  compile.$$addBindingClass(templateNodeParent);
                return function textInterpolateLinkFn(scope, node) {
                  var parent = node.parent();
                  if (!hasCompileParent)
                    compile.$$addBindingClass(parent);
                  compile.$$addBindingInfo(parent, interpolateFn.expressions);
                  scope.$watch(interpolateFn, function interpolateFnWatchAction(value) {
                    node[0].nodeValue = value;
                  });
                };
              }
            });
          }
        }
        function wrapTemplate(type, template) {
          type = lowercase(type || 'html');
          switch (type) {
            case 'svg':
            case 'math':
              var wrapper = document.createElement('div');
              wrapper.innerHTML = '<' + type + '>' + template + '</' + type + '>';
              return wrapper.childNodes[0].childNodes;
            default:
              return template;
          }
        }
        function getTrustedContext(node, attrNormalizedName) {
          if (attrNormalizedName == "srcdoc") {
            return $sce.HTML;
          }
          var tag = nodeName_(node);
          if (attrNormalizedName == "xlinkHref" || (tag == "form" && attrNormalizedName == "action") || (tag != "img" && (attrNormalizedName == "src" || attrNormalizedName == "ngSrc"))) {
            return $sce.RESOURCE_URL;
          }
        }
        function addAttrInterpolateDirective(node, directives, value, name, allOrNothing) {
          var trustedContext = getTrustedContext(node, name);
          allOrNothing = ALL_OR_NOTHING_ATTRS[name] || allOrNothing;
          var interpolateFn = $interpolate(value, true, trustedContext, allOrNothing);
          if (!interpolateFn)
            return;
          if (name === "multiple" && nodeName_(node) === "select") {
            throw $compileMinErr("selmulti", "Binding to the 'multiple' attribute is not supported. Element: {0}", startingTag(node));
          }
          directives.push({
            priority: 100,
            compile: function() {
              return {pre: function attrInterpolatePreLinkFn(scope, element, attr) {
                  var $$observers = (attr.$$observers || (attr.$$observers = createMap()));
                  if (EVENT_HANDLER_ATTR_REGEXP.test(name)) {
                    throw $compileMinErr('nodomevents', "Interpolations for HTML DOM event attributes are disallowed.  Please use the " + "ng- versions (such as ng-click instead of onclick) instead.");
                  }
                  var newValue = attr[name];
                  if (newValue !== value) {
                    interpolateFn = newValue && $interpolate(newValue, true, trustedContext, allOrNothing);
                    value = newValue;
                  }
                  if (!interpolateFn)
                    return;
                  attr[name] = interpolateFn(scope);
                  ($$observers[name] || ($$observers[name] = [])).$$inter = true;
                  (attr.$$observers && attr.$$observers[name].$$scope || scope).$watch(interpolateFn, function interpolateFnWatchAction(newValue, oldValue) {
                    if (name === 'class' && newValue != oldValue) {
                      attr.$updateClass(newValue, oldValue);
                    } else {
                      attr.$set(name, newValue);
                    }
                  });
                }};
            }
          });
        }
        function replaceWith($rootElement, elementsToRemove, newNode) {
          var firstElementToRemove = elementsToRemove[0],
              removeCount = elementsToRemove.length,
              parent = firstElementToRemove.parentNode,
              i,
              ii;
          if ($rootElement) {
            for (i = 0, ii = $rootElement.length; i < ii; i++) {
              if ($rootElement[i] == firstElementToRemove) {
                $rootElement[i++] = newNode;
                for (var j = i,
                    j2 = j + removeCount - 1,
                    jj = $rootElement.length; j < jj; j++, j2++) {
                  if (j2 < jj) {
                    $rootElement[j] = $rootElement[j2];
                  } else {
                    delete $rootElement[j];
                  }
                }
                $rootElement.length -= removeCount - 1;
                if ($rootElement.context === firstElementToRemove) {
                  $rootElement.context = newNode;
                }
                break;
              }
            }
          }
          if (parent) {
            parent.replaceChild(newNode, firstElementToRemove);
          }
          var fragment = document.createDocumentFragment();
          fragment.appendChild(firstElementToRemove);
          if (jqLite.hasData(firstElementToRemove)) {
            jqLite(newNode).data(jqLite(firstElementToRemove).data());
            if (!jQuery) {
              delete jqLite.cache[firstElementToRemove[jqLite.expando]];
            } else {
              skipDestroyOnNextJQueryCleanData = true;
              jQuery.cleanData([firstElementToRemove]);
            }
          }
          for (var k = 1,
              kk = elementsToRemove.length; k < kk; k++) {
            var element = elementsToRemove[k];
            jqLite(element).remove();
            fragment.appendChild(element);
            delete elementsToRemove[k];
          }
          elementsToRemove[0] = newNode;
          elementsToRemove.length = 1;
        }
        function cloneAndAnnotateFn(fn, annotation) {
          return extend(function() {
            return fn.apply(null, arguments);
          }, fn, annotation);
        }
        function invokeLinkFn(linkFn, scope, $element, attrs, controllers, transcludeFn) {
          try {
            linkFn(scope, $element, attrs, controllers, transcludeFn);
          } catch (e) {
            $exceptionHandler(e, startingTag($element));
          }
        }
        function initializeDirectiveBindings(scope, attrs, destination, bindings, directive, newScope) {
          var onNewScopeDestroyed;
          forEach(bindings, function(definition, scopeName) {
            var attrName = definition.attrName,
                optional = definition.optional,
                mode = definition.mode,
                lastValue,
                parentGet,
                parentSet,
                compare;
            switch (mode) {
              case '@':
                if (!optional && !hasOwnProperty.call(attrs, attrName)) {
                  destination[scopeName] = attrs[attrName] = void 0;
                }
                attrs.$observe(attrName, function(value) {
                  if (isString(value)) {
                    destination[scopeName] = value;
                  }
                });
                attrs.$$observers[attrName].$$scope = scope;
                if (isString(attrs[attrName])) {
                  destination[scopeName] = $interpolate(attrs[attrName])(scope);
                }
                break;
              case '=':
                if (!hasOwnProperty.call(attrs, attrName)) {
                  if (optional)
                    break;
                  attrs[attrName] = void 0;
                }
                if (optional && !attrs[attrName])
                  break;
                parentGet = $parse(attrs[attrName]);
                if (parentGet.literal) {
                  compare = equals;
                } else {
                  compare = function(a, b) {
                    return a === b || (a !== a && b !== b);
                  };
                }
                parentSet = parentGet.assign || function() {
                  lastValue = destination[scopeName] = parentGet(scope);
                  throw $compileMinErr('nonassign', "Expression '{0}' used with directive '{1}' is non-assignable!", attrs[attrName], directive.name);
                };
                lastValue = destination[scopeName] = parentGet(scope);
                var parentValueWatch = function parentValueWatch(parentValue) {
                  if (!compare(parentValue, destination[scopeName])) {
                    if (!compare(parentValue, lastValue)) {
                      destination[scopeName] = parentValue;
                    } else {
                      parentSet(scope, parentValue = destination[scopeName]);
                    }
                  }
                  return lastValue = parentValue;
                };
                parentValueWatch.$stateful = true;
                var unwatch;
                if (definition.collection) {
                  unwatch = scope.$watchCollection(attrs[attrName], parentValueWatch);
                } else {
                  unwatch = scope.$watch($parse(attrs[attrName], parentValueWatch), null, parentGet.literal);
                }
                onNewScopeDestroyed = (onNewScopeDestroyed || []);
                onNewScopeDestroyed.push(unwatch);
                break;
              case '&':
                parentGet = attrs.hasOwnProperty(attrName) ? $parse(attrs[attrName]) : noop;
                if (parentGet === noop && optional)
                  break;
                destination[scopeName] = function(locals) {
                  return parentGet(scope, locals);
                };
                break;
            }
          });
          var destroyBindings = onNewScopeDestroyed ? function destroyBindings() {
            for (var i = 0,
                ii = onNewScopeDestroyed.length; i < ii; ++i) {
              onNewScopeDestroyed[i]();
            }
          } : noop;
          if (newScope && destroyBindings !== noop) {
            newScope.$on('$destroy', destroyBindings);
            return noop;
          }
          return destroyBindings;
        }
      }];
    }
    var PREFIX_REGEXP = /^((?:x|data)[\:\-_])/i;
    function directiveNormalize(name) {
      return camelCase(name.replace(PREFIX_REGEXP, ''));
    }
    function nodesetLinkingFn(scope, nodeList, rootElement, boundTranscludeFn) {}
    function directiveLinkingFn(nodesetLinkingFn, scope, node, rootElement, boundTranscludeFn) {}
    function tokenDifference(str1, str2) {
      var values = '',
          tokens1 = str1.split(/\s+/),
          tokens2 = str2.split(/\s+/);
      outer: for (var i = 0; i < tokens1.length; i++) {
        var token = tokens1[i];
        for (var j = 0; j < tokens2.length; j++) {
          if (token == tokens2[j])
            continue outer;
        }
        values += (values.length > 0 ? ' ' : '') + token;
      }
      return values;
    }
    function removeComments(jqNodes) {
      jqNodes = jqLite(jqNodes);
      var i = jqNodes.length;
      if (i <= 1) {
        return jqNodes;
      }
      while (i--) {
        var node = jqNodes[i];
        if (node.nodeType === NODE_TYPE_COMMENT) {
          splice.call(jqNodes, i, 1);
        }
      }
      return jqNodes;
    }
    var $controllerMinErr = minErr('$controller');
    var CNTRL_REG = /^(\S+)(\s+as\s+(\w+))?$/;
    function identifierForController(controller, ident) {
      if (ident && isString(ident))
        return ident;
      if (isString(controller)) {
        var match = CNTRL_REG.exec(controller);
        if (match)
          return match[3];
      }
    }
    function $ControllerProvider() {
      var controllers = {},
          globals = false;
      this.register = function(name, constructor) {
        assertNotHasOwnProperty(name, 'controller');
        if (isObject(name)) {
          extend(controllers, name);
        } else {
          controllers[name] = constructor;
        }
      };
      this.allowGlobals = function() {
        globals = true;
      };
      this.$get = ['$injector', '$window', function($injector, $window) {
        return function(expression, locals, later, ident) {
          var instance,
              match,
              constructor,
              identifier;
          later = later === true;
          if (ident && isString(ident)) {
            identifier = ident;
          }
          if (isString(expression)) {
            match = expression.match(CNTRL_REG);
            if (!match) {
              throw $controllerMinErr('ctrlfmt', "Badly formed controller string '{0}'. " + "Must match `__name__ as __id__` or `__name__`.", expression);
            }
            constructor = match[1], identifier = identifier || match[3];
            expression = controllers.hasOwnProperty(constructor) ? controllers[constructor] : getter(locals.$scope, constructor, true) || (globals ? getter($window, constructor, true) : undefined);
            assertArgFn(expression, constructor, true);
          }
          if (later) {
            var controllerPrototype = (isArray(expression) ? expression[expression.length - 1] : expression).prototype;
            instance = Object.create(controllerPrototype || null);
            if (identifier) {
              addIdentifier(locals, identifier, instance, constructor || expression.name);
            }
            var instantiate;
            return instantiate = extend(function() {
              var result = $injector.invoke(expression, instance, locals, constructor);
              if (result !== instance && (isObject(result) || isFunction(result))) {
                instance = result;
                if (identifier) {
                  addIdentifier(locals, identifier, instance, constructor || expression.name);
                }
              }
              return instance;
            }, {
              instance: instance,
              identifier: identifier
            });
          }
          instance = $injector.instantiate(expression, locals, constructor);
          if (identifier) {
            addIdentifier(locals, identifier, instance, constructor || expression.name);
          }
          return instance;
        };
        function addIdentifier(locals, identifier, instance, name) {
          if (!(locals && isObject(locals.$scope))) {
            throw minErr('$controller')('noscp', "Cannot export controller '{0}' as '{1}'! No $scope object provided via `locals`.", name, identifier);
          }
          locals.$scope[identifier] = instance;
        }
      }];
    }
    function $DocumentProvider() {
      this.$get = ['$window', function(window) {
        return jqLite(window.document);
      }];
    }
    function $ExceptionHandlerProvider() {
      this.$get = ['$log', function($log) {
        return function(exception, cause) {
          $log.error.apply($log, arguments);
        };
      }];
    }
    var $$ForceReflowProvider = function() {
      this.$get = ['$document', function($document) {
        return function(domNode) {
          if (domNode) {
            if (!domNode.nodeType && domNode instanceof jqLite) {
              domNode = domNode[0];
            }
          } else {
            domNode = $document[0].body;
          }
          return domNode.offsetWidth + 1;
        };
      }];
    };
    var APPLICATION_JSON = 'application/json';
    var CONTENT_TYPE_APPLICATION_JSON = {'Content-Type': APPLICATION_JSON + ';charset=utf-8'};
    var JSON_START = /^\[|^\{(?!\{)/;
    var JSON_ENDS = {
      '[': /]$/,
      '{': /}$/
    };
    var JSON_PROTECTION_PREFIX = /^\)\]\}',?\n/;
    var $httpMinErr = minErr('$http');
    var $httpMinErrLegacyFn = function(method) {
      return function() {
        throw $httpMinErr('legacy', 'The method `{0}` on the promise returned from `$http` has been disabled.', method);
      };
    };
    function serializeValue(v) {
      if (isObject(v)) {
        return isDate(v) ? v.toISOString() : toJson(v);
      }
      return v;
    }
    function $HttpParamSerializerProvider() {
      this.$get = function() {
        return function ngParamSerializer(params) {
          if (!params)
            return '';
          var parts = [];
          forEachSorted(params, function(value, key) {
            if (value === null || isUndefined(value))
              return;
            if (isArray(value)) {
              forEach(value, function(v, k) {
                parts.push(encodeUriQuery(key) + '=' + encodeUriQuery(serializeValue(v)));
              });
            } else {
              parts.push(encodeUriQuery(key) + '=' + encodeUriQuery(serializeValue(value)));
            }
          });
          return parts.join('&');
        };
      };
    }
    function $HttpParamSerializerJQLikeProvider() {
      this.$get = function() {
        return function jQueryLikeParamSerializer(params) {
          if (!params)
            return '';
          var parts = [];
          serialize(params, '', true);
          return parts.join('&');
          function serialize(toSerialize, prefix, topLevel) {
            if (toSerialize === null || isUndefined(toSerialize))
              return;
            if (isArray(toSerialize)) {
              forEach(toSerialize, function(value, index) {
                serialize(value, prefix + '[' + (isObject(value) ? index : '') + ']');
              });
            } else if (isObject(toSerialize) && !isDate(toSerialize)) {
              forEachSorted(toSerialize, function(value, key) {
                serialize(value, prefix + (topLevel ? '' : '[') + key + (topLevel ? '' : ']'));
              });
            } else {
              parts.push(encodeUriQuery(prefix) + '=' + encodeUriQuery(serializeValue(toSerialize)));
            }
          }
        };
      };
    }
    function defaultHttpResponseTransform(data, headers) {
      if (isString(data)) {
        var tempData = data.replace(JSON_PROTECTION_PREFIX, '').trim();
        if (tempData) {
          var contentType = headers('Content-Type');
          if ((contentType && (contentType.indexOf(APPLICATION_JSON) === 0)) || isJsonLike(tempData)) {
            data = fromJson(tempData);
          }
        }
      }
      return data;
    }
    function isJsonLike(str) {
      var jsonStart = str.match(JSON_START);
      return jsonStart && JSON_ENDS[jsonStart[0]].test(str);
    }
    function parseHeaders(headers) {
      var parsed = createMap(),
          i;
      function fillInParsed(key, val) {
        if (key) {
          parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
        }
      }
      if (isString(headers)) {
        forEach(headers.split('\n'), function(line) {
          i = line.indexOf(':');
          fillInParsed(lowercase(trim(line.substr(0, i))), trim(line.substr(i + 1)));
        });
      } else if (isObject(headers)) {
        forEach(headers, function(headerVal, headerKey) {
          fillInParsed(lowercase(headerKey), trim(headerVal));
        });
      }
      return parsed;
    }
    function headersGetter(headers) {
      var headersObj;
      return function(name) {
        if (!headersObj)
          headersObj = parseHeaders(headers);
        if (name) {
          var value = headersObj[lowercase(name)];
          if (value === void 0) {
            value = null;
          }
          return value;
        }
        return headersObj;
      };
    }
    function transformData(data, headers, status, fns) {
      if (isFunction(fns)) {
        return fns(data, headers, status);
      }
      forEach(fns, function(fn) {
        data = fn(data, headers, status);
      });
      return data;
    }
    function isSuccess(status) {
      return 200 <= status && status < 300;
    }
    function $HttpProvider() {
      var defaults = this.defaults = {
        transformResponse: [defaultHttpResponseTransform],
        transformRequest: [function(d) {
          return isObject(d) && !isFile(d) && !isBlob(d) && !isFormData(d) ? toJson(d) : d;
        }],
        headers: {
          common: {'Accept': 'application/json, text/plain, */*'},
          post: shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
          put: shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
          patch: shallowCopy(CONTENT_TYPE_APPLICATION_JSON)
        },
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
        paramSerializer: '$httpParamSerializer'
      };
      var useApplyAsync = false;
      this.useApplyAsync = function(value) {
        if (isDefined(value)) {
          useApplyAsync = !!value;
          return this;
        }
        return useApplyAsync;
      };
      var useLegacyPromise = true;
      this.useLegacyPromiseExtensions = function(value) {
        if (isDefined(value)) {
          useLegacyPromise = !!value;
          return this;
        }
        return useLegacyPromise;
      };
      var interceptorFactories = this.interceptors = [];
      this.$get = ['$httpBackend', '$$cookieReader', '$cacheFactory', '$rootScope', '$q', '$injector', function($httpBackend, $$cookieReader, $cacheFactory, $rootScope, $q, $injector) {
        var defaultCache = $cacheFactory('$http');
        defaults.paramSerializer = isString(defaults.paramSerializer) ? $injector.get(defaults.paramSerializer) : defaults.paramSerializer;
        var reversedInterceptors = [];
        forEach(interceptorFactories, function(interceptorFactory) {
          reversedInterceptors.unshift(isString(interceptorFactory) ? $injector.get(interceptorFactory) : $injector.invoke(interceptorFactory));
        });
        function $http(requestConfig) {
          if (!angular.isObject(requestConfig)) {
            throw minErr('$http')('badreq', 'Http request configuration must be an object.  Received: {0}', requestConfig);
          }
          var config = extend({
            method: 'get',
            transformRequest: defaults.transformRequest,
            transformResponse: defaults.transformResponse,
            paramSerializer: defaults.paramSerializer
          }, requestConfig);
          config.headers = mergeHeaders(requestConfig);
          config.method = uppercase(config.method);
          config.paramSerializer = isString(config.paramSerializer) ? $injector.get(config.paramSerializer) : config.paramSerializer;
          var serverRequest = function(config) {
            var headers = config.headers;
            var reqData = transformData(config.data, headersGetter(headers), undefined, config.transformRequest);
            if (isUndefined(reqData)) {
              forEach(headers, function(value, header) {
                if (lowercase(header) === 'content-type') {
                  delete headers[header];
                }
              });
            }
            if (isUndefined(config.withCredentials) && !isUndefined(defaults.withCredentials)) {
              config.withCredentials = defaults.withCredentials;
            }
            return sendReq(config, reqData).then(transformResponse, transformResponse);
          };
          var chain = [serverRequest, undefined];
          var promise = $q.when(config);
          forEach(reversedInterceptors, function(interceptor) {
            if (interceptor.request || interceptor.requestError) {
              chain.unshift(interceptor.request, interceptor.requestError);
            }
            if (interceptor.response || interceptor.responseError) {
              chain.push(interceptor.response, interceptor.responseError);
            }
          });
          while (chain.length) {
            var thenFn = chain.shift();
            var rejectFn = chain.shift();
            promise = promise.then(thenFn, rejectFn);
          }
          if (useLegacyPromise) {
            promise.success = function(fn) {
              assertArgFn(fn, 'fn');
              promise.then(function(response) {
                fn(response.data, response.status, response.headers, config);
              });
              return promise;
            };
            promise.error = function(fn) {
              assertArgFn(fn, 'fn');
              promise.then(null, function(response) {
                fn(response.data, response.status, response.headers, config);
              });
              return promise;
            };
          } else {
            promise.success = $httpMinErrLegacyFn('success');
            promise.error = $httpMinErrLegacyFn('error');
          }
          return promise;
          function transformResponse(response) {
            var resp = extend({}, response);
            if (!response.data) {
              resp.data = response.data;
            } else {
              resp.data = transformData(response.data, response.headers, response.status, config.transformResponse);
            }
            return (isSuccess(response.status)) ? resp : $q.reject(resp);
          }
          function executeHeaderFns(headers, config) {
            var headerContent,
                processedHeaders = {};
            forEach(headers, function(headerFn, header) {
              if (isFunction(headerFn)) {
                headerContent = headerFn(config);
                if (headerContent != null) {
                  processedHeaders[header] = headerContent;
                }
              } else {
                processedHeaders[header] = headerFn;
              }
            });
            return processedHeaders;
          }
          function mergeHeaders(config) {
            var defHeaders = defaults.headers,
                reqHeaders = extend({}, config.headers),
                defHeaderName,
                lowercaseDefHeaderName,
                reqHeaderName;
            defHeaders = extend({}, defHeaders.common, defHeaders[lowercase(config.method)]);
            defaultHeadersIteration: for (defHeaderName in defHeaders) {
              lowercaseDefHeaderName = lowercase(defHeaderName);
              for (reqHeaderName in reqHeaders) {
                if (lowercase(reqHeaderName) === lowercaseDefHeaderName) {
                  continue defaultHeadersIteration;
                }
              }
              reqHeaders[defHeaderName] = defHeaders[defHeaderName];
            }
            return executeHeaderFns(reqHeaders, shallowCopy(config));
          }
        }
        $http.pendingRequests = [];
        createShortMethods('get', 'delete', 'head', 'jsonp');
        createShortMethodsWithData('post', 'put', 'patch');
        $http.defaults = defaults;
        return $http;
        function createShortMethods(names) {
          forEach(arguments, function(name) {
            $http[name] = function(url, config) {
              return $http(extend({}, config || {}, {
                method: name,
                url: url
              }));
            };
          });
        }
        function createShortMethodsWithData(name) {
          forEach(arguments, function(name) {
            $http[name] = function(url, data, config) {
              return $http(extend({}, config || {}, {
                method: name,
                url: url,
                data: data
              }));
            };
          });
        }
        function sendReq(config, reqData) {
          var deferred = $q.defer(),
              promise = deferred.promise,
              cache,
              cachedResp,
              reqHeaders = config.headers,
              url = buildUrl(config.url, config.paramSerializer(config.params));
          $http.pendingRequests.push(config);
          promise.then(removePendingReq, removePendingReq);
          if ((config.cache || defaults.cache) && config.cache !== false && (config.method === 'GET' || config.method === 'JSONP')) {
            cache = isObject(config.cache) ? config.cache : isObject(defaults.cache) ? defaults.cache : defaultCache;
          }
          if (cache) {
            cachedResp = cache.get(url);
            if (isDefined(cachedResp)) {
              if (isPromiseLike(cachedResp)) {
                cachedResp.then(resolvePromiseWithResult, resolvePromiseWithResult);
              } else {
                if (isArray(cachedResp)) {
                  resolvePromise(cachedResp[1], cachedResp[0], shallowCopy(cachedResp[2]), cachedResp[3]);
                } else {
                  resolvePromise(cachedResp, 200, {}, 'OK');
                }
              }
            } else {
              cache.put(url, promise);
            }
          }
          if (isUndefined(cachedResp)) {
            var xsrfValue = urlIsSameOrigin(config.url) ? $$cookieReader()[config.xsrfCookieName || defaults.xsrfCookieName] : undefined;
            if (xsrfValue) {
              reqHeaders[(config.xsrfHeaderName || defaults.xsrfHeaderName)] = xsrfValue;
            }
            $httpBackend(config.method, url, reqData, done, reqHeaders, config.timeout, config.withCredentials, config.responseType);
          }
          return promise;
          function done(status, response, headersString, statusText) {
            if (cache) {
              if (isSuccess(status)) {
                cache.put(url, [status, response, parseHeaders(headersString), statusText]);
              } else {
                cache.remove(url);
              }
            }
            function resolveHttpPromise() {
              resolvePromise(response, status, headersString, statusText);
            }
            if (useApplyAsync) {
              $rootScope.$applyAsync(resolveHttpPromise);
            } else {
              resolveHttpPromise();
              if (!$rootScope.$$phase)
                $rootScope.$apply();
            }
          }
          function resolvePromise(response, status, headers, statusText) {
            status = status >= -1 ? status : 0;
            (isSuccess(status) ? deferred.resolve : deferred.reject)({
              data: response,
              status: status,
              headers: headersGetter(headers),
              config: config,
              statusText: statusText
            });
          }
          function resolvePromiseWithResult(result) {
            resolvePromise(result.data, result.status, shallowCopy(result.headers()), result.statusText);
          }
          function removePendingReq() {
            var idx = $http.pendingRequests.indexOf(config);
            if (idx !== -1)
              $http.pendingRequests.splice(idx, 1);
          }
        }
        function buildUrl(url, serializedParams) {
          if (serializedParams.length > 0) {
            url += ((url.indexOf('?') == -1) ? '?' : '&') + serializedParams;
          }
          return url;
        }
      }];
    }
    function $xhrFactoryProvider() {
      this.$get = function() {
        return function createXhr() {
          return new window.XMLHttpRequest();
        };
      };
    }
    function $HttpBackendProvider() {
      this.$get = ['$browser', '$window', '$document', '$xhrFactory', function($browser, $window, $document, $xhrFactory) {
        return createHttpBackend($browser, $xhrFactory, $browser.defer, $window.angular.callbacks, $document[0]);
      }];
    }
    function createHttpBackend($browser, createXhr, $browserDefer, callbacks, rawDocument) {
      return function(method, url, post, callback, headers, timeout, withCredentials, responseType) {
        $browser.$$incOutstandingRequestCount();
        url = url || $browser.url();
        if (lowercase(method) == 'jsonp') {
          var callbackId = '_' + (callbacks.counter++).toString(36);
          callbacks[callbackId] = function(data) {
            callbacks[callbackId].data = data;
            callbacks[callbackId].called = true;
          };
          var jsonpDone = jsonpReq(url.replace('JSON_CALLBACK', 'angular.callbacks.' + callbackId), callbackId, function(status, text) {
            completeRequest(callback, status, callbacks[callbackId].data, "", text);
            callbacks[callbackId] = noop;
          });
        } else {
          var xhr = createXhr(method, url);
          xhr.open(method, url, true);
          forEach(headers, function(value, key) {
            if (isDefined(value)) {
              xhr.setRequestHeader(key, value);
            }
          });
          xhr.onload = function requestLoaded() {
            var statusText = xhr.statusText || '';
            var response = ('response' in xhr) ? xhr.response : xhr.responseText;
            var status = xhr.status === 1223 ? 204 : xhr.status;
            if (status === 0) {
              status = response ? 200 : urlResolve(url).protocol == 'file' ? 404 : 0;
            }
            completeRequest(callback, status, response, xhr.getAllResponseHeaders(), statusText);
          };
          var requestError = function() {
            completeRequest(callback, -1, null, null, '');
          };
          xhr.onerror = requestError;
          xhr.onabort = requestError;
          if (withCredentials) {
            xhr.withCredentials = true;
          }
          if (responseType) {
            try {
              xhr.responseType = responseType;
            } catch (e) {
              if (responseType !== 'json') {
                throw e;
              }
            }
          }
          xhr.send(isUndefined(post) ? null : post);
        }
        if (timeout > 0) {
          var timeoutId = $browserDefer(timeoutRequest, timeout);
        } else if (isPromiseLike(timeout)) {
          timeout.then(timeoutRequest);
        }
        function timeoutRequest() {
          jsonpDone && jsonpDone();
          xhr && xhr.abort();
        }
        function completeRequest(callback, status, response, headersString, statusText) {
          if (isDefined(timeoutId)) {
            $browserDefer.cancel(timeoutId);
          }
          jsonpDone = xhr = null;
          callback(status, response, headersString, statusText);
          $browser.$$completeOutstandingRequest(noop);
        }
      };
      function jsonpReq(url, callbackId, done) {
        var script = rawDocument.createElement('script'),
            callback = null;
        script.type = "text/javascript";
        script.src = url;
        script.async = true;
        callback = function(event) {
          removeEventListenerFn(script, "load", callback);
          removeEventListenerFn(script, "error", callback);
          rawDocument.body.removeChild(script);
          script = null;
          var status = -1;
          var text = "unknown";
          if (event) {
            if (event.type === "load" && !callbacks[callbackId].called) {
              event = {type: "error"};
            }
            text = event.type;
            status = event.type === "error" ? 404 : 200;
          }
          if (done) {
            done(status, text);
          }
        };
        addEventListenerFn(script, "load", callback);
        addEventListenerFn(script, "error", callback);
        rawDocument.body.appendChild(script);
        return callback;
      }
    }
    var $interpolateMinErr = angular.$interpolateMinErr = minErr('$interpolate');
    $interpolateMinErr.throwNoconcat = function(text) {
      throw $interpolateMinErr('noconcat', "Error while interpolating: {0}\nStrict Contextual Escaping disallows " + "interpolations that concatenate multiple expressions when a trusted value is " + "required.  See http://docs.angularjs.org/api/ng.$sce", text);
    };
    $interpolateMinErr.interr = function(text, err) {
      return $interpolateMinErr('interr', "Can't interpolate: {0}\n{1}", text, err.toString());
    };
    function $InterpolateProvider() {
      var startSymbol = '{{';
      var endSymbol = '}}';
      this.startSymbol = function(value) {
        if (value) {
          startSymbol = value;
          return this;
        } else {
          return startSymbol;
        }
      };
      this.endSymbol = function(value) {
        if (value) {
          endSymbol = value;
          return this;
        } else {
          return endSymbol;
        }
      };
      this.$get = ['$parse', '$exceptionHandler', '$sce', function($parse, $exceptionHandler, $sce) {
        var startSymbolLength = startSymbol.length,
            endSymbolLength = endSymbol.length,
            escapedStartRegexp = new RegExp(startSymbol.replace(/./g, escape), 'g'),
            escapedEndRegexp = new RegExp(endSymbol.replace(/./g, escape), 'g');
        function escape(ch) {
          return '\\\\\\' + ch;
        }
        function unescapeText(text) {
          return text.replace(escapedStartRegexp, startSymbol).replace(escapedEndRegexp, endSymbol);
        }
        function stringify(value) {
          if (value == null) {
            return '';
          }
          switch (typeof value) {
            case 'string':
              break;
            case 'number':
              value = '' + value;
              break;
            default:
              value = toJson(value);
          }
          return value;
        }
        function $interpolate(text, mustHaveExpression, trustedContext, allOrNothing) {
          allOrNothing = !!allOrNothing;
          var startIndex,
              endIndex,
              index = 0,
              expressions = [],
              parseFns = [],
              textLength = text.length,
              exp,
              concat = [],
              expressionPositions = [];
          while (index < textLength) {
            if (((startIndex = text.indexOf(startSymbol, index)) != -1) && ((endIndex = text.indexOf(endSymbol, startIndex + startSymbolLength)) != -1)) {
              if (index !== startIndex) {
                concat.push(unescapeText(text.substring(index, startIndex)));
              }
              exp = text.substring(startIndex + startSymbolLength, endIndex);
              expressions.push(exp);
              parseFns.push($parse(exp, parseStringifyInterceptor));
              index = endIndex + endSymbolLength;
              expressionPositions.push(concat.length);
              concat.push('');
            } else {
              if (index !== textLength) {
                concat.push(unescapeText(text.substring(index)));
              }
              break;
            }
          }
          if (trustedContext && concat.length > 1) {
            $interpolateMinErr.throwNoconcat(text);
          }
          if (!mustHaveExpression || expressions.length) {
            var compute = function(values) {
              for (var i = 0,
                  ii = expressions.length; i < ii; i++) {
                if (allOrNothing && isUndefined(values[i]))
                  return;
                concat[expressionPositions[i]] = values[i];
              }
              return concat.join('');
            };
            var getValue = function(value) {
              return trustedContext ? $sce.getTrusted(trustedContext, value) : $sce.valueOf(value);
            };
            return extend(function interpolationFn(context) {
              var i = 0;
              var ii = expressions.length;
              var values = new Array(ii);
              try {
                for (; i < ii; i++) {
                  values[i] = parseFns[i](context);
                }
                return compute(values);
              } catch (err) {
                $exceptionHandler($interpolateMinErr.interr(text, err));
              }
            }, {
              exp: text,
              expressions: expressions,
              $$watchDelegate: function(scope, listener) {
                var lastValue;
                return scope.$watchGroup(parseFns, function interpolateFnWatcher(values, oldValues) {
                  var currValue = compute(values);
                  if (isFunction(listener)) {
                    listener.call(this, currValue, values !== oldValues ? lastValue : currValue, scope);
                  }
                  lastValue = currValue;
                });
              }
            });
          }
          function parseStringifyInterceptor(value) {
            try {
              value = getValue(value);
              return allOrNothing && !isDefined(value) ? value : stringify(value);
            } catch (err) {
              $exceptionHandler($interpolateMinErr.interr(text, err));
            }
          }
        }
        $interpolate.startSymbol = function() {
          return startSymbol;
        };
        $interpolate.endSymbol = function() {
          return endSymbol;
        };
        return $interpolate;
      }];
    }
    function $IntervalProvider() {
      this.$get = ['$rootScope', '$window', '$q', '$$q', function($rootScope, $window, $q, $$q) {
        var intervals = {};
        function interval(fn, delay, count, invokeApply) {
          var hasParams = arguments.length > 4,
              args = hasParams ? sliceArgs(arguments, 4) : [],
              setInterval = $window.setInterval,
              clearInterval = $window.clearInterval,
              iteration = 0,
              skipApply = (isDefined(invokeApply) && !invokeApply),
              deferred = (skipApply ? $$q : $q).defer(),
              promise = deferred.promise;
          count = isDefined(count) ? count : 0;
          promise.then(null, null, (!hasParams) ? fn : function() {
            fn.apply(null, args);
          });
          promise.$$intervalId = setInterval(function tick() {
            deferred.notify(iteration++);
            if (count > 0 && iteration >= count) {
              deferred.resolve(iteration);
              clearInterval(promise.$$intervalId);
              delete intervals[promise.$$intervalId];
            }
            if (!skipApply)
              $rootScope.$apply();
          }, delay);
          intervals[promise.$$intervalId] = deferred;
          return promise;
        }
        interval.cancel = function(promise) {
          if (promise && promise.$$intervalId in intervals) {
            intervals[promise.$$intervalId].reject('canceled');
            $window.clearInterval(promise.$$intervalId);
            delete intervals[promise.$$intervalId];
            return true;
          }
          return false;
        };
        return interval;
      }];
    }
    var PATH_MATCH = /^([^\?#]*)(\?([^#]*))?(#(.*))?$/,
        DEFAULT_PORTS = {
          'http': 80,
          'https': 443,
          'ftp': 21
        };
    var $locationMinErr = minErr('$location');
    function encodePath(path) {
      var segments = path.split('/'),
          i = segments.length;
      while (i--) {
        segments[i] = encodeUriSegment(segments[i]);
      }
      return segments.join('/');
    }
    function parseAbsoluteUrl(absoluteUrl, locationObj) {
      var parsedUrl = urlResolve(absoluteUrl);
      locationObj.$$protocol = parsedUrl.protocol;
      locationObj.$$host = parsedUrl.hostname;
      locationObj.$$port = toInt(parsedUrl.port) || DEFAULT_PORTS[parsedUrl.protocol] || null;
    }
    function parseAppUrl(relativeUrl, locationObj) {
      var prefixed = (relativeUrl.charAt(0) !== '/');
      if (prefixed) {
        relativeUrl = '/' + relativeUrl;
      }
      var match = urlResolve(relativeUrl);
      locationObj.$$path = decodeURIComponent(prefixed && match.pathname.charAt(0) === '/' ? match.pathname.substring(1) : match.pathname);
      locationObj.$$search = parseKeyValue(match.search);
      locationObj.$$hash = decodeURIComponent(match.hash);
      if (locationObj.$$path && locationObj.$$path.charAt(0) != '/') {
        locationObj.$$path = '/' + locationObj.$$path;
      }
    }
    function beginsWith(begin, whole) {
      if (whole.indexOf(begin) === 0) {
        return whole.substr(begin.length);
      }
    }
    function stripHash(url) {
      var index = url.indexOf('#');
      return index == -1 ? url : url.substr(0, index);
    }
    function trimEmptyHash(url) {
      return url.replace(/(#.+)|#$/, '$1');
    }
    function stripFile(url) {
      return url.substr(0, stripHash(url).lastIndexOf('/') + 1);
    }
    function serverBase(url) {
      return url.substring(0, url.indexOf('/', url.indexOf('//') + 2));
    }
    function LocationHtml5Url(appBase, appBaseNoFile, basePrefix) {
      this.$$html5 = true;
      basePrefix = basePrefix || '';
      parseAbsoluteUrl(appBase, this);
      this.$$parse = function(url) {
        var pathUrl = beginsWith(appBaseNoFile, url);
        if (!isString(pathUrl)) {
          throw $locationMinErr('ipthprfx', 'Invalid url "{0}", missing path prefix "{1}".', url, appBaseNoFile);
        }
        parseAppUrl(pathUrl, this);
        if (!this.$$path) {
          this.$$path = '/';
        }
        this.$$compose();
      };
      this.$$compose = function() {
        var search = toKeyValue(this.$$search),
            hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
        this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
        this.$$absUrl = appBaseNoFile + this.$$url.substr(1);
      };
      this.$$parseLinkUrl = function(url, relHref) {
        if (relHref && relHref[0] === '#') {
          this.hash(relHref.slice(1));
          return true;
        }
        var appUrl,
            prevAppUrl;
        var rewrittenUrl;
        if (isDefined(appUrl = beginsWith(appBase, url))) {
          prevAppUrl = appUrl;
          if (isDefined(appUrl = beginsWith(basePrefix, appUrl))) {
            rewrittenUrl = appBaseNoFile + (beginsWith('/', appUrl) || appUrl);
          } else {
            rewrittenUrl = appBase + prevAppUrl;
          }
        } else if (isDefined(appUrl = beginsWith(appBaseNoFile, url))) {
          rewrittenUrl = appBaseNoFile + appUrl;
        } else if (appBaseNoFile == url + '/') {
          rewrittenUrl = appBaseNoFile;
        }
        if (rewrittenUrl) {
          this.$$parse(rewrittenUrl);
        }
        return !!rewrittenUrl;
      };
    }
    function LocationHashbangUrl(appBase, appBaseNoFile, hashPrefix) {
      parseAbsoluteUrl(appBase, this);
      this.$$parse = function(url) {
        var withoutBaseUrl = beginsWith(appBase, url) || beginsWith(appBaseNoFile, url);
        var withoutHashUrl;
        if (!isUndefined(withoutBaseUrl) && withoutBaseUrl.charAt(0) === '#') {
          withoutHashUrl = beginsWith(hashPrefix, withoutBaseUrl);
          if (isUndefined(withoutHashUrl)) {
            withoutHashUrl = withoutBaseUrl;
          }
        } else {
          if (this.$$html5) {
            withoutHashUrl = withoutBaseUrl;
          } else {
            withoutHashUrl = '';
            if (isUndefined(withoutBaseUrl)) {
              appBase = url;
              this.replace();
            }
          }
        }
        parseAppUrl(withoutHashUrl, this);
        this.$$path = removeWindowsDriveName(this.$$path, withoutHashUrl, appBase);
        this.$$compose();
        function removeWindowsDriveName(path, url, base) {
          var windowsFilePathExp = /^\/[A-Z]:(\/.*)/;
          var firstPathSegmentMatch;
          if (url.indexOf(base) === 0) {
            url = url.replace(base, '');
          }
          if (windowsFilePathExp.exec(url)) {
            return path;
          }
          firstPathSegmentMatch = windowsFilePathExp.exec(path);
          return firstPathSegmentMatch ? firstPathSegmentMatch[1] : path;
        }
      };
      this.$$compose = function() {
        var search = toKeyValue(this.$$search),
            hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
        this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
        this.$$absUrl = appBase + (this.$$url ? hashPrefix + this.$$url : '');
      };
      this.$$parseLinkUrl = function(url, relHref) {
        if (stripHash(appBase) == stripHash(url)) {
          this.$$parse(url);
          return true;
        }
        return false;
      };
    }
    function LocationHashbangInHtml5Url(appBase, appBaseNoFile, hashPrefix) {
      this.$$html5 = true;
      LocationHashbangUrl.apply(this, arguments);
      this.$$parseLinkUrl = function(url, relHref) {
        if (relHref && relHref[0] === '#') {
          this.hash(relHref.slice(1));
          return true;
        }
        var rewrittenUrl;
        var appUrl;
        if (appBase == stripHash(url)) {
          rewrittenUrl = url;
        } else if ((appUrl = beginsWith(appBaseNoFile, url))) {
          rewrittenUrl = appBase + hashPrefix + appUrl;
        } else if (appBaseNoFile === url + '/') {
          rewrittenUrl = appBaseNoFile;
        }
        if (rewrittenUrl) {
          this.$$parse(rewrittenUrl);
        }
        return !!rewrittenUrl;
      };
      this.$$compose = function() {
        var search = toKeyValue(this.$$search),
            hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
        this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
        this.$$absUrl = appBase + hashPrefix + this.$$url;
      };
    }
    var locationPrototype = {
      $$html5: false,
      $$replace: false,
      absUrl: locationGetter('$$absUrl'),
      url: function(url) {
        if (isUndefined(url)) {
          return this.$$url;
        }
        var match = PATH_MATCH.exec(url);
        if (match[1] || url === '')
          this.path(decodeURIComponent(match[1]));
        if (match[2] || match[1] || url === '')
          this.search(match[3] || '');
        this.hash(match[5] || '');
        return this;
      },
      protocol: locationGetter('$$protocol'),
      host: locationGetter('$$host'),
      port: locationGetter('$$port'),
      path: locationGetterSetter('$$path', function(path) {
        path = path !== null ? path.toString() : '';
        return path.charAt(0) == '/' ? path : '/' + path;
      }),
      search: function(search, paramValue) {
        switch (arguments.length) {
          case 0:
            return this.$$search;
          case 1:
            if (isString(search) || isNumber(search)) {
              search = search.toString();
              this.$$search = parseKeyValue(search);
            } else if (isObject(search)) {
              search = copy(search, {});
              forEach(search, function(value, key) {
                if (value == null)
                  delete search[key];
              });
              this.$$search = search;
            } else {
              throw $locationMinErr('isrcharg', 'The first argument of the `$location#search()` call must be a string or an object.');
            }
            break;
          default:
            if (isUndefined(paramValue) || paramValue === null) {
              delete this.$$search[search];
            } else {
              this.$$search[search] = paramValue;
            }
        }
        this.$$compose();
        return this;
      },
      hash: locationGetterSetter('$$hash', function(hash) {
        return hash !== null ? hash.toString() : '';
      }),
      replace: function() {
        this.$$replace = true;
        return this;
      }
    };
    forEach([LocationHashbangInHtml5Url, LocationHashbangUrl, LocationHtml5Url], function(Location) {
      Location.prototype = Object.create(locationPrototype);
      Location.prototype.state = function(state) {
        if (!arguments.length) {
          return this.$$state;
        }
        if (Location !== LocationHtml5Url || !this.$$html5) {
          throw $locationMinErr('nostate', 'History API state support is available only ' + 'in HTML5 mode and only in browsers supporting HTML5 History API');
        }
        this.$$state = isUndefined(state) ? null : state;
        return this;
      };
    });
    function locationGetter(property) {
      return function() {
        return this[property];
      };
    }
    function locationGetterSetter(property, preprocess) {
      return function(value) {
        if (isUndefined(value)) {
          return this[property];
        }
        this[property] = preprocess(value);
        this.$$compose();
        return this;
      };
    }
    function $LocationProvider() {
      var hashPrefix = '',
          html5Mode = {
            enabled: false,
            requireBase: true,
            rewriteLinks: true
          };
      this.hashPrefix = function(prefix) {
        if (isDefined(prefix)) {
          hashPrefix = prefix;
          return this;
        } else {
          return hashPrefix;
        }
      };
      this.html5Mode = function(mode) {
        if (isBoolean(mode)) {
          html5Mode.enabled = mode;
          return this;
        } else if (isObject(mode)) {
          if (isBoolean(mode.enabled)) {
            html5Mode.enabled = mode.enabled;
          }
          if (isBoolean(mode.requireBase)) {
            html5Mode.requireBase = mode.requireBase;
          }
          if (isBoolean(mode.rewriteLinks)) {
            html5Mode.rewriteLinks = mode.rewriteLinks;
          }
          return this;
        } else {
          return html5Mode;
        }
      };
      this.$get = ['$rootScope', '$browser', '$sniffer', '$rootElement', '$window', function($rootScope, $browser, $sniffer, $rootElement, $window) {
        var $location,
            LocationMode,
            baseHref = $browser.baseHref(),
            initialUrl = $browser.url(),
            appBase;
        if (html5Mode.enabled) {
          if (!baseHref && html5Mode.requireBase) {
            throw $locationMinErr('nobase', "$location in HTML5 mode requires a <base> tag to be present!");
          }
          appBase = serverBase(initialUrl) + (baseHref || '/');
          LocationMode = $sniffer.history ? LocationHtml5Url : LocationHashbangInHtml5Url;
        } else {
          appBase = stripHash(initialUrl);
          LocationMode = LocationHashbangUrl;
        }
        var appBaseNoFile = stripFile(appBase);
        $location = new LocationMode(appBase, appBaseNoFile, '#' + hashPrefix);
        $location.$$parseLinkUrl(initialUrl, initialUrl);
        $location.$$state = $browser.state();
        var IGNORE_URI_REGEXP = /^\s*(javascript|mailto):/i;
        function setBrowserUrlWithFallback(url, replace, state) {
          var oldUrl = $location.url();
          var oldState = $location.$$state;
          try {
            $browser.url(url, replace, state);
            $location.$$state = $browser.state();
          } catch (e) {
            $location.url(oldUrl);
            $location.$$state = oldState;
            throw e;
          }
        }
        $rootElement.on('click', function(event) {
          if (!html5Mode.rewriteLinks || event.ctrlKey || event.metaKey || event.shiftKey || event.which == 2 || event.button == 2)
            return;
          var elm = jqLite(event.target);
          while (nodeName_(elm[0]) !== 'a') {
            if (elm[0] === $rootElement[0] || !(elm = elm.parent())[0])
              return;
          }
          var absHref = elm.prop('href');
          var relHref = elm.attr('href') || elm.attr('xlink:href');
          if (isObject(absHref) && absHref.toString() === '[object SVGAnimatedString]') {
            absHref = urlResolve(absHref.animVal).href;
          }
          if (IGNORE_URI_REGEXP.test(absHref))
            return;
          if (absHref && !elm.attr('target') && !event.isDefaultPrevented()) {
            if ($location.$$parseLinkUrl(absHref, relHref)) {
              event.preventDefault();
              if ($location.absUrl() != $browser.url()) {
                $rootScope.$apply();
                $window.angular['ff-684208-preventDefault'] = true;
              }
            }
          }
        });
        if (trimEmptyHash($location.absUrl()) != trimEmptyHash(initialUrl)) {
          $browser.url($location.absUrl(), true);
        }
        var initializing = true;
        $browser.onUrlChange(function(newUrl, newState) {
          if (isUndefined(beginsWith(appBaseNoFile, newUrl))) {
            $window.location.href = newUrl;
            return;
          }
          $rootScope.$evalAsync(function() {
            var oldUrl = $location.absUrl();
            var oldState = $location.$$state;
            var defaultPrevented;
            $location.$$parse(newUrl);
            $location.$$state = newState;
            defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl, newState, oldState).defaultPrevented;
            if ($location.absUrl() !== newUrl)
              return;
            if (defaultPrevented) {
              $location.$$parse(oldUrl);
              $location.$$state = oldState;
              setBrowserUrlWithFallback(oldUrl, false, oldState);
            } else {
              initializing = false;
              afterLocationChange(oldUrl, oldState);
            }
          });
          if (!$rootScope.$$phase)
            $rootScope.$digest();
        });
        $rootScope.$watch(function $locationWatch() {
          var oldUrl = trimEmptyHash($browser.url());
          var newUrl = trimEmptyHash($location.absUrl());
          var oldState = $browser.state();
          var currentReplace = $location.$$replace;
          var urlOrStateChanged = oldUrl !== newUrl || ($location.$$html5 && $sniffer.history && oldState !== $location.$$state);
          if (initializing || urlOrStateChanged) {
            initializing = false;
            $rootScope.$evalAsync(function() {
              var newUrl = $location.absUrl();
              var defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl, $location.$$state, oldState).defaultPrevented;
              if ($location.absUrl() !== newUrl)
                return;
              if (defaultPrevented) {
                $location.$$parse(oldUrl);
                $location.$$state = oldState;
              } else {
                if (urlOrStateChanged) {
                  setBrowserUrlWithFallback(newUrl, currentReplace, oldState === $location.$$state ? null : $location.$$state);
                }
                afterLocationChange(oldUrl, oldState);
              }
            });
          }
          $location.$$replace = false;
        });
        return $location;
        function afterLocationChange(oldUrl, oldState) {
          $rootScope.$broadcast('$locationChangeSuccess', $location.absUrl(), oldUrl, $location.$$state, oldState);
        }
      }];
    }
    function $LogProvider() {
      var debug = true,
          self = this;
      this.debugEnabled = function(flag) {
        if (isDefined(flag)) {
          debug = flag;
          return this;
        } else {
          return debug;
        }
      };
      this.$get = ['$window', function($window) {
        return {
          log: consoleLog('log'),
          info: consoleLog('info'),
          warn: consoleLog('warn'),
          error: consoleLog('error'),
          debug: (function() {
            var fn = consoleLog('debug');
            return function() {
              if (debug) {
                fn.apply(self, arguments);
              }
            };
          }())
        };
        function formatError(arg) {
          if (arg instanceof Error) {
            if (arg.stack) {
              arg = (arg.message && arg.stack.indexOf(arg.message) === -1) ? 'Error: ' + arg.message + '\n' + arg.stack : arg.stack;
            } else if (arg.sourceURL) {
              arg = arg.message + '\n' + arg.sourceURL + ':' + arg.line;
            }
          }
          return arg;
        }
        function consoleLog(type) {
          var console = $window.console || {},
              logFn = console[type] || console.log || noop,
              hasApply = false;
          try {
            hasApply = !!logFn.apply;
          } catch (e) {}
          if (hasApply) {
            return function() {
              var args = [];
              forEach(arguments, function(arg) {
                args.push(formatError(arg));
              });
              return logFn.apply(console, args);
            };
          }
          return function(arg1, arg2) {
            logFn(arg1, arg2 == null ? '' : arg2);
          };
        }
      }];
    }
    var $parseMinErr = minErr('$parse');
    function ensureSafeMemberName(name, fullExpression) {
      if (name === "__defineGetter__" || name === "__defineSetter__" || name === "__lookupGetter__" || name === "__lookupSetter__" || name === "__proto__") {
        throw $parseMinErr('isecfld', 'Attempting to access a disallowed field in Angular expressions! ' + 'Expression: {0}', fullExpression);
      }
      return name;
    }
    function getStringValue(name, fullExpression) {
      name = name + '';
      if (!isString(name)) {
        throw $parseMinErr('iseccst', 'Cannot convert object to primitive value! ' + 'Expression: {0}', fullExpression);
      }
      return name;
    }
    function ensureSafeObject(obj, fullExpression) {
      if (obj) {
        if (obj.constructor === obj) {
          throw $parseMinErr('isecfn', 'Referencing Function in Angular expressions is disallowed! Expression: {0}', fullExpression);
        } else if (obj.window === obj) {
          throw $parseMinErr('isecwindow', 'Referencing the Window in Angular expressions is disallowed! Expression: {0}', fullExpression);
        } else if (obj.children && (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
          throw $parseMinErr('isecdom', 'Referencing DOM nodes in Angular expressions is disallowed! Expression: {0}', fullExpression);
        } else if (obj === Object) {
          throw $parseMinErr('isecobj', 'Referencing Object in Angular expressions is disallowed! Expression: {0}', fullExpression);
        }
      }
      return obj;
    }
    var CALL = Function.prototype.call;
    var APPLY = Function.prototype.apply;
    var BIND = Function.prototype.bind;
    function ensureSafeFunction(obj, fullExpression) {
      if (obj) {
        if (obj.constructor === obj) {
          throw $parseMinErr('isecfn', 'Referencing Function in Angular expressions is disallowed! Expression: {0}', fullExpression);
        } else if (obj === CALL || obj === APPLY || obj === BIND) {
          throw $parseMinErr('isecff', 'Referencing call, apply or bind in Angular expressions is disallowed! Expression: {0}', fullExpression);
        }
      }
    }
    function ensureSafeAssignContext(obj, fullExpression) {
      if (obj) {
        if (obj === (0).constructor || obj === (false).constructor || obj === ''.constructor || obj === {}.constructor || obj === [].constructor || obj === Function.constructor) {
          throw $parseMinErr('isecaf', 'Assigning to a constructor is disallowed! Expression: {0}', fullExpression);
        }
      }
    }
    var OPERATORS = createMap();
    forEach('+ - * / % === !== == != < > <= >= && || ! = |'.split(' '), function(operator) {
      OPERATORS[operator] = true;
    });
    var ESCAPE = {
      "n": "\n",
      "f": "\f",
      "r": "\r",
      "t": "\t",
      "v": "\v",
      "'": "'",
      '"': '"'
    };
    var Lexer = function(options) {
      this.options = options;
    };
    Lexer.prototype = {
      constructor: Lexer,
      lex: function(text) {
        this.text = text;
        this.index = 0;
        this.tokens = [];
        while (this.index < this.text.length) {
          var ch = this.text.charAt(this.index);
          if (ch === '"' || ch === "'") {
            this.readString(ch);
          } else if (this.isNumber(ch) || ch === '.' && this.isNumber(this.peek())) {
            this.readNumber();
          } else if (this.isIdent(ch)) {
            this.readIdent();
          } else if (this.is(ch, '(){}[].,;:?')) {
            this.tokens.push({
              index: this.index,
              text: ch
            });
            this.index++;
          } else if (this.isWhitespace(ch)) {
            this.index++;
          } else {
            var ch2 = ch + this.peek();
            var ch3 = ch2 + this.peek(2);
            var op1 = OPERATORS[ch];
            var op2 = OPERATORS[ch2];
            var op3 = OPERATORS[ch3];
            if (op1 || op2 || op3) {
              var token = op3 ? ch3 : (op2 ? ch2 : ch);
              this.tokens.push({
                index: this.index,
                text: token,
                operator: true
              });
              this.index += token.length;
            } else {
              this.throwError('Unexpected next character ', this.index, this.index + 1);
            }
          }
        }
        return this.tokens;
      },
      is: function(ch, chars) {
        return chars.indexOf(ch) !== -1;
      },
      peek: function(i) {
        var num = i || 1;
        return (this.index + num < this.text.length) ? this.text.charAt(this.index + num) : false;
      },
      isNumber: function(ch) {
        return ('0' <= ch && ch <= '9') && typeof ch === "string";
      },
      isWhitespace: function(ch) {
        return (ch === ' ' || ch === '\r' || ch === '\t' || ch === '\n' || ch === '\v' || ch === '\u00A0');
      },
      isIdent: function(ch) {
        return ('a' <= ch && ch <= 'z' || 'A' <= ch && ch <= 'Z' || '_' === ch || ch === '$');
      },
      isExpOperator: function(ch) {
        return (ch === '-' || ch === '+' || this.isNumber(ch));
      },
      throwError: function(error, start, end) {
        end = end || this.index;
        var colStr = (isDefined(start) ? 's ' + start + '-' + this.index + ' [' + this.text.substring(start, end) + ']' : ' ' + end);
        throw $parseMinErr('lexerr', 'Lexer Error: {0} at column{1} in expression [{2}].', error, colStr, this.text);
      },
      readNumber: function() {
        var number = '';
        var start = this.index;
        while (this.index < this.text.length) {
          var ch = lowercase(this.text.charAt(this.index));
          if (ch == '.' || this.isNumber(ch)) {
            number += ch;
          } else {
            var peekCh = this.peek();
            if (ch == 'e' && this.isExpOperator(peekCh)) {
              number += ch;
            } else if (this.isExpOperator(ch) && peekCh && this.isNumber(peekCh) && number.charAt(number.length - 1) == 'e') {
              number += ch;
            } else if (this.isExpOperator(ch) && (!peekCh || !this.isNumber(peekCh)) && number.charAt(number.length - 1) == 'e') {
              this.throwError('Invalid exponent');
            } else {
              break;
            }
          }
          this.index++;
        }
        this.tokens.push({
          index: start,
          text: number,
          constant: true,
          value: Number(number)
        });
      },
      readIdent: function() {
        var start = this.index;
        while (this.index < this.text.length) {
          var ch = this.text.charAt(this.index);
          if (!(this.isIdent(ch) || this.isNumber(ch))) {
            break;
          }
          this.index++;
        }
        this.tokens.push({
          index: start,
          text: this.text.slice(start, this.index),
          identifier: true
        });
      },
      readString: function(quote) {
        var start = this.index;
        this.index++;
        var string = '';
        var rawString = quote;
        var escape = false;
        while (this.index < this.text.length) {
          var ch = this.text.charAt(this.index);
          rawString += ch;
          if (escape) {
            if (ch === 'u') {
              var hex = this.text.substring(this.index + 1, this.index + 5);
              if (!hex.match(/[\da-f]{4}/i)) {
                this.throwError('Invalid unicode escape [\\u' + hex + ']');
              }
              this.index += 4;
              string += String.fromCharCode(parseInt(hex, 16));
            } else {
              var rep = ESCAPE[ch];
              string = string + (rep || ch);
            }
            escape = false;
          } else if (ch === '\\') {
            escape = true;
          } else if (ch === quote) {
            this.index++;
            this.tokens.push({
              index: start,
              text: rawString,
              constant: true,
              value: string
            });
            return;
          } else {
            string += ch;
          }
          this.index++;
        }
        this.throwError('Unterminated quote', start);
      }
    };
    var AST = function(lexer, options) {
      this.lexer = lexer;
      this.options = options;
    };
    AST.Program = 'Program';
    AST.ExpressionStatement = 'ExpressionStatement';
    AST.AssignmentExpression = 'AssignmentExpression';
    AST.ConditionalExpression = 'ConditionalExpression';
    AST.LogicalExpression = 'LogicalExpression';
    AST.BinaryExpression = 'BinaryExpression';
    AST.UnaryExpression = 'UnaryExpression';
    AST.CallExpression = 'CallExpression';
    AST.MemberExpression = 'MemberExpression';
    AST.Identifier = 'Identifier';
    AST.Literal = 'Literal';
    AST.ArrayExpression = 'ArrayExpression';
    AST.Property = 'Property';
    AST.ObjectExpression = 'ObjectExpression';
    AST.ThisExpression = 'ThisExpression';
    AST.NGValueParameter = 'NGValueParameter';
    AST.prototype = {
      ast: function(text) {
        this.text = text;
        this.tokens = this.lexer.lex(text);
        var value = this.program();
        if (this.tokens.length !== 0) {
          this.throwError('is an unexpected token', this.tokens[0]);
        }
        return value;
      },
      program: function() {
        var body = [];
        while (true) {
          if (this.tokens.length > 0 && !this.peek('}', ')', ';', ']'))
            body.push(this.expressionStatement());
          if (!this.expect(';')) {
            return {
              type: AST.Program,
              body: body
            };
          }
        }
      },
      expressionStatement: function() {
        return {
          type: AST.ExpressionStatement,
          expression: this.filterChain()
        };
      },
      filterChain: function() {
        var left = this.expression();
        var token;
        while ((token = this.expect('|'))) {
          left = this.filter(left);
        }
        return left;
      },
      expression: function() {
        return this.assignment();
      },
      assignment: function() {
        var result = this.ternary();
        if (this.expect('=')) {
          result = {
            type: AST.AssignmentExpression,
            left: result,
            right: this.assignment(),
            operator: '='
          };
        }
        return result;
      },
      ternary: function() {
        var test = this.logicalOR();
        var alternate;
        var consequent;
        if (this.expect('?')) {
          alternate = this.expression();
          if (this.consume(':')) {
            consequent = this.expression();
            return {
              type: AST.ConditionalExpression,
              test: test,
              alternate: alternate,
              consequent: consequent
            };
          }
        }
        return test;
      },
      logicalOR: function() {
        var left = this.logicalAND();
        while (this.expect('||')) {
          left = {
            type: AST.LogicalExpression,
            operator: '||',
            left: left,
            right: this.logicalAND()
          };
        }
        return left;
      },
      logicalAND: function() {
        var left = this.equality();
        while (this.expect('&&')) {
          left = {
            type: AST.LogicalExpression,
            operator: '&&',
            left: left,
            right: this.equality()
          };
        }
        return left;
      },
      equality: function() {
        var left = this.relational();
        var token;
        while ((token = this.expect('==', '!=', '===', '!=='))) {
          left = {
            type: AST.BinaryExpression,
            operator: token.text,
            left: left,
            right: this.relational()
          };
        }
        return left;
      },
      relational: function() {
        var left = this.additive();
        var token;
        while ((token = this.expect('<', '>', '<=', '>='))) {
          left = {
            type: AST.BinaryExpression,
            operator: token.text,
            left: left,
            right: this.additive()
          };
        }
        return left;
      },
      additive: function() {
        var left = this.multiplicative();
        var token;
        while ((token = this.expect('+', '-'))) {
          left = {
            type: AST.BinaryExpression,
            operator: token.text,
            left: left,
            right: this.multiplicative()
          };
        }
        return left;
      },
      multiplicative: function() {
        var left = this.unary();
        var token;
        while ((token = this.expect('*', '/', '%'))) {
          left = {
            type: AST.BinaryExpression,
            operator: token.text,
            left: left,
            right: this.unary()
          };
        }
        return left;
      },
      unary: function() {
        var token;
        if ((token = this.expect('+', '-', '!'))) {
          return {
            type: AST.UnaryExpression,
            operator: token.text,
            prefix: true,
            argument: this.unary()
          };
        } else {
          return this.primary();
        }
      },
      primary: function() {
        var primary;
        if (this.expect('(')) {
          primary = this.filterChain();
          this.consume(')');
        } else if (this.expect('[')) {
          primary = this.arrayDeclaration();
        } else if (this.expect('{')) {
          primary = this.object();
        } else if (this.constants.hasOwnProperty(this.peek().text)) {
          primary = copy(this.constants[this.consume().text]);
        } else if (this.peek().identifier) {
          primary = this.identifier();
        } else if (this.peek().constant) {
          primary = this.constant();
        } else {
          this.throwError('not a primary expression', this.peek());
        }
        var next;
        while ((next = this.expect('(', '[', '.'))) {
          if (next.text === '(') {
            primary = {
              type: AST.CallExpression,
              callee: primary,
              arguments: this.parseArguments()
            };
            this.consume(')');
          } else if (next.text === '[') {
            primary = {
              type: AST.MemberExpression,
              object: primary,
              property: this.expression(),
              computed: true
            };
            this.consume(']');
          } else if (next.text === '.') {
            primary = {
              type: AST.MemberExpression,
              object: primary,
              property: this.identifier(),
              computed: false
            };
          } else {
            this.throwError('IMPOSSIBLE');
          }
        }
        return primary;
      },
      filter: function(baseExpression) {
        var args = [baseExpression];
        var result = {
          type: AST.CallExpression,
          callee: this.identifier(),
          arguments: args,
          filter: true
        };
        while (this.expect(':')) {
          args.push(this.expression());
        }
        return result;
      },
      parseArguments: function() {
        var args = [];
        if (this.peekToken().text !== ')') {
          do {
            args.push(this.expression());
          } while (this.expect(','));
        }
        return args;
      },
      identifier: function() {
        var token = this.consume();
        if (!token.identifier) {
          this.throwError('is not a valid identifier', token);
        }
        return {
          type: AST.Identifier,
          name: token.text
        };
      },
      constant: function() {
        return {
          type: AST.Literal,
          value: this.consume().value
        };
      },
      arrayDeclaration: function() {
        var elements = [];
        if (this.peekToken().text !== ']') {
          do {
            if (this.peek(']')) {
              break;
            }
            elements.push(this.expression());
          } while (this.expect(','));
        }
        this.consume(']');
        return {
          type: AST.ArrayExpression,
          elements: elements
        };
      },
      object: function() {
        var properties = [],
            property;
        if (this.peekToken().text !== '}') {
          do {
            if (this.peek('}')) {
              break;
            }
            property = {
              type: AST.Property,
              kind: 'init'
            };
            if (this.peek().constant) {
              property.key = this.constant();
            } else if (this.peek().identifier) {
              property.key = this.identifier();
            } else {
              this.throwError("invalid key", this.peek());
            }
            this.consume(':');
            property.value = this.expression();
            properties.push(property);
          } while (this.expect(','));
        }
        this.consume('}');
        return {
          type: AST.ObjectExpression,
          properties: properties
        };
      },
      throwError: function(msg, token) {
        throw $parseMinErr('syntax', 'Syntax Error: Token \'{0}\' {1} at column {2} of the expression [{3}] starting at [{4}].', token.text, msg, (token.index + 1), this.text, this.text.substring(token.index));
      },
      consume: function(e1) {
        if (this.tokens.length === 0) {
          throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
        }
        var token = this.expect(e1);
        if (!token) {
          this.throwError('is unexpected, expecting [' + e1 + ']', this.peek());
        }
        return token;
      },
      peekToken: function() {
        if (this.tokens.length === 0) {
          throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
        }
        return this.tokens[0];
      },
      peek: function(e1, e2, e3, e4) {
        return this.peekAhead(0, e1, e2, e3, e4);
      },
      peekAhead: function(i, e1, e2, e3, e4) {
        if (this.tokens.length > i) {
          var token = this.tokens[i];
          var t = token.text;
          if (t === e1 || t === e2 || t === e3 || t === e4 || (!e1 && !e2 && !e3 && !e4)) {
            return token;
          }
        }
        return false;
      },
      expect: function(e1, e2, e3, e4) {
        var token = this.peek(e1, e2, e3, e4);
        if (token) {
          this.tokens.shift();
          return token;
        }
        return false;
      },
      constants: {
        'true': {
          type: AST.Literal,
          value: true
        },
        'false': {
          type: AST.Literal,
          value: false
        },
        'null': {
          type: AST.Literal,
          value: null
        },
        'undefined': {
          type: AST.Literal,
          value: undefined
        },
        'this': {type: AST.ThisExpression}
      }
    };
    function ifDefined(v, d) {
      return typeof v !== 'undefined' ? v : d;
    }
    function plusFn(l, r) {
      if (typeof l === 'undefined')
        return r;
      if (typeof r === 'undefined')
        return l;
      return l + r;
    }
    function isStateless($filter, filterName) {
      var fn = $filter(filterName);
      return !fn.$stateful;
    }
    function findConstantAndWatchExpressions(ast, $filter) {
      var allConstants;
      var argsToWatch;
      switch (ast.type) {
        case AST.Program:
          allConstants = true;
          forEach(ast.body, function(expr) {
            findConstantAndWatchExpressions(expr.expression, $filter);
            allConstants = allConstants && expr.expression.constant;
          });
          ast.constant = allConstants;
          break;
        case AST.Literal:
          ast.constant = true;
          ast.toWatch = [];
          break;
        case AST.UnaryExpression:
          findConstantAndWatchExpressions(ast.argument, $filter);
          ast.constant = ast.argument.constant;
          ast.toWatch = ast.argument.toWatch;
          break;
        case AST.BinaryExpression:
          findConstantAndWatchExpressions(ast.left, $filter);
          findConstantAndWatchExpressions(ast.right, $filter);
          ast.constant = ast.left.constant && ast.right.constant;
          ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch);
          break;
        case AST.LogicalExpression:
          findConstantAndWatchExpressions(ast.left, $filter);
          findConstantAndWatchExpressions(ast.right, $filter);
          ast.constant = ast.left.constant && ast.right.constant;
          ast.toWatch = ast.constant ? [] : [ast];
          break;
        case AST.ConditionalExpression:
          findConstantAndWatchExpressions(ast.test, $filter);
          findConstantAndWatchExpressions(ast.alternate, $filter);
          findConstantAndWatchExpressions(ast.consequent, $filter);
          ast.constant = ast.test.constant && ast.alternate.constant && ast.consequent.constant;
          ast.toWatch = ast.constant ? [] : [ast];
          break;
        case AST.Identifier:
          ast.constant = false;
          ast.toWatch = [ast];
          break;
        case AST.MemberExpression:
          findConstantAndWatchExpressions(ast.object, $filter);
          if (ast.computed) {
            findConstantAndWatchExpressions(ast.property, $filter);
          }
          ast.constant = ast.object.constant && (!ast.computed || ast.property.constant);
          ast.toWatch = [ast];
          break;
        case AST.CallExpression:
          allConstants = ast.filter ? isStateless($filter, ast.callee.name) : false;
          argsToWatch = [];
          forEach(ast.arguments, function(expr) {
            findConstantAndWatchExpressions(expr, $filter);
            allConstants = allConstants && expr.constant;
            if (!expr.constant) {
              argsToWatch.push.apply(argsToWatch, expr.toWatch);
            }
          });
          ast.constant = allConstants;
          ast.toWatch = ast.filter && isStateless($filter, ast.callee.name) ? argsToWatch : [ast];
          break;
        case AST.AssignmentExpression:
          findConstantAndWatchExpressions(ast.left, $filter);
          findConstantAndWatchExpressions(ast.right, $filter);
          ast.constant = ast.left.constant && ast.right.constant;
          ast.toWatch = [ast];
          break;
        case AST.ArrayExpression:
          allConstants = true;
          argsToWatch = [];
          forEach(ast.elements, function(expr) {
            findConstantAndWatchExpressions(expr, $filter);
            allConstants = allConstants && expr.constant;
            if (!expr.constant) {
              argsToWatch.push.apply(argsToWatch, expr.toWatch);
            }
          });
          ast.constant = allConstants;
          ast.toWatch = argsToWatch;
          break;
        case AST.ObjectExpression:
          allConstants = true;
          argsToWatch = [];
          forEach(ast.properties, function(property) {
            findConstantAndWatchExpressions(property.value, $filter);
            allConstants = allConstants && property.value.constant;
            if (!property.value.constant) {
              argsToWatch.push.apply(argsToWatch, property.value.toWatch);
            }
          });
          ast.constant = allConstants;
          ast.toWatch = argsToWatch;
          break;
        case AST.ThisExpression:
          ast.constant = false;
          ast.toWatch = [];
          break;
      }
    }
    function getInputs(body) {
      if (body.length != 1)
        return;
      var lastExpression = body[0].expression;
      var candidate = lastExpression.toWatch;
      if (candidate.length !== 1)
        return candidate;
      return candidate[0] !== lastExpression ? candidate : undefined;
    }
    function isAssignable(ast) {
      return ast.type === AST.Identifier || ast.type === AST.MemberExpression;
    }
    function assignableAST(ast) {
      if (ast.body.length === 1 && isAssignable(ast.body[0].expression)) {
        return {
          type: AST.AssignmentExpression,
          left: ast.body[0].expression,
          right: {type: AST.NGValueParameter},
          operator: '='
        };
      }
    }
    function isLiteral(ast) {
      return ast.body.length === 0 || ast.body.length === 1 && (ast.body[0].expression.type === AST.Literal || ast.body[0].expression.type === AST.ArrayExpression || ast.body[0].expression.type === AST.ObjectExpression);
    }
    function isConstant(ast) {
      return ast.constant;
    }
    function ASTCompiler(astBuilder, $filter) {
      this.astBuilder = astBuilder;
      this.$filter = $filter;
    }
    ASTCompiler.prototype = {
      compile: function(expression, expensiveChecks) {
        var self = this;
        var ast = this.astBuilder.ast(expression);
        this.state = {
          nextId: 0,
          filters: {},
          expensiveChecks: expensiveChecks,
          fn: {
            vars: [],
            body: [],
            own: {}
          },
          assign: {
            vars: [],
            body: [],
            own: {}
          },
          inputs: []
        };
        findConstantAndWatchExpressions(ast, self.$filter);
        var extra = '';
        var assignable;
        this.stage = 'assign';
        if ((assignable = assignableAST(ast))) {
          this.state.computing = 'assign';
          var result = this.nextId();
          this.recurse(assignable, result);
          this.return_(result);
          extra = 'fn.assign=' + this.generateFunction('assign', 's,v,l');
        }
        var toWatch = getInputs(ast.body);
        self.stage = 'inputs';
        forEach(toWatch, function(watch, key) {
          var fnKey = 'fn' + key;
          self.state[fnKey] = {
            vars: [],
            body: [],
            own: {}
          };
          self.state.computing = fnKey;
          var intoId = self.nextId();
          self.recurse(watch, intoId);
          self.return_(intoId);
          self.state.inputs.push(fnKey);
          watch.watchId = key;
        });
        this.state.computing = 'fn';
        this.stage = 'main';
        this.recurse(ast);
        var fnString = '"' + this.USE + ' ' + this.STRICT + '";\n' + this.filterPrefix() + 'var fn=' + this.generateFunction('fn', 's,l,a,i') + extra + this.watchFns() + 'return fn;';
        var fn = (new Function('$filter', 'ensureSafeMemberName', 'ensureSafeObject', 'ensureSafeFunction', 'getStringValue', 'ensureSafeAssignContext', 'ifDefined', 'plus', 'text', fnString))(this.$filter, ensureSafeMemberName, ensureSafeObject, ensureSafeFunction, getStringValue, ensureSafeAssignContext, ifDefined, plusFn, expression);
        this.state = this.stage = undefined;
        fn.literal = isLiteral(ast);
        fn.constant = isConstant(ast);
        return fn;
      },
      USE: 'use',
      STRICT: 'strict',
      watchFns: function() {
        var result = [];
        var fns = this.state.inputs;
        var self = this;
        forEach(fns, function(name) {
          result.push('var ' + name + '=' + self.generateFunction(name, 's'));
        });
        if (fns.length) {
          result.push('fn.inputs=[' + fns.join(',') + '];');
        }
        return result.join('');
      },
      generateFunction: function(name, params) {
        return 'function(' + params + '){' + this.varsPrefix(name) + this.body(name) + '};';
      },
      filterPrefix: function() {
        var parts = [];
        var self = this;
        forEach(this.state.filters, function(id, filter) {
          parts.push(id + '=$filter(' + self.escape(filter) + ')');
        });
        if (parts.length)
          return 'var ' + parts.join(',') + ';';
        return '';
      },
      varsPrefix: function(section) {
        return this.state[section].vars.length ? 'var ' + this.state[section].vars.join(',') + ';' : '';
      },
      body: function(section) {
        return this.state[section].body.join('');
      },
      recurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
        var left,
            right,
            self = this,
            args,
            expression;
        recursionFn = recursionFn || noop;
        if (!skipWatchIdCheck && isDefined(ast.watchId)) {
          intoId = intoId || this.nextId();
          this.if_('i', this.lazyAssign(intoId, this.computedMember('i', ast.watchId)), this.lazyRecurse(ast, intoId, nameId, recursionFn, create, true));
          return;
        }
        switch (ast.type) {
          case AST.Program:
            forEach(ast.body, function(expression, pos) {
              self.recurse(expression.expression, undefined, undefined, function(expr) {
                right = expr;
              });
              if (pos !== ast.body.length - 1) {
                self.current().body.push(right, ';');
              } else {
                self.return_(right);
              }
            });
            break;
          case AST.Literal:
            expression = this.escape(ast.value);
            this.assign(intoId, expression);
            recursionFn(expression);
            break;
          case AST.UnaryExpression:
            this.recurse(ast.argument, undefined, undefined, function(expr) {
              right = expr;
            });
            expression = ast.operator + '(' + this.ifDefined(right, 0) + ')';
            this.assign(intoId, expression);
            recursionFn(expression);
            break;
          case AST.BinaryExpression:
            this.recurse(ast.left, undefined, undefined, function(expr) {
              left = expr;
            });
            this.recurse(ast.right, undefined, undefined, function(expr) {
              right = expr;
            });
            if (ast.operator === '+') {
              expression = this.plus(left, right);
            } else if (ast.operator === '-') {
              expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0);
            } else {
              expression = '(' + left + ')' + ast.operator + '(' + right + ')';
            }
            this.assign(intoId, expression);
            recursionFn(expression);
            break;
          case AST.LogicalExpression:
            intoId = intoId || this.nextId();
            self.recurse(ast.left, intoId);
            self.if_(ast.operator === '&&' ? intoId : self.not(intoId), self.lazyRecurse(ast.right, intoId));
            recursionFn(intoId);
            break;
          case AST.ConditionalExpression:
            intoId = intoId || this.nextId();
            self.recurse(ast.test, intoId);
            self.if_(intoId, self.lazyRecurse(ast.alternate, intoId), self.lazyRecurse(ast.consequent, intoId));
            recursionFn(intoId);
            break;
          case AST.Identifier:
            intoId = intoId || this.nextId();
            if (nameId) {
              nameId.context = self.stage === 'inputs' ? 's' : this.assign(this.nextId(), this.getHasOwnProperty('l', ast.name) + '?l:s');
              nameId.computed = false;
              nameId.name = ast.name;
            }
            ensureSafeMemberName(ast.name);
            self.if_(self.stage === 'inputs' || self.not(self.getHasOwnProperty('l', ast.name)), function() {
              self.if_(self.stage === 'inputs' || 's', function() {
                if (create && create !== 1) {
                  self.if_(self.not(self.nonComputedMember('s', ast.name)), self.lazyAssign(self.nonComputedMember('s', ast.name), '{}'));
                }
                self.assign(intoId, self.nonComputedMember('s', ast.name));
              });
            }, intoId && self.lazyAssign(intoId, self.nonComputedMember('l', ast.name)));
            if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.name)) {
              self.addEnsureSafeObject(intoId);
            }
            recursionFn(intoId);
            break;
          case AST.MemberExpression:
            left = nameId && (nameId.context = this.nextId()) || this.nextId();
            intoId = intoId || this.nextId();
            self.recurse(ast.object, left, undefined, function() {
              self.if_(self.notNull(left), function() {
                if (ast.computed) {
                  right = self.nextId();
                  self.recurse(ast.property, right);
                  self.getStringValue(right);
                  self.addEnsureSafeMemberName(right);
                  if (create && create !== 1) {
                    self.if_(self.not(self.computedMember(left, right)), self.lazyAssign(self.computedMember(left, right), '{}'));
                  }
                  expression = self.ensureSafeObject(self.computedMember(left, right));
                  self.assign(intoId, expression);
                  if (nameId) {
                    nameId.computed = true;
                    nameId.name = right;
                  }
                } else {
                  ensureSafeMemberName(ast.property.name);
                  if (create && create !== 1) {
                    self.if_(self.not(self.nonComputedMember(left, ast.property.name)), self.lazyAssign(self.nonComputedMember(left, ast.property.name), '{}'));
                  }
                  expression = self.nonComputedMember(left, ast.property.name);
                  if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.property.name)) {
                    expression = self.ensureSafeObject(expression);
                  }
                  self.assign(intoId, expression);
                  if (nameId) {
                    nameId.computed = false;
                    nameId.name = ast.property.name;
                  }
                }
              }, function() {
                self.assign(intoId, 'undefined');
              });
              recursionFn(intoId);
            }, !!create);
            break;
          case AST.CallExpression:
            intoId = intoId || this.nextId();
            if (ast.filter) {
              right = self.filter(ast.callee.name);
              args = [];
              forEach(ast.arguments, function(expr) {
                var argument = self.nextId();
                self.recurse(expr, argument);
                args.push(argument);
              });
              expression = right + '(' + args.join(',') + ')';
              self.assign(intoId, expression);
              recursionFn(intoId);
            } else {
              right = self.nextId();
              left = {};
              args = [];
              self.recurse(ast.callee, right, left, function() {
                self.if_(self.notNull(right), function() {
                  self.addEnsureSafeFunction(right);
                  forEach(ast.arguments, function(expr) {
                    self.recurse(expr, self.nextId(), undefined, function(argument) {
                      args.push(self.ensureSafeObject(argument));
                    });
                  });
                  if (left.name) {
                    if (!self.state.expensiveChecks) {
                      self.addEnsureSafeObject(left.context);
                    }
                    expression = self.member(left.context, left.name, left.computed) + '(' + args.join(',') + ')';
                  } else {
                    expression = right + '(' + args.join(',') + ')';
                  }
                  expression = self.ensureSafeObject(expression);
                  self.assign(intoId, expression);
                }, function() {
                  self.assign(intoId, 'undefined');
                });
                recursionFn(intoId);
              });
            }
            break;
          case AST.AssignmentExpression:
            right = this.nextId();
            left = {};
            if (!isAssignable(ast.left)) {
              throw $parseMinErr('lval', 'Trying to assing a value to a non l-value');
            }
            this.recurse(ast.left, undefined, left, function() {
              self.if_(self.notNull(left.context), function() {
                self.recurse(ast.right, right);
                self.addEnsureSafeObject(self.member(left.context, left.name, left.computed));
                self.addEnsureSafeAssignContext(left.context);
                expression = self.member(left.context, left.name, left.computed) + ast.operator + right;
                self.assign(intoId, expression);
                recursionFn(intoId || expression);
              });
            }, 1);
            break;
          case AST.ArrayExpression:
            args = [];
            forEach(ast.elements, function(expr) {
              self.recurse(expr, self.nextId(), undefined, function(argument) {
                args.push(argument);
              });
            });
            expression = '[' + args.join(',') + ']';
            this.assign(intoId, expression);
            recursionFn(expression);
            break;
          case AST.ObjectExpression:
            args = [];
            forEach(ast.properties, function(property) {
              self.recurse(property.value, self.nextId(), undefined, function(expr) {
                args.push(self.escape(property.key.type === AST.Identifier ? property.key.name : ('' + property.key.value)) + ':' + expr);
              });
            });
            expression = '{' + args.join(',') + '}';
            this.assign(intoId, expression);
            recursionFn(expression);
            break;
          case AST.ThisExpression:
            this.assign(intoId, 's');
            recursionFn('s');
            break;
          case AST.NGValueParameter:
            this.assign(intoId, 'v');
            recursionFn('v');
            break;
        }
      },
      getHasOwnProperty: function(element, property) {
        var key = element + '.' + property;
        var own = this.current().own;
        if (!own.hasOwnProperty(key)) {
          own[key] = this.nextId(false, element + '&&(' + this.escape(property) + ' in ' + element + ')');
        }
        return own[key];
      },
      assign: function(id, value) {
        if (!id)
          return;
        this.current().body.push(id, '=', value, ';');
        return id;
      },
      filter: function(filterName) {
        if (!this.state.filters.hasOwnProperty(filterName)) {
          this.state.filters[filterName] = this.nextId(true);
        }
        return this.state.filters[filterName];
      },
      ifDefined: function(id, defaultValue) {
        return 'ifDefined(' + id + ',' + this.escape(defaultValue) + ')';
      },
      plus: function(left, right) {
        return 'plus(' + left + ',' + right + ')';
      },
      return_: function(id) {
        this.current().body.push('return ', id, ';');
      },
      if_: function(test, alternate, consequent) {
        if (test === true) {
          alternate();
        } else {
          var body = this.current().body;
          body.push('if(', test, '){');
          alternate();
          body.push('}');
          if (consequent) {
            body.push('else{');
            consequent();
            body.push('}');
          }
        }
      },
      not: function(expression) {
        return '!(' + expression + ')';
      },
      notNull: function(expression) {
        return expression + '!=null';
      },
      nonComputedMember: function(left, right) {
        return left + '.' + right;
      },
      computedMember: function(left, right) {
        return left + '[' + right + ']';
      },
      member: function(left, right, computed) {
        if (computed)
          return this.computedMember(left, right);
        return this.nonComputedMember(left, right);
      },
      addEnsureSafeObject: function(item) {
        this.current().body.push(this.ensureSafeObject(item), ';');
      },
      addEnsureSafeMemberName: function(item) {
        this.current().body.push(this.ensureSafeMemberName(item), ';');
      },
      addEnsureSafeFunction: function(item) {
        this.current().body.push(this.ensureSafeFunction(item), ';');
      },
      addEnsureSafeAssignContext: function(item) {
        this.current().body.push(this.ensureSafeAssignContext(item), ';');
      },
      ensureSafeObject: function(item) {
        return 'ensureSafeObject(' + item + ',text)';
      },
      ensureSafeMemberName: function(item) {
        return 'ensureSafeMemberName(' + item + ',text)';
      },
      ensureSafeFunction: function(item) {
        return 'ensureSafeFunction(' + item + ',text)';
      },
      getStringValue: function(item) {
        this.assign(item, 'getStringValue(' + item + ',text)');
      },
      ensureSafeAssignContext: function(item) {
        return 'ensureSafeAssignContext(' + item + ',text)';
      },
      lazyRecurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
        var self = this;
        return function() {
          self.recurse(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck);
        };
      },
      lazyAssign: function(id, value) {
        var self = this;
        return function() {
          self.assign(id, value);
        };
      },
      stringEscapeRegex: /[^ a-zA-Z0-9]/g,
      stringEscapeFn: function(c) {
        return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
      },
      escape: function(value) {
        if (isString(value))
          return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'";
        if (isNumber(value))
          return value.toString();
        if (value === true)
          return 'true';
        if (value === false)
          return 'false';
        if (value === null)
          return 'null';
        if (typeof value === 'undefined')
          return 'undefined';
        throw $parseMinErr('esc', 'IMPOSSIBLE');
      },
      nextId: function(skip, init) {
        var id = 'v' + (this.state.nextId++);
        if (!skip) {
          this.current().vars.push(id + (init ? '=' + init : ''));
        }
        return id;
      },
      current: function() {
        return this.state[this.state.computing];
      }
    };
    function ASTInterpreter(astBuilder, $filter) {
      this.astBuilder = astBuilder;
      this.$filter = $filter;
    }
    ASTInterpreter.prototype = {
      compile: function(expression, expensiveChecks) {
        var self = this;
        var ast = this.astBuilder.ast(expression);
        this.expression = expression;
        this.expensiveChecks = expensiveChecks;
        findConstantAndWatchExpressions(ast, self.$filter);
        var assignable;
        var assign;
        if ((assignable = assignableAST(ast))) {
          assign = this.recurse(assignable);
        }
        var toWatch = getInputs(ast.body);
        var inputs;
        if (toWatch) {
          inputs = [];
          forEach(toWatch, function(watch, key) {
            var input = self.recurse(watch);
            watch.input = input;
            inputs.push(input);
            watch.watchId = key;
          });
        }
        var expressions = [];
        forEach(ast.body, function(expression) {
          expressions.push(self.recurse(expression.expression));
        });
        var fn = ast.body.length === 0 ? function() {} : ast.body.length === 1 ? expressions[0] : function(scope, locals) {
          var lastValue;
          forEach(expressions, function(exp) {
            lastValue = exp(scope, locals);
          });
          return lastValue;
        };
        if (assign) {
          fn.assign = function(scope, value, locals) {
            return assign(scope, locals, value);
          };
        }
        if (inputs) {
          fn.inputs = inputs;
        }
        fn.literal = isLiteral(ast);
        fn.constant = isConstant(ast);
        return fn;
      },
      recurse: function(ast, context, create) {
        var left,
            right,
            self = this,
            args,
            expression;
        if (ast.input) {
          return this.inputs(ast.input, ast.watchId);
        }
        switch (ast.type) {
          case AST.Literal:
            return this.value(ast.value, context);
          case AST.UnaryExpression:
            right = this.recurse(ast.argument);
            return this['unary' + ast.operator](right, context);
          case AST.BinaryExpression:
            left = this.recurse(ast.left);
            right = this.recurse(ast.right);
            return this['binary' + ast.operator](left, right, context);
          case AST.LogicalExpression:
            left = this.recurse(ast.left);
            right = this.recurse(ast.right);
            return this['binary' + ast.operator](left, right, context);
          case AST.ConditionalExpression:
            return this['ternary?:'](this.recurse(ast.test), this.recurse(ast.alternate), this.recurse(ast.consequent), context);
          case AST.Identifier:
            ensureSafeMemberName(ast.name, self.expression);
            return self.identifier(ast.name, self.expensiveChecks || isPossiblyDangerousMemberName(ast.name), context, create, self.expression);
          case AST.MemberExpression:
            left = this.recurse(ast.object, false, !!create);
            if (!ast.computed) {
              ensureSafeMemberName(ast.property.name, self.expression);
              right = ast.property.name;
            }
            if (ast.computed)
              right = this.recurse(ast.property);
            return ast.computed ? this.computedMember(left, right, context, create, self.expression) : this.nonComputedMember(left, right, self.expensiveChecks, context, create, self.expression);
          case AST.CallExpression:
            args = [];
            forEach(ast.arguments, function(expr) {
              args.push(self.recurse(expr));
            });
            if (ast.filter)
              right = this.$filter(ast.callee.name);
            if (!ast.filter)
              right = this.recurse(ast.callee, true);
            return ast.filter ? function(scope, locals, assign, inputs) {
              var values = [];
              for (var i = 0; i < args.length; ++i) {
                values.push(args[i](scope, locals, assign, inputs));
              }
              var value = right.apply(undefined, values, inputs);
              return context ? {
                context: undefined,
                name: undefined,
                value: value
              } : value;
            } : function(scope, locals, assign, inputs) {
              var rhs = right(scope, locals, assign, inputs);
              var value;
              if (rhs.value != null) {
                ensureSafeObject(rhs.context, self.expression);
                ensureSafeFunction(rhs.value, self.expression);
                var values = [];
                for (var i = 0; i < args.length; ++i) {
                  values.push(ensureSafeObject(args[i](scope, locals, assign, inputs), self.expression));
                }
                value = ensureSafeObject(rhs.value.apply(rhs.context, values), self.expression);
              }
              return context ? {value: value} : value;
            };
          case AST.AssignmentExpression:
            left = this.recurse(ast.left, true, 1);
            right = this.recurse(ast.right);
            return function(scope, locals, assign, inputs) {
              var lhs = left(scope, locals, assign, inputs);
              var rhs = right(scope, locals, assign, inputs);
              ensureSafeObject(lhs.value, self.expression);
              ensureSafeAssignContext(lhs.context);
              lhs.context[lhs.name] = rhs;
              return context ? {value: rhs} : rhs;
            };
          case AST.ArrayExpression:
            args = [];
            forEach(ast.elements, function(expr) {
              args.push(self.recurse(expr));
            });
            return function(scope, locals, assign, inputs) {
              var value = [];
              for (var i = 0; i < args.length; ++i) {
                value.push(args[i](scope, locals, assign, inputs));
              }
              return context ? {value: value} : value;
            };
          case AST.ObjectExpression:
            args = [];
            forEach(ast.properties, function(property) {
              args.push({
                key: property.key.type === AST.Identifier ? property.key.name : ('' + property.key.value),
                value: self.recurse(property.value)
              });
            });
            return function(scope, locals, assign, inputs) {
              var value = {};
              for (var i = 0; i < args.length; ++i) {
                value[args[i].key] = args[i].value(scope, locals, assign, inputs);
              }
              return context ? {value: value} : value;
            };
          case AST.ThisExpression:
            return function(scope) {
              return context ? {value: scope} : scope;
            };
          case AST.NGValueParameter:
            return function(scope, locals, assign, inputs) {
              return context ? {value: assign} : assign;
            };
        }
      },
      'unary+': function(argument, context) {
        return function(scope, locals, assign, inputs) {
          var arg = argument(scope, locals, assign, inputs);
          if (isDefined(arg)) {
            arg = +arg;
          } else {
            arg = 0;
          }
          return context ? {value: arg} : arg;
        };
      },
      'unary-': function(argument, context) {
        return function(scope, locals, assign, inputs) {
          var arg = argument(scope, locals, assign, inputs);
          if (isDefined(arg)) {
            arg = -arg;
          } else {
            arg = 0;
          }
          return context ? {value: arg} : arg;
        };
      },
      'unary!': function(argument, context) {
        return function(scope, locals, assign, inputs) {
          var arg = !argument(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary+': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var lhs = left(scope, locals, assign, inputs);
          var rhs = right(scope, locals, assign, inputs);
          var arg = plusFn(lhs, rhs);
          return context ? {value: arg} : arg;
        };
      },
      'binary-': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var lhs = left(scope, locals, assign, inputs);
          var rhs = right(scope, locals, assign, inputs);
          var arg = (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0);
          return context ? {value: arg} : arg;
        };
      },
      'binary*': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) * right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary/': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) / right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary%': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) % right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary===': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) === right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary!==': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) !== right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary==': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) == right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary!=': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) != right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary<': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) < right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary>': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) > right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary<=': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) <= right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary>=': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) >= right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary&&': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) && right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'binary||': function(left, right, context) {
        return function(scope, locals, assign, inputs) {
          var arg = left(scope, locals, assign, inputs) || right(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      'ternary?:': function(test, alternate, consequent, context) {
        return function(scope, locals, assign, inputs) {
          var arg = test(scope, locals, assign, inputs) ? alternate(scope, locals, assign, inputs) : consequent(scope, locals, assign, inputs);
          return context ? {value: arg} : arg;
        };
      },
      value: function(value, context) {
        return function() {
          return context ? {
            context: undefined,
            name: undefined,
            value: value
          } : value;
        };
      },
      identifier: function(name, expensiveChecks, context, create, expression) {
        return function(scope, locals, assign, inputs) {
          var base = locals && (name in locals) ? locals : scope;
          if (create && create !== 1 && base && !(base[name])) {
            base[name] = {};
          }
          var value = base ? base[name] : undefined;
          if (expensiveChecks) {
            ensureSafeObject(value, expression);
          }
          if (context) {
            return {
              context: base,
              name: name,
              value: value
            };
          } else {
            return value;
          }
        };
      },
      computedMember: function(left, right, context, create, expression) {
        return function(scope, locals, assign, inputs) {
          var lhs = left(scope, locals, assign, inputs);
          var rhs;
          var value;
          if (lhs != null) {
            rhs = right(scope, locals, assign, inputs);
            rhs = getStringValue(rhs);
            ensureSafeMemberName(rhs, expression);
            if (create && create !== 1 && lhs && !(lhs[rhs])) {
              lhs[rhs] = {};
            }
            value = lhs[rhs];
            ensureSafeObject(value, expression);
          }
          if (context) {
            return {
              context: lhs,
              name: rhs,
              value: value
            };
          } else {
            return value;
          }
        };
      },
      nonComputedMember: function(left, right, expensiveChecks, context, create, expression) {
        return function(scope, locals, assign, inputs) {
          var lhs = left(scope, locals, assign, inputs);
          if (create && create !== 1 && lhs && !(lhs[right])) {
            lhs[right] = {};
          }
          var value = lhs != null ? lhs[right] : undefined;
          if (expensiveChecks || isPossiblyDangerousMemberName(right)) {
            ensureSafeObject(value, expression);
          }
          if (context) {
            return {
              context: lhs,
              name: right,
              value: value
            };
          } else {
            return value;
          }
        };
      },
      inputs: function(input, watchId) {
        return function(scope, value, locals, inputs) {
          if (inputs)
            return inputs[watchId];
          return input(scope, value, locals);
        };
      }
    };
    var Parser = function(lexer, $filter, options) {
      this.lexer = lexer;
      this.$filter = $filter;
      this.options = options;
      this.ast = new AST(this.lexer);
      this.astCompiler = options.csp ? new ASTInterpreter(this.ast, $filter) : new ASTCompiler(this.ast, $filter);
    };
    Parser.prototype = {
      constructor: Parser,
      parse: function(text) {
        return this.astCompiler.compile(text, this.options.expensiveChecks);
      }
    };
    var getterFnCacheDefault = createMap();
    var getterFnCacheExpensive = createMap();
    function isPossiblyDangerousMemberName(name) {
      return name == 'constructor';
    }
    var objectValueOf = Object.prototype.valueOf;
    function getValueOf(value) {
      return isFunction(value.valueOf) ? value.valueOf() : objectValueOf.call(value);
    }
    function $ParseProvider() {
      var cacheDefault = createMap();
      var cacheExpensive = createMap();
      this.$get = ['$filter', function($filter) {
        var noUnsafeEval = csp().noUnsafeEval;
        var $parseOptions = {
          csp: noUnsafeEval,
          expensiveChecks: false
        },
            $parseOptionsExpensive = {
              csp: noUnsafeEval,
              expensiveChecks: true
            };
        return function $parse(exp, interceptorFn, expensiveChecks) {
          var parsedExpression,
              oneTime,
              cacheKey;
          switch (typeof exp) {
            case 'string':
              exp = exp.trim();
              cacheKey = exp;
              var cache = (expensiveChecks ? cacheExpensive : cacheDefault);
              parsedExpression = cache[cacheKey];
              if (!parsedExpression) {
                if (exp.charAt(0) === ':' && exp.charAt(1) === ':') {
                  oneTime = true;
                  exp = exp.substring(2);
                }
                var parseOptions = expensiveChecks ? $parseOptionsExpensive : $parseOptions;
                var lexer = new Lexer(parseOptions);
                var parser = new Parser(lexer, $filter, parseOptions);
                parsedExpression = parser.parse(exp);
                if (parsedExpression.constant) {
                  parsedExpression.$$watchDelegate = constantWatchDelegate;
                } else if (oneTime) {
                  parsedExpression.$$watchDelegate = parsedExpression.literal ? oneTimeLiteralWatchDelegate : oneTimeWatchDelegate;
                } else if (parsedExpression.inputs) {
                  parsedExpression.$$watchDelegate = inputsWatchDelegate;
                }
                cache[cacheKey] = parsedExpression;
              }
              return addInterceptor(parsedExpression, interceptorFn);
            case 'function':
              return addInterceptor(exp, interceptorFn);
            default:
              return noop;
          }
        };
        function expressionInputDirtyCheck(newValue, oldValueOfValue) {
          if (newValue == null || oldValueOfValue == null) {
            return newValue === oldValueOfValue;
          }
          if (typeof newValue === 'object') {
            newValue = getValueOf(newValue);
            if (typeof newValue === 'object') {
              return false;
            }
          }
          return newValue === oldValueOfValue || (newValue !== newValue && oldValueOfValue !== oldValueOfValue);
        }
        function inputsWatchDelegate(scope, listener, objectEquality, parsedExpression, prettyPrintExpression) {
          var inputExpressions = parsedExpression.inputs;
          var lastResult;
          if (inputExpressions.length === 1) {
            var oldInputValueOf = expressionInputDirtyCheck;
            inputExpressions = inputExpressions[0];
            return scope.$watch(function expressionInputWatch(scope) {
              var newInputValue = inputExpressions(scope);
              if (!expressionInputDirtyCheck(newInputValue, oldInputValueOf)) {
                lastResult = parsedExpression(scope, undefined, undefined, [newInputValue]);
                oldInputValueOf = newInputValue && getValueOf(newInputValue);
              }
              return lastResult;
            }, listener, objectEquality, prettyPrintExpression);
          }
          var oldInputValueOfValues = [];
          var oldInputValues = [];
          for (var i = 0,
              ii = inputExpressions.length; i < ii; i++) {
            oldInputValueOfValues[i] = expressionInputDirtyCheck;
            oldInputValues[i] = null;
          }
          return scope.$watch(function expressionInputsWatch(scope) {
            var changed = false;
            for (var i = 0,
                ii = inputExpressions.length; i < ii; i++) {
              var newInputValue = inputExpressions[i](scope);
              if (changed || (changed = !expressionInputDirtyCheck(newInputValue, oldInputValueOfValues[i]))) {
                oldInputValues[i] = newInputValue;
                oldInputValueOfValues[i] = newInputValue && getValueOf(newInputValue);
              }
            }
            if (changed) {
              lastResult = parsedExpression(scope, undefined, undefined, oldInputValues);
            }
            return lastResult;
          }, listener, objectEquality, prettyPrintExpression);
        }
        function oneTimeWatchDelegate(scope, listener, objectEquality, parsedExpression) {
          var unwatch,
              lastValue;
          return unwatch = scope.$watch(function oneTimeWatch(scope) {
            return parsedExpression(scope);
          }, function oneTimeListener(value, old, scope) {
            lastValue = value;
            if (isFunction(listener)) {
              listener.apply(this, arguments);
            }
            if (isDefined(value)) {
              scope.$$postDigest(function() {
                if (isDefined(lastValue)) {
                  unwatch();
                }
              });
            }
          }, objectEquality);
        }
        function oneTimeLiteralWatchDelegate(scope, listener, objectEquality, parsedExpression) {
          var unwatch,
              lastValue;
          return unwatch = scope.$watch(function oneTimeWatch(scope) {
            return parsedExpression(scope);
          }, function oneTimeListener(value, old, scope) {
            lastValue = value;
            if (isFunction(listener)) {
              listener.call(this, value, old, scope);
            }
            if (isAllDefined(value)) {
              scope.$$postDigest(function() {
                if (isAllDefined(lastValue))
                  unwatch();
              });
            }
          }, objectEquality);
          function isAllDefined(value) {
            var allDefined = true;
            forEach(value, function(val) {
              if (!isDefined(val))
                allDefined = false;
            });
            return allDefined;
          }
        }
        function constantWatchDelegate(scope, listener, objectEquality, parsedExpression) {
          var unwatch;
          return unwatch = scope.$watch(function constantWatch(scope) {
            return parsedExpression(scope);
          }, function constantListener(value, old, scope) {
            if (isFunction(listener)) {
              listener.apply(this, arguments);
            }
            unwatch();
          }, objectEquality);
        }
        function addInterceptor(parsedExpression, interceptorFn) {
          if (!interceptorFn)
            return parsedExpression;
          var watchDelegate = parsedExpression.$$watchDelegate;
          var regularWatch = watchDelegate !== oneTimeLiteralWatchDelegate && watchDelegate !== oneTimeWatchDelegate;
          var fn = regularWatch ? function regularInterceptedExpression(scope, locals, assign, inputs) {
            var value = parsedExpression(scope, locals, assign, inputs);
            return interceptorFn(value, scope, locals);
          } : function oneTimeInterceptedExpression(scope, locals, assign, inputs) {
            var value = parsedExpression(scope, locals, assign, inputs);
            var result = interceptorFn(value, scope, locals);
            return isDefined(value) ? result : value;
          };
          if (parsedExpression.$$watchDelegate && parsedExpression.$$watchDelegate !== inputsWatchDelegate) {
            fn.$$watchDelegate = parsedExpression.$$watchDelegate;
          } else if (!interceptorFn.$stateful) {
            fn.$$watchDelegate = inputsWatchDelegate;
            fn.inputs = parsedExpression.inputs ? parsedExpression.inputs : [parsedExpression];
          }
          return fn;
        }
      }];
    }
    function $QProvider() {
      this.$get = ['$rootScope', '$exceptionHandler', function($rootScope, $exceptionHandler) {
        return qFactory(function(callback) {
          $rootScope.$evalAsync(callback);
        }, $exceptionHandler);
      }];
    }
    function $$QProvider() {
      this.$get = ['$browser', '$exceptionHandler', function($browser, $exceptionHandler) {
        return qFactory(function(callback) {
          $browser.defer(callback);
        }, $exceptionHandler);
      }];
    }
    function qFactory(nextTick, exceptionHandler) {
      var $qMinErr = minErr('$q', TypeError);
      function callOnce(self, resolveFn, rejectFn) {
        var called = false;
        function wrap(fn) {
          return function(value) {
            if (called)
              return;
            called = true;
            fn.call(self, value);
          };
        }
        return [wrap(resolveFn), wrap(rejectFn)];
      }
      var defer = function() {
        return new Deferred();
      };
      function Promise() {
        this.$$state = {status: 0};
      }
      extend(Promise.prototype, {
        then: function(onFulfilled, onRejected, progressBack) {
          if (isUndefined(onFulfilled) && isUndefined(onRejected) && isUndefined(progressBack)) {
            return this;
          }
          var result = new Deferred();
          this.$$state.pending = this.$$state.pending || [];
          this.$$state.pending.push([result, onFulfilled, onRejected, progressBack]);
          if (this.$$state.status > 0)
            scheduleProcessQueue(this.$$state);
          return result.promise;
        },
        "catch": function(callback) {
          return this.then(null, callback);
        },
        "finally": function(callback, progressBack) {
          return this.then(function(value) {
            return handleCallback(value, true, callback);
          }, function(error) {
            return handleCallback(error, false, callback);
          }, progressBack);
        }
      });
      function simpleBind(context, fn) {
        return function(value) {
          fn.call(context, value);
        };
      }
      function processQueue(state) {
        var fn,
            deferred,
            pending;
        pending = state.pending;
        state.processScheduled = false;
        state.pending = undefined;
        for (var i = 0,
            ii = pending.length; i < ii; ++i) {
          deferred = pending[i][0];
          fn = pending[i][state.status];
          try {
            if (isFunction(fn)) {
              deferred.resolve(fn(state.value));
            } else if (state.status === 1) {
              deferred.resolve(state.value);
            } else {
              deferred.reject(state.value);
            }
          } catch (e) {
            deferred.reject(e);
            exceptionHandler(e);
          }
        }
      }
      function scheduleProcessQueue(state) {
        if (state.processScheduled || !state.pending)
          return;
        state.processScheduled = true;
        nextTick(function() {
          processQueue(state);
        });
      }
      function Deferred() {
        this.promise = new Promise();
        this.resolve = simpleBind(this, this.resolve);
        this.reject = simpleBind(this, this.reject);
        this.notify = simpleBind(this, this.notify);
      }
      extend(Deferred.prototype, {
        resolve: function(val) {
          if (this.promise.$$state.status)
            return;
          if (val === this.promise) {
            this.$$reject($qMinErr('qcycle', "Expected promise to be resolved with value other than itself '{0}'", val));
          } else {
            this.$$resolve(val);
          }
        },
        $$resolve: function(val) {
          var then,
              fns;
          fns = callOnce(this, this.$$resolve, this.$$reject);
          try {
            if ((isObject(val) || isFunction(val)))
              then = val && val.then;
            if (isFunction(then)) {
              this.promise.$$state.status = -1;
              then.call(val, fns[0], fns[1], this.notify);
            } else {
              this.promise.$$state.value = val;
              this.promise.$$state.status = 1;
              scheduleProcessQueue(this.promise.$$state);
            }
          } catch (e) {
            fns[1](e);
            exceptionHandler(e);
          }
        },
        reject: function(reason) {
          if (this.promise.$$state.status)
            return;
          this.$$reject(reason);
        },
        $$reject: function(reason) {
          this.promise.$$state.value = reason;
          this.promise.$$state.status = 2;
          scheduleProcessQueue(this.promise.$$state);
        },
        notify: function(progress) {
          var callbacks = this.promise.$$state.pending;
          if ((this.promise.$$state.status <= 0) && callbacks && callbacks.length) {
            nextTick(function() {
              var callback,
                  result;
              for (var i = 0,
                  ii = callbacks.length; i < ii; i++) {
                result = callbacks[i][0];
                callback = callbacks[i][3];
                try {
                  result.notify(isFunction(callback) ? callback(progress) : progress);
                } catch (e) {
                  exceptionHandler(e);
                }
              }
            });
          }
        }
      });
      var reject = function(reason) {
        var result = new Deferred();
        result.reject(reason);
        return result.promise;
      };
      var makePromise = function makePromise(value, resolved) {
        var result = new Deferred();
        if (resolved) {
          result.resolve(value);
        } else {
          result.reject(value);
        }
        return result.promise;
      };
      var handleCallback = function handleCallback(value, isResolved, callback) {
        var callbackOutput = null;
        try {
          if (isFunction(callback))
            callbackOutput = callback();
        } catch (e) {
          return makePromise(e, false);
        }
        if (isPromiseLike(callbackOutput)) {
          return callbackOutput.then(function() {
            return makePromise(value, isResolved);
          }, function(error) {
            return makePromise(error, false);
          });
        } else {
          return makePromise(value, isResolved);
        }
      };
      var when = function(value, callback, errback, progressBack) {
        var result = new Deferred();
        result.resolve(value);
        return result.promise.then(callback, errback, progressBack);
      };
      var resolve = when;
      function all(promises) {
        var deferred = new Deferred(),
            counter = 0,
            results = isArray(promises) ? [] : {};
        forEach(promises, function(promise, key) {
          counter++;
          when(promise).then(function(value) {
            if (results.hasOwnProperty(key))
              return;
            results[key] = value;
            if (!(--counter))
              deferred.resolve(results);
          }, function(reason) {
            if (results.hasOwnProperty(key))
              return;
            deferred.reject(reason);
          });
        });
        if (counter === 0) {
          deferred.resolve(results);
        }
        return deferred.promise;
      }
      var $Q = function Q(resolver) {
        if (!isFunction(resolver)) {
          throw $qMinErr('norslvr', "Expected resolverFn, got '{0}'", resolver);
        }
        if (!(this instanceof Q)) {
          return new Q(resolver);
        }
        var deferred = new Deferred();
        function resolveFn(value) {
          deferred.resolve(value);
        }
        function rejectFn(reason) {
          deferred.reject(reason);
        }
        resolver(resolveFn, rejectFn);
        return deferred.promise;
      };
      $Q.defer = defer;
      $Q.reject = reject;
      $Q.when = when;
      $Q.resolve = resolve;
      $Q.all = all;
      return $Q;
    }
    function $$RAFProvider() {
      this.$get = ['$window', '$timeout', function($window, $timeout) {
        var requestAnimationFrame = $window.requestAnimationFrame || $window.webkitRequestAnimationFrame;
        var cancelAnimationFrame = $window.cancelAnimationFrame || $window.webkitCancelAnimationFrame || $window.webkitCancelRequestAnimationFrame;
        var rafSupported = !!requestAnimationFrame;
        var raf = rafSupported ? function(fn) {
          var id = requestAnimationFrame(fn);
          return function() {
            cancelAnimationFrame(id);
          };
        } : function(fn) {
          var timer = $timeout(fn, 16.66, false);
          return function() {
            $timeout.cancel(timer);
          };
        };
        raf.supported = rafSupported;
        return raf;
      }];
    }
    function $RootScopeProvider() {
      var TTL = 10;
      var $rootScopeMinErr = minErr('$rootScope');
      var lastDirtyWatch = null;
      var applyAsyncId = null;
      this.digestTtl = function(value) {
        if (arguments.length) {
          TTL = value;
        }
        return TTL;
      };
      function createChildScopeClass(parent) {
        function ChildScope() {
          this.$$watchers = this.$$nextSibling = this.$$childHead = this.$$childTail = null;
          this.$$listeners = {};
          this.$$listenerCount = {};
          this.$$watchersCount = 0;
          this.$id = nextUid();
          this.$$ChildScope = null;
        }
        ChildScope.prototype = parent;
        return ChildScope;
      }
      this.$get = ['$injector', '$exceptionHandler', '$parse', '$browser', function($injector, $exceptionHandler, $parse, $browser) {
        function destroyChildScope($event) {
          $event.currentScope.$$destroyed = true;
        }
        function Scope() {
          this.$id = nextUid();
          this.$$phase = this.$parent = this.$$watchers = this.$$nextSibling = this.$$prevSibling = this.$$childHead = this.$$childTail = null;
          this.$root = this;
          this.$$destroyed = false;
          this.$$listeners = {};
          this.$$listenerCount = {};
          this.$$watchersCount = 0;
          this.$$isolateBindings = null;
        }
        Scope.prototype = {
          constructor: Scope,
          $new: function(isolate, parent) {
            var child;
            parent = parent || this;
            if (isolate) {
              child = new Scope();
              child.$root = this.$root;
            } else {
              if (!this.$$ChildScope) {
                this.$$ChildScope = createChildScopeClass(this);
              }
              child = new this.$$ChildScope();
            }
            child.$parent = parent;
            child.$$prevSibling = parent.$$childTail;
            if (parent.$$childHead) {
              parent.$$childTail.$$nextSibling = child;
              parent.$$childTail = child;
            } else {
              parent.$$childHead = parent.$$childTail = child;
            }
            if (isolate || parent != this)
              child.$on('$destroy', destroyChildScope);
            return child;
          },
          $watch: function(watchExp, listener, objectEquality, prettyPrintExpression) {
            var get = $parse(watchExp);
            if (get.$$watchDelegate) {
              return get.$$watchDelegate(this, listener, objectEquality, get, watchExp);
            }
            var scope = this,
                array = scope.$$watchers,
                watcher = {
                  fn: listener,
                  last: initWatchVal,
                  get: get,
                  exp: prettyPrintExpression || watchExp,
                  eq: !!objectEquality
                };
            lastDirtyWatch = null;
            if (!isFunction(listener)) {
              watcher.fn = noop;
            }
            if (!array) {
              array = scope.$$watchers = [];
            }
            array.unshift(watcher);
            incrementWatchersCount(this, 1);
            return function deregisterWatch() {
              if (arrayRemove(array, watcher) >= 0) {
                incrementWatchersCount(scope, -1);
              }
              lastDirtyWatch = null;
            };
          },
          $watchGroup: function(watchExpressions, listener) {
            var oldValues = new Array(watchExpressions.length);
            var newValues = new Array(watchExpressions.length);
            var deregisterFns = [];
            var self = this;
            var changeReactionScheduled = false;
            var firstRun = true;
            if (!watchExpressions.length) {
              var shouldCall = true;
              self.$evalAsync(function() {
                if (shouldCall)
                  listener(newValues, newValues, self);
              });
              return function deregisterWatchGroup() {
                shouldCall = false;
              };
            }
            if (watchExpressions.length === 1) {
              return this.$watch(watchExpressions[0], function watchGroupAction(value, oldValue, scope) {
                newValues[0] = value;
                oldValues[0] = oldValue;
                listener(newValues, (value === oldValue) ? newValues : oldValues, scope);
              });
            }
            forEach(watchExpressions, function(expr, i) {
              var unwatchFn = self.$watch(expr, function watchGroupSubAction(value, oldValue) {
                newValues[i] = value;
                oldValues[i] = oldValue;
                if (!changeReactionScheduled) {
                  changeReactionScheduled = true;
                  self.$evalAsync(watchGroupAction);
                }
              });
              deregisterFns.push(unwatchFn);
            });
            function watchGroupAction() {
              changeReactionScheduled = false;
              if (firstRun) {
                firstRun = false;
                listener(newValues, newValues, self);
              } else {
                listener(newValues, oldValues, self);
              }
            }
            return function deregisterWatchGroup() {
              while (deregisterFns.length) {
                deregisterFns.shift()();
              }
            };
          },
          $watchCollection: function(obj, listener) {
            $watchCollectionInterceptor.$stateful = true;
            var self = this;
            var newValue;
            var oldValue;
            var veryOldValue;
            var trackVeryOldValue = (listener.length > 1);
            var changeDetected = 0;
            var changeDetector = $parse(obj, $watchCollectionInterceptor);
            var internalArray = [];
            var internalObject = {};
            var initRun = true;
            var oldLength = 0;
            function $watchCollectionInterceptor(_value) {
              newValue = _value;
              var newLength,
                  key,
                  bothNaN,
                  newItem,
                  oldItem;
              if (isUndefined(newValue))
                return;
              if (!isObject(newValue)) {
                if (oldValue !== newValue) {
                  oldValue = newValue;
                  changeDetected++;
                }
              } else if (isArrayLike(newValue)) {
                if (oldValue !== internalArray) {
                  oldValue = internalArray;
                  oldLength = oldValue.length = 0;
                  changeDetected++;
                }
                newLength = newValue.length;
                if (oldLength !== newLength) {
                  changeDetected++;
                  oldValue.length = oldLength = newLength;
                }
                for (var i = 0; i < newLength; i++) {
                  oldItem = oldValue[i];
                  newItem = newValue[i];
                  bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
                  if (!bothNaN && (oldItem !== newItem)) {
                    changeDetected++;
                    oldValue[i] = newItem;
                  }
                }
              } else {
                if (oldValue !== internalObject) {
                  oldValue = internalObject = {};
                  oldLength = 0;
                  changeDetected++;
                }
                newLength = 0;
                for (key in newValue) {
                  if (hasOwnProperty.call(newValue, key)) {
                    newLength++;
                    newItem = newValue[key];
                    oldItem = oldValue[key];
                    if (key in oldValue) {
                      bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
                      if (!bothNaN && (oldItem !== newItem)) {
                        changeDetected++;
                        oldValue[key] = newItem;
                      }
                    } else {
                      oldLength++;
                      oldValue[key] = newItem;
                      changeDetected++;
                    }
                  }
                }
                if (oldLength > newLength) {
                  changeDetected++;
                  for (key in oldValue) {
                    if (!hasOwnProperty.call(newValue, key)) {
                      oldLength--;
                      delete oldValue[key];
                    }
                  }
                }
              }
              return changeDetected;
            }
            function $watchCollectionAction() {
              if (initRun) {
                initRun = false;
                listener(newValue, newValue, self);
              } else {
                listener(newValue, veryOldValue, self);
              }
              if (trackVeryOldValue) {
                if (!isObject(newValue)) {
                  veryOldValue = newValue;
                } else if (isArrayLike(newValue)) {
                  veryOldValue = new Array(newValue.length);
                  for (var i = 0; i < newValue.length; i++) {
                    veryOldValue[i] = newValue[i];
                  }
                } else {
                  veryOldValue = {};
                  for (var key in newValue) {
                    if (hasOwnProperty.call(newValue, key)) {
                      veryOldValue[key] = newValue[key];
                    }
                  }
                }
              }
            }
            return this.$watch(changeDetector, $watchCollectionAction);
          },
          $digest: function() {
            var watch,
                value,
                last,
                watchers,
                length,
                dirty,
                ttl = TTL,
                next,
                current,
                target = this,
                watchLog = [],
                logIdx,
                logMsg,
                asyncTask;
            beginPhase('$digest');
            $browser.$$checkUrlChange();
            if (this === $rootScope && applyAsyncId !== null) {
              $browser.defer.cancel(applyAsyncId);
              flushApplyAsync();
            }
            lastDirtyWatch = null;
            do {
              dirty = false;
              current = target;
              while (asyncQueue.length) {
                try {
                  asyncTask = asyncQueue.shift();
                  asyncTask.scope.$eval(asyncTask.expression, asyncTask.locals);
                } catch (e) {
                  $exceptionHandler(e);
                }
                lastDirtyWatch = null;
              }
              traverseScopesLoop: do {
                if ((watchers = current.$$watchers)) {
                  length = watchers.length;
                  while (length--) {
                    try {
                      watch = watchers[length];
                      if (watch) {
                        if ((value = watch.get(current)) !== (last = watch.last) && !(watch.eq ? equals(value, last) : (typeof value === 'number' && typeof last === 'number' && isNaN(value) && isNaN(last)))) {
                          dirty = true;
                          lastDirtyWatch = watch;
                          watch.last = watch.eq ? copy(value, null) : value;
                          watch.fn(value, ((last === initWatchVal) ? value : last), current);
                          if (ttl < 5) {
                            logIdx = 4 - ttl;
                            if (!watchLog[logIdx])
                              watchLog[logIdx] = [];
                            watchLog[logIdx].push({
                              msg: isFunction(watch.exp) ? 'fn: ' + (watch.exp.name || watch.exp.toString()) : watch.exp,
                              newVal: value,
                              oldVal: last
                            });
                          }
                        } else if (watch === lastDirtyWatch) {
                          dirty = false;
                          break traverseScopesLoop;
                        }
                      }
                    } catch (e) {
                      $exceptionHandler(e);
                    }
                  }
                }
                if (!(next = ((current.$$watchersCount && current.$$childHead) || (current !== target && current.$$nextSibling)))) {
                  while (current !== target && !(next = current.$$nextSibling)) {
                    current = current.$parent;
                  }
                }
              } while ((current = next));
              if ((dirty || asyncQueue.length) && !(ttl--)) {
                clearPhase();
                throw $rootScopeMinErr('infdig', '{0} $digest() iterations reached. Aborting!\n' + 'Watchers fired in the last 5 iterations: {1}', TTL, watchLog);
              }
            } while (dirty || asyncQueue.length);
            clearPhase();
            while (postDigestQueue.length) {
              try {
                postDigestQueue.shift()();
              } catch (e) {
                $exceptionHandler(e);
              }
            }
          },
          $destroy: function() {
            if (this.$$destroyed)
              return;
            var parent = this.$parent;
            this.$broadcast('$destroy');
            this.$$destroyed = true;
            if (this === $rootScope) {
              $browser.$$applicationDestroyed();
            }
            incrementWatchersCount(this, -this.$$watchersCount);
            for (var eventName in this.$$listenerCount) {
              decrementListenerCount(this, this.$$listenerCount[eventName], eventName);
            }
            if (parent && parent.$$childHead == this)
              parent.$$childHead = this.$$nextSibling;
            if (parent && parent.$$childTail == this)
              parent.$$childTail = this.$$prevSibling;
            if (this.$$prevSibling)
              this.$$prevSibling.$$nextSibling = this.$$nextSibling;
            if (this.$$nextSibling)
              this.$$nextSibling.$$prevSibling = this.$$prevSibling;
            this.$destroy = this.$digest = this.$apply = this.$evalAsync = this.$applyAsync = noop;
            this.$on = this.$watch = this.$watchGroup = function() {
              return noop;
            };
            this.$$listeners = {};
            this.$parent = this.$$nextSibling = this.$$prevSibling = this.$$childHead = this.$$childTail = this.$root = this.$$watchers = null;
          },
          $eval: function(expr, locals) {
            return $parse(expr)(this, locals);
          },
          $evalAsync: function(expr, locals) {
            if (!$rootScope.$$phase && !asyncQueue.length) {
              $browser.defer(function() {
                if (asyncQueue.length) {
                  $rootScope.$digest();
                }
              });
            }
            asyncQueue.push({
              scope: this,
              expression: expr,
              locals: locals
            });
          },
          $$postDigest: function(fn) {
            postDigestQueue.push(fn);
          },
          $apply: function(expr) {
            try {
              beginPhase('$apply');
              try {
                return this.$eval(expr);
              } finally {
                clearPhase();
              }
            } catch (e) {
              $exceptionHandler(e);
            } finally {
              try {
                $rootScope.$digest();
              } catch (e) {
                $exceptionHandler(e);
                throw e;
              }
            }
          },
          $applyAsync: function(expr) {
            var scope = this;
            expr && applyAsyncQueue.push($applyAsyncExpression);
            scheduleApplyAsync();
            function $applyAsyncExpression() {
              scope.$eval(expr);
            }
          },
          $on: function(name, listener) {
            var namedListeners = this.$$listeners[name];
            if (!namedListeners) {
              this.$$listeners[name] = namedListeners = [];
            }
            namedListeners.push(listener);
            var current = this;
            do {
              if (!current.$$listenerCount[name]) {
                current.$$listenerCount[name] = 0;
              }
              current.$$listenerCount[name]++;
            } while ((current = current.$parent));
            var self = this;
            return function() {
              var indexOfListener = namedListeners.indexOf(listener);
              if (indexOfListener !== -1) {
                namedListeners[indexOfListener] = null;
                decrementListenerCount(self, 1, name);
              }
            };
          },
          $emit: function(name, args) {
            var empty = [],
                namedListeners,
                scope = this,
                stopPropagation = false,
                event = {
                  name: name,
                  targetScope: scope,
                  stopPropagation: function() {
                    stopPropagation = true;
                  },
                  preventDefault: function() {
                    event.defaultPrevented = true;
                  },
                  defaultPrevented: false
                },
                listenerArgs = concat([event], arguments, 1),
                i,
                length;
            do {
              namedListeners = scope.$$listeners[name] || empty;
              event.currentScope = scope;
              for (i = 0, length = namedListeners.length; i < length; i++) {
                if (!namedListeners[i]) {
                  namedListeners.splice(i, 1);
                  i--;
                  length--;
                  continue;
                }
                try {
                  namedListeners[i].apply(null, listenerArgs);
                } catch (e) {
                  $exceptionHandler(e);
                }
              }
              if (stopPropagation) {
                event.currentScope = null;
                return event;
              }
              scope = scope.$parent;
            } while (scope);
            event.currentScope = null;
            return event;
          },
          $broadcast: function(name, args) {
            var target = this,
                current = target,
                next = target,
                event = {
                  name: name,
                  targetScope: target,
                  preventDefault: function() {
                    event.defaultPrevented = true;
                  },
                  defaultPrevented: false
                };
            if (!target.$$listenerCount[name])
              return event;
            var listenerArgs = concat([event], arguments, 1),
                listeners,
                i,
                length;
            while ((current = next)) {
              event.currentScope = current;
              listeners = current.$$listeners[name] || [];
              for (i = 0, length = listeners.length; i < length; i++) {
                if (!listeners[i]) {
                  listeners.splice(i, 1);
                  i--;
                  length--;
                  continue;
                }
                try {
                  listeners[i].apply(null, listenerArgs);
                } catch (e) {
                  $exceptionHandler(e);
                }
              }
              if (!(next = ((current.$$listenerCount[name] && current.$$childHead) || (current !== target && current.$$nextSibling)))) {
                while (current !== target && !(next = current.$$nextSibling)) {
                  current = current.$parent;
                }
              }
            }
            event.currentScope = null;
            return event;
          }
        };
        var $rootScope = new Scope();
        var asyncQueue = $rootScope.$$asyncQueue = [];
        var postDigestQueue = $rootScope.$$postDigestQueue = [];
        var applyAsyncQueue = $rootScope.$$applyAsyncQueue = [];
        return $rootScope;
        function beginPhase(phase) {
          if ($rootScope.$$phase) {
            throw $rootScopeMinErr('inprog', '{0} already in progress', $rootScope.$$phase);
          }
          $rootScope.$$phase = phase;
        }
        function clearPhase() {
          $rootScope.$$phase = null;
        }
        function incrementWatchersCount(current, count) {
          do {
            current.$$watchersCount += count;
          } while ((current = current.$parent));
        }
        function decrementListenerCount(current, count, name) {
          do {
            current.$$listenerCount[name] -= count;
            if (current.$$listenerCount[name] === 0) {
              delete current.$$listenerCount[name];
            }
          } while ((current = current.$parent));
        }
        function initWatchVal() {}
        function flushApplyAsync() {
          while (applyAsyncQueue.length) {
            try {
              applyAsyncQueue.shift()();
            } catch (e) {
              $exceptionHandler(e);
            }
          }
          applyAsyncId = null;
        }
        function scheduleApplyAsync() {
          if (applyAsyncId === null) {
            applyAsyncId = $browser.defer(function() {
              $rootScope.$apply(flushApplyAsync);
            });
          }
        }
      }];
    }
    function $$SanitizeUriProvider() {
      var aHrefSanitizationWhitelist = /^\s*(https?|ftp|mailto|tel|file):/,
          imgSrcSanitizationWhitelist = /^\s*((https?|ftp|file|blob):|data:image\/)/;
      this.aHrefSanitizationWhitelist = function(regexp) {
        if (isDefined(regexp)) {
          aHrefSanitizationWhitelist = regexp;
          return this;
        }
        return aHrefSanitizationWhitelist;
      };
      this.imgSrcSanitizationWhitelist = function(regexp) {
        if (isDefined(regexp)) {
          imgSrcSanitizationWhitelist = regexp;
          return this;
        }
        return imgSrcSanitizationWhitelist;
      };
      this.$get = function() {
        return function sanitizeUri(uri, isImage) {
          var regex = isImage ? imgSrcSanitizationWhitelist : aHrefSanitizationWhitelist;
          var normalizedVal;
          normalizedVal = urlResolve(uri).href;
          if (normalizedVal !== '' && !normalizedVal.match(regex)) {
            return 'unsafe:' + normalizedVal;
          }
          return uri;
        };
      };
    }
    var $sceMinErr = minErr('$sce');
    var SCE_CONTEXTS = {
      HTML: 'html',
      CSS: 'css',
      URL: 'url',
      RESOURCE_URL: 'resourceUrl',
      JS: 'js'
    };
    function adjustMatcher(matcher) {
      if (matcher === 'self') {
        return matcher;
      } else if (isString(matcher)) {
        if (matcher.indexOf('***') > -1) {
          throw $sceMinErr('iwcard', 'Illegal sequence *** in string matcher.  String: {0}', matcher);
        }
        matcher = escapeForRegexp(matcher).replace('\\*\\*', '.*').replace('\\*', '[^:/.?&;]*');
        return new RegExp('^' + matcher + '$');
      } else if (isRegExp(matcher)) {
        return new RegExp('^' + matcher.source + '$');
      } else {
        throw $sceMinErr('imatcher', 'Matchers may only be "self", string patterns or RegExp objects');
      }
    }
    function adjustMatchers(matchers) {
      var adjustedMatchers = [];
      if (isDefined(matchers)) {
        forEach(matchers, function(matcher) {
          adjustedMatchers.push(adjustMatcher(matcher));
        });
      }
      return adjustedMatchers;
    }
    function $SceDelegateProvider() {
      this.SCE_CONTEXTS = SCE_CONTEXTS;
      var resourceUrlWhitelist = ['self'],
          resourceUrlBlacklist = [];
      this.resourceUrlWhitelist = function(value) {
        if (arguments.length) {
          resourceUrlWhitelist = adjustMatchers(value);
        }
        return resourceUrlWhitelist;
      };
      this.resourceUrlBlacklist = function(value) {
        if (arguments.length) {
          resourceUrlBlacklist = adjustMatchers(value);
        }
        return resourceUrlBlacklist;
      };
      this.$get = ['$injector', function($injector) {
        var htmlSanitizer = function htmlSanitizer(html) {
          throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
        };
        if ($injector.has('$sanitize')) {
          htmlSanitizer = $injector.get('$sanitize');
        }
        function matchUrl(matcher, parsedUrl) {
          if (matcher === 'self') {
            return urlIsSameOrigin(parsedUrl);
          } else {
            return !!matcher.exec(parsedUrl.href);
          }
        }
        function isResourceUrlAllowedByPolicy(url) {
          var parsedUrl = urlResolve(url.toString());
          var i,
              n,
              allowed = false;
          for (i = 0, n = resourceUrlWhitelist.length; i < n; i++) {
            if (matchUrl(resourceUrlWhitelist[i], parsedUrl)) {
              allowed = true;
              break;
            }
          }
          if (allowed) {
            for (i = 0, n = resourceUrlBlacklist.length; i < n; i++) {
              if (matchUrl(resourceUrlBlacklist[i], parsedUrl)) {
                allowed = false;
                break;
              }
            }
          }
          return allowed;
        }
        function generateHolderType(Base) {
          var holderType = function TrustedValueHolderType(trustedValue) {
            this.$$unwrapTrustedValue = function() {
              return trustedValue;
            };
          };
          if (Base) {
            holderType.prototype = new Base();
          }
          holderType.prototype.valueOf = function sceValueOf() {
            return this.$$unwrapTrustedValue();
          };
          holderType.prototype.toString = function sceToString() {
            return this.$$unwrapTrustedValue().toString();
          };
          return holderType;
        }
        var trustedValueHolderBase = generateHolderType(),
            byType = {};
        byType[SCE_CONTEXTS.HTML] = generateHolderType(trustedValueHolderBase);
        byType[SCE_CONTEXTS.CSS] = generateHolderType(trustedValueHolderBase);
        byType[SCE_CONTEXTS.URL] = generateHolderType(trustedValueHolderBase);
        byType[SCE_CONTEXTS.JS] = generateHolderType(trustedValueHolderBase);
        byType[SCE_CONTEXTS.RESOURCE_URL] = generateHolderType(byType[SCE_CONTEXTS.URL]);
        function trustAs(type, trustedValue) {
          var Constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
          if (!Constructor) {
            throw $sceMinErr('icontext', 'Attempted to trust a value in invalid context. Context: {0}; Value: {1}', type, trustedValue);
          }
          if (trustedValue === null || isUndefined(trustedValue) || trustedValue === '') {
            return trustedValue;
          }
          if (typeof trustedValue !== 'string') {
            throw $sceMinErr('itype', 'Attempted to trust a non-string value in a content requiring a string: Context: {0}', type);
          }
          return new Constructor(trustedValue);
        }
        function valueOf(maybeTrusted) {
          if (maybeTrusted instanceof trustedValueHolderBase) {
            return maybeTrusted.$$unwrapTrustedValue();
          } else {
            return maybeTrusted;
          }
        }
        function getTrusted(type, maybeTrusted) {
          if (maybeTrusted === null || isUndefined(maybeTrusted) || maybeTrusted === '') {
            return maybeTrusted;
          }
          var constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
          if (constructor && maybeTrusted instanceof constructor) {
            return maybeTrusted.$$unwrapTrustedValue();
          }
          if (type === SCE_CONTEXTS.RESOURCE_URL) {
            if (isResourceUrlAllowedByPolicy(maybeTrusted)) {
              return maybeTrusted;
            } else {
              throw $sceMinErr('insecurl', 'Blocked loading resource from url not allowed by $sceDelegate policy.  URL: {0}', maybeTrusted.toString());
            }
          } else if (type === SCE_CONTEXTS.HTML) {
            return htmlSanitizer(maybeTrusted);
          }
          throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
        }
        return {
          trustAs: trustAs,
          getTrusted: getTrusted,
          valueOf: valueOf
        };
      }];
    }
    function $SceProvider() {
      var enabled = true;
      this.enabled = function(value) {
        if (arguments.length) {
          enabled = !!value;
        }
        return enabled;
      };
      this.$get = ['$parse', '$sceDelegate', function($parse, $sceDelegate) {
        if (enabled && msie < 8) {
          throw $sceMinErr('iequirks', 'Strict Contextual Escaping does not support Internet Explorer version < 11 in quirks ' + 'mode.  You can fix this by adding the text <!doctype html> to the top of your HTML ' + 'document.  See http://docs.angularjs.org/api/ng.$sce for more information.');
        }
        var sce = shallowCopy(SCE_CONTEXTS);
        sce.isEnabled = function() {
          return enabled;
        };
        sce.trustAs = $sceDelegate.trustAs;
        sce.getTrusted = $sceDelegate.getTrusted;
        sce.valueOf = $sceDelegate.valueOf;
        if (!enabled) {
          sce.trustAs = sce.getTrusted = function(type, value) {
            return value;
          };
          sce.valueOf = identity;
        }
        sce.parseAs = function sceParseAs(type, expr) {
          var parsed = $parse(expr);
          if (parsed.literal && parsed.constant) {
            return parsed;
          } else {
            return $parse(expr, function(value) {
              return sce.getTrusted(type, value);
            });
          }
        };
        var parse = sce.parseAs,
            getTrusted = sce.getTrusted,
            trustAs = sce.trustAs;
        forEach(SCE_CONTEXTS, function(enumValue, name) {
          var lName = lowercase(name);
          sce[camelCase("parse_as_" + lName)] = function(expr) {
            return parse(enumValue, expr);
          };
          sce[camelCase("get_trusted_" + lName)] = function(value) {
            return getTrusted(enumValue, value);
          };
          sce[camelCase("trust_as_" + lName)] = function(value) {
            return trustAs(enumValue, value);
          };
        });
        return sce;
      }];
    }
    function $SnifferProvider() {
      this.$get = ['$window', '$document', function($window, $document) {
        var eventSupport = {},
            android = toInt((/android (\d+)/.exec(lowercase(($window.navigator || {}).userAgent)) || [])[1]),
            boxee = /Boxee/i.test(($window.navigator || {}).userAgent),
            document = $document[0] || {},
            vendorPrefix,
            vendorRegex = /^(Moz|webkit|ms)(?=[A-Z])/,
            bodyStyle = document.body && document.body.style,
            transitions = false,
            animations = false,
            match;
        if (bodyStyle) {
          for (var prop in bodyStyle) {
            if (match = vendorRegex.exec(prop)) {
              vendorPrefix = match[0];
              vendorPrefix = vendorPrefix.substr(0, 1).toUpperCase() + vendorPrefix.substr(1);
              break;
            }
          }
          if (!vendorPrefix) {
            vendorPrefix = ('WebkitOpacity' in bodyStyle) && 'webkit';
          }
          transitions = !!(('transition' in bodyStyle) || (vendorPrefix + 'Transition' in bodyStyle));
          animations = !!(('animation' in bodyStyle) || (vendorPrefix + 'Animation' in bodyStyle));
          if (android && (!transitions || !animations)) {
            transitions = isString(bodyStyle.webkitTransition);
            animations = isString(bodyStyle.webkitAnimation);
          }
        }
        return {
          history: !!($window.history && $window.history.pushState && !(android < 4) && !boxee),
          hasEvent: function(event) {
            if (event === 'input' && msie <= 11)
              return false;
            if (isUndefined(eventSupport[event])) {
              var divElm = document.createElement('div');
              eventSupport[event] = 'on' + event in divElm;
            }
            return eventSupport[event];
          },
          csp: csp(),
          vendorPrefix: vendorPrefix,
          transitions: transitions,
          animations: animations,
          android: android
        };
      }];
    }
    var $compileMinErr = minErr('$compile');
    function $TemplateRequestProvider() {
      this.$get = ['$templateCache', '$http', '$q', '$sce', function($templateCache, $http, $q, $sce) {
        function handleRequestFn(tpl, ignoreRequestError) {
          handleRequestFn.totalPendingRequests++;
          if (!isString(tpl) || !$templateCache.get(tpl)) {
            tpl = $sce.getTrustedResourceUrl(tpl);
          }
          var transformResponse = $http.defaults && $http.defaults.transformResponse;
          if (isArray(transformResponse)) {
            transformResponse = transformResponse.filter(function(transformer) {
              return transformer !== defaultHttpResponseTransform;
            });
          } else if (transformResponse === defaultHttpResponseTransform) {
            transformResponse = null;
          }
          var httpOptions = {
            cache: $templateCache,
            transformResponse: transformResponse
          };
          return $http.get(tpl, httpOptions)['finally'](function() {
            handleRequestFn.totalPendingRequests--;
          }).then(function(response) {
            $templateCache.put(tpl, response.data);
            return response.data;
          }, handleError);
          function handleError(resp) {
            if (!ignoreRequestError) {
              throw $compileMinErr('tpload', 'Failed to load template: {0} (HTTP status: {1} {2})', tpl, resp.status, resp.statusText);
            }
            return $q.reject(resp);
          }
        }
        handleRequestFn.totalPendingRequests = 0;
        return handleRequestFn;
      }];
    }
    function $$TestabilityProvider() {
      this.$get = ['$rootScope', '$browser', '$location', function($rootScope, $browser, $location) {
        var testability = {};
        testability.findBindings = function(element, expression, opt_exactMatch) {
          var bindings = element.getElementsByClassName('ng-binding');
          var matches = [];
          forEach(bindings, function(binding) {
            var dataBinding = angular.element(binding).data('$binding');
            if (dataBinding) {
              forEach(dataBinding, function(bindingName) {
                if (opt_exactMatch) {
                  var matcher = new RegExp('(^|\\s)' + escapeForRegexp(expression) + '(\\s|\\||$)');
                  if (matcher.test(bindingName)) {
                    matches.push(binding);
                  }
                } else {
                  if (bindingName.indexOf(expression) != -1) {
                    matches.push(binding);
                  }
                }
              });
            }
          });
          return matches;
        };
        testability.findModels = function(element, expression, opt_exactMatch) {
          var prefixes = ['ng-', 'data-ng-', 'ng\\:'];
          for (var p = 0; p < prefixes.length; ++p) {
            var attributeEquals = opt_exactMatch ? '=' : '*=';
            var selector = '[' + prefixes[p] + 'model' + attributeEquals + '"' + expression + '"]';
            var elements = element.querySelectorAll(selector);
            if (elements.length) {
              return elements;
            }
          }
        };
        testability.getLocation = function() {
          return $location.url();
        };
        testability.setLocation = function(url) {
          if (url !== $location.url()) {
            $location.url(url);
            $rootScope.$digest();
          }
        };
        testability.whenStable = function(callback) {
          $browser.notifyWhenNoOutstandingRequests(callback);
        };
        return testability;
      }];
    }
    function $TimeoutProvider() {
      this.$get = ['$rootScope', '$browser', '$q', '$$q', '$exceptionHandler', function($rootScope, $browser, $q, $$q, $exceptionHandler) {
        var deferreds = {};
        function timeout(fn, delay, invokeApply) {
          if (!isFunction(fn)) {
            invokeApply = delay;
            delay = fn;
            fn = noop;
          }
          var args = sliceArgs(arguments, 3),
              skipApply = (isDefined(invokeApply) && !invokeApply),
              deferred = (skipApply ? $$q : $q).defer(),
              promise = deferred.promise,
              timeoutId;
          timeoutId = $browser.defer(function() {
            try {
              deferred.resolve(fn.apply(null, args));
            } catch (e) {
              deferred.reject(e);
              $exceptionHandler(e);
            } finally {
              delete deferreds[promise.$$timeoutId];
            }
            if (!skipApply)
              $rootScope.$apply();
          }, delay);
          promise.$$timeoutId = timeoutId;
          deferreds[timeoutId] = deferred;
          return promise;
        }
        timeout.cancel = function(promise) {
          if (promise && promise.$$timeoutId in deferreds) {
            deferreds[promise.$$timeoutId].reject('canceled');
            delete deferreds[promise.$$timeoutId];
            return $browser.defer.cancel(promise.$$timeoutId);
          }
          return false;
        };
        return timeout;
      }];
    }
    var urlParsingNode = document.createElement("a");
    var originUrl = urlResolve(window.location.href);
    function urlResolve(url) {
      var href = url;
      if (msie) {
        urlParsingNode.setAttribute("href", href);
        href = urlParsingNode.href;
      }
      urlParsingNode.setAttribute('href', href);
      return {
        href: urlParsingNode.href,
        protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
        host: urlParsingNode.host,
        search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
        hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
        hostname: urlParsingNode.hostname,
        port: urlParsingNode.port,
        pathname: (urlParsingNode.pathname.charAt(0) === '/') ? urlParsingNode.pathname : '/' + urlParsingNode.pathname
      };
    }
    function urlIsSameOrigin(requestUrl) {
      var parsed = (isString(requestUrl)) ? urlResolve(requestUrl) : requestUrl;
      return (parsed.protocol === originUrl.protocol && parsed.host === originUrl.host);
    }
    function $WindowProvider() {
      this.$get = valueFn(window);
    }
    function $$CookieReader($document) {
      var rawDocument = $document[0] || {};
      var lastCookies = {};
      var lastCookieString = '';
      function safeDecodeURIComponent(str) {
        try {
          return decodeURIComponent(str);
        } catch (e) {
          return str;
        }
      }
      return function() {
        var cookieArray,
            cookie,
            i,
            index,
            name;
        var currentCookieString = rawDocument.cookie || '';
        if (currentCookieString !== lastCookieString) {
          lastCookieString = currentCookieString;
          cookieArray = lastCookieString.split('; ');
          lastCookies = {};
          for (i = 0; i < cookieArray.length; i++) {
            cookie = cookieArray[i];
            index = cookie.indexOf('=');
            if (index > 0) {
              name = safeDecodeURIComponent(cookie.substring(0, index));
              if (isUndefined(lastCookies[name])) {
                lastCookies[name] = safeDecodeURIComponent(cookie.substring(index + 1));
              }
            }
          }
        }
        return lastCookies;
      };
    }
    $$CookieReader.$inject = ['$document'];
    function $$CookieReaderProvider() {
      this.$get = $$CookieReader;
    }
    $FilterProvider.$inject = ['$provide'];
    function $FilterProvider($provide) {
      var suffix = 'Filter';
      function register(name, factory) {
        if (isObject(name)) {
          var filters = {};
          forEach(name, function(filter, key) {
            filters[key] = register(key, filter);
          });
          return filters;
        } else {
          return $provide.factory(name + suffix, factory);
        }
      }
      this.register = register;
      this.$get = ['$injector', function($injector) {
        return function(name) {
          return $injector.get(name + suffix);
        };
      }];
      register('currency', currencyFilter);
      register('date', dateFilter);
      register('filter', filterFilter);
      register('json', jsonFilter);
      register('limitTo', limitToFilter);
      register('lowercase', lowercaseFilter);
      register('number', numberFilter);
      register('orderBy', orderByFilter);
      register('uppercase', uppercaseFilter);
    }
    function filterFilter() {
      return function(array, expression, comparator) {
        if (!isArrayLike(array)) {
          if (array == null) {
            return array;
          } else {
            throw minErr('filter')('notarray', 'Expected array but received: {0}', array);
          }
        }
        var expressionType = getTypeForFilter(expression);
        var predicateFn;
        var matchAgainstAnyProp;
        switch (expressionType) {
          case 'function':
            predicateFn = expression;
            break;
          case 'boolean':
          case 'null':
          case 'number':
          case 'string':
            matchAgainstAnyProp = true;
          case 'object':
            predicateFn = createPredicateFn(expression, comparator, matchAgainstAnyProp);
            break;
          default:
            return array;
        }
        return Array.prototype.filter.call(array, predicateFn);
      };
    }
    function createPredicateFn(expression, comparator, matchAgainstAnyProp) {
      var shouldMatchPrimitives = isObject(expression) && ('$' in expression);
      var predicateFn;
      if (comparator === true) {
        comparator = equals;
      } else if (!isFunction(comparator)) {
        comparator = function(actual, expected) {
          if (isUndefined(actual)) {
            return false;
          }
          if ((actual === null) || (expected === null)) {
            return actual === expected;
          }
          if (isObject(expected) || (isObject(actual) && !hasCustomToString(actual))) {
            return false;
          }
          actual = lowercase('' + actual);
          expected = lowercase('' + expected);
          return actual.indexOf(expected) !== -1;
        };
      }
      predicateFn = function(item) {
        if (shouldMatchPrimitives && !isObject(item)) {
          return deepCompare(item, expression.$, comparator, false);
        }
        return deepCompare(item, expression, comparator, matchAgainstAnyProp);
      };
      return predicateFn;
    }
    function deepCompare(actual, expected, comparator, matchAgainstAnyProp, dontMatchWholeObject) {
      var actualType = getTypeForFilter(actual);
      var expectedType = getTypeForFilter(expected);
      if ((expectedType === 'string') && (expected.charAt(0) === '!')) {
        return !deepCompare(actual, expected.substring(1), comparator, matchAgainstAnyProp);
      } else if (isArray(actual)) {
        return actual.some(function(item) {
          return deepCompare(item, expected, comparator, matchAgainstAnyProp);
        });
      }
      switch (actualType) {
        case 'object':
          var key;
          if (matchAgainstAnyProp) {
            for (key in actual) {
              if ((key.charAt(0) !== '$') && deepCompare(actual[key], expected, comparator, true)) {
                return true;
              }
            }
            return dontMatchWholeObject ? false : deepCompare(actual, expected, comparator, false);
          } else if (expectedType === 'object') {
            for (key in expected) {
              var expectedVal = expected[key];
              if (isFunction(expectedVal) || isUndefined(expectedVal)) {
                continue;
              }
              var matchAnyProperty = key === '$';
              var actualVal = matchAnyProperty ? actual : actual[key];
              if (!deepCompare(actualVal, expectedVal, comparator, matchAnyProperty, matchAnyProperty)) {
                return false;
              }
            }
            return true;
          } else {
            return comparator(actual, expected);
          }
          break;
        case 'function':
          return false;
        default:
          return comparator(actual, expected);
      }
    }
    function getTypeForFilter(val) {
      return (val === null) ? 'null' : typeof val;
    }
    currencyFilter.$inject = ['$locale'];
    function currencyFilter($locale) {
      var formats = $locale.NUMBER_FORMATS;
      return function(amount, currencySymbol, fractionSize) {
        if (isUndefined(currencySymbol)) {
          currencySymbol = formats.CURRENCY_SYM;
        }
        if (isUndefined(fractionSize)) {
          fractionSize = formats.PATTERNS[1].maxFrac;
        }
        return (amount == null) ? amount : formatNumber(amount, formats.PATTERNS[1], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize).replace(/\u00A4/g, currencySymbol);
      };
    }
    numberFilter.$inject = ['$locale'];
    function numberFilter($locale) {
      var formats = $locale.NUMBER_FORMATS;
      return function(number, fractionSize) {
        return (number == null) ? number : formatNumber(number, formats.PATTERNS[0], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize);
      };
    }
    var DECIMAL_SEP = '.';
    function formatNumber(number, pattern, groupSep, decimalSep, fractionSize) {
      if (isObject(number))
        return '';
      var isNegative = number < 0;
      number = Math.abs(number);
      var isInfinity = number === Infinity;
      if (!isInfinity && !isFinite(number))
        return '';
      var numStr = number + '',
          formatedText = '',
          hasExponent = false,
          parts = [];
      if (isInfinity)
        formatedText = '\u221e';
      if (!isInfinity && numStr.indexOf('e') !== -1) {
        var match = numStr.match(/([\d\.]+)e(-?)(\d+)/);
        if (match && match[2] == '-' && match[3] > fractionSize + 1) {
          number = 0;
        } else {
          formatedText = numStr;
          hasExponent = true;
        }
      }
      if (!isInfinity && !hasExponent) {
        var fractionLen = (numStr.split(DECIMAL_SEP)[1] || '').length;
        if (isUndefined(fractionSize)) {
          fractionSize = Math.min(Math.max(pattern.minFrac, fractionLen), pattern.maxFrac);
        }
        number = +(Math.round(+(number.toString() + 'e' + fractionSize)).toString() + 'e' + -fractionSize);
        var fraction = ('' + number).split(DECIMAL_SEP);
        var whole = fraction[0];
        fraction = fraction[1] || '';
        var i,
            pos = 0,
            lgroup = pattern.lgSize,
            group = pattern.gSize;
        if (whole.length >= (lgroup + group)) {
          pos = whole.length - lgroup;
          for (i = 0; i < pos; i++) {
            if ((pos - i) % group === 0 && i !== 0) {
              formatedText += groupSep;
            }
            formatedText += whole.charAt(i);
          }
        }
        for (i = pos; i < whole.length; i++) {
          if ((whole.length - i) % lgroup === 0 && i !== 0) {
            formatedText += groupSep;
          }
          formatedText += whole.charAt(i);
        }
        while (fraction.length < fractionSize) {
          fraction += '0';
        }
        if (fractionSize && fractionSize !== "0")
          formatedText += decimalSep + fraction.substr(0, fractionSize);
      } else {
        if (fractionSize > 0 && number < 1) {
          formatedText = number.toFixed(fractionSize);
          number = parseFloat(formatedText);
          formatedText = formatedText.replace(DECIMAL_SEP, decimalSep);
        }
      }
      if (number === 0) {
        isNegative = false;
      }
      parts.push(isNegative ? pattern.negPre : pattern.posPre, formatedText, isNegative ? pattern.negSuf : pattern.posSuf);
      return parts.join('');
    }
    function padNumber(num, digits, trim) {
      var neg = '';
      if (num < 0) {
        neg = '-';
        num = -num;
      }
      num = '' + num;
      while (num.length < digits)
        num = '0' + num;
      if (trim) {
        num = num.substr(num.length - digits);
      }
      return neg + num;
    }
    function dateGetter(name, size, offset, trim) {
      offset = offset || 0;
      return function(date) {
        var value = date['get' + name]();
        if (offset > 0 || value > -offset) {
          value += offset;
        }
        if (value === 0 && offset == -12)
          value = 12;
        return padNumber(value, size, trim);
      };
    }
    function dateStrGetter(name, shortForm) {
      return function(date, formats) {
        var value = date['get' + name]();
        var get = uppercase(shortForm ? ('SHORT' + name) : name);
        return formats[get][value];
      };
    }
    function timeZoneGetter(date, formats, offset) {
      var zone = -1 * offset;
      var paddedZone = (zone >= 0) ? "+" : "";
      paddedZone += padNumber(Math[zone > 0 ? 'floor' : 'ceil'](zone / 60), 2) + padNumber(Math.abs(zone % 60), 2);
      return paddedZone;
    }
    function getFirstThursdayOfYear(year) {
      var dayOfWeekOnFirst = (new Date(year, 0, 1)).getDay();
      return new Date(year, 0, ((dayOfWeekOnFirst <= 4) ? 5 : 12) - dayOfWeekOnFirst);
    }
    function getThursdayThisWeek(datetime) {
      return new Date(datetime.getFullYear(), datetime.getMonth(), datetime.getDate() + (4 - datetime.getDay()));
    }
    function weekGetter(size) {
      return function(date) {
        var firstThurs = getFirstThursdayOfYear(date.getFullYear()),
            thisThurs = getThursdayThisWeek(date);
        var diff = +thisThurs - +firstThurs,
            result = 1 + Math.round(diff / 6.048e8);
        return padNumber(result, size);
      };
    }
    function ampmGetter(date, formats) {
      return date.getHours() < 12 ? formats.AMPMS[0] : formats.AMPMS[1];
    }
    function eraGetter(date, formats) {
      return date.getFullYear() <= 0 ? formats.ERAS[0] : formats.ERAS[1];
    }
    function longEraGetter(date, formats) {
      return date.getFullYear() <= 0 ? formats.ERANAMES[0] : formats.ERANAMES[1];
    }
    var DATE_FORMATS = {
      yyyy: dateGetter('FullYear', 4),
      yy: dateGetter('FullYear', 2, 0, true),
      y: dateGetter('FullYear', 1),
      MMMM: dateStrGetter('Month'),
      MMM: dateStrGetter('Month', true),
      MM: dateGetter('Month', 2, 1),
      M: dateGetter('Month', 1, 1),
      dd: dateGetter('Date', 2),
      d: dateGetter('Date', 1),
      HH: dateGetter('Hours', 2),
      H: dateGetter('Hours', 1),
      hh: dateGetter('Hours', 2, -12),
      h: dateGetter('Hours', 1, -12),
      mm: dateGetter('Minutes', 2),
      m: dateGetter('Minutes', 1),
      ss: dateGetter('Seconds', 2),
      s: dateGetter('Seconds', 1),
      sss: dateGetter('Milliseconds', 3),
      EEEE: dateStrGetter('Day'),
      EEE: dateStrGetter('Day', true),
      a: ampmGetter,
      Z: timeZoneGetter,
      ww: weekGetter(2),
      w: weekGetter(1),
      G: eraGetter,
      GG: eraGetter,
      GGG: eraGetter,
      GGGG: longEraGetter
    };
    var DATE_FORMATS_SPLIT = /((?:[^yMdHhmsaZEwG']+)|(?:'(?:[^']|'')*')|(?:E+|y+|M+|d+|H+|h+|m+|s+|a|Z|G+|w+))(.*)/,
        NUMBER_STRING = /^\-?\d+$/;
    dateFilter.$inject = ['$locale'];
    function dateFilter($locale) {
      var R_ISO8601_STR = /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;
      function jsonStringToDate(string) {
        var match;
        if (match = string.match(R_ISO8601_STR)) {
          var date = new Date(0),
              tzHour = 0,
              tzMin = 0,
              dateSetter = match[8] ? date.setUTCFullYear : date.setFullYear,
              timeSetter = match[8] ? date.setUTCHours : date.setHours;
          if (match[9]) {
            tzHour = toInt(match[9] + match[10]);
            tzMin = toInt(match[9] + match[11]);
          }
          dateSetter.call(date, toInt(match[1]), toInt(match[2]) - 1, toInt(match[3]));
          var h = toInt(match[4] || 0) - tzHour;
          var m = toInt(match[5] || 0) - tzMin;
          var s = toInt(match[6] || 0);
          var ms = Math.round(parseFloat('0.' + (match[7] || 0)) * 1000);
          timeSetter.call(date, h, m, s, ms);
          return date;
        }
        return string;
      }
      return function(date, format, timezone) {
        var text = '',
            parts = [],
            fn,
            match;
        format = format || 'mediumDate';
        format = $locale.DATETIME_FORMATS[format] || format;
        if (isString(date)) {
          date = NUMBER_STRING.test(date) ? toInt(date) : jsonStringToDate(date);
        }
        if (isNumber(date)) {
          date = new Date(date);
        }
        if (!isDate(date) || !isFinite(date.getTime())) {
          return date;
        }
        while (format) {
          match = DATE_FORMATS_SPLIT.exec(format);
          if (match) {
            parts = concat(parts, match, 1);
            format = parts.pop();
          } else {
            parts.push(format);
            format = null;
          }
        }
        var dateTimezoneOffset = date.getTimezoneOffset();
        if (timezone) {
          dateTimezoneOffset = timezoneToOffset(timezone, date.getTimezoneOffset());
          date = convertTimezoneToLocal(date, timezone, true);
        }
        forEach(parts, function(value) {
          fn = DATE_FORMATS[value];
          text += fn ? fn(date, $locale.DATETIME_FORMATS, dateTimezoneOffset) : value.replace(/(^'|'$)/g, '').replace(/''/g, "'");
        });
        return text;
      };
    }
    function jsonFilter() {
      return function(object, spacing) {
        if (isUndefined(spacing)) {
          spacing = 2;
        }
        return toJson(object, spacing);
      };
    }
    var lowercaseFilter = valueFn(lowercase);
    var uppercaseFilter = valueFn(uppercase);
    function limitToFilter() {
      return function(input, limit, begin) {
        if (Math.abs(Number(limit)) === Infinity) {
          limit = Number(limit);
        } else {
          limit = toInt(limit);
        }
        if (isNaN(limit))
          return input;
        if (isNumber(input))
          input = input.toString();
        if (!isArray(input) && !isString(input))
          return input;
        begin = (!begin || isNaN(begin)) ? 0 : toInt(begin);
        begin = (begin < 0 && begin >= -input.length) ? input.length + begin : begin;
        if (limit >= 0) {
          return input.slice(begin, begin + limit);
        } else {
          if (begin === 0) {
            return input.slice(limit, input.length);
          } else {
            return input.slice(Math.max(0, begin + limit), begin);
          }
        }
      };
    }
    orderByFilter.$inject = ['$parse'];
    function orderByFilter($parse) {
      return function(array, sortPredicate, reverseOrder) {
        if (!(isArrayLike(array)))
          return array;
        if (!isArray(sortPredicate)) {
          sortPredicate = [sortPredicate];
        }
        if (sortPredicate.length === 0) {
          sortPredicate = ['+'];
        }
        var predicates = processPredicates(sortPredicate, reverseOrder);
        predicates.push({
          get: function() {
            return {};
          },
          descending: reverseOrder ? -1 : 1
        });
        var compareValues = Array.prototype.map.call(array, getComparisonObject);
        compareValues.sort(doComparison);
        array = compareValues.map(function(item) {
          return item.value;
        });
        return array;
        function getComparisonObject(value, index) {
          return {
            value: value,
            predicateValues: predicates.map(function(predicate) {
              return getPredicateValue(predicate.get(value), index);
            })
          };
        }
        function doComparison(v1, v2) {
          var result = 0;
          for (var index = 0,
              length = predicates.length; index < length; ++index) {
            result = compare(v1.predicateValues[index], v2.predicateValues[index]) * predicates[index].descending;
            if (result)
              break;
          }
          return result;
        }
      };
      function processPredicates(sortPredicate, reverseOrder) {
        reverseOrder = reverseOrder ? -1 : 1;
        return sortPredicate.map(function(predicate) {
          var descending = 1,
              get = identity;
          if (isFunction(predicate)) {
            get = predicate;
          } else if (isString(predicate)) {
            if ((predicate.charAt(0) == '+' || predicate.charAt(0) == '-')) {
              descending = predicate.charAt(0) == '-' ? -1 : 1;
              predicate = predicate.substring(1);
            }
            if (predicate !== '') {
              get = $parse(predicate);
              if (get.constant) {
                var key = get();
                get = function(value) {
                  return value[key];
                };
              }
            }
          }
          return {
            get: get,
            descending: descending * reverseOrder
          };
        });
      }
      function isPrimitive(value) {
        switch (typeof value) {
          case 'number':
          case 'boolean':
          case 'string':
            return true;
          default:
            return false;
        }
      }
      function objectValue(value, index) {
        if (typeof value.valueOf === 'function') {
          value = value.valueOf();
          if (isPrimitive(value))
            return value;
        }
        if (hasCustomToString(value)) {
          value = value.toString();
          if (isPrimitive(value))
            return value;
        }
        return index;
      }
      function getPredicateValue(value, index) {
        var type = typeof value;
        if (value === null) {
          type = 'string';
          value = 'null';
        } else if (type === 'string') {
          value = value.toLowerCase();
        } else if (type === 'object') {
          value = objectValue(value, index);
        }
        return {
          value: value,
          type: type
        };
      }
      function compare(v1, v2) {
        var result = 0;
        if (v1.type === v2.type) {
          if (v1.value !== v2.value) {
            result = v1.value < v2.value ? -1 : 1;
          }
        } else {
          result = v1.type < v2.type ? -1 : 1;
        }
        return result;
      }
    }
    function ngDirective(directive) {
      if (isFunction(directive)) {
        directive = {link: directive};
      }
      directive.restrict = directive.restrict || 'AC';
      return valueFn(directive);
    }
    var htmlAnchorDirective = valueFn({
      restrict: 'E',
      compile: function(element, attr) {
        if (!attr.href && !attr.xlinkHref) {
          return function(scope, element) {
            if (element[0].nodeName.toLowerCase() !== 'a')
              return;
            var href = toString.call(element.prop('href')) === '[object SVGAnimatedString]' ? 'xlink:href' : 'href';
            element.on('click', function(event) {
              if (!element.attr(href)) {
                event.preventDefault();
              }
            });
          };
        }
      }
    });
    var ngAttributeAliasDirectives = {};
    forEach(BOOLEAN_ATTR, function(propName, attrName) {
      if (propName == "multiple")
        return;
      function defaultLinkFn(scope, element, attr) {
        scope.$watch(attr[normalized], function ngBooleanAttrWatchAction(value) {
          attr.$set(attrName, !!value);
        });
      }
      var normalized = directiveNormalize('ng-' + attrName);
      var linkFn = defaultLinkFn;
      if (propName === 'checked') {
        linkFn = function(scope, element, attr) {
          if (attr.ngModel !== attr[normalized]) {
            defaultLinkFn(scope, element, attr);
          }
        };
      }
      ngAttributeAliasDirectives[normalized] = function() {
        return {
          restrict: 'A',
          priority: 100,
          link: linkFn
        };
      };
    });
    forEach(ALIASED_ATTR, function(htmlAttr, ngAttr) {
      ngAttributeAliasDirectives[ngAttr] = function() {
        return {
          priority: 100,
          link: function(scope, element, attr) {
            if (ngAttr === "ngPattern" && attr.ngPattern.charAt(0) == "/") {
              var match = attr.ngPattern.match(REGEX_STRING_REGEXP);
              if (match) {
                attr.$set("ngPattern", new RegExp(match[1], match[2]));
                return;
              }
            }
            scope.$watch(attr[ngAttr], function ngAttrAliasWatchAction(value) {
              attr.$set(ngAttr, value);
            });
          }
        };
      };
    });
    forEach(['src', 'srcset', 'href'], function(attrName) {
      var normalized = directiveNormalize('ng-' + attrName);
      ngAttributeAliasDirectives[normalized] = function() {
        return {
          priority: 99,
          link: function(scope, element, attr) {
            var propName = attrName,
                name = attrName;
            if (attrName === 'href' && toString.call(element.prop('href')) === '[object SVGAnimatedString]') {
              name = 'xlinkHref';
              attr.$attr[name] = 'xlink:href';
              propName = null;
            }
            attr.$observe(normalized, function(value) {
              if (!value) {
                if (attrName === 'href') {
                  attr.$set(name, null);
                }
                return;
              }
              attr.$set(name, value);
              if (msie && propName)
                element.prop(propName, attr[name]);
            });
          }
        };
      };
    });
    var nullFormCtrl = {
      $addControl: noop,
      $$renameControl: nullFormRenameControl,
      $removeControl: noop,
      $setValidity: noop,
      $setDirty: noop,
      $setPristine: noop,
      $setSubmitted: noop
    },
        SUBMITTED_CLASS = 'ng-submitted';
    function nullFormRenameControl(control, name) {
      control.$name = name;
    }
    FormController.$inject = ['$element', '$attrs', '$scope', '$animate', '$interpolate'];
    function FormController(element, attrs, $scope, $animate, $interpolate) {
      var form = this,
          controls = [];
      form.$error = {};
      form.$$success = {};
      form.$pending = undefined;
      form.$name = $interpolate(attrs.name || attrs.ngForm || '')($scope);
      form.$dirty = false;
      form.$pristine = true;
      form.$valid = true;
      form.$invalid = false;
      form.$submitted = false;
      form.$$parentForm = nullFormCtrl;
      form.$rollbackViewValue = function() {
        forEach(controls, function(control) {
          control.$rollbackViewValue();
        });
      };
      form.$commitViewValue = function() {
        forEach(controls, function(control) {
          control.$commitViewValue();
        });
      };
      form.$addControl = function(control) {
        assertNotHasOwnProperty(control.$name, 'input');
        controls.push(control);
        if (control.$name) {
          form[control.$name] = control;
        }
        control.$$parentForm = form;
      };
      form.$$renameControl = function(control, newName) {
        var oldName = control.$name;
        if (form[oldName] === control) {
          delete form[oldName];
        }
        form[newName] = control;
        control.$name = newName;
      };
      form.$removeControl = function(control) {
        if (control.$name && form[control.$name] === control) {
          delete form[control.$name];
        }
        forEach(form.$pending, function(value, name) {
          form.$setValidity(name, null, control);
        });
        forEach(form.$error, function(value, name) {
          form.$setValidity(name, null, control);
        });
        forEach(form.$$success, function(value, name) {
          form.$setValidity(name, null, control);
        });
        arrayRemove(controls, control);
        control.$$parentForm = nullFormCtrl;
      };
      addSetValidityMethod({
        ctrl: this,
        $element: element,
        set: function(object, property, controller) {
          var list = object[property];
          if (!list) {
            object[property] = [controller];
          } else {
            var index = list.indexOf(controller);
            if (index === -1) {
              list.push(controller);
            }
          }
        },
        unset: function(object, property, controller) {
          var list = object[property];
          if (!list) {
            return;
          }
          arrayRemove(list, controller);
          if (list.length === 0) {
            delete object[property];
          }
        },
        $animate: $animate
      });
      form.$setDirty = function() {
        $animate.removeClass(element, PRISTINE_CLASS);
        $animate.addClass(element, DIRTY_CLASS);
        form.$dirty = true;
        form.$pristine = false;
        form.$$parentForm.$setDirty();
      };
      form.$setPristine = function() {
        $animate.setClass(element, PRISTINE_CLASS, DIRTY_CLASS + ' ' + SUBMITTED_CLASS);
        form.$dirty = false;
        form.$pristine = true;
        form.$submitted = false;
        forEach(controls, function(control) {
          control.$setPristine();
        });
      };
      form.$setUntouched = function() {
        forEach(controls, function(control) {
          control.$setUntouched();
        });
      };
      form.$setSubmitted = function() {
        $animate.addClass(element, SUBMITTED_CLASS);
        form.$submitted = true;
        form.$$parentForm.$setSubmitted();
      };
    }
    var formDirectiveFactory = function(isNgForm) {
      return ['$timeout', '$parse', function($timeout, $parse) {
        var formDirective = {
          name: 'form',
          restrict: isNgForm ? 'EAC' : 'E',
          require: ['form', '^^?form'],
          controller: FormController,
          compile: function ngFormCompile(formElement, attr) {
            formElement.addClass(PRISTINE_CLASS).addClass(VALID_CLASS);
            var nameAttr = attr.name ? 'name' : (isNgForm && attr.ngForm ? 'ngForm' : false);
            return {pre: function ngFormPreLink(scope, formElement, attr, ctrls) {
                var controller = ctrls[0];
                if (!('action' in attr)) {
                  var handleFormSubmission = function(event) {
                    scope.$apply(function() {
                      controller.$commitViewValue();
                      controller.$setSubmitted();
                    });
                    event.preventDefault();
                  };
                  addEventListenerFn(formElement[0], 'submit', handleFormSubmission);
                  formElement.on('$destroy', function() {
                    $timeout(function() {
                      removeEventListenerFn(formElement[0], 'submit', handleFormSubmission);
                    }, 0, false);
                  });
                }
                var parentFormCtrl = ctrls[1] || controller.$$parentForm;
                parentFormCtrl.$addControl(controller);
                var setter = nameAttr ? getSetter(controller.$name) : noop;
                if (nameAttr) {
                  setter(scope, controller);
                  attr.$observe(nameAttr, function(newValue) {
                    if (controller.$name === newValue)
                      return;
                    setter(scope, undefined);
                    controller.$$parentForm.$$renameControl(controller, newValue);
                    setter = getSetter(controller.$name);
                    setter(scope, controller);
                  });
                }
                formElement.on('$destroy', function() {
                  controller.$$parentForm.$removeControl(controller);
                  setter(scope, undefined);
                  extend(controller, nullFormCtrl);
                });
              }};
          }
        };
        return formDirective;
        function getSetter(expression) {
          if (expression === '') {
            return $parse('this[""]').assign;
          }
          return $parse(expression).assign || noop;
        }
      }];
    };
    var formDirective = formDirectiveFactory();
    var ngFormDirective = formDirectiveFactory(true);
    var ISO_DATE_REGEXP = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/;
    var URL_REGEXP = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
    var EMAIL_REGEXP = /^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    var NUMBER_REGEXP = /^\s*(\-|\+)?(\d+|(\d*(\.\d*)))([eE][+-]?\d+)?\s*$/;
    var DATE_REGEXP = /^(\d{4})-(\d{2})-(\d{2})$/;
    var DATETIMELOCAL_REGEXP = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;
    var WEEK_REGEXP = /^(\d{4})-W(\d\d)$/;
    var MONTH_REGEXP = /^(\d{4})-(\d\d)$/;
    var TIME_REGEXP = /^(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;
    var inputType = {
      'text': textInputType,
      'date': createDateInputType('date', DATE_REGEXP, createDateParser(DATE_REGEXP, ['yyyy', 'MM', 'dd']), 'yyyy-MM-dd'),
      'datetime-local': createDateInputType('datetimelocal', DATETIMELOCAL_REGEXP, createDateParser(DATETIMELOCAL_REGEXP, ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'sss']), 'yyyy-MM-ddTHH:mm:ss.sss'),
      'time': createDateInputType('time', TIME_REGEXP, createDateParser(TIME_REGEXP, ['HH', 'mm', 'ss', 'sss']), 'HH:mm:ss.sss'),
      'week': createDateInputType('week', WEEK_REGEXP, weekParser, 'yyyy-Www'),
      'month': createDateInputType('month', MONTH_REGEXP, createDateParser(MONTH_REGEXP, ['yyyy', 'MM']), 'yyyy-MM'),
      'number': numberInputType,
      'url': urlInputType,
      'email': emailInputType,
      'radio': radioInputType,
      'checkbox': checkboxInputType,
      'hidden': noop,
      'button': noop,
      'submit': noop,
      'reset': noop,
      'file': noop
    };
    function stringBasedInputType(ctrl) {
      ctrl.$formatters.push(function(value) {
        return ctrl.$isEmpty(value) ? value : value.toString();
      });
    }
    function textInputType(scope, element, attr, ctrl, $sniffer, $browser) {
      baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
      stringBasedInputType(ctrl);
    }
    function baseInputType(scope, element, attr, ctrl, $sniffer, $browser) {
      var type = lowercase(element[0].type);
      if (!$sniffer.android) {
        var composing = false;
        element.on('compositionstart', function(data) {
          composing = true;
        });
        element.on('compositionend', function() {
          composing = false;
          listener();
        });
      }
      var listener = function(ev) {
        if (timeout) {
          $browser.defer.cancel(timeout);
          timeout = null;
        }
        if (composing)
          return;
        var value = element.val(),
            event = ev && ev.type;
        if (type !== 'password' && (!attr.ngTrim || attr.ngTrim !== 'false')) {
          value = trim(value);
        }
        if (ctrl.$viewValue !== value || (value === '' && ctrl.$$hasNativeValidators)) {
          ctrl.$setViewValue(value, event);
        }
      };
      if ($sniffer.hasEvent('input')) {
        element.on('input', listener);
      } else {
        var timeout;
        var deferListener = function(ev, input, origValue) {
          if (!timeout) {
            timeout = $browser.defer(function() {
              timeout = null;
              if (!input || input.value !== origValue) {
                listener(ev);
              }
            });
          }
        };
        element.on('keydown', function(event) {
          var key = event.keyCode;
          if (key === 91 || (15 < key && key < 19) || (37 <= key && key <= 40))
            return;
          deferListener(event, this, this.value);
        });
        if ($sniffer.hasEvent('paste')) {
          element.on('paste cut', deferListener);
        }
      }
      element.on('change', listener);
      ctrl.$render = function() {
        var value = ctrl.$isEmpty(ctrl.$viewValue) ? '' : ctrl.$viewValue;
        if (element.val() !== value) {
          element.val(value);
        }
      };
    }
    function weekParser(isoWeek, existingDate) {
      if (isDate(isoWeek)) {
        return isoWeek;
      }
      if (isString(isoWeek)) {
        WEEK_REGEXP.lastIndex = 0;
        var parts = WEEK_REGEXP.exec(isoWeek);
        if (parts) {
          var year = +parts[1],
              week = +parts[2],
              hours = 0,
              minutes = 0,
              seconds = 0,
              milliseconds = 0,
              firstThurs = getFirstThursdayOfYear(year),
              addDays = (week - 1) * 7;
          if (existingDate) {
            hours = existingDate.getHours();
            minutes = existingDate.getMinutes();
            seconds = existingDate.getSeconds();
            milliseconds = existingDate.getMilliseconds();
          }
          return new Date(year, 0, firstThurs.getDate() + addDays, hours, minutes, seconds, milliseconds);
        }
      }
      return NaN;
    }
    function createDateParser(regexp, mapping) {
      return function(iso, date) {
        var parts,
            map;
        if (isDate(iso)) {
          return iso;
        }
        if (isString(iso)) {
          if (iso.charAt(0) == '"' && iso.charAt(iso.length - 1) == '"') {
            iso = iso.substring(1, iso.length - 1);
          }
          if (ISO_DATE_REGEXP.test(iso)) {
            return new Date(iso);
          }
          regexp.lastIndex = 0;
          parts = regexp.exec(iso);
          if (parts) {
            parts.shift();
            if (date) {
              map = {
                yyyy: date.getFullYear(),
                MM: date.getMonth() + 1,
                dd: date.getDate(),
                HH: date.getHours(),
                mm: date.getMinutes(),
                ss: date.getSeconds(),
                sss: date.getMilliseconds() / 1000
              };
            } else {
              map = {
                yyyy: 1970,
                MM: 1,
                dd: 1,
                HH: 0,
                mm: 0,
                ss: 0,
                sss: 0
              };
            }
            forEach(parts, function(part, index) {
              if (index < mapping.length) {
                map[mapping[index]] = +part;
              }
            });
            return new Date(map.yyyy, map.MM - 1, map.dd, map.HH, map.mm, map.ss || 0, map.sss * 1000 || 0);
          }
        }
        return NaN;
      };
    }
    function createDateInputType(type, regexp, parseDate, format) {
      return function dynamicDateInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter) {
        badInputChecker(scope, element, attr, ctrl);
        baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
        var timezone = ctrl && ctrl.$options && ctrl.$options.timezone;
        var previousDate;
        ctrl.$$parserName = type;
        ctrl.$parsers.push(function(value) {
          if (ctrl.$isEmpty(value))
            return null;
          if (regexp.test(value)) {
            var parsedDate = parseDate(value, previousDate);
            if (timezone) {
              parsedDate = convertTimezoneToLocal(parsedDate, timezone);
            }
            return parsedDate;
          }
          return undefined;
        });
        ctrl.$formatters.push(function(value) {
          if (value && !isDate(value)) {
            throw ngModelMinErr('datefmt', 'Expected `{0}` to be a date', value);
          }
          if (isValidDate(value)) {
            previousDate = value;
            if (previousDate && timezone) {
              previousDate = convertTimezoneToLocal(previousDate, timezone, true);
            }
            return $filter('date')(value, format, timezone);
          } else {
            previousDate = null;
            return '';
          }
        });
        if (isDefined(attr.min) || attr.ngMin) {
          var minVal;
          ctrl.$validators.min = function(value) {
            return !isValidDate(value) || isUndefined(minVal) || parseDate(value) >= minVal;
          };
          attr.$observe('min', function(val) {
            minVal = parseObservedDateValue(val);
            ctrl.$validate();
          });
        }
        if (isDefined(attr.max) || attr.ngMax) {
          var maxVal;
          ctrl.$validators.max = function(value) {
            return !isValidDate(value) || isUndefined(maxVal) || parseDate(value) <= maxVal;
          };
          attr.$observe('max', function(val) {
            maxVal = parseObservedDateValue(val);
            ctrl.$validate();
          });
        }
        function isValidDate(value) {
          return value && !(value.getTime && value.getTime() !== value.getTime());
        }
        function parseObservedDateValue(val) {
          return isDefined(val) && !isDate(val) ? parseDate(val) || undefined : val;
        }
      };
    }
    function badInputChecker(scope, element, attr, ctrl) {
      var node = element[0];
      var nativeValidation = ctrl.$$hasNativeValidators = isObject(node.validity);
      if (nativeValidation) {
        ctrl.$parsers.push(function(value) {
          var validity = element.prop(VALIDITY_STATE_PROPERTY) || {};
          return validity.badInput && !validity.typeMismatch ? undefined : value;
        });
      }
    }
    function numberInputType(scope, element, attr, ctrl, $sniffer, $browser) {
      badInputChecker(scope, element, attr, ctrl);
      baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
      ctrl.$$parserName = 'number';
      ctrl.$parsers.push(function(value) {
        if (ctrl.$isEmpty(value))
          return null;
        if (NUMBER_REGEXP.test(value))
          return parseFloat(value);
        return undefined;
      });
      ctrl.$formatters.push(function(value) {
        if (!ctrl.$isEmpty(value)) {
          if (!isNumber(value)) {
            throw ngModelMinErr('numfmt', 'Expected `{0}` to be a number', value);
          }
          value = value.toString();
        }
        return value;
      });
      if (isDefined(attr.min) || attr.ngMin) {
        var minVal;
        ctrl.$validators.min = function(value) {
          return ctrl.$isEmpty(value) || isUndefined(minVal) || value >= minVal;
        };
        attr.$observe('min', function(val) {
          if (isDefined(val) && !isNumber(val)) {
            val = parseFloat(val, 10);
          }
          minVal = isNumber(val) && !isNaN(val) ? val : undefined;
          ctrl.$validate();
        });
      }
      if (isDefined(attr.max) || attr.ngMax) {
        var maxVal;
        ctrl.$validators.max = function(value) {
          return ctrl.$isEmpty(value) || isUndefined(maxVal) || value <= maxVal;
        };
        attr.$observe('max', function(val) {
          if (isDefined(val) && !isNumber(val)) {
            val = parseFloat(val, 10);
          }
          maxVal = isNumber(val) && !isNaN(val) ? val : undefined;
          ctrl.$validate();
        });
      }
    }
    function urlInputType(scope, element, attr, ctrl, $sniffer, $browser) {
      baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
      stringBasedInputType(ctrl);
      ctrl.$$parserName = 'url';
      ctrl.$validators.url = function(modelValue, viewValue) {
        var value = modelValue || viewValue;
        return ctrl.$isEmpty(value) || URL_REGEXP.test(value);
      };
    }
    function emailInputType(scope, element, attr, ctrl, $sniffer, $browser) {
      baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
      stringBasedInputType(ctrl);
      ctrl.$$parserName = 'email';
      ctrl.$validators.email = function(modelValue, viewValue) {
        var value = modelValue || viewValue;
        return ctrl.$isEmpty(value) || EMAIL_REGEXP.test(value);
      };
    }
    function radioInputType(scope, element, attr, ctrl) {
      if (isUndefined(attr.name)) {
        element.attr('name', nextUid());
      }
      var listener = function(ev) {
        if (element[0].checked) {
          ctrl.$setViewValue(attr.value, ev && ev.type);
        }
      };
      element.on('click', listener);
      ctrl.$render = function() {
        var value = attr.value;
        element[0].checked = (value == ctrl.$viewValue);
      };
      attr.$observe('value', ctrl.$render);
    }
    function parseConstantExpr($parse, context, name, expression, fallback) {
      var parseFn;
      if (isDefined(expression)) {
        parseFn = $parse(expression);
        if (!parseFn.constant) {
          throw ngModelMinErr('constexpr', 'Expected constant expression for `{0}`, but saw ' + '`{1}`.', name, expression);
        }
        return parseFn(context);
      }
      return fallback;
    }
    function checkboxInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter, $parse) {
      var trueValue = parseConstantExpr($parse, scope, 'ngTrueValue', attr.ngTrueValue, true);
      var falseValue = parseConstantExpr($parse, scope, 'ngFalseValue', attr.ngFalseValue, false);
      var listener = function(ev) {
        ctrl.$setViewValue(element[0].checked, ev && ev.type);
      };
      element.on('click', listener);
      ctrl.$render = function() {
        element[0].checked = ctrl.$viewValue;
      };
      ctrl.$isEmpty = function(value) {
        return value === false;
      };
      ctrl.$formatters.push(function(value) {
        return equals(value, trueValue);
      });
      ctrl.$parsers.push(function(value) {
        return value ? trueValue : falseValue;
      });
    }
    var inputDirective = ['$browser', '$sniffer', '$filter', '$parse', function($browser, $sniffer, $filter, $parse) {
      return {
        restrict: 'E',
        require: ['?ngModel'],
        link: {pre: function(scope, element, attr, ctrls) {
            if (ctrls[0]) {
              (inputType[lowercase(attr.type)] || inputType.text)(scope, element, attr, ctrls[0], $sniffer, $browser, $filter, $parse);
            }
          }}
      };
    }];
    var CONSTANT_VALUE_REGEXP = /^(true|false|\d+)$/;
    var ngValueDirective = function() {
      return {
        restrict: 'A',
        priority: 100,
        compile: function(tpl, tplAttr) {
          if (CONSTANT_VALUE_REGEXP.test(tplAttr.ngValue)) {
            return function ngValueConstantLink(scope, elm, attr) {
              attr.$set('value', scope.$eval(attr.ngValue));
            };
          } else {
            return function ngValueLink(scope, elm, attr) {
              scope.$watch(attr.ngValue, function valueWatchAction(value) {
                attr.$set('value', value);
              });
            };
          }
        }
      };
    };
    var ngBindDirective = ['$compile', function($compile) {
      return {
        restrict: 'AC',
        compile: function ngBindCompile(templateElement) {
          $compile.$$addBindingClass(templateElement);
          return function ngBindLink(scope, element, attr) {
            $compile.$$addBindingInfo(element, attr.ngBind);
            element = element[0];
            scope.$watch(attr.ngBind, function ngBindWatchAction(value) {
              element.textContent = isUndefined(value) ? '' : value;
            });
          };
        }
      };
    }];
    var ngBindTemplateDirective = ['$interpolate', '$compile', function($interpolate, $compile) {
      return {compile: function ngBindTemplateCompile(templateElement) {
          $compile.$$addBindingClass(templateElement);
          return function ngBindTemplateLink(scope, element, attr) {
            var interpolateFn = $interpolate(element.attr(attr.$attr.ngBindTemplate));
            $compile.$$addBindingInfo(element, interpolateFn.expressions);
            element = element[0];
            attr.$observe('ngBindTemplate', function(value) {
              element.textContent = isUndefined(value) ? '' : value;
            });
          };
        }};
    }];
    var ngBindHtmlDirective = ['$sce', '$parse', '$compile', function($sce, $parse, $compile) {
      return {
        restrict: 'A',
        compile: function ngBindHtmlCompile(tElement, tAttrs) {
          var ngBindHtmlGetter = $parse(tAttrs.ngBindHtml);
          var ngBindHtmlWatch = $parse(tAttrs.ngBindHtml, function getStringValue(value) {
            return (value || '').toString();
          });
          $compile.$$addBindingClass(tElement);
          return function ngBindHtmlLink(scope, element, attr) {
            $compile.$$addBindingInfo(element, attr.ngBindHtml);
            scope.$watch(ngBindHtmlWatch, function ngBindHtmlWatchAction() {
              element.html($sce.getTrustedHtml(ngBindHtmlGetter(scope)) || '');
            });
          };
        }
      };
    }];
    var ngChangeDirective = valueFn({
      restrict: 'A',
      require: 'ngModel',
      link: function(scope, element, attr, ctrl) {
        ctrl.$viewChangeListeners.push(function() {
          scope.$eval(attr.ngChange);
        });
      }
    });
    function classDirective(name, selector) {
      name = 'ngClass' + name;
      return ['$animate', function($animate) {
        return {
          restrict: 'AC',
          link: function(scope, element, attr) {
            var oldVal;
            scope.$watch(attr[name], ngClassWatchAction, true);
            attr.$observe('class', function(value) {
              ngClassWatchAction(scope.$eval(attr[name]));
            });
            if (name !== 'ngClass') {
              scope.$watch('$index', function($index, old$index) {
                var mod = $index & 1;
                if (mod !== (old$index & 1)) {
                  var classes = arrayClasses(scope.$eval(attr[name]));
                  mod === selector ? addClasses(classes) : removeClasses(classes);
                }
              });
            }
            function addClasses(classes) {
              var newClasses = digestClassCounts(classes, 1);
              attr.$addClass(newClasses);
            }
            function removeClasses(classes) {
              var newClasses = digestClassCounts(classes, -1);
              attr.$removeClass(newClasses);
            }
            function digestClassCounts(classes, count) {
              var classCounts = element.data('$classCounts') || createMap();
              var classesToUpdate = [];
              forEach(classes, function(className) {
                if (count > 0 || classCounts[className]) {
                  classCounts[className] = (classCounts[className] || 0) + count;
                  if (classCounts[className] === +(count > 0)) {
                    classesToUpdate.push(className);
                  }
                }
              });
              element.data('$classCounts', classCounts);
              return classesToUpdate.join(' ');
            }
            function updateClasses(oldClasses, newClasses) {
              var toAdd = arrayDifference(newClasses, oldClasses);
              var toRemove = arrayDifference(oldClasses, newClasses);
              toAdd = digestClassCounts(toAdd, 1);
              toRemove = digestClassCounts(toRemove, -1);
              if (toAdd && toAdd.length) {
                $animate.addClass(element, toAdd);
              }
              if (toRemove && toRemove.length) {
                $animate.removeClass(element, toRemove);
              }
            }
            function ngClassWatchAction(newVal) {
              if (selector === true || scope.$index % 2 === selector) {
                var newClasses = arrayClasses(newVal || []);
                if (!oldVal) {
                  addClasses(newClasses);
                } else if (!equals(newVal, oldVal)) {
                  var oldClasses = arrayClasses(oldVal);
                  updateClasses(oldClasses, newClasses);
                }
              }
              oldVal = shallowCopy(newVal);
            }
          }
        };
        function arrayDifference(tokens1, tokens2) {
          var values = [];
          outer: for (var i = 0; i < tokens1.length; i++) {
            var token = tokens1[i];
            for (var j = 0; j < tokens2.length; j++) {
              if (token == tokens2[j])
                continue outer;
            }
            values.push(token);
          }
          return values;
        }
        function arrayClasses(classVal) {
          var classes = [];
          if (isArray(classVal)) {
            forEach(classVal, function(v) {
              classes = classes.concat(arrayClasses(v));
            });
            return classes;
          } else if (isString(classVal)) {
            return classVal.split(' ');
          } else if (isObject(classVal)) {
            forEach(classVal, function(v, k) {
              if (v) {
                classes = classes.concat(k.split(' '));
              }
            });
            return classes;
          }
          return classVal;
        }
      }];
    }
    var ngClassDirective = classDirective('', true);
    var ngClassOddDirective = classDirective('Odd', 0);
    var ngClassEvenDirective = classDirective('Even', 1);
    var ngCloakDirective = ngDirective({compile: function(element, attr) {
        attr.$set('ngCloak', undefined);
        element.removeClass('ng-cloak');
      }});
    var ngControllerDirective = [function() {
      return {
        restrict: 'A',
        scope: true,
        controller: '@',
        priority: 500
      };
    }];
    var ngEventDirectives = {};
    var forceAsyncEvents = {
      'blur': true,
      'focus': true
    };
    forEach('click dblclick mousedown mouseup mouseover mouseout mousemove mouseenter mouseleave keydown keyup keypress submit focus blur copy cut paste'.split(' '), function(eventName) {
      var directiveName = directiveNormalize('ng-' + eventName);
      ngEventDirectives[directiveName] = ['$parse', '$rootScope', function($parse, $rootScope) {
        return {
          restrict: 'A',
          compile: function($element, attr) {
            var fn = $parse(attr[directiveName], null, true);
            return function ngEventHandler(scope, element) {
              element.on(eventName, function(event) {
                var callback = function() {
                  fn(scope, {$event: event});
                };
                if (forceAsyncEvents[eventName] && $rootScope.$$phase) {
                  scope.$evalAsync(callback);
                } else {
                  scope.$apply(callback);
                }
              });
            };
          }
        };
      }];
    });
    var ngIfDirective = ['$animate', function($animate) {
      return {
        multiElement: true,
        transclude: 'element',
        priority: 600,
        terminal: true,
        restrict: 'A',
        $$tlb: true,
        link: function($scope, $element, $attr, ctrl, $transclude) {
          var block,
              childScope,
              previousElements;
          $scope.$watch($attr.ngIf, function ngIfWatchAction(value) {
            if (value) {
              if (!childScope) {
                $transclude(function(clone, newScope) {
                  childScope = newScope;
                  clone[clone.length++] = document.createComment(' end ngIf: ' + $attr.ngIf + ' ');
                  block = {clone: clone};
                  $animate.enter(clone, $element.parent(), $element);
                });
              }
            } else {
              if (previousElements) {
                previousElements.remove();
                previousElements = null;
              }
              if (childScope) {
                childScope.$destroy();
                childScope = null;
              }
              if (block) {
                previousElements = getBlockNodes(block.clone);
                $animate.leave(previousElements).then(function() {
                  previousElements = null;
                });
                block = null;
              }
            }
          });
        }
      };
    }];
    var ngIncludeDirective = ['$templateRequest', '$anchorScroll', '$animate', function($templateRequest, $anchorScroll, $animate) {
      return {
        restrict: 'ECA',
        priority: 400,
        terminal: true,
        transclude: 'element',
        controller: angular.noop,
        compile: function(element, attr) {
          var srcExp = attr.ngInclude || attr.src,
              onloadExp = attr.onload || '',
              autoScrollExp = attr.autoscroll;
          return function(scope, $element, $attr, ctrl, $transclude) {
            var changeCounter = 0,
                currentScope,
                previousElement,
                currentElement;
            var cleanupLastIncludeContent = function() {
              if (previousElement) {
                previousElement.remove();
                previousElement = null;
              }
              if (currentScope) {
                currentScope.$destroy();
                currentScope = null;
              }
              if (currentElement) {
                $animate.leave(currentElement).then(function() {
                  previousElement = null;
                });
                previousElement = currentElement;
                currentElement = null;
              }
            };
            scope.$watch(srcExp, function ngIncludeWatchAction(src) {
              var afterAnimation = function() {
                if (isDefined(autoScrollExp) && (!autoScrollExp || scope.$eval(autoScrollExp))) {
                  $anchorScroll();
                }
              };
              var thisChangeId = ++changeCounter;
              if (src) {
                $templateRequest(src, true).then(function(response) {
                  if (thisChangeId !== changeCounter)
                    return;
                  var newScope = scope.$new();
                  ctrl.template = response;
                  var clone = $transclude(newScope, function(clone) {
                    cleanupLastIncludeContent();
                    $animate.enter(clone, null, $element).then(afterAnimation);
                  });
                  currentScope = newScope;
                  currentElement = clone;
                  currentScope.$emit('$includeContentLoaded', src);
                  scope.$eval(onloadExp);
                }, function() {
                  if (thisChangeId === changeCounter) {
                    cleanupLastIncludeContent();
                    scope.$emit('$includeContentError', src);
                  }
                });
                scope.$emit('$includeContentRequested', src);
              } else {
                cleanupLastIncludeContent();
                ctrl.template = null;
              }
            });
          };
        }
      };
    }];
    var ngIncludeFillContentDirective = ['$compile', function($compile) {
      return {
        restrict: 'ECA',
        priority: -400,
        require: 'ngInclude',
        link: function(scope, $element, $attr, ctrl) {
          if (/SVG/.test($element[0].toString())) {
            $element.empty();
            $compile(jqLiteBuildFragment(ctrl.template, document).childNodes)(scope, function namespaceAdaptedClone(clone) {
              $element.append(clone);
            }, {futureParentElement: $element});
            return;
          }
          $element.html(ctrl.template);
          $compile($element.contents())(scope);
        }
      };
    }];
    var ngInitDirective = ngDirective({
      priority: 450,
      compile: function() {
        return {pre: function(scope, element, attrs) {
            scope.$eval(attrs.ngInit);
          }};
      }
    });
    var ngListDirective = function() {
      return {
        restrict: 'A',
        priority: 100,
        require: 'ngModel',
        link: function(scope, element, attr, ctrl) {
          var ngList = element.attr(attr.$attr.ngList) || ', ';
          var trimValues = attr.ngTrim !== 'false';
          var separator = trimValues ? trim(ngList) : ngList;
          var parse = function(viewValue) {
            if (isUndefined(viewValue))
              return;
            var list = [];
            if (viewValue) {
              forEach(viewValue.split(separator), function(value) {
                if (value)
                  list.push(trimValues ? trim(value) : value);
              });
            }
            return list;
          };
          ctrl.$parsers.push(parse);
          ctrl.$formatters.push(function(value) {
            if (isArray(value)) {
              return value.join(ngList);
            }
            return undefined;
          });
          ctrl.$isEmpty = function(value) {
            return !value || !value.length;
          };
        }
      };
    };
    var VALID_CLASS = 'ng-valid',
        INVALID_CLASS = 'ng-invalid',
        PRISTINE_CLASS = 'ng-pristine',
        DIRTY_CLASS = 'ng-dirty',
        UNTOUCHED_CLASS = 'ng-untouched',
        TOUCHED_CLASS = 'ng-touched',
        PENDING_CLASS = 'ng-pending';
    var ngModelMinErr = minErr('ngModel');
    var NgModelController = ['$scope', '$exceptionHandler', '$attrs', '$element', '$parse', '$animate', '$timeout', '$rootScope', '$q', '$interpolate', function($scope, $exceptionHandler, $attr, $element, $parse, $animate, $timeout, $rootScope, $q, $interpolate) {
      this.$viewValue = Number.NaN;
      this.$modelValue = Number.NaN;
      this.$$rawModelValue = undefined;
      this.$validators = {};
      this.$asyncValidators = {};
      this.$parsers = [];
      this.$formatters = [];
      this.$viewChangeListeners = [];
      this.$untouched = true;
      this.$touched = false;
      this.$pristine = true;
      this.$dirty = false;
      this.$valid = true;
      this.$invalid = false;
      this.$error = {};
      this.$$success = {};
      this.$pending = undefined;
      this.$name = $interpolate($attr.name || '', false)($scope);
      this.$$parentForm = nullFormCtrl;
      var parsedNgModel = $parse($attr.ngModel),
          parsedNgModelAssign = parsedNgModel.assign,
          ngModelGet = parsedNgModel,
          ngModelSet = parsedNgModelAssign,
          pendingDebounce = null,
          parserValid,
          ctrl = this;
      this.$$setOptions = function(options) {
        ctrl.$options = options;
        if (options && options.getterSetter) {
          var invokeModelGetter = $parse($attr.ngModel + '()'),
              invokeModelSetter = $parse($attr.ngModel + '($$$p)');
          ngModelGet = function($scope) {
            var modelValue = parsedNgModel($scope);
            if (isFunction(modelValue)) {
              modelValue = invokeModelGetter($scope);
            }
            return modelValue;
          };
          ngModelSet = function($scope, newValue) {
            if (isFunction(parsedNgModel($scope))) {
              invokeModelSetter($scope, {$$$p: ctrl.$modelValue});
            } else {
              parsedNgModelAssign($scope, ctrl.$modelValue);
            }
          };
        } else if (!parsedNgModel.assign) {
          throw ngModelMinErr('nonassign', "Expression '{0}' is non-assignable. Element: {1}", $attr.ngModel, startingTag($element));
        }
      };
      this.$render = noop;
      this.$isEmpty = function(value) {
        return isUndefined(value) || value === '' || value === null || value !== value;
      };
      var currentValidationRunId = 0;
      addSetValidityMethod({
        ctrl: this,
        $element: $element,
        set: function(object, property) {
          object[property] = true;
        },
        unset: function(object, property) {
          delete object[property];
        },
        $animate: $animate
      });
      this.$setPristine = function() {
        ctrl.$dirty = false;
        ctrl.$pristine = true;
        $animate.removeClass($element, DIRTY_CLASS);
        $animate.addClass($element, PRISTINE_CLASS);
      };
      this.$setDirty = function() {
        ctrl.$dirty = true;
        ctrl.$pristine = false;
        $animate.removeClass($element, PRISTINE_CLASS);
        $animate.addClass($element, DIRTY_CLASS);
        ctrl.$$parentForm.$setDirty();
      };
      this.$setUntouched = function() {
        ctrl.$touched = false;
        ctrl.$untouched = true;
        $animate.setClass($element, UNTOUCHED_CLASS, TOUCHED_CLASS);
      };
      this.$setTouched = function() {
        ctrl.$touched = true;
        ctrl.$untouched = false;
        $animate.setClass($element, TOUCHED_CLASS, UNTOUCHED_CLASS);
      };
      this.$rollbackViewValue = function() {
        $timeout.cancel(pendingDebounce);
        ctrl.$viewValue = ctrl.$$lastCommittedViewValue;
        ctrl.$render();
      };
      this.$validate = function() {
        if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
          return;
        }
        var viewValue = ctrl.$$lastCommittedViewValue;
        var modelValue = ctrl.$$rawModelValue;
        var prevValid = ctrl.$valid;
        var prevModelValue = ctrl.$modelValue;
        var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;
        ctrl.$$runValidators(modelValue, viewValue, function(allValid) {
          if (!allowInvalid && prevValid !== allValid) {
            ctrl.$modelValue = allValid ? modelValue : undefined;
            if (ctrl.$modelValue !== prevModelValue) {
              ctrl.$$writeModelToScope();
            }
          }
        });
      };
      this.$$runValidators = function(modelValue, viewValue, doneCallback) {
        currentValidationRunId++;
        var localValidationRunId = currentValidationRunId;
        if (!processParseErrors()) {
          validationDone(false);
          return;
        }
        if (!processSyncValidators()) {
          validationDone(false);
          return;
        }
        processAsyncValidators();
        function processParseErrors() {
          var errorKey = ctrl.$$parserName || 'parse';
          if (isUndefined(parserValid)) {
            setValidity(errorKey, null);
          } else {
            if (!parserValid) {
              forEach(ctrl.$validators, function(v, name) {
                setValidity(name, null);
              });
              forEach(ctrl.$asyncValidators, function(v, name) {
                setValidity(name, null);
              });
            }
            setValidity(errorKey, parserValid);
            return parserValid;
          }
          return true;
        }
        function processSyncValidators() {
          var syncValidatorsValid = true;
          forEach(ctrl.$validators, function(validator, name) {
            var result = validator(modelValue, viewValue);
            syncValidatorsValid = syncValidatorsValid && result;
            setValidity(name, result);
          });
          if (!syncValidatorsValid) {
            forEach(ctrl.$asyncValidators, function(v, name) {
              setValidity(name, null);
            });
            return false;
          }
          return true;
        }
        function processAsyncValidators() {
          var validatorPromises = [];
          var allValid = true;
          forEach(ctrl.$asyncValidators, function(validator, name) {
            var promise = validator(modelValue, viewValue);
            if (!isPromiseLike(promise)) {
              throw ngModelMinErr("$asyncValidators", "Expected asynchronous validator to return a promise but got '{0}' instead.", promise);
            }
            setValidity(name, undefined);
            validatorPromises.push(promise.then(function() {
              setValidity(name, true);
            }, function(error) {
              allValid = false;
              setValidity(name, false);
            }));
          });
          if (!validatorPromises.length) {
            validationDone(true);
          } else {
            $q.all(validatorPromises).then(function() {
              validationDone(allValid);
            }, noop);
          }
        }
        function setValidity(name, isValid) {
          if (localValidationRunId === currentValidationRunId) {
            ctrl.$setValidity(name, isValid);
          }
        }
        function validationDone(allValid) {
          if (localValidationRunId === currentValidationRunId) {
            doneCallback(allValid);
          }
        }
      };
      this.$commitViewValue = function() {
        var viewValue = ctrl.$viewValue;
        $timeout.cancel(pendingDebounce);
        if (ctrl.$$lastCommittedViewValue === viewValue && (viewValue !== '' || !ctrl.$$hasNativeValidators)) {
          return;
        }
        ctrl.$$lastCommittedViewValue = viewValue;
        if (ctrl.$pristine) {
          this.$setDirty();
        }
        this.$$parseAndValidate();
      };
      this.$$parseAndValidate = function() {
        var viewValue = ctrl.$$lastCommittedViewValue;
        var modelValue = viewValue;
        parserValid = isUndefined(modelValue) ? undefined : true;
        if (parserValid) {
          for (var i = 0; i < ctrl.$parsers.length; i++) {
            modelValue = ctrl.$parsers[i](modelValue);
            if (isUndefined(modelValue)) {
              parserValid = false;
              break;
            }
          }
        }
        if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
          ctrl.$modelValue = ngModelGet($scope);
        }
        var prevModelValue = ctrl.$modelValue;
        var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;
        ctrl.$$rawModelValue = modelValue;
        if (allowInvalid) {
          ctrl.$modelValue = modelValue;
          writeToModelIfNeeded();
        }
        ctrl.$$runValidators(modelValue, ctrl.$$lastCommittedViewValue, function(allValid) {
          if (!allowInvalid) {
            ctrl.$modelValue = allValid ? modelValue : undefined;
            writeToModelIfNeeded();
          }
        });
        function writeToModelIfNeeded() {
          if (ctrl.$modelValue !== prevModelValue) {
            ctrl.$$writeModelToScope();
          }
        }
      };
      this.$$writeModelToScope = function() {
        ngModelSet($scope, ctrl.$modelValue);
        forEach(ctrl.$viewChangeListeners, function(listener) {
          try {
            listener();
          } catch (e) {
            $exceptionHandler(e);
          }
        });
      };
      this.$setViewValue = function(value, trigger) {
        ctrl.$viewValue = value;
        if (!ctrl.$options || ctrl.$options.updateOnDefault) {
          ctrl.$$debounceViewValueCommit(trigger);
        }
      };
      this.$$debounceViewValueCommit = function(trigger) {
        var debounceDelay = 0,
            options = ctrl.$options,
            debounce;
        if (options && isDefined(options.debounce)) {
          debounce = options.debounce;
          if (isNumber(debounce)) {
            debounceDelay = debounce;
          } else if (isNumber(debounce[trigger])) {
            debounceDelay = debounce[trigger];
          } else if (isNumber(debounce['default'])) {
            debounceDelay = debounce['default'];
          }
        }
        $timeout.cancel(pendingDebounce);
        if (debounceDelay) {
          pendingDebounce = $timeout(function() {
            ctrl.$commitViewValue();
          }, debounceDelay);
        } else if ($rootScope.$$phase) {
          ctrl.$commitViewValue();
        } else {
          $scope.$apply(function() {
            ctrl.$commitViewValue();
          });
        }
      };
      $scope.$watch(function ngModelWatch() {
        var modelValue = ngModelGet($scope);
        if (modelValue !== ctrl.$modelValue && (ctrl.$modelValue === ctrl.$modelValue || modelValue === modelValue)) {
          ctrl.$modelValue = ctrl.$$rawModelValue = modelValue;
          parserValid = undefined;
          var formatters = ctrl.$formatters,
              idx = formatters.length;
          var viewValue = modelValue;
          while (idx--) {
            viewValue = formatters[idx](viewValue);
          }
          if (ctrl.$viewValue !== viewValue) {
            ctrl.$viewValue = ctrl.$$lastCommittedViewValue = viewValue;
            ctrl.$render();
            ctrl.$$runValidators(modelValue, viewValue, noop);
          }
        }
        return modelValue;
      });
    }];
    var ngModelDirective = ['$rootScope', function($rootScope) {
      return {
        restrict: 'A',
        require: ['ngModel', '^?form', '^?ngModelOptions'],
        controller: NgModelController,
        priority: 1,
        compile: function ngModelCompile(element) {
          element.addClass(PRISTINE_CLASS).addClass(UNTOUCHED_CLASS).addClass(VALID_CLASS);
          return {
            pre: function ngModelPreLink(scope, element, attr, ctrls) {
              var modelCtrl = ctrls[0],
                  formCtrl = ctrls[1] || modelCtrl.$$parentForm;
              modelCtrl.$$setOptions(ctrls[2] && ctrls[2].$options);
              formCtrl.$addControl(modelCtrl);
              attr.$observe('name', function(newValue) {
                if (modelCtrl.$name !== newValue) {
                  modelCtrl.$$parentForm.$$renameControl(modelCtrl, newValue);
                }
              });
              scope.$on('$destroy', function() {
                modelCtrl.$$parentForm.$removeControl(modelCtrl);
              });
            },
            post: function ngModelPostLink(scope, element, attr, ctrls) {
              var modelCtrl = ctrls[0];
              if (modelCtrl.$options && modelCtrl.$options.updateOn) {
                element.on(modelCtrl.$options.updateOn, function(ev) {
                  modelCtrl.$$debounceViewValueCommit(ev && ev.type);
                });
              }
              element.on('blur', function(ev) {
                if (modelCtrl.$touched)
                  return;
                if ($rootScope.$$phase) {
                  scope.$evalAsync(modelCtrl.$setTouched);
                } else {
                  scope.$apply(modelCtrl.$setTouched);
                }
              });
            }
          };
        }
      };
    }];
    var DEFAULT_REGEXP = /(\s+|^)default(\s+|$)/;
    var ngModelOptionsDirective = function() {
      return {
        restrict: 'A',
        controller: ['$scope', '$attrs', function($scope, $attrs) {
          var that = this;
          this.$options = copy($scope.$eval($attrs.ngModelOptions));
          if (isDefined(this.$options.updateOn)) {
            this.$options.updateOnDefault = false;
            this.$options.updateOn = trim(this.$options.updateOn.replace(DEFAULT_REGEXP, function() {
              that.$options.updateOnDefault = true;
              return ' ';
            }));
          } else {
            this.$options.updateOnDefault = true;
          }
        }]
      };
    };
    function addSetValidityMethod(context) {
      var ctrl = context.ctrl,
          $element = context.$element,
          classCache = {},
          set = context.set,
          unset = context.unset,
          $animate = context.$animate;
      classCache[INVALID_CLASS] = !(classCache[VALID_CLASS] = $element.hasClass(VALID_CLASS));
      ctrl.$setValidity = setValidity;
      function setValidity(validationErrorKey, state, controller) {
        if (isUndefined(state)) {
          createAndSet('$pending', validationErrorKey, controller);
        } else {
          unsetAndCleanup('$pending', validationErrorKey, controller);
        }
        if (!isBoolean(state)) {
          unset(ctrl.$error, validationErrorKey, controller);
          unset(ctrl.$$success, validationErrorKey, controller);
        } else {
          if (state) {
            unset(ctrl.$error, validationErrorKey, controller);
            set(ctrl.$$success, validationErrorKey, controller);
          } else {
            set(ctrl.$error, validationErrorKey, controller);
            unset(ctrl.$$success, validationErrorKey, controller);
          }
        }
        if (ctrl.$pending) {
          cachedToggleClass(PENDING_CLASS, true);
          ctrl.$valid = ctrl.$invalid = undefined;
          toggleValidationCss('', null);
        } else {
          cachedToggleClass(PENDING_CLASS, false);
          ctrl.$valid = isObjectEmpty(ctrl.$error);
          ctrl.$invalid = !ctrl.$valid;
          toggleValidationCss('', ctrl.$valid);
        }
        var combinedState;
        if (ctrl.$pending && ctrl.$pending[validationErrorKey]) {
          combinedState = undefined;
        } else if (ctrl.$error[validationErrorKey]) {
          combinedState = false;
        } else if (ctrl.$$success[validationErrorKey]) {
          combinedState = true;
        } else {
          combinedState = null;
        }
        toggleValidationCss(validationErrorKey, combinedState);
        ctrl.$$parentForm.$setValidity(validationErrorKey, combinedState, ctrl);
      }
      function createAndSet(name, value, controller) {
        if (!ctrl[name]) {
          ctrl[name] = {};
        }
        set(ctrl[name], value, controller);
      }
      function unsetAndCleanup(name, value, controller) {
        if (ctrl[name]) {
          unset(ctrl[name], value, controller);
        }
        if (isObjectEmpty(ctrl[name])) {
          ctrl[name] = undefined;
        }
      }
      function cachedToggleClass(className, switchValue) {
        if (switchValue && !classCache[className]) {
          $animate.addClass($element, className);
          classCache[className] = true;
        } else if (!switchValue && classCache[className]) {
          $animate.removeClass($element, className);
          classCache[className] = false;
        }
      }
      function toggleValidationCss(validationErrorKey, isValid) {
        validationErrorKey = validationErrorKey ? '-' + snake_case(validationErrorKey, '-') : '';
        cachedToggleClass(VALID_CLASS + validationErrorKey, isValid === true);
        cachedToggleClass(INVALID_CLASS + validationErrorKey, isValid === false);
      }
    }
    function isObjectEmpty(obj) {
      if (obj) {
        for (var prop in obj) {
          if (obj.hasOwnProperty(prop)) {
            return false;
          }
        }
      }
      return true;
    }
    var ngNonBindableDirective = ngDirective({
      terminal: true,
      priority: 1000
    });
    var ngOptionsMinErr = minErr('ngOptions');
    var NG_OPTIONS_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?(?:\s+disable\s+when\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/;
    var ngOptionsDirective = ['$compile', '$parse', function($compile, $parse) {
      function parseOptionsExpression(optionsExp, selectElement, scope) {
        var match = optionsExp.match(NG_OPTIONS_REGEXP);
        if (!(match)) {
          throw ngOptionsMinErr('iexp', "Expected expression in form of " + "'_select_ (as _label_)? for (_key_,)?_value_ in _collection_'" + " but got '{0}'. Element: {1}", optionsExp, startingTag(selectElement));
        }
        var valueName = match[5] || match[7];
        var keyName = match[6];
        var selectAs = / as /.test(match[0]) && match[1];
        var trackBy = match[9];
        var valueFn = $parse(match[2] ? match[1] : valueName);
        var selectAsFn = selectAs && $parse(selectAs);
        var viewValueFn = selectAsFn || valueFn;
        var trackByFn = trackBy && $parse(trackBy);
        var getTrackByValueFn = trackBy ? function(value, locals) {
          return trackByFn(scope, locals);
        } : function getHashOfValue(value) {
          return hashKey(value);
        };
        var getTrackByValue = function(value, key) {
          return getTrackByValueFn(value, getLocals(value, key));
        };
        var displayFn = $parse(match[2] || match[1]);
        var groupByFn = $parse(match[3] || '');
        var disableWhenFn = $parse(match[4] || '');
        var valuesFn = $parse(match[8]);
        var locals = {};
        var getLocals = keyName ? function(value, key) {
          locals[keyName] = key;
          locals[valueName] = value;
          return locals;
        } : function(value) {
          locals[valueName] = value;
          return locals;
        };
        function Option(selectValue, viewValue, label, group, disabled) {
          this.selectValue = selectValue;
          this.viewValue = viewValue;
          this.label = label;
          this.group = group;
          this.disabled = disabled;
        }
        function getOptionValuesKeys(optionValues) {
          var optionValuesKeys;
          if (!keyName && isArrayLike(optionValues)) {
            optionValuesKeys = optionValues;
          } else {
            optionValuesKeys = [];
            for (var itemKey in optionValues) {
              if (optionValues.hasOwnProperty(itemKey) && itemKey.charAt(0) !== '$') {
                optionValuesKeys.push(itemKey);
              }
            }
          }
          return optionValuesKeys;
        }
        return {
          trackBy: trackBy,
          getTrackByValue: getTrackByValue,
          getWatchables: $parse(valuesFn, function(optionValues) {
            var watchedArray = [];
            optionValues = optionValues || [];
            var optionValuesKeys = getOptionValuesKeys(optionValues);
            var optionValuesLength = optionValuesKeys.length;
            for (var index = 0; index < optionValuesLength; index++) {
              var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
              var value = optionValues[key];
              var locals = getLocals(optionValues[key], key);
              var selectValue = getTrackByValueFn(optionValues[key], locals);
              watchedArray.push(selectValue);
              if (match[2] || match[1]) {
                var label = displayFn(scope, locals);
                watchedArray.push(label);
              }
              if (match[4]) {
                var disableWhen = disableWhenFn(scope, locals);
                watchedArray.push(disableWhen);
              }
            }
            return watchedArray;
          }),
          getOptions: function() {
            var optionItems = [];
            var selectValueMap = {};
            var optionValues = valuesFn(scope) || [];
            var optionValuesKeys = getOptionValuesKeys(optionValues);
            var optionValuesLength = optionValuesKeys.length;
            for (var index = 0; index < optionValuesLength; index++) {
              var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
              var value = optionValues[key];
              var locals = getLocals(value, key);
              var viewValue = viewValueFn(scope, locals);
              var selectValue = getTrackByValueFn(viewValue, locals);
              var label = displayFn(scope, locals);
              var group = groupByFn(scope, locals);
              var disabled = disableWhenFn(scope, locals);
              var optionItem = new Option(selectValue, viewValue, label, group, disabled);
              optionItems.push(optionItem);
              selectValueMap[selectValue] = optionItem;
            }
            return {
              items: optionItems,
              selectValueMap: selectValueMap,
              getOptionFromViewValue: function(value) {
                return selectValueMap[getTrackByValue(value)];
              },
              getViewValueFromOption: function(option) {
                return trackBy ? angular.copy(option.viewValue) : option.viewValue;
              }
            };
          }
        };
      }
      var optionTemplate = document.createElement('option'),
          optGroupTemplate = document.createElement('optgroup');
      return {
        restrict: 'A',
        terminal: true,
        require: ['select', '?ngModel'],
        link: function(scope, selectElement, attr, ctrls) {
          var ngModelCtrl = ctrls[1];
          if (!ngModelCtrl)
            return;
          var selectCtrl = ctrls[0];
          var multiple = attr.multiple;
          var emptyOption;
          for (var i = 0,
              children = selectElement.children(),
              ii = children.length; i < ii; i++) {
            if (children[i].value === '') {
              emptyOption = children.eq(i);
              break;
            }
          }
          var providedEmptyOption = !!emptyOption;
          var unknownOption = jqLite(optionTemplate.cloneNode(false));
          unknownOption.val('?');
          var options;
          var ngOptions = parseOptionsExpression(attr.ngOptions, selectElement, scope);
          var renderEmptyOption = function() {
            if (!providedEmptyOption) {
              selectElement.prepend(emptyOption);
            }
            selectElement.val('');
            emptyOption.prop('selected', true);
            emptyOption.attr('selected', true);
          };
          var removeEmptyOption = function() {
            if (!providedEmptyOption) {
              emptyOption.remove();
            }
          };
          var renderUnknownOption = function() {
            selectElement.prepend(unknownOption);
            selectElement.val('?');
            unknownOption.prop('selected', true);
            unknownOption.attr('selected', true);
          };
          var removeUnknownOption = function() {
            unknownOption.remove();
          };
          if (!multiple) {
            selectCtrl.writeValue = function writeNgOptionsValue(value) {
              var option = options.getOptionFromViewValue(value);
              if (option && !option.disabled) {
                if (selectElement[0].value !== option.selectValue) {
                  removeUnknownOption();
                  removeEmptyOption();
                  selectElement[0].value = option.selectValue;
                  option.element.selected = true;
                  option.element.setAttribute('selected', 'selected');
                }
              } else {
                if (value === null || providedEmptyOption) {
                  removeUnknownOption();
                  renderEmptyOption();
                } else {
                  removeEmptyOption();
                  renderUnknownOption();
                }
              }
            };
            selectCtrl.readValue = function readNgOptionsValue() {
              var selectedOption = options.selectValueMap[selectElement.val()];
              if (selectedOption && !selectedOption.disabled) {
                removeEmptyOption();
                removeUnknownOption();
                return options.getViewValueFromOption(selectedOption);
              }
              return null;
            };
            if (ngOptions.trackBy) {
              scope.$watch(function() {
                return ngOptions.getTrackByValue(ngModelCtrl.$viewValue);
              }, function() {
                ngModelCtrl.$render();
              });
            }
          } else {
            ngModelCtrl.$isEmpty = function(value) {
              return !value || value.length === 0;
            };
            selectCtrl.writeValue = function writeNgOptionsMultiple(value) {
              options.items.forEach(function(option) {
                option.element.selected = false;
              });
              if (value) {
                value.forEach(function(item) {
                  var option = options.getOptionFromViewValue(item);
                  if (option && !option.disabled)
                    option.element.selected = true;
                });
              }
            };
            selectCtrl.readValue = function readNgOptionsMultiple() {
              var selectedValues = selectElement.val() || [],
                  selections = [];
              forEach(selectedValues, function(value) {
                var option = options.selectValueMap[value];
                if (option && !option.disabled)
                  selections.push(options.getViewValueFromOption(option));
              });
              return selections;
            };
            if (ngOptions.trackBy) {
              scope.$watchCollection(function() {
                if (isArray(ngModelCtrl.$viewValue)) {
                  return ngModelCtrl.$viewValue.map(function(value) {
                    return ngOptions.getTrackByValue(value);
                  });
                }
              }, function() {
                ngModelCtrl.$render();
              });
            }
          }
          if (providedEmptyOption) {
            emptyOption.remove();
            $compile(emptyOption)(scope);
            emptyOption.removeClass('ng-scope');
          } else {
            emptyOption = jqLite(optionTemplate.cloneNode(false));
          }
          updateOptions();
          scope.$watchCollection(ngOptions.getWatchables, updateOptions);
          function updateOptionElement(option, element) {
            option.element = element;
            element.disabled = option.disabled;
            if (option.label !== element.label) {
              element.label = option.label;
              element.textContent = option.label;
            }
            if (option.value !== element.value)
              element.value = option.selectValue;
          }
          function addOrReuseElement(parent, current, type, templateElement) {
            var element;
            if (current && lowercase(current.nodeName) === type) {
              element = current;
            } else {
              element = templateElement.cloneNode(false);
              if (!current) {
                parent.appendChild(element);
              } else {
                parent.insertBefore(element, current);
              }
            }
            return element;
          }
          function removeExcessElements(current) {
            var next;
            while (current) {
              next = current.nextSibling;
              jqLiteRemove(current);
              current = next;
            }
          }
          function skipEmptyAndUnknownOptions(current) {
            var emptyOption_ = emptyOption && emptyOption[0];
            var unknownOption_ = unknownOption && unknownOption[0];
            if (emptyOption_ || unknownOption_) {
              while (current && (current === emptyOption_ || current === unknownOption_ || emptyOption_ && emptyOption_.nodeType === NODE_TYPE_COMMENT)) {
                current = current.nextSibling;
              }
            }
            return current;
          }
          function updateOptions() {
            var previousValue = options && selectCtrl.readValue();
            options = ngOptions.getOptions();
            var groupMap = {};
            var currentElement = selectElement[0].firstChild;
            if (providedEmptyOption) {
              selectElement.prepend(emptyOption);
            }
            currentElement = skipEmptyAndUnknownOptions(currentElement);
            options.items.forEach(function updateOption(option) {
              var group;
              var groupElement;
              var optionElement;
              if (option.group) {
                group = groupMap[option.group];
                if (!group) {
                  groupElement = addOrReuseElement(selectElement[0], currentElement, 'optgroup', optGroupTemplate);
                  currentElement = groupElement.nextSibling;
                  groupElement.label = option.group;
                  group = groupMap[option.group] = {
                    groupElement: groupElement,
                    currentOptionElement: groupElement.firstChild
                  };
                }
                optionElement = addOrReuseElement(group.groupElement, group.currentOptionElement, 'option', optionTemplate);
                updateOptionElement(option, optionElement);
                group.currentOptionElement = optionElement.nextSibling;
              } else {
                optionElement = addOrReuseElement(selectElement[0], currentElement, 'option', optionTemplate);
                updateOptionElement(option, optionElement);
                currentElement = optionElement.nextSibling;
              }
            });
            Object.keys(groupMap).forEach(function(key) {
              removeExcessElements(groupMap[key].currentOptionElement);
            });
            removeExcessElements(currentElement);
            ngModelCtrl.$render();
            if (!ngModelCtrl.$isEmpty(previousValue)) {
              var nextValue = selectCtrl.readValue();
              if (ngOptions.trackBy ? !equals(previousValue, nextValue) : previousValue !== nextValue) {
                ngModelCtrl.$setViewValue(nextValue);
                ngModelCtrl.$render();
              }
            }
          }
        }
      };
    }];
    var ngPluralizeDirective = ['$locale', '$interpolate', '$log', function($locale, $interpolate, $log) {
      var BRACE = /{}/g,
          IS_WHEN = /^when(Minus)?(.+)$/;
      return {link: function(scope, element, attr) {
          var numberExp = attr.count,
              whenExp = attr.$attr.when && element.attr(attr.$attr.when),
              offset = attr.offset || 0,
              whens = scope.$eval(whenExp) || {},
              whensExpFns = {},
              startSymbol = $interpolate.startSymbol(),
              endSymbol = $interpolate.endSymbol(),
              braceReplacement = startSymbol + numberExp + '-' + offset + endSymbol,
              watchRemover = angular.noop,
              lastCount;
          forEach(attr, function(expression, attributeName) {
            var tmpMatch = IS_WHEN.exec(attributeName);
            if (tmpMatch) {
              var whenKey = (tmpMatch[1] ? '-' : '') + lowercase(tmpMatch[2]);
              whens[whenKey] = element.attr(attr.$attr[attributeName]);
            }
          });
          forEach(whens, function(expression, key) {
            whensExpFns[key] = $interpolate(expression.replace(BRACE, braceReplacement));
          });
          scope.$watch(numberExp, function ngPluralizeWatchAction(newVal) {
            var count = parseFloat(newVal);
            var countIsNaN = isNaN(count);
            if (!countIsNaN && !(count in whens)) {
              count = $locale.pluralCat(count - offset);
            }
            if ((count !== lastCount) && !(countIsNaN && isNumber(lastCount) && isNaN(lastCount))) {
              watchRemover();
              var whenExpFn = whensExpFns[count];
              if (isUndefined(whenExpFn)) {
                if (newVal != null) {
                  $log.debug("ngPluralize: no rule defined for '" + count + "' in " + whenExp);
                }
                watchRemover = noop;
                updateElementText();
              } else {
                watchRemover = scope.$watch(whenExpFn, updateElementText);
              }
              lastCount = count;
            }
          });
          function updateElementText(newText) {
            element.text(newText || '');
          }
        }};
    }];
    var ngRepeatDirective = ['$parse', '$animate', function($parse, $animate) {
      var NG_REMOVED = '$$NG_REMOVED';
      var ngRepeatMinErr = minErr('ngRepeat');
      var updateScope = function(scope, index, valueIdentifier, value, keyIdentifier, key, arrayLength) {
        scope[valueIdentifier] = value;
        if (keyIdentifier)
          scope[keyIdentifier] = key;
        scope.$index = index;
        scope.$first = (index === 0);
        scope.$last = (index === (arrayLength - 1));
        scope.$middle = !(scope.$first || scope.$last);
        scope.$odd = !(scope.$even = (index & 1) === 0);
      };
      var getBlockStart = function(block) {
        return block.clone[0];
      };
      var getBlockEnd = function(block) {
        return block.clone[block.clone.length - 1];
      };
      return {
        restrict: 'A',
        multiElement: true,
        transclude: 'element',
        priority: 1000,
        terminal: true,
        $$tlb: true,
        compile: function ngRepeatCompile($element, $attr) {
          var expression = $attr.ngRepeat;
          var ngRepeatEndComment = document.createComment(' end ngRepeat: ' + expression + ' ');
          var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);
          if (!match) {
            throw ngRepeatMinErr('iexp', "Expected expression in form of '_item_ in _collection_[ track by _id_]' but got '{0}'.", expression);
          }
          var lhs = match[1];
          var rhs = match[2];
          var aliasAs = match[3];
          var trackByExp = match[4];
          match = lhs.match(/^(?:(\s*[\$\w]+)|\(\s*([\$\w]+)\s*,\s*([\$\w]+)\s*\))$/);
          if (!match) {
            throw ngRepeatMinErr('iidexp', "'_item_' in '_item_ in _collection_' should be an identifier or '(_key_, _value_)' expression, but got '{0}'.", lhs);
          }
          var valueIdentifier = match[3] || match[1];
          var keyIdentifier = match[2];
          if (aliasAs && (!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(aliasAs) || /^(null|undefined|this|\$index|\$first|\$middle|\$last|\$even|\$odd|\$parent|\$root|\$id)$/.test(aliasAs))) {
            throw ngRepeatMinErr('badident', "alias '{0}' is invalid --- must be a valid JS identifier which is not a reserved name.", aliasAs);
          }
          var trackByExpGetter,
              trackByIdExpFn,
              trackByIdArrayFn,
              trackByIdObjFn;
          var hashFnLocals = {$id: hashKey};
          if (trackByExp) {
            trackByExpGetter = $parse(trackByExp);
          } else {
            trackByIdArrayFn = function(key, value) {
              return hashKey(value);
            };
            trackByIdObjFn = function(key) {
              return key;
            };
          }
          return function ngRepeatLink($scope, $element, $attr, ctrl, $transclude) {
            if (trackByExpGetter) {
              trackByIdExpFn = function(key, value, index) {
                if (keyIdentifier)
                  hashFnLocals[keyIdentifier] = key;
                hashFnLocals[valueIdentifier] = value;
                hashFnLocals.$index = index;
                return trackByExpGetter($scope, hashFnLocals);
              };
            }
            var lastBlockMap = createMap();
            $scope.$watchCollection(rhs, function ngRepeatAction(collection) {
              var index,
                  length,
                  previousNode = $element[0],
                  nextNode,
                  nextBlockMap = createMap(),
                  collectionLength,
                  key,
                  value,
                  trackById,
                  trackByIdFn,
                  collectionKeys,
                  block,
                  nextBlockOrder,
                  elementsToRemove;
              if (aliasAs) {
                $scope[aliasAs] = collection;
              }
              if (isArrayLike(collection)) {
                collectionKeys = collection;
                trackByIdFn = trackByIdExpFn || trackByIdArrayFn;
              } else {
                trackByIdFn = trackByIdExpFn || trackByIdObjFn;
                collectionKeys = [];
                for (var itemKey in collection) {
                  if (hasOwnProperty.call(collection, itemKey) && itemKey.charAt(0) !== '$') {
                    collectionKeys.push(itemKey);
                  }
                }
              }
              collectionLength = collectionKeys.length;
              nextBlockOrder = new Array(collectionLength);
              for (index = 0; index < collectionLength; index++) {
                key = (collection === collectionKeys) ? index : collectionKeys[index];
                value = collection[key];
                trackById = trackByIdFn(key, value, index);
                if (lastBlockMap[trackById]) {
                  block = lastBlockMap[trackById];
                  delete lastBlockMap[trackById];
                  nextBlockMap[trackById] = block;
                  nextBlockOrder[index] = block;
                } else if (nextBlockMap[trackById]) {
                  forEach(nextBlockOrder, function(block) {
                    if (block && block.scope)
                      lastBlockMap[block.id] = block;
                  });
                  throw ngRepeatMinErr('dupes', "Duplicates in a repeater are not allowed. Use 'track by' expression to specify unique keys. Repeater: {0}, Duplicate key: {1}, Duplicate value: {2}", expression, trackById, value);
                } else {
                  nextBlockOrder[index] = {
                    id: trackById,
                    scope: undefined,
                    clone: undefined
                  };
                  nextBlockMap[trackById] = true;
                }
              }
              for (var blockKey in lastBlockMap) {
                block = lastBlockMap[blockKey];
                elementsToRemove = getBlockNodes(block.clone);
                $animate.leave(elementsToRemove);
                if (elementsToRemove[0].parentNode) {
                  for (index = 0, length = elementsToRemove.length; index < length; index++) {
                    elementsToRemove[index][NG_REMOVED] = true;
                  }
                }
                block.scope.$destroy();
              }
              for (index = 0; index < collectionLength; index++) {
                key = (collection === collectionKeys) ? index : collectionKeys[index];
                value = collection[key];
                block = nextBlockOrder[index];
                if (block.scope) {
                  nextNode = previousNode;
                  do {
                    nextNode = nextNode.nextSibling;
                  } while (nextNode && nextNode[NG_REMOVED]);
                  if (getBlockStart(block) != nextNode) {
                    $animate.move(getBlockNodes(block.clone), null, jqLite(previousNode));
                  }
                  previousNode = getBlockEnd(block);
                  updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
                } else {
                  $transclude(function ngRepeatTransclude(clone, scope) {
                    block.scope = scope;
                    var endNode = ngRepeatEndComment.cloneNode(false);
                    clone[clone.length++] = endNode;
                    $animate.enter(clone, null, jqLite(previousNode));
                    previousNode = endNode;
                    block.clone = clone;
                    nextBlockMap[block.id] = block;
                    updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
                  });
                }
              }
              lastBlockMap = nextBlockMap;
            });
          };
        }
      };
    }];
    var NG_HIDE_CLASS = 'ng-hide';
    var NG_HIDE_IN_PROGRESS_CLASS = 'ng-hide-animate';
    var ngShowDirective = ['$animate', function($animate) {
      return {
        restrict: 'A',
        multiElement: true,
        link: function(scope, element, attr) {
          scope.$watch(attr.ngShow, function ngShowWatchAction(value) {
            $animate[value ? 'removeClass' : 'addClass'](element, NG_HIDE_CLASS, {tempClasses: NG_HIDE_IN_PROGRESS_CLASS});
          });
        }
      };
    }];
    var ngHideDirective = ['$animate', function($animate) {
      return {
        restrict: 'A',
        multiElement: true,
        link: function(scope, element, attr) {
          scope.$watch(attr.ngHide, function ngHideWatchAction(value) {
            $animate[value ? 'addClass' : 'removeClass'](element, NG_HIDE_CLASS, {tempClasses: NG_HIDE_IN_PROGRESS_CLASS});
          });
        }
      };
    }];
    var ngStyleDirective = ngDirective(function(scope, element, attr) {
      scope.$watch(attr.ngStyle, function ngStyleWatchAction(newStyles, oldStyles) {
        if (oldStyles && (newStyles !== oldStyles)) {
          forEach(oldStyles, function(val, style) {
            element.css(style, '');
          });
        }
        if (newStyles)
          element.css(newStyles);
      }, true);
    });
    var ngSwitchDirective = ['$animate', function($animate) {
      return {
        require: 'ngSwitch',
        controller: ['$scope', function ngSwitchController() {
          this.cases = {};
        }],
        link: function(scope, element, attr, ngSwitchController) {
          var watchExpr = attr.ngSwitch || attr.on,
              selectedTranscludes = [],
              selectedElements = [],
              previousLeaveAnimations = [],
              selectedScopes = [];
          var spliceFactory = function(array, index) {
            return function() {
              array.splice(index, 1);
            };
          };
          scope.$watch(watchExpr, function ngSwitchWatchAction(value) {
            var i,
                ii;
            for (i = 0, ii = previousLeaveAnimations.length; i < ii; ++i) {
              $animate.cancel(previousLeaveAnimations[i]);
            }
            previousLeaveAnimations.length = 0;
            for (i = 0, ii = selectedScopes.length; i < ii; ++i) {
              var selected = getBlockNodes(selectedElements[i].clone);
              selectedScopes[i].$destroy();
              var promise = previousLeaveAnimations[i] = $animate.leave(selected);
              promise.then(spliceFactory(previousLeaveAnimations, i));
            }
            selectedElements.length = 0;
            selectedScopes.length = 0;
            if ((selectedTranscludes = ngSwitchController.cases['!' + value] || ngSwitchController.cases['?'])) {
              forEach(selectedTranscludes, function(selectedTransclude) {
                selectedTransclude.transclude(function(caseElement, selectedScope) {
                  selectedScopes.push(selectedScope);
                  var anchor = selectedTransclude.element;
                  caseElement[caseElement.length++] = document.createComment(' end ngSwitchWhen: ');
                  var block = {clone: caseElement};
                  selectedElements.push(block);
                  $animate.enter(caseElement, anchor.parent(), anchor);
                });
              });
            }
          });
        }
      };
    }];
    var ngSwitchWhenDirective = ngDirective({
      transclude: 'element',
      priority: 1200,
      require: '^ngSwitch',
      multiElement: true,
      link: function(scope, element, attrs, ctrl, $transclude) {
        ctrl.cases['!' + attrs.ngSwitchWhen] = (ctrl.cases['!' + attrs.ngSwitchWhen] || []);
        ctrl.cases['!' + attrs.ngSwitchWhen].push({
          transclude: $transclude,
          element: element
        });
      }
    });
    var ngSwitchDefaultDirective = ngDirective({
      transclude: 'element',
      priority: 1200,
      require: '^ngSwitch',
      multiElement: true,
      link: function(scope, element, attr, ctrl, $transclude) {
        ctrl.cases['?'] = (ctrl.cases['?'] || []);
        ctrl.cases['?'].push({
          transclude: $transclude,
          element: element
        });
      }
    });
    var ngTranscludeDirective = ngDirective({
      restrict: 'EAC',
      link: function($scope, $element, $attrs, controller, $transclude) {
        if (!$transclude) {
          throw minErr('ngTransclude')('orphan', 'Illegal use of ngTransclude directive in the template! ' + 'No parent directive that requires a transclusion found. ' + 'Element: {0}', startingTag($element));
        }
        $transclude(function(clone) {
          $element.empty();
          $element.append(clone);
        });
      }
    });
    var scriptDirective = ['$templateCache', function($templateCache) {
      return {
        restrict: 'E',
        terminal: true,
        compile: function(element, attr) {
          if (attr.type == 'text/ng-template') {
            var templateUrl = attr.id,
                text = element[0].text;
            $templateCache.put(templateUrl, text);
          }
        }
      };
    }];
    var noopNgModelController = {
      $setViewValue: noop,
      $render: noop
    };
    var SelectController = ['$element', '$scope', '$attrs', function($element, $scope, $attrs) {
      var self = this,
          optionsMap = new HashMap();
      self.ngModelCtrl = noopNgModelController;
      self.unknownOption = jqLite(document.createElement('option'));
      self.renderUnknownOption = function(val) {
        var unknownVal = '? ' + hashKey(val) + ' ?';
        self.unknownOption.val(unknownVal);
        $element.prepend(self.unknownOption);
        $element.val(unknownVal);
      };
      $scope.$on('$destroy', function() {
        self.renderUnknownOption = noop;
      });
      self.removeUnknownOption = function() {
        if (self.unknownOption.parent())
          self.unknownOption.remove();
      };
      self.readValue = function readSingleValue() {
        self.removeUnknownOption();
        return $element.val();
      };
      self.writeValue = function writeSingleValue(value) {
        if (self.hasOption(value)) {
          self.removeUnknownOption();
          $element.val(value);
          if (value === '')
            self.emptyOption.prop('selected', true);
        } else {
          if (value == null && self.emptyOption) {
            self.removeUnknownOption();
            $element.val('');
          } else {
            self.renderUnknownOption(value);
          }
        }
      };
      self.addOption = function(value, element) {
        assertNotHasOwnProperty(value, '"option value"');
        if (value === '') {
          self.emptyOption = element;
        }
        var count = optionsMap.get(value) || 0;
        optionsMap.put(value, count + 1);
      };
      self.removeOption = function(value) {
        var count = optionsMap.get(value);
        if (count) {
          if (count === 1) {
            optionsMap.remove(value);
            if (value === '') {
              self.emptyOption = undefined;
            }
          } else {
            optionsMap.put(value, count - 1);
          }
        }
      };
      self.hasOption = function(value) {
        return !!optionsMap.get(value);
      };
    }];
    var selectDirective = function() {
      return {
        restrict: 'E',
        require: ['select', '?ngModel'],
        controller: SelectController,
        link: function(scope, element, attr, ctrls) {
          var ngModelCtrl = ctrls[1];
          if (!ngModelCtrl)
            return;
          var selectCtrl = ctrls[0];
          selectCtrl.ngModelCtrl = ngModelCtrl;
          ngModelCtrl.$render = function() {
            selectCtrl.writeValue(ngModelCtrl.$viewValue);
          };
          element.on('change', function() {
            scope.$apply(function() {
              ngModelCtrl.$setViewValue(selectCtrl.readValue());
            });
          });
          if (attr.multiple) {
            selectCtrl.readValue = function readMultipleValue() {
              var array = [];
              forEach(element.find('option'), function(option) {
                if (option.selected) {
                  array.push(option.value);
                }
              });
              return array;
            };
            selectCtrl.writeValue = function writeMultipleValue(value) {
              var items = new HashMap(value);
              forEach(element.find('option'), function(option) {
                option.selected = isDefined(items.get(option.value));
              });
            };
            var lastView,
                lastViewRef = NaN;
            scope.$watch(function selectMultipleWatch() {
              if (lastViewRef === ngModelCtrl.$viewValue && !equals(lastView, ngModelCtrl.$viewValue)) {
                lastView = shallowCopy(ngModelCtrl.$viewValue);
                ngModelCtrl.$render();
              }
              lastViewRef = ngModelCtrl.$viewValue;
            });
            ngModelCtrl.$isEmpty = function(value) {
              return !value || value.length === 0;
            };
          }
        }
      };
    };
    var optionDirective = ['$interpolate', function($interpolate) {
      function chromeHack(optionElement) {
        if (optionElement[0].hasAttribute('selected')) {
          optionElement[0].selected = true;
        }
      }
      return {
        restrict: 'E',
        priority: 100,
        compile: function(element, attr) {
          if (isDefined(attr.value)) {
            var valueInterpolated = $interpolate(attr.value, true);
          } else {
            var interpolateFn = $interpolate(element.text(), true);
            if (!interpolateFn) {
              attr.$set('value', element.text());
            }
          }
          return function(scope, element, attr) {
            var selectCtrlName = '$selectController',
                parent = element.parent(),
                selectCtrl = parent.data(selectCtrlName) || parent.parent().data(selectCtrlName);
            function addOption(optionValue) {
              selectCtrl.addOption(optionValue, element);
              selectCtrl.ngModelCtrl.$render();
              chromeHack(element);
            }
            if (selectCtrl && selectCtrl.ngModelCtrl) {
              if (valueInterpolated) {
                var oldVal;
                attr.$observe('value', function valueAttributeObserveAction(newVal) {
                  if (isDefined(oldVal)) {
                    selectCtrl.removeOption(oldVal);
                  }
                  oldVal = newVal;
                  addOption(newVal);
                });
              } else if (interpolateFn) {
                scope.$watch(interpolateFn, function interpolateWatchAction(newVal, oldVal) {
                  attr.$set('value', newVal);
                  if (oldVal !== newVal) {
                    selectCtrl.removeOption(oldVal);
                  }
                  addOption(newVal);
                });
              } else {
                addOption(attr.value);
              }
              element.on('$destroy', function() {
                selectCtrl.removeOption(attr.value);
                selectCtrl.ngModelCtrl.$render();
              });
            }
          };
        }
      };
    }];
    var styleDirective = valueFn({
      restrict: 'E',
      terminal: false
    });
    var requiredDirective = function() {
      return {
        restrict: 'A',
        require: '?ngModel',
        link: function(scope, elm, attr, ctrl) {
          if (!ctrl)
            return;
          attr.required = true;
          ctrl.$validators.required = function(modelValue, viewValue) {
            return !attr.required || !ctrl.$isEmpty(viewValue);
          };
          attr.$observe('required', function() {
            ctrl.$validate();
          });
        }
      };
    };
    var patternDirective = function() {
      return {
        restrict: 'A',
        require: '?ngModel',
        link: function(scope, elm, attr, ctrl) {
          if (!ctrl)
            return;
          var regexp,
              patternExp = attr.ngPattern || attr.pattern;
          attr.$observe('pattern', function(regex) {
            if (isString(regex) && regex.length > 0) {
              regex = new RegExp('^' + regex + '$');
            }
            if (regex && !regex.test) {
              throw minErr('ngPattern')('noregexp', 'Expected {0} to be a RegExp but was {1}. Element: {2}', patternExp, regex, startingTag(elm));
            }
            regexp = regex || undefined;
            ctrl.$validate();
          });
          ctrl.$validators.pattern = function(modelValue, viewValue) {
            return ctrl.$isEmpty(viewValue) || isUndefined(regexp) || regexp.test(viewValue);
          };
        }
      };
    };
    var maxlengthDirective = function() {
      return {
        restrict: 'A',
        require: '?ngModel',
        link: function(scope, elm, attr, ctrl) {
          if (!ctrl)
            return;
          var maxlength = -1;
          attr.$observe('maxlength', function(value) {
            var intVal = toInt(value);
            maxlength = isNaN(intVal) ? -1 : intVal;
            ctrl.$validate();
          });
          ctrl.$validators.maxlength = function(modelValue, viewValue) {
            return (maxlength < 0) || ctrl.$isEmpty(viewValue) || (viewValue.length <= maxlength);
          };
        }
      };
    };
    var minlengthDirective = function() {
      return {
        restrict: 'A',
        require: '?ngModel',
        link: function(scope, elm, attr, ctrl) {
          if (!ctrl)
            return;
          var minlength = 0;
          attr.$observe('minlength', function(value) {
            minlength = toInt(value) || 0;
            ctrl.$validate();
          });
          ctrl.$validators.minlength = function(modelValue, viewValue) {
            return ctrl.$isEmpty(viewValue) || viewValue.length >= minlength;
          };
        }
      };
    };
    if (window.angular.bootstrap) {
      console.log('WARNING: Tried to load angular more than once.');
      return;
    }
    bindJQuery();
    publishExternalAPI(angular);
    angular.module("ngLocale", [], ["$provide", function($provide) {
      var PLURAL_CATEGORY = {
        ZERO: "zero",
        ONE: "one",
        TWO: "two",
        FEW: "few",
        MANY: "many",
        OTHER: "other"
      };
      function getDecimals(n) {
        n = n + '';
        var i = n.indexOf('.');
        return (i == -1) ? 0 : n.length - i - 1;
      }
      function getVF(n, opt_precision) {
        var v = opt_precision;
        if (undefined === v) {
          v = Math.min(getDecimals(n), 3);
        }
        var base = Math.pow(10, v);
        var f = ((n * base) | 0) % base;
        return {
          v: v,
          f: f
        };
      }
      $provide.value("$locale", {
        "DATETIME_FORMATS": {
          "AMPMS": ["AM", "PM"],
          "DAY": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
          "ERANAMES": ["Before Christ", "Anno Domini"],
          "ERAS": ["BC", "AD"],
          "FIRSTDAYOFWEEK": 6,
          "MONTH": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          "SHORTDAY": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          "SHORTMONTH": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
          "WEEKENDRANGE": [5, 6],
          "fullDate": "EEEE, MMMM d, y",
          "longDate": "MMMM d, y",
          "medium": "MMM d, y h:mm:ss a",
          "mediumDate": "MMM d, y",
          "mediumTime": "h:mm:ss a",
          "short": "M/d/yy h:mm a",
          "shortDate": "M/d/yy",
          "shortTime": "h:mm a"
        },
        "NUMBER_FORMATS": {
          "CURRENCY_SYM": "$",
          "DECIMAL_SEP": ".",
          "GROUP_SEP": ",",
          "PATTERNS": [{
            "gSize": 3,
            "lgSize": 3,
            "maxFrac": 3,
            "minFrac": 0,
            "minInt": 1,
            "negPre": "-",
            "negSuf": "",
            "posPre": "",
            "posSuf": ""
          }, {
            "gSize": 3,
            "lgSize": 3,
            "maxFrac": 2,
            "minFrac": 2,
            "minInt": 1,
            "negPre": "-\u00a4",
            "negSuf": "",
            "posPre": "\u00a4",
            "posSuf": ""
          }]
        },
        "id": "en-us",
        "pluralCat": function(n, opt_precision) {
          var i = n | 0;
          var vf = getVF(n, opt_precision);
          if (i == 1 && vf.v == 0) {
            return PLURAL_CATEGORY.ONE;
          }
          return PLURAL_CATEGORY.OTHER;
        }
      });
    }]);
    jqLite(document).ready(function() {
      angularInit(document, bootstrap);
    });
  })(window, document);
  !window.angular.$$csp().noInlineStyle && window.angular.element(document.head).prepend('<style type="text/css">@charset "UTF-8";[ng\\:cloak],[ng-cloak],[data-ng-cloak],[x-ng-cloak],.ng-cloak,.x-ng-cloak,.ng-hide:not(.ng-hide-animate){display:none !important;}ng\\:form{display:block;}.ng-animate-shim{visibility:hidden;}.ng-anchor{position:absolute;}</style>');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("a", ["9"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('9');
  module.exports = angular;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("b", ["a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var angular = req('a');
  var providers = {
    services: [],
    filters: [],
    directives: []
  };
  var components = [];
  function Service(options) {
    return function decorator(target) {
      options = options ? options : {};
      if (!options.name) {
        throw new Error('@Service() must contain name property!');
      }
      providers.services.push({
        name: options.name,
        fn: target
      });
    };
  }
  exports.Service = Service;
  function Filter(options) {
    return function decorator(target, key, descriptor) {
      options = options ? options : {};
      if (!options.name) {
        throw new Error('@Filter() must contain name property!');
      }
      providers.filters.push({
        name: options.name,
        fn: descriptor.value
      });
    };
  }
  exports.Filter = Filter;
  function Inject() {
    var dependencies = [];
    for (var _i = 0; _i < arguments.length; _i++) {
      dependencies[_i - 0] = arguments[_i];
    }
    return function decorator(target, key, descriptor) {
      if (descriptor) {
        descriptor.value.$inject = dependencies;
      } else {
        target.$inject = dependencies;
      }
    };
  }
  exports.Inject = Inject;
  function Component(options) {
    return function decorator(target) {
      options = options ? options : {};
      if (!options.selector) {
        throw new Error('@Component() must contain selector property!');
      }
      if (target.$initView) {
        target.$initView(options.selector);
      }
      target.$options = options;
      target.$isComponent = true;
      components.push(target);
    };
  }
  exports.Component = Component;
  function View(options) {
    return function decorator(target) {
      options = options ? options : {};
      if (target.$isComponent) {
        throw new Error('@View() must be placed after @Component()!');
      }
      target.$initView = function(selector) {
        var defaults = {
          templateUrl: options.templateUrl,
          restrict: 'E',
          scope: {},
          bindToController: true,
          controllerAs: 'ctrl'
        };
        var name = toCamelCase(selector);
        options.bindToController = options.bindToController || options.bind || {};
        options.controller = target;
        providers.directives.push({
          name: name,
          fn: function() {
            return angular.extend(defaults, options);
          }
        });
      };
      target.$isView = true;
    };
  }
  exports.View = View;
  function Directive(options) {
    return function decorator(target, key, descriptor) {
      var name = toCamelCase(options.selector);
      providers.directives.push({
        name: name,
        fn: descriptor.value
      });
    };
  }
  exports.Directive = Directive;
  function toCamelCase(str) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, function(all, letter) {
      return letter.toUpperCase();
    });
  }
  function defineModuleForTarget(target, dependencies) {
    var name = toCamelCase(target.$options.selector);
    var module = angular.module(name, [].concat(dependencies || []).concat(target.$options.dependencies || []));
    module.run(target.prototype.run || (function() {}));
    module.config(target.prototype.config || (function() {}));
    return module;
  }
  function bootstrap(component) {
    angular.element(document).ready(function() {
      var module = defineModuleForTarget(component, ['templates']);
      for (var _i = 0,
          _a = providers.directives; _i < _a.length; _i++) {
        var directive = _a[_i];
        module.directive(directive.name, directive.fn);
      }
      for (var _b = 0,
          _c = providers.services; _b < _c.length; _b++) {
        var service = _c[_b];
        module.service(service.name, service.fn);
      }
      for (var _d = 0; _d < components.length; _d++) {
        var target = components[_d];
        if (target.$options.selector !== component.$options.selector) {
          defineModuleForTarget(target);
        }
      }
      try {
        angular.module('templates');
      } catch (e) {
        angular.module('templates', []);
      }
      var selector = document.querySelector(component.$options.selector);
      angular.bootstrap(selector, [module.name], {});
    });
  }
  exports.bootstrap = bootstrap;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("c", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(PermissionCheckType) {
    PermissionCheckType[PermissionCheckType["One"] = 0] = "One";
    PermissionCheckType[PermissionCheckType["All"] = 1] = "All";
  })(exports.PermissionCheckType || (exports.PermissionCheckType = {}));
  var PermissionCheckType = exports.PermissionCheckType;
  (function(AccessStatus) {
    AccessStatus[AccessStatus["NotAuthorised"] = 0] = "NotAuthorised";
    AccessStatus[AccessStatus["Authorised"] = 1] = "Authorised";
    AccessStatus[AccessStatus["LoginRequired"] = 2] = "LoginRequired";
  })(exports.AccessStatus || (exports.AccessStatus = {}));
  var AccessStatus = exports.AccessStatus;
  var LOGIN_REDIRECT_TIMEOUT = 3000;
  var SecurityService = (function() {
    function SecurityService($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation, config) {
      this.$http = $http;
      this.$window = $window;
      this.$location = $location;
      this.$timeout = $timeout;
      this.$queryString = $queryString;
      this.$oauthToken = $oauthToken;
      this.Organisation = Organisation;
      this.config = config;
      this.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic YWNtZTphY21lc2VjcmV0'
      };
      this.url = config.oauthURL && config.oauthURL.trim();
      if (this.url && this.url.charAt(this.url.length - 1) !== '/') {
        this.url += '/';
      }
    }
    SecurityService.$inject = ["$http", "$window", "$location", "$timeout", "$queryString", "$oauthToken", "Organisation", "config"];
    SecurityService.prototype.getOrganisation = function() {
      var _this = this;
      return this.$http.get(this.url + 'hierarchies').then(function(result) {
        return new _this.Organisation(result.data, 'Hierarchies');
      });
    };
    SecurityService.prototype.isAuthenticated = function() {
      return !!this.$oauthToken.getToken();
    };
    SecurityService.prototype.redirectToApplication = function(token) {
      var _this = this;
      var applicationURL;
      var createTokenURL = function(applicationURL, applicationRoute, token) {
        var url = applicationURL + "#" + applicationRoute;
        url += applicationRoute.indexOf('?') >= 0 ? '&' : '?';
        url += "token=" + token;
        return url;
      };
      applicationURL = this.$location.search()['redirect_url'] || this.config.applicationURL;
      if (!applicationURL) {
        throw new Error('No application URL in config or redirect_url param');
      }
      applicationURL = createTokenURL(applicationURL, this.$location.hash(), token);
      this.$timeout(function() {
        return _this.$window.location.assign(applicationURL);
      });
    };
    SecurityService.prototype.redirectToLogin = function(time) {
      var _this = this;
      if (time === void 0) {
        time = LOGIN_REDIRECT_TIMEOUT;
      }
      this.$timeout(function() {
        _this.$window.location.assign(_this.config.loginURL + '#?redirect_url=' + encodeURI('' + _this.$window.location));
      }, time);
    };
    SecurityService.prototype.login = function(username, password) {
      var _this = this;
      var data;
      var promise;
      data = angular.extend(this.config, {
        username: username,
        password: password
      });
      data = this.$queryString.stringify(data);
      var config = {
        method: 'POST',
        url: this.url + 'oauth/token',
        headers: this.headers,
        data: data
      };
      promise = this.$http(config).then(function(result) {
        var token = result.data;
        _this.redirectToApplication(token.access_token);
      });
      return promise;
    };
    SecurityService.prototype.decodeTokenContent = function(token) {
      var data;
      var config = {headers: this.headers};
      data = 'token=' + token;
      return this.$http.post(this.url + 'oauth/check_token', data, config).then(function(result) {
        return result.data;
      });
    };
    SecurityService.prototype.logout = function() {
      this.$oauthToken.removeToken();
      this.redirectToLogin(0);
    };
    SecurityService.prototype.getRefreshToken = function() {
      var _this = this;
      var data = {
        grant_type: 'refresh_token',
        refresh_token: this.$oauthToken.getRefreshToken()
      };
      var config = {headers: this.headers};
      data = angular.extend(this.config, data);
      return this.$http.post(this.url + 'oauth/token', this.$queryString.stringify(data), config).then(function(response) {
        _this.$oauthToken.setToken(response.data);
        return response;
      });
    };
    SecurityService.prototype.revokeToken = function() {
      var _this = this;
      var data = {token: this.$oauthToken.getRefreshToken() ? this.$oauthToken.getRefreshToken() : this.$oauthToken.getAccessToken()};
      data = angular.extend(this.config, data);
      return this.$http.post(this.url + 'oauth/revoke', this.$queryString.stringify(data), this.config).then(function(response) {
        _this.$oauthToken.removeToken();
        return response;
      });
    };
    SecurityService.prototype.getPermissions = function() {
      return this.$oauthToken.getPermissions();
    };
    SecurityService.prototype.getUserPermissions = function() {
      if (!this.userPermissions) {
        var permissions = this.getPermissions();
        this.userPermissions = permissions ? this.getPermissions().map(function(item) {
          return item.toLowerCase().trim();
        }) : [];
      }
      return this.userPermissions;
    };
    SecurityService.prototype.getUserLogin = function() {
      return this.$oauthToken.getUserLogin();
    };
    SecurityService.prototype.getUserFullName = function() {
      return this.$oauthToken.getUserFullName();
    };
    SecurityService.prototype.getAccessToken = function() {
      return this.$oauthToken.getAccessToken();
    };
    SecurityService.prototype.stateChangeStart = function(event, toState, loginRequiredCallback, notAuthorisedCallback) {
      var authorised;
      var requiredPermissions = toState.access && toState.access.requiredPermissions;
      var isLoginRequired = toState.access && toState.access.isLoginRequired || true;
      var permissionCheckTypeString = toState.access && toState.access.permissionCheckType;
      var permissionCheckType = PermissionCheckType[permissionCheckTypeString] || PermissionCheckType.All;
      if (toState.access !== undefined) {
        authorised = this.authorize(requiredPermissions, isLoginRequired, permissionCheckType);
        if (authorised === AccessStatus.LoginRequired) {
          if (angular.isFunction(loginRequiredCallback)) {
            loginRequiredCallback();
          }
          this.redirectToLogin(this.config.redirectToLoginTimeout);
          event.preventDefault();
        } else if (authorised === AccessStatus.NotAuthorised) {
          if (angular.isFunction(notAuthorisedCallback)) {
            notAuthorisedCallback();
          }
          event.preventDefault();
        }
      }
    };
    SecurityService.prototype.authorize = function(requiredPermissions, isLoginRequired, permissionCheckType) {
      if (isLoginRequired === void 0) {
        isLoginRequired = true;
      }
      if (permissionCheckType === void 0) {
        permissionCheckType = PermissionCheckType.One;
      }
      var user = this.getUserLogin();
      var userPermissions = this.getUserPermissions();
      var length;
      var hasPermission = true;
      var permission;
      var i;
      if (isLoginRequired === true && !user) {
        return AccessStatus.LoginRequired;
      }
      requiredPermissions = angular.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
      if ((isLoginRequired === true && user) && (requiredPermissions === undefined || requiredPermissions.length === 0)) {
        return AccessStatus.Authorised;
      }
      length = requiredPermissions.length;
      if (requiredPermissions && userPermissions) {
        for (i = 0; i < length; i++) {
          permission = requiredPermissions[i].toLowerCase().trim();
          if (permissionCheckType === PermissionCheckType.All) {
            hasPermission = hasPermission && userPermissions.indexOf(permission) > -1;
            if (hasPermission === false) {
              break;
            }
          } else if (permissionCheckType === PermissionCheckType.One) {
            hasPermission = userPermissions.indexOf(permission) > -1;
            if (hasPermission) {
              break;
            }
          }
        }
        return hasPermission ? AccessStatus.Authorised : AccessStatus.NotAuthorised;
      }
    };
    SecurityService.prototype.owner = function(userName) {
      return userName === this.getUserLogin();
    };
    return SecurityService;
  })();
  exports.SecurityService = SecurityService;
  var SecurityServiceProvider = (function() {
    function SecurityServiceProvider() {
      this.config = {
        'grant_type': 'password',
        'client_id': 'acme',
        'scope': 'openid'
      };
    }
    SecurityServiceProvider.prototype.configure = function(params) {
      if (!(params instanceof Object)) {
        throw new TypeError('Invalid argument: `config` must be an `Object`.');
      }
      angular.extend(this.config, params);
      return this;
    };
    SecurityServiceProvider.prototype.$get = function($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation) {
      return new SecurityService($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation, this.config);
    };
    SecurityServiceProvider.prototype.$get.$inject = ["$http", "$window", "$location", "$timeout", "$queryString", "$oauthToken", "Organisation"];
    return SecurityServiceProvider;
  })();
  exports.SecurityServiceProvider = SecurityServiceProvider;
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = SecurityService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("d", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var OAuthTokenService = (function() {
    function OAuthTokenService($location, $window, $settings, config) {
      this.$location = $location;
      this.$window = $window;
      this.$settings = $settings;
      this.config = config;
    }
    OAuthTokenService.$inject = ["$location", "$window", "$settings", "config"];
    OAuthTokenService.prototype.setToken = function(data) {
      this.$settings.set(this.config.name, data);
    };
    OAuthTokenService.prototype.getToken = function() {
      this.restoreTokenFromURL();
      return this.$settings.get(this.config.name);
    };
    OAuthTokenService.prototype.getAccessToken = function() {
      return this.getToken() ? this.getToken().access_token : undefined;
    };
    OAuthTokenService.prototype.getAuthorizationHeader = function() {
      if (!(this.getTokenType() && this.getAccessToken())) {
        return;
      }
      return this.getTokenType().charAt(0).toUpperCase() + this.getTokenType().substr(1) + ' ' + this.getAccessToken();
    };
    OAuthTokenService.prototype.getRefreshToken = function() {
      return this.getToken() ? this.getToken().refresh_token : undefined;
    };
    OAuthTokenService.prototype.getTokenType = function() {
      return this.getToken() ? this.getToken().token_type : undefined;
    };
    OAuthTokenService.prototype.restoreTokenFromURL = function() {
      var accessToken;
      var content;
      accessToken = this.$location.search()['token'];
      if (accessToken && this.verifyTokenSignature(accessToken)) {
        this.$location.search('token', null);
        content = this.decodeToken(accessToken);
        this.setToken({
          access_token: accessToken,
          token_type: 'bearer',
          content: content
        });
      }
    };
    OAuthTokenService.prototype.verifyTokenSignature = function(token) {
      var result = false;
      var publicKey = this.config.publicKey;
      try {
        result = KJUR.jws.JWS.verify(token, publicKey, ["RS256"]);
      } catch (ex) {
        console.error("OAuth Token Service Error: " + ex);
        result = false;
      }
      if (result == true) {
        console.log('Token Signature Valid');
      } else {
        console.log('Token Signature Not Valid');
      }
      return result;
    };
    OAuthTokenService.prototype.urlBase64Decode = function(str) {
      var output = str.replace(/-/g, '+').replace(/_/g, '/');
      switch (output.length % 4) {
        case 0:
          {
            break;
          }
        case 2:
          {
            output += '==';
            break;
          }
        case 3:
          {
            output += '=';
            break;
          }
        default:
          {
            throw 'Illegal base64url string!';
          }
      }
      return this.$window.decodeURIComponent(this.$window.encodeURIComponent(this.$window.atob(output)));
    };
    OAuthTokenService.prototype.decodeToken = function(token) {
      var parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('JWT must have 3 parts');
      }
      var decoded = this.urlBase64Decode(parts[1]);
      if (!decoded) {
        throw new Error('Cannot decode the token');
      }
      return JSON.parse(decoded);
    };
    OAuthTokenService.prototype.getTokenExpirationDate = function(token) {
      var decoded;
      decoded = this.decodeToken(token);
      if (typeof decoded.exp === "undefined") {
        return null;
      }
      var d = new Date(0);
      d.setUTCSeconds(decoded.exp);
      return d;
    };
    OAuthTokenService.prototype.isTokenExpired = function(token, offsetSeconds) {
      var d = this.getTokenExpirationDate(token);
      offsetSeconds = offsetSeconds || 0;
      if (d === null) {
        return false;
      }
      return !(d.valueOf() > (new Date().valueOf() + (offsetSeconds * 1000)));
    };
    OAuthTokenService.prototype.removeToken = function() {
      this.$settings.set(this.config.name);
    };
    OAuthTokenService.prototype.setContent = function(tokenContent) {
      this.$settings.set(this.config.name);
    };
    OAuthTokenService.prototype.getContent = function() {
      var token = this.getToken();
      return token && token.content ? token.content : undefined;
    };
    OAuthTokenService.prototype.getUserLogin = function() {
      var content = this.getContent();
      return content && content.user_name ? content.user_name : undefined;
    };
    OAuthTokenService.prototype.getUserFullName = function() {
      var content = this.getContent();
      return content && content.full_name ? content.full_name : undefined;
    };
    OAuthTokenService.prototype.getPermissions = function() {
      var content = this.getContent();
      return content && content.authorities ? content.authorities : undefined;
    };
    return OAuthTokenService;
  })();
  exports.OAuthTokenService = OAuthTokenService;
  var OAuthTokenServiceProvider = (function() {
    function OAuthTokenServiceProvider() {
      this.config = {name: 'token'};
    }
    OAuthTokenServiceProvider.prototype.configure = function(params) {
      if (!(params instanceof Object)) {
        throw new TypeError('Invalid argument: `config` must be an `Object`.');
      }
      angular.extend(this.config, params);
      return this;
    };
    OAuthTokenServiceProvider.prototype.$get = function($location, $window, $settings) {
      return new OAuthTokenService($location, $window, $settings, this.config);
    };
    OAuthTokenServiceProvider.prototype.$get.$inject = ["$location", "$window", "$settings"];
    return OAuthTokenServiceProvider;
  })();
  exports.OAuthTokenServiceProvider = OAuthTokenServiceProvider;
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = OAuthTokenService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("e", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var OAuthHttpInterceptor = (function() {
    function OAuthHttpInterceptor($rootScope, $q, $oauthToken) {
      var _this = this;
      this.$rootScope = $rootScope;
      this.$q = $q;
      this.$oauthToken = $oauthToken;
      this.request = function(config) {
        if (!config.url.match(/.html/) && _this.$oauthToken.getAuthorizationHeader()) {
          config.headers = config.headers || {};
          if (!config.headers.Authorization) {
            config.headers.Authorization = _this.$oauthToken.getAuthorizationHeader();
          }
        }
        return config;
      };
      this.responseError = function(rejection) {
        var error = {
          status: rejection.status,
          message: rejection.data && rejection.data.error_description ? rejection.data.error_description : 'Unknown OAuth Error ' + JSON.stringify(rejection)
        };
        if (400 === rejection.status && rejection.data && ('invalid_request' === rejection.data.error || 'invalid_grant' === rejection.data.error)) {
          _this.$oauthToken.removeToken();
          _this.$rootScope.$broadcast('$oauth:error', error);
        }
        if (401 === rejection.status) {
          if ((rejection.data && 'invalid_token' === rejection.data.error) || (rejection.headers('www-authenticate') && 0 === rejection.headers('www-authenticate').indexOf('Bearer'))) {
            error.message = 'Invalid token. Should login.';
            _this.$rootScope.$broadcast('$oauth:error', error);
          } else {
            error.url = rejection.config.url;
            _this.$rootScope.$broadcast('$http:error:authorization', error);
          }
        }
        if (403 === rejection.status) {
          _this.$rootScope.$broadcast('$oauth:error', error);
        }
        return _this.$q.reject(rejection);
      };
    }
    OAuthHttpInterceptor.$inject = ["$rootScope", "$q", "$oauthToken"];
    OAuthHttpInterceptor.factory = function($rootScope, $q, $oauthToken) {
      return new OAuthHttpInterceptor($rootScope, $q, $oauthToken);
    };
    OAuthHttpInterceptor.factory.$inject = ["$rootScope", "$q", "$oauthToken"];
    return OAuthHttpInterceptor;
  })();
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = OAuthHttpInterceptor;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("f", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var QueryStringService = (function() {
    function QueryStringService() {}
    QueryStringService.prototype.extract = function(maybeUrl) {
      return maybeUrl.split('?')[1] || '';
    };
    QueryStringService.prototype.parse = function(str) {
      if (typeof str !== 'string') {
        return {};
      }
      str = str.trim().replace(/^(\?|#|&)/, '');
      if (!str) {
        return {};
      }
      return str.split('&').reduce(function(ret, param) {
        var parts = param.replace(/\+/g, ' ').split('=');
        var key = parts[0];
        var val = parts[1];
        key = decodeURIComponent(key);
        val = val === undefined ? null : decodeURIComponent(val);
        if (!ret.hasOwnProperty(key)) {
          ret[key] = val;
        } else if (Array.isArray(ret[key])) {
          ret[key].push(val);
        } else {
          ret[key] = [ret[key], val];
        }
        return ret;
      }, {});
    };
    QueryStringService.prototype.stringify = function(obj) {
      return obj ? Object.keys(obj).sort().map(function(key) {
        var val = obj[key];
        if (Array.isArray(val)) {
          return val.sort().map(function(val2) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(val2);
          }).join('&');
        }
        return encodeURIComponent(key) + '=' + encodeURIComponent(val);
      }).join('&') : '';
    };
    return QueryStringService;
  })();
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = QueryStringService;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("10", ["c"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SecurityService_1 = req('c');
  function AuthorizeDirective($security) {
    return {
      restrict: 'A',
      link: function(scope, element, attrs) {
        var makeVisible = function() {
          element.removeClass('hidden');
        };
        var makeHidden = function() {
          element.addClass('hidden');
        };
        var makeDisabled = function() {
          element.attr('ng-disabled', 'true');
        };
        var makeEnabled = function() {
          element.removeAttr('disabled');
        };
        var roles = attrs.authorize.split(',');
        var type = attrs.authorizeAction || 'show';
        if (roles.length > 0) {
          var result;
          result = $security.authorize(roles, true, SecurityService_1.PermissionCheckType[attrs.authorizeType]);
          if (result === SecurityService_1.AccessStatus.Authorised) {
            type === 'show' ? makeVisible() : makeEnabled();
          } else {
            type === 'show' ? makeHidden() : makeDisabled();
          }
        }
      }
    };
  }
  AuthorizeDirective.$inject = ["$security"];
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = AuthorizeDirective;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("11", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var navigator = {};
  navigator.userAgent = false;
  var window = {};
  if (typeof YAHOO == "undefined" || !YAHOO) {
    var YAHOO = {};
  }
  YAHOO.namespace = function() {
    var b = arguments,
        g = null,
        e,
        c,
        f;
    for (e = 0; e < b.length; e = e + 1) {
      f = ("" + b[e]).split(".");
      g = YAHOO;
      for (c = (f[0] == "YAHOO") ? 1 : 0; c < f.length; c = c + 1) {
        g[f[c]] = g[f[c]] || {};
        g = g[f[c]];
      }
    }
    return g;
  };
  YAHOO.log = function(d, a, c) {
    var b = YAHOO.widget.Logger;
    if (b && b.log) {
      return b.log(d, a, c);
    } else {
      return false;
    }
  };
  YAHOO.register = function(a, f, e) {
    var k = YAHOO.env.modules,
        c,
        j,
        h,
        g,
        d;
    if (!k[a]) {
      k[a] = {
        versions: [],
        builds: []
      };
    }
    c = k[a];
    j = e.version;
    h = e.build;
    g = YAHOO.env.listeners;
    c.name = a;
    c.version = j;
    c.build = h;
    c.versions.push(j);
    c.builds.push(h);
    c.mainClass = f;
    for (d = 0; d < g.length; d = d + 1) {
      g[d](c);
    }
    if (f) {
      f.VERSION = j;
      f.BUILD = h;
    } else {
      YAHOO.log("mainClass is undefined for module " + a, "warn");
    }
  };
  YAHOO.env = YAHOO.env || {
    modules: [],
    listeners: []
  };
  YAHOO.env.getVersion = function(a) {
    return YAHOO.env.modules[a] || null;
  };
  YAHOO.env.parseUA = function(d) {
    var e = function(i) {
      var j = 0;
      return parseFloat(i.replace(/\./g, function() {
        return (j++ == 1) ? "" : ".";
      }));
    },
        h = navigator,
        g = {
          ie: 0,
          opera: 0,
          gecko: 0,
          webkit: 0,
          chrome: 0,
          mobile: null,
          air: 0,
          ipad: 0,
          iphone: 0,
          ipod: 0,
          ios: null,
          android: 0,
          webos: 0,
          caja: h && h.cajaVersion,
          secure: false,
          os: null
        },
        c = d || (navigator && navigator.userAgent),
        f = window && window.location,
        b = f && f.href,
        a;
    g.secure = b && (b.toLowerCase().indexOf("https") === 0);
    if (c) {
      if ((/windows|win32/i).test(c)) {
        g.os = "windows";
      } else {
        if ((/macintosh/i).test(c)) {
          g.os = "macintosh";
        } else {
          if ((/rhino/i).test(c)) {
            g.os = "rhino";
          }
        }
      }
      if ((/KHTML/).test(c)) {
        g.webkit = 1;
      }
      a = c.match(/AppleWebKit\/([^\s]*)/);
      if (a && a[1]) {
        g.webkit = e(a[1]);
        if (/ Mobile\//.test(c)) {
          g.mobile = "Apple";
          a = c.match(/OS ([^\s]*)/);
          if (a && a[1]) {
            a = e(a[1].replace("_", "."));
          }
          g.ios = a;
          g.ipad = g.ipod = g.iphone = 0;
          a = c.match(/iPad|iPod|iPhone/);
          if (a && a[0]) {
            g[a[0].toLowerCase()] = g.ios;
          }
        } else {
          a = c.match(/NokiaN[^\/]*|Android \d\.\d|webOS\/\d\.\d/);
          if (a) {
            g.mobile = a[0];
          }
          if (/webOS/.test(c)) {
            g.mobile = "WebOS";
            a = c.match(/webOS\/([^\s]*);/);
            if (a && a[1]) {
              g.webos = e(a[1]);
            }
          }
          if (/ Android/.test(c)) {
            g.mobile = "Android";
            a = c.match(/Android ([^\s]*);/);
            if (a && a[1]) {
              g.android = e(a[1]);
            }
          }
        }
        a = c.match(/Chrome\/([^\s]*)/);
        if (a && a[1]) {
          g.chrome = e(a[1]);
        } else {
          a = c.match(/AdobeAIR\/([^\s]*)/);
          if (a) {
            g.air = a[0];
          }
        }
      }
      if (!g.webkit) {
        a = c.match(/Opera[\s\/]([^\s]*)/);
        if (a && a[1]) {
          g.opera = e(a[1]);
          a = c.match(/Version\/([^\s]*)/);
          if (a && a[1]) {
            g.opera = e(a[1]);
          }
          a = c.match(/Opera Mini[^;]*/);
          if (a) {
            g.mobile = a[0];
          }
        } else {
          a = c.match(/MSIE\s([^;]*)/);
          if (a && a[1]) {
            g.ie = e(a[1]);
          } else {
            a = c.match(/Gecko\/([^\s]*)/);
            if (a) {
              g.gecko = 1;
              a = c.match(/rv:([^\s\)]*)/);
              if (a && a[1]) {
                g.gecko = e(a[1]);
              }
            }
          }
        }
      }
    }
    return g;
  };
  YAHOO.env.ua = YAHOO.env.parseUA();
  (function() {
    YAHOO.namespace("util", "widget", "example");
    if ("undefined" !== typeof YAHOO_config) {
      var b = YAHOO_config.listener,
          a = YAHOO.env.listeners,
          d = true,
          c;
      if (b) {
        for (c = 0; c < a.length; c++) {
          if (a[c] == b) {
            d = false;
            break;
          }
        }
        if (d) {
          a.push(b);
        }
      }
    }
  })();
  YAHOO.lang = YAHOO.lang || {};
  (function() {
    var f = YAHOO.lang,
        a = Object.prototype,
        c = "[object Array]",
        h = "[object Function]",
        i = "[object Object]",
        b = [],
        g = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#x27;",
          "/": "&#x2F;",
          "`": "&#x60;"
        },
        d = ["toString", "valueOf"],
        e = {
          isArray: function(j) {
            return a.toString.apply(j) === c;
          },
          isBoolean: function(j) {
            return typeof j === "boolean";
          },
          isFunction: function(j) {
            return (typeof j === "function") || a.toString.apply(j) === h;
          },
          isNull: function(j) {
            return j === null;
          },
          isNumber: function(j) {
            return typeof j === "number" && isFinite(j);
          },
          isObject: function(j) {
            return (j && (typeof j === "object" || f.isFunction(j))) || false;
          },
          isString: function(j) {
            return typeof j === "string";
          },
          isUndefined: function(j) {
            return typeof j === "undefined";
          },
          _IEEnumFix: (YAHOO.env.ua.ie) ? function(l, k) {
            var j,
                n,
                m;
            for (j = 0; j < d.length; j = j + 1) {
              n = d[j];
              m = k[n];
              if (f.isFunction(m) && m != a[n]) {
                l[n] = m;
              }
            }
          } : function() {},
          escapeHTML: function(j) {
            return j.replace(/[&<>"'\/`]/g, function(k) {
              return g[k];
            });
          },
          extend: function(m, n, l) {
            if (!n || !m) {
              throw new Error("extend failed, please check that " + "all dependencies are included.");
            }
            var k = function() {},
                j;
            k.prototype = n.prototype;
            m.prototype = new k();
            m.prototype.constructor = m;
            m.superclass = n.prototype;
            if (n.prototype.constructor == a.constructor) {
              n.prototype.constructor = n;
            }
            if (l) {
              for (j in l) {
                if (f.hasOwnProperty(l, j)) {
                  m.prototype[j] = l[j];
                }
              }
              f._IEEnumFix(m.prototype, l);
            }
          },
          augmentObject: function(n, m) {
            if (!m || !n) {
              throw new Error("Absorb failed, verify dependencies.");
            }
            var j = arguments,
                l,
                o,
                k = j[2];
            if (k && k !== true) {
              for (l = 2; l < j.length; l = l + 1) {
                n[j[l]] = m[j[l]];
              }
            } else {
              for (o in m) {
                if (k || !(o in n)) {
                  n[o] = m[o];
                }
              }
              f._IEEnumFix(n, m);
            }
            return n;
          },
          augmentProto: function(m, l) {
            if (!l || !m) {
              throw new Error("Augment failed, verify dependencies.");
            }
            var j = [m.prototype, l.prototype],
                k;
            for (k = 2; k < arguments.length; k = k + 1) {
              j.push(arguments[k]);
            }
            f.augmentObject.apply(this, j);
            return m;
          },
          dump: function(j, p) {
            var l,
                n,
                r = [],
                t = "{...}",
                k = "f(){...}",
                q = ", ",
                m = " => ";
            if (!f.isObject(j)) {
              return j + "";
            } else {
              if (j instanceof Date || ("nodeType" in j && "tagName" in j)) {
                return j;
              } else {
                if (f.isFunction(j)) {
                  return k;
                }
              }
            }
            p = (f.isNumber(p)) ? p : 3;
            if (f.isArray(j)) {
              r.push("[");
              for (l = 0, n = j.length; l < n; l = l + 1) {
                if (f.isObject(j[l])) {
                  r.push((p > 0) ? f.dump(j[l], p - 1) : t);
                } else {
                  r.push(j[l]);
                }
                r.push(q);
              }
              if (r.length > 1) {
                r.pop();
              }
              r.push("]");
            } else {
              r.push("{");
              for (l in j) {
                if (f.hasOwnProperty(j, l)) {
                  r.push(l + m);
                  if (f.isObject(j[l])) {
                    r.push((p > 0) ? f.dump(j[l], p - 1) : t);
                  } else {
                    r.push(j[l]);
                  }
                  r.push(q);
                }
              }
              if (r.length > 1) {
                r.pop();
              }
              r.push("}");
            }
            return r.join("");
          },
          substitute: function(x, y, E, l) {
            var D,
                C,
                B,
                G,
                t,
                u,
                F = [],
                p,
                z = x.length,
                A = "dump",
                r = " ",
                q = "{",
                m = "}",
                n,
                w;
            for (; ; ) {
              D = x.lastIndexOf(q, z);
              if (D < 0) {
                break;
              }
              C = x.indexOf(m, D);
              if (D + 1 > C) {
                break;
              }
              p = x.substring(D + 1, C);
              G = p;
              u = null;
              B = G.indexOf(r);
              if (B > -1) {
                u = G.substring(B + 1);
                G = G.substring(0, B);
              }
              t = y[G];
              if (E) {
                t = E(G, t, u);
              }
              if (f.isObject(t)) {
                if (f.isArray(t)) {
                  t = f.dump(t, parseInt(u, 10));
                } else {
                  u = u || "";
                  n = u.indexOf(A);
                  if (n > -1) {
                    u = u.substring(4);
                  }
                  w = t.toString();
                  if (w === i || n > -1) {
                    t = f.dump(t, parseInt(u, 10));
                  } else {
                    t = w;
                  }
                }
              } else {
                if (!f.isString(t) && !f.isNumber(t)) {
                  t = "~-" + F.length + "-~";
                  F[F.length] = p;
                }
              }
              x = x.substring(0, D) + t + x.substring(C + 1);
              if (l === false) {
                z = D - 1;
              }
            }
            for (D = F.length - 1; D >= 0; D = D - 1) {
              x = x.replace(new RegExp("~-" + D + "-~"), "{" + F[D] + "}", "g");
            }
            return x;
          },
          trim: function(j) {
            try {
              return j.replace(/^\s+|\s+$/g, "");
            } catch (k) {
              return j;
            }
          },
          merge: function() {
            var n = {},
                k = arguments,
                j = k.length,
                m;
            for (m = 0; m < j; m = m + 1) {
              f.augmentObject(n, k[m], true);
            }
            return n;
          },
          later: function(t, k, u, n, p) {
            t = t || 0;
            k = k || {};
            var l = u,
                s = n,
                q,
                j;
            if (f.isString(u)) {
              l = k[u];
            }
            if (!l) {
              throw new TypeError("method undefined");
            }
            if (!f.isUndefined(n) && !f.isArray(s)) {
              s = [n];
            }
            q = function() {
              l.apply(k, s || b);
            };
            j = (p) ? setInterval(q, t) : setTimeout(q, t);
            return {
              interval: p,
              cancel: function() {
                if (this.interval) {
                  clearInterval(j);
                } else {
                  clearTimeout(j);
                }
              }
            };
          },
          isValue: function(j) {
            return (f.isObject(j) || f.isString(j) || f.isNumber(j) || f.isBoolean(j));
          }
        };
    f.hasOwnProperty = (a.hasOwnProperty) ? function(j, k) {
      return j && j.hasOwnProperty && j.hasOwnProperty(k);
    } : function(j, k) {
      return !f.isUndefined(j[k]) && j.constructor.prototype[k] !== j[k];
    };
    e.augmentObject(f, e, true);
    YAHOO.util.Lang = f;
    f.augment = f.augmentProto;
    YAHOO.augment = f.augmentProto;
    YAHOO.extend = f.extend;
  })();
  YAHOO.register("yahoo", YAHOO, {
    version: "2.9.0",
    build: "2800"
  });
  var CryptoJS = CryptoJS || (function(e, g) {
    var a = {};
    var b = a.lib = {};
    var j = b.Base = (function() {
      function n() {}
      return {
        extend: function(p) {
          n.prototype = this;
          var o = new n();
          if (p) {
            o.mixIn(p);
          }
          if (!o.hasOwnProperty("init")) {
            o.init = function() {
              o.$super.init.apply(this, arguments);
            };
          }
          o.init.prototype = o;
          o.$super = this;
          return o;
        },
        create: function() {
          var o = this.extend();
          o.init.apply(o, arguments);
          return o;
        },
        init: function() {},
        mixIn: function(p) {
          for (var o in p) {
            if (p.hasOwnProperty(o)) {
              this[o] = p[o];
            }
          }
          if (p.hasOwnProperty("toString")) {
            this.toString = p.toString;
          }
        },
        clone: function() {
          return this.init.prototype.extend(this);
        }
      };
    }());
    var l = b.WordArray = j.extend({
      init: function(o, n) {
        o = this.words = o || [];
        if (n != g) {
          this.sigBytes = n;
        } else {
          this.sigBytes = o.length * 4;
        }
      },
      toString: function(n) {
        return (n || h).stringify(this);
      },
      concat: function(t) {
        var q = this.words;
        var p = t.words;
        var n = this.sigBytes;
        var s = t.sigBytes;
        this.clamp();
        if (n % 4) {
          for (var r = 0; r < s; r++) {
            var o = (p[r >>> 2] >>> (24 - (r % 4) * 8)) & 255;
            q[(n + r) >>> 2] |= o << (24 - ((n + r) % 4) * 8);
          }
        } else {
          for (var r = 0; r < s; r += 4) {
            q[(n + r) >>> 2] = p[r >>> 2];
          }
        }
        this.sigBytes += s;
        return this;
      },
      clamp: function() {
        var o = this.words;
        var n = this.sigBytes;
        o[n >>> 2] &= 4294967295 << (32 - (n % 4) * 8);
        o.length = e.ceil(n / 4);
      },
      clone: function() {
        var n = j.clone.call(this);
        n.words = this.words.slice(0);
        return n;
      },
      random: function(p) {
        var o = [];
        for (var n = 0; n < p; n += 4) {
          o.push((e.random() * 4294967296) | 0);
        }
        return new l.init(o, p);
      }
    });
    var m = a.enc = {};
    var h = m.Hex = {
      stringify: function(p) {
        var r = p.words;
        var o = p.sigBytes;
        var q = [];
        for (var n = 0; n < o; n++) {
          var s = (r[n >>> 2] >>> (24 - (n % 4) * 8)) & 255;
          q.push((s >>> 4).toString(16));
          q.push((s & 15).toString(16));
        }
        return q.join("");
      },
      parse: function(p) {
        var n = p.length;
        var q = [];
        for (var o = 0; o < n; o += 2) {
          q[o >>> 3] |= parseInt(p.substr(o, 2), 16) << (24 - (o % 8) * 4);
        }
        return new l.init(q, n / 2);
      }
    };
    var d = m.Latin1 = {
      stringify: function(q) {
        var r = q.words;
        var p = q.sigBytes;
        var n = [];
        for (var o = 0; o < p; o++) {
          var s = (r[o >>> 2] >>> (24 - (o % 4) * 8)) & 255;
          n.push(String.fromCharCode(s));
        }
        return n.join("");
      },
      parse: function(p) {
        var n = p.length;
        var q = [];
        for (var o = 0; o < n; o++) {
          q[o >>> 2] |= (p.charCodeAt(o) & 255) << (24 - (o % 4) * 8);
        }
        return new l.init(q, n);
      }
    };
    var c = m.Utf8 = {
      stringify: function(n) {
        try {
          return decodeURIComponent(escape(d.stringify(n)));
        } catch (o) {
          throw new Error("Malformed UTF-8 data");
        }
      },
      parse: function(n) {
        return d.parse(unescape(encodeURIComponent(n)));
      }
    };
    var i = b.BufferedBlockAlgorithm = j.extend({
      reset: function() {
        this._data = new l.init();
        this._nDataBytes = 0;
      },
      _append: function(n) {
        if (typeof n == "string") {
          n = c.parse(n);
        }
        this._data.concat(n);
        this._nDataBytes += n.sigBytes;
      },
      _process: function(w) {
        var q = this._data;
        var x = q.words;
        var n = q.sigBytes;
        var t = this.blockSize;
        var v = t * 4;
        var u = n / v;
        if (w) {
          u = e.ceil(u);
        } else {
          u = e.max((u | 0) - this._minBufferSize, 0);
        }
        var s = u * t;
        var r = e.min(s * 4, n);
        if (s) {
          for (var p = 0; p < s; p += t) {
            this._doProcessBlock(x, p);
          }
          var o = x.splice(0, s);
          q.sigBytes -= r;
        }
        return new l.init(o, r);
      },
      clone: function() {
        var n = j.clone.call(this);
        n._data = this._data.clone();
        return n;
      },
      _minBufferSize: 0
    });
    var f = b.Hasher = i.extend({
      cfg: j.extend(),
      init: function(n) {
        this.cfg = this.cfg.extend(n);
        this.reset();
      },
      reset: function() {
        i.reset.call(this);
        this._doReset();
      },
      update: function(n) {
        this._append(n);
        this._process();
        return this;
      },
      finalize: function(n) {
        if (n) {
          this._append(n);
        }
        var o = this._doFinalize();
        return o;
      },
      blockSize: 512 / 32,
      _createHelper: function(n) {
        return function(p, o) {
          return new n.init(o).finalize(p);
        };
      },
      _createHmacHelper: function(n) {
        return function(p, o) {
          return new k.HMAC.init(n, o).finalize(p);
        };
      }
    });
    var k = a.algo = {};
    return a;
  }(Math));
  (function(g) {
    var a = CryptoJS,
        f = a.lib,
        e = f.Base,
        h = f.WordArray,
        a = a.x64 = {};
    a.Word = e.extend({init: function(b, c) {
        this.high = b;
        this.low = c;
      }});
    a.WordArray = e.extend({
      init: function(b, c) {
        b = this.words = b || [];
        this.sigBytes = c != g ? c : 8 * b.length;
      },
      toX32: function() {
        for (var b = this.words,
            c = b.length,
            a = [],
            d = 0; d < c; d++) {
          var e = b[d];
          a.push(e.high);
          a.push(e.low);
        }
        return h.create(a, this.sigBytes);
      },
      clone: function() {
        for (var b = e.clone.call(this),
            c = b.words = this.words.slice(0),
            a = c.length,
            d = 0; d < a; d++)
          c[d] = c[d].clone();
        return b;
      }
    });
  })();
  (function() {
    var c = CryptoJS,
        k = c.enc.Utf8;
    c.algo.HMAC = c.lib.Base.extend({
      init: function(a, b) {
        a = this._hasher = new a.init;
        "string" == typeof b && (b = k.parse(b));
        var c = a.blockSize,
            e = 4 * c;
        b.sigBytes > e && (b = a.finalize(b));
        b.clamp();
        for (var f = this._oKey = b.clone(),
            g = this._iKey = b.clone(),
            h = f.words,
            j = g.words,
            d = 0; d < c; d++)
          h[d] ^= 1549556828, j[d] ^= 909522486;
        f.sigBytes = g.sigBytes = e;
        this.reset();
      },
      reset: function() {
        var a = this._hasher;
        a.reset();
        a.update(this._iKey);
      },
      update: function(a) {
        this._hasher.update(a);
        return this;
      },
      finalize: function(a) {
        var b = this._hasher;
        a = b.finalize(a);
        b.reset();
        return b.finalize(this._oKey.clone().concat(a));
      }
    });
  })();
  (function(k) {
    for (var g = CryptoJS,
        h = g.lib,
        v = h.WordArray,
        j = h.Hasher,
        h = g.algo,
        s = [],
        t = [],
        u = function(q) {
          return 4294967296 * (q - (q | 0)) | 0;
        },
        l = 2,
        b = 0; 64 > b; ) {
      var d;
      a: {
        d = l;
        for (var w = k.sqrt(d),
            r = 2; r <= w; r++)
          if (!(d % r)) {
            d = !1;
            break a;
          }
        d = !0;
      }
      d && (8 > b && (s[b] = u(k.pow(l, 0.5))), t[b] = u(k.pow(l, 1 / 3)), b++);
      l++;
    }
    var n = [],
        h = h.SHA256 = j.extend({
          _doReset: function() {
            this._hash = new v.init(s.slice(0));
          },
          _doProcessBlock: function(q, h) {
            for (var a = this._hash.words,
                c = a[0],
                d = a[1],
                b = a[2],
                k = a[3],
                f = a[4],
                g = a[5],
                j = a[6],
                l = a[7],
                e = 0; 64 > e; e++) {
              if (16 > e)
                n[e] = q[h + e] | 0;
              else {
                var m = n[e - 15],
                    p = n[e - 2];
                n[e] = ((m << 25 | m >>> 7) ^ (m << 14 | m >>> 18) ^ m >>> 3) + n[e - 7] + ((p << 15 | p >>> 17) ^ (p << 13 | p >>> 19) ^ p >>> 10) + n[e - 16];
              }
              m = l + ((f << 26 | f >>> 6) ^ (f << 21 | f >>> 11) ^ (f << 7 | f >>> 25)) + (f & g ^ ~f & j) + t[e] + n[e];
              p = ((c << 30 | c >>> 2) ^ (c << 19 | c >>> 13) ^ (c << 10 | c >>> 22)) + (c & d ^ c & b ^ d & b);
              l = j;
              j = g;
              g = f;
              f = k + m | 0;
              k = b;
              b = d;
              d = c;
              c = m + p | 0;
            }
            a[0] = a[0] + c | 0;
            a[1] = a[1] + d | 0;
            a[2] = a[2] + b | 0;
            a[3] = a[3] + k | 0;
            a[4] = a[4] + f | 0;
            a[5] = a[5] + g | 0;
            a[6] = a[6] + j | 0;
            a[7] = a[7] + l | 0;
          },
          _doFinalize: function() {
            var d = this._data,
                b = d.words,
                a = 8 * this._nDataBytes,
                c = 8 * d.sigBytes;
            b[c >>> 5] |= 128 << 24 - c % 32;
            b[(c + 64 >>> 9 << 4) + 14] = k.floor(a / 4294967296);
            b[(c + 64 >>> 9 << 4) + 15] = a;
            d.sigBytes = 4 * b.length;
            this._process();
            return this._hash;
          },
          clone: function() {
            var b = j.clone.call(this);
            b._hash = this._hash.clone();
            return b;
          }
        });
    g.SHA256 = j._createHelper(h);
    g.HmacSHA256 = j._createHmacHelper(h);
  })(Math);
  (function() {
    var b = CryptoJS,
        d = b.lib.WordArray,
        a = b.algo,
        c = a.SHA256,
        a = a.SHA224 = c.extend({
          _doReset: function() {
            this._hash = new d.init([3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025, 1694076839, 3204075428]);
          },
          _doFinalize: function() {
            var a = c._doFinalize.call(this);
            a.sigBytes -= 4;
            return a;
          }
        });
    b.SHA224 = c._createHelper(a);
    b.HmacSHA224 = c._createHmacHelper(a);
  })();
  (function() {
    function a() {
      return d.create.apply(d, arguments);
    }
    for (var n = CryptoJS,
        r = n.lib.Hasher,
        e = n.x64,
        d = e.Word,
        T = e.WordArray,
        e = n.algo,
        ea = [a(1116352408, 3609767458), a(1899447441, 602891725), a(3049323471, 3964484399), a(3921009573, 2173295548), a(961987163, 4081628472), a(1508970993, 3053834265), a(2453635748, 2937671579), a(2870763221, 3664609560), a(3624381080, 2734883394), a(310598401, 1164996542), a(607225278, 1323610764), a(1426881987, 3590304994), a(1925078388, 4068182383), a(2162078206, 991336113), a(2614888103, 633803317), a(3248222580, 3479774868), a(3835390401, 2666613458), a(4022224774, 944711139), a(264347078, 2341262773), a(604807628, 2007800933), a(770255983, 1495990901), a(1249150122, 1856431235), a(1555081692, 3175218132), a(1996064986, 2198950837), a(2554220882, 3999719339), a(2821834349, 766784016), a(2952996808, 2566594879), a(3210313671, 3203337956), a(3336571891, 1034457026), a(3584528711, 2466948901), a(113926993, 3758326383), a(338241895, 168717936), a(666307205, 1188179964), a(773529912, 1546045734), a(1294757372, 1522805485), a(1396182291, 2643833823), a(1695183700, 2343527390), a(1986661051, 1014477480), a(2177026350, 1206759142), a(2456956037, 344077627), a(2730485921, 1290863460), a(2820302411, 3158454273), a(3259730800, 3505952657), a(3345764771, 106217008), a(3516065817, 3606008344), a(3600352804, 1432725776), a(4094571909, 1467031594), a(275423344, 851169720), a(430227734, 3100823752), a(506948616, 1363258195), a(659060556, 3750685593), a(883997877, 3785050280), a(958139571, 3318307427), a(1322822218, 3812723403), a(1537002063, 2003034995), a(1747873779, 3602036899), a(1955562222, 1575990012), a(2024104815, 1125592928), a(2227730452, 2716904306), a(2361852424, 442776044), a(2428436474, 593698344), a(2756734187, 3733110249), a(3204031479, 2999351573), a(3329325298, 3815920427), a(3391569614, 3928383900), a(3515267271, 566280711), a(3940187606, 3454069534), a(4118630271, 4000239992), a(116418474, 1914138554), a(174292421, 2731055270), a(289380356, 3203993006), a(460393269, 320620315), a(685471733, 587496836), a(852142971, 1086792851), a(1017036298, 365543100), a(1126000580, 2618297676), a(1288033470, 3409855158), a(1501505948, 4234509866), a(1607167915, 987167468), a(1816402316, 1246189591)],
        v = [],
        w = 0; 80 > w; w++)
      v[w] = a();
    e = e.SHA512 = r.extend({
      _doReset: function() {
        this._hash = new T.init([new d.init(1779033703, 4089235720), new d.init(3144134277, 2227873595), new d.init(1013904242, 4271175723), new d.init(2773480762, 1595750129), new d.init(1359893119, 2917565137), new d.init(2600822924, 725511199), new d.init(528734635, 4215389547), new d.init(1541459225, 327033209)]);
      },
      _doProcessBlock: function(a, d) {
        for (var f = this._hash.words,
            F = f[0],
            e = f[1],
            n = f[2],
            r = f[3],
            G = f[4],
            H = f[5],
            I = f[6],
            f = f[7],
            w = F.high,
            J = F.low,
            X = e.high,
            K = e.low,
            Y = n.high,
            L = n.low,
            Z = r.high,
            M = r.low,
            $ = G.high,
            N = G.low,
            aa = H.high,
            O = H.low,
            ba = I.high,
            P = I.low,
            ca = f.high,
            Q = f.low,
            k = w,
            g = J,
            z = X,
            x = K,
            A = Y,
            y = L,
            U = Z,
            B = M,
            l = $,
            h = N,
            R = aa,
            C = O,
            S = ba,
            D = P,
            V = ca,
            E = Q,
            m = 0; 80 > m; m++) {
          var s = v[m];
          if (16 > m)
            var j = s.high = a[d + 2 * m] | 0,
                b = s.low = a[d + 2 * m + 1] | 0;
          else {
            var j = v[m - 15],
                b = j.high,
                p = j.low,
                j = (b >>> 1 | p << 31) ^ (b >>> 8 | p << 24) ^ b >>> 7,
                p = (p >>> 1 | b << 31) ^ (p >>> 8 | b << 24) ^ (p >>> 7 | b << 25),
                u = v[m - 2],
                b = u.high,
                c = u.low,
                u = (b >>> 19 | c << 13) ^ (b << 3 | c >>> 29) ^ b >>> 6,
                c = (c >>> 19 | b << 13) ^ (c << 3 | b >>> 29) ^ (c >>> 6 | b << 26),
                b = v[m - 7],
                W = b.high,
                t = v[m - 16],
                q = t.high,
                t = t.low,
                b = p + b.low,
                j = j + W + (b >>> 0 < p >>> 0 ? 1 : 0),
                b = b + c,
                j = j + u + (b >>> 0 < c >>> 0 ? 1 : 0),
                b = b + t,
                j = j + q + (b >>> 0 < t >>> 0 ? 1 : 0);
            s.high = j;
            s.low = b;
          }
          var W = l & R ^ ~l & S,
              t = h & C ^ ~h & D,
              s = k & z ^ k & A ^ z & A,
              T = g & x ^ g & y ^ x & y,
              p = (k >>> 28 | g << 4) ^ (k << 30 | g >>> 2) ^ (k << 25 | g >>> 7),
              u = (g >>> 28 | k << 4) ^ (g << 30 | k >>> 2) ^ (g << 25 | k >>> 7),
              c = ea[m],
              fa = c.high,
              da = c.low,
              c = E + ((h >>> 14 | l << 18) ^ (h >>> 18 | l << 14) ^ (h << 23 | l >>> 9)),
              q = V + ((l >>> 14 | h << 18) ^ (l >>> 18 | h << 14) ^ (l << 23 | h >>> 9)) + (c >>> 0 < E >>> 0 ? 1 : 0),
              c = c + t,
              q = q + W + (c >>> 0 < t >>> 0 ? 1 : 0),
              c = c + da,
              q = q + fa + (c >>> 0 < da >>> 0 ? 1 : 0),
              c = c + b,
              q = q + j + (c >>> 0 < b >>> 0 ? 1 : 0),
              b = u + T,
              s = p + s + (b >>> 0 < u >>> 0 ? 1 : 0),
              V = S,
              E = D,
              S = R,
              D = C,
              R = l,
              C = h,
              h = B + c | 0,
              l = U + q + (h >>> 0 < B >>> 0 ? 1 : 0) | 0,
              U = A,
              B = y,
              A = z,
              y = x,
              z = k,
              x = g,
              g = c + b | 0,
              k = q + s + (g >>> 0 < c >>> 0 ? 1 : 0) | 0;
        }
        J = F.low = J + g;
        F.high = w + k + (J >>> 0 < g >>> 0 ? 1 : 0);
        K = e.low = K + x;
        e.high = X + z + (K >>> 0 < x >>> 0 ? 1 : 0);
        L = n.low = L + y;
        n.high = Y + A + (L >>> 0 < y >>> 0 ? 1 : 0);
        M = r.low = M + B;
        r.high = Z + U + (M >>> 0 < B >>> 0 ? 1 : 0);
        N = G.low = N + h;
        G.high = $ + l + (N >>> 0 < h >>> 0 ? 1 : 0);
        O = H.low = O + C;
        H.high = aa + R + (O >>> 0 < C >>> 0 ? 1 : 0);
        P = I.low = P + D;
        I.high = ba + S + (P >>> 0 < D >>> 0 ? 1 : 0);
        Q = f.low = Q + E;
        f.high = ca + V + (Q >>> 0 < E >>> 0 ? 1 : 0);
      },
      _doFinalize: function() {
        var a = this._data,
            d = a.words,
            f = 8 * this._nDataBytes,
            e = 8 * a.sigBytes;
        d[e >>> 5] |= 128 << 24 - e % 32;
        d[(e + 128 >>> 10 << 5) + 30] = Math.floor(f / 4294967296);
        d[(e + 128 >>> 10 << 5) + 31] = f;
        a.sigBytes = 4 * d.length;
        this._process();
        return this._hash.toX32();
      },
      clone: function() {
        var a = r.clone.call(this);
        a._hash = this._hash.clone();
        return a;
      },
      blockSize: 32
    });
    n.SHA512 = r._createHelper(e);
    n.HmacSHA512 = r._createHmacHelper(e);
  })();
  (function() {
    var c = CryptoJS,
        a = c.x64,
        b = a.Word,
        e = a.WordArray,
        a = c.algo,
        d = a.SHA512,
        a = a.SHA384 = d.extend({
          _doReset: function() {
            this._hash = new e.init([new b.init(3418070365, 3238371032), new b.init(1654270250, 914150663), new b.init(2438529370, 812702999), new b.init(355462360, 4144912697), new b.init(1731405415, 4290775857), new b.init(2394180231, 1750603025), new b.init(3675008525, 1694076839), new b.init(1203062813, 3204075428)]);
          },
          _doFinalize: function() {
            var a = d._doFinalize.call(this);
            a.sigBytes -= 16;
            return a;
          }
        });
    c.SHA384 = d._createHelper(a);
    c.HmacSHA384 = d._createHmacHelper(a);
  })();
  (function(E) {
    function h(a, f, g, j, p, h, k) {
      a = a + (f & g | ~f & j) + p + k;
      return (a << h | a >>> 32 - h) + f;
    }
    function k(a, f, g, j, p, h, k) {
      a = a + (f & j | g & ~j) + p + k;
      return (a << h | a >>> 32 - h) + f;
    }
    function l(a, f, g, j, h, k, l) {
      a = a + (f ^ g ^ j) + h + l;
      return (a << k | a >>> 32 - k) + f;
    }
    function n(a, f, g, j, h, k, l) {
      a = a + (g ^ (f | ~j)) + h + l;
      return (a << k | a >>> 32 - k) + f;
    }
    for (var r = CryptoJS,
        q = r.lib,
        F = q.WordArray,
        s = q.Hasher,
        q = r.algo,
        a = [],
        t = 0; 64 > t; t++)
      a[t] = 4294967296 * E.abs(E.sin(t + 1)) | 0;
    q = q.MD5 = s.extend({
      _doReset: function() {
        this._hash = new F.init([1732584193, 4023233417, 2562383102, 271733878]);
      },
      _doProcessBlock: function(m, f) {
        for (var g = 0; 16 > g; g++) {
          var j = f + g,
              p = m[j];
          m[j] = (p << 8 | p >>> 24) & 16711935 | (p << 24 | p >>> 8) & 4278255360;
        }
        var g = this._hash.words,
            j = m[f + 0],
            p = m[f + 1],
            q = m[f + 2],
            r = m[f + 3],
            s = m[f + 4],
            t = m[f + 5],
            u = m[f + 6],
            v = m[f + 7],
            w = m[f + 8],
            x = m[f + 9],
            y = m[f + 10],
            z = m[f + 11],
            A = m[f + 12],
            B = m[f + 13],
            C = m[f + 14],
            D = m[f + 15],
            b = g[0],
            c = g[1],
            d = g[2],
            e = g[3],
            b = h(b, c, d, e, j, 7, a[0]),
            e = h(e, b, c, d, p, 12, a[1]),
            d = h(d, e, b, c, q, 17, a[2]),
            c = h(c, d, e, b, r, 22, a[3]),
            b = h(b, c, d, e, s, 7, a[4]),
            e = h(e, b, c, d, t, 12, a[5]),
            d = h(d, e, b, c, u, 17, a[6]),
            c = h(c, d, e, b, v, 22, a[7]),
            b = h(b, c, d, e, w, 7, a[8]),
            e = h(e, b, c, d, x, 12, a[9]),
            d = h(d, e, b, c, y, 17, a[10]),
            c = h(c, d, e, b, z, 22, a[11]),
            b = h(b, c, d, e, A, 7, a[12]),
            e = h(e, b, c, d, B, 12, a[13]),
            d = h(d, e, b, c, C, 17, a[14]),
            c = h(c, d, e, b, D, 22, a[15]),
            b = k(b, c, d, e, p, 5, a[16]),
            e = k(e, b, c, d, u, 9, a[17]),
            d = k(d, e, b, c, z, 14, a[18]),
            c = k(c, d, e, b, j, 20, a[19]),
            b = k(b, c, d, e, t, 5, a[20]),
            e = k(e, b, c, d, y, 9, a[21]),
            d = k(d, e, b, c, D, 14, a[22]),
            c = k(c, d, e, b, s, 20, a[23]),
            b = k(b, c, d, e, x, 5, a[24]),
            e = k(e, b, c, d, C, 9, a[25]),
            d = k(d, e, b, c, r, 14, a[26]),
            c = k(c, d, e, b, w, 20, a[27]),
            b = k(b, c, d, e, B, 5, a[28]),
            e = k(e, b, c, d, q, 9, a[29]),
            d = k(d, e, b, c, v, 14, a[30]),
            c = k(c, d, e, b, A, 20, a[31]),
            b = l(b, c, d, e, t, 4, a[32]),
            e = l(e, b, c, d, w, 11, a[33]),
            d = l(d, e, b, c, z, 16, a[34]),
            c = l(c, d, e, b, C, 23, a[35]),
            b = l(b, c, d, e, p, 4, a[36]),
            e = l(e, b, c, d, s, 11, a[37]),
            d = l(d, e, b, c, v, 16, a[38]),
            c = l(c, d, e, b, y, 23, a[39]),
            b = l(b, c, d, e, B, 4, a[40]),
            e = l(e, b, c, d, j, 11, a[41]),
            d = l(d, e, b, c, r, 16, a[42]),
            c = l(c, d, e, b, u, 23, a[43]),
            b = l(b, c, d, e, x, 4, a[44]),
            e = l(e, b, c, d, A, 11, a[45]),
            d = l(d, e, b, c, D, 16, a[46]),
            c = l(c, d, e, b, q, 23, a[47]),
            b = n(b, c, d, e, j, 6, a[48]),
            e = n(e, b, c, d, v, 10, a[49]),
            d = n(d, e, b, c, C, 15, a[50]),
            c = n(c, d, e, b, t, 21, a[51]),
            b = n(b, c, d, e, A, 6, a[52]),
            e = n(e, b, c, d, r, 10, a[53]),
            d = n(d, e, b, c, y, 15, a[54]),
            c = n(c, d, e, b, p, 21, a[55]),
            b = n(b, c, d, e, w, 6, a[56]),
            e = n(e, b, c, d, D, 10, a[57]),
            d = n(d, e, b, c, u, 15, a[58]),
            c = n(c, d, e, b, B, 21, a[59]),
            b = n(b, c, d, e, s, 6, a[60]),
            e = n(e, b, c, d, z, 10, a[61]),
            d = n(d, e, b, c, q, 15, a[62]),
            c = n(c, d, e, b, x, 21, a[63]);
        g[0] = g[0] + b | 0;
        g[1] = g[1] + c | 0;
        g[2] = g[2] + d | 0;
        g[3] = g[3] + e | 0;
      },
      _doFinalize: function() {
        var a = this._data,
            f = a.words,
            g = 8 * this._nDataBytes,
            j = 8 * a.sigBytes;
        f[j >>> 5] |= 128 << 24 - j % 32;
        var h = E.floor(g / 4294967296);
        f[(j + 64 >>> 9 << 4) + 15] = (h << 8 | h >>> 24) & 16711935 | (h << 24 | h >>> 8) & 4278255360;
        f[(j + 64 >>> 9 << 4) + 14] = (g << 8 | g >>> 24) & 16711935 | (g << 24 | g >>> 8) & 4278255360;
        a.sigBytes = 4 * (f.length + 1);
        this._process();
        a = this._hash;
        f = a.words;
        for (g = 0; 4 > g; g++)
          j = f[g], f[g] = (j << 8 | j >>> 24) & 16711935 | (j << 24 | j >>> 8) & 4278255360;
        return a;
      },
      clone: function() {
        var a = s.clone.call(this);
        a._hash = this._hash.clone();
        return a;
      }
    });
    r.MD5 = s._createHelper(q);
    r.HmacMD5 = s._createHmacHelper(q);
  })(Math);
  (function() {
    var h = CryptoJS,
        j = h.lib.WordArray;
    h.enc.Base64 = {
      stringify: function(b) {
        var e = b.words,
            f = b.sigBytes,
            c = this._map;
        b.clamp();
        b = [];
        for (var a = 0; a < f; a += 3)
          for (var d = (e[a >>> 2] >>> 24 - 8 * (a % 4) & 255) << 16 | (e[a + 1 >>> 2] >>> 24 - 8 * ((a + 1) % 4) & 255) << 8 | e[a + 2 >>> 2] >>> 24 - 8 * ((a + 2) % 4) & 255,
              g = 0; 4 > g && a + 0.75 * g < f; g++)
            b.push(c.charAt(d >>> 6 * (3 - g) & 63));
        if (e = c.charAt(64))
          for (; b.length % 4; )
            b.push(e);
        return b.join("");
      },
      parse: function(b) {
        var e = b.length,
            f = this._map,
            c = f.charAt(64);
        c && (c = b.indexOf(c), -1 != c && (e = c));
        for (var c = [],
            a = 0,
            d = 0; d < e; d++)
          if (d % 4) {
            var g = f.indexOf(b.charAt(d - 1)) << 2 * (d % 4),
                h = f.indexOf(b.charAt(d)) >>> 6 - 2 * (d % 4);
            c[a >>> 2] |= (g | h) << 24 - 8 * (a % 4);
            a++;
          }
        return j.create(c, a);
      },
      _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    };
  })();
  CryptoJS.lib.Cipher || function(u) {
    var g = CryptoJS,
        f = g.lib,
        k = f.Base,
        l = f.WordArray,
        q = f.BufferedBlockAlgorithm,
        r = g.enc.Base64,
        v = g.algo.EvpKDF,
        n = f.Cipher = q.extend({
          cfg: k.extend(),
          createEncryptor: function(a, b) {
            return this.create(this._ENC_XFORM_MODE, a, b);
          },
          createDecryptor: function(a, b) {
            return this.create(this._DEC_XFORM_MODE, a, b);
          },
          init: function(a, b, c) {
            this.cfg = this.cfg.extend(c);
            this._xformMode = a;
            this._key = b;
            this.reset();
          },
          reset: function() {
            q.reset.call(this);
            this._doReset();
          },
          process: function(a) {
            this._append(a);
            return this._process();
          },
          finalize: function(a) {
            a && this._append(a);
            return this._doFinalize();
          },
          keySize: 4,
          ivSize: 4,
          _ENC_XFORM_MODE: 1,
          _DEC_XFORM_MODE: 2,
          _createHelper: function(a) {
            return {
              encrypt: function(b, c, d) {
                return ("string" == typeof c ? s : j).encrypt(a, b, c, d);
              },
              decrypt: function(b, c, d) {
                return ("string" == typeof c ? s : j).decrypt(a, b, c, d);
              }
            };
          }
        });
    f.StreamCipher = n.extend({
      _doFinalize: function() {
        return this._process(!0);
      },
      blockSize: 1
    });
    var m = g.mode = {},
        t = function(a, b, c) {
          var d = this._iv;
          d ? this._iv = u : d = this._prevBlock;
          for (var e = 0; e < c; e++)
            a[b + e] ^= d[e];
        },
        h = (f.BlockCipherMode = k.extend({
          createEncryptor: function(a, b) {
            return this.Encryptor.create(a, b);
          },
          createDecryptor: function(a, b) {
            return this.Decryptor.create(a, b);
          },
          init: function(a, b) {
            this._cipher = a;
            this._iv = b;
          }
        })).extend();
    h.Encryptor = h.extend({processBlock: function(a, b) {
        var c = this._cipher,
            d = c.blockSize;
        t.call(this, a, b, d);
        c.encryptBlock(a, b);
        this._prevBlock = a.slice(b, b + d);
      }});
    h.Decryptor = h.extend({processBlock: function(a, b) {
        var c = this._cipher,
            d = c.blockSize,
            e = a.slice(b, b + d);
        c.decryptBlock(a, b);
        t.call(this, a, b, d);
        this._prevBlock = e;
      }});
    m = m.CBC = h;
    h = (g.pad = {}).Pkcs7 = {
      pad: function(a, b) {
        for (var c = 4 * b,
            c = c - a.sigBytes % c,
            d = c << 24 | c << 16 | c << 8 | c,
            e = [],
            f = 0; f < c; f += 4)
          e.push(d);
        c = l.create(e, c);
        a.concat(c);
      },
      unpad: function(a) {
        a.sigBytes -= a.words[a.sigBytes - 1 >>> 2] & 255;
      }
    };
    f.BlockCipher = n.extend({
      cfg: n.cfg.extend({
        mode: m,
        padding: h
      }),
      reset: function() {
        n.reset.call(this);
        var a = this.cfg,
            b = a.iv,
            a = a.mode;
        if (this._xformMode == this._ENC_XFORM_MODE)
          var c = a.createEncryptor;
        else
          c = a.createDecryptor, this._minBufferSize = 1;
        this._mode = c.call(a, this, b && b.words);
      },
      _doProcessBlock: function(a, b) {
        this._mode.processBlock(a, b);
      },
      _doFinalize: function() {
        var a = this.cfg.padding;
        if (this._xformMode == this._ENC_XFORM_MODE) {
          a.pad(this._data, this.blockSize);
          var b = this._process(!0);
        } else
          b = this._process(!0), a.unpad(b);
        return b;
      },
      blockSize: 4
    });
    var p = f.CipherParams = k.extend({
      init: function(a) {
        this.mixIn(a);
      },
      toString: function(a) {
        return (a || this.formatter).stringify(this);
      }
    }),
        m = (g.format = {}).OpenSSL = {
          stringify: function(a) {
            var b = a.ciphertext;
            a = a.salt;
            return (a ? l.create([1398893684, 1701076831]).concat(a).concat(b) : b).toString(r);
          },
          parse: function(a) {
            a = r.parse(a);
            var b = a.words;
            if (1398893684 == b[0] && 1701076831 == b[1]) {
              var c = l.create(b.slice(2, 4));
              b.splice(0, 4);
              a.sigBytes -= 16;
            }
            return p.create({
              ciphertext: a,
              salt: c
            });
          }
        },
        j = f.SerializableCipher = k.extend({
          cfg: k.extend({format: m}),
          encrypt: function(a, b, c, d) {
            d = this.cfg.extend(d);
            var e = a.createEncryptor(c, d);
            b = e.finalize(b);
            e = e.cfg;
            return p.create({
              ciphertext: b,
              key: c,
              iv: e.iv,
              algorithm: a,
              mode: e.mode,
              padding: e.padding,
              blockSize: a.blockSize,
              formatter: d.format
            });
          },
          decrypt: function(a, b, c, d) {
            d = this.cfg.extend(d);
            b = this._parse(b, d.format);
            return a.createDecryptor(c, d).finalize(b.ciphertext);
          },
          _parse: function(a, b) {
            return "string" == typeof a ? b.parse(a, this) : a;
          }
        }),
        g = (g.kdf = {}).OpenSSL = {execute: function(a, b, c, d) {
            d || (d = l.random(8));
            a = v.create({keySize: b + c}).compute(a, d);
            c = l.create(a.words.slice(b), 4 * c);
            a.sigBytes = 4 * b;
            return p.create({
              key: a,
              iv: c,
              salt: d
            });
          }},
        s = f.PasswordBasedCipher = j.extend({
          cfg: j.cfg.extend({kdf: g}),
          encrypt: function(a, b, c, d) {
            d = this.cfg.extend(d);
            c = d.kdf.execute(c, a.keySize, a.ivSize);
            d.iv = c.iv;
            a = j.encrypt.call(this, a, b, c.key, d);
            a.mixIn(c);
            return a;
          },
          decrypt: function(a, b, c, d) {
            d = this.cfg.extend(d);
            b = this._parse(b, d.format);
            c = d.kdf.execute(c, a.keySize, a.ivSize, b.salt);
            d.iv = c.iv;
            return j.decrypt.call(this, a, b, c.key, d);
          }
        });
  }();
  (function() {
    for (var q = CryptoJS,
        x = q.lib.BlockCipher,
        r = q.algo,
        j = [],
        y = [],
        z = [],
        A = [],
        B = [],
        C = [],
        s = [],
        u = [],
        v = [],
        w = [],
        g = [],
        k = 0; 256 > k; k++)
      g[k] = 128 > k ? k << 1 : k << 1 ^ 283;
    for (var n = 0,
        l = 0,
        k = 0; 256 > k; k++) {
      var f = l ^ l << 1 ^ l << 2 ^ l << 3 ^ l << 4,
          f = f >>> 8 ^ f & 255 ^ 99;
      j[n] = f;
      y[f] = n;
      var t = g[n],
          D = g[t],
          E = g[D],
          b = 257 * g[f] ^ 16843008 * f;
      z[n] = b << 24 | b >>> 8;
      A[n] = b << 16 | b >>> 16;
      B[n] = b << 8 | b >>> 24;
      C[n] = b;
      b = 16843009 * E ^ 65537 * D ^ 257 * t ^ 16843008 * n;
      s[f] = b << 24 | b >>> 8;
      u[f] = b << 16 | b >>> 16;
      v[f] = b << 8 | b >>> 24;
      w[f] = b;
      n ? (n = t ^ g[g[g[E ^ t]]], l ^= g[g[l]]) : n = l = 1;
    }
    var F = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54],
        r = r.AES = x.extend({
          _doReset: function() {
            for (var c = this._key,
                e = c.words,
                a = c.sigBytes / 4,
                c = 4 * ((this._nRounds = a + 6) + 1),
                b = this._keySchedule = [],
                h = 0; h < c; h++)
              if (h < a)
                b[h] = e[h];
              else {
                var d = b[h - 1];
                h % a ? 6 < a && 4 == h % a && (d = j[d >>> 24] << 24 | j[d >>> 16 & 255] << 16 | j[d >>> 8 & 255] << 8 | j[d & 255]) : (d = d << 8 | d >>> 24, d = j[d >>> 24] << 24 | j[d >>> 16 & 255] << 16 | j[d >>> 8 & 255] << 8 | j[d & 255], d ^= F[h / a | 0] << 24);
                b[h] = b[h - a] ^ d;
              }
            e = this._invKeySchedule = [];
            for (a = 0; a < c; a++)
              h = c - a, d = a % 4 ? b[h] : b[h - 4], e[a] = 4 > a || 4 >= h ? d : s[j[d >>> 24]] ^ u[j[d >>> 16 & 255]] ^ v[j[d >>> 8 & 255]] ^ w[j[d & 255]];
          },
          encryptBlock: function(c, e) {
            this._doCryptBlock(c, e, this._keySchedule, z, A, B, C, j);
          },
          decryptBlock: function(c, e) {
            var a = c[e + 1];
            c[e + 1] = c[e + 3];
            c[e + 3] = a;
            this._doCryptBlock(c, e, this._invKeySchedule, s, u, v, w, y);
            a = c[e + 1];
            c[e + 1] = c[e + 3];
            c[e + 3] = a;
          },
          _doCryptBlock: function(c, e, a, b, h, d, j, m) {
            for (var n = this._nRounds,
                f = c[e] ^ a[0],
                g = c[e + 1] ^ a[1],
                k = c[e + 2] ^ a[2],
                p = c[e + 3] ^ a[3],
                l = 4,
                t = 1; t < n; t++)
              var q = b[f >>> 24] ^ h[g >>> 16 & 255] ^ d[k >>> 8 & 255] ^ j[p & 255] ^ a[l++],
                  r = b[g >>> 24] ^ h[k >>> 16 & 255] ^ d[p >>> 8 & 255] ^ j[f & 255] ^ a[l++],
                  s = b[k >>> 24] ^ h[p >>> 16 & 255] ^ d[f >>> 8 & 255] ^ j[g & 255] ^ a[l++],
                  p = b[p >>> 24] ^ h[f >>> 16 & 255] ^ d[g >>> 8 & 255] ^ j[k & 255] ^ a[l++],
                  f = q,
                  g = r,
                  k = s;
            q = (m[f >>> 24] << 24 | m[g >>> 16 & 255] << 16 | m[k >>> 8 & 255] << 8 | m[p & 255]) ^ a[l++];
            r = (m[g >>> 24] << 24 | m[k >>> 16 & 255] << 16 | m[p >>> 8 & 255] << 8 | m[f & 255]) ^ a[l++];
            s = (m[k >>> 24] << 24 | m[p >>> 16 & 255] << 16 | m[f >>> 8 & 255] << 8 | m[g & 255]) ^ a[l++];
            p = (m[p >>> 24] << 24 | m[f >>> 16 & 255] << 16 | m[g >>> 8 & 255] << 8 | m[k & 255]) ^ a[l++];
            c[e] = q;
            c[e + 1] = r;
            c[e + 2] = s;
            c[e + 3] = p;
          },
          keySize: 8
        });
    q.AES = x._createHelper(r);
  })();
  (function() {
    function j(b, c) {
      var a = (this._lBlock >>> b ^ this._rBlock) & c;
      this._rBlock ^= a;
      this._lBlock ^= a << b;
    }
    function l(b, c) {
      var a = (this._rBlock >>> b ^ this._lBlock) & c;
      this._lBlock ^= a;
      this._rBlock ^= a << b;
    }
    var h = CryptoJS,
        e = h.lib,
        n = e.WordArray,
        e = e.BlockCipher,
        g = h.algo,
        q = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4],
        p = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32],
        r = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28],
        s = [{
          "0": 8421888,
          268435456: 32768,
          536870912: 8421378,
          805306368: 2,
          1073741824: 512,
          1342177280: 8421890,
          1610612736: 8389122,
          1879048192: 8388608,
          2147483648: 514,
          2415919104: 8389120,
          2684354560: 33280,
          2952790016: 8421376,
          3221225472: 32770,
          3489660928: 8388610,
          3758096384: 0,
          4026531840: 33282,
          134217728: 0,
          402653184: 8421890,
          671088640: 33282,
          939524096: 32768,
          1207959552: 8421888,
          1476395008: 512,
          1744830464: 8421378,
          2013265920: 2,
          2281701376: 8389120,
          2550136832: 33280,
          2818572288: 8421376,
          3087007744: 8389122,
          3355443200: 8388610,
          3623878656: 32770,
          3892314112: 514,
          4160749568: 8388608,
          1: 32768,
          268435457: 2,
          536870913: 8421888,
          805306369: 8388608,
          1073741825: 8421378,
          1342177281: 33280,
          1610612737: 512,
          1879048193: 8389122,
          2147483649: 8421890,
          2415919105: 8421376,
          2684354561: 8388610,
          2952790017: 33282,
          3221225473: 514,
          3489660929: 8389120,
          3758096385: 32770,
          4026531841: 0,
          134217729: 8421890,
          402653185: 8421376,
          671088641: 8388608,
          939524097: 512,
          1207959553: 32768,
          1476395009: 8388610,
          1744830465: 2,
          2013265921: 33282,
          2281701377: 32770,
          2550136833: 8389122,
          2818572289: 514,
          3087007745: 8421888,
          3355443201: 8389120,
          3623878657: 0,
          3892314113: 33280,
          4160749569: 8421378
        }, {
          "0": 1074282512,
          16777216: 16384,
          33554432: 524288,
          50331648: 1074266128,
          67108864: 1073741840,
          83886080: 1074282496,
          100663296: 1073758208,
          117440512: 16,
          134217728: 540672,
          150994944: 1073758224,
          167772160: 1073741824,
          184549376: 540688,
          201326592: 524304,
          218103808: 0,
          234881024: 16400,
          251658240: 1074266112,
          8388608: 1073758208,
          25165824: 540688,
          41943040: 16,
          58720256: 1073758224,
          75497472: 1074282512,
          92274688: 1073741824,
          109051904: 524288,
          125829120: 1074266128,
          142606336: 524304,
          159383552: 0,
          176160768: 16384,
          192937984: 1074266112,
          209715200: 1073741840,
          226492416: 540672,
          243269632: 1074282496,
          260046848: 16400,
          268435456: 0,
          285212672: 1074266128,
          301989888: 1073758224,
          318767104: 1074282496,
          335544320: 1074266112,
          352321536: 16,
          369098752: 540688,
          385875968: 16384,
          402653184: 16400,
          419430400: 524288,
          436207616: 524304,
          452984832: 1073741840,
          469762048: 540672,
          486539264: 1073758208,
          503316480: 1073741824,
          520093696: 1074282512,
          276824064: 540688,
          293601280: 524288,
          310378496: 1074266112,
          327155712: 16384,
          343932928: 1073758208,
          360710144: 1074282512,
          377487360: 16,
          394264576: 1073741824,
          411041792: 1074282496,
          427819008: 1073741840,
          444596224: 1073758224,
          461373440: 524304,
          478150656: 0,
          494927872: 16400,
          511705088: 1074266128,
          528482304: 540672
        }, {
          "0": 260,
          1048576: 0,
          2097152: 67109120,
          3145728: 65796,
          4194304: 65540,
          5242880: 67108868,
          6291456: 67174660,
          7340032: 67174400,
          8388608: 67108864,
          9437184: 67174656,
          10485760: 65792,
          11534336: 67174404,
          12582912: 67109124,
          13631488: 65536,
          14680064: 4,
          15728640: 256,
          524288: 67174656,
          1572864: 67174404,
          2621440: 0,
          3670016: 67109120,
          4718592: 67108868,
          5767168: 65536,
          6815744: 65540,
          7864320: 260,
          8912896: 4,
          9961472: 256,
          11010048: 67174400,
          12058624: 65796,
          13107200: 65792,
          14155776: 67109124,
          15204352: 67174660,
          16252928: 67108864,
          16777216: 67174656,
          17825792: 65540,
          18874368: 65536,
          19922944: 67109120,
          20971520: 256,
          22020096: 67174660,
          23068672: 67108868,
          24117248: 0,
          25165824: 67109124,
          26214400: 67108864,
          27262976: 4,
          28311552: 65792,
          29360128: 67174400,
          30408704: 260,
          31457280: 65796,
          32505856: 67174404,
          17301504: 67108864,
          18350080: 260,
          19398656: 67174656,
          20447232: 0,
          21495808: 65540,
          22544384: 67109120,
          23592960: 256,
          24641536: 67174404,
          25690112: 65536,
          26738688: 67174660,
          27787264: 65796,
          28835840: 67108868,
          29884416: 67109124,
          30932992: 67174400,
          31981568: 4,
          33030144: 65792
        }, {
          "0": 2151682048,
          65536: 2147487808,
          131072: 4198464,
          196608: 2151677952,
          262144: 0,
          327680: 4198400,
          393216: 2147483712,
          458752: 4194368,
          524288: 2147483648,
          589824: 4194304,
          655360: 64,
          720896: 2147487744,
          786432: 2151678016,
          851968: 4160,
          917504: 4096,
          983040: 2151682112,
          32768: 2147487808,
          98304: 64,
          163840: 2151678016,
          229376: 2147487744,
          294912: 4198400,
          360448: 2151682112,
          425984: 0,
          491520: 2151677952,
          557056: 4096,
          622592: 2151682048,
          688128: 4194304,
          753664: 4160,
          819200: 2147483648,
          884736: 4194368,
          950272: 4198464,
          1015808: 2147483712,
          1048576: 4194368,
          1114112: 4198400,
          1179648: 2147483712,
          1245184: 0,
          1310720: 4160,
          1376256: 2151678016,
          1441792: 2151682048,
          1507328: 2147487808,
          1572864: 2151682112,
          1638400: 2147483648,
          1703936: 2151677952,
          1769472: 4198464,
          1835008: 2147487744,
          1900544: 4194304,
          1966080: 64,
          2031616: 4096,
          1081344: 2151677952,
          1146880: 2151682112,
          1212416: 0,
          1277952: 4198400,
          1343488: 4194368,
          1409024: 2147483648,
          1474560: 2147487808,
          1540096: 64,
          1605632: 2147483712,
          1671168: 4096,
          1736704: 2147487744,
          1802240: 2151678016,
          1867776: 4160,
          1933312: 2151682048,
          1998848: 4194304,
          2064384: 4198464
        }, {
          "0": 128,
          4096: 17039360,
          8192: 262144,
          12288: 536870912,
          16384: 537133184,
          20480: 16777344,
          24576: 553648256,
          28672: 262272,
          32768: 16777216,
          36864: 537133056,
          40960: 536871040,
          45056: 553910400,
          49152: 553910272,
          53248: 0,
          57344: 17039488,
          61440: 553648128,
          2048: 17039488,
          6144: 553648256,
          10240: 128,
          14336: 17039360,
          18432: 262144,
          22528: 537133184,
          26624: 553910272,
          30720: 536870912,
          34816: 537133056,
          38912: 0,
          43008: 553910400,
          47104: 16777344,
          51200: 536871040,
          55296: 553648128,
          59392: 16777216,
          63488: 262272,
          65536: 262144,
          69632: 128,
          73728: 536870912,
          77824: 553648256,
          81920: 16777344,
          86016: 553910272,
          90112: 537133184,
          94208: 16777216,
          98304: 553910400,
          102400: 553648128,
          106496: 17039360,
          110592: 537133056,
          114688: 262272,
          118784: 536871040,
          122880: 0,
          126976: 17039488,
          67584: 553648256,
          71680: 16777216,
          75776: 17039360,
          79872: 537133184,
          83968: 536870912,
          88064: 17039488,
          92160: 128,
          96256: 553910272,
          100352: 262272,
          104448: 553910400,
          108544: 0,
          112640: 553648128,
          116736: 16777344,
          120832: 262144,
          124928: 537133056,
          129024: 536871040
        }, {
          "0": 268435464,
          256: 8192,
          512: 270532608,
          768: 270540808,
          1024: 268443648,
          1280: 2097152,
          1536: 2097160,
          1792: 268435456,
          2048: 0,
          2304: 268443656,
          2560: 2105344,
          2816: 8,
          3072: 270532616,
          3328: 2105352,
          3584: 8200,
          3840: 270540800,
          128: 270532608,
          384: 270540808,
          640: 8,
          896: 2097152,
          1152: 2105352,
          1408: 268435464,
          1664: 268443648,
          1920: 8200,
          2176: 2097160,
          2432: 8192,
          2688: 268443656,
          2944: 270532616,
          3200: 0,
          3456: 270540800,
          3712: 2105344,
          3968: 268435456,
          4096: 268443648,
          4352: 270532616,
          4608: 270540808,
          4864: 8200,
          5120: 2097152,
          5376: 268435456,
          5632: 268435464,
          5888: 2105344,
          6144: 2105352,
          6400: 0,
          6656: 8,
          6912: 270532608,
          7168: 8192,
          7424: 268443656,
          7680: 270540800,
          7936: 2097160,
          4224: 8,
          4480: 2105344,
          4736: 2097152,
          4992: 268435464,
          5248: 268443648,
          5504: 8200,
          5760: 270540808,
          6016: 270532608,
          6272: 270540800,
          6528: 270532616,
          6784: 8192,
          7040: 2105352,
          7296: 2097160,
          7552: 0,
          7808: 268435456,
          8064: 268443656
        }, {
          "0": 1048576,
          16: 33555457,
          32: 1024,
          48: 1049601,
          64: 34604033,
          80: 0,
          96: 1,
          112: 34603009,
          128: 33555456,
          144: 1048577,
          160: 33554433,
          176: 34604032,
          192: 34603008,
          208: 1025,
          224: 1049600,
          240: 33554432,
          8: 34603009,
          24: 0,
          40: 33555457,
          56: 34604032,
          72: 1048576,
          88: 33554433,
          104: 33554432,
          120: 1025,
          136: 1049601,
          152: 33555456,
          168: 34603008,
          184: 1048577,
          200: 1024,
          216: 34604033,
          232: 1,
          248: 1049600,
          256: 33554432,
          272: 1048576,
          288: 33555457,
          304: 34603009,
          320: 1048577,
          336: 33555456,
          352: 34604032,
          368: 1049601,
          384: 1025,
          400: 34604033,
          416: 1049600,
          432: 1,
          448: 0,
          464: 34603008,
          480: 33554433,
          496: 1024,
          264: 1049600,
          280: 33555457,
          296: 34603009,
          312: 1,
          328: 33554432,
          344: 1048576,
          360: 1025,
          376: 34604032,
          392: 33554433,
          408: 34603008,
          424: 0,
          440: 34604033,
          456: 1049601,
          472: 1024,
          488: 33555456,
          504: 1048577
        }, {
          "0": 134219808,
          1: 131072,
          2: 134217728,
          3: 32,
          4: 131104,
          5: 134350880,
          6: 134350848,
          7: 2048,
          8: 134348800,
          9: 134219776,
          10: 133120,
          11: 134348832,
          12: 2080,
          13: 0,
          14: 134217760,
          15: 133152,
          2147483648: 2048,
          2147483649: 134350880,
          2147483650: 134219808,
          2147483651: 134217728,
          2147483652: 134348800,
          2147483653: 133120,
          2147483654: 133152,
          2147483655: 32,
          2147483656: 134217760,
          2147483657: 2080,
          2147483658: 131104,
          2147483659: 134350848,
          2147483660: 0,
          2147483661: 134348832,
          2147483662: 134219776,
          2147483663: 131072,
          16: 133152,
          17: 134350848,
          18: 32,
          19: 2048,
          20: 134219776,
          21: 134217760,
          22: 134348832,
          23: 131072,
          24: 0,
          25: 131104,
          26: 134348800,
          27: 134219808,
          28: 134350880,
          29: 133120,
          30: 2080,
          31: 134217728,
          2147483664: 131072,
          2147483665: 2048,
          2147483666: 134348832,
          2147483667: 133152,
          2147483668: 32,
          2147483669: 134348800,
          2147483670: 134217728,
          2147483671: 134219808,
          2147483672: 134350880,
          2147483673: 134217760,
          2147483674: 134219776,
          2147483675: 0,
          2147483676: 133120,
          2147483677: 2080,
          2147483678: 131104,
          2147483679: 134350848
        }],
        t = [4160749569, 528482304, 33030144, 2064384, 129024, 8064, 504, 2147483679],
        m = g.DES = e.extend({
          _doReset: function() {
            for (var b = this._key.words,
                c = [],
                a = 0; 56 > a; a++) {
              var f = q[a] - 1;
              c[a] = b[f >>> 5] >>> 31 - f % 32 & 1;
            }
            b = this._subKeys = [];
            for (f = 0; 16 > f; f++) {
              for (var d = b[f] = [],
                  e = r[f],
                  a = 0; 24 > a; a++)
                d[a / 6 | 0] |= c[(p[a] - 1 + e) % 28] << 31 - a % 6, d[4 + (a / 6 | 0)] |= c[28 + (p[a + 24] - 1 + e) % 28] << 31 - a % 6;
              d[0] = d[0] << 1 | d[0] >>> 31;
              for (a = 1; 7 > a; a++)
                d[a] >>>= 4 * (a - 1) + 3;
              d[7] = d[7] << 5 | d[7] >>> 27;
            }
            c = this._invSubKeys = [];
            for (a = 0; 16 > a; a++)
              c[a] = b[15 - a];
          },
          encryptBlock: function(b, c) {
            this._doCryptBlock(b, c, this._subKeys);
          },
          decryptBlock: function(b, c) {
            this._doCryptBlock(b, c, this._invSubKeys);
          },
          _doCryptBlock: function(b, c, a) {
            this._lBlock = b[c];
            this._rBlock = b[c + 1];
            j.call(this, 4, 252645135);
            j.call(this, 16, 65535);
            l.call(this, 2, 858993459);
            l.call(this, 8, 16711935);
            j.call(this, 1, 1431655765);
            for (var f = 0; 16 > f; f++) {
              for (var d = a[f],
                  e = this._lBlock,
                  h = this._rBlock,
                  g = 0,
                  k = 0; 8 > k; k++)
                g |= s[k][((h ^ d[k]) & t[k]) >>> 0];
              this._lBlock = h;
              this._rBlock = e ^ g;
            }
            a = this._lBlock;
            this._lBlock = this._rBlock;
            this._rBlock = a;
            j.call(this, 1, 1431655765);
            l.call(this, 8, 16711935);
            l.call(this, 2, 858993459);
            j.call(this, 16, 65535);
            j.call(this, 4, 252645135);
            b[c] = this._lBlock;
            b[c + 1] = this._rBlock;
          },
          keySize: 2,
          ivSize: 2,
          blockSize: 2
        });
    h.DES = e._createHelper(m);
    g = g.TripleDES = e.extend({
      _doReset: function() {
        var b = this._key.words;
        this._des1 = m.createEncryptor(n.create(b.slice(0, 2)));
        this._des2 = m.createEncryptor(n.create(b.slice(2, 4)));
        this._des3 = m.createEncryptor(n.create(b.slice(4, 6)));
      },
      encryptBlock: function(b, c) {
        this._des1.encryptBlock(b, c);
        this._des2.decryptBlock(b, c);
        this._des3.encryptBlock(b, c);
      },
      decryptBlock: function(b, c) {
        this._des3.decryptBlock(b, c);
        this._des2.encryptBlock(b, c);
        this._des1.decryptBlock(b, c);
      },
      keySize: 6,
      ivSize: 2,
      blockSize: 2
    });
    h.TripleDES = e._createHelper(g);
  })();
  (function() {
    var k = CryptoJS,
        b = k.lib,
        m = b.WordArray,
        l = b.Hasher,
        d = [],
        b = k.algo.SHA1 = l.extend({
          _doReset: function() {
            this._hash = new m.init([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
          },
          _doProcessBlock: function(n, p) {
            for (var a = this._hash.words,
                e = a[0],
                f = a[1],
                h = a[2],
                j = a[3],
                b = a[4],
                c = 0; 80 > c; c++) {
              if (16 > c)
                d[c] = n[p + c] | 0;
              else {
                var g = d[c - 3] ^ d[c - 8] ^ d[c - 14] ^ d[c - 16];
                d[c] = g << 1 | g >>> 31;
              }
              g = (e << 5 | e >>> 27) + b + d[c];
              g = 20 > c ? g + ((f & h | ~f & j) + 1518500249) : 40 > c ? g + ((f ^ h ^ j) + 1859775393) : 60 > c ? g + ((f & h | f & j | h & j) - 1894007588) : g + ((f ^ h ^ j) - 899497514);
              b = j;
              j = h;
              h = f << 30 | f >>> 2;
              f = e;
              e = g;
            }
            a[0] = a[0] + e | 0;
            a[1] = a[1] + f | 0;
            a[2] = a[2] + h | 0;
            a[3] = a[3] + j | 0;
            a[4] = a[4] + b | 0;
          },
          _doFinalize: function() {
            var b = this._data,
                d = b.words,
                a = 8 * this._nDataBytes,
                e = 8 * b.sigBytes;
            d[e >>> 5] |= 128 << 24 - e % 32;
            d[(e + 64 >>> 9 << 4) + 14] = Math.floor(a / 4294967296);
            d[(e + 64 >>> 9 << 4) + 15] = a;
            b.sigBytes = 4 * d.length;
            this._process();
            return this._hash;
          },
          clone: function() {
            var b = l.clone.call(this);
            b._hash = this._hash.clone();
            return b;
          }
        });
    k.SHA1 = l._createHelper(b);
    k.HmacSHA1 = l._createHmacHelper(b);
  })();
  (function() {
    var q = CryptoJS,
        d = q.lib,
        n = d.WordArray,
        p = d.Hasher,
        d = q.algo,
        x = n.create([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13]),
        y = n.create([5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11]),
        z = n.create([11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6]),
        A = n.create([8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11]),
        B = n.create([0, 1518500249, 1859775393, 2400959708, 2840853838]),
        C = n.create([1352829926, 1548603684, 1836072691, 2053994217, 0]),
        d = d.RIPEMD160 = p.extend({
          _doReset: function() {
            this._hash = n.create([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
          },
          _doProcessBlock: function(e, v) {
            for (var b = 0; 16 > b; b++) {
              var c = v + b,
                  f = e[c];
              e[c] = (f << 8 | f >>> 24) & 16711935 | (f << 24 | f >>> 8) & 4278255360;
            }
            var c = this._hash.words,
                f = B.words,
                d = C.words,
                n = x.words,
                q = y.words,
                p = z.words,
                w = A.words,
                t,
                g,
                h,
                j,
                r,
                u,
                k,
                l,
                m,
                s;
            u = t = c[0];
            k = g = c[1];
            l = h = c[2];
            m = j = c[3];
            s = r = c[4];
            for (var a,
                b = 0; 80 > b; b += 1)
              a = t + e[v + n[b]] | 0, a = 16 > b ? a + ((g ^ h ^ j) + f[0]) : 32 > b ? a + ((g & h | ~g & j) + f[1]) : 48 > b ? a + (((g | ~h) ^ j) + f[2]) : 64 > b ? a + ((g & j | h & ~j) + f[3]) : a + ((g ^ (h | ~j)) + f[4]), a |= 0, a = a << p[b] | a >>> 32 - p[b], a = a + r | 0, t = r, r = j, j = h << 10 | h >>> 22, h = g, g = a, a = u + e[v + q[b]] | 0, a = 16 > b ? a + ((k ^ (l | ~m)) + d[0]) : 32 > b ? a + ((k & m | l & ~m) + d[1]) : 48 > b ? a + (((k | ~l) ^ m) + d[2]) : 64 > b ? a + ((k & l | ~k & m) + d[3]) : a + ((k ^ l ^ m) + d[4]), a |= 0, a = a << w[b] | a >>> 32 - w[b], a = a + s | 0, u = s, s = m, m = l << 10 | l >>> 22, l = k, k = a;
            a = c[1] + h + m | 0;
            c[1] = c[2] + j + s | 0;
            c[2] = c[3] + r + u | 0;
            c[3] = c[4] + t + k | 0;
            c[4] = c[0] + g + l | 0;
            c[0] = a;
          },
          _doFinalize: function() {
            var e = this._data,
                d = e.words,
                b = 8 * this._nDataBytes,
                c = 8 * e.sigBytes;
            d[c >>> 5] |= 128 << 24 - c % 32;
            d[(c + 64 >>> 9 << 4) + 14] = (b << 8 | b >>> 24) & 16711935 | (b << 24 | b >>> 8) & 4278255360;
            e.sigBytes = 4 * (d.length + 1);
            this._process();
            e = this._hash;
            d = e.words;
            for (b = 0; 5 > b; b++)
              c = d[b], d[b] = (c << 8 | c >>> 24) & 16711935 | (c << 24 | c >>> 8) & 4278255360;
            return e;
          },
          clone: function() {
            var d = p.clone.call(this);
            d._hash = this._hash.clone();
            return d;
          }
        });
    q.RIPEMD160 = p._createHelper(d);
    q.HmacRIPEMD160 = p._createHmacHelper(d);
  })(Math);
  (function() {
    var b = CryptoJS,
        a = b.lib,
        d = a.Base,
        m = a.WordArray,
        a = b.algo,
        q = a.HMAC,
        l = a.PBKDF2 = d.extend({
          cfg: d.extend({
            keySize: 4,
            hasher: a.SHA1,
            iterations: 1
          }),
          init: function(a) {
            this.cfg = this.cfg.extend(a);
          },
          compute: function(a, b) {
            for (var c = this.cfg,
                f = q.create(c.hasher, a),
                g = m.create(),
                d = m.create([1]),
                l = g.words,
                r = d.words,
                n = c.keySize,
                c = c.iterations; l.length < n; ) {
              var h = f.update(b).finalize(d);
              f.reset();
              for (var j = h.words,
                  s = j.length,
                  k = h,
                  p = 1; p < c; p++) {
                k = f.finalize(k);
                f.reset();
                for (var t = k.words,
                    e = 0; e < s; e++)
                  j[e] ^= t[e];
              }
              g.concat(h);
              r[0]++;
            }
            g.sigBytes = 4 * n;
            return g;
          }
        });
    b.PBKDF2 = function(a, b, c) {
      return l.create(c).compute(a, b);
    };
  })();
  var b64map = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var b64pad = "=";
  function hex2b64(d) {
    var b;
    var e;
    var a = "";
    for (b = 0; b + 3 <= d.length; b += 3) {
      e = parseInt(d.substring(b, b + 3), 16);
      a += b64map.charAt(e >> 6) + b64map.charAt(e & 63);
    }
    if (b + 1 == d.length) {
      e = parseInt(d.substring(b, b + 1), 16);
      a += b64map.charAt(e << 2);
    } else {
      if (b + 2 == d.length) {
        e = parseInt(d.substring(b, b + 2), 16);
        a += b64map.charAt(e >> 2) + b64map.charAt((e & 3) << 4);
      }
    }
    if (b64pad) {
      while ((a.length & 3) > 0) {
        a += b64pad;
      }
    }
    return a;
  }
  function b64tohex(f) {
    var d = "";
    var e;
    var b = 0;
    var c;
    var a;
    for (e = 0; e < f.length; ++e) {
      if (f.charAt(e) == b64pad) {
        break;
      }
      a = b64map.indexOf(f.charAt(e));
      if (a < 0) {
        continue;
      }
      if (b == 0) {
        d += int2char(a >> 2);
        c = a & 3;
        b = 1;
      } else {
        if (b == 1) {
          d += int2char((c << 2) | (a >> 4));
          c = a & 15;
          b = 2;
        } else {
          if (b == 2) {
            d += int2char(c);
            d += int2char(a >> 2);
            c = a & 3;
            b = 3;
          } else {
            d += int2char((c << 2) | (a >> 4));
            d += int2char(a & 15);
            b = 0;
          }
        }
      }
    }
    if (b == 1) {
      d += int2char(c << 2);
    }
    return d;
  }
  function b64toBA(e) {
    var d = b64tohex(e);
    var c;
    var b = new Array();
    for (c = 0; 2 * c < d.length; ++c) {
      b[c] = parseInt(d.substring(2 * c, 2 * c + 2), 16);
    }
    return b;
  }
  ;
  var dbits;
  var canary = 244837814094590;
  var j_lm = ((canary & 16777215) == 15715070);
  function BigInteger(e, d, f) {
    if (e != null) {
      if ("number" == typeof e) {
        this.fromNumber(e, d, f);
      } else {
        if (d == null && "string" != typeof e) {
          this.fromString(e, 256);
        } else {
          this.fromString(e, d);
        }
      }
    }
  }
  function nbi() {
    return new BigInteger(null);
  }
  function am1(f, a, b, e, h, g) {
    while (--g >= 0) {
      var d = a * this[f++] + b[e] + h;
      h = Math.floor(d / 67108864);
      b[e++] = d & 67108863;
    }
    return h;
  }
  function am2(f, q, r, e, o, a) {
    var k = q & 32767,
        p = q >> 15;
    while (--a >= 0) {
      var d = this[f] & 32767;
      var g = this[f++] >> 15;
      var b = p * d + g * k;
      d = k * d + ((b & 32767) << 15) + r[e] + (o & 1073741823);
      o = (d >>> 30) + (b >>> 15) + p * g + (o >>> 30);
      r[e++] = d & 1073741823;
    }
    return o;
  }
  function am3(f, q, r, e, o, a) {
    var k = q & 16383,
        p = q >> 14;
    while (--a >= 0) {
      var d = this[f] & 16383;
      var g = this[f++] >> 14;
      var b = p * d + g * k;
      d = k * d + ((b & 16383) << 14) + r[e] + o;
      o = (d >> 28) + (b >> 14) + p * g;
      r[e++] = d & 268435455;
    }
    return o;
  }
  if (j_lm && (navigator.appName == "Microsoft Internet Explorer")) {
    BigInteger.prototype.am = am2;
    dbits = 30;
  } else {
    if (j_lm && (navigator.appName != "Netscape")) {
      BigInteger.prototype.am = am1;
      dbits = 26;
    } else {
      BigInteger.prototype.am = am3;
      dbits = 28;
    }
  }
  BigInteger.prototype.DB = dbits;
  BigInteger.prototype.DM = ((1 << dbits) - 1);
  BigInteger.prototype.DV = (1 << dbits);
  var BI_FP = 52;
  BigInteger.prototype.FV = Math.pow(2, BI_FP);
  BigInteger.prototype.F1 = BI_FP - dbits;
  BigInteger.prototype.F2 = 2 * dbits - BI_FP;
  var BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
  var BI_RC = new Array();
  var rr,
      vv;
  rr = "0".charCodeAt(0);
  for (vv = 0; vv <= 9; ++vv) {
    BI_RC[rr++] = vv;
  }
  rr = "a".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) {
    BI_RC[rr++] = vv;
  }
  rr = "A".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) {
    BI_RC[rr++] = vv;
  }
  function int2char(a) {
    return BI_RM.charAt(a);
  }
  function intAt(b, a) {
    var d = BI_RC[b.charCodeAt(a)];
    return (d == null) ? -1 : d;
  }
  function bnpCopyTo(b) {
    for (var a = this.t - 1; a >= 0; --a) {
      b[a] = this[a];
    }
    b.t = this.t;
    b.s = this.s;
  }
  function bnpFromInt(a) {
    this.t = 1;
    this.s = (a < 0) ? -1 : 0;
    if (a > 0) {
      this[0] = a;
    } else {
      if (a < -1) {
        this[0] = a + this.DV;
      } else {
        this.t = 0;
      }
    }
  }
  function nbv(a) {
    var b = nbi();
    b.fromInt(a);
    return b;
  }
  function bnpFromString(h, c) {
    var e;
    if (c == 16) {
      e = 4;
    } else {
      if (c == 8) {
        e = 3;
      } else {
        if (c == 256) {
          e = 8;
        } else {
          if (c == 2) {
            e = 1;
          } else {
            if (c == 32) {
              e = 5;
            } else {
              if (c == 4) {
                e = 2;
              } else {
                this.fromRadix(h, c);
                return;
              }
            }
          }
        }
      }
    }
    this.t = 0;
    this.s = 0;
    var g = h.length,
        d = false,
        f = 0;
    while (--g >= 0) {
      var a = (e == 8) ? h[g] & 255 : intAt(h, g);
      if (a < 0) {
        if (h.charAt(g) == "-") {
          d = true;
        }
        continue;
      }
      d = false;
      if (f == 0) {
        this[this.t++] = a;
      } else {
        if (f + e > this.DB) {
          this[this.t - 1] |= (a & ((1 << (this.DB - f)) - 1)) << f;
          this[this.t++] = (a >> (this.DB - f));
        } else {
          this[this.t - 1] |= a << f;
        }
      }
      f += e;
      if (f >= this.DB) {
        f -= this.DB;
      }
    }
    if (e == 8 && (h[0] & 128) != 0) {
      this.s = -1;
      if (f > 0) {
        this[this.t - 1] |= ((1 << (this.DB - f)) - 1) << f;
      }
    }
    this.clamp();
    if (d) {
      BigInteger.ZERO.subTo(this, this);
    }
  }
  function bnpClamp() {
    var a = this.s & this.DM;
    while (this.t > 0 && this[this.t - 1] == a) {
      --this.t;
    }
  }
  function bnToString(c) {
    if (this.s < 0) {
      return "-" + this.negate().toString(c);
    }
    var e;
    if (c == 16) {
      e = 4;
    } else {
      if (c == 8) {
        e = 3;
      } else {
        if (c == 2) {
          e = 1;
        } else {
          if (c == 32) {
            e = 5;
          } else {
            if (c == 4) {
              e = 2;
            } else {
              return this.toRadix(c);
            }
          }
        }
      }
    }
    var g = (1 << e) - 1,
        l,
        a = false,
        h = "",
        f = this.t;
    var j = this.DB - (f * this.DB) % e;
    if (f-- > 0) {
      if (j < this.DB && (l = this[f] >> j) > 0) {
        a = true;
        h = int2char(l);
      }
      while (f >= 0) {
        if (j < e) {
          l = (this[f] & ((1 << j) - 1)) << (e - j);
          l |= this[--f] >> (j += this.DB - e);
        } else {
          l = (this[f] >> (j -= e)) & g;
          if (j <= 0) {
            j += this.DB;
            --f;
          }
        }
        if (l > 0) {
          a = true;
        }
        if (a) {
          h += int2char(l);
        }
      }
    }
    return a ? h : "0";
  }
  function bnNegate() {
    var a = nbi();
    BigInteger.ZERO.subTo(this, a);
    return a;
  }
  function bnAbs() {
    return (this.s < 0) ? this.negate() : this;
  }
  function bnCompareTo(b) {
    var d = this.s - b.s;
    if (d != 0) {
      return d;
    }
    var c = this.t;
    d = c - b.t;
    if (d != 0) {
      return (this.s < 0) ? -d : d;
    }
    while (--c >= 0) {
      if ((d = this[c] - b[c]) != 0) {
        return d;
      }
    }
    return 0;
  }
  function nbits(a) {
    var c = 1,
        b;
    if ((b = a >>> 16) != 0) {
      a = b;
      c += 16;
    }
    if ((b = a >> 8) != 0) {
      a = b;
      c += 8;
    }
    if ((b = a >> 4) != 0) {
      a = b;
      c += 4;
    }
    if ((b = a >> 2) != 0) {
      a = b;
      c += 2;
    }
    if ((b = a >> 1) != 0) {
      a = b;
      c += 1;
    }
    return c;
  }
  function bnBitLength() {
    if (this.t <= 0) {
      return 0;
    }
    return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ (this.s & this.DM));
  }
  function bnpDLShiftTo(c, b) {
    var a;
    for (a = this.t - 1; a >= 0; --a) {
      b[a + c] = this[a];
    }
    for (a = c - 1; a >= 0; --a) {
      b[a] = 0;
    }
    b.t = this.t + c;
    b.s = this.s;
  }
  function bnpDRShiftTo(c, b) {
    for (var a = c; a < this.t; ++a) {
      b[a - c] = this[a];
    }
    b.t = Math.max(this.t - c, 0);
    b.s = this.s;
  }
  function bnpLShiftTo(j, e) {
    var b = j % this.DB;
    var a = this.DB - b;
    var g = (1 << a) - 1;
    var f = Math.floor(j / this.DB),
        h = (this.s << b) & this.DM,
        d;
    for (d = this.t - 1; d >= 0; --d) {
      e[d + f + 1] = (this[d] >> a) | h;
      h = (this[d] & g) << b;
    }
    for (d = f - 1; d >= 0; --d) {
      e[d] = 0;
    }
    e[f] = h;
    e.t = this.t + f + 1;
    e.s = this.s;
    e.clamp();
  }
  function bnpRShiftTo(g, d) {
    d.s = this.s;
    var e = Math.floor(g / this.DB);
    if (e >= this.t) {
      d.t = 0;
      return;
    }
    var b = g % this.DB;
    var a = this.DB - b;
    var f = (1 << b) - 1;
    d[0] = this[e] >> b;
    for (var c = e + 1; c < this.t; ++c) {
      d[c - e - 1] |= (this[c] & f) << a;
      d[c - e] = this[c] >> b;
    }
    if (b > 0) {
      d[this.t - e - 1] |= (this.s & f) << a;
    }
    d.t = this.t - e;
    d.clamp();
  }
  function bnpSubTo(d, f) {
    var e = 0,
        g = 0,
        b = Math.min(d.t, this.t);
    while (e < b) {
      g += this[e] - d[e];
      f[e++] = g & this.DM;
      g >>= this.DB;
    }
    if (d.t < this.t) {
      g -= d.s;
      while (e < this.t) {
        g += this[e];
        f[e++] = g & this.DM;
        g >>= this.DB;
      }
      g += this.s;
    } else {
      g += this.s;
      while (e < d.t) {
        g -= d[e];
        f[e++] = g & this.DM;
        g >>= this.DB;
      }
      g -= d.s;
    }
    f.s = (g < 0) ? -1 : 0;
    if (g < -1) {
      f[e++] = this.DV + g;
    } else {
      if (g > 0) {
        f[e++] = g;
      }
    }
    f.t = e;
    f.clamp();
  }
  function bnpMultiplyTo(c, e) {
    var b = this.abs(),
        f = c.abs();
    var d = b.t;
    e.t = d + f.t;
    while (--d >= 0) {
      e[d] = 0;
    }
    for (d = 0; d < f.t; ++d) {
      e[d + b.t] = b.am(0, f[d], e, d, 0, b.t);
    }
    e.s = 0;
    e.clamp();
    if (this.s != c.s) {
      BigInteger.ZERO.subTo(e, e);
    }
  }
  function bnpSquareTo(d) {
    var a = this.abs();
    var b = d.t = 2 * a.t;
    while (--b >= 0) {
      d[b] = 0;
    }
    for (b = 0; b < a.t - 1; ++b) {
      var e = a.am(b, a[b], d, 2 * b, 0, 1);
      if ((d[b + a.t] += a.am(b + 1, 2 * a[b], d, 2 * b + 1, e, a.t - b - 1)) >= a.DV) {
        d[b + a.t] -= a.DV;
        d[b + a.t + 1] = 1;
      }
    }
    if (d.t > 0) {
      d[d.t - 1] += a.am(b, a[b], d, 2 * b, 0, 1);
    }
    d.s = 0;
    d.clamp();
  }
  function bnpDivRemTo(n, h, g) {
    var w = n.abs();
    if (w.t <= 0) {
      return;
    }
    var k = this.abs();
    if (k.t < w.t) {
      if (h != null) {
        h.fromInt(0);
      }
      if (g != null) {
        this.copyTo(g);
      }
      return;
    }
    if (g == null) {
      g = nbi();
    }
    var d = nbi(),
        a = this.s,
        l = n.s;
    var v = this.DB - nbits(w[w.t - 1]);
    if (v > 0) {
      w.lShiftTo(v, d);
      k.lShiftTo(v, g);
    } else {
      w.copyTo(d);
      k.copyTo(g);
    }
    var p = d.t;
    var b = d[p - 1];
    if (b == 0) {
      return;
    }
    var o = b * (1 << this.F1) + ((p > 1) ? d[p - 2] >> this.F2 : 0);
    var A = this.FV / o,
        z = (1 << this.F1) / o,
        x = 1 << this.F2;
    var u = g.t,
        s = u - p,
        f = (h == null) ? nbi() : h;
    d.dlShiftTo(s, f);
    if (g.compareTo(f) >= 0) {
      g[g.t++] = 1;
      g.subTo(f, g);
    }
    BigInteger.ONE.dlShiftTo(p, f);
    f.subTo(d, d);
    while (d.t < p) {
      d[d.t++] = 0;
    }
    while (--s >= 0) {
      var c = (g[--u] == b) ? this.DM : Math.floor(g[u] * A + (g[u - 1] + x) * z);
      if ((g[u] += d.am(0, c, g, s, 0, p)) < c) {
        d.dlShiftTo(s, f);
        g.subTo(f, g);
        while (g[u] < --c) {
          g.subTo(f, g);
        }
      }
    }
    if (h != null) {
      g.drShiftTo(p, h);
      if (a != l) {
        BigInteger.ZERO.subTo(h, h);
      }
    }
    g.t = p;
    g.clamp();
    if (v > 0) {
      g.rShiftTo(v, g);
    }
    if (a < 0) {
      BigInteger.ZERO.subTo(g, g);
    }
  }
  function bnMod(b) {
    var c = nbi();
    this.abs().divRemTo(b, null, c);
    if (this.s < 0 && c.compareTo(BigInteger.ZERO) > 0) {
      b.subTo(c, c);
    }
    return c;
  }
  function Classic(a) {
    this.m = a;
  }
  function cConvert(a) {
    if (a.s < 0 || a.compareTo(this.m) >= 0) {
      return a.mod(this.m);
    } else {
      return a;
    }
  }
  function cRevert(a) {
    return a;
  }
  function cReduce(a) {
    a.divRemTo(this.m, null, a);
  }
  function cMulTo(a, c, b) {
    a.multiplyTo(c, b);
    this.reduce(b);
  }
  function cSqrTo(a, b) {
    a.squareTo(b);
    this.reduce(b);
  }
  Classic.prototype.convert = cConvert;
  Classic.prototype.revert = cRevert;
  Classic.prototype.reduce = cReduce;
  Classic.prototype.mulTo = cMulTo;
  Classic.prototype.sqrTo = cSqrTo;
  function bnpInvDigit() {
    if (this.t < 1) {
      return 0;
    }
    var a = this[0];
    if ((a & 1) == 0) {
      return 0;
    }
    var b = a & 3;
    b = (b * (2 - (a & 15) * b)) & 15;
    b = (b * (2 - (a & 255) * b)) & 255;
    b = (b * (2 - (((a & 65535) * b) & 65535))) & 65535;
    b = (b * (2 - a * b % this.DV)) % this.DV;
    return (b > 0) ? this.DV - b : -b;
  }
  function Montgomery(a) {
    this.m = a;
    this.mp = a.invDigit();
    this.mpl = this.mp & 32767;
    this.mph = this.mp >> 15;
    this.um = (1 << (a.DB - 15)) - 1;
    this.mt2 = 2 * a.t;
  }
  function montConvert(a) {
    var b = nbi();
    a.abs().dlShiftTo(this.m.t, b);
    b.divRemTo(this.m, null, b);
    if (a.s < 0 && b.compareTo(BigInteger.ZERO) > 0) {
      this.m.subTo(b, b);
    }
    return b;
  }
  function montRevert(a) {
    var b = nbi();
    a.copyTo(b);
    this.reduce(b);
    return b;
  }
  function montReduce(a) {
    while (a.t <= this.mt2) {
      a[a.t++] = 0;
    }
    for (var c = 0; c < this.m.t; ++c) {
      var b = a[c] & 32767;
      var d = (b * this.mpl + (((b * this.mph + (a[c] >> 15) * this.mpl) & this.um) << 15)) & a.DM;
      b = c + this.m.t;
      a[b] += this.m.am(0, d, a, c, 0, this.m.t);
      while (a[b] >= a.DV) {
        a[b] -= a.DV;
        a[++b]++;
      }
    }
    a.clamp();
    a.drShiftTo(this.m.t, a);
    if (a.compareTo(this.m) >= 0) {
      a.subTo(this.m, a);
    }
  }
  function montSqrTo(a, b) {
    a.squareTo(b);
    this.reduce(b);
  }
  function montMulTo(a, c, b) {
    a.multiplyTo(c, b);
    this.reduce(b);
  }
  Montgomery.prototype.convert = montConvert;
  Montgomery.prototype.revert = montRevert;
  Montgomery.prototype.reduce = montReduce;
  Montgomery.prototype.mulTo = montMulTo;
  Montgomery.prototype.sqrTo = montSqrTo;
  function bnpIsEven() {
    return ((this.t > 0) ? (this[0] & 1) : this.s) == 0;
  }
  function bnpExp(h, j) {
    if (h > 4294967295 || h < 1) {
      return BigInteger.ONE;
    }
    var f = nbi(),
        a = nbi(),
        d = j.convert(this),
        c = nbits(h) - 1;
    d.copyTo(f);
    while (--c >= 0) {
      j.sqrTo(f, a);
      if ((h & (1 << c)) > 0) {
        j.mulTo(a, d, f);
      } else {
        var b = f;
        f = a;
        a = b;
      }
    }
    return j.revert(f);
  }
  function bnModPowInt(b, a) {
    var c;
    if (b < 256 || a.isEven()) {
      c = new Classic(a);
    } else {
      c = new Montgomery(a);
    }
    return this.exp(b, c);
  }
  BigInteger.prototype.copyTo = bnpCopyTo;
  BigInteger.prototype.fromInt = bnpFromInt;
  BigInteger.prototype.fromString = bnpFromString;
  BigInteger.prototype.clamp = bnpClamp;
  BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
  BigInteger.prototype.drShiftTo = bnpDRShiftTo;
  BigInteger.prototype.lShiftTo = bnpLShiftTo;
  BigInteger.prototype.rShiftTo = bnpRShiftTo;
  BigInteger.prototype.subTo = bnpSubTo;
  BigInteger.prototype.multiplyTo = bnpMultiplyTo;
  BigInteger.prototype.squareTo = bnpSquareTo;
  BigInteger.prototype.divRemTo = bnpDivRemTo;
  BigInteger.prototype.invDigit = bnpInvDigit;
  BigInteger.prototype.isEven = bnpIsEven;
  BigInteger.prototype.exp = bnpExp;
  BigInteger.prototype.toString = bnToString;
  BigInteger.prototype.negate = bnNegate;
  BigInteger.prototype.abs = bnAbs;
  BigInteger.prototype.compareTo = bnCompareTo;
  BigInteger.prototype.bitLength = bnBitLength;
  BigInteger.prototype.mod = bnMod;
  BigInteger.prototype.modPowInt = bnModPowInt;
  BigInteger.ZERO = nbv(0);
  BigInteger.ONE = nbv(1);
  function bnClone() {
    var a = nbi();
    this.copyTo(a);
    return a;
  }
  function bnIntValue() {
    if (this.s < 0) {
      if (this.t == 1) {
        return this[0] - this.DV;
      } else {
        if (this.t == 0) {
          return -1;
        }
      }
    } else {
      if (this.t == 1) {
        return this[0];
      } else {
        if (this.t == 0) {
          return 0;
        }
      }
    }
    return ((this[1] & ((1 << (32 - this.DB)) - 1)) << this.DB) | this[0];
  }
  function bnByteValue() {
    return (this.t == 0) ? this.s : (this[0] << 24) >> 24;
  }
  function bnShortValue() {
    return (this.t == 0) ? this.s : (this[0] << 16) >> 16;
  }
  function bnpChunkSize(a) {
    return Math.floor(Math.LN2 * this.DB / Math.log(a));
  }
  function bnSigNum() {
    if (this.s < 0) {
      return -1;
    } else {
      if (this.t <= 0 || (this.t == 1 && this[0] <= 0)) {
        return 0;
      } else {
        return 1;
      }
    }
  }
  function bnpToRadix(c) {
    if (c == null) {
      c = 10;
    }
    if (this.signum() == 0 || c < 2 || c > 36) {
      return "0";
    }
    var f = this.chunkSize(c);
    var e = Math.pow(c, f);
    var i = nbv(e),
        j = nbi(),
        h = nbi(),
        g = "";
    this.divRemTo(i, j, h);
    while (j.signum() > 0) {
      g = (e + h.intValue()).toString(c).substr(1) + g;
      j.divRemTo(i, j, h);
    }
    return h.intValue().toString(c) + g;
  }
  function bnpFromRadix(m, h) {
    this.fromInt(0);
    if (h == null) {
      h = 10;
    }
    var f = this.chunkSize(h);
    var g = Math.pow(h, f),
        e = false,
        a = 0,
        l = 0;
    for (var c = 0; c < m.length; ++c) {
      var k = intAt(m, c);
      if (k < 0) {
        if (m.charAt(c) == "-" && this.signum() == 0) {
          e = true;
        }
        continue;
      }
      l = h * l + k;
      if (++a >= f) {
        this.dMultiply(g);
        this.dAddOffset(l, 0);
        a = 0;
        l = 0;
      }
    }
    if (a > 0) {
      this.dMultiply(Math.pow(h, a));
      this.dAddOffset(l, 0);
    }
    if (e) {
      BigInteger.ZERO.subTo(this, this);
    }
  }
  function bnpFromNumber(f, e, h) {
    if ("number" == typeof e) {
      if (f < 2) {
        this.fromInt(1);
      } else {
        this.fromNumber(f, h);
        if (!this.testBit(f - 1)) {
          this.bitwiseTo(BigInteger.ONE.shiftLeft(f - 1), op_or, this);
        }
        if (this.isEven()) {
          this.dAddOffset(1, 0);
        }
        while (!this.isProbablePrime(e)) {
          this.dAddOffset(2, 0);
          if (this.bitLength() > f) {
            this.subTo(BigInteger.ONE.shiftLeft(f - 1), this);
          }
        }
      }
    } else {
      var d = new Array(),
          g = f & 7;
      d.length = (f >> 3) + 1;
      e.nextBytes(d);
      if (g > 0) {
        d[0] &= ((1 << g) - 1);
      } else {
        d[0] = 0;
      }
      this.fromString(d, 256);
    }
  }
  function bnToByteArray() {
    var b = this.t,
        c = new Array();
    c[0] = this.s;
    var e = this.DB - (b * this.DB) % 8,
        f,
        a = 0;
    if (b-- > 0) {
      if (e < this.DB && (f = this[b] >> e) != (this.s & this.DM) >> e) {
        c[a++] = f | (this.s << (this.DB - e));
      }
      while (b >= 0) {
        if (e < 8) {
          f = (this[b] & ((1 << e) - 1)) << (8 - e);
          f |= this[--b] >> (e += this.DB - 8);
        } else {
          f = (this[b] >> (e -= 8)) & 255;
          if (e <= 0) {
            e += this.DB;
            --b;
          }
        }
        if ((f & 128) != 0) {
          f |= -256;
        }
        if (a == 0 && (this.s & 128) != (f & 128)) {
          ++a;
        }
        if (a > 0 || f != this.s) {
          c[a++] = f;
        }
      }
    }
    return c;
  }
  function bnEquals(b) {
    return (this.compareTo(b) == 0);
  }
  function bnMin(b) {
    return (this.compareTo(b) < 0) ? this : b;
  }
  function bnMax(b) {
    return (this.compareTo(b) > 0) ? this : b;
  }
  function bnpBitwiseTo(c, h, e) {
    var d,
        g,
        b = Math.min(c.t, this.t);
    for (d = 0; d < b; ++d) {
      e[d] = h(this[d], c[d]);
    }
    if (c.t < this.t) {
      g = c.s & this.DM;
      for (d = b; d < this.t; ++d) {
        e[d] = h(this[d], g);
      }
      e.t = this.t;
    } else {
      g = this.s & this.DM;
      for (d = b; d < c.t; ++d) {
        e[d] = h(g, c[d]);
      }
      e.t = c.t;
    }
    e.s = h(this.s, c.s);
    e.clamp();
  }
  function op_and(a, b) {
    return a & b;
  }
  function bnAnd(b) {
    var c = nbi();
    this.bitwiseTo(b, op_and, c);
    return c;
  }
  function op_or(a, b) {
    return a | b;
  }
  function bnOr(b) {
    var c = nbi();
    this.bitwiseTo(b, op_or, c);
    return c;
  }
  function op_xor(a, b) {
    return a ^ b;
  }
  function bnXor(b) {
    var c = nbi();
    this.bitwiseTo(b, op_xor, c);
    return c;
  }
  function op_andnot(a, b) {
    return a & ~b;
  }
  function bnAndNot(b) {
    var c = nbi();
    this.bitwiseTo(b, op_andnot, c);
    return c;
  }
  function bnNot() {
    var b = nbi();
    for (var a = 0; a < this.t; ++a) {
      b[a] = this.DM & ~this[a];
    }
    b.t = this.t;
    b.s = ~this.s;
    return b;
  }
  function bnShiftLeft(b) {
    var a = nbi();
    if (b < 0) {
      this.rShiftTo(-b, a);
    } else {
      this.lShiftTo(b, a);
    }
    return a;
  }
  function bnShiftRight(b) {
    var a = nbi();
    if (b < 0) {
      this.lShiftTo(-b, a);
    } else {
      this.rShiftTo(b, a);
    }
    return a;
  }
  function lbit(a) {
    if (a == 0) {
      return -1;
    }
    var b = 0;
    if ((a & 65535) == 0) {
      a >>= 16;
      b += 16;
    }
    if ((a & 255) == 0) {
      a >>= 8;
      b += 8;
    }
    if ((a & 15) == 0) {
      a >>= 4;
      b += 4;
    }
    if ((a & 3) == 0) {
      a >>= 2;
      b += 2;
    }
    if ((a & 1) == 0) {
      ++b;
    }
    return b;
  }
  function bnGetLowestSetBit() {
    for (var a = 0; a < this.t; ++a) {
      if (this[a] != 0) {
        return a * this.DB + lbit(this[a]);
      }
    }
    if (this.s < 0) {
      return this.t * this.DB;
    }
    return -1;
  }
  function cbit(a) {
    var b = 0;
    while (a != 0) {
      a &= a - 1;
      ++b;
    }
    return b;
  }
  function bnBitCount() {
    var c = 0,
        a = this.s & this.DM;
    for (var b = 0; b < this.t; ++b) {
      c += cbit(this[b] ^ a);
    }
    return c;
  }
  function bnTestBit(b) {
    var a = Math.floor(b / this.DB);
    if (a >= this.t) {
      return (this.s != 0);
    }
    return ((this[a] & (1 << (b % this.DB))) != 0);
  }
  function bnpChangeBit(c, b) {
    var a = BigInteger.ONE.shiftLeft(c);
    this.bitwiseTo(a, b, a);
    return a;
  }
  function bnSetBit(a) {
    return this.changeBit(a, op_or);
  }
  function bnClearBit(a) {
    return this.changeBit(a, op_andnot);
  }
  function bnFlipBit(a) {
    return this.changeBit(a, op_xor);
  }
  function bnpAddTo(d, f) {
    var e = 0,
        g = 0,
        b = Math.min(d.t, this.t);
    while (e < b) {
      g += this[e] + d[e];
      f[e++] = g & this.DM;
      g >>= this.DB;
    }
    if (d.t < this.t) {
      g += d.s;
      while (e < this.t) {
        g += this[e];
        f[e++] = g & this.DM;
        g >>= this.DB;
      }
      g += this.s;
    } else {
      g += this.s;
      while (e < d.t) {
        g += d[e];
        f[e++] = g & this.DM;
        g >>= this.DB;
      }
      g += d.s;
    }
    f.s = (g < 0) ? -1 : 0;
    if (g > 0) {
      f[e++] = g;
    } else {
      if (g < -1) {
        f[e++] = this.DV + g;
      }
    }
    f.t = e;
    f.clamp();
  }
  function bnAdd(b) {
    var c = nbi();
    this.addTo(b, c);
    return c;
  }
  function bnSubtract(b) {
    var c = nbi();
    this.subTo(b, c);
    return c;
  }
  function bnMultiply(b) {
    var c = nbi();
    this.multiplyTo(b, c);
    return c;
  }
  function bnSquare() {
    var a = nbi();
    this.squareTo(a);
    return a;
  }
  function bnDivide(b) {
    var c = nbi();
    this.divRemTo(b, c, null);
    return c;
  }
  function bnRemainder(b) {
    var c = nbi();
    this.divRemTo(b, null, c);
    return c;
  }
  function bnDivideAndRemainder(b) {
    var d = nbi(),
        c = nbi();
    this.divRemTo(b, d, c);
    return new Array(d, c);
  }
  function bnpDMultiply(a) {
    this[this.t] = this.am(0, a - 1, this, 0, 0, this.t);
    ++this.t;
    this.clamp();
  }
  function bnpDAddOffset(b, a) {
    if (b == 0) {
      return;
    }
    while (this.t <= a) {
      this[this.t++] = 0;
    }
    this[a] += b;
    while (this[a] >= this.DV) {
      this[a] -= this.DV;
      if (++a >= this.t) {
        this[this.t++] = 0;
      }
      ++this[a];
    }
  }
  function NullExp() {}
  function nNop(a) {
    return a;
  }
  function nMulTo(a, c, b) {
    a.multiplyTo(c, b);
  }
  function nSqrTo(a, b) {
    a.squareTo(b);
  }
  NullExp.prototype.convert = nNop;
  NullExp.prototype.revert = nNop;
  NullExp.prototype.mulTo = nMulTo;
  NullExp.prototype.sqrTo = nSqrTo;
  function bnPow(a) {
    return this.exp(a, new NullExp());
  }
  function bnpMultiplyLowerTo(b, f, e) {
    var d = Math.min(this.t + b.t, f);
    e.s = 0;
    e.t = d;
    while (d > 0) {
      e[--d] = 0;
    }
    var c;
    for (c = e.t - this.t; d < c; ++d) {
      e[d + this.t] = this.am(0, b[d], e, d, 0, this.t);
    }
    for (c = Math.min(b.t, f); d < c; ++d) {
      this.am(0, b[d], e, d, 0, f - d);
    }
    e.clamp();
  }
  function bnpMultiplyUpperTo(b, e, d) {
    --e;
    var c = d.t = this.t + b.t - e;
    d.s = 0;
    while (--c >= 0) {
      d[c] = 0;
    }
    for (c = Math.max(e - this.t, 0); c < b.t; ++c) {
      d[this.t + c - e] = this.am(e - c, b[c], d, 0, 0, this.t + c - e);
    }
    d.clamp();
    d.drShiftTo(1, d);
  }
  function Barrett(a) {
    this.r2 = nbi();
    this.q3 = nbi();
    BigInteger.ONE.dlShiftTo(2 * a.t, this.r2);
    this.mu = this.r2.divide(a);
    this.m = a;
  }
  function barrettConvert(a) {
    if (a.s < 0 || a.t > 2 * this.m.t) {
      return a.mod(this.m);
    } else {
      if (a.compareTo(this.m) < 0) {
        return a;
      } else {
        var b = nbi();
        a.copyTo(b);
        this.reduce(b);
        return b;
      }
    }
  }
  function barrettRevert(a) {
    return a;
  }
  function barrettReduce(a) {
    a.drShiftTo(this.m.t - 1, this.r2);
    if (a.t > this.m.t + 1) {
      a.t = this.m.t + 1;
      a.clamp();
    }
    this.mu.multiplyUpperTo(this.r2, this.m.t + 1, this.q3);
    this.m.multiplyLowerTo(this.q3, this.m.t + 1, this.r2);
    while (a.compareTo(this.r2) < 0) {
      a.dAddOffset(1, this.m.t + 1);
    }
    a.subTo(this.r2, a);
    while (a.compareTo(this.m) >= 0) {
      a.subTo(this.m, a);
    }
  }
  function barrettSqrTo(a, b) {
    a.squareTo(b);
    this.reduce(b);
  }
  function barrettMulTo(a, c, b) {
    a.multiplyTo(c, b);
    this.reduce(b);
  }
  Barrett.prototype.convert = barrettConvert;
  Barrett.prototype.revert = barrettRevert;
  Barrett.prototype.reduce = barrettReduce;
  Barrett.prototype.mulTo = barrettMulTo;
  Barrett.prototype.sqrTo = barrettSqrTo;
  function bnModPow(q, f) {
    var o = q.bitLength(),
        h,
        b = nbv(1),
        v;
    if (o <= 0) {
      return b;
    } else {
      if (o < 18) {
        h = 1;
      } else {
        if (o < 48) {
          h = 3;
        } else {
          if (o < 144) {
            h = 4;
          } else {
            if (o < 768) {
              h = 5;
            } else {
              h = 6;
            }
          }
        }
      }
    }
    if (o < 8) {
      v = new Classic(f);
    } else {
      if (f.isEven()) {
        v = new Barrett(f);
      } else {
        v = new Montgomery(f);
      }
    }
    var p = new Array(),
        d = 3,
        s = h - 1,
        a = (1 << h) - 1;
    p[1] = v.convert(this);
    if (h > 1) {
      var A = nbi();
      v.sqrTo(p[1], A);
      while (d <= a) {
        p[d] = nbi();
        v.mulTo(A, p[d - 2], p[d]);
        d += 2;
      }
    }
    var l = q.t - 1,
        x,
        u = true,
        c = nbi(),
        y;
    o = nbits(q[l]) - 1;
    while (l >= 0) {
      if (o >= s) {
        x = (q[l] >> (o - s)) & a;
      } else {
        x = (q[l] & ((1 << (o + 1)) - 1)) << (s - o);
        if (l > 0) {
          x |= q[l - 1] >> (this.DB + o - s);
        }
      }
      d = h;
      while ((x & 1) == 0) {
        x >>= 1;
        --d;
      }
      if ((o -= d) < 0) {
        o += this.DB;
        --l;
      }
      if (u) {
        p[x].copyTo(b);
        u = false;
      } else {
        while (d > 1) {
          v.sqrTo(b, c);
          v.sqrTo(c, b);
          d -= 2;
        }
        if (d > 0) {
          v.sqrTo(b, c);
        } else {
          y = b;
          b = c;
          c = y;
        }
        v.mulTo(c, p[x], b);
      }
      while (l >= 0 && (q[l] & (1 << o)) == 0) {
        v.sqrTo(b, c);
        y = b;
        b = c;
        c = y;
        if (--o < 0) {
          o = this.DB - 1;
          --l;
        }
      }
    }
    return v.revert(b);
  }
  function bnGCD(c) {
    var b = (this.s < 0) ? this.negate() : this.clone();
    var h = (c.s < 0) ? c.negate() : c.clone();
    if (b.compareTo(h) < 0) {
      var e = b;
      b = h;
      h = e;
    }
    var d = b.getLowestSetBit(),
        f = h.getLowestSetBit();
    if (f < 0) {
      return b;
    }
    if (d < f) {
      f = d;
    }
    if (f > 0) {
      b.rShiftTo(f, b);
      h.rShiftTo(f, h);
    }
    while (b.signum() > 0) {
      if ((d = b.getLowestSetBit()) > 0) {
        b.rShiftTo(d, b);
      }
      if ((d = h.getLowestSetBit()) > 0) {
        h.rShiftTo(d, h);
      }
      if (b.compareTo(h) >= 0) {
        b.subTo(h, b);
        b.rShiftTo(1, b);
      } else {
        h.subTo(b, h);
        h.rShiftTo(1, h);
      }
    }
    if (f > 0) {
      h.lShiftTo(f, h);
    }
    return h;
  }
  function bnpModInt(e) {
    if (e <= 0) {
      return 0;
    }
    var c = this.DV % e,
        b = (this.s < 0) ? e - 1 : 0;
    if (this.t > 0) {
      if (c == 0) {
        b = this[0] % e;
      } else {
        for (var a = this.t - 1; a >= 0; --a) {
          b = (c * b + this[a]) % e;
        }
      }
    }
    return b;
  }
  function bnModInverse(f) {
    var j = f.isEven();
    if ((this.isEven() && j) || f.signum() == 0) {
      return BigInteger.ZERO;
    }
    var i = f.clone(),
        h = this.clone();
    var g = nbv(1),
        e = nbv(0),
        l = nbv(0),
        k = nbv(1);
    while (i.signum() != 0) {
      while (i.isEven()) {
        i.rShiftTo(1, i);
        if (j) {
          if (!g.isEven() || !e.isEven()) {
            g.addTo(this, g);
            e.subTo(f, e);
          }
          g.rShiftTo(1, g);
        } else {
          if (!e.isEven()) {
            e.subTo(f, e);
          }
        }
        e.rShiftTo(1, e);
      }
      while (h.isEven()) {
        h.rShiftTo(1, h);
        if (j) {
          if (!l.isEven() || !k.isEven()) {
            l.addTo(this, l);
            k.subTo(f, k);
          }
          l.rShiftTo(1, l);
        } else {
          if (!k.isEven()) {
            k.subTo(f, k);
          }
        }
        k.rShiftTo(1, k);
      }
      if (i.compareTo(h) >= 0) {
        i.subTo(h, i);
        if (j) {
          g.subTo(l, g);
        }
        e.subTo(k, e);
      } else {
        h.subTo(i, h);
        if (j) {
          l.subTo(g, l);
        }
        k.subTo(e, k);
      }
    }
    if (h.compareTo(BigInteger.ONE) != 0) {
      return BigInteger.ZERO;
    }
    if (k.compareTo(f) >= 0) {
      return k.subtract(f);
    }
    if (k.signum() < 0) {
      k.addTo(f, k);
    } else {
      return k;
    }
    if (k.signum() < 0) {
      return k.add(f);
    } else {
      return k;
    }
  }
  var lowprimes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509, 521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701, 709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811, 821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919, 929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997];
  var lplim = (1 << 26) / lowprimes[lowprimes.length - 1];
  function bnIsProbablePrime(e) {
    var d,
        b = this.abs();
    if (b.t == 1 && b[0] <= lowprimes[lowprimes.length - 1]) {
      for (d = 0; d < lowprimes.length; ++d) {
        if (b[0] == lowprimes[d]) {
          return true;
        }
      }
      return false;
    }
    if (b.isEven()) {
      return false;
    }
    d = 1;
    while (d < lowprimes.length) {
      var a = lowprimes[d],
          c = d + 1;
      while (c < lowprimes.length && a < lplim) {
        a *= lowprimes[c++];
      }
      a = b.modInt(a);
      while (d < c) {
        if (a % lowprimes[d++] == 0) {
          return false;
        }
      }
    }
    return b.millerRabin(e);
  }
  function bnpMillerRabin(f) {
    var g = this.subtract(BigInteger.ONE);
    var c = g.getLowestSetBit();
    if (c <= 0) {
      return false;
    }
    var h = g.shiftRight(c);
    f = (f + 1) >> 1;
    if (f > lowprimes.length) {
      f = lowprimes.length;
    }
    var b = nbi();
    for (var e = 0; e < f; ++e) {
      b.fromInt(lowprimes[Math.floor(Math.random() * lowprimes.length)]);
      var l = b.modPow(h, this);
      if (l.compareTo(BigInteger.ONE) != 0 && l.compareTo(g) != 0) {
        var d = 1;
        while (d++ < c && l.compareTo(g) != 0) {
          l = l.modPowInt(2, this);
          if (l.compareTo(BigInteger.ONE) == 0) {
            return false;
          }
        }
        if (l.compareTo(g) != 0) {
          return false;
        }
      }
    }
    return true;
  }
  BigInteger.prototype.chunkSize = bnpChunkSize;
  BigInteger.prototype.toRadix = bnpToRadix;
  BigInteger.prototype.fromRadix = bnpFromRadix;
  BigInteger.prototype.fromNumber = bnpFromNumber;
  BigInteger.prototype.bitwiseTo = bnpBitwiseTo;
  BigInteger.prototype.changeBit = bnpChangeBit;
  BigInteger.prototype.addTo = bnpAddTo;
  BigInteger.prototype.dMultiply = bnpDMultiply;
  BigInteger.prototype.dAddOffset = bnpDAddOffset;
  BigInteger.prototype.multiplyLowerTo = bnpMultiplyLowerTo;
  BigInteger.prototype.multiplyUpperTo = bnpMultiplyUpperTo;
  BigInteger.prototype.modInt = bnpModInt;
  BigInteger.prototype.millerRabin = bnpMillerRabin;
  BigInteger.prototype.clone = bnClone;
  BigInteger.prototype.intValue = bnIntValue;
  BigInteger.prototype.byteValue = bnByteValue;
  BigInteger.prototype.shortValue = bnShortValue;
  BigInteger.prototype.signum = bnSigNum;
  BigInteger.prototype.toByteArray = bnToByteArray;
  BigInteger.prototype.equals = bnEquals;
  BigInteger.prototype.min = bnMin;
  BigInteger.prototype.max = bnMax;
  BigInteger.prototype.and = bnAnd;
  BigInteger.prototype.or = bnOr;
  BigInteger.prototype.xor = bnXor;
  BigInteger.prototype.andNot = bnAndNot;
  BigInteger.prototype.not = bnNot;
  BigInteger.prototype.shiftLeft = bnShiftLeft;
  BigInteger.prototype.shiftRight = bnShiftRight;
  BigInteger.prototype.getLowestSetBit = bnGetLowestSetBit;
  BigInteger.prototype.bitCount = bnBitCount;
  BigInteger.prototype.testBit = bnTestBit;
  BigInteger.prototype.setBit = bnSetBit;
  BigInteger.prototype.clearBit = bnClearBit;
  BigInteger.prototype.flipBit = bnFlipBit;
  BigInteger.prototype.add = bnAdd;
  BigInteger.prototype.subtract = bnSubtract;
  BigInteger.prototype.multiply = bnMultiply;
  BigInteger.prototype.divide = bnDivide;
  BigInteger.prototype.remainder = bnRemainder;
  BigInteger.prototype.divideAndRemainder = bnDivideAndRemainder;
  BigInteger.prototype.modPow = bnModPow;
  BigInteger.prototype.modInverse = bnModInverse;
  BigInteger.prototype.pow = bnPow;
  BigInteger.prototype.gcd = bnGCD;
  BigInteger.prototype.isProbablePrime = bnIsProbablePrime;
  BigInteger.prototype.square = bnSquare;
  function Arcfour() {
    this.i = 0;
    this.j = 0;
    this.S = new Array();
  }
  function ARC4init(d) {
    var c,
        a,
        b;
    for (c = 0; c < 256; ++c) {
      this.S[c] = c;
    }
    a = 0;
    for (c = 0; c < 256; ++c) {
      a = (a + this.S[c] + d[c % d.length]) & 255;
      b = this.S[c];
      this.S[c] = this.S[a];
      this.S[a] = b;
    }
    this.i = 0;
    this.j = 0;
  }
  function ARC4next() {
    var a;
    this.i = (this.i + 1) & 255;
    this.j = (this.j + this.S[this.i]) & 255;
    a = this.S[this.i];
    this.S[this.i] = this.S[this.j];
    this.S[this.j] = a;
    return this.S[(a + this.S[this.i]) & 255];
  }
  Arcfour.prototype.init = ARC4init;
  Arcfour.prototype.next = ARC4next;
  function prng_newstate() {
    return new Arcfour();
  }
  var rng_psize = 256;
  var rng_state;
  var rng_pool;
  var rng_pptr;
  function rng_seed_int(a) {
    rng_pool[rng_pptr++] ^= a & 255;
    rng_pool[rng_pptr++] ^= (a >> 8) & 255;
    rng_pool[rng_pptr++] ^= (a >> 16) & 255;
    rng_pool[rng_pptr++] ^= (a >> 24) & 255;
    if (rng_pptr >= rng_psize) {
      rng_pptr -= rng_psize;
    }
  }
  function rng_seed_time() {
    rng_seed_int(new Date().getTime());
  }
  if (rng_pool == null) {
    rng_pool = new Array();
    rng_pptr = 0;
    var t;
    if (navigator.appName == "Netscape" && navigator.appVersion < "5" && window.crypto) {
      var z = window.crypto.random(32);
      for (t = 0; t < z.length; ++t) {
        rng_pool[rng_pptr++] = z.charCodeAt(t) & 255;
      }
    }
    while (rng_pptr < rng_psize) {
      t = Math.floor(65536 * Math.random());
      rng_pool[rng_pptr++] = t >>> 8;
      rng_pool[rng_pptr++] = t & 255;
    }
    rng_pptr = 0;
    rng_seed_time();
  }
  function rng_get_byte() {
    if (rng_state == null) {
      rng_seed_time();
      rng_state = prng_newstate();
      rng_state.init(rng_pool);
      for (rng_pptr = 0; rng_pptr < rng_pool.length; ++rng_pptr) {
        rng_pool[rng_pptr] = 0;
      }
      rng_pptr = 0;
    }
    return rng_state.next();
  }
  function rng_get_bytes(b) {
    var a;
    for (a = 0; a < b.length; ++a) {
      b[a] = rng_get_byte();
    }
  }
  function SecureRandom() {}
  SecureRandom.prototype.nextBytes = rng_get_bytes;
  function parseBigInt(b, a) {
    return new BigInteger(b, a);
  }
  function linebrk(c, d) {
    var a = "";
    var b = 0;
    while (b + d < c.length) {
      a += c.substring(b, b + d) + "\n";
      b += d;
    }
    return a + c.substring(b, c.length);
  }
  function byte2Hex(a) {
    if (a < 16) {
      return "0" + a.toString(16);
    } else {
      return a.toString(16);
    }
  }
  function pkcs1pad2(e, h) {
    if (h < e.length + 11) {
      alert("Message too long for RSA");
      return null;
    }
    var g = new Array();
    var d = e.length - 1;
    while (d >= 0 && h > 0) {
      var f = e.charCodeAt(d--);
      if (f < 128) {
        g[--h] = f;
      } else {
        if ((f > 127) && (f < 2048)) {
          g[--h] = (f & 63) | 128;
          g[--h] = (f >> 6) | 192;
        } else {
          g[--h] = (f & 63) | 128;
          g[--h] = ((f >> 6) & 63) | 128;
          g[--h] = (f >> 12) | 224;
        }
      }
    }
    g[--h] = 0;
    var b = new SecureRandom();
    var a = new Array();
    while (h > 2) {
      a[0] = 0;
      while (a[0] == 0) {
        b.nextBytes(a);
      }
      g[--h] = a[0];
    }
    g[--h] = 2;
    g[--h] = 0;
    return new BigInteger(g);
  }
  function oaep_mgf1_arr(c, a, e) {
    var b = "",
        d = 0;
    while (b.length < a) {
      b += e(String.fromCharCode.apply(String, c.concat([(d & 4278190080) >> 24, (d & 16711680) >> 16, (d & 65280) >> 8, d & 255])));
      d += 1;
    }
    return b;
  }
  var SHA1_SIZE = 20;
  function oaep_pad(l, a, c) {
    if (l.length + 2 * SHA1_SIZE + 2 > a) {
      throw "Message too long for RSA";
    }
    var h = "",
        d;
    for (d = 0; d < a - l.length - 2 * SHA1_SIZE - 2; d += 1) {
      h += "\x00";
    }
    var e = rstr_sha1("") + h + "\x01" + l;
    var f = new Array(SHA1_SIZE);
    new SecureRandom().nextBytes(f);
    var g = oaep_mgf1_arr(f, e.length, c || rstr_sha1);
    var k = [];
    for (d = 0; d < e.length; d += 1) {
      k[d] = e.charCodeAt(d) ^ g.charCodeAt(d);
    }
    var j = oaep_mgf1_arr(k, f.length, rstr_sha1);
    var b = [0];
    for (d = 0; d < f.length; d += 1) {
      b[d + 1] = f[d] ^ j.charCodeAt(d);
    }
    return new BigInteger(b.concat(k));
  }
  function RSAKey() {
    this.n = null;
    this.e = 0;
    this.d = null;
    this.p = null;
    this.q = null;
    this.dmp1 = null;
    this.dmq1 = null;
    this.coeff = null;
  }
  function RSASetPublic(b, a) {
    this.isPublic = true;
    if (typeof b !== "string") {
      this.n = b;
      this.e = a;
    } else {
      if (b != null && a != null && b.length > 0 && a.length > 0) {
        this.n = parseBigInt(b, 16);
        this.e = parseInt(a, 16);
      } else {
        alert("Invalid RSA public key");
      }
    }
  }
  function RSADoPublic(a) {
    return a.modPowInt(this.e, this.n);
  }
  function RSAEncrypt(d) {
    var a = pkcs1pad2(d, (this.n.bitLength() + 7) >> 3);
    if (a == null) {
      return null;
    }
    var e = this.doPublic(a);
    if (e == null) {
      return null;
    }
    var b = e.toString(16);
    if ((b.length & 1) == 0) {
      return b;
    } else {
      return "0" + b;
    }
  }
  function RSAEncryptOAEP(e, d) {
    var a = oaep_pad(e, (this.n.bitLength() + 7) >> 3, d);
    if (a == null) {
      return null;
    }
    var f = this.doPublic(a);
    if (f == null) {
      return null;
    }
    var b = f.toString(16);
    if ((b.length & 1) == 0) {
      return b;
    } else {
      return "0" + b;
    }
  }
  RSAKey.prototype.doPublic = RSADoPublic;
  RSAKey.prototype.setPublic = RSASetPublic;
  RSAKey.prototype.encrypt = RSAEncrypt;
  RSAKey.prototype.encryptOAEP = RSAEncryptOAEP;
  RSAKey.prototype.type = "RSA";
  function pkcs1unpad2(g, j) {
    var a = g.toByteArray();
    var f = 0;
    while (f < a.length && a[f] == 0) {
      ++f;
    }
    if (a.length - f != j - 1 || a[f] != 2) {
      return null;
    }
    ++f;
    while (a[f] != 0) {
      if (++f >= a.length) {
        return null;
      }
    }
    var e = "";
    while (++f < a.length) {
      var h = a[f] & 255;
      if (h < 128) {
        e += String.fromCharCode(h);
      } else {
        if ((h > 191) && (h < 224)) {
          e += String.fromCharCode(((h & 31) << 6) | (a[f + 1] & 63));
          ++f;
        } else {
          e += String.fromCharCode(((h & 15) << 12) | ((a[f + 1] & 63) << 6) | (a[f + 2] & 63));
          f += 2;
        }
      }
    }
    return e;
  }
  function oaep_mgf1_str(c, a, e) {
    var b = "",
        d = 0;
    while (b.length < a) {
      b += e(c + String.fromCharCode.apply(String, [(d & 4278190080) >> 24, (d & 16711680) >> 16, (d & 65280) >> 8, d & 255]));
      d += 1;
    }
    return b;
  }
  var SHA1_SIZE = 20;
  function oaep_unpad(l, b, e) {
    l = l.toByteArray();
    var f;
    for (f = 0; f < l.length; f += 1) {
      l[f] &= 255;
    }
    while (l.length < b) {
      l.unshift(0);
    }
    l = String.fromCharCode.apply(String, l);
    if (l.length < 2 * SHA1_SIZE + 2) {
      throw "Cipher too short";
    }
    var c = l.substr(1, SHA1_SIZE);
    var o = l.substr(SHA1_SIZE + 1);
    var m = oaep_mgf1_str(o, SHA1_SIZE, e || rstr_sha1);
    var h = [],
        f;
    for (f = 0; f < c.length; f += 1) {
      h[f] = c.charCodeAt(f) ^ m.charCodeAt(f);
    }
    var j = oaep_mgf1_str(String.fromCharCode.apply(String, h), l.length - SHA1_SIZE, rstr_sha1);
    var g = [];
    for (f = 0; f < o.length; f += 1) {
      g[f] = o.charCodeAt(f) ^ j.charCodeAt(f);
    }
    g = String.fromCharCode.apply(String, g);
    if (g.substr(0, SHA1_SIZE) !== rstr_sha1("")) {
      throw "Hash mismatch";
    }
    g = g.substr(SHA1_SIZE);
    var a = g.indexOf("\x01");
    var k = (a != -1) ? g.substr(0, a).lastIndexOf("\x00") : -1;
    if (k + 1 != a) {
      throw "Malformed data";
    }
    return g.substr(a + 1);
  }
  function RSASetPrivate(c, a, b) {
    this.isPrivate = true;
    if (typeof c !== "string") {
      this.n = c;
      this.e = a;
      this.d = b;
    } else {
      if (c != null && a != null && c.length > 0 && a.length > 0) {
        this.n = parseBigInt(c, 16);
        this.e = parseInt(a, 16);
        this.d = parseBigInt(b, 16);
      } else {
        alert("Invalid RSA private key");
      }
    }
  }
  function RSASetPrivateEx(g, d, e, c, b, a, h, f) {
    this.isPrivate = true;
    if (g == null) {
      throw "RSASetPrivateEx N == null";
    }
    if (d == null) {
      throw "RSASetPrivateEx E == null";
    }
    if (g.length == 0) {
      throw "RSASetPrivateEx N.length == 0";
    }
    if (d.length == 0) {
      throw "RSASetPrivateEx E.length == 0";
    }
    if (g != null && d != null && g.length > 0 && d.length > 0) {
      this.n = parseBigInt(g, 16);
      this.e = parseInt(d, 16);
      this.d = parseBigInt(e, 16);
      this.p = parseBigInt(c, 16);
      this.q = parseBigInt(b, 16);
      this.dmp1 = parseBigInt(a, 16);
      this.dmq1 = parseBigInt(h, 16);
      this.coeff = parseBigInt(f, 16);
    } else {
      alert("Invalid RSA private key in RSASetPrivateEx");
    }
  }
  function RSAGenerate(b, i) {
    var a = new SecureRandom();
    var f = b >> 1;
    this.e = parseInt(i, 16);
    var c = new BigInteger(i, 16);
    for (; ; ) {
      for (; ; ) {
        this.p = new BigInteger(b - f, 1, a);
        if (this.p.subtract(BigInteger.ONE).gcd(c).compareTo(BigInteger.ONE) == 0 && this.p.isProbablePrime(10)) {
          break;
        }
      }
      for (; ; ) {
        this.q = new BigInteger(f, 1, a);
        if (this.q.subtract(BigInteger.ONE).gcd(c).compareTo(BigInteger.ONE) == 0 && this.q.isProbablePrime(10)) {
          break;
        }
      }
      if (this.p.compareTo(this.q) <= 0) {
        var h = this.p;
        this.p = this.q;
        this.q = h;
      }
      var g = this.p.subtract(BigInteger.ONE);
      var d = this.q.subtract(BigInteger.ONE);
      var e = g.multiply(d);
      if (e.gcd(c).compareTo(BigInteger.ONE) == 0) {
        this.n = this.p.multiply(this.q);
        this.d = c.modInverse(e);
        this.dmp1 = this.d.mod(g);
        this.dmq1 = this.d.mod(d);
        this.coeff = this.q.modInverse(this.p);
        break;
      }
    }
  }
  function RSADoPrivate(a) {
    if (this.p == null || this.q == null) {
      return a.modPow(this.d, this.n);
    }
    var c = a.mod(this.p).modPow(this.dmp1, this.p);
    var b = a.mod(this.q).modPow(this.dmq1, this.q);
    while (c.compareTo(b) < 0) {
      c = c.add(this.p);
    }
    return c.subtract(b).multiply(this.coeff).mod(this.p).multiply(this.q).add(b);
  }
  function RSADecrypt(b) {
    var d = parseBigInt(b, 16);
    var a = this.doPrivate(d);
    if (a == null) {
      return null;
    }
    return pkcs1unpad2(a, (this.n.bitLength() + 7) >> 3);
  }
  function RSADecryptOAEP(d, b) {
    var e = parseBigInt(d, 16);
    var a = this.doPrivate(e);
    if (a == null) {
      return null;
    }
    return oaep_unpad(a, (this.n.bitLength() + 7) >> 3, b);
  }
  RSAKey.prototype.doPrivate = RSADoPrivate;
  RSAKey.prototype.setPrivate = RSASetPrivate;
  RSAKey.prototype.setPrivateEx = RSASetPrivateEx;
  RSAKey.prototype.generate = RSAGenerate;
  RSAKey.prototype.decrypt = RSADecrypt;
  RSAKey.prototype.decryptOAEP = RSADecryptOAEP;
  function ECFieldElementFp(b, a) {
    this.x = a;
    this.q = b;
  }
  function feFpEquals(a) {
    if (a == this) {
      return true;
    }
    return (this.q.equals(a.q) && this.x.equals(a.x));
  }
  function feFpToBigInteger() {
    return this.x;
  }
  function feFpNegate() {
    return new ECFieldElementFp(this.q, this.x.negate().mod(this.q));
  }
  function feFpAdd(a) {
    return new ECFieldElementFp(this.q, this.x.add(a.toBigInteger()).mod(this.q));
  }
  function feFpSubtract(a) {
    return new ECFieldElementFp(this.q, this.x.subtract(a.toBigInteger()).mod(this.q));
  }
  function feFpMultiply(a) {
    return new ECFieldElementFp(this.q, this.x.multiply(a.toBigInteger()).mod(this.q));
  }
  function feFpSquare() {
    return new ECFieldElementFp(this.q, this.x.square().mod(this.q));
  }
  function feFpDivide(a) {
    return new ECFieldElementFp(this.q, this.x.multiply(a.toBigInteger().modInverse(this.q)).mod(this.q));
  }
  ECFieldElementFp.prototype.equals = feFpEquals;
  ECFieldElementFp.prototype.toBigInteger = feFpToBigInteger;
  ECFieldElementFp.prototype.negate = feFpNegate;
  ECFieldElementFp.prototype.add = feFpAdd;
  ECFieldElementFp.prototype.subtract = feFpSubtract;
  ECFieldElementFp.prototype.multiply = feFpMultiply;
  ECFieldElementFp.prototype.square = feFpSquare;
  ECFieldElementFp.prototype.divide = feFpDivide;
  function ECPointFp(c, a, d, b) {
    this.curve = c;
    this.x = a;
    this.y = d;
    if (b == null) {
      this.z = BigInteger.ONE;
    } else {
      this.z = b;
    }
    this.zinv = null;
  }
  function pointFpGetX() {
    if (this.zinv == null) {
      this.zinv = this.z.modInverse(this.curve.q);
    }
    return this.curve.fromBigInteger(this.x.toBigInteger().multiply(this.zinv).mod(this.curve.q));
  }
  function pointFpGetY() {
    if (this.zinv == null) {
      this.zinv = this.z.modInverse(this.curve.q);
    }
    return this.curve.fromBigInteger(this.y.toBigInteger().multiply(this.zinv).mod(this.curve.q));
  }
  function pointFpEquals(a) {
    if (a == this) {
      return true;
    }
    if (this.isInfinity()) {
      return a.isInfinity();
    }
    if (a.isInfinity()) {
      return this.isInfinity();
    }
    var c,
        b;
    c = a.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(a.z)).mod(this.curve.q);
    if (!c.equals(BigInteger.ZERO)) {
      return false;
    }
    b = a.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(a.z)).mod(this.curve.q);
    return b.equals(BigInteger.ZERO);
  }
  function pointFpIsInfinity() {
    if ((this.x == null) && (this.y == null)) {
      return true;
    }
    return this.z.equals(BigInteger.ZERO) && !this.y.toBigInteger().equals(BigInteger.ZERO);
  }
  function pointFpNegate() {
    return new ECPointFp(this.curve, this.x, this.y.negate(), this.z);
  }
  function pointFpAdd(l) {
    if (this.isInfinity()) {
      return l;
    }
    if (l.isInfinity()) {
      return this;
    }
    var p = l.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(l.z)).mod(this.curve.q);
    var o = l.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(l.z)).mod(this.curve.q);
    if (BigInteger.ZERO.equals(o)) {
      if (BigInteger.ZERO.equals(p)) {
        return this.twice();
      }
      return this.curve.getInfinity();
    }
    var j = new BigInteger("3");
    var e = this.x.toBigInteger();
    var n = this.y.toBigInteger();
    var c = l.x.toBigInteger();
    var k = l.y.toBigInteger();
    var m = o.square();
    var i = m.multiply(o);
    var d = e.multiply(m);
    var g = p.square().multiply(this.z);
    var a = g.subtract(d.shiftLeft(1)).multiply(l.z).subtract(i).multiply(o).mod(this.curve.q);
    var h = d.multiply(j).multiply(p).subtract(n.multiply(i)).subtract(g.multiply(p)).multiply(l.z).add(p.multiply(i)).mod(this.curve.q);
    var f = i.multiply(this.z).multiply(l.z).mod(this.curve.q);
    return new ECPointFp(this.curve, this.curve.fromBigInteger(a), this.curve.fromBigInteger(h), f);
  }
  function pointFpTwice() {
    if (this.isInfinity()) {
      return this;
    }
    if (this.y.toBigInteger().signum() == 0) {
      return this.curve.getInfinity();
    }
    var g = new BigInteger("3");
    var c = this.x.toBigInteger();
    var h = this.y.toBigInteger();
    var e = h.multiply(this.z);
    var j = e.multiply(h).mod(this.curve.q);
    var i = this.curve.a.toBigInteger();
    var k = c.square().multiply(g);
    if (!BigInteger.ZERO.equals(i)) {
      k = k.add(this.z.square().multiply(i));
    }
    k = k.mod(this.curve.q);
    var b = k.square().subtract(c.shiftLeft(3).multiply(j)).shiftLeft(1).multiply(e).mod(this.curve.q);
    var f = k.multiply(g).multiply(c).subtract(j.shiftLeft(1)).shiftLeft(2).multiply(j).subtract(k.square().multiply(k)).mod(this.curve.q);
    var d = e.square().multiply(e).shiftLeft(3).mod(this.curve.q);
    return new ECPointFp(this.curve, this.curve.fromBigInteger(b), this.curve.fromBigInteger(f), d);
  }
  function pointFpMultiply(b) {
    if (this.isInfinity()) {
      return this;
    }
    if (b.signum() == 0) {
      return this.curve.getInfinity();
    }
    var g = b;
    var f = g.multiply(new BigInteger("3"));
    var l = this.negate();
    var d = this;
    var c;
    for (c = f.bitLength() - 2; c > 0; --c) {
      d = d.twice();
      var a = f.testBit(c);
      var j = g.testBit(c);
      if (a != j) {
        d = d.add(a ? this : l);
      }
    }
    return d;
  }
  function pointFpMultiplyTwo(c, a, b) {
    var d;
    if (c.bitLength() > b.bitLength()) {
      d = c.bitLength() - 1;
    } else {
      d = b.bitLength() - 1;
    }
    var f = this.curve.getInfinity();
    var e = this.add(a);
    while (d >= 0) {
      f = f.twice();
      if (c.testBit(d)) {
        if (b.testBit(d)) {
          f = f.add(e);
        } else {
          f = f.add(this);
        }
      } else {
        if (b.testBit(d)) {
          f = f.add(a);
        }
      }
      --d;
    }
    return f;
  }
  ECPointFp.prototype.getX = pointFpGetX;
  ECPointFp.prototype.getY = pointFpGetY;
  ECPointFp.prototype.equals = pointFpEquals;
  ECPointFp.prototype.isInfinity = pointFpIsInfinity;
  ECPointFp.prototype.negate = pointFpNegate;
  ECPointFp.prototype.add = pointFpAdd;
  ECPointFp.prototype.twice = pointFpTwice;
  ECPointFp.prototype.multiply = pointFpMultiply;
  ECPointFp.prototype.multiplyTwo = pointFpMultiplyTwo;
  function ECCurveFp(e, d, c) {
    this.q = e;
    this.a = this.fromBigInteger(d);
    this.b = this.fromBigInteger(c);
    this.infinity = new ECPointFp(this, null, null);
  }
  function curveFpGetQ() {
    return this.q;
  }
  function curveFpGetA() {
    return this.a;
  }
  function curveFpGetB() {
    return this.b;
  }
  function curveFpEquals(a) {
    if (a == this) {
      return true;
    }
    return (this.q.equals(a.q) && this.a.equals(a.a) && this.b.equals(a.b));
  }
  function curveFpGetInfinity() {
    return this.infinity;
  }
  function curveFpFromBigInteger(a) {
    return new ECFieldElementFp(this.q, a);
  }
  function curveFpDecodePointHex(d) {
    switch (parseInt(d.substr(0, 2), 16)) {
      case 0:
        return this.infinity;
      case 2:
      case 3:
        return null;
      case 4:
      case 6:
      case 7:
        var a = (d.length - 2) / 2;
        var c = d.substr(2, a);
        var b = d.substr(a + 2, a);
        return new ECPointFp(this, this.fromBigInteger(new BigInteger(c, 16)), this.fromBigInteger(new BigInteger(b, 16)));
      default:
        return null;
    }
  }
  ECCurveFp.prototype.getQ = curveFpGetQ;
  ECCurveFp.prototype.getA = curveFpGetA;
  ECCurveFp.prototype.getB = curveFpGetB;
  ECCurveFp.prototype.equals = curveFpEquals;
  ECCurveFp.prototype.getInfinity = curveFpGetInfinity;
  ECCurveFp.prototype.fromBigInteger = curveFpFromBigInteger;
  ECCurveFp.prototype.decodePointHex = curveFpDecodePointHex;
  ECFieldElementFp.prototype.getByteLength = function() {
    return Math.floor((this.toBigInteger().bitLength() + 7) / 8);
  };
  ECPointFp.prototype.getEncoded = function(c) {
    var d = function(h, f) {
      var g = h.toByteArrayUnsigned();
      if (f < g.length) {
        g = g.slice(g.length - f);
      } else {
        while (f > g.length) {
          g.unshift(0);
        }
      }
      return g;
    };
    var a = this.getX().toBigInteger();
    var e = this.getY().toBigInteger();
    var b = d(a, 32);
    if (c) {
      if (e.isEven()) {
        b.unshift(2);
      } else {
        b.unshift(3);
      }
    } else {
      b.unshift(4);
      b = b.concat(d(e, 32));
    }
    return b;
  };
  ECPointFp.decodeFrom = function(g, c) {
    var f = c[0];
    var e = c.length - 1;
    var d = c.slice(1, 1 + e / 2);
    var b = c.slice(1 + e / 2, 1 + e);
    d.unshift(0);
    b.unshift(0);
    var a = new BigInteger(d);
    var h = new BigInteger(b);
    return new ECPointFp(g, g.fromBigInteger(a), g.fromBigInteger(h));
  };
  ECPointFp.decodeFromHex = function(g, c) {
    var f = c.substr(0, 2);
    var e = c.length - 2;
    var d = c.substr(2, e / 2);
    var b = c.substr(2 + e / 2, e / 2);
    var a = new BigInteger(d, 16);
    var h = new BigInteger(b, 16);
    return new ECPointFp(g, g.fromBigInteger(a), g.fromBigInteger(h));
  };
  ECPointFp.prototype.add2D = function(c) {
    if (this.isInfinity()) {
      return c;
    }
    if (c.isInfinity()) {
      return this;
    }
    if (this.x.equals(c.x)) {
      if (this.y.equals(c.y)) {
        return this.twice();
      }
      return this.curve.getInfinity();
    }
    var g = c.x.subtract(this.x);
    var e = c.y.subtract(this.y);
    var a = e.divide(g);
    var d = a.square().subtract(this.x).subtract(c.x);
    var f = a.multiply(this.x.subtract(d)).subtract(this.y);
    return new ECPointFp(this.curve, d, f);
  };
  ECPointFp.prototype.twice2D = function() {
    if (this.isInfinity()) {
      return this;
    }
    if (this.y.toBigInteger().signum() == 0) {
      return this.curve.getInfinity();
    }
    var b = this.curve.fromBigInteger(BigInteger.valueOf(2));
    var e = this.curve.fromBigInteger(BigInteger.valueOf(3));
    var a = this.x.square().multiply(e).add(this.curve.a).divide(this.y.multiply(b));
    var c = a.square().subtract(this.x.multiply(b));
    var d = a.multiply(this.x.subtract(c)).subtract(this.y);
    return new ECPointFp(this.curve, c, d);
  };
  ECPointFp.prototype.multiply2D = function(b) {
    if (this.isInfinity()) {
      return this;
    }
    if (b.signum() == 0) {
      return this.curve.getInfinity();
    }
    var g = b;
    var f = g.multiply(new BigInteger("3"));
    var l = this.negate();
    var d = this;
    var c;
    for (c = f.bitLength() - 2; c > 0; --c) {
      d = d.twice();
      var a = f.testBit(c);
      var j = g.testBit(c);
      if (a != j) {
        d = d.add2D(a ? this : l);
      }
    }
    return d;
  };
  ECPointFp.prototype.isOnCurve = function() {
    var d = this.getX().toBigInteger();
    var i = this.getY().toBigInteger();
    var f = this.curve.getA().toBigInteger();
    var c = this.curve.getB().toBigInteger();
    var h = this.curve.getQ();
    var e = i.multiply(i).mod(h);
    var g = d.multiply(d).multiply(d).add(f.multiply(d)).add(c).mod(h);
    return e.equals(g);
  };
  ECPointFp.prototype.toString = function() {
    return "(" + this.getX().toBigInteger().toString() + "," + this.getY().toBigInteger().toString() + ")";
  };
  ECPointFp.prototype.validate = function() {
    var c = this.curve.getQ();
    if (this.isInfinity()) {
      throw new Error("Point is at infinity.");
    }
    var a = this.getX().toBigInteger();
    var b = this.getY().toBigInteger();
    if (a.compareTo(BigInteger.ONE) < 0 || a.compareTo(c.subtract(BigInteger.ONE)) > 0) {
      throw new Error("x coordinate out of bounds");
    }
    if (b.compareTo(BigInteger.ONE) < 0 || b.compareTo(c.subtract(BigInteger.ONE)) > 0) {
      throw new Error("y coordinate out of bounds");
    }
    if (!this.isOnCurve()) {
      throw new Error("Point is not on the curve.");
    }
    if (this.multiply(c).isInfinity()) {
      throw new Error("Point is not a scalar multiple of G.");
    }
    return true;
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.asn1 == "undefined" || !KJUR.asn1) {
    KJUR.asn1 = {};
  }
  KJUR.asn1.ASN1Util = new function() {
    this.integerToByteHex = function(a) {
      var b = a.toString(16);
      if ((b.length % 2) == 1) {
        b = "0" + b;
      }
      return b;
    };
    this.bigIntToMinTwosComplementsHex = function(j) {
      var f = j.toString(16);
      if (f.substr(0, 1) != "-") {
        if (f.length % 2 == 1) {
          f = "0" + f;
        } else {
          if (!f.match(/^[0-7]/)) {
            f = "00" + f;
          }
        }
      } else {
        var a = f.substr(1);
        var e = a.length;
        if (e % 2 == 1) {
          e += 1;
        } else {
          if (!f.match(/^[0-7]/)) {
            e += 2;
          }
        }
        var g = "";
        for (var d = 0; d < e; d++) {
          g += "f";
        }
        var c = new BigInteger(g, 16);
        var b = c.xor(j).add(BigInteger.ONE);
        f = b.toString(16).replace(/^-/, "");
      }
      return f;
    };
    this.getPEMStringFromHex = function(a, b) {
      var c = KJUR.asn1;
      var f = CryptoJS.enc.Hex.parse(a);
      var d = CryptoJS.enc.Base64.stringify(f);
      var e = d.replace(/(.{64})/g, "$1\r\n");
      e = e.replace(/\r\n$/, "");
      return "-----BEGIN " + b + "-----\r\n" + e + "\r\n-----END " + b + "-----\r\n";
    };
    this.newObject = function(b) {
      var g = KJUR.asn1;
      var k = Object.keys(b);
      if (k.length != 1) {
        throw "key of param shall be only one.";
      }
      var j = k[0];
      if (":bool:int:bitstr:octstr:null:oid:enum:utf8str:numstr:prnstr:telstr:ia5str:utctime:gentime:seq:set:tag:".indexOf(":" + j + ":") == -1) {
        throw "undefined key: " + j;
      }
      if (j == "bool") {
        return new g.DERBoolean(b[j]);
      }
      if (j == "int") {
        return new g.DERInteger(b[j]);
      }
      if (j == "bitstr") {
        return new g.DERBitString(b[j]);
      }
      if (j == "octstr") {
        return new g.DEROctetString(b[j]);
      }
      if (j == "null") {
        return new g.DERNull(b[j]);
      }
      if (j == "oid") {
        return new g.DERObjectIdentifier(b[j]);
      }
      if (j == "enum") {
        return new g.DEREnumerated(b[j]);
      }
      if (j == "utf8str") {
        return new g.DERUTF8String(b[j]);
      }
      if (j == "numstr") {
        return new g.DERNumericString(b[j]);
      }
      if (j == "prnstr") {
        return new g.DERPrintableString(b[j]);
      }
      if (j == "telstr") {
        return new g.DERTeletexString(b[j]);
      }
      if (j == "ia5str") {
        return new g.DERIA5String(b[j]);
      }
      if (j == "utctime") {
        return new g.DERUTCTime(b[j]);
      }
      if (j == "gentime") {
        return new g.DERGeneralizedTime(b[j]);
      }
      if (j == "seq") {
        var m = b[j];
        var h = [];
        for (var e = 0; e < m.length; e++) {
          var l = g.ASN1Util.newObject(m[e]);
          h.push(l);
        }
        return new g.DERSequence({array: h});
      }
      if (j == "set") {
        var m = b[j];
        var h = [];
        for (var e = 0; e < m.length; e++) {
          var l = g.ASN1Util.newObject(m[e]);
          h.push(l);
        }
        return new g.DERSet({array: h});
      }
      if (j == "tag") {
        var c = b[j];
        if (Object.prototype.toString.call(c) === "[object Array]" && c.length == 3) {
          var d = g.ASN1Util.newObject(c[2]);
          return new g.DERTaggedObject({
            tag: c[0],
            explicit: c[1],
            obj: d
          });
        } else {
          var f = {};
          if (c.explicit !== undefined) {
            f.explicit = c.explicit;
          }
          if (c.tag !== undefined) {
            f.tag = c.tag;
          }
          if (c.obj === undefined) {
            throw "obj shall be specified for 'tag'.";
          }
          f.obj = g.ASN1Util.newObject(c.obj);
          return new g.DERTaggedObject(f);
        }
      }
    };
    this.jsonToASN1HEX = function(b) {
      var a = this.newObject(b);
      return a.getEncodedHex();
    };
  };
  KJUR.asn1.ASN1Util.oidHexToInt = function(a) {
    var j = "";
    var k = parseInt(a.substr(0, 2), 16);
    var d = Math.floor(k / 40);
    var c = k % 40;
    var j = d + "." + c;
    var e = "";
    for (var f = 2; f < a.length; f += 2) {
      var g = parseInt(a.substr(f, 2), 16);
      var h = ("00000000" + g.toString(2)).slice(-8);
      e = e + h.substr(1, 7);
      if (h.substr(0, 1) == "0") {
        var b = new BigInteger(e, 2);
        j = j + "." + b.toString(10);
        e = "";
      }
    }
    return j;
  };
  KJUR.asn1.ASN1Util.oidIntToHex = function(f) {
    var e = function(a) {
      var k = a.toString(16);
      if (k.length == 1) {
        k = "0" + k;
      }
      return k;
    };
    var d = function(o) {
      var n = "";
      var k = new BigInteger(o, 10);
      var a = k.toString(2);
      var l = 7 - a.length % 7;
      if (l == 7) {
        l = 0;
      }
      var q = "";
      for (var m = 0; m < l; m++) {
        q += "0";
      }
      a = q + a;
      for (var m = 0; m < a.length - 1; m += 7) {
        var p = a.substr(m, 7);
        if (m != a.length - 7) {
          p = "1" + p;
        }
        n += e(parseInt(p, 2));
      }
      return n;
    };
    if (!f.match(/^[0-9.]+$/)) {
      throw "malformed oid string: " + f;
    }
    var g = "";
    var b = f.split(".");
    var j = parseInt(b[0]) * 40 + parseInt(b[1]);
    g += e(j);
    b.splice(0, 2);
    for (var c = 0; c < b.length; c++) {
      g += d(b[c]);
    }
    return g;
  };
  KJUR.asn1.ASN1Object = function() {
    var c = true;
    var b = null;
    var d = "00";
    var e = "00";
    var a = "";
    this.getLengthHexFromValue = function() {
      if (typeof this.hV == "undefined" || this.hV == null) {
        throw "this.hV is null or undefined.";
      }
      if (this.hV.length % 2 == 1) {
        throw "value hex must be even length: n=" + a.length + ",v=" + this.hV;
      }
      var i = this.hV.length / 2;
      var h = i.toString(16);
      if (h.length % 2 == 1) {
        h = "0" + h;
      }
      if (i < 128) {
        return h;
      } else {
        var g = h.length / 2;
        if (g > 15) {
          throw "ASN.1 length too long to represent by 8x: n = " + i.toString(16);
        }
        var f = 128 + g;
        return f.toString(16) + h;
      }
    };
    this.getEncodedHex = function() {
      if (this.hTLV == null || this.isModified) {
        this.hV = this.getFreshValueHex();
        this.hL = this.getLengthHexFromValue();
        this.hTLV = this.hT + this.hL + this.hV;
        this.isModified = false;
      }
      return this.hTLV;
    };
    this.getValueHex = function() {
      this.getEncodedHex();
      return this.hV;
    };
    this.getFreshValueHex = function() {
      return "";
    };
  };
  KJUR.asn1.DERAbstractString = function(c) {
    KJUR.asn1.DERAbstractString.superclass.constructor.call(this);
    var b = null;
    var a = null;
    this.getString = function() {
      return this.s;
    };
    this.setString = function(d) {
      this.hTLV = null;
      this.isModified = true;
      this.s = d;
      this.hV = stohex(this.s);
    };
    this.setStringHex = function(d) {
      this.hTLV = null;
      this.isModified = true;
      this.s = null;
      this.hV = d;
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof c != "undefined") {
      if (typeof c == "string") {
        this.setString(c);
      } else {
        if (typeof c.str != "undefined") {
          this.setString(c.str);
        } else {
          if (typeof c.hex != "undefined") {
            this.setStringHex(c.hex);
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERAbstractString, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERAbstractTime = function(c) {
    KJUR.asn1.DERAbstractTime.superclass.constructor.call(this);
    var b = null;
    var a = null;
    this.localDateToUTC = function(f) {
      utc = f.getTime() + (f.getTimezoneOffset() * 60000);
      var e = new Date(utc);
      return e;
    };
    this.formatDate = function(m, o, e) {
      var g = this.zeroPadding;
      var n = this.localDateToUTC(m);
      var p = String(n.getFullYear());
      if (o == "utc") {
        p = p.substr(2, 2);
      }
      var l = g(String(n.getMonth() + 1), 2);
      var q = g(String(n.getDate()), 2);
      var h = g(String(n.getHours()), 2);
      var i = g(String(n.getMinutes()), 2);
      var j = g(String(n.getSeconds()), 2);
      var r = p + l + q + h + i + j;
      if (e === true) {
        var f = n.getMilliseconds();
        if (f != 0) {
          var k = g(String(f), 3);
          k = k.replace(/[0]+$/, "");
          r = r + "." + k;
        }
      }
      return r + "Z";
    };
    this.zeroPadding = function(e, d) {
      if (e.length >= d) {
        return e;
      }
      return new Array(d - e.length + 1).join("0") + e;
    };
    this.getString = function() {
      return this.s;
    };
    this.setString = function(d) {
      this.hTLV = null;
      this.isModified = true;
      this.s = d;
      this.hV = stohex(d);
    };
    this.setByDateValue = function(h, j, e, d, f, g) {
      var i = new Date(Date.UTC(h, j - 1, e, d, f, g, 0));
      this.setByDate(i);
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.DERAbstractTime, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERAbstractStructured = function(b) {
    KJUR.asn1.DERAbstractString.superclass.constructor.call(this);
    var a = null;
    this.setByASN1ObjectArray = function(c) {
      this.hTLV = null;
      this.isModified = true;
      this.asn1Array = c;
    };
    this.appendASN1Object = function(c) {
      this.hTLV = null;
      this.isModified = true;
      this.asn1Array.push(c);
    };
    this.asn1Array = new Array();
    if (typeof b != "undefined") {
      if (typeof b.array != "undefined") {
        this.asn1Array = b.array;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERAbstractStructured, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERBoolean = function() {
    KJUR.asn1.DERBoolean.superclass.constructor.call(this);
    this.hT = "01";
    this.hTLV = "0101ff";
  };
  YAHOO.lang.extend(KJUR.asn1.DERBoolean, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERInteger = function(a) {
    KJUR.asn1.DERInteger.superclass.constructor.call(this);
    this.hT = "02";
    this.setByBigInteger = function(b) {
      this.hTLV = null;
      this.isModified = true;
      this.hV = KJUR.asn1.ASN1Util.bigIntToMinTwosComplementsHex(b);
    };
    this.setByInteger = function(c) {
      var b = new BigInteger(String(c), 10);
      this.setByBigInteger(b);
    };
    this.setValueHex = function(b) {
      this.hV = b;
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a.bigint != "undefined") {
        this.setByBigInteger(a.bigint);
      } else {
        if (typeof a["int"] != "undefined") {
          this.setByInteger(a["int"]);
        } else {
          if (typeof a == "number") {
            this.setByInteger(a);
          } else {
            if (typeof a.hex != "undefined") {
              this.setValueHex(a.hex);
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERInteger, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERBitString = function(a) {
    KJUR.asn1.DERBitString.superclass.constructor.call(this);
    this.hT = "03";
    this.setHexValueIncludingUnusedBits = function(b) {
      this.hTLV = null;
      this.isModified = true;
      this.hV = b;
    };
    this.setUnusedBitsAndHexValue = function(b, d) {
      if (b < 0 || 7 < b) {
        throw "unused bits shall be from 0 to 7: u = " + b;
      }
      var c = "0" + b;
      this.hTLV = null;
      this.isModified = true;
      this.hV = c + d;
    };
    this.setByBinaryString = function(e) {
      e = e.replace(/0+$/, "");
      var f = 8 - e.length % 8;
      if (f == 8) {
        f = 0;
      }
      for (var g = 0; g <= f; g++) {
        e += "0";
      }
      var j = "";
      for (var g = 0; g < e.length - 1; g += 8) {
        var d = e.substr(g, 8);
        var c = parseInt(d, 2).toString(16);
        if (c.length == 1) {
          c = "0" + c;
        }
        j += c;
      }
      this.hTLV = null;
      this.isModified = true;
      this.hV = "0" + f + j;
    };
    this.setByBooleanArray = function(d) {
      var c = "";
      for (var b = 0; b < d.length; b++) {
        if (d[b] == true) {
          c += "1";
        } else {
          c += "0";
        }
      }
      this.setByBinaryString(c);
    };
    this.newFalseArray = function(d) {
      var b = new Array(d);
      for (var c = 0; c < d; c++) {
        b[c] = false;
      }
      return b;
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a == "string" && a.toLowerCase().match(/^[0-9a-f]+$/)) {
        this.setHexValueIncludingUnusedBits(a);
      } else {
        if (typeof a.hex != "undefined") {
          this.setHexValueIncludingUnusedBits(a.hex);
        } else {
          if (typeof a.bin != "undefined") {
            this.setByBinaryString(a.bin);
          } else {
            if (typeof a.array != "undefined") {
              this.setByBooleanArray(a.array);
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERBitString, KJUR.asn1.ASN1Object);
  KJUR.asn1.DEROctetString = function(a) {
    KJUR.asn1.DEROctetString.superclass.constructor.call(this, a);
    this.hT = "04";
  };
  YAHOO.lang.extend(KJUR.asn1.DEROctetString, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERNull = function() {
    KJUR.asn1.DERNull.superclass.constructor.call(this);
    this.hT = "05";
    this.hTLV = "0500";
  };
  YAHOO.lang.extend(KJUR.asn1.DERNull, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERObjectIdentifier = function(c) {
    var b = function(d) {
      var e = d.toString(16);
      if (e.length == 1) {
        e = "0" + e;
      }
      return e;
    };
    var a = function(k) {
      var j = "";
      var e = new BigInteger(k, 10);
      var d = e.toString(2);
      var f = 7 - d.length % 7;
      if (f == 7) {
        f = 0;
      }
      var m = "";
      for (var g = 0; g < f; g++) {
        m += "0";
      }
      d = m + d;
      for (var g = 0; g < d.length - 1; g += 7) {
        var l = d.substr(g, 7);
        if (g != d.length - 7) {
          l = "1" + l;
        }
        j += b(parseInt(l, 2));
      }
      return j;
    };
    KJUR.asn1.DERObjectIdentifier.superclass.constructor.call(this);
    this.hT = "06";
    this.setValueHex = function(d) {
      this.hTLV = null;
      this.isModified = true;
      this.s = null;
      this.hV = d;
    };
    this.setValueOidString = function(f) {
      if (!f.match(/^[0-9.]+$/)) {
        throw "malformed oid string: " + f;
      }
      var g = "";
      var d = f.split(".");
      var j = parseInt(d[0]) * 40 + parseInt(d[1]);
      g += b(j);
      d.splice(0, 2);
      for (var e = 0; e < d.length; e++) {
        g += a(d[e]);
      }
      this.hTLV = null;
      this.isModified = true;
      this.s = null;
      this.hV = g;
    };
    this.setValueName = function(e) {
      if (typeof KJUR.asn1.x509.OID.name2oidList[e] != "undefined") {
        var d = KJUR.asn1.x509.OID.name2oidList[e];
        this.setValueOidString(d);
      } else {
        throw "DERObjectIdentifier oidName undefined: " + e;
      }
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof c != "undefined") {
      if (typeof c == "string" && c.match(/^[0-2].[0-9.]+$/)) {
        this.setValueOidString(c);
      } else {
        if (KJUR.asn1.x509.OID.name2oidList[c] !== undefined) {
          this.setValueOidString(KJUR.asn1.x509.OID.name2oidList[c]);
        } else {
          if (typeof c.oid != "undefined") {
            this.setValueOidString(c.oid);
          } else {
            if (typeof c.hex != "undefined") {
              this.setValueHex(c.hex);
            } else {
              if (typeof c.name != "undefined") {
                this.setValueName(c.name);
              }
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERObjectIdentifier, KJUR.asn1.ASN1Object);
  KJUR.asn1.DEREnumerated = function(a) {
    KJUR.asn1.DEREnumerated.superclass.constructor.call(this);
    this.hT = "0a";
    this.setByBigInteger = function(b) {
      this.hTLV = null;
      this.isModified = true;
      this.hV = KJUR.asn1.ASN1Util.bigIntToMinTwosComplementsHex(b);
    };
    this.setByInteger = function(c) {
      var b = new BigInteger(String(c), 10);
      this.setByBigInteger(b);
    };
    this.setValueHex = function(b) {
      this.hV = b;
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a["int"] != "undefined") {
        this.setByInteger(a["int"]);
      } else {
        if (typeof a == "number") {
          this.setByInteger(a);
        } else {
          if (typeof a.hex != "undefined") {
            this.setValueHex(a.hex);
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DEREnumerated, KJUR.asn1.ASN1Object);
  KJUR.asn1.DERUTF8String = function(a) {
    KJUR.asn1.DERUTF8String.superclass.constructor.call(this, a);
    this.hT = "0c";
  };
  YAHOO.lang.extend(KJUR.asn1.DERUTF8String, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERNumericString = function(a) {
    KJUR.asn1.DERNumericString.superclass.constructor.call(this, a);
    this.hT = "12";
  };
  YAHOO.lang.extend(KJUR.asn1.DERNumericString, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERPrintableString = function(a) {
    KJUR.asn1.DERPrintableString.superclass.constructor.call(this, a);
    this.hT = "13";
  };
  YAHOO.lang.extend(KJUR.asn1.DERPrintableString, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERTeletexString = function(a) {
    KJUR.asn1.DERTeletexString.superclass.constructor.call(this, a);
    this.hT = "14";
  };
  YAHOO.lang.extend(KJUR.asn1.DERTeletexString, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERIA5String = function(a) {
    KJUR.asn1.DERIA5String.superclass.constructor.call(this, a);
    this.hT = "16";
  };
  YAHOO.lang.extend(KJUR.asn1.DERIA5String, KJUR.asn1.DERAbstractString);
  KJUR.asn1.DERUTCTime = function(a) {
    KJUR.asn1.DERUTCTime.superclass.constructor.call(this, a);
    this.hT = "17";
    this.setByDate = function(b) {
      this.hTLV = null;
      this.isModified = true;
      this.date = b;
      this.s = this.formatDate(this.date, "utc");
      this.hV = stohex(this.s);
    };
    this.getFreshValueHex = function() {
      if (typeof this.date == "undefined" && typeof this.s == "undefined") {
        this.date = new Date();
        this.s = this.formatDate(this.date, "utc");
        this.hV = stohex(this.s);
      }
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a.str != "undefined") {
        this.setString(a.str);
      } else {
        if (typeof a == "string" && a.match(/^[0-9]{12}Z$/)) {
          this.setString(a);
        } else {
          if (typeof a.hex != "undefined") {
            this.setStringHex(a.hex);
          } else {
            if (typeof a.date != "undefined") {
              this.setByDate(a.date);
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERUTCTime, KJUR.asn1.DERAbstractTime);
  KJUR.asn1.DERGeneralizedTime = function(a) {
    KJUR.asn1.DERGeneralizedTime.superclass.constructor.call(this, a);
    this.hT = "18";
    this.withMillis = false;
    this.setByDate = function(b) {
      this.hTLV = null;
      this.isModified = true;
      this.date = b;
      this.s = this.formatDate(this.date, "gen", this.withMillis);
      this.hV = stohex(this.s);
    };
    this.getFreshValueHex = function() {
      if (typeof this.date == "undefined" && typeof this.s == "undefined") {
        this.date = new Date();
        this.s = this.formatDate(this.date, "gen", this.withMillis);
        this.hV = stohex(this.s);
      }
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a.str != "undefined") {
        this.setString(a.str);
      } else {
        if (typeof a == "string" && a.match(/^[0-9]{14}Z$/)) {
          this.setString(a);
        } else {
          if (typeof a.hex != "undefined") {
            this.setStringHex(a.hex);
          } else {
            if (typeof a.date != "undefined") {
              this.setByDate(a.date);
            } else {
              if (a.millis === true) {
                this.withMillis = true;
              }
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERGeneralizedTime, KJUR.asn1.DERAbstractTime);
  KJUR.asn1.DERSequence = function(a) {
    KJUR.asn1.DERSequence.superclass.constructor.call(this, a);
    this.hT = "30";
    this.getFreshValueHex = function() {
      var c = "";
      for (var b = 0; b < this.asn1Array.length; b++) {
        var d = this.asn1Array[b];
        c += d.getEncodedHex();
      }
      this.hV = c;
      return this.hV;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.DERSequence, KJUR.asn1.DERAbstractStructured);
  KJUR.asn1.DERSet = function(a) {
    KJUR.asn1.DERSet.superclass.constructor.call(this, a);
    this.hT = "31";
    this.sortFlag = true;
    this.getFreshValueHex = function() {
      var b = new Array();
      for (var c = 0; c < this.asn1Array.length; c++) {
        var d = this.asn1Array[c];
        b.push(d.getEncodedHex());
      }
      if (this.sortFlag == true) {
        b.sort();
      }
      this.hV = b.join("");
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a.sortflag != "undefined" && a.sortflag == false) {
        this.sortFlag = false;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERSet, KJUR.asn1.DERAbstractStructured);
  KJUR.asn1.DERTaggedObject = function(a) {
    KJUR.asn1.DERTaggedObject.superclass.constructor.call(this);
    this.hT = "a0";
    this.hV = "";
    this.isExplicit = true;
    this.asn1Object = null;
    this.setASN1Object = function(b, c, d) {
      this.hT = c;
      this.isExplicit = b;
      this.asn1Object = d;
      if (this.isExplicit) {
        this.hV = this.asn1Object.getEncodedHex();
        this.hTLV = null;
        this.isModified = true;
      } else {
        this.hV = null;
        this.hTLV = d.getEncodedHex();
        this.hTLV = this.hTLV.replace(/^../, c);
        this.isModified = false;
      }
    };
    this.getFreshValueHex = function() {
      return this.hV;
    };
    if (typeof a != "undefined") {
      if (typeof a.tag != "undefined") {
        this.hT = a.tag;
      }
      if (typeof a.explicit != "undefined") {
        this.isExplicit = a.explicit;
      }
      if (typeof a.obj != "undefined") {
        this.asn1Object = a.obj;
        this.setASN1Object(this.isExplicit, this.hT, this.asn1Object);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.DERTaggedObject, KJUR.asn1.ASN1Object);
  var ASN1HEX = new function() {
    this.getByteLengthOfL_AtObj = function(b, c) {
      if (b.substring(c + 2, c + 3) != "8") {
        return 1;
      }
      var a = parseInt(b.substring(c + 3, c + 4));
      if (a == 0) {
        return -1;
      }
      if (0 < a && a < 10) {
        return a + 1;
      }
      return -2;
    };
    this.getHexOfL_AtObj = function(b, c) {
      var a = this.getByteLengthOfL_AtObj(b, c);
      if (a < 1) {
        return "";
      }
      return b.substring(c + 2, c + 2 + a * 2);
    };
    this.getIntOfL_AtObj = function(c, d) {
      var b = this.getHexOfL_AtObj(c, d);
      if (b == "") {
        return -1;
      }
      var a;
      if (parseInt(b.substring(0, 1)) < 8) {
        a = new BigInteger(b, 16);
      } else {
        a = new BigInteger(b.substring(2), 16);
      }
      return a.intValue();
    };
    this.getStartPosOfV_AtObj = function(b, c) {
      var a = this.getByteLengthOfL_AtObj(b, c);
      if (a < 0) {
        return a;
      }
      return c + (a + 1) * 2;
    };
    this.getHexOfV_AtObj = function(c, d) {
      var b = this.getStartPosOfV_AtObj(c, d);
      var a = this.getIntOfL_AtObj(c, d);
      return c.substring(b, b + a * 2);
    };
    this.getHexOfTLV_AtObj = function(c, e) {
      var b = c.substr(e, 2);
      var d = this.getHexOfL_AtObj(c, e);
      var a = this.getHexOfV_AtObj(c, e);
      return b + d + a;
    };
    this.getPosOfNextSibling_AtObj = function(c, d) {
      var b = this.getStartPosOfV_AtObj(c, d);
      var a = this.getIntOfL_AtObj(c, d);
      return b + a * 2;
    };
    this.getPosArrayOfChildren_AtObj = function(f, j) {
      var c = new Array();
      var i = this.getStartPosOfV_AtObj(f, j);
      c.push(i);
      var b = this.getIntOfL_AtObj(f, j);
      var g = i;
      var d = 0;
      while (1) {
        var e = this.getPosOfNextSibling_AtObj(f, g);
        if (e == null || (e - i >= (b * 2))) {
          break;
        }
        if (d >= 200) {
          break;
        }
        c.push(e);
        g = e;
        d++;
      }
      return c;
    };
    this.getNthChildIndex_AtObj = function(d, b, e) {
      var c = this.getPosArrayOfChildren_AtObj(d, b);
      return c[e];
    };
    this.getDecendantIndexByNthList = function(e, d, c) {
      if (c.length == 0) {
        return d;
      }
      var f = c.shift();
      var b = this.getPosArrayOfChildren_AtObj(e, d);
      return this.getDecendantIndexByNthList(e, b[f], c);
    };
    this.getDecendantHexTLVByNthList = function(d, c, b) {
      var a = this.getDecendantIndexByNthList(d, c, b);
      return this.getHexOfTLV_AtObj(d, a);
    };
    this.getDecendantHexVByNthList = function(d, c, b) {
      var a = this.getDecendantIndexByNthList(d, c, b);
      return this.getHexOfV_AtObj(d, a);
    };
  };
  ASN1HEX.getVbyList = function(d, c, b, e) {
    var a = this.getDecendantIndexByNthList(d, c, b);
    if (a === undefined) {
      throw "can't find nthList object";
    }
    if (e !== undefined) {
      if (d.substr(a, 2) != e) {
        throw "checking tag doesn't match: " + d.substr(a, 2) + "!=" + e;
      }
    }
    return this.getHexOfV_AtObj(d, a);
  };
  ASN1HEX.hextooidstr = function(e) {
    var h = function(b, a) {
      if (b.length >= a) {
        return b;
      }
      return new Array(a - b.length + 1).join("0") + b;
    };
    var l = [];
    var o = e.substr(0, 2);
    var f = parseInt(o, 16);
    l[0] = new String(Math.floor(f / 40));
    l[1] = new String(f % 40);
    var m = e.substr(2);
    var k = [];
    for (var g = 0; g < m.length / 2; g++) {
      k.push(parseInt(m.substr(g * 2, 2), 16));
    }
    var j = [];
    var d = "";
    for (var g = 0; g < k.length; g++) {
      if (k[g] & 128) {
        d = d + h((k[g] & 127).toString(2), 7);
      } else {
        d = d + h((k[g] & 127).toString(2), 7);
        j.push(new String(parseInt(d, 2)));
        d = "";
      }
    }
    var n = l.join(".");
    if (j.length > 0) {
      n = n + "." + j.join(".");
    }
    return n;
  };
  ASN1HEX.dump = function(e, c, k, g) {
    var o = function(w, i) {
      if (w.length <= i * 2) {
        return w;
      } else {
        var v = w.substr(0, i) + "..(total " + w.length / 2 + "bytes).." + w.substr(w.length - i, i);
        return v;
      }
    };
    if (c === undefined) {
      c = {ommit_long_octet: 32};
    }
    if (k === undefined) {
      k = 0;
    }
    if (g === undefined) {
      g = "";
    }
    var r = c.ommit_long_octet;
    if (e.substr(k, 2) == "01") {
      var h = ASN1HEX.getHexOfV_AtObj(e, k);
      if (h == "00") {
        return g + "BOOLEAN FALSE\n";
      } else {
        return g + "BOOLEAN TRUE\n";
      }
    }
    if (e.substr(k, 2) == "02") {
      var h = ASN1HEX.getHexOfV_AtObj(e, k);
      return g + "INTEGER " + o(h, r) + "\n";
    }
    if (e.substr(k, 2) == "03") {
      var h = ASN1HEX.getHexOfV_AtObj(e, k);
      return g + "BITSTRING " + o(h, r) + "\n";
    }
    if (e.substr(k, 2) == "04") {
      var h = ASN1HEX.getHexOfV_AtObj(e, k);
      if (ASN1HEX.isASN1HEX(h)) {
        var j = g + "OCTETSTRING, encapsulates\n";
        j = j + ASN1HEX.dump(h, c, 0, g + "  ");
        return j;
      } else {
        return g + "OCTETSTRING " + o(h, r) + "\n";
      }
    }
    if (e.substr(k, 2) == "05") {
      return g + "NULL\n";
    }
    if (e.substr(k, 2) == "06") {
      var l = ASN1HEX.getHexOfV_AtObj(e, k);
      var a = KJUR.asn1.ASN1Util.oidHexToInt(l);
      var n = KJUR.asn1.x509.OID.oid2name(a);
      var b = a.replace(/\./g, " ");
      if (n != "") {
        return g + "ObjectIdentifier " + n + " (" + b + ")\n";
      } else {
        return g + "ObjectIdentifier (" + b + ")\n";
      }
    }
    if (e.substr(k, 2) == "0c") {
      return g + "UTF8String '" + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "'\n";
    }
    if (e.substr(k, 2) == "13") {
      return g + "PrintableString '" + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "'\n";
    }
    if (e.substr(k, 2) == "14") {
      return g + "TeletexString '" + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "'\n";
    }
    if (e.substr(k, 2) == "16") {
      return g + "IA5String '" + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "'\n";
    }
    if (e.substr(k, 2) == "17") {
      return g + "UTCTime " + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "\n";
    }
    if (e.substr(k, 2) == "18") {
      return g + "GeneralizedTime " + hextoutf8(ASN1HEX.getHexOfV_AtObj(e, k)) + "\n";
    }
    if (e.substr(k, 2) == "30") {
      if (e.substr(k, 4) == "3000") {
        return g + "SEQUENCE {}\n";
      }
      var j = g + "SEQUENCE\n";
      var d = ASN1HEX.getPosArrayOfChildren_AtObj(e, k);
      var f = c;
      if ((d.length == 2 || d.length == 3) && e.substr(d[0], 2) == "06" && e.substr(d[d.length - 1], 2) == "04") {
        var t = ASN1HEX.getHexOfV_AtObj(e, d[0]);
        var a = KJUR.asn1.ASN1Util.oidHexToInt(t);
        var n = KJUR.asn1.x509.OID.oid2name(a);
        var p = JSON.parse(JSON.stringify(c));
        p.x509ExtName = n;
        f = p;
      }
      for (var q = 0; q < d.length; q++) {
        j = j + ASN1HEX.dump(e, f, d[q], g + "  ");
      }
      return j;
    }
    if (e.substr(k, 2) == "31") {
      var j = g + "SET\n";
      var d = ASN1HEX.getPosArrayOfChildren_AtObj(e, k);
      for (var q = 0; q < d.length; q++) {
        j = j + ASN1HEX.dump(e, c, d[q], g + "  ");
      }
      return j;
    }
    var u = parseInt(e.substr(k, 2), 16);
    if ((u & 128) != 0) {
      var m = u & 31;
      if ((u & 32) != 0) {
        var j = g + "[" + m + "]\n";
        var d = ASN1HEX.getPosArrayOfChildren_AtObj(e, k);
        for (var q = 0; q < d.length; q++) {
          j = j + ASN1HEX.dump(e, c, d[q], g + "  ");
        }
        return j;
      } else {
        var h = ASN1HEX.getHexOfV_AtObj(e, k);
        if (h.substr(0, 8) == "68747470") {
          h = hextoutf8(h);
        }
        if (c.x509ExtName === "subjectAltName" && m == 2) {
          h = hextoutf8(h);
        }
        var j = g + "[" + m + "] " + h + "\n";
        return j;
      }
    }
    return g + "UNKNOWN(" + e.substr(k, 2) + ") " + ASN1HEX.getHexOfV_AtObj(e, k) + "\n";
  };
  ASN1HEX.isASN1HEX = function(d) {
    if (d.length % 2 == 1) {
      return false;
    }
    var c = ASN1HEX.getIntOfL_AtObj(d, 0);
    var b = d.substr(0, 2);
    var e = ASN1HEX.getHexOfL_AtObj(d, 0);
    var a = d.length - b.length - e.length;
    if (a == c * 2) {
      return true;
    }
    return false;
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.asn1 == "undefined" || !KJUR.asn1) {
    KJUR.asn1 = {};
  }
  if (typeof KJUR.asn1.x509 == "undefined" || !KJUR.asn1.x509) {
    KJUR.asn1.x509 = {};
  }
  KJUR.asn1.x509.Certificate = function(g) {
    KJUR.asn1.x509.Certificate.superclass.constructor.call(this);
    var b = null;
    var d = null;
    var f = null;
    var c = null;
    var a = null;
    var e = null;
    this.setRsaPrvKeyByPEMandPass = function(i, k) {
      var h = PKCS5PKEY.getDecryptedKeyHex(i, k);
      var j = new RSAKey();
      j.readPrivateKeyFromASN1HexString(h);
      this.prvKey = j;
    };
    this.sign = function() {
      this.asn1SignatureAlg = this.asn1TBSCert.asn1SignatureAlg;
      sig = new KJUR.crypto.Signature({alg: "SHA1withRSA"});
      sig.init(this.prvKey);
      sig.updateHex(this.asn1TBSCert.getEncodedHex());
      this.hexSig = sig.sign();
      this.asn1Sig = new KJUR.asn1.DERBitString({hex: "00" + this.hexSig});
      var h = new KJUR.asn1.DERSequence({array: [this.asn1TBSCert, this.asn1SignatureAlg, this.asn1Sig]});
      this.hTLV = h.getEncodedHex();
      this.isModified = false;
    };
    this.setSignatureHex = function(h) {
      this.asn1SignatureAlg = this.asn1TBSCert.asn1SignatureAlg;
      this.hexSig = h;
      this.asn1Sig = new KJUR.asn1.DERBitString({hex: "00" + this.hexSig});
      var i = new KJUR.asn1.DERSequence({array: [this.asn1TBSCert, this.asn1SignatureAlg, this.asn1Sig]});
      this.hTLV = i.getEncodedHex();
      this.isModified = false;
    };
    this.getEncodedHex = function() {
      if (this.isModified == false && this.hTLV != null) {
        return this.hTLV;
      }
      throw "not signed yet";
    };
    this.getPEMString = function() {
      var j = this.getEncodedHex();
      var h = CryptoJS.enc.Hex.parse(j);
      var i = CryptoJS.enc.Base64.stringify(h);
      var k = i.replace(/(.{64})/g, "$1\r\n");
      return "-----BEGIN CERTIFICATE-----\r\n" + k + "\r\n-----END CERTIFICATE-----\r\n";
    };
    if (typeof g != "undefined") {
      if (typeof g.tbscertobj != "undefined") {
        this.asn1TBSCert = g.tbscertobj;
      }
      if (typeof g.prvkeyobj != "undefined") {
        this.prvKey = g.prvkeyobj;
      } else {
        if (typeof g.rsaprvkey != "undefined") {
          this.prvKey = g.rsaprvkey;
        } else {
          if ((typeof g.rsaprvpem != "undefined") && (typeof g.rsaprvpas != "undefined")) {
            this.setRsaPrvKeyByPEMandPass(g.rsaprvpem, g.rsaprvpas);
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.Certificate, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.TBSCertificate = function(a) {
    KJUR.asn1.x509.TBSCertificate.superclass.constructor.call(this);
    this._initialize = function() {
      this.asn1Array = new Array();
      this.asn1Version = new KJUR.asn1.DERTaggedObject({obj: new KJUR.asn1.DERInteger({"int": 2})});
      this.asn1SerialNumber = null;
      this.asn1SignatureAlg = null;
      this.asn1Issuer = null;
      this.asn1NotBefore = null;
      this.asn1NotAfter = null;
      this.asn1Subject = null;
      this.asn1SubjPKey = null;
      this.extensionsArray = new Array();
    };
    this.setSerialNumberByParam = function(b) {
      this.asn1SerialNumber = new KJUR.asn1.DERInteger(b);
    };
    this.setSignatureAlgByParam = function(b) {
      this.asn1SignatureAlg = new KJUR.asn1.x509.AlgorithmIdentifier(b);
    };
    this.setIssuerByParam = function(b) {
      this.asn1Issuer = new KJUR.asn1.x509.X500Name(b);
    };
    this.setNotBeforeByParam = function(b) {
      this.asn1NotBefore = new KJUR.asn1.x509.Time(b);
    };
    this.setNotAfterByParam = function(b) {
      this.asn1NotAfter = new KJUR.asn1.x509.Time(b);
    };
    this.setSubjectByParam = function(b) {
      this.asn1Subject = new KJUR.asn1.x509.X500Name(b);
    };
    this.setSubjectPublicKeyByParam = function(b) {
      this.asn1SubjPKey = new KJUR.asn1.x509.SubjectPublicKeyInfo(b);
    };
    this.setSubjectPublicKeyByGetKey = function(c) {
      var b = KEYUTIL.getKey(c);
      this.asn1SubjPKey = new KJUR.asn1.x509.SubjectPublicKeyInfo(b);
    };
    this.appendExtension = function(b) {
      this.extensionsArray.push(b);
    };
    this.appendExtensionByName = function(d, b) {
      if (d.toLowerCase() == "basicconstraints") {
        var c = new KJUR.asn1.x509.BasicConstraints(b);
        this.appendExtension(c);
      } else {
        if (d.toLowerCase() == "keyusage") {
          var c = new KJUR.asn1.x509.KeyUsage(b);
          this.appendExtension(c);
        } else {
          if (d.toLowerCase() == "crldistributionpoints") {
            var c = new KJUR.asn1.x509.CRLDistributionPoints(b);
            this.appendExtension(c);
          } else {
            if (d.toLowerCase() == "extkeyusage") {
              var c = new KJUR.asn1.x509.ExtKeyUsage(b);
              this.appendExtension(c);
            } else {
              if (d.toLowerCase() == "authoritykeyidentifier") {
                var c = new KJUR.asn1.x509.AuthorityKeyIdentifier(b);
                this.appendExtension(c);
              } else {
                throw "unsupported extension name: " + d;
              }
            }
          }
        }
      }
    };
    this.getEncodedHex = function() {
      if (this.asn1NotBefore == null || this.asn1NotAfter == null) {
        throw "notBefore and/or notAfter not set";
      }
      var c = new KJUR.asn1.DERSequence({array: [this.asn1NotBefore, this.asn1NotAfter]});
      this.asn1Array = new Array();
      this.asn1Array.push(this.asn1Version);
      this.asn1Array.push(this.asn1SerialNumber);
      this.asn1Array.push(this.asn1SignatureAlg);
      this.asn1Array.push(this.asn1Issuer);
      this.asn1Array.push(c);
      this.asn1Array.push(this.asn1Subject);
      this.asn1Array.push(this.asn1SubjPKey);
      if (this.extensionsArray.length > 0) {
        var d = new KJUR.asn1.DERSequence({array: this.extensionsArray});
        var b = new KJUR.asn1.DERTaggedObject({
          explicit: true,
          tag: "a3",
          obj: d
        });
        this.asn1Array.push(b);
      }
      var e = new KJUR.asn1.DERSequence({array: this.asn1Array});
      this.hTLV = e.getEncodedHex();
      this.isModified = false;
      return this.hTLV;
    };
    this._initialize();
  };
  YAHOO.lang.extend(KJUR.asn1.x509.TBSCertificate, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.Extension = function(b) {
    KJUR.asn1.x509.Extension.superclass.constructor.call(this);
    var a = null;
    this.getEncodedHex = function() {
      var f = new KJUR.asn1.DERObjectIdentifier({oid: this.oid});
      var e = new KJUR.asn1.DEROctetString({hex: this.getExtnValueHex()});
      var d = new Array();
      d.push(f);
      if (this.critical) {
        d.push(new KJUR.asn1.DERBoolean());
      }
      d.push(e);
      var c = new KJUR.asn1.DERSequence({array: d});
      return c.getEncodedHex();
    };
    this.critical = false;
    if (typeof b != "undefined") {
      if (typeof b.critical != "undefined") {
        this.critical = b.critical;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.Extension, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.KeyUsage = function(a) {
    KJUR.asn1.x509.KeyUsage.superclass.constructor.call(this, a);
    this.getExtnValueHex = function() {
      return this.asn1ExtnValue.getEncodedHex();
    };
    this.oid = "2.5.29.15";
    if (typeof a != "undefined") {
      if (typeof a.bin != "undefined") {
        this.asn1ExtnValue = new KJUR.asn1.DERBitString(a);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.KeyUsage, KJUR.asn1.x509.Extension);
  KJUR.asn1.x509.BasicConstraints = function(c) {
    KJUR.asn1.x509.BasicConstraints.superclass.constructor.call(this, c);
    var a = false;
    var b = -1;
    this.getExtnValueHex = function() {
      var e = new Array();
      if (this.cA) {
        e.push(new KJUR.asn1.DERBoolean());
      }
      if (this.pathLen > -1) {
        e.push(new KJUR.asn1.DERInteger({"int": this.pathLen}));
      }
      var d = new KJUR.asn1.DERSequence({array: e});
      this.asn1ExtnValue = d;
      return this.asn1ExtnValue.getEncodedHex();
    };
    this.oid = "2.5.29.19";
    this.cA = false;
    this.pathLen = -1;
    if (typeof c != "undefined") {
      if (typeof c.cA != "undefined") {
        this.cA = c.cA;
      }
      if (typeof c.pathLen != "undefined") {
        this.pathLen = c.pathLen;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.BasicConstraints, KJUR.asn1.x509.Extension);
  KJUR.asn1.x509.CRLDistributionPoints = function(a) {
    KJUR.asn1.x509.CRLDistributionPoints.superclass.constructor.call(this, a);
    this.getExtnValueHex = function() {
      return this.asn1ExtnValue.getEncodedHex();
    };
    this.setByDPArray = function(b) {
      this.asn1ExtnValue = new KJUR.asn1.DERSequence({array: b});
    };
    this.setByOneURI = function(e) {
      var b = new KJUR.asn1.x509.GeneralNames([{uri: e}]);
      var d = new KJUR.asn1.x509.DistributionPointName(b);
      var c = new KJUR.asn1.x509.DistributionPoint({dpobj: d});
      this.setByDPArray([c]);
    };
    this.oid = "2.5.29.31";
    if (typeof a != "undefined") {
      if (typeof a.array != "undefined") {
        this.setByDPArray(a.array);
      } else {
        if (typeof a.uri != "undefined") {
          this.setByOneURI(a.uri);
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.CRLDistributionPoints, KJUR.asn1.x509.Extension);
  KJUR.asn1.x509.ExtKeyUsage = function(a) {
    KJUR.asn1.x509.ExtKeyUsage.superclass.constructor.call(this, a);
    this.setPurposeArray = function(b) {
      this.asn1ExtnValue = new KJUR.asn1.DERSequence();
      for (var c = 0; c < b.length; c++) {
        var d = new KJUR.asn1.DERObjectIdentifier(b[c]);
        this.asn1ExtnValue.appendASN1Object(d);
      }
    };
    this.getExtnValueHex = function() {
      return this.asn1ExtnValue.getEncodedHex();
    };
    this.oid = "2.5.29.37";
    if (typeof a != "undefined") {
      if (typeof a.array != "undefined") {
        this.setPurposeArray(a.array);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.ExtKeyUsage, KJUR.asn1.x509.Extension);
  KJUR.asn1.x509.AuthorityKeyIdentifier = function(a) {
    KJUR.asn1.x509.AuthorityKeyIdentifier.superclass.constructor.call(this, a);
    this.asn1KID = null;
    this.asn1CertIssuer = null;
    this.asn1CertSN = null;
    this.getExtnValueHex = function() {
      var c = new Array();
      if (this.asn1KID) {
        c.push(new KJUR.asn1.DERTaggedObject({
          explicit: false,
          tag: "80",
          obj: this.asn1KID
        }));
      }
      if (this.asn1CertIssuer) {
        c.push(new KJUR.asn1.DERTaggedObject({
          explicit: false,
          tag: "a1",
          obj: this.asn1CertIssuer
        }));
      }
      if (this.asn1CertSN) {
        c.push(new KJUR.asn1.DERTaggedObject({
          explicit: false,
          tag: "82",
          obj: this.asn1CertSN
        }));
      }
      var b = new KJUR.asn1.DERSequence({array: c});
      this.asn1ExtnValue = b;
      return this.asn1ExtnValue.getEncodedHex();
    };
    this.setKIDByParam = function(b) {
      this.asn1KID = new KJUR.asn1.DEROctetString(b);
    };
    this.setCertIssuerByParam = function(b) {
      this.asn1CertIssuer = new KJUR.asn1.x509.X500Name(b);
    };
    this.setCertSNByParam = function(b) {
      this.asn1CertSN = new KJUR.asn1.DERInteger(b);
    };
    this.oid = "2.5.29.35";
    if (typeof a != "undefined") {
      if (typeof a.kid != "undefined") {
        this.setKIDByParam(a.kid);
      }
      if (typeof a.issuer != "undefined") {
        this.setCertIssuerByParam(a.issuer);
      }
      if (typeof a.sn != "undefined") {
        this.setCertSNByParam(a.sn);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.AuthorityKeyIdentifier, KJUR.asn1.x509.Extension);
  KJUR.asn1.x509.CRL = function(f) {
    KJUR.asn1.x509.CRL.superclass.constructor.call(this);
    var a = null;
    var c = null;
    var e = null;
    var b = null;
    var d = null;
    this.setRsaPrvKeyByPEMandPass = function(h, j) {
      var g = PKCS5PKEY.getDecryptedKeyHex(h, j);
      var i = new RSAKey();
      i.readPrivateKeyFromASN1HexString(g);
      this.rsaPrvKey = i;
    };
    this.sign = function() {
      this.asn1SignatureAlg = this.asn1TBSCertList.asn1SignatureAlg;
      sig = new KJUR.crypto.Signature({
        alg: "SHA1withRSA",
        prov: "cryptojs/jsrsa"
      });
      sig.initSign(this.rsaPrvKey);
      sig.updateHex(this.asn1TBSCertList.getEncodedHex());
      this.hexSig = sig.sign();
      this.asn1Sig = new KJUR.asn1.DERBitString({hex: "00" + this.hexSig});
      var g = new KJUR.asn1.DERSequence({array: [this.asn1TBSCertList, this.asn1SignatureAlg, this.asn1Sig]});
      this.hTLV = g.getEncodedHex();
      this.isModified = false;
    };
    this.getEncodedHex = function() {
      if (this.isModified == false && this.hTLV != null) {
        return this.hTLV;
      }
      throw "not signed yet";
    };
    this.getPEMString = function() {
      var i = this.getEncodedHex();
      var g = CryptoJS.enc.Hex.parse(i);
      var h = CryptoJS.enc.Base64.stringify(g);
      var j = h.replace(/(.{64})/g, "$1\r\n");
      return "-----BEGIN X509 CRL-----\r\n" + j + "\r\n-----END X509 CRL-----\r\n";
    };
    if (typeof f != "undefined") {
      if (typeof f.tbsobj != "undefined") {
        this.asn1TBSCertList = f.tbsobj;
      }
      if (typeof f.rsaprvkey != "undefined") {
        this.rsaPrvKey = f.rsaprvkey;
      }
      if ((typeof f.rsaprvpem != "undefined") && (typeof f.rsaprvpas != "undefined")) {
        this.setRsaPrvKeyByPEMandPass(f.rsaprvpem, f.rsaprvpas);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.CRL, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.TBSCertList = function(b) {
    KJUR.asn1.x509.TBSCertList.superclass.constructor.call(this);
    var a = null;
    this.setSignatureAlgByParam = function(c) {
      this.asn1SignatureAlg = new KJUR.asn1.x509.AlgorithmIdentifier(c);
    };
    this.setIssuerByParam = function(c) {
      this.asn1Issuer = new KJUR.asn1.x509.X500Name(c);
    };
    this.setThisUpdateByParam = function(c) {
      this.asn1ThisUpdate = new KJUR.asn1.x509.Time(c);
    };
    this.setNextUpdateByParam = function(c) {
      this.asn1NextUpdate = new KJUR.asn1.x509.Time(c);
    };
    this.addRevokedCert = function(c, d) {
      var f = {};
      if (c != undefined && c != null) {
        f.sn = c;
      }
      if (d != undefined && d != null) {
        f.time = d;
      }
      var e = new KJUR.asn1.x509.CRLEntry(f);
      this.aRevokedCert.push(e);
    };
    this.getEncodedHex = function() {
      this.asn1Array = new Array();
      if (this.asn1Version != null) {
        this.asn1Array.push(this.asn1Version);
      }
      this.asn1Array.push(this.asn1SignatureAlg);
      this.asn1Array.push(this.asn1Issuer);
      this.asn1Array.push(this.asn1ThisUpdate);
      if (this.asn1NextUpdate != null) {
        this.asn1Array.push(this.asn1NextUpdate);
      }
      if (this.aRevokedCert.length > 0) {
        var c = new KJUR.asn1.DERSequence({array: this.aRevokedCert});
        this.asn1Array.push(c);
      }
      var d = new KJUR.asn1.DERSequence({array: this.asn1Array});
      this.hTLV = d.getEncodedHex();
      this.isModified = false;
      return this.hTLV;
    };
    this._initialize = function() {
      this.asn1Version = null;
      this.asn1SignatureAlg = null;
      this.asn1Issuer = null;
      this.asn1ThisUpdate = null;
      this.asn1NextUpdate = null;
      this.aRevokedCert = new Array();
    };
    this._initialize();
  };
  YAHOO.lang.extend(KJUR.asn1.x509.TBSCertList, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.CRLEntry = function(c) {
    KJUR.asn1.x509.CRLEntry.superclass.constructor.call(this);
    var b = null;
    var a = null;
    this.setCertSerial = function(d) {
      this.sn = new KJUR.asn1.DERInteger(d);
    };
    this.setRevocationDate = function(d) {
      this.time = new KJUR.asn1.x509.Time(d);
    };
    this.getEncodedHex = function() {
      var d = new KJUR.asn1.DERSequence({array: [this.sn, this.time]});
      this.TLV = d.getEncodedHex();
      return this.TLV;
    };
    if (typeof c != "undefined") {
      if (typeof c.time != "undefined") {
        this.setRevocationDate(c.time);
      }
      if (typeof c.sn != "undefined") {
        this.setCertSerial(c.sn);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.CRLEntry, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.X500Name = function(b) {
    KJUR.asn1.x509.X500Name.superclass.constructor.call(this);
    this.asn1Array = new Array();
    this.setByString = function(c) {
      var d = c.split("/");
      d.shift();
      for (var e = 0; e < d.length; e++) {
        this.asn1Array.push(new KJUR.asn1.x509.RDN({str: d[e]}));
      }
    };
    this.setByObject = function(e) {
      for (var c in e) {
        if (e.hasOwnProperty(c)) {
          var d = new KJUR.asn1.x509.RDN({str: c + "=" + e[c]});
          this.asn1Array ? this.asn1Array.push(d) : this.asn1Array = [d];
        }
      }
    };
    this.getEncodedHex = function() {
      if (typeof this.hTLV == "string") {
        return this.hTLV;
      }
      var c = new KJUR.asn1.DERSequence({array: this.asn1Array});
      this.hTLV = c.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.str != "undefined") {
        this.setByString(b.str);
      } else {
        if (typeof b === "object") {
          this.setByObject(b);
        }
      }
      if (typeof b.certissuer != "undefined") {
        var a = new X509();
        a.hex = X509.pemToHex(b.certissuer);
        this.hTLV = a.getIssuerHex();
      }
      if (typeof b.certsubject != "undefined") {
        var a = new X509();
        a.hex = X509.pemToHex(b.certsubject);
        this.hTLV = a.getSubjectHex();
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.X500Name, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.RDN = function(a) {
    KJUR.asn1.x509.RDN.superclass.constructor.call(this);
    this.asn1Array = new Array();
    this.addByString = function(b) {
      this.asn1Array.push(new KJUR.asn1.x509.AttributeTypeAndValue({str: b}));
    };
    this.getEncodedHex = function() {
      var b = new KJUR.asn1.DERSet({array: this.asn1Array});
      this.TLV = b.getEncodedHex();
      return this.TLV;
    };
    if (typeof a != "undefined") {
      if (typeof a.str != "undefined") {
        this.addByString(a.str);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.RDN, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.AttributeTypeAndValue = function(b) {
    KJUR.asn1.x509.AttributeTypeAndValue.superclass.constructor.call(this);
    var d = null;
    var c = null;
    var a = "utf8";
    this.setByString = function(e) {
      if (e.match(/^([^=]+)=(.+)$/)) {
        this.setByAttrTypeAndValueStr(RegExp.$1, RegExp.$2);
      } else {
        throw "malformed attrTypeAndValueStr: " + e;
      }
    };
    this.setByAttrTypeAndValueStr = function(g, f) {
      this.typeObj = KJUR.asn1.x509.OID.atype2obj(g);
      var e = a;
      if (g == "C") {
        e = "prn";
      }
      this.valueObj = this.getValueObj(e, f);
    };
    this.getValueObj = function(f, e) {
      if (f == "utf8") {
        return new KJUR.asn1.DERUTF8String({str: e});
      }
      if (f == "prn") {
        return new KJUR.asn1.DERPrintableString({str: e});
      }
      if (f == "tel") {
        return new KJUR.asn1.DERTeletexString({str: e});
      }
      if (f == "ia5") {
        return new KJUR.asn1.DERIA5String({str: e});
      }
      throw "unsupported directory string type: type=" + f + " value=" + e;
    };
    this.getEncodedHex = function() {
      var e = new KJUR.asn1.DERSequence({array: [this.typeObj, this.valueObj]});
      this.TLV = e.getEncodedHex();
      return this.TLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.str != "undefined") {
        this.setByString(b.str);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.AttributeTypeAndValue, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.SubjectPublicKeyInfo = function(d) {
    KJUR.asn1.x509.SubjectPublicKeyInfo.superclass.constructor.call(this);
    var b = null;
    var c = null;
    var a = null;
    this.setRSAKey = function(e) {
      if (!RSAKey.prototype.isPrototypeOf(e)) {
        throw "argument is not RSAKey instance";
      }
      this.rsaKey = e;
      var g = new KJUR.asn1.DERInteger({bigint: e.n});
      var f = new KJUR.asn1.DERInteger({"int": e.e});
      var i = new KJUR.asn1.DERSequence({array: [g, f]});
      var h = i.getEncodedHex();
      this.asn1AlgId = new KJUR.asn1.x509.AlgorithmIdentifier({name: "rsaEncryption"});
      this.asn1SubjPKey = new KJUR.asn1.DERBitString({hex: "00" + h});
    };
    this.setRSAPEM = function(g) {
      if (g.match(/-----BEGIN PUBLIC KEY-----/)) {
        var n = g;
        n = n.replace(/^-----[^-]+-----/, "");
        n = n.replace(/-----[^-]+-----\s*$/, "");
        var m = n.replace(/\s+/g, "");
        var f = CryptoJS.enc.Base64.parse(m);
        var i = CryptoJS.enc.Hex.stringify(f);
        var k = _rsapem_getHexValueArrayOfChildrenFromHex(i);
        var h = k[1];
        var l = h.substr(2);
        var e = _rsapem_getHexValueArrayOfChildrenFromHex(l);
        var j = new RSAKey();
        j.setPublic(e[0], e[1]);
        this.setRSAKey(j);
      } else {
        throw "key not supported";
      }
    };
    this.getASN1Object = function() {
      if (this.asn1AlgId == null || this.asn1SubjPKey == null) {
        throw "algId and/or subjPubKey not set";
      }
      var e = new KJUR.asn1.DERSequence({array: [this.asn1AlgId, this.asn1SubjPKey]});
      return e;
    };
    this.getEncodedHex = function() {
      var e = this.getASN1Object();
      this.hTLV = e.getEncodedHex();
      return this.hTLV;
    };
    this._setRSAKey = function(e) {
      var g = KJUR.asn1.ASN1Util.newObject({seq: [{"int": {bigint: e.n}}, {"int": {"int": e.e}}]});
      var f = g.getEncodedHex();
      this.asn1AlgId = new KJUR.asn1.x509.AlgorithmIdentifier({name: "rsaEncryption"});
      this.asn1SubjPKey = new KJUR.asn1.DERBitString({hex: "00" + f});
    };
    this._setEC = function(e) {
      var f = new KJUR.asn1.DERObjectIdentifier({name: e.curveName});
      this.asn1AlgId = new KJUR.asn1.x509.AlgorithmIdentifier({
        name: "ecPublicKey",
        asn1params: f
      });
      this.asn1SubjPKey = new KJUR.asn1.DERBitString({hex: "00" + e.pubKeyHex});
    };
    this._setDSA = function(e) {
      var f = new KJUR.asn1.ASN1Util.newObject({seq: [{"int": {bigint: e.p}}, {"int": {bigint: e.q}}, {"int": {bigint: e.g}}]});
      this.asn1AlgId = new KJUR.asn1.x509.AlgorithmIdentifier({
        name: "dsa",
        asn1params: f
      });
      var g = new KJUR.asn1.DERInteger({bigint: e.y});
      this.asn1SubjPKey = new KJUR.asn1.DERBitString({hex: "00" + g.getEncodedHex()});
    };
    if (typeof d != "undefined") {
      if (typeof RSAKey != "undefined" && d instanceof RSAKey) {
        this._setRSAKey(d);
      } else {
        if (typeof KJUR.crypto.ECDSA != "undefined" && d instanceof KJUR.crypto.ECDSA) {
          this._setEC(d);
        } else {
          if (typeof KJUR.crypto.DSA != "undefined" && d instanceof KJUR.crypto.DSA) {
            this._setDSA(d);
          } else {
            if (typeof d.rsakey != "undefined") {
              this.setRSAKey(d.rsakey);
            } else {
              if (typeof d.rsapem != "undefined") {
                this.setRSAPEM(d.rsapem);
              }
            }
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.SubjectPublicKeyInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.Time = function(c) {
    KJUR.asn1.x509.Time.superclass.constructor.call(this);
    var b = null;
    var a = null;
    this.setTimeParams = function(d) {
      this.timeParams = d;
    };
    this.getEncodedHex = function() {
      var d = null;
      if (this.timeParams != null) {
        if (this.type == "utc") {
          d = new KJUR.asn1.DERUTCTime(this.timeParams);
        } else {
          d = new KJUR.asn1.DERGeneralizedTime(this.timeParams);
        }
      } else {
        if (this.type == "utc") {
          d = new KJUR.asn1.DERUTCTime();
        } else {
          d = new KJUR.asn1.DERGeneralizedTime();
        }
      }
      this.TLV = d.getEncodedHex();
      return this.TLV;
    };
    this.type = "utc";
    if (typeof c != "undefined") {
      if (typeof c.type != "undefined") {
        this.type = c.type;
      } else {
        if (typeof c.str != "undefined") {
          if (c.str.match(/^[0-9]{12}Z$/)) {
            this.type = "utc";
          }
          if (c.str.match(/^[0-9]{14}Z$/)) {
            this.type = "gen";
          }
        }
      }
      this.timeParams = c;
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.Time, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.AlgorithmIdentifier = function(e) {
    KJUR.asn1.x509.AlgorithmIdentifier.superclass.constructor.call(this);
    var a = null;
    var d = null;
    var b = null;
    var c = false;
    this.getEncodedHex = function() {
      if (this.nameAlg == null && this.asn1Alg == null) {
        throw "algorithm not specified";
      }
      if (this.nameAlg != null && this.asn1Alg == null) {
        this.asn1Alg = KJUR.asn1.x509.OID.name2obj(this.nameAlg);
      }
      var f = [this.asn1Alg];
      if (!this.paramEmpty) {
        f.push(this.asn1Params);
      }
      var g = new KJUR.asn1.DERSequence({array: f});
      this.hTLV = g.getEncodedHex();
      return this.hTLV;
    };
    if (typeof e != "undefined") {
      if (typeof e.name != "undefined") {
        this.nameAlg = e.name;
      }
      if (typeof e.asn1params != "undefined") {
        this.asn1Params = e.asn1params;
      }
      if (typeof e.paramempty != "undefined") {
        this.paramEmpty = e.paramempty;
      }
    }
    if (this.asn1Params == null) {
      this.asn1Params = new KJUR.asn1.DERNull();
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.AlgorithmIdentifier, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.GeneralName = function(d) {
    KJUR.asn1.x509.GeneralName.superclass.constructor.call(this);
    var c = null;
    var b = null;
    var a = {
      rfc822: "81",
      dns: "82",
      dn: "a4",
      uri: "86"
    };
    this.explicit = false;
    this.setByParam = function(k) {
      var j = null;
      var g = null;
      if (typeof k == "undefined") {
        return;
      }
      if (typeof k.rfc822 != "undefined") {
        this.type = "rfc822";
        g = new KJUR.asn1.DERIA5String({str: k[this.type]});
      }
      if (typeof k.dns != "undefined") {
        this.type = "dns";
        g = new KJUR.asn1.DERIA5String({str: k[this.type]});
      }
      if (typeof k.uri != "undefined") {
        this.type = "uri";
        g = new KJUR.asn1.DERIA5String({str: k[this.type]});
      }
      if (typeof k.certissuer != "undefined") {
        this.type = "dn";
        this.explicit = true;
        var h = k.certissuer;
        var f = null;
        if (h.match(/^[0-9A-Fa-f]+$/)) {
          f == h;
        }
        if (h.indexOf("-----BEGIN ") != -1) {
          f = X509.pemToHex(h);
        }
        if (f == null) {
          throw "certissuer param not cert";
        }
        var e = new X509();
        e.hex = f;
        var i = e.getIssuerHex();
        g = new KJUR.asn1.ASN1Object();
        g.hTLV = i;
      }
      if (typeof k.certsubj != "undefined") {
        this.type = "dn";
        this.explicit = true;
        var h = k.certsubj;
        var f = null;
        if (h.match(/^[0-9A-Fa-f]+$/)) {
          f == h;
        }
        if (h.indexOf("-----BEGIN ") != -1) {
          f = X509.pemToHex(h);
        }
        if (f == null) {
          throw "certsubj param not cert";
        }
        var e = new X509();
        e.hex = f;
        var i = e.getSubjectHex();
        g = new KJUR.asn1.ASN1Object();
        g.hTLV = i;
      }
      if (this.type == null) {
        throw "unsupported type in params=" + k;
      }
      this.asn1Obj = new KJUR.asn1.DERTaggedObject({
        explicit: this.explicit,
        tag: a[this.type],
        obj: g
      });
    };
    this.getEncodedHex = function() {
      return this.asn1Obj.getEncodedHex();
    };
    if (typeof d != "undefined") {
      this.setByParam(d);
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.GeneralName, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.GeneralNames = function(b) {
    KJUR.asn1.x509.GeneralNames.superclass.constructor.call(this);
    var a = null;
    this.setByParamArray = function(e) {
      for (var c = 0; c < e.length; c++) {
        var d = new KJUR.asn1.x509.GeneralName(e[c]);
        this.asn1Array.push(d);
      }
    };
    this.getEncodedHex = function() {
      var c = new KJUR.asn1.DERSequence({array: this.asn1Array});
      return c.getEncodedHex();
    };
    this.asn1Array = new Array();
    if (typeof b != "undefined") {
      this.setByParamArray(b);
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.GeneralNames, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.DistributionPointName = function(b) {
    KJUR.asn1.x509.DistributionPointName.superclass.constructor.call(this);
    var e = null;
    var c = null;
    var a = null;
    var d = null;
    this.getEncodedHex = function() {
      if (this.type != "full") {
        throw "currently type shall be 'full': " + this.type;
      }
      this.asn1Obj = new KJUR.asn1.DERTaggedObject({
        explicit: false,
        tag: this.tag,
        obj: this.asn1V
      });
      this.hTLV = this.asn1Obj.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (KJUR.asn1.x509.GeneralNames.prototype.isPrototypeOf(b)) {
        this.type = "full";
        this.tag = "a0";
        this.asn1V = b;
      } else {
        throw "This class supports GeneralNames only as argument";
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.DistributionPointName, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.DistributionPoint = function(b) {
    KJUR.asn1.x509.DistributionPoint.superclass.constructor.call(this);
    var a = null;
    this.getEncodedHex = function() {
      var c = new KJUR.asn1.DERSequence();
      if (this.asn1DP != null) {
        var d = new KJUR.asn1.DERTaggedObject({
          explicit: true,
          tag: "a0",
          obj: this.asn1DP
        });
        c.appendASN1Object(d);
      }
      this.hTLV = c.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.dpobj != "undefined") {
        this.asn1DP = b.dpobj;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.x509.DistributionPoint, KJUR.asn1.ASN1Object);
  KJUR.asn1.x509.OID = new function(a) {
    this.atype2oidList = {
      C: "2.5.4.6",
      O: "2.5.4.10",
      OU: "2.5.4.11",
      ST: "2.5.4.8",
      L: "2.5.4.7",
      CN: "2.5.4.3",
      DN: "2.5.4.49",
      DC: "0.9.2342.19200300.100.1.25"
    };
    this.name2oidList = {
      sha1: "1.3.14.3.2.26",
      sha256: "2.16.840.1.101.3.4.2.1",
      sha384: "2.16.840.1.101.3.4.2.2",
      sha512: "2.16.840.1.101.3.4.2.3",
      sha224: "2.16.840.1.101.3.4.2.4",
      md5: "1.2.840.113549.2.5",
      md2: "1.3.14.7.2.2.1",
      ripemd160: "1.3.36.3.2.1",
      MD2withRSA: "1.2.840.113549.1.1.2",
      MD4withRSA: "1.2.840.113549.1.1.3",
      MD5withRSA: "1.2.840.113549.1.1.4",
      SHA1withRSA: "1.2.840.113549.1.1.5",
      SHA224withRSA: "1.2.840.113549.1.1.14",
      SHA256withRSA: "1.2.840.113549.1.1.11",
      SHA384withRSA: "1.2.840.113549.1.1.12",
      SHA512withRSA: "1.2.840.113549.1.1.13",
      SHA1withECDSA: "1.2.840.10045.4.1",
      SHA224withECDSA: "1.2.840.10045.4.3.1",
      SHA256withECDSA: "1.2.840.10045.4.3.2",
      SHA384withECDSA: "1.2.840.10045.4.3.3",
      SHA512withECDSA: "1.2.840.10045.4.3.4",
      dsa: "1.2.840.10040.4.1",
      SHA1withDSA: "1.2.840.10040.4.3",
      SHA224withDSA: "2.16.840.1.101.3.4.3.1",
      SHA256withDSA: "2.16.840.1.101.3.4.3.2",
      rsaEncryption: "1.2.840.113549.1.1.1",
      countryName: "2.5.4.6",
      organization: "2.5.4.10",
      organizationalUnit: "2.5.4.11",
      stateOrProvinceName: "2.5.4.8",
      locality: "2.5.4.7",
      commonName: "2.5.4.3",
      subjectKeyIdentifier: "2.5.29.14",
      keyUsage: "2.5.29.15",
      subjectAltName: "2.5.29.17",
      basicConstraints: "2.5.29.19",
      nameConstraints: "2.5.29.30",
      cRLDistributionPoints: "2.5.29.31",
      certificatePolicies: "2.5.29.32",
      authorityKeyIdentifier: "2.5.29.35",
      policyConstraints: "2.5.29.36",
      extKeyUsage: "2.5.29.37",
      authorityInfoAccess: "1.3.6.1.5.5.7.1.1",
      anyExtendedKeyUsage: "2.5.29.37.0",
      serverAuth: "1.3.6.1.5.5.7.3.1",
      clientAuth: "1.3.6.1.5.5.7.3.2",
      codeSigning: "1.3.6.1.5.5.7.3.3",
      emailProtection: "1.3.6.1.5.5.7.3.4",
      timeStamping: "1.3.6.1.5.5.7.3.8",
      ocspSigning: "1.3.6.1.5.5.7.3.9",
      ecPublicKey: "1.2.840.10045.2.1",
      secp256r1: "1.2.840.10045.3.1.7",
      secp256k1: "1.3.132.0.10",
      secp384r1: "1.3.132.0.34",
      pkcs5PBES2: "1.2.840.113549.1.5.13",
      pkcs5PBKDF2: "1.2.840.113549.1.5.12",
      "des-EDE3-CBC": "1.2.840.113549.3.7",
      data: "1.2.840.113549.1.7.1",
      "signed-data": "1.2.840.113549.1.7.2",
      "enveloped-data": "1.2.840.113549.1.7.3",
      "digested-data": "1.2.840.113549.1.7.5",
      "encrypted-data": "1.2.840.113549.1.7.6",
      "authenticated-data": "1.2.840.113549.1.9.16.1.2",
      tstinfo: "1.2.840.113549.1.9.16.1.4"
    };
    this.objCache = {};
    this.name2obj = function(b) {
      if (typeof this.objCache[b] != "undefined") {
        return this.objCache[b];
      }
      if (typeof this.name2oidList[b] == "undefined") {
        throw "Name of ObjectIdentifier not defined: " + b;
      }
      var c = this.name2oidList[b];
      var d = new KJUR.asn1.DERObjectIdentifier({oid: c});
      this.objCache[b] = d;
      return d;
    };
    this.atype2obj = function(b) {
      if (typeof this.objCache[b] != "undefined") {
        return this.objCache[b];
      }
      if (typeof this.atype2oidList[b] == "undefined") {
        throw "AttributeType name undefined: " + b;
      }
      var c = this.atype2oidList[b];
      var d = new KJUR.asn1.DERObjectIdentifier({oid: c});
      this.objCache[b] = d;
      return d;
    };
  };
  KJUR.asn1.x509.OID.oid2name = function(b) {
    var c = KJUR.asn1.x509.OID.name2oidList;
    for (var a in c) {
      if (c[a] == b) {
        return a;
      }
    }
    return "";
  };
  KJUR.asn1.x509.OID.name2oid = function(a) {
    var b = KJUR.asn1.x509.OID.name2oidList;
    if (b[a] === undefined) {
      return "";
    }
    return b[a];
  };
  KJUR.asn1.x509.X509Util = new function() {
    this.getPKCS8PubKeyPEMfromRSAKey = function(i) {
      var h = null;
      var f = KJUR.asn1.ASN1Util.bigIntToMinTwosComplementsHex(i.n);
      var j = KJUR.asn1.ASN1Util.integerToByteHex(i.e);
      var a = new KJUR.asn1.DERInteger({hex: f});
      var g = new KJUR.asn1.DERInteger({hex: j});
      var l = new KJUR.asn1.DERSequence({array: [a, g]});
      var c = l.getEncodedHex();
      var d = new KJUR.asn1.x509.AlgorithmIdentifier({name: "rsaEncryption"});
      var b = new KJUR.asn1.DERBitString({hex: "00" + c});
      var k = new KJUR.asn1.DERSequence({array: [d, b]});
      var e = k.getEncodedHex();
      var h = KJUR.asn1.ASN1Util.getPEMStringFromHex(e, "PUBLIC KEY");
      return h;
    };
  };
  KJUR.asn1.x509.X509Util.newCertPEM = function(f) {
    var c = KJUR.asn1.x509;
    var e = new c.TBSCertificate();
    if (f.serial !== undefined) {
      e.setSerialNumberByParam(f.serial);
    } else {
      throw "serial number undefined.";
    }
    if (typeof f.sigalg.name == "string") {
      e.setSignatureAlgByParam(f.sigalg);
    } else {
      throw "unproper signature algorithm name";
    }
    if (f.issuer !== undefined) {
      e.setIssuerByParam(f.issuer);
    } else {
      throw "issuer name undefined.";
    }
    if (f.notbefore !== undefined) {
      e.setNotBeforeByParam(f.notbefore);
    } else {
      throw "notbefore undefined.";
    }
    if (f.notafter !== undefined) {
      e.setNotAfterByParam(f.notafter);
    } else {
      throw "notafter undefined.";
    }
    if (f.subject !== undefined) {
      e.setSubjectByParam(f.subject);
    } else {
      throw "subject name undefined.";
    }
    if (f.sbjpubkey !== undefined) {
      e.setSubjectPublicKeyByGetKey(f.sbjpubkey);
    } else {
      throw "subject public key undefined.";
    }
    if (f.ext !== undefined && f.ext.length !== undefined) {
      for (var b = 0; b < f.ext.length; b++) {
        for (key in f.ext[b]) {
          e.appendExtensionByName(key, f.ext[b][key]);
        }
      }
    }
    if (f.cakey === undefined && f.sighex === undefined) {
      throw "param cakey and sighex undefined.";
    }
    var d = null;
    var a = null;
    if (f.cakey) {
      d = KEYUTIL.getKey.apply(null, f.cakey);
      a = new c.Certificate({
        tbscertobj: e,
        prvkeyobj: d
      });
      a.sign();
    }
    if (f.sighex) {
      a = new c.Certificate({tbscertobj: e});
      a.setSignatureHex(f.sighex);
    }
    return a.getPEMString();
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.asn1 == "undefined" || !KJUR.asn1) {
    KJUR.asn1 = {};
  }
  if (typeof KJUR.asn1.cms == "undefined" || !KJUR.asn1.cms) {
    KJUR.asn1.cms = {};
  }
  KJUR.asn1.cms.Attribute = function(b) {
    KJUR.asn1.cms.Attribute.superclass.constructor.call(this);
    var a = [];
    this.getEncodedHex = function() {
      var f,
          e,
          c;
      f = new KJUR.asn1.DERObjectIdentifier({oid: this.attrTypeOid});
      e = new KJUR.asn1.DERSet({array: this.valueList});
      try {
        e.getEncodedHex();
      } catch (d) {
        throw "fail valueSet.getEncodedHex in Attribute(1)/" + d;
      }
      c = new KJUR.asn1.DERSequence({array: [f, e]});
      try {
        this.hTLV = c.getEncodedHex();
      } catch (d) {
        throw "failed seq.getEncodedHex in Attribute(2)/" + d;
      }
      return this.hTLV;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.cms.Attribute, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.ContentType = function(b) {
    KJUR.asn1.cms.ContentType.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.3";
    var a = null;
    if (typeof b != "undefined") {
      var a = new KJUR.asn1.DERObjectIdentifier(b);
      this.valueList = [a];
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.ContentType, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cms.MessageDigest = function(e) {
    KJUR.asn1.cms.MessageDigest.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.4";
    if (typeof e != "undefined") {
      if (e.eciObj instanceof KJUR.asn1.cms.EncapsulatedContentInfo && typeof e.hashAlg == "string") {
        var b = e.eciObj.eContentValueHex;
        var a = e.hashAlg;
        var c = KJUR.crypto.Util.hashHex(b, a);
        var d = new KJUR.asn1.DEROctetString({hex: c});
        d.getEncodedHex();
        this.valueList = [d];
      } else {
        var d = new KJUR.asn1.DEROctetString(e);
        d.getEncodedHex();
        this.valueList = [d];
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.MessageDigest, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cms.SigningTime = function(c) {
    KJUR.asn1.cms.SigningTime.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.5";
    if (typeof c != "undefined") {
      var a = new KJUR.asn1.x509.Time(c);
      try {
        a.getEncodedHex();
      } catch (b) {
        throw "SigningTime.getEncodedHex() failed/" + b;
      }
      this.valueList = [a];
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.SigningTime, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cms.SigningCertificate = function(d) {
    KJUR.asn1.cms.SigningCertificate.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.16.2.12";
    var a = KJUR.asn1;
    var c = KJUR.asn1.cms;
    var b = KJUR.crypto;
    this.setCerts = function(l) {
      var j = [];
      for (var h = 0; h < l.length; h++) {
        var f = KEYUTIL.getHexFromPEM(l[h]);
        var e = b.Util.hashHex(f, "sha1");
        var m = new a.DEROctetString({hex: e});
        m.getEncodedHex();
        var k = new c.IssuerAndSerialNumber({cert: l[h]});
        k.getEncodedHex();
        var n = new a.DERSequence({array: [m, k]});
        n.getEncodedHex();
        j.push(n);
      }
      var g = new a.DERSequence({array: j});
      g.getEncodedHex();
      this.valueList = [g];
    };
    if (typeof d != "undefined") {
      if (typeof d.array == "object") {
        this.setCerts(d.array);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.SigningCertificate, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cms.SigningCertificateV2 = function(e) {
    KJUR.asn1.cms.SigningCertificateV2.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.16.2.47";
    var b = KJUR.asn1;
    var f = KJUR.asn1.x509;
    var d = KJUR.asn1.cms;
    var c = KJUR.crypto;
    this.setCerts = function(p, h) {
      var n = [];
      for (var l = 0; l < p.length; l++) {
        var j = KEYUTIL.getHexFromPEM(p[l]);
        var r = [];
        if (h != "sha256") {
          r.push(new f.AlgorithmIdentifier({name: h}));
        }
        var g = c.Util.hashHex(j, h);
        var q = new b.DEROctetString({hex: g});
        q.getEncodedHex();
        r.push(q);
        var m = new d.IssuerAndSerialNumber({cert: p[l]});
        m.getEncodedHex();
        r.push(m);
        var o = new b.DERSequence({array: r});
        o.getEncodedHex();
        n.push(o);
      }
      var k = new b.DERSequence({array: n});
      k.getEncodedHex();
      this.valueList = [k];
    };
    if (typeof e != "undefined") {
      if (typeof e.array == "object") {
        var a = "sha256";
        if (typeof e.hashAlg == "string") {
          a = e.hashAlg;
        }
        this.setCerts(e.array, a);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.SigningCertificateV2, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cms.IssuerAndSerialNumber = function(c) {
    KJUR.asn1.cms.IssuerAndSerialNumber.superclass.constructor.call(this);
    var e = null;
    var b = null;
    var a = KJUR.asn1;
    var d = a.x509;
    this.setByCertPEM = function(i) {
      var g = KEYUTIL.getHexFromPEM(i);
      var f = new X509();
      f.hex = g;
      var j = f.getIssuerHex();
      this.dIssuer = new d.X500Name();
      this.dIssuer.hTLV = j;
      var h = f.getSerialNumberHex();
      this.dSerial = new a.DERInteger({hex: h});
    };
    this.getEncodedHex = function() {
      var f = new KJUR.asn1.DERSequence({array: [this.dIssuer, this.dSerial]});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (typeof c == "string" && c.indexOf("-----BEGIN ") != -1) {
        this.setByCertPEM(c);
      }
      if (c.issuer && c.serial) {
        if (c.issuer instanceof KJUR.asn1.x509.X500Name) {
          this.dIssuer = c.issuer;
        } else {
          this.dIssuer = new KJUR.asn1.x509.X500Name(c.issuer);
        }
        if (c.serial instanceof KJUR.asn1.DERInteger) {
          this.dSerial = c.serial;
        } else {
          this.dSerial = new KJUR.asn1.DERInteger(c.serial);
        }
      }
      if (typeof c.cert == "string") {
        this.setByCertPEM(c.cert);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.IssuerAndSerialNumber, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.AttributeList = function(a) {
    KJUR.asn1.cms.AttributeList.superclass.constructor.call(this);
    this.list = new Array();
    this.sortFlag = true;
    this.add = function(b) {
      if (b instanceof KJUR.asn1.cms.Attribute) {
        this.list.push(b);
      }
    };
    this.length = function() {
      return this.list.length;
    };
    this.clear = function() {
      this.list = new Array();
      this.hTLV = null;
      this.hV = null;
    };
    this.getEncodedHex = function() {
      if (typeof this.hTLV == "string") {
        return this.hTLV;
      }
      var b = new KJUR.asn1.DERSet({
        array: this.list,
        sortflag: this.sortFlag
      });
      this.hTLV = b.getEncodedHex();
      return this.hTLV;
    };
    if (typeof a != "undefined") {
      if (typeof a.sortflag != "undefined" && a.sortflag == false) {
        this.sortFlag = false;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.AttributeList, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.SignerInfo = function(c) {
    KJUR.asn1.cms.SignerInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.cms;
    var d = KJUR.asn1.x509;
    this.dCMSVersion = new a.DERInteger({"int": 1});
    this.dSignerIdentifier = null;
    this.dDigestAlgorithm = null;
    this.dSignedAttrs = new b.AttributeList();
    this.dSigAlg = null;
    this.dSig = null;
    this.dUnsignedAttrs = new b.AttributeList();
    this.setSignerIdentifier = function(f) {
      if (typeof f == "string" && f.indexOf("CERTIFICATE") != -1 && f.indexOf("BEGIN") != -1 && f.indexOf("END") != -1) {
        var e = f;
        this.dSignerIdentifier = new b.IssuerAndSerialNumber({cert: f});
      }
    };
    this.setForContentAndHash = function(e) {
      if (typeof e != "undefined") {
        if (e.eciObj instanceof KJUR.asn1.cms.EncapsulatedContentInfo) {
          this.dSignedAttrs.add(new b.ContentType({oid: "1.2.840.113549.1.7.1"}));
          this.dSignedAttrs.add(new b.MessageDigest({
            eciObj: e.eciObj,
            hashAlg: e.hashAlg
          }));
        }
        if (typeof e.sdObj != "undefined" && e.sdObj instanceof KJUR.asn1.cms.SignedData) {
          if (e.sdObj.digestAlgNameList.join(":").indexOf(e.hashAlg) == -1) {
            e.sdObj.digestAlgNameList.push(e.hashAlg);
          }
        }
        if (typeof e.hashAlg == "string") {
          this.dDigestAlgorithm = new d.AlgorithmIdentifier({name: e.hashAlg});
        }
      }
    };
    this.sign = function(j, f) {
      this.dSigAlg = new d.AlgorithmIdentifier({name: f});
      var g = this.dSignedAttrs.getEncodedHex();
      var e = KEYUTIL.getKey(j);
      var i = new KJUR.crypto.Signature({alg: f});
      i.init(e);
      i.updateHex(g);
      var h = i.sign();
      this.dSig = new a.DEROctetString({hex: h});
    };
    this.addUnsigned = function(e) {
      this.hTLV = null;
      this.dUnsignedAttrs.hTLV = null;
      this.dUnsignedAttrs.add(e);
    };
    this.getEncodedHex = function() {
      if (this.dSignedAttrs instanceof KJUR.asn1.cms.AttributeList && this.dSignedAttrs.length() == 0) {
        throw "SignedAttrs length = 0 (empty)";
      }
      var e = new a.DERTaggedObject({
        obj: this.dSignedAttrs,
        tag: "a0",
        explicit: false
      });
      var h = null;
      if (this.dUnsignedAttrs.length() > 0) {
        h = new a.DERTaggedObject({
          obj: this.dUnsignedAttrs,
          tag: "a1",
          explicit: false
        });
      }
      var g = [this.dCMSVersion, this.dSignerIdentifier, this.dDigestAlgorithm, e, this.dSigAlg, this.dSig];
      if (h != null) {
        g.push(h);
      }
      var f = new a.DERSequence({array: g});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.cms.SignerInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.EncapsulatedContentInfo = function(c) {
    KJUR.asn1.cms.EncapsulatedContentInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.cms;
    var d = KJUR.asn1.x509;
    this.dEContentType = new a.DERObjectIdentifier({name: "data"});
    this.dEContent = null;
    this.isDetached = false;
    this.eContentValueHex = null;
    this.setContentType = function(e) {
      if (e.match(/^[0-2][.][0-9.]+$/)) {
        this.dEContentType = new a.DERObjectIdentifier({oid: e});
      } else {
        this.dEContentType = new a.DERObjectIdentifier({name: e});
      }
    };
    this.setContentValue = function(e) {
      if (typeof e != "undefined") {
        if (typeof e.hex == "string") {
          this.eContentValueHex = e.hex;
        } else {
          if (typeof e.str == "string") {
            this.eContentValueHex = utf8tohex(e.str);
          }
        }
      }
    };
    this.setContentValueHex = function(e) {
      this.eContentValueHex = e;
    };
    this.setContentValueStr = function(e) {
      this.eContentValueHex = utf8tohex(e);
    };
    this.getEncodedHex = function() {
      if (typeof this.eContentValueHex != "string") {
        throw "eContentValue not yet set";
      }
      var g = new a.DEROctetString({hex: this.eContentValueHex});
      this.dEContent = new a.DERTaggedObject({
        obj: g,
        tag: "a0",
        explicit: true
      });
      var e = [this.dEContentType];
      if (!this.isDetached) {
        e.push(this.dEContent);
      }
      var f = new a.DERSequence({array: e});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.cms.EncapsulatedContentInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.ContentInfo = function(c) {
    KJUR.asn1.cms.ContentInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.cms;
    var d = KJUR.asn1.x509;
    this.dContentType = null;
    this.dContent = null;
    this.setContentType = function(e) {
      if (typeof e == "string") {
        this.dContentType = d.OID.name2obj(e);
      }
    };
    this.getEncodedHex = function() {
      var f = new a.DERTaggedObject({
        obj: this.dContent,
        tag: "a0",
        explicit: true
      });
      var e = new a.DERSequence({array: [this.dContentType, f]});
      this.hTLV = e.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (c.type) {
        this.setContentType(c.type);
      }
      if (c.obj && c.obj instanceof a.ASN1Object) {
        this.dContent = c.obj;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cms.ContentInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.SignedData = function(c) {
    KJUR.asn1.cms.SignedData.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.cms;
    var d = KJUR.asn1.x509;
    this.dCMSVersion = new a.DERInteger({"int": 1});
    this.dDigestAlgs = null;
    this.digestAlgNameList = [];
    this.dEncapContentInfo = new b.EncapsulatedContentInfo();
    this.dCerts = null;
    this.certificateList = [];
    this.crlList = [];
    this.signerInfoList = [new b.SignerInfo()];
    this.addCertificatesByPEM = function(e) {
      var f = KEYUTIL.getHexFromPEM(e);
      var g = new a.ASN1Object();
      g.hTLV = f;
      this.certificateList.push(g);
    };
    this.getEncodedHex = function() {
      if (typeof this.hTLV == "string") {
        return this.hTLV;
      }
      if (this.dDigestAlgs == null) {
        var k = [];
        for (var j = 0; j < this.digestAlgNameList.length; j++) {
          var h = this.digestAlgNameList[j];
          var m = new d.AlgorithmIdentifier({name: h});
          k.push(m);
        }
        this.dDigestAlgs = new a.DERSet({array: k});
      }
      var e = [this.dCMSVersion, this.dDigestAlgs, this.dEncapContentInfo];
      if (this.dCerts == null) {
        if (this.certificateList.length > 0) {
          var l = new a.DERSet({array: this.certificateList});
          this.dCerts = new a.DERTaggedObject({
            obj: l,
            tag: "a0",
            explicit: false
          });
        }
      }
      if (this.dCerts != null) {
        e.push(this.dCerts);
      }
      var g = new a.DERSet({array: this.signerInfoList});
      e.push(g);
      var f = new a.DERSequence({array: e});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
    this.getContentInfo = function() {
      this.getEncodedHex();
      var e = new b.ContentInfo({
        type: "signed-data",
        obj: this
      });
      return e;
    };
    this.getContentInfoEncodedHex = function() {
      var e = this.getContentInfo();
      var f = e.getEncodedHex();
      return f;
    };
    this.getPEM = function() {
      var e = this.getContentInfoEncodedHex();
      var f = a.ASN1Util.getPEMStringFromHex(e, "CMS");
      return f;
    };
  };
  YAHOO.lang.extend(KJUR.asn1.cms.SignedData, KJUR.asn1.ASN1Object);
  KJUR.asn1.cms.CMSUtil = new function() {};
  KJUR.asn1.cms.CMSUtil.newSignedData = function(a) {
    var h = KJUR.asn1.cms;
    var g = KJUR.asn1.cades;
    var f = new h.SignedData();
    f.dEncapContentInfo.setContentValue(a.content);
    if (typeof a.certs == "object") {
      for (var b = 0; b < a.certs.length; b++) {
        f.addCertificatesByPEM(a.certs[b]);
      }
    }
    f.signerInfoList = [];
    for (var b = 0; b < a.signerInfos.length; b++) {
      var d = a.signerInfos[b];
      var c = new h.SignerInfo();
      c.setSignerIdentifier(d.signerCert);
      c.setForContentAndHash({
        sdObj: f,
        eciObj: f.dEncapContentInfo,
        hashAlg: d.hashAlg
      });
      for (attrName in d.sAttr) {
        var j = d.sAttr[attrName];
        if (attrName == "SigningTime") {
          var e = new h.SigningTime(j);
          c.dSignedAttrs.add(e);
        }
        if (attrName == "SigningCertificate") {
          var e = new h.SigningCertificate(j);
          c.dSignedAttrs.add(e);
        }
        if (attrName == "SigningCertificateV2") {
          var e = new h.SigningCertificateV2(j);
          c.dSignedAttrs.add(e);
        }
        if (attrName == "SignaturePolicyIdentifier") {
          var e = new g.SignaturePolicyIdentifier(j);
          c.dSignedAttrs.add(e);
        }
      }
      c.sign(d.signerPrvKey, d.sigAlg);
      f.signerInfoList.push(c);
    }
    return f;
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.asn1 == "undefined" || !KJUR.asn1) {
    KJUR.asn1 = {};
  }
  if (typeof KJUR.asn1.tsp == "undefined" || !KJUR.asn1.tsp) {
    KJUR.asn1.tsp = {};
  }
  KJUR.asn1.tsp.Accuracy = function(b) {
    KJUR.asn1.tsp.Accuracy.superclass.constructor.call(this);
    var a = KJUR.asn1;
    this.seconds = null;
    this.millis = null;
    this.micros = null;
    this.getEncodedHex = function() {
      var e = null;
      var g = null;
      var i = null;
      var c = [];
      if (this.seconds != null) {
        e = new a.DERInteger({"int": this.seconds});
        c.push(e);
      }
      if (this.millis != null) {
        var h = new a.DERInteger({"int": this.millis});
        g = new a.DERTaggedObject({
          obj: h,
          tag: "80",
          explicit: false
        });
        c.push(g);
      }
      if (this.micros != null) {
        var f = new a.DERInteger({"int": this.micros});
        i = new a.DERTaggedObject({
          obj: f,
          tag: "81",
          explicit: false
        });
        c.push(i);
      }
      var d = new a.DERSequence({array: c});
      this.hTLV = d.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.seconds == "number") {
        this.seconds = b.seconds;
      }
      if (typeof b.millis == "number") {
        this.millis = b.millis;
      }
      if (typeof b.micros == "number") {
        this.micros = b.micros;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.Accuracy, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.MessageImprint = function(b) {
    KJUR.asn1.tsp.MessageImprint.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var c = KJUR.asn1.x509;
    this.dHashAlg = null;
    this.dHashValue = null;
    this.getEncodedHex = function() {
      if (typeof this.hTLV == "string") {
        return this.hTLV;
      }
      var d = new a.DERSequence({array: [this.dHashAlg, this.dHashValue]});
      return d.getEncodedHex();
    };
    if (typeof b != "undefined") {
      if (typeof b.hashAlg == "string") {
        this.dHashAlg = new c.AlgorithmIdentifier({name: b.hashAlg});
      }
      if (typeof b.hashValue == "string") {
        this.dHashValue = new a.DEROctetString({hex: b.hashValue});
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.MessageImprint, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.TimeStampReq = function(c) {
    KJUR.asn1.tsp.TimeStampReq.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.tsp;
    this.dVersion = new a.DERInteger({"int": 1});
    this.dMessageImprint = null;
    this.dPolicy = null;
    this.dNonce = null;
    this.certReq = true;
    this.setMessageImprint = function(d) {
      if (d instanceof KJUR.asn1.tsp.MessageImprint) {
        this.dMessageImprint = d;
        return;
      }
      if (typeof d == "object") {
        this.dMessageImprint = new b.MessageImprint(d);
      }
    };
    this.getEncodedHex = function() {
      if (this.dMessageImprint == null) {
        throw "messageImprint shall be specified";
      }
      var d = [this.dVersion, this.dMessageImprint];
      if (this.dPolicy != null) {
        d.push(this.dPolicy);
      }
      if (this.dNonce != null) {
        d.push(this.dNonce);
      }
      if (this.certReq) {
        d.push(new a.DERBoolean());
      }
      var e = new a.DERSequence({array: d});
      this.hTLV = e.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (typeof c.mi == "object") {
        this.setMessageImprint(c.mi);
      }
      if (typeof c.policy == "object") {
        this.dPolicy = new a.DERObjectIdentifier(c.policy);
      }
      if (typeof c.nonce == "object") {
        this.dNonce = new a.DERInteger(c.nonce);
      }
      if (typeof c.certreq == "boolean") {
        this.certReq = c.certreq;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.TimeStampReq, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.TSTInfo = function(c) {
    KJUR.asn1.tsp.TSTInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var d = KJUR.asn1.x509;
    var b = KJUR.asn1.tsp;
    this.dVersion = new a.DERInteger({"int": 1});
    this.dPolicy = null;
    this.dMessageImprint = null;
    this.dSerialNumber = null;
    this.dGenTime = null;
    this.dAccuracy = null;
    this.dOrdering = null;
    this.dNonce = null;
    this.dTsa = null;
    this.getEncodedHex = function() {
      var e = [this.dVersion];
      if (this.dPolicy == null) {
        throw "policy shall be specified.";
      }
      e.push(this.dPolicy);
      if (this.dMessageImprint == null) {
        throw "messageImprint shall be specified.";
      }
      e.push(this.dMessageImprint);
      if (this.dSerialNumber == null) {
        throw "serialNumber shall be specified.";
      }
      e.push(this.dSerialNumber);
      if (this.dGenTime == null) {
        throw "genTime shall be specified.";
      }
      e.push(this.dGenTime);
      if (this.dAccuracy != null) {
        e.push(this.dAccuracy);
      }
      if (this.dOrdering != null) {
        e.push(this.dOrdering);
      }
      if (this.dNonce != null) {
        e.push(this.dNonce);
      }
      if (this.dTsa != null) {
        e.push(this.dTsa);
      }
      var f = new a.DERSequence({array: e});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (typeof c.policy == "string") {
        if (!c.policy.match(/^[0-9.]+$/)) {
          throw "policy shall be oid like 0.1.4.134";
        }
        this.dPolicy = new a.DERObjectIdentifier({oid: c.policy});
      }
      if (typeof c.messageImprint != "undefined") {
        this.dMessageImprint = new b.MessageImprint(c.messageImprint);
      }
      if (typeof c.serialNumber != "undefined") {
        this.dSerialNumber = new a.DERInteger(c.serialNumber);
      }
      if (typeof c.genTime != "undefined") {
        this.dGenTime = new a.DERGeneralizedTime(c.genTime);
      }
      if (typeof c.accuracy != "undefind") {
        this.dAccuracy = new b.Accuracy(c.accuracy);
      }
      if (typeof c.ordering != "undefined" && c.ordering == true) {
        this.dOrdering = new a.DERBoolean();
      }
      if (typeof c.nonce != "undefined") {
        this.dNonce = new a.DERInteger(c.nonce);
      }
      if (typeof c.tsa != "undefined") {
        this.dTsa = new d.X500Name(c.tsa);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.TSTInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.TimeStampResp = function(c) {
    KJUR.asn1.tsp.TimeStampResp.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.tsp;
    this.dStatus = null;
    this.dTST = null;
    this.getEncodedHex = function() {
      if (this.dStatus == null) {
        throw "status shall be specified";
      }
      var d = [this.dStatus];
      if (this.dTST != null) {
        d.push(this.dTST);
      }
      var e = new a.DERSequence({array: d});
      this.hTLV = e.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (typeof c.status == "object") {
        this.dStatus = new b.PKIStatusInfo(c.status);
      }
      if (typeof c.tst != "undefined" && c.tst instanceof KJUR.asn1.ASN1Object) {
        this.dTST = c.tst.getContentInfo();
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.TimeStampResp, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.PKIStatusInfo = function(c) {
    KJUR.asn1.tsp.PKIStatusInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.tsp;
    this.dStatus = null;
    this.dStatusString = null;
    this.dFailureInfo = null;
    this.getEncodedHex = function() {
      if (this.dStatus == null) {
        throw "status shall be specified";
      }
      var d = [this.dStatus];
      if (this.dStatusString != null) {
        d.push(this.dStatusString);
      }
      if (this.dFailureInfo != null) {
        d.push(this.dFailureInfo);
      }
      var e = new a.DERSequence({array: d});
      this.hTLV = e.getEncodedHex();
      return this.hTLV;
    };
    if (typeof c != "undefined") {
      if (typeof c.status == "object") {
        this.dStatus = new b.PKIStatus(c.status);
      }
      if (typeof c.statstr == "object") {
        this.dStatusString = new b.PKIFreeText({array: c.statstr});
      }
      if (typeof c.failinfo == "object") {
        this.dFailureInfo = new b.PKIFailureInfo(c.failinfo);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.PKIStatusInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.PKIStatus = function(e) {
    KJUR.asn1.tsp.PKIStatus.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.tsp;
    var d = null;
    this.getEncodedHex = function() {
      this.hTLV = this.dStatus.getEncodedHex();
      return this.hTLV;
    };
    if (typeof e != "undefined") {
      if (typeof e.name != "undefined") {
        var c = b.PKIStatus.valueList;
        if (typeof c[e.name] == "undefined") {
          throw "name undefined: " + e.name;
        }
        this.dStatus = new a.DERInteger({"int": c[e.name]});
      } else {
        this.dStatus = new a.DERInteger(e);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.PKIStatus, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.PKIStatus.valueList = {
    granted: 0,
    grantedWithMods: 1,
    rejection: 2,
    waiting: 3,
    revocationWarning: 4,
    revocationNotification: 5
  };
  KJUR.asn1.tsp.PKIFreeText = function(b) {
    KJUR.asn1.tsp.PKIFreeText.superclass.constructor.call(this);
    var a = KJUR.asn1;
    this.textList = [];
    this.getEncodedHex = function() {
      var c = [];
      for (var e = 0; e < this.textList.length; e++) {
        c.push(new a.DERUTF8String({str: this.textList[e]}));
      }
      var d = new a.DERSequence({array: c});
      this.hTLV = d.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.array == "object") {
        this.textList = b.array;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.PKIFreeText, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.PKIFailureInfo = function(d) {
    KJUR.asn1.tsp.PKIFailureInfo.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.tsp;
    this.value = null;
    this.getEncodedHex = function() {
      if (this.value == null) {
        throw "value shall be specified";
      }
      var e = new Number(this.value).toString(2);
      var f = new a.DERBitString();
      f.setByBinaryString(e);
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
    if (typeof d != "undefined") {
      if (typeof d.name == "string") {
        var c = b.PKIFailureInfo.valueList;
        if (typeof c[d.name] == "undefined") {
          throw "name undefined: " + d.name;
        }
        this.value = c[d.name];
      } else {
        if (typeof d["int"] == "number") {
          this.value = d["int"];
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.PKIFailureInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.tsp.PKIFailureInfo.valueList = {
    badAlg: 0,
    badRequest: 2,
    badDataFormat: 5,
    timeNotAvailable: 14,
    unacceptedPolicy: 15,
    unacceptedExtension: 16,
    addInfoNotAvailable: 17,
    systemFailure: 25
  };
  KJUR.asn1.tsp.AbstractTSAAdapter = function(a) {
    this.getTSTHex = function(c, b) {
      throw "not implemented yet";
    };
  };
  KJUR.asn1.tsp.SimpleTSAAdapter = function(a) {
    KJUR.asn1.tsp.SimpleTSAAdapter.superclass.constructor.call(this);
    this.params = null;
    this.serial = 0;
    this.getTSTHex = function(c, b) {
      var e = KJUR.crypto.Util.hashHex(c, b);
      this.params.tstInfo.messageImprint = {
        hashAlg: b,
        hashValue: e
      };
      this.params.tstInfo.serialNumber = {"int": this.serial++};
      var d = Math.floor(Math.random() * 1000000000);
      this.params.tstInfo.nonce = {"int": d};
      var f = KJUR.asn1.tsp.TSPUtil.newTimeStampToken(this.params);
      return f.getContentInfoEncodedHex();
    };
    if (typeof a != "undefined") {
      this.params = a;
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.SimpleTSAAdapter, KJUR.asn1.tsp.AbstractTSAAdapter);
  KJUR.asn1.tsp.FixedTSAAdapter = function(a) {
    KJUR.asn1.tsp.FixedTSAAdapter.superclass.constructor.call(this);
    this.params = null;
    this.getTSTHex = function(c, b) {
      var d = KJUR.crypto.Util.hashHex(c, b);
      this.params.tstInfo.messageImprint = {
        hashAlg: b,
        hashValue: d
      };
      var e = KJUR.asn1.tsp.TSPUtil.newTimeStampToken(this.params);
      return e.getContentInfoEncodedHex();
    };
    if (typeof a != "undefined") {
      this.params = a;
    }
  };
  YAHOO.lang.extend(KJUR.asn1.tsp.FixedTSAAdapter, KJUR.asn1.tsp.AbstractTSAAdapter);
  KJUR.asn1.tsp.TSPUtil = new function() {};
  KJUR.asn1.tsp.TSPUtil.newTimeStampToken = function(b) {
    var j = KJUR.asn1.cms;
    var a = KJUR.asn1.tsp;
    var g = new j.SignedData();
    var e = new a.TSTInfo(b.tstInfo);
    var f = e.getEncodedHex();
    g.dEncapContentInfo.setContentValue({hex: f});
    g.dEncapContentInfo.setContentType("tstinfo");
    if (typeof b.certs == "object") {
      for (var c = 0; c < b.certs.length; c++) {
        g.addCertificatesByPEM(b.certs[c]);
      }
    }
    var d = g.signerInfoList[0];
    d.setSignerIdentifier(b.signerCert);
    d.setForContentAndHash({
      sdObj: g,
      eciObj: g.dEncapContentInfo,
      hashAlg: b.hashAlg
    });
    var h = new j.SigningCertificate({array: [b.signerCert]});
    d.dSignedAttrs.add(h);
    d.sign(b.signerPrvKey, b.sigAlg);
    return g;
  };
  KJUR.asn1.tsp.TSPUtil.parseTimeStampReq = function(d) {
    var f = {};
    f.certreq = false;
    var h = ASN1HEX.getPosArrayOfChildren_AtObj(d, 0);
    if (h.length < 2) {
      throw "TimeStampReq must have at least 2 items";
    }
    var c = ASN1HEX.getHexOfTLV_AtObj(d, h[1]);
    f.mi = KJUR.asn1.tsp.TSPUtil.parseMessageImprint(c);
    for (var e = 2; e < h.length; e++) {
      var b = h[e];
      var a = d.substr(b, 2);
      if (a == "06") {
        var g = ASN1HEX.getHexOfV_AtObj(d, b);
        f.policy = ASN1HEX.hextooidstr(g);
      }
      if (a == "02") {
        f.nonce = ASN1HEX.getHexOfV_AtObj(d, b);
      }
      if (a == "01") {
        f.certreq = true;
      }
    }
    return f;
  };
  KJUR.asn1.tsp.TSPUtil.parseMessageImprint = function(c) {
    var h = {};
    if (c.substr(0, 2) != "30") {
      throw "head of messageImprint hex shall be '30'";
    }
    var a = ASN1HEX.getPosArrayOfChildren_AtObj(c, 0);
    var i = ASN1HEX.getDecendantIndexByNthList(c, 0, [0, 0]);
    var d = ASN1HEX.getHexOfV_AtObj(c, i);
    var e = ASN1HEX.hextooidstr(d);
    var g = KJUR.asn1.x509.OID.oid2name(e);
    if (g == "") {
      throw "hashAlg name undefined: " + e;
    }
    var b = g;
    var f = ASN1HEX.getDecendantIndexByNthList(c, 0, [1]);
    h.hashAlg = b;
    h.hashValue = ASN1HEX.getHexOfV_AtObj(c, f);
    return h;
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.asn1 == "undefined" || !KJUR.asn1) {
    KJUR.asn1 = {};
  }
  if (typeof KJUR.asn1.cades == "undefined" || !KJUR.asn1.cades) {
    KJUR.asn1.cades = {};
  }
  KJUR.asn1.cades.SignaturePolicyIdentifier = function(e) {
    KJUR.asn1.cades.SignaturePolicyIdentifier.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.16.2.15";
    var b = KJUR.asn1;
    var d = KJUR.asn1.cades;
    if (typeof e != "undefined") {
      if (typeof e.oid == "string" && typeof e.hash == "object") {
        var f = new b.DERObjectIdentifier({oid: e.oid});
        var a = new d.OtherHashAlgAndValue(e.hash);
        var c = new b.DERSequence({array: [f, a]});
        this.valueList = [c];
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.SignaturePolicyIdentifier, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cades.OtherHashAlgAndValue = function(b) {
    KJUR.asn1.cades.OtherHashAlgAndValue.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var c = KJUR.asn1.x509;
    this.dAlg = null;
    this.dHash = null;
    this.getEncodedHex = function() {
      var d = new a.DERSequence({array: [this.dAlg, this.dHash]});
      this.hTLV = d.getEncodedHex();
      return this.hTLV;
    };
    if (typeof b != "undefined") {
      if (typeof b.alg == "string" && typeof b.hash == "string") {
        this.dAlg = new c.AlgorithmIdentifier({name: b.alg});
        this.dHash = new a.DEROctetString({hex: b.hash});
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.OtherHashAlgAndValue, KJUR.asn1.ASN1Object);
  KJUR.asn1.cades.SignatureTimeStamp = function(c) {
    KJUR.asn1.cades.SignatureTimeStamp.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.16.2.14";
    this.tstHex = null;
    var a = KJUR.asn1;
    if (typeof c != "undefined") {
      if (typeof c.res != "undefined") {
        if (typeof c.res == "string" && c.res.match(/^[0-9A-Fa-f]+$/)) {} else {
          if (c.res instanceof KJUR.asn1.ASN1Object) {} else {
            throw "res param shall be ASN1Object or hex string";
          }
        }
      }
      if (typeof c.tst != "undefined") {
        if (typeof c.tst == "string" && c.tst.match(/^[0-9A-Fa-f]+$/)) {
          var b = new a.ASN1Object();
          this.tstHex = c.tst;
          b.hTLV = this.tstHex;
          b.getEncodedHex();
          this.valueList = [b];
        } else {
          if (c.tst instanceof KJUR.asn1.ASN1Object) {} else {
            throw "tst param shall be ASN1Object or hex string";
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.SignatureTimeStamp, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cades.CompleteCertificateRefs = function(c) {
    KJUR.asn1.cades.CompleteCertificateRefs.superclass.constructor.call(this);
    this.attrTypeOid = "1.2.840.113549.1.9.16.2.21";
    var a = KJUR.asn1;
    var b = KJUR.asn1.cades;
    this.setByArray = function(d) {
      this.valueList = [];
      for (var e = 0; e < d.length; e++) {
        var f = new b.OtherCertID(d[e]);
        this.valueList.push(f);
      }
    };
    if (typeof c != "undefined") {
      if (typeof c == "object" && typeof c.length == "number") {
        this.setByArray(c);
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.CompleteCertificateRefs, KJUR.asn1.cms.Attribute);
  KJUR.asn1.cades.OtherCertID = function(d) {
    KJUR.asn1.cades.OtherCertID.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var c = KJUR.asn1.cms;
    var b = KJUR.asn1.cades;
    this.hasIssuerSerial = true;
    this.dOtherCertHash = null;
    this.dIssuerSerial = null;
    this.setByCertPEM = function(e) {
      this.dOtherCertHash = new b.OtherHash(e);
      if (this.hasIssuerSerial) {
        this.dIssuerSerial = new c.IssuerAndSerialNumber(e);
      }
    };
    this.getEncodedHex = function() {
      if (this.hTLV != null) {
        return this.hTLV;
      }
      if (this.dOtherCertHash == null) {
        throw "otherCertHash not set";
      }
      var e = [this.dOtherCertHash];
      if (this.dIssuerSerial != null) {
        e.push(this.dIssuerSerial);
      }
      var f = new a.DERSequence({array: e});
      this.hTLV = f.getEncodedHex();
      return this.hTLV;
    };
    if (typeof d != "undefined") {
      if (typeof d == "string" && d.indexOf("-----BEGIN ") != -1) {
        this.setByCertPEM(d);
      }
      if (typeof d == "object") {
        if (d.hasis === false) {
          this.hasIssuerSerial = false;
        }
        if (typeof d.cert == "string") {
          this.setByCertPEM(d.cert);
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.OtherCertID, KJUR.asn1.ASN1Object);
  KJUR.asn1.cades.OtherHash = function(c) {
    KJUR.asn1.cades.OtherHash.superclass.constructor.call(this);
    var a = KJUR.asn1;
    var b = KJUR.asn1.cades;
    this.alg = "sha256";
    this.dOtherHash = null;
    this.setByCertPEM = function(d) {
      if (d.indexOf("-----BEGIN ") == -1) {
        throw "certPEM not to seem PEM format";
      }
      var e = X509.pemToHex(d);
      var f = KJUR.crypto.Util.hashHex(e, this.alg);
      this.dOtherHash = new b.OtherHashAlgAndValue({
        alg: this.alg,
        hash: f
      });
    };
    this.getEncodedHex = function() {
      if (this.dOtherHash == null) {
        throw "OtherHash not set";
      }
      return this.dOtherHash.getEncodedHex();
    };
    if (typeof c != "undefined") {
      if (typeof c == "string") {
        if (c.indexOf("-----BEGIN ") != -1) {
          this.setByCertPEM(c);
        } else {
          if (c.match(/^[0-9A-Fa-f]+$/)) {
            this.dOtherHash = new a.DEROctetString({hex: c});
          } else {
            throw "unsupported string value for params";
          }
        }
      } else {
        if (typeof c == "object") {
          if (typeof c.cert == "string") {
            if (typeof c.alg == "string") {
              this.alg = c.alg;
            }
            this.setByCertPEM(c.cert);
          } else {
            this.dOtherHash = new b.OtherHashAlgAndValue(c);
          }
        }
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.cades.OtherHash, KJUR.asn1.ASN1Object);
  KJUR.asn1.cades.CAdESUtil = new function() {};
  KJUR.asn1.cades.CAdESUtil.addSigTS = function(c, b, a) {};
  KJUR.asn1.cades.CAdESUtil.parseSignedDataForAddingUnsigned = function(d) {
    var q = KJUR.asn1;
    var p = KJUR.asn1.cms;
    var c = KJUR.asn1.cades.CAdESUtil;
    var a = {};
    if (ASN1HEX.getDecendantHexTLVByNthList(d, 0, [0]) != "06092a864886f70d010702") {
      throw "hex is not CMS SignedData";
    }
    var s = ASN1HEX.getDecendantIndexByNthList(d, 0, [1, 0]);
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(d, s);
    if (b.length < 4) {
      throw "num of SignedData elem shall be 4 at least";
    }
    var f = b.shift();
    a.version = ASN1HEX.getHexOfTLV_AtObj(d, f);
    var l = b.shift();
    a.algs = ASN1HEX.getHexOfTLV_AtObj(d, l);
    var m = b.shift();
    a.encapcontent = ASN1HEX.getHexOfTLV_AtObj(d, m);
    a.certs = null;
    a.revs = null;
    a.si = [];
    var n = b.shift();
    if (d.substr(n, 2) == "a0") {
      a.certs = ASN1HEX.getHexOfTLV_AtObj(d, n);
      n = b.shift();
    }
    if (d.substr(n, 2) == "a1") {
      a.revs = ASN1HEX.getHexOfTLV_AtObj(d, n);
      n = b.shift();
    }
    var k = n;
    if (d.substr(k, 2) != "31") {
      throw "Can't find signerInfos";
    }
    var j = ASN1HEX.getPosArrayOfChildren_AtObj(d, k);
    for (var h = 0; h < j.length; h++) {
      var o = j[h];
      var e = c.parseSignerInfoForAddingUnsigned(d, o, h);
      a.si[h] = e;
    }
    var g = null;
    a.obj = new p.SignedData();
    g = new q.ASN1Object();
    g.hTLV = a.version;
    a.obj.dCMSVersion = g;
    g = new q.ASN1Object();
    g.hTLV = a.algs;
    a.obj.dDigestAlgs = g;
    g = new q.ASN1Object();
    g.hTLV = a.encapcontent;
    a.obj.dEncapContentInfo = g;
    g = new q.ASN1Object();
    g.hTLV = a.certs;
    a.obj.dCerts = g;
    a.obj.signerInfoList = [];
    for (var h = 0; h < a.si.length; h++) {
      a.obj.signerInfoList.push(a.si[h].obj);
    }
    return a;
  };
  KJUR.asn1.cades.CAdESUtil.parseSignerInfoForAddingUnsigned = function(d, k, a) {
    var m = KJUR.asn1;
    var l = KJUR.asn1.cms;
    var b = {};
    var e = ASN1HEX.getPosArrayOfChildren_AtObj(d, k);
    if (e.length != 6) {
      throw "not supported items for SignerInfo (!=6)";
    }
    var f = e.shift();
    b.version = ASN1HEX.getHexOfTLV_AtObj(d, f);
    var n = e.shift();
    b.si = ASN1HEX.getHexOfTLV_AtObj(d, n);
    var h = e.shift();
    b.digalg = ASN1HEX.getHexOfTLV_AtObj(d, h);
    var c = e.shift();
    b.sattrs = ASN1HEX.getHexOfTLV_AtObj(d, c);
    var i = e.shift();
    b.sigalg = ASN1HEX.getHexOfTLV_AtObj(d, i);
    var j = e.shift();
    b.sig = ASN1HEX.getHexOfTLV_AtObj(d, j);
    b.sigval = ASN1HEX.getHexOfV_AtObj(d, j);
    var g = null;
    b.obj = new l.SignerInfo();
    g = new m.ASN1Object();
    g.hTLV = b.version;
    b.obj.dCMSVersion = g;
    g = new m.ASN1Object();
    g.hTLV = b.si;
    b.obj.dSignerIdentifier = g;
    g = new m.ASN1Object();
    g.hTLV = b.digalg;
    b.obj.dDigestAlgorithm = g;
    g = new m.ASN1Object();
    g.hTLV = b.sattrs;
    b.obj.dSignedAttrs = g;
    g = new m.ASN1Object();
    g.hTLV = b.sigalg;
    b.obj.dSigAlg = g;
    g = new m.ASN1Object();
    g.hTLV = b.sig;
    b.obj.dSig = g;
    b.obj.dUnsignedAttrs = new l.AttributeList();
    return b;
  };
  if (typeof KJUR.asn1.csr == "undefined" || !KJUR.asn1.csr) {
    KJUR.asn1.csr = {};
  }
  KJUR.asn1.csr.CertificationRequest = function(f) {
    KJUR.asn1.csr.CertificationRequest.superclass.constructor.call(this);
    var b = null;
    var d = null;
    var e = null;
    var c = null;
    var a = null;
    this.sign = function(i, h) {
      if (this.prvKey == null) {
        this.prvKey = h;
      }
      this.asn1SignatureAlg = new KJUR.asn1.x509.AlgorithmIdentifier({name: i});
      sig = new KJUR.crypto.Signature({alg: i});
      sig.initSign(this.prvKey);
      sig.updateHex(this.asn1CSRInfo.getEncodedHex());
      this.hexSig = sig.sign();
      this.asn1Sig = new KJUR.asn1.DERBitString({hex: "00" + this.hexSig});
      var g = new KJUR.asn1.DERSequence({array: [this.asn1CSRInfo, this.asn1SignatureAlg, this.asn1Sig]});
      this.hTLV = g.getEncodedHex();
      this.isModified = false;
    };
    this.getPEMString = function() {
      var g = KJUR.asn1.ASN1Util.getPEMStringFromHex(this.getEncodedHex(), "CERTIFICATE REQUEST");
      return g;
    };
    this.getEncodedHex = function() {
      if (this.isModified == false && this.hTLV != null) {
        return this.hTLV;
      }
      throw "not signed yet";
    };
    if (typeof f != "undefined") {
      if (typeof f.csrinfo != "undefined") {
        this.asn1CSRInfo = f.csrinfo;
      }
    }
  };
  YAHOO.lang.extend(KJUR.asn1.csr.CertificationRequest, KJUR.asn1.ASN1Object);
  KJUR.asn1.csr.CertificationRequestInfo = function(a) {
    KJUR.asn1.csr.CertificationRequestInfo.superclass.constructor.call(this);
    this._initialize = function() {
      this.asn1Array = new Array();
      this.asn1Version = new KJUR.asn1.DERInteger({"int": 0});
      this.asn1Subject = null;
      this.asn1SubjPKey = null;
      this.extensionsArray = new Array();
    };
    this.setSubjectByParam = function(b) {
      this.asn1Subject = new KJUR.asn1.x509.X500Name(b);
    };
    this.setSubjectPublicKeyByGetKey = function(c) {
      var b = KEYUTIL.getKey(c);
      this.asn1SubjPKey = new KJUR.asn1.x509.SubjectPublicKeyInfo(b);
    };
    this.getEncodedHex = function() {
      this.asn1Array = new Array();
      this.asn1Array.push(this.asn1Version);
      this.asn1Array.push(this.asn1Subject);
      this.asn1Array.push(this.asn1SubjPKey);
      var c = new KJUR.asn1.DERSequence({array: this.extensionsArray});
      var b = new KJUR.asn1.DERTaggedObject({
        explicit: false,
        tag: "a0",
        obj: c
      });
      this.asn1Array.push(b);
      var d = new KJUR.asn1.DERSequence({array: this.asn1Array});
      this.hTLV = d.getEncodedHex();
      this.isModified = false;
      return this.hTLV;
    };
    this._initialize();
  };
  YAHOO.lang.extend(KJUR.asn1.csr.CertificationRequestInfo, KJUR.asn1.ASN1Object);
  KJUR.asn1.csr.CSRUtil = new function() {};
  KJUR.asn1.csr.CSRUtil.newCSRPEM = function(f) {
    var c = KJUR.asn1.csr;
    if (f.subject === undefined) {
      throw "parameter subject undefined";
    }
    if (f.sbjpubkey === undefined) {
      throw "parameter sbjpubkey undefined";
    }
    if (f.sigalg === undefined) {
      throw "parameter sigalg undefined";
    }
    if (f.sbjprvkey === undefined) {
      throw "parameter sbjpubkey undefined";
    }
    var b = new c.CertificationRequestInfo();
    b.setSubjectByParam(f.subject);
    b.setSubjectPublicKeyByGetKey(f.sbjpubkey);
    var d = new c.CertificationRequest({csrinfo: b});
    var a = KEYUTIL.getKey(f.sbjprvkey);
    d.sign(f.sigalg, a);
    var e = d.getPEMString();
    return e;
  };
  function Base64x() {}
  function stoBA(d) {
    var b = new Array();
    for (var c = 0; c < d.length; c++) {
      b[c] = d.charCodeAt(c);
    }
    return b;
  }
  function BAtos(b) {
    var d = "";
    for (var c = 0; c < b.length; c++) {
      d = d + String.fromCharCode(b[c]);
    }
    return d;
  }
  function BAtohex(b) {
    var e = "";
    for (var d = 0; d < b.length; d++) {
      var c = b[d].toString(16);
      if (c.length == 1) {
        c = "0" + c;
      }
      e = e + c;
    }
    return e;
  }
  function stohex(a) {
    return BAtohex(stoBA(a));
  }
  function stob64(a) {
    return hex2b64(stohex(a));
  }
  function stob64u(a) {
    return b64tob64u(hex2b64(stohex(a)));
  }
  function b64utos(a) {
    return BAtos(b64toBA(b64utob64(a)));
  }
  function b64tob64u(a) {
    a = a.replace(/\=/g, "");
    a = a.replace(/\+/g, "-");
    a = a.replace(/\//g, "_");
    return a;
  }
  function b64utob64(a) {
    if (a.length % 4 == 2) {
      a = a + "==";
    } else {
      if (a.length % 4 == 3) {
        a = a + "=";
      }
    }
    a = a.replace(/-/g, "+");
    a = a.replace(/_/g, "/");
    return a;
  }
  function hextob64u(a) {
    if (a.length % 2 == 1) {
      a = "0" + a;
    }
    return b64tob64u(hex2b64(a));
  }
  function b64utohex(a) {
    return b64tohex(b64utob64(a));
  }
  var utf8tob64u,
      b64utoutf8;
  if (typeof Buffer === "function") {
    utf8tob64u = function(a) {
      return b64tob64u(new Buffer(a, "utf8").toString("base64"));
    };
    b64utoutf8 = function(a) {
      return new Buffer(b64utob64(a), "base64").toString("utf8");
    };
  } else {
    utf8tob64u = function(a) {
      return hextob64u(uricmptohex(encodeURIComponentAll(a)));
    };
    b64utoutf8 = function(a) {
      return decodeURIComponent(hextouricmp(b64utohex(a)));
    };
  }
  function utf8tob64(a) {
    return hex2b64(uricmptohex(encodeURIComponentAll(a)));
  }
  function b64toutf8(a) {
    return decodeURIComponent(hextouricmp(b64tohex(a)));
  }
  function utf8tohex(a) {
    return uricmptohex(encodeURIComponentAll(a));
  }
  function hextoutf8(a) {
    return decodeURIComponent(hextouricmp(a));
  }
  function hextorstr(c) {
    var b = "";
    for (var a = 0; a < c.length - 1; a += 2) {
      b += String.fromCharCode(parseInt(c.substr(a, 2), 16));
    }
    return b;
  }
  function rstrtohex(c) {
    var a = "";
    for (var b = 0; b < c.length; b++) {
      a += ("0" + c.charCodeAt(b).toString(16)).slice(-2);
    }
    return a;
  }
  function hextob64(a) {
    return hex2b64(a);
  }
  function hextob64nl(b) {
    var a = hextob64(b);
    var c = a.replace(/(.{64})/g, "$1\r\n");
    c = c.replace(/\r\n$/, "");
    return c;
  }
  function b64nltohex(b) {
    var a = b.replace(/[^0-9A-Za-z\/+=]*/g, "");
    var c = b64tohex(a);
    return c;
  }
  function uricmptohex(a) {
    return a.replace(/%/g, "");
  }
  function hextouricmp(a) {
    return a.replace(/(..)/g, "%$1");
  }
  function encodeURIComponentAll(a) {
    var d = encodeURIComponent(a);
    var b = "";
    for (var c = 0; c < d.length; c++) {
      if (d[c] == "%") {
        b = b + d.substr(c, 3);
        c = c + 2;
      } else {
        b = b + "%" + stohex(d[c]);
      }
    }
    return b;
  }
  function newline_toUnix(a) {
    a = a.replace(/\r\n/mg, "\n");
    return a;
  }
  function newline_toDos(a) {
    a = a.replace(/\r\n/mg, "\n");
    a = a.replace(/\n/mg, "\r\n");
    return a;
  }
  var strdiffidx = function(c, a) {
    var d = c.length;
    if (c.length > a.length) {
      d = a.length;
    }
    for (var b = 0; b < d; b++) {
      if (c.charCodeAt(b) != a.charCodeAt(b)) {
        return b;
      }
    }
    if (c.length != a.length) {
      return d;
    }
    return -1;
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.crypto == "undefined" || !KJUR.crypto) {
    KJUR.crypto = {};
  }
  KJUR.crypto.Util = new function() {
    this.DIGESTINFOHEAD = {
      sha1: "3021300906052b0e03021a05000414",
      sha224: "302d300d06096086480165030402040500041c",
      sha256: "3031300d060960864801650304020105000420",
      sha384: "3041300d060960864801650304020205000430",
      sha512: "3051300d060960864801650304020305000440",
      md2: "3020300c06082a864886f70d020205000410",
      md5: "3020300c06082a864886f70d020505000410",
      ripemd160: "3021300906052b2403020105000414"
    };
    this.DEFAULTPROVIDER = {
      md5: "cryptojs",
      sha1: "cryptojs",
      sha224: "cryptojs",
      sha256: "cryptojs",
      sha384: "cryptojs",
      sha512: "cryptojs",
      ripemd160: "cryptojs",
      hmacmd5: "cryptojs",
      hmacsha1: "cryptojs",
      hmacsha224: "cryptojs",
      hmacsha256: "cryptojs",
      hmacsha384: "cryptojs",
      hmacsha512: "cryptojs",
      hmacripemd160: "cryptojs",
      MD5withRSA: "cryptojs/jsrsa",
      SHA1withRSA: "cryptojs/jsrsa",
      SHA224withRSA: "cryptojs/jsrsa",
      SHA256withRSA: "cryptojs/jsrsa",
      SHA384withRSA: "cryptojs/jsrsa",
      SHA512withRSA: "cryptojs/jsrsa",
      RIPEMD160withRSA: "cryptojs/jsrsa",
      MD5withECDSA: "cryptojs/jsrsa",
      SHA1withECDSA: "cryptojs/jsrsa",
      SHA224withECDSA: "cryptojs/jsrsa",
      SHA256withECDSA: "cryptojs/jsrsa",
      SHA384withECDSA: "cryptojs/jsrsa",
      SHA512withECDSA: "cryptojs/jsrsa",
      RIPEMD160withECDSA: "cryptojs/jsrsa",
      SHA1withDSA: "cryptojs/jsrsa",
      SHA224withDSA: "cryptojs/jsrsa",
      SHA256withDSA: "cryptojs/jsrsa",
      MD5withRSAandMGF1: "cryptojs/jsrsa",
      SHA1withRSAandMGF1: "cryptojs/jsrsa",
      SHA224withRSAandMGF1: "cryptojs/jsrsa",
      SHA256withRSAandMGF1: "cryptojs/jsrsa",
      SHA384withRSAandMGF1: "cryptojs/jsrsa",
      SHA512withRSAandMGF1: "cryptojs/jsrsa",
      RIPEMD160withRSAandMGF1: "cryptojs/jsrsa"
    };
    this.CRYPTOJSMESSAGEDIGESTNAME = {
      md5: "CryptoJS.algo.MD5",
      sha1: "CryptoJS.algo.SHA1",
      sha224: "CryptoJS.algo.SHA224",
      sha256: "CryptoJS.algo.SHA256",
      sha384: "CryptoJS.algo.SHA384",
      sha512: "CryptoJS.algo.SHA512",
      ripemd160: "CryptoJS.algo.RIPEMD160"
    };
    this.getDigestInfoHex = function(a, b) {
      if (typeof this.DIGESTINFOHEAD[b] == "undefined") {
        throw "alg not supported in Util.DIGESTINFOHEAD: " + b;
      }
      return this.DIGESTINFOHEAD[b] + a;
    };
    this.getPaddedDigestInfoHex = function(h, a, j) {
      var c = this.getDigestInfoHex(h, a);
      var d = j / 4;
      if (c.length + 22 > d) {
        throw "key is too short for SigAlg: keylen=" + j + "," + a;
      }
      var b = "0001";
      var k = "00" + c;
      var g = "";
      var l = d - b.length - k.length;
      for (var f = 0; f < l; f += 2) {
        g += "ff";
      }
      var e = b + g + k;
      return e;
    };
    this.hashString = function(a, c) {
      var b = new KJUR.crypto.MessageDigest({alg: c});
      return b.digestString(a);
    };
    this.hashHex = function(b, c) {
      var a = new KJUR.crypto.MessageDigest({alg: c});
      return a.digestHex(b);
    };
    this.sha1 = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "sha1",
        prov: "cryptojs"
      });
      return b.digestString(a);
    };
    this.sha256 = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "sha256",
        prov: "cryptojs"
      });
      return b.digestString(a);
    };
    this.sha256Hex = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "sha256",
        prov: "cryptojs"
      });
      return b.digestHex(a);
    };
    this.sha512 = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "sha512",
        prov: "cryptojs"
      });
      return b.digestString(a);
    };
    this.sha512Hex = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "sha512",
        prov: "cryptojs"
      });
      return b.digestHex(a);
    };
    this.md5 = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "md5",
        prov: "cryptojs"
      });
      return b.digestString(a);
    };
    this.ripemd160 = function(a) {
      var b = new KJUR.crypto.MessageDigest({
        alg: "ripemd160",
        prov: "cryptojs"
      });
      return b.digestString(a);
    };
    this.getCryptoJSMDByName = function(a) {};
  };
  KJUR.crypto.MessageDigest = function(params) {
    var md = null;
    var algName = null;
    var provName = null;
    this.setAlgAndProvider = function(alg, prov) {
      if (alg != null && prov === undefined) {
        prov = KJUR.crypto.Util.DEFAULTPROVIDER[alg];
      }
      if (":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(alg) != -1 && prov == "cryptojs") {
        try {
          this.md = eval(KJUR.crypto.Util.CRYPTOJSMESSAGEDIGESTNAME[alg]).create();
        } catch (ex) {
          throw "setAlgAndProvider hash alg set fail alg=" + alg + "/" + ex;
        }
        this.updateString = function(str) {
          this.md.update(str);
        };
        this.updateHex = function(hex) {
          var wHex = CryptoJS.enc.Hex.parse(hex);
          this.md.update(wHex);
        };
        this.digest = function() {
          var hash = this.md.finalize();
          return hash.toString(CryptoJS.enc.Hex);
        };
        this.digestString = function(str) {
          this.updateString(str);
          return this.digest();
        };
        this.digestHex = function(hex) {
          this.updateHex(hex);
          return this.digest();
        };
      }
      if (":sha256:".indexOf(alg) != -1 && prov == "sjcl") {
        try {
          this.md = new sjcl.hash.sha256();
        } catch (ex) {
          throw "setAlgAndProvider hash alg set fail alg=" + alg + "/" + ex;
        }
        this.updateString = function(str) {
          this.md.update(str);
        };
        this.updateHex = function(hex) {
          var baHex = sjcl.codec.hex.toBits(hex);
          this.md.update(baHex);
        };
        this.digest = function() {
          var hash = this.md.finalize();
          return sjcl.codec.hex.fromBits(hash);
        };
        this.digestString = function(str) {
          this.updateString(str);
          return this.digest();
        };
        this.digestHex = function(hex) {
          this.updateHex(hex);
          return this.digest();
        };
      }
    };
    this.updateString = function(str) {
      throw "updateString(str) not supported for this alg/prov: " + this.algName + "/" + this.provName;
    };
    this.updateHex = function(hex) {
      throw "updateHex(hex) not supported for this alg/prov: " + this.algName + "/" + this.provName;
    };
    this.digest = function() {
      throw "digest() not supported for this alg/prov: " + this.algName + "/" + this.provName;
    };
    this.digestString = function(str) {
      throw "digestString(str) not supported for this alg/prov: " + this.algName + "/" + this.provName;
    };
    this.digestHex = function(hex) {
      throw "digestHex(hex) not supported for this alg/prov: " + this.algName + "/" + this.provName;
    };
    if (params !== undefined) {
      if (params.alg !== undefined) {
        this.algName = params.alg;
        if (params.prov === undefined) {
          this.provName = KJUR.crypto.Util.DEFAULTPROVIDER[this.algName];
        }
        this.setAlgAndProvider(this.algName, this.provName);
      }
    }
  };
  KJUR.crypto.Mac = function(params) {
    var mac = null;
    var pass = null;
    var algName = null;
    var provName = null;
    var algProv = null;
    this.setAlgAndProvider = function(alg, prov) {
      if (alg == null) {
        alg = "hmacsha1";
      }
      alg = alg.toLowerCase();
      if (alg.substr(0, 4) != "hmac") {
        throw "setAlgAndProvider unsupported HMAC alg: " + alg;
      }
      if (prov === undefined) {
        prov = KJUR.crypto.Util.DEFAULTPROVIDER[alg];
      }
      this.algProv = alg + "/" + prov;
      var hashAlg = alg.substr(4);
      if (":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(hashAlg) != -1 && prov == "cryptojs") {
        try {
          var mdObj = eval(KJUR.crypto.Util.CRYPTOJSMESSAGEDIGESTNAME[hashAlg]);
          this.mac = CryptoJS.algo.HMAC.create(mdObj, this.pass);
        } catch (ex) {
          throw "setAlgAndProvider hash alg set fail hashAlg=" + hashAlg + "/" + ex;
        }
        this.updateString = function(str) {
          this.mac.update(str);
        };
        this.updateHex = function(hex) {
          var wHex = CryptoJS.enc.Hex.parse(hex);
          this.mac.update(wHex);
        };
        this.doFinal = function() {
          var hash = this.mac.finalize();
          return hash.toString(CryptoJS.enc.Hex);
        };
        this.doFinalString = function(str) {
          this.updateString(str);
          return this.doFinal();
        };
        this.doFinalHex = function(hex) {
          this.updateHex(hex);
          return this.doFinal();
        };
      }
    };
    this.updateString = function(str) {
      throw "updateString(str) not supported for this alg/prov: " + this.algProv;
    };
    this.updateHex = function(hex) {
      throw "updateHex(hex) not supported for this alg/prov: " + this.algProv;
    };
    this.doFinal = function() {
      throw "digest() not supported for this alg/prov: " + this.algProv;
    };
    this.doFinalString = function(str) {
      throw "digestString(str) not supported for this alg/prov: " + this.algProv;
    };
    this.doFinalHex = function(hex) {
      throw "digestHex(hex) not supported for this alg/prov: " + this.algProv;
    };
    this.setPassword = function(pass) {
      if (typeof pass == "string") {
        var hPass = pass;
        if (pass.length % 2 == 1 || !pass.match(/^[0-9A-Fa-f]+$/)) {
          hPass = rstrtohex(pass);
        }
        this.pass = CryptoJS.enc.Hex.parse(hPass);
        return;
      }
      if (typeof pass != "object") {
        throw "KJUR.crypto.Mac unsupported password type: " + pass;
      }
      var hPass = null;
      if (pass.hex !== undefined) {
        if (pass.hex.length % 2 != 0 || !pass.hex.match(/^[0-9A-Fa-f]+$/)) {
          throw "Mac: wrong hex password: " + pass.hex;
        }
        hPass = pass.hex;
      }
      if (pass.utf8 !== undefined) {
        hPass = utf8tohex(pass.utf8);
      }
      if (pass.rstr !== undefined) {
        hPass = rstrtohex(pass.rstr);
      }
      if (pass.b64 !== undefined) {
        hPass = b64tohex(pass.b64);
      }
      if (pass.b64u !== undefined) {
        hPass = b64utohex(pass.b64u);
      }
      if (hPass == null) {
        throw "KJUR.crypto.Mac unsupported password type: " + pass;
      }
      this.pass = CryptoJS.enc.Hex.parse(hPass);
    };
    if (params !== undefined) {
      if (params.pass !== undefined) {
        this.setPassword(params.pass);
      }
      if (params.alg !== undefined) {
        this.algName = params.alg;
        if (params.prov === undefined) {
          this.provName = KJUR.crypto.Util.DEFAULTPROVIDER[this.algName];
        }
        this.setAlgAndProvider(this.algName, this.provName);
      }
    }
  };
  KJUR.crypto.Signature = function(o) {
    var q = null;
    var n = null;
    var r = null;
    var c = null;
    var l = null;
    var d = null;
    var k = null;
    var h = null;
    var p = null;
    var e = null;
    var b = -1;
    var g = null;
    var j = null;
    var a = null;
    var i = null;
    var f = null;
    this._setAlgNames = function() {
      if (this.algName.match(/^(.+)with(.+)$/)) {
        this.mdAlgName = RegExp.$1.toLowerCase();
        this.pubkeyAlgName = RegExp.$2.toLowerCase();
      }
    };
    this._zeroPaddingOfSignature = function(x, w) {
      var v = "";
      var t = w / 4 - x.length;
      for (var u = 0; u < t; u++) {
        v = v + "0";
      }
      return v + x;
    };
    this.setAlgAndProvider = function(u, t) {
      this._setAlgNames();
      if (t != "cryptojs/jsrsa") {
        throw "provider not supported: " + t;
      }
      if (":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(this.mdAlgName) != -1) {
        try {
          this.md = new KJUR.crypto.MessageDigest({alg: this.mdAlgName});
        } catch (s) {
          throw "setAlgAndProvider hash alg set fail alg=" + this.mdAlgName + "/" + s;
        }
        this.init = function(w, x) {
          var y = null;
          try {
            if (x === undefined) {
              y = KEYUTIL.getKey(w);
            } else {
              y = KEYUTIL.getKey(w, x);
            }
          } catch (v) {
            throw "init failed:" + v;
          }
          if (y.isPrivate === true) {
            this.prvKey = y;
            this.state = "SIGN";
          } else {
            if (y.isPublic === true) {
              this.pubKey = y;
              this.state = "VERIFY";
            } else {
              throw "init failed.:" + y;
            }
          }
        };
        this.initSign = function(v) {
          if (typeof v.ecprvhex == "string" && typeof v.eccurvename == "string") {
            this.ecprvhex = v.ecprvhex;
            this.eccurvename = v.eccurvename;
          } else {
            this.prvKey = v;
          }
          this.state = "SIGN";
        };
        this.initVerifyByPublicKey = function(v) {
          if (typeof v.ecpubhex == "string" && typeof v.eccurvename == "string") {
            this.ecpubhex = v.ecpubhex;
            this.eccurvename = v.eccurvename;
          } else {
            if (v instanceof KJUR.crypto.ECDSA) {
              this.pubKey = v;
            } else {
              if (v instanceof RSAKey) {
                this.pubKey = v;
              }
            }
          }
          this.state = "VERIFY";
        };
        this.initVerifyByCertificatePEM = function(v) {
          var w = new X509();
          w.readCertPEM(v);
          this.pubKey = w.subjectPublicKeyRSA;
          this.state = "VERIFY";
        };
        this.updateString = function(v) {
          this.md.updateString(v);
        };
        this.updateHex = function(v) {
          this.md.updateHex(v);
        };
        this.sign = function() {
          this.sHashHex = this.md.digest();
          if (typeof this.ecprvhex != "undefined" && typeof this.eccurvename != "undefined") {
            var v = new KJUR.crypto.ECDSA({curve: this.eccurvename});
            this.hSign = v.signHex(this.sHashHex, this.ecprvhex);
          } else {
            if (this.prvKey instanceof RSAKey && this.pubkeyAlgName == "rsaandmgf1") {
              this.hSign = this.prvKey.signWithMessageHashPSS(this.sHashHex, this.mdAlgName, this.pssSaltLen);
            } else {
              if (this.prvKey instanceof RSAKey && this.pubkeyAlgName == "rsa") {
                this.hSign = this.prvKey.signWithMessageHash(this.sHashHex, this.mdAlgName);
              } else {
                if (this.prvKey instanceof KJUR.crypto.ECDSA) {
                  this.hSign = this.prvKey.signWithMessageHash(this.sHashHex);
                } else {
                  if (this.prvKey instanceof KJUR.crypto.DSA) {
                    this.hSign = this.prvKey.signWithMessageHash(this.sHashHex);
                  } else {
                    throw "Signature: unsupported public key alg: " + this.pubkeyAlgName;
                  }
                }
              }
            }
          }
          return this.hSign;
        };
        this.signString = function(v) {
          this.updateString(v);
          return this.sign();
        };
        this.signHex = function(v) {
          this.updateHex(v);
          return this.sign();
        };
        this.verify = function(v) {
          this.sHashHex = this.md.digest();
          if (typeof this.ecpubhex != "undefined" && typeof this.eccurvename != "undefined") {
            var w = new KJUR.crypto.ECDSA({curve: this.eccurvename});
            return w.verifyHex(this.sHashHex, v, this.ecpubhex);
          } else {
            if (this.pubKey instanceof RSAKey && this.pubkeyAlgName == "rsaandmgf1") {
              return this.pubKey.verifyWithMessageHashPSS(this.sHashHex, v, this.mdAlgName, this.pssSaltLen);
            } else {
              if (this.pubKey instanceof RSAKey && this.pubkeyAlgName == "rsa") {
                return this.pubKey.verifyWithMessageHash(this.sHashHex, v);
              } else {
                if (this.pubKey instanceof KJUR.crypto.ECDSA) {
                  return this.pubKey.verifyWithMessageHash(this.sHashHex, v);
                } else {
                  if (this.pubKey instanceof KJUR.crypto.DSA) {
                    return this.pubKey.verifyWithMessageHash(this.sHashHex, v);
                  } else {
                    throw "Signature: unsupported public key alg: " + this.pubkeyAlgName;
                  }
                }
              }
            }
          }
        };
      }
    };
    this.init = function(s, t) {
      throw "init(key, pass) not supported for this alg:prov=" + this.algProvName;
    };
    this.initVerifyByPublicKey = function(s) {
      throw "initVerifyByPublicKey(rsaPubKeyy) not supported for this alg:prov=" + this.algProvName;
    };
    this.initVerifyByCertificatePEM = function(s) {
      throw "initVerifyByCertificatePEM(certPEM) not supported for this alg:prov=" + this.algProvName;
    };
    this.initSign = function(s) {
      throw "initSign(prvKey) not supported for this alg:prov=" + this.algProvName;
    };
    this.updateString = function(s) {
      throw "updateString(str) not supported for this alg:prov=" + this.algProvName;
    };
    this.updateHex = function(s) {
      throw "updateHex(hex) not supported for this alg:prov=" + this.algProvName;
    };
    this.sign = function() {
      throw "sign() not supported for this alg:prov=" + this.algProvName;
    };
    this.signString = function(s) {
      throw "digestString(str) not supported for this alg:prov=" + this.algProvName;
    };
    this.signHex = function(s) {
      throw "digestHex(hex) not supported for this alg:prov=" + this.algProvName;
    };
    this.verify = function(s) {
      throw "verify(hSigVal) not supported for this alg:prov=" + this.algProvName;
    };
    this.initParams = o;
    if (o !== undefined) {
      if (o.alg !== undefined) {
        this.algName = o.alg;
        if (o.prov === undefined) {
          this.provName = KJUR.crypto.Util.DEFAULTPROVIDER[this.algName];
        } else {
          this.provName = o.prov;
        }
        this.algProvName = this.algName + ":" + this.provName;
        this.setAlgAndProvider(this.algName, this.provName);
        this._setAlgNames();
      }
      if (o.psssaltlen !== undefined) {
        this.pssSaltLen = o.psssaltlen;
      }
      if (o.prvkeypem !== undefined) {
        if (o.prvkeypas !== undefined) {
          throw "both prvkeypem and prvkeypas parameters not supported";
        } else {
          try {
            var q = new RSAKey();
            q.readPrivateKeyFromPEMString(o.prvkeypem);
            this.initSign(q);
          } catch (m) {
            throw "fatal error to load pem private key: " + m;
          }
        }
      }
    }
  };
  KJUR.crypto.OID = new function() {
    this.oidhex2name = {
      "2a864886f70d010101": "rsaEncryption",
      "2a8648ce3d0201": "ecPublicKey",
      "2a8648ce380401": "dsa",
      "2a8648ce3d030107": "secp256r1",
      "2b8104001f": "secp192k1",
      "2b81040021": "secp224r1",
      "2b8104000a": "secp256k1",
      "2b81040023": "secp521r1",
      "2b81040022": "secp384r1",
      "2a8648ce380403": "SHA1withDSA",
      "608648016503040301": "SHA224withDSA",
      "608648016503040302": "SHA256withDSA"
    };
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.crypto == "undefined" || !KJUR.crypto) {
    KJUR.crypto = {};
  }
  KJUR.crypto.ECDSA = function(h) {
    var e = "secp256r1";
    var g = null;
    var b = null;
    var f = null;
    var a = new SecureRandom();
    var d = null;
    this.type = "EC";
    function c(s, o, r, n) {
      var j = Math.max(o.bitLength(), n.bitLength());
      var t = s.add2D(r);
      var q = s.curve.getInfinity();
      for (var p = j - 1; p >= 0; --p) {
        q = q.twice2D();
        q.z = BigInteger.ONE;
        if (o.testBit(p)) {
          if (n.testBit(p)) {
            q = q.add2D(t);
          } else {
            q = q.add2D(s);
          }
        } else {
          if (n.testBit(p)) {
            q = q.add2D(r);
          }
        }
      }
      return q;
    }
    this.getBigRandom = function(i) {
      return new BigInteger(i.bitLength(), a).mod(i.subtract(BigInteger.ONE)).add(BigInteger.ONE);
    };
    this.setNamedCurve = function(i) {
      this.ecparams = KJUR.crypto.ECParameterDB.getByName(i);
      this.prvKeyHex = null;
      this.pubKeyHex = null;
      this.curveName = i;
    };
    this.setPrivateKeyHex = function(i) {
      this.isPrivate = true;
      this.prvKeyHex = i;
    };
    this.setPublicKeyHex = function(i) {
      this.isPublic = true;
      this.pubKeyHex = i;
    };
    this.generateKeyPairHex = function() {
      var k = this.ecparams.n;
      var n = this.getBigRandom(k);
      var l = this.ecparams.G.multiply(n);
      var q = l.getX().toBigInteger();
      var o = l.getY().toBigInteger();
      var i = this.ecparams.keylen / 4;
      var m = ("0000000000" + n.toString(16)).slice(-i);
      var r = ("0000000000" + q.toString(16)).slice(-i);
      var p = ("0000000000" + o.toString(16)).slice(-i);
      var j = "04" + r + p;
      this.setPrivateKeyHex(m);
      this.setPublicKeyHex(j);
      return {
        ecprvhex: m,
        ecpubhex: j
      };
    };
    this.signWithMessageHash = function(i) {
      return this.signHex(i, this.prvKeyHex);
    };
    this.signHex = function(o, j) {
      var t = new BigInteger(j, 16);
      var l = this.ecparams.n;
      var q = new BigInteger(o, 16);
      do {
        var m = this.getBigRandom(l);
        var u = this.ecparams.G;
        var p = u.multiply(m);
        var i = p.getX().toBigInteger().mod(l);
      } while (i.compareTo(BigInteger.ZERO) <= 0);
      var v = m.modInverse(l).multiply(q.add(t.multiply(i))).mod(l);
      return KJUR.crypto.ECDSA.biRSSigToASN1Sig(i, v);
    };
    this.sign = function(m, u) {
      var q = u;
      var j = this.ecparams.n;
      var p = BigInteger.fromByteArrayUnsigned(m);
      do {
        var l = this.getBigRandom(j);
        var t = this.ecparams.G;
        var o = t.multiply(l);
        var i = o.getX().toBigInteger().mod(j);
      } while (i.compareTo(BigInteger.ZERO) <= 0);
      var v = l.modInverse(j).multiply(p.add(q.multiply(i))).mod(j);
      return this.serializeSig(i, v);
    };
    this.verifyWithMessageHash = function(j, i) {
      return this.verifyHex(j, i, this.pubKeyHex);
    };
    this.verifyHex = function(m, i, p) {
      var l,
          j;
      var o = KJUR.crypto.ECDSA.parseSigHex(i);
      l = o.r;
      j = o.s;
      var k;
      k = ECPointFp.decodeFromHex(this.ecparams.curve, p);
      var n = new BigInteger(m, 16);
      return this.verifyRaw(n, l, j, k);
    };
    this.verify = function(o, p, j) {
      var l,
          i;
      if (Bitcoin.Util.isArray(p)) {
        var n = this.parseSig(p);
        l = n.r;
        i = n.s;
      } else {
        if ("object" === typeof p && p.r && p.s) {
          l = p.r;
          i = p.s;
        } else {
          throw "Invalid value for signature";
        }
      }
      var k;
      if (j instanceof ECPointFp) {
        k = j;
      } else {
        if (Bitcoin.Util.isArray(j)) {
          k = ECPointFp.decodeFrom(this.ecparams.curve, j);
        } else {
          throw "Invalid format for pubkey value, must be byte array or ECPointFp";
        }
      }
      var m = BigInteger.fromByteArrayUnsigned(o);
      return this.verifyRaw(m, l, i, k);
    };
    this.verifyRaw = function(o, i, w, m) {
      var l = this.ecparams.n;
      var u = this.ecparams.G;
      if (i.compareTo(BigInteger.ONE) < 0 || i.compareTo(l) >= 0) {
        return false;
      }
      if (w.compareTo(BigInteger.ONE) < 0 || w.compareTo(l) >= 0) {
        return false;
      }
      var p = w.modInverse(l);
      var k = o.multiply(p).mod(l);
      var j = i.multiply(p).mod(l);
      var q = u.multiply(k).add(m.multiply(j));
      var t = q.getX().toBigInteger().mod(l);
      return t.equals(i);
    };
    this.serializeSig = function(k, j) {
      var l = k.toByteArraySigned();
      var i = j.toByteArraySigned();
      var m = [];
      m.push(2);
      m.push(l.length);
      m = m.concat(l);
      m.push(2);
      m.push(i.length);
      m = m.concat(i);
      m.unshift(m.length);
      m.unshift(48);
      return m;
    };
    this.parseSig = function(n) {
      var m;
      if (n[0] != 48) {
        throw new Error("Signature not a valid DERSequence");
      }
      m = 2;
      if (n[m] != 2) {
        throw new Error("First element in signature must be a DERInteger");
      }
      var l = n.slice(m + 2, m + 2 + n[m + 1]);
      m += 2 + n[m + 1];
      if (n[m] != 2) {
        throw new Error("Second element in signature must be a DERInteger");
      }
      var i = n.slice(m + 2, m + 2 + n[m + 1]);
      m += 2 + n[m + 1];
      var k = BigInteger.fromByteArrayUnsigned(l);
      var j = BigInteger.fromByteArrayUnsigned(i);
      return {
        r: k,
        s: j
      };
    };
    this.parseSigCompact = function(m) {
      if (m.length !== 65) {
        throw "Signature has the wrong length";
      }
      var j = m[0] - 27;
      if (j < 0 || j > 7) {
        throw "Invalid signature type";
      }
      var o = this.ecparams.n;
      var l = BigInteger.fromByteArrayUnsigned(m.slice(1, 33)).mod(o);
      var k = BigInteger.fromByteArrayUnsigned(m.slice(33, 65)).mod(o);
      return {
        r: l,
        s: k,
        i: j
      };
    };
    if (h !== undefined) {
      if (h.curve !== undefined) {
        this.curveName = h.curve;
      }
    }
    if (this.curveName === undefined) {
      this.curveName = e;
    }
    this.setNamedCurve(this.curveName);
    if (h !== undefined) {
      if (h.prv !== undefined) {
        this.setPrivateKeyHex(h.prv);
      }
      if (h.pub !== undefined) {
        this.setPublicKeyHex(h.pub);
      }
    }
  };
  KJUR.crypto.ECDSA.parseSigHex = function(a) {
    var b = KJUR.crypto.ECDSA.parseSigHexInHexRS(a);
    var d = new BigInteger(b.r, 16);
    var c = new BigInteger(b.s, 16);
    return {
      r: d,
      s: c
    };
  };
  KJUR.crypto.ECDSA.parseSigHexInHexRS = function(c) {
    if (c.substr(0, 2) != "30") {
      throw "signature is not a ASN.1 sequence";
    }
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(c, 0);
    if (b.length != 2) {
      throw "number of signature ASN.1 sequence elements seem wrong";
    }
    var g = b[0];
    var f = b[1];
    if (c.substr(g, 2) != "02") {
      throw "1st item of sequene of signature is not ASN.1 integer";
    }
    if (c.substr(f, 2) != "02") {
      throw "2nd item of sequene of signature is not ASN.1 integer";
    }
    var e = ASN1HEX.getHexOfV_AtObj(c, g);
    var d = ASN1HEX.getHexOfV_AtObj(c, f);
    return {
      r: e,
      s: d
    };
  };
  KJUR.crypto.ECDSA.asn1SigToConcatSig = function(c) {
    var d = KJUR.crypto.ECDSA.parseSigHexInHexRS(c);
    var b = d.r;
    var a = d.s;
    if (b.substr(0, 2) == "00" && (((b.length / 2) * 8) % (16 * 8)) == 8) {
      b = b.substr(2);
    }
    if (a.substr(0, 2) == "00" && (((a.length / 2) * 8) % (16 * 8)) == 8) {
      a = a.substr(2);
    }
    if ((((b.length / 2) * 8) % (16 * 8)) != 0) {
      throw "unknown ECDSA sig r length error";
    }
    if ((((a.length / 2) * 8) % (16 * 8)) != 0) {
      throw "unknown ECDSA sig s length error";
    }
    return b + a;
  };
  KJUR.crypto.ECDSA.concatSigToASN1Sig = function(a) {
    if ((((a.length / 2) * 8) % (16 * 8)) != 0) {
      throw "unknown ECDSA concatinated r-s sig  length error";
    }
    var c = a.substr(0, a.length / 2);
    var b = a.substr(a.length / 2);
    return KJUR.crypto.ECDSA.hexRSSigToASN1Sig(c, b);
  };
  KJUR.crypto.ECDSA.hexRSSigToASN1Sig = function(b, a) {
    var d = new BigInteger(b, 16);
    var c = new BigInteger(a, 16);
    return KJUR.crypto.ECDSA.biRSSigToASN1Sig(d, c);
  };
  KJUR.crypto.ECDSA.biRSSigToASN1Sig = function(e, c) {
    var b = new KJUR.asn1.DERInteger({bigint: e});
    var a = new KJUR.asn1.DERInteger({bigint: c});
    var d = new KJUR.asn1.DERSequence({array: [b, a]});
    return d.getEncodedHex();
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.crypto == "undefined" || !KJUR.crypto) {
    KJUR.crypto = {};
  }
  KJUR.crypto.ECParameterDB = new function() {
    var b = {};
    var c = {};
    function a(d) {
      return new BigInteger(d, 16);
    }
    this.getByName = function(e) {
      var d = e;
      if (typeof c[d] != "undefined") {
        d = c[e];
      }
      if (typeof b[d] != "undefined") {
        return b[d];
      }
      throw "unregistered EC curve name: " + d;
    };
    this.regist = function(A, l, o, g, m, e, j, f, k, u, d, x) {
      b[A] = {};
      var s = a(o);
      var z = a(g);
      var y = a(m);
      var t = a(e);
      var w = a(j);
      var r = new ECCurveFp(s, z, y);
      var q = r.decodePointHex("04" + f + k);
      b[A]["name"] = A;
      b[A]["keylen"] = l;
      b[A]["curve"] = r;
      b[A]["G"] = q;
      b[A]["n"] = t;
      b[A]["h"] = w;
      b[A]["oid"] = d;
      b[A]["info"] = x;
      for (var v = 0; v < u.length; v++) {
        c[u[v]] = A;
      }
    };
  };
  KJUR.crypto.ECParameterDB.regist("secp128r1", 128, "FFFFFFFDFFFFFFFFFFFFFFFFFFFFFFFF", "FFFFFFFDFFFFFFFFFFFFFFFFFFFFFFFC", "E87579C11079F43DD824993C2CEE5ED3", "FFFFFFFE0000000075A30D1B9038A115", "1", "161FF7528B899B2D0C28607CA52C5B86", "CF5AC8395BAFEB13C02DA292DDED7A83", [], "", "secp128r1 : SECG curve over a 128 bit prime field");
  KJUR.crypto.ECParameterDB.regist("secp160k1", 160, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFAC73", "0", "7", "0100000000000000000001B8FA16DFAB9ACA16B6B3", "1", "3B4C382CE37AA192A4019E763036F4F5DD4D7EBB", "938CF935318FDCED6BC28286531733C3F03C4FEE", [], "", "secp160k1 : SECG curve over a 160 bit prime field");
  KJUR.crypto.ECParameterDB.regist("secp160r1", 160, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFC", "1C97BEFC54BD7A8B65ACF89F81D4D4ADC565FA45", "0100000000000000000001F4C8F927AED3CA752257", "1", "4A96B5688EF573284664698968C38BB913CBFC82", "23A628553168947D59DCC912042351377AC5FB32", [], "", "secp160r1 : SECG curve over a 160 bit prime field");
  KJUR.crypto.ECParameterDB.regist("secp192k1", 192, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFEE37", "0", "3", "FFFFFFFFFFFFFFFFFFFFFFFE26F2FC170F69466A74DEFD8D", "1", "DB4FF10EC057E9AE26B07D0280B7F4341DA5D1B1EAE06C7D", "9B2F2F6D9C5628A7844163D015BE86344082AA88D95E2F9D", []);
  KJUR.crypto.ECParameterDB.regist("secp192r1", 192, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFC", "64210519E59C80E70FA7E9AB72243049FEB8DEECC146B9B1", "FFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831", "1", "188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012", "07192B95FFC8DA78631011ED6B24CDD573F977A11E794811", []);
  KJUR.crypto.ECParameterDB.regist("secp224r1", 224, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000000000000000001", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFE", "B4050A850C04B3ABF54132565044B0B7D7BFD8BA270B39432355FFB4", "FFFFFFFFFFFFFFFFFFFFFFFFFFFF16A2E0B8F03E13DD29455C5C2A3D", "1", "B70E0CBD6BB4BF7F321390B94A03C1D356C21122343280D6115C1D21", "BD376388B5F723FB4C22DFE6CD4375A05A07476444D5819985007E34", []);
  KJUR.crypto.ECParameterDB.regist("secp256k1", 256, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", "0", "7", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", "1", "79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", "483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", []);
  KJUR.crypto.ECParameterDB.regist("secp256r1", 256, "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF", "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC", "5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B", "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", "1", "6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296", "4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5", ["NIST P-256", "P-256", "prime256v1"]);
  KJUR.crypto.ECParameterDB.regist("secp384r1", 384, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFC", "B3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973", "1", "AA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7", "3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f", ["NIST P-384", "P-384"]);
  KJUR.crypto.ECParameterDB.regist("secp521r1", 521, "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC", "051953EB9618E1C9A1F929A21A0B68540EEA2DA725B99B315F3B8B489918EF109E156193951EC7E937B1652C0BD3BB1BF073573DF883D2C34F1EF451FD46B503F00", "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409", "1", "C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66", "011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650", ["NIST P-521", "P-521"]);
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.crypto == "undefined" || !KJUR.crypto) {
    KJUR.crypto = {};
  }
  KJUR.crypto.DSA = function() {
    this.p = null;
    this.q = null;
    this.g = null;
    this.y = null;
    this.x = null;
    this.type = "DSA";
    this.setPrivate = function(z, w, v, A, u) {
      this.isPrivate = true;
      this.p = z;
      this.q = w;
      this.g = v;
      this.y = A;
      this.x = u;
    };
    this.setPublic = function(w, v, u, z) {
      this.isPublic = true;
      this.p = w;
      this.q = v;
      this.g = u;
      this.y = z;
      this.x = null;
    };
    this.signWithMessageHash = function(z) {
      var v = this.p;
      var u = this.q;
      var C = this.g;
      var D = this.y;
      var E = this.x;
      var A = z.substr(0, u.bitLength() / 4);
      var B = new BigInteger(z, 16);
      var w = n(BigInteger.ONE.add(BigInteger.ONE), u.subtract(BigInteger.ONE));
      var G = (C.modPow(w, v)).mod(u);
      var F = (w.modInverse(u).multiply(B.add(E.multiply(G)))).mod(u);
      var H = KJUR.asn1.ASN1Util.jsonToASN1HEX({seq: [{"int": {bigint: G}}, {"int": {bigint: F}}]});
      return H;
    };
    this.verifyWithMessageHash = function(C, B) {
      var z = this.p;
      var u = this.q;
      var G = this.g;
      var H = this.y;
      var E = this.parseASN1Signature(B);
      var K = E[0];
      var J = E[1];
      var C = C.substr(0, u.bitLength() / 4);
      var D = new BigInteger(C, 16);
      if (BigInteger.ZERO.compareTo(K) > 0 || K.compareTo(u) > 0 || BigInteger.ZERO.compareTo(J) > 0 || J.compareTo(u) > 0) {
        throw "invalid DSA signature";
      }
      var I = J.modInverse(u);
      var A = D.multiply(I).mod(u);
      var v = K.multiply(I).mod(u);
      var F = G.modPow(A, z).multiply(H.modPow(v, z)).mod(z).mod(u);
      return F.compareTo(K) == 0;
    };
    this.parseASN1Signature = function(u) {
      try {
        var y = new BigInteger(ASN1HEX.getVbyList(u, 0, [0], "02"), 16);
        var v = new BigInteger(ASN1HEX.getVbyList(u, 0, [1], "02"), 16);
        return [y, v];
      } catch (w) {
        throw "malformed DSA signature";
      }
    };
    function d(E, w, B, v, u, C) {
      var z = KJUR.crypto.Util.hashString(w, E.toLowerCase());
      var z = z.substr(0, u.bitLength() / 4);
      var A = new BigInteger(z, 16);
      var y = n(BigInteger.ONE.add(BigInteger.ONE), u.subtract(BigInteger.ONE));
      var F = (B.modPow(y, v)).mod(u);
      var D = (y.modInverse(u).multiply(A.add(C.multiply(F)))).mod(u);
      var G = new Array();
      G[0] = F;
      G[1] = D;
      return G;
    }
    function r(v) {
      var u = openpgp.config.config.prefer_hash_algorithm;
      switch (Math.round(v.bitLength() / 8)) {
        case 20:
          if (u != 2 && u > 11 && u != 10 && u < 8) {
            return 2;
          }
          return u;
        case 28:
          if (u > 11 && u < 8) {
            return 11;
          }
          return u;
        case 32:
          if (u > 10 && u < 8) {
            return 8;
          }
          return u;
        default:
          util.print_debug("DSA select hash algorithm: returning null for an unknown length of q");
          return null;
      }
    }
    this.select_hash_algorithm = r;
    function m(I, K, J, B, z, u, F, G) {
      var C = KJUR.crypto.Util.hashString(B, I.toLowerCase());
      var C = C.substr(0, u.bitLength() / 4);
      var D = new BigInteger(C, 16);
      if (BigInteger.ZERO.compareTo(K) > 0 || K.compareTo(u) > 0 || BigInteger.ZERO.compareTo(J) > 0 || J.compareTo(u) > 0) {
        util.print_error("invalid DSA Signature");
        return null;
      }
      var H = J.modInverse(u);
      var A = D.multiply(H).mod(u);
      var v = K.multiply(H).mod(u);
      var E = F.modPow(A, z).multiply(G.modPow(v, z)).mod(z).mod(u);
      return E.compareTo(K) == 0;
    }
    function a(z) {
      var A = new BigInteger(z, primeCenterie);
      var y = j(q, 512);
      var u = t(p, q, z);
      var v;
      do {
        v = new BigInteger(q.bitCount(), rand);
      } while (x.compareTo(BigInteger.ZERO) != 1 && x.compareTo(q) != -1);
      var w = g.modPow(x, p);
      return {
        x: v,
        q: A,
        p: y,
        g: u,
        y: w
      };
    }
    function j(y, z, w) {
      if (z % 64 != 0) {
        return false;
      }
      var u;
      var v;
      do {
        u = w(bitcount, true);
        v = u.subtract(BigInteger.ONE);
        u = u.subtract(v.remainder(y));
      } while (!u.isProbablePrime(primeCenterie) || u.bitLength() != l);
      return u;
    }
    function t(B, z, A, w) {
      var u = B.subtract(BigInteger.ONE);
      var y = u.divide(z);
      var v;
      do {
        v = w(A);
      } while (v.compareTo(u) != -1 && v.compareTo(BigInteger.ONE) != 1);
      return v.modPow(y, B);
    }
    function o(w, y, u) {
      var v;
      do {
        v = u(y, false);
      } while (v.compareTo(w) != -1 && v.compareTo(BigInteger.ZERO) != 1);
      return v;
    }
    function i(v, w) {
      k = o(v);
      var u = g.modPow(k, w).mod(v);
      return u;
    }
    function h(B, w, y, v, z, u) {
      var A = B(v);
      s = (w.modInverse(z).multiply(A.add(u.multiply(y)))).mod(z);
      return s;
    }
    this.sign = d;
    this.verify = m;
    function n(w, u) {
      if (u.compareTo(w) <= 0) {
        return;
      }
      var v = u.subtract(w);
      var y = e(v.bitLength());
      while (y > v) {
        y = e(v.bitLength());
      }
      return w.add(y);
    }
    function e(w) {
      if (w < 0) {
        return null;
      }
      var u = Math.floor((w + 7) / 8);
      var v = c(u);
      if (w % 8 > 0) {
        v = String.fromCharCode((Math.pow(2, w % 8) - 1) & v.charCodeAt(0)) + v.substring(1);
      }
      return new BigInteger(f(v), 16);
    }
    function c(w) {
      var u = "";
      for (var v = 0; v < w; v++) {
        u += String.fromCharCode(b());
      }
      return u;
    }
    function b() {
      var u = new Uint32Array(1);
      window.crypto.getRandomValues(u);
      return u[0] & 255;
    }
    function f(y) {
      if (y == null) {
        return "";
      }
      var v = [];
      var w = y.length;
      var z = 0;
      var u;
      while (z < w) {
        u = y[z++].charCodeAt().toString(16);
        while (u.length < 2) {
          u = "0" + u;
        }
        v.push("" + u);
      }
      return v.join("");
    }
    this.getRandomBigIntegerInRange = n;
    this.getRandomBigInteger = e;
    this.getRandomBytes = c;
  };
  var PKCS5PKEY = function() {
    var c = function(n, p, o) {
      return i(CryptoJS.AES, n, p, o);
    };
    var d = function(n, p, o) {
      return i(CryptoJS.TripleDES, n, p, o);
    };
    var i = function(q, v, s, o) {
      var p = CryptoJS.enc.Hex.parse(v);
      var u = CryptoJS.enc.Hex.parse(s);
      var n = CryptoJS.enc.Hex.parse(o);
      var r = {};
      r.key = u;
      r.iv = n;
      r.ciphertext = p;
      var t = q.decrypt(r, u, {iv: n});
      return CryptoJS.enc.Hex.stringify(t);
    };
    var j = function(n, p, o) {
      return e(CryptoJS.AES, n, p, o);
    };
    var m = function(n, p, o) {
      return e(CryptoJS.TripleDES, n, p, o);
    };
    var e = function(s, x, v, p) {
      var r = CryptoJS.enc.Hex.parse(x);
      var w = CryptoJS.enc.Hex.parse(v);
      var o = CryptoJS.enc.Hex.parse(p);
      var n = {};
      var u = s.encrypt(r, w, {iv: o});
      var q = CryptoJS.enc.Hex.parse(u.toString());
      var t = CryptoJS.enc.Base64.stringify(q);
      return t;
    };
    var g = {
      "AES-256-CBC": {
        proc: c,
        eproc: j,
        keylen: 32,
        ivlen: 16
      },
      "AES-192-CBC": {
        proc: c,
        eproc: j,
        keylen: 24,
        ivlen: 16
      },
      "AES-128-CBC": {
        proc: c,
        eproc: j,
        keylen: 16,
        ivlen: 16
      },
      "DES-EDE3-CBC": {
        proc: d,
        eproc: m,
        keylen: 24,
        ivlen: 8
      }
    };
    var b = function(n) {
      return g[n]["proc"];
    };
    var k = function(n) {
      var p = CryptoJS.lib.WordArray.random(n);
      var o = CryptoJS.enc.Hex.stringify(p);
      return o;
    };
    var l = function(q) {
      var r = {};
      if (q.match(new RegExp("DEK-Info: ([^,]+),([0-9A-Fa-f]+)", "m"))) {
        r.cipher = RegExp.$1;
        r.ivsalt = RegExp.$2;
      }
      if (q.match(new RegExp("-----BEGIN ([A-Z]+) PRIVATE KEY-----"))) {
        r.type = RegExp.$1;
      }
      var p = -1;
      var t = 0;
      if (q.indexOf("\r\n\r\n") != -1) {
        p = q.indexOf("\r\n\r\n");
        t = 2;
      }
      if (q.indexOf("\n\n") != -1) {
        p = q.indexOf("\n\n");
        t = 1;
      }
      var o = q.indexOf("-----END");
      if (p != -1 && o != -1) {
        var n = q.substring(p + t * 2, o - t);
        n = n.replace(/\s+/g, "");
        r.data = n;
      }
      return r;
    };
    var h = function(o, w, n) {
      var t = n.substring(0, 16);
      var r = CryptoJS.enc.Hex.parse(t);
      var p = CryptoJS.enc.Utf8.parse(w);
      var s = g[o]["keylen"] + g[o]["ivlen"];
      var v = "";
      var u = null;
      for (; ; ) {
        var q = CryptoJS.algo.MD5.create();
        if (u != null) {
          q.update(u);
        }
        q.update(p);
        q.update(r);
        u = q.finalize();
        v = v + CryptoJS.enc.Hex.stringify(u);
        if (v.length >= s * 2) {
          break;
        }
      }
      var x = {};
      x.keyhex = v.substr(0, g[o]["keylen"] * 2);
      x.ivhex = v.substr(g[o]["keylen"] * 2, g[o]["ivlen"] * 2);
      return x;
    };
    var a = function(n, t, p, u) {
      var q = CryptoJS.enc.Base64.parse(n);
      var o = CryptoJS.enc.Hex.stringify(q);
      var s = g[t]["proc"];
      var r = s(o, p, u);
      return r;
    };
    var f = function(n, q, o, s) {
      var p = g[q]["eproc"];
      var r = p(n, o, s);
      return r;
    };
    return {
      version: "1.0.5",
      getHexFromPEM: function(o, r) {
        var p = o;
        if (p.indexOf("BEGIN " + r) == -1) {
          throw "can't find PEM header: " + r;
        }
        p = p.replace("-----BEGIN " + r + "-----", "");
        p = p.replace("-----END " + r + "-----", "");
        var q = p.replace(/\s+/g, "");
        var n = b64tohex(q);
        return n;
      },
      getDecryptedKeyHexByKeyIV: function(o, r, q, p) {
        var n = b(r);
        return n(o, q, p);
      },
      parsePKCS5PEM: function(n) {
        return l(n);
      },
      getKeyAndUnusedIvByPasscodeAndIvsalt: function(o, n, p) {
        return h(o, n, p);
      },
      decryptKeyB64: function(n, p, o, q) {
        return a(n, p, o, q);
      },
      getDecryptedKeyHex: function(w, v) {
        var o = l(w);
        var r = o.type;
        var p = o.cipher;
        var n = o.ivsalt;
        var q = o.data;
        var u = h(p, v, n);
        var t = u.keyhex;
        var s = a(q, p, t, n);
        return s;
      },
      getRSAKeyFromEncryptedPKCS5PEM: function(p, o) {
        var q = this.getDecryptedKeyHex(p, o);
        var n = new RSAKey();
        n.readPrivateKeyFromASN1HexString(q);
        return n;
      },
      getEryptedPKCS5PEMFromPrvKeyHex: function(q, x, r, p) {
        var n = "";
        if (typeof r == "undefined" || r == null) {
          r = "AES-256-CBC";
        }
        if (typeof g[r] == "undefined") {
          throw "PKCS5PKEY unsupported algorithm: " + r;
        }
        if (typeof p == "undefined" || p == null) {
          var t = g[r]["ivlen"];
          var s = k(t);
          p = s.toUpperCase();
        }
        var w = h(r, x, p);
        var v = w.keyhex;
        var u = f(q, r, v, p);
        var o = u.replace(/(.{64})/g, "$1\r\n");
        var n = "-----BEGIN RSA PRIVATE KEY-----\r\n";
        n += "Proc-Type: 4,ENCRYPTED\r\n";
        n += "DEK-Info: " + r + "," + p + "\r\n";
        n += "\r\n";
        n += o;
        n += "\r\n-----END RSA PRIVATE KEY-----\r\n";
        return n;
      },
      getEryptedPKCS5PEMFromRSAKey: function(C, D, o, s) {
        var A = new KJUR.asn1.DERInteger({"int": 0});
        var v = new KJUR.asn1.DERInteger({bigint: C.n});
        var z = new KJUR.asn1.DERInteger({"int": C.e});
        var B = new KJUR.asn1.DERInteger({bigint: C.d});
        var t = new KJUR.asn1.DERInteger({bigint: C.p});
        var r = new KJUR.asn1.DERInteger({bigint: C.q});
        var y = new KJUR.asn1.DERInteger({bigint: C.dmp1});
        var u = new KJUR.asn1.DERInteger({bigint: C.dmq1});
        var x = new KJUR.asn1.DERInteger({bigint: C.coeff});
        var E = new KJUR.asn1.DERSequence({array: [A, v, z, B, t, r, y, u, x]});
        var w = E.getEncodedHex();
        return this.getEryptedPKCS5PEMFromPrvKeyHex(w, D, o, s);
      },
      newEncryptedPKCS5PEM: function(n, o, r, s) {
        if (typeof o == "undefined" || o == null) {
          o = 1024;
        }
        if (typeof r == "undefined" || r == null) {
          r = "10001";
        }
        var p = new RSAKey();
        p.generate(o, r);
        var q = null;
        if (typeof s == "undefined" || s == null) {
          q = this.getEncryptedPKCS5PEMFromRSAKey(pkey, n);
        } else {
          q = this.getEncryptedPKCS5PEMFromRSAKey(pkey, n, s);
        }
        return q;
      },
      getRSAKeyFromPlainPKCS8PEM: function(p) {
        if (p.match(/ENCRYPTED/)) {
          throw "pem shall be not ENCRYPTED";
        }
        var o = this.getHexFromPEM(p, "PRIVATE KEY");
        var n = this.getRSAKeyFromPlainPKCS8Hex(o);
        return n;
      },
      getRSAKeyFromPlainPKCS8Hex: function(q) {
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(q, 0);
        if (p.length != 3) {
          throw "outer DERSequence shall have 3 elements: " + p.length;
        }
        var o = ASN1HEX.getHexOfTLV_AtObj(q, p[1]);
        if (o != "300d06092a864886f70d0101010500") {
          throw "PKCS8 AlgorithmIdentifier is not rsaEnc: " + o;
        }
        var o = ASN1HEX.getHexOfTLV_AtObj(q, p[1]);
        var r = ASN1HEX.getHexOfTLV_AtObj(q, p[2]);
        var s = ASN1HEX.getHexOfV_AtObj(r, 0);
        var n = new RSAKey();
        n.readPrivateKeyFromASN1HexString(s);
        return n;
      },
      parseHexOfEncryptedPKCS8: function(u) {
        var q = {};
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(u, 0);
        if (p.length != 2) {
          throw "malformed format: SEQUENCE(0).items != 2: " + p.length;
        }
        q.ciphertext = ASN1HEX.getHexOfV_AtObj(u, p[1]);
        var w = ASN1HEX.getPosArrayOfChildren_AtObj(u, p[0]);
        if (w.length != 2) {
          throw "malformed format: SEQUENCE(0.0).items != 2: " + w.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(u, w[0]) != "2a864886f70d01050d") {
          throw "this only supports pkcs5PBES2";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(u, w[1]);
        if (w.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1).items != 2: " + n.length;
        }
        var o = ASN1HEX.getPosArrayOfChildren_AtObj(u, n[1]);
        if (o.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1.1).items != 2: " + o.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(u, o[0]) != "2a864886f70d0307") {
          throw "this only supports TripleDES";
        }
        q.encryptionSchemeAlg = "TripleDES";
        q.encryptionSchemeIV = ASN1HEX.getHexOfV_AtObj(u, o[1]);
        var r = ASN1HEX.getPosArrayOfChildren_AtObj(u, n[0]);
        if (r.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1.0).items != 2: " + r.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(u, r[0]) != "2a864886f70d01050c") {
          throw "this only supports pkcs5PBKDF2";
        }
        var v = ASN1HEX.getPosArrayOfChildren_AtObj(u, r[1]);
        if (v.length < 2) {
          throw "malformed format: SEQUENCE(0.0.1.0.1).items < 2: " + v.length;
        }
        q.pbkdf2Salt = ASN1HEX.getHexOfV_AtObj(u, v[0]);
        var s = ASN1HEX.getHexOfV_AtObj(u, v[1]);
        try {
          q.pbkdf2Iter = parseInt(s, 16);
        } catch (t) {
          throw "malformed format pbkdf2Iter: " + s;
        }
        return q;
      },
      getPBKDF2KeyHexFromParam: function(s, n) {
        var r = CryptoJS.enc.Hex.parse(s.pbkdf2Salt);
        var o = s.pbkdf2Iter;
        var q = CryptoJS.PBKDF2(n, r, {
          keySize: 192 / 32,
          iterations: o
        });
        var p = CryptoJS.enc.Hex.stringify(q);
        return p;
      },
      getPlainPKCS8HexFromEncryptedPKCS8PEM: function(v, w) {
        var p = this.getHexFromPEM(v, "ENCRYPTED PRIVATE KEY");
        var n = this.parseHexOfEncryptedPKCS8(p);
        var s = PKCS5PKEY.getPBKDF2KeyHexFromParam(n, w);
        var t = {};
        t.ciphertext = CryptoJS.enc.Hex.parse(n.ciphertext);
        var r = CryptoJS.enc.Hex.parse(s);
        var q = CryptoJS.enc.Hex.parse(n.encryptionSchemeIV);
        var u = CryptoJS.TripleDES.decrypt(t, r, {iv: q});
        var o = CryptoJS.enc.Hex.stringify(u);
        return o;
      },
      getRSAKeyFromEncryptedPKCS8PEM: function(q, p) {
        var o = this.getPlainPKCS8HexFromEncryptedPKCS8PEM(q, p);
        var n = this.getRSAKeyFromPlainPKCS8Hex(o);
        return n;
      },
      getKeyFromEncryptedPKCS8PEM: function(q, o) {
        var n = this.getPlainPKCS8HexFromEncryptedPKCS8PEM(q, o);
        var p = this.getKeyFromPlainPrivatePKCS8Hex(n);
        return p;
      },
      parsePlainPrivatePKCS8Hex: function(q) {
        var o = {};
        o.algparam = null;
        if (q.substr(0, 2) != "30") {
          throw "malformed plain PKCS8 private key(code:001)";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(q, 0);
        if (p.length != 3) {
          throw "malformed plain PKCS8 private key(code:002)";
        }
        if (q.substr(p[1], 2) != "30") {
          throw "malformed PKCS8 private key(code:003)";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(q, p[1]);
        if (n.length != 2) {
          throw "malformed PKCS8 private key(code:004)";
        }
        if (q.substr(n[0], 2) != "06") {
          throw "malformed PKCS8 private key(code:005)";
        }
        o.algoid = ASN1HEX.getHexOfV_AtObj(q, n[0]);
        if (q.substr(n[1], 2) == "06") {
          o.algparam = ASN1HEX.getHexOfV_AtObj(q, n[1]);
        }
        if (q.substr(p[2], 2) != "04") {
          throw "malformed PKCS8 private key(code:006)";
        }
        o.keyidx = ASN1HEX.getStartPosOfV_AtObj(q, p[2]);
        return o;
      },
      getKeyFromPlainPrivatePKCS8PEM: function(o) {
        var n = this.getHexFromPEM(o, "PRIVATE KEY");
        var p = this.getKeyFromPlainPrivatePKCS8Hex(n);
        return p;
      },
      getKeyFromPlainPrivatePKCS8Hex: function(n) {
        var p = this.parsePlainPrivatePKCS8Hex(n);
        if (p.algoid == "2a864886f70d010101") {
          this.parsePrivateRawRSAKeyHexAtObj(n, p);
          var o = p.key;
          var q = new RSAKey();
          q.setPrivateEx(o.n, o.e, o.d, o.p, o.q, o.dp, o.dq, o.co);
          return q;
        } else {
          if (p.algoid == "2a8648ce3d0201") {
            this.parsePrivateRawECKeyHexAtObj(n, p);
            if (KJUR.crypto.OID.oidhex2name[p.algparam] === undefined) {
              throw "KJUR.crypto.OID.oidhex2name undefined: " + p.algparam;
            }
            var r = KJUR.crypto.OID.oidhex2name[p.algparam];
            var q = new KJUR.crypto.ECDSA({
              curve: r,
              prv: p.key
            });
            return q;
          } else {
            throw "unsupported private key algorithm";
          }
        }
      },
      getRSAKeyFromPublicPKCS8PEM: function(o) {
        var p = this.getHexFromPEM(o, "PUBLIC KEY");
        var n = this.getRSAKeyFromPublicPKCS8Hex(p);
        return n;
      },
      getKeyFromPublicPKCS8PEM: function(o) {
        var p = this.getHexFromPEM(o, "PUBLIC KEY");
        var n = this.getKeyFromPublicPKCS8Hex(p);
        return n;
      },
      getKeyFromPublicPKCS8Hex: function(o) {
        var n = this.parsePublicPKCS8Hex(o);
        if (n.algoid == "2a864886f70d010101") {
          var r = this.parsePublicRawRSAKeyHex(n.key);
          var p = new RSAKey();
          p.setPublic(r.n, r.e);
          return p;
        } else {
          if (n.algoid == "2a8648ce3d0201") {
            if (KJUR.crypto.OID.oidhex2name[n.algparam] === undefined) {
              throw "KJUR.crypto.OID.oidhex2name undefined: " + n.algparam;
            }
            var q = KJUR.crypto.OID.oidhex2name[n.algparam];
            var p = new KJUR.crypto.ECDSA({
              curve: q,
              pub: n.key
            });
            return p;
          } else {
            throw "unsupported public key algorithm";
          }
        }
      },
      parsePublicRawRSAKeyHex: function(p) {
        var n = {};
        if (p.substr(0, 2) != "30") {
          throw "malformed RSA key(code:001)";
        }
        var o = ASN1HEX.getPosArrayOfChildren_AtObj(p, 0);
        if (o.length != 2) {
          throw "malformed RSA key(code:002)";
        }
        if (p.substr(o[0], 2) != "02") {
          throw "malformed RSA key(code:003)";
        }
        n.n = ASN1HEX.getHexOfV_AtObj(p, o[0]);
        if (p.substr(o[1], 2) != "02") {
          throw "malformed RSA key(code:004)";
        }
        n.e = ASN1HEX.getHexOfV_AtObj(p, o[1]);
        return n;
      },
      parsePrivateRawRSAKeyHexAtObj: function(o, q) {
        var p = q.keyidx;
        if (o.substr(p, 2) != "30") {
          throw "malformed RSA private key(code:001)";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(o, p);
        if (n.length != 9) {
          throw "malformed RSA private key(code:002)";
        }
        q.key = {};
        q.key.n = ASN1HEX.getHexOfV_AtObj(o, n[1]);
        q.key.e = ASN1HEX.getHexOfV_AtObj(o, n[2]);
        q.key.d = ASN1HEX.getHexOfV_AtObj(o, n[3]);
        q.key.p = ASN1HEX.getHexOfV_AtObj(o, n[4]);
        q.key.q = ASN1HEX.getHexOfV_AtObj(o, n[5]);
        q.key.dp = ASN1HEX.getHexOfV_AtObj(o, n[6]);
        q.key.dq = ASN1HEX.getHexOfV_AtObj(o, n[7]);
        q.key.co = ASN1HEX.getHexOfV_AtObj(o, n[8]);
      },
      parsePrivateRawECKeyHexAtObj: function(o, q) {
        var p = q.keyidx;
        if (o.substr(p, 2) != "30") {
          throw "malformed ECC private key(code:001)";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(o, p);
        if (n.length != 3) {
          throw "malformed ECC private key(code:002)";
        }
        if (o.substr(n[1], 2) != "04") {
          throw "malformed ECC private key(code:003)";
        }
        q.key = ASN1HEX.getHexOfV_AtObj(o, n[1]);
      },
      parsePublicPKCS8Hex: function(q) {
        var o = {};
        o.algparam = null;
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(q, 0);
        if (p.length != 2) {
          throw "outer DERSequence shall have 2 elements: " + p.length;
        }
        var r = p[0];
        if (q.substr(r, 2) != "30") {
          throw "malformed PKCS8 public key(code:001)";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(q, r);
        if (n.length != 2) {
          throw "malformed PKCS8 public key(code:002)";
        }
        if (q.substr(n[0], 2) != "06") {
          throw "malformed PKCS8 public key(code:003)";
        }
        o.algoid = ASN1HEX.getHexOfV_AtObj(q, n[0]);
        if (q.substr(n[1], 2) == "06") {
          o.algparam = ASN1HEX.getHexOfV_AtObj(q, n[1]);
        }
        if (q.substr(p[1], 2) != "03") {
          throw "malformed PKCS8 public key(code:004)";
        }
        o.key = ASN1HEX.getHexOfV_AtObj(q, p[1]).substr(2);
        return o;
      },
      getRSAKeyFromPublicPKCS8Hex: function(r) {
        var q = ASN1HEX.getPosArrayOfChildren_AtObj(r, 0);
        if (q.length != 2) {
          throw "outer DERSequence shall have 2 elements: " + q.length;
        }
        var p = ASN1HEX.getHexOfTLV_AtObj(r, q[0]);
        if (p != "300d06092a864886f70d0101010500") {
          throw "PKCS8 AlgorithmId is not rsaEncryption";
        }
        if (r.substr(q[1], 2) != "03") {
          throw "PKCS8 Public Key is not BITSTRING encapslated.";
        }
        var t = ASN1HEX.getStartPosOfV_AtObj(r, q[1]) + 2;
        if (r.substr(t, 2) != "30") {
          throw "PKCS8 Public Key is not SEQUENCE.";
        }
        var n = ASN1HEX.getPosArrayOfChildren_AtObj(r, t);
        if (n.length != 2) {
          throw "inner DERSequence shall have 2 elements: " + n.length;
        }
        if (r.substr(n[0], 2) != "02") {
          throw "N is not ASN.1 INTEGER";
        }
        if (r.substr(n[1], 2) != "02") {
          throw "E is not ASN.1 INTEGER";
        }
        var u = ASN1HEX.getHexOfV_AtObj(r, n[0]);
        var s = ASN1HEX.getHexOfV_AtObj(r, n[1]);
        var o = new RSAKey();
        o.setPublic(u, s);
        return o;
      }
    };
  }();
  var KEYUTIL = function() {
    var d = function(p, r, q) {
      return k(CryptoJS.AES, p, r, q);
    };
    var e = function(p, r, q) {
      return k(CryptoJS.TripleDES, p, r, q);
    };
    var a = function(p, r, q) {
      return k(CryptoJS.DES, p, r, q);
    };
    var k = function(s, x, u, q) {
      var r = CryptoJS.enc.Hex.parse(x);
      var w = CryptoJS.enc.Hex.parse(u);
      var p = CryptoJS.enc.Hex.parse(q);
      var t = {};
      t.key = w;
      t.iv = p;
      t.ciphertext = r;
      var v = s.decrypt(t, w, {iv: p});
      return CryptoJS.enc.Hex.stringify(v);
    };
    var l = function(p, r, q) {
      return g(CryptoJS.AES, p, r, q);
    };
    var o = function(p, r, q) {
      return g(CryptoJS.TripleDES, p, r, q);
    };
    var f = function(p, r, q) {
      return g(CryptoJS.DES, p, r, q);
    };
    var g = function(t, y, v, q) {
      var s = CryptoJS.enc.Hex.parse(y);
      var x = CryptoJS.enc.Hex.parse(v);
      var p = CryptoJS.enc.Hex.parse(q);
      var w = t.encrypt(s, x, {iv: p});
      var r = CryptoJS.enc.Hex.parse(w.toString());
      var u = CryptoJS.enc.Base64.stringify(r);
      return u;
    };
    var i = {
      "AES-256-CBC": {
        proc: d,
        eproc: l,
        keylen: 32,
        ivlen: 16
      },
      "AES-192-CBC": {
        proc: d,
        eproc: l,
        keylen: 24,
        ivlen: 16
      },
      "AES-128-CBC": {
        proc: d,
        eproc: l,
        keylen: 16,
        ivlen: 16
      },
      "DES-EDE3-CBC": {
        proc: e,
        eproc: o,
        keylen: 24,
        ivlen: 8
      },
      "DES-CBC": {
        proc: a,
        eproc: f,
        keylen: 8,
        ivlen: 8
      }
    };
    var c = function(p) {
      return i[p]["proc"];
    };
    var m = function(p) {
      var r = CryptoJS.lib.WordArray.random(p);
      var q = CryptoJS.enc.Hex.stringify(r);
      return q;
    };
    var n = function(t) {
      var u = {};
      if (t.match(new RegExp("DEK-Info: ([^,]+),([0-9A-Fa-f]+)", "m"))) {
        u.cipher = RegExp.$1;
        u.ivsalt = RegExp.$2;
      }
      if (t.match(new RegExp("-----BEGIN ([A-Z]+) PRIVATE KEY-----"))) {
        u.type = RegExp.$1;
      }
      var r = -1;
      var v = 0;
      if (t.indexOf("\r\n\r\n") != -1) {
        r = t.indexOf("\r\n\r\n");
        v = 2;
      }
      if (t.indexOf("\n\n") != -1) {
        r = t.indexOf("\n\n");
        v = 1;
      }
      var q = t.indexOf("-----END");
      if (r != -1 && q != -1) {
        var p = t.substring(r + v * 2, q - v);
        p = p.replace(/\s+/g, "");
        u.data = p;
      }
      return u;
    };
    var j = function(q, y, p) {
      var v = p.substring(0, 16);
      var t = CryptoJS.enc.Hex.parse(v);
      var r = CryptoJS.enc.Utf8.parse(y);
      var u = i[q]["keylen"] + i[q]["ivlen"];
      var x = "";
      var w = null;
      for (; ; ) {
        var s = CryptoJS.algo.MD5.create();
        if (w != null) {
          s.update(w);
        }
        s.update(r);
        s.update(t);
        w = s.finalize();
        x = x + CryptoJS.enc.Hex.stringify(w);
        if (x.length >= u * 2) {
          break;
        }
      }
      var z = {};
      z.keyhex = x.substr(0, i[q]["keylen"] * 2);
      z.ivhex = x.substr(i[q]["keylen"] * 2, i[q]["ivlen"] * 2);
      return z;
    };
    var b = function(p, v, r, w) {
      var s = CryptoJS.enc.Base64.parse(p);
      var q = CryptoJS.enc.Hex.stringify(s);
      var u = i[v]["proc"];
      var t = u(q, r, w);
      return t;
    };
    var h = function(p, s, q, u) {
      var r = i[s]["eproc"];
      var t = r(p, q, u);
      return t;
    };
    return {
      version: "1.0.0",
      getHexFromPEM: function(q, u) {
        var r = q;
        if (r.indexOf("-----BEGIN ") == -1) {
          throw "can't find PEM header: " + u;
        }
        if (typeof u == "string" && u != "") {
          r = r.replace("-----BEGIN " + u + "-----", "");
          r = r.replace("-----END " + u + "-----", "");
        } else {
          r = r.replace(/-----BEGIN [^-]+-----/, "");
          r = r.replace(/-----END [^-]+-----/, "");
        }
        var t = r.replace(/\s+/g, "");
        var p = b64tohex(t);
        return p;
      },
      getDecryptedKeyHexByKeyIV: function(q, t, s, r) {
        var p = c(t);
        return p(q, s, r);
      },
      parsePKCS5PEM: function(p) {
        return n(p);
      },
      getKeyAndUnusedIvByPasscodeAndIvsalt: function(q, p, r) {
        return j(q, p, r);
      },
      decryptKeyB64: function(p, r, q, s) {
        return b(p, r, q, s);
      },
      getDecryptedKeyHex: function(y, x) {
        var q = n(y);
        var t = q.type;
        var r = q.cipher;
        var p = q.ivsalt;
        var s = q.data;
        var w = j(r, x, p);
        var v = w.keyhex;
        var u = b(s, r, v, p);
        return u;
      },
      getRSAKeyFromEncryptedPKCS5PEM: function(r, q) {
        var s = this.getDecryptedKeyHex(r, q);
        var p = new RSAKey();
        p.readPrivateKeyFromASN1HexString(s);
        return p;
      },
      getEncryptedPKCS5PEMFromPrvKeyHex: function(x, s, A, t, r) {
        var p = "";
        if (typeof t == "undefined" || t == null) {
          t = "AES-256-CBC";
        }
        if (typeof i[t] == "undefined") {
          throw "KEYUTIL unsupported algorithm: " + t;
        }
        if (typeof r == "undefined" || r == null) {
          var v = i[t]["ivlen"];
          var u = m(v);
          r = u.toUpperCase();
        }
        var z = j(t, A, r);
        var y = z.keyhex;
        var w = h(s, t, y, r);
        var q = w.replace(/(.{64})/g, "$1\r\n");
        var p = "-----BEGIN " + x + " PRIVATE KEY-----\r\n";
        p += "Proc-Type: 4,ENCRYPTED\r\n";
        p += "DEK-Info: " + t + "," + r + "\r\n";
        p += "\r\n";
        p += q;
        p += "\r\n-----END " + x + " PRIVATE KEY-----\r\n";
        return p;
      },
      getEncryptedPKCS5PEMFromRSAKey: function(D, E, r, t) {
        var B = new KJUR.asn1.DERInteger({"int": 0});
        var w = new KJUR.asn1.DERInteger({bigint: D.n});
        var A = new KJUR.asn1.DERInteger({"int": D.e});
        var C = new KJUR.asn1.DERInteger({bigint: D.d});
        var u = new KJUR.asn1.DERInteger({bigint: D.p});
        var s = new KJUR.asn1.DERInteger({bigint: D.q});
        var z = new KJUR.asn1.DERInteger({bigint: D.dmp1});
        var v = new KJUR.asn1.DERInteger({bigint: D.dmq1});
        var y = new KJUR.asn1.DERInteger({bigint: D.coeff});
        var F = new KJUR.asn1.DERSequence({array: [B, w, A, C, u, s, z, v, y]});
        var x = F.getEncodedHex();
        return this.getEncryptedPKCS5PEMFromPrvKeyHex("RSA", x, E, r, t);
      },
      newEncryptedPKCS5PEM: function(p, q, t, u) {
        if (typeof q == "undefined" || q == null) {
          q = 1024;
        }
        if (typeof t == "undefined" || t == null) {
          t = "10001";
        }
        var r = new RSAKey();
        r.generate(q, t);
        var s = null;
        if (typeof u == "undefined" || u == null) {
          s = this.getEncryptedPKCS5PEMFromRSAKey(r, p);
        } else {
          s = this.getEncryptedPKCS5PEMFromRSAKey(r, p, u);
        }
        return s;
      },
      getRSAKeyFromPlainPKCS8PEM: function(r) {
        if (r.match(/ENCRYPTED/)) {
          throw "pem shall be not ENCRYPTED";
        }
        var q = this.getHexFromPEM(r, "PRIVATE KEY");
        var p = this.getRSAKeyFromPlainPKCS8Hex(q);
        return p;
      },
      getRSAKeyFromPlainPKCS8Hex: function(s) {
        var r = ASN1HEX.getPosArrayOfChildren_AtObj(s, 0);
        if (r.length != 3) {
          throw "outer DERSequence shall have 3 elements: " + r.length;
        }
        var q = ASN1HEX.getHexOfTLV_AtObj(s, r[1]);
        if (q != "300d06092a864886f70d0101010500") {
          throw "PKCS8 AlgorithmIdentifier is not rsaEnc: " + q;
        }
        var q = ASN1HEX.getHexOfTLV_AtObj(s, r[1]);
        var t = ASN1HEX.getHexOfTLV_AtObj(s, r[2]);
        var u = ASN1HEX.getHexOfV_AtObj(t, 0);
        var p = new RSAKey();
        p.readPrivateKeyFromASN1HexString(u);
        return p;
      },
      parseHexOfEncryptedPKCS8: function(w) {
        var s = {};
        var r = ASN1HEX.getPosArrayOfChildren_AtObj(w, 0);
        if (r.length != 2) {
          throw "malformed format: SEQUENCE(0).items != 2: " + r.length;
        }
        s.ciphertext = ASN1HEX.getHexOfV_AtObj(w, r[1]);
        var y = ASN1HEX.getPosArrayOfChildren_AtObj(w, r[0]);
        if (y.length != 2) {
          throw "malformed format: SEQUENCE(0.0).items != 2: " + y.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(w, y[0]) != "2a864886f70d01050d") {
          throw "this only supports pkcs5PBES2";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(w, y[1]);
        if (y.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1).items != 2: " + p.length;
        }
        var q = ASN1HEX.getPosArrayOfChildren_AtObj(w, p[1]);
        if (q.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1.1).items != 2: " + q.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(w, q[0]) != "2a864886f70d0307") {
          throw "this only supports TripleDES";
        }
        s.encryptionSchemeAlg = "TripleDES";
        s.encryptionSchemeIV = ASN1HEX.getHexOfV_AtObj(w, q[1]);
        var t = ASN1HEX.getPosArrayOfChildren_AtObj(w, p[0]);
        if (t.length != 2) {
          throw "malformed format: SEQUENCE(0.0.1.0).items != 2: " + t.length;
        }
        if (ASN1HEX.getHexOfV_AtObj(w, t[0]) != "2a864886f70d01050c") {
          throw "this only supports pkcs5PBKDF2";
        }
        var x = ASN1HEX.getPosArrayOfChildren_AtObj(w, t[1]);
        if (x.length < 2) {
          throw "malformed format: SEQUENCE(0.0.1.0.1).items < 2: " + x.length;
        }
        s.pbkdf2Salt = ASN1HEX.getHexOfV_AtObj(w, x[0]);
        var u = ASN1HEX.getHexOfV_AtObj(w, x[1]);
        try {
          s.pbkdf2Iter = parseInt(u, 16);
        } catch (v) {
          throw "malformed format pbkdf2Iter: " + u;
        }
        return s;
      },
      getPBKDF2KeyHexFromParam: function(u, p) {
        var t = CryptoJS.enc.Hex.parse(u.pbkdf2Salt);
        var q = u.pbkdf2Iter;
        var s = CryptoJS.PBKDF2(p, t, {
          keySize: 192 / 32,
          iterations: q
        });
        var r = CryptoJS.enc.Hex.stringify(s);
        return r;
      },
      getPlainPKCS8HexFromEncryptedPKCS8PEM: function(x, y) {
        var r = this.getHexFromPEM(x, "ENCRYPTED PRIVATE KEY");
        var p = this.parseHexOfEncryptedPKCS8(r);
        var u = KEYUTIL.getPBKDF2KeyHexFromParam(p, y);
        var v = {};
        v.ciphertext = CryptoJS.enc.Hex.parse(p.ciphertext);
        var t = CryptoJS.enc.Hex.parse(u);
        var s = CryptoJS.enc.Hex.parse(p.encryptionSchemeIV);
        var w = CryptoJS.TripleDES.decrypt(v, t, {iv: s});
        var q = CryptoJS.enc.Hex.stringify(w);
        return q;
      },
      getRSAKeyFromEncryptedPKCS8PEM: function(s, r) {
        var q = this.getPlainPKCS8HexFromEncryptedPKCS8PEM(s, r);
        var p = this.getRSAKeyFromPlainPKCS8Hex(q);
        return p;
      },
      getKeyFromEncryptedPKCS8PEM: function(s, q) {
        var p = this.getPlainPKCS8HexFromEncryptedPKCS8PEM(s, q);
        var r = this.getKeyFromPlainPrivatePKCS8Hex(p);
        return r;
      },
      parsePlainPrivatePKCS8Hex: function(s) {
        var q = {};
        q.algparam = null;
        if (s.substr(0, 2) != "30") {
          throw "malformed plain PKCS8 private key(code:001)";
        }
        var r = ASN1HEX.getPosArrayOfChildren_AtObj(s, 0);
        if (r.length != 3) {
          throw "malformed plain PKCS8 private key(code:002)";
        }
        if (s.substr(r[1], 2) != "30") {
          throw "malformed PKCS8 private key(code:003)";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(s, r[1]);
        if (p.length != 2) {
          throw "malformed PKCS8 private key(code:004)";
        }
        if (s.substr(p[0], 2) != "06") {
          throw "malformed PKCS8 private key(code:005)";
        }
        q.algoid = ASN1HEX.getHexOfV_AtObj(s, p[0]);
        if (s.substr(p[1], 2) == "06") {
          q.algparam = ASN1HEX.getHexOfV_AtObj(s, p[1]);
        }
        if (s.substr(r[2], 2) != "04") {
          throw "malformed PKCS8 private key(code:006)";
        }
        q.keyidx = ASN1HEX.getStartPosOfV_AtObj(s, r[2]);
        return q;
      },
      getKeyFromPlainPrivatePKCS8PEM: function(q) {
        var p = this.getHexFromPEM(q, "PRIVATE KEY");
        var r = this.getKeyFromPlainPrivatePKCS8Hex(p);
        return r;
      },
      getKeyFromPlainPrivatePKCS8Hex: function(p) {
        var w = this.parsePlainPrivatePKCS8Hex(p);
        if (w.algoid == "2a864886f70d010101") {
          this.parsePrivateRawRSAKeyHexAtObj(p, w);
          var u = w.key;
          var z = new RSAKey();
          z.setPrivateEx(u.n, u.e, u.d, u.p, u.q, u.dp, u.dq, u.co);
          return z;
        } else {
          if (w.algoid == "2a8648ce3d0201") {
            this.parsePrivateRawECKeyHexAtObj(p, w);
            if (KJUR.crypto.OID.oidhex2name[w.algparam] === undefined) {
              throw "KJUR.crypto.OID.oidhex2name undefined: " + w.algparam;
            }
            var v = KJUR.crypto.OID.oidhex2name[w.algparam];
            var z = new KJUR.crypto.ECDSA({curve: v});
            z.setPublicKeyHex(w.pubkey);
            z.setPrivateKeyHex(w.key);
            z.isPublic = false;
            return z;
          } else {
            if (w.algoid == "2a8648ce380401") {
              var t = ASN1HEX.getVbyList(p, 0, [1, 1, 0], "02");
              var s = ASN1HEX.getVbyList(p, 0, [1, 1, 1], "02");
              var y = ASN1HEX.getVbyList(p, 0, [1, 1, 2], "02");
              var B = ASN1HEX.getVbyList(p, 0, [2, 0], "02");
              var r = new BigInteger(t, 16);
              var q = new BigInteger(s, 16);
              var x = new BigInteger(y, 16);
              var A = new BigInteger(B, 16);
              var z = new KJUR.crypto.DSA();
              z.setPrivate(r, q, x, null, A);
              return z;
            } else {
              throw "unsupported private key algorithm";
            }
          }
        }
      },
      getRSAKeyFromPublicPKCS8PEM: function(q) {
        var r = this.getHexFromPEM(q, "PUBLIC KEY");
        var p = this.getRSAKeyFromPublicPKCS8Hex(r);
        return p;
      },
      getKeyFromPublicPKCS8PEM: function(q) {
        var r = this.getHexFromPEM(q, "PUBLIC KEY");
        var p = this.getKeyFromPublicPKCS8Hex(r);
        return p;
      },
      getKeyFromPublicPKCS8Hex: function(q) {
        var p = this.parsePublicPKCS8Hex(q);
        if (p.algoid == "2a864886f70d010101") {
          var u = this.parsePublicRawRSAKeyHex(p.key);
          var r = new RSAKey();
          r.setPublic(u.n, u.e);
          return r;
        } else {
          if (p.algoid == "2a8648ce3d0201") {
            if (KJUR.crypto.OID.oidhex2name[p.algparam] === undefined) {
              throw "KJUR.crypto.OID.oidhex2name undefined: " + p.algparam;
            }
            var s = KJUR.crypto.OID.oidhex2name[p.algparam];
            var r = new KJUR.crypto.ECDSA({
              curve: s,
              pub: p.key
            });
            return r;
          } else {
            if (p.algoid == "2a8648ce380401") {
              var t = p.algparam;
              var v = ASN1HEX.getHexOfV_AtObj(p.key, 0);
              var r = new KJUR.crypto.DSA();
              r.setPublic(new BigInteger(t.p, 16), new BigInteger(t.q, 16), new BigInteger(t.g, 16), new BigInteger(v, 16));
              return r;
            } else {
              throw "unsupported public key algorithm";
            }
          }
        }
      },
      parsePublicRawRSAKeyHex: function(r) {
        var p = {};
        if (r.substr(0, 2) != "30") {
          throw "malformed RSA key(code:001)";
        }
        var q = ASN1HEX.getPosArrayOfChildren_AtObj(r, 0);
        if (q.length != 2) {
          throw "malformed RSA key(code:002)";
        }
        if (r.substr(q[0], 2) != "02") {
          throw "malformed RSA key(code:003)";
        }
        p.n = ASN1HEX.getHexOfV_AtObj(r, q[0]);
        if (r.substr(q[1], 2) != "02") {
          throw "malformed RSA key(code:004)";
        }
        p.e = ASN1HEX.getHexOfV_AtObj(r, q[1]);
        return p;
      },
      parsePrivateRawRSAKeyHexAtObj: function(q, s) {
        var r = s.keyidx;
        if (q.substr(r, 2) != "30") {
          throw "malformed RSA private key(code:001)";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(q, r);
        if (p.length != 9) {
          throw "malformed RSA private key(code:002)";
        }
        s.key = {};
        s.key.n = ASN1HEX.getHexOfV_AtObj(q, p[1]);
        s.key.e = ASN1HEX.getHexOfV_AtObj(q, p[2]);
        s.key.d = ASN1HEX.getHexOfV_AtObj(q, p[3]);
        s.key.p = ASN1HEX.getHexOfV_AtObj(q, p[4]);
        s.key.q = ASN1HEX.getHexOfV_AtObj(q, p[5]);
        s.key.dp = ASN1HEX.getHexOfV_AtObj(q, p[6]);
        s.key.dq = ASN1HEX.getHexOfV_AtObj(q, p[7]);
        s.key.co = ASN1HEX.getHexOfV_AtObj(q, p[8]);
      },
      parsePrivateRawECKeyHexAtObj: function(p, t) {
        var q = t.keyidx;
        var r = ASN1HEX.getVbyList(p, q, [1], "04");
        var s = ASN1HEX.getVbyList(p, q, [2, 0], "03").substr(2);
        t.key = r;
        t.pubkey = s;
      },
      parsePublicPKCS8Hex: function(s) {
        var q = {};
        q.algparam = null;
        var r = ASN1HEX.getPosArrayOfChildren_AtObj(s, 0);
        if (r.length != 2) {
          throw "outer DERSequence shall have 2 elements: " + r.length;
        }
        var t = r[0];
        if (s.substr(t, 2) != "30") {
          throw "malformed PKCS8 public key(code:001)";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(s, t);
        if (p.length != 2) {
          throw "malformed PKCS8 public key(code:002)";
        }
        if (s.substr(p[0], 2) != "06") {
          throw "malformed PKCS8 public key(code:003)";
        }
        q.algoid = ASN1HEX.getHexOfV_AtObj(s, p[0]);
        if (s.substr(p[1], 2) == "06") {
          q.algparam = ASN1HEX.getHexOfV_AtObj(s, p[1]);
        } else {
          if (s.substr(p[1], 2) == "30") {
            q.algparam = {};
            q.algparam.p = ASN1HEX.getVbyList(s, p[1], [0], "02");
            q.algparam.q = ASN1HEX.getVbyList(s, p[1], [1], "02");
            q.algparam.g = ASN1HEX.getVbyList(s, p[1], [2], "02");
          }
        }
        if (s.substr(r[1], 2) != "03") {
          throw "malformed PKCS8 public key(code:004)";
        }
        q.key = ASN1HEX.getHexOfV_AtObj(s, r[1]).substr(2);
        return q;
      },
      getRSAKeyFromPublicPKCS8Hex: function(t) {
        var s = ASN1HEX.getPosArrayOfChildren_AtObj(t, 0);
        if (s.length != 2) {
          throw "outer DERSequence shall have 2 elements: " + s.length;
        }
        var r = ASN1HEX.getHexOfTLV_AtObj(t, s[0]);
        if (r != "300d06092a864886f70d0101010500") {
          throw "PKCS8 AlgorithmId is not rsaEncryption";
        }
        if (t.substr(s[1], 2) != "03") {
          throw "PKCS8 Public Key is not BITSTRING encapslated.";
        }
        var v = ASN1HEX.getStartPosOfV_AtObj(t, s[1]) + 2;
        if (t.substr(v, 2) != "30") {
          throw "PKCS8 Public Key is not SEQUENCE.";
        }
        var p = ASN1HEX.getPosArrayOfChildren_AtObj(t, v);
        if (p.length != 2) {
          throw "inner DERSequence shall have 2 elements: " + p.length;
        }
        if (t.substr(p[0], 2) != "02") {
          throw "N is not ASN.1 INTEGER";
        }
        if (t.substr(p[1], 2) != "02") {
          throw "E is not ASN.1 INTEGER";
        }
        var w = ASN1HEX.getHexOfV_AtObj(t, p[0]);
        var u = ASN1HEX.getHexOfV_AtObj(t, p[1]);
        var q = new RSAKey();
        q.setPublic(w, u);
        return q;
      }
    };
  }();
  KEYUTIL.getKey = function(f, e, h) {
    if (typeof RSAKey != "undefined" && f instanceof RSAKey) {
      return f;
    }
    if (typeof KJUR.crypto.ECDSA != "undefined" && f instanceof KJUR.crypto.ECDSA) {
      return f;
    }
    if (typeof KJUR.crypto.DSA != "undefined" && f instanceof KJUR.crypto.DSA) {
      return f;
    }
    if (f.d !== undefined && f.curve !== undefined) {
      return new KJUR.crypto.ECDSA({
        prv: f.d,
        curve: f.curve
      });
    }
    if (f.n !== undefined && f.e !== undefined && f.d !== undefined && f.p !== undefined && f.q !== undefined && f.dp !== undefined && f.dq !== undefined && f.co !== undefined && f.qi === undefined) {
      var w = new RSAKey();
      w.setPrivateEx(f.n, f.e, f.d, f.p, f.q, f.dp, f.dq, f.co);
      return w;
    }
    if (f.p !== undefined && f.q !== undefined && f.g !== undefined && f.y !== undefined && f.x !== undefined) {
      var w = new KJUR.crypto.DSA();
      w.setPrivate(f.p, f.q, f.g, f.y, f.x);
      return w;
    }
    if (f.xy !== undefined && f.d === undefined && f.curve !== undefined) {
      return new KJUR.crypto.ECDSA({
        pub: f.xy,
        curve: f.curve
      });
    }
    if (f.kty === undefined && f.n !== undefined && f.e) {
      var w = new RSAKey();
      w.setPublic(f.n, f.e);
      return w;
    }
    if (f.p !== undefined && f.q !== undefined && f.g !== undefined && f.y !== undefined && f.x === undefined) {
      var w = new KJUR.crypto.DSA();
      w.setPublic(f.p, f.q, f.g, f.y);
      return w;
    }
    if (f.kty === "RSA" && f.n !== undefined && f.e !== undefined && f.d === undefined) {
      var w = new RSAKey();
      w.setPublic(b64utohex(f.n), b64utohex(f.e));
      return w;
    }
    if (f.kty === "RSA" && f.n !== undefined && f.e !== undefined && f.d !== undefined && f.p !== undefined && f.q !== undefined && f.dp !== undefined && f.dq !== undefined && f.qi !== undefined) {
      var w = new RSAKey();
      w.setPrivateEx(b64utohex(f.n), b64utohex(f.e), b64utohex(f.d), b64utohex(f.p), b64utohex(f.q), b64utohex(f.dp), b64utohex(f.dq), b64utohex(f.qi));
      return w;
    }
    if (f.kty === "EC" && f.crv !== undefined && f.x !== undefined && f.y !== undefined && f.d === undefined) {
      var d = new KJUR.crypto.ECDSA({curve: f.crv});
      var l = d.ecparams.keylen / 4;
      var r = ("0000000000" + b64utohex(f.x)).slice(-l);
      var n = ("0000000000" + b64utohex(f.y)).slice(-l);
      var m = "04" + r + n;
      d.setPublicKeyHex(m);
      return d;
    }
    if (f.kty === "EC" && f.crv !== undefined && f.x !== undefined && f.y !== undefined && f.d !== undefined) {
      var d = new KJUR.crypto.ECDSA({curve: f.crv});
      var l = d.ecparams.keylen / 4;
      var a = ("0000000000" + b64utohex(f.d)).slice(-l);
      d.setPrivateKeyHex(a);
      return d;
    }
    if (f.indexOf("-END CERTIFICATE-", 0) != -1 || f.indexOf("-END X509 CERTIFICATE-", 0) != -1 || f.indexOf("-END TRUSTED CERTIFICATE-", 0) != -1) {
      return X509.getPublicKeyFromCertPEM(f);
    }
    if (h === "pkcs8pub") {
      return KEYUTIL.getKeyFromPublicPKCS8Hex(f);
    }
    if (f.indexOf("-END PUBLIC KEY-") != -1) {
      return KEYUTIL.getKeyFromPublicPKCS8PEM(f);
    }
    if (h === "pkcs5prv") {
      var w = new RSAKey();
      w.readPrivateKeyFromASN1HexString(f);
      return w;
    }
    if (h === "pkcs5prv") {
      var w = new RSAKey();
      w.readPrivateKeyFromASN1HexString(f);
      return w;
    }
    if (f.indexOf("-END RSA PRIVATE KEY-") != -1 && f.indexOf("4,ENCRYPTED") == -1) {
      var i = KEYUTIL.getHexFromPEM(f, "RSA PRIVATE KEY");
      return KEYUTIL.getKey(i, null, "pkcs5prv");
    }
    if (f.indexOf("-END DSA PRIVATE KEY-") != -1 && f.indexOf("4,ENCRYPTED") == -1) {
      var u = this.getHexFromPEM(f, "DSA PRIVATE KEY");
      var t = ASN1HEX.getVbyList(u, 0, [1], "02");
      var s = ASN1HEX.getVbyList(u, 0, [2], "02");
      var v = ASN1HEX.getVbyList(u, 0, [3], "02");
      var j = ASN1HEX.getVbyList(u, 0, [4], "02");
      var k = ASN1HEX.getVbyList(u, 0, [5], "02");
      var w = new KJUR.crypto.DSA();
      w.setPrivate(new BigInteger(t, 16), new BigInteger(s, 16), new BigInteger(v, 16), new BigInteger(j, 16), new BigInteger(k, 16));
      return w;
    }
    if (f.indexOf("-END PRIVATE KEY-") != -1) {
      return KEYUTIL.getKeyFromPlainPrivatePKCS8PEM(f);
    }
    if (f.indexOf("-END RSA PRIVATE KEY-") != -1 && f.indexOf("4,ENCRYPTED") != -1) {
      return KEYUTIL.getRSAKeyFromEncryptedPKCS5PEM(f, e);
    }
    if (f.indexOf("-END EC PRIVATE KEY-") != -1 && f.indexOf("4,ENCRYPTED") != -1) {
      var u = KEYUTIL.getDecryptedKeyHex(f, e);
      var w = ASN1HEX.getVbyList(u, 0, [1], "04");
      var c = ASN1HEX.getVbyList(u, 0, [2, 0], "06");
      var o = ASN1HEX.getVbyList(u, 0, [3, 0], "03").substr(2);
      var b = "";
      if (KJUR.crypto.OID.oidhex2name[c] !== undefined) {
        b = KJUR.crypto.OID.oidhex2name[c];
      } else {
        throw "undefined OID(hex) in KJUR.crypto.OID: " + c;
      }
      var d = new KJUR.crypto.ECDSA({name: b});
      d.setPublicKeyHex(o);
      d.setPrivateKeyHex(w);
      d.isPublic = false;
      return d;
    }
    if (f.indexOf("-END DSA PRIVATE KEY-") != -1 && f.indexOf("4,ENCRYPTED") != -1) {
      var u = KEYUTIL.getDecryptedKeyHex(f, e);
      var t = ASN1HEX.getVbyList(u, 0, [1], "02");
      var s = ASN1HEX.getVbyList(u, 0, [2], "02");
      var v = ASN1HEX.getVbyList(u, 0, [3], "02");
      var j = ASN1HEX.getVbyList(u, 0, [4], "02");
      var k = ASN1HEX.getVbyList(u, 0, [5], "02");
      var w = new KJUR.crypto.DSA();
      w.setPrivate(new BigInteger(t, 16), new BigInteger(s, 16), new BigInteger(v, 16), new BigInteger(j, 16), new BigInteger(k, 16));
      return w;
    }
    if (f.indexOf("-END ENCRYPTED PRIVATE KEY-") != -1) {
      return KEYUTIL.getKeyFromEncryptedPKCS8PEM(f, e);
    }
    throw "not supported argument";
  };
  KEYUTIL.generateKeypair = function(a, c) {
    if (a == "RSA") {
      var b = c;
      var h = new RSAKey();
      h.generate(b, "10001");
      h.isPrivate = true;
      h.isPublic = true;
      var f = new RSAKey();
      var e = h.n.toString(16);
      var i = h.e.toString(16);
      f.setPublic(e, i);
      f.isPrivate = false;
      f.isPublic = true;
      var k = {};
      k.prvKeyObj = h;
      k.pubKeyObj = f;
      return k;
    } else {
      if (a == "EC") {
        var d = c;
        var g = new KJUR.crypto.ECDSA({curve: d});
        var j = g.generateKeyPairHex();
        var h = new KJUR.crypto.ECDSA({curve: d});
        h.setPrivateKeyHex(j.ecprvhex);
        h.isPrivate = true;
        h.isPublic = false;
        var f = new KJUR.crypto.ECDSA({curve: d});
        f.setPublicKeyHex(j.ecpubhex);
        f.isPrivate = false;
        f.isPublic = true;
        var k = {};
        k.prvKeyObj = h;
        k.pubKeyObj = f;
        return k;
      } else {
        throw "unknown algorithm: " + a;
      }
    }
  };
  KEYUTIL.getPEM = function(a, r, o, g, j) {
    var v = KJUR.asn1;
    var u = KJUR.crypto;
    function p(s) {
      var w = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 0}, {"int": {bigint: s.n}}, {"int": s.e}, {"int": {bigint: s.d}}, {"int": {bigint: s.p}}, {"int": {bigint: s.q}}, {"int": {bigint: s.dmp1}}, {"int": {bigint: s.dmq1}}, {"int": {bigint: s.coeff}}]});
      return w;
    }
    function q(w) {
      var s = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 1}, {octstr: {hex: w.prvKeyHex}}, {tag: ["a0", true, {oid: {name: w.curveName}}]}, {tag: ["a1", true, {bitstr: {hex: "00" + w.pubKeyHex}}]}]});
      return s;
    }
    function n(s) {
      var w = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 0}, {"int": {bigint: s.p}}, {"int": {bigint: s.q}}, {"int": {bigint: s.g}}, {"int": {bigint: s.y}}, {"int": {bigint: s.x}}]});
      return w;
    }
    if (((typeof RSAKey != "undefined" && a instanceof RSAKey) || (typeof u.DSA != "undefined" && a instanceof u.DSA) || (typeof u.ECDSA != "undefined" && a instanceof u.ECDSA)) && a.isPublic == true && (r === undefined || r == "PKCS8PUB")) {
      var t = new KJUR.asn1.x509.SubjectPublicKeyInfo(a);
      var m = t.getEncodedHex();
      return v.ASN1Util.getPEMStringFromHex(m, "PUBLIC KEY");
    }
    if (r == "PKCS1PRV" && typeof RSAKey != "undefined" && a instanceof RSAKey && (o === undefined || o == null) && a.isPrivate == true) {
      var t = p(a);
      var m = t.getEncodedHex();
      return v.ASN1Util.getPEMStringFromHex(m, "RSA PRIVATE KEY");
    }
    if (r == "PKCS1PRV" && typeof RSAKey != "undefined" && a instanceof KJUR.crypto.ECDSA && (o === undefined || o == null) && a.isPrivate == true) {
      var f = new KJUR.asn1.DERObjectIdentifier({name: a.curveName});
      var l = f.getEncodedHex();
      var e = q(a);
      var k = e.getEncodedHex();
      var i = "";
      i += v.ASN1Util.getPEMStringFromHex(l, "EC PARAMETERS");
      i += v.ASN1Util.getPEMStringFromHex(k, "EC PRIVATE KEY");
      return i;
    }
    if (r == "PKCS1PRV" && typeof KJUR.crypto.DSA != "undefined" && a instanceof KJUR.crypto.DSA && (o === undefined || o == null) && a.isPrivate == true) {
      var t = n(a);
      var m = t.getEncodedHex();
      return v.ASN1Util.getPEMStringFromHex(m, "DSA PRIVATE KEY");
    }
    if (r == "PKCS5PRV" && typeof RSAKey != "undefined" && a instanceof RSAKey && (o !== undefined && o != null) && a.isPrivate == true) {
      var t = p(a);
      var m = t.getEncodedHex();
      if (g === undefined) {
        g = "DES-EDE3-CBC";
      }
      return this.getEncryptedPKCS5PEMFromPrvKeyHex("RSA", m, o, g);
    }
    if (r == "PKCS5PRV" && typeof KJUR.crypto.ECDSA != "undefined" && a instanceof KJUR.crypto.ECDSA && (o !== undefined && o != null) && a.isPrivate == true) {
      var t = q(a);
      var m = t.getEncodedHex();
      if (g === undefined) {
        g = "DES-EDE3-CBC";
      }
      return this.getEncryptedPKCS5PEMFromPrvKeyHex("EC", m, o, g);
    }
    if (r == "PKCS5PRV" && typeof KJUR.crypto.DSA != "undefined" && a instanceof KJUR.crypto.DSA && (o !== undefined && o != null) && a.isPrivate == true) {
      var t = n(a);
      var m = t.getEncodedHex();
      if (g === undefined) {
        g = "DES-EDE3-CBC";
      }
      return this.getEncryptedPKCS5PEMFromPrvKeyHex("DSA", m, o, g);
    }
    var h = function(w, s) {
      var y = b(w, s);
      var x = new KJUR.asn1.ASN1Util.newObject({seq: [{seq: [{oid: {name: "pkcs5PBES2"}}, {seq: [{seq: [{oid: {name: "pkcs5PBKDF2"}}, {seq: [{octstr: {hex: y.pbkdf2Salt}}, {"int": y.pbkdf2Iter}]}]}, {seq: [{oid: {name: "des-EDE3-CBC"}}, {octstr: {hex: y.encryptionSchemeIV}}]}]}]}, {octstr: {hex: y.ciphertext}}]});
      return x.getEncodedHex();
    };
    var b = function(D, E) {
      var x = 100;
      var C = CryptoJS.lib.WordArray.random(8);
      var B = "DES-EDE3-CBC";
      var s = CryptoJS.lib.WordArray.random(8);
      var y = CryptoJS.PBKDF2(E, C, {
        keySize: 192 / 32,
        iterations: x
      });
      var z = CryptoJS.enc.Hex.parse(D);
      var A = CryptoJS.TripleDES.encrypt(z, y, {iv: s}) + "";
      var w = {};
      w.ciphertext = A;
      w.pbkdf2Salt = CryptoJS.enc.Hex.stringify(C);
      w.pbkdf2Iter = x;
      w.encryptionSchemeAlg = B;
      w.encryptionSchemeIV = CryptoJS.enc.Hex.stringify(s);
      return w;
    };
    if (r == "PKCS8PRV" && typeof RSAKey != "undefined" && a instanceof RSAKey && a.isPrivate == true) {
      var d = p(a);
      var c = d.getEncodedHex();
      var t = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 0}, {seq: [{oid: {name: "rsaEncryption"}}, {"null": true}]}, {octstr: {hex: c}}]});
      var m = t.getEncodedHex();
      if (o === undefined || o == null) {
        return v.ASN1Util.getPEMStringFromHex(m, "PRIVATE KEY");
      } else {
        var k = h(m, o);
        return v.ASN1Util.getPEMStringFromHex(k, "ENCRYPTED PRIVATE KEY");
      }
    }
    if (r == "PKCS8PRV" && typeof KJUR.crypto.ECDSA != "undefined" && a instanceof KJUR.crypto.ECDSA && a.isPrivate == true) {
      var d = new KJUR.asn1.ASN1Util.newObject({seq: [{"int": 1}, {octstr: {hex: a.prvKeyHex}}, {tag: ["a1", true, {bitstr: {hex: "00" + a.pubKeyHex}}]}]});
      var c = d.getEncodedHex();
      var t = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 0}, {seq: [{oid: {name: "ecPublicKey"}}, {oid: {name: a.curveName}}]}, {octstr: {hex: c}}]});
      var m = t.getEncodedHex();
      if (o === undefined || o == null) {
        return v.ASN1Util.getPEMStringFromHex(m, "PRIVATE KEY");
      } else {
        var k = h(m, o);
        return v.ASN1Util.getPEMStringFromHex(k, "ENCRYPTED PRIVATE KEY");
      }
    }
    if (r == "PKCS8PRV" && typeof KJUR.crypto.DSA != "undefined" && a instanceof KJUR.crypto.DSA && a.isPrivate == true) {
      var d = new KJUR.asn1.DERInteger({bigint: a.x});
      var c = d.getEncodedHex();
      var t = KJUR.asn1.ASN1Util.newObject({seq: [{"int": 0}, {seq: [{oid: {name: "dsa"}}, {seq: [{"int": {bigint: a.p}}, {"int": {bigint: a.q}}, {"int": {bigint: a.g}}]}]}, {octstr: {hex: c}}]});
      var m = t.getEncodedHex();
      if (o === undefined || o == null) {
        return v.ASN1Util.getPEMStringFromHex(m, "PRIVATE KEY");
      } else {
        var k = h(m, o);
        return v.ASN1Util.getPEMStringFromHex(k, "ENCRYPTED PRIVATE KEY");
      }
    }
    throw "unsupported object nor format";
  };
  KEYUTIL.getKeyFromCSRPEM = function(b) {
    var a = KEYUTIL.getHexFromPEM(b, "CERTIFICATE REQUEST");
    var c = KEYUTIL.getKeyFromCSRHex(a);
    return c;
  };
  KEYUTIL.getKeyFromCSRHex = function(a) {
    var c = KEYUTIL.parseCSRHex(a);
    var b = KEYUTIL.getKey(c.p8pubkeyhex, null, "pkcs8pub");
    return b;
  };
  KEYUTIL.parseCSRHex = function(c) {
    var b = {};
    var e = c;
    if (e.substr(0, 2) != "30") {
      throw "malformed CSR(code:001)";
    }
    var d = ASN1HEX.getPosArrayOfChildren_AtObj(e, 0);
    if (d.length < 1) {
      throw "malformed CSR(code:002)";
    }
    if (e.substr(d[0], 2) != "30") {
      throw "malformed CSR(code:003)";
    }
    var a = ASN1HEX.getPosArrayOfChildren_AtObj(e, d[0]);
    if (a.length < 3) {
      throw "malformed CSR(code:004)";
    }
    b.p8pubkeyhex = ASN1HEX.getHexOfTLV_AtObj(e, a[2]);
    return b;
  };
  function _rsapem_pemToBase64(b) {
    var a = b;
    a = a.replace("-----BEGIN RSA PRIVATE KEY-----", "");
    a = a.replace("-----END RSA PRIVATE KEY-----", "");
    a = a.replace(/[ \n]+/g, "");
    return a;
  }
  function _rsapem_getPosArrayOfChildrenFromHex(d) {
    var j = new Array();
    var k = ASN1HEX.getStartPosOfV_AtObj(d, 0);
    var f = ASN1HEX.getPosOfNextSibling_AtObj(d, k);
    var h = ASN1HEX.getPosOfNextSibling_AtObj(d, f);
    var b = ASN1HEX.getPosOfNextSibling_AtObj(d, h);
    var l = ASN1HEX.getPosOfNextSibling_AtObj(d, b);
    var e = ASN1HEX.getPosOfNextSibling_AtObj(d, l);
    var g = ASN1HEX.getPosOfNextSibling_AtObj(d, e);
    var c = ASN1HEX.getPosOfNextSibling_AtObj(d, g);
    var i = ASN1HEX.getPosOfNextSibling_AtObj(d, c);
    j.push(k, f, h, b, l, e, g, c, i);
    return j;
  }
  function _rsapem_getHexValueArrayOfChildrenFromHex(i) {
    var o = _rsapem_getPosArrayOfChildrenFromHex(i);
    var r = ASN1HEX.getHexOfV_AtObj(i, o[0]);
    var f = ASN1HEX.getHexOfV_AtObj(i, o[1]);
    var j = ASN1HEX.getHexOfV_AtObj(i, o[2]);
    var k = ASN1HEX.getHexOfV_AtObj(i, o[3]);
    var c = ASN1HEX.getHexOfV_AtObj(i, o[4]);
    var b = ASN1HEX.getHexOfV_AtObj(i, o[5]);
    var h = ASN1HEX.getHexOfV_AtObj(i, o[6]);
    var g = ASN1HEX.getHexOfV_AtObj(i, o[7]);
    var l = ASN1HEX.getHexOfV_AtObj(i, o[8]);
    var m = new Array();
    m.push(r, f, j, k, c, b, h, g, l);
    return m;
  }
  function _rsapem_readPrivateKeyFromASN1HexString(c) {
    var b = _rsapem_getHexValueArrayOfChildrenFromHex(c);
    this.setPrivateEx(b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
  }
  function _rsapem_readPrivateKeyFromPEMString(e) {
    var c = _rsapem_pemToBase64(e);
    var d = b64tohex(c);
    var b = _rsapem_getHexValueArrayOfChildrenFromHex(d);
    this.setPrivateEx(b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
  }
  RSAKey.prototype.readPrivateKeyFromPEMString = _rsapem_readPrivateKeyFromPEMString;
  RSAKey.prototype.readPrivateKeyFromASN1HexString = _rsapem_readPrivateKeyFromASN1HexString;
  var _RE_HEXDECONLY = new RegExp("");
  _RE_HEXDECONLY.compile("[^0-9a-f]", "gi");
  function _rsasign_getHexPaddedDigestInfoForString(d, e, a) {
    var b = function(f) {
      return KJUR.crypto.Util.hashString(f, a);
    };
    var c = b(d);
    return KJUR.crypto.Util.getPaddedDigestInfoHex(c, a, e);
  }
  function _zeroPaddingOfSignature(e, d) {
    var c = "";
    var a = d / 4 - e.length;
    for (var b = 0; b < a; b++) {
      c = c + "0";
    }
    return c + e;
  }
  function _rsasign_signString(d, a) {
    var b = function(e) {
      return KJUR.crypto.Util.hashString(e, a);
    };
    var c = b(d);
    return this.signWithMessageHash(c, a);
  }
  function _rsasign_signWithMessageHash(e, c) {
    var f = KJUR.crypto.Util.getPaddedDigestInfoHex(e, c, this.n.bitLength());
    var b = parseBigInt(f, 16);
    var d = this.doPrivate(b);
    var a = d.toString(16);
    return _zeroPaddingOfSignature(a, this.n.bitLength());
  }
  function _rsasign_signStringWithSHA1(a) {
    return _rsasign_signString.call(this, a, "sha1");
  }
  function _rsasign_signStringWithSHA256(a) {
    return _rsasign_signString.call(this, a, "sha256");
  }
  function pss_mgf1_str(c, a, e) {
    var b = "",
        d = 0;
    while (b.length < a) {
      b += hextorstr(e(rstrtohex(c + String.fromCharCode.apply(String, [(d & 4278190080) >> 24, (d & 16711680) >> 16, (d & 65280) >> 8, d & 255]))));
      d += 1;
    }
    return b;
  }
  function _rsasign_signStringPSS(e, a, d) {
    var c = function(f) {
      return KJUR.crypto.Util.hashHex(f, a);
    };
    var b = c(rstrtohex(e));
    if (d === undefined) {
      d = -1;
    }
    return this.signWithMessageHashPSS(b, a, d);
  }
  function _rsasign_signWithMessageHashPSS(l, a, k) {
    var b = hextorstr(l);
    var g = b.length;
    var m = this.n.bitLength() - 1;
    var c = Math.ceil(m / 8);
    var d;
    var o = function(i) {
      return KJUR.crypto.Util.hashHex(i, a);
    };
    if (k === -1 || k === undefined) {
      k = g;
    } else {
      if (k === -2) {
        k = c - g - 2;
      } else {
        if (k < -2) {
          throw "invalid salt length";
        }
      }
    }
    if (c < (g + k + 2)) {
      throw "data too long";
    }
    var f = "";
    if (k > 0) {
      f = new Array(k);
      new SecureRandom().nextBytes(f);
      f = String.fromCharCode.apply(String, f);
    }
    var n = hextorstr(o(rstrtohex("\x00\x00\x00\x00\x00\x00\x00\x00" + b + f)));
    var j = [];
    for (d = 0; d < c - k - g - 2; d += 1) {
      j[d] = 0;
    }
    var e = String.fromCharCode.apply(String, j) + "\x01" + f;
    var h = pss_mgf1_str(n, e.length, o);
    var q = [];
    for (d = 0; d < e.length; d += 1) {
      q[d] = e.charCodeAt(d) ^ h.charCodeAt(d);
    }
    var p = (65280 >> (8 * c - m)) & 255;
    q[0] &= ~p;
    for (d = 0; d < g; d++) {
      q.push(n.charCodeAt(d));
    }
    q.push(188);
    return _zeroPaddingOfSignature(this.doPrivate(new BigInteger(q)).toString(16), this.n.bitLength());
  }
  function _rsasign_getDecryptSignatureBI(a, d, c) {
    var b = new RSAKey();
    b.setPublic(d, c);
    var e = b.doPublic(a);
    return e;
  }
  function _rsasign_getHexDigestInfoFromSig(a, c, b) {
    var e = _rsasign_getDecryptSignatureBI(a, c, b);
    var d = e.toString(16).replace(/^1f+00/, "");
    return d;
  }
  function _rsasign_getAlgNameAndHashFromHexDisgestInfo(f) {
    for (var e in KJUR.crypto.Util.DIGESTINFOHEAD) {
      var d = KJUR.crypto.Util.DIGESTINFOHEAD[e];
      var b = d.length;
      if (f.substring(0, b) == d) {
        var c = [e, f.substring(b)];
        return c;
      }
    }
    return [];
  }
  function _rsasign_verifySignatureWithArgs(f, b, g, j) {
    var e = _rsasign_getHexDigestInfoFromSig(b, g, j);
    var h = _rsasign_getAlgNameAndHashFromHexDisgestInfo(e);
    if (h.length == 0) {
      return false;
    }
    var d = h[0];
    var i = h[1];
    var a = function(k) {
      return KJUR.crypto.Util.hashString(k, d);
    };
    var c = a(f);
    return (i == c);
  }
  function _rsasign_verifyHexSignatureForMessage(c, b) {
    var d = parseBigInt(c, 16);
    var a = _rsasign_verifySignatureWithArgs(b, d, this.n.toString(16), this.e.toString(16));
    return a;
  }
  function _rsasign_verifyString(f, j) {
    j = j.replace(_RE_HEXDECONLY, "");
    j = j.replace(/[ \n]+/g, "");
    var b = parseBigInt(j, 16);
    if (b.bitLength() > this.n.bitLength()) {
      return 0;
    }
    var i = this.doPublic(b);
    var e = i.toString(16).replace(/^1f+00/, "");
    var g = _rsasign_getAlgNameAndHashFromHexDisgestInfo(e);
    if (g.length == 0) {
      return false;
    }
    var d = g[0];
    var h = g[1];
    var a = function(k) {
      return KJUR.crypto.Util.hashString(k, d);
    };
    var c = a(f);
    return (h == c);
  }
  function _rsasign_verifyWithMessageHash(e, a) {
    a = a.replace(_RE_HEXDECONLY, "");
    a = a.replace(/[ \n]+/g, "");
    var b = parseBigInt(a, 16);
    if (b.bitLength() > this.n.bitLength()) {
      return 0;
    }
    var h = this.doPublic(b);
    var g = h.toString(16).replace(/^1f+00/, "");
    var c = _rsasign_getAlgNameAndHashFromHexDisgestInfo(g);
    if (c.length == 0) {
      return false;
    }
    var d = c[0];
    var f = c[1];
    return (f == e);
  }
  function _rsasign_verifyStringPSS(c, b, a, f) {
    var e = function(g) {
      return KJUR.crypto.Util.hashHex(g, a);
    };
    var d = e(rstrtohex(c));
    if (f === undefined) {
      f = -1;
    }
    return this.verifyWithMessageHashPSS(d, b, a, f);
  }
  function _rsasign_verifyWithMessageHashPSS(f, s, l, c) {
    var k = new BigInteger(s, 16);
    if (k.bitLength() > this.n.bitLength()) {
      return false;
    }
    var r = function(i) {
      return KJUR.crypto.Util.hashHex(i, l);
    };
    var j = hextorstr(f);
    var h = j.length;
    var g = this.n.bitLength() - 1;
    var m = Math.ceil(g / 8);
    var q;
    if (c === -1 || c === undefined) {
      c = h;
    } else {
      if (c === -2) {
        c = m - h - 2;
      } else {
        if (c < -2) {
          throw "invalid salt length";
        }
      }
    }
    if (m < (h + c + 2)) {
      throw "data too long";
    }
    var a = this.doPublic(k).toByteArray();
    for (q = 0; q < a.length; q += 1) {
      a[q] &= 255;
    }
    while (a.length < m) {
      a.unshift(0);
    }
    if (a[m - 1] !== 188) {
      throw "encoded message does not end in 0xbc";
    }
    a = String.fromCharCode.apply(String, a);
    var d = a.substr(0, m - h - 1);
    var e = a.substr(d.length, h);
    var p = (65280 >> (8 * m - g)) & 255;
    if ((d.charCodeAt(0) & p) !== 0) {
      throw "bits beyond keysize not zero";
    }
    var n = pss_mgf1_str(e, d.length, r);
    var o = [];
    for (q = 0; q < d.length; q += 1) {
      o[q] = d.charCodeAt(q) ^ n.charCodeAt(q);
    }
    o[0] &= ~p;
    var b = m - h - c - 2;
    for (q = 0; q < b; q += 1) {
      if (o[q] !== 0) {
        throw "leftmost octets not zero";
      }
    }
    if (o[b] !== 1) {
      throw "0x01 marker not found";
    }
    return e === hextorstr(r(rstrtohex("\x00\x00\x00\x00\x00\x00\x00\x00" + j + String.fromCharCode.apply(String, o.slice(-c)))));
  }
  RSAKey.prototype.signWithMessageHash = _rsasign_signWithMessageHash;
  RSAKey.prototype.signString = _rsasign_signString;
  RSAKey.prototype.signStringWithSHA1 = _rsasign_signStringWithSHA1;
  RSAKey.prototype.signStringWithSHA256 = _rsasign_signStringWithSHA256;
  RSAKey.prototype.sign = _rsasign_signString;
  RSAKey.prototype.signWithSHA1 = _rsasign_signStringWithSHA1;
  RSAKey.prototype.signWithSHA256 = _rsasign_signStringWithSHA256;
  RSAKey.prototype.signWithMessageHashPSS = _rsasign_signWithMessageHashPSS;
  RSAKey.prototype.signStringPSS = _rsasign_signStringPSS;
  RSAKey.prototype.signPSS = _rsasign_signStringPSS;
  RSAKey.SALT_LEN_HLEN = -1;
  RSAKey.SALT_LEN_MAX = -2;
  RSAKey.prototype.verifyWithMessageHash = _rsasign_verifyWithMessageHash;
  RSAKey.prototype.verifyString = _rsasign_verifyString;
  RSAKey.prototype.verifyHexSignatureForMessage = _rsasign_verifyHexSignatureForMessage;
  RSAKey.prototype.verify = _rsasign_verifyString;
  RSAKey.prototype.verifyHexSignatureForByteArrayMessage = _rsasign_verifyHexSignatureForMessage;
  RSAKey.prototype.verifyWithMessageHashPSS = _rsasign_verifyWithMessageHashPSS;
  RSAKey.prototype.verifyStringPSS = _rsasign_verifyStringPSS;
  RSAKey.prototype.verifyPSS = _rsasign_verifyStringPSS;
  RSAKey.SALT_LEN_RECOVER = -2;
  function X509() {
    this.subjectPublicKeyRSA = null;
    this.subjectPublicKeyRSA_hN = null;
    this.subjectPublicKeyRSA_hE = null;
    this.hex = null;
    this.getSerialNumberHex = function() {
      return ASN1HEX.getDecendantHexVByNthList(this.hex, 0, [0, 1]);
    };
    this.getIssuerHex = function() {
      return ASN1HEX.getDecendantHexTLVByNthList(this.hex, 0, [0, 3]);
    };
    this.getIssuerString = function() {
      return X509.hex2dn(ASN1HEX.getDecendantHexTLVByNthList(this.hex, 0, [0, 3]));
    };
    this.getSubjectHex = function() {
      return ASN1HEX.getDecendantHexTLVByNthList(this.hex, 0, [0, 5]);
    };
    this.getSubjectString = function() {
      return X509.hex2dn(ASN1HEX.getDecendantHexTLVByNthList(this.hex, 0, [0, 5]));
    };
    this.getNotBefore = function() {
      var a = ASN1HEX.getDecendantHexVByNthList(this.hex, 0, [0, 4, 0]);
      a = a.replace(/(..)/g, "%$1");
      a = decodeURIComponent(a);
      return a;
    };
    this.getNotAfter = function() {
      var a = ASN1HEX.getDecendantHexVByNthList(this.hex, 0, [0, 4, 1]);
      a = a.replace(/(..)/g, "%$1");
      a = decodeURIComponent(a);
      return a;
    };
    this.readCertPEM = function(c) {
      var e = X509.pemToHex(c);
      var b = X509.getPublicKeyHexArrayFromCertHex(e);
      var d = new RSAKey();
      d.setPublic(b[0], b[1]);
      this.subjectPublicKeyRSA = d;
      this.subjectPublicKeyRSA_hN = b[0];
      this.subjectPublicKeyRSA_hE = b[1];
      this.hex = e;
    };
    this.readCertPEMWithoutRSAInit = function(c) {
      var d = X509.pemToHex(c);
      var b = X509.getPublicKeyHexArrayFromCertHex(d);
      this.subjectPublicKeyRSA.setPublic(b[0], b[1]);
      this.subjectPublicKeyRSA_hN = b[0];
      this.subjectPublicKeyRSA_hE = b[1];
      this.hex = d;
    };
  }
  X509.pemToBase64 = function(a) {
    var b = a;
    b = b.replace("-----BEGIN CERTIFICATE-----", "");
    b = b.replace("-----END CERTIFICATE-----", "");
    b = b.replace(/[ \n]+/g, "");
    return b;
  };
  X509.pemToHex = function(a) {
    var c = X509.pemToBase64(a);
    var b = b64tohex(c);
    return b;
  };
  X509.getSubjectPublicKeyPosFromCertHex = function(f) {
    var e = X509.getSubjectPublicKeyInfoPosFromCertHex(f);
    if (e == -1) {
      return -1;
    }
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(f, e);
    if (b.length != 2) {
      return -1;
    }
    var d = b[1];
    if (f.substring(d, d + 2) != "03") {
      return -1;
    }
    var c = ASN1HEX.getStartPosOfV_AtObj(f, d);
    if (f.substring(c, c + 2) != "00") {
      return -1;
    }
    return c + 2;
  };
  X509.getSubjectPublicKeyInfoPosFromCertHex = function(d) {
    var c = ASN1HEX.getStartPosOfV_AtObj(d, 0);
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(d, c);
    if (b.length < 1) {
      return -1;
    }
    if (d.substring(b[0], b[0] + 10) == "a003020102") {
      if (b.length < 6) {
        return -1;
      }
      return b[6];
    } else {
      if (b.length < 5) {
        return -1;
      }
      return b[5];
    }
  };
  X509.getPublicKeyHexArrayFromCertHex = function(f) {
    var e = X509.getSubjectPublicKeyPosFromCertHex(f);
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(f, e);
    if (b.length != 2) {
      return [];
    }
    var d = ASN1HEX.getHexOfV_AtObj(f, b[0]);
    var c = ASN1HEX.getHexOfV_AtObj(f, b[1]);
    if (d != null && c != null) {
      return [d, c];
    } else {
      return [];
    }
  };
  X509.getHexTbsCertificateFromCert = function(b) {
    var a = ASN1HEX.getStartPosOfV_AtObj(b, 0);
    return a;
  };
  X509.getPublicKeyHexArrayFromCertPEM = function(c) {
    var d = X509.pemToHex(c);
    var b = X509.getPublicKeyHexArrayFromCertHex(d);
    return b;
  };
  X509.hex2dn = function(e) {
    var f = "";
    var c = ASN1HEX.getPosArrayOfChildren_AtObj(e, 0);
    for (var d = 0; d < c.length; d++) {
      var b = ASN1HEX.getHexOfTLV_AtObj(e, c[d]);
      f = f + "/" + X509.hex2rdn(b);
    }
    return f;
  };
  X509.hex2rdn = function(a) {
    var f = ASN1HEX.getDecendantHexTLVByNthList(a, 0, [0, 0]);
    var e = ASN1HEX.getDecendantHexVByNthList(a, 0, [0, 1]);
    var c = "";
    try {
      c = X509.DN_ATTRHEX[f];
    } catch (b) {
      c = f;
    }
    e = e.replace(/(..)/g, "%$1");
    var d = decodeURIComponent(e);
    return c + "=" + d;
  };
  X509.DN_ATTRHEX = {
    "0603550406": "C",
    "060355040a": "O",
    "060355040b": "OU",
    "0603550403": "CN",
    "0603550405": "SN",
    "0603550408": "ST",
    "0603550407": "L"
  };
  X509.getPublicKeyFromCertPEM = function(f) {
    var c = X509.getPublicKeyInfoPropOfCertPEM(f);
    if (c.algoid == "2a864886f70d010101") {
      var i = KEYUTIL.parsePublicRawRSAKeyHex(c.keyhex);
      var j = new RSAKey();
      j.setPublic(i.n, i.e);
      return j;
    } else {
      if (c.algoid == "2a8648ce3d0201") {
        var e = KJUR.crypto.OID.oidhex2name[c.algparam];
        var j = new KJUR.crypto.ECDSA({
          curve: e,
          info: c.keyhex
        });
        j.setPublicKeyHex(c.keyhex);
        return j;
      } else {
        if (c.algoid == "2a8648ce380401") {
          var b = ASN1HEX.getVbyList(c.algparam, 0, [0], "02");
          var a = ASN1HEX.getVbyList(c.algparam, 0, [1], "02");
          var d = ASN1HEX.getVbyList(c.algparam, 0, [2], "02");
          var h = ASN1HEX.getHexOfV_AtObj(c.keyhex, 0);
          h = h.substr(2);
          var j = new KJUR.crypto.DSA();
          j.setPublic(new BigInteger(b, 16), new BigInteger(a, 16), new BigInteger(d, 16), new BigInteger(h, 16));
          return j;
        } else {
          throw "unsupported key";
        }
      }
    }
  };
  X509.getPublicKeyInfoPropOfCertPEM = function(e) {
    var c = {};
    c.algparam = null;
    var g = X509.pemToHex(e);
    var d = ASN1HEX.getPosArrayOfChildren_AtObj(g, 0);
    if (d.length != 3) {
      throw "malformed X.509 certificate PEM (code:001)";
    }
    if (g.substr(d[0], 2) != "30") {
      throw "malformed X.509 certificate PEM (code:002)";
    }
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(g, d[0]);
    if (b.length < 7) {
      throw "malformed X.509 certificate PEM (code:003)";
    }
    var h = ASN1HEX.getPosArrayOfChildren_AtObj(g, b[6]);
    if (h.length != 2) {
      throw "malformed X.509 certificate PEM (code:004)";
    }
    var f = ASN1HEX.getPosArrayOfChildren_AtObj(g, h[0]);
    if (f.length != 2) {
      throw "malformed X.509 certificate PEM (code:005)";
    }
    c.algoid = ASN1HEX.getHexOfV_AtObj(g, f[0]);
    if (g.substr(f[1], 2) == "06") {
      c.algparam = ASN1HEX.getHexOfV_AtObj(g, f[1]);
    } else {
      if (g.substr(f[1], 2) == "30") {
        c.algparam = ASN1HEX.getHexOfTLV_AtObj(g, f[1]);
      }
    }
    if (g.substr(h[1], 2) != "03") {
      throw "malformed X.509 certificate PEM (code:006)";
    }
    var a = ASN1HEX.getHexOfV_AtObj(g, h[1]);
    c.keyhex = a.substr(2);
    return c;
  };
  X509.getPublicKeyInfoPosOfCertHEX = function(c) {
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(c, 0);
    if (b.length != 3) {
      throw "malformed X.509 certificate PEM (code:001)";
    }
    if (c.substr(b[0], 2) != "30") {
      throw "malformed X.509 certificate PEM (code:002)";
    }
    var a = ASN1HEX.getPosArrayOfChildren_AtObj(c, b[0]);
    if (a.length < 7) {
      throw "malformed X.509 certificate PEM (code:003)";
    }
    return a[6];
  };
  X509.getV3ExtInfoListOfCertHex = function(g) {
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(g, 0);
    if (b.length != 3) {
      throw "malformed X.509 certificate PEM (code:001)";
    }
    if (g.substr(b[0], 2) != "30") {
      throw "malformed X.509 certificate PEM (code:002)";
    }
    var a = ASN1HEX.getPosArrayOfChildren_AtObj(g, b[0]);
    if (a.length < 8) {
      throw "malformed X.509 certificate PEM (code:003)";
    }
    if (g.substr(a[7], 2) != "a3") {
      throw "malformed X.509 certificate PEM (code:004)";
    }
    var h = ASN1HEX.getPosArrayOfChildren_AtObj(g, a[7]);
    if (h.length != 1) {
      throw "malformed X.509 certificate PEM (code:005)";
    }
    if (g.substr(h[0], 2) != "30") {
      throw "malformed X.509 certificate PEM (code:006)";
    }
    var f = ASN1HEX.getPosArrayOfChildren_AtObj(g, h[0]);
    var e = f.length;
    var d = new Array(e);
    for (var c = 0; c < e; c++) {
      d[c] = X509.getV3ExtItemInfo_AtObj(g, f[c]);
    }
    return d;
  };
  X509.getV3ExtItemInfo_AtObj = function(f, g) {
    var e = {};
    e.posTLV = g;
    var b = ASN1HEX.getPosArrayOfChildren_AtObj(f, g);
    if (b.length != 2 && b.length != 3) {
      throw "malformed X.509v3 Ext (code:001)";
    }
    if (f.substr(b[0], 2) != "06") {
      throw "malformed X.509v3 Ext (code:002)";
    }
    var d = ASN1HEX.getHexOfV_AtObj(f, b[0]);
    e.oid = ASN1HEX.hextooidstr(d);
    e.critical = false;
    if (b.length == 3) {
      e.critical = true;
    }
    var c = b[b.length - 1];
    if (f.substr(c, 2) != "04") {
      throw "malformed X.509v3 Ext (code:003)";
    }
    e.posV = ASN1HEX.getStartPosOfV_AtObj(f, c);
    return e;
  };
  X509.getHexOfTLV_V3ExtValue = function(b, a) {
    var c = X509.getPosOfTLV_V3ExtValue(b, a);
    if (c == -1) {
      return "";
    }
    return ASN1HEX.getHexOfTLV_AtObj(b, c);
  };
  X509.getHexOfV_V3ExtValue = function(b, a) {
    var c = X509.getPosOfTLV_V3ExtValue(b, a);
    if (c == -1) {
      return "";
    }
    return ASN1HEX.getHexOfV_AtObj(b, c);
  };
  X509.getPosOfTLV_V3ExtValue = function(f, b) {
    var d = b;
    if (!b.match(/^[0-9.]+$/)) {
      d = KJUR.asn1.x509.OID.name2oid(b);
    }
    if (d == "") {
      return -1;
    }
    var c = X509.getV3ExtInfoListOfCertHex(f);
    for (var a = 0; a < c.length; a++) {
      var e = c[a];
      if (e.oid == d) {
        return e.posV;
      }
    }
    return -1;
  };
  X509.KEYUSAGE_NAME = ["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign", "encipherOnly", "decipherOnly"];
  X509.getExtKeyUsageBin = function(d) {
    var b = X509.getHexOfV_V3ExtValue(d, "keyUsage");
    if (b == "") {
      return "";
    }
    if (b.length % 2 != 0 || b.length <= 2) {
      throw "malformed key usage value";
    }
    var a = parseInt(b.substr(0, 2));
    var c = parseInt(b.substr(2), 16).toString(2);
    return c.substr(0, c.length - a);
  };
  X509.getExtKeyUsageString = function(e) {
    var d = X509.getExtKeyUsageBin(e);
    var b = new Array();
    for (var c = 0; c < d.length; c++) {
      if (d.substr(c, 1) == "1") {
        b.push(X509.KEYUSAGE_NAME[c]);
      }
    }
    return b.join(",");
  };
  X509.getExtAIAInfo = function(g) {
    var j = {};
    j.ocsp = [];
    j.caissuer = [];
    var h = X509.getPosOfTLV_V3ExtValue(g, "authorityInfoAccess");
    if (h == -1) {
      return null;
    }
    if (g.substr(h, 2) != "30") {
      throw "malformed AIA Extn Value";
    }
    var d = ASN1HEX.getPosArrayOfChildren_AtObj(g, h);
    for (var c = 0; c < d.length; c++) {
      var a = d[c];
      var b = ASN1HEX.getPosArrayOfChildren_AtObj(g, a);
      if (b.length != 2) {
        throw "malformed AccessDescription of AIA Extn";
      }
      var e = b[0];
      var f = b[1];
      if (ASN1HEX.getHexOfV_AtObj(g, e) == "2b06010505073001") {
        if (g.substr(f, 2) == "86") {
          j.ocsp.push(hextoutf8(ASN1HEX.getHexOfV_AtObj(g, f)));
        }
      }
      if (ASN1HEX.getHexOfV_AtObj(g, e) == "2b06010505073002") {
        if (g.substr(f, 2) == "86") {
          j.caissuer.push(hextoutf8(ASN1HEX.getHexOfV_AtObj(g, f)));
        }
      }
    }
    return j;
  };
  var jsonParse = (function() {
    var e = "(?:-?\\b(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\\b)";
    var j = '(?:[^\\0-\\x08\\x0a-\\x1f"\\\\]|\\\\(?:["/\\\\bfnrt]|u[0-9A-Fa-f]{4}))';
    var i = '(?:"' + j + '*")';
    var d = new RegExp("(?:false|true|null|[\\{\\}\\[\\]]|" + e + "|" + i + ")", "g");
    var k = new RegExp("\\\\(?:([^u])|u(.{4}))", "g");
    var g = {
      '"': '"',
      "/": "/",
      "\\": "\\",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t"
    };
    function h(l, m, n) {
      return m ? g[m] : String.fromCharCode(parseInt(n, 16));
    }
    var c = new String("");
    var a = "\\";
    var f = {
      "{": Object,
      "[": Array
    };
    var b = Object.hasOwnProperty;
    return function(u, q) {
      var p = u.match(d);
      var x;
      var v = p[0];
      var l = false;
      if ("{" === v) {
        x = {};
      } else {
        if ("[" === v) {
          x = [];
        } else {
          x = [];
          l = true;
        }
      }
      var t;
      var r = [x];
      for (var o = 1 - l,
          m = p.length; o < m; ++o) {
        v = p[o];
        var w;
        switch (v.charCodeAt(0)) {
          default:
            w = r[0];
            w[t || w.length] = +(v);
            t = void 0;
            break;
          case 34:
            v = v.substring(1, v.length - 1);
            if (v.indexOf(a) !== -1) {
              v = v.replace(k, h);
            }
            w = r[0];
            if (!t) {
              if (w instanceof Array) {
                t = w.length;
              } else {
                t = v || c;
                break;
              }
            }
            w[t] = v;
            t = void 0;
            break;
          case 91:
            w = r[0];
            r.unshift(w[t || w.length] = []);
            t = void 0;
            break;
          case 93:
            r.shift();
            break;
          case 102:
            w = r[0];
            w[t || w.length] = false;
            t = void 0;
            break;
          case 110:
            w = r[0];
            w[t || w.length] = null;
            t = void 0;
            break;
          case 116:
            w = r[0];
            w[t || w.length] = true;
            t = void 0;
            break;
          case 123:
            w = r[0];
            r.unshift(w[t || w.length] = {});
            t = void 0;
            break;
          case 125:
            r.shift();
            break;
        }
      }
      if (l) {
        if (r.length !== 1) {
          throw new Error();
        }
        x = x[0];
      } else {
        if (r.length) {
          throw new Error();
        }
      }
      if (q) {
        var s = function(C, B) {
          var D = C[B];
          if (D && typeof D === "object") {
            var n = null;
            for (var z in D) {
              if (b.call(D, z) && D !== C) {
                var y = s(D, z);
                if (y !== void 0) {
                  D[z] = y;
                } else {
                  if (!n) {
                    n = [];
                  }
                  n.push(z);
                }
              }
            }
            if (n) {
              for (var A = n.length; --A >= 0; ) {
                delete D[n[A]];
              }
            }
          }
          return q.call(C, B, D);
        };
        x = s({"": x}, "");
      }
      return x;
    };
  })();
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.jws == "undefined" || !KJUR.jws) {
    KJUR.jws = {};
  }
  KJUR.jws.JWS = function() {
    var b = KJUR.jws.JWS;
    this.parseJWS = function(f, h) {
      if ((this.parsedJWS !== undefined) && (h || (this.parsedJWS.sigvalH !== undefined))) {
        return;
      }
      if (f.match(/^([^.]+)\.([^.]+)\.([^.]+)$/) == null) {
        throw "JWS signature is not a form of 'Head.Payload.SigValue'.";
      }
      var i = RegExp.$1;
      var d = RegExp.$2;
      var j = RegExp.$3;
      var l = i + "." + d;
      this.parsedJWS = {};
      this.parsedJWS.headB64U = i;
      this.parsedJWS.payloadB64U = d;
      this.parsedJWS.sigvalB64U = j;
      this.parsedJWS.si = l;
      if (!h) {
        var g = b64utohex(j);
        var e = parseBigInt(g, 16);
        this.parsedJWS.sigvalH = g;
        this.parsedJWS.sigvalBI = e;
      }
      var c = b64utoutf8(i);
      var k = b64utoutf8(d);
      this.parsedJWS.headS = c;
      this.parsedJWS.payloadS = k;
      if (!b.isSafeJSONString(c, this.parsedJWS, "headP")) {
        throw "malformed JSON string for JWS Head: " + c;
      }
    };
  };
  KJUR.jws.JWS.sign = function(b, j, d, n, m) {
    var l = KJUR.jws.JWS;
    var r,
        f,
        k;
    if (typeof j != "string" && typeof j != "object") {
      throw "spHeader must be JSON string or object: " + j;
    }
    if (typeof j == "object") {
      f = j;
      r = JSON.stringify(f);
    }
    if (typeof j == "string") {
      r = j;
      if (!l.isSafeJSONString(r)) {
        throw "JWS Head is not safe JSON string: " + r;
      }
      f = l.readSafeJSONString(r);
    }
    k = d;
    if (typeof d == "object") {
      k = JSON.stringify(d);
    }
    if ((b == "" || b == null) && f.alg !== undefined) {
      b = f.alg;
    }
    if ((b != "" && b != null) && f.alg === undefined) {
      f.alg = b;
      r = JSON.stringify(f);
    }
    if (b !== f.alg) {
      throw "alg and sHeader.alg doesn't match: " + b + "!=" + f.alg;
    }
    var e = null;
    if (l.jwsalg2sigalg[b] === undefined) {
      throw "unsupported alg name: " + b;
    } else {
      e = l.jwsalg2sigalg[b];
    }
    var c = utf8tob64u(r);
    var h = utf8tob64u(k);
    var p = c + "." + h;
    var o = "";
    if (e.substr(0, 4) == "Hmac") {
      if (n === undefined) {
        throw "mac key shall be specified for HS* alg";
      }
      var i = new KJUR.crypto.Mac({
        alg: e,
        prov: "cryptojs",
        pass: n
      });
      i.updateString(p);
      o = i.doFinal();
    } else {
      if (e.indexOf("withECDSA") != -1) {
        var q = new KJUR.crypto.Signature({alg: e});
        q.init(n, m);
        q.updateString(p);
        hASN1Sig = q.sign();
        o = KJUR.crypto.ECDSA.asn1SigToConcatSig(hASN1Sig);
      } else {
        if (e != "none") {
          var q = new KJUR.crypto.Signature({alg: e});
          q.init(n, m);
          q.updateString(p);
          o = q.sign();
        }
      }
    }
    var g = hextob64u(o);
    return p + "." + g;
  };
  KJUR.jws.JWS.verify = function(p, t, j) {
    var m = KJUR.jws.JWS;
    var q = p.split(".");
    var d = q[0];
    var l = q[1];
    var b = d + "." + l;
    var r = b64utohex(q[2]);
    var i = m.readSafeJSONString(b64utoutf8(q[0]));
    var h = null;
    var s = null;
    if (i.alg === undefined) {
      throw "algorithm not specified in header";
    } else {
      h = i.alg;
      s = h.substr(0, 2);
    }
    if (j != null && Object.prototype.toString.call(j) === "[object Array]" && j.length > 0) {
      var c = ":" + j.join(":") + ":";
      if (c.indexOf(":" + h + ":") == -1) {
        throw "algorithm '" + h + "' not accepted in the list";
      }
    }
    if (h != "none" && t === null) {
      throw "key shall be specified to verify.";
    }
    if (s == "HS") {
      if (typeof t != "string" && t.length != 0 && t.length % 2 != 0 && !t.match(/^[0-9A-Fa-f]+/)) {
        throw "key shall be a hexadecimal str for HS* algs";
      }
    }
    if (typeof t == "string" && t.indexOf("-----BEGIN ") != -1) {
      t = KEYUTIL.getKey(t);
    }
    if (s == "RS" || s == "PS") {
      if (!(t instanceof RSAKey)) {
        throw "key shall be a RSAKey obj for RS* and PS* algs";
      }
    }
    if (s == "ES") {
      if (!(t instanceof KJUR.crypto.ECDSA)) {
        throw "key shall be a ECDSA obj for ES* algs";
      }
    }
    if (h == "none") {}
    var n = null;
    if (m.jwsalg2sigalg[i.alg] === undefined) {
      throw "unsupported alg name: " + h;
    } else {
      n = m.jwsalg2sigalg[h];
    }
    if (n == "none") {
      throw "not supported";
    } else {
      if (n.substr(0, 4) == "Hmac") {
        var k = null;
        if (t === undefined) {
          throw "hexadecimal key shall be specified for HMAC";
        }
        var g = new KJUR.crypto.Mac({
          alg: n,
          pass: t
        });
        g.updateString(b);
        k = g.doFinal();
        return r == k;
      } else {
        if (n.indexOf("withECDSA") != -1) {
          var f = null;
          try {
            f = KJUR.crypto.ECDSA.concatSigToASN1Sig(r);
          } catch (o) {
            return false;
          }
          var e = new KJUR.crypto.Signature({alg: n});
          e.init(t);
          e.updateString(b);
          return e.verify(f);
        } else {
          var e = new KJUR.crypto.Signature({alg: n});
          e.init(t);
          e.updateString(b);
          return e.verify(r);
        }
      }
    }
  };
  KJUR.jws.JWS.verifyJWT = function(d, j, l) {
    var h = KJUR.jws.JWS;
    var i = d.split(".");
    var c = i[0];
    var g = i[1];
    var m = c + "." + g;
    var k = b64utohex(i[2]);
    var f = h.readSafeJSONString(b64utoutf8(c));
    var e = h.readSafeJSONString(b64utoutf8(g));
    if (f.alg === undefined) {
      return false;
    }
    if (l.alg === undefined) {
      throw "acceptField.alg shall be specified";
    }
    if (!h.inArray(f.alg, l.alg)) {
      return false;
    }
    if (e.iss !== undefined && typeof l.iss === "object") {
      if (!h.inArray(e.iss, l.iss)) {
        return false;
      }
    }
    if (e.sub !== undefined && typeof l.sub === "object") {
      if (!h.inArray(e.sub, l.sub)) {
        return false;
      }
    }
    if (e.aud !== undefined && typeof l.aud === "object") {
      if (typeof e.aud == "string") {
        if (!h.inArray(e.aud, l.aud)) {
          return false;
        }
      } else {
        if (typeof e.aud == "object") {
          if (!h.includedArray(e.aud, l.aud)) {
            return false;
          }
        }
      }
    }
    var b = KJUR.jws.IntDate.getNow();
    if (l.verifyAt !== undefined && typeof l.verifyAt == "number") {
      b = l.verifyAt;
    }
    if (e.exp !== undefined && typeof e.exp == "number") {
      if (e.exp < b) {
        return false;
      }
    }
    if (e.nbf !== undefined && typeof e.nbf == "number") {
      if (b < e.nbf) {
        return false;
      }
    }
    if (e.iat !== undefined && typeof e.iat == "number") {
      if (b < e.iat) {
        return false;
      }
    }
    if (e.jti !== undefined && l.jti !== undefined) {
      if (e.jti !== l.jti) {
        return false;
      }
    }
    if (!KJUR.jws.JWS.verify(d, j, l.alg)) {
      return false;
    }
    return true;
  };
  KJUR.jws.JWS.includedArray = function(c, b) {
    var e = KJUR.jws.JWS.inArray;
    if (c === null) {
      return false;
    }
    if (typeof c !== "object") {
      return false;
    }
    if (typeof c.length !== "number") {
      return false;
    }
    for (var d = 0; d < c.length; d++) {
      if (!e(c[d], b)) {
        return false;
      }
    }
    return true;
  };
  KJUR.jws.JWS.inArray = function(d, b) {
    if (b === null) {
      return false;
    }
    if (typeof b !== "object") {
      return false;
    }
    if (typeof b.length !== "number") {
      return false;
    }
    for (var c = 0; c < b.length; c++) {
      if (b[c] == d) {
        return true;
      }
    }
    return false;
  };
  KJUR.jws.JWS.jwsalg2sigalg = {
    HS256: "HmacSHA256",
    HS384: "HmacSHA384",
    HS512: "HmacSHA512",
    RS256: "SHA256withRSA",
    RS384: "SHA384withRSA",
    RS512: "SHA512withRSA",
    ES256: "SHA256withECDSA",
    ES384: "SHA384withECDSA",
    PS256: "SHA256withRSAandMGF1",
    PS384: "SHA384withRSAandMGF1",
    PS512: "SHA512withRSAandMGF1",
    none: "none"
  };
  KJUR.jws.JWS.isSafeJSONString = function(d, c, e) {
    var f = null;
    try {
      f = jsonParse(d);
      if (typeof f != "object") {
        return 0;
      }
      if (f.constructor === Array) {
        return 0;
      }
      if (c) {
        c[e] = f;
      }
      return 1;
    } catch (b) {
      return 0;
    }
  };
  KJUR.jws.JWS.readSafeJSONString = function(c) {
    var d = null;
    try {
      d = jsonParse(c);
      if (typeof d != "object") {
        return null;
      }
      if (d.constructor === Array) {
        return null;
      }
      return d;
    } catch (b) {
      return null;
    }
  };
  KJUR.jws.JWS.getEncodedSignatureValueFromJWS = function(b) {
    if (b.match(/^[^.]+\.[^.]+\.([^.]+)$/) == null) {
      throw "JWS signature is not a form of 'Head.Payload.SigValue'.";
    }
    return RegExp.$1;
  };
  KJUR.jws.IntDate = {};
  KJUR.jws.IntDate.get = function(b) {
    if (b == "now") {
      return KJUR.jws.IntDate.getNow();
    } else {
      if (b == "now + 1hour") {
        return KJUR.jws.IntDate.getNow() + 60 * 60;
      } else {
        if (b == "now + 1day") {
          return KJUR.jws.IntDate.getNow() + 60 * 60 * 24;
        } else {
          if (b == "now + 1month") {
            return KJUR.jws.IntDate.getNow() + 60 * 60 * 24 * 30;
          } else {
            if (b == "now + 1year") {
              return KJUR.jws.IntDate.getNow() + 60 * 60 * 24 * 365;
            } else {
              if (b.match(/Z$/)) {
                return KJUR.jws.IntDate.getZulu(b);
              } else {
                if (b.match(/^[0-9]+$/)) {
                  return parseInt(b);
                }
              }
            }
          }
        }
      }
    }
    throw "unsupported format: " + b;
  };
  KJUR.jws.IntDate.getZulu = function(h) {
    if (a = h.match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z/)) {
      var g = parseInt(RegExp.$1);
      var i = parseInt(RegExp.$2) - 1;
      var c = parseInt(RegExp.$3);
      var b = parseInt(RegExp.$4);
      var e = parseInt(RegExp.$5);
      var f = parseInt(RegExp.$6);
      var j = new Date(Date.UTC(g, i, c, b, e, f));
      return ~~(j / 1000);
    }
    throw "unsupported format: " + h;
  };
  KJUR.jws.IntDate.getNow = function() {
    var b = ~~(new Date() / 1000);
    return b;
  };
  KJUR.jws.IntDate.intDate2UTCString = function(b) {
    var c = new Date(b * 1000);
    return c.toUTCString();
  };
  KJUR.jws.IntDate.intDate2Zulu = function(f) {
    var j = new Date(f * 1000);
    var i = ("0000" + j.getUTCFullYear()).slice(-4);
    var h = ("00" + (j.getUTCMonth() + 1)).slice(-2);
    var c = ("00" + j.getUTCDate()).slice(-2);
    var b = ("00" + j.getUTCHours()).slice(-2);
    var e = ("00" + j.getUTCMinutes()).slice(-2);
    var g = ("00" + j.getUTCSeconds()).slice(-2);
    return i + h + c + b + e + g + "Z";
  };
  if (typeof KJUR == "undefined" || !KJUR) {
    KJUR = {};
  }
  if (typeof KJUR.jws == "undefined" || !KJUR.jws) {
    KJUR.jws = {};
  }
  KJUR.jws.JWSJS = function() {
    var a = KJUR.jws.JWS;
    this.aHeader = [];
    this.sPayload = "";
    this.aSignature = [];
    this.init = function() {
      this.aHeader = [];
      this.sPayload = "";
      this.aSignature = [];
    };
    this.initWithJWS = function(c) {
      this.init();
      var b = new KJUR.jws.JWS();
      b.parseJWS(c);
      this.aHeader.push(b.parsedJWS.headB64U);
      this.sPayload = b.parsedJWS.payloadB64U;
      this.aSignature.push(b.parsedJWS.sigvalB64U);
    };
    this.addSignatureByHeaderKey = function(e, b) {
      var d = b64utoutf8(this.sPayload);
      var c = new KJUR.jws.JWS();
      var f = c.generateJWSByP1PrvKey(e, d, b);
      this.aHeader.push(c.parsedJWS.headB64U);
      this.aSignature.push(c.parsedJWS.sigvalB64U);
    };
    this.addSignatureByHeaderPayloadKey = function(e, d, b) {
      var c = new KJUR.jws.JWS();
      var f = c.generateJWSByP1PrvKey(e, d, b);
      this.aHeader.push(c.parsedJWS.headB64U);
      this.sPayload = c.parsedJWS.payloadB64U;
      this.aSignature.push(c.parsedJWS.sigvalB64U);
    };
    this.verifyWithCerts = function(c) {
      if (this.aHeader.length != c.length) {
        throw "num headers does not match with num certs";
      }
      if (this.aSignature.length != c.length) {
        throw "num signatures does not match with num certs";
      }
      var k = this.sPayload;
      var g = "";
      for (var d = 0; d < c.length; d++) {
        var e = c[d];
        var f = this.aHeader[d];
        var m = this.aSignature[d];
        var b = f + "." + k + "." + m;
        var j = new KJUR.jws.JWS();
        try {
          var l = j.verifyJWSByPemX509Cert(b, e);
          if (l != 1) {
            g += (d + 1) + "th signature unmatch. ";
          }
        } catch (h) {
          g += (d + 1) + "th signature fail(" + h + "). ";
        }
      }
      if (g == "") {
        return 1;
      } else {
        throw g;
      }
    };
    this.readJWSJS = function(b) {
      var c = a.readSafeJSONString(b);
      if (c == null) {
        throw "argument is not JSON string: " + b;
      }
      this.aHeader = c.headers;
      this.sPayload = c.payload;
      this.aSignature = c.signatures;
    };
    this.getJSON = function() {
      return {
        headers: this.aHeader,
        payload: this.sPayload,
        signatures: this.aSignature
      };
    };
    this.isEmpty = function() {
      if (this.aHeader.length == 0) {
        return 1;
      }
      return 0;
    };
  };
  exports.BigInteger = BigInteger;
  exports.RSAKey = RSAKey;
  exports.ECDSA = KJUR.crypto.ECDSA;
  exports.DSA = KJUR.crypto.DSA;
  exports.Signature = KJUR.crypto.Signature;
  exports.MessageDigest = KJUR.crypto.MessageDigest;
  exports.Mac = KJUR.crypto.Mac;
  exports.KEYUTIL = KEYUTIL;
  exports.ASN1HEX = ASN1HEX;
  exports.X509 = X509;
  exports.b64tohex = b64tohex;
  exports.b64toBA = b64toBA;
  exports.stoBA = stoBA;
  exports.BAtos = BAtos;
  exports.BAtohex = BAtohex;
  exports.stohex = stohex;
  exports.stob64 = stob64;
  exports.stob64u = stob64u;
  exports.b64utos = b64utos;
  exports.b64tob64u = b64tob64u;
  exports.b64utob64 = b64utob64;
  exports.hex2b64 = hex2b64;
  exports.hextob64u = hextob64u;
  exports.b64utohex = b64utohex;
  exports.b64tohex = b64tohex;
  exports.utf8tob64u = utf8tob64u;
  exports.b64utoutf8 = b64utoutf8;
  exports.utf8tob64 = utf8tob64;
  exports.b64toutf8 = b64toutf8;
  exports.utf8tohex = utf8tohex;
  exports.hextoutf8 = hextoutf8;
  exports.hextorstr = hextorstr;
  exports.rstrtohex = rstrtohex;
  exports.newline_toUnix = newline_toUnix;
  exports.newline_toDos = newline_toDos;
  exports.strdiffidx = strdiffidx;
  exports.crypto = KJUR.crypto;
  exports.asn1 = KJUR.asn1;
  exports.jws = KJUR.jws;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["c", "d", "e", "f", "10", "8", "11"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SecurityService_1 = req('c');
  var OAuthTokenService_1 = req('d');
  var OAuthInterceptor_1 = req('e');
  var QueryStringService_1 = req('f');
  var AuthorizeDirective_1 = req('10');
  var core = req('8');
  req('11');
  var module = angular.module('fds.security', [core.module.name]).config(["$httpProvider", "$configProvider", "$securityProvider", function($httpProvider, $configProvider, $securityProvider) {
    var config = $configProvider.$get();
    $securityProvider.configure(config);
    $httpProvider.interceptors.push(OAuthInterceptor_1.default.factory);
  }]).run(["$rootScope", "$security", function($rootScope, $security) {
    $rootScope.authorize = $security.authorize.bind($security);
    $rootScope.owner = $security.owner.bind($security);
    if ($security.isAuthenticated()) {
      $rootScope.userLogin = $security.getUserLogin();
      $rootScope.userFullName = $security.getUserFullName();
    }
  }]).provider('$security', SecurityService_1.SecurityServiceProvider).provider('$oauthToken', OAuthTokenService_1.OAuthTokenServiceProvider).service('$queryString', QueryStringService_1.default).directive('authorize', AuthorizeDirective_1.default);
  Object.defineProperty(exports, "__esModule", {value: true});
  exports.default = module;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1", ["8", "b", "12"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  function __export(m) {
    for (var p in m)
      if (!exports.hasOwnProperty(p))
        exports[p] = m[p];
  }
  __export(req('8'));
  __export(req('b'));
  __export(req('12'));
  global.define = __define;
  return module.exports;
});

})
(function(factory) {
  factory();
});