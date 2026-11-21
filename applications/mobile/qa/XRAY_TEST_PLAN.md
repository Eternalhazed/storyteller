# X-Ray Test Plan

Manual QA for the mobile reader's offline, spoiler-safe book index, selection
card, and sentence navigation. Android list/detail rendering has been walked on
an emulator; the fixes below still need their targeted device checks.

## Device Matrix

- Android phone and Fire HD 10/HD 8 class tablet; portrait and landscape.
- iPhone and iPad, including narrow iPad split view.
- TalkBack on Android and VoiceOver on Apple.
- Paginated and scroll reader layouts; Day, Sepia, and Night themes; larger
  system text.

## Setup

- Use a server book with a generated X-Ray and multiple chapters, including a
  character whose name or identity changes later in the story.
- Keep both its readaloud and plain ebook editions available. Include an
  entity with many mentions for scrolling checks.
- Also use a book without X-Ray, and a standalone audiobook that has an ebook
  in the same book record.
- Know the passage-end visibility stamps of an alias and fact, and the fact's
  separate source sentence (`sentence`, rather than its visibility stamp `at`).

## Run These First

- [ ] Download the X-Ray book, open it, and tap the toolbar's X-Ray icon.
- [ ] Expected: the sheet opens directly on X-Ray with Just now selected;
      entries and descriptions contain no information beyond the current page.
- [ ] Select a known character name, then tap X-Ray in the selection toolbar.
- [ ] Expected: a compact card appears beside the selection, the native
      selection handles disappear, and All mentions opens that character's
      detail view in the X-Ray tab.
- [ ] Tap a mention, reopen X-Ray, then tap another mention.
- [ ] Expected: each passage opens, the sheet closes after a jump, and Back to
      previous position returns to the original reading location. Earlier
      mention visits do not erase that reading boundary; reading farther than
      a stale return position advances the boundary without dismissing it.
- [ ] Start readaloud listening and open X-Ray as the spoken sentence changes.
- [ ] Expected: its boundary follows the spoken sentence without the text-mode
      page allowance. Standalone audiobook playback has no X-Ray button or tab,
      even if the book also has an ebook.
- [ ] In the reading view, start narration with a reveal just beyond the spoken
      sentence, then pause and repeat the X-Ray check.
- [ ] Expected: playing narration has no page allowance, even in the reading
      view. Measured text-end offsets identify the real visible page bottom.
      Only unmeasured sentence fragments in non-playing text mode use the
      conservative 1000-non-whitespace-character estimate. Layout progression,
      used as a last resort, never gets another page allowance.
- [ ] On Android, use a plain ebook whose prose follows a long contents list in
      the same spine document. Check X-Ray before and after several page turns.
- [ ] Expected: `textStart`, `textEnd`, and `textLength` appear in its locator,
      and Just now ends at the actual last visible sentence, not several pages
      ahead due to layout progression.
- [ ] Repeat in scroll mode, with a two-page landscape spread, and after
      changing font size. Select a known name on the measured page.
- [ ] Expected: the end includes the last text visible anywhere in the viewport;
      selection lookup cannot expand it using layout progression. After settling
      on a page, locators stop emitting rather than entering an update loop.

## Availability And Offline Cache

- [ ] Open the book without X-Ray after viewing X-Ray in another book.
- [ ] Expected: there is no X-Ray icon or tab; the normal navigation button
      opens one of the existing three tabs rather than an unavailable X-Ray tab.
- [ ] Open a valid X-Ray file containing zero entities.
- [ ] Expected: no X-Ray toolbar button, navigation tab, or selection action.
- [ ] Download a book with X-Ray while online, then disconnect and reopen it.
- [ ] Expected: the cached index works without a network-error prompt.
- [ ] Make the server return 404 or fail the next X-Ray request.
- [ ] Expected: an existing local copy remains available and a missing copy
      remains unobtrusive; reading and downloads still work.
- [ ] Regenerate the server index, reopen the book online, and compare its
      updated entries. If inspecting requests, verify bearer authorization and
      If-None-Match/304 behavior without recording the token.
- [ ] With ebook and readaloud both downloaded, remove one; also cancel a new
      audiobook download while an ebook/readaloud is already downloaded.
- [ ] Expected: the surviving text download retains its working X-Ray cache.
- [ ] Remove the final ebook/readaloud download, then test whole-book removal.
- [ ] Expected: all X-Ray JSON generations and metadata are removed; an
      audiobook-only download does not keep the text index alive.
- [ ] With a controlled test response, serve an unsupported `schemaVersion`,
      then reopen the book repeatedly without changing its ETag.
- [ ] Expected: X-Ray remains hidden, the unsupported schema and ETag stay in
      the small metadata file, and subsequent requests send If-None-Match/304
      without downloading or parsing the full index again.
- [ ] Interrupt a cache write between the new JSON and its metadata commit.
- [ ] Expected: after restarting, the previous JSON and its ETag still belong
      together; an interrupted generation cannot publish a mismatched ETag.

## Scopes And Entity Details

- [ ] Check Just now, This chapter, and Book so far.
- [ ] Expected: Just now uses the last 40 sentences, newest mention first;
      This chapter ranks by mentions in the current chapter; Book so far ranks
      by all visible mentions. Counts on rows always show mentions so far.
- [ ] Choose a scope with no entries and toggle each type filter.
- [ ] Expected: the next wider scope's matching rows appear under a small
      explanatory heading. Tapping the active type again restores all types.
