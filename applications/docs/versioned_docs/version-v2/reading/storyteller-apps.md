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

After you've configured your server URL, you'll be asked to log in. You can then
view all of the books in your chosen library in the Browse tab, and download any
of them to your device.

Be sure to keep the app open and in the foreground during the download (support
for background downloads is on the roadmap!). Once your book is downloaded,
you'll find it on your Bookshelf, where you can start reading or listening!

### Magazines on the home screen

Books in a collection named **Magazines** are kept off the home screen's **Start
reading** and **Recently added** shelves, so a batch of issues doesn't push your
books out of view. They appear on their own Magazines shelf at the end of the
home screen, newest first, and an issue you're reading still shows under
**Currently reading**.

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
opens its passage; **Back to previous position** keeps your original place while
you explore.

The index downloads with the book and refreshes when you reopen it. Once cached,
X-Ray works offline and selection lookups do not send text anywhere. Books
without an index keep the existing reader controls. X-Ray is not shown for
standalone audiobook playback, even when that book also has an ebook, because
audio-only timestamps are not aligned to text sentences.
