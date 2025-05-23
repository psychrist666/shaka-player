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

describe('CastReceiver', function() {
  /** @const */
  var CastReceiver = shaka.cast.CastReceiver;
  /** @const */
  var CastUtils = shaka.cast.CastUtils;

  var eventManager = new shaka.util.EventManager();

  /** @const */
  var originalCast = window['cast'];
  /** @const */
  var originalUserAgent = navigator.userAgent;

  var mockReceiverManager;
  var mockReceiverApi;
  var mockShakaMessageBus;
  var mockGenericMessageBus;

  /** @type {shaka.cast.CastReceiver} */
  var receiver;
  /** @type {shaka.Player} */
  var player;
  /** @type {HTMLVideoElement} */
  var video;

  /** @type {shaka.util.PublicPromise} */
  var messageWaitPromise;

  /** @type {Array.<function()>} */
  var toRestore;
  var pendingWaitWrapperCalls = 0;

  /** @type {boolean} */
  var isChrome;
  /** @type {boolean} */
  var isChromecast;
  /** @type {!Object.<string, ?shakaExtern.DrmSupportType>} */
  var support = {};

  var fakeInitState;

  function checkKeySystems() {
    // Our test asset for this suite can use any of these key systems:
    if (!support['com.widevine.alpha']) {
      // pending() throws a special exception that Jasmine uses to skip a test.
      // It can only be used from inside it(), not describe() or beforeEach().
      pending('Skipping DrmEngine tests.');
      // The rest of the test will not run.
    }
  }

  function checkChromeOrChromecast() {
    if (!isChromecast && !isChrome) {
      pending('Skipping CastReceiver tests for non-Chrome and non-Chromecast');
    }
  }

  beforeAll(function(done) {
    var supportTest = shaka.media.DrmEngine.probeSupport()
        .then(function(result) { support = result; })
        .catch(fail);

    // The receiver is only meant to run on the Chromecast, so we have the
    // ability to use modern APIs there that may not be available on all of the
    // browsers our library supports.  Because of this, CastReceiver tests will
    // only be run on Chrome and Chromecast.
    isChromecast = navigator.userAgent.indexOf('CrKey') >= 0;
    var isEdge = navigator.userAgent.indexOf('Edge/') >= 0;
    // Edge also has "Chrome/" in its user agent string.
    isChrome = navigator.userAgent.indexOf('Chrome/') >= 0 && !isEdge;

    // Don't do any more work here if the tests will not end up running.
    if (!isChromecast && !isChrome) return;

    // In uncompiled mode, there is a UA check for Chromecast in order to make
    // manual testing easier.  For these automated tests, we want to act as if
    // we are running on the Chromecast, even in Chrome.
    // Since we can't write to window.navigator or navigator.userAgent, we use
    // Object.defineProperty.
    Object.defineProperty(window['navigator'],
                          'userAgent', {value: 'CrKey', configurable: true});

    shaka.net.NetworkingEngine.registerScheme('test', shaka.test.TestScheme);
    shaka.media.ManifestParser.registerParserByMime(
        'application/x-test-manifest',
        shaka.test.TestScheme.ManifestParser);
    var createManifests = shaka.test.TestScheme.createManifests(shaka, '');

    Promise.all([createManifests, supportTest]).then(done);
  });

  beforeEach(function() {
    checkChromeOrChromecast();

    mockReceiverApi = createMockReceiverApi();

    var mockCanDisplayType = jasmine.createSpy('canDisplayType');
    mockCanDisplayType.and.returnValue(true);

    // We're using quotes to access window.cast because the compiler
    // knows about lots of Cast-specific APIs we aren't mocking.  We
    // don't need this mock strictly type-checked.
    window['cast'] = {
      receiver: mockReceiverApi,
      __platform__: { canDisplayType: mockCanDisplayType }
    };

    mockReceiverManager = createMockReceiverManager();
    mockShakaMessageBus = createMockMessageBus();
    mockGenericMessageBus = createMockMessageBus();

    video = /** @type {!HTMLVideoElement} */ (document.createElement('video'));
    video.width = 600;
    video.height = 400;
    video.muted = true;
    document.body.appendChild(video);

    player = new shaka.Player(video);
    receiver = new CastReceiver(video, player);

    toRestore = [];
    pendingWaitWrapperCalls = 0;

    fakeInitState = {
      player: {
        configure: {}
      },
      playerAfterLoad: {
        setTextTrackVisibility: true
      },
      video: {
        loop: true,
        playbackRate: 5
      },
      manifest: 'test:sintel_no_text',
      startTime: 0
    };
  });

  afterEach(function(done) {
    toRestore.forEach(function(restoreCallback) {
      restoreCallback();
    });

    receiver.destroy().catch(fail).then(function() {
      document.body.removeChild(video);

      player = null;
      video = null;
      receiver = null;

      done();
    });
  });

  afterAll(function() {
    if (originalUserAgent) {
      window['cast'] = originalCast;
      Object.defineProperty(window['navigator'],
                            'userAgent', {value: originalUserAgent});
    }
  });

  drm_it('sends reasonably-sized update messages', function(done) {
    checkChromeOrChromecast();
    checkKeySystems();

    // Use an encrypted asset, to make sure DRM info doesn't balloon the size.
    fakeInitState.manifest = 'test:sintel-enc';

    eventManager.listenOnce(video, 'loadeddata', function() {
      // Wait for an update message.
      waitForUpdateMessage().then(function(message) {
        // Check that the update message is of a reasonable size.
        expect(message.length).toBeLessThan(5000);
      }).then(done);
    });
    addOnError(done);

    // Start the process of loading by sending a fake init message.
    fakeConnectedSenders(1);
    fakeIncomingMessage({
      type: 'init',
      initState: fakeInitState,
      appData: {}
    }, mockShakaMessageBus);
  });

  drm_it('has a reasonably low average message size', function(done) {
    checkChromeOrChromecast();
    checkKeySystems();

    // Use an encrypted asset, to make sure DRM info doesn't balloon the size.
    fakeInitState.manifest = 'test:sintel-enc';

    eventManager.listenOnce(video, 'loadeddata', function() {
      // Collect 50 update messages, and average their length.
      // Not all properties are passed along on every update message, so
      // the average length is expected to be lower than the length of the first
      // update message.
      var totalLength = 0;
      var waitForUpdate = Promise.resolve();
      for (var i = 0; i < 50; i++)
        waitForUpdate = waitForUpdate.then(function() {
          return waitForUpdateMessage();
        }).then(function(message) {
          totalLength += message.length;
        });
      waitForUpdate.then(function() {
        expect(totalLength / 50).toBeLessThan(3000);
      }).then(done);
    });
    addOnError(done);

    // Start the process of loading by sending a fake init message.
    fakeConnectedSenders(1);
    fakeIncomingMessage({
      type: 'init',
      initState: fakeInitState,
      appData: {}
    }, mockShakaMessageBus);
  });

  it('sends update messages at every stage of loading', function(done) {
    checkChromeOrChromecast();

    // Add wrappers to various methods along player.load to make sure that,
    // at each stage, the cast receiver can form an update message without
    // causing an error.
    waitForUpdateMessageWrapper(
        shaka.media.ManifestParser, 'ManifestParser', 'getFactory');
    waitForUpdateMessageWrapper(shaka.test.TestScheme.ManifestParser.prototype,
        'ManifestParser', 'start');
    waitForUpdateMessageWrapper(
        shaka.media.DrmEngine.prototype, 'DrmEngine', 'init');
    waitForUpdateMessageWrapper(
        shaka.media.DrmEngine.prototype, 'DrmEngine', 'attach');
    waitForUpdateMessageWrapper(
        shaka.media.StreamingEngine.prototype, 'StreamingEngine', 'init');

    eventManager.listenOnce(video, 'loadeddata', function() {
      // Make sure that each of the methods covered by
      // waitForUpdateMessageWrapper is called by this point.
      expect(pendingWaitWrapperCalls).toBe(0);

      // Wait for a final update message before proceeding.
      waitForUpdateMessage().then(done);
    });
    addOnError(done);

    // Start the process of loading by sending a fake init message.
    fakeConnectedSenders(1);
    fakeIncomingMessage({
      type: 'init',
      initState: fakeInitState,
      appData: {}
    }, mockShakaMessageBus);
  });

  /**
   * Creates a wrapper around a method on a given prototype, which makes it
   * wait on waitForUpdateMessage before returning, and registers that wrapper
   * to be uninstalled afterwards.
   * The replaced method is expected to be a method that returns a promise.
   * @param {!Object} prototype
   * @param {string} name
   * @param {string} methodName
   */
  function waitForUpdateMessageWrapper(prototype, name, methodName) {
    pendingWaitWrapperCalls += 1;
    var original = prototype[methodName];
    prototype[methodName] = /** @this {Object} @return {*} */ function() {
      pendingWaitWrapperCalls -= 1;
      shaka.log.debug(
          'Waiting for update message before calling ' +
          name + '.' + methodName + '...');
      var originalArguments = arguments;
      return waitForUpdateMessage().then(function() {
        return original.apply(this, originalArguments);
      }.bind(this));
    };
    toRestore.push(function() {
      prototype[methodName] = original;
    });
  }

  function addOnError(done) {
    var onError = function(event) {
      fail(event.detail);
      done();
    };
    player.addEventListener('error', onError);
  }

  function waitForUpdateMessage() {
    messageWaitPromise = new shaka.util.PublicPromise();
    return messageWaitPromise;
  }

  function createMockReceiverApi() {
    return {
      CastReceiverManager: {
        getInstance: function() { return mockReceiverManager; }
      }
    };
  }

  function createMockReceiverManager() {
    return {
      start: jasmine.createSpy('CastReceiverManager.start'),
      stop: jasmine.createSpy('CastReceiverManager.stop'),
      setSystemVolumeLevel:
          jasmine.createSpy('CastReceiverManager.setSystemVolumeLevel'),
      setSystemVolumeMuted:
          jasmine.createSpy('CastReceiverManager.setSystemVolumeMuted'),
      getSenders: jasmine.createSpy('CastReceiverManager.getSenders'),
      getSystemVolume: function() { return { level: 1, muted: false }; },
      getCastMessageBus: function(namespace) {
        if (namespace == CastUtils.SHAKA_MESSAGE_NAMESPACE)
          return mockShakaMessageBus;

        return mockGenericMessageBus;
      }
    };
  }

  function createMockMessageBus() {
    var bus = {
      messages: [],
      broadcast: jasmine.createSpy('CastMessageBus.broadcast'),
      getCastChannel: jasmine.createSpy('CastMessageBus.getCastChannel')
    };
    // For convenience, deserialize and store sent messages.
    bus.broadcast.and.callFake(function(message) {
      bus.messages.push(CastUtils.deserialize(message));
      // Check to see if it's an update message.
      var parsed = CastUtils.deserialize(message);
      if (parsed.type == 'update' && messageWaitPromise) {
        shaka.log.debug('Received update message. Proceeding...');
        messageWaitPromise.resolve(message);
        messageWaitPromise = null;
      }
    });
    var channel = {
      messages: [],
      send: function(message) {
        channel.messages.push(CastUtils.deserialize(message));
      }
    };
    bus.getCastChannel.and.returnValue(channel);
    return bus;
  }

  /**
   * @param {number} num
   */
  function fakeConnectedSenders(num) {
    var senderArray = [];
    while (num--) {
      senderArray.push('senderId');
    }

    mockReceiverManager.getSenders.and.returnValue(senderArray);
    mockReceiverManager.onSenderConnected();
  }

  /**
   * @param {?} message
   * @param {!Object} bus
   * @param {string=} opt_senderId
   */
  function fakeIncomingMessage(message, bus, opt_senderId) {
    var serialized = CastUtils.serialize(message);
    var messageEvent = {
      senderId: opt_senderId,
      data: serialized
    };
    bus.onMessage(messageEvent);
  }
});
