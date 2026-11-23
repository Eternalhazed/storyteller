# Storyteller Apps

_this page to be updated when the v2 mobile apps are released_

---

## Downloading the application

There are Storyteller Reader apps on the
[iOS App Store](https://apps.apple.com/us/app/storyteller-reader/id6474467720),
and on the
[Google Play Store](https://play.google.com/store/apps/details?id=dev.smoores.Storyteller).
If you have trouble searching for the app, please use the full app name:
Storyteller Reader.

### Obtainium configuration

If you'd like to use Obtainium rather than the Google or Aurora Store for
installing Storyteller, you can import
[this Obtainium config](./storyteller-obtainium-config.json).

## Logging into the application for the first time.

When you first install the Storyteller mobile app, you will need to configure
your server URL in the app settings. This should be set to the URL for your
[web interface](settings.md#library-settings). If you were invited to the
server, it is the base URL in your invite (the URL minus the
/invite/bunch-of-numbers part).

## Downloading books

Once you are
[logged into the server](tutorials/basic-user.md#logging-into-the-web-server-for-the-first-time),
you can download books that can be read offline. When you _are_ online\*, your
position will sync to all other devices that are also online.

\*_Online here refers specifically to being on the same network as the
Storyteller server._

### Downloading books from the server

After you've configured your server URL and signed in, open a book from Home or
search to see the formats you can download. The book card and its details use
the same download states: **Queued**, **Downloading**, **Preparing**,
**Available offline**, and **Failed**. You can cancel while a download is queued
or transferring, but not while the app is preparing the book. Wait for
**Available offline** before going offline. Downloaded books appear on **On this
device**. If a transfer was interrupted by closing the app, choose **Resume
queue** to restart pending transfers. For a failed download, choose **Try
again**.

## Home

Home is built from sections, each shown only when it has books. A book appears
in one section at most, and suggested books carry a short line saying why
they're there.

- **Continue reading** or **Continue listening** — the book you last had open,
  in the same format, with your chapter and progress. A read-along offers both
  **Listen** and **Read along**. If you were reading it on another device and it
  isn't downloaded here, tap **Download & continue**; it opens once the download
  finishes.
- **Jump back in** — other books you've opened in the last two weeks.
- **Shortlist** — books you've flagged to read soon, in your order.
- **Next in your series** — for each series you've started, the next book after
  the furthest one you've finished.
- **Nearly done** — books more than half read that you haven't opened for two
  weeks.
- **Start a new series** — the first book you own of each series you haven't
  started.
- **New read-alongs** — books that finished syncing in the last month.
- **To read** — unstarted books that aren't part of a series.
- **Recently added**, then **Magazines**.

Books you haven't touched for two months move to **Paused**, a link at the end
of Home. To hide, show or reorder sections, change the cover size, or show a row
for each of your collections, open the Home menu and choose **Customize home**.
Shelves you build in the web app appear as Home sections too.

## Shortlist

Flag a book for your Shortlist from its long-press menu, the **Shortlist**
button on its page, or by choosing **Shortlist** in its status picker. Flagged
books show a small flag on their cover. Open the Shortlist from the top of Home
to see it in full and use **Edit order** to rearrange it.

A book leaves the Shortlist when you start it, or when you finish it if you
change that in **Settings → Shortlist**. The Shortlist belongs to your account,
so it's the same on every device and in the web app.

## Series

Open **Series** from the top of Home to see every series you own. Each one shows
where you stand: **3 ahead** counts the books after the furthest one you've
finished, so earlier books you may have read elsewhere aren't counted. You'll
also see **1 left**, **Caught up**, **Not started**, or **#2 not in library**
when the next number is missing. A series page lists its books in order,
highlights the next one, and can mark earlier books as read in one step.

## Finishing a book

Near the end of a book (95% by default), the reader asks **Finished?** You can
mark it read, mark it read and start the next book in its series (or the top of
your Shortlist), or choose **Not yet**. A book you start moves from **To read**
to **Reading** on its own. Change the threshold, switch to marking books read
automatically, or turn this off in **Settings → Finishing books**.

## Returning after looking up a passage

Opening a passage from X-Ray, Bookmarks, or Highlights lets you look around
without replacing your saved reading position. Tap **Back to where I was** in
the reader or player to return to the original passage, even after visiting more
than one reference. If you want to save the place you found instead, open the
navigation sheet and tap **Continue here**.

Contents jumps outside a preview still move your saved position and offer a
one-tap undo. During a preview, reading or listening progress stays at the
original location, and X-Ray does not reveal information beyond it. Narration
pauses for a preview and does not restart automatically when you return. If
another device reports a newer position during a preview, it is offered after
you return.

## Magazines on the home screen

Books in a collection named **Magazines** are kept off the home screen's reading
sections, so a batch of issues doesn't push your books out of view. They appear
on their own Magazines row near the end of the home screen, newest first.

## Highlighting and looking up selected text

While reading an ebook, select a word or phrase to show the selection toolbar: a
highlight swatch, Copy, Define, Wikipedia, and Google Search. When you tap an
existing highlight, the toolbar also shows Delete.

Tap the swatch to highlight in your current color. To pick another color, long
press the swatch (or tap an existing highlight's swatch); the color you pick
becomes the one used for your next highlights.

Define shows a short definition from [Wiktionary](https://en.wiktionary.org) in
a card next to the selection, without leaving the book. Tap outside the card to
dismiss it, or tap **Open in Wiktionary** for the full entry. Definitions work
for a word or a short phrase of up to five words.

Google Search uses the full highlighted phrase. Wikipedia searches the phrase in
the Wikipedia app when it can open the search. If the app is unavailable, the
search opens in your default browser.

These lookups require an internet connection. The selected text is sent only to
the provider you choose (Wiktionary for Define) and only after you tap that
action; it is not sent to the Storyteller server for lookup.

## X-Ray

When your server has an X-Ray index for a book, an X-Ray button and navigation
tab appear in the reader. Browse People, Places, Groups, and Things using **Just
now**, **This chapter**, or **Book so far**. Entity details include known names,
descriptions, key facts, and mention sentences grouped by chapter.

X-Ray is filtered on your device to your reading position, including an estimate
of the visible page, or the sentence being spoken during synchronized readaloud
listening. Select a known name and tap **X-Ray** for a compact card; **All
mentions** opens that entity's detail view. A selection can reveal its own
sentence, but not information from later in the book. Tapping a fact or mention
opens a preview of its passage without changing your saved place.

The index downloads with the book and refreshes when you reopen it. Once cached,
X-Ray works offline and selection lookups do not send text anywhere. Books
without an index keep the existing reader controls. X-Ray is not shown for
standalone audiobook playback, even when that book also has an ebook, because
audio-only timestamps are not aligned to text sentences.
