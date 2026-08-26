# Selected-Text Lookup Test Plan

Manual QA for Wikipedia, Google Search, and existing-highlight deletion from
the EPUB reader's selected-text toolbar.

## Device Matrix

- Android phone and tablet, including a non-Chrome default browser.
- iPhone and iPad, including landscape and narrow iPad split view.
- VoiceOver on Apple and TalkBack on Android.
- Paginated and scroll reader layouts.

## Toolbar And Regression

- [ ] Select a word, phrase, and multiline text.
- [ ] Expected: five colors, Copy, and ellipsis appear in one row without
      covering the selection.
- [ ] Create and recolor highlights with every existing color.
- [ ] Expected: highlight behavior is unchanged.
- [ ] Tap Copy.
- [ ] Expected: exact original text is copied and the toolbar closes.
- [ ] Open an existing highlight, then tap the ellipsis.
- [ ] Expected: Delete is an icon before the Wikipedia and Google actions.
- [ ] Delete it.
- [ ] Expected: the highlight is removed and the toolbar closes.

## Placement And Dismissal

- [ ] Select near the center, left edge, and right edge, then tap the
      ellipsis.
- [ ] Expected: it is replaced inline by a Wikipedia icon and search icon; no
      dropdown or second overlay appears.
- [ ] Expected: the expanded toolbar grows left from the ellipsis position.
- [ ] Expected: the toolbar remains inside the 16-point horizontal inset.
- [ ] Select near the top safe area.
- [ ] Expected: the toolbar stays above the selection and clamps to the top
      safe-area inset when it cannot fit above.
- [ ] Open an existing highlight in a narrow viewport.
- [ ] Expected: its icon actions may wrap to a second toolbar row, still on the
      same side of the selection.
- [ ] Repeat in portrait, landscape, split view, paginated, and scroll layouts.
- [ ] Expected: the toolbar leaves an 8-point gap above the selection when
      space permits.
- [ ] Dismiss by outside tap, Android Back, and accessibility navigation.
- [ ] Expected: the selection toolbar closes predictably.

## Provider Routing

- [ ] Without Wikipedia installed, tap Wikipedia.
- [ ] Expected: the default browser opens the Wikipedia search.
- [ ] Install Wikipedia and repeat.
- [ ] Expected: record whether `Special:Search` opens the app or browser; either
      is acceptable because the OS owns routing.
- [ ] Change the default browser and repeat both lookups.
- [ ] Expected: fallback follows the user's default; Storyteller forces none.
- [ ] Return after every action.
- [ ] Expected: no stale selection toolbar reappears.

## Text, Failure, And Privacy

- [ ] Test `Saxe-Weimar's wood`, `résumé & café`, `日本語 كتاب`,
      `#hashtag? foo`, and `https://malicious.example/?x=1&y=2#fragment`.
- [ ] Expected: provider origin stays fixed and query text appears once.
- [ ] Select more than 500 Unicode code points.
- [ ] Expected: `Selection is too long`; nothing opens.
- [ ] Disable connectivity and repeat.
- [ ] Expected: Storyteller remains responsive; the opened app/browser owns its
      offline presentation.
- [ ] Reproduce a device with no web-link handler if possible.
- [ ] Expected: one launch-error alert and a usable reader.
- [ ] Inspect logs.
- [ ] Expected: no selected text, URL, or provider content is logged.

## Accessibility

- [ ] Use the largest supported text size.
- [ ] Expected: rows remain readable and on screen or collision-flip.
- [ ] Navigate colors, Copy, ellipsis, Wikipedia, Google Search, and Delete
      with VoiceOver and TalkBack.
- [ ] Expected: meaningful names/roles, visual-order focus, and distinguishable
      destructive Delete.
- [ ] Dismiss without choosing.
- [ ] Expected: focus returns predictably to the trigger or toolbar.
