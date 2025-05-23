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

goog.provide('shaka.cast.CastReceiver');

goog.require('goog.asserts');
goog.require('shaka.cast.CastUtils');
goog.require('shaka.log');
goog.require('shaka.util.Error');
goog.require('shaka.util.FakeEvent');
goog.require('shaka.util.FakeEventTarget');
goog.require('shaka.util.IDestroyable');



/**
 * A receiver to communicate between the Chromecast-hosted player and the
 * sender application.
 *
 * @constructor
 * @struct
 * @param {!HTMLMediaElement} video The local video element associated with the
 *   local Player instance.
 * @param {!shaka.Player} player A local Player instance.
 * @param {function(Object)=} opt_appDataCallback A callback to handle
 *   application-specific data passed from the sender.
  * @param {function(string):string=} opt_contentIdCallback A callback to
 *   retrieve manifest URI from the provided content id.
 * @implements {shaka.util.IDestroyable}
 * @extends {shaka.util.FakeEventTarget}
 * @export
 */
shaka.cast.CastReceiver =
    function(video, player, opt_appDataCallback, opt_contentIdCallback) {
  shaka.util.FakeEventTarget.call(this);

  /** @private {HTMLMediaElement} */
  this.video_ = video;

  /** @private {shaka.Player} */
  this.player_ = player;

  /** @private {Object} */
  this.targets_ = {
    'video': video,
    'player': player
  };

  /** @private {?function(Object)} */
  this.appDataCallback_ = opt_appDataCallback || function() {};

  /** @private {?function(string):string} */
  this.opt_contentIdCallback_ = opt_contentIdCallback ||
                            /** @param {string} contentId
                                @return {string} */
                            function(contentId) { return contentId; };

  /** @private {boolean} */
  this.isConnected_ = false;

  /** @private {boolean} */
  this.isIdle_ = true;

  /** @private {number} */
  this.updateNumber_ = 0;

  /** @private {boolean} */
  this.startUpdatingUpdateNumber_ = false;

  /** @private {boolean} */
  this.initialStatusUpdatePending_ = true;

  /** @private {cast.receiver.CastMessageBus} */
  this.shakaBus_ = null;

  /** @private {cast.receiver.CastMessageBus} */
  this.genericBus_ = null;

  /** @private {?number} */
  this.pollTimerId_ = null;

  this.init_();
};
goog.inherits(shaka.cast.CastReceiver, shaka.util.FakeEventTarget);


/**
 * @return {boolean} True if the cast API is available and there are receivers.
 * @export
 */
shaka.cast.CastReceiver.prototype.isConnected = function() {
  return this.isConnected_;
};


/**
 * @return {boolean} True if the receiver is not currently doing loading or
 *   playing anything.
 * @export
 */
shaka.cast.CastReceiver.prototype.isIdle = function() {
  return this.isIdle_;
};


/**
 * Destroys the underlying Player, then terminates the cast receiver app.
 *
 * @override
 * @export
 */
shaka.cast.CastReceiver.prototype.destroy = function() {
  var p = this.player_ ? this.player_.destroy() : Promise.resolve();

  if (this.pollTimerId_ != null) {
    window.clearTimeout(this.pollTimerId_);
  }

  this.video_ = null;
  this.player_ = null;
  this.targets_ = null;
  this.appDataCallback_ = null;
  this.isConnected_ = false;
  this.isIdle_ = true;
  this.shakaBus_ = null;
  this.genericBus_ = null;
  this.pollTimerId_ = null;

  return p.then(function() {
    var manager = cast.receiver.CastReceiverManager.getInstance();
    manager.stop();
  });
};


