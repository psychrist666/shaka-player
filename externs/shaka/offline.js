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
 *   basic: boolean,
 *   encrypted: !Object.<string, boolean>
 * }}
 *
 * @property {boolean} basic
 *   True if offline is usable at all.
 * @property {!Object.<string, boolean>} encrypted
 *   A map of key system name to whether it supports offline playback.
 * @exportDoc
 */
shakaExtern.OfflineSupport;


/**
 * @typedef {{
 *   trackSelectionCallback:
 *       function(!Array.<shakaExtern.Track>):!Array.<shakaExtern.Track>,
 *   progressCallback: function(shakaExtern.StoredContent,number),
 *   usePersistentLicense: boolean
 * }}
 *
 * @property {function(!Array.<shakaExtern.Track>):!Array.<shakaExtern.Track>}
 *     trackSelectionCallback
 *   Called inside store() to determine which tracks to save from a manifest.
 *   It is passed an array of Tracks from the manifest and it should return
 *   an array of the tracks to store.  This is called for each Period in the
 *   manifest (in order).
 * @property {function(shakaExtern.StoredContent,number)} progressCallback
 *   Called inside store() to give progress info back to the app.  It is given
 *   the current manifest being stored and the progress of it being stored.
 * @property {boolean} usePersistentLicense
 *   If true, store protected content with a persistent license so that no
 *   network is required to view.
 *   If false, store protected content without a persistent license.  A network
 *   will be required to retrieve a temporary license to view.
 *   Defaults to true.
 * @exportDoc
 */
shakaExtern.OfflineConfiguration;


/**
 * @typedef {{
 *   offlineUri: ?string,
 *   originalManifestUri: string,
 *   duration: number,
 *   size: number,
 *   expiration: number,
 *   tracks: !Array.<shakaExtern.Track>,
 *   appMetadata: Object
 * }}
 *
 * @property {?string} offlineUri
 *   An offline URI to access the content. This can be passed directly to
 *   Player. If the uri is null, it means that the content has not finished
 *   downloading and is not ready to play.
 * @property {string} originalManifestUri
 *   The original manifest URI of the content stored.
 * @property {number} duration
 *   The duration of the content, in seconds.
 * @property {number} size
 *   The size of the content, in bytes.
 * @property {number} expiration
 *   The time that the encrypted license expires, in milliseconds.  If the media
 *   is clear or the license never expires, this will equal Infinity.
 * @property {!Array.<shakaExtern.Track>} tracks
 *   The tracks that are stored.  This only lists those found in the first
 *   Period.
 * @property {Object} appMetadata
 *   The metadata passed to store().
 * @exportDoc
 */
shakaExtern.StoredContent;


/**
 * @typedef {{
 *   originalManifestUri: string,
 *   duration: number,
 *   size: number,
 *   expiration: number,
 *   periods: !Array.<shakaExtern.PeriodDB>,
 *   sessionIds: !Array.<string>,
 *   drmInfo: ?shakaExtern.DrmInfo,
 *   appMetadata: Object
 * }}
 *
 * @property {string} originalManifestUri
 *   The URI that the manifest was originally loaded from.
 * @property {number} duration
 *   The total duration of the media, in seconds.
 * @property {number} size
 *   The total size of all stored segments, in bytes.
 * @property {number} expiration
 *   The license expiration, in milliseconds; or Infinity if not applicable.
 * @property {!Array.<shakaExtern.PeriodDB>} periods
 *   The Periods that are stored.
 * @property {!Array.<string>} sessionIds
 *   The DRM offline session IDs for the media.
 * @property {?shakaExtern.DrmInfo} drmInfo
 *   The DRM info used to initialize EME.
 * @property {Object} appMetadata
 *   A metadata object passed from the application.
 */
shakaExtern.ManifestDB;


/**
 * @typedef {{
 *   startTime: number,
 *   streams: !Array.<shakaExtern.StreamDB>
 * }}
 *
 * @property {number} startTime
 *   The start time of the period, in seconds.
 * @property {!Array.<shakaExtern.StreamDB>} streams
 *   The streams that define the Period.
 */
