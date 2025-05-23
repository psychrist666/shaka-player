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

goog.provide('shaka.dash.DashParser');

goog.require('goog.asserts');
goog.require('shaka.abr.Ewma');
goog.require('shaka.dash.ContentProtection');
goog.require('shaka.dash.MpdUtils');
goog.require('shaka.dash.SegmentBase');
goog.require('shaka.dash.SegmentList');
goog.require('shaka.dash.SegmentTemplate');
goog.require('shaka.log');
goog.require('shaka.media.DrmEngine');
goog.require('shaka.media.ManifestParser');
goog.require('shaka.media.PresentationTimeline');
goog.require('shaka.media.SegmentReference');
goog.require('shaka.net.NetworkingEngine');
goog.require('shaka.text.TextEngine');
goog.require('shaka.util.Error');
goog.require('shaka.util.Functional');
goog.require('shaka.util.LanguageUtils');
goog.require('shaka.util.ManifestParserUtils');
goog.require('shaka.util.MimeUtils');
goog.require('shaka.util.StringUtils');
goog.require('shaka.util.XmlUtils');



/**
 * Creates a new DASH parser.
 *
 * @struct
 * @constructor
 * @implements {shakaExtern.ManifestParser}
 * @export
 */
shaka.dash.DashParser = function() {
  /** @private {?shakaExtern.ManifestConfiguration} */
  this.config_ = null;

  /** @private {?shakaExtern.ManifestParser.PlayerInterface} */
  this.playerInterface_ = null;

  /** @private {!Array.<string>} */
  this.manifestUris_ = [];

  /** @private {?shakaExtern.Manifest} */
  this.manifest_ = null;

  /** @private {!Array.<string>} */
  this.periodIds_ = [];

  /** @private {number} */
  this.globalId_ = 1;

  /**
   * A map of IDs to SegmentIndex objects.
   * ID: Period@id,AdaptationSet@id,@Representation@id
   * e.g.: '1,5,23'
   * @private {!Object.<string, !shaka.media.SegmentIndex>}
   */
  this.segmentIndexMap_ = {};

  /**
   * The update period in seconds; or 0 for no updates.
   * @private {number}
   */
  this.updatePeriod_ = 0;

  /**
   * An ewma that tracks how long updates take.
   * This is to mitigate issues caused by slow parsing on embedded devices.
   * @private {!shaka.abr.Ewma}
   */
  this.averageUpdateDuration_ = new shaka.abr.Ewma(5);

  /** @private {?number} */
  this.updateTimer_ = null;
};


/**
 * Contains the minimum amount of time, in seconds, between manifest update
 * requests.
 *
 * @private
 * @const {number}
 */
shaka.dash.DashParser.MIN_UPDATE_PERIOD_ = 3;


/**
 * @typedef {
 *   function(!Array.<string>, ?number, ?number):!Promise.<!ArrayBuffer>
 * }
 */
shaka.dash.DashParser.RequestInitSegmentCallback;


/**
 * @typedef {{
 *   segmentBase: Element,
 *   segmentList: Element,
 *   segmentTemplate: Element,
 *   baseUris: !Array.<string>,
 *   width: (number|undefined),
 *   height: (number|undefined),
 *   contentType: string,
 *   mimeType: string,
 *   codecs: string,
 *   frameRate: (number|undefined),
 *   containsEmsgBoxes: boolean,
 *   id: string,
 *   numChannels: ?number
 * }}
 *
 * @description
 * A collection of elements and properties which are inherited across levels
 * of a DASH manifest.
 *
 * @property {Element} segmentBase
 *   The XML node for SegmentBase.
 * @property {Element} segmentList
 *   The XML node for SegmentList.
 * @property {Element} segmentTemplate
 *   The XML node for SegmentTemplate.
 * @property {!Array.<string>} baseUris
 *   An array of absolute base URIs for the frame.
 * @property {(number|undefined)} width
 *   The inherited width value.
 * @property {(number|undefined)} height
 *   The inherited height value.
 * @property {string} contentType
 *   The inherited media type.
 * @property {string} mimeType
 *   The inherited MIME type value.
 * @property {string} codecs
 *   The inherited codecs value.
 * @property {(number|undefined)} frameRate
 *   The inherited framerate value.
 * @property {boolean} containsEmsgBoxes
 *   Whether there are 'emsg' boxes.
 * @property {string} id
 *   The ID of the element.
 * @property {?number} numChannels
 *   The number of audio channels, or null if unknown.
 */
shaka.dash.DashParser.InheritanceFrame;


/**
 * @typedef {{
 *   dynamic: boolean,
 *   presentationTimeline: !shaka.media.PresentationTimeline,
 *   period: ?shaka.dash.DashParser.InheritanceFrame,
 *   periodInfo: ?shaka.dash.DashParser.PeriodInfo,
 *   adaptationSet: ?shaka.dash.DashParser.InheritanceFrame,
 *   representation: ?shaka.dash.DashParser.InheritanceFrame,
 *   bandwidth: number,
 *   indexRangeWarningGiven: boolean
 * }}
 *
 * @description
 * Contains context data for the streams.
 *
 * @property {boolean} dynamic
 *   True if the MPD is dynamic (not all segments available at once)
 * @property {!shaka.media.PresentationTimeline} presentationTimeline
 *   The PresentationTimeline.
 * @property {?shaka.dash.DashParser.InheritanceFrame} period
 *   The inheritance from the Period element.
 * @property {?shaka.dash.DashParser.PeriodInfo} periodInfo
 *   The Period info for the current Period.
 * @property {?shaka.dash.DashParser.InheritanceFrame} adaptationSet
 *   The inheritance from the AdaptationSet element.
 * @property {?shaka.dash.DashParser.InheritanceFrame} representation
 *   The inheritance from the Representation element.
 * @property {number} bandwidth
 *   The bandwidth of the Representation, or zero if missing.
 * @property {boolean} indexRangeWarningGiven
 *   True if the warning about SegmentURL@indexRange has been printed.
 */
shaka.dash.DashParser.Context;


/**
 * @typedef {{
 *   start: number,
 *   duration: ?number,
 *   node: !Element,
 *   index: number,
 *   isLastPeriod: boolean
 * }}
 *
 * @description
 * Contains information about a Period element.
 *
 * @property {number} start
 *   The start time of the period.
 * @property {?number} duration
 *   The duration of the period; or null if the duration is not given.  This
 *   will be non-null for all periods except the last.
 * @property {!Element} node
 *   The XML Node for the Period.
 * @property {number} index
 *   The 0-base index of this Period within the manifest.
 * @property {boolean} isLastPeriod
 *   Whether this Period is the last one in the manifest.
 */
shaka.dash.DashParser.PeriodInfo;


