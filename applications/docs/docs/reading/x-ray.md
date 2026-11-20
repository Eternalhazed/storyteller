---
sidebar_position: 4
---

# X-Ray

X-Ray is a spoiler-safe reference for the book you are reading. It keeps track
of characters, places, groups, and important things, with descriptions, key
facts, and the sentences that mention them. In a Storyteller reader that
supports X-Ray, the information grows as you read instead of revealing the whole
book at once.

## Enable X-Ray

A server administrator can configure X-Ray on the web **Settings** page. In the
v3 interface, open **Processing**, then find the **X-Ray** section; the earlier
web interface has an **X-Ray** section directly on the Settings page.

1. Enter an **Anthropic API key**. This is a separate provider credential, not
   your Storyteller password. Storyteller stores the key encrypted with its
   other provider credentials.
2. Choose a **Model**, or keep the default, `claude-haiku-5-5`.
3. Optionally enable **Generate X-Ray automatically**. It is off by default.
   When enabled, Storyteller queues X-Ray for newly imported ebooks and after
   successful readaloud creation, provided the book does not already have X-Ray.
4. Save the settings.

You can also provide these settings through
[declarative configuration](../installation/self-hosting.md#declarative-configuration).

:::warning Book text leaves your server

Generating X-Ray sends the book's text to **Anthropic**, using its paid API.
This is different from local audiobook transcription: X-Ray generation is not an
on-device or entirely self-hosted operation. Only enable it for books you are
comfortable sending to that provider.

:::

## Cost

With the default model, measured generation costs are about **US $0.05 for a
short novel** and **US $0.20–$0.25 for a long novel of 150,000 words or more**.
These are estimates, not fixed prices: book length, the selected model, and
Anthropic's current pricing affect the actual charge. Regenerating a completed
X-Ray uses the API again. Paused or interrupted generation saves completed
passages so a resume or retry does not need to send those passages again.

## How spoiler safety works

Storyteller generates X-Ray by reading the ebook in order, one passage at a
time, without showing the model later passages. Names, descriptions, facts, and
passage summaries are recorded with the point in the book where they become
known. When you open X-Ray in a supported reader, it filters that information
and the list of matching sentences to your current reading position, so later
revelations stay hidden. X-Ray is shared for the book, but the visibility
boundary comes from each reader's own position; it is not based on another
person's progress. Like other generated text, its descriptions can still contain
mistakes. A passage the model cannot answer may be skipped, so some information
can be missing.

## Generate or regenerate a book

Open a book's processing actions in either web interface and choose **Generate
or regenerate X-Ray**. You need permission to process books, an available ebook,
and a configured Anthropic key. The action works for ebooks without an audiobook
as well as books with synchronized narration.

Generation runs in the **processing queue**, where it is labelled **X-Ray**. One
X-Ray job can run alongside one readaloud-alignment job, so it does not wait for
a long alignment to finish. You can pause, resume, or cancel it from the queue.
An in-flight passage is allowed to finish and save before a pause or
cancellation takes effect.

To refresh an existing X-Ray—for example, after changing the model—wait for any
current X-Ray job to finish, then choose **Generate or regenerate X-Ray** again.
The existing X-Ray remains available until its replacement is ready. If a job is
paused, resume it from the queue; generating again does not unpause it. If you
have just paused or cancelled a running job, wait for its in-flight passage to
finish before trying again.

If generation fails, check the job's error in the queue, correct the problem,
and request generation again to resume its saved progress. X-Ray generation does
not change the book's readaloud status.
