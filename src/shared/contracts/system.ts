import type { AdapterCapability, VerificationRecipe } from './runs'
import type { ImageAttachment } from './agents'

export type SelectedDirectoryPath = string | null

export interface SaveImageAttachmentInput {
  dataUrl: string
  name?: string
  mimeType?: string
}

export type { AdapterCapability, VerificationRecipe }
export type { ImageAttachment }
