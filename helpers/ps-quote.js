// A value inside a PowerShell single-quoted string (9 Nov 2026; it was copied into eight files). PowerShell ends a
// single-quoted string at ' and also at the typographic quotes ‘ ’ ‚ ‛ (U+2018-U+201B), so each of those is doubled,
// which is how PowerShell writes it literally. The copies doubled only ', so a folder named with ’ (O’Brien, as
// Word and phones type it) would have closed the string early.
//   psQuote('C:\\Users\\O’Brien')  ->  'C:\Users\O’’Brien'   (the whole quoted value)
//   psEscape(s)                     the inside alone, for a script that writes the quotes itself
'use strict';
const QUOTES = /['\u2018\u2019\u201A\u201B]/g;
const psEscape = (s) => String(s).replace(QUOTES, (c) => c + c);
const psQuote = (s) => `'${psEscape(s)}'`;
module.exports = { psQuote, psEscape };