shakaExtern.PeriodDB;


/**
 * @typedef {{
 *   id: number,
 *   primary: boolean,
 *   presentationTimeOffset: number,
 *   contentType: string,
 *   mimeType: string,
 *   codecs: string,
 *   frameRate: (number|undefined),
 *   kind: (string|undefined),
 *   language: string,
 *   label: ?string,
 *   width: ?number,
 *   height: ?number,
 *   initSegmentKey: ?number,
 *   encrypted: boolean,
 *   keyId: ?string,
 *   segments: !Array.<shakaExtern.SegmentDB>,
 *   variantIds: !Array.<number>
 * }}
 *
 * @property {number} id
 *   The unique id of the stream.
 * @property {boolean} primary
 *   Whether the stream set was primary.
 * @property {number} presentationTimeOffset
 *   The presentation time offset of the stream, in seconds.
 * @property {string} contentType
 *   The type of the stream, 'audio', 'text', or 'video'.
 * @property {string} mimeType
 *   The MIME type of the stream.
 * @property {string} codecs
 *   The codecs of the stream.
 * @property {(number|undefined)} frameRate
 *   The Stream's framerate in frames per second
 * @property {(string|undefined)} kind
 *   The kind of text stream; undefined for audio/video.
 * @property {string} language
 *   The language of the stream; '' for video.
 * @property {?string} label
 *   The label of the stream; '' for video.
 * @property {?number} width
 *   The width of the stream; null for audio/text.
 * @property {?number} height
 *   The height of the stream; null for audio/text.
 * @property  {?number} initSegmentKey
 *   The storage key where the init segment is found; null if no init segment.
 * @property {boolean} encrypted
 *   Whether this stream is encrypted.
 * @property {?string} keyId
 *   The key ID this stream is encrypted with.
 * @property {!Array.<shakaExtern.SegmentDB>} segments
 *   An array of segments that make up the stream
 * @property {!Array.<number>} variantIds
 *   An array of ids of variants the stream is a part of.
 */
shakaExtern.StreamDB;


/**
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   dataKey: number
 * }}
 *
 * @property {number} startTime
 *   The start time of the segment, in seconds from the start of the Period.
 * @property {number} endTime
 *   The end time of the segment, in seconds from the start of the Period.
 * @property {number} dataKey
 *   The key to the data in storage.
 */
shakaExtern.SegmentDB;


/**
 * @typedef {{
 *   data: !ArrayBuffer
 * }}
 *
 * @property {!ArrayBuffer} data
 *   The data contents of the segment.
 */
shakaExtern.SegmentDataDB;


/**
 * An interface that defines access to collection of segments and manifests. All
 * methods are designed to be batched operations allowing the implementations to
 * optimize their operations based on how they store data.
 *
 * The storage cell is one of two exposed APIs used to control where and how
 * offline content is saved. The storage cell is responsible for converting
 * information between its internal structures and the external (library)
 * structures.
 *
 * @interface
 */
shakaExtern.StorageCell = function() {};


/**
 * Free all resources used by this cell. This should not affect the stored
 * content.
 *
 * @return {!Promise}
 */
shakaExtern.StorageCell.prototype.destroy = function() {};


/**
 * Check if the cell can support new keys. If a cell has a fixed key space,
 * then all add-operations will fail as no new keys can be added. All
 * remove-operations and update-operations should still work.
 *
 * @return {boolean}
 */
shakaExtern.StorageCell.prototype.hasFixedKeySpace = function() {};


/**
 * Add a group of segments. Will return a promise that resolves with a list
 * of keys for each segment. If one segment fails to be added, all segments
 * should fail to be added.
 *
 * @param {!Array.<shakaExtern.SegmentDataDB>} segments
 * @return {!Promise.<!Array.<number>>}
 */
shakaExtern.StorageCell.prototype.addSegments = function(segments) {};


