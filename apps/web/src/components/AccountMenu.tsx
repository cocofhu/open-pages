import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightStartOnRectangleIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import type { AuthUser } from "../lib/api";

const MIN_WIDTH = 196;

interface AccountMenuProps {
  user: AuthUser & { login: string };
  onLogout: () => void;
}

/** Signing out is destructive enough that the avatar should open a menu rather
 *  than fire the action on the first click. */
export function AccountMenu({ user, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: MIN_WIDTH });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.max(MIN_WIDTH, box.width);
      // Anchored to the right edge: the trigger lives in the top bar's right cluster.
      const left = Math.min(Math.max(8, box.right - width), window.innerWidth - width - 8);
      setPos({ top: box.bottom + 6, left, width });
    };

    place();
    const frame = window.requestAnimationFrame(() => firstItemRef.current?.focus());
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ghost account"
        data-testid="btn-account"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.login}
        onClick={() => setOpen((current) => !current)}
      >
        {user.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="" />}
        <span className="login" data-testid="user-login">
          {user.login}
        </span>
        <ChevronDownIcon className="ui-icon" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="account-pop"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <div className="account-pop-head">
              {user.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="" />}
              <div>
                <strong>{user.login}</strong>
                {user.name && <em>{user.name}</em>}
              </div>
            </div>
            {/* The identity block stays outside: role="menu" may only own menu items. */}
            <div role="menu" aria-label="账号操作">
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                className="account-pop-item"
                data-testid="btn-logout"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <ArrowRightStartOnRectangleIcon className="ui-icon" aria-hidden="true" />
                退出登录
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
