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

describe('HlsParser', function() {
  /** @const */
  var Util = shaka.test.Util;
  /** @const */
  var ManifestParser = shaka.test.ManifestParser;
  /** @type {!shaka.test.FakeNetworkingEngine} */
  var fakeNetEngine;
  /** @type {!shaka.hls.HlsParser} */
  var parser;
  /** @type {shakaExtern.ManifestParser.PlayerInterface} */
  var playerInterface;
  /** @type {shakaExtern.ManifestConfiguration} */
  var config;
  /** @const */
  var TextStreamKind = shaka.util.ManifestParserUtils.TextStreamKind;
  /** @const {function(string):ArrayBuffer} */
  var toUTF8 = shaka.util.StringUtils.toUTF8;
  /** @type {ArrayBuffer} */
  var initSegmentData;
  /** @type {ArrayBuffer} */
  var segmentData;
  /** @type {ArrayBuffer} */
  var selfInitializingSegmentData;
  /** @const {string} */
  var vttText = [
    'WEBVTT\n',
    '\n',
    '00:03.837 --> 00:07.297\n',
    'Hello, world!\n'
  ].join('');

  beforeEach(function() {
    // TODO: use StreamGenerator?
    initSegmentData = new Uint8Array([
      0x00, 0x00, 0x00, 0x30, // size (48)
      0x6D, 0x6F, 0x6F, 0x76, // type (moov)
      0x00, 0x00, 0x00, 0x28, // trak size (40)
      0x74, 0x72, 0x61, 0x6B, // type (trak)
      0x00, 0x00, 0x00, 0x20, // mdia size (32)
      0x6D, 0x64, 0x69, 0x61, // type (mdia)

      0x00, 0x00, 0x00, 0x18, // mdhd size (24)
      0x6D, 0x64, 0x68, 0x64, // type (mdhd)
      0x00, 0x00, 0x00, 0x00, // version and flags

      0x00, 0x00, 0x00, 0x00, // creation time (0)
      0x00, 0x00, 0x00, 0x00, // modification time (0)
      0x00, 0x00, 0x03, 0xe8, // timescale (1000)
    ]).buffer;

    segmentData = new Uint8Array([
      0x00, 0x00, 0x00, 0x24, // size (36)
      0x6D, 0x6F, 0x6F, 0x66, // type (moof)
      0x00, 0x00, 0x00, 0x1C, // traf size (28)
      0x74, 0x72, 0x61, 0x66, // type (traf)

      0x00, 0x00, 0x00, 0x14, // tfdt size (20)
      0x74, 0x66, 0x64, 0x74, // type (tfdt)
      0x01, 0x00, 0x00, 0x00, // version and flags

      0x00, 0x00, 0x00, 0x00, // baseMediaDecodeTime first 4 bytes (0)
      0x00, 0x00, 0x00, 0x00  // baseMediaDecodeTime last 4 bytes (0)
    ]).buffer;
    // segment starts at 0s.

    selfInitializingSegmentData = shaka.util.Uint8ArrayUtils.concat(
      new Uint8Array(initSegmentData),
      new Uint8Array(segmentData)).buffer;

    fakeNetEngine = new shaka.test.FakeNetworkingEngine();

    var retry = shaka.net.NetworkingEngine.defaultRetryParameters();
    config = {
      retryParameters: retry,
      dash: {
        customScheme: function(node) { return null; },
        clockSyncUri: '',
        ignoreDrmInfo: false,
        xlinkFailGracefully: false,
        defaultPresentationDelay: 10
      }
    };

    playerInterface = {
      filterNewPeriod: function() {},
      filterAllPeriods: function() {},
      networkingEngine: fakeNetEngine,
      onError: fail,
      onEvent: fail,
      onTimelineRegionAdded: fail
    };

    parser = new shaka.hls.HlsParser();
    parser.configure(config);
  });

  /**
   * @param {string} master
   * @param {string} media
   * @param {shakaExtern.Manifest} manifest
   * @param {function()} done
   */
  function testHlsParser(master, media, manifest, done) {
    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/audio2': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/video2': toUTF8(media),
      'test:/main.vtt': toUTF8(vttText),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData,
      'test:/main.test': segmentData,
      'test:/selfInit.mp4': selfInitializingSegmentData,
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail)
        .then(done);
  }

  it('parses video-only variant', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('guesses video-only variant by codecs', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1"\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses audio-only variant', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="mp4a"\n',
      'test:/audio'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addAudio(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses audio+video variant', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1"\n',
      'test:/video\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'CHANNELS="2",URI="test:/audio"\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
                  .channelsCount(2)
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('handles audio tags on audio streams', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="mp4a",AUDIO="aud1"\n',
      'test:/audio\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'URI="test:/audio"\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses multiplexed variant', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1,mp4a')
                  .frameRate(60)
                  .size(960, 540)
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses multiplexed variant without codecs', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', jasmine.any(String))
                  .frameRate(60)
                  .size(960, 540)
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses audio+video variant without codecs', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1"\n',
      'test:/video\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'URI="test:/audio"\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', jasmine.any(String))
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', jasmine.any(String))
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses multiple variants', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1"\n',
      'test:/video\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=300,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=120,AUDIO="aud2"\n',
      'test:/video2\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'URI="test:/audio"\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud2",LANGUAGE="fr",',
      'URI="test:/audio2"\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
              .addVariant(jasmine.any(Number))
                .language('fr')
                .bandwidth(300)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(120)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('fr')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('parses multiple streams with the same group id', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1"\n',
      'test:/video\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="en",',
      'URI="test:/audio"\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="fr",',
      'URI="test:/audio2"\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
              .addVariant(jasmine.any(Number))
                .language('fr')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('fr')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('should call filterAllPeriods for parsing', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    var filterAllPeriods = jasmine.createSpy('filterAllPeriods');
    playerInterface.filterAllPeriods = Util.spyFunc(filterAllPeriods);

    parser.start('test:/master', playerInterface)
        .then(function(manifest) {
          expect(filterAllPeriods.calls.count()).toBe(1);
        }).catch(fail).then(done);
  });

  it('gets mime type from header request', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.test'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('und')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
          .build();

    // The extra parameters should be stripped by the parser.
    var headers = {'content-type': 'video/mp4; foo=bar'};
    fakeNetEngine.setHeadersMap({
      'test:/main.test': headers
    });

    testHlsParser(master, media, manifest, done);
  });

  it('parses manifest with text streams', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'URI="test:/audio"\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub2",LANGUAGE="es",',
      'URI="test:/text2"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1",SUBTITLES="sub1"\n',
      'test:/video\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1",SUBTITLES="sub2"\n',
      'test:/video\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var textMedia = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.vtt'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
              .addTextStream(jasmine.any(Number))
                .language('en')
                .anySegmentFunctions()
                .nullInitSegment()
                .presentationTimeOffset(0)
                .mime('text/vtt', '')
                .kind(TextStreamKind.SUBTITLE)
              .addTextStream(jasmine.any(Number))
                .language('es')
                .anySegmentFunctions()
                .nullInitSegment()
                .presentationTimeOffset(0)
                .mime('text/vtt', '')
                .kind(TextStreamKind.SUBTITLE)
          .build();

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/text': toUTF8(textMedia),
      'test:/text2': toUTF8(textMedia),
      'test:/main.vtt': toUTF8(vttText),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail).then(done);
  });

  it('parses manifest with text streams without SUBTITLES', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'URI="test:/audio"\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub2",LANGUAGE="es",',
      'URI="test:/text2"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1"\n',
      'test:/video\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var textMedia = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.vtt'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .language('en')
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .language('en')
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
              .addTextStream(jasmine.any(Number))
                .language('en')
                .anySegmentFunctions()
                .nullInitSegment()
                .presentationTimeOffset(0)
                .mime('text/vtt', '')
                .kind(TextStreamKind.SUBTITLE)
              .addTextStream(jasmine.any(Number))
                .language('es')
                .anySegmentFunctions()
                .nullInitSegment()
                .presentationTimeOffset(0)
                .mime('text/vtt', '')
                .kind(TextStreamKind.SUBTITLE)
          .build();

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/text': toUTF8(textMedia),
      'test:/text2': toUTF8(textMedia),
      'test:/main.vtt': toUTF8(vttText),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail).then(done);
  });

  it('calculates duration from stream lengths', function(done) {
    const master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
      'CHANNELS="2",URI="test:/audio"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,AUDIO="aud1",SUBTITLES="sub1"\n',
      'test:/video\n'
    ].join('');

    const video = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n'
    ].join('');

    const audio = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n'
    ].join('');

    const text = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.vtt'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(audio),
      'test:/video': toUTF8(video),
      'test:/text': toUTF8(text),
      'test:/main.vtt': toUTF8(vttText),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then((actual) => {
          // Duration should be the minimum of the streams, but ignore the text
          // stream.
          let timeline = actual.presentationTimeline;
          expect(timeline.getDuration()).toBe(10);

          let period = actual.periods[0];
          expect(period.textStreams.length).toBe(1);
          expect(period.variants.length).toBe(1);
          expect(period.variants[0].audio).toBeTruthy();
          expect(period.variants[0].video).toBeTruthy();
        })
        .catch(fail).then(done);
  });

  it('parses manifest with MP4+TTML streams', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,stpp.TTML.im1t",',
      'RESOLUTION=960x540,FRAME-RATE=60,SUBTITLES="sub1"\n',
      'test:/video\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
              .addTextStream(jasmine.any(Number))
                .language('en')
                .anySegmentFunctions()
                .anyInitSegment()
                .presentationTimeOffset(0)
                .mime('application/mp4', 'stpp.TTML.im1t')
                .kind(TextStreamKind.SUBTITLE)
          .build();

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/text': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail).then(done);
  });

  it('detects VTT streams by codec', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,vtt",',
      'RESOLUTION=960x540,FRAME-RATE=60,SUBTITLES="sub1"\n',
      'test:/video\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var textMedia = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.foo'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
              .addTextStream(jasmine.any(Number))
                .language('en')
                .anySegmentFunctions()
                .nullInitSegment()
                .presentationTimeOffset(0)
                .mime('text/vtt', 'vtt')
                .kind(TextStreamKind.SUBTITLE)
          .build();

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/text': toUTF8(textMedia),
      'test:/main.foo': toUTF8(vttText),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail).then(done);
  });

  it('allows init segments in text streams', function(done) {
    const master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="eng",',
      'URI="test:/text"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,wvtt",',
      'RESOLUTION=960x540,FRAME-RATE=60,SUBTITLES="sub1"\n',
      'test:/video\n'
    ].join('');

    const media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    let manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
              .addTextStream(jasmine.any(Number))
                .language('en')
                .anySegmentFunctions()
                .anyInitSegment()
                .presentationTimeOffset(0)
                .mime('application/mp4', 'wvtt')
                .kind(TextStreamKind.SUBTITLE)
          .build();

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/audio': toUTF8(media),
      'test:/video': toUTF8(media),
      'test:/text': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface)
        .then(function(actual) { expect(actual).toEqual(manifest); })
        .catch(fail).then(done);
  });

  it('parses video described by a media tag', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
      'test:/audio\n',
      '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('constructs relative URIs', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
      'audio/audio.m3u8\n',
      '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="video/video.m3u8"'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      'segment.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    fakeNetEngine.setResponseMap({
      'test:/host/master.m3u8': toUTF8(master),
      'test:/host/audio/audio.m3u8': toUTF8(media),
      'test:/host/video/video.m3u8': toUTF8(media),
      'test:/host/audio/init.mp4': initSegmentData,
      'test:/host/audio/segment.mp4': segmentData,
      'test:/host/video/init.mp4': initSegmentData,
      'test:/host/video/segment.mp4': segmentData
    });

    parser.start('test:/host/master.m3u8', playerInterface)
        .then(function(actual) {
          expect(actual).toEqual(manifest);
          var video = actual.periods[0].variants[0].video;
          var audio = actual.periods[0].variants[0].audio;

          var videoPosition = video.findSegmentPosition(0);
          var audioPosition = audio.findSegmentPosition(0);
          goog.asserts.assert(videoPosition != null,
                              'Cannot find first video segment');
          goog.asserts.assert(audioPosition != null,
                              'Cannot find first audio segment');

          var videoReference = video.getSegmentReference(videoPosition);
          var audioReference = audio.getSegmentReference(audioPosition);
          expect(videoReference).not.toBe(null);
          expect(audioReference).not.toBe(null);
          if (videoReference) {
            expect(videoReference.getUris()[0])
                .toEqual('test:/host/video/segment.mp4');
          }
          if (audioReference) {
            expect(audioReference.getUris()[0])
                .toEqual('test:/host/audio/segment.mp4');
          }
        }).catch(fail).then(done);
  });

  it('allows streams with no init segment', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
      'test:/audio\n',
      '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:6\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/selfInit.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .nullInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .addAudio(jasmine.any(Number))
                  .anySegmentFunctions()
                  .nullInitSegment()
                  .presentationTimeOffset(0)
                  .mime('audio/mp4', 'mp4a')
          .build();

    testHlsParser(master, media, manifest, done);
  });

  it('constructs DrmInfo for Widevine', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video\n'
    ].join('');

    var initDataBase64 =
        'dGhpcyBpbml0IGRhdGEgY29udGFpbnMgaGlkZGVuIHNlY3JldHMhISE=';

    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:6\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,',
      'KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",',
      'URI="data:text/plain;base64,',
      initDataBase64, '",\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    var manifest = new shaka.test.ManifestGenerator()
            .anyTimeline()
            .addPeriod(jasmine.any(Number))
              .addVariant(jasmine.any(Number))
                .bandwidth(200)
                .addVideo(jasmine.any(Number))
                  .anySegmentFunctions()
                  .anyInitSegment()
                  .presentationTimeOffset(0)
                  .mime('video/mp4', 'avc1')
                  .frameRate(60)
                  .size(960, 540)
                .encrypted(true)
                .addDrmInfo('com.widevine.alpha')
                  .addCencInitData(initDataBase64)
          .build();

    testHlsParser(master, media, manifest, done);
  });

  describe('Errors out', function() {
    var Code = shaka.util.Error.Code;

    /**
     * @param {string} master
     * @param {string} media
     * @param {!shaka.util.Error} error
     * @param {function()} done
     */
    function verifyError(master, media, error, done) {
      fakeNetEngine.setResponseMap({
        'test:/master': toUTF8(master),
        'test:/audio': toUTF8(media),
        'test:/video': toUTF8(media),
        'test:/main.exe': segmentData,
        'test:/init.mp4': initSegmentData,
        'test:/main.mp4': segmentData
      });

      parser.start('test:/master', playerInterface)
            .then(fail)
            .catch(function(e) {
                shaka.test.Util.expectToEqualError(e, error);
              })
            .then(done);
    }

    it('if multiple init sections were provided', function(done) {
      var master = [
        '#EXTM3U\n',
        '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
        'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
        'test:/audio\n',
        '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
      ].join('');

      var media = [
        '#EXTM3U\n',
        '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
        '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
        '#EXT-X-PLAYLIST-TYPE:VOD\n',
        '#EXTINF:5,\n',
        '#EXT-X-BYTERANGE:121090@616\n',
        'test:/main.mp4'
      ].join('');

      var error = new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.MANIFEST,
          Code.HLS_MULTIPLE_MEDIA_INIT_SECTIONS_FOUND);

      verifyError(master, media, error, done);
    });

    it('if unable to guess mime type', function(done) {
      var master = [
        '#EXTM3U\n',
        '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
        'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
        'test:/audio\n',
        '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
      ].join('');

      var media = [
        '#EXTM3U\n',
        '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
        '#EXT-X-PLAYLIST-TYPE:VOD\n',
        '#EXTINF:5,\n',
        '#EXT-X-BYTERANGE:121090@616\n',
        'test:/main.exe'
      ].join('');

      var error = new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.MANIFEST,
          Code.HLS_COULD_NOT_GUESS_MIME_TYPE, 'exe');

      verifyError(master, media, error, done);
    });

    it('if unable to guess codecs', function(done) {
      var master = [
        '#EXTM3U\n',
        '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="aaa,bbb",',
        'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
        'test:/audio\n',
        '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",',
        'URI="test:/video"'
      ].join('');

      var media = [
        '#EXTM3U\n',
        '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
        '#EXT-X-PLAYLIST-TYPE:VOD\n',
        '#EXTINF:5,\n',
        '#EXT-X-BYTERANGE:121090@616\n',
        'test:/main.mp4'
      ].join('');

      var error = new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.MANIFEST,
          Code.HLS_COULD_NOT_GUESS_CODECS,
          ['aaa', 'bbb']);

      verifyError(master, media, error, done);
    });

    describe('if required attributes are missing', function() {
      /**
       * @param {string} master
       * @param {string} media
       * @param {string} attributeName
       * @param {function()} done
       */
      function verifyMissingAttribute(master, media, attributeName, done) {
        var error = new shaka.util.Error(
            shaka.util.Error.Severity.CRITICAL,
            shaka.util.Error.Category.MANIFEST,
            Code.HLS_REQUIRED_ATTRIBUTE_MISSING,
            attributeName);

        verifyError(master, media, error, done);
      }

      it('bandwidth', function(done) {
        var master = [
          '#EXTM3U\n',
          '#EXT-X-STREAM-INF:CODECS="avc1,mp4a",',
          'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
          'test:/audio\n',
          '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
        ].join('');

        var media = [
          '#EXTM3U\n',
          '#EXT-X-PLAYLIST-TYPE:VOD\n',
          '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
          '#EXTINF:5,\n',
          '#EXT-X-BYTERANGE:121090@616\n',
          'test:/main.exe'
        ].join('');

        verifyMissingAttribute(master, media, 'BANDWIDTH', done);
      });

      it('uri', function(done) {
        var master = [
          '#EXTM3U\n',
          '#EXT-X-STREAM-INF:CODECS="avc1,mp4a",BANDWIDTH=200,',
          'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
          'test:/audio\n',
          '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid"'
        ].join('');

        var media = [
          '#EXTM3U\n',
          '#EXT-X-PLAYLIST-TYPE:VOD\n',
          '#EXT-X-MAP:URI="test:/init.mp4"\n',
          '#EXTINF:5,\n',
          '#EXT-X-BYTERANGE:121090@616\n',
          'test:/main.exe'
        ].join('');

        verifyMissingAttribute(master, media, 'URI', done);
      });
    });

    describe('if required tags are missing', function() {
      /**
       * @param {string} master
       * @param {string} media
       * @param {string} tagName
       * @param {function()} done
       */
      function verifyMissingTag(master, media, tagName, done) {
        var error = new shaka.util.Error(
            shaka.util.Error.Severity.CRITICAL,
            shaka.util.Error.Category.MANIFEST,
            Code.HLS_REQUIRED_TAG_MISSING,
            tagName);

        verifyError(master, media, error, done);
      }

      it('EXTINF', function(done) {
        var master = [
          '#EXTM3U\n',
          '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
          'RESOLUTION=960x540,FRAME-RATE=60,VIDEO="vid"\n',
          'test:/audio\n',
          '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vid",URI="test:/video"'
        ].join('');

        var media = [
          '#EXTM3U\n',
          '#EXT-X-PLAYLIST-TYPE:VOD\n',
          '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
          '#EXT-X-BYTERANGE:121090@616\n',
          'test:/main.mp4'
        ].join('');

        verifyMissingTag(master, media, 'EXTINF', done);
      });
    });
  });  // Errors out

  describe('getStartTime_', function() {
    /** @type {number} */
    var segmentDataStartTime;
    /** @type {ArrayBuffer} */
    var tsSegmentData;

    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    // TODO: Add separate tests to cover correct handling of BYTERANGE in
    // constructing references.  Here it is covered incidentally.
    var expectedStartByte = 616;
    var expectedEndByte = 121705;
    // Nit: this value is an implementation detail of the fix for #1106
    var partialEndByte = expectedStartByte + 2048 - 1;

    beforeEach(function() {
      // TODO: use StreamGenerator?
      segmentData = new Uint8Array([
        0x00, 0x00, 0x00, 0x24, // size (36)
        0x6D, 0x6F, 0x6F, 0x66, // type (moof)
        0x00, 0x00, 0x00, 0x1C, // traf size (28)
        0x74, 0x72, 0x61, 0x66, // type (traf)
        0x00, 0x00, 0x00, 0x14, // tfdt size (20)
        0x74, 0x66, 0x64, 0x74, // type (tfdt)
        0x01, 0x00, 0x00, 0x00, // version and flags

        0x00, 0x00, 0x00, 0x00, // baseMediaDecodeTime first 4 bytes
        0x00, 0x00, 0x07, 0xd0  // baseMediaDecodeTime last 4 bytes (2000)
      ]).buffer;
      tsSegmentData = new Uint8Array([
        0x47, // TS sync byte (fixed value)
        0x41, 0x01, // not corrupt, payload follows, packet ID 257
        0x10, // not scrambled, no adaptation field, payload only, seq #0
        0x00, 0x00, 0x01, // PES start code (fixed value)
        0xe0, // stream ID (video stream 0)
        0x00, 0x00, // PES packet length (doesn't matter)
        0x80, // marker bits (fixed value), not scrambled, not priority
        0x80, // PTS only, no DTS, other flags 0 (don't matter)
        0x05, // remaining PES header length == 5 (one timestamp)
        0x21, 0x00, 0x0b, 0x7e, 0x41 // PTS = 180000, encoded into 5 bytes
      ]).buffer;
      // 180000 (TS PTS) divided by fixed TS timescale (90000) = 2s.
      // 2000 (MP4 PTS) divided by parsed MP4 timescale (1000) = 2s.
      segmentDataStartTime = 2;
    });

    it('parses start time from mp4 segment', function(done) {
      fakeNetEngine.setResponseMap({
        'test:/master': toUTF8(master),
        'test:/video': toUTF8(media),
        'test:/init.mp4': initSegmentData,
        'test:/main.mp4': segmentData
      });

      var ref = ManifestParser.makeReference(
          'test:/main.mp4' /* uri */,
          0 /* position */,
          0 /* startTime */,
          5 /* endTime */,
          '' /* baseUri */,
          expectedStartByte,
          expectedEndByte);

      parser.start('test:/master', playerInterface).then(function(manifest) {
        var video = manifest.periods[0].variants[0].video;
        ManifestParser.verifySegmentIndex(video, [ref]);

        // Make sure the segment data was fetched with the correct byte
        // range.
        fakeNetEngine.expectRangeRequest(
            'test:/main.mp4',
            expectedStartByte,
            partialEndByte);

        // In VOD content, we set the presentationTimeOffset to align the
        // content to presentation time 0.
        expect(video.presentationTimeOffset).toEqual(segmentDataStartTime);
      }).catch(fail).then(done);
    });

    it('parses start time from ts segments', function(done) {
      var tsMediaPlaylist = media.replace(/\.mp4/g, '.ts');

      fakeNetEngine.setResponseMap({
        'test:/master': toUTF8(master),
        'test:/video': toUTF8(tsMediaPlaylist),
        'test:/main.ts': tsSegmentData
      });

      var ref = ManifestParser.makeReference(
          'test:/main.ts' /* uri */,
          0 /* position */,
          0 /* startTime */,
          5 /* endTime */,
          '' /* baseUri */,
          expectedStartByte,
          expectedEndByte);

      parser.start('test:/master', playerInterface).then(function(manifest) {
        var video = manifest.periods[0].variants[0].video;
        ManifestParser.verifySegmentIndex(video, [ref]);

        // Make sure the segment data was fetched with the correct byte
        // range.
        fakeNetEngine.expectRangeRequest(
            'test:/main.ts',
            expectedStartByte,
            partialEndByte);

        // In VOD content, we set the presentationTimeOffset to align the
        // content to presentation time 0.
        expect(video.presentationTimeOffset).toEqual(segmentDataStartTime);
      }).catch(fail).then(done);
    });

    it('sets duration with respect to presentation offset', function(done) {
      fakeNetEngine.setResponseMap({
        'test:/master': toUTF8(master),
        'test:/video': toUTF8(media),
        'test:/init.mp4': initSegmentData,
        'test:/main.mp4': segmentData
      });

      parser.start('test:/master', playerInterface).then(function(manifest) {
        var presentationTimeline = manifest.presentationTimeline;
        var video = manifest.periods[0].variants[0].video;
        var ref = video.getSegmentReference(0);
        expect(video.getSegmentReference(1)).toBe(null);  // No more references.

        expect(video.presentationTimeOffset).toEqual(segmentDataStartTime);
        // The duration should be set to the sum of the segment durations (5),
        // even though the endTime of the segment is larger.
        expect(ref.endTime - ref.startTime).toEqual(5);
        expect(presentationTimeline.getDuration()).toEqual(5);
      }).catch(fail).then(done);
    });
  });

  it('correctly detects VOD streams as non-live', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/video': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface).then(function(manifest) {
      expect(manifest.presentationTimeline.isLive()).toBe(false);
    }).catch(fail).then(done);
  });

  it('correctly detects streams with ENDLIST as non-live', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n',
      '#EXT-X-ENDLIST'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/video': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface).then(function(manifest) {
      expect(manifest.presentationTimeline.isLive()).toBe(false);
    }).catch(fail).then(done);
  });

  it('guesses MIME types for known extensions', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4\n',
      '#EXT-X-ENDLIST'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/video': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface).then(function(manifest) {
      var video = manifest.periods[0].variants[0].video;
      expect(video.mimeType).toBe('video/mp4');
    }).catch(fail).then(done);
  });

  it('guesses MIME types for known extensions with parameters', function(done) {
    var master = [
      '#EXTM3U\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
      'RESOLUTION=960x540,FRAME-RATE=60\n',
      'test:/video'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:5,\n',
      'test:/main.mp4?foo=bar\n',
      '#EXT-X-ENDLIST'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/video': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4?foo=bar': segmentData
    });

    parser.start('test:/master', playerInterface).then(function(manifest) {
      var video = manifest.periods[0].variants[0].video;
      expect(video.mimeType).toBe('video/mp4');
    }).catch(fail).then(done);
  });

  it('does not produce multiple Streams for one playlist', function(done) {
    // Regression test for a bug in our initial HLS live implementation
    var master = [
      '#EXTM3U\n',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="test:/audio"\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=400,CODECS="avc1,mp4a",',
      'RESOLUTION=1280x720,AUDIO="audio"\n',
      'test:/video0\n',
      '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1,mp4a",',
      'RESOLUTION=768x432,AUDIO="audio"\n',
      'test:/video1\n'
    ].join('');

    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:VOD\n',
      '#EXT-X-MAP:URI="test:/init.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:5,\n',
      '#EXT-X-BYTERANGE:121090@616\n',
      'test:/main.mp4'
    ].join('');

    fakeNetEngine.setResponseMap({
      'test:/master': toUTF8(master),
      'test:/video0': toUTF8(media),
      'test:/video1': toUTF8(media),
      'test:/audio': toUTF8(media),
      'test:/init.mp4': initSegmentData,
      'test:/main.mp4': segmentData
    });

    parser.start('test:/master', playerInterface).then(function(manifest) {
      expect(manifest.periods[0].variants.length).toBe(2);
      var audio0 = manifest.periods[0].variants[0].audio;
      var audio1 = manifest.periods[0].variants[1].audio;
      // These should be the exact same memory address, not merely equal.
      // Otherwise, the parser will only be replacing one of the SegmentIndexes
      // on update, which will lead to live streaming issues.
      expect(audio0).toBe(audio1);
    }).catch(fail).then(done);
  });
});
