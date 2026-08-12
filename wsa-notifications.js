/**
 * wsa-notifications.js — Real-time notification system for WSA CMS
 * Handles fetching, displaying, and managing notifications across the system
 * 
 * USAGE:
 *   const notif = new WSANotifications(supabaseClient);
 *   await notif.init();
 *   notif.showBadge(); // updates notification count in UI
 *   notif.subscribe(); // listens for real-time updates
 */

class WSANotifications {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.notifications = [];
    this.unreadCount = 0;
    this.currentUserId = null;
    this.subscription = null;
  }

  /**
   * Initialize notifications for current user
   */
  async init() {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) {
      console.warn('WSANotifications: No session found');
      return false;
    }
    this.currentUserId = session.user.id;
    await this.load();
    return true;
  }

  /**
   * Fetch all notifications for current user
   */
  async load() {
    try {
      const { data, error } = await this.supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', this.currentUserId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      this.notifications = data || [];
      this.unreadCount = this.notifications.filter(n => !n.is_read).length;
      return this.notifications;
    } catch (err) {
      console.error('Error loading notifications:', err);
      return [];
    }
  }

  /**
   * Update notification badge in UI (call after load())
   * Looks for element with id="notif-badge" and updates count
   */
  showBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    
    if (this.unreadCount === 0) {
      badge.style.display = 'none';
    } else {
      badge.style.display = 'inline-block';
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId) {
    try {
      const { error } = await this.supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
      
      // Update local state
      const notif = this.notifications.find(n => n.id === notificationId);
      if (notif && !notif.is_read) {
        notif.is_read = true;
        this.unreadCount--;
        this.showBadge();
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  }

  /**
   * Delete a notification
   */
  async delete(notificationId) {
    try {
      const { error } = await this.supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;
      
      // Update local state
      const idx = this.notifications.findIndex(n => n.id === notificationId);
      if (idx !== -1) {
        if (!this.notifications[idx].is_read) {
          this.unreadCount--;
        }
        this.notifications.splice(idx, 1);
        this.showBadge();
      }
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    try {
      const unreadIds = this.notifications
        .filter(n => !n.is_read)
        .map(n => n.id);

      if (unreadIds.length === 0) return;

      const { error } = await this.supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', unreadIds);

      if (error) throw error;

      this.notifications.forEach(n => n.is_read = true);
      this.unreadCount = 0;
      this.showBadge();
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  }

  /**
   * Subscribe to real-time notification updates
   * Automatically reloads when new notification inserted
   */
  subscribe() {
    if (this.subscription) return; // Already subscribed

    this.subscription = this.supabase
      .channel(`notifications:${this.currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${this.currentUserId}`
        },
        (payload) => {
          // New notification arrived
          this.notifications.unshift(payload.new);
          if (!payload.new.is_read) {
            this.unreadCount++;
          }
          this.showBadge();
          // Optional: show browser notification
          this.showBrowserNotification(payload.new);
        }
      )
      .subscribe();
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribe() {
    if (this.subscription) {
      this.supabase.removeChannel(this.subscription);
      this.subscription = null;
    }
  }

  /**
   * Show browser notification (requires permission)
   */
  showBrowserNotification(notification) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: 'assets/logo.png',
        tag: notification.id // Prevent duplicates
      });
    }
  }

  /**
   * Request browser notification permission
   */
  async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  }

  /**
   * Format notification type for display
   */
  static typeLabel(type) {
    const labels = {
      'contact_submission': '📧 Contact Form',
      'feedback': '⭐ Feedback',
      'request': '📝 Request',
      'message': '💬 Message',
      'milestone': '🎉 Milestone'
    };
    return labels[type] || type;
  }

  /**
   * Get icon emoji for notification type
   */
  static typeIcon(type) {
    const icons = {
      'contact_submission': '📧',
      'feedback': '⭐',
      'request': '📝',
      'message': '💬',
      'milestone': '🎉'
    };
    return icons[type] || '🔔';
  }

  /**
   * Format notification for display in list
   */
  renderNotification(notification) {
    const isRead = notification.is_read ? 'is-read' : 'is-unread';
    const date = new Date(notification.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="notif-item ${isRead}" data-id="${notification.id}">
        <div class="notif-header">
          <div class="notif-title">
            <span class="notif-type">${WSANotifications.typeLabel(notification.notification_type)}</span>
            <h4>${notification.title}</h4>
          </div>
          <div class="notif-date">${date}</div>
        </div>
        <p class="notif-message">${notification.message}</p>
        <div class="notif-actions">
          ${notification.action_url ? `<a href="${notification.action_url}" class="btn btn-small btn-primary">View</a>` : ''}
          ${!notification.is_read ? `<button class="btn btn-small" onclick="window.wsa_notif.markAsRead('${notification.id}')">Mark Read</button>` : ''}
          <button class="btn btn-small btn-outline" onclick="window.wsa_notif.delete('${notification.id}')">Delete</button>
        </div>
      </div>
    `;
  }
}

// Export for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WSANotifications;
}
