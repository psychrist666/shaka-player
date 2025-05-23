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

goog.provide('shaka.test.StreamingEngineUtil');

/** @fileoverview @suppress {missingRequire} */


/**
 * Creates a FakeNetworkingEngine.
 *
 * For each request, the FakeNetworkingEngine parses the request's URI and
 * invokes one of the provided callbacks to obtain a response.
 *
 * A request's URI must follow either the init segment URI pattern:
 * PERIOD_TYPE_init, e.g., "1_audio_init" or "2_video_init"; or the media
 * segment URI pattern: PERIOD_TYPE_POSITION, e.g., "1_text_2" or "2_video_1".
 *
 * @param {function(string, number): BufferSource} getInitSegment Init segment
 *   generator: takes a content type and a Period number; returns an init
 *   segment.
 * @param {function(string, number, number): BufferSource} getSegment Media
 *   segment generator: takes a content type, a Period number, and a segment
 *   position; returns a media segment.
 * @return {!Object} A NetworkingEngine look-alike.
 */
shaka.test.StreamingEngineUtil.createFakeNetworkingEngine = function(
    getInitSegment, getSegment) {
  let netEngine = {
    request: jasmine.createSpy('request'),
    delays: {  // Artificial delays per content type, in seconds.
      audio: 0,
      video: 0,
      text: 0,
    },
  };

  netEngine.request.and.callFake(function(requestType, request) {
    expect(requestType).toBeTruthy();
    expect(request.uris.length).toBe(1);

    var parts = request.uris[0].split('_');
    expect(parts.length).toBe(3);

    var periodNumber = Number(parts[0]);
    expect(periodNumber).not.toBeNaN();
    expect(periodNumber).toBeGreaterThan(0);
    expect(Math.floor(periodNumber)).toEqual(periodNumber);

    var contentType = parts[1];

    var buffer;
    if (parts[2] == 'init') {
      buffer = getInitSegment(contentType, periodNumber);
    } else {
      var position = Number(parts[2]);
      expect(position).not.toBeNaN();
      expect(position).toBeGreaterThan(0);
      expect(Math.floor(position)).toEqual(position);
      buffer = getSegment(contentType, periodNumber, position);
    }

    const response = {uri: request.uris[0], data: buffer, headers: {}};
    const p = new Promise((resolve) => {
      setTimeout(() => {
        resolve(response);
      }, netEngine.delays[contentType] * 1000);
    });
    return p;
  });

  netEngine.expectRequest = function(uri, type) {
    shaka.test.FakeNetworkingEngine.expectRequest(
        netEngine.request, uri, type);
  };

  netEngine.expectNoRequest = function(uri, type) {
    shaka.test.FakeNetworkingEngine.expectNoRequest(
        netEngine.request, uri, type);
  };

  netEngine.expectRangeRequest = function(uri, startByte, endByte) {
    shaka.test.FakeNetworkingEngine.expectRangeRequest(
        netEngine.request, uri, startByte, endByte);
  };

  return netEngine;
};


/**
 * Creates a fake PresentationTimeline.
 *
 * The FakePresentationTimeline has two special properties:
 * |segmentAvailabilityStart| and |segmentAvailabilityEnd|, which set the
 * return value of getSegmentAvailabilityStart() and
 * getSegmentAvailabilityEnd() respectively.
 *
 * @param {number} segmentAvailabilityStart The initial value of
 *   |segmentAvailabilityStart|.
 * @param {number} segmentAvailabilityEnd The initial value of
 *   |segmentAvailabilityEnd|.
 * @param {number} presentationDuration
 * @param {number} maxSegmentDuration
 * @param {boolean} isLive
 * @return {!Object} A PresentationTimeline look-alike.
 *
 */
