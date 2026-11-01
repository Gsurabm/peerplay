import React, { useEffect } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { timeAgo } from '../lib/format.js';
import { Empty } from '../components/ui.jsx';

const ICONS = {
  match: '✦',
  wallet: '◈',
  social: '◉',
  system: '◔',
  security: '⛨',
};

export default function Notifications() {
  const { notifications, unread, markNotificationsRead, refreshNotifications } = useApp();

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head row-between wrap">
        <div>
          <h1>Notifications</h1>
          <p className="small" style={{ margin: 0 }}>Match activity, wallet movements, social updates and security alerts.</p>
        </div>
        {unread > 0 && (
          <button className="btn ghost sm" onClick={markNotificationsRead}>Mark all read</button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Empty icon="◔">No notifications yet. Your matches, payouts and rank changes will show up here.</Empty>
      ) : (
        <div className="stack-sm">
          {notifications.map((n) => (
            <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
              <span className="notif-icon">{ICONS[n.type] || '◔'}</span>
              <div className="grow">
                <div className="row-between">
                  <span style={{ fontWeight: 600 }}>{n.title}</span>
                  <span className="tiny dim nowrap">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <div className="small muted" style={{ marginTop: 2 }}>{n.body}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
