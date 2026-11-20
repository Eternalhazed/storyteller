import { Button, Group, Modal, Stack, Text } from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { IconBook2 } from "@tabler/icons-react"

import { type BookWithRelations } from "@/database/books"
import { usePermissions } from "@/hooks/usePermissions"
import {
  useGenerateXrayMutation,
  useGetBookXrayStatusQuery,
  useGetJobsQuery,
  useGetXrayEnabledQuery,
} from "@/store/api"

import messages from "../../../messages/en.json"

import { ProcessingItems } from "./ProcessingItems"

type Props = {
  book: BookWithRelations
  aligned: boolean
}

export function BookOptions({ book, aligned }: Props) {
  const permissions = usePermissions()
  const [confirmRegenerate, { open, close }] = useDisclosure()
  const { data: xray } = useGetXrayEnabledQuery(undefined, {
    skip: !permissions?.bookProcess,
  })
  const { data: fileStatus, isError: fileStatusError } =
    useGetBookXrayStatusQuery(
      { uuid: book.uuid },
      { skip: !permissions?.bookProcess, refetchOnMountOrArgChange: true },
    )
  const {
    data: xrayJobs,
    isLoading: jobsLoading,
    isError: jobsError,
  } = useGetJobsQuery(
    { type: "active", jobType: "book_xray", bookUuid: book.uuid, limit: 1 },
    { skip: !permissions?.bookProcess },
  )
  const [generateXray, { isLoading, isError, error }] =
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
  const activeXrayJob = xrayJobs?.[0]
  const hasXray = fileStatus?.ready ?? false
  const actionLabel = hasXray ? labels.regenerate : labels.generate
  const disabled =
    !fileStatus ||
    fileStatusError ||
    jobsLoading ||
    jobsError ||
    !!activeXrayJob
  let stateLabel: string = labels.checking
  if (activeXrayJob?.status === "QUEUED") {
    stateLabel = labels.queued
  } else if (activeXrayJob?.status === "RUNNING") {
    const progress = Math.max(
      0,
      Math.min(100, Math.round(activeXrayJob.progress * 100)),
    )
    stateLabel = labels.running.replace("{progress}", String(progress))
  } else if (activeXrayJob?.status === "PAUSED") {
    stateLabel = labels.paused
  } else if (fileStatusError || jobsError) {
    stateLabel = labels.statusFailed
  } else if (fileStatus && !jobsLoading) {
    stateLabel = hasXray
      ? fileStatus.lastModified
        ? labels.readyAt.replace(
            "{date}",
            new Date(fileStatus.lastModified).toLocaleString(),
          )
        : labels.ready
      : labels.none
  }

  async function requestXray() {
    const result = await generateXray({ uuid: book.uuid })
    if (!("error" in result)) close()
  }

  return (
    <>
      {permissions?.bookProcess &&
        book.readaloud &&
        book.readaloud.status !== "CREATED" && (
          <ProcessingItems aligned={aligned} book={book} />
        )}
      {permissions?.bookProcess && (
        <Stack gap={4} className="min-w-0">
          <Text size="xs" c="dimmed" role="status">
            {stateLabel}
          </Text>
          {xray?.configured && book.ebook && !book.ebook.missing && (
            <Button
              size="compact-xs"
              variant="subtle"
              className="self-start"
              loading={isLoading}
              disabled={disabled}
              leftSection={<IconBook2 size={16} aria-hidden />}
              onClick={() => {
                if (hasXray) open()
                else void requestXray()
              }}
            >
              {actionLabel}
            </Button>
          )}
          {isError && !confirmRegenerate && (
            <Text size="xs" c="red" role="alert">
              {serverMessage ?? labels.failed}
            </Text>
          )}
        </Stack>
      )}
      <Modal
        opened={confirmRegenerate}
        onClose={close}
        title={labels.regenerateTitle.replace("{title}", book.title)}
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">{labels.regenerateWarning}</Text>
          {isError && (
            <Text size="sm" c="red" role="alert">
              {serverMessage ?? labels.failed}
            </Text>
          )}
          <Group justify="space-between">
            <Button variant="subtle" onClick={close} disabled={isLoading}>
              {messages.Common.actions.cancel}
            </Button>
            <Button
              loading={isLoading}
              disabled={disabled || !xray?.configured}
              onClick={() => void requestXray()}
            >
              {labels.regenerate}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