/**
 * Remove a group of segments using their keys to identify them. If a key
 * is not found, then that removal should be considered successful.
 *
 * @param {!Array.<number>} keys
 * @param {function(number)} onRemove A callback for when a segment is removed
 *                                    from the cell. The key of the segment
 *                                    will be passed to the callback.
 * @return {!Promise}
 */
shakaExtern.StorageCell.prototype.removeSegments = function(keys, onRemove) {};


/**
 * Get a group of segments using their keys to identify them. If any key is
 * not found, the promise chain will be rejected.
 *
 * @param {!Array.<number>} keys
 * @return {!Promise.<!Array.<shakaExtern.SegmentDataDB>>}
 */
shakaExtern.StorageCell.prototype.getSegments = function(keys) {};


/**
 * Add a group of manifests. Will return a promise that resolves with a list
 * of keys for each manifest. If one manifest fails to be added, all manifests
 * should fail to be added.
 *
 * @param {!Array.<shakaExtern.ManifestDB>} manifests
 * @return {!Promise<!Array.<number>>} keys
 */
shakaExtern.StorageCell.prototype.addManifests = function(manifests) {};


/**
 * Replace the expiration time of the manifest stored under |key| with
 * |newExpiration|. If no manifest is found under |key| then this should
 * act as a no-op.
 *
 * @param {number} key
 * @param {number} expiration
 * @return {!Promise}
 */
shakaExtern.StorageCell.prototype.updateManifestExpiration =
    function(key, expiration) {};


/**
 * Remove a group of manifests using their keys to identify them. If a key
 * is not found, then that removal should be considered successful.
 *
 * @param {!Array.<number>} keys
 * @param {function(number)} onRemove A callback for when a manifest is removed
 *                                    from the cell. The key of the manifest
 *                                    will be passed to the callback.
 * @return {!Promise}
 */
shakaExtern.StorageCell.prototype.removeManifests =
    function(keys, onRemove) {};


/**
 * Get a group of manifests using their keys to identify them. If any key is
 * not found, the promise chain will be rejected.
 *
 * @param {!Array.<number>} keys
 * @return {!Promise<!Array.<shakaExtern.ManifestDB>>}
 */
shakaExtern.StorageCell.prototype.getManifests = function(keys) {};


/**
 * Get all manifests stored in this cell. Since manifests are small compared to
 * the asset they describe, it is assumed that it is feasible to have them all
 * in main memory at one time.
 *
 * @return {!Promise<!Object.<number, shakaExtern.ManifestDB>>}
 */
shakaExtern.StorageCell.prototype.getAllManifests = function() {};


/**
 * Storage mechanisms are one of two exported storage APIs. Storage mechanisms
 * are groups of storage cells (shakaExtern.StorageCell). Storage mechanisms
 * are responsible for managing the life cycle of resources shared between
 * storage cells in the same block.
 *
 * For example, a storage mechanism may manage a single database connection
 * while each cell would manage different tables in the database via the same
 * connection.
 *
 * @interface
 */
shakaExtern.StorageMechanism = function() {};


/**
 * Initialize the storage mechanism for first use. This should only be called
 * once. Calling |init| multiple times has an undefined behaviour.
 *
 * @return {!Promise}
 */
shakaExtern.StorageMechanism.prototype.init = function() {};


/**
 * Free all resources used by the storage mechanism and its cells. This should
 * not affect the stored content.
 *
 * @return {!Promise}
 */
shakaExtern.StorageMechanism.prototype.destroy = function() {};


/**
 * Get a map of all the cells managed by the storage mechanism. Editing the map
 * should have no effect on the storage mechanism. The map key is the cell's
 * address in the mechanism and should be consistent between calls to
 * |getCells|.
 *
 * @return {!Object.<string, !shakaExtern.StorageCell>}
 */
shakaExtern.StorageMechanism.prototype.getCells = function() {};


/**
 * Erase all content from storage and leave storage in an empty state. It is
 * expected that |erase| will be called after |init| and will still be
 * initialized for use after calling |erase|.
 *
 * @return {!Promise}
 */
shakaExtern.StorageMechanism.prototype.erase = function() {};