/** @private */
shaka.cast.CastReceiver.prototype.init_ = function() {
  var manager = cast.receiver.CastReceiverManager.getInstance();
  manager.onSenderConnected = this.onSendersChanged_.bind(this);
  manager.onSenderDisconnected = this.onSendersChanged_.bind(this);
  manager.onSystemVolumeChanged = this.fakeVolumeChangeEvent_.bind(this);

  this.genericBus_ = manager.getCastMessageBus(
      shaka.cast.CastUtils.GENERIC_MESSAGE_NAMESPACE);
  this.genericBus_.onMessage = this.onGenericMessage_.bind(this);

  this.shakaBus_ = manager.getCastMessageBus(
      shaka.cast.CastUtils.SHAKA_MESSAGE_NAMESPACE);
  this.shakaBus_.onMessage = this.onShakaMessage_.bind(this);

  if (goog.DEBUG) {
    // Sometimes it is useful to load the receiver app in Chrome to work on the
    // UI.  To avoid log spam caused by the SDK trying to connect to web sockets
    // that don't exist, in uncompiled mode we check if the hosting browser is a
    // Chromecast before starting the receiver manager.  We wouldn't do browser
    // detection except for debugging, so only do this in uncompiled mode.
    var isChromecast = navigator.userAgent.indexOf('CrKey') >= 0;
    if (isChromecast) {
      manager.start();
    }
  } else {
    manager.start();
  }

  shaka.cast.CastUtils.VideoEvents.forEach(function(name) {
    this.video_.addEventListener(name, this.proxyEvent_.bind(this, 'video'));
  }.bind(this));

  shaka.cast.CastUtils.PlayerEvents.forEach(function(name) {
    this.player_.addEventListener(name, this.proxyEvent_.bind(this, 'player'));
  }.bind(this));

  // In our tests, the original Chromecast seems to have trouble decoding above
  // 1080p.  It would be a waste to select a higher res anyway, given that the
  // device only outputs 1080p to begin with.

  // Chromecast has an extension to query the device/display's resolution.
  if (cast.__platform__ && cast.__platform__.canDisplayType(
      'video/mp4; codecs="avc1.640028"; width=3840; height=2160')) {
    // The device & display can both do 4k.  Assume a 4k limit.
    this.player_.setMaxHardwareResolution(3840, 2160);
  } else {
    // Chromecast has always been able to do 1080p.  Assume a 1080p limit.
    this.player_.setMaxHardwareResolution(1920, 1080);
  }

  // Do not start excluding values from update messages until the video is
  // fully loaded.
  this.video_.addEventListener('loadeddata', function() {
    this.startUpdatingUpdateNumber_ = true;
  }.bind(this));

  // Maintain idle state.
  this.player_.addEventListener('loading', function() {
    // No longer idle once loading.  This allows us to show the spinner during
    // the initial buffering phase.
    this.isIdle_ = false;
    this.onCastStatusChanged_();
  }.bind(this));
  this.video_.addEventListener('playing', function() {
    // No longer idle once playing.  This allows us to replay a video without
    // reloading.
    this.isIdle_ = false;
    this.onCastStatusChanged_();
  }.bind(this));
  this.video_.addEventListener('pause', function() {
    this.onCastStatusChanged_();
  }.bind(this));
  this.player_.addEventListener('unloading', function() {
    // Go idle when unloading content.
    this.isIdle_ = true;
    this.onCastStatusChanged_();
  }.bind(this));
  this.video_.addEventListener('ended', function() {
    // Go idle 5 seconds after 'ended', assuming we haven't started again or
    // been destroyed.
    window.setTimeout(function() {
      if (this.video_ && this.video_.ended) {
        this.isIdle_ = true;
        this.onCastStatusChanged_();
      }
    }.bind(this), 5000);
  }.bind(this));

  // Do not start polling until after the sender's 'init' message is handled.
};


/** @private */
shaka.cast.CastReceiver.prototype.onSendersChanged_ = function() {
  // Reset update message frequency values, to make sure whomever joined
  // will get a full update message.
  this.updateNumber_ = 0;
  // Don't reset startUpdatingUpdateNumber_, because this operation does not
  // result in new data being loaded.
  this.initialStatusUpdatePending_ = true;

  var manager = cast.receiver.CastReceiverManager.getInstance();
  this.isConnected_ = manager.getSenders().length != 0;
  this.onCastStatusChanged_();
};


/**
 * Dispatch an event to notify the receiver app that the status has changed.
 * @private
 */
shaka.cast.CastReceiver.prototype.onCastStatusChanged_ = function() {
  // Do this asynchronously so that synchronous changes to idle state (such as
  // Player calling unload() as part of load()) are coalesced before the event
  // goes out.
  Promise.resolve().then(function() {
    var event = new shaka.util.FakeEvent('caststatuschanged');
    this.dispatchEvent(event);
    // Send a media status message, with a media info message if appropriate.
    if (!this.maybeSendMediaInfoMessage_())
      this.sendMediaStatus_(0);
  }.bind(this));
};


