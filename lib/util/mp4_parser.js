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

goog.provide('shaka.util.Mp4Parser');

goog.require('goog.asserts');
goog.require('shaka.log');
goog.require('shaka.util.DataViewReader');



/**
 * Create a new MP4 Parser
 * @struct
 * @constructor
 * @export
 */
shaka.util.Mp4Parser = function() {
  /** @private {!Object.<number, shaka.util.Mp4Parser.BoxType_>} */
  this.headers_ = [];

  /** @private {!Object.<number, !shaka.util.Mp4Parser.CallbackType>} */
  this.boxDefinitions_ = [];

  /** @private {boolean} */
  this.done_ = false;
};


/**
 * @typedef {{
 *    parser: !shaka.util.Mp4Parser,
 *    partialOkay: boolean,
 *    start: number,
 *    size: number,
 *    version: ?number,
 *    flags: ?number,
 *    reader: !shaka.util.DataViewReader
 * }}
 *
 * @property {!shaka.util.Mp4Parser} parser
 *   The parser that parsed this box. The parser can be used to parse child
 *   boxes where the configuration of the current parser is needed to parsed
 *   other boxes.
 * @property {boolean} partialOkay
 *   If true, allow partial payload for some boxes. If the goal is a child box,
 *   we can sometimes find it without enough data to find all child boxes.
 *   This property allows the opt_partialOkay flag from parse() to be propagated
 *   through methods like children().
 * @property {number} start
 *   The start of this box (before the header) in the original buffer. This
 *   start position is the absolute position.
 * @property {number} size
 *   The size of this box (including the header).
 * @property {?number} version
 *   The version for a full box, null for basic boxes.
 * @property {?number} flags
 *   The flags for a full box, null for basic boxes.
 * @property {!shaka.util.DataViewReader} reader
 *   The reader for this box is only for this box. Reading or not reading to
 *   the end will have no affect on the parser reading other sibling boxes.
 * @exportInterface
 */
shaka.util.Mp4Parser.ParsedBox;


/**
 * @typedef {function(!shaka.util.Mp4Parser.ParsedBox)}
 * @exportInterface
 */
shaka.util.Mp4Parser.CallbackType;


/**
 * An enum used to track the type of box so that the correct values can be
 * read from the header.
 *
 * @enum {number}
 * @private
 */
shaka.util.Mp4Parser.BoxType_ = {
  BASIC_BOX: 0,
  FULL_BOX: 1
};


/**
 * Declare a box type as a Box.
 *
 * @param {string} type
 * @param {!shaka.util.Mp4Parser.CallbackType} definition
 * @return {!shaka.util.Mp4Parser}
 * @export
 */
shaka.util.Mp4Parser.prototype.box = function(type, definition) {
  var typeCode = shaka.util.Mp4Parser.typeFromString_(type);
  this.headers_[typeCode] = shaka.util.Mp4Parser.BoxType_.BASIC_BOX;
  this.boxDefinitions_[typeCode] = definition;
  return this;
};


/**
 * Declare a box type as a Full Box.
 *
 * @param {string} type
 * @param {!shaka.util.Mp4Parser.CallbackType} definition
 * @return {!shaka.util.Mp4Parser}
 * @export
 */
shaka.util.Mp4Parser.prototype.fullBox = function(type, definition) {
  var typeCode = shaka.util.Mp4Parser.typeFromString_(type);
  this.headers_[typeCode] = shaka.util.Mp4Parser.BoxType_.FULL_BOX;
  this.boxDefinitions_[typeCode] = definition;
  return this;
};


/**
 * Stop parsing.  Useful for extracting information from partial segments and
 * avoiding an out-of-bounds error once you find what you are looking for.
 *
 * @export
 */
shaka.util.Mp4Parser.prototype.stop = function() {
  this.done_ = true;
};


/**
 * Parse the given data using the added callbacks.
 *
 * @param {!BufferSource} data
 * @param {boolean=} opt_partialOkay If true, allow partial payload for some
 *   boxes. If the goal is a child box, we can sometimes find it without enough
 *   data to find all child boxes.
 * @export
 */
shaka.util.Mp4Parser.prototype.parse = function(data, opt_partialOkay) {
  var wrapped = new Uint8Array(data);
  var reader = new shaka.util.DataViewReader(
      new DataView(wrapped.buffer, wrapped.byteOffset, wrapped.byteLength),
      shaka.util.DataViewReader.Endianness.BIG_ENDIAN);

  this.done_ = false;
  while (reader.hasMoreData() && !this.done_) {
    this.parseNext(0, reader, opt_partialOkay);
  }
};


