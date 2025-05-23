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

describe('StreamingEngine', function() {
  var Util = shaka.test.Util;
  var ContentType = shaka.util.ManifestParserUtils.ContentType;
  var Uint8ArrayUtils = shaka.util.Uint8ArrayUtils;

  // Dummy byte ranges and sizes for initialization and media segments.
  // Create empty object first and initialize the fields through
  // [] to allow field names to be expressions.
  /**
   * @type {!Object.<shaka.util.ManifestParserUtils.ContentType,
   *                 !Array.<number>>}
   */
  var initSegmentRanges = {};
  initSegmentRanges[ContentType.AUDIO] = [100, 1000];
  initSegmentRanges[ContentType.VIDEO] = [200, 2000];

  /** @type {!Object.<shaka.util.ManifestParserUtils.ContentType, number>} */
  var segmentSizes = {};
  segmentSizes[ContentType.AUDIO] = 1000;
  segmentSizes[ContentType.VIDEO] = 10000;
  segmentSizes[ContentType.TEXT] = 500;

  /** @type {!Object.<string, shaka.test.FakeMediaSourceEngine.SegmentData>} */
  var segmentData;
  /** @type {!shaka.test.FakePlayhead} */
  var playhead;
  /** @type {number} */
  var playheadTime;
  /** @type {boolean} */
  var playing;

  /** @type {!shaka.test.FakeMediaSourceEngine} */
  var mediaSourceEngine;
  var netEngine;
  var timeline;

  var audioStream1;
  var videoStream1;
  var variant1;
  var textStream1;
  var alternateVideoStream1;

  var audioStream2;
  var videoStream2;
  var variant2;
  var textStream2;

  /** @type {shakaExtern.Manifest} */
  var manifest;

  /** @type {!jasmine.Spy} */
  var onChooseStreams;
  /** @type {!jasmine.Spy} */
  var onCanSwitch;
  /** @type {!jasmine.Spy} */
  var onError;
  /** @type {!jasmine.Spy} */
  var onEvent;
  /** @type {!jasmine.Spy} */
  var onManifestUpdate;
  /** @type {!jasmine.Spy} */
  var onInitialStreamsSetup;
  /** @type {!jasmine.Spy} */
  var onStartupComplete;

  /** @type {!shaka.media.StreamingEngine} */
  var streamingEngine;

  /**
   * Runs the fake event loop.
   * @param {function()=} opt_callback An optional callback that is executed
   *   each time the clock ticks.
   */
  function runTest(opt_callback) {
    function onTick(currentTime) {
      if (opt_callback) opt_callback();
      if (playing) {
        playheadTime++;
      }
    }
    // No test should require more than 60 seconds of simulated time.
    Util.fakeEventLoop(60, onTick);
  }

  beforeAll(function() {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    // This polyfill is required for fakeEventLoop.
    shaka.polyfill.Promise.install(/* force */ true);
  });

  /** @param {boolean=} opt_trickMode */
  function setupVod(opt_trickMode) {
    // For VOD, we fake a presentation that has 2 Periods of equal duration
    // (20 seconds), where each Period has 1 Variant and 1 text stream.
    //
    // There are 4 initialization segments: 1 audio and 1 video for the
    // first Period, and 1 audio and 1 video for the second Period.
    //
    // There are 12 media segments: 2 audio, 2 video, and 2 text for the
    // first Period, and 2 audio, 2 video, and 2 text for the second Period.
    // All media segments are (by default) 10 seconds long.

    // Create SegmentData map for FakeMediaSourceEngine.
    var initSegmentSizeAudio = initSegmentRanges[ContentType.AUDIO][1] -
        initSegmentRanges[ContentType.AUDIO][0] + 1;
    var initSegmentSizeVideo = initSegmentRanges[ContentType.VIDEO][1] -
        initSegmentRanges[ContentType.VIDEO][0] + 1;

    function makeBuffer(size) { return new ArrayBuffer(size); }
    segmentData = {
      audio: {
        initSegments: [
          makeBuffer(initSegmentSizeAudio), makeBuffer(initSegmentSizeAudio)
        ],
        segments: [
          makeBuffer(segmentSizes[ContentType.AUDIO]),
          makeBuffer(segmentSizes[ContentType.AUDIO]),
          makeBuffer(segmentSizes[ContentType.AUDIO]),
          makeBuffer(segmentSizes[ContentType.AUDIO])
        ],
        segmentStartTimes: [0, 10, 0, 10],
        segmentPeriodTimes: [0, 0, 20, 20],
        segmentDuration: 10
      },
      video: {
        initSegments: [
          makeBuffer(initSegmentSizeVideo), makeBuffer(initSegmentSizeVideo)
        ],
        segments: [
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO])
        ],
        segmentStartTimes: [0, 10, 0, 10],
        segmentPeriodTimes: [0, 0, 20, 20],
        segmentDuration: 10
      },
      text: {
        initSegments: [],
        segments: [
          makeBuffer(segmentSizes[ContentType.TEXT]),
          makeBuffer(segmentSizes[ContentType.TEXT]),
          makeBuffer(segmentSizes[ContentType.TEXT]),
          makeBuffer(segmentSizes[ContentType.TEXT])
        ],
        segmentStartTimes: [0, 10, 0, 10],
        segmentPeriodTimes: [0, 0, 20, 20],
        segmentDuration: 10
      }
    };
    if (opt_trickMode) {
      segmentData.trickvideo = {
        initSegments: [
          makeBuffer(initSegmentSizeVideo), makeBuffer(initSegmentSizeVideo)
        ],
        segments: [
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO]),
          makeBuffer(segmentSizes[ContentType.VIDEO])
        ],
        segmentStartTimes: [0, 10, 0, 10],
        segmentPeriodTimes: [0, 0, 20, 20],
        segmentDuration: 10
      };
    }

    playhead = new shaka.test.FakePlayhead();
    playheadTime = 0;
    playing = false;

    setupNetworkingEngine(
        2 /* segmentsInFirstPeriod */,
        2 /* segmentsInSecondPeriod */);

    timeline = shaka.test.StreamingEngineUtil.createFakePresentationTimeline(
        0 /* segmentAvailabilityStart */,
        40 /* segmentAvailabilityEnd */,
        40 /* presentationDuration */,
        10 /* maxSegmentDuration */,
        false /* isLive */);

    setupManifest(
        0 /* firstPeriodStartTime */,
        20 /* secondPeriodStartTime */,
        40 /* presentationDuration */);
  }

  function setupLive() {
    // For live, we fake a presentation that has 2 Periods of different
    // durations (120 seconds and 20 seconds respectively), where each Period
    // has 1 Variant and 1 text stream.
    //
    // There are 4 initialization segments: 1 audio and 1 video for the
    // first Period, and 1 audio and 1 video for the second Period.
    //
    // There are 14 media segments: 12 audio, 12 video, and 12 text for the
    // first Period, and 2 audio, 2 video, and 2 text for the second Period.
    // All media segments are (by default) 10 seconds long.
    //
    // The segment availability window starts at t=100 (segment 11) and extends
    // to t=120 (segment 13).

    // Create SegmentData map for FakeMediaSourceEngine.
    var initSegmentSizeAudio = initSegmentRanges[ContentType.AUDIO][1] -
        initSegmentRanges[ContentType.AUDIO][0] + 1;
    var initSegmentSizeVideo = initSegmentRanges[ContentType.VIDEO][1] -
        initSegmentRanges[ContentType.VIDEO][0] + 1;

    function makeBuffer(size) { return new ArrayBuffer(size); }
    segmentData = {
      audio: {
        initSegments:
            [makeBuffer(initSegmentSizeAudio),
             makeBuffer(initSegmentSizeAudio)],
        segments: [],
        segmentStartTimes: [],
        segmentPeriodTimes: [],
        segmentDuration: 10
      },
      video: {
        initSegments:
            [makeBuffer(initSegmentSizeVideo),
             makeBuffer(initSegmentSizeVideo)],
        segments: [],
        segmentStartTimes: [],
        segmentPeriodTimes: [],
        segmentDuration: 10
      },
      text: {
        initSegments: [],
        segments: [],
        segmentStartTimes: [],
        segmentPeriodTimes: [],
        segmentDuration: 10
      }
    };

    var segmentsInFirstPeriod = 12;
    for (var i = 0; i < segmentsInFirstPeriod; ++i) {
      segmentData[ContentType.AUDIO].segments.push(
          makeBuffer(segmentSizes[ContentType.AUDIO]));
      segmentData[ContentType.VIDEO].segments.push(
          makeBuffer(segmentSizes[ContentType.VIDEO]));
      segmentData[ContentType.TEXT].segments.push(
          makeBuffer(segmentSizes[ContentType.TEXT]));

      segmentData[ContentType.AUDIO].segmentStartTimes.push(i * 10);
      segmentData[ContentType.VIDEO].segmentStartTimes.push(i * 10);
      segmentData[ContentType.TEXT].segmentStartTimes.push(i * 10);

      segmentData[ContentType.AUDIO].segmentPeriodTimes.push(0);
      segmentData[ContentType.VIDEO].segmentPeriodTimes.push(0);
      segmentData[ContentType.TEXT].segmentPeriodTimes.push(0);
    }

    var segmentsInSecondPeriod = 2;
    for (var i = 0; i < segmentsInSecondPeriod; ++i) {
      segmentData[ContentType.AUDIO].segments.push(
          makeBuffer(segmentSizes[ContentType.AUDIO]));
      segmentData[ContentType.VIDEO].segments.push(
          makeBuffer(segmentSizes[ContentType.VIDEO]));
      segmentData[ContentType.TEXT].segments.push(
          makeBuffer(segmentSizes[ContentType.TEXT]));

      segmentData[ContentType.AUDIO].segmentStartTimes.push(i * 10);
      segmentData[ContentType.VIDEO].segmentStartTimes.push(i * 10);
      segmentData[ContentType.TEXT].segmentStartTimes.push(i * 10);

      segmentData[ContentType.AUDIO].segmentPeriodTimes.push(
          segmentsInFirstPeriod * 10);
      segmentData[ContentType.VIDEO].segmentPeriodTimes.push(
          segmentsInFirstPeriod * 10);
      segmentData[ContentType.TEXT].segmentPeriodTimes.push(
          segmentsInFirstPeriod * 10);
    }

    playhead = new shaka.test.FakePlayhead();
    playheadTime = 110;
    playing = false;

    setupNetworkingEngine(
        12 /* segmentsInFirstPeriod */,
        2 /* segmentsInSecondPeriod */);

    timeline = shaka.test.StreamingEngineUtil.createFakePresentationTimeline(
        100 /* segmentAvailabilityStart */,
        140 /* segmentAvailabilityEnd */,
        140 /* presentationDuration */,
        10 /* maxSegmentDuration */,
        true /* isLive */);

    setupManifest(
        0 /* firstPeriodStartTime */,
        120 /* secondPeriodStartTime */,
        140 /* presentationDuration */);
  }

  function setupNetworkingEngine(
      segmentsInFirstPeriod, segmentsInSecondPeriod) {

    // Create the fake NetworkingEngine. Note: the StreamingEngine should never
    // request a segment that does not exist.
    netEngine = shaka.test.StreamingEngineUtil.createFakeNetworkingEngine(
        // Init segment generator:
        function(type, periodNumber) {
          expect((periodNumber == 1) || (periodNumber == 2));
          return segmentData[type].initSegments[periodNumber - 1];
        },
        // Media segment generator:
        function(type, periodNumber, position) {
          expect(position).toBeGreaterThan(0);
          expect((periodNumber == 1 && position <= segmentsInFirstPeriod) ||
                 (periodNumber == 2 && position <= segmentsInSecondPeriod));
          var i = (segmentsInFirstPeriod * (periodNumber - 1)) + (position - 1);
          return segmentData[type].segments[i];
        });
  }

  function setupManifest(
      firstPeriodStartTime, secondPeriodStartTime, presentationDuration) {
    var segmentDurations = {
      audio: segmentData[ContentType.AUDIO].segmentDuration,
      video: segmentData[ContentType.VIDEO].segmentDuration,
      text: segmentData[ContentType.TEXT].segmentDuration
    };
    if (segmentData['trickvideo']) {
      segmentDurations['trickvideo'] =
          segmentData['trickvideo'].segmentDuration;
    }
    manifest = shaka.test.StreamingEngineUtil.createManifest(
        [firstPeriodStartTime, secondPeriodStartTime], presentationDuration,
        segmentDurations);

    manifest.presentationTimeline =
        /** @type {!shaka.media.PresentationTimeline} */ (timeline);
    manifest.minBufferTime = 2;

    // Create InitSegmentReferences.
    manifest.periods[0].variants[0].audio.initSegmentReference =
        new shaka.media.InitSegmentReference(
            function() { return ['1_audio_init']; },
            initSegmentRanges[ContentType.AUDIO][0],
            initSegmentRanges[ContentType.AUDIO][1]);
    manifest.periods[0].variants[0].video.initSegmentReference =
        new shaka.media.InitSegmentReference(
            function() { return ['1_video_init']; },
            initSegmentRanges[ContentType.VIDEO][0],
            initSegmentRanges[ContentType.VIDEO][1]);
    if (manifest.periods[0].variants[0].video.trickModeVideo) {
      manifest.periods[0].variants[0].video.trickModeVideo
          .initSegmentReference = new shaka.media.InitSegmentReference(
              function() { return ['1_trickvideo_init']; },
              initSegmentRanges[ContentType.VIDEO][0],
              initSegmentRanges[ContentType.VIDEO][1]);
    }
    manifest.periods[1].variants[0].audio.initSegmentReference =
        new shaka.media.InitSegmentReference(
            function() { return ['2_audio_init']; },
            initSegmentRanges[ContentType.AUDIO][0],
            initSegmentRanges[ContentType.AUDIO][1]);
    manifest.periods[1].variants[0].video.initSegmentReference =
        new shaka.media.InitSegmentReference(
            function() { return ['2_video_init']; },
            initSegmentRanges[ContentType.VIDEO][0],
            initSegmentRanges[ContentType.VIDEO][1]);
    if (manifest.periods[1].variants[0].video.trickModeVideo) {
      manifest.periods[1].variants[0].video.trickModeVideo
          .initSegmentReference = new shaka.media.InitSegmentReference(
              function() { return ['2_trickvideo_init']; },
              initSegmentRanges[ContentType.VIDEO][0],
              initSegmentRanges[ContentType.VIDEO][1]);
    }

    audioStream1 = manifest.periods[0].variants[0].audio;
    videoStream1 = manifest.periods[0].variants[0].video;
    variant1 = manifest.periods[0].variants[0];
    textStream1 = manifest.periods[0].textStreams[0];

    // This Stream is only used to verify that StreamingEngine can setup
    // Streams correctly. It does not have init or media segments.
    alternateVideoStream1 =
        shaka.test.StreamingEngineUtil.createMockVideoStream(8);
    alternateVideoStream1.createSegmentIndex.and.returnValue(Promise.resolve());
    alternateVideoStream1.findSegmentPosition.and.returnValue(null);
    alternateVideoStream1.getSegmentReference.and.returnValue(null);
    var variant = {
      audio: null,
      video: /** @type {shakaExtern.Stream} */ (alternateVideoStream1),
      id: 0,
      language: 'und',
      primary: false,
      bandwidth: 0,
      drmInfos: [],
      allowedByApplication: true,
      allowedByKeySystem: true
    };
    manifest.periods[0].variants.push(variant);

    audioStream2 = manifest.periods[1].variants[0].audio;
    videoStream2 = manifest.periods[1].variants[0].video;
    variant2 = manifest.periods[1].variants[0];
    textStream2 = manifest.periods[1].textStreams[0];
  }

  /**
   * Creates the StreamingEngine.
   **
   * @param {shakaExtern.StreamingConfiguration=} opt_config Optional
   *   configuration object which overrides the default one.
   */
  function createStreamingEngine(opt_config) {
    onChooseStreams = jasmine.createSpy('onChooseStreams');
    onCanSwitch = jasmine.createSpy('onCanSwitch');
    onInitialStreamsSetup = jasmine.createSpy('onInitialStreamsSetup');
    onStartupComplete = jasmine.createSpy('onStartupComplete');
    onError = jasmine.createSpy('onError');
    onError.and.callFake(fail);
    onEvent = jasmine.createSpy('onEvent');
    onManifestUpdate = jasmine.createSpy('onManifestUpdate');

    var config;
    if (opt_config) {
      config = opt_config;
    } else {
      config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
    }

    var playerInterface = {
      playhead: playhead,
      mediaSourceEngine: mediaSourceEngine,
      netEngine: /** @type {!shaka.net.NetworkingEngine} */(netEngine),
      onChooseStreams: Util.spyFunc(onChooseStreams),
      onCanSwitch: Util.spyFunc(onCanSwitch),
      onError: Util.spyFunc(onError),
      onEvent: Util.spyFunc(onEvent),
      onManifestUpdate: Util.spyFunc(onManifestUpdate),
      onSegmentAppended: function() {},
      onInitialStreamsSetup: Util.spyFunc(onInitialStreamsSetup),
      onStartupComplete: Util.spyFunc(onStartupComplete)
    };
    streamingEngine = new shaka.media.StreamingEngine(
        /** @type {shakaExtern.Manifest} */(manifest), playerInterface);
    streamingEngine.configure(config);
  }

  afterEach(function(done) {
    streamingEngine.destroy().catch(fail).then(done);
    shaka.polyfill.Promise.flush();
  });

  afterAll(function() {
    shaka.polyfill.Promise.uninstall();
    jasmine.clock().uninstall();
  });

  // This test initializes the StreamingEngine (SE) and allows it to play
  // through both Periods.
  //
  // After calling init() the following should occur:
  //   1. SE should immediately call onChooseStreams() with the first Period.
  //   2. SE should setup each of the initial Streams and then call
  //      onInitialStreamsSetup().
  //   3. SE should start appending the initial Streams' segments and in
  //      parallel setup the remaining Streams within the Manifest.
  //      - SE should call onStartupComplete() after it has buffered at least 1
  //        segment of each type of content.
  //      - SE should call onCanSwitch() with the first Period after it has
  //        setup the remaining Streams within the first Period.
  //   4. SE should call onChooseStreams() with the second Period after it has
  //      both segments within the first Period.
  //      - We must return the Streams within the second Period.
  //   5. SE should call onCanSwitch() with the second Period shortly after
  //      step 4.
  //   6. SE should call MediaSourceEngine.endOfStream() after it has appended
  //      both segments within the second Period. At this point the playhead
  //      should not be at the end of the presentation, but the test will be
  //      effectively over since SE will have nothing else to do.
  it('initializes and plays VOD', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);

    onStartupComplete.and.callFake(function() {
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [true, false],
        video: [true, false],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, false, false, false],
        video: [true, false, false, false],
        text: [true, false, false, false]
      });

      setupFakeGetTime(0);
    });

    expect(mediaSourceEngine.reinitText).not.toHaveBeenCalled();

    onChooseStreams.and.callFake(function(period) {
      expect(period).toBe(manifest.periods[0]);

      onCanSwitch.and.callFake(function() {
        expect(alternateVideoStream1.createSegmentIndex).toHaveBeenCalled();
        expect(mediaSourceEngine.reinitText).not.toHaveBeenCalled();
        mediaSourceEngine.reinitText.calls.reset();
        onCanSwitch.and.throwError(new Error());
      });

      // For second Period.
      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[1]);

        // Verify buffers.
        expect(mediaSourceEngine.initSegments).toEqual({
          audio: [true, false],
          video: [true, false],
          text: []
        });
        expect(mediaSourceEngine.segments).toEqual({
          audio: [true, true, false, false],
          video: [true, true, false, false],
          text: [true, true, false, false]
        });

        verifyNetworkingEngineRequestCalls(1);

        onCanSwitch.and.callFake(function() {
          expect(audioStream2.createSegmentIndex).toHaveBeenCalled();
          expect(videoStream2.createSegmentIndex).toHaveBeenCalled();
          expect(textStream2.createSegmentIndex).toHaveBeenCalled();
          expect(mediaSourceEngine.reinitText).toHaveBeenCalled();
          mediaSourceEngine.reinitText.calls.reset();
          onCanSwitch.and.throwError(new Error());
        });

        // Switch to the second Period.
        return defaultOnChooseStreams(period);
      });

      // Init the first Period.
      return defaultOnChooseStreams(period);
    });

    onInitialStreamsSetup.and.callFake(function() {
      // Create empty object first and initialize the fields through
      // [] to allow field names to be expressions.
      var expectedObject = {};
      expectedObject[ContentType.AUDIO] = audioStream1;
      expectedObject[ContentType.VIDEO] = videoStream1;
      expectedObject[ContentType.TEXT] = textStream1;
      expect(mediaSourceEngine.init)
          .toHaveBeenCalledWith(expectedObject);
      expect(mediaSourceEngine.init.calls.count()).toBe(1);
      mediaSourceEngine.init.calls.reset();

      expect(mediaSourceEngine.setDuration).toHaveBeenCalledWith(40);
      expect(mediaSourceEngine.setDuration.calls.count()).toBe(1);
      mediaSourceEngine.setDuration.calls.reset();

      expect(audioStream1.createSegmentIndex).toHaveBeenCalled();
      expect(videoStream1.createSegmentIndex).toHaveBeenCalled();
      expect(textStream1.createSegmentIndex).toHaveBeenCalled();

      expect(alternateVideoStream1.createSegmentIndex).not.toHaveBeenCalled();
    });

    // Here we go!
    streamingEngine.init();

    runTest();
    expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

    // Verify buffers.
    expect(mediaSourceEngine.initSegments).toEqual({
      audio: [false, true],
      video: [false, true],
      text: []
    });
    expect(mediaSourceEngine.segments).toEqual({
      audio: [true, true, true, true],
      video: [true, true, true, true],
      text: [true, true, true, true]
    });

    verifyNetworkingEngineRequestCalls(2);
  });

  describe('loadNewTextStream', function() {
    it('clears MediaSourceEngine', function() {
      setupVod();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();
      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {setupFakeGetTime(0);});
      onChooseStreams.and.callFake(onChooseStreamsWithUnloadedText);

      streamingEngine.init();

      runTest(function() {
        if (playheadTime == 20) {
          mediaSourceEngine.clear.calls.reset();
          mediaSourceEngine.init.calls.reset();
          streamingEngine.loadNewTextStream(textStream1,
                                            /* createMediaState */ true);
          expect(mediaSourceEngine.clear).toHaveBeenCalledWith('text');
          expect(mediaSourceEngine.init).toHaveBeenCalledWith(
              {text: jasmine.any(Object)});
        }
      });
    });
  });

  describe('unloadTextStream', function() {
    it('doesn\'t send requests for text after calling unload', function() {
      setupVod();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();
      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {setupFakeGetTime(0);});
      onChooseStreams.and.callFake(onChooseStreamsWithUnloadedText);

      streamingEngine.init();
      var segmentType = shaka.net.NetworkingEngine.RequestType.SEGMENT;

      // Verify that after unloading text stream, no network request for text
      // is sent.
      runTest(function() {
        if (playheadTime == 1) {
          netEngine.expectRequest('1_text_1', segmentType);
          netEngine.request.calls.reset();
          streamingEngine.unloadTextStream();
        } else if (playheadTime == 35) {
          netEngine.expectNoRequest('1_text_1', segmentType);
          netEngine.expectNoRequest('1_text_2', segmentType);
          netEngine.expectNoRequest('2_text_1', segmentType);
          netEngine.expectNoRequest('2_text_2', segmentType);
        }
      });
    });
  });

  it('initializes and plays live', function() {
    setupLive();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(100);

    onStartupComplete.and.callFake(function() {
      setupFakeGetTime(100);
    });

    onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));

    // Here we go!
    streamingEngine.init();

    runTest(slideSegmentAvailabilityWindow);
    expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

    // Verify buffers.
    expect(mediaSourceEngine.initSegments).toEqual({
      audio: [false, true],
      video: [false, true],
      text: []
    });

    // Since we started playback from segment 11, segments 10 through 14
    // should be buffered.
    for (var i = 0; i <= 8; ++i) {
      expect(mediaSourceEngine.segments[ContentType.AUDIO][i]).toBeFalsy();
      expect(mediaSourceEngine.segments[ContentType.VIDEO][i]).toBeFalsy();
      expect(mediaSourceEngine.segments[ContentType.TEXT][i]).toBeFalsy();
    }

    for (var i = 9; i <= 13; ++i) {
      expect(mediaSourceEngine.segments[ContentType.AUDIO][i]).toBeTruthy();
      expect(mediaSourceEngine.segments[ContentType.VIDEO][i]).toBeTruthy();
      expect(mediaSourceEngine.segments[ContentType.TEXT][i]).toBeTruthy();
    }
  });

  // Start the playhead in the first Period but pass init() Streams from the
  // second Period.
  it('plays from 1st Period when passed Streams from 2nd', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(function() {
      setupFakeGetTime(0);
    });

    onChooseStreams.and.callFake(function(period) {
      expect(period).toBe(manifest.periods[0]);

      // Start with Streams from the second Period even though the playhead is
      // in the first Period. onChooseStreams() should be called again for the
      // first Period and then eventually for the second Period.

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          return defaultOnChooseStreams(period);
        });

        return defaultOnChooseStreams(period);
      });

      return { variant: variant2, text: textStream2 };
    });

    streamingEngine.init();

    runTest();
    // Verify buffers.
    expect(mediaSourceEngine.initSegments).toEqual({
      audio: [false, true],
      video: [false, true],
      text: []
    });
    expect(mediaSourceEngine.segments).toEqual({
      audio: [true, true, true, true],
      video: [true, true, true, true],
      text: [true, true, true, true]
    });
  });

  // Start the playhead in the second Period but pass init() Streams from the
  // first Period.
  it('plays from 2nd Period when passed Streams from 1st', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(20);
    onStartupComplete.and.callFake(function() {
      setupFakeGetTime(20);
    });

    onChooseStreams.and.callFake(function(period) {
      expect(period).toBe(manifest.periods[1]);

      // Start with Streams from the first Period even though the playhead is
      // in the second Period. onChooseStreams() should be called again for the
      // second Period.

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[1]);

        onChooseStreams.and.throwError(new Error());

        return defaultOnChooseStreams(period);
      });

      return { variant: variant1, text: textStream1 };
    });

    streamingEngine.init();

    runTest();
    // Verify buffers.
    expect(mediaSourceEngine.initSegments).toEqual({
      audio: [false, true],
      video: [false, true],
      text: []
    });
    expect(mediaSourceEngine.segments).toEqual({
      audio: [false, false, true, true],
      video: [false, false, true, true],
      text: [false, false, true, true]
    });
  });

  it('plays when a small gap is present at the beginning', function() {
    var drift = 0.050;  // 50 ms

    setupVod();
    mediaSourceEngine =
        new shaka.test.FakeMediaSourceEngine(segmentData, drift);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);

    // Here we go!
    onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
    streamingEngine.init();

    runTest();
    expect(onStartupComplete).toHaveBeenCalled();
  });

  it('plays when 1st Period doesn\'t have text streams', function() {
    setupVod();
    manifest.periods[0].textStreams = [];

    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(function(period) {
      var chosen = defaultOnChooseStreams(period);
      if (period == manifest.periods[0])
        chosen.text = null;
      return chosen;
    });

    // Here we go!
    streamingEngine.init();
    runTest();

    expect(mediaSourceEngine.segments).toEqual({
      audio: [true, true, true, true],
      video: [true, true, true, true],
      text: [false, false, true, true]
    });
  });

  it('doesn\'t get stuck when 2nd Period isn\'t available yet', function() {
    // See: https://github.com/google/shaka-player/pull/839
    setupVod();
    manifest.periods[0].textStreams = [];

    // For the first update, indicate the segment isn't available.  This should
    // not cause us to fallback to the Playhead time to determine which segment
    // to start streaming.
    var oldGet = textStream2.getSegmentReference;
    textStream2.getSegmentReference = function(idx) {
      if (idx == 1) {
        textStream2.getSegmentReference = oldGet;
        return null;
      }
      return oldGet(idx);
    };

    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(function(period) {
      var chosen = defaultOnChooseStreams(period);
      if (period == manifest.periods[0])
        chosen.text = null;
      return chosen;
    });

    // Here we go!
    streamingEngine.init();
    runTest();

    expect(mediaSourceEngine.segments).toEqual({
      audio: [true, true, true, true],
      video: [true, true, true, true],
      text: [false, false, true, true]
    });
  });

  it('only reinitializes text when switching streams', function() {
    // See: https://github.com/google/shaka-player/issues/910
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(defaultOnChooseStreams);

    // When we can switch in the second Period, switch to the playing stream.
    onCanSwitch.and.callFake(function() {
      onCanSwitch.and.callFake(function() {
        expect(streamingEngine.getActiveText()).toBe(textStream2);

        mediaSourceEngine.reinitText.calls.reset();
        streamingEngine.switchTextStream(textStream2);
      });
    });

    // Here we go!
    streamingEngine.init();
    runTest();

    expect(mediaSourceEngine.reinitText).not.toHaveBeenCalled();
  });

  it('plays when 2nd Period doesn\'t have text streams', function() {
    setupVod();
    manifest.periods[1].textStreams = [];

    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(function(period) {
      var chosen = defaultOnChooseStreams(period);
      if (period == manifest.periods[1])
        chosen.text = null;
      return chosen;
    });

    // Here we go!
    streamingEngine.init();
    runTest();

    expect(mediaSourceEngine.segments).toEqual({
      audio: [true, true, true, true],
      video: [true, true, true, true],
      text: [true, true, false, false]
    });
  });

  it('updates the timeline duration to match media duration', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(defaultOnChooseStreams);

    mediaSourceEngine.endOfStream.and.callFake(function() {
      expect(mediaSourceEngine.setDuration).toHaveBeenCalledWith(40);
      expect(mediaSourceEngine.setDuration).toHaveBeenCalledTimes(1);
      mediaSourceEngine.setDuration.calls.reset();
      // Simulate the media ending BEFORE the expected (manifest) duration.
      mediaSourceEngine.getDuration.and.returnValue(35);
      return Promise.resolve();
    });

    // Here we go!
    streamingEngine.init();

    runTest();
    expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();
    expect(timeline.setDuration).toHaveBeenCalledWith(35);
  });

  // https://github.com/google/shaka-player/issues/979
  it('does not expand the timeline duration', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(defaultOnChooseStreams);

    mediaSourceEngine.endOfStream.and.callFake(function() {
      expect(mediaSourceEngine.setDuration).toHaveBeenCalledWith(40);
      expect(mediaSourceEngine.setDuration).toHaveBeenCalledTimes(1);
      mediaSourceEngine.setDuration.calls.reset();
      // Simulate the media ending AFTER the expected (manifest) duration.
      mediaSourceEngine.getDuration.and.returnValue(41);
      return Promise.resolve();
    });

    // Here we go!
    streamingEngine.init();

    runTest();
    expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();
    expect(timeline.setDuration).not.toHaveBeenCalled();
  });

  it('applies fudge factor for appendWindowStart', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
    createStreamingEngine();

    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(defaultOnChooseStreams);

    // Here we go!
    streamingEngine.init();
    runTest();

    // The second Period starts at 20, so we should set the appendWindowStart to
    // 20, but reduced by a small fudge factor.
    var lt20 = {
      asymmetricMatch: function(val) {
        return val >= 19.9 && val < 20;
      }
    };
    expect(mediaSourceEngine.setStreamProperties)
        .toHaveBeenCalledWith('video', 20, lt20, 40);
  });

  it('does not buffer one media type ahead of another', function() {
    setupVod();
    mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);

    // Configure StreamingEngine with a high buffering goal.  The rest are
    // defaults.
    const config = {
      bufferingGoal: 60,

      rebufferingGoal: 2,
      retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
      failureCallback: function() { streamingEngine.retry(); },  // retry
      bufferBehind: Infinity,
      ignoreTextStreamFailures: false,
      alwaysStreamText: false,
      startAtSegmentBoundary: false,
      smallGapLimit: 0.5,
      jumpLargeGaps: false,
      durationBackoff: 1
    };
    createStreamingEngine(config);

    // Make requests for different types take different amounts of time.
    // This would let some media types buffer faster than others if unchecked.
    netEngine.delays.text = 0.1;
    netEngine.delays.audio = 1.0;
    netEngine.delays.video = 10.0;

    mediaSourceEngine.appendBuffer.and.callFake((type, data, start, end) => {
      // Call to the underlying implementation.
      const p = mediaSourceEngine.appendBufferImpl(type, data, start, end);

      // Validate that no one media type got ahead of any other.
      let minBuffered = Infinity;
      let maxBuffered = 0;
      ['audio', 'video', 'text'].forEach((t) => {
        const buffered = mediaSourceEngine.bufferedAheadOfImpl(t, 0);
        minBuffered = Math.min(minBuffered, buffered);
        maxBuffered = Math.max(maxBuffered, buffered);
      });

      // Sanity check.
      expect(maxBuffered).not.toBeLessThan(minBuffered);
      // Proof that we didn't get too far ahead (10s == 1 segment).
      expect(maxBuffered - minBuffered).not.toBeGreaterThan(10);

      return p;
    });

    // Here we go!
    playhead.getTime.and.returnValue(0);
    onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
    onChooseStreams.and.callFake(defaultOnChooseStreams);
    streamingEngine.init();

    runTest();
    // Make sure appendBuffer was called, so that we know that we executed the
    // checks in our fake above.
    expect(mediaSourceEngine.appendBuffer).toHaveBeenCalled();
  });

  describe('switchVariant/switchTextStream', function() {
    var initialVariant;
    var sameAudioVariant;
    var sameVideoVariant;
    var initialTextStream;

    beforeEach(function() {
      // Set up a manifest with multiple variants and a text stream.
      manifest = new shaka.test.ManifestGenerator()
        .addPeriod(0)
          .addVariant(0)
            .addAudio(10).useSegmentTemplate('audio-10-%d.mp4', 10)
            .addVideo(11).useSegmentTemplate('video-11-%d.mp4', 10)
          .addVariant(1)
            .addAudio(10)  // reused
            .addVideo(12).useSegmentTemplate('video-12-%d.mp4', 10)
          .addVariant(2)
            .addAudio(13).useSegmentTemplate('audio-13-%d.mp4', 10)
            .addVideo(12)  // reused
          .addTextStream(20).useSegmentTemplate('text-20-%d.mp4', 10)
        .build();

      initialVariant = manifest.periods[0].variants[0];
      sameAudioVariant = manifest.periods[0].variants[1];
      sameVideoVariant = manifest.periods[0].variants[2];
      initialTextStream = manifest.periods[0].textStreams[0];

      // For these tests, we don't care about specific data appended.
      // Just return any old ArrayBuffer for any requested segment.
      netEngine = {
        request: function(requestType, request) {
          var buffer = new ArrayBuffer(0);
          var response = { uri: request.uris[0], data: buffer, headers: {} };
          return Promise.resolve(response);
        }
      };

      // For these tests, we also don't need FakeMediaSourceEngine to verify
      // its input data.
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine({});
      mediaSourceEngine.clear.and.returnValue(Promise.resolve());
      mediaSourceEngine.bufferedAheadOf.and.returnValue(0);
      mediaSourceEngine.bufferStart.and.returnValue(0);
      mediaSourceEngine.setStreamProperties.and.returnValue(Promise.resolve());
      mediaSourceEngine.remove.and.returnValue(Promise.resolve());

      var bufferEnd = { audio: 0, video: 0, text: 0 };
      mediaSourceEngine.appendBuffer.and.callFake(
          function(type, data, start, end) {
            bufferEnd[type] = end;
            return Promise.resolve();
          });
      mediaSourceEngine.bufferEnd.and.callFake(function(type) {
        return bufferEnd[type];
      });
      mediaSourceEngine.bufferedAheadOf.and.callFake(function(type, start) {
        return Math.max(0, bufferEnd[type] - start);
      });
      mediaSourceEngine.isBuffered.and.callFake(function(type, time) {
        return time >= 0 && time < bufferEnd[type];
      });

      playhead = new shaka.test.FakePlayhead();
      playheadTime = 0;
      playing = false;
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
      onChooseStreams.and.callFake(function() {
        return { variant: initialVariant, text: initialTextStream };
      });
    });

    it('will not clear buffers if streams have not changed', function() {
      onCanSwitch.and.callFake(function() {
        mediaSourceEngine.clear.calls.reset();
        streamingEngine.switchVariant(sameAudioVariant, /* clearBuffer */ true);
        Util.fakeEventLoop(1);
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('audio');
        expect(mediaSourceEngine.clear).toHaveBeenCalledWith('video');
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('text');

        mediaSourceEngine.clear.calls.reset();
        streamingEngine.switchVariant(sameVideoVariant, /* clearBuffer */ true);
        Util.fakeEventLoop(1);
        expect(mediaSourceEngine.clear).toHaveBeenCalledWith('audio');
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('video');
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('text');

        mediaSourceEngine.clear.calls.reset();
        streamingEngine.switchTextStream(initialTextStream);
        Util.fakeEventLoop(1);
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('audio');
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('video');
        expect(mediaSourceEngine.clear).not.toHaveBeenCalledWith('text');
      });

      streamingEngine.init().catch(fail);

      Util.fakeEventLoop(1);

      expect(onCanSwitch).toHaveBeenCalled();
    });
  });

  describe('handles seeks (VOD)', function() {
    /** @type {!jasmine.Spy} */
    var onTick;

    beforeEach(function() {
      setupVod();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      onTick = jasmine.createSpy('onTick');
      onTick.and.stub();
    });

    it('into buffered regions', function() {
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          // Seek backwards to a buffered region in the first Period. Note that
          // since the buffering goal is 5 seconds and each segment is 10
          // seconds long, the second segment of this Period will be required at
          // 6 seconds.  Then it will load the next Period, but not require the
          // new segments.
          expect(playheadTime).toBe(6);
          playheadTime -= 5;
          streamingEngine.seeked();

          onChooseStreams.and.callFake(function(period) {
            expect(period).toBe(manifest.periods[1]);
            expect(playheadTime).toBe(16);

            // Verify buffers.
            expect(mediaSourceEngine.initSegments).toEqual({
              audio: [true, false],
              video: [true, false],
              text: []
            });
            expect(mediaSourceEngine.segments).toEqual({
              audio: [true, true, false, false],
              video: [true, true, false, false],
              text: [true, true, false, false]
            });

            onChooseStreams.and.throwError(new Error());

            // Switch to the second Period.
            return defaultOnChooseStreams(period);
          });

          // Although we're seeking backwards we still have to return some
          // Streams from the second Period here.
          return defaultOnChooseStreams(period);
        });

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      // Here we go!
      streamingEngine.init();

      runTest();
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    it('into buffered regions across Periods', function() {
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          onChooseStreams.and.throwError(new Error());

          // Switch to the second Period.
          return defaultOnChooseStreams(period);
        });

        mediaSourceEngine.endOfStream.and.callFake(function() {
          // Seek backwards to a buffered region in the first Period. Note
          // that since the buffering goal is 5 seconds and each segment is
          // 10 seconds long, the last segment should be required at 26 seconds.
          // Then endOfStream() should be called.
          expect(playheadTime).toBe(26);
          playheadTime -= 20;
          streamingEngine.seeked();
          return Promise.resolve();
        });

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      // Here we go!
      streamingEngine.init();

      runTest();
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    it('into unbuffered regions', function() {
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.throwError(new Error());

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);

        // Seek forward to an unbuffered region in the first Period.
        expect(playheadTime).toBe(0);
        playheadTime += 15;
        streamingEngine.seeked();

        onTick.and.callFake(function() {
          // Verify that all buffers have been cleared.
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.AUDIO);
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.VIDEO);
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.TEXT);
          onTick.and.stub();
        });

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          // Verify buffers.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [true, false],
            video: [true, false],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, false, false],
            video: [true, true, false, false],
            text: [true, true, false, false]
          });

          onChooseStreams.and.throwError(new Error());

          // Switch to the second Period.
          return defaultOnChooseStreams(period);
        });
      });

      // Here we go!
      streamingEngine.init();

      runTest(Util.spyFunc(onTick));
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    it('into unbuffered regions across Periods', function() {
      // Start from the second Period.
      playhead.getTime.and.returnValue(20);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 20));

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[1]);

        onChooseStreams.and.throwError(new Error());

        // Init the second Period.
        return defaultOnChooseStreams(period);
      });

      mediaSourceEngine.endOfStream.and.callFake(function() {
        // Verify buffers.
        expect(mediaSourceEngine.initSegments).toEqual({
          audio: [false, true],
          video: [false, true],
          text: []
        });
        expect(mediaSourceEngine.segments).toEqual({
          audio: [false, false, true, true],
          video: [false, false, true, true],
          text: [false, false, true, true]
        });

        // Seek backwards to an unbuffered region in the first Period. Note
        // that since the buffering goal is 5 seconds and each segment is 10
        // seconds long, the last segment should be required at 26 seconds.
        // Then endOfStream() should be called.
        expect(playheadTime).toBe(26);
        playheadTime -= 20;
        streamingEngine.seeked();

        onTick.and.callFake(function() {
          // Verify that all buffers have been cleared.
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.AUDIO);
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.VIDEO);
          expect(mediaSourceEngine.clear)
                .toHaveBeenCalledWith(ContentType.TEXT);
          onTick.and.stub();
        });

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[0]);

          onChooseStreams.and.callFake(function(period) {
            expect(period).toBe(manifest.periods[1]);

            // Verify buffers.
            expect(mediaSourceEngine.initSegments).toEqual({
              audio: [true, false],
              video: [true, false],
              text: []
            });
            expect(mediaSourceEngine.segments).toEqual({
              audio: [true, true, false, false],
              video: [true, true, false, false],
              text: [true, true, false, false]
            });

            onChooseStreams.and.throwError(new Error());

            // Switch to the second Period.
            return defaultOnChooseStreams(period);
          });

          mediaSourceEngine.endOfStream.and.returnValue(Promise.resolve());

          // Switch to the first Period.
          return defaultOnChooseStreams(period);
        });
        return Promise.resolve();
      });

      // Here we go!
      streamingEngine.init();

      runTest(Util.spyFunc(onTick));
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    it('into unbuffered regions when nothing is buffered', function() {
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.throwError(new Error());

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      onInitialStreamsSetup.and.callFake(function() {
        // Seek forward to an unbuffered region in the first Period.
        expect(playheadTime).toBe(0);
        playhead.getTime.and.returnValue(15);
        streamingEngine.seeked();

        onTick.and.callFake(function() {
          // Nothing should have been cleared.
          expect(mediaSourceEngine.clear).not.toHaveBeenCalled();
          onTick.and.stub();
        });

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          // Verify buffers.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [true, false],
            video: [true, false],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, false, false],
            video: [true, true, false, false],
            text: [true, true, false, false]
          });

          onChooseStreams.and.throwError(new Error());

          // Switch to the second Period.
          return defaultOnChooseStreams(period);
        });
      });

      // This happens after onInitialStreamsSetup(), so pass 15 so the playhead
      // resumes from 15.
      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 15));

      // Here we go!
      streamingEngine.init();

      runTest(Util.spyFunc(onTick));
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    // If we seek back into an unbuffered region but do not called seeked(),
    // StreamingEngine should wait for seeked() to be called.
    it('back into unbuffered regions without seeked() ', function() {
      // Start from the second segment in the second Period.
      playhead.getTime.and.returnValue(30);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 20));

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[1]);

        // Init the second Period.
        return defaultOnChooseStreams(period);
      });

      mediaSourceEngine.endOfStream.and.callFake(function() {
        // Seek backwards to an unbuffered region in the second Period. Do not
        // call seeked().
        expect(playheadTime).toBe(26);
        playheadTime -= 10;
        return Promise.resolve();
      });

      // Here we go!
      streamingEngine.init();

      runTest();
      // Verify buffers. Segment 3 should not be buffered since we never
      // called seeked().
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [false, false, true, true],
        video: [false, false, true, true],
        text: [false, false, true, true]
      });
    });

    // If we seek forward into an unbuffered region but do not called seeked(),
    // StreamingEngine should continue buffering. This test also exercises the
    // case where the playhead moves past the end of the buffer, which may
    // occur on some browsers depending on the playback rate.
    it('forward into unbuffered regions without seeked()', function() {
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);

        // Seek forward to an unbuffered region in the first Period. Do not
        // call seeked().
        playheadTime += 15;

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          // Switch to the second Period.
          return defaultOnChooseStreams(period);
        });
      });

      // Here we go!
      streamingEngine.init();

      runTest();
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });

    it('into partially buffered regions', function() {
      // Seeking into a region where some buffers (text) are buffered and some
      // are not should work despite the media states requiring different
      // periods.
      playhead.getTime.and.returnValue(0);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          // Should get another call for the unbuffered Period transition.
          onChooseStreams.and.callFake(defaultOnChooseStreams);

          mediaSourceEngine.endOfStream.and.callFake(function() {
            // Should have the first Period entirely buffered.
            expect(mediaSourceEngine.initSegments).toEqual({
              audio: [false, true],
              video: [false, true],
              text: []
            });
            expect(mediaSourceEngine.segments).toEqual({
              audio: [true, true, true, true],
              video: [true, true, true, true],
              text: [true, true, true, true]
            });

            // Fake the audio/video buffers being removed.
            mediaSourceEngine.segments[ContentType.AUDIO] =
                [false, false, true, true];
            mediaSourceEngine.segments[ContentType.VIDEO] =
                [false, false, true, true];

            // Seek back into the first Period.
            expect(playheadTime).toBe(26);
            playheadTime -= 20;
            streamingEngine.seeked();

            mediaSourceEngine.endOfStream.and.returnValue(Promise.resolve());
            return Promise.resolve();
          });

          return defaultOnChooseStreams(period);
        });

        return defaultOnChooseStreams(period);
      });

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      // Here we go!
      streamingEngine.init();
      runTest();

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    });
  });

  describe('handles seeks (live)', function() {
    beforeEach(function() {
      setupLive();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData, 0);
      createStreamingEngine();

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 100));
    });

    it('outside segment availability window', function() {
      timeline.segmentAvailabilityStart = 90;
      timeline.segmentAvailabilityEnd = 110;

      playhead.getTime.and.returnValue(90);

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        onChooseStreams.and.throwError(new Error());

        // Init the first Period.
        return defaultOnChooseStreams(period);
      });

      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(90);

        // Seek forward to an unbuffered and unavailable region in the second
        // Period; set playing to false since the playhead can't move at the
        // seek target.
        expect(timeline.getSegmentAvailabilityStart()).toBe(90);
        expect(timeline.getSegmentAvailabilityEnd()).toBe(110);
        playheadTime += 35;
        playing = false;
        streamingEngine.seeked();

        onChooseStreams.and.callFake(function(period) {
          expect(period).toBe(manifest.periods[1]);

          onChooseStreams.and.throwError(new Error());

          // Switch to the second Period.
          return defaultOnChooseStreams(period);
        });

        // Eventually StreamingEngine should request the first segment (since
        // it needs the second segment) of the second Period when it becomes
        // available.
        var originalAppendBuffer =
            shaka.test.FakeMediaSourceEngine.prototype.appendBufferImpl;
        mediaSourceEngine.appendBuffer.and.callFake(
            function(type, data, startTime, endTime) {
              expect(playheadTime).toBe(125);
              expect(timeline.getSegmentAvailabilityStart()).toBe(100);
              expect(timeline.getSegmentAvailabilityEnd()).toBe(120);
              playing = true;
              var p = originalAppendBuffer.call(
                  mediaSourceEngine, type, data, startTime, endTime);
              mediaSourceEngine.appendBuffer.and.callFake(originalAppendBuffer);
              return p;
            });
      });

      // Here we go!
      streamingEngine.init();

      runTest(slideSegmentAvailabilityWindow);
      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });

      // Since we performed an unbuffered seek into the second Period, the
      // first 12 segments should not be buffered.
      for (var i = 0; i <= 11; ++i) {
        expect(mediaSourceEngine.segments[ContentType.AUDIO][i]).toBeFalsy();
        expect(mediaSourceEngine.segments[ContentType.VIDEO][i]).toBeFalsy();
        expect(mediaSourceEngine.segments[ContentType.TEXT][i]).toBeFalsy();
      }

      for (var i = 12; i <= 13; ++i) {
        expect(mediaSourceEngine.segments[ContentType.AUDIO][i]).toBeTruthy();
        expect(mediaSourceEngine.segments[ContentType.VIDEO][i]).toBeTruthy();
        expect(mediaSourceEngine.segments[ContentType.TEXT][i]).toBeTruthy();
      }
    });
  });

  describe('handles errors', function() {
    beforeEach(function() {
      setupVod();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();
    });

    it('from initial Stream setup', function() {
      playhead.getTime.and.returnValue(0);

      videoStream1.createSegmentIndex.and.returnValue(
          Promise.reject('FAKE_ERROR'));

      var onInitError = jasmine.createSpy('onInitError');
      onInitError.and.callFake(function(error) {
        expect(onInitialStreamsSetup).not.toHaveBeenCalled();
        expect(onStartupComplete).not.toHaveBeenCalled();
        expect(error).toBe('FAKE_ERROR');
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init().then(fail).catch(Util.spyFunc(onInitError));

      runTest();
      expect(onInitError).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('from post startup Stream setup', function() {
      playhead.getTime.and.returnValue(0);

      alternateVideoStream1.createSegmentIndex.and.returnValue(
          Promise.reject('FAKE_ERROR'));

      onError.and.callFake(function(error) {
        expect(onInitialStreamsSetup).toHaveBeenCalled();
        expect(onStartupComplete).toHaveBeenCalled();
        expect(error).toBe('FAKE_ERROR');
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init().catch(fail);
      runTest();
      expect(onError).toHaveBeenCalled();
    });

    it('from failed init segment append during startup', function() {
      playhead.getTime.and.returnValue(0);

      var expectedError = new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.MEDIA,
          shaka.util.Error.Code.MEDIA_SOURCE_OPERATION_FAILED);

      onError.and.callFake(function(error) {
        expect(onInitialStreamsSetup).toHaveBeenCalled();
        expect(onStartupComplete).not.toHaveBeenCalled();
        Util.expectToEqualError(error, expectedError);
      });

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        var streamsByType = defaultOnChooseStreams(period);

        var originalAppendBuffer =
            shaka.test.FakeMediaSourceEngine.prototype.appendBufferImpl;
        mediaSourceEngine.appendBuffer.and.callFake(
            function(type, data, startTime, endTime) {
              // Reject the first video init segment.
              if (data == segmentData[ContentType.VIDEO].initSegments[0]) {
                return Promise.reject(expectedError);
              } else {
                return originalAppendBuffer.call(
                    mediaSourceEngine, type, data, startTime, endTime);
              }
            });

        return streamsByType;
      });

      // Here we go!
      streamingEngine.init().catch(fail);
      runTest();
      expect(onError).toHaveBeenCalled();
    });

    it('from failed media segment append during startup', function() {
      playhead.getTime.and.returnValue(0);

      var expectedError = new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.MEDIA,
          shaka.util.Error.Code.MEDIA_SOURCE_OPERATION_FAILED);

      onError.and.callFake(function(error) {
        expect(onInitialStreamsSetup).toHaveBeenCalled();
        expect(onStartupComplete).not.toHaveBeenCalled();
        Util.expectToEqualError(error, expectedError);
      });

      onChooseStreams.and.callFake(function(period) {
        expect(period).toBe(manifest.periods[0]);

        var streamsByType = defaultOnChooseStreams(period);

        var originalAppendBuffer =
            shaka.test.FakeMediaSourceEngine.prototype.appendBufferImpl;
        mediaSourceEngine.appendBuffer.and.callFake(
            function(type, data, startTime, endTime) {
              // Reject the first audio segment.
              if (data == segmentData[ContentType.AUDIO].segments[0]) {
                return Promise.reject(expectedError);
              } else {
                return originalAppendBuffer.call(
                    mediaSourceEngine, type, data, startTime, endTime);
              }
            });

        return streamsByType;
      });

      // Here we go!
      streamingEngine.init().catch(fail);
      runTest();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('handles network errors', function() {
    it('ignores text stream failures if configured to', function() {
      setupVod();
      var textUri = '1_text_1';
      var originalNetEngine = netEngine;
      netEngine = {
        request: jasmine.createSpy('request')
      };
      netEngine.request.and.callFake(function(requestType, request) {
        if (request.uris[0] == textUri) {
          return Promise.reject(new shaka.util.Error(
              shaka.util.Error.Severity.CRITICAL,
              shaka.util.Error.Category.NETWORK,
              shaka.util.Error.Code.BAD_HTTP_STATUS, textUri, 404));
        }
        return originalNetEngine.request(requestType, request);
      });
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      var config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: Infinity,
        ignoreTextStreamFailures: true,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(onError.calls.count()).toBe(0);
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();
    });

    it('retries if configured to', function() {
      setupLive();

      // Wrap the NetworkingEngine to cause errors.
      var targetUri = '1_audio_init';
      failFirstRequestForTarget(netEngine, targetUri,
                                shaka.util.Error.Code.BAD_HTTP_STATUS);

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);

      var config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() { streamingEngine.retry(); },  // retry
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(100);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(100);
      });

      onError.and.callFake(function(error) {
        expect(error.severity).toBe(shaka.util.Error.Severity.CRITICAL);
        expect(error.category).toBe(shaka.util.Error.Category.NETWORK);
        expect(error.code).toBe(shaka.util.Error.Code.BAD_HTTP_STATUS);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(onError.calls.count()).toBe(1);
      expect(netEngine.attempts).toBeGreaterThan(1);
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalledTimes(1);
    });

    it('does not retry if configured not to', function() {
      setupLive();

      // Wrap the NetworkingEngine to cause errors.
      var targetUri = '1_audio_init';
      failFirstRequestForTarget(netEngine, targetUri,
                                shaka.util.Error.Code.BAD_HTTP_STATUS);

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);

      var config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},  // no retry
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(100);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(100);
      });

      onError.and.callFake(function(error) {
        expect(error.severity).toBe(shaka.util.Error.Severity.CRITICAL);
        expect(error.category).toBe(shaka.util.Error.Category.NETWORK);
        expect(error.code).toBe(shaka.util.Error.Code.BAD_HTTP_STATUS);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(onError.calls.count()).toBe(1);
      expect(netEngine.attempts).toBe(1);
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalledTimes(0);
    });

    it('does not invoke the callback if the error is handled', function() {
      setupLive();

      // Wrap the NetworkingEngine to cause errors.
      var targetUri = '1_audio_init';
      failFirstRequestForTarget(netEngine, targetUri,
                                shaka.util.Error.Code.BAD_HTTP_STATUS);

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);

      // Configure with a failure callback
      var failureCallback = jasmine.createSpy('failureCallback');
      var config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: shaka.test.Util.spyFunc(failureCallback),
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(100);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(100);
      });

      onError.and.callFake(function(error) {
        error.handled = true;
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(onError.calls.count()).toBe(1);
      expect(failureCallback).not.toHaveBeenCalled();
    });

    it('waits to invoke the failure callback', function() {
      setupLive();

      // Wrap the NetworkingEngine to cause errors.
      var targetUri = '1_audio_init';
      failFirstRequestForTarget(netEngine, targetUri,
                                shaka.util.Error.Code.BAD_HTTP_STATUS);

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);

      // Configure with a failure callback that records the callback time.
      var callbackTime = null;
      var failureCallback = jasmine.createSpy('failureCallback');
      failureCallback.and.callFake(function() { callbackTime = Date.now(); });

      var config = {
        rebufferingGoal: 2,
        bufferingGoal: 5,
        retryParameters: {
          maxAttempts: 2,
          baseDelay: 10000,
          backoffFactor: 1,
          fuzzFactor: 0,
          timeout: 0
        },
        failureCallback: shaka.test.Util.spyFunc(failureCallback),
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(100);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(100);
      });
      onError.and.stub();

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      var startTime = Date.now();
      runTest();
      expect(failureCallback).toHaveBeenCalled();
      expect(callbackTime - startTime).toEqual(10000);  // baseDelay == 10000
    });
  });

  describe('retry()', function() {
    it('resumes streaming after failure', function() {
      setupVod();

      // Wrap the NetworkingEngine to cause errors.
      var targetUri = '1_audio_init';
      var originalNetEngineRequest = netEngine.request;
      failFirstRequestForTarget(netEngine, targetUri,
                                shaka.util.Error.Code.BAD_HTTP_STATUS);

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);
      });

      onError.and.callFake(function(error) {
        // Restore the original fake request function.
        netEngine.request = originalNetEngineRequest;
        netEngine.request.calls.reset();

        // Retry streaming.
        expect(streamingEngine.retry()).toBe(true);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      // We definitely called onError().
      expect(onError.calls.count()).toBe(1);
      // We reset the request calls in onError() just before retry(), so this
      // count reflects new calls since retry().
      expect(netEngine.request.calls.count()).toBeGreaterThan(0);
      // The retry worked, so we should have reached the end of the stream.
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalledTimes(1);
    });

    it('does not resume streaming after quota error', function() {
      setupVod();

      var appendBufferSpy = jasmine.createSpy('appendBuffer');
      // Throw QuotaExceededError on every segment to quickly trigger the quota
      // error.
      appendBufferSpy.and.callFake(function(type, data, startTime, endTime) {
        throw new shaka.util.Error(
            shaka.util.Error.Severity.CRITICAL,
            shaka.util.Error.Category.MEDIA,
            shaka.util.Error.Code.QUOTA_EXCEEDED_ERROR,
            type);
      });

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      mediaSourceEngine.appendBuffer = appendBufferSpy;
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);
      });

      onError.and.callFake(function(error) {
        expect(error.code).toBe(shaka.util.Error.Code.QUOTA_EXCEEDED_ERROR);

        // Retry streaming, which should fail and return false.
        netEngine.request.calls.reset();
        expect(streamingEngine.retry()).toBe(false);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();

      // We definitely called onError().
      expect(onError.calls.count()).toBe(1);

      // We reset the request calls in onError() just before retry(), so this
      // count reflects new calls since retry().
      expect(netEngine.request.calls.count()).toBe(0);
      expect(mediaSourceEngine.endOfStream).not.toHaveBeenCalled();
    });

    it('does not resume streaming after destruction', function() {
      setupVod();

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(function() {
        setupFakeGetTime(0);
      });

      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      // Here we go!
      var count = 0;
      runTest(function() {
        if (++count == 3) {
          streamingEngine.destroy();

          // Retry streaming, which should fail and return false.
          netEngine.request.calls.reset();
          expect(streamingEngine.retry()).toBe(false);
        }
      });

      // We reset the request calls in onError() just before retry(), so this
      // count reflects new calls since retry().
      expect(netEngine.request.calls.count()).toBe(0);
      expect(mediaSourceEngine.endOfStream).not.toHaveBeenCalled();
    });
  });

  describe('eviction', function() {
    var config;

    beforeEach(function() {
      setupVod();

      manifest.minBufferTime = 1;

      config = {
        rebufferingGoal: 1,
        bufferingGoal: 1,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: 10,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };

      playhead.getTime.and.returnValue(0);
    });

    it('evicts media to meet the max buffer tail limit', function() {
      // Create StreamingEngine.
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine(config);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      var originalRemove =
          shaka.test.FakeMediaSourceEngine.prototype.removeImpl
              .bind(mediaSourceEngine);

      mediaSourceEngine.remove.and.callFake(function(type, start, end) {
        expect(playheadTime).toBe(20);
        expect(start).toBe(0);
        expect(end).toBe(10);

        if (mediaSourceEngine.remove.calls.count() == 3) {
          mediaSourceEngine.remove.and.callFake(function(type, start, end) {
            expect(playheadTime).toBe(30);
            expect(start).toBe(10);
            expect(end).toBe(20);
            return originalRemove(type, start, end);
          });
        }

        return originalRemove(type, start, end);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      // Since StreamingEngine is free to peform audio, video, and text updates
      // in any order, there are many valid ways in which StreamingEngine can
      // evict segments. So, instead of verifying the exact, final buffer
      // configuration, ensure the byte limit is never exceeded and at least
      // one segment of each type is buffered at the end of the test.
      runTest();
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.AUDIO, 0, 10);
      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.AUDIO, 10, 20);

      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.VIDEO, 0, 10);
      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.VIDEO, 10, 20);

      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.TEXT, 0, 10);
      expect(mediaSourceEngine.remove)
          .toHaveBeenCalledWith(ContentType.TEXT, 10, 20);

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [false, false, true, true],
        video: [false, false, true, true],
        text: [false, false, true, true]
      });
    });

    it('doesn\'t evict too much when bufferBehind is very low', function() {
      // Set the bufferBehind to a value significantly below the segment size.
      config.bufferBehind = 0.1;

      // Create StreamingEngine.
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine(config);
      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest(() => {
        if (playheadTime == 8) {
          // Run the test until a bit before the end of the first segment.
          playing = false;
        } else if (playheadTime == 6) {
          // Soon before stopping the test, set the buffering goal up way
          // higher to trigger more segment fetching, to (potentially) trigger
          // an eviction.
          config.bufferingGoal = 5;
          streamingEngine.configure(config);
        }
      });

      // It should not have removed any segments.
      expect(mediaSourceEngine.remove).not.toHaveBeenCalled();
    });
  });

  describe('QuotaExceededError', function() {
    it('does not fail immediately', function() {
      setupVod();

      manifest.minBufferTime = 1;

      // Create StreamingEngine.
      var config = {
        rebufferingGoal: 1,
        bufferingGoal: 1,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: 10,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(0);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      var originalAppendBuffer =
          shaka.test.FakeMediaSourceEngine.prototype.appendBufferImpl;
      var appendBufferSpy = jasmine.createSpy('appendBuffer');
      mediaSourceEngine.appendBuffer = appendBufferSpy;

      // Throw two QuotaExceededErrors at different times.
      var numErrorsThrown = 0;
      appendBufferSpy.and.callFake(
          function(type, data, startTime, endTime) {
            var throwError = (numErrorsThrown == 0 && startTime == 10) ||
                             (numErrorsThrown == 1 && startTime == 20);
            if (throwError) {
              numErrorsThrown++;
              throw new shaka.util.Error(
                  shaka.util.Error.Severity.CRITICAL,
                  shaka.util.Error.Category.MEDIA,
                  shaka.util.Error.Code.QUOTA_EXCEEDED_ERROR,
                  type);
            } else {
              var p = originalAppendBuffer.call(
                  mediaSourceEngine, type, data, startTime, endTime);
              return p;
            }
          });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [false, false, true, true],
        video: [false, false, true, true],
        text: [false, false, true, true]
      });
    });

    it('fails after multiple QuotaExceededError', function() {
      setupVod();

      manifest.minBufferTime = 1;

      // Create StreamingEngine.
      var config = {
        rebufferingGoal: 1,
        bufferingGoal: 1,
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: 10,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      };

      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine(config);

      playhead.getTime.and.returnValue(0);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      var originalAppendBuffer =
          shaka.test.FakeMediaSourceEngine.prototype.appendBufferImpl;
      var appendBufferSpy = jasmine.createSpy('appendBuffer');
      mediaSourceEngine.appendBuffer = appendBufferSpy;

      // Throw QuotaExceededError multiple times after at least one segment of
      // each type has been appended.
      appendBufferSpy.and.callFake(
          function(type, data, startTime, endTime) {
            if (startTime >= 10) {
              throw new shaka.util.Error(
                  shaka.util.Error.Severity.CRITICAL,
                  shaka.util.Error.Category.MEDIA,
                  shaka.util.Error.Code.QUOTA_EXCEEDED_ERROR,
                  type);
            } else {
              var p = originalAppendBuffer.call(
                  mediaSourceEngine, type, data, startTime, endTime);
              return p;
            }
          });

      onError.and.callFake(function(error) {
        expect(error.code).toBe(shaka.util.Error.Code.QUOTA_EXCEEDED_ERROR);
        expect(error.data[0] == ContentType.AUDIO ||
               error.data[0] == ContentType.VIDEO ||
               error.data[0] == ContentType.TEXT).toBe(true);
      });

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      // Stop the playhead after 10 seconds since will not append any
      // segments after this time.
      var stopPlayhead = function() { playing = playheadTime < 10; };

      runTest(stopPlayhead);
      expect(onError).toHaveBeenCalled();
      expect(mediaSourceEngine.endOfStream).not.toHaveBeenCalled();
    });
  });

  describe('VOD drift', function() {
    beforeEach(function() {
      setupVod();
    });

    /**
     * @param {number} drift
     */
    function testPositiveDrift(drift) {
      mediaSourceEngine =
          new shaka.test.FakeMediaSourceEngine(segmentData, drift);
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, drift));

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    }

    /**
     * @param {number} drift
     */
    function testNegativeDrift(drift) {
      mediaSourceEngine =
          new shaka.test.FakeMediaSourceEngine(segmentData, drift);
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest();
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });
      expect(mediaSourceEngine.segments).toEqual({
        audio: [true, true, true, true],
        video: [true, true, true, true],
        text: [true, true, true, true]
      });
    }

    it('is handled for small + values', testPositiveDrift.bind(null, 3));
    it('is handled for large + values', testPositiveDrift.bind(null, 12));
    it('is handled for small - values', testNegativeDrift.bind(null, -3));
  });

  describe('live drift', function() {
    beforeEach(function() {
      setupLive();
    });

    /**
     * @param {number} drift
     */
    function testNegativeDrift(drift) {
      mediaSourceEngine =
          new shaka.test.FakeMediaSourceEngine(segmentData, drift);
      createStreamingEngine();

      playhead.getTime.and.returnValue(100);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 100));

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest(slideSegmentAvailabilityWindow);
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();

      // Verify buffers.
      expect(mediaSourceEngine.initSegments).toEqual({
        audio: [false, true],
        video: [false, true],
        text: []
      });

      for (var i = 0; i <= 8; ++i) {
        expect(mediaSourceEngine.segments['audio'][i]).toBeFalsy();
        expect(mediaSourceEngine.segments['video'][i]).toBeFalsy();
        expect(mediaSourceEngine.segments['text'][i]).toBeFalsy();
      }

      for (var i = 9; i <= 13; ++i) {
        expect(mediaSourceEngine.segments['audio'][i]).toBeTruthy();
        expect(mediaSourceEngine.segments['video'][i]).toBeTruthy();
        expect(mediaSourceEngine.segments['text'][i]).toBeTruthy();
      }
    }

    it('is handled for large - values', testNegativeDrift.bind(null, -12));
  });

  describe('setTrickPlay', function() {
    it('uses trick mode track when requested', function() {
      setupVod(/* trickMode */ true);
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine({
        retryParameters: shaka.net.NetworkingEngine.defaultRetryParameters(),
        failureCallback: function() {},
        bufferBehind: Infinity,
        ignoreTextStreamFailures: false,
        alwaysStreamText: false,
        startAtSegmentBoundary: false,
        // Only buffer ahead 1 second to make it easier to set segment
        // expectations based on playheadTime.
        rebufferingGoal: 1,
        bufferingGoal: 1,
        smallGapLimit: 0.5,
        jumpLargeGaps: false,
        durationBackoff: 1
      });

      playhead.getTime.and.returnValue(0);

      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));

      // Here we go!
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
      streamingEngine.init();

      runTest(function() {
        if (playheadTime == 1) {
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [true, false],
            video: [true, false],
            trickvideo: [false, false],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, false, false, false],
            video: [true, false, false, false],
            trickvideo: [false, false, false, false],
            text: [true, false, false, false]
          });

          // Engage trick play.
          streamingEngine.setTrickPlay(true);
        } else if (playheadTime == 11) {
          // We're in the second segment, in trick play mode.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [true, false],
            video: [true, false],
            trickvideo: [true, false],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, false, false],
            video: [true, false, false, false],
            trickvideo: [false, true, false, false],
            text: [true, true, false, false]
          });
        } else if (playheadTime == 21) {
          // We've started the second period, still in trick play mode.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [false, true],
            video: [true, false],  // no init segment fetched for normal video
            trickvideo: [false, true],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, true, false],
            video: [true, false, false, false],
            trickvideo: [false, true, true, false],
            text: [true, true, true, false]
          });
        } else if (playheadTime == 31) {
          // We've started the final segment, still in trick play mode.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [false, true],
            video: [true, false],  // no init segment appended for normal video
            trickvideo: [false, true],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, true, true],
            video: [true, false, false, false],
            trickvideo: [false, true, true, true],
            text: [true, true, true, true]
          });

          // Disengage trick play mode, which will clear the video buffer.
          streamingEngine.setTrickPlay(false);
        } else if (playheadTime == 39) {
          // We're 1 second from the end of the stream now.
          expect(mediaSourceEngine.initSegments).toEqual({
            audio: [false, true],
            video: [false, true],  // init segment appended for normal video now
            trickvideo: [false, true],
            text: []
          });
          expect(mediaSourceEngine.segments).toEqual({
            audio: [true, true, true, true],
            video: [false, false, true, true],  // starts buffering one seg back
            trickvideo: [false, false, false, false],  // cleared
            text: [true, true, true, true]
          });
        }
      });
      expect(mediaSourceEngine.endOfStream).toHaveBeenCalled();
    });
  });

  describe('embedded emsg boxes', function() {
    const emsgSegment = Uint8ArrayUtils.fromHex(
        '0000003b656d736700000000666f6f3a6261723a637573746f6d646174617363' +
        '68656d6500310000000001000000080000ffff0000000174657374');
    const emsgObj = {
      startTime: 8,
      endTime: 0xffff + 8,
      schemeIdUri: 'foo:bar:customdatascheme',
      value: '1',
      timescale: 1,
      presentationTimeDelta: 8,
      eventDuration: 0xffff,
      id: 1,
      messageData: new Uint8Array([0x74, 0x65, 0x73, 0x74])
    };

    beforeEach(function() {
      setupVod();
      mediaSourceEngine = new shaka.test.FakeMediaSourceEngine(segmentData);
      createStreamingEngine();

      playhead.getTime.and.returnValue(0);
      onStartupComplete.and.callFake(setupFakeGetTime.bind(null, 0));
      onChooseStreams.and.callFake(defaultOnChooseStreams.bind(null));
    });

    it('raises an event for embedded emsg boxes', function() {
      videoStream1.containsEmsgBoxes = true;
      segmentData[ContentType.VIDEO].segments[0] = emsgSegment.buffer;

      // Here we go!
      streamingEngine.init();
      runTest();

      expect(onEvent).toHaveBeenCalledTimes(1);

      let event = onEvent.calls.argsFor(0)[0];
      expect(event.detail).toEqual(emsgObj);
    });

    it('raises multiple events', function() {
      videoStream1.containsEmsgBoxes = true;

      const dummyBox =
          shaka.util.Uint8ArrayUtils.fromHex('0000000c6672656501020304');
      segmentData[ContentType.VIDEO].segments[0] =
          shaka.util.Uint8ArrayUtils.concat(emsgSegment, dummyBox, emsgSegment)
              .buffer;

      // Here we go!
      streamingEngine.init();
      runTest();

      expect(onEvent).toHaveBeenCalledTimes(2);
    });

    it('won\'t raise an event without stream field set', function() {
      videoStream1.containsEmsgBoxes = false;
      segmentData[ContentType.VIDEO].segments[0] = emsgSegment.buffer;

      // Here we go!
      streamingEngine.init();
      runTest();

      expect(onEvent).not.toHaveBeenCalled();
    });

    it('won\'t raise an event when no emsg boxes present', function() {
      videoStream1.containsEmsgBoxes = true;

      // Here we go!
      streamingEngine.init();
      runTest();

      expect(onEvent).not.toHaveBeenCalled();
    });

    it('triggers manifest updates', function() {
      videoStream1.containsEmsgBoxes = true;
      // This is an 'emsg' box that contains a scheme of
      // urn:mpeg:dash:event:2012 to indicate a manifest update.
      segmentData[ContentType.VIDEO].segments[0] =
          Uint8ArrayUtils.fromHex(
              '0000003a656d73670000000075726e3a' +
              '6d7065673a646173683a6576656e743a' +
              '32303132000000000031000000080000' +
              '00ff0000000c74657374').buffer;

      // Here we go!
      streamingEngine.init();
      runTest();

      expect(onEvent).not.toHaveBeenCalled();
      expect(onManifestUpdate).toHaveBeenCalled();
    });
  });

  /**
   * Verifies calls to NetworkingEngine.request(). Expects every segment
   * in the given Period to have been requested.
   *
   * @param {number} period The Period number (one-based).
   */
  function verifyNetworkingEngineRequestCalls(period) {
    netEngine.expectRangeRequest(
        period + '_audio_init',
        initSegmentRanges[ContentType.AUDIO][0],
        initSegmentRanges[ContentType.AUDIO][1]);

    netEngine.expectRangeRequest(
        period + '_video_init',
        initSegmentRanges[ContentType.VIDEO][0],
        initSegmentRanges[ContentType.VIDEO][1]);

    var segmentType = shaka.net.NetworkingEngine.RequestType.SEGMENT;
    netEngine.expectRequest(period + '_audio_1', segmentType);
    netEngine.expectRequest(period + '_video_1', segmentType);
    netEngine.expectRequest(period + '_text_1', segmentType);

    netEngine.expectRequest(period + '_audio_2', segmentType);
    netEngine.expectRequest(period + '_video_2', segmentType);
    netEngine.expectRequest(period + '_text_2', segmentType);

    netEngine.request.calls.reset();
  }

  /**
   * Choose streams for the given period.
   *
   * @param {shakaExtern.Period} period
   * @return {!Object.<string, !shakaExtern.Stream>}
   */
  function defaultOnChooseStreams(period) {
    if (period == manifest.periods[0]) {
      return { variant: variant1, text: textStream1 };
    } else if (period == manifest.periods[1]) {
      return { variant: variant2, text: textStream2 };
    } else {
      throw new Error();
    }
  }

  /**
   * Choose streams for the given period, used for testing unload text stream.
   * The text stream of the second period is not choosen.
   *
   * @param {shakaExtern.Period} period
   * @return {!Object.<string, !shakaExtern.Stream>}
   */
  function onChooseStreamsWithUnloadedText(period) {
    if (period == manifest.periods[0]) {
      return { variant: variant1, text: textStream1 };
    } else if (period == manifest.periods[1]) {
      expect(streamingEngine.unloadTextStream).toHaveBeenCalled();
      return { variant: variant2 };
    } else {
      throw new Error();
    }
  }

  /**
   * Makes the mock Playhead object behave as a fake Playhead object which
   * begins playback at the given time.
   *
   * @param {number} startTime the playhead's starting time with respect to
   *   the presentation timeline.
   */
  function setupFakeGetTime(startTime) {
    playheadTime = startTime;
    playing = true;

    playhead.getTime.and.callFake(function() {
      return playheadTime;
    });
  }

  /**
   * Slides the segment availability window forward by 1 second.
   */
  function slideSegmentAvailabilityWindow() {
    timeline.segmentAvailabilityStart++;
    timeline.segmentAvailabilityEnd++;
  }

  /**
   * @param {!Object} netEngine A NetworkingEngine look-alike from
   *   shaka.test.StreamingEngineUtil.createFakeNetworkingEngine()
   * @param {string} targetUri
   * @param {shaka.util.Error.Code} errorCode
   */
  function failFirstRequestForTarget(netEngine, targetUri, errorCode) {
    var originalNetEngineRequest = netEngine.request.bind(netEngine);

    netEngine.attempts = 0;
    netEngine.request = jasmine.createSpy('request').and.callFake(
        function(requestType, request) {
          if (request.uris[0] == targetUri) {
            if (++netEngine.attempts == 1) {
              var data = [targetUri];

              if (errorCode == shaka.util.Error.Code.BAD_HTTP_STATUS) {
                data.push(404);
                data.push('');
              }

              return Promise.reject(new shaka.util.Error(
                  shaka.util.Error.Severity.CRITICAL,
                  shaka.util.Error.Category.NETWORK,
                  errorCode, data));
            }
          }
          return originalNetEngineRequest(requestType, request);
        });
  }

});

