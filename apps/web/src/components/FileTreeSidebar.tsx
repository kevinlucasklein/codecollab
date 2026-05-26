"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { getFileIcon } from '../lib/fileIcons';
import type { Document } from '@codecollab/shared';
import styles from './fileTreeSidebar.module.css';

interface FileTreeSidebarProps {
  currentDocId: string;
  isOpen?: boolean;
}

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export function FileTreeSidebar({ currentDocId, isOpen = true }: FileTreeSidebarProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['Local Workspace']));

  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/documents`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });
        const data = await res.json();
        if (data.success) {
          setDocuments(data.data);
          
          // Auto-expand the folder containing the current document
          const currentDoc = data.data.find((d: Document) => d.id === currentDocId);
          if (currentDoc) {
            const folderName = currentDoc.githubRepo || 'Local Workspace';
            setExpandedFolders(prev => new Set([...prev, folderName]));
          }
        }
      } catch (err) {
        console.error("Failed to fetch documents for sidebar", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDocuments();
  }, [currentDocId]);

  // Group documents by folder
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, Document[]> = {
      'Local Workspace': []
    };

    documents.forEach(doc => {
      if (doc.githubRepo) {
        if (!groups[doc.githubRepo]) {
          groups[doc.githubRepo] = [];
        }
        groups[doc.githubRepo].push(doc);
      } else {
        groups['Local Workspace'].push(doc);
      }
    });

    // Remove Local Workspace if empty
    if (groups['Local Workspace'].length === 0) {
      delete groups['Local Workspace'];
    }

    return groups;
  }, [documents]);

  const toggleFolder = (folderName: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
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
          Object.entries(groupedDocuments).map(([folderName, docs]) => {
            const isExpanded = expandedFolders.has(folderName);
            return (
              <div key={folderName} className={styles.folder}>
                <div 
                  className={styles.folderHeader} 
                  onClick={() => toggleFolder(folderName)}
                >
                  <span className={styles.folderIcon}>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span style={{ marginLeft: 4 }}>
                      {isExpanded ? <FolderOpen size={16} fill="currentColor" fillOpacity={0.2} /> : <Folder size={16} fill="currentColor" fillOpacity={0.2} />}
                    </span>
                  </span>
                  <span className={styles.folderName} title={folderName}>
                    {folderName}
                  </span>
                </div>
                
                {isExpanded && (
                  <div className={styles.fileList}>
                    {docs.map(doc => {
                      const { Icon, color } = getFileIcon(doc.language || 'plaintext');
                      const isActive = doc.id === currentDocId;
                      
                      return (
                        <Link 
                          href={`/doc/${doc.id}`} 
                          key={doc.id}
                          className={`${styles.fileItem} ${isActive ? styles.active : ''}`}
                          title={doc.githubFilePath || doc.title}
                        >
                          <span className={styles.fileIcon} style={{ color }}>
                            <Icon size={14} />
                          </span>
                          <span className={styles.fileName}>
                            {doc.githubFilePath ? doc.githubFilePath.split('/').pop() : doc.title}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