/**
 * @typedef {{
 *   id: string,
 *   contentType: ?string,
 *   language: string,
 *   main: boolean,
 *   streams: !Array.<shakaExtern.Stream>,
 *   drmInfos: !Array.<shakaExtern.DrmInfo>,
 *   trickModeFor: ?string,
 *   representationIds: !Array.<string>
 * }}
 *
 * @description
 * Contains information about an AdaptationSet element.
 *
 * @property {string} id
 *   The unique ID of the adaptation set.
 * @property {?string} contentType
 *   The content type of the AdaptationSet.
 * @property {string} language
 *   The language of the AdaptationSet.
 * @property {boolean} main
 *   Whether the AdaptationSet has the 'main' type.
 * @property {!Array.<shakaExtern.Stream>} streams
 *   The streams this AdaptationSet contains.
 * @property {!Array.<shakaExtern.DrmInfo>} drmInfos
 *   The DRM info for the AdaptationSet.
 * @property {?string} trickModeFor
 *   If non-null, this AdaptationInfo represents trick mode tracks.  This
 *   property is the ID of the normal AdaptationSet these tracks should be
 *   associated with.
 * @property {!Array.<string>} representationIds
 *   An array of the IDs of the Representations this AdaptationSet contains.
 */
shaka.dash.DashParser.AdaptationInfo;


/**
 * @typedef {{
 *   createSegmentIndex: shakaExtern.CreateSegmentIndexFunction,
 *   findSegmentPosition: shakaExtern.FindSegmentPositionFunction,
 *   getSegmentReference: shakaExtern.GetSegmentReferenceFunction
 * }}
 *
 * @description
 * Contains functions used to create and find segment references.
 *
 * @property {shakaExtern.CreateSegmentIndexFunction} createSegmentIndex
 *   The createSegmentIndex function.
 * @property {shakaExtern.FindSegmentPositionFunction} findSegmentPosition
 *   The findSegmentPosition function.
 * @property {shakaExtern.GetSegmentReferenceFunction} getSegmentReference
 *   The getSegmentReference function.
 */
shaka.dash.DashParser.SegmentIndexFunctions;


/**
 * @typedef {{
 *   createSegmentIndex: shakaExtern.CreateSegmentIndexFunction,
 *   findSegmentPosition: shakaExtern.FindSegmentPositionFunction,
 *   getSegmentReference: shakaExtern.GetSegmentReferenceFunction,
 *   initSegmentReference: shaka.media.InitSegmentReference,
 *   scaledPresentationTimeOffset: number
 * }}
 *
 * @description
 * Contains information about a Stream.  This is passed from the createStream
 * methods.
 *
 * @property {shakaExtern.CreateSegmentIndexFunction} createSegmentIndex
 *   The createSegmentIndex function for the stream.
 * @property {shakaExtern.FindSegmentPositionFunction} findSegmentPosition
 *   The findSegmentPosition function for the stream.
 * @property {shakaExtern.GetSegmentReferenceFunction} getSegmentReference
 *   The getSegmentReference function for the stream.
 * @property {shaka.media.InitSegmentReference} initSegmentReference
 *   The init segment for the stream.
 * @property {number} scaledPresentationTimeOffset
 *   The presentation time offset for the stream, in seconds.
 */
shaka.dash.DashParser.StreamInfo;


/**
 * @override
 * @exportInterface
 */
shaka.dash.DashParser.prototype.configure = function(config) {
  goog.asserts.assert(config.dash != null,
                      'DashManifestConfiguration should not be null!');

  this.config_ = config;
};


/**
 * @override
 * @exportInterface
 */
shaka.dash.DashParser.prototype.start = function(uri, playerInterface) {
  goog.asserts.assert(this.config_, 'Must call configure() before start()!');
  this.manifestUris_ = [uri];
  this.playerInterface_ = playerInterface;
  return this.requestManifest_().then(function(updateDuration) {
    if (this.playerInterface_) {
      this.setUpdateTimer_(updateDuration);
    }
    return this.manifest_;
  }.bind(this));
};


/**
 * @override
 * @exportInterface
 */
shaka.dash.DashParser.prototype.stop = function() {
  this.playerInterface_ = null;
  this.config_ = null;
  this.manifestUris_ = [];
  this.manifest_ = null;
  this.periodIds_ = [];
  this.segmentIndexMap_ = {};
  if (this.updateTimer_ != null) {
    window.clearTimeout(this.updateTimer_);
    this.updateTimer_ = null;
  }

  return Promise.resolve();
};


/**
 * @override
 * @exportInterface
 */
shaka.dash.DashParser.prototype.update = function() {
  this.requestManifest_().catch(function(error) {
    if (!this.playerInterface_) return;
    this.playerInterface_.onError(error);
  }.bind(this));
};


/**
 * @override
 * @exportInterface
 */
shaka.dash.DashParser.prototype.onExpirationUpdated = function(
    sessionId, expiration) {
  // No-op
};


/**
 * Makes a network request for the manifest and parses the resulting data.
 *
 * @return {!Promise.<number>} Resolves with the time it took, in seconds, to
 *   fulfill the request and parse the data.
 * @private
 */
shaka.dash.DashParser.prototype.requestManifest_ = function() {
  var requestType = shaka.net.NetworkingEngine.RequestType.MANIFEST;
  var request = shaka.net.NetworkingEngine.makeRequest(
      this.manifestUris_, this.config_.retryParameters);
  var networkingEngine = this.playerInterface_.networkingEngine;
  var isCanceled = (function() {
    return !this.playerInterface_;
  }).bind(this);

  const startTime = Date.now();
  let promise = networkingEngine.request(requestType, request, isCanceled);
  return promise.then((response) => {
    // Detect calls to stop().
    if (!this.playerInterface_) {
      return;
    }

    // This may throw, but it will result in a failed promise.
    goog.asserts.assert(response.data, 'Response should have data!');
    return this.parseManifest_(response.data, response.uri);
  }).then(() => {
    // Keep track of how long the longest manifest update took.
    const endTime = Date.now();
    const updateDuration = (endTime - startTime) / 1000.0;
    this.averageUpdateDuration_.sample(1, updateDuration);

    // Let the caller know how long this update took.
    return updateDuration;
  });
};


/**
 * Parses the manifest XML.  This also handles updates and will update the
 * stored manifest.
 *
 * @param {!ArrayBuffer} data
 * @param {string} finalManifestUri The final manifest URI, which may
 *   differ from this.manifestUri_ if there has been a redirect.
 * @return {!Promise}
 * @throws shaka.util.Error When there is a parsing error.
 * @private
 */
shaka.dash.DashParser.prototype.parseManifest_ =
    function(data, finalManifestUri) {
  var Error = shaka.util.Error;
  var MpdUtils = shaka.dash.MpdUtils;

  var mpd = MpdUtils.parseXml(data, 'MPD');
  if (!mpd) {
    throw new Error(
        Error.Severity.CRITICAL, Error.Category.MANIFEST,
        Error.Code.DASH_INVALID_XML, finalManifestUri);
  }

  // Process the mpd to account for xlink connections.
  var failGracefully = this.config_.dash.xlinkFailGracefully;
  var xlinkPromise = MpdUtils.processXlinks(
      mpd, this.config_.retryParameters, failGracefully, finalManifestUri,
      this.playerInterface_.networkingEngine);
  return xlinkPromise.then(function(finalMpd) {
    return this.processManifest_(finalMpd, finalManifestUri);
  }.bind(this));
};


