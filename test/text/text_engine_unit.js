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

describe('TextEngine', function() {
  /** @const */
  var TextEngine = shaka.text.TextEngine;
  /** @const */
  var dummyData = new ArrayBuffer(0);
  /** @const */
  var dummyMimeType = 'text/fake';

  /** @type {!Function} */
  var mockParserPlugIn;

  /** @type {!shaka.test.FakeTextDisplayer} */
  var mockDisplayer;

  /** @type {!jasmine.Spy} */
  var mockParseInit;

  /** @type {!jasmine.Spy} */
  var mockParseMedia;

  /** @type {!shaka.text.TextEngine} */
  var textEngine;

  beforeEach(function() {
    mockParseInit = jasmine.createSpy('mockParseInit');
    mockParseMedia = jasmine.createSpy('mockParseMedia');
    mockParserPlugIn = function() {
      return {
        parseInit: mockParseInit,
        parseMedia: mockParseMedia
      };
    };

    mockDisplayer = new shaka.test.FakeTextDisplayer();
    TextEngine.registerParser(dummyMimeType, mockParserPlugIn);
    textEngine = new TextEngine(mockDisplayer);
    textEngine.initParser(dummyMimeType);
  });

  afterEach(function() {
    TextEngine.unregisterParser(dummyMimeType);
  });

  describe('isTypeSupported', function() {
    it('reports support only when a parser is installed', function() {
      TextEngine.unregisterParser(dummyMimeType);
      expect(TextEngine.isTypeSupported(dummyMimeType)).toBe(false);
      TextEngine.registerParser(dummyMimeType, mockParserPlugIn);
      expect(TextEngine.isTypeSupported(dummyMimeType)).toBe(true);
      TextEngine.unregisterParser(dummyMimeType);
      expect(TextEngine.isTypeSupported(dummyMimeType)).toBe(false);
    });
  });

  describe('appendBuffer', function() {
    it('works asynchronously', function(done) {
      mockParseMedia.and.returnValue([1, 2, 3]);
      textEngine.appendBuffer(dummyData, 0, 3).catch(fail).then(done);
      expect(mockDisplayer.append).not.toHaveBeenCalled();
    });

    it('calls displayer.append()', function(done) {
      var cue1 = createFakeCue(1, 2);
      var cue2 = createFakeCue(2, 3);
      var cue3 = createFakeCue(3, 4);
      var cue4 = createFakeCue(4, 5);
      mockParseMedia.and.returnValue([cue1, cue2]);

      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(mockParseMedia).toHaveBeenCalledWith(
            new Uint8Array(dummyData),
            {periodStart: 0, segmentStart: 0, segmentEnd: 3 });
        expect(mockDisplayer.append).toHaveBeenCalledWith([cue1, cue2]);

        expect(mockDisplayer.remove).not.toHaveBeenCalled();

        mockDisplayer.append.calls.reset();
        mockParseMedia.calls.reset();

        mockParseMedia.and.returnValue([cue3, cue4]);
        return textEngine.appendBuffer(dummyData, 3, 5);
      }).then(function() {
        expect(mockParseMedia).toHaveBeenCalledWith(
            new Uint8Array(dummyData),
            {periodStart: 0, segmentStart: 3, segmentEnd: 5 });
        expect(mockDisplayer.append).toHaveBeenCalledWith([cue3, cue4]);
      }).catch(fail).then(done);
    });

    it('does not throw if called right before destroy', function(done) {
      mockParseMedia.and.returnValue([1, 2, 3]);
      textEngine.appendBuffer(dummyData, 0, 3).catch(fail).then(done);
      textEngine.destroy();
    });
  });

  describe('remove', function() {
    var cue1;
    var cue2;
    var cue3;

    beforeEach(function() {
      cue1 = createFakeCue(0, 1);
      cue2 = createFakeCue(1, 2);
      cue3 = createFakeCue(2, 3);
      mockParseMedia.and.returnValue([cue1, cue2, cue3]);
    });

    it('works asynchronously', function(done) {
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        var p = textEngine.remove(0, 1);
        expect(mockDisplayer.remove).not.toHaveBeenCalled();
        return p;
      }).catch(fail).then(done);
    });


    it('calls displayer.remove()', function(done) {
      textEngine.remove(0, 1).then(function() {
        expect(mockDisplayer.remove).toHaveBeenCalledWith(0, 1);
      }).catch(fail).then(done);
    });

    it('does not throw if called right before destroy', function(done) {
      textEngine.remove(0, 1).catch(fail).then(done);
      textEngine.destroy();
    });
  });

  describe('setTimestampOffset', function() {
    it('passes the offset to the parser', function(done) {
      mockParseMedia.and.callFake(function(data, time) {
        return [
          createFakeCue(time.periodStart + 0,
                        time.periodStart + 1),
          createFakeCue(time.periodStart + 2,
                        time.periodStart + 3)
        ];
      });

      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(mockParseMedia).toHaveBeenCalledWith(
            new Uint8Array(dummyData),
            {periodStart: 0, segmentStart: 0, segmentEnd: 3});

        expect(mockDisplayer.append).toHaveBeenCalledWith(
            [
              createFakeCue(0, 1),
              createFakeCue(2, 3)
            ]);

        mockDisplayer.append.calls.reset();
        textEngine.setTimestampOffset(4);
        return textEngine.appendBuffer(dummyData, 0, 3);
      }).then(function() {
        expect(mockParseMedia).toHaveBeenCalledWith(
            new Uint8Array(dummyData),
            {periodStart: 4, segmentStart: 4, segmentEnd: 7});
        expect(mockDisplayer.append).toHaveBeenCalledWith(
            [
              createFakeCue(4, 5),
              createFakeCue(6, 7)
            ]);
      }).catch(fail).then(done);
    });
  });

  describe('bufferStart/bufferEnd', function() {
    beforeEach(function() {
      mockParseMedia.and.callFake(function() {
        return [createFakeCue(0, 1), createFakeCue(1, 2), createFakeCue(2, 3)];
      });
    });

    it('return null when there are no cues', function() {
      expect(textEngine.bufferStart()).toBe(null);
      expect(textEngine.bufferEnd()).toBe(null);
    });

    it('reflect newly-added cues', function(done) {
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(textEngine.bufferStart()).toBe(0);
        expect(textEngine.bufferEnd()).toBe(3);

        return textEngine.appendBuffer(dummyData, 3, 6);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(0);
        expect(textEngine.bufferEnd()).toBe(6);

        return textEngine.appendBuffer(dummyData, 6, 10);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(0);
        expect(textEngine.bufferEnd()).toBe(10);
      }).catch(fail).then(done);
    });

    it('reflect newly-removed cues', function(done) {
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        return textEngine.appendBuffer(dummyData, 3, 6);
      }).then(function() {
        return textEngine.appendBuffer(dummyData, 6, 10);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(0);
        expect(textEngine.bufferEnd()).toBe(10);

        return textEngine.remove(0, 3);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(3);
        expect(textEngine.bufferEnd()).toBe(10);

        return textEngine.remove(8, 11);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(3);
        expect(textEngine.bufferEnd()).toBe(8);

        return textEngine.remove(11, 20);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(3);
        expect(textEngine.bufferEnd()).toBe(8);

        return textEngine.remove(0, Infinity);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(null);
        expect(textEngine.bufferEnd()).toBe(null);
      }).catch(fail).then(done);
    });

    it('handles timestamp offset', async function() {
      textEngine.setTimestampOffset(60);
      await textEngine.appendBuffer(dummyData, 0, 3);
      expect(textEngine.bufferStart()).toBe(60);
      expect(textEngine.bufferEnd()).toBe(63);

      await textEngine.appendBuffer(dummyData, 3, 6);
      expect(textEngine.bufferStart()).toBe(60);
      expect(textEngine.bufferEnd()).toBe(66);
    });
  });

  describe('bufferedAheadOf', function() {
    beforeEach(function() {
      mockParseMedia.and.callFake(function() {
        return [createFakeCue(0, 1), createFakeCue(1, 2), createFakeCue(2, 3)];
      });
    });

    it('returns 0 when there are no cues', function() {
      expect(textEngine.bufferedAheadOf(0)).toBe(0);
    });

    it('returns 0 if |t| is not buffered', function(done) {
      textEngine.appendBuffer(dummyData, 3, 6).then(function() {
        expect(textEngine.bufferedAheadOf(6.1)).toBe(0);
      }).catch(fail).then(done);
    });

    it('ignores gaps in the content', function(done) {
      textEngine.appendBuffer(dummyData, 3, 6).then(function() {
        expect(textEngine.bufferedAheadOf(2)).toBe(3);
      }).catch(fail).then(done);
    });

    it('returns the distance to the end if |t| is buffered', function(done) {
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(textEngine.bufferedAheadOf(0)).toBe(3);
        expect(textEngine.bufferedAheadOf(1)).toBe(2);
        expect(textEngine.bufferedAheadOf(2.5)).toBeCloseTo(0.5);
      }).catch(fail).then(done);
    });

    it('handles timestamp offset', async function() {
      textEngine.setTimestampOffset(60);
      await textEngine.appendBuffer(dummyData, 3, 6);
      expect(textEngine.bufferedAheadOf(64)).toBe(2);
    });
  });

  describe('setAppendWindow', function() {
    beforeEach(function() {
      mockParseMedia.and.callFake(function() {
        return [createFakeCue(0, 1), createFakeCue(1, 2), createFakeCue(2, 3)];
      });
    });

    it('limits appended cues', function(done) {
      textEngine.setAppendWindow(0, 1.9);
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(mockDisplayer.append).toHaveBeenCalledWith(
            [
              createFakeCue(0, 1),
              createFakeCue(1, 2)
            ]);

        mockDisplayer.append.calls.reset();
        textEngine.setAppendWindow(1, 2.1);
        return textEngine.appendBuffer(dummyData, 0, 3);
      }).then(function() {
        expect(mockDisplayer.append).toHaveBeenCalledWith(
            [
              createFakeCue(1, 2),
              createFakeCue(2, 3)
            ]);
      }).catch(fail).then(done);
    });

    it('limits bufferStart', function(done) {
      textEngine.setAppendWindow(1, 9);
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(textEngine.bufferStart()).toBe(1);

        return textEngine.remove(0, 9);
      }).then(function() {
        textEngine.setAppendWindow(2.1, 9);
        return textEngine.appendBuffer(dummyData, 0, 3);
      }).then(function() {
        expect(textEngine.bufferStart()).toBe(2.1);
      }).catch(fail).then(done);
    });

    it('limits bufferEnd', function(done) {
      textEngine.setAppendWindow(0, 1.9);
      textEngine.appendBuffer(dummyData, 0, 3).then(function() {
        expect(textEngine.bufferEnd()).toBe(1.9);

        textEngine.setAppendWindow(0, 2.1);
        return textEngine.appendBuffer(dummyData, 0, 3);
      }).then(function() {
        expect(textEngine.bufferEnd()).toBe(2.1);

        textEngine.setAppendWindow(0, 4.1);
        return textEngine.appendBuffer(dummyData, 0, 3);
      }).then(function() {
        expect(textEngine.bufferEnd()).toBe(3);
      }).catch(fail).then(done);
    });
  });

  function createFakeCue(startTime, endTime) {
    return { startTime: startTime, endTime: endTime };
  }
});
