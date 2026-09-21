import {
  Folder,
  ChevronDown,
  ChevronRight,
  Navigation,
  Edit2,
  Trash2
} from 'lucide-react';
import type { Layer as CatalogLayer, Folder as CatalogFolder } from '../../types/catalog';

export type Layer = CatalogLayer;
export type FolderType = CatalogFolder;

// Find item in tree by id
export function findItem(items: (Layer | FolderType)[], id: string): (Layer | FolderType) | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.id === id) return item;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const found = findItem(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Update item in tree
export function updateItem(
  items: (Layer | FolderType)[],
  id: string,
  updater: (item: Layer | FolderType) => Layer | FolderType
): (Layer | FolderType)[] {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return item;
    if (item.id === id) {
      return updater(item);
    }
    if (item.type === 'folder' && Array.isArray(item.children)) {
      return { ...item, children: updateItem(item.children, id, updater) };
    }
    return item;
  });
}

// Delete item from tree
export function removeItemFromTree(items: (Layer | FolderType)[], id: string): (Layer | FolderType)[] {
  if (!Array.isArray(items)) return [];
  return items.filter(item => {
    if (!item) return false;
    if (item.id === id) return false;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      item.children = removeItemFromTree(item.children, id);
    }
    return true;
  });
}

// Add item to folder (or root if folderId is null)
export function addItemToFolder(
  items: (Layer | FolderType)[],
  itemToAdd: Layer | FolderType,
  folderId: string | null
): (Layer | FolderType)[] {
  if (!Array.isArray(items)) return [itemToAdd];
  if (!folderId) {
    return [...items, itemToAdd];
  }
  return items.map(item => {
    if (!item) return item;
    if (item.type === 'folder') {
      const children = Array.isArray(item.children) ? item.children : [];
      if (item.id === folderId) {
        return { ...item, children: [...children, itemToAdd] };
      }
      return { ...item, children: addItemToFolder(children, itemToAdd, folderId) };
    }
    return item;
  });
}

// Get flat list of folders with their paths
export function getFlatFolderList(
  items: (Layer | FolderType)[],
  path: string = ''
): Array<{ id: string; name: string; path: string }> {
  if (!Array.isArray(items)) return [];
  let folders: Array<{ id: string; name: string; path: string }> = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'folder') {
      const currentPath = path ? `${path} / ${item.name}` : item.name;
      folders.push({ id: item.id, name: item.name, path: currentPath });
      if (Array.isArray(item.children)) {
        folders = [...folders, ...getFlatFolderList(item.children, currentPath)];
      }
    }
  }
  return folders;
}

export interface CatalogItemProps {
  item: Layer | FolderType;
  depth?: number;
  catalog: 'staged' | 'saved';
  onToggleFolder: (id: string) => void;
  onToggleLayer: (id: string) => void;
  onEdit: (item: Layer | FolderType) => void;
  onDelete: (id: string) => void;
  onMove: (item: Layer | FolderType, catalog: 'staged' | 'saved') => void;
}

export const CatalogItem = ({
  item,
  depth = 0,
  catalog,
  onToggleFolder,
  onToggleLayer,
  onEdit,
  onDelete,
  onMove
}: CatalogItemProps) => {
  if (item.type === 'folder') {
    return (
      <div>
        <div
          className="bg-inner border border-subtle rounded-lg p-4"
          style={{ marginLeft: `${depth * 16}px` }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onToggleFolder(item.id)}>
              {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} className="text-amber-500" />
              <span className="text-text-base font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onMove(item, catalog); }}
                className="text-text-muted hover:text-emerald-400 transition-colors p-1"
                title="Move"
              >
                <Navigation size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                className="text-text-muted hover:text-sky-400 transition-colors p-1"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
            Created: {new Date(item.createdAt).toLocaleString()}
          </p>
        </div>
        {item.expanded && Array.isArray(item.children) && (
          <div className="mt-2 space-y-2">
            {item.children.map(child => child && (
              <CatalogItem
                key={child.id}
                item={child}
                depth={depth + 1}
                catalog={catalog}
                onToggleFolder={onToggleFolder}
                onToggleLayer={onToggleLayer}
                onEdit={onEdit}
                onDelete={onDelete}
                onMove={onMove}
              />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div
        className="bg-inner border border-subtle rounded-lg p-4"
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={item.visible}
              onChange={() => onToggleLayer(item.id)}
              className="w-4 h-4 text-sky-600 bg-inner border-subtle rounded focus:ring-sky-500"
            />
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-text-base font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMove(item, catalog)}
              className="text-text-muted hover:text-emerald-400 transition-colors p-1"
              title="Move"
            >
              <Navigation size={14} />
            </button>
            <button
              onClick={() => onEdit(item)}
              className="text-text-muted hover:text-sky-400 transition-colors p-1"
              title="Edit"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-text-muted hover:text-red-400 transition-colors p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Uploaded: {new Date(item.uploadedAt).toLocaleString()}
        </p>
      </div>
    );
  }
};
