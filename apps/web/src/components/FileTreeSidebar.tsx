"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { getFileIconMeta } from '../lib/fileIcons';
import { useAuth } from '../lib/auth';
import { fileHrefInFolder, type FolderContext } from '../lib/folderLink';
import type { Document, PresenceUser } from '@codecollab/shared';
import styles from './fileTreeSidebar.module.css';

interface FileTreeSidebarProps {
  currentDocId: string;
  isOpen?: boolean;
  // When provided, the sidebar shows only this folder's files (fetched from the
  // folder endpoint, which any authenticated user can read) and file links
  // preserve the folder context so shared links keep working.
  folderContext?: FolderContext;
  // Map of docId -> collaborators currently editing that file, used to show
  // their avatars next to the file in the tree.
  presenceByDoc?: Map<string, PresenceUser[]>;
}

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export function FileTreeSidebar({ currentDocId, isOpen = true, folderContext, presenceByDoc }: FileTreeSidebarProps) {
  const { token } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['Local Workspace']));

  // Fetch the document list once per session (re-runs only if the token changes).
  // Keeping this independent of currentDocId means switching files via the sidebar
  // won't refetch or flash the tree back to a loading state.
  // In folder context, fetch just that folder's files instead.
  useEffect(() => {
    if (!token) return;
    const url = folderContext
      ? `${SERVER_URL}/api/documents/folder?owner=${encodeURIComponent(folderContext.uid)}&repo=${encodeURIComponent(folderContext.repo)}&branch=${encodeURIComponent(folderContext.branch)}`
      : `${SERVER_URL}/api/documents`;

    const fetchDocuments = async () => {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (data.success) {
          setDocuments(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch documents for sidebar", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDocuments();
  }, [token, folderContext?.uid, folderContext?.repo, folderContext?.branch]);

  // Auto-expand the folders leading to the currently open document.
  // Runs whenever the selection or the loaded document list changes, without
  // triggering a network request.
  useEffect(() => {
    const currentDoc = documents.find((d) => d.id === currentDocId);
    if (!currentDoc) return;

    const repo = currentDoc.githubRepo || 'Local Workspace';
    const toExpand = [repo];

    if (currentDoc.githubFilePath) {
      const parts = currentDoc.githubFilePath.split('/');
      parts.pop(); // Remove the file name

      let currentPath = repo;
      parts.forEach((part: string) => {
        currentPath += `/${part}`;
        toExpand.push(currentPath);
      });
    }

    setExpandedFolders((prev) => new Set([...prev, ...toExpand]));
  }, [currentDocId, documents]);

  // Group documents by repository first, then build a nested tree
  const tree = useMemo(() => {
    // Structure: { [repoOrLocalName]: TreeItem }
    // TreeItem: { type: 'file', doc: Document } | { type: 'folder', children: Record<string, TreeItem> }
    const rootGroups: Record<string, any> = {
      'Local Workspace': { type: 'folder', children: {} }
    };

    documents.forEach(doc => {
      const groupName = doc.githubRepo || 'Local Workspace';
      if (!rootGroups[groupName]) {
        rootGroups[groupName] = { type: 'folder', children: {} };
      }

      if (!doc.githubFilePath) {
        // Flat file in this group
        rootGroups[groupName].children[doc.id] = { type: 'file', name: doc.title, doc };
      } else {
        // Nested file
        const parts = doc.githubFilePath.split('/');
        const fileName = parts.pop()!;
        let currentLevel = rootGroups[groupName].children;
        
        parts.forEach((part: string) => {
          if (!currentLevel[part]) {
            currentLevel[part] = { type: 'folder', children: {} };
          }
          currentLevel = currentLevel[part].children;
        });
        
        currentLevel[doc.id] = { type: 'file', name: fileName, doc };
      }
    });

    if (Object.keys(rootGroups['Local Workspace'].children).length === 0) {
      delete rootGroups['Local Workspace'];
    }

    return rootGroups;
  }, [documents]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const renderTree = (nodes: Record<string, any>, currentPath: string, depth = 0) => {
    return Object.entries(nodes)
      .sort(([keyA, nodeA], [keyB, nodeB]) => {
        // Folders first, then files
        if (nodeA.type === 'folder' && nodeB.type === 'file') return -1;
        if (nodeA.type === 'file' && nodeB.type === 'folder') return 1;
        return keyA.localeCompare(keyB);
      })
      .map(([key, node]) => {
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        
        if (node.type === 'folder') {
          const isExpanded = expandedFolders.has(fullPath);
          return (
            <div key={fullPath} className={styles.folder}>
              <div 
                className={styles.folderHeader} 
                style={{ paddingLeft: `${(depth * 12) + 12}px` }}
                onClick={() => toggleFolder(fullPath)}
              >
                <span className={styles.folderIcon}>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span style={{ marginLeft: 4 }}>
                    {isExpanded ? <FolderOpen size={16} fill="currentColor" fillOpacity={0.2} /> : <Folder size={16} fill="currentColor" fillOpacity={0.2} />}
                  </span>
                </span>
                <span className={styles.folderName} title={key}>
                  {key}
                </span>
              </div>
              
              {isExpanded && (
                <div className={styles.fileList} style={{ paddingLeft: 0 }}>
                  {renderTree(node.children, fullPath, depth + 1)}
                </div>
              )}
            </div>
          );
        } else {
          // File
          const doc = node.doc;
          const { icon: Icon, color } = getFileIconMeta(doc.githubFilePath || doc.title);
          const isActive = doc.id === currentDocId;
          
          const href = folderContext ? fileHrefInFolder(doc.id, folderContext) : `/doc/${doc.id}`;
          const collaborators = presenceByDoc?.get(doc.id) ?? [];
          return (
            <Link
              href={href}
              key={doc.id}
              className={`${styles.fileItem} ${isActive ? styles.active : ''}`}
              style={{ paddingLeft: `${(depth * 12) + 28}px` }}
              title={doc.githubFilePath || doc.title}
            >
              <span className={styles.fileIcon} style={{ color }}>
                <Icon size={14} />
              </span>
              <span className={styles.fileName}>
                {node.name}
              </span>
              {collaborators.length > 0 && (
                <span className={styles.presenceAvatars}>
                  {collaborators.slice(0, 3).map((u) => (
                    <span
                      key={u.id}
                      className={styles.presenceAvatar}
                      style={{ backgroundColor: u.color }}
                      title={`${u.displayName} is editing this file`}
                    >
                      {u.displayName.charAt(0).toUpperCase()}
                    </span>
                  ))}
                  {collaborators.length > 3 && (
                    <span className={styles.presenceMore}>+{collaborators.length - 3}</span>
                  )}
                </span>
              )}
            </Link>
          );
        }
      });
  };

  return (
    <div className={`${styles.sidebar} ${!isOpen ? styles.collapsed : ''}`}>
      <div className={styles.header}>
        Explorer
      </div>
      <div className={styles.treeContainer}>
        {isLoading ? (
          <div className={styles.loading}>Loading files...</div>
        ) : (
          renderTree(tree, "", 0)
        )}
      </div>
    </div>
  );
}
