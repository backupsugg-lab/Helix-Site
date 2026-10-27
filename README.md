# vibecoded proxy

Upload this whole folder to your host (GitHub Pages works). Keep the folder structure.

    index.html          the browser
    single.html         same browser with libcurl.js inlined, opens from file://
    sw.js               lite engine service worker (fallback)
    sj/sw.js            Scramjet v2 service worker
    sj/scramjet/        Scramjet 2.0.67-alpha.2 (PATCHED, see below)
    sj/controller/      @mercuryworkshop/scramjet-controller 0.0.14
    sj/transport/       epoxy.mjs, libcurl.mjs
    sj/hz-transport.js  adapter + automatic epoxy -> libcurl fallback
    wisp-server/        your own Wisp server

Local test: `python3 -m http.server 8080` in this folder, then open http://localhost:8080

## What changed in build 20

* New look: soft warm light and dark themes (Settings > Appearance), Chrome style tabs, one calm accent colour.
* Buttons next to the address bar: Wisp servers (with a status light), Downloads, History, Bookmarks, Logs, Fullscreen, Settings.
  Every one of them toggles: press it again and what it opened closes. History, Bookmarks, Downloads and Wisp servers
  open as pages in a tab and the tab closes again. Esc closes Settings and popovers.
* Removed: private mode, find in page, reader view, the menu button.
* The new tab page is plain text links (bookmarks, then most visited, then Discord, GitHub, YouTube ...).
* Logs: drag the top edge to resize, A- / A+ for the text size (both are remembered).
* Site information (the icon at the left of the address bar) holds the per-site permissions.

## Fixes

* "undefined" at the end of the address (claude.ai/undefined, tiktok.com/404?fromUrl=%2Fundefined): Scramjet turned
  history.pushState/replaceState calls without a URL into the path "undefined". Patched in sj/scramjet/scramjet.js
  (search for `null!=t.args[2]&&`). If you ever replace that file with a fresh Scramjet download, re-apply the patch.
  This was also why Reload and Back sometimes left the site.
* Back / Forward only step to pages of the same tab and are greyed out when there is nowhere to go; Reload falls back to
  loading the address again if the frame is not on the page.
* Captchas and bot checks: the page and every request now use your own browser's real identity by default (User-Agent, client hints
  and navigator all agree). The old default pretended to be Chrome 141 on Windows and replaced navigator inside every page, which bot
  checks detect. Nothing in the proxied page is wrapped or replaced any more (no console hooks, no request body copies), and
  the passkey switch-off uses Proxy wrappers that still look native. Settings > Browsing > Browser identity still lets you pick Chrome on Windows/macOS/Linux.
  Limits that no code here can change: the TLS fingerprint of the transport and the reputation of the Wisp server's IP address
  (datacenter addresses get harder captchas).
* Wisp servers: both address forms (`/` and `/wisp/`) are tried and the one that answers is kept; servers on free hosting
  (Render, Fly, Railway ...) are woken up and retried for up to 50 seconds; anura.pro is first in the list; only servers that
  answered are used as fallbacks; the connection is checked when the page opens. Your own added servers are kept.

## Latest changes

* Horizontal tabs are the default (Settings > Tab layout switches to vertical).
* Movies and Music buttons (sidebar and new tab page) open cineby.tech and freefy.app inside vibecoded proxy.
* Sign-in popups (Continue with Google etc.) open as a draggable, resizable floating window over the tab. window.open is
  caught inside Scramjet itself (sj/scramjet/scramjet.js and sj/scramjet.all.js, search for `__hzPopup`). If you replace
  those files with a fresh Scramjet download, re-apply that patch.
* Browser identity: My own browser, or Chrome on Windows / macOS / Linux / ChromeOS / Android / iPhone. User-Agent, client
  hints and navigator all change together, and the Chrome version follows your real browser.
* Wisp drops ("MuxTaskEnded"): the transport is now rebuilt automatically and sockets that were on the dead connection
  are closed so Discord and similar sites reconnect. The error no longer shows as an unhandled rejection.

## Build 21 fixes (single-file engine)

* Scripts, ES modules, dynamic chunks and nested iframes no longer give up after 12-25 s. They wait up to 2 minutes and classic scripts retry 3 times through Wisp (a dropped script is what left sites like Discord on their "JavaScript is needed" page).
* Nested iframes are embedded with srcdoc instead of blob: URLs, which the browser refuses when vibecoded proxy is opened from a file.
* The built-in engine now tests the Wisp servers (saved one first, then the pool) and uses one that really answers; servers that are blocked or dead are skipped for a while and replaced automatically.

## Chat: history sync

* Late joiners: the backlog a newcomer lacks is split into stripes. The host and up to two other peers each send one
  stripe (relayed through the host) in packets of 3 messages with a pause between them, and the newcomer draws the rows
  a few at a time. If a peer drops out, the newcomer asks the host for whatever is still missing.
* When the host changes, peers hand the new host only the messages it lacks (paced, nothing re-broadcast).

## Chat: GIFs (GIPHY)

* GIF button next to the message box: trending and search come from GIPHY. The API calls and the images are fetched
  through the Wisp server (`window.hxWispFetch` in index.html), never from an iframe or straight from the browser.
* The GIPHY key is `GIPHY_KEY` at the top of the `hx-chat-runtime` script. It is visible to anyone who views the page
  source, which is normal for GIPHY keys; a beta key is limited to about 100 requests per hour.
* Only https images on giphy.com are accepted from other peers (`GIF_HOST` in the same script).

## Build 22 fixes

* Links that want a new window (target=_blank, `<base target>`, named targets, ctrl/shift/middle click, GET forms with a target) and `window.open` calls without popup features now open as a tab inside this browser. Sign-in popups that ask for a size still open as the floating window. Real addresses are recovered with `$scramjet.unrewriteUrl`, so the tab never gets a proxied-prefix address.
* Downloads: more file types are recognised (exe/msi/dmg/iso/torrent/zst/force-download ...), iframe/document requests count as navigations too, and a caught download now has its Content-Disposition/Content-Type/Length stripped from the 204 stand-in so the real browser cannot start a second, empty download. The Logs panel prints `caught a download: <name>` (source `downloads`).
* GIF search: the search box is a plain text field and the GIPHY key box is no longer `type=password` (that hidden password field made password managers treat the search box as a login username). Both carry autocomplete=off and the 1Password/LastPass/Bitwarden ignore flags.
