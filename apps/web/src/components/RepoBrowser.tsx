"use client";

import React, { useState, useEffect } from "react";
import styles from "./repoBrowser.module.css";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

interface RepoBrowserProps {
  token: string;
  onClose: () => void;
}

export default function RepoBrowser({ token, onClose }: RepoBrowserProps) {
  const router = useRouter();
  
  const [step, setStep] = useState<"repos" | "branches" | "files" | "importing">("repos");
  const [repos, setRepos] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  
  const [selectedRepo, setSelectedRepo] = useState<any>(null);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/github/repos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setRepos(data.data);
      } else {
        toast.error("Failed to load repositories");
      }
    } catch (err) {
      toast.error("Network error");
    }
    setLoading(false);
  };

  const fetchBranches = async (repo: any) => {
    setSelectedRepo(repo);
    setStep("branches");
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/github/repos/${repo.owner}/${repo.name}/branches`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setBranches(data.data);
      }
    } catch (err) {
      toast.error("Network error");
    }
    setLoading(false);
  };

  const fetchFiles = async (branch: any) => {
    setSelectedBranch(branch);
    setStep("files");
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/github/repos/${selectedRepo.owner}/${selectedRepo.name}/tree/${branch.commitSha}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setFiles(data.data);
      }
    } catch (err) {
      toast.error("Network error");
    }
    setLoading(false);
  };

  const importFile = async (file: any) => {
    setStep("importing");
    const loadingToast = toast.loading(`Importing ${file.path}...`);
    
    try {
      const res = await fetch(`${SERVER_URL}/api/documents/from-github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          repoFullName: selectedRepo.fullName,
          branch: selectedBranch.name,
          filePath: file.path
        })
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success("Document created!", { id: loadingToast });
        // Save the initial content to localStorage temporarily so the editor can pick it up
        localStorage.setItem(`github_seed_${data.data.id}`, data.initialContent);
        router.push(`/doc/${data.data.id}`);
        onClose();
      } else {
        toast.error(data.error || "Import failed", { id: loadingToast });
        setStep("files");
      }
    } catch (err) {
      toast.error("Network error during import", { id: loadingToast });
      setStep("files");
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Import from GitHub</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.breadcrumbs}>
          <span onClick={() => { setStep("repos"); setSelectedRepo(null); setSelectedBranch(null); }} className={step !== "repos" ? styles.activeCrumb : ""}>
            Repositories
          </span>
          {selectedRepo && (
            <>
              <span className={styles.separator}>/</span>
              <span onClick={() => { setStep("branches"); setSelectedBranch(null); }} className={step !== "branches" ? styles.activeCrumb : ""}>
                {selectedRepo.name}
              </span>
            </>
          )}
          {selectedBranch && (
            <>
              <span className={styles.separator}>/</span>
              <span>{selectedBranch.name}</span>
            </>
          )}
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Loading from GitHub...</div>
          ) : step === "importing" ? (
            <div className={styles.loading}>Importing to CodeCollab...</div>
          ) : (
            <ul className={styles.list}>
              {step === "repos" && repos.map(repo => (
                <li key={repo.id} onClick={() => fetchBranches(repo)}>
                  <div className={styles.itemTitle}>{repo.fullName}</div>
                  <div className={styles.itemMeta}>{repo.private ? "Private" : "Public"} • Updated {new Date(repo.updatedAt).toLocaleDateString()}</div>
                </li>
              ))}
              
              {step === "branches" && branches.map(branch => (
                <li key={branch.name} onClick={() => fetchFiles(branch)}>
                  <div className={styles.itemTitle}>{branch.name}</div>
                  <div className={styles.itemMeta}>{branch.commitSha.substring(0, 7)}</div>
                </li>
              ))}

              {step === "files" && files.map(file => (
                <li key={file.path} onClick={() => importFile(file)}>
                  <div className={styles.itemTitle}>{file.path}</div>
                  <div className={styles.itemMeta}>{(file.size / 1024).toFixed(1)} KB</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
