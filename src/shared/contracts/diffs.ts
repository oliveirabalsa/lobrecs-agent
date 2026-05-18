export interface DiffProposal {
  filePath: string
  originalContent: string
  proposedContent: string
  description?: string
  changeType?: 'added' | 'modified' | 'deleted'
  additions?: number
  deletions?: number
  baseHash?: string
  status?: 'pending' | 'applied' | 'approved' | 'rejected' | 'conflict'
}

export interface ApprovalRequest {
  action: 'write-file' | 'run-command' | 'delete-file' | 'other'
  description: string
  details: string
  risk?: 'low' | 'medium' | 'high'
  command?: string
  cwd?: string
  filePath?: string
  raw?: unknown
}
