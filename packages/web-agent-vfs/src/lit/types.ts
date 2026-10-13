import type { VfsMountInfo, VfsResolvedEntry } from "../types.js";

export interface TreeNode {
  kind: "folder" | "file";
  name: string;
  path: string;
  mount?: VfsMountInfo;
  error?: string;
  file?: VfsResolvedEntry;
  children: Map<string, TreeNode>;
}
