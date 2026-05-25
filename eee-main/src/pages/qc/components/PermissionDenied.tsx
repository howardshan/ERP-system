import React from 'react';
import { Lock } from 'lucide-react';

interface Props {
  /** Permission key shown to the user, e.g. "qc.testing.view_status" */
  permission: string;
  /** Optional short description of what the user is missing access to */
  feature?: string;
}

/** Standard "you can't see this page" panel, used by every QC page that
 *  guards its top-level view permission. Keeps look + copy consistent. */
export function PermissionDenied({ permission, feature }: Props) {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex gap-4">
        <Lock size={20} className="text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-amber-900">No access</p>
          <p className="text-sm text-amber-800">
            You don't have permission to view {feature ?? 'this page'}.
          </p>
          <p className="text-xs text-amber-700">
            Required permission: <code className="font-mono">{permission}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