/**
 * Taked a formatted MPD and converts it into a manifest.
 *
 * @param {!Element} mpd
 * @param {string} finalManifestUri The final manifest URI, which may
 *   differ from this.manifestUri_ if there has been a redirect.
 * @return {!Promise}
 * @throws shaka.util.Error When there is a parsing error.
 * @private
 */
shaka.dash.DashParser.prototype.processManifest_ =
    function(mpd, finalManifestUri) {
  var Functional = shaka.util.Functional;
  var XmlUtils = shaka.util.XmlUtils;
  var ManifestParserUtils = shaka.util.ManifestParserUtils;

  // Get any Location elements.  This will update the manifest location and
  // the base URI.
  /** @type {!Array.<string>} */
  var manifestBaseUris = [finalManifestUri];
  /** @type {!Array.<string>} */
  var locations = XmlUtils.findChildren(mpd, 'Location')
                      .map(XmlUtils.getContents)
                      .filter(Functional.isNotNull);
  if (locations.length > 0) {
    this.manifestUris_ = locations;
    manifestBaseUris = locations;
  }

  var uris = XmlUtils.findChildren(mpd, 'BaseURL').map(XmlUtils.getContents);
  var baseUris = ManifestParserUtils.resolveUris(manifestBaseUris, uris);

  var minBufferTime =
      XmlUtils.parseAttr(mpd, 'minBufferTime', XmlUtils.parseDuration);
  this.updatePeriod_ = /** @type {number} */ (XmlUtils.parseAttr(
      mpd, 'minimumUpdatePeriod', XmlUtils.parseDuration, -1));

  var presentationStartTime = XmlUtils.parseAttr(
      mpd, 'availabilityStartTime', XmlUtils.parseDate);
  var segmentAvailabilityDuration = XmlUtils.parseAttr(
      mpd, 'timeShiftBufferDepth', XmlUtils.parseDuration);
  var suggestedPresentationDelay = XmlUtils.parseAttr(
      mpd, 'suggestedPresentationDelay', XmlUtils.parseDuration);
  var maxSegmentDuration = XmlUtils.parseAttr(
      mpd, 'maxSegmentDuration', XmlUtils.parseDuration);
  var mpdType = mpd.getAttribute('type') || 'static';

  /** @type {!shaka.media.PresentationTimeline} */
  var presentationTimeline;
  if (this.manifest_) {
    presentationTimeline = this.manifest_.presentationTimeline;
  } else {
    // DASH IOP v3.0 suggests using a default delay between minBufferTime and
    // timeShiftBufferDepth.  This is literally the range of all feasible
    // choices for the value.  Nothing older than timeShiftBufferDepth is still
    // available, and anything less than minBufferTime will cause buffering
    // issues.
    //
    // We have decided that our default will be 1.5 * minBufferTime,
    // or 10s (configurable) whichever is larger.  This is fairly conservative.
    // Content providers should provide a suggestedPresentationDelay
    // whenever possible to optimize the live streaming experience.
    var defaultPresentationDelay = Math.max(
        this.config_.dash.defaultPresentationDelay,
        minBufferTime * 1.5);
    var presentationDelay = suggestedPresentationDelay != null ?
        suggestedPresentationDelay : defaultPresentationDelay;
    presentationTimeline = new shaka.media.PresentationTimeline(
        presentationStartTime, presentationDelay);
  }

  /** @type {shaka.dash.DashParser.Context} */
  var context = {
    // Don't base on updatePeriod_ since emsg boxes can cause manifest updates.
    dynamic: mpdType != 'static',
    presentationTimeline: presentationTimeline,
    period: null,
    periodInfo: null,
    adaptationSet: null,
    representation: null,
    bandwidth: 0,
    indexRangeWarningGiven: false
  };

  var periodsAndDuration = this.parsePeriods_(context, baseUris, mpd);
  var duration = periodsAndDuration.duration;
  var periods = periodsAndDuration.periods;

  presentationTimeline.setStatic(mpdType == 'static');
  if (mpdType == 'static' || !periodsAndDuration.durationDerivedFromPeriods) {
    // Ignore duration calculated from Period lengths if this is dynamic.
    presentationTimeline.setDuration(duration || Infinity);
  }
  presentationTimeline.setSegmentAvailabilityDuration(
      segmentAvailabilityDuration != null ?
      segmentAvailabilityDuration :
      Infinity);
  // Use @maxSegmentDuration to override smaller, derived values.
  presentationTimeline.notifyMaxSegmentDuration(maxSegmentDuration || 1);
  if (goog.DEBUG) presentationTimeline.assertIsValid();

  if (this.manifest_) {
    // This is a manifest update, so we're done.
    return Promise.resolve();
  }

  // This is the first manifest parse, so we cannot return until we calculate
  // the clock offset.
  var timingElements = XmlUtils.findChildren(mpd, 'UTCTiming');

  var isLive = presentationTimeline.isLive();

  return this.parseUtcTiming_(
      baseUris, timingElements, isLive).then(function(offset) {
    // Detect calls to stop().
    if (!this.playerInterface_)
      return;

    presentationTimeline.setClockOffset(offset);

    this.manifest_ = {
      presentationTimeline: presentationTimeline,
      periods: periods,
      offlineSessionIds: [],
      minBufferTime: minBufferTime || 0
    };
  }.bind(this));
};


/**
 * Reads and parses the periods from the manifest.  This first does some
 * partial parsing so the start and duration is available when parsing children.
 *
 * @param {shaka.dash.DashParser.Context} context
 * @param {!Array.<string>} baseUris
 * @param {!Element} mpd
 * @return {{
 *   periods: !Array.<shakaExtern.Period>,
 *   duration: ?number,
 *   durationDerivedFromPeriods: boolean
 * }}
 * @private
 */
