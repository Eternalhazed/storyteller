import {
  type FetchArgs as BaseFetchArgs,
  createApi,
  fetchBaseQuery,
} from "@reduxjs/toolkit/query/react"
import * as SecureStore from "expo-secure-store"

import { type BookWithRelations } from "@storyteller/web/src/database/books"
import { type Position } from "@storyteller/web/src/database/positions"
import { type Status } from "@storyteller/web/src/database/statuses"
import {
  type AskResult,
  type InterviewView,
  type PickView,
  type ReaderPickState,
  type RecommendationHistoryView,
  type RecommendationPreferences,
  type RecommendationsConfig,
  type RecommendationsView,
  type RoundView,
  type StartRoundInput,
} from "@storyteller/web/src/recommendations/types"
import { type RequestView } from "@storyteller/web/src/requests/http"
import { type LibraryCopy } from "@storyteller/web/src/requests/library"
import {
  type RankedRelease,
  type Recommendation,
} from "@storyteller/web/src/requests/ranking"
import {
  type ChosenWork,
  type Release,
  type RequestFormat,
  type RequestInput,
  type RequestKind,
} from "@storyteller/web/src/requests/types"

import { upsertServerBooks } from "@/database/serverBooks"
import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { type UUID } from "@/uuid"

import { localApi } from "./localApi"

interface FetchArgs extends BaseFetchArgs {
  serverUuid: UUID
}

/** Account-scoped shelf metadata and ordered manual membership from /shelves. */
export interface ServerShelf {
  uuid: UUID
  name: string
  filter: unknown | null
  filterIssues?: unknown[]
  books: { bookUuid: UUID; position: number }[]
  createdAt: string
  updatedAt: string
}

type RequestServer = { serverUuid: UUID }
type RequestKey = RequestServer & { requestUuid: UUID }
type PickKey = RequestServer & { recommendationUuid: UUID }
type RoundKey = RequestServer & { roundUuid: UUID }
type RequestSearch = RequestServer & { work: ChosenWork; seriesUuid?: UUID }
type ReleaseRef = Pick<Release, "source" | "id" | "kind">

export type RequestConfig = {
  enabled: boolean
  collection: UUID | null
  collections: { uuid: UUID; name: string }[]
}

export type RequestSearchResult = {
  library: { mine: LibraryCopy[]; elsewhere: LibraryCopy[] }
  ebooks: RankedRelease[]
  audios: RankedRelease[]
  recommendation: Recommendation
}

type CreateRequest = RequestServer & {
  kind: RequestKind
  input: RequestInput
  work: ChosenWork
  ebook?: ReleaseRef | null
  audio?: ReleaseRef | null
  bookUuid?: UUID
}

type RequestDetail = RequestView & {
  events: { kind: string; message: string; createdAt: string }[]
}

function requestTag(serverUuid: UUID, requestUuid?: UUID) {
  return {
    type: "Requests" as const,
    id: requestUuid ? `${serverUuid}:${requestUuid}` : serverUuid,
  }
}

function changedRequest(result: RequestView | undefined, args: RequestKey) {
  return result
    ? [
        requestTag(args.serverUuid),
        requestTag(args.serverUuid, args.requestUuid),
      ]
    : []
}

function recommendationTag(serverUuid: UUID, key?: UUID | "preferences") {
  return {
    type: "Recommendations" as const,
    id: key ? `${serverUuid}:${key}` : serverUuid,
  }
}