/**
 * Take on initial state from the sender.
 * @param {shaka.cast.CastUtils.InitStateType} initState
 * @param {Object} appData
 * @private
 */
shaka.cast.CastReceiver.prototype.initState_ = function(initState, appData) {
  // Take on player state first.
  for (var k in initState['player']) {
    var v = initState['player'][k];
    // All player state vars are setters to be called.
    /** @type {Object} */(this.player_)[k](v);
  }

  // Now process custom app data, which may add additional player configs:
  this.appDataCallback_(appData);

  var manifestReady = Promise.resolve();
  var autoplay = this.video_.autoplay;

  // Now load the manifest, if present.
  if (initState['manifest']) {
    // Don't autoplay the content until we finish setting up initial state.
    this.video_.autoplay = false;
    manifestReady = this.player_.load(
        initState['manifest'], initState['startTime']);
    // Pass any errors through to the app.
    manifestReady.catch(function(error) {
      goog.asserts.assert(error instanceof shaka.util.Error,
                          'Wrong error type!');
      var event = new shaka.util.FakeEvent('error', { 'detail': error });
      this.player_.dispatchEvent(event);
    }.bind(this));
  }

  // Finally, take on video state and player's "after load" state.
  manifestReady.then(function() {
    for (var k in initState['video']) {
      var v = initState['video'][k];
      this.video_[k] = v;
    }

    for (var k in initState['playerAfterLoad']) {
      var v = initState['playerAfterLoad'][k];
      // All player state vars are setters to be called.
      /** @type {Object} */(this.player_)[k](v);
    }

    // Restore original autoplay setting.
    this.video_.autoplay = autoplay;
    if (initState['manifest']) {
      // Resume playback with transferred state.
      this.video_.play();
      // Notify generic controllers of the state change.
      this.sendMediaStatus_(0);
    }
  }.bind(this));
};


/**
 * @param {string} targetName
 * @param {!Event} event
 * @private
 */
shaka.cast.CastReceiver.prototype.proxyEvent_ = function(targetName, event) {
  if (!this.player_) {
    // The receiver is destroyed, so it should ignore further events.
    return;
  }

  // Poll and send an update right before we send the event.  Some events
  // indicate an attribute change, so that change should be visible when the
  // event is handled.
  this.pollAttributes_();

  this.sendMessage_({
    'type': 'event',
    'targetName': targetName,
    'event': event
  }, this.shakaBus_);
};


/** @private */
shaka.cast.CastReceiver.prototype.pollAttributes_ = function() {
  // The poll timer may have been pre-empted by an event.
  // To avoid polling too often, we clear it here.
  if (this.pollTimerId_ != null) {
    window.clearTimeout(this.pollTimerId_);
  }
  // Since we know the timer has been cleared, start a new one now.
  // This will be preempted by events, including 'timeupdate'.
  this.pollTimerId_ = window.setTimeout(this.pollAttributes_.bind(this), 500);

  var update = {
    'video': {},
    'player': {}
  };

  shaka.cast.CastUtils.VideoAttributes.forEach(function(name) {
    update['video'][name] = this.video_[name];
  }.bind(this));

  // TODO: Instead of this variable frequency update system, instead cache the
  // previous player state and only send over changed values, with complete
  // updates every ~20 updates to account for dropped messages.

  if (this.player_.isLive()) {
    for (var name in shaka.cast.CastUtils.PlayerGetterMethodsThatRequireLive) {
      var frequency =
          shaka.cast.CastUtils.PlayerGetterMethodsThatRequireLive[name];
      if (this.updateNumber_ % frequency == 0)
        update['player'][name] = /** @type {Object} */(this.player_)[name]();
    }
  }
  for (var name in shaka.cast.CastUtils.PlayerGetterMethods) {
    var frequency = shaka.cast.CastUtils.PlayerGetterMethods[name];
    if (this.updateNumber_ % frequency == 0)
      update['player'][name] = /** @type {Object} */(this.player_)[name]();
  }

  // Volume attributes are tied to the system volume.
  var manager = cast.receiver.CastReceiverManager.getInstance();
  var systemVolume = manager.getSystemVolume();
  if (systemVolume) {
    update['video']['volume'] = systemVolume.level;
    update['video']['muted'] = systemVolume.muted;
  }

  // Only start progressing the update number once data is loaded,
  // just in case any of the "rarely changing" properties with less frequent
  // update messages changes significantly during the loading process.
  if (this.startUpdatingUpdateNumber_)
    this.updateNumber_ += 1;

  this.sendMessage_({
    'type': 'update',
    'update': update
  }, this.shakaBus_);

  this.maybeSendMediaInfoMessage_();
};