shaka.dash.DashParser.prototype.parsePeriods_ = function(
    context, baseUris, mpd) {
  var XmlUtils = shaka.util.XmlUtils;
  var presentationDuration = XmlUtils.parseAttr(
      mpd, 'mediaPresentationDuration', XmlUtils.parseDuration);

  var periods = [];
  var prevEnd = 0;
  var periodNodes = XmlUtils.findChildren(mpd, 'Period');
  for (var i = 0; i < periodNodes.length; i++) {
    var elem = periodNodes[i];
    var start = /** @type {number} */ (
        XmlUtils.parseAttr(elem, 'start', XmlUtils.parseDuration, prevEnd));
    var givenDuration =
        XmlUtils.parseAttr(elem, 'duration', XmlUtils.parseDuration);

    var periodDuration = null;
    if (i != periodNodes.length - 1) {
      // "The difference between the start time of a Period and the start time
      // of the following Period is the duration of the media content
      // represented by this Period."
      var nextPeriod = periodNodes[i + 1];
      var nextStart =
          XmlUtils.parseAttr(nextPeriod, 'start', XmlUtils.parseDuration);
      if (nextStart != null)
        periodDuration = nextStart - start;
    } else if (presentationDuration != null) {
      // "The Period extends until the Period.start of the next Period, or
      // until the end of the Media Presentation in the case of the last
      // Period."
      periodDuration = presentationDuration - start;
    }

    var threshold =
        shaka.util.ManifestParserUtils.GAP_OVERLAP_TOLERANCE_SECONDS;
    if (periodDuration && givenDuration &&
        Math.abs(periodDuration - givenDuration) > threshold) {
      shaka.log.warning('There is a gap/overlap between Periods', elem);
    }
    // Only use the @duration in the MPD if we can't calculate it.  We should
    // favor the @start of the following Period.  This ensures that there aren't
    // gaps between Periods.
    if (periodDuration == null)
      periodDuration = givenDuration;


    // Parse child nodes.
    var info = {
      start: start,
      duration: periodDuration,
      node: elem,
      index: i,
      isLastPeriod: periodDuration == null || i == periodNodes.length - 1
    };
    var period = this.parsePeriod_(context, baseUris, info);
    periods.push(period);

    // If the period ID is new, add it to the list.  This must be done for both
    // the initial manifest parse and for updates.
    // See https://github.com/google/shaka-player/issues/963
    var periodId = context.period.id;
    if (this.periodIds_.indexOf(periodId) == -1) {
      this.periodIds_.push(periodId);

      // If this is an update, call filterNewPeriod and add it to the manifest.
      // If this is the first parse of the manifest (this.manifest_ == null),
      // filterAllPeriods will be called later.
      if (this.manifest_) {
        this.playerInterface_.filterNewPeriod(period);
        this.manifest_.periods.push(period);
      }
    }

    if (periodDuration == null) {
      if (i != periodNodes.length - 1) {
        // If the duration is still null and we aren't at the end, then we will
        // skip any remaining periods.
        shaka.log.warning(
            'Skipping Period', i + 1, 'and any subsequent Periods:', 'Period',
            i + 1, 'does not have a valid start time.', periods[i + 1]);
      }

      // The duration is unknown, so the end is unknown.
      prevEnd = null;
      break;
    }

    prevEnd = start + periodDuration;
  } // end of period parsing loop

  // Call filterAllPeriods if this is the initial parse.
  if (this.manifest_ == null) {
    this.playerInterface_.filterAllPeriods(periods);
  }

  if (presentationDuration != null) {
    if (prevEnd != presentationDuration) {
      shaka.log.warning(
          '@mediaPresentationDuration does not match the total duration of all',
          'Periods.');
      // Assume @mediaPresentationDuration is correct.
    }
    return {
      periods: periods,
      duration: presentationDuration,
      durationDerivedFromPeriods: false
    };
  } else {
    return {
      periods: periods,
      duration: prevEnd,
      durationDerivedFromPeriods: true
    };
  }
};


/**
 * Parses a Period XML element.  Unlike the other parse methods, this is not
 * given the Node; it is given a PeriodInfo structure.  Also, partial parsing
 * was done before this was called so start and duration are valid.
 *
 * @param {shaka.dash.DashParser.Context} context
 * @param {!Array.<string>} baseUris
 * @param {shaka.dash.DashParser.PeriodInfo} periodInfo
 * @return {shakaExtern.Period}
 * @throws shaka.util.Error When there is a parsing error.
 * @private
 */
shaka.dash.DashParser.prototype.parsePeriod_ = function(
    context, baseUris, periodInfo) {
  var Functional = shaka.util.Functional;
  var XmlUtils = shaka.util.XmlUtils;
  var ContentType = shaka.util.ManifestParserUtils.ContentType;

  context.period = this.createFrame_(periodInfo.node, null, baseUris);
  context.periodInfo = periodInfo;

  // If the period doesn't have an ID, give it one based on its start time.
  if (!context.period.id) {
    shaka.log.info(
        'No Period ID given for Period with start time ' + periodInfo.start +
        ',  Assigning a default');
    context.period.id = '__shaka_period_' + periodInfo.start;
  }

  var eventStreamNodes = XmlUtils.findChildren(periodInfo.node, 'EventStream');
  eventStreamNodes.forEach(
      this.parseEventStream_.bind(this, periodInfo.start, periodInfo.duration));

  var adaptationSetNodes =
      XmlUtils.findChildren(periodInfo.node, 'AdaptationSet');
  var adaptationSets = adaptationSetNodes
      .map(this.parseAdaptationSet_.bind(this, context))
      .filter(Functional.isNotNull);

  var representationIds = adaptationSets
      .map(function(as) { return as.representationIds; })
      .reduce(Functional.collapseArrays, []);
  var uniqueRepIds = representationIds.filter(Functional.isNotDuplicate);
  if (context.dynamic && representationIds.length != uniqueRepIds.length) {
    throw new shaka.util.Error(
        shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.MANIFEST,
        shaka.util.Error.Code.DASH_DUPLICATE_REPRESENTATION_ID);
  }

  var normalAdaptationSets = adaptationSets
      .filter(function(as) { return !as.trickModeFor; });

  var trickModeAdaptationSets = adaptationSets
      .filter(function(as) { return as.trickModeFor; });

  // Attach trick mode tracks to normal tracks.
  trickModeAdaptationSets.forEach(function(trickModeSet) {
    // There may be multiple trick mode streams, but we do not currently
    // support that.  Just choose one.
    var trickModeVideo = trickModeSet.streams[0];
    var targetId = trickModeSet.trickModeFor;
    normalAdaptationSets.forEach(function(normalSet) {
      if (normalSet.id == targetId) {
        normalSet.streams.forEach(function(stream) {
          stream.trickModeVideo = trickModeVideo;
        });
      }
    });
  });

  var videoSets = this.getSetsOfType_(normalAdaptationSets, ContentType.VIDEO);
  var audioSets = this.getSetsOfType_(normalAdaptationSets, ContentType.AUDIO);

  if (!videoSets.length && !audioSets.length) {
    throw new shaka.util.Error(
        shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.MANIFEST,
        shaka.util.Error.Code.DASH_EMPTY_PERIOD);
  }

  // In case of audio-only or video-only content, we create an array of one item
  // containing a null.  This way, the double-loop works for all kinds of
  // content.
  if (!audioSets.length) {
    audioSets = [null];
  }
  if (!videoSets.length) {
    videoSets = [null];
  }

  // TODO: Limit number of combinations. Come up with a heuristic
  // to decide which audio tracks to combine with which video tracks.
  var variants = [];
  for (var i = 0; i < audioSets.length; i++) {
    for (var j = 0; j < videoSets.length; j++) {
      var audioSet = audioSets[i];
      var videoSet = videoSets[j];
      this.createVariants_(audioSet, videoSet, variants);
    }
  }

  var textSets = this.getSetsOfType_(normalAdaptationSets, ContentType.TEXT);
  var textStreams = [];
  for (var i = 0; i < textSets.length; i++) {
    textStreams.push.apply(textStreams, textSets[i].streams);
  }

  return {
    startTime: periodInfo.start,
    textStreams: textStreams,
    variants: variants
  };
};


