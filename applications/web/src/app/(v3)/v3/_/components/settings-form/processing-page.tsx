"use client"

import {
  ProcessingSettingsFields,
  ReadaloudSection,
  XraySection,
} from "./processing-tab"

export function ProcessingPage() {
  return (
    <div className="space-y-6">
      <ProcessingSettingsFields />
      <ReadaloudSection />
      <XraySection />
    </div>
  )
}
