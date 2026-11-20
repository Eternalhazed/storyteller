# Selected-Text Toolbar Test Plan

Manual QA for the EPUB reader's selection toolbar: remembered-color
highlighting, Copy, Define (inline Wiktionary card), Wikipedia, Google Search,
and existing-highlight deletion.

## Device Matrix

- Fire HD 10/HD 8 class tablet (primary reading device), portrait and
  landscape, including Silk or another non-Chrome default browser.
- Android phone.
- iPhone and iPad, including landscape and narrow iPad split view.
- VoiceOver on Apple and TalkBack on Android.
- Paginated and scroll reader layouts; Day, Sepia, and Night themes.

## Toolbar And Highlights

- [ ] Select a word, phrase, and multiline text.
- [ ] Expected: one row with swatch, Copy, Define, Wikipedia, and Google
      Search, centered above the selection with a visible shadow.
- [ ] Tap the swatch.
- [ ] Expected: a highlight in the remembered color (yellow on first use); the
      toolbar and the selection handles disappear.
- [ ] Long press the swatch on a new selection and pick another color.
- [ ] Expected: the highlight uses that color, and the next new selection's
      swatch shows it.
- [ ] Tap an existing highlight.
- [ ] Expected: swatch (ringed, in the highlight's color), Copy, Define,
      Wikipedia, Google Search, and a red Delete.
- [ ] Tap the swatch, then Back; tap the swatch, then a color.
- [ ] Expected: Back returns to the actions; a color recolors the highlight.
- [ ] Delete it.
- [ ] Expected: the highlight is removed and the toolbar closes.
- [ ] Tap Copy.
- [ ] Expected: exact original text is copied; toolbar and handles close.

## Definitions

- [ ] Define a lowercase word, a sentence-initial word (`Some`), a word with
      clinging punctuation (`whale!"`), a possessive (`Ahab's`), a two-word
      phrase (`sperm whale`), and a nonsense word.
- [ ] Expected: a compact card floats next to the selection (above it when
      there is room, otherwise below), capped in width on tablets; English
      senses win over same-spelled foreign titles; the nonsense word shows
      "no entry" and **Search Wiktionary**.
- [ ] Expected: no selection handles float over the card.
- [ ] Define with six or more words selected.
- [ ] Expected: `Selection is too long`; nothing is requested.
- [ ] Dismiss by tapping outside and by Android Back.
- [ ] Expected: the card closes and the reader page is unchanged.
- [ ] Tap **Open in Wiktionary**.
- [ ] Expected: the entry opens in the default browser or app.
- [ ] Disable connectivity and Define.
- [ ] Expected: the card shows a connection error and **Try again** works once
      connectivity returns.

## Placement

- [ ] Select near the center, left edge, right edge, and top of the page.
- [ ] Expected: the toolbar stays inside the 16-point inset and above the
      selection, clamping to the top safe area when it cannot fit.
- [ ] Expected: the definition card stays fully on screen in every case.
- [ ] Repeat in portrait, landscape, split view, paginated, and scroll layouts.

## Web Lookups

- [ ] Long press one word, wait for the toolbar, then drag the handles to span
      a phrase across two lines. Tap Google Search.
- [ ] Expected: Google's search field contains the whole phrase, including the
      words added after the toolbar appeared.
- [ ] Save a phrase as a highlight, tap it again, and repeat Google Search.
- [ ] Expected: the query contains the saved phrase.
- [ ] With Wikipedia installed and Chrome set as the default browser on
      Android, tap Wikipedia on a multiword selection. Repeat on iOS with
      the Wikipedia app installed.
- [ ] Expected: Wikipedia opens directly to search with the full phrase.
- [ ] Repeat with Wikipedia uninstalled or disabled, including on a device
      whose default browser is Silk.
- [ ] Expected: the default browser opens Wikipedia's search with the full
      phrase. Returning to the reader clears the toolbar for both providers.
- [ ] Test `Saxe-Weimar's wood`, `résumé & café`, `日本語 كتاب`,
      `#hashtag? foo`, and `https://malicious.example/?x=1&y=2#fragment`.
- [ ] Expected: provider origin stays fixed and query text appears once.
- [ ] Select more than 500 Unicode code points.
- [ ] Expected: `Selection is too long`; nothing opens.

## Privacy And Accessibility

- [ ] Inspect logs after every action.
- [ ] Expected: no selected text, URL, or provider content is logged.
- [ ] Navigate the toolbar and definition card with TalkBack and VoiceOver.
- [ ] Expected: meaningful names and roles; the swatch exposes "Choose
      highlight color"; Delete is distinguishable; the card is announced as a
      modal with a heading.
