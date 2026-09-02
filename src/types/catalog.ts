/**
 * Shared catalog (layer/folder tree) types.
 * Extracted from App.tsx so that extracted components can import them
 * without creating circular dependencies.
 */

export type Folder = {
  id: string;
  name: string;
  type: 'folder';
  expanded: boolean;
  children: (Layer | Folder)[];
  createdAt: string;
};

export type Layer = {
  id: string;
  name: string;
  type: 'layer';
  color: string;
  visible: boolean;
  geojson: any;
  files: string[];
  uploadedAt: string;
};