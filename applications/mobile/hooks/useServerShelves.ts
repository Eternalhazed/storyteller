import { useMemo } from "react"

import { useListShelvesQuery } from "@/store/localApi"
import { isShortlistShelf } from "@/store/shortlist"

/** Other account shelves, retaining the order supplied by each server. */
export function useServerShelves() {
  const { data: shelves } = useListShelvesQuery()
  return useMemo(
    () =>
      (shelves ?? [])
        .filter((shelf) => !isShortlistShelf(shelf))
        .map(({ uuid, name, kind, bookUuids }) => ({
          uuid,
          name,
          kind,
          bookUuids,
        })),
    [shelves],
  )
}
