import { type XrayScope } from "@/store/xrayNavigation"

export type NavigationMenuTab = "toc" | "bookmarks" | "highlights" | "xray"

const fallbackTab: NavigationMenuTab = "toc"
let lastNavigationMenuTab: NavigationMenuTab = fallbackTab
let lastXrayScope: XrayScope = "now"

function isNavigationMenuTab(value: string): value is NavigationMenuTab {
  return (
    value === "toc" ||
    value === "bookmarks" ||
    value === "highlights" ||
    value === "xray"
  )
}

export function getLastNavigationMenuTab(hasXray: boolean) {
  return lastNavigationMenuTab === "xray" && !hasXray
    ? fallbackTab
    : lastNavigationMenuTab
}

export function setLastNavigationMenuTab(tab: NavigationMenuTab) {
  lastNavigationMenuTab = tab
}

export function getNavigationMenuTabFromPathname(
  pathname: string,
): NavigationMenuTab | undefined {
  const tab = pathname.split("/").at(-1)

  return tab && isNavigationMenuTab(tab) ? tab : undefined
}

export function getLastXrayScope() {
  return lastXrayScope
}

export function setLastXrayScope(scope: XrayScope) {
  lastXrayScope = scope
}
