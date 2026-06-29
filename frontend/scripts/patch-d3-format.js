// Patch for d3-format@3.x missing precision helper files
// (required by d3-scale which recharts depends on)
const fs = require('fs');
const path = require('path');

function writeMissingFiles(dir, files, label) {
  if (!fs.existsSync(dir)) {
    console.log(`[${label}] target directory not found, skipping patch`);
    return;
  }

  let patched = 0;
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[${label}] created ${name}`);
      patched++;
    }
  }

  if (patched === 0) {
    console.log(`[${label}] all files already present, nothing to patch`);
  }
}

writeMissingFiles(path.join(__dirname, '../node_modules/d3-format/src'), {
  'precisionFixed.js': `import {formatDecimalParts} from "./formatDecimal.js";

export default function precisionFixed(step) {
  return Math.max(0, -formatDecimalParts(Math.abs(step), 10)[1]);
}
`,
  'precisionPrefix.js': `import {formatDecimalParts} from "./formatDecimal.js";

export default function precisionPrefix(step, value) {
  return Math.max(0, Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3 - exponent(Math.abs(step)));
}

function exponent(x) {
  return x ? Math.floor(Math.log(x) / Math.LN10) : 0;
}
`,
  'precisionRound.js': `import {formatDecimalParts} from "./formatDecimal.js";

export default function precisionRound(step, max) {
  step = Math.abs(step), max = Math.abs(max) - step;
  return Math.max(0, formatDecimalParts(max, 10)[1] - formatDecimalParts(step, 10)[1]) + 1;
}
`,
}, 'patch-d3-format');

writeMissingFiles(path.join(__dirname, '../node_modules/postcss-selector-parser/dist/util'), {
  'getProp.js': `"use strict";

exports.__esModule = true;
exports["default"] = getProp;
function getProp(obj) {
  for (var _len = arguments.length, props = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    props[_key - 1] = arguments[_key];
  }
  while (props.length > 0) {
    var prop = props.shift();
    if (!obj[prop]) {
      return undefined;
    }
    obj = obj[prop];
  }
  return obj;
}
module.exports = exports.default;
`,
  'ensureObject.js': `"use strict";

exports.__esModule = true;
exports["default"] = ensureObject;
function ensureObject(obj) {
  for (var _len = arguments.length, props = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    props[_key - 1] = arguments[_key];
  }
  while (props.length > 0) {
    var prop = props.shift();
    if (!obj[prop]) {
      obj[prop] = {};
    }
    obj = obj[prop];
  }
}
module.exports = exports.default;
`,
  'stripComments.js': `"use strict";

exports.__esModule = true;
exports["default"] = stripComments;
function stripComments(str) {
  var s = "";
  var commentStart = str.indexOf("/*");
  var lastEnd = 0;
  while (commentStart >= 0) {
    s = s + str.slice(lastEnd, commentStart);
    var commentEnd = str.indexOf("*/", commentStart + 2);
    if (commentEnd < 0) {
      return s;
    }
    lastEnd = commentEnd + 2;
    commentStart = str.indexOf("/*", lastEnd);
  }
  s = s + str.slice(lastEnd);
  return s;
}
module.exports = exports.default;
`,
}, 'patch-postcss-selector-parser');

writeMissingFiles(path.join(__dirname, '../node_modules/postcss-selector-parser/dist'), {
  'sortAscending.js': `"use strict";

exports.__esModule = true;
exports["default"] = sortAscending;
function sortAscending(list) {
  return list.sort(function (a, b) {
    return a - b;
  });
}
;
module.exports = exports.default;
`,
}, 'patch-postcss-selector-parser');

// macOS иногда создаёт пустые дубликаты «package 2» в @types — ломают tsc
const typesDir = path.join(__dirname, '../node_modules/@types');
if (fs.existsSync(typesDir)) {
  for (const name of fs.readdirSync(typesDir)) {
    if (/\s\d+$/.test(name)) {
      fs.rmSync(path.join(typesDir, name), { recursive: true, force: true });
      console.log(`[clean-types] removed duplicate @types/${name}`);
    }
  }
}
