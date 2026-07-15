'use strict';

const $ = (selector) => document.querySelector(selector);

$('#openSource').addEventListener('click', () => window.meshuttle.openExternal('https://github.com/syncthing/syncthing/tree/v2.1.2'));
$('#openMpl').addEventListener('click', () => window.meshuttle.openExternal('https://www.mozilla.org/MPL/2.0/'));
$('#closeLicenses').addEventListener('click', () => window.meshuttle.closeLicenses());
