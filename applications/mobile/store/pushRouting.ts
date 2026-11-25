import { parseRequestUuid } from "./requestNavigation"

export function pushDestination(
  data: Record<string, unknown> | null | undefined,
) {
  const requestUuid = parseRequestUuid(data?.["requestUuid"])
  if (requestUuid)
    return {
      pathname: "/request/[uuid]" as const,
      params: { uuid: requestUuid },
    }
  const recommendationUuid = parseRequestUuid(data?.["recommendationUuid"])
  if (recommendationUuid)
    return {
      pathname: "/recommendations/pick/[uuid]" as const,
      params: { uuid: recommendationUuid, notification: "true" },
    }
  return null
}
