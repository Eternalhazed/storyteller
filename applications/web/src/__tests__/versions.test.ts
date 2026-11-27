import { describe, expect, it } from "vitest"

import { compareVersions, releaseChannelTags } from "@/versions"

describe("a build labelled with upstream's version plus build metadata", () => {
  const build = "3.0.0-beta.61+fork.1523fc539"

  it("is not older than the upstream release it is built from", () => {
    expect(compareVersions("3.0.0-beta.61", build)).toBe(0)
  })

  it("is older than the next upstream beta", () => {
    expect(compareVersions("3.0.0-beta.62", build)).toBe(1)
  })

  it("is newer than the stable 2.x line", () => {
    expect(compareVersions("2.14.25", build)).toBe(-1)
  })

  it("follows the beta release channel", () => {
    expect(releaseChannelTags(build)).toEqual(["rc", "beta"])
  })
})
