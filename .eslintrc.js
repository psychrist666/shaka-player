// vim: foldmethod=marker:foldmarker={{{,}}}
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

// ESlint config

module.exports = {
    "env": {
        "browser": true,
        "es6": true
    },
    "parserOptions": {
        "ecmaVersion": 2017
    },
    "extends": ["eslint:recommended", "google"],
    "rules": {
        // Things the compiler already takes care of, with more precision: {{{
        "no-console": "off",
        "no-eq-null": "off",
        "no-eval": "off",
        "no-undef": "off",
        "valid-jsdoc": "off",
        // }}}

        // Things we should probably fix, but in stages in multiple commits: {{{

        // In many cases, we should change scoped var to let.
        "block-scoped-var": "off",
        "no-inner-declarations": "off",
        "no-redeclare": "off",
        "no-shadow": "off",

        // These could catch real bugs
        "consistent-return": "off",
        "default-case": "off",
        "no-extra-bind": "off",
        "no-loop-func": "off",
        "no-unused-expressions": "off",  // Conflicts with some Closure declarations
        "prefer-promise-reject-errors": "off",

        // These could improve readability
        "complexity": "off",
        "dot-location": "off",
        "no-negated-condition": "off",
        // }}}

        // Temporary Google style overrides while we get in compliance with the latest style guide {{{
        "block-spacing": "off",
        "brace-style": "off",
        "camelcase": "off",
        "comma-dangle": "off",
        "comma-spacing": "off",
        "curly": "off",
        "new-cap": "off",
        "no-multi-spaces": "off",
        "no-multiple-empty-lines": "off",
        "no-var": "off",
        "object-curly-spacing": "off",
        "one-var": "off",
        "padded-blocks": "off",
        "prefer-rest-params": "off",
        "prefer-spread": "off",
        "require-jsdoc": "off",
        // }}}

        // "Possible error" rules in "eslint:recommended" that need options: {{{
	"no-empty": ["error", {"allowEmptyCatch": true}],
        // }}}

        // "Possible error" rules we should be able to pass, but are not part of "eslint:recommended": {{{
        "for-direction": "error",
        "getter-return": "error",
        "no-await-in-loop": "error",
        "no-template-curly-in-string": "error",
        // }}}

        // "Best practices" rules we should be able to pass, but are not part of "eslint:recommended": {{{
        "accessor-pairs": "error",
        "array-callback-return": "error",
        "no-alert": "error",
        "no-caller": "error",
        "no-catch-shadow": "error",
        "no-extend-native": "error",  // May conflict with future polyfills
        "no-extra-label": "error",
        "no-floating-decimal": "error",
        "no-implied-eval": "error",
        "no-invalid-this": "error",
        "no-iterator": "error",
        "no-label-var": "error",
        "no-labels": "error",
        "no-lone-blocks": "error",
        "no-multi-str": "error",
        "no-new": "error",
        "no-new-func": "error",
        "no-new-wrappers": "error",
        "no-octal-escape": "error",
        "no-proto": "error",
        "no-return-assign": "error",
        "no-return-await": "error",
        "no-script-url": "error",
        "no-self-compare": "error",
        "no-sequences": "error",
        "no-throw-literal": "error",
        "no-unmodified-loop-condition": "error",
        "no-useless-call": "error",
        "no-useless-concat": "error",
        "no-useless-return": "error",
        "no-void": "error",
        "no-with": "error",
        "radix": ["error", "always"],
        "require-await": "error",
        "wrap-iife": ["error", "inside"],
        // }}}

        // Style rules we don't need: {{{
        "class-methods-use-this": "off",  // causes issues when implementing an interface
        "dot-notation": "off",  // We use bracket notation in tests on purpose
        "eqeqeq": "off",  // Compiler handles type checking in advance
        "guard-for-in": "off",
        "key-spacing": ["error", {"beforeColon": false, "afterColon": true}],
        "no-div-regex": "off",  // Conflicts with no-useless-escape
        "no-undef-init": "off",  // Sometimes necessary with hacky compiler casts
        "no-undefined": "off",  // We use undefined in many places, legitimately
        "no-unused-vars": "off",  // Interface impls may not require all args
        "no-use-before-define": "off",  // Does not know when things are executed, false positives
        "no-warning-comments": "off",  // TODO and FIXME are fine
        "vars-on-top": "off",
        "yoda": ["error", "never"],
        // }}}

        // Style rules that don't seem to be in the Google style config: {{{
        "array-bracket-newline": ["error", "consistent"],
        // }}}
    }
};