/**
 * @param {!Array.<!shaka.dash.DashParser.AdaptationInfo>} adaptationSets
 * @param {string} type
 * @return {!Array.<!shaka.dash.DashParser.AdaptationInfo>}
 * @private
 */
shaka.dash.DashParser.prototype.getSetsOfType_ = function(
    adaptationSets, type) {
  return adaptationSets.filter(function(as) {
    return as.contentType == type;
  });
};


/**
 * Combines Streams into Variants
 *
 * @param {?shaka.dash.DashParser.AdaptationInfo} audio
 * @param {?shaka.dash.DashParser.AdaptationInfo} video
 * @param {!Array.<shakaExtern.Variant>} variants New variants are pushed onto
 *   this array.
 * @private
 */
shaka.dash.DashParser.prototype.createVariants_ =
    function(audio, video, variants) {
  var ContentType = shaka.util.ManifestParserUtils.ContentType;

  // Since both audio and video are of the same type, this assertion will catch
  // certain mistakes at runtime that the compiler would miss.
  goog.asserts.assert(!audio || audio.contentType == ContentType.AUDIO,
                      'Audio parameter mismatch!');
  goog.asserts.assert(!video || video.contentType == ContentType.VIDEO,
                      'Video parameter mismatch!');

  /** @type {number} */
  var bandwidth;
  /** @type {shakaExtern.Variant} */
  var variant;

  if (!audio && !video) {
    return;
  }

  if (audio && video) {
    // Audio+video variants
    var DrmEngine = shaka.media.DrmEngine;
    if (DrmEngine.areDrmCompatible(audio.drmInfos, video.drmInfos)) {
      var drmInfos = DrmEngine.getCommonDrmInfos(audio.drmInfos,
                                                 video.drmInfos);

      for (var i = 0; i < audio.streams.length; i++) {
        for (var j = 0; j < video.streams.length; j++) {
          bandwidth =
              (video.streams[j].bandwidth || 0) +
              (audio.streams[i].bandwidth || 0);
          variant = {
            id: this.globalId_++,
            language: audio.language,
            primary: audio.main || video.main,
            audio: audio.streams[i],
            video: video.streams[j],
            bandwidth: bandwidth,
            drmInfos: drmInfos,
            allowedByApplication: true,
            allowedByKeySystem: true
          };

          variants.push(variant);
        }
      }
    }
  } else {
    // Audio or video only variants
    var set = audio || video;
    for (var i = 0; i < set.streams.length; i++) {
      bandwidth = set.streams[i].bandwidth || 0;
      variant = {
        id: this.globalId_++,
        language: set.language || 'und',
        primary: set.main,
        audio: audio ? set.streams[i] : null,
        video: video ? set.streams[i] : null,
        bandwidth: bandwidth,
        drmInfos: set.drmInfos,
        allowedByApplication: true,
        allowedByKeySystem: true
      };

      variants.push(variant);
    }
  }
};


/**
 * Parses an AdaptationSet XML element.
 *
 * @param {shaka.dash.DashParser.Context} context
 * @param {!Element} elem The AdaptationSet element.
 * @return {?shaka.dash.DashParser.AdaptationInfo}
 * @throws shaka.util.Error When there is a parsing error.
 * @private
 */
shaka.dash.DashParser.prototype.parseAdaptationSet_ = function(context, elem) {
  var XmlUtils = shaka.util.XmlUtils;
  var Functional = shaka.util.Functional;
  var ManifestParserUtils = shaka.util.ManifestParserUtils;
  var ContentType = ManifestParserUtils.ContentType;

  context.adaptationSet = this.createFrame_(elem, context.period, null);

  var main = false;
  var roleElements = XmlUtils.findChildren(elem, 'Role');
  var roleValues = roleElements.map(function(role) {
    return role.getAttribute('value');
  }).filter(Functional.isNotNull);

  // Default kind for text streams is 'subtitle' if unspecified in the manifest.
  var kind = undefined;
  if (context.adaptationSet.contentType == ManifestParserUtils.ContentType.TEXT)
    kind = ManifestParserUtils.TextStreamKind.SUBTITLE;

  for (var i = 0; i < roleElements.length; i++) {
    var scheme = roleElements[i].getAttribute('schemeIdUri');
    if (scheme == null || scheme == 'urn:mpeg:dash:role:2011') {
      // These only apply for the given scheme, but allow them to be specified
      // if there is no scheme specified.
      // See: DASH section 5.8.5.5
      var value = roleElements[i].getAttribute('value');
      switch (value) {
        case 'main':
          main = true;
          break;
        case 'caption':
        case 'subtitle':
          kind = value;
          break;
      }
    }
  }

  var essentialProperties = XmlUtils.findChildren(elem, 'EssentialProperty');
  // ID of real AdaptationSet if this is a trick mode set:
  var trickModeFor = null;
  var unrecognizedEssentialProperty = false;
  essentialProperties.forEach(function(prop) {
    var schemeId = prop.getAttribute('schemeIdUri');
    if (schemeId == 'http://dashif.org/guidelines/trickmode') {
      trickModeFor = prop.getAttribute('value');
    } else {
      unrecognizedEssentialProperty = true;
    }
  });

  // According to DASH spec (2014) section 5.8.4.8, "the successful processing
  // of the descriptor is essential to properly use the information in the
  // parent element".  According to DASH IOP v3.3, section 3.3.4, "if the scheme
  // or the value" for EssentialProperty is not recognized, "the DASH client
  // shall ignore the parent element."
  if (unrecognizedEssentialProperty) {
    // Stop parsing this AdaptationSet and let the caller filter out the nulls.
    return null;
  }

  var contentProtectionElems = XmlUtils.findChildren(elem, 'ContentProtection');
  var contentProtection = shaka.dash.ContentProtection.parseFromAdaptationSet(
      contentProtectionElems, this.config_.dash.customScheme,
      this.config_.dash.ignoreDrmInfo);

  var language =
      shaka.util.LanguageUtils.normalize(elem.getAttribute('lang') || 'und');

  // non-standard attribute(yet) supported by Kaltura
  var label = elem.getAttribute('label');

  // Parse Representations into Streams.
  var representations = XmlUtils.findChildren(elem, 'Representation');
  var streams = representations
      .map(this.parseRepresentation_.bind(this, context, contentProtection,
          kind, language, label, main, roleValues))
      .filter(function(s) { return !!s; });

  if (streams.length == 0) {
    throw new shaka.util.Error(
        shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.MANIFEST,
        shaka.util.Error.Code.DASH_EMPTY_ADAPTATION_SET);
  }

  // If AdaptationSet's type is unknown or is ambiguously "application",
  // guess based on the information in the first stream.  If the attributes
  // mimeType and codecs are split across levels, they will both be inherited
  // down to the stream level by this point, so the stream will have all the
  // necessary information.
  if (!context.adaptationSet.contentType ||
      context.adaptationSet.contentType == ContentType.APPLICATION) {
    var mimeType = streams[0].mimeType;
    var codecs = streams[0].codecs;
    context.adaptationSet.contentType =
        shaka.dash.DashParser.guessContentType_(mimeType, codecs);

    streams.forEach(function(stream) {
      stream.type = context.adaptationSet.contentType;
    });
  }

  streams.forEach(function(stream) {
    // Some DRM license providers require that we have a default
    // key ID from the manifest in the wrapped license request.
    // Thus, it should be put in drmInfo to be accessible to request filters.
    contentProtection.drmInfos.forEach(function(drmInfo) {
      if (stream.keyId) {
        drmInfo.keyIds.push(stream.keyId);
      }
    });
  });

  var repIds = representations
      .map(function(node) { return node.getAttribute('id'); })
      .filter(shaka.util.Functional.isNotNull);

  return {
    id: context.adaptationSet.id || ('__fake__' + this.globalId_++),
    contentType: context.adaptationSet.contentType,
    language: language,
    main: main,
    streams: streams,
    drmInfos: contentProtection.drmInfos,
    trickModeFor: trickModeFor,
    representationIds: repIds
  };
};


