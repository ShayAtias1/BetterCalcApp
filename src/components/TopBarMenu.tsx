import { useId, useRef, type ReactNode } from 'react';
import ResponsivePopover from './ResponsivePopover';
import Icon, { type IconName } from './Icon';

/** Ids of the top-bar dropdowns; both apps' bars pick the ones they use. */
export type MenuId = 'view' | 'export' | 'settings' | 'plans' | 'tools';

/**
 * A top-bar button with a popover menu under it. Only the menu whose id matches `openId` is shown,
 * so the parent's single `openId` state keeps at most one menu open at a time. Closes on an outside
 * click or Escape.
 */
export default function TopBarMenu({
  id,
  openId,
  setOpenId,
  label,
  icon,
  variant = 'secondary',
  title,
  highlighted,
  desktopMaxWidth,
  children,
}: {
  id: MenuId;
  openId: MenuId | null;
  setOpenId: (v: MenuId | null) => void;
  label: string;
  /** Leading glyph from the shared icon set. Callers that pass none keep a plain text trigger. */
  icon?: IconName;
  /**
   * Button weight. 'primary' marks the strongest action in the bar (export — at most one per bar),
   * 'ghost' the quiet ones. Defaults to 'secondary', which is what Revision Compare's bar uses.
   */
  variant?: 'secondary' | 'ghost' | 'primary';
  title?: string;
  highlighted?: boolean;
  desktopMaxWidth?: number;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const open = openId === id;

  return (
    <div className="top-bar-menu-anchor">
      <button
        ref={anchorRef}
        type="button"
        className={`btn-${variant} small top-bar-menu-btn ${
          variant !== 'primary' && (open || highlighted) ? 'active' : ''
        }`}
        onClick={() => setOpenId(open ? null : id)}
        title={title}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {icon && <Icon name={icon} />}
        <span className="btn-label">{label}</span>
        <span className="menu-caret">▾</span>
      </button>
      {open && <ResponsivePopover id={menuId} label={label} anchorRef={anchorRef} onClose={() => setOpenId(null)} desktopMaxWidth={desktopMaxWidth}>{children}</ResponsivePopover>}
    </div>
  );
}
