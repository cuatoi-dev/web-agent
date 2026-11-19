// The shape panel-frame-snapshot.ts builds from Page.getFrameTree.
// wa/types-in-types-file requires it live here, not in the implementation
// file.

export interface FrameNode {
  id: string;
  url: string;
  children: FrameNode[];
}