shaka.test.StreamingEngineUtil.createFakePresentationTimeline = function(
    segmentAvailabilityStart, segmentAvailabilityEnd, presentationDuration,
    maxSegmentDuration, isLive) {
  var timeline = {
    getDuration: jasmine.createSpy('getDuration'),
    setDuration: jasmine.createSpy('setDuration'),
    getMaxSegmentDuration: jasmine.createSpy('getMaxSegmentDuration'),
    isLive: jasmine.createSpy('isLive'),
    getEarliestStart: jasmine.createSpy('getEarliestStart'),
    getSegmentAvailabilityStart:
        jasmine.createSpy('getSegmentAvailabilityStart'),
    getSegmentAvailabilityEnd:
        jasmine.createSpy('getSegmentAvailabilityEnd'),
    getSafeSeekRangeStart: jasmine.createSpy('getSafeSeekRangeStart'),
    getSeekRangeStart: jasmine.createSpy('getSeekRangeStart'),
    getSeekRangeEnd: jasmine.createSpy('getSeekRangeEnd'),
    segmentAvailabilityStart: segmentAvailabilityStart,
    segmentAvailabilityEnd: segmentAvailabilityEnd
  };

  timeline.getDuration.and.returnValue(presentationDuration);

  timeline.getMaxSegmentDuration.and.returnValue(maxSegmentDuration);

  timeline.isLive.and.callFake(function() {
    return isLive;
  });

  timeline.getEarliestStart.and.callFake(function() {
    return timeline.segmentAvailabilityStart;
  });

  timeline.getSegmentAvailabilityStart.and.callFake(function() {
    return timeline.segmentAvailabilityStart;
  });

  timeline.getSegmentAvailabilityEnd.and.callFake(function() {
    return timeline.segmentAvailabilityEnd;
  });

  timeline.getSafeSeekRangeStart.and.callFake(function(delay) {
    return shaka.test.Util.invokeSpy(timeline.getSegmentAvailabilityStart) +
        delay;
  });

  timeline.getSeekRangeStart.and.callFake(function() {
    return shaka.test.Util.invokeSpy(timeline.getSegmentAvailabilityStart);
  });

  timeline.getSeekRangeEnd.and.callFake(function() {
    return shaka.test.Util.invokeSpy(timeline.getSegmentAvailabilityEnd);
  });

  // These methods should not be invoked.
  timeline.setDuration.and.throwError(
      new Error('unexpected call to setDuration()'));

  return timeline;
};


/**
 * Creates a fake Manifest.
 *
 * Each Period within the fake Manifest has one Variant and one
 * text stream.
 *
 * Audio, Video, and Text Stream MIME types are set to
 * "audio/mp4; codecs=mp4a.40.2", "video/mp4; codecs=avc1.42c01e",
 * and "text/vtt" respectively.
 *
 * Each media segment's URI follows the media segment URI pattern:
 * PERIOD_TYPE_POSITION, e.g., "1_text_2" or "2_video_1".
 *
 * @param {!Array.<number>} periodStartTimes The start time of each Period.
 * @param {number} presentationDuration
 * @param {!Object.<string, number>} segmentDurations The duration of each
 *   type of segment.
 * @return {shakaExtern.Manifest}
 */
shaka.test.StreamingEngineUtil.createManifest = function(
    periodStartTimes, presentationDuration, segmentDurations) {
  var boundsCheckPosition =
      shaka.test.StreamingEngineUtil.boundsCheckPosition.bind(
          null, periodStartTimes, presentationDuration, segmentDurations);

  /**
   * @param {string} type
   * @param {number} periodNumber
   * @param {number} time
   * @return {?number} A segment position.
   */
  function find(type, periodNumber, time) {
    // Note: |time| is relative to a Period's start time.
    var position = Math.floor(time / segmentDurations[type]) + 1;
    return boundsCheckPosition(type, periodNumber, position);
  }

  /**
   * @param {string} type
   * @param {number} periodNumber
   * @param {number} position
   * @return {shaka.media.SegmentReference} A SegmentReference.
   */
  function get(type, periodNumber, position) {
    if (boundsCheckPosition(type, periodNumber, position) == null)
      return null;

    var d = segmentDurations[type];
    var getUris = function() {
      return ['' + periodNumber + '_' + type + '_' + position];
    };
    return new shaka.media.SegmentReference(
        position, (position - 1) * d, position * d, getUris, 0, null);
  }

  var manifest = {
    presentationTimeline: undefined,  // Should be set externally.
    minBufferTime: undefined,  // Should be set externally.
    periods: []
  };

  // Populate the Manifest.
  var id = 0;
  for (var i = 0; i < periodStartTimes.length; ++i) {
    var period = {
      startTime: periodStartTimes[i],
      variants: [],
      textStreams: []
    };

    var variant = {};
    var trickModeVideo;

    for (var type in segmentDurations) {
      var stream = shaka.test.StreamingEngineUtil.createMockStream(type, id++);
      stream.createSegmentIndex.and.returnValue(Promise.resolve());
      stream.findSegmentPosition.and.callFake(find.bind(null, type, i + 1));
      stream.getSegmentReference.and.callFake(get.bind(null, type, i + 1));

      var ContentType = shaka.util.ManifestParserUtils.ContentType;
      if (type == ContentType.TEXT) period.textStreams.push(stream);
      else if (type == ContentType.AUDIO) variant.audio = stream;
      else if (type == 'trickvideo') trickModeVideo = stream;
      else variant.video = stream;
    }

    variant.video.trickModeVideo = trickModeVideo;
    period.variants.push(variant);
    manifest.periods.push(period);
  }

  return /** @type {shakaExtern.Manifest} */ (manifest);
};


