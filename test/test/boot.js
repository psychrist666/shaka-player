/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Gets the value of an argument passed from karma.
 * @param {string} name
 * @return {?string|boolean}
 */
function getClientArg(name) {
  if (window.__karma__ && __karma__.config.args.length)
    return __karma__.config.args[0][name] || null;
  else
    return null;
}


// Executed before test utilities and tests are loaded, but after Shaka Player
// is loaded in uncompiled mode.
(function() {
  var realAssert = console.assert.bind(console);

  /**
   * A version of assert() which hooks into jasmine and converts all failed
   * assertions into failed tests.
   * @param {*} condition
   * @param {string=} opt_message
   */
  function jasmineAssert(condition, opt_message) {
    realAssert(condition, opt_message);
    if (!condition) {
      var message = opt_message || 'Assertion failed.';
      console.error(message);
      try {
        throw new Error(message);
      } catch (exception) {
        fail(message);
      }
    }
  }
  goog.asserts.assert = jasmineAssert;
  console.assert = /** @type {?} */(jasmineAssert);

  // Use a RegExp if --specFilter is set, else empty string will match all.
  var specFilterRegExp = new RegExp(getClientArg('specFilter') || '');

  /**
   * A filter over all Jasmine specs.
   * @param {jasmine.Spec} spec
   * @return {boolean}
   */
  function specFilter(spec) {
    // If the browser is not supported, don't run the tests.
    // If the user specified a RegExp, only run the matched tests.
    // Running zero tests is considered an error so the test run will fail on
    // unsupported browsers or if the filter doesn't match any specs.
    return shaka.Player.isBrowserSupported() &&
        specFilterRegExp.test(spec.getFullName());
  }
  jasmine.getEnv().specFilter = specFilter;

  // The spec filter callback occurs before calls to beforeAll, so we need to
  // install polyfills here to ensure that browser support is correctly
  // detected.
  shaka.polyfill.installAll();

  // Jasmine's clock mocks seem to interfere with Edge's Promise implementation.
  // This is only the case if Promises are first used after installing the mock.
  // As long as a then() callback on a Promise has happened once beforehand, it
  // seems to be OK.  I suspect Edge's Promise implementation is actually not in
  // native code, but rather something like a polyfill that binds to timer calls
  // the first time it needs to schedule something.
  Promise.resolve().then(function() {});

  // Set the default timeout to 120s for all asynchronous tests.
  jasmine.DEFAULT_TIMEOUT_INTERVAL = 120 * 1000;

  var logLevel = getClientArg('logLevel');
  if (logLevel) {
    shaka.log.setLevel(Number(logLevel));
  } else {
    shaka.log.setLevel(shaka.log.Level.INFO);
  }

  // Set random and seed if specified.
  if (getClientArg('random')) {
    jasmine.getEnv().randomizeTests(true);

    var seed = getClientArg('seed');
    if (seed) {
      jasmine.getEnv().seed(seed.toString());
    }
  }

  /**
   * Returns a Jasmine callback which shims the real callback and checks for
   * a certain client arg.  The test will only be run if that argument is
   * specified on the command-line.
   *
   * @param {jasmine.Callback} callback  The test callback.
   * @param {string} clientArg  The command-line arg that must be present.
   * @param {string} skipMessage  The message used when skipping a test.
   * @return {jasmine.Callback}
   */
  function filterShim(callback, clientArg, skipMessage) {
    return async function() {
      if (!getClientArg(clientArg)) {
        pending(skipMessage);
        return;
      }

      if (callback.length) {
        // If this has a done callback, wrap in a Promise so we can await it.
        await new Promise((resolve) => callback(resolve));
      } else {
        // If this is an async test, this will wait for it to complete; if this
        // is a synchronous test, await will do nothing.
        await callback();
      }
    };
  }

  /**
   * Run a test that uses external content.
   *
   * @param {string} name
   * @param {jasmine.Callback} callback
   */
  window.external_it = function(name, callback) {
    it(name, filterShim(callback, 'external',
        'Skipping tests that use external content.'));
  };

  /**
   * Run a test that uses a DRM license server.
   *
   * @param {string} name
   * @param {jasmine.Callback} callback
   */
  window.drm_it = function(name, callback) {
    it(name, filterShim(callback, 'drm',
        'Skipping tests that use a DRM license server.'));
  };

  /**
   * Run a test that has been quarantined.
   *
   * @param {string} name
   * @param {jasmine.Callback} callback
   */
  window.quarantined_it = function(name, callback) {
    it(name, filterShim(callback, 'quarantined',
        'Skipping tests that are quarantined.'));
  };

  beforeAll((done) => {
    // Configure AMD modules and their dependencies.
    require.config({
      baseUrl: '/base/node_modules',
      packages: [
        {
          name: 'sprintf-js',
          main: 'src/sprintf',
        },
      ],
    });

    // Load required AMD modules, then proceed with tests.
    require(['sprintf-js'], (sprintfJs) => {
      window.sprintf = sprintfJs.sprintf;
      done();
    });
  });
})();
