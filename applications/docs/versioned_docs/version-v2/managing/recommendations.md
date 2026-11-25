# Ask and recommendations

---

Readers can type what they want ("The Gates of Rome and Killer of Men", "the
next Expanse book", "I just finished Post Captain", "something like Sharpe but
at sea") and get real books back, and the app keeps a short list of picks for
each reader that refreshes on its own. Every pick ends in the
[request picker](./book-requests.md): nothing is ever requested without the
reader tapping it.

Recommendations are off until an Anthropic API key is set (Settings →
Processing, the same key X-Ray uses). With no key, every recommendation control
is hidden.

## Setting it up

| Setting                             | Meaning                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Anthropic API key                   | Shared with X-Ray.                                                                    |
| Recommendation model                | Picks and ranks books and writes the reasons. Default `claude-sonnet-5-5`.            |
| Fast recommendation model           | Reads what readers type and helps match imported history. Default `claude-haiku-5-5`. |
| Monthly recommendation budget (USD) | Weekly and automatic picks stop for the month once spent. Default 5.                  |

Book data comes from public catalogs (Audible's catalog for audiobooks, series
and similar titles; Open Library for ISBNs and books without an audiobook). No
catalog key is needed. Answers are cached in the database.

A typical full set of picks costs a few US cents. Readers can refresh by hand
three times a day; asking and steering always work, even once the budget is
spent.

## What readers see

- **Ask**, from the app's Recommendations screen or from Search when nothing in
  the library matches. Named books come back as cards that say what is already
  true: on your shelf, on your To read, in the library (never whose), or Get. A
  title that could mean several books asks which one; a title the catalog does
  not know says so instead of guessing.
- **For you** on Home: six to eight picks, hideable in Customize home.
- **Recommendations**: picks in three sections (Missing from your series, From
  your lists, Discover), plus "For what you asked" after the reader steers the
  picks and "Because you finished …" after they finish a book. Each pick has a
  short reason and the facts it rests on. Readers can Get, Save, mark it already
  read, put it off for eight weeks, or turn it down for good.
- **Tune**: a few questions (what they are after, series or standalone, series
  length, subjects, format) that steer one set of picks, optionally saved as
  their usual preferences. Series length is a preference, never a filter: a
  strong shorter series still shows, labeled.

## When picks refresh

- Every Sunday at 05:00 server time, readers half an hour apart.
- After a reading history import.
- Half an hour after a reader marks a single book Read. Marking several books
  read at once starts nothing.
- When the reader asks, steers or refreshes.
- Every day at 04:00 the server checks the series each reader follows for new
  books, without using the model, and can send a "New book in your series"
  notification (on its own notification channel).

A refresh that fails or is cut short by a restart leaves the previous picks in
place; an interrupted one is retried once.

## Reading history

Each reader can import their own history on the web, under their account menu →
Reading history:

- **Goodreads**: My Books → Import/Export → Export library, then upload the CSV.
- **Audible**: `audible-cli library export -f json` on their own computer, then
  upload the JSON.
- **Kindle**: Amazon's "Request your data" export; only the Kindle reading and
  ownership files are read. Kindle reading time is an estimate, so a book it
  suggests was read is only noted, never hidden.

Export files are never stored. Books that cannot be matched to the catalog can
be matched by hand or ignored. Each source can be deleted on its own; books
marked "Already read" from a pick are kept apart and survive re-imports.

## Privacy

Each reader's history, profile and picks are theirs alone. Every model call is
for one reader and holds only that reader's titles, authors, ratings and
answers, never book text. A reader can turn off "Use my reading history" to base
picks only on their Storyteller library and answers.
