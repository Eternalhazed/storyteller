import { ActionIcon, Tooltip } from "@mantine/core"
import { IconBook2 } from "@tabler/icons-react"

import { type BookWithRelations } from "@/database/books"
import { usePermissions } from "@/hooks/usePermissions"
import { useGenerateXrayMutation, useGetXrayEnabledQuery } from "@/store/api"

import messages from "../../../messages/en.json"

import { ProcessingItems } from "./ProcessingItems"

type Props = {
  book: BookWithRelations
  aligned: boolean
}

export function BookOptions({ book, aligned }: Props) {
  const permissions = usePermissions()
  const { data: xray } = useGetXrayEnabledQuery(undefined, {
    skip: !permissions?.bookProcess,
  })
  const [generateXray, { isLoading, isError, isSuccess, error }] =
    useGenerateXrayMutation()
  const labels = messages.Xray
  const serverMessage =
    error &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
      ? error.data.message
      : null
  const xrayLabel = isError
    ? serverMessage ?? labels.failed
    : isSuccess
      ? labels.queued
      : labels.generate

  return (
    <>
      {permissions?.bookProcess &&
        book.readaloud &&
        book.readaloud.status !== "CREATED" && (
          <ProcessingItems aligned={aligned} book={book} />
        )}
      {permissions?.bookProcess &&
        xray?.configured &&
        book.ebook &&
        !book.ebook.missing && (
          <Tooltip label={xrayLabel}>
            <ActionIcon
              variant="subtle"
              loading={isLoading}
              color={isError ? "red" : "black"}
              aria-label={labels.generate}
              onClick={() => void generateXray({ uuid: book.uuid })}
            >
              <IconBook2 aria-hidden />
            </ActionIcon>
          </Tooltip>
        )}
    </>
  )
}