export const serverApi = createApi({
  reducerPath: "serverApi",
  tagTypes: ["Requests", "RequestConfig", "Recommendations"],
  async baseQuery(
    args: FetchArgs,
    baseQueryApi,
    extraOptions?: { auth?: boolean },
  ) {
    const serverUuid = args.serverUuid

    const { data: servers = [] } = await baseQueryApi.dispatch(
      localApi.endpoints.listServers.initiate(undefined, { subscribe: false }),
    )

    const server = servers.find((server) => server.uuid === serverUuid)

    if (!server) {
      throw new Error("Failed to make server request, no server configured")
    }

    const makeRequest = fetchBaseQuery({
      baseUrl: new URL("/api/v2", server.baseUrl).toString(),
      async prepareHeaders(headers) {
        if (extraOptions?.auth === false) return

        const accessToken = await SecureStore.getItemAsync(
          `server.${server.uuid}.token`,
        )
        if (!accessToken) return

        headers.set("Authorization", `Bearer ${accessToken}`)

        return headers
      },
      // We use token based auth on mobile. We want to
      // prompt users to log in and produce a mobile app token
      // after upgrading, so we specifically prevent sending
      // cookies, even if there was a valid cookie on
      // device from the v1 auth system
      credentials: "omit",
    })

    return makeRequest(args, baseQueryApi, extraOptions ?? {})
  },
  endpoints: (build) => ({
    getRecommendationsConfig: build.query<RecommendationsConfig, RequestServer>(
      {
        query: ({ serverUuid }) => ({
          url: "/recommendations/config",
          serverUuid,
          timeout: 5_000,
        }),
        keepUnusedDataFor: 3600,
      },
    ),
    getRecommendations: build.query<RecommendationsView, RequestServer>({
      query: ({ serverUuid }) => ({
        url: "/recommendations",
        serverUuid,
        timeout: 5_000,
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        recommendationTag(serverUuid),
      ],
      keepUnusedDataFor: 3600,
    }),
    getRecommendationHistory: build.query<
      RecommendationHistoryView,
      RequestServer
    >({
      query: ({ serverUuid }) => ({
        url: "/recommendations/history",
        serverUuid,
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        recommendationTag(serverUuid),
      ],
    }),
    startRecommendationRound: build.mutation<
      RoundView,
      RequestServer & StartRoundInput
    >({
      query: ({ serverUuid, ...body }) => ({
        url: "/recommendations/rounds",
        serverUuid,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, _error, { serverUuid, answers }) =>
        result
          ? [
              recommendationTag(serverUuid),
              ...(answers?.saveAsUsual
                ? [recommendationTag(serverUuid, "preferences")]
                : []),
            ]
          : [],
    }),
    getRecommendationRound: build.query<
      RoundView & { picks: PickView[] },
      RoundKey
    >({
      query: ({ serverUuid, roundUuid }) => ({
        url: `/recommendations/rounds/${roundUuid}`,
        serverUuid,
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        recommendationTag(serverUuid),
      ],
    }),
    getRecommendationPick: build.query<PickView, PickKey>({
      query: ({ serverUuid, recommendationUuid }) => ({
        url: `/recommendations/picks/${recommendationUuid}`,
        serverUuid,
        timeout: 5_000,
      }),
      providesTags: (_result, _error, { serverUuid, recommendationUuid }) => [
        recommendationTag(serverUuid, recommendationUuid),
      ],
    }),
    setRecommendationPickState: build.mutation<
      PickView,
      PickKey & { state: ReaderPickState; reason?: string; rating?: number }
    >({
      query: ({ serverUuid, recommendationUuid, ...body }) => ({
        url: `/recommendations/picks/${recommendationUuid}`,
        serverUuid,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, _error, { serverUuid, recommendationUuid }) =>
        result
          ? [
              recommendationTag(serverUuid),
              recommendationTag(serverUuid, recommendationUuid),
            ]
          : [],
    }),
    getRecommendationPreferences: build.query<
      RecommendationPreferences,
      RequestServer
    >({
      query: ({ serverUuid }) => ({
        url: "/recommendations/preferences",
        serverUuid,
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        recommendationTag(serverUuid, "preferences"),
      ],
    }),
    setRecommendationPreferences: build.mutation<
      RecommendationPreferences,
      RequestServer & Partial<RecommendationPreferences>
    >({
      query: ({ serverUuid, ...body }) => ({
        url: "/recommendations/preferences",
        serverUuid,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, _error, { serverUuid }) =>
        result
          ? [
              recommendationTag(serverUuid, "preferences"),
              recommendationTag(serverUuid),
            ]
          : [],
    }),
    getRecommendationInterview: build.query<InterviewView, RequestServer>({
      query: ({ serverUuid }) => ({
        url: "/recommendations/interview",
        serverUuid,
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        recommendationTag(serverUuid, "preferences"),
        recommendationTag(serverUuid),
      ],
    }),
    askForBooks: build.mutation<AskResult, RequestServer & { text: string }>({
      query: ({ serverUuid, text }) => ({
        url: "/ask",
        serverUuid,
        method: "POST",
        body: { text },
      }),
      invalidatesTags: (result, _error, { serverUuid }) =>
        result?.intent === "next" || result?.intent === "wish"
          ? [recommendationTag(serverUuid)]
          : [],
    }),
    getRequestConfig: build.query<RequestConfig, RequestServer>({
      query: ({ serverUuid }) => ({ url: "/requests/config", serverUuid }),
      providesTags: (_result, _error, { serverUuid }) => [
        { type: "RequestConfig", id: serverUuid },
      ],
    }),
    setRequestCollection: build.mutation<
      void,
      RequestServer & { collection: UUID }
    >({
      query: ({ serverUuid, collection }) => ({
        url: "/requests/config",
        serverUuid,
        method: "PUT",
        body: { collection },
      }),
      invalidatesTags: (_result, error, { serverUuid }) =>
        error ? [] : [{ type: "RequestConfig", id: serverUuid }],
    }),
    listRequests: build.query<RequestView[], RequestServer & { open?: true }>({
      query: ({ serverUuid, open }) => ({
        url: "/requests",
        serverUuid,
        ...(open ? { params: { open: true } } : {}),
      }),
      providesTags: (_result, _error, { serverUuid }) => [
        requestTag(serverUuid),
      ],
    }),
    getRequest: build.query<RequestDetail, RequestKey>({
      query: ({ serverUuid, requestUuid }) => ({
        url: `/requests/${requestUuid}`,
        serverUuid,
      }),
      providesTags: (_result, _error, { serverUuid, requestUuid }) => [
        requestTag(serverUuid, requestUuid),
      ],
    }),
    searchRequestReleases: build.mutation<RequestSearchResult, RequestSearch>({
      query: ({ serverUuid, ...body }) => ({
        url: "/requests/search",
        serverUuid,
        method: "POST",
        body,
      }),
    }),
    createRequest: build.mutation<RequestView, CreateRequest>({
      query: ({ serverUuid, ...body }) => ({
        url: "/requests",
        serverUuid,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, _error, { serverUuid, input }) =>
        result
          ? [
              requestTag(serverUuid),
              ...(input.recommendationUuid
                ? [
                    recommendationTag(serverUuid),
                    recommendationTag(serverUuid, input.recommendationUuid),
                  ]
                : []),
            ]
          : [],
    }),
    addRequestCopyToShelf: build.mutation<
      void,
      RequestServer & { work: ChosenWork; bookUuid: UUID }
    >({
      query: ({ serverUuid, ...body }) => ({
        url: "/requests/add-to-shelf",
        serverUuid,
        method: "POST",
        body,
      }),
    }),
    replaceRequestRelease: build.mutation<
      RequestView,
      RequestKey & { format: RequestFormat; release: ReleaseRef }
    >({
      query: ({ serverUuid, requestUuid, ...body }) => ({
        url: `/requests/${requestUuid}/release`,
        serverUuid,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, _error, args) => changedRequest(result, args),
    }),
    retryRequestSync: build.mutation<RequestView, RequestKey>({
      query: ({ serverUuid, requestUuid }) => ({
        url: `/requests/${requestUuid}/retry-sync`,
        serverUuid,
        method: "POST",
      }),
      invalidatesTags: (result, _error, args) => changedRequest(result, args),
    }),
    dismissRequest: build.mutation<RequestView, RequestKey>({
      query: ({ serverUuid, requestUuid }) => ({
        url: `/requests/${requestUuid}/dismiss`,
        serverUuid,
        method: "POST",
      }),
      invalidatesTags: (result, _error, args) => changedRequest(result, args),
    }),
    listShelves: build.query<ServerShelf[], { serverUuid: UUID }>({
      query: ({ serverUuid }) => ({ url: "/shelves", serverUuid }),
    }),
    getShelfBooks: build.query<
      BookWithRelations[],
      { serverUuid: UUID; shelfUuid: UUID; limit?: number }
    >({
      query: ({ serverUuid, shelfUuid, limit = 50 }) => ({
        url: `/shelves/${shelfUuid}/books`,
        serverUuid,
        params: { limit },
      }),
    }),
    createShelf: build.mutation<
      ServerShelf,
      { serverUuid: UUID; name: string; books: UUID[] }
    >({
      query: ({ serverUuid, name, books }) => ({
        url: "/shelves",
        serverUuid,
        method: "POST",
        body: { name, filter: null, books },
      }),
    }),
    updateShelfBooks: build.mutation<
      ServerShelf,
      { serverUuid: UUID; shelfUuid: UUID; books: UUID[] }
    >({
      query: ({ serverUuid, shelfUuid, books }) => ({
        url: `/shelves/${shelfUuid}`,
        serverUuid,
        method: "PUT",
        // PUT is partial: omitting name/filter preserves both. `books`
        // replaces all membership and assigns positions in array order.
        body: { books },
      }),
    }),
    listBooks: build.query<BookWithRelations[], { serverUuid: UUID }>({
      query: ({ serverUuid }) => ({ url: "/books", serverUuid }),
    }),
    getBook: build.query<
      BookWithRelations,
      { serverUuid: UUID; bookUuid: UUID }
    >({
      query: ({ bookUuid, serverUuid }) => ({
        url: `/books/${bookUuid}`,
        serverUuid,
      }),
      async transformResponse(book: BookWithRelations, _meta, { serverUuid }) {
        // Callers opening a just-delivered book need its formats in SQLite
        // before the existing local book screen mounts.
        await upsertServerBooks([book], serverUuid)
        return book
      },
      async onQueryStarted(
        { serverUuid, bookUuid },
        { queryFulfilled, dispatch },
      ) {
        const result = await queryFulfilled.catch(() => null)
        if (!result) return
        const { data: book } = result
        dispatch(
          serverApi.util.updateQueryData(
            "listBooks",
            { serverUuid },
            (draft) => {
              const draftBookIndex = draft.findIndex(
                (book) => book.uuid === bookUuid,
              )
              if (draftBookIndex === -1) {
                draft.push(book)
                return
              }
              draft.splice(draftBookIndex, 1, book)
            },
          ),
        )
        dispatch(localApi.util.invalidateTags(["Books"]))
      },
    }),
    updatePosition: build.mutation<
      null,
      {
        bookUuid: UUID
        serverUuid: UUID
        locator: ReadiumLocator
        timestamp: number
      }
    >({
      query: ({ bookUuid, serverUuid, locator, timestamp }) => ({
        url: `/books/${bookUuid}/positions`,
        serverUuid,
        method: "POST",
        body: {
          locator,
          timestamp,
        },
      }),
    }),
    getPosition: build.query<Position, { bookUuid: UUID; serverUuid: UUID }>({
      query: ({ bookUuid, serverUuid }) => ({
        url: `/books/${bookUuid}/positions`,
        serverUuid,
      }),
    }),
    listStatuses: build.query<Status[], { serverUuid: UUID }>({
      query: ({ serverUuid }) => ({
        url: `/statuses`,
        serverUuid,
      }),
    }),
    updateStatus: build.mutation<
      void,
      { bookUuid: UUID; serverUuid: UUID; statusUuid: UUID }
    >({
      query: ({ bookUuid, serverUuid, statusUuid }) => ({
        url: `/books/${bookUuid}/status`,
        serverUuid,
        method: "PUT",
        body: {
          status: statusUuid,
        },
      }),
    }),
  }),
})

export const { useListBooksQuery, useLazyGetBookQuery } = serverApi

export function getDownloadUrl(
  baseUrl: string,
  bookUuid: string,
  format: "readaloud" | "audiobook" | "ebook",
) {
  const url = new URL(`/api/v2/books/${bookUuid}/files`, baseUrl)
  url.searchParams.append("format", format)
  return url.toString()
}

export const COVER_SIZES = {
  text: { width: 232, height: 352 },
  audio: { width: 232, height: 232 },
} as const

export function getImageUrl(baseUrl: string, sha256: string, size: number) {
  const url = new URL(`/api/v2/images/${sha256}`, baseUrl)
  url.searchParams.append("s", Math.round(size).toString())
  return url.toString()
}

export function getCoverUrl(
  baseUrl: string,
  book: {
    uuid: string
    textCoverSha256: string | null
    audioCoverSha256: string | null
    serverUpdatedAt: string | null
  },
  kind: "text" | "audio",
): string {
  const sha256 = kind === "text" ? book.textCoverSha256 : book.audioCoverSha256

  if (sha256 === null) {
    return getLegacyCoverUrl(baseUrl, book.uuid, {
      width: COVER_SIZES[kind].width,
      height: COVER_SIZES[kind].height,
      audio: kind === "audio",
      serverUpdatedAt: book.serverUpdatedAt,
    })
  }

  return getImageUrl(
    baseUrl,
    sha256,
    Math.max(COVER_SIZES[kind].height, COVER_SIZES[kind].width),
  )
}

export function getLegacyCoverUrl(
  baseUrl: string,
  bookUuid: string,
  {
    height,
    width,
    audio = false,
    serverUpdatedAt,
  }: {
    height?: number
    width?: number
    audio?: boolean
    serverUpdatedAt?: string | null
  } = {},
) {
  const url = new URL(`/api/v2/books/${bookUuid}/cover`, baseUrl)

  if (audio) {
    url.searchParams.append("audio", "true")
  }
  if (height) {
    url.searchParams.append("h", height.toString())
  }
  if (width) {
    url.searchParams.append("w", width.toString())
  }
  if (serverUpdatedAt) {
    url.searchParams.append("v", new Date(serverUpdatedAt).valueOf().toString())
  }
  return url.toString()
}
