/**
 * The site's spatial tree, editable — RM-028.
 *
 * Mounted from the Devices page as a sibling panel, the same shape `DeviceMetaEditor` and
 * `RemoveDevicePanel` already use: conditionally rendered, focus moves to its own heading, and
 * `onClose` is the caller's business.
 *
 * Deleting is the one destructive action here and goes through `useConfirm` like every other
 * one in this app — but with a count in the prompt, because a node's subtree is invisible from
 * the row being clicked and the database cascades.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { buildTree, type SpaceKind, type SpaceTreeNode } from '@/lib/spaceTree';
import { SPACE_KINDS, MAX_NAME_LENGTH } from '@/lib/supabaseSpaceTree';

/** Where a new node is being added: `null` parent means a new root, `undefined` means the form
 * is closed. The three states are distinct and collapsing them loses "add at top level". */
type AddTarget = { parent_id: string | null } | undefined;

export function SpaceTreePanel({ onClose }: { onClose?: () => void }) {
  const nodes = useSpaceTreeStore((s) => s.nodes);
  const error = useSpaceTreeStore((s) => s.error);
  const mutating = useSpaceTreeStore((s) => s.mutating);
  const canEdit = useSpaceTreeStore((s) => s.canEdit);
  const add = useSpaceTreeStore((s) => s.add);
  const remove = useSpaceTreeStore((s) => s.remove);
  const descendantCount = useSpaceTreeStore((s) => s.descendantCount);

  const [addTarget, setAddTarget] = useState<AddTarget>(undefined);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<SpaceKind>('room');

  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameId = useId();
  const kindId = useId();
  const { ask, modalProps } = useConfirm();

  const roots = useMemo(() => buildTree(nodes), [nodes]);

  // Same focus treatment the other panels use: the heading takes focus on open so a screen
  // reader lands here, without trapping — Tab still reaches the rest of the page, on purpose.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const openAdd = (parent_id: string | null) => {
    setAddTarget({ parent_id });
    setDraftName('');
    // A child of something is usually a room; a new root is usually a building. Only a default,
    // and the operator can change it — but it makes the common case a single field.
    setDraftKind(parent_id === null ? 'building' : 'room');
  };

  const submitAdd = () => {
    if (addTarget === undefined) return;
    void add({ parent_id: addTarget.parent_id, kind: draftKind, name: draftName });
    setAddTarget(undefined);
    setDraftName('');
  };

  const askDelete = (node: SpaceTreeNode) => {
    const inside = descendantCount(node.id);
    ask(
      {
        title: `Delete "${node.name}"?`,
        // The count is the whole point of this prompt. Deleting a floor takes its rooms, and
        // nothing about the clicked row says so.
        body:
          inside > 0
            ? `This also deletes the ${inside} space${inside === 1 ? '' : 's'} inside it. Devices placed in them keep their settings and become unplaced.`
            : 'Devices placed here keep their settings and become unplaced.',
        confirmLabel: 'Delete space',
        tone: 'red',
      },
      () => void remove(node.id),
    );
  };

  return (
    <Card className="space-tree-panel">
      <div className="space-tree-panel__head">
        <h2 className="card-title space-tree-panel__heading" tabIndex={-1} ref={headingRef}>
          Spaces
        </h2>
        {onClose && (
          <button type="button" className="space-tree-panel__close" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <p className="space-tree-panel__lede">
        Where things are, as a hierarchy — a building, its floors, the rooms on them. Devices are
        placed into these from each device's own Edit panel.
      </p>

      {/* An error here means the tree could not be read, which is NOT the same as the site
          having no rooms. Saying so prevents someone rebuilding a tree that already exists. */}
      {error && (
        <p className="space-tree-panel__error" role="alert">
          {error}
        </p>
      )}

      {/* A permanent property of the deployment, not a failure — local dev against the mock has
          no Supabase and never will. Saying so beats offering an Add button whose only possible
          outcome is an error. */}
      {!canEdit && (
        <p className="space-tree-panel__empty">
          Supabase is not configured for this deployment, so spaces are read-only here.
        </p>
      )}

      {canEdit && nodes.length === 0 && !error && (
        <p className="space-tree-panel__empty">
          No spaces yet. Add a building or a room to start — a site can be a single room, so
          there is no wrong place to begin.
        </p>
      )}

      <ul className="space-tree-panel__tree">
        {roots.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} mutating={mutating} canEdit={canEdit} onAdd={openAdd} onDelete={askDelete} />
        ))}
      </ul>

      <div className="space-tree-panel__actions">
        <button type="button" className="space-tree-panel__add-root" disabled={mutating || !canEdit} onClick={() => openAdd(null)}>
          + Add top-level space
        </button>
      </div>

      {addTarget !== undefined && (
        <div className="space-tree-panel__form">
          <label className="space-tree-panel__field" htmlFor={nameId}>
            <span>Name</span>
            <input
              id={nameId}
              type="text"
              value={draftName}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd();
                if (e.key === 'Escape') setAddTarget(undefined);
              }}
            />
          </label>
          <label className="space-tree-panel__field" htmlFor={kindId}>
            <span>Type</span>
            <select id={kindId} value={draftKind} onChange={(e) => setDraftKind(e.target.value as SpaceKind)}>
              {SPACE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={mutating || draftName.trim() === ''} onClick={submitAdd}>
            Add
          </button>
          <button type="button" onClick={() => setAddTarget(undefined)}>
            Cancel
          </button>
        </div>
      )}

      <ConfirmModal {...modalProps} />
    </Card>
  );
}

function TreeRow({
  node,
  depth,
  mutating,
  canEdit,
  onAdd,
  onDelete,
}: {
  node: SpaceTreeNode;
  depth: number;
  mutating: boolean;
  canEdit: boolean;
  onAdd: (parentId: string) => void;
  onDelete: (node: SpaceTreeNode) => void;
}) {
  const kindLabel = SPACE_KINDS.find((k) => k.value === node.kind)?.label ?? node.kind;
  return (
    <li className="space-tree-panel__node">
      <div className="space-tree-panel__row" style={{ paddingLeft: `${depth * 1.25}rem` }}>
        <span className="space-tree-panel__name">{node.name}</span>
        <span className="space-tree-panel__kind">{kindLabel}</span>
        {/* Named per node, not "Add" repeated — a screen reader hearing eight identical buttons
            has no way to tell which branch it is on. */}
        <button type="button" disabled={mutating || !canEdit} onClick={() => onAdd(node.id)} aria-label={`Add inside ${node.name}`}>
          +
        </button>
        <button type="button" disabled={mutating || !canEdit} onClick={() => onDelete(node)} aria-label={`Delete ${node.name}`}>
          ×
        </button>
      </div>
      {node.children.length > 0 && (
        <ul className="space-tree-panel__children">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} mutating={mutating} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