/**
 * Parses a Representation XML element.
 *
 * @param {shaka.dash.DashParser.Context} context
 * @param {shaka.dash.ContentProtection.Context} contentProtection
 * @param {(string|undefined)} kind
 * @param {string} language
 * @param {string} label
 * @param {boolean} isPrimary
 * @param {!Array.<string>} roles
 * @param {!Element} node
 * @return {?shakaExtern.Stream} The Stream, or null when there is a
 *   non-critical parsing error.
 * @throws shaka.util.Error When there is a parsing error.
 * @private
 */
shaka.dash.DashParser.prototype.parseRepresentation_ = function(
    context, contentProtection, kind, language, label, isPrimary, roles, node) {
  var XmlUtils = shaka.util.XmlUtils;
  var ContentType = shaka.util.ManifestParserUtils.ContentType;

  context.representation = this.createFrame_(node, context.adaptationSet, null);
  if (!this.verifyRepresentation_(context.representation)) {
    shaka.log.warning('Skipping Representation', context.representation);
    return null;
  }

  // NOTE: bandwidth is a mandatory attribute according to the spec, and zero
  // does not make sense in the DASH spec's bandwidth formulas.
  // In some content, however, the attribute is missing or zero.
  // To avoid NaN at the variant level on broken content, fall back to zero.
  // https://github.com/google/shaka-player/issues/938#issuecomment-317278180
  context.bandwidth =
      XmlUtils.parseAttr(node, 'bandwidth', XmlUtils.parsePositiveInt) || 0;

  /** @type {?shaka.dash.DashParser.StreamInfo} */
  var streamInfo;
  var requestInitSegment = this.requestInitSegment_.bind(this);
  if (context.representation.segmentBase) {
    streamInfo = shaka.dash.SegmentBase.createStream(
        context, requestInitSegment);
  } else if (context.representation.segmentList) {
    streamInfo = shaka.dash.SegmentList.createStream(
        context, this.segmentIndexMap_);
  } else if (context.representation.segmentTemplate) {
    streamInfo = shaka.dash.SegmentTemplate.createStream(
        context, requestInitSegment, this.segmentIndexMap_, !!this.manifest_);
  } else {
    goog.asserts.assert(
        context.representation.contentType == ContentType.TEXT ||
        context.representation.contentType == ContentType.APPLICATION,
        'Must have Segment* with non-text streams.');

    var baseUris = context.representation.baseUris;
    var duration = context.periodInfo.duration || 0;
    streamInfo = {
      createSegmentIndex: Promise.resolve.bind(Promise),
      findSegmentPosition:
          /** @return {?number} */ function(/** number */ time) {
            if (time >= 0 && time < duration)
              return 1;
            else
              return null;
          },
      getSegmentReference:
          /** @return {shaka.media.SegmentReference} */
          function(/** number */ ref) {
            if (ref != 1)
              return null;

            return new shaka.media.SegmentReference(
                1, 0, duration, function() { return baseUris; }, 0, null);
          },
      initSegmentReference: null,
      scaledPresentationTimeOffset: 0
    };
  }

  var contentProtectionElems = XmlUtils.findChildren(node, 'ContentProtection');
  var keyId = shaka.dash.ContentProtection.parseFromRepresentation(
      contentProtectionElems, this.config_.dash.customScheme,
      contentProtection, this.config_.dash.ignoreDrmInfo);

  return {
    id: this.globalId_++,
    createSegmentIndex: streamInfo.createSegmentIndex,
    findSegmentPosition: streamInfo.findSegmentPosition,
    getSegmentReference: streamInfo.getSegmentReference,
    initSegmentReference: streamInfo.initSegmentReference,
    presentationTimeOffset: streamInfo.scaledPresentationTimeOffset,
    mimeType: context.representation.mimeType,
    codecs: context.representation.codecs,
    frameRate: context.representation.frameRate,
    bandwidth: context.bandwidth,
    width: context.representation.width,
    height: context.representation.height,
    kind: kind,
    encrypted: contentProtection.drmInfos.length > 0,
    keyId: keyId,
    language: language,
    label: label,
    type: context.adaptationSet.contentType,
    primary: isPrimary,
    trickModeVideo: null,
    containsEmsgBoxes: context.representation.containsEmsgBoxes,
    roles: roles,
    channelsCount: context.representation.numChannels
  };
};


/**
 * Called when the update timer ticks.
 *
 * @private
 */
shaka.dash.DashParser.prototype.onUpdate_ = function() {
  goog.asserts.assert(this.updateTimer_, 'Should only be called by timer');
  goog.asserts.assert(this.updatePeriod_ >= 0,
                      'There should be an update period');

  shaka.log.info('Updating manifest...');

  this.updateTimer_ = null;

  this.requestManifest_().then(function(updateDuration) {
    // Detect a call to stop()
    if (!this.playerInterface_)
      return;

    // Ensure the next update occurs within |updatePeriod_| seconds by taking
    // into account the time it took to update the manifest.
    this.setUpdateTimer_(updateDuration);
  }.bind(this)).catch(function(error) {
    goog.asserts.assert(error instanceof shaka.util.Error,
                        'Should only receive a Shaka error');

    // Try updating again, but ensure we haven't been destroyed.
    if (this.playerInterface_) {
      // We will retry updating, so override the severity of the error.
      error.severity = shaka.util.Error.Severity.RECOVERABLE;
      this.playerInterface_.onError(error);

      this.setUpdateTimer_(0);
    }
  }.bind(this));
};


/**
 * Sets the update timer.  Does nothing if the manifest does not specify an
 * update period.
 *
 * @param {number} offset An offset, in seconds, to apply to the manifest's
 *   update period.
 * @private
 */
shaka.dash.DashParser.prototype.setUpdateTimer_ = function(offset) {
  // NOTE: An updatePeriod_ of -1 means the attribute was missing.
  // An attribute which is present and set to 0 should still result in periodic
  // updates. For more, see: https://github.com/google/shaka-player/issues/331
  if (this.updatePeriod_ < 0)
    return;
  goog.asserts.assert(this.updateTimer_ == null,
                      'Timer should not be already set');

  let period = Math.max(
      shaka.dash.DashParser.MIN_UPDATE_PERIOD_,
      this.updatePeriod_ - offset,
      this.averageUpdateDuration_.getEstimate());
  shaka.log.debug('actual update period', period);

  let callback = this.onUpdate_.bind(this);
  this.updateTimer_ = window.setTimeout(callback, 1000 * period);
};


