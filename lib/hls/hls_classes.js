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

goog.provide('shaka.hls.Attribute');
goog.provide('shaka.hls.Playlist');
goog.provide('shaka.hls.PlaylistType');
goog.provide('shaka.hls.Segment');
goog.provide('shaka.hls.Tag');

goog.require('goog.asserts');



/**
 * Creates an HLS playlist object.
 *
 * @param {string} uri
 * @param {!shaka.hls.PlaylistType} type
 * @param {!Array.<shaka.hls.Tag>} tags
 * @param {!Array.<shaka.hls.Segment>=} opt_segments
 *
 * @constructor
 * @struct
 */
shaka.hls.Playlist = function(uri, type, tags, opt_segments) {
  /** @const {string} */
  this.uri = uri;

  /** @const {shaka.hls.PlaylistType} */
  this.type = type;

  /** @const {!Array.<!shaka.hls.Tag>} */
  this.tags = tags;

  /** @const {Array.<!shaka.hls.Segment>} */
  this.segments = opt_segments || null;
};


/**
 * @enum {number}
 */
shaka.hls.PlaylistType = {
  MASTER: 0,
  MEDIA: 1
};



/**
 * Creates an HLS tag object.
 *
 * @param {number} id
 * @param {string} name
 * @param {!Array.<shaka.hls.Attribute>} attributes
 * @param {?string=} opt_value
 *
 * @constructor
 * @struct
 */
shaka.hls.Tag = function(id, name, attributes, opt_value) {

  goog.asserts.assert(
      (attributes.length == 0 && opt_value) ||
      (attributes.length > 0 && !opt_value) ||
      (attributes.length == 0 && !opt_value),
      'Tags can only take the form ' +
      '(1) <NAME>:<VALUE> ' +
      '(2) <NAME>:<ATTRIBUTE_LIST> ' +
      ' (3) <NAME>');

  /** @const {number} */
  this.id = id;

  /** @const {string} */
  this.name = name;

  /** @const {Array.<shaka.hls.Attribute>} */
  this.attributes = attributes;

  /** @const {?string} */
  this.value = opt_value || null;
};


/**
 * Create the string representation of the tag.
 *
 * For the DRM system - the full tag needs to be passed down to the CDM. There
 * are two ways of doing this (1) save the original tag or (2) recreate the tag.
 * As with some cases (like in tests) the tag never existed in string form, it
 * is far easier to recreate the tag from the parsed form.
 *
 * @return {string}
 * @override
 */
shaka.hls.Tag.prototype.toString = function() {

  /**
   * @param {shaka.hls.Attribute} attr
   * @return {string}
   */
  var attr_to_str = function(attr) {
    return attr.name + '="' + attr.value + '"';
  };


  // A valid tag can only follow 1 of 3 patterns.
  //  1) <NAME>:<VALUE>
  //  2) <NAME>:<ATTRIBUTE LIST>
  //  3) <NAME>

  if (this.value) {
    return '#' + this.name + ':' + this.value;
  }

  if (this.attributes.length > 0) {
    return '#' + this.name + ':' + this.attributes.map(attr_to_str).join(',');
  }

  return '#' + this.name;
};



/**
 * Creates an HLS attribute object.
 *
 * @param {string} name
 * @param {string} value
 *
 * @constructor
 * @struct
 */
shaka.hls.Attribute = function(name, value) {
  /** @const {string} */
  this.name = name;

  /** @const {string} */
  this.value = value;
};


/**
 * Adds an attribute to an HLS Tag.
 *
 * @param {!shaka.hls.Attribute} attribute
 */
shaka.hls.Tag.prototype.addAttribute = function(attribute) {
  this.attributes.push(attribute);
};


/**
 * Gets the first attribute of the tag with a specified name.
 *
 * @param {string} name
 * @return {?shaka.hls.Attribute} attribute
 */
shaka.hls.Tag.prototype.getAttribute = function(name) {
  var attributes = this.attributes.filter(function(attr) {
    return attr.name == name;
  });

  goog.asserts.assert(attributes.length < 2,
                      'A tag should not have multiple attributes ' +
                      'with the same name!');

  if (attributes.length)
    return attributes[0];
  else
    return null;
};


/**
 * Gets the value of the first attribute of the tag with a specified name.
 * If not found, returns an optional default value.
 *
 * @param {string} name
 * @param {string=} opt_defaultValue
 * @return {?string}
 */
shaka.hls.Tag.prototype.getAttributeValue = function(name, opt_defaultValue) {
  var defaultValue = opt_defaultValue || null;
  var attribute = this.getAttribute(name);
  return attribute ? attribute.value : defaultValue;
};



/**
 * Creates an HLS segment object.
 *
 * @param {string} uri
 * @param {!Array.<shaka.hls.Tag>} tags
 *
 * @constructor
 * @struct
 */
shaka.hls.Segment = function(uri, tags) {
  /** @const {!Array.<shaka.hls.Tag>} */
  this.tags = tags;

  /** @const {string} */
  this.uri = uri;
};
