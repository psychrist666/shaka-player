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


/** @externs */


/**
 * @typedef {{
 *   maxAttempts: number,
 *   baseDelay: number,
 *   backoffFactor: number,
 *   fuzzFactor: number,
 *   timeout: number
 * }}
 *
 * @description
 *   Parameters for retrying requests.
 *
 * @property {number} maxAttempts
 *   The maximum number of times the request should be attempted.
 * @property {number} baseDelay
 *   The delay before the first retry, in milliseconds.
 * @property {number} backoffFactor
 *   The multiplier for successive retry delays.
 * @property {number} fuzzFactor
 *   The maximum amount of fuzz to apply to each retry delay.
 *   For example, 0.5 means "between 50% below and 50% above the retry delay."
 * @property {number} timeout
 *   The request timeout, in milliseconds.  Zero means "unlimited".
 *
 * @tutorial network-and-buffering-config
 *
 * @exportDoc
 */
shakaExtern.RetryParameters;


/**
 * @typedef {{
 *   uris: !Array.<string>,
 *   method: string,
 *   body: ArrayBuffer,
 *   headers: !Object.<string, string>,
 *   allowCrossSiteCredentials: boolean,
 *   retryParameters: !shakaExtern.RetryParameters
 * }}
 *
 * @description
 * Defines a network request.  This is passed to one or more request filters
 * that may alter the request, then it is passed to a scheme plugin which
 * performs the actual operation.
 *
 * @property {!Array.<string>} uris
 *   An array of URIs to attempt.  They will be tried in the order they are
 *   given.
 * @property {string} method
 *   The HTTP method to use for the request.
 * @property {ArrayBuffer} body
 *   The body of the request.
 * @property {!Object.<string, string>} headers
 *   A mapping of headers for the request.  e.g.: {'HEADER': 'VALUE'}
 * @property {boolean} allowCrossSiteCredentials
 *   Make requests with credentials.  This will allow cookies in cross-site
 *   requests.  See <a href="http://goo.gl/YBRKPe">http://goo.gl/YBRKPe</a>.
 * @property {!shakaExtern.RetryParameters} retryParameters
 *   An object used to define how often to make retries.
 *
 * @exportDoc
 */
shakaExtern.Request;


/**
 * @typedef {{
 *   uri: string,
 *   data: ArrayBuffer,
 *   headers: !Object.<string, string>,
 *   timeMs: (number|undefined),
 *   fromCache: (boolean|undefined)
 * }}
 *
 * @description
 * Defines a response object.  This includes the response data and header info.
 * This is given back from the scheme plugin.  This is passed to a response
 * filter before being returned from the request call.
 *
 * @property {string} uri
 *   The URI which was loaded.  Request filters and server redirects can cause
 *   this to be different from the original request URIs.
 * @property {ArrayBuffer} data
 *   The body of the response.
 * @property {!Object.<string, string>} headers
 *   A map of response headers, if supported by the underlying protocol.
 *   All keys should be lowercased.
 *   For HTTP/HTTPS, may not be available cross-origin.
 * @property {(number|undefined)} timeMs
 *   Optional.  The time it took to get the response, in miliseconds.  If not
 *   given, NetworkingEngine will calculate it using Date.now.
 * @property {(boolean|undefined)} fromCache
 *   Optional. If true, this response was from a cache and should be ignored
 *   for bandwidth estimation.
 *
 * @exportDoc
 */
shakaExtern.Response;


/**
 * Defines a plugin that handles a specific scheme.
 *
 * @typedef {function(string,
 *                    shakaExtern.Request,
 *                    shaka.net.NetworkingEngine.RequestType):
 *     !Promise.<shakaExtern.Response>}
 * @exportDoc
 */
shakaExtern.SchemePlugin;


/**
 * Defines a filter for requests.  This filter takes the request and modifies
 * it before it is sent to the scheme plugin.
 * A request filter can run asynchronously by returning a promise; in this case,
 * the request will not be sent until the promise is resolved.
 *
 * @typedef {function(shaka.net.NetworkingEngine.RequestType,
 *                    shakaExtern.Request):
             (Promise|undefined)}
 * @exportDoc
 */
shakaExtern.RequestFilter;


/**
 * Defines a filter for responses.  This filter takes the response and modifies
 * it before it is returned.
 * A response filter can run asynchronously by returning a promise.
 *
 * @typedef {function(shaka.net.NetworkingEngine.RequestType,
 *                    shakaExtern.Response):
              (Promise|undefined)}
 * @exportDoc
 */
shakaExtern.ResponseFilter;