/**
 * Creates a new inheritance frame for the given element.
 *
 * @param {!Element} elem
 * @param {?shaka.dash.DashParser.InheritanceFrame} parent
 * @param {Array.<string>} baseUris
 * @return {shaka.dash.DashParser.InheritanceFrame}
 * @private
 */
shaka.dash.DashParser.prototype.createFrame_ = function(
    elem, parent, baseUris) {
  goog.asserts.assert(parent || baseUris,
                      'Must provide either parent or baseUris');
  var ManifestParserUtils = shaka.util.ManifestParserUtils;
  var XmlUtils = shaka.util.XmlUtils;
  parent = parent || /** @type {shaka.dash.DashParser.InheritanceFrame} */ ({
    contentType: '',
    mimeType: '',
    codecs: '',
    containsEmsgBoxes: false,
    frameRate: undefined,
    numChannels: null
  });
  baseUris = baseUris || parent.baseUris;

  var parseNumber = XmlUtils.parseNonNegativeInt;
  var evalDivision = XmlUtils.evalDivision;
  var uris = XmlUtils.findChildren(elem, 'BaseURL').map(XmlUtils.getContents);

  var contentType = elem.getAttribute('contentType') || parent.contentType;
  var mimeType = elem.getAttribute('mimeType') || parent.mimeType;
  var codecs = elem.getAttribute('codecs') || parent.codecs;
  var frameRate =
      XmlUtils.parseAttr(elem, 'frameRate', evalDivision) || parent.frameRate;
  var containsEmsgBoxes =
      !!XmlUtils.findChildren(elem, 'InbandEventStream').length;
  var audioChannelConfigs =
      XmlUtils.findChildren(elem, 'AudioChannelConfiguration');
  var numChannels =
      this.parseAudioChannels_(audioChannelConfigs) || parent.numChannels;

  if (!contentType) {
    contentType = shaka.dash.DashParser.guessContentType_(mimeType, codecs);
  }

  return {
    baseUris: ManifestParserUtils.resolveUris(baseUris, uris),
    segmentBase: XmlUtils.findChild(elem, 'SegmentBase') || parent.segmentBase,
    segmentList: XmlUtils.findChild(elem, 'SegmentList') || parent.segmentList,
    segmentTemplate:
        XmlUtils.findChild(elem, 'SegmentTemplate') || parent.segmentTemplate,
    width: XmlUtils.parseAttr(elem, 'width', parseNumber) || parent.width,
    height: XmlUtils.parseAttr(elem, 'height', parseNumber) || parent.height,
    contentType: contentType,
    mimeType: mimeType,
    codecs: codecs,
    frameRate: frameRate,
    containsEmsgBoxes: containsEmsgBoxes || parent.containsEmsgBoxes,
    id: elem.getAttribute('id'),
    numChannels: numChannels
  };
};


/**
 * @param {!Array.<!Element>} audioChannelConfigs an array of
 *   AudioChannelConfiguration elements
 * @return {?number} the number of audio channels, or null if unknown
 * @private
 */
shaka.dash.DashParser.prototype.parseAudioChannels_ =
    function(audioChannelConfigs) {
  for (var i = 0; i < audioChannelConfigs.length; ++i) {
    var elem = audioChannelConfigs[i];

    var scheme = elem.getAttribute('schemeIdUri');
    if (!scheme) continue;

    var value = elem.getAttribute('value');
    if (!value) continue;

    switch (scheme) {
      case 'urn:mpeg:dash:outputChannelPositionList:2012':
        // A space-separated list of speaker positions, so num channels is the
        // length of this list.
        return value.trim().split(/ +/).length;

      case 'urn:mpeg:dash:23003:3:audio_channel_configuration:2011':
      case 'urn:dts:dash:audio_channel_configuration:2012': {
        // As far as we can tell, this is a number of channels.
        var intValue = parseInt(value, 10);
        if (!intValue) {  // 0 or NaN
          shaka.log.warning('Channel parsing failure! ' +
                            'Ignoring scheme and value', scheme, value);
          continue;
        }
        return intValue;
      }

      case 'tag:dolby.com,2014:dash:audio_channel_configuration:2011':
      case 'urn:dolby:dash:audio_channel_configuration:2011': {
        // A hex-encoded 16-bit integer, in which each bit represents a channel.
        var hexValue = parseInt(value, 16);
        if (!hexValue) {  // 0 or NaN
          shaka.log.warning('Channel parsing failure! ' +
                            'Ignoring scheme and value', scheme, value);
          continue;
        }
        // Count the 1-bits in hexValue.
        var numBits = 0;
        while (hexValue) {
          if (hexValue & 1) ++numBits;
          hexValue >>= 1;
        }
        return numBits;
      }

      default:
        shaka.log.warning('Unrecognized audio channel scheme:', scheme, value);
        continue;
    }
  }

  return null;
};


/**
 * Verifies that a Representation has exactly one Segment* element.  Prints
 * warnings if there is a problem.
 *
 * @param {shaka.dash.DashParser.InheritanceFrame} frame
 * @return {boolean} True if the Representation is usable; otherwise return
 *   false.
 * @private
 */
shaka.dash.DashParser.prototype.verifyRepresentation_ = function(frame) {
  var ContentType = shaka.util.ManifestParserUtils.ContentType;

  var n = 0;
  n += frame.segmentBase ? 1 : 0;
  n += frame.segmentList ? 1 : 0;
  n += frame.segmentTemplate ? 1 : 0;

  if (n == 0) {
    // TODO: extend with the list of MIME types registered to TextEngine.
    if (frame.contentType == ContentType.TEXT ||
        frame.contentType == ContentType.APPLICATION) {
      return true;
    } else {
      shaka.log.warning(
          'Representation does not contain a segment information source:',
          'the Representation must contain one of SegmentBase, SegmentList,',
          'SegmentTemplate, or explicitly indicate that it is "text".',
          frame);
      return false;
    }
  }

  if (n != 1) {
    shaka.log.warning(
        'Representation contains multiple segment information sources:',
        'the Representation should only contain one of SegmentBase,',
        'SegmentList, or SegmentTemplate.',
        frame);
    if (frame.segmentBase) {
      shaka.log.info('Using SegmentBase by default.');
      frame.segmentList = null;
      frame.segmentTemplate = null;
    } else {
      goog.asserts.assert(frame.segmentList, 'There should be a SegmentList');
      shaka.log.info('Using SegmentList by default.');
      frame.segmentTemplate = null;
    }
  }

  return true;
};


/**
 * Makes a request to the given URI and calculates the clock offset.
 *
 * @param {!Array.<string>} baseUris
 * @param {string} uri
 * @param {string} method
 * @return {!Promise.<number>}
 * @private
 */
