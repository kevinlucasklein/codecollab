"use client";

import React, { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import styles from "./editor.module.css";

interface EditorProps {
  ytext: Y.Text;
  disabled?: boolean;
}

export function Editor({ ytext, disabled }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState("");

  // 1. Initial load & listen to remote changes
  useEffect(() => {
    // Set initial text
    setLocalValue(ytext.toString());

    // Observe remote changes
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // If the change came from us locally, ignore the observe event
      // to prevent cursor jumping
      if (transaction.local) return;
      
      setLocalValue(ytext.toString());
    };

    ytext.observe(observer);

    return () => {
      ytext.unobserve(observer);
    };
  }, [ytext]);

  // 2. Handle local keystrokes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    
    // Simple sync algorithm for a <textarea> (Layer 1)
    // Note: A real code editor (CodeMirror) sends actual deltas. 
    // Here, we compute a basic diff or just delete/insert.
    // For simplicity in Layer 1, we clear and insert. 
    // (This ruins cursors for simultaneous edits on the SAME block of text, 
    // but proves sync works across the wire).
    
    ytext.doc?.transact(() => {
      // Calculate length difference
      const oldLen = ytext.length;
      
      // Delete everything
      if (oldLen > 0) {
        ytext.delete(0, oldLen);
      }
      
      // Insert new value
      if (newValue.length > 0) {
        ytext.insert(0, newValue);
      }
    });

    setLocalValue(newValue);
  };

  return (
    <textarea
      ref={textareaRef}
      className={styles.textarea}
      value={localValue}
      onChange={handleChange}
      disabled={disabled}
      spellCheck={false}
      placeholder="Start typing..."
    />
  );
}
