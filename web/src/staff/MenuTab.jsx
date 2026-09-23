import { useState } from 'react';
import { VegMark } from '../components/VegMark.jsx';
import { formatMoney } from '../format.js';
import { useMenuAdmin } from './useMenuAdmin.js';
import { ItemForm } from './ItemForm.jsx';

// Owners get full add/edit/delete. Staff see the exact same list, but only
// the availability toggle — the one thing the original security model
// always meant for them ("the kitchen can 86 an item mid-service").
export function MenuTab({ isOwner, token }) {
  const menu = useMenuAdmin(token);
  const [editing, setEditing] = useState(null); // null | 'new' | an item
  const [confirmingDelete, setConfirmingDelete] = useState(null); // item id

  if (menu.items === null && !menu.error) return <p className="staff-loading">Loading the menu…</p>;

  const save = async (body) => (editing === 'new' ? menu.createItem(body) : menu.updateItem(editing.id, body));

  const byCategory = new Map();
  for (const item of menu.items ?? []) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  return (
    <div className="staff-menu-tab">
      {menu.error && (
        <div className="staff-banner staff-banner-error" role="alert">
          <span>{menu.error}</span>
          <button type="button" onClick={menu.dismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {isOwner && (
        <div className="staff-menu-toolbar">
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            + Add item
          </button>
        </div>
      )}

      {[...byCategory].map(([category, items]) => (
        <section key={category} className="staff-menu-category">
          <h2>{category}</h2>
          <ul className="staff-menu-items">
            {items.map((item) => (
              <li key={item.id} className={`staff-menu-item${item.is_available ? '' : ' staff-menu-item-off'}`}>
                <div className="staff-menu-item-main">
                  <div className="staff-menu-item-name">
                    <VegMark isVeg={item.is_veg} /> {item.name}
                  </div>
                  {item.description && <p className="staff-muted">{item.description}</p>}
                  <div className="price">{formatMoney(item.price)}</div>
                </div>

                <label className="staff-toggle">
                  <input
                    type="checkbox"
                    checked={item.is_available}
                    disabled={menu.busyId === item.id}
                    onChange={(e) => menu.setAvailability(item.id, e.target.checked)}
                  />
                  <span>{item.is_available ? 'Available' : '86\'d'}</span>
                </label>

                {isOwner &&
                  (confirmingDelete === item.id ? (
                    <div className="staff-confirm staff-confirm-inline">
                      <span>Delete this item?</span>
                      <div className="staff-confirm-actions">
                        <button type="button" className="staff-keep" onClick={() => setConfirmingDelete(null)}>
                          Keep it
                        </button>
                        <button
                          type="button"
                          className="staff-cancel-confirm"
                          disabled={menu.busyId === item.id}
                          onClick={async () => {
                            await menu.deleteItem(item.id);
                            setConfirmingDelete(null);
                          }}
                        >
                          Yes, delete it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="staff-menu-item-actions">
                      <button type="button" className="staff-link" onClick={() => setEditing(item)}>
                        Edit
                      </button>
                      <button type="button" className="staff-link staff-danger-link" onClick={() => setConfirmingDelete(item.id)}>
                        Delete
                      </button>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {menu.items?.length === 0 && <p className="staff-empty">No menu items yet.</p>}

      {editing && (
        <ItemForm
          item={editing === 'new' ? null : editing}
          busy={menu.busyId === (editing === 'new' ? 'new' : editing.id)}
          error={menu.error}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