shaka.dash.DashParser.prototype.requestForTiming_ =
    function(baseUris, uri, method) {
  var requestUris = shaka.util.ManifestParserUtils.resolveUris(baseUris, [uri]);
  var request = shaka.net.NetworkingEngine.makeRequest(
      requestUris, this.config_.retryParameters);
  request.method = method;
  var type = shaka.net.NetworkingEngine.RequestType.MANIFEST;
  return this.playerInterface_.networkingEngine.request(type, request)
      .then(function(response) {
        var text;
        if (method == 'HEAD') {
          if (!response.headers || !response.headers['date']) {
            shaka.log.warning('UTC timing response is missing',
                              'expected date header');
            return 0;
          }

          text = response.headers['date'];
        } else {
          text = shaka.util.StringUtils.fromUTF8(response.data);
        }

        var date = Date.parse(text);
        if (isNaN(date)) {
          shaka.log.warning('Unable to parse date from UTC timing response');
          return 0;
        }
        return (date - Date.now());
      });
};


/**
 * Parses an array of UTCTiming elements.
 *
 * @param {!Array.<string>} baseUris
 * @param {!Array.<!Element>} elems
 * @param {boolean} isLive
 * @return {!Promise.<number>}
 * @private
 */
shaka.dash.DashParser.prototype.parseUtcTiming_ =
    function(baseUris, elems, isLive) {
  var schemesAndValues = elems.map(function(elem) {
    return {
      scheme: elem.getAttribute('schemeIdUri'),
      value: elem.getAttribute('value')
    };
  });

  // If there's nothing specified in the manifest, but we have a default from
  // the config, use that.
  var clockSyncUri = this.config_.dash.clockSyncUri;
  if (isLive && !schemesAndValues.length && clockSyncUri) {
    schemesAndValues.push({
      scheme: 'urn:mpeg:dash:utc:http-head:2014',
      value: clockSyncUri
    });
  }

  var Functional = shaka.util.Functional;
  return Functional.createFallbackPromiseChain(schemesAndValues, function(sv) {
    var scheme = sv.scheme;
    var value = sv.value;
    switch (scheme) {
      // See DASH IOP Guidelines Section 4.7
      // http://goo.gl/CQFNJT
      // Some old ISO23009-1 drafts used 2012.
      case 'urn:mpeg:dash:utc:http-head:2014':
      case 'urn:mpeg:dash:utc:http-head:2012':
        return this.requestForTiming_(baseUris, value, 'HEAD');
      case 'urn:mpeg:dash:utc:http-xsdate:2014':
      case 'urn:mpeg:dash:utc:http-iso:2014':
      case 'urn:mpeg:dash:utc:http-xsdate:2012':
      case 'urn:mpeg:dash:utc:http-iso:2012':
        return this.requestForTiming_(baseUris, value, 'GET');
      case 'urn:mpeg:dash:utc:direct:2014':
      case 'urn:mpeg:dash:utc:direct:2012': {
        var date = Date.parse(value);
        return isNaN(date) ? 0 : (date - Date.now());
      }

      case 'urn:mpeg:dash:utc:http-ntp:2014':
      case 'urn:mpeg:dash:utc:ntp:2014':
      case 'urn:mpeg:dash:utc:sntp:2014':
        shaka.log.warning('NTP UTCTiming scheme is not supported');
        return Promise.reject();
      default:
        shaka.log.warning(
            'Unrecognized scheme in UTCTiming element', scheme);
        return Promise.reject();
    }
  }.bind(this)).catch(function() {
    if (isLive) {
      shaka.log.warning(
          'A UTCTiming element should always be given in live manifests! ' +
          'This content may not play on clients with bad clocks!');
    }
    return 0;
  });
};


/**
 * Parses an EventStream element.
 *
 * @param {number} periodStart
 * @param {?number} periodDuration
 * @param {!Element} elem
 * @private
 */
shaka.dash.DashParser.prototype.parseEventStream_ = function(
    periodStart, periodDuration, elem) {
  var XmlUtils = shaka.util.XmlUtils;
  var parseNumber = XmlUtils.parseNonNegativeInt;

  var schemeIdUri = elem.getAttribute('schemeIdUri') || '';
  var value = elem.getAttribute('value') || '';
  var timescale = XmlUtils.parseAttr(elem, 'timescale', parseNumber) || 1;

  XmlUtils.findChildren(elem, 'Event').forEach(function(eventNode) {
    var presentationTime =
        XmlUtils.parseAttr(eventNode, 'presentationTime', parseNumber) || 0;
    var duration = XmlUtils.parseAttr(eventNode, 'duration', parseNumber) || 0;

    var startTime = presentationTime / timescale + periodStart;
    var endTime = startTime + (duration / timescale);
    if (periodDuration != null) {
      // An event should not go past the Period, even if the manifest says so.
      // See: Dash sec. 5.10.2.1
      startTime = Math.min(startTime, periodStart + periodDuration);
      endTime = Math.min(endTime, periodStart + periodDuration);
    }

    /** @type {shakaExtern.TimelineRegionInfo} */
    var region = {
      schemeIdUri: schemeIdUri,
      value: value,
      startTime: startTime,
      endTime: endTime,
      id: eventNode.getAttribute('id') || '',
      eventElement: eventNode
    };

    this.playerInterface_.onTimelineRegionAdded(region);
  }.bind(this));
};


/**
 * Makes a network request on behalf of SegmentBase.createStream.
 *
 * @param {!Array.<string>} uris
 * @param {?number} startByte
 * @param {?number} endByte
 * @return {!Promise.<!ArrayBuffer>}
 * @private
 */
shaka.dash.DashParser.prototype.requestInitSegment_ = function(
    uris, startByte, endByte) {
  var requestType = shaka.net.NetworkingEngine.RequestType.SEGMENT;
  var request = shaka.net.NetworkingEngine.makeRequest(
      uris, this.config_.retryParameters);
  if (startByte != null) {
    var end = (endByte != null ? endByte : '');
    request.headers['Range'] = 'bytes=' + startByte + '-' + end;
  }

  return this.playerInterface_.networkingEngine.request(requestType, request)
      .then(function(response) { return response.data; });
};


/**
 * Guess the content type based on MIME type and codecs.
 *
 * @param {string} mimeType
 * @param {string} codecs
 * @return {string}
 * @private
 */
shaka.dash.DashParser.guessContentType_ = function(mimeType, codecs) {
  var fullMimeType = shaka.util.MimeUtils.getFullType(mimeType, codecs);

  if (shaka.text.TextEngine.isTypeSupported(fullMimeType)) {
    // If it's supported by TextEngine, it's definitely text.
    // We don't check MediaSourceEngine, because that would report support
    // for platform-supported video and audio types as well.
    return shaka.util.ManifestParserUtils.ContentType.TEXT;
  }

  // Otherwise, just split the MIME type.  This handles video and audio
  // types well.
  return mimeType.split('/')[0];
};


shaka.media.ManifestParser.registerParserByExtension(
    'mpd', shaka.dash.DashParser);
shaka.media.ManifestParser.registerParserByMime(
    'application/dash+xml', shaka.dash.DashParser);