/**
 * Composes and sends a mediaStatus message if appropriate.
 * @return {boolean}
 * @private
 */
shaka.cast.CastReceiver.prototype.maybeSendMediaInfoMessage_ = function() {
  if (this.initialStatusUpdatePending_ &&
      (this.video_.duration || this.player_.isLive())) {
    // Send over a media status message to set the duration of the cast
    // dialogue.
    this.sendMediaInfoMessage_();
    this.initialStatusUpdatePending_ = false;
    return true;
  }
  return false;
};


/**
 * Composes and sends a mediaStatus message with a mediaInfo component.
 * @private
 */
shaka.cast.CastReceiver.prototype.sendMediaInfoMessage_ = function() {
  var media = {
    'contentId': this.player_.getManifestUri(),
    'streamType': this.player_.isLive() ? 'LIVE' : 'BUFFERED',
    'duration': this.video_.duration,
    // TODO: Is there a use case when this would be required?
    // Sending an empty string for now since it's a mandatory
    // field.
    'contentType': ''
  };
  this.sendMediaStatus_(0, media);
};


/**
 * Dispatch a fake 'volumechange' event to mimic the video element, since volume
 * changes are routed to the system volume on the receiver.
 * @private
 */
shaka.cast.CastReceiver.prototype.fakeVolumeChangeEvent_ = function() {
  // Volume attributes are tied to the system volume.
  var manager = cast.receiver.CastReceiverManager.getInstance();
  var systemVolume = manager.getSystemVolume();
  goog.asserts.assert(systemVolume, 'System volume should not be null!');

  if (systemVolume) {
    // Send an update message with just the latest volume level and muted state.
    this.sendMessage_({
      'type': 'update',
      'update': {
        'video': {
          'volume': systemVolume.level,
          'muted': systemVolume.muted
        }
      }
    }, this.shakaBus_);
  }

  // Send another message with a 'volumechange' event to update the sender's UI.
  this.sendMessage_({
    'type': 'event',
    'targetName': 'video',
    'event': {'type': 'volumechange'}
  }, this.shakaBus_);
};


/**
 * Since this method is in the compiled library, make sure all messages are
 * read with quoted properties.
 * @param {!cast.receiver.CastMessageBus.Event} event
 * @private
 */
