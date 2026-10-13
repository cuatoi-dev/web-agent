// types.ts — shared shapes for the utils modules.

export interface PointedElementSnapshot {
  ref: number;
  text: string;
}

export type CheckVisibilityCapable = Element & {
  checkVisibility?: (opts?: {
    checkOpacity?: boolean;
    checkVisibilityCSS?: boolean;
  }) => boolean;
};
