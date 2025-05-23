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

describe('SimpleAbrManager', function() {
  const sufficientBWMultiplier = 1.06;
  const defaultBandwidthEstimate = 500e3; // 500kbps

  /** @type {shakaExtern.AbrConfiguration} */
  var config;
  /** @type {!jasmine.Spy} */
  var switchCallback;
  /** @type {!shaka.abr.SimpleAbrManager} */
  var abrManager;
  /** @type {shakaExtern.Manifest} */
  var manifest;
  /** @type {!Array.<shakaExtern.Variant>} */
  var variants;


  beforeAll(function() {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    // This polyfill is required for fakeEventLoop.
    shaka.polyfill.Promise.install(/* force */ true);
  });

  beforeEach(function() {
    switchCallback = jasmine.createSpy('switchCallback');

    // Keep unsorted.
    manifest = new shaka.test.ManifestGenerator()
      .addPeriod(0)
        .addVariant(0).bandwidth(4e5)  // 400 kbps
          .addAudio(0)
          .addVideo(1)
        .addVariant(1).bandwidth(1e6)  // 1000 kbps
          .addAudio(2)
          .addVideo(3)
        .addVariant(2).bandwidth(5e5)  // 500 kbps
          .addAudio(12)
          .addVideo(4)
        .addVariant(3).bandwidth(2e6)
          .addAudio(5)
          .addVideo(6)
        .addVariant(4).bandwidth(2e6)  // Identical on purpose.
          .addAudio(7)
          .addVideo(6)
        .addVariant(5).bandwidth(6e5)
          .addAudio(8)
          .addVideo(9)
        .addTextStream(10)
        .addTextStream(11)
      .build();

    config = {
      enabled: true,
      defaultBandwidthEstimate: defaultBandwidthEstimate,
      switchInterval: 8,
      bandwidthUpgradeTarget: 0.85,
      bandwidthDowngradeTarget: 0.95,
      restrictions: {  // Must be inline to avoid cross-test pollution!
        minWidth: 0,
        maxWidth: Infinity,
        minHeight: 0,
        maxHeight: Infinity,
        minPixels: 0,
        maxPixels: Infinity,
        minBandwidth: 0,
        maxBandwidth: Infinity
      },
    };

    variants = manifest.periods[0].variants;

    abrManager = new shaka.abr.SimpleAbrManager();
    abrManager.init(shaka.test.Util.spyFunc(switchCallback));
    abrManager.configure(config);
    abrManager.setVariants(variants);
  });

  afterEach(function() {
    abrManager.stop();
  });

  afterAll(function() {
    shaka.polyfill.Promise.uninstall();
    jasmine.clock().uninstall();
  });

  it('can choose audio and video Streams right away', function() {
    var chosen = abrManager.chooseVariant();
    expect(chosen).not.toBe(null);
  });

  it('uses custom default estimate', function() {
    config.defaultBandwidthEstimate = 3e6;
    abrManager.configure(config);
    var chosen = abrManager.chooseVariant();
    expect(chosen.id).toBe(4);
  });

  it('can handle empty variants', function() {
    abrManager.setVariants([]);
    var chosen = abrManager.chooseVariant();
    expect(chosen).toEqual(null);
  });

  it('can choose from audio only variants', function() {
    manifest = new shaka.test.ManifestGenerator()
      .addPeriod(0)
        .addVariant(0).bandwidth(4e5)
          .addAudio(0)
        .addVariant(1).bandwidth(1e6)
          .addAudio(2)
      .build();

    abrManager.setVariants(manifest.periods[0].variants);
    var chosen = abrManager.chooseVariant();
    expect(chosen).not.toBe(null);
    expect(chosen.audio).not.toBe(null);
    expect(chosen.video).toBe(null);
  });

  it('can choose from video only variants', function() {
    manifest = new shaka.test.ManifestGenerator()
      .addPeriod(0)
        .addVariant(0).bandwidth(4e5)
          .addVideo(0)
        .addVariant(1).bandwidth(1e6)
          .addVideo(2)
      .build();

    abrManager.setVariants(manifest.periods[0].variants);
    var chosen = abrManager.chooseVariant();
    expect(chosen).not.toBe(null);
    expect(chosen.audio).toBe(null);
    expect(chosen.video).not.toBe(null);
  });

  [5e5, 6e5].forEach(function(bandwidth) {
    // Simulate some segments being downloaded just above the desired
    // bandwidth.
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    var bandwidthKbps = bandwidth / 1000.0;
    var description =
        'picks correct Variant at ' + bandwidthKbps + ' kbps';

    it(description, function() {
      abrManager.setVariants(variants);
      abrManager.chooseVariant();

      abrManager.segmentDownloaded(1000, bytesPerSecond);
      abrManager.segmentDownloaded(1000, bytesPerSecond);

      abrManager.enable();

      // Make another call to segmentDownloaded() so switchCallback() is
      // called.
      abrManager.segmentDownloaded(1000, bytesPerSecond);

      // Expect variants 2 to be chosen for bandwidth = 5e5
      // and variant 5 - for bandwidth = 6e5
      var expectedVariant = (bandwidth == 6e5) ? variants[5] : variants[2];

      expect(switchCallback).toHaveBeenCalledWith(expectedVariant);
    });
  });

  it('can handle 0 duration segments', function() {
    // Makes sure bandwidth estimate doesn't get set to NaN
    // when a 0 duration segment is encountered.
    // https://github.com/google/shaka-player/issues/582
    var bandwidth = 5e5;
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    abrManager.setVariants(variants);
    abrManager.chooseVariant();

    // 0 duration segment shouldn't cause us to get stuck on the lowest variant
    abrManager.segmentDownloaded(0, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    abrManager.enable();

    abrManager.segmentDownloaded(1000, bytesPerSecond);

    expect(abrManager.getBandwidthEstimate()).toBeTruthy();
  });

  it('picks lowest variant when there is insufficient bandwidth',
      function() {
        var bandwidth = 2e6;

        abrManager.setVariants(variants);
        abrManager.chooseVariant();

        // Simulate some segments being downloaded just above the desired
        // bandwidth.
        var bytesPerSecond =
            sufficientBWMultiplier * bandwidth / 8.0;

        abrManager.segmentDownloaded(1000, bytesPerSecond);
        abrManager.segmentDownloaded(1000, bytesPerSecond);

        abrManager.enable();

        // Make another call to segmentDownloaded() so switchCallback() is
        // called.
        abrManager.segmentDownloaded(1000, bytesPerSecond);

        // Expect variants 4 to be chosen
        var expectedVariant = variants[4];

        expect(switchCallback).toHaveBeenCalledWith(expectedVariant);
      });

  it('does not call switchCallback() if not enabled', function() {
    var bandwidth = 5e5;
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    abrManager.setVariants(variants);
    abrManager.chooseVariant();

    // Don't enable AbrManager.
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    expect(switchCallback).not.toHaveBeenCalled();
  });

  it('does not call switchCallback() in switch interval', function() {
    var bandwidth = 5e5;
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    abrManager.setVariants(variants);
    abrManager.chooseVariant();

    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    abrManager.enable();

    abrManager.segmentDownloaded(1000, bytesPerSecond);
    expect(switchCallback).toHaveBeenCalled();
    switchCallback.calls.reset();

    // Simulate drop in bandwidth.
    bandwidth = 2e6;
    bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    // Stay inside switch interval.
    shaka.test.Util.fakeEventLoop(config.switchInterval - 2);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    expect(switchCallback).not.toHaveBeenCalled();

    // Move outside switch interval.
    shaka.test.Util.fakeEventLoop(3);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    expect(switchCallback).toHaveBeenCalled();
  });

  it('does not clear the buffer on upgrade', function() {
    // Simulate some segments being downloaded at a high rate, to trigger an
    // upgrade.
    var bandwidth = 5e5;
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    abrManager.setVariants(variants);
    abrManager.chooseVariant();

    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    abrManager.enable();

    // Make another call to segmentDownloaded(). switchCallback() will be
    // called to upgrade.
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    // The second parameter is missing to indicate that the buffer should not be
    // cleared.
    expect(switchCallback).toHaveBeenCalledWith(jasmine.any(Object));
  });

  it('does not clear the buffer on downgrade', function() {
    // Simulate some segments being downloaded at a low rate, to trigger a
    // downgrade.
    var bandwidth = 5e5;
    var bytesPerSecond =
        sufficientBWMultiplier * bandwidth / 8.0;

    // Set the default high so that the initial choice will be high-quality.
    config.defaultBandwidthEstimate = 4e6;
    abrManager.configure(config);

    abrManager.setVariants(variants);
    abrManager.chooseVariant();

    abrManager.segmentDownloaded(1000, bytesPerSecond);
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    abrManager.enable();

    // Make another call to segmentDownloaded(). switchCallback() will be
    // called to downgrade.
    abrManager.segmentDownloaded(1000, bytesPerSecond);

    // The second parameter is missing to indicate that the buffer should not be
    // cleared.
    expect(switchCallback).toHaveBeenCalledWith(jasmine.any(Object));
  });

  it('will respect restrictions', function() {
    manifest = new shaka.test.ManifestGenerator()
      .addPeriod(0)
        .addVariant(0).bandwidth(1e5)
          .addVideo(0).size(50, 50)
        .addVariant(1).bandwidth(2e5)
          .addVideo(1).size(200, 200)
      .build();

    abrManager.setVariants(manifest.periods[0].variants);
    var chosen = abrManager.chooseVariant();
    expect(chosen.id).toBe(1);

    config.restrictions.maxWidth = 100;
    abrManager.configure(config);

    chosen = abrManager.chooseVariant();
    expect(chosen.id).toBe(0);
  });

  it('uses lowest-bandwidth variant when restrictions cannot be met', () => {
    manifest = new shaka.test.ManifestGenerator()
      .addPeriod(0)
        .addVariant(0).bandwidth(1e5)
          .addVideo(0).size(50, 50)
        .addVariant(1).bandwidth(2e5)
          .addVideo(1).size(200, 200)
      .build();

    abrManager.setVariants(manifest.periods[0].variants);
    let chosen = abrManager.chooseVariant();
    expect(chosen.id).toBe(1);

    // This restriction cannot be met, but we shouldn't fail.
    config.restrictions.maxWidth = 1;
    abrManager.configure(config);

    chosen = abrManager.chooseVariant();
    expect(chosen.id).toBe(0);
  });
});