shaka.cast.CastReceiver.prototype.onShakaMessage_ = function(event) {
  var message = shaka.cast.CastUtils.deserialize(event.data);
  shaka.log.debug('CastReceiver: message', message);

  switch (message['type']) {
    case 'init':
      // Reset update message frequency values after initialization.
      this.updateNumber_ = 0;
      this.startUpdatingUpdateNumber_ = false;
      this.initialStatusUpdatePending_ = true;

      this.initState_(message['initState'], message['appData']);
      // The sender is supposed to reflect the cast system volume after
      // connecting.  Using fakeVolumeChangeEvent_() would create a race on the
      // sender side, since it would have volume properties, but no others.
      // This would lead to hasRemoteProperties() being true, even though a
      // complete set had never been sent.
      // Now that we have init state, this is a good time for the first update
      // message anyway.
      this.pollAttributes_();
      break;
    case 'appData':
      this.appDataCallback_(message['appData']);
      break;
    case 'set': {
      var targetName = message['targetName'];
      var property = message['property'];
      var value = message['value'];

      if (targetName == 'video') {
        // Volume attributes must be rerouted to the system.
        var manager = cast.receiver.CastReceiverManager.getInstance();
        if (property == 'volume') {
          manager.setSystemVolumeLevel(value);
          break;
        } else if (property == 'muted') {
          manager.setSystemVolumeMuted(value);
          break;
        }
      }

      this.targets_[targetName][property] = value;
      break;
    }
    case 'call': {
      var targetName = message['targetName'];
      var methodName = message['methodName'];
      var args = message['args'];
      var target = this.targets_[targetName];
      target[methodName].apply(target, args);
      break;
    }
    case 'asyncCall': {
      var targetName = message['targetName'];
      var methodName = message['methodName'];
      if (targetName == 'player' && methodName == 'load') {
        // Reset update message frequency values after a load.
        this.updateNumber_ = 0;
        this.startUpdatingUpdateNumber_ = false;
      }
      var args = message['args'];
      var id = message['id'];
      var senderId = event.senderId;
      var target = this.targets_[targetName];
      var p = target[methodName].apply(target, args);
      if (targetName == 'player' && methodName == 'load') {
        // Wait until the manifest has actually loaded to send another media
        // info message, so on a new load it doesn't send the old info over.
        p = p.then(function() {
          this.initialStatusUpdatePending_ = true;
        }.bind(this));
      }
      // Replies must go back to the specific sender who initiated, so that we
      // don't have to deal with conflicting IDs between senders.
      p.then(this.sendAsyncComplete_.bind(this, senderId, id, /* error */ null),
             this.sendAsyncComplete_.bind(this, senderId, id));
      break;
    }
  }
};


/**
 * @param {!cast.receiver.CastMessageBus.Event} event
 * @private
 */
shaka.cast.CastReceiver.prototype.onGenericMessage_ = function(event) {
  var message = shaka.cast.CastUtils.deserialize(event.data);
  shaka.log.debug('CastReceiver: message', message);
  // TODO(ismena): error message on duplicate request id from the same sender
  switch (message['type']) {
    case 'PLAY':
      this.video_.play();
      // Notify generic controllers that the player state changed.
      // requestId=0 (the parameter) means that the message was not
      // triggered by a GET_STATUS request.
      this.sendMediaStatus_(0);
      break;
    case 'PAUSE':
      this.video_.pause();
      this.sendMediaStatus_(0);
      break;
    case 'SEEK': {
      var currentTime = message['currentTime'];
      var resumeState = message['resumeState'];
      if (currentTime != null)
        this.video_.currentTime = Number(currentTime);
      if (resumeState && resumeState == 'PLAYBACK_START') {
        this.video_.play();
        this.sendMediaStatus_(0);
      } else if (resumeState && resumeState == 'PLAYBACK_PAUSE') {
        this.video_.pause();
        this.sendMediaStatus_(0);
      }
      break;
    }
    case 'STOP':
      this.player_.unload().then(function() {
        if (!this.player_) {
          // We've already been destroyed.
          return;
        }

        this.sendMediaStatus_(0);
      }.bind(this));
      break;
    case 'GET_STATUS':
      // TODO(ismena): According to the SDK this is supposed to be a
      // unicast message to the sender that requested the status,
      // but it doesn't appear to be working.
      // Look into what's going on there and change this to be a
      // unicast.
      this.sendMediaStatus_(Number(message['requestId']));
      break;
    case 'VOLUME': {
      var volumeObject = message['volume'];
      var level = volumeObject['level'];
      var muted = volumeObject['muted'];
      var oldVolumeLevel = this.video_.volume;
      var oldVolumeMuted = this.video_.muted;
      if (level != null)
        this.video_.volume = Number(level);
      if (muted != null)
        this.video_.muted = muted;
      // Notify generic controllers if the volume changed.
      if (oldVolumeLevel != this.video_.volume ||
          oldVolumeMuted != this.video_.muted) {
        this.sendMediaStatus_(0);
      }
      break;
    }
    case 'LOAD': {
      // Reset update message frequency values after a load.
      this.updateNumber_ = 0;
      this.startUpdatingUpdateNumber_ = false;
      this.initialStatusUpdatePending_ = false; // This already sends an update.

      var mediaInfo = message['media'];
      var contentId = mediaInfo['contentId'];
      var currentTime = message['currentTime'];
      var manifestUri = this.opt_contentIdCallback_(contentId);
      var autoplay = message['autoplay'] || true;
      if (autoplay)
        this.video_.autoplay = true;
      this.player_.load(manifestUri, currentTime).then(function() {
        if (!this.player_) {
          // We've already been destroyed.
          return;
        }

        // Notify generic controllers that the media has changed.
        this.sendMediaInfoMessage_();
      }.bind(this)).catch(function(error) {
        // Load failed. Dispatch the error message to the sender.
        var type = 'LOAD_FAILED';
        if (error.category == shaka.util.Error.Category.PLAYER &&
            error.code == shaka.util.Error.Code.LOAD_INTERRUPTED) {
          type = 'LOAD_CANCELLED';
        }

        this.sendMessage_({
          'requestId': Number(message['requestId']),
          'type': type
        }, this.genericBus_);
      }.bind(this));
      break;
    }
    default:
      shaka.log.warning(
          'Unrecognized message type from the generic Chromecast controller!',
          message['type']);
      // Dispatch an error to the sender.
      this.sendMessage_({
        'requestId': Number(message['requestId']),
        'type': 'INVALID_REQUEST',
        'reason': 'INVALID_COMMAND'
      }, this.genericBus_);
      break;
  }
};