- [ ] Close and reopen the sheet.
- [ ] Expected: the last tab and scope are remembered for this app session.
- [ ] Open an entity's detail view, inspect aliases, description, and Key facts,
      then scroll a list containing thousands of mentions.
- [ ] Expected: scrolling stays responsive; sentence text is grouped by chapter
      title, with Untitled chapter only when no TOC title exists.
- [ ] After scrolling down the entity list or an entity's mentions, swipe down
      inside the list.
- [ ] Expected: the list scrolls back up and the sheet stays open.
- [ ] Expected: Key facts and Mentions are labelled sections with counts; each
      chapter heading shows how many mentions it groups; each mention shows the
      entity's name in bold.
- [ ] Toggle newest/oldest first and use All entries.
- [ ] Expected: key fact, mention and chapter order all change together, and
      TalkBack reads the button as "Sorted newest first" (or oldest) with a hint
      naming what a tap does; All entries returns to the in-tab list without
      closing the sheet.
- [ ] In an entity detail view, press Android hardware Back.
- [ ] Expected: the entity list returns inside the same sheet; a later Back
      can dismiss the sheet normally. Switching tabs leaves no detail handler.

## Spoiler Boundaries And Selection

- [ ] Stop before a known identity reveal and select its unrevealed alias.
- [ ] Expected: no X-Ray action for that alias. Other known aliases still work.
- [ ] Select the alias before and after its generated passage-end stamp.
- [ ] Expected: a measured page bounds the lookup, ignoring selection layout
      progression. Without measured offsets, lookup may include the selected
      sentence but adds no page estimate. Aliases, facts, and descriptions still
      remain hidden until their passage-end visibility stamps.
- [ ] In a book with the character Will, select ordinary lowercase "will",
      then "Will" and a known longer alias containing that name.
- [ ] Expected: the common word has no X-Ray action; proper names use the same
      case-sensitive matching and longest-alias rules as the index.
- [ ] Select earlier text after reading farther into the book.
- [ ] Expected: the card uses the farther established reading boundary.
- [ ] Drag the handles from a known name to an unrelated phrase and back.
- [ ] Expected: X-Ray availability tracks the live selection; tapping never
      opens stale entity data. Copy, Define, Wikipedia, and Google retain their
      existing full-selection behavior.
- [ ] Repeat on a saved highlight and with text spanning multiple lines.
- [ ] Expected: saved highlights use their own text and locator, not the current
      page's position. Unknown text has no extra action or empty toolbar space.
- [ ] Inspect the card before and after facts are revealed.
- [ ] Expected: name, type, description (or latest fact), at most two most
      recent visible facts, and the visible mention count; no future aliases.
- [ ] Dismiss by tapping outside and by Android Back.
- [ ] Expected: the card closes without changing the reading position.

## Sentence Navigation And Return Position

- [ ] Tap facts and mentions in the same chapter and across chapters, in both
      readaloud and plain ebook editions, with paginated and scroll layouts.
- [ ] Expected: navigation uses the open edition's resource path and media
      type. Readaloud targets sentence spans; plain ebooks use Readium's exact
      text-quote anchoring, retaining progression only as a fallback.
- [ ] Tap a fact whose source sentence is earlier than its passage-end stamp.
- [ ] Expected: the fact only appears at/after its `at` stamp, but tapping it
      jumps to `sentence`, not the end of the passage.
- [ ] Repeat with escaped/non-ASCII chapter paths in both the index and open
      edition manifest. Include an unrelated filename sharing only a suffix.
- [ ] Expected: decoded full path segments match; partial filenames do not.
- [ ] Jump away first using a bookmark, highlight, or TOC item, then use X-Ray.
- [ ] Expected: X-Ray preserves the already-active return location.
- [ ] Use All mentions from the selection card, then jump repeatedly.
- [ ] Expected: the selected entity opens directly; jumps preserve the original
      return location rather than replacing it at each stop.
- [ ] Keep an old return control visible while reading past its location.
- [ ] Expected: both current and return locators resolve independently; the
      farther boundary wins. An old cover/unresolvable return cannot leave the
      index empty, and earlier mention hops do not erase later knowledge.

## Placement, Accessibility, And Privacy

- [ ] Check five/six-action new-selection toolbars and six/seven-action saved-
      highlight toolbars, at narrow widths and near every screen edge.
- [ ] Expected: actions fit or wrap into complete rows; the X-Ray card uses the
      same safe-area-aware placement and tablet width cap as definitions.
- [ ] Navigate scope/type chips, list rows, back/order controls, card, facts,
      and mentions with TalkBack/VoiceOver.
- [ ] Expected: meaningful names and roles, selected filters announced, and
      unavailable edition targets reported as disabled.
- [ ] Inspect logs and network requests after selection and card interactions.
- [ ] Expected: no selected text or book contents are logged or sent for X-Ray
      lookup. The index contains no per-user position; filtering stays local.

## Cache And Closed-Sheet Performance

- [ ] Profile a large index while listening with the navigation sheet closed;
      repeat with Contents selected and X-Ray unfocused.
- [ ] Expected: no X-Ray view rebuild or full-index JSON parse per sentence;
      unfocused X-Ray content has no live position subscription.
- [ ] Open X-Ray, change scope/type, then select/drag a name without moving its
      sentence boundary.
- [ ] Expected: the parsed index is shared through RTK Query; `viewXray` is
      memoized by index/boundary rather than re-created for every UI render or
      handle/text change. No selection means no selected-entity view work.
