"use client";

import React from "react";
import type { PresenceUser } from "@codecollab/shared";
import styles from "./editor.module.css";

interface PresenceBarProps {
  users: Map<string, PresenceUser>;
}

export function PresenceBar({ users }: PresenceBarProps) {
  const userList = Array.from(users.values());

  return (
    <div className={styles.presenceBar}>
      <div className={styles.presenceLabel}>
        {userList.length === 0 ? "Just you editing" : `${userList.length} other(s) editing:`}
      </div>
      <div className={styles.avatarList}>
        {userList.map((user) => (
          <div 
            key={user.id} 
            className={styles.avatar} 
            style={{ backgroundColor: user.color }}
            title={user.displayName}
          >
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