/**
 * Tell the sender that the async operation is complete.
 * @param {string} senderId
 * @param {string} id
 * @param {shaka.util.Error} error
 * @private
 */
shaka.cast.CastReceiver.prototype.sendAsyncComplete_ =
    function(senderId, id, error) {
  if (!this.player_) {
    // We've already been destroyed.
    return;
  }

  this.sendMessage_({
    'type': 'asyncComplete',
    'id': id,
    'error': error
  }, this.shakaBus_, senderId);
};


/**
 * Since this method is in the compiled library, make sure all messages passed
 * in here were created with quoted property names.
 * @param {!Object} message
 * @param {cast.receiver.CastMessageBus} bus
 * @param {string=} opt_senderId
 * @private
 */
shaka.cast.CastReceiver.prototype.sendMessage_ =
    function(message, bus, opt_senderId) {
  // Cuts log spam when debugging the receiver UI in Chrome.
  if (!this.isConnected_) return;

  var serialized = shaka.cast.CastUtils.serialize(message);
  if (opt_senderId) {
    bus.getCastChannel(opt_senderId).send(serialized);
  } else {
    bus.broadcast(serialized);
  }
};


/**
 * @return {string}
 * @private
 */
shaka.cast.CastReceiver.prototype.getPlayState_ = function() {
  var playState = shaka.cast.CastReceiver.PLAY_STATE;
  if (this.isIdle_)
    return playState.IDLE;
  else if (this.player_.isBuffering())
    return playState.BUFFERING;
  else if (this.video_.paused)
    return playState.PAUSED;
  else
    return playState.PLAYING;
};


/**
 * @param {number} requestId
 * @param {Object=} opt_media
 * @private
 */
shaka.cast.CastReceiver.prototype.sendMediaStatus_ =
    function(requestId, opt_media) {
  var mediaStatus = {
    // mediaSessionId is a unique ID for the playback of this specific session.
    // It's used to identify a specific instance of a playback.
    // We don't support multiple playbacks, so just return 0.
    'mediaSessionId': 0,
    'playbackRate': this.video_.playbackRate,
    'playerState': this.getPlayState_(),
    'currentTime': this.video_.currentTime,
    // supportedMediaCommands is a sum of all the flags of commands that the
    // player supports.
    // The list of comands with respective flags is:
    // 1 - Pause
    // 2 - Seek
    // 4 - Stream volume
    // 8 - Stream mute
    // 16 - Skip forward
    // 32 - Skip backward
    // We support pause, seek, volume and mute which gives a value of
    // 1+2+4+8=15
    'supportedMediaCommands': 15,
    'volume': {
      'level': this.video_.volume,
      'muted': this.video_.muted
    }
  };

  if (opt_media)
    mediaStatus['media'] = opt_media;

  var ret = {
    'requestId': requestId,
    'type': 'MEDIA_STATUS',
    'status': [mediaStatus]
  };

  this.sendMessage_(ret, this.genericBus_);
};


/**
 * @enum {string}
 */
shaka.cast.CastReceiver.PLAY_STATE = {
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  BUFFERING: 'BUFFERING',
  PAUSED: 'PAUSED'
};