/**
 * Parse the next box on the current level.
 *
 * @param {number} absStart The absolute start position in the original
 *   byte array.
 * @param {!shaka.util.DataViewReader} reader
 * @param {boolean=} opt_partialOkay If true, allow partial payload for some
 *   boxes. If the goal is a child box, we can sometimes find it without enough
 *   data to find all child boxes.
 * @export
 */
shaka.util.Mp4Parser.prototype.parseNext =
    function(absStart, reader, opt_partialOkay) {
  var start = reader.getPosition();

  let size = reader.readUint32();
  let type = reader.readUint32();
  let name = shaka.util.Mp4Parser.typeToString(type);
  shaka.log.v2('Parsing MP4 box', name);

  switch (size) {
    case 0:
      size = reader.getLength() - start;
      break;
    case 1:
      size = reader.readUint64();
      break;
  }

  var boxDefinition = this.boxDefinitions_[type];

  if (boxDefinition) {
    var version = null;
    var flags = null;

    if (this.headers_[type] == shaka.util.Mp4Parser.BoxType_.FULL_BOX) {
      var versionAndFlags = reader.readUint32();
      version = versionAndFlags >>> 24;
      flags = versionAndFlags & 0xFFFFFF;
    }

    // Read the whole payload so that the current level can be safely read
    // regardless of how the payload is parsed.
    var end = start + size;
    if (opt_partialOkay && end > reader.getLength()) {
      // For partial reads, truncate the payload if we must.
      end = reader.getLength();
    }
    var payloadSize = end - reader.getPosition();
    var payload =
        (payloadSize > 0) ? reader.readBytes(payloadSize) : new Uint8Array(0);

    var payloadReader = new shaka.util.DataViewReader(
        new DataView(payload.buffer, payload.byteOffset, payload.byteLength),
        shaka.util.DataViewReader.Endianness.BIG_ENDIAN);

    /** @type {shaka.util.Mp4Parser.ParsedBox } */
    var box = {
      parser: this,
      partialOkay: opt_partialOkay || false,
      version: version,
      flags: flags,
      reader: payloadReader,
      size: size,
      start: start + absStart
    };

    boxDefinition(box);
  } else {
    // Move the read head to be at the end of the box.
    reader.skip(start + size - reader.getPosition());
  }
};


/**
 * A callback that tells the Mp4 parser to treat the body of a box as a series
 * of boxes. The number of boxes is limited by the size of the parent box.
 *
 * @param {!shaka.util.Mp4Parser.ParsedBox} box
 * @export
 */
shaka.util.Mp4Parser.children = function(box) {
  while (box.reader.hasMoreData() && !box.parser.done_) {
    box.parser.parseNext(box.start, box.reader, box.partialOkay);
  }
};


/**
 * A callback that tells the Mp4 parser to treat the body of a box as a sample
 * description. A sample description box has a fixed number of children. The
 * number of children is represented by a 4 byte unsigned integer. Each child
 * is a box.
 *
 * @param {!shaka.util.Mp4Parser.ParsedBox} box
 * @export
 */
shaka.util.Mp4Parser.sampleDescription = function(box) {
  for (var count = box.reader.readUint32();
       count > 0 && !box.parser.done_;
       count -= 1) {
    box.parser.parseNext(box.start, box.reader, box.partialOkay);
  }
};


/**
 * Create a callback that tells the Mp4 parser to treat the body of a box as a
 * binary blob and how to handle it.
 *
 * @param {function(!Uint8Array)} callback
 * @return {!shaka.util.Mp4Parser.CallbackType}
 * @export
 */
shaka.util.Mp4Parser.allData = function(callback) {
  return function(box) {
    var all = box.reader.getLength() - box.reader.getPosition();
    callback(box.reader.readBytes(all));
  };
};


/**
 * Convert an ascii string name to the integer type for a box.
 *
 * @param {string} name The name of the box. The name must be four
 *                      characters long.
 * @return {number}
 * @private
 */
shaka.util.Mp4Parser.typeFromString_ = function(name) {
  goog.asserts.assert(
      name.length == 4,
      'Mp4 box names must be 4 characters long');

  var code = 0;
  for (var i = 0; i < name.length; i++) {
    code = (code << 8) | name.charCodeAt(i);
  }
  return code;
};


/**
 * Convert an integer type from a box into an ascii string name.
 * Useful for debugging.
 *
 * @param {number} type The type of the box, a uint32.
 * @return {string}
 * @export
 */
shaka.util.Mp4Parser.typeToString = function(type) {
  let name = String.fromCharCode(
      (type >> 24) & 0xff,
      (type >> 16) & 0xff,
      (type >> 8) & 0xff,
      type & 0xff);
  return name;
};