/**
 * Returns |position| if |type|, |periodNumber|, and |position| correspond
 * to a valid segment, as dictated by the provided metadata: |periodStartTimes|,
 * |presentationDuration|, and |segmentDurations|.
 *
 * @param {!Array.<number>} periodStartTimes
 * @param {number} presentationDuration
 * @param {!Object.<string, number>} segmentDurations
 * @param {string} type
 * @param {number} periodNumber
 * @param {number} position
 * @return {?number}
 */
shaka.test.StreamingEngineUtil.boundsCheckPosition = function(
    periodStartTimes, presentationDuration, segmentDurations,
    type, periodNumber, position) {
  var numSegments = shaka.test.StreamingEngineUtil.getNumSegments(
      periodStartTimes, presentationDuration, segmentDurations,
      type, periodNumber);
  return position >= 1 && position <= numSegments ? position : null;
};


/**
 * @param {!Array.<number>} periodStartTimes
 * @param {number} presentationDuration
 * @param {!Object.<string, number>} segmentDurations
 * @param {string} type
 * @param {number} periodNumber
 * @return {number}
 */
shaka.test.StreamingEngineUtil.getNumSegments = function(
    periodStartTimes, presentationDuration, segmentDurations,
    type, periodNumber) {
  var periodIndex = periodNumber - 1;
  var nextStartTime = periodIndex < periodStartTimes.length - 1 ?
                      periodStartTimes[periodIndex + 1] :
                      presentationDuration;
  var periodDuration = nextStartTime - periodStartTimes[periodIndex];
  return Math.ceil(periodDuration / segmentDurations[type]);
};


/**
 * Creates a mock Stream of the given type.
 *
 * @param {string} type
 * @param {number} id
 * @return {!Object}
 */
shaka.test.StreamingEngineUtil.createMockStream = function(type, id) {
  return {
    audio: shaka.test.StreamingEngineUtil.createMockAudioStream,
    video: shaka.test.StreamingEngineUtil.createMockVideoStream,
    trickvideo: shaka.test.StreamingEngineUtil.createMockVideoStream,
    text: shaka.test.StreamingEngineUtil.createMockTextStream
  }[type](id);
};


/**
 * Creates a mock audio Stream.
 *
 * @param {number} id
 * @return {!Object}
 */
shaka.test.StreamingEngineUtil.createMockAudioStream = function(id) {
  var ContentType = shaka.util.ManifestParserUtils.ContentType;
  return {
    id: id,
    createSegmentIndex: jasmine.createSpy('createSegmentIndex'),
    findSegmentPosition: jasmine.createSpy('findSegmentPosition'),
    getSegmentReference: jasmine.createSpy('getSegmentReference'),
    initSegmentReference: null,
    presentationTimeOffset: 0,
    mimeType: 'audio/mp4',
    codecs: 'mp4a.40.2',
    bandwidth: 192000,
    type: ContentType.AUDIO
  };
};


/**
 * Creates a mock video Stream.
 *
 * @param {number} id
 * @return {!Object}
 */
shaka.test.StreamingEngineUtil.createMockVideoStream = function(id) {
  var ContentType = shaka.util.ManifestParserUtils.ContentType;
  return {
    id: id,
    createSegmentIndex: jasmine.createSpy('createSegmentIndex'),
    findSegmentPosition: jasmine.createSpy('findSegmentPosition'),
    getSegmentReference: jasmine.createSpy('getSegmentReference'),
    initSegmentReference: null,
    presentationTimeOffset: 0,
    mimeType: 'video/mp4',
    codecs: 'avc1.42c01e',
    bandwidth: 5000000,
    width: 600,
    height: 400,
    type: ContentType.VIDEO
  };
};


/**
 * Creates a mock text Stream.
 *
 * @param {number} id
 * @return {!Object}
 */
shaka.test.StreamingEngineUtil.createMockTextStream = function(id) {
  var ManifestParserUtils = shaka.util.ManifestParserUtils;
  return {
    id: id,
    createSegmentIndex: jasmine.createSpy('createSegmentIndex'),
    findSegmentPosition: jasmine.createSpy('findSegmentPosition'),
    getSegmentReference: jasmine.createSpy('getSegmentReference'),
    initSegmentReference: null,
    presentationTimeOffset: 0,
    mimeType: 'text/vtt',
    kind: ManifestParserUtils.TextStreamKind.SUBTITLE,
    type: ManifestParserUtils.ContentType.TEXT
  };
};

